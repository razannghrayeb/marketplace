/**
 * Try-On Routes
 *
 * Virtual try-on powered by Google Cloud Vertex AI.
 * Mount: /api/tryon
 *
 * All create/submit routes return 202 Accepted immediately.
 * The job starts as 'pending' and processes in the background.
 * Poll GET /:id until status is 'completed' or 'failed'.
 * On Cloud Run, jobs are processed inline before 202 returns (see TRYON_INLINE_PROCESSING / K_SERVICE in tryon.service) so polling often completes on the first GET.
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
// Garment Validation (pre-check)
// ============================================================================

router.post("/validate", controller.validateGarmentEndpoint);

// ============================================================================
// Webhook Management
// ============================================================================

router.post("/webhooks", controller.createWebhook);
router.get("/webhooks", controller.getWebhook);
router.delete("/webhooks", controller.removeWebhook);
router.post("/webhooks/disable", controller.pauseWebhook);

// ============================================================================
// Admin: Dead Letter Queue & Retry Management
// ============================================================================

router.get("/admin/dlq", controller.getDLQ);
router.post("/admin/dlq/:jobId/retry", controller.retryDLQJob);
router.post("/admin/process-retries", controller.processRetries);

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
const personUploadFields = [
  { name: "person_image", maxCount: 1 },
  { name: "person", maxCount: 1 },
  { name: "model", maxCount: 1 },
  { name: "model_image", maxCount: 1 },
] as const;

const garmentSingleFields = [
  { name: "garment_image", maxCount: 1 },
  { name: "garment", maxCount: 1 },
  { name: "clothing", maxCount: 1 },
] as const;

router.post(
  "/",
  tryonRateLimit,
  upload.fields([...personUploadFields, ...garmentSingleFields]),
  controller.createTryOn
);

// From wardrobe item
router.post(
  "/from-wardrobe",
  tryonRateLimit,
  upload.fields([...personUploadFields]),
  controller.tryOnFromWardrobe
);

// From product catalog
router.post(
  "/from-product",
  tryonRateLimit,
  upload.fields([...personUploadFields]),
  controller.tryOnFromProduct
);

// Batch: same person photo + up to 5 garments
router.post(
  "/batch",
  tryonRateLimit,
  upload.fields([
    ...personUploadFields,
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
