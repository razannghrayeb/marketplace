/**
 * Long Sleeve Category Search Ranking Enhancement
 * 
 * Applies category-specific ranking boosts for long sleeve tops and outerwear:
 *  - Prioritizes color matching for long sleeve categories
 *  - Applies sleeve intent enforcement
 *  - Boosts exact category matches
 *  - Enables outfit coordination improvements
 * 
 * Integration Points:
 *  - src/lib/search/searchHitRelevance.ts (main ranking logic)
 *  - src/lib/search/sortResults.ts (final re-ranking)
 * 
 * Usage:
 *   const boost = getLongSleeveBoost(canonicalCategory, colorMatch, sleeveMismatch);
 *   const rerank = calculateCategoryAdjustment(product, searchContext);
 */

import {
  LongSleeveTopCategory,
  normalizeCategory,
  isOuterwear,
  isTop,
  isLongSleeveTypical,
} from './longSleeveTopsCategoryMap';

// ============================================================================
// Boost Configuration
// ============================================================================

interface CategoryBoostConfig {
  // When searching for long sleeve items, boost color match importance
  colorBoostMultiplier: number;

  // Type mismatch penalty (reduced for high color match)
  typeMismatchPenalty: number;

  // Sleeve mismatch should enforce stricter filtering
  sleeveMismatchThreshold: number;

  // Long sleeve category boost (applies when user searches for long sleeve)
  longSleeveTypeBoost: number;

  // Outerwear gets slightly higher boost due to rarer matching
  outerwearBoost: number;
}

const DEFAULT_CONFIG: CategoryBoostConfig = {
  colorBoostMultiplier: 1.35,    // Color becomes 35% more important for long sleeves
  typeMismatchPenalty: -0.15,    // Softer penalty when color is high
  sleeveMismatchThreshold: 0.35,  // Minimum compliance for sleeve mismatch
  longSleeveTypeBoost: 0.12,     // +0.12 for exact long sleeve type match
  outerwearBoost: 0.08,          // +0.08 for exact outerwear match
};

// ============================================================================
// Scoring Functions
// ============================================================================

/**
 * Calculate color boost for long sleeve top category.
 * 
 * When searching for long sleeves, color matching becomes more important
 * because fabric and color convey more visual information than silhouette.
 */
export function getColorBoostForCategory(
  canonical: LongSleeveTopCategory | null,
  baseColorScore: number,
  config: CategoryBoostConfig = DEFAULT_CONFIG
): number {
  if (!canonical || !isLongSleeveTypical(canonical)) {
    return baseColorScore;
  }

  // Long sleeve items: boost color match by 35%
  return Math.min(1.0, baseColorScore * config.colorBoostMultiplier);
}

/**
 * Calculate type mismatch penalty adjustment for long sleeves.
 * 
 * - Similar long sleeve tops (tshirt vs shirt): minimal penalty (-0.05)
 * - Tops to outerwear: moderate penalty (-0.15)
 * - Cross-category (top to shoes): maximum penalty (-0.44)
 */
export function getTypeMismatchPenalty(
  queryCanonical: LongSleeveTopCategory | null,
  resultCanonical: LongSleeveTopCategory | null,
  colorSimilarity: number,
  config: CategoryBoostConfig = DEFAULT_CONFIG
): number {
  // Both unmapped or same category: no penalty
  if (!queryCanonical || !resultCanonical || queryCanonical === resultCanonical) {
    return 0;
  }

  // Same type (both tops or both outerwear): minimal penalty
  const sameType = (isTop(queryCanonical) && isTop(resultCanonical)) ||
                   (isOuterwear(queryCanonical) && isOuterwear(resultCanonical));

  if (sameType) {
    // If color is very high, soften penalty further
    if (colorSimilarity > 0.85) {
      return config.typeMismatchPenalty * 0.3;
    }
    return config.typeMismatchPenalty * 0.5;
  }

  // Different types but both long sleeve categories: moderate penalty
  if (isLongSleeveTypical(queryCanonical) && isLongSleeveTypical(resultCanonical)) {
    return config.typeMismatchPenalty;
  }

  // Very different: standard penalty
  return config.typeMismatchPenalty * 1.5;
}

/**
 * Enforce sleeve intent when user specifically searched for sleeves.
 * 
 * Returns compliance score (0-1) based on:
 *  - Exact match: 1.0
 *  - Similar sleeve type: 0.7+
 *  - Opposite sleeve: 0.2
 */
export function getSleeveComplianceForLongSleeve(
  queryCategory: LongSleeveTopCategory | null,
  resultCategory: LongSleeveTopCategory | null,
  visualSleeveConfidence: number
): number {
  if (!queryCategory || !resultCategory) {
    return visualSleeveConfidence;
  }

  // Categories that inherently have long sleeves
  const longSleeveCategories = new Set<LongSleeveTopCategory>([
    'sweater',
    'hoodie',
    'sweatshirt',
    'cardigan',
    'coat',
    'jacket',
    'suit',
    'tracksuit',
  ]);

  const isQueryLongSleeve = longSleeveCategories.has(queryCategory);
  const isResultLongSleeve = longSleeveCategories.has(resultCategory);

  if (!isQueryLongSleeve) {
    return visualSleeveConfidence; // Query not sleeve-biased, use visual
  }

  // Query IS long sleeve biased
  if (isResultLongSleeve) {
    // Result is also long sleeve: high compliance
    return Math.max(visualSleeveConfidence, 0.85);
  }

  // Query is long sleeve, result is not: penalize heavily
  // If user asked for long sleeve but category is short sleeve, reduce compliance by 60%
  const mismatchPenalty = 0.6;
  return visualSleeveConfidence * (1.0 - mismatchPenalty);
}

/**
 * Category match bonus when product exactly matches query category.
 */
export function getCategoryMatchBonus(
  queryCanonical: LongSleeveTopCategory | null,
  resultCanonical: LongSleeveTopCategory | null,
  config: CategoryBoostConfig = DEFAULT_CONFIG
): number {
  if (!queryCanonical || !resultCanonical || queryCanonical !== resultCanonical) {
    return 0;
  }

  const bonus = isOuterwear(resultCanonical)
    ? config.outerwearBoost
    : config.longSleeveTypeBoost;

  return bonus;
}

// ============================================================================
// Complete Ranking Adjustment
// ============================================================================

export interface RankingContext {
  queryCanonical: LongSleeveTopCategory | null;
  resultCanonical: LongSleeveTopCategory | null;
  baseScore: number;
  colorSimilarity: number;
  visualSleeveConfidence: number;
  hasSleeveIntent: boolean;
  config?: CategoryBoostConfig;
}

/**
 * Calculate complete ranking score adjustment for long sleeve search.
 * 
 * Combines:
 *  - Color boost (35% increase for long sleeves)
 *  - Type mismatch penalty (softened by high color)
 *  - Sleeve compliance (enforced when sleeve intent detected)
 *  - Category match bonus (exact category gets +0.08 to +0.12)
 */
export function calculateLongSleeveRankingAdjustment(context: RankingContext): number {
  const config = context.config ?? DEFAULT_CONFIG;
  let adjustment = context.baseScore;

  // 1. Apply color boost for long sleeve categories
  const colorBoost = getColorBoostForCategory(context.resultCanonical, context.colorSimilarity, config);
  const colorBoostDelta = colorBoost - context.colorSimilarity;
  adjustment += colorBoostDelta * 0.25; // 25% weight for color in final score

  // 2. Apply type mismatch penalty
  const typePenalty = getTypeMismatchPenalty(
    context.queryCanonical,
    context.resultCanonical,
    colorBoost,
    config
  );
  if (typePenalty < 0) {
    adjustment += typePenalty * 0.15; // 15% weight for type penalty
  }

  // 3. Enforce sleeve compliance if user indicated sleeve intent
  if (context.hasSleeveIntent) {
    const sleeveCompliance = getSleeveComplianceForLongSleeve(
      context.queryCanonical,
      context.resultCanonical,
      context.visualSleeveConfidence
    );
    const sleeveDelta = sleeveCompliance - context.visualSleeveConfidence;
    adjustment += sleeveDelta * 0.20; // 20% weight for sleeve in final score
  }

  // 4. Add category match bonus
  const categoryBonus = getCategoryMatchBonus(
    context.queryCanonical,
    context.resultCanonical,
    config
  );
  adjustment += categoryBonus;

  return Math.max(0, Math.min(1.0, adjustment));
}

// ============================================================================
// Product-Level Integration
// ============================================================================

export interface ProductWithCategory {
  id: string;
  category?: string | null;
  normalized_category?: string | null;
  color_primary?: string;
  color_match_score?: number;
  sleeve_confidence?: number;
}

/**
 * Prepare category data for a product to use in ranking calculations.
 */
export function normalizeProductCategory(
  product: ProductWithCategory
): LongSleeveTopCategory | null {
  const raw = product.normalized_category ?? product.category;
  return normalizeCategory(raw);
}

/**
 * Apply category-aware re-ranking boost to product search results.
 * 
 * Usage in sortResults:
 *   const adjusted = applyLongSleeveCategoryBoost(product, query);
 *   return adjusted.adjustedScore;
 */
export interface ProductRankingInput extends ProductWithCategory {
  baseScore: number;
  visualSleeveConfidence?: number;
}

export interface ProductRankingOutput {
  productId: string;
  originalScore: number;
  adjustedScore: number;
  adjustmentDelta: number;
  applied: boolean;
  reason: string;
}

export function applyLongSleeveCategoryBoost(
  product: ProductRankingInput,
  queryCategory: string | null,
  hasSleeveIntent: boolean = false,
  config?: CategoryBoostConfig
): ProductRankingOutput {
  const queryCanonical = normalizeCategory(queryCategory);
  const resultCanonical = normalizeProductCategory(product);

  // Only apply boost if either query or result is a long sleeve category
  const shouldApply =
    (queryCanonical && isLongSleeveTypical(queryCanonical)) ||
    (resultCanonical && isLongSleeveTypical(resultCanonical));

  if (!shouldApply) {
    return {
      productId: product.id,
      originalScore: product.baseScore,
      adjustedScore: product.baseScore,
      adjustmentDelta: 0,
      applied: false,
      reason: 'Not a long sleeve category search',
    };
  }

  const adjustment = calculateLongSleeveRankingAdjustment({
    queryCanonical,
    resultCanonical,
    baseScore: product.baseScore,
    colorSimilarity: product.color_match_score ?? 0,
    visualSleeveConfidence: product.sleeve_confidence ?? 0.5,
    hasSleeveIntent,
    config,
  });

  const delta = adjustment - product.baseScore;

  return {
    productId: product.id,
    originalScore: product.baseScore,
    adjustedScore: adjustment,
    adjustmentDelta: delta,
    applied: true,
    reason: `Long sleeve boost: color=${(product.color_match_score ?? 0).toFixed(2)}, sleeve=${(product.sleeve_confidence ?? 0.5).toFixed(2)}`,
  };
}
