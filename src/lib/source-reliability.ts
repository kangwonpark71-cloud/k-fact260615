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
