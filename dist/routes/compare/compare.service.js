"use strict";
/**
 * Compare Service
 *
 * Business logic for product comparison feature.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.compareProductsWithVerdict = compareProductsWithVerdict;
exports.getProductQuality = getProductQuality;
exports.analyzeText = analyzeText;
exports.getPriceAnalysis = getPriceAnalysis;
exports.getBaseline = getBaseline;
exports.computeBaselines = computeBaselines;
exports.getAllTooltips = getAllTooltips;
exports.validateCompareInput = validateCompareInput;
exports.validateProductId = validateProductId;
exports.validateTextInput = validateTextInput;
const compareEngine_js_1 = require("../../lib/compare/compareEngine.js");
const verdictGenerator_js_1 = require("../../lib/compare/verdictGenerator.js");
const textQualityAnalyzer_js_1 = require("../../lib/compare/textQualityAnalyzer.js");
const priceAnomalyDetector_js_1 = require("../../lib/compare/priceAnomalyDetector.js");
// ============================================================================
// Service Functions
// ============================================================================
/**
 * Compare 2-5 products and generate a verdict
 */
async function compareProductsWithVerdict(productIds) {
    // Run comparison
    const comparison = await (0, compareEngine_js_1.compareProducts)(productIds);
    // Generate verdict with letters
    const letterMap = new Map();
    const letters = ["A", "B", "C", "D", "E"];
    productIds.forEach((id, i) => letterMap.set(id, letters[i]));
    const fullVerdict = (0, verdictGenerator_js_1.generateVerdict)(comparison, letterMap);
    return {
        ...fullVerdict,
        product_map: Object.fromEntries(letterMap),
    };
}
/**
 * Get quality signals for a single product
 */
async function getProductQuality(productId) {
    const signals = await (0, compareEngine_js_1.getProductQualitySignals)(productId);
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
function analyzeText(title, description, returnPolicy) {
    return (0, textQualityAnalyzer_js_1.analyzeTextQuality)(title, description, returnPolicy);
}
/**
 * Get price anomaly analysis for a product
 */
async function getPriceAnalysis(productId) {
    return (0, priceAnomalyDetector_js_1.analyzePriceAnomalies)(productId);
}
/**
 * Get price baseline for a category
 */
async function getBaseline(category) {
    return (0, priceAnomalyDetector_js_1.getCategoryBaseline)(category);
}
/**
 * Trigger category baseline computation
 */
async function computeBaselines() {
    return (0, priceAnomalyDetector_js_1.computeAllCategoryBaselines)();
}
/**
 * Get all reason tooltips for UI
 */
function getAllTooltips() {
    const reasons = [
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
    const tooltips = {};
    for (const reason of reasons) {
        tooltips[reason] = (0, verdictGenerator_js_1.getReasonTooltip)(reason);
    }
    return tooltips;
}
/**
 * Validate product IDs for comparison
 */
function validateCompareInput(productIds) {
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
function validateProductId(id) {
    const productId = parseInt(id, 10);
    if (isNaN(productId) || productId <= 0) {
        return null;
    }
    return productId;
}
/**
 * Validate text analysis input
 */
function validateTextInput(title) {
    if (!title || typeof title !== "string") {
        return { error: "Title is required" };
    }
    return null;
}
