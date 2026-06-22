import { CheckCircle2, AlertTriangle, HelpCircle, XCircle, MinusCircle } from "lucide-react";

type Verdict = "사실" | "부분 사실" | "근거 부족" | "반대 근거 우세";

const META: Record<Verdict, {
  Icon: typeof CheckCircle2;
  text: string;
  bg: string;
  border: string;
  ring: string;
  dot: string;
}> = {
  "사실": {
    Icon: CheckCircle2,
    text:   "text-emerald-600 dark:text-emerald-400",
    bg:     "bg-emerald-50 dark:bg-emerald-400/10",
    border: "border-emerald-300/60 dark:border-emerald-400/30",
    ring:   "ring-emerald-400/20",
    dot:    "bg-emerald-400",
  },
  "부분 사실": {
    Icon: MinusCircle,
    text:   "text-amber-600 dark:text-amber-400",
    bg:     "bg-amber-50 dark:bg-amber-400/10",
    border: "border-amber-300/60 dark:border-amber-400/30",
    ring:   "ring-amber-400/20",
    dot:    "bg-amber-400",
  },
  "근거 부족": {
    Icon: HelpCircle,
    text:   "text-orange-600 dark:text-orange-400",
    bg:     "bg-orange-50 dark:bg-orange-400/10",
    border: "border-orange-300/60 dark:border-orange-400/30",
    ring:   "ring-orange-400/20",
    dot:    "bg-orange-400",
  },
  "반대 근거 우세": {
    Icon: XCircle,
    text:   "text-red-600 dark:text-red-400",
    bg:     "bg-red-50 dark:bg-red-400/10",
    border: "border-red-300/60 dark:border-red-400/30",
    ring:   "ring-red-400/20",
    dot:    "bg-red-400",
  },
};

/* 판정 → 간결 숫자 라벨 */
function confidenceLabel(confidence?: number): string | null {
  if (confidence === undefined || confidence <= 0) return null;
  return `${confidence}%`;
}

interface VerdictBadgeProps {
  verdict: string;
  size?: "sm" | "md" | "lg";
  confidence?: number;
  showDot?: boolean;
}

export function VerdictBadge({ verdict, size = "md", confidence, showDot }: VerdictBadgeProps) {
  const normalized = (verdict === "미확인" ? "근거 부족" : verdict) as Verdict;
  const m = META[normalized] ?? META["근거 부족"];
  const Icon = m.Icon;

  const sizeClass = {
    sm: "text-[10px] px-2 py-0.5 gap-1",
    md: "text-xs px-2.5 py-1 gap-1.5",
    lg: "text-sm px-3.5 py-1.5 gap-1.5",
  }[size];

  const iconSz = {
    sm: "w-3 h-3",
    md: "w-3.5 h-3.5",
    lg: "w-4 h-4",
  }[size];

  const confLabel = confidenceLabel(confidence);

  return (
    <span
      className={`inline-flex items-center font-semibold rounded-full border ring-1 select-none
        ${m.bg} ${m.text} ${m.border} ${m.ring} ${sizeClass}`}
    >
      {showDot ? (
        <span className={`shrink-0 rounded-full ${m.dot} ${size === "sm" ? "w-1.5 h-1.5" : "w-2 h-2"}`} />
      ) : (
        <Icon className={`shrink-0 ${iconSz}`} />
      )}
      {normalized}
      {confLabel && (
        <span className={`ml-0.5 opacity-70 font-mono tabular-nums ${size === "sm" ? "text-[9px]" : "text-[10px]"}`}>
          {confLabel}
        </span>
      )}
    </span>
  );
}

/* 판정 색상 토큰만 반환 (외부 스타일 작성용) */
export function verdictColors(verdict: string) {
  const normalized = (verdict === "미확인" ? "근거 부족" : verdict) as Verdict;
  return META[normalized] ?? META["근거 부족"];
}

/* 판정 → 아이콘 컴포넌트만 반환 */
export function VerdictIcon({ verdict, className }: { verdict: string; className?: string }) {
  const normalized = (verdict === "미확인" ? "근거 부족" : verdict) as Verdict;
  const m = META[normalized] ?? META["근거 부족"];
  const Icon = m.Icon;
  return <Icon className={`${m.text} ${className ?? "w-4 h-4"}`} />;
}

/* AlertTriangle 재익스포트 (AuditTrailPanel 등에서 사용) */
export { AlertTriangle };
