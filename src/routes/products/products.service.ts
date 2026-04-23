import { osClient } from "../../lib/core/index";
import {
  pg,
  getProductsByIdsOrdered,
  productsTableHasIsHiddenColumn,
} from "../../lib/core/index";
import { config } from "../../config";
import { getImagesForProducts, ProductImage } from "./images.service";
import { hammingDistance } from "../../lib/products";
import { learnUserLifestyle } from "../../lib/wardrobe/lifestyleAdapter";
import { getSession } from "../../lib/queryProcessor/conversationalContext";
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
import { tieredColorListCompliance, tieredColorMatchScore } from "../../lib/color/colorCanonical";
import {
  computeHitRelevance,
  normalizeQueryGender,
  type HitCompliance,
  type SearchHitRelevanceIntent,
} from "../../lib/search/searchHitRelevance";
import { merchandiseVisualSimilarity01 } from "../../lib/search/merchandiseVisualSimilarity";
import {
  extractFashionTypeNounTokens,
  extractLexicalProductTypeSeeds,
  scoreRerankProductTypeBreakdown,
} from "../../lib/search/productTypeTaxonomy";
import { attrGenderFilterClause } from "./opensearchFilters";
import type { SearchResultWithRelated } from "./types";
import { findRelatedProducts } from "../../lib/search/relatedProducts";
import { createHash } from "crypto";

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
  /** Length intent (mini | midi | maxi | long) for ranking. */
  length?: string;
  gender?: string;
  pattern?: string;
  /** Dominant colors extracted from garment crop via k-means pixel analysis.
   *  Used for soft color compliance ranking — not hard OS filtering. */
  cropDominantColors?: string[];
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
  /** YOLO detection confidence for this item (0-1); used to relax type floor for high-confidence bottoms. */
  detectionYoloConfidence?: number;
  /** Product category from detection (e.g. 'tops', 'bottoms'); enables category-specific type flooring. */
  detectionProductCategory?: string;
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
  /**
   * BLIP / caption-derived product-type tokens: affect taxonomy scoring only.
   * Must not be treated as explicit user filters (would enable strict type gates).
   */
  softProductTypeHints?: string[];
  /** Structured BLIP signal used for rerank alignment (no hard filtering semantics). */
  blipSignal?: {
    productType?: string | null;
    gender?: string;
    ageGroup?: string;
    primaryColor?: string | null;
    secondaryColor?: string | null;
    style?: string | null;
    material?: string | null;
    occasion?: string | null;
    confidence?: number;
  };
  /**
   * Caption / vision-inferred colors (e.g. from full-image BLIP). Merged into soft color
   * intent with crop k-means so tier compliance can reflect "blue top" vs catalog white.
   */
  inferredPrimaryColor?: string | null;
  /** Per-slot caption colors (topColor, jeansColor, garmentColor, …). */
  inferredColorsByItem?: Record<string, string | null>;
  /** Confidence for each inferred item color (same keys as inferredColorsByItem). */
  inferredColorsByItemConfidence?: Record<string, number>;
  /** Preferred item color key for the current detection, if the caller has one. */
  inferredColorKey?: string | null;
  /** Debug path: bypass rerank/final gates and return top-k raw exact-cosine hits. */
  debugRawCosineFirst?: boolean;
  /** Optional session context used to inherit conversational filters. */
  sessionId?: string;
  /** Optional authenticated user used for wardrobe-driven personalization. */
  userId?: number;
  /** Optional precomputed session filters to merge into image search. */
  sessionFilters?: Record<string, unknown> | null;
  /** When true, merge same variant family into one representative result. */
  collapseVariantGroups?: boolean;
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
  parent_product_url?: string | null;
  variant_group_key?: string | null;
  variant_group_size?: number;
  variant_group_ids?: string[];
  interaction_count?: number;
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

function forceStrictInferredTypeIntentEnv(): boolean {
  const v = String(process.env.SEARCH_IMAGE_FORCE_STRICT_INFERRED_TYPE_INTENT ?? "").toLowerCase();
  return v === "1" || v === "true";
}

/**
 * When on (default), image search `similarity_score` and the visual gate use **catalog-bound**
 * similarity (CLIP cosine × type/category alignment), not raw embedding cosine alone.
 * Set `SEARCH_IMAGE_MERCHANDISE_SIMILARITY=0` to restore legacy raw-cosine behavior.
 */
function imageMerchandiseSimilarityBindingEnabled(): boolean {
  const v = String(process.env.SEARCH_IMAGE_MERCHANDISE_SIMILARITY ?? "1").toLowerCase();
  return v !== "0" && v !== "false";
}

/** Phase 8: deep visual+text fusion in final image ranking. Default ON. */
function imageDeepFusionEnabled(): boolean {
  const v = String(process.env.SEARCH_IMAGE_DEEP_FUSION ?? "1").toLowerCase();
  return v !== "0" && v !== "false";
}

/** Phase 8: blend weight for deep fusion score (0..0.4). */
function imageDeepFusionWeight(): number {
  const raw = Number(process.env.SEARCH_IMAGE_DEEP_FUSION_WEIGHT ?? "0.16");
  if (!Number.isFinite(raw)) return 0.16;
  return Math.max(0, Math.min(0.4, raw));
}

/** Phase 9: apply MMR-style diversity reranking after relevance sort + dedupe. Default ON. */
function imageDiversityRerankEnabled(): boolean {
  const v = String(process.env.SEARCH_IMAGE_DIVERSITY_RERANK ?? "1").toLowerCase();
  return v !== "0" && v !== "false";
}

/** Phase 9: lambda in MMR (higher = more relevance, lower = more diversity). */
function imageDiversityLambda(): number {
  const raw = Number(process.env.SEARCH_IMAGE_DIVERSITY_LAMBDA ?? "0.82");
  if (!Number.isFinite(raw)) return 0.82;
  return Math.max(0.5, Math.min(0.98, raw));
}

/** Phase 9: cap candidate pool used for diversity reranking (latency guard). */
function imageDiversityPoolCap(): number {
  const raw = Number(process.env.SEARCH_IMAGE_DIVERSITY_POOL_CAP ?? "120");
  if (!Number.isFinite(raw)) return 120;
  return Math.max(20, Math.min(300, Math.floor(raw)));
}

type ImageSearchContext = {
  userId?: number;
  sessionId?: string;
  sessionFilters?: Record<string, unknown> | null;
  collapseVariantGroups?: boolean;
};

type UserLifestyleSnapshot = Awaited<ReturnType<typeof learnUserLifestyle>>;

const userLifestyleCache = new Map<number, Promise<UserLifestyleSnapshot | null>>();

type ImageQuerySignals = {
  colorQueryEmbedding: number[] | null;
  textureQueryEmbedding: number[] | null;
  materialQueryEmbedding: number[] | null;
  styleQueryEmbedding: number[] | null;
  patternQueryEmbedding: number[] | null;
  partQueryEmbeddings: Record<string, number[] | null>;
};

const imageQuerySignalCache = new Map<
  string,
  { createdAt: number; promise: Promise<ImageQuerySignals> }
>();
const IMAGE_QUERY_SIGNAL_CACHE_TTL_MS = 10 * 60 * 1000;
const IMAGE_QUERY_SIGNAL_CACHE_MAX = 240;

function imageQuerySignalCacheKey(buffer: Buffer): string {
  const digest = createHash("sha1").update(buffer).digest("hex");
  return `${buffer.length}:${digest}`;
}

function pruneImageQuerySignalCache(now: number): void {
  for (const [key, entry] of imageQuerySignalCache.entries()) {
    if (now - entry.createdAt > IMAGE_QUERY_SIGNAL_CACHE_TTL_MS) {
      imageQuerySignalCache.delete(key);
    }
  }
  if (imageQuerySignalCache.size <= IMAGE_QUERY_SIGNAL_CACHE_MAX) return;
  const overflow = imageQuerySignalCache.size - IMAGE_QUERY_SIGNAL_CACHE_MAX;
  let dropped = 0;
  for (const key of imageQuerySignalCache.keys()) {
    imageQuerySignalCache.delete(key);
    dropped += 1;
    if (dropped >= overflow) break;
  }
}

async function computeImageQuerySignals(imageBuffer: Buffer): Promise<ImageQuerySignals> {
  let colorQueryEmbedding: number[] | null = null;
  let textureQueryEmbedding: number[] | null = null;
  let materialQueryEmbedding: number[] | null = null;
  let styleQueryEmbedding: number[] | null = null;
  let patternQueryEmbedding: number[] | null = null;
  let partQueryEmbeddings: Record<string, number[] | null> = {};

  try {
    const { attributeEmbeddings } = await import("../../lib/search/attributeEmbeddings");
    const [cEmb, tEmb, mEmb, sEmb, pEmb] = await Promise.all([
      attributeEmbeddings
        .generateImageAttributeEmbedding(imageBuffer, "color")
        .catch((error) => {
          console.warn("[image-search] color attribute embedding failed", {
            message: error instanceof Error ? error.message : String(error),
          });
          return [] as number[];
        }),
      attributeEmbeddings
        .generateImageAttributeEmbedding(imageBuffer, "texture")
        .catch((error) => {
          console.warn("[image-search] texture attribute embedding failed", {
            message: error instanceof Error ? error.message : String(error),
          });
          return [] as number[];
        }),
      attributeEmbeddings
        .generateImageAttributeEmbedding(imageBuffer, "material")
        .catch((error) => {
          console.warn("[image-search] material attribute embedding failed", {
            message: error instanceof Error ? error.message : String(error),
          });
          return [] as number[];
        }),
      attributeEmbeddings
        .generateImageAttributeEmbedding(imageBuffer, "style")
        .catch((error) => {
          console.warn("[image-search] style attribute embedding failed", {
            message: error instanceof Error ? error.message : String(error),
          });
          return [] as number[];
        }),
      attributeEmbeddings
        .generateImageAttributeEmbedding(imageBuffer, "pattern")
        .catch((error) => {
          console.warn("[image-search] pattern attribute embedding failed", {
            message: error instanceof Error ? error.message : String(error),
          });
          return [] as number[];
        }),
    ]);
    colorQueryEmbedding = cEmb.length > 0 ? cEmb : null;
    textureQueryEmbedding = tEmb.length > 0 ? tEmb : null;
    materialQueryEmbedding = mEmb.length > 0 ? mEmb : null;
    styleQueryEmbedding = sEmb.length > 0 ? sEmb : null;
    patternQueryEmbedding = pEmb.length > 0 ? pEmb : null;
  } catch (error) {
    console.warn("[image-search] attribute embedding pipeline failed", {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const { computeAndGenerateQueryPartEmbeddings } = await import("../../lib/image/processor");
    partQueryEmbeddings = await computeAndGenerateQueryPartEmbeddings(imageBuffer).catch(
      (error) => {
        console.warn("[image-search] part embeddings generation failed", {
          message: error instanceof Error ? error.message : String(error),
        });
        return {};
      },
    );
  } catch (error) {
    console.warn("[image-search] part embedding import failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    partQueryEmbeddings = {};
  }

  return {
    colorQueryEmbedding,
    textureQueryEmbedding,
    materialQueryEmbedding,
    styleQueryEmbedding,
    patternQueryEmbedding,
    partQueryEmbeddings,
  };
}

async function getCachedImageQuerySignals(imageBuffer: Buffer): Promise<ImageQuerySignals> {
  const now = Date.now();
  pruneImageQuerySignalCache(now);
  const key = imageQuerySignalCacheKey(imageBuffer);
  const existing = imageQuerySignalCache.get(key);
  if (existing && now - existing.createdAt <= IMAGE_QUERY_SIGNAL_CACHE_TTL_MS) {
    return existing.promise;
  }
  const promise = computeImageQuerySignals(imageBuffer);
  imageQuerySignalCache.set(key, { createdAt: now, promise });
  try {
    return await promise;
  } catch (error) {
    imageQuerySignalCache.delete(key);
    throw error;
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizeStringValue(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeStringValue(item)).filter(Boolean);
}

function mergeSessionFilters(
  base: SearchFilters,
  sessionFilters?: Record<string, unknown> | null,
): SearchFilters {
  if (!sessionFilters) return { ...base };
  const merged: SearchFilters = { ...base };
  const assignIfMissing = <K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) => {
    if (merged[key] === undefined || merged[key] === null || merged[key] === "") {
      merged[key] = value;
    }
  };

  const category = sessionFilters.category;
  if (category !== undefined) {
    assignIfMissing(
      "category",
      Array.isArray(category) ? (category as string[]).map((c) => String(c)) : String(category),
    );
  }

  const brand = sessionFilters.brand;
  if (brand !== undefined) assignIfMissing("brand", String(brand));

  const color = sessionFilters.color;
  if (color !== undefined) assignIfMissing("color", normalizeStringValue(color));

  const material = sessionFilters.material;
  if (material !== undefined) assignIfMissing("material", normalizeStringValue(material));

  const fit = sessionFilters.fit;
  if (fit !== undefined) assignIfMissing("fit", normalizeStringValue(fit));

  const style = sessionFilters.style;
  if (style !== undefined) assignIfMissing("style", normalizeStringValue(style));

  const gender = sessionFilters.gender;
  if (gender !== undefined) assignIfMissing("gender", normalizeStringValue(gender));

  const pattern = sessionFilters.pattern;
  if (pattern !== undefined) assignIfMissing("pattern", normalizeStringValue(pattern));

  const ageGroup = sessionFilters.ageGroup;
  if (ageGroup !== undefined) assignIfMissing("ageGroup", normalizeStringValue(ageGroup));

  const priceRange = sessionFilters.priceRange as { min?: number; max?: number } | undefined;
  if (priceRange) {
    if (merged.minPriceCents === undefined && Number.isFinite(Number(priceRange.min))) {
      merged.minPriceCents = Math.max(0, Math.floor(Number(priceRange.min)));
    }
    if (merged.maxPriceCents === undefined && Number.isFinite(Number(priceRange.max))) {
      merged.maxPriceCents = Math.max(0, Math.floor(Number(priceRange.max)));
    }
  }

  return merged;
}

async function loadUserLifestyleSnapshot(userId?: number): Promise<UserLifestyleSnapshot | null> {
  if (!userId || !Number.isFinite(userId) || userId < 1) return null;
  const existing = userLifestyleCache.get(userId);
  if (existing) return existing;
  const pending = learnUserLifestyle(userId).catch((error) => {
    console.warn("[image-search] failed to load user lifestyle:", error);
    return null;
  });
  userLifestyleCache.set(userId, pending);
  return pending;
}

function stringMatchesAny(haystack: string, needles: string[]): boolean {
  if (!haystack || needles.length === 0) return false;
  return needles.some((needle) => needle && haystack.includes(needle));
}

function priceSimilarity01(priceCents: number, min?: number, max?: number): number {
  if (!Number.isFinite(priceCents) || priceCents <= 0) return 0;
  const lo = Number.isFinite(Number(min)) ? Number(min) : undefined;
  const hi = Number.isFinite(Number(max)) ? Number(max) : undefined;
  if (lo !== undefined && hi !== undefined && lo <= hi) {
    if (priceCents >= lo && priceCents <= hi) return 1;
    const anchor = priceCents < lo ? lo : hi;
    return clamp01(1 - Math.abs(priceCents - anchor) / Math.max(anchor, priceCents, 1));
  }
  if (lo !== undefined) {
    return clamp01(1 - Math.abs(priceCents - lo) / Math.max(lo, priceCents, 1));
  }
  if (hi !== undefined) {
    return clamp01(1 - Math.abs(priceCents - hi) / Math.max(hi, priceCents, 1));
  }
  return 0;
}

function scoreImageSearchContext01(params: {
  product: ProductResult;
  sessionFilters?: SearchFilters;
  lifestyle?: UserLifestyleSnapshot | null;
}): number {
  const { product, sessionFilters, lifestyle } = params;
  const title = normalizeStringValue(product.title);
  const brand = normalizeStringValue(product.brand);
  const category = normalizeStringValue(product.category);
  const color = normalizeStringValue(product.color);
  const description = normalizeStringValue(product.description);

  let score = 0.35;

  if (product.availability) score += 0.08;
  if (typeof product.interaction_count === "number" && product.interaction_count > 0) {
    score += Math.min(0.08, Math.log1p(product.interaction_count) / 50);
  }
  if (
    typeof product.sales_price_cents === "number" &&
    product.sales_price_cents > 0 &&
    product.sales_price_cents < product.price_cents
  ) {
    score += 0.04;
  }

  if (sessionFilters) {
    if (sessionFilters.brand && brand && normalizeStringValue(sessionFilters.brand) === brand) score += 0.16;
    if (sessionFilters.category) {
      const categories = Array.isArray(sessionFilters.category)
        ? normalizeStringArray(sessionFilters.category)
        : [normalizeStringValue(sessionFilters.category)];
      if (categories.some((cat) => cat && category.includes(cat))) score += 0.14;
    }
    if (sessionFilters.color && color && normalizeStringValue(sessionFilters.color) === color) score += 0.08;
    if (sessionFilters.material && description && normalizeStringValue(sessionFilters.material) && description.includes(normalizeStringValue(sessionFilters.material))) score += 0.05;
    if (sessionFilters.gender && description && normalizeStringValue(sessionFilters.gender) && description.includes(normalizeStringValue(sessionFilters.gender))) score += 0.03;
    if (sessionFilters.style && description && normalizeStringValue(sessionFilters.style) && description.includes(normalizeStringValue(sessionFilters.style))) score += 0.05;
    if (sessionFilters.minPriceCents !== undefined || sessionFilters.maxPriceCents !== undefined) {
      score += 0.08 * priceSimilarity01(product.price_cents, sessionFilters.minPriceCents, sessionFilters.maxPriceCents);
    }
  }

  if (lifestyle) {
    if (lifestyle.preferredBrands.some((preferred) => preferred && normalizeStringValue(preferred) === brand)) {
      score += 0.16;
    }
    if (lifestyle.preferredCategories.some((preferred) => preferred && category.includes(normalizeStringValue(preferred)))) {
      score += 0.12;
    }
    if (lifestyle.styleProfile?.colorPreferences?.some((preferred) => preferred && normalizeStringValue(preferred) === color)) {
      score += 0.08;
    }
    if (lifestyle.styleProfile?.dominantStyle) {
      const dominantStyle = normalizeStringValue(lifestyle.styleProfile.dominantStyle);
      if (dominantStyle && (title.includes(dominantStyle) || description.includes(dominantStyle))) score += 0.04;
    }
    if (lifestyle.styleProfile?.aestheticTags?.length) {
      const matchedTag = lifestyle.styleProfile.aestheticTags.some((tag) => {
        const norm = normalizeStringValue(tag);
        return norm && (title.includes(norm) || description.includes(norm));
      });
      if (matchedTag) score += 0.03;
    }
    if (lifestyle.priceRange) {
      score += 0.08 * priceSimilarity01(product.price_cents, lifestyle.priceRange.p25, lifestyle.priceRange.p75);
    }
  }

  return clamp01(score);
}

function getVariantGroupKey(product: ProductResult): string | null {
  const parent = normalizeStringValue((product as any).parent_product_url);
  const vendor = normalizeStringValue(product.vendor_id);
  if (!parent && !vendor) return null;
  const parentKey = parent || `__single_${product.id}`;
  const vendorKey = vendor || "__vendor";
  return `${parentKey}|${vendorKey}`;
}

function collapseVariantGroups(results: ProductResult[]): {
  results: ProductResult[];
  groupCount: number;
  representativeCount: number;
} {
  if (results.length <= 1) {
    return { results, groupCount: 0, representativeCount: results.length };
  }

  const groups = new Map<string, ProductResult[]>();
  const passthrough: ProductResult[] = [];

  for (const product of results) {
    const key = getVariantGroupKey(product);
    if (!key || key.startsWith("__single_")) {
      passthrough.push(product);
      continue;
    }
    const list = groups.get(key);
    if (list) list.push(product);
    else groups.set(key, [product]);
  }

  const representatives: ProductResult[] = [];
  let groupCount = 0;
  for (const [key, group] of groups.entries()) {
    if (group.length === 0) continue;
    groupCount += 1;
    const sortedGroup = [...group].sort((a, b) => {
      const fa = Number(a.finalRelevance01 ?? 0);
      const fb = Number(b.finalRelevance01 ?? 0);
      if (Math.abs(fb - fa) > 1e-6) return fb - fa;
      const sa = Number(a.similarity_score ?? 0);
      const sb = Number(b.similarity_score ?? 0);
      if (Math.abs(sb - sa) > 1e-6) return sb - sa;
      return Number(b.rerankScore ?? 0) - Number(a.rerankScore ?? 0);
    });
    const representative = { ...sortedGroup[0] } as ProductResult;
    representative.variant_group_key = key;
    representative.variant_group_size = group.length;
    representative.variant_group_ids = group.map((item) => String(item.id));
    representatives.push(representative);
  }

  return {
    results: [...passthrough, ...representatives],
    groupCount,
    representativeCount: passthrough.length + representatives.length,
  };
}

function textTokenSet(raw: string | null | undefined): Set<string> {
  const out = new Set<string>();
  const s = String(raw ?? "").toLowerCase();
  for (const t of s.split(/[^a-z0-9]+/g)) {
    if (t.length >= 3) out.add(t);
  }
  return out;
}

function tokenOverlap01(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / Math.max(1, Math.min(a.size, b.size));
}

function deepFusionTextAlignment01(params: {
  hit: any;
  queryText: string;
  desiredProductTypes: string[];
  desiredStyles: string[];
  desiredColors: string[];
  blipSignal?: {
    productType?: string | null;
    style?: string | null;
    material?: string | null;
    confidence?: number;
  };
}): number {
  const { hit, queryText, desiredProductTypes, desiredStyles, desiredColors, blipSignal } = params;
  const src = hit?._source ?? {};
  const docBlob = [
    src.title,
    src.category,
    src.category_canonical,
    ...(Array.isArray(src.product_types) ? src.product_types : []),
    src.attr_style,
    src.attr_material,
    src.attr_color,
    ...(Array.isArray(src.attr_colors) ? src.attr_colors : []),
  ]
    .map((x: unknown) => String(x ?? ""))
    .join(" ");

  const docTokens = textTokenSet(docBlob);
  const queryTokens = textTokenSet(queryText);
  const queryOverlap = tokenOverlap01(queryTokens, docTokens);

  const intentTokens = textTokenSet(
    [
      ...desiredProductTypes,
      ...desiredStyles,
      ...desiredColors,
      blipSignal?.productType ?? "",
      blipSignal?.style ?? "",
      blipSignal?.material ?? "",
    ].join(" "),
  );
  const intentOverlap = tokenOverlap01(intentTokens, docTokens);

  const blipConf = Number(blipSignal?.confidence ?? 0);
  const blipWeight = Math.max(0, Math.min(1, blipConf));

  return Math.max(0, Math.min(1, queryOverlap * 0.55 + intentOverlap * (0.35 + 0.1 * blipWeight)));
}

function itemDiversitySimilarity01(a: ProductResult, b: ProductResult): number {
  const aa = a as any;
  const bb = b as any;
  const sameCategory = String(aa.category ?? "").toLowerCase() === String(bb.category ?? "").toLowerCase() ? 0.34 : 0;
  const sameBrand = String(aa.brand ?? "").toLowerCase() !== "" && String(aa.brand ?? "").toLowerCase() === String(bb.brand ?? "").toLowerCase() ? 0.22 : 0;
  const sameColor = String(aa.color ?? "").toLowerCase() !== "" && String(aa.color ?? "").toLowerCase() === String(bb.color ?? "").toLowerCase() ? 0.2 : 0;
  const sameStyle = String(aa.attr_style ?? aa.style ?? "").toLowerCase() !== "" && String(aa.attr_style ?? aa.style ?? "").toLowerCase() === String(bb.attr_style ?? bb.style ?? "").toLowerCase() ? 0.14 : 0;
  const pa = Number(aa.price_cents ?? 0);
  const pb = Number(bb.price_cents ?? 0);
  const priceSim = pa > 0 && pb > 0
    ? Math.max(0, 1 - Math.abs(pa - pb) / Math.max(pa, pb)) * 0.1
    : 0;
  return Math.max(0, Math.min(1, sameCategory + sameBrand + sameColor + sameStyle + priceSim));
}

function applyImageDiversityRerank(results: ProductResult[], lambda: number): ProductResult[] {
  if (results.length <= 2) return results;
  const selected: ProductResult[] = [];
  const remaining = [...results];
  selected.push(remaining.shift() as ProductResult);

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestMmr = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      const rel = Number((cand as any).finalRelevance01 ?? cand.similarity_score ?? 0);
      let maxSim = 0;
      for (const s of selected) {
        maxSim = Math.max(maxSim, itemDiversitySimilarity01(cand, s));
      }
      const mmr = lambda * rel - (1 - lambda) * maxSim;
      if (mmr > bestMmr) {
        bestMmr = mmr;
        bestIdx = i;
      }
    }
    selected.push(remaining.splice(bestIdx, 1)[0]);
  }
  return selected;
}

/**
 * How many kNN neighbors to retrieve and run through relevance/merchandise binding.
 * With catalog-bound similarity, strong matches can sit below mediocre raw-CLIP neighbors; a wider
 * pool improves recall before the final resort (capped for latency). Legacy path stays at 500 max.
 */
function imageSearchKnnPoolLimit(): number {
  const envK = Number(process.env.SEARCH_IMAGE_RETRIEVAL_K);
  const baseFromEnv =
    Number.isFinite(envK) && envK >= 200 ? Math.floor(envK) : 500;

  if (!imageMerchandiseSimilarityBindingEnabled()) {
    return Math.min(500, Math.max(200, baseFromEnv));
  }

  const merchCapEnv = Number(process.env.SEARCH_IMAGE_MERCH_CANDIDATE_CAP);
  const hardCap = 1200;
  const defaultMerch = Math.min(hardCap, Math.max(700, baseFromEnv));
  const cap =
    Number.isFinite(merchCapEnv) && merchCapEnv >= 200
      ? Math.min(hardCap, Math.floor(merchCapEnv))
      : defaultMerch;
  return Math.max(200, cap);
}

function isDressLikeDetectionCategory(category?: string): boolean {
  const c = String(category ?? "").toLowerCase().trim();
  if (!c) return false;
  return c === "dresses" || c === "dress" || c === "gowns" || c === "gown";
}

function isTopLikeDetectionCategory(category?: string): boolean {
  const c = String(category ?? "").toLowerCase().trim();
  if (!c) return false;
  return c === "tops" || c === "top";
}

function isBottomLikeDetectionCategory(category?: string): boolean {
  const c = String(category ?? "").toLowerCase().trim();
  if (!c) return false;
  return c === "bottoms" || c === "bottom";
}

function imageCategoryAwareKnnPoolLimit(detectionProductCategory?: string): number {
  const base = imageSearchKnnPoolLimit();
  const category = String(detectionProductCategory ?? "").toLowerCase().trim();

  if (isTopLikeDetectionCategory(category)) {
    const topsCapEnv = Number(process.env.SEARCH_IMAGE_TOPS_MERCH_CANDIDATE_CAP);
    const widenedDefault = Math.min(1400, Math.max(base, Math.floor(base * 1.2)));
    if (Number.isFinite(topsCapEnv) && topsCapEnv >= 200) {
      return Math.max(200, Math.min(1400, Math.floor(topsCapEnv)));
    }
    return widenedDefault;
  }

  if (isBottomLikeDetectionCategory(category)) {
    const bottomsCapEnv = Number(process.env.SEARCH_IMAGE_BOTTOMS_MERCH_CANDIDATE_CAP);
    const widenedDefault = Math.min(1400, Math.max(base, Math.floor(base * 1.2)));
    if (Number.isFinite(bottomsCapEnv) && bottomsCapEnv >= 200) {
      return Math.max(200, Math.min(1400, Math.floor(bottomsCapEnv)));
    }
    return widenedDefault;
  }

  if (category === "footwear" || category === "bags" || category === "accessories") {
    const widenedDefault = Math.min(1300, Math.max(base, Math.floor(base * 1.15)));
    return widenedDefault;
  }

  if (!isDressLikeDetectionCategory(detectionProductCategory)) return base;

  // One-piece garments need a wider recall pool because strict type/length/color gates
  // can remove many candidates before final ranking.
  const dressCapEnv = Number(process.env.SEARCH_IMAGE_DRESS_MERCH_CANDIDATE_CAP);
  const widenedDefault = Math.min(1600, Math.max(base, Math.floor(base * 1.35)));
  if (Number.isFinite(dressCapEnv) && dressCapEnv >= 200) {
    return Math.max(200, Math.min(1600, Math.floor(dressCapEnv)));
  }
  return widenedDefault;
}

/**
 * Detection-scoped rerank candidate cap.
 * Keeps per-call latency bounded for Shop-the-Look without changing final output size.
 */
function imageDetectionRerankCandidateCap(): number {
  // Detection search needs a wider rerank pool to avoid early recall collapse
  // for tops/footwear/bags where true matches are often not in the first ANN slice.
  const raw = Number(process.env.SEARCH_IMAGE_DETECTION_RERANK_CANDIDATE_CAP ?? "320");
  if (!Number.isFinite(raw)) return 320;
  return Math.max(140, Math.min(700, Math.floor(raw)));
}

/**
 * Detection-scoped kNN retrieval cap. This bounds OpenSearch latency for per-detection
 * calls while keeping a broader default pool for non-detection image searches.
 */
function imageDetectionKnnPoolCap(): number {
  // Raise default detection kNN pool to improve first-stage recall.
  // Keep bounded to avoid unbounded latency growth.
  const raw = Number(process.env.SEARCH_IMAGE_DETECTION_KNN_POOL_CAP ?? "560");
  if (!Number.isFinite(raw)) return 560;
  return Math.max(200, Math.min(900, Math.floor(raw)));
}

function imageCategoryAwareMinResultsPolicy(params: {
  detectionProductCategory?: string;
  baseTarget: number;
  baseDelta: number;
  baseMinFraction: number;
}): {
  target: number;
  delta: number;
  minFraction: number;
} {
  const { detectionProductCategory, baseTarget, baseDelta, baseMinFraction } = params;
  if (isTopLikeDetectionCategory(detectionProductCategory)) {
    const targetEnv = Number(process.env.SEARCH_IMAGE_TOPS_MIN_RESULTS);
    const deltaEnv = Number(process.env.SEARCH_IMAGE_TOPS_RELEVANCE_RELAX_DELTA);
    const minFractionEnv = Number(process.env.SEARCH_IMAGE_TOPS_RELEVANCE_RELAX_MIN_FRACTION);

    const target = Number.isFinite(targetEnv)
      ? Math.max(0, Math.min(80, Math.floor(targetEnv)))
      : Math.max(baseTarget, 8);
    const delta = Number.isFinite(deltaEnv)
      ? Math.max(0.02, Math.min(0.12, deltaEnv))
      : Math.min(Math.max(baseDelta, 0.03), 0.05);
    const minFraction = Number.isFinite(minFractionEnv)
      ? Math.max(0.74, Math.min(0.97, minFractionEnv))
      : Math.max(baseMinFraction, 0.88);

    return { target, delta, minFraction };
  }

  if (isBottomLikeDetectionCategory(detectionProductCategory)) {
    const targetEnv = Number(process.env.SEARCH_IMAGE_BOTTOMS_MIN_RESULTS);
    const deltaEnv = Number(process.env.SEARCH_IMAGE_BOTTOMS_RELEVANCE_RELAX_DELTA);
    const minFractionEnv = Number(process.env.SEARCH_IMAGE_BOTTOMS_RELEVANCE_RELAX_MIN_FRACTION);

    const target = Number.isFinite(targetEnv)
      ? Math.max(0, Math.min(80, Math.floor(targetEnv)))
      : Math.max(baseTarget, 8);
    const delta = Number.isFinite(deltaEnv)
      ? Math.max(0.02, Math.min(0.12, deltaEnv))
      : Math.min(Math.max(baseDelta, 0.03), 0.05);
    const minFraction = Number.isFinite(minFractionEnv)
      ? Math.max(0.74, Math.min(0.97, minFractionEnv))
      : Math.max(baseMinFraction, 0.86);

    return { target, delta, minFraction };
  }

  if (!isDressLikeDetectionCategory(detectionProductCategory)) {
    return {
      target: baseTarget,
      delta: baseDelta,
      minFraction: baseMinFraction,
    };
  }

  const targetEnv = Number(process.env.SEARCH_IMAGE_DRESS_MIN_RESULTS);
  const deltaEnv = Number(process.env.SEARCH_IMAGE_DRESS_RELEVANCE_RELAX_DELTA);
  const minFractionEnv = Number(process.env.SEARCH_IMAGE_DRESS_RELEVANCE_RELAX_MIN_FRACTION);

  const target = Number.isFinite(targetEnv)
    ? Math.max(0, Math.min(80, Math.floor(targetEnv)))
    : Math.max(baseTarget, 8);
  const delta = Number.isFinite(deltaEnv)
    ? Math.max(0.02, Math.min(0.18, deltaEnv))
    : Math.min(Math.max(baseDelta, 0.04), 0.06);
  const minFraction = Number.isFinite(minFractionEnv)
    ? Math.max(0.72, Math.min(0.96, minFractionEnv))
    : Math.max(baseMinFraction, 0.86);

  return { target, delta, minFraction };
}

/** OpenSearch kNN field for image search: `embedding` (full-frame CLIP) or `embedding_garment` (garment-focused). */
function resolveImageSearchKnnField(explicit?: string): "embedding" | "embedding_garment" {
  const fromCaller = explicit != null ? String(explicit).trim().toLowerCase() : "";
  const fromEnv = String(process.env.SEARCH_IMAGE_KNN_FIELD ?? "").trim().toLowerCase();
  const raw = fromCaller || fromEnv || "embedding";
  return raw === "embedding_garment" ? "embedding_garment" : "embedding";
}

/**
 * Broad query: no category / productTypes / text / explicit color — CLIP should drive ordering
 * (same conditions as SEARCH_IMAGE_RANK_VISUAL_FIRST).
 */
function isBroadImageSearchVisualPrimaryRanking(
  filters: SearchFilters,
  imageSearchTextQuery: string | undefined,
): boolean {
  const v = String(process.env.SEARCH_IMAGE_RANK_VISUAL_FIRST ?? "1").toLowerCase();
  if (v === "0" || v === "false") return false;
  const frec = filters as Record<string, unknown>;
  const fcat = (filters as { category?: string | string[] }).category;
  const explicitColor =
    (Array.isArray(frec.colors) && frec.colors.length > 0) ||
    (typeof frec.color === "string" && String(frec.color).trim().length > 0);
  return (
    fcat == null &&
    !(Array.isArray(frec.productTypes) && frec.productTypes.length > 0) &&
    !(typeof imageSearchTextQuery === "string" && imageSearchTextQuery.trim().length > 0) &&
    !explicitColor
  );
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
/** OpenSearch may return knn_vector as number[] or TypedArray after JSON parse. */
function asFloatVector(v: unknown, dim: number): number[] | null {
  if (v == null) return null;
  if (Array.isArray(v)) {
    if (v.length !== dim) return null;
    return v.every((x) => typeof x === "number" && Number.isFinite(x)) ? (v as number[]) : null;
  }
  if (ArrayBuffer.isView(v)) {
    const arr = Array.from(v as unknown as ArrayLike<number>);
    return arr.length === dim ? arr : null;
  }
  return null;
}

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

function cosineSimilarityRaw(a: number[] | undefined, b: number[] | undefined): number {
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
  return dot / denom;
}

type ScoreVersion = "v1" | "v2";

function normalizeTo01ByVersion(rawScore: number, version: ScoreVersion): number {
  if (!Number.isFinite(rawScore)) return 0;
  if (version === "v1") {
    // Legacy data may be stored as either:
    // - (1 + cosθ) / 2 in [0,1]
    // - 1 + cosθ in [0,2]
    // Convert both to cosine-derived [0,1].
    const cos = rawScore <= 1.001 ? 2 * rawScore - 1 : rawScore - 1;
    return Math.max(0, Math.min(1, cos));
  }
  // v2: raw cosine from cosineSimilarityRaw is already in [-1,1].
  // For CLIP L2-normalized vectors, values are typically in [0,1].
  // If the score is > 1, tolerate legacy `1+cos` responses for mixed indexes.
  if (rawScore > 1.001) {
    return Math.max(0, Math.min(1, rawScore - 1));
  }
  // Raw cosine already in [0,1] for L2-normalized CLIP vectors.
  return Math.max(0, Math.min(1, rawScore));
}

function dualKnnCategoryAlpha(category: string): number {
  const c = String(category || "").toLowerCase().trim();
  if (c === "tops") return 0.46;
  if (c === "bottoms") return 0.48;
  if (c === "accessories") return 0.5;
  return 0.4;
}

function isTopLikeCategory(category: string): boolean {
  return /\b(top|tops|shirt|shirts|blouse|blouses|tee|t-?shirt|sweater|hoodie|cardigan|jacket|coat|blazer|outerwear)\b/.test(
    String(category ?? "").toLowerCase().trim(),
  );
}

function imageStrictFinalDetectionCategoryGateEnabled(): boolean {
  const raw = String(process.env.SEARCH_IMAGE_STRICT_FINAL_DETECTION_CATEGORY_GATE ?? "1").toLowerCase();
  return raw === "1" || raw === "true";
}

function productCategoryFamilyBlob(product: Record<string, unknown>): string {
  return [
    product.category,
    product.category_canonical,
    product.title,
    product.description,
    product.attr_sleeve,
    product.attr_length,
    ...(Array.isArray(product.product_types) ? product.product_types : []),
  ]
    .filter((x) => x != null)
    .map((x) => String(x).toLowerCase())
    .join(" ");
}

function isStrictDetectionCategory(cat: string): boolean {
  const c = String(cat || "").toLowerCase().trim();
  return c === "tops" || c === "dresses" || c === "footwear" || c === "bottoms" || c === "outerwear";
}

function passesStrictDetectionCategoryFamily(
  product: Record<string, unknown>,
  detectionProductCategory: string,
): boolean {
  const d = String(detectionProductCategory || "").toLowerCase().trim();
  if (!isStrictDetectionCategory(d)) return true;

  const blob = productCategoryFamilyBlob(product);
  if (!blob.trim()) return false;

  const hasFootwear = /\b(footwear|shoe|shoes|sneaker|sneakers|boot|boots|heel|heels|sandal|sandals|loafer|loafers|trainer|trainers|flat|flats|oxford|oxfords|pump|pumps|mule|mules|clog|clogs)\b/.test(blob);
  const hasTop = /\b(top|tops|shirt|shirts|t-?shirt|tshirt|tee|blouse|blouses|tank|cami|camisole|sweater|cardigan|hoodie|pullover|jumper|polo|henley|tunic|knitwear|bodysuit|crop\s*top|button\s*down|button-down)\b/.test(blob);
  const hasOuterwear = /\b(outerwear|outwear|jacket|jackets|coat|coats|blazer|blazers|parka|parkas|trench|windbreaker|windbreakers|bomber|bombers)\b/.test(blob);
  const hasBottom = /\b(bottom|bottoms|pant|pants|trouser|trousers|jean|jeans|denim|shorts?|skirt|skirts|legging|leggings|jogger|joggers|sweatpants?|slack|slacks|culotte|culottes|palazzo|chino|chinos|cargo|track\s*pants?)\b/.test(blob);
  const hasDressOnePiece = /\b(dress|dresses|gown|gowns|frock|frocks|sundress|jumpsuit|jumpsuits|romper|rompers|playsuit|playsuits|abaya|abayas|kaftan|kaftans|caftan|caftans)\b/.test(blob);
  const hasAccessory = /\b(bag|bags|wallet|wallets|belt|belts|hat|hats|cap|caps|jewelry|jewellery|ring|rings|earring|earrings|necklace|necklaces|bracelet|bracelets|watch|watches|sunglasses|glasses|scarf|scarves)\b/.test(blob);

  if (d === "footwear") {
    return hasFootwear;
  }

  if (d === "dresses") {
    if (!hasDressOnePiece && !isOnePieceCatalogCandidate(product)) return false;
    if (hasFootwear || hasAccessory) return false;
    return true;
  }

  if (d === "tops") {
    if (!hasTop) return false;
    if (hasFootwear || hasAccessory) return false;
    return true;
  }

  if (d === "outerwear") {
    if (!hasOuterwear) return false;
    if (hasFootwear || hasAccessory) return false;
    return true;
  }

  if (d === "bottoms") {
    if (!hasBottom) return false;
    if (hasFootwear || hasAccessory) return false;
    return true;
  }

  return true;
}

function isOnePieceCatalogCandidate(product: Record<string, unknown>): boolean {
  const blob = [
    product.category,
    product.category_canonical,
    product.title,
    product.description,
    ...(Array.isArray(product.product_types) ? product.product_types : []),
  ]
    .filter((x) => x != null)
    .map((x) => String(x).toLowerCase())
    .join(" ");

  if (!blob.trim()) return false;

  const onePieceCue = /\b(dress|dresses|gown|gowns|frock|frocks|sundress|maxi dress|midi dress|mini dress|jumpsuit|jumpsuits|romper|rompers|playsuit|playsuits|abaya|abayas|kaftan|kaftans|caftan|caftans)\b/.test(
    blob,
  );
  if (!onePieceCue) return false;

  const strongNonOnePieceCue = /\b(shoe|shoes|sneaker|sneakers|boot|boots|heel|heels|sandal|sandals|loafer|loafers|bag|bags|wallet|wallets|belt|belts|hat|hats|cap|caps|trouser|trousers|pants|shorts|skirt|skirts|tee|t-?shirt|shirt|shirts|blouse|blouses|hoodie|sweater|cardigan|jacket|coat|blazer)\b/.test(
    blob,
  );

  // If both cues exist (e.g., styling text), keep the candidate and let similarity/type score decide.
  return onePieceCue || !strongNonOnePieceCue;
}

function hasBucketOnlyColorConflict(
  desiredColors: string[],
  docColors: string[],
  mode: "any" | "all",
): boolean {
  const desired = (desiredColors ?? [])
    .map((c) => normalizeColorToken(String(c ?? "").toLowerCase().trim()) ?? String(c ?? "").toLowerCase().trim())
    .filter(Boolean);
  const doc = (docColors ?? [])
    .map((c) => normalizeColorToken(String(c ?? "").toLowerCase().trim()) ?? String(c ?? "").toLowerCase().trim())
    .filter(Boolean);

  if (desired.length === 0 || doc.length === 0) return false;

  const matches = desired.map((d) => tieredColorMatchScore(d, doc));
  const hasStrong = matches.some((m) => m.tier === "exact" || m.tier === "family");
  const hasBucket = matches.some((m) => m.tier === "bucket");

  if (mode === "all") {
    return matches.some((m) => m.tier === "bucket" || m.tier === "none") && !hasStrong;
  }

  return hasBucket && !hasStrong;
}

function computeTopPartSimilarity01(partSims: Record<string, number> | null | undefined): number {
  if (!partSims || typeof partSims !== "object") return 0;
  const sleeve = Math.max(0, Math.min(1, Number(partSims.sleeve ?? 0)));
  const neckline = Math.max(0, Math.min(1, Number(partSims.neckline ?? 0)));
  const patternPatch = Math.max(0, Math.min(1, Number(partSims.pattern_patch ?? 0)));

  const weighted =
    (sleeve > 0 ? 0.5 * sleeve : 0) +
    (neckline > 0 ? 0.35 * neckline : 0) +
    (patternPatch > 0 ? 0.15 * patternPatch : 0);
  const denom =
    (sleeve > 0 ? 0.5 : 0) +
    (neckline > 0 ? 0.35 : 0) +
    (patternPatch > 0 ? 0.15 : 0);
  if (denom <= 1e-6) return 0;
  return Math.max(0, Math.min(1, weighted / denom));
}

function isBagLikeCategory(category: string): boolean {
  return /\b(bag|bags|wallet|wallets|purse|purses|handbag|handbags|tote|totes|backpack|backpacks|clutch|clutches|crossbody|satchel|satchels)\b/.test(
    String(category ?? "").toLowerCase().trim(),
  );
}

function isBagCatalogCandidate(source: Record<string, unknown> | null | undefined): boolean {
  const src = (source ?? {}) as Record<string, unknown>;
  const blob = [
    src.category,
    src.category_canonical,
    src.title,
    src.description,
    ...(Array.isArray(src.product_types) ? src.product_types : []),
  ]
    .map((v) => String(v ?? "").toLowerCase())
    .join(" ");
  if (!blob.trim()) return false;

  const hasBagCue =
    /\b(bag|bags|wallet|wallets|purse|purses|handbag|handbags|tote|totes|backpack|backpacks|clutch|clutches|crossbody|satchel|satchels|pouch|pouches)\b/.test(
      blob,
    );
  if (!hasBagCue) return false;

  // Reject frequent non-bag false positives that still pass visual similarity.
  const hasNonBagCue =
    /\b(makeup|cosmetic|skincare|serum|mascara|eyeliner|lipstick|gift\s*set|beauty\s*box|perfume|fragrance|strap|shoulder\s*strap|belt|watch|jewelry|jewellery)\b/.test(
      blob,
    );
  return !hasNonBagCue;
}

function computeExplicitFinalRelevance(params: {
  simVisual: number;
  typeMatch: boolean;
  catSoft: number;
  colorMatch: number;
  colorTier?: "exact" | "family" | "bucket" | "none";
  styleMatch: number;
  sleeveMatch: number;
  lengthMatch: number;
  audienceMatch: number;
  crossFamily: boolean;
  crossFamilyPenalty: number;
  isNearDuplicate: boolean;
  hasTypeIntent: boolean;
  hasColorIntent: boolean;
  hasStyleIntent: boolean;
  hasSleeveIntent: boolean;
  hasLengthIntent: boolean;
  hasAudienceIntent: boolean;
  intraFamilyPenalty?: number;
  colorSimRaw?: number;
  styleSimRaw?: number;
  patternSimRaw?: number;
  /** Batch-adaptive CLIP floor (percentile-based); falls back to 0.50 when absent. */
  adaptiveClipFloor?: number;
  /** Normalized imageCompositeScore01 for this hit; blended into final score. */
  imageCompositeScore01?: number;
  /** BLIP alignment matchScore [0,1] — used as soft reranking multiplier. */
  blipMatchScore?: number;
  /** Merged category intent from the query/image analyzer, if available. */
  mergedCategoryForRelevance?: string;
  /** Detection category from the image analyzer, if available. */
  detectionProductCategory?: string;
  /** Weight of batch-normalized composite in the final blend (adaptive per query). */
  compositeInfluence?: number;
  /**
   * Relative trust in color metadata channel [0,1].
   * - 1.0 for explicit user color intent
   * - lower for inferred/crop-only signals to reduce noisy color over-weighting
   */
  colorWeightScale?: number;
  /** Strength of color intent for the final multiplicative gate [0,1]. */
  colorIntentStrength?: number;
  /** Part matching factor from Phase 1 (optional, defaults to 1.0 for no-op). */
  partMatchingFactor?: number;
}): { score: number; fusedVisual: number; metadataCompliance: number } {
  const colorWeightScale = Math.max(0.2, Math.min(1, params.colorWeightScale ?? 1));
  const colorIntentStrength = Math.max(0, Math.min(1, params.colorIntentStrength ?? 0));
  const colorTier = String(params.colorTier ?? "none").toLowerCase();
  const mergedCategory = String(params.mergedCategoryForRelevance ?? "").toLowerCase().trim();
  const isTopLikeIntent = isTopLikeCategory(mergedCategory) || String(params.detectionProductCategory ?? "").toLowerCase().trim() === "tops";
  const isBottomLikeIntent = /\b(bottom|bottoms|pants?|trousers?|jeans?|skirt|skirts|leggings?)\b/.test(mergedCategory) || String(params.detectionProductCategory ?? "").toLowerCase().trim() === "bottoms";
  const isBagLikeIntent = isBagLikeCategory(mergedCategory) || String(params.detectionProductCategory ?? "").toLowerCase().trim() === "bags";

  const simVisual = Math.max(0, Math.min(1, params.simVisual));

  if (params.crossFamily) {
    return { score: Math.max(0, simVisual * 0.12), fusedVisual: 0, metadataCompliance: 0 };
  }

  const crossSoft = Math.max(0, 1 - params.crossFamilyPenalty * 0.75);

  const intra = Math.max(0, params.intraFamilyPenalty ?? 0);
  const typeGate = params.hasTypeIntent
    ? params.typeMatch
      ? intra >= 0.4
        ? 0.80
        : intra >= 0.25
          ? 0.88
          : 1
      : isBottomLikeIntent
        ? simVisual >= 0.75
          ? 0.68
          : 0.6
        : 0.55
    : 1;

  // ── Multi-channel visual similarity ──────────────────────────────
  const colorSimRaw = Math.max(0, Math.min(1, params.colorSimRaw ?? 0));
  const styleSimRaw = Math.max(0, Math.min(1, params.styleSimRaw ?? 0));
  const patternSimRaw = Math.max(0, Math.min(1, params.patternSimRaw ?? 0));

  const stretchSim = (raw: number, floor: number): number => {
    if (raw <= floor) return 0;
    return Math.min(1, (raw - floor) / (1 - floor));
  };

  // Adaptive CLIP floor: use batch-derived percentile when available,
  // clamped to a sane range. Default 0.50 preserves signal for
  // products in the typical 0.50-0.85 fashion similarity range.
  const clipFloor = Math.max(0.40, Math.min(0.65, params.adaptiveClipFloor ?? 0.50));
  const subFloor = 0.42;

  const clipStretched = stretchSim(simVisual, clipFloor);
  const colorStretched = stretchSim(colorSimRaw, subFloor);
  const styleStretched = stretchSim(styleSimRaw, subFloor);
  const patternStretched = stretchSim(patternSimRaw, subFloor);

  // Intent-aware channel coherence: avoid rewarding high embedding similarity
  // when the corresponding metadata compliance clearly disagrees.
  const colorChannelCoherence = params.hasColorIntent
    ? 0.2 + 0.8 * Math.max(0, Math.min(1, params.colorMatch))
    : 1;
  const styleChannelCoherence = params.hasStyleIntent
    ? (isTopLikeIntent
      ? 0.3 + 0.7 * Math.max(0, Math.min(1, params.styleMatch))
      : isBottomLikeIntent
        ? 0.26 + 0.74 * Math.max(0, Math.min(1, params.styleMatch))
      : isBagLikeIntent
        ? 0.2 + 0.8 * Math.max(0, Math.min(1, params.styleMatch))
        : 0.25 + 0.75 * Math.max(0, Math.min(1, params.styleMatch)))
    : 1;

  // Sub-channels are independently gated with a soft floor so that
  // moderate CLIP similarity does not zero out strong color/style/pattern signals.
  const subChannelGate = Math.min(1, 0.3 + clipStretched * 1.4);
  const fusedVisual = Math.max(
    0,
    Math.min(
      1,
      0.45 * clipStretched +
      0.27 * colorStretched * subChannelGate * colorChannelCoherence +
      0.16 * styleStretched * subChannelGate * styleChannelCoherence +
      0.12 * patternStretched * subChannelGate,
    ),
  );

  // ── Metadata compliance ──────────────────────────────────────────
  const patternMatch = Math.max(0, Math.min(1, params.patternSimRaw ?? 0));
  const complianceFromAttrs = Math.max(
    0,
    Math.min(
      1,
      isTopLikeIntent
        ? 0.12 * params.catSoft +
        0.34 * params.colorMatch * colorWeightScale +
        0.27 * params.styleMatch +
        0.17 * params.sleeveMatch +
        0.06 * params.lengthMatch +
        0.05 * params.audienceMatch +
        0.03 * patternMatch
        : isBottomLikeIntent
          ? 0.14 * params.catSoft +
          0.42 * params.colorMatch * colorWeightScale +
          0.24 * params.styleMatch +
          0.05 * params.sleeveMatch +
          0.1 * params.lengthMatch +
          0.05 * params.audienceMatch +
          0.01 * patternMatch
        : isBagLikeIntent
          ? 0.14 * params.catSoft +
          0.5 * params.colorMatch * colorWeightScale +
          0.14 * params.styleMatch +
          0.03 * params.sleeveMatch +
          0.02 * params.lengthMatch +
          0.05 * params.audienceMatch +
          0.12 * patternMatch
          : 0.12 * params.catSoft +
          0.4 * params.colorMatch * colorWeightScale +
          0.22 * params.styleMatch +
          0.14 * params.sleeveMatch +
          0.08 * params.lengthMatch +
          0.05 * params.audienceMatch +
          0.01 * patternMatch,
    ),
  );

  const compliance =
    params.isNearDuplicate && params.typeMatch
      ? Math.max(complianceFromAttrs, 0.85)
      : complianceFromAttrs;

  const colorGate =
    colorIntentStrength > 0
      ? Math.max(0.35, 1 - 0.65 * colorIntentStrength * (1 - params.colorMatch))
      : 1;
  const colorTierFactor =
    colorIntentStrength > 0
      ? colorTier === "exact"
        ? 1.12 + 0.08 * colorIntentStrength
        : colorTier === "family"
          ? 1.06 + 0.05 * colorIntentStrength
          : colorTier === "bucket"
            ? 0.88 - 0.06 * colorIntentStrength
            : 0.74 - 0.12 * colorIntentStrength
      : 1;

  // ── Intent coverage gate ─────────────────────────────────────────
  const intentWeights = {
    color: isBagLikeIntent ? 0.46 : isTopLikeIntent ? 0.34 : isBottomLikeIntent ? 0.42 : 0.4,
    style: isBagLikeIntent ? 0.14 : isTopLikeIntent ? 0.24 : isBottomLikeIntent ? 0.22 : 0.18,
    // Sleeve inferred from vision can be noisy; keep it informative but less punitive.
    // When visual similarity is very high (>0.65), reduce sleeve weight since it's often a detection artifact.
    sleeve: isBagLikeIntent
      ? 0.02
      : isTopLikeIntent
        ? (params.simVisual >= 0.65 ? 0.1 : 0.14)
        : isBottomLikeIntent
          ? (params.simVisual >= 0.65 ? 0.03 : 0.05)
        : (params.simVisual >= 0.65 ? 0.04 : 0.08),
    length: isBagLikeIntent ? 0.04 : isBottomLikeIntent ? 0.14 : 0.12,
    audience: isBagLikeIntent ? 0.14 : isTopLikeIntent ? 0.14 : 0.16,
  };
  let activeIntentWeight = 0;
  let coveredIntentWeight = 0;
  if (params.hasColorIntent) {
    activeIntentWeight += intentWeights.color;
    coveredIntentWeight += intentWeights.color * Math.max(0, Math.min(1, params.colorMatch));
  }
  if (params.hasStyleIntent) {
    activeIntentWeight += intentWeights.style;
    const styleCoverage = Math.max(
      Math.max(0, Math.min(1, params.styleMatch)),
      Math.min(0.22, clipStretched * 0.28),
    );
    coveredIntentWeight += intentWeights.style * styleCoverage;
  }
  if (params.hasSleeveIntent) {
    activeIntentWeight += intentWeights.sleeve;
    const sleeveCoverage = Math.max(
      Math.max(0, Math.min(1, params.sleeveMatch)),
      Math.min(0.18, clipStretched * 0.22),
    );
    coveredIntentWeight += intentWeights.sleeve * sleeveCoverage;
  }
  if (params.hasLengthIntent) {
    activeIntentWeight += intentWeights.length;
    coveredIntentWeight += intentWeights.length * Math.max(0, Math.min(1, params.lengthMatch));
  }
  if (params.hasAudienceIntent) {
    activeIntentWeight += intentWeights.audience;
    coveredIntentWeight += intentWeights.audience * Math.max(0, Math.min(1, params.audienceMatch));
  }
  const intentCoverage =
    activeIntentWeight > 0
      ? Math.max(0, Math.min(1, coveredIntentWeight / activeIntentWeight))
      : 1;
  const intentGate = 0.20 + 0.80 * intentCoverage;

  // ── BLIP soft reranking multiplier ─────────────────────────────
  const blipMatch = Math.max(0, Math.min(1, params.blipMatchScore ?? 0));
  const blipFactor = 0.85 + 0.15 * blipMatch;

  // ── Part-level matching multiplier (Phase 1) ────────────────────
  // Part matching contributes a soft boosting factor when parts align well.
  // Default: no-op (factor = 1.0) when parts disabled or unavailable.
  const partMatchingFactor = Math.max(1.0, Math.min(isTopLikeIntent ? 1.22 : 1.15, params.partMatchingFactor ?? 1.0));

  // ── Composite contribution ─────────────────────────────────────
  const compositeScore01 = Math.max(0, Math.min(1, params.imageCompositeScore01 ?? 0));
  const compositeInfluence = Math.max(
    0.02,
    Math.min(0.15, params.compositeInfluence ?? imageSearchCompositeInfluenceBase()),
  );

  // ── Final blend ──────────────────────────────────────────────────
  const visualWeight = isTopLikeIntent
    ? fusedVisual >= 0.30
      ? 0.83
      : 0.75
    : isBottomLikeIntent
      ? fusedVisual >= 0.30
        ? 0.82
        : 0.74
    : isBagLikeIntent
      ? fusedVisual >= 0.30
        ? 0.8
        : 0.72
      : fusedVisual >= 0.30
        ? 0.86
        : 0.78;
  const complianceWeight = 1 - visualWeight;

  const coreBlend = visualWeight * fusedVisual + complianceWeight * compliance;
  const withComposite =
    (1 - compositeInfluence) * coreBlend + compositeInfluence * compositeScore01;

  const raw = withComposite * typeGate * crossSoft * intentGate * colorGate * colorTierFactor * blipFactor * partMatchingFactor;
  return {
    score: Math.max(0, Math.min(1, raw)),
    fusedVisual,
    metadataCompliance: compliance,
  };
}

function normalizeLengthToken(raw: unknown): "mini" | "midi" | "maxi" | "long" | null {
  const s = String(raw ?? "").toLowerCase().trim();
  if (!s) return null;
  if (/\bmini\b/.test(s)) return "mini";
  if (/\bmidi\b/.test(s)) return "midi";
  if (/\bmaxi\b/.test(s)) return "maxi";
  if (/\blong\b/.test(s)) return "long";
  return null;
}

function inferDocLengthToken(hit: any): {
  value: "mini" | "midi" | "maxi" | "long" | null;
  explicit: boolean;
} {
  const attr = normalizeLengthToken(hit?._source?.attr_length);
  if (attr) return { value: attr, explicit: true };
  const title = String(hit?._source?.title ?? "").toLowerCase();
  const desc = String(hit?._source?.description ?? "").toLowerCase();
  const blob = `${title} ${desc}`;
  if (/\bmini\b/.test(blob)) return { value: "mini", explicit: false };
  if (/\bmidi\b/.test(blob)) return { value: "midi", explicit: false };
  if (/\bmaxi\b/.test(blob)) return { value: "maxi", explicit: false };
  if (/\blong\b/.test(blob)) return { value: "long", explicit: false };
  return { value: null, explicit: false };
}

function lengthComplianceScore(
  desired: "mini" | "midi" | "maxi" | "long" | null,
  observed: "mini" | "midi" | "maxi" | "long" | null,
  explicitObserved: boolean,
): number {
  if (!desired) return 0;
  if (!observed) {
    // Unknown length should not behave like a strong match when user explicitly asked
    // for long/maxi silhouettes.
    if (desired === "long" || desired === "maxi") return 0.32;
    return 0.45;
  }
  if (desired === observed) return 1;
  if (explicitObserved) return 0;
  if ((desired === "long" && (observed === "midi" || observed === "maxi")) || (observed === "long" && (desired === "midi" || desired === "maxi"))) {
    return 0.86;
  }
  if ((desired === "mini" && observed === "midi") || (desired === "midi" && observed === "mini")) return 0.38;
  if ((desired === "maxi" && observed === "midi") || (desired === "midi" && observed === "maxi")) return 0.52;
  return 0.18;
}

function docSupportsLengthIntent(hit: any): boolean {
  const src = hit?._source ?? {};
  const bag = [
    src.category,
    src.category_canonical,
    src.title,
    ...(Array.isArray(src.product_types) ? src.product_types : []),
  ]
    .map((x) => String(x ?? "").toLowerCase())
    .join(" ");
  if (!bag.trim()) return true;
  if (/\b(shoe|shoes|sneaker|sneakers|boot|boots|sandal|sandals|heel|heels|loafer|loafers)\b/.test(bag)) {
    return false;
  }
  if (/\b(bag|bags|wallet|wallets|belt|belts|hat|hats|cap|caps|scarf|scarves|jewelry|jewellery|ring|rings|earring|earrings|necklace|necklaces|bracelet|bracelets)\b/.test(bag)) {
    return false;
  }
  return true;
}

/** Parallel kNN on `embedding` + `embedding_garment` (opt-in — requires both fields populated in the index). */
function imageDualKnnFusionEnabled(): boolean {
  const v = String(process.env.SEARCH_IMAGE_DUAL_KNN ?? "0").toLowerCase();
  return v === "1" || v === "true";
}

function imageDualKnnDetectionEnabled(): boolean {
  const v = String(process.env.SEARCH_IMAGE_DETECTION_DUAL_KNN ?? "1").toLowerCase();
  return v !== "0" && v !== "false";
}

/**
 * HNSW ef_search for image kNN. Improves recall vs default index ef_search for hard self-match queries.
 * Set SEARCH_IMAGE_EF_SEARCH=0 to omit (some managed clusters reject per-query ef_search).
 */
let imageKnnEfSearchSupported: boolean | null = null;

function imageKnnEfSearch(): number {
  if (imageKnnEfSearchSupported === false) return 0;
  const rawEnv = process.env.SEARCH_IMAGE_EF_SEARCH;
  if (rawEnv === undefined || String(rawEnv).trim() === "") {
    return 128;
  }
  const raw = Number(rawEnv);
  if (Number.isFinite(raw) && raw === 0) return 0;
  if (Number.isFinite(raw) && raw > 0) return Math.max(64, Math.min(512, Math.floor(raw)));
  return 128;
}

function mergeKnnHitsByProductId(primary: any[], extra: any[], cap: number): any[] {
  const byId = new Map<string, any>();
  const mergeOne = (hit: any) => {
    const id = String(hit?._source?.product_id ?? "").trim();
    if (!id) return;
    const prev = byId.get(id);
    if (!prev) {
      byId.set(id, hit);
      return;
    }
    const prevScore = Number(prev?._score ?? Number.NEGATIVE_INFINITY);
    const nextScore = Number(hit?._score ?? Number.NEGATIVE_INFINITY);
    if (nextScore > prevScore) {
      byId.set(id, { ...prev, ...hit, _source: { ...(prev?._source ?? {}), ...(hit?._source ?? {}) } });
    }
  };

  for (const hit of primary ?? []) mergeOne(hit);
  for (const hit of extra ?? []) mergeOne(hit);

  return [...byId.values()]
    .sort((a, b) => Number((b as any)?._score ?? Number.NEGATIVE_INFINITY) - Number((a as any)?._score ?? Number.NEGATIVE_INFINITY))
    .slice(0, Math.max(1, cap));
}

function knnQueryInner(vector: number[], k: number, ef: number): Record<string, unknown> {
  const inner: Record<string, unknown> = { vector, k };
  if (ef > 0) inner.ef_search = ef;
  return inner;
}

function stripEfSearchFromKnnBody(body: Record<string, unknown>): Record<string, unknown> {
  const cloned = JSON.parse(JSON.stringify(body)) as Record<string, any>;
  const knn = cloned?.query?.bool?.must?.knn;
  if (knn && typeof knn === "object") {
    for (const fieldName of Object.keys(knn)) {
      const fieldObj = knn[fieldName];
      if (fieldObj && typeof fieldObj === "object" && "ef_search" in fieldObj) {
        delete fieldObj.ef_search;
      }
    }
  }
  return cloned;
}

/**
 * Union global + garment kNN hits; visual score = max(cos(q_global, emb), cos(q_garment, emb_garment)).
 */
function mergeDualKnnHitsForImageSearch(
  hitsGlobal: any[],
  hitsGarment: any[],
  qGlobal: number[],
  qGarment: number[],
): any[] {
  const gMap = new Map<string, any>();
  for (const h of hitsGlobal) {
    const id = String(h?._source?.product_id ?? "");
    if (id) gMap.set(id, h);
  }
  const garMap = new Map<string, any>();
  for (const h of hitsGarment) {
    const id = String(h?._source?.product_id ?? "");
    if (id) garMap.set(id, h);
  }
  const out: any[] = [];
  for (const id of new Set([...gMap.keys(), ...garMap.keys()])) {
    const hg = gMap.get(id);
    const hgar = garMap.get(id);
    const base = hg ?? hgar;
    if (!base) continue;
    const src: Record<string, unknown> = { ...(base._source ?? {}) };
    if (hg?._source) Object.assign(src, hg._source);
    if (hgar?._source?.embedding_garment != null) src.embedding_garment = hgar._source.embedding_garment;
    const mergedHit = {
      ...base,
      _source: src,
      _score: Math.max(Number(hg?._score ?? 0), Number(hgar?._score ?? 0)),
    };
    const emb = asFloatVector(src.embedding, qGlobal.length);
    const embG = asFloatVector(src.embedding_garment, qGarment.length);
    const hadGlobalVec = emb !== null;
    const hadGarmentVec = embG !== null;
    if (hadGlobalVec || hadGarmentVec) {
      const gRaw = hadGlobalVec ? cosineSimilarityRaw(qGlobal, emb!) : 0;
      const grRaw = hadGarmentVec ? cosineSimilarityRaw(qGarment, embG!) : 0;
      const g = normalizeTo01ByVersion(gRaw, "v2");
      const gr = normalizeTo01ByVersion(grRaw, "v2");
      const category = String(src.category_canonical ?? src.category ?? "");
      const alpha = dualKnnCategoryAlpha(category);
      const fused = hadGlobalVec && hadGarmentVec ? alpha * g + (1 - alpha) * gr : hadGlobalVec ? g : gr;
      mergedHit._exactCosineRaw = hadGlobalVec && hadGarmentVec ? alpha * gRaw + (1 - alpha) * grRaw : hadGlobalVec ? gRaw : grRaw;
      mergedHit._exactCosine01 = Math.max(0, Math.min(1, fused));
      mergedHit._dualDisagreement = Math.abs(g - gr);
      mergedHit._score = mergedHit._exactCosine01;
    }
    // If vectors missing/unparseable, keep OpenSearch _score — do NOT set _exactCosine01=0 or visualSim collapses.
    out.push(mergedHit);
  }
  return out;
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

function imageVisualRescueTypeMinWhenIntent(): number {
  const raw = Number(process.env.SEARCH_IMAGE_VISUAL_RESCUE_TYPE_MIN_WHEN_INTENT ?? "0.35");
  if (!Number.isFinite(raw)) return 0.35;
  return Math.max(0, Math.min(1, raw));
}

function imageVisualRescueColorMinWhenIntent(): number {
  const raw = Number(process.env.SEARCH_IMAGE_VISUAL_RESCUE_COLOR_MIN_WHEN_INTENT ?? "0.28");
  if (!Number.isFinite(raw)) return 0.28;
  return Math.max(0, Math.min(1, raw));
}

function imageVisualRescueStyleMinWhenIntent(): number {
  const raw = Number(process.env.SEARCH_IMAGE_VISUAL_RESCUE_STYLE_MIN_WHEN_INTENT ?? "0.22");
  if (!Number.isFinite(raw)) return 0.22;
  return Math.max(0, Math.min(1, raw));
}

function imageMustKeepVisualMinSimilarity(): number {
  const raw = Number(process.env.SEARCH_IMAGE_MUST_KEEP_VISUAL_MIN_SIM ?? "0.72");
  if (!Number.isFinite(raw)) return 0.72;
  return Math.max(0.45, Math.min(0.98, raw));
}

function imageMustKeepVisualMaxCount(): number {
  const raw = Number(process.env.SEARCH_IMAGE_MUST_KEEP_VISUAL_MAX_COUNT ?? "4");
  if (!Number.isFinite(raw)) return 4;
  return Math.max(0, Math.min(12, Math.floor(raw)));
}

function imageMustKeepVisualAudienceMin(): number {
  const raw = Number(process.env.SEARCH_IMAGE_MUST_KEEP_VISUAL_AUDIENCE_MIN ?? "0.75");
  if (!Number.isFinite(raw)) return 0.75;
  return Math.max(0, Math.min(1, raw));
}

function imageStrongVisualOverrideMinSimilarity(): number {
  const raw = Number(process.env.SEARCH_IMAGE_STRONG_VISUAL_OVERRIDE_MIN_SIM ?? "0.86");
  if (!Number.isFinite(raw)) return 0.86;
  return Math.max(0.65, Math.min(0.99, raw));
}

function imageStrongVisualOverrideMaxCount(): number {
  const raw = Number(process.env.SEARCH_IMAGE_STRONG_VISUAL_OVERRIDE_MAX_COUNT ?? "6");
  if (!Number.isFinite(raw)) return 6;
  return Math.max(0, Math.min(20, Math.floor(raw)));
}

function imageGenderUnknownVisualMinSimilarity(): number {
  const raw = Number(process.env.SEARCH_IMAGE_GENDER_UNKNOWN_MIN_SIM ?? "0.82");
  if (!Number.isFinite(raw)) return 0.82;
  return Math.max(0.5, Math.min(0.99, raw));
}

function imageBlipAlignmentWeight(): number {
  const raw = Number(process.env.SEARCH_IMAGE_BLIP_ALIGNMENT_WEIGHT ?? "0.3");
  if (!Number.isFinite(raw)) return 0.3;
  return Math.max(0, Math.min(1, raw));
}

function imageBlipAlignmentMaxBoost(): number {
  const raw = Number(process.env.SEARCH_IMAGE_BLIP_ALIGNMENT_MAX_BOOST ?? "0.18");
  if (!Number.isFinite(raw)) return 0.18;
  return Math.max(0, Math.min(0.5, raw));
}

function normalizeSimpleToken(x: unknown): string {
  return String(x ?? "").toLowerCase().trim();
}

function normalizeAudienceAgeGroupValue(x: unknown): string | undefined {
  const s = normalizeSimpleToken(x);
  if (!s) return undefined;
  if (["kids", "kid", "children", "child", "junior", "youth", "toddler", "baby", "boys", "girls", "boy", "girl"].includes(s)) {
    return "kids";
  }
  if (["adult", "adults", "men", "women", "unisex"].includes(s)) return "adult";
  if (["teen", "teens", "teenager", "teenagers"].includes(s)) return "teen";
  return s;
}

function hasKidsAudienceToken(x: unknown): boolean {
  const s = normalizeSimpleToken(x);
  if (!s) return false;
  return /\b(boy|boys|girl|girls|kid|kids|child|children|toddler|baby|youth|junior)\b/.test(s);
}

function normalizeLexicalToken(x: string): string {
  const t = x.toLowerCase().trim();
  if (t.endsWith("ies") && t.length > 4) return `${t.slice(0, -3)}y`;
  if (t.endsWith("es") && t.length > 4) return t.slice(0, -2);
  if (t.endsWith("s") && t.length > 3) return t.slice(0, -1);
  return t;
}

function tokenizeLexicalTerms(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((tok) => normalizeLexicalToken(tok))
    .filter((tok) => tok.length >= 3);
}

function computeSubtypeKeywordSignal(params: {
  desiredProductTypes: string[];
  preferredDesiredProductTypes?: string[];
  hit: any;
  reliableTypeIntent: boolean;
  crossFamilyPenalty: number;
  productTypeCompliance: number;
}): { boost: number; overlap: number; exactHit: boolean } {
  const preferred = (params.preferredDesiredProductTypes ?? [])
    .map((t) => String(t).toLowerCase().trim())
    .filter(Boolean);
  const desiredRaw = preferred.length > 0 ? preferred : params.desiredProductTypes;
  const desired = desiredRaw
    .map((t) => String(t).toLowerCase().trim())
    .filter(Boolean);
  if (!params.reliableTypeIntent || desired.length === 0) {
    return { boost: 0, overlap: 0, exactHit: false };
  }
  if ((params.crossFamilyPenalty ?? 0) >= 0.5) {
    return { boost: 0, overlap: 0, exactHit: false };
  }

  const src = params.hit?._source ?? {};
  const hitTypes = Array.isArray(src.product_types)
    ? src.product_types.map((t: unknown) => String(t).toLowerCase().trim()).filter(Boolean)
    : [];
  const haystack = [
    ...hitTypes,
    String(src.category_canonical ?? "").toLowerCase(),
    String(src.category ?? "").toLowerCase(),
    String(src.title ?? "").toLowerCase(),
  ]
    .filter(Boolean)
    .join(" ");

  const exactHit = desired.some((d) => {
    if (!d) return false;
    if (hitTypes.includes(d)) return true;
    const escaped = d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "i").test(haystack);
  });

  const exactMatchedDesired = desired.filter((d) => {
    if (!d) return false;
    if (hitTypes.includes(d)) return true;
    const escaped = d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "i").test(haystack);
  });

  const genericTypeTerms = new Set([
    "pant",
    "pants",
    "trouser",
    "trousers",
    "chino",
    "chinos",
    "cargo",
    "jacket",
    "jackets",
    "coat",
    "coats",
    "outerwear",
    "shirt",
    "shirts",
  ]);
  const hasSpecificExact = exactMatchedDesired.some((term) => {
    const toks = tokenizeLexicalTerms(term);
    if (toks.length === 0) return false;
    if (toks.length > 1) return true;
    return !genericTypeTerms.has(toks[0]);
  });

  const desiredTokens = new Set<string>();
  for (const d of desired) {
    for (const tok of tokenizeLexicalTerms(d)) desiredTokens.add(tok);
  }
  if (desiredTokens.size === 0) {
    return { boost: 0, overlap: 0, exactHit };
  }

  const hitTokens = new Set(tokenizeLexicalTerms(haystack));
  let matched = 0;
  for (const tok of desiredTokens) {
    if (hitTokens.has(tok)) matched += 1;
  }
  const overlap = Math.max(0, Math.min(1, matched / desiredTokens.size));

  const typeComp = Math.max(0, Math.min(1, params.productTypeCompliance ?? 0));
  const complianceGate = typeComp >= 0.75 ? 1 : typeComp >= 0.6 ? 0.7 : 0;

  let baseBoost = 0;
  if (exactHit && hasSpecificExact) baseBoost = 0.03;
  else if (exactHit) baseBoost = preferred.length > 0 ? 0.02 : 0.012;
  else if (overlap >= 0.7) baseBoost = 0.022;
  else if (overlap >= 0.5) baseBoost = 0.015;

  const boost = Math.max(0, Math.min(0.04, baseBoost * complianceGate));
  return {
    boost,
    overlap: Math.round(overlap * 1000) / 1000,
    exactHit,
  };
}

function blendSoftSimilarityWithCompliance(params: {
  rawSim: number;
  compliance: number;
  hasIntent: boolean;
  strictIntent: boolean;
}): number {
  const raw = Math.max(0, Math.min(1, Number(params.rawSim) || 0));
  const comp = Math.max(0, Math.min(1, Number(params.compliance) || 0));
  if (!params.hasIntent) return raw;

  // Embedding cosines are the strongest signal for visual similarity.
  // When keyword-level compliance metadata disagrees (often due to missing/noisy
  // indexed attributes), attenuate gently rather than destroying the embedding signal.
  // A high floor ensures that strong embedding matches survive sparse catalog metadata.
  const floor = params.strictIntent ? 0.30 : 0.45;
  const gain = 1 - floor;
  const scale = floor + gain * Math.pow(comp, 0.5);
  return Math.max(0, Math.min(1, raw * scale));
}

function imageSearchCompositeInfluenceBase(): number {
  const n = Number(process.env.SEARCH_IMAGE_COMPOSITE_INFLUENCE_BASE ?? "0.12");
  return Number.isFinite(n) ? Math.max(0.02, Math.min(0.25, n)) : 0.12;
}

function blipColorConflictMinConfidence(): number {
  const n = Number(process.env.SEARCH_IMAGE_BLIP_COLOR_CONFLICT_MIN_CONF ?? "0.35");
  return Number.isFinite(n) ? Math.max(0.15, Math.min(0.95, n)) : 0.35;
}

function blipColorConflictMaxPenalty(): number {
  const n = Number(process.env.SEARCH_IMAGE_BLIP_COLOR_CONFLICT_MAX_PENALTY ?? "0.55");
  return Number.isFinite(n) ? Math.max(0.02, Math.min(0.95, n)) : 0.55;
}

function docColorPaletteForHit(hit: { _source?: Record<string, unknown> }): string[] {
  const src = hit._source ?? {};
  const raw: string[] = [];
  const push = (s: string) => {
    const t = normalizeColorToken(s) ?? s.trim().toLowerCase();
    if (t && !raw.includes(t)) raw.push(t);
  };
  for (const c of Array.isArray(src.attr_colors) ? src.attr_colors : []) {
    if (c != null) push(String(c));
  }
  if (typeof src.attr_color === "string") push(src.attr_color);
  for (const c of Array.isArray(src.color_palette_canonical) ? src.color_palette_canonical : []) {
    if (c != null) push(String(c));
  }
  if (typeof src.color_primary_canonical === "string") push(src.color_primary_canonical);
  if (typeof src.color === "string") push(src.color);
  return raw;
}

function extractCanonicalColorTokensFromRawColor(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const value = String(raw).toLowerCase().trim();
  if (!value) return [];

  const tokens: string[] = [];
  const add = (v: string) => {
    const x = normalizeColorToken(v) ?? v.trim().toLowerCase();
    if (x && !tokens.includes(x)) tokens.push(x);
  };

  // Preserve whole phrase first (e.g. "mid wash denim" -> blue).
  add(value);

  // Then split merchant composite formats like "white/black", "red & black", "blue, white".
  const parts = value
    .replace(/\band\b/g, ",")
    .split(/[\/,&+|,]/g)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const p of parts) add(p);

  return tokens;
}

function hasChildAudienceSignals(src: Record<string, unknown>): boolean {
  const fields = [
    src.title,
    src.brand,
    src.category,
    src.category_canonical,
    src.audience_gender,
    src.attr_gender,
    src.age_group,
    src.gender,
    src.description,
    src.size,
    Array.isArray(src.product_types) ? src.product_types.join(" ") : "",
  ]
    .map((value) => String(value ?? "").toLowerCase())
    .join(" ");

  if (!fields.trim()) return false;
  if (/\b(kids?|children|child|baby|babies|toddler|toddlers|youth|junior)\b/.test(fields)) return true;
  if (/\b(girls?|boys?)\b/.test(fields)) return true;
  if (/\b(?:\d{1,2}\s?(?:m|mo|months?|y|yr|yrs|years?))\b/.test(fields)) return true;
  return false;
}

function hasOppositeGenderSignalForQuery(
  src: Record<string, unknown>,
  queryGenderRaw: string | null,
): boolean {
  const queryGender = normalizeQueryGender(queryGenderRaw ?? "");
  if (!queryGender || queryGender === "unisex") return false;

  const explicitSignals = [src.audience_gender, src.attr_gender, src.gender]
    .map((value) => normalizeQueryGender(String(value ?? "")))
    .filter((value): value is "men" | "women" | "unisex" => Boolean(value));

  if (explicitSignals.some((g) => g !== "unisex" && g !== queryGender)) {
    return true;
  }

  const blob = [
    src.title,
    src.brand,
    src.category,
    src.category_canonical,
    src.description,
    Array.isArray(src.product_types) ? src.product_types.join(" ") : src.product_types,
  ]
    .map((value) => String(value ?? "").toLowerCase())
    .join(" ");

  if (!blob.trim()) return false;

  const menRe = /\b(men|mens|male|man|gents?|gentlemen)\b/;
  const womenRe = /\b(women|womens|female|lady|ladies|woman)\b/;
  const hasMenCue = menRe.test(blob);
  const hasWomenCue = womenRe.test(blob);

  if (queryGender === "men") return hasWomenCue && !hasMenCue;
  if (queryGender === "women") return hasMenCue && !hasWomenCue;
  return false;
}

function hasStrictTrouserIntent(desiredProductTypes: string[]): boolean {
  const desired = desiredProductTypes
    .map((t) => String(t ?? "").toLowerCase().trim())
    .filter(Boolean)
    .join(" ");
  if (!desired) return false;

  const hasTrouserLike = /\b(trouser|trousers|pant|pants|slack|slacks|chino|chinos|cargo|cargo pants?)\b/.test(desired);
  const hasShortLike = /\b(short|shorts|bermuda|bermudas)\b/.test(desired);
  return hasTrouserLike && !hasShortLike;
}

function isShortsCatalogCandidate(src: Record<string, unknown>): boolean {
  const blob = [
    src.title,
    src.category,
    src.category_canonical,
    Array.isArray(src.product_types) ? src.product_types.join(" ") : src.product_types,
  ]
    .map((value) => String(value ?? "").toLowerCase())
    .join(" ");
  if (!blob.trim()) return false;
  return /\b(shorts?|bermudas?|board\s?shorts?)\b/.test(blob);
}

function isAthleticCatalogCandidate(src: Record<string, unknown>): boolean {
  const blob = [
    src.title,
    src.description,
    src.category,
    src.category_canonical,
    src.brand,
    Array.isArray(src.product_types) ? src.product_types.join(" ") : src.product_types,
  ]
    .filter((x) => x != null)
    .map((x) => String(x))
    .join(" ")
    .toLowerCase();

  if (!blob.trim()) return false;
  const athleticTokenRe = /\b(sport|sportswear|athlet|training|workout|gym|fitness|crossfit|yoga|jogger|track\s?pant|trackpant|running|runner|dry\s?-?fit|dri\s?-?fit|leggings?)\b/i;
  return athleticTokenRe.test(blob);
}

const BAD_COLOR_CODE_MAP: Record<string, string> = {
  "20000": "white",
  "11014": "pink",
};

function isLikelyColorCodeToken(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (!v) return false;
  if (/^#[0-9a-f]{3,8}$/.test(v)) return true;
  if (/^[0-9]{4,6}$/.test(v)) return true;
  if (/^[a-z]?[0-9]{3,6}$/.test(v)) return true;
  return false;
}

function inferCanonicalColorFromText(blobRaw: string): string | null {
  const blob = String(blobRaw ?? "").toLowerCase();
  if (!blob.trim()) return null;
  const hints = [
    "black", "white", "blue", "navy", "brown", "beige", "cream", "ivory", "gray",
    "grey", "green", "khaki", "pink", "rose", "red", "burgundy", "maroon", "purple",
    "lilac", "yellow", "gold", "orange",
  ];
  for (const hint of hints) {
    if (new RegExp(`\\b${hint}\\b`, "i").test(blob)) {
      return normalizeColorToken(hint) ?? hint;
    }
  }
  return null;
}

function extractCanonicalColorTokensFromSource(src: Record<string, unknown>): {
  tokens: string[];
  hasBadColorCode: boolean;
} {
  const tokens: string[] = [];
  let hasBadColorCode = false;
  const add = (value: string | null | undefined) => {
    const raw = String(value ?? "").trim().toLowerCase();
    if (!raw) return;
    const mapped = BAD_COLOR_CODE_MAP[raw];
    if (mapped) {
      const normMapped = normalizeColorToken(mapped) ?? mapped;
      if (normMapped && !tokens.includes(normMapped)) tokens.push(normMapped);
      return;
    }
    if (isLikelyColorCodeToken(raw)) {
      hasBadColorCode = true;
      return;
    }
    for (const token of extractCanonicalColorTokensFromRawColor(raw)) {
      if (token && !tokens.includes(token)) tokens.push(token);
    }
  };

  for (const c of Array.isArray(src.attr_colors) ? src.attr_colors : []) add(String(c ?? ""));
  add(typeof src.attr_color === "string" ? src.attr_color : undefined);
  for (const c of Array.isArray(src.color_palette_canonical) ? src.color_palette_canonical : []) add(String(c ?? ""));
  add(typeof src.color_primary_canonical === "string" ? src.color_primary_canonical : undefined);
  add(typeof src.color === "string" ? src.color : undefined);

  if (tokens.length === 0 && hasBadColorCode) {
    // Do not invent color from title/description text here: catalog brand text can
    // contain color words (e.g. brand names) and should not override structured color fields.
  }

  return { tokens, hasBadColorCode };
}

function normalizedCatalogTypeTokens(src: Record<string, unknown>): string[] {
  const rawTokens = [
    src.category,
    src.category_canonical,
    ...(Array.isArray(src.product_types) ? src.product_types : []),
  ]
    .filter((x) => x != null)
    .map((x) => String(x).toLowerCase().trim())
    .filter(Boolean);
  const out = new Set<string>();
  for (const token of rawTokens) {
    for (const t of extractLexicalProductTypeSeeds(token)) out.add(String(t).toLowerCase().trim());
    out.add(token);
  }
  return [...out].filter(Boolean);
}

function inferCatalogSleeveToken(src: Record<string, unknown>): "short" | "long" | "sleeveless" | null {
  const blob = [src.title, src.description, src.category, src.category_canonical]
    .filter((x) => x != null)
    .map((x) => String(x).toLowerCase())
    .join(" ");
  if (!blob.trim()) return null;
  if (/\b(sleeveless|tank|strapless|cami)\b/.test(blob)) return "sleeveless";
  if (/\b(short\s*sleeve|short-sleeve|short sleeve)\b/.test(blob)) return "short";
  if (/\b(long\s*sleeve|long-sleeve|long sleeve)\b/.test(blob)) return "long";
  return null;
}

function inferCatalogLengthToken(src: Record<string, unknown>): "mini" | "midi" | "maxi" | "long" | null {
  const blob = [src.title, src.description, src.category, src.category_canonical]
    .filter((x) => x != null)
    .map((x) => String(x).toLowerCase())
    .join(" ");
  if (!blob.trim()) return null;
  if (/\bmini\b/.test(blob)) return "mini";
  if (/\bmidi\b/.test(blob)) return "midi";
  if (/\bmaxi\b/.test(blob)) return "maxi";
  if (/\blong\b/.test(blob)) return "long";
  return null;
}

/**
 * When BLIP primary color is confident and contradicts indexed catalog colors,
 * dampen the color embedding channel (CLIP can still match lighting/layout).
 * Returns [0,1] multiplier applied to raw color cosine before fusion.
 */
function blipCatalogColorConflictFactor(
  signal: ImageSearchParams["blipSignal"],
  hit: { _source?: Record<string, unknown> },
): number {
  const primary = signal?.primaryColor?.trim();
  if (!primary) return 1;
  const conf = Math.max(0, Math.min(1, Number(signal?.confidence ?? 0)));
  if (conf < blipColorConflictMinConfidence()) return 1;
  const desired = normalizeColorToken(primary.toLowerCase()) ?? primary.toLowerCase();
  const docColors = docColorPaletteForHit(hit);
  if (docColors.length === 0) return 1;
  const t = tieredColorListCompliance([desired], docColors, "any");
  const match = Math.max(0, Math.min(1, t.compliance));
  const maxPen = blipColorConflictMaxPenalty();
  const penalty = 1 - match;
  return Math.max(0.35, 1 - conf * penalty * maxPen);
}

function colorConfidenceThreshold(): number {
  const raw = Number(process.env.SEARCH_IMAGE_ITEM_COLOR_CONF_MIN ?? "0.45");
  if (!Number.isFinite(raw)) return 0.45;
  return Math.max(0, Math.min(1, raw));
}

function collectConfidentColorTokenMap(params: {
  inferredPrimary?: string | null;
  inferredByItem?: Record<string, string | null>;
  inferredByItemConfidence?: Record<string, number>;
  preferredItemKey?: string | null;
  filtersRecord: Record<string, unknown>;
  mergedCategoryForRelevance?: string;
}): Map<string, number> {
  const scores = new Map<string, number>();
  const defaultItemColorConfidence = 0.62;
  const category = String(params.mergedCategoryForRelevance ?? "").toLowerCase().trim();
  const isBottomsLike = /\b(bottom|bottoms|pant|pants|trouser|trousers|jean|jeans|short|shorts|skirt|skirts|legging|leggings|cargo|chino|chinos)\b/.test(category);
  const isBagLike = /\b(bag|bags|wallet|wallets|purse|purses|handbag|handbags|tote|totes|backpack|backpacks|clutch|clutches|crossbody|satchel|satchels)\b/.test(category);
  const isFootwearLike = /\b(footwear|shoe|shoes|sneaker|sneakers|boot|boots|heel|heels|sandal|sandals|loafer|loafers|trainer|trainers|flat|flats)\b/.test(category);
  const isTopLike = /\b(top|tops|shirt|shirts|blouse|blouses|tee|t-?shirt|sweater|hoodie|cardigan|jacket|coat|blazer|outerwear)\b/.test(category);

  const add = (value: string | null | undefined, confidence: number) => {
    const x = String(value ?? "").toLowerCase().trim();
    if (!x) return;
    const norm = normalizeColorToken(x) ?? x;
    if (!norm) return;
    const next = Math.max(0, Math.min(1, confidence));
    scores.set(norm, Math.max(scores.get(norm) ?? 0, next));
  };

  const itemColors = params.inferredByItem ?? {};
  const itemConfs = params.inferredByItemConfidence ?? {};
  const preferredItemKey = String(params.preferredItemKey ?? "").trim();

  const accessoryKeyRe = /(shoe|sandal|sneaker|heel|boot|bag|wallet|hat|cap|belt|watch|ring|earring|necklace|bracelet|jewel|scarf)/i;
  const apparelKeyRe = /(trouser|pant|jean|skirt|dress|gown|top|shirt|blouse|sleeve|outwear|outerwear|jacket|coat|hoodie|sweater|cardigan|short|legging|romper|jumpsuit)/i;

  const keyConfidenceWeight = (key: string): number => {
    if (!key) return 1;
    if (isBagLike) {
      if (/(bag|wallet|purse|handbag|tote|backpack|clutch|crossbody|satchel)/i.test(key)) return 1.25;
      if (/(shoe|sandal|sneaker|heel|boot)/i.test(key)) return 0.55;
      if (apparelKeyRe.test(key)) return 0.65;
      return 1;
    }
    if (isBottomsLike) {
      if (/(trouser|pant|jean|skirt|short|legging|cargo|chino)/i.test(key)) return 1.25;
      if (/(top|shirt|blouse|sweater|hoodie|jacket|coat|blazer)/i.test(key)) return 0.6;
      return 1;
    }
    if (isFootwearLike) {
      if (/(shoe|sandal|sneaker|heel|boot|loafer|trainer|flat)/i.test(key)) return 1.3;
      if (apparelKeyRe.test(key)) return 0.45;
      if (/(bag|wallet|purse|handbag|tote|backpack|clutch|crossbody|satchel)/i.test(key)) return 0.6;
      return 1;
    }
    if (isTopLike) {
      if (/(top|shirt|blouse|tee|t-?shirt|sweater|hoodie|cardigan)/i.test(key)) return 1.2;
      if (/(trouser|pant|jean|skirt|short|legging|cargo|shoe|sandal|sneaker|bag|wallet)/i.test(key)) return 0.7;
      return 1;
    }
    return 1;
  };

  const hasConfidentApparelColor = Object.entries(itemColors).some(([key, value]) => {
    const rawConf = Number(itemConfs[key]);
    const conf = Number.isFinite(rawConf) ? rawConf : defaultItemColorConfidence;
    const norm = normalizeColorToken(String(value ?? "").toLowerCase().trim()) ?? String(value ?? "").toLowerCase().trim();
    return Boolean(norm) && conf >= colorConfidenceThreshold() && apparelKeyRe.test(key);
  });

  if (preferredItemKey && preferredItemKey in itemColors) {
    const rawConf = Number(itemConfs[preferredItemKey]);
    const conf = Number.isFinite(rawConf) ? rawConf : defaultItemColorConfidence;
    const rawValue = String(itemColors[preferredItemKey] ?? "").toLowerCase().trim();
    const norm = normalizeColorToken(rawValue) ?? rawValue;
    if (norm && conf >= colorConfidenceThreshold()) {
      add(norm, Math.min(1, conf * 1.12));
    }
  }

  // Full-image dominant color is noisy in multi-item scenes; trust it mainly when
  // confident item-level colors are unavailable.
  if (!hasConfidentApparelColor && !isBagLike && !isBottomsLike && !isFootwearLike) {
    add(params.inferredPrimary, 0.58);
  }

  for (const [key, value] of Object.entries(itemColors)) {
    const rawConf = Number(itemConfs[key]);
    let conf = Number.isFinite(rawConf) ? rawConf : defaultItemColorConfidence;
    conf *= keyConfidenceWeight(key);
    if (!isFootwearLike && hasConfidentApparelColor && accessoryKeyRe.test(key) && !apparelKeyRe.test(key)) {
      conf *= 0.72;
    }
    if (conf >= colorConfidenceThreshold()) {
      add(value, conf);
    }
  }

  const fp = (params.filtersRecord as { inferredPrimaryColor?: unknown }).inferredPrimaryColor;
  if (fp != null) add(String(fp), 0.45);

  const fi = (params.filtersRecord as { inferredColorsByItem?: Record<string, string | null> }).inferredColorsByItem;
  const fci = (params.filtersRecord as { inferredColorsByItemConfidence?: Record<string, number> }).inferredColorsByItemConfidence;
  if (fi && typeof fi === "object") {
    for (const [key, value] of Object.entries(fi)) {
      const rawConf = Number(fci?.[key]);
      let conf = Number.isFinite(rawConf) ? rawConf : defaultItemColorConfidence;
      conf *= keyConfidenceWeight(key);
      if (!isFootwearLike && hasConfidentApparelColor && accessoryKeyRe.test(key) && !apparelKeyRe.test(key)) {
        conf *= 0.72;
      }
      if (conf >= colorConfidenceThreshold()) {
        add(value, conf);
      }
    }
  }

  return scores;
}

function collectInferredColorTokens(
  filtersRecord: Record<string, unknown>,
  inferredPrimary?: string | null,
  inferredByItem?: Record<string, string | null>,
  inferredByItemConfidence?: Record<string, number>,
  preferredItemKey?: string | null,
  mergedCategoryForRelevance?: string,
  desiredProductTypes?: string[],
): string[] {
  const merged = String(mergedCategoryForRelevance ?? "").toLowerCase().trim();
  const typeText = (desiredProductTypes ?? []).join(" ").toLowerCase();
  const onePiece = /\b(dress|gown|jumpsuit|romper|playsuit)\b/.test(merged) || /\b(dress|gown|jumpsuit|romper|playsuit)\b/.test(typeText);
  const normalizedPrimary = normalizeColorToken(String(inferredPrimary ?? "").toLowerCase().trim()) ?? String(inferredPrimary ?? "").toLowerCase().trim();
  if (onePiece && normalizedPrimary) {
    return [normalizedPrimary];
  }

  const preferredKey = String(preferredItemKey ?? "").trim();
  if (preferredKey) {
    const preferredValue = String(inferredByItem?.[preferredKey] ?? "").toLowerCase().trim();
    const preferredColor = normalizeColorToken(preferredValue) ?? preferredValue;
    const preferredConf = Number(inferredByItemConfidence?.[preferredKey] ?? 0);
    if (preferredColor && preferredConf >= colorConfidenceThreshold()) {
      return [preferredColor];
    }
  }

  const scored = collectConfidentColorTokenMap({
    inferredPrimary,
    inferredByItem,
    inferredByItemConfidence,
    preferredItemKey,
    filtersRecord,
    mergedCategoryForRelevance: merged,
  });
  const top = [...scored.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top) return [top[0]];

  // Footwear often depends on crop-local color when caption/item-color signals are sparse.
  // Promote a sensible crop token so inferred-color postfilter can avoid cross-color leakage.
  const isFootwearLike =
    /\b(footwear|shoe|shoes|sneaker|sneakers|boot|boots|heel|heels|sandal|sandals|loafer|loafers|trainer|trainers|flat|flats)\b/.test(
      merged,
    ) ||
    /\b(footwear|shoe|shoes|sneaker|sneakers|boot|boots|heel|heels|sandal|sandals|loafer|loafers|trainer|trainers|flat|flats)\b/.test(
      typeText,
    );
  if (isFootwearLike) {
    const cropColors = Array.isArray(filtersRecord.cropDominantColors)
      ? filtersRecord.cropDominantColors
        .map((c: unknown) => {
          const raw = String(c ?? "").toLowerCase().trim();
          return normalizeColorToken(raw) ?? raw;
        })
        .filter(Boolean)
      : [];
    if (cropColors.length > 0) {
      let selected = cropColors[0];
      const alternatives = cropColors.slice(1);
      if (selected === "black" && alternatives.length > 0) {
        const lightNeutral = alternatives.find((c) =>
          ["white", "off-white", "cream", "ivory", "beige", "tan", "silver"].includes(c),
        );
        if (lightNeutral) selected = lightNeutral;
        else {
          const nonBlack = alternatives.find((c) => c !== "black");
          if (nonBlack) selected = nonBlack;
        }
      }
      if (selected) return [selected];
    }
  }

  return [];
}

function hasStrongSlotAnchoredInferredColor(params: {
  inferredByItem?: Record<string, string | null>;
  inferredByItemConfidence?: Record<string, number>;
  preferredItemKey?: string | null;
  mergedCategoryForRelevance?: string;
  desiredProductTypes?: string[];
}): boolean {
  const itemColors = params.inferredByItem ?? {};
  const itemConfs = params.inferredByItemConfidence ?? {};
  const preferredKey = String(params.preferredItemKey ?? "").trim();
  const minStrong = Math.max(colorConfidenceThreshold(), 0.82);

  if (preferredKey && preferredKey in itemColors) {
    const raw = String(itemColors[preferredKey] ?? "").toLowerCase().trim();
    const norm = normalizeColorToken(raw) ?? raw;
    const conf = Number(itemConfs[preferredKey] ?? 0);
    if (norm && Number.isFinite(conf) && conf >= minStrong) return true;
  }

  const merged = String(params.mergedCategoryForRelevance ?? "").toLowerCase().trim();
  const typeText = (params.desiredProductTypes ?? []).join(" ").toLowerCase();
  const keyRe =
    /\b(top|shirt|blouse|tee|t-?shirt|sweater|hoodie|cardigan|jacket|coat|trouser|pant|jean|skirt|dress|gown|outerwear|shoe|sneaker|boot|heel|sandal|bag|wallet|purse|handbag|tote|backpack|crossbody|satchel|clutch)\b/i;

  const categoryHint = (() => {
    if (/\b(top|shirt|blouse|tee|t-?shirt|sweater|hoodie|cardigan|jacket|coat|outerwear)\b/.test(`${merged} ${typeText}`)) {
      return /(top|shirt|blouse|tee|t-?shirt|sweater|hoodie|cardigan|jacket|coat|outerwear)/i;
    }
    if (/\b(trouser|pant|jean|skirt|dress|gown)\b/.test(`${merged} ${typeText}`)) {
      return /(trouser|pant|jean|skirt|dress|gown)/i;
    }
    if (/\b(shoe|sneaker|boot|heel|sandal|footwear)\b/.test(`${merged} ${typeText}`)) {
      return /(shoe|sneaker|boot|heel|sandal|footwear)/i;
    }
    if (/\b(bag|wallet|purse|handbag|tote|backpack|crossbody|satchel|clutch)\b/.test(`${merged} ${typeText}`)) {
      return /(bag|wallet|purse|handbag|tote|backpack|crossbody|satchel|clutch)/i;
    }
    return keyRe;
  })();

  for (const [key, value] of Object.entries(itemColors)) {
    if (!categoryHint.test(String(key))) continue;
    const raw = String(value ?? "").toLowerCase().trim();
    const norm = normalizeColorToken(raw) ?? raw;
    const confRaw = Number(itemConfs[key]);
    const conf = Number.isFinite(confRaw) ? confRaw : 0;
    if (norm && conf >= minStrong) return true;
  }
  return false;
}

function hasHighConfidenceDarkFootwearConsensus(params: {
  inferredByItem?: Record<string, string | null>;
  inferredByItemConfidence?: Record<string, number>;
}): boolean {
  const itemColors = params.inferredByItem ?? {};
  const itemConfs = params.inferredByItemConfidence ?? {};
  const footwearKeyRe = /(shoe|sandal|sneaker|heel|boot|loafer|trainer|flat|footwear)/i;
  const darkColorSet = new Set(["black", "charcoal", "gray", "dark gray"]);
  const defaultConfidence = 0.62;
  const minStrongConfidence = Math.max(colorConfidenceThreshold(), 0.74);

  const strongFootwearColors: string[] = [];
  for (const [key, value] of Object.entries(itemColors)) {
    if (!footwearKeyRe.test(String(key))) continue;
    const confRaw = Number(itemConfs[key]);
    const conf = Number.isFinite(confRaw) ? confRaw : defaultConfidence;
    if (conf < minStrongConfidence) continue;
    const raw = String(value ?? "").toLowerCase().trim();
    const norm = normalizeColorToken(raw) ?? raw;
    if (!norm) continue;
    strongFootwearColors.push(norm);
  }

  if (strongFootwearColors.length < 2) return false;
  return strongFootwearColors.every((c) => darkColorSet.has(String(c).toLowerCase()));
}

function shouldPreferInferredColorWhenConflict(params: {
  mergedCategoryForRelevance?: string;
  desiredProductTypes: string[];
  inferredPrimary?: string | null;
  inferredColorTokens: string[];
}): boolean {
  const merged = String(params.mergedCategoryForRelevance ?? "").toLowerCase().trim();
  const typeText = params.desiredProductTypes.join(" ").toLowerCase();
  const inferredPrimary = String(params.inferredPrimary ?? "").toLowerCase().trim();
  const hasGarmentInferredColor =
    inferredPrimary.length > 0 || (Array.isArray(params.inferredColorTokens) && params.inferredColorTokens.length > 0);
  if (!hasGarmentInferredColor) return false;

  // One-piece garments (especially dresses) are highly sensitive to lower-crop bleed
  // from shoes/background. Prefer semantic inferred color when conflict appears.
  if (/\b(dress|gown|jumpsuit|romper|playsuit)\b/.test(merged)) return true;
  if (/\b(dress|gown|jumpsuit|romper|playsuit)\b/.test(typeText)) return true;

  // Prefer inferred color only for upper-body / outerwear intents.
  // Full-image inference is less reliable for full-body garments such as dresses,
  // skirts, pants, and jumpsuits where crop-based color extraction is usually better.
  if (/\b(top|shirt|tee|t-?shirt|blouse|sweater|hoodie|jacket|coat|blazer|outerwear)\b/.test(merged)) return true;
  if (/\b(top|shirt|tee|t-?shirt|blouse|sweater|hoodie|jacket|coat|blazer|outerwear)\b/.test(typeText)) return true;

  return false;
}

function computeColorContradictionPenalty(params: {
  desiredColorsTier: string[];
  rerankColorMode: "any" | "all";
  hasExplicitColorIntent: boolean;
  hasInferredColorSignal: boolean;
  hasCropColorSignal: boolean;
  rawVisual: number;
  nearIdenticalRawMin: number;
  hit: { _source?: Record<string, unknown> };
}): number {
  if (!Array.isArray(params.desiredColorsTier) || params.desiredColorsTier.length === 0) return 1;

  const docColors = docColorPaletteForHit(params.hit);
  if (docColors.length === 0) return 1;

  const tier = tieredColorListCompliance(
    params.desiredColorsTier,
    docColors,
    params.rerankColorMode,
  );
  const bucketOnlyConflict = hasBucketOnlyColorConflict(
    params.desiredColorsTier,
    docColors,
    params.rerankColorMode,
  );
  if ((tier?.compliance ?? 0) > 0 && !bucketOnlyConflict) return 1;

  if (bucketOnlyConflict) {
    if (params.rawVisual >= params.nearIdenticalRawMin) {
      if (params.hasExplicitColorIntent) return 0.82;
      if (params.hasInferredColorSignal) return 0.88;
      if (params.hasCropColorSignal) return 0.92;
      return 0.94;
    }
    if (params.hasExplicitColorIntent) return 0.72;
    if (params.hasInferredColorSignal) return 0.8;
    if (params.hasCropColorSignal) return 0.86;
    return 0.9;
  }

  // Reduced color penalties: Instead of aggressive 0.72-0.82, use more lenient 0.85-0.90
  // This allows visually similar items with different colors to still be relevant
  // Color mismatch is handled at gating level, not scoring level
  if (params.rawVisual >= params.nearIdenticalRawMin) {
    if (params.hasExplicitColorIntent) return 0.88;  // Was 0.74: only 12% penalty for near-identical
    if (params.hasInferredColorSignal) return 0.92;  // Was 0.84: only 8% penalty
    if (params.hasCropColorSignal) return 0.95;      // Was 0.92: only 5% penalty
    return 1;
  }

  // For non-near-identical matches, color mismatch should still allow visibility
  // if there's strong visual similarity
  if (params.hasExplicitColorIntent) return 0.85;  // Was 0.72: 15% penalty instead of 28%
  if (params.hasInferredColorSignal) return 0.90;  // Was 0.82: 10% penalty instead of 18%
  if (params.hasCropColorSignal) return 0.93;      // Was 0.90: 7% penalty instead of 10%
  return 1;
}

function computeBatchCompositeInfluence(
  base: number,
  candidateCount: number,
  normalizedNorms: number[],
): number {
  const n = normalizedNorms.length;
  const spread = n > 1 ? Math.max(...normalizedNorms) - Math.min(...normalizedNorms) : 0;
  let f = 1;
  if (candidateCount < 8) f *= 0.45;
  else if (candidateCount < 20) f *= 0.7;
  if (spread < 0.08) f *= 0.35;
  else if (spread < 0.15) f *= 0.6;
  else if (spread < 0.25) f *= 0.85;
  return Math.max(0.02, Math.min(base, base * f));
}

function computeBlipAlignment(
  signal: ImageSearchParams["blipSignal"],
  hit: any,
): { matchScore: number; boost01: number } {
  if (!signal) return { matchScore: 0, boost01: 0 };
  const conf = Math.max(0, Math.min(1, Number(signal.confidence ?? 0)));
  if (conf <= 0) return { matchScore: 0, boost01: 0 };

  let matchScore = 0;
  const src = hit?._source ?? {};
  const productTypes = Array.isArray(src.product_types)
    ? src.product_types.map((t: unknown) => normalizeSimpleToken(t))
    : [];
  const productType = normalizeSimpleToken(signal.productType);
  const gender = normalizeSimpleToken(signal.gender);
  const age = normalizeSimpleToken(signal.ageGroup);
  const style = normalizeSimpleToken(signal.style);
  const material = normalizeSimpleToken(signal.material);
  const occasion = normalizeSimpleToken(signal.occasion);
  const pColor = normalizeSimpleToken(signal.primaryColor);
  const sColor = normalizeSimpleToken(signal.secondaryColor);

  // Explicit weighted components (sum = 1.0).
  const W_TYPE = 0.35;
  const W_COLOR = 0.22;
  const W_STYLE = 0.18;
  const W_AUDIENCE = 0.15;
  const W_MATERIAL = 0.06;
  const W_OCCASION = 0.04;

  if (productType) {
    if (productTypes.length > 0) {
      const t = scoreRerankProductTypeBreakdown([productType], productTypes);
      matchScore += W_TYPE * Math.max(0, Math.min(1, t.combinedTypeCompliance));
    } else {
      const docCategory = normalizeSimpleToken(src.category_canonical || src.category);
      if (docCategory && (docCategory.includes(productType) || productType.includes(docCategory))) {
        matchScore += W_TYPE * 0.45;
      }
    }
  }
  const docGender = normalizeSimpleToken(src.audience_gender || src.attr_gender);
  if (gender && docGender && (docGender === gender || docGender === "unisex")) matchScore += W_AUDIENCE * 0.65;
  if (age && normalizeSimpleToken(src.age_group) === age) matchScore += W_AUDIENCE * 0.35;

  const docColorsRaw = [
    normalizeSimpleToken(src.attr_color),
    ...(Array.isArray(src.attr_colors) ? src.attr_colors.map((c: unknown) => normalizeSimpleToken(c)) : []),
    ...(Array.isArray(src.color_palette_canonical)
      ? src.color_palette_canonical.map((c: unknown) => normalizeSimpleToken(c))
      : []),
  ].filter(Boolean);
  const docColors = [...new Set(docColorsRaw.map((c) => normalizeColorToken(c) ?? c))];
  const pColorNorm = normalizeColorToken(pColor) ?? pColor;
  const sColorNorm = normalizeColorToken(sColor) ?? sColor;
  if (pColorNorm && docColors.includes(pColorNorm)) matchScore += W_COLOR * 0.75;
  if (sColorNorm && docColors.includes(sColorNorm)) matchScore += W_COLOR * 0.25;

  const docStyle = normalizeSimpleToken(src.attr_style);
  if (style && docStyle && (docStyle === style || docStyle.includes(style) || style.includes(docStyle))) {
    matchScore += W_STYLE;
  }
  if (material && normalizeSimpleToken(src.attr_material) === material) matchScore += W_MATERIAL;
  if (occasion && normalizeSimpleToken(src.attr_occasion) === occasion) matchScore += W_OCCASION;

  matchScore = Math.max(0, Math.min(1, matchScore));
  const boost01 =
    Math.max(0, Math.min(1, imageBlipAlignmentWeight())) *
    Math.max(0, Math.min(1, imageBlipAlignmentMaxBoost())) *
    conf *
    matchScore;
  return { matchScore, boost01 };
}

/**
 * Raw CLIP cosine (exact when SEARCH_IMAGE_EXACT_COSINE_RERANK=1) at/above this → treat as a near-duplicate:
 * visual gate + sort + composite use **raw** cosine (not merchandise-bound), and `finalRelevance01` is floored.
 * Stops aisle/YOLO/type binding from hiding the same catalog photo. Disable: SEARCH_IMAGE_NEAR_IDENTICAL_RAW_MIN=0
 */
function imageSearchNearIdenticalRawCosineMin(): number {
  const raw = process.env.SEARCH_IMAGE_NEAR_IDENTICAL_RAW_MIN;
  if (raw === undefined || String(raw).trim() === "") return 0.93;
  const s = String(raw).toLowerCase().trim();
  if (s === "0" || s === "off" || s === "false") return Number.POSITIVE_INFINITY;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0.87;
  return Math.max(0.55, Math.min(0.999, n));
}

function imageKnnTimeoutMs(detectionScoped = false): number {
  const scopedEnv = Number(process.env.SEARCH_IMAGE_KNN_TIMEOUT_MS_DETECTION);
  if (detectionScoped && Number.isFinite(scopedEnv) && scopedEnv >= 500) {
    return Math.min(120_000, Math.floor(scopedEnv));
  }
  const raw = Number(process.env.SEARCH_IMAGE_KNN_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw >= 500) return Math.min(120_000, Math.floor(raw));
  return detectionScoped ? 8_000 : 12_000;
}

/**
 * Recompute cosine(query, doc_vector) in-app for kNN hits. HNSW/ANN ordering is approximate;
 * exact dot products fix ranking within the retrieved set (helps self-search and near-duplicates).
 * Disable with SEARCH_IMAGE_EXACT_COSINE_RERANK=0.
 */
function imageExactCosineRerankEnabled(): boolean {
  const v = String(process.env.SEARCH_IMAGE_EXACT_COSINE_RERANK ?? "1").toLowerCase();
  return v !== "0" && v !== "false";
}

async function opensearchImageKnnHits(
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<any[]> {
  const startedAt = Date.now();
  // This cluster rejects per-query `ef_search`; sanitize every request to keep
  // the primary pipeline stable and avoid fail-then-retry behavior.
  const bodyToSend = stripEfSearchFromKnnBody(body);

  const boolQ = (bodyToSend as any)?.query?.bool;
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
        body: bodyToSend as any,
        timeout: `${Math.max(1, Math.ceil(timeoutMs / 1000))}s`,
      },
      {
        requestTimeout: timeoutMs,
        // Avoid transport-level retries multiplying latency for kNN under load.
        maxRetries: 0,
      },
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
    const errText = String(err?.message ?? "");
    const responseReason = String(err?.meta?.body?.error?.reason ?? "");
    const unknownEfSearch =
      errText.includes("unknown field [ef_search]") || responseReason.includes("unknown field [ef_search]");

    if (unknownEfSearch) {
      imageKnnEfSearchSupported = false;
      process.env.SEARCH_IMAGE_EF_SEARCH = "0";
      const retryBody = stripEfSearchFromKnnBody(bodyToSend);

      try {
        const r = await osClient.search(
          {
            index: config.opensearch.index,
            body: retryBody as any,
            timeout: `${Math.max(1, Math.ceil(timeoutMs / 1000))}s`,
          },
          {
            requestTimeout: timeoutMs,
            maxRetries: 0,
          },
        );
        const hits = (r.body?.hits?.hits ?? []) as any[];
        if (process.env.NODE_ENV !== "production") {
          console.warn("[image-knn] retrying without ef_search succeeded", {
            index: config.opensearch.index,
            field: knnField ?? null,
            vectorLength: queryVector?.length ?? null,
            hits: hits.length,
            elapsedMs: Date.now() - startedAt,
            took: r.body?.took ?? null,
          });
        }
        return hits;
      } catch {
        // Fall through to the standard error logging below.
      }
    }

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

function normalizeImageCategoryIntent(raw: unknown): string {
  const s = String(raw ?? "")
    .toLowerCase()
    .trim()
    .replace(/[\s_-]+/g, " ");
  if (!s) return "";
  if (/\b(dreses|drsses|dresss|dress|dresses|gown|gowns|frock|frocks)\b/.test(s)) return "dresses";
  return s;
}

function normalizeImageCategoryIntentArray(values: string[]): string[] {
  return [...new Set(values.map((v) => normalizeImageCategoryIntent(v)).filter(Boolean))];
}

function categoryFilterTermsWithAliases(input: string | string[]): string[] {
  const raw = Array.isArray(input) ? input : [input];
  const out = new Set<string>();
  for (const item of raw) {
    const source = String(item ?? "").toLowerCase().trim();
    if (!source) continue;
    out.add(source);
    // Expand alias families so detection-scoped hard terms (e.g. "sneaker")
    // still match catalogs indexed with canonical buckets (e.g. "footwear").
    for (const alias of getCategorySearchTerms(source)) {
      const aliasNorm = String(alias ?? "").toLowerCase().trim();
      if (aliasNorm) out.add(aliasNorm);
    }
    const normalized = normalizeImageCategoryIntent(source);
    if (normalized) out.add(normalized);
    if (normalized && normalized !== source && normalized === "dresses") {
      out.add("dress");
    }
  }
  return [...out];
}

function buildHardCategoryFilterClause(input: string | string[]): Record<string, unknown> | null {
  const terms = categoryFilterTermsWithAliases(input);
  if (terms.length === 0) return null;
  return {
    bool: {
      should: [
        { terms: { category: terms } },
        { terms: { category_canonical: terms } },
        { terms: { product_types: terms } },
      ],
      minimum_should_match: 1,
    },
  };
}

function buildDesiredCatalogTermSet(aisles: string[]): Set<string> {
  const s = new Set<string>();
  for (const a of aisles) {
    const normalized = normalizeImageCategoryIntent(a);
    const candidates = [a, normalized].filter(Boolean);
    for (const candidate of candidates) {
      for (const t of getCategorySearchTerms(candidate)) {
        s.add(t.toLowerCase());
      }
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
    filters: baseFilters = {},
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
    softProductTypeHints: softProductTypeHintsParam,
    blipSignal,
    inferredPrimaryColor: inferredPrimaryFromParams,
    inferredColorsByItem: inferredByItemFromParams,
    debugRawCosineFirst = false,
    sessionId,
    userId,
    sessionFilters: sessionFiltersFromParams,
    collapseVariantGroups: collapseVariantGroupsRequested = true,
  } = params;

  if (!imageEmbedding || imageEmbedding.length === 0) {
    return { results: [], meta: { threshold: similarityThreshold, total_results: 0 } };
  }

  const evalT0 = Date.now();
  const breakdownDebug =
    String(process.env.SEARCH_DEBUG ?? "").toLowerCase() === "1" ||
    String(process.env.SEARCH_TRACE_BREAKDOWN ?? "").toLowerCase() === "1";

  const filters = mergeSessionFilters(
    baseFilters,
    sessionFiltersFromParams ?? (sessionId ? (getSession(sessionId).accumulatedFilters as Record<string, unknown>) : null),
  );
  const personalizationPromise = loadUserLifestyleSnapshot(userId);
  const personalizationApplied = Boolean(
    sessionId ||
    userId ||
    (sessionFiltersFromParams && Object.keys(sessionFiltersFromParams).length > 0),
  );

  const detectionScoped =
    typeof params.detectionProductCategory === "string" &&
    params.detectionProductCategory.trim().length > 0;

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
  // Use must_not is_hidden:true so docs **without** the field still match (term:false excludes missing).
  const filter: any[] = [
    { bool: { must_not: [{ term: { is_hidden: true } }] } },
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
      const clause = buildHardCategoryFilterClause(cat);
      if (clause) filter.push(clause);
    }
  }
  if (filters.brand) filter.push({ term: { brand: String(filters.brand).toLowerCase() } });
  if (filters.vendorId) filter.push({ term: { vendor_id: String(filters.vendorId) } });
  if (Array.isArray((filters as { productTypes?: string[] }).productTypes)) {
    const productTypeTerms = ((filters as { productTypes?: string[] }).productTypes ?? [])
      .map((t) => String(t).toLowerCase().trim())
      .filter(Boolean);
    if (productTypeTerms.length > 0 && !detectionScoped) {
      // Root fix: detection-derived product types are noisy and can zero-out KNN retrieval.
      // Keep hard type filters for non-detection image search, but not for per-detection stage.
      filter.push({ terms: { product_types: productTypeTerms } });
    }
  }
  const filtersAny = filters as { gender?: string; color?: string; softColor?: string; style?: string; softStyle?: string };
  const queryGenderNormForPost = normalizeQueryGender(filtersAny.gender);
  const visualPrimaryBroad = isBroadImageSearchVisualPrimaryRanking(filters, imageSearchTextQuery);
  if (filtersAny.gender && !detectionScoped) {
    const rawGender = String(filtersAny.gender).toLowerCase().trim();
    const g = normalizeQueryGender(rawGender) ?? rawGender;
    const normalizedAgeGroup = normalizeAudienceAgeGroupValue((filters as { ageGroup?: string }).ageGroup);
    const kidsAudienceIntent = normalizedAgeGroup === "kids" || hasKidsAudienceToken(rawGender);
    // For image-search we need to be resilient to occasional index attribute mistakes.
    // We therefore:
    // - allow either `attr_gender` match OR title keyword match for the desired gender
    // - but explicitly exclude the opposite gender keyword in title.
    const titleGenderShould =
      g === "women"
        ? kidsAudienceIntent
          ? ["girls", "girl", "women", "womens", "female", "ladies", "woman"]
          : ["women", "womens", "female", "ladies", "woman"]
        : g === "men"
          ? kidsAudienceIntent
            ? ["boys", "boy", "men", "mens", "male", "man"]
            : ["men", "mens", "male", "man"]
          : ["unisex"];

    const titleOppShould =
      g === "women"
        ? kidsAudienceIntent
          ? ["men", "mens", "male", "boy", "boys", "man", "gents", "gentlemen"]
          : ["men", "mens", "male", "boy", "boys", "man", "kid", "kids", "youth", "toddler", "baby"]
        : g === "men"
          ? kidsAudienceIntent
            ? ["women", "womens", "female", "ladies", "woman", "girls", "girl"]
            : ["women", "womens", "female", "ladies", "woman", "girls", "girl", "boy", "boys", "kid", "kids", "youth", "toddler", "baby"]
          : [];

    const genderVariants = attrGenderFilterClause(g).terms.attr_gender;
    const shouldClauses: any[] = [
      { terms: { attr_gender: genderVariants } },
      { terms: { audience_gender: genderVariants } },
      {
        bool: {
          must_not: [{ exists: { field: "attr_gender" } }, { exists: { field: "audience_gender" } }],
        },
      },
    ];
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
  {
    const normalizedAgeGroup = normalizeAudienceAgeGroupValue((filters as { ageGroup?: string }).ageGroup);
    if (normalizedAgeGroup === "kids" && !detectionScoped) {
      filter.push({
        bool: {
          should: [
            { terms: { age_group: ["kids", "kid", "children", "child", "youth", "junior", "toddler", "baby"] } },
            { match: { title: "kids" } },
            { match: { title: "children" } },
            { match: { title: "boys" } },
            { match: { title: "girls" } },
            { match: { title: "baby" } },
            { match: { title: "toddler" } },
            { match: { title: "junior" } },
            { match: { title: "youth" } },
          ],
          minimum_should_match: 1,
        },
      });
    }
  }
  if (filtersAny.style && !detectionScoped) {
    const s = String(filtersAny.style).toLowerCase();
    if (s.length > 0) filter.push({ term: { attr_style: s } });
  }
  if (filtersAny.color && !detectionScoped) {
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

  // Relaxed KNN filter used only for sparse detection retrieval fallback.
  // Keep hard category constraints while dropping restrictive metadata clauses.
  const relaxedKnnFilter: any[] = [
    { bool: { must_not: [{ term: { is_hidden: true } }] } },
    {
      bool: {
        must_not: [
          { terms: { category: ["candles & holders", "pots & plants", "home decor"] } },
        ],
      },
    },
  ];
  if (cat && !detectionScoped) {
    const hardCategoryOnly = buildHardCategoryFilterClause(cat);
    if (hardCategoryOnly) relaxedKnnFilter.push(hardCategoryOnly);
  }

  /** kNN size — wider when SEARCH_IMAGE_MERCHANDISE_SIMILARITY is on (see imageSearchKnnPoolLimit). */
  const retrievalKBase = imageCategoryAwareKnnPoolLimit(params.detectionProductCategory);
  const retrievalK = detectionScoped
    ? Math.min(retrievalKBase, imageDetectionKnnPoolCap())
    : retrievalKBase;

  let colorQueryEmbedding: number[] | null = null;
  let textureQueryEmbedding: number[] | null = null;
  let materialQueryEmbedding: number[] | null = null;
  let styleQueryEmbedding: number[] | null = null;
  let patternQueryEmbedding: number[] | null = null;
  let partQueryEmbeddings: Record<string, number[] | null> = {};
  // Kick off expensive query-signal extraction in parallel with first kNN retrieval.
  // We only block on this promise right before rerank/compliance stages need it.
  const signalsPromise =
    imageBuffer && Buffer.isBuffer(imageBuffer) && imageBuffer.length > 0
      ? getCachedImageQuerySignals(imageBuffer)
      : Promise.resolve<ImageQuerySignals>({
        colorQueryEmbedding: null,
        textureQueryEmbedding: null,
        materialQueryEmbedding: null,
        styleQueryEmbedding: null,
        patternQueryEmbedding: null,
        partQueryEmbeddings: {},
      });

  let runColor = false;
  let runTexture = false;
  let runMaterial = false;
  let runStyle = false;
  let runPattern = false;

  const baseImageKnnSourceFields = [
    "product_id",
    "title",
    "brand",
    "category",
    "category_canonical",
    "product_types",
    "color",
    "attr_gender",
    "attr_color",
    "attr_colors",
    "attr_style",
    "attr_material",
    "attr_occasion",
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
    "embedding_score_version",
    "embedding_garment_score_version",
    "embedding_color",
    "embedding_texture",
    "embedding_material",
    "embedding_style",
    "embedding_pattern",
    "embedding_part_sleeve",
    "embedding_part_neckline",
    "embedding_part_hem",
    "embedding_part_waistline",
    "embedding_part_heel",
    "embedding_part_toe",
    "embedding_part_bag_handle",
    "embedding_part_bag_body",
    "embedding_part_pattern_patch",
  ];

  let garmentQueryVector: number[] | null = null;
  if (imageEmbeddingGarment && imageEmbeddingGarment.length === imageEmbedding.length) {
    garmentQueryVector = imageEmbeddingGarment;
  } else if (imageBuffer && Buffer.isBuffer(imageBuffer) && imageBuffer.length > 0) {
    try {
      const { computeImageSearchGarmentQueryEmbedding } = await import("../../lib/image");
      const out = await computeImageSearchGarmentQueryEmbedding(imageBuffer);
      if (out?.length === imageEmbedding.length) garmentQueryVector = out;
    } catch {
      garmentQueryVector = null;
    }
  }

  const dualKnnEligible =
    garmentQueryVector !== null &&
    garmentQueryVector.length === imageEmbedding.length;
  const useDualKnn =
    dualKnnEligible &&
    (detectionScoped ? imageDualKnnDetectionEnabled() : imageDualKnnFusionEnabled());

  const ef = imageKnnEfSearch();
  const knnTimeoutMs = imageKnnTimeoutMs(detectionScoped);

  let knnFieldResolved: string;
  let hits: any[];
  /** Query vector for the active single kNN field (dual fusion uses global + garment separately). */
  let queryVector: number[] = imageEmbedding;

  if (useDualKnn) {
    knnFieldResolved = "embedding+embedding_garment";
    const bodyGlobal = {
      size: retrievalK,
      _source: [...baseImageKnnSourceFields, "embedding", "embedding_garment"],
      query: {
        bool: {
          must: {
            knn: {
              embedding: knnQueryInner(imageEmbedding, retrievalK, ef),
            },
          },
          filter,
        },
      },
    };
    const bodyGarment = {
      size: retrievalK,
      _source: [...baseImageKnnSourceFields, "embedding", "embedding_garment"],
      query: {
        bool: {
          must: {
            knn: {
              embedding_garment: knnQueryInner(garmentQueryVector!, retrievalK, ef),
            },
          },
          filter,
        },
      },
    };
    const [hg, hgr] = await Promise.all([
      opensearchImageKnnHits(bodyGlobal, knnTimeoutMs),
      opensearchImageKnnHits(bodyGarment, knnTimeoutMs),
    ]);
    hits = mergeDualKnnHitsForImageSearch(hg, hgr, imageEmbedding, garmentQueryVector!);
  } else {
    knnFieldResolved = resolveImageSearchKnnField(knnFieldParam);
    queryVector = imageEmbedding;
    if (knnFieldResolved === "embedding_garment") {
      if (garmentQueryVector) {
        queryVector = garmentQueryVector;
      } else {
        knnFieldResolved = "embedding";
        queryVector = imageEmbedding;
        if (breakdownDebug) {
          console.warn(
            "[image-knn] embedding_garment vector missing; using embedding field + global query vector",
          );
        }
      }
    }

    const knnBody = {
      size: retrievalK,
      _source: [
        ...baseImageKnnSourceFields,
        ...(imageExactCosineRerankEnabled() ? [knnFieldResolved] : []),
      ],
      query: {
        bool: {
          must: {
            knn: {
              [knnFieldResolved]: knnQueryInner(queryVector, retrievalK, ef),
            },
          },
          filter,
        },
      },
    };

    if (knnFieldResolved === "embedding_garment") {
      // Run garment + global fallback in parallel.
      // Root recall fix: for detection-scoped queries, garment vectors can be sparse for some
      // categories (notably tops/bottoms). If we only switch on zero hits, main-path recall
      // collapses. Merge in global embedding candidates when garment recall is too low.
      const knnBodyEmbeddingFallback = {
        size: retrievalK,
        _source: [
          ...baseImageKnnSourceFields,
          ...(imageExactCosineRerankEnabled() ? ["embedding"] : []),
        ],
        query: {
          bool: {
            must: {
              knn: {
                embedding: knnQueryInner(imageEmbedding, retrievalK, ef),
              },
            },
            filter,
          },
        },
      };
      const [garmentHits, embeddingHits] = await Promise.all([
        opensearchImageKnnHits(knnBody, knnTimeoutMs),
        opensearchImageKnnHits(knnBodyEmbeddingFallback, knnTimeoutMs),
      ]);
      const garmentCount = Array.isArray(garmentHits) ? garmentHits.length : 0;
      const embeddingCount = Array.isArray(embeddingHits) ? embeddingHits.length : 0;
      const detectionCategoryNorm = String(params.detectionProductCategory ?? "").toLowerCase().trim();
      const isTopBottomDetection =
        detectionCategoryNorm === "tops" || detectionCategoryNorm === "bottoms";
      const lowRecallFloor = detectionScoped
        ? isTopBottomDetection
          ? Math.max(36, Math.min(140, Math.floor(retrievalK * 0.24)))
          : Math.max(24, Math.min(96, Math.floor(retrievalK * 0.18)))
        : 0;
      const detectionApparelCategory =
        detectionCategoryNorm === "tops" ||
        detectionCategoryNorm === "bottoms" ||
        detectionCategoryNorm === "dresses" ||
        detectionCategoryNorm === "outerwear";
      if (garmentCount > 0) {
        const shouldMergeEmbeddingFallback =
          detectionScoped &&
          embeddingCount > 0 &&
          (
            garmentCount < lowRecallFloor ||
            (
              detectionApparelCategory &&
              !isTopBottomDetection &&
              embeddingCount >= Math.max(12, Math.floor(garmentCount * 0.35))
            )
          );

        if (shouldMergeEmbeddingFallback) {
          hits = mergeKnnHitsByProductId(garmentHits, embeddingHits, retrievalK);
          if (breakdownDebug) {
            console.warn("[image-knn] low garment recall; merged embedding fallback", {
              garmentCount,
              embeddingCount,
              lowRecallFloor,
              detectionCategoryNorm,
              isTopBottomDetection,
              mergedCount: hits.length,
            });
          }
        } else {
          hits = garmentHits;
        }
      } else {
        if (breakdownDebug) {
          console.warn(
            "[image-knn] embedding_garment returned no hits; using parallel embedding fallback",
          );
        }
        knnFieldResolved = "embedding";
        queryVector = imageEmbedding;
        hits = embeddingHits;
      }
    } else {
      hits = await opensearchImageKnnHits(knnBody, knnTimeoutMs);
    }

    if (imageExactCosineRerankEnabled() && Array.isArray(hits)) {
      for (const hit of hits) {
        const docVec = asFloatVector(hit?._source?.[knnFieldResolved], queryVector.length);
        if (docVec) {
          (hit as any)._exactCosineRaw = cosineSimilarityRaw(queryVector, docVec);
          (hit as any)._exactCosine01 = normalizeTo01ByVersion((hit as any)._exactCosineRaw, "v2");
        }
      }
    }
  }

  if (useDualKnn && (!Array.isArray(hits) || hits.length === 0)) {
    if (breakdownDebug) {
      console.warn("[image-knn] dual kNN returned no hits; falling back to single-field kNN");
    }
    knnFieldResolved = resolveImageSearchKnnField(knnFieldParam);
    queryVector = imageEmbedding;
    if (knnFieldResolved === "embedding_garment") {
      if (garmentQueryVector) {
        queryVector = garmentQueryVector;
      } else {
        knnFieldResolved = "embedding";
        queryVector = imageEmbedding;
      }
    }
    const knnBodyFallback = {
      size: retrievalK,
      _source: [
        ...baseImageKnnSourceFields,
        ...(imageExactCosineRerankEnabled() ? [knnFieldResolved] : []),
      ],
      query: {
        bool: {
          must: {
            knn: {
              [knnFieldResolved]: knnQueryInner(queryVector, retrievalK, imageKnnEfSearch()),
            },
          },
          filter,
        },
      },
    };
    hits = await opensearchImageKnnHits(knnBodyFallback, knnTimeoutMs);
    if (imageExactCosineRerankEnabled() && Array.isArray(hits)) {
      for (const hit of hits) {
        const docVec = asFloatVector(hit?._source?.[knnFieldResolved], queryVector.length);
        if (docVec) {
          (hit as any)._exactCosineRaw = cosineSimilarityRaw(queryVector, docVec);
          (hit as any)._exactCosine01 = normalizeTo01ByVersion((hit as any)._exactCosineRaw, "v2");
        }
      }
    }
  }

  // KNN sparse-recall fallback: when strict detection filters over-prune ANN candidates,
  // run one additional retrieval with category-safe relaxed filters and merge by product id.
  const sparseKnnMinHits = detectionScoped ? Math.min(retrievalK, Math.max(limit * 2, 24)) : 0;
  const sparseKnnDetected =
    detectionScoped &&
    Array.isArray(hits) &&
    (hits.length === 0 || hits.length < sparseKnnMinHits / 2);

  if (sparseKnnDetected && relaxedKnnFilter.length > 0) {
    const relaxedTimeoutMs = Math.min(12000, Math.max(knnTimeoutMs, 8000));
    let relaxedHits: any[] = [];

    if (useDualKnn && dualKnnEligible) {
      const bodyGlobalRelaxed = {
        size: retrievalK,
        _source: [...baseImageKnnSourceFields, "embedding", "embedding_garment"],
        query: {
          bool: {
            must: {
              knn: {
                embedding: knnQueryInner(imageEmbedding, retrievalK, ef),
              },
            },
            filter: relaxedKnnFilter,
          },
        },
      };
      const bodyGarmentRelaxed = {
        size: retrievalK,
        _source: [...baseImageKnnSourceFields, "embedding", "embedding_garment"],
        query: {
          bool: {
            must: {
              knn: {
                embedding_garment: knnQueryInner(garmentQueryVector!, retrievalK, ef),
              },
            },
            filter: relaxedKnnFilter,
          },
        },
      };
      const [hgRelaxed, hgrRelaxed] = await Promise.all([
        opensearchImageKnnHits(bodyGlobalRelaxed, relaxedTimeoutMs),
        opensearchImageKnnHits(bodyGarmentRelaxed, relaxedTimeoutMs),
      ]);
      relaxedHits = mergeDualKnnHitsForImageSearch(hgRelaxed, hgrRelaxed, imageEmbedding, garmentQueryVector!);
    } else {
      const relaxedBody = {
        size: retrievalK,
        _source: [
          ...baseImageKnnSourceFields,
          ...(imageExactCosineRerankEnabled() ? [knnFieldResolved] : []),
        ],
        query: {
          bool: {
            must: {
              knn: {
                [knnFieldResolved]: knnQueryInner(queryVector, retrievalK, ef),
              },
            },
            filter: relaxedKnnFilter,
          },
        },
      };
      relaxedHits = await opensearchImageKnnHits(relaxedBody, relaxedTimeoutMs);
    }

    if (Array.isArray(relaxedHits) && relaxedHits.length > 0) {
      const beforeCount = Array.isArray(hits) ? hits.length : 0;
      hits = mergeKnnHitsByProductId(Array.isArray(hits) ? hits : [], relaxedHits, retrievalK);
      if (breakdownDebug) {
        console.log("[image-knn][sparse-fallback]", {
          detectionScoped,
          before: beforeCount,
          relaxed: relaxedHits.length,
          afterMerge: hits.length,
          sparseKnnMinHits,
        });
      }
    }
  }

  const signals = await signalsPromise;
  colorQueryEmbedding = signals.colorQueryEmbedding;
  textureQueryEmbedding = signals.textureQueryEmbedding;
  materialQueryEmbedding = signals.materialQueryEmbedding;
  styleQueryEmbedding = signals.styleQueryEmbedding;
  patternQueryEmbedding = signals.patternQueryEmbedding;
  partQueryEmbeddings = signals.partQueryEmbeddings;
  runColor = Boolean(colorQueryEmbedding && colorQueryEmbedding.length > 0);
  runTexture = Boolean(textureQueryEmbedding && textureQueryEmbedding.length > 0);
  runMaterial = Boolean(materialQueryEmbedding && materialQueryEmbedding.length > 0);
  runStyle = Boolean(styleQueryEmbedding && styleQueryEmbedding.length > 0);
  runPattern = Boolean(patternQueryEmbedding && patternQueryEmbedding.length > 0);

  const exactCosineRerank = imageExactCosineRerankEnabled();

  // ────────────────────────────────────────────────────────────────────────────
  // PART SIMILARITY COMPUTATION (Phase 1)
  // ────────────────────────────────────────────────────────────────────────────
  // For each retrieved hit, compute similarities against query part embeddings
  const partSimByDocId = new Map<string, Record<string, number>>();
  const hasQueryPartEmbeddings = Object.keys(partQueryEmbeddings).some(
    (key) => partQueryEmbeddings[key] && Array.isArray(partQueryEmbeddings[key]) && partQueryEmbeddings[key]!.length > 0
  );

  if (hasQueryPartEmbeddings && Array.isArray(hits) && hits.length > 0) {
    try {
      const { cosineSimilarity } = await import("../../lib/image/clip");

      for (const hit of hits) {
        const partSims: Record<string, number> = {};
        const productId = String(hit?._source?.product_id ?? "");

        if (!productId) continue;

        // For each part type with a query embedding
        for (const [partType, queryPartVec] of Object.entries(partQueryEmbeddings)) {
          if (!queryPartVec || !Array.isArray(queryPartVec) || queryPartVec.length === 0) {
            partSims[partType] = 0;
            continue;
          }

          // Try to get the corresponding document part vector
          const docPartField = `embedding_part_${partType}`;
          const docPartVec = asFloatVector(hit?._source?.[docPartField], queryPartVec.length);

          if (docPartVec) {
            // Compute cosine similarity between query and document part vectors
            try {
              const rawSim = cosineSimilarity(queryPartVec, docPartVec);
              partSims[partType] = normalizeTo01ByVersion(rawSim, "v2");
            } catch {
              partSims[partType] = 0;
            }
          } else {
            partSims[partType] = 0;
          }
        }

        partSimByDocId.set(productId, partSims);
      }
    } catch (err) {
      console.warn("[image-search] part similarity computation failed", {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const visualSimFromHit = (hit: any): number => {
    if (typeof hit?._exactCosineRaw === "number") {
      return normalizeTo01ByVersion(Number(hit._exactCosineRaw), "v2");
    }
    if (typeof hit?._exactCosine01 === "number") {
      return Math.max(0, Math.min(1, Number(hit._exactCosine01)));
    }
    const versionField =
      knnFieldResolved === "embedding_garment"
        ? String(hit?._source?.embedding_garment_score_version ?? "v1")
        : String(hit?._source?.embedding_score_version ?? "v1");
    const version: ScoreVersion = versionField === "v2" ? "v2" : "v1";
    return normalizeTo01ByVersion(Number(hit?._score), version);
  };

  const rawOpenSearchHitCount = Array.isArray(hits) ? hits.length : 0;

  const rawCosineDebugAllowed =
    debugRawCosineFirst &&
    String(process.env.NODE_ENV ?? "").toLowerCase() !== "production" &&
    String(process.env.SEARCH_ENABLE_DEBUG_RAW_BRANCH ?? "").toLowerCase() === "1";
  if (rawCosineDebugAllowed) {
    const orderedRaw = [...hits]
      .map((h: any) => ({ hit: h, sim: visualSimFromHit(h) }))
      .sort((a, b) => b.sim - a.sim);

    const topRaw = orderedRaw.slice(0, Math.max(1, Math.min(limit, orderedRaw.length)));
    const productIds = topRaw.map((x) => String(x.hit?._source?.product_id ?? "")).filter(Boolean);
    const scoreMap = new Map<string, number>(
      topRaw.map((x) => [String(x.hit?._source?.product_id ?? ""), Math.max(0, Math.min(1, x.sim))]),
    );

    let results: ProductResult[] = [];
    if (productIds.length > 0) {
      const products = await getProductsByIdsOrdered(productIds);
      const numericIds = productIds.map((id) => parseInt(id, 10)).filter(Number.isFinite);
      const imagesByProduct = await getImagesForProducts(numericIds);

      results = products.map((p: any) => {
        const images: ProductImage[] = imagesByProduct.get(parseInt(p.id, 10)) || [];
        const sim = scoreMap.get(String(p.id)) ?? 0;
        return {
          ...p,
          similarity_score: Math.round(sim * 100) / 100,
          match_type: sim >= config.clip.matchTypeExactMin ? ("exact" as const) : ("similar" as const),
          rerankScore: undefined,
          finalRelevance01: sim,
          explain: {
            clipCosine: sim,
            merchandiseSimilarity: sim,
            catalogAlignment: 1,
            finalRelevance01: sim,
            finalRelevanceSource: "raw_debug_bypass",
          },
          images: images.map((img) => ({
            id: img.id,
            url: img.cdn_url,
            is_primary: img.is_primary,
            p_hash: img.p_hash ?? undefined,
          })),
        } as ProductResult;
      });
    }

    results = (dedupeImageSearchResults(results as any) as ProductResult[]).slice(0, limit);

    let related: ProductResult[] = [];
    if (includeRelated && pHash) {
      const excludeIds = results.map((p) => String(p.id));
      related = await findSimilarByPHash(pHash, excludeIds, limit);
      related = (filterRelatedAgainstMain(results as any, related as any, { imageSearch: true }) ?? []) as ProductResult[];
    }

    return {
      results,
      ...(related.length > 0 ? { related } : {}),
      meta: {
        threshold: similarityThreshold,
        total_results: results.length,
        image_knn_field: knnFieldResolved,
        debug_raw_cosine_bypass_used: true,
      },
    };
  }

  const aisleSoftWeightBase = Math.max(
    0,
    Math.min(400, Number(process.env.SEARCH_IMAGE_AISLE_SOFT_WEIGHT ?? "130") || 130),
  );
  const aisleSoftWeight =
    aisleSoftWeightBase *
    (visualPrimaryBroad ? config.search.imageSearchVisualPrimaryAisleMult : 1);
  // Re-sort by exact cosine when available; otherwise approximate kNN score (HNSW order can drift).
  const hitsByKnnScore = [...hits].sort(
    (a: any, b: any) => visualSimFromHit(b) - visualSimFromHit(a),
  );
  // Score at least max(limit*5, 500) when possible; cap by pool + actual hit count.
  // Detection-scoped searches use an additional cap to bound rerank CPU without changing output size.
  const fetchLimitBase = Math.min(
    retrievalK,
    hitsByKnnScore.length,
    Math.max(limit * 5, 500),
  );
  const fetchLimit = detectionScoped
    ? Math.max(limit, Math.min(fetchLimitBase, imageDetectionRerankCandidateCap()))
    : fetchLimitBase;
  const baseCandidates = hitsByKnnScore.slice(0, fetchLimit);

  /** Per-hit soft signals for ranking + explain (visual + category + optional attribute embeddings). */
  const imageCompositeById = new Map<string, number>();
  const imageCompositeNormById = new Map<string, number>();
  const styleSimById = new Map<string, number>();
  const colorSimById = new Map<string, number>();
  const styleSimRawById = new Map<string, number>();
  const colorSimRawById = new Map<string, number>();
  const textureSimById = new Map<string, number>();
  const materialSimById = new Map<string, number>();
  const patternSimById = new Map<string, number>();
  const deepFusionTextById = new Map<string, number>();
  const deepFusionScoreById = new Map<string, number>();
  const taxonomyMatchById = new Map<string, number>();
  const blipAlignById = new Map<string, number>();
  /** BLIP primary vs catalog palette: multiplier on raw color cosine before fusion. */
  const blipColorConflictFactorById = new Map<string, number>();
  /** Color cosine after BLIP-vs-catalog dampening (feeds fusion + blend). */
  const colorSimFusionRawById = new Map<string, number>();
  /** Effective visual similarity used by final relevance (merchandise + BLIP aligned). */
  const visualSimEffectiveById = new Map<string, number>();

  const wColor = Math.max(0, Number(process.env.SEARCH_IMAGE_RERANK_COLOR_WEIGHT ?? "220") || 220);
  const wStyle = Math.max(0, Number(process.env.SEARCH_IMAGE_RERANK_STYLE_WEIGHT ?? "60") || 60);
  const wTexture = Math.max(0, Number(process.env.SEARCH_IMAGE_RERANK_TEXTURE_WEIGHT ?? "30") || 30);
  const wMaterial = Math.max(0, Number(process.env.SEARCH_IMAGE_RERANK_MATERIAL_WEIGHT ?? "30") || 30);
  const wPattern = Math.max(0, Number(process.env.SEARCH_IMAGE_RERANK_PATTERN_WEIGHT ?? "40") || 40);
  /** Taxonomy alignment within the same category/aisle (YOLO/BLIP seeds vs indexed product_types). */
  const wTypeComposite = Math.max(
    0,
    Math.min(500, Number(process.env.SEARCH_IMAGE_RERANK_TYPE_WEIGHT ?? "190") || 190),
  );

  const crossFamilyPenaltyWeight = Math.max(
    0,
    Math.min(2000, Number(process.env.SEARCH_CROSS_FAMILY_PENALTY_WEIGHT ?? "420") || 420),
  );
  const filtersRecord = filters as Record<string, unknown>;
  const filterCategory = (filters as { category?: string | string[] }).category;
  const mergedCategoryForRelevance = (
    Array.isArray(filterCategory)
      ? filterCategory[0]
      : filterCategory
  ) ??
    (typeof params.detectionProductCategory === "string" && params.detectionProductCategory.trim()
      ? params.detectionProductCategory
      : predictedCategoryAisles?.[0]);

  const textQueryForRelevance =
    typeof imageSearchTextQuery === "string" && imageSearchTextQuery.trim()
      ? imageSearchTextQuery.trim()
      : "";
  const isDetectionScopedQuery = Boolean(String(params.detectionProductCategory ?? "").trim());
  const desiredLengthForRelevance =
    typeof filtersRecord.length === "string"
      ? normalizeLengthToken(String(filtersRecord.length).toLowerCase().trim())
      : null;

  let desiredProductTypes: string[] = [];
  const hasExplicitTypeFilter =
    !isDetectionScopedQuery &&
    Array.isArray(filtersRecord.productTypes) &&
    filtersRecord.productTypes.length > 0;
  const hasExplicitCategoryFilter = !isDetectionScopedQuery && filterCategory != null;
  const hasTextTypeIntent = Boolean(textQueryForRelevance);
  let hasDetectionAnchoredTypeIntent = false;
  const astCategoriesForRelevance = normalizeImageCategoryIntentArray([
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
  ]);
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
    const fromPredicted = filterCategory == null && predictedCategoryAisles?.length
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
  const softHintsMerged = (softProductTypeHintsParam ?? [])
    .map((t) => String(t).toLowerCase().trim())
    .filter(Boolean);
  const preferredDesiredProductTypes = [...new Set(softHintsMerged)];
  if (softHintsMerged.length > 0) {
    desiredProductTypes = [...new Set([...desiredProductTypes, ...softHintsMerged])];
  }
  if (textQueryForRelevance) {
    const fromText = extractFashionTypeNounTokens(textQueryForRelevance).map((t) => t.toLowerCase());
    if (fromText.length > 0) {
      desiredProductTypes = [...new Set([...desiredProductTypes, ...fromText])];
      for (const t of fromText) {
        const x = String(t).toLowerCase().trim();
        if (x && !preferredDesiredProductTypes.includes(x)) preferredDesiredProductTypes.push(x);
      }
    }
  }
  if (desiredLengthForRelevance && desiredProductTypes.length > 0) {
    const prunedByLength = desiredProductTypes.filter((t) => {
      const token = String(t).toLowerCase();
      if (desiredLengthForRelevance === "long" || desiredLengthForRelevance === "maxi") {
        return !/\bmini\b/.test(token);
      }
      if (desiredLengthForRelevance === "mini") {
        return !/\b(maxi|midi|long)\b/.test(token);
      }
      if (desiredLengthForRelevance === "midi") {
        return !/\b(mini|maxi|long)\b/.test(token);
      }
      return true;
    });
    if (prunedByLength.length > 0) {
      desiredProductTypes = prunedByLength;
    }
  }
  hasDetectionAnchoredTypeIntent =
    Boolean(String(params.detectionProductCategory ?? "").trim()) ||
    (
      desiredProductTypes.length > 0 &&
      (
        Boolean(predictedCategoryAisles?.length) ||
        useAisleRerank
      )
    );

  const isFootwearDetectionIntent =
    String(params.detectionProductCategory ?? "").toLowerCase().trim() === "footwear" ||
    desiredProductTypes.some((t) => /\b(shoe|shoes|sandal|sandals|sneaker|sneakers|heel|heels|boot|boots|loafer|loafers|trainer|trainers|flat|flats|footwear|oxford|oxfords|pump|pumps)\b/.test(String(t).toLowerCase()));

  const explicitColorsForRelevance =
    Array.isArray(filtersRecord.colors) && filtersRecord.colors.length > 0
      ? filtersRecord.colors.map((c: unknown) => String(c).toLowerCase())
      : filtersRecord.color
        ? [String(filtersRecord.color).toLowerCase()]
        : [];

  // Crop-dominant colors: extracted from garment pixels via k-means.
  // These participate in color compliance scoring (rerankScore + colorMatch)
  // but do NOT hard-gate finalRelevance01 — pixel analysis can misread
  // shadows/backgrounds, so it's a ranking signal, not an acceptance gate.
  const cropDominantColorsRaw = Array.isArray(filtersRecord.cropDominantColors)
    ? filtersRecord.cropDominantColors.map((c: unknown) => String(c).toLowerCase().trim()).filter(Boolean)
    : [];
  const hasCropColorSignal = cropDominantColorsRaw.length > 0;
  const hasExplicitColorIntent = explicitColorsForRelevance.length > 0;
  const inferredByItemForRelevance =
    inferredByItemFromParams ??
    (filtersRecord as { inferredColorsByItem?: Record<string, string | null> }).inferredColorsByItem;
  const inferredByItemConfidenceForRelevance =
    (params as { inferredColorsByItemConfidence?: Record<string, number> }).inferredColorsByItemConfidence ??
    (filtersRecord as { inferredColorsByItemConfidence?: Record<string, number> }).inferredColorsByItemConfidence;
  const preferredInferredColorKey =
    (params as { inferredColorKey?: string | null }).inferredColorKey ??
    (filtersRecord as { inferredColorKey?: string | null }).inferredColorKey;
  const inferredColorTokens = collectInferredColorTokens(
    filtersRecord,
    inferredPrimaryFromParams ?? (filtersRecord as { inferredPrimaryColor?: string | null }).inferredPrimaryColor,
    inferredByItemForRelevance,
    inferredByItemConfidenceForRelevance,
    preferredInferredColorKey,
    typeof mergedCategoryForRelevance === "string" ? mergedCategoryForRelevance : undefined,
    desiredProductTypes,
  );
  const normalizedCropColors = [
    ...new Set(
      cropDominantColorsRaw.map((c) => normalizeColorToken(c) ?? c).filter(Boolean),
    ),
  ];
  const normalizedInferredColors = [
    ...new Set(
      inferredColorTokens.map((c) => normalizeColorToken(c) ?? c).filter(Boolean),
    ),
  ];
  const normalizedCropColorsForMerge = isFootwearDetectionIntent
    ? normalizedCropColors
    : normalizedCropColors.filter((c) => !["black", "gray", "charcoal"].includes(String(c).toLowerCase()));

  // If inferred color disagrees with crop-local colors, prefer crop colors for
  // detection-anchored image search. This avoids top-color bleed (e.g. yellow)
  // incorrectly gating bottom items that are beige/tan.
  const inferredCropColorConflict =
    normalizedInferredColors.length > 0 &&
    normalizedCropColorsForMerge.length > 0 &&
    tieredColorListCompliance(normalizedInferredColors, normalizedCropColorsForMerge, "any").compliance <= 0;
  const forceTrustInferredFootwearColor =
    isFootwearDetectionIntent &&
    inferredCropColorConflict &&
    hasHighConfidenceDarkFootwearConsensus({
      inferredByItem: inferredByItemForRelevance,
      inferredByItemConfidence: inferredByItemConfidenceForRelevance,
    });
  const preferInferredColorForConflict = shouldPreferInferredColorWhenConflict({
    mergedCategoryForRelevance: typeof mergedCategoryForRelevance === "string" ? mergedCategoryForRelevance : undefined,
    desiredProductTypes,
    inferredPrimary: inferredPrimaryFromParams ?? (filtersRecord as { inferredPrimaryColor?: string | null }).inferredPrimaryColor,
    inferredColorTokens,
  });
  const preferredInferredColorConfidence = Number(
    preferredInferredColorKey ? inferredByItemConfidenceForRelevance?.[preferredInferredColorKey] : 0,
  );
  const detectionCategoryNorm = String(params.detectionProductCategory ?? "").toLowerCase().trim();
  const hasStrongTopItemColor =
    (detectionCategoryNorm === "tops" ||
      desiredProductTypes.some((t) =>
        /\b(top|tee|tshirt|t-?shirt|shirt|blouse|tank|cami|camisole|sleeveless)\b/.test(
          String(t).toLowerCase(),
        ),
      )) &&
    preferredInferredColorConfidence >= Math.max(colorConfidenceThreshold(), 0.84);
  const hasStrongApparelItemColor =
    (detectionCategoryNorm === "bottoms" ||
      detectionCategoryNorm === "dresses" ||
      detectionCategoryNorm === "outerwear") &&
    preferredInferredColorConfidence >= Math.max(colorConfidenceThreshold(), 0.82);
  const hasStrongAccessoryItemColor =
    (detectionCategoryNorm === "bags" || detectionCategoryNorm === "footwear") &&
    preferredInferredColorConfidence >= Math.max(colorConfidenceThreshold(), 0.72);
  const hasStrongSlotAnchoredItemColor = hasStrongSlotAnchoredInferredColor({
    inferredByItem: inferredByItemForRelevance,
    inferredByItemConfidence: inferredByItemConfidenceForRelevance,
    preferredItemKey: preferredInferredColorKey,
    mergedCategoryForRelevance: typeof mergedCategoryForRelevance === "string" ? mergedCategoryForRelevance : undefined,
    desiredProductTypes,
  });
  const hasTrustedInferredColorSignal =
    inferredColorTokens.length > 0 &&
    (
      !inferredCropColorConflict ||
      forceTrustInferredFootwearColor ||
      hasStrongTopItemColor ||
      hasStrongApparelItemColor ||
      hasStrongAccessoryItemColor ||
      hasStrongSlotAnchoredItemColor ||
      preferInferredColorForConflict
    );
  const hasInferredColorSignal = hasTrustedInferredColorSignal;

  let allColorsForRelevance: string[];
  if (hasExplicitColorIntent) {
    allColorsForRelevance = [...explicitColorsForRelevance];
  } else if (hasTrustedInferredColorSignal && normalizedInferredColors.length > 0) {
    allColorsForRelevance = [...normalizedInferredColors];
  } else {
    allColorsForRelevance = [...normalizedCropColorsForMerge];
  }

  const desiredColorsForRelevance = [
    ...new Set(
      allColorsForRelevance.map((c) => normalizeColorToken(c) ?? c).filter(Boolean),
    ),
  ];
  const rerankColorModeForRelevance = filtersRecord.colorMode === "all" ? "all" : "any";
  const desiredColorsTierForRelevance =
    allColorsForRelevance.length > 0 ? allColorsForRelevance : desiredColorsForRelevance;

  const queryAgeGroupRawForRelevance =
    typeof filtersRecord.ageGroup === "string" ? filtersRecord.ageGroup : undefined;
  const queryAgeGroupForRelevance =
    normalizeAudienceAgeGroupValue(queryAgeGroupRawForRelevance) ?? queryAgeGroupRawForRelevance;
  const queryGenderNorm = normalizeQueryGender(filtersAny.gender);
  const hasAudienceIntentForRelevance = Boolean(queryAgeGroupForRelevance || queryGenderNorm);
  const queryAgeGroupNormForSafety = normalizeSimpleToken(queryAgeGroupForRelevance);
  const hasKidsAudienceIntent = queryAgeGroupNormForSafety === "kids" || hasKidsAudienceToken(filtersAny.gender);

  const explicitStyleForRelevance =
    typeof filtersRecord.style === "string"
      ? String(filtersRecord.style).toLowerCase().trim()
      : "";
  const softStyleForRelevance =
    typeof filtersRecord.softStyle === "string"
      ? String(filtersRecord.softStyle).toLowerCase().trim()
      : "";
  const hasExplicitStyleIntent = explicitStyleForRelevance.length > 0;
  const hasSoftStyleHint = softStyleForRelevance.length > 0;
  const athleticIntentRe = /\b(sport|athlet|training|workout|gym|fitness|running|jogging|activewear|sportswear)\b/i;
  const nonAthleticIntent =
    (hasSoftStyleHint && !athleticIntentRe.test(softStyleForRelevance)) ||
    (hasExplicitStyleIntent && !athleticIntentRe.test(explicitStyleForRelevance)) ||
    (desiredProductTypes.length > 0 && !desiredProductTypes.some((t) => athleticIntentRe.test(String(t))));
  const shouldSuppressAthleticCandidates =
    hasDetectionAnchoredTypeIntent &&
    (params.detectionProductCategory === "tops" ||
      params.detectionProductCategory === "bottoms" ||
      params.detectionProductCategory === "outerwear") &&
    (nonAthleticIntent || hasSoftStyleHint || hasExplicitStyleIntent);
  const softStyleGateEnabled = String(process.env.SEARCH_IMAGE_SOFT_STYLE_GATE ?? "1").toLowerCase() !== "0";
  const styleIntentGatesFinalRelevance =
    hasExplicitStyleIntent ||
    (softStyleGateEnabled && hasSoftStyleHint && hasDetectionAnchoredTypeIntent);
  // Soft style hints from detection/BLIP should still guide final relevance for
  // image search when explicit style is absent.
  const desiredStyleForRelevance = hasExplicitStyleIntent
    ? explicitStyleForRelevance
    : hasSoftStyleHint
      ? softStyleForRelevance
      : undefined;
  const desiredSleeveForRelevance =
    typeof filtersRecord.sleeve === "string" ? String(filtersRecord.sleeve).toLowerCase().trim() : undefined;
  const desiredSleeveNorm = desiredSleeveForRelevance;
  const isTopDetectionIntent =
    params.detectionProductCategory === "tops" ||
    desiredProductTypes.some((t) => /\b(top|tee|tshirt|shirt|blouse|tank|cami)\b/.test(String(t).toLowerCase()));
  const enforceSleeveGate =
    (desiredSleeveForRelevance === "short" ||
      desiredSleeveForRelevance === "sleeveless" ||
      desiredSleeveForRelevance === "long") &&
    (!hasDetectionAnchoredTypeIntent || isTopDetectionIntent);
  const preferredSleeveMin =
    desiredSleeveForRelevance === "long"
      ? 0.52
      : desiredSleeveForRelevance === "short" || desiredSleeveForRelevance === "sleeveless"
        ? 0.38
        : 0.25;
  const fallbackSleeveMin =
    desiredSleeveForRelevance === "long"
      ? 0.42
      : desiredSleeveForRelevance === "short" || desiredSleeveForRelevance === "sleeveless"
        ? 0.26
        : 0.1;

  const hasColorIntentForFinal = hasExplicitColorIntent || hasInferredColorSignal;
  const hasInferredColorIntentForRescue = !hasExplicitColorIntent && hasInferredColorSignal;
  const hasSoftColorIntentForRescue = !hasExplicitColorIntent && desiredColorsForRelevance.length > 0;
  const strictInferredOnePieceColorGate =
    !hasExplicitColorIntent &&
    hasInferredColorSignal &&
    hasDetectionAnchoredTypeIntent &&
    desiredProductTypes.some((t) => /\b(dress|gown|jumpsuit|romper|playsuit)\b/.test(String(t).toLowerCase()));
  // Crop-dominant colors affect reranking but should not gate final relevance
  // unless we also have inferred semantic color evidence (e.g., BLIP "blue jeans").
  const softColorBiasOnly =
    !hasExplicitColorIntent && hasCropColorSignal && !hasInferredColorSignal;

  /**
   * When the user did not narrow the search (category / productTypes / text / explicit color),
   * rank by visual similarity first (catalog-bound when SEARCH_IMAGE_MERCHANDISE_SIMILARITY=1),
   * then metadata relevance, then composite tie-break (composite uses the same bound visual).
   * Disable: SEARCH_IMAGE_RANK_VISUAL_FIRST=0
   */
  const imageSearchVisualPrimaryRanking = visualPrimaryBroad;

  const relevanceIntent: SearchHitRelevanceIntent = {
    desiredProductTypes,
    desiredColors: desiredColorsForRelevance,
    desiredColorsTier: desiredColorsTierForRelevance,
    rerankColorMode: rerankColorModeForRelevance,
    desiredStyle: desiredStyleForRelevance,
    desiredSleeve: desiredSleeveForRelevance,
    mergedCategory: mergedCategoryForRelevance
      ? normalizeImageCategoryIntent(mergedCategoryForRelevance)
      : undefined,
    astCategories: astCategoriesForRelevance,
    queryAgeGroup: queryAgeGroupForRelevance,
    audienceGenderForScoring: filtersAny.gender,
    hasAudienceIntent: hasAudienceIntentForRelevance,
    crossFamilyPenaltyWeight,
    lexicalMatchQuery: textQueryForRelevance || undefined,
    tightSemanticCap: true,
    softColorBiasOnly,
    // Detection-derived productTypes are useful hints but can be noisy;
    // keep strict type gating only for explicit user intent anchors.
    // YOLO/detection hints remain in scoring but should not hard-gate image retrieval by default.
    reliableTypeIntent:
      forceStrictInferredTypeIntentEnv() ||
      hasExplicitTypeFilter ||
      hasExplicitCategoryFilter ||
      hasTextTypeIntent ||
      (hasDetectionAnchoredTypeIntent &&
        desiredProductTypes.some((t) =>
          /\b(suit|suits|blazer|blazers|sport\s*coat|dress\s*jacket|waistcoat|vest|tuxedo)\b/.test(
            String(t).toLowerCase(),
          ),
        )),
  };
  const hasReliableTypeIntentForRelevance = Boolean(relevanceIntent.reliableTypeIntent);
  const hasDerivedTypeIntentForSafetyGate = desiredProductTypes.length > 0;
  const shouldUseVisualPrimarySort =
    imageSearchVisualPrimaryRanking &&
    !hasReliableTypeIntentForRelevance &&
    !hasDetectionAnchoredTypeIntent;
  const hasStrictTypeIntentForMerchandiseGate =
    forceStrictInferredTypeIntentEnv() || hasExplicitTypeFilter || hasTextTypeIntent;

  /**
   * Single snapshot for debugging: style can come from explicit filter or soft hint,
   * and both can now participate in final relevance intent.
   */
  const relevanceIntentDebug = {
    style: {
      gatesFinalRelevance01: styleIntentGatesFinalRelevance,
      usedInCompositeRerank: hasExplicitStyleIntent || hasSoftStyleHint,
      explicitFilter: explicitStyleForRelevance || undefined,
      softHint: softStyleForRelevance || undefined,
    },
    type: {
      reliableTypeIntent: hasReliableTypeIntentForRelevance,
      detectionAnchored: hasDetectionAnchoredTypeIntent,
    },
    color: {
      gatesFinalRelevance01: hasColorIntentForFinal,
      cropDominantTokens: hasCropColorSignal ? [...cropDominantColorsRaw] : undefined,
      inferredTokens: inferredColorTokens.length > 0 ? [...inferredColorTokens] : undefined,
      inferredVsCropConflict: inferredCropColorConflict,
      inferredColorTrusted: hasTrustedInferredColorSignal,
      inferredColorForcedForFootwear: forceTrustInferredFootwearColor,
      softBiasOnly: softColorBiasOnly,
      explicitFilters: [...explicitColorsForRelevance],
      effectiveDesired: [...desiredColorsForRelevance],
    },
    types: {
      desiredProductTypes: [...desiredProductTypes],
    },
  };

  const colorIntentStrengthForFinal = hasExplicitColorIntent
    ? 1
    : hasInferredColorSignal
      ? 0.82
      : hasCropColorSignal
        ? 0.42
        : 0;

  const nearIdenticalRawMin = imageSearchNearIdenticalRawCosineMin();

  const complianceById = new Map<string, HitCompliance>();
  const colorByHitId = new Map<string, string | null>();
  const lengthComplianceById = new Map<string, number>();
  const hasLengthIntentById = new Map<string, boolean>();
  for (const hit of baseCandidates) {
    const idStr = String(hit._source.product_id);
    const sim = visualSimFromHit(hit);
    const rel = computeHitRelevance(hit, sim, relevanceIntent);
    const { primaryColor, ...comp } = rel;
    const detectionCategoryNorm = String(params.detectionProductCategory ?? "").toLowerCase().trim();
    const isCoreDetectionCategory =
      detectionCategoryNorm === "tops" ||
      detectionCategoryNorm === "footwear" ||
      detectionCategoryNorm === "shoes" ||
      detectionCategoryNorm === "bags";
    // Root fix: when detection intent is strong and a hit is clearly in-family by both
    // category and type, a large cross-family penalty is contradictory and causes false drops.
    if (
      hasDetectionAnchoredTypeIntent &&
      isCoreDetectionCategory &&
      Number(comp.categoryRelevance01 ?? 0) >= 0.95 &&
      ((comp.exactTypeScore ?? 0) >= 1 || Number(comp.productTypeCompliance ?? 0) >= 0.88)
    ) {
      comp.crossFamilyPenalty = Math.min(Number(comp.crossFamilyPenalty ?? 0), 0.18);
    }
    const docLength = inferDocLengthToken(hit);
    const hasLengthIntentForHit = Boolean(desiredLengthForRelevance) && docSupportsLengthIntent(hit);
    const lengthCompliance = hasLengthIntentForHit
      ? lengthComplianceScore(
        desiredLengthForRelevance,
        docLength.value,
        docLength.explicit,
      )
      : 0;
    (comp as any).lengthCompliance = lengthCompliance;
    (comp as any).hasLengthIntent = hasLengthIntentForHit;
    lengthComplianceById.set(idStr, lengthCompliance);
    hasLengthIntentById.set(idStr, hasLengthIntentForHit);
    complianceById.set(idStr, comp);
    colorByHitId.set(idStr, primaryColor);
  }

  // Precompute color embedding cosine + align `colorCompliance` with it when tier metadata
  // is absent (no tokens) or contradicts strong embedding_color match — before composite
  // blending so colorSimEff / explain colorScore stay consistent with colorSimRaw.
  const hasAnyColorTokenIntent = allColorsForRelevance.length > 0;
  if (runColor) {
    for (const hit of baseCandidates) {
      const idStr = String(hit._source.product_id);
      const comp = complianceById.get(idStr);
      if (!comp) continue;
      const cs = cosineSimilarity01(colorQueryEmbedding ?? undefined, hit._source?.embedding_color);
      colorSimRawById.set(idStr, Math.round(cs * 1000) / 1000);

      // Guard against re-inflating color compliance when catalog color explicitly
      // contradicts desired/inferred color tokens (e.g. query white, doc color blue).
      const srcForColor = (hit._source ?? {}) as Record<string, unknown>;
      const sourceColor = extractCanonicalColorTokensFromSource(srcForColor);
      const catalogColorNorm = sourceColor.tokens[0] ?? "";
      const hasHardCatalogColorConflict =
        hasAnyColorTokenIntent &&
        sourceColor.tokens.length > 0 &&
        tieredColorListCompliance(desiredColorsTierForRelevance, sourceColor.tokens, rerankColorModeForRelevance)
          .compliance <= 0;

      if (hasHardCatalogColorConflict) {
        comp.colorCompliance = 0;
      }

      if (!hasAnyColorTokenIntent) {
        comp.colorCompliance = Math.max(0, Math.min(1, cs));
      } else if (!hasHardCatalogColorConflict && (comp.colorCompliance ?? 0) < 0.12 && cs >= 0.42) {
        comp.colorCompliance = Math.max(
          comp.colorCompliance ?? 0,
          Math.min(1, cs * 0.82),
        );
      }
    }
  }

  const useMerchSim = imageMerchandiseSimilarityBindingEnabled();
  const useMerchSimForThresholdAndPrimarySort =
    useMerchSim && hasStrictTypeIntentForMerchandiseGate;
  const merchandiseSimById = new Map<string, number>();
  const merchAlignmentById = new Map<string, number>();
  for (const hit of baseCandidates) {
    const idStr = String(hit._source.product_id);
    const raw = visualSimFromHit(hit);
    if (!useMerchSim) {
      merchandiseSimById.set(idStr, raw);
      merchAlignmentById.set(idStr, 1);
      continue;
    }
    if (raw >= nearIdenticalRawMin) {
      merchandiseSimById.set(idStr, raw);
      merchAlignmentById.set(idStr, 1);
      continue;
    }
    const comp = complianceById.get(idStr);
    const m = merchandiseVisualSimilarity01({
      rawClip01: raw,
      productTypeCompliance: comp?.productTypeCompliance ?? 0,
      categoryRelevance01: comp?.categoryRelevance01 ?? 0,
      hasProductTypeSeeds: relevanceIntent.desiredProductTypes.length > 0,
      hasStructuredCategoryHints:
        (relevanceIntent.astCategories?.length ?? 0) > 0 ||
        Boolean(relevanceIntent.mergedCategory),
    });
    merchandiseSimById.set(idStr, m.effective01);
    merchAlignmentById.set(idStr, m.alignmentFactor);
  }

  // Update osSimilarity01 for near-identical hits (for explain output accuracy).
  for (const hit of baseCandidates) {
    const raw = visualSimFromHit(hit);
    if (raw < nearIdenticalRawMin) continue;
    const idStr = String(hit._source.product_id);
    const comp = complianceById.get(idStr);
    if (comp) {
      comp.osSimilarity01 = Math.max(comp.osSimilarity01 ?? 0, raw);
    }
  }

  const passesImageSimilarityThreshold = (hit: any, thresh: number): boolean => {
    const raw = visualSimFromHit(hit);
    const eff =
      raw >= nearIdenticalRawMin
        ? raw
        : useMerchSimForThresholdAndPrimarySort
          ? (merchandiseSimById.get(String(hit._source.product_id)) ?? raw)
          : raw;
    return eff >= thresh;
  };

  const rankedVisualForSort = (hit: any): number => {
    const raw = visualSimFromHit(hit);
    if (raw >= nearIdenticalRawMin) return raw;
    return useMerchSimForThresholdAndPrimarySort
      ? (merchandiseSimById.get(String(hit._source.product_id)) ?? raw)
      : raw;
  };

  // After compliance + merchandise sim: compute per-hit embedding similarities,
  // BLIP alignment (as soft reranking factor), and composite score.
  for (const hit of baseCandidates) {
    const idStr = String(hit._source.product_id);
    const visualSimRaw =
      useMerchSimForThresholdAndPrimarySort
        ? (merchandiseSimById.get(idStr) ?? visualSimFromHit(hit))
        : visualSimFromHit(hit);
    const blipAlign = computeBlipAlignment(blipSignal, hit);
    blipAlignById.set(idStr, Math.round(blipAlign.matchScore * 1000) / 1000);
    // BLIP is used as a soft reranking multiplier in computeExplicitFinalRelevance,
    // not as an additive boost. Keep effective visual = merchandise sim (no BLIP inflation).
    visualSimEffectiveById.set(idStr, visualSimRaw);
    const categorySoft =
      useAisleRerank && !forceHardCategoryFilter
        ? categorySoftScoreForHit(hit, desiredCatalogTerms)
        : 0;

    const colorSim = runColor ? (colorSimRawById.get(idStr) ?? 0) : 0;
    const blipColorConflict = blipCatalogColorConflictFactor(blipSignal, hit);
    blipColorConflictFactorById.set(idStr, Math.round(blipColorConflict * 1000) / 1000);
    const colorFusionRaw = Math.max(0, Math.min(1, colorSim * blipColorConflict));
    colorSimFusionRawById.set(idStr, Math.round(colorFusionRaw * 1000) / 1000);
    const styleSim = runStyle
      ? cosineSimilarity01(styleQueryEmbedding ?? undefined, hit._source?.embedding_style)
      : 0;
    const patternSim = runPattern
      ? cosineSimilarity01(patternQueryEmbedding ?? undefined, hit._source?.embedding_pattern)
      : 0;
    const textureSim = runTexture
      ? cosineSimilarity01(textureQueryEmbedding ?? undefined, hit._source?.embedding_texture)
      : 0;
    const materialSim = runMaterial
      ? cosineSimilarity01(materialQueryEmbedding ?? undefined, hit._source?.embedding_material)
      : 0;
    const comp = complianceById.get(idStr);
    const hasStyleIntentForComposite = hasExplicitStyleIntent || hasSoftStyleHint;
    const hasColorIntentForComposite =
      hasExplicitColorIntent || hasCropColorSignal || hasInferredColorSignal;
    const colorCompliance = comp?.colorCompliance ?? 0;
    const styleCompliance = comp?.styleCompliance ?? 0;
    const colorSimEff = blendSoftSimilarityWithCompliance({
      rawSim: colorFusionRaw,
      compliance: colorCompliance,
      hasIntent: hasColorIntentForComposite,
      strictIntent: hasExplicitColorIntent,
    });
    const styleSimEff = blendSoftSimilarityWithCompliance({
      rawSim: styleSim,
      compliance: styleCompliance,
      hasIntent: hasStyleIntentForComposite,
      strictIntent: hasExplicitStyleIntent,
    });

    styleSimRawById.set(idStr, Math.round(styleSim * 1000) / 1000);
    styleSimById.set(idStr, Math.round(styleSimEff * 1000) / 1000);
    colorSimById.set(idStr, Math.round(colorSimEff * 1000) / 1000);
    textureSimById.set(idStr, Math.round(textureSim * 1000) / 1000);
    materialSimById.set(idStr, Math.round(materialSim * 1000) / 1000);
    patternSimById.set(idStr, Math.round(patternSim * 1000) / 1000);
    taxonomyMatchById.set(idStr, categorySoft);

    const attrGate = 0.4 + 0.6 * visualSimRaw;
    const typeComplianceForComposite = comp?.productTypeCompliance ?? 0;
    const typeSoftForComposite =
      desiredProductTypes.length > 0 && wTypeComposite > 0 ? typeComplianceForComposite : 0;
    const composite =
      visualSimRaw * 1000 +
      (categorySoft * aisleSoftWeight +
        typeSoftForComposite * wTypeComposite +
        colorSimEff * wColor +
        styleSimEff * wStyle +
        textureSim * wTexture +
        materialSim * wMaterial +
        patternSim * wPattern) *
      attrGate;
    imageCompositeById.set(idStr, composite);

    const deepText = deepFusionTextAlignment01({
      hit,
      queryText: textQueryForRelevance,
      desiredProductTypes,
      desiredStyles: desiredStyleForRelevance ? [desiredStyleForRelevance] : [],
      desiredColors: desiredColorsForRelevance,
      blipSignal,
    });
    deepFusionTextById.set(idStr, Math.round(deepText * 1000) / 1000);

    const attrBlend =
      0.32 * colorSimEff +
      0.22 * styleSimEff +
      0.16 * patternSim +
      0.15 * textureSim +
      0.15 * materialSim;
    const deepFusionScore = Math.max(
      0,
      Math.min(1, 0.55 * deepText + 0.45 * attrBlend),
    );
    deepFusionScoreById.set(idStr, Math.round(deepFusionScore * 1000) / 1000);
  }
  const compositeValues = Array.from(imageCompositeById.values());
  const compositeMin = compositeValues.length > 0 ? Math.min(...compositeValues) : 0;
  const compositeMax = compositeValues.length > 0 ? Math.max(...compositeValues) : 1;
  const compositeRange = Math.max(1e-9, compositeMax - compositeMin);
  for (const [id, raw] of imageCompositeById.entries()) {
    const norm = (raw - compositeMin) / compositeRange;
    imageCompositeNormById.set(id, Math.max(0, Math.min(1, norm)));
  }

  const compositeNormValues = Array.from(imageCompositeNormById.values());
  const batchCompositeInfluence = computeBatchCompositeInfluence(
    imageSearchCompositeInfluenceBase(),
    baseCandidates.length,
    compositeNormValues,
  );

  // Adaptive CLIP floor: derive from batch 10th-percentile so the stretch
  // function adapts to each query's similarity distribution.
  const batchVisualSims = baseCandidates
    .map((h: any) => merchandiseSimById.get(String(h._source.product_id)) ?? visualSimFromHit(h))
    .sort((a, b) => a - b);
  const p10Idx = Math.floor(batchVisualSims.length * 0.10);
  const batchP10 = batchVisualSims.length > 0 ? batchVisualSims[Math.min(p10Idx, batchVisualSims.length - 1)] : 0.50;
  const adaptiveClipFloor = Math.max(0.40, Math.min(0.65, batchP10 - 0.05));

  // Track fusedVisual / metadataCompliance per hit for the clean explain output.
  const fusedVisualById = new Map<string, number>();
  const metadataComplianceById = new Map<string, number>();
  const keywordSubtypeBoostById = new Map<string, number>();
  const keywordSubtypeOverlapById = new Map<string, number>();
  const keywordSubtypeExactHitById = new Map<string, boolean>();
  const finalScoreSourceById = new Map<string, string>();

  // Final relevance pass: compute the authoritative finalRelevance01 incorporating
  // all visual + metadata signals, adaptive floors, composite, and BLIP reranking.
  for (const hit of baseCandidates) {
    const idStr = String(hit._source.product_id);
    const comp = complianceById.get(idStr);
    if (!comp) continue;
    const rawVisual = Math.max(0, Math.min(1, visualSimFromHit(hit)));
    const effectiveVisual = visualSimEffectiveById.get(idStr) ?? rawVisual;
    const colorContradictionPenalty = computeColorContradictionPenalty({
      desiredColorsTier: desiredColorsTierForRelevance,
      rerankColorMode: rerankColorModeForRelevance,
      hasExplicitColorIntent,
      hasInferredColorSignal,
      hasCropColorSignal,
      rawVisual,
      nearIdenticalRawMin,
      hit,
    });
    const effectiveVisualForScoring = Math.max(0, Math.min(1, effectiveVisual * colorContradictionPenalty));
    const subtypeKeywordSignal = computeSubtypeKeywordSignal({
      desiredProductTypes,
      preferredDesiredProductTypes,
      hit,
      reliableTypeIntent:
        hasReliableTypeIntentForRelevance || hasDetectionAnchoredTypeIntent,
      crossFamilyPenalty: comp.crossFamilyPenalty ?? 0,
      productTypeCompliance: comp.productTypeCompliance ?? 0,
    });
    const lexicalAssistTypeMatch =
      (subtypeKeywordSignal.exactHit || subtypeKeywordSignal.overlap >= 0.6) &&
      (comp.productTypeCompliance ?? 0) >= 0.55;
    const typeMatch =
      (comp.exactTypeScore ?? 0) >= 1 ||
      (comp.productTypeCompliance ?? 0) >= 0.82 ||
      lexicalAssistTypeMatch;
    const lengthCompliance = lengthComplianceById.get(idStr) ?? 0;
    const hasLengthIntentForHit = hasLengthIntentById.get(idStr) ?? false;
    const crossFamilyPenaltyVal = comp.crossFamilyPenalty ?? 0;

    // ────────────────────────────────────────────────────────────────
    // Compute part matching factor (Phase 1)
    // ────────────────────────────────────────────────────────────────
    let partMatchingFactor = 1.0; // default: no-op
    const partSims = partSimByDocId.get(idStr);
    if (partSims && typeof partSims === 'object') {
      const isTopIntentForPartBoost =
        String(params.detectionProductCategory ?? "").toLowerCase().trim() === "tops" ||
        isTopLikeCategory(String(mergedCategoryForRelevance ?? ""));
      const topPartSim = isTopIntentForPartBoost ? computeTopPartSimilarity01(partSims) : 0;
      // Average non-zero part similarities
      const nonZeroSims = Object.values(partSims).filter((s) => typeof s === 'number' && s > 0);
      if (nonZeroSims.length > 0) {
        const avgPartSim = nonZeroSims.reduce((a, b) => a + b, 0) / nonZeroSims.length;
        const basePartSim =
          isTopIntentForPartBoost && topPartSim > 0
            ? Math.max(avgPartSim * 0.8, topPartSim)
            : avgPartSim;
        // Weight of part matching (tunable via env var, default 80 = 8% max boost).
        // Tops use a stronger default because sleeve/neckline parts are highly diagnostic.
        const wPart = Math.max(
          0,
          Number(
            isTopIntentForPartBoost
              ? process.env.SEARCH_IMAGE_TOP_PART_WEIGHT ?? process.env.SEARCH_IMAGE_PART_WEIGHT ?? '140'
              : process.env.SEARCH_IMAGE_PART_WEIGHT ?? '80',
          ) || (isTopIntentForPartBoost ? 100 : 80),
        );
        // Part matching multiplier: add up to (wPart/1000) to the base 1.0
        // E.g., wPart=80 means up to 1 + 0.08 = 1.08 boost
        partMatchingFactor = 1.0 + (basePartSim * wPart / 1000);
      }
    }

    const explicitResult = computeExplicitFinalRelevance({
      simVisual: effectiveVisualForScoring,
      typeMatch,
      catSoft: comp.categoryRelevance01 ?? 0,
      colorMatch: comp.colorCompliance ?? 0,
      colorTier: comp.colorTier,
      styleMatch: comp.styleCompliance ?? 0,
      sleeveMatch: comp.sleeveCompliance ?? 0,
      lengthMatch: lengthCompliance,
      audienceMatch: comp.audienceCompliance ?? 0,
      crossFamily: crossFamilyPenaltyVal >= 0.8,
      crossFamilyPenalty: crossFamilyPenaltyVal,
      isNearDuplicate: rawVisual >= nearIdenticalRawMin,
      hasTypeIntent: (relevanceIntent.desiredProductTypes?.length ?? 0) > 0,
      hasColorIntent: hasColorIntentForFinal,
      hasStyleIntent: styleIntentGatesFinalRelevance,
      hasSleeveIntent: Boolean(comp.hasSleeveIntent),
      hasLengthIntent: hasLengthIntentForHit,
      hasAudienceIntent: hasAudienceIntentForRelevance,
      intraFamilyPenalty: comp.intraFamilyPenalty ?? 0,
      colorSimRaw: colorSimFusionRawById.get(idStr) ?? colorSimRawById.get(idStr) ?? 0,
      styleSimRaw: styleSimRawById.get(idStr) ?? 0,
      patternSimRaw: patternSimById.get(idStr) ?? 0,
      adaptiveClipFloor,
      imageCompositeScore01: imageCompositeNormById.get(idStr) ?? 0,
      blipMatchScore: blipAlignById.get(idStr) ?? 0,
      compositeInfluence: batchCompositeInfluence,
      colorWeightScale: hasExplicitColorIntent
        ? 1
        : hasInferredColorSignal
          ? 0.85
          : hasCropColorSignal
            ? 0.55
            : 0.35,
      colorIntentStrength: colorIntentStrengthForFinal,
      mergedCategoryForRelevance,
      detectionProductCategory: params.detectionProductCategory,
      partMatchingFactor,
    });
    const baseFinal = Math.min(1, explicitResult.score + subtypeKeywordSignal.boost);
    if (imageDeepFusionEnabled()) {
      const wDeep = imageDeepFusionWeight();
      const deepFusion = deepFusionScoreById.get(idStr) ?? 0;
      comp.finalRelevance01 = Math.max(
        0,
        Math.min(1, (1 - wDeep) * baseFinal + wDeep * deepFusion),
      );
    } else {
      comp.finalRelevance01 = baseFinal;
    }
    (comp as any).colorContradictionPenalty = Math.round(colorContradictionPenalty * 1000) / 1000;
    keywordSubtypeBoostById.set(idStr, Math.round(subtypeKeywordSignal.boost * 1000) / 1000);
    keywordSubtypeOverlapById.set(idStr, subtypeKeywordSignal.overlap);
    keywordSubtypeExactHitById.set(idStr, subtypeKeywordSignal.exactHit);
    finalScoreSourceById.set(idStr, "computed");

    const broadImageIntent =
      !hasExplicitColorIntent &&
      !hasExplicitStyleIntent &&
      !hasExplicitCategoryFilter &&
      !hasTextTypeIntent &&
      !hasDetectionAnchoredTypeIntent;
    if (broadImageIntent) {
      // Keep image-only ranking aligned with visual similarity when user did not
      // provide explicit constraints; avoids compressed scores across dissimilar items.
      comp.finalRelevance01 = Math.max(comp.finalRelevance01, Math.min(1, effectiveVisual * 0.86));
    }

    fusedVisualById.set(idStr, Math.round(explicitResult.fusedVisual * 1000) / 1000);
    metadataComplianceById.set(idStr, Math.round(explicitResult.metadataCompliance * 1000) / 1000);
    // Near-identical hits can be boosted to raw visual — but only when they are
    // not blocked by cross-family mismatch or severe type non-compliance.
    if (rawVisual >= nearIdenticalRawMin) {
      const crossBlocked = crossFamilyPenaltyVal >= 0.5;
      const typeOk = typeMatch || (comp.productTypeCompliance ?? 0) >= 0.5;
      const hasTypeIntentHere = (relevanceIntent.desiredProductTypes?.length ?? 0) > 0;
      if (!crossBlocked && (!hasTypeIntentHere || typeOk)) {
        comp.finalRelevance01 = Math.max(comp.finalRelevance01, Math.min(1, rawVisual));
        finalScoreSourceById.set(idStr, "near_identical_floor");
      }
    }
  }

  const sortedByRelevance = [...baseCandidates].sort((a: any, b: any) => {
    const ida = String(a._source.product_id);
    const idb = String(b._source.product_id);
    if (shouldUseVisualPrimarySort) {
      const va = rankedVisualForSort(a);
      const vb = rankedVisualForSort(b);
      if (Math.abs(vb - va) > 0.01) return vb - va;
    }
    // Primary: finalRelevance01 descending (incorporates visual + metadata signals).
    const fa = complianceById.get(ida)?.finalRelevance01 ?? 0;
    const fb = complianceById.get(idb)?.finalRelevance01 ?? 0;
    if (hasColorIntentForFinal && Math.abs(fb - fa) <= 0.04) {
      const ca = complianceById.get(ida)?.colorCompliance ?? 0;
      const cb = complianceById.get(idb)?.colorCompliance ?? 0;
      if (Math.abs(cb - ca) >= 0.03) return cb - ca;
    }
    if (Math.abs(fb - fa) > 1e-6) return fb - fa;
    if (hasExplicitColorIntent || hasInferredColorSignal) {
      const ca = complianceById.get(ida)?.colorCompliance ?? 0;
      const cb = complianceById.get(idb)?.colorCompliance ?? 0;
      if (Math.abs(cb - ca) > 1e-6) return cb - ca;
    }
    const va = visualSimEffectiveById.get(ida) ?? rankedVisualForSort(a);
    const vb = visualSimEffectiveById.get(idb) ?? rankedVisualForSort(b);
    if (Math.abs(vb - va) > 0.002) return vb - va;
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
    const footwearDetectionForGenderGate =
      String(params.detectionProductCategory ?? "").toLowerCase().trim() === "footwear" ||
      String(params.detectionProductCategory ?? "").toLowerCase().trim() === "shoes";

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
          ? ["men", "mens", "male", "man"]
          : ["unisex"];

    const oppKw =
      wantG === "women"
        ? ["men", "mens", "male", "boy", "boys", "man", "kid", "kids", "youth", "toddler", "baby"]
        : wantG === "men"
          ? ["women", "womens", "female", "ladies", "woman", "girl", "girls", "boy", "boys", "kid", "kids", "youth", "toddler", "baby"]
          : [];
    const unknownGenderMinSim = imageGenderUnknownVisualMinSimilarity();

    const matches = (hit: any) => {
      const dg = docGender(hit);
      const t = title(hit?._source?.title);
      if (dg === wantG) return true;
      if (dg === "unisex") return true;
      if (dg) return false;
      const hasWant = wantKw.some((kw) => new RegExp(`\\b${kw}\\b`).test(t));
      const hasUnisexCue = /\b(unisex|all\s*gender|all-gender)\b/.test(t);
      if (oppKw.length > 0 && oppKw.some((kw) => new RegExp(`\\b${kw}\\b`).test(t))) return false;
      if (hasWant) return true;
      // For footwear, unknown-gender docs should not pass on visual similarity only.
      // This prevents men/women leakage when catalog gender metadata is sparse.
      if (footwearDetectionForGenderGate) return hasUnisexCue;
      if (!dg && visualSimFromHit(hit) >= unknownGenderMinSim) return true;
      return false;
    };

    const filtered = sortedByRelevance.filter((h: any) => matches(h));
    return filtered.length > 0 ? filtered : sortedByRelevance;
  })();

  const strictCategorySafetyActive =
    hasReliableTypeIntentForRelevance ||
    hasDetectionAnchoredTypeIntent ||
    hasExplicitTypeFilter ||
    hasExplicitCategoryFilter;
  const isDressDetectionIntent = String(params.detectionProductCategory ?? "").toLowerCase().trim() === "dresses";
  const dressPatternSims = isDressDetectionIntent
    ? rankedHitsCandidates
      .map((h: any) => patternSimById.get(String(h?._source?.product_id)) ?? 0)
      .filter((v) => Number.isFinite(v))
      .sort((a, b) => a - b)
    : [];
  const dressPatternMedian =
    dressPatternSims.length > 0
      ? dressPatternSims[Math.floor(dressPatternSims.length / 2)]
      : 0;
  const dressPatternMax = dressPatternSims.length > 0 ? dressPatternSims[dressPatternSims.length - 1] : 0;
  const hasStrongDressPatternIntent =
    isDressDetectionIntent &&
    runPattern &&
    dressPatternSims.length >= 6 &&
    dressPatternMax >= 0.66 &&
    (dressPatternMax - dressPatternMedian) >= 0.12;
  const dressPatternMin = Math.max(0.46, Math.min(0.72, dressPatternMax - 0.18));
  const strongVisualOverrideMinSim = imageStrongVisualOverrideMinSimilarity();
  const rankedHitsCategorySafe = strictCategorySafetyActive
    ? rankedHitsCandidates.filter((h: any) => {
      const comp = complianceById.get(String(h._source.product_id));
      if (!comp) return false;
      if (comp.hardBlocked) return false;
      if (!hasKidsAudienceIntent && hasChildAudienceSignals(h._source ?? {})) return false;
      const crossFamily = comp.crossFamilyPenalty ?? 0;
      if (crossFamily >= 0.55) return false;
      const typeComp = comp.productTypeCompliance ?? 0;
      const exactType = comp.exactTypeScore ?? 0;
      const visualStrong = visualSimFromHit(h) >= strongVisualOverrideMinSim;
      if ((hasExplicitTypeFilter || (hasExplicitCategoryFilter && hasDerivedTypeIntentForSafetyGate)) && exactType < 1 && typeComp < 0.28) {
        return false;
      }
      // Category-specific type floor: relax for bottoms with high YOLO confidence to handle jeans/denims
      // with low productTypeCompliance to 'trousers' detection label (0.928 confidence).
      let detAnchoredTypeFloor = hasColorIntentForFinal ? 0.26 : 0.22;
      if (hasDetectionAnchoredTypeIntent && params.detectionProductCategory === 'tops') {
        const yoloConfidence = params.detectionYoloConfidence ?? 0;
        if (yoloConfidence >= 0.9) {
          detAnchoredTypeFloor = 0.08;
        } else if (yoloConfidence >= 0.8) {
          detAnchoredTypeFloor = 0.12;
        } else {
          detAnchoredTypeFloor = 0.16;
        }
      }
      if (hasDetectionAnchoredTypeIntent && params.detectionProductCategory === 'bottoms') {
        const yoloConfidence = params.detectionYoloConfidence ?? 0;
        if (yoloConfidence >= 0.9) {
          // High-confidence bottoms detection: allow lower type compliance (jeans as denims/pants)
          detAnchoredTypeFloor = 0.15;
        } else if (yoloConfidence >= 0.8) {
          // Medium-high confidence: moderate relaxation
          detAnchoredTypeFloor = 0.19;
        }
      }
      if (hasDetectionAnchoredTypeIntent && params.detectionProductCategory === 'dresses') {
        const yoloConfidence = params.detectionYoloConfidence ?? 0;
        if (yoloConfidence >= 0.9) {
          detAnchoredTypeFloor = 0.14;
        } else if (yoloConfidence >= 0.8) {
          detAnchoredTypeFloor = 0.18;
        } else {
          detAnchoredTypeFloor = 0.2;
        }
      }
      if (hasDetectionAnchoredTypeIntent && exactType < 1 && typeComp < detAnchoredTypeFloor && !visualStrong) {
        return false;
      }
      const lengthComp = Number((comp as any).lengthCompliance ?? 0);
      const hasLengthIntentForHit = Boolean((comp as any).hasLengthIntent);
      const dressLengthMin = (() => {
        const yoloConfidence = params.detectionYoloConfidence ?? 0;
        // Dress length metadata is sparse in many catalogs; keep this gate soft.
        if (yoloConfidence >= 0.9) return 0.18;
        if (yoloConfidence >= 0.8) return 0.24;
        return 0.3;
      })();
      if (
        hasDetectionAnchoredTypeIntent &&
        params.detectionProductCategory === "dresses" &&
        Boolean(desiredLengthForRelevance) &&
        hasLengthIntentForHit &&
        lengthComp < dressLengthMin &&
        !visualStrong
      ) {
        return false;
      }
      if (hasStrongDressPatternIntent && isDressDetectionIntent) {
        const patternSim = Number(patternSimById.get(String(h?._source?.product_id)) ?? 0);
        const rawVisual = visualSimFromHit(h);
        if (rawVisual < nearIdenticalRawMin && patternSim < dressPatternMin) {
          return false;
        }
      }
      return true;
    })
    : rankedHitsCandidates;
  const rankedHitsForGates = rankedHitsCategorySafe.length > 0
    ? rankedHitsCategorySafe
    : rankedHitsCandidates;
  const droppedByCategorySafety = strictCategorySafetyActive
    ? Math.max(0, rankedHitsCandidates.length - rankedHitsCategorySafe.length)
    : 0;

  // Late visual gate (after soft rerank).
  const thresholdPassedByVisual = rankedHitsForGates.filter((h: any) =>
    passesImageSimilarityThreshold(h, similarityThreshold),
  );
  let thresholdRelaxed = false;
  let relaxFloorUsed: number | null = null;
  let visualGatedHits = thresholdPassedByVisual;
  if (relaxThresholdWhenEmpty && thresholdPassedByVisual.length === 0 && rankedHitsForGates.length > 0) {
    const floor = imageRelaxSimilarityFloor();
    relaxFloorUsed = floor;
    visualGatedHits = rankedHitsForGates.filter((h: any) =>
      passesImageSimilarityThreshold(h, floor),
    );
    thresholdRelaxed = visualGatedHits.length > 0;
  }

  if (relaxThresholdWhenEmpty) {
    const minWantCandidates = Math.min(fetchLimit, Math.max(limit, 15));
    if (visualGatedHits.length < minWantCandidates && rankedHitsForGates.length > visualGatedHits.length) {
      const floor = imageRelaxSimilarityFloor();
      relaxFloorUsed = floor;
      const loose = rankedHitsForGates.filter((h: any) =>
        passesImageSimilarityThreshold(h, floor),
      );
      if (loose.length > visualGatedHits.length) {
        visualGatedHits = loose;
        thresholdRelaxed = true;
      }
    }
  }

  const acceptMinImage = config.search.finalAcceptMinImage;
  /** When strict CLIP threshold + merchandise binding drop every hit, keep best raw-visual neighbors (always on). */
  let imageSearchPipelineDegraded = false;
  if (visualGatedHits.length === 0 && rankedHitsForGates.length > 0) {
    const relFloor = imageRelaxSimilarityFloor();
    const relaxedHits = rankedHitsForGates.filter(
      (h: any) => visualSimFromHit(h) >= relFloor,
    );

    // Only relax when the caller explicitly opts in. Returning distant neighbors by default
    // makes image search look broken because it surfaces products that are visually unrelated.
    if (relaxThresholdWhenEmpty && relaxedHits.length > 0) {
      imageSearchPipelineDegraded = true;
      thresholdRelaxed = true;
      visualGatedHits = relaxedHits;
      for (const h of visualGatedHits) {
        const idStr = String(h._source.product_id);
        const comp = complianceById.get(idStr);
        if (comp) {
          const v = visualSimFromHit(h);
          // Use visual similarity as rescue signal instead of flat acceptMinImage.
          // This preserves relative ordering among rescued candidates.
          comp.finalRelevance01 = Math.max(comp.finalRelevance01, Math.min(1, v * 0.9));
          comp.osSimilarity01 = Math.max(comp.osSimilarity01 ?? 0, v);
          finalScoreSourceById.set(idStr, "relaxed_visual_gate_rescue");
        }
      }
    }
  }

  /** True when reranked candidates exist but visual gate removed all (without relaxation). */
  const belowRelevanceThreshold =
    rankedHitsForGates.length > 0 && thresholdPassedByVisual.length === 0 && !thresholdRelaxed;
  const droppedByVisualThreshold = Math.max(0, rankedHitsForGates.length - visualGatedHits.length);

  const finalAcceptMin = acceptMinImage;
  const inferredColorSoftGateCategory =
    hasDetectionAnchoredTypeIntent &&
    hasInferredColorSignal &&
    !hasExplicitColorIntent &&
    (detectionCategoryNorm === "tops" || detectionCategoryNorm === "bottoms");
  const apparelDetectionCategory =
    detectionCategoryNorm === "tops" ||
    detectionCategoryNorm === "bottoms" ||
    detectionCategoryNorm === "dresses" ||
    detectionCategoryNorm === "outerwear";
  const sparseVisualCandidatePool =
    visualGatedHits.length > 0 &&
    visualGatedHits.length <= Math.max(8, Math.min(fetchLimit, 24));
  const strongestVisualCandidate = visualGatedHits.reduce((maxVal: number, h: any) => {
    const v = visualSimFromHit(h);
    return v > maxVal ? v : maxVal;
  }, 0);
  const hasStrongVisualEvidence =
    strongestVisualCandidate >= Math.max(0.7, similarityThreshold - 0.1);
  let effectiveFinalAcceptMin = inferredColorSoftGateCategory
    ? Math.min(finalAcceptMin, 0.28)
    : finalAcceptMin;
  // Color-agnostic apparel protection:
  // In sparse candidate pools with strong visual evidence, avoid hard final-accept
  // cutoffs that collapse tops/bottoms to zero before category-aware rescue.
  if (apparelDetectionCategory && hasDetectionAnchoredTypeIntent && sparseVisualCandidatePool) {
    effectiveFinalAcceptMin = Math.min(
      effectiveFinalAcceptMin,
      hasStrongVisualEvidence ? 0.16 : 0.2,
    );
  }
  let rankedHits = visualGatedHits.filter(
    (h: any) => (complianceById.get(String(h._source.product_id))?.finalRelevance01 ?? 0) >= effectiveFinalAcceptMin,
  );

  if (rankedHits.length === 0 && visualGatedHits.length > 0) {
    imageSearchPipelineDegraded = true;
    let rescuePool = visualGatedHits;
    if (hasReliableTypeIntentForRelevance || hasDetectionAnchoredTypeIntent) {
      // In intent-constrained searches, never fall back to the full visual pool.
      // Start empty and admit only type-safe candidates.
      rescuePool = [];
      const isTopDetectionIntent =
        params.detectionProductCategory === "tops" ||
        desiredProductTypes.some((t) => /\b(top|tee|tshirt|shirt|blouse|tank|cami)\b/.test(String(t).toLowerCase()));
      const enforceSleeveGate =
        (desiredSleeveNorm === "short" || desiredSleeveNorm === "sleeveless" || desiredSleeveNorm === "long") &&
        (!hasDetectionAnchoredTypeIntent || isTopDetectionIntent);
      const minTypeCompliance = hasDetectionAnchoredTypeIntent
        ? params.detectionProductCategory === "tops"
          ? visualGatedHits.length >= 30
            ? 0.38
            : visualGatedHits.length >= 12
              ? 0.26
              : 0.14
          : visualGatedHits.length >= 30
            ? 0.5
            : visualGatedHits.length >= 12
              ? 0.4
              : 0.3
        : 0.38;
      const preferredTypeAligned = visualGatedHits.filter((h: any) => {
        const comp = complianceById.get(String(h._source.product_id));
        if (!comp) return false;
        if (!hasKidsAudienceIntent && hasChildAudienceSignals(h._source ?? {})) return false;
        if ((comp.crossFamilyPenalty ?? 0) >= 0.62) return false;

        // Must pass type intent
        if (!((comp.exactTypeScore ?? 0) >= 1 || (comp.productTypeCompliance ?? 0) >= minTypeCompliance)) {
          return false;
        }

        // Apply sleeve gating only for restrictive sleeve intents where mismatches are high-impact.
        if (enforceSleeveGate && (comp.sleeveCompliance ?? 0) < preferredSleeveMin) {
          return false;
        }

        // Must pass color intent if set (avoid color mismatches in rescue)
        if (hasExplicitColorIntent && (comp.colorCompliance ?? 0) < 0.4) {
          return false;
        }
        const inferredRescueColorFloor =
          inferredColorSoftGateCategory ? 0.02 : 0.18;
        if (hasInferredColorIntentForRescue && (comp.colorCompliance ?? 0) < inferredRescueColorFloor) {
          return false;
        }
        // Soft color intent should NOT gate rescue admission — only explicit color gates.
        // This prevents crop-dominant colors from pulling wrong categories (e.g., blue into white-dress search).

        return true;
      });
      if (preferredTypeAligned.length > 0) {
        rescuePool = preferredTypeAligned;
      } else if (hasDetectionAnchoredTypeIntent) {
        const fallbackTypeAligned = visualGatedHits.filter((h: any) => {
          const comp = complianceById.get(String(h._source.product_id));
          if (!comp) return false;
          if (!hasKidsAudienceIntent && hasChildAudienceSignals(h._source ?? {})) return false;
          // Stronger gender gate: when gender is explicitly filtered, reject hard mismatches (audienceCompliance === 0)
          // and also reject low compliance (< 0.75) to prevent women's shoes from appearing in men's searches
          const minAudienceCompliance = filtersAny.gender ? 0.75 : 0.55;
          if ((comp.audienceCompliance ?? 1) < minAudienceCompliance) return false;
          if ((comp.crossFamilyPenalty ?? 0) >= 0.62) return false;
          const fallbackTypeFloor = params.detectionProductCategory === "tops" ? 0.14 : 0.22;
          if ((comp.exactTypeScore ?? 0) < 1 && (comp.productTypeCompliance ?? 0) < fallbackTypeFloor) return false;
          if (enforceSleeveGate && (comp.sleeveCompliance ?? 0) < fallbackSleeveMin) return false;
          if (hasExplicitColorIntent && (comp.colorCompliance ?? 0) < 0.18) return false;
          const inferredFallbackColorFloor =
            inferredColorSoftGateCategory ? 0.01 : 0.08;
          if (hasInferredColorIntentForRescue && (comp.colorCompliance ?? 0) < inferredFallbackColorFloor) return false;
          if (shouldSuppressAthleticCandidates && isAthleticCatalogCandidate(h._source ?? {})) return false;
          // Soft color intent does not gate fallback — only explicit color does.
          // This prevents crop-derived colors from blocking valid type matches.
          return true;
        });
        if (fallbackTypeAligned.length > 0) {
          rescuePool = fallbackTypeAligned;
        }
      }

      // Last safe fallback for sparse catalogs: keep only minimally type-aligned items.
      if (rescuePool.length === 0) {
        const minTypeFloor = hasDetectionAnchoredTypeIntent ? 0.16 : 0.22;
        rescuePool = visualGatedHits.filter((h: any) => {
          const comp = complianceById.get(String(h._source.product_id));
          if (!comp) return false;
          if (!hasKidsAudienceIntent && hasChildAudienceSignals(h._source ?? {})) return false;
          if ((comp.hardBlocked ?? false) === true) return false;
          if ((comp.crossFamilyPenalty ?? 0) >= 0.62) return false;
          const typeComp = comp.productTypeCompliance ?? 0;
          const exactType = comp.exactTypeScore ?? 0;
          if (exactType >= 1) return true;
          return typeComp >= minTypeFloor;
        });
      }
      // Last-resort fail-open for core detection categories (tops/shoes/bags):
      // if intent gates collapse to empty despite having visual candidates, keep
      // category-safe visual neighbors instead of returning an empty group.
      if (rescuePool.length === 0) {
        const dc = String(params.detectionProductCategory ?? "").toLowerCase().trim();
        const isCoreDetection = dc === "tops" || dc === "footwear" || dc === "shoes" || dc === "bags";
        if (isCoreDetection) {
          rescuePool = visualGatedHits.filter((h: any) => {
            const comp = complianceById.get(String(h._source.product_id));
            if (!comp) return false;
            if ((comp.hardBlocked ?? false) === true) return false;
            if (!hasKidsAudienceIntent && hasChildAudienceSignals(h._source ?? {})) return false;
            const categoryScore = Number(comp.categoryRelevance01 ?? 0);
            const typeComp = Number(comp.productTypeCompliance ?? 0);
            const exactType = Number(comp.exactTypeScore ?? 0);
            const crossFamily = Number(comp.crossFamilyPenalty ?? 0);
            return (
              crossFamily < 0.85 &&
              categoryScore >= 0.55 &&
              (exactType >= 1 || typeComp >= 0.08)
            );
          });
        }
      }
    }
    // Use visual similarity as the rescue signal instead of a flat minimum.
    // This preserves relative ordering so that genuinely similar products
    // rank above dissimilar ones even in the degraded path.
    // Note: intentAwareRescue now excludes softColorBiasOnly to avoid lifting weak candidates
    // when only crop-dominant color exists with no explicit type intent.
    const intentAwareRescue =
      hasReliableTypeIntentForRelevance ||
      hasDetectionAnchoredTypeIntent ||
      (desiredColorsForRelevance.length > 0 && (hasExplicitColorIntent || (hasInferredColorSignal && !softColorBiasOnly))) ||
      Boolean(desiredSleeveForRelevance);
    for (const h of rescuePool) {
      const comp = complianceById.get(String(h._source.product_id));
      if (comp) {
        if (!hasKidsAudienceIntent && hasChildAudienceSignals(h._source ?? {})) continue;
        if (shouldSuppressAthleticCandidates && isAthleticCatalogCandidate(h._source ?? {})) continue;
        if (hasDetectionAnchoredTypeIntent) {
          const typeComp = comp.productTypeCompliance ?? 0;
          const exactType = comp.exactTypeScore ?? 0;
          const rescueTypeFloor = params.detectionProductCategory === "tops" ? 0.08 : 0.16;
          if (exactType < 1 && typeComp < rescueTypeFloor) continue;
          if ((comp.crossFamilyPenalty ?? 0) >= 0.62) continue;
        }
        const footwearColorFloor = hasExplicitColorIntent ? 0.42 : hasInferredColorSignal ? 0.08 : 0.05;
        if (hasColorIntentForFinal && isFootwearDetectionIntent && (comp.colorCompliance ?? 0) < footwearColorFloor) continue;
        const v = visualSimFromHit(h);
        const existing = comp.finalRelevance01 ?? 0;
        const colorComp = Math.max(0, Math.min(1, comp.colorCompliance ?? 0));
        const colorTier = String(comp.colorTier ?? "none").toLowerCase();
        const colorTierFactor =
          colorTier === "exact"
            ? 1.12
            : colorTier === "family"
              ? 1.05
              : colorTier === "bucket"
                ? 0.94
                : 0.8;
        const colorLift = hasColorIntentForFinal
          ? (0.58 + 0.42 * colorComp) * colorTierFactor
          : hasInferredColorIntentForRescue
            ? (0.7 + 0.3 * colorComp) * colorTierFactor
            : 1;
        let rescueScore = Math.max(existing, v * 0.85 * colorLift);
        if (intentAwareRescue) {
          const typeComp = Math.max(0, Math.min(1, comp.productTypeCompliance ?? 0));
          const sleeveComp = Math.max(0, Math.min(1, comp.sleeveCompliance ?? 0));
          const audienceComp = Math.max(0, Math.min(1, comp.audienceCompliance ?? 1));
          const complianceBlend =
            0.4 * typeComp +
            0.15 * colorComp +
            0.3 * sleeveComp +
            0.15 * audienceComp;
          const intentAwareScore =
            Math.max(0, Math.min(1, 0.68 * v + 0.32 * complianceBlend)) *
            (hasColorIntentForFinal ? (0.92 + 0.08 * colorComp) * colorTierFactor : 0.85);
          rescueScore = Math.max(rescueScore, intentAwareScore);
        }
        // In rescue mode, keep intent-constrained scoring expressive instead of lifting all
        // candidates to the same global floor (which can hide sleeve/type mismatches).
        // When only soft color hint exists (crop-dominant), use much lower floor to filter out weak matches.
        const hasOnlySoftColorHint = softColorBiasOnly && !hasReliableTypeIntentForRelevance && !hasDetectionAnchoredTypeIntent;
        const rescueFloor = intentAwareRescue
          ? hasOnlySoftColorHint
            ? Math.min(effectiveFinalAcceptMin, 0.35)  // Very conservative for crop-color-only cases
            : hasColorIntentForFinal
              ? Math.min(effectiveFinalAcceptMin, hasExplicitColorIntent ? 0.48 : 0.44)
              : Math.min(effectiveFinalAcceptMin, 0.56)
          : effectiveFinalAcceptMin;
        comp.finalRelevance01 = Math.max(rescueScore, rescueFloor);
        finalScoreSourceById.set(String(h._source.product_id), "final_accept_rescue");
      }
    }
    rankedHits = [...rescuePool]
      .sort((a: any, b: any) => {
        const fa = complianceById.get(String(a._source.product_id))?.finalRelevance01 ?? 0;
        const fb = complianceById.get(String(b._source.product_id))?.finalRelevance01 ?? 0;
        return fb - fa;
      })
      .slice(0, Math.max(limit, 20));
  }

  // Keep a small high-visual slice even when metadata-based relevance is noisy.
  // This prevents true visual neighbors (including the same catalog item) from being
  // dropped solely due to weak/missing type/color fields.
  const rescueMinSim = imageVisualRescueMinSimilarity();
  const rescueMaxCount = imageVisualRescueMaxCount();
  if (rescueMaxCount > 0) {
    const existingIds = new Set(rankedHits.map((h: any) => String(h._source.product_id)));
    const rescueAudienceMin = imageVisualRescueAudienceMin();
    const rescueTypeMinIntent = hasReliableTypeIntentForRelevance
      ? 0.45
      : imageVisualRescueTypeMinWhenIntent();
    const rescueColorMinIntent = imageVisualRescueColorMinWhenIntent();
    const rescueStyleMinIntent = imageVisualRescueStyleMinWhenIntent();
    const topsStyleMinIntent =
      params.detectionProductCategory === "tops"
        ? Math.max(rescueStyleMinIntent, 0.28)
        : rescueStyleMinIntent;
    const rescue: any[] = visualGatedHits
      .filter((h: any) => !existingIds.has(String(h._source.product_id)))
      .map((h: any) => {
        const id = String(h._source.product_id);
        const visualSim = visualSimFromHit(h);
        const comp = complianceById.get(id);
        const aud = comp?.audienceCompliance ?? 1;
        const typeComp = comp?.productTypeCompliance ?? 0;
        const colorComp = comp?.colorCompliance ?? 0;
        const styleComp = comp?.styleCompliance ?? 0;
        const materialSim = materialSimById.get(id) ?? 0;
        const crossFamily = comp?.crossFamilyPenalty ?? 0;
        return { h, visualSim, aud, typeComp, colorComp, styleComp, materialSim, crossFamily };
      })
      .filter(({ h, visualSim, aud, typeComp, colorComp, styleComp, materialSim, crossFamily }) => {
        if (visualSim < rescueMinSim) return false;
        if (hasAudienceIntentForRelevance && aud < rescueAudienceMin) return false;
        if (hasStrongDressPatternIntent && isDressDetectionIntent) {
          const patternSim = Number(patternSimById.get(String((h as any)?._source?.product_id)) ?? 0);
          if (visualSim < nearIdenticalRawMin && patternSim < dressPatternMin) return false;
        }
        // Intent-aware rescue: keep sparse-result protection, but do not inject
        // visually similar yet intent-contradicting products.
        if ((hasExplicitTypeFilter || hasReliableTypeIntentForRelevance) && typeComp < rescueTypeMinIntent) return false;
        if (hasDetectionAnchoredTypeIntent) {
          const detectionTypeRescueFloor =
            params.detectionProductCategory === "tops" ? 0.12 : 0.3;
          if (typeComp < detectionTypeRescueFloor) return false;
        }
        if (hasColorIntentForFinal) {
          const effectiveRescueColorMin = isFootwearDetectionIntent
            ? Math.max(rescueColorMinIntent, 0.42)
            : rescueColorMinIntent;
          if (colorComp < effectiveRescueColorMin) return false;
        }
        const inferredVisualRescueColorFloor =
          inferredColorSoftGateCategory ? 0.02 : 0.16;
        if (hasInferredColorIntentForRescue && colorComp < inferredVisualRescueColorFloor) return false;
        if (hasExplicitStyleIntent && styleComp < rescueStyleMinIntent) return false;
        // Soft inferred style for tops is often noisy; only hard-gate on explicit style intent.
        if (params.detectionProductCategory === "tops" && hasExplicitStyleIntent && styleComp < topsStyleMinIntent) return false;
        if (params.detectionProductCategory === "tops" && hasExplicitStyleIntent) {
          const topsStyleMaterialBlend = 0.72 * styleComp + 0.28 * materialSim;
          if (topsStyleMaterialBlend < 0.24 && visualSim < 0.95) return false;
        }
        if ((hasReliableTypeIntentForRelevance || hasDetectionAnchoredTypeIntent) && crossFamily >= 0.5) return false;
        // When only soft color hint exists, require stricter type alignment to prevent crop-color bleed.
        // This prevents pants/jackets from leaking into dress/shoe searches via weak soft color signals.
        if (softColorBiasOnly && typeComp < 0.3) return false;
        return true;
      })
      .sort((a, b) => b.visualSim - a.visualSim)
      .slice(0, rescueMaxCount)
      .map((x) => x.h);
    if (rescue.length > 0) {
      rankedHits = [...rankedHits, ...rescue];
    }
  }

  // Preserve a tiny set of truly high-visual neighbors that may be over-penalized
  // by metadata noise, while still respecting audience and type/category safety.
  const mustKeepVisualMin = imageMustKeepVisualMinSimilarity();
  const mustKeepVisualMax = imageMustKeepVisualMaxCount();
  if (!imageSearchVisualPrimaryRanking && mustKeepVisualMax > 0 && visualGatedHits.length > 0) {
    const existingIds = new Set(rankedHits.map((h: any) => String(h._source.product_id)));
    const mustKeepAudienceMin = imageMustKeepVisualAudienceMin();
    const mustKeepTypeMin = hasReliableTypeIntentForRelevance
      ? 0.45
      : hasExplicitTypeFilter || hasExplicitCategoryFilter || hasDetectionAnchoredTypeIntent
        ? (params.detectionProductCategory === "tops" ? 0.2 : 0.45)
        : 0.28;
    const mustKeep: any[] = visualGatedHits
      .filter((h: any) => !existingIds.has(String(h._source.product_id)))
      .map((h: any) => {
        const id = String(h._source.product_id);
        const visualSim = visualSimFromHit(h);
        const comp = complianceById.get(id);
        const athleticCandidate = isAthleticCatalogCandidate(h._source ?? {});
        return {
          h,
          id,
          visualSim,
          audience: comp?.audienceCompliance ?? 1,
          typeComp: comp?.productTypeCompliance ?? 0,
          crossFamily: comp?.crossFamilyPenalty ?? 0,
          athleticCandidate,
        };
      })
      .filter(({ visualSim, audience, typeComp, crossFamily, athleticCandidate }) => {
        if (visualSim < mustKeepVisualMin) return false;
        if (hasAudienceIntentForRelevance && audience < mustKeepAudienceMin) return false;
        if (shouldSuppressAthleticCandidates && athleticCandidate) return false;
        if ((hasReliableTypeIntentForRelevance || hasDetectionAnchoredTypeIntent) && crossFamily >= 0.5) return false;
        if ((hasExplicitTypeFilter || hasExplicitCategoryFilter || hasDetectionAnchoredTypeIntent) && typeComp < mustKeepTypeMin) return false;
        if (crossFamily >= 0.55) return false;
        return true;
      })
      .sort((a, b) => b.visualSim - a.visualSim)
      .slice(0, mustKeepVisualMax)
      .map((x) => x.h);

    if (mustKeep.length > 0) {
      for (const h of mustKeep) {
        const id = String(h._source.product_id);
        const comp = complianceById.get(id);
        if (!comp) continue;
        const v = visualSimFromHit(h);
        comp.finalRelevance01 = Math.max(comp.finalRelevance01 ?? 0, Math.min(1, v * 0.88));
        finalScoreSourceById.set(id, "must_keep_visual_rescue");
      }
      rankedHits = [...rankedHits, ...mustKeep];
    }
  }

  let relevanceRelaxedForMinCount = false;
  const minResultsPolicy = imageCategoryAwareMinResultsPolicy({
    detectionProductCategory: params.detectionProductCategory,
    baseTarget: config.search.imageSearchMinResults,
    baseDelta: config.search.imageSearchRelevanceRelaxDelta,
    baseMinFraction: config.search.imageSearchRelevanceRelaxMinFraction,
  });
  const imageMinResultsTarget = minResultsPolicy.target;
  const relevanceRelaxDelta = minResultsPolicy.delta;
  if (
    imageMinResultsTarget > 0 &&
    rankedHits.length < imageMinResultsTarget &&
    visualGatedHits.length > rankedHits.length
  ) {
    const relaxFloorFrac = minResultsPolicy.minFraction;
    const relaxedMin = Math.max(
      finalAcceptMin * relaxFloorFrac,
      finalAcceptMin - relevanceRelaxDelta,
    );
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
    const explicitColorCategory = String(params.detectionProductCategory ?? "").toLowerCase();
    const minExplicitColorCompliance = explicitColorCategory === "bags" ? 0.2 : 0;
    const maxImgConfHits = Math.max(
      0,
      ...rankedHits.map((h: any) => Number(h?._source?.color_confidence_image) || 0),
    );
    const colorCompliantHits = rankedHits.filter(
      (h: any) =>
        (complianceById.get(String(h._source.product_id))?.colorCompliance ?? 0) >=
        minExplicitColorCompliance,
    );
    if (strictColorPost && colorCompliantHits.length > 0) {
      rankedHits = colorCompliantHits;
    } else if (strictColorPost && colorCompliantHits.length === 0 && maxImgConfHits < 0.42) {
      // Weak image color signal — keep ranked list (same as text search)
    }
  }

  // Detection-anchored inferred color (e.g., from item crop) can still leak unrelated
  // colors through visual rescue. Apply category-aware postfiltering.
  if (
    !hasExplicitColorIntent &&
    hasInferredColorSignal &&
    hasDetectionAnchoredTypeIntent &&
    desiredColorsForRelevance.length > 0
  ) {
    const inferredColorPostEnabled =
      String(process.env.SEARCH_INFERRED_COLOR_POSTFILTER ?? "1").toLowerCase() !== "0";
    if (inferredColorPostEnabled) {
      const category = String(params.detectionProductCategory ?? "").toLowerCase();
      const desiredPrimaryColor = String(desiredColorsForRelevance[0] ?? "").toLowerCase().trim();
      const whiteIntentForBottoms =
        category === "bottoms" &&
        /^(white|off[\s-]?white|ivory|cream|ecru)$/.test(desiredPrimaryColor);
      const minInferredColorCompliance =
        category === "footwear"
          ? 0.3
          : category === "bags"
            ? 0.3
            : category === "tops" || category === "dresses"
              ? category === "dresses"
                ? 0.18
                : 0.2
              : category === "bottoms" || category === "outerwear"
                ? category === "bottoms"
                  ? 0.16
                  : 0.22
                : 0.22;
      const hasStrongDetectionScopedColor =
        preferredInferredColorConfidence >= 0.82 &&
        (category === "tops" || category === "bottoms" || category === "dresses" || category === "outerwear");
      const shouldTightenForStrongInferredColor =
        hasStrongDetectionScopedColor && category !== "tops" && category !== "bottoms";
      const effectiveMinInferredColorCompliance = shouldTightenForStrongInferredColor
        ? Math.min(0.4, minInferredColorCompliance + 0.08)
        : minInferredColorCompliance;
      // Allow hits with high colorSimEff to pass even if colorCompliance is slightly below threshold
      const inferredColorCompliantHits = rankedHits.filter((h: any) => {
        const compliance = complianceById.get(String(h._source.product_id))?.colorCompliance ?? 0;
        const colorSimEff = colorSimById.get(String(h._source.product_id)) ?? 0;
        const sourceColor = extractCanonicalColorTokensFromSource((h as any)?._source ?? {});
        const sourceTokens = sourceColor.tokens;
        const hasWhiteFamilyToken = sourceTokens.some((t) => /^(white|off[\s-]?white|ivory|cream|ecru)$/.test(String(t)));
        const hasWarmNeutralToken = sourceTokens.some((t) => /^(beige|camel|tan|taupe|khaki|stone|nude)$/.test(String(t)));

        if (whiteIntentForBottoms) {
          if (hasWhiteFamilyToken) {
            return compliance >= Math.max(0.12, effectiveMinInferredColorCompliance - 0.12) || colorSimEff >= 0.64;
          }
          if (hasWarmNeutralToken) {
            return compliance >= 0.34 || colorSimEff >= 0.86;
          }
        }

        return (
          compliance >= effectiveMinInferredColorCompliance ||
          (
            (category === "bottoms" || category === "outerwear") &&
            hasStrongDetectionScopedColor &&
            colorSimEff >= 0.7 // allow visually strong matches
          )
        );
      });
      const minKeep =
        rankedHits.length >= 12
          ? 4
          : rankedHits.length >= 8
            ? 3
            : 1;
      const whiteBottomMinKeep = whiteIntentForBottoms
        ? (rankedHits.length >= 12 ? 3 : rankedHits.length >= 8 ? 2 : 1)
        : 0;
      const enforceInferredColorStrictly =
        category === "footwear" ||
        category === "shoes" ||
        ((category === "bags") &&
          hasStrongDetectionScopedColor &&
          desiredColorsForRelevance.length === 1) ||
        ((category === "outerwear" || category === "dresses") &&
          hasStrongDetectionScopedColor &&
          desiredColorsForRelevance.length === 1);
      if (whiteIntentForBottoms) {
        const whiteLikeBottomHits = inferredColorCompliantHits.filter((h: any) => {
          const sourceColor = extractCanonicalColorTokensFromSource((h as any)?._source ?? {});
          return sourceColor.tokens.some((t) => /^(white|off[\s-]?white|ivory|cream|ecru)$/.test(String(t)));
        });
        if (whiteLikeBottomHits.length >= whiteBottomMinKeep) {
          rankedHits = whiteLikeBottomHits;
        } else if (inferredColorCompliantHits.length > 0) {
          rankedHits = inferredColorCompliantHits;
        }
      } else if (
        inferredColorCompliantHits.length > 0 &&
        enforceInferredColorStrictly &&
        (category === "footwear" || category === "shoes" || inferredColorCompliantHits.length >= minKeep)
      ) {
        rankedHits = inferredColorCompliantHits;
      } else if (hasStrongDetectionScopedColor && inferredColorCompliantHits.length > 0) {
        // For tops/bottoms, don't collapse to tiny sets just because color is strong.
        // Keep recall, and let color remain a strong ordering signal downstream.
        if (
          (category === "tops" || category === "bottoms") &&
          inferredColorCompliantHits.length < minKeep
        ) {
          // no-op
        } else {
          rankedHits = inferredColorCompliantHits;
        }
      } else if (
        (category === "bottoms" || category === "outerwear") &&
        hasStrongDetectionScopedColor &&
        inferredColorCompliantHits.length === 0
      ) {
        // Strong bottoms/outerwear color signal should still prune obvious mismatches
        // instead of keeping a fully unconstrained color tail.
        const softColorSafeHits = rankedHits.filter(
          (h: any) =>
            (complianceById.get(String(h._source.product_id))?.colorCompliance ?? 0) >= 0.12,
        );
        if (softColorSafeHits.length > 0) {
          rankedHits = softColorSafeHits;
        }
      } else if (inferredColorCompliantHits.length >= minKeep) {
        rankedHits = inferredColorCompliantHits;
      } else if (rankedHits.length >= 10) {
        // Fallback trim: remove zero/near-zero color compliance tails when list is long.
        const softColorSafeHits = rankedHits.filter(
          (h: any) =>
            (complianceById.get(String(h._source.product_id))?.colorCompliance ?? 0) >= 0.08,
        );
        const softMinKeep = Math.max(3, Math.floor(rankedHits.length * 0.35));
        if (softColorSafeHits.length >= softMinKeep) {
          rankedHits = softColorSafeHits;
        }
      }
    }
  }

  // Non-sport guard at core ranking level: detection-anchored apparel searches with
  // casual/non-athletic intent should avoid training/workout products that leak through
  // fallback branches outside route-level athletic guards.
  if (hasDetectionAnchoredTypeIntent && rankedHits.length > 0) {
    const nonAthleticSoftStyle = hasSoftStyleHint && !athleticIntentRe.test(softStyleForRelevance);
    const nonAthleticTypeIntent =
      desiredProductTypes.length > 0 &&
      !desiredProductTypes.some((t) => athleticIntentRe.test(String(t)));
    const shouldGuardCategory =
      params.detectionProductCategory === "tops" ||
      params.detectionProductCategory === "bottoms" ||
      params.detectionProductCategory === "outerwear";
    const shouldApplyAthleticPostfilter =
      shouldGuardCategory && (nonAthleticSoftStyle || nonAthleticTypeIntent);

    if (shouldApplyAthleticPostfilter) {
      const athleticPostEnabled =
        String(process.env.SEARCH_IMAGE_NONSPORT_ATHLETIC_GUARD ?? "1").toLowerCase() !== "0";
      if (athleticPostEnabled) {
        const nonAthleticHits = rankedHits.filter(
          (h: any) => !isAthleticCatalogCandidate((h as any)?._source ?? {}),
        );
        const minKeep = rankedHits.length >= 8 ? 3 : 1;
        if (shouldSuppressAthleticCandidates || nonAthleticHits.length >= minKeep) {
          rankedHits = nonAthleticHits;
        }
      }
    }
  }

  const countAfterColorPostfilter = rankedHits.length;

  // Hard gate for explicit gender intent: filter out products with hard gender mismatches.
  // When user specifies men/women, reject products where audience compliance is 0 or null gender
  // with conflicting title keywords.
  if (filtersAny.gender) {
    const queryGenderNorm = normalizeQueryGender(filtersAny.gender);
    if (queryGenderNorm) {
      const strictGenderGate = String(process.env.SEARCH_GENDER_HARD_GATE ?? "1").toLowerCase() !== "0";
      const genderCompliantHits = rankedHits.filter((h: any) => {
        const comp = complianceById.get(String(h._source.product_id));
        if (!comp) return true; // Keep if no compliance data
        const audienceCompliance = comp.audienceCompliance ?? 0;
        // Hard reject: when audience compliance is 0, it means hard gender contradiction
        if (audienceCompliance === 0) return false;
        // Stricter gate: reject low compliance (< 0.5) when there's explicit gender intent
        if (strictGenderGate && audienceCompliance < 0.5) return false;
        return true;
      });
      if (genderCompliantHits.length > 0) {
        rankedHits = genderCompliantHits;
      }
      // If all results were filtered out, keep original ranked list to avoid empty results
    }
  }
  const countAfterGenderPostfilter = rankedHits.length;

  const isBagDetectionIntent =
    hasDetectionAnchoredTypeIntent &&
    String(params.detectionProductCategory ?? "").toLowerCase().trim() === "bags";
  if (isBagDetectionIntent && rankedHits.length > 0) {
    const bagSafeHits = rankedHits.filter((h: any) => isBagCatalogCandidate((h as any)?._source ?? {}));
    if (bagSafeHits.length > 0) {
      const bagCategoryAlignedHits = bagSafeHits.filter((h: any) => {
        const comp = complianceById.get(String(h?._source?.product_id));
        const categoryScore = Number(comp?.categoryRelevance01 ?? 0);
        const exactType = Number(comp?.exactTypeScore ?? 0);
        const typeComp = Number(comp?.productTypeCompliance ?? 0);
        return categoryScore >= 0.35 || exactType >= 1 || typeComp >= 0.9;
      });
      rankedHits = bagCategoryAlignedHits.length > 0 ? bagCategoryAlignedHits : bagSafeHits;
    }
  }

  // Detection-anchored bottoms with trouser intent should reject shorts candidates.
  const shouldRejectShortsForTrouserIntent =
    hasDetectionAnchoredTypeIntent &&
    String(params.detectionProductCategory ?? "").toLowerCase().trim() === "bottoms" &&
    hasStrictTrouserIntent(desiredProductTypes);
  if (shouldRejectShortsForTrouserIntent && rankedHits.length > 0) {
    rankedHits = rankedHits.filter((h: any) => !isShortsCatalogCandidate((h as any)?._source ?? {}));
  }

  const maxHydrate = Math.min(
    rankedHits.length,
    Math.max(limit * 10, 150),
  );
  const hitsForHydrate = rankedHits.slice(0, maxHydrate);
  const productIds = hitsForHydrate.map((hit: any) => hit._source.product_id);
  const scoreMap = new Map<string, number>();
  hitsForHydrate.forEach((hit: any) => {
    const id = String(hit._source.product_id);
    const sim =
      useMerchSimForThresholdAndPrimarySort
        ? (merchandiseSimById.get(id) ?? visualSimFromHit(hit))
        : visualSimFromHit(hit);
    scoreMap.set(id, Math.round(sim * 100) / 100);
  });

  // Fetch product data
  let results: ProductResult[] = [];
  if (productIds.length > 0) {
    const products = await getProductsByIdsOrdered(productIds);
    const numericIds = productIds.map((id: string) => parseInt(id, 10));
    const imagesByProduct = await getImagesForProducts(numericIds);
    const userLifestyle = await personalizationPromise;

    results = products.map((p: any) => {
      const images: ProductImage[] = imagesByProduct.get(parseInt(p.id, 10)) || [];
      const idStr = String(p.id);
      const similarityScore = scoreMap.get(idStr) ?? 0;
      const compliance = complianceById.get(idStr);
      const styleSim = styleSimById.get(idStr) ?? 0;
      const colorSim = colorSimById.get(idStr) ?? 0;
      const styleSimRaw = styleSimRawById.get(idStr) ?? styleSim;
      const colorSimRaw = colorSimRawById.get(idStr) ?? colorSim;
      const patternSim = patternSimById.get(idStr) ?? 0;
      const textureSim = textureSimById.get(idStr) ?? 0;
      const materialSim = materialSimById.get(idStr) ?? 0;
      const deepFusionText = deepFusionTextById.get(idStr) ?? 0;
      const deepFusionScore = deepFusionScoreById.get(idStr) ?? 0;
      const taxonomyMatch = taxonomyMatchById.get(idStr) ?? 0;
      const imageCompositeScore = imageCompositeById.get(idStr) ?? 0;
      const imageCompositeScore01 = imageCompositeNormById.get(idStr) ?? 0;
      const imagesOut = images.map((img) => ({
        id: img.id,
        url: img.cdn_url,
        is_primary: img.is_primary,
        p_hash: img.p_hash ?? undefined,
      }));
      const authoritativeColorRaw = typeof p.color === "string" ? p.color : "";
      const authoritativeColorTokens = extractCanonicalColorTokensFromRawColor(authoritativeColorRaw);
      const authoritativeColorNorm = authoritativeColorTokens[0] ?? "";
      let finalRelevance01 = compliance?.finalRelevance01;
      let finalRelevanceSource = finalScoreSourceById.get(idStr) ?? "computed";
      let explainColorCompliance = compliance?.colorCompliance;
      let explainMatchedColor = compliance?.matchedColor;
      let explainColorTier = compliance?.colorTier;

      // Hard gate: reject sport/athletic brand products when fashion (non-sport) intent is detected.
      // Sport brands (Adidas, Nike, Puma, etc.) are only relevant for explicit sportswear searches.
      const isSportBrand = /adidas|nike|puma|reebok|asics|under armour|newbalance|new balance|lululemon|columbia|the north face|patagonia|asics|vibram|mizuno/i.test(
        String(p.brand ?? ""),
      );
      const isSportKeyword = /sport|athletic|training|workout|gym|fitness|crossfit|yoga|jogger|track|runner|climber|climax|dri-fit|dryfit/i.test(
        String(p.title ?? "") + " " + String(p.description ?? ""),
      );
      const isSportContext = isSportBrand && isSportKeyword;
      const isStyleSportIntent = /\b(sport|athletic|training|active|workout|gym|fitness|running|jogging)\b/i.test(
        desiredStyleForRelevance ?? "",
      );
      const isTypeSportIntent = desiredProductTypes.some((t) => {
        const x = String(t ?? "").toLowerCase();
        if (!x) return false;
        if (x.includes("sport coat")) return false;
        return /\b(sport|sportswear|athletic|training|workout|gym|fitness|jogger|track|legging|running)\b/.test(x);
      });
      const isExplicitSportIntent = isStyleSportIntent || isTypeSportIntent;
      const isFormalIntent = /\b(formal|business|tailored|smart)\b/i.test(desiredStyleForRelevance ?? "");
      if (
        hasDetectionAnchoredTypeIntent &&
        isSportContext &&
        !isExplicitSportIntent
      ) {
        if (isFormalIntent || params.detectionProductCategory === "tops" || params.detectionProductCategory === "bottoms" || params.detectionProductCategory === "outerwear") {
          // In formal or non-sport apparel flows, sportswear should not survive due visual similarity.
          finalRelevance01 = 0;
          finalRelevanceSource = "sport_keyword_hard_gate";
        } else {
          // For weaker contexts, keep as low-confidence fallback only.
          finalRelevance01 = Math.min(finalRelevance01 ?? 0, 0.22);
          finalRelevanceSource = "sport_keyword_soft_cap";
        }
      } else if (hasColorIntentForFinal && authoritativeColorNorm && compliance) {
        const authoritativeColor = tieredColorListCompliance(
          desiredColorsTierForRelevance,
          authoritativeColorTokens.length > 0 ? authoritativeColorTokens : [authoritativeColorNorm],
          rerankColorModeForRelevance,
        );
        const bucketOnlyCatalogConflict = hasBucketOnlyColorConflict(
          desiredColorsTierForRelevance,
          authoritativeColorTokens.length > 0 ? authoritativeColorTokens : [authoritativeColorNorm],
          rerankColorModeForRelevance,
        );
        if (authoritativeColor.compliance <= 0 || bucketOnlyCatalogConflict) {
          const blipColorConflict = blipColorConflictFactorById.get(idStr) ?? 1;
          const conflictStrength = Math.max(0, Math.min(1, 1 - blipColorConflict));
          const strictDetectionColor = hasDetectionAnchoredTypeIntent;
          const isTopDetectionColorFallback =
            !hasExplicitColorIntent &&
            strictDetectionColor &&
            String(params.detectionProductCategory ?? "").toLowerCase().trim() === "tops";
          const baseConflictCap = hasExplicitColorIntent
            ? similarityScore * (strictDetectionColor ? 0.34 : 0.46)
            : isTopDetectionColorFallback
              ? similarityScore * 0.82
              : hasInferredColorSignal
                ? similarityScore * (strictDetectionColor ? 0.42 : 0.58)
                : similarityScore * (strictDetectionColor ? 0.54 : 0.72);
          const conflictAdjustedCap = baseConflictCap * (1 - 0.25 * conflictStrength);
          const maxConflictCap = hasExplicitColorIntent
            ? strictDetectionColor
              ? 0.24
              : 0.45
            : hasInferredColorSignal
              ? strictDetectionColor
                ? 0.30
                : 0.55
              : strictDetectionColor
                ? 0.36
                : 0.65;
          const topFallbackMaxConflictCap = isTopDetectionColorFallback ? 0.78 : maxConflictCap;
          const strictOnePieceCap = strictInferredOnePieceColorGate ? 0.22 : topFallbackMaxConflictCap;
          const nearDuplicateRelax = similarityScore >= nearIdenticalRawMin
            ? strictInferredOnePieceColorGate
              ? 0.02
              : 0.05
            : 0;
          // Keep contradictory colors visible for sparse catalogs, but with realistic caps
          const conservativeCap = Math.min(
            strictOnePieceCap + nearDuplicateRelax,
            Math.max(strictInferredOnePieceColorGate ? 0.08 : 0.15, conflictAdjustedCap),
          );
          const inferredCoreCategoryFloor = 0;
          const conservativeCapAdjusted = Math.max(conservativeCap, inferredCoreCategoryFloor);
          finalRelevance01 = Math.min(finalRelevance01 ?? 0, conservativeCapAdjusted);
          finalRelevanceSource = "catalog_color_correction";
          explainColorCompliance = 0;
          explainMatchedColor = authoritativeColorNorm;
          explainColorTier = "none";
        } else if ((compliance.colorCompliance ?? 0) + 0.05 < authoritativeColor.compliance) {
          const strongTypeForColorLift =
            (compliance.exactTypeScore ?? 0) >= 1 || (compliance.productTypeCompliance ?? 0) >= 0.9;
          const styleCompatibleForColorLift =
            !hasDetectionAnchoredTypeIntent || !hasSoftStyleHint || (compliance.styleCompliance ?? 0) >= 0.25;
          const canApplyColorLift =
            (hasExplicitColorIntent || authoritativeColor.tier === "exact") &&
            strongTypeForColorLift &&
            styleCompatibleForColorLift;
          if (canApplyColorLift) {
            const colorLift = 0.88 + 0.12 * authoritativeColor.compliance;
            finalRelevance01 = Math.max(finalRelevance01 ?? 0, Math.min(1, similarityScore * colorLift));
            finalRelevanceSource = "catalog_color_correction";
          }
          explainColorCompliance = authoritativeColor.compliance;
          explainMatchedColor = authoritativeColor.bestMatch ?? authoritativeColorNorm;
          explainColorTier = authoritativeColor.tier;
        }

        // Mixed catalog colors (e.g. white/black) should not be treated like pure black
        // when user color is inferred as a single dominant color from the query image.
        if (
          !hasExplicitColorIntent &&
          hasInferredColorSignal &&
          desiredColorsForRelevance.length === 1 &&
          authoritativeColorTokens.length > 1 &&
          authoritativeColor.compliance > 0
        ) {
          const desiredSingle = String(desiredColorsForRelevance[0] ?? "").toLowerCase().trim();
          const isBottomsDetection = String(params.detectionProductCategory ?? "").toLowerCase().trim() === "bottoms";
          const nonMatching = authoritativeColorTokens.filter(
            (c) => tieredColorListCompliance([desiredSingle], [c], "any").compliance <= 0,
          );
          if (nonMatching.length > 0) {
            const hasBlackWhiteContrast =
              (desiredSingle === "black" && nonMatching.includes("white")) ||
              (desiredSingle === "white" && nonMatching.includes("black"));
            const damp = isBottomsDetection && desiredSingle === "white"
              ? (hasBlackWhiteContrast ? 0.68 : 0.78)
              : (hasBlackWhiteContrast ? 0.74 : 0.84);
            const base = Math.max(0, finalRelevance01 ?? 0);
            finalRelevance01 = Math.min(base, Math.max(0.18, base * damp));
            finalRelevanceSource = "catalog_color_mix_dampen";
            explainColorCompliance = Math.min(
              explainColorCompliance ?? authoritativeColor.compliance,
              hasBlackWhiteContrast ? 0.7 : 0.82,
            );
            if (String(explainColorTier ?? "").toLowerCase() === "exact") {
              explainColorTier = "family";
            }
          }
        }
      }

      if (hasDetectionAnchoredTypeIntent && compliance) {
        const sleeveComp = Math.max(0, Math.min(1, compliance.sleeveCompliance ?? 0));
        const lengthComp = Math.max(0, Math.min(1, (compliance as any).lengthCompliance ?? 0));
        const typeComp = Math.max(0, Math.min(1, compliance.productTypeCompliance ?? 0));
        const isTopDetection = String(params.detectionProductCategory ?? "").toLowerCase().trim() === "tops";
        const isDressDetection = String(params.detectionProductCategory ?? "").toLowerCase().trim() === "dresses";
        const onePieceCandidate = isDressDetection
          ? isOnePieceCatalogCandidate(p as unknown as Record<string, unknown>)
          : false;

        // `sleeveCompliance` around 0.15 commonly means sleeve metadata is missing/uncertain,
        // not an explicit contradiction. Only cap when we have a strong mismatch signal.
        if (isTopDetection && (compliance.hasSleeveIntent ?? false) && sleeveComp < 0.12) {
          finalRelevance01 = Math.min(finalRelevance01 ?? 0, similarityScore >= nearIdenticalRawMin ? 0.34 : 0.28);
          finalRelevanceSource = "sleeve_conflict_cap";
        }

        if (isDressDetection) {
          if ((compliance.hasSleeveIntent ?? false) && sleeveComp < 0.12) {
            finalRelevance01 = Math.min(finalRelevance01 ?? 0, similarityScore >= nearIdenticalRawMin ? 0.34 : 0.28);
            finalRelevanceSource = "dress_sleeve_conflict_cap";
          }
          if (((compliance as any).hasLengthIntent ?? false) && lengthComp < 0.24) {
            finalRelevance01 = Math.min(finalRelevance01 ?? 0, similarityScore >= nearIdenticalRawMin ? 0.38 : 0.3);
            finalRelevanceSource = "dress_length_conflict_cap";
          }
          if (!onePieceCandidate && similarityScore < 0.9) {
            finalRelevance01 = Math.min(finalRelevance01 ?? 0, similarityScore >= nearIdenticalRawMin ? 0.62 : 0.5);
            finalRelevanceSource = "dress_silhouette_cap";
          } else if (typeComp < 0.12) {
            finalRelevance01 = Math.min(finalRelevance01 ?? 0, similarityScore >= nearIdenticalRawMin ? 0.7 : 0.58);
            finalRelevanceSource = "type_conflict_cap";
          }
        } else if (typeComp < 0.28) {
          finalRelevance01 = Math.min(finalRelevance01 ?? 0, similarityScore >= nearIdenticalRawMin ? 0.36 : 0.3);
          finalRelevanceSource = "type_conflict_cap";
        }
      }

      const hasHardColorConflictAfterCorrection =
        finalRelevanceSource === "catalog_color_correction" &&
        hasColorIntentForFinal &&
        (explainColorCompliance ?? 0) <= 0.01;
      const canApplyPersonalization =
        (finalRelevanceSource === "computed" || finalRelevanceSource === "catalog_color_correction") &&
        !hasHardColorConflictAfterCorrection &&
        !(
          hasDetectionAnchoredTypeIntent &&
          compliance &&
          (
            ((compliance.hasSleeveIntent ?? false) && (compliance.sleeveCompliance ?? 0) < 0.12) ||
            ((compliance.productTypeCompliance ?? 0) < 0.28)
          )
        );
      if (canApplyPersonalization) {
        const contextBoost01 = scoreImageSearchContext01({
          product: p,
          sessionFilters: filters,
          lifestyle: userLifestyle,
        });
        if (contextBoost01 > 0) {
          const baseRelevance = Math.max(0, finalRelevance01 ?? 0);
          const personalized = clamp01(Math.max(baseRelevance, baseRelevance * 0.88 + contextBoost01 * 0.12));
          if (personalized > baseRelevance + 1e-6) {
            finalRelevance01 = personalized;
            if (finalRelevanceSource === "computed") {
              finalRelevanceSource = "context_personalization";
            }
          }
        }
      }

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
        finalRelevance01,
        explain: compliance
          ? {
            // ── Raw signals ──────────────────────────────────────
            clipCosine: compliance.osSimilarity01,
            merchandiseSimilarity: merchandiseSimById.get(idStr) ?? compliance.osSimilarity01,
            catalogAlignment: merchAlignmentById.get(idStr) ?? 1,
            colorEmbeddingSim: colorSimRaw,
            styleEmbeddingSim: styleSimRaw,
            patternEmbeddingSim: patternSim,
            textureEmbeddingSim: textureSim,
            materialEmbeddingSim: materialSim,
            deepFusionTextAlignment: deepFusionText,
            deepFusionScore,

            // ── Blended effective similarities ───────────────────
            colorSimEffective: colorSim,
            styleSimEffective: styleSim,

            // ── Type taxonomy ────────────────────────────────────
            exactTypeScore: compliance.exactTypeScore,
            siblingClusterScore: compliance.siblingClusterScore,
            parentHypernymScore: compliance.parentHypernymScore,
            intraFamilyPenalty: compliance.intraFamilyPenalty,
            productTypeCompliance: compliance.productTypeCompliance,
            categoryScore: compliance.categoryRelevance01,

            // ── Metadata compliance (0-1) ────────────────────────
            colorCompliance: explainColorCompliance,
            matchedColor: explainMatchedColor ?? undefined,
            colorTier: explainColorTier,
            styleCompliance: compliance.styleCompliance,
            sleeveCompliance: compliance.sleeveCompliance,
            lengthCompliance: (compliance as any).lengthCompliance ?? 0,
            audienceCompliance: compliance.audienceCompliance,

            // ── Penalties ────────────────────────────────────────
            crossFamilyPenalty: compliance.crossFamilyPenalty,
            hardBlocked: compliance.hardBlocked,

            // ── Multi-signal reranking ───────────────────────────
            taxonomyMatch,
            blipAlignment: blipAlignById.get(idStr) ?? 0,
            blipColorConflictFactor: blipColorConflictFactorById.get(idStr) ?? 1,
            colorContradictionPenalty: (compliance as any).colorContradictionPenalty ?? 1,
            keywordSubtypeBoost: keywordSubtypeBoostById.get(idStr) ?? 0,
            keywordSubtypeOverlap: keywordSubtypeOverlapById.get(idStr) ?? 0,
            keywordSubtypeExactHit: keywordSubtypeExactHitById.get(idStr) ?? false,
            imageCompositeScore,
            imageCompositeScore01,

            // ── Fused scores (actually used in finalRelevance01) ─
            fusedVisual: fusedVisualById.get(idStr) ?? 0,
            metadataCompliance: metadataComplianceById.get(idStr) ?? 0,

            // ── Intent flags ─────────────────────────────────────
            hasTypeIntent: compliance.hasTypeIntent,
            hasColorIntent: desiredColorsForRelevance.length > 0,
            colorIntentGatesFinalRelevance: compliance.hasColorIntent,
            hasStyleIntent: styleIntentGatesFinalRelevance,
            hasSleeveIntent: Boolean(compliance.hasSleeveIntent),
            hasLengthIntent: Boolean((compliance as any).hasLengthIntent),

            // ── Intent context ───────────────────────────────────
            desiredProductTypes,
            desiredColors: hasColorIntentForFinal ? desiredColorsForRelevance : [],
            desiredColorsExplicit: explicitColorsForRelevance,
            desiredColorsEffective: desiredColorsForRelevance,
            colorIntentSource: hasExplicitColorIntent
              ? "explicit"
              : inferredColorTokens.length > 0
                ? "inferred"
                : hasCropColorSignal
                  ? "crop"
                  : "none",
            desiredStyle: desiredStyleForRelevance,
            desiredSleeve: desiredSleeveForRelevance,
            desiredLength: (compliance as any).hasLengthIntent ? (desiredLengthForRelevance ?? undefined) : undefined,
            colorMode: rerankColorModeForRelevance,
            relevanceIntentDebug,

            // ── Final score ──────────────────────────────────────
            finalRelevance01,
            finalRelevanceSource,
          }
          : undefined,
        images: imagesOut,
      };
    }) as ProductResult[];
  }
  // Final hard contradiction guard on hydrated product metadata.
  // This prevents opposite-gender and shorts-vs-trousers leaks when index fields are sparse/noisy.
  if ((queryGenderNormForPost || shouldRejectShortsForTrouserIntent) && results.length > 0) {
    results = results.filter((p: any) => {
      const src = p as Record<string, unknown>;
      if (queryGenderNormForPost && hasOppositeGenderSignalForQuery(src, queryGenderNormForPost)) {
        return false;
      }
      // Detection-scoped image search needs a hard numeric audience guard because many
      // catalog rows don't carry clean gender keywords for the heuristic checker.
      if (queryGenderNormForPost && hasDetectionAnchoredTypeIntent) {
        const audienceCompliance = Number((p as any)?.explain?.audienceCompliance ?? 1);
        const isFootwearDetection =
          String(params.detectionProductCategory ?? "").toLowerCase().trim() === "footwear" ||
          String(params.detectionProductCategory ?? "").toLowerCase().trim() === "shoes";
        const minAudienceCompliance = isFootwearDetection ? 0.75 : 0.45;
        if (audienceCompliance < minAudienceCompliance) return false;
      }
      if (shouldRejectShortsForTrouserIntent && isShortsCatalogCandidate(src)) {
        return false;
      }
      return true;
    });
  }

  const countAfterHydration = results.length;

  const resultsBeforeFinalRelevanceFilter = results;
  const sparseHydratedApparelPool =
    apparelDetectionCategory &&
    hasDetectionAnchoredTypeIntent &&
    resultsBeforeFinalRelevanceFilter.length > 0 &&
    resultsBeforeFinalRelevanceFilter.length <= 12;
  const effectiveFinalResultMin = sparseHydratedApparelPool
    ? Math.min(effectiveFinalAcceptMin, hasStrongVisualEvidence ? 0.14 : 0.18)
    : effectiveFinalAcceptMin;
  results = results.filter(
    (p: any) =>
      typeof p.finalRelevance01 === "number" && p.finalRelevance01 >= effectiveFinalResultMin,
  ) as ProductResult[];

  const strongVisualOverrideMax = imageStrongVisualOverrideMaxCount();
  const droppedByFinalRelevanceBeforeOverride = Math.max(0, resultsBeforeFinalRelevanceFilter.length - results.length);
  let rescuedByStrongVisualOverride = 0;
  if (strongVisualOverrideMax > 0 && resultsBeforeFinalRelevanceFilter.length > results.length) {
    const existingIds = new Set(results.map((p) => String((p as any).id)));
    const inferredColorCanGateStrongOverride =
      hasInferredColorSignal &&
      !hasExplicitColorIntent &&
      !(
        hasDetectionAnchoredTypeIntent &&
        (params.detectionProductCategory === "tops" || params.detectionProductCategory === "bottoms")
      );
    const strongColorIntent = hasExplicitColorIntent || inferredColorCanGateStrongOverride;
    const isDressDetectionForOverride =
      String(params.detectionProductCategory ?? "").toLowerCase().trim() === "dresses";
    const strongMisses = resultsBeforeFinalRelevanceFilter
      .filter((p: any) => !existingIds.has(String(p.id)))
      .filter((p: any) => {
        const sim = typeof p.similarity_score === "number" ? p.similarity_score : 0;
        if (sim < strongVisualOverrideMinSim) return false;
        const explainAny = p.explain as any;
        if ((explainAny?.hardBlocked ?? false) === true) return false;
        if (!hasKidsAudienceIntent && hasChildAudienceSignals(p as Record<string, unknown>)) return false;
        const crossFamily = Number(explainAny?.crossFamilyPenalty ?? 0);
        if (crossFamily >= 0.55) return false;
        if (hasDetectionAnchoredTypeIntent) {
          const typeComp = Number(explainAny?.productTypeCompliance ?? 0);
          const exactType = Number(explainAny?.exactTypeScore ?? 0);
          if (isDressDetectionForOverride) {
            const onePieceCandidate = isOnePieceCatalogCandidate(p as Record<string, unknown>);
            // Dress metadata can miss one-piece cues; keep visually strong candidates.
            if (!onePieceCandidate && sim < 0.95) return false;
            if (exactType < 1 && typeComp < 0.14 && !onePieceCandidate) return false;
          } else if (exactType < 1 && typeComp < 0.2) {
            return false;
          }
        }
        if (strongColorIntent) {
          const colorCompliance = Number(explainAny?.colorCompliance ?? 0);
          const colorTier = String(explainAny?.colorTier ?? "none").toLowerCase();
          const minColorCompliance = isFootwearDetectionIntent
            ? (hasExplicitColorIntent ? 0.46 : 0.42)
            : (hasExplicitColorIntent ? 0.42 : 0.28);
          if (colorTier === "exact" && colorCompliance < 0.24) return false;
          if (colorTier === "family" && colorCompliance < 0.46) return false;
          if (colorTier === "bucket" && colorCompliance < 0.58) return false;
          if (colorTier === "none" && colorCompliance < 0.34) return false;
          if (colorCompliance < minColorCompliance) return false;
        }
        return true;
      })
      .slice(0, strongVisualOverrideMax)
      .map((p: any) => {
        const sim = typeof p.similarity_score === "number" ? p.similarity_score : 0;
        const currentRel = typeof p.finalRelevance01 === "number" ? p.finalRelevance01 : 0;
        const lifted = Math.max(currentRel, Math.min(1, sim * 0.86));
        return {
          ...p,
          finalRelevance01: lifted,
          explain: p.explain
            ? {
              ...(p.explain as any),
              finalRelevance01: lifted,
              finalRelevanceSource: "strong_visual_override",
            }
            : p.explain,
        };
      });
    if (strongMisses.length > 0) {
      rescuedByStrongVisualOverride = strongMisses.length;
      results = [...results, ...strongMisses] as ProductResult[];
    }
  }

  if (results.length === 0 && resultsBeforeFinalRelevanceFilter.length > 0) {
    imageSearchPipelineDegraded = true;
    const detectionCategoryNorm = String(params.detectionProductCategory ?? "").toLowerCase().trim();
    const topFocusedFallback = detectionCategoryNorm === "tops"
      ? resultsBeforeFinalRelevanceFilter.filter((p: any) => {
        const sim = typeof p.similarity_score === "number" ? p.similarity_score : 0;
        const ex = (p.explain ?? {}) as any;
        const typeComp = Number(ex.productTypeCompliance ?? 0);
        const exactType = Number(ex.exactTypeScore ?? 0);
        const crossFamily = Number(ex.crossFamilyPenalty ?? 0);
        const styleComp = Number(ex.styleCompliance ?? 0);
        const sleeveComp = Number(ex.sleeveCompliance ?? 0);

        if (crossFamily >= 0.5) return false;
        if (exactType >= 1) return true;
        if (typeComp >= 0.5 && sim >= 0.62) return true;
        if (typeComp >= 0.36 && sim >= 0.7 && (styleComp >= 0.12 || sleeveComp >= 0.12)) return true;
        return sim >= 0.9 && typeComp >= 0.28;
      })
      : resultsBeforeFinalRelevanceFilter;
    const fallbackPool = topFocusedFallback.length > 0 ? topFocusedFallback : resultsBeforeFinalRelevanceFilter;
    results = fallbackPool
      .map((p: any) => {
        const currentRel = typeof p.finalRelevance01 === "number" ? p.finalRelevance01 : 0;
        const sim = typeof p.similarity_score === "number" ? p.similarity_score : 0;
        return {
          ...p,
          finalRelevance01: Math.max(currentRel, sim * 0.85, effectiveFinalAcceptMin),
        };
      })
      .sort((a: any, b: any) => (b.finalRelevance01 ?? 0) - (a.finalRelevance01 ?? 0))
      .slice(0, limit) as ProductResult[];
  }

  if (hasDetectionAnchoredTypeIntent) {
    const isDressDetection = String(params.detectionProductCategory ?? "").toLowerCase().trim() === "dresses";
    const filtered = results.filter((p: any) => {
      const ex = (p.explain ?? {}) as any;
      const typeComp = Number(ex.productTypeCompliance ?? 0);
      const exactType = Number(ex.exactTypeScore ?? 0);
      const crossFamily = Number(ex.crossFamilyPenalty ?? 0);
      const styleComp = Number(ex.styleCompliance ?? 0);
      const sim = typeof p.similarity_score === "number" ? p.similarity_score : 0;
      const onePieceCandidate = isDressDetection
        ? isOnePieceCatalogCandidate(p as unknown as Record<string, unknown>)
        : false;
      if (!hasKidsAudienceIntent && hasChildAudienceSignals(p as Record<string, unknown>)) return false;
      if (enforceSleeveGate) {
        const observedSleeve = inferCatalogSleeveToken(p as unknown as Record<string, unknown>);
        const sleeveMin = desiredSleeveNorm === "long" ? 0.55 : 0.42;
        const sleeveCompliance = Number(ex.sleeveCompliance ?? 0);
        if (Number.isFinite(sleeveCompliance) && sleeveCompliance < sleeveMin && sim < 0.93 && !observedSleeve) {
          return false;
        }
        if (
          (desiredSleeveNorm === "long" || desiredSleeveNorm === "short" || desiredSleeveNorm === "sleeveless") &&
          observedSleeve &&
          observedSleeve !== desiredSleeveNorm
        ) {
          return false;
        }
      }
      // Keep tops robust when style is inferred (soft); hard-gate only on explicit style intent.
      if (params.detectionProductCategory === "tops" && hasExplicitStyleIntent && styleComp < 0.2 && sim < 0.96) return false;
      if (crossFamily >= 0.5) return false;
      if (isDressDetection) {
        const dressVisualOverrideMin = (() => {
          const yoloConfidence = params.detectionYoloConfidence ?? 0;
          if (yoloConfidence >= 0.9) return 0.88;
          if (yoloConfidence >= 0.8) return 0.9;
          return 0.92;
        })();
        if (!onePieceCandidate && sim < dressVisualOverrideMin) return false;
        if (exactType >= 1 || typeComp >= 0.14 || onePieceCandidate) return true;
        return sim >= dressVisualOverrideMin && crossFamily < 0.42;
      }
      if (exactType >= 1 || typeComp >= 0.3) return true;
      return sim >= 0.96 && crossFamily < 0.35;
    });
    if (filtered.length > 0) {
      results = filtered as ProductResult[];
    } else {
      // Bug fix: do not keep the full unfiltered list when strict late filtering
      // returns zero. Keep a small safe fallback instead.
      const safeFallback = results.filter((p: any) => {
        const ex = (p.explain ?? {}) as any;
        const typeComp = Number(ex.productTypeCompliance ?? 0);
        const exactType = Number(ex.exactTypeScore ?? 0);
        const crossFamily = Number(ex.crossFamilyPenalty ?? 0);
        const sim = typeof p.similarity_score === "number" ? p.similarity_score : 0;
        if (crossFamily >= 0.45) return false;
        if (isDressDetection) {
          const onePieceCandidate = isOnePieceCatalogCandidate(p as Record<string, unknown>);
          if (!onePieceCandidate && sim < 0.95) return false;
          if (exactType >= 1 || typeComp >= 0.12 || onePieceCandidate) return true;
          return sim >= 0.94;
        }
        if (exactType >= 1 || typeComp >= 0.18) return true;
        return sim >= 0.97;
      });
      if (safeFallback.length > 0) {
        results = safeFallback as ProductResult[];
      }
    }
  }

  // Final hard family gate: rescue/override paths can re-introduce visually-similar
  // but category-incorrect items. Clamp to detection category family at the end.
  const detectionCategoryForFinalGate = String(params.detectionProductCategory ?? "").toLowerCase().trim();
  if (
    imageStrictFinalDetectionCategoryGateEnabled() &&
    detectionCategoryForFinalGate &&
    isStrictDetectionCategory(detectionCategoryForFinalGate)
  ) {
    const familyStrict = results.filter((p: any) =>
      passesStrictDetectionCategoryFamily(
        p as unknown as Record<string, unknown>,
        detectionCategoryForFinalGate,
      ),
    );

    if (familyStrict.length > 0) {
      results = familyStrict as ProductResult[];
    } else {
      // Keep only very strong, low-contradiction candidates when metadata is sparse.
      const familySafeFallback = results.filter((p: any) => {
        const ex = (p.explain ?? {}) as any;
        const typeComp = Number(ex.productTypeCompliance ?? 0);
        const exactType = Number(ex.exactTypeScore ?? 0);
        const crossFamily = Number(ex.crossFamilyPenalty ?? 0);
        const sim = typeof p.similarity_score === "number" ? p.similarity_score : 0;
        const isDressFinalGate = detectionCategoryForFinalGate === "dresses";
        const isTopFinalGate = detectionCategoryForFinalGate === "tops";
        const isBottomFinalGate = detectionCategoryForFinalGate === "bottoms";
        const typeFloor = isDressFinalGate
          ? 0.72
          : isTopFinalGate || isBottomFinalGate
            ? 0.42
            : 0.82;
        const simFloor = isDressFinalGate
          ? 0.95
          : isTopFinalGate || isBottomFinalGate
            ? 0.94
            : 0.985;
        return crossFamily < 0.22 && (exactType >= 1 || typeComp >= typeFloor || sim >= simFloor);
      });
      if (familySafeFallback.length > 0) {
        results = familySafeFallback as ProductResult[];
      } else {
        // Fail closed for strict detection categories: if no family-safe candidates
        // remain, do not return unrelated category leakage.
        results = [];
      }
    }
  }

  // Always sort by finalRelevance01 descending as the primary signal.
  // For visual-primary (broad) searches, use similarity_score as a tie-breaker
  // only when finalRelevance01 values are very close.
  results.sort((a: any, b: any) => {
    const fa = a.finalRelevance01 ?? 0;
    const fb = b.finalRelevance01 ?? 0;
    if (Math.abs(fb - fa) > 1e-6) return fb - fa;
    if (imageSearchVisualPrimaryRanking) {
      const vs = (b.similarity_score ?? 0) - (a.similarity_score ?? 0);
      if (Math.abs(vs) > 1e-6) return vs;
    }
    return 0;
  });

  const dedupedResults = dedupeImageSearchResults(results as any) as ProductResult[];
  const countAfterDedupe = dedupedResults.length;
  const droppedByDedupe = Math.max(0, results.length - countAfterDedupe);
  const variantCollapsingApplied = collapseVariantGroupsRequested !== false;
  const variantCollapsed = variantCollapsingApplied
    ? collapseVariantGroups(dedupedResults)
    : { results: dedupedResults, groupCount: 0, representativeCount: dedupedResults.length };
  const variantGroupCount = variantCollapsed.groupCount;
  const variantRepresentativeCount = variantCollapsed.representativeCount;
  const preserveColorCohesionForDetection =
    hasDetectionAnchoredTypeIntent &&
    hasColorIntentForFinal &&
    (detectionCategoryForFinalGate === "tops" ||
      detectionCategoryForFinalGate === "bottoms" ||
      detectionCategoryForFinalGate === "dresses");
  const diversityRerankApplied =
    imageDiversityRerankEnabled() &&
    variantCollapsed.results.length > 2 &&
    !preserveColorCohesionForDetection;
  const diversityLambda = imageDiversityLambda();
  const diversityPoolCap = imageDiversityPoolCap();
  if (diversityRerankApplied) {
    const head = variantCollapsed.results.slice(0, Math.max(limit, diversityPoolCap));
    const tail = variantCollapsed.results.slice(Math.max(limit, diversityPoolCap));
    const rerankedHead = applyImageDiversityRerank(head as ProductResult[], diversityLambda);
    results = [...rerankedHead, ...tail].slice(0, limit) as ProductResult[];
  } else {
    results = variantCollapsed.results.slice(0, limit) as ProductResult[];
  }
  const finalReturnedCount = results.length;
  const droppedByLimit = Math.max(0, countAfterDedupe - finalReturnedCount);

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
  // pHash is often stored on product_images (primary row) while products.p_hash is unset — union both.
  if (pHash && /^[0-9a-f]+$/i.test(pHash)) {
    const existing = new Set(results.map((p) => String(p.id)));
    const hasIsHidden = await productsTableHasIsHiddenColumn();
    const hiddenClause = hasIsHidden ? "AND p.is_hidden = false" : "";
    const ph = String(pHash).toLowerCase();
    const exactPhashRows = await pg.query(
      `SELECT id FROM (
         SELECT p.id
           FROM products p
          WHERE LOWER(p.p_hash) = $1
            ${hiddenClause}
         UNION
         SELECT p.id
           FROM product_images pi
           INNER JOIN products p ON p.id = pi.product_id
          WHERE pi.p_hash IS NOT NULL
            AND LOWER(pi.p_hash) = $1
            ${hiddenClause}
       ) x
       LIMIT 10`,
      [ph],
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
      exact_cosine_rerank: exactCosineRerank,
      dual_knn_fusion: useDualKnn,
      image_rank_visual_first: imageSearchVisualPrimaryRanking,
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
      knn_retrieval_k: retrievalK,
      merchandise_similarity_binding: imageMerchandiseSimilarityBindingEnabled(),
      endpoint_limit: limit,
      limit_per_item: null,
      image_similarity_threshold_used: similarityThreshold,
      threshold_relaxed: thresholdRelaxed,
      relax_floor_used: relaxFloorUsed,
      image_search_pipeline_degraded: imageSearchPipelineDegraded,
      deep_fusion_enabled: imageDeepFusionEnabled(),
      deep_fusion_weight: imageDeepFusionWeight(),
      diversity_rerank_applied: diversityRerankApplied,
      diversity_lambda: diversityLambda,
      diversity_pool_cap: diversityPoolCap,
      session_id: sessionId,
      user_id: userId,
      personalization_applied: personalizationApplied,
      variant_group_collapsing_applied: variantCollapsingApplied,
      variant_group_count: variantGroupCount,
      variant_group_representatives: variantRepresentativeCount,
      relevance_intent: relevanceIntentDebug,
      drops_debug: {
        dropped_by_category_safety: droppedByCategorySafety,
        dropped_by_visual_threshold: droppedByVisualThreshold,
        dropped_by_final_relevance_before_override: droppedByFinalRelevanceBeforeOverride,
        rescued_by_strong_visual_override: rescuedByStrongVisualOverride,
        dropped_by_dedupe: droppedByDedupe,
        dropped_by_limit: droppedByLimit,
      },
    });
  }

  return {
    results,
    related: related.length > 0 ? related : undefined,
    meta: {
      relevance_intent: relevanceIntentDebug,
      threshold: similarityThreshold,
      total_results: results.length,
      total_related: related.length,
      image_search_pipeline_degraded: imageSearchPipelineDegraded,
      blip_signal_applied: Boolean(blipSignal && (blipSignal.confidence ?? 0) > 0),
      batch_composite_influence: batchCompositeInfluence,
      below_relevance_threshold: belowRelevanceThreshold,
      threshold_relaxed: thresholdRelaxed,
      final_accept_min: config.search.finalAcceptMinImage,
      final_accept_min_effective: effectiveFinalAcceptMin,
      relevance_relaxed_for_min_count: relevanceRelaxedForMinCount,
      image_min_results_target: imageMinResultsTarget,
      below_final_relevance_gate: belowFinalRelevanceGate,
      relevance_gate_soft: false,
      image_knn_field: knnFieldResolved,
      debug_raw_cosine_bypass_used: false,
      deep_fusion_enabled: imageDeepFusionEnabled(),
      deep_fusion_weight: imageDeepFusionWeight(),
      diversity_rerank_applied: diversityRerankApplied,
      diversity_lambda: diversityLambda,
      diversity_pool_cap: diversityPoolCap,
      session_id: sessionId,
      user_id: userId,
      personalization_applied: personalizationApplied,
      variant_group_collapsing_applied: variantCollapsingApplied,
      variant_group_count: variantGroupCount,
      variant_group_representatives: variantRepresentativeCount,
      pipeline_counts: {
        exact_cosine_rerank: exactCosineRerank,
        dual_knn_fusion: useDualKnn,
        image_rank_visual_first: imageSearchVisualPrimaryRanking,
        raw_open_search_hits: rawOpenSearchHitCount,
        base_candidates: baseCandidates.length,
        ranked_candidates: rankedHitsCandidates.length,
        dropped_by_category_safety: droppedByCategorySafety,
        threshold_passed_visual: thresholdPassedByVisual.length,
        visual_gated_hits: visualGatedHits.length,
        dropped_by_visual_threshold: droppedByVisualThreshold,
        hits_after_final_accept_min: countAfterFinalAcceptMin,
        dropped_by_final_relevance_before_override: droppedByFinalRelevanceBeforeOverride,
        rescued_by_strong_visual_override: rescuedByStrongVisualOverride,
        hits_after_color_postfilter: countAfterColorPostfilter,
        hits_after_hydration: countAfterHydration,
        dropped_by_dedupe: droppedByDedupe,
        hits_after_dedupe: countAfterDedupe,
        dropped_by_limit: droppedByLimit,
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
  const filter: any[] = [{ bool: { must_not: [{ term: { is_hidden: true } }] } }];

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
      relatedLimit,
      {
        relevanceQuery: parsedQuery.semanticQuery?.trim() || effectiveQuery,
        expandedTerms: parsedQuery.expandedTerms,
        colorHints: parsedQuery.entities.colors ?? [],
      },
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
  const filter: any[] = [{ bool: { must_not: [{ term: { is_hidden: true } }] } }];

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
            filter: [{ bool: { must_not: [{ term: { is_hidden: true } }] } }],
          },
        },
      };

      try {
        const resp = await osClient.search({ index: config.opensearch.index, body: clipBody });
        const hits = resp.body.hits.hits || [];

        for (const hit of hits) {
          const id = String(hit._source.product_id);
          if (id === String(base.id)) continue;
          const rawScore = Number(hit._score) || 0;
          const visualSim = knnCosinesimilScoreToCosine01(rawScore);
          clipRawMap.set(id, rawScore);
          clipScoreMap.set(id, Math.round(visualSim * 1000) / 1000);
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
        textQuery.query.bool.filter.push({ bool: { must_not: [{ term: { is_hidden: true } }] } });

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

  // Sort by combined similarity score first; source is metadata only.
  candidates.sort((a, b) => {
    const scoreA = a.clipSim * 0.6 + a.textSim * 0.4;
    const scoreB = b.clipSim * 0.6 + b.textSim * 0.4;
    if (Math.abs(scoreB - scoreA) > 1e-8) return scoreB - scoreA;
    return b.clipSim - a.clipSim;
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






