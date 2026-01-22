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
} from "../../lib/outfit/index.js";
import { pg } from "../../lib/core/index.js";

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
  options: CompleteStyleOptions = {}
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

  return formatOutfitCompletion(result);
}

/**
 * Get outfit recommendations for a product object (not from database)
 */
export async function getOutfitRecommendationsFromProduct(
  product: Product,
  options: CompleteStyleOptions = {}
): Promise<StyleRecommendationResponse> {
  const result = await completeMyStyle(product, {
    maxPerCategory: options.maxPerCategory,
    maxTotal: options.maxTotal,
    priceRange: options.priceRange,
    excludeBrands: options.excludeBrands,
    preferSameBrand: options.preferSameBrand,
    disablePriceFilter: options.disablePriceFilter,
  });

  return formatOutfitCompletion(result);
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
  const category = detectCategory(product.title, product.description);
  const styleProfile = buildStyleProfile(product);

  return {
    product: {
      id: product.id,
      title: product.title,
      brand: product.brand,
    },
    detectedCategory: category,
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
export function analyzeProductStyle(product: Product): {
  category: ProductCategory;
  style: StyleProfile;
} {
  const category = detectCategory(product.title, product.description);
  const style = buildStyleProfile(product);
  return { category, style };
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
      })),
    })),
    totalRecommendations: result.recommendations.reduce((sum, r) => sum + r.products.length, 0),
  };
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
