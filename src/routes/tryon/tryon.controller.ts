/**
 * Try-On Controller
 *
 * HTTP request/response handlers for virtual try-on endpoints.
 */
import { Request, Response, NextFunction } from "express";
import {
  performTryOn,
  performBatchTryOn,
  cancelTryOnJob,
  getTryOnHistory,
  getTryOnJob,
  deleteTryOnJob,
  saveTryOnResult,
  getSavedResults,
  updateSavedResult,
  deleteSavedResult,
} from "./tryon.service";
import { getTryOnClient } from "../../lib/image/tryonClient";

// ============================================================================
// Shared helpers
// ============================================================================

// Uses req.user from JWT auth (requireAuth middleware) - matches wardrobe controller
function getUserId(req: Request): number {
  const userId = req.user?.id;
  if (!userId) throw new Error("User ID required");
  return typeof userId === "number" ? userId : parseInt(String(userId), 10);
}

const ALLOWED_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

function validateImageFile(
  file: Express.Multer.File | undefined,
  fieldName: string
): void {
  if (!file) return;
  if (!ALLOWED_MIMES.has(file.mimetype)) {
    const err = new Error(`${fieldName} must be a JPEG, PNG, or WebP image`);
    (err as any).statusCode = 400;
    throw err;
  }
}

// ============================================================================
// Virtual Try-On — submit (returns 202 immediately; poll /:id for result)
// ============================================================================

/**
 * POST /api/tryon
 * Multipart: person_image (required), garment_image (optional)
 * Body: garment_id?, garment_source?, category?, garment_description?
 */
export async function createTryOn(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const userId = getUserId(req);
    const files = req.files as
      | { [fieldname: string]: Express.Multer.File[] }
      | undefined;

    const personFile  = files?.person_image?.[0];
    const garmentFile = files?.garment_image?.[0];

    if (!personFile) {
      return res.status(400).json({ success: false, error: "person_image is required" });
    }
    validateImageFile(personFile,  "person_image");
    validateImageFile(garmentFile, "garment_image");

    const garmentId = req.body.garment_id
      ? parseInt(req.body.garment_id, 10)
      : undefined;
    const garmentSource = req.body.garment_source || "upload";

    if (!garmentFile && !garmentId) {
      return res.status(400).json({
        success: false,
        error: "Either garment_image file or garment_id is required",
      });
    }

    const job = await performTryOn({
      userId,
      personImageBuffer: personFile.buffer,
      personMimeType:    personFile.mimetype,
      garmentImageBuffer: garmentFile?.buffer,
      garmentId,
      garmentSource,
      category: req.body.category || "upper_body",
      garmentDescription: req.body.garment_description,
    });

    res.status(202).json({ success: true, job });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/tryon/from-wardrobe
 * Multipart: person_image (required)
 * Body: wardrobe_item_id (required), category?, garment_description?
 */
export async function tryOnFromWardrobe(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const userId     = getUserId(req);
    const personFile = req.file;
    if (!personFile) {
      return res.status(400).json({ success: false, error: "person_image is required" });
    }
    validateImageFile(personFile, "person_image");

    const wardrobeItemId = req.body.wardrobe_item_id
      ? parseInt(req.body.wardrobe_item_id, 10)
      : undefined;
    if (!wardrobeItemId) {
      return res.status(400).json({ success: false, error: "wardrobe_item_id is required" });
    }

    const job = await performTryOn({
      userId,
      personImageBuffer: personFile.buffer,
      personMimeType:    personFile.mimetype,
      garmentId:     wardrobeItemId,
      garmentSource: "wardrobe",
      category:      req.body.category || "upper_body",
      garmentDescription: req.body.garment_description,
    });

    res.status(202).json({ success: true, job });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/tryon/from-product
 * Multipart: person_image (required)
 * Body: product_id (required), category?, garment_description?
 */
export async function tryOnFromProduct(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const userId     = getUserId(req);
    const personFile = req.file;
    if (!personFile) {
      return res.status(400).json({ success: false, error: "person_image is required" });
    }
    validateImageFile(personFile, "person_image");

    const productId = req.body.product_id
      ? parseInt(req.body.product_id, 10)
      : undefined;
    if (!productId) {
      return res.status(400).json({ success: false, error: "product_id is required" });
    }

    const job = await performTryOn({
      userId,
      personImageBuffer: personFile.buffer,
      personMimeType:    personFile.mimetype,
      garmentId:     productId,
      garmentSource: "product",
      category:      req.body.category || "upper_body",
      garmentDescription: req.body.garment_description,
    });

    res.status(202).json({ success: true, job });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/tryon/batch
 * Multipart: person_image (required), garment_images[] (up to 5, optional)
 * Body: garment_ids? (JSON array of { id, source, category?, description? })
 *       category? (fallback for all garments)
 *
 * Returns array of pending jobs. Poll each /:id individually.
 */
export async function batchTryOn(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const userId     = getUserId(req);
    const files      = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const personFile = files?.person_image?.[0];

    if (!personFile) {
      return res.status(400).json({ success: false, error: "person_image is required" });
    }
    validateImageFile(personFile, "person_image");

    const garmentFiles  = files?.garment_images ?? [];
    const garmentIdJson = req.body.garment_ids as string | undefined;

    type GarmentIdEntry = {
      id: number;
      source: "wardrobe" | "product";
      category?: "upper_body" | "lower_body" | "dresses";
      description?: string;
    };

    let garments: import("./tryon.service").BatchGarmentInput[] = [];

    if (garmentFiles.length > 0) {
      garmentFiles.forEach((f) => validateImageFile(f, "garment_images"));
      garments = garmentFiles.map((f) => ({
        garmentImageBuffer: f.buffer,
        garmentSource:      "upload" as const,
        category:           req.body.category || "upper_body",
      }));
    } else if (garmentIdJson) {
      let parsed: GarmentIdEntry[];
      try {
        parsed = JSON.parse(garmentIdJson);
      } catch {
        return res.status(400).json({ success: false, error: "garment_ids must be valid JSON" });
      }
      garments = parsed.map((g) => ({
        garmentId:     g.id,
        garmentSource: g.source,
        category:      g.category ?? req.body.category ?? "upper_body",
        garmentDescription: g.description,
      }));
    } else {
      return res.status(400).json({
        success: false,
        error: "Provide garment_images files or garment_ids JSON array",
      });
    }

    const jobs = await performBatchTryOn({
      userId,
      personImageBuffer: personFile.buffer,
      personMimeType:    personFile.mimetype,
      garments,
    });

    res.status(202).json({ success: true, jobs, total: jobs.length });
  } catch (err) {
    next(err);
  }
}

// ============================================================================
// Job management
// ============================================================================

/**
 * POST /api/tryon/:id/cancel — Cancel a pending job
 */
export async function cancelJob(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const userId = getUserId(req);
    const jobId  = parseInt(req.params.id, 10);

    const cancelled = await cancelTryOnJob(jobId, userId);
    if (!cancelled) {
      return res.status(404).json({
        success: false,
        error: "Job not found or is not in a pending state",
      });
    }
    res.json({ success: true, message: "Job cancelled" });
  } catch (err) {
    next(err);
  }
}

// ============================================================================
// History
// ============================================================================

/**
 * GET /api/tryon/history?limit=20&offset=0&status=completed
 */
export async function getHistory(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const userId = getUserId(req);
    const limit  = req.query.limit  ? parseInt(req.query.limit  as string, 10) : 20;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;
    const status = req.query.status as string | undefined;

    const result = await getTryOnHistory(userId, limit, offset, status);

    res.json({ success: true, jobs: result.jobs, total: result.total, limit, offset });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/tryon/:id
 */
export async function getResult(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const userId = getUserId(req);
    const jobId  = parseInt(req.params.id, 10);

    const job = await getTryOnJob(jobId, userId);
    if (!job) {
      return res.status(404).json({ success: false, error: "Try-on result not found" });
    }
    res.json({ success: true, job });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/tryon/:id
 */
export async function deleteResult(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const userId  = getUserId(req);
    const jobId   = parseInt(req.params.id, 10);
    const deleted = await deleteTryOnJob(jobId, userId);
    if (!deleted) {
      return res.status(404).json({ success: false, error: "Try-on result not found" });
    }
    res.json({ success: true, message: "Try-on result deleted" });
  } catch (err) {
    next(err);
  }
}

// ============================================================================
// Saved results (bookmarks / favourites)
// ============================================================================

/**
 * POST /api/tryon/:id/save
 * Body: note? (string), is_favorite? (boolean)
 */
export async function saveResult(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const userId = getUserId(req);
    const jobId  = parseInt(req.params.id, 10);

    const saved = await saveTryOnResult(
      jobId,
      userId,
      req.body.note,
      req.body.is_favorite === true || req.body.is_favorite === "true"
    );
    res.status(201).json({ success: true, saved });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/tryon/saved?favorites_only=true&limit=20&offset=0
 */
export async function listSaved(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const userId       = getUserId(req);
    const favoritesOnly = req.query.favorites_only === "true";
    const limit  = req.query.limit  ? parseInt(req.query.limit  as string, 10) : 20;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

    const results = await getSavedResults(userId, favoritesOnly, limit, offset);
    res.json({ success: true, saved: results, total: results.length, limit, offset });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/tryon/saved/:savedId
 * Body: note? (string), is_favorite? (boolean)
 */
export async function updateSaved(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const userId  = getUserId(req);
    const savedId = parseInt(req.params.savedId, 10);

    const updated = await updateSavedResult(savedId, userId, {
      note:        req.body.note,
      is_favorite: req.body.is_favorite !== undefined
        ? req.body.is_favorite === true || req.body.is_favorite === "true"
        : undefined,
    });

    if (!updated) {
      return res.status(404).json({ success: false, error: "Saved result not found" });
    }
    res.json({ success: true, saved: updated });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/tryon/saved/:savedId
 */
export async function deleteSaved(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const userId  = getUserId(req);
    const savedId = parseInt(req.params.savedId, 10);

    const deleted = await deleteSavedResult(savedId, userId);
    if (!deleted) {
      return res.status(404).json({ success: false, error: "Saved result not found" });
    }
    res.json({ success: true, message: "Saved result removed" });
  } catch (err) {
    next(err);
  }
}

// ============================================================================
// Service Status
// ============================================================================

/**
 * GET /api/tryon/service/health
 */
export async function serviceHealth(
  _req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const client    = getTryOnClient();
    const available = await client.isAvailable();
    const health    = await client.health();
    res.json({ success: true, available, ...health });
  } catch (err) {
    next(err);
  }
}
