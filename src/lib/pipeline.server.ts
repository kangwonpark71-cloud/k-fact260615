import { z } from "zod";
import { getEnv } from "./runtime-env.server";

// ══════════════════════════════════════════════════
//  Stage 1: 트랜스포머 기반 문체 분류 스키마
//  SemEval-2020 선동 기법 + LIWC 심리언어학 + NELA-GT
// ══════════════════════════════════════════════════

export const StyleClassificationSchema = z.object({
  fake_probability:  z.number().int().min(0).max(100).describe("허위정보 확률 0~100"),
  credibility_score: z.number().int().min(0).max(100).describe("신뢰도 점수 0~100"),
  style_category: z.enum([
    "사실보도",
    "의견/칼럼",
    "과장/클릭베이트",
    "여론조작/선동",
    "허위정보",
    "학술/공식문서",
  ]),
  tone: z.enum(["중립적", "감정적", "위협적", "설득적", "학술적", "선동적"]),
  propaganda_techniques: z.array(z.object({
    name:     z.string().max(50),
    evidence: z.string().max(150),
  })).max(6),
  signals: z.array(z.string().max(150)).max(8),
  linguistic_features: z.object({
    sentence_complexity:   z.number().int().min(0).max(100),
    vocabulary_richness:   z.number().int().min(0).max(100),
    argument_coherence:    z.number().int().min(0).max(100),
    source_attribution:    z.number().int().min(0).max(100),
    emotional_density:     z.number().int().min(0).max(100),
  }),
  deception_risk: z.object({
    emotional_manipulation: z.number().int().min(0).max(100),
    urgency_framing:        z.number().int().min(0).max(100),
    unverified_statistics:  z.number().int().min(0).max(100),
    polarizing_language:    z.number().int().min(0).max(100),
  }),
  reasoning: z.string().max(400),
});

export type StyleClassification = z.infer<typeof StyleClassificationSchema>;

export const STYLE_CLASSIFIER_SYSTEM = `당신은 어텐션 트랜스포머 기반 문체 분류 전문 AI입니다. 아래 NLP 연구 프레임워크를 적용하세요.

## 선동 기법 탐지 (SemEval-2020 Task 11 — Propaganda Techniques Corpus 기준)
탐지 대상 18개 기법 중 실제로 나타난 것만 보고하세요:
- **Loaded Language**: 강한 정서 반응 유발 어휘 (욕설·경멸·찬양 용어)
- **Name Calling/Labeling**: 레이블·경멸어로 적 규정 ("매국노", "좌빨", "친일")
- **Repetition**: 동일 주장 반복을 통한 각인
- **Exaggeration/Minimisation**: 사실의 과장 또는 의도적 축소
- **Appeal to Fear/Prejudice**: 공포·혐오·편견에 호소
- **Black-and-White Fallacy**: 이분법 세계관 강요 ("우리 편 아니면 적")
- **Bandwagon**: "모두가 안다" 식 다수 의견 편승
- **Appeal to Authority**: 비전문가를 권위자로 위장
- **Causal Oversimplification**: 복잡한 인과를 단일 원인으로 단순화
- **Whataboutism**: 논점 전환으로 비판 회피
- **Red Herring**: 무관 이슈로 주의 분산
- **Straw Man**: 상대 주장을 왜곡 후 반박
- **Thought-Terminating Cliché**: 비판적 사고를 막는 상투적 표현
- **False Urgency**: 허위 긴박감 조성 ("지금 당장", "오늘까지만")

## 언어학적 지표 (LIWC 심리언어학 + 담화 분석)
- **sentence_complexity** (0~100): 종속절 밀도·관계사 사용·평균 어절 수 기반
- **vocabulary_richness** (0~100): TTR(Type-Token Ratio) 기반 어휘 풍부도 (높을수록 좋음)
- **argument_coherence** (0~100): 전제→결론 구조 일관성·담화 결속성 (높을수록 좋음)
- **source_attribution** (0~100): "에 따르면"·"발표했" 등 출처 귀속 밀도 (높을수록 좋음)
- **emotional_density** (0~100): 감정 어휘 비율·극성 강도 (높을수록 감정적)

## 신뢰도 리스크 지표 (NELA-GT 기반)
- **emotional_manipulation** (0~100): 감정 조작 정도
- **urgency_framing** (0~100): 허위 긴박감 조성
- **unverified_statistics** (0~100): 출처 없는 수치·통계 사용 정도
- **polarizing_language** (0~100): 집단 분열·혐오 조장 언어

## 출력 규칙
- fake_probability: 0(완전한 사실보도)~100(명백한 허위정보)
- credibility_score: 0(신뢰불가)~100(완전신뢰) — 보통 fake_probability와 역상관
- propaganda_techniques: 실제로 탐지된 것만 나열, 없으면 반드시 빈 배열 []
- signals: 구체적 텍스트 근거 포함 한국어 문장, 없으면 빈 배열
- reasoning: 핵심 판단 근거 2~3문장 한국어
- 마크다운 없이 순수 JSON 객체만 반환`;

/** CF Workers AI 응답을 StyleClassification으로 변환 (graceful fallback) */
export function buildStyleFromCF(obj: Record<string, unknown>): StyleClassification {
  const n = (v: unknown) => { const x = Number(v); return isNaN(x) ? 50 : Math.min(100, Math.max(0, Math.round(x))); };
  const s = (v: unknown, max = 150) => (typeof v === "string" ? v : String(v ?? "")).slice(0, max);
  const CATS = ["사실보도","의견/칼럼","과장/클릭베이트","여론조작/선동","허위정보","학술/공식문서"] as const;
  const TONES = ["중립적","감정적","위협적","설득적","학술적","선동적"] as const;
  const cat = CATS.includes(obj.style_category as typeof CATS[number]) ? obj.style_category as typeof CATS[number] : "사실보도";
  const tone = TONES.includes(obj.tone as typeof TONES[number]) ? obj.tone as typeof TONES[number] : "중립적";
  const rawTech = Array.isArray(obj.propaganda_techniques) ? obj.propaganda_techniques : [];
  const techniques = rawTech.slice(0, 6).map((t: unknown) => {
    if (typeof t === "string") return { name: t.slice(0, 50), evidence: "" };
    if (t && typeof t === "object") {
      const o = t as Record<string, unknown>;
      return { name: s(o.name ?? o.technique ?? o.기법 ?? "", 50), evidence: s(o.evidence ?? o.근거 ?? "", 150) };
    }
    return { name: "", evidence: "" };
  }).filter(t => t.name);
  const rawSig = Array.isArray(obj.signals) ? obj.signals : [];
  const lf = (obj.linguistic_features && typeof obj.linguistic_features === "object") ? obj.linguistic_features as Record<string, unknown> : {};
  const dr = (obj.deception_risk && typeof obj.deception_risk === "object") ? obj.deception_risk as Record<string, unknown> : {};
  return {
    fake_probability: n(obj.fake_probability ?? obj.fakeProbability ?? 30),
    credibility_score: n(obj.credibility_score ?? obj.credibilityScore ?? 70),
    style_category: cat,
    tone,
    propaganda_techniques: techniques,
    signals: rawSig.slice(0, 8).map((x: unknown) => s(x)),
    linguistic_features: {
      sentence_complexity:   n(lf.sentence_complexity   ?? lf.sentenceComplexity   ?? 50),
      vocabulary_richness:   n(lf.vocabulary_richness   ?? lf.vocabularyRichness   ?? 50),
      argument_coherence:    n(lf.argument_coherence    ?? lf.argumentCoherence    ?? 50),
      source_attribution:    n(lf.source_attribution    ?? lf.sourceAttribution    ?? 30),
      emotional_density:     n(lf.emotional_density     ?? lf.emotionalDensity     ?? 30),
    },
    deception_risk: {
      emotional_manipulation: n(dr.emotional_manipulation ?? dr.emotionalManipulation ?? 20),
      urgency_framing:        n(dr.urgency_framing        ?? dr.urgencyFraming        ?? 20),
      unverified_statistics:  n(dr.unverified_statistics  ?? dr.unverifiedStatistics  ?? 20),
      polarizing_language:    n(dr.polarizing_language    ?? dr.polarizingLanguage    ?? 20),
    },
    reasoning: s(obj.reasoning ?? obj.reason ?? "", 400),
  };
}

// ══════════════════════════════════════════════════
//  Stage 1 (레거시): 정규식 휴리스틱 — Phase 1 프롬프트 초기 컨텍스트용
//  LIAR Dataset / FakeNewsNet 학습 패턴 기반
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
  const { metrics: m, fakeProbability, signals = [] } = analysis;
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

export async function searchEvidence(
  claim: string,
  options?: { includeDomains?: string[]; searchDepth?: "basic" | "advanced"; maxResults?: number },
): Promise<SearchEvidence[]> {
  const apiKey = getEnv("TAVILY_API_KEY");
  if (!apiKey) return [];

  const includeDomains = options?.includeDomains ?? [];
  const searchDepth = options?.searchDepth ?? "advanced";
  const maxResults = options?.maxResults ?? 5;

  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query: claim,
        max_results: maxResults,
        search_depth: searchDepth,
        include_answer: false,
        include_raw_content: false,
        include_domains: includeDomains,
        exclude_domains: [],
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const data = await res.json() as {
      results?: Array<{ title: string; url: string; content: string; score: number }>;
    };
    return (data.results ?? []).slice(0, maxResults).map(r => ({
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
  claims.slice(0, 5).forEach((claim, i) => {
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

// ══════════════════════════════════════════════════
//  주장 유형 분류 및 권위 출처 우선 랭킹
//  CLASSIFY_PROMPT + AUTHORITATIVE_SOURCES 구현
// ══════════════════════════════════════════════════

export type ClaimType = "EMPIRICAL" | "DISPUTED_TERRITORY" | "OPINION" | "DOMESTIC_LAW_FACT";

export const AUTHORITATIVE_DOMAINS: Record<string, string[]> = {
  territorial: [
    "mofa.go.kr", "korea.kr", "un.org", "icj-cij.org",
    "mois.go.kr", "assembly.go.kr", "president.go.kr",
  ],
  medical: [
    "who.int", "nih.gov", "kdca.go.kr", "mohw.go.kr",
    "pubmed.ncbi.nlm.nih.gov", "nejm.org", "thelancet.com",
  ],
  economic: [
    "bok.or.kr", "kostat.go.kr", "imf.org", "worldbank.org",
    "moef.go.kr", "kdi.re.kr", "oecd.org",
  ],
  legal: [
    "law.go.kr", "court.go.kr", "moleg.go.kr",
    "un.org", "treaties.un.org", "icj-cij.org",
  ],
  general: [
    "reuters.com", "apnews.com", "yna.co.kr",
    "yonhapnewsagency.com", "bbc.com", "kbs.co.kr",
  ],
};

const CLAIM_TYPE_DOMAINS: Record<ClaimType, string[]> = {
  DISPUTED_TERRITORY: AUTHORITATIVE_DOMAINS.territorial,
  DOMESTIC_LAW_FACT:  AUTHORITATIVE_DOMAINS.legal,
  EMPIRICAL:          AUTHORITATIVE_DOMAINS.general,
  OPINION:            [],
};

/** 권위 출처 도메인을 상위로 정렬 — FACT_CHECK_PROMPT_V2 rankSearchResults 구현 */
export function rankSearchResults(
  results: SearchEvidence[],
  claimType: ClaimType,
): SearchEvidence[] {
  const priority = CLAIM_TYPE_DOMAINS[claimType] ?? [];
  if (priority.length === 0) return results;
  return [...results].sort((a, b) => {
    const aP = priority.some(d => a.url.includes(d)) ? 0 : 1;
    const bP = priority.some(d => b.url.includes(d)) ? 0 : 1;
    return aP - bP;
  });
}

// 도메인 특화 검색 — 주장 유형 + 키워드로 권위 출처 필터링
const DOMAIN_RULES: Array<{
  keywords: RegExp;
  domains: string[];
}> = [
  { keywords: /통계|인구|출생|사망|고용|실업|물가|gdp|성장률|수출|수입|무역|경제지표|부채|재정/i,  domains: ["kostat.go.kr", "bok.or.kr", "moef.go.kr", "kdi.re.kr", "index.go.kr"] },
  { keywords: /법|법률|법원|판결|헌법|국회|조례|규정|처벌|형사|민사|소송|법령/i,               domains: ["law.go.kr", "moleg.go.kr", "court.go.kr", "assembly.go.kr"] },
  { keywords: /백신|감염|코로나|바이러스|질병|보건|의료|암|당뇨|고혈압|약물|임상|치료/i,         domains: ["kdca.go.kr", "mohw.go.kr", "who.int", "pubmed.ncbi.nlm.nih.gov"] },
  { keywords: /역사|전쟁|독립|조선|일제|고려|삼국|임진|항일|해방|분단|6·25|한국전쟁/i,         domains: ["encykorea.aks.ac.kr", "museum.go.kr", "history.go.kr"] },
  { keywords: /환경|기후|탄소|온실|미세먼지|대기|수질|토양|에너지|원전|재생에너지/i,            domains: ["me.go.kr", "nier.go.kr", "data.kma.go.kr", "iea.org"] },
  { keywords: /교육|대학|입시|수능|학교|학생|교사|학력|학비/i,                              domains: ["moe.go.kr", "kedi.re.kr", "neis.go.kr"] },
  { keywords: /부동산|아파트|주택|전세|월세|청약|분양|토지/i,                               domains: ["molit.go.kr", "reb.or.kr", "r-one.co.kr"] },
  { keywords: /금리|환율|주가|코스피|코스닥|달러|엔화|유로|한국은행|기준금리/i,                 domains: ["bok.or.kr", "krx.co.kr", "fss.or.kr"] },
];

function getTopicDomains(query: string): string[] {
  for (const rule of DOMAIN_RULES) {
    if (rule.keywords.test(query)) return rule.domains;
  }
  return [];
}

/** 주장 유형별 권위 출처 우선 검색 */
export async function searchEvidenceForClaimsTyped(
  claims: Array<{ query: string; claimType: ClaimType }>,
  options?: { searchDepth?: "basic" | "advanced"; maxPerClaim?: number },
): Promise<Record<number, SearchEvidence[]>> {
  const depth = options?.searchDepth ?? "advanced";
  const max = options?.maxPerClaim ?? 5;

  const results = await Promise.allSettled(
    claims.slice(0, 5).map(({ query, claimType }) => {
      // 주장 유형별 기본 도메인 + 키워드 기반 도메인 합산
      const typeDomains = CLAIM_TYPE_DOMAINS[claimType] ?? [];
      const topicDomains = getTopicDomains(query);
      const includeDomains = [...new Set([...topicDomains, ...typeDomains])].slice(0, 8);

      return searchEvidence(query, { includeDomains, searchDepth: depth, maxResults: max })
        .then(r => rankSearchResults(r, claimType));
    }),
  );
  const out: Record<number, SearchEvidence[]> = {};
  results.forEach((r, i) => {
    out[i] = r.status === "fulfilled" ? r.value : [];
  });
  return out;
}
