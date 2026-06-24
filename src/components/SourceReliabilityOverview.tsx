import { ShieldCheck, ShieldAlert, Info } from "lucide-react";

import type { SourceReliabilityTier } from "@/lib/source-reliability";
import type { ReviewedAuditSource } from "./AuditSourceList";

const TIER_META: Record<
  SourceReliabilityTier,
  { label: string; color: string; icon: typeof ShieldCheck }
> = {
  authoritative: { label: "공식·학술", color: "bg-verdict-true", icon: ShieldCheck },
  established: { label: "검증 언론", color: "bg-blue-500", icon: ShieldCheck },
  standard: { label: "일반 웹", color: "bg-muted-foreground/60", icon: Info },
  weak: { label: "플랫폼·커뮤니티", color: "bg-yellow-500", icon: ShieldAlert },
  unknown: { label: "출처 불명", color: "bg-muted/50", icon: ShieldAlert },
};

type TierCounts = Record<SourceReliabilityTier, number>;

function countTiers(sources: readonly ReviewedAuditSource[]): TierCounts {
  const counts: TierCounts = { authoritative: 0, established: 0, standard: 0, weak: 0, unknown: 0 };
  for (const s of sources) {
    const tier = s.reliability_tier ?? "unknown";
    if (tier in counts) counts[tier]++;
    else counts.unknown++;
  }
  return counts;
}

type Props = {
  readonly sources: readonly ReviewedAuditSource[];
};

export function SourceReliabilityOverview({ sources }: Props) {
  const counts = countTiers(sources);
  const total = sources.length;
  if (total === 0) return null;

  return (
    <div className="rounded-xl border border-border/50 bg-surface/30 p-4 space-y-3">
      <h4 className="text-xs font-semibold text-muted-foreground tracking-wide flex items-center gap-2">
        <ShieldCheck className="w-3.5 h-3.5" />
        출처 신뢰도 분포
      </h4>
      <div className="space-y-2">
        {(Object.keys(TIER_META) as SourceReliabilityTier[]).map((tier) => {
          const count = counts[tier];
          if (count === 0) return null;
          const meta = TIER_META[tier];
          const pct = Math.round((count / total) * 100);
          const Icon = meta.icon;
          return (
            <div key={tier} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 text-foreground/80">
                  <Icon className="w-3 h-3" />
                  {meta.label}
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {count}건 ({pct}%)
                </span>
              </div>
              <div className="h-2 rounded-full bg-muted/30 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${meta.color}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
