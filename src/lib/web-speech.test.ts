import { describe, expect, it } from "vitest";

import {
  collectSpeechText,
  getSpeechRecognitionConstructor,
  mapMediaDeviceError,
  type BrowserSpeechRecognition,
  type SpeechRecognitionResultLike,
} from "./web-speech";

class FakeRecognition implements BrowserSpeechRecognition {
  lang = "ko-KR";
  continuous = true;
  interimResults = true;
  maxAlternatives = 1;
  onstart: (() => void) | null = null;
  onresult: BrowserSpeechRecognition["onresult"] = null;
  onerror: BrowserSpeechRecognition["onerror"] = null;
  onend: (() => void) | null = null;

  start(): void {}
  stop(): void {}
}

class PrefixedFakeRecognition extends FakeRecognition {}

function makeAlternative(transcript: string): SpeechRecognitionAlternativeLike {
  return { transcript };
}

type SpeechRecognitionAlternativeLike = {
  readonly transcript: string;
};

function makeResult(transcript: string, isFinal: boolean): SpeechRecognitionResultLike {
  return { 0: makeAlternative(transcript), length: 1, isFinal };
}

describe("getSpeechRecognitionConstructor", () => {
  it("returns the standard constructor when SpeechRecognition is available", () => {
    const scope = { SpeechRecognition: FakeRecognition };

    const result = getSpeechRecognitionConstructor(scope);

    expect(result).toBe(FakeRecognition);
  });

  it("returns the prefixed constructor when only webkitSpeechRecognition is available", () => {
    const scope = { webkitSpeechRecognition: PrefixedFakeRecognition };

    const result = getSpeechRecognitionConstructor(scope);

    expect(result).toBe(PrefixedFakeRecognition);
  });

  it("returns null when no browser speech recognition constructor is available", () => {
    const result = getSpeechRecognitionConstructor({});

    expect(result).toBeNull();
  });
});

describe("collectSpeechText", () => {
  it("separates final and interim transcripts from the recognition event", () => {
    const event = {
      resultIndex: 0,
      results: [makeResult("완료 문장", true), makeResult("작성 중", false)],
    };

    const result = collectSpeechText(event);

    expect(result).toEqual({ finalText: "완료 문장", interimText: "작성 중" });
  });

  it("starts reading at resultIndex", () => {
    const event = {
      resultIndex: 1,
      results: [makeResult("무시", true), makeResult("반영", true)],
    };

    const result = collectSpeechText(event);

    expect(result).toEqual({ finalText: "반영", interimText: "" });
  });
});

describe("mapMediaDeviceError", () => {
  it("maps browser permission errors to permission-denied", () => {
    const result = mapMediaDeviceError(new DOMException("denied", "NotAllowedError"));

    expect(result).toBe("permission-denied");
  });

  it("maps missing microphone errors to no-device", () => {
    const result = mapMediaDeviceError(new DOMException("missing", "NotFoundError"));

    expect(result).toBe("no-device");
  });

  it("maps unknown failures to unknown", () => {
    const result = mapMediaDeviceError(new Error("busy"));

    expect(result).toBe("unknown");
  });
});
