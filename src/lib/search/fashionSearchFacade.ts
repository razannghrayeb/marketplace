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
import {
  extractProductFamily,
  resolveProductAudience,
  getAudienceCap,
  normalizeFamily,
  isStrongOppositeFamily,
} from "./familyGuard";
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
  imageMode?: "single_product" | "worn_outfit" | "flatlay_collage";
  detectionLabel?: string;
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
  /** Include heavy per-product debug payloads in response. */
  debug?: boolean;
  sessionId?: string;
  userId?: number;
  sessionFilters?: Partial<LegacySearchFilters>;
  collapseVariantGroups?: boolean;
  /** Optional request-scoped memo for rerank visual signals across recovery calls. */
  rerankSignalCache?: Map<string, unknown>;
}
type EnhancedTextSearchOutput = SearchResultWithRelated & { total: number; tookMs: number };

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

/**
 * PHASE 1-fix: Determine if a product should be rescued by strong visual match.
 *
 * Fashion-CLIP returns raw cosine similarities in [0, 1].
 * Strong visual matches (≥0.62) with acceptable family alignment should survive
 * even if final relevance gate would drop them.
 *
 * Thresholds:
 * - rawVisualSim ≥ 0.62: product visually similar to query
 * - family safe: product family matches intent or is "unknown" (no hard conflict)
 * - no hard color/audience conflict: safety checks
 */
function shouldKeepStrongVisualCandidate(params: {
  similarityScore?: number; // raw cosine [0, 1]
  clipCosine?: number; // explain.clipCosine [0, 1]
  normalizedFamily?: string | null;
  intentFamily?: string | null;
  hardColorConflict?: boolean;
  hardAudienceConflict?: boolean;
}): boolean {
  const rawSim = params.similarityScore ?? params.clipCosine ?? 0;
  
  // Visual: must be clearly similar
  if (rawSim < 0.62) return false;
  
  // Family: accept if product family matches intent, is unknown, or intent has no family
  const productFamily = String(params.normalizedFamily ?? "").toLowerCase().trim() || "unknown";
  const intentFamily = String(params.intentFamily ?? "").toLowerCase().trim();
  
  const familySafe =
    !intentFamily || // no intent family = safe
    productFamily === "unknown" || // unknown = safe
    productFamily === intentFamily; // exact match = safe
  
  if (!familySafe) return false;
  
  // Hard conflicts: color and audience must not violently disagree
  if (params.hardColorConflict || params.hardAudienceConflict) return false;
  
  return true;
}

/**
 * PHASE 2-fix: Stronger visual override with multi-tier confidence levels.
 *
 * Provides more aggressive rescue for visually similar products:
 * - High confidence (≥0.72): rescue almost anything except obvious mismatches
 * - Medium confidence (≥0.62): rescue with lenient family check
 * - Low confidence (≥0.55): minimal rescue only for safe families
 */
function getVisualOverrideTier(similarityScore: number): "high" | "medium" | "low" | null {
  if (similarityScore >= 0.72) return "high";
  if (similarityScore >= 0.62) return "medium";
  if (similarityScore >= 0.55) return "low";
  return null;
}

function shouldRescueByVisualTier(params: {
  similarityScore?: number;
  clipCosine?: number;
  normalizedFamily?: string | null;
  intentFamily?: string | null;
  hardColorConflict?: boolean;
  hardAudienceConflict?: boolean;
  // Phase 2: relax family checking
  allowCrossFamilyRescue?: boolean;
}): { rescue: boolean; tier: "high" | "medium" | "low" | null; reason?: string } {
  const rawSim = params.similarityScore ?? params.clipCosine ?? 0;
  const tier = getVisualOverrideTier(rawSim);
  
  if (!tier) return { rescue: false, tier: null, reason: "below_visual_threshold" };
  
  const productFamily = String(params.normalizedFamily ?? "").toLowerCase().trim() || "unknown";
  const intentFamily = String(params.intentFamily ?? "").toLowerCase().trim();
  
  // Hard conflicts always block rescue
  if (params.hardColorConflict) return { rescue: false, tier, reason: "hard_color_conflict" };
  if (params.hardAudienceConflict) return { rescue: false, tier, reason: "hard_audience_conflict" };
  
  // High tier: rescue despite family mismatch (Phase 2 aggressive)
  if (tier === "high") {
    return { rescue: true, tier, reason: "high_visual_confidence_override" };
  }
  
  // Medium tier: rescue if family safe or allow cross-family
  if (tier === "medium") {
    const familySafe =
      !intentFamily || // no intent family = safe
      productFamily === "unknown" || // unknown = safe
      productFamily === intentFamily; // exact match = safe
    
    if (familySafe || params.allowCrossFamilyRescue) {
      return { rescue: true, tier, reason: familySafe ? "family_safe" : "cross_family_relaxed" };
    }
    return { rescue: false, tier, reason: "family_mismatch" };
  }
  
  // Low tier: only rescue for obviously safe families
  if (tier === "low") {
    const isSafeFamily = productFamily === "unknown" || productFamily === intentFamily;
    if (isSafeFamily) {
      return { rescue: true, tier, reason: "low_visual_safe_family" };
    }
    return { rescue: false, tier, reason: "low_visual_risky_family" };
  }
  
  return { rescue: false, tier: null, reason: "unknown_tier" };
}

/**
 * PHASE 3-fix: Weighted sum scoring replacing multiplication-based formula.
 *
 * Instead of: score = rawVisual × typeScore × categoryScore (multiplication zeros out everything)
 * Use: score = 0.54·visual + 0.12·family + 0.08·type + 0.18·color + 0.04·style + 0.02·material + 0.02·audience
 *
 * No factor should multiply everything to zero. Weighted sum keeps strong visuals alive
 * while using metadata as reranking signals, not gatekeepers.
 */
function computeWeightedImageScore(params: {
  rawVisualSimilarity: number; // [0, 1]
  familyScore?: number; // [0, 1]
  typeScore?: number; // [0, 1]
  colorScore?: number; // [0, 1]
  styleScore?: number; // [0, 1]
  materialScore?: number; // [0, 1]
  audienceScore?: number; // [0, 1]
}): number {
  // Clamp all inputs to [0, 1]
  const visual = Math.max(0, Math.min(1, params.rawVisualSimilarity ?? 0));
  const family = Math.max(0, Math.min(1, params.familyScore ?? 1)); // default 1 = no penalty
  const type = Math.max(0, Math.min(1, params.typeScore ?? 1));
  const color = Math.max(0, Math.min(1, params.colorScore ?? 1));
  const style = Math.max(0, Math.min(1, params.styleScore ?? 1));
  const material = Math.max(0, Math.min(1, params.materialScore ?? 1));
  const audience = Math.max(0, Math.min(1, params.audienceScore ?? 1));
  
  // Weighted sum: visual is primary; color is second-strongest so same-color
  // products clearly outrank color-mismatched ones at equal CLIP scores.
  const score =
    0.47 * visual +
    0.10 * family +
    0.08 * type +
    0.27 * color +
    0.04 * style +
    0.02 * material +
    0.02 * audience;
  
  return Math.max(0, Math.min(1, score));
}

function expandPredictedTypeHints(seeds: string[]): string[] {
  const normalized = seeds.map((s) => String(s).toLowerCase().trim()).filter(Boolean);
  if (normalized.length === 0) return [];
  return expandProductTypesForQuery(normalized);
}

/**
 * PHASE D-fix: Log per-candidate drop reason for debugging.
 *
 * Tracks why each product was dropped at each stage:
 * - finalRelevance gate too low
 * - family mismatch  
 * - color conflict
 * - audience conflict
 * - post-hydration guard
 */
interface CandidateDropLog {
  id: string;
  title?: string;
  category?: string | null;
  similarity_score?: number;
  rawVisualSim?: number;
  finalRelevance01?: number;
  intentFamily?: string | null;
  productFamily?: string | null;
  typeScore?: number;
  colorScore?: number;
  audienceScore?: number;
  dropReason: string;
  stage: "final_relevance_gate" | "family_guard" | "post_hydration" | "other";
}

function createDropLog(
  product: any,
  reason: string,
  stage: CandidateDropLog["stage"] = "other"
): CandidateDropLog {
  return {
    id: product.id ?? "unknown",
    title: product.title,
    category: product.category,
    similarity_score: product.similarity_score,
    rawVisualSim: product.explain?.clipCosine,
    finalRelevance01: product.finalRelevance01,
    intentFamily: product.explain?.intentFamily,
    productFamily: product.normalizedFamily,
    typeScore: product.explain?.typeScore,
    colorScore: product.explain?.colorScore,
    audienceScore: product.explain?.audienceScore,
    dropReason: reason,
    stage,
  };
}

function logDropReasons(drops: CandidateDropLog[], context: string) {
  if (drops.length === 0) return;
  const debug = String(process.env.SEARCH_IMAGE_PIPELINE_DEBUG ?? "").trim() === "1";
  if (!debug) return;
  
  console.log(`[searchImage drops] ${context}: ${drops.length} products dropped`, drops);
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

/**
 * PHASE 1: Apply post-hydration family and audience guards
 * Prevents catastrophic errors like:
 * - Shoe search returning dress products
 * - Cross-gender mismatches
 * - Wrong product family in results
 */
function applyPostHydrationGuards(
  results: ProductResult[] | undefined,
  intentProductCategory: string | undefined,
  intentAudience: string | null,
  intentFilters?: Partial<LegacySearchFilters>,
): ProductResult[] {
  if (!results || results.length === 0) return results ?? [];
  if (!intentProductCategory) return results;

  const guardEnabled = String(process.env.SEARCH_IMAGE_FAMILY_GUARD ?? "1").toLowerCase() !== "0";
  if (!guardEnabled) return results;

  const intentFamily = normalizeFamily(intentProductCategory);
  const desiredColors = (() => {
    const f = intentFilters as any;
    if (!f) return [] as string[];
    if (Array.isArray(f.colors) && f.colors.length > 0) return f.colors.map((c: any) => String(c).toLowerCase().trim());
    if (typeof f.color === "string" && String(f.color).trim()) return [String(f.color).toLowerCase().trim()];
    return [] as string[];
  })();

  return results
    .map((product) => {
      const productFamily = extractProductFamily(product);
      const productAudience = resolveProductAudience(product);
      const nextProduct: ProductResult & { guardReason?: string } = { ...product };

      // Start with existing final score (or conservative default)
      let maxFinal = typeof nextProduct.finalRelevance01 === "number" ? nextProduct.finalRelevance01 : 0.5;
      const rawVisual = Math.max(
        0,
        Math.min(
          1,
          Number(
            nextProduct.similarity_score ??
              (nextProduct.explain as any)?.clipCosine ??
              (nextProduct.explain as any)?.merchandiseSimilarity ??
              0,
          ) || 0,
        ),
      );

      // Known wrong family is usually a metadata problem, not proof that the
      // visual neighbor is bad. Hard-drop only obvious opposite-family clashes
      // unless the visual evidence is near-identical.
      if (intentFamily && productFamily && productFamily !== intentFamily) {
        const strongOpposite = isStrongOppositeFamily(intentFamily, productFamily);
        if (strongOpposite && rawVisual < 0.9) {
          return null;
        }
        maxFinal = Math.min(maxFinal, rawVisual >= 0.72 ? 0.74 : 0.62);
        nextProduct.guardReason =
          (nextProduct.guardReason ? `${nextProduct.guardReason};` : "") +
          (strongOpposite ? "strong_family_mismatch_visual_override" : "family_mismatch_soft_penalty");
      }

      // Unknown family -> keep with penalty (honest scoring)
      if (!productFamily) {
        maxFinal = Math.min(maxFinal, 0.62);
        nextProduct.guardReason = (nextProduct.guardReason ? `${nextProduct.guardReason};` : "") + "unknown_family_kept_with_penalty";
      }

      // Opposite audience stays a hard conflict; other metadata issues below are penalties.
      if (intentAudience && product.normalizedAudience) {
        const prodAud = String(product.normalizedAudience ?? "").toLowerCase().trim();
        const wantAud = String(intentAudience ?? "").toLowerCase().trim();
        if (prodAud && wantAud && prodAud !== "unisex" && prodAud !== wantAud) {
          return null;
        }
      }

      // Wrong subtype (heuristic): if product has subtype token and it doesn't appear in intent category string
      if (product.normalizedSubtype && intentProductCategory) {
        const sub = String(product.normalizedSubtype).toLowerCase().trim();
        const intentCat = String(intentProductCategory).toLowerCase();
        if (sub && intentCat && !intentCat.includes(sub)) {
          maxFinal = Math.min(maxFinal, 0.62);
          nextProduct.guardReason = (nextProduct.guardReason ? `${nextProduct.guardReason};` : "") + "wrong_subtype_penalty";
        }
      }

      // Wrong color (only apply when caller provided explicit color filter/hint)
      if (desiredColors.length > 0 && product.normalizedColor) {
        const prodCol = String(product.normalizedColor ?? "").toLowerCase().trim();
        if (prodCol && !desiredColors.includes(prodCol)) {
          maxFinal = Math.min(maxFinal, 0.58);
          nextProduct.guardReason = (nextProduct.guardReason ? `${nextProduct.guardReason};` : "") + "wrong_color_penalty";
        }
      }

      // Apply soft audience cap using the real intent when available (existing logic)
      const audienceCap = getAudienceCap(intentAudience, productAudience);
      if (audienceCap < 1.0) {
        maxFinal = Math.min(maxFinal, audienceCap);
        nextProduct.guardReason = (nextProduct.guardReason ? `${nextProduct.guardReason};` : "") + "audience_cap_applied";
      }

      // Tier caps stay opt-in while the production path stabilizes.
      let contractCap = 1;
      const contractTierCapsEnabled =
        String(process.env.SEARCH_IMAGE_TIER_SCORING_ENABLED ?? "0").toLowerCase().trim() === "1";
      if (contractTierCapsEnabled) {
        const mt = String(product.match_type ?? "").toLowerCase().trim();
        if (mt === "exact") contractCap = Math.min(contractCap, 0.94);
        else if (mt === "related") contractCap = Math.min(contractCap, 0.78);
        else if (mt === "similar") {
          contractCap = Math.min(contractCap, 0.64);
        }
        if (typeof product.similarity_score === "number" && product.similarity_score < 0.4) {
          contractCap = Math.min(contractCap, 0.56);
        }
      }

      // Final enforce: do not increase score, only cap it according to rules above
      const enforced = Math.min(maxFinal, contractCap, typeof nextProduct.finalRelevance01 === "number" ? nextProduct.finalRelevance01 : 1);
      nextProduct.finalRelevance01 = enforced;

      return nextProduct;
    })
    .filter((p): p is ProductResult => p !== null);
}

function resolveIntentAudience(filters: Partial<LegacySearchFilters> | undefined): string | null {
  const raw = String((filters as any)?.gender ?? "").toLowerCase().trim();
  if (!raw) return null;
  if (/^(men|man|male|m|mens|men's)$/.test(raw)) return "men";
  if (/^(women|woman|female|w|womens|women's)$/.test(raw)) return "women";
  if (/^(unisex|both|all)$/.test(raw)) return "unisex";
  return null;
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
  return relevanceFiltered;
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

  const enhancedOutput = await enhancedTextSearch(query, normalizedFilters, {
    limit,
    offset: (page - 1) * limit,
    includeRelated,
    relatedLimit,
    negationConstraints,
  } as any);

  return finalizeTextSearchResponse(enhancedOutput as EnhancedTextSearchOutput);
}

export function finalizeTextSearchResponse(output: EnhancedTextSearchOutput): EnhancedTextSearchOutput {
  return {
    ...output,
    meta: {
      ...(output.meta ?? {}),
      total_results: output.total,
    },
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
    imageMode,
    detectionLabel,
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
    debug,
    sessionId,
    userId,
    sessionFilters,
    collapseVariantGroups,
    rerankSignalCache,
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
  
  // PHASE 1-fix: Prevent session filters from poisoning detection-scoped image searches.
  // Detection searches are self-contained (item detected, category/family inferred).
  // Inheriting filters from a previous search (e.g., "white shirt") can kill valid matches
  // (e.g., shoe detections filtered out by color=white).
  const isDetectionScoped = Boolean(detectionProductCategory || detectionLabel);
  const mergedFilters = isDetectionScoped
    ? filters
    : inheritedSessionFilters
      ? { ...inheritedSessionFilters, ...filters }
      : filters;

  const inferAislesEnv = () => {
    const v = String(process.env.SEARCH_IMAGE_INFER_YOLO_AISLES ?? "1").toLowerCase();
    return v !== "0" && v !== "false";
  };
  const derivedAisleHints =
    predictedCategoryAisles && predictedCategoryAisles.length > 0
      ? predictedCategoryAisles
      // Skip YOLO when the upstream detection pipeline already classified the item:
      // detectionProductCategory is set by image-analysis.service for every crop search,
      // so re-running YOLO here would duplicate the /detect call for no gain.
      : inferAislesEnv() && imageBuffer && !detectionProductCategory
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
    imageMode,
    detectionLabel,
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
    debug,
    sessionId,
    userId,
    sessionFilters: inheritedSessionFilters as any,
    collapseVariantGroups,
    rerankSignalCache: rerankSignalCache as any,
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
  let filteredResults = filterByFinalRelevance(res.results, effectiveMin, "lenient") ?? [];
  let filteredRelated = filterByFinalRelevance(res.related, effectiveMin, "lenient") ?? [];

  // PHASE D-fix: Log products dropped by final relevance gate
  if (Array.isArray(res.results)) {
    const resultIds = new Set(filteredResults.map((r) => r.id));
    const droppedByRelevance = res.results
      .filter((r) => !resultIds.has(r.id))
      .map((p) => 
        createDropLog(
          p,
          `finalRelevance01 ${p.finalRelevance01 ?? "null"} < threshold ${effectiveMin}`,
          "final_relevance_gate"
        )
      );
    logDropReasons(droppedByRelevance, "after_final_relevance_gate");
  }

  // PHASE 2-fix: Enhanced rescue with multi-tier visual override (more aggressive)
  // If we have all results available, check if any high-visual items were dropped
  if (Array.isArray(res.results) && Array.isArray(filteredResults)) {
    const resultIds = new Set(filteredResults.map((r) => r.id));
    const dropped = res.results.filter((r) => !resultIds.has(r.id));
    
    // Try to rescue dropped items using multi-tier confidence levels
    const rescued = dropped.filter((item) => {
      const tier = shouldRescueByVisualTier({
        similarityScore: item.similarity_score,
        clipCosine: item.explain?.clipCosine,
        normalizedFamily: item.normalizedFamily,
        intentFamily: undefined, // lenient: don't require family match for rescue
        hardColorConflict: false, // more lenient on color since we're rescuing
        hardAudienceConflict: false,
        allowCrossFamilyRescue: true, // Phase 2: allow cross-family for high confidence
      });
      
      // Log rescue decision for Phase D (debugging)
      if (tier.rescue && String(process.env.SEARCH_IMAGE_PIPELINE_DEBUG ?? "").trim() === "1") {
        console.log("[searchImage rescue]", {
          id: item.id,
          title: item.title,
          similarity: item.similarity_score,
          tier: tier.tier,
          reason: tier.reason,
        });
      }
      
      return tier.rescue;
    });
    
    if (rescued.length > 0) {
      filteredResults = [...filteredResults, ...rescued];
    }
  }

  // PHASE 1: Apply post-hydration family and audience guards
  // This prevents shoes→dresses and other cross-family leakage
  if (detectionProductCategory) {
    const beforeGuards = filteredResults.length;
    filteredResults = applyPostHydrationGuards(
      filteredResults,
      detectionProductCategory,
      resolveIntentAudience(mergedFilters),
      mergedFilters,
    );
    
    // PHASE D-fix: Log products dropped by post-hydration guards
    if (beforeGuards > filteredResults.length) {
      const guardDropCount = beforeGuards - filteredResults.length;
      if (String(process.env.SEARCH_IMAGE_PIPELINE_DEBUG ?? "").trim() === "1") {
        console.log(`[searchImage] ${guardDropCount} products dropped by post-hydration guards`, {
          before: beforeGuards,
          after: filteredResults.length,
          detectionCategory: detectionProductCategory,
        });
      }
    }
  }

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
