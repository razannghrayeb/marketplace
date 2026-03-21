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
import { searchByImageWithSimilarity } from '../products/products.service';
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
  scoreCrossFamilyTypePenalty,
  extractLexicalProductTypeSeeds,
  scoreRerankProductTypeBreakdown,
} from '../../lib/search/productTypeTaxonomy';
import {
  buildQueryUnderstanding,
  searchDomainGateEnabled,
} from '../../lib/search/queryUnderstanding.service';
import { computeEmbeddingFashionScore } from '../../lib/search/fashionDomainSignal';
import {
  emitTextSearchEval,
  searchEvalEnabled,
  newSearchEvalId,
  searchEvalVariant,
} from '../../lib/search/evalHooks';
import { tieredColorListCompliance } from '../../lib/color/colorCanonical';
import { expandColorTermsForFilter, normalizeColorToken } from '../../lib/color/queryColorFilter';

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
  /** Canonical: kids | baby | teen | adult */
  ageGroup?: string;
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
  entities: {
    brands: string[];
    categories: string[];
    colors: string[];
    productTypes?: string[];
    gender?: string;
    ageGroup?: string;
  };
  corrections: Array<{ original: string; corrected: string; source: string }>;
  /** Corrections applied to retrieval (confidence >= 0.85) */
  appliedCorrections?: Array<{ original: string; corrected: string; source: string }>;
  /** Corrections suggested but not applied (0.65 <= confidence < 0.85) */
  suggestedCorrections?: Array<{ original: string; corrected: string; source: string }>;
  /** Control params stripped from query text (limit, page, sort) */
  controlParamsExtracted?: Record<string, string | number>;
  suggestText?: string;
  processingTimeMs: number;
}

export interface MultiImageSearchRequest {
  images: Buffer[];
  userPrompt: string;
  limit?: number;
  rerankWeights?: RerankOptions | any;
}

function strictProductTypeFilterEnv(): boolean {
  const v = String(process.env.SEARCH_STRICT_PRODUCT_TYPE ?? '').toLowerCase();
  return v === '1' || v === 'true';
}

function genderHardFilterMinConfidence(): number {
  const n = Number(process.env.SEARCH_GENDER_HARD_MIN_CONFIDENCE ?? '0.55');
  return Number.isFinite(n) ? Math.min(0.95, Math.max(0.35, n)) : 0.55;
}

/** OpenSearch fetch size: large enough to rerank meaningfully, capped for latency. */
function computeTextRecallSize(limit: number, offset: number): number {
  const w = config.search.recallWindow;
  const cap = config.search.recallMax;
  return Math.min(cap, Math.max(w, offset + limit));
}

/**
 * Calibrated 0..1 relevance for acceptance gating (SEARCH_FINAL_ACCEPT_MIN, default 0.6).
 *
 * Uses match quality only (type / color / OS rank / family penalty). Query and document
 * trust already shape `rerankScore`; multiplying them here again collapsed almost all scores
 * below 0.6 so nothing passed the gate.
 */
function computeFinalRelevance01(params: {
  hasTypeIntent: boolean;
  productTypeCompliance: number;
  exactTypeScore?: number;
  hasColorIntent: boolean;
  colorCompliance: number;
  similarity: number;
  crossFamilyPenalty: number;
  hasAudienceIntent?: boolean;
  audienceCompliance?: number;
}): number {
  const exactBoost =
    params.hasTypeIntent && typeof params.exactTypeScore === 'number'
      ? 0.08 * params.exactTypeScore
      : 0;
  const typePart = params.hasTypeIntent ? 0.34 * params.productTypeCompliance + exactBoost : 0.36;
  const colorPart = params.hasColorIntent ? 0.24 * params.colorCompliance : 0.24;
  const audPart =
    params.hasAudienceIntent && typeof params.audienceCompliance === 'number'
      ? 0.12 * params.audienceCompliance
      : 0.12;
  const simPart = 0.3 * params.similarity;
  const famPen = Math.min(1, params.crossFamilyPenalty) * 0.22;
  const raw = typePart + colorPart + audPart + simPart - famPen;
  return Math.max(0, Math.min(1, raw));
}

function normalizeQueryGender(g: string | undefined): string | null {
  if (!g) return null;
  const x = g.toLowerCase();
  if (x === 'men' || x === 'women' || x === 'unisex') return x;
  return null;
}

function docAgeGroup(hit: any): string | null {
  const raw = hit?._source?.age_group;
  if (raw === undefined || raw === null) return null;
  return String(raw).toLowerCase().trim() || null;
}

function docAudienceGender(hit: any): string | null {
  const raw = hit?._source?.audience_gender ?? hit?._source?.attr_gender;
  if (raw === undefined || raw === null) return null;
  const s = String(raw).toLowerCase().trim();
  if (s === 'men' || s === 'women' || s === 'unisex') return s;
  return null;
}

/**
 * 0..1: query age_group / audience_gender vs indexed audience fields.
 */
function scoreAudienceCompliance(
  queryAgeGroup: string | undefined,
  queryGender: string | undefined,
  hit: any,
): number {
  const wantAge = queryAgeGroup?.toLowerCase().trim();
  const wantG = normalizeQueryGender(queryGender);
  const docAge = docAgeGroup(hit);
  const docG = docAudienceGender(hit);
  const title = typeof hit?._source?.title === 'string' ? hit._source.title.toLowerCase() : '';

  let score = 1;
  let factors = 0;

  if (wantAge) {
    factors += 1;
    if (!docAge) {
      if (wantAge === 'kids' && /\b(kids?|child|children|boys?|girls?|toddler|baby|youth)\b/.test(title)) {
        score *= 0.92;
      } else if (wantAge === 'adult' || wantAge === 'teen') {
        score *= 0.88;
      } else {
        score *= 0.72;
      }
    } else if (docAge === wantAge) {
      score *= 1;
    } else if (wantAge === 'kids' && (docAge === 'baby' || docAge === 'teen')) {
      score *= 0.88;
    } else if (wantAge === 'baby' && docAge === 'kids') {
      score *= 0.85;
    } else {
      score *= 0.38;
    }
  }

  if (wantG) {
    factors += 1;
    if (!docG) {
      if (wantG === 'men' && /\b(men|mens|male)\b/.test(title)) score *= 0.9;
      else if (wantG === 'women' && /\b(women|womens|female|ladies)\b/.test(title)) score *= 0.9;
      else score *= 0.78;
    } else if (docG === 'unisex' || docG === wantG) {
      score *= 1;
    } else {
      score *= 0.35;
    }
  }

  if (factors === 0) return 1;
  return Math.max(0, Math.min(1, Math.pow(score, 1 / factors)));
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
  const recallSize = computeTextRecallSize(limit, offset);
  const finalAcceptMin = config.search.finalAcceptMin;
  const includeRelated = options?.includeRelated ?? false;
  const relatedLimit = options?.relatedLimit ?? 10;
  const debug = String(process.env.SEARCH_DEBUG ?? "").toLowerCase() === "1";

  try {
    // ── 1. Process query through the AST pipeline ──────────────────────────
    const ast = await processQueryAST(rawQuery);

    const callerPinnedColor =
      Boolean(callerFilters?.color) ||
      (Array.isArray((callerFilters as any)?.colors) && (callerFilters as any).colors.length > 0);

    const embeddingFashion01 = await computeEmbeddingFashionScore(
      (ast.searchQuery && ast.searchQuery.trim()) || rawQuery,
    ).catch(() => null);

    const qu = buildQueryUnderstanding(ast, rawQuery, {
      callerPinnedColor,
      embeddingFashion01,
    });

    if (qu.offDomain && searchDomainGateEnabled()) {
      return {
        results: [],
        related: undefined,
        total: 0,
        tookMs: Date.now() - startTime,
        query: summarizeAST(ast),
        meta: {
          query: rawQuery,
          total_results: 0,
          search_off_domain: true,
          domain_confidence: qu.domainConfidence,
          query_understanding: qu,
        } as any,
      };
    }

    // ── 2. Merge filters: caller-supplied take precedence, AST fills gaps ──
    const merged = mergeFilters(callerFilters, ast);
    const callerCategory =
      Array.isArray(callerFilters?.category) ? callerFilters?.category[0] : callerFilters?.category;
    const mergedCategory =
      Array.isArray(merged.category) ? merged.category[0] : merged.category;
    const lexicalTypeSeeds = extractLexicalProductTypeSeeds(rawQuery);
    const hasProductTypeConstraint =
      (ast.entities.productTypes?.length ?? 0) > 0 || lexicalTypeSeeds.length > 0;
    const hardAstCategory =
      shouldHardFilterAstCategory(
        ast,
        rawQuery,
        callerCategory,
        mergedCategory,
        hasProductTypeConstraint,
      ) && Boolean(merged.category);
    const productTypeDominant = isProductTypeDominantQuery(ast, rawQuery);
    /**
     * Default: text kNN is should-boost only (SEARCH_KNN_TEXT_IN_MUST unset).
     * Legacy must+min_score: set SEARCH_KNN_TEXT_IN_MUST=1, then boost-only only for category/type-dominant queries.
     */
    const knnBoostOnly = qu.knnTextBoostOnly ? true : hardAstCategory || productTypeDominant;

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
      ...qu.filteredSynonyms,
      ...qu.filteredCategoryExpansions,
      ...qu.filteredTransliterations,
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
      const typeSeedsRaw =
        ast.entities.productTypes?.length ? ast.entities.productTypes : lexicalTypeSeeds;
      const primaryProductType = typeSeedsRaw[0];
      if (primaryProductType) {
        const seeds = typeSeedsRaw.map((t) => String(t).toLowerCase());
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

    const rerankColorSourcesRaw =
      explicitColors ??
      explicitColorFallback ??
      (ast.entities.colors ?? []).map((c) => c.toLowerCase());
    const rerankDesiredColorsRaw = [...new Set(
      (rerankColorSourcesRaw ?? []).map((c) => String(c).toLowerCase().trim()).filter(Boolean),
    )];
    const rerankDesiredColors = [...new Set(
      rerankColorSourcesRaw
        .map((c) => normalizeColorToken(c) ?? c.toLowerCase())
        .filter(Boolean)
    )];
    const useSoftAstColor =
      qu.softColorFromAst && !callerPinnedColor && rerankDesiredColors.length > 0;
    const hardColorFilterActive = rerankDesiredColors.length > 0 && !useSoftAstColor;
    const colorMode =
      (callerFilters as any)?.colorMode ??
      ast.filters?.colorMode ??
      "any";

    if (hardColorFilterActive) {
      const colorsForFilter = rerankDesiredColors;
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
        const expanded = [...new Set(colorsForFilter.flatMap((c) => expandColorTermsForFilter(c)))];
        filterClauses.push({ terms: { attr_colors: expanded } });
      }
    } else if (rerankDesiredColors.length > 0 && useSoftAstColor) {
      const expanded = [...new Set(rerankDesiredColors.flatMap((c) => expandColorTermsForFilter(c)))];
      shouldClauses.push({
        bool: {
          _name: "soft_ast_color_boost",
          should: [
            { terms: { attr_color: expanded, boost: 5.0 } },
            { terms: { attr_colors: expanded, boost: 3.2 } },
            { terms: { attr_colors_text: expanded, boost: 2.4 } },
            { terms: { attr_colors_image: expanded, boost: 4.0 } },
          ],
          minimum_should_match: 0,
        },
      });
    }

    const hasColorIntent = rerankDesiredColors.length > 0;

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
      } else if (
        !hasProductTypeConstraint ||
        (ast.entities.categories?.length ?? 0) > 0
      ) {
        // Keep aisle/category soft signals when AST extracted a category alongside product type
        // (lexical-only type seeds no longer suppress this after word-boundary fixes).
        const catBoost =
          hasProductTypeConstraint && (ast.entities.categories?.length ?? 0) > 0 ? 0.82 : 1;
        const catAliases = getCategorySearchTerms(mergedCategory);
        shouldClauses.push({
          bool: {
            should: [
              ...catAliases.map((alias) => ({
                term: { category: { value: alias.toLowerCase(), boost: 3.0 * catBoost } },
              })),
              {
                match: {
                  'category.search': {
                    query: catAliases.join(' '),
                    boost: 2.0 * catBoost,
                    fuzziness: 'AUTO',
                  },
                },
              },
              {
                multi_match: {
                  query: catAliases.join(' '),
                  fields: ['title^2'],
                  fuzziness: 'AUTO',
                  boost: 1.5 * catBoost,
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
    const genderFromCaller = Boolean(callerFilters?.gender);
    const ageFromCaller = Boolean((callerFilters as SearchFilters | undefined)?.ageGroup);
    const mergedAgeGroup = (merged as { ageGroup?: string }).ageGroup ?? ast.entities.ageGroup;
    const useHardAudienceFilter =
      (Boolean(merged.gender) || Boolean(mergedAgeGroup)) &&
      (genderFromCaller || ageFromCaller || ast.confidence >= genderHardFilterMinConfidence());
    const gNorm = merged.gender ? merged.gender.toLowerCase() : "";

    if (merged.gender && useHardAudienceFilter && normalizeQueryGender(merged.gender)) {
      const g = gNorm;
      filterClauses.push({
        bool: {
          _name: "strict_gender_filter",
          should: [
            { term: { attr_gender: g } },
            { term: { audience_gender: g } },
            { match_phrase: { title: g } },
          ],
          minimum_should_match: 1,
        },
      });
    } else if (merged.gender && normalizeQueryGender(merged.gender)) {
      shouldClauses.push({
        bool: {
          _name: "soft_gender_boost",
          should: [
            { term: { attr_gender: { value: gNorm, boost: 6.0 } } },
            { term: { audience_gender: { value: gNorm, boost: 6.0 } } },
            { match_phrase: { title: { query: gNorm, boost: 4.0 } } },
          ],
          minimum_should_match: 0,
        },
      });
    }

    if (mergedAgeGroup && useHardAudienceFilter) {
      const ag = String(mergedAgeGroup).toLowerCase();
      filterClauses.push({
        bool: {
          _name: "strict_age_group_filter",
          should: [
            { term: { age_group: ag } },
            {
              bool: {
                must: [{ match_phrase: { title: ag } }],
              },
            },
          ],
          minimum_should_match: 1,
        },
      });
    } else if (mergedAgeGroup) {
      const ag = String(mergedAgeGroup).toLowerCase();
      shouldClauses.push({
        bool: {
          _name: "soft_age_group_boost",
          should: [
            { term: { age_group: { value: ag, boost: 5.5 } } },
            { match_phrase: { title: { query: ag, boost: 2.2 } } },
          ],
          minimum_should_match: 0,
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
    if (hasColorIntent) {
      try {
        const colorEmbedding = await attributeEmbeddings.generateTextAttributeEmbedding(
          rerankDesiredColors.join(" "),
          "color"
        );
        shouldClauses.push({
          knn: {
            embedding_color: {
              vector: colorEmbedding,
              k: Math.min(Math.max(recallSize * 2, 80), 400),
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
      from: 0,
      size: recallSize,
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
        'attr_colors_text',
        'attr_colors_image',
        'norm_confidence',
        'category_confidence',
        'brand_confidence',
        'type_confidence',
        'color_confidence_text',
        'color_confidence_image',
        'color_palette_canonical',
        'color_primary_canonical',
        'color_secondary_canonical',
        'color_accent_canonical',
        'product_types',
        'age_group',
        'audience_gender',
      ],
    };

    // ── 6. Optional hybrid kNN ───────────────────────────────────────────────
    //
    // Default: kNN in `should` (boost-only) unless SEARCH_KNN_TEXT_IN_MUST=1.
    // Borderline-fashion queries skip CLIP kNN entirely (BM25-only).
    //
    // OpenSearch cosinesimil score = (1 + cosine) / 2, range [0, 1].
    const queryTokenCount =
      ast.tokens?.important?.length && ast.tokens.important.length > 0
        ? ast.tokens.important.length
        : ast.searchQuery.trim().split(/\s+/).filter(Boolean).length;
    let embeddingMinSimilarity = config.clip.similarityThreshold;
    if (queryTokenCount <= 2) embeddingMinSimilarity = Math.min(embeddingMinSimilarity, 0.58);
    if (queryTokenCount >= 5) embeddingMinSimilarity = Math.min(embeddingMinSimilarity, 0.52);
    if (hasProductTypeConstraint || hasColorIntent) {
      embeddingMinSimilarity = Math.min(embeddingMinSimilarity, 0.55);
    }
    const EMBEDDING_MIN_SIMILARITY = Math.max(0.35, embeddingMinSimilarity);
    let embedding: number[] | null = null;
    if (!qu.borderlineFashion) {
      try {
        embedding = await getQueryEmbedding(ast.searchQuery);
      } catch (err) {
        console.warn('[textSearch] Embedding generation failed, proceeding with BM25-only:', err);
      }
    }
    let mustWithoutKnnForRetry: any[] | null = null;
    if (embedding) {
      mustWithoutKnnForRetry = mustClauses.filter((c: any) => !c?.knn);

      if (knnBoostOnly) {
        shouldClauses.push({
          knn: {
            embedding: {
              vector: embedding,
              k: Math.min(Math.max(recallSize * 2, 80), 400),
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
      recallSize,
      finalAcceptMin,
      queryUnderstanding: {
        offDomain: qu.offDomain,
        borderlineFashion: qu.borderlineFashion,
        domainConfidence: qu.domainConfidence,
        softAstColor: useSoftAstColor,
        expansionTerms: expansionTerms.length,
      },
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
        from: 0,
        size: recallSize,
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
          "attr_colors_text",
          "attr_colors_image",
          "norm_confidence",
          "category_confidence",
          "type_confidence",
          "color_confidence_text",
          "color_confidence_image",
          "product_types",
          "age_group",
          "audience_gender",
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
    const hasStrictColor = hardColorFilterActive;
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

    const isAgeGroupFilterClause = (c: any): boolean =>
      Boolean(c?.bool?._name === "strict_age_group_filter");

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
    const filterWithoutAudience = filterClauses.filter(
      (c) => !isGenderFilterClause(c) && !isAgeGroupFilterClause(c),
    );

    // If single-color strict filter by `attr_color` yields 0 hits,
    // retry by allowing `attr_colors` (multi-color palette) matches.
    const usedPrimaryColorOnlyFilter =
      rerankDesiredColors.length === 1 && filterClauses.some((c) => Boolean(c?.term?.attr_color));
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
            filter: [
              ...colorOnlyWithoutPrimary,
              {
                terms: {
                  attr_colors: [...new Set(rerankDesiredColors.flatMap((c) => expandColorTermsForFilter(c)))],
                },
              },
            ],
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

    // Final robustness: if strict audience filters produced 0 hits, relax them.
    const hasStrictAudience =
      Boolean(ast.entities.gender) || Boolean(ast.entities.ageGroup);
    const totalAfterAll =
      response.body.hits.total?.value ?? response.body.hits.total ?? 0;
    if (totalAfterAll === 0 && hasStrictAudience && filterWithoutAudience.length > 0) {
      console.warn("[textSearch] Still zero hits; retrying without gender/age filters.");
      const relaxedBody: any = {
        ...searchBody,
        query: {
          bool: {
            must: mustWithoutKnnForRetry ?? mustClauses.filter((c: any) => !c?.knn),
            should: shouldClauses,
            filter: filterWithoutAudience,
            minimum_should_match: 0,
          },
        },
      };
      response = await opensearch.search({ index: config.opensearch.index, body: relaxedBody });
      relaxedUsed = true;
    }

    const hits = response.body.hits.hits;

    // Normalize scores into ~[0,1] for `similarity_score` (max-of-recall vs tanh of raw OS score)
    const maxScore = hits.length > 0 ? hits[0]._score ?? 1 : 1;
    const useTanhSim = config.search.similarityNormalize === "tanh";
    const tanhScale = config.search.similarityTanhScale;
    const scoreMap = new Map<string, number>();
    hits.forEach((hit: any) => {
      const rawScore = hit?._score ?? 0;
      const positive = Math.max(0, rawScore);
      const normalized = useTanhSim
        ? Math.max(0, Math.min(1, Math.tanh(positive / tanhScale)))
        : maxScore > 0
          ? positive / maxScore
          : 0;
      scoreMap.set(String(hit._source.product_id), Math.round(normalized * 100) / 100);
    });

    // Deterministic constraint-aware reranking (Phase 3)
    const astProductTypes = (ast.entities.productTypes || []).map((t) => t.toLowerCase());
    const desiredProductTypes = [
      ...new Set([...astProductTypes, ...lexicalTypeSeeds.map((s) => s.toLowerCase())]),
    ];
    const desiredColors = [...new Set(rerankDesiredColors)];
    const desiredColorsTier = rerankDesiredColorsRaw.length > 0 ? rerankDesiredColorsRaw : desiredColors;
    const rerankColorMode = ast.filters?.colorMode ?? "any";
    const crossFamilyPenaltyWeight = Math.max(
      0,
      Math.min(2000, Number(process.env.SEARCH_CROSS_FAMILY_PENALTY_WEIGHT ?? "420") || 420),
    );

    const complianceById = new Map<
      string,
      {
        productTypeCompliance: number;
        exactTypeScore: number;
        siblingClusterScore: number;
        parentHypernymScore: number;
        intraFamilyPenalty: number;
        colorCompliance: number;
        matchedColor: string | null;
        colorTier: "exact" | "family" | "bucket" | "none";
        crossFamilyPenalty: number;
        audienceCompliance: number;
        osSimilarity01: number;
        rerankScore: number;
        finalRelevance01: number;
      }
    >();

    const queryAgeGroup = mergedAgeGroup ?? ast.entities.ageGroup;
    const queryGenderForAudience = normalizeQueryGender(merged.gender);
    const hasAudienceIntent = Boolean(queryAgeGroup || queryGenderForAudience);

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

      const mergeColorArrays = (...parts: unknown[]): string[] => {
        const out: string[] = [];
        for (const part of parts) {
          const arr = Array.isArray(part)
            ? part.map((x: any) => String(x).toLowerCase())
            : part
              ? [String(part).toLowerCase()]
              : [];
          for (const c of arr) {
            if (c && !out.includes(c)) out.push(c);
          }
        }
        return out;
      };

      const attrColorsRaw = hit?._source?.attr_colors;
      const attrText = hit?._source?.attr_colors_text;
      const attrImg = hit?._source?.attr_colors_image;

      const rawColorList = (...parts: unknown[]): string[] => [
        ...new Set(
          mergeColorArrays(...parts)
            .map((c: string) => String(c).toLowerCase().trim())
            .filter(Boolean),
        ),
      ];

      let imgTierRaw = rawColorList(hit?._source?.color_palette_canonical, attrImg);
      let textTierRaw = rawColorList(attrText);
      let unionTierRaw = rawColorList(
        hit?._source?.color_palette_canonical,
        attrColorsRaw,
        attrText,
        attrImg,
        hit?._source?.color_primary_canonical,
        hit?._source?.color_secondary_canonical,
        hit?._source?.color_accent_canonical,
      );

      if (unionTierRaw.length === 0 && hit?._source?.attr_color) {
        unionTierRaw = rawColorList(hit._source.attr_color);
      }

      if (unionTierRaw.length === 0 && typeof hit?._source?.title === "string") {
        const inferred = extractAttributesSync(String(hit._source.title));
        const inferredColors =
          inferred.attributes.colors && inferred.attributes.colors.length > 0
            ? inferred.attributes.colors
            : inferred.attributes.color
              ? [inferred.attributes.color]
              : [];
        for (const c of inferredColors) {
          const x = String(c).toLowerCase().trim();
          if (x && !unionTierRaw.includes(x)) unionTierRaw.push(x);
        }
        if (textTierRaw.length === 0 && inferredColors.length > 0) {
          textTierRaw = rawColorList(inferredColors);
        }
      }

      const productColors = [
        ...new Set(unionTierRaw.map((c) => normalizeColorToken(c) ?? c).filter(Boolean)),
      ];

      const primaryColor = hit?._source?.color_primary_canonical
        ? String(hit._source.color_primary_canonical).toLowerCase()
        : hit?._source?.attr_color
          ? String(hit._source.attr_color).toLowerCase()
          : productColors.length > 0
            ? productColors[0]
            : null;
      colorById.set(idStr, primaryColor);

      // Product-type: exact seeds vs doc (no query-side cluster expansion in compliance).
      let productTypeCompliance = 0;
      let exactTypeScore = 0;
      let siblingClusterScore = 0;
      let parentHypernymScore = 0;
      let intraFamilyPenalty = 0;
      if (desiredProductTypes.length > 0) {
        const typeBreak = scoreRerankProductTypeBreakdown(desiredProductTypes, productTypes);
        productTypeCompliance = typeBreak.combinedTypeCompliance;
        exactTypeScore = typeBreak.exactTypeScore;
        siblingClusterScore = typeBreak.siblingClusterScore;
        parentHypernymScore = typeBreak.parentHypernymScore;
        intraFamilyPenalty = typeBreak.intraFamilyPenalty;
      }

      const wcText = Number(hit?._source?.color_confidence_text);
      const wcImg = Number(hit?._source?.color_confidence_image);
      const wText = Number.isFinite(wcText) && wcText > 0 ? wcText : 0;
      const wImg = Number.isFinite(wcImg) && wcImg > 0 ? wcImg : 0;
      const wSum = wText + wImg + 1e-6;
      const wtImg = wImg / wSum;
      const wtText = wText / wSum;

      let colorCompliance = 0;
      let matchedColor: string | null = null;
      let colorTier: "exact" | "family" | "bucket" | "none" = "none";
      if (desiredColorsTier.length > 0) {
        const tImg = tieredColorListCompliance(desiredColorsTier, imgTierRaw, rerankColorMode);
        const tText = tieredColorListCompliance(desiredColorsTier, textTierRaw, rerankColorMode);
        const tUnion = tieredColorListCompliance(desiredColorsTier, unionTierRaw, rerankColorMode);
        matchedColor = tUnion.bestMatch ?? tImg.bestMatch ?? tText.bestMatch;
        colorTier = tUnion.tier;
        if (imgTierRaw.length > 0 && textTierRaw.length > 0) {
          colorCompliance = wtImg * tImg.compliance + wtText * tText.compliance;
        } else if (imgTierRaw.length > 0) {
          colorCompliance = tImg.compliance;
          matchedColor = tImg.bestMatch ?? matchedColor;
          colorTier = tImg.tier;
        } else if (textTierRaw.length > 0) {
          colorCompliance = tText.compliance;
          matchedColor = tText.bestMatch ?? matchedColor;
          colorTier = tText.tier;
        } else {
          colorCompliance = tUnion.compliance;
        }
      }

      const crossFamilyPenalty =
        desiredProductTypes.length > 0
          ? scoreCrossFamilyTypePenalty(desiredProductTypes, productTypes)
          : 0;

      const audienceCompliance = scoreAudienceCompliance(
        queryAgeGroup,
        queryGenderForAudience ?? merged.gender,
        hit,
      );

      const normDoc = Number(hit?._source?.norm_confidence);
      const docTrustNorm =
        Number.isFinite(normDoc) && normDoc >= 0 && normDoc <= 1 ? 0.55 + 0.45 * normDoc : 0.92;
      const typeDoc = Number(hit?._source?.type_confidence);
      const typeDocTrust =
        Number.isFinite(typeDoc) && typeDoc >= 0 && typeDoc <= 1 ? 0.45 + 0.55 * typeDoc : 1;
      const docTrust = Math.max(0.25, Math.min(1, docTrustNorm * typeDocTrust));

      const rerankScore =
        productTypeCompliance * 1000 * docTrust +
        colorCompliance * 100 * docTrust +
        audienceCompliance * 80 * docTrust +
        similarity * 10 -
        crossFamilyPenalty * crossFamilyPenaltyWeight;

      const finalRelevance01 = computeFinalRelevance01({
        hasTypeIntent: desiredProductTypes.length > 0,
        productTypeCompliance,
        exactTypeScore,
        hasColorIntent: desiredColors.length > 0,
        colorCompliance,
        similarity,
        crossFamilyPenalty,
        hasAudienceIntent,
        audienceCompliance,
      });

      complianceById.set(idStr, {
        productTypeCompliance,
        exactTypeScore,
        siblingClusterScore,
        parentHypernymScore,
        intraFamilyPenalty,
        colorCompliance,
        matchedColor,
        colorTier,
        crossFamilyPenalty,
        audienceCompliance,
        osSimilarity01: similarity,
        rerankScore,
        finalRelevance01,
      });
    }

    const sortedByRelevance = [...hits].sort((a: any, b: any) => {
      const ida = String(a._source.product_id);
      const idb = String(b._source.product_id);
      const fa = complianceById.get(ida)?.finalRelevance01 ?? 0;
      const fb = complianceById.get(idb)?.finalRelevance01 ?? 0;
      if (Math.abs(fb - fa) > 1e-8) return fb - fa;
      const ra = complianceById.get(ida)?.rerankScore ?? 0;
      const rb = complianceById.get(idb)?.rerankScore ?? 0;
      return rb - ra;
    });

    const thresholdPassedIds = sortedByRelevance
      .map((h: any) => String(h._source.product_id))
      .filter((id) => (complianceById.get(id)?.finalRelevance01 ?? 0) >= finalAcceptMin);

    const relevanceGateSoft = config.search.relevanceGateMode === "soft";
    const sortedIds = sortedByRelevance.map((h: any) => String(h._source.product_id));
    const belowRelevanceThreshold =
      hits.length > 0 &&
      thresholdPassedIds.length === 0 &&
      !relevanceGateSoft;

    // Hard precision gate for explicit color queries (within relevance-threshold set).
    let finalProductIds = [
      ...(relevanceGateSoft ? sortedIds : thresholdPassedIds),
    ];
    if (desiredColors.length > 0) {
      const strictColorPost = String(process.env.SEARCH_COLOR_POSTFILTER_STRICT ?? "1").toLowerCase() !== "0";
      const maxImgConfHits = Math.max(0, ...hits.map((h: any) => Number(h?._source?.color_confidence_image) || 0));
      const compliantIds = finalProductIds.filter((id) => (complianceById.get(id)?.colorCompliance ?? 0) > 0);
      if (strictColorPost && compliantIds.length > 0) {
        finalProductIds = compliantIds;
      } else if (strictColorPost && compliantIds.length === 0 && maxImgConfHits < 0.42) {
        // Weak image color signal — keep full candidate list to avoid false negatives
      }
    }

    // Fetch hydrated product + images while preserving ranking order above
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
        finalRelevance01: compliance?.finalRelevance01,
        explain: compliance
          ? {
              exactTypeScore: compliance.exactTypeScore,
              siblingClusterScore: compliance.siblingClusterScore,
              parentHypernymScore: compliance.parentHypernymScore,
              intraFamilyPenalty: compliance.intraFamilyPenalty,
              productTypeCompliance: compliance.productTypeCompliance,
              lexicalScore: compliance.osSimilarity01,
              semanticScore: compliance.osSimilarity01,
              globalScore: compliance.osSimilarity01,
              colorScore: compliance.colorCompliance,
              matchedColor: compliance.matchedColor ?? undefined,
              colorTier: compliance.colorTier,
              colorCompliance: compliance.colorCompliance,
              audienceCompliance: compliance.audienceCompliance,
              crossFamilyPenalty: compliance.crossFamilyPenalty,
              desiredProductTypes,
              desiredColors,
              colorMode: rerankColorMode,
              finalRelevance01: compliance.finalRelevance01,
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

    results.sort((a: any, b: any) => {
      const fa = typeof a.finalRelevance01 === "number" ? a.finalRelevance01 : 0;
      const fb = typeof b.finalRelevance01 === "number" ? b.finalRelevance01 : 0;
      if (Math.abs(fb - fa) > 1e-8) return fb - fa;
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
        productIdsFirst: finalProductIds[0] ?? null,
        hydratedProductsCount: products.length,
        hydratedFirstProductId: products[0]?.id ?? null,
        filterClausesCount: filterClauses.length,
        hasProductTypeConstraint,
        rerankDesiredColors,
        colorMode,
        hardColorFilterActive,
        useSoftAstColor,
        belowRelevanceThreshold,
        recallSize,
        finalAcceptMin,
      });
    }

    results = dedupeSearchResults(results as any, { imageHammingMax: 10 }) as ProductResult[];

    const totalAboveThreshold = results.length;

    const useXgbRanker = String(process.env.SEARCH_USE_XGB_RANKER ?? "").toLowerCase() === "true";
    const xgbFullRecall = config.search.xgbRerankFullRecall;

    const runXgbTieBreakOnSlice = async (rankSlice: ProductResult[]): Promise<ProductResult[]> => {
      if (!useXgbRanker || rankSlice.length <= 3) return rankSlice;
      try {
        const rankerOk = await isRankerAvailable();
        if (!rankerOk) return rankSlice;

        const baseProduct = rankSlice[0];
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

        const candidates = rankSlice.map((p: any) => ({
          candidateId: String(p.id),
          clipSim: 0,
          textSim: typeof p.similarity_score === "number" ? p.similarity_score : 0,
          opensearchScore: typeof p.similarity_score === "number" ? p.similarity_score : 0,
          pHashDist: 64,
          source: "text" as const,
          product: p,
        }));

        const featureRows = buildFeatureRows(baseCtx as any, candidates as any).map((r: any) => r.featureRow);
        const rankerResult = await predictWithFallback(featureRows);
        const mlScores = rankerResult.scores;

        const mlScoreMap = new Map<string, number>();
        rankSlice.forEach((p: any, i: number) => {
          const score = mlScores[i] ?? 0;
          p.mlRerankScore = score;
          mlScoreMap.set(String(p.id), score);
        });

        const sorted = [...rankSlice];
        sorted.sort((a: any, b: any) => {
          const aPen = a.explain?.crossFamilyPenalty ?? 0;
          const bPen = b.explain?.crossFamilyPenalty ?? 0;
          if (aPen !== bPen) return aPen - bPen;

          const aType = a.explain?.productTypeCompliance ?? 0;
          const bType = b.explain?.productTypeCompliance ?? 0;
          if (bType !== aType) return bType - aType;

          const aColor = a.explain?.colorCompliance ?? 0;
          const bColor = b.explain?.colorCompliance ?? 0;
          if (bColor !== aColor) return bColor - aColor;

          return (mlScoreMap.get(String(b.id)) ?? 0) - (mlScoreMap.get(String(a.id)) ?? 0);
        });
        return sorted;
      } catch (err) {
        console.warn("[textSearch] XGB ranker tie-breaker failed, keeping deterministic order:", err);
        return rankSlice;
      }
    };

    if (xgbFullRecall && useXgbRanker && results.length > 3) {
      const cap = config.search.xgbFullRecallMax;
      const headEnd = Math.min(results.length, Math.max(cap, offset + limit));
      const head = results.slice(0, headEnd);
      const rerankedHead = await runXgbTieBreakOnSlice(head);
      results = [...rerankedHead, ...results.slice(headEnd)];
    }

    results = results.slice(offset, offset + limit);

    if (!xgbFullRecall && useXgbRanker && results.length > 3) {
      results = await runXgbTieBreakOnSlice(results);
    }

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
    const osTotal =
      response.body.hits.total?.value ?? response.body.hits.total ?? results.length ?? 0;
    const total = totalAboveThreshold;

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
          off_domain_blocked: false,
          domain_confidence: qu.domainConfidence,
          borderline_fashion: qu.borderlineFashion,
          embedding_fashion_01: embeddingFashion01,
          soft_ast_color: useSoftAstColor,
          hard_color_filter: hardColorFilterActive,
          expansion_term_count: expansionTerms.length,
          recall_size: recallSize,
          final_accept_min: finalAcceptMin,
          below_relevance_threshold: belowRelevanceThreshold,
          total_above_threshold: totalAboveThreshold,
        },
        final_relevance_scores: results.map((p: any) =>
          typeof p.finalRelevance01 === "number" ? p.finalRelevance01 : null,
        ),
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
        did_you_mean: buildSuggestText(ast),
        below_relevance_threshold: belowRelevanceThreshold,
        recall_size: recallSize,
        final_accept_min: finalAcceptMin,
        total_above_threshold: totalAboveThreshold,
        open_search_total_estimate: typeof osTotal === "number" ? osTotal : undefined,
        ...(includeDebug
          ? {
              debug: {
                openSearchHitsTotal:
                  response.body.hits.total?.value ?? response.body.hits.total ?? null,
                openSearchHitsCount: hits.length,
                openSearchFirstProductId: hits[0]?._source?.product_id ?? null,
                hydratedProductsCount: products.length,
                hydratedFirstProductId: (products[0] as any)?.id ?? null,
                filterClausesCount: filterClauses.length,
                hasProductTypeConstraint,
                rerankDesiredColors,
                colorMode,
                queryUnderstanding: qu,
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
 * Single image similarity search — delegates to the same pipeline as
 * `searchByImageWithSimilarity` (soft category, aisle rerank, dedupe, eval hooks).
 */
export async function imageSearch(
  imageBuffer: Buffer,
  options?: { limit?: number; filters?: SearchFilters }
): Promise<SearchResult> {
  const startTime = Date.now();
  const limit = options?.limit || 50;

  try {
    const embedding = await processImageForEmbedding(imageBuffer);
    const unified = await searchByImageWithSimilarity({
      imageEmbedding: embedding,
      imageBuffer,
      filters: (options?.filters ?? {}) as any,
      page: 1,
      limit,
      includeRelated: false,
    });

    const LBP_TO_USD = 89000;
    const results = (unified.results ?? []).map((p: any) => ({
      id: p.id,
      name: p.title,
      brand: p.brand,
      price:
        typeof p.price_usd === "number"
          ? p.price_usd
          : Math.round(Number(p.price_cents ?? 0) / LBP_TO_USD),
      imageUrl: p.images?.[0]?.url ?? p.image_url ?? p.image_cdn,
      category: p.category,
      color: p.color,
      gender: (p as any).attr_gender ?? p.gender,
      score: typeof p.similarity_score === "number" ? p.similarity_score : 0,
    }));

    return {
      results,
      total: unified.meta?.total_results ?? results.length,
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
 *  Caller-supplied values always win; AST fills in the blanks.
 *  Only the first AST category is merged here; additional `ast.entities.categories` are still
 *  used for soft boosts in `textSearch` when product-type constraints apply. */
function mergeFilters(caller: SearchFilters | undefined, ast: QueryAST): SearchFilters {
  return {
    brand:    caller?.brand    ?? ast.entities.brands[0],
    category: caller?.category ?? ast.entities.categories[0],
    color:    caller?.color    ?? ast.entities.colors[0],
    gender:   caller?.gender   ?? ast.entities.gender,
    ageGroup: caller?.ageGroup ?? ast.entities.ageGroup,
    minPrice: caller?.minPrice ?? ast.filters.priceRange?.min,
    maxPrice: caller?.maxPrice ?? ast.filters.priceRange?.max,
    size:     caller?.size,
    vendorId: caller?.vendorId,
  };
}

const mapCorrection = (c: { original: string; corrected: string; source: string }) => ({
  original: c.original, corrected: c.corrected, source: c.source,
});

/** Build a small summary of the AST suitable for an API response */
function summarizeAST(ast: QueryAST): QueryASTSummary {
  return {
    original: ast.original,
    searchQuery: ast.searchQuery,
    intent: { type: ast.intent.type, confidence: ast.intent.confidence },
    entities: {
      brands: ast.entities.brands,
      categories: ast.entities.categories,
      colors: ast.entities.colors,
      productTypes: ast.entities.productTypes ?? [],
      gender: ast.entities.gender,
      ageGroup: ast.entities.ageGroup,
    },
    corrections: ast.corrections.map(mapCorrection),
    appliedCorrections: ast.appliedCorrections?.length
      ? ast.appliedCorrections.map(mapCorrection)
      : undefined,
    suggestedCorrections: ast.suggestedCorrections?.length
      ? ast.suggestedCorrections.map(mapCorrection)
      : undefined,
    controlParamsExtracted: ast.controlParamsExtracted,
    suggestText: buildSuggestText(ast),
    processingTimeMs: ast.processingTimeMs,
  };
}

/** Suggest text: only when we have suggested (not applied) corrections; never reinforce low-confidence applied rewrites */
function buildSuggestText(ast: QueryAST): string | undefined {
  if (!ast.suggestedCorrections?.length) return undefined;
  let q = ast.normalized;
  for (const c of ast.suggestedCorrections) {
    q = q.replace(new RegExp(`\\b${escapeRegexForSuggest(c.original)}\\b`, "gi"), c.corrected);
  }
  q = q.replace(/\s+/g, " ").trim();
  if (q === ast.searchQuery) return undefined;
  return `Did you mean "${q}"?`;
}

function escapeRegexForSuggest(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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