import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useCallback, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  MessageSquare, Trash2, RefreshCw, Sparkles,
  CheckCircle2, XCircle, MinusCircle, HelpCircle, AlertCircle,
  ThumbsUp, ThumbsDown, TriangleAlert, Download,
  Mic, Square, MicOff, ChevronRight, Send,
} from "lucide-react";

import { quickAnalyzeContent, type QuickCheckResult } from "@/lib/analyses.functions";
import { SiteHeader, BottomNav } from "@/components/SiteHeader";

export const Route = createFileRoute("/live")({
  head: () => ({
    meta: [
      { title: "대화 분석 — K-Fact" },
      { name: "description", content: "실시간 대화를 음성으로 자동 기록하고 팩트체크합니다." },
    ],
  }),
  component: LivePage,
});

/* ── 상수 ── */
type Speaker = "화자 A" | "화자 B" | "화자 C" | "화자 D";
const SPEAKERS: Speaker[] = ["화자 A", "화자 B", "화자 C", "화자 D"];

const SPEAKER_STYLE: Record<Speaker, { badge: string; bubble: string; ring: string; dot: string }> = {
  "화자 A": { badge: "bg-blue-500/20 border-blue-400/40 text-blue-400",     bubble: "border-blue-400/20 bg-blue-500/5",     ring: "ring-blue-400/40",    dot: "bg-blue-400" },
  "화자 B": { badge: "bg-emerald-500/20 border-emerald-400/40 text-emerald-400", bubble: "border-emerald-400/20 bg-emerald-500/5", ring: "ring-emerald-400/40", dot: "bg-emerald-400" },
  "화자 C": { badge: "bg-amber-500/20 border-amber-400/40 text-amber-400",   bubble: "border-amber-400/20 bg-amber-500/5",   ring: "ring-amber-400/40",   dot: "bg-amber-400" },
  "화자 D": { badge: "bg-rose-500/20 border-rose-400/40 text-rose-400",     bubble: "border-rose-400/20 bg-rose-500/5",     ring: "ring-rose-400/40",    dot: "bg-rose-400" },
};

const VERDICT_META = {
  "사실":           { icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-400/10 border-emerald-400/30", label: "사실" },
  "부분 사실":      { icon: MinusCircle,  color: "text-yellow-400",  bg: "bg-yellow-400/10 border-yellow-400/30",  label: "부분 사실" },
  "근거 부족":      { icon: HelpCircle,   color: "text-orange-400",  bg: "bg-orange-400/10 border-orange-400/30",  label: "근거 부족" },
  "반대 근거 우세": { icon: XCircle,      color: "text-red-400",     bg: "bg-red-400/10 border-red-400/30",        label: "반대 근거 우세" },
  "미확인":         { icon: AlertCircle,  color: "text-muted-foreground", bg: "bg-border/20 border-border/40",      label: "미확인" },
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
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [barHeights, setBarHeights] = useState<number[]>(Array(28).fill(3));

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
    setBarHeights(Array(28).fill(3));
  };

  const startAudio = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const step = Math.max(1, Math.floor(buf.length / 28));
      const tick = () => {
        if (!listeningRef.current) return;
        analyser.getByteFrequencyData(buf);
        setBarHeights(Array.from({ length: 28 }, (_, i) => {
          const slice = buf.slice(i * step, i * step + step);
          const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
          return Math.max(3, (avg / 255) * 48);
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
        setPermissionDenied(true);
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

  return { isListening, isSupported, permissionDenied, setPermissionDenied, barHeights, start, stop };
}

/* ── 메인 컴포넌트 ── */
function LivePage() {
  const doQuickCheck = useServerFn(quickAnalyzeContent);

  const [speakerIdx, setSpeakerIdx] = useState(0);
  const [input, setInput] = useState("");
  const [interim, setInterim] = useState("");
  const [utterances, setUtterances] = useState<Utterance[]>([]);
  const [showManual, setShowManual] = useState(false);

  const speaker = SPEAKERS[speakerIdx];
  const speakerIdxRef = useRef(speakerIdx);
  useEffect(() => { speakerIdxRef.current = speakerIdx; }, [speakerIdx]);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const addRef = useRef<(text: string) => void>(() => {});

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [utterances.length]);

  const addUtterance = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const currentSpeaker = SPEAKERS[speakerIdxRef.current];
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

    setUtterances(prev => [...prev, { id, speaker: currentSpeaker, text: trimmed, time: now, checking: true, result: null, error: null }]);
    setInput("");
    // 발언 완료 → 다음 화자로 자동 전환
    setSpeakerIdx(i => (i + 1) % SPEAKERS.length);
    textareaRef.current?.focus();

    try {
      const result = await doQuickCheck({ data: { text: trimmed } });
      setUtterances(prev => prev.map(u => u.id === id ? { ...u, checking: false, result } : u));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "분석 실패";
      setUtterances(prev => prev.map(u => u.id === id ? { ...u, checking: false, error: msg.slice(0, 80) } : u));
    }
  }, [doQuickCheck]);

  useEffect(() => { addRef.current = addUtterance; }, [addUtterance]);

  const { isListening, isSupported, permissionDenied, setPermissionDenied, barHeights, start, stop } = useSpeechRecognition({
    onFinal: useCallback((text: string) => {
      if (text.length >= 4) {
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

  const handleReset = () => {
    setUtterances([]);
    setSpeakerIdx(0);
    setInput("");
    setInterim("");
    if (isListening) stop();
  };

  const isAnalyzing = utterances.some(u => u.checking);
  const nextSpeaker = SPEAKERS[(speakerIdx + 1) % SPEAKERS.length];
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
              <p className="text-xs text-muted-foreground">음성 발언마다 자동 화자 전환 및 팩트체크</p>
            </div>
          </div>
          {utterances.length > 0 && (
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={handleExport} title="결과 내보내기"
                className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors">
                <Download className="w-4 h-4" />
              </button>
              <button type="button" onClick={handleReset} title="전체 초기화"
                className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* ── 시작 화면 (발언 없음 + 미녹음 상태) ── */}
        {utterances.length === 0 && !isListening && (
          <StartScreen
            isSupported={isSupported}
            permissionDenied={permissionDenied}
            onStart={() => { setPermissionDenied(false); start(); }}
            onManual={() => { setShowManual(true); setTimeout(() => textareaRef.current?.focus(), 50); }}
          />
        )}

        {/* ── 녹음 중 화자 인디케이터 ── */}
        {isListening && (
          <div className={`glass rounded-2xl p-5 flex flex-col items-center gap-4 ring-2 ${SPEAKER_STYLE[speaker].ring} transition-all`}>
            {/* 현재 화자 배지 (크게) */}
            <div className="flex items-center gap-3">
              <span className={`text-base font-bold px-4 py-2 rounded-full border-2 ${SPEAKER_STYLE[speaker].badge} shadow-lg`}>
                {speaker}
              </span>
              <span className="inline-flex items-center gap-1.5 text-sm text-red-400">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                음성 인식 중
              </span>
            </div>

            {/* 파형 */}
            <div className="flex items-end gap-[2px] h-12 w-full px-2">
              {barHeights.map((h, i) => (
                <div key={i} className="flex-1 rounded-full transition-all duration-75"
                  style={{
                    height: `${h}px`,
                    background: `oklch(${0.55 + (h / 48) * 0.25} ${0.15 + (h / 48) * 0.12} ${230 + i * 4})`,
                  }} />
              ))}
            </div>

            {/* 인식 중인 텍스트 */}
            {interim && (
              <p className="text-sm text-primary/70 italic text-center px-4 leading-relaxed">
                {interim}
                <span className="inline-block w-0.5 h-4 bg-primary ml-0.5 animate-pulse align-middle" />
              </p>
            )}
            {!interim && (
              <p className="text-xs text-muted-foreground/50">말씀하세요 — 발언 완료 시 자동 기록됩니다</p>
            )}

            {/* 다음 화자 예고 + 정지 버튼 */}
            <div className="flex items-center justify-between w-full gap-3">
              <div className="flex items-center gap-1">
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/30 shrink-0" />
                <span className="text-[11px] text-muted-foreground/50">
                  다음 발언 →{" "}
                  <span className={`font-semibold ${SPEAKER_STYLE[nextSpeaker].badge.split(" ").find(c => c.startsWith("text-"))}`}>
                    {nextSpeaker}
                  </span>
                </span>
              </div>
              <button
                type="button"
                onClick={stop}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-red-500/20 border border-red-400/40 text-red-400 text-sm font-semibold hover:bg-red-500/30 transition-all active:scale-95"
              >
                <Square className="w-4 h-4" />
                녹음 중지
              </button>
            </div>
          </div>
        )}

        {/* ── 녹음 중지 후 재시작 + 직접 입력 (발언 있을 때) ── */}
        {(utterances.length > 0 || showManual) && !isListening && (
          <div className="glass rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              {/* 재녹음 버튼 */}
              {isSupported !== false && (
                <button
                  type="button"
                  onClick={start}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 text-amber-950 text-sm font-bold shadow-md shadow-amber-400/30 hover:opacity-90 transition-all active:scale-95"
                >
                  <Mic className="w-4 h-4" />
                  {utterances.length > 0 ? "계속 녹음" : "녹음 시작"}
                </button>
              )}
              {isSupported === false && (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MicOff className="w-3.5 h-3.5" /> 음성 미지원 브라우저
                </span>
              )}
              <span className="text-xs text-muted-foreground/50">또는 직접 입력</span>
            </div>

            {/* 직접 입력창 */}
            <div className="flex items-start gap-2">
              <button
                type="button"
                onClick={() => setSpeakerIdx(i => (i + 1) % SPEAKERS.length)}
                title="클릭하여 화자 전환"
                className={`shrink-0 mt-0.5 text-xs font-bold px-2.5 py-1 rounded-full border transition-all hover:scale-105 active:scale-95 ${SPEAKER_STYLE[speaker].badge}`}
              >
                {speaker}
              </button>
              <textarea
                ref={textareaRef}
                rows={2}
                placeholder="발언 내용 직접 입력 (Enter로 추가)"
                value={displayInput}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                className="flex-1 bg-transparent outline-none resize-none text-sm leading-relaxed placeholder:text-muted-foreground/40"
              />
              <button
                type="button"
                onClick={() => addUtterance(input)}
                disabled={!input.trim()}
                className="shrink-0 p-2 rounded-xl bg-amber-500/20 border border-amber-400/40 text-amber-400 hover:bg-amber-500/30 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ── 발언 목록 ── */}
        {utterances.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 px-1">
              <Sparkles className="w-3.5 h-3.5 text-accent shrink-0" />
              <span className="text-xs font-semibold text-muted-foreground tracking-wide">
                대화 기록 ({utterances.length}건)
              </span>
              {isAnalyzing && (
                <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
                  <RefreshCw className="w-3 h-3 animate-spin" /> 팩트체크 중…
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
                      <ChevronRight className="w-3 h-3 text-muted-foreground/30" />
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

/* ── 시작 화면 컴포넌트 ── */
function StartScreen({
  isSupported,
  permissionDenied,
  onStart,
  onManual,
}: {
  isSupported: boolean | null;
  permissionDenied: boolean;
  onStart: () => void;
  onManual: () => void;
}) {
  const speakerDots = [
    { label: "화자 A", color: "bg-blue-400",    text: "text-blue-400" },
    { label: "화자 B", color: "bg-emerald-400", text: "text-emerald-400" },
    { label: "화자 C", color: "bg-amber-400",   text: "text-amber-400" },
    { label: "화자 D", color: "bg-rose-400",    text: "text-rose-400" },
  ];

  return (
    <div className="glass rounded-2xl p-10 flex flex-col items-center gap-6 text-center">
      {/* 아이콘 펄스 */}
      <div className="relative">
        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-amber-500 to-yellow-400 grid place-items-center shadow-xl shadow-amber-400/40">
          <Mic className="w-9 h-9 text-amber-950" />
        </div>
        <span className="absolute inset-0 rounded-full bg-amber-400/30 animate-ping" style={{ animationDuration: "2s" }} />
      </div>

      <div className="space-y-2">
        <h2 className="text-xl font-bold">대화 녹음을 시작하세요</h2>
        <p className="text-sm text-muted-foreground leading-relaxed max-w-sm">
          여러 명이 발언할 때마다 화자가 자동으로 전환되고,<br />
          각 발언을 즉시 팩트체크합니다.
        </p>
      </div>

      {/* 화자 순환 표시 */}
      <div className="flex items-center gap-2">
        {speakerDots.map((sp, i) => (
          <div key={sp.label} className="flex items-center gap-1.5">
            <div className="flex flex-col items-center gap-1">
              <span className={`w-2.5 h-2.5 rounded-full ${sp.color}`} />
              <span className={`text-[10px] font-semibold ${sp.text}`}>{sp.label.replace("화자 ", "")}</span>
            </div>
            {i < 3 && <ChevronRight className="w-3 h-3 text-muted-foreground/30" />}
          </div>
        ))}
        <ChevronRight className="w-3 h-3 text-muted-foreground/30" />
        <span className="text-[10px] text-muted-foreground/40 font-semibold">순환</span>
      </div>

      {/* 마이크 권한 거부 안내 */}
      {permissionDenied && (
        <div className="w-full max-w-sm rounded-2xl border border-orange-400/30 bg-orange-400/8 px-5 py-4 space-y-3">
          <div className="flex items-start gap-3">
            <MicOff className="w-5 h-5 text-orange-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-orange-400">마이크 접근 권한이 차단되어 있습니다</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                브라우저 주소창 왼쪽의 <strong className="text-foreground/70">자물쇠(🔒) 아이콘</strong>을 클릭하고,
                마이크를 <strong className="text-foreground/70">허용</strong>으로 변경한 뒤 아래 버튼을 누르세요.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 pl-8">
            <span className="text-[11px] text-muted-foreground/60 bg-surface-2 border border-border/50 rounded-lg px-2 py-1">
              🔒 주소창 클릭
            </span>
            <ChevronRight className="w-3 h-3 text-muted-foreground/40" />
            <span className="text-[11px] text-muted-foreground/60 bg-surface-2 border border-border/50 rounded-lg px-2 py-1">
              마이크 → 허용
            </span>
            <ChevronRight className="w-3 h-3 text-muted-foreground/40" />
            <span className="text-[11px] text-muted-foreground/60 bg-surface-2 border border-border/50 rounded-lg px-2 py-1">
              아래 버튼 클릭
            </span>
          </div>
        </div>
      )}

      {/* 시작 버튼 */}
      {isSupported === false ? (
        <div className="flex flex-col items-center gap-3">
          <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <MicOff className="w-4 h-4" />
            이 브라우저는 음성 인식을 지원하지 않습니다
          </div>
          <button type="button" onClick={onManual}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl border border-border text-sm font-semibold hover:bg-surface-2 transition-all">
            텍스트로 직접 입력
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={onStart}
            disabled={isSupported === null}
            className="inline-flex items-center gap-3 px-8 py-4 rounded-2xl bg-gradient-to-r from-amber-500 to-yellow-400 text-amber-950 text-base font-bold shadow-xl shadow-amber-400/40 hover:scale-[1.03] hover:shadow-amber-400/60 disabled:opacity-40 transition-all duration-200 active:scale-95"
          >
            <Mic className="w-5 h-5" />
            {permissionDenied ? "다시 시도" : "녹음 시작"}
          </button>
          <button type="button" onClick={onManual}
            className="text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors">
            또는 텍스트로 직접 입력
          </button>
        </div>
      )}
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
      : style.bubble
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
