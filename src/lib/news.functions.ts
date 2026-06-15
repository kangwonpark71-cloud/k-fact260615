import { createServerFn } from "@tanstack/react-start";

export type SourceType = "factcheck" | "news" | "government" | "naver";

export interface TrendingItem {
  id: string;
  title: string;
  link: string;
  pubDate: string;
  source: string;
  sourceType: SourceType;
  description?: string;
  score: number;
}

// ── 5분 in-memory 캐시 ──
let _cache: TrendingItem[] = [];
let _cacheTs = 0;
const CACHE_TTL = 5 * 60 * 1000;

// ── RSS 파싱 유틸 ──
function extractTag(xml: string, tag: string): string {
  const re = new RegExp(
    `<${tag}(?:\\s[^>]*)?>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`,
    "i",
  );
  const m = xml.match(re);
  if (!m) return "";
  return m[1]
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#039;/g, "'")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function stableId(link: string): string {
  let h = 5381;
  for (let i = 0; i < link.length; i++) h = ((h << 5) + h) ^ link.charCodeAt(i);
  return Math.abs(h).toString(36).slice(0, 10);
}

function parseRss(xml: string, sourceName: string, sourceType: SourceType, maxItems = 20): TrendingItem[] {
  const items: TrendingItem[] = [];
  const re = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null && items.length < maxItems) {
    const body = m[1];
    const title = extractTag(body, "title");
    const rawLink = extractTag(body, "link") || extractTag(body, "guid");
    if (!title || !rawLink) continue;
    const link = rawLink.startsWith("http") ? rawLink : "";
    if (!link) continue;
    const pubDate = extractTag(body, "pubDate") || extractTag(body, "dc:date") || "";
    const desc = extractTag(body, "description");
    items.push({
      id: stableId(link),
      title: title.slice(0, 120),
      link,
      pubDate,
      source: sourceName,
      sourceType,
      description: desc ? desc.slice(0, 200) : undefined,
      score: 0,
    });
  }
  return items;
}

async function fetchRss(
  url: string,
  sourceName: string,
  sourceType: SourceType,
  maxItems = 20,
): Promise<TrendingItem[]> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "KFactBot/1.0 (+https://kfact.kr)" },
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseRss(xml, sourceName, sourceType, maxItems);
  } catch {
    return [];
  }
}

// ── 네이버 뉴스 검색 API ──
async function fetchNaverNews(): Promise<TrendingItem[]> {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) return [];

  const queries = ["팩트체크", "사실확인"];
  const results: TrendingItem[] = [];
  try {
    for (const q of queries) {
      const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(q)}&display=15&sort=date`;
      const res = await fetch(url, {
        headers: {
          "X-Naver-Client-Id": clientId,
          "X-Naver-Client-Secret": clientSecret,
        },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) continue;
      const json = await res.json();
      for (const it of json.items ?? []) {
        const rawTitle = (it.title as string).replace(/<[^>]+>/g, "");
        const link = (it.originallink as string) || (it.link as string);
        if (!link) continue;
        results.push({
          id: stableId(link),
          title: rawTitle.slice(0, 120),
          link,
          pubDate: it.pubDate as string,
          source: "네이버 뉴스",
          sourceType: "naver",
          description: (it.description as string)?.replace(/<[^>]+>/g, "").slice(0, 200),
          score: 0,
        });
      }
    }
  } catch {
    // 네이버 API 실패 무시
  }
  return results;
}

// ── SNU 팩트체크 JSON API ──
async function fetchSnuFactcheck(): Promise<TrendingItem[]> {
  try {
    const res = await fetch("https://factcheck.snu.ac.kr/v2/facts?offset=0&limit=15", {
      headers: { "User-Agent": "KFactBot/1.0", Accept: "application/json" },
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return [];
    const json = await res.json();
    // 응답 구조가 { results: [...] } 또는 배열 형태
    const arr: any[] = Array.isArray(json) ? json : (json.results ?? json.facts ?? []);
    return arr
      .filter((it: any) => it && (it.title || it.factTitle))
      .map((it: any): TrendingItem => {
        const id = String(it.id ?? it.factId ?? Math.random());
        const link = it.url ?? `https://factcheck.snu.ac.kr/v2/facts/${id}`;
        return {
          id: stableId(link),
          title: (it.title ?? it.factTitle ?? "").slice(0, 120),
          link,
          pubDate: it.publishedAt ?? it.createdAt ?? "",
          source: "SNU 팩트체크",
          sourceType: "factcheck",
          description: (it.summary ?? it.content ?? "").slice(0, 200),
          score: 0,
        };
      });
  } catch {
    return [];
  }
}

// ── 인기도 스코어 계산 ──
function calcScore(item: TrendingItem): number {
  let score = 0;

  // 최신성 (24시간 = 50점 → 점감)
  if (item.pubDate) {
    const ageH = (Date.now() - new Date(item.pubDate).getTime()) / 3_600_000;
    score += Math.max(0, 50 - ageH * (50 / 48));
  }

  // 팩트체크/검증 키워드
  const factKws = ["팩트체크", "사실확인", "거짓", "허위", "오해", "진실", "검증", "확인결과", "사실일까", "주장", "논란"];
  for (const kw of factKws) {
    if (item.title.includes(kw)) { score += 12; break; }
  }

  // 소스 신뢰도
  const bonus: Record<SourceType, number> = {
    factcheck: 28,
    government: 22,
    naver: 16,
    news: 10,
  };
  score += bonus[item.sourceType];

  return Math.round(score);
}

// ── RSS 소스 목록 (실제 접근 가능 확인된 소스만) ──
const RSS_SOURCES: { url: string; name: string; type: SourceType; maxItems?: number }[] = [
  // 연합뉴스 (분야별)
  { url: "https://www.yna.co.kr/rss/politics.xml",  name: "연합뉴스", type: "news", maxItems: 15 },
  { url: "https://www.yna.co.kr/rss/society.xml",   name: "연합뉴스", type: "news", maxItems: 10 },
  { url: "https://www.yna.co.kr/rss/economy.xml",   name: "연합뉴스", type: "news", maxItems: 10 },
  // 뉴시스
  { url: "https://www.newsis.com/RSS/national.xml",  name: "뉴시스", type: "news", maxItems: 15 },
  { url: "https://www.newsis.com/RSS/politics.xml",  name: "뉴시스", type: "news", maxItems: 10 },
  { url: "https://www.newsis.com/RSS/society.xml",   name: "뉴시스", type: "news", maxItems: 10 },
  // 뉴스1
  { url: "https://www.news1.kr/rss/news_main.xml",   name: "뉴스1",  type: "news", maxItems: 15 },
  { url: "https://www.news1.kr/rss/politics.xml",    name: "뉴스1",  type: "news", maxItems: 10 },
  { url: "https://www.news1.kr/rss/society.xml",     name: "뉴스1",  type: "news", maxItems: 10 },
  // MBC 뉴스
  { url: "https://imnews.imbc.com/rss/news/news_00.xml",       name: "MBC 뉴스", type: "news", maxItems: 15 },
  { url: "https://imnews.imbc.com/rss/news/news_politics.xml", name: "MBC 뉴스", type: "news", maxItems: 10 },
  // 매일경제
  { url: "https://www.mk.co.kr/rss/40300001/",  name: "매일경제", type: "news", maxItems: 15 },
  { url: "https://www.mk.co.kr/rss/30000001/",  name: "매일경제", type: "news", maxItems: 10 },
  // 정부 공식 보도자료
  { url: "https://www.korea.kr/rss/policy.xml", name: "정책브리핑", type: "government", maxItems: 20 },
];

export const fetchTrendingNews = createServerFn({ method: "GET" }).handler(async () => {
  const now = Date.now();
  if (_cache.length > 0 && now - _cacheTs < CACHE_TTL) {
    return _cache;
  }

  const [rssAll, naverItems, snuItems] = await Promise.all([
    Promise.all(RSS_SOURCES.map((s) => fetchRss(s.url, s.name, s.type, s.maxItems))).then((r) => r.flat()),
    fetchNaverNews(),
    fetchSnuFactcheck(),
  ]);

  // SNU + 네이버 우선 배치 후 RSS 병합
  const merged = [...snuItems, ...naverItems, ...rssAll];

  // 링크 기준 중복 제거
  const seen = new Set<string>();
  const unique = merged.filter((it) => {
    const key = it.link.replace(/[?#].*$/, ""); // 쿼리스트링 제거 후 비교
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // 스코어 계산 → 정렬 → 상위 40개
  const scored = unique
    .map((it) => ({ ...it, score: calcScore(it) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 40);

  _cache = scored;
  _cacheTs = now;
  return scored;
});

// 캐시 강제 무효화 (새로고침 버튼용)
export const refreshTrendingNews = createServerFn({ method: "POST" }).handler(async () => {
  _cacheTs = 0;
  _cache = [];
  return { ok: true };
});
