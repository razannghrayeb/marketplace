/**
 * Ranker Types - Type definitions for the ranking system
 *
 * Contains:
 * - Feature row definition for model input
 * - API request/response types
 * - Configuration types
 */

// ============================================================================
// Feature Row Types
// ============================================================================

export interface RankerFeatureRow {
  // Core similarity scores (from candidate generator)
  clip_sim: number;
  text_sim: number;
  opensearch_score: number;
  candidate_score: number;

  // pHash distance (0-64, normalized to 0-1 where 1 = identical)
  phash_dist: number;
  phash_sim: number; // 1 - (phash_dist / 64)

  // Rule-based scores (computed locally)
  style_score: number;
  color_score: number;
  formality_score: number;
  occasion_score: number;

  // Price features
  price_ratio: number; // candidate_price / base_price
  price_diff_normalized: number; // normalized price difference

  // Category features (one-hot encoded as cat_<base>__<candidate>)
  [key: `cat_${string}__${string}`]: number;

  // Brand features
  same_brand: number; // 1 or 0
  same_vendor: number; // 1 or 0

  // Position bias (for learning-to-rank)
  original_position: number;
}

// ============================================================================
// API Types
// ============================================================================

export interface RankerPredictRequest {
  rows: Partial<RankerFeatureRow>[];
}

export interface RankerPredictResponse {
  scores: number[];
  count: number;
}

export interface RankerHealthResponse {
  ok: boolean;
  model: string;
  n_features: number;
  features_sample: string[];
}

export interface RankerFeaturesResponse {
  feature_names: string[];
  count: number;
}

// ============================================================================
// Prediction Result Types
// ============================================================================

export interface PredictionResult {
  scores: number[];
  source: "model" | "heuristic";
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface RankerConfig {
  apiUrl: string;
  timeoutMs: number;
  healthCheckIntervalMs: number;
}
