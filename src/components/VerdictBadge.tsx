import { CheckCircle2, AlertTriangle, HelpCircle, XCircle } from "lucide-react";

type Verdict = "사실" | "부분 사실" | "근거 부족" | "반대 근거 우세";

const styles: Record<Verdict, { text: string; bg: string; Icon: typeof CheckCircle2 }> = {
  "사실":           { text: "text-verdict-true",    bg: "bg-verdict-true/12",    Icon: CheckCircle2 },
  "부분 사실":      { text: "text-verdict-partial", bg: "bg-verdict-partial/12", Icon: AlertTriangle },
  "근거 부족":      { text: "text-verdict-weak",    bg: "bg-verdict-weak/12",    Icon: HelpCircle },
  "반대 근거 우세": { text: "text-verdict-false",   bg: "bg-verdict-false/12",   Icon: XCircle },
};

export function VerdictBadge({ verdict, size = "md" }: { verdict: string; size?: "sm" | "md" | "lg" }) {
  const normalized = verdict === "미확인" ? "근거 부족" : verdict;
  const v = styles[normalized as Verdict] ?? styles["근거 부족"];
  const Icon = v.Icon;
  const sizeClass = {
    sm: "text-[10px] px-2 py-0.5 gap-1",
    md: "text-xs px-2.5 py-1 gap-1",
    lg: "text-sm px-3.5 py-1.5 gap-1.5",
  }[size];
  const iconSize = { sm: "w-3 h-3", md: "w-3.5 h-3.5", lg: "w-4 h-4" }[size];

  return (
    <span className={`inline-flex items-center font-semibold rounded-full ${v.bg} ${v.text} ${sizeClass}`}>
      <Icon className={iconSize} />
      {normalized}
    </span>
  );
}
