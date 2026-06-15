import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

async function requireAdmin(): Promise<string> {
  const auth = getRequestHeader("authorization");
  if (!auth?.toLowerCase().startsWith("bearer ")) throw new Error("로그인이 필요합니다.");
  const token = auth.slice(7).trim();
  const url = process.env.SUPABASE_URL!;
  const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY!;
  const supa = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data } = await supa.auth.getUser(token);
  const user = data.user;
  if (!user) throw new Error("인증 실패.");
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail || user.email !== adminEmail) throw new Error("관리자 권한이 필요합니다.");
  return user.id;
}

// ── 전체 통계 ──
export const getAdminStats = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [totalRes, todayRes, userRes, anonRes, verdictRes, confidenceRes, dailyRes] =
    await Promise.all([
      supabaseAdmin.from("analyses").select("id", { count: "exact", head: true }),
      supabaseAdmin
        .from("analyses")
        .select("id", { count: "exact", head: true })
        .gte("created_at", today.toISOString()),
      supabaseAdmin
        .from("analyses")
        .select("user_id")
        .not("user_id", "is", null),
      supabaseAdmin
        .from("analyses")
        .select("session_id")
        .is("user_id", null),
      supabaseAdmin.from("analyses").select("overall_verdict"),
      supabaseAdmin.from("analyses").select("overall_confidence"),
      // 최근 7일 일별
      supabaseAdmin
        .from("analyses")
        .select("created_at")
        .gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString())
        .order("created_at", { ascending: true }),
    ]);

  // 고유 사용자 수
  const uniqueUsers = new Set((userRes.data ?? []).map((r) => r.user_id)).size;
  const uniqueSessions = new Set((anonRes.data ?? []).map((r) => r.session_id)).size;

  // 판정 분포
  const verdictCounts: Record<string, number> = {};
  for (const row of verdictRes.data ?? []) {
    verdictCounts[row.overall_verdict] = (verdictCounts[row.overall_verdict] ?? 0) + 1;
  }

  // 평균 신뢰도
  const confidences = (confidenceRes.data ?? []).map((r) => r.overall_confidence as number);
  const avgConfidence =
    confidences.length > 0
      ? Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length)
      : 0;

  // 최근 7일 일별 집계
  const dailyMap: Record<string, number> = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    dailyMap[d.toISOString().slice(0, 10)] = 0;
  }
  for (const row of dailyRes.data ?? []) {
    const key = (row.created_at as string).slice(0, 10);
    if (key in dailyMap) dailyMap[key]++;
  }
  const daily = Object.entries(dailyMap).map(([date, count]) => ({ date, count }));

  return {
    total: totalRes.count ?? 0,
    today: todayRes.count ?? 0,
    uniqueUsers,
    uniqueSessions,
    avgConfidence,
    verdictCounts,
    daily,
  };
});

// ── 전체 분석 목록 (페이지네이션 + 필터) ──
export const getAdminAnalyses = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        page: z.number().int().min(0).default(0),
        pageSize: z.number().int().min(1).max(100).default(20),
        verdict: z.string().optional(),
        search: z.string().optional(),
        userType: z.enum(["all", "user", "anon"]).default("all"),
      })
      .parse(input),
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

    const { data: rows, error, count } = await query;
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], total: count ?? 0 };
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
