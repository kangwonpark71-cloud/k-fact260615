import { describe, it, expect, beforeAll } from "vitest";
import {
  extractStyleMetrics,
  buildStyleAnalysis,
  styleAnalysisToPromptBlock,
  rankSearchResults,
} from "./pipeline.server";

// getEnv를 테스트용으로 mock
import * as runtime from "./runtime-env.server";
beforeAll(() => {
  // TAVILY_API_KEY 없음 = searchEvidence가 [] 반환 (테스트 영향 없음)
  vi.spyOn(runtime, "getEnv").mockReturnValue(undefined);
});

describe("extractStyleMetrics", () => {
  it("일반적인 문장에서 모든 지표를 반환한다", () => {
    const text = "어제 서울의 기온이 30도까지 올랐습니다. 기상청에 따르면 이는 역대 6월 중 최고 기록이라고 밝혔습니다.";
    const m = extractStyleMetrics(text);
    expect(m).toHaveProperty("avgSentenceLength");
    expect(m).toHaveProperty("lexicalDiversity");
    expect(m).toHaveProperty("emotionScore");
    expect(m).toHaveProperty("exaggerationScore");
    expect(m).toHaveProperty("numericalDensity");
    expect(m).toHaveProperty("attributionScore");
    expect(m).toHaveProperty("punctuationAbuse");
    expect(m.avgSentenceLength).toBeGreaterThan(0);
    expect(m.lexicalDiversity).toBeGreaterThan(0);
  });

  it("감정어가 많은 텍스트에서 emotionScore가 높다", () => {
    const text = "이건 정말 충격적인 사건입니다! 완전히 말도 안 되는 일이에요! 엄청난 충격입니다!!";
    const m = extractStyleMetrics(text);
    expect(m.emotionScore).toBeGreaterThan(0.3);
  });

  it("과장 표현이 많은 텍스트에서 exaggerationScore가 높다", () => {
    const text = "이건 항상 그래왔다. 절대 변하지 않는다. 모든 사람이 다 안다. 결코 사실이 아니다. 100% 확실하다.";
    const m = extractStyleMetrics(text);
    expect(m.exaggerationScore).toBeGreaterThan(0.2);
  });

  it("출처 인용이 있으면 attributionScore가 0보다 크다", () => {
    const text = "통계청에 따르면 물가상승률이 2.3%라고 발표했습니다. 기획재정부에 의하면 내년 예산이 증가했다고 밝혔습니다.";
    const m = extractStyleMetrics(text);
    expect(m.attributionScore).toBeGreaterThan(0);
  });

  it("구두점 남용이 있으면 punctuationAbuse가 0보다 크다", () => {
    const text = "이게 진짜라고??? 말도 안 돼!!! 헐... 대박..";
    const m = extractStyleMetrics(text);
    expect(m.punctuationAbuse).toBeGreaterThan(0);
  });

  it("수치 표현이 있으면 numericalDensity가 0보다 크다", () => {
    const text = "GDP 성장률이 3.2%를 기록했습니다. 25만 명이 참여했고, 총 1조 5천억 원의 예산이 투입되었습니다.";
    const m = extractStyleMetrics(text);
    expect(m.numericalDensity).toBeGreaterThan(0);
  });

  it("빈 문자열이나 짧은 텍스트에서도 오류 없이 동작한다", () => {
    const m = extractStyleMetrics("");
    expect(m.avgSentenceLength).toBe(0);
    expect(m.emotionScore).toBe(0);

    const short = extractStyleMetrics("짧은 글");
    expect(short.lexicalDiversity).toBeGreaterThanOrEqual(0);
  });

  it("매우 긴 텍스트에서도 안정적으로 동작한다", () => {
    const sentences = Array.from({ length: 100 }, (_, i) =>
      `이것은 ${i + 1}번째 테스트 문장입니다. 기상청에 따르면 오늘 날씨는 맑을 예정이라고 합니다.`
    );
    const text = sentences.join(" ");
    const m = extractStyleMetrics(text);
    expect(m.avgSentenceLength).toBeGreaterThan(5);
    expect(m.lexicalDiversity).toBeGreaterThan(0);
  });
});

describe("buildStyleAnalysis", () => {
  it("감정적이고 과장된 텍스트에서 높은 fakeProbability와 신호를 반환한다", () => {
    const text = "이건 정말 충격적인 사건입니다!!! 절대 용납할 수 없습니다!! 항상 그래왔고 모든 사람이 다 압니다!";
    const result = buildStyleAnalysis(text);
    expect(result.fakeProbability).toBeGreaterThan(30);
    expect(result.signals.length).toBeGreaterThan(0);
  });

  it("중립적이고 출처가 명시된 텍스트에서 낮은 fakeProbability를 반환한다", () => {
    const text = "통계청에 따르면 2024년 한국의 GDP 성장률은 2.2%를 기록했습니다. 기획재정부가 1월 15일 발표한 자료에 근거합니다.";
    const result = buildStyleAnalysis(text);
    expect(result.fakeProbability).toBeLessThan(40);
    expect(result.signals.length).toBe(0);
  });

  it("빈 텍스트에서도 기본값을 반환한다", () => {
    const result = buildStyleAnalysis("");
    expect(result.fakeProbability).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(result.signals)).toBe(true);
    expect(result.metrics.avgSentenceLength).toBe(0);
  });

  it("반환된 fakeProbability는 0~100 범위를 벗어나지 않는다", () => {
    const texts = [
      "이건 정말 충격적이고 엄청난 사건입니다!!! 절대적으로 사실입니다!! 완벽하게 증명되었어요!",
      "일반적인 뉴스 기사 내용입니다. 여러 출처를 인용하여 작성되었습니다.",
      "",
      "a ".repeat(500),
    ];
    for (const text of texts) {
      const result = buildStyleAnalysis(text);
      expect(result.fakeProbability).toBeGreaterThanOrEqual(0);
      expect(result.fakeProbability).toBeLessThanOrEqual(100);
    }
  });
});

describe("styleAnalysisToPromptBlock", () => {
  it("Stage 1 헤더와 모든 지표를 포함한다", () => {
    const analysis = buildStyleAnalysis("테스트 문장입니다. 출처에 따르면 중요한 사실입니다.");
    const block = styleAnalysisToPromptBlock(analysis);
    expect(block).toContain("Stage 1");
    expect(block).toContain("가짜 가능성 지수");
    expect(block).toContain("어휘 다양성");
    expect(block).toContain("감정어 밀도");
    expect(block).toContain("과장 표현 밀도");
    expect(block).toContain("출처 인용 밀도");
  });

  it("신호가 있을 때 신호 목록을 포함한다", () => {
    const analysis = buildStyleAnalysis("정말 충격적입니다!!! 절대 이럴 수가!!! 모든 것이 거짓말입니다!!");
    const block = styleAnalysisToPromptBlock(analysis);
    expect(block).toContain("감지된 신호");
    expect(block).toContain("•");
  });

  it("신호가 없을 때 '의심 신호 없음'을 포함한다", () => {
    const analysis = buildStyleAnalysis("통계청 자료에 따르면 작년 수출액이 증가했습니다. 기획재정부에서는 이를 긍정적으로 평가했습니다.");
    const block = styleAnalysisToPromptBlock(analysis);
    expect(block).toContain("의심 신호 없음");
  });
});

describe("rankSearchResults", () => {
  const mockResults = [
    { title: "일반 뉴스", url: "https://news.com/article", snippet: "내용", score: 0.8 },
    { title: "외교부 자료", url: "https://mofa.go.kr/news", snippet: "내용", score: 0.7 },
    { title: "WHO 보고서", url: "https://who.int/report", snippet: "내용", score: 0.9 },
  ];

  it("DISPUTED_TERRITORY 타입에서 영토 권위 출처가 우선 정렬된다", () => {
    const ranked = rankSearchResults([...mockResults], "DISPUTED_TERRITORY");
    expect(ranked[0].url).toContain("mofa.go.kr");
  });

  it("OPINION 타입에서는 정렬 순서가 변경되지 않는다", () => {
    const original = [...mockResults];
    const ranked = rankSearchResults(original, "OPINION");
    expect(ranked).toEqual(original);
  });

  it("빈 배열에서도 오류 없이 빈 배열을 반환한다", () => {
    const ranked = rankSearchResults([], "EMPIRICAL");
    expect(ranked).toEqual([]);
  });
});
