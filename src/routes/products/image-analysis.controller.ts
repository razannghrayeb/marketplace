/**
 * Unified Image Analysis Controller
 *
 * Provides a single, organized API for all image operations:
 *
 * POST /api/images/analyze         - Full analysis (store + embed + detect)
 * POST /api/images/search          - Detect + find similar products (main endpoint!)
 * POST /api/images/search/url      - Find similar from URL
 * POST /api/images/detect          - Quick detection only
 * POST /api/images/detect/url      - Detection from URL
 * POST /api/images/detect/batch    - Batch detection
 * GET  /api/images/status          - Service health status
 * GET  /api/images/labels          - Supported fashion categories
 */

import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import {
  ImageAnalysisService,
  getImageAnalysisService,
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
 *     "yolo": true
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
 *   "services": { "clip": true, "yolo": true }
 * }
 */
router.post(
  "/analyze",
  upload.single("image"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: "No image file provided. Use 'image' field in multipart/form-data.",
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
        req.file.buffer,
        req.file.originalname,
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
 *
 * @body multipart/form-data
 *   - image: File (required)
 *
 * @query
 *   - store: boolean (default: false) - Store image in R2
 *   - threshold: number (default: 0.7) - Similarity threshold 0-1
 *   - limit_per_item: number (default: 10) - Max similar products per detection
 *   - filter_category: boolean (default: true) - Filter by detected category
 *   - confidence: number (default: 0.25) - Detection confidence
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
 *         "products": [
 *           { "id": 123, "title": "Floral Midi Dress", "similarity_score": 0.89, ... }
 *         ],
 *         "count": 10
 *       },
 *       {
 *         "detection": { "label": "heels", "confidence": 0.87, ... },
 *         "category": "footwear",
 *         "products": [
 *           { "id": 456, "title": "Strappy Heels", "similarity_score": 0.85, ... }
 *         ],
 *         "count": 8
 *       }
 *     ],
 *     "totalProducts": 18,
 *     "threshold": 0.7,
 *     "detectedCategories": ["dress", "heels", "bag"]
 *   }
 * }
 */
router.post(
  "/search",
  upload.single("image"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: "No image file provided. Use 'image' field in multipart/form-data.",
        });
      }

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
          : 0.7,
        similarLimitPerItem: req.query.limit_per_item
          ? parseInt(req.query.limit_per_item as string, 10)
          : 10,
        filterByDetectedCategory: req.query.filter_category !== "false",
      };

      const result = await analysisService.analyzeAndFindSimilar(
        req.file.buffer,
        req.file.originalname,
        options
      );

      // Don't expose raw embedding to clients
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
 *   - threshold: number (default: 0.7) - Similarity threshold
 *   - limit_per_item: number (default: 10) - Max products per detection
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
          : 0.7,
        limitPerItem: req.query.limit_per_item
          ? parseInt(req.query.limit_per_item as string, 10)
          : 10,
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
 */
router.post(
  "/detect",
  upload.single("image"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: "No image file provided. Use 'image' field in multipart/form-data.",
        });
      }

      const confidence = req.query.confidence
        ? parseFloat(req.query.confidence as string)
        : 0.25;

      const result = await analysisService.quickDetect(
        req.file.buffer,
        req.file.originalname,
        confidence
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

      const result = await analysisService.quickDetectFromUrl(url, confidence);

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
