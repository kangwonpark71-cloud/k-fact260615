import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useCallback, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  MessageSquare, Trash2, RefreshCw,
  CheckCircle2, XCircle, MinusCircle, HelpCircle, AlertCircle,
  ThumbsUp, ThumbsDown, TriangleAlert, Download,
  Mic, Square, MicOff, ChevronRight, Send, Radio,
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

const SPEAKER_STYLE: Record<Speaker, { badge: string; bubble: string; ring: string }> = {
  "화자 A": { badge: "bg-blue-500/20 border-blue-400/40 text-blue-400",          bubble: "border-blue-400/20 bg-blue-500/5",     ring: "ring-blue-400/40" },
  "화자 B": { badge: "bg-emerald-500/20 border-emerald-400/40 text-emerald-400", bubble: "border-emerald-400/20 bg-emerald-500/5", ring: "ring-emerald-400/40" },
  "화자 C": { badge: "bg-amber-500/20 border-amber-400/40 text-amber-400",       bubble: "border-amber-400/20 bg-amber-500/5",   ring: "ring-amber-400/40" },
  "화자 D": { badge: "bg-rose-500/20 border-rose-400/40 text-rose-400",         bubble: "border-rose-400/20 bg-rose-500/5",     ring: "ring-rose-400/40" },
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

/* ── 음성 인식 훅 ──
   getUserMedia 없이 SpeechRecognition 단독 사용.
   service-not-allowed(Chrome 재시작 제한)는 권한 차단이 아닌 backoff 재시도로 처리. */
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

  const recRef      = useRef<any>(null);
  const listeningRef = useRef(false);
  const retryRef    = useRef(0);
  const startRecRef = useRef<() => void>(() => {}); // onend 재시작용

  const onFinalRef   = useRef(onFinal);
  const onInterimRef = useRef(onInterim);
  useEffect(() => { onFinalRef.current = onFinal; }, [onFinal]);
  useEffect(() => { onInterimRef.current = onInterim; }, [onInterim]);

  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setIsSupported(!!SR);
    return () => { listeningRef.current = false; };
  }, []);

  const doStop = useCallback(() => {
    listeningRef.current = false;
    retryRef.current = 0;
    try { recRef.current?.stop(); } catch {}
    recRef.current = null;
    setRecStatus("idle");
    onInterimRef.current("");
  }, []);

  const doStart = useCallback(async () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR || listeningRef.current) return;

    setMicError(null);
    setPermissionDenied(false);
    setRecStatus("starting");

    // getUserMedia로 권한 선확인 후 즉시 해제 (스트림 점유 없이 권한만 확인)
    try {
      const testStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      testStream.getTracks().forEach(t => t.stop());
    } catch (e: any) {
      const name = (e?.name ?? "") as string;
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setPermissionDenied(true);
      } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
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

      rec.onresult = (e: any) => {
        let interim = "";
        let final = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) final += t;
          else interim += t;
        }
        if (final) {
          onInterimRef.current("");
          onFinalRef.current(final.trim());
        } else {
          onInterimRef.current(interim);
        }
      };

      rec.onerror = (e: any) => {
        const err = e.error as string;
        if (err === "not-allowed") {
          // Permissions API로 실제 denied 여부 이중 확인
          // → denied: 진짜 권한 차단 UI 표시
          // → granted/prompt: Chrome 일시 오류 → "다시 눌러 시도" 안내
          (async () => {
            try {
              const perm = await navigator.permissions.query({ name: "microphone" as PermissionName });
              if (perm.state === "denied") {
                setPermissionDenied(true);
              } else {
                setMicError("마이크를 일시적으로 사용할 수 없습니다. 마이크 버튼을 다시 눌러 시도하세요.");
              }
            } catch {
              // Permissions API 미지원(Firefox 등) → 일단 차단 UI
              setPermissionDenied(true);
            }
            doStop();
          })();
        } else if (err === "service-not-allowed") {
          // Chrome 재시작 횟수 제한 → onend backoff로 재시도 (권한 차단 아님)
        } else if (err === "audio-capture") {
          setMicError("마이크를 찾을 수 없습니다. 마이크가 연결되어 있는지 확인하세요.");
          doStop();
        } else if (err === "network") {
          setMicError("네트워크 오류입니다. 인터넷 연결을 확인하세요.");
          doStop();
        }
        // no-speech / aborted → onend에서 자동 재시작
      };

      rec.onend = () => {
        if (!listeningRef.current) { setRecStatus("idle"); return; }
        retryRef.current += 1;
        if (retryRef.current > 20) {
          setMicError("음성 인식이 반복 중단됩니다. 페이지를 새로고침 후 다시 시도해 주세요.");
          doStop();
          return;
        }
        // service-not-allowed 등 Chrome 재시작 제한 → backoff 후 새 인스턴스 재시작
        const delay = Math.min(300 * Math.pow(1.5, retryRef.current - 1), 4000);
        setTimeout(() => {
          if (!listeningRef.current) return;
          // 기존 인스턴스 재사용 우선
          const cur = recRef.current;
          if (cur) {
            try { cur.start(); setRecStatus("listening"); return; } catch {}
          }
          // 실패 시 새 인스턴스로 재시작
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

/* ── CSS 파형 (getUserMedia 없이 순수 CSS 애니메이션) ── */
function CssWaveform({ active }: { active: boolean }) {
  const BARS = 28;
  return (
    <div className="flex items-end gap-[3px] h-12 w-full px-2">
      {Array.from({ length: BARS }, (_, i) => (
        <div
          key={i}
          className={`flex-1 rounded-full bg-primary/50 origin-bottom transition-all ${active ? "animate-pulse" : ""}`}
          style={{
            height: active ? `${12 + Math.sin(i * 0.7) * 8}px` : "3px",
            animationDelay: `${(i * 60) % 800}ms`,
            animationDuration: `${600 + (i * 80) % 600}ms`,
          }}
        />
      ))}
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

    const checking = trimmed.length >= 10;

    const currentSpeaker = SPEAKERS[speakerIdxRef.current];
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

    setUtterances(prev => [...prev, { id, speaker: currentSpeaker, text: trimmed, time: now, checking, result: null, error: null }]);
    setInput("");
    setSpeakerIdx(i => (i + 1) % SPEAKERS.length);
    textareaRef.current?.focus();

    if (!checking) return;

    try {
      const result = await doQuickCheck({ data: { text: trimmed } });
      setUtterances(prev => prev.map(u => u.id === id ? { ...u, checking: false, result } : u));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "분석 실패";
      setUtterances(prev => prev.map(u => u.id === id ? { ...u, checking: false, error: msg.slice(0, 80) } : u));
    }
  }, [doQuickCheck]);

  useEffect(() => { addRef.current = addUtterance; }, [addUtterance]);

  const { isListening, isSupported, permissionDenied, micError, setPermissionDenied, start, stop } =
    useSpeechRecognition({
      onFinal: useCallback((text: string) => {
        if (text.length >= 10) setTimeout(() => addRef.current(text), 0);
        else setInput(prev => (prev + " " + text).trim());
      }, []),
      onInterim: useCallback((text: string) => setInterim(text), []),
    });

  // 페이지 진입 시 자동 녹음 시작
  const hasAutoStarted = useRef(false);
  useEffect(() => {
    if (isSupported === true && !hasAutoStarted.current) {
      hasAutoStarted.current = true;
      start();
    }
  }, [isSupported, start]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addUtterance(input); }
  };

  const handleExport = () => {
    if (!utterances.length) return;

    const now = new Date();
    const dateStr = now.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
    const timeStr = now.toLocaleTimeString("ko-KR");
    const checkedCount = utterances.filter(u => u.result).length;
    const falseList = utterances.filter(u => u.result?.overall_verdict === "반대 근거 우세");

    const SEP  = "═".repeat(56);
    const LINE = "─".repeat(56);

    const out: string[] = [
      SEP,
      "  K-Fact 실시간 대화 팩트체크 기록",
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

    utterances.forEach(u => {
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
            .filter(h => h.verdict === "반대 근거 우세")
            .forEach(h => {
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
    out.push("  Generated by K-Fact AI 팩트체크 시스템");
    out.push(SEP);

    const blob = new Blob([out.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const ts = now.toISOString().slice(0, 16).replace("T", "_").replace(":", "");
    Object.assign(document.createElement("a"), { href: url, download: `K-Fact_대화기록_${ts}.txt` }).click();
    URL.revokeObjectURL(url);
  };

  const handleReset = () => {
    setUtterances([]); setSpeakerIdx(0); setInput(""); setInterim("");
    stop();
    hasAutoStarted.current = false;
  };

  const falseCount = utterances.filter(u => u.result?.overall_verdict === "반대 근거 우세").length;

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <BottomNav />

      <main className="flex-1 max-w-3xl mx-auto w-full px-4 sm:px-6 pt-6 pb-36 sm:pb-24 flex flex-col gap-4">

        {/* 헤더 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-yellow-400 grid place-items-center shadow-lg shadow-amber-400/30">
              <MessageSquare className="w-5 h-5 text-amber-950" />
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight">실시간 대화 팩트체크</h1>
              <p className="text-xs text-muted-foreground">발언마다 자동 화자 전환 · 거짓 발언 즉시 감지</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {utterances.length > 0 && (
              <button type="button" onClick={handleReset} title="전체 초기화"
                className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* ── 녹음 상태 바 (항상 표시) ── */}
        <div className={`glass rounded-2xl px-5 py-4 flex flex-col gap-3 ring-1 transition-all ${
          isListening ? `${SPEAKER_STYLE[speaker].ring}` : "ring-border/30"
        }`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className={`text-sm font-bold px-3 py-1 rounded-full border ${SPEAKER_STYLE[speaker].badge}`}>
                {speaker}
              </span>
              {isListening ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-red-400">
                  <Radio className="w-3 h-3 animate-pulse" /> 녹음 중
                </span>
              ) : (
                <span className="text-xs text-muted-foreground/50">
                  {(permissionDenied || micError) ? "마이크 오류" : "준비 중…"}
                </span>
              )}
              {falseCount > 0 && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-400 bg-red-400/10 border border-red-400/30 px-2 py-0.5 rounded-full">
                  <XCircle className="w-3 h-3" /> 거짓 {falseCount}건
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {isListening ? (
                <button type="button" onClick={stop}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-border/30 text-muted-foreground text-xs hover:bg-surface-2 transition-all active:scale-95">
                  <Square className="w-3 h-3" /> 중지
                </button>
              ) : (permissionDenied || micError) ? (
                <button type="button" onClick={() => { setPermissionDenied(false); start(); }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/20 border border-amber-400/40 text-amber-400 text-xs font-semibold hover:bg-amber-500/30 transition-all active:scale-95">
                  <Mic className="w-3 h-3" /> 다시 시도
                </button>
              ) : null}
            </div>
          </div>

          {/* 파형 / 중간 텍스트 */}
          {isListening && (
            <>
              <CssWaveform active />
              {interim ? (
                <p className="text-sm text-primary/60 italic px-1 leading-relaxed">
                  {interim}<span className="inline-block w-0.5 h-4 bg-primary ml-0.5 animate-pulse align-middle" />
                </p>
              ) : (
                <p className="text-xs text-muted-foreground/40 px-1">말씀하세요 — 발언 완료 시 자동 기록됩니다</p>
              )}
            </>
          )}

          {/* 오류 안내 */}
          {(permissionDenied || micError === "no-device") && (
            <MicErrorBanner permissionDenied={permissionDenied} micError={micError} />
          )}
        </div>

        {/* ── 발언 목록 ── */}
        {utterances.length > 0 ? (
          <div className="space-y-1.5">
            {utterances.map(u => (
              <UtteranceCard key={u.id} u={u} />
            ))}
            <div ref={bottomRef} />

            {/* 대화 기록 저장 */}
            <div className="pt-3 pb-1">
              <div className="rounded-2xl border border-border/40 bg-surface-2/30 px-5 py-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">대화 기록 저장</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    발언 {utterances.length}건 · 거짓 {falseCount}건 포함 텍스트 파일로 저장합니다
                  </p>
                </div>
                <button type="button" onClick={handleExport}
                  className="shrink-0 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 text-white text-sm font-bold shadow-md shadow-blue-500/30 hover:opacity-90 transition-all active:scale-95">
                  <Download className="w-4 h-4" />
                  저장
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <Mic className="w-8 h-8 text-muted-foreground/20" />
            <p className="text-sm text-muted-foreground/40">녹음이 시작되면 발언이 여기에 기록됩니다</p>
          </div>
        )}

        {/* ── 직접 입력 폼 (항상 표시) ── */}
        <div className="glass rounded-2xl p-4">
          <div className="flex items-start gap-2">
            <button type="button"
              onClick={() => setSpeakerIdx(i => (i + 1) % SPEAKERS.length)}
              title="클릭하여 화자 전환"
              className={`shrink-0 mt-0.5 text-xs font-bold px-2.5 py-1 rounded-full border transition-all hover:scale-105 active:scale-95 ${SPEAKER_STYLE[speaker].badge}`}>
              {speaker}
            </button>
            <textarea ref={textareaRef} rows={2} lang="ko"
              placeholder="발언 직접 입력 (Enter로 추가)"
              value={interim || input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1 bg-transparent outline-none resize-none text-sm leading-relaxed placeholder:text-muted-foreground/40" />
            <button type="button" onClick={() => addUtterance(input)}
              disabled={!input.trim()}
              className="shrink-0 p-2 rounded-xl bg-amber-500/20 border border-amber-400/40 text-amber-400 hover:bg-amber-500/30 disabled:opacity-30 disabled:cursor-not-allowed transition-all">
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 마이크 미지원 */}
        {isSupported === false && (
          <p className="text-xs text-muted-foreground/50 text-center flex items-center justify-center gap-1.5">
            <MicOff className="w-3.5 h-3.5" /> Chrome 브라우저에서만 음성 인식이 지원됩니다
          </p>
        )}
      </main>
    </div>
  );
}

/* ── 마이크 오류 배너 (녹음 상태 바 내부) ── */
function MicErrorBanner({ permissionDenied, micError }: { permissionDenied: boolean; micError: string | null }) {
  if (micError === "no-device") {
    return (
      <div className="rounded-xl border border-red-400/20 bg-red-400/5 px-3 py-2.5 space-y-1.5">
        <p className="text-xs font-semibold text-red-400">마이크 장치를 찾을 수 없음</p>
        <ol className="space-y-0.5 list-decimal list-inside">
          {["USB 헤드셋이 PC에 꽂혀 있는지 확인 (허브 말고 본체 직결)", "Win+R → mmsys.cpl → 녹음 탭 → USB 헤드셋 우클릭 → 기본 장치로 설정", "헤드셋 연결 후 Chrome 재시작"].map((s, i) => (
            <li key={i} className="text-[11px] text-muted-foreground leading-relaxed">{s}</li>
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
          {["Win+I → 개인정보 보호 및 보안 → 마이크 → 데스크톱 앱 허용 켜기", "chrome://settings/content/microphone 에서 이 사이트 허용 확인", "Chrome 재시작"].map((s, i) => (
            <li key={i} className="text-[11px] text-muted-foreground leading-relaxed">{s}</li>
          ))}
        </ol>
      </div>
    );
  }
  return null;
}

/* ── 발언 카드 ── */
function UtteranceCard({ u }: { u: Utterance }) {
  const style = SPEAKER_STYLE[u.speaker];
  const isFalse = u.result?.overall_verdict === "반대 근거 우세";
  const fakePct = u.result?.fake_probability ?? 0;
  const highFake = fakePct >= 50 && !isFalse; // 거짓 아니어도 가짜 가능성 높으면 경고

  /* 거짓 발언 — 강조 카드 */
  if (isFalse && u.result) {
    const falseHighlights = u.result.highlights.filter(h => h.verdict === "반대 근거 우세");
    const hasSignals = (u.result.style_signals ?? []).length > 0;
    return (
      <div className="rounded-2xl border-2 border-red-400/50 bg-red-400/5 p-4 space-y-3">
        {/* 헤더 */}
        <div className="flex items-start gap-2.5">
          <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${style.badge}`}>{u.speaker}</span>
              <span className="text-[10px] text-muted-foreground/50">{u.time}</span>
              {u.result.bias_type && u.result.bias_type !== "중립" && (
                <span className="text-[10px] font-medium text-orange-400 bg-orange-400/10 border border-orange-400/20 px-1.5 py-0.5 rounded-full">
                  {u.result.bias_type} 편향
                </span>
              )}
              <span className="ml-auto inline-flex items-center gap-1 text-xs font-bold text-red-400">
                <XCircle className="w-3 h-3" /> 반대 근거 우세 {u.result.overall_confidence}%
              </span>
            </div>
            <p className="text-sm text-foreground/90 leading-relaxed">{u.text}</p>
          </div>
        </div>

        {/* Stage 1 가짜 가능성 + 신호 */}
        {(fakePct > 0 || hasSignals) && (
          <div className="rounded-xl border border-red-400/15 bg-red-400/5 px-3 py-2 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground/60 font-medium uppercase tracking-wide">Stage 1 문체 분석</span>
              <div className="flex-1 h-1 rounded-full bg-border/30 overflow-hidden">
                <div className="h-full bg-red-400/70 rounded-full transition-all" style={{ width: `${fakePct}%` }} />
              </div>
              <span className="text-[11px] font-bold text-red-400">{fakePct}%</span>
            </div>
            {hasSignals && (
              <div className="space-y-0.5">
                {(u.result.style_signals ?? []).slice(0, 3).map((s, i) => (
                  <p key={i} className="text-[10px] text-orange-400/80 leading-relaxed">• {s}</p>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 요약 */}
        {u.result.summary && (
          <p className="text-xs text-muted-foreground leading-relaxed pl-6 border-l-2 border-red-400/30">{u.result.summary}</p>
        )}

        {/* Stage 2 SPO + 반박 근거 */}
        {falseHighlights.length > 0 && (
          <div className="space-y-2 pl-2">
            {falseHighlights.map((h, i) => (
              <div key={i} className="rounded-xl border border-red-400/20 bg-red-400/5 px-3 py-2.5">
                <p className="text-xs font-medium text-foreground/80 mb-1">{h.claim}</p>
                {/* SPO 구조 */}
                {(h.subject || h.predicate || h.object) && (
                  <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                    {h.subject   && <span className="text-[10px] bg-border/20 border border-border/40 rounded px-1.5 py-0.5 text-muted-foreground/70">주어: {h.subject}</span>}
                    {h.predicate && <span className="text-[10px] bg-border/20 border border-border/40 rounded px-1.5 py-0.5 text-muted-foreground/70">서술: {h.predicate}</span>}
                    {h.object    && <span className="text-[10px] bg-border/20 border border-border/40 rounded px-1.5 py-0.5 text-muted-foreground/70">대상: {h.object}</span>}
                  </div>
                )}
                {h.brief && <p className="text-[11px] text-muted-foreground leading-relaxed mb-1">{h.brief}</p>}
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

        {/* 위험 플래그 */}
        {u.result.risk_flags.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap pl-2">
            <TriangleAlert className="w-3 h-3 text-orange-400 shrink-0" />
            {u.result.risk_flags.map((f, i) => (
              <span key={i} className="text-[10px] text-orange-400 bg-orange-400/10 border border-orange-400/20 px-1.5 py-0.5 rounded-full">{f}</span>
            ))}
          </div>
        )}
      </div>
    );
  }

  /* 일반 발언 — 미니멀 행 (가짜 가능성 높으면 주황 경고) */
  return (
    <div className={`flex items-start gap-2.5 px-2 py-2 rounded-xl transition-colors group ${
      highFake ? "bg-orange-400/5 hover:bg-orange-400/8 border border-orange-400/15" : "hover:bg-surface-2/30"
    }`}>
      <span className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded-full border ${style.badge} mt-0.5`}>{u.speaker}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground/85 leading-relaxed">{u.text}</p>
        {u.checking && (
          <p className="text-[11px] text-muted-foreground/40 mt-0.5 flex items-center gap-1">
            <RefreshCw className="w-2.5 h-2.5 animate-spin" /> 팩트체크 중…
          </p>
        )}
        {!u.checking && highFake && (
          <p className="text-[10px] text-orange-400/70 mt-0.5 flex items-center gap-1">
            <TriangleAlert className="w-2.5 h-2.5" /> 문체 가짜 가능성 {fakePct}%
          </p>
        )}
        {u.error && <p className="text-[11px] text-destructive/70 mt-0.5">{u.error}</p>}
      </div>
      <span className="text-[10px] text-muted-foreground/25 shrink-0 mt-1 group-hover:text-muted-foreground/40 transition-colors">{u.time}</span>
    </div>
  );
}

/* ── 마이크 진단 ── */
type DiagStep = { label: string; status: "ok" | "fail" | "warn"; detail: string };

async function runMicDiagnostics(): Promise<DiagStep[]> {
  const steps: DiagStep[] = [];

  // 1. SpeechRecognition API 지원 여부
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  steps.push(SR
    ? { label: "SpeechRecognition API", status: "ok", detail: "지원됨" }
    : { label: "SpeechRecognition API", status: "fail", detail: "미지원 — Chrome 브라우저를 사용하세요" });

  // 2. navigator.permissions 로 마이크 권한 상태
  try {
    const perm = await navigator.permissions.query({ name: "microphone" as PermissionName });
    const map: Record<string, DiagStep["status"]> = { granted: "ok", prompt: "warn", denied: "fail" };
    steps.push({
      label: "마이크 권한",
      status: map[perm.state] ?? "warn",
      detail: perm.state === "granted" ? "허용됨" : perm.state === "denied" ? "차단됨 — 브라우저 설정에서 허용 필요" : "미결정 — 팝업에서 허용 선택 필요",
    });
  } catch {
    steps.push({ label: "마이크 권한", status: "warn", detail: "권한 상태 조회 불가" });
  }

  // 3. getUserMedia 실제 접근 테스트
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());
    steps.push({ label: "마이크 접근 (getUserMedia)", status: "ok", detail: "성공" });
  } catch (e: any) {
    const msg = e?.name === "NotAllowedError" ? "권한 거부" : e?.name === "NotFoundError" ? "마이크 없음" : String(e?.name ?? e);
    steps.push({ label: "마이크 접근 (getUserMedia)", status: "fail", detail: msg });
  }

  // 4. SpeechRecognition 3초 시작 테스트
  if (SR) {
    const result = await new Promise<DiagStep>((resolve) => {
      const rec = new SR();
      rec.lang = "ko-KR";
      rec.continuous = false;
      rec.interimResults = false;
      let started = false;
      const timer = setTimeout(() => resolve({ label: "SpeechRecognition 시작", status: "warn", detail: "3초 내 응답 없음 — 네트워크 또는 Google 서버 문제일 수 있습니다" }), 3000);
      rec.onstart = () => { started = true; clearTimeout(timer); rec.stop(); resolve({ label: "SpeechRecognition 시작", status: "ok", detail: "정상 시작됨" }); };
      rec.onerror = (e: any) => { clearTimeout(timer); resolve({ label: "SpeechRecognition 시작", status: "fail", detail: `오류: ${e.error}` }); };
      rec.onend = () => { if (!started) { clearTimeout(timer); resolve({ label: "SpeechRecognition 시작", status: "warn", detail: "즉시 종료 — 마이크가 다른 앱에서 사용 중이거나 네트워크 문제" }); } };
      try { rec.start(); } catch (e: any) { clearTimeout(timer); resolve({ label: "SpeechRecognition 시작", status: "fail", detail: `start() 오류: ${e.message}` }); }
    });
    steps.push(result);
  }

  return steps;
}


