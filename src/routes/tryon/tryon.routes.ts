/**
 * Try-On Routes
 *
 * Virtual try-on powered by Google Cloud Vertex AI.
 * Mount: /api/tryon
 *
 * All create/submit routes return 202 Accepted immediately.
 * The job starts as 'pending' and processes in the background.
 * Poll GET /:id until status is 'completed' or 'failed'.
 */
import { Router } from "express";
import multer from "multer";
import { rateLimit } from "../../middleware/index";
import * as controller from "./tryon.controller";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB per image
});

// Strict rate limiter for Vertex AI calls: 10 requests / 5 minutes per IP
const tryonRateLimit = rateLimit({ windowMs: 5 * 60 * 1000, maxRequests: 10 });

// ============================================================================
// Service Status (must be before /:id to avoid route shadowing)
// ============================================================================

router.get("/service/health", controller.serviceHealth);

// ============================================================================
// Saved Results (must be before /:id)
// ============================================================================

router.get("/saved",                  controller.listSaved);
router.patch("/saved/:savedId",       controller.updateSaved);
router.delete("/saved/:savedId",      controller.deleteSaved);

// ============================================================================
// Virtual Try-On — submit (async, returns 202)
// ============================================================================

// Generic: person photo + garment image or garment_id
router.post(
  "/",
  tryonRateLimit,
  upload.fields([
    { name: "person_image",  maxCount: 1 },
    { name: "garment_image", maxCount: 1 },
  ]),
  controller.createTryOn
);

// From wardrobe item
router.post(
  "/from-wardrobe",
  tryonRateLimit,
  upload.single("person_image"),
  controller.tryOnFromWardrobe
);

// From product catalog
router.post(
  "/from-product",
  tryonRateLimit,
  upload.single("person_image"),
  controller.tryOnFromProduct
);

// Batch: same person photo + up to 5 garments
router.post(
  "/batch",
  tryonRateLimit,
  upload.fields([
    { name: "person_image",   maxCount: 1 },
    { name: "garment_images", maxCount: 5 },
  ]),
  controller.batchTryOn
);

// ============================================================================
// History
// ============================================================================

router.get("/history", controller.getHistory);

// ============================================================================
// Job management — by job ID (must be after named routes above)
// ============================================================================

router.get("/:id",              controller.getResult);
router.delete("/:id",           controller.deleteResult);
router.post("/:id/cancel",      controller.cancelJob);
router.post("/:id/save",        controller.saveResult);

export default router;
export { router as tryonRouter };
