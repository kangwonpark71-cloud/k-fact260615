import { ExternalLink, Globe } from "lucide-react";

import type { SourceReliabilityTier } from "@/lib/source-reliability";

export type ReviewedAuditSource = {
  readonly url: string;
  readonly title?: string;
  readonly hostname?: string;
  readonly reliability_score?: number;
  readonly reliability_tier?: SourceReliabilityTier;
  readonly reliability_label?: string;
  readonly reliability_reasons?: string[];
};

const TIER_CLASS: Record<SourceReliabilityTier, string> = {
  authoritative: "bg-verdict-true/15 text-verdict-true border-verdict-true/30",
  established: "bg-primary/12 text-primary border-primary/30",
  standard: "bg-muted/60 text-muted-foreground border-border/50",
  weak: "bg-yellow-500/15 text-yellow-500 border-yellow-500/30",
  unknown: "bg-muted/50 text-muted-foreground border-border/40",
};

function sourceTitle(source: ReviewedAuditSource): string {
  if (source.title) return source.title;
  if (source.hostname) return source.hostname;
  try {
    return new URL(source.url).hostname.replace(/^www\./, "");
  } catch {
    return source.url;
  }
}

function reliabilityLabel(source: ReviewedAuditSource): string | null {
  if (typeof source.reliability_score !== "number" || !source.reliability_tier) return null;
  return `${source.reliability_score}/100 · ${source.reliability_label ?? source.reliability_tier}`;
}

export function AuditSourceList({ sources }: { readonly sources: readonly ReviewedAuditSource[] }) {
  return (
    <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
      {sources.map((source, index) => {
        const title = sourceTitle(source);
        const label = reliabilityLabel(source);
        const tierClass = source.reliability_tier
          ? TIER_CLASS[source.reliability_tier]
          : TIER_CLASS.unknown;
        return (
          <a
            key={`${source.url}-${index}`}
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-lg border border-border/40 bg-surface-2/40 px-2.5 py-2 hover:border-primary/30 hover:bg-surface-2 transition-colors"
          >
            <span className="flex items-start gap-2 min-w-0">
              <Globe className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary/60" />
              <span className="min-w-0 flex-1 space-y-1">
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="truncate text-xs text-foreground/80 font-medium">{title}</span>
                  <ExternalLink className="w-3 h-3 shrink-0 text-muted-foreground/60" />
                </span>
                <span className="block truncate text-[10px] text-muted-foreground/70">
                  {source.url}
                </span>
                {label && (
                  <span className="flex flex-wrap gap-1.5 pt-0.5">
                    <span
                      className={`px-1.5 py-0.5 rounded-full border text-[10px] font-semibold ${tierClass}`}
                    >
                      {label}
                    </span>
                    {(source.reliability_reasons ?? []).slice(0, 2).map((reason) => (
                      <span
                        key={reason}
                        className="px-1.5 py-0.5 rounded-full bg-background/50 border border-border/40 text-[10px] text-muted-foreground"
                      >
                        {reason}
                      </span>
                    ))}
                  </span>
                )}
              </span>
            </span>
          </a>
        );
      })}
    </div>
  );
}
