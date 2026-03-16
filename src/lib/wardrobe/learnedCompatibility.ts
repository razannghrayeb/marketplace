/**
 * Learned Compatibility Rules Engine
 *
 * Instead of hardcoded static rules, this service learns compatibility
 * from actual outfit data:
 * - User outfit combinations
 * - Successful outfit ratings
 * - Co-purchase patterns
 * - Marketplace outfit ensembles
 * - Cultural/regional preferences
 *
 * Uses collaborative filtering + graph-based learning to discover
 * what actually works together in practice.
 */

import { pg } from '../core/db';

// ============================================================================
// Types
// ============================================================================

export interface CompatibilityScore {
  category1: string;
  category2: string;
  score: number;              // 0.0 - 1.0
  confidence: number;         // Based on sample size
  coOccurrences: number;      // How many times seen together
  successRate: number;        // % of successful outfits
  regions?: string[];         // Cultural context
  averageRating?: number;     // Average user rating
}

export interface LearnedRule {
  ruleId: string;
  category1: string;
  category2: string;
  compatibilityScore: number;
  constraints: {
    colors?: ColorCompatibility;
    styles?: StyleCompatibility;
    occasions?: string[];
    seasons?: string[];
  };
  evidence: {
    sampleSize: number;
    sources: ('user_outfits' | 'purchases' | 'marketplace_ensembles' | 'editorial')[];
    lastUpdated: Date;
  };
}

export interface ColorCompatibility {
  preferredPairings: Array<{ color1: string; color2: string; score: number }>;
  avoidPairings: Array<{ color1: string; color2: string; reason: string }>;
}

export interface StyleCompatibility {
  matching: string[];        // Styles that work together
  conflicting: string[];     // Styles that don't mix well
}

export interface CompatibilityGraph {
  nodes: Array<{ category: string; popularity: number }>;
  edges: Array<{ from: string; to: string; weight: number }>;
}

// ============================================================================
// Main Learning Functions
// ============================================================================

/**
 * Learn compatibility rules from all available data sources
 */
export async function learnCompatibilityRules(): Promise<LearnedRule[]> {
  const rules: LearnedRule[] = [];

  // Source 1: User outfit combinations
  const userOutfitRules = await learnFromUserOutfits();
  rules.push(...userOutfitRules);

  // Source 2: Co-purchase patterns
  const purchaseRules = await learnFromPurchases();
  rules.push(...purchaseRules);

  // Source 3: Marketplace ensembles
  const ensembleRules = await learnFromMarketplaceEnsembles();
  rules.push(...ensembleRules);

  // Merge and deduplicate rules
  const mergedRules = mergeLearnedRules(rules);

  // Store in database
  await storeLearnedRules(mergedRules);

  return mergedRules;
}

/**
 * Get compatibility score for two categories
 */
export async function getCompatibilityScore(
  category1: string,
  category2: string,
  context?: {
    userId?: number;
    region?: string;
    occasion?: string;
    season?: string;
  }
): Promise<CompatibilityScore> {
  // Try learned rules first
  const learned = await getLearnedCompatibility(category1, category2, context);

  if (learned && learned.confidence > 0.7) {
    return learned;
  }

  // Fallback to static rules for cold-start
  return getFallbackCompatibility(category1, category2);
}

/**
 * Get top compatible categories for a given category
 */
export async function getTopCompatibleCategories(
  category: string,
  limit: number = 10,
  context?: {
    userId?: number;
    occasion?: string;
    season?: string;
  }
): Promise<CompatibilityScore[]> {
  const result = await pg.query(
    `SELECT
      CASE
        WHEN category1 = $1 THEN category2
        ELSE category1
      END as compatible_category,
      score,
      confidence,
      co_occurrences,
      success_rate,
      regions,
      average_rating
     FROM learned_compatibility_rules
     WHERE (category1 = $1 OR category2 = $1)
       AND confidence > 0.5
       ${context?.occasion ? 'AND ($2 = ANY(occasions) OR occasions IS NULL)' : ''}
       ${context?.season ? 'AND ($3 = ANY(seasons) OR seasons IS NULL)' : ''}
     ORDER BY score DESC, confidence DESC
     LIMIT $4`,
    [
      category,
      context?.occasion || null,
      context?.season || null,
      limit,
    ]
  );

  return result.rows.map(row => ({
    category1: category,
    category2: row.compatible_category,
    score: row.score,
    confidence: row.confidence,
    coOccurrences: row.co_occurrences,
    successRate: row.success_rate,
    regions: row.regions,
    averageRating: row.average_rating,
  }));
}

// ============================================================================
// Learning from Data Sources
// ============================================================================

/**
 * Learn from user-created outfits
 */
async function learnFromUserOutfits(): Promise<LearnedRule[]> {
  const result = await pg.query(`
    WITH outfit_pairs AS (
      SELECT
        wi1.category as cat1,
        wi2.category as cat2,
        o.rating,
        o.occasion,
        o.season,
        o.user_id
      FROM outfits o
      JOIN outfit_items oi1 ON oi1.outfit_id = o.id
      JOIN outfit_items oi2 ON oi2.outfit_id = o.id
      JOIN wardrobe_items wi1 ON wi1.id = oi1.wardrobe_item_id
      JOIN wardrobe_items wi2 ON wi2.id = oi2.wardrobe_item_id
      WHERE oi1.id < oi2.id  -- Avoid duplicates
        AND wi1.category IS NOT NULL
        AND wi2.category IS NOT NULL
        AND o.rating IS NOT NULL  -- Only rated outfits
    ),
    aggregated AS (
      SELECT
        cat1,
        cat2,
        COUNT(*) as co_occurrences,
        AVG(rating) as avg_rating,
        STDDEV(rating) as rating_stddev,
        ARRAY_AGG(DISTINCT occasion) FILTER (WHERE occasion IS NOT NULL) as occasions,
        ARRAY_AGG(DISTINCT season) FILTER (WHERE season IS NOT NULL) as seasons
      FROM outfit_pairs
      GROUP BY cat1, cat2
      HAVING COUNT(*) >= 3  -- Minimum sample size
    )
    SELECT
      cat1,
      cat2,
      co_occurrences,
      avg_rating,
      rating_stddev,
      occasions,
      seasons,
      -- Score formula: rating * sqrt(sample_size) / (1 + stddev)
      (avg_rating * SQRT(co_occurrences)) / (1.0 + COALESCE(rating_stddev, 1.0)) as score
    FROM aggregated
    WHERE avg_rating >= 3.0  -- Only positive combinations
    ORDER BY score DESC
  `);

  return result.rows.map(row => ({
    ruleId: `user_outfit_${row.cat1}_${row.cat2}`,
    category1: row.cat1,
    category2: row.cat2,
    compatibilityScore: Math.min(row.score / 5.0, 1.0), // Normalize to 0-1
    constraints: {
      occasions: row.occasions,
      seasons: row.seasons,
    },
    evidence: {
      sampleSize: row.co_occurrences,
      sources: ['user_outfits'],
      lastUpdated: new Date(),
    },
  }));
}

/**
 * Learn from co-purchase patterns
 */
async function learnFromPurchases(): Promise<LearnedRule[]> {
  const result = await pg.query(`
    WITH purchase_pairs AS (
      SELECT
        p1.category as cat1,
        p2.category as cat2,
        o.user_id,
        o.created_at
      FROM orders o
      JOIN order_items oi1 ON oi1.order_id = o.id
      JOIN order_items oi2 ON oi2.order_id = o.id
      JOIN products p1 ON p1.id = oi1.product_id
      JOIN products p2 ON p2.id = oi2.product_id
      WHERE oi1.id < oi2.id
        AND p1.category IS NOT NULL
        AND p2.category IS NOT NULL
        AND o.created_at > NOW() - INTERVAL '6 months'  -- Recent purchases
    ),
    aggregated AS (
      SELECT
        cat1,
        cat2,
        COUNT(*) as co_purchases,
        COUNT(DISTINCT user_id) as unique_users
      FROM purchase_pairs
      GROUP BY cat1, cat2
      HAVING COUNT(*) >= 5
    )
    SELECT
      cat1,
      cat2,
      co_purchases,
      unique_users,
      -- Score based on purchase frequency and user diversity
      (co_purchases * LOG(unique_users + 1)) as score
    FROM aggregated
    ORDER BY score DESC
  `);

  return result.rows.map(row => ({
    ruleId: `purchase_${row.cat1}_${row.cat2}`,
    category1: row.cat1,
    category2: row.cat2,
    compatibilityScore: Math.min(row.score / 100.0, 1.0), // Normalize
    constraints: {},
    evidence: {
      sampleSize: row.co_purchases,
      sources: ['purchases'],
      lastUpdated: new Date(),
    },
  }));
}

/**
 * Learn from marketplace product ensembles
 */
async function learnFromMarketplaceEnsembles(): Promise<LearnedRule[]> {
  // This would analyze products that are frequently viewed/added to cart together
  // Placeholder for now
  return [];
}

// ============================================================================
// Rule Management
// ============================================================================

/**
 * Merge learned rules from multiple sources
 */
function mergeLearnedRules(rules: LearnedRule[]): LearnedRule[] {
  const merged = new Map<string, LearnedRule>();

  for (const rule of rules) {
    const key = [rule.category1, rule.category2].sort().join('_');

    if (merged.has(key)) {
      const existing = merged.get(key)!;

      // Weighted average of scores based on sample size
      const totalSamples = existing.evidence.sampleSize + rule.evidence.sampleSize;
      const weightedScore =
        (existing.compatibilityScore * existing.evidence.sampleSize +
          rule.compatibilityScore * rule.evidence.sampleSize) /
        totalSamples;

      merged.set(key, {
        ...existing,
        compatibilityScore: weightedScore,
        evidence: {
          sampleSize: totalSamples,
          sources: [...new Set([...existing.evidence.sources, ...rule.evidence.sources])],
          lastUpdated: new Date(),
        },
      });
    } else {
      merged.set(key, rule);
    }
  }

  return Array.from(merged.values());
}

/**
 * Store learned rules in database
 */
async function storeLearnedRules(rules: LearnedRule[]): Promise<void> {
  for (const rule of rules) {
    await pg.query(
      `INSERT INTO learned_compatibility_rules (
        rule_id, category1, category2, score, confidence,
        co_occurrences, success_rate, constraints, evidence,
        last_updated
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (category1, category2)
      DO UPDATE SET
        score = $4,
        confidence = $5,
        co_occurrences = $6,
        success_rate = $7,
        constraints = $8,
        evidence = $9,
        last_updated = $10`,
      [
        rule.ruleId,
        rule.category1,
        rule.category2,
        rule.compatibilityScore,
        Math.min(rule.evidence.sampleSize / 50, 1.0), // Confidence based on sample size
        rule.evidence.sampleSize,
        null, // success_rate computed separately
        JSON.stringify(rule.constraints),
        JSON.stringify(rule.evidence),
        rule.evidence.lastUpdated,
      ]
    );
  }
}

/**
 * Get learned compatibility from database
 */
async function getLearnedCompatibility(
  category1: string,
  category2: string,
  context?: any
): Promise<CompatibilityScore | null> {
  const result = await pg.query(
    `SELECT score, confidence, co_occurrences, success_rate, regions, average_rating
     FROM learned_compatibility_rules
     WHERE (category1 = $1 AND category2 = $2)
        OR (category1 = $2 AND category2 = $1)
     LIMIT 1`,
    [category1, category2]
  );

  if (result.rowCount === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    category1,
    category2,
    score: row.score,
    confidence: row.confidence,
    coOccurrences: row.co_occurrences,
    successRate: row.success_rate,
    regions: row.regions,
    averageRating: row.average_rating,
  };
}

/**
 * Fallback to static rules for cold-start
 */
function getFallbackCompatibility(category1: string, category2: string): CompatibilityScore {
  // Simple static fallback rules
  const staticRules: Record<string, string[]> = {
    top: ['bottom', 'outerwear', 'footwear', 'accessory'],
    bottom: ['top', 'outerwear', 'footwear', 'accessory'],
    dress: ['outerwear', 'footwear', 'accessory'],
    outerwear: ['top', 'bottom', 'dress', 'footwear'],
    footwear: ['top', 'bottom', 'dress', 'outerwear'],
  };

  const cat1Compatible = staticRules[category1] || [];
  const isCompatible = cat1Compatible.includes(category2);

  return {
    category1,
    category2,
    score: isCompatible ? 0.7 : 0.3,
    confidence: 0.5, // Low confidence for static rules
    coOccurrences: 0,
    successRate: isCompatible ? 0.7 : 0.3,
  };
}

/**
 * Build compatibility graph for visualization
 */
export async function buildCompatibilityGraph(
  minScore: number = 0.6,
  minCoOccurrences: number = 5
): Promise<CompatibilityGraph> {
  const result = await pg.query(
    `SELECT category1, category2, score, co_occurrences
     FROM learned_compatibility_rules
     WHERE score >= $1 AND co_occurrences >= $2
     ORDER BY score DESC`,
    [minScore, minCoOccurrences]
  );

  // Extract unique categories
  const categories = new Set<string>();
  const edges: Array<{ from: string; to: string; weight: number }> = [];

  for (const row of result.rows) {
    categories.add(row.category1);
    categories.add(row.category2);
    edges.push({
      from: row.category1,
      to: row.category2,
      weight: row.score,
    });
  }

  // Count popularity (degree)
  const popularity = new Map<string, number>();
  for (const edge of edges) {
    popularity.set(edge.from, (popularity.get(edge.from) || 0) + 1);
    popularity.set(edge.to, (popularity.get(edge.to) || 0) + 1);
  }

  return {
    nodes: Array.from(categories).map(cat => ({
      category: cat,
      popularity: popularity.get(cat) || 0,
    })),
    edges,
  };
}

/**
 * Schedule periodic re-learning (run as cron job)
 */
export async function scheduleCompatibilityLearning(): Promise<void> {
  console.log('[LearnedCompatibility] Starting scheduled learning...');
  const startTime = Date.now();

  const rules = await learnCompatibilityRules();

  console.log(`[LearnedCompatibility] Learned ${rules.length} rules in ${Date.now() - startTime}ms`);
}
