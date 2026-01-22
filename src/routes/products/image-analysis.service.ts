/**
 * Unified Image Analysis Service
 *
 * Single entry point for image uploads that provides:
 * - Image storage (R2)
 * - CLIP embeddings for similarity search
 * - YOLOv8 fashion detection
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
import {
  YOLOv8Client,
  getYOLOv8Client,
  extractOutfitComposition,
  Detection,
  OutfitComposition,
} from "../../lib/image/yolov8Client";
import { searchByImageWithSimilarity } from "./search.service";
import { ProductResult } from "./types";
import sharp from "sharp";
import crypto from "crypto";

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
  };
}

export interface AnalyzeOptions {
  /** Store image in R2 (default: true) */
  store?: boolean;

  /** Generate CLIP embedding (default: true) */
  generateEmbedding?: boolean;

  /** Run YOLO detection (default: true) */
  runDetection?: boolean;

  /** Detection confidence threshold (default: 0.25) */
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
  async getServiceStatus(): Promise<{ clip: boolean; yolo: boolean }> {
    const [clipAvailable, yoloAvailable] = await Promise.all([
      Promise.resolve(isClipAvailable()),
      this.yoloClient.isAvailable().catch(() => false),
    ]);

    return {
      clip: clipAvailable,
      yolo: yoloAvailable,
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
      confidence = 0.25,
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

    // If no detection results or similarity search disabled, return early
    if (!findSimilar || !analysisResult.detection || analysisResult.detection.items.length === 0) {
      return {
        ...analysisResult,
        similarProducts: {
          byDetection: [],
          totalProducts: 0,
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

    // For each unique detection, crop the region and find similar products
    const groupedResults: DetectionSimilarProducts[] = [];
    let totalProducts = 0;

    for (const [label, detection] of detectionsByLabel) {
      try {
        // Crop the detected region from the image
        const box = detection.box;
        const cropWidth = Math.max(1, Math.round(box.x2 - box.x1));
        const cropHeight = Math.max(1, Math.round(box.y2 - box.y1));
        const cropLeft = Math.max(0, Math.round(box.x1));
        const cropTop = Math.max(0, Math.round(box.y1));

        // Ensure crop is within image bounds
        const safeWidth = Math.min(cropWidth, imageWidth - cropLeft);
        const safeHeight = Math.min(cropHeight, imageHeight - cropTop);

        if (safeWidth < 10 || safeHeight < 10) {
          // Skip very small detections
          continue;
        }

        // Crop and generate embedding for this detection
        const croppedBuffer = await sharp(buffer)
          .extract({
            left: cropLeft,
            top: cropTop,
            width: safeWidth,
            height: safeHeight,
          })
          .toBuffer();

        const croppedEmbedding = await processImageForEmbedding(croppedBuffer);

        // Map detection to product category for filtering
        const category = this.mapDetectionToCategory(label);

        // Search for similar products with category filter
        const filters: Record<string, string> = {};
        if (filterByDetectedCategory) {
          filters.category = category;
        }

        const similarResult = await searchByImageWithSimilarity({
          imageEmbedding: croppedEmbedding,
          filters,
          limit: similarLimitPerItem,
          similarityThreshold,
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
            category,
            products: similarResult.results,
            count: similarResult.results.length,
          });
          totalProducts += similarResult.results.length;
        }
      } catch (err) {
        console.error(`Failed to find similar products for ${label}:`, err);
        // Continue with other detections
      }
    }

    // Sort by detection confidence (highest first)
    groupedResults.sort((a, b) => b.detection.confidence - a.detection.confidence);

    return {
      ...analysisResult,
      similarProducts: {
        byDetection: groupedResults,
        totalProducts,
        threshold: similarityThreshold,
        detectedCategories,
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
   */
  private mapDetectionToCategory(detectionLabel: string): string {
    const categoryMap: Record<string, string> = {
      // Tops
      shirt: "tops",
      tshirt: "tops",
      blouse: "tops",
      sweater: "tops",
      hoodie: "tops",
      cardigan: "tops",
      tank_top: "tops",
      crop_top: "tops",
      top: "tops",
      // Bottoms
      jeans: "bottoms",
      pants: "bottoms",
      shorts: "bottoms",
      skirt: "bottoms",
      leggings: "bottoms",
      // Dresses
      dress: "dresses",
      gown: "dresses",
      maxi_dress: "dresses",
      mini_dress: "dresses",
      midi_dress: "dresses",
      jumpsuit: "dresses",
      romper: "dresses",
      // Outerwear
      jacket: "outerwear",
      coat: "outerwear",
      blazer: "outerwear",
      parka: "outerwear",
      bomber: "outerwear",
      vest: "outerwear",
      // Footwear
      sneakers: "footwear",
      boots: "footwear",
      heels: "footwear",
      sandals: "footwear",
      loafers: "footwear",
      flats: "footwear",
      // Bags
      bag: "bags",
      backpack: "bags",
      clutch: "bags",
      tote: "bags",
      crossbody: "bags",
      // Accessories
      hat: "accessories",
      sunglasses: "accessories",
      watch: "accessories",
      belt: "accessories",
      tie: "accessories",
      scarf: "accessories",
      jewelry: "accessories",
      necklace: "accessories",
      bracelet: "accessories",
      earrings: "accessories",
    };

    return categoryMap[detectionLabel.toLowerCase()] || detectionLabel;
  }

  /**
   * Quick detection only - no storage, no embedding
   *
   * Use this when you just need to know what fashion items are in an image.
   */
  async quickDetect(
    buffer: Buffer,
    filename: string,
    confidence: number = 0.25
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
    confidence: number = 0.25
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
