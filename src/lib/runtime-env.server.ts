// Cloudflare Workers bindings (secrets/vars) are only available via the `env`
// parameter passed to the fetch handler — not automatically in process.env.
// We store the raw env object here at the start of each request so that all
// server functions can read secrets reliably without depending on process.env.

let _cfEnv: Record<string, unknown> = {};

export function setCfEnv(env: unknown): void {
  if (env && typeof env === "object") {
    _cfEnv = env as Record<string, unknown>;
    console.log(
      "[k-fact] setCfEnv — keys:",
      Object.keys(_cfEnv).join(",") || "(none)",
      "| GEMINI_API_KEY in env:",
      "GEMINI_API_KEY" in _cfEnv,
      "| process.env GEMINI:",
      typeof process.env["GEMINI_API_KEY"],
    );
  }
}

export function getEnv(key: string): string | undefined {
  // Try Cloudflare env object first (covers secrets + vars)
  const cfVal = (_cfEnv as Record<string, unknown>)[key];
  if (typeof cfVal === "string" && cfVal.length > 0) return cfVal;
  // Fallback: nodejs_compat populates process.env with CF bindings
  const procVal = process.env[key];
  if (typeof procVal === "string" && procVal.length > 0) return procVal;
  return undefined;
}
