/**
 * Products Controller
 * Thin HTTP layer - delegates all business logic to service
 */
import { Request, Response } from "express";
import {
  searchProducts,
  SearchFilters,
  searchByImageWithSimilarity,
  searchByTextWithRelated,
} from "./products.service.js";
import { processImageForEmbedding, validateImage, computePHash } from "../../lib/image/index.js";
import { isClipAvailable } from "../../lib/image/index.js";

// ============================================================================
// Request Helpers
// ============================================================================

function parseFilters(query: any): SearchFilters {
  const filters: SearchFilters = {};

  if (query.category) filters.category = String(query.category);
  if (query.brand) filters.brand = String(query.brand);
  if (query.vendorId) filters.vendorId = String(query.vendorId);
  if (query.minPriceCents) filters.minPriceCents = Number(query.minPriceCents);
  if (query.maxPriceCents) filters.maxPriceCents = Number(query.maxPriceCents);
  if (query.currency) filters.currency = String(query.currency);
  if (query.availability !== undefined) {
    filters.availability = query.availability === "true" || query.availability === "1";
  }
  
  // Attribute filters (extracted from titles)
  if (query.color) filters.color = String(query.color).toLowerCase();
  if (query.material) filters.material = String(query.material).toLowerCase();
  if (query.fit) filters.fit = String(query.fit).toLowerCase();
  if (query.style) filters.style = String(query.style).toLowerCase();
  if (query.gender) filters.gender = String(query.gender).toLowerCase();
  if (query.pattern) filters.pattern = String(query.pattern).toLowerCase();

  return filters;
}

function parsePagination(query: any): { page: number; limit: number } {
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
export async function listProducts(req: Request, res: Response) {
  try {
    const filters = parseFilters(req.query);
    const { page, limit } = parsePagination(req.query);

    const products = await searchProducts({ filters, page, limit });

    res.json({ success: true, data: products, pagination: { page, limit } });
  } catch (error) {
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
export async function searchProductsByTitle(req: Request, res: Response) {
  try {
    const query = req.query.q as string;
    if (!query) {
      return res.status(400).json({ success: false, error: "Query parameter 'q' is required" });
    }

    const filters = parseFilters(req.query);
    const { page, limit } = parsePagination(req.query);
    const includeRelated = req.query.includeRelated !== "false";
    const relatedLimit = parseInt(req.query.relatedLimit as string) || 10;

    const result = await searchByTextWithRelated({
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
  } catch (error) {
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
export async function searchProductsByImage(req: Request, res: Response) {
  try {
    const filters = parseFilters(req.query);
    const { page, limit } = parsePagination(req.query);
    const similarityThreshold = parseFloat(req.query.threshold as string) || 0.7;
    const includeRelated = req.query.includeRelated !== "false";

    const file = (req as any).file;
    let embedding: number[];
    let pHash: string | undefined;

    if (file) {
      // Image file uploaded
      if (!isClipAvailable()) {
        return res.status(503).json({
          success: false,
          error: "Image search not available. CLIP model not loaded.",
        });
      }

      const validation = await validateImage(file.buffer);
      if (!validation.valid) {
        return res.status(400).json({ success: false, error: validation.error });
      }

      // Process image for embedding and pHash in parallel
      const [embeddingResult, pHashResult] = await Promise.all([
        processImageForEmbedding(file.buffer),
        computePHash(file.buffer),
      ]);
      
      embedding = embeddingResult;
      pHash = pHashResult;
    } else if (req.body.embedding && Array.isArray(req.body.embedding)) {
      // Embedding provided directly
      embedding = req.body.embedding;
      pHash = req.body.pHash; // Optional pHash if provided
    } else {
      return res.status(400).json({
        success: false,
        error: "Upload an image file or provide an embedding array",
      });
    }

    // Use enhanced search with similarity scoring
    const result = await searchByImageWithSimilarity({
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
  } catch (error) {
    console.error("Error searching by image:", error);
    res.status(500).json({ success: false, error: "Failed to search by image" });
  }
}

/**
 * GET /products/:id/price-history
 */
export async function getProductPriceHistory(req: Request, res: Response) {
  try {
    const productId = parseInt(req.params.id);
    if (isNaN(productId)) {
      return res.status(400).json({ success: false, error: "Invalid product ID" });
    }

    const days = parseInt(req.query.days as string) || 90;
    const format = req.query.format as string || "raw";

    // Dynamic import to avoid circular deps
    const { getPriceHistory, getPriceHistoryDaily, getPriceStats } = await import("../../lib/products/index.js");

    let history: any;
    let stats: any;

    if (format === "daily") {
      history = await getPriceHistoryDaily(productId, days);
    } else {
      history = await getPriceHistory(productId, { days });
    }

    stats = await getPriceStats(productId);

    res.json({ success: true, data: { history, stats } });
  } catch (error) {
    console.error("Error fetching price history:", error);
    res.status(500).json({ success: false, error: "Failed to fetch price history" });
  }
}

/**
 * GET /products/facets
 * Get available attribute values for filtering (facets)
 */
export async function getProductFacets(req: Request, res: Response) {
  try {
    const { getAttributeFacets } = await import("./products.service.js");
    const filters = parseFilters(req.query);
    const facets = await getAttributeFacets(filters);
    res.json({ success: true, data: facets });
  } catch (error) {
    console.error("Error fetching facets:", error);
    res.status(500).json({ success: false, error: "Failed to fetch facets" });
  }
}

/**
 * GET /products/price-drops
 * Get recent price drop events
 */
export async function getPriceDrops(req: Request, res: Response) {
  try {
    const { dropPriceProducts } = await import("./products.service.js");
    const drops = await dropPriceProducts();
    res.json({ success: true, data: drops });
  } catch (error) {
    console.error("Error fetching price drops:", error);
    res.status(500).json({ success: false, error: "Failed to fetch price drops" });
  }
}

/**
 * GET /products/:id/similar
 * Get similar product candidates using unified candidate generator
 * 
 * Query params:
 *   - limit: number of candidates to return (default 30, max 100)
 *   - clipLimit: candidates from CLIP k-NN (default 200)
 *   - textLimit: candidates from text search (default 200)
 *   - usePHashDedup: filter near-duplicates (default false)
 *   - pHashThreshold: max Hamming distance for dedup (default 5)
 */
export async function getSimilarProducts(req: Request, res: Response) {
  try {
    const productId = req.params.id;
    if (!productId || isNaN(parseInt(productId, 10))) {
      return res.status(400).json({ success: false, error: "Invalid product ID" });
    }

    const { getCandidateScoresForProducts } = await import("./products.service");

    const limit = Math.min(Math.max(1, parseInt(req.query.limit as string) || 30), 100);
    const clipLimit = Math.min(Math.max(1, parseInt(req.query.clipLimit as string) || 200), 500);
    const textLimit = Math.min(Math.max(1, parseInt(req.query.textLimit as string) || 200), 500);
    const usePHashDedup = req.query.usePHashDedup === "true" || req.query.usePHashDedup === "1";
    const pHashThreshold = Math.min(Math.max(0, parseInt(req.query.pHashThreshold as string) || 5), 64);

    const result = await getCandidateScoresForProducts({
      baseProductId: productId,
      limit,
      clipLimit,
      textLimit,
      usePHashDedup,
      pHashThreshold,
    });

    res.json({ success: true, ...result });
  } catch (error) {
    console.error("Error fetching similar products:", error);
    res.status(500).json({ success: false, error: "Failed to fetch similar products" });
  }
}