import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3, Users, TrendingUp, ShieldAlert,
  Search, Trash2, ExternalLink, ChevronLeft, ChevronRight,
  RefreshCw, LogOut,
} from "lucide-react";

import { useAuth } from "@/lib/auth";
import { getAdminStats, getAdminAnalyses, adminDeleteAnalysis } from "@/lib/admin.functions";
import { VerdictBadge } from "@/components/VerdictBadge";
import { SiteHeader } from "@/components/SiteHeader";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "관리자 대시보드 — K-Fact" }] }),
  component: AdminPage,
});

const VERDICTS = ["사실", "부분 사실", "근거 부족", "반대 근거 우세", "미확인"] as const;
const VERDICT_COLORS: Record<string, string> = {
  "사실": "bg-verdict-true",
  "부분 사실": "bg-verdict-partial",
  "근거 부족": "bg-verdict-weak",
  "반대 근거 우세": "bg-verdict-false",
  "미확인": "bg-verdict-unknown",
};

function AdminPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [tab, setTab] = useState<"overview" | "analyses">("overview");
  const [search, setSearch] = useState("");
  const [verdictFilter, setVerdictFilter] = useState("");
  const [userTypeFilter, setUserTypeFilter] = useState<"all" | "user" | "anon">("all");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;

  // 관리자 이메일은 서버에서 검증. 클라이언트에서는 UI 접근 제어만.
  const adminEmail = import.meta.env.VITE_ADMIN_EMAIL;
  const isAdmin = user?.email === adminEmail;

  useEffect(() => {
    if (!authLoading && (!user || !isAdmin)) {
      navigate({ to: "/" });
    }
  }, [user, authLoading, isAdmin, navigate]);

  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useQuery({
    queryKey: ["admin", "stats"],
    queryFn: () => getAdminStats(),
    enabled: !!user && isAdmin,
    staleTime: 60_000,
  });

  const { data: analysesData, isLoading: analysesLoading } = useQuery({
    queryKey: ["admin", "analyses", page, verdictFilter, search, userTypeFilter],
    queryFn: () =>
      getAdminAnalyses({
        data: {
          page,
          pageSize: PAGE_SIZE,
          verdict: verdictFilter || undefined,
          search: search || undefined,
          userType: userTypeFilter,
        },
      }),
    enabled: !!user && isAdmin && tab === "analyses",
    staleTime: 30_000,
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => adminDeleteAnalysis({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin"] });
    },
  });

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user || !isAdmin) return null;

  const totalPages = Math.ceil((analysesData?.total ?? 0) / PAGE_SIZE);

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">

        {/* 헤더 */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent grid place-items-center shadow-[var(--shadow-glow)]">
              <ShieldAlert className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-2xl font-display font-bold">관리자 대시보드</h1>
              <p className="text-xs text-muted-foreground">{user.email}</p>
            </div>
          </div>
          <button
            onClick={() => refetchStats()}
            className="p-2 rounded-lg hover:bg-surface-2 text-muted-foreground hover:text-foreground transition-colors"
            title="새로고침"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/* 탭 */}
        <div className="flex gap-1 mb-8 glass rounded-xl p-1 w-fit">
          {(["overview", "analyses"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                tab === t
                  ? "bg-primary text-primary-foreground shadow"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "overview" ? "개요" : "분석 목록"}
            </button>
          ))}
        </div>

        {/* ── 개요 탭 ── */}
        {tab === "overview" && (
          <div className="space-y-8">
            {/* 통계 카드 */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                icon={<BarChart3 className="w-5 h-5" />}
                label="총 분석 건수"
                value={statsLoading ? "—" : (stats?.total ?? 0).toLocaleString()}
                sub="전체 기간"
              />
              <StatCard
                icon={<TrendingUp className="w-5 h-5" />}
                label="오늘 분석"
                value={statsLoading ? "—" : (stats?.today ?? 0).toLocaleString()}
                sub="오늘 00:00 이후"
              />
              <StatCard
                icon={<Users className="w-5 h-5" />}
                label="등록 사용자"
                value={statsLoading ? "—" : (stats?.uniqueUsers ?? 0).toLocaleString()}
                sub={`익명 세션 ${stats?.uniqueSessions ?? 0}개 포함`}
              />
              <StatCard
                icon={<ShieldAlert className="w-5 h-5" />}
                label="평균 신뢰도"
                value={statsLoading ? "—" : `${stats?.avgConfidence ?? 0}%`}
                sub="전체 분석 평균"
              />
            </div>

            {/* 최근 7일 트렌드 */}
            <div className="glass rounded-2xl p-6">
              <h2 className="text-base font-semibold mb-6">최근 7일 분석 건수</h2>
              {statsLoading ? (
                <div className="h-32 flex items-center justify-center text-muted-foreground text-sm">로딩 중…</div>
              ) : (
                <DailyChart data={stats?.daily ?? []} />
              )}
            </div>

            {/* 판정 분포 */}
            <div className="glass rounded-2xl p-6">
              <h2 className="text-base font-semibold mb-6">판정 분포</h2>
              {statsLoading ? (
                <div className="h-20 flex items-center justify-center text-muted-foreground text-sm">로딩 중…</div>
              ) : (
                <VerdictDistribution counts={stats?.verdictCounts ?? {}} total={stats?.total ?? 0} />
              )}
            </div>
          </div>
        )}

        {/* ── 분석 목록 탭 ── */}
        {tab === "analyses" && (
          <div className="space-y-4">
            {/* 필터 바 */}
            <div className="glass rounded-xl p-4 flex flex-wrap gap-3 items-center">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="제목 검색…"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-background/40 border border-border outline-none focus:border-primary"
                />
              </div>
              <select
                value={verdictFilter}
                onChange={(e) => { setVerdictFilter(e.target.value); setPage(0); }}
                className="px-3 py-2 text-sm rounded-lg bg-background/40 border border-border outline-none focus:border-primary"
              >
                <option value="">모든 판정</option>
                {VERDICTS.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
              <select
                value={userTypeFilter}
                onChange={(e) => { setUserTypeFilter(e.target.value as "all"|"user"|"anon"); setPage(0); }}
                className="px-3 py-2 text-sm rounded-lg bg-background/40 border border-border outline-none focus:border-primary"
              >
                <option value="all">전체 유형</option>
                <option value="user">로그인 사용자</option>
                <option value="anon">익명</option>
              </select>
              <span className="text-xs text-muted-foreground ml-auto">
                총 {(analysesData?.total ?? 0).toLocaleString()}건
              </span>
            </div>

            {/* 분석 테이블 */}
            <div className="glass rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground text-xs">
                    <th className="text-left px-4 py-3 font-medium">제목</th>
                    <th className="text-left px-4 py-3 font-medium hidden md:table-cell">판정</th>
                    <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">신뢰도</th>
                    <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">유형</th>
                    <th className="text-left px-4 py-3 font-medium hidden md:table-cell">생성일</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {analysesLoading ? (
                    <tr>
                      <td colSpan={6} className="text-center py-12 text-muted-foreground">
                        <RefreshCw className="w-5 h-5 animate-spin mx-auto" />
                      </td>
                    </tr>
                  ) : (analysesData?.rows ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-12 text-muted-foreground text-sm">
                        검색 결과가 없습니다.
                      </td>
                    </tr>
                  ) : (
                    (analysesData?.rows ?? []).map((row) => (
                      <tr key={row.id} className="border-b border-border/50 hover:bg-surface/40 transition-colors">
                        <td className="px-4 py-3 max-w-[220px]">
                          <Link
                            to="/analysis/$id"
                            params={{ id: row.id }}
                            className="font-medium hover:text-primary transition-colors truncate block"
                          >
                            {row.title ?? "(제목 없음)"}
                          </Link>
                          {row.source_url && (
                            <a
                              href={row.source_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 mt-0.5"
                            >
                              <ExternalLink className="w-3 h-3" />
                              <span className="truncate max-w-[160px]">{row.source_url}</span>
                            </a>
                          )}
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          <VerdictBadge verdict={row.overall_verdict} size="sm" />
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell">
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-1.5 rounded-full bg-border overflow-hidden">
                              <div
                                className="h-full bg-primary rounded-full"
                                style={{ width: `${row.overall_confidence}%` }}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground">{row.overall_confidence}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell text-xs text-muted-foreground">
                          {row.user_id ? (
                            <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary">로그인</span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full bg-muted/30 text-muted-foreground">익명</span>
                          )}
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(row.created_at).toLocaleDateString("ko-KR", {
                            month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
                          })}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => {
                              if (confirm(`"${row.title}" 분석을 삭제할까요?`)) {
                                deleteMut.mutate(row.id);
                              }
                            }}
                            disabled={deleteMut.isPending}
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                            title="삭제"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* 페이지네이션 */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="p-2 rounded-lg hover:bg-surface-2 text-muted-foreground disabled:opacity-40 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm text-muted-foreground">
                  {page + 1} / {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="p-2 rounded-lg hover:bg-surface-2 text-muted-foreground disabled:opacity-40 transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

// ── 서브 컴포넌트 ──

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string | number; sub: string }) {
  return (
    <div className="glass rounded-2xl p-5 flex flex-col gap-3">
      <div className="flex items-center gap-2 text-muted-foreground">{icon}<span className="text-xs font-medium">{label}</span></div>
      <p className="text-3xl font-display font-bold">{value}</p>
      <p className="text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}

function DailyChart({ data }: { data: { date: string; count: number }[] }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="flex items-end gap-2 h-32">
      {data.map(({ date, count }) => (
        <div key={date} className="flex-1 flex flex-col items-center gap-1.5 group">
          <span className="text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
            {count}
          </span>
          <div className="w-full relative">
            <div
              className="w-full rounded-t-lg bg-primary/60 hover:bg-primary transition-all duration-300"
              style={{ height: `${Math.max(4, (count / max) * 96)}px` }}
            />
          </div>
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
            {new Date(date).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })}
          </span>
        </div>
      ))}
    </div>
  );
}

function VerdictDistribution({ counts, total }: { counts: Record<string, number>; total: number }) {
  if (total === 0) return <p className="text-sm text-muted-foreground">데이터 없음</p>;
  return (
    <div className="space-y-3">
      {VERDICTS.map((v) => {
        const count = counts[v] ?? 0;
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        return (
          <div key={v} className="flex items-center gap-3">
            <span className="text-sm w-28 shrink-0 text-muted-foreground">{v}</span>
            <div className="flex-1 h-2 rounded-full bg-border overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${VERDICT_COLORS[v] ?? "bg-muted"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground w-14 text-right">
              {count.toLocaleString()}건 ({pct}%)
            </span>
          </div>
        );
      })}
    </div>
  );
}
