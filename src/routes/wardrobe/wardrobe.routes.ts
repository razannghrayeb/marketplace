/**
 * Wardrobe Routes
 * 
 * Route definitions only - handlers are in wardrobe.controller.ts
 */
import { Router } from "express";
import multer from "multer";
import * as controller from "./wardrobe.controller";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

// ============================================================================
// Wardrobe Items CRUD
// ============================================================================
router.get("/items", controller.listItems);
router.post("/items", upload.single("image"), controller.createItem);
router.get("/items/:id", controller.getItem);
router.patch("/items/:id", controller.updateItem);
router.delete("/items/:id", controller.deleteItem);

// ============================================================================
// Style Profile
// ============================================================================
router.get("/profile", controller.getProfile);
router.post("/profile/recompute", controller.recomputeProfile);

// ============================================================================
// Gap Analysis
// ============================================================================
router.get("/gaps", controller.getGaps);

// ============================================================================
// Recommendations
// ============================================================================
router.get("/recommendations", controller.getRecommendationsHandler);

// ============================================================================
// Compatibility
// ============================================================================
router.get("/compatibility/score", controller.getCompatibilityScore);
router.get("/compatibility/:itemId", controller.getCompatibleItems);
router.post("/compatibility/precompute", controller.precomputeCompatibility);

// ============================================================================
// Outfit Suggestions
// ============================================================================
router.post("/outfit-suggestions", controller.outfitSuggestions);
router.post("/complete-look", controller.completeLook);

// ============================================================================
// Utility
// ============================================================================
router.post("/backfill-embeddings", controller.backfillEmbeddings);
router.get("/similar/:itemId", controller.getSimilarItems);

export default router;
export { router as wardrobeRouter };
