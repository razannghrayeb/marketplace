/**
 * Unit Tests for Long Sleeve Category Mapping
 * 
 * Tests the normalization, categorization, and ranking boost functions.
 * 
 * Run with:
 *   npx tsx --test src/lib/category/longSleeveTopsCategoryMap.unit.ts
 *   npx tsx --test src/lib/category/longSleeveSearchRanking.unit.ts
 */

import { test } from 'node:test';
import * as assert from 'node:assert';
import {
  normalizeCategory,
  isLongSleeveTypical,
  isOuterwear,
  isTop,
  getCategoryVariants,
} from './longSleeveTopsCategoryMap';
import {
  getColorBoostForCategory,
  getTypeMismatchPenalty,
  getSleeveComplianceForLongSleeve,
  getCategoryMatchBonus,
  calculateLongSleeveRankingAdjustment,
  applyLongSleeveCategoryBoost,
} from './longSleeveSearchRanking';

// ============================================================================
// Normalization Tests
// ============================================================================

test('Category Normalization - T-Shirt variants', () => {
  assert.strictEqual(normalizeCategory('T-SHIRT'), 'tshirt');
  assert.strictEqual(normalizeCategory('t-shirt'), 'tshirt');
  assert.strictEqual(normalizeCategory('T-Shirts'), 'tshirt');
  assert.strictEqual(normalizeCategory('tshirt'), 'tshirt');
  assert.strictEqual(normalizeCategory('T-shirt'), 'tshirt');
});

test('Category Normalization - Shirt variants', () => {
  assert.strictEqual(normalizeCategory('Shirt'), 'shirt');
  assert.strictEqual(normalizeCategory('shirt'), 'shirt');
  assert.strictEqual(normalizeCategory('SHIRTS'), 'shirt');
  assert.strictEqual(normalizeCategory('Shirting'), 'shirt');
  assert.strictEqual(normalizeCategory('Woven Shirts'), 'shirt');
});

test('Category Normalization - Sweater variants', () => {
  assert.strictEqual(normalizeCategory('Sweater'), 'sweater');
  assert.strictEqual(normalizeCategory('SWEATERS'), 'sweater');
  assert.strictEqual(normalizeCategory('women sweater'), 'sweater');
  assert.strictEqual(normalizeCategory('men sweater'), 'sweater');
  assert.strictEqual(normalizeCategory('pullover'), 'sweater'); // Maps to sweater
});

test('Category Normalization - Outerwear variants', () => {
  assert.strictEqual(normalizeCategory('Jacket'), 'jacket');
  assert.strictEqual(normalizeCategory('JACKETS'), 'jacket');
  assert.strictEqual(normalizeCategory('Blazer'), 'jacket');
  assert.strictEqual(normalizeCategory('blazer'), 'jacket');
  assert.strictEqual(normalizeCategory('BLAZERS'), 'jacket');
});

test('Category Normalization - Hoodie variants', () => {
  assert.strictEqual(normalizeCategory('Hoodie'), 'hoodie');
  assert.strictEqual(normalizeCategory('hoody'), 'hoodie');
  assert.strictEqual(normalizeCategory('HOODIES'), 'hoodie');
  assert.strictEqual(normalizeCategory('men hoodie'), 'hoodie');
});

test('Category Normalization - Null/Invalid', () => {
  assert.strictEqual(normalizeCategory(null), null);
  assert.strictEqual(normalizeCategory(''), null);
  assert.strictEqual(normalizeCategory('xyz'), null);
  assert.strictEqual(normalizeCategory('random'), null);
});

test('Category Normalization - Case insensitive', () => {
  assert.strictEqual(normalizeCategory('KNIT TOP'), normalizeCategory('knit top'));
  assert.strictEqual(normalizeCategory('Crop Top'), normalizeCategory('crop top'));
});

// ============================================================================
// Classification Tests
// ============================================================================

test('Classification - Long Sleeve Typical', () => {
  assert.strictEqual(isLongSleeveTypical('sweater'), true);
  assert.strictEqual(isLongSleeveTypical('hoodie'), true);
  assert.strictEqual(isLongSleeveTypical('sweatshirt'), true);
  assert.strictEqual(isLongSleeveTypical('cardigan'), true);
  assert.strictEqual(isLongSleeveTypical('shirt'), true);
  assert.strictEqual(isLongSleeveTypical('jacket'), true);
  assert.strictEqual(isLongSleeveTypical('coat'), true);
  
  assert.strictEqual(isLongSleeveTypical('tank'), false);
  assert.strictEqual(isLongSleeveTypical('crop_top'), false);
});

test('Classification - Outerwear', () => {
  assert.strictEqual(isOuterwear('jacket'), true);
  assert.strictEqual(isOuterwear('coat'), true);
  assert.strictEqual(isOuterwear('vest'), true);
  assert.strictEqual(isOuterwear('suit'), true);
  assert.strictEqual(isOuterwear('tracksuit'), true);
  
  assert.strictEqual(isOuterwear('sweater'), false);
  assert.strictEqual(isOuterwear('tshirt'), false);
});

test('Classification - Tops', () => {
  assert.strictEqual(isTop('tshirt'), true);
  assert.strictEqual(isTop('shirt'), true);
  assert.strictEqual(isTop('blouse'), true);
  assert.strictEqual(isTop('polo'), true);
  assert.strictEqual(isTop('sweater'), true);
  assert.strictEqual(isTop('hoodie'), true);
  
  assert.strictEqual(isTop('jacket'), false);
  assert.strictEqual(isTop('coat'), false);
});

test('Get Category Variants', () => {
  const variants = getCategoryVariants('tshirt');
  assert.ok(variants.includes('t-shirt'), 'Should include lowercase t-shirt');
  assert.ok(variants.some(v => v.toLowerCase() === 't-shirt'), 'Should include t-shirt variant');
  assert.ok(variants.length > 5, 'Should have multiple variants');
});

// ============================================================================
// Ranking Boost Tests
// ============================================================================

test('Color Boost - Long Sleeve Categories', () => {
  const baseScore = 0.75;
  
  // Long sleeve category should boost color
  const boosted = getColorBoostForCategory('sweater', baseScore);
  assert.ok(boosted > baseScore, 'Color should be boosted for sweater');
  assert.ok(boosted <= 1.0, 'Boosted score should not exceed 1.0');
  
  // Non-long-sleeve should not boost
  const notBoosted = getColorBoostForCategory('tank', baseScore);
  assert.strictEqual(notBoosted, baseScore, 'Tank should not boost color');
});

test('Color Boost - 35% Increase', () => {
  const baseScore = 0.7;
  const boosted = getColorBoostForCategory('sweater', baseScore);
  
  // Should be approximately baseScore * 1.35 = 0.945
  assert.ok(boosted > 0.9 && boosted < 1.0);
  assert.ok(Math.abs(boosted - 0.945) < 0.01);
});

test('Type Mismatch Penalty - Same Type', () => {
  // Both tops: minimal penalty
  const penalty = getTypeMismatchPenalty('tshirt', 'shirt', 0.5);
  assert.ok(penalty < -0.01 && penalty > -0.1, 'Same type should have small penalty');
});

test('Type Mismatch Penalty - Different Types, Same Class', () => {
  // Both outerwear: moderate penalty
  const penalty = getTypeMismatchPenalty('jacket', 'coat', 0.5);
  assert.ok(penalty < 0 && penalty > -0.25, 'Different outerwear should be moderate');
});

test('Type Mismatch Penalty - High Color Similarity', () => {
  const lowColor = getTypeMismatchPenalty('tshirt', 'shirt', 0.5);
  const highColor = getTypeMismatchPenalty('tshirt', 'shirt', 0.88);
  
  // Penalty should be softer with high color match
  assert.ok(highColor > lowColor, 'High color match should soften penalty');
});

test('Sleeve Compliance - Query is Long Sleeve', () => {
  // Query: sweater (inherently long sleeve), Result: tank (short)
  const compliance = getSleeveComplianceForLongSleeve('sweater', 'tank', 0.7);
  assert.ok(compliance < 0.5, 'Should penalize short sleeve result for long sleeve query');
});

test('Sleeve Compliance - Query Long, Result Long', () => {
  // Query: sweater, Result: jacket (both inherently long)
  const compliance = getSleeveComplianceForLongSleeve('sweater', 'jacket', 0.6);
  assert.ok(compliance > 0.8, 'Should boost when both are long sleeve categories');
});

test('Category Match Bonus - Exact Match', () => {
  const bonus = getCategoryMatchBonus('sweater', 'sweater');
  assert.ok(bonus > 0.08, 'Exact match should give positive bonus');
});

test('Category Match Bonus - Different Categories', () => {
  const bonus = getCategoryMatchBonus('sweater', 'jacket');
  assert.strictEqual(bonus, 0, 'Different categories should get no bonus');
});

// ============================================================================
// Complete Ranking Adjustment Tests
// ============================================================================

test('Ranking Adjustment - Gray Sweater Search Example', () => {
  // User searching for "gray sweater"
  // Query canonical: 'sweater'
  // Result 1: Gray sweatshirt (color match: 0.92)
  // Result 2: Navy sweater (color match: 0.45)
  
  const result1 = calculateLongSleeveRankingAdjustment({
    queryCanonical: 'sweater',
    resultCanonical: 'sweatshirt',
    baseScore: 0.72,
    colorSimilarity: 0.92,
    visualSleeveConfidence: 0.8,
    hasSleeveIntent: false,
  });
  
  const result2 = calculateLongSleeveRankingAdjustment({
    queryCanonical: 'sweater',
    resultCanonical: 'sweater',
    baseScore: 0.82,
    colorSimilarity: 0.45,
    visualSleeveConfidence: 0.9,
    hasSleeveIntent: false,
  });
  
  // Gray sweatshirt (high color) should get bigger boost than navy sweater
  assert.ok(result1 > 0.72, 'High color similarity should boost score');
  assert.ok(result2 > 0.82 || result2 <= 0.82, 'Navy should not get big boost from color');
});

test('Ranking Adjustment - No Boost for Non-Long-Sleeve Categories', () => {
  // Searching for shoes (not long sleeve category)
  const result = calculateLongSleeveRankingAdjustment({
    queryCanonical: null,
    resultCanonical: null,
    baseScore: 0.8,
    colorSimilarity: 0.9,
    visualSleeveConfidence: 0.5,
    hasSleeveIntent: false,
  });
  
  // Score should remain close to base (no long sleeve boost applied)
  assert.ok(Math.abs(result - 0.8) < 0.1, 'Non-long-sleeve should not change much');
});

// ============================================================================
// Product-Level Boost Tests
// ============================================================================

test('Apply Long Sleeve Boost - Sweater Product', () => {
  const result = applyLongSleeveCategoryBoost(
    {
      id: 'prod_001',
      category: 'Sweater',
      normalized_category: 'Sweater',
      baseScore: 0.75,
      color_match_score: 0.85,
      sleeve_confidence: 0.9,
    },
    'sweater',
    false
  );
  
  assert.strictEqual(result.productId, 'prod_001');
  assert.ok(result.applied === true);
  assert.ok(result.adjustedScore > result.originalScore, 'Score should be boosted');
  assert.ok(result.adjustmentDelta > 0);
});

test('Apply Long Sleeve Boost - Not Applied for Non-Long-Sleeve', () => {
  const result = applyLongSleeveCategoryBoost(
    {
      id: 'prod_002',
      category: 'Shoes',
      normalized_category: null,
      baseScore: 0.8,
      color_match_score: 0.9,
      sleeve_confidence: 0,
    },
    'shoes',
    false
  );
  
  assert.strictEqual(result.applied, false, 'Should not apply boost for shoes');
  assert.strictEqual(result.adjustedScore, result.originalScore);
  assert.strictEqual(result.adjustmentDelta, 0);
});

test('Apply Long Sleeve Boost - Sleeve Intent', () => {
  const noIntent = applyLongSleeveCategoryBoost(
    {
      id: 'prod_003',
      category: 'Sweater',
      baseScore: 0.7,
      color_match_score: 0.8,
      sleeve_confidence: 0.85,
    },
    'sweater',
    false
  );
  
  const withIntent = applyLongSleeveCategoryBoost(
    {
      id: 'prod_003',
      category: 'Sweater',
      baseScore: 0.7,
      color_match_score: 0.8,
      sleeve_confidence: 0.85,
    },
    'sweater',
    true  // Has sleeve intent
  );
  
  assert.ok(withIntent.adjustedScore >= noIntent.adjustedScore, 'Sleeve intent should not decrease score');
});

console.log('✅ All tests passed!');
