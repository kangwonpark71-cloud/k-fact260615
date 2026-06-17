import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { generateObject } from "ai";
import { z } from "zod";

import { createModelInstance, type SupportedProvider } from "./ai-gateway.server";
import { getEnv, getCfAIBinding } from "./runtime-env.server";
import { decryptSecret } from "./crypto.server";

const VerdictEnum = z.enum([
  "사실",
  "부분 사실",
  "근거 부족",
  "반대 근거 우세",
  "미확인",
]);

const ClaimSchema = z.object({
  claim: z.string(),
  verdict: VerdictEnum,
  confidence: z.number().min(0).max(100),
  reasoning: z.string(),
  supporting_points: z.array(z.string()),
  counter_points: z.array(z.string()),
  unknowns: z.array(z.string()),
  suggested_sources: z.array(
    z.object({
      name: z.string(),
      type: z.string(),
    }),
  ),
});

const AnalysisSchema = z.object({
  title: z.string(),
  summary: z.string(),
  overall_verdict: VerdictEnum,
  overall_confidence: z.number().min(0).max(100),
  claims: z.array(ClaimSchema).min(1).max(7),
});

const InputSchema = z
  .object({
    url: z.string().url().optional().or(z.literal("").transform(() => undefined)),
    text: z.string().default(""),
    sessionId: z.string().min(1),
  })
  .refine((d) => d.url || d.text.length >= 30, {
    message: "본문은 최소 30자 이상이어야 합니다.",
    path: ["text"],
  });

const SYSTEM_PROMPT = `당신은 한국어 사실검증 보조 AI 'FactGuard'입니다.
입력된 뉴스/게시물 본문에서 검증 가능한 핵심 주장 3~7개를 추출하고,
각 주장에 대해 일반 상식, 학습된 지식, 논리적 추론을 바탕으로
사실성·반박 가능성·미확인 항목을 구조화해 평가합니다.

규칙:
- 단정형 판정 대신 '근거 기반 신뢰도'로 표현합니다.
- 모르거나 최신 정보가 필요한 경우 '미확인'으로 표시하고 unknowns에 명시합니다.
- 환각 금지: 출처 URL을 만들어내지 말고, suggested_sources에는 일반적인 출처 유형/기관명만 적습니다 (예: '통계청', '주요 일간지', '학술 데이터베이스').
- reasoning은 2~4문장의 한국어로 간결하게.
- confidence는 0~100 정수.
- title은 본문을 대표하는 12자 내외 짧은 제목.`;

// ── 멀티 키 관리 ──

type KeyEntry = {
  provider: SupportedProvider;
  key: string;
};

async function getAllActiveKeys(): Promise<{ keys: KeyEntry[]; dbError?: string }> {
  const keys: KeyEntry[] = [];
  const supported: SupportedProvider[] = ["gemini", "openai", "anthropic"];
  let dbError: string | undefined;

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("api_keys")
      .select("provider, key_value")
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (error) {
      dbError = "DB오류: " + error.message;
    } else {
      for (const row of data ?? []) {
        if (supported.includes(row.provider as SupportedProvider)) {
          const key = await decryptSecret(row.key_value);
          keys.push({ provider: row.provider as SupportedProvider, key });
        }
      }
      if (keys.length === 0) dbError = "DB조회성공-키없음(등록된 활성키 0개)";
    }
  } catch (e) {
    dbError = "DB연결실패: " + (e instanceof Error ? e.message.slice(0, 100) : String(e));
  }

  // 환경변수 폴백 (DB 키와 무관하게 항상 추가 — DB 키가 무효일 때 대비)
  const envFallbacks: Array<[SupportedProvider, string]> = [
    ["openai", "OPENAI_API_KEY"],
    ["anthropic", "ANTHROPIC_API_KEY"],
    ["gemini", "GEMINI_API_KEY"],
  ];
  for (const [provider, envName] of envFallbacks) {
    const val = getEnv(envName);
    if (val) keys.push({ provider, key: val });
  }

  return { keys, dbError };
}

// ── CF Workers AI 전용 빌더 (모델 출력 구조와 무관하게 항상 유효한 객체 반환) ──

type CFVerdict = "사실" | "부분 사실" | "근거 부족" | "반대 근거 우세" | "미확인";
const CF_VALID: CFVerdict[] = ["사실", "부분 사실", "근거 부족", "반대 근거 우세", "미확인"];
const CF_VMAP: Record<string, CFVerdict> = {
  "사실이다": "사실", "사실임": "사실", "참": "사실",
  "부분사실": "부분 사실", "부분적 사실": "부분 사실", "일부사실": "부분 사실",
  "근거부족": "근거 부족", "증거부족": "근거 부족", "불충분": "근거 부족",
  "반대근거우세": "반대 근거 우세", "거짓": "반대 근거 우세", "허위": "반대 근거 우세",
  "불확실": "미확인", "확인불가": "미확인",
};
const cfV = (v: unknown): CFVerdict => {
  if (typeof v !== "string") return "미확인";
  const t = v.trim();
  return CF_VALID.includes(t as CFVerdict) ? (t as CFVerdict) : (CF_VMAP[t] ?? "미확인");
};
const cfS = (v: unknown, max: number) => (typeof v === "string" ? v : String(v ?? "")).slice(0, max);
const cfN = (v: unknown) => { const n = typeof v === "number" ? v : parseFloat(String(v ?? "")); return isNaN(n) ? 50 : Math.min(100, Math.max(0, Math.round(n))); };
const cfA = (v: unknown): string[] => Array.isArray(v) ? v.slice(0, 5).map(s => cfS(s, 120)) : [];
const cfSrc = (v: unknown): { name: string; type: string }[] => {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 5).map(s => {
    if (typeof s === "string") return { name: s.slice(0, 50), type: "일반" };
    if (s && typeof s === "object") { const o = s as Record<string, unknown>; return { name: cfS(o.name ?? o.source ?? o.title ?? "", 50), type: cfS(o.type ?? "일반", 30) }; }
    return { name: "참고 자료", type: "일반" };
  });
};
const cfClaim = (c: unknown) => {
  const DEF = { claim: "본문 내 주요 주장", verdict: "미확인" as CFVerdict, confidence: 50, reasoning: "", supporting_points: [] as string[], counter_points: [] as string[], unknowns: [] as string[], suggested_sources: [] as { name: string; type: string }[] };
  if (typeof c === "string") return { ...DEF, claim: c.slice(0, 200) };
  if (!c || typeof c !== "object") return DEF;
  const o = c as Record<string, unknown>;
  return {
    claim:             cfS(o.claim ?? o.주장 ?? o.content ?? o.text ?? "본문 내 주요 주장", 200),
    verdict:           cfV(o.verdict ?? o.판정 ?? o.result ?? o.rating),
    confidence:        cfN(o.confidence ?? o.신뢰도 ?? o.score ?? o.certainty),
    reasoning:         cfS(o.reasoning ?? o.reason ?? o.이유 ?? o.explanation ?? o.analysis ?? "", 500),
    supporting_points: cfA(o.supporting_points ?? o.supportingPoints ?? o.support ?? o.지지 ?? o.evidence),
    counter_points:    cfA(o.counter_points ?? o.counterPoints ?? o.counter ?? o.반박 ?? o.opposition),
    unknowns:          cfA(o.unknowns ?? o.unknown ?? o.미확인 ?? o.uncertain),
    suggested_sources: cfSrc(o.suggested_sources ?? o.suggestedSources ?? o.sources ?? o.출처 ?? o.references),
  };
};

function buildAnalysisFromCF(obj: Record<string, unknown>) {
  const root = (obj.analysis ?? obj.result ?? obj.data ?? obj) as Record<string, unknown>;
  let raw = root.claims ?? root.분석결과 ?? root.주장들 ?? root.items ?? [];
  if (!Array.isArray(raw)) raw = typeof raw === "object" && raw ? Object.values(raw as Record<string, unknown>) : [];
  const claims = (raw as unknown[]).slice(0, 7).map(cfClaim).filter(c => c.claim.length > 0);
  if (claims.length === 0) claims.push(cfClaim(null));
  return {
    title:              cfS(root.title ?? obj.title ?? "분석 결과", 20),
    summary:            cfS(root.summary ?? obj.summary ?? "", 500),
    overall_verdict:    cfV(root.overall_verdict ?? obj.overall_verdict),
    overall_confidence: cfN(root.overall_confidence ?? obj.overall_confidence),
    claims,
  };
}

function buildQuickFromCF(obj: Record<string, unknown>) {
  let rawH = obj.highlights ?? obj.claims ?? obj.주장 ?? obj.items ?? [];
  if (!Array.isArray(rawH)) rawH = [];
  const highlights = (rawH as unknown[]).slice(0, 3).map(h => {
    if (typeof h === "string") return { claim: h.slice(0, 150), verdict: "미확인" as CFVerdict, confidence: 50, brief: "", supporting: "", counter: "" };
    if (!h || typeof h !== "object") return { claim: "주요 주장", verdict: "미확인" as CFVerdict, confidence: 50, brief: "", supporting: "", counter: "" };
    const o = h as Record<string, unknown>;
    return {
      claim:      cfS(o.claim ?? o.주장 ?? o.content ?? "주요 주장", 150),
      verdict:    cfV(o.verdict ?? o.판정 ?? o.result),
      confidence: cfN(o.confidence ?? o.신뢰도),
      brief:      cfS(o.brief ?? o.reasoning ?? o.이유 ?? o.explanation ?? "", 200),
      supporting: cfS(o.supporting ?? o.support ?? o.지지 ?? "", 150),
      counter:    cfS(o.counter ?? o.opposition ?? o.반박 ?? "", 150),
    };
  });
  const rawF = obj.risk_flags ?? obj.riskFlags ?? obj.위험 ?? obj.flags ?? [];
  return {
    summary:            cfS(obj.summary ?? obj.요약 ?? "", 200),
    overall_verdict:    cfV(obj.overall_verdict ?? obj.overall ?? obj.판정),
    overall_confidence: cfN(obj.overall_confidence ?? obj.confidence),
    highlights,
    risk_flags: (Array.isArray(rawF) ? rawF : []).slice(0, 4).map(f => cfS(f, 50)),
  };
}

function parseCFResponse(raw: string, hint: "analysis" | "quick"): unknown {
  let s = raw.replace(/^```(?:json)?\s*/im, "").replace(/\s*```\s*$/im, "").trim();
  const st = s.indexOf("{"); if (st > 0) s = s.slice(st);
  const en = s.lastIndexOf("}"); if (en !== -1) s = s.slice(0, en + 1);
  try {
    const obj = JSON.parse(s) as Record<string, unknown>;
    return hint === "analysis" ? buildAnalysisFromCF(obj) : buildQuickFromCF(obj);
  } catch {
    return hint === "analysis" ? buildAnalysisFromCF({}) : buildQuickFromCF({});
  }
}

const CF_JSON_HINT = `\n\n[출력] 마크다운 없이 순수 JSON 객체만. 판정은 "사실"|"부분 사실"|"근거 부족"|"반대 근거 우세"|"미확인" 중 하나.`;

async function generateWithFallback<T extends z.ZodType>(params: {
  schema: T;
  system: string;
  prompt: string;
  temperature?: number;
  cfHint?: "analysis" | "quick";
}): Promise<z.infer<T>> {
  const { keys, dbError } = await getAllActiveKeys();

  if (keys.length === 0) {
    const hint = dbError ? ` (${dbError})` : "";
    throw new Error(
      `등록된 AI API 키가 없습니다. 관리자 대시보드에서 API 키를 등록하거나 환경 변수를 설정하세요.${hint}`,
    );
  }

  const errors: string[] = [];

  for (const entry of keys) {
    try {
      const model = createModelInstance(entry.provider, entry.key);
      const { object } = await generateObject({
        model,
        system: params.system,
        prompt: params.prompt,
        schema: params.schema,
        ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
      });
      return object;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`[${entry.provider}] ${msg.slice(0, 120)}`);
      continue;
    }
  }

  // 최종 폴백: CF Workers AI 네이티브 바인딩
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cfAIBinding = getCfAIBinding() as any;
  if (cfAIBinding) {
    const cfModels = [
      "@cf/meta/llama-3.2-3b-instruct",        // 경량, json_object 지원
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast", // 고품질
      "@cf/meta/llama-3.1-70b-instruct",        // 70B 안정 버전
      "@cf/mistral/mistral-7b-instruct-v0.1",   // Mistral v0.1
    ];

    const cfSystem = params.system + CF_JSON_HINT;

    for (const cfModel of cfModels) {
      try {
        const cfResult = await cfAIBinding.run(cfModel, {
          messages: [
            { role: "system", content: cfSystem },
            { role: "user", content: params.prompt },
          ],
          response_format: { type: "json_object" },
          max_tokens: 3000,
        });

        const raw: string =
          typeof cfResult === "string"
            ? cfResult
            : typeof cfResult?.response === "string"
              ? cfResult.response
              : JSON.stringify(cfResult);

        return parseCFResponse(raw, params.cfHint ?? "analysis") as z.infer<T>;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`[cf:${cfModel.split("/").pop()}] ${msg.slice(0, 100)}`);
      }
    }
  }

  throw new Error("모든 AI 키 실패 — " + errors.join(" / "));
}

async function getOptionalUserId(): Promise<string | null> {
  try {
    const auth = getRequestHeader("authorization");
    if (!auth?.toLowerCase().startsWith("bearer ")) return null;
    const token = auth.slice(7).trim();
    if (!token) return null;
    const url = getEnv("SUPABASE_URL");
    const anonKey = getEnv("SUPABASE_PUBLISHABLE_KEY");
    if (!url || !anonKey) return null;
    const supa = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data } = await supa.auth.getUser(token);
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

/* ── SSRF 차단: 내부 IP / 사설 주소 fetch 금지 ── */
function validatePublicUrl(rawUrl: string): void {
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch { throw new Error("유효하지 않은 URL입니다."); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("http/https URL만 분석할 수 있습니다.");
  }
  const h = parsed.hostname.toLowerCase();

  // IPv6 리터럴 — loopback, unique-local(fc00::/7), link-local(fe80::/10), IPv4-mapped
  const ipv6Host = h.startsWith("[") ? h.slice(1, -1) : (h.includes(":") ? h : null);
  if (ipv6Host !== null) {
    if (
      ipv6Host === "::" ||
      ipv6Host === "::1" ||
      /^fc/i.test(ipv6Host) ||
      /^fd/i.test(ipv6Host) ||
      /^fe[89ab]/i.test(ipv6Host) || // fe80::/10
      /^::ffff:/i.test(ipv6Host)     // IPv4-mapped
    ) throw new Error("내부 주소는 분석할 수 없습니다.");
    return;
  }

  // 명시적 키워드
  if (h === "localhost" || h === "0.0.0.0") {
    throw new Error("내부 주소는 분석할 수 없습니다.");
  }

  // 비표준 IP 인코딩 차단: 0x7f000001, 017700000001, 2130706433 같은 우회 형태
  if (/^0x[0-9a-f]+$/i.test(h) || /^0\d+$/.test(h) || /^\d+$/.test(h)) {
    throw new Error("내부 IP 주소는 분석할 수 없습니다.");
  }

  // 표준 점 표기 IPv4 — 모든 비공개 대역 차단
  const oct = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (oct) {
    const [a, b] = [Number(oct[1]), Number(oct[2])];
    if (
      a === 0 ||                               // 0.0.0.0/8
      a === 127 ||                             // 127/8 루프백
      a === 10 ||                              // 10/8 사설
      (a === 172 && b >= 16 && b <= 31) ||    // 172.16/12 사설
      (a === 192 && b === 168) ||             // 192.168/16 사설
      (a === 169 && b === 254) ||             // 169.254/16 링크로컬
      (a === 100 && b >= 64 && b <= 127) ||   // 100.64/10 CGNAT
      (a === 198 && (b === 18 || b === 19)) || // 198.18/15 벤치마킹
      a >= 224                                 // 멀티캐스트·예약 대역
    ) throw new Error("내부 IP 주소는 분석할 수 없습니다.");
  }
}

/* ── Rate limit: 세션/사용자당 일일 분석 횟수 제한 ── */
const RATE_LIMIT_ANON = 10;
const RATE_LIMIT_USER = 30;

async function checkRateLimit(sessionId: string, userId: string | null): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const base = supabaseAdmin.from("analyses")
    .select("id", { count: "exact", head: true })
    .gte("created_at", todayStart.toISOString());
  const { count } = await (userId
    ? base.eq("user_id", userId)
    : base.eq("session_id", sessionId));
  const limit = userId ? RATE_LIMIT_USER : RATE_LIMIT_ANON;
  if ((count ?? 0) >= limit) {
    throw new Error(`일일 분석 한도(${limit}건)에 도달했습니다. 내일 다시 시도하세요.`);
  }
}

export const analyzeContent = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const userId = await getOptionalUserId();
    await checkRateLimit(data.sessionId, userId);

    let bodyText = data.text;
    const sourceUrl = data.url;
    if (sourceUrl) validatePublicUrl(sourceUrl);

    if (sourceUrl && data.text.length < 200) {
      try {
        const res = await fetch(sourceUrl, {
          headers: { "User-Agent": "Mozilla/5.0 FactGuardBot" },
          redirect: "error", // 리다이렉트 기반 SSRF 우회 차단
        });
        if (res.ok) {
          const html = await res.text();
          const stripped = html
            .replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim();
          if (stripped.length > bodyText.length) {
            bodyText = stripped.slice(0, 8000);
          }
        }
      } catch {
        // ignore
      }
    }

    const prompt = `분석할 본문:\n"""\n${bodyText.slice(0, 8000)}\n"""\n\n${sourceUrl ? `원본 URL: ${sourceUrl}\n\n` : ""}위 지침에 따라 JSON으로 응답하세요.`;

    let parsed: z.infer<typeof AnalysisSchema>;
    try {
      parsed = await generateWithFallback({ schema: AnalysisSchema, system: SYSTEM_PROMPT, prompt, cfHint: "analysis" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error("AI 분석 호출 실패: " + msg);
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: inserted, error } = await supabaseAdmin
      .from("analyses")
      .insert({
        session_id: data.sessionId,
        user_id: userId,
        source_url: sourceUrl ?? null,
        input_text: bodyText.slice(0, 8000),
        title: parsed.title,
        summary: parsed.summary,
        overall_verdict: parsed.overall_verdict,
        overall_confidence: parsed.overall_confidence,
        claims: parsed.claims,
      })
      .select("id")
      .single();

    if (error) throw new Error("저장 실패: " + error.message);

    return { id: inserted.id as string, ...parsed };
  });

export const getAnalysis = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), sessionId: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data }) => {
    const userId = await getOptionalUserId();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("analyses")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("분석을 찾을 수 없습니다.");

    // 권한 확인: 본인 user_id이거나 익명 분석(소유자 없음)인 경우 본인 session_id와 일치
    const ownedByUser = userId && row.user_id === userId;
    const ownedBySession = !row.user_id && row.session_id === data.sessionId;
    if (!ownedByUser && !ownedBySession) {
      throw new Error("이 분석을 볼 권한이 없습니다.");
    }
    return row;
  });

export const listAnalyses = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ sessionId: z.string().min(1) }).parse(input))
  .handler(async ({ data }) => {
    const userId = await getOptionalUserId();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let query = supabaseAdmin
      .from("analyses")
      .select("id, title, overall_verdict, overall_confidence, created_at, source_url")
      .order("created_at", { ascending: false })
      .limit(50);

    if (userId) {
      // 로그인 사용자: 본인 소유 분석만
      query = query.eq("user_id", userId);
    } else {
      // 익명: 본인 세션 + 소유자 없음
      query = query.eq("session_id", data.sessionId).is("user_id", null);
    }

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const deleteAnalysis = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), sessionId: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data }) => {
    const userId = await getOptionalUserId();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: row, error: fetchError } = await supabaseAdmin
      .from("analyses")
      .select("user_id, session_id")
      .eq("id", data.id)
      .maybeSingle();

    if (fetchError) throw new Error(fetchError.message);
    if (!row) throw new Error("분석을 찾을 수 없습니다.");

    const ownedByUser = userId && row.user_id === userId;
    const ownedBySession = !row.user_id && row.session_id === data.sessionId;
    if (!ownedByUser && !ownedBySession) {
      throw new Error("이 분석을 삭제할 권한이 없습니다.");
    }

    const { error } = await supabaseAdmin.from("analyses").delete().eq("id", data.id);
    if (error) throw new Error("삭제 실패: " + error.message);
    return { deleted: true };
  });

// ── 실시간 빠른 팩트체크 ──
const QuickCheckSchema = z.object({
  summary: z.string().max(200),
  highlights: z.array(
    z.object({
      claim: z.string().max(150),
      verdict: VerdictEnum,
      confidence: z.number().int().min(0).max(100),
      brief: z.string().max(200),
      supporting: z.string().max(150),
      counter: z.string().max(150),
    }),
  ).max(3),
  overall_verdict: VerdictEnum,
  overall_confidence: z.number().int().min(0).max(100),
  risk_flags: z.array(z.string().max(50)).max(4),
});

export type QuickCheckResult = z.infer<typeof QuickCheckSchema>;

const QUICK_SYSTEM = `당신은 한국어 사실검증 보조 AI입니다. 입력된 텍스트에서 검증 가능한 핵심 주장을 추출하고 정확하게 평가합니다.

## 판정 기준 (반드시 준수)
- 사실: 학습된 지식·상식으로 충분한 근거가 있음
- 부분 사실: 일부는 맞지만 과장·누락·맥락 오류 존재
- 근거 부족: 주장은 있으나 검증 근거가 불충분
- 반대 근거 우세: 알려진 사실과 명백히 배치됨
- 미확인: 최신 데이터·전문 정보 없이는 판단 불가

## 위험 신호 유형 (risk_flags)
선동적/감정 유발 언어, 출처 불명 수치/통계, 혐오·차별 표현, 과도한 단정, 음모론 패턴, 허위 권위 인용 중 해당하는 것만 포함.

## 규칙
- highlights: 사실 주장만 추출 (의견·감상·예측 제외), 없으면 빈 배열
- claim: 원문에서 추출한 구체적 주장을 한 문장으로
- brief: 판정 이유를 1-2문장 한국어로 (왜 그 판정인지 명확히)
- supporting: 해당 판정을 지지하는 핵심 근거 1문장 (없으면 빈 문자열)
- counter: 반박 또는 주의사항 1문장 (없으면 빈 문자열)
- confidence: 학습 지식 기반 확신도 정수 (불확실할수록 낮게)
- summary: 텍스트 전체를 1-2문장으로 중립적 요약
- risk_flags: 발견된 위험 신호만, 없으면 빈 배열
- 환각 금지: URL·가상 인용문·존재하지 않는 연구 생성 금지`;

export const quickAnalyzeContent = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ text: z.string().min(10) }).parse(input),
  )
  .handler(async ({ data }) => {
    const quickPrompt = `다음 텍스트를 사실검증 관점에서 분석하세요:\n"""\n${data.text.slice(0, 3000)}\n"""`;
    try {
      return await generateWithFallback({
        schema: QuickCheckSchema,
        system: QUICK_SYSTEM,
        prompt: quickPrompt,
        temperature: 0.2,
        cfHint: "quick",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error("빠른 분석 실패: " + msg);
    }
  });

export const claimAnonymousAnalyses = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ sessionId: z.string().min(1) }).parse(input))
  .handler(async ({ data }) => {
    const userId = await getOptionalUserId();
    if (!userId) return { claimed: 0 };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: updated, error } = await supabaseAdmin
      .from("analyses")
      .update({ user_id: userId })
      .eq("session_id", data.sessionId)
      .is("user_id", null)
      .select("id");

    if (error) throw new Error("기록 이전 실패: " + error.message);
    return { claimed: updated?.length ?? 0 };
  });
