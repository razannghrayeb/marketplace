"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOutfitRecommendations = getOutfitRecommendations;
exports.getOutfitRecommendationsFromProduct = getOutfitRecommendationsFromProduct;
exports.getProductStyleProfile = getProductStyleProfile;
exports.analyzeProductStyle = analyzeProductStyle;
/**
 * Outfit Service
 *
 * Business logic for "Complete My Style" outfit recommendations.
 */
const index_js_1 = require("../../lib/outfit/index.js");
const index_js_2 = require("../../lib/core/index.js");
// ============================================================================
// Service Functions
// ============================================================================
/**
 * Get outfit completion recommendations for a product by ID
 */
async function getOutfitRecommendations(productId, options = {}) {
    const result = await (0, index_js_1.completeOutfitFromProductId)(productId, {
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
async function getOutfitRecommendationsFromProduct(product, options = {}) {
    const result = await (0, index_js_1.completeMyStyle)(product, {
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
async function getProductStyleProfile(productId) {
    const result = await index_js_2.pg.query(`
    SELECT id, title, brand, category, color, price_cents, currency, 
           image_url, image_cdn, description
    FROM products 
    WHERE id = $1
  `, [productId]);
    if (result.rows.length === 0) {
        return null;
    }
    const product = result.rows[0];
    const category = (0, index_js_1.detectCategory)(product.title, product.description);
    const styleProfile = (0, index_js_1.buildStyleProfile)(product);
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
function analyzeProductStyle(product) {
    const category = (0, index_js_1.detectCategory)(product.title, product.description);
    const style = (0, index_js_1.buildStyleProfile)(product);
    return { category, style };
}
// ============================================================================
// Helper Functions
// ============================================================================
/**
 * Format OutfitCompletion to API response format
 */
function formatOutfitCompletion(result) {
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
function getFormalityLabel(formality) {
    if (formality <= 2)
        return "Very Casual";
    if (formality <= 4)
        return "Casual";
    if (formality <= 6)
        return "Smart Casual";
    if (formality <= 8)
        return "Semi-Formal";
    return "Formal";
}
/**
 * Get human-readable priority label
 */
function getPriorityLabel(priority) {
    switch (priority) {
        case 1: return "Essential";
        case 2: return "Recommended";
        default: return "Optional";
    }
}
