/**
 * Compare Service
 * 
 * Business logic for product comparison feature.
 * Now includes review sentiment analysis.
 */

import { 
  compareProducts, 
  getProductQualitySignals,
  CompareVerdict,
  ProductComparison,
  CompareReason,
  CompareGoal,
  CompareOccasion,
  CompareRequestOptions,
} from "../../lib/compare/compareEngine";
import { 
  generateVerdict, 
  FullVerdictResponse,
  getReasonTooltip,
} from "../../lib/compare/verdictGenerator";
import { 
  analyzeTextQuality,
  QualityAnalysis,
} from "../../lib/compare/textQualityAnalyzer";
import {
  analyzePriceAnomalies,
  computeAllCategoryBaselines,
  getCategoryBaseline,
  PriceAnalysis,
  CategoryBaseline,
} from "../../lib/compare/priceAnomalyDetector";
import {
  analyzeProductReviews,
  compareProductReviews,
  type ReviewAnalysis,
} from "../../lib/reviews/sentimentAnalysis";

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
  productIds: number[],
  options: CompareRequestOptions = {}
): Promise<CompareProductsResult> {
  // Run comparison
  const comparison = await compareProducts(productIds, options);
  
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

const VALID_COMPARE_GOALS: CompareGoal[] = [
  "best_value",
  "premium_quality",
  "style_match",
  "low_risk_return",
  "occasion_fit",
];

const VALID_OCCASIONS: CompareOccasion[] = ["casual", "work", "formal", "party", "travel"];

export type CompareIdsValidation =
  | { ok: true; productIds: number[] }
  | ({ ok: false } & ValidationError);

export type CompareOptionsValidation =
  | { ok: true; options: CompareRequestOptions }
  | ({ ok: false } & ValidationError);

function parsePositiveInt(raw: unknown): number | null {
  if (typeof raw === "number") {
    return Number.isInteger(raw) && raw > 0 ? raw : null;
  }
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!/^\d+$/.test(t)) return null;
    const n = parseInt(t, 10);
    return n > 0 ? n : null;
  }
  return null;
}

/**
 * Normalize product_ids from JSON body or multipart fields (stringified JSON array, comma-separated, or multer string[]).
 */
export function coerceCompareProductIdsInput(body: unknown): unknown {
  if (!body || typeof body !== "object") return undefined;
  const b = body as Record<string, unknown>;
  const raw =
    b.product_ids !== undefined
      ? b.product_ids
      : b.productIds !== undefined
        ? b.productIds
        : undefined;
  if (raw === undefined) return undefined;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return undefined;
    if (t.startsWith("[")) {
      try {
        const parsed = JSON.parse(t) as unknown;
        return Array.isArray(parsed) ? parsed : raw;
      } catch {
        return raw;
      }
    }
    return t.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
  }
  return raw;
}

/**
 * Validate and normalize product IDs for comparison.
 * Accepts numbers or numeric strings (common from JSON/query-driven clients).
 */
export function validateCompareInput(productIds: unknown): CompareIdsValidation {
  if (!Array.isArray(productIds) || productIds.length < 2) {
    return {
      ok: false,
      error: "At least 2 product IDs required",
      example: { product_ids: [123, 456] },
    };
  }

  if (productIds.length > 5) {
    return { ok: false, error: "Maximum 5 products can be compared at once" };
  }

  const ids: number[] = [];
  for (const raw of productIds) {
    const n = parsePositiveInt(raw);
    if (n === null) {
      return {
        ok: false,
        error:
          "Invalid product IDs: use positive integers (e.g. [123, 456] or [\"123\", \"456\"])",
        example: { product_ids: [123, 456] },
      };
    }
    ids.push(n);
  }

  return { ok: true, productIds: ids };
}

/**
 * Validate and normalize compare options for intelligent mode.
 */
export function validateCompareOptions(raw: unknown): CompareOptionsValidation {
  if (!raw || typeof raw !== "object") {
    return { ok: true, options: {} };
  }
  const input = raw as Record<string, unknown>;
  const options: CompareRequestOptions = {};

  if (input.compare_goal !== undefined && input.compare_goal !== null && input.compare_goal !== "") {
    const goal = String(input.compare_goal).trim() as CompareGoal;
    if (!VALID_COMPARE_GOALS.includes(goal)) {
      return {
        ok: false,
        error: `Invalid compare_goal. Allowed: ${VALID_COMPARE_GOALS.join(", ")}`,
        example: { compare_goal: "best_value" },
      };
    }
    options.goal = goal;
  }

  if (input.occasion !== undefined && input.occasion !== null && input.occasion !== "") {
    const occasion = String(input.occasion).trim() as CompareOccasion;
    if (!VALID_OCCASIONS.includes(occasion)) {
      return {
        ok: false,
        error: `Invalid occasion. Allowed: ${VALID_OCCASIONS.join(", ")}`,
        example: { occasion: "work" },
      };
    }
    options.occasion = occasion;
  }

  return { ok: true, options };
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

// ============================================================================
// Review Analysis
// ============================================================================

/**
 * Get review analysis for a single product
 */
export async function getProductReviewAnalysis(
  productId: number
): Promise<ReviewAnalysis> {
  return analyzeProductReviews(productId);
}

/**
 * Compare reviews across multiple products
 */
export async function compareReviews(
  productIds: number[]
): Promise<Map<number, ReviewAnalysis>> {
  return compareProductReviews(productIds);
}
