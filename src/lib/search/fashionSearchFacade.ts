/**
 * Fashion Search Facade
 *
 * Phase 0 goal: provide one stable API for both legacy (`/products/search*`)
 * and enhanced (`/api/search*`) endpoints.
 *
 * It standardizes:
 * - `results` and `related` to match `src/routes/products/types.ts` ProductResult
 * - hydrates products + images consistently
 *
 * Later phases (1-3) will improve parsing, strict filtering, and reranking inside
 * the shared pipelines used by this facade.
 */

import type { SearchFilters as LegacySearchFilters, ProductResult, SearchResultWithRelated } from "../../routes/products/types";
import type { QueryAST } from "../../lib/queryProcessor";
import type { NegationConstraint } from "../../lib/queryProcessor/negationHandler";

import { textSearch as enhancedTextSearch } from "../../routes/search/search.service";

import { searchByImageWithSimilarity as legacyImageSearch } from "../../routes/products/products.service";
import { searchProductsFilteredBrowse } from "./filteredBrowseSearch";
import { getSession } from "../queryProcessor/conversationalContext";

import {
  processImageForEmbedding,
  computeImageSearchGarmentQueryEmbedding,
  computePHash,
} from "../image";
import { tieredColorMatchScore } from "../color/colorCanonical";
import { getYOLOv8Client } from "../image/yolov8Client";
import {
  mapDetectionToCategory,
  getSearchCategories,
  shouldUseAlternatives,
} from "../detection/categoryMapper";
import {
  expandProductTypesForQuery,
  extractLexicalProductTypeSeeds,
  filterProductTypeSeedsByMappedCategory,
} from "./productTypeTaxonomy";
import { config } from "../../config";

export interface UnifiedTextSearchParams {
  query: string;
  filters?: Partial<LegacySearchFilters>;
  page?: number;
  limit?: number;
  includeRelated?: boolean;
  relatedLimit?: number;
  // When true, uses the enhanced query parsing/ranking path.
  // (Currently the enhanced implementation is used by this facade.)
  useEnhanced?: boolean;
  /** Parsed exclusions ("not red", …) → bool.must_not on the text index. */
  negationConstraints?: NegationConstraint[];
}

export interface UnifiedImageSearchParams {
  imageBuffer?: Buffer;
  imageEmbedding?: number[];
  /** Garment ROI CLIP vector; optional second stage vs index `embedding_garment` (see SEARCH_IMAGE_DUAL_GARMENT_FUSION). */
  imageEmbeddingGarment?: number[];
  filters?: Partial<LegacySearchFilters>;
  limit?: number;
  similarityThreshold?: number;
  includeRelated?: boolean;
  pHash?: string;
  predictedCategoryAisles?: string[];
  detectionYoloConfidence?: number;
  detectionProductCategory?: string;
  knnField?: string;
  /**
   * Forces image search into hard category mode for this call.
   * When enabled, the OpenSearch `filters.category` terms are applied even when
   * soft category is the default (`SEARCH_IMAGE_SOFT_CATEGORY` on or unset).
   */
  forceHardCategoryFilter?: boolean;
  relaxThresholdWhenEmpty?: boolean;
  /** Caption/BLIP-derived type tokens — taxonomy soft signal only (see `searchByImageWithSimilarity`). */
  softProductTypeHints?: string[];
  /** Structured BLIP signal used for rerank alignment (no hard filter semantics). */
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
  inferredPrimaryColor?: string | null;
  inferredColorsByItem?: Record<string, string | null>;
  inferredColorsByItemConfidence?: Record<string, number>;
  inferredColorKey?: string | null;
  /** Debug path: bypass rerank/final gates in products.service and return top-k raw exact-cosine hits. */
  debugRawCosineFirst?: boolean;
  sessionId?: string;
  userId?: number;
  sessionFilters?: Partial<LegacySearchFilters>;
  collapseVariantGroups?: boolean;
}

function normalizeParentUrlKey(raw: string | null | undefined): string {
  const cleaned = String(raw ?? "").trim();
  if (!cleaned) return "";
  try {
    const u = new URL(cleaned);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length > 0 && /^[a-z]{2}(?:-[a-z]{2})?$/i.test(parts[0])) {
      parts.shift();
    }
    return `${u.origin.toLowerCase()}/${parts.join("/").toLowerCase()}`;
  } catch {
    const withoutFragment = cleaned.split("#")[0];
    const withoutQuery = withoutFragment.split("?")[0];
    return withoutQuery.toLowerCase();
  }
}

function collapseByParentProduct<T extends ProductResult>(items: T[] | undefined): T[] | undefined {
  if (!items || items.length <= 1) return items;
  const out: T[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const parent = normalizeParentUrlKey(item.parent_product_url ?? "");
    const vendor = String(item.vendor_id ?? "").trim();
    const key = parent ? `${vendor}|${parent}` : `${vendor}|__id_${String(item.id)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function filterByFinalRelevance<T extends { finalRelevance01?: number }>(
  items: T[] | undefined,
  min: number,
  mode: "lenient" | "strict" = "lenient",
): T[] | undefined {
  if (!items) return items;
  const filtered = items.filter((item) => {
    const rel = item?.finalRelevance01;
    if (mode === "strict") return typeof rel === "number" && rel >= min;
    return typeof rel !== "number" || rel >= min;
  });
  if (mode === "strict") {
    return [...filtered].sort((a, b) => (b.finalRelevance01 ?? 0) - (a.finalRelevance01 ?? 0));
  }
  return filtered;
}

function expandPredictedTypeHints(seeds: string[]): string[] {
  const normalized = seeds.map((s) => String(s).toLowerCase().trim()).filter(Boolean);
  if (normalized.length === 0) return [];
  return expandProductTypesForQuery(normalized);
}

async function inferPredictedCategoryAislesFromImage(
  imageBuffer: Buffer | undefined,
): Promise<string[] | undefined> {
  if (!imageBuffer || imageBuffer.length === 0) return undefined;
  const timeoutMs = finiteEnvNumber(
    process.env.SEARCH_IMAGE_YOLO_TIMEOUT_MS,
    1200,
    200,
    8000,
  );
  try {
    const inner = async (): Promise<string[] | undefined> => {
      const yolo = getYOLOv8Client();
      const detected = await yolo.detectFromBuffer(imageBuffer, "search-image.jpg", { confidence: 0.4 });
      const items = Array.isArray(detected?.detections) ? detected.detections : [];
      if (items.length === 0) return undefined;
      const ranked = [...items].sort((a: any, b: any) => {
        const wa = (Number(a?.confidence) || 0) * (Number(a?.area_ratio) || 0);
        const wb = (Number(b?.confidence) || 0) * (Number(b?.area_ratio) || 0);
        return wb - wa;
      });
      const top = ranked[0];
      const label = String(top?.label ?? "").toLowerCase().trim();
      if (!label) return undefined;
      const categoryMapping = mapDetectionToCategory(label, Number(top?.confidence) || 0);
      const searchCategories = shouldUseAlternatives(categoryMapping)
        ? getSearchCategories(categoryMapping)
        : [categoryMapping.productCategory];
      const lexical = filterProductTypeSeedsByMappedCategory(
        extractLexicalProductTypeSeeds(label),
        categoryMapping.productCategory,
      );
      const expanded = expandPredictedTypeHints([label, ...searchCategories, ...lexical]);
      return expanded.length > 0 ? expanded : searchCategories;
    };
    return await Promise.race([
      inner(),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), timeoutMs)),
    ]);
  } catch {
    return undefined;
  }
}

function finiteEnvNumber(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || String(raw).trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

const ATHLETIC_INTENT_RE = /\b(sport|sportswear|athlet|training|workout|gym|fitness|running|jogging|activewear|yoga|crossfit)\b/i;
const ATHLETIC_PRODUCT_RE = /\b(sport|sportswear|athlet|training|workout|gym|fitness|running|runner|jogger|track\s?pant|trackpant|activewear|yoga|crossfit|dry\s?-?fit|dri\s?-?fit|leggings?)\b/i;
const ATHLETIC_BRAND_RE = /\b(adidas|nike|puma|reebok|asics|under\s?armou?r|new\s?balance|lululemon|gymshark)\b/i;

function isExplicitAthleticIntent(query: string | undefined, filters: Partial<LegacySearchFilters> | undefined): boolean {
  const parts: string[] = [];
  if (query) parts.push(query);
  const f: any = filters ?? {};
  if (typeof f.style === "string") parts.push(f.style);
  if (typeof f.softStyle === "string") parts.push(f.softStyle);
  if (Array.isArray(f.productTypes)) parts.push(f.productTypes.join(" "));
  if (typeof f.category === "string") parts.push(f.category);
  if (Array.isArray(f.category)) parts.push(f.category.join(" "));
  const blob = parts.join(" ").toLowerCase();
  if (!blob.trim()) return false;
  return ATHLETIC_INTENT_RE.test(blob);
}

function isAthleticProductCandidate(p: ProductResult): boolean {
  const blob = [p.title, p.description, p.category, p.brand]
    .filter((x) => x != null)
    .map((x) => String(x))
    .join(" ")
    .toLowerCase();
  if (!blob.trim()) return false;
  const byKeyword = ATHLETIC_PRODUCT_RE.test(blob);
  const byBrandAndSignal = ATHLETIC_BRAND_RE.test(String(p.brand ?? "")) && ATHLETIC_PRODUCT_RE.test(blob);
  return byKeyword || byBrandAndSignal;
}

function applyNonSportGuardToNormalSearch(
  items: ProductResult[] | undefined,
  query: string | undefined,
  filters: Partial<LegacySearchFilters> | undefined,
): ProductResult[] | undefined {
  if (!items || items.length === 0) return items;
  const guardEnabled = String(process.env.SEARCH_TEXT_NONSPORT_GUARD ?? "1").toLowerCase() !== "0";
  if (!guardEnabled) return items;
  if (isExplicitAthleticIntent(query, filters)) return items;

  const filtered = items.filter((p) => !isAthleticProductCandidate(p));
  // Keep recall: only apply when enough non-sport items remain.
  const minKeep = items.length >= 8 ? 4 : 1;
  return filtered.length >= minKeep ? filtered : items;
}

export async function searchBrowse(params: {
  filters?: Partial<LegacySearchFilters>;
  page?: number;
  limit?: number;
}): Promise<ProductResult[]> {
  const { filters = {}, page = 1, limit = 20 } = params;

  const normalizedFilters: any = {
    ...filters,
    vendorId:
      (filters as any)?.vendorId !== undefined
        ? typeof (filters as any)?.vendorId === "string"
          ? Number((filters as any).vendorId)
          : (filters as any).vendorId
        : undefined,
  };

  const results = (await searchProductsFilteredBrowse({
    filters: normalizedFilters,
    page,
    limit,
  })) as ProductResult[];
  const relevanceFiltered = filterByFinalRelevance(results, config.search.finalAcceptMinText) ?? [];
  return applyNonSportGuardToNormalSearch(relevanceFiltered, undefined, filters) ?? [];
}

/**
 * Unified text search
 *
 * Delegates to the enhanced `textSearch` pipeline, but returns the canonical
 * `SearchResultWithRelated` shape (ProductResult + images + related).
 */
export async function searchText(params: UnifiedTextSearchParams): Promise<SearchResultWithRelated & { total: number; tookMs: number }> {
  const {
    query,
    filters = {},
    page = 1,
    limit = 20,
    includeRelated = false,
    relatedLimit = 10,
    negationConstraints,
  } = params;

  // Normalize legacy filter shape to the enhanced pipeline shape.
  // Legacy uses `minPriceCents/maxPriceCents` (and optional `currency`), while
  // enhanced expects `minPrice/maxPrice` already in OpenSearch `price_usd`.
  const LBP_TO_USD = 89000;
  const currency = (filters as any)?.currency?.toUpperCase?.() ?? "LBP";
  const minPriceCents = (filters as any)?.minPriceCents;
  const maxPriceCents = (filters as any)?.maxPriceCents;

  const normalizedFilters: any = {
    ...filters,
    category: Array.isArray((filters as any)?.category) ? (filters as any)?.category[0] : (filters as any)?.category,
    vendorId:
      (filters as any)?.vendorId !== undefined
        ? typeof (filters as any)?.vendorId === "string"
          ? Number((filters as any).vendorId)
          : (filters as any).vendorId
        : undefined,
  };

  if (minPriceCents !== undefined || maxPriceCents !== undefined) {
    const range: any = {};
    if (currency === "USD") {
      if (minPriceCents !== undefined) range.gte = minPriceCents / 100;
      if (maxPriceCents !== undefined) range.lte = maxPriceCents / 100;
    } else {
      if (minPriceCents !== undefined) range.gte = Math.floor(minPriceCents / LBP_TO_USD);
      if (maxPriceCents !== undefined) range.lte = Math.ceil(maxPriceCents / LBP_TO_USD);
    }
    normalizedFilters.minPrice = range.gte;
    normalizedFilters.maxPrice = range.lte;
    delete normalizedFilters.minPriceCents;
    delete normalizedFilters.maxPriceCents;
    delete normalizedFilters.currency;
  }

  const { total, tookMs, ...rest } = await enhancedTextSearch(query, normalizedFilters, {
    limit,
    offset: (page - 1) * limit,
    includeRelated,
    relatedLimit,
    negationConstraints,
  } as any);

  const output = rest as SearchResultWithRelated;
  const filteredResultsBase = filterByFinalRelevance(output.results, config.search.finalAcceptMinText) ?? [];
  const filteredRelatedBase = filterByFinalRelevance(output.related, config.search.finalAcceptMinText);
  const filteredResults = applyNonSportGuardToNormalSearch(filteredResultsBase, query, filters) ?? [];
  const filteredRelated = applyNonSportGuardToNormalSearch(filteredRelatedBase, query, filters);
  const collapsedResults = collapseByParentProduct(filteredResults) ?? [];
  const collapsedRelated = collapseByParentProduct(filteredRelated);
  const meta = {
    ...(output.meta ?? {}),
    total_results: collapsedResults.length,
  };

  return {
    ...output,
    results: collapsedResults,
    related: collapsedRelated,
    meta,
    total: collapsedResults.length,
    tookMs,
  };
}

/**
 * Unified image search
 *
 * Delegates to `searchByImageWithSimilarity` in `products.service` (kNN, soft category, rerank).
 * That implementation returns:
 * - ProductResult hydration
 * - images[]
 * - optional pHash-based related results
 */
export async function searchImage(
  params: UnifiedImageSearchParams,
): Promise<SearchResultWithRelated & { total: number; tookMs: number }> {
  const {
    imageBuffer,
    imageEmbedding,
    imageEmbeddingGarment: garmentFromCaller,
    filters = {},
    limit = 20,
    similarityThreshold,
    includeRelated = false,
    pHash,
    predictedCategoryAisles,
    detectionYoloConfidence,
    detectionProductCategory,
    knnField,
    forceHardCategoryFilter,
    relaxThresholdWhenEmpty,
    softProductTypeHints,
    blipSignal,
    inferredPrimaryColor,
    inferredColorsByItem,
    inferredColorsByItemConfidence,
    inferredColorKey,
    debugRawCosineFirst,
    sessionId,
    userId,
    sessionFilters,
    collapseVariantGroups,
  } = params;

  if ((!imageEmbedding || imageEmbedding.length === 0) && !imageBuffer) {
    return { results: [], related: undefined, meta: { total_results: 0 }, total: 0, tookMs: 0 };
  }

  const start = Date.now();

  const embeddingDerivedFromBufferOnly =
    Boolean(imageBuffer?.length) &&
    (!imageEmbedding || imageEmbedding.length === 0);

  /** Query pixels aligned to embedded catalog (default: always rembg user photo when sidecar up). */
  let catalogAlignedBuffer: Buffer | undefined;
  if (embeddingDerivedFromBufferOnly && imageBuffer?.length) {
    const { prepareBufferForImageSearchQuery } = await import("../image/embeddingPrep");
    const prep = await prepareBufferForImageSearchQuery(imageBuffer);
    catalogAlignedBuffer = prep.buffer;
    if (String(process.env.SEARCH_IMAGE_PIPELINE_DEBUG ?? "").trim() === "1") {
      console.log("[searchImage] query image prep", {
        bgRemoved: prep.bgRemoved,
        inBytes: imageBuffer.length,
        outBytes: prep.buffer.length,
        SEARCH_IMAGE_QUERY_REMBG: process.env.SEARCH_IMAGE_QUERY_REMBG ?? "(default conditional)",
      });
    }
  }

  const embedding =
    imageEmbedding && imageEmbedding.length > 0
      ? imageEmbedding
      : await processImageForEmbedding(catalogAlignedBuffer!);

  const inheritedSessionFilters =
    sessionFilters ?? (sessionId ? (getSession(sessionId).accumulatedFilters as Partial<LegacySearchFilters>) : undefined);
  const mergedFilters = inheritedSessionFilters
    ? { ...inheritedSessionFilters, ...filters }
    : filters;

  const inferAislesEnv = () => {
    const v = String(process.env.SEARCH_IMAGE_INFER_YOLO_AISLES ?? "1").toLowerCase();
    return v !== "0" && v !== "false";
  };
  const derivedAisleHints =
    predictedCategoryAisles && predictedCategoryAisles.length > 0
      ? predictedCategoryAisles
      : inferAislesEnv() && imageBuffer
        ? await inferPredictedCategoryAislesFromImage(imageBuffer)
        : undefined;

  let imageEmbeddingGarment: number[] | undefined = garmentFromCaller;
  if (
    (!imageEmbeddingGarment || imageEmbeddingGarment.length === 0) &&
    embeddingDerivedFromBufferOnly &&
    catalogAlignedBuffer?.length
  ) {
    try {
      imageEmbeddingGarment = await computeImageSearchGarmentQueryEmbedding(catalogAlignedBuffer);
    } catch {
      imageEmbeddingGarment = undefined;
    }
  }
  if (imageEmbeddingGarment && imageEmbeddingGarment.length !== embedding.length) {
    imageEmbeddingGarment = undefined;
  }

  // When we have raw bytes but no caller-supplied hash, compute pHash once. Used for
  // related-by-pHash, Postgres identity rescue (same catalog image), and self-search — not only when includeRelated is on.
  // Callers that pass only `imageEmbedding` (no buffer) cannot be hashed here.
  let effectivePHash = typeof pHash === "string" ? pHash.toLowerCase().trim().replace(/[^0-9a-f]/g, "") : pHash;
  const hasValidPHash = typeof effectivePHash === "string" && effectivePHash.length > 0 && /^[0-9a-f]+$/i.test(effectivePHash);
  if (!hasValidPHash && imageBuffer && imageBuffer.length > 0) {
    try {
      effectivePHash = (await computePHash(imageBuffer)).toLowerCase().trim().replace(/[^0-9a-f]/g, "");
    } catch (e) {
      console.warn("[searchImage] pHash skipped (invalid or unreadable image bytes):", (e as Error).message);
    }
  }

  const res = await legacyImageSearch({
    imageEmbedding: embedding,
    imageEmbeddingGarment,
    /**
     * Query-prepared bytes (default always-rembg) for primary + attribute + garment CLIP.
     * pHash / YOLO aisles still use the original upload above.
     */
    imageBuffer:
      catalogAlignedBuffer && catalogAlignedBuffer.length > 0
        ? catalogAlignedBuffer
        : imageBuffer && Buffer.isBuffer(imageBuffer) && imageBuffer.length > 0
          ? imageBuffer
          : undefined,
    filters: mergedFilters as any,
    limit,
    similarityThreshold,
    includeRelated,
    pHash: effectivePHash,
    predictedCategoryAisles: derivedAisleHints,
    detectionYoloConfidence,
    detectionProductCategory,
    knnField,
    forceHardCategoryFilter,
    relaxThresholdWhenEmpty: relaxThresholdWhenEmpty ?? false,
    softProductTypeHints,
    blipSignal,
    inferredPrimaryColor,
    inferredColorsByItem,
    inferredColorsByItemConfidence,
    inferredColorKey,
    debugRawCosineFirst,
    sessionId,
    userId,
    sessionFilters: inheritedSessionFilters as any,
    collapseVariantGroups,
  } as any);

  const metaAny = res.meta as Record<string, unknown> | undefined;
  const effectiveMin =
    typeof metaAny?.final_accept_min_effective === "number"
      ? (metaAny.final_accept_min_effective as number)
      : config.search.finalAcceptMinImage;
  // Use "lenient" mode: keep items that have no finalRelevance01 score (rather
  // than dropping them) and let the upstream kNN + composite ordering dominate.
  // "strict" was silently discarding all hits whose relevance layer hadn't run
  // or whose score was depressed by threshold/preprocessing mismatches.
  const filteredResults = filterByFinalRelevance(res.results, effectiveMin, "lenient") ?? [];
  const filteredRelated = filterByFinalRelevance(res.related, effectiveMin, "lenient");
  const meta = {
    ...(res.meta ?? {}),
    total_results: filteredResults.length,
  };

  return {
    ...res,
    results: filteredResults,
    related: filteredRelated,
    meta,
    total: meta.total_results,
    tookMs: Date.now() - start,
  };
}

