"use strict";
/**
 * Compare Routes
 *
 * API endpoints for product comparison feature.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const compare_service_js_1 = require("./compare.service.js");
const router = (0, express_1.Router)();
// ============================================================================
// Compare Products
// ============================================================================
/**
 * POST /api/compare
 *
 * Compare 2-5 products and get verdict
 *
 * Body: { product_ids: number[] }
 * Returns: FullVerdictResponse
 */
router.post("/", async (req, res) => {
    try {
        const { product_ids } = req.body;
        // Validate input
        const validationError = (0, compare_service_js_1.validateCompareInput)(product_ids);
        if (validationError) {
            return res.status(400).json(validationError);
        }
        const result = await (0, compare_service_js_1.compareProductsWithVerdict)(product_ids);
        res.json(result);
    }
    catch (error) {
        console.error("Compare error:", error);
        res.status(500).json({ error: "Failed to compare products" });
    }
});
// ============================================================================
// Single Product Quality Analysis
// ============================================================================
/**
 * GET /api/compare/quality/:productId
 *
 * Get quality signals for a single product
 */
router.get("/quality/:productId", async (req, res) => {
    try {
        const productId = (0, compare_service_js_1.validateProductId)(req.params.productId);
        if (!productId) {
            return res.status(400).json({ error: "Invalid product ID" });
        }
        const result = await (0, compare_service_js_1.getProductQuality)(productId);
        res.json(result);
    }
    catch (error) {
        console.error("Quality analysis error:", error);
        res.status(500).json({ error: "Failed to analyze product quality" });
    }
});
// ============================================================================
// Text Quality Analysis
// ============================================================================
/**
 * POST /api/compare/analyze-text
 *
 * Analyze text quality without needing a product in database
 * Useful for preview/testing
 *
 * Body: { title: string, description?: string, return_policy?: string }
 */
router.post("/analyze-text", async (req, res) => {
    try {
        const { title, description, return_policy } = req.body;
        const validationError = (0, compare_service_js_1.validateTextInput)(title);
        if (validationError) {
            return res.status(400).json(validationError);
        }
        const analysis = (0, compare_service_js_1.analyzeText)(title, description, return_policy);
        res.json(analysis);
    }
    catch (error) {
        console.error("Text analysis error:", error);
        res.status(500).json({ error: "Failed to analyze text" });
    }
});
// ============================================================================
// Price Analysis
// ============================================================================
/**
 * GET /api/compare/price/:productId
 *
 * Get price anomaly analysis for a product
 */
router.get("/price/:productId", async (req, res) => {
    try {
        const productId = (0, compare_service_js_1.validateProductId)(req.params.productId);
        if (!productId) {
            return res.status(400).json({ error: "Invalid product ID" });
        }
        const analysis = await (0, compare_service_js_1.getPriceAnalysis)(productId);
        res.json(analysis);
    }
    catch (error) {
        console.error("Price analysis error:", error);
        res.status(500).json({ error: "Failed to analyze price" });
    }
});
/**
 * GET /api/compare/baseline/:category
 *
 * Get price baseline for a category
 */
router.get("/baseline/:category", async (req, res) => {
    try {
        const { category } = req.params;
        const baseline = await (0, compare_service_js_1.getBaseline)(category);
        if (!baseline) {
            return res.status(404).json({
                error: "No baseline found for category",
                category
            });
        }
        res.json(baseline);
    }
    catch (error) {
        console.error("Baseline error:", error);
        res.status(500).json({ error: "Failed to get baseline" });
    }
});
// ============================================================================
// Admin: Compute Baselines
// ============================================================================
/**
 * POST /api/compare/admin/compute-baselines
 *
 * Trigger category baseline computation (admin only)
 * Normally run as weekly job
 */
router.post("/admin/compute-baselines", async (req, res) => {
    try {
        // TODO: Add admin auth check
        const result = await (0, compare_service_js_1.computeBaselines)();
        res.json({
            message: "Baseline computation complete",
            computed: result.computed,
            errors: result.errors,
        });
    }
    catch (error) {
        console.error("Baseline computation error:", error);
        res.status(500).json({ error: "Failed to compute baselines" });
    }
});
// ============================================================================
// Reason Tooltips
// ============================================================================
/**
 * GET /api/compare/tooltips
 *
 * Get all reason tooltips for UI
 */
router.get("/tooltips", async (_req, res) => {
    const tooltips = (0, compare_service_js_1.getAllTooltips)();
    res.json(tooltips);
});
exports.default = router;
