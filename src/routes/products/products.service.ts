import { osClient } from "../../lib/core/index.js";
import { pg, getProductsByIdsOrdered } from "../../lib/core/index.js";
import { config } from "../../config";
import { getImagesForProducts, ProductImageResponse } from "./images.service";
import { hammingDistance } from "../../lib/products";
import { 
  parseQuery, 
  buildSemanticOpenSearchQuery, 
  countEntityMatches,
  calculateHybridScore,
  ParsedQuery,
  QueryEntities,
} from "../../lib/search";
import {
  processQuery,
  processQuerySync,
  getQueryEmbedding,
  ProcessedQuery,
} from "../../lib/queryProcessor";

// ============================================================================
// Types
// ============================================================================

export interface SearchFilters {
  category?: string;
  brand?: string;
  minPriceCents?: number;
  maxPriceCents?: number;
  currency?: string;  // 'LBP' or 'USD' - defaults to LBP
  availability?: boolean;
  vendorId?: string;
  // Attribute filters (extracted from titles)
  color?: string;
  material?: string;
  fit?: string;
  style?: string;
  gender?: string;
  pattern?: string;
}

export interface SearchParams {
  query?: string;           // Text search (title)
  imageEmbedding?: number[]; // Vector search (image embedding)
  filters?: SearchFilters;
  page?: number;
  limit?: number;
}

export interface ImageSearchParams extends SearchParams {
  similarityThreshold?: number;  // 0-1, default 0.7 (70% similarity)
  includeRelated?: boolean;      // Include related by pHash
  pHash?: string;                // Optional pHash for visual similarity
}

export interface TextSearchParams extends SearchParams {
  includeRelated?: boolean;      // Include related products (same category/brand)
  relatedLimit?: number;         // Max related products to return
  useLLM?: boolean;              // Allow LLM for ambiguous queries (default false)
}

export interface ProductResult {
  id: string;
  vendor_id: string;
  title: string;
  brand: string | null;
  category: string | null;
  description: string | null;
  size: string | null;
  color: string | null;
  currency: string;
  price_cents: number;
  sales_price_cents: number | null;
  availability: boolean;
  last_seen: Date;
  image_url?: string;
  image_cdn?: string;
  images?: Array<{ id: number; url: string; is_primary: boolean }>;
  similarity_score?: number;     // For image search results
  match_type?: "exact" | "similar" | "related";  // How the product matched
}

export interface SearchResultWithRelated {
  results: ProductResult[];
  related?: ProductResult[];
  meta: {
    query?: string;
    threshold?: number;
    total_results: number;
    total_related?: number;
    parsed_query?: ParsedQuery;  // Include parsed query info for debugging/transparency
    processed_query?: ProcessedQuery;  // Query processing info (corrections, etc.)
    did_you_mean?: string;  // Suggestion if not auto-applied
  };
}

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
  if (filters.category) {
    filter.push({ term: { category: filters.category } });
  }
  if (filters.brand) {
    filter.push({ term: { brand: filters.brand } });
  }
  if (filters.vendorId) {
    filter.push({ term: { vendor_id: filters.vendorId } });
  }
  if (filters.availability !== undefined) {
    filter.push({ term: { availability: filters.availability ? "in_stock" : "out_of_stock" } });
  }
  if (filters.minPriceCents !== undefined || filters.maxPriceCents !== undefined) {
    const range: any = {};
    const currency = filters.currency?.toUpperCase() || 'LBP';
    const LBP_TO_USD = 89000; // Exchange rate

    if (currency === 'USD') {
      // Input is already in USD cents, convert to dollars
      if (filters.minPriceCents !== undefined) range.gte = filters.minPriceCents / 100;
      if (filters.maxPriceCents !== undefined) range.lte = filters.maxPriceCents / 100;
    } else {
      // Input is in LBP cents, convert to USD for OpenSearch
      if (filters.minPriceCents !== undefined) range.gte = Math.floor(filters.minPriceCents / LBP_TO_USD);
      if (filters.maxPriceCents !== undefined) range.lte = Math.ceil(filters.maxPriceCents / LBP_TO_USD);
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
// Enhanced Image Search with Similarity Threshold
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
    similarityThreshold = 0.7,  // Default 70% similarity
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
  if (filters.category) filter.push({ term: { category: filters.category } });
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
  
  // OpenSearch k-NN scores are cosine similarity (0-1 for normalized vectors)
  // Filter by threshold and normalize scores
  const maxScore = hits.length > 0 ? hits[0]._score : 1;
  
  const filteredHits = hits.filter((hit: any) => {
    const normalizedScore = hit._score / maxScore;
    return normalizedScore >= similarityThreshold;
  });

  const productIds = filteredHits.slice(0, limit).map((hit: any) => hit._source.product_id);
  const scoreMap = new Map<string, number>();
  filteredHits.forEach((hit: any) => {
    const normalizedScore = hit._score / maxScore;
    scoreMap.set(hit._source.product_id, Math.round(normalizedScore * 100) / 100);
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

/**
 * Find products with similar pHash (perceptual hash)
 */
async function findSimilarByPHash(
  pHash: string,
  excludeIds: string[],
  limit: number = 10
): Promise<ProductResult[]> {
  // Get all products with pHash
  const result = await pg.query(
    `SELECT id, p_hash FROM products 
     WHERE p_hash IS NOT NULL AND is_hidden = false 
     ${excludeIds.length > 0 ? `AND id NOT IN (${excludeIds.map(id => parseInt(id, 10)).join(",")})` : ""}`
  );

  // Calculate Hamming distance and filter similar
  const similar: Array<{ id: number; distance: number }> = [];
  for (const row of result.rows) {
    const distance = hammingDistance(pHash, row.p_hash);
    if (distance <= 12) { // ~80% similar (12/64 bits different)
      similar.push({ id: row.id, distance });
    }
  }

  // Sort by similarity (lower distance = more similar)
  similar.sort((a, b) => a.distance - b.distance);
  const topSimilar = similar.slice(0, limit);

  if (topSimilar.length === 0) return [];

  // Fetch product data
  const productIds = topSimilar.map(s => String(s.id));
  const products = await getProductsByIdsOrdered(productIds);
  const numericIds = topSimilar.map(s => s.id);
  const imagesByProduct = await getImagesForProducts(numericIds);

  const distanceMap = new Map(topSimilar.map(s => [s.id, s.distance]));

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
// Enhanced Text Search with Semantic Query Understanding
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

  // Step 1: Process query (spelling, arabizi, normalization)
  const processed = useLLM 
    ? await processQuery(query)
    : processQuerySync(query);
  
  // Use the search query (auto-corrected or original based on confidence)
  const effectiveQuery = processed.searchQuery;
  
  // Merge extracted filters with explicit filters (explicit takes precedence)
  const mergedFilters = {
    ...filters,
    gender: filters.gender || processed.extractedFilters.gender,
    color: filters.color || processed.extractedFilters.color,
    brand: filters.brand || processed.extractedFilters.brand,
    category: filters.category || processed.extractedFilters.category,
  };

  // Parse query with semantic understanding
  const parsedQuery = parseQuery(effectiveQuery);
  const { entities, expandedTerms, semanticQuery, intent } = parsedQuery;

  // Build filter array - combine explicit filters with extracted entities
  const filter: any[] = [{ term: { is_hidden: false } }];
  
  // Use explicit filter OR extracted entity
  const effectiveBrand = mergedFilters.brand || (entities.brands.length === 1 ? entities.brands[0] : undefined);
  const effectiveCategory = mergedFilters.category || (entities.categories.length === 1 ? entities.categories[0] : undefined);
  
  if (effectiveBrand) filter.push({ term: { brand: effectiveBrand } });
  if (effectiveCategory) filter.push({ term: { category: effectiveCategory } });
  if (mergedFilters.vendorId) filter.push({ term: { vendor_id: mergedFilters.vendorId } });
  
  // Apply extracted attribute filters
  if (mergedFilters.gender) filter.push({ term: { attr_gender: mergedFilters.gender } });
  if (mergedFilters.color) filter.push({ term: { attr_color: mergedFilters.color } });

  // Apply price filter from explicit params or extracted entities
  if (mergedFilters.minPriceCents !== undefined || mergedFilters.maxPriceCents !== undefined) {
    const range: any = {};
    const currency = mergedFilters.currency?.toUpperCase() || 'LBP';
    const LBP_TO_USD = 89000;
    if (currency === 'USD') {
      if (mergedFilters.minPriceCents !== undefined) range.gte = mergedFilters.minPriceCents / 100;
      if (mergedFilters.maxPriceCents !== undefined) range.lte = mergedFilters.maxPriceCents / 100;
    } else {
      if (mergedFilters.minPriceCents !== undefined) range.gte = Math.floor(mergedFilters.minPriceCents / LBP_TO_USD);
      if (mergedFilters.maxPriceCents !== undefined) range.lte = Math.ceil(mergedFilters.maxPriceCents / LBP_TO_USD);
    }
    filter.push({ range: { price_usd: range } });
  } else if (entities.priceRange) {
    const range: any = {};
    if (entities.priceRange.min) range.gte = entities.priceRange.min;
    if (entities.priceRange.max) range.lte = entities.priceRange.max;
    filter.push({ range: { price_usd: range } });
  }

  // Build semantic-aware query with expanded terms
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

  // Multiple brand search (if more than one brand mentioned)
  if (entities.brands.length > 1) {
    should.push({
      terms: { brand: entities.brands, boost: 2 },
    });
  }

  // Multiple category search
  if (entities.categories.length > 1) {
    should.push({
      terms: { category: entities.categories, boost: 1.5 },
    });
  }

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
    const resultBrands = [...new Set(products.map((p: any) => p.brand?.toLowerCase()).filter(Boolean))];
    const resultCategories = [...new Set(products.map((p: any) => p.category?.toLowerCase()).filter(Boolean))];
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
    related = await findRelatedProducts(
      productIds,
      extractedBrands,
      extractedCategories,
      relatedLimit
    );
  }

  return {
    results,
    related: related.length > 0 ? related : undefined,
    meta: {
      query: effectiveQuery,
      total_results: results.length,
      total_related: related.length,
      parsed_query: parsedQuery,
      processed_query: processed,
      did_you_mean: processed.suggestText,
    },
  };
}

/**
 * Find related products by category and brand
 */
async function findRelatedProducts(
  excludeIds: string[],
  brands: string[],
  categories: string[],
  limit: number
): Promise<ProductResult[]> {
  const excludeNumericIds = excludeIds.map(id => parseInt(id, 10));
  
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
        must_not: excludeNumericIds.length > 0 
          ? { terms: { product_id: excludeIds } }
          : undefined,
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
// Facets / Aggregations
// ============================================================================

export interface AttributeFacets {
  colors: Array<{ value: string; count: number }>;
  materials: Array<{ value: string; count: number }>;
  fits: Array<{ value: string; count: number }>;
  styles: Array<{ value: string; count: number }>;
  genders: Array<{ value: string; count: number }>;
  patterns: Array<{ value: string; count: number }>;
  brands: Array<{ value: string; count: number }>;
  categories: Array<{ value: string; count: number }>;
}

/**
 * Get available attribute values (facets) for filtering
 * Respects current filters to show relevant options
 */
export async function getAttributeFacets(filters: SearchFilters = {}): Promise<AttributeFacets> {
  // Build filter array based on current filters
  const filter: any[] = [{ term: { is_hidden: false } }];
  
  if (filters.category) filter.push({ term: { category: filters.category } });
  if (filters.brand) filter.push({ term: { brand: filters.brand } });
  if (filters.color) filter.push({ term: { attr_color: filters.color } });
  if (filters.material) filter.push({ term: { attr_material: filters.material } });
  if (filters.fit) filter.push({ term: { attr_fit: filters.fit } });
  if (filters.style) filter.push({ term: { attr_style: filters.style } });
  if (filters.gender) filter.push({ term: { attr_gender: filters.gender } });
  if (filters.pattern) filter.push({ term: { attr_pattern: filters.pattern } });

  const searchBody = {
    size: 0,  // No hits, just aggregations
    query: {
      bool: { filter },
    },
    aggs: {
      colors: { terms: { field: "attr_color", size: 50, missing: "__none__" } },
      materials: { terms: { field: "attr_material", size: 50, missing: "__none__" } },
      fits: { terms: { field: "attr_fit", size: 30, missing: "__none__" } },
      styles: { terms: { field: "attr_style", size: 30, missing: "__none__" } },
      genders: { terms: { field: "attr_gender", size: 10, missing: "__none__" } },
      patterns: { terms: { field: "attr_pattern", size: 30, missing: "__none__" } },
      brands: { terms: { field: "brand", size: 100, missing: "__none__" } },
      categories: { terms: { field: "category", size: 50, missing: "__none__" } },
    },
  };

  const osResponse = await osClient.search({
    index: config.opensearch.index,
    body: searchBody,
  });

  const aggs = osResponse.body.aggregations;

  // Transform aggregation results, filtering out __none__ bucket
  const transformBuckets = (buckets: any[]) =>
    buckets
      .filter((b: any) => b.key !== "__none__")
      .map((b: any) => ({ value: b.key, count: b.doc_count }));

  return {
    colors: transformBuckets(aggs.colors?.buckets || []),
    materials: transformBuckets(aggs.materials?.buckets || []),
    fits: transformBuckets(aggs.fits?.buckets || []),
    styles: transformBuckets(aggs.styles?.buckets || []),
    genders: transformBuckets(aggs.genders?.buckets || []),
    patterns: transformBuckets(aggs.patterns?.buckets || []),
    brands: transformBuckets(aggs.brands?.buckets || []),
    categories: transformBuckets(aggs.categories?.buckets || []),
  };
}
export async function dropPriceProducts() {
  const res = await pg.query(
    `SELECT 
       e.id,
       e.product_id, 
       e.old_price_cents, 
       e.new_price_cents, 
       e.drop_percent, 
       e.detected_at,
       p.title,
       p.brand,
       p.image_cdn
     FROM price_drop_events e
     JOIN products p ON p.id = e.product_id
     WHERE e.detected_at > NOW() - INTERVAL '7 days'
     ORDER BY e.drop_percent DESC, e.detected_at DESC
     LIMIT 50`
  );
  return res.rows;
}
// Backwards-compatible wrappers removed — use the richer functions:
// - searchByTextWithRelated
// - searchByImageWithSimilarity
// - searchProducts (generic)
