/**
 * Outfit Service
 * 
 * Business logic for "Complete My Style" outfit recommendations.
 */
import {
  completeOutfitFromProductId,
  completeMyStyle,
  detectCategory,
  buildStyleProfile,
  type Product,
  type OutfitCompletion,
  type StyleProfile,
  type ProductCategory,
} from "../../lib/outfit/index";
import { type ExtractedAttributes } from "../../lib/search/attributeExtractor";
import { pg } from "../../lib/core";
import {
  logImpressionBatch,
  type RecommendationImpression,
} from "../../lib/recommendations";

// ============================================================================
// Types
// ============================================================================

export interface CompleteStyleOptions {
  maxPerCategory?: number;
  maxTotal?: number;
  priceRange?: { min?: number; max?: number };
  excludeBrands?: string[];
  preferSameBrand?: boolean;
  disablePriceFilter?: boolean;  // Disable default 0.5x-2.5x price range
}

export interface StyleRecommendationResponse {
  sourceProduct: Product;
  detectedCategory: ProductCategory;
  style: {
    occasion: string;
    aesthetic: string;
    season: string;
    formality: number;
    colorProfile: {
      primary: string;
      type: string;
    };
  };
  outfitSuggestion: string;
  recommendations: Array<{
    category: string;
    reason: string;
    priority: number;
    priorityLabel: string;
    products: Array<{
      id: number;
      title: string;
      brand?: string;
      price: number;
      currency: string;
      image?: string;
      matchScore: number;
      matchReasons: string[];
      owned?: boolean;
    }>;
  }>;
  totalRecommendations: number;
}

export interface StyleProfileResponse {
  product: {
    id: number;
    title: string;
    brand?: string;
  };
  detectedCategory: ProductCategory;
  categoryConfidence: number;
  extractedAttributes: ExtractedAttributes;
  styleProfile: {
    occasion: string;
    aesthetic: string;
    season: string;
    formality: number;
    formalityLabel: string;
    colorProfile: {
      primary: string;
      type: string;
      harmonies: Array<{
        type: string;
        colors: string[];
      }>;
    };
  };
}

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Get outfit completion recommendations for a product by ID
 */
export async function getOutfitRecommendations(
  productId: number,
  options: CompleteStyleOptions = {},
  userId?: number
): Promise<StyleRecommendationResponse | null> {
  const result = await completeOutfitFromProductId(productId, {
    maxPerCategory: options.maxPerCategory,
    maxTotal: options.maxTotal,
    priceRange: options.priceRange,
    excludeBrands: options.excludeBrands,
    preferSameBrand: options.preferSameBrand,
    disablePriceFilter: options.disablePriceFilter,
  });

  if (!result) {
    return null;
  }

  const response = formatOutfitCompletion(
    userId ? await mergeWardrobeOwnedIntoCompletion(result, userId, options) : result
  );

  // Log impressions for training data (async, non-blocking)
  logOutfitImpressions(productId, result).catch((err) =>
    console.error("[OutfitService] Failed to log impressions:", err)
  );

  return response;
}

/**
 * Get outfit recommendations for a product object (not from database)
 */
export async function getOutfitRecommendationsFromProduct(
  product: Product,
  options: CompleteStyleOptions = {},
  userId?: number
): Promise<StyleRecommendationResponse> {
  const result = await completeMyStyle(product, {
    maxPerCategory: options.maxPerCategory,
    maxTotal: options.maxTotal,
    priceRange: options.priceRange,
    excludeBrands: options.excludeBrands,
    preferSameBrand: options.preferSameBrand,
    disablePriceFilter: options.disablePriceFilter,
  });

  return formatOutfitCompletion(
    userId ? await mergeWardrobeOwnedIntoCompletion(result, userId, options) : result
  );
}

/**
 * Get style profile for a product by ID
 */
export async function getProductStyleProfile(
  productId: number
): Promise<StyleProfileResponse | null> {
  const result = await pg.query(`
    SELECT id, title, brand, category, color, price_cents, currency, 
           image_url, image_cdn, description
    FROM products 
    WHERE id = $1
  `, [productId]);

  if (result.rows.length === 0) {
    return null;
  }

  const product = result.rows[0] as Product;
  const categoryResult = await detectCategory(product.title, product.description);
  const styleProfile = await buildStyleProfile(product);

  return {
    product: {
      id: product.id,
      title: product.title,
      brand: product.brand,
    },
    detectedCategory: categoryResult.category,
    categoryConfidence: categoryResult.confidence,
    extractedAttributes: categoryResult.attributes,
    styleProfile: {
      occasion: styleProfile.occasion,
      aesthetic: styleProfile.aesthetic,
      season: styleProfile.season,
      formality: styleProfile.formality,
      formalityLabel: getFormalityLabel(styleProfile.formality),
      colorProfile: {
        primary: styleProfile.colorProfile.primary,
        type: styleProfile.colorProfile.type,
        harmonies: styleProfile.colorProfile.harmonies.map(h => ({
          type: h.type,
          colors: h.colors.slice(0, 5),
        })),
      },
    },
  };
}

/**
 * Analyze a product and return its detected category and style
 */
export async function analyzeProductStyle(product: Product): Promise<{
  category: ProductCategory;
  categoryConfidence: number;
  attributes: ExtractedAttributes;
  style: StyleProfile;
}> {
  const categoryResult = await detectCategory(product.title, product.description);
  const style = await buildStyleProfile(product);
  return {
    category: categoryResult.category,
    categoryConfidence: categoryResult.confidence,
    attributes: categoryResult.attributes,
    style,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format OutfitCompletion to API response format
 */
function formatOutfitCompletion(result: OutfitCompletion): StyleRecommendationResponse {
  return {
    sourceProduct: result.sourceProduct,
    detectedCategory: result.detectedCategory,
    style: {
      occasion: result.detectedStyle.occasion,
      aesthetic: result.detectedStyle.aesthetic,
      season: result.detectedStyle.season,
      formality: result.detectedStyle.formality,
      colorProfile: {
        primary: result.detectedStyle.colorProfile.primary,
        type: result.detectedStyle.colorProfile.type,
      },
    },
    outfitSuggestion: result.outfitSuggestion,
    recommendations: result.recommendations.map(rec => ({
      category: rec.category,
      reason: rec.reason,
      priority: rec.priority,
      priorityLabel: getPriorityLabel(rec.priority),
      products: rec.products.map(p => ({
        id: p.id,
        title: p.title,
        brand: p.brand,
        price: p.price_cents,
        currency: p.currency,
        image: p.image_cdn || p.image_url,
        matchScore: Math.round(p.matchScore),
        matchReasons: p.matchReasons,
        owned: (p as any).owned === true ? true : undefined,
      })),
    })),
    totalRecommendations: result.recommendations.reduce((sum, r) => sum + r.products.length, 0),
  };
}

async function mergeWardrobeOwnedIntoCompletion(
  completion: OutfitCompletion,
  userId: number,
  options: CompleteStyleOptions
): Promise<OutfitCompletion> {
  const ownedMaxPerCategory = Math.max(1, options.maxPerCategory ?? 5);

  // Fetch products the user already owns (wardrobe-backed).
  // We only return website products, but we merge in owned products and mark them.
  const ownedRows = await pg.query<Product>(`
    SELECT
      p.id,
      p.title,
      p.brand,
      p.category,
      p.color,
      p.price_cents,
      p.currency,
      p.image_url,
      p.image_cdn,
      p.description
    FROM wardrobe_items wi
    JOIN products p ON p.id = wi.product_id
    WHERE wi.user_id = $1
      AND wi.product_id IS NOT NULL
      AND p.availability = true
  `, [userId]);

  if (!ownedRows.rows.length) {
    return completion;
  }

  const ownedProducts = ownedRows.rows.slice(0, 50);

  // Detect product categories for owned items so they can be merged into the right rec buckets.
  const ownedWithDetected = await Promise.all(
    ownedProducts.map(async (p) => {
      const cat = await detectCategory(p.title, p.description);
      return { product: p, detectedCategory: cat.category as ProductCategory };
    })
  );

  for (const rec of completion.recommendations) {
    const tokens = rec.category
      .split(" / ")
      .map(t => t.trim())
      .filter(Boolean);

    const ownedForRec = ownedWithDetected.filter(o =>
      tokens.includes(o.detectedCategory)
    );
    if (ownedForRec.length === 0) continue;

    const ownedIdSet = new Set<number>(ownedForRec.map(o => o.product.id));

    // Mark existing website products that are also owned.
    for (const p of rec.products) {
      if (ownedIdSet.has(p.id)) {
        (p as any).owned = true;
      }
    }

    // Add owned products that weren’t present in the website engine output.
    const existingIds = new Set<number>(rec.products.map(p => p.id));
    const ownedExtras = ownedForRec
      .map(o => o.product)
      .filter(p => !existingIds.has(p.id));

    if (ownedExtras.length > 0) {
      const baseStyle = completion.detectedStyle;
      const stylePrimary = baseStyle.colorProfile.primary.toLowerCase();

      const extras = ownedExtras.map((p) => {
        const candidateColor = (p.color || "").toLowerCase();

        // Basic color-based score so owned items feel relevant (without breaking website scoring).
        let colorHarmony = 0.6;
        if (!candidateColor) {
          colorHarmony = 0.6;
        } else if (stylePrimary === "neutral") {
          colorHarmony = 0.9;
        } else if (candidateColor === stylePrimary) {
          colorHarmony = 0.85;
        } else if (baseStyle.colorProfile.harmonies.some(h => h.colors.includes(candidateColor))) {
          colorHarmony = 0.8;
        }

        const matchScore = Math.round(60 + colorHarmony * 40); // 84-100 range typical

        const matchReasons: string[] = ["In your wardrobe"];
        if (baseStyle.colorProfile.primary && baseStyle.colorProfile.primary !== "neutral") {
          matchReasons.push(
            colorHarmony >= 0.8 ? "Color aligns with your style" : "Good color harmony"
          );
        } else {
          matchReasons.push("Neutral base matches your style");
        }

        return {
          ...p,
          matchScore,
          matchReasons,
          owned: true,
        } as any;
      });

      rec.products = [...extras, ...rec.products];
    }

    // Put owned items first, then keep best matchScore order.
    rec.products = rec.products
      .sort((a: any, b: any) => {
        const aOwned = a.owned === true ? 1 : 0;
        const bOwned = b.owned === true ? 1 : 0;
        if (aOwned !== bOwned) return bOwned - aOwned;
        return (b.matchScore ?? 0) - (a.matchScore ?? 0);
      })
      .slice(0, ownedMaxPerCategory);
  }

  return completion;
}

/**
 * Get human-readable formality label
 */
function getFormalityLabel(formality: number): string {
  if (formality <= 2) return "Very Casual";
  if (formality <= 4) return "Casual";
  if (formality <= 6) return "Smart Casual";
  if (formality <= 8) return "Semi-Formal";
  return "Formal";
}

/**
 * Get human-readable priority label
 */
function getPriorityLabel(priority: number): string {
  switch (priority) {
    case 1: return "Essential";
    case 2: return "Recommended";
    default: return "Optional";
  }
}

// ============================================================================
// Impression Logging
// ============================================================================

/**
 * Log outfit recommendations as impressions for training data
 * Maps outfit completion results to the impression format
 */
async function logOutfitImpressions(
  baseProductId: number,
  result: OutfitCompletion
): Promise<void> {
  const impressions: RecommendationImpression[] = [];
  let globalPosition = 0;

  const basePriceCents = result.sourceProduct.price_cents || 1;
  const baseCategory = result.detectedCategory;

  for (const recommendation of result.recommendations) {
    for (const product of recommendation.products) {
      globalPosition++;

      // Calculate price ratio
      const priceRatio = product.price_cents / basePriceCents;

      // Build category pair string
      const candidateCategory = recommendation.category.split(" / ")[0]?.toLowerCase() || "unknown";
      const categoryPair = `${baseCategory}->${candidateCategory}`;

      // Extract style/color scores from match reasons
      const matchReasons = product.matchReasons || [];
      const hasColorMatch = matchReasons.some((r) => r.toLowerCase().includes("color"));
      const hasStyleMatch = matchReasons.some(
        (r) => r.toLowerCase().includes("formality") || r.toLowerCase().includes("occasion")
      );

      // Normalize matchScore to 0-1 (assuming max ~100)
      const normalizedMatchScore = Math.min(1, product.matchScore / 100);

      impressions.push({
        baseProductId,
        candidateProductId: product.id,
        position: globalPosition,
        
        // Core scores - outfit engine doesn't have CLIP/text scores directly
        candidateScore: normalizedMatchScore,
        clipSim: undefined,  // Not available from outfit engine
        textSim: undefined,
        opensearchScore: undefined,
        pHashDist: undefined,
        
        // Style matching scores
        styleScore: hasStyleMatch ? normalizedMatchScore * 0.7 : normalizedMatchScore * 0.3,
        colorScore: hasColorMatch ? 0.8 : 0.2,
        finalMatchScore: product.matchScore,
        
        // Context features
        categoryPair,
        priceRatio,
        sameBrand: product.brand?.toLowerCase() === result.sourceProduct.brand?.toLowerCase(),
        sameVendor: false,  // Not tracked in outfit completion
        
        // Match reasons
        matchReasons,
        
        // Source
        source: "outfit",
        context: "complete_outfit",
      });
    }
  }

  if (impressions.length > 0) {
    await logImpressionBatch({
      baseProductId,
      impressions,
      context: "complete_outfit",
    });
  }
}
