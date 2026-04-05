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
import {
  IntentParserService,
  ParsedIntent,
  createClipOnlyParsedIntent,
} from '../../lib/prompt/gemeni';
import { preprocessMultiImageBuffers } from '../../lib/search/multiImagePreprocess';
import { reconcileIntentNegativeCollisions } from '../../lib/search/intentReconciliation';
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
  processQueryFast,
  getQueryEmbedding,
  type QueryAST,
} from '../../lib/queryProcessor';
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
  extractFashionTypeNounTokens,
  extractLexicalProductTypeSeeds,
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
import { expandColorTermsForFilter, normalizeColorToken } from '../../lib/color/queryColorFilter';
import { extractQuickFashionColorHints } from '../../lib/color/quickImageColor';
import {
  computeHitRelevance,
  normalizeQueryGender,
  type HitCompliance,
  type HybridScoreRecallStats,
  type SearchHitRelevanceIntent,
} from '../../lib/search/searchHitRelevance';
import {
  parseNegations,
  type NegationConstraint,
} from '../../lib/queryProcessor/negationHandler';
import { blip } from '../../lib/image';
import { buildStructuredBlipOutput } from '../../lib/image/blipStructured';

function buildHybridScoreRecallStats(hits: any[]): HybridScoreRecallStats | undefined {
  if (!hits?.length) return undefined;
  const hasSplit = hits.some(
    (h: any) =>
      h?._source &&
      "clip_score" in h._source &&
      "bm25_score" in h._source &&
      h._source.clip_score != null &&
      h._source.bm25_score != null,
  );
  if (!hasSplit) return undefined;
  let maxClip = 0;
  let maxBm25 = 0;
  for (const h of hits) {
    const c = Number(h?._source?.clip_score);
    const b = Number(h?._source?.bm25_score);
    if (Number.isFinite(c) && c > maxClip) maxClip = c;
    if (Number.isFinite(b) && b > maxBm25) maxBm25 = b;
  }
  if (maxClip <= 0 || maxBm25 <= 0) return undefined;
  return {
    hasSplitScores: true,
    maxClip,
    maxBm25,
    useTanhSim: config.search.similarityNormalize === "tanh",
    tanhScale: config.search.similarityTanhScale,
  };
}

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
  /** Text search ships rich telemetry here; multi-image adds gemini_degraded / ast_pipeline_degraded. */
  meta?: Record<string, unknown>;
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

function appendUnique(target: string[], values: string[]) {
  for (const v of values) {
    const x = String(v || '').toLowerCase().trim();
    if (!x) continue;
    if (!target.includes(x)) target.push(x);
  }
}

async function enrichClipOnlyIntentFromImages(
  parsedIntent: ParsedIntent,
  preparedImages: Buffer[],
  userPrompt: string,
): Promise<void> {
  if (!preparedImages.length) return;

  const colorHints = await extractQuickFashionColorHints(preparedImages[0], { maxHints: 2 });
  const canonicalColorHints = colorHints
    .map((c) => normalizeColorToken(c) ?? c.toLowerCase())
    .filter(Boolean);

  let secondaryTypeHints: string[] = [];
  let secondaryStyleHint: string | undefined;
  const secondaryImage = preparedImages[1] ?? preparedImages[0];
  try {
    await blip.init();
    const caption = await blip.caption(secondaryImage);
    if (caption?.trim()) {
      const structured = buildStructuredBlipOutput(caption);
      secondaryTypeHints = (structured.productTypeHints || [])
        .map((t) => String(t).toLowerCase().trim())
        .filter(Boolean)
        .slice(0, 3);
      secondaryStyleHint = structured.style?.attrStyle || undefined;
    }
  } catch {
    secondaryTypeHints = [];
    secondaryStyleHint = undefined;
  }

  parsedIntent.constraints = parsedIntent.constraints || {
    mustHave: [],
    mustNotHave: [],
  };
  parsedIntent.constraints.mustHave = parsedIntent.constraints.mustHave || [];
  parsedIntent.constraints.mustNotHave = parsedIntent.constraints.mustNotHave || [];

  appendUnique(parsedIntent.constraints.mustHave, canonicalColorHints);
  appendUnique(parsedIntent.constraints.mustHave, secondaryTypeHints);

  if (!parsedIntent.constraints.category && secondaryTypeHints.length > 0) {
    parsedIntent.constraints.category = secondaryTypeHints[0];
  }

  if (!parsedIntent.imageIntents || parsedIntent.imageIntents.length === 0) {
    parsedIntent.imageIntents = [];
  }

  const firstIntent = parsedIntent.imageIntents.find((x) => x.imageIndex === 0) || {
    imageIndex: 0,
    primaryAttributes: [],
    weight: preparedImages.length > 1 ? 0.5 : 1,
    extractedValues: {},
    reasoning: 'Fallback from image-derived signals',
  };
  if (!parsedIntent.imageIntents.includes(firstIntent)) parsedIntent.imageIntents.push(firstIntent);
  firstIntent.primaryAttributes = [...new Set([...(firstIntent.primaryAttributes || []), 'color'])];
  firstIntent.extractedValues = firstIntent.extractedValues || {};
  if (canonicalColorHints.length > 0) {
    firstIntent.extractedValues.color = canonicalColorHints;
  }

  if (preparedImages.length > 1) {
    const secondIntent = parsedIntent.imageIntents.find((x) => x.imageIndex === 1) || {
      imageIndex: 1,
      primaryAttributes: [],
      weight: 0.5,
      extractedValues: {},
      reasoning: 'Fallback from image-derived signals',
    };
    if (!parsedIntent.imageIntents.includes(secondIntent)) parsedIntent.imageIntents.push(secondIntent);
    secondIntent.primaryAttributes = [...new Set([
      ...(secondIntent.primaryAttributes || []),
      'style',
      'silhouette',
    ])];
    secondIntent.extractedValues = secondIntent.extractedValues || {};
    if (secondaryStyleHint) secondIntent.extractedValues.style = secondaryStyleHint;
    if (secondaryTypeHints.length > 0) secondIntent.extractedValues.category = secondaryTypeHints[0];
  }

  const n = Math.max(1, parsedIntent.imageIntents.length);
  const equalW = 1 / n;
  parsedIntent.imageIntents = parsedIntent.imageIntents
    .sort((a, b) => a.imageIndex - b.imageIndex)
    .map((x) => ({
      ...x,
      weight: Number.isFinite(Number(x.weight)) && Number(x.weight) > 0 ? Number(x.weight) : equalW,
    }));

  const totalW = parsedIntent.imageIntents.reduce((s, x) => s + (x.weight || 0), 0);
  if (totalW > 0) {
    parsedIntent.imageIntents.forEach((x) => {
      x.weight = (x.weight || 0) / totalW;
    });
  }

  const signals: string[] = [];
  if (canonicalColorHints.length > 0) signals.push(`img1 color=${canonicalColorHints.join('/')}`);
  if (secondaryTypeHints.length > 0) signals.push(`img2 type=${secondaryTypeHints.join('/')}`);
  if (secondaryStyleHint) signals.push(`img2 style=${secondaryStyleHint}`);
  if (signals.length > 0) {
    parsedIntent.searchStrategy = `Degraded image-derived constraints: ${signals.join(' | ')}`;
    parsedIntent.confidence = Math.max(parsedIntent.confidence || 0, 0.38);
  }
}

function strictProductTypeFilterEnv(): boolean {
  const v = String(process.env.SEARCH_STRICT_PRODUCT_TYPE ?? '').toLowerCase();
  return v === '1' || v === 'true';
}

function genderHardFilterMinConfidence(): number {
  const n = Number(process.env.SEARCH_GENDER_HARD_MIN_CONFIDENCE ?? '0.55');
  return Number.isFinite(n) ? Math.min(0.95, Math.max(0.35, n)) : 0.55;
}

/** When true, hard/soft gender clauses also allow indexed `unisex` (SEARCH_GENDER_UNISEX_OR). */
function binaryGenderAllowsUnisexFilter(g: string): boolean {
  if (!config.search.genderUnisexOr) return false;
  const x = g.toLowerCase();
  return (
    x === "men" ||
    x === "women" ||
    x === "male" ||
    x === "female" ||
    x === "man" ||
    x === "woman"
  );
}

/** OpenSearch fetch size: large enough to rerank meaningfully, capped for latency. */
function computeTextRecallSize(limit: number, offset: number): number {
  const w = config.search.recallWindow;
  const cap = config.search.recallMax;
  return Math.min(cap, Math.max(w, offset + limit));
}

type LengthIntent = "mini" | "midi" | "maxi" | "short" | "long";

function extractLengthIntents(rawQuery: string, processedQuery: string): LengthIntent[] {
  const q = `${rawQuery} ${processedQuery}`.toLowerCase().replace(/[^\w\s-]/g, " ");
  const words = q.split(/\s+/).filter(Boolean);
  const out = new Set<LengthIntent>();

  const DRESSLIKE = new Set([
    "dress", "dresses", "skirt", "skirts", "abaya", "abayas", "kaftan", "kaftans",
    "gown", "gowns", "jumpsuit", "romper", "tunic",
  ]);
  const NON_LENGTH_NEIGHBORS = new Set(["sleeve", "sleeves", "shirt", "shirts", "tee", "tshirt", "t-shirt"]);

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const prev = words[i - 1];
    const next = words[i + 1];

    if (w === "mini") out.add("mini");
    if (w === "midi" || w === "mid") out.add("midi");
    if (w === "maxi") out.add("maxi");

    if (w === "short") {
      // "short sleeve shirt" is not garment-length intent.
      if (NON_LENGTH_NEIGHBORS.has(next) || NON_LENGTH_NEIGHBORS.has(prev)) continue;
      // Prefer length interpretation when attached to dress-like nouns.
      if (DRESSLIKE.has(next) || DRESSLIKE.has(prev) || !next) out.add("short");
    }

    if (w === "long") {
      if (NON_LENGTH_NEIGHBORS.has(next) || NON_LENGTH_NEIGHBORS.has(prev)) continue;
      if (DRESSLIKE.has(next) || DRESSLIKE.has(prev) || !next) out.add("long");
    }
  }

  return [...out];
}

/** Map parsed negation constraints to index fields (GET /search enhanced path). */
function appendNegationsToTextSearchBool(
  boolQ: { must_not?: any[] },
  negations: NegationConstraint[] | undefined,
): void {
  if (!negations?.length) return;
  if (!boolQ.must_not) boolQ.must_not = [];
  for (const n of negations) {
    const v = String(n.value || "").toLowerCase().trim();
    if (!v) continue;
    switch (n.type) {
      case "color": {
        const expanded = expandColorTermsForFilter(v);
        if (expanded.length === 0) continue;
        boolQ.must_not.push({
          bool: {
            should: [{ terms: { attr_color: expanded } }, { terms: { attr_colors: expanded } }],
            minimum_should_match: 1,
          },
        });
        break;
      }
      case "brand":
        boolQ.must_not.push({
          bool: {
            should: [{ term: { brand: v } }, { match: { "brand.search": { query: n.value } } }],
            minimum_should_match: 1,
          },
        });
        break;
      case "category":
        boolQ.must_not.push({
          bool: {
            should: [{ term: { category: v } }, { match: { "category.search": { query: n.value } } }],
            minimum_should_match: 1,
          },
        });
        break;
      default:
        boolQ.must_not.push({
          multi_match: {
            query: n.value,
            fields: ["title^2", "description", "category.search", "brand.search"],
            type: "best_fields",
          },
        });
    }
  }
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
    /** From enhanced GET /search negation parse — applied as bool.must_not on the index. */
    negationConstraints?: NegationConstraint[];
  },
): Promise<UnifiedSearchResult> {
  const startTime = Date.now();
  const limit  = options?.limit  ?? 20;
  const offset = options?.offset ?? 0;
  const recallSize = computeTextRecallSize(limit, offset);
  const finalAcceptMin = config.search.finalAcceptMinText;
  const includeRelated = options?.includeRelated ?? false;
  const relatedLimit = options?.relatedLimit ?? 10;
  const debug = String(process.env.SEARCH_DEBUG ?? "").toLowerCase() === "1";
  const breakdownDebug =
    debug || String(process.env.SEARCH_TRACE_BREAKDOWN ?? "").toLowerCase() === "1";

  try {
    const searchRetryTrace: string[] = [];
    const pipelineStages: { stage: string; msFromStart: number }[] = [];
    const markStage = (stage: string) =>
      pipelineStages.push({ stage, msFromStart: Date.now() - startTime });

    // ── 1. Process query through the AST pipeline ──────────────────────────
    const ast = await processQueryAST(rawQuery);
    markStage("after_ast");

    const callerPinnedColor =
      Boolean(callerFilters?.color) ||
      (Array.isArray((callerFilters as any)?.colors) && (callerFilters as any).colors.length > 0);

    const embeddingFashion01 = await computeEmbeddingFashionScore(
      (ast.searchQuery && ast.searchQuery.trim()) || rawQuery,
    ).catch(() => null);
    markStage("after_fashion_embedding_signal");

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
    const lexicalTypeSeeds = [
      ...new Set(
        [
          ...extractLexicalProductTypeSeeds(rawQuery),
          ...extractFashionTypeNounTokens(rawQuery),
          ...(ast.searchQuery?.trim()
            ? [
                ...extractLexicalProductTypeSeeds(ast.searchQuery.trim()),
                ...extractFashionTypeNounTokens(ast.searchQuery.trim()),
              ]
            : []),
        ].map((s) => s.toLowerCase()),
      ),
    ];
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
    let knnBoostOnly = qu.knnTextBoostOnly ? true : hardAstCategory || productTypeDominant;
    if (
      !knnBoostOnly &&
      config.search.knnDemoteLowFashionEmb &&
      typeof embeddingFashion01 === "number" &&
      Number.isFinite(embeddingFashion01) &&
      embeddingFashion01 < config.search.knnDemoteFashionEmbMax
    ) {
      knnBoostOnly = true;
    }

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

    const lengthIntents = extractLengthIntents(rawQuery, ast.searchQuery || "");
    if (lengthIntents.length > 0) {
      // Length words must be present when explicitly requested (e.g. midi dress).
      // This prevents broad category matches from leaking in.
      mustClauses.push({
        bool: {
          should: [
            {
              multi_match: {
                query: lengthIntents.join(" "),
                fields: ["title^4", "category.search^2", "description"],
                type: "best_fields",
                operator: "or",
                minimum_should_match: "100%",
              },
            },
            ...lengthIntents.map((t) => ({
              match_phrase: { title: { query: t, boost: 2.5 } },
            })),
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
      const unisexOr = binaryGenderAllowsUnisexFilter(g)
        ? ([
            { term: { attr_gender: "unisex" } },
            { term: { audience_gender: "unisex" } },
          ] as const)
        : [];
      filterClauses.push({
        bool: {
          _name: "strict_gender_filter",
          should: [
            { term: { attr_gender: g } },
            { term: { audience_gender: g } },
            { match_phrase: { title: g } },
            ...unisexOr,
          ],
          minimum_should_match: 1,
        },
      });
    } else if (merged.gender && normalizeQueryGender(merged.gender)) {
      const unisexSoft = binaryGenderAllowsUnisexFilter(gNorm)
        ? ([
            { term: { attr_gender: { value: "unisex", boost: 4.2 } } },
            { term: { audience_gender: { value: "unisex", boost: 4.2 } } },
          ] as const)
        : [];
      shouldClauses.push({
        bool: {
          _name: "soft_gender_boost",
          should: [
            { term: { attr_gender: { value: gNorm, boost: 6.0 } } },
            { term: { audience_gender: { value: gNorm, boost: 6.0 } } },
            { match_phrase: { title: { query: gNorm, boost: 4.0 } } },
            ...unisexSoft,
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
        'clip_score',
        'bm25_score',
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
    markStage("after_retrieval_embedding");
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

    appendNegationsToTextSearchBool(searchBody.query.bool, options?.negationConstraints);

    markStage("before_opensearch_execute");

    // ── 7. Execute ─────────────────────────────────────────────────────────
    console.log('[textSearch] Query:', JSON.stringify({
      raw: rawQuery, processed: ast.searchQuery,
      entities: { category: merged.category, brand: merged.brand, color: merged.color, gender: merged.gender },
      lengthIntents,
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
          "clip_score",
          "bm25_score",
        ],
      };

      appendNegationsToTextSearchBool(fallbackBody.query.bool, options?.negationConstraints);
      searchRetryTrace.push("parse_error_safe_bool");

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
        searchRetryTrace.push("zero_hit_bm25_without_knn");
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
      searchRetryTrace.push("zero_hit_category_filter_widened");
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
      searchRetryTrace.push("zero_hit_primary_color_to_attr_colors");
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
      searchRetryTrace.push("zero_hit_drop_strict_colors");
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
      searchRetryTrace.push("zero_hit_drop_product_types");
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
      searchRetryTrace.push("zero_hit_drop_audience_filters");
      response = await opensearch.search({ index: config.opensearch.index, body: relaxedBody });
      relaxedUsed = true;
    }

    const hits = response.body.hits.hits;
    const rawOpenSearchHitCount = Array.isArray(hits) ? hits.length : 0;

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

    const hybridScoreRecall = buildHybridScoreRecallStats(hits);

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

    const complianceById = new Map<string, HitCompliance>();

    const queryAgeGroup = mergedAgeGroup ?? ast.entities.ageGroup;
    const queryGenderForAudience = normalizeQueryGender(merged.gender);
    const hasAudienceIntent = Boolean(queryAgeGroup || queryGenderForAudience);

    const lexicalMatchQuery =
      (ast.searchQuery && ast.searchQuery.trim()) || rawQuery.trim() || undefined;

    const relevanceIntent: SearchHitRelevanceIntent = {
      desiredProductTypes,
      desiredColors,
      desiredColorsTier,
      rerankColorMode,
      mergedCategory,
      astCategories: ast.entities.categories ?? [],
      queryAgeGroup,
      audienceGenderForScoring: queryGenderForAudience ?? merged.gender,
      hasAudienceIntent,
      crossFamilyPenaltyWeight,
      lexicalMatchQuery,
      hybridScoreRecall,
    };

    const colorById = new Map<string, string | null>();

    for (const hit of hits) {
      const idStr = String(hit?._source?.product_id);
      const similarity = scoreMap.get(idStr) ?? 0;
      const rel = computeHitRelevance(hit, similarity, relevanceIntent);
      const { primaryColor, ...compliance } = rel;
      colorById.set(idStr, primaryColor);
      complianceById.set(idStr, compliance);
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
    const countAfterFinalAcceptMin = thresholdPassedIds.length;

    const relevanceGateSoft = config.search.relevanceGateMode === "soft";
    const softFloorMin = config.search.softFinalRelevanceFloorMin;

    // #region agent log
    (() => {
      let minFinalRelevance01 = Number.POSITIVE_INFINITY;
      let softFloorPassedIdsCount = 0;
      for (const h of sortedByRelevance) {
        const id = String(h?._source?.product_id);
        const v = complianceById.get(id)?.finalRelevance01 ?? 0;
        if (v < minFinalRelevance01) minFinalRelevance01 = v;
        if (v >= softFloorMin) softFloorPassedIdsCount++;
      }
      if (!Number.isFinite(minFinalRelevance01)) minFinalRelevance01 = 0;
      const belowCount = Math.max(0, sortedByRelevance.length - thresholdPassedIds.length);
      fetch("http://127.0.0.1:7383/ingest/ccea0d1b-4b26-441e-9797-fbae444c347a", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "00a194" },
        body: JSON.stringify({
          sessionId: "00a194",
          runId: "relevance-gate-debug",
          hypothesisId: "H1",
          location: "search.service.ts:textSearchGateDecision",
          message: "text search relevance gate decision",
          data: {
            finalAcceptMin,
            relevanceGateMode: config.search.relevanceGateMode,
            relevanceGateSoft,
            hitsCount: hits.length,
            sortedByRelevanceCount: sortedByRelevance.length,
            thresholdPassedIdsCount: thresholdPassedIds.length,
            belowFinalAcceptMinCount: belowCount,
            softFloorMin,
            softFloorPassedIdsCount,
            minFinalRelevance01: minFinalRelevance01,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
    })();
    // #endregion

    const sortedIds = sortedByRelevance.map((h: any) => String(h._source.product_id));
    const belowRelevanceThreshold =
      hits.length > 0 &&
      thresholdPassedIds.length === 0 &&
      !relevanceGateSoft;

    // Hard precision gate for explicit color queries (within relevance-threshold set).
    const softFloorPassedIds = relevanceGateSoft
      ? sortedByRelevance
          .map((h: any) => String(h._source.product_id))
          .filter((id) => (complianceById.get(id)?.finalRelevance01 ?? 0) >= softFloorMin)
      : [];

    let finalProductIds = relevanceGateSoft
      ? softFloorPassedIds.length > 0
        ? softFloorPassedIds
        : sortedIds
      : thresholdPassedIds;

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

    const brandsForRelated = ast.entities.brands.map((b) => b.toLowerCase());
    const categoriesForRelated = ast.entities.categories.map((c) => c.toLowerCase());
    const relatedExcludeApprox = finalProductIds.slice(offset, offset + limit).map(String);

    let relatedFetchError: string | undefined;
    const relatedPromise =
      includeRelated && relatedExcludeApprox.length > 0
        ? findRelatedProducts(
            relatedExcludeApprox,
            brandsForRelated,
            categoriesForRelated,
            relatedLimit,
            {
              relevanceQuery:
                (ast.searchQuery && ast.searchQuery.trim()) || rawQuery.trim(),
              expandedTerms: lexicalTypeSeeds,
              colorHints: ast.entities.colors ?? [],
            },
          ).catch((e) => {
            relatedFetchError = e instanceof Error ? e.message : String(e);
            console.warn("[textSearch] findRelatedProducts failed:", e);
            return [] as ProductResult[];
          })
        : Promise.resolve([] as ProductResult[]);

    // Fetch hydrated product + images; overlap related OpenSearch when requested.
    const products = await getProductsByIdsOrdered(finalProductIds);
    const numericIds = finalProductIds.map((id) => parseInt(id, 10)).filter(Number.isFinite);
    const [imagesByProduct, relatedProducts] = await Promise.all([
      getImagesForProducts(numericIds),
      relatedPromise,
    ]);

    let results: ProductResult[] = products.map((p: any) => {
      const productIdStr = String(p.id);
      const images = imagesByProduct.get(parseInt(p.id, 10)) || [];
      const similarityScore = scoreMap.get(productIdStr) ?? 0;
      const compliance = complianceById.get(productIdStr);
      const imagesOut = images.map((img: any) => ({
        id: img.id,
        url: img.cdn_url,
        is_primary: img.is_primary,
        p_hash: img.p_hash ?? undefined,
      }));

      return {
        ...p,
        // Ensure UI color matches the OpenSearch attribute that retrieval used.
        color: colorById.get(productIdStr) ?? p.color ?? null,
        similarity_score: similarityScore,
        match_type: (() => {
          const visualOk = similarityScore >= config.clip.matchTypeExactMin;
          if (!visualOk) return "similar" as const;
          if (!compliance) return "exact" as const;
          const typeAligned =
            (compliance.exactTypeScore ?? 0) >= 1 ||
            (compliance.productTypeCompliance ?? 0) >= 0.82;
          return typeAligned ? ("exact" as const) : ("similar" as const);
        })(),
        rerankScore: compliance?.rerankScore ?? undefined,
        finalRelevance01: compliance?.finalRelevance01,
        explain: compliance
          ? {
              exactTypeScore: compliance.exactTypeScore,
              siblingClusterScore: compliance.siblingClusterScore,
              parentHypernymScore: compliance.parentHypernymScore,
              intraFamilyPenalty: compliance.intraFamilyPenalty,
              productTypeCompliance: compliance.productTypeCompliance,
              categoryScore: compliance.categoryRelevance01,
              ...(compliance.lexicalScoreDistinct ? { lexicalScore: compliance.lexicalScore01 } : {}),
              semanticScore: compliance.semanticScore01,
              globalScore: compliance.osSimilarity01,
              colorScore: compliance.colorCompliance,
              matchedColor: compliance.matchedColor ?? undefined,
              colorTier: compliance.colorTier,
              colorCompliance: compliance.colorCompliance,
              audienceCompliance: compliance.audienceCompliance,
              crossFamilyPenalty: compliance.crossFamilyPenalty,
              hasTypeIntent: compliance.hasTypeIntent,
              hasColorIntent: compliance.hasColorIntent,
              typeGateFactor: compliance.typeGateFactor,
              hardBlocked: compliance.hardBlocked,
              desiredProductTypes,
              desiredColors,
              colorMode: rerankColorMode,
              finalRelevance01: compliance.finalRelevance01,
            }
          : undefined,
        images: imagesOut,
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

    const preDedupeCount = results.length;
    results = dedupeSearchResults(results as any) as ProductResult[];
    const countAfterDedupe = results.length;

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
    const finalReturnedCount = results.length;

    if (!xgbFullRecall && useXgbRanker && results.length > 3) {
      results = await runXgbTieBreakOnSlice(results);
    }

    let related: ProductResult[] = [];
    if (includeRelated) {
      related = (filterRelatedAgainstMain(results as any, relatedProducts as any) ?? []) as ProductResult[];
    }

    const includeDebug = debug || results.length === 0;
    const includeRetrievalMeta =
      includeDebug || belowRelevanceThreshold || results.length === 0;
    markStage("before_response");

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
          search_retry_trace: searchRetryTrace,
        },
        final_relevance_scores: results.map((p: any) =>
          typeof p.finalRelevance01 === "number" ? p.finalRelevance01 : null,
        ),
      });
    }

    if (breakdownDebug) {
      const categoryFilterMode = callerFilters?.category
        ? "hard"
        : hardAstCategory
          ? "hard"
          : mergedCategory
            ? "soft"
            : "none";
      const productTypeFilterMode = hasProductTypeConstraint
        ? strictProductTypeFilterEnv()
          ? "hard"
          : "soft"
        : "none";
      const textKnnMode = embedding ? (knnBoostOnly ? "should" : "must") : "none";
      console.warn("[search-breakdown][text]", {
        query: rawQuery,
        raw_open_search_hits: rawOpenSearchHitCount,
        hits_after_final_accept_min: countAfterFinalAcceptMin,
        hits_after_dedupe: countAfterDedupe,
        hits_after_hydration: preDedupeCount,
        final_returned_count: finalReturnedCount,
        SEARCH_FINAL_ACCEPT_MIN: finalAcceptMin,
        CLIP_SIMILARITY_THRESHOLD: config.clip.similarityThreshold,
        category_filter_mode: categoryFilterMode,
        product_type_filter_mode: productTypeFilterMode,
        text_knn_mode: textKnnMode,
        recall_window: config.search.recallWindow,
        candidate_k: recallSize,
        endpoint_limit: limit,
        limit_per_item: null,
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
        ...(relatedFetchError ? { related_fetch_error: relatedFetchError } : {}),
        ...(includeRetrievalMeta
          ? {
              retrieval: {
                search_retry_trace: searchRetryTrace,
                open_search_hits_count: hits.length,
                open_search_total_raw:
                  response.body.hits.total?.value ?? response.body.hits.total ?? null,
                accepted_after_relevance_min: thresholdPassedIds.length,
                below_relevance_threshold: belowRelevanceThreshold,
                recall_size: recallSize,
                final_accept_min: finalAcceptMin,
              },
            }
          : {}),
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
                pipeline_stages: pipelineStages,
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
  const safeLimit = Math.min(Math.max(Math.trunc(Number(limit) || 50), 1), 120);

  try {
    let multiImageEffectiveFinalMin = config.search.finalAcceptMinImage;
    const prepared = await preprocessMultiImageBuffers(images);
    const { parsedIntent, geminiDegraded } = await parseMultiImageIntentWithGuards(
      prepared,
      userPrompt,
    );
    if (geminiDegraded) {
      await enrichClipOnlyIntentFromImages(parsedIntent, prepared, userPrompt);
    }
    reconcileIntentNegativeCollisions(parsedIntent);

    const imageEmbeddings = await Promise.all(
      prepared.map((img) => processImageForEmbedding(img)),
    );

    const compositeQuery = await queryBuilder.buildQuery(parsedIntent, imageEmbeddings);

    // Same CLIP text embedding path as text search: bridges language in the prompt to image-indexed vectors.
    await blendPromptClipIntoCompositeGlobal(compositeQuery, userPrompt, parsedIntent);

    // Parse the text prompt before kNN so constraints can widen recall and strict gating can use the same AST.
    let astPipelineDegraded = false;
    let ast: QueryAST;
    try {
      ast = await processQueryAST(userPrompt);
    } catch (astErr) {
      astPipelineDegraded = true;
      console.warn('[multiImageSearch] processQueryAST failed, using processQueryFast:', astErr);
      try {
        ast = await processQueryFast(userPrompt?.trim() || 'fashion');
      } catch (fastErr) {
        console.warn('[multiImageSearch] processQueryFast failed, retrying minimal prompt:', fastErr);
        ast = await processQueryFast('fashion');
      }
    }

    const strictRecall =
      multiImageStrictPromptEnabled() &&
      multiImageHasStrictPromptSignals(ast, userPrompt);
    const strictConstraintMode = strictRecall;
    const candidateSize = strictConstraintMode
      ? Math.min(Math.max(safeLimit * 10, 220), 900)
      : Math.min(Math.max(safeLimit * 6, 140), 520);
    const vectorK = strictRecall
      ? Math.min(Math.max(safeLimit * 12, 220), 900)
      : Math.min(Math.max(safeLimit * 8, 140), 520);

    let queryBundle = queryMapper.mapQuery(compositeQuery, {
      maxResults: candidateSize,
      vectorK,
      vectorWeight: 0.6,
      filterWeight: 0.3,
      priceWeight: 0.1,
      strictConstraints: strictConstraintMode,
    });

    const opensearch = osClient;
    let response = await opensearch.search({
      index: config.opensearch.index,
      body: queryBundle.opensearch,
    });

    let hits = response.body.hits.hits as any[];
    let totalHits =
      typeof response.body.hits.total === "object" && response.body.hits.total != null
        ? (response.body.hits.total as { value?: number }).value ?? 0
        : Number(response.body.hits.total) || 0;

    let retrievalFallbackUsed = false;
    let retrievalHitsInitial = hits.length;
    let retrievalHitsAfterQuery = hits.length;
    let hitsAfterRelevanceGate = hits.length;
    let hitsAfterHardGate = hits.length;
    let hydratedCount = 0;
    let constrainedCount = 0;
    if (strictConstraintMode && totalHits === 0) {
      const relaxedMaxResults = Math.min(Math.max(candidateSize, safeLimit * 8), 1000);
      const relaxedVectorK = Math.min(Math.max(vectorK, safeLimit * 10), 1000);
      queryBundle = queryMapper.mapQuery(compositeQuery, {
        maxResults: relaxedMaxResults,
        vectorK: relaxedVectorK,
        vectorWeight: 0.6,
        filterWeight: 0.3,
        priceWeight: 0.1,
        strictConstraints: false,
      });
      response = await opensearch.search({
        index: config.opensearch.index,
        body: queryBundle.opensearch,
      });
      hits = response.body.hits.hits as any[];
      totalHits =
        typeof response.body.hits.total === "object" && response.body.hits.total != null
          ? (response.body.hits.total as { value?: number }).value ?? 0
          : Number(response.body.hits.total) || 0;
      retrievalFallbackUsed = true;
      retrievalHitsAfterQuery = hits.length;
    }
    retrievalHitsAfterQuery = hits.length;

    let relevanceIntent = buildMultiImageSearchHitRelevanceIntent(
      ast,
      parsedIntent,
      userPrompt,
      astPipelineDegraded,
    );
    const relevanceById = new Map<string, HitCompliance>();
    const primaryColorByProductIdMulti = new Map<string, string | null>();

    if (hits.length > 0) {
      const hybridRecallMulti = buildHybridScoreRecallStats(hits);
      if (hybridRecallMulti) {
        relevanceIntent = { ...relevanceIntent, hybridScoreRecall: hybridRecallMulti };
      }
      const maxScore = hits[0]._score ?? 1;
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

      for (const hit of hits) {
        const idStr = String(hit?._source?.product_id);
        const sim = scoreMap.get(idStr) ?? 0;
        const rel = computeHitRelevance(hit, sim, relevanceIntent);
        const { primaryColor, ...compliance } = rel;
        primaryColorByProductIdMulti.set(idStr, primaryColor);
        relevanceById.set(idStr, compliance);
      }

      if (
        multiImageStrictPromptEnabled() &&
        userPrompt.trim().length >= 12 &&
        ast.filters?.priceRange &&
        (ast.filters.priceRange.min != null || ast.filters.priceRange.max != null)
      ) {
        const pr = ast.filters.priceRange;
        hits = hits.filter((h: any) => {
          const p = Number(h?._source?.price_usd);
          if (!Number.isFinite(p)) return true;
          if (pr.min != null && p < pr.min) return false;
          if (pr.max != null && p > pr.max) return false;
          return true;
        });
      }

      hits = [...hits].sort((a: any, b: any) => {
        const ida = String(a._source.product_id);
        const idb = String(b._source.product_id);
        const fa = relevanceById.get(ida)?.finalRelevance01 ?? 0;
        const fb = relevanceById.get(idb)?.finalRelevance01 ?? 0;
        if (Math.abs(fb - fa) > 1e-8) return fb - fa;
        const ra = relevanceById.get(ida)?.rerankScore ?? 0;
        const rb = relevanceById.get(idb)?.rerankScore ?? 0;
        return rb - ra;
      });

      const finalAcceptMin = config.search.finalAcceptMinImage;
      let effectiveFinalAcceptMin = finalAcceptMin;
      let relFiltered = hits.filter(
        (h: any) =>
          (relevanceById.get(String(h._source.product_id))?.finalRelevance01 ?? 0) >= effectiveFinalAcceptMin,
      );
      const imageMinResultsTarget = config.search.imageSearchMinResults;
      const relevanceRelaxDelta = config.search.imageSearchRelevanceRelaxDelta;
      if (
        imageMinResultsTarget > 0 &&
        relFiltered.length < imageMinResultsTarget &&
        hits.length > relFiltered.length
      ) {
        const relaxedMin = Math.max(0.45, finalAcceptMin - relevanceRelaxDelta);
        if (relaxedMin < finalAcceptMin) {
          const expanded = hits.filter(
            (h: any) =>
              (relevanceById.get(String(h._source.product_id))?.finalRelevance01 ?? 0) >= relaxedMin,
          );
          if (expanded.length > relFiltered.length) {
            relFiltered = expanded;
            effectiveFinalAcceptMin = relaxedMin;
          }
        }
      }
      hits = relFiltered;
      hitsAfterRelevanceGate = hits.length;
      multiImageEffectiveFinalMin = effectiveFinalAcceptMin;
    }

    const hardConstraints = buildMultiImageHardConstraints(
      ast,
      parsedIntent,
      userPrompt,
      relevanceIntent,
    );
    let hardConstraintRelaxationLevel: 0 | 1 | 2 = 0;
    let hardConstraintFallbackUsed = false;
    if (hardConstraints.enabled && hits.length > 0) {
      const preHardConstraintHits = hits;
      const strictHits = hits.filter((hit: any) =>
        multiImageHitPassesHardConstraints(
          hit,
          hardConstraints,
          relevanceById.get(String(hit?._source?.product_id)),
        ),
      );
      if (strictHits.length > 0) {
        hits = strictHits;
      } else {
        const relaxedLv1 = relaxMultiImageHardConstraints(hardConstraints, 1);
        const lv1Hits = hits.filter((hit: any) =>
          multiImageHitPassesHardConstraints(
            hit,
            relaxedLv1,
            relevanceById.get(String(hit?._source?.product_id)),
          ),
        );
        if (lv1Hits.length > 0) {
          hits = lv1Hits;
          hardConstraintRelaxationLevel = 1;
        } else {
          const relaxedLv2 = relaxMultiImageHardConstraints(hardConstraints, 2);
          const lv2Hits = hits.filter((hit: any) =>
            multiImageHitPassesHardConstraints(
              hit,
              relaxedLv2,
              relevanceById.get(String(hit?._source?.product_id)),
            ),
          );
          if (lv2Hits.length > 0) {
            hits = lv2Hits;
            hardConstraintRelaxationLevel = 2;
          } else {
            // Preserve recall when strict and relaxed hard gates all empty out.
            hits = preHardConstraintHits;
            hardConstraintRelaxationLevel = 2;
            hardConstraintFallbackUsed = true;
          }
        }
      }
      hitsAfterHardGate = hits.length;
    }

    const productIds = hits.map((hit: any) => hit._source?.product_id);
    const multiImageQueryColorHints = [
      ...new Set(
        (ast.entities.colors ?? []).map((c) => String(c).trim().toLowerCase()).filter(Boolean),
      ),
    ];
    const hydratedResults = await hydrateProductDetails(productIds, queryBundle.sqlFilters, {
      primaryColorByProductId: primaryColorByProductIdMulti,
      queryColorHints: multiImageQueryColorHints,
      textQuery: userPrompt?.trim() || null,
    });
    hydratedCount = hydratedResults.length;

    const rawScoresByProductId = new Map<
      string,
      { vectorScore: number; compositeScore: number }
    >();

    const results = hits
      .map((hit: any) => {
        const hydrated = hydratedResults.find((p: any) => String(p.id) === String(hit._source.product_id));
        if (!hydrated) return null;
        const vectorScore = hit._score;
        const compositeScore = calculateCompositeScore(
          vectorScore,
          hydrated,
          compositeQuery,
          queryBundle.hybridScore,
        );
        rawScoresByProductId.set(String(hit._source.product_id), {
          vectorScore,
          compositeScore,
        });
        return {
          ...hydrated,
          vectorScore,
          compositeScore,
        };
      })
      .filter((r: any): r is NonNullable<typeof r> => r !== null);

    const activeHardConstraints =
      hardConstraintRelaxationLevel === 1
        ? relaxMultiImageHardConstraints(hardConstraints, 1)
        : hardConstraintRelaxationLevel === 2
          ? relaxMultiImageHardConstraints(hardConstraints, 2)
          : hardConstraints;

    const constrainedResults =
      activeHardConstraints.enabled && results.length > 0
        ? results.filter((product: any) => {
            const rel = relevanceById.get(String(product.id));
            return multiImageProductPassesHardConstraints(product, activeHardConstraints, rel);
          })
        : results;
    constrainedCount = constrainedResults.length;

    const mappedForRerank: MultiVectorSearchResult[] = constrainedResults.map((r: any) => {
      const idStr = String(r.id || r.product_id || r.productId);
      const frozen = rawScoresByProductId.get(idStr);
      return {
        productId: idStr,
        score: normalizeVectorScore(frozen?.vectorScore ?? r.vectorScore),
        _rawScores: frozen
          ? { vectorScore: frozen.vectorScore, compositeScore: frozen.compositeScore }
          : { vectorScore: r.vectorScore },
        product: {
          vendorId: r.vendor_id || r.vendorId,
          title: r.name || r.title,
          brand: r.brand,
          category: r.category,
          priceUsd: r.price || r.price_usd || r.priceUsd,
          availability: r.availability,
          imageCdn: r.image_url || r.imageCdn,
          description: r.description,
          color: r.color,
        },
        scoreBreakdown: [],
      };
    });

    const defaultRerank: RerankOptions = { vectorWeight: 0.6, attributeWeight: 0.3, priceWeight: 0.1, recencyWeight: 0.0 };
    const rerankOpts = Object.assign({}, defaultRerank, rerankWeights || {});
    const reranked = intentAwareRerank(mappedForRerank, parsedIntent, rerankOpts);

    let finalResults = reranked
      .map((rer: any) => {
        const original = constrainedResults.find((o: any) => (o.id || o.product_id || o.productId) === rer.productId);
        const rel = relevanceById.get(String(rer.productId));
        return {
          ...original,
          rerankScore: rer.rerankScore,
          rerankBreakdown: rer.rerankBreakdown,
          finalRelevance01: rel?.finalRelevance01,
          textSearchRerankScore: rel?.rerankScore,
          osSimilarity01: rel?.osSimilarity01,
          relevanceCompliance: rel
            ? {
                productTypeCompliance: rel.productTypeCompliance,
                colorCompliance: rel.colorCompliance,
                audienceCompliance: rel.audienceCompliance,
                categoryRelevance01: rel.categoryRelevance01,
                crossFamilyPenalty: rel.crossFamilyPenalty,
              }
            : undefined,
        };
      })
      .sort((a: any, b: any) => {
        const fa = a.finalRelevance01 ?? 0;
        const fb = b.finalRelevance01 ?? 0;
        if (Math.abs(fb - fa) > 1e-8) return fb - fa;
        const ta = a.textSearchRerankScore ?? 0;
        const tb = b.textSearchRerankScore ?? 0;
        if (Math.abs(tb - ta) > 1e-8) return tb - ta;
        return (b.rerankScore ?? 0) - (a.rerankScore ?? 0);
      });

    const preThresholdFinalResults = [...finalResults];
    finalResults = finalResults.filter(
      (r: any) =>
        typeof r.finalRelevance01 === "number" && r.finalRelevance01 >= multiImageEffectiveFinalMin,
    );
    let finalFloorFallbackUsed = false;
    if (finalResults.length === 0 && preThresholdFinalResults.length > 0) {
      finalResults = preThresholdFinalResults.slice(0, Math.min(safeLimit, 5));
      finalFloorFallbackUsed = true;
    }
    finalResults.sort((a: any, b: any) => (b.finalRelevance01 ?? 0) - (a.finalRelevance01 ?? 0));
    finalResults = dedupeMultiImageResults(finalResults);
    finalResults = finalResults.slice(0, safeLimit);

    if (finalResults.length > 0) {
      const maxVs = Math.max(
        ...finalResults.map((r: any) => Number(r.vectorScore) || 0),
        1e-12,
      );
      const maxCs = Math.max(
        ...finalResults.map((r: any) => Number(r.compositeScore) || 0),
        1e-12,
      );
      for (const r of finalResults) {
        r.vectorScore = Math.max(0, Math.min(1, (Number(r.vectorScore) || 0) / maxVs));
        r.compositeScore = Math.max(0, Math.min(1, (Number(r.compositeScore) || 0) / maxCs));
      }
    }

    const explanationParts = [compositeQuery.explanation].filter(Boolean) as string[];
    if (geminiDegraded) explanationParts.push("[intent: gemini_degraded]");
    if (astPipelineDegraded) explanationParts.push("[relevance: ast_fast_path]");

    return {
      results: finalResults,
      total: finalResults.length,
      tookMs: Date.now() - startTime,
      explanation: explanationParts.join(" "),
      compositeQuery,
      meta: {
        candidate_hits: totalHits,
        candidate_used: hits.length,
        pipeline_counts: {
          retrieval_hits_initial: retrievalHitsInitial,
          retrieval_hits_after_query: retrievalHitsAfterQuery,
          retrieval_hits_after_relevance: hitsAfterRelevanceGate,
          retrieval_hits_after_hard_gate: hitsAfterHardGate,
          hydrated_products: hydratedCount,
          constrained_products: constrainedCount,
        },
        strict_prompt_constraints: hardConstraints.enabled ? true : undefined,
        ...(retrievalFallbackUsed ? { retrieval_fallback_relaxed_query: true } : {}),
        ...(hardConstraintRelaxationLevel > 0
          ? { hard_constraint_relaxation_level: hardConstraintRelaxationLevel }
          : {}),
        ...(hardConstraintFallbackUsed ? { hard_constraint_fallback_used: true } : {}),
        ...(finalFloorFallbackUsed ? { final_floor_fallback_used: true } : {}),
        ...(geminiDegraded ? { gemini_degraded: true } : {}),
        ...(astPipelineDegraded ? { ast_pipeline_degraded: true } : {}),
      },
    };
  } catch (error) {
    console.error('[multiImageSearch] Error:', error);
    return { results: [], total: 0, tookMs: Date.now() - startTime };
  }
}

interface MultiImageHardConstraints {
  enabled: boolean;
  minPrice?: number;
  maxPrice?: number;
  categoryTerms: string[];
  brands: string[];
  gender?: string;
  requiredKeywords: string[];
  forbiddenKeywords: string[];
  minRequiredKeywordMatches: number;
  requireColorCompliance: boolean;
  requireTypeCompliance: boolean;
  minTypeCompliance: number;
}

const MULTI_IMAGE_KEYWORD_STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "for",
  "with",
  "from",
  "of",
  "to",
  "in",
  "on",
  "at",
  "like",
  "want",
  "need",
  "look",
  "image",
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "last",
]);

function normalizeConstraintKeyword(v: unknown): string | null {
  const s = String(v ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s || s.length < 3) return null;
  if (MULTI_IMAGE_KEYWORD_STOPWORDS.has(s)) return null;
  return s;
}

function collectConstraintKeywords(values: unknown[]): string[] {
  const out: string[] = [];
  for (const raw of values) {
    if (raw == null) continue;
    if (Array.isArray(raw)) {
      for (const x of raw) {
        const k = normalizeConstraintKeyword(x);
        if (k && !out.includes(k)) out.push(k);
      }
      continue;
    }
    const k = normalizeConstraintKeyword(raw);
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

function compactConstraintKeywords(
  values: unknown[],
  options?: { maxKeywords?: number },
): string[] {
  const maxKeywords = Math.max(1, options?.maxKeywords ?? 6);
  const raw = collectConstraintKeywords(values);
  if (raw.length <= maxKeywords) return raw;

  const prioritized = raw
    .slice()
    .sort((a, b) => {
      // Keep specific multi-token phrases before generic single words.
      const aWords = a.split(" ").length;
      const bWords = b.split(" ").length;
      if (aWords !== bWords) return bWords - aWords;
      return b.length - a.length;
    });

  return prioritized.slice(0, maxKeywords);
}

function buildMultiImageHardConstraints(
  ast: QueryAST,
  parsedIntent: ParsedIntent,
  rawPrompt: string,
  relevanceIntent: SearchHitRelevanceIntent,
): MultiImageHardConstraints {
  const prompt = rawPrompt?.trim() ?? "";
  if (!multiImageStrictPromptEnabled() || prompt.length < 10) {
    return {
      enabled: false,
      categoryTerms: [],
      brands: [],
      requiredKeywords: [],
      forbiddenKeywords: [],
      minRequiredKeywordMatches: 0,
      requireColorCompliance: false,
      requireTypeCompliance: false,
      minTypeCompliance: 0.45,
    };
  }

  const promptTypeTerms = extractPromptTypeTerms(rawPrompt);
  const promptColorTerms = extractPromptColorTerms(rawPrompt);

  const astPrice = ast.filters?.priceRange;
  const intentPriceMin = parsedIntent.constraints?.priceMin;
  const intentPriceMax = parsedIntent.constraints?.priceMax;
  const minPrice =
    astPrice?.min != null ? Number(astPrice.min) : intentPriceMin != null ? Number(intentPriceMin) : undefined;
  const maxPrice =
    astPrice?.max != null ? Number(astPrice.max) : intentPriceMax != null ? Number(intentPriceMax) : undefined;

  const categorySeeds = [
    parsedIntent.constraints?.category,
    ...(ast.entities?.categories ?? []),
    ...promptTypeTerms,
  ]
    .filter((x) => x != null && String(x).trim() !== "")
    .map((x) => String(x).toLowerCase().trim());

  const categoryTerms = [...new Set(categorySeeds.flatMap((c) => getCategorySearchTerms(c)))];

  const brands = [...new Set(
    [
      ...(parsedIntent.constraints?.brands ?? []),
      ...(ast.entities?.brands ?? []),
    ]
      .map((b) => String(b).toLowerCase().trim())
      .filter(Boolean),
  )];

  const gender =
    normalizeQueryGender(parsedIntent.constraints?.gender) ??
    normalizeQueryGender(ast.entities?.gender) ??
    undefined;

  const explicitMustHave = collectConstraintKeywords([
    parsedIntent.constraints?.mustHave ?? [],
  ]);
  const promptTypedKeywords = compactConstraintKeywords(
    [promptTypeTerms, ast.entities?.productTypes ?? []],
    { maxKeywords: 4 },
  );
  const promptColorKeywords = compactConstraintKeywords(
    [promptColorTerms, ast.entities?.colors ?? []],
    { maxKeywords: 3 },
  );
  const requiredKeywords = compactConstraintKeywords(
    [explicitMustHave, promptTypedKeywords, promptColorKeywords],
    { maxKeywords: 6 },
  );
  const minRequiredKeywordMatches =
    requiredKeywords.length <= 1
      ? requiredKeywords.length
      : requiredKeywords.length <= 3
        ? 1
        : requiredKeywords.length <= 5
          ? 2
          : 3;

  const forbiddenKeywords = collectConstraintKeywords([
    parsedIntent.constraints?.mustNotHave ?? [],
    collectMultiImageNegationTerms(parsedIntent, rawPrompt),
  ]);

  const requireColorCompliance =
    Boolean(relevanceIntent.promptAnchoredColorIntent) || promptColorTerms.length > 0;
  const requireTypeCompliance =
    Boolean(relevanceIntent.promptAnchoredTypeIntent) || promptTypeTerms.length > 0;

  const enabled =
    requireColorCompliance ||
    requireTypeCompliance ||
    forbiddenKeywords.length > 0 ||
    requiredKeywords.length > 0 ||
    brands.length > 0 ||
    categoryTerms.length > 0 ||
    gender != null ||
    minPrice != null ||
    maxPrice != null ||
    promptTypeTerms.length > 0 ||
    promptColorTerms.length > 0;

  return {
    enabled,
    minPrice,
    maxPrice,
    categoryTerms,
    brands,
    gender,
    requiredKeywords,
    forbiddenKeywords,
    minRequiredKeywordMatches,
    requireColorCompliance,
    requireTypeCompliance,
    minTypeCompliance: 0.45,
  };
}

function countKeywordMatches(blob: string, keywords: string[]): number {
  let matched = 0;
  for (const kw of keywords) {
    if (blob.includes(kw)) matched += 1;
  }
  return matched;
}

function multiImageHitPassesHardConstraints(
  hit: any,
  hard: MultiImageHardConstraints,
  rel?: HitCompliance,
): boolean {
  if (!hard.enabled) return true;
  const src = hit?._source ?? {};
  const blob = [
    src.title,
    src.brand,
    src.category,
    src.category_canonical,
    src.description,
    src.color,
    src.attr_color,
    ...(Array.isArray(src.attr_colors) ? src.attr_colors : []),
  ]
    .filter((x) => x != null && String(x).trim() !== "")
    .join(" ")
    .toLowerCase();

  const price = Number(src.price_usd);
  if (Number.isFinite(price)) {
    if (hard.minPrice != null && price < hard.minPrice) return false;
    if (hard.maxPrice != null && price > hard.maxPrice) return false;
  }

  if (hard.brands.length > 0) {
    const brand = String(src.brand ?? "").toLowerCase();
    if (!brand || !hard.brands.some((b) => brand.includes(b) || b.includes(brand))) return false;
  }

  if (hard.categoryTerms.length > 0) {
    const cat = `${String(src.category ?? "")} ${String(src.category_canonical ?? "")}`.toLowerCase();
    if (!hard.categoryTerms.some((t) => cat.includes(t))) return false;
  }

  if (hard.gender) {
    const g = normalizeQueryGender(String(src.audience_gender ?? src.attr_gender ?? "")) ?? undefined;
    if (g && g !== hard.gender && !(g === "unisex" && (hard.gender === "men" || hard.gender === "women"))) {
      return false;
    }
  }

  if (hard.forbiddenKeywords.length > 0 && hard.forbiddenKeywords.some((t) => blob.includes(t))) {
    return false;
  }

  if (hard.requiredKeywords.length > 0) {
    const matches = countKeywordMatches(blob, hard.requiredKeywords);
    if (matches < hard.minRequiredKeywordMatches) return false;
  }

  if (hard.requireColorCompliance && (rel?.colorCompliance ?? 0) <= 0) return false;
  if (hard.requireTypeCompliance && (rel?.productTypeCompliance ?? 0) < hard.minTypeCompliance) return false;
  return true;
}

function multiImageProductPassesHardConstraints(
  product: any,
  hard: MultiImageHardConstraints,
  rel?: HitCompliance,
): boolean {
  if (!hard.enabled) return true;
  const blob = productSearchTextBlob(product);
  const price = Number(product?.price ?? product?.price_usd);
  if (Number.isFinite(price)) {
    if (hard.minPrice != null && price < hard.minPrice) return false;
    if (hard.maxPrice != null && price > hard.maxPrice) return false;
  }

  if (hard.brands.length > 0) {
    const brand = String(product?.brand ?? "").toLowerCase();
    if (!brand || !hard.brands.some((b) => brand.includes(b) || b.includes(brand))) return false;
  }

  if (hard.categoryTerms.length > 0) {
    const cat = String(product?.category ?? "").toLowerCase();
    if (!hard.categoryTerms.some((t) => cat.includes(t) || blob.includes(t))) return false;
  }

  if (hard.gender) {
    const g = normalizeQueryGender(
      String(product?.audience_gender ?? product?.attr_gender ?? product?.gender ?? ""),
    ) ?? undefined;
    if (g && g !== hard.gender && !(g === "unisex" && (hard.gender === "men" || hard.gender === "women"))) {
      return false;
    }
  }

  if (hard.forbiddenKeywords.length > 0 && hard.forbiddenKeywords.some((t) => blob.includes(t))) {
    return false;
  }
  if (hard.requiredKeywords.length > 0) {
    const matches = countKeywordMatches(blob, hard.requiredKeywords);
    if (matches < hard.minRequiredKeywordMatches) return false;
  }
  if (hard.requireColorCompliance && (rel?.colorCompliance ?? 0) <= 0) return false;
  if (hard.requireTypeCompliance && (rel?.productTypeCompliance ?? 0) < hard.minTypeCompliance) return false;
  return true;
}

function relaxMultiImageHardConstraints(
  hard: MultiImageHardConstraints,
  level: 1 | 2,
): MultiImageHardConstraints {
  if (!hard.enabled) return hard;
  if (level === 1) {
    return {
      ...hard,
      minRequiredKeywordMatches:
        hard.requiredKeywords.length <= 1
          ? hard.minRequiredKeywordMatches
          : Math.max(1, Math.floor(hard.minRequiredKeywordMatches * 0.5)),
      minTypeCompliance: Math.max(0.3, hard.minTypeCompliance - 0.15),
    };
  }

  return {
    ...hard,
    requiredKeywords: [],
    minRequiredKeywordMatches: 0,
    requireTypeCompliance: false,
    minTypeCompliance: 0,
  };
}

function dedupeMultiImageResults(results: any[]): any[] {
  const seen = new Set<string>();
  const out: any[] = [];
  for (const r of results) {
    const key = [
      String(r?.vendor_id ?? ""),
      String(r?.name ?? "").toLowerCase().trim(),
      String(r?.image_url ?? "").toLowerCase().trim(),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
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
): Promise<{
  results: MultiVectorSearchResult[];
  total: number;
  tookMs: number;
  meta?: { gemini_degraded?: boolean };
}> {
  const startTime = Date.now();
  const { images, userPrompt, limit = 50, attributeWeights, explainScores = false } = request;

  try {
    const prepared = await preprocessMultiImageBuffers(images);
    const { parsedIntent, geminiDegraded } = await parseMultiImageIntentWithGuards(
      prepared,
      userPrompt,
    );
    reconcileIntentNegativeCollisions(parsedIntent);

    const attributeEmbedList: AttributeEmbedding[] = [];

    if (parsedIntent.imageIntents && parsedIntent.imageIntents.length > 0) {
      for (const imageIntent of parsedIntent.imageIntents) {
        const imageBuffer = prepared[imageIntent.imageIndex];
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
      for (let i = 0; i < prepared.length; i++) {
        const embedding = await processImageForEmbedding(prepared[i]);
        attributeEmbedList.push({
          attribute: "global",
          vector: embedding,
          weight: attributeWeights?.global || 1.0 / prepared.length,
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

    return {
      results: reranked,
      total: reranked.length,
      tookMs: Date.now() - startTime,
      meta: geminiDegraded ? { gemini_degraded: true } : undefined,
    };
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

function clampEnv01(raw: string | undefined, fallback: number, max: number): number {
  if (raw === undefined || String(raw).trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(0, n));
}

const MULTI_IMAGE_GEMINI_BUDGET_EXCEEDED = "MULTI_IMAGE_GEMINI_BUDGET";

/**
 * Bounded Gemini intent parse: missing key / outer budget → CLIP-only ParsedIntent (retrieval still runs).
 */
async function parseMultiImageIntentWithGuards(
  prepared: Buffer[],
  userPrompt: string,
): Promise<{ parsedIntent: ParsedIntent; geminiDegraded: boolean }> {
  const geminiBudgetMs = Math.max(
    1500,
    Number(process.env.MULTI_IMAGE_GEMINI_BUDGET_MS ?? 3000) || 3000,
  );
  const perCallTimeout = Math.max(
    1000,
    Number(process.env.MULTI_IMAGE_GEMINI_CALL_TIMEOUT_MS ?? 10000) || 10000,
  );
  const maxRetries = Math.max(
    0,
    Math.min(5, Number(process.env.GEMINI_INTENT_MAX_RETRIES ?? 2) || 2),
  );
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return {
      parsedIntent: createClipOnlyParsedIntent(prepared.length, userPrompt),
      geminiDegraded: true,
    };
  }
  const intentParser = new IntentParserService({
    apiKey,
    timeout: Math.min(perCallTimeout, geminiBudgetMs),
    maxRetries,
  });
  try {
    const parsedIntent = await Promise.race([
      intentParser.parseUserIntent(prepared, userPrompt),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error(MULTI_IMAGE_GEMINI_BUDGET_EXCEEDED)), geminiBudgetMs),
      ),
    ]);
    return { parsedIntent, geminiDegraded: false };
  } catch (e: any) {
    if (e?.message === MULTI_IMAGE_GEMINI_BUDGET_EXCEEDED) {
      console.warn("[multiImageIntent] Gemini budget exceeded, using CLIP-only intent");
      return {
        parsedIntent: createClipOnlyParsedIntent(prepared.length, userPrompt),
        geminiDegraded: true,
      };
    }
    throw e;
  }
}

/** Blend two unit-ish vectors and L2-normalize (CLIP cosine kNN). */
function blendUnitVectors(a: number[], b: number[], weightB: number): number[] {
  const wa = 1 - weightB;
  const wb = weightB;
  const out = new Array<number>(a.length);
  for (let i = 0; i < a.length; i++) {
    out[i] = wa * (a[i] ?? 0) + wb * (b[i] ?? 0);
  }
  const mag = Math.sqrt(out.reduce((sum, v) => sum + v * v, 0));
  if (mag === 0) return [...a];
  return out.map((v) => v / mag);
}

function buildMultiImageTextForEmbedding(userPrompt: string, intent: ParsedIntent): string {
  const parts: string[] = [userPrompt.trim()];
  if (intent.constraints?.category) {
    parts.push(String(intent.constraints.category));
  }
  const strat = intent.searchStrategy?.trim();
  if (strat && strat.length <= 280) {
    parts.push(strat);
  }
  return parts.filter((p) => p.length > 0).join(". ");
}

/**
 * Mix ensembled CLIP text embedding (see getQueryEmbedding) into the composite image vector
 * so the user's words affect kNN like they do in /search text.
 */
async function blendPromptClipIntoCompositeGlobal(
  compositeQuery: CompositeQuery,
  userPrompt: string,
  intent: ParsedIntent,
): Promise<void> {
  const w = clampEnv01(process.env.MULTI_IMAGE_PROMPT_EMBED_WEIGHT, 0.45, 0.65);
  if (w <= 0) return;
  const text = buildMultiImageTextForEmbedding(userPrompt, intent);
  if (!text) return;
  let promptEmb: number[] | null = null;
  try {
    promptEmb = await getQueryEmbedding(text);
  } catch {
    promptEmb = null;
  }
  const g = compositeQuery.embeddings.global;
  if (!promptEmb?.length || promptEmb.length !== g.length) return;
  const nImg = intent.imageIntents?.length ?? 0;
  const intentTrust = Math.min(
    1,
    (intent.confidence ?? 0.5) + 0.12 * Math.min(5, nImg),
  );
  // User instructions must move the kNN query: do not let high Gemini confidence erase the prompt vector.
  const promptChars = Math.min(500, userPrompt.trim().length);
  const substance01 = Math.min(1, promptChars / 72);
  const effectiveW = Math.min(
    0.56,
    w * (0.48 + 0.52 * substance01) * (1 - 0.12 * intentTrust),
  );
  console.info(
    `[multiImage] CLIP prompt blend: effective=${effectiveW.toFixed(3)} base=${w.toFixed(3)} intentTrust=${intentTrust.toFixed(3)} substance01=${substance01.toFixed(3)}`,
  );
  compositeQuery.embeddings.global = blendUnitVectors(g, promptEmb, effectiveW);
}

/**
 * Maps user prompt (QueryAST) + Gemini image intent into the same SearchHitRelevanceIntent
 * shape used by text search, so computeHitRelevance applies identical type/color/audience rules.
 */
function multiImageStrictPromptEnabled(): boolean {
  const v = String(process.env.MULTI_IMAGE_STRICT_PROMPT ?? "1").toLowerCase();
  return v !== "0" && v !== "false" && v !== "off";
}

function multiImageHasStrictPromptSignals(ast: QueryAST, rawPrompt: string): boolean {
  const t = rawPrompt?.trim() ?? "";
  if (t.length < 10) return false;
  const lexicalColorSignals = extractPromptColorTerms(t);
  const lexicalTypeSignals = extractPromptTypeTerms(t);
  if (parseNegations(t).negations.length > 0) return true;
  if (lexicalColorSignals.length > 0) return true;
  if (lexicalTypeSignals.length > 0) return true;
  if ((ast.entities?.colors ?? []).length > 0) return true;
  if ((ast.entities?.productTypes ?? []).length > 0) return true;
  if ((ast.entities?.categories ?? []).length > 0) return true;
  const pr = ast.filters?.priceRange;
  return Boolean(pr && (pr.min != null || pr.max != null));
}

function extractPromptColorTerms(rawPrompt: string): string[] {
  const q = String(rawPrompt ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!q) return [];
  const parts = q.split(" ").filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i < parts.length; i++) {
    const one = normalizeColorToken(parts[i]);
    if (one) out.add(one);
    if (i < parts.length - 1) {
      const two = normalizeColorToken(`${parts[i]} ${parts[i + 1]}`);
      if (two) out.add(two);
    }
  }
  return [...out];
}

function extractPromptTypeTerms(rawPrompt: string): string[] {
  const seeds = [
    ...extractLexicalProductTypeSeeds(rawPrompt),
    ...extractFashionTypeNounTokens(rawPrompt),
  ]
    .map((s) => String(s).toLowerCase().trim())
    .filter(Boolean);
  return [...new Set(seeds)];
}

function collectMultiImageNegationTerms(parsedIntent: ParsedIntent, rawPrompt: string): string[] {
  const fromNeg = parseNegations(rawPrompt).negations
    .map((n) => String(n.value).toLowerCase().trim())
    .filter((s) => s.length >= 2);
  const extras: string[] = [];
  const na = parsedIntent.constraints?.negativeAttributes;
  if (na) {
    for (const k of ["colors", "patterns", "materials", "textures", "styles", "details"] as const) {
      const arr = na[k];
      if (!Array.isArray(arr)) continue;
      for (const v of arr) {
        const s = String(v).toLowerCase().trim();
        if (s.length >= 2) extras.push(s);
      }
    }
  }
  for (const m of parsedIntent.constraints?.mustNotHave ?? []) {
    const s = String(m).toLowerCase().trim();
    if (s.length >= 2) extras.push(s);
  }
  return [...new Set([...fromNeg, ...extras])];
}

function buildMultiImageSearchHitRelevanceIntent(
  ast: QueryAST,
  parsedIntent: ParsedIntent,
  rawPrompt: string,
  astPipelineDegraded = false,
): SearchHitRelevanceIntent {
  const merged = mergeFilters(undefined, ast);
  const searchQ = ast.searchQuery?.trim();
  const lexicalTypeSeeds = [
    ...new Set(
      [
        ...extractLexicalProductTypeSeeds(rawPrompt),
        ...extractFashionTypeNounTokens(rawPrompt),
        ...(searchQ
          ? [
              ...extractLexicalProductTypeSeeds(searchQ),
              ...extractFashionTypeNounTokens(searchQ),
            ]
          : []),
      ].map((s) => s.toLowerCase()),
    ),
  ];
  const astProductTypes = (ast.entities.productTypes || []).map((t) => t.toLowerCase());
  let desiredProductTypes = [...new Set([...astProductTypes, ...lexicalTypeSeeds])];

  const promptAnchoredTypeIntent =
    astProductTypes.length > 0 || lexicalTypeSeeds.length > 0;

  const modelCategory = parsedIntent.constraints?.category?.toLowerCase()?.trim();
  if (desiredProductTypes.length === 0 && modelCategory) {
    desiredProductTypes = [...new Set(extractLexicalProductTypeSeeds(modelCategory))];
  }

  const mergedCategory =
    modelCategory ||
    (typeof merged.category === "string"
      ? merged.category
      : Array.isArray(merged.category)
        ? merged.category[0]
        : undefined);

  const fromAstColors = (ast.entities.colors ?? []).map((c) => String(c).toLowerCase());
  const fromPromptColors = extractPromptColorTerms(rawPrompt);
  const fromImageColors: string[] = [];
  for (const ii of parsedIntent.imageIntents || []) {
    const ev = ii.extractedValues as Record<string, unknown> | undefined;
    if (!ev) continue;
    const col = ev.color ?? ev.colour ?? ev.colors;
    const arr = Array.isArray(col) ? col : col != null ? [col] : [];
    for (const x of arr) {
      const s = String(x).toLowerCase().trim();
      if (s) fromImageColors.push(s);
    }
  }

  // When the user names colors in the prompt, those are restrictions — do not dilute with hues from uploads.
  const promptAnchoredColorIntent = fromAstColors.length > 0 || fromPromptColors.length > 0;
  const rerankDesiredColorsRaw = promptAnchoredColorIntent
    ? [...new Set([...fromAstColors, ...fromPromptColors].filter(Boolean))]
    : [...new Set([...fromAstColors, ...fromImageColors].filter(Boolean))];

  const rerankDesiredColors = [
    ...new Set(
      rerankDesiredColorsRaw
        .map((c) => normalizeColorToken(c) ?? c.toLowerCase())
        .filter(Boolean),
    ),
  ];
  const desiredColorsTier =
    rerankDesiredColorsRaw.length > 0 ? rerankDesiredColorsRaw : rerankDesiredColors;

  const queryGenderFromModel = normalizeQueryGender(parsedIntent.constraints?.gender);
  const queryGenderFromAst = normalizeQueryGender(merged.gender);
  const audienceGenderForScoring =
    queryGenderFromModel ?? queryGenderFromAst ?? (merged.gender ? String(merged.gender) : undefined);

  const queryAgeGroup = merged.ageGroup ?? ast.entities.ageGroup;
  const hasAudienceIntent = Boolean(queryAgeGroup || audienceGenderForScoring);

  const crossFamilyPenaltyWeight = Math.max(
    0,
    Math.min(2000, Number(process.env.SEARCH_CROSS_FAMILY_PENALTY_WEIGHT ?? "420") || 420),
  );

  const lexicalMatchQuery = searchQ || rawPrompt.trim() || undefined;

  const negationExcludeTerms = collectMultiImageNegationTerms(parsedIntent, rawPrompt);
  const hasPriceIntent =
    ast.filters?.priceRange != null &&
    (ast.filters.priceRange.min != null || ast.filters.priceRange.max != null);

  const enforcePromptConstraints =
    multiImageStrictPromptEnabled() &&
    rawPrompt.trim().length >= 12 &&
    (promptAnchoredColorIntent ||
      promptAnchoredTypeIntent ||
      negationExcludeTerms.length > 0 ||
      hasPriceIntent);

  return {
    desiredProductTypes,
    desiredColors: rerankDesiredColors,
    desiredColorsTier,
    rerankColorMode: ast.filters?.colorMode ?? "any",
    mergedCategory,
    astCategories: ast.entities.categories ?? [],
    queryAgeGroup,
    audienceGenderForScoring,
    hasAudienceIntent,
    crossFamilyPenaltyWeight,
    lexicalMatchQuery,
    astPipelineDegraded: astPipelineDegraded ? true : undefined,
    negationExcludeTerms: negationExcludeTerms.length > 0 ? negationExcludeTerms : undefined,
    enforcePromptConstraints: enforcePromptConstraints ? true : undefined,
    promptAnchoredColorIntent: promptAnchoredColorIntent ? true : undefined,
    promptAnchoredTypeIntent: promptAnchoredTypeIntent ? true : undefined,
  };
}

async function hydrateProductDetails(
  productIds: (string | number)[],
  sqlFilters: any[],
  variantOptions?: {
    primaryColorByProductId?: Map<string, string | null | undefined>;
    queryColorHints?: string[];
    textQuery?: string | null;
  },
): Promise<any[]> {
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
  const colorMap = variantOptions?.primaryColorByProductId;
  return result.rows.map((row: any) => ({
    ...row,
    color: colorMap?.get(String(row.id)) ?? row.color ?? null,
  }));
}

function productSearchTextBlob(product: any): string {
  return [
    product?.name,
    product?.title,
    product?.brand,
    product?.category,
    product?.color,
    product?.description,
  ]
    .filter((x) => x != null && String(x).trim() !== "")
    .map((x) => String(x).toLowerCase())
    .join(" ");
}

function productMatchesCompositeFilter(product: any, filter: { attribute: string; values: string[] }): boolean {
  const blob = productSearchTextBlob(product);
  const colorField = String(product?.color ?? "").toLowerCase();
  for (const v of filter.values) {
    const needle = String(v).toLowerCase().trim();
    if (!needle) continue;
    if (blob.includes(needle)) return true;
    if (filter.attribute === "color" && colorField) {
      if (colorField.includes(needle) || needle.includes(colorField)) return true;
    }
  }
  return false;
}

function calculateCompositeScore(
  vectorScore: number,
  product: any,
  query: CompositeQuery,
  weights: { vectorWeight: number; filterWeight: number; priceWeight: number },
): number {
  let score = weights.vectorWeight * vectorScore;

  let filterMatch = 0;
  let filterCount = 0;
  for (const filter of query.filters) {
    if (filter.operator === "exclude") continue;
    filterCount++;
    if (productMatchesCompositeFilter(product, filter)) {
      filterMatch += filter.weight || 1.0;
    }
  }
  if (filterCount > 0) {
    score += weights.filterWeight * Math.min(filterMatch / filterCount, 1.0);
  }

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