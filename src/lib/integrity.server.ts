import { getEnv } from "./runtime-env.server";

type SignPayload = {
  id: string;
  overall_verdict: string;
  overall_confidence: number;
  claims: unknown;
};

export async function signAnalysisResult(p: SignPayload): Promise<string> {
  const key = getEnv("RESULT_SIGNING_KEY");
  if (!key) return "";
  try {
    const enc = new TextEncoder();
    const ck = await crypto.subtle.importKey(
      "raw",
      enc.encode(key),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const payload = JSON.stringify({
      id: p.id,
      v: p.overall_verdict,
      c: p.overall_confidence,
      claims: p.claims,
    });
    const sig = await crypto.subtle.sign("HMAC", ck, enc.encode(payload));
    return Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return "";
  }
}

export async function verifyAnalysisSignature(
  p: SignPayload & { stored_hash: string },
): Promise<"valid" | "invalid" | "unsigned"> {
  if (!p.stored_hash) return "unsigned";
  const expected = await signAnalysisResult(p);
  if (!expected) return "unsigned";
  return expected === p.stored_hash ? "valid" : "invalid";
}
