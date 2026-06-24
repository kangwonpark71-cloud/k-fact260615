import { createServerFn } from "@tanstack/react-start";
import { getEnv } from "./runtime-env.server";
import { createClient } from "@supabase/supabase-js";

export type HeroPhase = {
  text: string;
  variant: "default" | "impact" | "natural";
};

export const getHeroPhases = createServerFn({ method: "GET" }).handler(async () => {
  const url = getEnv("SUPABASE_URL");
  const anonKey = getEnv("SUPABASE_PUBLISHABLE_KEY");
  if (!url || !anonKey) return getDefaultPhases();

  const supa = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await supa
    .from("hero_phases")
    .select("text, variant, sort_order")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error || !data || data.length === 0) return getDefaultPhases();
  return data.map((r) => ({
    text: r.text as string,
    variant: r.variant as "default" | "impact" | "natural",
  }));
});

function getDefaultPhases(): HeroPhase[] {
  return [
    { text: "올인원 Pass! 인공지능 언어 마스터 1기", variant: "default" },
    { text: "팩트체크AI", variant: "impact" },
    { text: '"사실"보다 "자극"에 더 쉽게 반응함', variant: "natural" },
    { text: '"진짜처럼 보이는 거짓"', variant: "default" },
  ];
}
