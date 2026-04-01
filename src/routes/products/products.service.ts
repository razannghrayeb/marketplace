import { osClient } from "../../lib/core/index";
import {
  pg,
  getProductsByIdsOrdered,
  productsTableHasIsHiddenColumn,
} from "../../lib/core/index";
import { config } from "../../config";
import { getImagesForProducts, ProductImage } from "./images.service";
import { hammingDistance } from "../../lib/products";
import {
  dedupeImageSearchResults,
  filterRelatedAgainstMain,
} from "../../lib/search/resultDedup";
import { getCategorySearchTerms } from "../../lib/search/categoryFilter";
import {
  emitImageSearchEval,
  searchEvalEnabled,
  newSearchEvalId,
  searchEvalVariant,
} from "../../lib/search/evalHooks";
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
  processQueryFast,
  getQueryEmbedding,
  type QueryAST,
} from "../../lib/queryProcessor";
import { expandColorTermsForFilter, normalizeColorToken } from "../../lib/color/queryColorFilter";
import {
  computeHitRelevance,
  normalizeQueryGender,
  type HitCompliance,
  type SearchHitRelevanceIntent,
} from "../../lib/search/searchHitRelevance";
import {
  extractFashionTypeNounTokens,
  extractLexicalProductTypeSeeds,
} from "../../lib/search/productTypeTaxonomy";
import type { SearchResultWithRelated } from "./types";

// ============================================================================
// Types
// ============================================================================

export type { SearchResultWithRelated };

export interface SearchFilters {
  category?: string | string[];
  brand?: string;
  minPriceCents?: number;
  maxPriceCents?: number;
  currency?: string; // 'LBP' or 'USD' - defaults to LBP
  availability?: boolean;
  vendorId?: string;
  color?: string;
  /** Bias ranking without hard filtering (image search). */
  softColor?: string;
  colors?: string[];
  colorMode?: "any" | "all";
  productTypes?: string[];
  ageGroup?: string;
  material?: string;
  fit?: string;
  style?: string;
  /** Bias ranking without hard filtering (image search). */
  softStyle?: string;
  /** Sleeve intent (short | long | sleeveless) for ranking. */
  sleeve?: string;
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
  /**
   * Garment-focused CLIP vector (`processImageForGarmentEmbedding`). Required for accurate kNN when
   * `knnField` / `SEARCH_IMAGE_KNN_FIELD` is `embedding_garment` (shop-the-look detection crops vs catalog).
   */
  imageEmbeddingGarment?: number[];
  /** Raw bytes when embedding is computed by the callee (unified image search path). */
  imageBuffer?: Buffer;
  /** Soft rerank hints when SEARCH_IMAGE_SOFT_CATEGORY=1 */
  predictedCategoryAisles?: string[];
  /** OpenSearch kNN field: `embedding` (default) or `embedding_garment` (see index + docs). */
  knnField?: string;
  /**
   * Forces image search into "hard category" mode for this call.
   * When enabled, OpenSearch `filters.category` is applied even if the
   * global SEARCH_IMAGE_SOFT_CATEGORY enables soft category reranking.
   */
  forceHardCategoryFilter?: boolean;
  /** Return best kNN hits when none pass similarityThreshold (Shop-the-Look). */
  relaxThresholdWhenEmpty?: boolean;
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
  rerankScore?: number;
  finalRelevance01?: number;
  clipSim?: number;        // 0..1 (cosine or normalized)
  textSim?: number;        // 0..1 (normalized)
  openSearchScore?: number; // raw or normalized
  pHashDist?: number;  
  candidateScore?: number;
}

// ============================================================================
// Unified Candidate Generator
// ============================================================================

export type CandidateSource = "clip" | "text" | "both";

export interface CandidateResult {
  candidateId: string;
  clipSim: number;           // 0..1 normalized CLIP similarity
  textSim: number;           // 0..1 normalized text/hybrid similarity
  opensearchScore: number;   // raw OpenSearch score from text search
  pHashDist?: number;        // Hamming distance (0-64), lower = more similar
  source: CandidateSource;   // where did this candidate come from
  // Product data
  product: ProductResult;
}

export interface CandidateGeneratorParams {
  baseProductId: string;
  limit?: number;            // final number of candidates returned (default 30)
  clipLimit?: number;        // how many to pull from CLIP kNN (default 200)
  textLimit?: number;        // how many to pull from text search (default 200)
  usePHashDedup?: boolean;   // use pHash to filter near-duplicates (default false)
  pHashThreshold?: number;   // max Hamming distance to consider duplicate (default 5)
}

export interface CandidateGeneratorResult {
  candidates: CandidateResult[];
  meta: {
    baseProductId: string;
    clipCandidates: number;
    textCandidates: number;
    mergedTotal: number;
    pHashFiltered: number;
    finalCount: number;
    timings?: {
      clipMs: number;
      textMs: number;
      pHashMs: number;
      totalMs: number;
    };
  };
}
/**
 * Search products by title text, image embedding, or filter-only browse.
 * Always routes through the unified search facade (QueryAST, domain gate, image pipeline).
 */
export async function searchProducts(params: SearchParams): Promise<ProductResult[]> {
  const { query, imageEmbedding, filters = {}, page = 1, limit = 20 } = params;
  const facade = await import("../../lib/search/fashionSearchFacade");

  if (imageEmbedding && imageEmbedding.length > 0) {
    const res = await facade.searchImage({
      imageEmbedding,
      filters: filters as any,
      limit,
      includeRelated: false,
    });
    return res.results as ProductResult[];
  }

  const q = query?.trim();
  if (q) {
    const res = await facade.searchText({
      query: q,
      filters: filters as any,
      page,
      limit,
      includeRelated: false,
      relatedLimit: 0,
    });
    return res.results as ProductResult[];
  }

  return facade.searchBrowse({ filters: filters as any, page, limit });
}

// ============================================================================
// Enhanced Image Search with Similarity Threshold
// ============================================================================

/** Default on when unset (production soft-category path). Set to 0/false for hard category filter. */
function imageSoftCategoryEnv(): boolean {
  const raw = process.env.SEARCH_IMAGE_SOFT_CATEGORY;
  if (raw === undefined || String(raw).trim() === "") return true;
  const v = String(raw).toLowerCase();
  if (v === "0" || v === "false" || v === "off" || v === "no") return false;
  return v === "1" || v === "true";
}

function imageGenderSoftEnv(): boolean {
  const v = String(process.env.SEARCH_IMAGE_GENDER_SOFT ?? "").toLowerCase();
  return v === "1" || v === "true";
}

/** OpenSearch kNN field for image search: `embedding` (full-frame CLIP) or `embedding_garment` (garment-focused). */
function resolveImageSearchKnnField(explicit?: string): "embedding" | "embedding_garment" {
  const fromCaller = explicit != null ? String(explicit).trim().toLowerCase() : "";
  const fromEnv = String(process.env.SEARCH_IMAGE_KNN_FIELD ?? "").trim().toLowerCase();
  const raw = fromCaller || fromEnv || "embedding";
  return raw === "embedding_garment" ? "embedding_garment" : "embedding";
}

/**
 * Normalize OpenSearch kNN score to OpenSearch cosinesimil [0,1] scale.
 * - Modern OpenSearch returns `(1 + cosθ) / 2` in [0,1]
 * - Some legacy setups returned `1 + cosθ` in [0,2]
 */
function knnCosinesimilScoreToOpenSearch01(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  const s = raw > 1.001 ? raw / 2 : raw;
  return Math.max(0, Math.min(1, s));
}

/**
 * Convert OpenSearch cosinesimil score to cosine-derived similarity [0,1].
 * This is stricter for visual quality:
 * - 0   => orthogonal/opposite (after clamp)
 * - 1   => identical direction
 */
function knnCosinesimilScoreToCosine01(raw: number): number {
  const os01 = knnCosinesimilScoreToOpenSearch01(raw);
  const cos = 2 * os01 - 1;
  return Math.max(0, Math.min(1, cos));
}

/**
 * Cosine similarity between two vectors, clamped to [0,1].
 *
 * Returns raw cosine clamped at 0 — same scale as `knnCosinesimilScoreToCosine01`
 * so visual and attribute scores are comparable in the composite ranking.
 * L2-normalized CLIP vectors always produce cos >= 0 in practice;
 * clamping negative values avoids artifacts from zero/degenerate vectors.
 */
function cosineSimilarity01(a: number[] | undefined, b: number[] | undefined): number {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const va = Number(a[i]);
    const vb = Number(b[i]);
    if (!Number.isFinite(va) || !Number.isFinite(vb)) return 0;
    dot += va * vb;
    na += va * va;
    nb += vb * vb;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom <= 1e-12) return 0;
  const cos = dot / denom;
  return Math.max(0, Math.min(1, cos));
}

/** When relaxThresholdWhenEmpty is used, drop hits below this normalized cosine (see config.search.searchImageRelaxFloor). */
function imageRelaxSimilarityFloor(): number {
  return config.search.searchImageRelaxFloor;
}

function imageVisualRescueMinSimilarity(): number {
  const raw = Number(process.env.SEARCH_IMAGE_VISUAL_RESCUE_MIN_SIM);
  if (Number.isFinite(raw)) return Math.max(0.45, Math.min(0.99, raw));
  return 0.72;
}

function imageVisualRescueMaxCount(): number {
  const raw = Number(process.env.SEARCH_IMAGE_VISUAL_RESCUE_MAX_COUNT);
  if (Number.isFinite(raw)) return Math.max(0, Math.min(40, Math.floor(raw)));
  return 8;
}

function imageVisualRescueAudienceMin(): number {
  const raw = Number(process.env.SEARCH_IMAGE_VISUAL_RESCUE_AUDIENCE_MIN);
  if (Number.isFinite(raw)) return Math.max(0, Math.min(1, raw));
  return 0.45;
}

function imageKnnTimeoutMs(): number {
  const raw = Number(process.env.SEARCH_IMAGE_KNN_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw >= 500) return Math.min(120_000, Math.floor(raw));
  return 12_000;
}

async function opensearchImageKnnHits(
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<any[]> {
  const startedAt = Date.now();

  const boolQ = (body as any)?.query?.bool;
  const knnObj = boolQ?.must?.knn;
  const knnField = knnObj ? Object.keys(knnObj)[0] : undefined;
  const queryVectorRaw = knnField ? knnObj?.[knnField]?.vector : undefined;
  const queryVector =
    Array.isArray(queryVectorRaw)
      ? queryVectorRaw
      : ArrayBuffer.isView(queryVectorRaw)
        ? Array.from(queryVectorRaw as any)
        : null;

  if (process.env.NODE_ENV !== "production" && knnField && queryVector) {
    console.log("[DEBUG] query vector stats:", {
      index: config.opensearch.index,
      field: knnField,
      vectorLength: queryVector.length,
      hasNaN: queryVector.some((v: number) => Number.isNaN(v)),
      allZero: queryVector.every((v: number) => v === 0),
      magnitude: Math.sqrt(
        queryVector.reduce((s: number, v: number) => s + v * v, 0),
      ),
      first3: queryVector.slice(0, 3),
      timeoutMs,
    });
  }

  try {
    // Do not pass `signal` on the first arg — the client forwards unknown keys as URL query
    // params and OpenSearch rejects `?signal=...`. Use Transport `requestTimeout` instead.
    const r = await osClient.search(
      {
        index: config.opensearch.index,
        body: body as any,
        timeout: `${Math.max(1, Math.ceil(timeoutMs / 1000))}s`,
      },
      { requestTimeout: timeoutMs },
    );

    const hits = (r.body?.hits?.hits ?? []) as any[];

    if (process.env.NODE_ENV !== "production") {
      console.log("[image-knn] search ok", {
        index: config.opensearch.index,
        field: knnField ?? null,
        vectorLength: queryVector?.length ?? null,
        hits: hits.length,
        elapsedMs: Date.now() - startedAt,
        took: r.body?.took ?? null,
      });
    }

    return hits;
  } catch (err: any) {
    const timedOut =
      err?.name === "TimeoutError" ||
      err?.message?.includes?.("timeout") ||
      err?.meta?.statusCode === 408;

    if (timedOut) {
      console.error("[image-knn] request timeout", {
        index: config.opensearch.index,
        field: knnField ?? null,
        vectorLength: queryVector?.length ?? null,
        timeoutMs,
        elapsedMs: Date.now() - startedAt,
      });
      return [];
    }

    console.error("[image-knn] opensearch error", {
      index: config.opensearch.index,
      field: knnField ?? null,
      vectorLength: queryVector?.length ?? null,
      elapsedMs: Date.now() - startedAt,
      message: err?.message ?? null,
      name: err?.name ?? null,
      statusCode: err?.meta?.statusCode ?? null,
      responseBody: err?.meta?.body ?? null,
    });

    return [];
  }
}

function buildDesiredCatalogTermSet(aisles: string[]): Set<string> {
  const s = new Set<string>();
  for (const a of aisles) {
    for (const t of getCategorySearchTerms(a)) {
      s.add(t.toLowerCase());
    }
  }
  return s;
}

function categorySoftScoreForHit(hit: any, desiredCatalogTerms: Set<string> | null): number {
  if (!desiredCatalogTerms || desiredCatalogTerms.size === 0) return 0;
  const category = String(hit?._source?.category ?? "").toLowerCase().trim();
  const categoryCanonical = String(hit?._source?.category_canonical ?? "")
    .toLowerCase()
    .trim();
  const productTypes = Array.isArray(hit?._source?.product_types)
    ? hit._source.product_types.map((t: unknown) => String(t).toLowerCase().trim())
    : [];

  if ((category && desiredCatalogTerms.has(category)) || (categoryCanonical && desiredCatalogTerms.has(categoryCanonical))) {
    return 1;
  }
  if (productTypes.some((t: string) => t && desiredCatalogTerms.has(t))) {
    return 0.88;
  }
  return 0;
}

/**
 * Search products by image with similarity threshold and optional pHash matching
 * Returns similar images above the threshold, sorted by similarity
 */
export async function searchByImageWithSimilarity(
  params: ImageSearchParams
): Promise<SearchResultWithRelated> {
  const {
    imageEmbedding,
    imageEmbeddingGarment,
    imageBuffer,
    filters = {},
    page = 1,
    limit = 500,
    similarityThreshold = config.clip.imageSimilarityThreshold,
    includeRelated = true,
    pHash,
    predictedCategoryAisles,
    knnField: knnFieldParam,
    forceHardCategoryFilter = false,
    /** When strict similarity yields no hits, fall back to best candidates above SEARCH_IMAGE_RELAX_FLOOR. Default off for closer visual matches. */
    relaxThresholdWhenEmpty = false,
    query: imageSearchTextQuery,
  } = params;

  if (!imageEmbedding || imageEmbedding.length === 0) {
    return { results: [], meta: { threshold: similarityThreshold, total_results: 0 } };
  }

  const evalT0 = Date.now();
  const breakdownDebug =
    String(process.env.SEARCH_DEBUG ?? "").toLowerCase() === "1" ||
    String(process.env.SEARCH_TRACE_BREAKDOWN ?? "").toLowerCase() === "1";

  // Over-fetch so absolute threshold + later dedup still fill `limit` (cap raised for broader kNN recall).
  const fetchLimit = Math.min(Math.max(limit * 5, 500), 500);

  const softCategory = forceHardCategoryFilter ? false : imageSoftCategoryEnv();
  const aisleHints = predictedCategoryAisles?.length
    ? predictedCategoryAisles
    : undefined;
  const cat = (filters as { category?: string | string[] }).category;
  /** Aisle rerank when global soft category is on, or when caller passes predictedCategoryAisles (e.g. Shop-the-Look). */
  const useAisleRerank = !forceHardCategoryFilter && (softCategory || Boolean(aisleHints?.length));
  const desiredCatalogTerms =
    useAisleRerank && (aisleHints?.length || cat)
      ? buildDesiredCatalogTermSet(
          aisleHints?.length
            ? aisleHints
            : Array.isArray(cat)
              ? cat.map((c) => String(c))
              : [String(cat)],
        )
      : null;

  // Build filter array
  const filter: any[] = [
    { term: { is_hidden: false } },
    {
      bool: {
        must_not: [
          { terms: { category: ["candles & holders", "pots & plants", "home decor"] } },
        ],
      },
    },
  ];
  if (!softCategory || !desiredCatalogTerms || desiredCatalogTerms.size === 0) {
    if (cat) {
      if (Array.isArray(cat)) {
        const terms = cat.map((c) => String(c).toLowerCase()).filter(Boolean);
        if (terms.length > 0) filter.push({ terms: { category: terms } });
      } else {
        filter.push({ term: { category: String(cat).toLowerCase() } });
      }
    }
  }
  if (filters.brand) filter.push({ term: { brand: String(filters.brand).toLowerCase() } });
  if (filters.vendorId) filter.push({ term: { vendor_id: String(filters.vendorId) } });
  const filtersAny = filters as { gender?: string; color?: string; softColor?: string; style?: string; softStyle?: string };
  if (filtersAny.gender) {
    const g = String(filtersAny.gender).toLowerCase().trim();
    // For image-search we need to be resilient to occasional index attribute mistakes.
    // We therefore:
    // - allow either `attr_gender` match OR title keyword match for the desired gender
    // - but explicitly exclude the opposite gender keyword in title.
    const titleGenderShould =
      g === "women"
        ? ["women", "womens", "female", "ladies", "woman"]
        : g === "men"
          ? ["men", "mens", "male", "boys", "boy", "man"]
          : ["unisex"];

    const titleOppShould =
      g === "women"
        ? ["men", "mens", "male", "boys", "boy", "man"]
        : g === "men"
          ? ["women", "womens", "female", "ladies", "woman", "girls", "girl"]
          : [];

    const shouldClauses: any[] = [{ term: { attr_gender: g } }];
    if (imageGenderSoftEnv()) {
      // In "soft gender" mode, we also allow a title keyword match.
      for (const kw of titleGenderShould) {
        shouldClauses.push({ match: { title: kw } });
      }
    } else {
      // In hard mode, title match is still useful as a correction signal when `attr_gender`
      // is occasionally wrong. (We still exclude opposite title keywords below.)
      for (const kw of titleGenderShould) {
        shouldClauses.push({ match: { title: kw } });
      }
    }

    const mustNot: any[] =
      titleOppShould.length > 0
        ? [
            {
              bool: {
                should: titleOppShould.map((kw) => ({ match: { title: kw } })),
                minimum_should_match: 1,
              },
            },
          ]
        : [];

    filter.push({
      bool: {
        should: shouldClauses,
        minimum_should_match: 1,
        must_not: mustNot.length ? mustNot : undefined,
      },
    });
  }
  if (filtersAny.style) {
    const s = String(filtersAny.style).toLowerCase();
    if (s.length > 0) filter.push({ term: { attr_style: s } });
  }
  if (filtersAny.color) {
    const expanded = expandColorTermsForFilter(String(filtersAny.color));
    filter.push({
      bool: {
        should: [
          { terms: { attr_color: expanded } },
          { terms: { attr_colors: expanded } },
          { terms: { color_palette_canonical: expanded } },
        ],
        minimum_should_match: 1,
      },
    });
  }

  /** Always retrieve via embedding; attribute fields used only for reranking. k=500 for broad catalog recall. */
  const retrievalK = Math.min(
    500,
    Math.max(200, Number(process.env.SEARCH_IMAGE_RETRIEVAL_K) || 500),
  );

  let colorQueryEmbedding: number[] | null = null;
  let styleQueryEmbedding: number[] | null = null;
  let patternQueryEmbedding: number[] | null = null;
  if (imageBuffer && Buffer.isBuffer(imageBuffer) && imageBuffer.length > 0) {
    try {
      const { attributeEmbeddings } = await import("../../lib/search/attributeEmbeddings");
      const [cEmb, sEmb, pEmb] = await Promise.all([
        attributeEmbeddings.generateImageAttributeEmbedding(imageBuffer, "color").catch(() => [] as number[]),
        attributeEmbeddings.generateImageAttributeEmbedding(imageBuffer, "style").catch(() => [] as number[]),
        attributeEmbeddings.generateImageAttributeEmbedding(imageBuffer, "pattern").catch(() => [] as number[]),
      ]);
      colorQueryEmbedding = cEmb.length > 0 ? cEmb : null;
      styleQueryEmbedding = sEmb.length > 0 ? sEmb : null;
      patternQueryEmbedding = pEmb.length > 0 ? pEmb : null;
    } catch {
      colorQueryEmbedding = null;
      styleQueryEmbedding = null;
      patternQueryEmbedding = null;
    }
  }

  const runColor = Boolean(colorQueryEmbedding && colorQueryEmbedding.length > 0);
  const runStyle = Boolean(styleQueryEmbedding && styleQueryEmbedding.length > 0);
  const runPattern = Boolean(patternQueryEmbedding && patternQueryEmbedding.length > 0);

  let knnFieldResolved = resolveImageSearchKnnField(knnFieldParam);
  let queryVector: number[] = imageEmbedding;
  if (knnFieldResolved === "embedding_garment") {
    let gv =
      imageEmbeddingGarment && imageEmbeddingGarment.length > 0 ? imageEmbeddingGarment : null;
    if (!gv && imageBuffer && Buffer.isBuffer(imageBuffer) && imageBuffer.length > 0) {
      try {
        const { processImageForGarmentEmbedding } = await import("../../lib/image");
        const out = await processImageForGarmentEmbedding(imageBuffer);
        gv = out?.length ? out : null;
      } catch {
        gv = null;
      }
    }
    if (gv) {
      queryVector = gv;
    } else {
      knnFieldResolved = "embedding";
      queryVector = imageEmbedding;
      if (breakdownDebug) {
        console.warn("[image-knn] embedding_garment vector missing; using embedding field + global query vector");
      }
    }
  }

  const knnBody = {
    size: retrievalK,
    _source: [
      "product_id",
      "title",
      "brand",
      "category",
      "category_canonical",
      "product_types",
      "attr_gender",
      "attr_color",
      "attr_colors",
      "attr_colors_text",
      "attr_colors_image",
      "attr_sleeve",
      "norm_confidence",
      "type_confidence",
      "color_confidence_text",
      "color_confidence_image",
      "color_palette_canonical",
      "color_primary_canonical",
      "color_secondary_canonical",
      "color_accent_canonical",
      "age_group",
      "audience_gender",
      "embedding_color",
      "embedding_style",
      "embedding_pattern",
    ],
    query: {
      bool: {
        must: {
          knn: {
            [knnFieldResolved]: {
              vector: queryVector,
              k: retrievalK,
            },
          },
        },
        filter,
      },
    },
  };

  const knnTimeoutMs = imageKnnTimeoutMs();
  const hits = await opensearchImageKnnHits(knnBody, knnTimeoutMs);

  /** Always compare cosine similarity in [0,1] to threshold (same semantics as fusion vs primary-only kNN). */
  const passesImageSimilarityThreshold = (hit: any, thresh: number): boolean =>
    knnCosinesimilScoreToCosine01(Number(hit._score)) >= thresh;

  const rawOpenSearchHitCount = Array.isArray(hits) ? hits.length : 0;
  const aisleSoftWeight = Math.max(
    0,
    Math.min(400, Number(process.env.SEARCH_IMAGE_AISLE_SOFT_WEIGHT ?? "130") || 130),
  );
  // Keep the fetch window aligned with true kNN order first: aisle/category boosts must not
  // evict higher-similarity neighbors when recall size exceeds fetchLimit (or env tweaks diverge).
  const hitsByKnnScore = [...hits].sort(
    (a: any, b: any) => Number(b._score) - Number(a._score),
  );
  const hitsWithinFetch = hitsByKnnScore.slice(0, fetchLimit);
  // Broad retrieval, then soft rerank (visual + category) within that visual slice, then gates.
  const baseCandidates = hitsWithinFetch
    .map((hit: any) => {
      const visualSim = knnCosinesimilScoreToCosine01(Number(hit._score));
      const categorySoft =
        useAisleRerank && !forceHardCategoryFilter
          ? categorySoftScoreForHit(hit, desiredCatalogTerms)
          : 0;
      const softScore = visualSim * 1000 + categorySoft * aisleSoftWeight;
      return { hit, softScore };
    })
    .sort((a, b) => b.softScore - a.softScore)
    .map((x) => x.hit);

  /** Per-hit soft signals for ranking + explain (visual + category + optional attribute embeddings). */
  const imageCompositeById = new Map<string, number>();
  const styleSimById = new Map<string, number>();
  const colorSimById = new Map<string, number>();
  const patternSimById = new Map<string, number>();
  const taxonomyMatchById = new Map<string, number>();

  const wColor = Math.max(0, Number(process.env.SEARCH_IMAGE_RERANK_COLOR_WEIGHT ?? "220") || 220);
  const wStyle = Math.max(0, Number(process.env.SEARCH_IMAGE_RERANK_STYLE_WEIGHT ?? "60") || 60);
  const wPattern = Math.max(0, Number(process.env.SEARCH_IMAGE_RERANK_PATTERN_WEIGHT ?? "40") || 40);

  for (const hit of baseCandidates) {
    const idStr = String(hit._source.product_id);
    const visualSim = knnCosinesimilScoreToCosine01(Number(hit._score));
    const categorySoft =
      useAisleRerank && !forceHardCategoryFilter
        ? categorySoftScoreForHit(hit, desiredCatalogTerms)
        : 0;

    const colorSim = runColor
      ? cosineSimilarity01(colorQueryEmbedding ?? undefined, hit._source?.embedding_color)
      : 0;
    const styleSim = runStyle
      ? cosineSimilarity01(styleQueryEmbedding ?? undefined, hit._source?.embedding_style)
      : 0;
    const patternSim = runPattern
      ? cosineSimilarity01(patternQueryEmbedding ?? undefined, hit._source?.embedding_pattern)
      : 0;

    styleSimById.set(idStr, Math.round(styleSim * 1000) / 1000);
    colorSimById.set(idStr, Math.round(colorSim * 1000) / 1000);
    patternSimById.set(idStr, Math.round(patternSim * 1000) / 1000);
    taxonomyMatchById.set(idStr, categorySoft);

    // Prevent color/style/pattern from overpowering poor visual matches.
    // When visual similarity is low, attribute boosts are softened.
    // Keep style/color impactful while still reducing dominance on weak visual matches.
    const attrGate = 0.4 + 0.6 * visualSim;
    const composite =
      visualSim * 1000 +
      (categorySoft * aisleSoftWeight + colorSim * wColor + styleSim * wStyle + patternSim * wPattern) *
        attrGate;
    imageCompositeById.set(idStr, composite);
  }

  const crossFamilyPenaltyWeight = Math.max(
    0,
    Math.min(2000, Number(process.env.SEARCH_CROSS_FAMILY_PENALTY_WEIGHT ?? "420") || 420),
  );
  const filtersRecord = filters as Record<string, unknown>;
  const filterCategory = (filters as { category?: string | string[] }).category;
  const mergedCategoryForRelevance = Array.isArray(filterCategory)
    ? filterCategory[0]
    : filterCategory;
  const astCategoriesForRelevance = [
    ...new Set(
      [
        ...(predictedCategoryAisles ?? []).map((x) => String(x).toLowerCase().trim()).filter(Boolean),
        ...(Array.isArray(filterCategory)
          ? filterCategory
          : filterCategory
            ? [String(filterCategory)]
            : []
        ).map((x) => String(x).toLowerCase().trim()),
      ].filter(Boolean),
    ),
  ];

  const textQueryForRelevance =
    typeof imageSearchTextQuery === "string" && imageSearchTextQuery.trim()
      ? imageSearchTextQuery.trim()
      : "";

  let desiredProductTypes: string[] = [];
  if (Array.isArray(filtersRecord.productTypes) && filtersRecord.productTypes.length > 0) {
    desiredProductTypes = [
      ...new Set(
        filtersRecord.productTypes.map((t: unknown) => String(t).toLowerCase().trim()).filter(Boolean),
      ),
    ];
  } else {
    const fromFilterCat =
      filterCategory != null
        ? (Array.isArray(filterCategory) ? filterCategory : [filterCategory]).flatMap((c) =>
            extractLexicalProductTypeSeeds(String(c)),
          )
        : [];
    const fromPredicted = predictedCategoryAisles?.length
      ? predictedCategoryAisles.flatMap((a) => extractLexicalProductTypeSeeds(String(a)))
      : [];
    desiredProductTypes = [
      ...new Set(
        [...fromFilterCat, ...fromPredicted]
          .map((t) => String(t).toLowerCase().trim())
          .filter(Boolean),
      ),
    ];
  }
  if (textQueryForRelevance) {
    const fromText = extractFashionTypeNounTokens(textQueryForRelevance).map((t) => t.toLowerCase());
    if (fromText.length > 0) {
      desiredProductTypes = [...new Set([...desiredProductTypes, ...fromText])];
    }
  }

  const explicitColorsForRelevance =
    Array.isArray(filtersRecord.colors) && filtersRecord.colors.length > 0
      ? filtersRecord.colors.map((c: unknown) => String(c).toLowerCase())
      : filtersRecord.color
        ? [String(filtersRecord.color).toLowerCase()]
        : [];
  const softColorsForRelevance =
    typeof filtersRecord.softColor === "string" && filtersRecord.softColor.trim().length > 0
      ? [String(filtersRecord.softColor).toLowerCase()]
      : [];
  const allColorsForRelevance = [...explicitColorsForRelevance, ...softColorsForRelevance];
  const hasExplicitColorIntent = explicitColorsForRelevance.length > 0;
  const desiredColorsForRelevance = [
    ...new Set(
      allColorsForRelevance.map((c) => normalizeColorToken(c) ?? c).filter(Boolean),
    ),
  ];
  const rerankColorModeForRelevance = filtersRecord.colorMode === "all" ? "all" : "any";
  const desiredColorsTierForRelevance =
    allColorsForRelevance.length > 0 ? allColorsForRelevance : desiredColorsForRelevance;

  const queryAgeGroupForRelevance =
    typeof filtersRecord.ageGroup === "string" ? filtersRecord.ageGroup : undefined;
  const queryGenderNorm = normalizeQueryGender(filtersAny.gender);
  const hasAudienceIntentForRelevance = Boolean(queryAgeGroupForRelevance || queryGenderNorm);

  const desiredStyleForRelevance =
    typeof filtersRecord.style === "string"
      ? String(filtersRecord.style).toLowerCase().trim()
      : typeof filtersRecord.softStyle === "string"
        ? String(filtersRecord.softStyle).toLowerCase().trim()
        : undefined;
  const desiredSleeveForRelevance =
    typeof filtersRecord.sleeve === "string" ? String(filtersRecord.sleeve).toLowerCase().trim() : undefined;

  const softColorBiasOnly = !hasExplicitColorIntent && softColorsForRelevance.length > 0;

  const relevanceIntent: SearchHitRelevanceIntent = {
    desiredProductTypes,
    desiredColors: desiredColorsForRelevance,
    desiredColorsTier: desiredColorsTierForRelevance,
    rerankColorMode: rerankColorModeForRelevance,
    desiredStyle: desiredStyleForRelevance,
    desiredSleeve: desiredSleeveForRelevance,
    mergedCategory: mergedCategoryForRelevance
      ? String(mergedCategoryForRelevance).toLowerCase()
      : undefined,
    astCategories: astCategoriesForRelevance,
    queryAgeGroup: queryAgeGroupForRelevance,
    audienceGenderForScoring: filtersAny.gender,
    hasAudienceIntent: hasAudienceIntentForRelevance,
    crossFamilyPenaltyWeight,
    lexicalMatchQuery: textQueryForRelevance || undefined,
    tightSemanticCap: true,
    softColorBiasOnly,
  };

  const complianceById = new Map<string, HitCompliance>();
  const colorByHitId = new Map<string, string | null>();
  for (const hit of baseCandidates) {
    const idStr = String(hit._source.product_id);
    const sim = knnCosinesimilScoreToCosine01(Number(hit._score));
    // Keep full precision for relevance calibration; only round for display later.
    const rel = computeHitRelevance(hit, sim, relevanceIntent);
    const { primaryColor, ...comp } = rel;
    complianceById.set(idStr, comp);
    colorByHitId.set(idStr, primaryColor);
  }

  const sortedByRelevance = [...baseCandidates].sort((a: any, b: any) => {
    const ida = String(a._source.product_id);
    const idb = String(b._source.product_id);
    const fa = complianceById.get(ida)?.finalRelevance01 ?? 0;
    const fb = complianceById.get(idb)?.finalRelevance01 ?? 0;
    if (Math.abs(fb - fa) > 1e-8) return fb - fa;
    const ia = imageCompositeById.get(ida) ?? 0;
    const ib = imageCompositeById.get(idb) ?? 0;
    if (Math.abs(ib - ia) > 1e-8) return ib - ia;
    const ra = complianceById.get(ida)?.rerankScore ?? 0;
    const rb = complianceById.get(idb)?.rerankScore ?? 0;
    return rb - ra;
  });

  // Post-filter by gender using both indexed gender and title keywords.
  // This is a safety net for index mislabeling (so "women" caption doesn't return "men" products).
  // We only apply it when caller explicitly requested gender.
  const rankedHitsCandidates = (() => {
    if (!filtersAny.gender) return sortedByRelevance;
    const wantG = normalizeQueryGender(filtersAny.gender);
    if (!wantG) return sortedByRelevance;

    const title = (t: any) => (typeof t === "string" ? t.toLowerCase() : "");
    const docGender = (hit: any) => {
      const raw = hit?._source?.audience_gender ?? hit?._source?.attr_gender;
      const s = typeof raw === "string" ? raw.toLowerCase() : "";
      if (s === "men" || s === "women" || s === "unisex") return s;
      return null;
    };

    const wantKw =
      wantG === "women"
        ? ["women", "womens", "female", "ladies", "woman"]
        : wantG === "men"
          ? ["men", "mens", "male", "boy", "boys", "man"]
          : ["unisex"];

    const oppKw =
      wantG === "women"
        ? ["men", "mens", "male", "boy", "boys", "man"]
        : wantG === "men"
          ? ["women", "womens", "female", "ladies", "woman", "girl", "girls"]
          : [];

    const matches = (hit: any) => {
      const dg = docGender(hit);
      const t = title(hit?._source?.title);
      if (dg === wantG) return true;
      const hasWant = wantKw.some((kw) => new RegExp(`\\b${kw}\\b`).test(t));
      if (!hasWant) return false;
      if (oppKw.length > 0 && oppKw.some((kw) => new RegExp(`\\b${kw}\\b`).test(t))) return false;
      return true;
    };

    const filtered = sortedByRelevance.filter((h: any) => matches(h));
    return filtered.length > 0 ? filtered : sortedByRelevance;
  })();

  // Late visual gate (after soft rerank).
  const thresholdPassedByVisual = rankedHitsCandidates.filter((h: any) =>
    passesImageSimilarityThreshold(h, similarityThreshold),
  );
  let thresholdRelaxed = false;
  let relaxFloorUsed: number | null = null;
  let visualGatedHits = thresholdPassedByVisual;
  if (relaxThresholdWhenEmpty && thresholdPassedByVisual.length === 0 && rankedHitsCandidates.length > 0) {
    const floor = imageRelaxSimilarityFloor();
    relaxFloorUsed = floor;
    visualGatedHits = rankedHitsCandidates.filter((h: any) =>
      passesImageSimilarityThreshold(h, floor),
    );
    thresholdRelaxed = visualGatedHits.length > 0;
  }

  if (relaxThresholdWhenEmpty) {
    const minWantCandidates = Math.min(fetchLimit, Math.max(limit, 15));
    if (visualGatedHits.length < minWantCandidates && rankedHitsCandidates.length > visualGatedHits.length) {
      const floor = imageRelaxSimilarityFloor();
      relaxFloorUsed = floor;
      const loose = rankedHitsCandidates.filter((h: any) =>
        passesImageSimilarityThreshold(h, floor),
      );
      if (loose.length > visualGatedHits.length) {
        visualGatedHits = loose;
        thresholdRelaxed = true;
      }
    }
  }

  /** True when reranked candidates exist but visual gate removed all (without relaxation). */
  const belowRelevanceThreshold =
    rankedHitsCandidates.length > 0 && thresholdPassedByVisual.length === 0 && !thresholdRelaxed;

  const finalAcceptMin = config.search.finalAcceptMinImage;
  let effectiveFinalAcceptMin = finalAcceptMin;
  let rankedHits = visualGatedHits.filter(
    (h: any) => (complianceById.get(String(h._source.product_id))?.finalRelevance01 ?? 0) >= effectiveFinalAcceptMin,
  );

  // Keep a small high-visual slice even when metadata-based relevance is noisy.
  // This prevents true visual neighbors (including the same catalog item) from being
  // dropped solely due to weak/missing type/color fields.
  const rescueMinSim = imageVisualRescueMinSimilarity();
  const rescueMaxCount = imageVisualRescueMaxCount();
  if (rescueMaxCount > 0) {
    const existingIds = new Set(rankedHits.map((h: any) => String(h._source.product_id)));
    const rescueAudienceMin = imageVisualRescueAudienceMin();
    const rescue: any[] = visualGatedHits
      .filter((h: any) => !existingIds.has(String(h._source.product_id)))
      .map((h: any) => {
        const id = String(h._source.product_id);
        const visualSim = knnCosinesimilScoreToCosine01(Number(h._score));
        const comp = complianceById.get(id);
        const aud = comp?.audienceCompliance ?? 1;
        return { h, visualSim, aud };
      })
      .filter(({ visualSim, aud }) => {
        if (visualSim < rescueMinSim) return false;
        if (hasAudienceIntentForRelevance && aud < rescueAudienceMin) return false;
        return true;
      })
      .sort((a, b) => b.visualSim - a.visualSim)
      .slice(0, rescueMaxCount)
      .map((x) => x.h);
    if (rescue.length > 0) {
      rankedHits = [...rankedHits, ...rescue];
    }
  }

  let relevanceRelaxedForMinCount = false;
  const imageMinResultsTarget = config.search.imageSearchMinResults;
  const relevanceRelaxDelta = config.search.imageSearchRelevanceRelaxDelta;
  if (
    imageMinResultsTarget > 0 &&
    rankedHits.length < imageMinResultsTarget &&
    visualGatedHits.length > rankedHits.length
  ) {
    const relaxedMin = Math.max(finalAcceptMin * 0.6, finalAcceptMin - relevanceRelaxDelta);
    if (relaxedMin < finalAcceptMin) {
      const expanded = visualGatedHits.filter(
        (h: any) =>
          (complianceById.get(String(h._source.product_id))?.finalRelevance01 ?? 0) >= relaxedMin,
      );
      if (expanded.length > rankedHits.length) {
        rankedHits = expanded;
        effectiveFinalAcceptMin = relaxedMin;
        relevanceRelaxedForMinCount = true;
      }
    }
  }
  const countAfterFinalAcceptMin = rankedHits.length;

  const belowFinalRelevanceGate = visualGatedHits.length > 0 && rankedHits.length === 0;

  if (hasExplicitColorIntent && desiredColorsForRelevance.length > 0) {
    const strictColorPost = String(process.env.SEARCH_COLOR_POSTFILTER_STRICT ?? "1").toLowerCase() !== "0";
    const maxImgConfHits = Math.max(
      0,
      ...rankedHits.map((h: any) => Number(h?._source?.color_confidence_image) || 0),
    );
    const colorCompliantHits = rankedHits.filter(
      (h: any) => (complianceById.get(String(h._source.product_id))?.colorCompliance ?? 0) > 0,
    );
    if (strictColorPost && colorCompliantHits.length > 0) {
      rankedHits = colorCompliantHits;
    } else if (strictColorPost && colorCompliantHits.length === 0 && maxImgConfHits < 0.42) {
      // Weak image color signal — keep ranked list (same as text search)
    }
  }
  const countAfterColorPostfilter = rankedHits.length;

  const maxHydrate = Math.min(
    rankedHits.length,
    Math.max(limit * 10, 150),
  );
  const hitsForHydrate = rankedHits.slice(0, maxHydrate);
  const productIds = hitsForHydrate.map((hit: any) => hit._source.product_id);
  const scoreMap = new Map<string, number>();
  hitsForHydrate.forEach((hit: any) => {
    const sim = knnCosinesimilScoreToCosine01(Number(hit._score));
    scoreMap.set(String(hit._source.product_id), Math.round(sim * 100) / 100);
  });

  // Fetch product data
  let results: ProductResult[] = [];
  if (productIds.length > 0) {
    const products = await getProductsByIdsOrdered(productIds);
    const numericIds = productIds.map((id: string) => parseInt(id, 10));
    const imagesByProduct = await getImagesForProducts(numericIds);

    results = products.map((p: any) => {
      const images: ProductImage[] = imagesByProduct.get(parseInt(p.id, 10)) || [];
      const idStr = String(p.id);
      const similarityScore = scoreMap.get(idStr) ?? 0;
      const compliance = complianceById.get(idStr);
      const styleSim = styleSimById.get(idStr) ?? 0;
      const colorSim = colorSimById.get(idStr) ?? 0;
      const patternSim = patternSimById.get(idStr) ?? 0;
      const taxonomyMatch = taxonomyMatchById.get(idStr) ?? 0;
      const imageCompositeScore = imageCompositeById.get(idStr) ?? 0;
      const imagesOut = images.map((img) => ({
        id: img.id,
        url: img.cdn_url,
        is_primary: img.is_primary,
        p_hash: img.p_hash ?? undefined,
      }));
      return {
        ...p,
        // Never overwrite canonical catalog color with query-time matched color.
        // Keep matched color in `explain.matchedColor` only.
        color: p.color ?? null,
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
        rerankScore: compliance?.rerankScore,
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
              styleSim,
              colorSim,
              patternSim,
              taxonomyMatch,
              imageCompositeScore,
              visual_component: compliance.visualComponent,
              type_component: compliance.typeComponent,
              attr_component: compliance.attrComponent,
              penalty_component: compliance.penaltyComponent,
              colorScore: compliance.colorCompliance,
              matchedColor: compliance.matchedColor ?? undefined,
              colorTier: compliance.colorTier,
              colorCompliance: compliance.colorCompliance,
            styleCompliance: compliance.styleCompliance,
              sleeveCompliance: compliance.sleeveCompliance,
            hasStyleIntent: Boolean(desiredStyleForRelevance),
            hasSleeveIntent: Boolean(desiredSleeveForRelevance),
              audienceCompliance: compliance.audienceCompliance,
              crossFamilyPenalty: compliance.crossFamilyPenalty,
              hasTypeIntent: compliance.hasTypeIntent,
              hasColorIntent: compliance.hasColorIntent,
              typeGateFactor: compliance.typeGateFactor,
              hardBlocked: compliance.hardBlocked,
              desiredProductTypes,
              desiredColors: desiredColorsForRelevance,
            desiredStyle: desiredStyleForRelevance,
            desiredSleeve: desiredSleeveForRelevance,
              colorMode: rerankColorModeForRelevance,
              finalRelevance01: compliance.finalRelevance01,
            }
          : undefined,
        images: imagesOut,
      };
    }) as ProductResult[];
  }
  const countAfterHydration = results.length;

  results = results.filter(
    (p: any) =>
      typeof p.finalRelevance01 === "number" && p.finalRelevance01 >= effectiveFinalAcceptMin,
  ) as ProductResult[];
  results.sort((a: any, b: any) => (b.finalRelevance01 ?? 0) - (a.finalRelevance01 ?? 0));

  const dedupedResults = dedupeImageSearchResults(results as any) as ProductResult[];
  const countAfterDedupe = dedupedResults.length;
  results = dedupedResults.slice(0, limit) as ProductResult[];
  const finalReturnedCount = results.length;

  let related: ProductResult[] = [];
  if (includeRelated && pHash) {
    const excludeIds = results.map((p) => String(p.id));
    related = await findSimilarByPHash(pHash, excludeIds, limit);
    const filteredRel = filterRelatedAgainstMain(results as any, related as any, {
      imageSearch: true,
    });
    related = (filteredRel ?? []) as ProductResult[];
  }

  // If the query image already exists in catalog (exact pHash match), make sure it is not
  // lost due to metadata/rerank gates. This is a strong identity signal.
  if (pHash && /^[0-9a-f]+$/i.test(pHash)) {
    const existing = new Set(results.map((p) => String(p.id)));
    const exactPhashRows = await pg.query(
      `SELECT id
         FROM products
        WHERE p_hash = $1
          AND is_hidden = false
        LIMIT 3`,
      [String(pHash).toLowerCase()],
    );
    const rescueIds = (exactPhashRows.rows ?? [])
      .map((r: any) => String(r.id))
      .filter((id: string) => !existing.has(id));
    if (rescueIds.length > 0) {
      const rescueProducts = await getProductsByIdsOrdered(rescueIds);
      const rescueNumericIds = rescueIds.map((id: string) => parseInt(id, 10)).filter(Number.isFinite);
      const rescueImages = await getImagesForProducts(rescueNumericIds);
      const rescued: ProductResult[] = rescueProducts.map((p: any) => {
        const imgs: ProductImage[] = rescueImages.get(parseInt(p.id, 10)) || [];
        return {
          ...p,
          similarity_score: 1,
          match_type: "exact" as const,
          rerankScore: 999,
          finalRelevance01: 1,
          images: imgs.map((img) => ({
            id: img.id,
            url: img.cdn_url,
            is_primary: img.is_primary,
            p_hash: img.p_hash ?? undefined,
          })),
        };
      }) as ProductResult[];
      results = [...rescued, ...results].slice(0, limit);
    }
  }

  if (searchEvalEnabled()) {
    emitImageSearchEval({
      kind: "image_search",
      eval_id: newSearchEvalId(),
      variant: searchEvalVariant(),
      ts_iso: new Date().toISOString(),
      took_ms: Date.now() - evalT0,
      result_count: results.length,
      hit_ids: results.map((p) => String(p.id)),
      similarity_scores: results.map((p) =>
        typeof p.similarity_score === "number" ? p.similarity_score : 0,
      ),
      final_relevance_scores: results.map((p) =>
        typeof p.finalRelevance01 === "number" ? p.finalRelevance01 : null,
      ),
      soft_category: Boolean(
        useAisleRerank && desiredCatalogTerms && desiredCatalogTerms.size > 0,
      ),
      predicted_aisles: aisleHints ? [...aisleHints] : null,
      similarity_threshold_used: similarityThreshold,
      below_relevance_threshold: belowRelevanceThreshold,
      below_final_relevance_gate: belowFinalRelevanceGate,
    });
  }

  if (breakdownDebug) {
    const hasHardCategoryFilter =
      !softCategory || !desiredCatalogTerms || desiredCatalogTerms.size === 0;
    console.warn("[search-breakdown][image]", {
      query: imageSearchTextQuery ?? null,
      image_knn_field: knnFieldResolved,
      raw_open_search_hits: rawOpenSearchHitCount,
      hits_after_final_accept_min: countAfterFinalAcceptMin,
      hits_after_dedupe: countAfterDedupe,
      hits_after_hydration: countAfterHydration,
      final_returned_count: finalReturnedCount,
      SEARCH_FINAL_ACCEPT_MIN_IMAGE: finalAcceptMin,
      effective_final_accept_min: effectiveFinalAcceptMin,
      relevance_relaxed_for_min_count: relevanceRelaxedForMinCount,
      CLIP_SIMILARITY_THRESHOLD: config.clip.imageSimilarityThreshold,
      category_filter_mode: hasHardCategoryFilter ? "hard" : "soft",
      product_type_filter_mode: "none",
      text_knn_mode: "none",
      recall_window: fetchLimit,
      candidate_k: fetchLimit,
      endpoint_limit: limit,
      limit_per_item: null,
      image_similarity_threshold_used: similarityThreshold,
      threshold_relaxed: thresholdRelaxed,
      relax_floor_used: relaxFloorUsed,
    });
  }

  return {
    results,
    related: related.length > 0 ? related : undefined,
    meta: {
      threshold: similarityThreshold,
      total_results: results.length,
      total_related: related.length,
      below_relevance_threshold: belowRelevanceThreshold,
      threshold_relaxed: thresholdRelaxed,
      final_accept_min: config.search.finalAcceptMinImage,
      final_accept_min_effective: effectiveFinalAcceptMin,
      relevance_relaxed_for_min_count: relevanceRelaxedForMinCount,
      image_min_results_target: imageMinResultsTarget,
      below_final_relevance_gate: belowFinalRelevanceGate,
      relevance_gate_soft: false,
      image_knn_field: knnFieldResolved,
      pipeline_counts: {
        raw_open_search_hits: rawOpenSearchHitCount,
        base_candidates: baseCandidates.length,
        ranked_candidates: rankedHitsCandidates.length,
        threshold_passed_visual: thresholdPassedByVisual.length,
        visual_gated_hits: visualGatedHits.length,
        hits_after_final_accept_min: countAfterFinalAcceptMin,
        hits_after_color_postfilter: countAfterColorPostfilter,
        hits_after_hydration: countAfterHydration,
        hits_after_dedupe: countAfterDedupe,
        final_returned_count: finalReturnedCount,
      },
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
  const hasIsHidden = await productsTableHasIsHiddenColumn();
  const hiddenClause = hasIsHidden ? "AND is_hidden = false" : "";
  const excludeNumeric = excludeIds
    .map((id) => parseInt(id, 10))
    .filter(Number.isFinite);

  const result =
    excludeNumeric.length > 0
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
    const images: ProductImage[] = imagesByProduct.get(p.id) || [];
    const distance = distanceMap.get(p.id) || 64;
    return {
      ...p,
      similarity_score: Math.round((1 - distance / 64) * 100) / 100,
      match_type: "related" as const,
      images: images.map((img) => ({
        id: img.id,
        url: img.cdn_url,
        is_primary: img.is_primary,
        p_hash: img.p_hash ?? undefined,
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
    : await processQueryFast(query);

  // Use the search query (auto-corrected or original based on confidence)
  const effectiveQuery = processed.searchQuery;
  
  // Merge extracted filters with explicit filters (explicit takes precedence)
  const mergedFilters = {
    ...filters,
    gender: filters.gender || processed.entities.gender,
    color: filters.color || processed.entities.colors[0],
    brand: filters.brand || processed.entities.brands[0],
    category: filters.category || processed.entities.categories[0],
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
      const images: ProductImage[] = imagesByProduct.get(parseInt(p.id, 10)) || [];
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
        match_type:
          boostedScore >= config.clip.matchTypeExactMin ? "exact" : "similar",
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
      did_you_mean: processed.corrections.length > 0 && processed.confidence < 0.85
        ? `Did you mean "${processed.searchQuery}"?`
        : undefined,
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
    const images: ProductImage[] = imagesByProduct.get(parseInt(p.id, 10)) || [];
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
// Product detail
// ============================================================================

export async function getProductWithVariants(productId: number): Promise<{
  product: Record<string, unknown>;
  images: ProductImage[];
} | null> {
  const rows = await getProductsByIdsOrdered([productId]);
  if (!rows.length) return null;
  const product = rows[0] as Record<string, unknown>;
  const imagesByProduct = await getImagesForProducts([productId]);
  const images = imagesByProduct.get(productId) ?? [];
  return { product, images };
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
type RankRow = Record<string, number>;

function toRankRow(rec: any, oneHotCats: Record<string, number>): RankRow {
  return {
    style_score: rec.styleScore ?? 0,
    color_score: rec.colorScore ?? 0,
    clip_sim: rec.clipSim ?? 0,
    text_sim: rec.textSim ?? 0,
    opensearch_score: rec.openSearchScore ?? 0,
    candidate_score: rec.candidateScore ?? 0,
    price_ratio: rec.priceRatio ?? 0,
    phash_dist: rec.pHashDist ?? 0,
    ...oneHotCats, // e.g. cat_top__shoes:1
  };
}


/**
 * Unified candidate generator for recommendation/outfit engine
 * 
 * Pulls candidates from multiple sources:
 * 1. CLIP k-NN (visually similar items)
 * 2. Text/hybrid search (same name/material/attributes)
 * 3. Optional pHash deduplication (removes near-identical images)
 * 
 * Returns a consistent list with scores from each source.
 */
export async function getCandidateScoresForProducts(
  params: CandidateGeneratorParams
): Promise<CandidateGeneratorResult> {
  const startTime = Date.now();
  const {
    baseProductId,
    limit = 30,
    clipLimit = 200,
    textLimit = 200,
    usePHashDedup = true,
    pHashThreshold = 5,
  } = params;

  // Input validation
  const numericId = parseInt(baseProductId, 10);
  if (isNaN(numericId) || numericId <= 0) {
    console.warn(`[CandidateGenerator] Invalid baseProductId: ${baseProductId}`);
    return {
      candidates: [],
      meta: {
        baseProductId,
        clipCandidates: 0,
        textCandidates: 0,
        mergedTotal: 0,
        pHashFiltered: 0,
        finalCount: 0,
      },
    };
  }

  // Fetch base product from Postgres
  const prodRes = await pg.query(
    `SELECT id, title, brand, category, image_cdn, p_hash FROM products WHERE id = $1`,
    [numericId]
  );

  if (prodRes.rowCount === 0) {
    console.warn(`[CandidateGenerator] Base product not found: ${baseProductId}`);
    return {
      candidates: [],
      meta: {
        baseProductId,
        clipCandidates: 0,
        textCandidates: 0,
        mergedTotal: 0,
        pHashFiltered: 0,
        finalCount: 0,
      },
    };
  }

  const base = prodRes.rows[0];
  const basePHash: string | null = base.p_hash;

  // Try to get embedding from OpenSearch document
  let embedding: number[] | undefined;
  try {
    const osGet = await osClient.get({ index: config.opensearch.index, id: String(base.id) });
    if (osGet?.body?._source?.embedding && Array.isArray(osGet.body._source.embedding)) {
      embedding = osGet.body._source.embedding;
    }
  } catch {
    // ignore - document may not exist
  }

  // Score maps
  const clipScoreMap = new Map<string, number>();
  const clipRawMap = new Map<string, number>();
  const textScoreMap = new Map<string, number>();
  const textRawMap = new Map<string, number>();

  // Timing tracking
  let clipMs = 0;
  let textMs = 0;

  // -------------------------------------------------------------------------
  // Run CLIP and Text searches in parallel for performance
  // -------------------------------------------------------------------------
  const searchPromises: Promise<void>[] = [];

  // 1) CLIP k-NN search (visually similar)
  if (embedding && embedding.length > 0) {
    const clipPromise = (async () => {
      const clipStart = Date.now();
      const fetchLimit = Math.min(clipLimit, 500);
      const embeddingField =
        String(process.env.SEARCH_IMAGE_KNN_FIELD ?? "embedding").trim() || "embedding";
      const clipBody = {
        size: fetchLimit,
        _source: ["product_id"],
        query: {
          bool: {
            must: {
              knn: {
                [embeddingField]: { vector: embedding, k: fetchLimit },
              },
            },
            filter: [{ term: { is_hidden: false } }],
          },
        },
      };

      try {
        const resp = await osClient.search({ index: config.opensearch.index, body: clipBody });
        const hits = resp.body.hits.hits || [];
        const maxScore = hits.length > 0 ? hits[0]._score : 1;

        for (const hit of hits) {
          const id = String(hit._source.product_id);
          if (id === String(base.id)) continue;
          clipRawMap.set(id, hit._score);
          clipScoreMap.set(id, Math.round(Math.min(1, hit._score / maxScore) * 1000) / 1000);
        }
      } catch (err) {
        console.warn(`[CandidateGenerator] CLIP search failed for ${baseProductId}:`, err);
      }
      clipMs = Date.now() - clipStart;
    })();
    searchPromises.push(clipPromise);
  }

  // 2) Text/hybrid search (same item/name/material)
  if (base.title) {
    const textPromise = (async () => {
      const textStart = Date.now();
      try {
        const parsed = parseQuery(base.title);
        const textQuery = buildSemanticOpenSearchQuery(parsed, undefined, textLimit);
        // Add hidden filter
        if (!textQuery.query.bool) textQuery.query = { bool: { must: textQuery.query } };
        if (!textQuery.query.bool.filter) textQuery.query.bool.filter = [];
        textQuery.query.bool.filter.push({ term: { is_hidden: false } });

        const resp = await osClient.search({ index: config.opensearch.index, body: textQuery });
        const hits = resp.body.hits.hits || [];
        const maxScore = hits.length > 0 ? hits[0]._score : 1;

        for (const hit of hits) {
          const id = String(hit._source.product_id);
          if (id === String(base.id)) continue;
          textRawMap.set(id, hit._score);
          textScoreMap.set(id, Math.round(Math.min(1, hit._score / maxScore) * 1000) / 1000);
        }
      } catch (err) {
        console.warn(`[CandidateGenerator] Text search failed for ${baseProductId}:`, err);
      }
      textMs = Date.now() - textStart;
    })();
    searchPromises.push(textPromise);
  }

  // Wait for both searches to complete
  await Promise.all(searchPromises);

  // -------------------------------------------------------------------------
  // 3) Merge candidate IDs and determine source
  // -------------------------------------------------------------------------
  const clipIds = new Set(clipScoreMap.keys());
  const textIds = new Set(textScoreMap.keys());
  const allIds = new Set([...clipIds, ...textIds]);

  const sourceMap = new Map<string, CandidateSource>();
  for (const id of allIds) {
    const inClip = clipIds.has(id);
    const inText = textIds.has(id);
    if (inClip && inText) sourceMap.set(id, "both");
    else if (inClip) sourceMap.set(id, "clip");
    else sourceMap.set(id, "text");
  }

  const metaClipCount = clipIds.size;
  const metaTextCount = textIds.size;
  const metaMergedTotal = allIds.size;

  // -------------------------------------------------------------------------
  // 4) Rank candidates by combined score FIRST
  // -------------------------------------------------------------------------
  const rankedIds = Array.from(allIds)
    .map((id) => ({
      id,
      score: (clipScoreMap.get(id) ?? 0) * 0.6 + (textScoreMap.get(id) ?? 0) * 0.4,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(limit * 3, 150)) // Take extra buffer for pHash filtering
    .map((x) => x.id);

  // -------------------------------------------------------------------------
  // 5) pHash deduplication on TOP candidates only
  // -------------------------------------------------------------------------
  const pHashStart = Date.now();
  let pHashDistMap = new Map<string, number>();
  let filteredIds = rankedIds;
  let pHashFiltered = 0;

  if (rankedIds.length > 0 && basePHash) {
    // Fetch pHash for top candidates only (much smaller set)
    const candidateNumericIds = rankedIds.map((id) => parseInt(id, 10));
    try {
      const pHashRes = await pg.query(
        `SELECT id, p_hash FROM products WHERE id = ANY($1) AND p_hash IS NOT NULL`,
        [candidateNumericIds]
      );

      for (const row of pHashRes.rows) {
        const dist = hammingDistance(basePHash, row.p_hash);
        pHashDistMap.set(String(row.id), dist);
      }

      // Filter out near-duplicates if enabled
      if (usePHashDedup) {
        const beforeCount = filteredIds.length;
        filteredIds = filteredIds.filter((id) => {
          const dist = pHashDistMap.get(id);
          // Keep if no pHash or distance > threshold (not a duplicate)
          return dist === undefined || dist > pHashThreshold;
        });
        pHashFiltered = beforeCount - filteredIds.length;
      }
    } catch (err) {
      console.warn(`[CandidateGenerator] pHash lookup failed:`, err);
    }
  }
  const pHashMs = Date.now() - pHashStart;

  // -------------------------------------------------------------------------
  // 6) Fetch product data and build results
  // -------------------------------------------------------------------------
  const finalIds = filteredIds.slice(0, Math.max(limit * 2, 100));

  if (finalIds.length === 0) {
    return {
      candidates: [],
      meta: {
        baseProductId,
        clipCandidates: metaClipCount,
        textCandidates: metaTextCount,
        mergedTotal: metaMergedTotal,
        pHashFiltered,
        finalCount: 0,
      },
    };
  }

  const products = await getProductsByIdsOrdered(finalIds);
  const numericIds = finalIds.map((id) => parseInt(id, 10));
  const imagesByProduct = await getImagesForProducts(numericIds);

  // Build candidate results
  const candidates: CandidateResult[] = products.map((p: any) => {
    const id = String(p.id);
    const images: ProductImage[] = imagesByProduct.get(parseInt(p.id, 10)) || [];

    const clipSim = clipScoreMap.get(id) ?? 0;
    const textSim = textScoreMap.get(id) ?? 0;
    const opensearchScore = textRawMap.get(id) ?? 0;
    const pHashDist = pHashDistMap.get(id);
    const source = sourceMap.get(id) ?? "text";

    const product: ProductResult = {
      ...p,
      images: images.map((img) => ({ id: img.id, url: img.cdn_url, is_primary: img.is_primary })),
      clipSim,
      textSim,
      openSearchScore: opensearchScore,
      pHashDist,
      match_type: source === "both" ? "exact" : "similar",
    };

    return {
      candidateId: id,
      clipSim,
      textSim,
      opensearchScore,
      pHashDist,
      source,
      product,
    };
  });

  // Sort: both > clip > text, then by combined score
  candidates.sort((a, b) => {
    const sourceOrder = { both: 0, clip: 1, text: 2 };
    const srcDiff = sourceOrder[a.source] - sourceOrder[b.source];
    if (srcDiff !== 0) return srcDiff;
    const scoreA = a.clipSim * 0.6 + a.textSim * 0.4;
    const scoreB = b.clipSim * 0.6 + b.textSim * 0.4;
    return scoreB - scoreA;
  });

  const finalCandidates = candidates.slice(0, limit);
  const totalMs = Date.now() - startTime;

  // Log performance metrics in non-production or if slow
  if (process.env.NODE_ENV !== "production" || totalMs > 1000) {
    console.log(
      `[CandidateGenerator] baseProductId=${baseProductId} ` +
      `clip=${metaClipCount} text=${metaTextCount} merged=${metaMergedTotal} ` +
      `pHashFiltered=${pHashFiltered} final=${finalCandidates.length} ` +
      `timings: clip=${clipMs}ms text=${textMs}ms pHash=${pHashMs}ms total=${totalMs}ms`
    );
  }

  return {
    candidates: finalCandidates,
    meta: {
      baseProductId,
      clipCandidates: metaClipCount,
      textCandidates: metaTextCount,
      mergedTotal: metaMergedTotal,
      pHashFiltered,
      finalCount: finalCandidates.length,
      timings: {
        clipMs,
        textMs,
        pHashMs,
        totalMs,
      },
    },
  };
}
