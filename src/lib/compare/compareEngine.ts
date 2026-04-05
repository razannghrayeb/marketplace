/**
 * Product Compare Engine
 * 
 * Compares products using multiple quality signals:
 * - Description quality (text analysis)
 * - Price stability and market position
 * - Image originality (pHash comparison)
 * - Return policy confidence
 * 
 * Produces structured comparison results with reasons.
 */

import { pg } from "../core";
import { analyzeTextQuality, QualityAnalysis, getQualityReasons } from "./textQualityAnalyzer";
import { analyzePriceAnomalies, PriceAnalysis, getPriceReasons } from "./priceAnomalyDetector";
import { analyzeImageSignalsFast } from "../image/lsh";

// ============================================================================
// Types
// ============================================================================

export interface ProductForComparison {
  id: number;
  title: string;
  brand?: string | null;
  category?: string | null;
  color?: string | null;
  gender?: string | null;
  description?: string | null;
  price_cents: number;
  currency: string;
  sales_price_cents?: number | null;
  image_cdn?: string | null;
  p_hash?: string | null;
  return_policy?: string | null;
}

export interface ComparisonSignals {
  // Text quality
  text_quality: QualityAnalysis;
  
  // Price analysis
  price_analysis: PriceAnalysis;
  
  // Image analysis
  image_signals: {
    has_image: boolean;
    is_original: boolean;         // Not found elsewhere
    similar_image_count: number;  // How many similar images exist
    image_quality: "high" | "medium" | "low" | "unknown";
  };
  
  // Return policy
  return_policy_signals: {
    has_policy: boolean;
    allows_returns: boolean;
    return_window_days?: number;
    is_final_sale: boolean;
  };
}

export interface ProductComparison {
  product_id: number;
  signals: ComparisonSignals;
  
  // Aggregate scores
  overall_score: number;          // 0-100
  overall_level: "green" | "yellow" | "red";
  
  // Component scores
  text_score: number;
  price_score: number;
  image_score: number;
  policy_score: number;
}

export type CompareReason = 
  | "better_description_quality"
  | "stable_pricing"
  | "original_images"
  | "clear_return_policy"
  | "premium_fabric"
  | "lower_price_risk"
  | "detailed_sizing"
  | "care_instructions"
  | "price_volatility"
  | "limited_details"
  | "suspicious_pricing"
  | "no_return_policy"
  | "generic_images"
  | "red_flag_content";

/** Thrown when fewer than two requested products exist in the database. */
export class InsufficientProductsForCompareError extends Error {
  readonly missingProductIds: number[];

  constructor(requestedIds: number[], foundIds: number[]) {
    const foundSet = new Set(foundIds);
    const missing = requestedIds.filter((id) => !foundSet.has(id));
    const uniqueMissing = Array.from(new Set(missing));
    super(
      `Not all products found for comparison. Missing product id(s): ${uniqueMissing.join(", ")}.`
    );
    this.name = "InsufficientProductsForCompareError";
    this.missingProductIds = uniqueMissing;
  }
}

export interface CompareVerdict {
  winner_product_id: number | null;  // null = tie
  confidence: "high" | "medium" | "low" | "tie";
  comparison_mode: "direct_head_to_head" | "scenario_compare" | "outfit_compare";
  requested_goal: CompareGoal;
  requested_occasion: CompareOccasion | null;
  compatibility: {
    is_comparable: boolean;
    reason: string;
    category_groups: Record<number, string>;
  };
  shopping_insights: {
    best_quality_product_id: number | null;
    best_value_product_id: number | null;
    best_budget_product_id: number | null;
    weakest_link_product_id: number | null;
    notes: string[];
    suggested_next_action: string;
  };
  winners_by_goal: {
    overall: number | null;
    value: number | null;
    quality: number | null;
    style: number | null;
    risk: number | null;
    occasion: number | null;
  };
  evidence: string[];
  alternatives: {
    better_cheaper_product_id: number | null;
    better_quality_product_id: number | null;
    similar_style_safer_product_id: number | null;
  };
  risk_summary: {
    overall_risk_level: "low" | "medium" | "high";
    product_risks: Record<number, {
      risk_score: number;
      risk_level: "low" | "medium" | "high";
      reasons: string[];
    }>;
  };
  timing_insight: {
    recommendation: "buy_now" | "wait" | "monitor";
    reason: string;
  };
  outfit_impact?: {
    mode: "outfit_compare";
    outfit_winner_product_id: number | null;
    versatility_scores: Record<number, number>;
    gap_fill_scores: Record<number, number>;
  };
  
  // Top reasons the winner was chosen
  top_reasons: CompareReason[];
  
  // Tradeoff explanation
  tradeoff_reason: string | null;
  
  // Score difference
  score_difference: number;
  
  // Individual product comparisons
  products: ProductComparison[];
}

export type CompareGoal =
  | "best_value"
  | "premium_quality"
  | "style_match"
  | "low_risk_return"
  | "occasion_fit";

export type CompareOccasion = "casual" | "work" | "formal" | "party" | "travel";

export interface CompareRequestOptions {
  goal?: CompareGoal;
  occasion?: CompareOccasion | null;
}

function normalizeToken(v: string | null | undefined): string {
  return (v || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function inferCategoryGroup(product: ProductForComparison): string {
  const raw = `${normalizeToken(product.category)} ${normalizeToken(product.title)}`;
  const hasAny = (keywords: string[]): boolean => keywords.some((k) => raw.includes(k));

  if (hasAny(["t shirt", "tee", "shirt", "blouse", "top", "hoodie", "sweater", "cardigan", "tank", "camisole"])) return "tops";
  if (hasAny(["jean", "pants", "trouser", "short", "skirt", "legging", "jogger", "bottom"])) return "bottoms";
  if (hasAny(["dress", "abaya", "jumpsuit", "romper", "gown", "kaftan"])) return "one_piece";
  if (hasAny(["jacket", "coat", "blazer", "outerwear", "parka", "trench"])) return "outerwear";
  if (hasAny(["shoe", "sneaker", "heel", "boot", "loafer", "sandal", "slipper", "footwear"])) return "footwear";
  if (hasAny(["bag", "tote", "backpack", "clutch", "wallet", "purse"])) return "bags";
  if (hasAny(["ring", "necklace", "bracelet", "earring", "scarf", "belt", "hat", "cap", "accessory", "watch", "sunglass"])) return "accessories";
  if (hasAny(["perfume", "fragrance", "makeup", "lipstick", "mascara", "serum", "skincare", "beauty"])) return "beauty";

  return "other";
}

function inferSubtype(product: ProductForComparison): string {
  const raw = `${normalizeToken(product.category)} ${normalizeToken(product.title)}`;
  if (raw.includes("sneaker")) return "sneaker";
  if (raw.includes("heel")) return "heel";
  if (raw.includes("boot")) return "boot";
  if (raw.includes("loafer")) return "loafer";
  if (raw.includes("sandal")) return "sandal";
  if (raw.includes("shirt")) return "shirt";
  if (raw.includes("t shirt") || raw.includes("tee")) return "tee";
  if (raw.includes("blouse")) return "blouse";
  if (raw.includes("dress")) return "dress";
  if (raw.includes("jacket")) return "jacket";
  return "generic";
}

function resolveComparability(products: ProductForComparison[]): {
  isComparable: boolean;
  reason: string;
  categoryGroups: Record<number, string>;
} {
  const categoryGroups: Record<number, string> = {};
  for (const p of products) {
    categoryGroups[p.id] = inferCategoryGroup(p);
  }

  const uniqueGroups = new Set(Object.values(categoryGroups));
  if (uniqueGroups.size === 1) {
    const only = Array.from(uniqueGroups)[0] || "category";
    return {
      isComparable: true,
      reason: `All selected products are in the same comparison group (${only}).`,
      categoryGroups,
    };
  }

  return {
    isComparable: false,
    reason: "Selected products are from different item types, so a head-to-head winner is not meaningful.",
    categoryGroups,
  };
}

function computeShoppingInsights(
  comparisons: ProductComparison[],
  productsMap: Map<number, ProductForComparison>,
  directComparable: boolean
): CompareVerdict["shopping_insights"] {
  if (comparisons.length === 0) {
    return {
      best_quality_product_id: null,
      best_value_product_id: null,
      best_budget_product_id: null,
      weakest_link_product_id: null,
      notes: ["No products available for insight generation."],
      suggested_next_action: "Try again with at least 2 valid products.",
    };
  }

  const byScoreDesc = [...comparisons].sort((a, b) => b.overall_score - a.overall_score);
  const bestQuality = byScoreDesc[0] || null;
  const weakest = byScoreDesc[byScoreDesc.length - 1] || null;

  let bestBudget: ProductComparison | null = null;
  for (const c of comparisons) {
    if (!bestBudget) {
      bestBudget = c;
      continue;
    }
    const cPrice = productsMap.get(c.product_id)?.price_cents ?? Number.MAX_SAFE_INTEGER;
    const bPrice = productsMap.get(bestBudget.product_id)?.price_cents ?? Number.MAX_SAFE_INTEGER;
    if (cPrice < bPrice) bestBudget = c;
  }

  let bestValue: ProductComparison | null = null;
  let bestValueRatio = -1;
  for (const c of comparisons) {
    const p = productsMap.get(c.product_id);
    const price = p?.price_cents ?? 0;
    if (price <= 0) continue;
    const ratio = c.overall_score / (price / 100);
    if (ratio > bestValueRatio) {
      bestValueRatio = ratio;
      bestValue = c;
    }
  }

  const prices = comparisons
    .map((c) => productsMap.get(c.product_id)?.price_cents ?? 0)
    .filter((v) => v > 0)
    .sort((a, b) => a - b);

  const notes: string[] = [];
  if (directComparable) {
    if (bestQuality) notes.push(`Top quality signal: Product ${bestQuality.product_id}.`);
    if (bestValue) notes.push(`Best value-for-money balance: Product ${bestValue.product_id}.`);
  } else {
    notes.push("These products are different wardrobe roles; compare similar item types for a winner.");
    if (bestQuality) notes.push(`Highest confidence listing quality: Product ${bestQuality.product_id}.`);
  }

  if (bestBudget) notes.push(`Most budget-friendly pick: Product ${bestBudget.product_id}.`);
  if (weakest && weakest.overall_score < 45) {
    notes.push(`Weakest listing quality signal: Product ${weakest.product_id} (review details before buying).`);
  }

  if (prices.length >= 2) {
    const min = prices[0];
    const max = prices[prices.length - 1];
    if (min > 0) {
      const spreadPct = Math.round(((max - min) / min) * 100);
      if (spreadPct >= 35) {
        notes.push(`Price spread is wide (${spreadPct}%), so verify material and return policy before choosing.`);
      }
    }
  }

  return {
    best_quality_product_id: bestQuality?.product_id ?? null,
    best_value_product_id: bestValue?.product_id ?? null,
    best_budget_product_id: bestBudget?.product_id ?? null,
    weakest_link_product_id: weakest?.product_id ?? null,
    notes: notes.slice(0, 5),
    suggested_next_action: directComparable
      ? "Use the quality and value picks to make your final decision."
      : "To get a direct winner, compare products within the same item type (for example shirt vs shirt).",
  };
}

function getOccasionSignal(product: ProductForComparison, occasion: CompareOccasion | null): number {
  if (!occasion) return 60;
  const raw = `${normalizeToken(product.category)} ${normalizeToken(product.title)} ${normalizeToken(product.description)}`;
  const checkAny = (tokens: string[]): boolean => tokens.some((t) => raw.includes(t));
  const map: Record<CompareOccasion, string[]> = {
    casual: ["casual", "everyday", "daily", "relaxed", "street"],
    work: ["office", "work", "formal", "smart", "business", "blazer"],
    formal: ["formal", "evening", "gown", "ceremony", "tailored"],
    party: ["party", "night", "sequins", "sparkle", "club"],
    travel: ["travel", "comfortable", "lightweight", "easy care", "wrinkle"],
  };
  if (checkAny(map[occasion])) return 88;
  return 52;
}

function getStyleSignal(
  comparison: ProductComparison,
  product: ProductForComparison,
  allProducts: ProductForComparison[]
): number {
  let score = 45;
  if (comparison.signals.text_quality.signals.has_fit) score += 10;
  if (comparison.signals.text_quality.signals.has_fabric) score += 8;
  if (comparison.signals.text_quality.signals.has_care_instructions) score += 4;
  const baseColor = normalizeToken(product.color);
  if (baseColor) {
    const matches = allProducts.filter((p) => normalizeToken(p.color) === baseColor).length;
    if (matches >= 2) score += 12;
  }
  if (comparison.signals.image_signals.image_quality === "high") score += 8;
  return Math.max(0, Math.min(100, score));
}

function getRiskCard(comparison: ProductComparison): {
  risk_score: number;
  risk_level: "low" | "medium" | "high";
  reasons: string[];
} {
  const reasons: string[] = [];
  let risk = 0;
  if (!comparison.signals.return_policy_signals.has_policy) {
    risk += 22;
    reasons.push("Return policy missing");
  }
  if (comparison.signals.return_policy_signals.is_final_sale) {
    risk += 20;
    reasons.push("Final sale item");
  }
  if (comparison.signals.price_analysis.stability === "high_risk") {
    risk += 18;
    reasons.push("High price volatility");
  }
  if (comparison.signals.price_analysis.market_position === "suspicious_low") {
    risk += 16;
    reasons.push("Suspiciously low market price");
  }
  if (!comparison.signals.image_signals.has_image) {
    risk += 12;
    reasons.push("No product image");
  }
  if (!comparison.signals.text_quality.signals.has_fabric) {
    risk += 8;
    reasons.push("Material not disclosed");
  }
  const risk_score = Math.max(0, Math.min(100, risk));
  const risk_level: "low" | "medium" | "high" = risk_score >= 55 ? "high" : risk_score >= 30 ? "medium" : "low";
  return { risk_score, risk_level, reasons: reasons.slice(0, 3) };
}

function pickWinnerByScore(
  comparisons: ProductComparison[],
  scorer: (comparison: ProductComparison) => number
): number | null {
  if (comparisons.length === 0) return null;
  let winner = comparisons[0];
  let best = scorer(winner);
  for (const c of comparisons.slice(1)) {
    const s = scorer(c);
    if (s > best) {
      best = s;
      winner = c;
    }
  }
  return winner.product_id;
}

function determineScenarioMode(foundProducts: ProductForComparison[], categoryGroups: Record<number, string>): "direct_head_to_head" | "scenario_compare" {
  const groups = Object.values(categoryGroups);
  if (groups.length === 0) return "direct_head_to_head";
  if (!groups.every((g) => g === groups[0])) return "direct_head_to_head";
  const subtypes = new Set(foundProducts.map((p) => inferSubtype(p)).filter((s) => s !== "generic"));
  return subtypes.size >= 2 ? "scenario_compare" : "direct_head_to_head";
}

function buildTimingInsight(bestRiskCard: { risk_level: "low" | "medium" | "high"; reasons: string[] }): CompareVerdict["timing_insight"] {
  if (bestRiskCard.risk_level === "high") {
    return {
      recommendation: "wait",
      reason: "High purchase risk signals detected. Wait for clearer policy and pricing stability.",
    };
  }
  if (bestRiskCard.risk_level === "medium") {
    return {
      recommendation: "monitor",
      reason: "Some risk signals exist. Monitor price and listing updates before checkout.",
    };
  }
  return {
    recommendation: "buy_now",
    reason: "Low risk and stable signals suggest this is a good time to buy.",
  };
}

// ============================================================================
// Signal Analysis
// ============================================================================

/**
 * Analyze image originality using LSH (fast O(1) lookup)
 * Replaced O(N) full table scan with LSH bucket index lookup
 */
async function analyzeImageSignals(
  productId: number,
  pHash: string | null
): Promise<ComparisonSignals["image_signals"]> {
  // Use the new LSH-based fast analysis
  return analyzeImageSignalsFast(productId, pHash);
}

/**
 * Analyze return policy text
 */
function analyzeReturnPolicy(
  description: string | null,
  returnPolicy: string | null
): ComparisonSignals["return_policy_signals"] {
  const text = [description, returnPolicy].filter(Boolean).join(" ").toLowerCase();
  
  // Check for policy existence
  const hasPolicyKeywords = /return|refund|exchange|استرجاع|استبدال|ارجاع/i.test(text);
  
  // Check if returns allowed
  const noReturnsPatterns = [
    /no return/i, /final sale/i, /non-?returnable/i, /all sales final/i,
    /لا يسترجع/i, /لا يستبدل/i, /بدون استبدال/i
  ];
  const isFinalSale = noReturnsPatterns.some(p => p.test(text));
  
  // Try to extract return window
  let returnDays: number | undefined;
  const dayMatch = text.match(/(\d+)\s*days?\s*(return|to return|for return)/i) ||
                   text.match(/return\s*within\s*(\d+)/i) ||
                   text.match(/(\d+)\s*يوم/);
  if (dayMatch) {
    returnDays = parseInt(dayMatch[1], 10);
  }
  
  return {
    has_policy: hasPolicyKeywords,
    allows_returns: hasPolicyKeywords && !isFinalSale,
    return_window_days: returnDays,
    is_final_sale: isFinalSale,
  };
}

// ============================================================================
// Scoring
// ============================================================================

/**
 * Convert quality analysis to score (0-100)
 */
function textToScore(quality: QualityAnalysis): number {
  return quality.quality_score;
}

/**
 * Convert price analysis to score (0-100, higher = better/safer)
 */
function priceToScore(price: PriceAnalysis): number {
  // Invert risk score (low risk = high score)
  return 100 - price.risk_score;
}

/**
 * Convert image signals to score (0-100)
 */
function imageToScore(signals: ComparisonSignals["image_signals"]): number {
  if (!signals.has_image) return 40; // No image = low score
  
  let score = 60; // Base score for having image
  
  if (signals.is_original) score += 25;
  else if (signals.similar_image_count <= 3) score += 10;
  else score -= 10;
  
  if (signals.image_quality === "high") score += 15;
  else if (signals.image_quality === "medium") score += 5;
  
  return Math.min(100, Math.max(0, score));
}

/**
 * Convert return policy signals to score (0-100)
 */
function policyToScore(signals: ComparisonSignals["return_policy_signals"]): number {
  if (!signals.has_policy) return 40;
  
  let score = 60;
  
  if (signals.allows_returns) score += 20;
  if (signals.return_window_days && signals.return_window_days >= 14) score += 15;
  else if (signals.return_window_days && signals.return_window_days >= 7) score += 10;
  
  if (signals.is_final_sale) score -= 20;
  
  return Math.min(100, Math.max(0, score));
}

/**
 * Calculate overall score with weights
 */
function calculateOverallScore(
  textScore: number,
  priceScore: number,
  imageScore: number,
  policyScore: number
): number {
  // Weights (sum to 1) — balanced for shopping decisions: value + trust, not only copy length
  const weights = {
    text: 0.28,
    price: 0.32,
    image: 0.22,
    policy: 0.18,
  };
  
  const weighted = 
    textScore * weights.text +
    priceScore * weights.price +
    imageScore * weights.image +
    policyScore * weights.policy;
  
  return Math.round(weighted);
}

// ============================================================================
// Verdict Generation
// ============================================================================

/**
 * Determine top reasons for winner
 */
function determineReasons(
  winner: ProductComparison,
  loser: ProductComparison
): CompareReason[] {
  const reasons: CompareReason[] = [];
  
  // Text quality reasons
  if (winner.text_score - loser.text_score >= 15) {
    reasons.push("better_description_quality");
  }
  if (winner.signals.text_quality.signals.has_fabric && 
      winner.signals.text_quality.attributes.fabric_quality_tier === "premium") {
    reasons.push("premium_fabric");
  }
  if (winner.signals.text_quality.signals.has_size_info && 
      winner.signals.text_quality.signals.has_measurements &&
      !loser.signals.text_quality.signals.has_measurements) {
    reasons.push("detailed_sizing");
  }
  if (winner.signals.text_quality.signals.has_care_instructions &&
      !loser.signals.text_quality.signals.has_care_instructions) {
    reasons.push("care_instructions");
  }
  
  // Price reasons
  if (winner.price_score - loser.price_score >= 20) {
    reasons.push("stable_pricing");
    reasons.push("lower_price_risk");
  }
  
  // Image reasons
  if (winner.signals.image_signals.is_original && !loser.signals.image_signals.is_original) {
    reasons.push("original_images");
  }
  
  // Policy reasons
  if (winner.signals.return_policy_signals.allows_returns &&
      !loser.signals.return_policy_signals.allows_returns) {
    reasons.push("clear_return_policy");
  }
  
  // Limit to top 4 reasons
  return reasons.slice(0, 4);
}

/**
 * Generate tradeoff explanation
 */
function generateTradeoff(
  winner: ProductComparison,
  loser: ProductComparison,
  loserPriceCents: number,
  winnerPriceCents: number
): string | null {
  const tradeoffs: string[] = [];
  
  // Price tradeoff
  if (loserPriceCents < winnerPriceCents * 0.85) {
    const priceDiff = Math.round((1 - loserPriceCents / winnerPriceCents) * 100);
    
    if (loser.signals.price_analysis.risk_level !== "green") {
      tradeoffs.push(`The other option is ${priceDiff}% cheaper but shows ${
        loser.signals.price_analysis.stability === "high_risk" ? "price volatility" : "some price concerns"
      }`);
    } else if (loser.text_score < winner.text_score - 10) {
      tradeoffs.push(`The other option is ${priceDiff}% cheaper but has limited details`);
    }
  }
  
  // Quality tradeoff
  if (loser.signals.text_quality.attributes.fabric_quality_tier === "premium" &&
      winner.signals.text_quality.attributes.fabric_quality_tier !== "premium") {
    tradeoffs.push("The other option mentions premium fabric");
  }
  
  // Return policy tradeoff
  if (loser.signals.return_policy_signals.allows_returns &&
      !winner.signals.return_policy_signals.allows_returns) {
    tradeoffs.push("The other option has a return policy");
  }
  
  return tradeoffs.length > 0 ? tradeoffs.join(". ") + "." : null;
}

// ============================================================================
// Main Compare Function
// ============================================================================

/**
 * products.id is BIGSERIAL; node-pg often returns BIGINT as string (or bigint).
 * Validated request IDs are numbers — Map keys must match.
 */
function coerceDbProductId(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "bigint") return Number(raw);
  const n = parseInt(String(raw), 10);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid product id from database: ${String(raw)}`);
  }
  return n;
}

/**
 * Compare two or more products
 */
export async function compareProducts(productIds: number[], options: CompareRequestOptions = {}): Promise<CompareVerdict> {
  if (productIds.length < 2) {
    throw new Error("At least 2 products required for comparison");
  }

  const result = await pg.query(
    `SELECT p.id, p.title, p.brand, p.category, p.description,
            p.color, p.gender,
            p.price_cents, p.currency, p.sales_price_cents,
            p.image_cdn, p.return_policy, pi.p_hash
     FROM products p
     LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_primary = true
     WHERE p.id = ANY($1)`,
    [productIds]
  );

  const productsMap = new Map<number, ProductForComparison>();
  for (const row of result.rows) {
    const id = coerceDbProductId(row.id);
    productsMap.set(id, { ...row, id });
  }

  const comparisons: ProductComparison[] = [];
  for (const productId of productIds) {
    const product = productsMap.get(productId);
    if (!product) continue;

    const textQuality = analyzeTextQuality(product.title, product.description, product.return_policy);
    const priceAnalysis = await analyzePriceAnomalies(productId);
    const imageSignals = await analyzeImageSignals(productId, product.p_hash || null);
    const policySignals = analyzeReturnPolicy(product.description || null, product.return_policy || null);

    const textScore = textToScore(textQuality);
    const priceScore = priceToScore(priceAnalysis);
    const imageScore = imageToScore(imageSignals);
    const policyScore = policyToScore(policySignals);
    const overallScore = calculateOverallScore(textScore, priceScore, imageScore, policyScore);

    let overallLevel: "green" | "yellow" | "red";
    if (overallScore >= 70) overallLevel = "green";
    else if (overallScore >= 45) overallLevel = "yellow";
    else overallLevel = "red";

    comparisons.push({
      product_id: productId,
      signals: {
        text_quality: textQuality,
        price_analysis: priceAnalysis,
        image_signals: imageSignals,
        return_policy_signals: policySignals,
      },
      overall_score: overallScore,
      overall_level: overallLevel,
      text_score: textScore,
      price_score: priceScore,
      image_score: imageScore,
      policy_score: policyScore,
    });
  }

  const foundIds = comparisons.map((c) => c.product_id);
  if (comparisons.length < 2) {
    throw new InsufficientProductsForCompareError(productIds, foundIds);
  }

  const foundProducts = productIds
    .map((id) => productsMap.get(id))
    .filter((p): p is ProductForComparison => Boolean(p));
  const comparability = resolveComparability(foundProducts);
  const shoppingInsights = computeShoppingInsights(comparisons, productsMap, comparability.isComparable);
  const compareMode: CompareVerdict["comparison_mode"] = comparability.isComparable
    ? determineScenarioMode(foundProducts, comparability.categoryGroups)
    : "outfit_compare";

  const productById = new Map<number, ProductForComparison>();
  for (const p of foundProducts) productById.set(p.id, p);

  const riskCards: Record<number, { risk_score: number; risk_level: "low" | "medium" | "high"; reasons: string[] }> = {};
  for (const c of comparisons) {
    riskCards[c.product_id] = getRiskCard(c);
  }

  const requestedGoal: CompareGoal = options.goal || "best_value";
  const requestedOccasion: CompareOccasion | null = options.occasion || null;

  const winnerByValue = pickWinnerByScore(comparisons, (c) => 0.45 * c.price_score + 0.2 * c.policy_score + 0.2 * c.image_score + 0.15 * c.text_score);
  const winnerByQuality = pickWinnerByScore(comparisons, (c) => 0.45 * c.text_score + 0.25 * c.image_score + 0.2 * c.policy_score + 0.1 * c.price_score);
  const winnerByStyle = pickWinnerByScore(comparisons, (c) => {
    const p = productById.get(c.product_id);
    if (!p) return c.overall_score;
    return getStyleSignal(c, p, foundProducts);
  });
  const winnerByRisk = pickWinnerByScore(comparisons, (c) => 100 - riskCards[c.product_id].risk_score);
  const winnerByOccasion = pickWinnerByScore(comparisons, (c) => {
    const p = productById.get(c.product_id);
    if (!p) return c.overall_score;
    return 0.7 * c.overall_score + 0.3 * getOccasionSignal(p, requestedOccasion);
  });

  const goalWinnerMap: Record<CompareGoal, number | null> = {
    best_value: winnerByValue,
    premium_quality: winnerByQuality,
    style_match: winnerByStyle,
    low_risk_return: winnerByRisk,
    occasion_fit: winnerByOccasion,
  };

  if (!comparability.isComparable) {
    const versatilityScores: Record<number, number> = {};
    const gapFillScores: Record<number, number> = {};
    const groupCounts: Record<string, number> = {};
    for (const p of foundProducts) {
      const g = comparability.categoryGroups[p.id] || "other";
      groupCounts[g] = (groupCounts[g] || 0) + 1;
    }
    for (const c of comparisons) {
      const p = productById.get(c.product_id);
      const group = p ? comparability.categoryGroups[p.id] : "other";
      const rarityBoost = Math.max(0, 20 - ((groupCounts[group] || 1) - 1) * 6);
      const versatility = Math.max(0, Math.min(100, Math.round(0.65 * c.overall_score + rarityBoost)));
      const gapFill = Math.max(0, Math.min(100, Math.round(50 + rarityBoost + (group === "footwear" || group === "outerwear" ? 8 : 0))));
      versatilityScores[c.product_id] = versatility;
      gapFillScores[c.product_id] = gapFill;
    }
    const outfitWinner = pickWinnerByScore(comparisons, (c) => 0.6 * (versatilityScores[c.product_id] || 0) + 0.4 * (gapFillScores[c.product_id] || 0));
    const overallRiskScore = Math.round(Object.values(riskCards).reduce((acc, v) => acc + v.risk_score, 0) / Math.max(1, Object.keys(riskCards).length));
    const overallRiskLevel: "low" | "medium" | "high" = overallRiskScore >= 55 ? "high" : overallRiskScore >= 30 ? "medium" : "low";

    return {
      winner_product_id: null,
      confidence: "tie",
      comparison_mode: compareMode,
      requested_goal: requestedGoal,
      requested_occasion: requestedOccasion,
      compatibility: {
        is_comparable: false,
        reason: comparability.reason,
        category_groups: comparability.categoryGroups,
      },
      shopping_insights: shoppingInsights,
      winners_by_goal: {
        overall: null,
        value: winnerByValue,
        quality: winnerByQuality,
        style: winnerByStyle,
        risk: winnerByRisk,
        occasion: winnerByOccasion,
      },
      evidence: [
        "Cross-category selection detected: switched to outfit impact mode.",
        "Use value/quality/risk winners for role-specific decisions.",
      ],
      alternatives: {
        better_cheaper_product_id: winnerByValue,
        better_quality_product_id: winnerByQuality,
        similar_style_safer_product_id: winnerByRisk,
      },
      risk_summary: {
        overall_risk_level: overallRiskLevel,
        product_risks: riskCards,
      },
      timing_insight: buildTimingInsight(riskCards[outfitWinner || winnerByRisk || comparisons[0].product_id]),
      outfit_impact: {
        mode: "outfit_compare",
        outfit_winner_product_id: outfitWinner,
        versatility_scores: versatilityScores,
        gap_fill_scores: gapFillScores,
      },
      top_reasons: [],
      tradeoff_reason: "Head-to-head comparison skipped because products are from different categories.",
      score_difference: 0,
      products: comparisons,
    };
  }

  comparisons.sort((a, b) => b.overall_score - a.overall_score);
  const [first, second] = comparisons;
  const scoreDiff = first.overall_score - second.overall_score;

  const selectedWinner = goalWinnerMap[requestedGoal] ?? first.product_id;
  const selectedLeader = comparisons.find((c) => c.product_id === selectedWinner) || first;
  const selectedSecond = comparisons.find((c) => c.product_id !== selectedLeader.product_id) || second;
  const selectedDiff = selectedLeader.overall_score - selectedSecond.overall_score;

  let winnerId: number | null;
  let confidence: CompareVerdict["confidence"];
  if (selectedDiff >= 20) {
    winnerId = selectedLeader.product_id;
    confidence = "high";
  } else if (selectedDiff >= 10) {
    winnerId = selectedLeader.product_id;
    confidence = "medium";
  } else if (selectedDiff >= 5) {
    winnerId = selectedLeader.product_id;
    confidence = "low";
  } else {
    winnerId = null;
    confidence = "tie";
  }

  const topReasons = winnerId ? determineReasons(selectedLeader, selectedSecond) : [];
  const winnerProduct = productsMap.get(selectedLeader.product_id)!;
  const loserProduct = productsMap.get(selectedSecond.product_id)!;
  const tradeoff = winnerId
    ? generateTradeoff(selectedLeader, selectedSecond, loserProduct.price_cents, winnerProduct.price_cents)
    : null;

  const valueWinnerComp = comparisons.find((c) => c.product_id === winnerByValue) || null;
  const qualityWinnerComp = comparisons.find((c) => c.product_id === winnerByQuality) || null;
  const styleWinnerComp = comparisons.find((c) => c.product_id === winnerByStyle) || null;
  const selectedRiskCard = riskCards[selectedLeader.product_id];

  const evidence: string[] = [];
  if (valueWinnerComp && qualityWinnerComp) {
    evidence.push(`Value delta vs quality pick: ${valueWinnerComp.overall_score - qualityWinnerComp.overall_score} score points.`);
  }
  if (winnerId) {
    evidence.push(`Selected winner has ${selectedLeader.policy_score - selectedSecond.policy_score} points policy advantage.`);
    evidence.push(`Selected winner has ${selectedLeader.price_score - selectedSecond.price_score} points price safety advantage.`);
  }
  if (styleWinnerComp && winnerId && styleWinnerComp.product_id !== winnerId) {
    evidence.push("Style winner differs from requested goal winner, indicating a tradeoff between aesthetics and safety/value.");
  }

  let betterCheaper: number | null = null;
  const betterQuality: number | null = winnerByQuality;
  let similarStyleSafer: number | null = null;
  const winnerPrice = winnerProduct.price_cents;
  for (const c of comparisons) {
    const p = productById.get(c.product_id);
    if (!p) continue;
    if (c.product_id !== (winnerId || selectedLeader.product_id) && p.price_cents < winnerPrice && c.overall_score >= selectedLeader.overall_score - 8) {
      betterCheaper = c.product_id;
      break;
    }
  }
  if (styleWinnerComp) {
    const styleRisk = riskCards[styleWinnerComp.product_id];
    if (styleRisk && styleRisk.risk_score < selectedRiskCard.risk_score) {
      similarStyleSafer = styleWinnerComp.product_id;
    }
  }

  const overallRiskScore = Math.round(Object.values(riskCards).reduce((acc, v) => acc + v.risk_score, 0) / Math.max(1, Object.keys(riskCards).length));
  const overallRiskLevel: "low" | "medium" | "high" = overallRiskScore >= 55 ? "high" : overallRiskScore >= 30 ? "medium" : "low";

  return {
    winner_product_id: winnerId,
    confidence,
    comparison_mode: compareMode,
    requested_goal: requestedGoal,
    requested_occasion: requestedOccasion,
    compatibility: {
      is_comparable: true,
      reason: comparability.reason,
      category_groups: comparability.categoryGroups,
    },
    shopping_insights: shoppingInsights,
    winners_by_goal: {
      overall: winnerId,
      value: winnerByValue,
      quality: winnerByQuality,
      style: winnerByStyle,
      risk: winnerByRisk,
      occasion: winnerByOccasion,
    },
    evidence: evidence.slice(0, 5),
    alternatives: {
      better_cheaper_product_id: betterCheaper,
      better_quality_product_id: betterQuality,
      similar_style_safer_product_id: similarStyleSafer,
    },
    risk_summary: {
      overall_risk_level: overallRiskLevel,
      product_risks: riskCards,
    },
    timing_insight: buildTimingInsight(selectedRiskCard),
    top_reasons: topReasons,
    tradeoff_reason: tradeoff,
    score_difference: scoreDiff,
    products: comparisons,
  };
}

/**
 * Get comparison summary for a single product
 */
export async function getProductQualitySignals(productId: number): Promise<ProductComparison> {
  const result = await compareProducts([productId, productId]);
  return result.products[0];
}

// ============================================================================
// Export helpers
// ============================================================================

export { getQualityReasons, getPriceReasons };
