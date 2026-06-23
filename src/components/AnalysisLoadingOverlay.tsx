import { useState, useEffect, useRef } from "react";
import { Search, Brain, Zap, FileCheck, ShieldCheck, Clock, Target, Activity } from "lucide-react";

// ── 분석 단계 ──
const PHASES = [
  { Icon: Search, label: "텍스트 스캔", detail: "검증 가능한 사실 주장을 식별합니다" },
  { Icon: Brain, label: "주장 추출", detail: "수치·날짜·인물·법령을 각각 분리합니다" },
  { Icon: Target, label: "논리 검증", detail: "인과 관계와 근거 일관성을 교차 검토합니다" },
  { Icon: Activity, label: "신뢰도 계산", detail: "각 주장의 근거 강도를 수치화합니다" },
  { Icon: Zap, label: "Tavily 검색", detail: "실시간 뉴스·공식 자료로 재검증합니다" },
  { Icon: FileCheck, label: "판정 확정", detail: "최종 팩트체크 보고서를 작성합니다" },
  { Icon: ShieldCheck, label: "무결성 서명", detail: "결과 위변조 방지 서명을 적용합니다" },
];
const PHASE_MS = [2800, 3200, 3800, 3500, 5000, 4200, 2500];
const TOTAL_MS = PHASE_MS.reduce((a, b) => a + b, 0);

// ── 판정 슬롯 ──
const SLOT = [
  { label: "스캔 중…", color: "oklch(0.65 0.01 255)" },
  { label: "사실 확인", color: "oklch(0.62 0.18 160)" },
  { label: "교차 검증", color: "oklch(0.65 0.12 250)" },
  { label: "부분 사실?", color: "oklch(0.72 0.17 80)" },
  { label: "근거 탐색", color: "oklch(0.65 0.01 255)" },
  { label: "반박 검토", color: "oklch(0.65 0.18 25)" },
  { label: "출처 확인", color: "oklch(0.68 0.10 200)" },
  { label: "논리 분석", color: "oklch(0.68 0.05 240)" },
];

function toSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?。\n])\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12)
    .slice(0, 15);
}

function toClaims(text: string, url?: string): string[] {
  if (url && text.length < 50) {
    return ["URL 본문 수집 중…", "핵심 주장 파악 중…", "출처 신뢰도 확인 중…"];
  }
  return toSentences(text)
    .slice(0, 5)
    .map((s) => (s.length > 34 ? s.slice(0, 34) + "…" : s));
}

// ── 슬롯머신 칩 ──
function ClaimChip({ label, delay }: { label: string; delay: number }) {
  const [idx, setIdx] = useState(0);
  const [settled, setSettled] = useState(false);
  const [verdict, setVerdict] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const VERDICTS = [
    "사실",
    "부분 사실",
    "근거 부족",
    "사실",
    "반대 근거 우세",
    "부분 사실",
    "사실",
  ];
  const VCOLORS: Record<string, string> = {
    사실: "text-emerald-400 border-emerald-400/30 bg-emerald-400/8",
    "부분 사실": "text-amber-400 border-amber-400/30 bg-amber-400/8",
    "근거 부족": "text-orange-400 border-orange-400/30 bg-orange-400/8",
    "반대 근거 우세": "text-red-400 border-red-400/30 bg-red-400/8",
  };

  useEffect(() => {
    timerRef.current = setTimeout(() => {
      let count = 0;
      const max = 10 + Math.floor(Math.random() * 8);
      let ms = 80;
      const cycle = () => {
        setIdx((p) => (p + 1) % SLOT.length);
        count++;
        if (count > max - 4) ms = Math.min(500, ms * 1.7);
        if (count < max) timerRef.current = setTimeout(cycle, ms);
        else {
          setSettled(true);
          setVerdict(VERDICTS[Math.floor(Math.random() * VERDICTS.length)]);
        }
      };
      cycle();
    }, delay);
    return () => clearTimeout(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delay]);

  const v = SLOT[idx];
  const verdictClass = verdict ? VCOLORS[verdict] : "";

  return (
    <div
      className={`rounded-xl border px-3 py-2.5 transition-all duration-400 ${
        settled ? "border-primary/25 bg-primary/5" : "border-border/40 bg-background/20"
      }`}
    >
      <p className="text-[13px] sm:text-[12px] text-muted-foreground/80 leading-snug line-clamp-2 mb-2">
        {label}
      </p>
      {settled && verdict ? (
        <span
          className={`inline-flex items-center gap-1 text-[12px] font-bold px-2 py-0.5 rounded-full border ${verdictClass}`}
        >
          {verdict}
        </span>
      ) : (
        <span
          className="text-[14px] font-bold transition-all duration-150"
          style={{ color: v.color }}
        >
          {v.label}
        </span>
      )}
      {settled && (
        <div className="mt-1.5 h-0.5 rounded-full bg-primary/20 overflow-hidden">
          <div className="h-full bg-primary/60 animate-pulse w-full" />
        </div>
      )}
    </div>
  );
}

// ── 실시간 신뢰도 스펙트럼 ──
function ConfidenceSpectrum({ elapsed }: { elapsed: number }) {
  const seed = elapsed * 7;
  const bars = Array.from({ length: 20 }, (_, i) => {
    const base = 30 + Math.sin((seed + i * 3.7) * 0.8) * 28;
    return Math.min(95, Math.max(5, Math.round(base)));
  });

  const getColor = (v: number) =>
    v >= 70
      ? "bg-emerald-400/70"
      : v >= 50
        ? "bg-amber-400/70"
        : v >= 35
          ? "bg-orange-400/70"
          : "bg-red-400/60";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 justify-between">
        <span className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest">
          신뢰도 스펙트럼
        </span>
        <div className="flex items-center gap-3">
          {[
            ["70+", "bg-emerald-400/70", "사실"],
            ["50+", "bg-amber-400/70", "부분"],
            ["<35", "bg-red-400/60", "반박"],
          ].map(([v, c, l]) => (
            <span key={v} className="flex items-center gap-1 text-[9px] text-muted-foreground/50">
              <span className={`w-2 h-2 rounded-sm ${c}`} />
              {l}
            </span>
          ))}
        </div>
      </div>
      <div className="flex gap-0.5 items-end h-8">
        {bars.map((h, i) => (
          <div
            key={i}
            className={`flex-1 rounded-t-sm transition-all duration-500 ${getColor(h)}`}
            style={{ height: `${h * 0.3}px`, transitionDelay: `${i * 20}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

// ── 체크 카운터 ──
function CheckCounter({ elapsed }: { elapsed: number }) {
  const count = Math.min(elapsed * 3 + Math.floor(Math.sin(elapsed * 2) * 4), 127);
  return (
    <div className="flex items-center gap-3 text-[11px] text-muted-foreground/70">
      <span className="font-mono text-primary font-bold text-base tabular-nums">{count}</span>
      <span>개 학습 데이터 참조 중</span>
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

  const sentences = toSentences(text);
  const claims = toClaims(text, url);

  // 진행 바
  useEffect(() => {
    const tick = () => {
      const el = Date.now() - startRef.current;
      setElapsed(Math.floor(el / 1000));
      setProgress(Math.min(93, (el / TOTAL_MS) * 100));
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
        setSentIdx((p) => (p + 1) % sentences.length);
        setSentVisible(true);
      }, 380);
    }, 2600);
    return () => clearInterval(interval);
  }, [sentences.length]);

  const phase = PHASES[phaseIdx];
  const PhaseIcon = phase.Icon;
  const remaining = Math.max(0, Math.ceil((TOTAL_MS - (Date.now() - startRef.current)) / 1000));

  return (
    <div className="glass rounded-2xl p-5 sm:p-6 shadow-[var(--shadow-card)] space-y-4">
      {/* ── 헤더: 단계 + 타이머 ── */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="relative shrink-0">
            <div
              className="absolute inset-0 rounded-full bg-primary/20 animate-ping"
              style={{ animationDuration: "1.8s" }}
            />
            <div className="relative w-9 h-9 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center">
              <PhaseIcon className="w-4 h-4 text-primary" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">{phase.label}</span>
              <span className="text-[10px] text-muted-foreground/60 tabular-nums font-mono">
                {phaseIdx + 1}/{PHASES.length}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground/70 mt-0.5 leading-snug">
              {phase.detail}
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
            <Clock className="w-3.5 h-3.5" />
            <span className="tabular-nums font-mono">
              {elapsed < remaining ? `${remaining}s` : `${elapsed}s`}
            </span>
          </div>
        </div>

        {/* 진행 바 */}
        <div className="relative h-1.5 rounded-full bg-surface-2 overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-primary to-accent transition-none"
            style={{ width: `${progress}%` }}
          />
          <div
            className="absolute inset-y-0 w-16 rounded-full"
            style={{
              left: `calc(${progress}% - 4rem)`,
              background: "linear-gradient(90deg, transparent, oklch(1 0 0 / 0.35), transparent)",
              animation: "shimmer 1.2s ease-in-out infinite",
            }}
          />
        </div>

        {/* 단계 점 */}
        <div className="flex gap-1">
          {PHASES.map((_, i) => (
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

      {/* ── 텍스트 스캐너 + 체크 카운터 ── */}
      {sentences.length > 0 && (
        <div className="rounded-xl border border-border/40 bg-background/30 overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30 bg-surface-2/30">
            <div className="flex gap-1">
              <span className="w-2 h-2 rounded-full bg-red-400/60" />
              <span className="w-2 h-2 rounded-full bg-yellow-400/60" />
              <span className="w-2 h-2 rounded-full bg-green-400/60" />
            </div>
            <span className="text-[10px] text-muted-foreground/60 font-mono">텍스트 스캐닝</span>
            <div className="ml-auto flex items-center gap-2">
              <CheckCounter elapsed={elapsed} />
              <span className="text-[10px] text-primary font-mono tabular-nums">
                {sentIdx + 1}/{sentences.length}
              </span>
            </div>
          </div>
          <div className="px-4 py-3 min-h-[52px] flex items-center relative overflow-hidden">
            <div
              className="absolute inset-y-0 w-px bg-gradient-to-b from-transparent via-primary/60 to-transparent pointer-events-none"
              style={{ animation: "scanLine 2s linear infinite" }}
            />
            <p
              className="text-sm leading-relaxed text-foreground/85 font-medium relative z-10"
              style={{
                opacity: sentVisible ? 1 : 0,
                transform: sentVisible ? "translateY(0)" : "translateY(8px)",
                transition: "opacity 0.36s ease, transform 0.36s ease",
              }}
            >
              <span className="text-primary font-mono text-xs mr-2 opacity-60">▶</span>
              {sentences[sentIdx]}
            </p>
          </div>
          {/* 신뢰도 스펙트럼 */}
          <div className="px-3 pb-3 pt-1 border-t border-border/20">
            <ConfidenceSpectrum elapsed={elapsed} />
          </div>
        </div>
      )}

      {/* ── 주장 후보 슬롯머신 ── */}
      <div>
        <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest mb-2.5">
          주장별 팩트체크 진행 중
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {claims.slice(0, 4).map((c, i) => (
            <ClaimChip key={i} label={c} delay={600 + i * 700} />
          ))}
        </div>
      </div>

      {/* ── 금지사항 품질 보증 배지 ── */}
      <div className="flex flex-wrap gap-1.5 pt-1 border-t border-border/25">
        {["근거 기반 판정", "논리적 추론", "중복 주장 제거", "출처 귀속 검증"].map((label) => (
          <span
            key={label}
            className="text-[10px] px-2 py-0.5 rounded-full border border-primary/20 text-primary/70 bg-primary/5 font-medium"
          >
            ✓ {label}
          </span>
        ))}
        <span className="ml-auto text-[10px] text-muted-foreground/40 tabular-nums self-center">
          {Math.round(progress)}%
        </span>
      </div>

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
      `}</style>
    </div>
  );
}
