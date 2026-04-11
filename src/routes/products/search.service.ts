/**
 * Search Service - Unified text and image search functionality
 *
 * Provides:
 * - Basic product search (text/embedding)
 * - Image search with similarity threshold
 * - Text search with semantic understanding
 * - pHash-based visual similarity
 * - Related products discovery
 */
import {
  pg,
  getProductsByIdsOrdered,
  productsTableHasIsHiddenColumn,
} from "../../lib/core";
import { config } from "../../config";
import { getImagesForProducts } from "./images.service";
import { hammingDistance } from "../../lib/products";
import { searchImage, searchText } from "../../lib/search/fashionSearchFacade";
import type {
  ImageSearchParams,
  TextSearchParams,
  ProductResult,
  SearchResultWithRelated,
} from "./types";

/** @see routes/products/products.service — unified facade (text / image / browse). */
export { searchProducts } from "./products.service";

// ============================================================================
// Image Search with Similarity Threshold
// ============================================================================

/**
 * Search products by image with similarity threshold and optional pHash matching
 * Returns similar images above the threshold, sorted by similarity
 */
export async function searchByImageWithSimilarity(
  params: ImageSearchParams
): Promise<SearchResultWithRelated> {
  const {
    imageEmbedding,
    imageEmbeddingGarment,
    imageBuffer,
    filters = {},
    page = 1,
    limit = 20,
    similarityThreshold = config.clip.imageSimilarityThreshold,
    // Image-analysis (/api/images/search) is the only caller; it only uses k-NN `results`,
    // not pHash "related". Default false avoids an extra Sharp decode that can throw
    // "Invalid input" on some crops while CLIP embedding still succeeds.
    includeRelated = false,
    pHash,
    predictedCategoryAisles,
    detectionYoloConfidence,
    detectionProductCategory,
    softProductTypeHints,
    knnField,
    forceHardCategoryFilter,
    relaxThresholdWhenEmpty,
    blipSignal,
    inferredPrimaryColor,
    inferredColorsByItem,
    inferredColorsByItemConfidence,
    debugRawCosineFirst,
    sessionId,
    userId,
    sessionFilters,
    collapseVariantGroups,
  } = params;

  // Phase 2 alignment: route through the unified canonical facade.
  return searchImage({
    imageEmbedding,
    imageEmbeddingGarment,
    imageBuffer,
    filters,
    limit,
    similarityThreshold,
    includeRelated,
    pHash,
    predictedCategoryAisles,
    detectionYoloConfidence,
    detectionProductCategory,
    softProductTypeHints,
    knnField,
    forceHardCategoryFilter,
    relaxThresholdWhenEmpty,
    blipSignal,
    inferredPrimaryColor,
    inferredColorsByItem,
    inferredColorsByItemConfidence,
    debugRawCosineFirst,
    sessionId,
    userId,
    sessionFilters,
    collapseVariantGroups,
  }) as Promise<SearchResultWithRelated>;
}

// ============================================================================
// pHash-Based Visual Similarity
// ============================================================================

/**
 * Find products with similar pHash (perceptual hash)
 */
export async function findSimilarByPHash(
  pHash: string,
  excludeIds: string[],
  limit: number = 10
): Promise<ProductResult[]> {
  const hasIsHidden = await productsTableHasIsHiddenColumn();
  const hiddenClause = hasIsHidden ? "AND is_hidden = false" : "";
  const excludeNumeric = excludeIds.map((id) => parseInt(id, 10)).filter(Number.isFinite);
  const result = excludeNumeric.length > 0
    ? await pg.query(
        `SELECT id, p_hash FROM products
         WHERE p_hash IS NOT NULL ${hiddenClause}
         AND id != ALL($1::int[])`,
        [excludeNumeric]
      )
    : await pg.query(
        `SELECT id, p_hash FROM products
         WHERE p_hash IS NOT NULL ${hiddenClause}`
      );

  // Calculate Hamming distance and filter similar
  const similar: Array<{ id: number; distance: number }> = [];
  for (const row of result.rows) {
    const distance = hammingDistance(pHash, row.p_hash);
    if (distance <= 12) {
      // ~80% similar (12/64 bits different)
      similar.push({ id: row.id, distance });
    }
  }

  // Sort by similarity (lower distance = more similar)
  similar.sort((a, b) => a.distance - b.distance);
  const topSimilar = similar.slice(0, limit);

  if (topSimilar.length === 0) return [];

  // Fetch product data
  const productIds = topSimilar.map((s) => String(s.id));
  const products = await getProductsByIdsOrdered(productIds);
  const numericIds = topSimilar.map((s) => s.id);
  const imagesByProduct = await getImagesForProducts(numericIds);

  const distanceMap = new Map(topSimilar.map((s) => [s.id, s.distance]));

  return products.map((p: any) => {
    const images = imagesByProduct.get(p.id) || [];
    const distance = distanceMap.get(p.id) || 64;
    return {
      ...p,
      similarity_score: Math.round((1 - distance / 64) * 100) / 100,
      match_type: "related" as const,
      images: images.map((img) => ({
        id: img.id,
        url: img.cdn_url,
        is_primary: img.is_primary,
      })),
    };
  }) as ProductResult[];
}

// ============================================================================
// Text Search with Semantic Understanding
// ============================================================================

/**
 * Search products by text with semantic query understanding
 * - Processes query (spelling correction, arabizi, normalization)
 * - Extracts entities (brands, categories, colors, sizes)
 * - Expands query with synonyms
 * - Classifies intent
 * - Returns related products from same category/brand
 */
export async function searchByTextWithRelated(
  params: TextSearchParams
): Promise<SearchResultWithRelated> {
  const {
    query,
    filters = {},
    page = 1,
    limit = 20,
    includeRelated = true,
    relatedLimit = 10,
    useLLM: _useLLM = false,
  } = params;

  if (!query) {
    return { results: [], meta: { total_results: 0 } };
  }

  // Phase 2 alignment: route through the unified canonical facade.
  // This unifies query understanding + strict filtering behavior across
  // legacy and enhanced endpoints.
  const unified = await searchText({
    query,
    filters,
    page,
    limit,
    includeRelated,
    relatedLimit,
    useEnhanced: true,
  });
  return unified as any;
}

// ============================================================================
// Related Products (shared implementation — query-aware ranking)
// ============================================================================

export {
  findRelatedProducts,
  type FindRelatedProductsOptions,
} from "../../lib/search/relatedProducts";

