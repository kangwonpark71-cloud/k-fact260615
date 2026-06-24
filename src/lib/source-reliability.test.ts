import { describe, expect, it } from "vitest";

import { scoreSourceReliability } from "./source-reliability";

describe("scoreSourceReliability", () => {
  it("marks Korean official domains as authoritative", () => {
    const result = scoreSourceReliability({
      url: "https://www.mofa.go.kr/www/brd/m_4080/view.do",
      searchScore: 0.42,
    });

    expect(result.hostname).toBe("mofa.go.kr");
    expect(result.tier).toBe("authoritative");
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.reasons.some((reason) => reason.includes("정부"))).toBe(true);
  });

  it("scores public health and academic sources highly", () => {
    const result = scoreSourceReliability({
      url: "https://www.who.int/news/item/example",
      searchScore: 0.3,
    });

    expect(result.tier).toBe("authoritative");
    expect(result.score).toBeGreaterThanOrEqual(85);
  });

  it("scores major news and fact-check sources below official sources", () => {
    const result = scoreSourceReliability({
      url: "https://www.reuters.com/world/example",
      searchScore: 0.8,
    });

    expect(result.tier).toBe("established");
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.score).toBeLessThan(90);
  });

  it("keeps community and social sources in a low tier", () => {
    const result = scoreSourceReliability({
      url: "https://gall.dcinside.com/board/view/?id=dcbest&no=1",
      searchScore: 0.95,
    });

    expect(result.tier).toBe("weak");
    expect(result.score).toBeLessThan(50);
    expect(result.reasons.some((reason) => reason.includes("커뮤니티"))).toBe(true);
  });

  it("returns a bounded unknown result for invalid URLs", () => {
    const result = scoreSourceReliability({ url: "not a url", searchScore: 0.9 });

    expect(result.hostname).toBe("unknown");
    expect(result.tier).toBe("unknown");
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(40);
  });

  it("does not let search score make weak sources authoritative", () => {
    const result = scoreSourceReliability({
      url: "https://www.youtube.com/watch?v=abc",
      searchScore: 1,
    });

    expect(result.tier).toBe("weak");
    expect(result.score).toBeLessThan(60);
  });
});
