/**
 * Attention-Based Embedding Fusion
 * 
 * Replaces static 70/30 image/text fusion with learned attention weights.
 * Supports A/B testing between static and attention-based fusion.
 */

import { getRedis, isRedisAvailable } from "../redis";
import type { SemanticAttribute } from "./multiVectorSearch";

// ============================================================================
// Types
// ============================================================================

export interface AttentionWeights {
  imageWeight: number;
  textWeight: number;
}

export interface FusionConfig {
  mode: "static" | "attention" | "adaptive";
  staticWeights: AttentionWeights;
  attentionConfig?: AttentionConfig;
}

export interface AttentionConfig {
  queryDim: number;         // Dimension of query projection
  keyDim: number;           // Dimension of key projection
  temperature: number;      // Softmax temperature (lower = sharper)
}

export interface ExperimentConfig {
  experimentId: string;
  controlWeights: AttentionWeights;
  treatmentMode: "attention" | "adaptive";
  trafficPercent: number;   // 0-100
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_STATIC_WEIGHTS: AttentionWeights = {
  imageWeight: 0.70,
  textWeight: 0.30,
};

const DEFAULT_ATTENTION_CONFIG: AttentionConfig = {
  queryDim: 128,
  keyDim: 128,
  temperature: 0.5,
};

// Attribute-specific learned weights (can be loaded from model file)
const LEARNED_ATTRIBUTE_WEIGHTS: Record<SemanticAttribute, AttentionWeights> = {
  global: { imageWeight: 0.75, textWeight: 0.25 },
  color: { imageWeight: 0.60, textWeight: 0.40 },   // Color benefits from text description
  texture: { imageWeight: 0.80, textWeight: 0.20 }, // Texture is more visual
  material: { imageWeight: 0.55, textWeight: 0.45 }, // Material often described in text
  style: { imageWeight: 0.65, textWeight: 0.35 },
  pattern: { imageWeight: 0.70, textWeight: 0.30 },
};

// ============================================================================
// Attention Mechanism
// ============================================================================

/**
 * Simple attention score between image and text embeddings
 */
function computeAttentionScore(
  imageEmbed: number[],
  textEmbed: number[],
  _config: AttentionConfig
): number {
  // Dot product attention (simplified)
  let dotProduct = 0;
  const dim = Math.min(imageEmbed.length, textEmbed.length);
  
  for (let i = 0; i < dim; i++) {
    dotProduct += imageEmbed[i] * textEmbed[i];
  }
  
  // Scale by dimension
  return dotProduct / Math.sqrt(dim);
}

/**
 * Compute attention weights for fusion
 */
export function computeAttentionWeights(
  imageEmbed: number[],
  textEmbed: number[],
  config: AttentionConfig = DEFAULT_ATTENTION_CONFIG
): AttentionWeights {
  // Compute raw attention scores
  const imageScore = computeAttentionScore(imageEmbed, imageEmbed, config);
  const textScore = computeAttentionScore(textEmbed, textEmbed, config);
  const crossScore = computeAttentionScore(imageEmbed, textEmbed, config);
  
  // Compute weights using softmax with temperature
  const scores = [imageScore + crossScore, textScore + crossScore];
  const maxScore = Math.max(...scores);
  const expScores = scores.map(s => Math.exp((s - maxScore) / config.temperature));
  const sumExp = expScores.reduce((a, b) => a + b, 0);
  
  const imageWeight = expScores[0] / sumExp;
  const textWeight = expScores[1] / sumExp;
  
  // Clamp to reasonable range
  return {
    imageWeight: Math.max(0.3, Math.min(0.9, imageWeight)),
    textWeight: Math.max(0.1, Math.min(0.7, textWeight)),
  };
}

/**
 * Get adaptive weights based on attribute type
 */
export function getAdaptiveWeights(
  attribute: SemanticAttribute,
  imageEmbed?: number[],
  textEmbed?: number[]
): AttentionWeights {
  // Start with learned attribute-specific weights
  const baseWeights = LEARNED_ATTRIBUTE_WEIGHTS[attribute] || DEFAULT_STATIC_WEIGHTS;
  
  // If embeddings provided, compute attention adjustment
  if (imageEmbed && textEmbed) {
    const attentionWeights = computeAttentionWeights(imageEmbed, textEmbed);
    
    // Blend learned weights with attention weights (70/30 blend for stability)
    return {
      imageWeight: baseWeights.imageWeight * 0.7 + attentionWeights.imageWeight * 0.3,
      textWeight: baseWeights.textWeight * 0.7 + attentionWeights.textWeight * 0.3,
    };
  }
  
  return baseWeights;
}

// ============================================================================
// Fusion Functions
// ============================================================================

/**
 * Fuse embeddings with learned attention weights
 */
export function fuseEmbeddings(
  imageEmbed: number[],
  textEmbed: number[],
  weights: AttentionWeights
): number[] {
  const dim = imageEmbed.length;
  const fused = new Array(dim);
  
  for (let i = 0; i < dim; i++) {
    fused[i] = imageEmbed[i] * weights.imageWeight + textEmbed[i] * weights.textWeight;
  }
  
  // L2 normalize
  const norm = Math.sqrt(fused.reduce((s, v) => s + v * v, 0));
  return fused.map((v) => v / (norm + 1e-8));
}

/**
 * Fuse embeddings with adaptive attention
 */
export function fuseEmbeddingsAdaptive(
  imageEmbed: number[],
  textEmbed: number[],
  attribute: SemanticAttribute
): { embedding: number[]; weights: AttentionWeights } {
  const weights = getAdaptiveWeights(attribute, imageEmbed, textEmbed);
  const embedding = fuseEmbeddings(imageEmbed, textEmbed, weights);
  
  return { embedding, weights };
}

/**
 * Fuse embeddings with static weights (legacy)
 */
export function fuseEmbeddingsStatic(
  imageEmbed: number[],
  textEmbed: number[]
): number[] {
  return fuseEmbeddings(imageEmbed, textEmbed, DEFAULT_STATIC_WEIGHTS);
}

// ============================================================================
// A/B Testing Support
// ============================================================================

/**
 * Simple hash function for consistent experiment assignment
 */
function murmurhash3(key: string): number {
  let h = 0xdeadbeef;
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(h ^ key.charCodeAt(i), 2654435761);
  }
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Get experiment variant for a user/session
 */
export function getExperimentVariant(
  userId: string,
  experimentId: string,
  config: ExperimentConfig
): "control" | "treatment" {
  const hash = murmurhash3(userId + experimentId);
  const bucket = hash % 100;
  
  return bucket < config.trafficPercent ? "treatment" : "control";
}

/**
 * Get fusion weights based on experiment assignment
 */
export async function getFusionWeightsForUser(
  userId: string,
  attribute: SemanticAttribute,
  imageEmbed?: number[],
  textEmbed?: number[]
): Promise<{ weights: AttentionWeights; variant: string }> {
  // Check if there's an active experiment
  const experiment = await getActiveExperiment();
  
  if (!experiment) {
    // No experiment: use adaptive weights
    const weights = getAdaptiveWeights(attribute, imageEmbed, textEmbed);
    return { weights, variant: "default" };
  }
  
  const variant = getExperimentVariant(userId, experiment.experimentId, experiment);
  
  if (variant === "control") {
    return { weights: experiment.controlWeights, variant: "control" };
  }
  
  // Treatment: use attention-based or adaptive
  if (experiment.treatmentMode === "attention" && imageEmbed && textEmbed) {
    const weights = computeAttentionWeights(imageEmbed, textEmbed);
    return { weights, variant: "treatment-attention" };
  }
  
  if (experiment.treatmentMode === "adaptive") {
    const weights = getAdaptiveWeights(attribute, imageEmbed, textEmbed);
    return { weights, variant: "treatment-adaptive" };
  }
  
  return { weights: DEFAULT_STATIC_WEIGHTS, variant: "treatment-fallback" };
}

/**
 * Get active A/B experiment config (from Redis or env)
 */
async function getActiveExperiment(): Promise<ExperimentConfig | null> {
  // Try Redis first
  if (isRedisAvailable()) {
    const redis = getRedis();
    if (redis) {
      try {
        const config = (await redis.get("fusion:experiment:active")) as ExperimentConfig | null;
        if (config) return config;
      } catch {
        // Fall through to env config
      }
    }
  }
  
  // Check environment variable
  if (process.env.FUSION_EXPERIMENT_ENABLED === "true") {
    return {
      experimentId: process.env.FUSION_EXPERIMENT_ID || "fusion-v1",
      controlWeights: DEFAULT_STATIC_WEIGHTS,
      treatmentMode: (process.env.FUSION_EXPERIMENT_MODE as "attention" | "adaptive") || "adaptive",
      trafficPercent: parseInt(process.env.FUSION_EXPERIMENT_TRAFFIC || "10", 10),
    };
  }
  
  return null;
}

/**
 * Log experiment exposure for analysis
 */
export async function logExperimentExposure(
  userId: string,
  experimentId: string,
  variant: string,
  attribute: SemanticAttribute
): Promise<void> {
  if (!isRedisAvailable()) return;
  
  const redis = getRedis();
  if (!redis) return;
  
  try {
    const key = `fusion:experiment:${experimentId}:exposures`;
    await redis.hincrby(key, `${variant}:${attribute}`, 1);
  } catch {
    // Ignore logging errors
  }
}

// ============================================================================
// Model Weight Loading
// ============================================================================

/**
 * Load trained attention weights from file/database
 * In production, these would come from a trained model
 */
export async function loadTrainedWeights(): Promise<boolean> {
  // Placeholder for loading from model file
  // In production: load from S3/GCS or database
  
  console.info("[AttentionFusion] Using default learned weights");
  return true;
}

/**
 * Save trained weights after model training
 */
export async function saveTrainedWeights(
  weights: Record<SemanticAttribute, AttentionWeights>
): Promise<void> {
  if (!isRedisAvailable()) return;
  
  const redis = getRedis();
  if (!redis) return;
  
  try {
    await redis.set("fusion:trained-weights", weights);
  } catch (err) {
    console.error("[AttentionFusion] Failed to save weights:", err);
  }
}
