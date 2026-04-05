/**
 * Unified Image Analysis Controller
 *
 * Provides a single, organized API for all image operations:
 *
 * POST /api/images/analyze           - Full analysis (store + embed + detect)
 * POST /api/images/search            - Detect + find similar products (main endpoint!)
 * POST /api/images/search/selective  - Search with selective item processing
 * POST /api/images/search/url        - Find similar from URL
 * POST /api/images/detect            - Quick detection only
 * POST /api/images/detect/url        - Detection from URL
 * POST /api/images/detect/batch      - Batch detection
 * GET  /api/images/status            - Service health status
 * GET  /api/images/labels            - Supported fashion categories
 */

import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import {
  ImageAnalysisService,
  getImageAnalysisService,
  SelectiveAnalysisOptions,
  UserDefinedBox,
} from "./image-analysis.service";
import { getYOLOv8Client } from "../../lib/image/yolov8Client";

const router = Router();

// Multer configuration for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
    files: 10, // Max 10 files for batch
  },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error("Invalid file type. Only JPEG, PNG, WebP, and GIF are allowed.")
      );
    }
  },
});

const analysisService = getImageAnalysisService();
const yoloClient = getYOLOv8Client();

/** Accept common frontend field names for the outfit / person photo */
const IMAGE_UPLOAD_FIELDS = [
  { name: "image", maxCount: 1 },
  { name: "file", maxCount: 1 },
  { name: "photo", maxCount: 1 },
  { name: "outfit", maxCount: 1 },
] as const;

function pickImageFile(req: Request): Express.Multer.File | undefined {
  const map = req.files as { [field: string]: Express.Multer.File[] } | undefined;
  if (map) {
    for (const { name } of IMAGE_UPLOAD_FIELDS) {
      const f = map[name]?.[0];
      if (f?.buffer?.length) return f;
    }
  }
  const f = req.file;
  return f?.buffer?.length ? f : undefined;
}

function parsePositiveInt(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === "string") {
    const v = value.trim();
    if (!/^\d+$/.test(v)) return null;
    const n = parseInt(v, 10);
    return n > 0 ? n : null;
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ============================================================================
// Routes
// ============================================================================

/**
 * @route GET /api/images/status
 * @desc Check availability of image analysis services
 * @access Public
 *
 * @example Response:
 * {
 *   "ok": true,
 *   "services": {
 *     "clip": true,
 *     "yolo": true,
 *     "blip": true,
 *     "yoloHint": "optional when yolo is false — local dev / ops guidance"
 *   }
 * }
 */
router.get("/status", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const services = await analysisService.getServiceStatus();
    res.json({
      ok: true,
      services,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/images/labels
 * @desc Get all supported fashion categories for detection
 * @access Public
 */
router.get("/labels", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const labels = await yoloClient.getLabels();
    res.json(labels);
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/images/analyze
 * @desc Full image analysis pipeline (recommended for initial uploads)
 * @access Public
 *
 * @body multipart/form-data
 *   - image: File (required)
 *
 * @query
 *   - store: boolean (default: true) - Store image in R2
 *   - embed: boolean (default: true) - Generate CLIP embedding
 *   - detect: boolean (default: true) - Run fashion detection
 *   - confidence: number (default: 0.25) - Detection confidence threshold
 *   - product_id: number (optional) - Associate with product
 *   - is_primary: boolean (default: false) - Set as primary product image
 *
 * @example Response:
 * {
 *   "success": true,
 *   "image": { "id": 123, "url": "https://...", "width": 800, "height": 1200 },
 *   "embedding": [0.1, 0.2, ...],
 *   "detection": {
 *     "items": [...],
 *     "count": 5,
 *     "summary": { "shirt": 1, "jeans": 1, ... },
 *     "composition": { "tops": [...], "bottoms": [...], ... }
 *   },
 *   "services": { "clip": true, "yolo": true, "blip": true }
 * }
 */
router.post(
  "/analyze",
  upload.fields([...IMAGE_UPLOAD_FIELDS]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const imageFile = pickImageFile(req);
      if (!imageFile) {
        return res.status(400).json({
          success: false,
          error:
            "No image file provided. Use multipart field: image, file, photo, or outfit.",
        });
      }

      const options = {
        store: req.query.store !== "false",
        generateEmbedding: req.query.embed !== "false",
        runDetection: req.query.detect !== "false",
        confidence: req.query.confidence
          ? parseFloat(req.query.confidence as string)
          : 0.25,
        productId: req.query.product_id
          ? parseInt(req.query.product_id as string, 10)
          : undefined,
        isPrimary: req.query.is_primary === "true",
      };

      const result = await analysisService.analyzeImage(
        imageFile.buffer,
        imageFile.originalname,
        options
      );

      return res.json({
        success: true,
        ...result,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route POST /api/images/search
 * @desc ⭐ Main endpoint: Detect fashion items + find similar products GROUPED BY ITEM
 * @access Public
 *
 * This is the primary endpoint for "shop by image" functionality.
 * It detects what's in the image and returns similar products for EACH detected item.
 * Also includes outfit coherence analysis showing how well items go together.
 *
 * @body multipart/form-data
 *   - image: File (required)
 *
 * @query
 *   - store: boolean (default: false) - Store image in R2
 *   - threshold: number (default: 0.63) - Similarity threshold 0-1
 *   - limit_per_item: number (optional) - Max similar products per detection (backend default when omitted)
 *   - products_page: number (optional, default: 1) - Page for per-detection products
 *   - products_limit: number (optional) - Page size for per-detection products
 *   - detections_page: number (optional, default: 1) - Page for detection groups
 *   - detections_limit: number (optional) - Page size for detection groups
 *   - filter_category: boolean (default: true) - Filter by detected category
 *   - confidence: number (default: 0.25) - Detection confidence
 *   - enhance_contrast: boolean (default: false) - Preprocess: enhance contrast
 *   - enhance_sharpness: boolean (default: false) - Preprocess: enhance sharpness
 *   - bilateral_filter: boolean (default: false) - Preprocess: noise reduction
 *
 * @example Response:
 * {
 *   "success": true,
 *   "detection": {
 *     "items": [{ "label": "dress", "confidence": 0.92, ... }],
 *     "count": 3,
 *     "summary": { "dress": 1, "heels": 1, "bag": 1 }
 *   },
 *   "similarProducts": {
 *     "byDetection": [
 *       {
 *         "detection": { "label": "dress", "confidence": 0.92, ... },
 *         "category": "dresses",
 *         "products": [{ "id": 123, "title": "Floral Midi Dress", ... }],
 *         "count": 10
 *       }
 *     ],
 *     "totalProducts": 18,
 *     "threshold": 0.7,
 *     "detectedCategories": ["dress", "heels", "bag"]
 *   },
 *   "outfitCoherence": {
 *     "overallScore": 0.85,
 *     "pairwiseScores": [...],
 *     "categoryAnalysis": { "hasTop": false, "hasDress": true, "hasFootwear": true, ... },
 *     "styleAnalysis": { "dominantOccasion": "semi-formal", "formalityRange": [5, 8], ... },
 *     "recommendations": ["Well-coordinated outfit!"]
 *   }
 * }
 */
router.post(
  "/search",
  upload.fields([...IMAGE_UPLOAD_FIELDS]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const imageFile = pickImageFile(req);
      if (!imageFile) {
        return res.status(400).json({
          success: false,
          error:
            "No image file provided. Use multipart field: image, file, photo, or outfit.",
        });
      }

      const baseLimitPerItem = parsePositiveInt(req.query.limit_per_item);
      const productsPage = parsePositiveInt(req.query.products_page) ?? 1;
      const productsLimitRaw = parsePositiveInt(req.query.products_limit);
      const productsPaginationEnabled =
        req.query.products_page !== undefined || req.query.products_limit !== undefined;
      const productsLimit = clamp(productsLimitRaw ?? baseLimitPerItem ?? 22, 1, 80);
      const productsOffset = (productsPage - 1) * productsLimit;
      const fetchLimitPerItem = productsPaginationEnabled
        ? clamp(productsLimit * productsPage, 1, 80)
        : baseLimitPerItem ?? undefined;

      const detectionsPage = parsePositiveInt(req.query.detections_page) ?? 1;
      const detectionsLimitRaw = parsePositiveInt(req.query.detections_limit);
      const detectionsPaginationEnabled =
        req.query.detections_page !== undefined || req.query.detections_limit !== undefined;

      const options = {
        store: req.query.store === "true",
        generateEmbedding: true,
        runDetection: true,
        findSimilar: true,
        confidence: req.query.confidence
          ? parseFloat(req.query.confidence as string)
          : 0.25,
        similarityThreshold: req.query.threshold
          ? parseFloat(req.query.threshold as string)
          : 0.63,
        similarLimitPerItem: fetchLimitPerItem,
        resultsPage: req.query.products_page
          ? parseInt(req.query.products_page as string, 10)
          : undefined,
        resultsPageSize: req.query.products_limit
          ? parseInt(req.query.products_limit as string, 10)
          : undefined,
        filterByDetectedCategory: req.query.filter_category !== "false",
        groupByDetection: req.query.group_by_detection !== "false",
        includeEmptyDetectionGroups: req.query.include_empty_groups === "true",
        preprocessing:
          req.query.enhance_contrast === "true" ||
          req.query.enhance_sharpness === "true" ||
          req.query.bilateral_filter === "true"
            ? {
                enhanceContrast: req.query.enhance_contrast === "true",
                enhanceSharpness: req.query.enhance_sharpness === "true",
                bilateralFilter: req.query.bilateral_filter === "true",
              }
            : undefined,
      };

      const result = await analysisService.analyzeAndFindSimilar(
        imageFile.buffer,
        imageFile.originalname,
        options
      );

      // Don't expose raw embedding to clients
      const { embedding, ...safeResult } = result;

      const payload = safeResult as any;
      if (payload.similarProducts && Array.isArray(payload.similarProducts.byDetection)) {
        const originalByDetection = payload.similarProducts.byDetection as Array<any>;

        const byDetectionAfterProductPaging = productsPaginationEnabled
          ? originalByDetection.map((row) => ({
              ...row,
              products: Array.isArray(row.products)
                ? row.products.slice(productsOffset, productsOffset + productsLimit)
                : [],
            }))
          : originalByDetection;

        const detectionsLimitBase =
          detectionsLimitRaw ??
          (byDetectionAfterProductPaging.length > 0
            ? byDetectionAfterProductPaging.length
            : 1);
        const detectionsLimit = clamp(detectionsLimitBase, 1, 200);
        const detectionsOffset = (detectionsPage - 1) * detectionsLimit;
        const finalByDetection = detectionsPaginationEnabled
          ? byDetectionAfterProductPaging.slice(
              detectionsOffset,
              detectionsOffset + detectionsLimit,
            )
          : byDetectionAfterProductPaging;

        payload.similarProducts.byDetection = finalByDetection;
        payload.similarProducts.totalProductsPage = finalByDetection.reduce(
          (sum: number, row: any) => sum + (Array.isArray(row.products) ? row.products.length : 0),
          0,
        );
        payload.similarProducts.pagination = {
          products: {
            enabled: productsPaginationEnabled,
            page: productsPage,
            limit: productsLimit,
            has_next: productsPaginationEnabled
              ? originalByDetection.some(
                  (row) => Array.isArray(row.products) && row.products.length > productsOffset + productsLimit,
                )
              : false,
          },
          detections: {
            enabled: detectionsPaginationEnabled,
            page: detectionsPage,
            limit: detectionsLimit,
            total: byDetectionAfterProductPaging.length,
            total_pages: Math.max(
              1,
              Math.ceil(byDetectionAfterProductPaging.length / detectionsLimit),
            ),
            has_next: detectionsPaginationEnabled
              ? detectionsOffset + finalByDetection.length < byDetectionAfterProductPaging.length
              : false,
            has_prev: detectionsPaginationEnabled ? detectionsPage > 1 : false,
          },
        };
      }

      return res.json({
        success: true,
        ...payload,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route POST /api/images/search/selective
 * @desc Search with selective item processing and user-defined regions
 * @access Public
 *
 * Allows users to:
 * - Select specific detected items to process (by index)
 * - Exclude certain items from processing
 * - Add custom bounding boxes for manual region detection
 *
 * @body multipart/form-data
 *   - image: File (required)
 *   - selection: JSON string with selection options (optional)
 *
 * @query
 *   - store: boolean (default: false)
 *   - threshold: number (default: 0.63)
 *   - limit_per_item: number (optional, backend default when omitted)
 *   - confidence: number (default: 0.25)
 *   - enhance_contrast: boolean (default: false)
 *   - enhance_sharpness: boolean (default: false)
 *   - bilateral_filter: boolean (default: false)
 *
 * @example selection JSON:
 * {
 *   "selectedItemIndices": [0, 2],
 *   "excludedItemIndices": [1],
 *   "userDefinedBoxes": [
 *     { "box": {"x1": 100, "y1": 200, "x2": 300, "y2": 500}, "categoryHint": "bags", "label": "handbag" }
 *   ]
 * }
 *
 * @example Response:
 * {
 *   "success": true,
 *   "detection": { ... },
 *   "similarProducts": {
 *     "byDetection": [
 *       { ..., "source": "yolo", "originalIndex": 0 },
 *       { ..., "source": "user_defined" }
 *     ]
 *   },
 *   "outfitCoherence": { ... }
 * }
 */
router.post(
  "/search/selective",
  upload.fields([...IMAGE_UPLOAD_FIELDS]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const imageFile = pickImageFile(req);
      if (!imageFile) {
        return res.status(400).json({
          success: false,
          error:
            "No image file provided. Use multipart field: image, file, photo, or outfit.",
        });
      }

      // Parse selection options from body
      let selectionOptions: Partial<SelectiveAnalysisOptions> = {};
      if (req.body.selection) {
        try {
          selectionOptions = JSON.parse(req.body.selection);
        } catch {
          return res.status(400).json({
            success: false,
            error: "Invalid selection JSON. Check syntax.",
          });
        }
      }

      // Build preprocessing options
      const preprocessing =
        req.query.enhance_contrast === "true" ||
        req.query.enhance_sharpness === "true" ||
        req.query.bilateral_filter === "true"
          ? {
              enhanceContrast: req.query.enhance_contrast === "true",
              enhanceSharpness: req.query.enhance_sharpness === "true",
              bilateralFilter: req.query.bilateral_filter === "true",
            }
          : undefined;

      const options: SelectiveAnalysisOptions = {
        store: req.query.store === "true",
        findSimilar: true,
        confidence: req.query.confidence
          ? parseFloat(req.query.confidence as string)
          : 0.25,
        similarityThreshold: req.query.threshold
          ? parseFloat(req.query.threshold as string)
          : 0.63,
        similarLimitPerItem: req.query.limit_per_item
          ? parseInt(req.query.limit_per_item as string, 10)
          : undefined,
        filterByDetectedCategory: req.query.filter_category !== "false",
        preprocessing,
        ...selectionOptions,
      };

      const result = await analysisService.analyzeWithSelection(
        imageFile.buffer,
        imageFile.originalname,
        options
      );

      const { embedding, ...safeResult } = result;

      return res.json({
        success: true,
        ...safeResult,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route POST /api/images/search/url
 * @desc Find similar products from an image URL, grouped by detection
 * @access Public
 *
 * @body JSON
 *   - url: string (required) - Image URL
 *
 * @query
 *   - threshold: number (default: 0.63) - Similarity threshold
 *   - limit_per_item: number (optional) - Max products per detection (backend default when omitted)
 *   - category: string (optional) - Filter by category
 */
router.post(
  "/search/url",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { url } = req.body;

      if (!url) {
        return res.status(400).json({
          success: false,
          error: "No image URL provided. Send JSON with 'url' field.",
        });
      }

      const result = await analysisService.findSimilarFromUrl(url, {
        similarityThreshold: req.query.threshold
          ? parseFloat(req.query.threshold as string)
          : 0.63,
        limitPerItem: req.query.limit_per_item
          ? parseInt(req.query.limit_per_item as string, 10)
          : undefined,
        filterByCategory: req.query.category as string,
      });

      return res.json({
        success: true,
        ...result,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route POST /api/images/detect
 * @desc Quick fashion detection only (no storage, no embedding)
 * @access Public
 *
 * @body multipart/form-data
 *   - image: File (required)
 *
 * @query
 *   - confidence: number (default: 0.25) - Detection confidence threshold
 *   - enhance_contrast: boolean (default: false) - Preprocess: enhance contrast
 *   - enhance_sharpness: boolean (default: false) - Preprocess: enhance sharpness
 *   - bilateral_filter: boolean (default: false) - Preprocess: noise reduction
 */
router.post(
  "/detect",
  upload.fields([...IMAGE_UPLOAD_FIELDS]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const imageFile = pickImageFile(req);
      if (!imageFile) {
        return res.status(400).json({
          success: false,
          error:
            "No image file provided. Use multipart field: image, file, photo, or outfit.",
        });
      }

      const confidence = req.query.confidence
        ? parseFloat(req.query.confidence as string)
        : 0.25;

      // Build preprocessing options if any are enabled
      const preprocessing =
        req.query.enhance_contrast === "true" ||
        req.query.enhance_sharpness === "true" ||
        req.query.bilateral_filter === "true"
          ? {
              enhanceContrast: req.query.enhance_contrast === "true",
              enhanceSharpness: req.query.enhance_sharpness === "true",
              bilateralFilter: req.query.bilateral_filter === "true",
            }
          : undefined;

      // Use YOLO client directly with preprocessing options
      const result = await yoloClient.detectFromBuffer(
        imageFile.buffer,
        imageFile.originalname,
        { confidence, preprocessing }
      );

      return res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route POST /api/images/detect/url
 * @desc Quick fashion detection from image URL
 * @access Public
 *
 * @body JSON
 *   - url: string (required) - Image URL to analyze
 *
 * @query
 *   - confidence: number (default: 0.25)
 *   - enhance_contrast: boolean (default: false)
 *   - enhance_sharpness: boolean (default: false)
 *   - bilateral_filter: boolean (default: false)
 */
router.post(
  "/detect/url",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { url } = req.body;

      if (!url) {
        return res.status(400).json({
          success: false,
          error: "No image URL provided. Send JSON with 'url' field.",
        });
      }

      const confidence = req.query.confidence
        ? parseFloat(req.query.confidence as string)
        : 0.25;

      // Build preprocessing options if any are enabled
      const preprocessing =
        req.query.enhance_contrast === "true" ||
        req.query.enhance_sharpness === "true" ||
        req.query.bilateral_filter === "true"
          ? {
              enhanceContrast: req.query.enhance_contrast === "true",
              enhanceSharpness: req.query.enhance_sharpness === "true",
              bilateralFilter: req.query.bilateral_filter === "true",
            }
          : undefined;

      const result = await yoloClient.detectFromUrl(url, { confidence, preprocessing });

      return res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route POST /api/images/detect/batch
 * @desc Batch fashion detection for multiple images
 * @access Public
 *
 * @body multipart/form-data
 *   - images: File[] (required, max 10)
 *
 * @query
 *   - confidence: number (default: 0.25)
 */
router.post(
  "/detect/batch",
  upload.array("images", 10),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const files = req.files as Express.Multer.File[];

      if (!files || files.length === 0) {
        return res.status(400).json({
          success: false,
          error: "No image files provided. Use 'images' field in multipart/form-data.",
        });
      }

      const confidence = req.query.confidence
        ? parseFloat(req.query.confidence as string)
        : 0.25;

      const images = files.map((file) => ({
        buffer: file.buffer,
        filename: file.originalname,
      }));

      const results = await analysisService.batchDetect(images, confidence);

      return res.json({
        success: true,
        count: results.length,
        results,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
