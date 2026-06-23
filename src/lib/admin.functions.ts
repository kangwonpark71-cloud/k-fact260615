import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getEnv } from "./runtime-env.server";
import { encryptSecret, decryptSecret } from "./crypto.server";

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
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const weekAgo = new Date(Date.now() - 7 * 86400000);
  const monthAgo = new Date(Date.now() - 30 * 86400000);

  const [totalRes, todayRes, weekRes, monthRes, summaryRes, recentRes] = await Promise.all([
    supabaseAdmin.from("analyses").select("id", { count: "exact", head: true }),
    supabaseAdmin
      .from("analyses")
      .select("id", { count: "exact", head: true })
      .gte("created_at", todayStart.toISOString()),
    supabaseAdmin
      .from("analyses")
      .select("id", { count: "exact", head: true })
      .gte("created_at", weekAgo.toISOString()),
    supabaseAdmin
      .from("analyses")
      .select("id", { count: "exact", head: true })
      .gte("created_at", monthAgo.toISOString()),
    // DB 집계 RPC: verdict 분포·평균신뢰도·고유 사용자/세션을 한 번에
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabaseAdmin as any).rpc("get_admin_stats_summary"),
    // 최근 30일 created_at (일별 + 시간별 차트용)
    supabaseAdmin
      .from("analyses")
      .select("created_at")
      .gte("created_at", monthAgo.toISOString())
      .order("created_at", { ascending: true }),
  ]);

  type StatsSummary = {
    verdict_counts: Record<string, number>;
    avg_confidence: number;
    unique_users: number;
    unique_sessions: number;
  };
  const summary = summaryRes.data as StatsSummary | null;
  const verdictCounts: Record<string, number> = summary?.verdict_counts ?? {};
  const avgConfidence = summary?.avg_confidence ?? 0;
  const uniqueUsers = summary?.unique_users ?? 0;
  const uniqueSessions = summary?.unique_sessions ?? 0;

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

// ── 출처 신뢰도 통계 ──
export const getAdminSourceStats = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString();

  try {
    const { data } = await supabaseAdmin
      .from("analyses")
      .select("audit_log")
      .eq("status", "completed")
      .gte("created_at", monthAgo)
      .not("audit_log", "is", null)
      .limit(200);

    const tierCounts: Record<string, number> = {
      authoritative: 0,
      established: 0,
      standard: 0,
      weak: 0,
      unknown: 0,
    };
    let totalSources = 0;
    let scoredCount = 0;

    for (const row of data ?? []) {
      const log = row.audit_log as Record<string, unknown> | null;
      const sources = (log?.phase2 as Record<string, unknown> | null)?.sources_reviewed as
        | Array<Record<string, unknown>>
        | undefined;
      if (!sources) continue;
      for (const src of sources) {
        totalSources++;
        const tier = src.reliability_tier as string | undefined;
        if (tier && tier in tierCounts) {
          tierCounts[tier]++;
          scoredCount++;
        }
      }
    }

    return {
      tierCounts,
      totalSources,
      scoredCount,
      unscoredCount: totalSources - scoredCount,
    };
  } catch {
    return {
      tierCounts: { authoritative: 0, established: 0, standard: 0, weak: 0, unknown: 0 },
      totalSources: 0,
      scoredCount: 0,
      unscoredCount: 0,
    };
  }
});

// ── 전체 분석 목록 (페이지네이션 + 필터) ──
export const getAdminAnalyses = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        page: z.number().int().min(0).default(0),
        pageSize: z.number().int().min(1).max(100).default(20),
        verdict: z.string().optional(),
        search: z.string().optional(),
        userType: z.enum(["all", "user", "anon"]).default("all"),
        userId: z.string().uuid().optional(),
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
    if (data.userId) query = query.eq("user_id", data.userId);

    const { data: rows, error, count } = await query;
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], total: count ?? 0 };
  });

// ── 분석 상세 (모달용) ──
export const adminGetAnalysisDetail = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("analyses")
      .select("*")
      .eq("id", data.id)
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

// ── 관리자 강제 삭제 ──
export const adminDeleteAnalysis = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("analyses").delete().eq("id", data.id);
    if (error) throw new Error("삭제 실패: " + error.message);
    return { deleted: true };
  });

// ── API 키 목록 (마스킹된 hint만 반환) ──
export const listApiKeys = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("api_keys")
    .select("id, name, provider, key_hint, is_active, created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
});

// ── API 키 등록 ──
export const addApiKey = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        name: z.string().min(1, "이름을 입력하세요.").max(50),
        provider: z.enum(["gemini", "openai", "anthropic"]),
        key_value: z.string().min(10, "키 값이 너무 짧습니다."),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const key_hint = data.key_value.slice(-4);
    const encrypted = await encryptSecret(data.key_value);
    const { error } = await supabaseAdmin.from("api_keys").insert({
      name: data.name,
      provider: data.provider,
      key_value: encrypted,
      key_hint,
    });
    if (error) throw new Error("키 등록 실패: " + error.message);
    return { success: true };
  });

// ── API 키 삭제 ──
export const deleteApiKey = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("api_keys").delete().eq("id", data.id);
    if (error) throw new Error("삭제 실패: " + error.message);
    return { deleted: true };
  });

// ── API 키 활성/비활성 토글 ──
export const toggleApiKey = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ id: z.string().uuid(), is_active: z.boolean() }).parse(input),
  )
  .handler(async ({ data }) => {
    await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("api_keys")
      .update({ is_active: data.is_active })
      .eq("id", data.id);
    if (error) throw new Error("업데이트 실패: " + error.message);
    return { updated: true };
  });

// ── 사용자 목록 (Supabase Auth) ──
export const getAdminUsers = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const [authRes, countRes, lastRes] = await Promise.all([
    supabaseAdmin.auth.admin.listUsers({ perPage: 1000 }),
    supabaseAdmin.from("analyses").select("user_id").not("user_id", "is", null),
    supabaseAdmin
      .from("analyses")
      .select("user_id, created_at")
      .not("user_id", "is", null)
      .order("created_at", { ascending: false }),
  ]);

  const countMap: Record<string, number> = {};
  for (const r of countRes.data ?? []) {
    const uid = r.user_id ?? "";
    if (uid) countMap[uid] = (countMap[uid] ?? 0) + 1;
  }

  const lastMap: Record<string, string> = {};
  for (const r of lastRes.data ?? []) {
    const uid = r.user_id ?? "";
    if (uid && !lastMap[uid]) lastMap[uid] = r.created_at as string;
  }

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

// ── 관리자 여부 확인 (이메일 하드코딩 없이 서버에서 검증) ──
export const checkIsAdmin = createServerFn({ method: "GET" }).handler(async () => {
  try {
    await requireAdmin();
    return true;
  } catch {
    return false;
  }
});

// ── 히어로 페이즈 (히어로 롤링 텍스트) ──

export type HeroPhaseRow = {
  id: number;
  text: string;
  variant: "default" | "impact" | "natural";
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export const listHeroPhases = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("hero_phases")
    .select("*")
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as HeroPhaseRow[];
});

export const addHeroPhase = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        text: z.string().min(1).max(200),
        variant: z.enum(["default", "impact", "natural"]),
        sort_order: z.number().int().min(0),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("hero_phases").insert({
      text: data.text,
      variant: data.variant,
      sort_order: data.sort_order,
    });
    if (error) throw new Error("페이즈 등록 실패: " + error.message);
    return { success: true };
  });

export const updateHeroPhase = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        id: z.number(),
        text: z.string().min(1).max(200).optional(),
        variant: z.enum(["default", "impact", "natural"]).optional(),
        sort_order: z.number().int().min(0).optional(),
        is_active: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.text !== undefined) updates.text = data.text;
    if (data.variant !== undefined) updates.variant = data.variant;
    if (data.sort_order !== undefined) updates.sort_order = data.sort_order;
    if (data.is_active !== undefined) updates.is_active = data.is_active;
    const { error } = await supabaseAdmin
      .from("hero_phases")
      .update(updates)
      .eq("id", data.id);
    if (error) throw new Error("페이즈 업데이트 실패: " + error.message);
    return { success: true };
  });

export const deleteHeroPhase = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ id: z.number() }).parse(input))
  .handler(async ({ data }) => {
    await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("hero_phases").delete().eq("id", data.id);
    if (error) throw new Error("삭제 실패: " + error.message);
    return { deleted: true };
  });
