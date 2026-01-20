/**
 * Wardrobe Controller
 * 
 * HTTP request/response handlers - business logic is in service files
 */
import { Request, Response, NextFunction } from "express";
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
  completeLookSuggestions
} from "./recommendations.service";

// Helper to get user ID (in production, from auth middleware)
function getUserId(req: Request): number {
  const userId = req.headers["x-user-id"] || req.query.user_id || req.body?.user_id;
  if (!userId) throw new Error("User ID required");
  return parseInt(String(userId), 10);
}

// ============================================================================
// Wardrobe Items CRUD
// ============================================================================

/**
 * GET /api/wardrobe/items - List user's wardrobe items
 */
export async function listItems(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = getUserId(req);
    const categoryId = req.query.category_id ? parseInt(req.query.category_id as string, 10) : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

    const result = await getUserWardrobeItems(userId, { categoryId, limit, offset });

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
    const userId = getUserId(req);

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
    const userId = getUserId(req);
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
    const userId = getUserId(req);
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
    const userId = getUserId(req);
    const itemId = parseInt(req.params.id, 10);

    const deleted = await deleteWardrobeItem(itemId, userId);
    if (!deleted) {
      return res.status(404).json({ success: false, error: "Item not found" });
    }

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
    const userId = getUserId(req);
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
    const userId = getUserId(req);
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
    const userId = getUserId(req);
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
    const userId = getUserId(req);
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
    const userId = getUserId(req);
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
    const userId = getUserId(req);
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
    const userId = getUserId(req);
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
    const userId = getUserId(req);
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
    const userId = getUserId(req);
    const itemIds = req.body.item_ids as number[];
    const limit = req.body.limit || 10;

    if (!Array.isArray(itemIds) || itemIds.length === 0) {
      return res.status(400).json({ success: false, error: "item_ids array required" });
    }

    const suggestions = await completeLookSuggestions(userId, itemIds, limit);
    res.json({ success: true, suggestions });
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
    const userId = getUserId(req);
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
    const userId = getUserId(req);
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
