/**
 * Products Router
 * 
 * File structure:
 * - index.ts           → Route definitions (this file)
 * - products.service.ts → Product search/list business logic
 * - products.controller.ts → HTTP handlers for product endpoints
 * - images.service.ts  → Image upload/storage/retrieval logic
 * - images.controller.ts → HTTP handlers for image endpoints
 * - outfit.controller.ts → HTTP handlers for outfit completion (complementary items)
 * - recommendations.controller.ts → HTTP handlers for similar products (ML ranked)
 */
import "dotenv/config";

import { Router } from "express";
import multer from "multer";
import { listProducts, searchProductsByTitle, searchProductsByImage, getProductById, getProductPriceHistory, getProductFacets, getPriceDrops, getSimilarProducts } from "./products.controller";
import { listProductImages, uploadImage, setAsPrimary, removeImage } from "./images.controller";
import { completeStyle, completeStyleFromBody, getStyleProfile } from "./outfit.controller";
import { getRecommendations, getBatchRecommendationsHandler } from "./recommendations.controller";
import { optionalAuth } from "../../middleware/auth";

const router = Router();

// ============================================================================
// Multer Configuration
// ============================================================================

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    cb(null, allowed.includes(file.mimetype));
  },
});

// ============================================================================
// Product Routes
// ============================================================================

router.get("/", listProducts);
router.get("/facets", getProductFacets);
router.get("/search", searchProductsByTitle);
router.post("/search/image", upload.single("image"), searchProductsByImage);

// ============================================================================
// Product Price History
// ============================================================================

router.get("/:id/price-history", getProductPriceHistory);

// ============================================================================
// Similar Products (Candidate Generator - legacy)
// ============================================================================

router.get("/:id/similar", getSimilarProducts);

// ============================================================================
// ML-Ranked Recommendations (Similar Items)
// ============================================================================

// GET /products/:id/recommendations - Similar products with ML ranking
router.get("/:id/recommendations", getRecommendations);

// POST /products/recommendations/batch - Batch recommendations for multiple products
router.post("/recommendations/batch", getBatchRecommendationsHandler);

// ============================================================================
// Price Drop Tracking
// ============================================================================

router.get("/price-drops", getPriceDrops);

// ============================================================================
// Complete My Style - Outfit Recommendations
// ============================================================================

router.get("/:id/complete-style", optionalAuth, completeStyle);
router.get("/:id/style-profile", getStyleProfile);
router.post("/complete-style", optionalAuth, completeStyleFromBody);

// ============================================================================
// Product Image Routes
// ============================================================================

router.get("/:id/images", listProductImages);
router.post("/:id/images", upload.single("image"), uploadImage);
router.put("/:id/images/:imageId/primary", setAsPrimary);
router.delete("/:id/images/:imageId", removeImage);

// Single-segment :id last (numeric product id for PDP)
router.get("/:id", getProductById);

export default router;
export { listProducts, searchProductsByTitle, searchProductsByImage, getProductById, getProductPriceHistory, getProductFacets, getPriceDrops } from "./products.controller";
export { listProductImages, uploadImage, setAsPrimary, removeImage } from "./images.controller";
export { completeStyle, completeStyleFromBody, getStyleProfile } from "./outfit.controller";

// Re-export services for other modules
export * from "./products.service";
export * from "./images.service";
export * from "./outfit.service";
export * from "./recommendations.service";
export * from "./canonical.service";
export * from "./priceHistory.service";
export * from "./completestyle.service";
export * from "./recommendations-logger.service";
