import type { StyleClassification } from "../pipeline.server";
import type { Phase1Claim } from "./types";

export type ReverifyOwnershipRow = {
  readonly session_id?: string | null;
  readonly user_id?: string | null;
};

export type ReverifyActor = {
  readonly sessionId: string;
  readonly userId: string | null;
};

export type ReverifyStoredPayload = {
  readonly claims?: unknown;
  readonly _phase1_model?: unknown;
  readonly audit_log?: unknown;
};

export type VerdictTimelineTrigger = "initial" | "reverify";

export type VerdictTimelineEntry = {
  readonly recorded_at: string;
  readonly trigger: VerdictTimelineTrigger;
  readonly overall_verdict: string;
  readonly overall_confidence: number;
  readonly claim_count: number;
  readonly claim_verdict_counts: Record<string, number>;
  readonly phase2_model: string;
  readonly evidence_count: number;
  readonly source_count: number;
  readonly integrity_hash?: string;
};

export type VerdictTimeline = {
  readonly version: 1;
  readonly entries: VerdictTimelineEntry[];
};

export type VerdictTimelineEntryInput = {
  readonly recordedAt: string;
  readonly trigger: VerdictTimelineTrigger;
  readonly overallVerdict: string;
  readonly overallConfidence: number;
  readonly claims: readonly Phase1Claim[];
  readonly phase2Model: string;
  readonly evidenceCount: number;
  readonly sourceCount: number;
  readonly integrityHash?: string;
};

const MAX_TIMELINE_ENTRIES = 10;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPhaseClaim(value: unknown): value is Phase1Claim {
  return isRecord(value) && typeof value.claim === "string" && typeof value.verdict === "string";
}

export function extractPhaseClaims(claims: unknown): Phase1Claim[] {
  if (Array.isArray(claims)) return claims.filter(isPhaseClaim);
  if (!isRecord(claims)) return [];
  const items = claims.items;
  return Array.isArray(items) ? items.filter(isPhaseClaim) : [];
}

export function canMutateAnalysis(row: ReverifyOwnershipRow, actor: ReverifyActor): boolean {
  if (actor.userId && row.user_id === actor.userId) return true;
  return !row.user_id && row.session_id === actor.sessionId;
}

export function resolvePhase1Model(payload: ReverifyStoredPayload): string {
  if (typeof payload._phase1_model === "string" && payload._phase1_model.length > 0) {
    return payload._phase1_model;
  }
  if (isRecord(payload.audit_log)) {
    const phase1 = payload.audit_log.phase1;
    if (isRecord(phase1) && typeof phase1.model === "string" && phase1.model.length > 0) {
      return phase1.model;
    }
  }
  return "unknown";
}

export function extractStyleClassification(claims: unknown): StyleClassification | undefined {
  if (!isRecord(claims)) return undefined;
  const styleClassification = claims.style_classification;
  return isRecord(styleClassification) ? (styleClassification as StyleClassification) : undefined;
}

function isTimelineEntry(value: unknown): value is VerdictTimelineEntry {
  return (
    isRecord(value) &&
    typeof value.recorded_at === "string" &&
    (value.trigger === "initial" || value.trigger === "reverify") &&
    typeof value.overall_verdict === "string" &&
    typeof value.overall_confidence === "number" &&
    typeof value.claim_count === "number" &&
    isRecord(value.claim_verdict_counts) &&
    typeof value.phase2_model === "string" &&
    typeof value.evidence_count === "number" &&
    typeof value.source_count === "number"
  );
}

export function extractVerdictTimeline(auditLog: unknown): VerdictTimelineEntry[] {
  if (!isRecord(auditLog)) return [];
  const timeline = auditLog.verdict_timeline;
  if (!isRecord(timeline) || timeline.version !== 1 || !Array.isArray(timeline.entries)) return [];
  return timeline.entries.filter(isTimelineEntry).slice(-MAX_TIMELINE_ENTRIES);
}

function countClaimVerdicts(claims: readonly Phase1Claim[]): Record<string, number> {
  return claims.reduce<Record<string, number>>((counts, claim) => {
    counts[claim.verdict] = (counts[claim.verdict] ?? 0) + 1;
    return counts;
  }, {});
}

export function buildVerdictTimelineEntry(input: VerdictTimelineEntryInput): VerdictTimelineEntry {
  return {
    recorded_at: input.recordedAt,
    trigger: input.trigger,
    overall_verdict: input.overallVerdict,
    overall_confidence: Math.round(input.overallConfidence),
    claim_count: input.claims.length,
    claim_verdict_counts: countClaimVerdicts(input.claims),
    phase2_model: input.phase2Model,
    evidence_count: Math.max(0, Math.round(input.evidenceCount)),
    source_count: Math.max(0, Math.round(input.sourceCount)),
    ...(input.integrityHash ? { integrity_hash: input.integrityHash } : {}),
  };
}

export function mergeVerdictTimeline(
  current: unknown,
  nextEntry: VerdictTimelineEntry,
): VerdictTimeline {
  const existing = Array.isArray((current as { entries?: unknown })?.entries)
    ? extractVerdictTimeline({ verdict_timeline: current })
    : extractVerdictTimeline(current);
  return { version: 1, entries: [...existing, nextEntry].slice(-MAX_TIMELINE_ENTRIES) };
}
