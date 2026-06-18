import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import {
  Flame, RefreshCw, ExternalLink, Search,
  Newspaper, Shield, Building2, Zap, ChevronDown, ChevronUp,
  Youtube, MessageSquare, Hash,
} from "lucide-react";

import { fetchTrendingNews, refreshTrendingNews, type TrendingItem, type SourceType } from "@/lib/news.functions";

interface Props {
  onAnalyze: (url: string) => Promise<void>;
}

const SOURCE_META: Record<SourceType, { label: string; color: string; bg: string; Icon: LucideIcon }> = {
  factcheck:  { label: "팩트체크", color: "text-violet-400",  bg: "bg-violet-400/15 border-violet-400/30",  Icon: Shield },
  government: { label: "정부",     color: "text-blue-400",   bg: "bg-blue-400/15 border-blue-400/30",   Icon: Building2 },
  naver:      { label: "네이버",   color: "text-green-400",  bg: "bg-green-400/15 border-green-400/30",  Icon: Zap },
  news:       { label: "뉴스",     color: "text-amber-400",  bg: "bg-amber-400/15 border-amber-400/30",  Icon: Newspaper },
  youtube:    { label: "YouTube",  color: "text-red-400",    bg: "bg-red-400/15 border-red-400/30",      Icon: Youtube },
  community:  { label: "커뮤니티", color: "text-orange-400", bg: "bg-orange-400/15 border-orange-400/30", Icon: MessageSquare },
  social:     { label: "SNS",      color: "text-sky-400",    bg: "bg-sky-400/15 border-sky-400/30",      Icon: Hash },
};

const FILTER_TABS: { key: SourceType | "all"; label: string }[] = [
  { key: "all",       label: "전체" },
  { key: "factcheck", label: "팩트체크" },
  { key: "news",      label: "최신뉴스" },
  { key: "government",label: "정부" },
  { key: "naver",     label: "네이버" },
  { key: "youtube",   label: "YouTube" },
  { key: "community", label: "커뮤니티" },
  { key: "social",    label: "SNS" },
];

function timeAgo(pubDate: string): string {
  if (!pubDate) return "";
  const d = new Date(pubDate);
  if (isNaN(d.getTime())) return "";
  const diffM = Math.floor((Date.now() - d.getTime()) / 60000);
  if (diffM < 1) return "방금";
  if (diffM < 60) return `${diffM}분 전`;
  const diffH = Math.floor(diffM / 60);
  if (diffH < 24) return `${diffH}시간 전`;
  return `${Math.floor(diffH / 24)}일 전`;
}

export function TrendingNews({ onAnalyze }: Props) {
  const [filter, setFilter] = useState<SourceType | "all">("all");
  const [refreshKey, setRefreshKey] = useState(0);
  const [mobileExpanded, setMobileExpanded] = useState(true);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);

  const handleAnalyze = async (item: TrendingItem) => {
    if (analyzingId) return;
    setAnalyzingId(item.id);
    try {
      await onAnalyze(item.link);
    } finally {
      setAnalyzingId(null);
    }
  };

  const fetchFn = useServerFn(fetchTrendingNews);
  const refreshFn = useServerFn(refreshTrendingNews);

  const { data: items = [], isLoading, isError, refetch } = useQuery<TrendingItem[]>({
    queryKey: ["trending-news", refreshKey],
    queryFn: () => fetchFn(),
    staleTime: 30 * 60 * 1000,
    retry: 1,
  });

  const handleRefresh = async () => {
    await refreshFn();
    setRefreshKey((k) => k + 1);
  };

  const filtered = filter === "all" ? items : items.filter((it) => it.sourceType === filter);

  const counts = items.reduce<Record<string, number>>((acc, it) => {
    acc[it.sourceType] = (acc[it.sourceType] ?? 0) + 1;
    acc.all = (acc.all ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="glass rounded-2xl overflow-hidden flex flex-col shadow-[var(--shadow-card)]">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3.5 sm:py-3 border-b border-border/60">
        <button
          className="flex items-center gap-2 flex-1 xl:cursor-default"
          onClick={() => setMobileExpanded((v) => !v)}
        >
          <Flame className="w-5 h-5 sm:w-4 sm:h-4 text-orange-400" />
          <span className="text-base sm:text-sm font-semibold">실시간 팩트체크 이슈</span>
          {items.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/20 text-primary font-medium">
              {items.length}건
            </span>
          )}
          <span className="ml-auto xl:hidden text-muted-foreground">
            {mobileExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </span>
        </button>
        <button
          onClick={handleRefresh}
          disabled={isLoading}
          title="새로고침"
          className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-all disabled:opacity-40 ml-2"
        >
          <RefreshCw className={`w-4 h-4 sm:w-3.5 sm:h-3.5 ${isLoading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* 모바일에서 접힌 상태면 숨김 */}
      <div className={`xl:contents ${mobileExpanded ? "contents" : "hidden xl:contents"}`}>

      {/* 필터 탭 */}
      <div className="flex gap-1 px-3 py-2 border-b border-border/40 overflow-x-auto scrollbar-none">
        {FILTER_TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`shrink-0 px-3 sm:px-2.5 py-2 sm:py-1 rounded-md text-sm sm:text-xs font-medium transition-all min-h-[40px] sm:min-h-0 ${
              filter === key
                ? "bg-primary/20 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-surface-2"
            }`}
          >
            {label}
            {counts[key] !== undefined && (
              <span className="ml-1 opacity-60">({counts[key]})</span>
            )}
          </button>
        ))}
      </div>

      {/* 뉴스 리스트 */}
      <div className="flex-1 overflow-y-auto" style={{ maxHeight: "calc(100vh - 280px)", minHeight: "400px" }}>
        {isLoading && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="w-6 h-6 border-2 border-accent/40 border-t-accent rounded-full animate-spin" />
            <p className="text-xs text-muted-foreground">뉴스 수집 중…</p>
          </div>
        )}

        {isError && !isLoading && (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-center px-4">
            <p className="text-sm text-muted-foreground">뉴스를 불러오지 못했습니다.</p>
            <button onClick={() => refetch()} className="text-xs text-primary hover:underline">
              다시 시도
            </button>
          </div>
        )}

        {!isLoading && !isError && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <Newspaper className="w-6 h-6 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">해당 카테고리 이슈가 없습니다.</p>
            {(filter === "community" || filter === "social") && (
              <p className="text-[10px] text-muted-foreground/50 text-center px-4">
                {filter === "community"
                  ? "DC인사이드·FM코리아가 접근을 차단하거나 응답하지 않을 수 있습니다."
                  : "X(Twitter) Nitter 인스턴스가 현재 응답하지 않을 수 있습니다."}
              </p>
            )}
          </div>
        )}

        {!isLoading && filtered.length > 0 && (
          <ul className="divide-y divide-border/30">
            {filtered.map((item, idx) => {
              const meta = SOURCE_META[item.sourceType] ?? SOURCE_META.news;
              const Icon = meta.Icon;
              const isAnalyzing = analyzingId === item.id;
              const isDisabled = analyzingId !== null;
              return (
                <li
                  key={item.id}
                  className={`group px-4 py-3.5 sm:py-3 transition-colors ${
                    isDisabled ? "opacity-60" : "hover:bg-surface-2/40"
                  }`}
                >
                  <div className="flex gap-3 items-start">
                    {/* 순위 번호 */}
                    <span
                      className={`shrink-0 w-6 h-6 sm:w-5 sm:h-5 mt-0.5 rounded text-xs sm:text-[10px] font-bold flex items-center justify-center ${
                        idx < 3
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground/50"
                      }`}
                    >
                      {idx + 1}
                    </span>

                    <div className="flex-1 min-w-0">
                      {/* 제목: 클릭 시 팩트체크 분석 시작 */}
                      <button
                        type="button"
                        disabled={isDisabled}
                        onClick={() => handleAnalyze(item)}
                        className="text-left w-full group/title disabled:cursor-not-allowed"
                        title="클릭하면 팩트체크로 주장 분석을 시작합니다"
                      >
                        <span className="text-sm sm:text-xs leading-relaxed text-foreground/90 line-clamp-2 group-hover/title:text-primary transition-colors">
                          {isAnalyzing ? (
                            <span className="inline-flex items-center gap-1.5">
                              <RefreshCw className="w-3 h-3 animate-spin text-primary shrink-0" />
                              <span className="text-primary">분석 중…</span>
                            </span>
                          ) : (
                            item.title
                          )}
                        </span>
                        {/* 호버시 분석 힌트 */}
                        <span className="hidden group-hover/title:inline-flex sm:hidden items-center gap-1 mt-1 text-[10px] font-medium text-primary">
                          <Search className="w-2.5 h-2.5" />
                          팩트체크 분석하기
                        </span>
                      </button>

                      {/* 메타 정보 */}
                      <div className="flex items-center gap-2 mt-2 sm:mt-1.5 flex-wrap">
                        <span className={`inline-flex items-center gap-1 px-2 sm:px-1.5 py-1 sm:py-0.5 rounded border text-xs sm:text-[10px] font-medium ${meta.bg} ${meta.color}`}>
                          <Icon className="w-3 h-3 sm:w-2.5 sm:h-2.5" />
                          {item.source}
                        </span>
                        {item.pubDate && (
                          <span className="text-xs sm:text-[10px] text-muted-foreground/60">
                            {timeAgo(item.pubDate)}
                          </span>
                        )}
                        {/* 데스크톱: 호버시 "분석하기" 힌트 */}
                        <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                          <Search className="w-2.5 h-2.5" />
                          클릭하여 분석
                        </span>
                      </div>
                    </div>

                    {/* 외부 링크 버튼 (원문 보기) */}
                    <div className="shrink-0 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                      <a
                        href={item.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        title="원문 보기"
                        className="p-2 sm:p-1.5 rounded-md bg-surface-2 hover:bg-border text-muted-foreground transition-all flex items-center"
                      >
                        <ExternalLink className="w-4 h-4 sm:w-3 sm:h-3" />
                      </a>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* 푸터 */}
      <div className="border-t border-border/40 px-4 py-2.5 sm:py-2">
        <p className="text-xs sm:text-[10px] text-muted-foreground/50 text-center">
          매일 9시·14시(KST) 업데이트 · 뉴스·정부·네이버·YouTube·DC인사이드·FM코리아·X(Twitter)
        </p>
      </div>

      </div>{/* 모바일 접힘 끝 */}
    </div>
  );
}
