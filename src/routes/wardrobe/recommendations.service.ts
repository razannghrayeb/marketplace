/**
 * Wardrobe Recommendations Service
 * Personalized product recommendations based on wardrobe analysis
 */
import { pg } from "../../lib/core";
import { osClient } from "../../lib/core";
import { config } from "../../config";
import { getStyleProfile } from "./styleProfile.service";
import { analyzeWardrobeGaps } from "./gaps.service";
import { getTopCompatibleItems } from "./compatibility.service";
import { 
  getOnboardingRecommendations as getColdStartOnboarding,
  isUserColdStart 
} from "../../lib/recommendations/coldStart";
import { getAdaptedEssentials, inferPriceTier } from "../../lib/wardrobe/lifestyleAdapter";

// ============================================================================
// Types
// ============================================================================

export interface ProductRecommendation {
  product_id: number;
  title: string;
  brand?: string;
  category?: string;
  price_cents?: number;
  image_url?: string;
  score: number;
  reason: string;
  reason_type: "gap" | "style_match" | "compatible" | "trending";
}

export interface RecommendationOptions {
  limit?: number;
  includeGapBased?: boolean;
  includeStyleBased?: boolean;
  includeCompatibilityBased?: boolean;
  priceMin?: number;
  priceMax?: number;
  categories?: string[];
}

// ============================================================================
// Recommendation Generation
// ============================================================================

/**
 * Get personalized product recommendations
 */
export async function getRecommendations(
  userId: number,
  options: RecommendationOptions = {}
): Promise<ProductRecommendation[]> {
  const {
    limit = 20,
    includeGapBased = true,
    includeStyleBased = true,
    includeCompatibilityBased = true,
    priceMin,
    priceMax,
    categories
  } = options;

  const recommendations: ProductRecommendation[] = [];
  const seenProductIds = new Set<number>();

  // Build price filter
  const priceFilter: any[] = [];
  if (priceMin !== undefined) {
    priceFilter.push({ range: { price_usd: { gte: priceMin / 100 } } });
  }
  if (priceMax !== undefined) {
    priceFilter.push({ range: { price_usd: { lte: priceMax / 100 } } });
  }

  // 1. Gap-based recommendations
  if (includeGapBased) {
    const gapRecs = await getGapBasedRecommendations(userId, Math.ceil(limit / 3), priceFilter);
    for (const rec of gapRecs) {
      if (!seenProductIds.has(rec.product_id)) {
        recommendations.push(rec);
        seenProductIds.add(rec.product_id);
      }
    }
  }

  // 2. Style-based recommendations (similar to user's style centroid)
  if (includeStyleBased) {
    const styleRecs = await getStyleBasedRecommendations(userId, Math.ceil(limit / 3), priceFilter);
    for (const rec of styleRecs) {
      if (!seenProductIds.has(rec.product_id)) {
        recommendations.push(rec);
        seenProductIds.add(rec.product_id);
      }
    }
  }

  // 3. Compatibility-based (items that go with user's wardrobe)
  if (includeCompatibilityBased) {
    const compatRecs = await getCompatibilityBasedRecommendations(userId, Math.ceil(limit / 3), priceFilter);
    for (const rec of compatRecs) {
      if (!seenProductIds.has(rec.product_id)) {
        recommendations.push(rec);
        seenProductIds.add(rec.product_id);
      }
    }
  }

  // Sort by score and limit
  return recommendations
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Get recommendations based on wardrobe gaps
 */
async function getGapBasedRecommendations(
  userId: number,
  limit: number,
  priceFilter: any[]
): Promise<ProductRecommendation[]> {
  const { gaps, recommendations: gapRecs } = await analyzeWardrobeGaps(userId);
  const products: ProductRecommendation[] = [];

  for (const gap of gapRecs.slice(0, 3)) {
    try {
      const filter: any[] = [
        { term: { availability: "in_stock" } },
        ...priceFilter
      ];

      const response = await osClient.search({
        index: config.opensearch.index,
        body: {
          size: Math.ceil(limit / 3),
          query: {
            bool: {
              must: {
                multi_match: {
                  query: gap.search_query,
                  fields: ["title^2", "category", "brand"]
                }
              },
              filter
            }
          }
        }
      });

      for (const hit of response.body.hits.hits) {
        const source = hit._source;
        products.push({
          product_id: parseInt(source.product_id, 10),
          title: source.title,
          brand: source.brand,
          category: source.category,
          price_cents: source.price_usd ? source.price_usd * 100 : undefined,
          image_url: source.image_cdn,
          score: hit._score * (gap.priority === "high" ? 1.5 : gap.priority === "medium" ? 1.2 : 1.0),
          reason: gap.message,
          reason_type: "gap"
        });
      }
    } catch (err) {
      console.error("Error fetching gap-based recommendations:", err);
    }
  }

  return products;
}

/**
 * Get recommendations based on user's style profile
 */
async function getStyleBasedRecommendations(
  userId: number,
  limit: number,
  priceFilter: any[]
): Promise<ProductRecommendation[]> {
  const profile = await getStyleProfile(userId);
  if (!profile?.style_centroid) {
    return [];
  }

  try {
    const response = await osClient.search({
      index: config.opensearch.index,
      body: {
        size: limit,
        query: {
          bool: {
            must: {
              knn: {
                embedding: {
                  vector: profile.style_centroid,
                  k: limit * 2
                }
              }
            },
            filter: [
              { term: { availability: "in_stock" } },
              ...priceFilter
            ]
          }
        }
      }
    });

    return response.body.hits.hits.map((hit: any) => ({
      product_id: parseInt(hit._source.product_id, 10),
      title: hit._source.title,
      brand: hit._source.brand,
      category: hit._source.category,
      price_cents: hit._source.price_usd ? hit._source.price_usd * 100 : undefined,
      image_url: hit._source.image_cdn,
      score: hit._score,
      reason: "Matches your style",
      reason_type: "style_match" as const
    }));
  } catch (err) {
    console.error("Error fetching style-based recommendations:", err);
    return [];
  }
}

/**
 * Get recommendations based on wardrobe compatibility
 */
async function getCompatibilityBasedRecommendations(
  userId: number,
  limit: number,
  priceFilter: any[]
): Promise<ProductRecommendation[]> {
  // Get user's favorite/most used items
  const favItems = await pg.query<{ id: number; embedding: number[] }>(
    `SELECT id, embedding FROM wardrobe_items 
     WHERE user_id = $1 AND embedding IS NOT NULL
     ORDER BY created_at DESC
     LIMIT 5`,
    [userId]
  );

  if (favItems.rows.length === 0) {
    return [];
  }

  // Use the most recent item's embedding to find compatible products
  const recentItem = favItems.rows[0];
  if (!recentItem.embedding) {
    return [];
  }

  try {
    const response = await osClient.search({
      index: config.opensearch.index,
      body: {
        size: limit,
        query: {
          bool: {
            must: {
              knn: {
                embedding: {
                  vector: recentItem.embedding,
                  k: limit * 2
                }
              }
            },
            filter: [
              { term: { availability: "in_stock" } },
              ...priceFilter
            ]
          }
        }
      }
    });

    return response.body.hits.hits.map((hit: any) => ({
      product_id: parseInt(hit._source.product_id, 10),
      title: hit._source.title,
      brand: hit._source.brand,
      category: hit._source.category,
      price_cents: hit._source.price_usd ? hit._source.price_usd * 100 : undefined,
      image_url: hit._source.image_cdn,
      score: hit._score * 0.9, // Slightly lower priority than gap/style
      reason: "Goes well with items in your wardrobe",
      reason_type: "compatible" as const
    }));
  } catch (err) {
    console.error("Error fetching compatibility-based recommendations:", err);
    return [];
  }
}

/**
 * Get outfit suggestions for a specific item
 */
export async function getOutfitSuggestions(
  userId: number,
  itemId: number,
  limit: number = 5
): Promise<Array<{ items: number[]; score: number }>> {
  // Get compatible items from wardrobe
  const compatible = await getTopCompatibleItems(userId, itemId, 20);

  // Group into potential outfits
  const outfits: Array<{ items: number[]; score: number }> = [];

  // Simple greedy outfit building
  for (let i = 0; i < Math.min(limit, compatible.length); i++) {
    const outfit = [itemId, compatible[i].item_id];
    let score = compatible[i].score;

    // Try to add more items
    for (const c of compatible.slice(i + 1)) {
      if (outfit.length >= 4) break;
      outfit.push(c.item_id);
      score += c.score * 0.5;
    }

    outfits.push({ items: outfit, score });
  }

  return outfits.sort((a, b) => b.score - a.score);
}

/**
 * Get "complete the look" suggestions for a partial outfit
 */
export async function completeLookSuggestions(
  userId: number,
  currentItemIds: number[],
  limit: number = 10
): Promise<ProductRecommendation[]> {
  // Get categories of current items
  const currentItems = await pg.query(
    `SELECT wi.id, c.name as category_name
     FROM wardrobe_items wi
     LEFT JOIN categories c ON wi.category_id = c.id
     WHERE wi.id = ANY($1) AND wi.user_id = $2`,
    [currentItemIds, userId]
  );

  const currentCategories = new Set(
    currentItems.rows.map((r: any) => r.category_name).filter(Boolean)
  );

  // Determine missing categories for a complete outfit
  const essentialForOutfit = ["tops", "bottoms", "shoes"];
  const missingCategories = essentialForOutfit.filter(c => !currentCategories.has(c));

  if (missingCategories.length === 0) {
    missingCategories.push("accessories", "bags"); // Suggest extras
  }

  const suggestions: ProductRecommendation[] = [];

  for (const category of missingCategories) {
    try {
      const response = await osClient.search({
        index: config.opensearch.index,
        body: {
          size: Math.ceil(limit / missingCategories.length),
          query: {
            bool: {
              must: { match: { category } },
              filter: [{ term: { availability: "in_stock" } }]
            }
          }
        }
      });

      for (const hit of response.body.hits.hits) {
        suggestions.push({
          product_id: parseInt(hit._source.product_id, 10),
          title: hit._source.title,
          brand: hit._source.brand,
          category: hit._source.category,
          price_cents: hit._source.price_usd ? hit._source.price_usd * 100 : undefined,
          image_url: hit._source.image_cdn,
          score: hit._score,
          reason: `Add ${category} to complete the look`,
          reason_type: "compatible"
        });
      }
    } catch (err) {
      console.error(`Error fetching ${category} suggestions:`, err);
    }
  }

  return suggestions.slice(0, limit);
}

// ============================================================================
// Cold Start / Onboarding Recommendations
// ============================================================================

/**
 * Get onboarding recommendations for new users with empty/small wardrobes
 */
export async function getOnboardingRecommendationsForUser(
  userId: number,
  limit: number = 20
): Promise<ProductRecommendation[]> {
  const isColdStart = await isUserColdStart(userId);
  
  if (!isColdStart) {
    // User has enough wardrobe items, use regular recommendations
    return getRecommendations(userId, { limit });
  }
  
  // Use cold start onboarding logic
  const onboardingRecs = await getColdStartOnboarding(userId, limit);
  
  return onboardingRecs.map(rec => ({
    product_id: rec.productId,
    title: rec.title,
    brand: rec.brand,
    category: rec.category,
    price_cents: rec.priceCents,
    image_url: rec.imageUrl,
    score: rec.score,
    reason: rec.reason,
    reason_type: rec.reasonType as "gap" | "style_match" | "compatible" | "trending",
  }));
}

/**
 * Get user's adapted essential categories based on their lifestyle
 */
export async function getAdaptedEssentialsForUser(userId: number) {
  return getAdaptedEssentials(userId);
}

/**
 * Get user's inferred price tier
 */
export async function getUserPriceTier(userId: number) {
  return inferPriceTier(userId);
}
