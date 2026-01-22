/**
 * Admin Routes
 * 
 * Routes for admin operations: moderation, canonicals, jobs
 */
import { Router } from "express";
import * as adminController from "./admin.controller.js";

const router = Router();

// ============================================================================
// Product Moderation
// ============================================================================

router.post("/products/:id/hide", adminController.hideProduct);
router.post("/products/:id/unhide", adminController.unhideProduct);
router.post("/products/:id/flag", adminController.flagProduct);
router.post("/products/:id/unflag", adminController.unflagProduct);
router.post("/products/hide-batch", adminController.hideProductsBatch);

router.get("/products/flagged", adminController.getFlaggedProducts);
router.get("/products/hidden", adminController.getHiddenProducts);
router.get("/products/:id/duplicates", adminController.findDuplicates);

// ============================================================================
// Canonical Management
// ============================================================================

router.get("/canonicals", adminController.listCanonicals);
router.get("/canonicals/:id", adminController.getCanonical);
router.post("/canonicals/merge", adminController.mergeCanonicals);
router.post("/canonicals/:id/detach/:productId", adminController.detachFromCanonical);

// ============================================================================
// Job Management
// ============================================================================

router.post("/jobs/:type/run", adminController.runJob);
router.get("/jobs/schedules", adminController.getSchedules);
router.get("/jobs/metrics", adminController.getJobMetrics);
router.get("/jobs/history", adminController.getJobHistory);

// ============================================================================
// Dashboard
// ============================================================================

router.get("/stats", adminController.getDashboardStats);

export default router;
export * from "./admin.controller.js";
