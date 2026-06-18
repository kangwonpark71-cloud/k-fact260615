import { getEnv } from "./runtime-env.server";

export type ExternalFactCheck = {
  claim_text: string;
  claimant: string;
  rating: string;
  publisher: string;
  review_url: string;
  review_date?: string;
};

interface GFCClaimReview {
  publisher?: { name?: string };
  url?: string;
  textualRating?: string;
  reviewDate?: string;
}
interface GFCClaim {
  text?: string;
  claimant?: string;
  claimReview?: GFCClaimReview[];
}

/**
 * Google Fact Check Tools API로 교차 확인.
 * GOOGLE_FACTCHECK_API_KEY 없으면 빈 배열 반환 (graceful fallback).
 */
export async function fetchGoogleFactChecks(query: string): Promise<ExternalFactCheck[]> {
  const apiKey = getEnv("GOOGLE_FACTCHECK_API_KEY");
  if (!apiKey) return [];
  try {
    const params = new URLSearchParams({
      query: query.slice(0, 200),
      key: apiKey,
      languageCode: "ko",
      pageSize: "5",
    });
    const res = await fetch(
      `https://factchecktools.googleapis.com/v1alpha1/claims:search?${params}`,
      { signal: AbortSignal.timeout(6000) },
    );
    if (!res.ok) return [];
    const json = await res.json() as { claims?: GFCClaim[] };
    return (json.claims ?? [])
      .slice(0, 5)
      .map(c => ({
        claim_text:  c.text ?? "",
        claimant:    c.claimant ?? "",
        rating:      c.claimReview?.[0]?.textualRating ?? "",
        publisher:   c.claimReview?.[0]?.publisher?.name ?? "",
        review_url:  c.claimReview?.[0]?.url ?? "",
        review_date: c.claimReview?.[0]?.reviewDate,
      }))
      .filter(r => r.claim_text && r.rating);
  } catch { return []; }
}
