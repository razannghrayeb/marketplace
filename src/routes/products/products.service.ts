import { osClient } from "../../lib/opensearch";
import { pg, getProductsByIdsOrdered } from "../../lib/db";
import { config } from "../../config";
import { getImagesForProducts, ProductImageResponse } from "./images.service";
import { hammingDistance } from "../../lib/canonical";

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
// Enhanced Text Search with Related Products
// ============================================================================

/**
 * Search products by text with related products from same category/brand
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
  } = params;

  if (!query) {
    return { results: [], meta: { total_results: 0 } };
  }

  // Build filter array
  const filter: any[] = [{ term: { is_hidden: false } }];
  if (filters.category) filter.push({ term: { category: filters.category } });
  if (filters.brand) filter.push({ term: { brand: filters.brand } });
  if (filters.vendorId) filter.push({ term: { vendor_id: filters.vendorId } });

  // Main text search with multi-match
  const searchBody = {
    size: limit,
    from: (page - 1) * limit,
    query: {
      bool: {
        must: {
          multi_match: {
            query,
            fields: ["title^3", "brand^2", "category", "description"],
            fuzziness: "AUTO",
            operator: "or",
            minimum_should_match: "50%",
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
  const productIds = hits.map((hit: any) => hit._source.product_id);
  const maxScore = hits.length > 0 ? hits[0]._score : 1;
  
  const scoreMap = new Map<string, number>();
  hits.forEach((hit: any) => {
    scoreMap.set(hit._source.product_id, Math.round((hit._score / maxScore) * 100) / 100);
  });

  // Fetch main results
  let results: ProductResult[] = [];
  let extractedBrands: string[] = [];
  let extractedCategories: string[] = [];

  if (productIds.length > 0) {
    const products = await getProductsByIdsOrdered(productIds);
    const numericIds = productIds.map((id: string) => parseInt(id, 10));
    const imagesByProduct = await getImagesForProducts(numericIds);

    // Extract brands and categories for related search
    extractedBrands = [...new Set(products.map((p: any) => p.brand).filter(Boolean))];
    extractedCategories = [...new Set(products.map((p: any) => p.category).filter(Boolean))];

    results = products.map((p: any) => {
      const images = imagesByProduct.get(parseInt(p.id, 10)) || [];
      const score = scoreMap.get(String(p.id)) || 0;
      return {
        ...p,
        similarity_score: score,
        match_type: score >= 0.8 ? "exact" : "similar",
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
      query,
      total_results: results.length,
      total_related: related.length,
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
// Original Functions (backward compatible)
// ============================================================================

/**
 * Search products by title text
 */
export async function searchByTitle(
  title: string,
  filters?: SearchFilters,
  page?: number,
  limit?: number
): Promise<ProductResult[]> {
  return searchProducts({ query: title, filters, page, limit });
}

/**
 * Search products by image embedding (vector similarity)
 */
export async function searchByImage(
  embedding: number[],
  filters?: SearchFilters,
  page?: number,
  limit?: number
): Promise<ProductResult[]> {
  return searchProducts({ imageEmbedding: embedding, filters, page, limit });
}

/**
 * Get all products with optional filters
 */
export async function getProducts(
  filters?: SearchFilters,
  page?: number,
  limit?: number
): Promise<ProductResult[]> {
  return searchProducts({ filters, page, limit });
}
