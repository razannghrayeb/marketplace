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
import * as path from "path";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

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
  runtime_device?: string;
  cuda_available?: boolean;
  cuda_device_name?: string;
  cuda_device_count?: number;
  configured_device?: string;
  requested_device?: string;
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
const YOLO_PROTO_PATH = path.resolve(process.cwd(), "src", "lib", "model", "proto", "yolo.proto");

type GrpcYoloClient = {
  Health: (
    request: Record<string, never>,
    metadata: grpc.Metadata,
    options: grpc.CallOptions,
    callback: (err: grpc.ServiceError | null, response: any) => void,
  ) => void;
  Detect: (
    request: Record<string, unknown>,
    metadata: grpc.Metadata,
    options: grpc.CallOptions,
    callback: (err: grpc.ServiceError | null, response: any) => void,
  ) => void;
};

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

function yoloTransport(): "http" | "grpc" | "auto" {
  const raw = String(process.env.YOLO_TRANSPORT ?? "auto").toLowerCase().trim();
  return raw === "grpc" || raw === "http" || raw === "auto" ? raw : "auto";
}

function resolveYoloGrpcAddress(): string {
  return process.env.YOLO_GRPC_ADDRESS?.trim() || "127.0.0.1:50052";
}

let grpcClient: GrpcYoloClient | null = null;

function getGrpcClient(): GrpcYoloClient {
  if (grpcClient) return grpcClient;
  const packageDefinition = protoLoader.loadSync(YOLO_PROTO_PATH, {
    keepCase: false,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const proto = grpc.loadPackageDefinition(packageDefinition) as any;
  const Ctor = proto.marketplace.yolo.v1.YoloDetector;
  grpcClient = new Ctor(resolveYoloGrpcAddress(), grpc.credentials.createInsecure()) as GrpcYoloClient;
  return grpcClient;
}

function boxFromGrpc(box: any): BoundingBox {
  return {
    x1: Number(box?.x1 ?? 0),
    y1: Number(box?.y1 ?? 0),
    x2: Number(box?.x2 ?? 0),
    y2: Number(box?.y2 ?? 0),
  };
}

function detectionResponseFromGrpc(response: any): DetectionResponse {
  const summary: Record<string, number> = {};
  const rows = Array.isArray(response?.summary) ? response.summary : [];
  for (const row of rows) {
    const label = String(row?.label ?? "");
    if (label) summary[label] = Number(row?.count ?? 0);
  }
  return {
    success: Boolean(response?.success),
    detections: (Array.isArray(response?.detections) ? response.detections : []).map((d: any) => ({
      label: String(d?.label ?? ""),
      raw_label: String(d?.rawLabel ?? d?.raw_label ?? d?.label ?? ""),
      confidence: Number(d?.confidence ?? 0),
      box: boxFromGrpc(d?.box),
      box_normalized: boxFromGrpc(d?.boxNormalized ?? d?.box_normalized),
      area_ratio: Number(d?.areaRatio ?? d?.area_ratio ?? 0),
    })),
    count: Number(response?.count ?? 0),
    image_size: {
      width: Number(response?.imageSize?.width ?? response?.image_size?.width ?? 0),
      height: Number(response?.imageSize?.height ?? response?.image_size?.height ?? 0),
    },
    model: String(response?.model ?? "dual-detector-v1"),
    summary,
  };
}

export class YOLOv8Client {
  private baseUrl: string;
  private grpcAddress: string;
  private transport: "http" | "grpc" | "auto";
  /** Batch / reload long operations */
  private timeout: number;
  private detectTimeoutMs: number;
  private runtimeLogged = false;
  private readonly circuit = new YoloCircuitBreaker();

  constructor(baseUrl?: string, timeout?: number) {
    this.baseUrl = resolveYoloServiceBaseUrl(baseUrl);
    this.grpcAddress = resolveYoloGrpcAddress();
    this.transport = yoloTransport();
    this.timeout = timeout || 30000;
    this.detectTimeoutMs = yoloDetectTimeoutMs();
    console.info(
      `[YOLOv8] client: transport=${this.transport} grpc=${this.grpcAddress} http=${this.baseUrl} ` +
        `(YOLOV8_SERVICE_URL canonical; YOLO_API_URL deprecated alias); detect timeout=${this.detectTimeoutMs}ms`,
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
      if (!this.runtimeLogged) {
        this.runtimeLogged = true;
        const runtimeDevice = health.runtime_device || "unknown";
        const cuda = typeof health.cuda_available === "boolean" ? String(health.cuda_available) : "unknown";
        const cudaName = health.cuda_device_name || "n/a";
        console.info(
          `[YOLOv8] runtime device=${runtimeDevice} cuda_available=${cuda} cuda_device=${cudaName}`
        );
      }
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
    if (this.transport === "grpc" || this.transport === "auto") {
      try {
        return await this.grpcHealth();
      } catch (e) {
        if (this.transport === "grpc") throw e;
      }
    }

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

  private grpcHealth(): Promise<HealthResponse> {
    return new Promise((resolve, reject) => {
      try {
        getGrpcClient().Health(
          {},
          new grpc.Metadata(),
          { deadline: Date.now() + yoloReadinessTimeoutMs() },
          (err, response) => {
            if (err) return reject(err);
            resolve({
              ok: Boolean(response?.ok),
              model_path: String(response?.modelPath ?? response?.model_path ?? ""),
              model_loaded: Boolean(response?.modelLoaded ?? response?.model_loaded),
              runtime_device: String(response?.runtimeDevice ?? response?.runtime_device ?? "unknown"),
              cuda_available: Boolean(response?.cudaAvailable ?? response?.cuda_available),
              cuda_device_name: String(response?.cudaDeviceName ?? response?.cuda_device_name ?? ""),
              cuda_device_count: Number(response?.cudaDeviceCount ?? response?.cuda_device_count ?? 0),
              configured_device: String(response?.configuredDevice ?? response?.configured_device ?? "") || undefined,
              requested_device: String(response?.requestedDevice ?? response?.requested_device ?? "") || undefined,
              num_classes: Number(response?.numClasses ?? response?.num_classes ?? 0),
              class_names: Array.isArray(response?.classNames)
                ? response.classNames.map(String)
                : Array.isArray(response?.class_names)
                  ? response.class_names.map(String)
                  : [],
              config: {
                confidence_threshold: 0.6,
                iou_threshold: 0,
                max_detections: 300,
                min_box_area_ratio: 0,
              },
            });
          },
        );
      } catch (error) {
        reject(error);
      }
    });
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

    if (this.transport === "grpc" || this.transport === "auto") {
      try {
        const data = await this.grpcDetectFromBuffer(imageBuffer, filename, options);
        this.circuit.onSuccess();
        return data;
      } catch (e) {
        if (this.transport === "grpc") {
          this.circuit.onFailure();
          throw e;
        }
      }
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

  private grpcDetectFromBuffer(
    imageBuffer: Buffer,
    filename: string,
    options: DetectOptions,
  ): Promise<DetectionResponse> {
    return new Promise((resolve, reject) => {
      try {
        getGrpcClient().Detect(
          {
            imageBytes: imageBuffer,
            filename,
            confidence: Number(options.confidence ?? 0.6),
            enhanceContrast: Boolean(options.preprocessing?.enhanceContrast),
            enhanceSharpness: Boolean(options.preprocessing?.enhanceSharpness),
            bilateralFilter: Boolean(options.preprocessing?.bilateralFilter),
          },
          new grpc.Metadata(),
          { deadline: Date.now() + this.detectTimeoutMs },
          (err, response) => {
            if (err) return reject(err);
            resolve(detectionResponseFromGrpc(response));
          },
        );
      } catch (error) {
        reject(error);
      }
    });
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
    const groupLabel = String(group[0]?.detection.label ?? "").toLowerCase();
    const isTopLikeLabel = /\b(top|shirt|blouse|tee|t-?shirt|tank|cami|camisole|sleeveless|vest)\b/.test(groupLabel);
    const sorted = [...group].sort((a, b) => b.detection.confidence - a.detection.confidence);
    const groupKept: typeof withIdx = [];
    for (const row of sorted) {
      const overlaps = groupKept.some((k) => {
        const iou = boundingBoxIou(row.detection.box, k.detection.box);
        if (iou < iouThreshold) return false;

        if (!isTopLikeLabel) return true;

        // Keep layered top instances (e.g., shirt over tank) when one box is
        // substantially smaller than the other, even if IoU is high.
        const rowArea = Math.max(0, row.detection.box.x2 - row.detection.box.x1) * Math.max(0, row.detection.box.y2 - row.detection.box.y1);
        const keptArea = Math.max(0, k.detection.box.x2 - k.detection.box.x1) * Math.max(0, k.detection.box.y2 - k.detection.box.y1);
        const minArea = Math.min(rowArea, keptArea);
        const maxArea = Math.max(rowArea, keptArea);
        const relativeArea = maxArea > 0 ? minArea / maxArea : 1;

        if (relativeArea <= 0.72 && iou <= 0.88) {
          return false;
        }

        return true;
      });
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
    const mapped = mapDetectionToCategory(detection.label, detection.confidence, {
      box_normalized: (detection as any).box_normalized,
    }).productCategory;
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
