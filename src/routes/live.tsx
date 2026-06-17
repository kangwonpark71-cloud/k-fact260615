import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useCallback, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  MessageSquare, Send, Trash2, RefreshCw, Sparkles,
  CheckCircle2, XCircle, MinusCircle, HelpCircle, AlertCircle,
  ThumbsUp, ThumbsDown, TriangleAlert, Users, Download, Loader2,
  Mic, Square, MicOff,
} from "lucide-react";

import { quickAnalyzeContent, type QuickCheckResult } from "@/lib/analyses.functions";
import { SiteHeader, BottomNav } from "@/components/SiteHeader";

export const Route = createFileRoute("/live")({
  head: () => ({
    meta: [
      { title: "대화 분석 — K-Fact" },
      { name: "description", content: "실시간 대화를 문장 단위로 팩트체크하고 기록합니다." },
    ],
  }),
  component: LivePage,
});

/* ── 타입 ── */
type Speaker = "화자 A" | "화자 B" | "화자 C" | "화자 D";
const SPEAKERS: Speaker[] = ["화자 A", "화자 B", "화자 C", "화자 D"];

const SPEAKER_STYLE: Record<Speaker, { badge: string; bubble: string; dot: string }> = {
  "화자 A": { badge: "bg-blue-500/20 border-blue-400/40 text-blue-400", bubble: "border-blue-400/20 bg-blue-500/5", dot: "bg-blue-400" },
  "화자 B": { badge: "bg-emerald-500/20 border-emerald-400/40 text-emerald-400", bubble: "border-emerald-400/20 bg-emerald-500/5", dot: "bg-emerald-400" },
  "화자 C": { badge: "bg-amber-500/20 border-amber-400/40 text-amber-400", bubble: "border-amber-400/20 bg-amber-500/5", dot: "bg-amber-400" },
  "화자 D": { badge: "bg-rose-500/20 border-rose-400/40 text-rose-400", bubble: "border-rose-400/20 bg-rose-500/5", dot: "bg-rose-400" },
};

const VERDICT_META = {
  "사실": { icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-400/10 border-emerald-400/30", label: "사실" },
  "부분 사실": { icon: MinusCircle, color: "text-yellow-400", bg: "bg-yellow-400/10 border-yellow-400/30", label: "부분 사실" },
  "근거 부족": { icon: HelpCircle, color: "text-orange-400", bg: "bg-orange-400/10 border-orange-400/30", label: "근거 부족" },
  "반대 근거 우세": { icon: XCircle, color: "text-red-400", bg: "bg-red-400/10 border-red-400/30", label: "반대 근거 우세" },
  "미확인": { icon: AlertCircle, color: "text-muted-foreground", bg: "bg-border/20 border-border/40", label: "미확인" },
} as const;

type Utterance = {
  id: string;
  speaker: Speaker;
  text: string;
  time: string;
  checking: boolean;
  result: QuickCheckResult | null;
  error: string | null;
};

/* ── 음성 인식 훅 ── */
function useSpeechRecognition({
  onFinal,
  onInterim,
}: {
  onFinal: (text: string) => void;
  onInterim: (text: string) => void;
}) {
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState<boolean | null>(null);
  const [barHeights, setBarHeights] = useState<number[]>(Array(20).fill(3));

  const recRef = useRef<any>(null);
  const listeningRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setIsSupported(!!SR);
    return () => stopAudio();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopAudio = () => {
    cancelAnimationFrame(animRef.current);
    try { audioCtxRef.current?.close(); } catch {}
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setBarHeights(Array(20).fill(3));
  };

  const startAudio = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const step = Math.max(1, Math.floor(buf.length / 20));
      const tick = () => {
        if (!listeningRef.current) return;
        analyser.getByteFrequencyData(buf);
        setBarHeights(Array.from({ length: 20 }, (_, i) => {
          const slice = buf.slice(i * step, i * step + step);
          const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
          return Math.max(3, (avg / 255) * 32);
        }));
        animRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch { /* 시각화 없이 진행 */ }
  };

  const start = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = "ko-KR";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e: any) => {
      let interim = "";
      let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t;
        else interim += t;
      }
      if (final) {
        onInterim("");
        onFinal(final.trim());
      } else {
        onInterim(interim);
      }
    };
    rec.onerror = (e: any) => {
      if (e.error === "not-allowed") {
        alert("마이크 접근 권한이 필요합니다. 브라우저 설정에서 허용해 주세요.");
        stop();
      }
    };
    rec.onend = () => { if (listeningRef.current) { try { rec.start(); } catch {} } };
    recRef.current = rec;
    listeningRef.current = true;
    setIsListening(true);
    rec.start();
    startAudio();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onFinal, onInterim]);

  const stop = useCallback(() => {
    listeningRef.current = false;
    recRef.current?.stop();
    recRef.current = null;
    setIsListening(false);
    onInterim("");
    stopAudio();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onInterim]);

  return { isListening, isSupported, barHeights, start, stop };
}

/* ── 메인 컴포넌트 ── */
function LivePage() {
  const doQuickCheck = useServerFn(quickAnalyzeContent);

  const [speaker, setSpeaker] = useState<Speaker>("화자 A");
  const [input, setInput] = useState("");
  const [interim, setInterim] = useState("");
  const [utterances, setUtterances] = useState<Utterance[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // addUtterance를 ref로 저장하여 음성 콜백에서 항상 최신 참조
  const addRef = useRef<(text: string) => void>(() => {});

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [utterances.length]);

  const addUtterance = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || submitting) return;

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

    setUtterances(prev => [...prev, { id, speaker, text: trimmed, time: now, checking: true, result: null, error: null }]);
    setInput("");
    setSubmitting(true);
    textareaRef.current?.focus();

    try {
      const result = await doQuickCheck({ data: { text: trimmed } });
      setUtterances(prev => prev.map(u => u.id === id ? { ...u, checking: false, result } : u));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "분석 실패";
      setUtterances(prev => prev.map(u => u.id === id ? { ...u, checking: false, error: msg.slice(0, 80) } : u));
    } finally {
      setSubmitting(false);
    }
  }, [speaker, submitting, doQuickCheck]);

  // 최신 addUtterance를 ref에 동기화
  useEffect(() => { addRef.current = addUtterance; }, [addUtterance]);

  // 음성 인식: 확정 문장 → 자동 팩트체크 추가
  const { isListening, isSupported, barHeights, start, stop } = useSpeechRecognition({
    onFinal: useCallback((text: string) => {
      setInput(text);
      // 15자 이상이면 자동 제출
      if (text.length >= 15) {
        setTimeout(() => addRef.current(text), 0);
      } else {
        setInput(text);
      }
    }, []),
    onInterim: useCallback((text: string) => setInterim(text), []),
  });

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      addUtterance(input);
    }
  };

  const handleExport = () => {
    if (utterances.length === 0) return;
    const lines = utterances.map(u => {
      const verdict = u.result
        ? `[${u.result.overall_verdict} ${u.result.overall_confidence}%]`
        : u.error ? "[분석 실패]" : "[처리 중]";
      return `[${u.time}] ${u.speaker}: ${u.text}\n  → ${verdict}${u.result?.summary ? " " + u.result.summary : ""}`;
    });
    const blob = new Blob([lines.join("\n\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `대화분석_${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const stats = utterances.reduce<Partial<Record<Speaker, number>>>((acc, u) => {
    acc[u.speaker] = (acc[u.speaker] ?? 0) + 1;
    return acc;
  }, {});

  const displayInput = interim || input;

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <BottomNav />

      <main className="flex-1 max-w-3xl mx-auto w-full px-4 sm:px-6 pt-6 pb-36 sm:pb-24 flex flex-col gap-4">

        {/* 페이지 헤더 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-yellow-400 grid place-items-center shadow-lg shadow-amber-400/30">
              <MessageSquare className="w-5 h-5 text-amber-950" />
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight">실시간 대화 팩트체크</h1>
              <p className="text-xs text-muted-foreground">텍스트 입력 또는 마이크로 발언을 추가하고 즉시 검증합니다</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {utterances.length > 0 && (
              <>
                <button type="button" onClick={handleExport} title="결과 내보내기"
                  className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors">
                  <Download className="w-4 h-4" />
                </button>
                <button type="button" onClick={() => { setUtterances([]); if (isListening) stop(); }} title="전체 초기화"
                  className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* 화자 선택 */}
        <div className="glass rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Users className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="text-xs font-semibold text-muted-foreground tracking-wide">화자 선택</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {SPEAKERS.map(sp => {
              const style = SPEAKER_STYLE[sp];
              const isActive = speaker === sp;
              const count = stats[sp] ?? 0;
              return (
                <button key={sp} type="button" onClick={() => setSpeaker(sp)}
                  className={`flex items-center justify-between px-3 py-2.5 rounded-xl border text-sm font-semibold transition-all ${
                    isActive ? `${style.badge} scale-[1.02] shadow-md` : "border-border/40 text-muted-foreground hover:border-border hover:bg-surface-2/50"
                  }`}>
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${isActive ? style.dot : "bg-muted-foreground/30"}`} />
                    {sp}
                  </div>
                  {count > 0 && (
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isActive ? "bg-white/20" : "bg-border/40 text-muted-foreground"}`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* 입력 영역 */}
        <div className="glass rounded-2xl p-4 space-y-3">
          <div className="flex items-start gap-3">
            <span className={`shrink-0 mt-0.5 text-xs font-bold px-2.5 py-1 rounded-full border ${SPEAKER_STYLE[speaker].badge}`}>
              {speaker}
            </span>
            <div className="flex-1 relative">
              <textarea
                ref={textareaRef}
                rows={2}
                placeholder={isListening ? "음성 인식 중… 말씀하세요" : "발언 내용을 입력하세요 (Enter로 추가, Shift+Enter 줄바꿈)"}
                value={displayInput}
                onChange={e => { if (!isListening) setInput(e.target.value); }}
                onKeyDown={handleKeyDown}
                disabled={submitting}
                className={`w-full bg-transparent outline-none resize-none text-sm leading-relaxed disabled:opacity-60 ${
                  interim ? "text-primary/70 italic placeholder:text-muted-foreground/40" : "placeholder:text-muted-foreground/50"
                }`}
              />
              {isListening && (
                <span className="inline-block w-0.5 h-4 bg-primary ml-0.5 animate-pulse align-middle" />
              )}
            </div>
          </div>

          {/* 음성 파형 (인식 중에만 표시) */}
          {isListening && (
            <div className="flex items-end gap-[2px] h-8 px-1">
              {barHeights.map((h, i) => (
                <div key={i} className="flex-1 rounded-full transition-all duration-75"
                  style={{
                    height: `${h}px`,
                    background: `oklch(${0.6 + (h / 32) * 0.2} ${0.12 + (h / 32) * 0.1} ${238 + i * 5})`,
                  }} />
              ))}
            </div>
          )}

          <div className="flex items-center justify-between border-t border-border/40 pt-3 gap-2">
            <span className="text-[11px] text-muted-foreground/60">
              {isListening
                ? <span className="inline-flex items-center gap-1.5 text-red-400"><span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse inline-block" />음성 인식 중</span>
                : `${input.length}자 · Enter로 추가`}
            </span>

            <div className="flex items-center gap-2">
              {/* 마이크 버튼 */}
              {isSupported === false ? (
                <div title="이 브라우저는 음성 인식을 지원하지 않습니다">
                  <MicOff className="w-4 h-4 text-muted-foreground/40" />
                </div>
              ) : isSupported === true && (
                <button type="button" onClick={isListening ? stop : start}
                  title={isListening ? "음성 인식 중지" : "마이크로 입력"}
                  className={`relative p-2.5 rounded-xl border transition-all ${
                    isListening
                      ? "bg-red-500/20 border-red-400/40 text-red-400 hover:bg-red-500/30 shadow-md shadow-red-400/20"
                      : "border-border/40 text-muted-foreground hover:text-foreground hover:border-border hover:bg-surface-2"
                  }`}>
                  {isListening
                    ? <><span className="absolute inset-0 rounded-xl bg-red-400/20 animate-ping" style={{ animationDuration: "1.4s" }} /><Square className="w-4 h-4 relative" /></>
                    : <Mic className="w-4 h-4" />}
                </button>
              )}

              {/* 추가 버튼 */}
              <button type="button" onClick={() => addUtterance(input)}
                disabled={!input.trim() || submitting || isListening}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 text-amber-950 text-sm font-bold shadow-md shadow-amber-400/30 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-95">
                {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> 분석 중…</> : <><Send className="w-4 h-4" /> 추가</>}
              </button>
            </div>
          </div>
        </div>

        {/* 발언 목록 */}
        {utterances.length === 0 ? (
          <div className="glass rounded-2xl p-10 text-center">
            <MessageSquare className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground mb-1">아직 발언이 없습니다</p>
            <p className="text-xs text-muted-foreground/60">텍스트로 입력하거나 마이크 버튼으로 음성 입력하세요</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 px-1">
              <Sparkles className="w-3.5 h-3.5 text-accent shrink-0" />
              <span className="text-xs font-semibold text-muted-foreground tracking-wide">
                대화 기록 ({utterances.length}건)
              </span>
              {utterances.some(u => u.checking) && (
                <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
                  <RefreshCw className="w-3 h-3 animate-spin" /> 분석 중…
                </span>
              )}
            </div>

            {utterances.map((u, idx) => {
              const style = SPEAKER_STYLE[u.speaker];
              const prevSpeaker = idx > 0 ? utterances[idx - 1].speaker : null;
              const speakerChanged = prevSpeaker !== null && prevSpeaker !== u.speaker;
              return (
                <div key={u.id}>
                  {speakerChanged && (
                    <div className="flex items-center gap-2 my-1 px-1">
                      <div className="flex-1 h-px bg-border/30" />
                      <span className="text-[9px] text-muted-foreground/40 font-medium tracking-wider">화자 전환</span>
                      <div className="flex-1 h-px bg-border/30" />
                    </div>
                  )}
                  <UtteranceCard u={u} style={style} />
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </main>
    </div>
  );
}

/* ── 발언 카드 ── */
function UtteranceCard({ u, style }: { u: Utterance; style: typeof SPEAKER_STYLE["화자 A"] }) {
  const [expanded, setExpanded] = useState(false);
  const meta = u.result ? (VERDICT_META[u.result.overall_verdict] ?? VERDICT_META["미확인"]) : null;
  const Icon = meta?.icon;

  return (
    <div className={`rounded-2xl border p-4 transition-all ${
      u.checking ? "border-border/40 bg-background/20"
      : u.error ? "border-destructive/20 bg-destructive/5"
      : `${style.bubble}`
    }`}>
      <div className="flex items-start justify-between gap-3 mb-2.5">
        <div className="flex items-center gap-2">
          <span className={`shrink-0 text-xs font-bold px-2.5 py-1 rounded-full border ${style.badge}`}>{u.speaker}</span>
          <span className="text-[10px] text-muted-foreground/50">{u.time}</span>
        </div>
        {!u.checking && !u.error && u.result && (
          <button type="button" onClick={() => setExpanded(v => !v)}
            className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors shrink-0">
            {expanded ? "접기" : "상세"}
          </button>
        )}
      </div>

      <p className="text-sm text-foreground/90 leading-relaxed mb-2.5">{u.text}</p>

      {u.checking && (
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />팩트체크 중…
        </div>
      )}
      {u.error && !u.checking && <p className="text-[11px] text-destructive">{u.error}</p>}

      {u.result && meta && Icon && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold ${meta.bg} ${meta.color}`}>
              <Icon className="w-3.5 h-3.5" />{meta.label}
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-20 h-1.5 rounded-full bg-border/50 overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-700 ${meta.color.replace("text-", "bg-")}`}
                  style={{ width: `${u.result.overall_confidence}%`, opacity: 0.8 }} />
              </div>
              <span className="text-xs text-muted-foreground tabular-nums">{u.result.overall_confidence}%</span>
            </div>
          </div>

          {u.result.summary && <p className="text-xs text-muted-foreground leading-relaxed">{u.result.summary}</p>}

          {u.result.risk_flags.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              <TriangleAlert className="w-3 h-3 text-orange-400 shrink-0" />
              {u.result.risk_flags.map((f, i) => (
                <span key={i} className="text-[10px] text-orange-400 bg-orange-400/10 border border-orange-400/20 px-1.5 py-0.5 rounded-full">{f}</span>
              ))}
            </div>
          )}

          {expanded && u.result.highlights.length > 0 && (
            <div className="mt-3 space-y-2 border-t border-border/30 pt-3">
              <span className="text-[10px] font-semibold text-muted-foreground tracking-wide">주장별 분석</span>
              {u.result.highlights.map((h, i) => {
                const hm = VERDICT_META[h.verdict] ?? VERDICT_META["미확인"];
                const HIcon = hm.icon;
                return (
                  <div key={i} className={`rounded-xl border px-3 py-2.5 ${hm.bg}`}>
                    <div className="flex items-start gap-2 mb-1">
                      <HIcon className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${hm.color}`} />
                      <p className="text-xs font-medium leading-relaxed flex-1">{h.claim}</p>
                    </div>
                    {h.brief && <p className="text-[11px] text-muted-foreground ml-5 leading-relaxed mb-1.5">{h.brief}</p>}
                    {(h.supporting || h.counter) && (
                      <div className="ml-5 space-y-1">
                        {h.supporting && (
                          <div className="flex items-start gap-1.5">
                            <ThumbsUp className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" />
                            <span className="text-[10px] text-emerald-400 leading-relaxed">{h.supporting}</span>
                          </div>
                        )}
                        {h.counter && (
                          <div className="flex items-start gap-1.5">
                            <ThumbsDown className="w-3 h-3 text-red-400 shrink-0 mt-0.5" />
                            <span className="text-[10px] text-red-400 leading-relaxed">{h.counter}</span>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 mt-2 ml-5">
                      <span className={`text-[10px] font-semibold ${hm.color}`}>{hm.label}</span>
                      <div className="w-14 h-1 rounded-full bg-border/50 overflow-hidden">
                        <div className={`h-full rounded-full ${hm.color.replace("text-", "bg-")}`}
                          style={{ width: `${h.confidence}%`, opacity: 0.7 }} />
                      </div>
                      <span className="text-[10px] text-muted-foreground">{h.confidence}%</span>
                    </div>
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
