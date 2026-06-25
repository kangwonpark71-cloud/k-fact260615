/* ── 언론사 정치 성향 분류 ── */
export type PoliticalLean =
  | "보수"
  | "중도보수"
  | "중립"
  | "중도진보"
  | "진보"
  | "전문지"
  | "해외"
  | "커뮤니티"
  | "공식기관";

export const POLITICAL_LEAN_META: Record<PoliticalLean, { label: string; color: string }> = {
  보수:     { label: "보수 성향",   color: "#ef4444" },
  중도보수: { label: "중도보수",    color: "#f97316" },
  중립:     { label: "중립·팩트",  color: "#6b7280" },
  중도진보: { label: "중도진보",    color: "#3b82f6" },
  진보:     { label: "진보 성향",  color: "#8b5cf6" },
  전문지:   { label: "전문·학술지", color: "#10b981" },
  해외:     { label: "해외 언론",  color: "#0ea5e9" },
  커뮤니티: { label: "커뮤니티",   color: "#a3a3a3" },
  공식기관: { label: "공식 기관",  color: "#22c55e" },
};

// 도메인 → 정치 성향 매핑 (200개 주요 도메인)
const LEAN_MAP: Record<string, PoliticalLean> = {
  // ── 보수 ──
  "chosun.com": "보수", "donga.com": "보수", "joongang.co.kr": "보수",
  "joins.com": "보수", "mk.co.kr": "보수", "hankyung.com": "보수",
  "munhwa.com": "보수", "segye.com": "보수", "pennmike.com": "보수",
  "newdaily.co.kr": "보수", "mediawatch.kr": "보수",
  // ── 중도보수 ──
  "hankookilbo.com": "중도보수", "yna.co.kr": "중도보수",
  "news1.kr": "중도보수", "newsis.com": "중도보수",
  "edaily.co.kr": "중도보수", "sedaily.com": "중도보수",
  "mt.co.kr": "중도보수",
  // ── 중립 ──
  "ytn.co.kr": "중립", "kbs.co.kr": "중립", "mbc.co.kr": "중립",
  "sbs.co.kr": "중립", "jtbc.joins.com": "중립", "jtbc.co.kr": "중립",
  "tbs.seoul.kr": "중립", "cbsnews.co.kr": "중립",
  "factcheck.snu.ac.kr": "중립", "newstof.com": "중립", "korea.kr": "중립",
  // ── 중도진보 ──
  "hani.co.kr": "중도진보", "kyunghyang.com": "중도진보",
  "ohmynews.com": "중도진보", "pressian.com": "중도진보",
  "mediatoday.co.kr": "중도진보", "sisain.co.kr": "중도진보",
  "mindlenews.com": "중도진보",
  // ── 진보 ──
  "vop.co.kr": "진보", "labortoday.co.kr": "진보",
  "mynewskorea.com": "진보", "viewsnnews.com": "진보",
  // ── 전문지 ──
  "biz.chosun.com": "전문지", "econovill.com": "전문지",
  "khan.co.kr": "중도진보", "fnnews.com": "전문지",
  "etnews.com": "전문지", "zdnet.co.kr": "전문지",
  "itchosun.com": "전문지", "boannews.com": "전문지",
  "medicalnewstoday.com": "전문지", "pubmed.ncbi.nlm.nih.gov": "전문지",
  "nature.com": "전문지", "sciencedirect.com": "전문지",
  // ── 해외 ──
  "reuters.com": "해외", "apnews.com": "해외", "bbc.com": "해외",
  "nytimes.com": "해외", "cnn.com": "해외", "theguardian.com": "해외",
  "bloomberg.com": "해외", "wsj.com": "해외", "ft.com": "해외",
  "aljazeera.com": "해외", "afp.com": "해외", "nikkei.com": "해외",
  "nhk.or.jp": "해외",
  // ── 커뮤니티 ──
  "dcinside.com": "커뮤니티", "fmkorea.com": "커뮤니티",
  "ruliweb.com": "커뮤니티", "reddit.com": "커뮤니티",
  "x.com": "커뮤니티", "twitter.com": "커뮤니티",
  "youtube.com": "커뮤니티", "facebook.com": "커뮤니티",
  "naver.com": "커뮤니티", "daum.net": "커뮤니티",
  // ── 공식기관 ──
  "go.kr": "공식기관", "korea.kr": "공식기관", "law.go.kr": "공식기관",
  "court.go.kr": "공식기관", "assembly.go.kr": "공식기관",
  "mofa.go.kr": "공식기관", "who.int": "공식기관", "nih.gov": "공식기관",
  "cdc.gov": "공식기관", "oecd.org": "공식기관", "imf.org": "공식기관",
  "un.org": "공식기관", "stat.go.kr": "공식기관",
};

export function getPoliticalLean(url: string): PoliticalLean | null {
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    if (LEAN_MAP[hostname]) return LEAN_MAP[hostname];
    // suffix match (e.g. sub.chosun.com)
    for (const [domain, lean] of Object.entries(LEAN_MAP)) {
      if (hostname.endsWith(`.${domain}`) || hostname.endsWith(domain)) return lean;
    }
    return null;
  } catch {
    return null;
  }
}

export const SOURCE_RELIABILITY_TIERS = [
  "authoritative",
  "established",
  "standard",
  "weak",
  "unknown",
] as const;

export type SourceReliabilityTier = (typeof SOURCE_RELIABILITY_TIERS)[number];

export type SourceReliability = {
  readonly hostname: string;
  readonly score: number;
  readonly tier: SourceReliabilityTier;
  readonly label: string;
  readonly reasons: readonly string[];
};

export type SourceReliabilityInput = {
  readonly url: string;
  readonly searchScore?: number;
};

type SourceRule = {
  readonly domains: readonly string[];
  readonly baseScore: number;
  readonly tier: Exclude<SourceReliabilityTier, "unknown">;
  readonly label: string;
  readonly reason: string;
  readonly maxScore: number;
};

const SOURCE_RULES: readonly SourceRule[] = [
  {
    domains: ["go.kr", "korea.kr", "law.go.kr", "court.go.kr", "assembly.go.kr", "mofa.go.kr"],
    baseScore: 92,
    tier: "authoritative",
    label: "공식 기관",
    reason: "정부·공공기관 공식 출처",
    maxScore: 99,
  },
  {
    domains: ["who.int", "nih.gov", "cdc.gov", "pubmed.ncbi.nlm.nih.gov", "oecd.org", "imf.org"],
    baseScore: 88,
    tier: "authoritative",
    label: "국제·학술 기관",
    reason: "국제기구·학술 데이터 출처",
    maxScore: 97,
  },
  {
    domains: ["factcheck.snu.ac.kr", "reuters.com", "apnews.com", "bbc.com", "yna.co.kr"],
    baseScore: 74,
    tier: "established",
    label: "검증 언론",
    reason: "검증 이력이 있는 언론·팩트체크 출처",
    maxScore: 86,
  },
  {
    domains: ["youtube.com", "youtu.be", "x.com", "twitter.com", "facebook.com"],
    baseScore: 42,
    tier: "weak",
    label: "플랫폼 출처",
    reason: "원문 맥락 확인이 필요한 플랫폼 출처",
    maxScore: 58,
  },
  {
    domains: ["dcinside.com", "fmkorea.com", "ruliweb.com", "reddit.com"],
    baseScore: 35,
    tier: "weak",
    label: "커뮤니티",
    reason: "작성자·근거 검증이 제한적인 커뮤니티 출처",
    maxScore: 48,
  },
] as const;

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function searchBoost(searchScore: number | undefined): number {
  if (typeof searchScore !== "number" || !Number.isFinite(searchScore)) return 0;
  return clamp(searchScore * 12, 0, 12);
}

function matchesDomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`) || hostname.endsWith(domain);
}

function findRule(hostname: string): SourceRule | null {
  return (
    SOURCE_RULES.find((rule) => rule.domains.some((domain) => matchesDomain(hostname, domain))) ??
    null
  );
}

export function scoreSourceReliability(input: SourceReliabilityInput): SourceReliability {
  let hostname = "unknown";
  try {
    hostname = normalizeHostname(new URL(input.url).hostname);
  } catch {
    return {
      hostname,
      score: clamp(25 + searchBoost(input.searchScore), 0, 40),
      tier: "unknown",
      label: "출처 확인 불가",
      reasons: ["URL 형식을 해석할 수 없음"],
    };
  }

  const rule = findRule(hostname);
  if (!rule) {
    return {
      hostname,
      score: clamp(55 + searchBoost(input.searchScore), 45, 68),
      tier: "standard",
      label: "일반 웹 출처",
      reasons: ["도메인 신뢰도 분류 미등록", "본문·원출처 교차 확인 필요"],
    };
  }

  return {
    hostname,
    score: clamp(rule.baseScore + searchBoost(input.searchScore), 0, rule.maxScore),
    tier: rule.tier,
    label: rule.label,
    reasons: [rule.reason],
  };
}
