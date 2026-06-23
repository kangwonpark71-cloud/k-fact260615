import { describe, it, expect } from "vitest";
import {
  normalizeText,
  jaccardSimilarity,
  computeTextSimilarity,
  findSimilarAnalysis,
  SIMILARITY_THRESHOLD,
} from "./similarity";

describe("normalizeText", () => {
  it("splits Korean text into tokens stripping particles", () => {
    const tokens = normalizeText("대한민국은 민주공화국입니다");
    expect(tokens.length).toBeGreaterThanOrEqual(2);
    expect(tokens).toContain("대한민국");
    expect(tokens).toContain("민주공화국");
  });

  it("splits English text into lowercase tokens", () => {
    const tokens = normalizeText("Hello World Test");
    expect(tokens).toEqual(["hello", "world", "test"]);
  });

  it("strips punctuation", () => {
    const tokens = normalizeText("Hello, World! Test...");
    expect(tokens).toEqual(["hello", "world", "test"]);
  });

  it("removes very short tokens", () => {
    const tokens = normalizeText("a b c hello");
    expect(tokens).not.toContain("a");
    expect(tokens).not.toContain("b");
    expect(tokens).not.toContain("c");
    expect(tokens).toContain("hello");
  });

  it("handles mixed Korean and English text", () => {
    const tokens = normalizeText("AI 기술은 Future입니다");
    expect(tokens.length).toBeGreaterThanOrEqual(3);
  });

  it("returns empty array for empty input", () => {
    expect(normalizeText("")).toEqual([]);
  });

  it("returns empty array for only punctuation", () => {
    expect(normalizeText("...!!! ???")).toEqual([]);
  });
});

describe("jaccardSimilarity", () => {
  it("returns 1 for identical token sets", () => {
    const tokens = ["hello", "world", "test"];
    expect(jaccardSimilarity(tokens, tokens)).toBe(1);
  });

  it("returns 0 for disjoint token sets", () => {
    expect(jaccardSimilarity(["a", "b"], ["c", "d"])).toBe(0);
  });

  it("returns correct value for partially overlapping sets", () => {
    expect(jaccardSimilarity(["a", "b", "c"], ["a", "b", "d"])).toBeCloseTo(0.5, 2);
  });

  it("handles empty arrays", () => {
    expect(jaccardSimilarity([], [])).toBe(0);
    expect(jaccardSimilarity(["a"], [])).toBe(0);
    expect(jaccardSimilarity([], ["a"])).toBe(0);
  });

  it("handles duplicate tokens in input", () => {
    expect(jaccardSimilarity(["a", "a", "b"], ["a", "b"])).toBe(1);
  });
});

describe("computeTextSimilarity", () => {
  it("returns 1 for identical text", () => {
    const sim = computeTextSimilarity("대한민국 서울", "대한민국 서울");
    expect(sim).toBe(1);
  });

  it("returns high similarity for similar text with different order", () => {
    const sim = computeTextSimilarity("서울 대한민국 인구", "대한민국 서울 인구");
    expect(sim).toBeGreaterThan(0.6);
  });

  it("returns low similarity for different text", () => {
    const sim = computeTextSimilarity("날씨가 좋습니다", "주식 시장이 폭락했습니다");
    expect(sim).toBeLessThan(0.3);
  });

  it("handles empty text gracefully", () => {
    expect(computeTextSimilarity("", "hello world")).toBe(0);
    expect(computeTextSimilarity("hello", "")).toBe(0);
    expect(computeTextSimilarity("", "")).toBe(0);
  });
});

describe("findSimilarAnalysis", () => {
  const recent = [
    { id: "id-1", inputText: "대한민국 경제 성장률이 3%입니다" },
    { id: "id-2", inputText: "오늘 날씨가 매우 좋습니다" },
    { id: "id-3", inputText: "서울 인구가 천만 명을 넘었습니다" },
  ];

  it("returns matching analysis when similarity exceeds threshold", () => {
    const result = findSimilarAnalysis(
      "대한민국 경제 성장률 3% 입니다",
      recent,
      SIMILARITY_THRESHOLD,
    );
    expect(result).not.toBeNull();
    expect(result!.id).toBe("id-1");
  });

  it("returns null when no analysis meets threshold", () => {
    const result = findSimilarAnalysis(
      "원자핵 물리학의 양자 역학 이론",
      recent,
      SIMILARITY_THRESHOLD,
    );
    expect(result).toBeNull();
  });

  it("returns null for empty recent list", () => {
    const result = findSimilarAnalysis("hello world", [], SIMILARITY_THRESHOLD);
    expect(result).toBeNull();
  });

  it("returns null for empty input text", () => {
    const result = findSimilarAnalysis("", recent, SIMILARITY_THRESHOLD);
    expect(result).toBeNull();
  });

  it("uses highest similarity match", () => {
    const similar = [
      { id: "a", inputText: "경제 성장률" },
      { id: "b", inputText: "경제 성장률 3% 대한민국" },
    ];
    const result = findSimilarAnalysis("경제 성장률 3% 대한민국", similar, 0.3);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("b");
  });

  it("accepts custom threshold", () => {
    const resultLow = findSimilarAnalysis("대한민국 경제", recent, 0.05);
    expect(resultLow).not.toBeNull();

    const resultHigh = findSimilarAnalysis("대한민국 경제", recent, 0.99);
    expect(resultHigh).toBeNull();
  });
});
