/**
 * Data-Driven Category Pairings
 * 
 * Learns category compatibility from:
 * - User co-purchases
 * - Outfit ensemble data
 * - Wardrobe combinations
 * 
 * Supports cultural context for regional fashion norms.
 */

import { pg } from "../core/db";

// ============================================================================
// Types
// ============================================================================

export interface CategoryPairing {
  sourceCategory: string;
  targetCategory: string;
  compatibilityScore: number;   // 0-1
  priority: 1 | 2 | 3;          // 1=essential, 2=recommended, 3=optional
  reason: string;
  confidence: number;           // Based on sample size
  sampleCount: number;
  culturalContext?: string;     // e.g., "middle_east", "western", "asian"
}

export interface LearnedPairingsConfig {
  minSampleCount: number;       // Minimum samples to consider
  minConfidence: number;        // Minimum confidence threshold
  fallbackToStatic: boolean;    // Use static rules when data insufficient
}

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_CONFIG: LearnedPairingsConfig = {
  minSampleCount: 10,
  minConfidence: 0.6,
  fallbackToStatic: true,
};

// Static fallback rules (Western fashion defaults)
const STATIC_PAIRINGS: CategoryPairing[] = [
  { sourceCategory: "dress", targetCategory: "heels", compatibilityScore: 0.9, priority: 1, reason: "Complete the look with matching footwear", confidence: 1, sampleCount: 0 },
  { sourceCategory: "dress", targetCategory: "clutch", compatibilityScore: 0.85, priority: 1, reason: "A bag to complement your dress", confidence: 1, sampleCount: 0 },
  { sourceCategory: "dress", targetCategory: "earrings", compatibilityScore: 0.8, priority: 2, reason: "Jewelry to elevate your style", confidence: 1, sampleCount: 0 },
  { sourceCategory: "jeans", targetCategory: "tshirt", compatibilityScore: 0.95, priority: 1, reason: "Classic casual combination", confidence: 1, sampleCount: 0 },
  { sourceCategory: "jeans", targetCategory: "sneakers", compatibilityScore: 0.9, priority: 1, reason: "Casual footwear match", confidence: 1, sampleCount: 0 },
  { sourceCategory: "blazer", targetCategory: "pants", compatibilityScore: 0.95, priority: 1, reason: "Professional pairing", confidence: 1, sampleCount: 0 },
  { sourceCategory: "blazer", targetCategory: "loafers", compatibilityScore: 0.85, priority: 1, reason: "Smart casual footwear", confidence: 1, sampleCount: 0 },
];

// ============================================================================
// Learning from Data
// ============================================================================

/**
 * Learn pairings from co-purchases
 */
export async function learnFromCoPurchases(): Promise<Map<string, CategoryPairing[]>> {
  const result = await pg.query<{
    cat1: string;
    cat2: string;
    count: string;
    total_orders: string;
  }>(
    `WITH order_categories AS (
       SELECT 
         o.id as order_id,
         c.name as category
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       JOIN products p ON p.id = oi.product_id
       JOIN categories c ON c.id = p.category_id
       WHERE o.status = 'completed'
     )
     SELECT 
       oc1.category as cat1,
       oc2.category as cat2,
       COUNT(*) as count,
       (SELECT COUNT(DISTINCT order_id) FROM order_categories) as total_orders
     FROM order_categories oc1
     JOIN order_categories oc2 ON oc1.order_id = oc2.order_id AND oc1.category < oc2.category
     GROUP BY oc1.category, oc2.category
     HAVING COUNT(*) >= 5
     ORDER BY count DESC`
  );
  
  const pairings = new Map<string, CategoryPairing[]>();
  
  for (const row of result.rows) {
    const count = parseInt(row.count, 10);
    const totalOrders = parseInt(row.total_orders, 10);
    const score = count / totalOrders;
    
    // Add both directions
    for (const [source, target] of [[row.cat1, row.cat2], [row.cat2, row.cat1]]) {
      const pairing: CategoryPairing = {
        sourceCategory: source,
        targetCategory: target,
        compatibilityScore: Math.min(1, score * 10), // Scale up
        priority: score > 0.1 ? 1 : score > 0.05 ? 2 : 3,
        reason: `Frequently purchased together`,
        confidence: Math.min(1, count / 50),
        sampleCount: count,
      };
      
      const existing = pairings.get(source) || [];
      existing.push(pairing);
      pairings.set(source, existing);
    }
  }
  
  return pairings;
}

/**
 * Learn pairings from wardrobe outfits
 */
export async function learnFromWardrobeOutfits(): Promise<Map<string, CategoryPairing[]>> {
  const result = await pg.query<{
    cat1: string;
    cat2: string;
    count: string;
    avg_rating: string;
  }>(
    `WITH outfit_categories AS (
       SELECT 
         wo.id as outfit_id,
         wo.rating,
         c.name as category
       FROM wardrobe_outfits wo
       JOIN wardrobe_outfit_items woi ON woi.outfit_id = wo.id
       JOIN wardrobe_items wi ON wi.id = woi.item_id
       JOIN categories c ON c.id = wi.category_id
     )
     SELECT 
       oc1.category as cat1,
       oc2.category as cat2,
       COUNT(*) as count,
       AVG(oc1.rating) as avg_rating
     FROM outfit_categories oc1
     JOIN outfit_categories oc2 ON oc1.outfit_id = oc2.outfit_id AND oc1.category < oc2.category
     GROUP BY oc1.category, oc2.category
     HAVING COUNT(*) >= 3
     ORDER BY avg_rating DESC, count DESC`
  );
  
  const pairings = new Map<string, CategoryPairing[]>();
  
  for (const row of result.rows) {
    const count = parseInt(row.count, 10);
    const avgRating = parseFloat(row.avg_rating || "3");
    const score = (avgRating / 5) * 0.6 + Math.min(1, count / 20) * 0.4;
    
    for (const [source, target] of [[row.cat1, row.cat2], [row.cat2, row.cat1]]) {
      const pairing: CategoryPairing = {
        sourceCategory: source,
        targetCategory: target,
        compatibilityScore: score,
        priority: avgRating >= 4 ? 1 : avgRating >= 3 ? 2 : 3,
        reason: `Popular outfit combination (${avgRating.toFixed(1)}★)`,
        confidence: Math.min(1, count / 30),
        sampleCount: count,
      };
      
      const existing = pairings.get(source) || [];
      existing.push(pairing);
      pairings.set(source, existing);
    }
  }
  
  return pairings;
}

/**
 * Learn cultural context pairings
 */
export async function learnCulturalPairings(
  region: string
): Promise<Map<string, CategoryPairing[]>> {
  const result = await pg.query<{
    cat1: string;
    cat2: string;
    count: string;
    region: string;
  }>(
    `WITH regional_orders AS (
       SELECT 
         o.id as order_id,
         u.region
       FROM orders o
       JOIN users u ON u.id = o.user_id
       WHERE o.status = 'completed' AND u.region = $1
     ),
     order_categories AS (
       SELECT 
         ro.order_id,
         c.name as category
       FROM regional_orders ro
       JOIN order_items oi ON oi.order_id = ro.order_id
       JOIN products p ON p.id = oi.product_id
       JOIN categories c ON c.id = p.category_id
     )
     SELECT 
       oc1.category as cat1,
       oc2.category as cat2,
       COUNT(*) as count,
       $1 as region
     FROM order_categories oc1
     JOIN order_categories oc2 ON oc1.order_id = oc2.order_id AND oc1.category < oc2.category
     GROUP BY oc1.category, oc2.category
     HAVING COUNT(*) >= 3
     ORDER BY count DESC`,
    [region]
  );
  
  const pairings = new Map<string, CategoryPairing[]>();
  
  for (const row of result.rows) {
    const count = parseInt(row.count, 10);
    
    for (const [source, target] of [[row.cat1, row.cat2], [row.cat2, row.cat1]]) {
      const pairing: CategoryPairing = {
        sourceCategory: source,
        targetCategory: target,
        compatibilityScore: Math.min(1, count / 20),
        priority: 2,
        reason: `Popular in ${region}`,
        confidence: Math.min(1, count / 20),
        sampleCount: count,
        culturalContext: region,
      };
      
      const existing = pairings.get(source) || [];
      existing.push(pairing);
      pairings.set(source, existing);
    }
  }
  
  return pairings;
}

// ============================================================================
// Main API
// ============================================================================

/**
 * Get category pairings for a source category
 */
export async function getCategoryPairings(
  sourceCategory: string,
  options: {
    culturalContext?: string;
    config?: Partial<LearnedPairingsConfig>;
  } = {}
): Promise<CategoryPairing[]> {
  const config = { ...DEFAULT_CONFIG, ...options.config };
  
  // Try to get learned pairings from cache/DB
  let pairings = await getLearnedPairingsFromDB(
    sourceCategory,
    options.culturalContext
  );
  
  // Filter by confidence
  pairings = pairings.filter(p => 
    p.sampleCount >= config.minSampleCount &&
    p.confidence >= config.minConfidence
  );
  
  // Fallback to static if insufficient data
  if (pairings.length < 3 && config.fallbackToStatic) {
    const staticForCategory = STATIC_PAIRINGS.filter(
      p => p.sourceCategory === sourceCategory
    );
    
    // Merge with learned, preferring learned
    const learnedTargets = new Set(pairings.map(p => p.targetCategory));
    for (const staticPairing of staticForCategory) {
      if (!learnedTargets.has(staticPairing.targetCategory)) {
        pairings.push(staticPairing);
      }
    }
  }
  
  // Sort by compatibility score
  return pairings.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.compatibilityScore - a.compatibilityScore;
  });
}

/**
 * Get learned pairings from database
 */
async function getLearnedPairingsFromDB(
  sourceCategory: string,
  culturalContext?: string
): Promise<CategoryPairing[]> {
  const result = await pg.query<{
    target_category: string;
    compatibility_score: string;
    priority: number;
    reason: string;
    confidence: string;
    sample_count: string;
    cultural_context: string | null;
  }>(
    `SELECT * FROM category_compatibility
     WHERE source_category = $1
       AND ($2::text IS NULL OR cultural_context IS NULL OR cultural_context = $2)
     ORDER BY priority, compatibility_score DESC
     LIMIT 20`,
    [sourceCategory, culturalContext || null]
  );
  
  return result.rows.map(row => ({
    sourceCategory,
    targetCategory: row.target_category,
    compatibilityScore: parseFloat(row.compatibility_score),
    priority: row.priority as 1 | 2 | 3,
    reason: row.reason,
    confidence: parseFloat(row.confidence),
    sampleCount: parseInt(row.sample_count, 10),
    culturalContext: row.cultural_context || undefined,
  }));
}

/**
 * Persist learned pairings to database
 */
export async function persistLearnedPairings(
  pairings: CategoryPairing[]
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;
  
  for (const pairing of pairings) {
    const result = await pg.query(
      `INSERT INTO category_compatibility 
         (source_category, target_category, compatibility_score, priority, reason, confidence, sample_count, cultural_context)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (source_category, target_category, COALESCE(cultural_context, ''))
       DO UPDATE SET
         compatibility_score = EXCLUDED.compatibility_score,
         priority = EXCLUDED.priority,
         reason = EXCLUDED.reason,
         confidence = EXCLUDED.confidence,
         sample_count = EXCLUDED.sample_count,
         updated_at = NOW()
       RETURNING (xmax = 0) as inserted`,
      [
        pairing.sourceCategory,
        pairing.targetCategory,
        pairing.compatibilityScore,
        pairing.priority,
        pairing.reason,
        pairing.confidence,
        pairing.sampleCount,
        pairing.culturalContext || null,
      ]
    );
    
    if (result.rows[0]?.inserted) {
      inserted++;
    } else {
      updated++;
    }
  }
  
  return { inserted, updated };
}

/**
 * Refresh learned pairings (run periodically)
 */
export async function refreshLearnedPairings(): Promise<{
  coPurchase: number;
  wardrobe: number;
}> {
  // Learn from co-purchases
  const coPurchasePairings = await learnFromCoPurchases();
  let coPurchaseCount = 0;
  for (const pairings of coPurchasePairings.values()) {
    await persistLearnedPairings(pairings);
    coPurchaseCount += pairings.length;
  }
  
  // Learn from wardrobe outfits
  const wardrobePairings = await learnFromWardrobeOutfits();
  let wardrobeCount = 0;
  for (const pairings of wardrobePairings.values()) {
    await persistLearnedPairings(pairings);
    wardrobeCount += pairings.length;
  }
  
  return { coPurchase: coPurchaseCount, wardrobe: wardrobeCount };
}

// ============================================================================
// Database Setup
// ============================================================================

/**
 * Ensure category compatibility table exists
 */
export async function ensureCategoryCompatibilityTable(): Promise<void> {
  await pg.query(`
    CREATE TABLE IF NOT EXISTS category_compatibility (
      id SERIAL PRIMARY KEY,
      source_category VARCHAR(64) NOT NULL,
      target_category VARCHAR(64) NOT NULL,
      compatibility_score DECIMAL(3, 2) NOT NULL,
      priority SMALLINT NOT NULL DEFAULT 2,
      reason TEXT,
      confidence DECIMAL(3, 2) NOT NULL DEFAULT 0,
      sample_count INTEGER NOT NULL DEFAULT 0,
      cultural_context VARCHAR(32),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      
      CONSTRAINT unique_pairing UNIQUE (source_category, target_category, COALESCE(cultural_context, ''))
    );
    
    CREATE INDEX IF NOT EXISTS idx_compat_source ON category_compatibility (source_category);
    CREATE INDEX IF NOT EXISTS idx_compat_cultural ON category_compatibility (cultural_context);
  `);
}
