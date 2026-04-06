/**
 * Wardrobe Controller
 *
 * HTTP request/response handlers - business logic is in service files
 */
import { Request, Response, NextFunction } from "express";
import { pg } from "../../lib/core/db";
import {
  createWardrobeItem,
  getWardrobeItem,
  getUserWardrobeItems,
  updateWardrobeItem,
  deleteWardrobeItem,
  findSimilarWardrobeItems,
  backfillMissingEmbeddings
} from "./wardrobe.service";
import {
  getStyleProfile,
  computeStyleProfile
} from "./styleProfile.service";
import {
  getTopCompatibleItems,
  precomputeCompatibilityEdges,
  getWardrobeCompatibilityScore
} from "./compatibility.service";
import {
  analyzeWardrobeGaps,
  getWardrobeGaps
} from "./gaps.service";
import {
  getRecommendations,
  getOutfitSuggestions,
  completeLookSuggestions,
  completeLookSuggestionsForCatalogProducts,
  getOnboardingRecommendationsForUser,
  getAdaptedEssentialsForUser,
  getUserPriceTier
} from "./recommendations.service";

function refreshStyleProfileInBackground(userId: number): void {
  void computeStyleProfile(userId).catch((err) => {
    console.warn("Wardrobe: failed to refresh style profile after mutation", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

// ============================================================================
// Wardrobe Items CRUD
// ============================================================================

/**
 * GET /api/wardrobe/items - List user's wardrobe items
 */
export async function listItems(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const categoryId = req.query.category_id ? parseInt(req.query.category_id as string, 10) : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

    let result: { items: unknown[]; total: number };
    try {
      result = await getUserWardrobeItems(userId, { categoryId, limit, offset });
    } catch (dbErr: unknown) {
      const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
      if (msg.includes('relation "wardrobe_items" does not exist') || msg.includes('does not exist')) {
        console.warn("Wardrobe: wardrobe_items table missing. Run migrations (e.g. db/migrations/003_digital_twin_phase0.sql). Returning empty.");
        result = { items: [], total: 0 };
      } else {
        throw dbErr;
      }
    }

    res.json({
      success: true,
      items: result.items,
      total: result.total,
      limit,
      offset
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/wardrobe/items - Add item to wardrobe
 */
export async function createItem(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;

    const item = await createWardrobeItem({
      user_id: userId,
      source: req.body.source || "manual",
      product_id: req.body.product_id ? parseInt(req.body.product_id, 10) : undefined,
      image_buffer: req.file?.buffer,
      image_url: req.body.image_url,
      name: req.body.name,
      category_id: req.body.category_id ? parseInt(req.body.category_id, 10) : undefined,
      brand: req.body.brand,
      pattern_id: req.body.pattern_id ? parseInt(req.body.pattern_id, 10) : undefined,
      material_id: req.body.material_id ? parseInt(req.body.material_id, 10) : undefined
    });

    refreshStyleProfileInBackground(userId);

    res.status(201).json({ success: true, item });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/wardrobe/items/:id - Get specific wardrobe item
 */
export async function getItem(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const itemId = parseInt(req.params.id, 10);

    const item = await getWardrobeItem(itemId, userId);
    if (!item) {
      return res.status(404).json({ success: false, error: "Item not found" });
    }

    res.json({ success: true, item });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/wardrobe/items/:id - Update wardrobe item
 */
export async function updateItem(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const itemId = parseInt(req.params.id, 10);

    const item = await updateWardrobeItem(itemId, userId, {
      name: req.body.name,
      category_id: req.body.category_id,
      brand: req.body.brand,
      pattern_id: req.body.pattern_id,
      material_id: req.body.material_id,
      dominant_colors: req.body.dominant_colors
    });

    if (!item) {
      return res.status(404).json({ success: false, error: "Item not found" });
    }

    refreshStyleProfileInBackground(userId);

    res.json({ success: true, item });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/wardrobe/items/:id - Remove item from wardrobe
 */
export async function deleteItem(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const itemId = parseInt(req.params.id, 10);

    const deleted = await deleteWardrobeItem(itemId, userId);
    if (!deleted) {
      return res.status(404).json({ success: false, error: "Item not found" });
    }

    refreshStyleProfileInBackground(userId);

    res.json({ success: true, deleted: true });
  } catch (err) {
    next(err);
  }
}

// ============================================================================
// Style Profile
// ============================================================================

/**
 * GET /api/wardrobe/profile - Get user's style profile
 */
export async function getProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    let profile = await getStyleProfile(userId);

    if (!profile) {
      // Compute if doesn't exist
      profile = await computeStyleProfile(userId);
    }

    res.json({ success: true, profile });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/wardrobe/profile/recompute - Force recompute style profile
 */
export async function recomputeProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const profile = await computeStyleProfile(userId);
    res.json({ success: true, profile });
  } catch (err) {
    next(err);
  }
}

// ============================================================================
// Gap Analysis
// ============================================================================

/**
 * GET /api/wardrobe/gaps - Get wardrobe gaps and recommendations
 */
export async function getGaps(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const recompute = req.query.recompute === "true";

    let result;
    if (recompute) {
      result = await analyzeWardrobeGaps(userId);
    } else {
      const gaps = await getWardrobeGaps(userId);
      if (gaps.length === 0) {
        result = await analyzeWardrobeGaps(userId);
      } else {
        result = { gaps, summary: null, recommendations: [] };
      }
    }

    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

// ============================================================================
// Recommendations
// ============================================================================

/**
 * GET /api/wardrobe/recommendations - Get personalized product recommendations
 */
export async function getRecommendationsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const priceMin = req.query.price_min ? parseInt(req.query.price_min as string, 10) : undefined;
    const priceMax = req.query.price_max ? parseInt(req.query.price_max as string, 10) : undefined;

    const recommendations = await getRecommendations(userId, {
      limit,
      priceMin,
      priceMax,
      includeGapBased: req.query.include_gaps !== "false",
      includeStyleBased: req.query.include_style !== "false",
      includeCompatibilityBased: req.query.include_compat !== "false"
    });

    res.json({ success: true, recommendations });
  } catch (err) {
    next(err);
  }
}

// ============================================================================
// Compatibility
// ============================================================================

/**
 * GET /api/wardrobe/compatibility/:itemId - Get items compatible with a specific item
 */
export async function getCompatibleItems(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const itemId = parseInt(req.params.itemId, 10);
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;

    const compatible = await getTopCompatibleItems(userId, itemId, limit);
    res.json({ success: true, compatible });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/wardrobe/compatibility/precompute - Precompute all compatibility edges
 */
export async function precomputeCompatibility(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const edgesComputed = await precomputeCompatibilityEdges(userId);
    res.json({ success: true, edges_computed: edgesComputed });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/wardrobe/compatibility/score - Get overall wardrobe compatibility score
 */
export async function getCompatibilityScore(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const score = await getWardrobeCompatibilityScore(userId);
    res.json({ success: true, score });
  } catch (err) {
    next(err);
  }
}

// ============================================================================
// Outfit Suggestions
// ============================================================================

/**
 * POST /api/wardrobe/outfit-suggestions - Get outfit suggestions starting from an item
 */
export async function outfitSuggestions(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const itemId = parseInt(req.body.item_id, 10);
    const limit = req.body.limit || 5;

    const suggestions = await getOutfitSuggestions(userId, itemId, limit);
    res.json({ success: true, suggestions });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/wardrobe/complete-look - Get suggestions to complete a partial outfit
 */
export async function completeLook(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const itemIds = req.body.item_ids as number[] | undefined;
    const productIdsRaw = req.body.product_ids as number[] | undefined;
    const productIds = Array.isArray(productIdsRaw)
      ? productIdsRaw.map((n) => parseInt(String(n), 10)).filter((n) => Number.isFinite(n) && n >= 1)
      : [];
    const limit = req.body.limit || 10;
    const audienceGenderHintRaw = req.body.audience_gender ?? req.body.gender;
    const audienceGenderHint =
      typeof audienceGenderHintRaw === "string" && audienceGenderHintRaw.trim().length > 0
        ? audienceGenderHintRaw.trim()
        : undefined;

    const hasItems = Array.isArray(itemIds) && itemIds.length > 0;
    if (!hasItems && productIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: "item_ids or product_ids array required",
      });
    }

    const result = hasItems
      ? await completeLookSuggestions(userId, itemIds!, limit, { audienceGenderHint })
      : await completeLookSuggestionsForCatalogProducts(userId, productIds, limit, { audienceGenderHint });
    const suggestions = result.suggestions.map((s) => ({
      ...s,
      id: s.product_id,
    }));
    res.json({
      success: true,
      suggestions,
      outfitSets: result.outfitSets,
      missingCategories: result.missingCategories,
    });
  } catch (err) {
    next(err);
  }
}

// ============================================================================
// Utility
// ============================================================================

/**
 * POST /api/wardrobe/backfill-embeddings - Backfill missing embeddings
 */
export async function backfillEmbeddings(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const batchSize = req.body.batch_size || 50;

    const processed = await backfillMissingEmbeddings(userId, batchSize);
    res.json({ success: true, processed });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/wardrobe/similar/:itemId - Find similar items in wardrobe
 */
export async function getSimilarItems(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const itemId = parseInt(req.params.itemId, 10);
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;

    const item = await getWardrobeItem(itemId, userId);
    if (!item || !item.embedding) {
      return res.status(404).json({ success: false, error: "Item not found or has no embedding" });
    }

    const similar = await findSimilarWardrobeItems(userId, item.embedding, limit, itemId);
    res.json({ success: true, similar });
  } catch (err) {
    next(err);
  }
}

// ============================================================================
// 🆕 Auto-Sync Settings (Feature #6 Enhancement)
// ============================================================================

/**
 * GET /api/wardrobe/auto-sync/settings - Get user's auto-sync settings
 */
export async function getAutoSyncSettings(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const { getUserAutoSyncSettings } = await import("../../lib/wardrobe/autoSync");

    const settings = await getUserAutoSyncSettings(userId);
    res.json({ success: true, settings });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/wardrobe/auto-sync/settings - Update auto-sync settings
 */
export async function updateAutoSyncSettings(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const { updateUserAutoSyncSettings } = await import("../../lib/wardrobe/autoSync");

    await updateUserAutoSyncSettings(userId, req.body);
    res.json({ success: true, message: "Settings updated" });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/wardrobe/auto-sync/manual - Manually sync a purchase
 */
export async function manualSyncPurchase(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const { syncPurchaseToWardrobe } = await import("../../lib/wardrobe/autoSync");

    const result = await syncPurchaseToWardrobe({
      productId: req.body.product_id,
      orderId: req.body.order_id,
      userId,
      title: req.body.title,
      brand: req.body.brand,
      price: req.body.price,
      imageUrl: req.body.image_url,
      purchasedAt: new Date(req.body.purchased_at || Date.now()),
    });

    res.json({ success: true, result });
  } catch (err) {
    next(err);
  }
}

// ============================================================================
// 🆕 Image Recognition (Feature #6 Enhancement)
// ============================================================================

/**
 * POST /api/wardrobe/analyze-photo - Analyze a wardrobe photo with AI
 */
export async function analyzeWardrobePhoto(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: "Image file required" });
    }

    const { analyzeWardrobePhoto, enrichWardrobeItem } = await import("../../lib/wardrobe/imageRecognition");

    const analysis = await analyzeWardrobePhoto(req.file.buffer, {
      useGemini: req.body.use_gemini !== "false",
      extractEmbedding: req.body.extract_embedding !== "false",
    });

    const enriched = enrichWardrobeItem(analysis);

    res.json({ success: true, analysis, enriched });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/wardrobe/analyze-photos/batch - Batch analyze multiple photos
 */
export async function batchAnalyzePhotos(req: Request, res: Response, next: NextFunction) {
  try {
    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      return res.status(400).json({ success: false, error: "At least one image required" });
    }

    const { batchAnalyzeWardrobePhotos } = await import("../../lib/wardrobe/imageRecognition");

    const imageBuffers = files.map(f => f.buffer);
    const analyses = await batchAnalyzeWardrobePhotos(imageBuffers);

    res.json({ success: true, analyses, count: analyses.length });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/wardrobe/items/:id/re-analyze - Re-analyze existing wardrobe item
 */
export async function reanalyzeItem(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const itemId = parseInt(req.params.id, 10);

    const item = await getWardrobeItem(itemId, userId);
    if (!item) {
      return res.status(404).json({ success: false, error: "Item not found" });
    }

    if (!item.image_url) {
      return res.status(400).json({ success: false, error: "Item has no image" });
    }

    // Fetch image
    const response = await fetch(item.image_url);
    const arrayBuffer = await response.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuffer);

    const { reanalyzeWardrobeItem } = await import("../../lib/wardrobe/imageRecognition");
    const analysis = await reanalyzeWardrobeItem(itemId, imageBuffer);

    // Update wardrobe item with new analysis
    await updateWardrobeItem(itemId, userId, {
      category_id: analysis.categoryId,
      pattern_id: analysis.patternId,
      material_id: analysis.materialId,
    });

    res.json({ success: true, analysis });
  } catch (err) {
    next(err);
  }
}

// ============================================================================
// 🆕 Visual Coherence (Feature #6 Enhancement)
// ============================================================================

/**
 * POST /api/wardrobe/outfit-coherence - Assess visual coherence of outfit pieces
 */
export async function assessOutfitCoherence(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const { piece_ids } = req.body;

    if (!piece_ids || !Array.isArray(piece_ids) || piece_ids.length < 2) {
      return res.status(400).json({ success: false, error: "At least 2 piece IDs required" });
    }

    // Fetch pieces
    const pieces = await Promise.all(
      piece_ids.map((id: number) => getWardrobeItem(id, userId))
    );

    if (pieces.some(p => !p)) {
      return res.status(404).json({ success: false, error: "One or more pieces not found" });
    }

    const { assessOutfitCoherence } = await import("../../lib/wardrobe/visualCoherence");

    const coherenceScore = await assessOutfitCoherence(
      pieces.map((p: any) => ({
        id: p.id,
        category: p.category || 'unknown',
        embedding: p.embedding ? JSON.parse(p.embedding) : undefined,
        colors: {
          primary: p.primary_colors || [],
          secondary: p.secondary_colors || [],
          hexCodes: p.hex_codes || [],
        },
        pattern: p.pattern,
        material: p.material,
        style: p.style_tags || [],
        formality: p.formality_score,
        imageUrl: p.image_url,
      }))
    );

    res.json({ success: true, coherence: coherenceScore });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/wardrobe/outfit/:outfitId/coherence - Assess saved outfit coherence
 */
export async function assessSavedOutfitCoherence(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const outfitId = parseInt(req.params.outfitId, 10);

    // Fetch outfit and its pieces
    const result = await pg.query(
      `SELECT wi.* FROM outfit_items oi
       JOIN wardrobe_items wi ON wi.id = oi.wardrobe_item_id
       JOIN outfits o ON o.id = oi.outfit_id
       WHERE oi.outfit_id = $1 AND o.user_id = $2`,
      [outfitId, userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: "Outfit not found or empty" });
    }

    const { assessOutfitCoherence } = await import("../../lib/wardrobe/visualCoherence");

    const coherenceScore = await assessOutfitCoherence(
      result.rows.map((p: any) => ({
        id: p.id,
        category: p.category || 'unknown',
        embedding: p.embedding ? JSON.parse(p.embedding) : undefined,
        colors: {
          primary: p.primary_colors || [],
          secondary: p.secondary_colors ||[],
          hexCodes: p.hex_codes || [],
        },
        pattern: p.pattern,
        material: p.material,
        style: p.style_tags || [],
        formality: p.formality_score,
        imageUrl: p.image_url,
      }))
    );

    res.json({ success: true, coherence: coherenceScore });
  } catch (err) {
    next(err);
  }
}

// ============================================================================
// 🆕 Layering Analysis (Feature #6 Enhancement)
// ============================================================================

/**
 * POST /api/wardrobe/layering/analyze - Analyze layering order
 */
export async function analyzeLayering(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const { piece_ids } = req.body;

    if (!piece_ids || !Array.isArray(piece_ids)) {
      return res.status(400).json({ success: false, error: "piece_ids array required" });
    }

    // Fetch pieces
    const pieces = await Promise.all(
      piece_ids.map((id: number) => getWardrobeItem(id, userId))
    );

    const { determineLayeringOrder } = await import("../../lib/wardrobe/layeringOrder");

    const layering = determineLayeringOrder(
      pieces.map((p: any) => ({ id: p.id, category: p.category }))
    );

    res.json({ success: true, layering });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/wardrobe/layering/suggest - Get layering suggestions
 */
export async function suggestLayering(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const { piece_ids } = req.body;

    const pieces = await Promise.all(
      piece_ids.map((id: number) => getWardrobeItem(id, userId))
    );

    const { determineLayeringOrder, suggestLayering } = await import("../../lib/wardrobe/layeringOrder");

    const layering = determineLayeringOrder(
      pieces.map((p: any) => ({ id: p.id, category: p.category }))
    );

    const suggestions = suggestLayering(layering.pieces);

    res.json({ success: true, layering, suggestions });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/wardrobe/layering/weather-check - Check if outfit appropriate for weather
 */
export async function checkWeatherAppropriate(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const { piece_ids, temperature } = req.query;

    if (!piece_ids || !temperature) {
      return res.status(400).json({ success: false, error: "piece_ids and temperature required" });
    }

    const pieceIdArray = (piece_ids as string).split(',').map(id => parseInt(id, 10));
    const temp = parseFloat(temperature as string);

    const pieces = await Promise.all(
      pieceIdArray.map((id: number) => getWardrobeItem(id, userId))
    );

    const { determineLayeringOrder, isAppropriateForWeather } = await import("../../lib/wardrobe/layeringOrder");

    const layering = determineLayeringOrder(
      pieces.map((p: any) => ({ id: p.id, category: p.category }))
    );

    const weatherCheck = isAppropriateForWeather(layering.pieces, temp);

    res.json({ success: true, weatherCheck });
  } catch (err) {
    next(err);
  }
}

// ============================================================================
// 🆕 Learned Compatibility (Feature #6 Enhancement)
// ============================================================================

/**
 * GET /api/wardrobe/compatibility/:category/learned - Get learned compatibility for category
 */
export async function getLearnedCompatibility(req: Request, res: Response, next: NextFunction) {
  try {
    const { category } = req.params;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;

    const { getTopCompatibleCategories } = await import("../../lib/wardrobe/learnedCompatibility");

    const compatible = await getTopCompatibleCategories(category, limit);

    res.json({ success: true, category, compatible });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/wardrobe/compatibility/graph - Get compatibility graph
 */
export async function getCompatibilityGraph(req: Request, res: Response, next: NextFunction) {
  try {
    const minScore = req.query.min_score ? parseFloat(req.query.min_score as string) : 0.6;
    const minOccurrences = req.query.min_occurrences ? parseInt(req.query.min_occurrences as string, 10) : 5;

    const { buildCompatibilityGraph } = await import("../../lib/wardrobe/learnedCompatibility");

    const graph = await buildCompatibilityGraph(minScore, minOccurrences);

    res.json({ success: true, graph });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/wardrobe/compatibility/learn - Trigger compatibility learning
 */
export async function triggerCompatibilityLearning(req: Request, res: Response, next: NextFunction) {
  try {
    const { learnCompatibilityRules } = await import("../../lib/wardrobe/learnedCompatibility");

    const rules = await learnCompatibilityRules();

    res.json({ success: true, rulesLearned: rules.length });
  } catch (err) {
    next(err);
  }
}

// ============================================================================
// 🆕 Onboarding & Lifestyle Adaptation
// ============================================================================

/**
 * GET /api/wardrobe/onboarding - Get onboarding recommendations for new users
 */
export async function getOnboarding(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

    const recommendations = await getOnboardingRecommendationsForUser(userId, limit);

    res.json({ success: true, recommendations });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/wardrobe/essentials - Get adapted essential categories for user
 */
export async function getEssentials(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;

    const essentials = await getAdaptedEssentialsForUser(userId);

    res.json({ success: true, essentials });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/wardrobe/price-tier - Get user's inferred price tier
 */
export async function getPriceTier(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;

    const priceTier = await getUserPriceTier(userId);

    res.json({ success: true, priceTier });
  } catch (err) {
    next(err);
  }
}
