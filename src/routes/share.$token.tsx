import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  ArrowLeft, ExternalLink, ThumbsUp, ThumbsDown, HelpCircle,
  BookOpen, AlertTriangle, CheckCircle2, XCircle, MinusCircle, AlertCircle,
  Loader2, Share2,
} from "lucide-react";

import { getSharedAnalysis } from "@/lib/analyses.functions";
import { SiteHeader } from "@/components/SiteHeader";
import { VerdictBadge } from "@/components/VerdictBadge";

export const Route = createFileRoute("/share/$token")({
  component: SharedAnalysisPage,
  errorComponent: ({ error }) => (
    <div className="min-h-screen grid place-items-center p-6 text-center">
      <div>
        <h1 className="text-xl font-semibold mb-2">공유된 분석을 불러올 수 없습니다</h1>
        <p className="text-sm text-muted-foreground mb-4">{error.message}</p>
        <Link to="/" className="text-sm text-primary hover:underline">메인으로 돌아가기</Link>
      </div>
    </div>
  ),
  notFoundComponent: () => (
    <div className="p-12 text-center">
      <h2 className="text-lg font-semibold mb-2">찾을 수 없음</h2>
      <p className="text-sm text-muted-foreground mb-4">유효하지 않거나 만료된 공유 링크입니다.</p>
      <Link to="/" className="text-sm text-primary hover:underline">메인으로 돌아가기</Link>
    </div>
  ),
});

type Claim = {
  claim: string;
  claim_type?: string;
  verdict: string;
  confidence: number;
  reasoning: string;
  supporting_points?: string[];
  counter_points?: string[];
  evidence_urls?: string[];
};

const VERDICT_META: Record<string, { icon: typeof CheckCircle2; color: string; bg: string; border: string; label: string }> = {
  "사실":           { icon: CheckCircle2, color: "text-verdict-true",    bg: "bg-verdict-true/10",    border: "border-verdict-true/30",    label: "사실" },
  "부분 사실":      { icon: MinusCircle,  color: "text-verdict-partial", bg: "bg-verdict-partial/10", border: "border-verdict-partial/30", label: "부분 사실" },
  "근거 부족":      { icon: HelpCircle,   color: "text-verdict-weak",    bg: "bg-verdict-weak/10",    border: "border-verdict-weak/30",    label: "근거 부족" },
  "반대 근거 우세": { icon: XCircle,      color: "text-verdict-false",   bg: "bg-verdict-false/10",   border: "border-verdict-false/30",   label: "반대 근거 우세" },
};

function SharedAnalysisPage() {
  const { token } = Route.useParams();
  const [copied, setCopied] = useState(false);

  const { data: analysis, isLoading, error } = useQuery<Record<string, unknown>>({
    queryKey: ["shared-analysis", token],
    queryFn: () => getSharedAnalysis({ data: { token } }) as Promise<Record<string, unknown>>,
    retry: 1,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col">
        <SiteHeader />
        <div className="flex-1 grid place-items-center">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (error || !analysis) {
    return (
      <div className="min-h-screen flex flex-col">
        <SiteHeader />
        <div className="flex-1 grid place-items-center p-6 text-center">
          <AlertTriangle className="w-12 h-12 text-muted-foreground mb-4" />
          <h2 className="text-lg font-semibold mb-2">분석을 불러올 수 없습니다</h2>
          <p className="text-sm text-muted-foreground mb-4">{error?.message ?? "데이터를 찾을 수 없습니다."}</p>
          <Link to="/" className="text-sm text-primary hover:underline">메인으로 돌아가기</Link>
        </div>
      </div>
    );
  }

  const title = (analysis.title as string) ?? "분석 결과";
  const overallVerdict = (analysis.overall_verdict as string) ?? "근거 부족";
  const overallConfidence = (analysis.overall_confidence as number) ?? 0;
  const summary = (analysis.summary as string) ?? "";
  const createdAt = (analysis.created_at as string) ?? "";
  const claimsData = analysis.claims as Record<string, unknown> | null | undefined;
  const biasType = (claimsData?.bias_type as string) ?? "중립";
  const items: Claim[] = Array.isArray(claimsData?.items)
    ? (claimsData.items as Claim[])
    : [];

  const vm = VERDICT_META[overallVerdict] ?? VERDICT_META["근거 부족"];
  const VerdictIcon = vm.icon;

  const shareUrl = typeof window !== "undefined" ? window.location.href : "";
  const handleCopyLink = () => {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />

      <div className="bg-amber-50 dark:bg-amber-950/20 border-b border-amber-200 dark:border-amber-800/30 px-4 py-2 text-center text-xs text-amber-700 dark:text-amber-400">
        <Share2 className="w-3 h-3 inline-block mr-1.5" />
        공유된 분석 결과입니다
      </div>

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" />
            메인으로
          </Link>
          <button
            type="button"
            onClick={handleCopyLink}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {copied ? (
              <><CheckCircle2 className="w-4 h-4 text-green-500" /> 복사됨</>
            ) : (
              <><Share2 className="w-4 h-4" /> 링크 복사</>
            )}
          </button>
        </div>

        <div>
          <h1 className="text-xl font-bold mb-1">{title}</h1>
          {createdAt && (
            <p className="text-xs text-muted-foreground">
              {new Date(createdAt).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            </p>
          )}
        </div>

        <div className={`flex items-center gap-3 p-4 rounded-xl ${vm.bg} border ${vm.border}`}>
          <VerdictIcon className={`w-8 h-8 ${vm.color}`} />
          <div>
            <div className="flex items-center gap-2">
              <span className={`text-lg font-bold ${vm.color}`}>{overallVerdict}</span>
              <span className="text-sm text-muted-foreground">신뢰도 {overallConfidence}%</span>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">{summary}</p>
          </div>
        </div>

        {biasType !== "중립" && (
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-surface-2 text-sm">
            <BookOpen className="w-4 h-4 text-muted-foreground" />
            <span>텍스트 편향: <strong>{biasType}</strong></span>
          </div>
        )}

        {items.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-base font-semibold">주장별 분석 ({items.length}개)</h2>
            {items.map((claim, i) => {
              const cm = VERDICT_META[claim.verdict] ?? VERDICT_META["근거 부족"];
              const CIcon = cm.icon;
              return (
                <div key={i} className="p-4 rounded-xl border border-border/40 bg-surface space-y-3">
                  <div className="flex items-start gap-3">
                    <CIcon className={`w-5 h-5 mt-0.5 shrink-0 ${cm.color}`} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{claim.claim}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`text-xs font-semibold ${cm.color}`}>{claim.verdict}</span>
                        <span className="text-xs text-muted-foreground">신뢰도 {claim.confidence}%</span>
                        {claim.claim_type && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-2 text-muted-foreground">
                            {claim.claim_type}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {claim.reasoning && (
                    <p className="text-sm text-muted-foreground leading-relaxed">{claim.reasoning}</p>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {claim.supporting_points && claim.supporting_points.length > 0 && (
                      <div>
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <ThumbsUp className="w-3.5 h-3.5 text-green-600" />
                          <span className="text-xs font-semibold">지지 근거</span>
                        </div>
                        <ul className="space-y-1">
                          {claim.supporting_points.map((pt, j) => (
                            <li key={j} className="text-xs text-muted-foreground flex items-start gap-1.5">
                              <span className="text-green-600 mt-0.5">•</span>
                              <span>{pt}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {claim.counter_points && claim.counter_points.length > 0 && (
                      <div>
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <ThumbsDown className="w-3.5 h-3.5 text-red-600" />
                          <span className="text-xs font-semibold">반대 근거</span>
                        </div>
                        <ul className="space-y-1">
                          {claim.counter_points.map((pt, j) => (
                            <li key={j} className="text-xs text-muted-foreground flex items-start gap-1.5">
                              <span className="text-red-600 mt-0.5">•</span>
                              <span>{pt}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  {claim.evidence_urls && claim.evidence_urls.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {claim.evidence_urls.map((url, j) => (
                        <a key={j} href={url} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-surface-2 hover:bg-border/40 transition-colors text-muted-foreground"
                        >
                          <ExternalLink className="w-3 h-3" />
                          {new URL(url).hostname.replace("www.", "").slice(0, 20)}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>

      <footer className="border-t border-border/40 py-4 text-center text-xs text-muted-foreground">
        FactGuard 팩트체크 · 공유된 분석 결과
      </footer>
    </div>
  );
}
