import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getEnv } from "./runtime-env.server";

async function requireAdmin(): Promise<string> {
  const auth = getRequestHeader("authorization");
  if (!auth?.toLowerCase().startsWith("bearer ")) throw new Error("로그인이 필요합니다.");
  const token = auth.slice(7).trim();
  const url = getEnv("SUPABASE_URL")!;
  const anonKey = getEnv("SUPABASE_PUBLISHABLE_KEY")!;
  const supa = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data } = await supa.auth.getUser(token);
  const user = data.user;
  if (!user) throw new Error("인증 실패.");
  const adminEmail = getEnv("ADMIN_EMAIL");
  if (!adminEmail || user.email !== adminEmail) throw new Error("관리자 권한이 필요합니다.");
  return user.id;
}

// ── 전체 통계 (30일 트렌드 + 시간별 + 주간/월간) ──
export const getAdminStats = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const weekAgo = new Date(Date.now() - 7 * 86400000);
  const monthAgo = new Date(Date.now() - 30 * 86400000);

  const [totalRes, todayRes, weekRes, monthRes, userRes, anonRes, verdictRes, confidenceRes, recentRes] =
    await Promise.all([
      supabaseAdmin.from("analyses").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("analyses").select("id", { count: "exact", head: true })
        .gte("created_at", todayStart.toISOString()),
      supabaseAdmin.from("analyses").select("id", { count: "exact", head: true })
        .gte("created_at", weekAgo.toISOString()),
      supabaseAdmin.from("analyses").select("id", { count: "exact", head: true })
        .gte("created_at", monthAgo.toISOString()),
      supabaseAdmin.from("analyses").select("user_id").not("user_id", "is", null),
      supabaseAdmin.from("analyses").select("session_id").is("user_id", null),
      supabaseAdmin.from("analyses").select("overall_verdict"),
      supabaseAdmin.from("analyses").select("overall_confidence"),
      // 최근 30일 데이터 (일별 + 시간별 모두 커버)
      supabaseAdmin.from("analyses").select("created_at")
        .gte("created_at", monthAgo.toISOString())
        .order("created_at", { ascending: true }),
    ]);

  const uniqueUsers = new Set((userRes.data ?? []).map((r) => r.user_id)).size;
  const uniqueSessions = new Set((anonRes.data ?? []).map((r) => r.session_id)).size;

  const verdictCounts: Record<string, number> = {};
  for (const row of verdictRes.data ?? []) {
    verdictCounts[row.overall_verdict] = (verdictCounts[row.overall_verdict] ?? 0) + 1;
  }

  const confidences = (confidenceRes.data ?? []).map((r) => r.overall_confidence as number);
  const avgConfidence = confidences.length > 0
    ? Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length) : 0;

  // 30일 일별 집계
  const daily30Map: Record<string, number> = {};
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    daily30Map[d.toISOString().slice(0, 10)] = 0;
  }
  // 오늘 24시간 시간별 집계
  const hourlyMap: Record<number, number> = {};
  for (let h = 0; h < 24; h++) hourlyMap[h] = 0;

  for (const row of recentRes.data ?? []) {
    const dt = new Date(row.created_at as string);
    const dateKey = dt.toISOString().slice(0, 10);
    if (dateKey in daily30Map) daily30Map[dateKey]++;
    if (dt >= todayStart) hourlyMap[dt.getHours()]++;
  }

  const daily30 = Object.entries(daily30Map).map(([date, count]) => ({ date, count }));
  const hourly = Object.entries(hourlyMap)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([hour, count]) => ({ hour: Number(hour), count }));

  return {
    total: totalRes.count ?? 0,
    today: todayRes.count ?? 0,
    week: weekRes.count ?? 0,
    month: monthRes.count ?? 0,
    uniqueUsers,
    uniqueSessions,
    avgConfidence,
    verdictCounts,
    daily30,
    hourly,
  };
});

// ── 전체 분석 목록 (페이지네이션 + 필터) ──
export const getAdminAnalyses = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({
      page: z.number().int().min(0).default(0),
      pageSize: z.number().int().min(1).max(100).default(20),
      verdict: z.string().optional(),
      search: z.string().optional(),
      userType: z.enum(["all", "user", "anon"]).default("all"),
      userId: z.string().uuid().optional(),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let query = supabaseAdmin
      .from("analyses")
      .select(
        "id, title, overall_verdict, overall_confidence, created_at, source_url, user_id, session_id, input_text",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(data.page * data.pageSize, (data.page + 1) * data.pageSize - 1);

    if (data.verdict) query = query.eq("overall_verdict", data.verdict);
    if (data.userType === "user") query = query.not("user_id", "is", null);
    if (data.userType === "anon") query = query.is("user_id", null);
    if (data.search) query = query.ilike("title", `%${data.search}%`);
    if (data.userId) query = query.eq("user_id", data.userId);

    const { data: rows, error, count } = await query;
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], total: count ?? 0 };
  });

// ── 분석 상세 (모달용) ──
export const adminGetAnalysisDetail = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("analyses").select("*").eq("id", data.id).single();
    if (error) throw new Error(error.message);
    return row;
  });

// ── 관리자 강제 삭제 ──
export const adminDeleteAnalysis = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("analyses").delete().eq("id", data.id);
    if (error) throw new Error("삭제 실패: " + error.message);
    return { deleted: true };
  });

// ── 사용자 목록 (Supabase Auth) ──
export const getAdminUsers = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const [authRes, countRes, lastRes] = await Promise.all([
    supabaseAdmin.auth.admin.listUsers({ perPage: 1000 }),
    supabaseAdmin.from("analyses").select("user_id").not("user_id", "is", null),
    supabaseAdmin.from("analyses")
      .select("user_id, created_at")
      .not("user_id", "is", null)
      .order("created_at", { ascending: false }),
  ]);

  const countMap: Record<string, number> = {};
  for (const r of countRes.data ?? []) countMap[r.user_id] = (countMap[r.user_id] ?? 0) + 1;

  const lastMap: Record<string, string> = {};
  for (const r of lastRes.data ?? []) if (!lastMap[r.user_id]) lastMap[r.user_id] = r.created_at as string;

  return (authRes.data?.users ?? [])
    .sort((a, b) => (countMap[b.id] ?? 0) - (countMap[a.id] ?? 0))
    .map((u) => ({
      id: u.id,
      email: u.email ?? "",
      full_name: (u.user_metadata?.full_name as string) ?? null,
      avatar_url: (u.user_metadata?.avatar_url as string) ?? null,
      provider: (u.app_metadata?.provider as string) ?? "email",
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at ?? null,
      analysis_count: countMap[u.id] ?? 0,
      last_analysis_at: lastMap[u.id] ?? null,
    }));
});
