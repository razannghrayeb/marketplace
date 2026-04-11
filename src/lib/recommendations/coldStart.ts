/**
 * Cold Start Handling for Recommendations
 * 
 * Handles new products with no interaction data and new users
 * with empty or small wardrobes. Implements exploration boost
 * and onboarding recommendation strategies.
 */

import { pg } from "../core/db";
import { osClient } from "../core/opensearch";
import { config } from "../../config";
import type { RankedCandidateResult } from "../ranker/pipeline";

// ============================================================================
// Types
// ============================================================================

export interface ColdStartConfig {
  newProductWindowDays: number;     // Products created within this window are "new"
  minInteractionsForWarm: number;   // Minimum interactions to not be cold
  explorationBoostFactor: number;   // Boost multiplier for new products
  explorationDecayDays: number;     // Days over which boost decays
}

export interface UserOnboardingProfile {
  userId: number;
  gender?: string;
  ageRange?: string;
  stylePreferences?: string[];
  priceRange?: { min: number; max: number };
  wardrobeSize: number;
}

export interface OnboardingRecommendation {
  productId: number;
  title: string;
  brand?: string;
  category?: string;
  priceCents: number;
  imageUrl?: string;
  score: number;
  reason: string;
  reasonType: "trending" | "popular" | "essential" | "style_match";
}

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_CONFIG: ColdStartConfig = {
  newProductWindowDays: 7,
  minInteractionsForWarm: 5,
  explorationBoostFactor: 0.15,
  explorationDecayDays: 14,
};

const ESSENTIAL_CATEGORIES = [
  { category: "tops", priority: 1, reason: "Every wardrobe needs versatile tops" },
  { category: "bottoms", priority: 1, reason: "Essential pants or jeans" },
  { category: "shoes", priority: 2, reason: "Complete your looks with footwear" },
  { category: "outerwear", priority: 2, reason: "Layer up for different occasions" },
  { category: "bags", priority: 3, reason: "A bag for everyday essentials" },
];

// ============================================================================
// Product Cold Start
// ============================================================================

/**
 * Apply exploration boost to new products
 */
export function applyExplorationBoost(
  candidates: RankedCandidateResult[],
  config: ColdStartConfig = DEFAULT_CONFIG
): RankedCandidateResult[] {
  const now = Date.now();
  const windowMs = config.newProductWindowDays * 24 * 60 * 60 * 1000;
  const decayMs = config.explorationDecayDays * 24 * 60 * 60 * 1000;
  
  return candidates.map(candidate => {
    // Check if product is new (has created_at in metadata)
    const createdAt = candidate.product?.created_at 
      ? new Date(candidate.product.created_at).getTime()
      : 0;
    
    const age = now - createdAt;
    
    // Only boost if within window
    if (age > windowMs) {
      return candidate;
    }
    
    // Check interaction count (if available)
    const interactionCount = candidate.product?.interaction_count || 0;
    if (interactionCount >= config.minInteractionsForWarm) {
      return candidate; // Product has enough data
    }
    
    // Calculate boost with decay
    const decayFactor = Math.max(0, 1 - (age / decayMs));
    const boost = config.explorationBoostFactor * decayFactor;
    
    return {
      ...candidate,
      rankerScore: candidate.rankerScore + boost,
      coldStartBoosted: true,
      explorationBoost: boost,
    } as RankedCandidateResult & { coldStartBoosted: boolean; explorationBoost: number };
  });
}

/**
 * Get new products for exploration
 */
export async function getNewProductsForExploration(
  limit: number = 50,
  excludeProductIds: number[] = []
): Promise<Array<{ productId: number; daysOld: number; interactionCount: number }>> {
  const result = await pg.query<{
    id: number;
    days_old: string;
    interaction_count: string;
  }>(
    `SELECT 
       p.id,
       EXTRACT(DAY FROM NOW() - p.created_at) as days_old,
       COALESCE(ic.count, 0) as interaction_count
     FROM products p
     LEFT JOIN (
       SELECT product_id, COUNT(*) as count
       FROM product_interactions
       GROUP BY product_id
     ) ic ON ic.product_id = p.id
     WHERE p.availability = true
       AND p.created_at > NOW() - INTERVAL '14 days'
       AND p.id != ALL($1::int[])
     ORDER BY p.created_at DESC
     LIMIT $2`,
    [excludeProductIds, limit]
  );
  
  return result.rows.map(row => ({
    productId: row.id,
    daysOld: parseFloat(row.days_old),
    interactionCount: parseInt(row.interaction_count, 10),
  }));
}

// ============================================================================
// User Cold Start (Onboarding)
// ============================================================================

/**
 * Get user onboarding profile
 */
export async function getUserOnboardingProfile(
  userId: number
): Promise<UserOnboardingProfile> {
  const result = await pg.query<{
    gender?: string;
    age_range?: string;
    style_preferences?: string[];
  }>(
    `SELECT gender, age_range, style_preferences FROM users WHERE id = $1`,
    [userId]
  );
  
  const wardrobeCount = await pg.query<{ count: string }>(
    `SELECT COUNT(*) FROM wardrobe_items WHERE user_id = $1`,
    [userId]
  );
  
  const priceRange = await pg.query<{ p25?: string; p75?: string }>(
    `SELECT 
       percentile_cont(0.25) WITHIN GROUP (ORDER BY price_cents) as p25,
       percentile_cont(0.75) WITHIN GROUP (ORDER BY price_cents) as p75
     FROM wardrobe_items
     WHERE user_id = $1 AND price_cents > 0`,
    [userId]
  );
  
  const user = result.rows[0] || {};
  const prices = priceRange.rows[0] || {};
  
  return {
    userId,
    gender: user.gender,
    ageRange: user.age_range,
    stylePreferences: user.style_preferences,
    priceRange: prices.p25 && prices.p75 
      ? { min: parseFloat(prices.p25), max: parseFloat(prices.p75) }
      : undefined,
    wardrobeSize: parseInt(wardrobeCount.rows[0].count, 10),
  };
}

/**
 * Get onboarding recommendations for a new user
 */
export async function getOnboardingRecommendations(
  userId: number,
  limit: number = 20
): Promise<OnboardingRecommendation[]> {
  const profile = await getUserOnboardingProfile(userId);
  const recommendations: OnboardingRecommendation[] = [];
  
  // If wardrobe has items, use style-based recommendations
  if (profile.wardrobeSize >= 3) {
    const styleRecs = await getStyleBasedOnboarding(userId, Math.ceil(limit / 2));
    recommendations.push(...styleRecs);
  }
  
  // Get trending items for demographic
  const trendingRecs = await getTrendingForDemographic(profile, Math.ceil(limit / 2));
  recommendations.push(...trendingRecs);
  
  // Get essential category items (if missing)
  if (profile.wardrobeSize < 10) {
    const essentialRecs = await getEssentialCategoryItems(userId, Math.ceil(limit / 3));
    recommendations.push(...essentialRecs);
  }
  
  // Deduplicate and sort
  const seen = new Set<number>();
  const deduped = recommendations.filter(rec => {
    if (seen.has(rec.productId)) return false;
    seen.add(rec.productId);
    return true;
  });
  
  return deduped
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Get style-based recommendations from wardrobe centroid
 */
async function getStyleBasedOnboarding(
  userId: number,
  limit: number
): Promise<OnboardingRecommendation[]> {
  // Get wardrobe centroid embedding
  const centroidResult = await pg.query<{ embedding: number[] }>(
    `SELECT array_agg(unnest) as embedding
     FROM (
       SELECT unnest(embedding)
       FROM wardrobe_items
       WHERE user_id = $1 AND embedding IS NOT NULL
       LIMIT 20
     ) sub`,
    [userId]
  );
  
  if (!centroidResult.rows[0]?.embedding) {
    return [];
  }
  
  // Search for similar products
  const response = await osClient.search({
    index: config.opensearch.index,
    body: {
      size: limit,
      query: {
        bool: {
          must: {
            knn: {
              embedding: {
                vector: centroidResult.rows[0].embedding,
                k: limit * 2,
              },
            },
          },
          filter: [
            // Allow BOTH in_stock and out_of_stock products
            { bool: { should: [{ term: { availability: "in_stock" } }, { term: { availability: "out_of_stock" } }], minimum_should_match: 1 } },
          ],
        },
      },
    },
  });
  
  return response.body.hits.hits.map((hit: any) => ({
    productId: parseInt(hit._source.product_id, 10),
    title: hit._source.title,
    brand: hit._source.brand,
    category: hit._source.category,
    priceCents: hit._source.price_cents,
    imageUrl: hit._source.image_cdn,
    score: hit._score,
    reason: "Matches your personal style",
    reasonType: "style_match" as const,
  }));
}

/**
 * Get trending items for user demographic
 */
async function getTrendingForDemographic(
  profile: UserOnboardingProfile,
  limit: number
): Promise<OnboardingRecommendation[]> {
  const filters: any[] = [
    // Allow BOTH in_stock and out_of_stock products
    { bool: { should: [{ term: { availability: "in_stock" } }, { term: { availability: "out_of_stock" } }], minimum_should_match: 1 } },
    { range: { popularity_score: { gte: 0.5 } } },
  ];
  
  // Add price filter if known
  if (profile.priceRange) {
    filters.push({
      range: {
        price_cents: {
          gte: profile.priceRange.min * 0.5,
          lte: profile.priceRange.max * 1.5,
        },
      },
    });
  }
  
  // Build should clauses for preferences
  const should: any[] = [];
  
  if (profile.gender) {
    should.push({ match: { target_gender: profile.gender } });
  }
  
  if (profile.stylePreferences && profile.stylePreferences.length > 0) {
    for (const style of profile.stylePreferences) {
      should.push({ match: { style: { query: style, boost: 1.5 } } });
    }
  }
  
  const response = await osClient.search({
    index: config.opensearch.index,
    body: {
      size: limit,
      query: {
        bool: {
          should,
          filter: filters,
          minimum_should_match: 0,
        },
      },
      sort: [
        { popularity_score: "desc" },
        { created_at: "desc" },
      ],
    },
  });
  
  return response.body.hits.hits.map((hit: any) => ({
    productId: parseInt(hit._source.product_id, 10),
    title: hit._source.title,
    brand: hit._source.brand,
    category: hit._source.category,
    priceCents: hit._source.price_cents,
    imageUrl: hit._source.image_cdn,
    score: hit._score * 0.9,
    reason: "Trending in your demographic",
    reasonType: "trending" as const,
  }));
}

/**
 * Get essential category items the user is missing
 */
async function getEssentialCategoryItems(
  userId: number,
  limit: number
): Promise<OnboardingRecommendation[]> {
  // Get user's current categories
  const userCategories = await pg.query<{ category: string }>(
    `SELECT DISTINCT c.name as category
     FROM wardrobe_items wi
     JOIN categories c ON wi.category_id = c.id
     WHERE wi.user_id = $1`,
    [userId]
  );
  
  const hasCategories = new Set(userCategories.rows.map(r => r.category.toLowerCase()));
  
  // Find missing essential categories
  const missingEssentials = ESSENTIAL_CATEGORIES.filter(
    e => !hasCategories.has(e.category)
  );
  
  if (missingEssentials.length === 0) {
    return [];
  }
  
  const recommendations: OnboardingRecommendation[] = [];
  
  // Get products for each missing category
  for (const essential of missingEssentials.slice(0, 3)) {
    const response = await osClient.search({
      index: config.opensearch.index,
      body: {
        size: Math.ceil(limit / missingEssentials.length),
        query: {
          bool: {
            must: { match: { category: essential.category } },
            filter: [
              // Allow BOTH in_stock and out_of_stock products
              { bool: { should: [{ term: { availability: "in_stock" } }, { term: { availability: "out_of_stock" } }], minimum_should_match: 1 } },
              { range: { popularity_score: { gte: 0.3 } } },
            ],
          },
        },
        sort: [{ popularity_score: "desc" }],
      },
    });
    
    for (const hit of response.body.hits.hits) {
      recommendations.push({
        productId: parseInt(hit._source.product_id, 10),
        title: hit._source.title,
        brand: hit._source.brand,
        category: hit._source.category,
        priceCents: hit._source.price_cents,
        imageUrl: hit._source.image_cdn,
        score: hit._score * (1 / essential.priority),
        reason: essential.reason,
        reasonType: "essential" as const,
      });
    }
  }
  
  return recommendations;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if a user is in cold start state
 */
export async function isUserColdStart(userId: number): Promise<boolean> {
  const result = await pg.query<{ count: string }>(
    `SELECT COUNT(*) FROM wardrobe_items WHERE user_id = $1`,
    [userId]
  );
  
  return parseInt(result.rows[0].count, 10) < 5;
}

/**
 * Check if a product is in cold start state
 */
export async function isProductColdStart(
  productId: number,
  config: ColdStartConfig = DEFAULT_CONFIG
): Promise<boolean> {
  const result = await pg.query<{
    days_old: string;
    interaction_count: string;
  }>(
    `SELECT 
       EXTRACT(DAY FROM NOW() - p.created_at) as days_old,
       COALESCE(ic.count, 0) as interaction_count
     FROM products p
     LEFT JOIN (
       SELECT product_id, COUNT(*) as count
       FROM product_interactions
       WHERE product_id = $1
       GROUP BY product_id
     ) ic ON ic.product_id = p.id
     WHERE p.id = $1`,
    [productId]
  );
  
  if (result.rows.length === 0) {
    return true;
  }
  
  const row = result.rows[0];
  const daysOld = parseFloat(row.days_old);
  const interactionCount = parseInt(row.interaction_count, 10);
  
  return daysOld <= config.newProductWindowDays && 
         interactionCount < config.minInteractionsForWarm;
}
