/**
 * Compare Routes
 * 
 * API endpoints for product comparison feature.
 */

import { Router, Request, Response } from "express";
import {
  compareProductsWithVerdict,
  getProductQuality,
  analyzeText,
  getPriceAnalysis,
  getBaseline,
  computeBaselines,
  getAllTooltips,
  validateCompareInput,
  validateProductId,
  validateTextInput,
} from "./compare.service.js";

const router = Router();

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
router.post("/", async (req: Request, res: Response) => {
  try {
    const { product_ids } = req.body;
    
    // Validate input
    const validationError = validateCompareInput(product_ids);
    if (validationError) {
      return res.status(400).json(validationError);
    }
    
    const result = await compareProductsWithVerdict(product_ids);
    res.json(result);
  } catch (error) {
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
router.get("/quality/:productId", async (req: Request, res: Response) => {
  try {
    const productId = validateProductId(req.params.productId);
    
    if (!productId) {
      return res.status(400).json({ error: "Invalid product ID" });
    }
    
    const result = await getProductQuality(productId);
    res.json(result);
  } catch (error) {
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
router.post("/analyze-text", async (req: Request, res: Response) => {
  try {
    const { title, description, return_policy } = req.body;
    
    const validationError = validateTextInput(title);
    if (validationError) {
      return res.status(400).json(validationError);
    }
    
    const analysis = analyzeText(title, description, return_policy);
    res.json(analysis);
  } catch (error) {
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
router.get("/price/:productId", async (req: Request, res: Response) => {
  try {
    const productId = validateProductId(req.params.productId);
    
    if (!productId) {
      return res.status(400).json({ error: "Invalid product ID" });
    }
    
    const analysis = await getPriceAnalysis(productId);
    res.json(analysis);
  } catch (error) {
    console.error("Price analysis error:", error);
    res.status(500).json({ error: "Failed to analyze price" });
  }
});

/**
 * GET /api/compare/baseline/:category
 * 
 * Get price baseline for a category
 */
router.get("/baseline/:category", async (req: Request, res: Response) => {
  try {
    const { category } = req.params;
    
    const baseline = await getBaseline(category);
    
    if (!baseline) {
      return res.status(404).json({ 
        error: "No baseline found for category",
        category 
      });
    }
    
    res.json(baseline);
  } catch (error) {
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
router.post("/admin/compute-baselines", async (req: Request, res: Response) => {
  try {
    // TODO: Add admin auth check
    
    const result = await computeBaselines();
    
    res.json({
      message: "Baseline computation complete",
      computed: result.computed,
      errors: result.errors,
    });
  } catch (error) {
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
router.get("/tooltips", async (_req: Request, res: Response) => {
  const tooltips = getAllTooltips();
  res.json(tooltips);
});

export default router;
