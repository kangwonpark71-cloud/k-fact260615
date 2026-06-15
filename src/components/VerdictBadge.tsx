import { CheckCircle2, AlertTriangle, HelpCircle, XCircle, Minus } from "lucide-react";

type Verdict = "사실" | "부분 사실" | "근거 부족" | "반대 근거 우세" | "미확인";

const styles: Record<Verdict, { bg: string; text: string; ring: string; Icon: typeof CheckCircle2 }> = {
  "사실": { bg: "bg-verdict-true/15", text: "text-verdict-true", ring: "ring-verdict-true/30", Icon: CheckCircle2 },
  "부분 사실": { bg: "bg-verdict-partial/15", text: "text-verdict-partial", ring: "ring-verdict-partial/30", Icon: AlertTriangle },
  "근거 부족": { bg: "bg-verdict-weak/15", text: "text-verdict-weak", ring: "ring-verdict-weak/30", Icon: HelpCircle },
  "반대 근거 우세": { bg: "bg-verdict-false/15", text: "text-verdict-false", ring: "ring-verdict-false/30", Icon: XCircle },
  "미확인": { bg: "bg-verdict-unknown/15", text: "text-verdict-unknown", ring: "ring-verdict-unknown/30", Icon: Minus },
};

export function VerdictBadge({ verdict, size = "md" }: { verdict: string; size?: "sm" | "md" | "lg" }) {
  const v = (styles[verdict as Verdict] ?? styles["미확인"]);
  const Icon = v.Icon;
  const sizes = {
    sm: "text-xs px-2 py-0.5 gap-1",
    md: "text-sm px-3 py-1 gap-1.5",
    lg: "text-base px-4 py-1.5 gap-2",
  }[size];
  return (
    <span className={`inline-flex items-center font-medium rounded-full ring-1 ${v.bg} ${v.text} ${v.ring} ${sizes}`}>
      <Icon className={size === "sm" ? "w-3 h-3" : size === "lg" ? "w-4 h-4" : "w-3.5 h-3.5"} />
      {verdict}
    </span>
  );
}
