/**
 * Search Service
 *
 * Business logic for product search functionality with composite query support.
 * Text search is powered by the QueryAST pipeline (normalization, spell-check,
 * intent classification, entity extraction, expansions).
 */

import { pg } from '../../lib/core/db';
import { osClient } from '../../lib/core/opensearch';
import { config } from '../../config';
import { IntentParserService, ParsedIntent } from '../../lib/prompt/gemeni';
import { CompositeQueryBuilder, CompositeQuery } from '../../lib/query/compositeQueryBuilder';
import { QueryMapper } from '../../lib/query/queryMapper';
import { processImageForEmbedding } from '../../lib/image/processor';
import { hybridSearch } from '../../lib/search';
import {
  MultiVectorSearchEngine,
  AttributeEmbedding,
  SemanticAttribute,
  MultiVectorSearchResult,
  MultiVectorSearchConfig
} from '../../lib/search/multiVectorSearch';
import { attributeEmbeddings } from '../../lib/search/attributeEmbeddings';
import { intentAwareRerank, type RerankOptions } from '../../lib/ranker/intentReranker';
import {
  processQuery as processQueryAST,
  getQueryEmbedding,
  type QueryAST,
} from '../../lib/queryProcessor';

// ─── Shared types ────────────────────────────────────────────────────────────

export interface SearchFilters {
  brand?: string;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  color?: string;
  size?: string;
  gender?: string;
  vendorId?: number;
}

export interface SearchResult {
  results: any[];
  total: number;
  tookMs: number;
  query?: QueryASTSummary;
  explanation?: string;
  compositeQuery?: CompositeQuery;
}

/** Lightweight subset of QueryAST shipped back with every text-search response */
export interface QueryASTSummary {
  original: string;
  searchQuery: string;
  intent: { type: string; confidence: number };
  entities: { brands: string[]; categories: string[]; colors: string[]; gender?: string };
  corrections: Array<{ original: string; corrected: string; source: string }>;
  suggestText?: string;
  processingTimeMs: number;
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

// ─── Text Search (QueryAST-powered) ─────────────────────────────────────────

/**
 * Text-based product search.
 *
 * Flow:
 *  1. Run the query through the full QueryAST pipeline
 *     (normalize → spell-correct → extract entities → classify intent → expand)
 *  2. Build an OpenSearch bool query using the AST's searchQuery + entities
 *  3. Merge caller-supplied filters with AST-extracted filters
 *  4. Optionally boost with a CLIP text embedding (hybrid kNN + BM25)
 *  5. Return results with an AST summary for the client
 */
export async function textSearch(
  rawQuery: string,
  callerFilters?: SearchFilters,
  options?: { limit?: number; offset?: number },
): Promise<SearchResult> {
  const startTime = Date.now();
  const limit  = options?.limit  ?? 20;
  const offset = options?.offset ?? 0;

  try {
    // ── 1. Process query through the AST pipeline ──────────────────────────
    const ast = await processQueryAST(rawQuery);

    // ── 2. Merge filters: caller-supplied take precedence, AST fills gaps ──
    const merged = mergeFilters(callerFilters, ast);

    // ── 3. Build OpenSearch query ──────────────────────────────────────────
    const mustClauses: any[] = [];
    const filterClauses: any[] = [];

    // Primary text match – use the corrected searchQuery
    // Fields must match the OpenSearch index mapping (title, category, brand)
    if (ast.searchQuery) {
      mustClauses.push({
        multi_match: {
          query: ast.searchQuery,
          fields: ['title^3', 'category', 'brand'],
          fuzziness: 'AUTO',
        },
      });
    }

    // Expansion terms → should-match to improve recall without hurting precision
    const expansionTerms = [
      ...ast.expansions.synonyms,
      ...ast.expansions.categoryExpansions,
      ...ast.expansions.transliterations,
    ].filter(Boolean);

    const shouldClauses: any[] = [];
    if (expansionTerms.length > 0) {
      shouldClauses.push({
        multi_match: {
          query: expansionTerms.join(' '),
          fields: ['title', 'category', 'brand'],
          fuzziness: 'AUTO',
          boost: 0.3,
        },
      });
    }

    // ── 4. Apply merged filters ────────────────────────────────────────────
    // Field names must match OpenSearch index mapping (attr_color, attr_gender, price_usd, etc.)
    //
    // Category & brand from entity extraction are treated as BOOSTS (should),
    // not hard filters, because the dictionary canonical names (e.g. "bottoms")
    // often don't match the actual values stored in OpenSearch (e.g. "pants").
    // Only caller-supplied filters are treated as hard term filters.
    if (merged.category) {
      if (callerFilters?.category) {
        filterClauses.push({ term: { category: merged.category.toLowerCase() } });
      } else {
        const catAliases = getCategorySearchTerms(merged.category);
        shouldClauses.push({
          bool: {
            should: catAliases.map(alias => ({ term: { category: alias.toLowerCase() } })),
            boost: 2.0,
          },
        });
        shouldClauses.push({
          multi_match: {
            query: catAliases.join(' '),
            fields: ['title^2', 'category^3'],
            fuzziness: 'AUTO',
            boost: 1.5,
          },
        });
      }
    }
    if (merged.brand) {
      if (callerFilters?.brand) {
        filterClauses.push({ term: { brand: merged.brand.toLowerCase() } });
      } else {
        shouldClauses.push({ term: { brand: { value: merged.brand.toLowerCase(), boost: 3.0 } } });
      }
    }
    if (merged.color) {
      if (callerFilters?.color) {
        filterClauses.push({ term: { attr_color: merged.color.toLowerCase() } });
      } else {
        shouldClauses.push({ term: { attr_color: { value: merged.color.toLowerCase(), boost: 2.0 } } });
      }
    }
    if (merged.gender) {
      if (callerFilters?.gender) {
        filterClauses.push({ term: { attr_gender: merged.gender.toLowerCase() } });
      } else {
        shouldClauses.push({ term: { attr_gender: { value: merged.gender.toLowerCase(), boost: 1.5 } } });
      }
    }
    if (merged.vendorId) {
      filterClauses.push({ term: { vendor_id: String(merged.vendorId) } });
    }
    if (merged.minPrice !== undefined || merged.maxPrice !== undefined) {
      const range: any = {};
      if (merged.minPrice !== undefined) range.gte = merged.minPrice;
      if (merged.maxPrice !== undefined) range.lte = merged.maxPrice;
      filterClauses.push({ range: { price_usd: range } });
    }

    // If entity extraction consumed the whole query, ensure we still have a
    // text match on the raw query so BM25 can find results.
    if (mustClauses.length === 0 && rawQuery.trim()) {
      mustClauses.push({
        multi_match: {
          query: rawQuery.trim(),
          fields: ['title^3', 'category^2', 'brand'],
          fuzziness: 'AUTO',
        },
      });
    }

    // If still no must clauses (completely empty query), match everything
    if (mustClauses.length === 0) {
      mustClauses.push({ match_all: {} });
    }

    const searchBody: any = {
      query: {
        bool: {
          must: mustClauses,
          should: shouldClauses,
          filter: filterClauses,
          minimum_should_match: 0,
        },
      },
      from: offset,
      size: limit,
      _source: ['product_id', 'title', 'brand', 'price_usd', 'image_cdn', 'category', 'attr_gender', 'attr_color'],
    };

    // ── 5. Optional hybrid kNN boost ───────────────────────────────────────
    // kNN is a soft boost via bool/should — both BM25 and vector similarity
    // scores contribute naturally. We only add it when embedding succeeds.
    let embedding: number[] | null = null;
    try {
      embedding = await getQueryEmbedding(ast.searchQuery);
    } catch (err) {
      console.warn('[textSearch] Embedding generation failed, proceeding with BM25-only:', err);
    }
    if (embedding) {
      searchBody.query.bool.should = [
        ...shouldClauses,
        {
          knn: {
            embedding: {
              vector: embedding,
              k: limit * 2,
            },
          },
        },
      ];
    }

    // ── 6. Execute ─────────────────────────────────────────────────────────
    console.log('[textSearch] Query:', JSON.stringify({
      raw: rawQuery, processed: ast.searchQuery,
      entities: { category: merged.category, brand: merged.brand, color: merged.color, gender: merged.gender },
      mustCount: mustClauses.length, shouldCount: searchBody.query.bool.should?.length ?? 0,
      filterCount: filterClauses.length, hasEmbedding: !!embedding,
    }));

    const opensearch = osClient;
    const response = await opensearch.search({ index: config.opensearch.index, body: searchBody });

    const results = response.body.hits.hits.map((hit: any) => ({
      id: hit._source.product_id,
      name: hit._source.title,
      brand: hit._source.brand,
      price: hit._source.price_usd,
      imageUrl: hit._source.image_cdn,
      category: hit._source.category,
      gender: hit._source.attr_gender,
      color: hit._source.attr_color,
      score: hit._score,
    }));

    // ── 7. Build response ──────────────────────────────────────────────────
    return {
      results,
      total: response.body.hits.total?.value ?? response.body.hits.total ?? 0,
      tookMs: Date.now() - startTime,
      query: summarizeAST(ast),
    };
  } catch (error) {
    console.error('[textSearch] Error:', error);
    return { results: [], total: 0, tookMs: Date.now() - startTime };
  }
}

// ─── Image Search ────────────────────────────────────────────────────────────

/**
 * Image-based similarity search using CLIP embeddings
 */
/**
 * Single image similarity search using Hybrid Search (CLIP image + BLIP caption fusion)
 *
 * This is for finding products similar to a whole image (no YOLO detection).
 * For per-item detection + search, use POST /api/images/search instead.
 *
 * Pipeline:
 * 1. CLIP image embed (60% weight) - visual features
 * 2. BLIP caption → CLIP text embed (30% weight) - semantic features
 * 3. Fuse embeddings with L2 normalization
 * 4. OpenSearch k-NN vector search
 */
export async function imageSearch(
  imageBuffer: Buffer,
  options?: { limit?: number }
): Promise<SearchResult> {
  const startTime = Date.now();
  const limit = options?.limit || 50;

  try {
    // Use hybrid search: CLIP image + BLIP caption fusion
    const vectors = await hybridSearch.buildQueryVectors(imageBuffer);
    const embedding = hybridSearch.fuseVectors(vectors);

    const opensearch = osClient;
    const response = await opensearch.search({
      index: config.opensearch.index,
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
        _source: ['product_id', 'title', 'brand', 'price_usd', 'image_cdn', 'category'],
      },
    });

    const results = response.body.hits.hits.map((hit: any) => ({
      id: hit._source.product_id,
      name: hit._source.title,
      brand: hit._source.brand,
      price: hit._source.price_usd,
      imageUrl: hit._source.image_cdn,
      category: hit._source.category,
      score: hit._score,
    }));

    return {
      results,
      total: response.body.hits.total?.value ?? response.body.hits.total ?? 0,
      tookMs: Date.now() - startTime,
      explanation: vectors.caption ? `Caption: "${vectors.caption}"` : undefined,
    };
  } catch (error) {
    console.error('[imageSearch] Error:', error);
    return { results: [], total: 0, tookMs: Date.now() - startTime };
  }
}

/**
 * Multi-image composite search with intent parsing
 */
export async function multiImageSearch(
  request: MultiImageSearchRequest
): Promise<SearchResult> {
  const startTime = Date.now();
  const { images, userPrompt, limit = 50, rerankWeights } = request;

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

    const intentParser = new IntentParserService({ apiKey });
    const parsedIntent = await intentParser.parseUserIntent(images, userPrompt);

    const imageEmbeddings = await Promise.all(
      images.map(img => processImageForEmbedding(img))
    );

    const compositeQuery = await queryBuilder.buildQuery(parsedIntent, imageEmbeddings);

    const queryBundle = queryMapper.mapQuery(compositeQuery, {
      maxResults: limit,
      vectorWeight: 0.6,
      filterWeight: 0.3,
      priceWeight: 0.1,
    });

    const opensearch = osClient;
    const response = await opensearch.search({
      index: config.opensearch.index,
      body: queryBundle.opensearch,
    });

    const productIds = response.body.hits.hits.map((hit: any) => hit._source.product_id);
    const hydratedResults = await hydrateProductDetails(productIds, queryBundle.sqlFilters);

    const results = response.body.hits.hits
      .map((hit: any) => {
        const hydrated = hydratedResults.find((p: any) => String(p.id) === String(hit._source.product_id));
        return hydrated
          ? {
              ...hydrated,
              vectorScore: hit._score,
              compositeScore: calculateCompositeScore(hit._score, hydrated, compositeQuery, queryBundle.hybridScore),
            }
          : null;
      })
      .filter((r: any): r is NonNullable<typeof r> => r !== null);

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

    const defaultRerank: RerankOptions = { vectorWeight: 0.6, attributeWeight: 0.3, priceWeight: 0.1, recencyWeight: 0.0 };
    const rerankOpts = Object.assign({}, defaultRerank, rerankWeights || {});
    const reranked = intentAwareRerank(mappedForRerank, parsedIntent, rerankOpts);

    const finalResults = reranked.map((rer: any) => {
      const original = results.find((o: any) => (o.id || o.product_id || o.productId) === rer.productId);
      return { ...original, rerankScore: rer.rerankScore, rerankBreakdown: rer.rerankBreakdown };
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
 * Advanced multi-vector weighted search
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
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

    const intentParser = new IntentParserService({ apiKey });
    const parsedIntent = await intentParser.parseUserIntent(images, userPrompt);

    const attributeEmbedList: AttributeEmbedding[] = [];

    if (parsedIntent.imageIntents && parsedIntent.imageIntents.length > 0) {
      for (const imageIntent of parsedIntent.imageIntents) {
        const imageBuffer = images[imageIntent.imageIndex];
        if (imageBuffer && imageIntent.primaryAttributes) {
          for (const attr of imageIntent.primaryAttributes) {
            const semanticAttr = attr.toLowerCase() as SemanticAttribute;
            const attrMapping: Record<string, SemanticAttribute> = {
              color: 'color', texture: 'texture', material: 'material',
              style: 'style', pattern: 'pattern', overall: 'global', global: 'global',
            };
            const mappedAttr = attrMapping[semanticAttr] || 'global';
            const embedding = await attributeEmbeddings.generateImageAttributeEmbedding(imageBuffer, mappedAttr);
            attributeEmbedList.push({
              attribute: mappedAttr,
              vector: embedding,
              weight: attributeWeights?.[mappedAttr] || imageIntent.weight || (1.0 / parsedIntent.imageIntents.length),
            });
          }
        }
      }
    } else {
      for (let i = 0; i < images.length; i++) {
        const embedding = await processImageForEmbedding(images[i]);
        attributeEmbedList.push({
          attribute: "global",
          vector: embedding,
          weight: attributeWeights?.global || 1.0 / images.length,
        });
      }
    }

    const filters = buildFiltersFromIntent(parsedIntent);

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

    const defaultRerank: RerankOptions = { vectorWeight: 0.6, attributeWeight: 0.3, priceWeight: 0.1, recencyWeight: 0.0 };
    const rerankOpts = Object.assign({}, defaultRerank, request.rerankWeights || {});
    const reranked = intentAwareRerank(results, parsedIntent, rerankOpts);

    return { results: reranked, total: reranked.length, tookMs: Date.now() - startTime };
  } catch (error) {
    console.error('[multiVectorWeightedSearch] Error:', error);
    return { results: [], total: 0, tookMs: Date.now() - startTime };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Get all search terms for a category (canonical name + aliases).
 * e.g. "bottoms" → ["bottoms", "bottom", "pants", "pant", "trousers", "jeans"]
 */
function getCategorySearchTerms(category: string): string[] {
  const CATEGORY_ALIASES: Record<string, string[]> = {
    tops: ["tops", "top", "shirts", "shirt", "blouse", "blouses", "tshirt", "t-shirt"],
    bottoms: ["bottoms", "bottom", "pants", "pant", "trousers", "jeans"],
    dresses: ["dresses", "dress", "gown", "frock"],
    outerwear: ["outerwear", "jacket", "jackets", "coat", "coats", "blazer"],
    footwear: ["footwear", "shoes", "shoe", "sneakers", "boots", "sandals", "heels"],
    accessories: ["accessories", "accessory", "bag", "bags", "belt", "belts", "hat", "hats", "watch", "watches"],
    activewear: ["activewear", "sportswear", "athletic", "gym", "workout", "running"],
    swimwear: ["swimwear", "swim", "swimming", "bikini", "swimsuit"],
    underwear: ["underwear", "lingerie", "undergarments", "innerwear"],
  };
  const key = category.toLowerCase();
  return CATEGORY_ALIASES[key] || [key];
}

/** Merge caller-supplied filters with QueryAST-extracted entities.
 *  Caller-supplied values always win; AST fills in the blanks. */
function mergeFilters(caller: SearchFilters | undefined, ast: QueryAST): SearchFilters {
  return {
    brand:    caller?.brand    ?? ast.entities.brands[0],
    category: caller?.category ?? ast.entities.categories[0],
    color:    caller?.color    ?? ast.entities.colors[0],
    gender:   caller?.gender   ?? ast.entities.gender,
    minPrice: caller?.minPrice ?? ast.filters.priceRange?.min,
    maxPrice: caller?.maxPrice ?? ast.filters.priceRange?.max,
    size:     caller?.size,
    vendorId: caller?.vendorId,
  };
}

/** Build a small summary of the AST suitable for an API response */
function summarizeAST(ast: QueryAST): QueryASTSummary {
  const corrected = ast.corrections.length > 0 && ast.searchQuery !== ast.normalized;
  return {
    original: ast.original,
    searchQuery: ast.searchQuery,
    intent: { type: ast.intent.type, confidence: ast.intent.confidence },
    entities: {
      brands: ast.entities.brands,
      categories: ast.entities.categories,
      colors: ast.entities.colors,
      gender: ast.entities.gender,
    },
    corrections: ast.corrections.map(c => ({
      original: c.original, corrected: c.corrected, source: c.source,
    })),
    suggestText: corrected && ast.confidence < 0.85
      ? `Did you mean "${ast.searchQuery}"?`
      : undefined,
    processingTimeMs: ast.processingTimeMs,
  };
}

function buildFiltersFromIntent(intent: ParsedIntent): any {
  const filters: any = {};
  if (intent.constraints) {
    if (intent.constraints.priceMin !== undefined) filters.priceMin = intent.constraints.priceMin;
    if (intent.constraints.priceMax !== undefined) filters.priceMax = intent.constraints.priceMax;
    if (intent.constraints.category) filters.categories = [intent.constraints.category];
    if (intent.constraints.brands?.length) filters.brands = intent.constraints.brands;
    if (intent.constraints.gender) filters.gender = intent.constraints.gender;
  }
  filters.excludeHidden = true;
  return filters;
}

async function hydrateProductDetails(productIds: (string | number)[], sqlFilters: any[]): Promise<any[]> {
  if (productIds.length === 0) return [];
  const pool = pg;
  const numericIds = productIds.map(id => Number(id)).filter(id => !isNaN(id));
  if (numericIds.length === 0) return [];
  const query = `
    SELECT p.id, p.title AS name, p.brand,
           ROUND(p.price_cents / 100.0, 2) AS price,
           COALESCE(p.image_cdn, p.image_url) AS image_url,
           p.category, p.description, p.vendor_id, p.size, p.color
    FROM products p
    WHERE p.id = ANY($1::bigint[])
  `;
  const result = await pool.query(query, [numericIds]);
  return result.rows;
}

function calculateCompositeScore(
  vectorScore: number,
  product: any,
  query: CompositeQuery,
  weights: { vectorWeight: number; filterWeight: number; priceWeight: number },
): number {
  let score = weights.vectorWeight * vectorScore;

  let filterMatch = 0;
  for (const filter of query.filters) {
    const val = product.attributes?.[filter.attribute];
    if (val && filter.values.some((v: string) => val.includes(v))) {
      filterMatch += filter.weight || 1.0;
    }
  }
  score += weights.filterWeight * Math.min(filterMatch, 1.0);

  if (query.constraints.price && product.price) {
    const { min = 0, max = 10000 } = query.constraints.price;
    const mid = (min + max) / 2;
    score += weights.priceWeight * Math.max(1 - Math.abs(product.price - mid) / (max - min), 0);
  }

  return score;
}

function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }

function normalizeVectorScore(s: any): number {
  if (typeof s !== 'number' || !isFinite(s)) return 0;
  if (s >= -1 && s <= 1) return (s + 1) / 2;
  return clamp01(1 - Math.exp(-s / 10));
}