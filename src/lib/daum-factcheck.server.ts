import type { DaumFactCheckItem } from "./analyses/types";

const DAUM_API =
  "https://issue.daum.net/api/arms/STYLER_CLUSTER_NEWSES_WITH_DUPLICATED?clusterIds=5186669&limit=30";

type DaumContent = {
  id: string;
  type: string;
  title: string;
  summary?: string;
  pcUrl: string;
  cpName?: string;
  createdAt?: string;
};

type DaumResponse = {
  document?: { data?: { contents?: DaumContent[] } };
};

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0*39;/g, "'").replace(/\s+/g, " ").trim();
}

function extractKeywords(text: string): string[] {
  return text
    .replace(/[^\w\s가-힣]/g, " ")
    .split(/\s+/)
    .filter(w => w.length >= 2 && !/^(이다|있다|없다|하다|되다|에서|으로|이가|의를|에게|부터|까지|이런|저런|같은|했다|한다|있는|없는|때문|대한|관한|위한|그리고|또한|하지만|그러나)$/.test(w))
    .slice(0, 8);
}

function relevance(query: string, title: string, summary: string): number {
  const keywords = extractKeywords(query);
  const target = (title + " " + summary).toLowerCase();
  return keywords.filter(k => target.includes(k.toLowerCase())).length;
}

/**
 * Daum 팩트체크 섹션 공개 API에서 최신 기사를 가져와 쿼리 관련성 기준으로 필터링.
 * API 키 불필요 — Referer 헤더만 필요.
 */
export async function fetchDaumFactChecks(query: string): Promise<DaumFactCheckItem[]> {
  if (query.length < 10) return [];
  try {
    const res = await fetch(DAUM_API, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "application/json",
        Referer: "https://news.daum.net/factcheck",
        Origin: "https://news.daum.net",
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];

    const json = await res.json() as DaumResponse;
    const contents = json?.document?.data?.contents ?? [];

    const scored = contents.map(it => ({
      it,
      score: relevance(query, it.title ?? "", it.summary ?? ""),
    }));

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(({ it }) => ({
        title:     stripHtml(it.title ?? "").slice(0, 120),
        link:      it.pcUrl,
        contents:  stripHtml(it.summary ?? "").slice(0, 200),
        datetime:  it.createdAt ?? "",
        publisher: it.cpName ?? "다음뉴스",
      }));
  } catch {
    return [];
  }
}

/** AI 프롬프트에 삽입할 Daum 팩트체크 블록 */
export function formatDaumBlockForPrompt(items: DaumFactCheckItem[]): string {
  if (!items.length) return "";
  const lines = items.map(
    (item, i) => `${i + 1}. [${item.publisher}] ${item.title}\n   ${item.contents}`,
  );
  return `\n[다음뉴스 팩트체크 관련 기사 — 판정 참고]\n${lines.join("\n")}\n`;
}
