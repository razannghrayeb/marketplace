/**
 * Compare Routes
 * 
 * API endpoints for product comparison feature.
 */

import { Router, Request, Response } from "express";
import multer from "multer";
import {
  coerceCompareProductIdsInput,
  getProductQuality,
  analyzeText,
  getPriceAnalysis,
  getBaseline,
  computeBaselines,
  getAllTooltips,
  validateCompareInput,
  validateProductId,
  validateTextInput,
  getProductReviewAnalysis,
  compareReviews,
} from "./compare.service";
import { compareProductsWithDecisionIntelligence } from "../../features/decision-intelligence";
import {
  getEnhancedComparison,
  getProductInventory,
  getPriceTrend,
  getProductMerchantReputation,
  getShippingInfo,
  findBestValue,
  findMostReliable,
  findBestShipping,
} from "./compare-enhanced.service";
import { InsufficientProductsForCompareError } from "../../lib/compare/compareEngine";

const router = Router();
const compareBodyMultipart = multer().none();

function parsePositiveInt(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  return i > 0 ? i : null;
}

function parsePaginationQuery(query: Request["query"]): {
  enabled: boolean;
  page: number;
  limit: number;
  offset: number;
} {
  const paginateRaw = String(query.paginate ?? "").toLowerCase();
  const enabled = paginateRaw === "1" || paginateRaw === "true";
  const page = parsePositiveInt(query.page) ?? 1;
  const limit = Math.min(200, parsePositiveInt(query.limit) ?? 50);
  const offset = (page - 1) * limit;
  return { enabled, page, limit, offset };
}

// ============================================================================
// Compare Products
// ============================================================================

/**
 * POST /api/compare
 * 
 * Compare 2-5 products and get verdict
 * 
 * Body: application/json { product_ids: number[] } or multipart/form-data (same field; string JSON array or comma-separated).
 * Query: ?enhanced=true (optional, adds inventory, shipping, reputation data)
 * Returns: FullVerdictResponse + optional enhanced data
 */
router.post("/", compareBodyMultipart, async (req: Request, res: Response) => {
  try {
    const payload = {
      ...req.body,
      product_ids: coerceCompareProductIdsInput(req.body),
    };

    const result = await compareProductsWithDecisionIntelligence(payload);
    if (!result.ok) {
      const status =
        result.error.code === "INVALID_REQUEST"
          ? 400
          : result.error.code === "PRODUCTS_NOT_FOUND"
            ? 404
            : result.error.code === "INSUFFICIENT_PRODUCT_DATA"
              ? 422
              : 500;
      return res.status(status).json({
        error: result.error.message,
        code: result.error.code,
        details: result.error.details,
      });
    }

    const decisionResponse = result.response;
    
    // Optionally add enhanced data (inventory, shipping, reputation, pricing)
    if (req.query.enhanced === "true" || req.body.enhanced === true) {
      try {
        const enhanced = await getEnhancedComparison(decisionResponse.comparisonContext.productIds);
        return res.json({
          ...decisionResponse,
          enhanced_data: {
            comparisons: enhanced,
            recommendations: {
              best_value: findBestValue(enhanced),
              most_reliable: findMostReliable(enhanced),
              best_shipping: findBestShipping(enhanced),
            },
          },
        });
      } catch (enhanceErr) {
        console.warn("Could not get enhanced data:", enhanceErr);
        // Fall through to return basic verdict anyway
      }
    }

    res.json(decisionResponse);
  } catch (error) {
    console.error("Compare error:", error);
    if (error instanceof InsufficientProductsForCompareError) {
      return res.status(404).json({
        error: error.message,
        missing_product_ids: error.missingProductIds,
      });
    }
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
  const pagination = parsePaginationQuery(_req.query);
  if (!pagination.enabled) {
    return res.json(tooltips);
  }

  const entries = Object.entries(tooltips).map(([reason, tooltip]) => ({ reason, tooltip }));
  const total = entries.length;
  const items = entries.slice(pagination.offset, pagination.offset + pagination.limit);

  return res.json({
    items,
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      total_pages: Math.max(1, Math.ceil(total / pagination.limit)),
      has_next: pagination.offset + items.length < total,
      has_prev: pagination.page > 1,
    },
  });
});

// ============================================================================
// Review Analysis
// ============================================================================

/**
 * GET /api/compare/reviews/:productId
 * 
 * Get review analysis for a product
 */
router.get("/reviews/:productId", async (req: Request, res: Response) => {
  try {
    const productId = validateProductId(req.params.productId);
    
    if (!productId) {
      return res.status(400).json({ error: "Invalid product ID" });
    }
    
    const analysis = await getProductReviewAnalysis(productId);
    res.json(analysis);
  } catch (error) {
    console.error("Review analysis error:", error);
    res.status(500).json({ error: "Failed to analyze reviews" });
  }
});

/**
 * POST /api/compare/reviews
 * 
 * Compare reviews across multiple products
 * Body: { product_ids: number[] }
 */
router.post("/reviews", async (req: Request, res: Response) => {
  try {
    const { product_ids } = req.body;

    const parsed = validateCompareInput(product_ids);
    if (!parsed.ok) {
      return res.status(400).json({ error: parsed.error, example: parsed.example });
    }

    const comparison = await compareReviews(parsed.productIds);
    
    // Convert Map to object for JSON
    const result: Record<number, any> = {};
    comparison.forEach((analysis, id) => {
      result[id] = analysis;
    });

    const pagination = parsePaginationQuery(req.query);
    if (!pagination.enabled) {
      return res.json({ reviews: result });
    }

    const entries = Object.entries(result);
    const total = entries.length;
    const sliced = entries.slice(pagination.offset, pagination.offset + pagination.limit);
    const pagedReviews: Record<number, any> = {};
    for (const [id, analysis] of sliced) {
      pagedReviews[Number(id)] = analysis;
    }

    return res.json({
      reviews: pagedReviews,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        total_pages: Math.max(1, Math.ceil(total / pagination.limit)),
        has_next: pagination.offset + sliced.length < total,
        has_prev: pagination.page > 1,
      },
    });
  } catch (error) {
    console.error("Review comparison error:", error);
    res.status(500).json({ error: "Failed to compare reviews" });
  }
});

// ============================================================================
// Enhanced Comparison (NEW)
// ============================================================================

/**
 * POST /api/compare/enhanced
 * 
 * Get comprehensive comparison with inventory, pricing, shipping, and reputation
 * 
 * Body: { product_ids: number[] }
 */
router.post("/enhanced", compareBodyMultipart, async (req: Request, res: Response) => {
  try {
    const product_ids = coerceCompareProductIdsInput(req.body);
    const parsed = validateCompareInput(product_ids);
    
    if (!parsed.ok) {
      return res.status(400).json({ success: false, error: parsed.error });
    }

    const comparisons = await getEnhancedComparison(parsed.productIds);
    const bestValue = findBestValue(comparisons);
    const mostReliable = findMostReliable(comparisons);
    const bestShipping = findBestShipping(comparisons);

    res.json({
      success: true,
      data: {
        comparisons,
        recommendations: {
          best_value: bestValue,
          most_reliable: mostReliable,
          best_shipping: bestShipping,
        },
      },
    });
  } catch (error) {
    console.error("Enhanced compare error:", error);
    res.status(500).json({ success: false, error: "Failed to get enhanced comparison" });
  }
});

/**
 * GET /api/compare/inventory/:productId
 * 
 * Get current inventory status for a product
 */
router.get("/inventory/:productId", async (req: Request, res: Response) => {
  try {
    const productId = validateProductId(req.params.productId);
    if (!productId) {
      return res.status(400).json({ error: "Invalid product ID" });
    }

    const inventory = await getProductInventory(productId);
    res.json({ success: true, data: inventory });
  } catch (error) {
    console.error("Inventory error:", error);
    res.status(500).json({ success: false, error: "Failed to get inventory" });
  }
});

/**
 * GET /api/compare/price-trend/:productId
 * 
 * Get price trend and volatility analysis
 */
router.get("/price-trend/:productId", async (req: Request, res: Response) => {
  try {
    const productId = validateProductId(req.params.productId);
    if (!productId) {
      return res.status(400).json({ error: "Invalid product ID" });
    }

    const trend = await getPriceTrend(productId);
    res.json({ success: true, data: trend });
  } catch (error) {
    console.error("Price trend error:", error);
    res.status(500).json({ success: false, error: "Failed to get price trend" });
  }
});

/**
 * GET /api/compare/merchant/:productId
 * 
 * Get vendor/merchant reputation information
 */
router.get("/merchant/:productId", async (req: Request, res: Response) => {
  try {
    const productId = validateProductId(req.params.productId);
    if (!productId) {
      return res.status(400).json({ error: "Invalid product ID" });
    }

    const merchant = await getProductMerchantReputation(productId);
    res.json({ success: true, data: merchant });
  } catch (error) {
    console.error("Merchant info error:", error);
    res.status(500).json({ success: false, error: "Failed to get merchant information" });
  }
});

/**
 * GET /api/compare/shipping/:productId
 * 
 * Get shipping and return policy information
 */
router.get("/shipping/:productId", async (req: Request, res: Response) => {
  try {
    const productId = validateProductId(req.params.productId);
    if (!productId) {
      return res.status(400).json({ error: "Invalid product ID" });
    }

    const shipping = await getShippingInfo(productId);
    res.json({ success: true, data: shipping });
  } catch (error) {
    console.error("Shipping info error:", error);
    res.status(500).json({ success: false, error: "Failed to get shipping information" });
  }
});

export default router;
