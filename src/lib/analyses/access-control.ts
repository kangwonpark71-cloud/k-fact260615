import { getRequestHeader } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { getEnv, getCfBinding, getCfAIBinding } from "@/lib/runtime-env.server";
import { decryptSecret } from "@/lib/crypto.server";
import type { KeyEntry, SupportedProvider, KVNamespace } from "./types";

/* ── 멀티 키 관리 ── */

export async function getAllActiveKeys(): Promise<{ keys: KeyEntry[]; dbError?: string }> {
  const keys: KeyEntry[] = [];
  const supported: SupportedProvider[] = ["gemini", "openai", "anthropic"];
  let dbError: string | undefined;

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("api_keys")
      .select("provider, key_value")
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (error) {
      dbError = "DB오류: " + error.message;
    } else {
      for (const row of data ?? []) {
        if (supported.includes(row.provider as SupportedProvider)) {
          const key = await decryptSecret(row.key_value);
          keys.push({ provider: row.provider as SupportedProvider, key });
        }
      }
      if (keys.length === 0) dbError = "DB조회성공-키없음(등록된 활성키 0개)";
    }
  } catch (e) {
    dbError = "DB연결실패: " + (e instanceof Error ? e.message.slice(0, 100) : String(e));
  }

  const envFallbacks: Array<[SupportedProvider, string]> = [
    ["openai", "OPENAI_API_KEY"],
    ["anthropic", "ANTHROPIC_API_KEY"],
    ["gemini", "GEMINI_API_KEY"],
  ];
  for (const [provider, envName] of envFallbacks) {
    const val = getEnv(envName);
    if (val) keys.push({ provider, key: val });
  }

  return { keys, dbError };
}

/* ── 인증 ── */

export async function getOptionalUserId(): Promise<string | null> {
  try {
    const auth = getRequestHeader("authorization");
    if (!auth?.toLowerCase().startsWith("bearer ")) return null;
    const token = auth.slice(7).trim();
    if (!token) return null;
    const url = getEnv("SUPABASE_URL");
    const anonKey = getEnv("SUPABASE_PUBLISHABLE_KEY");
    if (!url || !anonKey) return null;
    const supa = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data } = await supa.auth.getUser(token);
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

/* ── SSRF 차단 ── */

export function validatePublicUrl(rawUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("유효하지 않은 URL입니다.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("http/https URL만 분석할 수 있습니다.");
  }
  const h = parsed.hostname.toLowerCase();

  // IPv6 리터럴 차단
  const ipv6Host = h.startsWith("[") ? h.slice(1, -1) : h.includes(":") ? h : null;
  if (ipv6Host !== null) {
    if (
      ipv6Host === "::" ||
      ipv6Host === "::1" ||
      /^fc/i.test(ipv6Host) ||
      /^fd/i.test(ipv6Host) ||
      /^fe[89ab]/i.test(ipv6Host) ||
      /^::ffff:/i.test(ipv6Host)
    )
      throw new Error("내부 주소는 분석할 수 없습니다.");
    return;
  }

  if (h === "localhost" || h === "0.0.0.0") {
    throw new Error("내부 주소는 분석할 수 없습니다.");
  }

  // 비표준 IP 인코딩 차단
  if (/^0x[0-9a-f]+$/i.test(h) || /^0\d+$/.test(h) || /^\d+$/.test(h)) {
    throw new Error("내부 IP 주소는 분석할 수 없습니다.");
  }

  // 표준 IPv4 — 모든 비공개 대역 차단
  const oct = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (oct) {
    const [a, b] = [Number(oct[1]), Number(oct[2])];
    if (
      a === 0 ||
      a === 127 ||
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    )
      throw new Error("내부 IP 주소는 분석할 수 없습니다.");
  }
}

/* ── KV 폴백 ── */

function getAnalysisKV(): KVNamespace | null {
  return getCfBinding<KVNamespace>("NEWS_CACHE");
}

export async function kvGet(id: string): Promise<Record<string, unknown> | null> {
  const kv = getAnalysisKV();
  if (!kv) return null;
  try {
    const result = await kv.get(`analysis:${id}`, "json");
    return result as Record<string, unknown> | null;
  } catch {
    return null;
  }
}

export async function kvPut(id: string, data: Record<string, unknown>): Promise<void> {
  const kv = getAnalysisKV();
  if (!kv) return;
  try {
    await kv.put(`analysis:${id}`, JSON.stringify(data), { expirationTtl: 3600 });
  } catch {
    // KV 저장 실패는 무시 (DB 폴백 있음)
  }
}

export async function kvGetRaw(key: string): Promise<Record<string, unknown> | null> {
  const kv = getAnalysisKV();
  if (!kv) return null;
  try {
    const result = await kv.get(key, "json");
    return result as Record<string, unknown> | null;
  } catch {
    return null;
  }
}

export async function kvPutRaw(
  key: string,
  data: Record<string, unknown>,
  ttlSec = 3600,
): Promise<void> {
  const kv = getAnalysisKV();
  if (!kv) return;
  try {
    await kv.put(key, JSON.stringify(data), { expirationTtl: ttlSec });
  } catch {
    // 무시
  }
}

/* ── Rate Limit ── */

const RATE_LIMIT_ANON = 10;
const RATE_LIMIT_USER = 30;

export async function checkRateLimit(sessionId: string, userId: string | null): Promise<void> {
  if (!getEnv("SUPABASE_SERVICE_ROLE_KEY")) return;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const base = supabaseAdmin
      .from("analyses")
      .select("id", { count: "exact", head: true })
      .gte("created_at", todayStart.toISOString());
    const { count, error } = await (userId
      ? base.eq("user_id", userId)
      : base.eq("session_id", sessionId));
    if (error) return;
    const limit = userId ? RATE_LIMIT_USER : RATE_LIMIT_ANON;
    if ((count ?? 0) >= limit) {
      throw new Error(`일일 분석 한도(${limit}건)에 도달했습니다. 내일 다시 시도하세요.`);
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes("일일 분석 한도")) throw e;
  }
}

/* ── URL 캐시 확인 ── */

export async function checkUrlCache(
  sourceUrl: string,
  sessionId: string,
  userId: string | null,
): Promise<string | null> {
  if (!getEnv("SUPABASE_SERVICE_ROLE_KEY")) return null;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    let query = supabaseAdmin
      .from("analyses")
      .select("id")
      .eq("source_url", sourceUrl)
      .eq("status", "completed")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1);
    if (userId) {
      query = query.eq("user_id", userId);
    } else {
      query = query.eq("session_id", sessionId).is("user_id", null);
    }
    const { data, error } = await query;
    if (error) return null;
    return data?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

/* ── 유사 텍스트 중복 분석 방지 ── */

export async function getRecentAnalyses(
  sessionId: string,
  userId: string | null,
  limit = 20,
): Promise<Array<{ id: string; inputText: string }>> {
  if (!getEnv("SUPABASE_SERVICE_ROLE_KEY")) return [];
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    let query = supabaseAdmin
      .from("analyses")
      .select("id, input_text")
      .eq("status", "completed")
      .gte("created_at", since)
      .not("input_text", "is", null)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (userId) {
      query = query.eq("user_id", userId);
    } else {
      query = query.eq("session_id", sessionId).is("user_id", null);
    }
    const { data, error } = await query;
    if (error || !data) return [];
    return data.map((row) => ({
      id: row.id,
      inputText: (row.input_text as string) ?? "",
    }));
  } catch {
    return [];
  }
}

/* ── URL 본문 fetch ── */

export async function fetchUrlBody(sourceUrl: string, fallback: string): Promise<string> {
  if (!sourceUrl || fallback.length >= 200) return fallback;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 5000);
    const res = await fetch(sourceUrl, {
      headers: { "User-Agent": "Mozilla/5.0 FactGuardBot" },
      redirect: "error",
      signal: ac.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return fallback;
    const html = await res.text();
    const stripped = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return stripped.length > fallback.length ? stripped.slice(0, 8000) : fallback;
  } catch {
    return fallback;
  }
}

/* ── AI 프로바이더 CF 폴백 ── */

export function getCfAIBindingOrNull(): unknown {
  return getCfAIBinding();
}

/* ── 텍스트 해시 (SHA-256) ── */

export async function hashText(text: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
