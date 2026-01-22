/**
 * YOLOv8 Fashion Detection Client
 *
 * TypeScript client for the YOLOv8 Fashion Detection API.
 * Provides type-safe methods for detecting fashion items in images.
 */

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

export interface Detection {
  label: string;
  raw_label: string;
  confidence: number;
  box: BoundingBox;
  box_normalized: BoundingBox;
  area_ratio: number;
  style?: StyleInfo;
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

export interface DetectOptions {
  confidence?: number;
  includePerson?: boolean;
  normalizedBoxes?: boolean;
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

export class YOLOv8Client {
  private baseUrl: string;
  private timeout: number;

  constructor(baseUrl?: string, timeout?: number) {
    this.baseUrl =
      baseUrl || process.env.YOLOV8_SERVICE_URL || "http://localhost:8001";
    this.timeout = timeout || 30000;
  }

  /**
   * Check if the YOLO service is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const health = await this.health();
      return health.ok && health.model_loaded;
    } catch {
      return false;
    }
  }

  /**
   * Health check endpoint
   */
  async health(): Promise<HealthResponse> {
    const response = await fetch(`${this.baseUrl}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Get all supported fashion categories and their style attributes
   */
  async getLabels(): Promise<LabelsResponse> {
    const response = await fetch(`${this.baseUrl}/labels`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
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

    const response = await fetch(url.toString(), {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Detection failed: ${response.status} - ${error}`);
    }

    return response.json();
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
  const tops = filterByCategory(detections, [
    "shirt",
    "tshirt",
    "blouse",
    "sweater",
    "hoodie",
    "sweatshirt",
    "cardigan",
    "tank_top",
    "crop_top",
    "top",
  ]);

  const bottoms = filterByCategory(detections, [
    "jeans",
    "pants",
    "shorts",
    "skirt",
    "leggings",
  ]);

  const dresses = filterByCategory(detections, [
    "dress",
    "gown",
    "maxi_dress",
    "mini_dress",
    "midi_dress",
  ]);

  const outerwear = filterByCategory(detections, [
    "jacket",
    "coat",
    "blazer",
    "parka",
    "bomber",
  ]);

  const footwear = filterByCategory(detections, [
    "sneakers",
    "boots",
    "heels",
    "sandals",
    "loafers",
    "flats",
  ]);

  const bags = filterByCategory(detections, [
    "bag",
    "backpack",
    "clutch",
    "tote",
    "crossbody",
  ]);

  const accessories = filterByCategory(detections, [
    "hat",
    "sunglasses",
    "watch",
    "belt",
    "tie",
    "scarf",
    "gloves",
    "necklace",
    "bracelet",
    "earrings",
    "ring",
    "jewelry",
  ]);

  return { tops, bottoms, dresses, outerwear, footwear, bags, accessories };
}
