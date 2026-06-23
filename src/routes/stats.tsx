import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, useMemo } from "react";
import {
  ArrowLeft,
  BarChart3,
  Clock,
  Target,
  Globe,
  TrendingUp,
  Loader2,
  Inbox,
} from "lucide-react";

import { listAnalyses } from "@/lib/analyses.functions";
import { getSessionId } from "@/lib/session";
import { useBookmarks } from "@/lib/use-bookmarks";
import { SiteHeader } from "@/components/SiteHeader";
import { VerdictBadge } from "@/components/VerdictBadge";

export const Route = createFileRoute("/stats")({
  head: () => ({
    meta: [
      { title: "내 통계 — 팩트체크" },
      { name: "description", content: "팩트체크 사용 통계 및 분석 패턴." },
    ],
  }),
  component: StatsPage,
});

import type { Verdict } from "@/lib/verdict";

const COLORS: Record<string, string> = {
  사실: "bg-emerald-500",
  "부분 사실": "bg-blue-500",
  "근거 부족": "bg-yellow-500",
  "반대 근거 우세": "bg-red-500",
};

function StatsPage() {
  const [sessionId, setSessionId] = useState("");
  const fetchList = useServerFn(listAnalyses);
  const { bookmarkedIds } = useBookmarks();

  useEffect(() => {
    setSessionId(getSessionId());
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["analyses", sessionId],
    queryFn: () => fetchList({ data: { sessionId } }),
    enabled: !!sessionId,
  });

  const stats = useMemo(() => {
    if (!data) return null;
    const total = data.length;
    const completed = data.filter((r) => r.status === "completed");
    const verdictCounts: Record<string, number> = {};
    for (const r of completed) {
      const v = r.overall_verdict ?? "근거 부족";
      verdictCounts[v] = (verdictCounts[v] ?? 0) + 1;
    }

    const domains: Record<string, number> = {};
    for (const r of data) {
      if (r.source_url) {
        try {
          const host = new URL(r.source_url).hostname.replace("www.", "");
          domains[host] = (domains[host] ?? 0) + 1;
        } catch {
          /* ignore */
        }
      }
    }
    const topDomains = Object.entries(domains)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const weekAgo = Date.now() - 7 * 86400000;
    const thisWeek = data.filter((r) => new Date(r.created_at).getTime() > weekAgo).length;

    return {
      total,
      completed: completed.length,
      verdictCounts,
      topDomains,
      thisWeek,
      bookmarks: bookmarkedIds.length,
    };
  }, [data, bookmarkedIds]);

  return (
    <div className="min-h-screen pb-16 sm:pb-0">
      <SiteHeader />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft className="w-4 h-4" /> 홈
        </Link>

        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-primary/10 grid place-items-center">
            <BarChart3 className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">내 통계</h1>
            <p className="text-sm text-muted-foreground">팩트체크 사용 패턴 한눈에 보기</p>
          </div>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && !stats && (
          <div className="rounded-2xl border border-border/40 bg-surface p-14 text-center">
            <Inbox className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground mb-5">아직 분석 기록이 없습니다.</p>
            <Link
              to="/"
              className="inline-block px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium"
            >
              첫 분석 시작하기
            </Link>
          </div>
        )}

        {stats && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard icon={BarChart3} label="전체 분석" value={stats.total} />
              <StatCard icon={TrendingUp} label="완료" value={stats.completed} />
              <StatCard icon={Clock} label="최근 7일" value={stats.thisWeek} />
              <StatCard icon={Target} label="즐겨찾기" value={stats.bookmarks} />
            </div>

            <div className="rounded-xl border border-border/40 bg-surface p-5">
              <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-widest mb-4">
                판정 분포
              </h2>
              {stats.completed > 0 ? (
                <div className="space-y-3">
                  <div className="flex h-3 rounded-full overflow-hidden gap-px">
                    {(Object.entries(stats.verdictCounts) as [string, number][]).map(([v, c]) => (
                      <div
                        key={v}
                        className={`${COLORS[v] ?? "bg-muted-foreground"} transition-all`}
                        style={{ width: `${(c / stats.completed) * 100}%` }}
                      />
                    ))}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {(Object.entries(stats.verdictCounts) as [string, number][]).map(([v, c]) => (
                      <div key={v} className="flex items-center gap-2">
                        <span
                          className={`w-2 h-2 rounded-full ${COLORS[v] ?? "bg-muted-foreground"}`}
                        />
                        <span className="text-xs text-muted-foreground">
                          {v} <strong className="text-foreground">{c}</strong>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">완료된 분석이 없습니다.</p>
              )}
            </div>

            {stats.topDomains.length > 0 && (
              <div className="rounded-xl border border-border/40 bg-surface p-5">
                <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-widest mb-4">
                  자주 확인한 도메인
                </h2>
                <div className="space-y-2">
                  {stats.topDomains.map(([domain, count]) => (
                    <div key={domain} className="flex items-center gap-3">
                      <Globe className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />
                      <span className="text-sm text-foreground flex-1 truncate">{domain}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">{count}회</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof BarChart3;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-xl border border-border/40 bg-surface p-4">
      <Icon className="w-4 h-4 text-muted-foreground/60 mb-1.5" />
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-[11px] text-muted-foreground/70 mt-0.5">{label}</p>
    </div>
  );
}
