import { getEnv } from "./runtime-env.server";
import type { NaverFactCheckItem } from "./analyses/types";

interface NaverNewsAPIItem {
  title: string;
  link: string;
  originallink: string;
  description: string;
  pubDate: string;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractPublisher(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const map: Record<string, string> = {
      "yonhapnews.co.kr": "연합뉴스",
      "yonhapnewstv.co.kr": "연합뉴스TV",
      "newsis.com": "뉴시스",
      "newspim.com": "뉴스핌",
      "news.sbs.co.kr": "SBS",
      "news.kbs.co.kr": "KBS",
      "imnews.imbc.com": "MBC",
      "jtbc.co.kr": "JTBC",
      "chosun.com": "조선일보",
      "donga.com": "동아일보",
      "hani.co.kr": "한겨레",
      "khan.co.kr": "경향신문",
      "ohmynews.com": "오마이뉴스",
      "pressian.com": "프레시안",
      "sisain.co.kr": "시사IN",
      "hankookilbo.com": "한국일보",
      "segyetimes.com": "세계일보",
      "kmib.co.kr": "국민일보",
      "munhwa.com": "문화일보",
      "mt.co.kr": "머니투데이",
      "edaily.co.kr": "이데일리",
    };
    for (const [domain, name] of Object.entries(map)) {
      if (host.includes(domain)) return name;
    }
    return host.split(".")[0];
  } catch { return "네이버 뉴스"; }
}

function buildQuery(text: string): string {
  // 핵심 키워드 추출 (조사·부사 제외, 2글자 이상 명사 우선)
  const cleaned = text
    .replace(/[^\w\s가-힣]/g, " ")
    .replace(/\b(이|가|은|는|을|를|의|에|에서|로|으로|와|과|이다|입니다|합니다|했다|된다)\b/g, " ")
    .trim();
  const words = cleaned.split(/\s+/).filter(w => w.length >= 2).slice(0, 5);
  return `팩트체크 ${words.join(" ")}`.slice(0, 100);
}

/**
 * Naver Search API로 팩트체크 관련 뉴스를 검색합니다.
 * NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 없으면 빈 배열 반환.
 */
export async function fetchNaverFactChecks(query: string): Promise<NaverFactCheckItem[]> {
  if (query.length < 10) return [];

  const clientId     = getEnv("NAVER_CLIENT_ID");
  const clientSecret = getEnv("NAVER_CLIENT_SECRET");
  if (!clientId || !clientSecret) return [];

  try {
    const searchQuery = buildQuery(query);
    const params = new URLSearchParams({ query: searchQuery, display: "8", sort: "date" });

    const res = await fetch(
      `https://openapi.naver.com/v1/search/news.json?${params}`,
      {
        headers: {
          "X-Naver-Client-Id": clientId,
          "X-Naver-Client-Secret": clientSecret,
        },
        signal: AbortSignal.timeout(4500),
      },
    );
    if (!res.ok) return [];

    const json = await res.json() as { items?: NaverNewsAPIItem[] };

    return (json.items ?? [])
      .filter(item => {
        const t = stripHtml(item.title).toLowerCase();
        const d = stripHtml(item.description).toLowerCase();
        return (
          t.includes("팩트체크") || t.includes("사실확인") || t.includes("팩트") ||
          d.includes("팩트체크") || d.includes("사실확인")
        );
      })
      .slice(0, 3)
      .map(item => ({
        title:       stripHtml(item.title).slice(0, 120),
        link:        item.link || item.originallink,
        description: stripHtml(item.description).slice(0, 200),
        pub_date:    item.pubDate,
        publisher:   extractPublisher(item.link || item.originallink),
      }));
  } catch { return []; }
}

/** AI 프롬프트에 삽입할 블록 생성 */
export function formatNaverBlockForPrompt(items: NaverFactCheckItem[]): string {
  if (!items.length) return "";
  const lines = items.map((item, i) =>
    `${i + 1}. [${item.publisher}] ${item.title}\n   ${item.description}`,
  );
  return `\n[네이버 뉴스 팩트체크 관련 기사 — 판정 참고]\n${lines.join("\n")}\n`;
}
