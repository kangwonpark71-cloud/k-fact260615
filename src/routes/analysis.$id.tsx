import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft, ExternalLink, ThumbsUp, ThumbsDown, HelpCircle,
  BookOpen, Share2, Check, ChevronDown, ChevronUp, FileText,
  AlertTriangle, CheckCircle2, XCircle, MinusCircle, AlertCircle,
} from "lucide-react";

import { getAnalysis } from "@/lib/analyses.functions";
import { getSessionId } from "@/lib/session";
import { SiteHeader, BottomNav } from "@/components/SiteHeader";
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

const VERDICT_META: Record<string, { icon: typeof CheckCircle2; color: string; bg: string; border: string; label: string }> = {
  "사실":           { icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-400/10", border: "border-emerald-400/30", label: "사실" },
  "부분 사실":      { icon: MinusCircle,  color: "text-yellow-400",  bg: "bg-yellow-400/10",  border: "border-yellow-400/30",  label: "부분 사실" },
  "근거 부족":      { icon: HelpCircle,   color: "text-orange-400",  bg: "bg-orange-400/10",  border: "border-orange-400/30",  label: "근거 부족" },
  "반대 근거 우세": { icon: XCircle,      color: "text-red-400",     bg: "bg-red-400/10",     border: "border-red-400/30",     label: "반대 근거 우세" },
  "미확인":         { icon: AlertCircle,  color: "text-slate-400",   bg: "bg-slate-400/10",   border: "border-slate-400/30",   label: "미확인" },
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
    // pending 상태면 2초마다 폴링
    refetchInterval: (q) => {
      const status = (q.state.data as { status?: string } | undefined)?.status;
      return status === "pending" ? 2000 : false;
    },
  });

  const status = (data as { status?: string } | undefined)?.status;
  const isPending = isLoading || !data || status === "pending";
  const isFailed = status === "failed";

  if (isPending) {
    return (
      <div className="min-h-screen pb-16 sm:pb-0">
        <SiteHeader />
        <BottomNav />
        <div className="max-w-4xl mx-auto px-6 py-24 text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto animate-pulse">
            <BookOpen className="w-8 h-8 text-primary" />
          </div>
          <p className="text-lg font-semibold">AI 분석 중…</p>
          <p className="text-sm text-muted-foreground">백그라운드에서 처리 중입니다. 잠시 기다려주세요.</p>
          <div className="flex justify-center gap-1.5 pt-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (isFailed) {
    return (
      <div className="min-h-screen pb-16 sm:pb-0">
        <SiteHeader />
        <BottomNav />
        <div className="max-w-4xl mx-auto px-6 py-24 text-center space-y-4">
          <AlertTriangle className="w-12 h-12 text-destructive mx-auto" />
          <p className="text-lg font-semibold">분석 실패</p>
          <p className="text-sm text-muted-foreground">{(data as { summary?: string })?.summary ?? "AI 분석 중 오류가 발생했습니다."}</p>
          <Link to="/" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium mt-4">
            <ArrowLeft className="w-4 h-4" /> 다시 시도
          </Link>
        </div>
      </div>
    );
  }

  const claims = (data.claims as unknown as Claim[]) ?? [];

  return (
    <div className="min-h-screen pb-16 sm:pb-0">
      <SiteHeader />
      <BottomNav />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-5">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> 새 분석
        </Link>

        {/* ① 헤더 카드 */}
        <div className="glass rounded-2xl p-5 sm:p-8 shadow-[var(--shadow-card)]">
          <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
            <h1 className="text-xl sm:text-3xl font-bold leading-tight max-w-2xl">{data.title}</h1>
            <VerdictBadge verdict={data.overall_verdict ?? "미확인"} size="lg" />
          </div>
          <p className="text-sm sm:text-base text-muted-foreground leading-relaxed mb-5">{data.summary}</p>

          <div className="flex items-center gap-4 flex-wrap text-sm">
            <ConfidenceBar value={data.overall_confidence ?? 0} />
            {data.source_url && (
              <a href={data.source_url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-primary transition-colors text-xs sm:text-sm">
                <ExternalLink className="w-3.5 h-3.5" /> 원문 보기
              </a>
            )}
            <span className="text-muted-foreground text-xs ml-auto">
              {new Date(data.created_at).toLocaleString("ko-KR")}
            </span>
            <ShareButton />
          </div>
        </div>

        {/* ② 원문 요약 (접기/펼치기) */}
        {data.input_text && (
          <InputSummary text={data.input_text as string} />
        )}

        {/* ③ 주장 한눈에 보기 */}
        {claims.length > 0 && <ClaimOverview claims={claims} />}

        {/* ④ 상세 주장 카드 */}
        <section className="space-y-3">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
            주장별 상세 분석
          </h2>
          {claims.map((c, i) => (
            <ClaimCard key={i} index={i + 1} claim={c} />
          ))}
        </section>

        <p className="text-xs text-muted-foreground leading-relaxed p-4 rounded-xl border border-border/50 bg-surface/30">
          이 결과는 AI 보조 판단이며 단정적 사실확인이 아닙니다. 신뢰도와 미확인 항목을 함께 참고하고,
          중요한 의사결정 전에는 표기된 출처 유형의 1차 자료를 직접 확인하세요.
        </p>
      </main>
    </div>
  );
}

/* ── 원문 요약 ── */
function InputSummary({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const preview = text.slice(0, 200).trimEnd();
  const hasMore = text.length > 200;

  return (
    <div className="glass rounded-xl border border-border/50 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2.5 px-4 sm:px-5 py-3.5 text-left hover:bg-surface/40 transition-colors"
      >
        <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
        <span className="text-sm font-medium flex-1">분석 원문</span>
        <span className="text-xs text-muted-foreground mr-1">{text.length.toLocaleString()}자</span>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>
      {open && (
        <div className="px-4 sm:px-5 pb-4 pt-1">
          <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap break-words">
            {text}
          </p>
        </div>
      )}
      {!open && (
        <div className="px-4 sm:px-5 pb-3">
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 opacity-70">
            {preview}{hasMore ? "…" : ""}
          </p>
        </div>
      )}
    </div>
  );
}

/* ── 출처 URL 생성 ── */
function generateSourceUrl(name: string, type: string, claim: string): string {
  const q = encodeURIComponent(`${name} ${claim.slice(0, 60)}`);
  const n = name.toLowerCase();
  // 알려진 한국 기관 직접 링크
  if (n.includes("통계청"))      return `https://kostat.go.kr/search/search.es?mid=b80001&query=${encodeURIComponent(claim.slice(0, 40))}`;
  if (n.includes("국세청"))      return `https://www.nts.go.kr/nts/main.do`;
  if (n.includes("식품의약품안전처") || n.includes("식약처")) return `https://www.mfds.go.kr`;
  if (n.includes("보건복지부"))  return `https://www.mohw.go.kr`;
  if (n.includes("기획재정부"))  return `https://www.moef.go.kr`;
  if (n.includes("질병관리청") || n.includes("질병청")) return `https://www.kdca.go.kr`;
  if (n.includes("법제처"))      return `https://www.moleg.go.kr`;
  if (n.includes("국회"))        return `https://www.assembly.go.kr`;
  if (n.includes("대통령실") || n.includes("청와대")) return `https://www.president.go.kr`;
  if (n.includes("연합뉴스"))    return `https://www.yna.co.kr/search/index?query=${encodeURIComponent(claim.slice(0, 40))}`;
  if (n.includes("뉴시스"))      return `https://www.newsis.com/realnews/?search=${encodeURIComponent(claim.slice(0, 40))}`;
  if (n.includes("조선일보"))    return `https://www.chosun.com/nsearch/?query=${encodeURIComponent(claim.slice(0, 40))}`;
  if (n.includes("동아일보"))    return `https://www.donga.com/news/search?query=${encodeURIComponent(claim.slice(0, 40))}`;
  if (n.includes("한겨레"))      return `https://www.hani.co.kr/arti/search?searchterm=${encodeURIComponent(claim.slice(0, 40))}`;
  if (n.includes("경향신문"))    return `https://www.khan.co.kr/search?search=${encodeURIComponent(claim.slice(0, 40))}`;
  if (n.includes("ytn"))         return `https://www.ytn.co.kr/search/search.php?s_key=${encodeURIComponent(claim.slice(0, 40))}`;
  if (n.includes("mbc"))         return `https://imnews.imbc.com/search/?kwd=${encodeURIComponent(claim.slice(0, 40))}`;
  if (n.includes("kbs"))         return `https://news.kbs.co.kr/search/search.html?q=${encodeURIComponent(claim.slice(0, 40))}`;
  if (n.includes("jtbc"))        return `https://news.jtbc.co.kr/search?query=${encodeURIComponent(claim.slice(0, 40))}`;
  if (n.includes("세계보건기구") || n.includes("who"))  return `https://www.who.int/search?query=${q}`;
  if (n.includes("유엔") || n.includes(" un ") || n === "un") return `https://www.un.org/en/search?search=${q}`;
  if (n.includes("나무위키"))    return `https://namu.wiki/Search?q=${encodeURIComponent(name)}`;
  if (n.includes("위키백과"))    return `https://ko.wikipedia.org/w/index.php?search=${encodeURIComponent(name)}`;
  // 유형 기반 폴백
  const t = type.toLowerCase();
  if (t.includes("정부") || t.includes("공공") || t.includes("기관")) return `https://www.google.com/search?q=${q}+site:go.kr`;
  if (t.includes("뉴스") || t.includes("언론") || t.includes("신문")) return `https://news.google.com/search?q=${q}&hl=ko&gl=KR&ceid=KR:ko`;
  if (t.includes("학술") || t.includes("연구") || t.includes("논문")) return `https://scholar.google.com/scholar?q=${q}`;
  return `https://www.google.com/search?q=${q}`;
}

/* ── 근거 링크 목록 ── */
function EvidenceLinks({
  title, icon: Icon, items, colorClass,
}: {
  title: string;
  icon: typeof ThumbsUp;
  items: { text: string; url?: string }[];
  colorClass: string;
}) {
  return (
    <div>
      <div className={`flex items-center gap-1.5 text-[10px] font-semibold mb-2 ${colorClass}`}>
        <Icon className="w-3 h-3" /> {title}
      </div>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-1.5">
            <span className="text-muted-foreground/40 shrink-0 mt-0.5 text-[10px]">·</span>
            {item.url ? (
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`text-[11px] leading-relaxed hover:underline underline-offset-2 inline-flex items-start gap-1 group ${colorClass} opacity-90 hover:opacity-100`}
                onClick={(e) => e.stopPropagation()}
              >
                <span className="flex-1">{item.text}</span>
                <ExternalLink className="w-2.5 h-2.5 shrink-0 mt-0.5 opacity-50 group-hover:opacity-100 transition-opacity" />
              </a>
            ) : (
              <span className={`text-[11px] leading-relaxed ${colorClass} opacity-80`}>{item.text}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── 주장 한눈에 보기 ── */
function ClaimOverview({ claims }: { claims: Claim[] }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [showUnknown, setShowUnknown] = useState(false);

  const verdictCount = claims.reduce<Record<string, number>>((acc, c) => {
    acc[c.verdict] = (acc[c.verdict] ?? 0) + 1;
    return acc;
  }, {});

  const indexed      = claims.map((c, i) => ({ c, i }));
  const mainClaims   = indexed.filter(({ c }) => c.verdict !== "미확인");
  const unknownClaims = indexed.filter(({ c }) => c.verdict === "미확인");
  const isHighlight  = (v: string) => v === "사실" || v === "반대 근거 우세";

  /* 공통 근거 패널 */
  function DetailPanel({ c, meta }: { c: Claim; meta: typeof VERDICT_META["사실"] }) {
    const hasDetail =
      !!c.reasoning ||
      c.supporting_points.length > 0 ||
      c.counter_points.length > 0 ||
      c.unknowns.length > 0 ||
      c.suggested_sources.length > 0;
    return (
      <div className={`rounded-b-lg border border-t-0 ${meta.border} bg-background/50 px-4 py-3 space-y-3`}>
        {c.reasoning && (
          <p className="text-xs text-muted-foreground leading-relaxed border-b border-border/30 pb-3">
            {c.reasoning}
          </p>
        )}
        {!hasDetail && (
          <div className="flex items-start gap-2 py-1">
            <AlertCircle className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              AI가 이 주장에 대한 충분한 근거를 확인하지 못했습니다.
              신뢰할 수 있는 기관의 1차 자료를 직접 검색해 보세요.
            </p>
          </div>
        )}
        <div className="grid sm:grid-cols-2 gap-3">
          {c.supporting_points.length > 0 && (
            <EvidenceLinks title="지지 근거" icon={ThumbsUp} colorClass="text-emerald-400"
              items={c.supporting_points.map(p => ({ text: p, url: `https://news.google.com/search?q=${encodeURIComponent(p.slice(0, 70))}&hl=ko&gl=KR&ceid=KR:ko` }))} />
          )}
          {c.counter_points.length > 0 && (
            <EvidenceLinks title="반박 가능성" icon={ThumbsDown} colorClass="text-red-400"
              items={c.counter_points.map(p => ({ text: p, url: `https://news.google.com/search?q=${encodeURIComponent(p.slice(0, 70))}&hl=ko&gl=KR&ceid=KR:ko` }))} />
          )}
          {c.suggested_sources.length > 0 && (
            <EvidenceLinks title="확인 권장 출처" icon={BookOpen} colorClass="text-primary"
              items={c.suggested_sources.map(s => ({ text: `${s.name}${s.type && s.type !== "일반" ? ` (${s.type})` : ""}`, url: generateSourceUrl(s.name, s.type, c.claim) }))} />
          )}
          {c.unknowns.length > 0 && (
            <EvidenceLinks title="미확인 항목" icon={AlertTriangle} colorClass="text-yellow-400"
              items={c.unknowns.map(u => ({ text: u, url: `https://www.google.com/search?q=${encodeURIComponent(u.slice(0, 70))}` }))} />
          )}
        </div>
        <p className="text-[10px] text-muted-foreground/40 pt-1">
          출처 링크는 검색 결과로 연결됩니다. 1차 자료를 직접 확인하세요.
        </p>
      </div>
    );
  }

  return (
    <div className="glass rounded-xl p-4 sm:p-5 shadow-[var(--shadow-card)]">
      <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        주장 한눈에 보기
      </h2>

      {/* 판정 분포 */}
      <div className="flex flex-wrap gap-2 mb-4">
        {Object.entries(verdictCount).map(([verdict, count]) => {
          const meta = VERDICT_META[verdict] ?? VERDICT_META["미확인"];
          const Icon = meta.icon;
          return (
            <span key={verdict} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold ${meta.bg} ${meta.border} ${meta.color}`}>
              <Icon className="w-3 h-3" /> {meta.label} {count}건
            </span>
          );
        })}
      </div>

      <p className="text-[10px] text-muted-foreground/50 mb-3">
        각 주장을 클릭하면 판정 근거와 출처 링크를 확인할 수 있습니다.
      </p>

      {/* 주장 목록 */}
      <div className="space-y-2">
        {mainClaims.map(({ c, i }) => {
          const meta = VERDICT_META[c.verdict] ?? VERDICT_META["미확인"];
          const Icon = meta.icon;
          const isExpanded = expandedIdx === i;
          const highlight = isHighlight(c.verdict);
          const glowClass = c.verdict === "사실"
            ? "shadow-[0_0_18px_rgba(52,211,153,0.18)] border-l-[3px] border-l-emerald-400"
            : c.verdict === "반대 근거 우세"
              ? "shadow-[0_0_18px_rgba(248,113,113,0.18)] border-l-[3px] border-l-red-400"
              : "";

          return (
            <div key={i} className={`rounded-lg overflow-hidden ${highlight ? glowClass : ""}`}>
              <button
                type="button"
                onClick={() => setExpandedIdx(isExpanded ? null : i)}
                className={`w-full flex items-start text-left transition-all cursor-pointer active:scale-[0.99] ${meta.bg} ${meta.border} border ${
                  highlight
                    ? "gap-3 px-4 py-4 hover:brightness-105"
                    : "gap-2.5 rounded-lg px-3 py-2.5 hover:brightness-110"
                }`}
              >
                {highlight ? (
                  /* 강조 아이콘 */
                  <div className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center border-2 ${meta.border} ${meta.bg} mt-0.5`}>
                    <Icon className={`w-4 h-4 ${meta.color}`} />
                  </div>
                ) : (
                  <span className="text-[10px] font-mono text-muted-foreground shrink-0 mt-0.5 w-4">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                )}

                <div className="flex-1 min-w-0">
                  {highlight && (
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold mb-1.5 ${meta.bg} ${meta.border} ${meta.color}`}>
                      <Icon className="w-2.5 h-2.5" />{meta.label}
                    </span>
                  )}
                  <p className={`leading-snug ${highlight ? "text-sm font-semibold text-foreground" : "text-xs text-foreground/90 leading-relaxed"}`}>
                    {c.claim}
                  </p>
                </div>

                <div className="flex items-center gap-1.5 shrink-0 ml-2 mt-0.5">
                  {!highlight && (
                    <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold ${meta.bg} ${meta.border} ${meta.color} ring-1 ring-current/20`}>
                      <Icon className="w-3 h-3" />
                      <span className="hidden sm:inline">{meta.label}</span>
                    </div>
                  )}
                  <span className={`tabular-nums font-bold ${highlight ? `text-sm ${meta.color}` : "text-[10px] text-muted-foreground"}`}>
                    {c.confidence}%
                  </span>
                  {isExpanded
                    ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                    : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                </div>
              </button>

              {isExpanded && <DetailPanel c={c} meta={meta} />}
            </div>
          );
        })}
      </div>

      {/* 미확인 섹션 — 기본 접힘 */}
      {unknownClaims.length > 0 && (
        <div className="mt-4 pt-3 border-t border-border/25">
          <button
            type="button"
            onClick={() => setShowUnknown(v => !v)}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-2/50 transition-colors text-left"
          >
            <AlertCircle className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <span className="text-[11px] text-muted-foreground/60 font-medium">
              미확인 {unknownClaims.length}건 — 근거 부족으로 판정 보류
            </span>
            <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground/40">
              {showUnknown ? "접기" : "펼치기"}
              {showUnknown
                ? <ChevronUp className="w-3 h-3" />
                : <ChevronDown className="w-3 h-3" />}
            </span>
          </button>

          {showUnknown && (
            <div className="mt-2 space-y-1.5 opacity-60">
              {unknownClaims.map(({ c, i }) => {
                const meta = VERDICT_META["미확인"];
                const Icon = meta.icon;
                const isExpanded = expandedIdx === i;
                return (
                  <div key={i}>
                    <button
                      type="button"
                      onClick={() => setExpandedIdx(isExpanded ? null : i)}
                      className={`w-full flex items-start gap-2.5 rounded-lg px-3 py-2 border text-left transition-all cursor-pointer hover:brightness-110 active:scale-[0.99] ${meta.bg} ${meta.border}`}
                    >
                      <span className="text-[10px] font-mono text-muted-foreground/60 shrink-0 mt-0.5 w-4">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <p className="text-xs text-foreground/50 flex-1 leading-relaxed">{c.claim}</p>
                      <div className="flex items-center gap-1.5 shrink-0 ml-2">
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[10px] font-semibold ${meta.bg} ${meta.border} ${meta.color}`}>
                          <Icon className="w-2.5 h-2.5" />
                          <span className="hidden sm:inline">{meta.label}</span>
                        </span>
                        <span className="text-[10px] text-muted-foreground/50 tabular-nums">{c.confidence}%</span>
                        {isExpanded
                          ? <ChevronUp className="w-3 h-3 text-muted-foreground/40" />
                          : <ChevronDown className="w-3 h-3 text-muted-foreground/40" />}
                      </div>
                    </button>
                    {isExpanded && <DetailPanel c={c} meta={meta} />}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── 상세 클레임 카드 (접기/펼치기) ── */
function ClaimCard({ index, claim }: { index: number; claim: Claim }) {
  const [expanded, setExpanded] = useState(false);
  const meta = VERDICT_META[claim.verdict] ?? VERDICT_META["미확인"];
  const Icon = meta.icon;

  const hasDetails =
    claim.reasoning ||
    claim.supporting_points.length > 0 ||
    claim.counter_points.length > 0 ||
    claim.unknowns.length > 0 ||
    claim.suggested_sources.length > 0;

  return (
    <article className={`glass rounded-xl shadow-[var(--shadow-card)] overflow-hidden border ${meta.border}`}>
      {/* 헤더 (항상 표시) */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        disabled={!hasDetails}
        className="w-full text-left px-4 sm:px-5 py-3.5 hover:bg-surface/30 transition-colors disabled:cursor-default"
      >
        <div className="flex items-start gap-3">
          <span className="shrink-0 w-6 h-6 rounded-md bg-surface-2 text-[10px] font-mono grid place-items-center text-muted-foreground mt-0.5">
            {String(index).padStart(2, "0")}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium leading-snug mb-2 pr-4">{claim.claim}</p>
            <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-semibold ${meta.bg} ${meta.border} ${meta.color}`}>
                <Icon className="w-3 h-3" /> {meta.label}
              </span>
              <ConfidenceBar value={claim.confidence} compact />
            </div>
          </div>
          {hasDetails && (
            <span className="shrink-0 text-muted-foreground mt-0.5">
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </span>
          )}
        </div>
      </button>

      {/* 상세 내용 (펼쳤을 때) */}
      {expanded && (
        <div className="px-4 sm:px-5 pb-4 pt-1 border-t border-border/40 space-y-3">
          {claim.reasoning && (
            <p className="text-sm text-muted-foreground leading-relaxed pl-9">{claim.reasoning}</p>
          )}
          <div className="pl-9 grid sm:grid-cols-2 gap-2.5">
            {claim.supporting_points.length > 0 && (
              <PointList Icon={ThumbsUp} title="지지 근거" items={claim.supporting_points} tone="true"
                links={claim.supporting_points.map(p => `https://news.google.com/search?q=${encodeURIComponent(p.slice(0, 70))}&hl=ko&gl=KR&ceid=KR:ko`)}
              />
            )}
            {claim.counter_points.length > 0 && (
              <PointList Icon={ThumbsDown} title="반박 가능성" items={claim.counter_points} tone="false"
                links={claim.counter_points.map(p => `https://news.google.com/search?q=${encodeURIComponent(p.slice(0, 70))}&hl=ko&gl=KR&ceid=KR:ko`)}
              />
            )}
            {claim.unknowns.length > 0 && (
              <PointList Icon={AlertTriangle} title="미확인 항목" items={claim.unknowns} tone="unknown"
                links={claim.unknowns.map(u => `https://www.google.com/search?q=${encodeURIComponent(u.slice(0, 70))}`)}
              />
            )}
            {claim.suggested_sources.length > 0 && (
              <PointList
                Icon={BookOpen}
                title="확인 권장 출처"
                items={claim.suggested_sources.map((s) => `${s.name}${s.type && s.type !== "일반" ? ` (${s.type})` : ""}`)}
                tone="weak"
                links={claim.suggested_sources.map(s => generateSourceUrl(s.name, s.type, claim.claim))}
              />
            )}
          </div>
        </div>
      )}
    </article>
  );
}

function ConfidenceBar({ value, compact }: { value: number; compact?: boolean }) {
  const color =
    value >= 70 ? "bg-emerald-400" : value >= 40 ? "bg-yellow-400" : "bg-red-400";
  if (compact) {
    return (
      <div className="flex items-center gap-1.5">
        <div className="w-16 sm:w-20 h-1 rounded-full bg-surface-2 overflow-hidden">
          <div className={`h-full ${color}`} style={{ width: `${value}%` }} />
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">{value}%</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 min-w-[160px]">
      <span className="text-xs text-muted-foreground">신뢰도</span>
      <div className="flex-1 h-1.5 rounded-full bg-surface-2 overflow-hidden min-w-[80px]">
        <div className={`h-full ${color} transition-all`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-sm font-medium tabular-nums">{value}%</span>
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
    <button type="button" onClick={handleShare}
      className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-primary transition-colors text-sm">
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Share2 className="w-3.5 h-3.5" />}
      {copied ? "복사됨!" : "공유"}
    </button>
  );
}

function PointList({ Icon, title, items, tone, links }: {
  Icon: typeof ThumbsUp;
  title: string;
  items: string[];
  tone: "true" | "false" | "unknown" | "weak";
  links?: string[];
}) {
  const colorClass = {
    true: "text-emerald-400",
    false: "text-red-400",
    unknown: "text-yellow-400",
    weak: "text-primary",
  }[tone];
  return (
    <div className="bg-background/40 rounded-lg p-3">
      <div className={`flex items-center gap-1.5 text-xs font-semibold mb-2 ${colorClass}`}>
        <Icon className="w-3.5 h-3.5" /> {title}
      </div>
      <ul className="space-y-1.5">
        {items.map((p, i) => {
          const url = links?.[i];
          return (
            <li key={i} className="text-xs text-foreground/80 leading-relaxed flex gap-1.5">
              <span className="text-muted-foreground/50 shrink-0">·</span>
              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`hover:underline underline-offset-2 inline-flex items-start gap-1 group ${colorClass} opacity-85 hover:opacity-100 transition-opacity`}
                >
                  <span className="flex-1 text-foreground/80 group-hover:text-foreground transition-colors">{p}</span>
                  <ExternalLink className="w-3 h-3 shrink-0 mt-0.5 opacity-40 group-hover:opacity-80 transition-opacity" />
                </a>
              ) : (
                <span>{p}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
