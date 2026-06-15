import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useEffect, useRef, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowRight, Link2, FileText, Sparkles, ShieldCheck,
  Search, Scale, Mic, Loader2, AlertCircle, CheckCircle2,
  HelpCircle, XCircle, MinusCircle,
} from "lucide-react";

import { analyzeContent, quickAnalyzeContent, type QuickCheckResult } from "@/lib/analyses.functions";
import { fetchYouTubeInfo, isYouTubeUrl, type YouTubeInfo } from "@/lib/youtube.functions";
import { getSessionId } from "@/lib/session";
import { SiteHeader } from "@/components/SiteHeader";
import { VoiceInput } from "@/components/VoiceInput";
import { TrendingNews } from "@/components/TrendingNews";

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

const QUICK_CHECK_DEBOUNCE = 2000;
const QUICK_CHECK_MIN = 50;

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

  const [mode, setMode] = useState<"text" | "url" | "voice">("text");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [interimText, setInterimText] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // YouTube 관련 상태
  const [ytInfo, setYtInfo] = useState<YouTubeInfo | null>(null);
  const [ytLoading, setYtLoading] = useState(false);
  const [ytErr, setYtErr] = useState<string | null>(null);
  const ytTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const [quickResult, setQuickResult] = useState<QuickCheckResult | null>(null);
  const [quickLoading, setQuickLoading] = useState(false);
  const [quickErr, setQuickErr] = useState<string | null>(null);
  const quickTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const lastCheckedRef = useRef("");

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
    scheduleQuickCheck(text);
    return () => clearTimeout(quickTimerRef.current);
  }, [text, scheduleQuickCheck]);

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
  const canSubmit = effectiveText.replace(interimText, "").trim().length >= 30 && !loading;

  // URL 탭으로 전환하면서 url 값을 채우는 핸들러
  const handleAnalyzeFromTrending = (trendUrl: string) => {
    setUrl(trendUrl);
    setMode("url");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="min-h-screen">
      <SiteHeader />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 pt-16 sm:pt-20 pb-24 sm:pb-32">
        {/* Hero */}
        <section className="text-center mb-8 sm:mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full glass mb-5 sm:mb-6">
            <Sparkles className="w-3.5 h-3.5 text-accent" />
            <span className="text-xs sm:text-xs tracking-wide text-muted-foreground">AI 사실검증 보조</span>
          </div>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold leading-[1.1] mb-4 sm:mb-5">
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

        {/* 로딩 배너 */}
        {loading && (
          <div className="glass rounded-xl px-5 py-4 mb-4 flex items-center gap-3">
            <span className="inline-block w-5 h-5 border-2 border-accent/40 border-t-accent rounded-full animate-spin shrink-0" />
            <span className="text-muted-foreground text-sm sm:text-sm leading-snug">AI가 주장을 분석하고 있습니다. 보통 10~20초 정도 걸립니다…</span>
          </div>
        )}

        {/* Input card */}
        <form
          onSubmit={onSubmit}
          className={`glass rounded-2xl p-2 shadow-[var(--shadow-card)] transition-opacity ${loading ? "opacity-70 pointer-events-none" : ""}`}
        >
          {/* 탭 */}
          <div className="flex gap-1 p-1 mb-1">
            <TabButton active={mode === "text"} onClick={() => setMode("text")}>
              <FileText className="w-4 h-4" />
              <span>텍스트</span>
            </TabButton>
            <TabButton active={mode === "url"} onClick={() => setMode("url")}>
              <Link2 className="w-4 h-4" />
              <span>URL</span>
            </TabButton>
            <TabButton active={mode === "voice"} onClick={() => setMode("voice")}>
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

            {/* 텍스트 / URL 입력 영역 */}
            {mode !== "voice" && (
              <textarea
                required
                rows={ytInfo ? 5 : 7}
                placeholder={
                  mode === "url"
                    ? ytInfo
                      ? "자막이 자동으로 입력되었습니다 — 직접 수정도 가능합니다"
                      : isYouTubeUrl(url)
                        ? "자막을 불러오는 중…"
                        : "URL에서 본문을 가져오지 못하면 사용할 백업 텍스트 (30자 이상)"
                    : "검증하고 싶은 기사·보도자료·SNS 본문을 붙여넣으세요. (30자 이상)"
                }
                value={text}
                onChange={(e) => setText(e.target.value)}
                minLength={30}
                className="w-full bg-transparent outline-none resize-none placeholder:text-muted-foreground/60 text-foreground text-base leading-relaxed"
              />
            )}

            {/* 음성 입력 모드 */}
            {mode === "voice" && (
              <VoiceInput
                value={text}
                onChange={setText}
                interimText={interimText}
                onInterimChange={setInterimText}
              />
            )}

            {/* 실시간 팩트체크 프리뷰 */}
            {(quickLoading || quickResult || quickErr) && text.length >= QUICK_CHECK_MIN && (
              <div className="mt-4 border-t border-border/50 pt-4">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles className="w-3.5 h-3.5 text-accent" />
                  <span className="text-xs font-medium text-muted-foreground tracking-wide uppercase">
                    실시간 팩트체크 미리보기
                  </span>
                  {quickLoading && (
                    <Loader2 className="w-3.5 h-3.5 text-accent animate-spin ml-auto" />
                  )}
                </div>

                {quickErr && (
                  <p className="text-xs text-destructive flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {quickErr}
                  </p>
                )}

                {quickResult && !quickLoading && (
                  <div className="space-y-2">
                    {/* 전체 판정 배지 */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <OverallBadge
                        verdict={quickResult.overall_verdict}
                        confidence={quickResult.overall_confidence}
                      />
                      <span className="text-xs text-muted-foreground">
                        핵심 주장 {quickResult.highlights.length}개 감지
                      </span>
                    </div>

                    {/* 주장별 미니 카드 */}
                    <div className="space-y-1.5">
                      {quickResult.highlights.map((h, i) => {
                        const meta = VERDICT_META[h.verdict] ?? VERDICT_META["미확인"];
                        const Icon = meta.icon;
                        return (
                          <div
                            key={i}
                            className={`rounded-lg border px-3 py-2.5 flex gap-2.5 ${meta.bg}`}
                          >
                            <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${meta.color}`} />
                            <div className="min-w-0">
                              <p className="text-xs font-medium leading-relaxed text-foreground/90 line-clamp-2">
                                {h.claim}
                              </p>
                              <p className="text-xs text-muted-foreground mt-1 leading-relaxed line-clamp-2">
                                {h.brief}
                              </p>
                              <div className="flex items-center gap-1.5 mt-1.5">
                                <span className={`text-[10px] font-semibold ${meta.color}`}>
                                  {meta.label}
                                </span>
                                <span className="text-[10px] text-muted-foreground">·</span>
                                <div className="flex-1 max-w-[80px] h-1 rounded-full bg-border overflow-hidden">
                                  <div
                                    className={`h-full rounded-full ${meta.color.replace("text-", "bg-")}`}
                                    style={{ width: `${h.confidence}%`, opacity: 0.7 }}
                                  />
                                </div>
                                <span className="text-[10px] text-muted-foreground">{h.confidence}%</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <p className="text-[10px] text-muted-foreground/60 pt-0.5">
                      ※ 미리보기는 빠른 추론 결과입니다. 정밀 분석을 위해 아래 버튼을 누르세요.
                    </p>
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
