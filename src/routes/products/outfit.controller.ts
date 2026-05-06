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
  getOutfitRecommendationsFromWardrobeItem,
  getProductStyleProfile,
  type CompleteStyleOptions,
} from "./outfit.service";
import { type Product } from "../../lib/outfit";

// ============================================================================
// Request Helpers
// ============================================================================

/** Prefer JWT user; fall back to storefront header for wardrobe merge when token is missing/stale. */
function getOptionalUserId(req: Request): number | undefined {
  if (req.user?.id != null) return req.user.id;
  const raw = req.headers["x-user-id"];
  if (raw === undefined || raw === null || String(raw).trim() === "") return undefined;
  const n = parseInt(String(raw).trim(), 10);
  return Number.isFinite(n) && n >= 1 ? n : undefined;
}

function parseCompleteStyleOptions(query: any): CompleteStyleOptions {
  const options: CompleteStyleOptions = {
    maxPerCategory: Math.min(parseInt(query.maxPerCategory) || 5, 20),
    maxTotal: Math.min(parseInt(query.maxTotal) || 20, 50),
    preferSameBrand: query.preferSameBrand === "true",
    disablePriceFilter: query.disablePriceFilter === "true",
  };

  if (query.mode === "tryon") {
    options.sourceMode = "tryon";
  }
  if (query.audienceGenderHint === "men" || query.audienceGenderHint === "women" || query.audienceGenderHint === "unisex") {
    options.audienceGenderHint = query.audienceGenderHint;
  }

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

  // Weather hint (query params: weather_temp, weather_season)
  const weatherTempRaw = query.weather_temp ?? query.weatherTemp;
  const weatherSeasonRaw = query.weather_season ?? query.weatherSeason;
  if (weatherTempRaw !== undefined || weatherSeasonRaw !== undefined) {
    const w: NonNullable<CompleteStyleOptions["weather"]> = {};
    if (weatherTempRaw !== undefined && weatherTempRaw !== "") {
      const t = Number(weatherTempRaw);
      if (Number.isFinite(t)) w.temperatureC = t;
    }
    const s = String(weatherSeasonRaw || "").toLowerCase();
    if (s === "spring" || s === "summer" || s === "fall" || s === "winter") {
      w.season = s;
    }
    if (w.temperatureC !== undefined || w.season) options.weather = w;
  }

  return options;
}

function parseWeatherFromBody(raw: any): CompleteStyleOptions["weather"] | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: NonNullable<CompleteStyleOptions["weather"]> = {};
  const t = Number(raw.temperatureC ?? raw.temperature_c ?? raw.tempC ?? raw.temp);
  if (Number.isFinite(t)) out.temperatureC = t;
  const s = String(raw.season || "").toLowerCase();
  if (s === "spring" || s === "summer" || s === "fall" || s === "winter") out.season = s;
  return out.temperatureC !== undefined || out.season ? out : undefined;
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
    const userId = getOptionalUserId(req);
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
 * Get outfit recommendations from body input.
 * Preferred path: pass `product_id` (or `product.id`) so POST shares
 * the same DB-backed complete-look logic as GET /products/:id/complete-style.
 * Fallback path: pass `product` object for items not in database.
 * 
 * Body:
 * - product_id?: number
 * - product: { title, brand?, category?, color?, price_cents?, currency?, image_url?, description? }
 * - options?: { maxPerCategory?, maxTotal?, preferSameBrand?, priceRange?, excludeBrands? }
 */
export async function completeStyleFromBody(req: Request, res: Response) {
  try {
    const {
      product,
      product_id: productIdRaw,
      wardrobe_item_id: wardrobeItemIdRaw,
      options: bodyOptions,
    } = req.body;

    const wardrobeItemIdCandidate =
      wardrobeItemIdRaw !== undefined && wardrobeItemIdRaw !== null
        ? parseInt(String(wardrobeItemIdRaw), 10)
        : Number.NaN;

    // Only an explicit top-level `product_id` should trigger DB-backed mode.
    // If callers send a `product` object (even with an `id`), treat it as
    // an external/image-derived anchor and keep recommendation context local
    // to the provided payload.
    const productIdCandidate =
      productIdRaw !== undefined && productIdRaw !== null
        ? parseInt(String(productIdRaw), 10)
        : Number.NaN;

    if (
      !Number.isFinite(productIdCandidate) &&
      !Number.isFinite(wardrobeItemIdCandidate) &&
      (!product || !product.title)
    ) {
      return res.status(400).json({ success: false, error: { message: "product_id, wardrobe_item_id, or product with title is required" } });
    }

    const queryOptions = parseCompleteStyleOptions(req.query);
    const bodyMaxPer = Number(bodyOptions?.maxPerCategory);
    const bodyMaxTotal = Number(bodyOptions?.maxTotal);
    const hasBodyMaxPer = Number.isFinite(bodyMaxPer) && bodyMaxPer >= 1;
    const hasBodyMaxTotal = Number.isFinite(bodyMaxTotal) && bodyMaxTotal >= 1;

    const options: CompleteStyleOptions = {
      ...queryOptions,
      maxPerCategory: hasBodyMaxPer ? Math.min(Math.floor(bodyMaxPer), 20) : queryOptions.maxPerCategory,
      maxTotal: hasBodyMaxTotal ? Math.min(Math.floor(bodyMaxTotal), 50) : queryOptions.maxTotal,
      preferSameBrand:
        typeof bodyOptions?.preferSameBrand === "boolean"
          ? bodyOptions.preferSameBrand
          : queryOptions.preferSameBrand,
      disablePriceFilter:
        typeof bodyOptions?.disablePriceFilter === "boolean"
          ? bodyOptions.disablePriceFilter
          : queryOptions.disablePriceFilter,
      priceRange: bodyOptions?.priceRange || queryOptions.priceRange,
      excludeBrands:
        Array.isArray(bodyOptions?.excludeBrands) && bodyOptions.excludeBrands.length > 0
          ? bodyOptions.excludeBrands
          : queryOptions.excludeBrands,
      sourceMode:
        bodyOptions?.sourceMode === "tryon" || req.query.mode === "tryon"
          ? "tryon"
          : queryOptions.sourceMode,
      audienceGenderHint:
        bodyOptions?.audienceGenderHint === "men" ||
        bodyOptions?.audienceGenderHint === "women" ||
        bodyOptions?.audienceGenderHint === "unisex"
          ? bodyOptions.audienceGenderHint
          : queryOptions.audienceGenderHint,
      weather: parseWeatherFromBody(bodyOptions?.weather) ?? parseWeatherFromBody(req.body?.weather) ?? queryOptions.weather,
    };

    const userId = getOptionalUserId(req);

    // Wardrobe-item-anchored flow: caller passes `wardrobe_item_id` and is authenticated.
    if (Number.isFinite(wardrobeItemIdCandidate) && wardrobeItemIdCandidate >= 1) {
      if (!userId) {
        return res.status(401).json({ success: false, error: { message: "Authentication required to use a wardrobe item as anchor" } });
      }
      const result = await getOutfitRecommendationsFromWardrobeItem(wardrobeItemIdCandidate, userId, options);
      if (!result) {
        return res.status(404).json({ success: false, error: { message: "Wardrobe item not found" } });
      }
      return res.json({ success: true, data: result });
    }

    // Prefer DB-backed product flow when ID is provided so POST and GET share
    // the same complete-look recommendation pipeline.
    if (Number.isFinite(productIdCandidate) && productIdCandidate >= 1) {
      const result = await getOutfitRecommendations(productIdCandidate, options, userId);
      if (!result) {
        return res.status(404).json({ success: false, error: { message: "Product not found" } });
      }
      return res.json({ success: true, data: result });
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
 * POST /products/complete-style/try-on
 *
 * Dedicated try-on mode:
 * - skips catalog similarity remapping
 * - keeps recommendations anchored to provided product payload
 */
export async function completeStyleTryOn(req: Request, res: Response) {
  req.query.mode = "tryon";
  req.body = {
    ...(req.body || {}),
    options: {
      ...((req.body && req.body.options) || {}),
      sourceMode: "tryon",
    },
  };
  return completeStyleFromBody(req, res);
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
