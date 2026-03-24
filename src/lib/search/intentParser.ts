/**
 * Gemini-based multi-image intent parsing only (no retrieval).
 */

import {
  IntentParserService,
  createClipOnlyParsedIntent,
  type ParsedIntent,
} from "../prompt/gemeni";

const MULTI_IMAGE_GEMINI_BUDGET_EXCEEDED = "MULTI_IMAGE_GEMINI_BUDGET";

/**
 * Bounded Gemini intent parse: missing key / outer budget → CLIP-only ParsedIntent (retrieval still runs).
 */
export async function parseMultiImageIntentWithGuards(
  prepared: Buffer[],
  userPrompt: string,
): Promise<{ parsedIntent: ParsedIntent; geminiDegraded: boolean }> {
  const geminiBudgetMs = Math.max(
    1500,
    Number(process.env.MULTI_IMAGE_GEMINI_BUDGET_MS ?? 3000) || 3000,
  );
  const perCallTimeout = Math.max(
    1000,
    Number(process.env.MULTI_IMAGE_GEMINI_CALL_TIMEOUT_MS ?? 10000) || 10000,
  );
  const maxRetries = Math.max(
    0,
    Math.min(5, Number(process.env.GEMINI_INTENT_MAX_RETRIES ?? 2) || 2),
  );
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return {
      parsedIntent: createClipOnlyParsedIntent(prepared.length, userPrompt),
      geminiDegraded: true,
    };
  }
  const intentParser = new IntentParserService({
    apiKey,
    timeout: Math.min(perCallTimeout, geminiBudgetMs),
    maxRetries,
  });
  try {
    const parsedIntent = await Promise.race([
      intentParser.parseUserIntent(prepared, userPrompt),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error(MULTI_IMAGE_GEMINI_BUDGET_EXCEEDED)), geminiBudgetMs),
      ),
    ]);
    return { parsedIntent, geminiDegraded: false };
  } catch (e: any) {
    if (e?.message === MULTI_IMAGE_GEMINI_BUDGET_EXCEEDED) {
      console.warn("[multiImageIntent] Gemini budget exceeded, using CLIP-only intent");
      return {
        parsedIntent: createClipOnlyParsedIntent(prepared.length, userPrompt),
        geminiDegraded: true,
      };
    }
    throw e;
  }
}
