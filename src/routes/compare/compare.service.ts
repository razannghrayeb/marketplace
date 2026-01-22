/**
 * Compare Service
 * 
 * Business logic for product comparison feature.
 */

import { 
  compareProducts, 
  getProductQualitySignals,
  CompareVerdict,
  ProductComparison,
  CompareReason,
} from "../../lib/compare/compareEngine.js";
import { 
  generateVerdict, 
  FullVerdictResponse,
  getReasonTooltip,
} from "../../lib/compare/verdictGenerator.js";
import { 
  analyzeTextQuality,
  QualityAnalysis,
} from "../../lib/compare/textQualityAnalyzer.js";
import {
  analyzePriceAnomalies,
  computeAllCategoryBaselines,
  getCategoryBaseline,
  PriceAnalysis,
  CategoryBaseline,
} from "../../lib/compare/priceAnomalyDetector.js";

// ============================================================================
// Types
// ============================================================================

export interface CompareProductsResult extends FullVerdictResponse {
  product_map: Record<number, string>;
}

export interface ProductQualityResult {
  product_id: number;
  overall_score: number;
  overall_level: "green" | "yellow" | "red";
  scores: {
    text: number;
    price: number;
    image: number;
    policy: number;
  };
  signals: ProductComparison["signals"];
}

export interface BaselineComputeResult {
  computed: number;
  errors: string[];
}

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Compare 2-5 products and generate a verdict
 */
export async function compareProductsWithVerdict(
  productIds: number[]
): Promise<CompareProductsResult> {
  // Run comparison
  const comparison = await compareProducts(productIds);
  
  // Generate verdict with letters
  const letterMap = new Map<number, string>();
  const letters = ["A", "B", "C", "D", "E"];
  productIds.forEach((id, i) => letterMap.set(id, letters[i]));
  
  const fullVerdict = generateVerdict(comparison, letterMap);
  
  return {
    ...fullVerdict,
    product_map: Object.fromEntries(letterMap),
  };
}

/**
 * Get quality signals for a single product
 */
export async function getProductQuality(
  productId: number
): Promise<ProductQualityResult> {
  const signals = await getProductQualitySignals(productId);
  
  return {
    product_id: productId,
    overall_score: signals.overall_score,
    overall_level: signals.overall_level,
    scores: {
      text: signals.text_score,
      price: signals.price_score,
      image: signals.image_score,
      policy: signals.policy_score,
    },
    signals: signals.signals,
  };
}

/**
 * Analyze text quality without needing a product in database
 */
export function analyzeText(
  title: string,
  description?: string,
  returnPolicy?: string
): QualityAnalysis {
  return analyzeTextQuality(title, description, returnPolicy);
}

/**
 * Get price anomaly analysis for a product
 */
export async function getPriceAnalysis(
  productId: number
): Promise<PriceAnalysis> {
  return analyzePriceAnomalies(productId);
}

/**
 * Get price baseline for a category
 */
export async function getBaseline(
  category: string
): Promise<CategoryBaseline | null> {
  return getCategoryBaseline(category);
}

/**
 * Trigger category baseline computation
 */
export async function computeBaselines(): Promise<BaselineComputeResult> {
  return computeAllCategoryBaselines();
}

/**
 * Get all reason tooltips for UI
 */
export function getAllTooltips(): Record<string, string> {
  const reasons: CompareReason[] = [
    "better_description_quality",
    "stable_pricing",
    "original_images",
    "clear_return_policy",
    "premium_fabric",
    "lower_price_risk",
    "detailed_sizing",
    "care_instructions",
    "price_volatility",
    "limited_details",
    "suspicious_pricing",
    "no_return_policy",
    "generic_images",
    "red_flag_content",
  ];
  
  const tooltips: Record<string, string> = {};
  for (const reason of reasons) {
    tooltips[reason] = getReasonTooltip(reason);
  }
  
  return tooltips;
}

// ============================================================================
// Validation Helpers
// ============================================================================

export interface ValidationError {
  error: string;
  example?: unknown;
}

/**
 * Validate product IDs for comparison
 */
export function validateCompareInput(
  productIds: unknown
): ValidationError | null {
  if (!Array.isArray(productIds) || productIds.length < 2) {
    return { 
      error: "At least 2 product IDs required",
      example: { product_ids: [123, 456] }
    };
  }
  
  if (productIds.length > 5) {
    return { error: "Maximum 5 products can be compared at once" };
  }
  
  if (!productIds.every(id => typeof id === "number" && id > 0)) {
    return { error: "Invalid product IDs" };
  }
  
  return null;
}

/**
 * Validate product ID parameter
 */
export function validateProductId(id: string): number | null {
  const productId = parseInt(id, 10);
  if (isNaN(productId) || productId <= 0) {
    return null;
  }
  return productId;
}

/**
 * Validate text analysis input
 */
export function validateTextInput(
  title: unknown
): ValidationError | null {
  if (!title || typeof title !== "string") {
    return { error: "Title is required" };
  }
  return null;
}
