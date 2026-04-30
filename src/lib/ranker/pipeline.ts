/**
 * Ranker Pipeline - End-to-end ranking with XGBoost model
 *
 * Pipeline:
 * 1. Receive base product context from caller (no internal DB fetch)
 * 2. Build feature rows for each candidate
 * 3. Call /predict (or fallback to heuristic with explicit logging)
 * 4. Assert score array length before mapping
 * 5. Sort by returned score, attach rank position
 *
 * Changes from original:
 * - Removed pg.query() and dynamic imports from getAndRankCandidates
 * - Added score array length assertion with safe fallback
 * - Heuristic weights moved to HEURISTIC_WEIGHTS config constant
 * - Metrics emitted unconditionally (not just in debug mode)
 * - Added retry logic around model call
 * - getBaseProductContext() extracted as a standalone helper
 */

import type { CandidateResult, CandidateGeneratorResult } from "../../routes/products/types";
import { buildFeatureRows, type BaseProductContext, type CandidateWithScores } from "./features";
import { predictWithFallback, isRankerAvailable, type RankerFeatureRow } from "./client";
import { getCandidateScoresForProducts } from "../../routes/products/products.service";
import { pg } from "../core";

// ============================================================================
// Config
// ============================================================================

/**
 * Heuristic fallback weights — edit here or override via env for experiments.
 * Must sum to 1.0.
 */
const HEURISTIC_WEIGHTS = {
  clip_sim:   Number(process.env.HW_CLIP_SIM   ?? 0.25),  // visual similarity
  text_sim:   Number(process.env.HW_TEXT_SIM   ?? 0.15),  // keyword relevance
  styleScore: Number(process.env.HW_STYLE      ?? 0.28),  // formality + occasion coherence
  colorScore: Number(process.env.HW_COLOR      ?? 0.22),  // color harmony
  phash_sim:  Number(process.env.HW_PHASH      ?? 0.05),  // near-duplicate visual match
  same_brand: Number(process.env.HW_SAME_BRAND ?? 0.05),  // brand cohesion
} as const;

/** Max times to retry the model before falling back to heuristic. */
const MODEL_RETRY_ATTEMPTS = Number(process.env.RANKER_RETRY_ATTEMPTS ?? 2);
/** Delay between retries in ms. */
const MODEL_RETRY_DELAY_MS = Number(process.env.RANKER_RETRY_DELAY_MS ?? 50);

// ============================================================================
// Types
// ============================================================================

export interface RankedCandidateResult extends CandidateResult {
  clipSim: number;
  textSim: number;
  opensearchScore: number;

  styleScore: number;
  colorScore: number;
  formalityScore: number;
  occasionScore: number;

  rankerScore: number;
  rankPosition: number;
  rankSource: "model" | "heuristic";
}

export interface RankingOptions {
  useModel?: boolean;
  limit?: number;
  minScore?: number;
  debug?: boolean;
}

export interface RankingResult {
  candidates: RankedCandidateResult[];
  meta: {
    inputCount: number;
    outputCount: number;
    rankSource: "model" | "heuristic";
    modelAvailable: boolean;
    timings: {
      featureBuildMs: number;
      modelCallMs: number;
      totalMs: number;
    };
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Emit a metric. Replace with your actual metrics client
 * (Datadog, Prometheus, CloudWatch, etc.).
 */
function emitMetric(name: string, value: number, tags: Record<string, string> = {}): void {
  // TODO: replace with real metrics client
  // e.g. dogstatsd.gauge(name, value, tags)
  if (process.env.NODE_ENV !== "test") {
    console.log(`[metric] ${name}=${value}`, tags);
  }
}

/**
 * Sleep helper for retry backoff.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Call the model with retry. Falls back to heuristic only after all attempts
 * fail, and logs explicitly when that happens.
 */
async function predictWithRetry(
  featureRows: Partial<RankerFeatureRow>[],
  candidates: CandidateWithScores[],
  attempts: number,
  delayMs: number,
): Promise<{ scores: number[]; source: "model" | "heuristic" }> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const result = await predictWithFallback(featureRows);
      if (result.source === "model") {
        return result;
      }
      // Model was unreachable on this attempt — retry unless last attempt
      if (attempt < attempts) {
        await sleep(delayMs);
      }
    } catch (err) {
      console.error(`[RankerPipeline] Model call error (attempt ${attempt}/${attempts}):`, err);
      if (attempt < attempts) {
        await sleep(delayMs);
      }
    }
  }

  // All attempts exhausted — fall back to heuristic with explicit signal
  console.warn(
    `[RankerPipeline] Model unavailable after ${attempts} attempts. Falling back to heuristic.`
  );
  emitMetric("ranker.model_fallback", 1);
  return {
    scores: candidates.map(c => computeHeuristicScore(c)),
    source: "heuristic",
  };
}

// ============================================================================
// Core Pipeline
// ============================================================================

/**
 * Main ranking function.
 *
 * Accepts a fully-hydrated BaseProductContext — callers are responsible
 * for fetching the base product before calling this. This keeps the
 * ranker testable in isolation without a DB dependency.
 */
export async function rankCandidatesWithModel(
  baseProduct: BaseProductContext,
  candidates: CandidateResult[],
  options: RankingOptions = {}
): Promise<RankingResult> {
  const startTime = Date.now();
  const {
    useModel = true,
    limit = candidates.length,
    minScore = 0,
    debug = false,
  } = options;

  if (candidates.length === 0) {
    return {
      candidates: [],
      meta: {
        inputCount: 0,
        outputCount: 0,
        rankSource: "heuristic",
        modelAvailable: false,
        timings: { featureBuildMs: 0, modelCallMs: 0, totalMs: 0 },
      },
    };
  }

  // Step 1: Build feature rows
  const featureBuildStart = Date.now();
  const candidatesWithScores = buildFeatureRows(baseProduct, candidates);
  const featureBuildMs = Date.now() - featureBuildStart;

  if (debug) {
    console.log(`[RankerPipeline] Built ${candidatesWithScores.length} feature rows in ${featureBuildMs}ms`);
  }

  // Step 2: Call model (with retry) or force heuristic
  const modelCallStart = Date.now();
  let scores: number[];
  let rankSource: "model" | "heuristic";
  let modelAvailable = false;

  if (useModel) {
    modelAvailable = await isRankerAvailable();
    const featureRows = candidatesWithScores.map(c => c.featureRow);

    const result = await predictWithRetry(
      featureRows,
      candidatesWithScores,
      MODEL_RETRY_ATTEMPTS,
      MODEL_RETRY_DELAY_MS,
    );
    scores = result.scores;
    rankSource = result.source;
  } else {
    scores = candidatesWithScores.map(c => computeHeuristicScore(c));
    rankSource = "heuristic";
  }

  const modelCallMs = Date.now() - modelCallStart;

  // Step 3: Assert score array integrity before mapping
  if (scores.length !== candidatesWithScores.length) {
    console.error(
      `[RankerPipeline] Score count mismatch: got ${scores.length}, expected ${candidatesWithScores.length}. Falling back to heuristic.`
    );
    emitMetric("ranker.score_mismatch", 1, { source: rankSource });
    scores = candidatesWithScores.map(c => computeHeuristicScore(c));
    rankSource = "heuristic";
  }

  if (debug) {
    console.log(`[RankerPipeline] Got ${scores.length} scores from ${rankSource} in ${modelCallMs}ms`);
  }

  // Step 4: Attach scores, filter, sort, slice, assign rank positions
  const rankedCandidates: RankedCandidateResult[] = candidatesWithScores
    .map((c, idx) => ({
      ...c.candidate,
      styleScore:     c.ruleScores.styleScore,
      colorScore:     c.ruleScores.colorScore,
      formalityScore: c.ruleScores.formalityScore,
      occasionScore:  c.ruleScores.occasionScore,
      rankerScore:    scores[idx]!,  // safe: length asserted above
      rankPosition:   0,
      rankSource,
    }))
    .filter(c => c.rankerScore >= minScore)
    .sort((a, b) => b.rankerScore - a.rankerScore)
    .slice(0, limit)
    .map((c, idx) => ({ ...c, rankPosition: idx + 1 }));

  const totalMs = Date.now() - startTime;

  // Always emit timing metrics — not gated on debug flag
  emitMetric("ranker.feature_build_ms", featureBuildMs);
  emitMetric("ranker.model_call_ms", modelCallMs);
  emitMetric("ranker.total_ms", totalMs);
  emitMetric("ranker.source_is_model", rankSource === "model" ? 1 : 0);
  emitMetric("ranker.output_count", rankedCandidates.length);

  if (debug) {
    console.log(`[RankerPipeline] Ranked ${rankedCandidates.length} candidates in ${totalMs}ms total`);
  }

  return {
    candidates: rankedCandidates,
    meta: {
      inputCount: candidates.length,
      outputCount: rankedCandidates.length,
      rankSource,
      modelAvailable,
      timings: { featureBuildMs, modelCallMs, totalMs },
    },
  };
}

/**
 * Heuristic fallback score. Weights configurable via HEURISTIC_WEIGHTS.
 */
function computeHeuristicScore(candidate: CandidateWithScores): number {
  const { featureRow, ruleScores } = candidate;
  return (
    (featureRow.clip_sim  ?? 0) * HEURISTIC_WEIGHTS.clip_sim +
    (featureRow.text_sim  ?? 0) * HEURISTIC_WEIGHTS.text_sim +
    ruleScores.styleScore        * HEURISTIC_WEIGHTS.styleScore +
    ruleScores.colorScore        * HEURISTIC_WEIGHTS.colorScore +
    (featureRow.phash_sim ?? 0) * HEURISTIC_WEIGHTS.phash_sim +
    (featureRow.same_brand ?? 0) * HEURISTIC_WEIGHTS.same_brand
  );
}

// ============================================================================
// DB Helper (extracted from getAndRankCandidates)
// ============================================================================

/**
 * Fetch the base product context from the database.
 * Separated from the ranking pipeline so callers can hydrate this
 * independently (e.g. from cache, from a request context, etc.).
 */
export async function getBaseProductContext(baseProductId: string): Promise<BaseProductContext> {
  const baseRes = await pg.query(
    `SELECT id, title, brand, category, color, price_cents, vendor_id
     FROM products WHERE id = $1`,
    [parseInt(baseProductId, 10)]
  );
  if (baseRes.rows.length === 0) {
    throw new Error(`Base product not found: ${baseProductId}`);
  }
  const r = baseRes.rows[0];
  return {
    id:          r.id,
    title:       r.title,
    brand:       r.brand,
    category:    r.category,
    color:       r.color,
    priceCents:  r.price_cents,
    vendorId:    r.vendor_id,
  };
}

// ============================================================================
// Convenience Entry Point
// ============================================================================

/**
 * Full pipeline: generate candidates → fetch base product → rank with model.
 *
 * This is the main entry point for the recommendation system.
 * No dynamic imports, no circular dependency workarounds.
 */
export async function getAndRankCandidates(
  baseProductId: string,
  options: {
    candidateLimit?: number;
    clipLimit?: number;
    textLimit?: number;
    usePHashDedup?: boolean;
    useModel?: boolean;
    finalLimit?: number;
    minScore?: number;
    debug?: boolean;
  } = {}
): Promise<{
  candidates: RankedCandidateResult[];
  generatorMeta: CandidateGeneratorResult["meta"];
  rankingMeta: RankingResult["meta"];
}> {
  const {
    candidateLimit = 100,
    clipLimit = 200,
    textLimit = 200,
    usePHashDedup = true,
    useModel = true,
    finalLimit = 30,
    minScore = 0,
    debug = false,
  } = options;

  // Run candidate generation and base product fetch in parallel
  const [genResult, baseContext] = await Promise.all([
    getCandidateScoresForProducts({
      baseProductId,
      limit: candidateLimit,
      clipLimit,
      textLimit,
      usePHashDedup,
    }),
    getBaseProductContext(baseProductId),
  ]);

  if (genResult.candidates.length === 0) {
    return {
      candidates: [],
      generatorMeta: genResult.meta,
      rankingMeta: {
        inputCount: 0,
        outputCount: 0,
        rankSource: "heuristic",
        modelAvailable: false,
        timings: { featureBuildMs: 0, modelCallMs: 0, totalMs: 0 },
      },
    };
  }

  const rankResult = await rankCandidatesWithModel(baseContext, genResult.candidates, {
    useModel,
    limit: finalLimit,
    minScore,
    debug,
  });

  return {
    candidates: rankResult.candidates,
    generatorMeta: genResult.meta,
    rankingMeta: rankResult.meta,
  };
}