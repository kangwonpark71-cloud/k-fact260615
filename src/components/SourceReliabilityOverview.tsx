import { ShieldCheck, ShieldAlert, Info, AlertTriangle } from "lucide-react";
import { useState } from "react";

import type { SourceReliabilityTier, PoliticalLean } from "@/lib/source-reliability";
import { getPoliticalLean, POLITICAL_LEAN_META } from "@/lib/source-reliability";
import type { ReviewedAuditSource } from "./AuditSourceList";

const TIER_META: Record<
  SourceReliabilityTier,
  { label: string; color: string; icon: typeof ShieldCheck }
> = {
  authoritative: { label: "공식·학술", color: "bg-verdict-true", icon: ShieldCheck },
  established:   { label: "검증 언론", color: "bg-blue-500", icon: ShieldCheck },
  standard:      { label: "일반 웹",   color: "bg-muted-foreground/60", icon: Info },
  weak:          { label: "플랫폼·커뮤니티", color: "bg-yellow-500", icon: ShieldAlert },
  unknown:       { label: "출처 불명", color: "bg-muted/50", icon: ShieldAlert },
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

type LeanCounts = Partial<Record<PoliticalLean, number>>;

function countLeans(sources: readonly ReviewedAuditSource[]): LeanCounts {
  const counts: LeanCounts = {};
  for (const s of sources) {
    if (!s.url) continue;
    const lean = getPoliticalLean(s.url);
    if (!lean) continue;
    counts[lean] = (counts[lean] ?? 0) + 1;
  }
  return counts;
}

function detectEchoChamber(counts: LeanCounts, total: number): string | null {
  if (total < 3) return null;
  const dominated = (Object.entries(counts) as [PoliticalLean, number][])
    .filter(([lean]) => lean !== "공식기관" && lean !== "전문지" && lean !== "해외")
    .find(([, cnt]) => cnt / total >= 0.7);
  if (dominated) {
    const meta = POLITICAL_LEAN_META[dominated[0]];
    return `참고 출처의 ${Math.round((dominated[1] / total) * 100)}%가 ${meta.label} 매체에 집중되어 있습니다.`;
  }
  return null;
}

type Props = {
  readonly sources: readonly ReviewedAuditSource[];
};

export function SourceReliabilityOverview({ sources }: Props) {
  const [showBias, setShowBias] = useState(false);
  const counts = countTiers(sources);
  const total  = sources.length;
  if (total === 0) return null;

  const leanCounts   = countLeans(sources);
  const leanEntries  = (Object.entries(leanCounts) as [PoliticalLean, number][])
    .sort((a, b) => b[1] - a[1]);
  const leanTotal    = leanEntries.reduce((s, [, n]) => s + n, 0);
  const echoChamber  = detectEchoChamber(leanCounts, leanTotal);
  const hasBiasData  = leanEntries.length > 0;

  return (
    <div className="rounded-xl border border-border/50 bg-surface/30 p-4 space-y-3">
      {/* 탭 헤더 */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setShowBias(false)}
          className={`text-xs font-semibold flex items-center gap-1.5 pb-1 border-b-2 transition-colors ${
            !showBias ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          출처 신뢰도
        </button>
        {hasBiasData && (
          <button
            type="button"
            onClick={() => setShowBias(true)}
            className={`text-xs font-semibold flex items-center gap-1.5 pb-1 border-b-2 transition-colors ${
              showBias ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <BarChart className="w-3.5 h-3.5" />
            성향 편향 지도
            {echoChamber && (
              <span className="w-1.5 h-1.5 rounded-full bg-orange-400 inline-block" />
            )}
          </button>
        )}
      </div>

      {/* 신뢰도 분포 */}
      {!showBias && (
        <div className="space-y-2">
          {(Object.keys(TIER_META) as SourceReliabilityTier[]).map((tier) => {
            const count = counts[tier];
            if (count === 0) return null;
            const meta  = TIER_META[tier];
            const pct   = Math.round((count / total) * 100);
            const Icon  = meta.icon;
            return (
              <div key={tier} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 text-foreground/80">
                    <Icon className="w-3 h-3" />
                    {meta.label}
                  </span>
                  <span className="text-muted-foreground tabular-nums">{count}건 ({pct}%)</span>
                </div>
                <div className="h-2 rounded-full bg-muted/30 overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-500 ${meta.color}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 성향 편향 지도 */}
      {showBias && hasBiasData && (
        <div className="space-y-3">
          {/* 에코챔버 경고 */}
          {echoChamber && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-orange-500/10 border border-orange-500/30 text-xs text-orange-400">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{echoChamber}</span>
            </div>
          )}

          {/* 스펙트럼 바 */}
          <div className="space-y-1.5">
            {leanEntries.map(([lean, cnt]) => {
              const meta = POLITICAL_LEAN_META[lean];
              const pct  = leanTotal > 0 ? Math.round((cnt / leanTotal) * 100) : 0;
              return (
                <div key={lean} className="space-y-0.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-foreground/80">{meta.label}</span>
                    <span className="text-muted-foreground tabular-nums">{cnt}건 ({pct}%)</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted/30 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${pct}%`, background: meta.color }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* 정치 성향 스펙트럼 그래픽 */}
          {leanTotal >= 2 && (() => {
            const leanScore = (
              (leanCounts["보수"]     ?? 0) * -2 +
              (leanCounts["중도보수"] ?? 0) * -1 +
              (leanCounts["중립"]     ?? 0) *  0 +
              (leanCounts["중도진보"] ?? 0) *  1 +
              (leanCounts["진보"]     ?? 0) *  2
            ) / (leanTotal || 1);
            const pct = Math.round(((leanScore + 2) / 4) * 100);
            return (
              <div className="space-y-1 pt-1">
                <p className="text-[10px] text-muted-foreground">참고 출처 성향 무게 중심</p>
                <div className="relative h-3 rounded-full overflow-hidden"
                  style={{ background: "linear-gradient(to right, #ef4444, #f97316, #6b7280, #3b82f6, #8b5cf6)" }}
                >
                  <div
                    className="absolute top-0.5 w-2 h-2 rounded-full bg-white shadow border border-border/50 -translate-x-1/2 transition-all duration-700"
                    style={{ left: `${pct}%` }}
                  />
                </div>
                <div className="flex justify-between text-[9px] text-muted-foreground/60">
                  <span>보수</span><span>중립</span><span>진보</span>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function BarChart({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="9" width="3" height="6" rx="0.5" />
      <rect x="6" y="5" width="3" height="10" rx="0.5" />
      <rect x="11" y="2" width="3" height="13" rx="0.5" />
    </svg>
  );
}
