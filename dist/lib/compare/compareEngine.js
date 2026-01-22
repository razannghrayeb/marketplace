"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPriceReasons = exports.getQualityReasons = void 0;
exports.compareProducts = compareProducts;
exports.getProductQualitySignals = getProductQualitySignals;
const core_1 = require("../core");
const textQualityAnalyzer_1 = require("./textQualityAnalyzer");
Object.defineProperty(exports, "getQualityReasons", { enumerable: true, get: function () { return textQualityAnalyzer_1.getQualityReasons; } });
const priceAnomalyDetector_1 = require("./priceAnomalyDetector");
Object.defineProperty(exports, "getPriceReasons", { enumerable: true, get: function () { return priceAnomalyDetector_1.getPriceReasons; } });
const canonical_1 = require("../products/canonical");
// ============================================================================
// Signal Analysis
// ============================================================================
/**
 * Analyze image originality using pHash
 */
async function analyzeImageSignals(productId, pHash) {
    if (!pHash) {
        return {
            has_image: false,
            is_original: true,
            similar_image_count: 0,
            image_quality: "unknown",
        };
    }
    // Find similar images in database
    const result = await core_1.pg.query(`SELECT p_hash FROM product_images 
     WHERE p_hash IS NOT NULL AND product_id != $1`, [productId]);
    let similarCount = 0;
    for (const row of result.rows) {
        const distance = (0, canonical_1.hammingDistance)(pHash, row.p_hash);
        if (distance <= 10) { // Very similar (< 16% different)
            similarCount++;
        }
    }
    return {
        has_image: true,
        is_original: similarCount === 0,
        similar_image_count: similarCount,
        image_quality: similarCount > 5 ? "low" : similarCount > 0 ? "medium" : "high",
    };
}
/**
 * Analyze return policy text
 */
function analyzeReturnPolicy(description, returnPolicy) {
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
    let returnDays;
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
function textToScore(quality) {
    return quality.quality_score;
}
/**
 * Convert price analysis to score (0-100, higher = better/safer)
 */
function priceToScore(price) {
    // Invert risk score (low risk = high score)
    return 100 - price.risk_score;
}
/**
 * Convert image signals to score (0-100)
 */
function imageToScore(signals) {
    if (!signals.has_image)
        return 40; // No image = low score
    let score = 60; // Base score for having image
    if (signals.is_original)
        score += 25;
    else if (signals.similar_image_count <= 3)
        score += 10;
    else
        score -= 10;
    if (signals.image_quality === "high")
        score += 15;
    else if (signals.image_quality === "medium")
        score += 5;
    return Math.min(100, Math.max(0, score));
}
/**
 * Convert return policy signals to score (0-100)
 */
function policyToScore(signals) {
    if (!signals.has_policy)
        return 40;
    let score = 60;
    if (signals.allows_returns)
        score += 20;
    if (signals.return_window_days && signals.return_window_days >= 14)
        score += 15;
    else if (signals.return_window_days && signals.return_window_days >= 7)
        score += 10;
    if (signals.is_final_sale)
        score -= 20;
    return Math.min(100, Math.max(0, score));
}
/**
 * Calculate overall score with weights
 */
function calculateOverallScore(textScore, priceScore, imageScore, policyScore) {
    // Weights (should sum to 1)
    const weights = {
        text: 0.35, // Description quality most important
        price: 0.30, // Price stability/risk
        image: 0.20, // Image originality
        policy: 0.15, // Return policy
    };
    const weighted = textScore * weights.text +
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
function determineReasons(winner, loser) {
    const reasons = [];
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
function generateTradeoff(winner, loser, loserPriceCents, winnerPriceCents) {
    const tradeoffs = [];
    // Price tradeoff
    if (loserPriceCents < winnerPriceCents * 0.85) {
        const priceDiff = Math.round((1 - loserPriceCents / winnerPriceCents) * 100);
        if (loser.signals.price_analysis.risk_level !== "green") {
            tradeoffs.push(`The other option is ${priceDiff}% cheaper but shows ${loser.signals.price_analysis.stability === "high_risk" ? "price volatility" : "some price concerns"}`);
        }
        else if (loser.text_score < winner.text_score - 10) {
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
async function compareProducts(productIds) {
    if (productIds.length < 2) {
        throw new Error("At least 2 products required for comparison");
    }
    // Fetch product data
    const result = await core_1.pg.query(`SELECT p.id, p.title, p.brand, p.category, p.description, 
            p.price_cents, p.currency, p.sales_price_cents,
            p.image_cdn, pi.p_hash
     FROM products p
     LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_primary = true
     WHERE p.id = ANY($1)`, [productIds]);
    const productsMap = new Map();
    for (const row of result.rows) {
        productsMap.set(row.id, row);
    }
    // Analyze each product
    const comparisons = [];
    for (const productId of productIds) {
        const product = productsMap.get(productId);
        if (!product)
            continue;
        // Text quality analysis
        const textQuality = (0, textQualityAnalyzer_1.analyzeTextQuality)(product.title, product.description, product.return_policy);
        // Price analysis
        const priceAnalysis = await (0, priceAnomalyDetector_1.analyzePriceAnomalies)(productId);
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
        let overallLevel;
        if (overallScore >= 70)
            overallLevel = "green";
        else if (overallScore >= 45)
            overallLevel = "yellow";
        else
            overallLevel = "red";
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
    let winnerId;
    let confidence;
    if (scoreDiff >= 20) {
        winnerId = first.product_id;
        confidence = "high";
    }
    else if (scoreDiff >= 10) {
        winnerId = first.product_id;
        confidence = "medium";
    }
    else if (scoreDiff >= 5) {
        winnerId = first.product_id;
        confidence = "low";
    }
    else {
        winnerId = null;
        confidence = "tie";
    }
    // Determine reasons
    const topReasons = winnerId
        ? determineReasons(first, second)
        : [];
    // Generate tradeoff
    const winnerProduct = productsMap.get(first.product_id);
    const loserProduct = productsMap.get(second.product_id);
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
async function getProductQualitySignals(productId) {
    const result = await compareProducts([productId, productId]);
    return result.products[0];
}
