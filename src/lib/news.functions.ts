import { createServerFn } from "@tanstack/react-start";
import { getEnv, getCfBinding } from "./runtime-env.server";

export type SourceType =
  | "factcheck"
  | "news"
  | "government"
  | "naver"
  | "youtube"
  | "community"
  | "social";

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

// ── KV 캐시 인터페이스 (CF Workers KV) ──
interface KVBinding {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}
const KV_KEY = "trending-news-v1";
function getNewsKV(): KVBinding | null { return getCfBinding<KVBinding>("NEWS_CACHE"); }

// ── 인메모리 폴백 캐시 (KV 없는 환경용) ──
let _cache: TrendingItem[] = [];
let _cacheTs = 0;

function getLastScheduledTs(): number {
  const nowUtc = Date.now();
  const kstMs = 9 * 3600000;
  const nowKST = new Date(nowUtc + kstMs);
  const h = nowKST.getUTCHours();
  const base = new Date(nowKST);
  base.setUTCMinutes(0, 0, 0);

  let lastKST: Date;
  if (h < 9) {
    lastKST = new Date(base);
    lastKST.setUTCDate(lastKST.getUTCDate() - 1);
    lastKST.setUTCHours(14);
  } else if (h < 14) {
    lastKST = new Date(base);
    lastKST.setUTCHours(9);
  } else {
    lastKST = new Date(base);
    lastKST.setUTCHours(14);
  }
  return lastKST.getTime() - kstMs; // UTC 타임스탬프로 변환
}

function isCacheValid(): boolean {
  return _cache.length > 0 && _cacheTs >= getLastScheduledTs();
}

// ── 공통 유틸 ──
function stableId(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return Math.abs(h).toString(36).slice(0, 10);
}

function extractTag(xml: string, tag: string): string {
  const re = new RegExp(
    `<${tag}(?:\\s[^>]*)?>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, "i",
  );
  const m = xml.match(re);
  if (!m) return "";
  return m[1]
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"').replace(/&#39;|&#039;/g, "'")
    .replace(/<[^>]+>/g, "").trim();
}

function parseRss(xml: string, sourceName: string, sourceType: SourceType, max = 10): TrendingItem[] {
  const items: TrendingItem[] = [];
  const re = /<(?:item|entry)[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null && items.length < max) {
    const body = m[1];
    const title = extractTag(body, "title");
    const rawLink =
      extractTag(body, "link") ||
      (body.match(/<link[^>]+href="([^"]+)"/i)?.[1] ?? "") ||
      extractTag(body, "guid");
    if (!title || !rawLink) continue;
    const link = rawLink.startsWith("http") ? rawLink : "";
    if (!link) continue;
    const pubDate =
      extractTag(body, "pubDate") ||
      extractTag(body, "published") ||
      extractTag(body, "updated") ||
      extractTag(body, "dc:date") || "";
    items.push({
      id: stableId(link),
      title: title.slice(0, 120),
      link,
      pubDate,
      source: sourceName,
      sourceType,
      description: extractTag(body, "description").slice(0, 200) || undefined,
      score: 0,
    });
  }
  return items;
}

async function safeRss(url: string, name: string, type: SourceType, max = 10): Promise<TrendingItem[]> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 KFactBot/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    return parseRss(await res.text(), name, type, max);
  } catch { return []; }
}

// ── 네이버 뉴스 API ──
async function fetchNaverNews(): Promise<TrendingItem[]> {
  const clientId = getEnv("NAVER_CLIENT_ID");
  const clientSecret = getEnv("NAVER_CLIENT_SECRET");
  if (!clientId || !clientSecret) return [];
  const results: TrendingItem[] = [];
  for (const q of ["팩트체크", "사실확인"]) {
    try {
      const res = await fetch(
        `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(q)}&display=10&sort=date`,
        { headers: { "X-Naver-Client-Id": clientId, "X-Naver-Client-Secret": clientSecret }, signal: AbortSignal.timeout(5000) },
      );
      if (!res.ok) continue;
      const json = await res.json() as { items?: any[] };
      for (const it of json.items ?? []) {
        const link = (it.originallink as string) || (it.link as string);
        if (!link) continue;
        results.push({
          id: stableId(link),
          title: (it.title as string).replace(/<[^>]+>/g, "").slice(0, 120),
          link,
          pubDate: it.pubDate as string,
          source: "네이버 뉴스",
          sourceType: "naver",
          description: (it.description as string)?.replace(/<[^>]+>/g, "").slice(0, 200),
          score: 0,
        });
      }
    } catch { /**/ }
  }
  return results;
}

// ── SNU 팩트체크 ──
async function fetchSnuFactcheck(): Promise<TrendingItem[]> {
  try {
    const res = await fetch("https://factcheck.snu.ac.kr/v2/facts?offset=0&limit=10", {
      headers: { "User-Agent": "KFactBot/1.0", Accept: "application/json" },
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return [];
    const json = await res.json() as any;
    const arr: any[] = Array.isArray(json) ? json : (json.results ?? json.facts ?? []);
    return arr.filter((it: any) => it?.title || it?.factTitle).slice(0, 10).map((it: any): TrendingItem => {
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
  } catch { return []; }
}

// ── YouTube ──
async function fetchYouTube(): Promise<TrendingItem[]> {
  const apiKey = getEnv("YOUTUBE_API_KEY");
  const items: TrendingItem[] = [];

  // API 키 있을 때: 한국 인기 뉴스/정치 동영상
  if (apiKey) {
    try {
      const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&chart=mostPopular&regionCode=KR&videoCategoryId=25&maxResults=10&key=${apiKey}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const json = await res.json() as { items?: any[] };
        for (const v of json.items ?? []) {
          const videoId = v.id as string;
          const link = `https://www.youtube.com/watch?v=${videoId}`;
          items.push({
            id: stableId(link),
            title: (v.snippet?.title ?? "").slice(0, 120),
            link,
            pubDate: v.snippet?.publishedAt ?? "",
            source: v.snippet?.channelTitle ?? "YouTube",
            sourceType: "youtube",
            description: v.snippet?.description?.slice(0, 200),
            score: 0,
          });
        }
        if (items.length >= 10) return items;
      }
    } catch { /**/ }
  }

  // 폴백: 주요 한국 뉴스 채널 RSS
  const channels = [
    { id: "UCcQTRi69dsVYHN3exePtZ1A", name: "KBS뉴스" },
    { id: "UCF4Wxdo3inmxP-Y59wXDsFw", name: "MBC뉴스" },
    { id: "UCSVpUaLXnDqQa5P4Ls0eGhA", name: "JTBC뉴스" },
    { id: "UCmE1-5K6Py91tPFUHkZ-PCA", name: "연합뉴스TV" },
    { id: "UCut9nQ-T2VJSG2MaJTnhNRA", name: "YTN" },
  ];
  const rssResults = await Promise.all(
    channels.map((ch) =>
      safeRss(
        `https://www.youtube.com/feeds/videos.xml?channel_id=${ch.id}`,
        ch.name, "youtube", 3,
      ),
    ),
  );
  const merged = rssResults.flat().slice(0, 10);
  items.push(...merged.filter((r) => !items.some((e) => e.id === r.id)));
  return items.slice(0, 10);
}

// ── DC인사이드 ──
async function fetchDCInside(): Promise<TrendingItem[]> {
  const targets = [
    { url: "https://gall.dcinside.com/board/lists/?id=dcbest&page=1", name: "DC인사이드 베스트" },
    { url: "https://gall.dcinside.com/board/lists/?id=hit&page=1", name: "DC인사이드 힛갤" },
  ];
  const items: TrendingItem[] = [];

  for (const { url, name } of targets) {
    if (items.length >= 10) break;
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "text/html,application/xhtml+xml",
          "Accept-Language": "ko-KR,ko;q=0.9",
          "Referer": "https://www.dcinside.com/",
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const html = await res.text();

      // 제목과 링크 파싱: <a href="/board/view/..." class="ub-word">TITLE</a>
      const re = /<a[^>]+href="(\/board\/view\/[^"]+)"[^>]*class="[^"]*ub-word[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(html)) !== null && items.length < 10) {
        const href = m[1];
        const rawTitle = m[2].replace(/<[^>]+>/g, "").trim();
        if (!rawTitle || rawTitle.length < 3) continue;
        const link = `https://gall.dcinside.com${href}`;
        if (items.some((it) => it.id === stableId(link))) continue;
        items.push({
          id: stableId(link),
          title: rawTitle.slice(0, 120),
          link,
          pubDate: new Date().toISOString(),
          source: name,
          sourceType: "community",
          score: 0,
        });
      }
    } catch { /**/ }
  }
  return items.slice(0, 10);
}

// ── FM코리아 ──
async function fetchFMKorea(): Promise<TrendingItem[]> {
  // RSS 시도
  const rss = await safeRss("https://www.fmkorea.com/rss", "FM코리아", "community", 10);
  if (rss.length >= 3) return rss.slice(0, 10);

  // HTML 스크래핑 폴백
  try {
    const res = await fetch("https://www.fmkorea.com/best", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html",
        "Accept-Language": "ko-KR,ko;q=0.9",
        "Referer": "https://www.fmkorea.com/",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const items: TrendingItem[] = [];

    // FM코리아 게시물 링크 패턴: href="/숫자" 또는 href="/best/숫자"
    const re = /<a[^>]+href="(\/\d+|\/best\/\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null && items.length < 10) {
      const href = m[1];
      const rawTitle = m[2].replace(/<[^>]+>/g, "").trim();
      if (!rawTitle || rawTitle.length < 5) continue;
      const link = `https://www.fmkorea.com${href}`;
      if (items.some((it) => it.id === stableId(link))) continue;
      items.push({
        id: stableId(link),
        title: rawTitle.slice(0, 120),
        link,
        pubDate: new Date().toISOString(),
        source: "FM코리아",
        sourceType: "community",
        score: 0,
      });
    }
    return items.slice(0, 10);
  } catch { return []; }
}

// ── 일간베스트 ──
async function fetchIlbeBest(): Promise<TrendingItem[]> {
  // 일베는 공식 RSS 없음 → HTML 스크래핑 (여러 패턴 시도)
  const targets = [
    { url: "https://www.ilbe.com/list/ilbe?listStyle=list&isAdmin=0&page=1", pattern: /href="(\/view\/\d+[^"]*)"[^>]*[^<]*<[^>]+>[^<]*<\/[^>]+>\s*([\s\S]{3,120}?)\s*<\/a>/gi },
    { url: "https://www.ilbe.com/list/ilbe?page=1", pattern: /href="(\/\d{10,}[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi },
    { url: "https://www.ilbe.com/", pattern: /href="(\/\d{10,}[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi },
  ];

  const COMMON_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.5",
    "Accept-Encoding": "gzip, deflate, br",
    "Referer": "https://www.ilbe.com/",
  };

  for (const { url, pattern } of targets) {
    try {
      const res = await fetch(url, {
        headers: COMMON_HEADERS,
        signal: AbortSignal.timeout(9000),
        redirect: "follow",
      });
      if (!res.ok) continue;
      const html = await res.text();

      // 404/차단 페이지 감지
      if (html.includes("접근이 차단") || html.includes("로봇") || html.length < 500) continue;

      const items: TrendingItem[] = [];
      // 1차 시도: td.title 내부 a 태그
      const tdPattern = /<td[^>]+class="[^"]*title[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      let m: RegExpExecArray | null;
      while ((m = tdPattern.exec(html)) !== null && items.length < 10) {
        const href = m[1].startsWith("http") ? m[1] : `https://www.ilbe.com${m[1]}`;
        const rawTitle = m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
        if (!rawTitle || rawTitle.length < 3 || rawTitle.length > 150) continue;
        if (items.some((it) => it.id === stableId(href))) continue;
        items.push({ id: stableId(href), title: rawTitle, link: href, pubDate: new Date().toISOString(), source: "일간베스트", sourceType: "community", score: 0 });
      }

      // 2차 시도: 숫자 ID 패턴 링크
      if (items.length < 3) {
        const re2 = /<a[^>]+href="((?:https:\/\/www\.ilbe\.com)?\/(?:list\/ilbe\?|view\/|post\/)?\d{8,}[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
        while ((m = re2.exec(html)) !== null && items.length < 10) {
          const href = m[1].startsWith("http") ? m[1] : `https://www.ilbe.com${m[1]}`;
          const rawTitle = m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
          if (!rawTitle || rawTitle.length < 3 || rawTitle.length > 150) continue;
          if (items.some((it) => it.id === stableId(href))) continue;
          items.push({ id: stableId(href), title: rawTitle, link: href, pubDate: new Date().toISOString(), source: "일간베스트", sourceType: "community", score: 0 });
        }
      }

      // 3차 시도: 범용 패턴 (링크에 일베 URL 포함)
      if (items.length < 3) {
        const re3 = pattern;
        while ((m = re3.exec(html)) !== null && items.length < 10) {
          const href = m[1].startsWith("http") ? m[1] : `https://www.ilbe.com${m[1]}`;
          const rawTitle = m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
          if (!rawTitle || rawTitle.length < 3 || rawTitle.length > 150) continue;
          if (items.some((it) => it.id === stableId(href))) continue;
          items.push({ id: stableId(href), title: rawTitle, link: href, pubDate: new Date().toISOString(), source: "일간베스트", sourceType: "community", score: 0 });
        }
      }

      if (items.length >= 3) return items.slice(0, 10);
    } catch { /**/ }
  }
  return [];
}

// ── X (Twitter / Nitter RSS) ──
async function fetchXTwitter(): Promise<TrendingItem[]> {
  const nitterHosts = [
    "https://nitter.poast.org",
    "https://nitter.privacydev.net",
    "https://nitter.1d4.us",
  ];
  const queries = ["팩트체크", "사실확인 논란"];

  for (const host of nitterHosts) {
    try {
      const results: TrendingItem[] = [];
      for (const q of queries) {
        const url = `${host}/search/rss?q=${encodeURIComponent(q)}&f=tweets`;
        const items = await safeRss(url, "X(Twitter)", "social", 5);
        results.push(...items);
        if (results.length >= 10) break;
      }
      if (results.length >= 3) return results.slice(0, 10);
    } catch { /**/ }
  }
  return [];
}


// ── 스코어 계산 ──
function calcScore(item: TrendingItem): number {
  let score = 0;
  if (item.pubDate) {
    const ageH = (Date.now() - new Date(item.pubDate).getTime()) / 3_600_000;
    score += Math.max(0, 50 - ageH * (50 / 48));
  }
  const factKws = ["팩트체크","사실확인","거짓","허위","오해","진실","검증","확인결과","논란","주장"];
  for (const kw of factKws) if (item.title.includes(kw)) { score += 12; break; }
  const bonus: Record<SourceType, number> = {
    factcheck: 30, government: 24, naver: 18,
    news: 12, youtube: 10, community: 8, social: 6,
  };
  score += bonus[item.sourceType] ?? 0;
  return Math.round(score);
}

// ── RSS 소스 목록 ──
const RSS_SOURCES: { url: string; name: string; type: SourceType; max?: number }[] = [
  { url: "https://www.yna.co.kr/rss/politics.xml",              name: "연합뉴스",  type: "news", max: 10 },
  { url: "https://www.yna.co.kr/rss/society.xml",               name: "연합뉴스",  type: "news", max: 10 },
  { url: "https://www.newsis.com/RSS/national.xml",             name: "뉴시스",   type: "news", max: 10 },
  { url: "https://www.news1.kr/rss/news_main.xml",              name: "뉴스1",    type: "news", max: 10 },
  { url: "https://imnews.imbc.com/rss/news/news_00.xml",        name: "MBC뉴스",  type: "news", max: 10 },
  { url: "https://www.mk.co.kr/rss/40300001/",                  name: "매일경제", type: "news", max: 10 },
  { url: "https://www.korea.kr/rss/policy.xml",                 name: "정책브리핑", type: "government", max: 10 },
];

export const fetchTrendingNews = createServerFn({ method: "GET" }).handler(async () => {
  const kv = getNewsKV();
  const scheduledTs = getLastScheduledTs();

  // KV 캐시 확인 (인스턴스 간 공유)
  if (kv) {
    try {
      const cached = await kv.get(KV_KEY, "json") as { data: TrendingItem[]; ts: number } | null;
      if (cached && cached.ts >= scheduledTs) {
        _cache = cached.data;
        _cacheTs = cached.ts;
        return cached.data;
      }
    } catch { /* KV 읽기 실패 시 재fetch */ }
  } else if (isCacheValid()) {
    // KV 없으면 인메모리 폴백
    return _cache;
  }

  const [rssAll, naverItems, snuItems, ytItems, dcItems, fmItems, xItems, ilbeItems] =
    await Promise.all([
      Promise.all(RSS_SOURCES.map((s) => safeRss(s.url, s.name, s.type, s.max))).then((r) => r.flat()),
      fetchNaverNews(),
      fetchSnuFactcheck(),
      fetchYouTube(),
      fetchDCInside(),
      fetchFMKorea(),
      fetchXTwitter(),
      fetchIlbeBest(),
    ]);

  const merged = [
    ...snuItems, ...naverItems, ...ytItems, ...dcItems,
    ...fmItems, ...ilbeItems, ...xItems, ...rssAll,
  ];

  const seen = new Set<string>();
  const unique = merged.filter((it) => {
    const key = it.link.replace(/[?#].*$/, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const scored = unique
    .map((it) => ({ ...it, score: calcScore(it) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 80);

  _cache = scored;
  _cacheTs = Date.now();

  // KV에 저장 — 다음 예약 갱신 시각까지 TTL
  if (kv) {
    const nextKST = scheduledTs + 5 * 3600000; // 다음 예약 (5시간 후)
    const ttlSec = Math.max(1800, Math.floor((nextKST - Date.now()) / 1000));
    try { await kv.put(KV_KEY, JSON.stringify({ data: scored, ts: _cacheTs }), { expirationTtl: ttlSec }); } catch {}
  }

  return scored;
});

export const refreshTrendingNews = createServerFn({ method: "POST" }).handler(async () => {
  _cacheTs = 0;
  _cache = [];
  // KV 캐시도 만료 처리 (ts를 0으로 덮어쓰기)
  const kv = getNewsKV();
  if (kv) {
    try { await kv.put(KV_KEY, JSON.stringify({ data: [], ts: 0 }), { expirationTtl: 1 }); } catch {}
  }
  return { ok: true };
});
