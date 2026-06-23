import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useCallback, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  MessageSquare,
  Trash2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  MinusCircle,
  HelpCircle,
  ThumbsDown,
  TriangleAlert,
  Download,
  Mic,
  Square,
  MicOff,
  Send,
  Radio,
  ExternalLink,
  Newspaper,
} from "lucide-react";

import {
  quickAnalyzeContent,
  type QuickCheckResult,
  type NaverFactCheckItem,
} from "@/lib/analyses.functions";
import { SiteHeader, BottomNav } from "@/components/SiteHeader";
import {
  collectSpeechText,
  getSpeechRecognitionConstructor,
  mapMediaDeviceError,
  type BrowserSpeechRecognition,
} from "@/lib/web-speech";

export const Route = createFileRoute("/live")({
  head: () => ({
    meta: [
      { title: "대화 분석 — 팩트체크" },
      { name: "description", content: "실시간 대화를 음성으로 자동 기록하고 팩트체크합니다." },
    ],
  }),
  component: LivePage,
});

/* ── 상수 ── */
type Speaker = "화자 A" | "화자 B" | "화자 C" | "화자 D";
const SPEAKERS: Speaker[] = ["화자 A", "화자 B", "화자 C", "화자 D"];

const SPEAKER_STYLE: Record<Speaker, { badge: string; ring: string; bar: string }> = {
  "화자 A": {
    badge: "bg-blue-500/20 border-blue-400/40 text-blue-400",
    ring: "ring-blue-400/40",
    bar: "#60a5fa",
  },
  "화자 B": {
    badge: "bg-emerald-500/20 border-emerald-400/40 text-emerald-400",
    ring: "ring-emerald-400/40",
    bar: "#34d399",
  },
  "화자 C": {
    badge: "bg-amber-500/20 border-amber-400/40 text-amber-400",
    ring: "ring-amber-400/40",
    bar: "#fbbf24",
  },
  "화자 D": {
    badge: "bg-rose-500/20 border-rose-400/40 text-rose-400",
    ring: "ring-rose-400/40",
    bar: "#fb7185",
  },
};

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
type RecStatus = "idle" | "starting" | "listening";

function useSpeechRecognition({
  onFinal,
  onInterim,
}: {
  onFinal: (text: string) => void;
  onInterim: (text: string) => void;
}) {
  const [recStatus, setRecStatus] = useState<RecStatus>("idle");
  const [isSupported, setIsSupported] = useState<boolean | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);

  const recRef = useRef<BrowserSpeechRecognition | null>(null);
  const listeningRef = useRef(false);
  const retryRef = useRef(0);
  const startRecRef = useRef<() => void>(() => {});

  const onFinalRef = useRef(onFinal);
  const onInterimRef = useRef(onInterim);
  useEffect(() => {
    onFinalRef.current = onFinal;
  }, [onFinal]);
  useEffect(() => {
    onInterimRef.current = onInterim;
  }, [onInterim]);

  useEffect(() => {
    const SR = getSpeechRecognitionConstructor(window);
    setIsSupported(!!SR);
    return () => {
      listeningRef.current = false;
    };
  }, []);

  const doStop = useCallback(() => {
    listeningRef.current = false;
    retryRef.current = 0;
    try {
      recRef.current?.stop();
    } catch {
      recRef.current = null;
    }
    recRef.current = null;
    setRecStatus("idle");
    onInterimRef.current("");
  }, []);

  const doStart = useCallback(async () => {
    const SR = getSpeechRecognitionConstructor(window);
    if (!SR || listeningRef.current) return;

    setMicError(null);
    setPermissionDenied(false);
    setRecStatus("starting");

    try {
      const testStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      testStream.getTracks().forEach((t) => t.stop());
    } catch (e) {
      const kind = mapMediaDeviceError(e);
      if (kind === "permission-denied") {
        setPermissionDenied(true);
      } else if (kind === "no-device") {
        setMicError("no-device");
      } else {
        setMicError("마이크를 사용할 수 없습니다. 다른 앱이 마이크를 사용 중인지 확인하세요.");
      }
      setRecStatus("idle");
      return;
    }

    listeningRef.current = true;

    const startRec = () => {
      const rec = new SR();
      rec.lang = "ko-KR";
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;

      rec.onstart = () => {
        retryRef.current = 0;
        setRecStatus("listening");
      };

      rec.onresult = (e) => {
        const { finalText, interimText } = collectSpeechText(e);
        if (finalText) {
          onInterimRef.current("");
          onFinalRef.current(finalText.trim());
        } else {
          onInterimRef.current(interimText);
        }
      };

      rec.onerror = (e) => {
        const err = e.error;
        if (err === "not-allowed") {
          (async () => {
            try {
              const perm = await navigator.permissions.query({
                name: "microphone" as PermissionName,
              });
              if (perm.state === "denied") {
                setPermissionDenied(true);
              } else {
                setMicError(
                  "마이크를 일시적으로 사용할 수 없습니다. 마이크 버튼을 다시 눌러 시도하세요.",
                );
              }
            } catch {
              setPermissionDenied(true);
            }
            doStop();
          })();
        } else if (err === "service-not-allowed") {
          // Chrome 재시작 횟수 제한 → onend backoff로 재시도
        } else if (err === "audio-capture") {
          setMicError("마이크를 찾을 수 없습니다. 마이크가 연결되어 있는지 확인하세요.");
          doStop();
        } else if (err === "network") {
          setMicError("네트워크 오류입니다. 인터넷 연결을 확인하세요.");
          doStop();
        }
      };

      rec.onend = () => {
        if (!listeningRef.current) {
          setRecStatus("idle");
          return;
        }
        retryRef.current += 1;
        if (retryRef.current > 20) {
          setMicError("음성 인식이 반복 중단됩니다. 페이지를 새로고침 후 다시 시도해 주세요.");
          doStop();
          return;
        }
        const delay = Math.min(300 * Math.pow(1.5, retryRef.current - 1), 4000);
        setTimeout(() => {
          if (!listeningRef.current) return;
          const cur = recRef.current;
          if (cur) {
            try {
              cur.start();
              setRecStatus("listening");
              return;
            } catch {
              recRef.current = null;
            }
          }
          startRecRef.current();
        }, delay);
      };

      recRef.current = rec;
      try {
        rec.start();
      } catch {
        listeningRef.current = false;
        recRef.current = null;
        setRecStatus("idle");
        setMicError("음성 인식을 시작할 수 없습니다. 페이지를 새로고침 후 다시 시도해 주세요.");
      }
    };

    startRecRef.current = startRec;
    startRec();
  }, [doStop]);

  return {
    isListening: recStatus === "listening",
    isStarting: recStatus === "starting",
    isSupported,
    permissionDenied,
    micError,
    setPermissionDenied,
    start: doStart,
    stop: doStop,
  };
}

/* ── 동적 오디오 파형 ── */
function LiveWaveform({ active, color }: { active: boolean; color: string }) {
  const BARS = 32;
  const heights = Array.from({ length: BARS }, (_, i) => {
    const center = (BARS - 1) / 2;
    const dist = Math.abs(i - center) / center;
    const base = 0.3 + (1 - dist) * 0.7;
    return Math.round(base * 34 + Math.sin(i * 1.3) * 5);
  });

  return (
    <div className="flex items-end gap-[2px] h-10 w-full">
      {heights.map((maxH, i) => (
        <div
          key={i}
          className="flex-1 rounded-full origin-bottom"
          style={{
            background: active ? color : "var(--border)",
            opacity: active ? 0.7 : 0.2,
            height: active ? `${maxH}px` : "3px",
            animation: active
              ? `liveBar ${480 + ((i * 41) % 560)}ms ease-in-out ${(i * 31) % 440}ms infinite alternate`
              : "none",
            transition: "height 0.4s ease, opacity 0.3s ease",
          }}
        />
      ))}
    </div>
  );
}

/* ── 세션 타이머 ── */
function useSessionTimer(running: boolean) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (running && startRef.current === null) {
      startRef.current = Date.now();
    }
    if (!running) {
      startRef.current = null;
      setElapsed(0);
      return;
    }
    const id = setInterval(() => {
      if (startRef.current !== null) setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [running]);

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

/* ── 세션 통계 ── */
function SessionStats({ utterances }: { utterances: Utterance[] }) {
  if (!utterances.length) return null;
  const total = utterances.length;
  const checked = utterances.filter((u) => u.result).length;
  const checking = utterances.filter((u) => u.checking).length;
  const falseC = utterances.filter((u) => u.result?.overall_verdict === "반대 근거 우세").length;
  const trueC = utterances.filter((u) => u.result?.overall_verdict === "사실").length;

  return (
    <div className="flex items-center gap-2 flex-wrap px-1">
      <span className="text-xs text-muted-foreground font-medium">총 {total}건</span>
      <div className="w-px h-3 bg-border/40" />
      {checked > 0 && (
        <span className="text-xs text-muted-foreground">
          완료 <span className="font-semibold text-foreground/70">{checked}</span>
        </span>
      )}
      {checking > 0 && (
        <span className="inline-flex items-center gap-1 text-xs text-blue-400">
          <RefreshCw className="w-2.5 h-2.5 animate-spin" /> 처리 중 {checking}
        </span>
      )}
      {trueC > 0 && (
        <span className="inline-flex items-center gap-1 text-xs text-emerald-500">
          <CheckCircle2 className="w-2.5 h-2.5" /> 사실 {trueC}
        </span>
      )}
      {falseC > 0 && (
        <span
          className="inline-flex items-center gap-1 text-xs font-bold text-red-400 bg-red-400/10 border border-red-400/25 px-2 py-0.5 rounded-full"
          style={{ animation: "falseBlink 2s ease-in-out infinite" }}
        >
          <XCircle className="w-2.5 h-2.5" /> 거짓 {falseC}건
        </span>
      )}
    </div>
  );
}

/* ── 메인 컴포넌트 ── */
function LivePage() {
  const doQuickCheck = useServerFn(quickAnalyzeContent);

  const [speakerIdx, setSpeakerIdx] = useState(0);
  const [input, setInput] = useState("");
  const [interim, setInterim] = useState("");
  const [utterances, setUtterances] = useState<Utterance[]>([]);

  const speaker = SPEAKERS[speakerIdx];
  const speakerIdxRef = useRef(speakerIdx);
  useEffect(() => {
    speakerIdxRef.current = speakerIdx;
  }, [speakerIdx]);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const addRef = useRef<(text: string) => void>(() => {});

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [utterances.length]);

  const addUtterance = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      const checking = trimmed.length >= 10;
      const currentSpeaker = SPEAKERS[speakerIdxRef.current];
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const now = new Date().toLocaleTimeString("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      setUtterances((prev) => [
        ...prev,
        {
          id,
          speaker: currentSpeaker,
          text: trimmed,
          time: now,
          checking,
          result: null,
          error: null,
        },
      ]);
      setInput("");
      setSpeakerIdx((i) => (i + 1) % SPEAKERS.length);
      textareaRef.current?.focus();

      if (!checking) return;

      try {
        const result = await doQuickCheck({ data: { text: trimmed } });
        setUtterances((prev) =>
          prev.map((u) => (u.id === id ? { ...u, checking: false, result } : u)),
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : "분석 실패";
        setUtterances((prev) =>
          prev.map((u) => (u.id === id ? { ...u, checking: false, error: msg.slice(0, 80) } : u)),
        );
      }
    },
    [doQuickCheck],
  );

  useEffect(() => {
    addRef.current = addUtterance;
  }, [addUtterance]);

  const { isListening, isSupported, permissionDenied, micError, setPermissionDenied, start, stop } =
    useSpeechRecognition({
      onFinal: useCallback((text: string) => {
        if (text.length >= 10) setTimeout(() => addRef.current(text), 0);
        else setInput((prev) => (prev + " " + text).trim());
      }, []),
      onInterim: useCallback((text: string) => setInterim(text), []),
    });

  const hasAutoStarted = useRef(false);
  useEffect(() => {
    if (isSupported === true && !hasAutoStarted.current) {
      hasAutoStarted.current = true;
      start();
    }
  }, [isSupported, start]);

  const sessionTimer = useSessionTimer(isListening);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      addUtterance(input);
    }
  };

  const handleExport = () => {
    if (!utterances.length) return;

    const now = new Date();
    const dateStr = now.toLocaleDateString("ko-KR", {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "long",
    });
    const timeStr = now.toLocaleTimeString("ko-KR");
    const checkedCount = utterances.filter((u) => u.result).length;
    const falseList = utterances.filter((u) => u.result?.overall_verdict === "반대 근거 우세");

    const SEP = "═".repeat(56);
    const LINE = "─".repeat(56);

    const out: string[] = [
      SEP,
      "  팩트체크 실시간 대화 팩트체크 기록",
      SEP,
      `  저장일시  : ${dateStr} ${timeStr}`,
      `  총 발언   : ${utterances.length}건`,
      `  팩트체크  : ${checkedCount}건 완료`,
      `  거짓 감지 : ${falseList.length}건`,
      SEP,
      "",
      "【 대화 기록 】",
      LINE,
    ];

    utterances.forEach((u) => {
      const isFalse = u.result?.overall_verdict === "반대 근거 우세";
      out.push("");
      out.push(`${isFalse ? "❌" : "  "} [${u.time}] ${u.speaker}`);
      out.push(`     발언: "${u.text}"`);

      if (u.checking) {
        out.push(`     상태: 팩트체크 처리 중`);
      } else if (u.error) {
        out.push(`     상태: 분석 실패 — ${u.error}`);
      } else if (u.result) {
        out.push(`     판정: ${u.result.overall_verdict} (신뢰도 ${u.result.overall_confidence}%)`);
        if (u.result.bias_type) out.push(`     편향: ${u.result.bias_type}`);
        if ((u.result.fake_probability ?? 0) > 0)
          out.push(`     문체 가짜 가능성: ${u.result.fake_probability}% (Stage 1 LIAR 패턴 기반)`);
        if ((u.result.style_signals ?? []).length > 0)
          out.push(`     경고 신호: ${u.result.style_signals!.join(" / ")}`);
        if (u.result.summary) out.push(`     요약: ${u.result.summary}`);
        if (isFalse) {
          u.result.highlights
            .filter((h) => h.verdict === "반대 근거 우세")
            .forEach((h) => {
              if (h.claim) out.push(`     주장: ${h.claim}`);
              if (h.subject || h.predicate || h.object)
                out.push(`     SPO: [${h.subject ?? ""}] ${h.predicate ?? ""} → ${h.object ?? ""}`);
              if (h.counter) out.push(`     반박: ${h.counter}`);
            });
        }
        if (u.result.risk_flags.length > 0) {
          out.push(`     위험: ${u.result.risk_flags.join(" / ")}`);
        }
      }
    });

    if (falseList.length > 0) {
      out.push("");
      out.push("");
      out.push("【 거짓 발언 요약 】");
      out.push(LINE);
      falseList.forEach((u, i) => {
        out.push("");
        out.push(`  ${i + 1}. [${u.time}] ${u.speaker}`);
        out.push(`     "${u.text}"`);
        if (u.result?.summary) out.push(`     → ${u.result.summary}`);
        if (u.result) out.push(`     → 신뢰도 ${u.result.overall_confidence}%`);
      });
    }

    out.push("");
    out.push(SEP);
    out.push("  Generated by 팩트체크 AI 팩트체크 시스템");
    out.push(SEP);

    const blob = new Blob([out.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const ts = now.toISOString().slice(0, 16).replace("T", "_").replace(":", "");
    Object.assign(document.createElement("a"), {
      href: url,
      download: `팩트체크_대화기록_${ts}.txt`,
    }).click();
    URL.revokeObjectURL(url);
  };

  const handleReset = () => {
    setUtterances([]);
    setSpeakerIdx(0);
    setInput("");
    setInterim("");
    stop();
    hasAutoStarted.current = false;
  };

  const falseCount = utterances.filter(
    (u) => u.result?.overall_verdict === "반대 근거 우세",
  ).length;
  const speakerColor = SPEAKER_STYLE[speaker].bar;

  return (
    <div className="min-h-screen flex flex-col">
      <style>{`
        @keyframes liveBar {
          0%   { transform: scaleY(0.12); }
          100% { transform: scaleY(1); }
        }
        @keyframes cardIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes livePing {
          0%   { transform: scale(1); opacity: 0.6; }
          100% { transform: scale(2.8); opacity: 0; }
        }
        @keyframes falseBlink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.5; }
        }
        @keyframes recDot {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.25; }
        }
      `}</style>

      <SiteHeader />
      <BottomNav />

      <main
        className="flex-1 max-w-3xl mx-auto w-full px-4 sm:px-6 pt-6 pb-[calc(9rem+env(safe-area-inset-bottom,0px))] sm:pb-[calc(6rem+env(safe-area-inset-bottom,0px))] flex flex-col gap-4"
        style={{ "--muted-foreground": "oklch(0.42 0.020 255)" } as React.CSSProperties}
      >
        {/* ── 헤더 ── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative shrink-0">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-yellow-400 grid place-items-center shadow-lg shadow-amber-400/25">
                <MessageSquare className="w-5 h-5 text-amber-950" />
              </div>
              {isListening && (
                <span className="absolute -top-1 -right-1 w-3 h-3">
                  <span
                    className="absolute inset-0 rounded-full bg-red-500"
                    style={{ animation: "livePing 1.4s ease-out infinite" }}
                  />
                  <span className="relative block w-3 h-3 rounded-full bg-red-500" />
                </span>
              )}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-base font-bold leading-tight text-foreground">
                  실시간 대화 팩트체크
                </h1>
                {isListening && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-400 bg-red-400/10 border border-red-400/30 px-1.5 py-0.5 rounded-full tracking-wider">
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-red-400"
                      style={{ animation: "recDot 1s ease-in-out infinite" }}
                    />
                    LIVE · {sessionTimer}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                발언마다 자동 화자 전환 · 거짓 발언 즉시 감지
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {utterances.length > 0 && (
              <button
                type="button"
                onClick={handleReset}
                title="전체 초기화"
                className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* ── 녹음 상태 바 ── */}
        <div
          className={`glass rounded-2xl px-5 py-4 flex flex-col gap-3 ring-1 transition-all duration-300 ${
            isListening ? SPEAKER_STYLE[speaker].ring : "ring-border/30"
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span
                className={`text-xs font-bold px-3 py-1 rounded-full border ${SPEAKER_STYLE[speaker].badge}`}
              >
                {speaker}
              </span>
              {isListening ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-red-400 font-medium">
                  <Radio className="w-3 h-3 animate-pulse" /> 녹음 중
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {permissionDenied || micError ? "마이크 오류" : "대기 중…"}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {isListening ? (
                <button
                  type="button"
                  onClick={stop}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-border/30 text-muted-foreground text-xs hover:bg-surface-2 transition-all active:scale-95"
                >
                  <Square className="w-3 h-3" /> 중지
                </button>
              ) : permissionDenied || micError ? (
                <button
                  type="button"
                  onClick={() => {
                    setPermissionDenied(false);
                    start();
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/20 border border-amber-400/40 text-amber-400 text-xs font-semibold hover:bg-amber-500/30 transition-all active:scale-95"
                >
                  <Mic className="w-3 h-3" /> 다시 시도
                </button>
              ) : null}
            </div>
          </div>

          {isListening && (
            <>
              <LiveWaveform active color={speakerColor} />
              {interim ? (
                <p className="text-sm text-foreground/90 italic px-1 leading-relaxed">
                  {interim}
                  <span className="inline-block w-0.5 h-4 bg-primary ml-0.5 animate-pulse align-middle" />
                </p>
              ) : (
                <p className="text-xs text-muted-foreground px-1">
                  말씀하세요 — 발언 완료 시 자동 기록됩니다
                </p>
              )}
            </>
          )}

          {(permissionDenied || micError === "no-device") && (
            <MicErrorBanner permissionDenied={permissionDenied} micError={micError} />
          )}
        </div>

        {/* ── 세션 통계 ── */}
        {utterances.length > 0 && <SessionStats utterances={utterances} />}

        {/* ── 발언 목록 ── */}
        {utterances.length > 0 ? (
          <div className="space-y-1.5">
            {utterances.map((u, idx) => (
              <UtteranceCard key={u.id} u={u} isNew={idx === utterances.length - 1} />
            ))}
            <div ref={bottomRef} />

            {/* 대화 기록 저장 */}
            <div className="pt-3 pb-1">
              <div className="rounded-2xl border border-border/40 bg-surface-2/30 px-5 py-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground/90">대화 기록 저장</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    발언 {utterances.length}건{falseCount > 0 ? ` · 거짓 ${falseCount}건 포함` : ""}{" "}
                    — 텍스트 파일로 저장합니다
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleExport}
                  className="shrink-0 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 text-white text-sm font-bold shadow-md shadow-blue-500/30 hover:opacity-90 transition-all active:scale-95"
                >
                  <Download className="w-4 h-4" />
                  저장
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* ── 빈 상태 ── */
          <div className="flex flex-col items-center gap-5 py-14 text-center glass rounded-2xl border border-border/30">
            <div className="relative">
              <div
                className={`w-16 h-16 rounded-full grid place-items-center transition-all duration-500 ${
                  isListening ? "bg-red-400/12 ring-2 ring-red-400/30" : "bg-muted/10"
                }`}
              >
                <Mic
                  className={`w-7 h-7 transition-colors ${
                    isListening ? "text-red-400 animate-pulse" : "text-muted-foreground/30"
                  }`}
                />
              </div>
              {isListening && (
                <span
                  className="absolute -inset-3 rounded-full border border-red-400/15"
                  style={{ animation: "livePing 2s ease-out 0.3s infinite" }}
                />
              )}
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-semibold text-foreground/90">
                {isListening ? "말씀해 보세요" : "대화를 시작해보세요"}
              </p>
              <p className="text-xs text-muted-foreground max-w-xs leading-relaxed mx-auto">
                {isListening
                  ? "발언이 완료되면 자동으로 기록되고 실시간 팩트체크가 시작됩니다"
                  : "마이크로 말하거나 아래 입력창에 직접 발언을 입력하세요"}
              </p>
            </div>
            {!isListening && (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground/70">
                {["마이크 준비", "발언 시작", "실시간 판정"].map((step, i) => (
                  <div key={step} className="flex items-center gap-2">
                    {i > 0 && <span className="opacity-30">›</span>}
                    <span className="bg-border/25 rounded-full px-2.5 py-1">{step}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── 직접 입력 폼 ── */}
        <div className="glass rounded-2xl p-4 ring-1 ring-border/25">
          <div className="flex items-start gap-2.5">
            <button
              type="button"
              onClick={() => setSpeakerIdx((i) => (i + 1) % SPEAKERS.length)}
              title="클릭하여 화자 전환"
              className={`shrink-0 mt-0.5 text-xs font-bold px-2.5 py-1 rounded-full border transition-all hover:scale-105 active:scale-95 ${SPEAKER_STYLE[speaker].badge}`}
            >
              {speaker}
            </button>
            <textarea
              ref={textareaRef}
              rows={2}
              lang="ko"
              placeholder="발언 직접 입력 (Enter로 추가)"
              value={interim || input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1 bg-transparent outline-none resize-none text-sm leading-relaxed placeholder:text-muted-foreground/35 text-foreground/90"
            />
            <button
              type="button"
              onClick={() => addUtterance(input)}
              disabled={!input.trim()}
              className="shrink-0 p-2 rounded-xl bg-amber-500/20 border border-amber-400/40 text-amber-400 hover:bg-amber-500/30 disabled:opacity-30 disabled:cursor-not-allowed transition-all active:scale-95"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>

        {isSupported === false && (
          <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1.5">
            <MicOff className="w-3.5 h-3.5" /> Chrome 브라우저에서만 음성 인식이 지원됩니다
          </p>
        )}
      </main>
    </div>
  );
}

/* ── 마이크 오류 배너 ── */
function MicErrorBanner({
  permissionDenied,
  micError,
}: {
  permissionDenied: boolean;
  micError: string | null;
}) {
  if (micError === "no-device") {
    return (
      <div className="rounded-xl border border-red-400/20 bg-red-400/5 px-3 py-2.5 space-y-1.5">
        <p className="text-xs font-semibold text-red-400">마이크 장치를 찾을 수 없음</p>
        <ol className="space-y-0.5 list-decimal list-inside">
          {[
            "USB 헤드셋이 PC에 꽂혀 있는지 확인 (허브 말고 본체 직결)",
            "Win+R → mmsys.cpl → 녹음 탭 → USB 헤드셋 우클릭 → 기본 장치로 설정",
            "헤드셋 연결 후 Chrome 재시작",
          ].map((s, i) => (
            <li key={i} className="text-[11px] text-muted-foreground leading-relaxed">
              {s}
            </li>
          ))}
        </ol>
      </div>
    );
  }
  if (permissionDenied) {
    return (
      <div className="rounded-xl border border-orange-400/20 bg-orange-400/5 px-3 py-2.5 space-y-1.5">
        <p className="text-xs font-semibold text-orange-400">마이크 접근이 차단됨</p>
        <ol className="space-y-0.5 list-decimal list-inside">
          {[
            "Win+I → 개인정보 보호 및 보안 → 마이크 → 데스크톱 앱 허용 켜기",
            "chrome://settings/content/microphone 에서 이 사이트 허용 확인",
            "Chrome 재시작",
          ].map((s, i) => (
            <li key={i} className="text-[11px] text-muted-foreground leading-relaxed">
              {s}
            </li>
          ))}
        </ol>
      </div>
    );
  }
  return null;
}

/* ── 발언 카드 ── */
function UtteranceCard({ u, isNew }: { u: Utterance; isNew: boolean }) {
  const style = SPEAKER_STYLE[u.speaker];
  const isFalse = u.result?.overall_verdict === "반대 근거 우세";
  const fakePct = u.result?.fake_probability ?? 0;
  const highFake = fakePct >= 50 && !isFalse;

  const cardAnim = isNew ? { animation: "cardIn 0.3s ease-out both" } : {};

  /* 거짓 발언 — 강조 카드 */
  if (isFalse && u.result) {
    const falseHighlights = u.result.highlights.filter((h) => h.verdict === "반대 근거 우세");
    const hasSignals = (u.result.style_signals ?? []).length > 0;
    return (
      <div
        className="rounded-2xl border-2 border-red-400/50 bg-red-400/5 p-4 space-y-3"
        style={cardAnim}
      >
        <div className="flex items-start gap-2.5">
          <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${style.badge}`}>
                {u.speaker}
              </span>
              <span className="text-[10px] text-muted-foreground/80">{u.time}</span>
              {u.result.bias_type && u.result.bias_type !== "중립" && (
                <span className="text-[10px] font-medium text-orange-400 bg-orange-400/10 border border-orange-400/20 px-1.5 py-0.5 rounded-full">
                  {u.result.bias_type} 편향
                </span>
              )}
              <span className="ml-auto inline-flex items-center gap-1 text-xs font-bold text-red-400">
                <XCircle className="w-3 h-3" /> 반대 근거 우세 {u.result.overall_confidence}%
              </span>
            </div>
            <p className="text-sm text-foreground/92 leading-relaxed font-medium">{u.text}</p>
          </div>
        </div>

        {(fakePct > 0 || hasSignals) && (
          <div className="rounded-xl border border-red-400/15 bg-red-400/5 px-3 py-2 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
                Stage 1 문체 분석
              </span>
              <div className="flex-1 h-1 rounded-full bg-border/30 overflow-hidden">
                <div
                  className="h-full bg-red-400/70 rounded-full transition-all"
                  style={{ width: `${fakePct}%` }}
                />
              </div>
              <span className="text-[11px] font-bold text-red-400">{fakePct}%</span>
            </div>
            {hasSignals && (
              <div className="space-y-0.5">
                {(u.result.style_signals ?? []).slice(0, 3).map((s, i) => (
                  <p key={i} className="text-[10px] text-orange-400/80 leading-relaxed">
                    • {s}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        {u.result.summary && (
          <p className="text-xs text-foreground/90 leading-relaxed pl-6 border-l-2 border-red-400/30">
            {u.result.summary}
          </p>
        )}

        {falseHighlights.length > 0 && (
          <div className="space-y-2 pl-2">
            {falseHighlights.map((h, i) => (
              <div key={i} className="rounded-xl border border-red-400/20 bg-red-400/5 px-3 py-2.5">
                <p className="text-xs font-medium text-foreground/88 mb-1">{h.claim}</p>
                {(h.subject || h.predicate || h.object) && (
                  <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                    {h.subject && (
                      <span className="text-[10px] bg-border/20 border border-border/40 rounded px-1.5 py-0.5 text-muted-foreground">
                        주어: {h.subject}
                      </span>
                    )}
                    {h.predicate && (
                      <span className="text-[10px] bg-border/20 border border-border/40 rounded px-1.5 py-0.5 text-muted-foreground">
                        서술: {h.predicate}
                      </span>
                    )}
                    {h.object && (
                      <span className="text-[10px] bg-border/20 border border-border/40 rounded px-1.5 py-0.5 text-muted-foreground">
                        대상: {h.object}
                      </span>
                    )}
                  </div>
                )}
                {h.brief && (
                  <p className="text-[11px] text-foreground/85 leading-relaxed mb-1">{h.brief}</p>
                )}
                {h.counter && (
                  <div className="flex items-start gap-1.5 mt-1">
                    <ThumbsDown className="w-3 h-3 text-red-400 shrink-0 mt-0.5" />
                    <span className="text-[11px] text-red-400 leading-relaxed">{h.counter}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {u.result.risk_flags.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap pl-2">
            <TriangleAlert className="w-3 h-3 text-orange-400 shrink-0" />
            {u.result.risk_flags.map((f, i) => (
              <span
                key={i}
                className="text-[10px] text-orange-400 bg-orange-400/10 border border-orange-400/20 px-1.5 py-0.5 rounded-full"
              >
                {f}
              </span>
            ))}
          </div>
        )}
        {u.result.naver_factchecks && <NaverRefs items={u.result.naver_factchecks} />}
      </div>
    );
  }

  /* 사실 판정 — 연초록 강조 */
  if (u.result?.overall_verdict === "사실") {
    return (
      <div
        className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl border border-emerald-400/20 bg-emerald-400/5 group transition-colors"
        style={cardAnim}
      >
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-1" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${style.badge}`}
            >
              {u.speaker}
            </span>
            <span className="text-[10px] text-emerald-500 font-medium">
              사실 {u.result.overall_confidence}%
            </span>
          </div>
          <p className="text-sm text-foreground/88 leading-relaxed">{u.text}</p>
          {u.result.summary && (
            <p className="text-[11px] text-muted-foreground/70 mt-1 leading-relaxed">
              {u.result.summary}
            </p>
          )}
          {u.result.naver_factchecks && <NaverRefs items={u.result.naver_factchecks} />}
        </div>
        <span className="text-[10px] text-muted-foreground/60 shrink-0 mt-1 group-hover:text-muted-foreground/80 transition-colors">
          {u.time}
        </span>
      </div>
    );
  }

  /* 일반 발언 / 기타 판정 */
  return (
    <div
      className={`flex items-start gap-2.5 px-2.5 py-2 rounded-xl transition-colors group ${
        highFake
          ? "bg-orange-400/5 border border-orange-400/15 hover:bg-orange-400/8"
          : u.result
            ? "bg-surface-2/20 hover:bg-surface-2/40"
            : "hover:bg-surface-2/25"
      }`}
      style={cardAnim}
    >
      <span
        className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border ${style.badge} mt-0.5`}
      >
        {u.speaker}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground/88 leading-relaxed">{u.text}</p>
        {u.checking && (
          <p className="text-[11px] text-muted-foreground/80 mt-0.5 flex items-center gap-1">
            <RefreshCw className="w-2.5 h-2.5 animate-spin" /> 팩트체크 중…
          </p>
        )}
        {!u.checking && u.result && (
          <p className="text-[11px] text-muted-foreground/65 mt-0.5 flex items-center gap-1">
            {u.result.overall_verdict === "부분 사실" && (
              <MinusCircle className="w-2.5 h-2.5 text-yellow-400" />
            )}
            {u.result.overall_verdict === "근거 부족" && (
              <HelpCircle className="w-2.5 h-2.5 text-orange-400" />
            )}
            {u.result.overall_verdict} {u.result.overall_confidence}%
          </p>
        )}
        {!u.checking && highFake && (
          <p className="text-[10px] text-orange-400/80 mt-0.5 flex items-center gap-1">
            <TriangleAlert className="w-2.5 h-2.5" /> 문체 가짜 가능성 {fakePct}%
          </p>
        )}
        {u.error && <p className="text-[11px] text-destructive/70 mt-0.5">{u.error}</p>}
        {u.result?.naver_factchecks && <NaverRefs items={u.result.naver_factchecks} />}
      </div>
      <span className="text-[10px] text-muted-foreground/32 shrink-0 mt-1 group-hover:text-muted-foreground/50 transition-colors">
        {u.time}
      </span>
    </div>
  );
}

/* ── Naver 팩트체크 참고 기사 ── */
function NaverRefs({ items }: { items: NaverFactCheckItem[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-2 pt-2 border-t border-border/20">
      <p className="text-[10px] text-blue-400/70 font-medium flex items-center gap-1 mb-1">
        <Newspaper className="w-2.5 h-2.5" /> 네이버 팩트체크 관련 기사
      </p>
      <div className="space-y-1">
        {items.map((item, i) => (
          <a
            key={i}
            href={item.link}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-start gap-1.5 group/link text-[11px] leading-relaxed hover:bg-blue-400/5 rounded px-1 py-0.5 -mx-1 transition-colors"
          >
            <ExternalLink className="w-2.5 h-2.5 text-blue-400/50 shrink-0 mt-0.5 group-hover/link:text-blue-400 transition-colors" />
            <span className="text-foreground/65 group-hover/link:text-blue-400 transition-colors line-clamp-2">
              {item.publisher && (
                <span className="text-muted-foreground/50 mr-1">[{item.publisher}]</span>
              )}
              {item.title}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
