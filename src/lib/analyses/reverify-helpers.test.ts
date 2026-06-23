import { describe, expect, it } from "vitest";

import {
  buildVerdictTimelineEntry,
  canMutateAnalysis,
  extractPhaseClaims,
  extractVerdictTimeline,
  mergeVerdictTimeline,
  resolvePhase1Model,
} from "./reverify-helpers";

describe("extractPhaseClaims", () => {
  it("returns old array claims", () => {
    const claims = [{ claim: "독도는 한국 영토다", verdict: "사실" }];

    expect(extractPhaseClaims(claims)).toEqual(claims);
  });

  it("returns new claims.items", () => {
    const items = [{ claim: "백신은 자폐증을 유발한다", verdict: "반대 근거 우세" }];

    expect(extractPhaseClaims({ phase: 2, items })).toEqual(items);
  });

  it("returns an empty array for malformed claims", () => {
    expect(extractPhaseClaims({ phase: 2, items: "bad" })).toEqual([]);
    expect(extractPhaseClaims(null)).toEqual([]);
  });
});

describe("canMutateAnalysis", () => {
  it("allows anonymous session owner", () => {
    const result = canMutateAnalysis(
      { session_id: "session-1", user_id: null },
      { sessionId: "session-1", userId: null },
    );

    expect(result).toBe(true);
  });

  it("allows authenticated owner", () => {
    const result = canMutateAnalysis(
      { session_id: "session-1", user_id: "user-1" },
      { sessionId: "other-session", userId: "user-1" },
    );

    expect(result).toBe(true);
  });

  it("denies non-owner completed public analysis mutation", () => {
    const result = canMutateAnalysis(
      { session_id: "session-1", user_id: "user-1" },
      { sessionId: "session-2", userId: "user-2" },
    );

    expect(result).toBe(false);
  });
});

describe("resolvePhase1Model", () => {
  it("prefers explicit phase1 model and falls back to audit model", () => {
    expect(resolvePhase1Model({ _phase1_model: "gemini" })).toBe("gemini");
    expect(resolvePhase1Model({ audit_log: { phase1: { model: "openai" } } })).toBe("openai");
    expect(resolvePhase1Model({})).toBe("unknown");
  });
});

describe("verdict timeline helpers", () => {
  it("returns an empty timeline for legacy or malformed audit logs", () => {
    expect(extractVerdictTimeline(undefined)).toEqual([]);
    expect(extractVerdictTimeline({ verdict_timeline: { version: 1, entries: "bad" } })).toEqual(
      [],
    );
  });

  it("builds a compact verdict timeline entry", () => {
    const entry = buildVerdictTimelineEntry({
      recordedAt: "2026-06-23T10:00:00.000Z",
      trigger: "initial",
      overallVerdict: "부분 사실",
      overallConfidence: 72,
      claims: [
        { claim: "A", verdict: "사실" },
        { claim: "B", verdict: "근거 부족" },
        { claim: "C", verdict: "근거 부족" },
      ],
      phase2Model: "gemini",
      evidenceCount: 4,
      sourceCount: 2,
      integrityHash: "abc123",
    });

    expect(entry).toMatchObject({
      recorded_at: "2026-06-23T10:00:00.000Z",
      trigger: "initial",
      overall_verdict: "부분 사실",
      overall_confidence: 72,
      claim_count: 3,
      phase2_model: "gemini",
      evidence_count: 4,
      source_count: 2,
      integrity_hash: "abc123",
    });
    expect(entry.claim_verdict_counts).toEqual({ 사실: 1, "근거 부족": 2 });
  });

  it("appends a reverify snapshot while preserving existing entries", () => {
    const previous = buildVerdictTimelineEntry({
      recordedAt: "2026-06-23T10:00:00.000Z",
      trigger: "initial",
      overallVerdict: "근거 부족",
      overallConfidence: 40,
      claims: [],
      phase2Model: "unknown",
      evidenceCount: 0,
      sourceCount: 0,
    });
    const next = buildVerdictTimelineEntry({
      recordedAt: "2026-06-23T11:00:00.000Z",
      trigger: "reverify",
      overallVerdict: "사실",
      overallConfidence: 88,
      claims: [],
      phase2Model: "openai",
      evidenceCount: 3,
      sourceCount: 2,
    });

    const timeline = mergeVerdictTimeline({ version: 1, entries: [previous] }, next);

    expect(timeline.version).toBe(1);
    expect(timeline.entries).toEqual([previous, next]);
  });

  it("caps timeline length to the latest ten entries", () => {
    const entries = Array.from({ length: 11 }, (_, index) =>
      buildVerdictTimelineEntry({
        recordedAt: `2026-06-23T${String(index).padStart(2, "0")}:00:00.000Z`,
        trigger: "reverify",
        overallVerdict: "사실",
        overallConfidence: 80 + index,
        claims: [],
        phase2Model: "model",
        evidenceCount: index,
        sourceCount: index,
      }),
    );

    const timeline = mergeVerdictTimeline(
      { version: 1, entries: entries.slice(0, 10) },
      entries[10],
    );

    expect(timeline.entries).toHaveLength(10);
    expect(timeline.entries[0].recorded_at).toBe("2026-06-23T01:00:00.000Z");
    expect(timeline.entries[9].recorded_at).toBe("2026-06-23T10:00:00.000Z");
  });
});
