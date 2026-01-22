"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.completeStyle = completeStyle;
exports.completeStyleFromBody = completeStyleFromBody;
exports.getStyleProfile = getStyleProfile;
const outfit_service_js_1 = require("./outfit.service.js");
// ============================================================================
// Request Helpers
// ============================================================================
function parseCompleteStyleOptions(query) {
    const options = {
        maxPerCategory: Math.min(parseInt(query.maxPerCategory) || 5, 20),
        maxTotal: Math.min(parseInt(query.maxTotal) || 20, 50),
        preferSameBrand: query.preferSameBrand === "true",
        disablePriceFilter: query.disablePriceFilter === "true",
    };
    // Price range (explicit range overrides default 0.5x-2.5x filter)
    if (query.minPrice || query.maxPrice) {
        options.priceRange = {};
        if (query.minPrice)
            options.priceRange.min = parseInt(query.minPrice);
        if (query.maxPrice)
            options.priceRange.max = parseInt(query.maxPrice);
    }
    // Exclude brands
    if (query.excludeBrands) {
        options.excludeBrands = String(query.excludeBrands).split(",").map(b => b.trim());
    }
    return options;
}
// ============================================================================
// Controllers
// ============================================================================
/**
 * GET /products/:id/complete-style
 *
 * Get outfit completion recommendations for a product
 *
 * Query params:
 * - maxPerCategory: Max products per category (default: 5)
 * - maxTotal: Max total recommendations (default: 20)
 * - minPrice: Minimum price in cents
 * - maxPrice: Maximum price in cents
 * - preferSameBrand: If true, prefer same brand (default: false)
 * - excludeBrands: Comma-separated brands to exclude
 */
async function completeStyle(req, res) {
    try {
        const productId = parseInt(req.params.id, 10);
        if (isNaN(productId)) {
            return res.status(400).json({ error: "Invalid product ID" });
        }
        const options = parseCompleteStyleOptions(req.query);
        const result = await (0, outfit_service_js_1.getOutfitRecommendations)(productId, options);
        if (!result) {
            return res.status(404).json({ error: "Product not found" });
        }
        return res.json({ success: true, data: result });
    }
    catch (error) {
        console.error("Error in completeStyle:", error);
        return res.status(500).json({ error: "Failed to generate outfit recommendations" });
    }
}
/**
 * POST /products/complete-style
 *
 * Get outfit recommendations for a product passed in body
 * (useful for products not in database)
 *
 * Body:
 * - product: { title, brand?, category?, color?, price_cents?, currency?, image_url?, description? }
 * - options?: { maxPerCategory?, maxTotal?, preferSameBrand?, priceRange?, excludeBrands? }
 */
async function completeStyleFromBody(req, res) {
    try {
        const { product, options: bodyOptions } = req.body;
        if (!product || !product.title) {
            return res.status(400).json({ error: "Product with title is required" });
        }
        const productInput = {
            id: product.id || 0,
            title: product.title,
            brand: product.brand,
            category: product.category,
            color: product.color,
            price_cents: product.price_cents || product.price || 0,
            currency: product.currency || "USD",
            image_url: product.image_url || product.image,
            description: product.description,
        };
        const options = {
            maxPerCategory: Math.min(bodyOptions?.maxPerCategory || 5, 20),
            maxTotal: Math.min(bodyOptions?.maxTotal || 20, 50),
            preferSameBrand: bodyOptions?.preferSameBrand || false,
            priceRange: bodyOptions?.priceRange,
            excludeBrands: bodyOptions?.excludeBrands,
        };
        const result = await (0, outfit_service_js_1.getOutfitRecommendationsFromProduct)(productInput, options);
        return res.json({ success: true, data: result });
    }
    catch (error) {
        console.error("Error in completeStyleFromBody:", error);
        return res.status(500).json({ error: "Failed to generate outfit recommendations" });
    }
}
/**
 * GET /products/:id/style-profile
 *
 * Get detected style profile for a product (useful for debugging/display)
 */
async function getStyleProfile(req, res) {
    try {
        const productId = parseInt(req.params.id, 10);
        if (isNaN(productId)) {
            return res.status(400).json({ error: "Invalid product ID" });
        }
        const result = await (0, outfit_service_js_1.getProductStyleProfile)(productId);
        if (!result) {
            return res.status(404).json({ error: "Product not found" });
        }
        return res.json({ success: true, data: result });
    }
    catch (error) {
        console.error("Error in getStyleProfile:", error);
        return res.status(500).json({ error: "Failed to get style profile" });
    }
}
