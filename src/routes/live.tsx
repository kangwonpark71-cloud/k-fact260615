import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useRef, useCallback, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  MessageSquare, Trash2, RefreshCw,
  CheckCircle2, XCircle, MinusCircle, HelpCircle,
  ThumbsDown, TriangleAlert, Download,
  Mic, Square, MicOff, Send, Radio, ExternalLink, Newspaper,
  Users, Trophy, Eye, X, Printer, Copy, Check,
  ChevronDown, ChevronUp, BarChart3,
} from "lucide-react";
import { toast } from "sonner";

import { quickAnalyzeContent, type QuickCheckResult, type NaverFactCheckItem, type DaumFactCheckItem, type FakeDetail, type MatchedFakeCase } from "@/lib/analyses.functions";
import { SiteHeader, BottomNav } from "@/components/SiteHeader";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/live")({
  validateSearch: (search: Record<string, unknown>) => ({
    room:   typeof search.room === "string" ? search.room : undefined,
    viewer: search.viewer === "1" || search.viewer === true || search.viewer === 1,
  }),
  head: () => ({
    meta: [
      { title: "대화 분석 — 팩트체크" },
      { name: "description", content: "실시간 대화를 음성으로 자동 기록하고 팩트체크합니다." },
    ],
  }),
  component: LivePage,
});

/* ══════════════════════════════════════
   타입 & 상수
   ══════════════════════════════════════ */
type Speaker = "화자 A" | "화자 B" | "화자 C" | "화자 D";
const SPEAKERS: Speaker[] = ["화자 A", "화자 B", "화자 C", "화자 D"];

const SPEAKER_STYLE: Record<Speaker, { badge: string; ring: string; bar: string }> = {
  "화자 A": { badge: "bg-blue-500/20 border-blue-400/40 text-blue-400",          ring: "ring-blue-400/40",    bar: "#60a5fa" },
  "화자 B": { badge: "bg-emerald-500/20 border-emerald-400/40 text-emerald-400", ring: "ring-emerald-400/40", bar: "#34d399" },
  "화자 C": { badge: "bg-amber-500/20 border-amber-400/40 text-amber-400",       ring: "ring-amber-400/40",   bar: "#fbbf24" },
  "화자 D": { badge: "bg-rose-500/20 border-rose-400/40 text-rose-400",          ring: "ring-rose-400/40",    bar: "#fb7185" },
};

type Utterance = {
  id: string;
  speaker: Speaker;
  text: string;
  time: string;
  checking: boolean;
  result: QuickCheckResult | null;
  error: string | null;
};

/* ══════════════════════════════════════
   Feature 4: 화자 신뢰 프로파일
   ══════════════════════════════════════ */
type SpeakerStat = {
  speaker: Speaker;
  total: number;
  checked: number;
  trueCount: number;
  partialCount: number;
  insufficientCount: number;
  falseCount: number;
  trustScore: number;   // 0-100, -1 = 미집계
  history: number[];    // 시간순 신뢰도 이력
};

function calcSpeakerStats(utterances: Utterance[]): SpeakerStat[] {
  return SPEAKERS.map(speaker => {
    const mine = utterances.filter(u => u.speaker === speaker);
    if (mine.length === 0) return null;
    const done          = mine.filter(u => u.result);
    const trueCount     = done.filter(u => u.result?.overall_verdict === "사실").length;
    const partialCount  = done.filter(u => u.result?.overall_verdict === "부분 사실").length;
    const insufficientCount = done.filter(u => u.result?.overall_verdict === "근거 부족").length;
    const falseCount    = done.filter(u => u.result?.overall_verdict === "반대 근거 우세").length;
    const trustScore    = done.length === 0 ? -1
      : Math.round((trueCount * 100 + partialCount * 65 + insufficientCount * 30) / (done.length * 100) * 100);
    const history: number[] = [];
    let run = 0, cnt = 0;
    mine.filter(u => u.result).forEach(u => {
      const w = u.result?.overall_verdict === "사실" ? 100
        : u.result?.overall_verdict === "부분 사실" ? 65
        : u.result?.overall_verdict === "근거 부족" ? 30 : 0;
      cnt++;
      run = Math.round((run * (cnt - 1) + w) / cnt);
      history.push(run);
    });
    return { speaker, total: mine.length, checked: done.length, trueCount, partialCount, insufficientCount, falseCount, trustScore, history };
  }).filter((s): s is SpeakerStat => s !== null);
}

function SparkLine({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const W = 52, H = 14;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * W},${H - (v / 100) * H}`).join(" ");
  return (
    <svg width={W} height={H} className="shrink-0 opacity-55">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SpeakerTrustPanel({ utterances }: { utterances: Utterance[] }) {
  const stats = calcSpeakerStats(utterances);
  if (stats.length === 0) return null;
  const [open, setOpen] = useState(true);
  return (
    <div className="glass rounded-2xl ring-1 ring-border/25 overflow-hidden">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-2/20 transition-colors">
        <div className="flex items-center gap-2">
          <Trophy className="w-3.5 h-3.5 text-yellow-400" />
          <span className="text-xs font-bold text-foreground/80">화자 신뢰 프로파일</span>
        </div>
        {open
          ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground/50" />
          : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/50" />}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3">
          {stats.map(s => {
            const c = s.trustScore >= 70 ? "#34d399" : s.trustScore >= 40 ? "#fbbf24" : s.trustScore >= 0 ? "#fb7185" : "#777";
            return (
              <div key={s.speaker} className="flex items-start gap-3">
                <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border mt-0.5 ${SPEAKER_STYLE[s.speaker].badge}`}>
                  {s.speaker}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-1.5 flex-wrap text-[10px] text-muted-foreground/60">
                      {s.trueCount > 0         && <span className="text-emerald-400">사실 {s.trueCount}</span>}
                      {s.partialCount > 0      && <span className="text-yellow-400">부분 {s.partialCount}</span>}
                      {s.insufficientCount > 0 && <span>미확인 {s.insufficientCount}</span>}
                      {s.falseCount > 0        && <span className="text-red-400 font-bold">거짓 {s.falseCount}</span>}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <SparkLine data={s.history} color={c} />
                      <span className="text-xs font-bold tabular-nums w-9 text-right" style={{ color: c }}>
                        {s.trustScore >= 0 ? `${s.trustScore}점` : "—"}
                      </span>
                    </div>
                  </div>
                  {s.trustScore >= 0 && (
                    <div className="h-1.5 rounded-full bg-border/30 overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${s.trustScore}%`, background: c }} />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════
   Feature 1: 브리핑 카드
   ══════════════════════════════════════ */
function VerdictDistBar({ v }: { v: { t: number; p: number; i: number; f: number } }) {
  const total = v.t + v.p + v.i + v.f;
  if (total === 0) return null;
  const pct = (n: number) => `${Math.max(Math.round((n / total) * 100), n > 0 ? 4 : 0)}%`;
  return (
    <div className="space-y-2">
      <div className="flex h-3 rounded-full overflow-hidden gap-px">
        {v.t > 0 && <div className="bg-emerald-400/80 transition-all" style={{ width: pct(v.t) }} />}
        {v.p > 0 && <div className="bg-yellow-400/80 transition-all"  style={{ width: pct(v.p) }} />}
        {v.i > 0 && <div className="bg-orange-400/50 transition-all"  style={{ width: pct(v.i) }} />}
        {v.f > 0 && <div className="bg-red-400/80 transition-all"     style={{ width: pct(v.f) }} />}
      </div>
      <div className="flex items-center gap-3 flex-wrap text-[10px]">
        {v.t > 0 && <span className="flex items-center gap-1 text-emerald-400"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80 inline-block" />사실 {v.t}</span>}
        {v.p > 0 && <span className="flex items-center gap-1 text-yellow-400"><span className="w-1.5 h-1.5 rounded-full bg-yellow-400/80 inline-block" />부분 사실 {v.p}</span>}
        {v.i > 0 && <span className="flex items-center gap-1 text-orange-400"><span className="w-1.5 h-1.5 rounded-full bg-orange-400/50 inline-block" />근거 부족 {v.i}</span>}
        {v.f > 0 && <span className="flex items-center gap-1 text-red-400 font-bold"><span className="w-1.5 h-1.5 rounded-full bg-red-400/80 inline-block" />거짓 {v.f}</span>}
      </div>
    </div>
  );
}

function BriefingModal({ utterances, onClose }: { utterances: Utterance[]; onClose: () => void }) {
  const stats   = calcSpeakerStats(utterances);
  const done    = utterances.filter(u => u.result);
  const v       = {
    t: done.filter(u => u.result?.overall_verdict === "사실").length,
    p: done.filter(u => u.result?.overall_verdict === "부분 사실").length,
    i: done.filter(u => u.result?.overall_verdict === "근거 부족").length,
    f: done.filter(u => u.result?.overall_verdict === "반대 근거 우세").length,
  };
  const falseList    = utterances.filter(u => u.result?.overall_verdict === "반대 근거 우세");
  const overallTrust = done.length === 0 ? null
    : Math.round((v.t * 100 + v.p * 65 + v.i * 30) / (done.length * 100) * 100);
  const dateStr = new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
  const timeStr = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="fixed inset-0 z-50 bg-background/97 backdrop-blur overflow-auto">
      <div className="max-w-xl mx-auto px-4 py-8">

        {/* 헤더 */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="text-lg font-bold tracking-tight">팩트체크 세션 브리핑</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{dateStr} {timeStr} · 화자 {stats.length}명</p>
          </div>
          <div className="flex items-center gap-2 print:hidden">
            <button type="button" onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-border/30 text-muted-foreground text-xs hover:bg-surface-2 transition-all">
              <Printer className="w-3 h-3" /> 인쇄
            </button>
            <button type="button" onClick={onClose}
              className="p-1.5 rounded-xl text-muted-foreground hover:bg-surface-2 transition-all">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 요약 타일 */}
        <div className="grid grid-cols-4 gap-2 mb-4">
          {[
            { label: "총 발언", value: String(utterances.length), cls: "text-foreground" },
            { label: "사실",    value: String(v.t),               cls: "text-emerald-400" },
            { label: "거짓",    value: String(v.f),               cls: v.f > 0 ? "text-red-400" : "text-muted-foreground" },
            { label: "신뢰도",  value: overallTrust != null ? `${overallTrust}점` : "—", cls: "text-primary" },
          ].map(tile => (
            <div key={tile.label} className="rounded-xl border border-border/30 bg-surface-2/20 p-3 text-center">
              <div className={`text-xl font-bold tabular-nums ${tile.cls}`}>{tile.value}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">{tile.label}</div>
            </div>
          ))}
        </div>

        {/* 판정 분포 */}
        <div className="rounded-xl border border-border/30 bg-surface-2/20 p-4 mb-3">
          <p className="text-[11px] font-semibold text-foreground/60 mb-2.5 uppercase tracking-wide">판정 분포</p>
          <VerdictDistBar v={v} />
        </div>

        {/* 거짓 발언 */}
        {falseList.length > 0 && (
          <div className="rounded-xl border border-red-400/30 bg-red-400/5 p-4 mb-3">
            <p className="text-[11px] font-bold text-red-400 mb-3 flex items-center gap-1.5 uppercase tracking-wide">
              <XCircle className="w-3.5 h-3.5" /> 거짓 발언 ({falseList.length}건)
            </p>
            <div className="space-y-3">
              {falseList.map(u => (
                <div key={u.id} className="first:pt-0 pt-3 border-t border-red-400/15 first:border-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${SPEAKER_STYLE[u.speaker].badge}`}>
                      {u.speaker}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{u.time}</span>
                    <span className="ml-auto text-[10px] font-bold text-red-400">신뢰도 {u.result?.overall_confidence}%</span>
                  </div>
                  <p className="text-xs text-foreground/88 leading-relaxed">"{u.text}"</p>
                  {u.result?.summary && (
                    <p className="text-[11px] text-muted-foreground/80 mt-1 leading-relaxed">→ {u.result.summary}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 화자별 신뢰도 */}
        {stats.length > 0 && (
          <div className="rounded-xl border border-border/30 bg-surface-2/20 p-4">
            <p className="text-[11px] font-semibold text-foreground/60 mb-3 uppercase tracking-wide">화자별 신뢰도</p>
            <div className="space-y-3">
              {[...stats].sort((a, b) => b.trustScore - a.trustScore).map(s => {
                const c = s.trustScore >= 70 ? "#34d399" : s.trustScore >= 40 ? "#fbbf24" : s.trustScore >= 0 ? "#fb7185" : "#777";
                return (
                  <div key={s.speaker} className="flex items-center gap-3">
                    <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border ${SPEAKER_STYLE[s.speaker].badge}`}>
                      {s.speaker}
                    </span>
                    <div className="flex-1 h-2 rounded-full bg-border/30 overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(s.trustScore, 0)}%`, background: c }} />
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <SparkLine data={s.history} color={c} />
                      <span className="text-xs font-bold tabular-nums w-9 text-right" style={{ color: c }}>
                        {s.trustScore >= 0 ? `${s.trustScore}점` : "—"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <p className="text-center text-[10px] text-muted-foreground/30 mt-6">Generated by K-Fact 팩트체크 AI</p>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════
   Feature 2: 방청석 모드 (Supabase Realtime)
   ══════════════════════════════════════ */
function genRoomId(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function useRoom({
  roomId, isViewer, onReceive,
}: {
  roomId: string | null;
  isViewer: boolean;
  onReceive: (u: Utterance) => void;
}) {
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const cbRef = useRef(onReceive);
  useEffect(() => { cbRef.current = onReceive; }, [onReceive]);

  useEffect(() => {
    if (!roomId) return;
    const ch = supabase.channel(`kfact-live-${roomId}`, {
      config: { broadcast: { self: false } },
    });
    ch.on("broadcast", { event: "utt" }, ({ payload }: { payload: unknown }) => {
      if (payload && typeof payload === "object" && "id" in payload) {
        cbRef.current(payload as Utterance);
      }
    });
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        console.info("[Room] subscribed:", roomId, isViewer ? "(viewer)" : "(host)");
      }
    });
    channelRef.current = ch;
    return () => { supabase.removeChannel(ch); channelRef.current = null; };
  }, [roomId, isViewer]);

  const broadcast = useCallback((u: Utterance) => {
    channelRef.current?.send({ type: "broadcast", event: "utt", payload: u });
  }, []);

  return { broadcast };
}

function RoomBadge({ roomId, onClose }: { roomId: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/live?room=${roomId}&viewer=1`;

  const copy = async () => {
    try { await navigator.clipboard.writeText(url); } catch {}
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
    toast.success("방청석 링크가 복사됐습니다", { description: "공유하면 실시간으로 팩트체크 결과를 볼 수 있습니다" });
  };

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-primary bg-primary/10 border border-primary/25 px-2 py-0.5 rounded-full">
        <Eye className="w-2.5 h-2.5" /> 방 {roomId}
      </span>
      <button type="button" onClick={copy}
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border transition-all active:scale-95 ${
          copied
            ? "bg-emerald-500/15 border-emerald-400/30 text-emerald-400"
            : "bg-border/20 border-border/35 text-muted-foreground hover:bg-surface-2/30"
        }`}>
        {copied ? <Check className="w-2.5 h-2.5" /> : <Copy className="w-2.5 h-2.5" />}
        {copied ? "복사됨" : "링크 복사"}
      </button>
      <button type="button" onClick={onClose}
        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[11px] border border-border/25 text-muted-foreground hover:text-destructive hover:border-destructive/30 transition-colors">
        <X className="w-2.5 h-2.5" /> 종료
      </button>
    </div>
  );
}

/* ══════════════════════════════════════
   음성 인식 훅
   ══════════════════════════════════════ */
type RecStatus = "idle" | "starting" | "listening";

function useSpeechRecognition({
  onFinal, onInterim,
}: {
  onFinal: (text: string) => void;
  onInterim: (text: string) => void;
}) {
  const [recStatus, setRecStatus]       = useState<RecStatus>("idle");
  const [isSupported, setIsSupported]   = useState<boolean | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [micError, setMicError]         = useState<string | null>(null);

  const recRef        = useRef<any>(null);
  const listeningRef  = useRef(false);
  const retryRef      = useRef(0);
  const startRecRef   = useRef<() => void>(() => {});
  const onFinalRef    = useRef(onFinal);
  const onInterimRef  = useRef(onInterim);
  useEffect(() => { onFinalRef.current   = onFinal;   }, [onFinal]);
  useEffect(() => { onInterimRef.current = onInterim; }, [onInterim]);

  useEffect(() => {
    const SR = getSpeechRecognitionConstructor(window);
    setIsSupported(!!SR);
    return () => {
      listeningRef.current = false;
    };
  }, []);

  const doStop = useCallback(() => {
    listeningRef.current = false;
    retryRef.current = 0;
    try {
      recRef.current?.stop();
    } catch {
      recRef.current = null;
    }
    recRef.current = null;
    setRecStatus("idle");
    onInterimRef.current("");
  }, []);

  const doStart = useCallback(async () => {
    const SR = getSpeechRecognitionConstructor(window);
    if (!SR || listeningRef.current) return;

    setMicError(null);
    setPermissionDenied(false);
    setRecStatus("starting");

    try {
      const testStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      testStream.getTracks().forEach(t => t.stop());
    } catch (e: any) {
      const name = (e?.name ?? "") as string;
      if (name === "NotAllowedError" || name === "PermissionDeniedError") setPermissionDenied(true);
      else if (name === "NotFoundError" || name === "DevicesNotFoundError") setMicError("no-device");
      else setMicError("마이크를 사용할 수 없습니다. 다른 앱이 마이크를 사용 중인지 확인하세요.");
      setRecStatus("idle");
      return;
    }

    listeningRef.current = true;

    const startRec = () => {
      const rec = new SR();
      rec.lang = "ko-KR";
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;

      rec.onstart = () => { retryRef.current = 0; setRecStatus("listening"); };

      rec.onresult = (e: any) => {
        let interim = "", final = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) final += t;
          else interim += t;
        }
        if (final) { onInterimRef.current(""); onFinalRef.current(final.trim()); }
        else { onInterimRef.current(interim); }
      };

      rec.onerror = (e) => {
        const err = e.error;
        if (err === "not-allowed") {
          (async () => {
            try {
              const perm = await navigator.permissions.query({ name: "microphone" as PermissionName });
              if (perm.state === "denied") setPermissionDenied(true);
              else setMicError("마이크를 일시적으로 사용할 수 없습니다. 마이크 버튼을 다시 눌러 시도하세요.");
            } catch { setPermissionDenied(true); }
            doStop();
          })();
        } else if (err === "audio-capture") {
          setMicError("마이크를 찾을 수 없습니다. 마이크가 연결되어 있는지 확인하세요.");
          doStop();
        } else if (err === "network") {
          setMicError("네트워크 오류입니다. 인터넷 연결을 확인하세요.");
          doStop();
        }
      };

      rec.onend = () => {
        if (!listeningRef.current) {
          setRecStatus("idle");
          return;
        }
        retryRef.current += 1;
        if (retryRef.current > 20) {
          setMicError("음성 인식이 반복 중단됩니다. 페이지를 새로고침 후 다시 시도해 주세요.");
          doStop(); return;
        }
        const delay = Math.min(300 * Math.pow(1.5, retryRef.current - 1), 4000);
        setTimeout(() => {
          if (!listeningRef.current) return;
          const cur = recRef.current;
          if (cur) { try { cur.start(); setRecStatus("listening"); return; } catch {} }
          startRecRef.current();
        }, delay);
      };

      recRef.current = rec;
      try { rec.start(); } catch {
        listeningRef.current = false;
        recRef.current = null;
        setRecStatus("idle");
        setMicError("음성 인식을 시작할 수 없습니다. 페이지를 새로고침 후 다시 시도해 주세요.");
      }
    };

    startRecRef.current = startRec;
    startRec();
  }, [doStop]);

  return {
    isListening: recStatus === "listening",
    isStarting: recStatus === "starting",
    isSupported, permissionDenied, micError, setPermissionDenied,
    start: doStart, stop: doStop,
  };
}

/* ── 오디오 파형 ── */
function LiveWaveform({ active, color }: { active: boolean; color: string }) {
  const BARS = 32;
  const heights = Array.from({ length: BARS }, (_, i) => {
    const center = (BARS - 1) / 2;
    const dist = Math.abs(i - center) / center;
    const base = 0.3 + (1 - dist) * 0.7;
    return Math.round(base * 34 + Math.sin(i * 1.3) * 5);
  });
  return (
    <div className="flex items-end gap-[2px] h-10 w-full">
      {heights.map((maxH, i) => (
        <div key={i} className="flex-1 rounded-full origin-bottom" style={{
          background: active ? color : "var(--border)",
          opacity: active ? 0.7 : 0.2,
          height: active ? `${maxH}px` : "3px",
          animation: active ? `liveBar ${480 + (i * 41) % 560}ms ease-in-out ${(i * 31) % 440}ms infinite alternate` : "none",
          transition: "height 0.4s ease, opacity 0.3s ease",
        }} />
      ))}
    </div>
  );
}

/* ── 세션 타이머 ── */
function useSessionTimer(running: boolean) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);
  useEffect(() => {
    if (running && startRef.current === null) startRef.current = Date.now();
    if (!running) { startRef.current = null; setElapsed(0); return; }
    const id = setInterval(() => {
      if (startRef.current !== null) setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [running]);
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

/* ── 세션 통계 ── */
function SessionStats({ utterances, isViewer }: { utterances: Utterance[]; isViewer: boolean }) {
  if (!utterances.length) return null;
  const total    = utterances.length;
  const checked  = utterances.filter(u => u.result).length;
  const checking = utterances.filter(u => u.checking).length;
  const falseC   = utterances.filter(u => u.result?.overall_verdict === "반대 근거 우세").length;
  const trueC    = utterances.filter(u => u.result?.overall_verdict === "사실").length;
  return (
    <div className="flex items-center gap-2 flex-wrap px-1">
      {isViewer && (
        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-primary bg-primary/10 border border-primary/20 px-1.5 py-0.5 rounded-full">
          <Eye className="w-2.5 h-2.5" /> 방청석
        </span>
      )}
      <span className="text-xs text-muted-foreground font-medium">총 {total}건</span>
      <div className="w-px h-3 bg-border/40" />
      {checked > 0 && <span className="text-xs text-muted-foreground">완료 <span className="font-semibold text-foreground/70">{checked}</span></span>}
      {checking > 0 && (
        <span className="inline-flex items-center gap-1 text-xs text-blue-400">
          <RefreshCw className="w-2.5 h-2.5 animate-spin" /> 처리 중 {checking}
        </span>
      )}
      {trueC > 0 && (
        <span className="inline-flex items-center gap-1 text-xs text-emerald-500">
          <CheckCircle2 className="w-2.5 h-2.5" /> 사실 {trueC}
        </span>
      )}
      {falseC > 0 && (
        <span className="inline-flex items-center gap-1 text-xs font-bold text-red-400 bg-red-400/10 border border-red-400/25 px-2 py-0.5 rounded-full"
          style={{ animation: "falseBlink 2s ease-in-out infinite" }}>
          <XCircle className="w-2.5 h-2.5" /> 거짓 {falseC}건
        </span>
      )}
    </div>
  );
}

/* ══════════════════════════════════════
   메인 컴포넌트
   ══════════════════════════════════════ */
function LivePage() {
  const doQuickCheck  = useServerFn(quickAnalyzeContent);
  const navigate      = useNavigate();
  const { room: urlRoom, viewer: isViewer } = Route.useSearch();

  /* ── 기본 상태 ── */
  const [speakerIdx, setSpeakerIdx] = useState(0);
  const [input, setInput]           = useState("");
  const [interim, setInterim]       = useState("");
  const [utterances, setUtterances] = useState<Utterance[]>([]);

  /* ── Feature 4: 신뢰 프로파일 표시 여부 ── */
  const [showTrust, setShowTrust]     = useState(false);

  /* ── Feature 1: 브리핑 모달 ── */
  const [showBriefing, setShowBriefing] = useState(false);

  /* ── Feature 2: 방청석 모드 ── */
  const [hostRoomId, setHostRoomId]   = useState<string | null>(null);
  const activeRoomId = isViewer ? (urlRoom ?? null) : hostRoomId;

  /* ── refs ── */
  const speaker         = SPEAKERS[speakerIdx];
  const speakerIdxRef   = useRef(speakerIdx);
  const utterancesRef   = useRef<Utterance[]>([]);
  const broadcastRef    = useRef<(u: Utterance) => void>(() => {});
  const bottomRef       = useRef<HTMLDivElement>(null);
  const textareaRef     = useRef<HTMLTextAreaElement>(null);
  const addRef          = useRef<(text: string) => void>(() => {});
  const hasAutoStarted  = useRef(false);

  useEffect(() => { speakerIdxRef.current  = speakerIdx;   }, [speakerIdx]);
  useEffect(() => { utterancesRef.current  = utterances;   }, [utterances]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [utterances.length]);

  /* ── Feature 2: Supabase Realtime ── */
  const handleReceive = useCallback((u: Utterance) => {
    setUtterances(prev => {
      const idx = prev.findIndex(x => x.id === u.id);
      if (idx >= 0) return prev.map((x, i) => i === idx ? u : x);
      return [...prev, u];
    });
  }, []);

  const { broadcast } = useRoom({ roomId: activeRoomId, isViewer, onReceive: handleReceive });
  useEffect(() => { broadcastRef.current = broadcast; }, [broadcast]);

  /* ── Feature 3: 맥락 인식 addUtterance ── */
  const addUtterance = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const checking       = trimmed.length >= 10;
    const currentSpeaker = SPEAKERS[speakerIdxRef.current];
    const id  = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

    const newU: Utterance = { id, speaker: currentSpeaker, text: trimmed, time: now, checking, result: null, error: null };
    setUtterances(prev => [...prev, newU]);
    setInput("");
    setSpeakerIdx(i => (i + 1) % SPEAKERS.length);
    textareaRef.current?.focus();

      if (!checking) return;

    // 방청석 즉시 브로드캐스트 (checking 상태)
    broadcastRef.current(newU);

    // Feature 3: 최근 4개 판정 완료 발언을 맥락으로 전달
    const ctx = utterancesRef.current
      .filter(u => u.result)
      .slice(-4)
      .map(u => ({ speaker: u.speaker, text: u.text, verdict: u.result!.overall_verdict }));

    try {
      const result = await doQuickCheck({ data: { text: trimmed, context: ctx.length > 0 ? ctx : undefined } });
      const updated: Utterance = { ...newU, checking: false, result };
      setUtterances(prev => prev.map(u => u.id === id ? updated : u));
      broadcastRef.current(updated);        // 결과 브로드캐스트
      // 거짓 감지 시 방청석에 토스트
      if (result.overall_verdict === "반대 근거 우세" && hostRoomId) {
        toast.error(`거짓 발언 감지 — ${currentSpeaker}`, { description: trimmed.slice(0, 60) });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "분석 실패";
      const failed: Utterance = { ...newU, checking: false, error: msg.slice(0, 80) };
      setUtterances(prev => prev.map(u => u.id === id ? failed : u));
      broadcastRef.current(failed);
    }
  }, [doQuickCheck, hostRoomId]);

  useEffect(() => {
    addRef.current = addUtterance;
  }, [addUtterance]);

  /* ── 음성 인식 ── */
  const { isListening, isStarting, isSupported, permissionDenied, micError, setPermissionDenied, start, stop } =
    useSpeechRecognition({
      onFinal:  useCallback((text: string) => {
        if (text.length >= 10) setTimeout(() => addRef.current(text), 0);
        else setInput((prev) => (prev + " " + text).trim());
      }, []),
      onInterim: useCallback((text: string) => setInterim(text), []),
    });

  useEffect(() => {
    if (isViewer) return;   // 방청석 모드: 마이크 자동 시작 안 함
    if (isSupported === true && !hasAutoStarted.current) {
      hasAutoStarted.current = true;
      start();
    }
  }, [isSupported, start, isViewer]);

  const sessionTimer = useSessionTimer(isListening);

  /* ── Feature 2: 방 만들기 ── */
  const handleCreateRoom = () => {
    const id = genRoomId();
    setHostRoomId(id);
    navigate({ to: "/live", search: { room: id, viewer: false } });
    toast.success(`방 ${id} 생성됨`, { description: "링크 복사 버튼으로 방청석 링크를 공유하세요" });
  };
  const handleCloseRoom = () => {
    setHostRoomId(null);
    navigate({ to: "/live", search: { room: undefined, viewer: false } });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      addUtterance(input);
    }
  };

  /* ── 텍스트 파일 내보내기 ── */
  const handleExport = () => {
    if (!utterances.length) return;
    const now = new Date();
    const dateStr = now.toLocaleDateString("ko-KR", {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "long",
    });
    const timeStr = now.toLocaleTimeString("ko-KR");
    const checkedCount = utterances.filter(u => u.result).length;
    const falseList    = utterances.filter(u => u.result?.overall_verdict === "반대 근거 우세");
    const SEP  = "═".repeat(56);
    const LINE = "─".repeat(56);
    const out: string[] = [
      SEP, "  팩트체크 실시간 대화 팩트체크 기록", SEP,
      `  저장일시  : ${dateStr} ${timeStr}`,
      `  총 발언   : ${utterances.length}건`,
      `  팩트체크  : ${checkedCount}건 완료`,
      `  거짓 감지 : ${falseList.length}건`,
      SEP, "", "【 대화 기록 】", LINE,
    ];
    utterances.forEach(u => {
      const isFalse = u.result?.overall_verdict === "반대 근거 우세";
      out.push("", `${isFalse ? "❌" : "  "} [${u.time}] ${u.speaker}`, `     발언: "${u.text}"`);
      if (u.checking) out.push("     상태: 팩트체크 처리 중");
      else if (u.error) out.push(`     상태: 분석 실패 — ${u.error}`);
      else if (u.result) {
        out.push(`     판정: ${u.result.overall_verdict} (신뢰도 ${u.result.overall_confidence}%)`);
        if (u.result.bias_type) out.push(`     편향: ${u.result.bias_type}`);
        if ((u.result.fake_probability ?? 0) > 0)
          out.push(`     문체 가짜 가능성: ${u.result.fake_probability}%`);
        if ((u.result.style_signals ?? []).length > 0)
          out.push(`     경고 신호: ${u.result.style_signals!.join(" / ")}`);
        if (u.result.summary) out.push(`     요약: ${u.result.summary}`);
        if (isFalse)
          u.result.highlights.filter(h => h.verdict === "반대 근거 우세").forEach(h => {
            if (h.claim) out.push(`     주장: ${h.claim}`);
            if (h.counter) out.push(`     반박: ${h.counter}`);
          });
        if (u.result.risk_flags.length > 0) out.push(`     위험: ${u.result.risk_flags.join(" / ")}`);
      }
    });
    if (falseList.length > 0) {
      out.push("", "", "【 거짓 발언 요약 】", LINE);
      falseList.forEach((u, i) => {
        out.push("", `  ${i + 1}. [${u.time}] ${u.speaker}`, `     "${u.text}"`);
        if (u.result?.summary) out.push(`     → ${u.result.summary}`);
        if (u.result) out.push(`     → 신뢰도 ${u.result.overall_confidence}%`);
      });
    }
    out.push("", SEP, "  Generated by 팩트체크 AI K-Fact", SEP);
    const blob = new Blob([out.join("\n")], { type: "text/plain;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const ts   = now.toISOString().slice(0, 16).replace("T", "_").replace(":", "");
    Object.assign(document.createElement("a"), { href: url, download: `팩트체크_대화기록_${ts}.txt` }).click();
    URL.revokeObjectURL(url);
  };

  const handleReset = () => {
    setUtterances([]); setSpeakerIdx(0); setInput(""); setInterim("");
    setShowTrust(false);
    stop();
    hasAutoStarted.current = false;
  };

  const falseCount    = utterances.filter(u => u.result?.overall_verdict === "반대 근거 우세").length;
  const speakerColor  = SPEAKER_STYLE[speaker].bar;

  /* ══════════════════════════════════════
     JSX
     ══════════════════════════════════════ */
  return (
    <div className="min-h-screen flex flex-col">
      <style>{`
        @keyframes liveBar   { 0%   { transform: scaleY(0.12); } 100% { transform: scaleY(1); } }
        @keyframes cardIn    { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes livePing  { 0%   { transform: scale(1); opacity: 0.6; } 100% { transform: scale(2.8); opacity: 0; } }
        @keyframes falseBlink{ 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        @keyframes recDot    { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
        @media print {
          body > *:not(.briefing-modal) { display: none !important; }
          .briefing-modal { position: fixed; inset: 0; background: white; z-index: 9999; }
        }
      `}</style>

      <SiteHeader />
      <BottomNav />

      {/* 방청석: 브리핑 모달 */}
      {showBriefing && <BriefingModal utterances={utterances} onClose={() => setShowBriefing(false)} />}

      <main className="flex-1 max-w-3xl mx-auto w-full px-4 sm:px-6 pt-6 pb-[calc(9rem+env(safe-area-inset-bottom,0px))] sm:pb-[calc(6rem+env(safe-area-inset-bottom,0px))] flex flex-col gap-4"
        style={{ "--muted-foreground": "oklch(0.42 0.020 255)" } as React.CSSProperties}>

        {/* ── 헤더 ── */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative shrink-0">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-yellow-400 grid place-items-center shadow-lg shadow-amber-400/25">
                <MessageSquare className="w-5 h-5 text-amber-950" />
              </div>
              {isListening && (
                <span className="absolute -top-1 -right-1 w-3 h-3">
                  <span
                    className="absolute inset-0 rounded-full bg-red-500"
                    style={{ animation: "livePing 1.4s ease-out infinite" }}
                  />
                  <span className="relative block w-3 h-3 rounded-full bg-red-500" />
                </span>
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-base font-bold leading-tight text-foreground">
                  실시간 대화 팩트체크
                </h1>
                {isListening && (
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-red-400 bg-red-400/10 border border-red-400/30 px-1.5 py-0.5 rounded-full tracking-wider">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-400" style={{ animation: "recDot 1s ease-in-out infinite" }} />
                    LIVE · {sessionTimer}
                  </span>
                )}
                {isViewer && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-primary bg-primary/10 border border-primary/25 px-1.5 py-0.5 rounded-full">
                    <Eye className="w-2.5 h-2.5" /> 방청석 모드
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isViewer ? "실시간으로 팩트체크 결과를 확인합니다" : "발언마다 자동 화자 전환 · 거짓 발언 즉시 감지"}
              </p>
              {/* Feature 2: 방 배지 (호스트) */}
              {hostRoomId && <div className="mt-1.5"><RoomBadge roomId={hostRoomId} onClose={handleCloseRoom} /></div>}
            </div>
          </div>

          {/* 우측 버튼 묶음 */}
          <div className="flex items-center gap-1 shrink-0">
            {/* Feature 1: 브리핑 버튼 */}
            {utterances.length > 0 && (
              <button type="button" onClick={() => setShowBriefing(true)} title="세션 브리핑"
                className="p-2 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
                <BarChart3 className="w-4 h-4" />
              </button>
            )}
            {/* Feature 4: 신뢰 프로파일 토글 */}
            {utterances.some(u => u.result) && (
              <button type="button" onClick={() => setShowTrust(o => !o)} title="화자 신뢰 프로파일"
                className={`p-2 rounded-lg transition-colors ${showTrust ? "text-yellow-400 bg-yellow-400/10" : "text-muted-foreground hover:text-yellow-400 hover:bg-yellow-400/10"}`}>
                <Trophy className="w-4 h-4" />
              </button>
            )}
            {/* Feature 2: 방청석 열기 (호스트 전용) */}
            {!isViewer && !hostRoomId && (
              <button type="button" onClick={handleCreateRoom} title="방청석 열기"
                className="p-2 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
                <Users className="w-4 h-4" />
              </button>
            )}
            {utterances.length > 0 && !isViewer && (
              <button type="button" onClick={handleReset} title="전체 초기화"
                className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* ── Feature 4: 신뢰 프로파일 패널 ── */}
        {showTrust && <SpeakerTrustPanel utterances={utterances} />}

        {/* ── 녹음 상태 바 (방청석 모드에선 숨김) ── */}
        {!isViewer && (
          <div className={`glass rounded-2xl px-5 py-4 flex flex-col gap-3 ring-1 transition-all duration-300 ${isListening ? SPEAKER_STYLE[speaker].ring : "ring-border/30"}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className={`text-xs font-bold px-3 py-1 rounded-full border ${SPEAKER_STYLE[speaker].badge}`}>
                  {speaker}
                </span>
                {isListening
                  ? <span className="inline-flex items-center gap-1.5 text-xs text-red-400 font-medium"><Radio className="w-3 h-3 animate-pulse" /> 녹음 중</span>
                  : <span className="text-xs text-muted-foreground">{(permissionDenied || micError) ? "마이크 오류" : "대기 중…"}</span>
                }
              </div>
              <div className="flex items-center gap-1.5">
                {isListening
                  ? <button type="button" onClick={stop}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-border/30 text-muted-foreground text-xs hover:bg-surface-2 transition-all active:scale-95">
                      <Square className="w-3 h-3" /> 중지
                    </button>
                  : (permissionDenied || micError)
                    ? <button type="button" onClick={() => { setPermissionDenied(false); start(); }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/20 border border-amber-400/40 text-amber-400 text-xs font-semibold hover:bg-amber-500/30 transition-all active:scale-95">
                        <Mic className="w-3 h-3" /> 다시 시도
                      </button>
                    : null
                }
              </div>
            </div>
            {isListening && (
              <>
                <LiveWaveform active color={speakerColor} />
                {interim
                  ? <p className="text-sm text-foreground/90 italic px-1 leading-relaxed">{interim}<span className="inline-block w-0.5 h-4 bg-primary ml-0.5 animate-pulse align-middle" /></p>
                  : <p className="text-xs text-muted-foreground px-1">말씀하세요 — 발언 완료 시 자동 기록됩니다</p>
                }
              </>
            )}
            {(permissionDenied || micError === "no-device") && (
              <MicErrorBanner permissionDenied={permissionDenied} micError={micError} />
            )}
          </div>
        )}

        {/* 방청석 모드 대기 배너 */}
        {isViewer && utterances.length === 0 && (
          <div className="flex flex-col items-center gap-4 py-14 text-center glass rounded-2xl border border-border/30">
            <div className="w-14 h-14 rounded-full bg-primary/10 grid place-items-center">
              <Eye className="w-6 h-6 text-primary/60 animate-pulse" />
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-semibold text-foreground/90">호스트 발언 대기 중</p>
              <p className="text-xs text-muted-foreground max-w-xs mx-auto leading-relaxed">
                호스트가 발언하면 실시간으로 팩트체크 결과가 여기에 표시됩니다
              </p>
            </div>
          </div>
        )}

        {/* ── 세션 통계 ── */}
        {utterances.length > 0 && <SessionStats utterances={utterances} isViewer={isViewer} />}

        {/* ── 발언 목록 ── */}
        {utterances.length > 0 && (
          <div className="space-y-1.5">
            {utterances.map((u, idx) => (
              <UtteranceCard key={u.id} u={u} isNew={idx === utterances.length - 1} />
            ))}
            <div ref={bottomRef} />

            {/* 대화 기록 저장 (방청석 모드엔 숨김) */}
            {!isViewer && (
              <div className="pt-3 pb-1">
                <div className="rounded-2xl border border-border/40 bg-surface-2/30 px-5 py-4 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground/90">대화 기록 저장</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      발언 {utterances.length}건{falseCount > 0 ? ` · 거짓 ${falseCount}건 포함` : ""} — 텍스트 파일로 저장합니다
                    </p>
                  </div>
                  <button type="button" onClick={handleExport}
                    className="shrink-0 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 text-white text-sm font-bold shadow-md shadow-blue-500/30 hover:opacity-90 transition-all active:scale-95">
                    <Download className="w-4 h-4" /> 저장
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 빈 상태 (호스트 전용) */}
        {utterances.length === 0 && !isViewer && (
          <div className="flex flex-col items-center gap-5 py-14 text-center glass rounded-2xl border border-border/30">
            <div className="relative">
              <div className={`w-16 h-16 rounded-full grid place-items-center transition-all duration-500 ${isListening ? "bg-red-400/12 ring-2 ring-red-400/30" : "bg-muted/10"}`}>
                <Mic className={`w-7 h-7 transition-colors ${isListening ? "text-red-400 animate-pulse" : "text-muted-foreground/30"}`} />
              </div>
              {isListening && (
                <span
                  className="absolute -inset-3 rounded-full border border-red-400/15"
                  style={{ animation: "livePing 2s ease-out 0.3s infinite" }}
                />
              )}
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-semibold text-foreground/90">{isListening ? "말씀해 보세요" : "대화를 시작해보세요"}</p>
              <p className="text-xs text-muted-foreground max-w-xs leading-relaxed mx-auto">
                {isListening
                  ? "발언이 완료되면 자동으로 기록되고 실시간 팩트체크가 시작됩니다"
                  : "마이크로 말하거나 아래 입력창에 직접 발언을 입력하세요"}
              </p>
            </div>
            {!isListening && (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground/70">
                {["마이크 준비", "발언 시작", "실시간 판정"].map((step, i) => (
                  <div key={step} className="flex items-center gap-2">
                    {i > 0 && <span className="opacity-30">›</span>}
                    <span className="bg-border/25 rounded-full px-2.5 py-1">{step}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── 직접 입력 폼 (방청석 모드엔 숨김) ── */}
        {!isViewer && (
          <div className="glass rounded-2xl p-4 ring-1 ring-border/25">
            <div className="flex items-start gap-2.5">
              <button type="button" onClick={() => setSpeakerIdx(i => (i + 1) % SPEAKERS.length)}
                title="클릭하여 화자 전환"
                className={`shrink-0 mt-0.5 text-xs font-bold px-2.5 py-1 rounded-full border transition-all hover:scale-105 active:scale-95 ${SPEAKER_STYLE[speaker].badge}`}>
                {speaker}
              </button>
              <textarea ref={textareaRef} rows={2} lang="ko"
                placeholder="발언 직접 입력 (Enter로 추가)"
                value={interim || input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                className="flex-1 bg-transparent outline-none resize-none text-sm leading-relaxed placeholder:text-muted-foreground/35 text-foreground/90" />
              <button type="button" onClick={() => addUtterance(input)}
                disabled={!input.trim()}
                className="shrink-0 p-2 rounded-xl bg-amber-500/20 border border-amber-400/40 text-amber-400 hover:bg-amber-500/30 disabled:opacity-30 disabled:cursor-not-allowed transition-all active:scale-95">
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {isSupported === false && !isViewer && (
          <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1.5">
            <MicOff className="w-3.5 h-3.5" /> Chrome 브라우저에서만 음성 인식이 지원됩니다
          </p>
        )}
      </main>
    </div>
  );
}

/* ── 마이크 오류 배너 ── */
function MicErrorBanner({
  permissionDenied,
  micError,
}: {
  permissionDenied: boolean;
  micError: string | null;
}) {
  if (micError === "no-device") {
    return (
      <div className="rounded-xl border border-red-400/20 bg-red-400/5 px-3 py-2.5 space-y-1.5">
        <p className="text-xs font-semibold text-red-400">마이크 장치를 찾을 수 없음</p>
        <ol className="space-y-0.5 list-decimal list-inside">
          {[
            "USB 헤드셋이 PC에 꽂혀 있는지 확인 (허브 말고 본체 직결)",
            "Win+R → mmsys.cpl → 녹음 탭 → USB 헤드셋 우클릭 → 기본 장치로 설정",
            "헤드셋 연결 후 Chrome 재시작",
          ].map((s, i) => (
            <li key={i} className="text-[11px] text-muted-foreground leading-relaxed">
              {s}
            </li>
          ))}
        </ol>
      </div>
    );
  }
  if (permissionDenied) {
    return (
      <div className="rounded-xl border border-orange-400/20 bg-orange-400/5 px-3 py-2.5 space-y-1.5">
        <p className="text-xs font-semibold text-orange-400">마이크 접근이 차단됨</p>
        <ol className="space-y-0.5 list-decimal list-inside">
          {[
            "Win+I → 개인정보 보호 및 보안 → 마이크 → 데스크톱 앱 허용 켜기",
            "chrome://settings/content/microphone 에서 이 사이트 허용 확인",
            "Chrome 재시작",
          ].map((s, i) => (
            <li key={i} className="text-[11px] text-muted-foreground leading-relaxed">
              {s}
            </li>
          ))}
        </ol>
      </div>
    );
  }
  return null;
}

/* ── 발언 카드 ── */
function UtteranceCard({ u, isNew }: { u: Utterance; isNew: boolean }) {
  const style    = SPEAKER_STYLE[u.speaker];
  const isFalse  = u.result?.overall_verdict === "반대 근거 우세";
  const combined = u.result?.fake_detail?.combined ?? u.result?.fake_probability ?? 0;
  const highFake = combined >= 40 && !isFalse;
  const cardAnim = isNew ? { animation: "cardIn 0.3s ease-out both" } : {};

  /* ── 반대 근거 우세 (거짓) ── */
  if (isFalse && u.result) {
    const falseHighlights = u.result.highlights.filter(h => h.verdict === "반대 근거 우세");
    return (
      <div className="rounded-2xl border-2 border-red-400/50 bg-red-400/5 p-4 space-y-3" style={cardAnim}>
        {/* 헤더 */}
        <div className="flex items-start gap-2.5">
          <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${style.badge}`}>
                {u.speaker}
              </span>
              <span className="text-[10px] text-muted-foreground/80">{u.time}</span>
              {u.result.bias_type && u.result.bias_type !== "중립" && (
                <span className="text-[10px] font-medium text-orange-400 bg-orange-400/10 border border-orange-400/20 px-1.5 py-0.5 rounded-full">
                  {u.result.bias_type} 편향
                </span>
              )}
              <span className="ml-auto inline-flex items-center gap-1 text-xs font-bold text-red-400">
                <XCircle className="w-3 h-3" /> 반대 근거 우세 {u.result.overall_confidence}%
              </span>
            </div>
            <p className="text-sm text-foreground/92 leading-relaxed font-medium">{u.text}</p>
          </div>
        </div>

        {/* 가짜뉴스 다신호 분석 패널 (이슈 아래 전체) */}
        <FakeNewsDetailPanel result={u.result} />

        {/* 최근 거짓뉴스 사례 매칭 패널 */}
        <MatchedFakeCasesPanel cases={u.result.matched_fake_cases} />

        {/* 요약 */}
        {u.result.summary && (
          <p className="text-xs text-foreground/90 leading-relaxed pl-4 border-l-2 border-red-400/30">
            {u.result.summary}
          </p>
        )}

        {/* 거짓 하이라이트 */}
        {falseHighlights.length > 0 && (
          <div className="space-y-2 pl-2">
            {falseHighlights.map((h, i) => (
              <div key={i} className="rounded-xl border border-red-400/20 bg-red-400/5 px-3 py-2.5">
                <p className="text-xs font-medium text-foreground/88 mb-1">{h.claim}</p>
                {(h.subject || h.predicate || h.object) && (
                  <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                    {h.subject && (
                      <span className="text-[10px] bg-border/20 border border-border/40 rounded px-1.5 py-0.5 text-muted-foreground">
                        주어: {h.subject}
                      </span>
                    )}
                    {h.predicate && (
                      <span className="text-[10px] bg-border/20 border border-border/40 rounded px-1.5 py-0.5 text-muted-foreground">
                        서술: {h.predicate}
                      </span>
                    )}
                    {h.object && (
                      <span className="text-[10px] bg-border/20 border border-border/40 rounded px-1.5 py-0.5 text-muted-foreground">
                        대상: {h.object}
                      </span>
                    )}
                  </div>
                )}
                {h.brief && (
                  <p className="text-[11px] text-foreground/85 leading-relaxed mb-1">{h.brief}</p>
                )}
                {h.counter && (
                  <div className="flex items-start gap-1.5 mt-1">
                    <ThumbsDown className="w-3 h-3 text-red-400 shrink-0 mt-0.5" />
                    <span className="text-[11px] text-red-400 leading-relaxed">{h.counter}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 위험 플래그 */}
        {u.result.risk_flags.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap pl-2">
            <TriangleAlert className="w-3 h-3 text-orange-400 shrink-0" />
            {u.result.risk_flags.map((f, i) => (
              <span
                key={i}
                className="text-[10px] text-orange-400 bg-orange-400/10 border border-orange-400/20 px-1.5 py-0.5 rounded-full"
              >
                {f}
              </span>
            ))}
          </div>
        )}

        {/* Naver + Daum 교차 팩트체크 참고 (이슈 아래 전체와 다음팩트체크사이) */}
        <ExternalFactRefs
          naver={u.result.naver_factchecks}
          daum={u.result.daum_factchecks}
        />
      </div>
    );
  }

  /* ── 사실 ── */
  if (u.result?.overall_verdict === "사실") {
    const hasCrossRef = u.result.naver_factchecks?.length || u.result.daum_factchecks?.length;
    return (
      <div
        className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl border border-emerald-400/20 bg-emerald-400/5 group transition-colors"
        style={cardAnim}
      >
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-1" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${style.badge}`}>{u.speaker}</span>
            <span className="text-[10px] text-emerald-500 font-medium">사실 {u.result.overall_confidence}%</span>
            {u.result.fake_detail && u.result.fake_detail.cross_ref_count > 0 && (
              <span className="text-[9px] text-emerald-400/70 bg-emerald-400/10 px-1.5 py-0.5 rounded-full">
                교차확인 {u.result.fake_detail.cross_ref_count}건
              </span>
            )}
          </div>
          <p className="text-sm text-foreground/88 leading-relaxed">{u.text}</p>
          {u.result.summary && <p className="text-[11px] text-muted-foreground/70 mt-1 leading-relaxed">{u.result.summary}</p>}
          {hasCrossRef ? (
            <ExternalFactRefs naver={u.result.naver_factchecks} daum={u.result.daum_factchecks} />
          ) : null}
          <MatchedFakeCasesPanel cases={u.result.matched_fake_cases} />
        </div>
        <span className="text-[10px] text-muted-foreground/60 shrink-0 mt-1 group-hover:text-muted-foreground/80 transition-colors">
          {u.time}
        </span>
      </div>
    );
  }

  /* ── 부분사실 / 근거부족 / 처리 중 ── */
  return (
    <div className={`flex items-start gap-2.5 px-2.5 py-2 rounded-xl transition-colors group ${
      highFake
        ? "bg-orange-400/5 border border-orange-400/15 hover:bg-orange-400/8"
        : u.result ? "bg-surface-2/20 hover:bg-surface-2/40" : "hover:bg-surface-2/25"
    }`} style={cardAnim}>
      <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border ${style.badge} mt-0.5`}>{u.speaker}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground/88 leading-relaxed">{u.text}</p>
        {u.checking && (
          <p className="text-[11px] text-muted-foreground/80 mt-0.5 flex items-center gap-1">
            <RefreshCw className="w-2.5 h-2.5 animate-spin" /> 팩트체크 중…
          </p>
        )}
        {!u.checking && u.result && (
          <div className="mt-1 space-y-1.5">
            <p className="text-[11px] text-muted-foreground/65 flex items-center gap-1">
              {u.result.overall_verdict === "부분 사실" && <MinusCircle className="w-2.5 h-2.5 text-yellow-400" />}
              {u.result.overall_verdict === "근거 부족"  && <HelpCircle  className="w-2.5 h-2.5 text-orange-400" />}
              {u.result.overall_verdict} {u.result.overall_confidence}%
            </p>
            {/* 가짜뉴스 분석 패널 (combined > 20이면 표시) */}
            {(combined >= 20 || highFake) && <FakeNewsDetailPanel result={u.result} />}
            <MatchedFakeCasesPanel cases={u.result.matched_fake_cases} />
            <ExternalFactRefs naver={u.result.naver_factchecks} daum={u.result.daum_factchecks} />
          </div>
        )}
        {u.error && <p className="text-[11px] text-destructive/70 mt-0.5">{u.error}</p>}
      </div>
      <span className="text-[10px] text-muted-foreground/32 shrink-0 mt-1 group-hover:text-muted-foreground/50 transition-colors">
        {u.time}
      </span>
    </div>
  );
}

/* ══════════════════════════════════════
   가짜뉴스 다신호 분석 패널
   ══════════════════════════════════════ */
function SignalMiniBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[9px] text-muted-foreground/55 w-12 shrink-0 leading-tight">{label}</span>
      <div className="flex-1 h-1 rounded-full bg-border/25 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${value}%`, background: color }} />
      </div>
      <span className="text-[9px] tabular-nums text-muted-foreground/60 w-6 text-right">{value}%</span>
    </div>
  );
}

function FakeNewsDetailPanel({ result }: { result: QuickCheckResult }) {
  const fd = result.fake_detail;
  if (!fd) return null;
  const { combined, style_score, pattern_score, citation_score, urgency_score, cross_ref_count } = fd;
  if (combined < 5 && cross_ref_count === 0) return null;

  const [open, setOpen] = useState(false);
  const color = combined >= 60 ? "#fb7185" : combined >= 35 ? "#fbbf24" : "#34d399";

  return (
    <div className="rounded-xl border border-border/20 bg-surface-2/8 overflow-hidden">
      {/* 헤더 — 클릭하면 상세 펼침 */}
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-surface-2/15 transition-colors">
        <span className="text-[10px] font-bold text-foreground/55 uppercase tracking-wide shrink-0">가짜뉴스 분석</span>
        <div className="flex-1 h-1.5 rounded-full bg-border/25 overflow-hidden">
          <div className="h-full rounded-full transition-all duration-700" style={{ width: `${combined}%`, background: color }} />
        </div>
        <span className="text-[11px] font-bold tabular-nums shrink-0" style={{ color }}>{combined}점</span>
        {cross_ref_count > 0 && (
          <span className="text-[9px] font-medium text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 px-1.5 py-0.5 rounded-full shrink-0 leading-none">
            교차확인 {cross_ref_count}건
          </span>
        )}
        {open
          ? <ChevronUp className="w-3 h-3 text-muted-foreground/40 shrink-0" />
          : <ChevronDown className="w-3 h-3 text-muted-foreground/40 shrink-0" />}
      </button>

      {/* 상세 펼침 */}
      {open && (
        <div className="px-3 pb-3 space-y-2 border-t border-border/15">
          <div className="pt-2 space-y-1.5">
            <SignalMiniBar label="문체 점수"  value={style_score}    color="#60a5fa" />
            <SignalMiniBar label="선동 패턴"  value={pattern_score}  color="#fb7185" />
            <SignalMiniBar label="무출처 지수" value={citation_score}  color="#fbbf24" />
            {urgency_score > 0 && (
              <SignalMiniBar label="긴박감 조성" value={urgency_score} color="#f97316" />
            )}
          </div>

          {/* 감지된 신호 */}
          {fd.signals.length > 0 && (
            <div className="space-y-0.5 pt-1 border-t border-border/10">
              {fd.signals.slice(0, 4).map((s, i) => (
                <p key={i} className="text-[10px] text-orange-400/75 leading-relaxed">• {s}</p>
              ))}
            </div>
          )}

          {/* 교차확인 배지 */}
          {cross_ref_count > 0 && (
            <div className="flex items-center gap-1.5 pt-1 border-t border-border/10">
              <span className="text-[10px] text-muted-foreground/50">교차확인:</span>
              {result.naver_factchecks && result.naver_factchecks.length > 0 && (
                <span className="text-[10px] text-blue-400 bg-blue-400/10 px-1.5 py-0.5 rounded-full">
                  네이버 {result.naver_factchecks.length}건
                </span>
              )}
              {result.daum_factchecks && result.daum_factchecks.length > 0 && (
                <span className="text-[10px] text-rose-400 bg-rose-400/10 px-1.5 py-0.5 rounded-full">
                  다음 {result.daum_factchecks.length}건
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── 최근 거짓뉴스 사례 매칭 패널 ── */
const CATEGORY_COLOR: Record<string, string> = {
  "선거·정치":   "text-red-400 bg-red-400/10 border-red-400/20",
  "미디어조작":  "text-purple-400 bg-purple-400/10 border-purple-400/20",
  "경제·사회":   "text-amber-400 bg-amber-400/10 border-amber-400/20",
  "보건·의료":   "text-teal-400 bg-teal-400/10 border-teal-400/20",
  "국제·외교":   "text-blue-400 bg-blue-400/10 border-blue-400/20",
  "역사왜곡":    "text-orange-400 bg-orange-400/10 border-orange-400/20",
  "카카오톡유포": "text-pink-400 bg-pink-400/10 border-pink-400/20",
};

const VERDICT_COLOR: Record<string, string> = {
  "거짓":        "text-red-400",
  "대부분 거짓": "text-red-300",
  "절반의 사실": "text-amber-400",
  "맥락 왜곡":   "text-orange-400",
};

function MatchedFakeCasesPanel({ cases }: { cases?: MatchedFakeCase[] }) {
  const [open, setOpen] = useState(false);
  if (!cases || cases.length === 0) return null;

  return (
    <div className="rounded-xl border border-red-500/25 bg-red-500/5 overflow-hidden">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-red-500/8 transition-colors">
        <TriangleAlert className="w-3 h-3 text-red-400 shrink-0" />
        <span className="text-[10px] font-bold text-red-400 uppercase tracking-wide">알려진 거짓뉴스 사례 매칭</span>
        <span className="text-[10px] text-red-400/70 bg-red-400/15 border border-red-400/20 px-1.5 py-0.5 rounded-full font-bold ml-0.5">
          {cases.length}건
        </span>
        <span className="ml-auto text-[9px] text-red-400/50">
          {cases.map(c => c.period).join(" · ")}
        </span>
        {open
          ? <ChevronUp className="w-3 h-3 text-red-400/50 shrink-0" />
          : <ChevronDown className="w-3 h-3 text-red-400/50 shrink-0" />}
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2.5 border-t border-red-500/15">
          {cases.map((c) => {
            const catColor = CATEGORY_COLOR[c.category] ?? "text-muted-foreground bg-surface-2/20 border-border/30";
            const verdictColor = VERDICT_COLOR[c.verdict] ?? "text-orange-400";
            return (
              <div key={c.id} className="pt-2 space-y-1.5">
                {/* 헤더 */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${catColor}`}>
                    {c.category}
                  </span>
                  <span className="text-[10px] font-bold text-foreground/85">{c.title}</span>
                  <span className={`ml-auto text-[9px] font-bold tabular-nums ${verdictColor}`}>
                    {c.verdict} {c.confidence}%
                  </span>
                </div>
                {/* 브리핑 */}
                <p className="text-[10px] text-foreground/72 leading-relaxed line-clamp-3">
                  {c.briefing}
                </p>
                {/* 출처 */}
                <p className="text-[9px] text-muted-foreground/50 flex items-center gap-1">
                  <span className="text-muted-foreground/30">검증:</span>
                  {c.debunked_by}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── 통합 외부 팩트체크 참고 기사 ── */
function ExternalFactRefs({ naver, daum }: { naver?: NaverFactCheckItem[]; daum?: DaumFactCheckItem[] }) {
  const hasNaver = naver && naver.length > 0;
  const hasDaum  = daum  && daum.length  > 0;
  if (!hasNaver && !hasDaum) return null;

  return (
    <div className="mt-2 pt-2 border-t border-border/20 space-y-2">
      {/* 네이버 */}
      {hasNaver && (
        <div>
          <p className="text-[10px] text-blue-400/70 font-medium flex items-center gap-1 mb-1">
            <Newspaper className="w-2.5 h-2.5" /> 네이버 팩트체크
          </p>
          <div className="space-y-0.5">
            {naver!.map((item, i) => (
              <a key={i} href={item.link} target="_blank" rel="noopener noreferrer"
                className="flex items-start gap-1.5 group/link text-[11px] leading-relaxed hover:bg-blue-400/5 rounded px-1 py-0.5 -mx-1 transition-colors">
                <ExternalLink className="w-2.5 h-2.5 text-blue-400/40 shrink-0 mt-0.5 group-hover/link:text-blue-400 transition-colors" />
                <span className="text-foreground/60 group-hover/link:text-blue-400 transition-colors line-clamp-2">
                  {item.publisher && <span className="text-muted-foreground/45 mr-1">[{item.publisher}]</span>}
                  {item.title}
                </span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* 다음 */}
      {hasDaum && (
        <div>
          <p className="text-[10px] text-rose-400/70 font-medium flex items-center gap-1 mb-1">
            <Newspaper className="w-2.5 h-2.5" /> 다음 팩트체크
          </p>
          <div className="space-y-0.5">
            {daum!.map((item, i) => (
              <a key={i} href={item.link} target="_blank" rel="noopener noreferrer"
                className="flex items-start gap-1.5 group/link text-[11px] leading-relaxed hover:bg-rose-400/5 rounded px-1 py-0.5 -mx-1 transition-colors">
                <ExternalLink className="w-2.5 h-2.5 text-rose-400/40 shrink-0 mt-0.5 group-hover/link:text-rose-400 transition-colors" />
                <span className="text-foreground/60 group-hover/link:text-rose-400 transition-colors line-clamp-2">
                  <span className="text-muted-foreground/45 mr-1">[{item.publisher}]</span>
                  {item.title}
                </span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Naver 팩트체크 참고 기사 (레거시 — ExternalFactRefs로 대체) ── */
function NaverRefs({ items }: { items: NaverFactCheckItem[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-2 pt-2 border-t border-border/20">
      <p className="text-[10px] text-blue-400/70 font-medium flex items-center gap-1 mb-1">
        <Newspaper className="w-2.5 h-2.5" /> 네이버 팩트체크 관련 기사
      </p>
      <div className="space-y-1">
        {items.map((item, i) => (
          <a key={i} href={item.link} target="_blank" rel="noopener noreferrer"
            className="flex items-start gap-1.5 group/link text-[11px] leading-relaxed hover:bg-blue-400/5 rounded px-1 py-0.5 -mx-1 transition-colors">
            <ExternalLink className="w-2.5 h-2.5 text-blue-400/50 shrink-0 mt-0.5 group-hover/link:text-blue-400 transition-colors" />
            <span className="text-foreground/65 group-hover/link:text-blue-400 transition-colors line-clamp-2">
              {item.publisher && <span className="text-muted-foreground/50 mr-1">[{item.publisher}]</span>}
              {item.title}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
