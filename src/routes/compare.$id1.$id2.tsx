import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, ArrowRight, BarChart3, AlertTriangle } from "lucide-react";

import { getAnalysis } from "@/lib/analyses.functions";
import { SiteHeader } from "@/components/SiteHeader";
import { VerdictBadge } from "@/components/VerdictBadge";
import { compareVerdict } from "@/lib/verdict";

export const Route = createFileRoute("/compare/$id1/$id2")({
  head: () => ({
    meta: [
      { title: "분석 비교 — 팩트체크" },
      { name: "description", content: "두 팩트체크 분석 결과를 비교합니다." },
    ],
  }),
  component: ComparePage,
});

type Claim = {
  claim: string;
  claim_type?: string;
  verdict: string;
  confidence: number;
  reasoning: string;
  supporting_points: string[];
  counter_points: string[];
  unknowns: string[];
  suggested_sources: { name: string; type: string }[];
};

function ClaimRow({ left, right, index }: { left: Claim; right: Claim | null; index: number }) {
  const verdictDiff = right ? compareVerdict(left.verdict, right.verdict) : "same";

  return (
    <div className="border border-border/40 bg-surface overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-2/50 border-b border-border/30">
        <span className="text-[10px] font-mono text-muted-foreground/60 tabular-nums">
          #{String(index).padStart(2, "0")}
        </span>
        <span className="text-xs font-medium text-foreground/80 truncate">{left.claim}</span>
      </div>
      <div className="grid grid-cols-2 divide-x divide-border/40">
        <div className="p-3 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <VerdictBadge verdict={left.verdict} size="sm" />
            <span className="text-xs text-muted-foreground tabular-nums">{left.confidence}%</span>
          </div>
          {left.reasoning && (
            <p className="text-[11px] text-foreground/65 leading-relaxed line-clamp-2">
              {left.reasoning}
            </p>
          )}
        </div>
        <div className="p-3 space-y-1.5">
          {right ? (
            <>
              <div className="flex items-center gap-1.5">
                <VerdictBadge verdict={right.verdict} size="sm" />
                <span className="text-xs text-muted-foreground tabular-nums">
                  {right.confidence}%
                </span>
              </div>
              {right.reasoning && (
                <p className="text-[11px] text-foreground/65 leading-relaxed line-clamp-2">
                  {right.reasoning}
                </p>
              )}
            </>
          ) : (
            <p className="text-[11px] text-muted-foreground/40 italic">매칭되는 주장 없음</p>
          )}
        </div>
      </div>
      {verdictDiff !== "same" && (
        <div className="px-3 py-1 bg-yellow-500/5 border-t border-yellow-500/20">
          <span
            className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border ${
              verdictDiff === "left"
                ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-400"
                : "border-red-400/40 bg-red-400/10 text-red-400"
            }`}
          >
            <BarChart3 className="w-3 h-3" />
            {verdictDiff === "left" ? "좌측 더 강함" : "우측 더 강함"}
          </span>
        </div>
      )}
    </div>
  );
}

function ComparePage() {
  const { id1, id2 } = Route.useParams();
  const fetchAnalysis = useServerFn(getAnalysis);

  const leftQuery = useQuery({
    queryKey: ["analysis", id1],
    queryFn: () => fetchAnalysis({ data: { id: id1, sessionId: "" } }),
    retry: false,
  });

  const rightQuery = useQuery({
    queryKey: ["analysis", id2],
    queryFn: () => fetchAnalysis({ data: { id: id2, sessionId: "" } }),
    retry: false,
  });

  const isLoading = leftQuery.isLoading || rightQuery.isLoading;
  const hasError = leftQuery.isError || rightQuery.isError;

  const left = leftQuery.data as Record<string, unknown> | undefined;
  const right = rightQuery.data as Record<string, unknown> | undefined;

  const getClaims = (data: Record<string, unknown> | undefined): Claim[] => {
    if (!data) return [];
    const raw = data.claims;
    if (Array.isArray(raw)) return raw as Claim[];
    return [];
  };

  const leftClaims = getClaims(left);
  const rightClaims = getClaims(right);

  const leftVerdict = (left?.overall_verdict as string) ?? "";
  const rightVerdict = (right?.overall_verdict as string) ?? "";
  const leftSummary = left?.summary as string | undefined;
  const rightSummary = right?.summary as string | undefined;
  const verdictDiff =
    leftVerdict && rightVerdict ? compareVerdict(leftVerdict, rightVerdict) : "same";

  if (isLoading) {
    return (
      <div className="min-h-screen">
        <SiteHeader />
        <main className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
          <div className="grid grid-cols-2 gap-6">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="rounded-xl border border-border/40 bg-surface p-6 animate-pulse space-y-3"
              >
                <div className="h-5 bg-surface-2 rounded w-2/3" />
                <div className="h-8 bg-surface-2 rounded w-1/3" />
                <div className="h-20 bg-surface-2 rounded" />
              </div>
            ))}
          </div>
        </main>
      </div>
    );
  }

  if (hasError) {
    return (
      <div className="min-h-screen">
        <SiteHeader />
        <main className="max-w-6xl mx-auto px-4 sm:px-6 py-12 text-center">
          <AlertTriangle className="w-10 h-10 text-destructive mx-auto mb-3" />
          <p className="text-sm text-muted-foreground mb-4">
            하나 이상의 분석을 불러올 수 없습니다.
          </p>
          <Link to="/history" className="text-accent text-sm hover:underline">
            히스토리로 돌아가기
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-16 sm:pb-0">
      <SiteHeader />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-6">
        <div className="flex items-center justify-between">
          <Link
            to="/history"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-4 h-4" /> 히스토리
          </Link>
          <span className="text-xs text-muted-foreground/60 tabular-nums">
            {leftClaims.length}개 vs {rightClaims.length}개 주장
          </span>
        </div>

        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">분석 결과 비교</h1>

        <div className="grid grid-cols-2 gap-4 sm:gap-6">
          <div className="rounded-xl border border-border/40 bg-surface p-4 sm:p-6">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground mb-1">분석 A</p>
                <p className="font-semibold text-sm leading-snug line-clamp-2">
                  {(left?.title as string) ?? "제목 없음"}
                </p>
              </div>
              <Link
                to="/analysis/$id"
                params={{ id: id1 }}
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
            <div className="flex items-center gap-2 mb-2">
              <VerdictBadge verdict={leftVerdict} size="md" />
              <span className="text-sm text-muted-foreground tabular-nums">
                {(left?.overall_confidence as number) ?? 0}%
              </span>
            </div>
            {leftSummary && (
              <p className="text-xs text-foreground/60 line-clamp-2">{leftSummary}</p>
            )}
          </div>

          <div className="rounded-xl border border-border/40 bg-surface p-4 sm:p-6">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground mb-1">분석 B</p>
                <p className="font-semibold text-sm leading-snug line-clamp-2">
                  {(right?.title as string) ?? "제목 없음"}
                </p>
              </div>
              <Link
                to="/analysis/$id"
                params={{ id: id2 }}
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
            <div className="flex items-center gap-2 mb-2">
              <VerdictBadge verdict={rightVerdict} size="md" />
              <span className="text-sm text-muted-foreground tabular-nums">
                {(right?.overall_confidence as number) ?? 0}%
              </span>
            </div>
            {rightSummary && (
              <p className="text-xs text-foreground/60 line-clamp-2">{rightSummary}</p>
            )}
          </div>
        </div>

        {verdictDiff !== "same" && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-yellow-500/5 border border-yellow-500/20 text-xs text-yellow-600 dark:text-yellow-400">
            <BarChart3 className="w-4 h-4 shrink-0" />
            <span>
              판정 차이: {verdictDiff === "left" ? "분석 A" : "분석 B"}의 판정이 더 강력합니다.
            </span>
          </div>
        )}

        {left && right && (
          <div className="flex items-center gap-4 px-4 py-2.5 rounded-lg bg-surface-2 border border-border/40">
            <span className="text-xs font-medium text-muted-foreground">신뢰도</span>
            <div className="flex-1 h-2 bg-border/30 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all"
                style={{
                  width: `${Math.abs(
                    ((left?.overall_confidence as number) ?? 0) -
                      ((right?.overall_confidence as number) ?? 0),
                  )}%`,
                }}
              />
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">
              {(left?.overall_confidence as number) ?? 0}% <ArrowRight className="w-3 h-3 inline" />{" "}
              {(right?.overall_confidence as number) ?? 0}%
            </span>
          </div>
        )}

        <div>
          <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-widest mb-3">
            주장별 비교
          </h2>
          <div className="space-y-2">
            {leftClaims.map((claim, i) => (
              <ClaimRow key={i} left={claim} right={rightClaims[i] ?? null} index={i + 1} />
            ))}
            {leftClaims.length === 0 && (
              <p className="text-sm text-muted-foreground italic text-center py-8">
                비교할 주장 데이터가 없습니다.
              </p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
