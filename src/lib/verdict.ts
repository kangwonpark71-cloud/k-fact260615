import { CheckCircle2, HelpCircle, XCircle, MinusCircle, type LucideIcon } from "lucide-react";

export type Verdict = "사실" | "부분 사실" | "근거 부족" | "반대 근거 우세";

export const VERDICTS: Verdict[] = ["사실", "부분 사실", "근거 부족", "반대 근거 우세"];

export const VERDICT_ORDER: Record<string, number> = {
  사실: 1,
  "부분 사실": 2,
  "근거 부족": 3,
  "반대 근거 우세": 4,
};

export function compareVerdict(a: string, b: string): "same" | "left" | "right" {
  const va = VERDICT_ORDER[a] ?? 5;
  const vb = VERDICT_ORDER[b] ?? 5;
  if (va < vb) return "left";
  if (va > vb) return "right";
  return "same";
}

export interface VerdictMeta {
  icon: LucideIcon;
  color: string;
  bg: string;
  border: string;
  label: string;
}

export const VERDICT_META: Record<string, VerdictMeta> = {
  사실: {
    icon: CheckCircle2,
    color: "text-verdict-true",
    bg: "bg-verdict-true/10",
    border: "border-verdict-true/30",
    label: "사실",
  },
  "부분 사실": {
    icon: MinusCircle,
    color: "text-verdict-partial",
    bg: "bg-verdict-partial/10",
    border: "border-verdict-partial/30",
    label: "부분 사실",
  },
  "근거 부족": {
    icon: HelpCircle,
    color: "text-verdict-weak",
    bg: "bg-verdict-weak/10",
    border: "border-verdict-weak/30",
    label: "근거 부족",
  },
  "반대 근거 우세": {
    icon: XCircle,
    color: "text-verdict-false",
    bg: "bg-verdict-false/10",
    border: "border-verdict-false/30",
    label: "반대 근거 우세",
  },
  미확인: {
    icon: HelpCircle,
    color: "text-verdict-weak",
    bg: "bg-verdict-weak/10",
    border: "border-verdict-weak/30",
    label: "근거 부족",
  },
};

export function getVerdictMeta(verdict: string): VerdictMeta {
  return VERDICT_META[verdict] ?? VERDICT_META["근거 부족"];
}
