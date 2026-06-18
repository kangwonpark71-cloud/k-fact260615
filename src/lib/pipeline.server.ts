import { getEnv } from "./runtime-env.server";

// ══════════════════════════════════════════════════
//  Stage 1: LSTM 문체 분류 — 텍스트 특징 추출 (순수 JS)
//  LIAR Dataset / FakeNewsNet 학습 패턴 기반 휴리스틱
// ══════════════════════════════════════════════════

export interface StyleMetrics {
  avgSentenceLength: number;  // 평균 문장 길이 (어절 수)
  lexicalDiversity: number;   // 고유 어휘 / 전체 어휘 (0~1)
  emotionScore: number;       // 감정어 밀도 (0~1)
  exaggerationScore: number;  // 절대·과장 표현 밀도 (0~1)
  numericalDensity: number;   // 수치·통계 밀도 (0~1)
  attributionScore: number;   // 출처 인용 밀도 (0~1)
  punctuationAbuse: number;   // 비정상 구두점 밀도 (0~1)
}

export interface StyleAnalysis {
  metrics: StyleMetrics;
  fakeProbability: number;    // 0~100 (높을수록 가짜 가능성)
  signals: string[];          // 감지된 경고 신호 목록
}

const EMOTION_RE = /매우|정말|완전히?|절대로?|엄청|놀라운?|충격적?|경악|극단|끔찍|최악|최고|대박|기적|!{2,}|shocking|unbelievable|incredible/gi;
const EXAGGERATION_RE = /항상|절대|모든|전혀|결코|100%|완벽|무조건|반드시|never|always|every(one|thing|body)?|all of|none of|no one/gi;
const NUMERICAL_RE = /\d+[\.,]?\d*\s*(%|퍼센트|명|원|억|조|배|개|건|회|년|월|일|km|kg|만|천|포인트|달러|유로)/g;
const ATTRIBUTION_RE = /에 따르면|에 의하면|발표했|밝혔|보도했|전했|확인했|claimed|according to|reported|stated|announced|confirmed/gi;
const PUNCT_ABUSE_RE = /!{2,}|\?{2,}|\.{4,}|[A-Z]{5,}/g;

export function extractStyleMetrics(text: string): StyleMetrics {
  const sentences = text.split(/(?<=[.!?。])\s+/).filter(s => s.trim().length > 3);
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const uniqueWords = new Set(words.map(w => w.toLowerCase().replace(/[^a-z가-힣0-9]/g, "")));

  const safeDiv = (a: number, b: number) => (b === 0 ? 0 : a / b);
  const cap1 = (v: number) => Math.min(1, Math.max(0, v));

  const avgSentenceLength = safeDiv(words.length, sentences.length);
  const lexicalDiversity  = safeDiv(uniqueWords.size, words.length);

  const emotionCount       = (text.match(EMOTION_RE) ?? []).length;
  const exaggerationCount  = (text.match(EXAGGERATION_RE) ?? []).length;
  const numericalCount     = (text.match(NUMERICAL_RE) ?? []).length;
  const attributionCount   = (text.match(ATTRIBUTION_RE) ?? []).length;
  const punctCount         = (text.match(PUNCT_ABUSE_RE) ?? []).length;

  return {
    avgSentenceLength,
    lexicalDiversity,
    emotionScore:       cap1(safeDiv(emotionCount,      Math.max(words.length / 15, 1))),
    exaggerationScore:  cap1(safeDiv(exaggerationCount, Math.max(sentences.length, 1))),
    numericalDensity:   cap1(safeDiv(numericalCount,    Math.max(sentences.length, 1))),
    attributionScore:   cap1(safeDiv(attributionCount,  Math.max(sentences.length, 1))),
    punctuationAbuse:   cap1(safeDiv(punctCount,        Math.max(sentences.length, 1))),
  };
}

export function buildStyleAnalysis(text: string): StyleAnalysis {
  const m = extractStyleMetrics(text);
  const signals: string[] = [];

  if (m.emotionScore > 0.25)
    signals.push(`과도한 감정적 표현 (밀도 ${(m.emotionScore * 100).toFixed(0)}%) — LIAR 패턴`);
  if (m.exaggerationScore > 0.20)
    signals.push(`절대적·과장 표현 다수 (${(m.exaggerationScore * 100).toFixed(0)}%) — FakeNews 지표`);
  if (m.lexicalDiversity < 0.35)
    signals.push(`낮은 어휘 다양성 (${(m.lexicalDiversity * 100).toFixed(0)}%) — 반복 선전 패턴`);
  if (m.numericalDensity > 0.5 && m.attributionScore < 0.05)
    signals.push("출처 없는 수치 과다 사용 — 신뢰도 저하 지표");
  if (m.attributionScore < 0.03 && text.length > 300)
    signals.push("출처·인용 부재 — 검증 불가 정보 가능성");
  if (m.punctuationAbuse > 0.1)
    signals.push(`비정상 구두점·대문자 남용 (${(m.punctuationAbuse * 100).toFixed(0)}%) — 클릭베이트 신호`);
  if (m.avgSentenceLength > 90)
    signals.push(`비정상 장문 (평균 ${m.avgSentenceLength.toFixed(0)}어/문장) — 의도적 복잡화 가능`);

  // LIAR 스타일 가중 가짜 확률 (0~100 정수)
  const fakeProbabilityRaw =
    m.emotionScore       * 35 +
    m.exaggerationScore  * 30 +
    (1 - m.lexicalDiversity) * 10 +
    (1 - Math.min(1, m.attributionScore * 5)) * 15 +
    m.punctuationAbuse   * 10;
  const fakeProbability = Math.min(100, Math.max(0, Math.round(fakeProbabilityRaw)));

  return { metrics: m, fakeProbability, signals };
}

export function styleAnalysisToPromptBlock(analysis: StyleAnalysis): string {
  const { metrics: m, fakeProbability, signals } = analysis;
  return [
    `[Stage 1 — 문체 분류 결과]`,
    `가짜 가능성 지수: ${fakeProbability}% (LIAR/FakeNewsNet 패턴 기반)`,
    `어휘 다양성: ${(m.lexicalDiversity * 100).toFixed(0)}%`,
    `감정어 밀도: ${(m.emotionScore * 100).toFixed(0)}%`,
    `과장 표현 밀도: ${(m.exaggerationScore * 100).toFixed(0)}%`,
    `출처 인용 밀도: ${(m.attributionScore * 100).toFixed(0)}%`,
    signals.length > 0
      ? `감지된 신호:\n${signals.map(s => `  • ${s}`).join("\n")}`
      : "감지된 의심 신호 없음",
  ].join("\n");
}

// ══════════════════════════════════════════════════
//  Stage 2: Transformer NER — 주어-서술어-목적어 구조
//  (klue/bert-base 스타일 — LLM 프롬프트로 구현)
// ══════════════════════════════════════════════════

export interface StructuredClaim {
  claim: string;       // 원문 주장
  subject: string;     // 주어 (NER: 기관·인물·대상)
  predicate: string;   // 서술어 (핵심 동사구)
  object: string;      // 목적어/보어 (주장 내용)
  claimType: "통계" | "인과" | "사실" | "인용" | "예측";
  checkability: number; // 검증 가능성 0~100
}

export function buildClaimExtractionPrompt(text: string, styleBlock: string): string {
  return `${styleBlock}

[Stage 2 — 구조화 주장 추출 지시]
아래 본문에서 검증 가능한 사실 주장을 최대 5개 추출하세요.
각 주장은 반드시 주어(Subject)-서술어(Predicate)-목적어/보어(Object) 구조로 분해하세요.

주장 유형:
- 통계: 수치·비율·순위 포함
- 인과: "때문에", "의해", "결과로" 형태
- 사실: 역사적·과학적 사실 주장
- 인용: 특정 인물/기관 발언 인용
- 예측: 미래 전망·예측

본문:
"""
${text.slice(0, 6000)}
"""`;
}

// ══════════════════════════════════════════════════
//  Stage 3: LLM 팩트체크 에이전트 — Tavily 실시간 검색
// ══════════════════════════════════════════════════

export interface SearchEvidence {
  title: string;
  url: string;
  snippet: string;
  score: number;
}

export async function searchEvidence(claim: string): Promise<SearchEvidence[]> {
  const apiKey = getEnv("TAVILY_API_KEY");
  if (!apiKey) return [];

  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query: claim,
        max_results: 5,
        search_depth: "advanced",
        include_answer: false,
        include_raw_content: false,
        include_domains: [],
        exclude_domains: [],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json() as {
      results?: Array<{ title: string; url: string; content: string; score: number }>;
    };
    return (data.results ?? []).slice(0, 5).map(r => ({
      title:   (r.title ?? "").slice(0, 120),
      url:     r.url ?? "",
      snippet: (r.content ?? "").slice(0, 500),
      score:   typeof r.score === "number" ? r.score : 0,
    }));
  } catch {
    return [];
  }
}

export async function searchEvidenceForClaims(
  claims: string[],
): Promise<Record<number, SearchEvidence[]>> {
  const results = await Promise.allSettled(
    claims.slice(0, 3).map(c => searchEvidence(c)),
  );
  const out: Record<number, SearchEvidence[]> = {};
  results.forEach((r, i) => {
    out[i] = r.status === "fulfilled" ? r.value : [];
  });
  return out;
}

export function formatEvidenceBlock(
  claims: string[],
  evidenceMap: Record<number, SearchEvidence[]>,
): string {
  const hasTavily = getEnv("TAVILY_API_KEY");
  if (!hasTavily) {
    return "[Stage 3 — Tavily 검색 비활성화: TAVILY_API_KEY 미설정. LLM 자체 지식으로만 판정합니다.]";
  }

  const blocks: string[] = ["[Stage 3 — Tavily 실시간 검색 결과]"];
  claims.slice(0, 3).forEach((claim, i) => {
    const evs = evidenceMap[i] ?? [];
    blocks.push(`\n주장 ${i + 1}: "${claim}"`);
    if (evs.length === 0) {
      blocks.push("  검색 결과 없음");
    } else {
      evs.forEach((e, j) => {
        blocks.push(`  [출처 ${j + 1}] ${e.title}`);
        blocks.push(`    URL: ${e.url}`);
        blocks.push(`    내용: ${e.snippet}`);
      });
    }
  });
  return blocks.join("\n");
}

export function extractEvidenceUrls(evidenceMap: Record<number, SearchEvidence[]>): string[] {
  const urls = new Set<string>();
  Object.values(evidenceMap).forEach(evs =>
    evs.slice(0, 2).forEach(e => { if (e.url) urls.add(e.url); }),
  );
  return [...urls].slice(0, 6);
}
