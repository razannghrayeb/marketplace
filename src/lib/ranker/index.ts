/**
 * Ranker Library - XGBoost model integration for recommendation ranking
 *
 * Exports:
 * - Types for feature rows and API responses
 * - Client functions to call the ranker API
 * - Feature builders for rule-based scoring
 * - Pipeline integration helpers
 */

// Types
export type {
  RankerFeatureRow,
  RankerPredictRequest,
  RankerPredictResponse,
  RankerHealthResponse,
  RankerFeaturesResponse,
  PredictionResult,
  RankerConfig,
} from "./types";

// Client
export {
  predictRankerScores,
  predictWithFallback,
  checkRankerHealth,
  getRankerFeatures,
  isRankerAvailable,
  clearHealthCache,
} from "./client";

// Features
export {
  buildFeatureRow,
  buildFeatureRows,
  computeColorScore,
  computeStyleScore,
  computeFormalityScore,
  computeOccasionScore,
  detectFormality,
  detectOccasion,
  buildCategoryPairFeature,
  type BaseProductContext,
  type CandidateWithScores,
} from "./features";

// Pipeline
export {
  rankCandidatesWithModel,
  getAndRankCandidates,
  type RankedCandidateResult,
  type RankingOptions,
  type RankingResult,
} from "./pipeline";

// MMR (Maximal Marginal Relevance)
export {
  applyMMR,
  applyCategoryAwareMMR,
  computeAdaptiveLambda,
  cosineSimilarity,
  type MMROptions,
  type MMRResult,
} from "./mmr";
