import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, useMemo } from "react";
import { Inbox, Trash2, Search, X, Loader2, AlertTriangle, ExternalLink, Clock } from "lucide-react";

import { listAnalyses, deleteAnalysis } from "@/lib/analyses.functions";
import { getSessionId } from "@/lib/session";
import { SiteHeader } from "@/components/SiteHeader";
import { VerdictBadge } from "@/components/VerdictBadge";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "분석 히스토리 — 팩트체크" },
      { name: "description", content: "이 브라우저에서 진행한 사실검증 분석 기록." },
    ],
  }),
  component: HistoryPage,
});

type Verdict = "사실" | "부분 사실" | "근거 부족" | "반대 근거 우세";
const VERDICTS: Verdict[] = ["사실", "부분 사실", "근거 부족", "반대 근거 우세"];

const VERDICT_COLOR: Record<string, string> = {
  "사실":           "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 data-[active=true]:bg-emerald-500 data-[active=true]:text-white data-[active=true]:border-emerald-500",
  "부분 사실":      "bg-blue-500/10 text-blue-400 border-blue-500/30 data-[active=true]:bg-blue-500 data-[active=true]:text-white data-[active=true]:border-blue-500",
  "근거 부족":      "bg-yellow-500/10 text-yellow-400 border-yellow-500/30 data-[active=true]:bg-yellow-500 data-[active=true]:text-white data-[active=true]:border-yellow-500",
  "반대 근거 우세": "bg-red-500/10 text-red-400 border-red-500/30 data-[active=true]:bg-red-500 data-[active=true]:text-white data-[active=true]:border-red-500",
};

const VERDICT_BORDER: Record<string, string> = {
  "사실":           "border-l-emerald-500",
  "부분 사실":      "border-l-blue-500",
  "근거 부족":      "border-l-yellow-500",
  "반대 근거 우세": "border-l-red-500",
};

const VERDICT_CONF_COLOR: Record<string, string> = {
  "사실":           "bg-emerald-500",
  "부분 사실":      "bg-blue-500",
  "근거 부족":      "bg-yellow-500",
  "반대 근거 우세": "bg-red-500",
};

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "방금 전";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}일 전`;
  return new Date(dateStr).toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-border/40 border-l-4 border-l-border/20 bg-surface p-4 sm:p-5 flex items-center gap-4 animate-pulse">
      <div className="flex-1 min-w-0 space-y-2">
        <div className="h-4 bg-surface-2 rounded w-3/4" />
        <div className="h-3 bg-surface-2 rounded w-1/3" />
      </div>
      <div className="shrink-0 space-y-2 text-right">
        <div className="h-5 bg-surface-2 rounded-full w-16" />
        <div className="h-1.5 bg-surface-2 rounded-full w-20" />
      </div>
    </div>
  );
}

function HistoryPage() {
  const fetchList = useServerFn(listAnalyses);
  const doDelete = useServerFn(deleteAnalysis);
  const queryClient = useQueryClient();
  const [sessionId, setSessionId] = useState<string>("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [activeVerdict, setActiveVerdict] = useState<Verdict | null>(null);

  useEffect(() => { setSessionId(getSessionId()); }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["analyses", sessionId],
    queryFn: () => fetchList({ data: { sessionId } }),
    enabled: !!sessionId,
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.filter((row) => {
      if (activeVerdict && row.overall_verdict !== activeVerdict) return false;
      if (keyword.trim()) {
        const kw = keyword.trim().toLowerCase();
        const title = (row.title ?? "").toLowerCase();
        const url = (row.source_url ?? "").toLowerCase();
        if (!title.includes(kw) && !url.includes(kw)) return false;
      }
      return true;
    });
  }, [data, activeVerdict, keyword]);

  // 판정별 건수 집계
  const verdictCounts = useMemo(() => {
    if (!data) return {} as Record<string, number>;
    return data.reduce<Record<string, number>>((acc, row) => {
      const v = row.overall_verdict ?? "근거 부족";
      acc[v] = (acc[v] ?? 0) + 1;
      return acc;
    }, {});
  }, [data]);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    if (!confirm("이 분석을 삭제하시겠습니까?")) return;
    setDeletingId(id);
    try {
      await doDelete({ data: { id, sessionId } });
      queryClient.invalidateQueries({ queryKey: ["analyses"] });
    } finally {
      setDeletingId(null);
    }
  };

  const total = data?.length ?? 0;

  return (
    <div className="min-h-screen pb-[calc(4rem+env(safe-area-inset-bottom,0px))] sm:pb-0">
      <SiteHeader />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10">

        {/* 헤더 */}
        <div className="mb-8">
          <div className="flex items-end justify-between gap-4 mb-1">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">분석 히스토리</h1>
            {total > 0 && (
              <span className="text-sm text-muted-foreground tabular-nums mb-0.5">총 {total}건</span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">이 브라우저에서 수행한 팩트체크 기록입니다.</p>

          {/* 판정별 통계 바 */}
          {total > 0 && (
            <div className="mt-4 flex rounded-lg overflow-hidden h-2 gap-px">
              {VERDICTS.map((v) => {
                const count = verdictCounts[v] ?? 0;
                if (count === 0) return null;
                const pct = Math.round((count / total) * 100);
                const colorMap: Record<string, string> = {
                  "사실": "bg-emerald-500",
                  "부분 사실": "bg-blue-500",
                  "근거 부족": "bg-yellow-500",
                  "반대 근거 우세": "bg-red-500",
                };
                return (
                  <div
                    key={v}
                    title={`${v}: ${count}건 (${pct}%)`}
                    className={`${colorMap[v]} transition-all duration-700 cursor-pointer hover:brightness-110`}
                    style={{ width: `${pct}%` }}
                    onClick={() => setActiveVerdict(activeVerdict === v ? null : v)}
                  />
                );
              })}
            </div>
          )}
          {total > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5">
              {VERDICTS.map((v) => {
                const count = verdictCounts[v] ?? 0;
                if (count === 0) return null;
                return (
                  <span key={v} className="text-[11px] text-muted-foreground/60">
                    <span className={`font-semibold ${
                      v === "사실" ? "text-emerald-500" :
                      v === "부분 사실" ? "text-blue-500" :
                      v === "근거 부족" ? "text-yellow-500" : "text-red-500"
                    }`}>{count}</span> {v}
                  </span>
                );
              })}
            </div>
          )}
        </div>

        {/* 검색 + 필터 */}
        {data && data.length > 0 && (
          <div className="mb-5 space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="제목 또는 URL로 검색…"
                className="w-full pl-9 pr-9 py-2.5 rounded-xl bg-surface-2 border border-border/50 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40 transition"
              />
              {keyword && (
                <button onClick={() => setKeyword("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {VERDICTS.map((v) => (
                <button
                  key={v}
                  data-active={activeVerdict === v}
                  onClick={() => setActiveVerdict(activeVerdict === v ? null : v)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-all duration-200 ${VERDICT_COLOR[v]}`}
                >
                  {v}
                  {verdictCounts[v] ? <span className="ml-1 opacity-70">{verdictCounts[v]}</span> : null}
                </button>
              ))}
              {activeVerdict && (
                <button
                  onClick={() => setActiveVerdict(null)}
                  className="px-3 py-1 rounded-full text-xs text-muted-foreground border border-border/50 hover:bg-surface-2 transition-colors"
                >
                  전체
                </button>
              )}
            </div>
          </div>
        )}

        {/* 로딩 스켈레톤 */}
        {isLoading && (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => <SkeletonCard key={i} />)}
          </div>
        )}

        {/* 빈 상태 */}
        {!isLoading && data && data.length === 0 && (
          <div className="rounded-2xl border border-border/40 bg-surface p-14 text-center">
            <Inbox className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground mb-5">아직 분석 기록이 없습니다.</p>
            <Link to="/" className="inline-block px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
              첫 분석 시작하기
            </Link>
          </div>
        )}

        {/* 필터 결과 없음 */}
        {!isLoading && data && data.length > 0 && filtered.length === 0 && (
          <div className="rounded-2xl border border-border/40 bg-surface p-10 text-center">
            <p className="text-sm text-muted-foreground">조건에 맞는 분석 기록이 없습니다.</p>
          </div>
        )}

        {/* 카드 목록 */}
        <div className="space-y-2">
          {filtered.map((row, idx) => {
            const verdict = row.overall_verdict ?? "근거 부족";
            const borderColor = VERDICT_BORDER[verdict] ?? "border-l-border/40";
            const confColor = VERDICT_CONF_COLOR[verdict] ?? "bg-muted-foreground";
            const conf = row.overall_confidence ?? 0;
            const isDone = row.status !== "pending" && row.status !== "failed";
            let hostname = "";
            if (row.source_url) {
              try { hostname = new URL(row.source_url).hostname.replace("www.", ""); } catch { hostname = row.source_url; }
            }

            return (
              <div key={row.id} className="relative group">
                <Link
                  to="/analysis/$id"
                  params={{ id: row.id }}
                  className={`flex items-start gap-3 sm:gap-4 rounded-xl border border-border/40 border-l-4 ${borderColor} bg-surface px-4 py-4 pr-11 hover:bg-surface-2/60 hover:shadow-sm transition-all duration-150`}
                  style={{ animationDelay: `${idx * 30}ms` }}
                >
                  {/* 본문 */}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm leading-snug text-foreground group-hover:text-primary transition-colors line-clamp-2">
                      {row.title ?? (row.status === "pending" ? "분석 중…" : "(제목 없음)")}
                    </p>
                    {(row as Record<string, unknown>).summary && row.status !== "pending" && (
                      <p className="text-[11px] text-foreground/55 mt-0.5 line-clamp-1 leading-relaxed">
                        {(row as Record<string, unknown>).summary as string}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/60">
                        <Clock className="w-3 h-3" />
                        {relativeTime(row.created_at)}
                      </span>
                      {hostname && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/50 bg-surface-2 rounded-full px-2 py-0.5 max-w-[160px] truncate">
                          <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                          <span className="truncate">{hostname}</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 우측 판정 */}
                  <div className="shrink-0 text-right flex flex-col items-end gap-1.5">
                    {row.status === "pending" ? (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> 처리 중
                      </span>
                    ) : row.status === "failed" ? (
                      <span className="inline-flex items-center gap-1 text-xs text-destructive">
                        <AlertTriangle className="w-3.5 h-3.5" /> 실패
                      </span>
                    ) : (
                      <>
                        <VerdictBadge verdict={verdict} size="sm" />
                        {isDone && (
                          <div className="w-20">
                            <div className="flex justify-between items-center mb-0.5">
                              <span className="text-[10px] text-muted-foreground/50 tabular-nums">{conf}%</span>
                            </div>
                            <div className="h-1 w-full bg-border/30 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${confColor} transition-all duration-700`}
                                style={{ width: `${conf}%` }}
                              />
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </Link>

                {/* 삭제 버튼 */}
                <button
                  type="button"
                  onClick={(e) => handleDelete(e, row.id)}
                  disabled={deletingId === row.id}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-2 rounded-lg text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-all duration-150 sm:opacity-0 sm:group-hover:opacity-100 disabled:opacity-30"
                  aria-label="삭제"
                >
                  {deletingId === row.id
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <Trash2 className="w-3.5 h-3.5" />}
                </button>
              </div>
            );
          })}
        </div>

        {filtered.length > 0 && (
          <p className="text-[11px] text-muted-foreground/50 mt-4 text-right tabular-nums">
            {activeVerdict || keyword ? `${filtered.length}건 표시 / ` : ""}전체 {total}건
          </p>
        )}
      </main>
    </div>
  );
}
