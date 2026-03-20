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
    //
    // Key design decisions:
    //  • title (text) gets highest boost — this is where product names live
    //  • brand.search / category.search (text sub-fields) allow full-text
    //    matching with fuzziness — the parent keyword fields do NOT support
    //    fuzziness or tokenization
    //  • description (text) adds recall for long-tail queries
    //  • attr_color, attr_gender are keyword → only exact term filters
    //  • We use a two-layer approach:
    //    MUST = at least one text match (ensures relevance)
    //    SHOULD = entity boosts + expansions (improves ranking)
    //    FILTER = hard constraints from caller-supplied or high-confidence entities

    const mustClauses: any[] = [];
    const filterClauses: any[] = [];
    const shouldClauses: any[] = [];

    // Primary text match — use corrected searchQuery against text fields
    if (ast.searchQuery) {
      mustClauses.push({
        bool: {
          should: [
            {
              multi_match: {
                query: ast.searchQuery,
                fields: [
                  'title^4',
                  'title.raw^2',
                  'category.search^2',
                  'brand.search^1.5',
                  'description',
                ],
                // OpenSearch rejects fuzziness with cross_fields.
                // best_fields preserves fuzzy typo tolerance safely.
                type: 'best_fields',
                fuzziness: 'AUTO',
                operator: 'or',
                minimum_should_match: '60%',
              },
            },
            {
              multi_match: {
                query: ast.searchQuery,
                fields: ['title^5', 'category.search^3'],
                type: 'phrase',
                boost: 2.0,
              },
            },
          ],
          minimum_should_match: 1,
        },
      });
    }

    // ── 4. Expansion terms → should-match for better recall ───────────────
    const expansionTerms = [
      ...ast.expansions.synonyms,
      ...ast.expansions.categoryExpansions,
      ...ast.expansions.transliterations,
    ].filter(Boolean);

    if (expansionTerms.length > 0) {
      shouldClauses.push({
        multi_match: {
          query: expansionTerms.join(' '),
          fields: ['title^2', 'category.search^2', 'description'],
          type: 'best_fields',
          fuzziness: 'AUTO',
          boost: 0.8,
        },
      });
    }

    // ── 5. Apply merged filters ────────────────────────────────────────────
    //
    // Entity-extracted values: use as SHOULD boosts (they may not match
    // the exact keyword values stored in OpenSearch).
    // Caller-supplied values: use as hard FILTER constraints.
    if (merged.category) {
      if (callerFilters?.category) {
        filterClauses.push({ term: { category: merged.category.toLowerCase() } });
      } else {
        const catAliases = getCategorySearchTerms(merged.category);
        shouldClauses.push({
          bool: {
            should: [
              ...catAliases.map(alias => ({
                term: { category: { value: alias.toLowerCase(), boost: 3.0 } },
              })),
              {
                match: {
                  'category.search': {
                    query: catAliases.join(' '),
                    boost: 2.0,
                    fuzziness: 'AUTO',
                  },
                },
              },
              {
                multi_match: {
                  query: catAliases.join(' '),
                  fields: ['title^2'],
                  fuzziness: 'AUTO',
                  boost: 1.5,
                },
              },
            ],
          },
        });
      }
    }
    if (merged.brand) {
      if (callerFilters?.brand) {
        filterClauses.push({ term: { brand: merged.brand.toLowerCase() } });
      } else {
        shouldClauses.push({
          bool: {
            should: [
              { term: { brand: { value: merged.brand.toLowerCase(), boost: 4.0 } } },
              { match: { 'brand.search': { query: merged.brand, boost: 2.0, fuzziness: 'AUTO' } } },
            ],
          },
        });
      }
    }
    if (merged.color) {
      if (callerFilters?.color) {
        filterClauses.push({ term: { attr_color: merged.color.toLowerCase() } });
      } else {
        shouldClauses.push({
          bool: {
            should: [
              { term: { attr_color: { value: merged.color.toLowerCase(), boost: 3.0 } } },
              { match: { title: { query: merged.color, boost: 1.5 } } },
            ],
          },
        });
      }
    }
    if (merged.gender) {
      if (callerFilters?.gender) {
        filterClauses.push({ term: { attr_gender: merged.gender.toLowerCase() } });
      } else {
        shouldClauses.push({
          bool: {
            should: [
              { term: { attr_gender: { value: merged.gender.toLowerCase(), boost: 2.5 } } },
              { match: { title: { query: merged.gender, boost: 1.0 } } },
            ],
          },
        });
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
          fields: ['title^4', 'title.raw^2', 'category.search^2', 'brand.search', 'description'],
          type: 'best_fields',
          fuzziness: 'AUTO',
          minimum_should_match: '50%',
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

    // ── 6. Optional hybrid kNN with similarity threshold ─────────────────────
    //
    // When embedding is available, we require BOTH text match AND embedding
    // similarity >= threshold. This filters out irrelevant results (e.g., skincare
    // products that happen to match text) that would otherwise rank high.
    //
    // OpenSearch cosinesimil score = (1 + cosine) / 2, range [0, 1].
    // min_score enforces acceptable similarity; use min_score (not k) per OpenSearch API.
    const EMBEDDING_MIN_SIMILARITY = config.clip.similarityThreshold;
    let embedding: number[] | null = null;
    try {
      embedding = await getQueryEmbedding(ast.searchQuery);
    } catch (err) {
      console.warn('[textSearch] Embedding generation failed, proceeding with BM25-only:', err);
    }
    if (embedding) {
      // Require embedding similarity >= threshold (filters low-similarity results)
      // min_score both filters and contributes to ranking; OpenSearch allows only one of k/min_score per clause
      searchBody.query.bool.must.push({
        knn: {
          embedding: {
            vector: embedding,
            min_score: EMBEDDING_MIN_SIMILARITY,
          },
        },
      });
      searchBody.query.bool.should = shouldClauses;
    }

    // ── 7. Execute ─────────────────────────────────────────────────────────
    console.log('[textSearch] Query:', JSON.stringify({
      raw: rawQuery, processed: ast.searchQuery,
      entities: { category: merged.category, brand: merged.brand, color: merged.color, gender: merged.gender },
      corrections: ast.corrections.map((c: any) => `${c.original}→${c.corrected}`),
      mustCount: mustClauses.length, shouldCount: searchBody.query.bool.should?.length ?? 0,
      filterCount: filterClauses.length, hasEmbedding: !!embedding,
    }));

    const opensearch = osClient;
    let response: any;
    try {
      response = await opensearch.search({ index: config.opensearch.index, body: searchBody });
    } catch (err: any) {
      const reason =
        err?.meta?.body?.error?.reason ||
        err?.meta?.body?.error?.root_cause?.[0]?.reason ||
        err?.message ||
        "";
      const type =
        err?.meta?.body?.error?.type ||
        err?.meta?.body?.error?.root_cause?.[0]?.type ||
        "";

      const isParseError =
        String(type).includes("parsing_exception") ||
        String(type).includes("x_content_parse_exception") ||
        String(reason).toLowerCase().includes("fuzziness not allowed");

      if (!isParseError) throw err;

      console.warn("[textSearch] Parse error on advanced query, retrying with safe fallback:", {
        type,
        reason,
      });

      // Safe fallback: strip kNN and run a simple best_fields query that
      // OpenSearch accepts across versions. Keep user filters to preserve intent.
      const fallbackBody: any = {
        query: {
          bool: {
            must: [
              {
                multi_match: {
                  query: ast.searchQuery || rawQuery,
                  fields: ["title^4", "category.search^2", "brand.search^2", "description"],
                  type: "best_fields",
                  operator: "or",
                },
              },
            ],
            filter: filterClauses,
            should: shouldClauses.filter((c: any) => !c?.knn),
            minimum_should_match: 0,
          },
        },
        from: offset,
        size: limit,
        _source: ["product_id", "title", "brand", "price_usd", "image_cdn", "category", "attr_gender", "attr_color"],
      };

      response = await opensearch.search({ index: config.opensearch.index, body: fallbackBody });
    }

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

    // ── 8. Build response ──────────────────────────────────────────────────
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
 * Single image similarity search using pure CLIP image embeddings
 *
 * Pipeline:
 * 1. CLIP image embed - pure visual features (matching indexed embeddings)
 * 2. OpenSearch k-NN vector search with filters
 * 3. Minimum similarity threshold to cut irrelevant tail
 *
 * NOTE: We use pure image embeddings (not fused with caption) because the
 * indexed embeddings are pure image embeddings from processImageForEmbedding().
 * Mixing fused query vectors with pure index vectors causes modality mismatch
 * and reduces cosine similarity, leading to poor search results.
 */
export async function imageSearch(
  imageBuffer: Buffer,
  options?: { limit?: number; filters?: SearchFilters }
): Promise<SearchResult> {
  const startTime = Date.now();
  const limit = options?.limit || 50;

  try {
    // Use pure image embedding (matches indexed format) - no caption fusion
    const embedding = await processImageForEmbedding(imageBuffer);

    const kCandidates = Math.min(limit * 3, 200);

    const filterClauses: any[] = [
      { term: { is_hidden: false } },
    ];
    if (options?.filters?.category) {
      filterClauses.push({ term: { category: options.filters.category.toLowerCase() } });
    }
    if (options?.filters?.gender) {
      filterClauses.push({ term: { attr_gender: options.filters.gender.toLowerCase() } });
    }
    if (options?.filters?.brand) {
      filterClauses.push({ term: { brand: options.filters.brand.toLowerCase() } });
    }
    if (options?.filters?.color) {
      filterClauses.push({ term: { attr_color: options.filters.color.toLowerCase() } });
    }

    const opensearch = osClient;
    const response = await opensearch.search({
      index: config.opensearch.index,
      body: {
        size: limit,
        query: {
          bool: {
            must: [
              {
                knn: {
                  embedding: {
                    vector: embedding,
                    k: kCandidates,
                  },
                },
              },
            ],
            filter: filterClauses,
          },
        },
        _source: ['product_id', 'title', 'brand', 'price_usd', 'image_cdn', 'category', 'attr_color', 'attr_gender'],
      },
    });

    // OpenSearch cosinesimil (FAISS) score = (1 + cosine_similarity) / 2
    // Range [0, 1]: 1.0 = identical, 0.5 = orthogonal, 0.0 = opposite.
    // Filter out results below acceptable similarity (configurable via CLIP_SIMILARITY_THRESHOLD).
    const MIN_SIMILARITY = config.clip.similarityThreshold;
    const results = response.body.hits.hits
      .filter((hit: any) => (hit._score ?? 0) >= MIN_SIMILARITY)
      .map((hit: any) => ({
        id: hit._source.product_id,
        name: hit._source.title,
        brand: hit._source.brand,
        price: hit._source.price_usd,
        imageUrl: hit._source.image_cdn,
        category: hit._source.category,
        color: hit._source.attr_color,
        gender: hit._source.attr_gender,
        score: hit._score,
      }));

    return {
      results,
      total: response.body.hits.total?.value ?? response.body.hits.total ?? 0,
      tookMs: Date.now() - startTime,
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
    tops: ["tops", "top", "shirts", "shirt", "blouse", "blouses", "tshirt", "t-shirt", "tee", "tank top", "polo", "henley", "tunic", "crop top", "camisole", "sweater", "pullover", "hoodie", "sweatshirt"],
    bottoms: ["bottoms", "bottom", "pants", "pant", "trousers", "jeans", "jean", "chinos", "leggings", "shorts", "short", "skirt", "skirts", "culottes", "cargo pants", "sweatpants"],
    joggers: ["joggers", "jogger", "jogging", "jogging pants", "track pants", "trackpants", "jogging bottoms"],
    dresses: ["dresses", "dress", "gown", "frock", "maxi dress", "mini dress", "midi dress", "sundress", "jumpsuit", "romper"],
    outerwear: ["outerwear", "jacket", "jackets", "coat", "coats", "blazer", "blazers", "cardigan", "cardigans", "parka", "windbreaker", "vest", "gilet", "poncho", "cape", "trench"],
    footwear: ["footwear", "shoes", "shoe", "sneakers", "sneaker", "boots", "boot", "sandals", "sandal", "heels", "heel", "loafers", "loafer", "flats", "flat", "mules", "slides", "slippers", "pumps", "oxfords", "trainers"],
    accessories: ["accessories", "accessory", "bag", "bags", "belt", "belts", "hat", "hats", "cap", "watch", "watches", "scarf", "scarves", "sunglasses", "jewelry", "bracelet", "necklace", "earrings", "wallet", "purse", "handbag", "tote", "backpack", "clutch"],
    activewear: ["activewear", "sportswear", "athletic", "gym", "workout", "running", "yoga", "training", "sports bra", "track pants", "performance"],
    swimwear: ["swimwear", "swim", "swimming", "bikini", "swimsuit", "swim trunks", "one piece", "two piece", "beach wear", "board shorts"],
    underwear: ["underwear", "lingerie", "undergarments", "innerwear", "boxers", "briefs", "bra", "panties", "thong", "undershirt"],
  };
  const key = category.toLowerCase();
  if (CATEGORY_ALIASES[key]) return CATEGORY_ALIASES[key];

  for (const [cat, aliases] of Object.entries(CATEGORY_ALIASES)) {
    if (aliases.includes(key)) return CATEGORY_ALIASES[cat];
  }

  return [key];
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

/**
 * Normalize a vector score to [0, 1].
 * OpenSearch cosinesimil (FAISS) already returns [0, 1] so most scores
 * pass through the identity path.  The exponential branch handles
 * older BM25-scale scores that may appear in hybrid results.
 */
function normalizeVectorScore(s: any): number {
  if (typeof s !== 'number' || !isFinite(s)) return 0;
  if (s >= 0 && s <= 1) return s;
  if (s < 0) return 0;
  return clamp01(1 - Math.exp(-s / 10));
}