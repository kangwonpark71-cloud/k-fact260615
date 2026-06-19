import { CheckCircle2, AlertTriangle, HelpCircle, XCircle } from "lucide-react";

type Verdict = "사실" | "부분 사실" | "근거 부족" | "반대 근거 우세";

const styles: Record<Verdict, { border: string; text: string; bg: string; Icon: typeof CheckCircle2 }> = {
  "사실":           { border: "border-verdict-true",    text: "text-verdict-true",    bg: "bg-verdict-true/10",    Icon: CheckCircle2 },
  "부분 사실":      { border: "border-verdict-partial", text: "text-verdict-partial", bg: "bg-verdict-partial/10", Icon: AlertTriangle },
  "근거 부족":      { border: "border-verdict-weak",    text: "text-verdict-weak",    bg: "bg-verdict-weak/10",    Icon: HelpCircle },
  "반대 근거 우세": { border: "border-verdict-false",   text: "text-verdict-false",   bg: "bg-verdict-false/10",   Icon: XCircle },
};

export function VerdictBadge({ verdict, size = "md" }: { verdict: string; size?: "sm" | "md" | "lg" }) {
  const v = styles[verdict as Verdict] ?? styles["근거 부족"];
  const Icon = v.Icon;
  const sizeClass = {
    sm: "text-[9px] px-1.5 py-0.5 gap-0.5 border",
    md: "text-[10px] px-2.5 py-1 gap-1 border",
    lg: "text-xs px-3 py-1.5 gap-1.5 border-2",
  }[size];
  const iconSize = { sm: "w-2.5 h-2.5", md: "w-3 h-3", lg: "w-3.5 h-3.5" }[size];

  return (
    <span className={`stamp inline-flex items-center font-bold uppercase tracking-widest rounded-sm ${v.bg} ${v.text} ${v.border} ${sizeClass}`}>
      <Icon className={iconSize} />
      {verdict}
    </span>
  );
}
