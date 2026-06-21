import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft, ExternalLink, ThumbsUp, ThumbsDown, HelpCircle,
  BookOpen, Share2, Check, ChevronDown, ChevronUp, FileText,
  AlertTriangle, CheckCircle2, XCircle, MinusCircle, AlertCircle,
  Loader2, SmilePlus, Frown, Meh, Eye, Lightbulb, Target,
  Sparkles, ChevronLeft, ChevronRight,
} from "lucide-react";

import {
  getAnalysis, continueAnalysis, simplifyAnalysis, getAuditLog, verifyIntegrity, crossCheckClaims,
  type SimplifiedClaim, type SimplifiedResult,
} from "@/lib/analyses.functions";
import { getSessionId } from "@/lib/session";
import { SiteHeader, BottomNav } from "@/components/SiteHeader";
import { VerdictBadge } from "@/components/VerdictBadge";
import { AuditTrailPanel, type AuditLog, type ExternalFactCheck, type StyleClassification } from "@/components/AuditTrailPanel";

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
  "미확인":         { icon: HelpCircle,   color: "text-verdict-weak",    bg: "bg-verdict-weak/10",    border: "border-verdict-weak/30",    label: "근거 부족" },
};

/* ── 신뢰도 직관 레이블 ── */
function getConfidenceLabel(v: number): { text: string; color: string } {
  if (v >= 86) return { text: "아주 믿을만해요",     color: "text-verdict-true" };
  if (v >= 71) return { text: "꽤 믿을만해요",       color: "text-verdict-true" };
  if (v >= 51) return { text: "어느 정도 맞을 수 있어요", color: "text-verdict-partial" };
  if (v >= 31) return { text: "조금 불확실해요",     color: "text-verdict-unknown" };
  return        { text: "거의 확인 안 됐어요",       color: "text-verdict-false" };
}

/* ── 근거 강도 분석 ── */
function evidenceStrength(claim: Claim): {
  supportCount: number;
  counterCount: number;
  total: number;
  label: string;
  color: string;
  barColor: string;
} {
  const supportCount = (claim.supporting_points ?? []).length;
  const counterCount = (claim.counter_points ?? []).length;
  const total = supportCount + counterCount;
  const max = Math.max(supportCount, counterCount, 1);

  if (supportCount >= 2 && supportCount > counterCount) {
    return { supportCount, counterCount, total,
      label: "지지 근거 충실", color: "text-verdict-true", barColor: "bg-verdict-true" };
  }
  if (counterCount >= 2 && counterCount >= supportCount) {
    return { supportCount, counterCount, total,
      label: "반박 근거 우세", color: "text-verdict-false", barColor: "bg-verdict-false" };
  }
  if (total > 0) {
    return { supportCount, counterCount, total,
      label: "일부 근거 있음", color: "text-verdict-partial", barColor: "bg-verdict-partial" };
  }
  return { supportCount, counterCount, total,
    label: "근거 미제시", color: "text-muted-foreground", barColor: "bg-border" };
}

/* ── 근거 요약 미리보기 (각 유형별 최대 n개) ── */
function evidencePreview(claim: Claim, n?: number): { type: "support" | "counter"; text: string }[] {
  const limit = n ?? 1;
  const items: { type: "support" | "counter"; text: string }[] = [];
  for (const p of claim.supporting_points.slice(0, limit)) items.push({ type: "support", text: p });
  for (const p of claim.counter_points.slice(0, limit)) items.push({ type: "counter", text: p });
  return items;
}

/* ── 읽기 모드 토글 ── */
function ReadingModeToggle({
  mode, onChange, loading,
}: { mode: "detailed" | "simple"; onChange: (m: "detailed" | "simple") => void; loading: boolean }) {
  return (
    <div className="flex items-center gap-1 p-1 rounded-xl bg-surface-2 w-fit shadow-sm">
      <button
        type="button"
        onClick={() => onChange("detailed")}
        className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
          mode === "detailed"
            ? "bg-surface text-foreground shadow-sm border border-border/40"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <FileText className="w-4 h-4" /> 자세히 보기
      </button>
      <button
        type="button"
        disabled={loading}
        onClick={() => onChange("simple")}
        className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-1.5 ${
          mode === "simple"
            ? "bg-primary text-primary-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        } disabled:opacity-50`}
      >
        {loading
          ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> 변환 중…</>
          : <><Eye className="w-4 h-4" /> 쉽게 보기</>}
      </button>
    </div>
  );
}

function AnalysisPage() {
  const { id } = Route.useParams();
  const fetchAnalysis = useServerFn(getAnalysis);
  const runPhase2 = useServerFn(continueAnalysis);
  const runSimplify = useServerFn(simplifyAnalysis);
  const runGetAuditLog = useServerFn(getAuditLog);
  const runVerifyIntegrity = useServerFn(verifyIntegrity);
  const runCrossCheck = useServerFn(crossCheckClaims);
  const [sessionId, setSessionId] = useState<string>("");
  useEffect(() => { setSessionId(getSessionId()); }, []);
  const [phase2Result, setPhase2Result] = useState<Record<string, unknown> | null>(null);
  const [phase2Loading, setPhase2Loading] = useState(false);

  /* 쉽게 보기 상태 */
  const [readingMode, setReadingMode] = useState<"detailed" | "simple">("detailed");
  const [simplifiedData, setSimplifiedData] = useState<SimplifiedResult | null>(null);
  const [simplifyLoading, setSimplifyLoading] = useState(false);

  /* 감사 로그 + 무결성 상태 */
  const [auditLog, setAuditLog] = useState<AuditLog | null>(null);
  const [integrityStatus, setIntegrityStatus] = useState<"valid" | "invalid" | "unsigned" | "checking">("unsigned");
  const [externalChecks, setExternalChecks] = useState<ExternalFactCheck[] | undefined>(undefined);
  const [externalLoading, setExternalLoading] = useState(false);

  // sessionStorage에서 분析 결果를 직접 읽음 (네비게이션 시 저장된 서버 결과)
  const [preloadedResult] = useState<Record<string, unknown> | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const stored = sessionStorage.getItem(`factcheck:${id}`);
      if (stored) {
        sessionStorage.removeItem(`factcheck:${id}`);
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

  // Phase 2 완료 후 감사 로그 + 무결성 자동 로드
  useEffect(() => {
    if (!sessionId || !id || status !== "completed" || auditLog) return;
    setIntegrityStatus("checking");
    Promise.all([
      runGetAuditLog({ data: { id, sessionId } }).catch(() => null),
      runVerifyIntegrity({ data: { id, sessionId } }).catch(() => ({ status: "unsigned" as const })),
    ]).then(([al, iv]) => {
      if (al && typeof al === "object" && "audit_log" in al) {
        setAuditLog((al as { audit_log: AuditLog | null }).audit_log);
      }
      const ivStatus = (iv as { status: "valid" | "invalid" | "unsigned" }).status;
      setIntegrityStatus(ivStatus ?? "unsigned");
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, id, status]);

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
  const normalizeClaim = (c: Claim): Claim => ({
    ...c,
    supporting_points: c.supporting_points ?? [],
    counter_points:    c.counter_points    ?? [],
    unknowns:          c.unknowns          ?? [],
    suggested_sources: c.suggested_sources ?? [],
  });
  const claims: Claim[] = (Array.isArray(rawClaims)
    ? rawClaims
    : (pipelineMeta?.items ?? [])).map(normalizeClaim);

  // 트랜스포머 문체 분류 결과 (Phase 1 + Phase 2 공통 저장)
  const styleClassification = (pipelineMeta as Record<string, unknown> | null)?.style_classification as StyleClassification | undefined;

  // 영토·주권 분쟁 주장 여부 — 고지 배너 표시 여부 결정
  const hasDisputedTerritory = claims.some(c => c.claim_type === "DISPUTED_TERRITORY");

  /* 외부 팩트체크 기관 교차 확인 */
  const handleLoadExternal = async () => {
    if (externalLoading || externalChecks !== undefined) return;
    setExternalLoading(true);
    try {
      const query = (dataRow.title as string | undefined) ?? (dataRow.summary as string | undefined) ?? "";
      if (!query) { setExternalChecks([]); return; }
      const results = await runCrossCheck({ data: { query: query.slice(0, 200) } });
      setExternalChecks(results as ExternalFactCheck[]);
    } catch {
      setExternalChecks([]);
    } finally {
      setExternalLoading(false);
    }
  };

  /* 읽기 모드 전환 핸들러 */
  const handleReadingMode = async (m: "detailed" | "simple") => {
    setReadingMode(m);
    if (m === "simple" && !simplifiedData && !simplifyLoading) {
      setSimplifyLoading(true);
      try {
        const result = await runSimplify({
          data: {
            summary: (dataRow.summary as string | undefined) ?? "",
            claims: claims.map(c => ({
              claim:             c.claim,
              verdict:           c.verdict,
              confidence:        c.confidence,
              reasoning:         c.reasoning,
              supporting_points: c.supporting_points,
              counter_points:    c.counter_points,
            })),
          },
        });
        setSimplifiedData(result);
      } catch { /* 실패 시 원본 표시 유지 */ }
      finally { setSimplifyLoading(false); }
    }
  };

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
            <span className="text-[13.5px] font-bold tracking-widest uppercase text-muted-foreground/60 font-mono">팩트체크 팩트체크 판정서</span>
            <span className="text-[13.5px] text-muted-foreground/40 font-mono">
              {new Date(dataRow.created_at as string).toLocaleString("ko-KR")}
            </span>
          </div>

          <div className="px-5 sm:px-7 py-5 sm:py-7">
            {/* 제목 + 스탬프 */}
            <div className="flex items-start gap-4 mb-4">
              <div className="flex-1 min-w-0">
                <h1 className="font-display text-xl sm:text-2xl font-bold leading-snug text-foreground">{dataRow.title as string}</h1>
              </div>
              <div className="shrink-0 flex flex-col items-center gap-2">
                <VerdictGauge
                  verdict={(dataRow.overall_verdict as string) ?? "근거 부족"}
                  confidence={(dataRow.overall_confidence as number) ?? 0}
                  size="lg"
                />
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

        {/* ③ 핵심 키워드 애니메이션 + 원문 요약 */}
        {(dataRow.input_text as string | null | undefined) && (
          <KeywordHighlight
            inputText={dataRow.input_text as string}
            claims={claims}
            overallVerdict={dataRow.overall_verdict as string | undefined}
          />
        )}
        {(dataRow.input_text as string | null | undefined) && (
          <InputSummary
            text={dataRow.input_text as string}
            label={(() => {
              const SKIP = new Set(["분석 결과", "분析 결과", "팩트체크 결과", ""]);
              const t = dataRow.title as string | undefined;
              if (t && !SKIP.has(t)) return t;
              const c = claims[0]?.claim;
              if (c && c !== "본문 내 주요 주장") return c.length > 50 ? c.slice(0, 48) + "…" : c;
              const raw = dataRow.input_text as string;
              return raw.length > 50 ? raw.slice(0, 48) + "…" : raw;
            })()}
          />
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
              <p className="text-xs text-muted-foreground">실시간 뉴스·공식 자료로 근거 부족·사실 항목을 재검증하고 있습니다.</p>
            </div>
          </div>
        )}

        {/* ④ 읽기 모드 토글 */}
        {claims.length > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
            <ReadingModeToggle
              mode={readingMode}
              onChange={handleReadingMode}
              loading={simplifyLoading}
            />
            {readingMode === "simple" && simplifiedData && (
              <div className="text-xs text-muted-foreground bg-surface-2/60 border border-border/40 rounded-lg px-3 py-2 flex items-center gap-1.5">
                <Eye className="w-4 h-4 text-primary shrink-0" />
                중고등학생도 이해하기 쉬운 말로 바꿔드렸어요!
              </div>
            )}
          </div>
        )}

        {/* 쉽게 보기 - 전체 요약 */}
        {readingMode === "simple" && simplifiedData?.simple_summary && (
          <div className="border border-primary/30 bg-primary/5 rounded-xl px-4 py-3 flex items-start gap-3">
            <Lightbulb className="w-5 h-5 text-primary shrink-0 mt-0.5" />
            <div>
              <p className="text-[10px] font-bold text-primary uppercase tracking-widest mb-1">한 줄 요약 (쉬운 버전)</p>
              <p className="text-sm text-foreground/90 leading-relaxed">{simplifiedData.simple_summary}</p>
            </div>
          </div>
        )}

        {/* ④ 주장 한눈에 보기 */}
        {claims.length > 0 && <ClaimOverview claims={claims} phase2Loading={phase2Loading} />}

        {/* ⑤ 상세 주장 카드 */}
        <section className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              주장별 상세 분석 및 근거
            </h2>
            {readingMode === "simple" && (
              <span className="text-[10px] text-primary/70 font-medium inline-flex items-center gap-1"><Eye className="w-3 h-3" /> 쉬운 설명 모드</span>
            )}
          </div>
          {claims.map((c, i) => (
            <ClaimCard
              key={i}
              index={i + 1}
              claim={c}
              reviewing={phase2Loading && c.verdict !== "반대 근거 우세"}
              simpleData={readingMode === "simple" ? (simplifiedData?.claims[i] ?? null) : null}
            />
          ))}
        </section>

        {/* ⑥ 판단 과정 + 무결성 감사 */}
        {status === "completed" && (
          <AuditTrailPanel
            auditLog={auditLog}
            integrity={integrityStatus}
            styleClassification={styleClassification}
            externalChecks={externalChecks}
            onLoadExternal={handleLoadExternal}
            externalLoading={externalLoading}
          />
        )}

        <p className="text-xs text-muted-foreground leading-relaxed p-4 rounded-xl border border-border/50 bg-surface/30">
          이 결과는 AI 보조 판단이며 단정적 사실확인이 아닙니다. 신뢰도와 근거 부족 항목을 함께 참고하고,
          중요한 의사결정 전에는 표기된 출처 유형의 1차 자료를 직접 확인하세요.
        </p>
      </main>
    </div>
  );
}

/* ── Stage 1+3 파이프라인 메타 패널 ── */
function PipelineMetaPanel({ meta }: { meta: PipelineMeta }) {
  const { bias_type, fake_probability, style_signals, evidence_urls } = meta;
  const sc = (meta as Record<string, unknown>).style_classification as StyleClassification | undefined;
  const hasSignals = (style_signals ?? []).length > 0;
  const hasUrls = (evidence_urls ?? []).length > 0;
  if (!bias_type && !fake_probability && !hasSignals && !hasUrls && !sc) return null;

  const fpct = sc?.fake_probability ?? fake_probability ?? 0;
  const credScore = sc?.credibility_score;
  const fpColor = fpct >= 70 ? "text-verdict-false border-verdict-false/50" : fpct >= 40 ? "text-verdict-partial border-verdict-partial/50" : "text-verdict-true border-verdict-true/50";
  const barColor = fpct >= 70 ? "bg-verdict-false" : fpct >= 40 ? "bg-verdict-partial" : "bg-verdict-true";
  const credColor = credScore !== undefined ? (credScore >= 70 ? "text-verdict-true" : credScore >= 40 ? "text-verdict-partial" : "text-verdict-false") : "";
  const displayBiasType = sc?.style_category ?? bias_type;
  const isLLMAnalysis = !!sc;

  return (
    <div className="border border-border/50 bg-surface overflow-hidden">
      <div className="px-4 sm:px-5 py-2.5 border-b border-border/30 flex items-center gap-2 bg-surface-2/40">
        <span className="font-mono text-[13px] font-bold text-muted-foreground/60 uppercase tracking-widest">AI 파이프라인 분析</span>
        {isLLMAnalysis && (
          <span className="font-mono text-[11px] text-primary/60 border border-primary/20 px-1.5 py-0.5 rounded-sm">트랜스포머</span>
        )}
        {displayBiasType && displayBiasType !== "중립" && displayBiasType !== "사실보도" && displayBiasType !== "학술/공식문서" && (
          <span className="font-mono text-[13px] font-bold text-verdict-partial border border-verdict-partial/30 px-2 py-0.5 rounded-sm ml-auto uppercase tracking-widest">
            {displayBiasType}
          </span>
        )}
      </div>
      <div className="px-4 sm:px-5 py-3 space-y-3">
        {/* 가짜 가능성 지수 */}
        {fpct > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[17px] text-muted-foreground font-medium">문체 가짜 가능성 지수</span>
              <div className="ml-auto flex items-center gap-2">
                {credScore !== undefined && (
                  <span className={`font-mono text-[15px] font-semibold ${credColor}`}>신뢰도 {credScore}</span>
                )}
                <span className={`font-mono text-[18px] font-bold border rounded-sm px-1.5 py-0.5 ${fpColor}`}>{fpct}%</span>
              </div>
            </div>
            <div className="h-1 bg-surface-2 overflow-hidden">
              <div className={`h-full ${barColor} transition-all`} style={{ width: `${fpct}%` }} />
            </div>
            <p className="text-[15px] text-muted-foreground/50 mt-1">
              {isLLMAnalysis
                ? "SemEval-2020 선동기법 탐지 · LIWC 심리언어학 · NELA-GT 신뢰도 기준 (트랜스포머 분류)"
                : "LIAR Dataset / FakeNewsNet 패턴 기반 분析"}
            </p>
          </div>
        )}

        {/* 어텐션 모델 언어학적 지표 요약 */}
        {sc && sc.linguistic_features && (
          <div className="grid grid-cols-2 gap-1.5 text-[13px]">
            {[
              { label: "어휘 풍부도", value: sc.linguistic_features.vocabulary_richness ?? 50, high: true },
              { label: "논증 일관성", value: sc.linguistic_features.argument_coherence  ?? 50, high: true },
              { label: "출처 귀속",   value: sc.linguistic_features.source_attribution  ?? 50, high: true },
              { label: "감정어 밀도", value: sc.linguistic_features.emotional_density   ?? 50, high: false },
            ].map(({ label, value, high }) => {
              const good = high ? value >= 60 : value < 40;
              const color = good ? "text-verdict-true" : value >= 50 ? "text-verdict-partial" : "text-verdict-false";
              return (
                <div key={label} className="flex items-center gap-1.5">
                  <span className="text-muted-foreground/60 shrink-0">{label}</span>
                  <div className="flex-1 h-1 rounded-full bg-border overflow-hidden">
                    <div className={`h-full rounded-full ${good ? "bg-verdict-true" : "bg-verdict-false"}`} style={{ width: `${value}%` }} />
                  </div>
                  <span className={`font-mono font-semibold shrink-0 ${color}`}>{value}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* 선동 기법 (있을 때만) */}
        {sc && (sc.propaganda_techniques?.length ?? 0) > 0 && (
          <div>
            <p className="text-[15px] font-semibold text-destructive/80 mb-1.5">
              탐지된 선동 기법 ({sc.propaganda_techniques?.length ?? 0}건) — SemEval-2020
            </p>
            <div className="flex flex-wrap gap-1.5">
              {sc.propaganda_techniques.map((t, i) => (
                <span key={i} className="text-[13px] px-2 py-0.5 rounded-full bg-destructive/10 text-destructive border border-destructive/20">
                  {t.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 감지된 신호 */}
        {hasSignals && (
          <div>
            <p className="text-sm font-semibold text-muted-foreground mb-1.5">감지된 문체 신호</p>
            <div className="space-y-1">
              {(style_signals ?? []).map((s, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <span className="text-xs text-orange-400 shrink-0 mt-0.5">•</span>
                  <span className="text-sm text-muted-foreground/80 leading-relaxed">{s}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stage 3: Tavily 증거 URL */}
        {hasUrls && (
          <div>
            <p className="text-sm font-semibold text-muted-foreground mb-1.5">Stage 3 — Tavily 실시간 검색 근거</p>
            <div className="space-y-1">
              {(evidence_urls ?? []).map((url, i) => (
                <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-sm text-primary/70 hover:text-primary transition-colors group truncate">
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
/* ── 핵심 키워드 하이라이트 ── */
const KW_STOPWORDS = new Set([
  "이","가","은","는","을","를","의","에","에서","으로","로","도","과","와","만",
  "보다","까지","그리고","하지만","그러나","또한","따라서","그래서","하여","위해",
  "통해","대한","있다","없다","됐다","했다","이다","이며","였다","한","그","저",
  "때","것","수","더","이상","어","아","에서의","에의","이런","저런","같은","위",
  "안","뒤","앞","등","및","또","즉","약","년","월","일","기준","수준","이후",
  "이전","현재","당시","우리","우리나라","지난","다음","각",
]);

function extractKeywords(text: string): string[] {
  return text
    .replace(/[。.!?,;:""''「」『』【】\[\]()]/g, " ")
    .split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length >= 2 && !KW_STOPWORDS.has(w))
    .reduce<string[]>((acc, w) => { if (!acc.includes(w)) acc.push(w); return acc; }, [])
    .slice(0, 18);
}

const VERDICT_KW_STYLE: Record<string, { bg: string; text: string; border: string; glow: string }> = {
  "사실":           { bg: "rgba(34,197,94,0.12)",  text: "#16a34a", border: "rgba(34,197,94,0.4)",  glow: "0 0 12px rgba(34,197,94,0.3)" },
  "부분 사실":      { bg: "rgba(245,158,11,0.12)", text: "#d97706", border: "rgba(245,158,11,0.4)", glow: "0 0 12px rgba(245,158,11,0.3)" },
  "근거 부족":      { bg: "rgba(249,115,22,0.12)", text: "#ea580c", border: "rgba(249,115,22,0.4)", glow: "0 0 12px rgba(249,115,22,0.25)" },
  "반대 근거 우세": { bg: "rgba(239,68,68,0.12)",  text: "#dc2626", border: "rgba(239,68,68,0.4)",  glow: "0 0 12px rgba(239,68,68,0.25)" },
};

function KeywordHighlight({ inputText, claims, overallVerdict }: {
  inputText: string;
  claims: Claim[];
  overallVerdict?: string;
}) {
  const [kwVisible, setKwVisible] = useState<boolean[]>([]);
  const [slideIdx, setSlideIdx] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [slideDir, setSlideDir] = useState<"left" | "right">("left");
  const [progress, setProgress] = useState(0);

  const keywords = extractKeywords(inputText);

  const wordMeta = new Map<string, { verdict: string; confidence: number }>();
  for (const c of claims) {
    extractKeywords(c.claim).forEach(w => {
      if (!wordMeta.has(w)) wordMeta.set(w, { verdict: c.verdict, confidence: c.confidence });
    });
  }

  const defaultStyle = VERDICT_KW_STYLE[overallVerdict ?? ""] ?? {
    bg: "rgba(99,102,241,0.08)", text: "#6366f1", border: "rgba(99,102,241,0.3)", glow: "0 0 10px rgba(99,102,241,0.2)",
  };

  // 키워드 순차 reveal
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    keywords.forEach((_, i) => {
      timers.push(setTimeout(() => {
        setKwVisible(v => { const n = [...v]; n[i] = true; return n; });
      }, 250 + i * 95));
    });
    return () => timers.forEach(clearTimeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 슬라이드쇼 자동 전환 + 프로그레스
  const SLIDE_MS = 4800;
  useEffect(() => {
    if (claims.length <= 1) return;
    setProgress(0);
    const startAt = Date.now();
    const raf = setInterval(() => {
      setProgress(Math.min(((Date.now() - startAt) / SLIDE_MS) * 100, 100));
    }, 40);
    const t = setTimeout(() => {
      clearInterval(raf);
      setSlideDir("left");
      setIsTransitioning(true);
      setTimeout(() => {
        setSlideIdx(i => (i + 1) % claims.length);
        setIsTransitioning(false);
        setProgress(0);
      }, 300);
    }, SLIDE_MS);
    return () => { clearTimeout(t); clearInterval(raf); };
  }, [slideIdx, claims.length]);

  const goTo = (idx: number) => {
    if (idx === slideIdx || isTransitioning) return;
    setSlideDir(idx > slideIdx ? "left" : "right");
    setIsTransitioning(true);
    setTimeout(() => {
      setSlideIdx(idx);
      setIsTransitioning(false);
      setProgress(0);
    }, 280);
  };

  const currentClaim = claims[slideIdx];
  const claimVStyle = currentClaim
    ? (VERDICT_KW_STYLE[currentClaim.verdict] ?? defaultStyle)
    : defaultStyle;

  return (
    <div className="border border-border/40 bg-surface overflow-hidden">
      {/* 헤더 */}
      <div className="px-4 sm:px-5 py-2.5 border-b border-border/30 flex items-center gap-2 bg-surface-2/40">
        <Sparkles className="w-3.5 h-3.5 text-primary/60" />
        <span className="text-[11px] font-bold text-muted-foreground/60 uppercase tracking-widest">AI 분析 하이라이트</span>
        <div className="ml-auto flex gap-1">
          {[0, 1, 2].map(i => (
            <div key={i} className="w-1.5 h-1.5 rounded-full bg-primary/40 animate-bounce"
              style={{ animationDelay: `${i * 0.18}s`, animationDuration: "1.1s" }} />
          ))}
        </div>
      </div>

      {/* ── 섹션 1: 핵심 키워드 클라우드 ── */}
      <div className="px-4 sm:px-5 pt-4 pb-3.5 border-b border-border/20">
        <p className="text-[10px] font-bold text-muted-foreground/40 uppercase tracking-widest mb-3">핵심 키워드</p>
        <div className="flex flex-wrap gap-2 min-h-[52px] items-center">
          {keywords.map((word, i) => {
            const meta = wordMeta.get(word);
            const s = meta ? (VERDICT_KW_STYLE[meta.verdict] ?? defaultStyle) : defaultStyle;
            const conf = meta?.confidence ?? 50;
            const szPad = conf >= 80
              ? "text-[16px] px-3.5 py-1.5"
              : conf >= 65 ? "text-[14px] px-3 py-1"
              : "text-[12px] px-2.5 py-0.5";
            const vis = !!kwVisible[i];
            return (
              <span
                key={word}
                className={`inline-flex items-center rounded-full font-semibold border cursor-default select-none ${szPad}`}
                style={{
                  background: vis ? s.bg : "transparent",
                  color: vis ? s.text : "transparent",
                  borderColor: vis ? s.border : "transparent",
                  boxShadow: vis ? s.glow : "none",
                  opacity: vis ? 1 : 0,
                  transform: vis ? "translateY(0) scale(1)" : "translateY(16px) scale(0.7)",
                  transition: "opacity 0.45s cubic-bezier(0.34,1.56,0.64,1), transform 0.45s cubic-bezier(0.34,1.56,0.64,1), background 0.3s, color 0.3s, border-color 0.3s, box-shadow 0.3s",
                  transitionDelay: vis ? `${i * 22}ms` : "0ms",
                  animation: vis ? `kwFloat ${2.4 + (i % 4) * 0.38}s ease-in-out infinite` : "none",
                  animationDelay: `${i * 0.18 + 0.6}s`,
                }}
                title={meta ? `${meta.verdict} (${meta.confidence}%)` : undefined}
              >
                {word}
              </span>
            );
          })}
        </div>
      </div>

      {/* ── 섹션 2: 핵심 주장 슬라이드쇼 ── */}
      {claims.length > 0 && (
        <div>
          {/* 슬라이드 헤더 */}
          <div className="px-4 sm:px-5 pt-3 pb-0 flex items-center justify-between">
            <p className="text-[10px] font-bold text-muted-foreground/40 uppercase tracking-widest">핵심 주장</p>
            <div className="flex items-center gap-2">
              {claims.length > 1 && (
                <>
                  <button type="button" onClick={() => goTo((slideIdx - 1 + claims.length) % claims.length)}
                    className="w-5 h-5 rounded-full border border-border/40 flex items-center justify-center hover:bg-surface-2 transition-colors">
                    <ChevronLeft className="w-3 h-3 text-muted-foreground" />
                  </button>
                  <span className="text-[10px] text-muted-foreground/50 tabular-nums">{slideIdx + 1} / {claims.length}</span>
                  <button type="button" onClick={() => goTo((slideIdx + 1) % claims.length)}
                    className="w-5 h-5 rounded-full border border-border/40 flex items-center justify-center hover:bg-surface-2 transition-colors">
                    <ChevronRight className="w-3 h-3 text-muted-foreground" />
                  </button>
                </>
              )}
            </div>
          </div>

          {/* 슬라이드 본문 */}
          <div className="px-4 sm:px-5 pt-2.5 pb-3 overflow-hidden">
            <div
              className="rounded-xl p-4 border"
              style={{
                background: `linear-gradient(135deg, ${claimVStyle.bg} 0%, transparent 100%)`,
                borderColor: claimVStyle.border,
                opacity: isTransitioning ? 0 : 1,
                transform: isTransitioning
                  ? (slideDir === "left" ? "translateX(-18px)" : "translateX(18px)")
                  : "translateX(0)",
                transition: "opacity 0.28s ease, transform 0.28s ease",
              }}
            >
              {/* 주장 텍스트 — 단어 단위 순차 등장 */}
              <ClaimTextReveal
                key={`${slideIdx}-${currentClaim?.claim ?? ""}`}
                text={currentClaim?.claim ?? ""}
              />

              {/* 이유 한줄 */}
              {currentClaim?.reasoning && (
                <p className="text-xs text-muted-foreground mt-2 leading-relaxed line-clamp-2">
                  {currentClaim.reasoning}
                </p>
              )}

              {/* 판정 + 신뢰도 */}
              <div className="flex items-center gap-2.5 mt-3 flex-wrap">
                <span
                  className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold border"
                  style={{ background: claimVStyle.bg, color: claimVStyle.text, borderColor: claimVStyle.border }}
                >
                  {currentClaim?.verdict ?? "근거 부족"}
                </span>
                <span className="text-[11px] text-muted-foreground">신뢰도 {currentClaim?.confidence ?? 0}%</span>

                {/* 미니 원형 게이지 */}
                <div className="ml-auto shrink-0">
                  <MiniCircle value={currentClaim?.confidence ?? 0} color={claimVStyle.text} />
                </div>
              </div>
            </div>
          </div>

          {/* 프로그레스 바 + 인디케이터 */}
          {claims.length > 1 && (
            <div className="px-4 sm:px-5 pb-3.5">
              <div className="h-0.5 w-full bg-border/25 rounded-full overflow-hidden mb-2.5">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${progress}%`,
                    background: claimVStyle.text,
                    transition: "width 0.04s linear",
                  }}
                />
              </div>
              <div className="flex items-center justify-center gap-1.5">
                {claims.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => goTo(i)}
                    className="rounded-full transition-all duration-300 focus:outline-none"
                    style={{
                      width: i === slideIdx ? "22px" : "6px",
                      height: "6px",
                      background: i === slideIdx ? claimVStyle.text : "rgba(0,0,0,0.12)",
                    }}
                    aria-label={`주장 ${i + 1}`}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes kwFloat {
          0%, 100% { transform: translateY(0) scale(1); }
          50%       { transform: translateY(-4px) scale(1.03); }
        }
        @keyframes wordPop {
          0%   { opacity: 0; transform: translateY(6px) scale(0.88); }
          60%  { transform: translateY(-2px) scale(1.04); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}

/* ── 주장 텍스트 단어별 순차 등장 ── */
function ClaimTextReveal({ text }: { text: string }) {
  const words = text.split(" ").filter(Boolean);
  const [visCount, setVisCount] = useState(0);

  useEffect(() => {
    setVisCount(0);
    const timers: ReturnType<typeof setTimeout>[] = [];
    words.forEach((_, i) => {
      timers.push(setTimeout(() => setVisCount(c => c + 1), i * 55));
    });
    return () => timers.forEach(clearTimeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <p className="text-sm font-medium text-foreground leading-relaxed">
      {words.map((word, i) => (
        <span
          key={i}
          className="inline-block mr-[0.28em]"
          style={{
            opacity: i < visCount ? 1 : 0,
            animation: i < visCount ? "wordPop 0.35s cubic-bezier(0.34,1.56,0.64,1) forwards" : "none",
          }}
        >
          {word}
        </span>
      ))}
    </p>
  );
}

/* ── 미니 원형 신뢰도 게이지 ── */
function MiniCircle({ value, color }: { value: number; color: string }) {
  const r = 13;
  const circ = 2 * Math.PI * r;
  const [animated, setAnimated] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setAnimated(value), 60);
    return () => clearTimeout(t);
  }, [value]);

  return (
    <svg width="34" height="34" viewBox="0 0 34 34">
      <circle cx="17" cy="17" r={r} fill="none" stroke="rgba(0,0,0,0.08)" strokeWidth="3" />
      <circle
        cx="17" cy="17" r={r}
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={circ - (animated / 100) * circ}
        transform="rotate(-90 17 17)"
        style={{ transition: "stroke-dashoffset 0.8s cubic-bezier(0.34,1.56,0.64,1)" }}
      />
      <text x="17" y="21" textAnchor="middle" fontSize="8.5" fontWeight="700" fill={color}>{value}</text>
    </svg>
  );
}

/* ── 원문 요약 ── */
function InputSummary({ text, label }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const preview = text.slice(0, 200).trimEnd();
  const hasMore = text.length > 200;

  return (
    <div className="border border-border/50 bg-surface overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start gap-2.5 px-4 sm:px-5 py-3 text-left hover:bg-surface-2/50 transition-colors"
      >
        <FileText className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium shrink-0">분석 원문</span>
            <span className="text-muted-foreground/30 shrink-0 text-xs">|</span>
            {label && (
              <span
                className="font-semibold text-foreground/85 truncate leading-tight"
                style={{ fontSize: "15px" }}
              >
                {label}
              </span>
            )}
          </div>
        </div>
        <span className="text-xs text-muted-foreground shrink-0 mt-0.5 mr-1">{text.length.toLocaleString()}자</span>
        {open
          ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
          : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />}
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
            <span className="w-1 h-1 rounded-full bg-muted-foreground/30 shrink-0 mt-[7px]" />
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
  const mainClaims   = indexed.filter(({ c }) => c.verdict !== "근거 부족");
  const unknownClaims = indexed.filter(({ c }) => c.verdict === "근거 부족");
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
            <EvidenceLinks title="확인 필요 항목" icon={AlertTriangle} colorClass="text-yellow-400"
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
        핵심 주장 및 근거 요약
      </h2>

      {/* 판정 분포 */}
      <div className="flex flex-wrap gap-2 mb-4">
        {Object.entries(verdictCount).map(([verdict, count]) => {
          const meta = VERDICT_META[verdict] ?? VERDICT_META["근거 부족"];
          const Icon = meta.icon;
          return (
            <span key={verdict} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold ${meta.bg} ${meta.border} ${meta.color}`}>
              <Icon className="w-3 h-3" /> {meta.label} {count}건
            </span>
          );
        })}
      </div>

      {/* 주장 목록 — 근거 미리보기 포함 */}
      <div className="space-y-2">
        {mainClaims.map(({ c, i }) => {
          const { verdictLabel: vLabel, basisLabel: bLabel } = getVerdictDisplay(c);
          const isOp = c.judgment_basis === "의견/견해";
          const meta = isOp
            ? { icon: HelpCircle, color: "text-muted-foreground", bg: "bg-surface-2", border: "border-border/40", label: "의견/견해" }
            : (VERDICT_META[vLabel] ?? VERDICT_META["근거 부족"]);
          const Icon = meta.icon;
          const isExpanded = expandedIdx === i;
          const highlight = !isOp && isHighlight(c.verdict);
          const accentClass = c.verdict === "사실"
            ? "border-l-[3px] border-l-verdict-true"
            : c.verdict === "반대 근거 우세"
              ? "border-l-[3px] border-l-verdict-false"
              : "";
          const ctMeta = CLAIM_TYPE_META[c.claim_type ?? "EMPIRICAL"] ?? CLAIM_TYPE_META.EMPIRICAL;
          const evStrength = evidenceStrength(c);
          const preview = evidencePreview(c, 2);

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
                    <span className={`font-mono text-[9px] font-bold border px-1 py-px rounded-sm uppercase tracking-widest ${ctMeta.color}`}>
                      {ctMeta.label}
                    </span>
                    {bLabel && (
                      <span className="font-mono text-[9px] font-bold border border-verdict-partial/50 text-verdict-partial bg-verdict-partial/10 px-1 py-px rounded-sm uppercase tracking-widest">
                        {bLabel}
                      </span>
                    )}
                    {/* 근거 강도 배지 */}
                    {evStrength.total > 0 && (
                      <span className={`font-mono text-[9px] font-bold border px-1 py-px rounded-sm uppercase tracking-widest ${evStrength.color} border-current/30`}>
                        {evStrength.label}
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
                  {/* 근거 미리보기 (접힌 상태에서도 표시) */}
                  {preview.length > 0 && (
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                      {preview.map((ev, ei) => (
                        <span key={ei} className={`inline-flex items-center gap-1 text-[10px] leading-relaxed ${
                          ev.type === "support" ? "text-emerald-400/70" : "text-red-400/70"
                        }`}>
                          <span className="shrink-0">{ev.type === "support" ? "▲" : "▼"}</span>
                          <span className="truncate max-w-[200px] sm:max-w-[280px]">{ev.text}</span>
                        </span>
                      ))}
                    </div>
                  )}
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

      {/* 근거 부족 섹션 (이전 DB 레코드 하위 호환) */}
      {unknownClaims.length > 0 && (
        <div className="mt-4 pt-3 border-t border-border/25">
          <button
            type="button"
            onClick={() => setShowUnknown(v => !v)}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-2/50 transition-colors text-left"
          >
            <AlertCircle className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <span className="text-[11px] text-muted-foreground/60 font-medium">
              근거 부족 {unknownClaims.length}건 — {phase2Loading ? "심층 검토 중…" : "이전 분석 기록"}
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
                const meta = VERDICT_META["근거 부족"];
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

/* ── 신뢰도 아이콘 + 텍스트 표시 ── */
function ConfidenceEmoji({ value, large }: { value: number; large?: boolean }) {
  const { text, color } = getConfidenceLabel(value);
  const Icon = value >= 86 ? CheckCircle2 : value >= 71 ? SmilePlus : value >= 51 ? Meh : value >= 31 ? HelpCircle : Frown;
  return (
    <span className={`inline-flex items-center gap-1 font-medium ${color} ${large ? "text-sm" : "text-xs"}`}>
      <Icon className={large ? "w-4 h-4" : "w-3.5 h-3.5"} />
      <span className={large ? "" : "hidden sm:inline"}>{text}</span>
    </span>
  );
}

/* ── 상세 클레임 카드 (접기/펼치기) ── */
function ClaimCard({ index, claim, reviewing, simpleData }: {
  index: number;
  claim: Claim;
  reviewing?: boolean;
  simpleData?: SimplifiedClaim | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const { verdictLabel, basisLabel } = getVerdictDisplay(claim);
  const isOpinion = claim.judgment_basis === "의견/견해";
  const meta = isOpinion
    ? { icon: HelpCircle, color: "text-muted-foreground", bg: "bg-surface-2", border: "border-border/40", label: "의견/견해" }
    : (VERDICT_META[verdictLabel] ?? VERDICT_META["근거 부족"]);
  const Icon = meta.icon;
  const isSimple = !!simpleData;

  const hasDetails =
    claim.reasoning ||
    claim.supporting_points.length > 0 ||
    claim.counter_points.length > 0 ||
    claim.unknowns.length > 0 ||
    claim.suggested_sources.length > 0;

  const claimTypeMeta = CLAIM_TYPE_META[claim.claim_type ?? "EMPIRICAL"] ?? CLAIM_TYPE_META.EMPIRICAL;

  return (
    <article className={`border-l-[3px] ${meta.border} border border-border/50 bg-surface shadow-[var(--shadow-card)]`}>

      {/* ── 쉬운 모드: 아날로지 비유 배너 ── */}
      {isSimple && simpleData?.analogy && (
        <div className="mx-4 sm:mx-5 mt-4 mb-0 flex items-start gap-2.5 bg-primary/6 border border-primary/20 rounded-lg px-3 py-2.5">
          <Target className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <p className="text-xs text-foreground/80 leading-relaxed italic">
            {simpleData.analogy}
          </p>
        </div>
      )}

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
            <p className="text-sm font-medium leading-snug mb-1.5 pr-2">{claim.claim}</p>

            {/* 근거 요약 미리보기 (접힌 상태에서도 표시) */}
            {!isSimple && !expanded && claim.reasoning && (
              <p className="text-xs text-muted-foreground/70 leading-relaxed mb-1.5 line-clamp-1">
                {claim.reasoning}
              </p>
            )}
            {!isSimple && !expanded && (claim.supporting_points.length > 0 || claim.counter_points.length > 0) && (
              <div className="flex flex-wrap gap-3 mb-1.5">
                {claim.supporting_points.length > 0 && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400/70">
                    <ThumbsUp className="w-2.5 h-2.5" /> 지지 {claim.supporting_points.length}
                  </span>
                )}
                {claim.counter_points.length > 0 && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-red-400/70">
                    <ThumbsDown className="w-2.5 h-2.5" /> 반박 {claim.counter_points.length}
                  </span>
                )}
                {claim.unknowns.length > 0 && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-yellow-400/70">
                    <AlertTriangle className="w-2.5 h-2.5" /> 미비 {claim.unknowns.length}
                  </span>
                )}
              </div>
            )}

            {/* 자세히 모드: SPO 구조 */}
            {!isSimple && (claim.subject || claim.predicate || claim.object) && (
              <div className="flex items-center gap-1 flex-wrap mb-2">
                {claim.subject   && <span className="text-[9px] bg-border/20 border border-border/40 rounded px-1 py-0.5 text-muted-foreground/60 font-mono">S:{claim.subject}</span>}
                {claim.predicate && <span className="text-[9px] bg-border/20 border border-border/40 rounded px-1 py-0.5 text-muted-foreground/60 font-mono">P:{claim.predicate}</span>}
                {claim.object    && <span className="text-[9px] bg-border/20 border border-border/40 rounded px-1 py-0.5 text-muted-foreground/60 font-mono">O:{claim.object}</span>}
              </div>
            )}

            <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
              {/* 주장 유형 배지 (자세히 모드만) */}
              {!isSimple && (
                <span className={`font-mono text-[9px] font-bold border px-1.5 py-0.5 rounded-sm uppercase tracking-widest ${claimTypeMeta.color}`}>
                  {claimTypeMeta.label}
                </span>
              )}
              {/* 판정 기준 접두어 */}
              {basisLabel && (
                <span className="font-mono text-[9px] font-bold border border-verdict-partial/50 text-verdict-partial bg-verdict-partial/10 px-1.5 py-0.5 rounded-sm uppercase tracking-widest">
                  {basisLabel}
                </span>
              )}

              {/* 쉬운 모드: friendly_verdict / 자세히 모드: meta 배지 */}
              {isSimple && simpleData?.friendly_verdict ? (
                <span className={`inline-flex items-center gap-1 px-2.5 py-1 border text-sm font-bold rounded-lg ${meta.bg} ${meta.border} ${meta.color}`}>
                  {simpleData.friendly_verdict}
                </span>
              ) : (
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 border text-xs font-semibold rounded-sm ${meta.bg} ${meta.border} ${meta.color}`}>
                  <Icon className="w-3 h-3" /> {isOpinion ? "의견/견해" : meta.label}
                </span>
              )}

              {reviewing
                ? <span className="inline-flex items-center gap-1 text-[10px] text-primary/70 font-medium"><Loader2 className="w-3 h-3 animate-spin" />심층 검토 중…</span>
                : isSimple
                  ? <ConfidenceEmoji value={claim.confidence} />
                  : <ConfidenceBar value={claim.confidence} compact />}
            </div>
          </div>
          {/* 클레임별 게이지 */}
          <div className="shrink-0 flex flex-col items-center gap-0.5 ml-auto">
            <VerdictGauge verdict={verdictLabel} confidence={claim.confidence} size="sm" />
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

          {/* 쉬운 모드: simple_reasoning */}
          {isSimple && simpleData?.simple_reasoning && (
            <div className="flex items-start gap-2 pl-9">
              <p className="text-sm text-foreground/85 leading-relaxed font-medium">
                {simpleData.simple_reasoning}
              </p>
            </div>
          )}

          {/* 자세히 모드: 원본 reasoning */}
          {!isSimple && claim.reasoning && (
            <p className="text-sm text-muted-foreground leading-relaxed pl-9">{claim.reasoning}</p>
          )}

          {/* 쉬운 모드: simple 근거 목록 */}
          {isSimple ? (
            <div className="pl-9 grid sm:grid-cols-2 gap-2.5">
              {(simpleData?.simple_supporting ?? []).length > 0 && (
                <PointList Icon={ThumbsUp} title="이래서 맞는 것 같아요" items={simpleData!.simple_supporting} tone="true"
                  links={simpleData!.simple_supporting.map(p => `https://news.google.com/search?q=${encodeURIComponent(p.slice(0, 70))}&hl=ko&gl=KR&ceid=KR:ko`)}
                />
              )}
              {(simpleData?.simple_counter ?? []).length > 0 && (
                <PointList Icon={ThumbsDown} title="이래서 의심스러워요" items={simpleData!.simple_counter} tone="false"
                  links={simpleData!.simple_counter.map(p => `https://news.google.com/search?q=${encodeURIComponent(p.slice(0, 70))}&hl=ko&gl=KR&ceid=KR:ko`)}
                />
              )}
              {/* 신뢰도 시각화 */}
              <div className="sm:col-span-2 flex items-center gap-3 py-2">
                <span className="text-xs text-muted-foreground">신뢰도</span>
                <div className="flex-1 h-2.5 rounded-full bg-border/40 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${
                      claim.confidence >= 70 ? "bg-verdict-true" :
                      claim.confidence >= 40 ? "bg-verdict-partial" : "bg-verdict-false"
                    }`}
                    style={{ width: `${claim.confidence}%` }}
                  />
                </div>
                <ConfidenceEmoji value={claim.confidence} large />
              </div>
            </div>
          ) : (
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
                <PointList Icon={AlertTriangle} title="확인 필요 항목" items={claim.unknowns} tone="unknown"
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
          )}
        </div>
      )}
    </article>
  );
}

/* ── 반원형 속도계 게이지 ── */
function VerdictGauge({ verdict, confidence, size = "md" }: {
  verdict: string;
  confidence: number;
  size?: "sm" | "md" | "lg";
}) {
  const cx = 60, cy = 62, r = 50;
  const needleAngle = (confidence / 100) * 180 - 90;

  const verdictColors: Record<string, string> = {
    "사실":           "#22c55e",
    "부분 사실":      "#f59e0b",
    "근거 부족":      "#f97316",
    "반대 근거 우세": "#ef4444",
  };
  const vColor = verdictColors[verdict] ?? "#8b95a1";

  const ticks = Array.from({ length: 9 }, (_, i) => {
    const a = (i / 8) * Math.PI;
    const cosA = Math.cos(Math.PI - a);
    const sinA = Math.sin(Math.PI - a);
    return {
      x1: cx + (r - 7) * cosA,  y1: cy - (r - 7) * sinA,
      x2: cx + (r + 2) * cosA,  y2: cy - (r + 2) * sinA,
      major: i % 4 === 0,
    };
  });

  const wClass = { sm: "w-[72px]", md: "w-[116px]", lg: "w-[152px]" }[size];

  return (
    <div className={`flex flex-col items-center gap-1 ${wClass}`}>
      <svg viewBox="0 0 120 72" className="w-full drop-shadow-sm">
        <defs>
          <linearGradient id={`vgGrad-${size}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%"   stopColor="#ef4444" />
            <stop offset="28%"  stopColor="#f97316" />
            <stop offset="52%"  stopColor="#eab308" />
            <stop offset="76%"  stopColor="#84cc16" />
            <stop offset="100%" stopColor="#22c55e" />
          </linearGradient>
          <filter id="needleShadow"><feDropShadow dx="0" dy="1" stdDeviation="1" floodOpacity="0.25"/></filter>
        </defs>

        {/* 배경 트랙 */}
        <path d={`M ${cx-r} ${cy} A ${r} ${r} 0 0 1 ${cx+r} ${cy}`}
          fill="none" stroke="#e5e8eb" strokeWidth="12" strokeLinecap="round" />
        {/* 그라데이션 트랙 */}
        <path d={`M ${cx-r} ${cy} A ${r} ${r} 0 0 1 ${cx+r} ${cy}`}
          fill="none" stroke={`url(#vgGrad-${size})`} strokeWidth="12" strokeLinecap="round" />
        {/* 눈금 */}
        {ticks.map((t, i) => (
          <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
            stroke="white" strokeWidth={t.major ? 2 : 1} strokeLinecap="round" />
        ))}
        {/* 바늘 */}
        <g transform={`translate(${cx},${cy}) rotate(${needleAngle})`} filter="url(#needleShadow)">
          <line x1="0" y1="6" x2="0" y2={-(r-14)} stroke="#1f2937" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="0" cy="0" r="5.5" fill="#1f2937" />
          <circle cx="0" cy="0" r="2.2" fill="white" />
        </g>
      </svg>
      {/* 판정 배지 */}
      <span className="text-[11px] font-bold rounded-full px-2.5 py-0.5 border whitespace-nowrap"
        style={{ color: vColor, borderColor: `${vColor}55`, backgroundColor: `${vColor}18` }}>
        {verdict}
      </span>
    </div>
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
      await navigator.share({ title: "팩트체크 분석 결과", url });
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
              <span className="w-1 h-1 rounded-full bg-muted-foreground/30 shrink-0 mt-[5px]" />
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
