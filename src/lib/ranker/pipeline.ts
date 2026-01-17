/**
 * Ranker Pipeline - End-to-end ranking with XGBoost model
 * 
 * Pipeline:
 * 1. Generate candidates (from candidates.service)
 * 2. Compute rule scores (style/color/etc.)
 * 3. Build feature rows for each candidate
 * 4. Call /predict (or fallback to heuristic)
 * 5. Sort by returned score
 */
import type { CandidateResult, CandidateGeneratorResult } from "../../routes/products/types";
import { buildFeatureRows, type BaseProductContext, type CandidateWithScores } from "./features";
import { predictWithFallback, isRankerAvailable, type RankerFeatureRow } from "./client";

// ============================================================================
// Types
// ============================================================================

export interface RankedCandidateResult extends CandidateResult {
  // Original scores
  clipSim: number;
  textSim: number;
  opensearchScore: number;
  
  // Rule-based scores
  styleScore: number;
  colorScore: number;
  formalityScore: number;
  occasionScore: number;
  
  // Final ranking
  rankerScore: number;          // Score from model (or heuristic)
  rankPosition: number;         // Final position after ranking
  rankSource: "model" | "heuristic";
}

export interface RankingOptions {
  /** Use model if available, otherwise fallback to heuristic */
  useModel?: boolean;
  /** Limit final results */
  limit?: number;
  /** Minimum ranker score threshold */
  minScore?: number;
  /** Log timing and debug info */
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
// Pipeline Functions
// ============================================================================

/**
 * Main pipeline: rank candidates using the XGBoost model
 * 
 * @param baseProduct - The source product context
 * @param candidates - Candidates from getCandidateScoresForProducts
 * @param options - Ranking options
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
  
  // Step 1: Build feature rows (rule-based scoring happens here)
  const featureBuildStart = Date.now();
  const candidatesWithScores = buildFeatureRows(baseProduct, candidates);
  const featureBuildMs = Date.now() - featureBuildStart;
  
  if (debug) {
    console.log(`[RankerPipeline] Built ${candidatesWithScores.length} feature rows in ${featureBuildMs}ms`);
  }
  
  // Step 2: Call model (or heuristic fallback)
  const modelCallStart = Date.now();
  let scores: number[];
  let rankSource: "model" | "heuristic";
  let modelAvailable = false;
  
  if (useModel) {
    modelAvailable = await isRankerAvailable();
    
    const featureRows = candidatesWithScores.map(c => c.featureRow);
    const result = await predictWithFallback(featureRows);
    scores = result.scores;
    rankSource = result.source;
  } else {
    // Force heuristic
    scores = candidatesWithScores.map(c => computeHeuristicScore(c));
    rankSource = "heuristic";
  }
  
  const modelCallMs = Date.now() - modelCallStart;
  
  if (debug) {
    console.log(`[RankerPipeline] Got ${scores.length} scores from ${rankSource} in ${modelCallMs}ms`);
  }
  
  // Step 3: Attach scores and sort
  const rankedCandidates: RankedCandidateResult[] = candidatesWithScores
    .map((c, idx) => ({
      ...c.candidate,
      // Rule scores
      styleScore: c.ruleScores.styleScore,
      colorScore: c.ruleScores.colorScore,
      formalityScore: c.ruleScores.formalityScore,
      occasionScore: c.ruleScores.occasionScore,
      // Ranker score
      rankerScore: scores[idx] ?? 0,
      rankPosition: 0, // Will be set after sorting
      rankSource,
    }))
    .filter(c => c.rankerScore >= minScore)
    .sort((a, b) => b.rankerScore - a.rankerScore)
    .slice(0, limit)
    .map((c, idx) => ({ ...c, rankPosition: idx + 1 }));
  
  const totalMs = Date.now() - startTime;
  
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
      timings: {
        featureBuildMs,
        modelCallMs,
        totalMs,
      },
    },
  };
}

/**
 * Heuristic score computation (used as fallback)
 */
function computeHeuristicScore(candidate: CandidateWithScores): number {
  const { featureRow, ruleScores } = candidate;
  
  return (
    (featureRow.clip_sim ?? 0) * 0.30 +
    (featureRow.text_sim ?? 0) * 0.20 +
    ruleScores.styleScore * 0.20 +
    ruleScores.colorScore * 0.15 +
    (featureRow.phash_sim ?? 0) * 0.10 +
    (featureRow.same_brand ?? 0) * 0.05
  );
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Full pipeline: generate candidates + rank with model
 * 
 * This is the main entry point for the recommendation system.
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
  // Dynamic import to avoid circular dependency
  const { getCandidateScoresForProducts } = await import("../../routes/products/products.service");
  const { pg } = await import("../core");
  
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
  
  // Step 1: Generate candidates
  const genResult = await getCandidateScoresForProducts({
    baseProductId,
    limit: candidateLimit,
    clipLimit,
    textLimit,
    usePHashDedup,
  });
  
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
  
  // Fetch base product info for context
  const baseRes = await pg.query(
    `SELECT id, title, brand, category, color, price_cents, vendor_id FROM products WHERE id = $1`,
    [parseInt(baseProductId, 10)]
  );
  
  if (baseRes.rows.length === 0) {
    throw new Error(`Base product not found: ${baseProductId}`);
  }
  
  const baseRow = baseRes.rows[0];
  const baseContext: BaseProductContext = {
    id: baseRow.id,
    title: baseRow.title,
    brand: baseRow.brand,
    category: baseRow.category,
    color: baseRow.color,
    priceCents: baseRow.price_cents,
    vendorId: baseRow.vendor_id,
  };
  
  // Step 2: Rank with model
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
