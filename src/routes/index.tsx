import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useEffect, useRef, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowRight, Link2, FileText, Sparkles, ShieldCheck,
  Search, Scale, Mic, Loader2, AlertCircle, CheckCircle2,
  HelpCircle, XCircle, MinusCircle, ThumbsUp, ThumbsDown,
  TriangleAlert, RefreshCw, MessageSquare,
} from "lucide-react";

import { analyzeContent, quickAnalyzeContent, type QuickCheckResult } from "@/lib/analyses.functions";
import { fetchYouTubeInfo, isYouTubeUrl, type YouTubeInfo } from "@/lib/youtube.functions";
import { getSessionId } from "@/lib/session";
import { SiteHeader, BottomNav } from "@/components/SiteHeader";
import { VoiceInput } from "@/components/VoiceInput";
import { TrendingNews } from "@/components/TrendingNews";
import { AnalysisLoadingOverlay } from "@/components/AnalysisLoadingOverlay";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "K-Fact — 근거 중심 사실검증 보조" },
      { name: "description", content: "기사·게시물 본문에서 핵심 주장을 추출하고 신뢰도와 근거를 구조화해 보여주는 AI 검증 보조 도구." },
      { property: "og:title", content: "K-Fact — 근거 중심 사실검증 보조" },
      { property: "og:description", content: "주장 추출, 근거 정합성 평가, 반박 가능성까지 한 화면에서." },
    ],
  }),
  component: Home,
});

const VERDICT_META: Record<string, { icon: typeof CheckCircle2; color: string; bg: string; label: string }> = {
  "사실": { icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-400/10 border-emerald-400/30", label: "사실" },
  "부분 사실": { icon: MinusCircle, color: "text-yellow-400", bg: "bg-yellow-400/10 border-yellow-400/30", label: "부분 사실" },
  "근거 부족": { icon: HelpCircle, color: "text-orange-400", bg: "bg-orange-400/10 border-orange-400/30", label: "근거 부족" },
  "반대 근거 우세": { icon: XCircle, color: "text-red-400", bg: "bg-red-400/10 border-red-400/30", label: "반대 근거 우세" },
  "미확인": { icon: AlertCircle, color: "text-muted-foreground", bg: "bg-border/30 border-border", label: "미확인" },
};

const QUICK_CHECK_DEBOUNCE = 2500;
const QUICK_CHECK_MIN = 80;

type VoiceSentence = {
  id: string;
  text: string;
  speaker: string;
  loading: boolean;
  result: QuickCheckResult | null;
  error: string | null;
};

const SPEAKER_BADGE: Record<string, string> = {
  "화자 A": "bg-blue-400/15 border-blue-400/30 text-blue-400",
  "화자 B": "bg-emerald-400/15 border-emerald-400/30 text-emerald-400",
  "화자 C": "bg-amber-400/15 border-amber-400/30 text-amber-400",
  "화자 D": "bg-rose-400/15 border-rose-400/30 text-rose-400",
};

function sanitizeServerError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.trim().startsWith("<!") || msg.trim().startsWith("<html")) {
    return "서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
  }
  return msg || "오류가 발생했습니다.";
}

function Home() {
  const navigate = useNavigate();
  const analyze = useServerFn(analyzeContent);
  const quickCheck = useServerFn(quickAnalyzeContent);
  const fetchYTInfo = useServerFn(fetchYouTubeInfo);

  const [mode, setMode] = useState<"text" | "url" | "voice" | "chat">("text");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [interimText, setInterimText] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // YouTube 관련 상태
  const [ytInfo, setYtInfo] = useState<YouTubeInfo | null>(null);
  const [ytLoading, setYtLoading] = useState(false);
  const [ytErr, setYtErr] = useState<string | null>(null);
  const ytTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [quickResult, setQuickResult] = useState<QuickCheckResult | null>(null);
  const [quickLoading, setQuickLoading] = useState(false);
  const [quickErr, setQuickErr] = useState<string | null>(null);
  const quickTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastCheckedRef = useRef("");

  const [voiceSentences, setVoiceSentences] = useState<VoiceSentence[]>([]);

  // 텍스트가 변경될 때 디바운스로 빠른 팩트체크 실행
  const scheduleQuickCheck = useCallback(
    (t: string) => {
      clearTimeout(quickTimerRef.current);
      if (t.length < QUICK_CHECK_MIN) {
        setQuickResult(null);
        setQuickErr(null);
        return;
      }
      quickTimerRef.current = setTimeout(async () => {
        if (t === lastCheckedRef.current) return;
        lastCheckedRef.current = t;
        setQuickLoading(true);
        setQuickErr(null);
        try {
          const result = await quickCheck({ data: { text: t } });
          setQuickResult(result);
        } catch (e) {
          setQuickErr(sanitizeServerError(e));
          setQuickResult(null);
        } finally {
          setQuickLoading(false);
        }
      }, QUICK_CHECK_DEBOUNCE);
    },
    [quickCheck],
  );

  useEffect(() => {
    if (mode === "voice") return;
    scheduleQuickCheck(text);
    return () => clearTimeout(quickTimerRef.current);
  }, [text, scheduleQuickCheck, mode]);

  // YouTube URL 감지 → 자막+메타데이터 자동 fetch
  useEffect(() => {
    clearTimeout(ytTimerRef.current);
    if (mode !== "url" || !isYouTubeUrl(url)) {
      setYtInfo(null);
      setYtErr(null);
      setYtLoading(false);
      return;
    }
    setYtLoading(true);
    setYtErr(null);
    ytTimerRef.current = setTimeout(async () => {
      try {
        const info = await fetchYTInfo({ data: { url } });
        setYtInfo(info);
        setText(info.transcript);
      } catch (e) {
        setYtErr(e instanceof Error ? e.message : "영상 정보를 가져오지 못했습니다");
        setYtInfo(null);
      } finally {
        setYtLoading(false);
      }
    }, 800);
    return () => clearTimeout(ytTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, mode]);

  // URL 모드 벗어나면 YouTube 상태 초기화
  useEffect(() => {
    if (mode !== "url") {
      setYtInfo(null);
      setYtErr(null);
    }
  }, [mode]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const sessionId = getSessionId();
      const res = await analyze({
        data: { url: mode === "url" ? url : undefined, text, sessionId },
      });
      navigate({ to: "/analysis/$id", params: { id: res.id } });
    } catch (e) {
      setErr(sanitizeServerError(e));
    } finally {
      setLoading(false);
    }
  };

  const effectiveText = mode === "voice" ? text + interimText : text;
  const canSubmit =
    (mode === "url" ? !!url.trim() : text.trim().length >= 30) && !loading;

  // 탭 전환 시 텍스트 초기화
  const handleModeChange = (newMode: "text" | "url" | "voice" | "chat") => {
    if (newMode === mode) return;
    setMode(newMode);
    setText("");
    setInterimText("");
    setQuickResult(null);
    setQuickErr(null);
    setVoiceSentences([]);
  };

  const handleVoiceSentence = useCallback(async (sentence: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setVoiceSentences(prev => [...prev, { id, text: sentence, speaker: "단일", loading: true, result: null, error: null }]);
    try {
      const result = await quickCheck({ data: { text: sentence } });
      setVoiceSentences(prev => prev.map(s => s.id === id ? { ...s, loading: false, result } : s));
    } catch (e) {
      setVoiceSentences(prev => prev.map(s => s.id === id ? { ...s, loading: false, error: sanitizeServerError(e) } : s));
    }
  }, [quickCheck]);

  // 트렌딩 뉴스 클릭 → URL 세팅 후 즉시 분석 제출
  const handleAnalyzeFromTrending = async (trendUrl: string): Promise<void> => {
    setUrl(trendUrl);
    setMode("url");
    setText("");
    setQuickResult(null);
    setQuickErr(null);
    setErr(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
    setLoading(true);
    try {
      const sessionId = getSessionId();
      const res = await analyze({ data: { url: trendUrl, text: "", sessionId } });
      navigate({ to: "/analysis/$id", params: { id: res.id } });
    } catch (e) {
      setErr(sanitizeServerError(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <BottomNav />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 pt-16 sm:pt-20 pb-36 sm:pb-32">
        {/* Hero */}
        <section className="text-center mb-8 sm:mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full glass mb-5 sm:mb-6">
            <Sparkles className="w-3.5 h-3.5 text-accent" />
            <span className="text-xs sm:text-xs tracking-wide text-muted-foreground">AI 사실검증 보조</span>
          </div>
          <h1 className="text-2xl sm:text-4xl md:text-5xl font-bold leading-[1.15] mb-4 sm:mb-5">
            판정하지 않습니다.
            <br />
            <span className="gradient-text">근거를 구조화합니다.</span>
          </h1>
          <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            기사나 게시물 본문을 넣으면 핵심 주장 단위로 분리하고,
            <br className="hidden md:block" />
            지지·반박·미확인 근거와 신뢰도를 한 화면에 보여드립니다.
          </p>
        </section>

        {/* 메인 2열 레이아웃: 좌=입력폼, 우=실시간 뉴스 */}
        <div className="grid xl:grid-cols-[1fr_420px] gap-6 items-start">
        {/* 좌측: 입력 폼 영역 */}
        <div className="order-1">

        {/* ── 대화 버튼 (폼 위 중앙) ── */}
        {!loading && (
          <div className="flex justify-center mb-4">
            <button
              type="button"
              onClick={() => handleModeChange(mode === "chat" ? "text" : "chat")}
              className={`inline-flex items-center gap-3 px-10 py-4 rounded-full border-2 text-base font-bold shadow-xl transition-all duration-200 active:scale-95 ${
                mode === "chat"
                  ? "bg-gradient-to-r from-amber-500 to-yellow-400 border-amber-400 text-amber-950 shadow-amber-400/50 scale-105"
                  : "bg-gradient-to-r from-amber-400 to-yellow-300 border-amber-300 text-amber-900 shadow-amber-300/40 hover:scale-105 hover:from-amber-500 hover:to-yellow-400 hover:shadow-amber-400/60"
              }`}
            >
              <MessageSquare className="w-6 h-6" />
              {mode === "chat" ? "대화 분석 중" : "대화 분석"}
            </button>
          </div>
        )}

        {/* 분석 로딩 오버레이 */}
        {loading && (
          <AnalysisLoadingOverlay
            text={effectiveText}
            url={mode === "url" ? url : undefined}
          />
        )}

        {/* Input card */}
        <form
          onSubmit={onSubmit}
          className={`glass rounded-2xl p-2 shadow-[var(--shadow-card)] transition-all duration-300 ${loading ? "opacity-0 pointer-events-none absolute inset-x-0 -z-10" : "opacity-100"}`}
        >
          {/* 탭 */}
          <div className="flex gap-1 p-1 mb-1">
            <TabButton active={mode === "text"} onClick={() => handleModeChange("text")}>
              <FileText className="w-4 h-4" />
              <span>텍스트</span>
            </TabButton>
            <TabButton active={mode === "url"} onClick={() => handleModeChange("url")}>
              <Link2 className="w-4 h-4" />
              <span>URL</span>
            </TabButton>
            <TabButton active={mode === "voice"} onClick={() => handleModeChange("voice")}>
              <Mic className="w-4 h-4" />
              <span>음성 입력</span>
            </TabButton>
          </div>

          <div className="bg-background/40 rounded-xl p-4 sm:p-4">
            {/* URL 모드 */}
            {mode === "url" && (
              <div className="relative mb-3">
                <input
                  type="url"
                  required={mode === "url"}
                  placeholder="https://news.example.com/article/123  또는  YouTube / Shorts URL"
                  value={url}
                  onChange={(e) => { setUrl(e.target.value); setYtInfo(null); setYtErr(null); }}
                  className="w-full bg-transparent border-b border-border pb-3 outline-none focus:border-primary placeholder:text-muted-foreground/50 text-base pr-20"
                />
                {isYouTubeUrl(url) && (
                  <span className="absolute right-0 bottom-3.5 text-[10px] font-semibold text-red-400 bg-red-400/10 border border-red-400/30 px-2 py-0.5 rounded-full">
                    YouTube
                  </span>
                )}
              </div>
            )}

            {/* YouTube 감지 시 프리뷰 카드 */}
            {mode === "url" && isYouTubeUrl(url) && (
              <div className="mb-3">
                {ytLoading && (
                  <div className="flex items-center gap-2.5 text-sm text-muted-foreground py-2 px-1">
                    <Loader2 className="w-4 h-4 animate-spin text-red-400 shrink-0" />
                    유튜브 영상 정보와 자막을 불러오는 중…
                  </div>
                )}
                {ytErr && !ytLoading && (
                  <div className="flex items-start gap-2 text-sm text-destructive py-2 px-1">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{ytErr}</span>
                  </div>
                )}
                {ytInfo && !ytLoading && (
                  <div className="flex gap-3 bg-background/30 rounded-xl p-3 border border-border/40">
                    <img
                      src={ytInfo.thumbnailUrl}
                      alt={ytInfo.title}
                      className="w-24 h-16 sm:w-20 sm:h-14 object-cover rounded-lg shrink-0 bg-surface-2"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                        <YoutubeIcon className="w-3.5 h-3.5 text-red-500 shrink-0" />
                        <span className="text-xs font-semibold text-red-400">
                          {ytInfo.isShorts ? "YouTube Shorts" : "YouTube"}
                        </span>
                        {ytInfo.transcriptAvailable ? (
                          <span className="text-[10px] text-emerald-400 bg-emerald-400/10 border border-emerald-400/30 px-1.5 py-0.5 rounded-full">
                            자막 {ytInfo.charCount.toLocaleString()}자 ✓
                          </span>
                        ) : (
                          <span className="text-[10px] text-orange-400 bg-orange-400/10 border border-orange-400/30 px-1.5 py-0.5 rounded-full">
                            자막 없음 — 제목만 분석
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-medium line-clamp-2 leading-snug">{ytInfo.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{ytInfo.author}</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 대화 모드 헤더 */}
            {mode === "chat" && (
              <div className="flex items-center gap-2 mb-2 px-1">
                <MessageSquare className="w-3.5 h-3.5 text-primary shrink-0" />
                <span className="text-xs font-semibold text-primary">대화 분석 모드</span>
                <span className="text-[10px] text-muted-foreground/60">— 화자별 발언을 구분해 입력하세요</span>
              </div>
            )}

            {/* 텍스트 / URL / 대화 입력 영역 */}
            {mode !== "voice" && (
              <textarea
                rows={ytInfo ? 3 : 4}
                placeholder={
                  mode === "chat"
                    ? "화자 A: 정부가 발표한 GDP 성장률은 3.5%입니다.\n화자 B: 그건 작년보다 2배 상승한 수치라고 하던데요.\n화자 A: 맞아요, 전문가들도 긍정적으로 평가했습니다."
                    : mode === "url"
                      ? ytInfo
                        ? "자막이 자동으로 입력되었습니다 — 직접 수정도 가능합니다"
                        : isYouTubeUrl(url)
                          ? "자막을 불러오는 중…"
                          : "URL에서 본문을 가져오지 못하면 사용할 백업 텍스트 (30자 이상)"
                      : "검증하고 싶은 기사·보도자료·SNS 본문을 붙여넣으세요. (30자 이상)"
                }
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="w-full bg-transparent outline-none resize-none placeholder:text-muted-foreground/50 text-foreground text-sm leading-relaxed"
              />
            )}

            {/* 음성 입력 모드 */}
            {mode === "voice" && (
              <>
                <VoiceInput
                  value={text}
                  onChange={setText}
                  interimText={interimText}
                  onInterimChange={setInterimText}
                  onSentenceComplete={handleVoiceSentence}
                />

                {/* 문장별 실시간 팩트체크 패널 */}
                {voiceSentences.length > 0 && (
                  <div className="mt-4 border-t border-border/50 pt-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Sparkles className="w-3.5 h-3.5 text-accent shrink-0" />
                      <span className="text-xs font-semibold text-muted-foreground tracking-wide">
                        문장별 실시간 팩트체크
                      </span>
                      {/* 화자별 분석 수 요약 */}
                      {(() => {
                        const counts: Record<string, number> = {};
                        voiceSentences.forEach(s => { if (s.speaker !== "단일") counts[s.speaker] = (counts[s.speaker] ?? 0) + 1; });
                        return Object.entries(counts).map(([sp, cnt]) => (
                          <span key={sp} className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${SPEAKER_BADGE[sp] ?? "bg-border/30 border-border text-muted-foreground"}`}>
                            {sp} {cnt}건
                          </span>
                        ));
                      })()}
                      {voiceSentences.some(s => s.loading) && (
                        <span className="ml-auto flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          <RefreshCw className="w-3 h-3 animate-spin" /> 분석 중…
                        </span>
                      )}
                    </div>
                    <div className="space-y-2 max-h-96 overflow-y-auto pr-0.5">
                      {voiceSentences.map((s, idx) => {
                        const meta = s.result ? (VERDICT_META[s.result.overall_verdict] ?? VERDICT_META["미확인"]) : null;
                        const Icon = meta?.icon;
                        const brief = s.result?.highlights[0]?.brief ?? s.result?.summary ?? "";
                        const badgeClass = SPEAKER_BADGE[s.speaker] ?? "";
                        const isSolo = s.speaker === "단일";
                        // 이전 문장과 화자가 다를 때 구분선
                        const prevSpeaker = idx > 0 ? voiceSentences[idx - 1].speaker : null;
                        const speakerChanged = !isSolo && prevSpeaker !== null && prevSpeaker !== s.speaker;
                        return (
                          <div key={s.id}>
                            {speakerChanged && (
                              <div className="flex items-center gap-2 my-1">
                                <div className="flex-1 h-px bg-border/40" />
                                <span className="text-[10px] text-muted-foreground/50">화자 전환</span>
                                <div className="flex-1 h-px bg-border/40" />
                              </div>
                            )}
                            <div
                              className={`rounded-xl border px-3 py-2.5 transition-all ${
                                s.loading
                                  ? "border-border/40 bg-background/20"
                                  : s.error
                                    ? "border-destructive/20 bg-destructive/5"
                                    : meta
                                      ? `${meta.bg} border-border/40`
                                      : "border-border/40 bg-background/20"
                              }`}
                            >
                              {/* 화자 배지 + 발화 내용 */}
                              <div className="flex items-start gap-2 mb-1.5">
                                {!isSolo && (
                                  <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border ${badgeClass}`}>
                                    {s.speaker}
                                  </span>
                                )}
                                <p className="text-xs text-foreground/85 leading-relaxed flex-1">
                                  {s.text}
                                </p>
                              </div>

                              {s.loading && (
                                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground ml-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                                  팩트체크 중…
                                </div>
                              )}
                              {s.error && !s.loading && (
                                <p className="text-[10px] text-destructive ml-1">{s.error.slice(0, 60)}</p>
                              )}
                              {s.result && meta && Icon && (
                                <div className="space-y-1 ml-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <div className={`flex items-center gap-1 ${meta.color}`}>
                                      <Icon className="w-3 h-3 shrink-0" />
                                      <span className="text-[10px] font-semibold">{meta.label}</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                      <div className="w-16 h-1 rounded-full bg-border/60 overflow-hidden">
                                        <div
                                          className={`h-full rounded-full ${meta.color.replace("text-", "bg-")}`}
                                          style={{ width: `${s.result.overall_confidence}%`, opacity: 0.75 }}
                                        />
                                      </div>
                                      <span className="text-[10px] text-muted-foreground">{s.result.overall_confidence}%</span>
                                    </div>
                                  </div>
                                  {brief && (
                                    <p className="text-[10px] text-muted-foreground leading-relaxed line-clamp-2">
                                      {brief}
                                    </p>
                                  )}
                                  {s.result.risk_flags.length > 0 && (
                                    <div className="flex items-center gap-1 flex-wrap">
                                      <TriangleAlert className="w-2.5 h-2.5 text-orange-400 shrink-0" />
                                      {s.result.risk_flags.map((f, fi) => (
                                        <span key={fi} className="text-[9px] text-orange-400 bg-orange-400/10 border border-orange-400/20 px-1.5 py-0.5 rounded-full">
                                          {f}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={() => setVoiceSentences([])}
                      className="mt-2 text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                    >
                      결과 지우기
                    </button>
                  </div>
                )}
              </>
            )}

            {/* 실시간 팩트체크 프리뷰 (텍스트·URL 모드 전용) */}
            {mode !== "voice" && (quickLoading || quickResult || quickErr) && text.length >= QUICK_CHECK_MIN && (
              <div className="mt-4 border-t border-border/50 pt-4 space-y-3">
                {/* 헤더 */}
                <div className="flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-accent shrink-0" />
                  <span className="text-xs font-semibold text-muted-foreground tracking-wide">
                    실시간 팩트체크 미리보기
                  </span>
                  {quickLoading && (
                    <span className="ml-auto flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <RefreshCw className="w-3 h-3 animate-spin" /> AI 분석 중…
                    </span>
                  )}
                </div>

                {/* 로딩 스켈레톤 */}
                {quickLoading && !quickResult && (
                  <div className="space-y-2 animate-pulse">
                    <div className="h-3 bg-border/50 rounded-full w-3/4" />
                    <div className="h-8 bg-border/30 rounded-lg" />
                    <div className="h-8 bg-border/30 rounded-lg w-5/6" />
                  </div>
                )}

                {/* 오류 */}
                {quickErr && !quickLoading && (
                  <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{quickErr}</span>
                  </div>
                )}

                {/* 결과 */}
                {quickResult && (
                  <div className="space-y-2.5">
                    {/* 요약 + 전체 판정 */}
                    <div className="bg-background/30 rounded-xl border border-border/40 px-3 py-2.5 space-y-2">
                      {quickResult.summary && (
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          {quickResult.summary}
                        </p>
                      )}
                      <div className="flex items-center gap-2 flex-wrap">
                        <OverallBadge
                          verdict={quickResult.overall_verdict}
                          confidence={quickResult.overall_confidence}
                        />
                        {quickResult.highlights.length > 0 && (
                          <span className="text-[11px] text-muted-foreground">
                            주장 {quickResult.highlights.length}개 분석됨
                          </span>
                        )}
                      </div>
                    </div>

                    {/* 위험 신호 */}
                    {quickResult.risk_flags.length > 0 && (
                      <div className="flex items-start gap-2 bg-orange-400/8 border border-orange-400/25 rounded-lg px-3 py-2">
                        <TriangleAlert className="w-3.5 h-3.5 text-orange-400 shrink-0 mt-0.5" />
                        <div className="flex flex-wrap gap-1.5">
                          {quickResult.risk_flags.map((flag, i) => (
                            <span key={i} className="text-[10px] font-medium text-orange-400 bg-orange-400/10 border border-orange-400/20 px-2 py-0.5 rounded-full">
                              {flag}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 주장별 카드 */}
                    {quickResult.highlights.length > 0 && (
                      <div className="space-y-2">
                        {quickResult.highlights.map((h, i) => {
                          const meta = VERDICT_META[h.verdict] ?? VERDICT_META["미확인"];
                          const Icon = meta.icon;
                          return (
                            <div key={i} className={`rounded-xl border px-3 py-2.5 ${meta.bg}`}>
                              {/* 주장 + 판정 */}
                              <div className="flex items-start gap-2 mb-1.5">
                                <Icon className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${meta.color}`} />
                                <p className="text-xs font-medium leading-relaxed text-foreground/90 flex-1">
                                  {h.claim}
                                </p>
                              </div>

                              {/* 판정 이유 */}
                              <p className="text-[11px] text-muted-foreground leading-relaxed ml-5 mb-2">
                                {h.brief}
                              </p>

                              {/* 지지/반박 근거 */}
                              {(h.supporting || h.counter) && (
                                <div className="ml-5 space-y-1">
                                  {h.supporting && (
                                    <div className="flex items-start gap-1.5">
                                      <ThumbsUp className="w-3 h-3 text-emerald-500 shrink-0 mt-0.5" />
                                      <span className="text-[10px] text-emerald-600 dark:text-emerald-400 leading-relaxed">{h.supporting}</span>
                                    </div>
                                  )}
                                  {h.counter && (
                                    <div className="flex items-start gap-1.5">
                                      <ThumbsDown className="w-3 h-3 text-red-400 shrink-0 mt-0.5" />
                                      <span className="text-[10px] text-red-500 dark:text-red-400 leading-relaxed">{h.counter}</span>
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* 신뢰도 바 */}
                              <div className="flex items-center gap-2 mt-2 ml-5">
                                <span className={`text-[10px] font-semibold ${meta.color}`}>{meta.label}</span>
                                <div className="flex-1 max-w-[100px] h-1 rounded-full bg-border/60 overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all duration-700 ${meta.color.replace("text-", "bg-")}`}
                                    style={{ width: `${h.confidence}%`, opacity: 0.75 }}
                                  />
                                </div>
                                <span className="text-[10px] text-muted-foreground">{h.confidence}%</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] text-muted-foreground/50 leading-relaxed">
                        ※ 미리보기는 빠른 추론 결과입니다.
                      </p>
                      <button
                        type="submit"
                        disabled={!canSubmit}
                        className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-opacity"
                      >
                        <ArrowRight className="w-3.5 h-3.5" />
                        상세 분석
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 하단 바 */}
            <div className="pt-3 mt-3 border-t border-border space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {text.length}자
                  {mode === "voice" && interimText && (
                    <span className="text-muted-foreground/50"> + {interimText.length}자 인식 중</span>
                  )}
                  {" · "}로그인 시 기록 보관
                </span>
                {err && <span className="text-xs text-destructive">{err}</span>}
              </div>
              <button
                type="submit"
                disabled={!canSubmit}
                className="w-full sm:w-auto sm:float-right inline-flex items-center justify-center gap-2 px-6 py-3.5 sm:py-2.5 rounded-xl sm:rounded-lg bg-gradient-to-r from-primary to-accent text-primary-foreground font-semibold text-base sm:text-sm hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-[var(--shadow-glow)]"
              >
                {loading ? (
                  <>
                    <span className="inline-block w-5 h-5 sm:w-4 sm:h-4 border-2 border-primary-foreground/40 border-t-primary-foreground rounded-full animate-spin" />
                    AI 분석 중…
                  </>
                ) : (
                  <>
                    주장 분석 시작
                    <ArrowRight className="w-5 h-5 sm:w-4 sm:h-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        </form>

        </div>{/* 좌측 끝 */}

        {/* 우측: 실시간 뉴스 패널 */}
        <div className="order-2 xl:sticky xl:top-24">
          <TrendingNews onAnalyze={handleAnalyzeFromTrending} />
        </div>

        </div>{/* grid 끝 */}

        {/* Features */}
        <section className="grid sm:grid-cols-3 gap-4 mt-12 sm:mt-16">
          <Feature
            Icon={Search}
            title="주장 단위 분리"
            desc="기사 전체가 아닌 검증 가능한 핵심 주장 3~7개를 따로 뽑아냅니다."
          />
          <Feature
            Icon={Scale}
            title="지지·반박 양면 평가"
            desc="지지 근거와 반박 근거, 그리고 확인 불가능한 항목을 동시에 표시합니다."
          />
          <Feature
            Icon={ShieldCheck}
            title="단정 대신 신뢰도"
            desc="허위 판정 리스크를 줄이기 위해 모든 결과를 확률/근거 기반으로 표현합니다."
          />
        </section>

        <p className="text-center text-sm text-muted-foreground mt-10 sm:mt-12 max-w-xl mx-auto leading-relaxed px-2">
          ※ K-Fact는 사실검증을 <strong className="text-foreground/80">보조</strong>하는 도구이며 최종 판정 도구가 아닙니다.
          중요한 의사결정 전에는 반드시 신뢰할 수 있는 1차 출처를 직접 확인하세요.
        </p>

        <div className="text-center mt-6">
          <Link
            to="/history"
            className="inline-flex items-center gap-1 text-sm sm:text-sm text-muted-foreground hover:text-foreground transition-colors py-2 px-4"
          >
            이전 분석 기록 보기 →
          </Link>
        </div>
      </main>
    </div>
  );
}

function OverallBadge({ verdict, confidence }: { verdict: string; confidence: number }) {
  const meta = VERDICT_META[verdict] ?? VERDICT_META["미확인"];
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-semibold ${meta.bg} ${meta.color}`}>
      <Icon className="w-3 h-3" />
      전체 {meta.label} · {confidence}%
    </span>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-1.5 px-2 sm:px-4 py-3 sm:py-2.5 rounded-lg text-sm font-medium transition-all min-h-[48px] sm:min-h-0 ${
        active ? "bg-surface-2 text-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function Feature({
  Icon,
  title,
  desc,
}: {
  Icon: typeof Search;
  title: string;
  desc: string;
}) {
  return (
    <div className="glass rounded-xl p-5 sm:p-5 flex gap-4 sm:block">
      <Icon className="w-6 h-6 sm:w-5 sm:h-5 text-primary sm:mb-3 shrink-0 mt-0.5" />
      <div>
        <h3 className="font-semibold text-base sm:text-base mb-1.5">{title}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}

function YoutubeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}
