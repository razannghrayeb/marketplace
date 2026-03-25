/**
 * Outfit Controller
 * 
 * Thin HTTP layer for "Complete My Style" outfit recommendations.
 * Delegates all business logic to outfit.service.ts
 */
import { Request, Response } from "express";
import {
  getOutfitRecommendations,
  getOutfitRecommendationsFromProduct,
  getProductStyleProfile,
  type CompleteStyleOptions,
} from "./outfit.service";
import { type Product } from "../../lib/outfit";

// ============================================================================
// Request Helpers
// ============================================================================

function parseCompleteStyleOptions(query: any): CompleteStyleOptions {
  const options: CompleteStyleOptions = {
    maxPerCategory: Math.min(parseInt(query.maxPerCategory) || 5, 20),
    maxTotal: Math.min(parseInt(query.maxTotal) || 20, 50),
    preferSameBrand: query.preferSameBrand === "true",
    disablePriceFilter: query.disablePriceFilter === "true",
  };

  // Price range (explicit range overrides default 0.5x-2.5x filter)
  if (query.minPrice || query.maxPrice) {
    options.priceRange = {};
    if (query.minPrice) options.priceRange.min = parseInt(query.minPrice);
    if (query.maxPrice) options.priceRange.max = parseInt(query.maxPrice);
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
export async function completeStyle(req: Request, res: Response) {
  try {
    const productId = parseInt(req.params.id, 10);

    if (isNaN(productId)) {
      return res.status(400).json({ success: false, error: { message: "Invalid product ID" } });
    }

    const options = parseCompleteStyleOptions(req.query);
    const userId = req.user?.id;
    const result = await getOutfitRecommendations(productId, options, userId);

    if (!result) {
      return res.status(404).json({ success: false, error: { message: "Product not found" } });
    }

    return res.json({ success: true, data: result });
  } catch (error) {
    console.error("Error in completeStyle:", error);
    return res
      .status(500)
      .json({ success: false, error: { message: "Failed to generate outfit recommendations" } });
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
export async function completeStyleFromBody(req: Request, res: Response) {
  try {
    const { product, options: bodyOptions } = req.body;

    if (!product || !product.title) {
      return res.status(400).json({ success: false, error: { message: "Product with title is required" } });
    }

    const productInput: Product = {
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

    const options: CompleteStyleOptions = {
      maxPerCategory: Math.min(bodyOptions?.maxPerCategory || 5, 20),
      maxTotal: Math.min(bodyOptions?.maxTotal || 20, 50),
      preferSameBrand: bodyOptions?.preferSameBrand || false,
      priceRange: bodyOptions?.priceRange,
      excludeBrands: bodyOptions?.excludeBrands,
    };

    const userId = req.user?.id;
    const result = await getOutfitRecommendationsFromProduct(productInput, options, userId);

    return res.json({ success: true, data: result });
  } catch (error) {
    console.error("Error in completeStyleFromBody:", error);
    return res
      .status(500)
      .json({ success: false, error: { message: "Failed to generate outfit recommendations" } });
  }
}

/**
 * GET /products/:id/style-profile
 * 
 * Get detected style profile for a product (useful for debugging/display)
 */
export async function getStyleProfile(req: Request, res: Response) {
  try {
    const productId = parseInt(req.params.id, 10);

    if (isNaN(productId)) {
      return res.status(400).json({ success: false, error: { message: "Invalid product ID" } });
    }

    const result = await getProductStyleProfile(productId);

    if (!result) {
      return res.status(404).json({ success: false, error: { message: "Product not found" } });
    }

    return res.json({ success: true, data: result });
  } catch (error) {
    console.error("Error in getStyleProfile:", error);
    return res.status(500).json({ success: false, error: { message: "Failed to get style profile" } });
  }
}
