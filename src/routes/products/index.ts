/**
 * Products Router
 * 
 * File structure:
 * - index.ts           → Route definitions (this file)
 * - products.service.ts → Product search/list business logic
 * - products.controller.ts → HTTP handlers for product endpoints
 * - images.service.ts  → Image upload/storage/retrieval logic
 * - images.controller.ts → HTTP handlers for image endpoints
 * - outfit.controller.ts → HTTP handlers for outfit completion
 */
import "dotenv/config";

import { Router } from "express";
import multer from "multer";
import { listProducts, searchProductsByTitle, searchProductsByImage, getProductPriceHistory, getProductFacets, getPriceDrops } from "./products.controller.js";
import { listProductImages, uploadImage, setAsPrimary, removeImage } from "./images.controller.js";
import { completeStyle, completeStyleFromBody, getStyleProfile } from "./outfit.controller.js";

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
// Price Drop Tracking
// ============================================================================

router.get("/price-drops", getPriceDrops);

// ============================================================================
// Complete My Style - Outfit Recommendations
// ============================================================================

router.get("/:id/complete-style", completeStyle);
router.get("/:id/style-profile", getStyleProfile);
router.post("/complete-style", completeStyleFromBody);

// ============================================================================
// Product Image Routes
// ============================================================================

router.get("/:id/images", listProductImages);
router.post("/:id/images", upload.single("image"), uploadImage);
router.put("/:id/images/:imageId/primary", setAsPrimary);
router.delete("/:id/images/:imageId", removeImage);

export default router;
export { listProducts, searchProductsByTitle, searchProductsByImage, getProductPriceHistory, getProductFacets, getPriceDrops } from "./products.controller.js";
export { listProductImages, uploadImage, setAsPrimary, removeImage } from "./images.controller.js";
export { completeStyle, completeStyleFromBody, getStyleProfile } from "./outfit.controller.js";
