import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft, ExternalLink, ThumbsUp, ThumbsDown, HelpCircle,
  BookOpen, Share2, Check, ChevronDown, ChevronUp, FileText,
  AlertTriangle, CheckCircle2, XCircle, MinusCircle, AlertCircle,
  Loader2,
} from "lucide-react";

import { getAnalysis, continueAnalysis } from "@/lib/analyses.functions";
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

type ClaimType = "EMPIRICAL" | "DISPUTED_TERRITORY" | "OPINION" | "DOMESTIC_LAW_FACT";

type Claim = {
  claim: string;
  claim_type?: ClaimType;
  judgment_basis?: string;  // "팩트체크" | "국가 공인 입장" | "의견/견해"
  subject?: string;
  predicate?: string;
  object?: string;
  verdict: string;
  confidence: number;
  reasoning: string;
  supporting_points: string[];
  counter_points: string[];
  unknowns: string[];
  suggested_sources: { name: string; type: string }[];
  evidence_urls?: string[];
};

type PipelineMeta = {
  bias_type?: string;
  fake_probability?: number;
  style_signals?: string[];
  evidence_urls?: string[];
  items: Claim[];
};

const VERDICT_META: Record<string, { icon: typeof CheckCircle2; color: string; bg: string; border: string; label: string }> = {
  "사실":           { icon: CheckCircle2, color: "text-verdict-true",    bg: "bg-verdict-true/10",    border: "border-verdict-true/30",    label: "사실" },
  "부분 사실":      { icon: MinusCircle,  color: "text-verdict-partial", bg: "bg-verdict-partial/10", border: "border-verdict-partial/30", label: "부분 사실" },
  "근거 부족":      { icon: HelpCircle,   color: "text-verdict-weak",    bg: "bg-verdict-weak/10",    border: "border-verdict-weak/30",    label: "근거 부족" },
  "반대 근거 우세": { icon: XCircle,      color: "text-verdict-false",   bg: "bg-verdict-false/10",   border: "border-verdict-false/30",   label: "반대 근거 우세" },
  "미확인":         { icon: AlertCircle,  color: "text-verdict-unknown", bg: "bg-verdict-unknown/10", border: "border-verdict-unknown/30", label: "미확인" },
};

function AnalysisPage() {
  const { id } = Route.useParams();
  const fetchAnalysis = useServerFn(getAnalysis);
  const runPhase2 = useServerFn(continueAnalysis);
  const [sessionId, setSessionId] = useState<string>("");
  useEffect(() => { setSessionId(getSessionId()); }, []);
  const [phase2Result, setPhase2Result] = useState<Record<string, unknown> | null>(null);
  const [phase2Loading, setPhase2Loading] = useState(false);

  // sessionStorage에서 분析 결果를 직접 읽음 (네비게이션 시 저장된 서버 결과)
  const [preloadedResult] = useState<Record<string, unknown> | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const stored = sessionStorage.getItem(`kfact:${id}`);
      if (stored) {
        sessionStorage.removeItem(`kfact:${id}`);
        return JSON.parse(stored) as Record<string, unknown>;
      }
    } catch {}
    return null;
  });

  const [pollCount, setPollCount] = useState(0);

  const { data: fetchedData, isLoading, isError } = useQuery({
    queryKey: ["analysis", id, sessionId],
    queryFn: async () => {
      const result = await fetchAnalysis({ data: { id, sessionId } });
      setPollCount(c => c + 1);
      return result;
    },
    // preloaded 결果가 있으면 서버 조회 불필요
    enabled: !!sessionId && !preloadedResult,
    refetchInterval: (q) => {
      const status = (q.state.data as { status?: string } | undefined)?.status;
      return (status === "pending" && pollCount < 20) ? 2000 : false;
    },
  });

  const data = phase2Result ?? preloadedResult ?? (fetchedData as Record<string, unknown> | undefined);
  const dataRow = data ?? {} as Record<string, unknown>;
  const status = data?.status as string | undefined;
  const isTimedOut = pollCount >= 20 && status === "pending";
  const isFailed = status === "failed";
  // preloadedResult가 있으면 절대 pending/loading으로 빠지지 않음
  const isPendingStatus = !preloadedResult && (isLoading || isError || !data || status === "pending");

  // Phase 2 자동 트리거: Phase 1 완료 후 sessionId 확보 시 심층 분析 시작
  useEffect(() => {
    if (!sessionId || status !== "phase1_complete" || phase2Loading || phase2Result) return;
    setPhase2Loading(true);
    const inputText = (dataRow.input_text as string | undefined) ?? "";
    const srcUrl = (dataRow.source_url as string | null | undefined) ?? undefined;
    runPhase2({ data: { id, sessionId, text: inputText, sourceUrl: srcUrl } })
      .then(r => setPhase2Result(r as Record<string, unknown>))
      .catch(() => {})
      .finally(() => setPhase2Loading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, status]);

  // pending/failed/timeout → 메시지창(배너) 표시
  if (isPendingStatus || isFailed || isTimedOut) {
    const isErr = isFailed || isTimedOut;
    return (
      <div className="min-h-screen pb-16 sm:pb-0">
        <SiteHeader />
        <BottomNav />
        <div className="flex items-center justify-center min-h-[60vh] px-4">
          <div className={`w-full max-w-md rounded-2xl border p-6 shadow-lg space-y-4 ${isErr ? "border-destructive/40 bg-destructive/5" : "border-primary/30 bg-primary/5"}`}>
            <div className="flex items-center gap-3">
              {isErr
                ? <AlertTriangle className="w-6 h-6 text-destructive shrink-0" />
                : <Loader2 className="w-6 h-6 text-primary shrink-0 animate-spin" />}
              <p className="font-semibold text-base">
                {isTimedOut ? "분석 시간 초과"
                  : isFailed ? "분석 실패"
                  : "AI 분석 중…"}
              </p>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {isTimedOut
                ? "분석 처리가 지연되고 있습니다. 잠시 후 다시 시도해 주세요."
                : isFailed
                ? ((data?.summary as string | undefined) ?? "AI 분석 중 오류가 발생했습니다.")
                : "팩트체크 결과를 생성하고 있습니다. 잠시 기다려주세요."}
            </p>
            <Link
              to="/"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium"
            >
              <ArrowLeft className="w-4 h-4" /> 홈으로 돌아가기
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // 구 형식(배열) + 신 형식(파이프라인 메타 객체) 모두 처리
  // dataRow is declared above
  const rawClaims = dataRow.claims as unknown;
  const pipelineMeta: PipelineMeta | null =
    rawClaims && !Array.isArray(rawClaims) && typeof rawClaims === "object"
      ? rawClaims as PipelineMeta
      : null;
  const claims: Claim[] = Array.isArray(rawClaims)
    ? rawClaims
    : (pipelineMeta?.items ?? []);

  // 영토·주권 분쟁 주장 여부 — 고지 배너 표시 여부 결정
  const hasDisputedTerritory = claims.some(c => c.claim_type === "DISPUTED_TERRITORY");

  return (
    <div className="min-h-screen pb-16 sm:pb-0">
      <SiteHeader />
      <BottomNav />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-5">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> 새 분석
        </Link>

        {/* ① 검증 문서 헤더 */}
        <div className="border border-border/60 bg-surface shadow-[var(--shadow-card)]">
          {/* 문서 상단 레이블 바 */}
          <div className="px-5 sm:px-7 py-2 border-b border-border/40 flex items-center justify-between gap-3 bg-surface-2/50">
            <span className="text-[9px] font-bold tracking-widest uppercase text-muted-foreground/60 font-mono">K-Fact 팩트체크 판정서</span>
            <span className="text-[9px] text-muted-foreground/40 font-mono">
              {new Date(dataRow.created_at as string).toLocaleString("ko-KR")}
            </span>
          </div>

          <div className="px-5 sm:px-7 py-5 sm:py-7">
            {/* 제목 + 스탬프 */}
            <div className="flex items-start gap-4 mb-4">
              <div className="flex-1 min-w-0">
                <h1 className="font-display text-xl sm:text-2xl font-bold leading-snug text-foreground">{dataRow.title as string}</h1>
              </div>
              <div className="shrink-0 flex flex-col items-end gap-2">
                <VerdictBadge verdict={(dataRow.overall_verdict as string) ?? "미확인"} size="lg" />
                <ConfidenceBar value={(dataRow.overall_confidence as number) ?? 0} />
              </div>
            </div>

            {/* 요약 */}
            <p className="text-sm text-muted-foreground leading-relaxed border-t border-border/30 pt-4">{dataRow.summary as string}</p>

            {/* 원문 링크 + 공유 */}
            <div className="flex items-center gap-4 mt-4 pt-3 border-t border-border/30">
              {(dataRow.source_url as string | null | undefined) && (
                <a href={dataRow.source_url as string} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-accent hover:text-accent/80 transition-colors text-xs">
                  <ExternalLink className="w-3.5 h-3.5" /> 원문 보기
                </a>
              )}
              <div className="ml-auto">
                <ShareButton />
              </div>
            </div>
          </div>
        </div>

        {/* ② 파이프라인 메타: Stage 1 + Stage 3 결과 */}
        {pipelineMeta && (
          <PipelineMetaPanel meta={pipelineMeta} />
        )}

        {/* ③ 원문 요약 (접기/펼치기) */}
        {(dataRow.input_text as string | null | undefined) && (
          <InputSummary text={dataRow.input_text as string} />
        )}

        {/* 영토·주권 분쟁 주장 포함 시 판정 기준 고지 */}
        {hasDisputedTerritory && (
          <div className="border border-verdict-partial/40 bg-verdict-partial/5 px-4 py-3 flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-verdict-partial shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold text-verdict-partial uppercase tracking-widest mb-1">판정 기준 고지</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                본 서비스는 <strong className="text-foreground/80">대한민국 정부 공식 입장 및 국제법상 실효 지배 현황</strong>을 기준으로 판정합니다.
                영토·주권·역사 분쟁 주장은 "국가 공인 입장" 라벨로 별도 표시되며, 이는 완전히 중립적인 국제 팩트체크와 다를 수 있습니다.
              </p>
            </div>
          </div>
        )}

        {/* Phase 2 심층 분析 진행 중 배너 */}
        {phase2Loading && (
          <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl border border-primary/30 bg-primary/5">
            <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground/90">Tavily 심층 검색 중…</p>
              <p className="text-xs text-muted-foreground">실시간 뉴스·공식 자료로 미확인·사실 항목을 재검증하고 있습니다.</p>
            </div>
          </div>
        )}

        {/* ④ 주장 한눈에 보기 */}
        {claims.length > 0 && <ClaimOverview claims={claims} phase2Loading={phase2Loading} />}

        {/* ⑤ 상세 주장 카드 */}
        <section className="space-y-3">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
            주장별 상세 분析
          </h2>
          {claims.map((c, i) => (
            <ClaimCard key={i} index={i + 1} claim={c} reviewing={phase2Loading && c.verdict !== "반대 근거 우세"} />
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

/* ── Stage 1+3 파이프라인 메타 패널 ── */
function PipelineMetaPanel({ meta }: { meta: PipelineMeta }) {
  const { bias_type, fake_probability, style_signals, evidence_urls } = meta;
  const hasSignals = (style_signals ?? []).length > 0;
  const hasUrls = (evidence_urls ?? []).length > 0;
  if (!bias_type && !fake_probability && !hasSignals && !hasUrls) return null;

  const fpct = fake_probability ?? 0;
  const fpColor = fpct >= 70 ? "text-verdict-false border-verdict-false/50" : fpct >= 40 ? "text-verdict-partial border-verdict-partial/50" : "text-verdict-true border-verdict-true/50";
  const barColor = fpct >= 70 ? "bg-verdict-false" : fpct >= 40 ? "bg-verdict-partial" : "bg-verdict-true";

  return (
    <div className="border border-border/50 bg-surface overflow-hidden">
      <div className="px-4 sm:px-5 py-2.5 border-b border-border/30 flex items-center gap-2 bg-surface-2/40">
        <span className="font-mono text-[9px] font-bold text-muted-foreground/60 uppercase tracking-widest">AI 파이프라인 분석</span>
        {bias_type && bias_type !== "중립" && (
          <span className="font-mono text-[9px] font-bold text-verdict-partial border border-verdict-partial/30 px-2 py-0.5 rounded-sm ml-auto uppercase tracking-widest">
            {bias_type} 편향
          </span>
        )}
      </div>
      <div className="px-4 sm:px-5 py-3 space-y-3">
        {/* Stage 1: 가짜 가능성 */}
        {fpct > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[11px] text-muted-foreground font-medium">문체 가짜 가능성 지수</span>
              <span className={`font-mono text-xs font-bold border rounded-sm px-1.5 py-0.5 ml-auto ${fpColor}`}>{fpct}%</span>
            </div>
            <div className="h-1 bg-surface-2 overflow-hidden">
              <div className={`h-full ${barColor} transition-all`} style={{ width: `${fpct}%` }} />
            </div>
            <p className="text-[10px] text-muted-foreground/50 mt-1">LIAR Dataset / FakeNewsNet 패턴 기반 TF-IDF 분석</p>
          </div>
        )}

        {/* Stage 1: 경고 신호 */}
        {hasSignals && (
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground mb-1.5">감지된 문체 신호</p>
            <div className="space-y-1">
              {(style_signals ?? []).map((s, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <span className="text-[10px] text-orange-400 shrink-0 mt-0.5">•</span>
                  <span className="text-[11px] text-muted-foreground/80 leading-relaxed">{s}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stage 3: Tavily 증거 URL */}
        {hasUrls && (
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground mb-1.5">Stage 3 — Tavily 실시간 검색 근거</p>
            <div className="space-y-1">
              {(evidence_urls ?? []).map((url, i) => (
                <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-[11px] text-primary/70 hover:text-primary transition-colors group truncate">
                  <ExternalLink className="w-3 h-3 shrink-0 opacity-50 group-hover:opacity-100" />
                  <span className="truncate">{url}</span>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── 원문 요약 ── */
function InputSummary({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const preview = text.slice(0, 200).trimEnd();
  const hasMore = text.length > 200;

  return (
    <div className="border border-border/50 bg-surface overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2.5 px-4 sm:px-5 py-3 text-left hover:bg-surface-2/50 transition-colors"
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
function ClaimOverview({ claims, phase2Loading }: { claims: Claim[]; phase2Loading?: boolean }) {
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
    <div className="border border-border/50 bg-surface shadow-[var(--shadow-card)] p-4 sm:p-5">
      <h2 className="font-mono text-[9px] font-bold text-muted-foreground/60 uppercase tracking-widest mb-3">
        주장 요약
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
          const { verdictLabel: vLabel, basisLabel: bLabel } = getVerdictDisplay(c);
          const isOp = c.judgment_basis === "의견/견해";
          const meta = isOp
            ? { icon: HelpCircle, color: "text-muted-foreground", bg: "bg-surface-2", border: "border-border/40", label: "의견/견해" }
            : (VERDICT_META[vLabel] ?? VERDICT_META["미확인"]);
          const Icon = meta.icon;
          const isExpanded = expandedIdx === i;
          const highlight = !isOp && isHighlight(c.verdict);
          const accentClass = c.verdict === "사실"
            ? "border-l-[3px] border-l-verdict-true"
            : c.verdict === "반대 근거 우세"
              ? "border-l-[3px] border-l-verdict-false"
              : "";
          const ctMeta = CLAIM_TYPE_META[c.claim_type ?? "EMPIRICAL"] ?? CLAIM_TYPE_META.EMPIRICAL;

          return (
            <div key={i} className={`overflow-hidden ${highlight ? accentClass : ""}`}>
              <button
                type="button"
                onClick={() => setExpandedIdx(isExpanded ? null : i)}
                className={`w-full flex items-start text-left transition-colors cursor-pointer active:scale-[0.99] ${meta.bg} ${meta.border} border ${
                  highlight
                    ? "gap-3 px-4 py-3.5 hover:bg-opacity-80"
                    : "gap-2.5 px-3 py-2.5 hover:bg-opacity-80"
                }`}
              >
                {highlight ? (
                  <div className={`shrink-0 w-8 h-8 flex items-center justify-center border-2 ${meta.border} ${meta.bg} mt-0.5`}>
                    <Icon className={`w-4 h-4 ${meta.color}`} />
                  </div>
                ) : (
                  <span className="text-[10px] font-mono text-muted-foreground shrink-0 mt-0.5 w-4">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap mb-1">
                    {/* 주장 유형 배지 */}
                    <span className={`font-mono text-[9px] font-bold border px-1 py-px rounded-sm uppercase tracking-widest ${ctMeta.color}`}>
                      {ctMeta.label}
                    </span>
                    {/* 국가 공인 입장 접두어 */}
                    {bLabel && (
                      <span className="font-mono text-[9px] font-bold border border-verdict-partial/50 text-verdict-partial bg-verdict-partial/10 px-1 py-px rounded-sm uppercase tracking-widest">
                        {bLabel}
                      </span>
                    )}
                    {highlight && (
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 border text-[10px] font-bold rounded-sm ${meta.bg} ${meta.border} ${meta.color}`}>
                        <Icon className="w-2.5 h-2.5" />{meta.label}
                      </span>
                    )}
                  </div>
                  <p className={`leading-snug ${highlight ? "text-sm font-semibold text-foreground" : "text-xs text-foreground/90 leading-relaxed"}`}>
                    {c.claim}
                  </p>
                </div>

                <div className="flex items-center gap-1.5 shrink-0 ml-2 mt-0.5">
                  {!highlight && (
                    <div className={`inline-flex items-center gap-1 px-2 py-0.5 border text-[10px] font-semibold rounded-sm ${meta.bg} ${meta.border} ${meta.color} ring-1 ring-current/20`}>
                      <Icon className="w-3 h-3" />
                      <span className="hidden sm:inline">{meta.label}</span>
                    </div>
                  )}
                  {!isOp && (
                    <span className={`tabular-nums font-bold ${highlight ? `text-sm ${meta.color}` : "text-[10px] text-muted-foreground"}`}>
                      {c.confidence}%
                    </span>
                  )}
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
              미확인 {unknownClaims.length}건 — {phase2Loading ? "심층 검토 중…" : "근거 부족으로 판정 보류"}
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

const CLAIM_TYPE_META: Record<string, { label: string; color: string }> = {
  EMPIRICAL:          { label: "실증",     color: "text-verdict-weak border-verdict-weak/40 bg-verdict-weak/10" },
  DISPUTED_TERRITORY: { label: "분쟁주장", color: "text-verdict-partial border-verdict-partial/50 bg-verdict-partial/10" },
  OPINION:            { label: "의견/견해", color: "text-muted-foreground border-border/50 bg-surface-2" },
  DOMESTIC_LAW_FACT:  { label: "법령사실", color: "text-accent border-accent/40 bg-accent/10" },
};

/* 판정 기준에 따라 표시 레이블 결정 */
function getVerdictDisplay(claim: Claim): { verdictLabel: string; basisLabel: string | null } {
  const basis = claim.judgment_basis;
  if (basis === "의견/견해") return { verdictLabel: "의견/견해", basisLabel: null };
  if (basis === "국가 공인 입장") return { verdictLabel: claim.verdict, basisLabel: "국가 공인 입장" };
  return { verdictLabel: claim.verdict, basisLabel: null };
}

/* ── 상세 클레임 카드 (접기/펼치기) ── */
function ClaimCard({ index, claim, reviewing }: { index: number; claim: Claim; reviewing?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const { verdictLabel, basisLabel } = getVerdictDisplay(claim);
  const isOpinion = claim.judgment_basis === "의견/견해";
  const meta = isOpinion
    ? { icon: HelpCircle, color: "text-muted-foreground", bg: "bg-surface-2", border: "border-border/40", label: "의견/견해" }
    : (VERDICT_META[verdictLabel] ?? VERDICT_META["미확인"]);
  const Icon = meta.icon;

  const hasDetails =
    claim.reasoning ||
    claim.supporting_points.length > 0 ||
    claim.counter_points.length > 0 ||
    claim.unknowns.length > 0 ||
    claim.suggested_sources.length > 0;

  const claimTypeMeta = CLAIM_TYPE_META[claim.claim_type ?? "EMPIRICAL"] ?? CLAIM_TYPE_META.EMPIRICAL;

  return (
    <article className={`border-l-[3px] ${meta.border} border border-border/50 bg-surface shadow-[var(--shadow-card)]`}>
      {/* 헤더 (항상 표시) */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        disabled={!hasDetails}
        className="w-full text-left px-4 sm:px-5 py-3.5 hover:bg-surface-2/50 transition-colors disabled:cursor-default"
      >
        <div className="flex items-start gap-3">
          <span className="shrink-0 w-6 h-6 bg-surface-2 text-[10px] font-mono grid place-items-center text-muted-foreground mt-0.5">
            {String(index).padStart(2, "0")}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium leading-snug mb-1.5 pr-4">{claim.claim}</p>
            {/* Stage 2 SPO 구조 */}
            {(claim.subject || claim.predicate || claim.object) && (
              <div className="flex items-center gap-1.5 flex-wrap mb-2">
                {claim.subject   && <span className="text-[10px] bg-border/20 border border-border/40 rounded px-1.5 py-0.5 text-muted-foreground/70">주어: {claim.subject}</span>}
                {claim.predicate && <span className="text-[10px] bg-border/20 border border-border/40 rounded px-1.5 py-0.5 text-muted-foreground/70">서술: {claim.predicate}</span>}
                {claim.object    && <span className="text-[10px] bg-border/20 border border-border/40 rounded px-1.5 py-0.5 text-muted-foreground/70">대상: {claim.object}</span>}
              </div>
            )}
            <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
              {/* 주장 유형 배지 */}
              <span className={`font-mono text-[9px] font-bold border px-1.5 py-0.5 rounded-sm uppercase tracking-widest ${claimTypeMeta.color}`}>
                {claimTypeMeta.label}
              </span>
              {/* 판정 기준 접두어 */}
              {basisLabel && (
                <span className="font-mono text-[9px] font-bold border border-verdict-partial/50 text-verdict-partial bg-verdict-partial/10 px-1.5 py-0.5 rounded-sm uppercase tracking-widest">
                  {basisLabel}
                </span>
              )}
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 border text-xs font-semibold rounded-sm ${meta.bg} ${meta.border} ${meta.color}`}>
                <Icon className="w-3 h-3" /> {isOpinion ? "의견/견해" : meta.label}
              </span>
              {reviewing
                ? <span className="inline-flex items-center gap-1 text-[10px] text-primary/70 font-medium"><Loader2 className="w-3 h-3 animate-spin" />심층 검토 중…</span>
                : <ConfidenceBar value={claim.confidence} compact />}
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
            {(claim.evidence_urls ?? []).length > 0 && (
              <PointList Icon={ExternalLink} title="Tavily 실시간 검색 근거" items={claim.evidence_urls!} tone="weak"
                links={claim.evidence_urls}
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

/* 신뢰도를 원형 게이지 대신 인증 스탬프 형태로 표현 */
function ConfidenceBar({ value, compact }: { value: number; compact?: boolean }) {
  const [stampColor, barColor] =
    value >= 70
      ? ["text-verdict-true border-verdict-true/50", "bg-verdict-true"]
      : value >= 40
      ? ["text-verdict-partial border-verdict-partial/50", "bg-verdict-partial"]
      : ["text-verdict-false border-verdict-false/50", "bg-verdict-false"];

  if (compact) {
    return (
      <span className={`font-mono text-[10px] font-bold border rounded-sm px-1.5 py-0.5 ${stampColor}`}>
        {value}%
      </span>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-muted-foreground font-medium tracking-wider uppercase">신뢰도</span>
      <span className={`font-mono text-sm font-bold border-2 rounded-sm px-2.5 py-1 ${stampColor}`}>
        {value}%
      </span>
      <div className="w-16 h-1 bg-surface-2 overflow-hidden">
        <div className={`h-full ${barColor} transition-all`} style={{ width: `${value}%` }} />
      </div>
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
