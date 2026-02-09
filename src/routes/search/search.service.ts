/**
 * Search Service
 * 
 * Business logic for product search functionality with composite query support.
 */

import { pg } from '../../lib/core/db';
import { osClient } from '../../lib/core/opensearch';
import { IntentParserService, ParsedIntent } from '../../lib/prompt/gemeni';
import { CompositeQueryBuilder, CompositeQuery } from '../../lib/query/compositeQueryBuilder';
import { QueryMapper, SearchQueryBundle } from '../../lib/query/queryMapper';
import { processImageForEmbedding } from '../../lib/image/processor';
import { 
  MultiVectorSearchEngine, 
  AttributeEmbedding, 
  SemanticAttribute,
  MultiVectorSearchResult,
  MultiVectorSearchConfig
} from '../../lib/search/multiVectorSearch';
import { attributeEmbeddings } from '../../lib/search/attributeEmbeddings';
import { intentAwareRerank, type RerankOptions } from '../../lib/ranker/intentReranker';

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
  rerankWeights?: RerankOptions | any;
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
    const opensearch = osClient;
    
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
    const embedding = await processImageForEmbedding(imageBuffer);

    // Search OpenSearch with kNN
    const opensearch = osClient;
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
  const { images, userPrompt, limit = 50, rerankWeights } = request;

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
      images.map(img => processImageForEmbedding(img))
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
    const opensearch = osClient;
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
        .filter((r: any): r is NonNullable<typeof r> => r !== null);

      // Apply intent-aware reranking to the composite results
      // Map composite results to MultiVectorSearchResult shape (minimal fields required)
      const mappedForRerank: MultiVectorSearchResult[] = results.map((r: any) => ({
        productId: r.id || r.product_id || r.productId,
        score: normalizeVectorScore(r.vectorScore),
        product: {
          vendorId: r.vendor_id || r.vendorId,
          title: r.name || r.title,
          brand: r.brand,
          category: r.category,
          priceUsd: r.price || r.price_usd || r.priceUsd,
          availability: r.availability,
          imageCdn: r.image_url || r.imageCdn,
        },
        scoreBreakdown: [],
      }));

      const defaultRerank: RerankOptions = {
        vectorWeight: 0.6,
        attributeWeight: 0.3,
        priceWeight: 0.1,
        recencyWeight: 0.0,
      };

      const rerankOpts = Object.assign({}, defaultRerank, rerankWeights || {});
      const reranked = intentAwareRerank(mappedForRerank, parsedIntent, rerankOpts);

      // Map reranked results back to response shape, preserving hydrated metadata
      const finalResults = reranked.map((rer: any) => {
        const original = results.find((o: any) => (o.id || o.product_id || o.productId) === rer.productId);
        return {
          ...original,
          rerankScore: (rer as any).rerankScore,
          rerankBreakdown: (rer as any).rerankBreakdown,
        };
      }).sort((a: any, b: any) => (b.rerankScore ?? 0) - (a.rerankScore ?? 0));

    return {
      results: finalResults,
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
 * Advanced multi-vector weighted search (NEW - Option B Implementation)
 * 
 * Executes parallel per-attribute kNN searches with weighted re-ranking.
 * This implements the "multi-kNN + union + re-rank" strategy.
 * 
 * Use this for advanced attribute-specific searches like:
 * - "Color from first image, texture from second"
 * - "Style similar to image A but pattern from image B"
 */
export async function multiVectorWeightedSearch(
  request: MultiImageSearchRequest & { 
    attributeWeights?: Partial<Record<SemanticAttribute, number>>;
    explainScores?: boolean;
    rerankWeights?: RerankOptions | any;
  }
): Promise<{ results: MultiVectorSearchResult[]; total: number; tookMs: number }> {
  const startTime = Date.now();
  const { images, userPrompt, limit = 50, attributeWeights, explainScores = false } = request;

  try {
    // Step 1: Parse user intent to extract attribute-specific instructions
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    const intentParser = new IntentParserService({ apiKey });
    const parsedIntent = await intentParser.parseUserIntent(images, userPrompt);

    // Step 2: Generate per-attribute embeddings based on intent
    const attributeEmbedList: AttributeEmbedding[] = [];

    // Use imageIntents to determine which attributes to extract from which images
    if (parsedIntent.imageIntents && parsedIntent.imageIntents.length > 0) {
      for (const imageIntent of parsedIntent.imageIntents) {
        const imageIndex = imageIntent.imageIndex;
        const imageBuffer = images[imageIndex];

        if (imageBuffer && imageIntent.primaryAttributes) {
          for (const attr of imageIntent.primaryAttributes) {
            const semanticAttr = attr.toLowerCase() as SemanticAttribute;
            
            // Map parsed attributes to our semantic attributes
            const attrMapping: Record<string, SemanticAttribute> = {
              'color': 'color',
              'texture': 'texture',
              'material': 'material',
              'style': 'style',
              'pattern': 'pattern',
              'overall': 'global',
              'global': 'global',
            };

            const mappedAttr = attrMapping[semanticAttr] || 'global';

            const embedding = await attributeEmbeddings.generateImageAttributeEmbedding(
              imageBuffer,
              mappedAttr
            );

            attributeEmbedList.push({
              attribute: mappedAttr,
              vector: embedding,
              weight: attributeWeights?.[mappedAttr] || imageIntent.weight || (1.0 / parsedIntent.imageIntents.length),
            });
          }
        }
      }
    } else {
      // Fallback: use global embeddings from all images with equal weight
      for (let i = 0; i < images.length; i++) {
        const embedding = await processImageForEmbedding(images[i]);
        attributeEmbedList.push({
          attribute: "global",
          vector: embedding,
          weight: attributeWeights?.global || 1.0 / images.length,
        });
      }
    }

    // Step 3: Build filters from parsed intent
    const filters = buildFiltersFromIntent(parsedIntent);

    // Step 4: Execute multi-vector search
    const searchEngine = new MultiVectorSearchEngine();
    const searchConfig: MultiVectorSearchConfig = {
      embeddings: attributeEmbedList,
      filters,
      size: limit,
      explainScores,
      baseK: 100,
      candidateMultiplier: 2.0,
      minCandidatesPerAttribute: 20,
      maxTotalCandidates: 1000,
    };

    const results = await searchEngine.search(searchConfig);

    // Apply intent-aware reranking to multi-vector results
    const defaultRerank: RerankOptions = {
      vectorWeight: 0.6,
      attributeWeight: 0.3,
      priceWeight: 0.1,
      recencyWeight: 0.0,
    };
    const rerankOpts = Object.assign({}, defaultRerank, request.rerankWeights || {});
    const reranked = intentAwareRerank(results, parsedIntent, rerankOpts);

    return {
      results: reranked,
      total: reranked.length,
      tookMs: Date.now() - startTime,
    };
  } catch (error) {
    console.error('[multiVectorWeightedSearch] Error:', error);
    return { results: [], total: 0, tookMs: Date.now() - startTime };
  }
}

/**
 * Build search filters from parsed intent
 */
function buildFiltersFromIntent(intent: ParsedIntent): any {
  const filters: any = {};

  // Extract from constraints
  if (intent.constraints) {
    if (intent.constraints.priceMin !== undefined) {
      filters.priceMin = intent.constraints.priceMin;
    }
    if (intent.constraints.priceMax !== undefined) {
      filters.priceMax = intent.constraints.priceMax;
    }
    if (intent.constraints.category) {
      filters.categories = [intent.constraints.category];
    }
    if (intent.constraints.brands && intent.constraints.brands.length > 0) {
      filters.brands = intent.constraints.brands;
    }
    if (intent.constraints.gender) {
      filters.gender = intent.constraints.gender;
    }
  }

  filters.excludeHidden = true;

  return filters;
}

/**
 * Hydrate product details from PostgreSQL
 */
async function hydrateProductDetails(
  productIds: number[],
  sqlFilters: any[]
): Promise<any[]> {
  if (productIds.length === 0) return [];

  const pool = pg;
  
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

// ---------------------------------------------------------------------------
// Helper utilities
// ---------------------------------------------------------------------------

function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }

/**
 * Normalize an OpenSearch vector score into [0,1]
 * - If score looks like cosine [-1,1] → map to (s+1)/2
 * - Otherwise apply a soft saturation: 1 - exp(-s/scale)
 */
function normalizeVectorScore(s: any): number {
  if (typeof s !== 'number' || !isFinite(s)) return 0;
  if (s >= -1 && s <= 1) return (s + 1) / 2;
  // scale chosen so scores ~10 map near 0.63
  return clamp01(1 - Math.exp(-s / 10));
}
