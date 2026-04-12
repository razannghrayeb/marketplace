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
import {
  YOLOv8Client,
  getYOLOv8Client,
  extractOutfitComposition,
  dedupeDetectionsBySameLabelIou,
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
}): { ageGroup?: "adult" } {
  const blob = [params.caption ?? "", ...params.detections.map((d) => `${d.label ?? ""} ${d.raw_label ?? ""}`)]
    .join(" ")
    .toLowerCase();
  if (!blob.trim()) return {};
  if (/\b(kids?|children|child|baby|babies|toddler|toddlers|youth|junior|girls?|boys?)\b/.test(blob)) return {};
  if (/\b(dress|top|shirt|blouse|skirt|pants|trousers|jeans|shorts|hoodie|sweater|cardigan|jacket|coat|tshirt|t-shirt|jumpsuit|romper|abaya|kaftan)\b/.test(blob)) {
    return { ageGroup: "adult" };
  }
  return {};
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

/** When true: if category-filtered search returns nothing, retry without category (default off — can look irrelevant). */
function shopLookCategoryFallbackEnv(): boolean {
  const v = String(process.env.SEARCH_IMAGE_SHOP_CATEGORY_FALLBACK ?? "").toLowerCase();
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
  const raw = Number(process.env.SEARCH_IMAGE_SHOP_RECALL_MULTIPLIER ?? "3");
  if (!Number.isFinite(raw)) return 3;
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

function shopLookTinyFootwearRecoveryThreshold(baseThreshold: number): number {
  const raw = Number(process.env.SEARCH_IMAGE_SHOP_TINY_FOOTWEAR_MIN_SIM ?? "0.55");
  const floor = Number.isFinite(raw) ? raw : 0.55;
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
    if (lb.includes("short sleeve top") || lb.includes("long sleeve top")) return true;
  }
  return false;
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

  const caption = await captionWithTimeout(buffer);
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
  return false;
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
  "short sleeve outwear": 5,
  blazer: 7,
  coat: 6,
  jacket: 4,
  parka: 3,
  bomber: 3,

  // Footwear
  shoe: 5,
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
  const occasion = formality >= 7 ? "formal" : "casual";
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
  captionColors: { topColor?: string | null; jeansColor?: string | null; garmentColor?: string | null },
): string | null {
  if (productCategory === "tops") return captionColors.topColor ?? null;
  if (productCategory === "bottoms") return captionColors.jeansColor ?? null;
  if (productCategory === "dresses") return captionColors.garmentColor ?? null;
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

async function extractDetectionCropColorsForRanking(params: {
  clipBuffer: Buffer;
  productCategory: string;
  detectionLabel: string;
}): Promise<string[]> {
  const onePiece = isOnePieceColorSensitiveCategory(params.productCategory, params.detectionLabel);
  const bottoms = isBottomColorSensitiveCategory(params.productCategory, params.detectionLabel);
  const topLike = isTopLikeColorSensitiveCategory(params.productCategory, params.detectionLabel);
  let colorBuffer = params.clipBuffer;

  if (onePiece || bottoms || topLike) {
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
          left = Math.floor(w * 0.14);
          width = Math.max(16, Math.floor(w * 0.72));
          top = Math.floor(h * 0.24);
          const bottom = Math.floor(h * 0.76);
          height = Math.max(24, bottom - top);
        } else if (topLike) {
          // Top/outerwear boxes can include pants near the lower edge.
          // Sample upper-mid torso and trim side edges to avoid background/pants bleed.
          left = Math.floor(w * 0.12);
          width = Math.max(16, Math.floor(w * 0.76));
          top = Math.floor(h * 0.08);
          const bottom = Math.floor(h * 0.66);
          height = Math.max(24, bottom - top);
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
    maxColors: 2,
    minShare: onePiece ? 0.18 : bottoms ? 0.17 : 0.15,
  });
}

function requiresSlotSpecificColor(productCategory: string): boolean {
  return productCategory === "tops" || productCategory === "bottoms" || productCategory === "dresses";
}

function ensureStyleAndMask(detection: Detection, imageWidth: number, imageHeight: number): Detection {
  const next: Detection = { ...detection };

  // Style fallback (YOLO dual-model currently returns `style: null`).
  const needsStyle = !next.style || typeof next.style.formality !== "number";
  if (needsStyle) {
    next.style = inferStyleForDetectionLabel(next.label).style;
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

/** Max concurrent OpenSearch kNN calls per shop-the-look request (default 3). */
function shopLookPerDetectionConcurrency(): number {
  const raw = Number(process.env.SEARCH_IMAGE_SHOP_DETECTION_CONCURRENCY);
  const n = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 3;
  return Math.min(16, Math.max(1, n));
}

/**
 * Build a hard OpenSearch `filters.category` term set that matches catalog category values.
 * We use the label as the source of specificity, because the macro aisle (e.g. `bottoms`)
 * often does not exist as a concrete `products.category` value in the catalog.
 */
function hardCategoryTermsForDetection(
  detectionLabel: string,
  categoryMapping: CategoryMapping,
): string[] {
  const l = String(detectionLabel || "").toLowerCase();
  const baseTerms = getCategorySearchTerms(categoryMapping.productCategory).map((t) =>
    String(t).toLowerCase().trim(),
  );

  if (categoryMapping.productCategory === "tops") {
    const isShortTop = /\bshort sleeve top\b|\btee\b|\bt-?shirt\b|\btshirt\b|\btank\b|\bcamisole\b|\bcrop top\b/.test(
      l,
    );
    if (isShortTop) {
      const shortTopTerms = baseTerms.filter((t) =>
        /\b(t-?shirt|tshirt|tee|top|tops|tank|camisole|cami|crop top|polo|polos)\b/.test(t),
      );
      return shortTopTerms.length > 0 ? shortTopTerms : baseTerms;
    }

    const isLongTop = /\blong sleeve top\b|\bshirt\b|\bblouse\b|\bovershirt\b|\bhoodie\b|\bsweatshirt\b|\bsweater\b/.test(
      l,
    );
    if (isLongTop) {
      const longTopTerms = baseTerms.filter((t) =>
        /\b(shirt|shirts|blouse|blouses|overshirt|sweater|hoodie|sweatshirt|pullover|cardigan|knitwear|top|tops)\b/.test(
          t,
        ),
      );
      return longTopTerms.length > 0 ? longTopTerms : baseTerms;
    }
  }

  // Keep trousers/pants as primary, but allow jeans/denim candidates when the
  // detector says "trousers" so denim bottoms are not over-pruned.
  if (categoryMapping.productCategory === "bottoms") {
    const isTrousersLike = /\b(trouser|trousers|pants|pant|chino|chinos|slack|slacks|cargo|cargo pants|sweatpants|sweatpants)\b/.test(
      l,
    );
    const isJeansLike = /\b(jean|jeans|denim|denims)\b/.test(l);

    if (isTrousersLike) {
      const trouserLike = baseTerms.filter((t) =>
        /\b(pant|pants|trouser|trousers|chino|chinos|slack|slacks|cargo)\b/.test(t),
      );
      const jeansLike = baseTerms.filter((t) => /\b(jean|jeans|denim|denims)\b/.test(t));
      const merged = [...new Set([...trouserLike, ...jeansLike])];
      return merged.length > 0 ? merged : baseTerms;
    }
    if (isJeansLike) {
      return baseTerms.filter((t) => /\b(jean|jeans|denim|denims)\b/.test(t));
    }
    const isSkirtLike = /\b(skirt|skirts|mini skirt|midi skirt|maxi skirt)\b/.test(l);
    if (isSkirtLike) {
      return baseTerms.filter((t) => /\b(skirt|skirts)\b/.test(t));
    }
    return baseTerms;
  }

  if (categoryMapping.productCategory === "bags") {
    return baseTerms.filter((t) =>
      /\b(bag|bags|wallet|purse|handbag|handbags|tote|totes|backpack|backpacks|clutch|clutches|crossbody|satchel|satchels)\b/.test(
        t,
      ),
    );
  }

  // Prefer hat/cap-family over generic `accessories`.
  if (categoryMapping.productCategory === "accessories") {
    if (/\b(headband|head covering|hair accessory|hairband|headwear)\b/.test(l)) {
      return baseTerms.filter((t) => /\b(headband|headwear|hair|hairband|hat|hats|cap)\b/.test(t));
    }
    if (/\b(hat|hats|cap)\b/.test(l)) {
      return baseTerms.filter((t) => /\b(hat|hats|cap)\b/.test(t));
    }
    if (/\b(bag|wallet|purse|handbag|tote|backpack|clutch|crossbody)\b/.test(l)) {
      return baseTerms.filter((t) =>
        /\b(bag|bags|wallet|purse|handbag|handbags|tote|totes|backpack|backpacks|clutch|clutches|crossbody|satchel|satchels)\b/.test(
          t,
        ),
      );
    }
    return baseTerms;
  }

  return baseTerms;
}

function expandPredictedTypeHints(seeds: string[]): string[] {
  const normalized = seeds.map((s) => String(s).toLowerCase().trim()).filter(Boolean);
  if (normalized.length === 0) return [];
  return expandProductTypesForQuery(normalized);
}

function tightenTypeSeedsForDetection(
  detectionLabel: string,
  categoryMapping: CategoryMapping,
  seeds: string[],
): string[] {
  const label = String(detectionLabel || "").toLowerCase();
  const category = String(categoryMapping.productCategory || "").toLowerCase();
  const normalized = [...new Set(seeds.map((s) => String(s).toLowerCase().trim()).filter(Boolean))];
  if (normalized.length === 0) return normalized;

  if (category === "tops") {
    if (/\bshort sleeve top\b|\btee\b|\bt-?shirt\b/.test(label)) {
      const shortTop = normalized.filter((t) =>
        /\b(tshirt|t-?shirt|tee|tees|top|tops|tank|camisole|cami|crop top|polo|polos)\b/.test(t),
      );
      return shortTop.length > 0 ? shortTop : normalized;
    }
    if (/\blong sleeve top\b|\bshirt\b|\bblouse\b/.test(label)) {
      const longTop = normalized.filter((t) =>
        /\b(shirt|shirts|blouse|blouses|top|tops|sweater|hoodie|sweatshirt|pullover|cardigan|knitwear)\b/.test(t),
      );
      return longTop.length > 0 ? longTop : normalized;
    }
  }

  if (category === "bottoms") {
    if (/\btrouser|trousers|pant|pants|chino|chinos|slack|slacks|cargo\b/.test(label)) {
      const trouserLike = normalized.filter((t) =>
        /\b(trouser|trousers|pant|pants|chino|chinos|slack|slacks|cargo)\b/.test(t),
      );
      const jeansLike = normalized.filter((t) => /\b(jean|jeans|denim)\b/.test(t));
      const merged = [...new Set([...trouserLike, ...jeansLike])];
      return merged.length > 0 ? merged : normalized;
    }
    if (/\bjean|jeans|denim\b/.test(label)) {
      const jeansLike = normalized.filter((t) => /\b(jean|jeans|denim)\b/.test(t));
      return jeansLike.length > 0 ? jeansLike : normalized;
    }
    if (/\bskirt|skirts\b/.test(label)) {
      const skirtLike = normalized.filter((t) => /\b(skirt|skirts)\b/.test(t));
      return skirtLike.length > 0 ? skirtLike : normalized;
    }
  }

  if (category === "bags") {
    const bagLike = normalized.filter((t) =>
      /\b(bag|bags|wallet|purse|handbag|handbags|tote|totes|backpack|backpacks|clutch|clutches|crossbody|satchel|satchels)\b/.test(
        t,
      ),
    );
    return bagLike.length > 0 ? bagLike : normalized;
  }

  if (category === "outerwear") {
    const formalOuterwearLabel = /\b(suit|blazer|sport\s*coat|dress\s*jacket)\b/.test(label);
    const outerwearLike = normalized.filter((t) => {
      if (/\bdress\b/.test(t) && !/\bdress\s*jacket\b/.test(t)) return false;
      if (/\b(suit|suits|sport\s*coat|sportcoat|dress\s*jacket)\b/.test(t) && !formalOuterwearLabel) {
        return false;
      }
      return /\b(jacket|jackets|coat|coats|parka|parkas|trench|windbreaker|windbreakers|vest|vests|gilet|poncho|anorak|bomber|blazer|blazers|outerwear|outwear)\b/.test(
        t,
      );
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
      return /\b(dress|dresses|vest dress|midi dress|maxi dress|mini dress|frock)\b/.test(t);
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

/** IoU threshold for merging same-label detections when `groupByDetection` is false (default 0.5). */
function yoloShopDedupeIouThreshold(): number {
  const raw = Number(process.env.YOLO_SHOP_DEDUPE_IOU_THRESHOLD);
  const n = Number.isFinite(raw) ? raw : 0.5;
  return Math.min(0.95, Math.max(0.05, n));
}

function imageMinFootwearAreaRatio(): number {
  const raw = Number(process.env.SEARCH_IMAGE_MIN_FOOTWEAR_AREA_RATIO ?? "0.0045");
  if (!Number.isFinite(raw)) return 0.0045;
  return Math.max(0, Math.min(1, raw));
}

function imageMinFootwearConfidence(): number {
  const raw = Number(process.env.SEARCH_IMAGE_MIN_FOOTWEAR_CONFIDENCE ?? "0.72");
  if (!Number.isFinite(raw)) return 0.72;
  return Math.max(0, Math.min(1, raw));
}

function imageMinAccessoryAreaRatio(): number {
  const raw = Number(process.env.SEARCH_IMAGE_MIN_ACCESSORY_AREA_RATIO ?? "0.01");
  if (!Number.isFinite(raw)) return 0.01;
  return Math.max(0, Math.min(1, raw));
}

function imageMinAccessoryConfidence(): number {
  const raw = Number(process.env.SEARCH_IMAGE_MIN_ACCESSORY_CONFIDENCE ?? "0.8");
  if (!Number.isFinite(raw)) return 0.8;
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
  if (category === "accessories" || category === "bags") return false;
  const confOk = (detection.confidence ?? 0) >= imageStrongHintsTypeConfMin();
  const areaOk = (detection.area_ratio ?? 0) >= imageStrongHintsTypeAreaMin();
  return confOk && areaOk;
}

function shouldKeepDetectionForShopTheLook(detection: Detection): boolean {
  const mapped = mapDetectionToCategory(detection.label, detection.confidence).productCategory;
  const areaRatio = Number.isFinite(detection.area_ratio) ? detection.area_ratio : 0;
  const confidence = Number.isFinite(detection.confidence) ? detection.confidence : 0;
  if (mapped === "accessories") {
    const label = String(detection.label || "").toLowerCase();
    const isHeadAccessory = /\b(headband|head covering|hair accessory|hairband|headwear)\b/.test(label);
    // Tiny accessory detections are often noisy and lead to irrelevant bag-heavy retrieval.
    if (
      areaRatio < imageMinAccessoryAreaRatio() &&
      (confidence < imageMinAccessoryConfidence() || isHeadAccessory)
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

function shouldForceHardCategoryForDetection(
  detection: Detection,
  categoryMapping: CategoryMapping,
): boolean {
  const confidence = Number.isFinite(detection.confidence) ? detection.confidence : 0;
  const areaRatio = Number.isFinite(detection.area_ratio) ? detection.area_ratio : 0;
  const category = String(categoryMapping.productCategory || "").toLowerCase();

  // Clear garment detections should constrain retrieval hard once the detector is confident enough.
  // Without this, shop-the-look returns visually plausible but wrong categories for items like trousers.
  if (category === "tops" || category === "bottoms" || category === "dresses" || category === "outerwear") {
    return confidence >= 0.9 && areaRatio >= 0.01;
  }

  // Exact accessory detections are often small, but when they are high-confidence we must
  // treat them as hard retrieval constraints or the visual search drifts into unrelated items.
  if (category === "footwear") {
    return confidence >= 0.8;
  }
  if (category === "bags") {
    return confidence >= 0.85 && areaRatio >= 0.003;
  }
  if (category === "accessories") {
    return confidence >= 0.88 && areaRatio >= 0.0025;
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
  const raw = String(process.env.SEARCH_IMAGE_DETECTION_CATEGORY_GUARD ?? "1").toLowerCase();
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
  if (/\b(sleeveless|tank|camisole|cami|vest top|strapless|halter)\b/.test(label)) {
    return "sleeveless";
  }
  if (/\bshort sleeve\b/.test(label)) return "short";
  if (/\blong sleeve\b/.test(label)) return "long";
  return null;
}

function inferSleeveFromProductText(
  haystack: string,
): "short" | "long" | "sleeveless" | null {
  const txt = normalizeLooseText(haystack);
  if (!txt) return null;

  const hasSleeveless = /\b(sleeveless|tank|camisole|cami|strapless|halter)\b/.test(txt);
  const hasShort = /\b(short sleeve|short sleeved|ss)\b/.test(txt);
  const hasLong = /\b(long sleeve|long sleeved|ls)\b/.test(txt);

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

function isAccessoryLikeCategory(productCategory: string): boolean {
  const c = String(productCategory || "").toLowerCase();
  return c === "bags" || c === "accessories";
}

function applyDetectionCategoryGuard(
  products: ProductResult[],
  detectionLabel: string,
  categoryMapping: CategoryMapping,
): ProductResult[] {
  const guardEnabled = imageDetectionCategoryGuardEnabled();
  const strictAlwaysOn =
    categoryMapping.productCategory === "footwear" ||
    categoryMapping.productCategory === "bags" ||
    categoryMapping.productCategory === "accessories";
  if (!guardEnabled && !strictAlwaysOn) return products;
  if (!shouldUseStrictDetectionCategoryGuard(categoryMapping.productCategory)) return products;

  const strictTerms = hardCategoryTermsForDetection(detectionLabel, categoryMapping);
  const fallbackTerms = getCategorySearchTerms(categoryMapping.productCategory);
  const baseAllowed = strictTerms.length > 0 ? strictTerms : fallbackTerms;
  const allowedTerms = [...new Set(baseAllowed.map((t) => normalizeLooseText(t)).filter(Boolean))];
  const desiredSleeveIntent = inferSleeveIntentFromDetectionLabel(detectionLabel);
  if (allowedTerms.length === 0) return products;

  return products.filter((p) => {
    const categoryText = normalizeLooseText((p as any).category);
    const categoryCanonicalText = normalizeLooseText((p as any).category_canonical);
    const titleText = normalizeLooseText((p as any).title);
    const descriptionText = normalizeLooseText((p as any).description);
    const attrSleeveText = normalizeLooseText((p as any).attr_sleeve);
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
    if (!allowByTerm) return false;

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
      if (productCategoryMacro === "outerwear" || /\b(jacket|coat|blazer|outerwear)\b/.test(haystack)) {
        return false;
      }
    }
    if (categoryMapping.productCategory === "bags") {
      if (/\b(belt|belts|scarf|scarves|hat|hats|cap|caps|jewelry|bracelet|necklace|earrings)\b/.test(haystack)) {
        return false;
      }
    }

    return true;
  });
}

function applyShopLookVisualPrecisionGuard(
  products: ProductResult[],
  similarityThreshold: number,
): ProductResult[] {
  if (!Array.isArray(products) || products.length === 0) return [];

  const baseMin = Math.max(0, Math.min(1, similarityThreshold));
  const strictMin = Math.max(baseMin, Math.min(1, baseMin + shopLookPostVisualMinDelta()));
  const scoreOf = (p: ProductResult): number => {
    const raw = Number((p as any).similarity_score);
    return Number.isFinite(raw) ? raw : 0;
  };

  const strict = products.filter((p) => scoreOf(p) >= strictMin);
  if (strict.length >= shopLookPostVisualMinKeep()) return strict;

  // Never return below the endpoint threshold, even if lower-fidelity fallback paths ran.
  return products.filter((p) => scoreOf(p) >= baseMin);
}

/** Filter products by minimum formality requirement (when formal wear is detected from BLIP). */
function applyFormalityFilter(products: ProductResult[], minFormality: number | undefined): ProductResult[] {
  if (!minFormality || minFormality <= 0 || !Array.isArray(products) || products.length === 0) {
    return products;
  }

  // Only enforce a hard numeric gate when the product actually carries structured
  // formality metadata. Missing metadata should not zero out otherwise valid matches.
  const hasStructuredFormality = products.some((p) => {
    const v = Number((p as any)?.style?.formality);
    return Number.isFinite(v);
  });

  if (!hasStructuredFormality) {
    if (minFormality >= 8) {
      const casualFormalConflictRe = /\b(drawstring|jogger|sweatpants?|track\s?pant|trackpant|athletic|sportswear|sport|workout|gym|training|yoga|legging|hoodie)\b/i;
      const lexFiltered = products.filter((p) => {
        const blob = [
          (p as any).title,
          (p as any).description,
          (p as any).category,
          (p as any).brand,
          Array.isArray((p as any).product_types) ? (p as any).product_types.join(" ") : (p as any).product_types,
        ]
          .filter((x) => x != null)
          .map((x) => String(x))
          .join(" ");
        return !casualFormalConflictRe.test(blob);
      });
      if (lexFiltered.length !== products.length) {
        console.log(
          `[formality-filter] lexical fallback filtered ${products.length} -> ${lexFiltered.length} (minFormality=${minFormality})`,
        );
      }
      return lexFiltered;
    }
    console.log(
      `[formality-filter] skipped hard filter (no structured formality metadata, minFormality=${minFormality})`,
    );
    return products;
  }

  const filtered = products.filter((p) => {
    const formalityRaw = Number((p as any)?.style?.formality);
    if (!Number.isFinite(formalityRaw)) return true;
    return formalityRaw >= minFormality;
  });

  if (filtered.length !== products.length) {
    console.log(`[formality-filter] filtered ${products.length} → ${filtered.length} (minFormality=${minFormality})`);
  }
  
  return filtered;
}

function applyAthleticMismatchGuard(params: {
  products: ProductResult[];
  detectionLabel: string;
  productCategory: string;
  softStyle?: string;
  minFormality?: number;
}): ProductResult[] {
  const products = Array.isArray(params.products) ? params.products : [];
  if (products.length === 0) return products;

  const detectionLabel = String(params.detectionLabel ?? "").toLowerCase();
  const productCategory = String(params.productCategory ?? "").toLowerCase();
  const softStyle = String(params.softStyle ?? "").toLowerCase();
  const minFormality = Number(params.minFormality ?? 0);

  const isAthleticIntent =
    /\b(sport|athlet|training|workout|gym|fitness|running|jogging|activewear|sportswear)\b/.test(softStyle) ||
    /\b(sport|athlet|training|workout|gym|fitness|running|jogger|track|sportswear|legging)\b/.test(detectionLabel);
  if (isAthleticIntent) return products;

  const shouldGuardCategory =
    productCategory === "tops" ||
    productCategory === "bottoms" ||
    productCategory === "outerwear" ||
    (productCategory === "footwear" && minFormality >= 8);
  if (!shouldGuardCategory) return products;

  const athleticTokenRe = /\b(sport|sportswear|athlet|training|workout|gym|fitness|crossfit|yoga|jogger|track\s?pant|trackpant|running|runner|dry\s?-?fit|dri\s?-?fit|leggings?)\b/i;
  const athleticBrandRe = /\b(adidas|nike|puma|reebok|asics|under\s?armour|new\s?balance|lululemon|gymshark)\b/i;

  const filtered = products.filter((p) => {
    const blob = [
      (p as any).title,
      (p as any).description,
      (p as any).category,
      (p as any).category_canonical,
      (p as any).brand,
      Array.isArray((p as any).product_types) ? (p as any).product_types.join(" ") : (p as any).product_types,
    ]
      .filter((x) => x != null)
      .map((x) => String(x))
      .join(" ");
    const athleticByKeywords = athleticTokenRe.test(blob);
    const athleticByBrandAndText = athleticBrandRe.test(String((p as any).brand ?? "")) && athleticTokenRe.test(blob);
    return !(athleticByKeywords || athleticByBrandAndText);
  });

  if (filtered.length !== products.length) {
    console.log(
      `[athletic-guard] detection="${params.detectionLabel}" category=${params.productCategory} filtered ${products.length} -> ${filtered.length}`,
    );
  }

  return filtered;
}

/** Filter products by minimum finalRelevance01 score. Removes low-relevance matches from results. */
function applyRelevanceThresholdFilter(
  products: ProductResult[],
  minRelevance: number | undefined,
  options?: {
    preserveAtLeastOne?: boolean;
    detectionLabel?: string;
    category?: string;
  },
): ProductResult[] {
  if (!minRelevance || minRelevance <= 0 || !Array.isArray(products) || products.length === 0) {
    return products;
  }

  const filtered = products.filter((p) => {
    const relevance = Number((p as any)?.finalRelevance01 ?? 0);
    return relevance >= minRelevance;
  });

  if (filtered.length !== products.length) {
    console.log(
      `[relevance-threshold-filter] filtered ${products.length} → ${filtered.length} (minRelevance=${minRelevance})`,
    );
  }

  if (filtered.length === 0 && options?.preserveAtLeastOne) {
    const sorted = [...products].sort((a, b) => {
      const ar = Number((a as any)?.finalRelevance01 ?? Number.NEGATIVE_INFINITY);
      const br = Number((b as any)?.finalRelevance01 ?? Number.NEGATIVE_INFINITY);
      return br - ar;
    });
    const best = sorted[0];
    const bestRelevance = Number((best as any)?.finalRelevance01 ?? 0);
    console.log(
      `[relevance-threshold-fallback] preserved 1 product for detection="${options.detectionLabel ?? "unknown"}" category="${options.category ?? "unknown"}" bestFinalRelevance01=${bestRelevance.toFixed(3)} threshold=${minRelevance}`,
    );
    return best
      ? [{
          ...best,
          relevanceFallbackPreserved: true,
        }]
      : [];
  }

  return filtered;
}

function isCoreOutfitCategory(category: string | undefined): boolean {
  const normalized = String(category ?? "").trim().toLowerCase();
  return (
    normalized === "tops" ||
    normalized === "bottoms" ||
    normalized === "dresses" ||
    normalized === "footwear" ||
    normalized === "outerwear"
  );
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
    const allProducts = Array.isArray(row.products) ? row.products : [];
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
  // Prefer lexical evidence when present.
  if (/\bmini\b/.test(label)) return "mini";
  if (/\bmidi\b/.test(label)) return "midi";
  if (/\bmaxi\b/.test(label)) return "maxi";
  if (/\blong\b/.test(label)) return "long";

  // Fallback to bbox-based inference only for confident, sufficiently large dress detections.
  // This restores useful length intent for labels like "vest dress" without over-constraining tiny crops.
  const conf = Number(detection.confidence ?? 0);
  const area = Number((detection as any).area_ratio ?? 0);
  const box = (detection as any).box_normalized;
  if (
    conf >= 0.72 &&
    area >= 0.14 &&
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

function applyGroupedPostRanking(
  groupedResults: DetectionSimilarProducts[],
  includeCrossGroupDedupe: boolean,
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
        const deduped = row.products.filter((p) => {
          const id = String((p as any).id ?? "");
          if (!id || seen.has(id)) return false;
          // Keep first seen in ranked group order; dominant group wins ties.
          seen.add(id);
          return true;
        });
        if (rowIdx === 0) return { ...row, products: deduped, count: deduped.length };
        return { ...row, products: deduped, count: deduped.length };
      })
    : ranked;

  if (includeCrossGroupDedupe) {
    const globalSeen = new Set<string>();
    const globalRows = rows.map((row) => {
      const products = row.products.filter((p) => {
        const id = String((p as any).id ?? "");
        if (!id || globalSeen.has(id)) return false;
        globalSeen.add(id);
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
    for (;;) {
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
import {
  computeOutfitCoherence,
  type OutfitCoherenceResult,
  type DetectionWithColor,
} from "../../lib/detection/outfitCoherence";

// `sharp` is CommonJS callable. TS interop can cause `import sharp from "sharp"`
// to produce a non-callable object at runtime, so we guard it.
const sharp: any =
  typeof sharpLib === "function" ? sharpLib : (sharpLib as any).default;

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
}

function detectionColorKey(label: string, index?: number): string {
  const base = String(label || "item")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "item";
  return Number.isFinite(index as number) ? `${base}_${index}` : base;
}

function estimateCropColorConfidence(detection: Detection): number {
  const detConf = clamp01(Number(detection.confidence ?? 0));
  const area = Math.max(0, Number(detection.area_ratio ?? 0));
  const areaSignal = clamp01(Math.min(1, area / 0.2));
  // Crop color is strong when detection is confident and reasonably sized.
  return clamp01(0.35 + 0.45 * detConf + 0.2 * areaSignal);
}

function setDetectionColorIfHigherConfidence(
  colorByItem: Record<string, string | null>,
  confByItem: Record<string, number>,
  sourceByItem: Record<string, number>,
  key: string,
  color: string | null | undefined,
  confidence: number,
  sourcePriority: number,
): void {
  const c = String(color ?? "").toLowerCase().trim();
  if (!c) return;
  const nextConf = clamp01(confidence);
  const prevConf = clamp01(Number(confByItem[key] ?? 0));
  const nextPriority = Math.max(0, Math.floor(sourcePriority));
  const prevPriority = Math.max(0, Math.floor(Number(sourceByItem[key] ?? 0)));
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
    const validation = await validateImage(buffer);
    if (!validation.valid) {
      throw new Error(validation.error || "Invalid image");
    }

    // Check service availability
    const services = await this.getServiceStatus();

    // Get image metadata first
    const metadata = await sharp(buffer).metadata();
    const imageWidth = metadata.width || 0;
    const imageHeight = metadata.height || 0;
    const pHash = await computePHash(buffer);

    const deferClip =
      deferFullImageEmbedding &&
      generateEmbedding &&
      services.clip &&
      runDetection &&
      services.yolo;

    // Run operations in parallel where possible
    const [storageResult, embeddingResult, initialDetectionResult] = await Promise.all([
      // Storage
      store ? this.storeImage(buffer, filename, productId, isPrimary, pHash) : null,

      // Full-frame CLIP (skipped when deferClip — computed only if YOLO finds no instances)
      generateEmbedding && services.clip && !deferClip
        ? processImageForEmbedding(buffer).catch((err) => {
            console.error("CLIP embedding failed:", err);
            return null;
          })
        : Promise.resolve(null),

      // YOLO detection
      runDetection && services.yolo
        ? this.yoloClient
            .detectFromBuffer(buffer, filename, { confidence, preprocessing })
            .catch((err) => {
              if (isYoloCircuitOpenError(err)) {
                console.warn("[YOLOv8] circuit open, detection skipped:", err.message);
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
            })
        : Promise.resolve(null),
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
      const filteredDetections = detectionResult.detections.filter(shouldKeepDetectionForShopTheLook);
      if (filteredDetections.length !== detectionResult.detections.length) {
        detectionResult = {
          ...detectionResult,
          detections: filteredDetections,
          count: filteredDetections.length,
          summary: summarizeDetectionsByLabel(filteredDetections),
        };
      }

      // Ensure clients always receive `style` + `mask` (YOLO service returns them as null currently).
      detectionResult = {
        ...detectionResult,
        detections: detectionResult.detections.map((d) =>
          ensureStyleAndMask(d, imageWidth, imageHeight),
        ),
      };
    }

    let embeddingFinal = embeddingResult;
    if (deferClip && generateEmbedding && services.clip) {
      const hasDetections =
        detectionResult &&
        Array.isArray(detectionResult.detections) &&
        detectionResult.detections.length > 0;
      if (!hasDetections) {
        embeddingFinal = await processImageForEmbedding(buffer).catch((err) => {
          console.error("CLIP embedding failed (deferred full-frame):", err);
          return null;
        });
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

    // Persist detection results to DB when we have a stored product image
    try {
      const productImageId = storageResult && (storageResult as any).id ? (storageResult as any).id : 0;
      if (productImageId && detectionResult && Array.isArray(detectionResult.detections) && detectionResult.detections.length > 0) {
        for (const det of detectionResult.detections) {
          try {
            await pg.query(
              `INSERT INTO product_image_detections
               (product_image_id, product_id, label, raw_label, confidence, box, box_x1, box_y1, box_x2, box_y2, area_ratio, style)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
              [
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
                det.style ? JSON.stringify(det.style) : null,
              ]
            );
          } catch (rowErr) {
            console.error("Failed to persist detection row:", rowErr);
          }
        }
      }
    } catch (err) {
      console.error("Error persisting detections:", err);
    }

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
    const {
      findSimilar = true,
      similarityThreshold = config.clip.imageSimilarityThreshold,
      similarLimitPerItem = defaultShopLookResultBudget(),
      resultsPage,
      resultsPageSize,
      filterByDetectedCategory = true,
      groupByDetection = false,
      includeEmptyDetectionGroups = false,
      ...analyzeOptions
    } = options;
    const resolvedLimitPerItem = resolveShopLookLimit(similarLimitPerItem);
    const resolvedResultsPage = resolveShopLookPage(resultsPage);
    const resolvedResultsPageSize = resolveShopLookPageSize(resultsPageSize, resolvedLimitPerItem);
    const retrievalLimit = resolveShopLookLimit(
      Math.max(resolvedLimitPerItem, resolvedResultsPage * resolvedResultsPageSize) *
        shopLookRecallMultiplier(),
    );

    // Get image dimensions first
    const metadata = await sharp(buffer).metadata();
    const imageWidth = metadata.width || 0;
    const imageHeight = metadata.height || 0;

    // First, run the standard analysis
    const analysisResult = await this.analyzeImage(buffer, filename, {
      ...analyzeOptions,
      generateEmbedding: true, // Force embedding for similarity search
      deferFullImageEmbedding: findSimilar,
    });
    const sourceImagePHash = await computePHash(buffer).catch(() => undefined);

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
      };
    }

    // No YOLO detections — fall back to a whole-image embedding search
    if (!analysisResult.detection || analysisResult.detection.items.length === 0) {
      const fallbackDetection = syntheticFullImageDetectionBlock(imageWidth, imageHeight);
      const fallbackDetectedCategories = [...new Set(fallbackDetection.items.map((item) => item.label))];
      const { buffer: fullProcessBuf } = await prepareBufferForImageSearchQuery(buffer);
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
      const fallback = await searchByImageWithSimilarity({
        imageEmbedding: fallbackEmbedding,
        imageBuffer: fullProcessBuf,
        filters: {},
        limit: retrievalLimit,
        similarityThreshold,
        includeRelated: false,
        knnField: "embedding",
        relaxThresholdWhenEmpty: shopLookRelaxEnv(),
        sessionId: options.sessionId,
        userId: options.userId,
        sessionFilters: options.sessionFilters ?? undefined,
      });
      const fallbackRows: DetectionSimilarProducts[] = fallback.results.length > 0 ? [{
        detection: { label: "full_image", confidence: 1.0, box: { x1: 0, y1: 0, x2: imageWidth, y2: imageHeight }, area_ratio: 1.0 },
        category: "all",
        products: fallback.results,
        count: fallback.results.length,
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
    if (!inferredAudience.gender && !inferredAudience.ageGroup) {
      const fallbackAudience = inferApparelAudienceFallback({
        caption: blipCaption,
        detections: analysisResult.detection.items,
      });
      if (fallbackAudience.ageGroup) {
        inferredAudience = {
          ...inferredAudience,
          ageGroup: fallbackAudience.ageGroup,
        };
      }
    }

    const captionColors = blipCaption ? inferColorFromCaption(blipCaption) : {};
    const inferredColorsByItem: Record<string, string | null> = {};
    const inferredColorsByItemConfidence: Record<string, number> = {};
    const inferredColorsByItemSource: Record<string, number> = {};
    // Prefer BLIP caption color when explicit (e.g. "white dress") — full-image dominant can pick up sky/background.
    const captionPrimaryColor = resolveCaptionPrimaryColor(blipCaption ?? "", captionColors, blipStructured);
    const allowDominantFallback = shouldUseDominantColorFallback(captionColors, blipStructured);
    const allowFullImageDominantFallback =
      allowDominantFallback &&
      analysisResult.detection.items.length <= 1;
    const inferredPrimaryColor =
      captionPrimaryColor ??
      (allowFullImageDominantFallback && imageInferDominantColorEnv() && analysisResult.services?.blip
        ? await extractDominantColorNames(buffer, { maxColors: 2, minShare: 0.12 })
            .then((c) => c[0] ?? null)
            .catch(() => null)
        : null);

    const detectionJobs: Array<{ detection: Detection; detectionIndex?: number }> =
      groupByDetection
        ? analysisResult.detection.items.map((detection, index) => ({
            detection,
            detectionIndex: index,
          }))
        : dedupeDetectionsBySameLabelIou(
            analysisResult.detection.items,
            yoloShopDedupeIouThreshold(),
          ).map(({ detection, originalIndex }) => ({
            detection,
            detectionIndex: originalIndex,
          }));

    // Per-detection work is concurrency-limited to avoid OpenSearch kNN pile-ups; CLIP still serializes in-process.
    const settled = await mapPoolSettled(
      detectionJobs,
      shopLookPerDetectionConcurrency(),
      async ({ detection, detectionIndex }) => {
      const label = detection.label;
      console.log(`[detection-trace] started label="${label}" conf=${(detection.confidence ?? 0).toFixed(3)} area=${(detection.area_ratio ?? 0).toFixed(3)}`);
      
      let clipBuffer: Buffer;
      let finalEmbedding: number[];
      let queryProcessBuf: Buffer;
      try {
        const aligned = await computeShopTheLookGarmentEmbeddingFromDetection(buffer, detection.box);
        finalEmbedding = aligned.embedding;
        clipBuffer = aligned.clipBufferForAttributes;
        queryProcessBuf = aligned.processBuf;
      } catch {
        return null;
      }
      const finalGarmentEmbedding = finalEmbedding;

      const categoryMapping = mapDetectionToCategory(label, detection.confidence, {
        box_normalized: (detection as any).box_normalized,
      });
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
      const typeSeedSource =
        categoryMapping.productCategory === "tops" &&
          categoryMapping.attributes.sleeveLength === "short"
          ? "tshirt tee"
          : label;
      let typeSeeds = extractLexicalProductTypeSeeds(typeSeedSource);
      if (blipStructuredConfidence >= imageBlipSoftHintConfidenceMin()) {
        typeSeeds = [...new Set([...typeSeeds, ...blipStructured.productTypeHints])];
      }
      typeSeeds = filterProductTypeSeedsByMappedCategory(typeSeeds, categoryMapping.productCategory);
      typeSeeds = tightenTypeSeedsForDetection(label, categoryMapping, typeSeeds);
      const strongTypeSeeds = recoverFormalOuterwearTypes(
        typeSeeds,
        categoryMapping.productCategory,
        label,
        blipCaption ?? "",
      );
      let softProductTypeHints = recoverFormalOuterwearTypes(
        [...new Set([...strongTypeSeeds, ...expandedTypeHints.slice(0, 8)])],
        categoryMapping.productCategory,
        label,
        blipCaption ?? "",
      );
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

      // Preserve category-slot color from full-image caption (e.g. "blue jeans")
      // as a high-priority semantic fallback for this detection.
      const fullCaptionSlotColor = captionColorForProductCategory(
        categoryMapping.productCategory,
        captionColors,
      );
      if (fullCaptionSlotColor && blipStructuredConfidence >= imageBlipSoftHintConfidenceMin()) {
        const slotColorConfidence = Math.max(0.62, Math.min(0.9, blipStructuredConfidence));
        setDetectionColorIfHigherConfidence(
          inferredColorsByItem,
          inferredColorsByItemConfidence,
          inferredColorsByItemSource,
          itemColorKey,
          fullCaptionSlotColor,
          slotColorConfidence,
          3,
        );
      }

      // "Closet similar" constraints: always enforce inferred audience gender when available.
      // Confidence gating here causes frequent cross-gender leakage (e.g. men query returning women items).
      if (inferredAudience.gender) {
        filters.gender = inferredAudience.gender;
      }
      if (inferredAudience.ageGroup && blipStructuredConfidence >= imageBlipSoftHintConfidenceStrong()) {
        filters.ageGroup = inferredAudience.ageGroup;
      }

      const inferredStyle = inferStyleForDetectionLabel(label);
      const useBlipSoftHints = blipStructuredConfidence >= imageBlipSoftHintConfidenceMin();
      const useStrongBlipSoftHints = blipStructuredConfidence >= imageBlipSoftHintConfidenceStrong();
      // Apply style intent whenever we have an inference token; the ranking layer
      // will score it softly (so we avoid going fully empty).
      if (useStrongBlipSoftHints && blipStructured.style.attrStyle) {
        filters.softStyle = blipStructured.style.attrStyle;
      } else if (inferredStyle.attrStyle && shouldApplyInferredStyleFallback(categoryMapping.productCategory, label)) {
        filters.softStyle = inferredStyle.attrStyle;
      }

      // Extract formality intent from BLIP caption: if formal wear is detected (suit, tie, tuxedo),
      // override softStyle to "formal" to ensure proper product ranking (no casual sport coats, blazers).
      const blipFormalityScore = blipCaption ? inferFormalityFromCaption(blipCaption) : 0;
      if (blipCaption && blipFormalityScore > 0) {
        console.log(`[formality-intent] caption="${blipCaption.substring(0, 60)}..." score=${blipFormalityScore}`);
      }
      if (blipFormalityScore >= 8) {
        filters.softStyle = "formal"; // Override previous style inference with formal
        (filters as any).minFormality = 8; // Hard filter: only rank products with formality >= 8
        console.log(`[formality-intent][APPLIED] enforcing formal-wear-only for detection="${label}"`);
      }

      if (categoryMapping.attributes.sleeveLength) {
        filters.sleeve = categoryMapping.attributes.sleeveLength;
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
          detectionLabel: label,
        });
        if (cropColors.length > 0) {
          (filters as any).cropDominantColors = cropColors;
          setDetectionColorIfHigherConfidence(
            inferredColorsByItem,
            inferredColorsByItemConfidence,
            inferredColorsByItemSource,
            itemColorKey,
            cropColors[0],
            estimateCropColorConfidence(detection),
            1,
          );
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
      const detectionMeetsAutoHardHeuristics =
        !noisyCat && (baseHardAuto || relaxedGarmentHardAuto);
      const accessoryLikeCategory = isAccessoryLikeCategory(categoryMapping.productCategory);
      const shouldHardCategory =
        filterByDetectedCategory &&
        (
          accessoryLikeCategory ||
          shopLookHardCategoryStrictEnv() ||
          detectionMeetsAutoHardHeuristics ||
          shouldForceHardCategoryForDetection(detection, categoryMapping)
        );
      const forceHardCategoryFilterUsed = Boolean(shouldHardCategory);
      if (filterByDetectedCategory) {
        if (shouldHardCategory) {
          // Apply hard OpenSearch category filtering, even when global soft-category is enabled.
          const terms = hardCategoryTermsForDetection(label, categoryMapping);
          filters.category = terms.length === 1 ? terms[0] : terms;
        } else if (imageSoftCategoryEnv() || shopLookSoftCategoryEnv()) {
          const typeHints = Array.isArray(filters.productTypes) ? filters.productTypes : [];
          predictedCategoryAisles = typeHints.length
            ? typeHints
            : softProductTypeHints.length
              ? softProductTypeHints
            : expandedTypeHints.length
              ? expandedTypeHints
              : searchCategories;
        } else {
          filters.category =
            searchCategories.length === 1 ? searchCategories[0] : searchCategories;
        }
      }

      const knnFieldUsed = shopTheLookKnnField();

      // Per-detection BLIP captioning + CLIP consistency gate.
      const detCaption = analysisResult.services?.blip ? await getCachedCaption(clipBuffer, "det") : "";
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
        const detCaptionColor =
          captionColorForProductCategory(categoryMapping.productCategory, detCaptionColors) ??
          detCaptionColors.garmentColor ??
          detCaptionColors.topColor ??
          detCaptionColors.jeansColor ??
          null;
        const detStruct = buildStructuredBlipOutput(detCaption);
        const consistency = await clipCaptionConsistency01(finalEmbedding, detCaption);
        const detConfidence = combineConfidenceFromConsistency(detStruct.confidence, consistency);
        setDetectionColorIfHigherConfidence(
          inferredColorsByItem,
          inferredColorsByItemConfidence,
          inferredColorsByItemSource,
          itemColorKey,
          detCaptionColor,
          detConfidence,
          2,
        );
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
            const mergedTypes = [...new Set([...softProductTypeHints, ...detStruct.productTypeHints])];
          const filteredTypes = filterProductTypeSeedsByMappedCategory(
            mergedTypes,
            categoryMapping.productCategory,
          ).slice(0, 10);
            softProductTypeHints = tightenTypeSeedsForDetection(label, categoryMapping, filteredTypes);
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

      const strictAudienceLock =
        Boolean(inferredAudience.gender) &&
        blipStructuredConfidence >= imageBlipSoftHintConfidenceStrong() &&
        detectionCaptionAcceptedForLock;

      let similarResult = await searchByImageWithSimilarity({
        imageEmbedding: finalEmbedding,
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
        limit: retrievalLimit,
        similarityThreshold,
        includeRelated: false,
        predictedCategoryAisles,
        knnField: knnFieldUsed,
        forceHardCategoryFilter: forceHardCategoryFilterUsed,
        relaxThresholdWhenEmpty: shopLookRelaxEnv(),
        blipSignal: detectionBlipSignal,
        inferredPrimaryColor,
        inferredColorsByItem,
        inferredColorsByItemConfidence,
        debugRawCosineFirst: shopLookDebugRawCosineFirstEnv(),
        sessionId: options.sessionId,
        userId: options.userId,
        sessionFilters: options.sessionFilters ?? undefined,
      });

      // If BLIP-derived audience/style filters are too strict and remove all hits,
      // retry once without those attribute filters (but keep category/productTypes).
      if (
        similarResult.results.length === 0 &&
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
          softProductTypeHints: softProductTypeHints.length > 0 ? softProductTypeHints : undefined,
          limit: retrievalLimit,
          similarityThreshold,
          includeRelated: false,
          predictedCategoryAisles,
          knnField: knnFieldUsed,
          forceHardCategoryFilter: forceHardCategoryFilterUsed,
          relaxThresholdWhenEmpty: shopLookRelaxEnv(),
          blipSignal: detectionBlipSignal,
          inferredPrimaryColor,
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
          softProductTypeHints: softProductTypeHints.length > 0 ? softProductTypeHints : undefined,
          limit: retrievalLimit,
          similarityThreshold,
          includeRelated: false,
          predictedCategoryAisles,
          knnField: knnFieldUsed,
          forceHardCategoryFilter: forceHardCategoryFilterUsed,
          relaxThresholdWhenEmpty: shopLookRelaxEnv(),
          blipSignal: detectionBlipSignal,
          inferredPrimaryColor,
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
        !isAccessoryLikeCategory(categoryMapping.productCategory) &&
        !(categoryMapping.productCategory === "accessories" && isHeadwearLabel(label)) &&
        (filters as { category?: string | string[] }).category
      ) {
        const { category: _omitCategory, ...filtersSansCategory } = filters as {
          category?: string | string[];
          productTypes?: string[];
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
          filters: filtersSansCategory,
          limit: retrievalLimit,
          similarityThreshold,
          includeRelated: false,
          predictedCategoryAisles,
          knnField: shopTheLookKnnField(),
          forceHardCategoryFilter: false,
          relaxThresholdWhenEmpty: shopLookRelaxEnv(),
          blipSignal: detectionBlipSignal,
          inferredPrimaryColor,
          inferredColorsByItem,
          inferredColorsByItemConfidence,
          debugRawCosineFirst: shopLookDebugRawCosineFirstEnv(),
          sessionId: options.sessionId,
          userId: options.userId,
          sessionFilters: options.sessionFilters ?? undefined,
        });
        if (similarResult.results.length === 0) {
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
            filters: {
              length: (filters as any).length,
            } as any,
            softProductTypeHints: softProductTypeHints.length > 0 ? softProductTypeHints : undefined,
            limit: retrievalLimit,
            similarityThreshold,
            includeRelated: false,
            knnField: shopTheLookKnnField(),
            forceHardCategoryFilter: false,
            relaxThresholdWhenEmpty: shopLookRelaxEnv(),
            blipSignal: detectionBlipSignal,
            inferredPrimaryColor,
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
        for (const alt of altVectors) {
          const altResult = await searchByImageWithSimilarity({
            imageEmbedding: alt,
            imageEmbeddingGarment: alt,
            imageBuffer: queryProcessBuf,
            pHash: sourceImagePHash,
            detectionYoloConfidence: detection.confidence,
            detectionProductCategory: categoryMapping.productCategory,
            filters,
            softProductTypeHints: softProductTypeHints.length > 0 ? softProductTypeHints : undefined,
            limit: retrievalLimit,
            similarityThreshold,
            includeRelated: false,
            predictedCategoryAisles,
            knnField: knnFieldUsed,
            forceHardCategoryFilter: forceHardCategoryFilterUsed,
            relaxThresholdWhenEmpty: shopLookRelaxEnv(),
            blipSignal: detectionBlipSignal,
            inferredPrimaryColor,
            inferredColorsByItem,
            inferredColorsByItemConfidence,
            debugRawCosineFirst: shopLookDebugRawCosineFirstEnv(),
            sessionId: options.sessionId,
            userId: options.userId,
            sessionFilters: options.sessionFilters ?? undefined,
          });
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

      console.log(`[skip-trace] detection="${label}" after_knn_search=${similarResult.results.length}`);

      const precisionSafeResults = applyShopLookVisualPrecisionGuard(
        similarResult.results,
        categoryMapping.productCategory === "footwear" && (detection.area_ratio ?? 0) <= 0.02
          ? shopLookTinyFootwearRecoveryThreshold(similarityThreshold)
          : similarityThreshold,
      );
      
      console.log(`[skip-trace] detection="${label}" after_precision_guard=${precisionSafeResults.length} (filtered_by=${similarResult.results.length - precisionSafeResults.length})`);

      const categorySafeResults = applyDetectionCategoryGuard(
        precisionSafeResults,
        detection.label,
        categoryMapping,
      );
      
      console.log(`[skip-trace] detection="${label}" after_category_guard=${categorySafeResults.length} (filtered_by=${precisionSafeResults.length - categorySafeResults.length})`);
      
      // Apply formality filter if formal wear was detected from BLIP caption
      const minFormality = (filters as any).minFormality;
      if (minFormality) {
        console.log(`[formality-apply-main] detection="${detection.label}" minFormality=${minFormality} incoming=${categorySafeResults.length}`);
      }
      const formalitySafeResults = applyFormalityFilter(categorySafeResults, minFormality);

      const athleticSafeResults = applyAthleticMismatchGuard({
        products: formalitySafeResults,
        detectionLabel: label,
        productCategory: categoryMapping.productCategory,
        softStyle: String((filters as any).softStyle ?? ""),
        minFormality,
      });
      
      console.log(`[skip-trace] detection="${label}" after_formality_filter=${formalitySafeResults.length} (filtered_by=${categorySafeResults.length - formalitySafeResults.length})`);
      console.log(`[skip-trace] detection="${label}" after_athletic_guard=${athleticSafeResults.length} (filtered_by=${formalitySafeResults.length - athleticSafeResults.length})`);
      
      if (athleticSafeResults.length === 0) {
        console.log(`[skip-trace-WARN] detection="${label}" ZERO_RESULTS filters={category:"${filters.category}", productTypes:[${filters.productTypes?.join(",")}], softStyle:"${filters.softStyle}", minFormality:${minFormality}}`);
      }
      
      similarResult = {
        ...similarResult,
        results: athleticSafeResults,
      };

      // Tiny footwear boxes often produce weak crop embeddings. If footwear search is empty,
      // retry once with a broader query embedding while keeping strict footwear category terms.
      if (
        similarResult.results.length === 0 &&
        categoryMapping.productCategory === "footwear" &&
        (detection.area_ratio ?? 0) <= 0.02
      ) {
        console.log(`[recovery-attempt] detection="${label}" type=footwear_tiny reason="empty + tiny area"`);
        const footwearTerms = hardCategoryTermsForDetection(label, categoryMapping);
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

        for (const recoveryVector of recoveryVectors) {
          const footwearRecovery = await searchByImageWithSimilarity({
            imageEmbedding: recoveryVector,
            imageBuffer: queryProcessBuf,
            pHash: sourceImagePHash,
            detectionYoloConfidence: detection.confidence,
            detectionProductCategory: categoryMapping.productCategory,
            filters: footwearFilters,
            limit: retrievalLimit,
            similarityThreshold: shopLookTinyFootwearRecoveryThreshold(similarityThreshold),
            includeRelated: false,
            knnField: "embedding",
            forceHardCategoryFilter: true,
            relaxThresholdWhenEmpty: true,
            blipSignal: detectionBlipSignal,
            inferredPrimaryColor,
            inferredColorsByItem,
            inferredColorsByItemConfidence,
            debugRawCosineFirst: shopLookDebugRawCosineFirstEnv(),
            sessionId: options.sessionId,
            userId: options.userId,
            sessionFilters: options.sessionFilters ?? undefined,
          });

          if (footwearRecovery.results.length > 0) {
            console.log(`[recovery-result] detection="${label}" type=footwear_tiny recovered=${footwearRecovery.results.length} products`);
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

      if (
        similarResult.results.length === 0 &&
        categoryMapping.productCategory === "tops" &&
        (detection.confidence ?? 0) >= 0.82 &&
        (detection.area_ratio ?? 0) >= 0.08
      ) {
        console.log(`[recovery-attempt] detection="${label}" type=tops_recovery reason="empty + high conf + sufficient area"`);
        const topTerms = hardCategoryTermsForDetection(label, categoryMapping);
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

        for (const recoveryVector of recoveryVectors) {
          const topRecovery = await searchByImageWithSimilarity({
            imageEmbedding: recoveryVector,
            imageBuffer: queryProcessBuf,
            pHash: sourceImagePHash,
            detectionYoloConfidence: detection.confidence,
            detectionProductCategory: categoryMapping.productCategory,
            filters: topFilters,
            limit: retrievalLimit,
            similarityThreshold: shopLookTopRecoverySimilarityThreshold(similarityThreshold),
            includeRelated: false,
            knnField: "embedding",
            forceHardCategoryFilter: true,
            relaxThresholdWhenEmpty: true,
            blipSignal: detectionBlipSignal,
            inferredPrimaryColor,
            inferredColorsByItem,
            inferredColorsByItemConfidence,
            debugRawCosineFirst: shopLookDebugRawCosineFirstEnv(),
            sessionId: options.sessionId,
            userId: options.userId,
            sessionFilters: options.sessionFilters ?? undefined,
          });

          if (topRecovery.results.length > 0) {
            console.log(`[recovery-result] detection="${label}" type=tops_recovery recovered=${topRecovery.results.length} products`);
            similarResult = {
              ...similarResult,
              results: mergeImageSearchResultsById(
                similarResult.results,
                topRecovery.results,
                retrievalLimit,
              ),
            };
          }

          if (similarResult.results.length >= Math.max(2, Math.floor(resolvedLimitPerItem * 0.2))) {
            break;
          }
        }
      }

      if (similarResult.results.length === 0 && !includeEmptyDetectionGroups) {
        console.log(`[detection-skip] label="${label}" reason="empty_and_includeEmpty=false"`);
        return null;
      }

      console.log(`[detection-result] label="${label}" final_count=${similarResult.results.length}`);
      
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
          productTypes: filters.productTypes,
          gender: filters.gender,
          ageGroup: filters.ageGroup,
          softStyle: filters.softStyle,
          length: (filters as any).length,
        },
      } as DetectionSimilarProducts;
    },
    );

    const groupedResults: DetectionSimilarProducts[] = [];
    let totalProducts = 0;

    for (const outcome of settled) {
      if (outcome.status === "fulfilled" && outcome.value) {
        groupedResults.push(outcome.value);
        totalProducts += outcome.value.count;
      } else if (outcome.status === "rejected") {
        console.error("Failed to find similar products for a detection:", outcome.reason);
      }
    }

    const postRanked = applyGroupedPostRanking(groupedResults, imageCrossGroupDedupeEnabled());
    const finalGroupedResults = postRanked.rows;
    
    // Apply minimum relevance threshold filter to each detection's products
    const minRelevanceThreshold = shopLookMinFinalRelevanceThreshold();
    console.log(`[relevance-gate] applying minRelevance=${minRelevanceThreshold} to filter low-relevance products`);
    
    const relevanceFilteredResults = finalGroupedResults.map((detection) => ({
      ...detection,
      products: applyRelevanceThresholdFilter(detection.products, minRelevanceThreshold, {
        preserveAtLeastOne: isCoreOutfitCategory(detection.category),
        detectionLabel: detection.detection?.label,
        category: detection.category,
      }),
      count: 0, // Will be recalculated below
    }));
    
    // Recalculate counts and total after filtering
    let newTotalProducts = 0;
    for (const result of relevanceFilteredResults) {
      result.count = result.products.length;
      newTotalProducts += result.count;
    }
    
    console.log(
      `[relevance-gate] total products before=${totalProducts} → after=${newTotalProducts} (threshold=${minRelevanceThreshold})`,
    );
    
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

    const itemsForCoherence = relevanceFilteredResults
      .filter((r) => r.count > 0 && r.detectionIndex !== undefined)
      .map(
        (r) =>
          analysisResult.detection!.items[r.detectionIndex!] as DetectionWithColor,
      );

    const outfitCoherence =
      itemsForCoherence.length > 0
        ? computeOutfitCoherence(itemsForCoherence)
        : undefined;

    if (process.env.NODE_ENV !== "production" || String(process.env.SEARCH_DEBUG ?? "") === "1") {
      console.info("[image-search][blip-enrichment]", {
        stage: "analyzeAndFindSimilar",
        fullStructuredConfidence: Math.round(blipStructuredConfidence * 1000) / 1000,
        ...obs,
      });
    }

    return {
      ...analysisResult,
      blipCaption,
      inferredAudience,
      inferredPrimaryColor,
      inferredColorsByItem,
      inferredColorsByItemConfidence,
      similarProducts: {
        byDetection: relevanceFilteredResults,
        totalProducts: newTotalProducts,
        threshold: similarityThreshold,
        detectedCategories,
        shopTheLookStats: {
          totalDetections: totalDetectionJobs,
          coveredDetections,
          emptyDetections,
          coverageRatio,
        },
      },
      outfitCoherence,
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
    const retrievalLimit = resolveShopLookLimit(
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
    if (!inferredAudience.gender && !inferredAudience.ageGroup) {
      const fallbackAudience = inferApparelAudienceFallback({
        caption: blipCaption,
        detections: fullResult.detection.items,
      });
      if (fallbackAudience.ageGroup) {
        inferredAudience = {
          ...inferredAudience,
          ageGroup: fallbackAudience.ageGroup,
        };
      }
    }

    const captionColors = blipCaption ? inferColorFromCaption(blipCaption) : {};
    const inferredColorsByItem: Record<string, string | null> = {};
    const inferredColorsByItemConfidence: Record<string, number> = {};
    const inferredColorsByItemSource: Record<string, number> = {};
    const captionPrimaryColor = resolveCaptionPrimaryColor(blipCaption ?? "", captionColors, blipStructured);
    const allowDominantFallback = shouldUseDominantColorFallback(captionColors, blipStructured);
    const allowFullImageDominantFallback =
      allowDominantFallback &&
      allItemsToProcess.length <= 1;
    const inferredPrimaryColor =
      captionPrimaryColor ??
      (allowFullImageDominantFallback && imageInferDominantColorEnv() && fullResult.services?.blip
        ? await extractDominantColorNames(buffer, { maxColors: 2, minShare: 0.12 })
            .then((c) => c[0] ?? null)
            .catch(() => null)
        : null);
    // Avoid TS "never" narrowing when caption inference is type-proved unreachable.
    const captionWantsJeans = blipStructured.productTypeHints.includes("jeans");

    for (let i = 0; i < allItemsToProcess.length; i++) {
      const detection = allItemsToProcess[i];
      const isUserDefined = i >= itemsToProcess.length;

      try {
        let clipBuffer: Buffer;
        let finalEmbedding: number[];
        let queryProcessBuf: Buffer;
        try {
          const aligned = await computeShopTheLookGarmentEmbeddingFromDetection(buffer, detection.box);
          finalEmbedding = aligned.embedding;
          clipBuffer = aligned.clipBufferForAttributes;
          queryProcessBuf = aligned.processBuf;
        } catch {
          continue;
        }
        const finalGarmentEmbedding = finalEmbedding;

        // Get category from user hint or detection
        const categorySource =
          isUserDefined && userDefinedBoxes[i - itemsToProcess.length].categoryHint
            ? userDefinedBoxes[i - itemsToProcess.length].categoryHint!
            : detection.label;
        const categoryMapping = mapDetectionToCategory(categorySource, detection.confidence, {
          box_normalized: (detection as any).box_normalized,
        });
        const itemColorKey = detectionColorKey(categorySource, i);
        if (!(itemColorKey in inferredColorsByItem)) inferredColorsByItem[itemColorKey] = null;
        if (!(itemColorKey in inferredColorsByItemConfidence)) inferredColorsByItemConfidence[itemColorKey] = 0;
        if (!(itemColorKey in inferredColorsByItemSource)) inferredColorsByItemSource[itemColorKey] = 0;

        // Preserve category-slot color from full-image caption (e.g. "blue jeans")
        // as a high-priority semantic fallback for this detection.
        const fullCaptionSlotColor = captionColorForProductCategory(
          categoryMapping.productCategory,
          captionColors,
        );
        if (fullCaptionSlotColor && blipStructuredConfidence >= imageBlipSoftHintConfidenceMin()) {
          const slotColorConfidence = Math.max(0.62, Math.min(0.9, blipStructuredConfidence));
          setDetectionColorIfHigherConfidence(
            inferredColorsByItem,
            inferredColorsByItemConfidence,
            inferredColorsByItemSource,
            itemColorKey,
            fullCaptionSlotColor,
            slotColorConfidence,
            3,
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
        browseTypeSeeds = tightenTypeSeedsForDetection(categorySource, categoryMapping, browseTypeSeeds);
        browseTypeSeeds = recoverFormalOuterwearTypes(
          browseTypeSeeds,
          categoryMapping.productCategory,
          categorySource,
          blipCaption ?? "",
        );
        if (shouldForceTypeFilterForDetection(detection, categoryMapping, browseTypeSeeds)) {
          filters.productTypes = browseTypeSeeds.slice(0, 10);
        }
        let softProductTypeHints = browseTypeSeeds.length > 0 ? browseTypeSeeds : undefined;

        // "Closet similar" constraints: enforce audience gender + add optional style/color.
        if (inferredAudience.gender) {
          filters.gender = inferredAudience.gender;
        }
        if (inferredAudience.ageGroup && blipStructuredConfidence >= imageBlipSoftHintConfidenceStrong()) {
          filters.ageGroup = inferredAudience.ageGroup;
        }

        const inferredStyle = inferStyleForDetectionLabel(categorySource);
        const useBlipSoftHints = blipStructuredConfidence >= imageBlipSoftHintConfidenceMin();
        const useStrongBlipSoftHints = blipStructuredConfidence >= imageBlipSoftHintConfidenceStrong();
        if (useStrongBlipSoftHints && blipStructured.style.attrStyle) {
          filters.softStyle = blipStructured.style.attrStyle;
        } else if (
          inferredStyle.attrStyle &&
          shouldApplyInferredStyleFallback(categoryMapping.productCategory, categorySource)
        ) {
          filters.softStyle = inferredStyle.attrStyle;
        }

        // Extract formality intent from BLIP caption: if formal wear is detected (suit, tie, tuxedo),
        // override softStyle to "formal" to ensure proper product ranking (no casual sport coats, blazers).
        const blipFormalityScore = blipCaption ? inferFormalityFromCaption(blipCaption) : 0;
        if (blipCaption && blipFormalityScore > 0) {
          console.log(`[formality-intent-alt] caption="${blipCaption.substring(0, 60)}..." score=${blipFormalityScore}`);
        }
        if (blipFormalityScore >= 8) {
          filters.softStyle = "formal"; // Override previous style inference with formal
          (filters as any).minFormality = 8; // Hard filter: only rank products with formality >= 8
          console.log(`[formality-intent-alt][APPLIED] enforcing formal-wear-only for detection="${categorySource}"`);
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
            setDetectionColorIfHigherConfidence(
              inferredColorsByItem,
              inferredColorsByItemConfidence,
              inferredColorsByItemSource,
              itemColorKey,
              cropColors[0],
              estimateCropColorConfidence(detection),
              1,
            );
          }
        } catch { /* non-critical: color embedding channel still works */ }
        let predictedCategoryAisles: string[] | undefined;
        const accessoryLikeCategory = isAccessoryLikeCategory(categoryMapping.productCategory);
        if (options.filterByDetectedCategory !== false) {
          const softCategories = shouldUseAlternatives(categoryMapping)
            ? getSearchCategories(categoryMapping)
            : [categoryMapping.productCategory];
          const expandedTypeHints = expandPredictedTypeHints([
            categorySource,
            ...softCategories,
            ...browseTypeSeeds,
          ]);
          const shouldHardCategory = accessoryLikeCategory || !(imageSoftCategoryEnv() || shopLookSoftCategoryEnv());
          if (!shouldHardCategory) {
            predictedCategoryAisles =
              browseTypeSeeds.length > 0
                ? browseTypeSeeds
                : expandedTypeHints.length > 0
                  ? expandedTypeHints
                  : softCategories;
          } else {
            const terms = hardCategoryTermsForDetection(categorySource, categoryMapping);
            filters.category = terms.length === 1 ? terms[0] : terms;
          }
        }
        const forceHardCategoryFilterUsed =
          options.filterByDetectedCategory !== false &&
          (filters as { category?: string | string[] }).category != null;

        const detCaption = fullResult.services?.blip ? await getCachedCaption(clipBuffer, "det") : "";
        let detectionBlipSignal: BlipSignal | undefined;
        let detectionCaptionAcceptedForLock = false;
        if (detCaption.trim().length > 0) {
          const captionLength = inferLengthIntentFromCaption(detCaption);
          if (captionLength) (filters as any).length = captionLength;
        }
        if (detCaption.trim().length > 0) {
          obs.detectionCaptionHits += 1;
          const detCaptionColors = inferColorFromCaption(detCaption);
          const detCaptionColor =
            captionColorForProductCategory(categoryMapping.productCategory, detCaptionColors) ??
            detCaptionColors.garmentColor ??
            detCaptionColors.topColor ??
            detCaptionColors.jeansColor ??
            null;
          const detStruct = buildStructuredBlipOutput(detCaption);
          const consistency = await clipCaptionConsistency01(finalEmbedding, detCaption);
          const detConfidence = combineConfidenceFromConsistency(detStruct.confidence, consistency);
          setDetectionColorIfHigherConfidence(
            inferredColorsByItem,
            inferredColorsByItemConfidence,
            inferredColorsByItemSource,
            itemColorKey,
            detCaptionColor,
            detConfidence,
            2,
          );
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
            const mergedTypes = [...new Set([...(softProductTypeHints ?? []), ...detStruct.productTypeHints])];
            const filteredTypes = filterProductTypeSeedsByMappedCategory(
              mergedTypes,
              categoryMapping.productCategory,
            ).slice(0, 10);
            softProductTypeHints = tightenTypeSeedsForDetection(
              categorySource,
              categoryMapping,
              filteredTypes,
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

        let similarResult = await searchByImageWithSimilarity({
          imageEmbedding: finalEmbedding,
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
          limit: retrievalLimit,
          similarityThreshold: options.similarityThreshold ?? config.clip.imageSimilarityThreshold,
          includeRelated: false,
          predictedCategoryAisles,
          knnField: shopTheLookKnnField(),
          forceHardCategoryFilter: forceHardCategoryFilterUsed,
          relaxThresholdWhenEmpty: shopLookRelaxEnv(),
          blipSignal: detectionBlipSignal,
          inferredPrimaryColor,
          inferredColorsByItem,
          inferredColorsByItemConfidence,
          debugRawCosineFirst: shopLookDebugRawCosineFirstEnv(),
          sessionId: options.sessionId,
          userId: options.userId,
          sessionFilters: options.sessionFilters ?? undefined,
        });

        // Retry without inferred attribute filters if they removed all hits.
        if (
          similarResult.results.length === 0 &&
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
            limit: retrievalLimit,
            similarityThreshold: options.similarityThreshold ?? config.clip.imageSimilarityThreshold,
            includeRelated: false,
            predictedCategoryAisles,
            knnField: shopTheLookKnnField(),
            forceHardCategoryFilter: forceHardCategoryFilterUsed,
            relaxThresholdWhenEmpty: shopLookRelaxEnv(),
            blipSignal: detectionBlipSignal,
            inferredPrimaryColor,
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
          !accessoryLikeCategory &&
          !imageSoftCategoryEnv() &&
          !(categoryMapping.productCategory === "accessories" && isHeadwearLabel(categorySource)) &&
          (filters as { category?: string | string[] }).category
        ) {
          const { category: _omitCategory, ...filtersSansCategory } = filters as {
            category?: string | string[];
            productTypes?: string[];
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
            filters: filtersSansCategory,
            softProductTypeHints,
            limit: retrievalLimit,
            similarityThreshold: options.similarityThreshold ?? config.clip.imageSimilarityThreshold,
            includeRelated: false,
            predictedCategoryAisles,
            knnField: shopTheLookKnnField(),
            relaxThresholdWhenEmpty: shopLookRelaxEnv(),
            blipSignal: detectionBlipSignal,
            inferredPrimaryColor,
            inferredColorsByItem,
            inferredColorsByItemConfidence,
            debugRawCosineFirst: shopLookDebugRawCosineFirstEnv(),
            sessionId: options.sessionId,
            userId: options.userId,
            sessionFilters: options.sessionFilters ?? undefined,
          });
          if (similarResult.results.length === 0) {
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
              filters: {
                length: (filters as any).length,
              } as any,
              limit: retrievalLimit,
              similarityThreshold: options.similarityThreshold ?? config.clip.imageSimilarityThreshold,
              includeRelated: false,
              knnField: shopTheLookKnnField(),
              relaxThresholdWhenEmpty: shopLookRelaxEnv(),
              blipSignal: detectionBlipSignal,
              inferredPrimaryColor,
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
            similarityThreshold: options.similarityThreshold ?? config.clip.imageSimilarityThreshold,
            includeRelated: false,
            predictedCategoryAisles,
            knnField: shopTheLookKnnField(),
            forceHardCategoryFilter: forceHardCategoryFilterUsed,
            relaxThresholdWhenEmpty: shopLookRelaxEnv(),
            blipSignal: detectionBlipSignal,
            inferredPrimaryColor,
            inferredColorsByItem,
            inferredColorsByItemConfidence,
            debugRawCosineFirst: shopLookDebugRawCosineFirstEnv(),
            sessionId: options.sessionId,
            userId: options.userId,
            sessionFilters: options.sessionFilters ?? undefined,
          });
        }

        const lowQualityFallbackWanted =
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
          for (const alt of altVectors) {
            const altResult = await searchByImageWithSimilarity({
              imageEmbedding: alt,
              imageEmbeddingGarment: alt,
              imageBuffer: queryProcessBuf,
              pHash: sourceImagePHash,
              detectionYoloConfidence: detection.confidence,
              detectionProductCategory: categoryMapping.productCategory,
              filters,
              softProductTypeHints,
              limit: retrievalLimit,
              similarityThreshold: options.similarityThreshold ?? config.clip.imageSimilarityThreshold,
              includeRelated: false,
              predictedCategoryAisles,
              knnField: shopTheLookKnnField(),
              forceHardCategoryFilter: forceHardCategoryFilterUsed,
              relaxThresholdWhenEmpty: shopLookRelaxEnv(),
              blipSignal: detectionBlipSignal,
              inferredPrimaryColor,
              inferredColorsByItem,
              inferredColorsByItemConfidence,
              debugRawCosineFirst: shopLookDebugRawCosineFirstEnv(),
              sessionId: options.sessionId,
              userId: options.userId,
              sessionFilters: options.sessionFilters ?? undefined,
            });
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

        const effectiveSimilarityThreshold =
          options.similarityThreshold ?? config.clip.imageSimilarityThreshold;
        
        console.log(`[skip-trace] detection="${categorySource}" after_knn_search=${similarResult.results.length}`);
        
        const precisionSafeResults = applyShopLookVisualPrecisionGuard(
          similarResult.results,
          categoryMapping.productCategory === "footwear" && (detection.area_ratio ?? 0) <= 0.02
            ? shopLookTinyFootwearRecoveryThreshold(effectiveSimilarityThreshold)
            : effectiveSimilarityThreshold,
        );
        
        console.log(`[skip-trace] detection="${categorySource}" after_precision_guard=${precisionSafeResults.length} (filtered_by=${similarResult.results.length - precisionSafeResults.length})`);
        
        const categorySafeResults = applyDetectionCategoryGuard(
          precisionSafeResults,
          categorySource,
          categoryMapping,
        );
        
        console.log(`[skip-trace] detection="${categorySource}" after_category_guard=${categorySafeResults.length} (filtered_by=${precisionSafeResults.length - categorySafeResults.length})`);
        
        // Apply formality filter if formal wear was detected from BLIP caption
        const minFormality = (filters as any).minFormality;
        if (minFormality) {
          console.log(`[formality-apply-alt] detection="${categorySource}" minFormality=${minFormality} incoming=${categorySafeResults.length}`);
        }
        const formalitySafeResults = applyFormalityFilter(categorySafeResults, minFormality);

        const athleticSafeResults = applyAthleticMismatchGuard({
          products: formalitySafeResults,
          detectionLabel: categorySource,
          productCategory: categoryMapping.productCategory,
          softStyle: String((filters as any).softStyle ?? ""),
          minFormality,
        });
        
        console.log(`[skip-trace] detection="${categorySource}" after_formality_filter=${formalitySafeResults.length} (filtered_by=${categorySafeResults.length - formalitySafeResults.length})`);
        console.log(`[skip-trace] detection="${categorySource}" after_athletic_guard=${athleticSafeResults.length} (filtered_by=${formalitySafeResults.length - athleticSafeResults.length})`);
        
        if (athleticSafeResults.length === 0) {
          console.log(`[skip-trace-WARN] detection="${categorySource}" ZERO_RESULTS filters={category:"${filters.category}", productTypes:[${filters.productTypes?.join(",")}], softStyle:"${filters.softStyle}", minFormality:${minFormality}}`);
        }
        
        similarResult = {
          ...similarResult,
          results: athleticSafeResults,
        };

        const includeEmpty = options.includeEmptyDetectionGroups === true;
        if (similarResult.results.length > 0 || includeEmpty) {
          groupedResults.push({
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
              productTypes: filters.productTypes,
              gender: filters.gender,
              ageGroup: filters.ageGroup,
              softStyle: filters.softStyle,
              length: (filters as any).length,
            },
            source: isUserDefined ? "user_defined" : "yolo",
            originalIndex: isUserDefined ? undefined : originalIndices[i],
          });
          totalProducts += similarResult.results.length;
        }
      } catch (err) {
        console.error(`Failed to process detection ${detection.label}:`, err);
      }
    }

    const postRankedSel = applyGroupedPostRanking(groupedResults, imageCrossGroupDedupeEnabled());
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
    
    const relevanceFilteredResultsSel = finalGroupedResults.map((detection) => ({
      ...detection,
      products: applyRelevanceThresholdFilter(detection.products, minRelevanceThresholdSel, {
        preserveAtLeastOne: isCoreOutfitCategory(detection.category),
        detectionLabel: detection.detection?.label,
        category: detection.category,
      }),
      count: 0, // Will be recalculated below
    }));
    
    // Recalculate counts and total after filtering
    let newTotalProductsSel = 0;
    for (const result of relevanceFilteredResultsSel) {
      result.count = result.products.length;
      newTotalProductsSel += result.count;
    }
    
    console.log(
      `[relevance-gate-sel] total products before=${totalProducts} → after=${newTotalProductsSel} (threshold=${minRelevanceThresholdSel})`,
    );
    totalProducts = newTotalProductsSel;

    const itemsForCoherence: DetectionWithColor[] = [];
    for (const r of relevanceFilteredResultsSel) {
      if (r.count === 0) continue;
      if (
        r.source === "yolo" &&
        r.originalIndex !== undefined &&
        fullResult.detection?.items[r.originalIndex]
      ) {
        itemsForCoherence.push(
          fullResult.detection.items[r.originalIndex] as DetectionWithColor,
        );
      } else {
        itemsForCoherence.push({
          label: r.detection.label,
          raw_label: r.detection.label,
          confidence: r.detection.confidence,
          box: r.detection.box,
          box_normalized: r.detection.box,
          area_ratio: r.detection.area_ratio,
          style: r.detection.style,
        } as DetectionWithColor);
      }
    }

    const outfitCoherence =
      itemsForCoherence.length > 0
        ? computeOutfitCoherence(itemsForCoherence)
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

    return {
      ...fullResult,
      blipCaption,
      inferredAudience,
      inferredPrimaryColor,
      inferredColorsByItem,
      inferredColorsByItemConfidence,
      similarProducts: {
        byDetection: relevanceFilteredResultsSel,
        totalProducts: newTotalProductsSel,
        totalAvailableProducts: pagedSel.totalAvailableProducts,
        threshold: options.similarityThreshold ?? config.clip.imageSimilarityThreshold,
        detectedCategories: [...new Set(relevanceFilteredResultsSel.map((r) => r.category))],
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

    // If primary, unset other primary images
    if (isPrimary) {
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
      [productId, key, cdnUrl, pHash, isPrimary]
    );

    return { id: result.rows[0].id, url: cdnUrl, width: 0, height: 0, pHash };
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

