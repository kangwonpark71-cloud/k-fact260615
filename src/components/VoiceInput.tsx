import { useState, useRef, useCallback, useEffect } from "react";
import { Mic, Square, MicOff } from "lucide-react";

const BARS = 36;

interface VoiceInputProps {
  value: string;
  onChange: (text: string) => void;
  interimText: string;
  onInterimChange: (text: string) => void;
  onSentenceComplete?: (text: string) => void;
}

export function VoiceInput({ value, onChange, interimText, onInterimChange, onSentenceComplete }: VoiceInputProps) {
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState<boolean | null>(null);
  const [barHeights, setBarHeights] = useState<number[]>(Array(BARS).fill(3));

  const recognitionRef = useRef<any>(null);
  const isListeningRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number>(0);
  const valueRef = useRef(value);

  useEffect(() => { valueRef.current = value; }, [value]);

  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setIsSupported(!!SR);
    return () => stopAudio();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopAudio = () => {
    cancelAnimationFrame(animFrameRef.current);
    try { audioCtxRef.current?.close(); } catch {}
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setBarHeights(Array(BARS).fill(3));
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
      const step = Math.max(1, Math.floor(buf.length / BARS));
      const tick = () => {
        if (!isListeningRef.current) return;
        analyser.getByteFrequencyData(buf);
        setBarHeights(
          Array.from({ length: BARS }, (_, i) => {
            const s = i * step;
            const slice = buf.slice(s, s + step);
            const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
            return Math.max(3, (avg / 255) * 44);
          }),
        );
        animFrameRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch { /* 시각화 없이 인식만 진행 */ }
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
        const cur = valueRef.current;
        const sep = cur && !/\s$/.test(cur) ? " " : "";
        onChange(cur + sep + final);
        onInterimChange("");
        const trimmed = final.trim();
        if (trimmed.length >= 15) onSentenceComplete?.(trimmed);
      } else {
        onInterimChange(interim);
      }
    };

    rec.onerror = (e: any) => {
      if (e.error === "not-allowed") {
        alert("마이크 접근 권한이 필요합니다. 브라우저 설정에서 허용해 주세요.");
        isListeningRef.current = false;
        recognitionRef.current?.stop();
        recognitionRef.current = null;
        setIsListening(false);
        onInterimChange("");
        stopAudio();
      }
    };

    rec.onend = () => {
      if (isListeningRef.current) {
        try { rec.start(); } catch {}
      }
    };

    recognitionRef.current = rec;
    isListeningRef.current = true;
    setIsListening(true);
    rec.start();
    startAudio();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onChange, onInterimChange, onSentenceComplete]);

  const stop = useCallback(() => {
    isListeningRef.current = false;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setIsListening(false);
    onInterimChange("");
    stopAudio();
  }, [onInterimChange]);

  if (isSupported === null) return null;

  if (!isSupported) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <MicOff className="w-10 h-10 text-muted-foreground" />
        <p className="text-base text-muted-foreground">이 브라우저는 음성 인식을 지원하지 않습니다.</p>
        <p className="text-sm text-muted-foreground">Chrome 또는 Edge 앱을 사용해 주세요.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-5 py-2">
      {/* 오디오 파형 */}
      <div className="flex items-end gap-[3px] h-12 px-2">
        {barHeights.map((h, i) => (
          <div
            key={i}
            className="w-1.5 rounded-full"
            style={{
              height: `${h}px`,
              background: isListening
                ? `oklch(${0.65 + (h / 44) * 0.18} ${0.13 + (h / 44) * 0.1} ${238 + i * 3.5})`
                : "oklch(0.45 0 0 / 0.25)",
              transition: "height 60ms linear",
            }}
          />
        ))}
      </div>

      {/* 마이크 버튼 */}
      <div className="relative flex items-center justify-center">
        {isListening && (
          <>
            <span className="absolute inset-0 rounded-full bg-red-400/25 animate-ping" style={{ animationDuration: "1.4s" }} />
            <span className="absolute inset-[-20px] rounded-full bg-red-400/8 animate-pulse" />
          </>
        )}
        <button
          type="button"
          onClick={isListening ? stop : start}
          className={`relative z-10 w-24 h-24 sm:w-20 sm:h-20 rounded-full flex items-center justify-center shadow-2xl transition-all duration-300 active:scale-95 ${
            isListening
              ? "bg-gradient-to-br from-red-500 to-rose-600 scale-105 shadow-red-500/50"
              : "bg-gradient-to-br from-primary to-accent hover:scale-110 shadow-[var(--shadow-glow)]"
          }`}
        >
          {isListening
            ? <Square className="w-8 h-8 sm:w-7 sm:h-7 text-white fill-white" />
            : <Mic className="w-9 h-9 sm:w-8 sm:h-8 text-white" />}
        </button>
      </div>

      {/* 상태 레이블 */}
      <p className="text-sm text-muted-foreground min-h-[20px] text-center">
        {isListening ? (
          <span className="inline-flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse inline-block" />
            실시간 인식 중… 말씀하세요
          </span>
        ) : "버튼을 눌러 음성 입력을 시작하세요"}
      </p>

      {/* 전사 텍스트 */}
      {(value || interimText) && (
        <div className="w-full bg-background/30 rounded-xl p-3 text-sm leading-relaxed border border-border/50 max-h-40 overflow-y-auto">
          <span className="text-foreground whitespace-pre-wrap">{value}</span>
          {interimText && (
            <span className="text-primary/60 italic"> {interimText}</span>
          )}
          {isListening && (
            <span className="inline-block w-0.5 h-4 bg-primary ml-0.5 animate-pulse align-middle" />
          )}
        </div>
      )}

      {value && (
        <button
          type="button"
          onClick={() => { onChange(""); onInterimChange(""); }}
          className="text-xs text-muted-foreground hover:text-destructive transition-colors py-1 px-3"
        >
          전사 내용 지우기
        </button>
      )}
    </div>
  );
}
