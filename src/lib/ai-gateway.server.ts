import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

export type SupportedProvider = "gemini" | "openai" | "anthropic";

const MODELS: Record<SupportedProvider, string> = {
  gemini: "gemini-2.5-flash",
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-20241022",
};

export function createModelInstance(provider: SupportedProvider, apiKey: string) {
  switch (provider) {
    case "openai":
      return createOpenAI({ apiKey })(MODELS.openai);
    case "anthropic":
      return createAnthropic({ apiKey })(MODELS.anthropic);
    case "gemini":
      return createGoogleGenerativeAI({ apiKey })(MODELS.gemini);
  }
}

