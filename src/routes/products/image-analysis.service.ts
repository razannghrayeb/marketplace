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
  computePHash,
  validateImage,
  isClipAvailable,
} from "../../lib/image";
import { hybridSearch } from "../../lib/search";
import {
  YOLOv8Client,
  getYOLOv8Client,
  extractOutfitComposition,
  Detection,
  OutfitComposition,
  BoundingBox,
} from "../../lib/image/yolov8Client";
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
import {
  computeOutfitCoherence,
  type OutfitCoherenceResult,
  type DetectionWithColor,
} from "../../lib/detection/outfitCoherence";

// `sharp` is CommonJS callable. TS interop can cause `import sharp from "sharp"`
// to produce a non-callable object at runtime, so we guard it.
const sharp: any =
  typeof sharpLib === "function" ? sharpLib : (sharpLib as any).default;

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
  };
}

export interface AnalyzeOptions {
  /** Store image in R2 (default: true) */
  store?: boolean;

  /** Generate CLIP embedding (default: true) */
  generateEmbedding?: boolean;

  /** Run YOLO detection (default: true) */
  runDetection?: boolean;

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
  };
  /** Mapped product category */
  category: string;
  /** Similar products for this detection */
  products: ProductResult[];
  /** Number of similar products found */
  count: number;
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

  /** Group results by detection (default: true) */
  groupByDetection?: boolean;
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
  async getServiceStatus(): Promise<{ clip: boolean; yolo: boolean; blip: boolean }> {
    const [clipAvailable, yoloAvailable] = await Promise.all([
      Promise.resolve(isClipAvailable()),
      this.yoloClient.isAvailable().catch(() => false),
    ]);

    // BLIP availability is checked on-demand by hybridSearch
    return {
      clip: clipAvailable,
      yolo: yoloAvailable,
      blip: true, // hybridSearch gracefully degrades if BLIP unavailable
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

    // Run operations in parallel where possible
    const [storageResult, embeddingResult, detectionResult] = await Promise.all([
      // Storage
      store ? this.storeImage(buffer, filename, productId, isPrimary, pHash) : null,

      // CLIP embedding (processImageForEmbedding handles the preprocessing)
      generateEmbedding && services.clip
        ? processImageForEmbedding(buffer).catch((err) => {
            console.error("CLIP embedding failed:", err);
            return null;
          })
        : null,

      // YOLO detection
      runDetection && services.yolo
        ? this.yoloClient
            .detectFromBuffer(buffer, filename, { confidence })
            .catch((err) => {
              console.error("YOLO detection failed:", err);
              return null;
            })
        : null,
    ]);

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
      embedding: embeddingResult,
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
      if (!analysisResult.embedding) {
        return {
          ...analysisResult,
          similarProducts: { byDetection: [], totalProducts: 0, threshold: similarityThreshold, detectedCategories: [] },
        };
      }
      const fallback = await searchByImageWithSimilarity({
        imageEmbedding: analysisResult.embedding,
        filters: {},
        limit: similarLimitPerItem,
        similarityThreshold,
      });
      return {
        ...analysisResult,
        similarProducts: {
          byDetection: fallback.results.length > 0 ? [{
            detection: { label: "full_image", confidence: 1.0, box: { x1: 0, y1: 0, x2: imageWidth, y2: imageHeight }, area_ratio: 1.0 },
            category: "all",
            products: fallback.results,
            count: fallback.results.length,
          }] : [],
          totalProducts: fallback.results.length,
          threshold: similarityThreshold,
          detectedCategories: [],
        },
      };
    }

    // Extract detected categories
    const detectedCategories = [...new Set(
      analysisResult.detection.items.map((item) => item.label)
    )];

    // Group detections by label (to avoid duplicate searches for same category)
    const detectionsByLabel = new Map<string, Detection>();
    for (const detection of analysisResult.detection.items) {
      // Keep only the detection with highest confidence for each label
      const existing = detectionsByLabel.get(detection.label);
      if (!existing || detection.confidence > existing.confidence) {
        detectionsByLabel.set(detection.label, detection);
      }
    }

    // Process all detections in parallel for significant latency reduction.
    // CLIP inference serializes at the ONNX level, but cropping, BLIP captions,
    // and OpenSearch kNN queries all benefit from concurrent execution.
    const searchTasks = [...detectionsByLabel].map(async ([label, detection]) => {
      const box = detection.box;
      const cropWidth = Math.max(1, Math.round(box.x2 - box.x1));
      const cropHeight = Math.max(1, Math.round(box.y2 - box.y1));
      const cropLeft = Math.max(0, Math.round(box.x1));
      const cropTop = Math.max(0, Math.round(box.y1));
      const safeWidth = Math.min(cropWidth, imageWidth - cropLeft);
      const safeHeight = Math.min(cropHeight, imageHeight - cropTop);

      if (safeWidth < 10 || safeHeight < 10) return null;

      const croppedBuffer = await sharp(buffer)
        .extract({ left: cropLeft, top: cropTop, width: safeWidth, height: safeHeight })
        .toBuffer();

      const vectors = await hybridSearch.buildQueryVectors(croppedBuffer, buffer);
      const finalEmbedding = hybridSearch.fuseVectors(vectors);

      const categoryMapping = mapDetectionToCategory(label, detection.confidence);
      const searchCategories = shouldUseAlternatives(categoryMapping)
        ? getSearchCategories(categoryMapping)
        : [categoryMapping.productCategory];

      const filters: Partial<import("./types").SearchFilters> = {};
      if (filterByDetectedCategory) {
        filters.category = searchCategories.length === 1
          ? searchCategories[0]
          : searchCategories;
      }

      const similarResult = await searchByImageWithSimilarity({
        imageEmbedding: finalEmbedding,
        filters,
        limit: similarLimitPerItem,
        similarityThreshold,
      });

      if (similarResult.results.length === 0) return null;

      return {
        detection: {
          label: detection.label,
          confidence: detection.confidence,
          box: detection.box,
          area_ratio: detection.area_ratio,
          style: detection.style,
        },
        category: categoryMapping.productCategory,
        products: similarResult.results,
        count: similarResult.results.length,
      } as DetectionSimilarProducts;
    });

    const settled = await Promise.allSettled(searchTasks);
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

    // Sort by detection confidence (highest first)
    groupedResults.sort((a, b) => b.detection.confidence - a.detection.confidence);

    // Compute outfit coherence for all detected items
    const outfitCoherence = analysisResult.detection?.items.length
      ? computeOutfitCoherence(analysisResult.detection.items as DetectionWithColor[])
      : undefined;

    return {
      ...analysisResult,
      similarProducts: {
        byDetection: groupedResults,
        totalProducts,
        threshold: similarityThreshold,
        detectedCategories,
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

    return {
      success: result.success,
      items: result.detections,
      count: result.count,
      summary: result.summary,
      composition: extractOutfitComposition(result.detections),
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

    return {
      success: result.success,
      items: result.detections,
      count: result.count,
      summary: result.summary,
      composition: extractOutfitComposition(result.detections),
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
            items: r.result.detections,
            count: r.result.count,
            summary: r.result.summary,
            composition: extractOutfitComposition(r.result.detections),
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

    // Combine YOLO + user detections
    const allItemsToProcess = [...itemsToProcess, ...userDetections];

    // Process each item for similar products
    const groupedResults: SelectiveDetectionResult[] = [];
    let totalProducts = 0;

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

        const vectors = await hybridSearch.buildQueryVectors(croppedBuffer, buffer);
        const finalEmbedding = hybridSearch.fuseVectors(vectors);

        // Get category from user hint or detection
        const categorySource =
          isUserDefined && userDefinedBoxes[i - itemsToProcess.length].categoryHint
            ? userDefinedBoxes[i - itemsToProcess.length].categoryHint!
            : detection.label;
        const categoryMapping = mapDetectionToCategory(categorySource, detection.confidence);

        const filters: Record<string, string> = {};
        if (options.filterByDetectedCategory !== false) {
          filters.category = categoryMapping.productCategory;
        }

        const similarResult = await searchByImageWithSimilarity({
          imageEmbedding: finalEmbedding,
          filters,
          limit: options.similarLimitPerItem || 10,
          similarityThreshold: options.similarityThreshold || 0.7,
        });

        if (similarResult.results.length > 0) {
          groupedResults.push({
            detection: {
              label: detection.label,
              confidence: detection.confidence,
              box: detection.box,
              area_ratio: detection.area_ratio,
              style: detection.style,
            },
            category: categoryMapping.productCategory,
            products: similarResult.results,
            count: similarResult.results.length,
            source: isUserDefined ? "user_defined" : "yolo",
            originalIndex: isUserDefined ? undefined : originalIndices[i],
          });
          totalProducts += similarResult.results.length;
        }
      } catch (err) {
        console.error(`Failed to process detection ${detection.label}:`, err);
      }
    }

    // Compute outfit coherence
    const outfitCoherence = allItemsToProcess.length
      ? computeOutfitCoherence(allItemsToProcess as DetectionWithColor[])
      : undefined;

    return {
      ...fullResult,
      similarProducts: {
        byDetection: groupedResults,
        totalProducts,
        threshold: options.similarityThreshold || 0.7,
        detectedCategories: [...new Set(groupedResults.map((r) => r.category))],
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
