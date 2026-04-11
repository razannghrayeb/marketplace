/**
 * Phase 2: Attribute-Aware Reranking Orchestration
 *
 * Integrates all Phase 2 components:
 * 1. Query attribute extraction (queryAttributeExtraction.ts)
 * 2. Per-attribute relevance gates (attributeRelevanceGates.ts)
 * 3. Cross-attribute constraints (crossAttributeConstraints.ts)
 *
 * Provides a clean interface for products.service.ts to apply
 * attribute-based scoring and filtering.
 */

import {
  evaluateAttributeRelevance,
  hardGatesPass,
  DEFAULT_ATTRIBUTE_GATES,
  mergeAttributeGates,
  type AttributeRelevanceResult,
  type AttributeRelevanceConfig,
} from "./attributeRelevanceGates";

import {
  evaluateAllConstraints,
  hardConstraintsPassed,
  type ConstraintResult,
} from "./crossAttributeConstraints";

import type { SemanticAttribute } from "./multiVectorSearch";

// ============================================================================
// Types
// ============================================================================

export interface AttributeRerankerConfig {
  // Enable attribute-based reranking?
  enabled: boolean;

  // Custom gate configurations (overrides defaults)
  customGates?: Partial<Record<SemanticAttribute, Partial<AttributeRelevanceConfig>>>;

  // Enable cross-attribute constraints?
  constraintsEnabled: boolean;

  // Weight of attribute score in final ranking (0-1)
  // Applied as: final = (relevance * (1 - weight)) + (attrScore * weight)
  attributeWeight: number;

  // Whether to hard-filter products that don't pass all gates
  hardGateFilter: boolean;

  // Minimum attribute score to pass soft filter (0-0.5)
  minAttributeScore: number;

  // Log attribute scoring decisions?
  verbose: boolean;
}

export interface AttributeRerankerResult {
  // Overall attribute-based score (0-1)
  attributeScore: number;

  // Relevance gate evaluation
  gateResult: AttributeRelevanceResult;

  // Constraint evaluation (if enabled)
  constraintResult?: ConstraintResult;

  // Does product pass all filters?
  passes: boolean;

  // Explanation for debugging
  explanation: string;

  // Applied penalty from constraints (0-1)
  constraintPenalty: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_ATTRIBUTE_RERANKER_CONFIG: AttributeRerankerConfig = {
  enabled: true,
  customGates: {},
  constraintsEnabled: true,
  attributeWeight: 0.15, // 15% of final score from attributes
  hardGateFilter: false, // Don't hard-filter; use soft degradation
  minAttributeScore: 0.3, // Soft filter at 30%
  verbose: false,
};

// ============================================================================
// Attribute Reranker
// ============================================================================

/**
 * Rerank a product based on attribute matching.
 *
 * Orchestrates:
 * 1. Per-attribute relevance gates (color, texture, material, style, pattern)
 * 2. Cross-attribute constraints (incompatibilities)
 * 3. Soft/hard filtering based on scores
 *
 * @param productAttributes Map of attribute→value for the catalog product
 * @param querySimilarities Map of attribute→similarity between query and product
 * @param config Reranker configuration
 * @returns Scoring result with explanation
 */
export function evaluateProductAttributeMatch(
  productAttributes: Partial<Record<SemanticAttribute, string>>,
  querySimilarities: Partial<Record<SemanticAttribute, number | null>>,
  config: AttributeRerankerConfig = DEFAULT_ATTRIBUTE_RERANKER_CONFIG,
): AttributeRerankerResult {
  if (!config.enabled) {
    return {
      attributeScore: 1, // Neutral
      gateResult: {
        attributes: [],
        overallGatePasses: true,
        overallScore: 1,
        missingCritical: [],
        summary: "Attribute reranking disabled",
      },
      passes: true,
      explanation: "Attribute reranking disabled",
      constraintPenalty: 1,
    };
  }

  // ────────────────────────────────────────────────────────────────────────
  // Step 1: Evaluate per-attribute relevance gates
  // ────────────────────────────────────────────────────────────────────────

  const mergedGates = config.customGates
    ? mergeAttributeGates(config.customGates)
    : DEFAULT_ATTRIBUTE_GATES;

  const gateResult = evaluateAttributeRelevance(querySimilarities, mergedGates);

  // ────────────────────────────────────────────────────────────────────────
  // Step 2: Evaluate cross-attribute constraints
  // ────────────────────────────────────────────────────────────────────────

  let constraintResult: ConstraintResult | undefined;
  let constraintPenalty = 1;

  if (config.constraintsEnabled && productAttributes) {
    constraintResult = evaluateAllConstraints(productAttributes);
    constraintPenalty = constraintResult.overallPenalty;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Step 3: Combine scores
  // ────────────────────────────────────────────────────────────────────────

  // Attribute score = per-attribute score * constraint penalty
  const baseAttributeScore = gateResult.overallScore;
  const attributeScore = baseAttributeScore * constraintPenalty;

  // ────────────────────────────────────────────────────────────────────────
  // Step 4: Determine if product passes filters
  // ────────────────────────────────────────────────────────────────────────

  let passes = true;
  const failureReasons: string[] = [];

  // Hard gate check (if enabled)
  if (config.hardGateFilter && !gateResult.overallGatePasses) {
    passes = false;
    failureReasons.push("Hard gates failed");
  }

  // Hard constraint check (if enabled)
  if (config.constraintsEnabled && constraintResult?.failsHardConstraint) {
    passes = false;
    failureReasons.push("Hard constraints violated");
  }

  // Soft threshold check
  if (attributeScore < config.minAttributeScore) {
    if (config.verbose) {
      console.warn(`[attribute-reranker] Product below soft threshold: ${(attributeScore * 100).toFixed(0)}% < ${(config.minAttributeScore * 100).toFixed(0)}%`);
    }
    // Note: This doesn't fail; just logged for monitoring
  }

  // ────────────────────────────────────────────────────────────────────────
  // Step 5: Build explanation
  // ────────────────────────────────────────────────────────────────────────

  const explanation = !passes
    ? `Product rejected: ${failureReasons.join("; ")}`
    : `✓ Product passes (score=${(attributeScore * 100).toFixed(0)}%, constraints=${(constraintPenalty * 100).toFixed(0)}%)`;

  return {
    attributeScore,
    gateResult,
    constraintResult,
    passes,
    explanation,
    constraintPenalty,
  };
}

/**
 * Blend original relevance score with attribute score.
 *
 * Used to integrate Phase 2 attribute scoring into final ranking.
 *
 * @param relevanceScore Original relevance score from multi-vector search (0-1)
 * @param attributeScore Phase 2 attribute-based score (0-1)
 * @param attributeWeight Weight for attribute score (0-1)
 * @returns Blended final score
 */
export function blendAttributeScore(
  relevanceScore: number,
  attributeScore: number,
  attributeWeight: number = DEFAULT_ATTRIBUTE_RERANKER_CONFIG.attributeWeight,
): number {
  // Weighted average
  const blend = relevanceScore * (1 - attributeWeight) + attributeScore * attributeWeight;
  return Math.min(1, Math.max(0, blend)); // Clamp to [0, 1]
}

/**
 * Apply attribute filtering to a batch of products.
 *
 * Useful for apply gates/constraints before expensive re-ranking.
 *
 * @param products Array of product documents with attributes
 * @param querySimilarities Query attribute similarities
 * @param config Reranker configuration
 * @returns Filtered products that pass attribute checks
 */
export function applyAttributeFilter(
  products: Array<{
    product_id: string | number;
    [key: string]: any;
  }>,
  querySimilarities: Partial<Record<SemanticAttribute, number | null>>,
  config: AttributeRerankerConfig = DEFAULT_ATTRIBUTE_RERANKER_CONFIG,
): typeof products {
  if (!config.enabled || !config.hardGateFilter) {
    return products; // No filtering if disabled
  }

  return products.filter((product) => {
    const attributes: Partial<Record<SemanticAttribute, string>> = {
      color: product.color,
      texture: product.attr_material, // Texture often stored as material
      material: product.attr_material,
      style: product.attr_style,
      pattern: product.attr_pattern,
    };

    const result = evaluateProductAttributeMatch(
      attributes,
      querySimilarities,
      config,
    );

    return result.passes;
  });
}

/**
 * Get reranker health/configuration summary.
 *
 * @param config Reranker configuration
 * @returns Human-readable summary
 */
export function getRerankerSummary(
  config: AttributeRerankerConfig,
): string {
  const parts = [
    `Status: ${config.enabled ? "✓ Enabled" : "✗ Disabled"}`,
    `Weight: ${(config.attributeWeight * 100).toFixed(0)}% of final score`,
    `Constraints: ${config.constraintsEnabled ? "✓ Enabled" : "✗ Disabled"}`,
    `Hard gates: ${config.hardGateFilter ? "✓ Fail-closed" : "⚠ Fail-open"}`,
    `Soft threshold: ${(config.minAttributeScore * 100).toFixed(0)}%`,
  ];

  return parts.join(" | ");
}
