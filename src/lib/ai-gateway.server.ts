import { createGoogleGenerativeAI } from "@ai-sdk/google";

export function createGeminiProvider(apiKey: string) {
  return createGoogleGenerativeAI({ apiKey });
}
