/**
 * Search Service
 * 
 * Business logic for product search functionality with composite query support.
 */

import { getPool } from '../../lib/core/db';
import { getOpenSearchClient } from '../../lib/core/opensearch';
import { IntentParserService, ParsedIntent } from '../../lib/prompt/gemeni';
import { CompositeQueryBuilder, CompositeQuery } from '../../lib/query/compositeQueryBuilder';
import { QueryMapper, SearchQueryBundle } from '../../lib/query/queryMapper';
import { generateEmbedding } from '../../lib/image/clip';

export interface SearchFilters {
  brand?: string;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  color?: string;
  size?: string;
  vendorId?: number;
}

export interface SearchResult {
  results: any[];
  total: number;
  tookMs: number;
  explanation?: string;
  compositeQuery?: CompositeQuery;
}

export interface MultiImageSearchRequest {
  images: Buffer[];
  userPrompt: string;
  limit?: number;
}

// Initialize services
const queryBuilder = new CompositeQueryBuilder();
const queryMapper = new QueryMapper();

/**
 * Text-based product search with OpenSearch
 */
export async function textSearch(
  query: string,
  filters?: SearchFilters,
  options?: { limit?: number; offset?: number }
): Promise<SearchResult> {
  const startTime = Date.now();
  const limit = options?.limit || 50;
  const offset = options?.offset || 0;

  try {
    const opensearch = getOpenSearchClient();
    
    // Build OpenSearch query
    const searchQuery: any = {
      query: {
        bool: {
          must: [
            {
              multi_match: {
                query,
                fields: ['name^3', 'description^2', 'category', 'brand'],
                fuzziness: 'AUTO',
              },
            },
          ],
          filter: [],
        },
      },
      from: offset,
      size: limit,
      _source: ['id', 'name', 'brand', 'price', 'image_url', 'category'],
    };

    // Apply filters
    if (filters?.category) {
      searchQuery.query.bool.filter.push({ term: { category: filters.category.toLowerCase() } });
    }
    if (filters?.brand) {
      searchQuery.query.bool.filter.push({ term: { brand: filters.brand.toLowerCase() } });
    }
    if (filters?.minPrice || filters?.maxPrice) {
      const priceRange: any = { range: { price: {} } };
      if (filters.minPrice) priceRange.range.price.gte = filters.minPrice;
      if (filters.maxPrice) priceRange.range.price.lte = filters.maxPrice;
      searchQuery.query.bool.filter.push(priceRange);
    }

    // Execute search
    const response = await opensearch.search({
      index: 'products',
      body: searchQuery,
    });

    const results = response.body.hits.hits.map((hit: any) => ({
      id: hit._source.id,
      name: hit._source.name,
      brand: hit._source.brand,
      price: hit._source.price,
      imageUrl: hit._source.image_url,
      category: hit._source.category,
      score: hit._score,
    }));

    return {
      results,
      total: response.body.hits.total.value,
      tookMs: Date.now() - startTime,
    };
  } catch (error) {
    console.error('[textSearch] Error:', error);
    return { results: [], total: 0, tookMs: Date.now() - startTime };
  }
}

/**
 * Image-based similarity search using CLIP embeddings
 */
export async function imageSearch(
  imageBuffer: Buffer,
  options?: { limit?: number }
): Promise<SearchResult> {
  const startTime = Date.now();
  const limit = options?.limit || 50;

  try {
    // Generate embedding for the image
    const embedding = await generateEmbedding(imageBuffer);

    // Search OpenSearch with kNN
    const opensearch = getOpenSearchClient();
    const response = await opensearch.search({
      index: 'products',
      body: {
        size: limit,
        query: {
          knn: {
            embedding: {
              vector: embedding,
              k: limit,
            },
          },
        },
        _source: ['id', 'name', 'brand', 'price', 'image_url', 'category'],
      },
    });

    const results = response.body.hits.hits.map((hit: any) => ({
      id: hit._source.id,
      name: hit._source.name,
      brand: hit._source.brand,
      price: hit._source.price,
      imageUrl: hit._source.image_url,
      category: hit._source.category,
      score: hit._score,
    }));

    return {
      results,
      total: response.body.hits.total.value,
      tookMs: Date.now() - startTime,
    };
  } catch (error) {
    console.error('[imageSearch] Error:', error);
    return { results: [], total: 0, tookMs: Date.now() - startTime };
  }
}

/**
 * Multi-image composite search with intent parsing
 * This is the main entry point for the new composite query system
 */
export async function multiImageSearch(
  request: MultiImageSearchRequest
): Promise<SearchResult> {
  const startTime = Date.now();
  const { images, userPrompt, limit = 50 } = request;

  try {
    // Step 1: Parse user intent from images + text
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    const intentParser = new IntentParserService({ apiKey });
    const parsedIntent = await intentParser.parseUserIntent(images, userPrompt);

    // Step 2: Generate embeddings for all images
    const imageEmbeddings = await Promise.all(
      images.map(img => generateEmbedding(img))
    );

    // Step 3: Build composite query
    const compositeQuery = await queryBuilder.buildQuery(parsedIntent, imageEmbeddings);

    // Step 4: Map to search engine queries
    const queryBundle = queryMapper.mapQuery(compositeQuery, {
      maxResults: limit,
      vectorWeight: 0.6,
      filterWeight: 0.3,
      priceWeight: 0.1,
    });

    // Step 5: Execute OpenSearch query
    const opensearch = getOpenSearchClient();
    const response = await opensearch.search({
      index: 'products',
      body: queryBundle.opensearch,
    });

    // Step 6: Hydrate results from PostgreSQL with additional filters
    const productIds = response.body.hits.hits.map((hit: any) => hit._source.id);
    const hydratedResults = await hydrateProductDetails(
      productIds,
      queryBundle.sqlFilters
    );

    // Step 7: Merge scores and rank
    const results = response.body.hits.hits
      .map((hit: any) => {
        const hydrated = hydratedResults.find((p: any) => p.id === hit._source.id);
        return hydrated
          ? {
              ...hydrated,
              vectorScore: hit._score,
              compositeScore: calculateCompositeScore(
                hit._score,
                hydrated,
                compositeQuery,
                queryBundle.hybridScore
              ),
            }
          : null;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => b.compositeScore - a.compositeScore);

    return {
      results,
      total: response.body.hits.total.value,
      tookMs: Date.now() - startTime,
      explanation: compositeQuery.explanation,
      compositeQuery,
    };
  } catch (error) {
    console.error('[multiImageSearch] Error:', error);
    return { results: [], total: 0, tookMs: Date.now() - startTime };
  }
}

/**
 * Hydrate product details from PostgreSQL
 */
async function hydrateProductDetails(
  productIds: number[],
  sqlFilters: any[]
): Promise<any[]> {
  if (productIds.length === 0) return [];

  const pool = getPool();
  
  const query = `
    SELECT 
      p.id, p.name, p.brand, p.price, p.image_url, p.category,
      p.attributes, p.description, p.vendor_id, p.size, p.gender
    FROM products p
    WHERE p.id = ANY($1)
  `;

  const result = await pool.query(query, [productIds]);
  return result.rows;
}

/**
 * Calculate composite score from multiple factors
 */
function calculateCompositeScore(
  vectorScore: number,
  product: any,
  query: CompositeQuery,
  weights: { vectorWeight: number; filterWeight: number; priceWeight: number }
): number {
  let score = 0;

  // Vector similarity component
  score += weights.vectorWeight * vectorScore;

  // Attribute filter match component
  let filterMatchScore = 0;
  for (const filter of query.filters) {
    const productValue = product.attributes?.[filter.attribute];
    if (productValue && filter.values.some(v => productValue.includes(v))) {
      filterMatchScore += (filter.weight || 1.0);
    }
  }
  score += weights.filterWeight * Math.min(filterMatchScore, 1.0);

  // Price attractiveness component (closer to mid-range = better)
  if (query.constraints.price && product.price) {
    const { min = 0, max = 10000 } = query.constraints.price;
    const midPrice = (min + max) / 2;
    const priceScore = 1 - Math.abs(product.price - midPrice) / (max - min);
    score += weights.priceWeight * Math.max(priceScore, 0);
  }

  return score;
}
