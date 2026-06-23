import { getEnv } from "./runtime-env.server";

// ─────────────────────────────────────────────────────────────────────────────
//  한국 공공 통계 API 연동
//  · 한국은행 ECOS — 기준금리·환율·GDP (sample 키로도 실제 데이터 반환)
//  · KOSIS (통계청) — statisticsSearch.do로 관련 통계 참조 제공
// ─────────────────────────────────────────────────────────────────────────────

export interface PublicStatResult {
  source: string;
  indicator: string;
  value: string; // 실제 수치 (ECOS) 또는 빈 문자열 (KOSIS 참조)
  unit: string;
  period: string;
  url: string;
  isReference?: boolean; // true = 수치 없이 참조 링크만
}

// ── 주제 감지 ─────────────────────────────────────────────────────────────────

export type StatTopic =
  | "interest_rate"
  | "exchange_rate"
  | "gdp"
  | "employment"
  | "price"
  | "population"
  | "trade"
  | "real_estate"
  | "stock"
  | "national_debt";

const STAT_PATTERNS: Array<{ pattern: RegExp; topic: StatTopic }> = [
  { pattern: /기준금리|금리|이자율|한국은행|통화정책|대출금리/, topic: "interest_rate" },
  { pattern: /환율|달러|엔화|유로|원달러|위안화/, topic: "exchange_rate" },
  { pattern: /gdp|경제성장률|국내총생산|성장률/i, topic: "gdp" },
  { pattern: /실업률|고용률|취업자|실업자|일자리|경제활동인구/, topic: "employment" },
  { pattern: /물가|소비자물가|cpi|인플레|물가상승률|물가지수/i, topic: "price" },
  { pattern: /인구|출생률|사망률|출산율|합계출산율|고령화|저출산/, topic: "population" },
  { pattern: /수출|수입|무역수지|경상수지|무역액|무역흑자|무역적자/, topic: "trade" },
  { pattern: /주택가격|아파트|부동산|전세가|매매가|집값/, topic: "real_estate" },
  { pattern: /코스피|코스닥|주가지수|증시/, topic: "stock" },
  { pattern: /국가부채|정부부채|재정적자|국채|부채비율/, topic: "national_debt" },
];

export function detectStatTopics(text: string): StatTopic[] {
  const topics = new Set<StatTopic>();
  for (const { pattern, topic } of STAT_PATTERNS) {
    if (pattern.test(text)) topics.add(topic);
  }
  return [...topics].slice(0, 3);
}

// ── 한국은행 ECOS API ─────────────────────────────────────────────────────────
// https://ecos.bok.or.kr/api/
// sample 키: 개발·데모용 (실제 최신 데이터 반환)
// 발급 후: https://ecos.bok.or.kr/api/#/DevGuide/APIKey

const ECOS_INDICATORS: Partial<
  Record<
    StatTopic,
    {
      statCode: string;
      cycle: string;
      itemCode: string;
      label: string;
      unit: string;
    }
  >
> = {
  interest_rate: {
    statCode: "722Y001",
    cycle: "M",
    itemCode: "0101000",
    label: "한국은행 기준금리",
    unit: "연%",
  },
  exchange_rate: {
    statCode: "731Y001",
    cycle: "M",
    itemCode: "0000001",
    label: "원달러 환율(매매기준율)",
    unit: "원",
  },
  gdp: { statCode: "200Y001", cycle: "Y", itemCode: "10101", label: "실질GDP 성장률", unit: "%" },
};

async function fetchEcos(topic: StatTopic): Promise<PublicStatResult | null> {
  const info = ECOS_INDICATORS[topic];
  if (!info) return null;

  // 등록된 키 우선, 없으면 sample 키 사용
  const apiKey = getEnv("ECOS_API_KEY") || "sample";

  try {
    // 최근 6개월 또는 3년치 조회
    const now = new Date();
    const isMonthly = info.cycle === "M";
    let startPrd: string;
    let endPrd: string;

    if (isMonthly) {
      const end = new Date(now.getFullYear(), now.getMonth(), 1);
      const start = new Date(end);
      start.setMonth(start.getMonth() - 6);
      const fmt = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
      startPrd = fmt(start);
      endPrd = fmt(end);
    } else {
      startPrd = String(now.getFullYear() - 2);
      endPrd = String(now.getFullYear());
    }

    const url = `https://ecos.bok.or.kr/api/StatisticSearch/${apiKey}/json/kr/1/6/${info.statCode}/${info.cycle}/${startPrd}/${endPrd}/${info.itemCode}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!res.ok) return null;

    const data = (await res.json()) as {
      StatisticSearch?: { row?: Array<{ TIME?: string; DATA_VALUE?: string; UNIT_NAME?: string }> };
    };
    const rows = data.StatisticSearch?.row ?? [];
    if (rows.length === 0) return null;

    const latest = rows[rows.length - 1];
    const value = String(latest.DATA_VALUE ?? "")
      .replace(/연%/, "")
      .trim();
    const unit = latest.UNIT_NAME ?? info.unit;
    const period = String(latest.TIME ?? "");

    if (!value) return null;

    return {
      source: "한국은행 ECOS",
      indicator: info.label,
      value,
      unit: unit.replace(/연%/, "%"),
      period: isMonthly ? `${period.slice(0, 4)}년 ${period.slice(4)}월` : `${period}년`,
      url: "https://ecos.bok.or.kr",
    };
  } catch {
    return null;
  }
}

// ── KOSIS 통계청 — 검색 기반 참조 ────────────────────────────────────────────
// statisticsSearch.do: 별도 서비스 등록 없이 목록·참조 조회 가능
// (statisticsData.do는 별도 자료조회 서비스 등록 필요)

const KOSIS_SEARCH_MAP: Partial<Record<StatTopic, { query: string; label: string }>> = {
  employment: { query: "경제활동인구 실업률 고용률", label: "고용률·실업률" },
  price: { query: "소비자물가지수 CPI", label: "소비자물가지수" },
  population: { query: "합계출산율 인구동향", label: "합계출산율" },
  trade: { query: "수출입 무역수지", label: "수출입 현황" },
  real_estate: { query: "주택매매가격지수", label: "주택가격지수" },
  national_debt: { query: "국가채무 재정수지", label: "국가채무" },
};

async function fetchKosisReference(topic: StatTopic): Promise<PublicStatResult | null> {
  const apiKey = getEnv("KOSIS_API_KEY");
  if (!apiKey) return null;

  const info = KOSIS_SEARCH_MAP[topic];
  if (!info) return null;

  try {
    const encoded = encodeURIComponent(info.query);
    const url = `https://kosis.kr/openapi/statisticsSearch.do?method=getList&apiKey=${apiKey}&searchNm=${encoded}&format=json&jsonVD=Y&resultCount=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;

    const data = (await res.json()) as Array<{
      TBL_NM?: string;
      ORG_NM?: string;
      END_PRD_DE?: string;
      LINK_URL?: string;
    }>;
    if (!Array.isArray(data) || data.length === 0) return null;

    const item = data[0];
    const tableName = item.TBL_NM ?? info.label;
    const orgName = item.ORG_NM ?? "통계청";
    const period = item.END_PRD_DE ? `${item.END_PRD_DE}까지` : "최신";

    return {
      source: `${orgName} KOSIS`,
      indicator: `${info.label} (${tableName})`,
      value: "",
      unit: "",
      period,
      url: item.LINK_URL ?? "https://kosis.kr",
      isReference: true,
    };
  } catch {
    return null;
  }
}

// ── 통합 조회 ─────────────────────────────────────────────────────────────────

export async function fetchPublicDataForClaims(text: string): Promise<PublicStatResult[]> {
  const topics = detectStatTopics(text);
  if (topics.length === 0) return [];

  const fetchers = topics.flatMap((topic) => [fetchEcos(topic), fetchKosisReference(topic)]);

  const results = await Promise.allSettled(fetchers);
  return results
    .filter((r): r is PromiseFulfilledResult<PublicStatResult | null> => r.status === "fulfilled")
    .map((r) => r.value)
    .filter((r): r is PublicStatResult => r !== null);
}

// ── 프롬프트 블록 ─────────────────────────────────────────────────────────────

export function formatPublicDataBlock(stats: PublicStatResult[]): string {
  if (stats.length === 0) return "";

  const concreteStats = stats.filter((s) => !s.isReference && s.value);
  const references = stats.filter((s) => s.isReference);

  const lines: string[] = [
    "\n[공공 통계 데이터 — 정부·중앙은행 공식 수치]",
    "아래 데이터를 통계·금융 관련 주장 판정의 근거로 반드시 활용하세요.",
    "",
  ];

  if (concreteStats.length > 0) {
    lines.push("■ 실제 수치:");
    for (const s of concreteStats) {
      lines.push(`  • ${s.indicator} (${s.period}): ${s.value}${s.unit} [출처: ${s.source}]`);
    }
  }

  if (references.length > 0) {
    lines.push("■ 통계 참조 (최신 수치는 링크 확인):");
    for (const r of references) {
      lines.push(`  • ${r.indicator} — ${r.period} [출처: ${r.source}]`);
    }
  }

  return lines.join("\n");
}
