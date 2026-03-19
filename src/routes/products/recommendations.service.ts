/**
 * Recommendations Service
 * 
 * Business logic for similar product recommendations.
 * Uses the ML ranker pipeline to find and rank similar items.
 * 
 * New features:
 * - MMR (Maximal Marginal Relevance) for diversity
 * - Cold start handling with exploration boost
 * 
 * Different from Outfit Service:
 * - Outfit: "Complete my look" - suggests complementary categories (dress → shoes, bag)
 * - Recommendations: "Similar items" - suggests alternatives in same/similar categories
 */
import { getAndRankCandidates, applyMMR, type RankedCandidateResult } from "../../lib/ranker";
import { pg } from "../../lib/core";
import { logImpressionBatch, type RecommendationImpression, type LogImpressionBatchParams } from "../../lib/recommendations";
import { applyExplorationBoost } from "../../lib/recommendations/coldStart";

// ============================================================================
// Types
// ============================================================================

export interface RecommendationOptions {
  /** Max recommendations to return (default: 20) */
  limit?: number;
  /** Use ML model if available (default: true) */
  useModel?: boolean;
  /** Minimum score threshold (default: 0) */
  minScore?: number;
  /** Include debug timing info (default: false) */
  debug?: boolean;
  /** User ID for impression logging */
  userId?: string;
  /** Session ID for impression logging */
  sessionId?: string;
  /** MMR lambda parameter for diversity (0-1, default: 0.7) */
  diversityLambda?: number;
  /** Apply MMR diversity ranking (default: true) */
  applyDiversity?: boolean;
  /** Apply cold start exploration boost (default: true) */
  applyColdStartBoost?: boolean;
}

export interface RecommendedProduct {
  id: number;
  title: string;
  brand: string | null;
  category: string | null;
  price: number;
  currency: string;
  image: string | null;
  // Scores
  rankerScore: number;
  clipSimilarity: number;
  textSimilarity: number;
  styleScore: number;
  colorScore: number;
  // Meta
  rankPosition: number;
  matchType: "exact" | "similar" | "related";
}

export interface RecommendationResponse {
  sourceProduct: {
    id: number;
    title: string;
    brand: string | null;
    category: string | null;
    image: string | null;
  };
  recommendations: RecommendedProduct[];
  meta: {
    totalCandidates: number;
    returnedCount: number;
    rankingSource: "model" | "heuristic";
    modelAvailable: boolean;
    impressionId?: string;
    timings?: {
      candidateGenerationMs: number;
      rankingMs: number;
      totalMs: number;
    };
  };
}

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Get similar product recommendations for a product
 * 
 * Uses the ML ranker pipeline:
 * 1. Generate candidates via CLIP + text search
 * 2. Compute rule-based scores (style, color, formality)
 * 3. Rank with XGBoost model (or heuristic fallback)
 * 4. Return top-N recommendations
 */
export async function getSimilarProducts(
  productId: number,
  options: RecommendationOptions = {}
): Promise<RecommendationResponse> {
  const {
    limit = 20,
    useModel = true,
    minScore = 0,
    debug = false,
    userId,
    sessionId,
    diversityLambda = 0.7,
    applyDiversity = true,
    applyColdStartBoost = true,
  } = options;

  const startTime = Date.now();

  // Fetch source product
  const sourceRes = await pg.query(
    `SELECT id, title, brand, category, price_cents, currency, image_cdn 
     FROM products WHERE id = $1`,
    [productId]
  );

  if (sourceRes.rows.length === 0) {
    throw new Error(`Product not found: ${productId}`);
  }

  const source = sourceRes.rows[0];

  // Run the ranking pipeline (get more candidates for MMR to work with)
  const candidateMultiplier = applyDiversity ? 3 : 1;
  const result = await getAndRankCandidates(String(productId), {
    candidateLimit: Math.max(limit * candidateMultiplier, 100),
    clipLimit: 200,
    textLimit: 200,
    usePHashDedup: true,
    useModel,
    finalLimit: limit * candidateMultiplier, // Get more for diversity selection
    minScore,
    debug,
  });

  let candidates = result.candidates;
  
  // Apply cold start exploration boost for new products
  if (applyColdStartBoost) {
    candidates = applyExplorationBoost(candidates);
  }
  
  // Apply MMR for diversity
  if (applyDiversity && candidates.length > limit) {
    const mmrResult = applyMMR(candidates, {
      lambda: diversityLambda,
      targetCount: limit,
      minScore,
    });
    candidates = mmrResult.candidates;
    
    if (debug) {
      console.log(`[RecommendationsService] MMR diversity applied: λ=${diversityLambda}, avgPenalty=${mmrResult.meta.averageDiversityPenalty.toFixed(3)}`);
    }
  }

  const totalMs = Date.now() - startTime;

  // Transform candidates to response format
  const recommendations: RecommendedProduct[] = candidates.map((c: RankedCandidateResult) => ({
    id: parseInt(c.candidateId, 10),
    title: c.product.title,
    brand: c.product.brand,
    category: c.product.category,
    price: c.product.price_cents / 100,
    currency: c.product.currency,
    image: c.product.image_cdn || c.product.images?.[0]?.url || null,
    // Scores
    rankerScore: Math.round(c.rankerScore * 1000) / 1000,
    clipSimilarity: Math.round(c.clipSim * 1000) / 1000,
    textSimilarity: Math.round(c.textSim * 1000) / 1000,
    styleScore: Math.round(c.styleScore * 1000) / 1000,
    colorScore: Math.round(c.colorScore * 1000) / 1000,
    // Meta
    rankPosition: c.rankPosition,
    matchType: c.product.match_type || "similar",
  }));

  // Log impressions for training data collection
  let impressionId: string | undefined;
  if (recommendations.length > 0) {
    const impressions: RecommendationImpression[] = recommendations.map((rec, idx) => ({
      baseProductId: productId,
      candidateProductId: rec.id,
      position: idx + 1,
      source: "both" as const,
      context: "similar_products",
      clipSim: rec.clipSimilarity,
      textSim: rec.textSimilarity,
      styleScore: rec.styleScore,
      colorScore: rec.colorScore,
      finalMatchScore: rec.rankerScore,
    }));

    try {
      const logParams: LogImpressionBatchParams = {
        baseProductId: productId,
        impressions,
        context: "similar_products",
      };
      impressionId = await logImpressionBatch(logParams);
    } catch (err) {
      console.warn("[RecommendationsService] Failed to log impressions:", err);
    }
  }

  return {
    sourceProduct: {
      id: source.id,
      title: source.title,
      brand: source.brand,
      category: source.category,
      image: source.image_cdn,
    },
    recommendations,
    meta: {
      totalCandidates: result.generatorMeta.mergedTotal,
      returnedCount: recommendations.length,
      rankingSource: result.rankingMeta.rankSource,
      modelAvailable: result.rankingMeta.modelAvailable,
      impressionId,
      timings: debug
        ? {
            candidateGenerationMs:
              result.generatorMeta.timings?.totalMs || 0,
            rankingMs: result.rankingMeta.timings.totalMs,
            totalMs,
          }
        : undefined,
    },
  };
}

/**
 * Get recommendations for multiple products (batch)
 * Useful for "customers also viewed" or homepage recommendations
 */
export async function getBatchRecommendations(
  productIds: number[],
  options: RecommendationOptions = {}
): Promise<Map<number, RecommendedProduct[]>> {
  const { limit = 10 } = options;
  
  const results = new Map<number, RecommendedProduct[]>();
  
  // Run in parallel with concurrency limit
  const BATCH_SIZE = 5;
  for (let i = 0; i < productIds.length; i += BATCH_SIZE) {
    const batch = productIds.slice(i, i + BATCH_SIZE);
    const promises = batch.map(async (id) => {
      try {
        const result = await getSimilarProducts(id, { ...options, limit });
        results.set(id, result.recommendations);
      } catch (err) {
        console.warn(`[RecommendationsService] Failed for product ${id}:`, err);
        results.set(id, []);
      }
    });
    await Promise.all(promises);
  }
  
  return results;
}
