/**
 * Ranker Client - TypeScript client for the XGBoost ranker API
 *
 * Calls the Python FastAPI service to score candidate recommendations.
 * Includes fallback to heuristic scoring when model is unavailable.
 */
import type {
  RankerFeatureRow,
  RankerPredictResponse,
  RankerHealthResponse,
  RankerFeaturesResponse,
  PredictionResult,
} from "./types";

// Re-export types for backward compatibility
export type {
  RankerFeatureRow,
  RankerPredictRequest,
  RankerPredictResponse,
  RankerHealthResponse,
} from "./types";

// ============================================================================
// Configuration
// ============================================================================

// Default to localhost so clients don't attempt to connect to 0.0.0.0
// Set `RANKER_API_URL` in the environment to point to a remote ranker service.
const RANKER_API_URL = process.env.RANKER_API_URL || "http://127.0.0.1:8000";
const RANKER_TIMEOUT_MS = parseInt(process.env.RANKER_TIMEOUT_MS || "5000", 10);

// ============================================================================
// Health Check API
// ============================================================================

/**
 * Check if the ranker API is healthy
 */
export async function checkRankerHealth(): Promise<RankerHealthResponse> {
  const response = await fetch(`${RANKER_API_URL}/health`, {
    method: "GET",
    signal: AbortSignal.timeout(RANKER_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Ranker health check failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Get the list of feature names expected by the model
 */
export async function getRankerFeatures(): Promise<RankerFeaturesResponse> {
  const response = await fetch(`${RANKER_API_URL}/features`, {
    method: "GET",
    signal: AbortSignal.timeout(RANKER_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Failed to get ranker features: ${response.status}`);
  }

  return response.json();
}

// ============================================================================
// Prediction API
// ============================================================================

/**
 * Score candidates using the XGBoost ranker model
 *
 * @param rows - Array of feature rows (one per candidate)
 * @returns Array of scores in the same order as input
 */
export async function predictRankerScores(
  rows: Partial<RankerFeatureRow>[]
): Promise<number[]> {
  if (rows.length === 0) {
    return [];
  }

  const response = await fetch(`${RANKER_API_URL}/predict`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows }),
    signal: AbortSignal.timeout(RANKER_TIMEOUT_MS),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Ranker prediction failed: ${response.status} - ${error}`);
  }

  const result: RankerPredictResponse = await response.json();
  return result.scores;
}

// ============================================================================
// Prediction with Fallback
// ============================================================================

/**
 * Score candidates with fallback to heuristic scoring if ranker is unavailable
 */
export async function predictWithFallback(
  rows: Partial<RankerFeatureRow>[]
): Promise<PredictionResult> {
  try {
    const scores = await predictRankerScores(rows);
    return { scores, source: "model" };
  } catch (error) {
    console.warn("[RankerClient] Model unavailable, using heuristic fallback:", error);
    return {
      scores: computeHeuristicScores(rows),
      source: "heuristic",
    };
  }
}

/**
 * Compute heuristic scores as fallback when model is unavailable
 */
function computeHeuristicScores(rows: Partial<RankerFeatureRow>[]): number[] {
  return rows.map((row) => {
    const clipSim = row.clip_sim ?? 0;
    const textSim = row.text_sim ?? 0;
    const styleScore = row.style_score ?? 0;
    const colorScore = row.color_score ?? 0;
    const sameBrand = row.same_brand ?? 0;
    const pHashSim = row.phash_sim ?? 0;

    // Heuristic weights (tuned manually)
    return (
      clipSim * 0.35 +
      textSim * 0.25 +
      styleScore * 0.15 +
      colorScore * 0.1 +
      pHashSim * 0.1 +
      sameBrand * 0.05
    );
  });
}

// ============================================================================
// Health Check Cache
// ============================================================================

let _rankerAvailable: boolean | null = null;
let _lastHealthCheck = 0;
const HEALTH_CHECK_INTERVAL_MS = 30000; // Re-check every 30s

/**
 * Check if ranker is available (cached)
 */
export async function isRankerAvailable(): Promise<boolean> {
  const now = Date.now();

  if (_rankerAvailable !== null && now - _lastHealthCheck < HEALTH_CHECK_INTERVAL_MS) {
    return _rankerAvailable;
  }

  try {
    const health = await checkRankerHealth();
    _rankerAvailable = health.ok;
    _lastHealthCheck = now;
    return _rankerAvailable;
  } catch {
    _rankerAvailable = false;
    _lastHealthCheck = now;
    return false;
  }
}

/**
 * Clear the health check cache (useful for testing)
 */
export function clearHealthCache(): void {
  _rankerAvailable = null;
  _lastHealthCheck = 0;
}
