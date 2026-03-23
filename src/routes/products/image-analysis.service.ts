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
import {
  uploadImage,
  getCdnUrl,
  processImageForEmbedding,
  blip,
  extractPaddedDetectionCropBuffer,
  computePHash,
  validateImage,
  isClipAvailable,
} from "../../lib/image";
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
import { searchByImageWithSimilarity } from "./search.service";
import { ProductResult } from "./types";
import sharpLib from "sharp";
import crypto from "crypto";
import {
  mapDetectionToCategory,
  getSearchCategories,
  shouldUseAlternatives,
  type CategoryMapping,
} from "../../lib/detection/categoryMapper";
import { extractLexicalProductTypeSeeds } from "../../lib/search/productTypeTaxonomy";
import { getCategorySearchTerms } from "../../lib/search/categoryFilter";

function imageSoftCategoryEnv(): boolean {
  const v = String(process.env.SEARCH_IMAGE_SOFT_CATEGORY ?? "").toLowerCase();
  return v === "1" || v === "true";
}

/**
 * kNN field for per-detection Shop-the-Look searches (query vector = padded detection crop).
 * When `SEARCH_IMAGE_DETECTION_KNN_FIELD` is unset, defaults to `embedding_garment` so query
 * vectors match the index field built with `processImageForGarmentEmbedding` on catalog images.
 * Set to `embedding` only if your index omits garment vectors or you intentionally compare crops to full-frame vectors.
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

/** Per-detection "hard category" confidence threshold (default 0.75). */
function shopLookHardCategoryConfThreshold(): number {
  const raw = Number(process.env.SEARCH_IMAGE_DETECTION_HARD_CAT_CONF ?? "0.75");
  if (!Number.isFinite(raw)) return 0.75;
  return Math.max(0, Math.min(1, raw));
}

/** Per-detection minimum area ratio for hard category (default 0.005). */
function shopLookHardCategoryAreaRatioThreshold(): number {
  const raw = Number(process.env.SEARCH_IMAGE_DETECTION_HARD_CAT_AREA_RATIO ?? "0.005");
  if (!Number.isFinite(raw)) return 0.005;
  return Math.max(0, Math.min(1, raw));
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

function inferAudienceFromCaption(caption: string): { gender?: string; ageGroup?: string } {
  const s = String(caption || "").toLowerCase();
  const hasUnisex = /\b(unisex|universal)\b/.test(s);
  const hasWomen = /\b(women|womens|female|ladies|woman|girl|girls)\b/.test(s);
  const hasMen = /\b(men|mens|male|man)\b/.test(s);

  // Map to the same `attr_gender` values used by `attributeExtractor.ts`.
  // (It indexes: `men|women|unisex|boys|girls|kids|baby|infant|toddler` etc.)
  const gender =
    hasUnisex
      ? "unisex"
      : /\b(girl|girls|girl's)\b/.test(s)
        ? "girls"
        : /\b(boy|boys|boy's)\b/.test(s)
          ? "boys"
          : /\b(ladies|women|womens|female|woman)\b/.test(s)
            ? "women"
            : hasMen
              ? "men"
              : undefined;

  let ageGroup: string | undefined;
  if (/\b(baby|infant|newborn)\b/.test(s)) ageGroup = "baby";
  else if (/\b(toddler)\b/.test(s)) ageGroup = "kids";
  else if (/\b(teen|youth|teenager)\b/.test(s)) ageGroup = "teen";
  else if (/\b(kid|kids|child|children|boys|girls|toddler)\b/.test(s)) ageGroup = "kids";

  return { gender, ageGroup };
}

function inferColorFromCaption(caption: string): { topColor?: string | null; jeansColor?: string | null } {
  const s = String(caption || "").toLowerCase();

  // Canonicalize a few common color words expected by our color pipeline.
  const mapColorWord = (w: string): string | null => {
    const x = w.toLowerCase().trim();
    if (!x) return null;
    if (x === "navy" || x === "dark-blue" || x === "dark blue" || x === "midnight-blue" || x === "midnight blue") return "navy";
    if (x === "blue" || x === "denim") return "blue";
    if (x === "black") return "black";
    if (x === "grey" || x === "gray") return "gray";
    if (x === "white" || x === "ivory" || x === "cream" || x === "off-white" || x === "off white") return "off-white";
    if (x === "tan" || x === "camel" || x === "brown") return "tan";
    if (x === "green" || x === "olive") return "green";
    return null;
  };

  // Example: "a blue velvet top"
  let topColor: string | null = null;
  const topMatch = s.match(/\b(black|navy|blue|denim|grey|gray|white|ivory|cream|off[- ]white|tan|camel|brown|green|olive)\b[^.]{0,40}\b(top|shirt|blouse|tee|t-shirt|t shirt|tunic)\b/);
  if (topMatch?.[1]) topColor = mapColorWord(topMatch[1]);

  // Example: "dark jeans" / "blue jeans" (optional; many captions omit explicit color)
  let jeansColor: string | null = null;
  const jeansMatch = s.match(/\b(black|navy|blue|denim|grey|gray)\b[^.]{0,20}\bjeans\b/);
  if (jeansMatch?.[1]) jeansColor = mapColorWord(jeansMatch[1]);

  return { topColor, jeansColor };
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

  // Prefer trousers/pants over jeans when YOLO says "trousers".
  if (categoryMapping.productCategory === "bottoms") {
    const isTrousersLike = /\b(trouser|trousers|pants|pant|chino|chinos|slack|slacks|cargo|cargo pants|sweatpants|sweatpants)\b/.test(
      l,
    );
    const isJeansLike = /\b(jean|jeans|denim|denims)\b/.test(l);

    if (isTrousersLike) {
      // Keep only pants/trousers-side terms; drop shorts/skirt/jeans.
      return baseTerms.filter((t) =>
        /\b(pant|pants|trouser|trousers|chino|chinos|slack|slacks|cargo|sweatpants)\b/.test(t),
      );
    }
    if (isJeansLike) {
      return baseTerms.filter((t) => /\b(jean|jeans|denim|denims)\b/.test(t));
    }
    return baseTerms;
  }

  // Prefer hat/cap-family over generic `accessories`.
  if (categoryMapping.productCategory === "accessories") {
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

function shouldKeepDetectionForShopTheLook(detection: Detection): boolean {
  const mapped = mapDetectionToCategory(detection.label, detection.confidence).productCategory;
  if (mapped !== "footwear") return true;
  const areaRatio = Number.isFinite(detection.area_ratio) ? detection.area_ratio : 0;
  const confidence = Number.isFinite(detection.confidence) ? detection.confidence : 0;
  // Tiny, low-confidence footwear boxes are often false positives near image edges.
  if (areaRatio < imageMinFootwearAreaRatio() && confidence < imageMinFootwearConfidence()) {
    return false;
  }
  return true;
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

  /** Product ID to associate image with */
  productId?: number;

  /** Mark as primary image for product */
  isPrimary?: boolean;
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
}

export interface AnalyzeAndFindSimilarOptions extends AnalyzeOptions {
  /** Find similar products after analysis (default: true) */
  findSimilar?: boolean;

  /** Similarity threshold 0-1 (default: 0.7) */
  similarityThreshold?: number;

  /** Max similar products per detection (default: 10) */
  similarLimitPerItem?: number;

  /** Filter similar products by detected category */
  filterByDetectedCategory?: boolean;

  /**
   * When true (default): one similar-product group per YOLO detection instance (same label allowed twice).
   * When false: merge same-label boxes only when IoU ≥ `YOLO_SHOP_DEDUPE_IOU_THRESHOLD` (default 0.5); spatially separate instances stay separate.
   */
  groupByDetection?: boolean;

  /** When true, include each detection in `byDetection` even if similarity search returns no products (products may be []). */
  includeEmptyDetectionGroups?: boolean;
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

    // #region agent log
    fetch("http://127.0.0.1:7383/ingest/ccea0d1b-4b26-441e-9797-fbae444c347a", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "00a194" },
      body: JSON.stringify({
        sessionId: "00a194",
        runId: "post-fix-verify",
        hypothesisId: "H-aggregate",
        location: "image-analysis.service.ts:getServiceStatus",
        message: "service status",
        data: {
          yolo: yoloAvailable,
          clip: clipAvailable,
          yoloBaseUrl: this.yoloClient.getBaseUrl(),
          hasYoloHint: Boolean(yoloHint),
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion

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
            .detectFromBuffer(buffer, filename, { confidence })
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
            enhanceContrast: true,
            enhanceSharpness: true,
            bilateralFilter: true,
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
      similarityThreshold = 0.7,
      similarLimitPerItem = 10,
      filterByDetectedCategory = true,
      groupByDetection = true,
      includeEmptyDetectionGroups = false,
      ...analyzeOptions
    } = options;

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

    // Similarity search disabled — return early
    if (!findSimilar) {
      return {
        ...analysisResult,
        similarProducts: { byDetection: [], totalProducts: 0, threshold: similarityThreshold, detectedCategories: [] },
      };
    }

    // No YOLO detections — fall back to a whole-image embedding search
    if (!analysisResult.detection || analysisResult.detection.items.length === 0) {
      const fallbackDetection = syntheticFullImageDetectionBlock(imageWidth, imageHeight);
      const fallbackDetectedCategories = [...new Set(fallbackDetection.items.map((item) => item.label))];
      if (!analysisResult.embedding) {
        return {
          ...analysisResult,
          detection: fallbackDetection,
          similarProducts: { byDetection: [], totalProducts: 0, threshold: similarityThreshold, detectedCategories: fallbackDetectedCategories },
        };
      }
      const fallback = await searchByImageWithSimilarity({
        imageEmbedding: analysisResult.embedding,
        imageBuffer: buffer,
        filters: {},
        limit: similarLimitPerItem,
        similarityThreshold,
        includeRelated: false,
        relaxThresholdWhenEmpty: shopLookRelaxEnv(),
      });
      return {
        ...analysisResult,
        detection: fallbackDetection,
        similarProducts: {
          byDetection: fallback.results.length > 0 ? [{
            detection: { label: "full_image", confidence: 1.0, box: { x1: 0, y1: 0, x2: imageWidth, y2: imageHeight }, area_ratio: 1.0 },
            category: "all",
            products: fallback.results,
            count: fallback.results.length,
          }] : [],
          totalProducts: fallback.results.length,
          threshold: similarityThreshold,
          detectedCategories: fallbackDetectedCategories,
        },
      };
    }

    // Extract detected categories
    const detectedCategories = [...new Set(
      analysisResult.detection.items.map((item) => item.label)
    )];

    // Infer audience gender (men/women/boys/girls/etc.) and optionally dominant color once per image.
    // This helps prevent cross-gender recommendations.
    let blipCaption: string | null = null;
    const inferredAudience: ReturnType<typeof inferAudienceFromCaption> =
      analysisResult.services?.blip && imageInferAudienceGenderEnv()
        ? await blip
            .caption(buffer)
            .then((caption) => {
              blipCaption = caption;
              return inferAudienceFromCaption(caption);
            })
            .catch(() => ({} as ReturnType<typeof inferAudienceFromCaption>))
        : ({} as ReturnType<typeof inferAudienceFromCaption>);

    const captionColors = blipCaption ? inferColorFromCaption(blipCaption) : {};
    // Fallback only: if per-detection crop color is unavailable, use a coarse full-image color.
    const inferredPrimaryColor =
      imageInferDominantColorEnv() && analysisResult.services?.blip
        ? await extractDominantColorNames(buffer, { maxColors: 2, minShare: 0.12 })
            .then((c) => c[0] ?? null)
            .catch(() => null)
        : null;

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
      let croppedBuffer = await extractPaddedDetectionCropBuffer(buffer, detection.box);
      if (!croppedBuffer) {
        croppedBuffer = await this.cropDetection(
          buffer,
          detection.box,
          imageWidth,
          imageHeight
        );
      }
      if (!croppedBuffer) return null;

      const finalEmbedding = await processImageForEmbedding(croppedBuffer);

      const categoryMapping = mapDetectionToCategory(label, detection.confidence);
      const searchCategories = shouldUseAlternatives(categoryMapping)
        ? getSearchCategories(categoryMapping)
        : [categoryMapping.productCategory];

      const filters: Partial<import("./types").SearchFilters> = {};
      // Avoid taxonomy pollution for labels like "short sleeve top" where the word "short"
      // may incorrectly map to shorts/shorts_skirt micro-types.
      const captionWantsJeans = blipCaption ? /\bjeans\b/.test(blipCaption.toLowerCase()) : false;
      const typeSeedSource =
        categoryMapping.productCategory === "bottoms" && captionWantsJeans
          ? "jeans"
          : categoryMapping.productCategory === "tops" &&
            categoryMapping.attributes.sleeveLength === "short"
            ? "tshirt tee"
            : label;
      const typeSeeds = extractLexicalProductTypeSeeds(typeSeedSource);
      if (typeSeeds.length) {
        filters.productTypes = typeSeeds;
      }

      // "Closet similar" constraints: enforce audience gender + add optional style/color.
      if (inferredAudience.gender) filters.gender = inferredAudience.gender;
      if (inferredAudience.ageGroup) filters.ageGroup = inferredAudience.ageGroup;

      const inferredStyle = inferStyleForDetectionLabel(label);
      // Apply style intent whenever we have an inference token; the ranking layer
      // will score it softly (so we avoid going fully empty).
      if (inferredStyle.attrStyle) {
        filters.softStyle = inferredStyle.attrStyle;
      }

      // Prefer per-detection crop color (aligned with the detected item).
      // Fall back to caption inferred color / coarse full-image dominant color.
      let inferredColorForDetection: string | null = null;
      const shouldInferColorForDetection =
        imageInferDominantColorEnv() &&
        (detection.confidence ?? 0) >= imageMinColorConfidenceEnv() &&
        (detection.area_ratio ?? 0) >= imageMinColorAreaRatioEnv();

      if (shouldInferColorForDetection) {
        inferredColorForDetection = await extractDominantColorNames(croppedBuffer, { maxColors: 1, minShare: 0.12 }).then(
          (c) => c[0] ?? null,
        );
      }

      if (!inferredColorForDetection) {
        if (categoryMapping.productCategory === "tops") inferredColorForDetection = captionColors.topColor ?? null;
        if (categoryMapping.productCategory === "bottoms") inferredColorForDetection = captionColors.jeansColor ?? null;
      }

      if (!inferredColorForDetection) inferredColorForDetection = inferredPrimaryColor;
      if (inferredColorForDetection) filters.softColor = inferredColorForDetection;
      let predictedCategoryAisles: string[] | undefined;
      const shouldHardCategory =
        filterByDetectedCategory &&
        categoryMapping.confidence >= shopLookHardCategoryConfThreshold() &&
        (detection.area_ratio ?? 0) >= shopLookHardCategoryAreaRatioThreshold();
      const forceHardCategoryFilterUsed = Boolean(shouldHardCategory);
      if (filterByDetectedCategory) {
        const hardLabelForTerms =
          categoryMapping.productCategory === "bottoms" && captionWantsJeans ? "jeans" : label;
        if (shouldHardCategory) {
          // Apply hard OpenSearch category filtering, even when global soft-category is enabled.
          const terms = hardCategoryTermsForDetection(hardLabelForTerms, categoryMapping);
          filters.category = terms.length === 1 ? terms[0] : terms;
        } else if (imageSoftCategoryEnv() || shopLookSoftCategoryEnv()) {
          predictedCategoryAisles = searchCategories;
        } else {
          filters.category =
            searchCategories.length === 1 ? searchCategories[0] : searchCategories;
        }
      }

      const knnFieldUsed = shopTheLookKnnField();

      let similarResult = await searchByImageWithSimilarity({
        imageEmbedding: finalEmbedding,
        imageBuffer: croppedBuffer,
        filters,
        limit: similarLimitPerItem,
        similarityThreshold,
        includeRelated: false,
        predictedCategoryAisles,
        knnField: knnFieldUsed,
        forceHardCategoryFilter: forceHardCategoryFilterUsed,
        relaxThresholdWhenEmpty: shopLookRelaxEnv(),
      });

      // If BLIP-derived audience/style/color filters are too strict and remove all hits,
      // retry once without those attribute filters (but keep category/productTypes).
      if (
        similarResult.results.length === 0 &&
        (filters.gender || filters.style || filters.color)
      ) {
        const filtersRetry = { ...filters } as typeof filters;
        delete (filtersRetry as any).gender;
        delete (filtersRetry as any).ageGroup;
        delete (filtersRetry as any).style;
        delete (filtersRetry as any).color;
        similarResult = await searchByImageWithSimilarity({
          imageEmbedding: finalEmbedding,
          imageBuffer: croppedBuffer,
          filters: filtersRetry,
          limit: similarLimitPerItem,
          similarityThreshold,
          includeRelated: false,
          predictedCategoryAisles,
          knnField: knnFieldUsed,
          forceHardCategoryFilter: forceHardCategoryFilterUsed,
          relaxThresholdWhenEmpty: shopLookRelaxEnv(),
        });
      }

      if (
        shopLookCategoryFallbackEnv() &&
        similarResult.results.length === 0 &&
        filterByDetectedCategory &&
        (filters as { category?: string | string[] }).category
      ) {
        const { category: _omitCategory, ...filtersSansCategory } = filters as {
          category?: string | string[];
          productTypes?: string[];
        };
        similarResult = await searchByImageWithSimilarity({
          imageEmbedding: finalEmbedding,
          imageBuffer: croppedBuffer,
          filters: filtersSansCategory,
          limit: similarLimitPerItem,
          similarityThreshold,
          includeRelated: false,
          predictedCategoryAisles,
          knnField: shopTheLookKnnField(),
          forceHardCategoryFilter: false,
          relaxThresholdWhenEmpty: shopLookRelaxEnv(),
        });
        if (similarResult.results.length === 0) {
          similarResult = await searchByImageWithSimilarity({
            imageEmbedding: finalEmbedding,
            imageBuffer: croppedBuffer,
            filters: {},
            limit: similarLimitPerItem,
            similarityThreshold,
            includeRelated: false,
            knnField: shopTheLookKnnField(),
            forceHardCategoryFilter: false,
            relaxThresholdWhenEmpty: shopLookRelaxEnv(),
          });
        }
      }

      if (similarResult.results.length === 0 && !includeEmptyDetectionGroups) {
        return null;
      }

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
          softColor: filters.softColor,
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

    // Sort by detection "importance" = confidence * visible area ratio (highest first)
    groupedResults.sort((a, b) => {
      const wA = (a.detection.confidence ?? 0) * (Number.isFinite(a.detection.area_ratio) ? a.detection.area_ratio : 0);
      const wB = (b.detection.confidence ?? 0) * (Number.isFinite(b.detection.area_ratio) ? b.detection.area_ratio : 0);
      return wB - wA;
    });

    const totalDetectionJobs = detectionJobs.length;
    let coveredDetections = 0;
    for (const outcome of settled) {
      if (outcome.status === "fulfilled" && outcome.value && outcome.value.count > 0) {
        coveredDetections += 1;
      }
    }
    const emptyDetections = totalDetectionJobs - coveredDetections;
    const coverageRatio =
      totalDetectionJobs > 0 ? coveredDetections / totalDetectionJobs : 0;

    const itemsForCoherence = groupedResults
      .filter((r) => r.count > 0 && r.detectionIndex !== undefined)
      .map(
        (r) =>
          analysisResult.detection!.items[r.detectionIndex!] as DetectionWithColor,
      );

    const outfitCoherence =
      itemsForCoherence.length > 0
        ? computeOutfitCoherence(itemsForCoherence)
        : undefined;

    return {
      ...analysisResult,
      blipCaption,
      inferredAudience,
      inferredPrimaryColor,
      similarProducts: {
        byDetection: groupedResults,
        totalProducts,
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
    } = {}
  ): Promise<GroupedSimilarProducts> {
    const { similarityThreshold = 0.7, limitPerItem = 10, filterByCategory } = options;

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
      ...baseOptions
    } = options;

    // Get image dimensions
    const metadata = await sharp(buffer).metadata();
    const imageWidth = metadata.width || 0;
    const imageHeight = metadata.height || 0;

    // Run standard analysis with preprocessing options
    const fullResult = await this.analyzeImage(buffer, filename, {
      ...baseOptions,
      generateEmbedding: true,
    });

    if (!fullResult.detection) {
      return {
        ...fullResult,
        similarProducts: undefined,
        outfitCoherence: undefined,
      };
    }

    // Filter detections based on selection/exclusion
    let itemsToProcess = fullResult.detection.items;
    const originalIndices: number[] = fullResult.detection.items.map((_, i) => i);

    if (selectedItemIndices && selectedItemIndices.length > 0) {
      // Only process selected items
      const validIndices = selectedItemIndices.filter(
        (i) => i >= 0 && i < fullResult.detection!.items.length
      );
      itemsToProcess = validIndices.map((i) => fullResult.detection!.items[i]);
    }

    if (excludedItemIndices.length > 0) {
      const excludeSet = new Set(excludedItemIndices);
      itemsToProcess = itemsToProcess.filter((_, i) => !excludeSet.has(originalIndices[i]));
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
    let blipCaption: string | null = null;
    const inferredAudience: ReturnType<typeof inferAudienceFromCaption> =
      fullResult.services?.blip && imageInferAudienceGenderEnv()
        ? await blip
            .caption(buffer)
            .then((caption) => {
              blipCaption = caption;
              return inferAudienceFromCaption(caption);
            })
            .catch(() => ({} as ReturnType<typeof inferAudienceFromCaption>))
        : ({} as ReturnType<typeof inferAudienceFromCaption>);

    const inferredPrimaryColor =
      imageInferDominantColorEnv() && fullResult.services?.blip
        ? await extractDominantColorNames(buffer, { maxColors: 2, minShare: 0.12 })
            .then((c) => c[0] ?? null)
            .catch(() => null)
        : null;
    const captionColors = blipCaption ? inferColorFromCaption(blipCaption) : {};
    // Avoid TS "never" narrowing when caption inference is type-proved unreachable.
    const captionWantsJeans = /\bjeans\b/.test((blipCaption ?? "").toLowerCase());

    for (let i = 0; i < allItemsToProcess.length; i++) {
      const detection = allItemsToProcess[i];
      const isUserDefined = i >= itemsToProcess.length;

      try {
        // Crop detected region
        const croppedBuffer = await this.cropDetection(
          buffer,
          detection.box,
          imageWidth,
          imageHeight
        );
        if (!croppedBuffer) continue;

        const finalEmbedding = await processImageForEmbedding(croppedBuffer);

        // Get category from user hint or detection
        const categorySource =
          isUserDefined && userDefinedBoxes[i - itemsToProcess.length].categoryHint
            ? userDefinedBoxes[i - itemsToProcess.length].categoryHint!
            : detection.label;
        const categoryMapping = mapDetectionToCategory(categorySource, detection.confidence);

        const filters: Partial<import("./types").SearchFilters> = {};
        const typeSeedSourceForSelection =
          categoryMapping.productCategory === "bottoms" && captionWantsJeans ? "jeans" : categorySource;
        const browseTypeSeeds = extractLexicalProductTypeSeeds(typeSeedSourceForSelection);
        if (browseTypeSeeds.length) {
          filters.productTypes = browseTypeSeeds;
        }

        // "Closet similar" constraints: enforce audience gender + add optional style/color.
        if (inferredAudience.gender) filters.gender = inferredAudience.gender;
        if (inferredAudience.ageGroup) filters.ageGroup = inferredAudience.ageGroup;

        const inferredStyle = inferStyleForDetectionLabel(categorySource);
        if (inferredStyle.attrStyle) {
          filters.softStyle = inferredStyle.attrStyle;
        }

        // Prefer per-detection crop color (aligned with the detected item) for selection too.
        let inferredColorForDetection: string | null = null;
        const shouldInferColorForDetection =
          imageInferDominantColorEnv() &&
          (detection.confidence ?? 0) >= imageMinColorConfidenceEnv() &&
          (detection.area_ratio ?? 0) >= imageMinColorAreaRatioEnv();

        if (shouldInferColorForDetection) {
          inferredColorForDetection = await extractDominantColorNames(croppedBuffer, { maxColors: 1, minShare: 0.12 }).then(
            (c) => c[0] ?? null,
          );
        }

        if (!inferredColorForDetection) {
          if (categoryMapping.productCategory === "tops") inferredColorForDetection = captionColors.topColor ?? null;
          if (categoryMapping.productCategory === "bottoms") inferredColorForDetection = captionColors.jeansColor ?? null;
        }
        if (!inferredColorForDetection) inferredColorForDetection = inferredPrimaryColor;
        if (inferredColorForDetection) filters.softColor = inferredColorForDetection;
        let predictedCategoryAisles: string[] | undefined;
        if (options.filterByDetectedCategory !== false) {
          if (imageSoftCategoryEnv() || shopLookSoftCategoryEnv()) {
            predictedCategoryAisles = shouldUseAlternatives(categoryMapping)
              ? getSearchCategories(categoryMapping)
              : [categoryMapping.productCategory];
          } else {
            const hardLabelForTerms =
              categoryMapping.productCategory === "bottoms" && captionWantsJeans
                ? "jeans"
                : categorySource;
            const terms = hardCategoryTermsForDetection(hardLabelForTerms, categoryMapping);
            filters.category = terms.length === 1 ? terms[0] : terms;
          }
        }

        let similarResult = await searchByImageWithSimilarity({
          imageEmbedding: finalEmbedding,
          imageBuffer: croppedBuffer,
          filters,
          limit: options.similarLimitPerItem || 10,
          similarityThreshold: options.similarityThreshold || 0.7,
          includeRelated: false,
          predictedCategoryAisles,
          knnField: shopTheLookKnnField(),
          relaxThresholdWhenEmpty: shopLookRelaxEnv(),
        });

        // Retry without inferred attribute filters if they removed all hits.
        if (
          similarResult.results.length === 0 &&
          (filters.gender || filters.style || filters.color)
        ) {
          const filtersRetry = { ...filters } as typeof filters;
          delete (filtersRetry as any).gender;
          delete (filtersRetry as any).ageGroup;
          delete (filtersRetry as any).style;
          delete (filtersRetry as any).color;
          similarResult = await searchByImageWithSimilarity({
            imageEmbedding: finalEmbedding,
            imageBuffer: croppedBuffer,
            filters: filtersRetry,
            limit: options.similarLimitPerItem || 10,
            similarityThreshold: options.similarityThreshold || 0.7,
            includeRelated: false,
            predictedCategoryAisles,
            knnField: shopTheLookKnnField(),
            relaxThresholdWhenEmpty: shopLookRelaxEnv(),
          });
        }

        if (
          shopLookCategoryFallbackEnv() &&
          similarResult.results.length === 0 &&
          options.filterByDetectedCategory !== false &&
          !imageSoftCategoryEnv() &&
          (filters as { category?: string | string[] }).category
        ) {
          const { category: _omitCategory, ...filtersSansCategory } = filters as {
            category?: string | string[];
            productTypes?: string[];
          };
          similarResult = await searchByImageWithSimilarity({
            imageEmbedding: finalEmbedding,
            imageBuffer: croppedBuffer,
            filters: filtersSansCategory,
            limit: options.similarLimitPerItem || 10,
            similarityThreshold: options.similarityThreshold || 0.7,
            includeRelated: false,
            predictedCategoryAisles,
            knnField: shopTheLookKnnField(),
            relaxThresholdWhenEmpty: shopLookRelaxEnv(),
          });
          if (similarResult.results.length === 0) {
            similarResult = await searchByImageWithSimilarity({
              imageEmbedding: finalEmbedding,
              imageBuffer: croppedBuffer,
              filters: {},
              limit: options.similarLimitPerItem || 10,
              similarityThreshold: options.similarityThreshold || 0.7,
              includeRelated: false,
              knnField: shopTheLookKnnField(),
              relaxThresholdWhenEmpty: shopLookRelaxEnv(),
            });
          }
        }

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
              softColor: filters.softColor,
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

    const itemsForCoherence: DetectionWithColor[] = [];
    for (const r of groupedResults) {
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

    const coveredSel = groupedResults.filter((r) => r.count > 0).length;
    const totalSel = allItemsToProcess.length;

    return {
      ...fullResult,
      blipCaption,
      inferredAudience,
      inferredPrimaryColor,
      similarProducts: {
        byDetection: groupedResults,
        totalProducts,
        threshold: options.similarityThreshold || 0.7,
        detectedCategories: [...new Set(groupedResults.map((r) => r.category))],
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
