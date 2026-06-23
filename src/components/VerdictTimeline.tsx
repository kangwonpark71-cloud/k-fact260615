import { Clock, GitBranch, RotateCw } from "lucide-react";

import { VerdictBadge } from "./VerdictBadge";
import type { VerdictTimelineEntry } from "@/lib/analyses/reverify-helpers";

type Props = {
  readonly entries: readonly VerdictTimelineEntry[];
  readonly fallback?: {
    readonly overallVerdict: string;
    readonly overallConfidence: number;
    readonly createdAt?: string;
  };
};

function formatTime(value: string | undefined): string {
  if (!value) return "시간 정보 없음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "시간 정보 없음";
  return date.toLocaleString("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function triggerLabel(trigger: VerdictTimelineEntry["trigger"]): string {
  return trigger === "reverify" ? "재검증" : "초기 심층 검증";
}

export function VerdictTimeline({ entries, fallback }: Props) {
  const timeline = entries.length > 0 ? [...entries].reverse() : [];
  const fallbackEntry =
    timeline.length === 0 && fallback
      ? {
          recorded_at: fallback.createdAt ?? "",
          trigger: "initial" as const,
          overall_verdict: fallback.overallVerdict,
          overall_confidence: fallback.overallConfidence,
          claim_count: 0,
          claim_verdict_counts: {},
          phase2_model: "unknown",
          evidence_count: 0,
          source_count: 0,
        }
      : null;
  const display = fallbackEntry ? [fallbackEntry] : timeline;
  if (display.length === 0) return null;

  return (
    <div className="space-y-2 pt-3 mt-3 border-t border-border/40">
      <div className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground uppercase tracking-widest">
        <GitBranch className="w-3.5 h-3.5 text-primary/70" /> 판정 이력
      </div>
      {fallbackEntry && (
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          이전 버전에는 재검증 이력이 저장되지 않아 현재 판정만 표시합니다.
        </p>
      )}
      <ol aria-label="판정 이력 타임라인" className="space-y-2">
        {display.map((entry, index) => (
          <li
            key={`${entry.recorded_at}-${index}`}
            className="rounded-lg border border-border/40 bg-surface-2/30 px-2.5 py-2 text-xs space-y-1.5"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                {entry.trigger === "reverify" ? (
                  <RotateCw className="w-3 h-3 text-primary/60" />
                ) : (
                  <Clock className="w-3 h-3 text-primary/60" />
                )}
                {triggerLabel(entry.trigger)} · {formatTime(entry.recorded_at)}
              </span>
              <VerdictBadge verdict={entry.overall_verdict} size="sm" />
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span>
                신뢰도 <strong className="text-foreground/80">{entry.overall_confidence}%</strong>
              </span>
              {entry.claim_count > 0 && <span>주장 {entry.claim_count}건</span>}
              {entry.evidence_count > 0 && <span>근거 {entry.evidence_count}건</span>}
              {entry.source_count > 0 && <span>출처 {entry.source_count}건</span>}
              {entry.phase2_model !== "unknown" && <span>모델 {entry.phase2_model}</span>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
