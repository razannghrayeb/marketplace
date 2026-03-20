/**
 * Search Service
 *
 * Business logic for product search functionality with composite query support.
 * Text search is powered by the QueryAST pipeline (normalization, spell-check,
 * intent classification, entity extraction, expansions).
 */

import { pg, getProductsByIdsOrdered } from '../../lib/core/db';
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
import { buildFeatureRows, predictWithFallback, isRankerAvailable } from '../../lib/ranker';
import {
  processQuery as processQueryAST,
  getQueryEmbedding,
  type QueryAST,
} from '../../lib/queryProcessor';
import { extractAttributesSync } from "../../lib/search/attributeExtractor";

import { getImagesForProducts } from '../products/images.service';
import type { ProductResult, SearchResultWithRelated } from '../products/types';
import { findRelatedProducts } from '../../lib/search/relatedProducts';
import { dedupeSearchResults, filterRelatedAgainstMain } from '../../lib/search/resultDedup';
import {
  getCategorySearchTerms,
  loadCategoryVocabulary,
  resolveCategoryTermsForOpensearch,
  shouldHardFilterAstCategory,
  isProductTypeDominantQuery,
} from '../../lib/search/categoryFilter';
import {
  expandProductTypesForQuery,
  scoreProductTypeTaxonomyMatch,
} from '../../lib/search/productTypeTaxonomy';
import {
  emitTextSearchEval,
  searchEvalEnabled,
  newSearchEvalId,
  searchEvalVariant,
} from '../../lib/search/evalHooks';

// ─── Shared types ────────────────────────────────────────────────────────────

export interface SearchFilters {
  brand?: string;
  category?: string | string[];
  minPrice?: number;
  maxPrice?: number;
  color?: string;
  colors?: string[];
  colorMode?: "any" | "all";
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

export type UnifiedSearchResult = SearchResultWithRelated & {
  total: number;
  tookMs: number;
  query?: QueryASTSummary;
};

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

const COLOR_CANONICAL_ALIASES: Record<string, string[]> = {
  black: ["black", "charcoal", "dark gray", "dark grey", "jet", "onyx"],
  white: ["white", "off white", "off-white", "ivory", "cream", "ecru"],
  gray: ["gray", "grey", "heather grey", "heather gray", "silver"],
  blue: ["blue", "navy", "cobalt", "denim", "sky blue", "mid blue", "midnight blue"],
  red: ["red", "burgundy", "maroon", "wine", "cherry"],
  green: ["green", "olive", "khaki", "sage", "mint", "forest green", "hunter green"],
  brown: ["brown", "camel", "tan", "taupe", "mocha", "chocolate", "beige"],
  purple: ["purple", "violet", "plum", "lavender", "lilac", "mauve"],
  pink: ["pink", "blush", "fuchsia", "magenta", "rose"],
  yellow: ["yellow", "mustard", "golden", "gold"],
  orange: ["orange", "rust", "peach", "coral", "burnt orange"],
  multicolor: ["multicolor", "multi color", "multi-color", "colour block", "color block"],
};

const COLOR_ALIAS_TO_CANONICAL = (() => {
  const map = new Map<string, string>();
  for (const [canonical, aliases] of Object.entries(COLOR_CANONICAL_ALIASES)) {
    map.set(canonical, canonical);
    for (const alias of aliases) map.set(alias.toLowerCase(), canonical);
  }
  return map;
})();

function strictProductTypeFilterEnv(): boolean {
  const v = String(process.env.SEARCH_STRICT_PRODUCT_TYPE ?? '').toLowerCase();
  return v === '1' || v === 'true';
}

function normalizeColorToken(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw.toLowerCase().replace(/[_-]/g, " ").replace(/\s+/g, " ").trim();
  return COLOR_ALIAS_TO_CANONICAL.get(key) ?? null;
}

function expandColorTermsForFilter(color: string): string[] {
  const canonical = normalizeColorToken(color) ?? color.toLowerCase();
  const aliases = COLOR_CANONICAL_ALIASES[canonical] ?? [canonical];
  const out = new Set<string>([canonical, ...aliases.map((a) => a.toLowerCase())]);
  return [...out];
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
  options?: {
    limit?: number;
    offset?: number;
    includeRelated?: boolean;
    relatedLimit?: number;
    /** When SEARCH_EVAL_LOG is set, used as eval_id instead of a random UUID */
    evalCorrelationId?: string;
  },
): Promise<UnifiedSearchResult> {
  const startTime = Date.now();
  const limit  = options?.limit  ?? 20;
  const offset = options?.offset ?? 0;
  const includeRelated = options?.includeRelated ?? false;
  const relatedLimit = options?.relatedLimit ?? 10;
  const debug = String(process.env.SEARCH_DEBUG ?? "").toLowerCase() === "1";

  try {
    // ── 1. Process query through the AST pipeline ──────────────────────────
    const ast = await processQueryAST(rawQuery);

    // ── 2. Merge filters: caller-supplied take precedence, AST fills gaps ──
    const merged = mergeFilters(callerFilters, ast);
    const callerCategory =
      Array.isArray(callerFilters?.category) ? callerFilters?.category[0] : callerFilters?.category;
    const mergedCategory =
      Array.isArray(merged.category) ? merged.category[0] : merged.category;
    const hasProductTypeConstraint = ast.entities.productTypes?.length > 0;
    const hardAstCategory =
      shouldHardFilterAstCategory(
        ast,
        rawQuery,
        callerCategory,
        mergedCategory,
        hasProductTypeConstraint,
      ) && Boolean(merged.category);
    const productTypeDominant = isProductTypeDominantQuery(ast, rawQuery);
    /** kNN in `must` + min_score collapses recall for type browse (e.g. "jeans"); use boost-only like aisle queries */
    const knnBoostOnly = hardAstCategory || productTypeDominant;

    const categoryVocab = hardAstCategory ? await loadCategoryVocabulary() : null;
    const textMinimumShouldMatch = hardAstCategory || productTypeDominant ? "30%" : "60%";

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

    // Always exclude hidden products from public search.
    filterClauses.push({ term: { is_hidden: false } });

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
                minimum_should_match: textMinimumShouldMatch,
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

    // ── 4.5 Product-type constraints (QueryAST) ────────────────────────────
    //
    // Default: soft — taxonomy-expanded SHOULD on `product_types` + title so
    // "pants" recalls "jeans" without hard-intersecting the candidate set.
    // Opt-in hard filter: SEARCH_STRICT_PRODUCT_TYPE=1 (legacy precision).
    if (hasProductTypeConstraint) {
      const primaryProductType = ast.entities.productTypes[0];
      if (primaryProductType) {
        const seeds = ast.entities.productTypes.map((t) => t.toLowerCase());
        const expandedTypes = expandProductTypesForQuery(seeds);

        if (strictProductTypeFilterEnv()) {
          filterClauses.push({
            bool: {
              _name: 'strict_product_type_filter',
              should: [
                { terms: { product_types: expandedTypes } },
                { match_phrase: { title: primaryProductType.toLowerCase() } },
              ],
              minimum_should_match: 1,
            },
          });
        } else {
          shouldClauses.push({
            bool: {
              _name: 'soft_product_type_boost',
              should: [
                { terms: { product_types: expandedTypes, boost: 5.0 } },
                {
                  multi_match: {
                    query: expandedTypes.slice(0, 24).join(' '),
                    fields: ['title^2.5', 'category.search^1.2'],
                    type: 'best_fields',
                    operator: 'or',
                    boost: 1.4,
                  },
                },
              ],
              minimum_should_match: 0,
            },
          });
        }
      }
    }

    const explicitColorsRaw = (callerFilters as any)?.colors;
    const explicitColors =
      Array.isArray(explicitColorsRaw) && explicitColorsRaw.length > 0
        ? explicitColorsRaw.map((c: any) => String(c).toLowerCase())
        : undefined;

    const explicitColorFallback = callerFilters?.color
      ? [callerFilters.color.toLowerCase()]
      : undefined;

    const colorsForFilterRaw = explicitColors ?? explicitColorFallback ?? ast.entities.colors.map((c) => c.toLowerCase());
    const colorsForFilter = [...new Set(
      colorsForFilterRaw
        .map((c) => normalizeColorToken(c) ?? c.toLowerCase())
        .filter(Boolean)
    )];
    const colorMode =
      (callerFilters as any)?.colorMode ??
      ast.filters?.colorMode ??
      "any";

    if (colorsForFilter.length > 0) {
      // Precision rule:
      // - When the query asks for ONE color token, filter by the product's *primary*
      //   color (`attr_color`) first. This avoids matches where `attr_colors`
      //   contains the requested color only as a secondary accent.
      // - For multi-color queries we keep recall-focused matching on `attr_colors`.
      if (colorsForFilter.length === 1) {
        const expanded = expandColorTermsForFilter(colorsForFilter[0]);
        filterClauses.push({ terms: { attr_color: expanded } });
      } else if (colorMode === "all") {
        filterClauses.push({
          bool: {
            must: colorsForFilter.map((c) => ({ terms: { attr_colors: expandColorTermsForFilter(c) } })),
          },
        });
      } else {
        // colorMode === "any"
        const expanded = [...new Set(colorsForFilter.flatMap((c) => expandColorTermsForFilter(c)))];
        filterClauses.push({ terms: { attr_colors: expanded } });
      }
    }

    // ── 5. Apply merged filters ────────────────────────────────────────────
    //
    // Entity-extracted values: use as SHOULD boosts (they may not match
    // the exact keyword values stored in OpenSearch).
    // Caller-supplied values: use as hard FILTER constraints.
    if (mergedCategory) {
      if (callerFilters?.category) {
        const cc = callerFilters.category as string | string[];
        if (Array.isArray(cc)) {
          const terms = cc.map((c) => String(c).toLowerCase()).filter(Boolean);
          if (terms.length > 0) filterClauses.push({ terms: { category: terms } });
        } else {
          filterClauses.push({ term: { category: String(cc).toLowerCase() } });
        }
      } else if (hardAstCategory && categoryVocab) {
        const resolved = resolveCategoryTermsForOpensearch(mergedCategory, categoryVocab);
        if (resolved.length > 0) {
          filterClauses.push({
            bool: {
              _name: "hard_ast_category_filter",
              should: [
                { terms: { category: resolved } },
                { terms: { category_canonical: resolved } },
              ],
              minimum_should_match: 1,
            },
          });
        }
      } else if (!hasProductTypeConstraint) {
        const catAliases = getCategorySearchTerms(mergedCategory);
        shouldClauses.push({
          bool: {
            should: [
              ...catAliases.map((alias) => ({
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
    // Color is handled as strict attr_colors filtering above.
    if (merged.gender) {
      const g = merged.gender.toLowerCase();
      // Treat extracted gender as a hard constraint for determinism.
      // Titles sometimes include "Men"/"Women" even when attr_gender is missing,
      // so we match on either attr_gender OR title phrase.
      filterClauses.push({
        bool: {
          _name: "strict_gender_filter",
          should: [
            { term: { attr_gender: g } },
            { match_phrase: { title: g } },
          ],
          minimum_should_match: 1,
        },
      });
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

    // Color-aware semantic boost: when query contains explicit color tokens,
    // search over per-item color embeddings (if available in index) to
    // distinguish e.g. "white hoodie" vs "black hoodie".
    if (colorsForFilter.length > 0) {
      try {
        const colorEmbedding = await attributeEmbeddings.generateTextAttributeEmbedding(
          colorsForFilter.join(" "),
          "color"
        );
        shouldClauses.push({
          knn: {
            embedding_color: {
              vector: colorEmbedding,
              k: Math.min(Math.max(limit * 4, 80), 400),
            },
          },
        });
      } catch (err) {
        console.warn("[textSearch] color embedding boost failed:", err);
      }
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
      _source: [
        'product_id',
        'title',
        'brand',
        'price_usd',
        'image_cdn',
        'category',
        'category_canonical',
        'canonical_id',
        'attr_gender',
        'attr_color',
        'attr_colors',
        'product_types',
      ],
    };

    // ── 6. Optional hybrid kNN ───────────────────────────────────────────────
    //
    // Default: kNN in `must` with min_score (text + embedding agreement).
    // Category-dominant queries: kNN in `should` only (BM25 + hard category filter drive precision).
    //
    // OpenSearch cosinesimil score = (1 + cosine) / 2, range [0, 1].
    const queryTokenCount =
      ast.tokens?.important?.length && ast.tokens.important.length > 0
        ? ast.tokens.important.length
        : ast.searchQuery.trim().split(/\s+/).filter(Boolean).length;
    let embeddingMinSimilarity = config.clip.similarityThreshold;
    if (queryTokenCount <= 2) embeddingMinSimilarity = Math.min(embeddingMinSimilarity, 0.58);
    if (queryTokenCount >= 5) embeddingMinSimilarity = Math.min(embeddingMinSimilarity, 0.52);
    if (hasProductTypeConstraint || colorsForFilter.length > 0) {
      embeddingMinSimilarity = Math.min(embeddingMinSimilarity, 0.55);
    }
    const EMBEDDING_MIN_SIMILARITY = Math.max(0.35, embeddingMinSimilarity);
    let embedding: number[] | null = null;
    try {
      embedding = await getQueryEmbedding(ast.searchQuery);
    } catch (err) {
      console.warn('[textSearch] Embedding generation failed, proceeding with BM25-only:', err);
    }
    let mustWithoutKnnForRetry: any[] | null = null;
    if (embedding) {
      mustWithoutKnnForRetry = mustClauses.filter((c: any) => !c?.knn);

      if (knnBoostOnly) {
        shouldClauses.push({
          knn: {
            embedding: {
              vector: embedding,
              k: Math.min(Math.max(limit * 4, 80), 400),
            },
          },
        });
      } else {
        searchBody.query.bool.must.push({
          knn: {
            embedding: {
              vector: embedding,
              min_score: EMBEDDING_MIN_SIMILARITY,
            },
          },
        });
      }
      searchBody.query.bool.should = shouldClauses;
    }

    // ── 7. Execute ─────────────────────────────────────────────────────────
    console.log('[textSearch] Query:', JSON.stringify({
      raw: rawQuery, processed: ast.searchQuery,
      entities: { category: merged.category, brand: merged.brand, color: merged.color, gender: merged.gender },
      corrections: ast.corrections.map((c: any) => `${c.original}→${c.corrected}`),
      mustCount: mustClauses.length, shouldCount: searchBody.query.bool.should?.length ?? 0,
      filterCount: filterClauses.length, hasEmbedding: !!embedding,
      hardAstCategory,
      productTypeDominant,
      knnMode: embedding ? (knnBoostOnly ? "should_boost" : "must_min_score") : "none",
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
        _source: [
          "product_id",
          "title",
          "brand",
          "price_usd",
          "image_cdn",
          "category",
          "attr_gender",
          "attr_color",
          "attr_colors",
          "product_types",
        ],
      };

      response = await opensearch.search({ index: config.opensearch.index, body: fallbackBody });
    }

    // If kNN (embedding) caused zero hits for an otherwise valid BM25 query,
    // retry without embedding constraints to avoid "perfect query => 0 results".
    const firstTotal = response.body.hits.total?.value ?? response.body.hits.total ?? 0;
    const hadEmbedding = Boolean(embedding);
    if (hadEmbedding && firstTotal === 0) {
      if (mustWithoutKnnForRetry && mustWithoutKnnForRetry.length > 0) {
        console.warn('[textSearch] Zero hits with embedding; retrying BM25-only.');
        const bm25Body: any = {
          ...searchBody,
          query: {
            bool: {
              must: mustWithoutKnnForRetry,
              should: shouldClauses,
              filter: filterClauses,
              minimum_should_match: 0,
            },
          },
        };
        response = await opensearch.search({ index: config.opensearch.index, body: bm25Body });
      }
    }

    // ── 7.5 Strict filter relaxation (Phase 2 robustness) ────────────────
    //
    // If strict constraints (product_types and/or attr_colors) produce 0 hits,
    // retry without color constraints first (keep product_types), then without
    // product_types if still zero.
    let relaxedUsed = false;
    let currentTotal = response.body.hits.total?.value ?? response.body.hits.total ?? 0;
    const hasStrictColor = colorsForFilter.length > 0;
    const hasStrictProductTypeConstraint = hasProductTypeConstraint;

    const isColorFilterClause = (c: any): boolean => {
      if (!c) return false;
      if (c?.term?.attr_color) return true;
      if (c?.terms?.attr_colors) return true;
      if (c?.term?.attr_colors) return true;
      if (c?.bool?.must && Array.isArray(c.bool.must)) {
        // Our AND-mode filter uses: { bool: { must: [ { term:{attr_colors:...}}, ... ] } }
        return c.bool.must.every((m: any) => Boolean(m?.term?.attr_colors));
      }
      return false;
    };

    const isProductTypeFilterClause = (c: any): boolean => {
      if (!c) return false;
      if (c?.bool?._name === "strict_product_type_filter") return true;
      return Boolean(c?.term?.product_types) || Boolean(c?.terms?.product_types);
    };

    const isGenderFilterClause = (c: any): boolean => {
      if (!c) return false;
      if (c?.bool?._name === "strict_gender_filter") return true;
      return Boolean(c?.term?.attr_gender) || Boolean(c?.terms?.attr_gender);
    };

    const isHardAstCategoryClause = (c: any): boolean => c?.bool?._name === "hard_ast_category_filter";

    if (currentTotal === 0 && hardAstCategory && mergedCategory) {
      const widen = getCategorySearchTerms(mergedCategory).map((t) => t.toLowerCase());
      const replacedFilter = filterClauses.map((c) =>
        isHardAstCategoryClause(c) ? { terms: { category: widen } } : c,
      );
      console.warn("[textSearch] relaxed: category filter widened to full alias list (0 hits with vocab-narrow terms).");
      const widenBody: any = {
        ...searchBody,
        query: {
          bool: {
            must: mustWithoutKnnForRetry ?? mustClauses.filter((c: any) => !c?.knn),
            should: shouldClauses,
            filter: replacedFilter,
            minimum_should_match: 0,
          },
        },
      };
      response = await opensearch.search({ index: config.opensearch.index, body: widenBody });
      currentTotal = response.body.hits.total?.value ?? response.body.hits.total ?? currentTotal;
      relaxedUsed = true;
    }

    const filterWithoutColors = filterClauses.filter((c) => !isColorFilterClause(c));
    const filterWithoutProductTypes = filterClauses.filter((c) => !isProductTypeFilterClause(c));
    const filterWithoutGender = filterClauses.filter((c) => !isGenderFilterClause(c));

    // If single-color strict filter by `attr_color` yields 0 hits,
    // retry by allowing `attr_colors` (multi-color palette) matches.
    const usedPrimaryColorOnlyFilter = colorsForFilter.length === 1 && filterClauses.some((c) => Boolean(c?.term?.attr_color));
    if (currentTotal === 0 && usedPrimaryColorOnlyFilter) {
      console.warn("[textSearch] 0 hits with primary color; retrying using attr_colors.");
      const colorOnlyWithoutPrimary = filterWithoutColors;
      const relaxedBody: any = {
        ...searchBody,
        query: {
          ...searchBody.query,
          bool: {
            ...searchBody.query.bool,
            // Keep everything except remove strict primary-color constraint.
            filter: [...colorOnlyWithoutPrimary, { terms: { attr_colors: colorsForFilter } }],
            // Preserve must/should exactly as in the first attempt.
          },
        },
      };
      response = await opensearch.search({ index: config.opensearch.index, body: relaxedBody });
      currentTotal =
        response.body.hits.total?.value ?? response.body.hits.total ?? currentTotal;
    }
    if (currentTotal === 0 && hasStrictColor && filterWithoutColors.length > 0) {
      console.warn("[textSearch] Zero hits with strict colors; retrying without colors.");
      const relaxedBody: any = {
        ...searchBody,
        query: {
          bool: {
            must: mustWithoutKnnForRetry ?? mustClauses.filter((c: any) => !c?.knn),
            should: shouldClauses,
            filter: filterWithoutColors,
            minimum_should_match: 0,
          },
        },
      };
      response = await opensearch.search({ index: config.opensearch.index, body: relaxedBody });
      relaxedUsed = true;
    }

    const totalAfterColorRelax =
      response.body.hits.total?.value ?? response.body.hits.total ?? 0;
    if (totalAfterColorRelax === 0 && hasStrictProductTypeConstraint && filterWithoutProductTypes.length > 0) {
      console.warn("[textSearch] Still zero hits; retrying without product_types.");
      const baseFilter = hasStrictColor ? filterWithoutColors : filterClauses;
      const relaxedBody: any = {
        ...searchBody,
        query: {
          bool: {
            must: mustWithoutKnnForRetry ?? mustClauses.filter((c: any) => !c?.knn),
            should: shouldClauses,
            filter: baseFilter.filter((c: any) => !isProductTypeFilterClause(c)),
            minimum_should_match: 0,
          },
        },
      };
      response = await opensearch.search({ index: config.opensearch.index, body: relaxedBody });
      relaxedUsed = true;
    }

    // Final robustness: if strict gender filter produced 0 hits, relax gender.
    const hasStrictGender = Boolean(ast.entities.gender);
    const totalAfterAll =
      response.body.hits.total?.value ?? response.body.hits.total ?? 0;
    if (totalAfterAll === 0 && hasStrictGender && filterWithoutGender.length > 0) {
      console.warn("[textSearch] Still zero hits; retrying without gender filter.");
      const relaxedBody: any = {
        ...searchBody,
        query: {
          bool: {
            must: mustWithoutKnnForRetry ?? mustClauses.filter((c: any) => !c?.knn),
            should: shouldClauses,
            filter: filterWithoutGender,
            minimum_should_match: 0,
          },
        },
      };
      response = await opensearch.search({ index: config.opensearch.index, body: relaxedBody });
      relaxedUsed = true;
    }

    const hits = response.body.hits.hits;
    const productIds: string[] = hits.map((hit: any) => String(hit._source.product_id));

    // Normalize scores into ~[0,1] for `similarity_score`
    const maxScore = hits.length > 0 ? hits[0]._score ?? 1 : 1;
    const scoreMap = new Map<string, number>();
    hits.forEach((hit: any) => {
      const rawScore = hit?._score ?? 0;
      const normalized = maxScore > 0 ? rawScore / maxScore : 0;
      scoreMap.set(String(hit._source.product_id), Math.round(normalized * 100) / 100);
    });

    // Deterministic constraint-aware reranking (Phase 3)
    const desiredProductTypes = (ast.entities.productTypes || []).map((t) => t.toLowerCase());
    const desiredColors = [...new Set(
      ast.entities.colors
        .map((c) => normalizeColorToken(c) ?? c.toLowerCase())
        .filter(Boolean)
    )];
    const rerankColorMode = ast.filters?.colorMode ?? "any";

    const complianceById = new Map<
      string,
      {
        productTypeCompliance: number;
        colorCompliance: number;
        rerankScore: number;
      }
    >();

    const colorById = new Map<string, string | null>();

    for (const hit of hits) {
      const idStr = String(hit?._source?.product_id);
      const similarity = scoreMap.get(idStr) ?? 0;

      const productTypesRaw = hit?._source?.product_types;
      const productTypes: string[] = Array.isArray(productTypesRaw)
        ? productTypesRaw.map((x: any) => String(x).toLowerCase())
        : productTypesRaw
          ? [String(productTypesRaw).toLowerCase()]
          : [];

      const attrColorsRaw = hit?._source?.attr_colors;
      let productColors: string[] = Array.isArray(attrColorsRaw)
        ? attrColorsRaw.map((x: any) => String(x).toLowerCase())
        : attrColorsRaw
          ? [String(attrColorsRaw).toLowerCase()]
          : hit?._source?.attr_color
            ? [String(hit._source.attr_color).toLowerCase()]
            : [];

      productColors = [...new Set(productColors
        .map((c: string) => normalizeColorToken(c) ?? c.toLowerCase())
        .filter(Boolean))];

      if (productColors.length === 0 && typeof hit?._source?.title === "string") {
        const inferred = extractAttributesSync(String(hit._source.title));
        const inferredColors = inferred.attributes.colors && inferred.attributes.colors.length > 0
          ? inferred.attributes.colors
          : inferred.attributes.color
            ? [inferred.attributes.color]
            : [];
        if (inferredColors.length > 0) {
          productColors = inferredColors
            .map((c: string) => normalizeColorToken(c) ?? c.toLowerCase())
            .filter(Boolean) as string[];
        }
      }

      const primaryColor = hit?._source?.attr_color
        ? (normalizeColorToken(String(hit._source.attr_color)) ?? String(hit._source.attr_color).toLowerCase())
        : productColors.length > 0
          ? productColors[0]
          : null;
      colorById.set(idStr, primaryColor);

      // Product-type compliance: taxonomy-aware (pants ≈ jeans via cluster / hypernym).
      let productTypeCompliance = 0;
      if (desiredProductTypes.length > 0) {
        const expandedDesired = expandProductTypesForQuery(desiredProductTypes);
        const tax = scoreProductTypeTaxonomyMatch(expandedDesired, productTypes, {
          sameClusterWeight: 0.82,
        });
        productTypeCompliance = tax.score;
      }

      // Color compliance: exact behavior depends on colorMode.
      let colorCompliance = 0;
      if (desiredColors.length > 0) {
        if (productColors.length === 0) {
          colorCompliance = 0;
        } else if (rerankColorMode === "all") {
          colorCompliance = desiredColors.every((c) => productColors.includes(c)) ? 1 : 0;
        } else {
          const overlapCount = desiredColors.filter((c) => productColors.includes(c)).length;
          colorCompliance = overlapCount / desiredColors.length;
        }
      }

      // Prioritize type + color, then use normalized OpenSearch score for tie-breaking.
      const rerankScore = productTypeCompliance * 1000 + colorCompliance * 100 + similarity * 10;
      complianceById.set(idStr, { productTypeCompliance, colorCompliance, rerankScore });
    }

    // Hard precision gate for explicit color queries:
    // never return items that fail color compliance, even if fallback search
    // had to relax color filters to avoid zero OpenSearch hits.
    let finalProductIds = [...productIds];
    if (desiredColors.length > 0) {
      const compliantIds = finalProductIds.filter((id) => (complianceById.get(id)?.colorCompliance ?? 0) > 0);
      if (compliantIds.length > 0) {
        finalProductIds = compliantIds;
      } else {
        // Keep recall when metadata quality is poor; do not hard-drop to zero.
        // (Color precision is still enforced when we have compliant candidates.)
      }
    }

    // Fetch hydrated product + images while preserving OpenSearch ranking order
    const products = await getProductsByIdsOrdered(finalProductIds);
    const numericIds = finalProductIds.map((id) => parseInt(id, 10)).filter(Number.isFinite);
    const imagesByProduct = await getImagesForProducts(numericIds);

    let results: ProductResult[] = products.map((p: any) => {
      const productIdStr = String(p.id);
      const images = imagesByProduct.get(parseInt(p.id, 10)) || [];
      const similarityScore = scoreMap.get(productIdStr) ?? 0;
      const compliance = complianceById.get(productIdStr);

      return {
        ...p,
        // Ensure UI color matches the OpenSearch attribute that retrieval used.
        color: colorById.get(productIdStr) ?? p.color ?? null,
        similarity_score: similarityScore,
        match_type: similarityScore >= 0.8 ? 'exact' : 'similar',
        rerankScore: compliance?.rerankScore ?? undefined,
        explain: compliance
          ? {
              productTypeCompliance: compliance.productTypeCompliance,
              colorCompliance: compliance.colorCompliance,
              desiredProductTypes,
              desiredColors,
              colorMode: rerankColorMode,
            }
          : undefined,
        images: images.map((img) => ({
          id: img.id,
          url: img.cdn_url,
          is_primary: img.is_primary,
          p_hash: img.p_hash ?? undefined,
        })),
      } as ProductResult;
    });

    // Sort by deterministic rerank score (constraints first),
    // then by normalized similarity for stable tie-breaking.
    results.sort((a, b) => {
      const ar = a.rerankScore ?? 0;
      const br = b.rerankScore ?? 0;
      if (br !== ar) return br - ar;
      return (scoreMap.get(String(b.id)) ?? 0) - (scoreMap.get(String(a.id)) ?? 0);
    });

    if (results.length === 0) {
      const openSearchHitsTotal =
        response.body.hits.total?.value ?? response.body.hits.total ?? 0;
      console.warn("[textSearch][zero-results-debug]", {
        rawQuery,
        searchQuery: ast.searchQuery,
        openSearchHitsTotal,
        openSearchHitsCount: hits.length,
        productIdsFirst: productIds[0] ?? null,
        hydratedProductsCount: products.length,
        hydratedFirstProductId: products[0]?.id ?? null,
        filterClausesCount: filterClauses.length,
        hasProductTypeConstraint,
        colorsForFilter,
        colorMode,
      });
    }

    // Optional ML tie-breaker (Phase 3 / optional)
    // Feature-flagged via `SEARCH_USE_XGB_RANKER=true`.
    // Only used as a second-stage tiebreaker after deterministic compliance sorting.
    const useXgbRanker = String(process.env.SEARCH_USE_XGB_RANKER ?? "").toLowerCase() === "true";
    const constraintsApplied = desiredProductTypes.length > 0 || desiredColors.length > 0;
    if (useXgbRanker && constraintsApplied && results.length > 3) {
      try {
        const rankerOk = await isRankerAvailable();
        if (rankerOk) {
          // Use the best candidate as a "base context" for category/color compatibility features.
          const baseProduct = results[0];
          const basePriceCents = baseProduct.price_cents || 1;

          const baseCtx = {
            id: parseInt(baseProduct.id, 10) || 0,
            title: baseProduct.title || "",
            brand: baseProduct.brand,
            category: baseProduct.category,
            color: desiredColors[0] ?? baseProduct.color,
            vendorId: baseProduct.vendor_id,
            priceCents: basePriceCents,
          };

          const candidates = results.map((p: any, idx: number) => ({
            candidateId: String(p.id),
            clipSim: 0,
            textSim: typeof p.similarity_score === "number" ? p.similarity_score : 0,
            opensearchScore: typeof p.similarity_score === "number" ? p.similarity_score : 0,
            pHashDist: 64,
            source: "text" as const,
            product: p,
            // `candidate_score` is computed internally in feature builder
            // (via clipSim/textSim).
          }));

          const featureRows = buildFeatureRows(baseCtx as any, candidates as any).map((r: any) => r.featureRow);
          const rankerResult = await predictWithFallback(featureRows);
          const mlScores = rankerResult.scores;

          const mlScoreMap = new Map<string, number>();
          results.forEach((p: any, i: number) => {
            const score = mlScores[i] ?? 0;
            p.mlRerankScore = score;
            mlScoreMap.set(String(p.id), score);
          });

          // Resort within the deterministic compliance buckets.
          results.sort((a: any, b: any) => {
            const aType = a.explain?.productTypeCompliance ?? 0;
            const bType = b.explain?.productTypeCompliance ?? 0;
            if (bType !== aType) return bType - aType;

            const aColor = a.explain?.colorCompliance ?? 0;
            const bColor = b.explain?.colorCompliance ?? 0;
            if (bColor !== aColor) return bColor - aColor;

            return (mlScoreMap.get(String(b.id)) ?? 0) - (mlScoreMap.get(String(a.id)) ?? 0);
          });
        }
      } catch (err) {
        console.warn("[textSearch] XGB ranker tie-breaker failed, keeping deterministic order:", err);
      }
    }

    results = dedupeSearchResults(results as any, { imageHammingMax: 10 }) as ProductResult[];

    // Related products (optional)
    let related: ProductResult[] = [];
    if (includeRelated) {
      const brands = ast.entities.brands.map((b) => b.toLowerCase());
      const categories = ast.entities.categories.map((c) => c.toLowerCase());
      related = await findRelatedProducts(
        results.map((p) => String(p.id)),
        brands,
        categories,
        relatedLimit,
      );
      const relFiltered = filterRelatedAgainstMain(results as any, related as any);
      related = (relFiltered ?? []) as ProductResult[];
    }

    const includeDebug = debug || results.length === 0;

    // ── 8. Build response ──────────────────────────────────────────────────
    const total =
      response.body.hits.total?.value ?? response.body.hits.total ?? results.length ?? 0;
    const didYouMean =
      ast.corrections.length > 0 && ast.confidence < 0.85
        ? `Did you mean "${ast.searchQuery}"?`
        : undefined;

    if (searchEvalEnabled()) {
      const osTotalRaw = response.body.hits.total?.value ?? response.body.hits.total ?? null;
      emitTextSearchEval({
        kind: "text_search",
        eval_id: options?.evalCorrelationId ?? newSearchEvalId(),
        variant: searchEvalVariant(),
        ts_iso: new Date().toISOString(),
        raw_query: rawQuery,
        took_ms: Date.now() - startTime,
        open_search_total: typeof osTotalRaw === "number" ? osTotalRaw : null,
        result_count: results.length,
        hit_ids: results.map((p) => String(p.id)),
        similarity_scores: results.map((p) =>
          typeof p.similarity_score === "number" ? p.similarity_score : 0,
        ),
        rerank_scores: results.map((p) =>
          typeof p.rerankScore === "number" ? p.rerankScore : null,
        ),
        ast: {
          search_query: ast.searchQuery,
          product_types: ast.entities.productTypes ?? [],
          categories: ast.entities.categories ?? [],
          colors: ast.entities.colors ?? [],
          brands: ast.entities.brands ?? [],
        },
        flags: {
          hard_ast_category: hardAstCategory,
          product_type_dominant: productTypeDominant,
          knn_boost_only: knnBoostOnly,
          has_product_type_constraint: hasProductTypeConstraint,
          relaxed_pipeline: relaxedUsed,
          strict_product_type_env: strictProductTypeFilterEnv(),
        },
      });
    }

    return {
      results,
      related: related.length > 0 ? related : undefined,
      total,
      tookMs: Date.now() - startTime,
      query: summarizeAST(ast),
      meta: {
        query: rawQuery,
        total_results: results.length,
        total_related: related.length,
        processed_query: ast,
        did_you_mean: didYouMean,
        ...(includeDebug
          ? {
              debug: {
                openSearchHitsTotal:
                  response.body.hits.total?.value ?? response.body.hits.total ?? null,
                openSearchHitsCount: hits.length,
                openSearchFirstProductId: productIds[0] ?? null,
                hydratedProductsCount: products.length,
                hydratedFirstProductId: (products[0] as any)?.id ?? null,
                filterClausesCount: filterClauses.length,
                hasProductTypeConstraint,
                colorsForFilter,
                colorMode,
              },
            }
          : {}),
      },
    };
  } catch (error) {
    console.error('[textSearch] Error:', error);
    return {
      results: [],
      related: undefined,
      total: 0,
      tookMs: Date.now() - startTime,
      meta: { total_results: 0 },
    };
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
      const category = Array.isArray(options.filters.category)
        ? options.filters.category[0]
        : options.filters.category;
      if (category) {
        filterClauses.push({ term: { category: String(category).toLowerCase() } });
      }
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