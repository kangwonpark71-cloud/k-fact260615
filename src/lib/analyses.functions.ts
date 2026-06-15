import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { generateObject } from "ai";
import { z } from "zod";

import { createGeminiProvider } from "./ai-gateway.server";

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

const InputSchema = z.object({
  url: z.string().url().optional().or(z.literal("").transform(() => undefined)),
  text: z.string().min(30, "본문은 최소 30자 이상이어야 합니다."),
  sessionId: z.string().min(1),
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

async function getOptionalUserId(): Promise<string | null> {
  try {
    const auth = getRequestHeader("authorization");
    if (!auth?.toLowerCase().startsWith("bearer ")) return null;
    const token = auth.slice(7).trim();
    if (!token) return null;
    const url = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !anonKey) return null;
    const supa = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data } = await supa.auth.getUser(token);
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

export const analyzeContent = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY가 설정되지 않았습니다.");

    const userId = await getOptionalUserId();

    let bodyText = data.text;
    const sourceUrl = data.url;

    if (sourceUrl && data.text.length < 200) {
      try {
        const res = await fetch(sourceUrl, {
          headers: { "User-Agent": "Mozilla/5.0 FactGuardBot" },
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

    const gemini = createGeminiProvider(apiKey);
    const prompt = `분석할 본문:\n"""\n${bodyText.slice(0, 8000)}\n"""\n\n${sourceUrl ? `원본 URL: ${sourceUrl}\n\n` : ""}위 지침에 따라 JSON으로 응답하세요.`;

    let parsed: z.infer<typeof AnalysisSchema>;
    try {
      const { object } = await generateObject({
        model: gemini("gemini-2.5-flash"),
        system: SYSTEM_PROMPT,
        prompt,
        schema: AnalysisSchema,
      });
      parsed = object;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("429")) throw new Error("AI 요청 한도를 초과했습니다. 잠시 후 다시 시도하세요.");
      if (msg.includes("403")) throw new Error("Gemini API 키가 유효하지 않습니다. GEMINI_API_KEY를 확인하세요.");
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

// ── 실시간 빠른 팩트체크 (음성 입력용 프리뷰) ──
const QuickCheckSchema = z.object({
  highlights: z
    .array(
      z.object({
        claim: z.string(),
        verdict: VerdictEnum,
        confidence: z.number().min(0).max(100),
        brief: z.string(),
      }),
    )
    .min(1)
    .max(3),
  overall_verdict: VerdictEnum,
  overall_confidence: z.number().min(0).max(100),
});

export type QuickCheckResult = z.infer<typeof QuickCheckSchema>;

const QUICK_SYSTEM = `당신은 빠른 사실검증 보조 AI입니다.
입력된 텍스트에서 검증 가능한 핵심 주장 1~3개를 추출하고 빠르게 검토합니다.
규칙:
- highlights 최대 3개
- brief는 1~2문장 한국어로 간결하게
- 추론 가능한 범위만 답변, 불분명하면 "미확인"
- confidence는 0~100 정수`;

export const quickAnalyzeContent = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ text: z.string().min(10) }).parse(input),
  )
  .handler(async ({ data }) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY가 설정되지 않았습니다.");

    const gemini = createGeminiProvider(apiKey);
    try {
      const { object } = await generateObject({
        model: gemini("gemini-2.5-flash"),
        system: QUICK_SYSTEM,
        prompt: `다음 텍스트의 핵심 주장을 빠르게 검토하세요:\n"""\n${data.text.slice(0, 2000)}\n"""`,
        schema: QuickCheckSchema,
      });
      return object;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("429")) throw new Error("AI 요청 한도 초과");
      throw new Error("빠른 분석 실패");
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
