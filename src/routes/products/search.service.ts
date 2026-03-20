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
import { osClient } from "../../lib/core";
import {
  pg,
  getProductsByIdsOrdered,
  productsTableHasIsHiddenColumn,
} from "../../lib/core";
import { config } from "../../config";
import { getImagesForProducts } from "./images.service";
import { hammingDistance } from "../../lib/products";
import {
  countEntityMatches,
} from "../../lib/search";
import {
  processQuery,
  processQueryFast,
} from "../../lib/queryProcessor";
import type {
  SearchParams,
  SearchFilters,
  ImageSearchParams,
  TextSearchParams,
  ProductResult,
  SearchResultWithRelated,
} from "./types";

// ============================================================================
// Basic Search
// ============================================================================

/**
 * Search products by title text or image embedding
 * Returns array of products with images
 */
export async function searchProducts(params: SearchParams): Promise<ProductResult[]> {
  const { query, imageEmbedding, filters = {}, page = 1, limit = 20 } = params;

  // Build OpenSearch query
  const must: any[] = [];
  const filter: any[] = [];

  // Always exclude hidden products from public search
  filter.push({ term: { is_hidden: false } });

  // Text search on title
  if (query) {
    must.push({
      multi_match: {
        query,
        fields: ["title^3", "brand^2", "category"],
        fuzziness: "AUTO",
      },
    });
  }

  // Apply filters
  applySearchFilters(filter, filters);

  // Build final query
  let searchBody: any;

  if (imageEmbedding && imageEmbedding.length > 0) {
    // Image-based search (k-NN) with OpenSearch syntax
    searchBody = {
      size: limit,
      query: {
        knn: {
          embedding: {
            vector: imageEmbedding,
            k: limit,
          },
        },
      },
    };

    // Add filters if present
    if (filter.length > 0) {
      searchBody.query = {
        bool: {
          must: {
            knn: {
              embedding: {
                vector: imageEmbedding,
                k: limit,
              },
            },
          },
          filter: filter,
        },
      };
    }
  } else {
    // Text-based search
    searchBody = {
      size: limit,
      from: (page - 1) * limit,
      query: {
        bool: {
          must: must.length > 0 ? must : [{ match_all: {} }],
          filter: filter.length > 0 ? filter : undefined,
        },
      },
    };
  }

  // Execute OpenSearch query
  const osResponse = await osClient.search({
    index: config.opensearch.index,
    body: searchBody,
  });

  // Extract product IDs and scores from OpenSearch results
  const hits = osResponse.body.hits.hits;
  const productIds: string[] = hits.map((hit: any) => hit._source.product_id);
  const scoreMap = new Map<string, number>();
  hits.forEach((hit: any) => {
    scoreMap.set(hit._source.product_id, hit._score);
  });

  if (productIds.length === 0) {
    return [];
  }

  // Fetch full product data from Postgres (preserving OpenSearch order/ranking)
  const products = await getProductsByIdsOrdered(productIds);

  // Fetch images for all products using images.service
  const numericIds = productIds.map((id) => parseInt(id, 10));
  const imagesByProduct = await getImagesForProducts(numericIds);

  // Attach images and scores to products (convert to response format)
  const productsWithImages = products.map((p: any) => {
    const images = imagesByProduct.get(parseInt(p.id, 10)) || [];
    return {
      ...p,
      similarity_score: scoreMap.get(String(p.id)),
      images: images.map((img) => ({
        id: img.id,
        url: img.cdn_url,
        is_primary: img.is_primary,
      })),
    };
  });

  return productsWithImages as ProductResult[];
}

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
    filters = {},
    page = 1,
    limit = 20,
    similarityThreshold = config.clip.similarityThreshold,
    includeRelated = true,
    pHash,
  } = params;

  if (!imageEmbedding || imageEmbedding.length === 0) {
    return { results: [], meta: { threshold: similarityThreshold, total_results: 0 } };
  }

  // Fetch more results than requested to filter by threshold
  const fetchLimit = Math.min(limit * 3, 100);

  // Build filter array
  const filter: any[] = [{ term: { is_hidden: false } }];
  if (filters.category) {
    if (Array.isArray(filters.category)) {
      filter.push({ terms: { category: filters.category } });
    } else {
      filter.push({ term: { category: filters.category } });
    }
  }
  if (filters.brand) filter.push({ term: { brand: filters.brand } });
  if (filters.vendorId) filter.push({ term: { vendor_id: filters.vendorId } });

  // k-NN search with score
  const searchBody: any = {
    size: fetchLimit,
    _source: ["product_id", "title", "brand", "category"],
    query: {
      bool: {
        must: {
          knn: {
            embedding: {
              vector: imageEmbedding,
              k: fetchLimit,
            },
          },
        },
        filter: filter,
      },
    },
  };

  const osResponse = await osClient.search({
    index: config.opensearch.index,
    body: searchBody,
  });

  const hits = osResponse.body.hits.hits;

  // OpenSearch cosinesimil (FAISS) score = (1 + cosine_similarity) / 2
  // Range [0, 1]: 1.0 = identical vectors, 0.5 = orthogonal, 0.0 = opposite.
  // This is already in [0, 1], so we use it directly.
  const toAbsoluteScore = (rawScore: number): number => {
    return Math.max(0, Math.min(1, rawScore));
  };

  const filteredHits = hits.filter((hit: any) => {
    return toAbsoluteScore(hit._score) >= similarityThreshold;
  });

  const productIds = filteredHits.slice(0, limit).map((hit: any) => hit._source.product_id);
  const scoreMap = new Map<string, number>();
  filteredHits.forEach((hit: any) => {
    const score = toAbsoluteScore(hit._score);
    scoreMap.set(hit._source.product_id, Math.round(score * 100) / 100);
  });

  // Fetch product data
  let results: ProductResult[] = [];
  if (productIds.length > 0) {
    const products = await getProductsByIdsOrdered(productIds);
    const numericIds = productIds.map((id: string) => parseInt(id, 10));
    const imagesByProduct = await getImagesForProducts(numericIds);

    results = products.map((p: any) => {
      const images = imagesByProduct.get(parseInt(p.id, 10)) || [];
      return {
        ...p,
        similarity_score: scoreMap.get(String(p.id)),
        match_type: scoreMap.get(String(p.id))! >= 0.95 ? "exact" : "similar",
        images: images.map((img) => ({
          id: img.id,
          url: img.cdn_url,
          is_primary: img.is_primary,
        })),
      };
    }) as ProductResult[];
  }

  // Find additional related products by pHash if provided
  let related: ProductResult[] = [];
  if (includeRelated && pHash) {
    related = await findSimilarByPHash(pHash, productIds, limit);
  }

  return {
    results,
    related: related.length > 0 ? related : undefined,
    meta: {
      threshold: similarityThreshold,
      total_results: results.length,
      total_related: related.length,
    },
  };
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
    useLLM = false,
  } = params;

  if (!query) {
    return { results: [], meta: { total_results: 0 } };
  }

  // Single-pass query processing (spelling, arabizi, entity extraction, intent)
  const processed = useLLM ? await processQuery(query) : await processQueryFast(query);
  const effectiveQuery = processed.searchQuery;

  // Use AST entities directly — no second parseQuery call needed
  const entities = {
    brands: processed.entities.brands || [],
    categories: processed.entities.categories || [],
    colors: processed.entities.colors || [],
    sizes: processed.entities.sizes || [],
    priceRange: processed.filters?.priceRange,
    attributes: [
      ...(processed.entities.materials || []),
      ...(processed.entities.patterns || []),
    ],
  };
  const expandedTerms = [
    ...processed.expansions.synonyms,
    ...processed.expansions.categoryExpansions,
    ...processed.expansions.corrections,
  ];
  const semanticQuery = effectiveQuery;

  // Merge extracted filters with explicit filters (explicit takes precedence)
  const mergedFilters = {
    ...filters,
    gender: filters.gender || processed.entities.gender,
    color: filters.color || processed.entities.colors[0],
    brand: filters.brand || processed.entities.brands[0],
    category: filters.category || processed.entities.categories[0],
  };

  // Build filter array - ONLY explicit user-provided filters go here
  const filter: any[] = [{ term: { is_hidden: false } }];

  // ⭐ IMPORTANT: Only apply strict filters for EXPLICIT (user-provided) criteria
  // Extracted entities (like categories from "blazer" → "outerwear") should be used for BOOSTING, not filtering
  const effectiveBrand = mergedFilters.brand; // Only if user explicitly provided
  const effectiveCategory = mergedFilters.category; // Only if user explicitly provided

  if (effectiveBrand) filter.push({ term: { brand: effectiveBrand } });
  if (effectiveCategory) filter.push({ term: { category: effectiveCategory } });
  if (mergedFilters.vendorId) filter.push({ term: { vendor_id: mergedFilters.vendorId } });

  // Apply extracted attribute filters (these are from explicit params, not query extraction)
  if (mergedFilters.gender) filter.push({ term: { attr_gender: mergedFilters.gender } });
  if (mergedFilters.color) filter.push({ term: { attr_color: mergedFilters.color } });

  // Apply price filter from explicit params or extracted entities
  applyPriceFilter(filter, mergedFilters, entities);

  // Build semantic-aware query with expanded terms + extracted entities as boosts
  const should: any[] = buildSemanticShouldClauses(semanticQuery, expandedTerms, entities);

  const searchBody = {
    size: limit,
    from: (page - 1) * limit,
    query: {
      bool: {
        should,
        filter,
        minimum_should_match: 1,
      },
    },
  };

  const osResponse = await osClient.search({
    index: config.opensearch.index,
    body: searchBody,
  });

  const hits = osResponse.body.hits.hits;
  const productIds = hits.map((hit: any) => hit._source.product_id);
  const maxScore = hits.length > 0 ? hits[0]._score : 1;

  const scoreMap = new Map<string, number>();
  hits.forEach((hit: any) => {
    scoreMap.set(hit._source.product_id, Math.round((hit._score / maxScore) * 100) / 100);
  });

  // Fetch main results
  let results: ProductResult[] = [];
  let extractedBrands: string[] = entities.brands;
  let extractedCategories: string[] = entities.categories;

  if (productIds.length > 0) {
    const products = await getProductsByIdsOrdered(productIds);
    const numericIds = productIds.map((id: string) => parseInt(id, 10));
    const imagesByProduct = await getImagesForProducts(numericIds);

    // Also extract brands/categories from results for related search
    const resultBrands = [
      ...new Set(products.map((p: any) => p.brand?.toLowerCase()).filter(Boolean)),
    ];
    const resultCategories = [
      ...new Set(products.map((p: any) => p.category?.toLowerCase()).filter(Boolean)),
    ];
    extractedBrands = [...new Set([...extractedBrands, ...resultBrands])];
    extractedCategories = [...new Set([...extractedCategories, ...resultCategories])];

    results = products.map((p: any) => {
      const images = imagesByProduct.get(parseInt(p.id, 10)) || [];
      const baseScore = scoreMap.get(String(p.id)) || 0;

      // Boost score based on entity matches
      const entityMatches = countEntityMatches(
        { brand: p.brand, category: p.category, title: p.title },
        entities
      );
      const boostedScore = Math.min(1, baseScore * (1 + entityMatches * 0.1));

      return {
        ...p,
        similarity_score: Math.round(boostedScore * 100) / 100,
        match_type: boostedScore >= 0.8 ? "exact" : "similar",
        images: images.map((img) => ({
          id: img.id,
          url: img.cdn_url,
          is_primary: img.is_primary,
        })),
      };
    }) as ProductResult[];
  }

  // Find related products (same category or brand, not in main results)
  let related: ProductResult[] = [];
  if (includeRelated && (extractedBrands.length > 0 || extractedCategories.length > 0)) {
    related = await findRelatedProducts(productIds, extractedBrands, extractedCategories, relatedLimit);
  }

  return {
    results,
    related: related.length > 0 ? related : undefined,
    meta: {
      query: effectiveQuery,
      total_results: results.length,
      total_related: related.length,
      processed_query: processed,
      did_you_mean: processed.corrections.length > 0 && processed.confidence < 0.85
        ? `Did you mean "${processed.searchQuery}"?`
        : undefined,
    },
  };
}

// ============================================================================
// Related Products
// ============================================================================

/**
 * Find related products by category and brand
 */
export async function findRelatedProducts(
  excludeIds: string[],
  brands: string[],
  categories: string[],
  limit: number
): Promise<ProductResult[]> {
  const excludeNumericIds = excludeIds.map((id) => parseInt(id, 10));

  // Build OR conditions for brands and categories
  const should: any[] = [];
  if (brands.length > 0) {
    should.push({ terms: { brand: brands } });
  }
  if (categories.length > 0) {
    should.push({ terms: { category: categories } });
  }

  if (should.length === 0) return [];

  const searchBody = {
    size: limit,
    query: {
      bool: {
        must: [{ term: { is_hidden: false } }],
        should: should,
        minimum_should_match: 1,
        must_not:
          excludeNumericIds.length > 0 ? { terms: { product_id: excludeIds } } : undefined,
      },
    },
    sort: [{ _score: "desc" }, { price_usd: "asc" }],
  };

  const osResponse = await osClient.search({
    index: config.opensearch.index,
    body: searchBody,
  });

  const hits = osResponse.body.hits.hits;
  const productIds = hits.map((hit: any) => hit._source.product_id);

  if (productIds.length === 0) return [];

  const products = await getProductsByIdsOrdered(productIds);
  const numericIds = productIds.map((id: string) => parseInt(id, 10));
  const imagesByProduct = await getImagesForProducts(numericIds);

  return products.map((p: any) => {
    const images = imagesByProduct.get(parseInt(p.id, 10)) || [];
    return {
      ...p,
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
// Internal Helpers
// ============================================================================

const LBP_TO_USD = 89000;

/**
 * Apply common search filters to filter array
 */
function applySearchFilters(filter: any[], filters: SearchFilters): void {
  if (filters.category) {
    if (Array.isArray(filters.category)) {
      filter.push({ terms: { category: filters.category } });
    } else {
      filter.push({ term: { category: filters.category } });
    }
  }
  if (filters.brand) {
    filter.push({ term: { brand: filters.brand } });
  }
  if (filters.vendorId) {
    filter.push({ term: { vendor_id: filters.vendorId } });
  }
  if (filters.availability !== undefined) {
    filter.push({
      term: { availability: filters.availability ? "in_stock" : "out_of_stock" },
    });
  }
  if (filters.minPriceCents !== undefined || filters.maxPriceCents !== undefined) {
    const range: any = {};
    const currency = filters.currency?.toUpperCase() || "LBP";

    if (currency === "USD") {
      // Input is already in USD cents, convert to dollars
      if (filters.minPriceCents !== undefined) range.gte = filters.minPriceCents / 100;
      if (filters.maxPriceCents !== undefined) range.lte = filters.maxPriceCents / 100;
    } else {
      // Input is in LBP cents, convert to USD for OpenSearch
      if (filters.minPriceCents !== undefined)
        range.gte = Math.floor(filters.minPriceCents / LBP_TO_USD);
      if (filters.maxPriceCents !== undefined)
        range.lte = Math.ceil(filters.maxPriceCents / LBP_TO_USD);
    }
    filter.push({ range: { price_usd: range } });
  }

  // Attribute filters (extracted from titles)
  if (filters.color) filter.push({ term: { attr_color: filters.color } });
  if (filters.material) filter.push({ term: { attr_material: filters.material } });
  if (filters.fit) filter.push({ term: { attr_fit: filters.fit } });
  if (filters.style) filter.push({ term: { attr_style: filters.style } });
  if (filters.gender) filter.push({ term: { attr_gender: filters.gender } });
  if (filters.pattern) filter.push({ term: { attr_pattern: filters.pattern } });
}

/**
 * Apply price filter from merged filters or extracted entities
 */
function applyPriceFilter(filter: any[], mergedFilters: SearchFilters, entities: any): void {
  if (mergedFilters.minPriceCents !== undefined || mergedFilters.maxPriceCents !== undefined) {
    const range: any = {};
    const currency = mergedFilters.currency?.toUpperCase() || "LBP";
    if (currency === "USD") {
      if (mergedFilters.minPriceCents !== undefined)
        range.gte = mergedFilters.minPriceCents / 100;
      if (mergedFilters.maxPriceCents !== undefined)
        range.lte = mergedFilters.maxPriceCents / 100;
    } else {
      if (mergedFilters.minPriceCents !== undefined)
        range.gte = Math.floor(mergedFilters.minPriceCents / LBP_TO_USD);
      if (mergedFilters.maxPriceCents !== undefined)
        range.lte = Math.ceil(mergedFilters.maxPriceCents / LBP_TO_USD);
    }
    filter.push({ range: { price_usd: range } });
  } else if (entities.priceRange) {
    const range: any = {};
    if (entities.priceRange.min) range.gte = entities.priceRange.min;
    if (entities.priceRange.max) range.lte = entities.priceRange.max;
    filter.push({ range: { price_usd: range } });
  }
}

/**
 * Build semantic should clauses for text search
 */
function buildSemanticShouldClauses(
  semanticQuery: string,
  expandedTerms: string[],
  entities: any
): any[] {
  const should: any[] = [
    // Primary: semantic query (entities + cleaned query)
    {
      multi_match: {
        query: semanticQuery,
        fields: ["title^3", "brand^2", "category", "description"],
        fuzziness: "AUTO",
        type: "best_fields",
        boost: 2,
      },
    },
  ];

  // Add expanded terms (synonyms, related words)
  if (expandedTerms.length > 0) {
    should.push({
      multi_match: {
        query: expandedTerms.join(" "),
        fields: ["title^2", "description"],
        fuzziness: "AUTO",
        operator: "or",
        boost: 0.8,
      },
    });
  }

  // 🔑 BOOST extracted categories (soft matching, not filtering)
  // This allows "blazer" to match outerwear products even if category field doesn't match exactly
  if (entities.categories.length > 0) {
    should.push({
      terms: { category: entities.categories, boost: 1.2 },
    });
  }

  // 🔑 BOOST extracted brands (soft matching)
  if (entities.brands.length > 1) {
    should.push({
      terms: { brand: entities.brands, boost: 1.5 },
    });
  }

  // Boost color matches in title
  for (const color of entities.colors) {
    should.push({
      match: { title: { query: color, boost: 1.5 } },
    });
  }

  // Boost style/attribute matches
  for (const attr of entities.attributes) {
    should.push({
      match: { title: { query: attr, boost: 1.3 } },
    });
  }

  return should;
}
