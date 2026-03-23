/**
 * Dual-Model Fashion Detection Client
 *
 * TypeScript client for the Dual-Model Fashion Detection API.
 * Uses a hybrid detector combining:
 *   - Model A: deepfashion2_yolov8s-seg (clothing: tops, bottoms, dresses, outerwear)
 *   - Model B: valentinafeve/yolos-fashionpedia (accessories: shoes, bags, hats)
 * Provides type-safe methods for detecting fashion items in images.
 */

import {
  YoloCircuitBreaker,
  isYoloCircuitOpenError,
} from "./yoloCircuitBreaker";
import { mapDetectionToCategory } from "../detection/categoryMapper";

// ============================================================================
// Types
// ============================================================================

export interface BoundingBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface StyleInfo {
  occasion?: string;
  aesthetic?: string;
  formality?: number;
}

export interface SegmentationMask {
  /** Polygon contour points [[x1,y1],[x2,y2],...] in pixel coordinates */
  polygon: number[][];
  /** Polygon contour points normalized to 0-1 */
  polygon_normalized: number[][];
  /** Run-length encoded binary mask (base64) */
  mask_rle?: string;
  /** Mask area in pixels */
  mask_area: number;
  /** Mask area as ratio of image area */
  mask_area_ratio: number;
}

export interface Detection {
  label: string;
  raw_label: string;
  confidence: number;
  box: BoundingBox;
  box_normalized: BoundingBox;
  area_ratio: number;
  style?: StyleInfo;
  mask?: SegmentationMask;
}

export interface DetectionResponse {
  success: boolean;
  detections: Detection[];
  count: number;
  image_size: { width: number; height: number };
  model: string;
  summary: Record<string, number>;
}

export interface HealthResponse {
  ok: boolean;
  model_path: string;
  model_loaded: boolean;
  num_classes: number;
  class_names: string[];
  config: {
    confidence_threshold: number;
    iou_threshold: number;
    max_detections: number;
    min_box_area_ratio: number;
  };
}

export interface LabelsResponse {
  fashion_categories: string[];
  category_styles: Record<string, StyleInfo>;
  total: number;
}

/** Result of a single YOLO /health probe (used by status APIs and `isAvailable`). */
export interface YoloHealthSnapshot {
  available: boolean;
  /** Present when `available` is false — local dev / ops guidance */
  hint?: string;
  healthOk?: boolean;
  modelLoaded?: boolean;
}

export interface DetectOptions {
  confidence?: number;
  includePerson?: boolean;
  normalizedBoxes?: boolean;
  /** Include instance segmentation masks in results (default: true) */
  includeMasks?: boolean;
  /** Preprocessing options for improved detection on cluttered backgrounds */
  preprocessing?: {
    /** Apply contrast enhancement (default: false) */
    enhanceContrast?: boolean;
    /** Apply sharpness enhancement (default: false) */
    enhanceSharpness?: boolean;
    /** Apply bilateral filtering for noise reduction (default: false) */
    bilateralFilter?: boolean;
  };
}

export interface OutfitComposition {
  tops: Detection[];
  bottoms: Detection[];
  dresses: Detection[];
  outerwear: Detection[];
  footwear: Detection[];
  bags: Detection[];
  accessories: Detection[];
}

// ============================================================================
// Client Class
// ============================================================================

/**
 * Base URL for the Python YOLO FastAPI service (`yolov8_api.py`), not the Node/ONNX CLIP stack.
 *
 * **Canonical:** `YOLOV8_SERVICE_URL`
 * **Deprecated alias:** `YOLO_API_URL` (used only when canonical is unset)
 *
 * If both are set to different values, canonical wins and a warning is logged once.
 */
let yoloUrlConflictWarned = false;
let yoloDeprecatedEnvWarned = false;

export function resolveYoloServiceBaseUrl(override?: string): string {
  const o = override?.trim();
  if (o) return o;
  const v8 = process.env.YOLOV8_SERVICE_URL?.trim();
  const legacy = process.env.YOLO_API_URL?.trim();
  if (v8 && legacy && v8 !== legacy && !yoloUrlConflictWarned) {
    yoloUrlConflictWarned = true;
    console.warn(
      `[YOLOv8] Both YOLOV8_SERVICE_URL and YOLO_API_URL are set to different values. ` +
        `Using canonical YOLOV8_SERVICE_URL. Remove or align YOLO_API_URL (deprecated alias).`,
    );
  }
  if (v8) return v8;
  if (legacy) {
    if (!yoloDeprecatedEnvWarned) {
      yoloDeprecatedEnvWarned = true;
      console.warn(
        `[YOLOv8] Using deprecated YOLO_API_URL for service URL. Prefer YOLOV8_SERVICE_URL.`,
      );
    }
    return legacy;
  }
  return "http://127.0.0.1:8001";
}

function yoloDetectTimeoutMs(): number {
  const raw = Number(process.env.YOLO_DETECT_TIMEOUT_MS);
  // YOLO inference can take longer than a couple seconds (CPU warmup, model IO, first run),
  // so the default needs to be higher than 2s to avoid spurious empty detections.
  const n = Number.isFinite(raw) && raw > 0 ? raw : 120_000;
  // Allow longer timeouts for slow inference / warmups.
  return Math.min(600_000, Math.max(500, n));
}

/** GET /health and /labels may trigger first-time model load (entrypoint waits up to 180s for same). */
function yoloReadinessTimeoutMs(): number {
  const raw = Number(process.env.YOLO_READINESS_TIMEOUT_MS);
  const n = Number.isFinite(raw) && raw > 0 ? raw : 120_000;
  return Math.min(180_000, Math.max(5_000, n));
}

export class YOLOv8Client {
  private baseUrl: string;
  /** Batch / reload long operations */
  private timeout: number;
  private detectTimeoutMs: number;
  private readonly circuit = new YoloCircuitBreaker();

  constructor(baseUrl?: string, timeout?: number) {
    this.baseUrl = resolveYoloServiceBaseUrl(baseUrl);
    this.timeout = timeout || 30000;
    this.detectTimeoutMs = yoloDetectTimeoutMs();
    console.info(
      `[YOLOv8] HTTP client: base URL=${this.baseUrl} (YOLOV8_SERVICE_URL canonical; YOLO_API_URL deprecated alias); detect timeout=${this.detectTimeoutMs}ms`,
    );
  }

  /** Base URL used for requests (for logs when health fails). */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Probe YOLO /health once (availability + optional hint for status endpoints).
   */
  async getHealthSnapshot(): Promise<YoloHealthSnapshot> {
    try {
      const health = await this.health();
      const available = Boolean(health.ok && health.model_loaded);
      let hint: string | undefined;
      if (!available) {
        if (health.ok && !health.model_loaded) {
          hint =
            "YOLO is still loading models; wait ~30–60s after container start, then retry GET /api/images/status.";
        } else {
          hint =
            "YOLO reported unhealthy (ok=false or error). Check the yolov8 / detector container logs.";
        }
        console.warn(
          `[YOLOv8] service unhealthy at ${this.baseUrl}: ok=${health?.ok} model_loaded=${health?.model_loaded}`
        );
      }
      // #region agent log
      fetch("http://127.0.0.1:7383/ingest/ccea0d1b-4b26-441e-9797-fbae444c347a", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "00a194" },
        body: JSON.stringify({
          sessionId: "00a194",
          runId: "post-fix-verify",
          hypothesisId: "H2-H3-H5",
          location: "yolov8Client.ts:getHealthSnapshot:success",
          message: "YOLO health parsed",
          data: {
            baseUrl: this.baseUrl,
            healthOk: health.ok,
            modelLoaded: health.model_loaded,
            available,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      return {
        available,
        hint,
        healthOk: health.ok,
        modelLoaded: health.model_loaded,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const cause =
        e instanceof Error && e.cause instanceof Error
          ? `${e.cause.name}: ${e.cause.message}`
          : e instanceof Error && e.cause != null
            ? String(e.cause)
            : "";
      console.warn(`[YOLOv8] health check failed at ${this.baseUrl}: ${msg}`);
      const refused =
        cause.includes("ECONNREFUSED") ||
        msg.includes("ECONNREFUSED") ||
        /connection refused/i.test(cause) ||
        /connection refused/i.test(msg);
      const hint = refused
        ? `Nothing is listening at ${this.baseUrl}. Run \`pnpm dev:with-yolo\` (starts Docker yolov8 then the API) or \`pnpm yolo:dev\` in another terminal, then use \`pnpm dev\`. You can also set YOLOV8_SERVICE_URL to a running detector.`
        : `YOLO unreachable: ${msg.slice(0, 160)}`;
      if (refused) {
        console.warn(
          `[YOLOv8] No process is accepting connections at ${this.baseUrl}. ` +
            `Local dev: \`pnpm dev:with-yolo\` or \`pnpm yolo:dev\` + \`pnpm dev\`; set YOLOV8_SERVICE_URL if the detector is elsewhere.`,
        );
      }
      // #region agent log
      fetch("http://127.0.0.1:7383/ingest/ccea0d1b-4b26-441e-9797-fbae444c347a", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "00a194" },
        body: JSON.stringify({
          sessionId: "00a194",
          runId: "post-fix-verify",
          hypothesisId: "H1-H4",
          location: "yolov8Client.ts:getHealthSnapshot:catch",
          message: "YOLO health fetch failed",
          data: {
            baseUrl: this.baseUrl,
            errMsg: msg.slice(0, 200),
            refused,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      return { available: false, hint };
    }
  }

  /**
   * Check if the YOLO service is available
   */
  async isAvailable(): Promise<boolean> {
    const s = await this.getHealthSnapshot();
    return s.available;
  }

  /**
   * Health check endpoint
   */
  async health(): Promise<HealthResponse> {
    const response = await fetch(`${this.baseUrl}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(yoloReadinessTimeoutMs()),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Health check failed: ${response.status} ${body.slice(0, 200)}`
      );
    }

    return response.json();
  }

  /**
   * Get all supported fashion categories and their style attributes
   */
  async getLabels(): Promise<LabelsResponse> {
    const response = await fetch(`${this.baseUrl}/labels`, {
      method: "GET",
      signal: AbortSignal.timeout(yoloReadinessTimeoutMs()),
    });

    if (!response.ok) {
      throw new Error(`Failed to get labels: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Detect fashion items in an image from a Buffer
   */
  async detectFromBuffer(
    imageBuffer: Buffer,
    filename: string = "image.jpg",
    options: DetectOptions = {}
  ): Promise<DetectionResponse> {
    try {
      this.circuit.beforeRequest();
    } catch (e) {
      if (isYoloCircuitOpenError(e)) throw e;
      throw e;
    }

    const formData = new FormData();

    // Create a Blob from the Buffer (convert to Uint8Array for compatibility)
    const uint8Array = new Uint8Array(imageBuffer);
    const blob = new Blob([uint8Array], { type: this.getMimeType(filename) });
    formData.append("file", blob, filename);

    // Build URL with query params
    const url = new URL(`${this.baseUrl}/detect`);
    if (options.confidence !== undefined) {
      url.searchParams.set("confidence", options.confidence.toString());
    }
    if (options.includePerson !== undefined) {
      url.searchParams.set("include_person", options.includePerson.toString());
    }
    if (options.normalizedBoxes !== undefined) {
      url.searchParams.set("normalized_boxes", options.normalizedBoxes.toString());
    }
    if (options.includeMasks !== undefined) {
      url.searchParams.set("include_masks", options.includeMasks.toString());
    }
    // Preprocessing options for cluttered backgrounds
    if (options.preprocessing?.enhanceContrast) {
      url.searchParams.set("enhance_contrast", "true");
    }
    if (options.preprocessing?.enhanceSharpness) {
      url.searchParams.set("enhance_sharpness", "true");
    }
    if (options.preprocessing?.bilateralFilter) {
      url.searchParams.set("bilateral_filter", "true");
    }

    let failureCounted = false;
    try {
      const response = await fetch(url.toString(), {
        method: "POST",
        body: formData,
        signal: AbortSignal.timeout(this.detectTimeoutMs),
      });

      if (!response.ok) {
        const error = await response.text();
        this.circuit.onFailure();
        failureCounted = true;
        throw new Error(`Detection failed: ${response.status} - ${error}`);
      }

      const data = (await response.json()) as DetectionResponse;
      this.circuit.onSuccess();
      return data;
    } catch (e) {
      if (!failureCounted) this.circuit.onFailure();
      throw e;
    }
  }

  /**
   * Detect fashion items from a URL (downloads and sends to API)
   */
  async detectFromUrl(
    imageUrl: string,
    options: DetectOptions = {}
  ): Promise<DetectionResponse> {
    // Download image
    const response = await fetch(imageUrl, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const filename = imageUrl.split("/").pop() || "image.jpg";

    return this.detectFromBuffer(buffer, filename, options);
  }

  /**
   * Detect fashion items in multiple images
   */
  async detectBatch(
    images: Array<{ buffer: Buffer; filename: string }>,
    confidence?: number
  ): Promise<
    Array<{ filename: string; result?: DetectionResponse; error?: string }>
  > {
    const formData = new FormData();

    for (const img of images) {
      const uint8Array = new Uint8Array(img.buffer);
      const blob = new Blob([uint8Array], {
        type: this.getMimeType(img.filename),
      });
      formData.append("files", blob, img.filename);
    }

    const url = new URL(`${this.baseUrl}/detect/batch`);
    if (confidence !== undefined) {
      url.searchParams.set("confidence", confidence.toString());
    }

    const response = await fetch(url.toString(), {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(this.timeout * images.length),
    });

    if (!response.ok) {
      throw new Error(`Batch detection failed: ${response.status}`);
    }

    const result = await response.json();
    return result.results;
  }

  /**
   * Reload the YOLO model
   */
  async reload(): Promise<{ ok: boolean; message: string; num_classes: number }> {
    const response = await fetch(`${this.baseUrl}/reload`, {
      method: "POST",
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error(`Model reload failed: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Get MIME type from filename
   */
  private getMimeType(filename: string): string {
    const ext = filename.toLowerCase().split(".").pop();
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
// Singleton Instance
// ============================================================================

let clientInstance: YOLOv8Client | null = null;

export function getYOLOv8Client(): YOLOv8Client {
  if (!clientInstance) {
    clientInstance = new YOLOv8Client();
  }
  return clientInstance;
}

// ============================================================================
// Utility Functions
// ============================================================================

/** Intersection-over-union for axis-aligned pixel boxes. */
export function boundingBoxIou(a: BoundingBox, b: BoundingBox): number {
  const x1 = Math.max(a.x1, b.x1);
  const y1 = Math.max(a.y1, b.y1);
  const x2 = Math.min(a.x2, b.x2);
  const y2 = Math.min(a.y2, b.y2);
  const iw = Math.max(0, x2 - x1);
  const ih = Math.max(0, y2 - y1);
  const inter = iw * ih;
  const areaA = Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1);
  const areaB = Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
  const union = areaA + areaB - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Same-label dedup by IoU: keeps spatially separate instances (e.g. two dresses).
 * Within each label, sorts by confidence and drops a detection if it overlaps a kept one with IoU ≥ threshold.
 */
export function dedupeDetectionsBySameLabelIou(
  detections: Detection[],
  iouThreshold: number,
): Array<{ detection: Detection; originalIndex: number }> {
  const withIdx = detections.map((detection, originalIndex) => ({ detection, originalIndex }));
  const byLabel = new Map<string, typeof withIdx>();
  for (const row of withIdx) {
    const k = row.detection.label.toLowerCase();
    if (!byLabel.has(k)) byLabel.set(k, []);
    byLabel.get(k)!.push(row);
  }
  const kept: typeof withIdx = [];
  for (const group of byLabel.values()) {
    const sorted = [...group].sort((a, b) => b.detection.confidence - a.detection.confidence);
    const groupKept: typeof withIdx = [];
    for (const row of sorted) {
      const overlaps = groupKept.some(
        (k) => boundingBoxIou(row.detection.box, k.detection.box) >= iouThreshold,
      );
      if (!overlaps) groupKept.push(row);
    }
    kept.push(...groupKept);
  }
  kept.sort((a, b) => a.originalIndex - b.originalIndex);
  return kept;
}

/**
 * Filter detections by category
 */
export function filterByCategory(
  detections: Detection[],
  categories: string[]
): Detection[] {
  const categorySet = new Set(categories.map((c) => c.toLowerCase()));
  return detections.filter((d) => categorySet.has(d.label.toLowerCase()));
}

/**
 * Filter detections by minimum confidence
 */
export function filterByConfidence(
  detections: Detection[],
  minConfidence: number
): Detection[] {
  return detections.filter((d) => d.confidence >= minConfidence);
}

/**
 * Get the primary (largest) detection
 */
export function getPrimaryDetection(detections: Detection[]): Detection | null {
  if (detections.length === 0) return null;
  return detections.reduce((prev, curr) =>
    curr.area_ratio > prev.area_ratio ? curr : prev
  );
}

/**
 * Group detections by category
 */
export function groupByCategory(
  detections: Detection[]
): Record<string, Detection[]> {
  return detections.reduce(
    (acc, detection) => {
      const category = detection.label;
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(detection);
      return acc;
    },
    {} as Record<string, Detection[]>
  );
}

/**
 * Extract outfit composition from detections
 */
export function extractOutfitComposition(
  detections: Detection[]
): OutfitComposition {
  const tops: Detection[] = [];
  const bottoms: Detection[] = [];
  const dresses: Detection[] = [];
  const outerwear: Detection[] = [];
  const footwear: Detection[] = [];
  const bags: Detection[] = [];
  const accessories: Detection[] = [];

  for (const detection of detections) {
    const mapped = mapDetectionToCategory(detection.label, detection.confidence).productCategory;
    if (mapped === "tops") {
      tops.push(detection);
    } else if (mapped === "bottoms") {
      bottoms.push(detection);
    } else if (mapped === "dresses") {
      dresses.push(detection);
    } else if (mapped === "outerwear") {
      outerwear.push(detection);
    } else if (mapped === "footwear") {
      footwear.push(detection);
    } else if (mapped === "bags") {
      bags.push(detection);
    } else if (mapped === "accessories") {
      accessories.push(detection);
    }
  }

  return { tops, bottoms, dresses, outerwear, footwear, bags, accessories };
}
