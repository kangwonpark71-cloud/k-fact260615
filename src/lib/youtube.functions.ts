import { createServerFn } from "@tanstack/react-start";
import { YoutubeTranscript } from "youtube-transcript";
import { z } from "zod";

// ── URL 감지 유틸 ──

export function isYouTubeUrl(url: string): boolean {
  return /(?:youtube\.com\/(?:watch|shorts|embed|live)|youtu\.be\/)/.test(url);
}

export function extractYouTubeId(url: string): string | null {
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /\/shorts\/([a-zA-Z0-9_-]{11})/,
    /\/embed\/([a-zA-Z0-9_-]{11})/,
    /\/live\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

// ── oEmbed (API 키 불필요) ──

interface OEmbed {
  title: string;
  author_name: string;
  thumbnail_url: string;
}

async function getOEmbed(videoUrl: string): Promise<OEmbed> {
  const res = await fetch(
    `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`,
    {
      headers: { "User-Agent": "KFactBot/1.0" },
      signal: AbortSignal.timeout(6000),
    },
  );
  if (!res.ok) throw new Error(`oEmbed ${res.status}`);
  return res.json() as Promise<OEmbed>;
}

// ── 자막 추출 (youtube-transcript 패키지 사용) ──

async function getTranscript(videoId: string): Promise<string> {
  // 한국어 우선, 실패 시 영어, 실패 시 언어 미지정(첫 번째 트랙)
  const attempts: Array<{ lang?: string }> = [{ lang: "ko" }, { lang: "en" }, {}];

  for (const opts of attempts) {
    try {
      const segments = await YoutubeTranscript.fetchTranscript(videoId, opts);
      if (segments.length === 0) continue;

      // 연속 중복 제거 (자동 자막에서 반복 텍스트 발생 방지)
      const deduped: string[] = [];
      for (const seg of segments) {
        const line = seg.text.trim();
        if (line && deduped[deduped.length - 1] !== line) deduped.push(line);
      }

      return deduped.join(" ");
    } catch {
      // 다음 옵션으로 폴백
    }
  }

  throw new Error("이 영상에는 자막(자동 생성 포함)이 없습니다");
}

// ── 공개 타입 ──

export interface YouTubeInfo {
  videoId: string;
  url: string;
  title: string;
  author: string;
  thumbnailUrl: string;
  transcript: string;
  transcriptAvailable: boolean;
  transcriptLang: string;
  isShorts: boolean;
  charCount: number;
}

// ── 서버 함수 ──

export const fetchYouTubeInfo = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ url: z.string().url() }).parse(input))
  .handler(async ({ data }): Promise<YouTubeInfo> => {
    const videoId = extractYouTubeId(data.url);
    if (!videoId) throw new Error("유효하지 않은 YouTube URL입니다");

    const isShorts = /\/shorts\//.test(data.url);
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;

    const [oembedResult, transcriptResult] = await Promise.allSettled([
      getOEmbed(watchUrl),
      getTranscript(videoId),
    ]);

    const title =
      oembedResult.status === "fulfilled" ? oembedResult.value.title : `YouTube 영상 ${videoId}`;
    const author =
      oembedResult.status === "fulfilled" ? oembedResult.value.author_name : "알 수 없음";
    const thumbnailUrl =
      oembedResult.status === "fulfilled"
        ? oembedResult.value.thumbnail_url
        : `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;

    const transcriptAvailable = transcriptResult.status === "fulfilled";
    const transcript = transcriptAvailable ? transcriptResult.value : "";

    // 자막 없을 때 → 제목만으로 최소한의 팩트체크 컨텍스트 구성
    const analysisText = transcriptAvailable
      ? `[YouTube ${isShorts ? "Shorts" : "영상"} 자막 전문]\n채널: ${author}\n제목: ${title}\n\n${transcript}`
      : `[YouTube ${isShorts ? "Shorts" : "영상"} (자막 없음)]\n채널: ${author}\n제목: ${title}\n\n※ 자막이 없어 제목만으로 분석합니다.`;

    return {
      videoId,
      url: data.url,
      title,
      author,
      thumbnailUrl,
      transcript: analysisText,
      transcriptAvailable,
      transcriptLang: transcriptAvailable ? "감지됨" : "없음",
      isShorts,
      charCount: analysisText.length,
    };
  });
