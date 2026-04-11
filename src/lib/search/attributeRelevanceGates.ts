/**
 * Per-Attribute Relevance Scoring (Phase 2, Task 3)
 *
 * Implements attribute-level gates and scoring for precise product ranking.
 * Each attribute (color, texture, material, style, pattern) has:
 * - A similarity score (0-1 cosine similarity)
 * - A gate/threshold that determines if the product passes
 * - A contribution factor to the final relevance score
 *
 * Gates are:
 * - SOFT: Product passes regardless, score affects ranking
 * - HARD: Product must meet threshold to be included
 * - BOOST: Product passes but gets scoring boost if exceeds threshold
 */

import type { SemanticAttribute } from "./multiVectorSearch";

// ============================================================================
// Types
// ============================================================================

export type AttributeGateType = "soft" | "hard" | "boost";

export interface AttributeRelevanceConfig {
  // Which gate type to use
  gateType: AttributeGateType;

  // Minimum similarity to pass hard gate (0-1)
  minThreshold: number;

  // Similarity above this gets scoring boost (0-1)
  boostThreshold: number;

  // Weight in final relevance formula (0-1)
  weight: number;

  // Whether this attribute is critical (if missing query embedding, lower overall score)
  isCritical: boolean;

  // Name for logging
  displayName: string;
}

export interface AttributeRelevanceScore {
  attribute: SemanticAttribute;
  similarity: number; // Raw cosine similarity (0-1)
  passes: boolean; // Does it pass the gate?
  gateScore: number; // Score (0-1) after applying gate logic
  contribution: number; // Weight * actual contribution to ranking
  explanation: string; // For debugging
}

export interface AttributeRelevanceResult {
  attributes: AttributeRelevanceScore[];
  overallGatePasses: boolean; // Do all hard gates pass?
  overallScore: number; // Weighted sum of contributions
  missingCritical: SemanticAttribute[]; // Which critical attributes were null?
  summary: string; // Human-readable explanation
}

// ============================================================================
// Default Attribute Gate Configurations
// ============================================================================

/**
 * Default gate configurations for each attribute.
 * 
 * These are tuned based on:
 * - Importance for user satisfaction
 * - Variability in the catalog
 * - Sensitivity to false rejections
 */
export const DEFAULT_ATTRIBUTE_GATES: Record<SemanticAttribute, AttributeRelevanceConfig> = {
  global: {
    gateType: "soft", // Never hard-gate on global; it's the fallback
    minThreshold: 0.3, // Very permissive
    boostThreshold: 0.6,
    weight: 0.2, // Lower weight; used when other attrs fail
    isCritical: false, // Global is always present
    displayName: "Global",
  },

  color: {
    gateType: "soft", // Soft gate; users can tolerate color variance
    minThreshold: 0.35, // Accept < 35% similarity but reduce score
    boostThreshold: 0.60, // Boost score for > 60% similarity
    weight: 0.25, // Significant weight for color matching
    isCritical: true, // Color is usually explicit in query
    displayName: "Color",
  },

  texture: {
    gateType: "soft", // Texture is subtle; soft gate
    minThreshold: 0.30, // Very permissive
    boostThreshold: 0.65, // Tight boost threshold
    weight: 0.12, // Modest weight
    isCritical: false, // Texture is optional detail
    displayName: "Texture",
  },

  material: {
    gateType: "soft", // Material is implicit; soft gate
    minThreshold: 0.25, // Very permissive
    boostThreshold: 0.60,
    weight: 0.10, // Light weight on material alone
    isCritical: false, // Material is often inferred
    displayName: "Material",
  },

  style: {
    gateType: "boost", // Boost-only gate for style coherence
    minThreshold: 0.40, // Minimum to pass but not hard gate
    boostThreshold: 0.65, // Significant boost above 65%
    weight: 0.20, // Important for style-aware search
    isCritical: true, // Style is explicit in multi-image search
    displayName: "Style",
  },

  pattern: {
    gateType: "soft", // Pattern is optional detail
    minThreshold: 0.35,
    boostThreshold: 0.70, // High boost threshold for patterns
    weight: 0.13, // Moderate weight
    isCritical: false, // Pattern is optional
    displayName: "Pattern",
  },
};

// ============================================================================
// Attribute Gate Logic
// ============================================================================

/**
 * Compute gate score for an attribute based on gate type and similarity.
 *
 * @param similarity Raw cosine similarity (0-1)
 * @param config Gate configuration
 * @returns Gate score (0-1) and whether it passes hard gates
 */
export function computeAttributeGateScore(
  similarity: number | null,
  config: AttributeRelevanceConfig,
): { gateScore: number; passes: boolean } {
  // Null similarity = attribute was not extracted from query
  if (similarity === null) {
    return { gateScore: 0, passes: config.gateType !== "hard" };
  }

  const clampedSim = Math.max(0, Math.min(1, similarity));

  switch (config.gateType) {
    case "hard": {
      // Hard gate: pass only if similarity >= minThreshold
      const passes = clampedSim >= config.minThreshold;
      const gateScore = passes ? clampedSim : 0;
      return { gateScore, passes };
    }

    case "soft": {
      // Soft gate: always passes, but score varies
      // Below minThreshold: degrade score linearly from minThreshold down to 0
      // At minThreshold: score = minThreshold
      // Above minThreshold: score = similarity (clipped at 1)
      // Above boostThreshold: score = similarity * 1.1 (bonus)
      let gateScore: number;

      if (clampedSim < config.minThreshold) {
        // Degrade: 0 at 0, reaches minThreshold at minThreshold
        gateScore = (clampedSim / config.minThreshold) * config.minThreshold;
      } else if (clampedSim >= config.boostThreshold) {
        // Boost: multiply by 1.1 but cap at 1.1
        gateScore = Math.min(1.1, clampedSim * 1.1);
      } else {
        // Linear zone between threshold and boost
        gateScore = clampedSim;
      }

      return { gateScore: Math.min(1, gateScore), passes: true };
    }

    case "boost": {
      // Boost gate: passes always, but major boost above threshold
      let gateScore: number;

      if (clampedSim < config.minThreshold) {
        // Below min: score = similarity * 0.5 (half-weight)
        gateScore = clampedSim * 0.5;
      } else if (clampedSim >= config.boostThreshold) {
        // Above boost: multiply by 1.2 (20% bonus)
        gateScore = Math.min(1.2, clampedSim * 1.2);
      } else {
        // Between: linear transition
        const ratio = (clampedSim - config.minThreshold) / (config.boostThreshold - config.minThreshold);
        gateScore = config.minThreshold + ratio * (config.boostThreshold - config.minThreshold);
      }

      return { gateScore: Math.min(1, gateScore), passes: true };
    }
  }
}

/**
 * Evaluate relevance for all attributes.
 *
 * Returns structured scores for each attribute plus overall assessment.
 *
 * @param similarities Map of attribute→similarity scores
 * @param configs Optional custom gate configurations (defaults used if missing)
 * @returns Detailed relevance scores and overall assessment
 */
export function evaluateAttributeRelevance(
  similarities: Partial<Record<SemanticAttribute, number | null>>,
  configs?: Partial<Record<SemanticAttribute, AttributeRelevanceConfig>>,
): AttributeRelevanceResult {
  const attributes: AttributeRelevanceScore[] = [];
  let overallScore = 0;
  let overallGatePasses = true;
  const missingCritical: SemanticAttribute[] = [];

  // Evaluate each attribute
  const attrs: SemanticAttribute[] = ["global", "color", "texture", "material", "style", "pattern"];
  let totalWeight = 0;

  for (const attr of attrs) {
    const config = configs?.[attr] || DEFAULT_ATTRIBUTE_GATES[attr];
    const similarity = similarities[attr] ?? null;

    if (similarity === null && config.isCritical) {
      missingCritical.push(attr);
    }

    const { gateScore, passes } = computeAttributeGateScore(similarity, config);

    // Only include in overall score if it passes
    const contribution = passes ? gateScore * config.weight : 0;
    if (passes) {
      totalWeight += config.weight;
    }

    const explanation =
      similarity === null
        ? `${config.displayName}: NOT EXTRACTED`
        : `${config.displayName}: ${(similarity * 100).toFixed(0)}% sim → ${(gateScore * 100).toFixed(0)}% gate`;

    attributes.push({
      attribute: attr,
      similarity: similarity ?? -1, // -1 means null
      passes,
      gateScore,
      contribution,
      explanation,
    });

    // Hard gates are mandatory
    if (config.gateType === "hard" && !passes) {
      overallGatePasses = false;
    }

    overallScore += contribution;
  }

  // Normalize overall score by total weight
  if (totalWeight > 0) {
    overallScore = overallScore / totalWeight;
  }

  // Summary
  const passCount = attributes.filter((a) => a.passes).length;
  const summary =
    passCount === attrs.length
      ? `✓ All ${attrs.length} attributes passed`
      : passCount === 0
        ? `✗ No attributes passed`
        : `⚠ ${passCount}/${attrs.length} attributes passed`;

  return {
    attributes,
    overallGatePasses,
    overallScore: Math.min(1, overallScore), // Clamp to [0, 1]
    missingCritical,
    summary,
  };
}

/**
 * Quick check: do all hard gates pass?
 *
 * Useful for early rejection before expensive re-ranking.
 *
 * @param similarities Map of attribute→similarity
 * @param configs Optional custom configs
 * @returns true if all hard gates pass
 */
export function hardGatesPass(
  similarities: Partial<Record<SemanticAttribute, number | null>>,
  configs?: Partial<Record<SemanticAttribute, AttributeRelevanceConfig>>,
): boolean {
  const attrs: SemanticAttribute[] = ["global", "color", "texture", "material", "style", "pattern"];

  for (const attr of attrs) {
    const config = configs?.[attr] || DEFAULT_ATTRIBUTE_GATES[attr];
    if (config.gateType === "hard") {
      const similarity = similarities[attr] ?? null;
      if (similarity === null || similarity < config.minThreshold) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Create a custom gate configuration for a specific attribute.
 *
 * Useful for A/B testing or per-query customization.
 *
 * @param attribute Which attribute to customize
 * @param overrides Partial overrides to default config
 * @returns Custom configuration
 */
export function customizeAttributeGate(
  attribute: SemanticAttribute,
  overrides: Partial<AttributeRelevanceConfig>,
): AttributeRelevanceConfig {
  return {
    ...DEFAULT_ATTRIBUTE_GATES[attribute],
    ...overrides,
  };
}

/**
 * Merge custom gate configurations with defaults.
 *
 * @param custom Partial custom configurations
 * @returns Full configurations with defaults filled in
 */
export function mergeAttributeGates(
  custom: Partial<Record<SemanticAttribute, Partial<AttributeRelevanceConfig>>>,
): Record<SemanticAttribute, AttributeRelevanceConfig> {
  const result = { ...DEFAULT_ATTRIBUTE_GATES };

  for (const [attr, override] of Object.entries(custom)) {
    if (override) {
      result[attr as SemanticAttribute] = {
        ...DEFAULT_ATTRIBUTE_GATES[attr as SemanticAttribute],
        ...override,
      };
    }
  }

  return result;
}
