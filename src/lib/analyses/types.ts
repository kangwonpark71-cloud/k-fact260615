import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";

/* ── 판정 및 주장 유형 ── */

export const VerdictEnum = z.enum(["사실", "부분 사실", "근거 부족", "반대 근거 우세"]);

export type Verdict = z.infer<typeof VerdictEnum>;

export const ClaimTypeEnum = z
  .enum(["EMPIRICAL", "DISPUTED_TERRITORY", "OPINION", "DOMESTIC_LAW_FACT"])
  .default("EMPIRICAL");

export type ClaimType = z.infer<typeof ClaimTypeEnum>;

/* ── AI 프로바이더 ── */

export type SupportedProvider = "gemini" | "openai" | "anthropic";

export type ModelRef = { model: string };

/* ── SSRF 차단용 IP 주소 ── */

export type KVNamespace = {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
};

/* ── Claim 스키마 ── */

export const ClaimSchema = z.object({
  claim: z.string(),
  claim_type: ClaimTypeEnum,
  judgment_basis: z.string().default("팩트체크"),
  subject: z.string().max(80).default(""),
  predicate: z.string().max(80).default(""),
  object: z.string().max(80).default(""),
  verdict: VerdictEnum,
  confidence: z.number().min(0).max(100),
  reasoning: z.string(),
  supporting_points: z.array(z.string()),
  counter_points: z.array(z.string()),
  unknowns: z.array(z.string()),
  suggested_sources: z.array(z.object({ name: z.string(), type: z.string() })),
});

export type Claim = z.infer<typeof ClaimSchema>;

export type Phase1Claim = {
  claim: string;
  verdict: string;
  claim_type?: string;
  [key: string]: Json | undefined;
};

/* ── Analysis 스키마 ── */

export const AnalysisSchema = z.object({
  title: z.string(),
  summary: z.string(),
  overall_verdict: VerdictEnum,
  overall_confidence: z.number().min(0).max(100),
  bias_type: z.string().max(40).default("중립"),
  claims: z.array(ClaimSchema).min(1).max(7),
});

export type AnalysisResult = z.infer<typeof AnalysisSchema>;

/* ── AnalysisPayload (DB/KV 저장용) ── */

export type AnalysisPayload = Record<string, unknown>;

/* ── Input 스키마 ── */

export const InputSchema = z
  .object({
    url: z
      .string()
      .url()
      .optional()
      .or(z.literal("").transform(() => undefined)),
    text: z.string().max(50_000, "본문은 최대 50,000자까지 입력할 수 있습니다.").default(""),
    sessionId: z.string().min(1),
  })
  .refine((d) => d.url || d.text.length >= 30, {
    message: "본문은 최소 30자 이상이어야 합니다.",
    path: ["text"],
  });

export type InputData = z.infer<typeof InputSchema>;

/* ── QuickCheck 스키마 ── */

export const QuickCheckSchema = z.object({
  summary: z.string().max(200),
  highlights: z
    .array(
      z.object({
        claim: z.string().max(150),
        subject: z.string().max(80).default(""),
        predicate: z.string().max(80).default(""),
        object: z.string().max(80).default(""),
        verdict: VerdictEnum,
        confidence: z.number().int().min(0).max(100),
        brief: z.string().max(200),
        supporting: z.string().max(150),
        counter: z.string().max(150),
      }),
    )
    .max(5),
  overall_verdict: VerdictEnum,
  overall_confidence: z.number().int().min(0).max(100),
  bias_type: z.string().max(40).default("중립"),
  risk_flags: z.array(z.string().max(50)).max(4),
});

/* ── Naver 팩트체크 참고 기사 ── */

export type NaverFactCheckItem = {
  title: string;
  link: string;
  description: string;
  pub_date: string;
  publisher?: string;
};

export type QuickCheckResult = z.infer<typeof QuickCheckSchema> & {
  fake_probability: number;
  style_signals: string[];
  naver_factchecks?: NaverFactCheckItem[];
};

/* ── Simplified 스키마 ── */

export const SimplifiedClaimSchema = z.object({
  index: z.number().int(),
  friendly_verdict: z.string().max(40),
  analogy: z.string().max(250),
  simple_reasoning: z.string().max(400),
  simple_supporting: z.array(z.string().max(160)).max(4),
  simple_counter: z.array(z.string().max(160)).max(4),
});

export const SimplifiedResultSchema = z.object({
  simple_summary: z.string().max(300),
  claims: z.array(SimplifiedClaimSchema),
});

export type SimplifiedClaim = z.infer<typeof SimplifiedClaimSchema>;
export type SimplifiedResult = z.infer<typeof SimplifiedResultSchema>;

/* ── 기타 ── */

export type KeyEntry = {
  provider: SupportedProvider;
  key: string;
};
