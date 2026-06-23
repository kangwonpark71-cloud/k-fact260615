import type { Verdict } from "./types";

/* ── CF Workers AI 응답 파싱 유틸리티 ── */

const CF_VALID: Verdict[] = ["사실", "부분 사실", "근거 부족", "반대 근거 우세"];

const CF_VMAP: Record<string, Verdict> = {
  "사실이다": "사실", "사실임": "사실", "참": "사실",
  "부분사실": "부분 사실", "부분적 사실": "부분 사실", "일부사실": "부분 사실",
  "근거부족": "근거 부족", "증거부족": "근거 부족", "불충분": "근거 부족",
  "반대근거우세": "반대 근거 우세", "거짓": "반대 근거 우세", "허위": "반대 근거 우세",
  "불확실": "근거 부족", "확인불가": "근거 부족",
};

function cfV(v: unknown): Verdict {
  if (typeof v !== "string") return "근거 부족";
  const t = v.trim();
  return (CF_VALID as readonly string[]).includes(t)
    ? (t as Verdict)
    : (CF_VMAP[t] ?? "근거 부족");
}

function cfS(v: unknown, max: number): string {
  if (typeof v === "string") return v.slice(0, max);
  return String(v ?? "").slice(0, max);
}

function cfN(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return isNaN(n) ? 50 : Math.min(100, Math.max(0, Math.round(n)));
}

function cfA(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 5).map(s => cfS(s, 120));
}

function cfSrc(v: unknown): { name: string; type: string }[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 5).map(s => {
    if (typeof s === "string") return { name: s.slice(0, 50), type: "일반" };
    if (s && typeof s === "object") {
      const o = s as Record<string, unknown>;
      return {
        name: cfS(o.name ?? o.source ?? o.title ?? "", 50),
        type: cfS(o.type ?? "일반", 30),
      };
    }
    return { name: "참고 자료", type: "일반" };
  });
}

const CF_CLAIM_TYPES = ["EMPIRICAL", "DISPUTED_TERRITORY", "OPINION", "DOMESTIC_LAW_FACT"] as const;

function cfCT(v: unknown): typeof CF_CLAIM_TYPES[number] {
  const s = typeof v === "string" ? v.trim().toUpperCase() : "";
  return (CF_CLAIM_TYPES as readonly string[]).includes(s)
    ? (s as typeof CF_CLAIM_TYPES[number])
    : "EMPIRICAL";
}

function cfJB(v: unknown, claimType: string): string {
  if (typeof v === "string" && v.trim()) return v.trim().slice(0, 20);
  if (claimType === "DISPUTED_TERRITORY") return "국가 공인 입장";
  if (claimType === "OPINION") return "의견/견해";
  return "팩트체크";
}

function cfClaim(c: unknown) {
  const DEF = {
    claim: "본문 내 주요 주장", claim_type: "EMPIRICAL" as typeof CF_CLAIM_TYPES[number],
    judgment_basis: "팩트체크", verdict: "근거 부족" as Verdict, confidence: 50,
    reasoning: "", supporting_points: [] as string[], counter_points: [] as string[],
    unknowns: [] as string[], suggested_sources: [] as { name: string; type: string }[],
  };
  if (typeof c === "string") return { ...DEF, claim: c.slice(0, 200) };
  if (!c || typeof c !== "object") return DEF;
  const o = c as Record<string, unknown>;
  const claimType = cfCT(o.claim_type ?? o.claimType ?? o.type);
  return {
    claim: cfS(o.claim ?? o.주장 ?? o.content ?? o.text ?? "본문 내 주요 주장", 200),
    claim_type: claimType,
    judgment_basis: cfJB(o.judgment_basis ?? o.judgmentBasis ?? o.basis, claimType),
    verdict: claimType === "OPINION" ? "근거 부족" as Verdict : cfV(o.verdict ?? o.판정 ?? o.result ?? o.rating ?? o.stage1_result),
    confidence: cfN(o.confidence ?? o.신뢰도 ?? o.score ?? o.certainty),
    reasoning: cfS(o.reasoning ?? o.reason ?? o.이유 ?? o.explanation ?? o.analysis ?? "", 500),
    supporting_points: cfA(o.supporting_points ?? o.supportingPoints ?? o.support ?? o.지지 ?? o.evidence),
    counter_points: cfA(o.counter_points ?? o.counterPoints ?? o.counter ?? o.반박 ?? o.opposition),
    unknowns: cfA(o.unknowns ?? o.unknown ?? o.uncertain),
    suggested_sources: cfSrc(o.suggested_sources ?? o.suggestedSources ?? o.sources ?? o.출처 ?? o.references),
  };
}

export function buildAnalysisFromCF(obj: Record<string, unknown>) {
  const root = (obj.analysis ?? obj.result ?? obj.data ?? obj) as Record<string, unknown>;
  let raw = root.claims ?? root.분석결과 ?? root.주장들 ?? root.items ?? [];
  if (!Array.isArray(raw)) {
    raw = typeof raw === "object" && raw
      ? Object.values(raw as Record<string, unknown>)
      : [];
  }
  const claims = (raw as unknown[]).slice(0, 7).map(cfClaim).filter(c => c.claim.length > 0);

  // Flat single-claim format: { verdict, claim_type, reasoning, ... } → treat root as a claim
  if (claims.length === 0 && (root.verdict ?? obj.verdict)) {
    const flatClaim = cfClaim(root);
    if (flatClaim.claim === "본문 내 주요 주장") {
      const stages = root.stages ?? root.stage2 ?? root.signals;
      if (Array.isArray(stages) && stages.length > 0) {
        const first = stages[0];
        const stageText = typeof first === "string"
          ? first
          : cfS((first as Record<string, unknown>)?.result ?? (first as Record<string, unknown>)?.claim ?? "", 200);
        if (stageText) flatClaim.claim = stageText;
      }
    }
    claims.push(flatClaim);
  }
  if (claims.length === 0) claims.push(cfClaim(null));

  const overallVerdict = cfV(
    root.overall_verdict ?? obj.overall_verdict ?? root.verdict ?? obj.verdict,
  );
  const overallConf = cfN(
    root.overall_confidence ?? obj.overall_confidence ?? root.confidence ?? obj.confidence,
  );

  let summary = cfS(root.summary ?? obj.summary ?? "", 500);
  if (!summary) {
    const first = claims[0];
    if (first.reasoning) {
      summary = first.reasoning.slice(0, 200);
    } else if (first.claim !== "본문 내 주요 주장") {
      summary = `분석 결과: ${overallVerdict}. ${first.claim.slice(0, 100)}`;
    } else {
      const confLabel = overallConf >= 70 ? "높은 확신" : overallConf >= 50 ? "중간 확신" : "낮은 확신";
      summary = `AI 분석 결과: ${overallVerdict} (${confLabel}, ${overallConf}%)`;
    }
  }

  return {
    title: cfS(root.title ?? obj.title ?? "분석 결과", 20),
    summary,
    overall_verdict: overallVerdict,
    overall_confidence: overallConf,
    claims,
  };
}

export function buildQuickFromCF(obj: Record<string, unknown>) {
  let rawH = obj.highlights ?? obj.claims ?? obj.주장 ?? obj.items ?? [];
  if (!Array.isArray(rawH)) rawH = [];
  const highlights = (rawH as unknown[]).slice(0, 3).map(h => {
    if (typeof h === "string") {
      return { claim: h.slice(0, 150), verdict: "근거 부족" as Verdict, confidence: 50, brief: "", supporting: "", counter: "" };
    }
    if (!h || typeof h !== "object") {
      return { claim: "주요 주장", verdict: "근거 부족" as Verdict, confidence: 50, brief: "", supporting: "", counter: "" };
    }
    const o = h as Record<string, unknown>;
    return {
      claim: cfS(o.claim ?? o.주장 ?? o.content ?? "주요 주장", 150),
      verdict: cfV(o.verdict ?? o.판정 ?? o.result),
      confidence: cfN(o.confidence ?? o.신뢰도),
      brief: cfS(o.brief ?? o.reasoning ?? o.이유 ?? o.explanation ?? "", 200),
      supporting: cfS(o.supporting ?? o.support ?? o.지지 ?? "", 150),
      counter: cfS(o.counter ?? o.opposition ?? o.반박 ?? "", 150),
    };
  });
  const rawF = obj.risk_flags ?? obj.riskFlags ?? obj.위험 ?? obj.flags ?? [];
  return {
    summary: cfS(obj.summary ?? obj.요약 ?? "", 200),
    overall_verdict: cfV(obj.overall_verdict ?? obj.overall ?? obj.판정),
    overall_confidence: cfN(obj.overall_confidence ?? obj.confidence),
    highlights,
    risk_flags: (Array.isArray(rawF) ? rawF : []).slice(0, 4).map(f => cfS(f, 50)),
  };
}

export function parseCFResponse(raw: string, hint: "analysis" | "quick"): unknown {
  // CF AI가 OpenAI-style JSON 문자열로 반환하는 경우: {"choices":[{"message":{"content":"..."}}]}
  const firstBrace = raw.trimStart().startsWith("{");
  if (firstBrace) {
    try {
      const wrapper = JSON.parse(raw) as Record<string, unknown>;
      const content = (wrapper?.choices as any)?.[0]?.message?.content;
      if (typeof content === "string") raw = content;
    } catch { /* not JSON wrapper */ }
  }

  let s = raw.replace(/^```(?:json)?\s*/im, "").replace(/\s*```\s*$/im, "").trim();

  // Top-level array: [{ claim, verdict, ... }, ...] → wrap as { claims: [...] }
  const arrStart = s.indexOf("[");
  const objStart = s.indexOf("{");
  if (arrStart !== -1 && (objStart === -1 || arrStart < objStart)) {
    const arrEnd = s.lastIndexOf("]");
    if (arrEnd !== -1) {
      try {
        const arr = JSON.parse(s.slice(arrStart, arrEnd + 1)) as unknown[];
        if (Array.isArray(arr) && arr.length > 0) {
          return hint === "analysis"
            ? buildAnalysisFromCF({ claims: arr })
            : buildQuickFromCF({ highlights: arr });
        }
      } catch { /* fall through to object parsing */ }
    }
  }

  if (objStart > 0) s = s.slice(objStart);
  const en = s.lastIndexOf("}");
  if (en !== -1) s = s.slice(0, en + 1);
  try {
    const obj = JSON.parse(s) as Record<string, unknown>;
    return hint === "analysis" ? buildAnalysisFromCF(obj) : buildQuickFromCF(obj);
  } catch {
    return hint === "analysis" ? buildAnalysisFromCF({}) : buildQuickFromCF({});
  }
}

export const CF_JSON_HINT = `\n\n[출력] 마크다운 없이 순수 JSON 객체만. 판정은 "사실"|"부분 사실"|"근거 부족"|"반대 근거 우세" 중 하나.`;
