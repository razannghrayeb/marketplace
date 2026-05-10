/**
 * Unified Image Analysis Service
 *
 * Single entry point for image uploads that provides:
 * - Image storage (R2)
 * - CLIP embeddings for similarity search
 * - Dual-model fashion detection (clothing + accessories)
 *
 * Use this service when you want a complete analysis pipeline.
 */

import { pg } from "../../lib/core";
import { config } from "../../config";
import {
  uploadImage,
  getCdnUrl,
  processImageForEmbedding,
  processImageForGarmentEmbeddingWithOptionalBox,
  computeShopTheLookGarmentEmbeddingFromDetection,
  computeShopTheLookGarmentEmbeddingsFromDetections,
  scalePixelBoxToImageDims,
  blip,
  computePHash,
  validateImage,
  isClipAvailable,
} from "../../lib/image";
import { getTextEmbedding, cosineSimilarity } from "../../lib/image/clip";
import { getRedis } from "../../lib/redis";
import { getSession } from "../../lib/queryProcessor/conversationalContext";
import {
  inferAudienceFromCaption,
  inferColorFromCaption,
  primaryColorHintFromCaption,
} from "../../lib/image/captionAttributeInference";
import { buildStructuredBlipOutput } from "../../lib/image/blipStructured";
import { extractDominantColorNames } from "../../lib/color/dominantColor";
import { inferMaterialFromTextureCrop } from "../../lib/image/materialInference";
import {
  YOLOv8Client,
  getYOLOv8Client,
  extractOutfitComposition,
  dedupeDetectionsBySameLabelIou,
  boundingBoxIou,
  Detection,
  OutfitComposition,
  BoundingBox,
  type SegmentationMask,
} from "../../lib/image/yolov8Client";
import { isYoloCircuitOpenError } from "../../lib/image/yoloCircuitBreaker";
import { prepareBufferForImageSearchQuery } from "../../lib/image/embeddingPrep";
import { searchByImageWithSimilarity } from "./search.service";
import { ProductResult } from "./types";
import sharpLib from "sharp";
import crypto from "crypto";
import { performance } from "node:perf_hooks";
import {
  mapDetectionToCategory,
  getSearchCategories,
  shouldUseAlternatives,
  inferDressLengthFromBox,
  type CategoryMapping,
} from "../../lib/detection/categoryMapper";
import {
  extractLexicalProductTypeSeeds,
  expandProductTypesForQuery,
  filterProductTypeSeedsByMappedCategory,
} from "../../lib/search/productTypeTaxonomy";
import { getCategorySearchTerms } from "../../lib/search/categoryFilter";
import { sortProductsByRelevanceAndCategory, unifiedScorerScore } from "../../lib/search/sortResults";
import {
  computeOutfitCoherence,
  type OutfitCoherenceResult,
  type DetectionWithColor,
} from "../../lib/detection/outfitCoherence";
import { tieredColorListCompliance } from "../../lib/color/colorCanonical";
import { normalizeColorTokensFromRaw } from "../../lib/color/queryColorFilter";

// `sharp` is CommonJS callable. TS interop can produce a non-callable object.
const sharp: any =
  typeof sharpLib === "function" ? sharpLib : (sharpLib as any).default;

type BlipSignal = {
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

function inferApparelAudienceFallback(params: {
  caption?: string | null;
  detections: Array<{ label?: string; raw_label?: string }>;
}): { gender?: "men" | "women"; ageGroup?: "adult" } {
  const detectionBlob = params.detections
    .map((d) => `${d.label ?? ""} ${d.raw_label ?? ""}`)
    .join(" ")
    .toLowerCase();
  const blob = [params.caption ?? "", detectionBlob].join(" ").toLowerCase();
  if (!blob.trim()) return {};
  if (/\b(kids?|children|child|baby|babies|toddler|toddlers|youth|junior)\b/.test(blob)) return {};

  let womenScore = 0;
  let menScore = 0;

  if (/\b(women|womens|woman|female|lady|ladies|girl|girls)\b/.test(blob)) womenScore += 2;
  if (/\b(men|mens|man|male|gent|gents|boy|boys)\b/.test(blob)) menScore += 2;

  const womenStyleCue = /\b(dress|dresses|gown|skirt|skirted|blouse|camisole|cami|heels?|pumps?|stiletto|mary jane|handbag|clutch|tote|purse|vest\s*dress|sling\s*dress|abaya|kaftan|mini\s*skirt|midi\s*skirt|maxi\s*skirt|mom\s*jeans|girlfriend\s*jeans|boyfriend\s*jeans|high[-\s]?waist\s*jeans|high[-\s]?rise\s*jeans|flare\s*jeans|bootcut\s*jeans|wide[-\s]?leg\s*jeans)\b/;
  const menStyleCue = /\b(suit|suits|tie|oxford|oxfords|dress\s*shirt|button\s*down|button-down|cargo\s*pants?|chino|chinos|boxer|briefs|loafer|loafers|briefcase|messenger\s*bag|duffel|duffle|satchel|backpack|menswear)\b/;

  if (womenStyleCue.test(blob)) {
    womenScore += 1.6;
  }
  if (menStyleCue.test(blob)) {
    menScore += 1.5;
  }

  // Detection-only cues are useful when BLIP captioning is missing or weak.
  for (const d of params.detections) {
    const lb = `${d.label ?? ""} ${d.raw_label ?? ""}`.toLowerCase();
    if (/\b(short|long|vest|sling)\s*sleeve\s*dress|\bdress\b|\bskirt\b|\bmom\s*jeans\b|\bhigh[-\s]?waist\s*jeans\b|\bhigh[-\s]?rise\s*jeans\b|\bwide[-\s]?leg\s*jeans\b/.test(lb)) womenScore += 1.3;
    if (/\b(heel|heels|pump|pumps|stiletto|kitten heel|mary jane|handbag|clutch|tote|purse)\b/.test(lb)) womenScore += 1.2;
    if (/\b(tie|oxford|oxfords|loafer|loafers|suit|briefcase|messenger\s*bag|duffel|duffle)\b/.test(lb)) menScore += 1.1;
  }

  // Formal menswear fallback when captions are weak/missing:
  // trousers + long-sleeve upper body detections are a strong proxy for men's tailoring
  // in business/suit-like photos and should prevent cross-gender leakage.
  const hasTrouserCue = /\b(trouser|trousers|pant|pants|chino|chinos)\b/.test(detectionBlob);
  const hasUpperFormalCue = /\b(long\s*sleeve\s*top|shirt|dress\s*shirt|blazer|sport\s*coat|suit|jacket)\b/.test(
    detectionBlob,
  );
  const hasStrongWomenCue = /\b(dress|skirt|heels?|pumps?|blouse|camisole|cami|handbag|clutch|tote|purse|mom\s*jeans|high[-\s]?waist\s*jeans|high[-\s]?rise\s*jeans)\b/.test(detectionBlob);
  if (hasTrouserCue && hasUpperFormalCue && !hasStrongWomenCue) {
    menScore += 2.1;
    // Strong deterministic lock for classic men's tailoring scenes
    // (e.g. trousers + long-sleeve/jacket cues with no women-only cues).
    if (!/\b(women|womens|woman|female|lady|ladies|girl|girls)\b/.test(blob)) {
      return { gender: "men", ageGroup: "adult" };
    }
  }

  const apparelCue = /\b(dress|top|shirt|blouse|skirt|pants|trousers|jeans|shorts|hoodie|sweater|cardigan|jacket|coat|tshirt|t-shirt|jumpsuit|romper|abaya|kaftan|shoe|sneaker|boot|heel)\b/.test(
    blob,
  );
  if (!apparelCue) return {};

  if (womenScore >= 1.6 && womenScore - menScore >= 0.9) {
    return { gender: "women", ageGroup: "adult" };
  }
  if (menScore >= 1.6 && menScore - womenScore >= 0.9) {
    return { gender: "men", ageGroup: "adult" };
  }

  return { ageGroup: "adult" };
}

/** Default on when unset — soft category + aisle rerank is the normal image path. */
function imageSoftCategoryEnv(): boolean {
  const raw = process.env.SEARCH_IMAGE_SOFT_CATEGORY;
  if (raw === undefined || String(raw).trim() === "") return true;
  const v = String(raw).toLowerCase();
  if (v === "0" || v === "false" || v === "off" || v === "no") return false;
  return v === "1" || v === "true";
}

/**
 * kNN field for per-detection Shop-the-Look searches (query = `computeShopTheLookGarmentEmbeddingFromDetection`,
 * aligned with `processImageForGarmentEmbeddingWithOptionalBox` / `resume-reindex` on `embedding_garment`).
 * Defaults to `embedding_garment`. Set to `embedding` only if the index omits garment vectors or you compare to full-frame vectors.
 */
function shopTheLookKnnField(): string {
  const v = String(process.env.SEARCH_IMAGE_DETECTION_KNN_FIELD ?? "").trim();
  return v || "embedding_garment";
}

/** When true: allow best kNN matches below threshold if they still pass SEARCH_IMAGE_RELAX_FLOOR (default off). */
function shopLookRelaxEnv(): boolean {
  const v = String(process.env.SEARCH_IMAGE_SHOP_RELAX ?? "").toLowerCase();
  return v === "1" || v === "true";
}

/** Detection-scoped searches are recall-first; default to relaxed visual-threshold rescue when empty. */
function shopLookDetectionRelaxEnv(): boolean {
  const raw = process.env.SEARCH_IMAGE_DETECTION_RELAX;
  if (raw === undefined || String(raw).trim() === "") return true;
  const v = String(raw).toLowerCase();
  return v === "1" || v === "true";
}

/** When true: if category-filtered search returns nothing, retry without category (default off — can look irrelevant). */
function shopLookCategoryFallbackEnv(): boolean {
  const raw = process.env.SEARCH_IMAGE_SHOP_CATEGORY_FALLBACK;
  if (raw === undefined || String(raw).trim() === "") return true;
  const v = String(raw).toLowerCase();
  return v === "1" || v === "true";
}

/** Debug-only isolation path: bypass rerank/final gates and rank by raw exact cosine. */
function shopLookDebugRawCosineFirstEnv(): boolean {
  // Never allow raw-cosine bypass outside local/dev debugging.
  const nodeEnv = String(process.env.NODE_ENV ?? "").toLowerCase();
  if (nodeEnv === "production") return false;
  const branchEnabled = String(process.env.SEARCH_ENABLE_DEBUG_RAW_BRANCH ?? "").toLowerCase();
  if (!(branchEnabled === "1" || branchEnabled === "true")) return false;
  const v = String(process.env.SEARCH_IMAGE_DEBUG_RAW_EXACT_COSINE_FIRST ?? "").toLowerCase();
  return v === "1" || v === "true";
}

/**
 * Shop-the-Look: use aisle-level rerank (predictedCategoryAisles) without hard OpenSearch category filter.
 * Default true when unset — pairs with products.service useAisleRerank when aisle hints are sent.
 */
function shopLookSoftCategoryEnv(): boolean {
  const raw = process.env.SEARCH_IMAGE_SHOP_SOFT_CATEGORY;
  if (raw === undefined || String(raw).trim() === "") return true;
  const v = String(raw).toLowerCase();
  return v === "1" || v === "true";
}

/**
 * When enabled, Shop-the-Look always picks one mapped category aisle hint for each detection
 * (precision-oriented), while still avoiding hard OpenSearch category filtering.
 */
function shopLookSingleCategoryHintEnv(): boolean {
  const v = String(process.env.SEARCH_IMAGE_SHOP_SINGLE_CATEGORY_HINT ?? "").toLowerCase();
  return v === "1" || v === "true";
}

/** Per-detection auto hard-category min confidence (default high — opt-in strict or env). */
function shopLookHardCategoryConfThreshold(): number {
  const raw = Number(process.env.SEARCH_IMAGE_DETECTION_HARD_CAT_CONF ?? "0.97");
  if (!Number.isFinite(raw)) return 0.97;
  return Math.max(0, Math.min(1, raw));
}

/** Per-detection min bbox area ratio for auto hard category (default — large detections only). */
function shopLookHardCategoryAreaRatioThreshold(): number {
  const raw = Number(process.env.SEARCH_IMAGE_DETECTION_HARD_CAT_AREA_RATIO ?? "0.38");
  if (!Number.isFinite(raw)) return 0.38;
  return Math.max(0, Math.min(1, raw));
}

/** Explicit strict mode: hard category as first pass for Shop-the-Look. */
function shopLookHardCategoryStrictEnv(): boolean {
  const v = String(process.env.SEARCH_IMAGE_SHOP_HARD_CATEGORY_STRICT ?? "").toLowerCase();
  return v === "1" || v === "true";
}

/**
 * Ranked result cap per detection for Shop-the-Look (backend); UI may request fewer.
 * Override with SEARCH_IMAGE_SHOP_LIMIT_PER_DETECTION (1–80).
 */
function defaultShopLookResultBudget(): number {
  const raw = Number(process.env.SEARCH_IMAGE_SHOP_LIMIT_PER_DETECTION);
  if (Number.isFinite(raw) && raw >= 1 && raw <= 80) return Math.floor(raw);
  return 22;
}

function resolveShopLookLimit(explicit?: number): number {
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit >= 1) {
    return Math.min(80, Math.floor(explicit));
  }
  return defaultShopLookResultBudget();
}

/**
 * Retrieval-only pool cap for per-detection kNN search before rerank/guards.
 * Keep this higher than the final per-detection output cap to improve recall.
 */
function shopLookRetrievalCap(): number {
  const raw = Number(process.env.SEARCH_IMAGE_SHOP_RETRIEVAL_CAP ?? "220");
  if (!Number.isFinite(raw)) return 220;
  return Math.max(80, Math.min(500, Math.floor(raw)));
}

/** Smaller retrieval cap for non-initial retry/fallback calls (default 36) to bound tail latency. */
function shopLookRetryRetrievalCap(): number {
  const raw = Number(process.env.SEARCH_IMAGE_SHOP_RETRY_RETRIEVAL_CAP ?? "48");
  if (!Number.isFinite(raw)) return 48;
  return Math.max(12, Math.min(160, Math.floor(raw)));
}

function resolveShopLookRetrievalLimit(explicit?: number): number {
  const cap = shopLookRetrievalCap();
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit >= 1) {
    return Math.min(cap, Math.floor(explicit));
  }
  return Math.min(cap, defaultShopLookResultBudget());
}

function resolveShopLookPage(explicit?: number): number {
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit >= 1) {
    return Math.floor(explicit);
  }
  return 1;
}

function resolveShopLookPageSize(explicit: number | undefined, fallback: number): number {
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit >= 1) {
    return Math.min(80, Math.floor(explicit));
  }
  return resolveShopLookLimit(fallback);
}

/**
 * Fetch a wider candidate pool than the final UI limit, then rely on rerank/gates.
 * This improves recall for hard detections (e.g. pink long dresses) without changing output size.
 */
function shopLookRecallMultiplier(): number {
  const raw = Number(process.env.SEARCH_IMAGE_SHOP_RECALL_MULTIPLIER ?? "4");
  if (!Number.isFinite(raw)) return 4;
  return Math.max(1, Math.min(5, Math.floor(raw)));
}

/** Extra visual floor above threshold to keep Shop-the-Look results precision-first. */
function shopLookPostVisualMinDelta(): number {
  const raw = Number(process.env.SEARCH_IMAGE_SHOP_POST_VISUAL_MIN_DELTA ?? "0.03");
  if (!Number.isFinite(raw)) return 0.03;
  return Math.max(0, Math.min(0.2, raw));
}

/** Minimum high-precision hits to keep before backing off to the base threshold. */
function shopLookPostVisualMinKeep(): number {
  const raw = Number(process.env.SEARCH_IMAGE_SHOP_POST_VISUAL_MIN_KEEP ?? "8");
  if (!Number.isFinite(raw)) return 8;
  return Math.max(1, Math.min(40, Math.floor(raw)));
}

function shopLookTopRecoverySimilarityThreshold(baseThreshold: number): number {
  const raw = Number(process.env.SEARCH_IMAGE_SHOP_TOP_RECOVERY_MIN_SIM ?? "0.56");
  const floor = Number.isFinite(raw) ? raw : 0.56;
  return Math.max(0.35, Math.min(baseThreshold, Math.min(0.9, floor)));
}

function shopLookDressRecoverySimilarityThreshold(baseThreshold: number): number {
  // Floor must be BELOW the main-path dress cap (0.5) so the ablation recovery can
  // actually rescue low-result sets that the main pass failed to fill.
  // Default 0.46 gives ~4 points of headroom below the main 0.50 threshold.
  const raw = Number(process.env.SEARCH_IMAGE_SHOP_DRESS_RECOVERY_MIN_SIM ?? "0.46");
  const floor = Number.isFinite(raw) ? raw : 0.46;
  return Math.max(0.30, Math.min(baseThreshold, Math.min(0.9, floor)));
}

function shopLookOuterwearRecoverySimilarityThreshold(baseThreshold: number): number {
  const raw = Number(process.env.SEARCH_IMAGE_SHOP_OUTERWEAR_RECOVERY_MIN_SIM ?? "0.50");
  const floor = Number.isFinite(raw) ? raw : 0.50;
  return Math.max(0.35, Math.min(baseThreshold, Math.min(0.9, floor)));
}

function shopLookDetectionSimilarityThreshold(baseThreshold: number, productCategory: string): number {
  const category = String(productCategory || "").toLowerCase().trim();
  if (category === "tops") {
    return Math.max(0.33, Math.min(baseThreshold, 0.48));
  }
  if (category === "bottoms") {
    return Math.max(0.35, Math.min(baseThreshold, 0.48));
  }
  if (category === "dresses" || category === "outerwear") {
    return Math.max(0.33, Math.min(baseThreshold, 0.5));
  }
  if (category === "footwear") {
    return Math.max(0.33, Math.min(baseThreshold, 0.5));
  }
  return baseThreshold;
}

/** Expensive multi-crop fallback toggle. Default off to minimize latency tails. */
function shopLookLowQualityMultiCropFallbackEnabled(): boolean {
  const v = String(process.env.SEARCH_IMAGE_SHOP_LOW_QUALITY_MULTICROP_FALLBACK ?? "").toLowerCase();
  return v === "1" || v === "true";
}

function shopLookTopRecoveryMinKeep(limitPerItem: number): number {
  const env = Number(process.env.SEARCH_IMAGE_SHOP_TOP_RECOVERY_MIN_KEEP);
  if (Number.isFinite(env)) {
    return Math.max(1, Math.min(10, Math.floor(env)));
  }
  const base = Number.isFinite(limitPerItem) ? limitPerItem : 0;
  return Math.max(2, Math.min(6, Math.floor(base * 0.2)));
}

function detectionResultStrength(products: ProductResult[]): number {
  if (!Array.isArray(products) || products.length === 0) return 0;
  const top = products.slice(0, 6);
  const total = top.reduce((sum, p) => {
    const sim = Number((p as any).similarity_score ?? 0);
    const rel = Number((p as any).finalRelevance01 ?? 0);
    return sum + Math.max(sim, rel);
  }, 0);
  return total / top.length;
}

function summarizeDroppedProductForLog(product: ProductResult): Record<string, unknown> {
  const explain = ((product as any)?.explain ?? {}) as Record<string, unknown>;
  const round = (value: unknown) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;
  };
  return {
    product_id: String((product as any)?.id ?? ""),
    title: String((product as any)?.title ?? "").slice(0, 120),
    category: String((product as any)?.category_canonical ?? (product as any)?.category ?? ""),
    product_types: Array.isArray((product as any)?.product_types)
      ? (product as any).product_types.slice(0, 6)
      : (product as any)?.product_types,
    color: (product as any)?.color ?? null,
    similarity_score: round((product as any)?.similarity_score),
    finalRelevance01: round((product as any)?.finalRelevance01),
    finalRelevanceSource: String(explain.finalRelevanceSource ?? ""),
    acceptanceRelevance01: round(explain.acceptanceRelevance01),
    productTypeCompliance: round(explain.productTypeCompliance),
    categoryScore: round(explain.categoryScore ?? explain.categoryRelevance01),
    colorCompliance: round(explain.colorCompliance),
    colorTier: String(explain.colorTier ?? ""),
    audienceCompliance: round(explain.audienceCompliance),
    crossFamilyPenalty: round(explain.crossFamilyPenalty),
    hardBlocked: Boolean(explain.hardBlocked),
  };
}

function sampleDroppedProductsForLog(before: ProductResult[], after: ProductResult[], cap = 5): Record<string, unknown>[] {
  const afterIds = new Set((after ?? []).map((p) => String((p as any)?.id ?? "")).filter(Boolean));
  return (before ?? [])
    .filter((p) => {
      const id = String((p as any)?.id ?? "");
      return id && !afterIds.has(id);
    })
    .slice(0, cap)
    .map(summarizeDroppedProductForLog);
}

function shopLookTinyFootwearRecoveryThreshold(baseThreshold: number): number {
  const raw = Number(process.env.SEARCH_IMAGE_SHOP_TINY_FOOTWEAR_MIN_SIM ?? "0.53");
  const floor = Number.isFinite(raw) ? raw : 0.53;
  return Math.max(0.35, Math.min(baseThreshold, Math.min(0.9, floor)));
}

function shopLookFootwearRecoveryThreshold(baseThreshold: number, areaRatio: number): number {
  if (areaRatio <= 0.02) return shopLookTinyFootwearRecoveryThreshold(baseThreshold);
  const raw = Number(process.env.SEARCH_IMAGE_SHOP_FOOTWEAR_RECOVERY_MIN_SIM ?? "0.5");
  const floor = Number.isFinite(raw) ? raw : 0.5;
  return Math.max(0.35, Math.min(baseThreshold, Math.min(0.9, floor)));
}

/** Minimum finalRelevance01 score (0-1) for products to be included in results. Default: 0.4 */
function shopLookMinFinalRelevanceThreshold(): number {
  const raw = Number(process.env.SEARCH_IMAGE_SHOP_MIN_FINAL_RELEVANCE ?? "0.4");
  if (!Number.isFinite(raw)) return 0.4;
  return Math.max(0, Math.min(1, raw));
}

function mergeImageSearchSessionFilters(
  base: Partial<import("./types").SearchFilters>,
  sessionFilters?: Record<string, unknown> | null,
): Partial<import("./types").SearchFilters> {
  if (!sessionFilters) return base;
  const merged = { ...base } as Partial<import("./types").SearchFilters>;
  const lower = (value: unknown): string => String(value ?? "").trim().toLowerCase();
  const assignIfMissing = <K extends keyof import("./types").SearchFilters>(key: K, value: import("./types").SearchFilters[K]) => {
    if (merged[key] === undefined || merged[key] === null || merged[key] === "") {
      merged[key] = value;
    }
  };

  if (sessionFilters.brand !== undefined) assignIfMissing("brand", String(sessionFilters.brand));
  if (sessionFilters.category !== undefined) {
    assignIfMissing(
      "category",
      Array.isArray(sessionFilters.category)
        ? (sessionFilters.category as string[]).map((item) => String(item))
        : String(sessionFilters.category),
    );
  }
  if (sessionFilters.color !== undefined) assignIfMissing("color", lower(sessionFilters.color));
  if (sessionFilters.material !== undefined) assignIfMissing("material", lower(sessionFilters.material));
  if (sessionFilters.fit !== undefined) assignIfMissing("fit", lower(sessionFilters.fit));
  if (sessionFilters.style !== undefined) assignIfMissing("style", lower(sessionFilters.style));
  if (sessionFilters.gender !== undefined) assignIfMissing("gender", lower(sessionFilters.gender));
  if (sessionFilters.pattern !== undefined) assignIfMissing("pattern", lower(sessionFilters.pattern));
  if (sessionFilters.ageGroup !== undefined) assignIfMissing("ageGroup", lower(sessionFilters.ageGroup));

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

/**
 * Skip auto hard-category for accessory/bag noise and ambiguous top silhouettes.
 * `SEARCH_IMAGE_SHOP_HARD_CATEGORY_STRICT` still forces hard filtering when needed.
 */
function isNoisyCategoryForAutoHardCategory(mapping: CategoryMapping, detectionLabel: string): boolean {
  const pc = String(mapping.productCategory || "").toLowerCase();
  if (pc === "accessories" || pc === "bags") return true;
  const lb = String(detectionLabel || "").toLowerCase();
  if (pc === "tops") {
    if (lb.includes("sling") || lb.includes("crop") || lb.includes("tank")) return true;
  }
  return false;
}

function normalizeDetectionProductCategoryToken(token: string | null | undefined): string {
  const normalized = String(token ?? "").toLowerCase().trim();
  if (!normalized) return normalized;
  if (
    /\b(oxford|oxfords|loafer|loafers|sneaker|sneakers|heel|heels|boot|boots|sandals?|slippers?|mule|mules|pumps?|flats?|footwear)\b/.test(
      normalized,
    )
  ) return "footwear";
  if (/\b(trouser|trousers|pants?|slacks?|jeans?|shorts?|bottoms?)\b/.test(normalized)) return "bottoms";
  if (/\b(tailored|suits?|tuxedos?|suit\s*jacket|dress\s*jacket|sport\s*coat|waistcoats?|gilets?)\b/.test(normalized)) {
    return "tailored";
  }
  if (/\b(blazer|blazers|shirt|shirts|tee|t-?shirt|tops?|sweater|hoodie|outerwear)\b/.test(normalized)) {
    return normalized.includes("outerwear") ? "outerwear" : "tops";
  }
  return normalized;
}

function normalizeCategoryMapping(mapping: CategoryMapping): CategoryMapping {
  return {
    ...mapping,
    productCategory: normalizeDetectionProductCategoryToken(mapping.productCategory),
  };
}

/** Infer audience gender via BLIP caption (default: enabled). */
function imageInferAudienceGenderEnv(): boolean {
  const raw = String(process.env.SEARCH_IMAGE_INFER_AUDIENCE_VIA_BLIP ?? "1").toLowerCase();
  return raw === "1" || raw === "true";
}

/** Infer dominant color via k-means (default: enabled; applied only with prominent detections). */
function imageInferDominantColorEnv(): boolean {
  const raw = String(process.env.SEARCH_IMAGE_INFER_COLOR_VIA_DOMINANT ?? "1").toLowerCase();
  return raw === "1" || raw === "true";
}

/** Only apply inferred style filter when detection is "prominent" enough. */
function imageMinStyleConfidenceEnv(): number {
  const raw = Number(process.env.SEARCH_IMAGE_MIN_STYLE_CONF ?? "0.65");
  if (!Number.isFinite(raw)) return 0.65;
  return Math.max(0, Math.min(1, raw));
}

function imageMinStyleAreaRatioEnv(): number {
  const raw = Number(process.env.SEARCH_IMAGE_MIN_STYLE_AREA_RATIO ?? "0.015");
  if (!Number.isFinite(raw)) return 0.015;
  return Math.max(0, raw);
}

/** Only apply inferred color filter when detection is prominent enough. */
function imageMinColorConfidenceEnv(): number {
  const raw = Number(process.env.SEARCH_IMAGE_MIN_COLOR_CONF ?? "0.75");
  if (!Number.isFinite(raw)) return 0.75;
  return Math.max(0, Math.min(1, raw));
}

function imageMinColorAreaRatioEnv(): number {
  const raw = Number(process.env.SEARCH_IMAGE_MIN_COLOR_AREA_RATIO ?? "0.03");
  if (!Number.isFinite(raw)) return 0.03;
  return Math.max(0, raw);
}

function imageBlipSoftHintConfidenceMin(): number {
  const raw = Number(process.env.SEARCH_IMAGE_BLIP_SOFT_HINT_CONF_MIN ?? "0.52");
  if (!Number.isFinite(raw)) return 0.52;
  return Math.max(0, Math.min(1, raw));
}

function imageBlipSoftHintConfidenceStrong(): number {
  const raw = Number(process.env.SEARCH_IMAGE_BLIP_SOFT_HINT_CONF_STRONG ?? "0.7");
  if (!Number.isFinite(raw)) return 0.7;
  return Math.max(0, Math.min(1, raw));
}

function imageBlipClipConsistencyMin(): number {
  const raw = Number(process.env.SEARCH_IMAGE_BLIP_CLIP_CONSISTENCY_MIN ?? "0.18");
  if (!Number.isFinite(raw)) return 0.18;
  return Math.max(-1, Math.min(1, raw));
}

function imageBlipCacheTtlSec(): number {
  const raw = Number(process.env.SEARCH_IMAGE_BLIP_CACHE_TTL_SEC ?? "21600");
  if (!Number.isFinite(raw)) return 21600;
  return Math.max(60, Math.min(7 * 24 * 3600, Math.floor(raw)));
}

function stableBufferHash(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

const inMemoryBlipCache = new Map<string, { expiresAt: number; value: string }>();

async function getCachedCaption(buffer: Buffer, scope: "full" | "det"): Promise<string> {
  const hash = stableBufferHash(buffer);
  const key = `blip:caption:v2:${scope}:${hash}`;
  const now = Date.now();
  const mem = inMemoryBlipCache.get(key);
  if (mem && mem.expiresAt > now) return mem.value;
  if (mem && mem.expiresAt <= now) inMemoryBlipCache.delete(key);

  const redis = getRedis();
  if (redis) {
    try {
      const cached = (await redis.get(key)) as string | null;
      if (cached && String(cached).trim().length > 0) {
        const ttlMs = imageBlipCacheTtlSec() * 1000;
        inMemoryBlipCache.set(key, { expiresAt: now + ttlMs, value: String(cached) });
        return String(cached);
      }
    } catch {
      // Cache is optional; continue to model inference.
    }
  }

  let caption = await captionWithTimeout(buffer);
  // Full-image captions are more critical for intent; retry once on empty result
  // to reduce transient nulls from timeout/load spikes.
  if (!caption.trim() && scope === "full") {
    await new Promise((resolve) => setTimeout(resolve, 120));
    caption = await captionWithTimeout(buffer);
  }
  if (caption.trim().length > 0) {
    const ttlSec = imageBlipCacheTtlSec();
    const ttlMs = ttlSec * 1000;
    inMemoryBlipCache.set(key, { expiresAt: now + ttlMs, value: caption });
    if (redis) {
      try {
        await redis.setex(key, ttlSec, caption);
      } catch {
        // Ignore cache-set failures.
      }
    }
  }
  return caption;
}

function buildBlipSignal(
  structured: ReturnType<typeof buildStructuredBlipOutput>,
  confidence: number,
): BlipSignal {
  return {
    productType: structured.mainItem ?? undefined,
    gender: structured.audience.gender,
    ageGroup: structured.audience.ageGroup,
    primaryColor: structured.colors[0] ?? undefined,
    secondaryColor: structured.colors[1] ?? undefined,
    style: structured.style.attrStyle,
    occasion: structured.style.occasion,
    confidence,
  };
}

function pickConservativeFullImagePrimaryColor(
  captionColors: ReturnType<typeof inferColorFromCaption>,
  structured: ReturnType<typeof buildStructuredBlipOutput>,
): string | null {
  const top = captionColors.topColor ?? null;
  const jeans = captionColors.jeansColor ?? null;
  const garment = captionColors.garmentColor ?? null;

  const mentionsMultipleItems =
    (Array.isArray(structured.secondaryItems) && structured.secondaryItems.length > 0) ||
    (top && jeans && top !== jeans);

  // Full-image caption can mix top/bottom/accessories; keep global color only when unambiguous.
  if (mentionsMultipleItems) return garment;
  return garment ?? top ?? jeans ?? null;
}

function shouldUseDominantColorFallback(
  captionColors: ReturnType<typeof inferColorFromCaption>,
  structured: ReturnType<typeof buildStructuredBlipOutput>,
): boolean {
  const top = captionColors.topColor ?? null;
  const jeans = captionColors.jeansColor ?? null;
  const garment = captionColors.garmentColor ?? null;
  const hasAnySlotColor = Boolean(top || jeans || garment);
  if (!hasAnySlotColor) return true;
  const mentionsMultipleItems =
    (Array.isArray(structured.secondaryItems) && structured.secondaryItems.length > 0) ||
    (top && jeans && top !== jeans);
  // If caption already has slot-level color cues for a multi-item scene, avoid
  // replacing them with a single global dominant color.
  if (mentionsMultipleItems) return false;
  // Single-item scene with a slot color: allow dominant color as supplementary validation.
  return true;
}

function resolveCaptionPrimaryColor(
  caption: string,
  captionColors: ReturnType<typeof inferColorFromCaption>,
  structured: ReturnType<typeof buildStructuredBlipOutput>,
): string | null {
  const captionTextPrimary = primaryColorHintFromCaption(caption);
  const structuredPrimary = pickConservativeFullImagePrimaryColor(captionColors, structured);
  return structuredPrimary ?? captionTextPrimary ?? null;
}

function imageBlipConsistencySuppressionEnabled(): boolean {
  const raw = String(process.env.SEARCH_IMAGE_BLIP_CONS_SUPPRESS_ENABLED ?? "1").toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off" && raw !== "no";
}

function imageBlipConsistencySuppressionOff(): number {
  const raw = Number(process.env.SEARCH_IMAGE_BLIP_CONS_SUPPRESS_OFF ?? "0.1");
  if (!Number.isFinite(raw)) return 0.1;
  return Math.max(-1, Math.min(1, raw));
}

function imageBlipConsistencySuppressionOn(): number {
  const raw = Number(process.env.SEARCH_IMAGE_BLIP_CONS_SUPPRESS_ON ?? "0.28");
  if (!Number.isFinite(raw)) return 0.28;
  return Math.max(-1, Math.min(1, raw));
}

function imageBlipConsistencySuppressionGamma(): number {
  const raw = Number(process.env.SEARCH_IMAGE_BLIP_CONS_SUPPRESS_GAMMA ?? "1.6");
  if (!Number.isFinite(raw)) return 1.6;
  return Math.max(0.5, Math.min(5, raw));
}

function suppressionMultiplier(consistency: number): number {
  if (!imageBlipConsistencySuppressionEnabled()) {
    const norm = Math.max(0, Math.min(1, (consistency + 1) / 2));
    return Math.max(0, Math.min(1, 0.55 + 0.45 * norm));
  }
  const off = imageBlipConsistencySuppressionOff();
  const on = imageBlipConsistencySuppressionOn();
  const gamma = imageBlipConsistencySuppressionGamma();
  if (on <= off) {
    return consistency >= on ? 1 : 0;
  }
  if (consistency < off) return 0;
  if (consistency >= on) return 1;
  const t = (consistency - off) / (on - off);
  return Math.max(0, Math.min(1, Math.pow(t, gamma)));
}

function combineConfidenceFromConsistency(base: number, consistency: number): number {
  return Math.max(0, Math.min(1, base * suppressionMultiplier(consistency)));
}

async function captionWithTimeout(buf: Buffer): Promise<string> {
  const startedAt = Date.now();
  const timeoutMs = config.search.blipCaptionTimeoutMs;
  let timedOut = false;
  const timeoutPromise = new Promise<string>((resolve) =>
    setTimeout(() => {
      timedOut = true;
      resolve("");
    }, timeoutMs),
  );
  try {
    const out = await Promise.race([blip.caption(buf), timeoutPromise]);
    const caption = String(out || "").trim();
    if (!caption && timedOut) {
      console.warn("[BLIP] caption timeout", { timeoutMs, elapsedMs: Date.now() - startedAt });
    }
    return caption;
  } catch (err) {
    console.warn("[BLIP] caption failed", {
      timeoutMs,
      elapsedMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    });
    return "";
  }
}

async function clipCaptionConsistency01(imageEmbedding: number[], caption: string): Promise<number> {
  const c = String(caption || "").trim();
  if (!c) return 0;
  try {
    const textEmb = await getTextEmbedding(c);
    return cosineSimilarity(imageEmbedding, textEmb);
  } catch {
    return 0;
  }
}

/** Formality scores by detection label (1-10 scale). */
const FORMALITY_MAP: Record<string, number> = {
  // Dresses
  gown: 9,
  "long sleeve dress": 7,
  "short sleeve dress": 6,
  "vest dress": 5,
  "sling dress": 4,
  dress: 6,
  maxi_dress: 5,
  mini_dress: 5,
  midi_dress: 6,

  // Tops
  "long sleeve top": 5,
  "short sleeve top": 4,
  shirt: 6,
  blouse: 6,
  vest: 4,
  sling: 3,
  tshirt: 3,
  hoodie: 2,
  sweatshirt: 2,
  sweater: 4,
  cardigan: 4,
  tank_top: 2,
  crop_top: 3,
  top: 4,

  // Bottoms
  trousers: 6,
  pants: 5,
  jeans: 3,
  shorts: 2,
  skirt: 5,
  leggings: 1,

  // Outerwear
  "long sleeve outwear": 6,
  "long sleeve outerwear": 6,
  "short sleeve outwear": 5,
  "short sleeve outerwear": 5,
  blazer: 7,
  coat: 6,
  jacket: 4,
  parka: 3,
  bomber: 3,

  // Footwear
  shoe: 3,
  heels: 8,
  loafers: 6,
  boots: 4,
  flats: 5,
  sneakers: 2,
  sandals: 2,

  // Bags
  clutch: 8,
  "bag, wallet": 5,
  bag: 5,
  tote: 4,
  crossbody: 4,
  backpack: 2,

  // Accessories
  tie: 8,
  watch: 6,
  hat: 3,
  sunglasses: 4,
  belt: 5,
  scarf: 5,
  jewelry: 6,
  necklace: 6,
  bracelet: 5,
  earrings: 6,
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function inferFormalityFromLabel(label: string | undefined): number {
  const key = String(label ?? "").toLowerCase().trim();
  if (FORMALITY_MAP[key] !== undefined) return FORMALITY_MAP[key];
  const mapping = mapDetectionToCategory(key, 0.5);
  if (typeof mapping.attributes.formalityHint === "number") return mapping.attributes.formalityHint;
  return 5;
}

function formalityToAttrStyleToken(formality: number): string {
  // Matches attributeExtractor normalization (attr_style keywords are hyphenated).
  if (formality >= 8) return "formal";
  if (formality >= 7) return "semi-formal";
  if (formality >= 5) return "smart-casual";
  return "casual";
}

function formalityToOccasionToken(formality: number): "formal" | "semi-formal" | "casual" {
  if (formality >= 8) return "formal";
  if (formality >= 6) return "semi-formal";
  return "casual";
}

/** Extract formality intent from BLIP full-image caption. Returns 8+ for formal wear, 0 for no formal cue. */
function inferFormalityFromCaption(caption: string): number {
  const s = String(caption || "").toLowerCase();
  if (!s) return 0;
  // Formal wear cues: suit, tie, tuxedo, black-tie, formal event, business, etc.
  if (/\b(suit|suits|tuxedo|black-tie|formal|formal wear|dress code|business suit|elegance|elegant)\b/.test(s)) {
    return 9; // High formality score for explicit formal cues
  }
  if (/\b(tie|dress shirt|dress pants|dress jacket|blazer|sport coat|coat)\b/.test(s)) {
    // Moderate formal cue — could be formal or smart-casual context
    // If combined with other formal markers, boost to 8; otherwise conservative 7
    const formalMarkers = (s.match(/\b(suit|tuxedo|formal|black-tie|elegant|business)\b/g) || []).length;
    if (formalMarkers >= 1) return 8;
  }
  return 0;
}

function inferStyleForDetectionLabel(label: string): {
  formality: number;
  attrStyle: string;
  style: { occasion?: string; aesthetic?: string; formality?: number };
} {
  const formality = inferFormalityFromLabel(label);
  const attrStyle = formalityToAttrStyleToken(formality);
  const occasion = formalityToOccasionToken(formality);
  const aesthetic = formality >= 8 ? "elegant" : undefined;
  return { formality, attrStyle, style: { occasion, aesthetic, formality } };
}

function shouldApplyInferredStyleFallback(productCategory: string, detectionLabel: string): boolean {
  const cat = String(productCategory || "").toLowerCase();
  const label = String(detectionLabel || "").toLowerCase();
  if (cat === "bottoms") {
    // Bottom silhouettes (trousers/pants/jeans) are weak style predictors and
    // can push retrieval toward formal pants when the crop is actually denim.
    if (/\b(trouser|trousers|pants|pant|chino|chinos|jean|jeans|denim|slack|slacks|cargo)\b/.test(label)) {
      return false;
    }
  }
  return true;
}

/** BLIP slot color for this catalog category (top vs jeans vs dress), if the caption named one explicitly. */
function captionColorForProductCategory(
  productCategory: string,
  captionColors: {
    topColor?: string | null;
    jeansColor?: string | null;
    garmentColor?: string | null;
    shoeColor?: string | null;
    bagColor?: string | null;
  },
): string | null {
  if (productCategory === "tops") return captionColors.topColor ?? null;
  if (productCategory === "bottoms") return captionColors.jeansColor ?? null;
  if (productCategory === "dresses") return captionColors.garmentColor ?? null;
  if (productCategory === "outerwear") return captionColors.garmentColor ?? null;
  if (productCategory === "footwear") return captionColors.shoeColor ?? null;
  if (productCategory === "bags" || productCategory === "accessories") return captionColors.bagColor ?? null;
  return null;
}

function isOnePieceColorSensitiveCategory(productCategory: string, detectionLabel: string): boolean {
  const cat = String(productCategory || "").toLowerCase();
  const label = String(detectionLabel || "").toLowerCase();
  if (cat === "dresses") return true;
  return /\b(dress|gown|jumpsuit|romper|playsuit)\b/.test(label);
}

function isBottomColorSensitiveCategory(productCategory: string, detectionLabel: string): boolean {
  const cat = String(productCategory || "").toLowerCase();
  const label = String(detectionLabel || "").toLowerCase();
  if (cat === "bottoms") return true;
  return /\b(trouser|trousers|pant|pants|jean|jeans|denim|legging|leggings|short|shorts|skirt|skirts)\b/.test(label);
}

function isTopLikeColorSensitiveCategory(productCategory: string, detectionLabel: string): boolean {
  const cat = String(productCategory || "").toLowerCase();
  const label = String(detectionLabel || "").toLowerCase();
  if (cat === "tops" || cat === "outerwear") return true;
  return /\b(top|shirt|tee|t-?shirt|blouse|sweater|hoodie|jacket|coat|blazer|outerwear|cardigan)\b/.test(label);
}

function isFootwearColorSensitiveCategory(productCategory: string, detectionLabel: string): boolean {
  const cat = String(productCategory || "").toLowerCase();
  const label = String(detectionLabel || "").toLowerCase();
  if (cat === "footwear" || cat === "shoes") return true;
  return /\b(shoe|shoes|sneaker|sneakers|boot|boots|loafer|loafers|heel|heels|sandal|sandals|trainer|trainers|flats?)\b/.test(
    label,
  );
}

async function extractDetectionCropColorsForRanking(params: {
  clipBuffer: Buffer;
  productCategory: string;
  detectionLabel: string;
}): Promise<string[]> {
  const onePiece = isOnePieceColorSensitiveCategory(params.productCategory, params.detectionLabel);
  const bottoms = isBottomColorSensitiveCategory(params.productCategory, params.detectionLabel);
  const trousersLikeBottom = /\b(trouser|trousers|pant|pants|jean|jeans|denim|chino|chinos|slack|slacks|cargo)\b/.test(
    String(params.detectionLabel || "").toLowerCase(),
  );
  const longSleeveTopLike = /\b(long sleeve top|long sleeve|shirt|blouse|button\s*down|button-down)\b/.test(
    String(params.detectionLabel || "").toLowerCase(),
  );
  const topLike = isTopLikeColorSensitiveCategory(params.productCategory, params.detectionLabel);
  const footwear = isFootwearColorSensitiveCategory(params.productCategory, params.detectionLabel);
  let colorBuffer = params.clipBuffer;

  if (onePiece || bottoms || topLike || footwear) {
    try {
      const meta = await sharp(params.clipBuffer).metadata();
      const w = meta.width ?? 0;
      const h = meta.height ?? 0;
      if (w >= 24 && h >= 48) {
        let left = 0;
        let top = 0;
        let width = w;
        let height = h;

        if (onePiece) {
          // Exclude lower hem/footwear overlap where detector boxes touch shoes.
          height = Math.max(24, Math.floor(h * 0.72));
        } else if (bottoms) {
          // Bottom boxes often include torso at the top and shoes at the bottom.
          // Use a tighter center-lower band to avoid shirt and footwear bleed.
          // Trousers/jeans are especially prone to top overlap, so sample lower.
          left = Math.floor(w * 0.2);
          width = Math.max(16, Math.floor(w * 0.6));
          top = Math.floor(h * (trousersLikeBottom ? 0.5 : 0.34));
          const bottom = Math.floor(h * (trousersLikeBottom ? 0.94 : 0.78));
          height = Math.max(24, bottom - top);
        } else if (topLike) {
          // Top/outerwear boxes can include pants near the lower edge.
          // Sample upper-mid torso and trim side edges to avoid background/pants bleed.
          left = Math.floor(w * (longSleeveTopLike ? 0.14 : 0.12));
          width = Math.max(16, Math.floor(w * (longSleeveTopLike ? 0.72 : 0.76)));
          top = Math.floor(h * (longSleeveTopLike ? 0.06 : 0.08));
          const bottom = Math.floor(h * (longSleeveTopLike ? 0.58 : 0.62));
          height = Math.max(24, bottom - top);
        } else if (footwear) {
          // Shoe boxes frequently include floor pixels around edges.
          // Use an inner crop to prioritize the shoe body over surrounding ground.
          left = Math.floor(w * 0.12);
          width = Math.max(14, Math.floor(w * 0.76));
          top = Math.floor(h * 0.1);
          const bottom = Math.floor(h * 0.9);
          height = Math.max(16, bottom - top);
        }

        left = Math.max(0, Math.min(left, Math.max(0, w - 1)));
        top = Math.max(0, Math.min(top, Math.max(0, h - 1)));
        width = Math.max(1, Math.min(width, w - left));
        height = Math.max(1, Math.min(height, h - top));

        colorBuffer = await sharp(params.clipBuffer)
          .extract({ left, top, width, height })
          .png()
          .toBuffer();
      }
    } catch {
      // Fall back to the original clip buffer.
    }
  }

  return extractDominantColorNames(colorBuffer, {
    maxColors: 3,
    minShare: onePiece ? 0.18 : bottoms ? 0.2 : footwear ? 0.2 : 0.15,
  });
}

function requiresSlotSpecificColor(productCategory: string): boolean {
  return (
    productCategory === "tops" ||
    productCategory === "bottoms" ||
    productCategory === "dresses" ||
    productCategory === "outerwear"
  );
}

function isNeutralFashionColorEarly(color: string): boolean {
  const c = String(color || "").toLowerCase().trim();
  return (
    c === "black" ||
    c === "gray" ||
    c === "charcoal" ||
    c === "white" ||
    c === "off-white" ||
    c === "cream" ||
    c === "ivory" ||
    c === "beige" ||
    c === "tan" ||
    c === "brown" ||
    c === "navy" ||
    c === "silver"
  );
}

function isChromaticFashionColor(color: string): boolean {
  const c = String(color || "").toLowerCase().trim();
  return c.length > 0 && !isNeutralFashionColorEarly(c);
}

function canPromoteCaptionSlotColor(params: {
  productCategory: string;
  detectionLabel: string;
  existingColor: string | null | undefined;
  existingSource: number;
  existingConfidence: number;
  captionColor: string | null | undefined;
  captionConfidence: number;
  minCaptionConfidence?: number;
}): boolean {
  if (!requiresSlotSpecificColor(params.productCategory)) return false;

  const captionColor = String(params.captionColor || "").toLowerCase().trim();
  if (!captionColor) return false;
  if (captionColor === "multicolor") return false;

  const minCaptionConfidence = Number.isFinite(params.minCaptionConfidence)
    ? Math.max(0, Math.min(1, Number(params.minCaptionConfidence)))
    : 0.62;
  const captionConfidence = clamp01(Number(params.captionConfidence ?? 0));
  if (captionConfidence < minCaptionConfidence) return false;
  // User preference: trust BLIP caption when provided for slot-specific colors.
  // Keep only a confidence gate and avoid over-constraining by prior crop color.
  return true;
}

function ensureStyleAndMask(detection: Detection, imageWidth: number, imageHeight: number): Detection {
  const next: Detection = { ...detection };

  // Style fallback (YOLO dual-model currently returns `style: null`).
  const needsStyle = !next.style || typeof next.style.formality !== "number";
  if (needsStyle) {
    next.style = inferStyleForDetectionLabel(next.label).style;
  } else if (next.style) {
    // Normalize externally provided style so formality and occasion are consistent.
    const normalizedFormality = Math.max(0, Math.min(10, Number(next.style.formality ?? 0)));
    const normalizedOccasion = formalityToOccasionToken(normalizedFormality);
    next.style = {
      ...next.style,
      formality: normalizedFormality,
      occasion: normalizedOccasion,
      aesthetic: normalizedFormality >= 8 ? next.style.aesthetic ?? "elegant" : next.style.aesthetic,
    };
  }

  // Mask fallback: approximate a segmentation polygon from the bounding box.
  if (!next.mask) {
    const bn = next.box_normalized;
    const polygon_normalized: number[][] = [
      [bn.x1, bn.y1],
      [bn.x2, bn.y1],
      [bn.x2, bn.y2],
      [bn.x1, bn.y2],
    ];
    const polygon: number[][] = [
      [next.box.x1, next.box.y1],
      [next.box.x2, next.box.y1],
      [next.box.x2, next.box.y2],
      [next.box.x1, next.box.y2],
    ];
    const maskArea = Math.max(0, (next.box.x2 - next.box.x1) * (next.box.y2 - next.box.y1));
    const denom = Math.max(1, imageWidth * imageHeight);
    const maskAreaRatio = next.area_ratio ?? maskArea / denom;
    next.mask = {
      polygon,
      polygon_normalized,
      mask_area: maskArea,
      mask_area_ratio: clamp01(maskAreaRatio),
    } as SegmentationMask;
  }

  return next;
}

/**
 * Correct obvious YOLO misclassifications using spatial heuristics.
 * E.g., "long sleeve outwear" detected in the lower body region is likely shorts/trousers.
 */
function correctDetectionByPosition(detection: Detection): Detection {
  const label = String(detection.label || "").toLowerCase();
  const bn = detection.box_normalized;
  if (!bn) return detection;

  const centerY = (bn.y1 + bn.y2) / 2;
  const boxHeight = bn.y2 - bn.y1;

  // Outerwear detected in lower body region is sometimes bottoms (shorts/pants).
  // Restrict aggressively: legitimate jackets routinely have boxHeight 0.3-0.5 and
  // centerY 0.55-0.65 (mid-portrait crops). Only reclassify when the box is *clearly*
  // a small lower-third item: top of the box well below the waist, height short,
  // and detection confidence weak (high-confidence outerwear should never be flipped).
  if (
    /\b(outwear|outerwear|jacket)\b/.test(label) &&
    centerY > 0.72 &&
    boxHeight < 0.28 &&
    bn.y1 > 0.62 &&
    (Number.isFinite(detection.confidence) ? detection.confidence : 1) < 0.5
  ) {
    const corrected = { ...detection };
    corrected.label = "shorts";
    corrected.raw_label = `${detection.raw_label ?? detection.label} [corrected:position]`;
    return corrected;
  }

  // Tops detected fully in the lower third are likely bottoms.
  if (
    /\b(top|shirt|blouse)\b/.test(label) &&
    !label.includes("dress") &&
    bn.y1 > 0.55 &&
    centerY > 0.65 &&
    boxHeight < 0.35
  ) {
    const corrected = { ...detection };
    corrected.label = "shorts";
    corrected.raw_label = `${detection.raw_label ?? detection.label} [corrected:position]`;
    return corrected;
  }

  // Shirts are sometimes emitted as outwear by the detector on collages.
  // Only recover to a top label when detection confidence is very low — high-confidence
  // outwear detections are genuine jackets/coats and must stay as outerwear.
  if (
    /\b(outwear|outerwear|jacket)\b/.test(label) &&
    centerY >= 0.2 &&
    centerY <= 0.58 &&
    boxHeight >= 0.16 &&
    boxHeight <= 0.42 &&
    (Number.isFinite(detection.confidence) ? detection.confidence : 1) < 0.38
  ) {
    const corrected = { ...detection };
    corrected.label = /\blong\b/.test(label) ? "long sleeve top" : "short sleeve top";
    corrected.raw_label = `${detection.raw_label ?? detection.label} [corrected:shirt-recovery]`;
    return corrected;
  }

  return detection;
}

function parseDetectionConcurrencyOverride(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function categoryConcurrencyOverride(category: string): number | null {
  const normalized = String(category || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_");
  if (!normalized) return null;

  const exact = parseDetectionConcurrencyOverride(
    process.env[`SEARCH_IMAGE_SHOP_DETECTION_CONCURRENCY_${normalized}`],
  );
  if (exact != null) return exact;

  if (normalized === "TOP" || normalized === "TOPS") {
    return parseDetectionConcurrencyOverride(process.env.SEARCH_IMAGE_SHOP_DETECTION_CONCURRENCY_TOPS);
  }
  if (normalized === "DRESS" || normalized === "DRESSES") {
    return parseDetectionConcurrencyOverride(process.env.SEARCH_IMAGE_SHOP_DETECTION_CONCURRENCY_DRESSES);
  }
  if (normalized === "SHOE" || normalized === "SHOES" || normalized === "FOOTWEAR") {
    return parseDetectionConcurrencyOverride(process.env.SEARCH_IMAGE_SHOP_DETECTION_CONCURRENCY_FOOTWEAR);
  }
  if (normalized === "BAG" || normalized === "BAGS") {
    return parseDetectionConcurrencyOverride(process.env.SEARCH_IMAGE_SHOP_DETECTION_CONCURRENCY_BAGS);
  }
  return null;
}

/** Max concurrent OpenSearch kNN calls per shop-the-look request (default 8). */
function shopLookPerDetectionConcurrency(detections?: Array<{ label: string; confidence?: number }>): number {
  const raw = Number(process.env.SEARCH_IMAGE_SHOP_DETECTION_CONCURRENCY);
  const detectedCount = Array.isArray(detections) ? detections.length : 0;
  // Default to full fan-out across detections for lower wall-clock latency.
  let n = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : Math.max(1, detectedCount || 8);

  if (Array.isArray(detections) && detections.length > 0) {
    // Use dominant detection category to allow path/category-specific tuning.
    const byCategory = new Map<string, number>();
    for (const detection of detections) {
      const mapped = mapDetectionToCategory(
        String(detection.label || ""),
        Number(detection.confidence ?? 0),
      );
      const key = String(mapped?.productCategory || "").trim().toLowerCase();
      if (!key) continue;
      byCategory.set(key, (byCategory.get(key) ?? 0) + 1);
    }
    const dominantCategory = [...byCategory.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (dominantCategory) {
      const override = categoryConcurrencyOverride(dominantCategory);
      if (override != null) n = override;
    }
  }

  // Avoid accidental fully-serial per-detection execution unless explicitly allowed.
  const allowSerial = String(process.env.SEARCH_IMAGE_SHOP_ALLOW_SERIAL_DETECTION ?? "").toLowerCase() === "1";
  const minConcurrency = allowSerial ? 1 : 3;
  const capRaw = Number(process.env.SEARCH_IMAGE_SHOP_DETECTION_CONCURRENCY_CAP ?? "24");
  const cap = Number.isFinite(capRaw) ? Math.max(4, Math.min(64, Math.floor(capRaw))) : 24;
  return Math.min(cap, Math.max(minConcurrency, n));
}

/** Max search calls per detection (initial + retries/fallbacks). Default 3 to preserve recall on hard detections. */
function shopLookMaxSearchCallsPerDetection(): number {
  if (shopLookDeterministicTwoPassEnv()) return 2;
  const raw = Number(process.env.SEARCH_IMAGE_SHOP_MAX_SEARCH_CALLS ?? "3");
  if (!Number.isFinite(raw)) return 3;
  // A value of 1 collapses recall for hard categories (tops/bottoms/footwear) because
  // no retry/recovery path can run. Keep at least 2 calls to preserve pipeline robustness.
  return Math.max(2, Math.min(8, Math.floor(raw)));
}

function shopLookDeterministicTwoPassEnv(): boolean {
  const raw = String(process.env.SEARCH_IMAGE_DETECTION_DETERMINISTIC_TWO_PASS ?? "0").toLowerCase().trim();
  return raw !== "0" && raw !== "false" && raw !== "off" && raw !== "no";
}

function shopLookDeterministicPassBMinResults(productCategory: string, perItemLimit: number): number {
  const category = String(productCategory ?? "").toLowerCase().trim();
  const base =
    category === "tops"
      ? Math.max(3, Math.floor(perItemLimit * 0.35))
      : category === "bottoms"
        ? Math.max(3, Math.floor(perItemLimit * 0.32))
        : category === "dresses"
          ? Math.max(2, Math.floor(perItemLimit * 0.28))
          : Math.max(2, Math.floor(perItemLimit * 0.22));
  return Math.max(1, Math.min(10, base));
}

function shopLookMainPathOnlyEnv(): boolean {
  const raw = String(process.env.SEARCH_IMAGE_MAIN_PATH_ONLY ?? "0").toLowerCase().trim();
  return raw === "1" || raw === "true";
}

/**
 * When the first kNN pass is already very slow, avoid stacking retries if recall is
 * already acceptable. This trims tail latency without affecting low-recall detections.
 */
function shopLookSlowFirstSearchMsThreshold(): number {
  const raw = Number(process.env.SEARCH_IMAGE_SHOP_SLOW_FIRST_SEARCH_MS ?? "12000");
  if (!Number.isFinite(raw)) return 12000;
  return Math.max(3000, Math.min(60000, Math.floor(raw)));
}

/** Minimum first-pass results required to skip extra retry/recovery calls on slow detections. */
function shopLookSlowFirstSearchSkipRecoveryMinResults(): number {
  const raw = Number(process.env.SEARCH_IMAGE_SHOP_SLOW_FIRST_SEARCH_SKIP_RECOVERY_MIN_RESULTS ?? "6");
  if (!Number.isFinite(raw)) return 6;
  return Math.max(1, Math.min(40, Math.floor(raw)));
}

function shopLookSlowFirstSearchSkipRecoveryMinResultsByCategory(productCategory: string): number {
  const normalized = String(productCategory || "").toLowerCase().trim();
  if (normalized === "accessories" || normalized === "bags") {
    const raw = Number(process.env.SEARCH_IMAGE_SHOP_SLOW_FIRST_SEARCH_SKIP_RECOVERY_MIN_RESULTS_ACCESSORIES ?? "3");
    if (Number.isFinite(raw)) return Math.max(1, Math.min(20, Math.floor(raw)));
    return 3;
  }
  if (normalized === "footwear") {
    const raw = Number(process.env.SEARCH_IMAGE_SHOP_SLOW_FIRST_SEARCH_SKIP_RECOVERY_MIN_RESULTS_FOOTWEAR ?? "4");
    if (Number.isFinite(raw)) return Math.max(1, Math.min(20, Math.floor(raw)));
    return 4;
  }
  return shopLookSlowFirstSearchSkipRecoveryMinResults();
}

function shopLookSkipDetectionBlipCategories(): Set<string> {
  const raw = String(process.env.SEARCH_IMAGE_SHOP_SKIP_DETECTION_BLIP_CATEGORIES ?? "accessories,bags");
  return new Set(
    raw
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Hard wall-clock budget per detection task in ms (default 25000) to prevent long stragglers. */
function shopLookMaxDetectionTaskMs(): number {
  const raw = Number(process.env.SEARCH_IMAGE_SHOP_MAX_DETECTION_TASK_MS ?? "25000");
  if (!Number.isFinite(raw)) return 25000;
  return Math.max(5000, Math.min(120000, Math.floor(raw)));
}

/**
 * Infer specific footwear subtype from BLIP caption when YOLO returns generic "shoe".
 * Returns a more specific label to feed into `hardCategoryTermsForDetection`.
 *
 * Note: This is synchronous and relies on caption keywords. For caption-less cases,
 * use the async classifyFootwearSubtypeFromCropEmbedding fallback (CLIP zero-shot).
 */
export function inferFootwearSubtypeFromCaption(
  detectionLabel: string,
  caption: string | null | undefined,
  opts?: { confidence?: number; areaRatio?: number },
): string {
  const label = String(detectionLabel || "").toLowerCase();
  if (label !== "shoe" && label !== "shoes") return label;
  const confidence = Number(opts?.confidence ?? 0);
  const areaRatio = Number(opts?.areaRatio ?? 0);
  // Allow caption-driven refinement even when detection confidence/area are not set.
  const cap = String(caption ?? "").toLowerCase();
  // Model B (yolos-fashionpedia) rarely exceeds 0.9 confidence — lower threshold
  // so subtype inference fires for most detections with a visible shoe region.
  const refineEligible = confidence >= 0.55 || areaRatio >= 0.015 || (cap && cap.trim().length > 0);
  if (!refineEligible) return label;
  if (!cap) return label;

  // Ordered: most specific patterns first to avoid overlap (e.g., "formal dress shoes" → oxfords, not just "dress shoe").
  if (/\b(sneaker|sneakers|trainer|trainers|running\s*shoe|athletic\s*shoe|sport\s*shoe|cross\s*trainer)\b/.test(cap)) return "sneakers";
  if (/\b(boot|boots|ankle\s*boot|combat\s*boot|chelsea|hiking\s*boot|rain\s*boot|cowboy\s*boot)\b/.test(cap)) return "boots";
  if (/\b(heel|heels|pump|pumps|stiletto|stilettos|wedge|wedges|platform|slingback|kitten\s*heel)\b/.test(cap)) return "heels";
  if (/\b(sandal|sandals|slide|slides|mule|mules|flip\s*flop|espadrille|gladiator|thong)\b/.test(cap)) return "sandals";
  if (/\b(loafer|loafers|moccasin|moccasins|penny\s*loafer|driving\s*shoe|slip[\s-]?on)\b/.test(cap)) return "loafers";
  if (/\b(flat|flats|ballet|ballerina|ballet\s*flat|baller)\b/.test(cap)) return "flats";
  if (/\b(oxford|oxfords|brogue|brogues|derby|dress\s*shoe|formal\s*shoe)\b/.test(cap)) return "oxfords";
  if (/\b(clog|clogs)\b/.test(cap)) return "clogs";
  // Catch-all formal cues when specific type not mentioned
  if (/\b(formal|business|suit|tuxedo)\b/.test(cap) && /\b(shoe|shoes|footwear)\b/.test(cap)) return "oxfords";

  // Caption didn't specify a subtype — could try CLIP but this is sync-only.
  return label;
}

/**
 * CLIP zero-shot footwear subtype classification from crop embedding.
 * Used when YOLO returns a generic "shoe" label and BLIP caption lacks subtype cues.
 * Text embeddings are computed once and cached for the process lifetime.
 */
const FOOTWEAR_SUBTYPE_PROMPTS: Array<{ subtype: string; prompts: string[] }> = [
  {
    subtype: "sneakers",
    prompts: ["a photo of sneakers", "a pair of athletic sneakers", "running shoes or trainers"],
  },
  {
    subtype: "boots",
    prompts: ["a photo of boots", "ankle boots or knee-high boots", "leather or suede boots"],
  },
  {
    subtype: "heels",
    prompts: ["a photo of high heels", "stiletto heels or pumps", "platform heels or wedge shoes"],
  },
  {
    subtype: "sandals",
    prompts: ["a photo of sandals", "open-toe sandals or slides", "flip flops or strappy sandals"],
  },
  {
    subtype: "loafers",
    prompts: ["a photo of loafers", "slip-on loafers or moccasins", "penny loafers"],
  },
  {
    subtype: "flats",
    prompts: ["a photo of ballet flats", "flat shoes or ballerina flats", "oxford shoes or derbies"],
  },
];

type FootwearSubtypeCache = {
  subtype: string;
  embeddings: number[][];
} | null;

let footwearSubtypeEmbeddingCache: FootwearSubtypeCache[] | null = null;

async function ensureFootwearSubtypeEmbeddings(): Promise<Array<{ subtype: string; embeddings: number[][] }>> {
  if (footwearSubtypeEmbeddingCache) return footwearSubtypeEmbeddingCache as Array<{ subtype: string; embeddings: number[][] }>;
  const results = await Promise.all(
    FOOTWEAR_SUBTYPE_PROMPTS.map(async ({ subtype, prompts }) => {
      const embeddings = await Promise.all(
        prompts.map((p) => getTextEmbedding(p).catch(() => null)),
      );
      return { subtype, embeddings: embeddings.filter((e): e is number[] => e !== null) };
    }),
  );
  footwearSubtypeEmbeddingCache = results;
  return results;
}

/**
 * Classify footwear subtype from crop embedding via CLIP zero-shot.
 * Returns the best-matching subtype name or null if confidence is too low or
 * the text encoder is unavailable.
 */
async function classifyFootwearSubtypeFromCropEmbedding(
  cropEmbedding: number[],
  minConfidence = 0.3,
): Promise<string | null> {
  try {
    const subtypeData = await ensureFootwearSubtypeEmbeddings();
    let bestSubtype: string | null = null;
    let bestScore = -1;
    let secondBestScore = -1;
    for (const { subtype, embeddings } of subtypeData) {
      if (embeddings.length === 0) continue;
      // Average cosine similarity across all prompts for this subtype.
      const avgScore =
        embeddings.reduce((sum, te) => sum + cosineSimilarity(cropEmbedding, te), 0) / embeddings.length;
      if (avgScore > bestScore) {
        secondBestScore = bestScore;
        bestScore = avgScore;
        bestSubtype = subtype;
      } else if (avgScore > secondBestScore) {
        secondBestScore = avgScore;
      }
    }
    const margin = bestScore - secondBestScore;
    const minMargin = 0.02;
    return bestScore >= minConfidence && margin >= minMargin ? bestSubtype : null;
  } catch {
    return null;
  }
}

/**
 * Async fallback: refine footwear subtype using CLIP zero-shot classification.
 * Called when caption is missing or doesn't specify a subtype.
 * Requires crop embedding (e.g., from ROI box around shoe).
 *
 * @param detectionLabel - YOLO label (e.g., "shoe")
 * @param cropEmbedding - CLIP embedding from shoe crop region
 * @param caption - Optional BLIP caption (tried first, sync)
 * @returns Refined subtype (e.g., "sneakers", "heels") or original label
 */
export async function refineFootwearSubtypeWithCLIP(
  detectionLabel: string,
  cropEmbedding: number[],
  caption?: string | null,
): Promise<string> {
  const label = String(detectionLabel || "").toLowerCase();
  if (label !== "shoe" && label !== "shoes") return label;

  // Try caption first (instant)
  if (caption) {
    const captionInferred = inferFootwearSubtypeFromCaption(label, caption);
    if (captionInferred !== label) return captionInferred; // Caption specified a subtype
  }

  // Caption didn't help — try CLIP zero-shot (requires embedding)
  if (!cropEmbedding || cropEmbedding.length === 0) return label;
  
  try {
    const clipSubtype = await classifyFootwearSubtypeFromCropEmbedding(cropEmbedding, 0.3);
    if (clipSubtype) return clipSubtype;
  } catch {
    // CLIP unavailable or error — fall through to original label
  }

  return label;
}

export function normalizeDetectionLabelForSearch(label: string): string {
  return String(label ?? "")
    .toLowerCase()
    .replace(/\boutwear\b/g, "outerwear")
    .replace(/\s+/g, " ")
    .trim();
}

function mainPathTypeHintClusterKey(hint: string): string {
  const h = normalizeDetectionLabelForSearch(hint);
  if (/\b(t-?shirt|tshirt|tee|tees|tank|camisole|cami)\b/.test(h)) return "top:tee";
  if (/\b(shirt|shirts|blouse|blouses|button\s*down|button-down)\b/.test(h)) return "top:shirt";
  if (/\b(sweater|sweaters|cardigan|cardigans|knitwear|jumper|jumpers)\b/.test(h)) return "top:knit";
  if (/\b(hoodie|hoodies|hoody|sweatshirt|sweatshirts|pullover|pullovers)\b/.test(h)) return "top:hoodie";
  if (/\b(polos?|polo\s*shirt)\b/.test(h)) return "top:polo";
  if (/\b(suit|suits|tuxedo|tuxedos)\b/.test(h)) return "tailored:suit";
  if (/\b(vest|vests|waistcoat|waistcoats|gilet|gilets)\b/.test(h)) return "tailored:vest";
  if (/\b(blazer|blazers|sport\s*coat|sportcoat)\b/.test(h)) return "outerwear:blazer";
  if (/\b(coat|coats|overcoat|overcoats|parka|parkas|trench|trenches|puffer\s+coats?|down\s+coats?|long\s+coat|wool\s+coat)\b/.test(h)) return "outerwear:coat";
  if (/\b(blouson|blousons|fleece|fleeces|puffer|puffers|down\s+jackets?|quilted\s+jackets?|rain\s+jackets?|shell\s+jackets?|softshell(?:\s+jackets?)?)\b/.test(h)) return "outerwear:layer";
  if (/\b(jacket|jackets|outerwear|shacket|shackets|overshirt|overshirts|bomber|bombers|windbreaker|windbreakers)\b/.test(h)) return "outerwear:jacket";
  return h;
}

function normalizeMaterialHintForSearch(value: unknown): string {
  const s = String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!s) return "";
  if (/\b(wool|woolen|woollen|cashmere|merino|alpaca|mohair|knit|knitted|knitwear|fleece|sherpa)\b/.test(s)) {
    return "winter";
  }
  if (/\b(cotton|linen|ramie|jersey|modal|viscose|rayon|lyocell|tencel|poplin)\b/.test(s)) {
    return "lightweight";
  }
  return "";
}

function longSleeveTopPriorityHints(detectionLabel: string, materialHint?: string | null, broad = false): string[] {
  const label = normalizeDetectionLabelForSearch(detectionLabel);
  const material = normalizeMaterialHintForSearch(materialHint);
  if (/\b(hoodie|hoodies|hoody|sweatshirt|sweatshirts)\b/.test(label)) {
    return broad ? ["hoodie", "sweatshirt", "pullover", "top"] : ["hoodie", "sweatshirt", "pullover"];
  }
  if (/\b(sweater|cardigan|pullover|jumper|knitwear)\b/.test(label) || material === "winter") {
    return broad
      ? ["sweater", "knit tops", "sweatshirt", "cardigan", "knitwear", "hoodie", "hoody", "pullover", "top", "tops"]
      : ["sweater", "knit tops", "sweatshirt"];
  }
  if (material === "lightweight") {
    return broad
      ? ["shirt", "woven tops", "shirting", "blouse", "top", "long sleeve", "button down", "tops"]
      : ["shirt", "woven tops", "shirting"];
  }
  return broad
    ? ["shirt", "woven tops", "top", "sweater", "knit tops", "blouse", "cardigan", "tops"]
    : ["shirt", "woven tops", "sweater"];
}

function mainPathPriorityTypeHints(detectionLabel: string, productCategory: string, materialHint?: string | null): string[] {
  const label = normalizeDetectionLabelForSearch(detectionLabel);
  const category = String(productCategory ?? "").toLowerCase().trim();

  if (category === "tops") {
    if (/\blong\s+sleeve\b|\bfull\s+sleeve\b/.test(label)) {
      return longSleeveTopPriorityHints(label, materialHint, false);
    }
    if (/\bshort\s+sleeve\b|\btee\b|\bt-?shirt\b|\btshirt\b/.test(label)) {
      return ["tshirt", "shirt", "polo"];
    }
  }

  if (category === "outerwear" || category === "tailored") {
    if (/\b(vest|vests|waistcoat|waistcoats|gilet|gilets)\b/.test(label)) {
      return ["vest", "waistcoat", "gilet"];
    }
    if (/\b(suit|suits|tuxedo|tuxedos)\b/.test(label)) {
      return ["suit", "blazer", "dress jacket"];
    }
    if (/\b(blazer|sport\s*coat|sportcoat)\b/.test(label)) {
      return ["blazer", "sport coat", "jacket"];
    }
    if (/\b(coat|overcoat|parka|trench|puffer\s+coat|down\s+coat|long\s+coat|wool\s+coat)\b/.test(label)) {
      return ["coat", "jacket", "outerwear"];
    }
    if (/\b(fleece)\b/.test(label)) {
      return ["fleece", "jacket", "coat"];
    }
    if (/\b(puffer|down\s+jacket|quilted\s+jacket|blouson|rain\s+jacket|shell\s+jacket|softshell)\b/.test(label)) {
      return ["puffer", "jacket", "coat"];
    }
    return ["outerwear", "jacket", "outerwear & jackets"];
  }

  return [];
}

export function buildInitialTypeSearchHintsForDetection(params: {
  detectionLabel: string;
  productCategory: string;
  materialHint?: string | null;
  softProductTypeHints?: string[];
  mainPathOnly?: boolean;
  limit?: number;
}): string[] {
  const limit = Math.max(1, Math.min(3, Math.floor(Number(params.limit ?? 3))));
  const softHints = (params.softProductTypeHints ?? [])
    .map((hint) => normalizeDetectionLabelForSearch(String(hint ?? "")))
    .filter(Boolean);

  if (!params.mainPathOnly) {
    return [...new Set(softHints)].slice(0, limit);
  }

  const merged = [
    ...mainPathPriorityTypeHints(params.detectionLabel, params.productCategory, params.materialHint),
    ...softHints,
  ];
  const out: string[] = [];
  const seenHints = new Set<string>();
  const seenClusters = new Set<string>();

  for (const raw of merged) {
    const hint = normalizeDetectionLabelForSearch(raw);
    if (!hint || seenHints.has(hint)) continue;
    const cluster = mainPathTypeHintClusterKey(hint);
    if (seenClusters.has(cluster)) continue;
    seenHints.add(hint);
    seenClusters.add(cluster);
    out.push(hint);
    if (out.length >= limit) break;
  }

  return out;
}

/**
 * Infer dress silhouette/style from BLIP caption.
 * Returns a specific product-type string to feed into softProductTypeHints, or null.
 */
export function inferDressSilhouetteFromCaption(
  detectionLabel: string,
  caption: string | null | undefined,
): string | null {
  const label = String(detectionLabel || "").toLowerCase();
  if (!/\b(dress|gown|one[-\s]?piece|onepiece|sundress|kaftan|caftan|abaya)\b/.test(label)) return null;
  const cap = String(caption ?? "").toLowerCase();
  if (!cap) return null;

  if (/\b(bodycon|body\s*con|bandage|fitted|figure[\s-]?hugging|tight[\s-]?fitting)\b/.test(cap)) return "bodycon dress";
  if (/\b(wrap|wrap[\s-]?around|tie[\s-]?waist)\b/.test(cap) && /dress/.test(cap)) return "wrap dress";
  if (/\b(shirt[\s-]?dress|button[\s-]?down\s+dress|denim\s+dress)\b/.test(cap)) return "shirt dress";
  if (/\b(shift|straight\s+dress|column\s+dress|sheath)\b/.test(cap)) return "shift dress";
  if (/\b(a[\s-]?line|fit[\s-]?and[\s-]?flare|skater|circle\s+skirt)\b/.test(cap) && /dress/.test(cap)) return "a-line dress";
  if (/\b(slip\s+dress|satin\s+dress|bias[\s-]?cut)\b/.test(cap)) return "slip dress";
  if (/\b(kaftan|caftan)\b/.test(cap)) return "kaftan";
  if (/\b(abaya)\b/.test(cap)) return "abaya";
  if (/\b(sundress|sun[\s-]?dress)\b/.test(cap)) return "sundress";
  if (/\b(babydoll|baby[\s-]?doll|smock\s+dress|trapeze|empire[\s-]?waist)\b/.test(cap)) return "babydoll dress";
  if (/\b(pinafore|pinafore\s+dress)\b/.test(cap)) return "pinafore dress";
  if (/\b(maxi)\b/.test(cap) && /dress/.test(cap)) return "maxi dress";
  if (/\b(midi)\b/.test(cap) && /dress/.test(cap)) return "midi dress";
  if (/\b(mini)\b/.test(cap) && /dress/.test(cap)) return "mini dress";

  return null;
}

const DRESS_SILHOUETTE_PROMPTS: Array<{ subtype: string; prompts: string[] }> = [
  {
    subtype: "bodycon dress",
    prompts: ["a bodycon dress", "a tight fitted bodycon dress", "a figure-hugging dress"],
  },
  {
    subtype: "wrap dress",
    prompts: ["a wrap dress", "a tie-waist wrap dress", "a draped wrap midi dress"],
  },
  {
    subtype: "shirt dress",
    prompts: ["a shirt dress", "a button-down shirt dress", "a denim shirt dress"],
  },
  {
    subtype: "shift dress",
    prompts: ["a shift dress", "a straight column dress", "a loose shift dress"],
  },
  {
    subtype: "a-line dress",
    prompts: ["an a-line dress", "a fit and flare dress", "a skater dress"],
  },
  {
    subtype: "slip dress",
    prompts: ["a slip dress", "a satin slip dress", "a bias cut slip dress"],
  },
  {
    subtype: "maxi dress",
    prompts: ["a maxi dress", "a long floor-length dress", "a flowing maxi dress"],
  },
  {
    subtype: "midi dress",
    prompts: ["a midi dress", "a knee-length midi dress", "a calf-length dress"],
  },
  {
    subtype: "mini dress",
    prompts: ["a mini dress", "a short mini dress", "a thigh-length dress"],
  },
];

type DressSilhouetteCache = Array<{ subtype: string; embeddings: number[][] }> | null;
let dressSilhouetteEmbeddingCache: DressSilhouetteCache = null;

async function ensureDressSilhouetteEmbeddings(): Promise<Array<{ subtype: string; embeddings: number[][] }>> {
  if (dressSilhouetteEmbeddingCache) return dressSilhouetteEmbeddingCache;
  const results = await Promise.all(
    DRESS_SILHOUETTE_PROMPTS.map(async ({ subtype, prompts }) => {
      const embeddings = await Promise.all(
        prompts.map((p) => getTextEmbedding(p).catch(() => null)),
      );
      return { subtype, embeddings: embeddings.filter((e): e is number[] => e !== null) };
    }),
  );
  dressSilhouetteEmbeddingCache = results;
  return results;
}

/**
 * CLIP zero-shot dress silhouette classification from garment crop embedding.
 * Used when YOLO returns a generic dress label and BLIP caption has no silhouette cue.
 */
async function classifyDressSilhouetteFromCropEmbedding(
  cropEmbedding: number[],
  minConfidence = 0.28,
): Promise<string | null> {
  try {
    const silhouetteData = await ensureDressSilhouetteEmbeddings();
    let bestSubtype: string | null = null;
    let bestScore = -1;
    let secondBestScore = -1;
    for (const { subtype, embeddings } of silhouetteData) {
      if (embeddings.length === 0) continue;
      const avgScore =
        embeddings.reduce((sum, te) => sum + cosineSimilarity(cropEmbedding, te), 0) / embeddings.length;
      if (avgScore > bestScore) {
        secondBestScore = bestScore;
        bestScore = avgScore;
        bestSubtype = subtype;
      } else if (avgScore > secondBestScore) {
        secondBestScore = avgScore;
      }
    }
    const margin = bestScore - secondBestScore;
    return bestScore >= minConfidence && margin >= 0.018 ? bestSubtype : null;
  } catch {
    return null;
  }
}

function strictFootwearSubtypeFallbackTerms(
  detectionLabel: string,
): string[] | null {
  const label = String(detectionLabel || "").toLowerCase();
  if (!label) return null;

  if (/\b(sneaker|sneakers|trainer|trainers|running\s*shoe|athletic\s*shoe|sport\s*shoe|tennis\s*shoe)\b/.test(label)) {
    return ["sneakers", "sneaker", "trainers", "trainer", "running shoes", "athletic shoes", "tennis shoes"];
  }
  if (/\b(boot|boots|ankle\s*boot|combat\s*boot|chelsea)\b/.test(label)) {
    return ["boots", "boot", "ankle boots", "chelsea boots"];
  }
  if (/\b(heel|heels|pump|pumps|stiletto|stilettos|wedge|wedges|slingback|kitten\s*heel)\b/.test(label)) {
    return ["heels", "heel", "pumps", "pump", "stiletto", "wedge", "slingback", "kitten heel"];
  }
  if (/\b(sandal|sandals|slide|slides|mule|mules|flip\s*flop|flip-flop)\b/.test(label)) {
    return ["sandals", "sandal", "slides", "slide", "mules", "mule", "flip flop"];
  }
  if (/\b(loafer|loafers|moccasin|slip.?on)\b/.test(label)) {
    return ["loafers", "loafer", "moccasins", "moccasin", "slip-on", "slip ons"];
  }
  if (/\b(flat|flats|ballet|ballerina|oxford|oxfords|derby|brogue|brogues)\b/.test(label)) {
    return ["flats", "flat", "ballet flats", "oxfords", "oxford", "derby", "brogues"];
  }
  if (/\b(slipper|slippers|espadrille|espadrilles|clog|clogs)\b/.test(label)) {
    return ["slippers", "slipper", "espadrilles", "espadrille", "clogs", "clog"];
  }
  return null;
}

function isGenericFootwearDetectionLabel(label: string): boolean {
  const l = String(label || "").toLowerCase();
  return /\bshoe\b|\bshoes\b|\bfootwear\b/.test(l) &&
    !/\b(sneaker|sneakers|trainer|trainers|running\s*shoe|athletic\s*shoe|sport\s*shoe|tennis\s*shoe|boot|boots|heel|heels|pump|pumps|sandal|sandals|loafer|loafers|flat|flats|mule|mules|slide|slides|oxford|oxfords|derby|brogue|clog|clogs|slipper|slippers)\b/.test(l);
}

function isFootwearSearchTerm(term: string): boolean {
  return /\b(footwear|shoe|shoes|sneaker|sneakers|trainer|trainers|running\s*shoes?|athletic\s*shoes?|sport\s*shoes?|tennis\s*shoes?|boot|boots|ankle\s*boots?|chelsea\s*boots?|heel|heels|pump|pumps|stiletto|stilettos|wedge|wedges|sandal|sandals|slide|slides|mule|mules|flip\s*flop|flip-flop|loafer|loafers|moccasin|moccasins|flat|flats|ballet\s*flats?|oxford|oxfords|derby|brogue|brogues|clog|clogs|slipper|slippers|espadrille|espadrilles)\b/.test(
    String(term || "").toLowerCase(),
  );
}

function broadFootwearTerms(terms: string[]): string[] {
  const filtered = terms.filter((t) => isFootwearSearchTerm(t));
  return filtered.length > 0 ? filtered : terms;
}

function genericFootwearTerms(terms: string[]): string[] {
  const filtered = terms.filter((t) => /\b(shoe|shoes|dress\s*shoe|dress\s*shoes|flat|flats|loafer|loafers|oxford|oxfords|derby|derbies|brogue|brogues)\b/.test(t));
  if (filtered.length > 0) return filtered;
  return terms.filter((t) => /\b(shoe|shoes)\b/.test(t));
}

function strictDressFallbackTerms(detectionLabel: string): string[] | null {
  const label = String(detectionLabel || "").toLowerCase();
  if (!label) return null;

  if (!/\b(dress|gown|one[-\s]?piece|onepiece|sundress|sun dress|slip dress|bodycon|cocktail dress|evening dress|party dress|maxi dress|midi dress|mini dress|frock|kaftan|caftan|abaya|wrap dress|shirt dress|shift dress|a-line dress|smock|babydoll dress|pinafore|chemise|fit and flare)\b/.test(label)) {
    return null;
  }

  return [
    "dress",
    "dresses",
    "gown",
    "gowns",
    "one piece",
    "one-piece",
    "sundress",
    "sun dress",
    "slip dress",
    "bodycon dress",
    "cocktail dress",
    "evening dress",
    "party dress",
    "maxi dress",
    "midi dress",
    "mini dress",
    "frock",
    "kaftan",
    "caftan",
    "abaya",
    "wrap dress",
    "shirt dress",
    "shift dress",
    "a-line dress",
    "smock dress",
    "babydoll dress",
    "pinafore dress",
    "chemise",
    "fit and flare dress",
  ];
}

/**
 * Build a hard OpenSearch `filters.category` term set that matches catalog category values.
 * We use the label as the source of specificity, because the macro aisle (e.g. `bottoms`)
 * often does not exist as a concrete `products.category` value in the catalog.
 */
function parseTopDetectionIntent(detectionLabel: string): {
  isShortTop: boolean;
  isLongTop: boolean;
  isVestTop: boolean;
  requestsOuterwear: boolean;
} {
  const l = String(detectionLabel || "").toLowerCase();
  return {
    isShortTop: /\bshort sleeve top\b|\btee\b|\bt-?shirt\b|\btshirt\b|\btank\b|\bcamisole\b|\bcrop top\b/.test(l),
    isLongTop: /\blong sleeve top\b|\blong sleeve\b|\bfull sleeve\b/.test(l),
    isVestTop: /\bvest\b|\bwaistcoat\b|\bgilet\b/.test(l),
    requestsOuterwear:
      /\b(jacket|jackets|coat|coats|blazer|blazers|outerwear|outwear|parka|parkas|trench|windbreaker|windbreakers|bomber|blouson|fleece|puffer|down\s+jacket|quilted\s+jacket|rain\s+jacket|shell\s+jacket|softshell|sport coat|dress jacket|shirt jacket|shacket|overshirt)\b/.test(
        l,
      ),
  };
}

function isTopCatalogCue(text: string): boolean {
  return /\b(top|tops|shirt|shirts|blouse|blouses|tee|t-?shirt|tshirt|tank|camisole|cami|sweater|sweaters|cardigan|cardigans|hoodie|hoodies|sweatshirt|sweatshirts|pullover|jumper|loungewear)\b/.test(
    text,
  );
}

function hasExplicitPoloCue(...texts: Array<string | null | undefined>): boolean {
  const blob = texts
    .map((text) => String(text ?? "").toLowerCase())
    .join(" ");
  return /\b(polo(?:s)?|polo shirt|pique|piqu[eé])\b/.test(blob);
}

function suppressPoloForPlainShortTop(seeds: string[], ...cueTexts: Array<string | null | undefined>): string[] {
  const blob = cueTexts
    .map((text) => String(text ?? "").toLowerCase())
    .join(" ");
  if (!/\b(short sleeve top|t ?shirt|tshirt|tee|plain|basic|minimal|clean)\b/.test(blob)) {
    return seeds;
  }
  if (hasExplicitPoloCue(blob)) return seeds;
  return seeds.filter((seed) => !/\bpolo(?:s)?\b/.test(String(seed).toLowerCase()));
}

function parseBottomDetectionIntent(detectionLabel: string): {
  isTrousersLike: boolean;
  isJeansLike: boolean;
  isSkirtLike: boolean;
  isShortsLike: boolean;
} {
  const l = String(detectionLabel || "").toLowerCase();
  return {
    isTrousersLike:
      /\b(trouser|trousers|pants|pant|chino|chinos|slack|slacks|cargo|cargo pants|sweatpants)\b/.test(
        l,
      ),
    isJeansLike: /\b(jean|jeans|denim|denims)\b/.test(l),
    isSkirtLike: /\b(skirt|skirts|mini skirt|midi skirt|maxi skirt)\b/.test(l),
    isShortsLike: /\b(short|shorts|bermuda|bermudas|cargo short|cargo shorts)\b/.test(l),
  };
}

function isBottomCatalogCue(text: string): boolean {
  return /\b(pant|pants|trouser|trousers|jean|jeans|denim|chino|chinos|slack|slacks|cargo|skirt|skirts|short|shorts|legging|leggings)\b/.test(
    text,
  );
}

function hardCategoryTermsForDetection(
  detectionLabel: string,
  categoryMapping: CategoryMapping,
  opts?: { confidence?: number; areaRatio?: number; forceSuitCue?: boolean },
  caption?: string | null,
): string[] {
  const l = String(detectionLabel || "").toLowerCase();
  const hasLongSleeveCue = /\blong sleeve\b|\bfull sleeve\b/.test(l);
  const captionText = String(caption ?? "").toLowerCase();
  // forceSuitCue lets the detection-loop caller propagate a contextual-formality-derived
  // suit signal (e.g. structured top + tailored bottom + formal portrait) even when
  // BLIP/YOLO never said the literal word "suit" or "blazer". Without this the
  // outerwear branch below narrows to jackets and suits never reach the candidate pool.
  const hasCaptionSuitCue =
    Boolean(opts?.forceSuitCue) ||
    /\b(suit|suiting|blazer|sport coat|dress jacket|suit jacket|tuxedo|waistcoat|vest)\b/.test(
      captionText,
    );
  const baseTerms = getCategorySearchTerms(categoryMapping.productCategory).map((t) =>
    String(t).toLowerCase().trim(),
  );

  if (categoryMapping.productCategory === "tops") {
    const topIntent = parseTopDetectionIntent(detectionLabel);
    const isShortTop = topIntent.isShortTop;
    const isVestTop = topIntent.isVestTop;
    const isTailoredIntent = hasFormalTailoringCue(detectionLabel);
    if (isVestTop) {
      const vestTopTerms = baseTerms.filter((t) =>
        /\b(vest|vests|waistcoat|waistcoats|gilet|sleeveless top|tank|tank top|camisole|cami)\b/.test(t),
      );
      return vestTopTerms.length > 0 ? vestTopTerms : baseTerms;
    }
    if (isShortTop) {
      const shortTopTerms = baseTerms.filter((t) =>
        /\b(t-?shirt|tshirt|tee|shirt|shirts|blouse|blouses|top|tops|tank|camisole|cami|crop top|polo|polos)\b/.test(t),
      );
      return shortTopTerms.length > 0 ? shortTopTerms : baseTerms;
    }

    if (isTailoredIntent) {
      const tailoredTopTerms = baseTerms.filter((t) =>
        /\b(suit|suits|blazer|blazers|dress jacket|sport coat|waistcoat|vest|vests|dress shirt|shirt|shirts)\b/.test(
          t,
        ),
      );
      return tailoredTopTerms.length > 0 ? tailoredTopTerms : baseTerms;
    }

    const isLongTop = topIntent.isLongTop;
    if (isLongTop) {
      const longTopTerms = baseTerms.filter((t) =>
        /\b(shirt|shirts|blouse|blouses|overshirt|sweater|cardigan|knitwear|hoodie|hoodies|sweatshirt|sweatshirts|pullover|loungewear|top|tops)\b/.test(
          t,
        ),
      );
      const longTopWithoutSleeveless = longTopTerms.filter(
        (t) =>
          !/\b(tank|camisole|cami|crop top|sleeveless|strapless|halter|tee|t-?shirt|tshirt|polo)\b/.test(
            t,
          ),
      );
      if (hasLongSleeveCue && longTopWithoutSleeveless.length > 0) {
        return longTopWithoutSleeveless;
      }
      return longTopTerms.length > 0 ? longTopTerms : baseTerms;
    }
  }

  // Keep trousers/pants as primary, but allow jeans/denim candidates when the
  // detector says "trousers" so denim bottoms are not over-pruned.
  if (categoryMapping.productCategory === "bottoms") {
    const bottomIntent = parseBottomDetectionIntent(detectionLabel);
    const isTrousersLike = bottomIntent.isTrousersLike;
    const isJeansLike = bottomIntent.isJeansLike;
    const isShortsLike = bottomIntent.isShortsLike;

    if (isTrousersLike) {
      const trouserLike = baseTerms.filter((t) =>
        /\b(pant|pants|trouser|trousers|chino|chinos|slack|slacks|cargo)\b/.test(t),
      );
      const jeansLike = baseTerms.filter((t) => /\b(jean|jeans|denim|denims)\b/.test(t));
      const merged = [...new Set([...trouserLike, ...jeansLike])];
      return merged.length > 0 ? merged : baseTerms;
    }
    if (isJeansLike) {
      const jeansLike = baseTerms.filter((t) => /\b(jean|jeans|denim|denims)\b/.test(t));
      const trousersLike = baseTerms.filter((t) => /\b(pant|pants|trouser|trousers|chino|chinos|slack|slacks|cargo)\b/.test(t));
      const merged = [...new Set([...jeansLike, ...trousersLike])];
      return merged.length > 0 ? merged : baseTerms;
    }
    const isSkirtLike = bottomIntent.isSkirtLike;
    if (isSkirtLike) {
      return baseTerms.filter((t) => /\b(skirt|skirts)\b/.test(t));
    }
    if (isShortsLike) {
      const shortsLike = baseTerms.filter((t) => /\b(short|shorts|bermuda|bermudas|cargo short|cargo shorts)\b/.test(t));
      if (shortsLike.length > 0) return shortsLike;
    }
    return baseTerms;
  }

  if (categoryMapping.productCategory === "bags") {
    const confidence = Number(opts?.confidence ?? 0);
    const areaRatio = Number(opts?.areaRatio ?? 0);
    const refineEligible = !opts || confidence >= 0.86 || areaRatio >= 0.025;
    const genericBagLike =
      /\b(bag\b|bags\b|bag,\s*wallet|wallet,\s*bag)\b/.test(l) &&
      !/\b(handbag|tote|backpack|crossbody|satchel|clutch|purse)\b/.test(l);
    const bagLike = baseTerms.filter((t) =>
      /\b(bag|bags|wallet|purse|handbag|handbags|tote|totes|backpack|backpacks|clutch|clutches|crossbody|satchel|satchels)\b/.test(
        t,
      ),
    );
    if (!refineEligible && genericBagLike) {
      const broadBag = bagLike.filter(
        (t) => !/\b(wallet|cardholder|coin\s*purse|pouch|pouches)\b/.test(t),
      );
      return broadBag.length > 0 ? broadBag : bagLike;
    }
    return bagLike;
  }

  if (categoryMapping.productCategory === "dresses") {
    const dressTerms = baseTerms.filter((t) =>
      /\b(dress|dresses|gown|gowns|one piece|one-piece|sundress|sun dress|slip dress|bodycon|cocktail dress|evening dress|party dress|maxi dress|midi dress|mini dress|frock|kaftan|caftan|abaya|wrap dress|shirt dress|shift dress|a-line dress|smock|babydoll dress|pinafore|chemise|fit and flare)\b/.test(
        t,
      ),
    );
    const fallback = strictDressFallbackTerms(l);
    return dressTerms.length > 0 ? dressTerms : (fallback ?? baseTerms);
  }

  if (categoryMapping.productCategory === "footwear") {
    const isGenericShoeLike = isGenericFootwearDetectionLabel(l);
    const isBootLike = /\b(boot|boots|ankle boot|combat boot|chelsea)\b/.test(l);
    const isHeelLike = /\b(heel|heels|pump|pumps|stiletto|stilettos|wedge|wedges|slingback)\b/.test(l);
    const isSandalLike = /\b(sandal|sandals|slide|slides|mule|mules|flip flop|flip-flop)\b/.test(l);
    const strictFallback = strictFootwearSubtypeFallbackTerms(l);
    
    // CRITICAL FIX: For footwear subtypes, always include broader terms for recall
    // Using only narrow subtype terms (heels, pumps, stiletto) causes 95% of products to be filtered out
    // because most products are tagged with broader "footwear" or "shoes" category terms
    const broadTerms = broadFootwearTerms(baseTerms);

    if (isBootLike) {
      const bootsOnly = baseTerms.filter((t) => /\b(boot|boots)\b/.test(t));
      // Merge narrow boots terms with broader footwear terms for better recall
      const merged = [...new Set([...bootsOnly, ...broadTerms])];
      return merged.length > 0 ? merged : (strictFallback ?? baseTerms);
    }
    if (isHeelLike) {
      const heelsOnly = baseTerms.filter((t) => /\b(heel|heels|pump|pumps|stiletto|wedge)\b/.test(t));
      // CRITICAL: Merge narrow heels terms with broader footwear terms
      // Without this, searches for "heels" only match products tagged "heel/pump/stiletto", missing 147+ products tagged "footwear/shoes"
      const merged = [...new Set([...heelsOnly, ...broadTerms])];
      return merged.length > 0 ? merged : (strictFallback ?? baseTerms);
    }
    if (isSandalLike) {
      const sandalsOnly = baseTerms.filter((t) => /\b(sandal|sandals|slide|slides|mule|mules|flip flop|flip-flop)\b/.test(t));
      // Merge narrow sandal terms with broader footwear terms for better recall
      const merged = [...new Set([...sandalsOnly, ...broadTerms])];
      return merged.length > 0 ? merged : (strictFallback ?? baseTerms);
    }
    if (strictFallback) {
      const strict = baseTerms.filter((t) => strictFallback.some((fallback) => normalizeLooseText(t) === normalizeLooseText(fallback)));
      return strict.length > 0 ? strict : strictFallback;
    }

    if (isGenericShoeLike) {
      // Generic shoe detections are common; keep recall broad and let subtype rerank
      // handle precision once visual/category evidence is available.
      return broadFootwearTerms(baseTerms);
    }

    return broadFootwearTerms(baseTerms);
  }

  if (categoryMapping.productCategory === "outerwear") {
    const isVestLike = /\bvest\b|\bgilet\b|\bwaistcoat\b/.test(l);
    const isBlazerLike = /\b(blazer|blazers|sport\s*coat|sportcoat|suit\s*jacket|dress\s*jacket)\b/.test(l);
    const isCoatLike = /\b(coat|coats|overcoat|overcoats|parka|parkas|trench|trenches|puffer\s+coats?|down\s+coats?|windbreaker|windbreakers)\b/.test(l);
    const isJacketLike = /\b(jacket|jackets|shirt\s*jacket|shacket|overshirt|bomber|bombers|blouson|blousons|fleece|fleeces|puffer|puffers|down\s+jackets?|quilted\s+jackets?|rain\s+jackets?|shell\s+jackets?|softshell(?:\s+jackets?)?)\b/.test(l);
    if (isVestLike) {
      // Vest can be formal (waistcoat/suit vest) or fashion (sleeveless-top style).
      // Return union of outerwear vest terms + sleeveless top terms so both types surface.
      const formalVest = baseTerms.filter((t) =>
        /\b(vest|vests|waistcoat|waistcoats|gilet|gilets)\b/.test(t),
      );
      const fashionVest = getCategorySearchTerms("tops")
        .map((t) => String(t).toLowerCase().trim())
        .filter((t) => /\b(vest|vests|tank|tank top|camisole|cami|sleeveless)\b/.test(t));
      const merged = [...new Set([...formalVest, ...fashionVest])];
      return merged.length > 0 ? merged : baseTerms;
    }
    if (hasCaptionSuitCue) {
      const tailoredTerms = getCategorySearchTerms("tailored").map((t) => String(t).toLowerCase().trim());
      // Suit listings are often indexed as outerwear, so keep both formalwear and
      // outerwear vocabulary in the recall set rather than narrowing to tailored only.
      const merged = [...new Set([...tailoredTerms, ...baseTerms])];
      return merged.length > 0 ? merged : baseTerms;
    }
    if (isBlazerLike) {
      const blazerTerms = baseTerms.filter((t) => /\b(blazer|blazers|sport\s*coat|sportcoat|suit\s*jacket|dress\s*jacket)\b/.test(t));
      return blazerTerms.length > 0 ? blazerTerms : baseTerms;
    }
    if (isCoatLike) {
      const coatTerms = baseTerms.filter((t) => /\b(coat|coats|overcoat|overcoats|parka|parkas|trench|trenches|puffer\s+coats?|down\s+coats?|windbreaker|windbreakers)\b/.test(t));
      return coatTerms.length > 0 ? coatTerms : baseTerms;
    }
    if (isJacketLike) {
      const jacketTerms = baseTerms.filter((t) => /\b(jacket|jackets|shirt\s*jacket|shacket|shackets|overshirt|overshirts|bomber|bombers|blouson|blousons|fleece|fleeces|puffer|puffers|down\s+jackets?|quilted\s+jackets?|rain\s+jackets?|shell\s+jackets?|softshell(?:\s+jackets?)?)\b/.test(t));
      return jacketTerms.length > 0 ? jacketTerms : baseTerms;
    }
    return baseTerms;
  }

  // Prefer hat/cap-family over generic `accessories`.
  if (categoryMapping.productCategory === "accessories") {
    if (/\b(headband|head covering|hair accessory|hairband|headwear)\b/.test(l)) {
      return baseTerms.filter((t) => /\b(headband|headwear|hair|hairband|hat|hats|cap)\b/.test(t));
    }
    if (/\b(hat|hats|cap)\b/.test(l)) {
      return baseTerms.filter((t) => /\b(hat|hats|cap)\b/.test(t));
    }
    const accessoryOnly = baseTerms.filter((t) =>
      /\b(accessor|watch|watches|scarf|scarves|hat|hats|cap|caps|sunglass|sunglasses|jewel|jewelry|jewellery|necklace|earring|bracelet|ring|belt)\b/.test(
        t,
      ),
    );
    return accessoryOnly.length > 0 ? accessoryOnly : baseTerms;
  }

  return baseTerms;
}

function expandPredictedTypeHints(seeds: string[]): string[] {
  const normalized = seeds.map((s) => String(s).toLowerCase().trim()).filter(Boolean);
  if (normalized.length === 0) return [];
  return expandProductTypesForQuery(normalized);
}

function pruneAthleticFootwearTerms(terms: string[]): string[] {
  const normalized = [...new Set(terms.map((t) => String(t).toLowerCase().trim()).filter(Boolean))];
  if (normalized.length === 0) return normalized;

  const pruned = normalized.filter(
    (t) =>
      !/\b(sneaker|sneakers|trainer|trainers|running\s*shoe|athletic\s*shoe|sport\s*shoe|tennis\s*shoe|canvas\s*shoe)\b/.test(
        t,
      ),
  );
  return pruned.length > 0 ? pruned : normalized;
}

function tightenTypeSeedsForDetection(
  detectionLabel: string,
  categoryMapping: CategoryMapping,
  seeds: string[],
  opts?: { confidence?: number; areaRatio?: number },
): string[] {
  const label = String(detectionLabel || "").toLowerCase();
  const hasLongSleeveCue = /\blong sleeve\b|\bfull sleeve\b/.test(label);
  const category = String(categoryMapping.productCategory || "").toLowerCase();
  const normalized = [...new Set(seeds.map((s) => String(s).toLowerCase().trim()).filter(Boolean))];
  if (normalized.length === 0) return normalized;

  if (category === "tops") {
    const topIntent = parseTopDetectionIntent(detectionLabel);
    if (topIntent.isVestTop) {
      const vestTop = normalized.filter((t) =>
        /\b(vest|vests|waistcoat|waistcoats|gilet|sleeveless top|tank|tank top|camisole|cami)\b/.test(t),
      );
      return vestTop.length > 0 ? vestTop : normalized;
    }
    const isTailoredIntent = hasFormalTailoringCue(detectionLabel);
    if (topIntent.isShortTop) {
      const shortTop = normalized.filter((t) =>
        /\b(tshirt|t-?shirt|tee|tees|shirt|shirts|blouse|blouses|top|tops|tank|camisole|cami|crop top)\b/.test(t) ||
        (/\bpolo(?:s)?\b/.test(t) && hasExplicitPoloCue(detectionLabel)),
      );
      return shortTop.length > 0 ? shortTop : normalized;
    }
    if (isTailoredIntent) {
      const tailoredTop = normalized.filter((t) =>
        /\b(suit|suits|blazer|blazers|dress jacket|sport coat|waistcoat|vest|vests|dress shirt|shirt|shirts|top|tops)\b/.test(
          t,
        ),
      );
      return tailoredTop.length > 0 ? tailoredTop : normalized;
    }
    if (topIntent.isLongTop) {
      const longTop = normalized.filter((t) =>
        /\b(shirt|shirts|blouse|blouses|top|tops|sweater|cardigan|knitwear|hoodie|hoodies|sweatshirt|sweatshirts|pullover|loungewear)\b/.test(t),
      );
      const longTopWithoutSleeveless = longTop.filter(
        (t) => !/\b(tank|camisole|cami|crop top|sleeveless|strapless|halter|tee|t-?shirt|tshirt|polo)\b/.test(t),
      );
      if (hasLongSleeveCue && longTopWithoutSleeveless.length > 0) {
        return longTopWithoutSleeveless;
      }
      return longTop.length > 0 ? longTop : normalized;
    }
  }

  if (category === "bottoms") {
    const bottomIntent = parseBottomDetectionIntent(detectionLabel);
    if (bottomIntent.isTrousersLike) {
      const trouserLike = normalized.filter((t) =>
        /\b(trouser|trousers|pant|pants|chino|chinos|slack|slacks|cargo)\b/.test(t),
      );
      const jeansLike = normalized.filter((t) => /\b(jean|jeans|denim)\b/.test(t));
      const merged = [...new Set([...trouserLike, ...jeansLike])];
      return merged.length > 0 ? merged : normalized;
    }
    if (bottomIntent.isJeansLike) {
      const jeansLike = normalized.filter((t) => /\b(jean|jeans|denim)\b/.test(t));
      const trousersLike = normalized.filter((t) => /\b(trouser|trousers|pant|pants|chino|chinos|slack|slacks|cargo)\b/.test(t));
      const merged = [...new Set([...jeansLike, ...trousersLike])];
      return merged.length > 0 ? merged : normalized;
    }
    if (bottomIntent.isSkirtLike) {
      const skirtLike = normalized.filter((t) => /\b(skirt|skirts)\b/.test(t));
      return skirtLike.length > 0 ? skirtLike : normalized;
    }
    if (bottomIntent.isShortsLike) {
      const shortsLike = normalized.filter((t) =>
        /\b(short|shorts|bermuda|bermudas|cargo short|cargo shorts)\b/.test(t),
      );
      if (shortsLike.length > 0) return shortsLike;
    }
  }

  if (category === "bags") {
    const confidence = Number(opts?.confidence ?? 0);
    const areaRatio = Number(opts?.areaRatio ?? 0);
    const refineEligible = !opts || confidence >= 0.86 || areaRatio >= 0.025;
    const genericBagLike =
      /\b(bag\b|bags\b|bag,\s*wallet|wallet,\s*bag)\b/.test(label) &&
      !/\b(handbag|tote|backpack|crossbody|satchel|clutch|purse)\b/.test(label);
    const bagLike = normalized.filter((t) =>
      /\b(bag|bags|wallet|purse|handbag|handbags|tote|totes|backpack|backpacks|clutch|clutches|crossbody|satchel|satchels)\b/.test(
        t,
      ),
    );
    if (!refineEligible && genericBagLike) {
      const broadBag = bagLike.filter(
        (t) => !/\b(wallet|cardholder|coin\s*purse|pouch|pouches)\b/.test(t),
      );
      return broadBag.length > 0 ? broadBag : bagLike;
    }
    return bagLike.length > 0 ? bagLike : normalized;
  }

  if (category === "footwear") {
    const isGenericShoeLike = isGenericFootwearDetectionLabel(label);
    const isBootLike = /\b(boot|boots|ankle boot|chelsea|combat boot)\b/.test(label);
    const isHeelLike = /\b(heel|heels|pump|pumps|stiletto|stilettos|wedge|wedges|slingback)\b/.test(label);
    const isSandalLike = /\b(sandal|sandals|slide|slides|mule|mules|flip flop|flip-flop)\b/.test(label);
    const strictFallback = strictFootwearSubtypeFallbackTerms(label);

    if (isBootLike) {
      const bootsOnly = normalized.filter((t) => /\b(boot|boots)\b/.test(t));
      return bootsOnly.length > 0 ? bootsOnly : (strictFallback ?? normalized);
    }
    if (isHeelLike) {
      const heelsOnly = normalized.filter((t) => /\b(heel|heels|pump|pumps|stiletto|wedge)\b/.test(t));
      return heelsOnly.length > 0 ? heelsOnly : (strictFallback ?? normalized);
    }
    if (isSandalLike) {
      const sandalsOnly = normalized.filter((t) => /\b(sandal|sandals|slide|slides|mule|mules|flip flop|flip-flop)\b/.test(t));
      return sandalsOnly.length > 0 ? sandalsOnly : (strictFallback ?? normalized);
    }
    if (strictFallback) {
      const strict = normalized.filter((t) => strictFallback.some((fallback) => normalizeLooseText(t) === normalizeLooseText(fallback)));
      return strict.length > 0 ? strict : strictFallback;
    }

    if (isGenericShoeLike) {
      // Generic shoe intent should stay closer to true shoes, not the whole footwear family.
      // This avoids boots/heels/sandals dominating generic shoe searches.
      return genericFootwearTerms(normalized);
    }

    return broadFootwearTerms(normalized);
  }

  if (category === "outerwear") {
    const formalOuterwearLabel = /\b(suit|blazer|sport\s*coat|sportcoat|dress\s*jacket|suit\s*jacket)\b/.test(label);
    const isVestLike = /\b(vest|vests|gilet|gilets|waistcoat|waistcoats)\b/.test(label);
    const isCoatLike = /\b(coat|coats|overcoat|overcoats|parka|parkas|trench|trenches|puffer\s+coats?|down\s+coats?|windbreaker|windbreakers)\b/.test(label);
    const isPlainJacketLike = /\b(jacket|jackets|shirt\s*jacket|shacket|shackets|overshirt|overshirts|bomber|bombers|blouson|blousons|fleece|fleeces|puffer|puffers|down\s+jackets?|quilted\s+jackets?|rain\s+jackets?|shell\s+jackets?|softshell(?:\s+jackets?)?)\b/.test(label) && !formalOuterwearLabel;
    const outerwearLike = normalized.filter((t) => {
      if (/\bdress\b/.test(t) && !/\bdress\s*jacket\b/.test(t)) return false;
      if (/\b(suit|suits|sport\s*coat|sportcoat|dress\s*jacket)\b/.test(t) && !formalOuterwearLabel) {
        return false;
      }
      if (isVestLike) return /\b(vest|vests|gilet|gilets|waistcoat|waistcoats|sleeveless)\b/.test(t);
      if (isCoatLike) return /\b(coat|coats|overcoat|overcoats|parka|parkas|trench|trenches|puffer\s+coats?|down\s+coats?|windbreaker|windbreakers)\b/.test(t);
      if (isPlainJacketLike) return /\b(jacket|jackets|shirt\s*jacket|shacket|shackets|overshirt|overshirts|bomber|bombers|blouson|blousons|fleece|fleeces|puffer|puffers|down\s+jackets?|quilted\s+jackets?|rain\s+jackets?|shell\s+jackets?|softshell(?:\s+jackets?)?)\b/.test(t);
      return /\b(jacket|jackets|coat|coats|overcoat|overcoats|parka|parkas|trench|trenches|windbreaker|windbreakers|vest|vests|gilet|gilets|waistcoat|waistcoats|poncho|anorak|bomber|bombers|blouson|blousons|fleece|fleeces|puffer|puffers|down\s+jackets?|quilted\s+jackets?|rain\s+jackets?|shell\s+jackets?|softshell(?:\s+jackets?)?|blazer|blazers|sport\s*coat|sportcoat|suit\s*jacket|dress\s*jacket|outerwear|outwear)\b/.test(t);
    });
    return outerwearLike.length > 0 ? outerwearLike : normalized;
  }

  if (category === "dresses") {
    const isJumpLike = /\b(jumpsuit|romper|playsuit)\b/.test(label);
    const isGownLike = /\bgown\b/.test(label);
    if (isJumpLike) {
      const jumpLike = normalized.filter((t) => /\b(jumpsuit|jumpsuits|romper|rompers|playsuit|playsuits)\b/.test(t));
      return jumpLike.length > 0 ? jumpLike : normalized;
    }
    const dressLike = normalized.filter((t) => {
      if (/\b(jumpsuit|jumpsuits|romper|rompers|playsuit|playsuits)\b/.test(t)) return false;
      if (/\b(gown|gowns)\b/.test(t) && !isGownLike) return false;
      return /\b(dress|dresses|gown|gowns|one piece|one-piece|sundress|sun dress|slip dress|bodycon|cocktail dress|evening dress|party dress|maxi dress|midi dress|mini dress|frock|kaftan|caftan|abaya|wrap dress|shirt dress|shift dress|a-line dress|smock|babydoll dress|pinafore|chemise|fit and flare)\b/.test(t);
    });
    if (dressLike.length > 0) return dressLike;
  }

  return normalized;
}

const FORMAL_OUTERWEAR_RECOVERY_TYPES = [
  "suit",
  "suits",
  "sport coat",
  "dress jacket",
  "blazer",
  "blazers",
];

// ────────────────────────────────────────────────────────────────────────────
// Outerwear & Suit Signal Path
// ────────────────────────────────────────────────────────────────────────────
// A single function that consolidates every signal we have for an outerwear /
// tailored / suit detection (YOLO label, BLIP caption, contextual formality,
// wedding/tie/black-tie cues, structured-top + tailored-bottom co-detection)
// into one structured decision. The detection loop reads from this signal to
// route recall (filters.category, productTypes, predictedAisles) and rerank
// (detectionProductCategory, priority seed types) in one place — replacing the
// previously scattered hasSuitCaptionCue / recoverFormalOuterwearTypes /
// suitCaptionForTailored / forceSuitCue boolean checks.
// ────────────────────────────────────────────────────────────────────────────

export type OuterwearSuitSubtype =
  | "suit_full"
  | "suit_jacket"
  | "blazer"
  | "jacket"
  | "coat"
  | "vest"
  | "unknown";

export interface OuterwearSuitSignal {
  isOuterwearOrSuit: boolean;
  subtype: OuterwearSuitSubtype;
  formalityScore: number;
  isTailored: boolean;
  isFormal: boolean;
  suitCue: boolean;
  detectionCategoryForSearch: "tailored" | "outerwear";
  filterCategoryAliases: string[];
  predictedAisles: string[];
  prioritySeedTypes: string[];
  signalSources: {
    yoloLabel: string;
    blipSuitCue: boolean;
    blipFormalCue: boolean;
    contextualFormality: number;
    weddingCue: boolean;
    tieCue: boolean;
    structuredTopAndTailoredBottom: boolean;
  };
}

const OUTERWEAR_BASE_TYPES = [
  "jacket",
  "jackets",
  "coat",
  "coats",
  "blazer",
  "blazers",
  "shirt jacket",
  "shacket",
  "shackets",
  "overshirt",
  "overshirts",
  "bomber",
  "bomber jacket",
  "parka",
  "parkas",
  "trench",
  "windbreaker",
  "windbreakers",
  "overcoat",
  "overcoats",
];

const SUIT_FULL_TYPES = [
  "suit",
  "suits",
  "tuxedo",
  "tuxedos",
  "two piece suit",
  "three piece suit",
];

const BLAZER_TYPES = [
  "blazer",
  "blazers",
  "sport coat",
  "sportcoat",
  "suit jacket",
  "dress jacket",
  "tailored jacket",
  "structured jacket",
];

const VEST_TYPES = [
  "vest",
  "vests",
  "waistcoat",
  "waistcoats",
  "gilet",
  "gilets",
];

const COAT_ONLY_TYPES = [
  "coat",
  "coats",
  "overcoat",
  "overcoats",
  "parka",
  "parkas",
  "trench",
  "windbreaker",
  "windbreakers",
  "long coat",
  "wool coat",
  "puffer coat",
  "down coat",
];

const JACKET_ONLY_TYPES = [
  "jacket",
  "jackets",
  "bomber",
  "bomber jacket",
  "blouson",
  "blousons",
  "shirt jacket",
  "shacket",
  "shackets",
  "overshirt",
  "overshirts",
  "leather jacket",
  "denim jacket",
  "fleece",
  "fleece jacket",
  "puffer",
  "puffer jacket",
  "down jacket",
  "quilted jacket",
  "rain jacket",
  "shell jacket",
  "softshell",
  "softshell jacket",
];

/**
 * Extract a unified outerwear/suit signal from all available image-search inputs.
 * Returns `isOuterwearOrSuit: false` when this code path doesn't apply, so callers
 * can keep their normal flow for tops/bottoms/dresses/footwear/etc.
 */
export function inferOuterwearSuitSignal(input: {
  yoloLabel: string;
  detectionRawLabel?: string | null;
  productCategoryFromMapping: string;
  blipCaption: string | null | undefined;
  contextualFormalityScore: number;
}): OuterwearSuitSignal {
  const labelNorm = String(input.yoloLabel ?? "").toLowerCase().trim();
  const rawLabelNorm = String(input.detectionRawLabel ?? "").toLowerCase();
  const captionNorm = String(input.blipCaption ?? "").toLowerCase();
  const productCategory = String(input.productCategoryFromMapping ?? "").toLowerCase().trim();
  const formality = Math.max(0, Math.min(10, Number(input.contextualFormalityScore) || 0));

  // Step 1: gate. Only run for outerwear/tailored category. Everything else short-circuits.
  if (productCategory !== "outerwear" && productCategory !== "tailored") {
    return {
      isOuterwearOrSuit: false,
      subtype: "unknown",
      formalityScore: formality,
      isTailored: false,
      isFormal: false,
      suitCue: false,
      detectionCategoryForSearch: "outerwear",
      filterCategoryAliases: [],
      predictedAisles: [],
      prioritySeedTypes: [],
      signalSources: {
        yoloLabel: labelNorm,
        blipSuitCue: false,
        blipFormalCue: false,
        contextualFormality: formality,
        weddingCue: false,
        tieCue: false,
        structuredTopAndTailoredBottom: false,
      },
    };
  }

  // Step 2: extract individual signals.
  const blipFullSuitCue = /\b(suit|suits|suiting|tuxedo|tuxedos)\b/.test(captionNorm);
  const blipJacketSuitCue = /\b(blazer|sport\s*coat|dress\s*jacket|suit\s*jacket|waistcoat)\b/.test(captionNorm);
  const blipSuitCue = blipFullSuitCue || blipJacketSuitCue;
  const blipFormalCue = /\b(formal|business\s*formal|smart|tailored|elegant)\b/.test(captionNorm);
  const weddingCue = /\b(wedding|black[-\s]?tie|ceremony|bow\s*tie|bowtie)\b/.test(captionNorm);
  const tieCue = /\btie\b/.test(captionNorm);
  // Inferred from contextualFormalityScore: scoreContextualFormalityFromDetections returns
  // 7 for structured-top + tailored-bottom co-detection (8 with shirt-recovery confirming it).
  const structuredTopAndTailoredBottom = formality >= 7 && formality < 9;

  // Step 3: classify subtype. Strongest signal wins.
  // Vest takes priority — a labeled vest detection is unambiguous regardless of formality.
  const isVestLabel = /\b(vest|gilet|waistcoat)\b/.test(labelNorm) &&
    !/\b(sweater|cardigan|hoodie|pullover|jacket|coat|sweatshirt|overshirt)\b/.test(labelNorm);

  const isExplicitSuitLabel = /\b(suit|suits|tuxedo)\b/.test(labelNorm);
  const isExplicitBlazerLabel = /\b(blazer|sport\s*coat|sportcoat|suit\s*jacket|dress\s*jacket|tailored\s*jacket)\b/.test(labelNorm);
  const isExplicitCoatLabel = /\b(coat|coats|parka|trench|windbreaker|overcoat|puffer\s+coat|down\s+coat|long\s+coat|wool\s+coat)\b/.test(labelNorm) &&
    !/\b(sport\s*coat|dress\s*coat)\b/.test(labelNorm);
  const isExplicitJacketLabel = /\b(jacket|jackets|bomber|blouson|fleece|puffer|down\s+jacket|quilted\s+jacket|rain\s+jacket|shell\s+jacket|softshell|shacket|overshirt|shirt\s*jacket)\b/.test(labelNorm) &&
    !isExplicitBlazerLabel;

  // Aggregate suit cue: BLIP caption OR (formality≥8 + outerwear category) OR wedding/black-tie OR
  // (tie + formality≥6) OR structured-top+tailored-bottom + tie/wedding signal.
  const casualOuterwearConflict =
    /\b(hoodie|hoody|sweatshirt|track\s*jacket|tracksuit|windbreaker|rain\s*jacket|shell\s*jacket|softshell|puffer|parka|ski|fleece|blouson|bomber|denim\s*jacket|leather\s*jacket)\b/.test(
      `${labelNorm} ${rawLabelNorm} ${captionNorm}`,
    );
  const structuredTailoredSuitCue =
    structuredTopAndTailoredBottom &&
    productCategory === "outerwear" &&
    !isExplicitCoatLabel &&
    !casualOuterwearConflict &&
    (blipFormalCue || tieCue || weddingCue || blipJacketSuitCue);

  const suitCue =
    blipSuitCue ||
    weddingCue ||
    (tieCue && formality >= 6) ||
    (formality >= 8 && (blipFormalCue || blipJacketSuitCue)) ||
    (structuredTopAndTailoredBottom && (blipFormalCue || tieCue)) ||
    structuredTailoredSuitCue;

  let subtype: OuterwearSuitSubtype;
  if (isVestLabel) {
    subtype = "vest";
  } else if (isExplicitSuitLabel) {
    subtype = "suit_full";
  } else if (isExplicitBlazerLabel) {
    subtype = suitCue ? "suit_jacket" : "blazer";
  } else if (isExplicitCoatLabel) {
    subtype = "coat";
  } else if (suitCue) {
    // Detection said "jacket"/"long sleeve outwear" but cues say suit → treat as suit_jacket.
    subtype = "suit_jacket";
  } else if (isExplicitJacketLabel || /\blong\s*sleeve\s*(?:outwear|outerwear)\b/.test(labelNorm)) {
    subtype = "jacket";
  } else {
    // Outerwear/tailored category but unclassified label → fallback to jacket as safest neutral.
    subtype = "jacket";
  }

  const isTailored = subtype === "suit_full" || subtype === "suit_jacket" || subtype === "blazer" || (subtype === "vest" && (suitCue || blipFormalCue));
  const isFormal = formality >= 7 || suitCue;

  // Step 4: derive routing recommendations.
  // Detection product category for search: tailored when suit-cue, outerwear otherwise.
  const detectionCategoryForSearch: "tailored" | "outerwear" =
    (subtype === "suit_full" || subtype === "suit_jacket" || (subtype === "blazer" && isFormal))
      ? "tailored"
      : "outerwear";

  const filterCategoryAliases: string[] = (() => {
    switch (subtype) {
      case "suit_full":
        return [...SUIT_FULL_TYPES, "tailored", ...BLAZER_TYPES];
      case "suit_jacket":
        return [...BLAZER_TYPES, ...(blipJacketSuitCue || isExplicitBlazerLabel ? SUIT_FULL_TYPES : []), "tailored", "outerwear"];
      case "blazer":
        return [...BLAZER_TYPES, ...(suitCue ? SUIT_FULL_TYPES : []), "outerwear", "tailored"];
      case "vest":
        return [...VEST_TYPES, ...(suitCue ? SUIT_FULL_TYPES : []), "tailored"];
      case "coat":
        return [...COAT_ONLY_TYPES, "outerwear"];
      case "jacket":
        return [...JACKET_ONLY_TYPES, "outerwear", ...(suitCue ? BLAZER_TYPES : [])];
      default:
        return [...OUTERWEAR_BASE_TYPES];
    }
  })();

  const predictedAisles: string[] = (() => {
    if (detectionCategoryForSearch === "tailored") return ["tailored", "outerwear"];
    if (suitCue || isTailored) return ["outerwear", "tailored"];
    return ["outerwear"];
  })();

  const prioritySeedTypes: string[] = (() => {
    switch (subtype) {
      case "suit_full":
        return [...SUIT_FULL_TYPES, ...BLAZER_TYPES];
      case "suit_jacket":
        return [...BLAZER_TYPES, ...(blipJacketSuitCue || isExplicitBlazerLabel ? SUIT_FULL_TYPES : [])];
      case "blazer":
        return [...BLAZER_TYPES, ...(suitCue ? SUIT_FULL_TYPES : [])];
      case "vest":
        return [...VEST_TYPES];
      case "coat":
        return [...COAT_ONLY_TYPES];
      case "jacket":
        return [...JACKET_ONLY_TYPES, ...(suitCue ? BLAZER_TYPES : [])];
      default:
        return [];
    }
  })();

  return {
    isOuterwearOrSuit: true,
    subtype,
    formalityScore: formality,
    isTailored,
    isFormal,
    suitCue,
    detectionCategoryForSearch,
    filterCategoryAliases,
    predictedAisles,
    prioritySeedTypes,
    signalSources: {
      yoloLabel: labelNorm,
      blipSuitCue,
      blipFormalCue,
      contextualFormality: formality,
      weddingCue,
      tieCue,
      structuredTopAndTailoredBottom,
    },
  };
}

const TAILORED_TOP_RECOVERY_TYPES = [
  "suit",
  "suits",
  "blazer",
  "blazers",
  "dress jacket",
  "sport coat",
  "waistcoat",
  "vest",
  "vests",
  "shirt",
  "shirts",
];

function hasFormalTailoringCue(text: string): boolean {
  const s = String(text || "").toLowerCase();
  if (!s) return false;
  return /\b(suit|suits|sport\s*coat|dress\s*jacket|blazer|blazers|tuxedo|tie)\b/.test(s);
}

function recoverFormalOuterwearTypes(
  seeds: string[],
  productCategory: string,
  ...cueTexts: Array<string | null | undefined>
): string[] {
  const category = String(productCategory || "").toLowerCase();
  const normalized = [...new Set(seeds.map((s) => String(s).toLowerCase().trim()).filter(Boolean))];
  if (category !== "outerwear") return normalized;
  if (!cueTexts.some((t) => hasFormalTailoringCue(String(t ?? "")))) return normalized;
  return [...new Set([...FORMAL_OUTERWEAR_RECOVERY_TYPES, ...normalized])];
}

function hasTailoredBottomCue(label: string): boolean {
  const s = normalizeLooseText(label);
  if (!s) return false;
  if (/\b(jean|jeans|denim|short|shorts|legging|leggings|jogger|joggers|cargo|cargo pants)\b/.test(s)) return false;
  return /\b(trouser|trousers|pant|pants|slack|slacks|chino|chinos|dress pants)\b/.test(s);
}

function hasStructuredTopCue(label: string): boolean {
  const s = normalizeLooseText(label);
  if (!s) return false;
  if (/\b(t ?shirt|tee|tank|camisole|cami|hoodie|sweatshirt|sweat shirt|crop top|polo)\b/.test(s)) return false;
  return /\b(long sleeve top|shirt|blouse|overshirt|button down|button-down|outerwear|outwear|jacket|coat|blazer|cardigan|sweater)\b/.test(s);
}

function hasShirtRecoveryCue(rawLabel: string): boolean {
  const s = normalizeLooseText(rawLabel);
  if (!s) return false;
  return /\bcorrected\b/.test(s) && /\bshirt\b/.test(s) && /\brecovery\b/.test(s) && /\b(outwear|outerwear|jacket)\b/.test(s);
}

function inferContextualFormalityFromDetections(detections: Detection[]): number {
  if (!Array.isArray(detections) || detections.length === 0) return 0;

  let hasStrongTailoringCue = false;
  let hasStructuredTop = false;
  let hasTailoredBottom = false;
  let hasShirtRecovery = false;

  for (const detection of detections) {
    const label = String(detection.label || "");
    const rawLabel = String(detection.raw_label || "");
    const joined = `${label} ${rawLabel}`;

    if (hasFormalTailoringCue(joined)) {
      hasStrongTailoringCue = true;
    }
    if (hasStructuredTopCue(label) || hasStructuredTopCue(rawLabel)) {
      hasStructuredTop = true;
    }
    if (hasTailoredBottomCue(label) || hasTailoredBottomCue(rawLabel)) {
      hasTailoredBottom = true;
    }
    if (hasShirtRecoveryCue(rawLabel)) {
      hasShirtRecovery = true;
    }
  }

  if (hasStrongTailoringCue) return 9;
  if (hasStructuredTop && hasTailoredBottom) {
    // Shirt-recovery from outerwear is a strong proxy for missed blazer/suit detection.
    return hasShirtRecovery ? 8 : 7;
  }
  return 0;
}

function recoverTailoredTopTypes(
  seeds: string[],
  productCategory: string,
  detectionLabel: string,
  rawLabel: string | undefined,
  contextualFormalityScore: number,
  fullCaption?: string | null,
): string[] {
  const category = String(productCategory || "").toLowerCase();
  const normalized = [...new Set(seeds.map((s) => String(s).toLowerCase().trim()).filter(Boolean))];
  if (category !== "tops") return normalized;

  const cueText = `${String(detectionLabel || "")} ${String(rawLabel || "")}`;
  const captionText = String(fullCaption ?? "").toLowerCase();
  const hasCaptionSuitCue =
    /\b(suit|suiting|blazer|sport coat|dress jacket|suit jacket|tuxedo|waistcoat|vest)\b/.test(captionText);
  const structuredTopCue = /\b(long sleeve top|short sleeve top|shirt|dress shirt|button down|button-down)\b/i.test(
    String(detectionLabel || ""),
  );
  const hasStrongTailoringSignal = hasFormalTailoringCue(cueText) || hasCaptionSuitCue;
  const shouldRecover =
    contextualFormalityScore >= 9 ||
    (contextualFormalityScore >= 7 && (
      hasStrongTailoringSignal ||
      (hasShirtRecoveryCue(String(rawLabel || "")) && hasCaptionSuitCue) ||
      (structuredTopCue && hasStrongTailoringSignal)
    ));

  if (!shouldRecover) return normalized;
  return [...new Set([...TAILORED_TOP_RECOVERY_TYPES, ...normalized])];
}

function shouldPreserveHardCategoryOnFallback(mapping: CategoryMapping): boolean {
  const category = String(mapping.productCategory || "").toLowerCase();
  return (
    category === "tops" ||
    category === "bottoms" ||
    category === "dresses" ||
    category === "outerwear" ||
    category === "footwear" ||
    category === "bags" ||
    category === "accessories"
  );
}

function fallbackCategoryTermsForDetection(
  detectionLabel: string,
  mapping: CategoryMapping,
): string[] {
  const category = String(mapping.productCategory || "").toLowerCase();
  if (category === "dresses") {
    return getCategorySearchTerms("dresses");
  }
  return hardCategoryTermsForDetection(detectionLabel, mapping);
}

/** IoU threshold for merging same-label detections when `groupByDetection` is false (default 0.5). */
function yoloShopDedupeIouThreshold(): number {
  const raw = Number(process.env.YOLO_SHOP_DEDUPE_IOU_THRESHOLD);
  const n = Number.isFinite(raw) ? raw : 0.5;
  return Math.min(0.95, Math.max(0.05, n));
}

function imageMinFootwearAreaRatio(): number {
  const raw = Number(process.env.SEARCH_IMAGE_MIN_FOOTWEAR_AREA_RATIO ?? "0.0035");
  if (!Number.isFinite(raw)) return 0.0035;
  return Math.max(0, Math.min(1, raw));
}

function imageMinFootwearConfidence(): number {
  const raw = Number(process.env.SEARCH_IMAGE_MIN_FOOTWEAR_CONFIDENCE ?? "0.68");
  if (!Number.isFinite(raw)) return 0.68;
  return Math.max(0, Math.min(1, raw));
}

function imageMinAccessoryAreaRatio(): number {
  const raw = Number(process.env.SEARCH_IMAGE_MIN_ACCESSORY_AREA_RATIO ?? "0.0015");
  if (!Number.isFinite(raw)) return 0.0015;
  return Math.max(0, Math.min(1, raw));
}

function imageMinAccessoryConfidence(): number {
  const raw = Number(process.env.SEARCH_IMAGE_MIN_ACCESSORY_CONFIDENCE ?? "0.54");
  if (!Number.isFinite(raw)) return 0.54;
  return Math.max(0, Math.min(1, raw));
}

function imageMinMaterialConfidenceEnv(): number {
  const raw = Number(process.env.SEARCH_IMAGE_MIN_MATERIAL_CONF ?? "0.58");
  if (!Number.isFinite(raw)) return 0.58;
  return Math.max(0, Math.min(1, raw));
}

function imageMinApparelConfidence(): number {
  const raw = Number(process.env.SEARCH_IMAGE_MIN_APPAREL_CONFIDENCE ?? "0.42");
  if (!Number.isFinite(raw)) return 0.42;
  return Math.max(0, Math.min(1, raw));
}

function imageMinApparelAreaRatio(): number {
  const raw = Number(process.env.SEARCH_IMAGE_MIN_APPAREL_AREA_RATIO ?? "0.015");
  if (!Number.isFinite(raw)) return 0.015;
  return Math.max(0, Math.min(1, raw));
}

function imageMinVestConfidence(): number {
  const raw = Number(process.env.SEARCH_IMAGE_MIN_VEST_CONFIDENCE ?? "0.4");
  if (!Number.isFinite(raw)) return 0.4;
  return Math.max(0, Math.min(1, raw));
}

function shopLookVestRecoveryMinConfidence(): number {
  const raw = Number(process.env.SEARCH_IMAGE_VEST_RECOVERY_MIN_CONFIDENCE ?? "0.48");
  if (!Number.isFinite(raw)) return 0.48;
  return Math.max(0, Math.min(1, raw));
}

/** Use clear detection/type hints as hard type filters (default on for accuracy). */
function imageStrongHintsForceTypeFilterEnv(): boolean {
  const raw = String(process.env.SEARCH_IMAGE_STRONG_HINTS_FORCE_TYPE_FILTER ?? "1").toLowerCase();
  return raw === "1" || raw === "true";
}

function imageStrongHintsTypeConfMin(): number {
  const raw = Number(process.env.SEARCH_IMAGE_STRONG_HINTS_TYPE_CONF_MIN ?? "0.82");
  if (!Number.isFinite(raw)) return 0.82;
  return Math.max(0, Math.min(1, raw));
}

function imageStrongHintsTypeAreaMin(): number {
  const raw = Number(process.env.SEARCH_IMAGE_STRONG_HINTS_TYPE_AREA_MIN ?? "0.07");
  if (!Number.isFinite(raw)) return 0.07;
  return Math.max(0, Math.min(1, raw));
}

function shouldForceTypeFilterForDetection(
  detection: Detection,
  categoryMapping: CategoryMapping,
  typeHints: string[],
): boolean {
  if (!imageStrongHintsForceTypeFilterEnv()) return false;
  if (!Array.isArray(typeHints) || typeHints.length === 0) return false;
  const category = String(categoryMapping.productCategory || "").toLowerCase();
  // Root fix: hard product_types filtering is too brittle for detection-driven retrieval
  // in catalogs with sparse/heterogeneous typing. Keep it only for one-piece/tailored lanes.
  if (category === "accessories" || category === "bags" || category === "footwear" || category === "tops" || category === "bottoms") return false;
  const confOk = (detection.confidence ?? 0) >= imageStrongHintsTypeConfMin();
  const areaOk = (detection.area_ratio ?? 0) >= imageStrongHintsTypeAreaMin();
  return confOk && areaOk;
}

function detectionBoxArea(box: BoundingBox): number {
  return Math.max(0, box.x2 - box.x1) * Math.max(0, box.y2 - box.y1);
}

function intersectionArea(a: BoundingBox, b: BoundingBox): number {
  const x1 = Math.max(a.x1, b.x1);
  const y1 = Math.max(a.y1, b.y1);
  const x2 = Math.min(a.x2, b.x2);
  const y2 = Math.min(a.y2, b.y2);
  const w = Math.max(0, x2 - x1);
  const h = Math.max(0, y2 - y1);
  return w * h;
}

function isBagLikeLabel(label: string): boolean {
  return /\b(bag|wallet|purse|clutch|tote|backpack|crossbody|satchel|handbag)\b/.test(label);
}

function shouldRejectImplausibleBagDetection(detection: Detection, allDetections?: Detection[]): boolean {
  const label = String(detection.label || "").toLowerCase();
  if (!isBagLikeLabel(label)) return false;

  const areaRatio = Number.isFinite(detection.area_ratio) ? detection.area_ratio : 0;
  const confidence = Number.isFinite(detection.confidence) ? detection.confidence : 0;
  const bn = detection.box_normalized;
  if (!bn) return false;

  const widthNorm = Math.max(0, bn.x2 - bn.x1);
  const heightNorm = Math.max(0, bn.y2 - bn.y1);
  const slenderness = heightNorm / Math.max(widthNorm, 1e-6);

  // Very thin/tall, low-confidence "bag" boxes are often straps/body parts.
  if (confidence < 0.66 && areaRatio >= 0.055 && widthNorm <= 0.12 && heightNorm >= 0.5 && slenderness >= 2.75) {
    return true;
  }

  // Additional guard: elongated low-confidence bag boxes are commonly duplicate
  // overlays around a real bag detection (e.g., strap + torso region).
  if (confidence < 0.45 && areaRatio >= 0.05 && widthNorm <= 0.2 && slenderness >= 2.2) {
    return true;
  }

  if (!Array.isArray(allDetections) || allDetections.length <= 1) return false;

  const thisArea = detectionBoxArea(detection.box);
  if (thisArea <= 0) return false;

  // If a tighter, higher-confidence bag-like detection sits mostly inside this one,
  // drop the oversized outer box.
  for (const other of allDetections) {
    if (other === detection) continue;
    const otherLabel = String(other.label || "").toLowerCase();
    if (!isBagLikeLabel(otherLabel)) continue;

    const otherArea = detectionBoxArea(other.box);
    if (otherArea <= 0 || thisArea < otherArea * 2.0) continue;

    const overlap = intersectionArea(detection.box, other.box);
    const containedRatio = overlap / Math.max(1e-6, Math.min(thisArea, otherArea));
    const otherConfidence = Number.isFinite(other.confidence) ? other.confidence : 0;

    if (containedRatio >= 0.74 && otherConfidence >= confidence + 0.05) {
      return true;
    }

    // Also drop tiny inner duplicates (e.g., second box around the lower part of the same bag).
    // This catches the inverse case not covered above where the current box is mostly inside
    // a larger, comparable/higher-confidence bag detection.
    if (
      thisArea <= otherArea * 0.45 &&
      containedRatio >= 0.86 &&
      otherConfidence >= confidence - 0.02
    ) {
      return true;
    }
  }

  return false;
}

function shouldRejectEdgeArtifactDetection(detection: Detection): boolean {
  const mapped = mapDetectionToCategory(detection.label, detection.confidence).productCategory;
  if (mapped !== "tops" && mapped !== "outerwear") return false;

  const confidence = Number.isFinite(detection.confidence) ? detection.confidence : 0;
  const areaRatio = Number.isFinite(detection.area_ratio) ? detection.area_ratio : 0;
  const bn = detection.box_normalized;
  if (!bn) return false;

  const widthNorm = Math.max(0, bn.x2 - bn.x1);
  const touchesEdge = bn.x1 <= 0.03 || bn.x2 >= 0.97;

  // Spurious edge artifacts: tiny, low-confidence side slivers should not become top detections.
  return touchesEdge && widthNorm <= 0.1 && areaRatio <= 0.015 && confidence < 0.45;
}

function shouldKeepDetectionForShopTheLook(detection: Detection, allDetections?: Detection[]): boolean {
  const mapped = mapDetectionToCategory(detection.label, detection.confidence).productCategory;
  const label = String(detection.label || "").toLowerCase();
  const normalizedLabel = label.replace(/[_\s,]+/g, " ").trim();
  const areaRatio = Number.isFinite(detection.area_ratio) ? detection.area_ratio : 0;
  const confidence = Number.isFinite(detection.confidence) ? detection.confidence : 0;
  // Never search this detector class.
  if (
    /\bheadband head covering hair accessory(?:\s*\d+)?\b/.test(normalizedLabel) ||
    /\b(headband|head covering|hair accessory|hairband|headwear)\b/.test(normalizedLabel)
  ) {
    return false;
  }

  if (shouldRejectEdgeArtifactDetection(detection)) {
    return false;
  }

  if (mapped === "tops" || mapped === "bottoms" || mapped === "dresses" || mapped === "outerwear") {
    // Layered scenario: when outerwear is detected alongside a top (inner layer),
    // relax the area threshold for the inner top since it's partially occluded.
    const isInnerLayer = mapped === "tops" && Array.isArray(allDetections) &&
      allDetections.some((d) => {
        const otherCat = mapDetectionToCategory(d.label, d.confidence).productCategory;
        return otherCat === "outerwear" && d !== detection;
      });
    const effectiveAreaMin = isInnerLayer ? imageMinApparelAreaRatio() * 0.4 : imageMinApparelAreaRatio();
    const effectiveConfMin = isInnerLayer ? imageMinApparelConfidence() * 0.7 : imageMinApparelConfidence();
    if (confidence < effectiveConfMin && areaRatio < effectiveAreaMin) {
      const hasLayeredOverlap = Array.isArray(allDetections)
        ? allDetections.some((other) => {
          if (other === detection) return false;
          const otherMapped = mapDetectionToCategory(other.label, other.confidence).productCategory;
          if (otherMapped === mapped) return false;
          return boundingBoxIou(detection.box, other.box) >= 0.32;
        })
        : false;
      if (!hasLayeredOverlap || confidence < effectiveConfMin * 0.6) {
        return false;
      }
    }
    if (/\bvest\b/.test(label) && confidence < imageMinVestConfidence()) {
      return false;
    }
  }

  if (mapped === "accessories" || mapped === "bags") {
    const isHeadAccessory = /\b(headband|head covering|hair accessory|hairband|headwear)\b/.test(label);
    if (shouldRejectImplausibleBagDetection(detection, allDetections)) {
      return false;
    }
    // Head accessories are very noisy at low confidence — keep the gate.
    if (isHeadAccessory && confidence < imageMinAccessoryConfidence()) {
      return false;
    }
    // For bags and non-head accessories, keep if either confidence OR area is reasonable.
    if (
      !isHeadAccessory &&
      areaRatio < imageMinAccessoryAreaRatio() &&
      confidence < imageMinAccessoryConfidence()
    ) {
      return false;
    }
  }
  if (mapped !== "footwear") return true;
  // Tiny, low-confidence footwear boxes are often false positives near image edges.
  if (areaRatio < imageMinFootwearAreaRatio() && confidence < imageMinFootwearConfidence()) {
    return false;
  }
  return true;
}

function accessoryRecoveryConfidenceThreshold(): number {
  const raw = Number(process.env.SEARCH_IMAGE_ACCESSORY_RECOVERY_CONFIDENCE ?? "0.15");
  if (!Number.isFinite(raw)) return 0.15;
  return Math.max(0.05, Math.min(0.6, raw));
}

function accessoryRecoveryAreaRatioThreshold(): number {
  const raw = Number(process.env.SEARCH_IMAGE_ACCESSORY_RECOVERY_AREA_RATIO ?? "0.0006");
  if (!Number.isFinite(raw)) return 0.0006;
  return Math.max(0.0001, Math.min(0.02, raw));
}

function shouldKeepAccessoryRecoveryDetection(detection: Detection): boolean {
  const mapped = mapDetectionToCategory(detection.label, detection.confidence).productCategory;
  if (mapped !== "bags" && mapped !== "accessories") return false;
  const labelNorm = String(detection.label || "").toLowerCase().replace(/[_\s,]+/g, " ").trim();
  if (
    /\bheadband head covering hair accessory(?:\s*\d+)?\b/.test(labelNorm) ||
    /\b(headband|head covering|hair accessory|hairband|headwear)\b/.test(labelNorm)
  ) return false;

  if (shouldRejectImplausibleBagDetection(detection)) return false;

  const areaRatio = Number.isFinite(detection.area_ratio) ? detection.area_ratio : 0;
  const confidence = Number.isFinite(detection.confidence) ? detection.confidence : 0;
  const isBag = mapped === "bags";
  const isHeadAccessory = /\b(headband|head covering|hair accessory|hairband|headwear)\b/.test(
    String(detection.label || "").toLowerCase(),
  );

  if (isBag) {
    return confidence >= accessoryRecoveryConfidenceThreshold() || areaRatio >= accessoryRecoveryAreaRatioThreshold();
  }

  if (isHeadAccessory) {
    return confidence >= accessoryRecoveryConfidenceThreshold() && areaRatio >= accessoryRecoveryAreaRatioThreshold() * 0.75;
  }

  return confidence >= accessoryRecoveryConfidenceThreshold() || areaRatio >= accessoryRecoveryAreaRatioThreshold() * 1.35;
}

function isMappedBagDetection(detection: Detection): boolean {
  return mapDetectionToCategory(detection.label, detection.confidence).productCategory === "bags";
}

function imageEnableGeometricDressLengthEnv(): boolean {
  const raw = String(process.env.SEARCH_IMAGE_ENABLE_GEOMETRIC_DRESS_LENGTH ?? "1").toLowerCase();
  return raw === "1" || raw === "true";
}

function shouldForceHardCategoryForDetection(
  detection: Detection,
  categoryMapping: CategoryMapping,
): boolean {
  const confidence = Number.isFinite(detection.confidence) ? detection.confidence : 0;
  const areaRatio = Number.isFinite(detection.area_ratio) ? detection.area_ratio : 0;
  const category = String(categoryMapping.productCategory || "").toLowerCase();

  // Root fix: hard category at retrieval stage collapses recall when catalog category
  // metadata is noisy/inconsistent. Keep retrieval broad for most categories and rely on
  // post-retrieval category guards + type compliance to enforce precision.
  if (
    category === "tops" ||
    category === "bottoms" ||
    category === "footwear" ||
    category === "bags" ||
    category === "accessories"
  ) {
    return false;
  }
  // Keep hard category only for one-piece/formal outer layers where cross-family drift is highest.
  if (category === "dresses" || category === "outerwear") {
    return confidence >= 0.84 && areaRatio >= 0.01;
  }

  return false;
}

function summarizeDetectionsByLabel(detections: Detection[]): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const detection of detections) {
    const key = String(detection.label || "").trim();
    if (!key) continue;
    summary[key] = (summary[key] || 0) + 1;
  }
  return summary;
}

/**
 * Deduplicate detections by mapped CATEGORY while preserving distinct multi-item cases.
 *
 * Keeping only one detection per category can suppress valid outfit recalls (e.g. two tops
 * or layered bottoms regions), so we keep multiple distinct detections for core apparel.
 */
function dedupeDetectionsByCategoryHighestConfidence(detections: Detection[]): Detection[] {
  if (!detections || detections.length === 0) return [];

  // Group detections by mapped category
  const categoryGroups = new Map<string, Detection[]>();

  for (const detection of detections) {
    const mapping = mapDetectionToCategory(detection.label, detection.confidence);
    const category = mapping.productCategory;

    if (!categoryGroups.has(category)) {
      categoryGroups.set(category, []);
    }
    categoryGroups.get(category)!.push(detection);
  }

  const shouldAllowMultiPerCategory = (category: string): boolean =>
    category === "tops" || category === "bottoms" || category === "dresses";

  const maxKeepForCategory = (category: string): number => {
    if (category === "tops") {
      const raw = Number(process.env.SEARCH_IMAGE_TOPS_MAX_DETECTIONS_KEEP ?? "2");
      if (Number.isFinite(raw)) return Math.max(2, Math.min(5, Math.floor(raw)));
      return 2;
    }
    if (category === "bottoms") return 2;
    if (category === "dresses") return 2;
    return 1;
  };

  const isDistinctDetection = (kept: Detection[], candidate: Detection, category: string): boolean => {
    // Tops often have multiple layered/overlapping garments (jacket over shirt, cardigan over tee).
    // Use a tighter IoU threshold for tops so overlapping-but-distinct garments are kept.
    const iouThreshold = category === "tops" ? 0.35 : 0.42;
    for (const existing of kept) {
      const iou = boundingBoxIou(existing.box, candidate.box);
      if (iou >= iouThreshold) return false;
    }
    return true;
  };

  // For each category, keep strongest distinct detections.
  const result: Detection[] = [];

  for (const [category, categoryDetections] of categoryGroups) {
    // Sort by confidence descending.
    const sorted = [...categoryDetections].sort((a, b) => {
      const confA = Number.isFinite(a.confidence) ? Number(a.confidence) : 0;
      const confB = Number.isFinite(b.confidence) ? Number(b.confidence) : 0;
      return confB - confA;
    });

    if (sorted.length > 0) {
      const keepLimit = maxKeepForCategory(category);
      const kept: Detection[] = [];
      for (const candidate of sorted) {
        if (kept.length >= keepLimit) break;
        if (!shouldAllowMultiPerCategory(category)) {
          kept.push(candidate);
          break;
        }
        if (isDistinctDetection(kept, candidate, category)) {
          kept.push(candidate);
        }
      }

      // Safety fallback: keep at least the strongest one.
      if (kept.length === 0) kept.push(sorted[0]);

      const skipped = sorted.filter((d) => !kept.includes(d));

      if (skipped.length > 0) {
        console.log(
          `[dedupe-by-category] category="${category}" kept=${kept.length}/${sorted.length} skipped=${skipped.length}`,
        );
      }

      result.push(...kept);
    }
  }

  return suppressCrossCategoryDuplicateLayerDetections(result);
}

function suppressCrossCategoryDuplicateLayerDetections(detections: Detection[]): Detection[] {
  if (!Array.isArray(detections) || detections.length <= 1) return detections;

  const shouldDrop = new Set<Detection>();
  for (const candidate of detections) {
    const candidateCategory = mapDetectionToCategory(candidate.label, candidate.confidence).productCategory;
    if (candidateCategory !== "tops") continue;

    const candidateLabel = normalizeLooseText(candidate.label);
    const candidateConf = Number.isFinite(candidate.confidence) ? Number(candidate.confidence) : 0;
    const candidateArea = detectionBoxArea(candidate.box);
    if (candidateArea <= 0 || candidateConf >= 0.55) continue;

    for (const other of detections) {
      if (other === candidate) continue;
      const otherCategory = mapDetectionToCategory(other.label, other.confidence).productCategory;
      const otherLabel = normalizeLooseText(other.label);
      if (otherCategory !== "outerwear" || !/\b(vest|gilet|waistcoat)\b/.test(otherLabel)) continue;

      const otherConf = Number.isFinite(other.confidence) ? Number(other.confidence) : 0;
      if (otherConf < candidateConf + 0.05) continue;

      const otherArea = detectionBoxArea(other.box);
      if (otherArea <= 0) continue;

      const overlap = intersectionArea(candidate.box, other.box);
      const containment = overlap / Math.max(1e-6, Math.min(candidateArea, otherArea));
      const iou = boundingBoxIou(candidate.box, other.box);
      const isGenericTopDuplicate =
        /\b(long sleeve top|short sleeve top|top|shirt|blouse)\b/.test(candidateLabel) &&
        (containment >= 0.86 || iou >= 0.72);
      if (isGenericTopDuplicate) {
        shouldDrop.add(candidate);
        break;
      }
    }
  }

  if (shouldDrop.size === 0) return detections;
  const kept = detections.filter((d) => !shouldDrop.has(d));
  console.log(
    `[dedupe-cross-category] kept=${kept.length}/${detections.length} dropped=${shouldDrop.size}`,
  );
  return kept;
}

function imagePrimaryDetectionBoost(): number {
  const raw = Number(process.env.SEARCH_IMAGE_PRIMARY_GROUP_BOOST ?? "1.2");
  if (!Number.isFinite(raw)) return 1.2;
  return Math.max(1, Math.min(2, raw));
}

function imageSecondaryDetectionWeight(): number {
  const raw = Number(process.env.SEARCH_IMAGE_SECONDARY_GROUP_WEIGHT ?? "0.6");
  if (!Number.isFinite(raw)) return 0.6;
  return Math.max(0.2, Math.min(1, raw));
}

function imageCrossGroupDedupeEnabled(): boolean {
  const raw = String(process.env.SEARCH_IMAGE_CROSS_GROUP_DEDUPE ?? "1").toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off" && raw !== "no";
}

/** Keep per-detection results category-safe even when fallback paths relax OpenSearch filters. */
function imageDetectionCategoryGuardEnabled(): boolean {
  const raw = String(process.env.SEARCH_IMAGE_DETECTION_CATEGORY_GUARD ?? "0").toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off" && raw !== "no";
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeLooseText(v: unknown): string {
  return String(v ?? "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function detectionIoU(
  a: { x1: number; y1: number; x2: number; y2: number },
  b: { x1: number; y1: number; x2: number; y2: number },
): number {
  const x1 = Math.max(a.x1, b.x1);
  const y1 = Math.max(a.y1, b.y1);
  const x2 = Math.min(a.x2, b.x2);
  const y2 = Math.min(a.y2, b.y2);
  const iw = Math.max(0, x2 - x1);
  const ih = Math.max(0, y2 - y1);
  const inter = iw * ih;
  if (inter <= 0) return 0;
  const areaA = Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1);
  const areaB = Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
  const denom = areaA + areaB - inter;
  if (denom <= 0) return 0;
  return inter / denom;
}
function dedupeOverlappingDetections<T extends { label: string; confidence: number; box: { x1: number; y1: number; x2: number; y2: number } }>(
  detections: T[],
  iouThreshold = 0.72,
): T[] {
  if (!Array.isArray(detections) || detections.length <= 1) return detections;
  const sorted = [...detections].sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0));
  const kept: T[] = [];
  for (const det of sorted) {
    const normLabel = normalizeLooseText(det.label);
    const duplicate = kept.some((k) => {
      if (normalizeLooseText(k.label) !== normLabel) return false;
      return detectionIoU(det.box, k.box) >= iouThreshold;
    });
    if (!duplicate) kept.push(det);
  }
  return kept;
}

function textHasWholePhrase(haystack: string, phrase: string): boolean {
  if (!haystack || !phrase) return false;
  const q = normalizeLooseText(phrase);
  if (!q) return false;
  const parts = q.split(" ").filter(Boolean).map(escapeRegex);
  if (parts.length === 0) return false;
  const pattern = `(?:^|\\s)${parts.join("\\s+")}(?:$|\\s)`;
  return new RegExp(pattern, "i").test(haystack);
}

function inferSleeveIntentFromDetectionLabel(
  detectionLabel: string,
): "short" | "long" | "sleeveless" | null {
  const label = normalizeLooseText(detectionLabel);
  if (!label) return null;
  if (/\b(sleeveless|tank|camisole|cami|vest top|strapless|halter|sling|sling dress|vest dress|gilet|waistcoat)\b/.test(label)) {
    return "sleeveless";
  }
  // Standalone "vest" label in fashion = waistcoat/puffer vest (definitionally sleeveless).
  // Only match when not paired with long-sleeve garment words (e.g. "vest cardigan" shouldn't override).
  if (
    /\bvest\b/.test(label) &&
    !/\b(sweater|cardigan|hoodie|pullover|jacket|coat|sweatshirt|overshirt)\b/.test(label)
  ) {
    return "sleeveless";
  }
  if (/\bhalf sleeve\b|\b3\/?4 sleeve\b/.test(label)) return "short";
  if (/\bshort sleeve\b/.test(label)) return "short";
  if (/\blong sleeve\b/.test(label)) return "long";
  if (/\b(tshirt|t shirt|polo|crop top)\b/.test(label)) return "short";
  if (/\b(sweater|cardigan|hoodie|sweatshirt|pullover|jumper)\b/.test(label)) return "long";
  return null;
}

function inferSleeveFromProductText(
  haystack: string,
): "short" | "long" | "sleeveless" | null {
  const txt = normalizeLooseText(haystack);
  if (!txt) return null;

  const hasSleeveless = /\b(sleeveless|tank|camisole|cami|strapless|halter|strap top|spaghetti strap|thin strap|strappy)\b/.test(txt);
  const hasShort = /\b(short sleeves?|short sleeved|half sleeves?|half-sleeve|3\/?4 sleeves?|ss)\b/.test(txt);
  const hasLong = /\b(long sleeves?|long sleeved|full sleeves?|full-sleeve|ls)\b/.test(txt);

  if (hasSleeveless && !hasShort && !hasLong) return "sleeveless";
  if (hasShort && !hasLong) return "short";
  if (hasLong && !hasShort) return "long";
  return null;
}

function isSleeveContradiction(
  desired: "short" | "long" | "sleeveless" | null,
  observed: "short" | "long" | "sleeveless" | null,
): boolean {
  if (!desired || !observed) return false;
  return desired !== observed;
}

function shouldUseStrictDetectionCategoryGuard(productCategory: string): boolean {
  const c = String(productCategory || "").toLowerCase();
  return (
    c === "tops" ||
    c === "bottoms" ||
    c === "dresses" ||
    c === "outerwear" ||
    c === "footwear" ||
    c === "bags" ||
    c === "accessories"
  );
}

function isApparelFamilyCategory(productCategory: string): boolean {
  const c = String(productCategory || "").toLowerCase();
  return c === "tops" || c === "bottoms" || c === "dresses" || c === "outerwear" || c === "tailored";
}

function isAccessoryLikeCategory(productCategory: string): boolean {
  const c = String(productCategory || "").toLowerCase();
  return c === "bags" || c === "accessories";
}

function normalizeBinaryGender(gender: string | undefined): "men" | "women" | null {
  const g = String(gender ?? "").toLowerCase();
  if (/\b(men|mens|man|male|boy|boys)\b/.test(g)) return "men";
  if (/\b(women|womens|woman|female|lady|ladies|girl|girls)\b/.test(g)) return "women";
  return null;
}

function applyFullImageFallbackGuard(
  products: ProductResult[],
  options: {
    caption?: string | null;
    queryGender?: string;
  },
): ProductResult[] {
  const captionText = normalizeLooseText(options.caption ?? "");
  const queryGenderNorm = normalizeBinaryGender(options.queryGender);
  const outerwearRequested = /\b(jacket|coat|blazer|outerwear|outwear|parka|trench|puffer|blouson|fleece|down\s+jacket|quilted\s+jacket|rain\s+jacket|shell\s+jacket|softshell|windbreaker)\b/.test(
    captionText,
  );

  const keepByCoreRules = (row: ProductResult, allowOuterwear: boolean): boolean => {
    const categoryText = normalizeLooseText((row as any).category);
    const categoryCanonicalText = normalizeLooseText((row as any).category_canonical);
    const titleText = normalizeLooseText((row as any).title);
    const descriptionText = normalizeLooseText((row as any).description);
    const productUrlText = normalizeLooseText((row as any).product_url);
    const parentProductUrlText = normalizeLooseText((row as any).parent_product_url);
    const productTypeRaw = (row as any).product_types;
    const productTypeText = Array.isArray(productTypeRaw)
      ? normalizeLooseText(productTypeRaw.join(" "))
      : normalizeLooseText(productTypeRaw);
    const haystack = [
      categoryText,
      categoryCanonicalText,
      productTypeText,
      titleText,
      descriptionText,
      productUrlText,
      parentProductUrlText,
    ]
      .filter(Boolean)
      .join(" ");

    if (!haystack) return false;

    const macro = mapDetectionToCategory(
      String((row as any).category_canonical ?? (row as any).category ?? ""),
      1,
    ).productCategory;
    const isApparelMacro =
      macro === "tops" ||
      macro === "bottoms" ||
      macro === "dresses" ||
      macro === "outerwear" ||
      macro === "footwear" ||
      macro === "bags" ||
      macro === "accessories";
    const hasApparelCue =
      /\b(top|tops|shirt|shirts|blouse|blouses|tee|tees|tshirt|sweater|hoodie|sweatshirt|pullover|jumper|cardigan|vest|pant|pants|trouser|trousers|jean|jeans|chino|chinos|short|shorts|skirt|skirts|dress|dresses|jacket|jackets|coat|coats|blazer|blazers|shoe|shoes|sneaker|sneakers|loafer|loafers|boot|boots|oxford|derby|sandal|sandals|bag|bags|wallet|purse|belt|watch|scarf)\b/.test(
        haystack,
      );
    if (!isApparelMacro && !hasApparelCue) return false;

    if (
      /\b(cream|serum|lotion|cleanser|moisturizer|cosmetic|makeup|candle|candles|home decor|pot|pots|plant|plants)\b/.test(
        haystack,
      )
    ) {
      return false;
    }

    if (!allowOuterwear) {
      if (macro === "outerwear") return false;
      if (/\b(jacket|jackets|coat|coats|blazer|blazers|outerwear|outwear|parka|trench|puffer|blouson|fleece|down\s+jacket|quilted\s+jacket|rain\s+jacket|shell\s+jacket|softshell|windbreaker)\b/.test(haystack)) {
        return false;
      }
    }

    if (queryGenderNorm === "men" && /\b(women|womens|woman|female|lady|ladies|girl|girls)\b/.test(haystack)) {
      return false;
    }
    if (queryGenderNorm === "women" && /\b(men|mens|man|male|boy|boys)\b/.test(haystack)) {
      return false;
    }

    return true;
  };

  const strict = products.filter((row) => keepByCoreRules(row, outerwearRequested));
  if (strict.length > 0) return strict;

  // If strict mode over-filters, keep a safer relaxed subset instead of returning random catalog items.
  return products.filter((row) => keepByCoreRules(row, true));
}

function isFeminineFootwearCue(text: string): boolean {
  return /\b(heel|heels|high heel|stiletto|stilettos|pump|pumps|kitten heel|kitten heels|mule|mules|slingback|slingbacks|mary jane|mary janes|ballet flat|ballet flats|wedge|wedges)\b/.test(
    text,
  );
}

function hasExplicitWomenCue(text: string): boolean {
  return /\b(women|womens|woman|female|lady|ladies|girl|girls)\b/.test(text);
}

function hasExplicitMenCue(text: string): boolean {
  return /\b(men|mens|man|male|gent|gents|boy|boys)\b/.test(text);
}

function isTailoredTopDetectionIntent(
  detectionLabel: string,
  rawLabel?: string,
  minFormality?: number,
): boolean {
  const cueText = `${String(detectionLabel || "")} ${String(rawLabel || "")}`.toLowerCase();
  const formalScore = Number(minFormality ?? 0);
  if (hasFormalTailoringCue(cueText)) return true;
  if (formalScore >= 8 && /\b(long sleeve top|shirt|outerwear|outwear|jacket|blazer|sport coat|dress jacket)\b/.test(cueText)) {
    return true;
  }
  return false;
}

function hasTailoredTopProductCue(text: string): boolean {
  return /\b(suit|suits|blazer|blazers|sport coat|dress jacket|suit jacket|waistcoat|waistcoats|vest|vests|dress shirt|button down|button-down)\b/.test(
    text,
  );
}

function hasTopCasualConflictCue(text: string): boolean {
  return /\b(hoodie|hooded|sweatshirt|sweat shirt|pullover|track top|athletic|sportswear|gym|workout|training)\b/.test(
    text,
  );
}

function applyDetectionCategoryGuard(
  products: ProductResult[],
  detectionLabel: string,
  categoryMapping: CategoryMapping,
  queryGender?: string,
): ProductResult[] {
  if (!Array.isArray(products) || products.length === 0) return products;
  const guardEnabled = imageDetectionCategoryGuardEnabled();
  const queryFamily = String(categoryMapping.productCategory || "").toLowerCase().trim();
  const strictTerms = hardCategoryTermsForDetection(detectionLabel, categoryMapping);
  const fallbackTerms = getCategorySearchTerms(categoryMapping.productCategory);
  const allowedTerms = [...new Set((strictTerms.length > 0 ? strictTerms : fallbackTerms).map((t) => normalizeLooseText(t)).filter(Boolean))];
  const desiredSleeveIntent = inferSleeveIntentFromDetectionLabel(detectionLabel);
  const queryGenderNorm = normalizeBinaryGender(queryGender);
  const hardBlockFamilies = new Set(["shoes", "footwear", "bags", "accessories", "beauty", "home"]);
  const garbageFamilyRe = /\b(beauty|cosmetic|skincare|lotion|serum|makeup|perfume|fragrance|candle|home|decor|furniture|lamp|table|chair)\b/;

  const guarded = products.filter((p) => {
    const categoryText = normalizeLooseText((p as any).category);
    const categoryCanonicalText = normalizeLooseText((p as any).category_canonical);
    const titleText = normalizeLooseText((p as any).title);
    const descriptionText = normalizeLooseText((p as any).description);
    const attrSleeveText = normalizeLooseText((p as any).attr_sleeve);
    const productUrlText = normalizeLooseText((p as any).product_url);
    const parentProductUrlText = normalizeLooseText((p as any).parent_product_url);
    const productTypeRaw = (p as any).product_types;
    const productTypeText = Array.isArray(productTypeRaw)
      ? normalizeLooseText(productTypeRaw.join(" "))
      : normalizeLooseText(productTypeRaw);
    const haystack = [
      categoryText,
      categoryCanonicalText,
      productTypeText,
      titleText,
      descriptionText,
      attrSleeveText,
      productUrlText,
      parentProductUrlText,
    ]
      .filter(Boolean)
      .join(" ");

    // For bags/accessories we fail closed when metadata is missing to avoid
    // leaking generic apparel into strict accessory retrieval flows.
    if (!haystack) {
      // Fail closed for strict small-item categories where weak metadata causes frequent drift.
      if (categoryMapping.productCategory === "footwear") return false;
      return !isAccessoryLikeCategory(categoryMapping.productCategory);
    }

    const allowByTerm = allowedTerms.some((term) => textHasWholePhrase(haystack, term));
    if (!allowByTerm) {
      const vestLikeOuterwearDetection =
        (categoryMapping.productCategory === "outerwear" || categoryMapping.productCategory === "tailored") &&
        /\b(vest|vests|gilet|gilets|waistcoat|waistcoats)\b/.test(normalizeLooseText(detectionLabel));
      if (vestLikeOuterwearDetection) {
        return false;
      }
      // Apparel detections are sometimes under-described in catalog metadata
      // (for example, a true dress can be indexed with a generic fashion title).
      // If the strict term gate would zero the result set, rescue only candidates
      // that do not contain an explicit contradiction for the detected family.
      if (isApparelFamilyCategory(categoryMapping.productCategory)) {
        const contradictsApparelFamily =
          categoryMapping.productCategory === "dresses"
            ? /\b(top|tops|shirt|shirts|blouse|blouses|pant|pants|trouser|trousers|jean|jeans|shorts?|skirt|skirts|jacket|jackets|coat|coats|blazer|blazers|shoe|shoes|sneaker|sneakers|boot|boots|sandal|sandals|heel|heels|bag|bags|wallet|purse|hat|hats|cap|caps)\b/.test(
              haystack,
            )
            : categoryMapping.productCategory === "tops"
              ? /\b(dress|dresses|gown|gowns|pant|pants|trouser|trousers|jean|jeans|shorts?|skirt|skirts|shoe|shoes|boot|boots|coat|coats|outerwear|outwear|parka|parkas|trench|windbreaker|windbreakers|bomber)\b/.test(
                haystack,
              )
              : categoryMapping.productCategory === "bottoms"
                ? /\b(dress|dresses|gown|gowns|top|tops|shirt|shirts|blouse|blouses|jacket|jackets|shoe|shoes|boot|boots)\b/.test(
                  haystack,
                )
                : categoryMapping.productCategory === "tailored"
                  // For tailored (suits/blazers): only contradiction is wrong-category items
                  // (dresses, bottoms-only, footwear, bags). Tops/jackets/coats are partially
                  // overlapping and can carry suit-jacket-like products — don't contradict.
                  ? /\b(dress|dresses|gown|gowns|skirt|skirts|shoe|shoes|sneaker|sneakers|boot|boots|sandal|sandals|heel|heels|bag|bags|wallet|purse)\b/.test(
                    haystack,
                  )
                  : /\b(dress|dresses|gown|gowns|top|tops|shirt|shirts|pant|pants|trouser|trousers|skirt|skirts|shoe|shoes|boot|boots)\b/.test(
                    haystack,
                  );
        if (!contradictsApparelFamily) {
          return true;
        }
      }
      return false;
    }

    if (categoryMapping.productCategory === "footwear") {
      const detectionNorm = normalizeLooseText(detectionLabel);
      const wantsHeels = /\b(heel|heels|high heel|stiletto|stilettos|pump|pumps|kitten heel|wedge|wedges|slingback|slingbacks)\b/.test(
        detectionNorm,
      );
      const wantsSandalsOrFlats = /\b(sandal|sandals|slide|slides|mule|mules|flip flop|flip flops|flat|flats|ballet)\b/.test(
        detectionNorm,
      );
      const productIsHeelLed = /\b(heel|heels|high heel|stiletto|stilettos|pump|pumps|kitten heel|wedge|wedges)\b/.test(
        haystack,
      );
      if (wantsSandalsOrFlats && !wantsHeels && productIsHeelLed) {
        return false;
      }
    }

    // Gender-aware footwear subtype safety:
    // generic "shoe" detections should not surface clearly feminine footwear
    // when query audience is men.
    if (categoryMapping.productCategory === "footwear" && queryGenderNorm === "men") {
      if (hasExplicitWomenCue(haystack)) {
        return false;
      }
      if (isFeminineFootwearCue(haystack)) {
        return false;
      }
    }

    // Sleeve contradiction guard: when detection is explicitly sleeve-typed,
    // reject products that explicitly indicate a conflicting sleeve type.
    if (categoryMapping.productCategory === "tops" || categoryMapping.productCategory === "dresses") {
      const observedSleeve = inferSleeveFromProductText(haystack);
      if (isSleeveContradiction(desiredSleeveIntent, observedSleeve)) {
        return false;
      }
    }

    // Guard against broad lexical collisions (e.g. "denim jacket" inside trouser flow).
    const productCategoryMacro = mapDetectionToCategory(String((p as any).category ?? ""), 1).productCategory;
    if (categoryMapping.productCategory === "footwear") {
      // Hard safety: footwear detections should not return outerwear/tops/bottoms even on lexical overlap.
      if (productCategoryMacro && productCategoryMacro !== "footwear") {
        return false;
      }
    }
    if (categoryMapping.productCategory === "bottoms") {
      const productBottomCue = isBottomCatalogCue(haystack);
      if (productCategoryMacro === "outerwear" || /\b(jacket|coat|blazer|outerwear)\b/.test(haystack)) {
        return false;
      }
      if (!productBottomCue && /\b(top|tops|shirt|shirts|blouse|blouses|dress|dresses|gown|gowns)\b/.test(haystack)) {
        return false;
      }
      // Keep bottoms audience-safe to prevent cross-gender leakage when query audience is known.
      if (queryGenderNorm === "men" && hasExplicitWomenCue(haystack)) return false;
      if (queryGenderNorm === "women" && hasExplicitMenCue(haystack)) return false;
    }
    if (categoryMapping.productCategory === "tops") {
      const detectionLabelNorm = String(detectionLabel).toLowerCase();
      const topIntent = parseTopDetectionIntent(detectionLabelNorm);
      const detectionRequestsOuterwear = topIntent.requestsOuterwear;
      const formalTailoredDetection = hasFormalTailoringCue(detectionLabelNorm);
      const productMentionsOuterwear =
        /\b(jacket|jackets|coat|coats|blazer|blazers|outerwear|outwear|parka|parkas|trench|windbreaker|windbreakers|bomber|sport coat|dress jacket)\b/.test(
          haystack,
        );
      const productMentionsTailoredOuterwear =
        /\b(blazer|blazers|sport coat|dress jacket|suit jacket|waistcoat|waistcoats|vest|vests|tuxedo)\b/.test(
          haystack,
        );
      const productTopCue = isTopCatalogCue(haystack);
      if (
        !detectionRequestsOuterwear &&
        !formalTailoredDetection &&
        !productMentionsTailoredOuterwear &&
        (productCategoryMacro === "outerwear"
          ? !productTopCue
          : productMentionsOuterwear && !productTopCue)
      ) {
        return false;
      }
      // Keep tops audience-safe to prevent cross-gender leakage when query audience is known.
      if (queryGenderNorm === "men" && hasExplicitWomenCue(haystack)) return false;
      if (queryGenderNorm === "women" && hasExplicitMenCue(haystack)) return false;
    }
    if (categoryMapping.productCategory === "bags") {
      if (/\b(belt|belts|scarf|scarves|hat|hats|cap|caps|jewelry|bracelet|necklace|earrings)\b/.test(haystack)) {
        return false;
      }
      // Keep bag retrieval audience-safe as well. Many bag catalogs encode audience
      // only in product URLs (e.g. ".../womens-..."), so rely on the full haystack.
      if (queryGenderNorm === "men" && hasExplicitWomenCue(haystack)) return false;
      if (queryGenderNorm === "women" && hasExplicitMenCue(haystack)) return false;
    }

    return true;
  });

  const categoryNorm = String(categoryMapping.productCategory ?? "").toLowerCase().trim();
  const isShortTopIntent =
    categoryNorm === "tops" && parseTopDetectionIntent(detectionLabel).isShortTop;
  // Keep sparse short-sleeve top pools on the main path: generic catalog shirts may
  // lack exact tee/top terms, but are still safe when they have no family contradiction.
  const shouldTopFailOpen =
    categoryNorm === "tops" &&
    products.length >= 3 &&
    (
      guarded.length < Math.max(1, Math.floor(products.length * 0.28)) ||
      (
        isShortTopIntent &&
        products.length <= 8 &&
        guarded.length < products.length &&
        guarded.length < 4
      )
    );

  if (!shouldTopFailOpen) {
    return guarded;
  }

  const contradictionOnly = products.filter((p) => {
    const haystack = [
      (p as any)?.category,
      (p as any)?.category_canonical,
      (p as any)?.title,
      (p as any)?.description,
      (p as any)?.attr_sleeve,
      (p as any)?.product_url,
      (p as any)?.parent_product_url,
      Array.isArray((p as any)?.product_types)
        ? (p as any).product_types.join(" ")
        : (p as any)?.product_types,
    ]
      .filter((x) => x != null)
      .map((x) => String(x).toLowerCase())
      .join(" ");

    if (!haystack) return false;
    if (/\b(dress|dresses|gown|gowns|pant|pants|trouser|trousers|jean|jeans|shorts?|skirt|skirts|shoe|shoes|boot|boots)\b/.test(haystack)) {
      return false;
    }
    if (/\b(coat|coats|outerwear|outwear|parka|parkas|trench|windbreaker|windbreakers|bomber)\b/.test(haystack)) {
      return false;
    }
    if (queryGenderNorm === "men" && hasExplicitWomenCue(haystack)) {
      return false;
    }
    if (queryGenderNorm === "women" && hasExplicitMenCue(haystack)) {
      return false;
    }
    const observedSleeve = inferSleeveFromProductText(haystack);
    if (isSleeveContradiction(desiredSleeveIntent, observedSleeve)) {
      return false;
    }
    return true;
  });

  if (contradictionOnly.length > guarded.length) {
    console.log(
      `[category-guard-top-failopen] detection="${detectionLabel}" recovered ${guarded.length} -> ${contradictionOnly.length}`,
    );
    return contradictionOnly;
  }

  return guarded;
}

function applySleeveIntentGuard(params: {
  products: ProductResult[];
  detectionLabel: string;
  categoryMapping: CategoryMapping;
}): ProductResult[] {
  const products = Array.isArray(params.products) ? params.products : [];
  if (products.length === 0) return products;

  const category = String(params.categoryMapping.productCategory ?? "").toLowerCase();
  if (category !== "tops" && category !== "dresses" && category !== "outerwear") {
    return products;
  }

  const desiredSleeve =
    params.categoryMapping.attributes.sleeveLength ??
    inferSleeveIntentFromDetectionLabel(params.detectionLabel);
  if (!desiredSleeve) return products;

  const isDressCategory = category === "dresses";
  const isTopCategory = category === "tops";
  const isOuterwearCategory = category === "outerwear";
  const minCompliance = isTopCategory
    ? (desiredSleeve === "short" || desiredSleeve === "sleeveless" ? 0.34 : 0.3)
    : desiredSleeve === "short" || desiredSleeve === "sleeveless"
      ? 0.5
      : 0.4;

  const filtered = products.filter((p) => {
    const blob = [
      (p as any)?.title,
      (p as any)?.description,
      (p as any)?.attr_sleeve,
      Array.isArray((p as any)?.product_types)
        ? (p as any).product_types.join(" ")
        : (p as any)?.product_types,
    ]
      .filter((x) => x != null)
      .map((x) => String(x).toLowerCase())
      .join(" ");

    const observedSleeve = inferSleeveFromProductText(blob);
    if (isDressCategory || isTopCategory || isOuterwearCategory) {
      // Sleeve metadata is sparse for apparel, especially outerwear/tailored listings.
      // Use only explicit text contradiction so full suits are not dropped just because
      // a YOLO "long sleeve outwear" label produced low sleeveCompliance.
      return !isSleeveContradiction(desiredSleeve, observedSleeve);
    }

    const sleeveCompliance = Number((p as any)?.explain?.sleeveCompliance);
    if (Number.isFinite(sleeveCompliance)) {
      return sleeveCompliance >= minCompliance;
    }
    return !isSleeveContradiction(desiredSleeve, observedSleeve);
  });

  // In strict main-path mode, never invoke helper recoveries.
  if (shopLookMainPathOnlyEnv()) {
    return filtered;
  }

  // If strict sleeve filtering collapses recall, fall back to contradiction-only.
  if (!isDressCategory && !isTopCategory && filtered.length < Math.max(2, Math.ceil(products.length * 0.2))) {
    const contradictionOnly = products.filter((p) => {
      const blob = [
        (p as any)?.title,
        (p as any)?.description,
        (p as any)?.attr_sleeve,
        Array.isArray((p as any)?.product_types)
          ? (p as any).product_types.join(" ")
          : (p as any)?.product_types,
      ]
        .filter((x) => x != null)
        .map((x) => String(x).toLowerCase())
        .join(" ");
      const observedSleeve = inferSleeveFromProductText(blob);
      return !isSleeveContradiction(desiredSleeve, observedSleeve);
    });
    if (contradictionOnly.length > filtered.length) {
      console.log(
        `[sleeve-guard-fallback] detection="${params.detectionLabel}" desired=${desiredSleeve} recovered ${filtered.length} -> ${contradictionOnly.length}`,
      );
      return contradictionOnly;
    }
  }

  if (filtered.length !== products.length) {
    console.log(
      `[sleeve-guard] detection="${params.detectionLabel}" desired=${desiredSleeve} filtered ${products.length} -> ${filtered.length}`,
    );
  }

  return filtered;
}

function applyShopLookVisualPrecisionGuard(
  products: ProductResult[],
  similarityThreshold: number,
  productCategory?: string,
): ProductResult[] {
  if (!Array.isArray(products) || products.length === 0) return [];

  const baseMin = Math.max(0, Math.min(1, similarityThreshold));
  const categoryNorm = String(productCategory ?? "").toLowerCase().trim();
  const isDressCategory = categoryNorm === "dresses" || categoryNorm === "dress";
  const strictDelta = isDressCategory
    ? Math.min(shopLookPostVisualMinDelta(), 0.015)
    : shopLookPostVisualMinDelta();
  const strictMin = Math.max(baseMin, Math.min(1, baseMin + strictDelta));
  const scoreOf = (p: ProductResult): number => {
    const sim = Number((p as any).similarity_score);
    const rel = Number((p as any).finalRelevance01);
    const merged = Math.max(Number.isFinite(sim) ? sim : 0, Number.isFinite(rel) ? rel : 0);
    return Math.max(0, Math.min(1, merged));
  };

  const strict = products.filter((p) => scoreOf(p) >= strictMin);
  const strictKeepMin = isDressCategory
    ? Math.min(shopLookPostVisualMinKeep(), 4)
    : categoryNorm === "tops" || categoryNorm === "bottoms"
      ? Math.min(shopLookPostVisualMinKeep(), 3)
      : shopLookPostVisualMinKeep();
  if (strict.length >= strictKeepMin) return strict;

  // Never return below the endpoint threshold, even if lower-fidelity fallback paths ran.
  const fallbackMin = isDressCategory
    ? Math.max(0.55, baseMin - 0.05)
    : categoryNorm === "tops"
      ? Math.max(0.4, baseMin - 0.06)
      : categoryNorm === "bottoms"
        ? Math.max(0.43, baseMin - 0.04)
        : baseMin;
  const fallback = products.filter((p) => scoreOf(p) >= fallbackMin);
  if (fallback.length >= strictKeepMin) return fallback;
  const ranked = [...fallback].sort((a, b) => scoreOf(b) - scoreOf(a));
  const safeCap = Math.max(1, Math.min(products.length, 8));
  return ranked.slice(0, safeCap);
}

function applyFormalityFilter(products: ProductResult[], minFormality?: number): ProductResult[] {
  const candidates = Array.isArray(products) ? products : [];
  const threshold = Number(minFormality ?? 0);
  if (candidates.length === 0 || !Number.isFinite(threshold) || threshold <= 0) {
    return candidates;
  }

  const normalizedThreshold = Math.max(0, Math.min(10, threshold));
  return candidates.filter((p) => {
    const explain = ((p as any)?.explain ?? {}) as Record<string, unknown>;
    const style = ((p as any)?.style ?? {}) as Record<string, unknown>;
    const explicitFormality = Number(explain.formality ?? style.formality ?? (p as any)?.formality ?? NaN);
    if (Number.isFinite(explicitFormality)) {
      return explicitFormality >= normalizedThreshold;
    }

    const blob = [
      (p as any)?.title,
      (p as any)?.description,
      (p as any)?.category,
      (p as any)?.category_canonical,
      Array.isArray((p as any)?.product_types) ? (p as any).product_types.join(" ") : (p as any)?.product_types,
      (p as any)?.attr_style,
      style.occasion,
      style.aesthetic,
    ]
      .filter((x) => x != null)
      .map((x) => String(x).toLowerCase())
      .join(" ");

    return inferFormalityFromCaption(blob) >= normalizedThreshold;
  });
}

function applyAthleticMismatchGuard(params: {
  products: ProductResult[];
  detectionLabel: string;
  productCategory?: string;
  softStyle?: string;
  minFormality?: number;
}): ProductResult[] {
  const products = Array.isArray(params.products) ? params.products : [];
  if (products.length === 0) return products;

  const category = String(params.productCategory ?? "").toLowerCase().trim();
  const minFormality = Number(params.minFormality ?? 0);
  const detectionLabel = String(params.detectionLabel ?? "");
  const softStyle = String(params.softStyle ?? "").toLowerCase();
  const formalIntent =
    minFormality >= 7 ||
    hasFormalTailoringCue(detectionLabel) ||
    /\b(formal|semi-formal|smart-casual|dressy|tailored|elegant)\b/.test(softStyle);

  if (!formalIntent && minFormality < 7) {
    return products;
  }

  const athleticCueRe = /\b(athletic|athleisure|sporty|sportswear|gym|workout|training|track|jogger|joggers|running|runner|sneaker|sneakers|trainer|trainers|hoodie|hooded|sweatshirt|sweatpants?)\b/;
  return products.filter((p) => {
    const blob = [
      (p as any)?.title,
      (p as any)?.description,
      (p as any)?.category,
      (p as any)?.category_canonical,
      Array.isArray((p as any)?.product_types) ? (p as any).product_types.join(" ") : (p as any)?.product_types,
      (p as any)?.attr_style,
      (p as any)?.style?.occasion,
      (p as any)?.style?.aesthetic,
    ]
      .filter((x) => x != null)
      .map((x) => String(x).toLowerCase())
      .join(" ");

    if (category === "tops" && hasTopCasualConflictCue(blob)) {
      return false;
    }
    if (formalIntent && athleticCueRe.test(blob)) {
      return false;
    }
    return true;
  });
}

function buildSafeNonEmptyFallback(params: {
  candidates: ProductResult[];
  productCategory?: string;
  similarityThreshold: number;
  limit: number;
}): ProductResult[] {
  const candidates = Array.isArray(params.candidates) ? params.candidates : [];
  if (candidates.length === 0) return [];

  const category = String(params.productCategory ?? "").toLowerCase().trim();
  const baseMin = Math.max(0, Math.min(1, params.similarityThreshold));
  const floor =
    category === "tops" || category === "bottoms" || category === "outerwear" || category === "dresses"
      ? Math.max(0.44, baseMin - 0.12)
      : Math.max(0.48, baseMin - 0.08);

  const scoreOf = (p: ProductResult): number => {
    const sim = Number((p as any).similarity_score ?? 0);
    const rel = Number((p as any).finalRelevance01 ?? 0);
    return Math.max(0, Math.min(1, Math.max(sim, rel)));
  };

  const safeCap = Math.max(1, Math.min(Math.floor(params.limit || 1), 8));
  const ranked = [...candidates].sort((a, b) => scoreOf(b) - scoreOf(a));
  const filtered = ranked.filter((p) => scoreOf(p) >= floor);
  if (filtered.length > 0) {
    return filtered.slice(0, safeCap);
  }

  return ranked.slice(0, safeCap);
}

/** Filter products by minimum relevance score. Removes low-relevance matches from results. */
export function applyRelevanceThresholdFilter(
  products: ProductResult[],
  minRelevance: number | undefined,
  options?: {
    preserveAtLeastOne?: boolean;
    preserveAtLeastCount?: number;
    detectionLabel?: string;
    category?: string;
    desiredColor?: string | string[];
    desiredColorConfidence?: number;
  },
): ProductResult[] {
  const relevanceDebugEnabled =
    process.env.NODE_ENV !== "production" || String(process.env.SEARCH_DEBUG ?? "") === "1";
  if (!minRelevance || minRelevance <= 0 || !Array.isArray(products) || products.length === 0) {
    return products;
  }
  const desiredColorTokens = (Array.isArray(options?.desiredColor) ? options?.desiredColor : [options?.desiredColor])
    .flatMap((c) => String(c ?? "").split(","))
    .map((c) => c.toLowerCase().trim())
    .filter((c) => c.length > 0);
  const prefersWhiteFamily = desiredColorTokens.some((c) => /^(white|off[\s-]?white|ivory|cream|ecru)$/i.test(c));
  const rankApparelByDesiredColor = (rows: ProductResult[]): ProductResult[] => {
    const categoryNorm = String(options?.category ?? "").toLowerCase().trim();
    const desiredColorConfidence = Number(options?.desiredColorConfidence ?? 0);
    const canUseGenericColorRank =
      !prefersWhiteFamily &&
      desiredColorTokens.length > 0 &&
      desiredColorConfidence >= 0.4 &&
      ["bottoms", "tops", "outerwear", "tailored", "dresses"].includes(categoryNorm);
    const productColorTokensForRank = (item: ProductResult): string[] => {
      const explain = ((item as any)?.explain ?? {}) as Record<string, unknown>;
      const catalogColor = String((item as any)?.color ?? "").trim();
      const matchedColor = String(explain.matchedColor ?? "").trim();
      const title = String((item as any)?.title ?? "").trim();
      const catalogTokens = normalizeColorTokensFromRaw(catalogColor);
      const matchedTokens = normalizeColorTokensFromRaw(matchedColor);
      const fallbackTitleTokens =
        catalogTokens.length === 0 && matchedTokens.length === 0
          ? normalizeColorTokensFromRaw(title)
          : [];
      const rawCatalogTokens = catalogColor ? [catalogColor] : [];
      const rawMatchedTokens = matchedColor ? [matchedColor] : [];
      return Array.from(
        new Set(
          [
            ...catalogTokens,
            ...matchedTokens,
            ...fallbackTitleTokens,
            ...rawCatalogTokens,
            ...rawMatchedTokens,
          ]
            .map((c) => String(c ?? "").trim())
            .filter((c) => c.length > 0),
        ),
      );
    };
    const baseSortScore = (item: ProductResult): number => {
      const unified = unifiedScorerScore(item);
      const finalRelevance = Number((item as any)?.finalRelevance01 ?? NaN);
      const similarity = Number((item as any)?.similarity_score ?? NaN);
      const score = Number.isFinite(unified as number)
        ? Number(unified)
        : Number.isFinite(finalRelevance)
          ? finalRelevance
          : Number.isFinite(similarity)
            ? similarity
            : 0;
      return Math.max(0, Math.min(1, score));
    };
    const decorateWithDesiredColorScore = (item: ProductResult): ProductResult => {
      const match = tieredColorListCompliance(desiredColorTokens, productColorTokensForRank(item), "any");
      const base = baseSortScore(item);
      const colorBonus =
        match.compliance >= 0.98 ? 0.11
          : match.compliance >= 0.88 ? 0.08
            : match.compliance >= 0.58 ? 0.04
              : 0;
      const colorPenalty = match.compliance <= 0.05 ? 0.05 : 0;
      const desiredColorSortScore = Math.max(0, Math.min(1, base + colorBonus - colorPenalty));
      const explain = ((item as any)?.explain ?? {}) as Record<string, unknown>;
      return {
        ...item,
        explain: {
          ...explain,
          desiredColorCompliance: match.compliance,
          desiredColorTier: match.tier,
          desiredColorMatched: match.bestMatch,
          desiredColorSortScore,
        },
      } as ProductResult;
    };
    if (canUseGenericColorRank && rows.length > 1) {
      const decorated = rows.map(decorateWithDesiredColorScore);
      const highConfidenceColorCutoff =
        categoryNorm === "outerwear" || categoryNorm === "tailored"
          ? 0.78
          : 0.82;
      const shouldKeepOnlyColorQualified = desiredColorConfidence >= highConfidenceColorCutoff;
      const colorQualified = decorated.filter((item) => {
        const compliance = Number(((item as any)?.explain ?? {}).desiredColorCompliance ?? 0);
        return compliance >= 0.58;
      });
      const minQualifiedKeep = categoryNorm === "outerwear" || categoryNorm === "tailored" ? 3 : 6;
      const workingRows =
        shouldKeepOnlyColorQualified && colorQualified.length >= Math.min(minQualifiedKeep, decorated.length)
          ? colorQualified
          : decorated;
      return [...workingRows].sort((a, b) => {
        const aExplain = ((a as any)?.explain ?? {}) as Record<string, unknown>;
        const bExplain = ((b as any)?.explain ?? {}) as Record<string, unknown>;
        const as = Number(aExplain.desiredColorSortScore ?? 0);
        const bs = Number(bExplain.desiredColorSortScore ?? 0);
        if (Math.abs(bs - as) > 1e-8) return bs - as;
        const ac = Number(aExplain.desiredColorCompliance ?? 0);
        const bc = Number(bExplain.desiredColorCompliance ?? 0);
        if (Math.abs(bc - ac) > 1e-8) return bc - ac;
        return baseSortScore(b) - baseSortScore(a);
      });
    }
    if ((categoryNorm !== "bottoms" && categoryNorm !== "tops") || rows.length <= 1) return rows;
    const whiteFamilyRegex = /\b(white|off[\s-]?white|ivory|cream|ecru|bone|calico)\b/i;
    const nonWhiteColorRegex =
      /\b(blue|indigo|navy|black|coal|charcoal|grey|gray|green|olive|brown|tan|khaki|red|pink|purple|orange|yellow)\b/i;
    const bottomTypeRegex = /\b(pants?|trousers?|jeans?|denim|chinos?|slacks|cargos?|bottoms?)\b/i;
    const topTypeRegex = /\b(tops?|shirts?|blouses?|tees?|t-?shirts?|tshirts?|tanks?|camisoles?|cami|polo(?:s)?|sweaters?|hoodies?|sweatshirts?|cardigans?|overshirts?|loungewear)\b/i;
    const suitOuterwearRegex = /\b(suits?|tuxedo|blazers?|jackets?|sport\s+coats?)\b/i;
    const topColorCueRegex = /\b(tops?|shirts?|blouses?|tees?|t-?shirts?|tshirts?|tanks?|camisoles?|polo(?:s)?|sweaters?|hoodies?|sweatshirts?|cardigans?|overshirts?)\b/i;
    const colorEvidenceScore = (item: ProductResult): number => {
      const explain = ((item as any)?.explain ?? {}) as Record<string, unknown>;
      const catalogColor = String((item as any)?.color ?? "");
      const title = String((item as any)?.title ?? "");
      const category = String((item as any)?.category ?? "");
      const categoryCanonical = String((item as any)?.category_canonical ?? "");
      const productTypes = Array.isArray((item as any)?.product_types)
        ? (item as any).product_types.join(" ")
        : String((item as any)?.product_types ?? "");
      const description = String((item as any)?.description ?? "");
      const url = String((item as any)?.product_url ?? "");
      const matchedColor = String(explain.matchedColor ?? "");
      const catalogAndTitle = [catalogColor, title, url].join(" ");
      const listingTypeText = [title, category, categoryCanonical, productTypes].join(" ");
      const allText = [catalogAndTitle, listingTypeText, description].join(" ");
      let score = 0;
      if (categoryNorm === "tops" && topTypeRegex.test(listingTypeText)) score += 3;
      if (categoryNorm === "bottoms" && bottomTypeRegex.test(listingTypeText)) score += 3;
      if (whiteFamilyRegex.test(catalogColor)) score += 4;
      if (whiteFamilyRegex.test(title)) score += 3;
      if (whiteFamilyRegex.test(url)) score += 2;
      if (whiteFamilyRegex.test(description)) score += 1;
      if (whiteFamilyRegex.test(matchedColor)) score += 0.75;
      if (categoryNorm === "tops" && topColorCueRegex.test(listingTypeText)) score += 1.25;
      if (nonWhiteColorRegex.test(catalogColor) && !whiteFamilyRegex.test(catalogColor)) score -= 4;
      if (nonWhiteColorRegex.test(title) && !whiteFamilyRegex.test(title)) score -= 2;
      if (suitOuterwearRegex.test(allText) && !bottomTypeRegex.test(listingTypeText)) score -= 5;
      if (categoryNorm === "tops" && suitOuterwearRegex.test(allText) && !topTypeRegex.test(listingTypeText)) score -= 3;
      return score;
    };
    return [...rows].sort((a, b) => {
      const ar = Number((a as any)?.finalRelevance01 ?? 0);
      const br = Number((b as any)?.finalRelevance01 ?? 0);
      const aExplain = ((a as any)?.explain ?? {}) as Record<string, unknown>;
      const bExplain = ((b as any)?.explain ?? {}) as Record<string, unknown>;
      const aBlob = [aExplain.matchedColor, (a as any)?.color, (a as any)?.title, (a as any)?.description]
        .filter((x) => x != null)
        .map((x) => String(x))
        .join(" ");
      const bBlob = [bExplain.matchedColor, (b as any)?.color, (b as any)?.title, (b as any)?.description]
        .filter((x) => x != null)
        .map((x) => String(x))
        .join(" ");
      const aColorComp = Number(aExplain.colorCompliance ?? 0);
      const bColorComp = Number(bExplain.colorCompliance ?? 0);
      const aWhiteHit = whiteFamilyRegex.test(aBlob) ? 1 : 0;
      const bWhiteHit = whiteFamilyRegex.test(bBlob) ? 1 : 0;
      const aColorEvidence = colorEvidenceScore(a);
      const bColorEvidence = colorEvidenceScore(b);
      if (Math.abs(aColorEvidence - bColorEvidence) > 1e-6) {
        return bColorEvidence - aColorEvidence;
      }
      if (prefersWhiteFamily && aWhiteHit !== bWhiteHit) return bWhiteHit - aWhiteHit;
      if (Math.abs(aColorComp - bColorComp) > 1e-6) return bColorComp - aColorComp;
      return br - ar;
    });
  };

  const filtered = products.filter((p) => {
    const relevance = Number((p as any)?.finalRelevance01 ?? 0);
    const explain = ((p as any)?.explain ?? {}) as Record<string, unknown>;
    const scorerAcceptance = unifiedScorerScore(p);
    const effectiveRelevance =
      scorerAcceptance !== null
        ? scorerAcceptance
        : Number.isFinite(relevance)
          ? relevance
          : 0;
    const categoryNorm = String(options?.category ?? "").toLowerCase().trim();
    const audienceCompliance = Number(explain.audienceCompliance ?? NaN);
    const hasAudienceIntent = Boolean(explain.hasAudienceIntent);
    const audienceFloor = categoryNorm === "bags" ? 0.46 : categoryNorm === "tops" || categoryNorm === "bottoms" ? 0.52 : 0;
    if (hasAudienceIntent && audienceFloor > 0 && Number.isFinite(audienceCompliance) && audienceCompliance < audienceFloor) {
      return false;
    }
    return effectiveRelevance >= minRelevance;
  });

  // Strict mode: keep only true main-path results, no relevance fallback preservation.
  if (shopLookMainPathOnlyEnv()) {
    return rankApparelByDesiredColor(filtered);
  }

  if (filtered.length !== products.length) {
    console.log(
      `[relevance-threshold-filter] filtered ${products.length} → ${filtered.length} (minRelevance=${minRelevance})`,
    );
  }

  const preserveCount = Math.max(
    options?.preserveAtLeastOne ? 1 : 0,
    Number.isFinite(options?.preserveAtLeastCount as number)
      ? Math.max(0, Math.floor(options?.preserveAtLeastCount as number))
      : 0,
  );

  if (filtered.length < preserveCount && preserveCount > 0) {
    const hasSevereColorContradiction = (row: ProductResult): boolean => {
      const explain = ((row as any)?.explain ?? {}) as Record<string, unknown>;
      const hasColorIntent =
        Boolean(explain.hasColorIntent) || Boolean(explain.colorIntentGatesFinalRelevance);
      if (!hasColorIntent) return false;
      const colorTier = String(explain.colorTier ?? "").toLowerCase().trim();
      const colorCompliance = Number(explain.colorCompliance ?? NaN);
      if (colorTier === "none") return true;
      if (Number.isFinite(colorCompliance) && colorCompliance < 0.2) return true;
      return false;
    };
    const hasSevereAudienceContradiction = (row: ProductResult): boolean => {
      const categoryNorm = String(options?.category ?? "").toLowerCase().trim();
      if (categoryNorm !== "tops" && categoryNorm !== "bottoms" && categoryNorm !== "bags") return false;
      const explain = ((row as any)?.explain ?? {}) as Record<string, unknown>;
      if (!Boolean(explain.hasAudienceIntent)) return false;
      const audienceCompliance = Number(explain.audienceCompliance ?? NaN);
      if (!Number.isFinite(audienceCompliance)) return false;
      const floor = categoryNorm === "bags" ? 0.46 : 0.52;
      return audienceCompliance < floor;
    };
    const hasSevereTopStyleContradiction = (row: ProductResult): boolean => {
      const categoryNorm = String(options?.category ?? "").toLowerCase().trim();
      if (categoryNorm !== "tops") return false;
      const tailoredIntent = isTailoredTopDetectionIntent(String(options?.detectionLabel ?? ""));
      if (!tailoredIntent) return false;
      const blob = [
        (row as any)?.title,
        (row as any)?.description,
        (row as any)?.category,
        (row as any)?.category_canonical,
        Array.isArray((row as any)?.product_types) ? (row as any).product_types.join(" ") : (row as any)?.product_types,
      ]
        .filter((x) => x != null)
        .map((x) => String(x).toLowerCase())
        .join(" ");
      if (!blob) return false;
      if (hasTailoredTopProductCue(blob)) return false;
      return hasTopCasualConflictCue(blob);
    };
    const sorted = [...products].sort((a, b) => {
      const ar = Number((a as any)?.finalRelevance01 ?? Number.NEGATIVE_INFINITY);
      const br = Number((b as any)?.finalRelevance01 ?? Number.NEGATIVE_INFINITY);
      return br - ar;
    });
    const qualityFloor = Math.max(0.28, minRelevance - 0.08);
    const fallbackPool = sorted.filter((item) => {
      const relevance = Number((item as any)?.finalRelevance01 ?? 0);
      if (hasSevereColorContradiction(item)) return false;
      if (hasSevereAudienceContradiction(item)) return false;
      if (hasSevereTopStyleContradiction(item)) return false;
      return relevance >= qualityFloor;
    });
    const recovered = fallbackPool.slice(0, preserveCount).map((item) => ({
      ...item,
      relevanceFallbackPreserved: true,
    }));
    if (recovered.length === 0) {
      const categoryNorm = String(options?.category ?? "").toLowerCase().trim();
      if (categoryNorm === "bottoms") {
        const optionDesiredColors = (Array.isArray(options?.desiredColor)
          ? options?.desiredColor
          : [options?.desiredColor])
          .flatMap((c) => String(c ?? "").split(","))
          .map((c) => c.toLowerCase().trim())
          .filter((c) => c.length > 0);
        const inferredDesiredFromProducts = products
          .flatMap((item) => {
            const explain = ((item as any)?.explain ?? {}) as Record<string, unknown>;
            const fromEffective = Array.isArray(explain.desiredColorsEffective)
              ? (explain.desiredColorsEffective as unknown[])
              : [];
            const fromDesired = Array.isArray(explain.desiredColors)
              ? (explain.desiredColors as unknown[])
              : [];
            return [...fromEffective, ...fromDesired];
          })
          .map((c) => String(c ?? "").toLowerCase().trim())
          .filter((c) => c.length > 0);
        const desiredColors = [...new Set([...optionDesiredColors, ...inferredDesiredFromProducts])];
        const hasColorIntent = desiredColors.length > 0;
        if (relevanceDebugEnabled) {
          console.log(
            `[relevance-debug] detection="${options?.detectionLabel ?? "unknown"}" category="bottoms" desiredColors=[${desiredColors.join(", ")}] hasColorIntent=${hasColorIntent}`,
          );
        }
        const bottomsRescueFloor = Math.max(0.34, minRelevance - 0.14);
        const rescueLimit = Math.max(1, Math.min(2, preserveCount));
        const neutralColorRegex = /\b(white|off[\s-]?white|ivory|cream|beige|ecru|stone|taupe|nude)\b/i;
        const desiredColorMatchers = desiredColors.map((token) => {
          const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s-]+");
          return new RegExp(`\\b${escaped}\\b`, "i");
        });
        const bottomsColorSafeRescue = sorted
          .filter((item) => {
            const relevance = Number((item as any)?.finalRelevance01 ?? 0);
            if (relevance < bottomsRescueFloor) return false;
            const explain = ((item as any)?.explain ?? {}) as Record<string, unknown>;
            if (Boolean(explain.hardBlocked)) return false;
            const contradictionPenalty = Number(explain.colorContradictionPenalty ?? 1);
            if (Number.isFinite(contradictionPenalty) && contradictionPenalty < 0.75) return false;
            const colorCompliance = Number(explain.colorCompliance ?? NaN);
            const colorEvidence = [
              explain.matchedColor,
              (item as any)?.color,
              (item as any)?.title,
              (item as any)?.description,
            ]
              .filter((x) => x != null)
              .map((x) => String(x))
              .join(" ");
            const hasDesiredColorHit =
              desiredColorMatchers.length > 0 &&
              desiredColorMatchers.some((rx) => rx.test(colorEvidence));
            const hasStrictColorCompliance = Number.isFinite(colorCompliance) && colorCompliance >= 0.45;
            const hasModerateColorCompliance = Number.isFinite(colorCompliance) && colorCompliance >= 0.35;
            if (hasSevereAudienceContradiction(item)) return false;
            if (hasColorIntent) {
              return hasDesiredColorHit || hasStrictColorCompliance;
            }
            return neutralColorRegex.test(colorEvidence) || hasModerateColorCompliance;
          })
          .slice(0, rescueLimit)
          .map((item) => ({
            ...item,
            relevanceBottomsColorRescue: true,
          }));
        if (bottomsColorSafeRescue.length > 0) {
          console.log(
            `[relevance-threshold-bottoms-rescue] preserved ${bottomsColorSafeRescue.length} product(s) for detection="${options?.detectionLabel ?? "unknown"}" floor=${bottomsRescueFloor.toFixed(3)} threshold=${minRelevance}`,
          );
          if (relevanceDebugEnabled) {
            const selected = bottomsColorSafeRescue
              .map((item) => String((item as any)?.id ?? "unknown"))
              .join(", ");
            console.log(
              `[relevance-debug] detection="${options?.detectionLabel ?? "unknown"}" bottomsRescueSelected=[${selected}]`,
            );
          }
          return bottomsColorSafeRescue;
        }
      }
      if (categoryNorm === "tops") {
        const optionDesiredColors = (Array.isArray(options?.desiredColor)
          ? options?.desiredColor
          : [options?.desiredColor])
          .flatMap((c) => String(c ?? "").split(","))
          .map((c) => c.toLowerCase().trim())
          .filter((c) => c.length > 0);
        const inferredDesiredFromProducts = products
          .flatMap((item) => {
            const explain = ((item as any)?.explain ?? {}) as Record<string, unknown>;
            const fromEffective = Array.isArray(explain.desiredColorsEffective)
              ? (explain.desiredColorsEffective as unknown[])
              : [];
            const fromDesired = Array.isArray(explain.desiredColors)
              ? (explain.desiredColors as unknown[])
              : [];
            return [...fromEffective, ...fromDesired];
          })
          .map((c) => String(c ?? "").toLowerCase().trim())
          .filter((c) => c.length > 0);
        const desiredColors = [...new Set([...optionDesiredColors, ...inferredDesiredFromProducts])];
        const hasColorIntent = desiredColors.length > 0;
        if (relevanceDebugEnabled) {
          console.log(
            `[relevance-debug] detection="${options?.detectionLabel ?? "unknown"}" category="tops" desiredColors=[${desiredColors.join(", ")}] hasColorIntent=${hasColorIntent}`,
          );
        }
        const topsRescueFloor = Math.max(0.33, minRelevance - 0.13);
        const rescueLimit = Math.max(1, Math.min(2, preserveCount));
        const neutralColorRegex = /\b(white|off[\s-]?white|ivory|cream|beige|ecru|stone|taupe|nude|gray|grey|black|navy|blue|brown|pink|red|green|yellow|purple|orange)\b/i;
        const desiredColorMatchers = desiredColors.map((token) => {
          const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s-]+");
          return new RegExp(`\\b${escaped}\\b`, "i");
        });
        const topsColorSafeRescue = sorted
          .filter((item) => {
            const relevance = Number((item as any)?.finalRelevance01 ?? 0);
            if (relevance < topsRescueFloor) return false;
            const explain = ((item as any)?.explain ?? {}) as Record<string, unknown>;
            if (Boolean(explain.hardBlocked)) return false;
            const contradictionPenalty = Number(explain.colorContradictionPenalty ?? 1);
            if (Number.isFinite(contradictionPenalty) && contradictionPenalty < 0.75) return false;
            const colorCompliance = Number(explain.colorCompliance ?? NaN);
            const colorEvidence = [
              explain.matchedColor,
              (item as any)?.color,
              (item as any)?.title,
              (item as any)?.description,
              (item as any)?.category,
              (item as any)?.category_canonical,
              Array.isArray((item as any)?.product_types) ? (item as any).product_types.join(" ") : (item as any)?.product_types,
            ]
              .filter((x) => x != null)
              .map((x) => String(x))
              .join(" ");
            const hasDesiredColorHit =
              desiredColorMatchers.length > 0 &&
              desiredColorMatchers.some((rx) => rx.test(colorEvidence));
            const hasStrongColorCompliance = Number.isFinite(colorCompliance) && colorCompliance >= 0.42;
            const hasModerateColorCompliance = Number.isFinite(colorCompliance) && colorCompliance >= 0.32;
            const topTypeHit = /\b(tops?|shirts?|blouses?|tees?|t-?shirts?|tshirts?|tanks?|camisoles?|polo(?:s)?|sweaters?|hoodies?|sweatshirts?|cardigans?|overshirts?|loungewear)\b/i.test(colorEvidence);
            if (hasSevereAudienceContradiction(item)) return false;
            if (hasColorIntent) {
              return (topTypeHit && hasDesiredColorHit) || hasStrongColorCompliance;
            }
            return topTypeHit && (neutralColorRegex.test(colorEvidence) || hasModerateColorCompliance);
          })
          .slice(0, rescueLimit)
          .map((item) => ({
            ...item,
            relevanceTopsColorRescue: true,
          }));
        if (topsColorSafeRescue.length > 0) {
          console.log(
            `[relevance-threshold-tops-rescue] preserved ${topsColorSafeRescue.length} product(s) for detection="${options?.detectionLabel ?? "unknown"}" floor=${topsRescueFloor.toFixed(3)} threshold=${minRelevance}`,
          );
          if (relevanceDebugEnabled) {
            const selected = topsColorSafeRescue
              .map((item) => String((item as any)?.id ?? "unknown"))
              .join(", ");
            console.log(
              `[relevance-debug] detection="${options?.detectionLabel ?? "unknown"}" topsRescueSelected=[${selected}]`,
            );
          }
          return topsColorSafeRescue;
        }
      }
      // Last-resort color-agnostic apparel rescue:
      // if tops/bottoms are fully collapsed by relevance+color gating, keep the best
      // type-compatible visual neighbors instead of returning an empty detection.
      if (categoryNorm === "tops" || categoryNorm === "bottoms") {
        const apparelRescueFloor = Math.max(0.22, minRelevance - 0.18);
        const rescueLimit = Math.max(1, Math.min(3, preserveCount > 0 ? preserveCount : 1));
        const colorAgnosticRescue = sorted
          .filter((item) => {
            const relevance = Number((item as any)?.finalRelevance01 ?? 0);
            if (relevance < apparelRescueFloor) return false;
            const explain = ((item as any)?.explain ?? {}) as Record<string, unknown>;
            if (Boolean(explain.hardBlocked)) return false;
            const crossFamilyPenalty = Number(explain.crossFamilyPenalty ?? 0);
            if (Number.isFinite(crossFamilyPenalty) && crossFamilyPenalty >= 0.72) return false;
            const exactType = Number(explain.exactTypeScore ?? 0);
            const typeCompliance = Number(explain.productTypeCompliance ?? 0);
            const minTypeFloor = categoryNorm === "tops" ? 0.12 : 0.18;
            if (hasSevereAudienceContradiction(item)) return false;
            if (!(exactType >= 1 || typeCompliance >= minTypeFloor)) return false;
            if (hasSevereTopStyleContradiction(item)) return false;
            return true;
          })
          .slice(0, rescueLimit)
          .map((item) => ({
            ...item,
            relevanceApparelRescue: true,
          }));
        if (colorAgnosticRescue.length > 0) {
          console.log(
            `[relevance-threshold-apparel-rescue] preserved ${colorAgnosticRescue.length} product(s) for detection="${options?.detectionLabel ?? "unknown"}" category="${categoryNorm}" floor=${apparelRescueFloor.toFixed(3)} threshold=${minRelevance}`,
          );
          return colorAgnosticRescue;
        }
      }
      return filtered;
    }
    const bestRelevance = Number((recovered[0] as any)?.finalRelevance01 ?? 0);
    console.log(
      `[relevance-threshold-fallback] preserved ${recovered.length} product(s) for detection="${options?.detectionLabel ?? "unknown"}" category="${options?.category ?? "unknown"}" bestFinalRelevance01=${bestRelevance.toFixed(3)} threshold=${minRelevance}`,
    );
    return rankApparelByDesiredColor(recovered);
  }

  return rankApparelByDesiredColor(filtered);
}

function isCoreOutfitCategory(category: string | undefined): boolean {
  const normalized = String(category ?? "").trim().toLowerCase();
  return (
    normalized === "tops" ||
    normalized === "bottoms" ||
    normalized === "dresses" ||
    normalized === "footwear" ||
    normalized === "outerwear" ||
    normalized === "bags"
  );
}

function finalRelevanceScore(product: unknown): number {
  const score = Number((product as any)?.finalRelevance01 ?? 0);
  return Number.isFinite(score) ? score : 0;
}

function sortProductsByFinalRelevanceDesc(products: ProductResult[]): ProductResult[] {
  // Use centralized sorting utility to ensure consistent ordering across all APIs
  const sorted = sortProductsByRelevanceAndCategory(products);
  if (!sorted.some((p: any) => Number.isFinite(Number(p?.explain?.desiredColorSortScore)))) {
    return sorted;
  }
  return sorted
    .map((product, index) => ({ product, index }))
    .sort((a, b) => {
      const as = Number((a.product as any)?.explain?.desiredColorSortScore ?? NaN);
      const bs = Number((b.product as any)?.explain?.desiredColorSortScore ?? NaN);
      const aHas = Number.isFinite(as);
      const bHas = Number.isFinite(bs);
      if (aHas && bHas && Math.abs(bs - as) > 1e-8) return bs - as;
      if (aHas !== bHas) return aHas ? -1 : 1;
      return a.index - b.index;
    })
    .map(({ product }) => product);
}

function sortDetectionProductsByFinalRelevance(row: DetectionSimilarProducts): DetectionSimilarProducts {
  const products = Array.isArray(row.products) ? sortProductsByFinalRelevanceDesc(row.products) : [];
  return { ...row, products, count: products.length };
}

function paginateDetectionGroups(
  rows: DetectionSimilarProducts[],
  page: number,
  pageSize: number,
): {
  rows: DetectionSimilarProducts[];
  totalProducts: number;
  totalAvailableProducts: number;
} {
  const safePage = Math.max(1, Math.floor(page));
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const offset = (safePage - 1) * safePageSize;

  let totalProducts = 0;
  let totalAvailableProducts = 0;
  const paginated = rows.map((row) => {
    const allProducts = Array.isArray(row.products) ? sortProductsByFinalRelevanceDesc(row.products) : [];
    const totalItems = allProducts.length;
    const totalPages = totalItems > 0 ? Math.ceil(totalItems / safePageSize) : 0;
    const products = allProducts.slice(offset, offset + safePageSize);
    totalProducts += products.length;
    totalAvailableProducts += totalItems;
    return {
      ...row,
      products,
      count: products.length,
      totalAvailable: totalItems,
      pagination: {
        page: safePage,
        pageSize: safePageSize,
        totalItems,
        totalPages,
        hasNextPage: totalPages > 0 && safePage < totalPages,
        hasPrevPage: safePage > 1 && totalPages > 0,
      },
    };
  });

  return {
    rows: paginated,
    totalProducts,
    totalAvailableProducts,
  };
}

function inferLengthIntentFromCaption(caption: string): "mini" | "midi" | "maxi" | "long" | null {
  const s = String(caption || "").toLowerCase();
  if (!s) return null;
  if (/\bmini\b/.test(s)) return "mini";
  if (/\bmidi\b/.test(s)) return "midi";
  if (/\bmaxi\b/.test(s)) return "maxi";
  if (/\blong\b/.test(s)) return "long";
  return null;
}

function inferLengthIntentFromDetection(
  detection: Detection,
  imageHeight: number,
): "mini" | "midi" | "maxi" | "long" | null {
  const label = String(detection.label || "").toLowerCase();
  if (!label.includes("dress")) return null;
  // Prefer lexical evidence, but avoid confusing sleeve length with hem length.
  if (/\bmini\s*dress\b|\bmini\b/.test(label)) return "mini";
  if (/\bmidi\s*dress\b|\bmidi\b/.test(label)) return "midi";
  if (/\bmaxi\s*dress\b|\bmaxi\b/.test(label)) return "maxi";
  if (/\blong\s*(dress|gown|frock|abaya|kaftan)\b/.test(label) && !/\bsleeve\b/.test(label)) {
    return "long";
  }

  // Geometric length inference is intentionally opt-in because it can over-constrain
  // dress retrieval under non-standard framing.
  if (!imageEnableGeometricDressLengthEnv()) return null;

  // Fallback to bbox-based inference only for confident, sufficiently large dress detections.
  // Fallback to bbox-based inference only for very confident, large dress detections.
  const conf = Number(detection.confidence ?? 0);
  const area = Number((detection as any).area_ratio ?? 0);
  const box = (detection as any).box_normalized;
  if (
    conf >= 0.82 &&
    area >= 0.18 &&
    box &&
    typeof box.y1 === "number" &&
    typeof box.y2 === "number"
  ) {
    const inferred = inferDressLengthFromBox({ y1: box.y1, y2: box.y2 });
    if (inferred === "maxi") return "long";
    if (inferred) return inferred;
  }

  return null;
}

function isHeadwearLabel(label: string): boolean {
  const l = String(label || "").toLowerCase();
  return /\b(hat|hats|cap|caps|beanie|beanies|beret|berets|headwear|head covering)\b/.test(l);
}

function normalizeParentDedupKey(urlLike: unknown): string {
  const raw = String(urlLike ?? "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length > 0 && /^[a-z]{2}(?:-[a-z]{2})?$/i.test(parts[0])) {
      parts.shift();
    }
    return `${u.origin.toLowerCase()}/${parts.join("/").toLowerCase()}`;
  } catch {
    return raw.split("#")[0].split("?")[0].toLowerCase();
  }
}

function normalizeVariantTitleSegment(raw: unknown): string {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\b\d{1,2}(?:\.\d+)?\s*(?:"|in(?:ches)?|in)\s*inseam\b/g, " ")
    .replace(/\b(?:inseam|petite|tall|long)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildVariantFamilyDedupKey(product: ProductResult): string {
  const vendor = String((product as any)?.vendor_id ?? "").trim() || "__vendor";
  const title = String((product as any)?.title ?? "");
  const titleSegments = title
    .split("|")
    .map((segment) => normalizeVariantTitleSegment(segment))
    .filter((segment) => Boolean(segment) && !/^\d/.test(segment));

  if (titleSegments.length >= 2) {
    return `vf:${vendor}|${titleSegments[0]}|${titleSegments[1]}`;
  }
  if (titleSegments.length === 1) {
    return `vf:${vendor}|${titleSegments[0]}`;
  }

  const parent = normalizeParentDedupKey((product as any)?.parent_product_url || (product as any)?.product_url);
  if (parent) return `vp:${vendor}|${parent}`;

  return `id:${String((product as any)?.id ?? "")}`;
}

function buildProductDedupKey(product: ProductResult, collapseVariantGroups: boolean): string {
  if (collapseVariantGroups) {
    return buildVariantFamilyDedupKey(product);
  }

  const explicitGroupKey = String((product as any)?.variant_group_key ?? "").trim().toLowerCase();
  if (explicitGroupKey) return `group:${explicitGroupKey}`;

  const vendor = String((product as any)?.vendor_id ?? "").trim() || "__vendor";
  const parent = normalizeParentDedupKey((product as any)?.parent_product_url || (product as any)?.product_url);
  if (parent) return `vp:${vendor}|${parent}`;

  const title = String((product as any)?.title ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  if (title) return `vt:${vendor}|${title}`;

  return `id:${String((product as any)?.id ?? "")}`;
}

function applyGroupedPostRanking(
  groupedResults: DetectionSimilarProducts[],
  includeCrossGroupDedupe: boolean,
  collapseVariantGroups: boolean,
): { rows: DetectionSimilarProducts[]; totalProducts: number } {
  if (groupedResults.length === 0) return { rows: groupedResults, totalProducts: 0 };
  const weighted = groupedResults.map((row) => {
    const base = (row.detection.confidence ?? 0) * (Number.isFinite(row.detection.area_ratio) ? row.detection.area_ratio : 0);
    return { row, base };
  });
  const dominantIdx = weighted.reduce((best, cur, idx, arr) => (cur.base > arr[best].base ? idx : best), 0);
  const primaryBoost = imagePrimaryDetectionBoost();
  const secondaryWeight = imageSecondaryDetectionWeight();
  const ranked = weighted
    .map((x, idx) => ({ ...x, score: x.base * (idx === dominantIdx ? primaryBoost : secondaryWeight) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.row);

  const rows = includeCrossGroupDedupe
    ? ranked.map((row, rowIdx) => {
      const seen = new Set<string>();
      const sortedProducts = Array.isArray(row.products) ? sortProductsByFinalRelevanceDesc(row.products) : [];
      const deduped = sortedProducts.filter((p) => {
        const key = buildProductDedupKey(p as ProductResult, collapseVariantGroups);
        if (!key || seen.has(key)) return false;
        // Keep first seen in ranked group order; dominant group wins ties.
        seen.add(key);
        return true;
      });
      if (rowIdx === 0) return { ...row, products: deduped, count: deduped.length };
      return { ...row, products: deduped, count: deduped.length };
    })
    : ranked.map(sortDetectionProductsByFinalRelevance);

  if (includeCrossGroupDedupe) {
    const globalSeen = new Set<string>();
    const globalRows = rows.map((row) => {
      const products = sortProductsByFinalRelevanceDesc(row.products).filter((p) => {
        const key = buildProductDedupKey(p as ProductResult, collapseVariantGroups);
        if (!key || globalSeen.has(key)) return false;
        globalSeen.add(key);
        return true;
      });
      return { ...row, products, count: products.length };
    });
    const totalProducts = globalRows.reduce((acc, row) => acc + row.count, 0);
    return { rows: globalRows, totalProducts };
  }

  const totalProducts = rows.reduce((acc, row) => acc + row.count, 0);
  return { rows, totalProducts };
}

function derivePrimaryColorFromItems(
  colorsByItem: Record<string, string | null>,
  confidenceByItem: Record<string, number>,
  minConfidence = 0.55,
): string | null {
  const derived = derivePrimaryColorFromItemsWithConfidence(colorsByItem, confidenceByItem, minConfidence);
  return derived.color;
}

function derivePrimaryColorFromItemsWithConfidence(
  colorsByItem: Record<string, string | null>,
  confidenceByItem: Record<string, number>,
  minConfidence = 0.55,
): { color: string | null; confidence: number } {
  const tally = new Map<string, number>();
  for (const [key, value] of Object.entries(colorsByItem || {})) {
    const color = String(value || "").toLowerCase().trim();
    if (!color) continue;
    const conf = Number(confidenceByItem?.[key] ?? 0);
    if (!Number.isFinite(conf) || conf < minConfidence) continue;
    tally.set(color, (tally.get(color) ?? 0) + conf);
  }
  if (tally.size === 0) return { color: null, confidence: 0 };
  let bestColor: string | null = null;
  let bestScore = -1;
  for (const [color, score] of tally.entries()) {
    if (score > bestScore) {
      bestScore = score;
      bestColor = color;
    }
  }
  return { color: bestColor, confidence: bestScore > 0 ? Math.min(1, bestScore) : 0 };
}

function pickColorByHighestConfidence(
  candidates: Array<{ color: string | null | undefined; confidence: number | null | undefined }>,
): string | null {
  let bestColor: string | null = null;
  let bestConfidence = -1;
  for (const candidate of candidates) {
    const color = String(candidate.color ?? "").toLowerCase().trim();
    if (!color) continue;
    const confidence = Number(candidate.confidence ?? 0);
    const safeConfidence = Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0;
    if (safeConfidence > bestConfidence) {
      bestConfidence = safeConfidence;
      bestColor = color;
    }
  }
  return bestColor;
}

const NEUTRAL_COLORS = new Set([
  "black",
  "gray",
  "charcoal",
  "white",
  "off-white",
  "cream",
  "ivory",
  "beige",
  "tan",
  "camel",
  "brown",
  "navy",
  "silver",
]);

const LIGHT_NEUTRAL_COLORS = new Set([
  "white",
  "off-white",
  "cream",
  "ivory",
  "beige",
  "tan",
  "silver",
]);

function isNeutralFashionColor(color: string): boolean {
  return NEUTRAL_COLORS.has(String(color || "").toLowerCase().trim());
}

function isLightNeutralFashionColor(color: string): boolean {
  return LIGHT_NEUTRAL_COLORS.has(String(color || "").toLowerCase().trim());
}

function canonicalizeColorIntentToken(color: string | null | undefined): string {
  const raw = String(color ?? "").toLowerCase().trim();
  if (!raw) return "";
  if (["charcoal", "anthracite", "graphite", "jet", "coal"].includes(raw)) return "black";
  if (["off-white", "ivory", "cream", "ecru"].includes(raw)) return "white";
  if (["camel", "tan", "khaki", "stone", "taupe", "nude", "sand"].includes(raw)) return "beige";
  if (["navy", "midnight blue", "cobalt", "azure"].includes(raw)) return "blue";
  if (["burgundy", "maroon", "wine"].includes(raw)) return "red";
  if (["olive", "khaki green"].includes(raw)) return "green";
  return raw;
}

function shouldApplyStrictDetectionSoftColor(params: {
  productCategory: string;
  color: string;
  confidence: number;
}): boolean {
  const category = String(params.productCategory || "").toLowerCase().trim();
  const color = canonicalizeColorIntentToken(params.color);
  const confidence = Number.isFinite(params.confidence) ? params.confidence : 0;
  if (!color || color === "multicolor") return false;
  if (isNeutralFashionColor(color)) return false;
  if (category === "tops") return confidence >= 0.84;
  if (category === "bottoms" || category === "dresses" || category === "outerwear") return confidence >= 0.82;
  if (category === "footwear" || category === "bags") return confidence >= 0.8;
  return confidence >= 0.86;
}

function isBottomLikeLabel(label: string): boolean {
  return /\b(bottom|bottoms|pant|pants|trouser|trousers|jean|jeans|short|shorts|skirt|skirts|legging|leggings)\b/.test(
    String(label || "").toLowerCase(),
  );
}

function selectDetectionColorFromPalette(params: {
  cropColors: string[];
  productCategory: string;
  detectionLabel: string;
  cropColorConfidence: number;
}): string | null {
  const colors = params.cropColors
    .map((c) => String(c || "").toLowerCase().trim())
    .filter(Boolean);
  if (colors.length === 0) return null;

  const primary = colors[0];
  const alternatives = colors.slice(1);
  const category = String(params.productCategory || "").toLowerCase();
  const label = String(params.detectionLabel || "").toLowerCase();
  const confidence = Number.isFinite(params.cropColorConfidence) ? params.cropColorConfidence : 0;
  const lowConfidence = confidence < 0.65;
  const mediumConfidence = confidence < 0.78;
  const isTopLike =
    category === "tops" ||
    /\b(top|shirt|blouse|tee|t-?shirt|sweater|hoodie|sweatshirt|vest|tank|camisole)\b/.test(label);
  const isBottomLike = category === "bottoms" || isBottomLikeLabel(label);
  const isOnePieceLike =
    category === "dresses" ||
    /\b(dress|gown|jumpsuit|romper|playsuit|sundress|vest dress)\b/.test(label);
  const primaryIsLightNeutral = isLightNeutralFashionColor(primary);
  const warmNeutralSet = new Set(["beige", "tan", "camel", "taupe", "stone", "sand", "khaki", "nude"]);
  const lightNeutralSet = new Set(["white", "off-white", "cream", "ivory"]);
  const warmNeutralEvidence = alternatives.find((c) => warmNeutralSet.has(c) || c === "brown" || c === "camel");
  const noisyNeutralEvidence = alternatives.some((c) => ["black", "charcoal", "gray", "silver", "multicolor"].includes(c));

  // Warm taupe/brown leather can be over-mapped to burgundy when shadows raise
  // the red channel. If the same crop also contains warm-neutral evidence, keep
  // retrieval in the neutral/brown family instead of hard-gating to red.
  if (
    (isBottomLike || isTopLike || isOnePieceLike || category === "footwear") &&
    primary === "burgundy" &&
    warmNeutralEvidence &&
    noisyNeutralEvidence
  ) {
    return warmNeutralEvidence;
  }

  // One-piece garments frequently include background/sky bleed in upper regions.
  // Keep a confident light-neutral primary color for dresses/jumpsuits.
  if (isOnePieceLike && primaryIsLightNeutral && confidence >= 0.55) {
    return primary;
  }

  // For tops, studio/product-collage backgrounds frequently dominate the crop with white/off-white.
  // If we still captured a non-neutral secondary color, prefer it only when confidence
  // is not already strong; otherwise keep the stable primary and let caption signals refine.
  if (isTopLike && primaryIsLightNeutral && alternatives.length > 0) {
    // Silver means white/light top in shadow — prefer the actual white/off-white sibling if present
    // before hunting for a chromatic alt (which may be a background bleed).
    if (primary === "silver") {
      const lightAlt = alternatives.find((c) => lightNeutralSet.has(c));
      if (lightAlt) return lightAlt;
    }
    const chromaticAlt = alternatives.find((c) => !isNeutralFashionColor(c));
    if (chromaticAlt && mediumConfidence) return chromaticAlt;
    const warmNeutralAlt = alternatives.find((c) => warmNeutralSet.has(c));
    if (warmNeutralAlt && lowConfidence) return warmNeutralAlt;
  }
  // Bottom crops often include dark shadows/background and default to black.
  // Prefer a neutral/chromatic alternative when available to reduce false-black bias.
  if (isBottomLike && primary === "black" && alternatives.length > 0) {
    const preferredNeutralAlt = alternatives.find((c) =>
      ["gray", "charcoal", "navy", "beige", "tan", "white", "off-white", "cream"].includes(c),
    );
    if (preferredNeutralAlt) return preferredNeutralAlt;
    const chromaticAlt = alternatives.find((c) => !isNeutralFashionColor(c));
    if (chromaticAlt) return chromaticAlt;
  }
  // Bottoms in bright/light scenes are often misread as gray due shadows/denim bleed.
  // If we have a plausible light-neutral alternative, prefer it over gray/charcoal.
  if (
    isBottomLike &&
    (primary === "gray" || primary === "charcoal") &&
    alternatives.length > 0 &&
    confidence < 0.9
  ) {
    const lightAlt = alternatives.find((c) => lightNeutralSet.has(c) || warmNeutralSet.has(c));
    if (lightAlt) return lightAlt;
  }
  // Light-colored bottoms (white skirts, cream trousers) photographed in shadow K-means to "silver".
  // Prefer the true white/off-white sibling before silver gets converted to gray downstream.
  if (isBottomLike && primary === "silver" && alternatives.length > 0 && confidence < 0.9) {
    const lightAlt = alternatives.find((c) => lightNeutralSet.has(c));
    if (lightAlt) return lightAlt;
  }

  if (mediumConfidence && primary === "black" && alternatives.length > 0) {
    if (category === "footwear") {
      const preferred = alternatives.find((c) =>
        ["black", "charcoal", "gray", "navy", "brown", "beige", "tan", "white", "off-white"].includes(c),
      );
      if (preferred) return preferred;
    }

    if (isBottomLike) {
      const preferred = alternatives.find((c) =>
        ["gray", "charcoal", "navy", "beige", "tan", "white", "off-white", "cream"].includes(c),
      );
      if (preferred) return preferred;
    }

    if (isTopLike) {
      const preferred = alternatives.find((c) => !isNeutralFashionColor(c) || c === "gray" || c === "off-white");
      if (preferred) return preferred;
    }
  }

  if (lowConfidence && alternatives.length > 0) {
    if (category === "footwear" && primary === "black") {
      const preferred = alternatives.find((c) => !isLightNeutralFashionColor(c) || c === "gray" || c === "charcoal");
      if (preferred) return preferred;
    }

    if (isBottomLike && primary === "black") {
      const preferred = alternatives.find((c) => ["gray", "charcoal", "navy", "beige", "tan", "white", "off-white", "cream"].includes(c));
      if (preferred) return preferred;
    }

    if (isTopLike) {
      const preferred = alternatives.find((c) => !isNeutralFashionColor(c));
      if (preferred) return preferred;
    }

    if (isNeutralFashionColor(primary)) {
      const preferred = alternatives.find((c) => !isNeutralFashionColor(c));
      if (preferred) return preferred;
    }
  }

  // Footwear can pick up blue floor/sky reflections around white shoes.
  // Prefer light-neutral shoe body colors when available.
  if (category === "footwear" && alternatives.length > 0 && confidence < 0.9) {
    const blueLikePrimary = ["blue", "light-blue", "sky-blue", "powder-blue", "cyan", "teal"].includes(primary);
    if (blueLikePrimary) {
      const lightNeutralAlt = alternatives.find((c) => lightNeutralSet.has(c));
      if (lightNeutralAlt) return lightNeutralAlt;
    }
    // White shoes in shadow map to "silver" (LAB L=60-78) by K-means.
    // Prefer white/off-white alternatives when available rather than reporting silver.
    if (primary === "silver") {
      const lightNeutralAlt = alternatives.find((c) => lightNeutralSet.has(c) && c !== "silver");
      if (lightNeutralAlt) return lightNeutralAlt;
    }
  }

  // Footwear shadows frequently push brown leather toward charcoal/black.
  // If palette contains a warm-neutral sibling, prefer it unless confidence is very high.
  if (
    category === "footwear" &&
    alternatives.length > 0 &&
    confidence < 0.9 &&
    (primary === "black" || primary === "charcoal" || primary === "gray")
  ) {
    const warmNeutralAlt = alternatives.find((c) =>
      ["brown", "camel", "tan", "beige", "khaki", "taupe", "stone", "sand"].includes(c),
    );
    if (warmNeutralAlt) return warmNeutralAlt;
  }

  return primary;
}

function adjustStripedTopColorInference(params: {
  selectedColor: string | null | undefined;
  cropColors: string[];
  productCategory: string;
  detectionLabel: string;
  fullCaption?: string | null;
}): string | null {
  const category = String(params.productCategory ?? "").toLowerCase().trim();
  const label = String(params.detectionLabel ?? "").toLowerCase().trim();
  const caption = String(params.fullCaption ?? "").toLowerCase();
  const isTopLike =
    category === "tops" ||
    /\b(top|shirt|blouse|tee|t-?shirt|sweater|hoodie|sweatshirt|tank|camisole)\b/.test(label);
  if (!isTopLike) return params.selectedColor ?? null;
  const stripedCue =
    /\b(striped?|stripes?|pinstripe|pin-striped|line pattern|lined shirt)\b/.test(caption) ||
    /\b(striped?|pinstripe)\b/.test(label);
  const warmNeutralCaptionCue =
    /\b(tan|beige|camel|khaki|sand|stone|taupe)\b/.test(caption) &&
    /\b(top|shirt|polo|tee|t-?shirt|blouse)\b/.test(caption);
  const warmNeutralSet = new Set(["beige", "tan", "camel", "taupe", "stone", "sand", "khaki", "nude"]);
  const colors = (params.cropColors ?? [])
    .map((c) => String(c ?? "").toLowerCase().trim())
    .filter(Boolean);
  if (warmNeutralCaptionCue) {
    const warmChoice = colors.find((c) => warmNeutralSet.has(c));
    if (warmChoice) return warmChoice;
  }
  if (!stripedCue) return params.selectedColor ?? null;
  const hasBlueFamily = colors.some((c) => ["blue", "navy", "sky-blue", "light-blue", "cobalt"].includes(c));
  if (hasBlueFamily) {
    const blueChoice = colors.find((c) => ["blue", "navy", "light-blue", "sky-blue", "cobalt"].includes(c));
    if (blueChoice) return blueChoice;
  }

  const selected = String(params.selectedColor ?? "").toLowerCase().trim();
  const darkNeutral = new Set(["black", "charcoal", "gray", "silver"]);
  const hasLightNeutral = colors.some((c) => ["white", "off-white", "cream", "ivory"].includes(c));
  // For striped tops, a dark-neutral-only inference is usually wrong (white+blue stripes collapse to gray/black).
  // Returning null keeps main-path retrieval visual-first instead of over-gating by wrong inferred color.
  if (darkNeutral.has(selected) && !hasBlueFamily && !hasLightNeutral) return null;
  return params.selectedColor ?? null;
}

function lowQualityDetectionFallbackEnabled(): boolean {
  const raw = String(process.env.SEARCH_IMAGE_LOW_QUALITY_MULTICROP ?? "1").toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off" && raw !== "no";
}

function lowQualityDetectionConfidenceThreshold(): number {
  const raw = Number(process.env.SEARCH_IMAGE_LOW_QUALITY_CONFIDENCE_MAX ?? "0.74");
  if (!Number.isFinite(raw)) return 0.74;
  return Math.max(0.2, Math.min(0.95, raw));
}

function lowQualityDetectionAreaRatioThreshold(): number {
  const raw = Number(process.env.SEARCH_IMAGE_LOW_QUALITY_AREA_RATIO_MAX ?? "0.035");
  if (!Number.isFinite(raw)) return 0.035;
  return Math.max(0.001, Math.min(0.2, raw));
}

function shouldUseLowQualityMultiCropFallback(detection: Detection): boolean {
  if (!lowQualityDetectionFallbackEnabled()) return false;
  const conf = Number.isFinite(detection.confidence) ? Number(detection.confidence) : 0;
  const area = Number.isFinite(detection.area_ratio) ? Number(detection.area_ratio) : 0;
  return conf <= lowQualityDetectionConfidenceThreshold() || area <= lowQualityDetectionAreaRatioThreshold();
}

function expandDetectionBox(
  box: BoundingBox,
  imageWidth: number,
  imageHeight: number,
  ratio: number,
): BoundingBox {
  const iw = Math.max(1, imageWidth);
  const ih = Math.max(1, imageHeight);
  const bw = Math.max(1, box.x2 - box.x1);
  const bh = Math.max(1, box.y2 - box.y1);
  const padX = bw * ratio;
  const padY = bh * ratio;
  return {
    x1: Math.max(0, box.x1 - padX),
    y1: Math.max(0, box.y1 - padY),
    x2: Math.min(iw, box.x2 + padX),
    y2: Math.min(ih, box.y2 + padY),
  };
}

function mergeImageSearchResultsById(
  primary: ProductResult[],
  extra: ProductResult[],
  limit: number,
): ProductResult[] {
  const byId = new Map<string, ProductResult>();
  for (const p of primary) {
    byId.set(String((p as any).id), p);
  }
  for (const p of extra) {
    const id = String((p as any).id);
    const cur = byId.get(id);
    if (!cur) {
      byId.set(id, p);
      continue;
    }
    const curSim = Number((cur as any).similarity_score ?? 0);
    const nxtSim = Number((p as any).similarity_score ?? 0);
    const curRel = Number((cur as any).finalRelevance01 ?? 0);
    const nxtRel = Number((p as any).finalRelevance01 ?? 0);
    if (nxtSim > curSim + 1e-6 || (Math.abs(nxtSim - curSim) <= 1e-6 && nxtRel > curRel + 1e-6)) {
      byId.set(id, p);
    }
  }
  return [...byId.values()]
    .sort((a: any, b: any) => {
      const bs = Number(b?.similarity_score ?? 0);
      const as = Number(a?.similarity_score ?? 0);
      if (Math.abs(bs - as) > 1e-6) return bs - as;
      return Number(b?.finalRelevance01 ?? 0) - Number(a?.finalRelevance01 ?? 0);
    })
    .slice(0, Math.max(1, limit));
}

/**
 * Run async work on `items` with at most `limit` concurrent executions; per-slot errors become rejected settled results.
 */
async function mapPoolSettled<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (; ;) {
      const i = next++;
      if (i >= items.length) return;
      try {
        const value = await fn(items[i], i);
        results[i] = { status: "fulfilled", value };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  }
  const n = Math.min(Math.max(1, limit), Math.max(1, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}
/**
 * Single full-frame pseudo-detection when YOLO is down or returns nothing.
 * Keeps `detection` non-null for clients while `similarProducts.byDetection` uses the same geometry.
 */
function syntheticFullImageDetectionBlock(
  imageWidth: number,
  imageHeight: number,
): {
  items: Detection[];
  count: number;
  summary: Record<string, number>;
  composition: OutfitComposition;
} {
  const w = Math.max(0, imageWidth);
  const h = Math.max(0, imageHeight);
  const box: BoundingBox = { x1: 0, y1: 0, x2: w, y2: h };
  const box_normalized: BoundingBox =
    w > 0 && h > 0
      ? { x1: 0, y1: 0, x2: 1, y2: 1 }
      : { x1: 0, y1: 0, x2: 0, y2: 0 };
  const item: Detection = {
    label: "full_image",
    raw_label: "full_image",
    confidence: 1,
    box,
    box_normalized,
    area_ratio: 1,
  };
  return {
    items: [item],
    count: 1,
    summary: { full_image: 1 },
    composition: extractOutfitComposition([item]),
  };
}

// ============================================================================
// Types
// ============================================================================

export interface ImageAnalysisResult {
  /** Basic image info */
  image: {
    id: number;
    url: string;
    width: number;
    height: number;
    pHash: string | null;
  };

  /** CLIP embedding for similarity search (512 or 768 dimensions) */
  embedding: number[] | null;

  /** BLIP caption text (when computed; used for audience inference). */
  blipCaption?: string | null;

  /** Audience inference derived from BLIP caption. */
  inferredAudience?: { gender?: string; ageGroup?: string } | null;

  /** Dominant color inference derived from image (canonical token). */
  inferredPrimaryColor?: string | null;
  /** Detection-driven item colors keyed by YOLO label/index (e.g. "short_sleeve_dress_0"). */
  inferredColorsByItem?: Record<string, string | null> | null;
  /** Confidence of chosen per-item color after BLIP vs crop fusion (0..1). */
  inferredColorsByItemConfidence?: Record<string, number> | null;
  /** Source of selected per-item color (full_caption | crop | caption | unknown). */
  inferredColorsByItemSource?: Record<string, string> | null;

  /** Fashion detection results */
  detection: {
    items: Detection[];
    count: number;
    summary: Record<string, number>;
    composition: OutfitComposition;
  } | null;

  /** Service availability */
  services: {
    clip: boolean;
    yolo: boolean;
    blip: boolean;
    /** Set when `yolo` is false — why detection is off and how to fix it locally */
    yoloHint?: string;
  };

  /** Timing breakdown for the image-search pipeline. */
  timings?: ImagePipelineTimings;
}

export interface ImageAnalysisStageTimings {
  totalMs: number;
  validateMs?: number;
  serviceStatusMs?: number;
  metadataMs?: number;
  pHashMs?: number;
  storageMs?: number;
  clipEmbeddingMs?: number;
  yoloInitialMs?: number;
  yoloRetryMs?: number;
  accessoryRecoveryMs?: number;
  deferredFullFrameEmbeddingMs?: number;
  postProcessMs?: number;
  detectionPersistQueueMs?: number;
}

export interface ImageSimilarityStageTimings {
  totalMs: number;
  fullCaptionMs?: number;
  detectionSetupMs?: number;
  detectionTaskWallMs?: number;
  detectionTaskTotalMs?: number;
  detectionTaskAvgMs?: number;
  detectionTaskMaxMs?: number;
  detectionCropEmbedAvgMs?: number;
  detectionCropEmbedMaxMs?: number;
  detectionBlipAvgMs?: number;
  detectionBlipMaxMs?: number;
  detectionSearchFirstAvgMs?: number;
  detectionSearchFirstMaxMs?: number;
  detectionSearchTotalAvgMs?: number;
  detectionSearchTotalMaxMs?: number;
  detectionSearchCallsAvg?: number;
  detectionSearchCallsMax?: number;
  postProcessingMs?: number;
}

export interface ImagePipelineTimings {
  totalMs: number;
  analysis?: ImageAnalysisStageTimings;
  similarity?: ImageSimilarityStageTimings;
}

function detectionColorKey(label: string, index?: number): string {
  const base = String(label || "item")
    .toLowerCase()
    .replace(/\bout\s*wear\b/g, "outerwear")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "item";
  return Number.isFinite(index as number) ? `${base}_${index}` : base;
}

function detectionColorSourceName(sourcePriority: number | null | undefined): string {
  const p = Number(sourcePriority ?? -1);
  if (p === 0) return "full_caption";
  if (p === 1) return "crop";
  if (p >= 2) return "caption";
  return "unknown";
}

function estimateCropColorConfidence(detection: Detection): number {
  const detConf = clamp01(Number(detection.confidence ?? 0));
  const area = Math.max(0, Number(detection.area_ratio ?? 0));
  const areaSignal = clamp01(Math.min(1, area / 0.2));
  // Crop color is strong when detection is confident and reasonably sized.
  return clamp01(0.35 + 0.45 * detConf + 0.2 * areaSignal);
}

function isBlueLikeColor(color: string): boolean {
  const c = String(color || "").toLowerCase().trim();
  return (
    c === "blue" ||
    c === "light-blue" ||
    c === "sky-blue" ||
    c === "powder-blue" ||
    c === "cyan" ||
    c === "teal" ||
    c === "navy"
  );
}

function isWarmNeutralColor(color: string): boolean {
  const c = String(color || "").toLowerCase().trim();
  return (
    c === "beige" ||
    c === "tan" ||
    c === "camel" ||
    c === "taupe" ||
    c === "stone" ||
    c === "sand" ||
    c === "khaki" ||
    c === "nude" ||
    c === "brown"
  );
}

function colorFamilyBucket(color: string): string {
  const c = canonicalizeColorIntentToken(color);
  if (!c) return "";
  if (c === "multicolor") return "multicolor";
  if (isNeutralFashionColor(c)) return "neutral";
  if (c === "red" || c === "pink" || c === "orange" || c === "yellow" || c === "gold") return "warm";
  if (c === "blue" || c === "green" || c === "teal" || c === "purple") return "cool";
  return c;
}

function setDetectionColorIfHigherConfidence(
  colorByItem: Record<string, string | null>,
  confByItem: Record<string, number>,
  sourceByItem: Record<string, number>,
  key: string,
  color: string | null | undefined,
  confidence: number,
  sourcePriority: number,
  context?: {
    productCategory?: string;
    detectionLabel?: string;
  },
): void {
  const rawColor = String(color ?? "").toLowerCase().trim();
  const category = String(context?.productCategory ?? "").toLowerCase().trim();
  const detectionLabel = String(context?.detectionLabel ?? "").toLowerCase().trim();
  const apparelLikeCategory =
    category === "tops" ||
    category === "bottoms" ||
    category === "dresses" ||
    category === "outerwear";
  const apparelLikeLabel =
    /\b(top|tops|shirt|shirts|tee|t-?shirt|blouse|blouses|sweater|hoodie|cardigan|jacket|coat|blazer|trouser|trousers|pant|pants|jean|jeans|skirt|skirts|dress|dresses)\b/.test(
      detectionLabel,
    );
  const c = rawColor === "silver" && (apparelLikeCategory || apparelLikeLabel) ? "gray" : rawColor;
  if (!c) return;
  const nextConf = clamp01(confidence);
  const prevConf = clamp01(Number(confByItem[key] ?? 0));
  const nextPriority = Math.max(0, Math.floor(sourcePriority));
  const prevPriority = Math.max(0, Math.floor(Number(sourceByItem[key] ?? 0)));
  const prevColor = String(colorByItem[key] ?? "").toLowerCase().trim();
  const incomingDifferent = prevColor.length > 0 && prevColor !== c;
  const confidenceGap = nextConf - prevConf;
  const incomingFromCaption = nextPriority >= 2;

  if (incomingDifferent) {
    // Conflict guard: avoid unstable color flips when we already have a strong slot-local signal.
    const hasStrongExisting = prevConf >= 0.78;
    const prevBucket = colorFamilyBucket(prevColor);
    const nextBucket = colorFamilyBucket(c);
    const crossFamilyConflict =
      prevBucket.length > 0 &&
      nextBucket.length > 0 &&
      prevBucket !== nextBucket;
    const apparelLike =
      apparelLikeCategory ||
      /\b(top|tops|shirt|shirts|blouse|blouses|tee|t-?shirt|sweater|hoodie|cardigan|jacket|coat|blazer|trouser|trousers|pant|pants|jean|jeans|skirt|skirts|dress|dresses)\b/.test(
        key,
      );
    const footwearLike = category === "footwear" || /\b(shoe|shoes|sneaker|sneakers|boot|boots|heel|heels|sandal|sandals|loafer|loafers|trainer|trainers|flat|flats)\b/.test(key);

    // Global rule (all colors): do not switch a strong existing color to a different
    // family unless the incoming signal is clearly stronger.
    if (!incomingFromCaption && hasStrongExisting && crossFamilyConflict && confidenceGap < 0.2) {
      return;
    }

    // Do not let caption/global signals replace strong warm/chromatic apparel colors with light-neutral.
    if (
      !incomingFromCaption &&
      apparelLike &&
      hasStrongExisting &&
      nextPriority > prevPriority &&
      isLightNeutralFashionColor(c) &&
      (isWarmNeutralColor(prevColor) || isChromaticFashionColor(prevColor)) &&
      confidenceGap < 0.18
    ) {
      return;
    }

    // Do not let blue reflections replace strong light-neutral footwear color.
    if (
      !incomingFromCaption &&
      footwearLike &&
      hasStrongExisting &&
      nextPriority > prevPriority &&
      isBlueLikeColor(c) &&
      isLightNeutralFashionColor(prevColor) &&
      confidenceGap < 0.2
    ) {
      return;
    }

    // Do not accept blue-like colors from crop as the FIRST color for a footwear slot.
    // Shoes photographed against blue backgrounds or cropped with denim overflow frequently
    // receive spurious "light-blue" from k-means. Caption confirmation is required to trust
    // a chromatic blue on footwear when the slot has no prior signal.
    if (
      !incomingFromCaption &&
      footwearLike &&
      isBlueLikeColor(c) &&
      !prevColor
    ) {
      return;
    }

    // Do not let dark-neutral variants (charcoal, dark-gray) from crop/detection-caption
    // override canonical "black" from the full-image caption for any slot.
    // Camera exposure and warm lighting frequently render black garments as charcoal — both
    // map to the same color family and "black" is the more canonical representation.
    if (
      prevColor === "black" &&
      (c === "charcoal" || c === "dark-gray" || c === "dark-grey") &&
      prevConf >= 0.50
    ) {
      return;
    }

    // Do not let a caption's generic parent color ("blue") override a crop-detected subspecies
    // ("light-blue") — the crop is the more reliable signal for hue precision.
    const subspeciesDowngrade =
      incomingFromCaption &&
      prevColor === "light-blue" &&
      c === "blue" &&
      prevConf >= 0.45;
    if (subspeciesDowngrade) {
      return;
    }
  }

  if (!(key in colorByItem) || nextPriority > prevPriority || (nextPriority === prevPriority && nextConf >= prevConf)) {
    colorByItem[key] = c;
    confByItem[key] = nextConf;
    sourceByItem[key] = nextPriority;
  }
}

export interface AnalyzeOptions {
  /** Store image in R2 (default: true) */
  store?: boolean;

  /** Generate CLIP embedding (default: true) */
  generateEmbedding?: boolean;

  /** Run YOLO detection (default: true) */
  runDetection?: boolean;

  /**
   * When true with YOLO enabled: skip full-frame CLIP in the initial parallel phase if YOLO may return crops.
   * Full-frame embedding is computed only when there are zero detections (shop-the-look latency).
   */
  deferFullImageEmbedding?: boolean;

  /** Detection confidence threshold (default: 0.45 — balances recall vs noise) */
  confidence?: number;

  /** Optional image preprocessing passed to YOLO detection. */
  preprocessing?: {
    enhanceContrast?: boolean;
    enhanceSharpness?: boolean;
    bilateralFilter?: boolean;
  };

  /** Product ID to associate image with */
  productId?: number;

  /** Mark as primary image for product */
  isPrimary?: boolean;

  /** Optional session context for inherited conversational filters. */
  sessionId?: string;
  /** Optional authenticated user for personalization boosts. */
  userId?: number;
  /** Optional precomputed session filters to merge into image search. */
  sessionFilters?: Record<string, unknown> | null;
}

export interface QuickDetectResult {
  success: boolean;
  items: Detection[];
  count: number;
  summary: Record<string, number>;
  composition: OutfitComposition;
  imageSize: { width: number; height: number };
}

export interface SimilarProductsResult {
  products: ProductResult[];
  total: number;
  threshold: number;
  detectedCategories: string[];
}

/** Similar products for a single detected item */
export interface DetectionSearchDebug {
  knnCandidateCount: number;
  afterPrecisionGuard: number;
  afterCategoryGuard: number;
  afterSleeveGuard: number;
  afterFormalityFilter: number;
  afterAthleticGuard: number;
  afterRecovery: number;
  searchCallsUsed?: number;
  searchCallLimit?: number;
  searchReasonsExecuted?: string[];
  searchReasonsSkipped?: string[];
  droppedByOtherGates: number;
  droppedByFinalRelevance: number;
  droppedByColorGate: number;
}

export interface DetectionSimilarProducts {
  /** The detected item */
  detection: {
    label: string;
    confidence: number;
    box: { x1: number; y1: number; x2: number; y2: number };
    area_ratio: number;
    style?: { occasion?: string; aesthetic?: string; formality?: number };
    mask?: SegmentationMask;
  };
  /** Mapped product category */
  category: string;
  /** Similar products for this detection */
  products: ProductResult[];
  /** Number of similar products found */
  count: number;
  /** Number of similar products before pagination is applied. */
  totalAvailable?: number;
  /** Per-detection pagination metadata. */
  pagination?: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
  /** Index into `detection.items` for this row (when multiple instances share a label). */
  detectionIndex?: number;

  /**
   * Debug: which inferred attributes were applied to the OpenSearch search.
   * Helps validate that `color` / `style` / `gender` are actually affecting retrieval.
   */
  appliedFilters?: Partial<import("./types").SearchFilters>;
  /** Temporary stage-by-stage drop counters for search debugging. */
  debug?: DetectionSearchDebug;
}

/** Grouped similar products by detection */
export interface GroupedSimilarProducts {
  /** Similar products grouped by each detected item */
  byDetection: DetectionSimilarProducts[];
  /** Total products across all detections */
  totalProducts: number;
  /** Total products across all detections before pagination is applied. */
  totalAvailableProducts?: number;
  /** Similarity threshold used */
  threshold: number;
  /** All detected categories */
  detectedCategories: string[];
  /**
   * Shop-the-look coverage: how many detections yielded at least one product vs total detection jobs.
   * Coherence should be read together with `coverageRatio` (see `outfitCoherence`).
   */
  shopTheLookStats?: {
    totalDetections: number;
    coveredDetections: number;
    emptyDetections: number;
    coverageRatio: number;
    mainPathOnly?: boolean;
  };
  /** Pagination settings applied to each detection group. */
  pagination?: {
    mode: "per_detection";
    page: number;
    pageSize: number;
  };
}

export interface AnalyzeAndFindSimilarOptions extends AnalyzeOptions {
  /** Find similar products after analysis (default: true) */
  findSimilar?: boolean;

  /** Similarity threshold 0-1 (default: CLIP_IMAGE_SIMILARITY_THRESHOLD / config) */
  similarityThreshold?: number;

  /** Max similar products per detection (default from SEARCH_IMAGE_SHOP_LIMIT_PER_DETECTION or 22) */
  similarLimitPerItem?: number;

  /** Per-detection result page number (1-based, default: 1). */
  resultsPage?: number;

  /** Per-detection page size (default: similarLimitPerItem). */
  resultsPageSize?: number;

  /** Filter similar products by detected category */
  filterByDetectedCategory?: boolean;

  /**
   * When true: one similar-product group per YOLO detection instance (same label allowed twice).
   * Default is false.
   * When false: merge same-label boxes only when IoU ≥ `YOLO_SHOP_DEDUPE_IOU_THRESHOLD` (default 0.5); spatially separate instances stay separate.
   */
  groupByDetection?: boolean;

  /** When true, include each detection in `byDetection` even if similarity search returns no products (products may be []). */
  includeEmptyDetectionGroups?: boolean;

  /** Merge same variant family into one representative result per detection. */
  collapseVariantGroups?: boolean;
}

export interface FullAnalysisResult extends ImageAnalysisResult {
  /** Similar products grouped by detected item */
  similarProducts?: GroupedSimilarProducts;
  /** Outfit coherence analysis for detected items */
  outfitCoherence?: OutfitCoherenceResult;
}

/** User-defined bounding box for manual region selection */
export interface UserDefinedBox {
  /** Bounding box in pixel coordinates */
  box: { x1: number; y1: number; x2: number; y2: number };
  /** User-provided category hint (optional) */
  categoryHint?: string;
  /** User-provided label for this region */
  label?: string;
}

/** Options for selective item processing */
export interface SelectiveAnalysisOptions extends AnalyzeAndFindSimilarOptions {
  /** Process only items at these indices (from detection.items array) */
  selectedItemIndices?: number[];
  /** Exclude items at these indices from processing */
  excludedItemIndices?: number[];
  /** User-defined bounding boxes to analyze (in addition to YOLO detections) */
  userDefinedBoxes?: UserDefinedBox[];
  /** Enable preprocessing for cluttered backgrounds */
  preprocessing?: {
    enhanceContrast?: boolean;
    enhanceSharpness?: boolean;
    bilateralFilter?: boolean;
  };
}

/** Detection result with source indicator */
export interface SelectiveDetectionResult extends DetectionSimilarProducts {
  /** Source of this detection */
  source: "yolo" | "user_defined";
  /** Original detection index (for YOLO detections) */
  originalIndex?: number;
}

// ============================================================================
// Service Class
// ============================================================================

export class ImageAnalysisService {
  private yoloClient: YOLOv8Client;

  constructor() {
    this.yoloClient = getYOLOv8Client();
  }

  /**
   * Check which services are available
   */
  async getServiceStatus(): Promise<{
    clip: boolean;
    yolo: boolean;
    blip: boolean;
    yoloHint?: string;
  }> {
    const [clipAvailable, yoloSnap] = await Promise.all([
      Promise.resolve(isClipAvailable()),
      this.yoloClient.getHealthSnapshot().catch(() => ({
        available: false as const,
        hint: "YOLO health check failed unexpectedly.",
      })),
    ]);

    const yoloAvailable = yoloSnap.available;
    const yoloHint = !yoloAvailable && yoloSnap.hint ? yoloSnap.hint : undefined;

    return {
      clip: clipAvailable,
      yolo: yoloAvailable,
      blip: true,
      ...(yoloHint ? { yoloHint } : {}),
    };
  }

  /**
   * Full image analysis pipeline
   *
   * This is the recommended method for initial image uploads.
   * It provides storage, embeddings, and detection in one call.
   */
  async analyzeImage(
    buffer: Buffer,
    filename: string,
    options: AnalyzeOptions = {}
  ): Promise<ImageAnalysisResult> {
    const analysisStartedAt = performance.now();
    const analysisTimings: ImageAnalysisStageTimings = { totalMs: 0 };
    const {
      store = true,
      generateEmbedding = true,
      runDetection = true,
      deferFullImageEmbedding = false,
      confidence = 0.45,
      preprocessing,
      productId,
      isPrimary = false,
    } = options;

    // Validate image first
    const validateStartedAt = performance.now();
    const validation = await validateImage(buffer);
    analysisTimings.validateMs = performance.now() - validateStartedAt;
    if (!validation.valid) {
      throw new Error(validation.error || "Invalid image");
    }

    // Check service availability
    const serviceStatusStartedAt = performance.now();
    const services = await this.getServiceStatus();
    analysisTimings.serviceStatusMs = performance.now() - serviceStatusStartedAt;

    // Get image metadata first
    const metadataStartedAt = performance.now();
    const metadata = await sharp(buffer).metadata();
    analysisTimings.metadataMs = performance.now() - metadataStartedAt;
    const imageWidth = metadata.width || 0;
    const imageHeight = metadata.height || 0;
    const pHashStartedAt = performance.now();
    const pHash = await computePHash(buffer);
    analysisTimings.pHashMs = performance.now() - pHashStartedAt;

    const deferClip =
      deferFullImageEmbedding &&
      generateEmbedding &&
      services.clip &&
      runDetection &&
      services.yolo;

    // Run operations in parallel where possible
    const storagePromise = store
      ? (async () => {
        const startedAt = performance.now();
        try {
          return await this.storeImage(buffer, filename, productId, isPrimary, pHash);
        } finally {
          analysisTimings.storageMs = performance.now() - startedAt;
        }
      })()
      : Promise.resolve(null);

    const embeddingPromise = generateEmbedding && services.clip && !deferClip
      ? (async () => {
        const startedAt = performance.now();
        try {
          return await processImageForEmbedding(buffer);
        } catch (err) {
          console.error("CLIP embedding failed:", err);
          return null;
        } finally {
          analysisTimings.clipEmbeddingMs = performance.now() - startedAt;
        }
      })()
      : Promise.resolve(null);

    // Speculatively start accessory recovery in parallel with the initial detection.
    // Accessory recovery needs a low-confidence pass with preprocessing — it is independent
    // of the initial detection's confidence/preprocessing settings, so it can overlap fully.
    // The result is consumed only when shouldRunAccessoryRecovery evaluates true; otherwise
    // the promise resolves and is discarded. Saves ~accessoryRecoveryMs from the critical path.
    const accessorySpeculativePromise: Promise<Awaited<ReturnType<typeof this.yoloClient.detectFromBuffer>> | null> =
      runDetection && services.yolo
        ? this.yoloClient.detectFromBuffer(buffer, filename, {
            confidence: accessoryRecoveryConfidenceThreshold(),
            preprocessing: { enhanceContrast: true, enhanceSharpness: true, bilateralFilter: true },
          }).catch(() => null)
        : Promise.resolve(null);

    const detectionPromise = runDetection && services.yolo
      ? (async () => {
        const startedAt = performance.now();
        try {
          return await this.yoloClient.detectFromBuffer(buffer, filename, { confidence, preprocessing });
        } catch (err) {
          if (isYoloCircuitOpenError(err)) {
            console.warn("[YOLOv8] circuit open, detection skipped:", err instanceof Error ? err.message : String(err));
          } else {
            const name = (err as any)?.name;
            const msg = err instanceof Error ? err.message : String(err);
            if (name === "TimeoutError" || /timeout/i.test(msg)) {
              services.yoloHint =
                `YOLO request timed out while waiting for detections. ` +
                `Try increasing YOLO_DETECT_TIMEOUT_MS (current: ${process.env.YOLO_DETECT_TIMEOUT_MS || "default"}). ` +
                `Falling back to full_image search.`;
            }
            console.error("YOLO detection failed:", err);
          }
          return null;
        } finally {
          analysisTimings.yoloInitialMs = performance.now() - startedAt;
        }
      })()
      : Promise.resolve(null);

    const [storageResult, embeddingResult, initialDetectionResult] = await Promise.all([
      storagePromise,
      embeddingPromise,
      detectionPromise,
    ]);

    let detectionResult = initialDetectionResult;

    // If YOLO runs but returns no items, retry with a more permissive threshold.
    // This addresses cases where the provided confidence is slightly too strict
    // for the specific lighting/background of the uploaded image.
    if (
      runDetection &&
      services.yolo &&
      detectionResult &&
      Array.isArray(detectionResult.detections) &&
      detectionResult.detections.length === 0 &&
      confidence > 0
    ) {
      const retryConfidence = Math.max(0.05, confidence * 0.6);
      let didRetryFindDetections = false;
      const retryStartedAt = performance.now();
      try {
        const retry = await this.yoloClient.detectFromBuffer(buffer, filename, {
          confidence: retryConfidence,
          preprocessing: {
            enhanceContrast: preprocessing?.enhanceContrast ?? true,
            enhanceSharpness: preprocessing?.enhanceSharpness ?? true,
            bilateralFilter: preprocessing?.bilateralFilter ?? true,
          },
        });

        if (retry?.detections?.length) {
          detectionResult = retry;
          didRetryFindDetections = true;
          services.yoloHint = `YOLO returned 0 detections at confidence=${confidence}; retried at confidence=${retryConfidence} with preprocessing`;
        }
      } catch (err) {
        console.warn("[YOLOv8] retry-on-empty failed:", err);
      } finally {
        analysisTimings.yoloRetryMs = performance.now() - retryStartedAt;
      }

      if (!didRetryFindDetections) {
        services.yoloHint = `YOLO returned 0 detections at confidence=${confidence}; retry at confidence=${retryConfidence} with preprocessing also returned 0`;
      }
    }

    if (
      detectionResult &&
      Array.isArray(detectionResult.detections) &&
      detectionResult.detections.length > 0
    ) {
      const allDets = detectionResult.detections;
      const filteredDetections = allDets.filter((d) => shouldKeepDetectionForShopTheLook(d, allDets));
      if (filteredDetections.length !== detectionResult.detections.length) {
        detectionResult = {
          ...detectionResult,
          detections: filteredDetections,
          count: filteredDetections.length,
          summary: summarizeDetectionsByLabel(filteredDetections),
        };
      }

      const initialBagDetections = detectionResult.detections.filter((detection) => isMappedBagDetection(detection));
      const shouldRunAccessoryRecovery =
        initialBagDetections.length === 0 ||
        initialBagDetections.every((detection) => Number(detection.confidence ?? 0) < 0.78);

      if (shouldRunAccessoryRecovery && services.yolo) {
        const accessoryRecoveryStartedAt = performance.now();
        try {
          // Collect from the speculative promise started in parallel with initial detection.
          const accessoryRetry = await accessorySpeculativePromise;

          const accessoryDetections = (accessoryRetry?.detections ?? []).filter((detection) =>
            shouldKeepAccessoryRecoveryDetection(detection),
          );

          if (accessoryDetections.length > 0) {
            const mergedDetectionsRaw = dedupeDetectionsBySameLabelIou(
              [...detectionResult.detections, ...accessoryDetections],
              yoloShopDedupeIouThreshold(),
            ).map((row) => row.detection);

            const mergedDetections = mergedDetectionsRaw
              .filter((d) => shouldKeepDetectionForShopTheLook(d, mergedDetectionsRaw))
              .map((d) => ensureStyleAndMask(d, imageWidth, imageHeight));

            detectionResult = {
              ...detectionResult,
              detections: mergedDetections,
              count: mergedDetections.length,
              summary: summarizeDetectionsByLabel(mergedDetections),
            };
          }
        } catch (err) {
          console.warn("[YOLOv8] accessory recovery retry failed:", err);
        } finally {
          analysisTimings.accessoryRecoveryMs = performance.now() - accessoryRecoveryStartedAt;
        }
      }

      // Ensure clients always receive `style` + `mask` (YOLO service returns them as null currently).
      const postProcessStartedAt = performance.now();
      detectionResult = {
        ...detectionResult,
        detections: detectionResult.detections
          .map((d) => correctDetectionByPosition(d))
          .map((d) => ensureStyleAndMask(d, imageWidth, imageHeight)),
      };
      analysisTimings.postProcessMs = performance.now() - postProcessStartedAt;
    }

    let embeddingFinal = embeddingResult;
    if (deferClip && generateEmbedding && services.clip) {
      const hasDetections =
        detectionResult &&
        Array.isArray(detectionResult.detections) &&
        detectionResult.detections.length > 0;
      if (!hasDetections) {
        const deferredClipStartedAt = performance.now();
        embeddingFinal = await processImageForEmbedding(buffer).catch((err) => {
          console.error("CLIP embedding failed (deferred full-frame):", err);
          return null;
        });
        analysisTimings.deferredFullFrameEmbeddingMs = performance.now() - deferredClipStartedAt;
      }
    }

    // Build response
    const imageInfo = storageResult || {
      id: 0,
      url: "",
      width: imageWidth,
      height: imageHeight,
      pHash,
    };

    // Persist detection rows in the background so upload/search response is not blocked by DB I/O.
    const detectionPersistQueueStartedAt = performance.now();
    const productImageId = storageResult && (storageResult as any).id ? (storageResult as any).id : 0;
    if (
      productImageId &&
      detectionResult &&
      Array.isArray(detectionResult.detections) &&
      detectionResult.detections.length > 0
    ) {
      setImmediate(() => {
        void this.persistDetectionRows(productImageId, productId, detectionResult!.detections);
      });
    }
    analysisTimings.detectionPersistQueueMs = performance.now() - detectionPersistQueueStartedAt;
    analysisTimings.totalMs = performance.now() - analysisStartedAt;
    console.info("[image-analysis][latency-ms]", {
      totalMs: Number(analysisTimings.totalMs.toFixed(2)),
      validateMs: Number((analysisTimings.validateMs ?? 0).toFixed(2)),
      serviceStatusMs: Number((analysisTimings.serviceStatusMs ?? 0).toFixed(2)),
      metadataMs: Number((analysisTimings.metadataMs ?? 0).toFixed(2)),
      pHashMs: Number((analysisTimings.pHashMs ?? 0).toFixed(2)),
      storageMs: Number((analysisTimings.storageMs ?? 0).toFixed(2)),
      clipEmbeddingMs: Number((analysisTimings.clipEmbeddingMs ?? 0).toFixed(2)),
      yoloInitialMs: Number((analysisTimings.yoloInitialMs ?? 0).toFixed(2)),
      yoloRetryMs: Number((analysisTimings.yoloRetryMs ?? 0).toFixed(2)),
      accessoryRecoveryMs: Number((analysisTimings.accessoryRecoveryMs ?? 0).toFixed(2)),
      postProcessMs: Number((analysisTimings.postProcessMs ?? 0).toFixed(2)),
      deferredFullFrameEmbeddingMs: Number((analysisTimings.deferredFullFrameEmbeddingMs ?? 0).toFixed(2)),
      detectionPersistQueueMs: Number((analysisTimings.detectionPersistQueueMs ?? 0).toFixed(2)),
    });

    return {
      image: {
        ...imageInfo,
        width: imageWidth,
        height: imageHeight,
      },
      embedding: embeddingFinal,
      detection: detectionResult
        ? {
          items: detectionResult.detections,
          count: detectionResult.count,
          summary: detectionResult.summary,
          composition: extractOutfitComposition(detectionResult.detections),
        }
        : null,
      services,
      timings: {
        totalMs: analysisTimings.totalMs,
        analysis: analysisTimings,
      },
    };
  }

  /**
   * Full analysis + find similar products GROUPED BY DETECTION
   *
   * This is the complete pipeline: detect fashion items → find similar products for each.
   * Use this when a user uploads an image and wants to shop for similar items.
   * 
   * Returns similar products grouped by each detected item (e.g., similar dresses,
   * similar shoes, similar bags - all separately).
   */
  async analyzeAndFindSimilar(
    buffer: Buffer,
    filename: string,
    options: AnalyzeAndFindSimilarOptions = {}
  ): Promise<FullAnalysisResult> {
    const pipelineStartedAt = Date.now();
    const {
      findSimilar = true,
      similarityThreshold = config.clip.imageSimilarityThreshold,
      similarLimitPerItem = defaultShopLookResultBudget(),
      resultsPage,
      resultsPageSize,
      filterByDetectedCategory = true,
      groupByDetection = false,
      includeEmptyDetectionGroups = false,
      collapseVariantGroups = true,
      ...analyzeOptions
    } = options;
    const resolvedLimitPerItem = resolveShopLookLimit(similarLimitPerItem);
    const resolvedResultsPage = resolveShopLookPage(resultsPage);
    const resolvedResultsPageSize = resolveShopLookPageSize(resultsPageSize, resolvedLimitPerItem);
    const retrievalLimit = resolveShopLookRetrievalLimit(
      Math.max(resolvedLimitPerItem, resolvedResultsPage * resolvedResultsPageSize) *
      shopLookRecallMultiplier(),
    );
    const retryRetrievalLimit = Math.max(
      resolvedResultsPageSize,
      Math.min(retrievalLimit, shopLookRetryRetrievalCap()),
    );

    // Get image dimensions first
    const metadata = await sharp(buffer).metadata();
    const imageWidth = metadata.width || 0;
    const imageHeight = metadata.height || 0;

    // Start rembg in parallel with YOLO — both are independent of each other.
    // YOLO takes ~400ms so rembg gets that window for free; the effective extra
    // wait is max(0, rembgQueryTimeoutMs - yoloMs) instead of the full timeout.
    const fullProcessBufPromise = prepareBufferForImageSearchQuery(buffer);

    // First, run the standard analysis
    const analysisResult = await this.analyzeImage(buffer, filename, {
      ...analyzeOptions,
      generateEmbedding: true, // Force embedding for similarity search
      deferFullImageEmbedding: findSimilar,
    });
    const sourceImagePHash = await computePHash(buffer).catch(() => undefined);
    const similarityStartedAt = Date.now();
    const similarityTimings: ImageSimilarityStageTimings = { totalMs: 0 };
    // By now rembg is likely already done (ran in parallel with YOLO)
    const { buffer: fullProcessBuf } = await fullProcessBufPromise;

    // Similarity search disabled — return early
    if (!findSimilar) {
      return {
        ...analysisResult,
        similarProducts: {
          byDetection: [],
          totalProducts: 0,
          totalAvailableProducts: 0,
          threshold: similarityThreshold,
          detectedCategories: [],
          pagination: {
            mode: "per_detection",
            page: resolvedResultsPage,
            pageSize: resolvedResultsPageSize,
          },
        },
        timings: {
          ...(analysisResult.timings ?? { totalMs: 0 }),
          totalMs: Date.now() - pipelineStartedAt,
          similarity: { totalMs: 0 },
        },
      };
    }

    // No YOLO detections — fall back to a whole-image embedding search
    if (!analysisResult.detection || analysisResult.detection.items.length === 0) {
      const fallbackDetection = syntheticFullImageDetectionBlock(imageWidth, imageHeight);
      const fallbackDetectedCategories = [...new Set(fallbackDetection.items.map((item) => item.label))];
      const fallbackEmbedding = await processImageForEmbedding(fullProcessBuf).catch(() => null);
      if (!fallbackEmbedding || fallbackEmbedding.length === 0) {
        return {
          ...analysisResult,
          detection: fallbackDetection,
          similarProducts: {
            byDetection: [],
            totalProducts: 0,
            totalAvailableProducts: 0,
            threshold: similarityThreshold,
            detectedCategories: fallbackDetectedCategories,
            pagination: {
              mode: "per_detection",
              page: resolvedResultsPage,
              pageSize: resolvedResultsPageSize,
            },
          },
        };
      }

      const fallbackCaption = analysisResult.services?.blip
        ? await getCachedCaption(fullProcessBuf, "full")
        : null;
      const fallbackStructured = buildStructuredBlipOutput(fallbackCaption ?? "");
      const fallbackStructuredConfidence = fallbackStructured.confidence;
      const fallbackCaptionColors = fallbackCaption ? inferColorFromCaption(fallbackCaption) : {};
      const fallbackPrimaryColor = resolveCaptionPrimaryColor(
        fallbackCaption ?? "",
        fallbackCaptionColors,
        fallbackStructured,
      );

      let fallbackAudience: ReturnType<typeof inferAudienceFromCaption> =
        imageInferAudienceGenderEnv() && fallbackCaption
          ? fallbackStructuredConfidence >= imageBlipSoftHintConfidenceMin()
            ? {
              gender: fallbackStructured.audience.gender,
              ageGroup: fallbackStructured.audience.ageGroup,
            }
            : inferAudienceFromCaption(fallbackCaption)
          : ({} as ReturnType<typeof inferAudienceFromCaption>);
      if (!fallbackAudience.gender || !fallbackAudience.ageGroup) {
        const inferredFallbackAudience = inferApparelAudienceFallback({
          caption: fallbackCaption,
          detections: fallbackDetection.items,
        });
        if (!fallbackAudience.gender && inferredFallbackAudience.gender) {
          fallbackAudience = {
            ...fallbackAudience,
            gender: inferredFallbackAudience.gender,
          };
        }
        if (!fallbackAudience.ageGroup && inferredFallbackAudience.ageGroup) {
          fallbackAudience = {
            ...fallbackAudience,
            ageGroup: inferredFallbackAudience.ageGroup,
          };
        }
      }

      let fallbackSoftTypeHints = [
        ...fallbackStructured.productTypeHints,
        ...extractLexicalProductTypeSeeds(fallbackStructured.mainItem ?? ""),
        ...extractLexicalProductTypeSeeds(fallbackCaption ?? ""),
      ]
        .map((x) => normalizeLooseText(x))
        .filter(Boolean);
      fallbackSoftTypeHints = recoverFormalOuterwearTypes(
        [...new Set(fallbackSoftTypeHints)],
        "tops",
        "full_image",
        fallbackCaption ?? "",
      ).slice(0, 10);

      const fallbackFilters: Partial<import("./types").SearchFilters> = {};
      Object.assign(
        fallbackFilters,
        mergeImageSearchSessionFilters(
          fallbackFilters,
          options.sessionFilters ??
          (options.sessionId ? (getSession(options.sessionId).accumulatedFilters as Record<string, unknown>) : null),
        ),
      );
      if (fallbackAudience.gender) {
        fallbackFilters.gender = fallbackAudience.gender;
      }
      if (
        fallbackAudience.ageGroup &&
        fallbackStructuredConfidence >= imageBlipSoftHintConfidenceStrong()
      ) {
        fallbackFilters.ageGroup = fallbackAudience.ageGroup;
      }

      const fallback = await searchByImageWithSimilarity({
        imageEmbedding: fallbackEmbedding,
        imageBuffer: fullProcessBuf,
        filters: fallbackFilters,
        softProductTypeHints:
          fallbackSoftTypeHints.length > 0 ? fallbackSoftTypeHints : undefined,
        predictedCategoryAisles:
          fallbackSoftTypeHints.length > 0 ? fallbackSoftTypeHints : undefined,
        limit: retrievalLimit,
        similarityThreshold,
        includeRelated: false,
        knnField: "embedding",
        relaxThresholdWhenEmpty: shopLookRelaxEnv(),
        inferredPrimaryColor: fallbackPrimaryColor,
        sessionId: options.sessionId,
        userId: options.userId,
        sessionFilters: options.sessionFilters ?? undefined,
      });
      const guardedFallbackResults = applyFullImageFallbackGuard(fallback.results, {
        caption: fallbackCaption,
        queryGender: fallbackAudience.gender,
      });
      const fallbackRows: DetectionSimilarProducts[] = guardedFallbackResults.length > 0 ? [{
        detection: { label: "full_image", confidence: 1.0, box: { x1: 0, y1: 0, x2: imageWidth, y2: imageHeight }, area_ratio: 1.0 },
        category: "all",
        products: guardedFallbackResults,
        count: guardedFallbackResults.length,
      }] : [];
      const pagedFallback = paginateDetectionGroups(
        fallbackRows,
        resolvedResultsPage,
        resolvedResultsPageSize,
      );
      return {
        ...analysisResult,
        detection: fallbackDetection,
        similarProducts: {
          byDetection: pagedFallback.rows,
          totalProducts: pagedFallback.totalProducts,
          totalAvailableProducts: pagedFallback.totalAvailableProducts,
          threshold: similarityThreshold,
          detectedCategories: fallbackDetectedCategories,
          pagination: {
            mode: "per_detection",
            page: resolvedResultsPage,
            pageSize: resolvedResultsPageSize,
          },
        },
        timings: {
          ...(analysisResult.timings ?? { totalMs: 0 }),
          totalMs: Date.now() - pipelineStartedAt,
          similarity: {
            totalMs: Date.now() - similarityStartedAt,
          },
        },
      };
    }

    // Extract detected categories
    const detectedCategories = [...new Set(
      analysisResult.detection.items.map((item) => item.label)
    )];

    // Structured BLIP on full image once: schema + normalized taxonomy hints.
    const obs = {
      fullCaptionHit: false,
      detectionCaptionHits: 0,
      detectionCaptionMisses: 0,
      detectionCaptionAccepted: 0,
      detectionCaptionRejected: 0,
    };
    let blipCaption: string | null = null;
    let blipStructured = buildStructuredBlipOutput("");
    let blipStructuredConfidence = 0;
    let fullBlipSignal: BlipSignal | undefined = undefined;
    if (analysisResult.services?.blip) {
      blipCaption = await getCachedCaption(buffer, "full");
      obs.fullCaptionHit = Boolean(blipCaption && blipCaption.trim().length > 0);
      blipStructured = buildStructuredBlipOutput(blipCaption);
      blipStructuredConfidence = blipStructured.confidence;
      fullBlipSignal = buildBlipSignal(blipStructured, blipStructuredConfidence);

      // Full-image BLIP occasionally collapses a top+bottom outfit into "dress".
      // In that case, suppress this caption so it cannot bias downstream hints.
      const detectionLabels = analysisResult.detection.items
        .map((d) => normalizeLooseText(d.label))
        .filter(Boolean)
        .join(" ");
      const hasTop = /\b(top|shirt|blouse|tshirt|tee|sweater|hoodie|sweatshirt|cami|tank)\b/.test(detectionLabels);
      const hasBottom = /\b(skirt|pants|trousers|jeans|shorts|bottom)\b/.test(detectionLabels);
      const captionMainItem = normalizeLooseText(blipStructured.mainItem);
      if (captionMainItem.includes("dress") && hasTop && hasBottom) {
        // BLIP is hallucinating a dress for a top+bottom outfit.
        // Suppress only product-type hints and the main item label — the hallucination.
        // Preserve colors, gender, age group, and style signals which remain valid
        // observations about the image even when the item type is wrong.
        blipStructured = {
          ...blipStructured,
          mainItem: null,
          productTypeHints: [],
        };
        blipStructuredConfidence = 0;
        fullBlipSignal = undefined;
      }
    }
    let inferredAudience: ReturnType<typeof inferAudienceFromCaption> =
      imageInferAudienceGenderEnv() && blipCaption
        ? blipStructuredConfidence >= imageBlipSoftHintConfidenceMin()
          ? {
            gender: blipStructured.audience.gender,
            ageGroup: blipStructured.audience.ageGroup,
          }
          : inferAudienceFromCaption(blipCaption)
        : ({} as ReturnType<typeof inferAudienceFromCaption>);
    if (!inferredAudience.gender || !inferredAudience.ageGroup) {
      const fallbackAudience = inferApparelAudienceFallback({
        caption: blipCaption,
        detections: analysisResult.detection.items,
      });
      if (!inferredAudience.gender && fallbackAudience.gender) {
        inferredAudience = {
          ...inferredAudience,
          gender: fallbackAudience.gender,
        };
      }
      if (!inferredAudience.ageGroup && fallbackAudience.ageGroup) {
        inferredAudience = {
          ...inferredAudience,
          ageGroup: fallbackAudience.ageGroup,
        };
      }
    }
    if (
      !inferredAudience.ageGroup &&
      (inferredAudience.gender === "boys" || inferredAudience.gender === "girls")
    ) {
      inferredAudience = {
        ...inferredAudience,
        ageGroup: "kids",
      };
    }

    const detectionSetupStartedAt = Date.now();

    const captionColors = blipCaption ? inferColorFromCaption(blipCaption) : {};
    const inferredColorsByItem: Record<string, string | null> = {};
    const inferredColorsByItemConfidence: Record<string, number> = {};
    const inferredColorsByItemSource: Record<string, number> = {};
    // Prefer BLIP caption color when explicit (e.g. "white dress") — full-image dominant can pick up sky/background.
    const captionPrimaryColor = resolveCaptionPrimaryColor(blipCaption ?? "", captionColors, blipStructured);
    const captionPrimaryColorConfidence = captionPrimaryColor
      ? Math.max(0.45, Math.min(1, Number(blipStructuredConfidence ?? 0.6)))
      : 0;
    const allowDominantFallback = shouldUseDominantColorFallback(captionColors, blipStructured);
    const allowFullImageDominantFallback =
      allowDominantFallback &&
      analysisResult.detection.items.length <= 1;
    const dominantPrimaryColor =
      allowFullImageDominantFallback && imageInferDominantColorEnv() && analysisResult.services?.blip
        ? await extractDominantColorNames(buffer, { maxColors: 2, minShare: 0.12 })
          .then((c) => c[0] ?? null)
          .catch(() => null)
        : null;
    const dominantPrimaryColorConfidence = dominantPrimaryColor ? 0.52 : 0;
    const inferredPrimaryColor = pickColorByHighestConfidence([
      { color: captionPrimaryColor, confidence: captionPrimaryColorConfidence },
      { color: dominantPrimaryColor, confidence: dominantPrimaryColorConfidence },
    ]);

    const detectionJobs: Array<{ detection: Detection; detectionIndex?: number }> =
      groupByDetection
        ? analysisResult.detection.items.map((detection, index) => ({
          detection,
          detectionIndex: index,
        }))
        : (() => {
          // First, deduplicate by IoU for same-label detections
          const iouDedupedDetections = dedupeDetectionsBySameLabelIou(
            analysisResult.detection.items,
            yoloShopDedupeIouThreshold(),
          ).map(({ detection, originalIndex }) => ({
            detection,
            detectionIndex: originalIndex,
          }));

          // Then, deduplicate by category to keep only highest confidence per category
          const categoryDedupedDetections = dedupeDetectionsByCategoryHighestConfidence(
            iouDedupedDetections.map(d => d.detection)
          );

          // Return deduplicated results with best matches
          return categoryDedupedDetections.map((detection) => {
            // Find original index if available
            const originalMatch = iouDedupedDetections.find(d => d.detection === detection);
            return {
              detection,
              detectionIndex: originalMatch?.detectionIndex,
            };
          });
        })();
    const contextualFormalityScore = inferContextualFormalityFromDetections(analysisResult.detection.items);
    similarityTimings.detectionSetupMs = Date.now() - detectionSetupStartedAt;

    // Computed once and shared across all detection tasks. The garment-ROI crop embedding
    // (finalEmbedding per-detection) is correct for the embedding_garment catalog field, but
    // querying the full-frame catalog `embedding` field with a tight crop vector creates a
    // systematic framing mismatch. Using the full-image vector for that field restores alignment.
    const fullFrameEmbedding = await processImageForEmbedding(fullProcessBuf).catch(() => null);

    const detectionEmbeddingBatchStartedAt = Date.now();
    const detectionEmbeddingBatch = await computeShopTheLookGarmentEmbeddingsFromDetections(
      buffer,
      detectionJobs.map(({ detection }) => detection.box),
      fullProcessBuf,
    ).catch(() => []);
    const detectionEmbeddingBatchMs = Date.now() - detectionEmbeddingBatchStartedAt;
    const detectionEmbeddingBatchReady = detectionEmbeddingBatch.reduce(
      (count, item) => (item?.embedding && item?.clipBufferForAttributes ? count + 1 : count),
      0,
    );

    // Per-detection work is concurrency-limited to avoid OpenSearch kNN pile-ups.
    const detectionConcurrency = shopLookPerDetectionConcurrency(
      detectionJobs.map(({ detection }) => detection),
    );
    const detectionCropEmbedDurations: number[] = [];
    const detectionBlipDurations: number[] = [];
    const detectionSearchFirstDurations: number[] = [];
    const detectionSearchTotalDurations: number[] = [];
    const detectionSearchCallCounts: number[] = [];
    const detectionTaskDurations: number[] = [];
    const maxSearchCallsPerDetection = shopLookMaxSearchCallsPerDetection();
    const mainPathOnly = shopLookMainPathOnlyEnv();
    const maxDetectionTaskMs = shopLookMaxDetectionTaskMs();
    const hotPathDebug = String(process.env.SEARCH_DEBUG ?? "") === "1";
    const detectionTaskWallStartedAt = Date.now();
    if (process.env.NODE_ENV !== "production" || String(process.env.SEARCH_DEBUG ?? "") === "1") {
      console.info("[image-search][detection-runtime]", {
        detectionJobs: detectionJobs.length,
        detectionConcurrency,
        embeddingBatchMs: detectionEmbeddingBatchMs,
        embeddingBatchReady: detectionEmbeddingBatchReady,
        mainPathOnly,
        blipApiUrlConfigured: Boolean(process.env.BLIP_API_URL),
        rankerApiUrlConfigured: Boolean(process.env.RANKER_API_URL),
      });
    }
    const settled = await mapPoolSettled(
      detectionJobs,
      detectionConcurrency,
      async ({ detection, detectionIndex }, detectionJobIndex) => {
        const detectionTaskStartedAt = Date.now();
        let detectionSearchTotalMs = 0;
        let detectionSearchCalls = 0;
        const deterministicTwoPass = shopLookDeterministicTwoPassEnv();
        let detectionSearchCallLimit = deterministicTwoPass ? 2 : (mainPathOnly ? 1 : maxSearchCallsPerDetection);
        const searchReasonsExecuted: string[] = [];
        const searchReasonsSkipped: string[] = [];
        let lastSearchResult: Awaited<ReturnType<typeof searchByImageWithSimilarity>> | null = null;
        try {
          const runDetectionSearch = async (
            reason: string,
            payload: Parameters<typeof searchByImageWithSimilarity>[0],
          ) => {
            const elapsedTaskMs = Date.now() - detectionTaskStartedAt;
            if (elapsedTaskMs >= maxDetectionTaskMs) {
              if (hotPathDebug) {
                console.warn(
                  `[detection-search-time-budget] label="${detection.label}" reason="${reason}" task_ms=${elapsedTaskMs} max_ms=${maxDetectionTaskMs}`,
                );
              }
              return (
                lastSearchResult ??
                ({ results: [], meta: { total_results: 0, threshold: similarityThreshold } } as Awaited<
                  ReturnType<typeof searchByImageWithSimilarity>
                >)
              );
            }
            if (detectionSearchCalls >= detectionSearchCallLimit) {
              searchReasonsSkipped.push(reason);
              if (hotPathDebug) {
                console.warn(
                  `[detection-search-call-skipped] label="${detection.label}" reason="${reason}" max_calls=${detectionSearchCallLimit}`,
                );
              }
              return (
                lastSearchResult ??
                ({ results: [], meta: { total_results: 0, threshold: similarityThreshold } } as Awaited<
                  ReturnType<typeof searchByImageWithSimilarity>
                >)
              );
            }
            const payloadForCall =
              reason.startsWith("initial")
                ? payload
                : {
                  ...payload,
                  // Keep retry/fallback searches broad enough for 10k-catalog recall,
                  // then rely on downstream precision guards instead of tiny retry pools.
                  limit: Math.max(
                    1,
                    Math.min(
                      Number(payload.limit ?? retrievalLimit),
                      Math.max(
                        retryRetrievalLimit,
                        Math.min(retrievalLimit, Math.max(resolvedLimitPerItem * 4, resolvedResultsPageSize * 3)),
                      ),
                    ),
                  ),
                };
            const softGateMode = String(process.env.SEARCH_RELEVANCE_GATE_MODE ?? "soft").toLowerCase().trim() !== "strict";
            const filtersForCall = softGateMode
              ? (() => {
                const next = { ...((payloadForCall as any).filters ?? {}) };
                delete (next as any).productTypes;
                delete (next as any).color;
                return next;
              })()
              : (payloadForCall as any).filters;
            const startedAt = Date.now();
            const result = await searchByImageWithSimilarity({
              ...payloadForCall,
              filters: filtersForCall,
              detectionLabel: (payloadForCall as any).detectionLabel ?? label ?? detection.label,
            });
            const elapsedMs = Date.now() - startedAt;
            detectionSearchTotalMs += elapsedMs;
            detectionSearchCalls += 1;
            searchReasonsExecuted.push(reason);
            lastSearchResult = result;
            if (hotPathDebug) {
              console.info(
                `[detection-search-call] label="${detection.label}" reason="${reason}" ms=${elapsedMs} calls=${detectionSearchCalls}`,
              );
            }
            return result;
          };
          // Refine generic "shoe" label using BLIP caption for footwear subtype specificity.
          const rawLabel = detection.label;
          let label = inferFootwearSubtypeFromCaption(rawLabel, blipCaption, {
            confidence: detection.confidence,
            areaRatio: detection.area_ratio,
          });
          label = normalizeDetectionLabelForSearch(label);
          if (hotPathDebug) {
            console.log(`[detection-trace] started label="${label}"${label !== rawLabel ? ` (refined from "${rawLabel}")` : ""} conf=${(detection.confidence ?? 0).toFixed(3)} area=${(detection.area_ratio ?? 0).toFixed(3)}`);
          }

          let clipBuffer: Buffer;
          let finalEmbedding: number[];
          let queryProcessBuf: Buffer;
          const cropEmbedStartedAt = Date.now();
          try {
            const batched = detectionEmbeddingBatch[detectionJobIndex];
            if (batched?.embedding && batched.clipBufferForAttributes) {
              finalEmbedding = batched.embedding;
              clipBuffer = batched.clipBufferForAttributes;
              queryProcessBuf = batched.processBuf;
            } else {
              const aligned = await computeShopTheLookGarmentEmbeddingFromDetection(
                buffer,
                detection.box,
                fullProcessBuf,
              );
              finalEmbedding = aligned.embedding;
              clipBuffer = aligned.clipBufferForAttributes;
              queryProcessBuf = aligned.processBuf;
            }
          } catch {
            return null;
          }
          const cropEmbedMs = Date.now() - cropEmbedStartedAt;
          detectionCropEmbedDurations.push(cropEmbedMs);
          const finalGarmentEmbedding = finalEmbedding;
          // Use the pre-computed full-image vector for the `embedding` field queries so
          // dual-KNN receives two genuinely distinct signals (full-frame vs garment-crop).
          const finalFullFrameEmbedding = fullFrameEmbedding ?? finalEmbedding;
          const categoryMapping = normalizeCategoryMapping(mapDetectionToCategory(label, detection.confidence, {
            box_normalized: (detection as any).box_normalized,
          }));
          const textureMaterialPromise = inferMaterialFromTextureCrop({
            clipBuffer,
            productCategory: categoryMapping.productCategory,
            detectionLabel: label,
            caption:
              categoryMapping.productCategory === "tops" ||
                categoryMapping.productCategory === "bottoms" ||
                categoryMapping.productCategory === "dresses" ||
                categoryMapping.productCategory === "outerwear"
                ? null
                : blipCaption,
          }).catch(() => ({ material: null, confidence: 0 }));
          const skipDetectionBlip =
            shopLookSkipDetectionBlipCategories().has(
              String(categoryMapping.productCategory || "").toLowerCase(),
            );
          const detCaptionStartedAt = Date.now();
          const detCaptionPromise = analysisResult.services?.blip && !skipDetectionBlip
            ? getCachedCaption(clipBuffer, "det")
            : Promise.resolve("");
          const searchCategories = shouldUseAlternatives(categoryMapping)
            ? getSearchCategories(categoryMapping)
            : [categoryMapping.productCategory];
          const lexicalHints = filterProductTypeSeedsByMappedCategory(
            extractLexicalProductTypeSeeds(label),
            categoryMapping.productCategory,
          );
          const expandedTypeHints = expandPredictedTypeHints([
            label,
            ...searchCategories,
            ...lexicalHints,
          ]);

          const filters: Partial<import("./types").SearchFilters> = {};
          Object.assign(
            filters,
            mergeImageSearchSessionFilters(
              filters,
              options.sessionFilters ?? (options.sessionId ? (getSession(options.sessionId).accumulatedFilters as Record<string, unknown>) : null),
            ),
          );
          // Apply global inferred gender from full-image BLIP as baseline for all detections.
          // Per-detection BLIP can override only if detected with strong confidence.
          if (inferredAudience.gender) {
            filters.gender = inferredAudience.gender;
          }
          // Keep inferred type tokens as soft hints so image search stays recall-first.
          // Hard product-type filters can suppress visually similar neighbors across categories.
          // Strip sleeve prefixes from ALL detection labels so "short sleeve top" doesn't
          // seed "shorts" and "long sleeve outwear" doesn't seed "long" as a product type.
          const sanitizedLabel = label
            .replace(/\b(short|long)\s+sleeve\s*/gi, "")
            .replace(/\s+/g, " ")
            .trim();
          const typeSeedSource = sanitizedLabel || label;
          let typeSeeds = extractLexicalProductTypeSeeds(typeSeedSource);
          typeSeeds = filterProductTypeSeedsByMappedCategory(typeSeeds, categoryMapping.productCategory);
          typeSeeds = tightenTypeSeedsForDetection(label, categoryMapping, typeSeeds, {
            confidence: detection.confidence,
            areaRatio: detection.area_ratio,
          });
          const textureMaterial = await textureMaterialPromise;
          const confidentTextureMaterial =
            textureMaterial.material && textureMaterial.confidence >= imageMinMaterialConfidenceEnv()
              ? textureMaterial.material
              : null;
          // Synthetic formality cue forces suit-type recovery when the contextual signal
          // is strong (structured top + tailored bottom, BLIP-derived formality, etc.) even
          // when neither YOLO label nor BLIP caption literally contain the word "suit" or
          // "blazer". Without this, a clear suit photo where BLIP says "man in formal
          // portrait" gets treated as a generic jacket detection and suits never reach the
          // kNN candidate pool.
          const formalitySuitCue =
            categoryMapping.productCategory === "outerwear" &&
            contextualFormalityScore >= 7
              ? " suit blazer "
              : "";
          const strongTypeSeeds = recoverFormalOuterwearTypes(
            typeSeeds,
            categoryMapping.productCategory,
            label,
            blipCaption ?? "",
            formalitySuitCue,
          );
          let softProductTypeHints = recoverFormalOuterwearTypes(
            [...new Set([...strongTypeSeeds, ...expandedTypeHints.slice(0, 8)])],
            categoryMapping.productCategory,
            label,
            blipCaption ?? "",
            formalitySuitCue,
          );
          if (categoryMapping.productCategory === "tops") {
            const labelNormForTopHints = String(label ?? "").toLowerCase();
            const isShortSleeveTop = /\bshort sleeve top\b/.test(labelNormForTopHints);
            const isLongSleeveTop = /\blong sleeve top\b|\blong sleeve\b|\bfull sleeve\b/.test(labelNormForTopHints);
            const isMenAudience = String(inferredAudience.gender ?? "").toLowerCase().trim() === "men";
            if (isShortSleeveTop) {
              const shortTopPriority = ["tshirt", "shirt", "polo", "top", "tops"];
              softProductTypeHints = [...new Set([...shortTopPriority, ...softProductTypeHints])];
            } else if (isLongSleeveTop) {
              const longTopPriority = longSleeveTopPriorityHints(label, confidentTextureMaterial, true);
              const nonShortSleeveHints = softProductTypeHints.filter(
                (t) => !/\b(t-?shirt|tshirt|tee|tees|tank|camisole|cami|sleeveless|crop top|polo)\b/i.test(String(t)),
              );
              softProductTypeHints = [...new Set([...longTopPriority, ...nonShortSleeveHints])];
            }
            // Avoid overly narrow/feminine seeds for men tops; they collapse recall.
            if (isMenAudience) {
              softProductTypeHints = softProductTypeHints.filter(
                (t) => !/\b(camisole|cami|tank|sleeveless|crop top)\b/i.test(String(t)),
              );
            }
          }
          softProductTypeHints = recoverTailoredTopTypes(
            softProductTypeHints,
            categoryMapping.productCategory,
            label,
            detection.raw_label,
            contextualFormalityScore,
            blipCaption,
          );
          const blipCaptionNorm = String(blipCaption ?? "").toLowerCase();
          softProductTypeHints = suppressPoloForPlainShortTop(
            softProductTypeHints,
            label,
            detection.raw_label,
            blipCaptionNorm,
          );
          const hasSuitCaptionCue =
            /\b(suit|suiting|blazer|sport coat|dress jacket|suit jacket|tuxedo|waistcoat|vest)\b/.test(blipCaptionNorm) ||
            (/\btie\b/.test(blipCaptionNorm) && contextualFormalityScore >= 6) ||
            // Strong contextual formality (BLIP "formal/business/wedding" + structured top
            // + tailored bottom) is a reliable suit signal even when the caption never
            // uses the literal word "suit" or "blazer".
            (contextualFormalityScore >= 8 &&
              (categoryMapping.productCategory === "tops" ||
                categoryMapping.productCategory === "outerwear")) ||
            // Wedding / black-tie / ceremony cues are virtually always suit-anchored.
            /\b(wedding|black-tie|black tie|ceremony|bow tie|bowtie|business formal)\b/.test(
              blipCaptionNorm,
            );

          // ──────────────────────────────────────────────────────────────────
          // Outerwear & Suit signal path
          // ──────────────────────────────────────────────────────────────────
          // Single-source-of-truth signal for outerwear/tailored/suit detections.
          // When this fires it consolidates the routing decisions (priority seed
          // types, filter category aliases, predicted aisles, tailored-vs-outerwear
          // routing) that previously lived in scattered conditionals. Falls back
          // to the existing per-branch logic for non-outerwear detections.
          const outerwearSuitSignal = inferOuterwearSuitSignal({
            yoloLabel: label,
            detectionRawLabel: detection.raw_label,
            productCategoryFromMapping: categoryMapping.productCategory,
            blipCaption,
            contextualFormalityScore,
          });
          if (outerwearSuitSignal.isOuterwearOrSuit && outerwearSuitSignal.prioritySeedTypes.length > 0) {
            const labelNormForOuterwearType = normalizeDetectionLabelForSearch(`${label} ${detection.raw_label ?? ""}`);
            const genericLongSleeveOuterwear =
              /\blong\s*sleeve\s*(?:outwear|outerwear)\b/.test(labelNormForOuterwearType);
            const explicitOuterwearSubtypeCue =
              /\b(blazer|sport\s*coat|sportcoat|suit\s*jacket|dress\s*jacket|tailored\s*jacket|jacket|jackets|coat|coats|overcoat|trench|parka|puffer|fleece|bomber|blouson|windbreaker|rain\s*jacket|shell\s*jacket|softshell|shacket|shirt\s*jacket|vest|waistcoat|gilet)\b/.test(
                `${labelNormForOuterwearType} ${blipCaptionNorm}`,
              );
            const shouldHardFilterOuterwearType =
              !genericLongSleeveOuterwear || explicitOuterwearSubtypeCue;
            // Push subtype-specific priority seeds to the front so they survive
            // truncation in initialTypeSearchHints. For the generic detector label
            // "long sleeve outwear", keep those seeds soft unless a real subtype
            // cue exists; hard productTypes here can otherwise empty the query or
            // over-rank full suits for a plain jacket crop.
            softProductTypeHints = [
              ...new Set([
                ...outerwearSuitSignal.prioritySeedTypes,
                ...softProductTypeHints,
              ]),
            ];
            if (shouldHardFilterOuterwearType) {
              const existingProductTypes = Array.isArray(filters.productTypes)
                ? filters.productTypes
                : [];
              filters.productTypes = [
                ...new Set([
                  ...existingProductTypes,
                  ...outerwearSuitSignal.prioritySeedTypes,
                ]),
              ].slice(0, 12);
            }
          }
          if (hasSuitCaptionCue && categoryMapping.productCategory === "tops") {
            const suitTopPriority = [
              "suit",
              "suits",
              "tuxedo",
              "suit jacket",
              "blazer",
              "sport coat",
              "dress jacket",
              "waistcoat",
              "vest",
              "tailored jacket",
              "structured jacket",
            ];
            softProductTypeHints = [...new Set([...suitTopPriority, ...softProductTypeHints])];
            // Use main-path type intent instead of fallback-only rescue.
            const existingTypes = Array.isArray(filters.productTypes) ? filters.productTypes : [];
            filters.productTypes = [...new Set([...existingTypes, ...suitTopPriority])].slice(0, 10);
          } else if (hasSuitCaptionCue && categoryMapping.productCategory === "bottoms") {
            const suitBottomPriority = [
              "trousers",
              "dress pants",
              "slacks",
              "tailored trousers",
              "formal pants",
            ];
            softProductTypeHints = [...new Set([...suitBottomPriority, ...softProductTypeHints])];
            const existingTypes = Array.isArray(filters.productTypes) ? filters.productTypes : [];
            filters.productTypes = [...new Set([...existingTypes, ...suitBottomPriority])].slice(0, 10);
            filters.softStyle = "semi-formal";
          }
          if (shouldForceTypeFilterForDetection(detection, categoryMapping, strongTypeSeeds)) {
            filters.productTypes = strongTypeSeeds.slice(0, 10);
          }

          // If the full-image caption explicitly mentions jeans, bias bottoms retrieval
          // toward jeans/denim so non-denim sporty pants do not outrank true jeans.
          if (
            categoryMapping.productCategory === "bottoms" &&
            /\bjeans?\b|\bdenim\b/.test(String(blipCaption ?? "").toLowerCase())
          ) {
            const jeansPriority = ["jeans", "jean", "denim", "straight jeans", "wide leg jeans"];
            softProductTypeHints = [...new Set([...jeansPriority, ...softProductTypeHints])];
          }

          const itemColorKey = detectionColorKey(label, detectionIndex);
          if (!(itemColorKey in inferredColorsByItem)) inferredColorsByItem[itemColorKey] = null;
          if (!(itemColorKey in inferredColorsByItemConfidence)) inferredColorsByItemConfidence[itemColorKey] = 0;
          if (!(itemColorKey in inferredColorsByItemSource)) inferredColorsByItemSource[itemColorKey] = 0;

          const cropColorsPromise = extractDetectionCropColorsForRanking({
            clipBuffer,
            productCategory: categoryMapping.productCategory,
            detectionLabel: label,
          }).catch(() => []);

          // Preserve category-slot color from full-image caption (e.g. "blue jeans")
          // only as a low-priority fallback for this detection.
          const fullCaptionSlotColor = captionColorForProductCategory(
            categoryMapping.productCategory,
            captionColors,
          );
          const slotColorConfidence =
            fullCaptionSlotColor && blipStructuredConfidence >= imageBlipSoftHintConfidenceMin()
              ? Math.max(0.62, Math.min(0.9, blipStructuredConfidence))
              : 0;
          if (fullCaptionSlotColor && slotColorConfidence > 0) {
            setDetectionColorIfHigherConfidence(
              inferredColorsByItem,
              inferredColorsByItemConfidence,
              inferredColorsByItemSource,
              itemColorKey,
              fullCaptionSlotColor,
              slotColorConfidence,
              0,
              { productCategory: categoryMapping.productCategory, detectionLabel: label },
            );
          }

          // Accessories and bags rely almost entirely on visual similarity — skip
          // gender/style/color filters that are designed for clothing and cause false negatives.
          const isAccessoryOrBag =
            categoryMapping.productCategory === "accessories" ||
            categoryMapping.productCategory === "bags";

          if (!isAccessoryOrBag && inferredAudience.gender) {
            filters.gender = inferredAudience.gender;
          }
          if (!isAccessoryOrBag && inferredAudience.ageGroup) {
            // Keep audience anchors strict across all retrieval paths.
            filters.ageGroup = inferredAudience.ageGroup;
          }

          const inferredStyle = inferStyleForDetectionLabel(label);
          const useBlipSoftHints = blipStructuredConfidence >= imageBlipSoftHintConfidenceMin();
          const useStrongBlipSoftHints = blipStructuredConfidence >= imageBlipSoftHintConfidenceStrong();
          let styleAppliedFromInferredFallback = false;
          if (!isAccessoryOrBag && useStrongBlipSoftHints && blipStructured.style.attrStyle) {
            filters.softStyle = blipStructured.style.attrStyle;
          } else if (!isAccessoryOrBag && inferredStyle.attrStyle && shouldApplyInferredStyleFallback(categoryMapping.productCategory, label)) {
            filters.softStyle = inferredStyle.attrStyle;
            styleAppliedFromInferredFallback = true;
          }
          if (
            categoryMapping.productCategory === "bottoms" &&
            styleAppliedFromInferredFallback &&
            !useStrongBlipSoftHints
          ) {
            delete (filters as any).softStyle;
          }

          // Combine BLIP, label, and outfit-context formality. This preserves formalwear intent
          // even when full-image BLIP is empty and YOLO emitted shirt-recovery labels.
          const blipFormalityScore = blipCaption ? inferFormalityFromCaption(blipCaption) : 0;
          const labelFormalityScore = inferFormalityFromLabel(label);
          const effectiveFormalityScore = Math.max(
            blipFormalityScore,
            labelFormalityScore,
            isAccessoryOrBag ? 0 : contextualFormalityScore,
          );
          const isFootwearCategory = String(categoryMapping.productCategory || "").toLowerCase() === "footwear";
          // Footwear should not inherit outfit-level contextual formality; it over-prunes results.
          const footwearFormalityScore = isFootwearCategory
            ? Math.max(blipFormalityScore, labelFormalityScore)
            : effectiveFormalityScore;
          const applicableFormalityScore = isFootwearCategory
            ? footwearFormalityScore
            : effectiveFormalityScore;
          if (hotPathDebug && blipCaption && blipFormalityScore > 0) {
            console.info(`[formality-intent] caption="${blipCaption.substring(0, 60)}..." score=${blipFormalityScore}`);
          }
          const formalityHardGateEligible = ["outerwear", "dresses"].includes(
            String(categoryMapping.productCategory || "").toLowerCase(),
          );
          if (applicableFormalityScore >= 8) {
            // For tops/bottoms, use formal as a ranking bias only. Hard minFormality can zero out
            // valid catalogs where formality metadata is sparse.
            filters.softStyle = formalityHardGateEligible ? "formal" : "semi-formal";
            if (formalityHardGateEligible) {
              (filters as any).minFormality = 8;
              if (hotPathDebug) console.info(`[formality-intent][APPLIED] enforcing formal-wear-only for detection="${label}"`);
            } else {
              delete (filters as any).minFormality;
              if (hotPathDebug) console.info(`[formality-intent][SOFT] applying semi-formal bias for detection="${label}"`);
            }
          } else if (!isAccessoryOrBag && !isFootwearCategory && applicableFormalityScore >= 7) {
            // Keep this softer than strict formal: improves suit/blazer recall without over-pruning.
            filters.softStyle = "semi-formal";
            delete (filters as any).minFormality;
          }
          if (categoryMapping.productCategory === "bottoms" && !hasSuitCaptionCue) {
            delete (filters as any).softStyle;
            delete (filters as any).minFormality;
          }
          if (
            mainPathOnly &&
            (
              categoryMapping.productCategory === "tops" ||
              (categoryMapping.productCategory === "bottoms" && !hasSuitCaptionCue) ||
              categoryMapping.productCategory === "dresses" ||
              categoryMapping.productCategory === "outerwear"
            )
          ) {
            // In strict main-path mode, keep KNN retrieval recall-first for apparel.
            // Style/formality remains a rerank signal downstream.
            delete (filters as any).style;
            delete (filters as any).softStyle;
            delete (filters as any).minFormality;
          }

          const formalFootwearIntent =
            categoryMapping.productCategory === "footwear" &&
            (footwearFormalityScore >= 8 || filters.softStyle === "formal");
          if (formalFootwearIntent) {
            softProductTypeHints = pruneAthleticFootwearTerms(softProductTypeHints);
            if (Array.isArray((filters as any).productTypes)) {
              (filters as any).productTypes = pruneAthleticFootwearTerms((filters as any).productTypes);
            }
          }

          const detectionSleeve =
            categoryMapping.attributes.sleeveLength ?? inferSleeveIntentFromDetectionLabel(label);
          const normalizedLabelForSleeve = normalizeLooseText(label);
          const hasExplicitSleeveCue =
            /\b(short sleeve|long sleeve|half sleeve|3\/?4 sleeve|sleeveless)\b/.test(normalizedLabelForSleeve);
          const sleeveSensitiveCategory =
            categoryMapping.productCategory === "tops" || categoryMapping.productCategory === "dresses";
          const sleeveSignalStrong =
            (detection.confidence ?? 0) >= 0.94 || (detection.area_ratio ?? 0) >= 0.12;
          // For sleeve-sensitive categories: trust an explicit label cue ("short sleeve top") at any
          // detection confidence, since the label word itself is definitive. Fall back to strong-signal
          // check only when sleeve is inferred (e.g. "tshirt" → short) without an explicit cue.
          if (
            detectionSleeve &&
            (!sleeveSensitiveCategory || hasExplicitSleeveCue || sleeveSignalStrong)
          ) {
            filters.sleeve = detectionSleeve;
          }
          // Vest-type garments are definitionally sleeveless — bypass the strict explicit-cue
          // requirement so that a YOLO "vest"/"gilet"/"waistcoat" label correctly gates the
          // retrieval to sleeveless products even though the label word isn't "sleeveless".
          if (!filters.sleeve && sleeveSensitiveCategory) {
            const isVestLike =
              /\b(vest|gilet|waistcoat)\b/.test(normalizedLabelForSleeve) &&
              !/\b(sweater|cardigan|hoodie|pullover|jacket|coat|sweatshirt|overshirt)\b/.test(normalizedLabelForSleeve);
            if (isVestLike) {
              filters.sleeve = "sleeveless";
            }
          }
          const detectionLength = inferLengthIntentFromDetection(detection, imageHeight);
          if (detectionLength) (filters as any).length = detectionLength;

          // Extract dominant colors from the garment crop pixels via k-means + LAB.
          // clipBuffer is the padded ROI of the detected garment — already isolated
          // from background/other items. These colors feed into soft color compliance
          // (rerankScore boost) but do not hard-gate final relevance.
          try {
            const cropColors = await cropColorsPromise;
            if (cropColors.length > 0) {
              (filters as any).cropDominantColors = cropColors;

              const cropColorConfidence = estimateCropColorConfidence(detection);
              const selectedColor =
                selectDetectionColorFromPalette({
                  cropColors,
                  productCategory: categoryMapping.productCategory,
                  detectionLabel: label,
                  cropColorConfidence,
                }) ?? cropColors[0];
              const adjustedColor = adjustStripedTopColorInference({
                selectedColor,
                cropColors,
                productCategory: categoryMapping.productCategory,
                detectionLabel: label,
                fullCaption: blipCaption,
              });

              if (adjustedColor) {
                setDetectionColorIfHigherConfidence(
                  inferredColorsByItem,
                  inferredColorsByItemConfidence,
                  inferredColorsByItemSource,
                  itemColorKey,
                  adjustedColor,
                  cropColorConfidence,
                  1,
                  { productCategory: categoryMapping.productCategory, detectionLabel: label },
                );
              }

              // For slot-specific apparel, if crop picks a neutral but caption explicitly names
              // a chromatic slot color (e.g. yellow shirt), promote caption color.
              const existingColor = inferredColorsByItem[itemColorKey];
              const existingConf = Number(inferredColorsByItemConfidence[itemColorKey] ?? 0);
              const existingSource = Number(inferredColorsByItemSource[itemColorKey] ?? 0);
              const captionPromoteConfidence = Math.max(slotColorConfidence, Math.min(0.92, cropColorConfidence + 0.02));
              if (
                fullCaptionSlotColor &&
                canPromoteCaptionSlotColor({
                  productCategory: categoryMapping.productCategory,
                  detectionLabel: label,
                  existingColor,
                  existingSource,
                  existingConfidence: existingConf,
                  captionColor: fullCaptionSlotColor,
                  captionConfidence: captionPromoteConfidence,
                })
              ) {
                setDetectionColorIfHigherConfidence(
                  inferredColorsByItem,
                  inferredColorsByItemConfidence,
                  inferredColorsByItemSource,
                  itemColorKey,
                  fullCaptionSlotColor,
                  captionPromoteConfidence,
                  2,
                  { productCategory: categoryMapping.productCategory, detectionLabel: label },
                );
              }
            }
          } catch { /* non-critical: color embedding channel still works */ }
          let predictedCategoryAisles: string[] | undefined;
          const noisyCat = isNoisyCategoryForAutoHardCategory(categoryMapping, label);
          const baseHardAuto =
            categoryMapping.confidence >= shopLookHardCategoryConfThreshold() &&
            (detection.area_ratio ?? 0) >= shopLookHardCategoryAreaRatioThreshold();
          const relaxedGarmentHardAuto =
            categoryMapping.confidence >= 0.85 &&
            (detection.area_ratio ?? 0) >= 0.12 &&
            (detection.confidence ?? 0) >= 0.75;
          const topsHardAuto =
            categoryMapping.productCategory === "tops" &&
            /\b(short sleeve top|long sleeve top|shirt|t-?shirt|tee|polo|blouse|top)\b/i.test(String(label ?? "")) &&
            categoryMapping.confidence >= 0.8 &&
            (detection.area_ratio ?? 0) >= 0.09 &&
            (detection.confidence ?? 0) >= 0.85;
          const detectionMeetsAutoHardHeuristics =
            !noisyCat && (baseHardAuto || relaxedGarmentHardAuto || topsHardAuto);
          const accessoryLikeCategory = isAccessoryLikeCategory(categoryMapping.productCategory);
          const footwearLikeCategory = categoryMapping.productCategory === "footwear";
          const suitCaptionForTop =
            hasSuitCaptionCue && categoryMapping.productCategory === "tops";
          const suitCaptionForTailored =
            hasSuitCaptionCue && categoryMapping.productCategory === "outerwear";
          // Use the outerwear/suit signal's recommended detection category when it
          // applies; falls back to the legacy suitCaptionForTailored bool otherwise.
          // For non-outerwear detections (tops/bottoms/dresses/footwear/etc.) the
          // signal's isOuterwearOrSuit is false and we keep categoryMapping unchanged.
          const detectionProductCategoryForSearch = outerwearSuitSignal.isOuterwearOrSuit
            ? outerwearSuitSignal.detectionCategoryForSearch
            : suitCaptionForTailored
              ? "tailored"
              : categoryMapping.productCategory;
          const accessoryOrFootwearConfident =
            (accessoryLikeCategory || footwearLikeCategory) &&
            (((detection.confidence ?? 0) >= 0.72) || ((detection.area_ratio ?? 0) >= 0.025));
          // CRITICAL FIX: Footwear should always use hard filtering when detected, even at lower confidence
          // This prevents footwear alternative categories (sneakers, boots, heels, etc) from leaking through
          const footwearAlwaysHardFilter =
            footwearLikeCategory &&
            ((detection.confidence ?? 0) >= 0.55 || (detection.area_ratio ?? 0) >= 0.015);
          const shouldHardCategory =
            filterByDetectedCategory &&
            !suitCaptionForTop &&
            (
              accessoryOrFootwearConfident ||
              footwearAlwaysHardFilter ||
              shopLookHardCategoryStrictEnv() ||
              detectionMeetsAutoHardHeuristics ||
              shouldForceHardCategoryForDetection(detection, categoryMapping)
            );
          const coreApparelLikeCategory =
            categoryMapping.productCategory === "tops" ||
            categoryMapping.productCategory === "bottoms" ||
            categoryMapping.productCategory === "dresses" ||
            categoryMapping.productCategory === "outerwear" ||
            categoryMapping.productCategory === "footwear";
          const forceCoreMainPathHardCategory =
            coreApparelLikeCategory &&
            (detection.confidence ?? 0) >= 0.55 &&
            (detection.area_ratio ?? 0) >= 0.03 &&
            !suitCaptionForTop;
          const forceHardCategoryFilterUsed = Boolean(
            shouldHardCategory || forceCoreMainPathHardCategory,
          );
          if (filterByDetectedCategory) {
            if (shouldHardCategory || forceCoreMainPathHardCategory) {
              // Apply hard OpenSearch category filtering, even when global soft-category is enabled.
              const terms = hardCategoryTermsForDetection(label, categoryMapping, {
                confidence: detection.confidence,
                areaRatio: detection.area_ratio,
                // Propagate the broader suit-cue determination (which considers
                // contextual formality and wedding/black-tie cues, not just literal
                // "suit"/"blazer" words in the caption) so suit listings are kept in
                // the hard-category recall pool for outerwear detections.
                forceSuitCue: hasSuitCaptionCue || outerwearSuitSignal.suitCue,
              }, blipCaption ?? "");
              const categoryTerms = formalFootwearIntent ? pruneAthleticFootwearTerms(terms) : terms;
              // For outerwear detections that the signal classified as suit/tailored,
              // merge the signal's filterCategoryAliases into the hard-filter terms
              // so the OpenSearch category clause matches both outerwear and tailored
              // aisles in one query (catalog suits are often indexed under "tailored",
              // "Suits", or even pure "Tuxedos" — they need to be reachable via this
              // same filter or kNN simply never returns them).
              const augmentedCategoryTerms = outerwearSuitSignal.isOuterwearOrSuit
                ? [...new Set([...categoryTerms, ...outerwearSuitSignal.filterCategoryAliases])]
                : categoryTerms;
              filters.category = augmentedCategoryTerms.length === 1
                ? augmentedCategoryTerms[0]
                : augmentedCategoryTerms;
              // Predicted aisles drive the soft category boost. Use the signal's
              // recommendation when it applies; otherwise keep the legacy single-aisle
              // behavior to avoid false-boost on alternative categories.
              predictedCategoryAisles = outerwearSuitSignal.isOuterwearOrSuit
                ? outerwearSuitSignal.predictedAisles
                : [categoryMapping.productCategory];
            } else if (imageSoftCategoryEnv() || shopLookSoftCategoryEnv()) {
              if (shopLookSingleCategoryHintEnv()) {
                predictedCategoryAisles = [categoryMapping.productCategory];
              } else {
                const typeHints = Array.isArray(filters.productTypes) ? filters.productTypes : [];
                predictedCategoryAisles = typeHints.length
                  ? typeHints
                  : softProductTypeHints.length
                    ? softProductTypeHints
                    : expandedTypeHints.length
                      ? expandedTypeHints
                      : searchCategories;
              }
              if (formalFootwearIntent && Array.isArray(predictedCategoryAisles) && predictedCategoryAisles.length > 0) {
                predictedCategoryAisles = pruneAthleticFootwearTerms(predictedCategoryAisles);
              }
            } else {
              filters.category =
                searchCategories.length === 1 ? searchCategories[0] : searchCategories;
            }
          }

          // tops/bottoms/outerwear: catalog `embedding` holds full-frame CLIP vectors;
          // query with full-frame vector for proper distribution alignment.
          // dresses: use `embedding_garment` — the garment crop is more precise for a
          // dress that spans 40-80% of the image, and the catalog field is indexed from
          // the same garment-crop pipeline. The two-pass fallback at passBKnnField
          // automatically queries `embedding` when garment-field results are low.
          const knnFieldUsed =
            categoryMapping.productCategory === "tops" ||
            categoryMapping.productCategory === "bottoms" ||
            categoryMapping.productCategory === "outerwear"
              ? "embedding"
              : shopTheLookKnnField();
          if (textureMaterial.material && textureMaterial.confidence >= imageMinMaterialConfidenceEnv()) {
            (filters as any).material = textureMaterial.material;
          }

          // Snapshot filters before BLIP and fire the kNN search immediately.
          // The search runs concurrently with BLIP below (OpenSearch I/O and GPU captioning
          // in parallel). BLIP-derived material/type/gender signals feed the retry path if
          // the initial results are sparse; detectionBlipSignal still reaches all retry calls.

          // For generic shoe detections: start CLIP zero-shot subtype classification
          // concurrently with the kNN search (uses cached text embeddings after first warmup,
          // ~0ms overhead per request). The result is awaited at/before the retry decision
          // so retries use the correct subtype even when BLIP is unavailable.
          const _earlyFootwearSubtypePromise: Promise<string | null> =
            categoryMapping.productCategory === "footwear" &&
            (label === "shoe" || label === "shoes") &&
            finalEmbedding.length > 0
              ? classifyFootwearSubtypeFromCropEmbedding(finalEmbedding).catch(() => null)
              : Promise.resolve(null);

          const preBlipFilters = { ...filters };
          const preBlipSoftTypeHints = [...softProductTypeHints];
          const initialTypeSearchHints = buildInitialTypeSearchHintsForDetection({
            detectionLabel: label,
            productCategory: detectionProductCategoryForSearch,
            materialHint: confidentTextureMaterial,
            softProductTypeHints: preBlipSoftTypeHints,
            mainPathOnly,
            limit: mainPathOnly ? 3 : Math.max(1, Math.min(3, detectionSearchCallLimit)),
          });
          if (hotPathDebug && mainPathOnly && initialTypeSearchHints.length > 0) {
            console.log(
              `[main-path-initial-hints] detection="${label}" category="${detectionProductCategoryForSearch}" hints=[${initialTypeSearchHints.join(",")}]`,
            );
          }
          // k-means crop color for this detection is already resolved (awaited above at
          // cropColorsPromise). Pass it to the initial search so the reranker has a color
          // bias from the start rather than ordering results purely by cosine similarity.
          const _initialInferredColor = String(inferredColorsByItem[itemColorKey] ?? "").trim() || undefined;
          const _parallelSearchStartedAt = Date.now();
          const initialSearchPayload = {
            imageEmbedding: finalFullFrameEmbedding,
            imageEmbeddingGarment:
              Array.isArray(finalGarmentEmbedding) && finalGarmentEmbedding.length > 0
                ? finalGarmentEmbedding
                : undefined,
            // Pass clipBuffer so products.service computes attribute signals (color/texture/etc.)
            // for reranking. YOLO re-entry is guarded in fashionSearchFacade: when
            // detectionProductCategory is set the facade skips inferPredictedCategoryAislesFromImage.
            imageBuffer: clipBuffer,
            pHash: sourceImagePHash,
            detectionYoloConfidence: detection.confidence,
            detectionProductCategory: detectionProductCategoryForSearch,
            filters: preBlipFilters,
            limit: Math.max(
              resolvedResultsPageSize,
              Math.min(resolveShopLookRetrievalLimit(retrievalLimit * 1.7), retrievalLimit + 180),
            ),
            similarityThreshold: shopLookDetectionSimilarityThreshold(
              similarityThreshold,
              detectionProductCategoryForSearch,
            ),
            includeRelated: false,
            predictedCategoryAisles,
            knnField: knnFieldUsed,
            forceHardCategoryFilter: forceHardCategoryFilterUsed,
            relaxThresholdWhenEmpty: shopLookDetectionRelaxEnv(),
            blipSignal: undefined,
            // Pass k-means crop color (already resolved) so the initial reranker has a
            // color bias rather than falling back to cosine-only ordering.
            inferredPrimaryColor: _initialInferredColor,
            inferredColorKey: itemColorKey,
            inferredColorsByItem,
            inferredColorsByItemConfidence,
            debugRawCosineFirst: shopLookDebugRawCosineFirstEnv(),
            sessionId: options.sessionId,
            userId: options.userId,
            sessionFilters: options.sessionFilters ?? undefined,
          };
          const _parallelSearchPromise = runDetectionSearch("initial", {
            ...initialSearchPayload,
            softProductTypeHints:
              initialTypeSearchHints.length > 0
                ? initialTypeSearchHints
                : preBlipSoftTypeHints.length > 0
                  ? preBlipSoftTypeHints
                  : undefined,
          });

          // Per-detection BLIP captioning + CLIP consistency gate — runs concurrently with search above.
          const detCaption = await detCaptionPromise;
          const detCaptionMs = Date.now() - detCaptionStartedAt;
          detectionBlipDurations.push(detCaptionMs);
          // Do not inherit full-image BLIP hints by default for a specific detection.
          // A full-image caption can describe a different region entirely (e.g. top vs trousers)
          // and will poison per-detection retrieval if used as the fallback signal.
          let detectionBlipSignal: BlipSignal | undefined;
          let detectionCaptionAcceptedForLock = false;
          if (detCaption.trim().length > 0) {
            const captionLength = inferLengthIntentFromCaption(detCaption);
            if (captionLength) (filters as any).length = captionLength;
          }
          if (detCaption.trim().length > 0) {
            obs.detectionCaptionHits += 1;
            const detCaptionColors = inferColorFromCaption(detCaption);
            // Strict slot binding: do not fallback across slots.
            // Each BLIP color must map only to its corresponding item type.
            const detCaptionColor = captionColorForProductCategory(
              categoryMapping.productCategory,
              detCaptionColors,
            );
            const detStruct = buildStructuredBlipOutput(detCaption);
            const consistency = await clipCaptionConsistency01(finalEmbedding, detCaption);
            const detConfidence = combineConfidenceFromConsistency(detStruct.confidence, consistency);
            // When crop-derived color is already reliable for slot-specific apparel,
            // don't let detection-caption text override it (top/bottom overlap can leak colors).
            const existingColor = String(inferredColorsByItem[itemColorKey] ?? "").trim();
            const existingConf = Number(inferredColorsByItemConfidence[itemColorKey] ?? 0);
            const existingSource = Number(inferredColorsByItemSource[itemColorKey] ?? 0);
            const hasReliableCropColor = existingColor.length > 0 && existingSource === 1 && existingConf >= 0.6;
            const categoryNeedsStableSlotColor = requiresSlotSpecificColor(categoryMapping.productCategory);
            const detCaptionColorNorm = String(detCaptionColor ?? "").toLowerCase().trim();
            const existingColorNorm = String(existingColor ?? "").toLowerCase().trim();
            const allowCaptionOverrideNeutralCrop = canPromoteCaptionSlotColor({
              productCategory: categoryMapping.productCategory,
              detectionLabel: label,
              existingColor,
              existingSource,
              existingConfidence: existingConf,
              captionColor: detCaptionColorNorm,
              captionConfidence: detConfidence,
              minCaptionConfidence: 0.62,
            });
            // BLIP cross-validation: crop k-means can misclassify neutral garments as chromatic
            // under warm/cool lighting (e.g. gray trousers → blue cluster). When the detection
            // caption names a neutral color with high confidence, trust the linguistic signal.
            const allowHighConfNeutralCaptionOverrideChromaticCrop =
              detCaptionColorNorm.length > 0 &&
              isNeutralFashionColorEarly(detCaptionColorNorm) &&
              detConfidence >= 0.75 &&
              existingColorNorm.length > 0 &&
              isChromaticFashionColor(existingColorNorm);
            if (
              !(
                categoryNeedsStableSlotColor &&
                hasReliableCropColor &&
                !allowCaptionOverrideNeutralCrop &&
                !allowHighConfNeutralCaptionOverrideChromaticCrop
              )
            ) {
              setDetectionColorIfHigherConfidence(
                inferredColorsByItem,
                inferredColorsByItemConfidence,
                inferredColorsByItemSource,
                itemColorKey,
                detCaptionColor,
                detConfidence,
                2,
                { productCategory: categoryMapping.productCategory, detectionLabel: label },
              );
            }
            if (
              detConfidence >= imageBlipSoftHintConfidenceMin() &&
              consistency >= imageBlipClipConsistencyMin()
            ) {
              obs.detectionCaptionAccepted += 1;
              detectionCaptionAcceptedForLock = true;
              detectionBlipSignal = buildBlipSignal(detStruct, detConfidence);
              if (!filters.softStyle && detStruct.style.attrStyle) filters.softStyle = detStruct.style.attrStyle;
              // Per-detection BLIP can override global gender only if detected with strong confidence.
              if (!filters.gender && detStruct.audience.gender && detConfidence >= imageBlipSoftHintConfidenceStrong()) {
                filters.gender = detStruct.audience.gender;
              }
              if (!filters.ageGroup && detStruct.audience.ageGroup) filters.ageGroup = detStruct.audience.ageGroup;
              // Apply material hints from per-detection BLIP caption if present.
              const detMaterialHints = (detStruct as any)?.materialHints as string[] | undefined;
              const materialHintMinConfidence =
                categoryMapping.productCategory === "dresses"
                  ? Math.max(0.58, imageBlipSoftHintConfidenceMin())
                  : imageBlipSoftHintConfidenceStrong();
              if (detMaterialHints && detMaterialHints.length > 0 && detConfidence >= materialHintMinConfidence) {
                const hasTextureMaterial = Boolean(textureMaterial.material);
                const keepTextureForTopLike =
                  (categoryMapping.productCategory === "tops" ||
                    categoryMapping.productCategory === "outerwear" ||
                    categoryMapping.productCategory === "dresses") &&
                  hasTextureMaterial &&
                  textureMaterial.confidence >= imageMinMaterialConfidenceEnv() + 0.08;
                if (!keepTextureForTopLike) {
                  (filters as any).material = detMaterialHints[0];
                }
              }
              const mergedTypes = [...new Set([...softProductTypeHints, ...detStruct.productTypeHints])];
              const filteredTypes = filterProductTypeSeedsByMappedCategory(
                mergedTypes,
                categoryMapping.productCategory,
              ).slice(0, 10);
              softProductTypeHints = tightenTypeSeedsForDetection(
                label,
                categoryMapping,
                filteredTypes,
                {
                  confidence: detection.confidence,
                  areaRatio: detection.area_ratio,
                },
              );
              softProductTypeHints = recoverFormalOuterwearTypes(
                softProductTypeHints,
                categoryMapping.productCategory,
                label,
                blipCaption ?? "",
                detCaption,
              );
              if (shouldForceTypeFilterForDetection(detection, categoryMapping, softProductTypeHints)) {
                filters.productTypes = softProductTypeHints.slice(0, 10);
              }
            } else {
              obs.detectionCaptionRejected += 1;
            }
          } else {
            obs.detectionCaptionMisses += 1;
          }

          // Refine generic footwear after per-detection caption arrives.
          // Full-image caption can miss shoe subtype cues (heel/boot/sandal), while
          // detection caption is usually more local to the item crop.
          if (categoryMapping.productCategory === "footwear") {
            const refinedFootwearLabel = inferFootwearSubtypeFromCaption(label, detCaption || blipCaption, {
              confidence: detection.confidence,
              areaRatio: detection.area_ratio,
            });
            if (refinedFootwearLabel !== label) {
              const previousLabel = label;
              label = refinedFootwearLabel;
              if (hotPathDebug) {
                console.log(
                  `[detection-trace] footwear subtype refined from "${previousLabel}" to "${label}" via detection caption`,
                );
              }

              softProductTypeHints = tightenTypeSeedsForDetection(
                label,
                categoryMapping,
                [...new Set([label, ...softProductTypeHints])],
                {
                  confidence: detection.confidence,
                  areaRatio: detection.area_ratio,
                },
              );
              if (formalFootwearIntent) {
                softProductTypeHints = pruneAthleticFootwearTerms(softProductTypeHints);
              }

              if (Array.isArray((filters as any).productTypes) && (filters as any).productTypes.length > 0) {
                (filters as any).productTypes = tightenTypeSeedsForDetection(
                  label,
                  categoryMapping,
                  (filters as any).productTypes,
                  {
                    confidence: detection.confidence,
                    areaRatio: detection.area_ratio,
                  },
                );
                if (formalFootwearIntent) {
                  (filters as any).productTypes = pruneAthleticFootwearTerms((filters as any).productTypes);
                }
              }

              if (filterByDetectedCategory) {
                if (shouldHardCategory) {
                  const terms = hardCategoryTermsForDetection(label, categoryMapping, {
                    confidence: detection.confidence,
                    areaRatio: detection.area_ratio,
                  }, blipCaption ?? "");
                  const categoryTerms = formalFootwearIntent ? pruneAthleticFootwearTerms(terms) : terms;
                  filters.category = categoryTerms.length === 1 ? categoryTerms[0] : categoryTerms;
                } else if (imageSoftCategoryEnv() || shopLookSoftCategoryEnv()) {
                  if (shopLookSingleCategoryHintEnv()) {
                    predictedCategoryAisles = [categoryMapping.productCategory];
                  } else {
                    const typeHints = Array.isArray(filters.productTypes) ? filters.productTypes : [];
                    predictedCategoryAisles = typeHints.length > 0 ? typeHints : softProductTypeHints;
                  }
                  if (formalFootwearIntent && Array.isArray(predictedCategoryAisles) && predictedCategoryAisles.length > 0) {
                    predictedCategoryAisles = pruneAthleticFootwearTerms(predictedCategoryAisles);
                  }
                }
              }
            }
          }

          // CLIP zero-shot fallback: when YOLO + BLIP still return a generic "shoe" label,
          // classify the shoe crop embedding against subtype text anchors. This handles cases
          // where the caption describes context (outfit, model) rather than the shoe itself.
          if (
            categoryMapping.productCategory === "footwear" &&
            (label === "shoe" || label === "shoes") &&
            finalEmbedding.length > 0
          ) {
            // Await the promise started concurrently with the initial kNN search.
            // After first warmup this is pure cosine computation (~0ms).
            const clipSubtype = await _earlyFootwearSubtypePromise;
            if (clipSubtype && clipSubtype !== label) {
              if (hotPathDebug) {
                console.log(`[detection-trace] footwear subtype CLIP-classified: "${label}" → "${clipSubtype}"`);
              }
              label = clipSubtype;
              softProductTypeHints = tightenTypeSeedsForDetection(
                label,
                categoryMapping,
                [...new Set([label, ...softProductTypeHints])],
                { confidence: detection.confidence, areaRatio: detection.area_ratio },
              );
              if (formalFootwearIntent) softProductTypeHints = pruneAthleticFootwearTerms(softProductTypeHints);
            }
          }

          // Dress silhouette inference: refine generic dress label with a specific
          // silhouette/style type to improve product-type hint precision.
          // 1. Caption-based (fast, no extra CLIP call).
          // 2. CLIP zero-shot fallback when caption gives no silhouette cue and label is generic.
          if (categoryMapping.productCategory === "dresses") {
            const captionSilhouette = inferDressSilhouetteFromCaption(
              label,
              detCaption || blipCaption,
            );
            if (captionSilhouette) {
              if (hotPathDebug) {
                console.log(`[detection-trace] dress silhouette from caption: "${label}" → "${captionSilhouette}"`);
              }
              softProductTypeHints = [...new Set([captionSilhouette, ...softProductTypeHints])];
            } else if (
              (label === "dress" || label === "gown") &&
              finalEmbedding.length > 0
            ) {
              // Only run CLIP zero-shot for generic labels where caption gave no signal.
              const clipSilhouette = await classifyDressSilhouetteFromCropEmbedding(finalEmbedding).catch(() => null);
              if (clipSilhouette) {
                if (hotPathDebug) {
                  console.log(`[detection-trace] dress silhouette CLIP-classified: "${label}" → "${clipSilhouette}"`);
                }
                softProductTypeHints = [...new Set([clipSilhouette, ...softProductTypeHints])];
              }
            }
          }

          const strictAudienceLock =
            Boolean(inferredAudience.gender) &&
            blipStructuredConfidence >= imageBlipSoftHintConfidenceStrong() &&
            detectionCaptionAcceptedForLock;

          const inferredPrimaryColorForDetection = (() => {
            const detColor = inferredColorsByItem[itemColorKey];
            const detColorConfidence = inferredColorsByItemConfidence[itemColorKey] ?? 0;
            const globalPrimary = String(inferredPrimaryColor ?? "").toLowerCase().trim();
            const detColorNorm = String(detColor ?? "").toLowerCase().trim();
            const onePieceDetection =
              categoryMapping.productCategory === "dresses" ||
              /\b(dress|gown|jumpsuit|romper|playsuit|sundress)\b/.test(String(label).toLowerCase());
            if (onePieceDetection && globalPrimary) {
              if (!detColorNorm || (isLightNeutralFashionColor(globalPrimary) && !isLightNeutralFashionColor(detColorNorm))) {
                return globalPrimary;
              }
            }
            if (detColor && detColorConfidence >= 0.45) return detColor;
            return inferredPrimaryColor;
          })();
          const cropDominantForConflict = Array.isArray((filters as any).cropDominantColors)
            ? ((filters as any).cropDominantColors as unknown[])
                .map((c) => canonicalizeColorIntentToken(String(c ?? "")))
                .filter((c) => c.length > 0)
            : [];
          const inferredColorNorm = canonicalizeColorIntentToken(inferredPrimaryColorForDetection);
          const inferredColorIsChromatic =
            inferredColorNorm.length > 0 &&
            inferredColorNorm !== "multicolor" &&
            !isNeutralFashionColor(inferredColorNorm);
          const cropHasNeutral = cropDominantForConflict.some((c) => isNeutralFashionColor(c));
          const cropHasChromatic = cropDominantForConflict.some(
            (c) => c.length > 0 && c !== "multicolor" && !isNeutralFashionColor(c),
          );
          const inferredColorConflictForRetrieval =
            inferredColorIsChromatic &&
            Number(inferredColorsByItemConfidence[itemColorKey] ?? 0) >= 0.82 &&
            cropHasNeutral &&
            !cropHasChromatic;
          const tinyFootwearBox =
            categoryMapping.productCategory === "footwear" &&
            Number(detection.area_ratio ?? 0) < 0.018;
          const globalPrimaryNorm = canonicalizeColorIntentToken(inferredPrimaryColor);
          // Suppress shoe color when the global primary is light-neutral AND the shoe's
          // crop color differs — this guards against background-bleed on small detections
          // (e.g., white studio floor leaking into a tiny shoe bbox). When the shoe box
          // is large enough (≥ 6% of image), the crop color is reliably the shoe itself,
          // so we keep it even when the global primary is white/beige/cream.
          const footwearColorConflictWithGlobal =
            categoryMapping.productCategory === "footwear" &&
            inferredColorNorm.length > 0 &&
            globalPrimaryNorm.length > 0 &&
            inferredColorNorm !== globalPrimaryNorm &&
            isLightNeutralFashionColor(globalPrimaryNorm) &&
            !isLightNeutralFashionColor(inferredColorNorm) &&
            (detection.area_ratio ?? 0) < 0.06;
          const explicitColorFilter = String((filters as any).color ?? "").trim();
          const inferredColorConfidenceForDetection = Number(
            inferredColorsByItemConfidence[itemColorKey] ?? 0,
          );
          if (
            explicitColorFilter.length === 0 &&
            inferredColorNorm.length > 0 &&
            shouldApplyStrictDetectionSoftColor({
              productCategory: categoryMapping.productCategory,
              color: inferredColorNorm,
              confidence: inferredColorConfidenceForDetection,
            })
          ) {
            // Promote high-confidence item color into strict softColor intent so
            // final relevance gating prefers the requested hue more aggressively.
            (filters as any).softColor = inferredColorNorm;
            (filters as any).softColorStrict = true;
          }
          const inferredPrimaryColorForSearch =
            categoryMapping.productCategory === "tops" && explicitColorFilter.length === 0
              ? (
                inferredColorConfidenceForDetection >= 0.82
                  ? inferredColorNorm
                  : undefined
              )
              : categoryMapping.productCategory === "footwear" &&
                  explicitColorFilter.length === 0 &&
                  (tinyFootwearBox || footwearColorConflictWithGlobal)
                ? undefined
              : categoryMapping.productCategory === "bottoms" &&
                  explicitColorFilter.length === 0 &&
                  inferredColorConflictForRetrieval
                ? undefined
                : inferredColorNorm;

          let detectionSimilarityThreshold = shopLookDetectionSimilarityThreshold(
            similarityThreshold,
            categoryMapping.productCategory,
          );
          if (categoryMapping.productCategory === "tops" && inferredColorConflictForRetrieval) {
            // Beige/white-dominant crop can hide a chromatic shirt under layering.
            // Widen initial KNN surface so chromatic matches can enter ranking.
            detectionSimilarityThreshold = Math.max(0.2, detectionSimilarityThreshold - 0.06);
          }
          if (categoryMapping.productCategory === "footwear" && (detection.area_ratio ?? 0) < 0.012) {
            // Tiny shoe crops are noisy; reduce threshold slightly to avoid empty KNN.
            detectionSimilarityThreshold = Math.max(0.18, detectionSimilarityThreshold - 0.08);
          }
          const detectionRetrievalLimit = (() => {
            const categoryNorm = String(categoryMapping.productCategory ?? "").toLowerCase().trim();
            const boost =
              categoryNorm === "tops"
                ? (inferredColorConflictForRetrieval ? 2.4 : 1.7)
                : categoryNorm === "dresses" ? 2.4
                  : categoryNorm === "bottoms" ? 2.1
                  : categoryNorm === "footwear"
                    ? ((detection.area_ratio ?? 0) < 0.012 ? 2.6 : 1.9)
                    : 1;
            return Math.max(
              resolvedResultsPageSize,
              Math.min(resolveShopLookRetrievalLimit(retrievalLimit * boost), retrievalLimit + 180),
            );
          })();

          const detectionRelaxThreshold = shopLookDetectionRelaxEnv();

          // Await the already-running parallel search (fired before BLIP above).
          // BLIP signals are available for the retry/fallback calls that follow.
          const searchFirstStartedAt = _parallelSearchStartedAt;
          let similarResult = await _parallelSearchPromise;
          const searchFirstMs = Date.now() - searchFirstStartedAt;
          detectionSearchFirstDurations.push(searchFirstMs);

          // If the KNN call itself timed out (both primary and retry failed), the root cause
          // is infrastructure pressure — not a filter/precision issue. All downstream recovery
          // branches would face the same timeout, so skip them and surface the degraded state.
          const firstPassKnnTimedOut = Boolean((similarResult as any)?.meta?.knn_timed_out);
          if (firstPassKnnTimedOut) {
            if (hotPathDebug || true) {
              console.warn(
                `[detection-knn-timeout] label="${label}" category="${categoryMapping.productCategory}" skipping recovery chain — root cause is KNN timeout`,
              );
            }
            // Leave similarResult as-is (empty) and fall through to the empty/skip logic below.
          }

          const slowFirstSearch =
            searchFirstMs >= shopLookSlowFirstSearchMsThreshold();
          const slowSearchSkipRecoveryMinResults =
            shopLookSlowFirstSearchSkipRecoveryMinResultsByCategory(categoryMapping.productCategory);
          const sufficientFirstPassResults =
            similarResult.results.length >= slowSearchSkipRecoveryMinResults;
          if (slowFirstSearch && sufficientFirstPassResults) {
            // Freeze additional retries/recoveries for this detection only.
            // In deterministic two-pass mode, do NOT pin the limit — Pass B must still be
            // available when results are below the Pass B minimum threshold.
            if (!deterministicTwoPass) {
              detectionSearchCallLimit = detectionSearchCalls;
            }
            if (hotPathDebug) {
              console.info(
                `[detection-search-adaptive-limit] label="${label}" search_first_ms=${searchFirstMs} first_count=${similarResult.results.length} two_pass=${deterministicTwoPass} limit=${deterministicTwoPass ? detectionSearchCallLimit : detectionSearchCalls}`,
              );
            }
          }

          let knnCandidateCount = similarResult.results.length;
          let precisionSafeResults = similarResult.results;
          let categorySafeResults = similarResult.results;
          let sleeveSafeResults = similarResult.results;
          let formalitySafeResults = similarResult.results;
          let athleticSafeResults = similarResult.results;

          if (!firstPassKnnTimedOut && deterministicTwoPass) {
            const passBMinResults = shopLookDeterministicPassBMinResults(
              categoryMapping.productCategory,
              resolvedLimitPerItem,
            );
            if (similarResult.results.length < passBMinResults && detectionSearchCalls < detectionSearchCallLimit) {
              // Pass B uses the alternate KNN field to retrieve complementary neighbors;
              // category constraints are intentionally kept — dropping them floods the pool
              // with off-category items that downstream precision guards then eject, leaving
              // fewer results than before the pass ran.
              const passBKnnField = knnFieldUsed === "embedding_garment" ? "embedding" : "embedding_garment";

              similarResult = await runDetectionSearch("deterministic_pass_b", {
                imageEmbedding: finalFullFrameEmbedding,
                imageEmbeddingGarment:
                  Array.isArray(finalGarmentEmbedding) && finalGarmentEmbedding.length > 0
                    ? finalGarmentEmbedding
                    : undefined,
                imageBuffer: clipBuffer,
                pHash: sourceImagePHash,
                detectionYoloConfidence: detection.confidence,
                detectionProductCategory: categoryMapping.productCategory,
                filters,
                softProductTypeHints: softProductTypeHints.length > 0 ? softProductTypeHints : undefined,
                limit: detectionRetrievalLimit,
                similarityThreshold: Math.max(0.2, detectionSimilarityThreshold - 0.03),
                includeRelated: false,
                predictedCategoryAisles,
                knnField: passBKnnField,
                forceHardCategoryFilter: forceHardCategoryFilterUsed,
                relaxThresholdWhenEmpty: true,
                blipSignal: detectionBlipSignal,
                inferredPrimaryColor: inferredPrimaryColorForSearch,
                inferredColorKey: itemColorKey,
                inferredColorsByItem,
                inferredColorsByItemConfidence,
                debugRawCosineFirst: shopLookDebugRawCosineFirstEnv(),
                sessionId: options.sessionId,
                userId: options.userId,
                sessionFilters: options.sessionFilters ?? undefined,
              });
            }
          } else {

          // If BLIP-derived audience/style filters are too strict and remove all hits,
          // retry once without those attribute filters (but keep category/productTypes).
          if (
            (
              similarResult.results.length === 0 ||
              (
                (categoryMapping.productCategory === "tops" || categoryMapping.productCategory === "bottoms") &&
                similarResult.results.length <= 1
              )
            ) &&
            (
              filters.gender ||
              filters.ageGroup ||
              (filters as any).style ||
              (filters as any).softStyle
            )
          ) {
            const filtersRetry = { ...filters } as typeof filters;
            // Keep explicit audience gender across retries to prevent cross-gender leakage.
            // Only relax age group when strict lock is not active.
            const preserveInferredAudience = strictAudienceLock;
            if (!preserveInferredAudience) {
              delete (filtersRetry as any).ageGroup;
            }
            delete (filtersRetry as any).style;
            delete (filtersRetry as any).softStyle;
            similarResult = await runDetectionSearch("retry_drop_style", {
              imageEmbedding: finalEmbedding,
              imageEmbeddingGarment:
                Array.isArray(finalGarmentEmbedding) && finalGarmentEmbedding.length > 0
                  ? finalGarmentEmbedding
                  : undefined,
              imageBuffer: clipBuffer,
              pHash: sourceImagePHash,
              detectionYoloConfidence: detection.confidence,
              detectionProductCategory: categoryMapping.productCategory,
              filters: filtersRetry,
              softProductTypeHints: softProductTypeHints.length > 0 ? softProductTypeHints : undefined,
              limit: detectionRetrievalLimit,
              similarityThreshold: detectionSimilarityThreshold,
              includeRelated: false,
              predictedCategoryAisles,
              knnField: knnFieldUsed,
              forceHardCategoryFilter: forceHardCategoryFilterUsed,
              relaxThresholdWhenEmpty: detectionRelaxThreshold,
              blipSignal: detectionBlipSignal,
              inferredPrimaryColor: inferredPrimaryColorForSearch,
              inferredColorKey: itemColorKey,
              inferredColorsByItem,
              inferredColorsByItemConfidence,
              debugRawCosineFirst: shopLookDebugRawCosineFirstEnv(),
              sessionId: options.sessionId,
              userId: options.userId,
              sessionFilters: options.sessionFilters ?? undefined,
            });
          }

          // If strong hint type forcing over-constrains retrieval, retry once without hard
          // productTypes while keeping soft hints/category to preserve precision with recall.
          if (
            similarResult.results.length === 0 &&
            Array.isArray((filters as any).productTypes) &&
            (filters as any).productTypes.length > 0
          ) {
            const { productTypes: _omitProductTypes, ...filtersNoHardTypes } = filters as any;
            similarResult = await runDetectionSearch("retry_drop_hard_types", {
              imageEmbedding: finalEmbedding,
              imageEmbeddingGarment:
                Array.isArray(finalGarmentEmbedding) && finalGarmentEmbedding.length > 0
                  ? finalGarmentEmbedding
                  : undefined,
              imageBuffer: clipBuffer,
              pHash: sourceImagePHash,
              detectionYoloConfidence: detection.confidence,
              detectionProductCategory: categoryMapping.productCategory,
              filters: filtersNoHardTypes,
              softProductTypeHints: softProductTypeHints.length > 0 ? softProductTypeHints : undefined,
              limit: detectionRetrievalLimit,
              similarityThreshold: detectionSimilarityThreshold,
              includeRelated: false,
              predictedCategoryAisles,
              knnField: knnFieldUsed,
              forceHardCategoryFilter: forceHardCategoryFilterUsed,
              relaxThresholdWhenEmpty: detectionRelaxThreshold,
              blipSignal: detectionBlipSignal,
              inferredPrimaryColor: inferredPrimaryColorForSearch,
              inferredColorKey: itemColorKey,
              inferredColorsByItem,
              inferredColorsByItemConfidence,
              debugRawCosineFirst: shopLookDebugRawCosineFirstEnv(),
              sessionId: options.sessionId,
              userId: options.userId,
              sessionFilters: options.sessionFilters ?? undefined,
            });
          }

          // Dress/one-piece recovery: length + sleeve inference is fragile for non-standard
          // body framing. Drop them before more aggressive fallbacks.
          if (
            similarResult.results.length === 0 &&
            (categoryMapping.productCategory === "dresses" || categoryMapping.productCategory === "tops") &&
            ((filters as any).length || (filters as any).sleeve)
          ) {
            const filtersNoLengthSleeve = { ...filters } as any;
            delete filtersNoLengthSleeve.length;
            delete filtersNoLengthSleeve.sleeve;
            similarResult = await runDetectionSearch("retry_drop_length_sleeve", {
              imageEmbedding: finalEmbedding,
              imageEmbeddingGarment:
                Array.isArray(finalGarmentEmbedding) && finalGarmentEmbedding.length > 0
                  ? finalGarmentEmbedding
                  : undefined,
              imageBuffer: clipBuffer,
              pHash: sourceImagePHash,
              detectionYoloConfidence: detection.confidence,
              detectionProductCategory: categoryMapping.productCategory,
              filters: filtersNoLengthSleeve,
              softProductTypeHints: softProductTypeHints.length > 0 ? softProductTypeHints : undefined,
              limit: detectionRetrievalLimit,
              similarityThreshold: detectionSimilarityThreshold,
              includeRelated: false,
              predictedCategoryAisles,
              knnField: knnFieldUsed,
              forceHardCategoryFilter: forceHardCategoryFilterUsed,
              relaxThresholdWhenEmpty: detectionRelaxThreshold,
              blipSignal: detectionBlipSignal,
              inferredPrimaryColor: inferredPrimaryColorForSearch,
              inferredColorKey: itemColorKey,
              inferredColorsByItem,
              inferredColorsByItemConfidence,
              debugRawCosineFirst: shopLookDebugRawCosineFirstEnv(),
              sessionId: options.sessionId,
              userId: options.userId,
              sessionFilters: options.sessionFilters ?? undefined,
            });
          }

          if (
            shopLookCategoryFallbackEnv() &&
            similarResult.results.length === 0 &&
            filterByDetectedCategory &&
            (
              !isAccessoryLikeCategory(categoryMapping.productCategory) ||
              (
                isAccessoryLikeCategory(categoryMapping.productCategory) &&
                (
                  ((detection.confidence ?? 0) >= 0.72 && (detection.area_ratio ?? 0) >= 0.015) ||
                  // Bag detections are often medium-confidence; allow fallback when box area is decent.
                  (categoryMapping.productCategory === "bags" &&
                    ((detection.confidence ?? 0) >= 0.58 || (detection.area_ratio ?? 0) >= 0.022))
                )
              )
            ) &&
            !(categoryMapping.productCategory === "accessories" && isHeadwearLabel(label)) &&
            (filters as { category?: string | string[] }).category
          ) {
            const { category: _omitCategory, ...filtersSansCategory } = filters as {
              category?: string | string[];
              productTypes?: string[];
            };
            const preserveHardCategoryInFallback = shouldPreserveHardCategoryOnFallback(categoryMapping);
            const fallbackCategoryTerms = preserveHardCategoryInFallback
              ? fallbackCategoryTermsForDetection(label, categoryMapping)
              : [];
            const fallbackFilters = preserveHardCategoryInFallback && fallbackCategoryTerms.length > 0
              ? {
                ...filtersSansCategory,
                category:
                  fallbackCategoryTerms.length === 1
                    ? fallbackCategoryTerms[0]
                    : fallbackCategoryTerms,
              }
              : filtersSansCategory;
            similarResult = await runDetectionSearch("fallback_drop_category", {
              imageEmbedding: finalEmbedding,
              imageEmbeddingGarment:
                Array.isArray(finalGarmentEmbedding) && finalGarmentEmbedding.length > 0
                  ? finalGarmentEmbedding
                  : undefined,
              imageBuffer: clipBuffer,
              pHash: sourceImagePHash,
              detectionYoloConfidence: detection.confidence,
              detectionProductCategory: categoryMapping.productCategory,
              filters: fallbackFilters,
              limit: detectionRetrievalLimit,
              similarityThreshold: detectionSimilarityThreshold,
              includeRelated: false,
              predictedCategoryAisles: preserveHardCategoryInFallback ? undefined : predictedCategoryAisles,
              knnField: knnFieldUsed,
              forceHardCategoryFilter: preserveHardCategoryInFallback,
              relaxThresholdWhenEmpty: detectionRelaxThreshold,
              blipSignal: detectionBlipSignal,
              inferredPrimaryColor: inferredPrimaryColorForSearch,
              inferredColorKey: itemColorKey,
              inferredColorsByItem,
              inferredColorsByItemConfidence,
              debugRawCosineFirst: shopLookDebugRawCosineFirstEnv(),
              sessionId: options.sessionId,
              userId: options.userId,
              sessionFilters: options.sessionFilters ?? undefined,
            });
            if (similarResult.results.length === 0) {
              const fallbackStructuralFilters = preserveHardCategoryInFallback && fallbackCategoryTerms.length > 0
                ? {
                  category:
                    fallbackCategoryTerms.length === 1
                      ? fallbackCategoryTerms[0]
                      : fallbackCategoryTerms,
                  gender: (filters as any).gender,
                  ageGroup: (filters as any).ageGroup,
                }
                : {
                  length: (filters as any).length,
                  sleeve: (filters as any).sleeve,
                  gender: (filters as any).gender,
                  ageGroup: (filters as any).ageGroup,
                };
              similarResult = await runDetectionSearch("fallback_structural", {
                imageEmbedding: finalEmbedding,
                imageEmbeddingGarment:
                  Array.isArray(finalGarmentEmbedding) && finalGarmentEmbedding.length > 0
                    ? finalGarmentEmbedding
                    : undefined,
                imageBuffer: clipBuffer,
                pHash: sourceImagePHash,
                detectionYoloConfidence: detection.confidence,
                detectionProductCategory: categoryMapping.productCategory,
                // Keep crop-derived structural intent even in last-resort fallback.
                filters: fallbackStructuralFilters as any,
                softProductTypeHints: softProductTypeHints.length > 0 ? softProductTypeHints : undefined,
                limit: detectionRetrievalLimit,
                similarityThreshold: detectionSimilarityThreshold,
                includeRelated: false,
                knnField: knnFieldUsed,
                forceHardCategoryFilter: preserveHardCategoryInFallback,
                relaxThresholdWhenEmpty: detectionRelaxThreshold,
                blipSignal: detectionBlipSignal,
                inferredPrimaryColor: inferredPrimaryColorForSearch,
                inferredColorKey: itemColorKey,
                inferredColorsByItem,
                inferredColorsByItemConfidence,
                debugRawCosineFirst: shopLookDebugRawCosineFirstEnv(),
                sessionId: options.sessionId,
                userId: options.userId,
                sessionFilters: options.sessionFilters ?? undefined,
              });
            }
          }

          const lowQualityFallbackWanted =
            shopLookLowQualityMultiCropFallbackEnabled() &&
            detectionSearchCalls < detectionSearchCallLimit &&
            shouldUseLowQualityMultiCropFallback(detection) &&
            similarResult.results.length === 0;
          if (lowQualityFallbackWanted) {
            const expandedRaw = expandDetectionBox(detection.box, imageWidth, imageHeight, 0.22);
            let expandedBox = expandedRaw;
            try {
              const procMeta = await sharp(queryProcessBuf).metadata();
              const pw = procMeta.width ?? 0;
              const ph = procMeta.height ?? 0;
              if (pw > 0 && ph > 0 && (pw !== imageWidth || ph !== imageHeight)) {
                expandedBox = scalePixelBoxToImageDims(expandedRaw, imageWidth, imageHeight, pw, ph);
              }
            } catch {
              // keep raw-space box if process metadata is unavailable
            }

            const [expandedEmb, centerEmb] = await Promise.all([
              processImageForGarmentEmbeddingWithOptionalBox(buffer, queryProcessBuf, expandedBox).catch(() => null),
              processImageForGarmentEmbeddingWithOptionalBox(buffer, queryProcessBuf, null).catch(() => null),
            ]);

            const altVectors = [expandedEmb, centerEmb].filter(
              (v): v is number[] => Array.isArray(v) && v.length > 0,
            );
            const remainingSearchBudget = Math.max(0, detectionSearchCallLimit - detectionSearchCalls);
            const altResults = await Promise.all(
              altVectors.slice(0, remainingSearchBudget).map((alt, idx) =>
                runDetectionSearch(`fallback_multicrop_${idx + 1}`, {
                  imageEmbedding: alt,
                  imageEmbeddingGarment: alt,
                  imageBuffer: queryProcessBuf,
                  pHash: sourceImagePHash,
                  detectionYoloConfidence: detection.confidence,
                  detectionProductCategory: categoryMapping.productCategory,
                  filters,
                  softProductTypeHints: softProductTypeHints.length > 0 ? softProductTypeHints : undefined,
                  limit: detectionRetrievalLimit,
                  similarityThreshold: detectionSimilarityThreshold,
                  includeRelated: false,
                  predictedCategoryAisles,
                  knnField: knnFieldUsed,
                  forceHardCategoryFilter: forceHardCategoryFilterUsed,
                  relaxThresholdWhenEmpty: detectionRelaxThreshold,
                  blipSignal: detectionBlipSignal,
                  inferredPrimaryColor: inferredPrimaryColorForSearch,
                  inferredColorKey: itemColorKey,
                  inferredColorsByItem,
                  inferredColorsByItemConfidence,
                  debugRawCosineFirst: shopLookDebugRawCosineFirstEnv(),
                  sessionId: options.sessionId,
                  userId: options.userId,
                  sessionFilters: options.sessionFilters ?? undefined,
                }),
              ),
            );
            for (const altResult of altResults) {
              similarResult = {
                ...similarResult,
                results: mergeImageSearchResultsById(
                  similarResult.results,
                  altResult.results,
                  retrievalLimit,
                ),
              };
              if (similarResult.results.length >= Math.max(4, Math.floor(retrievalLimit * 0.5))) break;
            }
          }

          if (hotPathDebug) {
            console.log(`[skip-trace] detection="${label}" after_knn_search=${similarResult.results.length}`);
            const searchMeta = (similarResult as any)?.meta;
            if (searchMeta?.ordered_stage_counts) {
              console.log(`[skip-trace-stages] detection="${label}" ${JSON.stringify(searchMeta.ordered_stage_counts)}`);
            }
            const stageDropSamples = searchMeta?.stage_drop_samples;
            if (stageDropSamples && Object.keys(stageDropSamples).length > 0) {
              console.log(`[skip-trace-drops] detection="${label}" ${JSON.stringify(stageDropSamples)}`);
            }
          }

          knnCandidateCount = similarResult.results.length;

          precisionSafeResults = applyShopLookVisualPrecisionGuard(
            similarResult.results,
            categoryMapping.productCategory === "footwear" && (detection.area_ratio ?? 0) <= 0.02
              ? shopLookTinyFootwearRecoveryThreshold(detectionSimilarityThreshold)
              : detectionSimilarityThreshold,
            categoryMapping.productCategory,
          );

          if (hotPathDebug) {
            console.log(`[skip-trace] detection="${label}" after_precision_guard=${precisionSafeResults.length} (filtered_by=${similarResult.results.length - precisionSafeResults.length})`);
          }

          categorySafeResults = applyDetectionCategoryGuard(
            precisionSafeResults,
            detection.label,
            categoryMapping,
            String((filters as any).gender ?? ""),
          );

          sleeveSafeResults = applySleeveIntentGuard({
            products: categorySafeResults,
            detectionLabel: detection.label,
            categoryMapping,
          });

          if (hotPathDebug) {
            console.log(`[skip-trace] detection="${label}" after_category_guard=${categorySafeResults.length} (filtered_by=${precisionSafeResults.length - categorySafeResults.length})`);
          }

          // Apply formality filter if formal wear was detected from BLIP caption
          const minFormality = (filters as any).minFormality;
          if (minFormality && hotPathDebug) {
            console.log(`[formality-apply-main] detection="${detection.label}" minFormality=${minFormality} incoming=${sleeveSafeResults.length}`);
          }
          formalitySafeResults = applyFormalityFilter(sleeveSafeResults, minFormality);

          athleticSafeResults = applyAthleticMismatchGuard({
            products: formalitySafeResults,
            detectionLabel: label,
            productCategory: categoryMapping.productCategory,
            softStyle: String((filters as any).softStyle ?? ""),
            minFormality,
          });
          const guardedCountForRecovery = athleticSafeResults.length;

          if (hotPathDebug) {
            console.log(`[skip-trace] detection="${label}" after_sleeve_guard=${sleeveSafeResults.length} (filtered_by=${categorySafeResults.length - sleeveSafeResults.length})`);
            console.log(`[skip-trace] detection="${label}" after_formality_filter=${formalitySafeResults.length} (filtered_by=${sleeveSafeResults.length - formalitySafeResults.length})`);
            console.log(`[skip-trace] detection="${label}" after_athletic_guard=${athleticSafeResults.length} (filtered_by=${formalitySafeResults.length - athleticSafeResults.length})`);
          }

          if (athleticSafeResults.length === 0 && hotPathDebug) {
            const debugCategory = Array.isArray((filters as any).category)
              ? (filters as any).category.map((c: unknown) => String(c ?? "").trim()).filter(Boolean).join("|")
              : String((filters as any).category ?? "").trim();
            const debugProductTypes = Array.isArray((filters as any).productTypes)
              ? (filters as any).productTypes.map((t: unknown) => String(t ?? "").trim()).filter(Boolean)
              : [];
            console.log(`[skip-trace-WARN] detection="${label}" ZERO_RESULTS filters={category:"${debugCategory || "none"}", productTypes:[${debugProductTypes.join(",")}], softStyle:"${filters.softStyle}", minFormality:${minFormality}}`);
            const meta = (similarResult as any)?.meta;
            const pc = meta?.pipeline_counts;
            if (meta && pc) {
              console.log(
                `[skip-trace-meta] detection="${label}" raw_hits=${pc.raw_open_search_hits ?? 0} ranked=${pc.ranked_candidates ?? 0} visual_pass=${pc.threshold_passed_visual ?? 0} final_accept=${pc.hits_after_final_accept_min ?? 0} dedupe=${pc.hits_after_dedupe ?? 0} relaxed=${meta.threshold_relaxed ? 1 : 0} below_relevance=${meta.below_relevance_threshold ? 1 : 0} below_final_gate=${meta.below_final_relevance_gate ? 1 : 0}`,
              );
            }
          }

          similarResult = {
            ...similarResult,
            results: athleticSafeResults,
          };

          // Footwear can go sparse with crop-only embeddings; run recovery when the group
          // is empty or too small, not only for tiny boxes.
          // When BLIP/CLIP refined the label to a specific subtype (e.g. "shoe" → "boots"),
          // raise the count threshold so sparse-but-specific results still trigger a
          // recovery that uses the refined softProductTypeHints.
          const footwearSubtypeWasRefined =
            categoryMapping.productCategory === "footwear" &&
            label !== rawLabel &&
            label !== "shoe" &&
            label !== "shoes";
          const footwearLowCountThreshold = footwearSubtypeWasRefined
            ? Math.max(3, Math.floor(resolvedLimitPerItem * 0.35))
            : Math.max(2, Math.floor(resolvedLimitPerItem * 0.2));
          if (
            detectionSearchCalls < detectionSearchCallLimit &&
            similarResult.results.length < footwearLowCountThreshold &&
            categoryMapping.productCategory === "footwear"
          ) {
            if (hotPathDebug) {
              console.log(`[recovery-attempt] detection="${label}" type=footwear_recovery reason="low_count(${similarResult.results.length})" subtype_refined=${footwearSubtypeWasRefined}`);
            }
            const footwearTerms = hardCategoryTermsForDetection(label, categoryMapping, {
              confidence: detection.confidence,
              areaRatio: detection.area_ratio,
            });
            const footwearFilters: Partial<import("./types").SearchFilters> = {};
            Object.assign(
              footwearFilters,
              mergeImageSearchSessionFilters(
                footwearFilters,
                options.sessionFilters ?? (options.sessionId ? (getSession(options.sessionId).accumulatedFilters as Record<string, unknown>) : null),
              ),
            );
            if (footwearTerms.length > 0) {
              footwearFilters.category = footwearTerms.length === 1 ? footwearTerms[0] : footwearTerms;
            }
            if (filters.gender) footwearFilters.gender = filters.gender;
            if (filters.ageGroup) footwearFilters.ageGroup = filters.ageGroup;

            const recoveryEmbedding = await processImageForEmbedding(queryProcessBuf).catch(() => null);
            const recoveryVectors: number[][] = [];
            if (Array.isArray(recoveryEmbedding) && recoveryEmbedding.length > 0) {
              recoveryVectors.push(recoveryEmbedding);
            }
            if (Array.isArray(finalEmbedding) && finalEmbedding.length > 0) {
              recoveryVectors.push(finalEmbedding);
            }

            const footwearSearchBudget = Math.max(0, detectionSearchCallLimit - detectionSearchCalls);
            const footwearRecoveries = await Promise.all(
              recoveryVectors.slice(0, footwearSearchBudget).map((recoveryVector, idx) =>
                runDetectionSearch(`recovery_footwear_${idx + 1}`, {
                  imageEmbedding: recoveryVector,
                  imageBuffer: queryProcessBuf,
                  pHash: sourceImagePHash,
                  detectionYoloConfidence: detection.confidence,
                  detectionProductCategory: categoryMapping.productCategory,
                  filters: footwearFilters,
                  // Pass refined subtype hints (e.g. "boots") so the recovery search
                  // targets the correct subtype, not generic "footwear".
                  softProductTypeHints: softProductTypeHints.length > 0 ? softProductTypeHints : undefined,
                  limit: detectionRetrievalLimit,
                  similarityThreshold: shopLookFootwearRecoveryThreshold(similarityThreshold, detection.area_ratio ?? 0),
                  includeRelated: false,
                  knnField: "embedding",
                  forceHardCategoryFilter: true,
                  relaxThresholdWhenEmpty: true,
                  blipSignal: detectionBlipSignal,
                  inferredPrimaryColor: inferredPrimaryColorForSearch,
                  inferredColorKey: itemColorKey,
                  inferredColorsByItem,
                  inferredColorsByItemConfidence,
                  debugRawCosineFirst: shopLookDebugRawCosineFirstEnv(),
                  sessionId: options.sessionId,
                  userId: options.userId,
                  sessionFilters: options.sessionFilters ?? undefined,
                }),
              ),
            );

            for (const footwearRecovery of footwearRecoveries) {

              if (footwearRecovery.results.length > 0) {
                if (hotPathDebug) {
                  console.log(`[recovery-result] detection="${label}" type=footwear_recovery recovered=${footwearRecovery.results.length} products`);
                }
                similarResult = {
                  ...similarResult,
                  results: mergeImageSearchResultsById(
                    similarResult.results,
                    footwearRecovery.results,
                    retrievalLimit,
                  ),
                };
              }

              if (similarResult.results.length >= Math.max(2, Math.floor(resolvedLimitPerItem * 0.2))) {
                break;
              }
            }
          }

          const vestLikeRecovery = /\bvest\b/.test(String(label ?? "").toLowerCase());
          const topsRecoveryMinKeep = shopLookTopRecoveryMinKeep(resolvedLimitPerItem);
          if (
            detectionSearchCalls < detectionSearchCallLimit &&
            guardedCountForRecovery < topsRecoveryMinKeep &&
            categoryMapping.productCategory === "tops" &&
            (((detection.confidence ?? 0) >= 0.45 && (detection.area_ratio ?? 0) >= 0.02) ||
              (vestLikeRecovery &&
                (detection.confidence ?? 0) >= Math.min(shopLookVestRecoveryMinConfidence(), 0.45) &&
                (detection.area_ratio ?? 0) >= 0.02))
          ) {
            if (hotPathDebug) {
              console.log(
                `[recovery-attempt] detection="${label}" type=tops_recovery reason="low_count(${similarResult.results.length}<${topsRecoveryMinKeep}) + confidence/area qualified"`,
              );
            }
            const topTerms = hardCategoryTermsForDetection(label, categoryMapping, {
              confidence: detection.confidence,
              areaRatio: detection.area_ratio,
            });
            const topFilters: Partial<import("./types").SearchFilters> = {};
            Object.assign(
              topFilters,
              mergeImageSearchSessionFilters(
                topFilters,
                options.sessionFilters ?? (options.sessionId ? (getSession(options.sessionId).accumulatedFilters as Record<string, unknown>) : null),
              ),
            );
            if (topTerms.length > 0) {
              topFilters.category = topTerms.length === 1 ? topTerms[0] : topTerms;
            }
            if (filters.gender) topFilters.gender = filters.gender;
            if (filters.ageGroup) topFilters.ageGroup = filters.ageGroup;

            const recoveryEmbedding = await processImageForEmbedding(queryProcessBuf).catch(() => null);
            const recoveryVectors: number[][] = [];
            if (Array.isArray(finalEmbedding) && finalEmbedding.length > 0) recoveryVectors.push(finalEmbedding);
            if (Array.isArray(recoveryEmbedding) && recoveryEmbedding.length > 0) recoveryVectors.push(recoveryEmbedding);

            const topsSearchBudget = Math.max(0, detectionSearchCallLimit - detectionSearchCalls);
            const topRecoveries = await Promise.all(
              recoveryVectors.slice(0, topsSearchBudget).map((recoveryVector, idx) =>
                runDetectionSearch(`recovery_tops_${idx + 1}`, {
                  imageEmbedding: recoveryVector,
                  imageEmbeddingGarment:
                    Array.isArray(finalGarmentEmbedding) && finalGarmentEmbedding.length > 0
                      ? finalGarmentEmbedding
                      : undefined,
                  imageBuffer: queryProcessBuf,
                  pHash: sourceImagePHash,
                  detectionYoloConfidence: detection.confidence,
                  detectionProductCategory: categoryMapping.productCategory,
                  filters: topFilters,
                  limit: detectionRetrievalLimit,
                  similarityThreshold: shopLookTopRecoverySimilarityThreshold(similarityThreshold),
                  includeRelated: false,
                  knnField: knnFieldUsed,
                  forceHardCategoryFilter: true,
                  relaxThresholdWhenEmpty: true,
                  blipSignal: detectionBlipSignal,
                  inferredPrimaryColor: inferredPrimaryColorForSearch,
                  inferredColorKey: itemColorKey,
                  inferredColorsByItem,
                  inferredColorsByItemConfidence,
                  debugRawCosineFirst: shopLookDebugRawCosineFirstEnv(),
                  sessionId: options.sessionId,
                  userId: options.userId,
                  sessionFilters: options.sessionFilters ?? undefined,
                }),
              ),
            );

            for (const topRecovery of topRecoveries) {

              const topRecoveryCategorySafe = applyDetectionCategoryGuard(
                topRecovery.results,
                detection.label,
                categoryMapping,
                String((filters as any).gender ?? ""),
              );

              const topRecoverySleeveSafe = applySleeveIntentGuard({
                products: topRecoveryCategorySafe,
                detectionLabel: detection.label,
                categoryMapping,
              });

              const topRecoverySafeResults = applyAthleticMismatchGuard({
                products: topRecoverySleeveSafe,
                detectionLabel: label,
                productCategory: categoryMapping.productCategory,
                softStyle: String((filters as any).softStyle ?? ""),
                minFormality: Number((filters as any).minFormality ?? 0),
              });

              if (topRecoverySafeResults.length > 0) {
                if (hotPathDebug) {
                  console.log(`[recovery-result] detection="${label}" type=tops_recovery recovered=${topRecoverySafeResults.length} products`);
                }
                similarResult = {
                  ...similarResult,
                  results: mergeImageSearchResultsById(
                    similarResult.results,
                    topRecoverySafeResults,
                    retrievalLimit,
                  ),
                };
              }

              if (similarResult.results.length >= Math.max(2, Math.floor(resolvedLimitPerItem * 0.2))) {
                break;
              }
            }

          }

          const topOrDressCategory =
            categoryMapping.productCategory === "tops" || categoryMapping.productCategory === "dresses";
          const topOrDressMinKeep = categoryMapping.productCategory === "tops"
            ? topsRecoveryMinKeep
            : Math.max(3, Math.min(8, Math.floor(resolvedLimitPerItem * 0.35)));
          if (
            detectionSearchCalls < detectionSearchCallLimit &&
            topOrDressCategory &&
            guardedCountForRecovery < topOrDressMinKeep
          ) {
            const ablationTerms = hardCategoryTermsForDetection(label, categoryMapping, {
              confidence: detection.confidence,
              areaRatio: detection.area_ratio,
            });
            const ablationFilters: Partial<import("./types").SearchFilters> = {};
            if (ablationTerms.length > 0) {
              ablationFilters.category = ablationTerms.length === 1 ? ablationTerms[0] : ablationTerms;
            }
            if (strictAudienceLock && filters.gender) {
              ablationFilters.gender = filters.gender;
            }
            if (strictAudienceLock && filters.ageGroup) {
              ablationFilters.ageGroup = filters.ageGroup;
            }

            const ablationThreshold = categoryMapping.productCategory === "tops"
              ? shopLookTopRecoverySimilarityThreshold(similarityThreshold)
              : shopLookDressRecoverySimilarityThreshold(similarityThreshold);

            const ablation = await runDetectionSearch(`recovery_${categoryMapping.productCategory}_ablation`, {
              imageEmbedding: finalFullFrameEmbedding,
              imageEmbeddingGarment:
                Array.isArray(finalGarmentEmbedding) && finalGarmentEmbedding.length > 0
                  ? finalGarmentEmbedding
                  : undefined,
              imageBuffer: queryProcessBuf,
              pHash: sourceImagePHash,
              detectionYoloConfidence: detection.confidence,
              detectionProductCategory: categoryMapping.productCategory,
              filters: ablationFilters,
              softProductTypeHints,
              limit: detectionRetrievalLimit,
              similarityThreshold: ablationThreshold,
              includeRelated: false,
              knnField: knnFieldUsed,
              forceHardCategoryFilter: true,
              relaxThresholdWhenEmpty: true,
              blipSignal: detectionBlipSignal,
              inferredPrimaryColor: inferredPrimaryColorForSearch,
              inferredColorKey: itemColorKey,
              inferredColorsByItem,
              inferredColorsByItemConfidence,
              debugRawCosineFirst: shopLookDebugRawCosineFirstEnv(),
              sessionId: options.sessionId,
              userId: options.userId,
              sessionFilters: options.sessionFilters ?? undefined,
            });

            const ablationCategorySafe = applyDetectionCategoryGuard(
              ablation.results,
              detection.label,
              categoryMapping,
              String((ablationFilters as any).gender ?? ""),
            );
            const ablationSleeveSafe = applySleeveIntentGuard({
              products: ablationCategorySafe,
              detectionLabel: detection.label,
              categoryMapping,
            });
            const ablationFormalitySafe = applyFormalityFilter(
              ablationSleeveSafe,
              Number((filters as any).minFormality ?? 0),
            );
            const ablationSafeResults = applyAthleticMismatchGuard({
              products: ablationFormalitySafe,
              detectionLabel: label,
              productCategory: categoryMapping.productCategory,
              softStyle: String((filters as any).softStyle ?? ""),
              minFormality: Number((filters as any).minFormality ?? 0),
            });

            const currentStrength = detectionResultStrength(similarResult.results);
            const ablationStrength = detectionResultStrength(ablationSafeResults);
            const shouldUseAblation =
              ablationSafeResults.length > similarResult.results.length ||
              (ablationSafeResults.length >= Math.max(2, similarResult.results.length) && ablationStrength > currentStrength + 0.03);

            if (shouldUseAblation) {
              if (hotPathDebug) {
                console.log(
                  `[recovery-result] detection="${label}" type=${categoryMapping.productCategory}_ablation switched count=${similarResult.results.length}->${ablationSafeResults.length} strength=${currentStrength.toFixed(3)}->${ablationStrength.toFixed(3)}`,
                );
              }
              similarResult = {
                ...similarResult,
                results: ablationSafeResults,
              };
            }
          }

          // Final top fail-open rescue: if top remains empty after normal retries/ablation,
          // run staged recovery to keep non-zero results without opening casual drift.
          const formalTailoredTopIntent =
            isTailoredTopDetectionIntent(
              label,
              String(detection.raw_label ?? ""),
              Number((filters as any).minFormality ?? 0),
            );
          if (
            detectionSearchCalls < detectionSearchCallLimit &&
            categoryMapping.productCategory === "tops" &&
            guardedCountForRecovery === 0
          ) {
            const topRecoveryBaseThreshold = shopLookTopRecoverySimilarityThreshold(similarityThreshold);
            const stagedTopRecoveries: Array<{
              reason: string;
              categories: string[];
              threshold: number;
            }> = formalTailoredTopIntent
                ? [
                  {
                    reason: "recovery_tops_tailored_stage1",
                    categories: ["suit", "suits", "blazer", "blazers", "dress jacket", "sport coat", "waistcoat", "vest", "vests"],
                    threshold: Math.max(0.42, topRecoveryBaseThreshold),
                  },
                  {
                    reason: "recovery_tops_tailored_stage2",
                    categories: ["shirt", "shirts", "dress shirt", "top", "tops", "cardigan", "knitwear"],
                    threshold: Math.max(0.4, topRecoveryBaseThreshold - 0.02),
                  },
                ]
                : [
                  {
                    reason: "recovery_tops_casual_stage",
                    categories: ["tops", "top", "shirt", "blouse", "t-shirt", "sweater", "hoodie"],
                    threshold: Math.max(0.35, topRecoveryBaseThreshold - 0.04),
                  },
                ];

            for (const stage of stagedTopRecoveries) {
              if (detectionSearchCalls >= detectionSearchCallLimit) break;
              const stageFilters: Partial<import("./types").SearchFilters> = {};
              Object.assign(
                stageFilters,
                mergeImageSearchSessionFilters(
                  stageFilters,
                  options.sessionFilters ??
                  (options.sessionId ? (getSession(options.sessionId).accumulatedFilters as Record<string, unknown>) : null),
                ),
              );
              stageFilters.category = stage.categories;
              if (filters.gender) stageFilters.gender = filters.gender;
              if (filters.ageGroup) stageFilters.ageGroup = filters.ageGroup;

              // In final top fail-open recovery, relax inferred color gating to avoid zero-result collapse.
              const stageInferredPrimaryColor =
                categoryMapping.productCategory === "tops"
                  ? undefined
                  : inferredPrimaryColorForDetection;
              const stageResult = await runDetectionSearch(stage.reason, {
                imageEmbedding: finalFullFrameEmbedding,
                imageEmbeddingGarment:
                  Array.isArray(finalGarmentEmbedding) && finalGarmentEmbedding.length > 0
                    ? finalGarmentEmbedding
                    : undefined,
                imageBuffer: queryProcessBuf,
                pHash: sourceImagePHash,
                detectionYoloConfidence: detection.confidence,
                detectionProductCategory: categoryMapping.productCategory,
                filters: stageFilters,
                limit: detectionRetrievalLimit,
                similarityThreshold: stage.threshold,
                includeRelated: false,
                knnField: knnFieldUsed,
                forceHardCategoryFilter: true,
                relaxThresholdWhenEmpty: true,
                blipSignal: detectionBlipSignal,
                inferredPrimaryColor: stageInferredPrimaryColor,
                inferredColorKey: itemColorKey,
                inferredColorsByItem,
                inferredColorsByItemConfidence,
                debugRawCosineFirst: shopLookDebugRawCosineFirstEnv(),
                sessionId: options.sessionId,
                userId: options.userId,
                sessionFilters: options.sessionFilters ?? undefined,
              });

              const stageCategorySafe = applyDetectionCategoryGuard(
                stageResult.results,
                detection.label,
                categoryMapping,
                String((stageFilters as any).gender ?? ""),
              );
              const stageSleeveSafe = applySleeveIntentGuard({
                products: stageCategorySafe,
                detectionLabel: detection.label,
                categoryMapping,
              });
              const stageFormalitySafe = applyFormalityFilter(
                stageSleeveSafe,
                Number((filters as any).minFormality ?? 0),
              );
              const stageAthleticSafe = applyAthleticMismatchGuard({
                products: stageFormalitySafe,
                detectionLabel: label,
                productCategory: categoryMapping.productCategory,
                softStyle: String((filters as any).softStyle ?? ""),
                minFormality: Number((filters as any).minFormality ?? 0),
              });
              if (stageAthleticSafe.length > 0) {
                if (hotPathDebug) {
                  console.log(
                    `[recovery-stage] detection="${label}" stage=${stage.reason} recovered=${stageAthleticSafe.length}`,
                  );
                }
                similarResult = {
                  ...similarResult,
                  results: mergeImageSearchResultsById(similarResult.results, stageAthleticSafe, retrievalLimit),
                };
              }
              if (similarResult.results.length >= Math.max(2, Math.floor(resolvedLimitPerItem * 0.2))) break;
            }
          }

          // Bag recovery: when bag search returns no results, retry with relaxed filters
          // Bags are often tricky because:
          // 1. They can be small/partial in framing
          // 2. Crop embedding may not capture bag handle/texture well
          // 3. Catalog may have limited bag inventory
          if (
            detectionSearchCalls < detectionSearchCallLimit &&
            similarResult.results.length === 0 &&
            categoryMapping.productCategory === "bags"
          ) {
            if (hotPathDebug) {
              console.log(`[recovery-attempt] detection="${label}" type=bag_recovery reason="empty bag search"`);
            }
            const bagTerms = hardCategoryTermsForDetection(label, categoryMapping, {
              confidence: detection.confidence,
              areaRatio: detection.area_ratio,
            });
            const bagFilters: Partial<import("./types").SearchFilters> = {};
            Object.assign(
              bagFilters,
              mergeImageSearchSessionFilters(
                bagFilters,
                options.sessionFilters ?? (options.sessionId ? (getSession(options.sessionId).accumulatedFilters as Record<string, unknown>) : null),
              ),
            );
            if (bagTerms.length > 0) {
              bagFilters.category = bagTerms.length === 1 ? bagTerms[0] : bagTerms;
            }
            if (filters.gender) bagFilters.gender = filters.gender;
            if (filters.ageGroup) bagFilters.ageGroup = filters.ageGroup;

            // Try with full-image embedding first (wider visual similarity range)
            const bagRecoveryVectors: number[][] = [];
            if (Array.isArray(finalEmbedding) && finalEmbedding.length > 0) {
              bagRecoveryVectors.push(finalEmbedding);
            }
            if (Array.isArray(finalGarmentEmbedding) && finalGarmentEmbedding.length > 0) {
              bagRecoveryVectors.push(finalGarmentEmbedding);
            }

            const bagSearchBudget = Math.max(0, detectionSearchCallLimit - detectionSearchCalls);
            const bagRecoveries = await Promise.all(
              bagRecoveryVectors.slice(0, bagSearchBudget).map((recoveryVector, idx) =>
                runDetectionSearch(`recovery_bag_${idx + 1}`, {
                  imageEmbedding: recoveryVector,
                  imageEmbeddingGarment: recoveryVector,
                  imageBuffer: queryProcessBuf,
                  pHash: sourceImagePHash,
                  detectionYoloConfidence: detection.confidence,
                  detectionProductCategory: categoryMapping.productCategory,
                  filters: bagFilters,
                  limit: detectionRetrievalLimit,
                  // Relax similarity threshold for bags since they're difficult to match visually
                  similarityThreshold: Math.max(0.35, similarityThreshold * 0.75),
                  includeRelated: false,
                  knnField: "embedding",
                  forceHardCategoryFilter: true,
                  relaxThresholdWhenEmpty: true,
                  blipSignal: detectionBlipSignal,
                  inferredPrimaryColor: inferredPrimaryColorForSearch,
                  inferredColorKey: itemColorKey,
                  inferredColorsByItem,
                  inferredColorsByItemConfidence,
                  debugRawCosineFirst: shopLookDebugRawCosineFirstEnv(),
                  sessionId: options.sessionId,
                  userId: options.userId,
                  sessionFilters: options.sessionFilters ?? undefined,
                }),
              ),
            );

            for (const bagRecovery of bagRecoveries) {
              const bagRecoveryCategorySafe = applyDetectionCategoryGuard(
                bagRecovery.results,
                detection.label,
                categoryMapping,
                String((filters as any).gender ?? ""),
              );
              const bagRecoverySafeResults = applyAthleticMismatchGuard({
                products: bagRecoveryCategorySafe,
                detectionLabel: label,
                productCategory: categoryMapping.productCategory,
                softStyle: String((filters as any).softStyle ?? ""),
                minFormality: Number((filters as any).minFormality ?? 0),
              });

              if (bagRecoverySafeResults.length > 0) {
                if (hotPathDebug) {
                  console.log(`[recovery-result] detection="${label}" type=bag_recovery recovered=${bagRecoverySafeResults.length} products`);
                }
                similarResult = {
                  ...similarResult,
                  results: mergeImageSearchResultsById(
                    similarResult.results,
                    bagRecoverySafeResults,
                    retrievalLimit,
                  ),
                };
              }

              if (similarResult.results.length >= Math.max(1, Math.floor(resolvedLimitPerItem * 0.15))) {
                break;
              }
            }
          }

          if (!mainPathOnly && similarResult.results.length === 0) {
            // Fail-safe: avoid zero-result detections when we already have category-safe
            // candidates, but keep quality by using a strict score floor.
            const desiredSleeve = inferSleeveIntentFromDetectionLabel(detection.label);
            const sleeveGateStrict =
              Boolean(desiredSleeve) &&
              (categoryMapping.productCategory === "tops" ||
                categoryMapping.productCategory === "dresses" ||
                categoryMapping.productCategory === "outerwear");
            const baseFallbackPool = mergeImageSearchResultsById(
              formalitySafeResults,
              sleeveSafeResults,
              retrievalLimit,
            );
            const fallbackPool = sleeveGateStrict
              ? baseFallbackPool
              : mergeImageSearchResultsById(baseFallbackPool, categorySafeResults, retrievalLimit);
            const safeFallback = buildSafeNonEmptyFallback({
              candidates: fallbackPool,
              productCategory: categoryMapping.productCategory,
              similarityThreshold,
              limit: Math.max(1, Math.min(resolvedLimitPerItem, 4)),
            });
            if (safeFallback.length > 0) {
              similarResult = {
                ...similarResult,
                results: safeFallback,
              };
              if (hotPathDebug) {
                console.log(
                  `[nonempty-fallback] detection="${label}" recovered=${safeFallback.length} category=${categoryMapping.productCategory}`,
                );
              }
            }
          }

          }

          if (similarResult.results.length === 0 && !includeEmptyDetectionGroups) {
            if (hotPathDebug) {
              console.log(`[detection-skip] label="${label}" reason="empty_and_includeEmpty=false"`);
            }
            return null;
          }

          if (hotPathDebug) {
            console.info(
              `[detection-substep-timing] label="${label}" crop_clip_ms=${cropEmbedMs} blip_ms=${detCaptionMs} search_first_ms=${searchFirstMs} total_task_ms=${Date.now() - detectionTaskStartedAt}`,
            );
            console.log(`[detection-result] label="${label}" final_count=${similarResult.results.length}`);
          }

          const droppedByOtherGates = Math.max(0, knnCandidateCount - athleticSafeResults.length);

          return {
            detection: {
              label: detection.label,
              confidence: detection.confidence,
              box: detection.box,
              area_ratio: detection.area_ratio,
              style: detection.style,
              mask: detection.mask,
            },
            category: categoryMapping.productCategory,
            products: similarResult.results,
            count: similarResult.results.length,
            ...(detectionIndex !== undefined ? { detectionIndex } : {}),
            appliedFilters: {
              category: filters.category,
              color: (filters as any).color,
              productTypes: filters.productTypes,
              gender: filters.gender,
              ageGroup: filters.ageGroup,
              softStyle: filters.softStyle,
              minFormality: (filters as any).minFormality,
              sleeve: (filters as any).sleeve,
              length: (filters as any).length,
            },
            debug: {
              knnCandidateCount,
              afterPrecisionGuard: precisionSafeResults.length,
              afterCategoryGuard: categorySafeResults.length,
              afterSleeveGuard: sleeveSafeResults.length,
              afterFormalityFilter: formalitySafeResults.length,
              afterAthleticGuard: athleticSafeResults.length,
              afterRecovery: similarResult.results.length,
              searchCallsUsed: detectionSearchCalls,
              searchCallLimit: detectionSearchCallLimit,
              searchReasonsExecuted,
              searchReasonsSkipped,
              droppedByOtherGates,
              droppedByFinalRelevance: 0,
              droppedByColorGate: 0,
            },
          } as DetectionSimilarProducts;
        } finally {
          detectionSearchTotalDurations.push(detectionSearchTotalMs);
          detectionSearchCallCounts.push(detectionSearchCalls);
          detectionTaskDurations.push(Date.now() - detectionTaskStartedAt);
        }
      },
    );
    const detectionEmbeddingFallbackCount = Math.max(
      0,
      detectionJobs.length - detectionEmbeddingBatchReady,
    );
    if (process.env.NODE_ENV !== "production" || String(process.env.SEARCH_DEBUG ?? "") === "1") {
      console.info("[image-search][embedding-batch-usage]", {
        detectionJobs: detectionJobs.length,
        embeddingBatchReady: detectionEmbeddingBatchReady,
        embeddingFallbackCount: detectionEmbeddingFallbackCount,
        embeddingBatchMs: detectionEmbeddingBatchMs,
      });
    }
    similarityTimings.detectionTaskWallMs = Date.now() - detectionTaskWallStartedAt;
    if (detectionTaskDurations.length > 0) {
      const detectionTaskTotalMs = detectionTaskDurations.reduce((sum, value) => sum + value, 0);
      similarityTimings.detectionTaskTotalMs = detectionTaskTotalMs;
      similarityTimings.detectionTaskAvgMs = Math.round(detectionTaskTotalMs / detectionTaskDurations.length);
      similarityTimings.detectionTaskMaxMs = Math.max(...detectionTaskDurations);
    }
    if (detectionCropEmbedDurations.length > 0) {
      const total = detectionCropEmbedDurations.reduce((sum, value) => sum + value, 0);
      similarityTimings.detectionCropEmbedAvgMs = Math.round(total / detectionCropEmbedDurations.length);
      similarityTimings.detectionCropEmbedMaxMs = Math.max(...detectionCropEmbedDurations);
    }
    if (detectionBlipDurations.length > 0) {
      const total = detectionBlipDurations.reduce((sum, value) => sum + value, 0);
      similarityTimings.detectionBlipAvgMs = Math.round(total / detectionBlipDurations.length);
      similarityTimings.detectionBlipMaxMs = Math.max(...detectionBlipDurations);
    }
    if (detectionSearchFirstDurations.length > 0) {
      const total = detectionSearchFirstDurations.reduce((sum, value) => sum + value, 0);
      similarityTimings.detectionSearchFirstAvgMs = Math.round(total / detectionSearchFirstDurations.length);
      similarityTimings.detectionSearchFirstMaxMs = Math.max(...detectionSearchFirstDurations);
    }
    if (detectionSearchTotalDurations.length > 0) {
      const total = detectionSearchTotalDurations.reduce((sum, value) => sum + value, 0);
      similarityTimings.detectionSearchTotalAvgMs = Math.round(total / detectionSearchTotalDurations.length);
      similarityTimings.detectionSearchTotalMaxMs = Math.max(...detectionSearchTotalDurations);
    }
    if (detectionSearchCallCounts.length > 0) {
      const total = detectionSearchCallCounts.reduce((sum, value) => sum + value, 0);
      similarityTimings.detectionSearchCallsAvg = Math.round((total / detectionSearchCallCounts.length) * 100) / 100;
      similarityTimings.detectionSearchCallsMax = Math.max(...detectionSearchCallCounts);
    }

    const groupedResults: DetectionSimilarProducts[] = [];
    let totalProducts = 0;

    const postProcessingStartedAt = Date.now();
    for (const outcome of settled) {
      if (outcome.status === "fulfilled" && outcome.value) {
        groupedResults.push(outcome.value);
        totalProducts += outcome.value.count;
      } else if (outcome.status === "rejected") {
        console.error("Failed to find similar products for a detection:", outcome.reason);
      }
    }

    const postRanked = applyGroupedPostRanking(
      groupedResults,
      imageCrossGroupDedupeEnabled(),
      collapseVariantGroups !== false,
    );
    const finalGroupedResults = postRanked.rows;

    // Apply minimum relevance threshold filter to each detection's products
    const minRelevanceThreshold = shopLookMinFinalRelevanceThreshold();
    if (hotPathDebug) {
      console.log(`[relevance-gate] applying minRelevance=${minRelevanceThreshold} to filter low-relevance products`);
    }

    const relevanceFilteredResults = finalGroupedResults.map((detection) => {
      const beforeProducts = Array.isArray(detection.products) ? detection.products : [];
      const categoryNorm = String(detection.category ?? "").toLowerCase().trim();
      const appliedCategoryText = Array.isArray((detection.appliedFilters as any)?.category)
        ? (detection.appliedFilters as any).category.join(" ")
        : String((detection.appliedFilters as any)?.category ?? "");
      const suitCaptionTailoredFallback =
        categoryNorm === "outerwear" &&
        /\b(tailored|suit|suits|tuxedo|tuxedos|waistcoat|waistcoats|vest|vests|gilet|gilets|structured\s+jacket|tailored\s+jacket)\b/.test(
          appliedCategoryText.toLowerCase(),
        );
      const detectionMinRelevanceThreshold =
        categoryNorm === "tops"
          ? Math.min(minRelevanceThreshold, 0.3)
          : categoryNorm === "bottoms"
            ? Math.min(minRelevanceThreshold, 0.3)
            : categoryNorm === "dresses"
              ? Math.min(minRelevanceThreshold, 0.28)
              : categoryNorm === "footwear"
                ? Math.min(minRelevanceThreshold, 0.28)
                : suitCaptionTailoredFallback
                  ? Math.min(minRelevanceThreshold, 0.28)
                : minRelevanceThreshold;
      const preserveCountForDetection = (isCoreOutfitCategory(detection.category) || suitCaptionTailoredFallback)
        ? Math.min(3, Math.max(1, Math.floor(resolvedLimitPerItem * 0.12)))
        : 0;
      const inferredDesiredColorState = (() => {
        const explicitColor = (detection.appliedFilters as any)?.color;
        if (explicitColor != null && String(explicitColor).trim().length > 0) {
          return { color: explicitColor, confidence: 1 };
        }
        const rawIndex = Number((detection as any)?.detectionIndex);
        const hasIndex = Number.isFinite(rawIndex) && rawIndex >= 0;
        const detLabel = String((detection as any)?.detection?.label ?? "").trim();
        if (!hasIndex || !detLabel) return { color: undefined, confidence: 0 };
        const colorKey = detectionColorKey(detLabel, Math.floor(rawIndex));
        const inferred = inferredColorsByItem[colorKey];
        const inferredConfidence = Number(inferredColorsByItemConfidence[colorKey] ?? 0);
        return inferred && inferredConfidence >= 0.4
          ? { color: inferred, confidence: inferredConfidence }
          : { color: undefined, confidence: inferredConfidence };
      })();
      if (hotPathDebug) {
        console.log(
          `[relevance-debug] detection="${detection.detection?.label ?? "unknown"}" category="${detection.category}" desiredColor="${String(inferredDesiredColorState.color ?? "")}" source=${(detection.appliedFilters as any)?.color ? "explicit" : "inferred_or_none"}`,
        );
      }
      const afterProducts = applyRelevanceThresholdFilter(beforeProducts, detectionMinRelevanceThreshold, {
        preserveAtLeastOne: isCoreOutfitCategory(detection.category) || suitCaptionTailoredFallback,
        preserveAtLeastCount: preserveCountForDetection,
        detectionLabel: detection.detection?.label,
        category: detection.category,
        desiredColor: inferredDesiredColorState.color,
        desiredColorConfidence: inferredDesiredColorState.confidence,
      });
      const droppedByFinalRelevance = Math.max(0, beforeProducts.length - afterProducts.length);
      const droppedByColorGate = beforeProducts.filter((prod) => {
        const relevance = Number((prod as any)?.finalRelevance01 ?? 0);
        const source = String((prod as any)?.explain?.finalRelevanceSource ?? "").toLowerCase();
        return relevance < detectionMinRelevanceThreshold && source.includes("color");
      }).length;
      if (hotPathDebug && droppedByFinalRelevance > 0) {
        console.log(
          `[relevance-gate-drop] detection="${detection.detection?.label ?? "unknown"}" category="${detection.category}" before=${beforeProducts.length} after=${afterProducts.length} threshold=${detectionMinRelevanceThreshold} dropped=${droppedByFinalRelevance} color_drops=${droppedByColorGate} samples=${JSON.stringify(sampleDroppedProductsForLog(beforeProducts, afterProducts))}`,
        );
      }
      return {
        ...detection,
        products: afterProducts,
        count: 0, // Will be recalculated below
        debug: {
          ...(detection.debug ?? {
            knnCandidateCount: beforeProducts.length,
            afterPrecisionGuard: beforeProducts.length,
            afterCategoryGuard: beforeProducts.length,
            afterSleeveGuard: beforeProducts.length,
            afterFormalityFilter: beforeProducts.length,
            afterAthleticGuard: beforeProducts.length,
            afterRecovery: beforeProducts.length,
            droppedByOtherGates: 0,
            droppedByFinalRelevance: 0,
            droppedByColorGate: 0,
          }),
          droppedByFinalRelevance,
          droppedByColorGate,
        },
      };
    });

    // Recalculate counts and total after filtering
    let newTotalProducts = 0;
    for (const result of relevanceFilteredResults) {
      result.count = result.products.length;
      newTotalProducts += result.count;
    }

    const relevanceFilteredResultsWithColorSource = relevanceFilteredResults.map((row) => {
      const sortedRow = sortDetectionProductsByFinalRelevance(row);
      const rawIndex = Number((sortedRow as any)?.detectionIndex);
      const hasIndex = Number.isFinite(rawIndex) && rawIndex >= 0;
      const detLabel = String((sortedRow as any)?.detection?.label ?? "").trim();
      if (!hasIndex || !detLabel) return sortedRow;
      const colorKey = detectionColorKey(detLabel, Math.floor(rawIndex));
      const colorSource = detectionColorSourceName(inferredColorsByItemSource[colorKey]);
      return {
        ...sortedRow,
        detection: {
          ...(sortedRow as any).detection,
          colorSource,
        },
      };
    });

    if (hotPathDebug) {
      console.log(
        `[relevance-gate] total products before=${totalProducts} -> after=${newTotalProducts} (threshold=${minRelevanceThreshold})`,
      );
    }

    const totalDetectionJobs = detectionJobs.length;
    let coveredDetections = 0;
    for (const result of relevanceFilteredResults) {
      if (result.count > 0) {
        coveredDetections += 1;
      }
    }

    const emptyDetections = totalDetectionJobs - coveredDetections;
    const coverageRatio =
      totalDetectionJobs > 0 ? coveredDetections / totalDetectionJobs : 0;

    const baseDetectionsForCoherence = Array.isArray(analysisResult.detection?.items)
      ? (analysisResult.detection.items as DetectionWithColor[])
      : [];
    const itemsForCoherence = baseDetectionsForCoherence.map((detection, index) => {
      const colorKey = detectionColorKey(detection.label, index);
      return {
        ...detection,
        dominantColor: inferredColorsByItem[colorKey] ?? detection.dominantColor,
        colorConfidence: inferredColorsByItemConfidence[colorKey] ?? detection.colorConfidence,
        colorSource: detectionColorSourceName(inferredColorsByItemSource[colorKey]),
      } as DetectionWithColor;
    });

    const coherenceDetections = dedupeOverlappingDetections(itemsForCoherence);
    const outfitCoherence =
      coherenceDetections.length > 0
        ? computeOutfitCoherence(coherenceDetections)
        : undefined;

    if (process.env.NODE_ENV !== "production" || String(process.env.SEARCH_DEBUG ?? "") === "1") {
      console.info("[image-search][blip-enrichment]", {
        stage: "analyzeAndFindSimilar",
        fullStructuredConfidence: Math.round(blipStructuredConfidence * 1000) / 1000,
        ...obs,
      });
    }
    similarityTimings.postProcessingMs = Date.now() - postProcessingStartedAt;
    similarityTimings.totalMs = Date.now() - similarityStartedAt;

    const itemPrimary = derivePrimaryColorFromItemsWithConfidence(
      inferredColorsByItem,
      inferredColorsByItemConfidence,
    );
    const resolvedPrimaryColor = pickColorByHighestConfidence([
      { color: captionPrimaryColor, confidence: captionPrimaryColorConfidence },
      { color: dominantPrimaryColor, confidence: dominantPrimaryColorConfidence },
      { color: itemPrimary.color, confidence: itemPrimary.confidence },
    ]);

    return {
      ...analysisResult,
      blipCaption,
      inferredAudience,
      inferredPrimaryColor: resolvedPrimaryColor,
      inferredColorsByItem,
      inferredColorsByItemConfidence,
      inferredColorsByItemSource: Object.fromEntries(
        Object.entries(inferredColorsByItemSource).map(([k, v]) => [k, detectionColorSourceName(v)]),
      ),
      similarProducts: {
        byDetection: relevanceFilteredResultsWithColorSource,
        totalProducts: newTotalProducts,
        threshold: similarityThreshold,
        detectedCategories,
        shopTheLookStats: {
          totalDetections: totalDetectionJobs,
          coveredDetections,
          emptyDetections,
          coverageRatio,
          mainPathOnly,
        },
      },
      outfitCoherence,
      timings: {
        ...(analysisResult.timings ?? { totalMs: 0 }),
        totalMs: Date.now() - pipelineStartedAt,
        analysis: analysisResult.timings?.analysis,
        similarity: similarityTimings,
      },
    };
  }

  /**
   * Find similar products from an image URL, grouped by detection
   */
  async findSimilarFromUrl(
    imageUrl: string,
    options: {
      similarityThreshold?: number;
      limitPerItem?: number;
      filterByCategory?: string;
      resultsPage?: number;
      resultsPageSize?: number;
    } = {}
  ): Promise<GroupedSimilarProducts> {
    const {
      similarityThreshold = config.clip.imageSimilarityThreshold,
      limitPerItem = defaultShopLookResultBudget(),
      filterByCategory,
      resultsPage,
      resultsPageSize,
    } = options;

    // Download image
    const response = await fetch(imageUrl, {
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const filename = imageUrl.split("/").pop() || "image.jpg";

    // Use the main method
    const result = await this.analyzeAndFindSimilar(buffer, filename, {
      store: false,
      similarityThreshold,
      similarLimitPerItem: limitPerItem,
      resultsPage,
      resultsPageSize,
      filterByDetectedCategory: !filterByCategory, // Use custom filter if provided
    });

    return result.similarProducts || {
      byDetection: [],
      totalProducts: 0,
      threshold: similarityThreshold,
      detectedCategories: [],
    };
  }

  /**
   * Map YOLO detection labels to product categories
   * @deprecated Use imported mapDetectionToCategory from categoryMapper for full mapping
   */
  private mapDetectionToCategoryLegacy(detectionLabel: string): string {
    // Use the new enhanced category mapper
    const mapping = mapDetectionToCategory(detectionLabel);
    return mapping.productCategory;
  }

  /**
   * Quick detection only - no storage, no embedding
   *
   * Use this when you just need to know what fashion items are in an image.
   */
  async quickDetect(
    buffer: Buffer,
    filename: string,
    confidence: number = 0.45
  ): Promise<QuickDetectResult> {
    const result = await this.yoloClient.detectFromBuffer(buffer, filename, {
      confidence,
    });

    const imageWidth = result.image_size?.width ?? 0;
    const imageHeight = result.image_size?.height ?? 0;
    const enrichedDetections = result.detections.map((d) =>
      ensureStyleAndMask(d, imageWidth, imageHeight),
    );

    return {
      success: result.success,
      items: enrichedDetections,
      count: result.count,
      summary: result.summary,
      composition: extractOutfitComposition(enrichedDetections),
      imageSize: result.image_size,
    };
  }

  /**
   * Quick detection from URL
   */
  async quickDetectFromUrl(
    url: string,
    confidence: number = 0.45
  ): Promise<QuickDetectResult> {
    const result = await this.yoloClient.detectFromUrl(url, { confidence });

    const imageWidth = result.image_size?.width ?? 0;
    const imageHeight = result.image_size?.height ?? 0;
    const enrichedDetections = result.detections.map((d) =>
      ensureStyleAndMask(d, imageWidth, imageHeight),
    );

    return {
      success: result.success,
      items: enrichedDetections,
      count: result.count,
      summary: result.summary,
      composition: extractOutfitComposition(enrichedDetections),
      imageSize: result.image_size,
    };
  }

  /**
   * Batch detection for multiple images
   */
  async batchDetect(
    images: Array<{ buffer: Buffer; filename: string }>,
    confidence: number = 0.25
  ): Promise<
    Array<{
      filename: string;
      result?: QuickDetectResult;
      error?: string;
    }>
  > {
    const results = await this.yoloClient.detectBatch(images, confidence);

    return results.map((r) => ({
      filename: r.filename,
      result: r.result
        ? {
          success: r.result.success,
          items: r.result.detections.map((d) => {
            const w = r.result!.image_size?.width ?? 0;
            const h = r.result!.image_size?.height ?? 0;
            return ensureStyleAndMask(d, w, h);
          }),
          count: r.result.count,
          summary: r.result.summary,
          composition: extractOutfitComposition(
            r.result.detections.map((d) => {
              const w = r.result!.image_size?.width ?? 0;
              const h = r.result!.image_size?.height ?? 0;
              return ensureStyleAndMask(d, w, h);
            }),
          ),
          imageSize: r.result.image_size,
        }
        : undefined,
      error: r.error,
    }));
  }

  /**
   * Analyze with selective item processing
   *
   * Allows users to:
   * - Select specific detected items to process
   * - Exclude certain items
   * - Add their own bounding boxes for manual detection
   */
  async analyzeWithSelection(
    buffer: Buffer,
    filename: string,
    options: SelectiveAnalysisOptions = {}
  ): Promise<FullAnalysisResult> {
    const {
      selectedItemIndices,
      excludedItemIndices = [],
      userDefinedBoxes = [],
      preprocessing,
      resultsPage,
      resultsPageSize,
      ...baseOptions
    } = options;
    const resolvedLimitPerItem = resolveShopLookLimit(options.similarLimitPerItem);
    const resolvedResultsPage = resolveShopLookPage(resultsPage);
    const resolvedResultsPageSize = resolveShopLookPageSize(resultsPageSize, resolvedLimitPerItem);
    const retrievalLimit = resolveShopLookRetrievalLimit(
      Math.max(resolvedLimitPerItem, resolvedResultsPage * resolvedResultsPageSize) *
      shopLookRecallMultiplier(),
    );

    // Get image dimensions
    const metadata = await sharp(buffer).metadata();
    const imageWidth = metadata.width || 0;
    const imageHeight = metadata.height || 0;

    // Run standard analysis with preprocessing options
    const fullResult = await this.analyzeImage(buffer, filename, {
      ...baseOptions,
      generateEmbedding: true,
      preprocessing,
    });
    const sourceImagePHash = await computePHash(buffer).catch(() => undefined);
    const { buffer: fullProcessBuf } = await prepareBufferForImageSearchQuery(buffer);

    if (!fullResult.detection) {
      return {
        ...fullResult,
        similarProducts: undefined,
        outfitCoherence: undefined,
      };
    }

    // Filter detections based on selection/exclusion
    let itemsToProcess = fullResult.detection.items;
    let originalIndices: number[] = fullResult.detection.items.map((_, i) => i);

    if (selectedItemIndices && selectedItemIndices.length > 0) {
      // Only process selected items
      const validIndices = selectedItemIndices.filter(
        (i) => i >= 0 && i < fullResult.detection!.items.length
      );
      itemsToProcess = validIndices.map((i) => fullResult.detection!.items[i]);
      originalIndices = validIndices;
    }

    if (excludedItemIndices.length > 0) {
      const excludeSet = new Set(excludedItemIndices);
      const kept: typeof itemsToProcess = [];
      const keptOriginalIndices: number[] = [];
      for (let i = 0; i < itemsToProcess.length; i++) {
        const originalIdx = originalIndices[i];
        if (excludeSet.has(originalIdx)) continue;
        kept.push(itemsToProcess[i]);
        keptOriginalIndices.push(originalIdx);
      }
      itemsToProcess = kept;
      originalIndices = keptOriginalIndices;
    }

    // Add user-defined boxes as synthetic detections
    const userDetections: Detection[] = userDefinedBoxes.map((udb, i) => ({
      label: udb.label || udb.categoryHint || `user_region_${i}`,
      raw_label: `user_defined_${i}`,
      confidence: 1.0, // User-defined = high confidence
      box: udb.box,
      box_normalized: {
        x1: udb.box.x1 / imageWidth,
        y1: udb.box.y1 / imageHeight,
        x2: udb.box.x2 / imageWidth,
        y2: udb.box.y2 / imageHeight,
      },
      area_ratio:
        ((udb.box.x2 - udb.box.x1) * (udb.box.y2 - udb.box.y1)) /
        (imageWidth * imageHeight),
    }));

    // Ensure user-defined detections also expose style + mask to callers.
    const enrichedUserDetections = userDetections.map((d) =>
      ensureStyleAndMask(d, imageWidth, imageHeight),
    );

    // Combine YOLO + user detections
    const allItemsToProcess = [...itemsToProcess, ...enrichedUserDetections];

    // Process each item for similar products
    const groupedResults: SelectiveDetectionResult[] = [];
    let totalProducts = 0;

    // Infer audience & dominant color once for the full image.
    const obs = {
      fullCaptionHit: false,
      detectionCaptionHits: 0,
      detectionCaptionMisses: 0,
      detectionCaptionAccepted: 0,
      detectionCaptionRejected: 0,
    };
    let blipCaption: string | null = null;
    let blipStructured = buildStructuredBlipOutput("");
    let blipStructuredConfidence = 0;
    let fullBlipSignal: BlipSignal | undefined = undefined;
    if (fullResult.services?.blip) {
      blipCaption = await getCachedCaption(buffer, "full");
      obs.fullCaptionHit = Boolean(blipCaption && blipCaption.trim().length > 0);
      blipStructured = buildStructuredBlipOutput(blipCaption);
      blipStructuredConfidence = blipStructured.confidence;
      fullBlipSignal = buildBlipSignal(blipStructured, blipStructuredConfidence);
    }
    let inferredAudience: ReturnType<typeof inferAudienceFromCaption> =
      imageInferAudienceGenderEnv() && blipStructuredConfidence >= imageBlipSoftHintConfidenceMin()
        ? {
          gender: blipStructured.audience.gender,
          ageGroup: blipStructured.audience.ageGroup,
        }
        : ({} as ReturnType<typeof inferAudienceFromCaption>);
    if (!inferredAudience.gender || !inferredAudience.ageGroup) {
      const fallbackAudience = inferApparelAudienceFallback({
        caption: blipCaption,
        detections: fullResult.detection.items,
      });
      if (!inferredAudience.gender && fallbackAudience.gender) {
        inferredAudience = {
          ...inferredAudience,
          gender: fallbackAudience.gender,
        };
      }
      if (!inferredAudience.ageGroup && fallbackAudience.ageGroup) {
        inferredAudience = {
          ...inferredAudience,
          ageGroup: fallbackAudience.ageGroup,
        };
      }
    }
    if (
      !inferredAudience.ageGroup &&
      (inferredAudience.gender === "boys" || inferredAudience.gender === "girls")
    ) {
      inferredAudience = {
        ...inferredAudience,
        ageGroup: "kids",
      };
    }

    const captionColors = blipCaption ? inferColorFromCaption(blipCaption) : {};
    const inferredColorsByItem: Record<string, string | null> = {};
    const inferredColorsByItemConfidence: Record<string, number> = {};
    const inferredColorsByItemSource: Record<string, number> = {};
    const captionPrimaryColor = resolveCaptionPrimaryColor(blipCaption ?? "", captionColors, blipStructured);
    const captionPrimaryColorConfidence = captionPrimaryColor
      ? Math.max(0.45, Math.min(1, Number(blipStructuredConfidence ?? 0.6)))
      : 0;
    const allowDominantFallback = shouldUseDominantColorFallback(captionColors, blipStructured);
    const allowFullImageDominantFallback =
      allowDominantFallback &&
      allItemsToProcess.length <= 1;
    const dominantPrimaryColor =
      allowFullImageDominantFallback && imageInferDominantColorEnv() && fullResult.services?.blip
        ? await extractDominantColorNames(buffer, { maxColors: 2, minShare: 0.12 })
          .then((c) => c[0] ?? null)
          .catch(() => null)
        : null;
    const dominantPrimaryColorConfidence = dominantPrimaryColor ? 0.52 : 0;
    const inferredPrimaryColor = pickColorByHighestConfidence([
      { color: captionPrimaryColor, confidence: captionPrimaryColorConfidence },
      { color: dominantPrimaryColor, confidence: dominantPrimaryColorConfidence },
    ]);
    // Avoid TS "never" narrowing when caption inference is type-proved unreachable.
    const captionWantsJeans = blipStructured.productTypeHints.includes("jeans");
    const contextualFormalityScore = inferContextualFormalityFromDetections(allItemsToProcess);
    const fullFrameEmbedding_selective = await processImageForEmbedding(fullProcessBuf).catch(() => null);

    const selectiveDetectionJobs = allItemsToProcess.map((detection, i) => ({
      detection,
      i,
      isUserDefined: i >= itemsToProcess.length,
    }));
    const selectiveEmbeddingBatchStartedAt = Date.now();
    const selectiveEmbeddingBatch = await computeShopTheLookGarmentEmbeddingsFromDetections(
      buffer,
      selectiveDetectionJobs.map(({ detection }) => detection.box),
      fullProcessBuf,
    ).catch(() => []);
    const selectiveEmbeddingBatchMs = Date.now() - selectiveEmbeddingBatchStartedAt;
    const selectiveEmbeddingBatchReady = selectiveEmbeddingBatch.reduce(
      (count, item) => (item?.embedding && item?.clipBufferForAttributes ? count + 1 : count),
      0,
    );
    const selectiveDetectionConcurrency = shopLookPerDetectionConcurrency(
      selectiveDetectionJobs.map(({ detection }) => detection),
    );
    const selectiveSettled = await mapPoolSettled(
      selectiveDetectionJobs,
      selectiveDetectionConcurrency,
      async ({ detection, i, isUserDefined }, selectiveJobIndex) => {
        try {
          let clipBuffer: Buffer;
          let finalEmbedding: number[];
          let queryProcessBuf: Buffer;
          try {
            const batched = selectiveEmbeddingBatch[selectiveJobIndex];
            if (batched?.embedding && batched.clipBufferForAttributes) {
              finalEmbedding = batched.embedding;
              clipBuffer = batched.clipBufferForAttributes;
              queryProcessBuf = batched.processBuf;
            } else {
              const aligned = await computeShopTheLookGarmentEmbeddingFromDetection(
                buffer,
                detection.box,
                fullProcessBuf,
              );
              finalEmbedding = aligned.embedding;
              clipBuffer = aligned.clipBufferForAttributes;
              queryProcessBuf = aligned.processBuf;
            }
          } catch {
            return null;
          }
          const finalGarmentEmbedding = finalEmbedding;
          const finalFullFrameEmbedding = fullFrameEmbedding_selective ?? finalEmbedding;

          // Get category from user hint or detection
          const rawCategorySource =
            isUserDefined && userDefinedBoxes[i - itemsToProcess.length].categoryHint
              ? userDefinedBoxes[i - itemsToProcess.length].categoryHint!
              : detection.label;
          const categorySource = inferFootwearSubtypeFromCaption(rawCategorySource, blipCaption, {
            confidence: detection.confidence,
            areaRatio: detection.area_ratio,
          });
          const categoryMapping = normalizeCategoryMapping(mapDetectionToCategory(categorySource, detection.confidence, {
            box_normalized: (detection as any).box_normalized,
          }));
          const itemColorKey = detectionColorKey(categorySource, i);
          if (!(itemColorKey in inferredColorsByItem)) inferredColorsByItem[itemColorKey] = null;
          if (!(itemColorKey in inferredColorsByItemConfidence)) inferredColorsByItemConfidence[itemColorKey] = 0;
          if (!(itemColorKey in inferredColorsByItemSource)) inferredColorsByItemSource[itemColorKey] = 0;

          // Preserve category-slot color from full-image caption (e.g. "blue jeans")
          // only as a low-priority fallback for this detection.
          const fullCaptionSlotColor = captionColorForProductCategory(
            categoryMapping.productCategory,
            captionColors,
          );
          const slotColorConfidence =
            fullCaptionSlotColor && blipStructuredConfidence >= imageBlipSoftHintConfidenceMin()
              ? Math.max(0.62, Math.min(0.9, blipStructuredConfidence))
              : 0;
          if (fullCaptionSlotColor && slotColorConfidence > 0) {
            setDetectionColorIfHigherConfidence(
              inferredColorsByItem,
              inferredColorsByItemConfidence,
              inferredColorsByItemSource,
              itemColorKey,
              fullCaptionSlotColor,
              slotColorConfidence,
              0,
              { productCategory: categoryMapping.productCategory, detectionLabel: categorySource },
            );
          }

          const filters: Partial<import("./types").SearchFilters> = {};
          Object.assign(
            filters,
            mergeImageSearchSessionFilters(
              filters,
              options.sessionFilters ?? (options.sessionId ? (getSession(options.sessionId).accumulatedFilters as Record<string, unknown>) : null),
            ),
          );
          const typeSeedSourceForSelection =
            categoryMapping.productCategory === "tops" &&
              categoryMapping.attributes.sleeveLength === "short"
              ? "tshirt tee"
              : categorySource;
          let browseTypeSeeds = extractLexicalProductTypeSeeds(typeSeedSourceForSelection);
          if (blipStructuredConfidence >= imageBlipSoftHintConfidenceMin()) {
            browseTypeSeeds = [...new Set([...browseTypeSeeds, ...blipStructured.productTypeHints])];
          }
          browseTypeSeeds = filterProductTypeSeedsByMappedCategory(
            browseTypeSeeds,
            categoryMapping.productCategory,
          );
          browseTypeSeeds = tightenTypeSeedsForDetection(categorySource, categoryMapping, browseTypeSeeds, {
            confidence: detection.confidence,
            areaRatio: detection.area_ratio,
          });
          browseTypeSeeds = recoverFormalOuterwearTypes(
            browseTypeSeeds,
            categoryMapping.productCategory,
            categorySource,
            blipCaption ?? "",
          );
          browseTypeSeeds = recoverTailoredTopTypes(
            browseTypeSeeds,
            categoryMapping.productCategory,
            categorySource,
            detection.raw_label,
            contextualFormalityScore,
            blipCaption,
          );
          const blipCaptionNorm = String(blipCaption ?? "").toLowerCase();
          const hasSuitCaptionCue =
            /\b(suit|suiting|blazer|sport coat|dress jacket|suit jacket|tuxedo|waistcoat|vest)\b/.test(blipCaptionNorm) ||
            (/\btie\b/.test(blipCaptionNorm) && contextualFormalityScore >= 6) ||
            (contextualFormalityScore >= 8 &&
              (categoryMapping.productCategory === "tops" ||
                categoryMapping.productCategory === "outerwear" ||
                categoryMapping.productCategory === "bottoms")) ||
            /\b(wedding|black-tie|black tie|ceremony|bow tie|bowtie|business formal)\b/.test(
              blipCaptionNorm,
            );
          if (hasSuitCaptionCue && categoryMapping.productCategory === "bottoms") {
            const suitBottomPriority = [
              "trousers",
              "dress pants",
              "slacks",
              "tailored trousers",
              "formal pants",
            ];
            browseTypeSeeds = [...new Set([...suitBottomPriority, ...browseTypeSeeds])];
            const existingTypes = Array.isArray(filters.productTypes) ? filters.productTypes : [];
            filters.productTypes = [...new Set([...existingTypes, ...suitBottomPriority])].slice(0, 10);
            filters.softStyle = "semi-formal";
          }
          if (shouldForceTypeFilterForDetection(detection, categoryMapping, browseTypeSeeds)) {
            filters.productTypes = browseTypeSeeds.slice(0, 10);
          }
          let softProductTypeHints = browseTypeSeeds.length > 0 ? browseTypeSeeds : undefined;

          // "Closet similar" constraints: enforce audience gender + add optional style/color.
          if (inferredAudience.gender) {
            filters.gender = inferredAudience.gender;
          }
          if (inferredAudience.ageGroup) {
            filters.ageGroup = inferredAudience.ageGroup;
          }

          const inferredStyle = inferStyleForDetectionLabel(categorySource);
          const useBlipSoftHints = blipStructuredConfidence >= imageBlipSoftHintConfidenceMin();
          const useStrongBlipSoftHints = blipStructuredConfidence >= imageBlipSoftHintConfidenceStrong();
          let styleAppliedFromInferredFallback = false;
          if (useStrongBlipSoftHints && blipStructured.style.attrStyle) {
            filters.softStyle = blipStructured.style.attrStyle;
          } else if (
            inferredStyle.attrStyle &&
            shouldApplyInferredStyleFallback(categoryMapping.productCategory, categorySource)
          ) {
            filters.softStyle = inferredStyle.attrStyle;
            styleAppliedFromInferredFallback = true;
          }
          if (
            categoryMapping.productCategory === "bottoms" &&
            styleAppliedFromInferredFallback &&
            !useStrongBlipSoftHints
          ) {
            delete (filters as any).softStyle;
          }

          // Use the stronger of BLIP caption formality and detection-label formality.
          const blipFormalityScore = blipCaption ? inferFormalityFromCaption(blipCaption) : 0;
          const labelFormalityScore = inferFormalityFromLabel(categorySource);
          const effectiveFormalityScore = Math.max(
            blipFormalityScore,
            labelFormalityScore,
            contextualFormalityScore,
          );
          const isFootwearCategory = String(categoryMapping.productCategory || "").toLowerCase() === "footwear";
          const footwearFormalityScore = isFootwearCategory
            ? Math.max(blipFormalityScore, labelFormalityScore)
            : effectiveFormalityScore;
          const applicableFormalityScore = isFootwearCategory
            ? footwearFormalityScore
            : effectiveFormalityScore;
          const formalityHardGateEligible = ["outerwear", "dresses"].includes(
            String(categoryMapping.productCategory || "").toLowerCase(),
          );
          if (applicableFormalityScore >= 8) {
            filters.softStyle = formalityHardGateEligible ? "formal" : "semi-formal";
            if (formalityHardGateEligible) {
              (filters as any).minFormality = 8;
              console.log(`[formality-intent-alt][APPLIED] enforcing formal-wear-only for detection="${categorySource}"`);
            } else {
              delete (filters as any).minFormality;
              console.log(`[formality-intent-alt][SOFT] applying semi-formal bias for detection="${categorySource}"`);
            }
          } else if (!isFootwearCategory && applicableFormalityScore >= 7) {
            filters.softStyle = "semi-formal";
            delete (filters as any).minFormality;
          }
          if (categoryMapping.productCategory === "bottoms" && !hasSuitCaptionCue) {
            delete (filters as any).softStyle;
            delete (filters as any).minFormality;
          }

          const formalFootwearIntent =
            categoryMapping.productCategory === "footwear" &&
            (footwearFormalityScore >= 8 || filters.softStyle === "formal");
          if (formalFootwearIntent) {
            browseTypeSeeds = pruneAthleticFootwearTerms(browseTypeSeeds);
            softProductTypeHints = browseTypeSeeds.length > 0 ? browseTypeSeeds : undefined;
            if (Array.isArray((filters as any).productTypes)) {
              (filters as any).productTypes = pruneAthleticFootwearTerms((filters as any).productTypes);
            }
          }

          const detectionSleeve =
            categoryMapping.attributes.sleeveLength ?? inferSleeveIntentFromDetectionLabel(categorySource);
          const normalizedSourceForSleeve = normalizeLooseText(categorySource);
          const hasExplicitSleeveCue =
            /\b(short sleeve|long sleeve|half sleeve|3\/?4 sleeve|sleeveless)\b/.test(normalizedSourceForSleeve);
          const sleeveSensitiveCategory =
            categoryMapping.productCategory === "tops" || categoryMapping.productCategory === "dresses";
          const sleeveSignalStrong =
            (detection.confidence ?? 0) >= 0.94 || (detection.area_ratio ?? 0) >= 0.12;
          // Trust an explicit label cue ("short sleeve top") at any detection confidence; only
          // require strong signal when sleeve is inferred from a non-explicit label (e.g. "tshirt").
          if (
            detectionSleeve &&
            (!sleeveSensitiveCategory || hasExplicitSleeveCue || sleeveSignalStrong)
          ) {
            filters.sleeve = detectionSleeve;
          }

          const detectionLength = inferLengthIntentFromDetection(detection, imageHeight);
          if (detectionLength) (filters as any).length = detectionLength;

          // Extract dominant colors from the garment crop pixels via k-means + LAB.
          // clipBuffer is the padded ROI of the detected garment — already isolated
          // from background/other items. These colors feed into soft color compliance
          // (rerankScore boost) but do not hard-gate final relevance.
          try {
            const cropColors = await extractDetectionCropColorsForRanking({
              clipBuffer,
              productCategory: categoryMapping.productCategory,
              detectionLabel: categorySource,
            });
            if (cropColors.length > 0) {
              (filters as any).cropDominantColors = cropColors;
              const cropColorConfidence = estimateCropColorConfidence(detection);
              const selectedColor =
                selectDetectionColorFromPalette({
                  cropColors,
                  productCategory: categoryMapping.productCategory,
                  detectionLabel: categorySource,
                  cropColorConfidence,
                }) ?? cropColors[0];
              const adjustedColor = adjustStripedTopColorInference({
                selectedColor,
                cropColors,
                productCategory: categoryMapping.productCategory,
                detectionLabel: categorySource,
                fullCaption: blipCaption,
              });

              if (adjustedColor) {
                setDetectionColorIfHigherConfidence(
                  inferredColorsByItem,
                  inferredColorsByItemConfidence,
                  inferredColorsByItemSource,
                  itemColorKey,
                  adjustedColor,
                  cropColorConfidence,
                  1,
                  { productCategory: categoryMapping.productCategory, detectionLabel: categorySource },
                );
              }

              const existingColor = inferredColorsByItem[itemColorKey];
              const existingConf = Number(inferredColorsByItemConfidence[itemColorKey] ?? 0);
              const existingSource = Number(inferredColorsByItemSource[itemColorKey] ?? 0);
              const captionPromoteConfidence = Math.max(slotColorConfidence, Math.min(0.92, cropColorConfidence + 0.02));
              if (
                fullCaptionSlotColor &&
                canPromoteCaptionSlotColor({
                  productCategory: categoryMapping.productCategory,
                  detectionLabel: categorySource,
                  existingColor,
                  existingSource,
                  existingConfidence: existingConf,
                  captionColor: fullCaptionSlotColor,
                  captionConfidence: captionPromoteConfidence,
                })
              ) {
                setDetectionColorIfHigherConfidence(
                  inferredColorsByItem,
                  inferredColorsByItemConfidence,
                  inferredColorsByItemSource,
                  itemColorKey,
                  fullCaptionSlotColor,
                  captionPromoteConfidence,
                  2,
                  { productCategory: categoryMapping.productCategory, detectionLabel: categorySource },
                );
              }
            }
          } catch { /* non-critical: color embedding channel still works */ }

          const textureMaterial = await inferMaterialFromTextureCrop({
            clipBuffer,
            productCategory: categoryMapping.productCategory,
            detectionLabel: categorySource,
            caption:
              categoryMapping.productCategory === "tops" ||
                categoryMapping.productCategory === "bottoms" ||
                categoryMapping.productCategory === "dresses" ||
                categoryMapping.productCategory === "outerwear"
                ? null
                : blipCaption,
          });
          if (textureMaterial.material && textureMaterial.confidence >= imageMinMaterialConfidenceEnv()) {
            (filters as any).material = textureMaterial.material;
          }

          let predictedCategoryAisles: string[] | undefined;
          const accessoryLikeCategory = isAccessoryLikeCategory(categoryMapping.productCategory);
          const footwearLikeCategory = categoryMapping.productCategory === "footwear";
          const suitCaptionForTop =
            categoryMapping.productCategory === "tops" &&
            (
              /\b(suit|suiting|blazer|sport coat|dress jacket|suit jacket|tuxedo|waistcoat|vest)\b/.test(
                String(blipCaption ?? "").toLowerCase(),
              ) ||
              (/\btie\b/.test(String(blipCaption ?? "").toLowerCase()) && contextualFormalityScore >= 6)
            );
          if (options.filterByDetectedCategory !== false) {
            // Always use soft category expansion for low-confidence detections
            const softCategories = shouldUseAlternatives(categoryMapping)
              ? getSearchCategories(categoryMapping)
              : [categoryMapping.productCategory];
            const expandedTypeHints = expandPredictedTypeHints([
              categorySource,
              ...softCategories,
              ...browseTypeSeeds,
            ]);
            const accessoryOrFootwearConfident =
              (accessoryLikeCategory || footwearLikeCategory) &&
              (((detection.confidence ?? 0) >= 0.72) || ((detection.area_ratio ?? 0) >= 0.025));
            const shouldHardCategory =
              !suitCaptionForTop &&
              (
                accessoryOrFootwearConfident ||
                footwearLikeCategory ||
                !(imageSoftCategoryEnv() || shopLookSoftCategoryEnv())
              );
            if (!shouldHardCategory) {
              predictedCategoryAisles =
                browseTypeSeeds.length > 0
                  ? browseTypeSeeds
                  : expandedTypeHints.length > 0
                    ? expandedTypeHints
                    : softCategories;
              if (formalFootwearIntent && Array.isArray(predictedCategoryAisles) && predictedCategoryAisles.length > 0) {
                predictedCategoryAisles = pruneAthleticFootwearTerms(predictedCategoryAisles);
              }
            } else {
              const terms = hardCategoryTermsForDetection(categorySource, categoryMapping, {
                confidence: detection.confidence,
                areaRatio: detection.area_ratio,
              }, blipCaption ?? "");
              const categoryTerms = formalFootwearIntent ? pruneAthleticFootwearTerms(terms) : terms;
              filters.category = categoryTerms.length === 1 ? categoryTerms[0] : categoryTerms;
            }
          }
          const forceHardCategoryFilterUsed =
            options.filterByDetectedCategory !== false &&
            (filters as { category?: string | string[] }).category != null;

          const detCaption = fullResult.services?.blip ? await getCachedCaption(clipBuffer, "det") : "";
          let detectionBlipSignal: BlipSignal | undefined;
          let detectionCaptionAcceptedForLock = false;
          if (detCaption.trim().length > 0 && !(filters as any).length) {
            const captionLength = inferLengthIntentFromCaption(detCaption);
            if (captionLength) (filters as any).length = captionLength;
          }
          if (detCaption.trim().length > 0) {
            obs.detectionCaptionHits += 1;
            const detCaptionColors = inferColorFromCaption(detCaption);
            // Strict slot binding: do not fallback across slots.
            // Each BLIP color must map only to its corresponding item type.
            const detCaptionColor = captionColorForProductCategory(
              categoryMapping.productCategory,
              detCaptionColors,
            );
            const detStruct = buildStructuredBlipOutput(detCaption);
            const consistency = await clipCaptionConsistency01(finalEmbedding, detCaption);
            const detConfidence = combineConfidenceFromConsistency(detStruct.confidence, consistency);
            // When crop-derived color is already reliable for slot-specific apparel,
            // don't let detection-caption text override it (top/bottom overlap can leak colors).
            const existingColor = String(inferredColorsByItem[itemColorKey] ?? "").trim();
            const existingConf = Number(inferredColorsByItemConfidence[itemColorKey] ?? 0);
            const existingSource = Number(inferredColorsByItemSource[itemColorKey] ?? 0);
            const hasReliableCropColor = existingColor.length > 0 && existingSource === 1 && existingConf >= 0.6;
            const categoryNeedsStableSlotColor = requiresSlotSpecificColor(categoryMapping.productCategory);
            const detCaptionColorNorm2 = String(detCaptionColor ?? "").toLowerCase().trim();
            const existingColorNorm2 = String(existingColor ?? "").toLowerCase().trim();
            const allowCaptionOverrideNeutralCrop = canPromoteCaptionSlotColor({
              productCategory: categoryMapping.productCategory,
              detectionLabel: categorySource,
              existingColor,
              existingSource,
              existingConfidence: existingConf,
              captionColor: detCaptionColor,
              captionConfidence: detConfidence,
              minCaptionConfidence: 0.62,
            });
            const allowHighConfNeutralCaptionOverrideChromaticCrop2 =
              detCaptionColorNorm2.length > 0 &&
              isNeutralFashionColorEarly(detCaptionColorNorm2) &&
              detConfidence >= 0.75 &&
              existingColorNorm2.length > 0 &&
              isChromaticFashionColor(existingColorNorm2);
            if (
              !(
                categoryNeedsStableSlotColor &&
                hasReliableCropColor &&
                !allowCaptionOverrideNeutralCrop &&
                !allowHighConfNeutralCaptionOverrideChromaticCrop2
              )
            ) {
              setDetectionColorIfHigherConfidence(
                inferredColorsByItem,
                inferredColorsByItemConfidence,
                inferredColorsByItemSource,
                itemColorKey,
                detCaptionColor,
                detConfidence,
                2,
                { productCategory: categoryMapping.productCategory, detectionLabel: categorySource },
              );
            }
            if (
              detConfidence >= imageBlipSoftHintConfidenceMin() &&
              consistency >= imageBlipClipConsistencyMin()
            ) {
              obs.detectionCaptionAccepted += 1;
              detectionCaptionAcceptedForLock = true;
              detectionBlipSignal = buildBlipSignal(detStruct, detConfidence);
              if (!filters.softStyle && detStruct.style.attrStyle) filters.softStyle = detStruct.style.attrStyle;
              if (!filters.gender && detStruct.audience.gender) filters.gender = detStruct.audience.gender;
              if (!filters.ageGroup && detStruct.audience.ageGroup) filters.ageGroup = detStruct.audience.ageGroup;
              const detMaterialHints = (detStruct as any)?.materialHints as string[] | undefined;
              const materialHintMinConfidence =
                categoryMapping.productCategory === "dresses"
                  ? Math.max(0.58, imageBlipSoftHintConfidenceMin())
                  : imageBlipSoftHintConfidenceStrong();
              if (detMaterialHints && detMaterialHints.length > 0 && detConfidence >= materialHintMinConfidence) {
                const hasTextureMaterial = Boolean(textureMaterial.material);
                const keepTextureForTopLike =
                  (categoryMapping.productCategory === "tops" ||
                    categoryMapping.productCategory === "outerwear" ||
                    categoryMapping.productCategory === "dresses") &&
                  hasTextureMaterial &&
                  textureMaterial.confidence >= imageMinMaterialConfidenceEnv() + 0.08;
                if (!keepTextureForTopLike) {
                  (filters as any).material = detMaterialHints[0];
                }
              }
              const mergedTypes = [...new Set([...(softProductTypeHints ?? []), ...detStruct.productTypeHints])];
              const filteredTypes = filterProductTypeSeedsByMappedCategory(
                mergedTypes,
                categoryMapping.productCategory,
              ).slice(0, 10);
              softProductTypeHints = tightenTypeSeedsForDetection(
                categorySource,
                categoryMapping,
                filteredTypes,
                {
                  confidence: detection.confidence,
                  areaRatio: detection.area_ratio,
                },
              );
              softProductTypeHints = recoverFormalOuterwearTypes(
                softProductTypeHints,
                categoryMapping.productCategory,
                categorySource,
                blipCaption ?? "",
                detCaption,
              );
              if (shouldForceTypeFilterForDetection(detection, categoryMapping, softProductTypeHints)) {
                filters.productTypes = softProductTypeHints.slice(0, 10);
              }
            } else {
              obs.detectionCaptionRejected += 1;
            }
          } else {
            obs.detectionCaptionMisses += 1;
          }

          const strictAudienceLock =
            Boolean(inferredAudience.gender) &&
            blipStructuredConfidence >= imageBlipSoftHintConfidenceStrong() &&
            detectionCaptionAcceptedForLock;

          const inferredPrimaryColorForDetection = (() => {
            const detColor = inferredColorsByItem[itemColorKey];
            const detColorConfidence = inferredColorsByItemConfidence[itemColorKey] ?? 0;
            const globalPrimary = String(inferredPrimaryColor ?? "").toLowerCase().trim();
            const detColorNorm = String(detColor ?? "").toLowerCase().trim();
            const onePieceDetection =
              categoryMapping.productCategory === "dresses" ||
              /\b(dress|gown|jumpsuit|romper|playsuit|sundress)\b/.test(String(detCaption).toLowerCase());
            if (onePieceDetection && globalPrimary) {
              if (!detColorNorm || (isLightNeutralFashionColor(globalPrimary) && !isLightNeutralFashionColor(detColorNorm))) {
                return globalPrimary;
              }
            }
            if (detColor && detColorConfidence >= 0.45) return detColor;
            return inferredPrimaryColor;
          })();
          const cropDominantForConflict = Array.isArray((filters as any).cropDominantColors)
            ? ((filters as any).cropDominantColors as unknown[])
                .map((c) => canonicalizeColorIntentToken(String(c ?? "")))
                .filter((c) => c.length > 0)
            : [];
          const inferredColorNorm = canonicalizeColorIntentToken(inferredPrimaryColorForDetection);
          const inferredColorIsChromatic =
            inferredColorNorm.length > 0 &&
            inferredColorNorm !== "multicolor" &&
            !isNeutralFashionColor(inferredColorNorm);
          const cropHasNeutral = cropDominantForConflict.some((c) => isNeutralFashionColor(c));
          const cropHasChromatic = cropDominantForConflict.some(
            (c) => c.length > 0 && c !== "multicolor" && !isNeutralFashionColor(c),
          );
          const inferredColorConflictForRetrieval =
            inferredColorIsChromatic &&
            Number(inferredColorsByItemConfidence[itemColorKey] ?? 0) >= 0.82 &&
            cropHasNeutral &&
            !cropHasChromatic;
          const tinyFootwearBox =
            categoryMapping.productCategory === "footwear" &&
            Number(detection.area_ratio ?? 0) < 0.018;
          const globalPrimaryNorm = canonicalizeColorIntentToken(inferredPrimaryColor);
          const footwearColorConflictWithGlobal =
            categoryMapping.productCategory === "footwear" &&
            inferredColorNorm.length > 0 &&
            globalPrimaryNorm.length > 0 &&
            inferredColorNorm !== globalPrimaryNorm &&
            isLightNeutralFashionColor(globalPrimaryNorm) &&
            !isLightNeutralFashionColor(inferredColorNorm) &&
            (detection.area_ratio ?? 0) < 0.06;
          const explicitColorFilter = String((filters as any).color ?? "").trim();
          // Always generalize color intent reranking for all garment types
          const inferredPrimaryColorForSearch = canonicalizeColorIntentToken(inferredPrimaryColorForDetection);

          const baseSimilarityThreshold = options.similarityThreshold ?? config.clip.imageSimilarityThreshold;
          let detectionSimilarityThreshold = shopLookDetectionSimilarityThreshold(
            baseSimilarityThreshold,
            categoryMapping.productCategory,
          );
          if (categoryMapping.productCategory === "footwear" && (detection.area_ratio ?? 0) < 0.012) {
            detectionSimilarityThreshold = Math.max(0.18, detectionSimilarityThreshold - 0.08);
          }
          const detectionRetrievalLimit = (() => {
            const categoryNorm = String(categoryMapping.productCategory ?? "").toLowerCase().trim();
            const boost =
              categoryNorm === "tops"
                ? (inferredColorConflictForRetrieval ? 2.4 : 1.7)
                : categoryNorm === "dresses" ? 2.4
                  : categoryNorm === "bottoms" ? 2.1
                    : categoryNorm === "outerwear" ? 2.2
                    : categoryNorm === "footwear"
                      ? ((detection.area_ratio ?? 0) < 0.012 ? 2.6 : 1.9)
                      : 1;
            return Math.max(
              resolvedResultsPageSize,
              Math.min(resolveShopLookRetrievalLimit(retrievalLimit * boost), retrievalLimit + 180),
            );
          })();

          const browseKnnField =
            categoryMapping.productCategory === "tops" ||
            categoryMapping.productCategory === "bottoms" ||
            categoryMapping.productCategory === "dresses" ||
            categoryMapping.productCategory === "outerwear"
              ? "embedding"
              : shopTheLookKnnField();

          // Always extract and pass color, style, and pattern intent to rerank
          let similarResult = await searchByImageWithSimilarity({
            imageEmbedding: finalFullFrameEmbedding,
            imageEmbeddingGarment:
              Array.isArray(finalGarmentEmbedding) && finalGarmentEmbedding.length > 0
                ? finalGarmentEmbedding
                : undefined,
            imageBuffer: clipBuffer,
            pHash: sourceImagePHash,
            detectionYoloConfidence: detection.confidence,
            detectionProductCategory: categoryMapping.productCategory,
            filters,
            softProductTypeHints,
            limit: detectionRetrievalLimit,
            similarityThreshold: detectionSimilarityThreshold,
            includeRelated: false,
            predictedCategoryAisles,
            knnField: browseKnnField,
            forceHardCategoryFilter: forceHardCategoryFilterUsed,
            relaxThresholdWhenEmpty: shopLookDetectionRelaxEnv(),
            blipSignal: detectionBlipSignal,
            inferredPrimaryColor: inferredPrimaryColorForSearch,
            inferredColorKey: itemColorKey,
            inferredColorsByItem,
            inferredColorsByItemConfidence,
            debugRawCosineFirst: shopLookDebugRawCosineFirstEnv(),
            sessionId: options.sessionId,
            userId: options.userId,
            sessionFilters: options.sessionFilters ?? undefined,
            // Style and pattern intent are handled via filters or blipSignal; do not pass as top-level params
          });

          // Retry without inferred attribute filters if they removed all hits.
          if (
            (
              similarResult.results.length === 0 ||
              (
                (categoryMapping.productCategory === "tops" || categoryMapping.productCategory === "bottoms") &&
                similarResult.results.length <= 1
              )
            ) &&
            (
              filters.gender ||
              filters.ageGroup ||
              (filters as any).style ||
              (filters as any).softStyle
            )
          ) {
            const filtersRetry = { ...filters } as typeof filters;
            // Keep explicit audience gender across retries to prevent cross-gender leakage.
            // Only relax age group when strict lock is not active.
            const preserveInferredAudience = strictAudienceLock;
            if (!preserveInferredAudience) {
              delete (filtersRetry as any).ageGroup;
            }
            delete (filtersRetry as any).style;
            delete (filtersRetry as any).softStyle;
            similarResult = await searchByImageWithSimilarity({
              imageEmbedding: finalEmbedding,
              imageEmbeddingGarment:
                Array.isArray(finalGarmentEmbedding) && finalGarmentEmbedding.length > 0
                  ? finalGarmentEmbedding
                  : undefined,
              imageBuffer: clipBuffer,
              pHash: sourceImagePHash,
              detectionYoloConfidence: detection.confidence,
              detectionProductCategory: categoryMapping.productCategory,
              filters: filtersRetry,
              softProductTypeHints,
              limit: detectionRetrievalLimit,
              similarityThreshold: detectionSimilarityThreshold,
              includeRelated: false,
              predictedCategoryAisles,
              knnField: browseKnnField,
              forceHardCategoryFilter: forceHardCategoryFilterUsed,
              relaxThresholdWhenEmpty: shopLookDetectionRelaxEnv(),
              blipSignal: detectionBlipSignal,
              inferredPrimaryColor: inferredPrimaryColorForSearch,
              inferredColorKey: itemColorKey,
              inferredColorsByItem,
              inferredColorsByItemConfidence,
              debugRawCosineFirst: shopLookDebugRawCosineFirstEnv(),
              sessionId: options.sessionId,
              userId: options.userId,
              sessionFilters: options.sessionFilters ?? undefined,
            });
          }

          if (
            shopLookCategoryFallbackEnv() &&
            similarResult.results.length === 0 &&
            options.filterByDetectedCategory !== false &&
            (
              !accessoryLikeCategory ||
              (
                categoryMapping.productCategory === "bags" &&
                (
                  ((detection.confidence ?? 0) >= 0.58) ||
                  ((detection.area_ratio ?? 0) >= 0.022)
                )
              )
            ) &&
            !imageSoftCategoryEnv() &&
            !(categoryMapping.productCategory === "accessories" && isHeadwearLabel(categorySource)) &&
            (filters as { category?: string | string[] }).category
          ) {
            const { category: _omitCategory, ...filtersSansCategory } = filters as {
              category?: string | string[];
              productTypes?: string[];
            };
            const preserveHardCategoryInFallback = shouldPreserveHardCategoryOnFallback(categoryMapping);
            const fallbackCategoryTerms = preserveHardCategoryInFallback
              ? fallbackCategoryTermsForDetection(categorySource, categoryMapping)
              : [];
            const fallbackFilters = preserveHardCategoryInFallback && fallbackCategoryTerms.length > 0
              ? {
                ...filtersSansCategory,
                category:
                  fallbackCategoryTerms.length === 1
                    ? fallbackCategoryTerms[0]
                    : fallbackCategoryTerms,
              }
              : filtersSansCategory;
            similarResult = await searchByImageWithSimilarity({
              imageEmbedding: finalEmbedding,
              imageEmbeddingGarment:
                Array.isArray(finalGarmentEmbedding) && finalGarmentEmbedding.length > 0
                  ? finalGarmentEmbedding
                  : undefined,
              imageBuffer: clipBuffer,
              pHash: sourceImagePHash,
              detectionYoloConfidence: detection.confidence,
              detectionProductCategory: categoryMapping.productCategory,
              filters: fallbackFilters,
              softProductTypeHints,
              limit: retrievalLimit,
              similarityThreshold: detectionSimilarityThreshold,
              includeRelated: false,
              predictedCategoryAisles: preserveHardCategoryInFallback ? undefined : predictedCategoryAisles,
              knnField: browseKnnField,
              forceHardCategoryFilter: preserveHardCategoryInFallback,
              relaxThresholdWhenEmpty: shopLookDetectionRelaxEnv(),
              blipSignal: detectionBlipSignal,
              inferredPrimaryColor: inferredPrimaryColorForSearch,
              inferredColorKey: itemColorKey,
              inferredColorsByItem,
              inferredColorsByItemConfidence,
              debugRawCosineFirst: shopLookDebugRawCosineFirstEnv(),
              sessionId: options.sessionId,
              userId: options.userId,
              sessionFilters: options.sessionFilters ?? undefined,
            });
            if (similarResult.results.length === 0) {
              const fallbackStructuralFilters = preserveHardCategoryInFallback && fallbackCategoryTerms.length > 0
                ? {
                  category:
                    fallbackCategoryTerms.length === 1
                      ? fallbackCategoryTerms[0]
                      : fallbackCategoryTerms,
                  gender: (filters as any).gender,
                  ageGroup: (filters as any).ageGroup,
                }
                : {
                  length: (filters as any).length,
                  sleeve: (filters as any).sleeve,
                  gender: (filters as any).gender,
                  ageGroup: (filters as any).ageGroup,
                };
              similarResult = await searchByImageWithSimilarity({
                imageEmbedding: finalEmbedding,
                imageEmbeddingGarment:
                  Array.isArray(finalGarmentEmbedding) && finalGarmentEmbedding.length > 0
                    ? finalGarmentEmbedding
                    : undefined,
                imageBuffer: clipBuffer,
                pHash: sourceImagePHash,
                detectionYoloConfidence: detection.confidence,
                detectionProductCategory: categoryMapping.productCategory,
                // Keep crop-derived structural intent even in last-resort fallback.
                filters: fallbackStructuralFilters as any,
                limit: retrievalLimit,
                similarityThreshold: detectionSimilarityThreshold,
                includeRelated: false,
                knnField: browseKnnField,
                forceHardCategoryFilter: preserveHardCategoryInFallback,
                relaxThresholdWhenEmpty: shopLookDetectionRelaxEnv(),
                blipSignal: detectionBlipSignal,
                inferredPrimaryColor: inferredPrimaryColorForSearch,
                inferredColorKey: itemColorKey,
                inferredColorsByItem,
                inferredColorsByItemConfidence,
                debugRawCosineFirst: shopLookDebugRawCosineFirstEnv(),
                sessionId: options.sessionId,
                userId: options.userId,
                sessionFilters: options.sessionFilters ?? undefined,
              });
            }
          }

          // Same safety valve for alternate flow: if hard type forcing yields empty, retry
          // without hard productTypes and rely on soft hints + category constraints.
          if (
            similarResult.results.length === 0 &&
            Array.isArray((filters as any).productTypes) &&
            (filters as any).productTypes.length > 0
          ) {
            const { productTypes: _omitProductTypes, ...filtersNoHardTypes } = filters as any;
            similarResult = await searchByImageWithSimilarity({
              imageEmbedding: finalEmbedding,
              imageEmbeddingGarment:
                Array.isArray(finalGarmentEmbedding) && finalGarmentEmbedding.length > 0
                  ? finalGarmentEmbedding
                  : undefined,
              imageBuffer: clipBuffer,
              pHash: sourceImagePHash,
              detectionYoloConfidence: detection.confidence,
              detectionProductCategory: categoryMapping.productCategory,
              filters: filtersNoHardTypes,
              softProductTypeHints,
              limit: retrievalLimit,
              similarityThreshold: detectionSimilarityThreshold,
              includeRelated: false,
              predictedCategoryAisles,
              knnField: browseKnnField,
              forceHardCategoryFilter: forceHardCategoryFilterUsed,
              relaxThresholdWhenEmpty: shopLookDetectionRelaxEnv(),
              blipSignal: detectionBlipSignal,
              inferredPrimaryColor: inferredPrimaryColorForSearch,
              inferredColorKey: itemColorKey,
              inferredColorsByItem,
              inferredColorsByItemConfidence,
              debugRawCosineFirst: shopLookDebugRawCosineFirstEnv(),
              sessionId: options.sessionId,
              userId: options.userId,
              sessionFilters: options.sessionFilters ?? undefined,
            });
          }

          const lowQualityFallbackWanted =
            shopLookLowQualityMultiCropFallbackEnabled() &&
            shouldUseLowQualityMultiCropFallback(detection) &&
            similarResult.results.length < Math.max(3, Math.floor(retrievalLimit * 0.35));
          if (lowQualityFallbackWanted) {
            const expandedRaw = expandDetectionBox(detection.box, imageWidth, imageHeight, 0.22);
            let expandedBox = expandedRaw;
            try {
              const procMeta = await sharp(queryProcessBuf).metadata();
              const pw = procMeta.width ?? 0;
              const ph = procMeta.height ?? 0;
              if (pw > 0 && ph > 0 && (pw !== imageWidth || ph !== imageHeight)) {
                expandedBox = scalePixelBoxToImageDims(expandedRaw, imageWidth, imageHeight, pw, ph);
              }
            } catch {
              // keep raw-space box if process metadata is unavailable
            }

            const [expandedEmb, centerEmb] = await Promise.all([
              processImageForGarmentEmbeddingWithOptionalBox(buffer, queryProcessBuf, expandedBox).catch(() => null),
              processImageForGarmentEmbeddingWithOptionalBox(buffer, queryProcessBuf, null).catch(() => null),
            ]);

            const altVectors = [expandedEmb, centerEmb].filter(
              (v): v is number[] => Array.isArray(v) && v.length > 0,
            );
            const altResults = await Promise.all(
              altVectors.map((alt) =>
                searchByImageWithSimilarity({
                  imageEmbedding: alt,
                  imageEmbeddingGarment: alt,
                  imageBuffer: queryProcessBuf,
                  pHash: sourceImagePHash,
                  detectionYoloConfidence: detection.confidence,
                  detectionProductCategory: categoryMapping.productCategory,
                  filters,
                  softProductTypeHints,
                  limit: retrievalLimit,
                  similarityThreshold: detectionSimilarityThreshold,
                  includeRelated: false,
                  predictedCategoryAisles,
                  knnField: browseKnnField,
                  forceHardCategoryFilter: forceHardCategoryFilterUsed,
                  relaxThresholdWhenEmpty: shopLookDetectionRelaxEnv(),
                  blipSignal: detectionBlipSignal,
                  inferredPrimaryColor: inferredPrimaryColorForSearch,
                  inferredColorKey: itemColorKey,
                  inferredColorsByItem,
                  inferredColorsByItemConfidence,
                  debugRawCosineFirst: shopLookDebugRawCosineFirstEnv(),
                  sessionId: options.sessionId,
                  userId: options.userId,
                  sessionFilters: options.sessionFilters ?? undefined,
                })
              ),
            );
            for (const altResult of altResults) {
              similarResult = {
                ...similarResult,
                results: mergeImageSearchResultsById(
                  similarResult.results,
                  altResult.results,
                  retrievalLimit,
                ),
              };
              if (similarResult.results.length >= Math.max(4, Math.floor(retrievalLimit * 0.5))) break;
            }
          }

          const apparelRecoveryCategory =
            categoryMapping.productCategory === "tops" ||
            categoryMapping.productCategory === "dresses" ||
            categoryMapping.productCategory === "outerwear";
          const apparelRecoveryMinKeep = categoryMapping.productCategory === "tops"
            ? shopLookTopRecoveryMinKeep(resolvedLimitPerItem)
            : categoryMapping.productCategory === "outerwear"
              ? Math.max(3, Math.min(8, Math.floor(resolvedLimitPerItem * 0.35)))
              : Math.max(3, Math.min(8, Math.floor(resolvedLimitPerItem * 0.35)));
          if (apparelRecoveryCategory && similarResult.results.length < apparelRecoveryMinKeep) {
            const ablationTerms = hardCategoryTermsForDetection(categorySource, categoryMapping, {
              confidence: detection.confidence,
              areaRatio: detection.area_ratio,
            }, detCaption ?? blipCaption ?? "");
            const ablationFilters: Partial<import("./types").SearchFilters> = {};
            if (ablationTerms.length > 0) {
              ablationFilters.category = ablationTerms.length === 1 ? ablationTerms[0] : ablationTerms;
            }
            if (strictAudienceLock && filters.gender) {
              ablationFilters.gender = filters.gender;
            }
            if (strictAudienceLock && filters.ageGroup) {
              ablationFilters.ageGroup = filters.ageGroup;
            }

            const ablationThreshold = categoryMapping.productCategory === "tops"
              ? shopLookTopRecoverySimilarityThreshold(options.similarityThreshold ?? config.clip.imageSimilarityThreshold)
              : categoryMapping.productCategory === "outerwear"
                ? shopLookOuterwearRecoverySimilarityThreshold(options.similarityThreshold ?? config.clip.imageSimilarityThreshold)
                : shopLookDressRecoverySimilarityThreshold(options.similarityThreshold ?? config.clip.imageSimilarityThreshold);

            const ablation = await searchByImageWithSimilarity({
              imageEmbedding: finalEmbedding,
              imageEmbeddingGarment:
                Array.isArray(finalGarmentEmbedding) && finalGarmentEmbedding.length > 0
                  ? finalGarmentEmbedding
                  : undefined,
              imageBuffer: queryProcessBuf,
              pHash: sourceImagePHash,
              detectionYoloConfidence: detection.confidence,
              detectionProductCategory: categoryMapping.productCategory,
              filters: ablationFilters,
              softProductTypeHints,
              limit: retrievalLimit,
              similarityThreshold: ablationThreshold,
              includeRelated: false,
              knnField: browseKnnField,
              forceHardCategoryFilter: categoryMapping.productCategory !== "tops",
              relaxThresholdWhenEmpty: true,
              blipSignal: detectionBlipSignal,
              inferredPrimaryColor: inferredPrimaryColorForSearch,
              inferredColorKey: itemColorKey,
              inferredColorsByItem,
              inferredColorsByItemConfidence,
              debugRawCosineFirst: shopLookDebugRawCosineFirstEnv(),
              sessionId: options.sessionId,
              userId: options.userId,
              sessionFilters: options.sessionFilters ?? undefined,
            });

            const ablationCategorySafe = applyDetectionCategoryGuard(
              ablation.results,
              categorySource,
              categoryMapping,
              String((ablationFilters as any).gender ?? ""),
            );
            const ablationSleeveSafe = applySleeveIntentGuard({
              products: ablationCategorySafe,
              detectionLabel: categorySource,
              categoryMapping,
            });
            const ablationFormalitySafe = applyFormalityFilter(
              ablationSleeveSafe,
              Number((filters as any).minFormality ?? 0),
            );
            const ablationSafeResults = applyAthleticMismatchGuard({
              products: ablationFormalitySafe,
              detectionLabel: categorySource,
              productCategory: categoryMapping.productCategory,
              softStyle: String((filters as any).softStyle ?? ""),
              minFormality: Number((filters as any).minFormality ?? 0),
            });

            const currentStrength = detectionResultStrength(similarResult.results);
            const ablationStrength = detectionResultStrength(ablationSafeResults);
            const shouldUseAblation =
              ablationSafeResults.length > similarResult.results.length ||
              (ablationSafeResults.length >= Math.max(2, similarResult.results.length) && ablationStrength > currentStrength + 0.03);

            if (shouldUseAblation) {
              console.log(
                `[recovery-result] detection="${categorySource}" type=${categoryMapping.productCategory}_ablation switched count=${similarResult.results.length}->${ablationSafeResults.length} strength=${currentStrength.toFixed(3)}->${ablationStrength.toFixed(3)}`,
              );
              similarResult = {
                ...similarResult,
                results: ablationSafeResults,
              };
            }
          }

          const effectiveSimilarityThreshold =
            options.similarityThreshold ?? config.clip.imageSimilarityThreshold;

          console.log(`[skip-trace] detection="${categorySource}" after_knn_search=${similarResult.results.length}`);
          const searchMeta = (similarResult as any)?.meta;
          if (searchMeta?.ordered_stage_counts) {
            console.log(`[skip-trace-stages] detection="${categorySource}" ${JSON.stringify(searchMeta.ordered_stage_counts)}`);
          }
          const stageDropSamples = searchMeta?.stage_drop_samples;
          if (stageDropSamples && Object.keys(stageDropSamples).length > 0) {
            console.log(`[skip-trace-drops] detection="${categorySource}" ${JSON.stringify(stageDropSamples)}`);
          }
          const knnCandidates = similarResult.results.length;

          const precisionSafeResults = applyShopLookVisualPrecisionGuard(
            similarResult.results,
            categoryMapping.productCategory === "footwear" && (detection.area_ratio ?? 0) <= 0.02
              ? shopLookTinyFootwearRecoveryThreshold(effectiveSimilarityThreshold)
              : effectiveSimilarityThreshold,
            categoryMapping.productCategory,
          );

          console.log(`[skip-trace] detection="${categorySource}" after_precision_guard=${precisionSafeResults.length} (filtered_by=${similarResult.results.length - precisionSafeResults.length})`);

          const categorySafeResults = applyDetectionCategoryGuard(
            precisionSafeResults,
            categorySource,
            categoryMapping,
            String((filters as any).gender ?? ""),
          );

          const sleeveSafeResults = applySleeveIntentGuard({
            products: categorySafeResults,
            detectionLabel: categorySource,
            categoryMapping,
          });

          console.log(`[skip-trace] detection="${categorySource}" after_category_guard=${categorySafeResults.length} (filtered_by=${precisionSafeResults.length - categorySafeResults.length})`);

          // Apply formality filter if formal wear was detected from BLIP caption
          const minFormality = (filters as any).minFormality;
          if (minFormality) {
            console.log(`[formality-apply-alt] detection="${categorySource}" minFormality=${minFormality} incoming=${sleeveSafeResults.length}`);
          }
          const formalitySafeResults = applyFormalityFilter(sleeveSafeResults, minFormality);

          const athleticSafeResults = applyAthleticMismatchGuard({
            products: formalitySafeResults,
            detectionLabel: categorySource,
            productCategory: categoryMapping.productCategory,
            softStyle: String((filters as any).softStyle ?? ""),
            minFormality,
          });

          console.log(`[skip-trace] detection="${categorySource}" after_sleeve_guard=${sleeveSafeResults.length} (filtered_by=${categorySafeResults.length - sleeveSafeResults.length})`);
          console.log(`[skip-trace] detection="${categorySource}" after_formality_filter=${formalitySafeResults.length} (filtered_by=${sleeveSafeResults.length - formalitySafeResults.length})`);
          console.log(`[skip-trace] detection="${categorySource}" after_athletic_guard=${athleticSafeResults.length} (filtered_by=${formalitySafeResults.length - athleticSafeResults.length})`);

          if (athleticSafeResults.length === 0) {
            const debugCategory = Array.isArray((filters as any).category)
              ? (filters as any).category.map((c: unknown) => String(c ?? "").trim()).filter(Boolean).join("|")
              : String((filters as any).category ?? "").trim();
            const debugProductTypes = Array.isArray((filters as any).productTypes)
              ? (filters as any).productTypes.map((t: unknown) => String(t ?? "").trim()).filter(Boolean)
              : [];
            console.log(`[skip-trace-WARN] detection="${categorySource}" ZERO_RESULTS filters={category:"${debugCategory || "none"}", productTypes:[${debugProductTypes.join(",")}], softStyle:"${filters.softStyle}", minFormality:${minFormality}}`);
            const meta = (similarResult as any)?.meta;
            const pc = meta?.pipeline_counts;
            if (meta && pc) {
              console.log(
                `[skip-trace-meta] detection="${categorySource}" raw_hits=${pc.raw_open_search_hits ?? 0} ranked=${pc.ranked_candidates ?? 0} visual_pass=${pc.threshold_passed_visual ?? 0} final_accept=${pc.hits_after_final_accept_min ?? 0} dedupe=${pc.hits_after_dedupe ?? 0} relaxed=${meta.threshold_relaxed ? 1 : 0} below_relevance=${meta.below_relevance_threshold ? 1 : 0} below_final_gate=${meta.below_final_relevance_gate ? 1 : 0}`,
              );
            }
          }

          similarResult = {
            ...similarResult,
            results: athleticSafeResults,
          };

          const includeEmpty = options.includeEmptyDetectionGroups === true;
          if (similarResult.results.length > 0 || includeEmpty) {
            const droppedByOtherGates = Math.max(0, knnCandidates - athleticSafeResults.length);
            return {
              detection: {
                label: detection.label,
                confidence: detection.confidence,
                box: detection.box,
                area_ratio: detection.area_ratio,
                style: detection.style,
                mask: detection.mask,
              },
              category: categoryMapping.productCategory,
              products: similarResult.results,
              count: similarResult.results.length,
              appliedFilters: {
                category: filters.category,
                color: (filters as any).color,
                productTypes: filters.productTypes,
                gender: filters.gender,
                ageGroup: filters.ageGroup,
                softStyle: filters.softStyle,
                sleeve: (filters as any).sleeve,
                length: (filters as any).length,
              },
              debug: {
                knnCandidateCount: knnCandidates,
                afterPrecisionGuard: precisionSafeResults.length,
                afterCategoryGuard: categorySafeResults.length,
                afterSleeveGuard: sleeveSafeResults.length,
                afterFormalityFilter: formalitySafeResults.length,
                afterAthleticGuard: athleticSafeResults.length,
                afterRecovery: similarResult.results.length,
                droppedByOtherGates,
                droppedByFinalRelevance: 0,
                droppedByColorGate: 0,
              },
              source: isUserDefined ? "user_defined" : "yolo",
              originalIndex: isUserDefined ? undefined : originalIndices[i],
            } as SelectiveDetectionResult;
          }
          return null;
        } catch (err) {
          console.error(`Failed to process detection ${detection.label}:`, err);
          return null;
        }
      },
    );
    const selectiveEmbeddingFallbackCount = Math.max(
      0,
      selectiveDetectionJobs.length - selectiveEmbeddingBatchReady,
    );
    if (process.env.NODE_ENV !== "production" || String(process.env.SEARCH_DEBUG ?? "") === "1") {
      console.info("[image-search][selective-embedding-batch-usage]", {
        detectionJobs: selectiveDetectionJobs.length,
        embeddingBatchReady: selectiveEmbeddingBatchReady,
        embeddingFallbackCount: selectiveEmbeddingFallbackCount,
        embeddingBatchMs: selectiveEmbeddingBatchMs,
      });
    }

    for (const outcome of selectiveSettled) {
      if (outcome.status === "fulfilled" && outcome.value) {
        groupedResults.push(outcome.value);
        totalProducts += outcome.value.count;
      } else if (outcome.status === "rejected") {
        console.error("Failed to process detection in selective flow:", outcome.reason);
      }
    }

    const postRankedSel = applyGroupedPostRanking(
      groupedResults,
      imageCrossGroupDedupeEnabled(),
      options.collapseVariantGroups !== false,
    );
    const pagedSel = paginateDetectionGroups(
      postRankedSel.rows,
      resolvedResultsPage,
      resolvedResultsPageSize,
    );
    const finalGroupedResults = pagedSel.rows as SelectiveDetectionResult[];
    totalProducts = pagedSel.totalProducts;

    // Apply minimum relevance threshold filter to paginated results as well
    const minRelevanceThresholdSel = shopLookMinFinalRelevanceThreshold();
    console.log(`[relevance-gate-sel] applying minRelevance=${minRelevanceThresholdSel} to paginated results`);

    const relevanceFilteredResultsSel = finalGroupedResults.map((detection) => {
      const beforeProducts = Array.isArray(detection.products) ? detection.products : [];
      const categoryNorm = String(detection.category ?? "").toLowerCase().trim();
      const appliedCategoryText = Array.isArray((detection.appliedFilters as any)?.category)
        ? (detection.appliedFilters as any).category.join(" ")
        : String((detection.appliedFilters as any)?.category ?? "");
      const suitCaptionTailoredFallback =
        categoryNorm === "outerwear" &&
        /\b(tailored|suit|suits|tuxedo|tuxedos|waistcoat|waistcoats|vest|vests|gilet|gilets|structured\s+jacket|tailored\s+jacket)\b/.test(
          appliedCategoryText.toLowerCase(),
        );
      const preserveCountForDetection = isCoreOutfitCategory(detection.category)
        || suitCaptionTailoredFallback
        ? Math.min(3, Math.max(1, Math.floor(resolvedLimitPerItem * 0.12)))
        : 0;
      const inferredDesiredColorState = (() => {
        const explicitColor = (detection.appliedFilters as any)?.color;
        if (explicitColor != null && String(explicitColor).trim().length > 0) {
          return { color: explicitColor, confidence: 1 };
        }
        const rawIndex = Number((detection as any)?.detectionIndex);
        const hasIndex = Number.isFinite(rawIndex) && rawIndex >= 0;
        const detLabel = String((detection as any)?.detection?.label ?? "").trim();
        if (!hasIndex || !detLabel) return { color: undefined, confidence: 0 };
        const colorKey = detectionColorKey(detLabel, Math.floor(rawIndex));
        const inferred = inferredColorsByItem[colorKey];
        const inferredConfidence = Number(inferredColorsByItemConfidence[colorKey] ?? 0);
        return inferred && inferredConfidence >= 0.4
          ? { color: inferred, confidence: inferredConfidence }
          : { color: undefined, confidence: inferredConfidence };
      })();
      console.log(
        `[relevance-debug-sel] detection="${detection.detection?.label ?? "unknown"}" category="${detection.category}" desiredColor="${String(inferredDesiredColorState.color ?? "")}" source=${(detection.appliedFilters as any)?.color ? "explicit" : "inferred_or_none"}`,
      );
      const afterProducts = applyRelevanceThresholdFilter(beforeProducts, minRelevanceThresholdSel, {
        preserveAtLeastOne: isCoreOutfitCategory(detection.category) || suitCaptionTailoredFallback,
        preserveAtLeastCount: preserveCountForDetection,
        detectionLabel: detection.detection?.label,
        category: detection.category,
        desiredColor: inferredDesiredColorState.color,
        desiredColorConfidence: inferredDesiredColorState.confidence,
      });
      const droppedByFinalRelevance = Math.max(0, beforeProducts.length - afterProducts.length);
      const droppedByColorGate = beforeProducts.filter((prod) => {
        const relevance = Number((prod as any)?.finalRelevance01 ?? 0);
        const source = String((prod as any)?.explain?.finalRelevanceSource ?? "").toLowerCase();
        return relevance < minRelevanceThresholdSel && source.includes("color");
      }).length;
      if (droppedByFinalRelevance > 0) {
        console.log(
          `[relevance-gate-drop-sel] detection="${detection.detection?.label ?? "unknown"}" category="${detection.category}" before=${beforeProducts.length} after=${afterProducts.length} threshold=${minRelevanceThresholdSel} dropped=${droppedByFinalRelevance} color_drops=${droppedByColorGate} samples=${JSON.stringify(sampleDroppedProductsForLog(beforeProducts, afterProducts))}`,
        );
      }
      return {
        ...detection,
        products: afterProducts,
        count: 0, // Will be recalculated below
        debug: {
          ...(detection.debug ?? {
            knnCandidateCount: beforeProducts.length,
            afterPrecisionGuard: beforeProducts.length,
            afterCategoryGuard: beforeProducts.length,
            afterSleeveGuard: beforeProducts.length,
            afterFormalityFilter: beforeProducts.length,
            afterAthleticGuard: beforeProducts.length,
            afterRecovery: beforeProducts.length,
            droppedByOtherGates: 0,
            droppedByFinalRelevance: 0,
            droppedByColorGate: 0,
          }),
          droppedByFinalRelevance,
          droppedByColorGate,
        },
      };
    });

    // Recalculate counts and total after filtering
    let newTotalProductsSel = 0;
    for (const result of relevanceFilteredResultsSel) {
      result.count = result.products.length;
      newTotalProductsSel += result.count;
    }

    const relevanceFilteredResultsSelWithColorSource = relevanceFilteredResultsSel.map((row) => {
      const sortedRow = sortDetectionProductsByFinalRelevance(row);
      const rawIndex = Number((sortedRow as any)?.detectionIndex);
      const hasIndex = Number.isFinite(rawIndex) && rawIndex >= 0;
      const detLabel = String((sortedRow as any)?.detection?.label ?? "").trim();
      if (!hasIndex || !detLabel) return sortedRow;
      const colorKey = detectionColorKey(detLabel, Math.floor(rawIndex));
      const colorSource = detectionColorSourceName(inferredColorsByItemSource[colorKey]);
      return {
        ...sortedRow,
        detection: {
          ...(sortedRow as any).detection,
          colorSource,
        },
      };
    });

    console.log(
      `[relevance-gate-sel] total products before=${totalProducts} → after=${newTotalProductsSel} (threshold=${minRelevanceThresholdSel})`,
    );
    totalProducts = newTotalProductsSel;

    const itemsForCoherence: DetectionWithColor[] = [];
    for (let i = 0; i < allItemsToProcess.length; i++) {
      const detection = allItemsToProcess[i] as DetectionWithColor;
      const yoloOriginalIndex = i < originalIndices.length ? originalIndices[i] : undefined;
      const colorIndex = yoloOriginalIndex ?? i;
      const colorKey = detectionColorKey(detection.label, colorIndex);
      itemsForCoherence.push({
        ...detection,
        dominantColor: inferredColorsByItem[colorKey] ?? detection.dominantColor,
        colorConfidence: inferredColorsByItemConfidence[colorKey] ?? detection.colorConfidence,
        colorSource: detectionColorSourceName(inferredColorsByItemSource[colorKey]),
      } as DetectionWithColor);
    }

    const coherenceDetections = dedupeOverlappingDetections(itemsForCoherence);
    const outfitCoherence =
      coherenceDetections.length > 0
        ? computeOutfitCoherence(coherenceDetections)
        : undefined;

    if (process.env.NODE_ENV !== "production" || String(process.env.SEARCH_DEBUG ?? "") === "1") {
      console.info("[image-search][blip-enrichment]", {
        stage: "analyzeWithSelection",
        fullStructuredConfidence: Math.round(blipStructuredConfidence * 1000) / 1000,
        ...obs,
      });
    }

    const coveredSel = relevanceFilteredResultsSel.filter((r) => r.count > 0).length;
    const totalSel = allItemsToProcess.length;
    const itemPrimary = derivePrimaryColorFromItemsWithConfidence(
      inferredColorsByItem,
      inferredColorsByItemConfidence,
    );
    const resolvedPrimaryColor = pickColorByHighestConfidence([
      { color: captionPrimaryColor, confidence: captionPrimaryColorConfidence },
      { color: dominantPrimaryColor, confidence: dominantPrimaryColorConfidence },
      { color: itemPrimary.color, confidence: itemPrimary.confidence },
    ]);

    return {
      ...fullResult,
      blipCaption,
      inferredAudience,
      inferredPrimaryColor: resolvedPrimaryColor,
      inferredColorsByItem,
      inferredColorsByItemConfidence,
      inferredColorsByItemSource: Object.fromEntries(
        Object.entries(inferredColorsByItemSource).map(([k, v]) => [k, detectionColorSourceName(v)]),
      ),
      similarProducts: {
        byDetection: relevanceFilteredResultsSelWithColorSource,
        totalProducts: newTotalProductsSel,
        totalAvailableProducts: pagedSel.totalAvailableProducts,
        threshold: options.similarityThreshold ?? config.clip.imageSimilarityThreshold,
        detectedCategories: [...new Set(relevanceFilteredResultsSelWithColorSource.map((r) => r.category))],
        pagination: {
          mode: "per_detection",
          page: resolvedResultsPage,
          pageSize: resolvedResultsPageSize,
        },
        shopTheLookStats: {
          totalDetections: totalSel,
          coveredDetections: coveredSel,
          emptyDetections: totalSel - coveredSel,
          coverageRatio: totalSel > 0 ? coveredSel / totalSel : 0,
        },
      },
      outfitCoherence,
    };
  }

  /**
   * Crop a detection region from an image
   */
  private async cropDetection(
    buffer: Buffer,
    box: { x1: number; y1: number; x2: number; y2: number },
    imageWidth: number,
    imageHeight: number
  ): Promise<Buffer | null> {
    const cropWidth = Math.max(1, Math.round(box.x2 - box.x1));
    const cropHeight = Math.max(1, Math.round(box.y2 - box.y1));
    const cropLeft = Math.max(0, Math.round(box.x1));
    const cropTop = Math.max(0, Math.round(box.y1));

    const safeWidth = Math.min(cropWidth, imageWidth - cropLeft);
    const safeHeight = Math.min(cropHeight, imageHeight - cropTop);

    if (safeWidth < 10 || safeHeight < 10) {
      return null;
    }

    return sharp(buffer)
      .extract({
        left: cropLeft,
        top: cropTop,
        width: safeWidth,
        height: safeHeight,
      })
      .toBuffer();
  }

  /**
   * Store image in R2 and database
   */
  private async storeImage(
    buffer: Buffer,
    filename: string,
    productId?: number,
    isPrimary: boolean = false,
    pHash: string | null = null
  ): Promise<{ id: number; url: string; width: number; height: number; pHash: string | null }> {
    const ext = filename.split(".").pop()?.toLowerCase() || "jpg";
    const contentType = this.getContentType(ext);

    // Generate unique key based on content hash
    const hash = crypto.createHash("md5").update(buffer).digest("hex").slice(0, 12);
    const key = productId
      ? `products/${productId}/${hash}.${ext}`
      : `uploads/${Date.now()}-${hash}.${ext}`;

    // Upload to R2
    await uploadImage(buffer, key, contentType);
    const cdnUrl = getCdnUrl(key);

    // If no product ID, just return URL info
    if (!productId) {
      return { id: 0, url: cdnUrl, width: 0, height: 0, pHash };
    }

    const primaryState = await pg.query<{
      has_primary_image: boolean;
      has_product_primary: boolean;
    }>(
      `SELECT
          EXISTS(SELECT 1 FROM product_images WHERE product_id = $1 AND is_primary = true) AS has_primary_image,
          EXISTS(SELECT 1 FROM products WHERE id = $1 AND primary_image_id IS NOT NULL) AS has_product_primary`,
      [productId],
    );
    const hasPrimaryImage = Boolean(primaryState.rows[0]?.has_primary_image);
    const hasProductPrimary = Boolean(primaryState.rows[0]?.has_product_primary);
    const effectiveIsPrimary = isPrimary || (!hasPrimaryImage && !hasProductPrimary);

    // If primary, unset other primary images
    if (effectiveIsPrimary) {
      await pg.query(
        "UPDATE product_images SET is_primary = FALSE WHERE product_id = $1",
        [productId]
      );
    }

    // Insert into database
    const result = await pg.query<{ id: number }>(
      `INSERT INTO product_images (product_id, r2_key, cdn_url, p_hash, is_primary)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [productId, key, cdnUrl, pHash, effectiveIsPrimary]
    );
    const insertedId = result.rows[0].id;

    if (effectiveIsPrimary) {
      await pg.query(
        `UPDATE products SET primary_image_id = $1, image_cdn = $2 WHERE id = $3`,
        [insertedId, cdnUrl, productId],
      );
    }

    return { id: insertedId, url: cdnUrl, width: 0, height: 0, pHash };
  }

  private getContentType(ext: string): string {
    switch (ext) {
      case "png":
        return "image/png";
      case "webp":
        return "image/webp";
      case "gif":
        return "image/gif";
      default:
        return "image/jpeg";
    }
  }

  private async persistDetectionRows(
    productImageId: number,
    productId: number | undefined,
    detections: Detection[],
  ): Promise<void> {
    try {
      if (detections.length === 0) return;
      
      // Batch insert all detections in a single query for 50-100x better performance
      // Process in chunks of 100 to balance between query size and connection pool pressure
      const chunkSize = 100;
      for (let i = 0; i < detections.length; i += chunkSize) {
        const chunk = detections.slice(i, i + chunkSize);
        const values: any[] = [];
        const placeholders: string[] = [];
        let paramIdx = 1;

        chunk.forEach((det) => {
          placeholders.push(
            `($${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++})`
          );
          values.push(
            productImageId,
            productId || null,
            det.label || null,
            (det as any).raw_label || null,
            typeof det.confidence === "number" ? det.confidence : null,
            det.box ? JSON.stringify(det.box) : null,
            det.box ? Math.round(det.box.x1) : null,
            det.box ? Math.round(det.box.y1) : null,
            det.box ? Math.round(det.box.x2) : null,
            det.box ? Math.round(det.box.y2) : null,
            typeof det.area_ratio === "number" ? det.area_ratio : null,
            det.style ? JSON.stringify(det.style) : null
          );
        });

        const query = `
          INSERT INTO product_image_detections
          (product_image_id, product_id, label, raw_label, confidence, box, box_x1, box_y1, box_x2, box_y2, area_ratio, style)
          VALUES ${placeholders.join(',')}
        `;

        try {
          await pg.query(query, values);
        } catch (err) {
          console.error(`Failed to persist detection batch (${chunk.length} rows):`, err);
        }
      }
    } catch (err) {
      console.error("Error persisting detections:", err);
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let serviceInstance: ImageAnalysisService | null = null;

export function getImageAnalysisService(): ImageAnalysisService {
  if (!serviceInstance) {
    serviceInstance = new ImageAnalysisService();
  }
  return serviceInstance;
}

export default ImageAnalysisService;
