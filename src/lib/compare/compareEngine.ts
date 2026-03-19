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

export interface CompareVerdict {
  winner_product_id: number | null;  // null = tie
  confidence: "high" | "medium" | "low" | "tie";
  
  // Top reasons the winner was chosen
  top_reasons: CompareReason[];
  
  // Tradeoff explanation
  tradeoff_reason: string | null;
  
  // Score difference
  score_difference: number;
  
  // Individual product comparisons
  products: ProductComparison[];
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
  // Weights (should sum to 1)
  const weights = {
    text: 0.35,    // Description quality most important
    price: 0.30,   // Price stability/risk
    image: 0.20,   // Image originality
    policy: 0.15,  // Return policy
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
 * Compare two or more products
 */
export async function compareProducts(productIds: number[]): Promise<CompareVerdict> {
  if (productIds.length < 2) {
    throw new Error("At least 2 products required for comparison");
  }
  
  // Fetch product data
  const result = await pg.query(
    `SELECT p.id, p.title, p.brand, p.category, p.description, 
            p.price_cents, p.currency, p.sales_price_cents,
            p.image_cdn, pi.p_hash
     FROM products p
     LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_primary = true
     WHERE p.id = ANY($1)`,
    [productIds]
  );
  
  const productsMap = new Map<number, ProductForComparison>();
  for (const row of result.rows) {
    productsMap.set(row.id, row);
  }
  
  // Analyze each product
  const comparisons: ProductComparison[] = [];
  
  for (const productId of productIds) {
    const product = productsMap.get(productId);
    if (!product) continue;
    
    // Text quality analysis
    const textQuality = analyzeTextQuality(
      product.title,
      product.description,
      product.return_policy
    );
    
    // Price analysis
    const priceAnalysis = await analyzePriceAnomalies(productId);
    
    // Image analysis
    const imageSignals = await analyzeImageSignals(productId, product.p_hash || null);
    
    // Return policy analysis
    const policySignals = analyzeReturnPolicy(product.description || null, product.return_policy || null);
    
    // Calculate scores
    const textScore = textToScore(textQuality);
    const priceScore = priceToScore(priceAnalysis);
    const imageScore = imageToScore(imageSignals);
    const policyScore = policyToScore(policySignals);
    const overallScore = calculateOverallScore(textScore, priceScore, imageScore, policyScore);
    
    // Determine level
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
  
  // Sort by overall score (highest first)
  comparisons.sort((a, b) => b.overall_score - a.overall_score);
  
  // Determine winner and confidence
  const [first, second] = comparisons;
  const scoreDiff = first.overall_score - second.overall_score;
  
  let winnerId: number | null;
  let confidence: CompareVerdict["confidence"];
  
  if (scoreDiff >= 20) {
    winnerId = first.product_id;
    confidence = "high";
  } else if (scoreDiff >= 10) {
    winnerId = first.product_id;
    confidence = "medium";
  } else if (scoreDiff >= 5) {
    winnerId = first.product_id;
    confidence = "low";
  } else {
    winnerId = null;
    confidence = "tie";
  }
  
  // Determine reasons
  const topReasons = winnerId 
    ? determineReasons(first, second)
    : [];
  
  // Generate tradeoff
  const winnerProduct = productsMap.get(first.product_id)!;
  const loserProduct = productsMap.get(second.product_id)!;
  const tradeoff = winnerId
    ? generateTradeoff(first, second, loserProduct.price_cents, winnerProduct.price_cents)
    : null;
  
  return {
    winner_product_id: winnerId,
    confidence,
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
