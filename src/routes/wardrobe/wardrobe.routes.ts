/**
 * Wardrobe Routes
 * 
 * Route definitions only - handlers are in wardrobe.controller.ts
 */
import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../../middleware/auth";
import * as controller from "./wardrobe.controller";

const router = Router();

router.use(requireAuth);

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
router.post("/outfit-feedback", controller.outfitFeedback);

// ============================================================================
// Utility
// ============================================================================
router.post("/backfill-embeddings", controller.backfillEmbeddings);
router.get("/similar/:itemId", controller.getSimilarItems);

// ============================================================================
// 🆕 Auto-Sync Settings (Feature #6 Enhancement)
// ============================================================================
router.get("/auto-sync/settings", controller.getAutoSyncSettings);
router.put("/auto-sync/settings", controller.updateAutoSyncSettings);
router.post("/auto-sync/manual", controller.manualSyncPurchase);

// ============================================================================
// 🆕 Image Recognition (Feature #6 Enhancement)
// ============================================================================
router.post("/analyze-photo", upload.single("image"), controller.analyzeWardrobePhoto);
router.post("/analyze-photos/batch", upload.array("images", 10), controller.batchAnalyzePhotos);
router.post("/items/:id/re-analyze", controller.reanalyzeItem);

// ============================================================================
// 🆕 Visual Coherence (Feature #6 Enhancement)
// ============================================================================
router.post("/outfit-coherence", controller.assessOutfitCoherence);
router.post("/outfit/:outfitId/coherence", controller.assessSavedOutfitCoherence);

// ============================================================================
// 🆕 Layering Analysis (Feature #6 Enhancement)
// ============================================================================
router.post("/layering/analyze", controller.analyzeLayering);
router.post("/layering/suggest", controller.suggestLayering);
router.get("/layering/weather-check", controller.checkWeatherAppropriate);

// ============================================================================
// 🆕 Learned Compatibility (Feature #6 Enhancement)
// ============================================================================
router.get("/compatibility/:category/learned", controller.getLearnedCompatibility);
router.get("/compatibility/graph", controller.getCompatibilityGraph);
router.post("/compatibility/learn", controller.triggerCompatibilityLearning);

// ============================================================================
// 🆕 Onboarding & Lifestyle Adaptation
// ============================================================================
router.get("/onboarding", controller.getOnboarding);
router.get("/essentials", controller.getEssentials);
router.get("/price-tier", controller.getPriceTier);

export default router;
export { router as wardrobeRouter };
