/**
 * Products Controller
 * Thin HTTP layer - delegates all business logic to service
 */
import { Request, Response } from "express";
import {
  SearchFilters,
} from "./products.service";
import { searchBrowse, searchImage, searchText } from "../../lib/search/fashionSearchFacade";
import {
  validateImage,
  computePHash,
  blip,
} from "../../lib/image/index";
import { extractLexicalProductTypeSeeds } from "../../lib/search/productTypeTaxonomy";
import { isClipAvailable } from "../../lib/image/index";
import { getProductWithVariants } from "./products.service";
import { config } from "../../config";
import { extractQuickFashionColorHints } from "../../lib/color/quickImageColor";
import { toPublicSearchProducts } from "../../lib/search/publicSearchResult";
import { sortProductsByUnifiedScorer } from "../../lib/search/sortResults";

// ============================================================================
// Request Helpers
// ============================================================================

/** Staging / tuning: `SEARCH_RANKING_DEBUG=1` or `?rankingDebug=1` enriches `meta` for explain + finalRelevance01 review. */
function wantsRankingDebug(req: Request): boolean {
  if (config.search.searchRankingDebug) return true;
  const v = req.query.rankingDebug ?? req.query.ranking_debug;
  return v === "1" || v === "true";
}

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

    const products = await searchBrowse({ filters, page, limit });

    res.json({ success: true, data: products, pagination: { page, limit } });
  } catch (error) {
    console.error("Error listing products:", error);
    res.status(500).json({ success: false, error: "Failed to fetch products" });
  }
}

/**
 * GET /products/sales — catalog items with sales_price_cents < price_cents
 */
export async function listSaleProducts(req: Request, res: Response) {
  try {
    const { page, limit } = parsePagination(req.query);
    const sort = typeof req.query.sort === "string" ? req.query.sort : undefined;
    const { listProductsOnSale } = await import("./products.saleList.service");
    const { products, total } = await listProductsOnSale({ page, limit, sort });
    const pages = Math.max(1, Math.ceil(total / limit));
    res.json({
      success: true,
      data: products,
      pagination: { page, limit, total, pages },
    });
  } catch (error) {
    console.error("Error listing sale products:", error);
    res.status(500).json({ success: false, error: "Failed to fetch sale products" });
  }
}

/**
 * GET /products/search?q=query
 * Enhanced text search with related products
 * Query params:
 *   - q: search query (required)
 *   - includeRelated: boolean, default true
 *   - relatedLimit: number, default 10
 *   - rankingDebug=1: extra `meta` (final_accept_min, recall, gate) for staging; per-hit `explain` / `finalRelevance01` unchanged
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

    const result = await searchText({
      query,
      filters,
      page,
      limit,
      includeRelated,
      relatedLimit,
    });

    const rankingMeta = wantsRankingDebug(req)
      ? {
          ranking_debug: true as const,
          final_accept_min: config.search.finalAcceptMinText,
          relevance_gate_mode: config.search.relevanceGateMode,
          similarity_normalize: config.search.similarityNormalize,
          recall_window: config.search.recallWindow,
          recall_max: config.search.recallMax,
        }
      : {};

    res.json({
      success: true,
      data: result.results,
      related: result.related,
      meta: { ...result.meta, ...rankingMeta },
      pagination: { page, limit },
    });
  } catch (error) {
    console.error("Error searching products:", error);
    res.status(500).json({ success: false, error: "Failed to search products" });
  }
}

/**
 * POST /products/search/image
 * CLIP image embedding k-NN search (matches indexed primary-image vectors).
 *
 * Accepts: multipart/form-data with 'image' field OR JSON with 'embedding' array
 * Query params:
 *   - threshold: similarity threshold 0-1, default 0.7
 *   - includeRelated: include pHash similar images, default true
 */
export async function searchProductsByImage(req: Request, res: Response) {
  try {
    const filters = parseFilters(req.query);
    const { page, limit } = parsePagination(req.query);
    const similarityThreshold =
      parseFloat(req.query.threshold as string) || config.clip.imageSimilarityThreshold;
    const includeRelated = req.query.includeRelated !== "false";
    const sessionId = (req.query.session_id as string) || (req.headers["x-session-id"] as string | undefined);
    const userId = (req as any).user?.id ?? (req as any).userId;

    const file = (req as any).file;
    let embedding: number[] | undefined;
    let pHash: string | undefined;
    let softProductTypeHints: string[] | undefined;

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

      const quickHints = await extractQuickFashionColorHints(file.buffer);
      const blipPromise = blip.caption(file.buffer).catch(() => "");
      const caption = await Promise.race([
        blipPromise,
        new Promise<string>((resolve) =>
          setTimeout(() => resolve(""), config.search.blipCaptionTimeoutMs),
        ),
      ]);

      pHash = await computePHash(file.buffer);

      if (quickHints.length > 0) {
        // Query-image color hints are soft signals for reranking, not hard filters.
        if (!filters.color && !Array.isArray(filters.colors)) {
          filters.softColor = String(quickHints[0]).toLowerCase();
        }
      }

      const typeSeeds = extractLexicalProductTypeSeeds(caption);
      softProductTypeHints = typeSeeds.length > 0 ? typeSeeds : undefined;
    } else if (req.body.embedding && Array.isArray(req.body.embedding)) {
      // Client-provided vector (expected: same CLIP image space as the index)
      embedding = req.body.embedding;
      pHash = req.body.pHash; // Optional pHash if provided
    } else {
      return res.status(400).json({
        success: false,
        error: "Upload an image file or provide an embedding array",
      });
    }

    // Use enhanced search with similarity scoring
      const result = await searchImage({
        imageEmbedding: embedding,
        imageBuffer: file?.buffer,
      filters,
      limit,
      similarityThreshold,
      includeRelated,
      pHash,
      softProductTypeHints,
        sessionId,
        userId,
    });

    const rankingMeta = wantsRankingDebug(req)
      ? {
          ranking_debug: true as const,
          clip_image_similarity_threshold_applied: similarityThreshold,
          clip_image_similarity_threshold_config_default: config.clip.imageSimilarityThreshold,
          search_image_relax_floor: config.search.searchImageRelaxFloor,
        }
      : {};
    const includeExplain = wantsRankingDebug(req);
    const data = toPublicSearchProducts(sortProductsByUnifiedScorer(result.results as any), {
      includeExplain,
      includeScoreDebug: includeExplain,
    });
    const related = toPublicSearchProducts(sortProductsByUnifiedScorer((result.related ?? []) as any), {
      includeExplain,
      includeScoreDebug: includeExplain,
    });

    res.json({
      success: true,
      data,
      related,
      meta: { ...result.meta, ...rankingMeta },
      pagination: { page, limit },
    });
  } catch (error) {
    console.error("Error searching by image:", error);
    res.status(500).json({ success: false, error: "Failed to search by image" });
  }
}

/**
 * GET /products/:id
 * Single product row + `images[]` (SKU-level fields live on `products`).
 */
export async function getProductById(req: Request, res: Response) {
  try {
    const productId = parseInt(req.params.id, 10);
    if (!Number.isFinite(productId) || productId < 1) {
      return res.status(400).json({ success: false, error: "Invalid product ID" });
    }

    const data = await getProductWithVariants(productId);
    if (!data) {
      return res.status(404).json({ success: false, error: "Product not found" });
    }

    const { product, images } = data;
    res.json({
      success: true,
      data: {
        ...product,
        images: images.map((img) => ({
          id: img.id,
          url: img.cdn_url,
          is_primary: img.is_primary,
          p_hash: img.p_hash ?? undefined,
        })),
      },
    });
  } catch (error) {
    console.error("Error fetching product:", error);
    res.status(500).json({ success: false, error: "Failed to fetch product" });
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
    const { getPriceHistory, getPriceHistoryDaily, getPriceStats } = await import("../../lib/products/index");

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
    const { getAttributeFacets } = await import("./products.service");
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
    const { dropPriceProducts } = await import("./products.service");
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
 *   - clipLimit: candidates from CLIP k-NN (default 120)
 *   - textLimit: candidates from text search (default 120)
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
    const clipLimit = Math.min(Math.max(1, parseInt(req.query.clipLimit as string) || 120), 500);
    const textLimit = Math.min(Math.max(1, parseInt(req.query.textLimit as string) || 120), 500);
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
