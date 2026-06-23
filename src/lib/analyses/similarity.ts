export const SIMILARITY_THRESHOLD = 0.65;
const MIN_TOKEN_LENGTH = 2;
const MAX_INPUT_TOKENS = 500;

const KOREAN_PARTICLE_PATTERN =
  /^(은|는|이|가|을|를|의|에|에서|으로|로|과|와|도|만|부터|까지|하다|입니다|습니다|이다|다)$/;

const TRAILING_PARTICLE_PATTERN =
  /(이|가|은|는|을|를|의|에|도|만|까지|부터|로|으로|과|와|에서|하다|입니다|습니다|이다|다)$/;

export type RecentAnalysisRow = {
  readonly id: string;
  readonly inputText: string;
};

function stripTrailingParticle(token: string): string {
  return token.replace(TRAILING_PARTICLE_PATTERN, "");
}

function isStopword(token: string): boolean {
  return KOREAN_PARTICLE_PATTERN.test(token) || token.length < MIN_TOKEN_LENGTH;
}

export function normalizeText(text: string): string[] {
  const cleaned = text
    .replace(/[^\w\s\uAC00-\uD7A3\u3131-\u318E\u1100-\u11FF]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (!cleaned) return [];

  const tokens = cleaned.split(/\s+/).slice(0, MAX_INPUT_TOKENS);
  return tokens.map(stripTrailingParticle).filter((t) => !isStopword(t));
}

function uniqueSorted(tokens: string[]): string[] {
  return [...new Set(tokens)].sort();
}

export function jaccardSimilarity(tokensA: string[], tokensB: string[]): number {
  if (tokensA.length === 0 && tokensB.length === 0) return 0;

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);

  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }

  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

export function computeTextSimilarity(textA: string, textB: string): number {
  if (!textA || !textB) return 0;

  const tokensA = normalizeText(textA);
  const tokensB = normalizeText(textB);

  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  return jaccardSimilarity(tokensA, tokensB);
}

export function findSimilarAnalysis(
  inputText: string,
  recentAnalyses: readonly RecentAnalysisRow[],
  threshold: number,
): RecentAnalysisRow | null {
  if (!inputText || recentAnalyses.length === 0) return null;
  if (threshold <= 0) return null;

  const inputTokens = normalizeText(inputText);
  if (inputTokens.length === 0) return null;

  let bestMatch: RecentAnalysisRow | null = null;
  let bestScore = threshold;

  for (const row of recentAnalyses) {
    if (!row.inputText) continue;

    const rowTokens = normalizeText(row.inputText);
    if (rowTokens.length === 0) continue;

    const score = jaccardSimilarity(inputTokens, rowTokens);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = row;
    }
  }

  return bestMatch;
}
