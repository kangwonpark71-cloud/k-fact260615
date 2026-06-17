import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useCallback, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  MessageSquare, Send, Trash2, RefreshCw, Sparkles,
  CheckCircle2, XCircle, MinusCircle, HelpCircle, AlertCircle,
  ThumbsUp, ThumbsDown, TriangleAlert, Users, Download, Loader2,
} from "lucide-react";

import { quickAnalyzeContent, type QuickCheckResult } from "@/lib/analyses.functions";
import { SiteHeader, BottomNav } from "@/components/SiteHeader";

export const Route = createFileRoute("/live")({
  head: () => ({
    meta: [
      { title: "대화 분석 — K-Fact" },
      { name: "description", content: "실시간 대화를 문장 단위로 팩트체크하고 기록합니다." },
    ],
  }),
  component: LivePage,
});

/* ── 타입 ── */
type Speaker = "화자 A" | "화자 B" | "화자 C" | "화자 D";
const SPEAKERS: Speaker[] = ["화자 A", "화자 B", "화자 C", "화자 D"];

const SPEAKER_STYLE: Record<Speaker, { badge: string; bubble: string; dot: string }> = {
  "화자 A": {
    badge: "bg-blue-500/20 border-blue-400/40 text-blue-400",
    bubble: "border-blue-400/20 bg-blue-500/5",
    dot: "bg-blue-400",
  },
  "화자 B": {
    badge: "bg-emerald-500/20 border-emerald-400/40 text-emerald-400",
    bubble: "border-emerald-400/20 bg-emerald-500/5",
    dot: "bg-emerald-400",
  },
  "화자 C": {
    badge: "bg-amber-500/20 border-amber-400/40 text-amber-400",
    bubble: "border-amber-400/20 bg-amber-500/5",
    dot: "bg-amber-400",
  },
  "화자 D": {
    badge: "bg-rose-500/20 border-rose-400/40 text-rose-400",
    bubble: "border-rose-400/20 bg-rose-500/5",
    dot: "bg-rose-400",
  },
};

const VERDICT_META = {
  "사실": { icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-400/10 border-emerald-400/30", label: "사실" },
  "부분 사실": { icon: MinusCircle, color: "text-yellow-400", bg: "bg-yellow-400/10 border-yellow-400/30", label: "부분 사실" },
  "근거 부족": { icon: HelpCircle, color: "text-orange-400", bg: "bg-orange-400/10 border-orange-400/30", label: "근거 부족" },
  "반대 근거 우세": { icon: XCircle, color: "text-red-400", bg: "bg-red-400/10 border-red-400/30", label: "반대 근거 우세" },
  "미확인": { icon: AlertCircle, color: "text-muted-foreground", bg: "bg-border/20 border-border/40", label: "미확인" },
} as const;

type Utterance = {
  id: string;
  speaker: Speaker;
  text: string;
  time: string;
  checking: boolean;
  result: QuickCheckResult | null;
  error: string | null;
};

/* ── 컴포넌트 ── */
function LivePage() {
  const doQuickCheck = useServerFn(quickAnalyzeContent);

  const [speaker, setSpeaker] = useState<Speaker>("화자 A");
  const [input, setInput] = useState("");
  const [utterances, setUtterances] = useState<Utterance[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 새 발언 추가 시 스크롤
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [utterances.length]);

  const addUtterance = useCallback(async () => {
    const text = input.trim();
    if (!text || submitting) return;

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

    const entry: Utterance = { id, speaker, text, time: now, checking: true, result: null, error: null };
    setUtterances(prev => [...prev, entry]);
    setInput("");
    setSubmitting(true);
    textareaRef.current?.focus();

    try {
      const result = await doQuickCheck({ data: { text } });
      setUtterances(prev =>
        prev.map(u => u.id === id ? { ...u, checking: false, result } : u),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "분석 실패";
      setUtterances(prev =>
        prev.map(u => u.id === id ? { ...u, checking: false, error: msg.slice(0, 80) } : u),
      );
    } finally {
      setSubmitting(false);
    }
  }, [input, speaker, submitting, doQuickCheck]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      addUtterance();
    }
  };

  // 텍스트 내보내기 (간단한 텍스트 파일)
  const handleExport = () => {
    if (utterances.length === 0) return;
    const lines = utterances.map(u => {
      const verdict = u.result
        ? `[${u.result.overall_verdict} ${u.result.overall_confidence}%]`
        : u.error ? "[분석 실패]" : "[분석 중]";
      return `[${u.time}] ${u.speaker}: ${u.text}\n  → ${verdict}${u.result?.summary ? " " + u.result.summary : ""}`;
    });
    const blob = new Blob([lines.join("\n\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `대화분석_${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 발언 통계
  const stats = utterances.reduce<Record<Speaker, number>>((acc, u) => {
    acc[u.speaker] = (acc[u.speaker] ?? 0) + 1;
    return acc;
  }, {} as Record<Speaker, number>);

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <BottomNav />

      <main className="flex-1 max-w-3xl mx-auto w-full px-4 sm:px-6 pt-6 pb-36 sm:pb-24 flex flex-col gap-4">

        {/* 페이지 헤더 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-yellow-400 grid place-items-center shadow-lg shadow-amber-400/30">
              <MessageSquare className="w-5 h-5 text-amber-950" />
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight">실시간 대화 팩트체크</h1>
              <p className="text-xs text-muted-foreground">발언을 입력하면 문장 단위로 즉시 검증합니다</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {utterances.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={handleExport}
                  title="결과 내보내기"
                  className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
                >
                  <Download className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setUtterances([])}
                  title="전체 초기화"
                  className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* 화자 선택 + 통계 */}
        <div className="glass rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Users className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="text-xs font-semibold text-muted-foreground tracking-wide">화자 선택</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {SPEAKERS.map(sp => {
              const style = SPEAKER_STYLE[sp];
              const isActive = speaker === sp;
              const count = stats[sp] ?? 0;
              return (
                <button
                  key={sp}
                  type="button"
                  onClick={() => setSpeaker(sp)}
                  className={`relative flex items-center justify-between px-3 py-2.5 rounded-xl border text-sm font-semibold transition-all ${
                    isActive
                      ? `${style.badge} scale-[1.02] shadow-md`
                      : "border-border/40 text-muted-foreground hover:border-border hover:bg-surface-2/50"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${isActive ? style.dot : "bg-muted-foreground/30"}`} />
                    {sp}
                  </div>
                  {count > 0 && (
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isActive ? "bg-white/20" : "bg-border/40 text-muted-foreground"}`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* 입력 영역 */}
        <div className="glass rounded-2xl p-4 space-y-3">
          <div className="flex items-start gap-3">
            <span className={`shrink-0 mt-0.5 text-xs font-bold px-2.5 py-1 rounded-full border ${SPEAKER_STYLE[speaker].badge}`}>
              {speaker}
            </span>
            <textarea
              ref={textareaRef}
              rows={2}
              placeholder="발언 내용을 입력하세요 (Enter로 추가, Shift+Enter로 줄바꿈)"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={submitting}
              className="flex-1 bg-transparent outline-none resize-none text-sm placeholder:text-muted-foreground/50 leading-relaxed disabled:opacity-60"
            />
          </div>
          <div className="flex items-center justify-between border-t border-border/40 pt-3">
            <span className="text-[11px] text-muted-foreground/60">
              {input.length}자 · Enter로 추가
            </span>
            <button
              type="button"
              onClick={addUtterance}
              disabled={!input.trim() || submitting}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 text-amber-950 text-sm font-bold shadow-md shadow-amber-400/30 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-95"
            >
              {submitting ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> 분석 중…</>
              ) : (
                <><Send className="w-4 h-4" /> 추가</>
              )}
            </button>
          </div>
        </div>

        {/* 발언 목록 */}
        {utterances.length === 0 ? (
          <div className="glass rounded-2xl p-10 text-center">
            <MessageSquare className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground mb-1">아직 발언이 없습니다</p>
            <p className="text-xs text-muted-foreground/60">화자를 선택하고 발언을 입력하세요</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 px-1">
              <Sparkles className="w-3.5 h-3.5 text-accent shrink-0" />
              <span className="text-xs font-semibold text-muted-foreground tracking-wide">
                대화 기록 ({utterances.length}건)
              </span>
              {utterances.some(u => u.checking) && (
                <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
                  <RefreshCw className="w-3 h-3 animate-spin" /> 분석 중…
                </span>
              )}
            </div>

            {utterances.map((u, idx) => {
              const style = SPEAKER_STYLE[u.speaker];
              const prevSpeaker = idx > 0 ? utterances[idx - 1].speaker : null;
              const speakerChanged = prevSpeaker !== null && prevSpeaker !== u.speaker;

              return (
                <div key={u.id}>
                  {speakerChanged && (
                    <div className="flex items-center gap-2 my-1 px-1">
                      <div className="flex-1 h-px bg-border/30" />
                      <span className="text-[9px] text-muted-foreground/40 font-medium tracking-wider">
                        화자 전환
                      </span>
                      <div className="flex-1 h-px bg-border/30" />
                    </div>
                  )}
                  <UtteranceCard u={u} style={style} />
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </main>
    </div>
  );
}

/* ── 발언 카드 ── */
function UtteranceCard({
  u,
  style,
}: {
  u: Utterance;
  style: typeof SPEAKER_STYLE["화자 A"];
}) {
  const [expanded, setExpanded] = useState(false);
  const meta = u.result ? (VERDICT_META[u.result.overall_verdict] ?? VERDICT_META["미확인"]) : null;
  const Icon = meta?.icon;

  return (
    <div className={`rounded-2xl border p-4 transition-all ${u.checking ? "border-border/40 bg-background/20" : u.error ? "border-destructive/20 bg-destructive/5" : meta ? `${style.bubble}` : "border-border/40 bg-background/20"}`}>
      {/* 화자 + 시간 */}
      <div className="flex items-start justify-between gap-3 mb-2.5">
        <div className="flex items-center gap-2">
          <span className={`shrink-0 text-xs font-bold px-2.5 py-1 rounded-full border ${style.badge}`}>
            {u.speaker}
          </span>
          <span className="text-[10px] text-muted-foreground/50">{u.time}</span>
        </div>
        {!u.checking && !u.error && u.result && (
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors shrink-0"
          >
            {expanded ? "접기" : "상세"}
          </button>
        )}
      </div>

      {/* 발화 내용 */}
      <p className="text-sm text-foreground/90 leading-relaxed mb-2.5">
        {u.text}
      </p>

      {/* 상태별 결과 */}
      {u.checking && (
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
          팩트체크 중…
        </div>
      )}

      {u.error && !u.checking && (
        <p className="text-[11px] text-destructive">{u.error}</p>
      )}

      {u.result && meta && Icon && (
        <div className="space-y-2">
          {/* 판정 배지 + 신뢰도 */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold ${meta.bg} ${meta.color}`}>
              <Icon className="w-3.5 h-3.5" />
              {meta.label}
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-20 h-1.5 rounded-full bg-border/50 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${meta.color.replace("text-", "bg-")}`}
                  style={{ width: `${u.result.overall_confidence}%`, opacity: 0.8 }}
                />
              </div>
              <span className="text-xs text-muted-foreground tabular-nums">{u.result.overall_confidence}%</span>
            </div>
          </div>

          {/* 요약 */}
          {u.result.summary && (
            <p className="text-xs text-muted-foreground leading-relaxed">{u.result.summary}</p>
          )}

          {/* 위험 신호 */}
          {u.result.risk_flags.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              <TriangleAlert className="w-3 h-3 text-orange-400 shrink-0" />
              {u.result.risk_flags.map((f, i) => (
                <span key={i} className="text-[10px] text-orange-400 bg-orange-400/10 border border-orange-400/20 px-1.5 py-0.5 rounded-full">
                  {f}
                </span>
              ))}
            </div>
          )}

          {/* 상세 펼치기: 주장별 카드 */}
          {expanded && u.result.highlights.length > 0 && (
            <div className="mt-3 space-y-2 border-t border-border/30 pt-3">
              <span className="text-[10px] font-semibold text-muted-foreground tracking-wide">주장별 분석</span>
              {u.result.highlights.map((h, i) => {
                const hm = VERDICT_META[h.verdict] ?? VERDICT_META["미확인"];
                const HIcon = hm.icon;
                return (
                  <div key={i} className={`rounded-xl border px-3 py-2.5 ${hm.bg}`}>
                    <div className="flex items-start gap-2 mb-1">
                      <HIcon className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${hm.color}`} />
                      <p className="text-xs font-medium leading-relaxed flex-1">{h.claim}</p>
                    </div>
                    {h.brief && (
                      <p className="text-[11px] text-muted-foreground ml-5 leading-relaxed mb-1.5">{h.brief}</p>
                    )}
                    {(h.supporting || h.counter) && (
                      <div className="ml-5 space-y-1">
                        {h.supporting && (
                          <div className="flex items-start gap-1.5">
                            <ThumbsUp className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" />
                            <span className="text-[10px] text-emerald-400 leading-relaxed">{h.supporting}</span>
                          </div>
                        )}
                        {h.counter && (
                          <div className="flex items-start gap-1.5">
                            <ThumbsDown className="w-3 h-3 text-red-400 shrink-0 mt-0.5" />
                            <span className="text-[10px] text-red-400 leading-relaxed">{h.counter}</span>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 mt-2 ml-5">
                      <span className={`text-[10px] font-semibold ${hm.color}`}>{hm.label}</span>
                      <div className="w-14 h-1 rounded-full bg-border/50 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${hm.color.replace("text-", "bg-")}`}
                          style={{ width: `${h.confidence}%`, opacity: 0.7 }}
                        />
                      </div>
                      <span className="text-[10px] text-muted-foreground">{h.confidence}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
