export type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

export type SpeechRecognitionGlobalScope = {
  readonly SpeechRecognition?: SpeechRecognitionConstructor;
  readonly webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

export type SpeechText = {
  readonly finalText: string;
  readonly interimText: string;
};

export type MediaDeviceErrorKind = "permission-denied" | "no-device" | "unknown";

export type SpeechRecognitionErrorCode =
  | "not-allowed"
  | "service-not-allowed"
  | "audio-capture"
  | "network"
  | string;

export type SpeechRecognitionAlternativeLike = {
  readonly transcript: string;
};

export type SpeechRecognitionResultLike = {
  readonly isFinal: boolean;
  readonly length: number;
  readonly 0: SpeechRecognitionAlternativeLike;
};

export type SpeechRecognitionResultListLike = {
  readonly length: number;
  readonly [index: number]: SpeechRecognitionResultLike;
};

export type SpeechRecognitionEventLike = {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultListLike;
};

export type SpeechRecognitionErrorEventLike = {
  readonly error: SpeechRecognitionErrorCode;
};

export interface BrowserSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

declare global {
  interface Window {
    readonly SpeechRecognition?: SpeechRecognitionConstructor;
    readonly webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

export function getSpeechRecognitionConstructor(
  scope: SpeechRecognitionGlobalScope,
): SpeechRecognitionConstructor | null {
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

export function collectSpeechText(event: SpeechRecognitionEventLike): SpeechText {
  let interimText = "";
  let finalText = "";

  for (let i = event.resultIndex; i < event.results.length; i += 1) {
    const result = event.results[i];
    const transcript = result[0].transcript;
    if (result.isFinal) {
      finalText += transcript;
    } else {
      interimText += transcript;
    }
  }

  return { finalText, interimText };
}

export function mapMediaDeviceError(error: unknown): MediaDeviceErrorKind {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
      return "permission-denied";
    }
    if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
      return "no-device";
    }
  }
  return "unknown";
}
