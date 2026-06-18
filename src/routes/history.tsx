import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, useMemo } from "react";
import { Inbox, Trash2, Search, X, Loader2, AlertTriangle } from "lucide-react";

import { listAnalyses, deleteAnalysis } from "@/lib/analyses.functions";
import { getSessionId } from "@/lib/session";
import { SiteHeader, BottomNav } from "@/components/SiteHeader";
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

type Verdict = "사실" | "부분 사실" | "근거 부족" | "반대 근거 우세" | "미확인";
const VERDICTS: Verdict[] = ["사실", "부분 사실", "근거 부족", "반대 근거 우세", "미확인"];

const VERDICT_COLOR: Record<Verdict, string> = {
  "사실": "bg-emerald-500/15 text-emerald-400 border-emerald-500/30 data-[active=true]:bg-emerald-500 data-[active=true]:text-white",
  "부분 사실": "bg-blue-500/15 text-blue-400 border-blue-500/30 data-[active=true]:bg-blue-500 data-[active=true]:text-white",
  "근거 부족": "bg-yellow-500/15 text-yellow-400 border-yellow-500/30 data-[active=true]:bg-yellow-500 data-[active=true]:text-white",
  "반대 근거 우세": "bg-red-500/15 text-red-400 border-red-500/30 data-[active=true]:bg-red-500 data-[active=true]:text-white",
  "미확인": "bg-slate-500/15 text-slate-400 border-slate-500/30 data-[active=true]:bg-slate-500 data-[active=true]:text-white",
};

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

  return (
    <div className="min-h-screen pb-16 sm:pb-0">
      <SiteHeader />
      <main className="max-w-4xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold mb-2">분석 히스토리</h1>
        <p className="text-sm text-muted-foreground mb-6">이 브라우저에서 수행한 최근 분석 기록입니다.</p>

        {/* 검색 + 필터 */}
        {data && data.length > 0 && (
          <div className="mb-6 space-y-3">
            {/* 키워드 검색 */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="제목 또는 URL로 검색…"
                className="w-full pl-9 pr-9 py-2.5 rounded-xl bg-surface-2 border border-border/50 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/40 transition"
              />
              {keyword && (
                <button
                  onClick={() => setKeyword("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* 판정 필터 */}
            <div className="flex flex-wrap gap-2">
              {VERDICTS.map((v) => (
                <button
                  key={v}
                  data-active={activeVerdict === v}
                  onClick={() => setActiveVerdict(activeVerdict === v ? null : v)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${VERDICT_COLOR[v]}`}
                >
                  {v}
                </button>
              ))}
              {activeVerdict && (
                <button
                  onClick={() => setActiveVerdict(null)}
                  className="px-3 py-1 rounded-full text-xs text-muted-foreground border border-border/50 hover:bg-surface-2 transition-colors"
                >
                  전체 보기
                </button>
              )}
            </div>
          </div>
        )}

        {isLoading && <div className="text-muted-foreground text-sm">불러오는 중…</div>}

        {data && data.length === 0 && (
          <div className="glass rounded-2xl p-12 text-center">
            <Inbox className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground mb-4">아직 분석 기록이 없습니다.</p>
            <Link to="/" className="inline-block px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium">
              첫 분석 시작하기
            </Link>
          </div>
        )}

        {data && data.length > 0 && filtered.length === 0 && (
          <div className="glass rounded-2xl p-10 text-center">
            <p className="text-muted-foreground text-sm">조건에 맞는 분석 기록이 없습니다.</p>
          </div>
        )}

        <div className="space-y-2">
          {filtered.map((row) => (
            <div key={row.id} className="relative group">
              <Link
                to="/analysis/$id"
                params={{ id: row.id }}
                className="glass rounded-xl p-5 flex items-center gap-4 hover:bg-surface-2/50 transition-colors group pr-12"
              >
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium truncate group-hover:text-primary transition-colors">
                    {row.title ?? (row.status === "pending" ? "분석 중…" : "(제목 없음)")}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    {new Date(row.created_at).toLocaleString("ko-KR")}
                    {row.source_url && " · " + (() => { try { return new URL(row.source_url!).hostname; } catch { return row.source_url; } })()}
                  </p>
                </div>
                <div className="text-right shrink-0">
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
                      <VerdictBadge verdict={row.overall_verdict ?? "미확인"} size="sm" />
                      <div className="text-xs text-muted-foreground mt-1 tabular-nums">
                        신뢰도 {row.overall_confidence ?? 0}%
                      </div>
                    </>
                  )}
                </div>
              </Link>
              <button
                type="button"
                onClick={(e) => handleDelete(e, row.id)}
                disabled={deletingId === row.id}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-40"
                aria-label="삭제"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        {filtered.length > 0 && (
          <p className="text-xs text-muted-foreground mt-4 text-right">
            {filtered.length}건 표시 / 전체 {data?.length ?? 0}건
          </p>
        )}
      </main>
    </div>
  );
}
