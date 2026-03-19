/**
 * Recommendations Controller
 * 
 * HTTP handlers for similar product recommendations.
 * 
 * Endpoints:
 * - GET /products/:id/recommendations - Get similar products
 * - POST /products/recommendations/batch - Get recommendations for multiple products
 */
import { Request, Response } from "express";
import {
  getSimilarProducts,
  getBatchRecommendations,
  type RecommendationOptions,
} from "./recommendations.service";

// ============================================================================
// Request Helpers
// ============================================================================

function parseRecommendationOptions(query: any, headers: any): RecommendationOptions {
  return {
    limit: query.limit ? parseInt(query.limit, 10) : 20,
    useModel: query.useModel !== "false",
    minScore: query.minScore ? parseFloat(query.minScore) : 0,
    debug: query.debug === "true",
    userId: headers["x-user-id"] || query.userId,
    sessionId: headers["x-session-id"] || query.sessionId,
    // New MMR diversity options
    diversityLambda: query.diversityLambda ? parseFloat(query.diversityLambda) : 0.7,
    applyDiversity: query.applyDiversity !== "false",
    applyColdStartBoost: query.applyColdStartBoost !== "false",
  };
}

// ============================================================================
// Handlers
// ============================================================================

/**
 * GET /products/:id/recommendations
 * 
 * Get similar product recommendations for a product.
 * Uses ML ranking to find the best matches.
 * 
 * Query params:
 * - limit: Max recommendations (default: 20)
 * - useModel: Use ML model if available (default: true)
 * - minScore: Minimum score threshold (default: 0)
 * - debug: Include timing info (default: false)
 * - diversityLambda: MMR diversity parameter 0-1 (default: 0.7)
 * - applyDiversity: Enable MMR diversity ranking (default: true)
 * - applyColdStartBoost: Boost new products (default: true)
 * 
 * Headers:
 * - x-user-id: User ID for impression tracking
 * - x-session-id: Session ID for impression tracking
 */
export async function getRecommendations(req: Request, res: Response) {
  try {
    const productId = parseInt(req.params.id, 10);
    
    if (isNaN(productId) || productId <= 0) {
      return res.status(400).json({
        error: "Invalid product ID",
        message: "Product ID must be a positive integer",
      });
    }

    const options = parseRecommendationOptions(req.query, req.headers);
    const result = await getSimilarProducts(productId, options);

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error("[RecommendationsController] Error:", error);
    
    if (error.message?.includes("not found")) {
      return res.status(404).json({
        error: "Product not found",
        message: error.message,
      });
    }
    
    res.status(500).json({
      error: "Failed to get recommendations",
      message: error.message,
    });
  }
}

/**
 * POST /products/recommendations/batch
 * 
 * Get recommendations for multiple products at once.
 * Useful for "customers also viewed" sections.
 * 
 * Body:
 * - productIds: Array of product IDs
 * - limit: Max recommendations per product (default: 10)
 * - useModel: Use ML model if available (default: true)
 */
export async function getBatchRecommendationsHandler(req: Request, res: Response) {
  try {
    const { productIds, ...options } = req.body;
    
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({
        error: "Invalid request",
        message: "productIds must be a non-empty array",
      });
    }
    
    if (productIds.length > 50) {
      return res.status(400).json({
        error: "Too many products",
        message: "Maximum 50 products per batch request",
      });
    }

    const numericIds = productIds.map((id: any) => parseInt(id, 10)).filter((id: number) => !isNaN(id));
    const result = await getBatchRecommendations(numericIds, {
      ...options,
      userId: req.headers["x-user-id"] as string,
      sessionId: req.headers["x-session-id"] as string,
    });

    // Convert Map to object for JSON response
    const recommendations: Record<number, any[]> = {};
    result.forEach((recs, id) => {
      recommendations[id] = recs;
    });

    res.json({
      success: true,
      data: {
        recommendations,
        count: Object.keys(recommendations).length,
      },
    });
  } catch (error: any) {
    console.error("[RecommendationsController] Batch error:", error);
    res.status(500).json({
      error: "Failed to get batch recommendations",
      message: error.message,
    });
  }
}
