import { useState } from "react";
import {
  ChevronDown, ChevronUp, Search, Globe, Cpu,
  Scale, AlertTriangle, CheckCircle2, Lock, ShieldOff, Shield,
  Clock, BarChart2, FileSearch, Brain, Layers, Activity,
  TrendingUp, TrendingDown, Zap, AlertOctagon,
} from "lucide-react";

import { type PropagandaTechnique, type StyleClassification, type ExternalFactCheck } from "@/lib/factcheck.types";

export type { PropagandaTechnique, StyleClassification, ExternalFactCheck };

export type AuditLog = {
  phase1?: {
    model: string;
    completed_at: string;
    fake_probability: number;
    style_signals: string[];
  };
  phase2?: {
    model: string;
    completed_at: string;
    search_queries: string[];
    sources_reviewed: Array<{ url: string; title?: string }>;
    evidence_count: number;
  };
  weights?: {
    fact_match_pct: number;
    source_transparency_pct: number;
    context_completeness_pct: number;
  };
};

type IntegrityStatus = "valid" | "invalid" | "unsigned" | "checking";

interface Props {
  auditLog: AuditLog | null;
  integrity: IntegrityStatus;
  styleClassification?: StyleClassification | null;
  externalChecks?: ExternalFactCheck[];
  onLoadExternal?: () => void;
  externalLoading?: boolean;
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h4 className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground uppercase tracking-widest">
        <span className="text-primary/70">{icon}</span>
        {title}
      </h4>
      {children}
    </div>
  );
}

function IntegrityBadge({ status }: { status: IntegrityStatus }) {
  if (status === "checking") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground">
        <Clock className="w-3 h-3 animate-spin" /> 검증 중…
      </span>
    );
  }
  if (status === "valid") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-verdict-true/15 text-verdict-true border border-verdict-true/30">
        <CheckCircle2 className="w-3 h-3" /> 결과 서명 확인됨
      </span>
    );
  }
  if (status === "invalid") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-destructive/15 text-destructive border border-destructive/30">
        <ShieldOff className="w-3 h-3" /> 결과 변조 가능성 감지
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-muted/60 text-muted-foreground border border-border/40">
      <Lock className="w-3 h-3" /> 서명 미적용
    </span>
  );
}

/* ── 신뢰도 바 ── */
function ScoreBar({ label, value, color, inverse = false }: { label: string; value: number; color: string; inverse?: boolean }) {
  const display = inverse ? (100 - value) : value;
  const barColor = inverse
    ? (value >= 70 ? "bg-destructive" : value >= 40 ? "bg-yellow-500" : "bg-verdict-true")
    : (value >= 70 ? "bg-verdict-true" : value >= 40 ? "bg-yellow-500" : "bg-destructive");
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-28 shrink-0 text-muted-foreground">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-border overflow-hidden">
        <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${value}%` }} />
      </div>
      <span className={`w-7 text-right font-mono text-[10px] ${display >= 70 ? color : "text-muted-foreground"}`}>{value}</span>
    </div>
  );
}

/* ── 스타일 카테고리 배지 ── */
const STYLE_CAT_COLORS: Record<string, string> = {
  "사실보도":       "bg-verdict-true/15 text-verdict-true border-verdict-true/40",
  "학술/공식문서":  "bg-verdict-true/15 text-verdict-true border-verdict-true/40",
  "의견/칼럼":      "bg-verdict-partial/15 text-verdict-partial border-verdict-partial/40",
  "과장/클릭베이트":"bg-yellow-500/15 text-yellow-500 border-yellow-500/40",
  "여론조작/선동":  "bg-destructive/15 text-destructive border-destructive/40",
  "허위정보":       "bg-destructive/15 text-destructive border-destructive/40",
};

function StyleClassificationPanel({ sc }: { sc: StyleClassification }) {
  const [showTech, setShowTech] = useState(false);
  const catColor = STYLE_CAT_COLORS[sc.style_category] ?? "bg-muted text-muted-foreground border-border";
  const credColor = sc.credibility_score >= 70 ? "text-verdict-true" : sc.credibility_score >= 40 ? "text-yellow-500" : "text-destructive";
  const fpColor   = sc.fake_probability  >= 70 ? "text-destructive"  : sc.fake_probability  >= 40 ? "text-yellow-500" : "text-verdict-true";

  return (
    <div className="space-y-4">
      {/* 요약 헤더 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${catColor}`}>
          <Layers className="w-3 h-3" /> {sc.style_category}
        </span>
        <span className="text-xs text-muted-foreground border border-border/40 px-2 py-0.5 rounded-full">
          {sc.tone}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          신뢰도 <span className={`font-mono font-bold ${credColor}`}>{sc.credibility_score}</span>
          <span className="mx-1">/</span>
          가짜확률 <span className={`font-mono font-bold ${fpColor}`}>{sc.fake_probability}%</span>
        </span>
      </div>

      {/* 언어학적 지표 */}
      <div>
        <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest mb-2 flex items-center gap-1.5">
          <Activity className="w-3 h-3" /> 언어학적 지표 (LIWC 기반)
        </p>
        <div className="space-y-1.5">
          <ScoreBar label="어휘 풍부도" value={sc.linguistic_features?.vocabulary_richness ?? 50}   color="text-verdict-true" />
          <ScoreBar label="논증 일관성" value={sc.linguistic_features?.argument_coherence    ?? 50} color="text-verdict-true" />
          <ScoreBar label="출처 귀속"   value={sc.linguistic_features?.source_attribution    ?? 50} color="text-verdict-true" />
          <ScoreBar label="문장 복잡도" value={sc.linguistic_features?.sentence_complexity   ?? 50} color="text-muted-foreground" />
          <ScoreBar label="감정어 밀도" value={sc.linguistic_features?.emotional_density     ?? 50} color="text-yellow-500" inverse />
        </div>
      </div>

      {/* 기만 리스크 지표 */}
      <div>
        <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest mb-2 flex items-center gap-1.5">
          <AlertOctagon className="w-3 h-3" /> 기만 리스크 (NELA-GT 기반)
        </p>
        <div className="space-y-1.5">
          <ScoreBar label="감정 조작"   value={sc.deception_risk.emotional_manipulation} color="text-destructive" inverse />
          <ScoreBar label="허위 긴박감" value={sc.deception_risk.urgency_framing}        color="text-destructive" inverse />
          <ScoreBar label="미검증 통계" value={sc.deception_risk.unverified_statistics}  color="text-destructive" inverse />
          <ScoreBar label="분열 언어"   value={sc.deception_risk.polarizing_language}    color="text-destructive" inverse />
        </div>
      </div>

      {/* 선동 기법 (SemEval-2020) */}
      {sc.propaganda_techniques.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowTech(v => !v)}
            className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest hover:text-foreground transition-colors"
          >
            <Zap className="w-3 h-3" />
            탐지된 선동 기법 — SemEval-2020 ({sc.propaganda_techniques.length}건)
            {showTech ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {showTech && (
            <div className="mt-2 space-y-1.5">
              {sc.propaganda_techniques.map((t, i) => (
                <div key={i} className="rounded-lg border border-destructive/20 bg-destructive/5 px-2.5 py-1.5">
                  <p className="text-xs font-semibold text-destructive">{t.name}</p>
                  {t.evidence && <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{t.evidence}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* AI 판단 근거 */}
      {sc.reasoning && (
        <p className="text-xs text-muted-foreground leading-relaxed border-t border-border/30 pt-3 italic">
          {sc.reasoning}
        </p>
      )}
    </div>
  );
}

export function AuditTrailPanel({ auditLog, integrity, styleClassification, externalChecks, onLoadExternal, externalLoading }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border border-border/60 overflow-hidden">
      {/* 헤더 토글 */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-surface-2/50 transition-colors"
      >
        <span className="flex items-center gap-2">
          <FileSearch className="w-4 h-4 text-primary/70" />
          판단 과정 보기
          <IntegrityBadge status={integrity} />
        </span>
        {open
          ? <ChevronUp className="w-4 h-4 shrink-0" />
          : <ChevronDown className="w-4 h-4 shrink-0" />}
      </button>

      {open && (
        <div className="border-t border-border/50 px-4 py-4 space-y-5 bg-background/30">

          {/* ── 트랜스포머 문체 분류 ── */}
          {styleClassification && (
            <Section title="AI 문체 분류 (트랜스포머 기반)" icon={<Brain className="w-3.5 h-3.5" />}>
              <StyleClassificationPanel sc={styleClassification} />
            </Section>
          )}

          {/* ── 판정 가중치 ── */}
          <Section title="판정 가중치 기준" icon={<Scale className="w-3.5 h-3.5" />}>
            <div className="space-y-1.5">
              {[
                { label: "사실 일치도", pct: auditLog?.weights?.fact_match_pct ?? 50, color: "bg-primary" },
                { label: "출처 투명성", pct: auditLog?.weights?.source_transparency_pct ?? 30, color: "bg-accent" },
                { label: "맥락 완전성", pct: auditLog?.weights?.context_completeness_pct ?? 20, color: "bg-muted-foreground/50" },
              ].map(({ label, pct, color }) => (
                <div key={label} className="flex items-center gap-2 text-xs">
                  <span className="w-24 text-muted-foreground shrink-0">{label}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-border overflow-hidden">
                    <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-8 text-right font-mono text-muted-foreground">{pct}%</span>
                </div>
              ))}
            </div>
          </Section>

          {/* ── 1단계 AI 분석 ── */}
          {auditLog?.phase1 && (
            <Section title="1단계 분석 (학습 지식 기반)" icon={<Cpu className="w-3.5 h-3.5" />}>
              <div className="text-xs space-y-1.5 text-muted-foreground">
                <div className="flex gap-2">
                  <span className="text-foreground/60 shrink-0">사용 모델</span>
                  <span className="font-mono">{auditLog.phase1.model}</span>
                </div>
                {auditLog.phase1.fake_probability > 0 && (
                  <div className="flex gap-2">
                    <span className="text-foreground/60 shrink-0">가짜 가능성 지수</span>
                    <span className={`font-semibold ${auditLog.phase1.fake_probability >= 60 ? "text-destructive" : auditLog.phase1.fake_probability >= 30 ? "text-yellow-500" : "text-verdict-true"}`}>
                      {auditLog.phase1.fake_probability}%
                    </span>
                  </div>
                )}
                {auditLog.phase1.style_signals && auditLog.phase1.style_signals.length > 0 && (
                  <div className="flex gap-2 flex-wrap pt-1">
                    <span className="text-foreground/60 shrink-0 leading-5">탐지된 신호</span>
                    <div className="flex flex-wrap gap-1">
                      {auditLog.phase1.style_signals.map((s, i) => (
                        <span key={i} className="px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 text-[10px] border border-yellow-500/20">
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* ── 2단계 AI 분析 ── */}
          {auditLog?.phase2 && (
            <Section title="2단계 분析 (Tavily 검색 기반)" icon={<Search className="w-3.5 h-3.5" />}>
              <div className="text-xs space-y-2 text-muted-foreground">
                <div className="flex gap-2">
                  <span className="text-foreground/60 shrink-0">사용 모델</span>
                  <span className="font-mono">{auditLog.phase2.model}</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-foreground/60 shrink-0">검색 증거 수</span>
                  <span className="font-semibold text-foreground/80">{auditLog.phase2.evidence_count}건</span>
                </div>
                {auditLog.phase2.search_queries.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-foreground/60">사용된 검색어</p>
                    <div className="space-y-1">
                      {auditLog.phase2.search_queries.map((q, i) => (
                        <div key={i} className="flex items-start gap-1.5">
                          <Search className="w-3 h-3 mt-0.5 shrink-0 text-primary/50" />
                          <span className="break-all">{q}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {auditLog.phase2.sources_reviewed.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-foreground/60">검토한 출처 ({auditLog.phase2.sources_reviewed.length}건)</p>
                    <div className="space-y-0.5 max-h-36 overflow-y-auto">
                      {auditLog.phase2.sources_reviewed.map((s, i) => (
                        <a
                          key={i}
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 text-primary/70 hover:text-primary hover:underline truncate"
                        >
                          <Globe className="w-3 h-3 shrink-0" />
                          <span className="truncate">{s.url}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* ── 외부 기관 교차 확인 ── */}
          <Section title="공인 팩트체크 기관 교차 확인" icon={<Shield className="w-3.5 h-3.5" />}>
            {externalChecks && externalChecks.length > 0 ? (
              <div className="space-y-2">
                {externalChecks.map((ec, i) => (
                  <div key={i} className="rounded-lg border border-border/50 p-2.5 space-y-1 text-xs">
                    <p className="text-foreground/80 font-medium leading-snug">{ec.claim_text}</p>
                    <div className="flex items-center gap-2 text-muted-foreground flex-wrap">
                      <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-semibold">{ec.rating}</span>
                      <span>{ec.publisher}</span>
                      {ec.claimant && <span>· 주장자: {ec.claimant}</span>}
                    </div>
                    {ec.review_url && (
                      <a
                        href={ec.review_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary/70 hover:text-primary hover:underline text-[11px]"
                      >
                        원문 팩트체크 보기 →
                      </a>
                    )}
                  </div>
                ))}
              </div>
            ) : externalChecks && externalChecks.length === 0 ? (
              <p className="text-xs text-muted-foreground">등록된 외부 팩트체크 결과가 없습니다.</p>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onLoadExternal}
                  disabled={externalLoading}
                  className="flex items-center gap-1.5 text-xs text-primary hover:underline disabled:opacity-50"
                >
                  {externalLoading
                    ? <><BarChart2 className="w-3 h-3 animate-pulse" /> 확인 중…</>
                    : <><Globe className="w-3 h-3" /> Google Fact Check 교차 확인하기</>}
                </button>
                <span className="text-[10px] text-muted-foreground">(SNU 팩트체크·Google FC Tools)</span>
              </div>
            )}
          </Section>

          {/* ── 무결성 상태 설명 ── */}
          {integrity === "invalid" && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <p>
                결과의 HMAC 서명이 일치하지 않습니다. 데이터베이스 직접 변조 가능성이 있습니다.
                관리자에게 문의하거나 분析을 다시 실행하세요.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
