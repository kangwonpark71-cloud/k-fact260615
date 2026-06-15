import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Inbox, Trash2 } from "lucide-react";

import { listAnalyses, deleteAnalysis } from "@/lib/analyses.functions";
import { getSessionId } from "@/lib/session";
import { SiteHeader } from "@/components/SiteHeader";
import { VerdictBadge } from "@/components/VerdictBadge";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "분석 히스토리 — K-Fact" },
      { name: "description", content: "이 브라우저에서 진행한 사실검증 분석 기록." },
    ],
  }),
  component: HistoryPage,
});

function HistoryPage() {
  const fetchList = useServerFn(listAnalyses);
  const doDelete = useServerFn(deleteAnalysis);
  const queryClient = useQueryClient();
  const [sessionId, setSessionId] = useState<string>("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  useEffect(() => { setSessionId(getSessionId()); }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["analyses", sessionId],
    queryFn: () => fetchList({ data: { sessionId } }),
    enabled: !!sessionId,
  });

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
    <div className="min-h-screen">
      <SiteHeader />
      <main className="max-w-4xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold mb-2">분석 히스토리</h1>
        <p className="text-sm text-muted-foreground mb-8">이 브라우저에서 수행한 최근 분석 기록입니다.</p>

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

        <div className="space-y-2">
          {data?.map((row) => (
            <div key={row.id} className="relative group">
              <Link
                to="/analysis/$id"
                params={{ id: row.id }}
                className="glass rounded-xl p-5 flex items-center gap-4 hover:bg-surface-2/50 transition-colors group pr-12"
              >
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium truncate group-hover:text-primary transition-colors">
                    {row.title ?? "(제목 없음)"}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    {new Date(row.created_at).toLocaleString("ko-KR")}
                    {row.source_url && " · " + new URL(row.source_url).hostname}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <VerdictBadge verdict={row.overall_verdict ?? "미확인"} size="sm" />
                  <div className="text-xs text-muted-foreground mt-1 tabular-nums">
                    신뢰도 {row.overall_confidence ?? 0}%
                  </div>
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
      </main>
    </div>
  );
}
