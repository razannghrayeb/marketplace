/**
 * Products Router
 * 
 * File structure:
 * - index.ts           → Route definitions (this file)
 * - products.service.ts → Product search/list business logic
 * - products.controller.ts → HTTP handlers for product endpoints
 * - images.service.ts  → Image upload/storage/retrieval logic
 * - images.controller.ts → HTTP handlers for image endpoints
 */
import { Router } from "express";
import multer from "multer";
import { listProducts, searchProductsByTitle, searchProductsByImage, getProductPriceHistory } from "./products.controller";
import { listProductImages, uploadImage, setAsPrimary, removeImage } from "./images.controller";

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
router.get("/search", searchProductsByTitle);
router.post("/search/image", upload.single("image"), searchProductsByImage);

// ============================================================================
// Product Price History
// ============================================================================

router.get("/:id/price-history", getProductPriceHistory);

// ============================================================================
// Product Image Routes
// ============================================================================

router.get("/:id/images", listProductImages);
router.post("/:id/images", upload.single("image"), uploadImage);
router.put("/:id/images/:imageId/primary", setAsPrimary);
router.delete("/:id/images/:imageId", removeImage);

export default router;
