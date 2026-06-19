import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3, Users, TrendingUp, ShieldAlert,
  Search, Trash2, ExternalLink, ChevronLeft, ChevronRight,
  RefreshCw, X, Download, Calendar, Clock, UserCheck,
  Mail, Globe, Eye, ChevronDown, ChevronUp,
  Key, Plus, Power,
} from "lucide-react";

import { useAuth } from "@/lib/auth";
import {
  getAdminStats, getAdminAnalyses, adminDeleteAnalysis,
  getAdminUsers, adminGetAnalysisDetail,
  listApiKeys, addApiKey, deleteApiKey, toggleApiKey,
  checkIsAdmin,
} from "@/lib/admin.functions";
import { VerdictBadge } from "@/components/VerdictBadge";
import { SiteHeader } from "@/components/SiteHeader";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "관리자 대시보드 — 팩트체크" }] }),
  component: AdminPage,
});

const VERDICTS = ["사실", "부분 사실", "근거 부족", "반대 근거 우세"] as const;
const VERDICT_COLORS: Record<string, string> = {
  "사실": "bg-verdict-true",
  "부분 사실": "bg-verdict-partial",
  "근거 부족": "bg-verdict-weak",
  "반대 근거 우세": "bg-verdict-false",
};
const VERDICT_TEXT: Record<string, string> = {
  "사실": "text-emerald-400",
  "부분 사실": "text-yellow-400",
  "근거 부족": "text-orange-400",
  "반대 근거 우세": "text-red-400",
};

type Tab = "overview" | "analyses" | "users" | "apikeys";

function AdminPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [tab, setTab] = useState<Tab>("overview");
  const [chartDays, setChartDays] = useState<7 | 30>(30);
  const [search, setSearch] = useState("");
  const [verdictFilter, setVerdictFilter] = useState("");
  const [userTypeFilter, setUserTypeFilter] = useState<"all" | "user" | "anon">("all");
  const [filterUserId, setFilterUserId] = useState<string | undefined>();
  const [page, setPage] = useState(0);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [userSearch, setUserSearch] = useState("");
  const [addKeyOpen, setAddKeyOpen] = useState(false);
  const PAGE_SIZE = 20;

  const { data: isAdmin = false, isLoading: adminCheckLoading } = useQuery({
    queryKey: ["admin", "check"],
    queryFn: () => checkIsAdmin(),
    enabled: !!user && !authLoading,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!authLoading && !adminCheckLoading && (!user || !isAdmin)) navigate({ to: "/" });
  }, [user, authLoading, isAdmin, adminCheckLoading, navigate]);

  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useQuery({
    queryKey: ["admin", "stats"],
    queryFn: () => getAdminStats(),
    enabled: !!user && isAdmin,
    staleTime: 60_000,
  });

  const { data: analysesData, isLoading: analysesLoading } = useQuery({
    queryKey: ["admin", "analyses", page, verdictFilter, search, userTypeFilter, filterUserId],
    queryFn: () => getAdminAnalyses({
      data: { page, pageSize: PAGE_SIZE, verdict: verdictFilter || undefined, search: search || undefined, userType: userTypeFilter, userId: filterUserId },
    }),
    enabled: !!user && isAdmin && tab === "analyses",
    staleTime: 30_000,
  });

  const { data: usersData, isLoading: usersLoading } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => getAdminUsers(),
    enabled: !!user && isAdmin && tab === "users",
    staleTime: 120_000,
  });

  const { data: detailData, isLoading: detailLoading } = useQuery({
    queryKey: ["admin", "detail", detailId],
    queryFn: () => adminGetAnalysisDetail({ data: { id: detailId! } }),
    enabled: !!detailId,
    staleTime: Infinity,
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => adminDeleteAnalysis({ data: { id } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin"] }); },
  });

  const { data: apiKeys, isLoading: apiKeysLoading } = useQuery({
    queryKey: ["admin", "apikeys"],
    queryFn: () => listApiKeys(),
    enabled: !!user && isAdmin && tab === "apikeys",
    staleTime: 30_000,
  });

  const deleteKeyMut = useMutation({
    mutationFn: (id: string) => deleteApiKey({ data: { id } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "apikeys"] }); },
  });

  const toggleKeyMut = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      toggleApiKey({ data: { id, is_active } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "apikeys"] }); },
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
  const chartData = chartDays === 7
    ? (stats?.daily30 ?? []).slice(-7)
    : (stats?.daily30 ?? []);

  const filteredUsers = (usersData ?? []).filter((u) =>
    !userSearch ||
    u.email.toLowerCase().includes(userSearch.toLowerCase()) ||
    (u.full_name ?? "").toLowerCase().includes(userSearch.toLowerCase()),
  );

  function downloadCSV() {
    if (!analysesData?.rows.length) return;
    const headers = ["ID", "제목", "판정", "신뢰도", "유형", "생성일", "URL"];
    const rows = analysesData.rows.map((r) => [
      r.id, r.title ?? "", r.overall_verdict, r.overall_confidence,
      r.user_id ? "로그인" : "익명",
      new Date(r.created_at).toLocaleString("ko-KR"),
      r.source_url ?? "",
    ]);
    const csv = [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `factcheck-분석-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  function viewUserAnalyses(userId: string) {
    setFilterUserId(userId);
    setPage(0);
    setTab("analyses");
  }

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
            onClick={() => { refetchStats(); qc.invalidateQueries({ queryKey: ["admin"] }); }}
            className="p-2 rounded-lg hover:bg-surface-2 text-muted-foreground hover:text-foreground transition-colors"
            title="새로고침"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/* 탭 */}
        <div className="flex gap-1 mb-8 glass rounded-xl p-1 w-fit">
          {([
            ["overview", "개요"],
            ["analyses", "분석 목록"],
            ["users", "사용자 관리"],
            ["apikeys", "API 키"],
          ] as [Tab, string][]).map(([t, label]) => (
            <button
              key={t}
              onClick={() => { setTab(t); if (t !== "analyses") setFilterUserId(undefined); }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                tab === t ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
              {t === "users" && usersData && (
                <span className="ml-1.5 text-[10px] opacity-70">{usersData.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* ── 개요 탭 ── */}
        {tab === "overview" && (
          <div className="space-y-6">
            {/* 통계 카드 6개 */}
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              <StatCard icon={<BarChart3 className="w-5 h-5" />} label="총 분석" value={statsLoading ? "—" : (stats?.total ?? 0).toLocaleString()} sub="전체 기간" color="text-primary" />
              <StatCard icon={<Clock className="w-5 h-5" />} label="오늘" value={statsLoading ? "—" : (stats?.today ?? 0).toLocaleString()} sub="오늘 00:00 이후" color="text-accent" />
              <StatCard icon={<Calendar className="w-5 h-5" />} label="이번 주" value={statsLoading ? "—" : (stats?.week ?? 0).toLocaleString()} sub="최근 7일" color="text-emerald-400" />
              <StatCard icon={<TrendingUp className="w-5 h-5" />} label="이번 달" value={statsLoading ? "—" : (stats?.month ?? 0).toLocaleString()} sub="최근 30일" color="text-yellow-400" />
              <StatCard icon={<Users className="w-5 h-5" />} label="등록 사용자" value={statsLoading ? "—" : (stats?.uniqueUsers ?? 0).toLocaleString()} sub={`익명 ${stats?.uniqueSessions ?? 0}세션`} color="text-blue-400" />
              <StatCard icon={<ShieldAlert className="w-5 h-5" />} label="평균 신뢰도" value={statsLoading ? "—" : `${stats?.avgConfidence ?? 0}%`} sub="전체 분석 평균" color="text-purple-400" />
            </div>

            {/* 트렌드 차트 */}
            <div className="glass rounded-2xl p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-base font-semibold">분석 건수 트렌드</h2>
                <div className="flex gap-1 glass rounded-lg p-0.5">
                  {([7, 30] as const).map((d) => (
                    <button
                      key={d}
                      onClick={() => setChartDays(d)}
                      className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${chartDays === d ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      {d}일
                    </button>
                  ))}
                </div>
              </div>
              {statsLoading
                ? <div className="h-32 flex items-center justify-center text-muted-foreground text-sm">로딩 중…</div>
                : <DailyChart data={chartData} />
              }
            </div>

            {/* 하단: 시간별 + 판정분포 */}
            <div className="grid lg:grid-cols-2 gap-6">
              <div className="glass rounded-2xl p-6">
                <h2 className="text-base font-semibold mb-6">오늘 시간별 현황</h2>
                {statsLoading
                  ? <div className="h-24 flex items-center justify-center text-muted-foreground text-sm">로딩 중…</div>
                  : <HourlyChart data={stats?.hourly ?? []} />
                }
              </div>
              <div className="glass rounded-2xl p-6">
                <h2 className="text-base font-semibold mb-6">판정 분포</h2>
                {statsLoading
                  ? <div className="h-24 flex items-center justify-center text-muted-foreground text-sm">로딩 중…</div>
                  : <VerdictDistribution counts={stats?.verdictCounts ?? {}} total={stats?.total ?? 0} />
                }
              </div>
            </div>
          </div>
        )}

        {/* ── 분석 목록 탭 ── */}
        {tab === "analyses" && (
          <div className="space-y-4">
            {/* 필터 바 */}
            <div className="glass rounded-xl p-4 flex flex-wrap gap-3 items-center">
              {filterUserId && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-medium">
                  <UserCheck className="w-3.5 h-3.5" />
                  사용자 필터 적용됨
                  <button onClick={() => { setFilterUserId(undefined); setPage(0); }} className="hover:text-destructive ml-1">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text" placeholder="제목 검색…" value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-background/40 border border-border outline-none focus:border-primary"
                />
              </div>
              <select
                value={verdictFilter} onChange={(e) => { setVerdictFilter(e.target.value); setPage(0); }}
                className="px-3 py-2 text-sm rounded-lg bg-background/40 border border-border outline-none focus:border-primary"
              >
                <option value="">모든 판정</option>
                {VERDICTS.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
              <select
                value={userTypeFilter} onChange={(e) => { setUserTypeFilter(e.target.value as "all"|"user"|"anon"); setPage(0); }}
                className="px-3 py-2 text-sm rounded-lg bg-background/40 border border-border outline-none focus:border-primary"
              >
                <option value="all">전체 유형</option>
                <option value="user">로그인 사용자</option>
                <option value="anon">익명</option>
              </select>
              <span className="text-xs text-muted-foreground">총 {(analysesData?.total ?? 0).toLocaleString()}건</span>
              <button
                onClick={downloadCSV}
                disabled={!analysesData?.rows.length}
                className="flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg border border-border hover:bg-surface-2 text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors ml-auto"
              >
                <Download className="w-3.5 h-3.5" />
                CSV
              </button>
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
                    <tr><td colSpan={6} className="text-center py-12"><RefreshCw className="w-5 h-5 animate-spin mx-auto text-muted-foreground" /></td></tr>
                  ) : (analysesData?.rows ?? []).length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-12 text-muted-foreground text-sm">검색 결과가 없습니다.</td></tr>
                  ) : (
                    (analysesData?.rows ?? []).map((row) => (
                      <tr key={row.id} className="border-b border-border/50 hover:bg-surface/40 transition-colors">
                        <td className="px-4 py-3 max-w-[220px]">
                          <Link to="/analysis/$id" params={{ id: row.id }} className="font-medium hover:text-primary transition-colors truncate block">
                            {row.title ?? "(제목 없음)"}
                          </Link>
                          {row.source_url && (
                            <a href={row.source_url} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 mt-0.5">
                              <ExternalLink className="w-3 h-3" />
                              <span className="truncate max-w-[160px]">{row.source_url}</span>
                            </a>
                          )}
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          <VerdictBadge verdict={row.overall_verdict ?? "근거 부족"} size="sm" />
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell">
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-1.5 rounded-full bg-border overflow-hidden">
                              <div className="h-full bg-primary rounded-full" style={{ width: `${row.overall_confidence}%` }} />
                            </div>
                            <span className="text-xs text-muted-foreground">{row.overall_confidence}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell text-xs text-muted-foreground">
                          {row.user_id
                            ? <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary">로그인</span>
                            : <span className="px-2 py-0.5 rounded-full bg-muted/30 text-muted-foreground">익명</span>}
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(row.created_at).toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => setDetailId(row.id)}
                              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
                              title="상세 보기"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => { if (confirm(`"${row.title}" 분석을 삭제할까요?`)) deleteMut.mutate(row.id); }}
                              disabled={deleteMut.isPending}
                              className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                              title="삭제"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
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
                <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="p-2 rounded-lg hover:bg-surface-2 text-muted-foreground disabled:opacity-40 transition-colors">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm text-muted-foreground">{page + 1} / {totalPages}</span>
                <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="p-2 rounded-lg hover:bg-surface-2 text-muted-foreground disabled:opacity-40 transition-colors">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── 사용자 관리 탭 ── */}
        {tab === "users" && (
          <div className="space-y-4">
            <div className="glass rounded-xl p-4 flex gap-3 items-center">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text" placeholder="이름 또는 이메일 검색…" value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-background/40 border border-border outline-none focus:border-primary"
                />
              </div>
              <span className="text-xs text-muted-foreground ml-auto">
                {usersLoading ? "로딩 중…" : `${filteredUsers.length}명`}
              </span>
            </div>

            <div className="glass rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground text-xs">
                    <th className="text-left px-4 py-3 font-medium">사용자</th>
                    <th className="text-left px-4 py-3 font-medium hidden md:table-cell">가입 방법</th>
                    <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">가입일</th>
                    <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">마지막 로그인</th>
                    <th className="text-left px-4 py-3 font-medium">분석 수</th>
                    <th className="text-left px-4 py-3 font-medium hidden md:table-cell">마지막 분석</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {usersLoading ? (
                    <tr><td colSpan={7} className="text-center py-12"><RefreshCw className="w-5 h-5 animate-spin mx-auto text-muted-foreground" /></td></tr>
                  ) : filteredUsers.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-12 text-muted-foreground text-sm">사용자가 없습니다.</td></tr>
                  ) : (
                    filteredUsers.map((u) => (
                      <tr key={u.id} className="border-b border-border/50 hover:bg-surface/40 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            {u.avatar_url
                              ? <img src={u.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                              : <div className="w-8 h-8 rounded-full bg-primary/20 grid place-items-center shrink-0 text-xs font-bold text-primary">
                                  {(u.full_name ?? u.email)[0].toUpperCase()}
                                </div>
                            }
                            <div className="min-w-0">
                              {u.full_name && <p className="font-medium text-sm truncate">{u.full_name}</p>}
                              <p className={`text-xs text-muted-foreground truncate ${!u.full_name ? "font-medium text-foreground text-sm" : ""}`}>{u.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            {u.provider === "google" ? <Globe className="w-3.5 h-3.5 text-blue-400" /> : <Mail className="w-3.5 h-3.5" />}
                            {u.provider === "google" ? "Google" : "이메일"}
                          </span>
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(u.created_at).toLocaleDateString("ko-KR")}
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell text-xs text-muted-foreground whitespace-nowrap">
                          {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" }) : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-sm font-semibold ${u.analysis_count > 0 ? "text-primary" : "text-muted-foreground"}`}>
                            {u.analysis_count.toLocaleString()}
                          </span>
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell text-xs text-muted-foreground whitespace-nowrap">
                          {u.last_analysis_at ? new Date(u.last_analysis_at).toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" }) : "—"}
                        </td>
                        <td className="px-4 py-3">
                          {u.analysis_count > 0 && (
                            <button
                              onClick={() => viewUserAnalyses(u.id)}
                              className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs border border-border hover:bg-surface-2 text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
                            >
                              <Eye className="w-3 h-3" />
                              분석 보기
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {/* ── API 키 관리 탭 ── */}
        {tab === "apikeys" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold">AI API 키 관리</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  활성화된 키가 AI 분석에 우선 사용됩니다. 환경 변수 GEMINI_API_KEY는 폴백으로 동작합니다.
                </p>
              </div>
              <button
                onClick={() => setAddKeyOpen(true)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-primary to-accent text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity shadow-[var(--shadow-glow)]"
              >
                <Plus className="w-4 h-4" />키 추가
              </button>
            </div>

            <div className="glass rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground text-xs">
                    <th className="text-left px-4 py-3 font-medium">이름</th>
                    <th className="text-left px-4 py-3 font-medium">프로바이더</th>
                    <th className="text-left px-4 py-3 font-medium hidden md:table-cell">키 (마스킹)</th>
                    <th className="text-left px-4 py-3 font-medium">상태</th>
                    <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">등록일</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {apiKeysLoading ? (
                    <tr><td colSpan={6} className="text-center py-12">
                      <RefreshCw className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
                    </td></tr>
                  ) : (apiKeys ?? []).length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-12">
                      <div className="flex flex-col items-center gap-3 text-muted-foreground">
                        <Key className="w-8 h-8 opacity-30" />
                        <p className="text-sm">등록된 API 키가 없습니다.</p>
                        <p className="text-xs">환경 변수 GEMINI_API_KEY가 폴백으로 사용됩니다.</p>
                      </div>
                    </td></tr>
                  ) : (apiKeys ?? []).map((key) => (
                    <tr key={key.id} className="border-b border-border/50 hover:bg-surface/40 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Key className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <span className="font-medium">{key.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <ProviderBadge provider={key.provider} />
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <code className="text-xs text-muted-foreground bg-surface-2 px-2 py-0.5 rounded font-mono">
                          ••••••••{key.key_hint}
                        </code>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => toggleKeyMut.mutate({ id: key.id, is_active: !key.is_active })}
                          disabled={toggleKeyMut.isPending}
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors disabled:opacity-50 ${
                            key.is_active
                              ? "bg-emerald-400/10 text-emerald-400 border border-emerald-400/30 hover:bg-emerald-400/20"
                              : "bg-border/30 text-muted-foreground border border-border hover:bg-surface-2"
                          }`}
                        >
                          <Power className="w-3 h-3" />
                          {key.is_active ? "활성" : "비활성"}
                        </button>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(key.created_at).toLocaleDateString("ko-KR")}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => { if (confirm(`"${key.name}" 키를 삭제할까요?`)) deleteKeyMut.mutate(key.id); }}
                          disabled={deleteKeyMut.isPending}
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                          title="삭제"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="glass rounded-xl p-4 text-xs text-muted-foreground leading-relaxed">
              <p className="font-medium text-foreground/70 mb-1">키 사용 우선순위</p>
              <p>1. DB에 등록된 <span className="text-emerald-400">활성</span> 키 중 가장 최근 등록 순 → 2. 환경 변수 <code className="bg-surface-2 px-1 rounded">GEMINI_API_KEY</code></p>
            </div>
          </div>
        )}

      </main>

      {/* API 키 추가 모달 */}
      {addKeyOpen && (
        <AddApiKeyModal
          onClose={() => setAddKeyOpen(false)}
          onSuccess={() => {
            setAddKeyOpen(false);
            qc.invalidateQueries({ queryKey: ["admin", "apikeys"] });
          }}
        />
      )}

      {/* 분석 상세 모달 */}
      {detailId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setDetailId(null)} />
          <div className="relative z-10 w-full max-w-2xl max-h-[85vh] overflow-y-auto glass rounded-2xl p-6">
            <button onClick={() => setDetailId(null)} className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-surface-2 text-muted-foreground hover:text-foreground transition-colors">
              <X className="w-4 h-4" />
            </button>

            {detailLoading ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : detailData ? (
              <div className="space-y-5">
                <div>
                  <div className="flex items-start gap-3 mb-2">
                    <VerdictBadge verdict={detailData.overall_verdict as string} />
                    <span className="text-xs text-muted-foreground mt-1">{detailData.overall_confidence}% 신뢰도</span>
                    <span className="text-xs text-muted-foreground mt-1 ml-auto">{new Date(detailData.created_at as string).toLocaleString("ko-KR")}</span>
                  </div>
                  <h2 className="text-xl font-bold">{detailData.title as string}</h2>
                  {detailData.summary && <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{detailData.summary as string}</p>}
                </div>

                {detailData.source_url && (
                  <a href={detailData.source_url as string} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-xs text-primary hover:underline">
                    <ExternalLink className="w-3.5 h-3.5" />{detailData.source_url as string}
                  </a>
                )}

                {/* 주장 목록 */}
                {Array.isArray(detailData.claims) && detailData.claims.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold">주장 분석 ({(detailData.claims as unknown[]).length}개)</h3>
                    {(detailData.claims as Array<{claim: string; verdict: string; confidence: number; reasoning: string}>).map((c, i) => (
                      <div key={i} className="rounded-xl border border-border/60 bg-background/30 p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`text-xs font-semibold ${VERDICT_TEXT[c.verdict] ?? "text-muted-foreground"}`}>{c.verdict}</span>
                          <span className="text-xs text-muted-foreground">·</span>
                          <span className="text-xs text-muted-foreground">{c.confidence}%</span>
                        </div>
                        <p className="text-sm font-medium mb-1">{c.claim}</p>
                        <p className="text-xs text-muted-foreground leading-relaxed">{c.reasoning}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* 원문 미리보기 */}
                {detailData.input_text && (
                  <CollapsibleSection title="입력 원문">
                    <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap line-clamp-6">
                      {detailData.input_text as string}
                    </p>
                  </CollapsibleSection>
                )}

                <div className="flex items-center justify-between pt-2 border-t border-border/50">
                  <span className="text-xs text-muted-foreground">
                    {(detailData as {user_id?: string}).user_id
                      ? <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary">로그인 사용자</span>
                      : <span className="px-2 py-0.5 rounded-full bg-muted/30 text-muted-foreground">익명</span>}
                  </span>
                  <Link
                    to="/analysis/$id"
                    params={{ id: detailId }}
                    className="text-xs text-primary hover:underline flex items-center gap-1"
                    onClick={() => setDetailId(null)}
                  >
                    전체 페이지에서 보기 <ExternalLink className="w-3 h-3" />
                  </Link>
                </div>
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-8">분석을 불러올 수 없습니다.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 서브 컴포넌트 ──

function StatCard({ icon, label, value, sub, color }: { icon: React.ReactNode; label: string; value: string | number; sub: string; color?: string }) {
  return (
    <div className="glass rounded-2xl p-5 flex flex-col gap-3">
      <div className={`flex items-center gap-2 ${color ?? "text-muted-foreground"}`}>{icon}<span className="text-xs font-medium text-muted-foreground">{label}</span></div>
      <p className="text-3xl font-display font-bold">{value}</p>
      <p className="text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}

function DailyChart({ data }: { data: { date: string; count: number }[] }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  const showLabel = data.length <= 10;
  return (
    <div className="flex items-end gap-1 h-32">
      {data.map(({ date, count }) => (
        <div key={date} className="flex-1 flex flex-col items-center gap-1 group min-w-0">
          <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
            {count}
          </span>
          <div
            className="w-full rounded-t-sm bg-primary/50 hover:bg-primary transition-all duration-300"
            style={{ height: `${Math.max(3, (count / max) * 88)}px` }}
          />
          {showLabel && (
            <span className="text-[9px] text-muted-foreground whitespace-nowrap">
              {new Date(date).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })}
            </span>
          )}
          {!showLabel && data.findIndex(d => d.date === date) % 5 === 0 && (
            <span className="text-[9px] text-muted-foreground whitespace-nowrap">
              {new Date(date).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function HourlyChart({ data }: { data: { hour: number; count: number }[] }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  const now = new Date().getHours();
  return (
    <div className="flex items-end gap-0.5 h-24">
      {data.map(({ hour, count }) => (
        <div key={hour} className="flex-1 flex flex-col items-center gap-1 group min-w-0">
          <div
            className={`w-full rounded-t-sm transition-all duration-300 ${hour === now ? "bg-accent" : "bg-primary/40 hover:bg-primary/70"}`}
            style={{ height: `${Math.max(2, (count / max) * 72)}px` }}
            title={`${hour}시: ${count}건`}
          />
          {hour % 6 === 0 && (
            <span className="text-[9px] text-muted-foreground">{hour}시</span>
          )}
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
              <div className={`h-full rounded-full transition-all duration-700 ${VERDICT_COLORS[v] ?? "bg-muted"}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs text-muted-foreground w-16 text-right">{count.toLocaleString()}건 ({pct}%)</span>
          </div>
        );
      })}
    </div>
  );
}

const PROVIDER_META: Record<string, { label: string; color: string; bg: string }> = {
  gemini:    { label: "Gemini",    color: "text-blue-400",   bg: "bg-blue-400/10 border-blue-400/30" },
  openai:    { label: "OpenAI",    color: "text-emerald-400", bg: "bg-emerald-400/10 border-emerald-400/30" },
  anthropic: { label: "Anthropic", color: "text-violet-400", bg: "bg-violet-400/10 border-violet-400/30" },
};

function ProviderBadge({ provider }: { provider: string }) {
  const meta = PROVIDER_META[provider] ?? { label: provider, color: "text-muted-foreground", bg: "bg-muted/30 border-border" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${meta.bg} ${meta.color}`}>
      {meta.label}
    </span>
  );
}

function AddApiKeyModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [name, setName] = useState("");
  const [provider, setProvider] = useState<"gemini" | "openai" | "anthropic">("gemini");
  const [keyValue, setKeyValue] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      await addApiKey({ data: { name, provider, key_value: keyValue } });
      onSuccess();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "등록 실패");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md glass rounded-2xl p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-primary" />
            <h2 className="text-lg font-semibold">API 키 추가</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-2 text-muted-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">이름</label>
            <input
              type="text"
              required
              placeholder="예: Gemini 운영 키"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={50}
              className="w-full px-3 py-2.5 rounded-lg bg-background/40 border border-border outline-none focus:border-primary text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">AI 프로바이더</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as typeof provider)}
              className="w-full px-3 py-2.5 rounded-lg bg-background/40 border border-border outline-none focus:border-primary text-sm"
            >
              <option value="gemini">Google Gemini</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">API 키 값</label>
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                required
                placeholder="sk-... 또는 AIza..."
                value={keyValue}
                onChange={(e) => setKeyValue(e.target.value)}
                minLength={10}
                className="w-full px-3 py-2.5 pr-10 rounded-lg bg-background/40 border border-border outline-none focus:border-primary text-sm font-mono"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                tabIndex={-1}
              >
                <Eye className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground">키 값은 서버에만 저장되며, 이후 마지막 4자리만 표시됩니다.</p>
          </div>

          {err && (
            <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2.5">
              <X className="w-3.5 h-3.5 shrink-0 mt-0.5" />{err}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-primary to-accent text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {loading ? "등록 중…" : "등록하기"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CollapsibleSection({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-border/60 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-surface/40 transition-colors"
      >
        {title}
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}
