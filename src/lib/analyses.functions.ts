import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { generateObject } from "ai";
import { z } from "zod";

import { createModelInstance, type SupportedProvider } from "./ai-gateway.server";
import { getEnv, getCfAIBinding, getCfCtx } from "./runtime-env.server";
import { decryptSecret } from "./crypto.server";
import {
  buildStyleAnalysis,
  styleAnalysisToPromptBlock,
  searchEvidenceForClaims,
  formatEvidenceBlock,
  extractEvidenceUrls,
} from "./pipeline.server";

const VerdictEnum = z.enum([
  "사실",
  "부분 사실",
  "근거 부족",
  "반대 근거 우세",
  "미확인",
]);

const ClaimSchema = z.object({
  claim: z.string(),
  subject: z.string().max(80).default(""),   // Stage 2: SPO 주어
  predicate: z.string().max(80).default(""), // Stage 2: SPO 서술어
  object: z.string().max(80).default(""),    // Stage 2: SPO 목적어
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
  bias_type: z.string().max(40).default("중립"),  // Stage 1 기반 LLM 편향 분류
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

const SYSTEM_PROMPT = `당신은 다국어 팩트체크 AI 'FactGuard'입니다. 학습된 지식을 최대한 활용하여 각 주장에 대해 명확하고 단호한 판정을 내립니다. 불필요하게 보수적으로 판단하지 않습니다.

## 언어 규칙
입력 텍스트의 주요 언어로 응답합니다 (한국어→한국어, English→English). 판정 enum 값은 언어 무관 고정입니다.

## 판정 기준 — 반드시 정확히 적용

**사실** (confidence 70~100)
- 역사적 사실, 과학적 합의, 공식 통계, 법령, 상식으로 검증 가능
- 학습 데이터에 일관된 근거가 충분히 존재
- 예: "한국전쟁은 1950년에 발발했다", "물의 화학식은 H₂O다"

**부분 사실** (confidence 50~79)
- 핵심 주장은 맞지만 수치·날짜·맥락이 과장·왜곡·누락됨
- 조건부로만 성립하거나 일부 시점에만 맞는 주장
- 예: 통계는 맞지만 비교 기준이 편향됨

**근거 부족** (confidence 20~49)
- 주장 자체는 검증 가능하나 AI 학습 데이터 내 신뢰할 근거가 부족
- 출처·수치가 불명확하여 사실/거짓 판단이 어려운 경우
- 예: 출처 없는 내부 통계, 검증 불가한 개인 경험담

**반대 근거 우세** (confidence 60~100, 반대 방향)
- 알려진 사실·과학적 합의·공식 기록과 명백히 상충
- 허위정보, 왜곡된 인과관계, 맥락 없는 오해
- 예: "백신이 자폐증을 유발한다"는 주장 — 과학적으로 반박됨

**미확인** — 아래 경우에만 엄격히 사용
- 실시간 데이터가 반드시 필요: 오늘의 주가·환율, 현재 기상, 진행 중인 사건
- 미발표 연구·비공개 자료·미래 예측이 근거의 전부인 경우
- ⚠️ 단순히 "최근 일이라 모를 수 있다"는 이유로 미확인을 쓰지 마세요

## 핵심 원칙
1. **적극 판정**: 학습 지식으로 판단 가능하면 사실 또는 반대근거우세로 단호하게 판정
2. **미확인 최소화**: 최후 수단으로만 사용. 전체 주장 중 미확인이 절반 이상이면 재검토
3. **구체적 근거**: supporting_points와 counter_points에 막연한 표현 금지 — 구체적 사실·수치·기관명 포함
4. **환각 금지**: 출처 URL 생성 금지, suggested_sources는 기관 유형만 (예: '통계청', '세계보건기구')
5. reasoning은 2~4문장, 왜 그 판정인지 구체적으로 설명
6. confidence: 사실/반대근거우세는 70 이상, 부분사실은 50~79, 근거부족은 20~49, 미확인은 10~40
7. title은 12자 내외 짧은 제목 (입력 언어 동일)
8. overall_verdict는 가장 비중 있는 주장들의 종합 판정
9. **Stage 2 SPO**: 각 claim마다 subject(주어: 주체·기관·인물), predicate(서술어: 핵심 동사구), object(목적어: 주장 내용) 필드를 채우세요
10. **bias_type**: 전체 텍스트 편향 유형 — "정치적", "경제적", "사회적", "과학적", "역사적", "중립" 중 하나
11. **Stage 3 검색 결과 활용**: 제공된 Tavily 검색 결과가 있으면 판정 근거로 적극 활용하세요`;

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

  // keys가 없어도 CF AI 바인딩 폴백이 있으면 계속 진행
  const cfAIBinding = getCfAIBinding() as any;
  if (keys.length === 0 && !cfAIBinding) {
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

/* ── URL 캐시 확인 (24시간 내 동일 URL 분석 재사용) ── */
async function checkUrlCache(
  sourceUrl: string,
  sessionId: string,
  userId: string | null,
): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  let q = supabaseAdmin
    .from("analyses")
    .select("id")
    .eq("source_url", sourceUrl)
    .eq("status", "completed")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1);
  if (userId) {
    q = q.eq("user_id", userId);
  } else {
    q = q.eq("session_id", sessionId).is("user_id", null);
  }
  const { data } = await q;
  return data?.[0]?.id ?? null;
}

/* ── 백그라운드 AI 분석 처리 — 3단계 파이프라인 ── */
async function processAnalysis(
  analysisId: string,
  inputText: string,
  sourceUrl: string | undefined,
): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  try {
    // ── URL 본문 가져오기 ──
    let bodyText = inputText;
    if (sourceUrl && inputText.length < 200) {
      try {
        const res = await fetch(sourceUrl, {
          headers: { "User-Agent": "Mozilla/5.0 FactGuardBot" },
          redirect: "error",
        });
        if (res.ok) {
          const html = await res.text();
          const stripped = html
            .replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim();
          if (stripped.length > bodyText.length) bodyText = stripped.slice(0, 8000);
        }
      } catch { /* URL 가져오기 실패 → 원본 텍스트 사용 */ }
    }

    // ── Stage 1: JS 문체 특징 추출 (동기, 즉각) ──
    const styleAnalysis = buildStyleAnalysis(bodyText);
    const styleBlock = styleAnalysisToPromptBlock(styleAnalysis);

    // ── Stage 3 선행: Tavily 검색 (비동기 병렬, LLM과 동시) ──
    // 본문 첫 3문장을 검색 쿼리로 사용 (LLM 주장 추출 전)
    const searchQueries = bodyText
      .split(/(?<=[.!?。])\s+/)
      .map(s => s.trim())
      .filter(s => s.length >= 20)
      .slice(0, 3)
      .map(s => s.slice(0, 120));
    if (searchQueries.length === 0 && bodyText.length > 0) {
      searchQueries.push(bodyText.slice(0, 120));
    }

    // LLM 호출과 Tavily 검색을 병렬 실행
    const [evidenceMap] = await Promise.all([
      searchEvidenceForClaims(searchQueries),
    ]);

    // ── Stage 3: 검색 결과 포맷팅 ──
    const evidenceBlock = formatEvidenceBlock(searchQueries, evidenceMap);
    const evidenceUrls = extractEvidenceUrls(evidenceMap);

    // ── Stage 2+3: LLM 통합 프롬프트 (SPO 주장 추출 + 검색 기반 판정) ──
    const prompt = `${styleBlock}

${evidenceBlock}

[Stage 2 — SPO 주장 추출 + Stage 3 — 팩트체크 판정]
위 Stage 1 문체 분석과 Stage 3 검색 결과를 참고하여:
1. 아래 본문에서 검증 가능한 핵심 주장 3~7개를 추출하세요
2. 각 주장을 subject(주어)-predicate(서술어)-object(목적어) SPO 구조로 분해하세요
3. 검색 결과가 있으면 판정 근거로 적극 활용하세요
4. bias_type: 전체 편향 유형 판단 (정치적/경제적/사회적/과학적/역사적/중립)${sourceUrl ? `\n원본 URL: ${sourceUrl}` : ""}

판정 원칙:
• 역사·과학·법령·통계로 알 수 있는 것 → "사실" 또는 "반대 근거 우세"로 단호하게 판정
• Tavily 검색 결과로 반박 가능한 주장 → "반대 근거 우세"
• "미확인"은 오직 실시간 데이터(현재 주가·날씨·진행 중 사건)가 필수일 때만
• Stage 1 가짜 가능성 지수 ${styleAnalysis.fakeProbability}% 반영 — 높을수록 비판적 검토

분석할 본문:
"""
${bodyText.slice(0, 7000)}
"""`;

    const parsed = await generateWithFallback({ schema: AnalysisSchema, system: SYSTEM_PROMPT, prompt, cfHint: "analysis" });

    // ── 후처리: Stage 1 결과 + Stage 3 URL 병합 ──
    const enrichedClaims = parsed.claims.map((c, i) => ({
      ...c,
      evidence_urls: (evidenceMap[i] ?? []).slice(0, 2).map(e => e.url).filter(Boolean),
    }));

    await supabaseAdmin.from("analyses").update({
      status: "completed",
      input_text: bodyText.slice(0, 8000),
      title: parsed.title,
      summary: `[가짜가능성:${styleAnalysis.fakeProbability}%] ${parsed.summary}`,
      overall_verdict: parsed.overall_verdict,
      overall_confidence: parsed.overall_confidence,
      claims: {
        bias_type: parsed.bias_type,
        fake_probability: styleAnalysis.fakeProbability,
        style_signals: styleAnalysis.signals,
        evidence_urls: evidenceUrls,
        items: enrichedClaims,
      },
    }).eq("id", analysisId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try {
      await supabaseAdmin.from("analyses").update({
        status: "failed",
        title: "분석 실패",
        summary: msg.slice(0, 300),
        claims: [],
      }).eq("id", analysisId);
    } catch { /* 실패 업데이트 오류 무시 */ }
  }
}

export const analyzeContent = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const userId = await getOptionalUserId();
    await checkRateLimit(data.sessionId, userId);

    const sourceUrl = data.url;
    if (sourceUrl) validatePublicUrl(sourceUrl);

    // 24시간 URL 캐시 적중 시 기존 결과 즉시 반환
    if (sourceUrl) {
      const cachedId = await checkUrlCache(sourceUrl, data.sessionId, userId);
      if (cachedId) return { id: cachedId, cached: true, pending: false };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: pending, error: insertErr } = await supabaseAdmin
      .from("analyses")
      .insert({
        session_id: data.sessionId,
        user_id: userId,
        source_url: sourceUrl ?? null,
        input_text: data.text.slice(0, 8000),
        status: "pending",
        title: null,
        summary: null,
        overall_verdict: null,
        overall_confidence: null,
        claims: [],
      })
      .select("id")
      .single();
    if (insertErr) throw new Error("저장 실패: " + insertErr.message);

    const analysisId = pending.id as string;
    const workPromise = processAnalysis(analysisId, data.text, sourceUrl);

    const cfCtx = getCfCtx();
    if (cfCtx) {
      // CF Workers: 응답 즉시 반환 후 백그라운드 처리
      cfCtx.waitUntil(workPromise);
      return { id: analysisId, cached: false, pending: true };
    } else {
      // 로컬 개발: 동기적으로 처리 후 반환
      await workPromise;
      return { id: analysisId, cached: false, pending: false };
    }
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
      .select("id, title, overall_verdict, overall_confidence, created_at, source_url, status")
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
      subject: z.string().max(80).default(""),   // Stage 2: SPO 주어
      predicate: z.string().max(80).default(""), // Stage 2: SPO 서술어
      object: z.string().max(80).default(""),    // Stage 2: SPO 목적어
      verdict: VerdictEnum,
      confidence: z.number().int().min(0).max(100),
      brief: z.string().max(200),
      supporting: z.string().max(150),
      counter: z.string().max(150),
    }),
  ).max(5),
  overall_verdict: VerdictEnum,
  overall_confidence: z.number().int().min(0).max(100),
  bias_type: z.string().max(40).default("중립"),  // Stage 1 기반 LLM 분류
  risk_flags: z.array(z.string().max(50)).max(4),
});

// 후처리 필드 포함 최종 타입
export type QuickCheckResult = z.infer<typeof QuickCheckSchema> & {
  fake_probability: number;   // Stage 1: JS 계산 가짜 확률
  style_signals: string[];    // Stage 1: 경고 신호 목록
};

const QUICK_SYSTEM = `당신은 다국어 팩트체크 AI입니다. 학습 지식을 적극 활용하여 각 주장에 단호한 판정을 내립니다. 입력 언어로 응답하되 판정 enum은 한국어 고정(사실/부분 사실/근거 부족/반대 근거 우세/미확인).

## 판정 기준 — 엄격히 적용

**사실** (confidence 70+): 역사·과학·법령·공식 통계로 검증 가능. 학습 데이터에 일관된 근거 존재.
**부분 사실** (confidence 50~79): 핵심은 맞지만 수치·날짜·맥락이 과장·왜곡·누락.
**근거 부족** (confidence 20~49): 검증 가능하나 신뢰할 근거 불충분. 출처·수치 불명확.
**반대 근거 우세** (confidence 60+): 알려진 사실·과학적 합의와 명백히 상충. 허위정보 패턴.
**미확인**: 오직 실시간 데이터(오늘 주가·현재 기상·진행 중 사건)나 비공개 자료가 필수일 때만. "최근 일이라 모를 수 있다"는 이유로 사용 금지.

## 핵심 원칙
- 학습 지식으로 판단 가능하면 반드시 사실 또는 반대근거우세로 판정
- 미확인은 최후 수단 — highlights 중 미확인이 절반 이상이면 재검토 필요
- brief: 왜 그 판정인지 구체적 근거 명시 (막연한 "확인 필요" 금지)
- supporting/counter: 구체적 사실·수치·기관명 포함 (막연한 표현 금지)
- highlights: 검증 가능한 사실 주장만 (의견·예측·감상 제외), 없으면 빈 배열
- summary: 전체를 1~2문장 중립 요약
- risk_flags: 선동적 언어·출처불명 수치·음모론·허위권위인용 중 실제 해당하는 것만
- **Stage 2 SPO**: 각 highlight마다 subject(주어: 주체·기관), predicate(서술어: 핵심 동사구), object(목적어: 주장 내용)를 채우세요
- **bias_type**: 전체 텍스트 편향 유형 — "정치적", "경제적", "사회적", "과학적", "역사적", "중립" 중 하나
- 환각 금지: URL·가상 인용문·존재하지 않는 연구 생성 금지`;

export const quickAnalyzeContent = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ text: z.string().min(10) }).parse(input),
  )
  .handler(async ({ data }): Promise<QuickCheckResult> => {
    // Stage 1: JS 문체 특징 추출 (동기, 즉각)
    const styleAnalysis = buildStyleAnalysis(data.text);
    const styleBlock = styleAnalysisToPromptBlock(styleAnalysis);

    const quickPrompt = `${styleBlock}

[Stage 2+3 — 주장 추출 및 팩트체크]
위 Stage 1 문체 분석을 참고하여 아래 텍스트에서 검증 가능한 사실 주장을 추출하고 팩트체크하세요.
• 각 주장은 subject(주어)-predicate(서술어)-object(목적어) SPO 구조로 분해하세요
• bias_type: 전체 편향 유형 판단
• Stage 1 가짜 가능성 지수 ${styleAnalysis.fakeProbability}% — 높을수록 주장에 비판적 검토 적용
• 학습 지식으로 판단 가능한 것은 반드시 사실/반대근거우세로 판정
• 미확인은 실시간 데이터가 필수일 때만

"""
${data.text.slice(0, 3000)}
"""`;
    try {
      const llmResult = await generateWithFallback({
        schema: QuickCheckSchema,
        system: QUICK_SYSTEM,
        prompt: quickPrompt,
        temperature: 0.2,
        cfHint: "quick",
      });
      // Stage 1 결과 병합
      return {
        ...llmResult,
        fake_probability: styleAnalysis.fakeProbability,
        style_signals: styleAnalysis.signals,
      };
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
