import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { ArrowLeft, ExternalLink, ThumbsUp, ThumbsDown, HelpCircle, BookOpen, Share2, Check } from "lucide-react";

import { getAnalysis } from "@/lib/analyses.functions";
import { getSessionId } from "@/lib/session";
import { SiteHeader } from "@/components/SiteHeader";
import { VerdictBadge } from "@/components/VerdictBadge";

export const Route = createFileRoute("/analysis/$id")({
  component: AnalysisPage,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="min-h-screen grid place-items-center p-6 text-center">
        <div>
          <h1 className="text-xl font-semibold mb-2">분석을 불러올 수 없습니다</h1>
          <p className="text-sm text-muted-foreground mb-4">{error.message}</p>
          <button
            onClick={() => { router.invalidate(); reset(); }}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm"
          >다시 시도</button>
        </div>
      </div>
    );
  },
  notFoundComponent: () => <div className="p-12 text-center">분석을 찾을 수 없습니다.</div>,
});

type Claim = {
  claim: string;
  verdict: string;
  confidence: number;
  reasoning: string;
  supporting_points: string[];
  counter_points: string[];
  unknowns: string[];
  suggested_sources: { name: string; type: string }[];
};

function AnalysisPage() {
  const { id } = Route.useParams();
  const fetchAnalysis = useServerFn(getAnalysis);
  const [sessionId, setSessionId] = useState<string>("");
  useEffect(() => { setSessionId(getSessionId()); }, []);
  const { data, isLoading } = useQuery({
    queryKey: ["analysis", id, sessionId],
    queryFn: () => fetchAnalysis({ data: { id, sessionId } }),
    enabled: !!sessionId,
  });

  if (isLoading || !data) {
    return (
      <div className="min-h-screen">
        <SiteHeader />
        <div className="max-w-4xl mx-auto px-6 py-20 text-center text-muted-foreground">분석 결과를 불러오는 중…</div>
      </div>
    );
  }

  const claims = (data.claims as unknown as Claim[]) ?? [];

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="max-w-4xl mx-auto px-6 py-12">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6">
          <ArrowLeft className="w-4 h-4" /> 새 분석
        </Link>

        {/* Header card */}
        <div className="glass rounded-2xl p-8 mb-8 shadow-[var(--shadow-card)]">
          <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
            <h1 className="text-3xl md:text-4xl font-bold leading-tight max-w-2xl">{data.title}</h1>
            <VerdictBadge verdict={data.overall_verdict ?? "미확인"} size="lg" />
          </div>
          <p className="text-muted-foreground leading-relaxed mb-6">{data.summary}</p>

          <div className="flex items-center gap-6 flex-wrap text-sm">
            <ConfidenceBar value={data.overall_confidence ?? 0} />
            {data.source_url && (
              <a href={data.source_url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-primary transition-colors">
                <ExternalLink className="w-3.5 h-3.5" />
                원문 보기
              </a>
            )}
            <span className="text-muted-foreground text-xs ml-auto">
              {new Date(data.created_at).toLocaleString("ko-KR")}
            </span>
            <ShareButton />
          </div>
        </div>

        {/* Claims */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider px-1">
            검출된 주장 {claims.length}건
          </h2>
          {claims.map((c, i) => (
            <ClaimCard key={i} index={i + 1} claim={c} />
          ))}
        </div>

        <div className="mt-10 p-5 rounded-xl bg-surface/50 border border-border text-xs text-muted-foreground leading-relaxed">
          이 결과는 AI 보조 판단이며 단정적 사실확인이 아닙니다. 신뢰도와 미확인 항목을 함께 참고하고,
          중요한 의사결정 전에는 표기된 출처 유형의 1차 자료를 직접 확인하세요.
        </div>
      </main>
    </div>
  );
}

function ShareButton() {
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      await navigator.share({ title: "K-Fact 분석 결과", url });
    } else {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <button
      type="button"
      onClick={handleShare}
      className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-primary transition-colors text-sm"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-verdict-true" /> : <Share2 className="w-3.5 h-3.5" />}
      {copied ? "복사됨!" : "공유"}
    </button>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const color =
    value >= 70 ? "bg-verdict-true" : value >= 40 ? "bg-verdict-partial" : "bg-verdict-false";
  return (
    <div className="flex items-center gap-3 min-w-[180px]">
      <span className="text-xs text-muted-foreground">신뢰도</span>
      <div className="flex-1 h-1.5 rounded-full bg-surface-2 overflow-hidden min-w-[100px]">
        <div className={`h-full ${color} transition-all`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-sm font-medium tabular-nums">{value}%</span>
    </div>
  );
}

function ClaimCard({ index, claim }: { index: number; claim: Claim }) {
  return (
    <article className="glass rounded-xl p-6 shadow-[var(--shadow-card)]">
      <div className="flex items-start gap-4 mb-3">
        <span className="shrink-0 w-7 h-7 rounded-lg bg-surface-2 text-xs font-mono grid place-items-center text-muted-foreground">
          {String(index).padStart(2, "0")}
        </span>
        <div className="flex-1">
          <p className="text-base font-medium leading-snug mb-2">{claim.claim}</p>
          <div className="flex items-center gap-3 flex-wrap">
            <VerdictBadge verdict={claim.verdict} size="sm" />
            <ConfidenceBar value={claim.confidence} />
          </div>
        </div>
      </div>

      <p className="text-sm text-muted-foreground leading-relaxed pl-11 mb-4">{claim.reasoning}</p>

      <div className="pl-11 grid md:grid-cols-2 gap-3">
        {claim.supporting_points.length > 0 && (
          <PointList Icon={ThumbsUp} title="지지 근거" items={claim.supporting_points} tone="true" />
        )}
        {claim.counter_points.length > 0 && (
          <PointList Icon={ThumbsDown} title="반박 가능성" items={claim.counter_points} tone="false" />
        )}
        {claim.unknowns.length > 0 && (
          <PointList Icon={HelpCircle} title="미확인 항목" items={claim.unknowns} tone="unknown" />
        )}
        {claim.suggested_sources.length > 0 && (
          <PointList
            Icon={BookOpen}
            title="확인 권장 출처"
            items={claim.suggested_sources.map((s) => `${s.name} (${s.type})`)}
            tone="weak"
          />
        )}
      </div>
    </article>
  );
}

function PointList({
  Icon, title, items, tone,
}: {
  Icon: typeof ThumbsUp;
  title: string;
  items: string[];
  tone: "true" | "false" | "unknown" | "weak";
}) {
  const colorClass = {
    true: "text-verdict-true",
    false: "text-verdict-false",
    unknown: "text-verdict-partial",
    weak: "text-primary",
  }[tone];

  return (
    <div className="bg-background/40 rounded-lg p-3.5">
      <div className={`flex items-center gap-1.5 text-xs font-semibold mb-2 ${colorClass}`}>
        <Icon className="w-3.5 h-3.5" />
        {title}
      </div>
      <ul className="space-y-1.5">
        {items.map((p, i) => (
          <li key={i} className="text-sm text-foreground/80 leading-relaxed flex gap-1.5">
            <span className="text-muted-foreground/50">·</span>
            <span>{p}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
