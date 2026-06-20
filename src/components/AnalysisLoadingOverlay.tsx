import { useState, useEffect, useRef } from "react";
import { Search, Brain, Zap, FileCheck, Sparkles, Clock, ShieldCheck } from "lucide-react";

// ── 분석 단계 ──
const PHASES = [
  { Icon: Search,     label: "텍스트 스캔 중",   detail: "본문에서 검증 가능한 주장을 식별합니다" },
  { Icon: Brain,      label: "주장 추출 중",     detail: "사실 주장과 의견·감상을 분리합니다" },
  { Icon: Zap,        label: "근거 분석 중",     detail: "지지 근거와 반박 가능성을 교차 검토합니다" },
  { Icon: FileCheck,  label: "신뢰도 계산 중",   detail: "각 주장의 AI 확신도를 수치화합니다" },
  { Icon: ShieldCheck,label: "보고서 생성 중",   detail: "구조화된 팩트체크 결과를 작성합니다" },
];
const PHASE_MS = [3200, 3800, 4500, 4200, 5000];

// ── 슬롯머신 판정 후보 ──
const SLOT = [
  { label: "스캔 중…",   color: "oklch(0.65 0 0)" },
  { label: "사실?",      color: "oklch(0.72 0.18 160)" },
  { label: "검토 중",    color: "oklch(0.65 0.15 250)" },
  { label: "부분 사실?", color: "oklch(0.82 0.17 90)" },
  { label: "근거 확인",  color: "oklch(0.65 0 0)" },
  { label: "근거 부족?", color: "oklch(0.75 0.17 55)" },
  { label: "교차 검증",  color: "oklch(0.68 0.05 240)" },
  { label: "반박 검토",  color: "oklch(0.68 0.18 25)" },
];

// ── 유틸 ──
function toSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?。\n])\s*/)
    .map(s => s.trim())
    .filter(s => s.length > 12)
    .slice(0, 15);
}

function toClaims(text: string, url?: string): string[] {
  if (url && text.length < 50) {
    return ["URL 본문 수집 중…", "핵심 주장 파악 중…", "출처 신뢰도 확인 중…"];
  }
  return toSentences(text)
    .slice(0, 5)
    .map(s => (s.length > 32 ? s.slice(0, 32) + "…" : s));
}

// ── 단일 슬롯머신 칩 ──
function ClaimChip({ label, delay }: { label: string; delay: number }) {
  const [idx, setIdx] = useState(0);
  const [settled, setSettled] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    timerRef.current = setTimeout(() => {
      let count = 0;
      const max = 10 + Math.floor(Math.random() * 8);
      let ms = 80;
      const cycle = () => {
        setIdx(p => (p + 1) % SLOT.length);
        count++;
        if (count > max - 4) ms = Math.min(500, ms * 1.7);
        if (count < max) timerRef.current = setTimeout(cycle, ms);
        else setSettled(true);
      };
      cycle();
    }, delay);
    return () => clearTimeout(timerRef.current);
  }, [delay]);

  const v = SLOT[idx];
  return (
    <div
      className={`rounded-xl border px-3 py-2.5 transition-all duration-300 ${
        settled
          ? "border-primary/30 bg-primary/8 shadow-[0_0_12px_oklch(0.7_0.2_280/0.15)]"
          : "border-border/40 bg-background/25"
      }`}
    >
      <p className="text-[20px] text-muted-foreground/70 leading-snug line-clamp-2 mb-2">
        {label}
      </p>
      <span
        className="text-[22px] font-bold transition-all duration-150"
        style={{ color: v.color }}
      >
        {v.label}
      </span>
      {settled && (
        <div className="mt-1.5 h-0.5 rounded-full bg-primary/30 overflow-hidden">
          <div className="h-full bg-primary/70 animate-pulse w-full" />
        </div>
      )}
    </div>
  );
}

// ── 메인 컴포넌트 ──
interface Props {
  text: string;
  url?: string;
}

export function AnalysisLoadingOverlay({ text, url }: Props) {
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  const [sentIdx, setSentIdx] = useState(0);
  const [sentVisible, setSentVisible] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const animRef = useRef<number>(0);
  const startRef = useRef(Date.now());
  const TOTAL_MS = 22000;

  const sentences = toSentences(text);
  const claims = toClaims(text, url);

  // 진행 바
  useEffect(() => {
    const tick = () => {
      const el = Date.now() - startRef.current;
      setElapsed(Math.floor(el / 1000));
      setProgress(Math.min(92, (el / TOTAL_MS) * 100));
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  // 단계 전환
  useEffect(() => {
    let idx = 0;
    let accum = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    PHASE_MS.forEach((ms) => {
      accum += ms;
      const i = ++idx;
      timers.push(setTimeout(() => setPhaseIdx(Math.min(i, PHASES.length - 1)), accum));
    });
    return () => timers.forEach(clearTimeout);
  }, []);

  // 문장 롤링
  useEffect(() => {
    if (sentences.length === 0) return;
    const interval = setInterval(() => {
      setSentVisible(false);
      setTimeout(() => {
        setSentIdx(p => (p + 1) % sentences.length);
        setSentVisible(true);
      }, 380);
    }, 2600);
    return () => clearInterval(interval);
  }, [sentences.length]);

  const phase = PHASES[phaseIdx];
  const PhaseIcon = phase.Icon;
  const remaining = Math.max(0, Math.ceil((TOTAL_MS - (Date.now() - startRef.current)) / 1000));

  return (
    <div className="glass rounded-2xl p-5 sm:p-6 shadow-[var(--shadow-card)] space-y-5">

      {/* ── 헤더: 단계 표시기 ── */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" style={{ animationDuration: "1.8s" }} />
            <div className="relative w-9 h-9 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center">
              <PhaseIcon className="w-4.5 h-4.5 text-primary" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">{phase.label}</span>
              <span className="text-[10px] text-muted-foreground/60 tabular-nums">
                {phaseIdx + 1}/{PHASES.length}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground/70 mt-0.5 leading-snug">{phase.detail}</p>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
            <Clock className="w-3.5 h-3.5" />
            <span className="tabular-nums">
              {elapsed < remaining
                ? `약 ${remaining}초 남음`
                : `${elapsed}초 경과`}
            </span>
          </div>
        </div>

        {/* 진행 바 */}
        <div className="relative h-1.5 rounded-full bg-surface-2 overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-primary to-accent transition-none"
            style={{ width: `${progress}%` }}
          />
          {/* 반짝이는 하이라이트 */}
          <div
            className="absolute inset-y-0 w-16 rounded-full"
            style={{
              left: `calc(${progress}% - 4rem)`,
              background: "linear-gradient(90deg, transparent, oklch(1 0 0 / 0.4), transparent)",
              animation: "shimmer 1.2s ease-in-out infinite",
            }}
          />
        </div>

        {/* 단계 점 */}
        <div className="flex gap-1.5">
          {PHASES.map((p, i) => (
            <div
              key={i}
              className={`h-1 rounded-full transition-all duration-500 ${
                i < phaseIdx
                  ? "bg-primary flex-1"
                  : i === phaseIdx
                    ? "bg-primary/70 flex-[2] animate-pulse"
                    : "bg-border/50 flex-1"
              }`}
            />
          ))}
        </div>
      </div>

      {/* ── 텍스트 스캐너 ── */}
      {sentences.length > 0 && (
        <div className="rounded-xl border border-border/40 bg-background/30 overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30 bg-surface-2/30">
            <div className="flex gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-red-400/60" />
              <span className="w-2.5 h-2.5 rounded-full bg-yellow-400/60" />
              <span className="w-2.5 h-2.5 rounded-full bg-green-400/60" />
            </div>
            <span className="text-[10px] text-muted-foreground/60 font-mono">텍스트 스캐닝</span>
            <div className="ml-auto flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              <span className="text-[10px] text-primary font-mono">
                {sentIdx + 1}/{sentences.length}
              </span>
            </div>
          </div>
          <div className="px-4 py-4 min-h-[60px] flex items-center relative overflow-hidden">
            {/* 스캔 라인 */}
            <div
              className="absolute inset-y-0 w-px bg-gradient-to-b from-transparent via-primary/60 to-transparent pointer-events-none"
              style={{ animation: "scanLine 2s linear infinite" }}
            />
            <p
              className="text-sm leading-relaxed text-foreground/85 font-medium relative z-10 transition-none"
              style={{
                opacity: sentVisible ? 1 : 0,
                transform: sentVisible ? "translateY(0)" : "translateY(10px)",
                transition: "opacity 0.38s ease, transform 0.38s ease",
              }}
            >
              <span className="text-primary font-mono text-xs mr-2 opacity-60">▶</span>
              {sentences[sentIdx]}
            </p>
          </div>
          {/* 하단 스펙트럼 바 */}
          <div className="px-3 pb-2 flex gap-0.5">
            {Array.from({ length: 32 }, (_, i) => (
              <div
                key={i}
                className="flex-1 rounded-full bg-primary/30"
                style={{
                  height: `${4 + Math.sin(Date.now() / 200 + i) * 3}px`,
                  animation: `specBar ${0.3 + (i % 5) * 0.12}s ease-in-out infinite alternate`,
                  animationDelay: `${(i * 37) % 300}ms`,
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── 주장 후보 슬롯머신 ── */}
      <div>
        <div className="flex items-center gap-2 mb-2.5">
          <Sparkles className="w-3.5 h-3.5 text-accent shrink-0" />
          <span className="text-xs font-semibold text-muted-foreground">주장 후보 팩트체크 중</span>
          <div className="ml-auto flex gap-1">
            {[0, 1, 2].map(i => (
              <div
                key={i}
                className="w-1 h-1 rounded-full bg-accent/60 animate-bounce"
                style={{ animationDelay: `${i * 0.18}s` }}
              />
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {claims.slice(0, 4).map((c, i) => (
            <ClaimChip key={i} label={c} delay={600 + i * 700} />
          ))}
        </div>
      </div>

      {/* ── 푸터 ── */}
      <div className="flex items-center gap-2 pt-1 border-t border-border/30">
        <div className="flex gap-0.5">
          {[...Array(3)].map((_, i) => (
            <span
              key={i}
              className="w-2 h-2 rounded-full bg-primary/50 animate-bounce"
              style={{ animationDelay: `${i * 0.2}s`, animationDuration: "0.9s" }}
            />
          ))}
        </div>
        <span className="text-xs text-muted-foreground/60">
          AI가 주장을 분석하고 있습니다 — 보통 10~20초 소요
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground/40 tabular-nums">
          {Math.round(progress)}%
        </span>
      </div>

      {/* ── CSS 애니메이션 정의 ── */}
      <style>{`
        @keyframes scanLine {
          0%   { left: -2px; opacity: 0; }
          5%   { opacity: 1; }
          95%  { opacity: 1; }
          100% { left: 100%; opacity: 0; }
        }
        @keyframes shimmer {
          0%   { opacity: 0; }
          50%  { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes specBar {
          from { height: 3px; }
          to   { height: 10px; }
        }
      `}</style>
    </div>
  );
}
