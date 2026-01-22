"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.listProducts = listProducts;
exports.searchProductsByTitle = searchProductsByTitle;
exports.searchProductsByImage = searchProductsByImage;
exports.getProductPriceHistory = getProductPriceHistory;
exports.getProductFacets = getProductFacets;
exports.getPriceDrops = getPriceDrops;
const products_service_js_1 = require("./products.service.js");
const index_js_1 = require("../../lib/image/index.js");
const index_js_2 = require("../../lib/image/index.js");
// ============================================================================
// Request Helpers
// ============================================================================
function parseFilters(query) {
    const filters = {};
    if (query.category)
        filters.category = String(query.category);
    if (query.brand)
        filters.brand = String(query.brand);
    if (query.vendorId)
        filters.vendorId = String(query.vendorId);
    if (query.minPriceCents)
        filters.minPriceCents = Number(query.minPriceCents);
    if (query.maxPriceCents)
        filters.maxPriceCents = Number(query.maxPriceCents);
    if (query.currency)
        filters.currency = String(query.currency);
    if (query.availability !== undefined) {
        filters.availability = query.availability === "true" || query.availability === "1";
    }
    // Attribute filters (extracted from titles)
    if (query.color)
        filters.color = String(query.color).toLowerCase();
    if (query.material)
        filters.material = String(query.material).toLowerCase();
    if (query.fit)
        filters.fit = String(query.fit).toLowerCase();
    if (query.style)
        filters.style = String(query.style).toLowerCase();
    if (query.gender)
        filters.gender = String(query.gender).toLowerCase();
    if (query.pattern)
        filters.pattern = String(query.pattern).toLowerCase();
    return filters;
}
function parsePagination(query) {
    return {
        page: Math.max(1, Number(query.page) || 1),
        limit: Math.min(Math.max(1, Number(query.limit) || 20), 100),
    };
}
// ============================================================================
// Endpoints
// ============================================================================
/**
 * GET /products
 */
async function listProducts(req, res) {
    try {
        const filters = parseFilters(req.query);
        const { page, limit } = parsePagination(req.query);
        const products = await (0, products_service_js_1.searchProducts)({ filters, page, limit });
        res.json({ success: true, data: products, pagination: { page, limit } });
    }
    catch (error) {
        console.error("Error listing products:", error);
        res.status(500).json({ success: false, error: "Failed to fetch products" });
    }
}
/**
 * GET /products/search?q=query
 * Enhanced text search with related products
 * Query params:
 *   - q: search query (required)
 *   - includeRelated: boolean, default true
 *   - relatedLimit: number, default 10
 */
async function searchProductsByTitle(req, res) {
    try {
        const query = req.query.q;
        if (!query) {
            return res.status(400).json({ success: false, error: "Query parameter 'q' is required" });
        }
        const filters = parseFilters(req.query);
        const { page, limit } = parsePagination(req.query);
        const includeRelated = req.query.includeRelated !== "false";
        const relatedLimit = parseInt(req.query.relatedLimit) || 10;
        const result = await (0, products_service_js_1.searchByTextWithRelated)({
            query,
            filters,
            page,
            limit,
            includeRelated,
            relatedLimit,
        });
        res.json({
            success: true,
            data: result.results,
            related: result.related,
            meta: result.meta,
            pagination: { page, limit }
        });
    }
    catch (error) {
        console.error("Error searching products:", error);
        res.status(500).json({ success: false, error: "Failed to search products" });
    }
}
/**
 * POST /products/search/image
 * Enhanced image search with similarity threshold
 * Accepts: multipart/form-data with 'image' field OR JSON with 'embedding' array
 * Query params:
 *   - threshold: similarity threshold 0-1, default 0.7
 *   - includeRelated: include pHash similar images, default true
 */
async function searchProductsByImage(req, res) {
    try {
        const filters = parseFilters(req.query);
        const { page, limit } = parsePagination(req.query);
        const similarityThreshold = parseFloat(req.query.threshold) || 0.7;
        const includeRelated = req.query.includeRelated !== "false";
        const file = req.file;
        let embedding;
        let pHash;
        if (file) {
            // Image file uploaded
            if (!(0, index_js_2.isClipAvailable)()) {
                return res.status(503).json({
                    success: false,
                    error: "Image search not available. CLIP model not loaded.",
                });
            }
            const validation = await (0, index_js_1.validateImage)(file.buffer);
            if (!validation.valid) {
                return res.status(400).json({ success: false, error: validation.error });
            }
            // Process image for embedding and pHash in parallel
            const [embeddingResult, pHashResult] = await Promise.all([
                (0, index_js_1.processImageForEmbedding)(file.buffer),
                (0, index_js_1.computePHash)(file.buffer),
            ]);
            embedding = embeddingResult;
            pHash = pHashResult;
        }
        else if (req.body.embedding && Array.isArray(req.body.embedding)) {
            // Embedding provided directly
            embedding = req.body.embedding;
            pHash = req.body.pHash; // Optional pHash if provided
        }
        else {
            return res.status(400).json({
                success: false,
                error: "Upload an image file or provide an embedding array",
            });
        }
        // Use enhanced search with similarity scoring
        const result = await (0, products_service_js_1.searchByImageWithSimilarity)({
            imageEmbedding: embedding,
            filters,
            page,
            limit,
            similarityThreshold,
            includeRelated,
            pHash,
        });
        res.json({
            success: true,
            data: result.results,
            related: result.related,
            meta: result.meta,
            pagination: { page, limit }
        });
    }
    catch (error) {
        console.error("Error searching by image:", error);
        res.status(500).json({ success: false, error: "Failed to search by image" });
    }
}
/**
 * GET /products/:id/price-history
 */
async function getProductPriceHistory(req, res) {
    try {
        const productId = parseInt(req.params.id);
        if (isNaN(productId)) {
            return res.status(400).json({ success: false, error: "Invalid product ID" });
        }
        const days = parseInt(req.query.days) || 90;
        const format = req.query.format || "raw";
        // Dynamic import to avoid circular deps
        const { getPriceHistory, getPriceHistoryDaily, getPriceStats } = await Promise.resolve().then(() => __importStar(require("../../lib/products/index.js")));
        let history;
        let stats;
        if (format === "daily") {
            history = await getPriceHistoryDaily(productId, days);
        }
        else {
            history = await getPriceHistory(productId, { days });
        }
        stats = await getPriceStats(productId);
        res.json({ success: true, data: { history, stats } });
    }
    catch (error) {
        console.error("Error fetching price history:", error);
        res.status(500).json({ success: false, error: "Failed to fetch price history" });
    }
}
/**
 * GET /products/facets
 * Get available attribute values for filtering (facets)
 */
async function getProductFacets(req, res) {
    try {
        const { getAttributeFacets } = await Promise.resolve().then(() => __importStar(require("./products.service.js")));
        const filters = parseFilters(req.query);
        const facets = await getAttributeFacets(filters);
        res.json({ success: true, data: facets });
    }
    catch (error) {
        console.error("Error fetching facets:", error);
        res.status(500).json({ success: false, error: "Failed to fetch facets" });
    }
}
/**
 * GET /products/price-drops
 * Get recent price drop events
 */
async function getPriceDrops(req, res) {
    try {
        const { dropPriceProducts } = await Promise.resolve().then(() => __importStar(require("./products.service.js")));
        const drops = await dropPriceProducts();
        res.json({ success: true, data: drops });
    }
    catch (error) {
        console.error("Error fetching price drops:", error);
        res.status(500).json({ success: false, error: "Failed to fetch price drops" });
    }
}
