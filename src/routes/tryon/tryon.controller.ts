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
import {
  registerWebhook,
  getWebhookConfig,
  disableWebhook,
  deleteWebhook,
} from "../../lib/tryon/webhooks";
import {
  getDeadLetterEntries,
  retryFromDeadLetter,
  processRetryQueue,
} from "../../lib/tryon/retryQueue";
import { validateGarment } from "../../lib/tryon/garmentValidation";

// ============================================================================
// Shared helpers
// ============================================================================

function httpError(statusCode: number, message: string): Error {
  const err = new Error(message);
  (err as any).statusCode = statusCode;
  return err;
}

/**
 * Resolves the signed-in user for try-on quotas and job ownership.
 * Without this, Postgres rejects the job row and the client only sees a generic 500.
 *
 * Prefer `x-user-id` (or `user_id` in form/query). For demos, set TRYON_DEMO_USER_ID
 * on the server when the app has no auth yet.
 */
function getUserId(req: Request): number {
  if (req.user?.id != null && Number.isFinite(req.user.id) && req.user.id >= 1) {
    return req.user.id;
  }
  const rawHeader =
    req.headers["x-user-id"] ?? req.query.user_id ?? req.body?.user_id;
  const trimmed =
    rawHeader !== undefined && rawHeader !== null && String(rawHeader).trim() !== ""
      ? String(rawHeader).trim()
      : "";
  const demo = process.env.TRYON_DEMO_USER_ID?.trim();
  const raw =
    trimmed ||
    (demo && /^\d+$/.test(demo) ? demo : "");

  if (!raw) {
    throw httpError(
      400,
      "User ID required: send x-user-id header or user_id in the form body. " +
        "For unauthenticated demos, set TRYON_DEMO_USER_ID on the server.",
    );
  }

  const id = parseInt(raw, 10);
  if (!Number.isFinite(id) || id < 1) {
    throw httpError(400, "Invalid user_id: must be a positive integer");
  }
  return id;
}

const PERSON_FIELD_ORDER = [
  "person_image",
  "person",
  "model",
  "model_image",
] as const;
const GARMENT_FIELD_ORDER = [
  "garment_image",
  "garment",
  "clothing",
] as const;

function filesMap(
  req: Request,
): { [fieldname: string]: Express.Multer.File[] } | undefined {
  return req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
}

function pickFirstUploadedFile(
  req: Request,
  names: readonly string[],
): Express.Multer.File | undefined {
  const files = filesMap(req);
  for (const n of names) {
    const f = files?.[n]?.[0];
    if (f) return f;
  }
  return (req as Express.Request & { file?: Express.Multer.File }).file;
}

const ALLOWED_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Image size constraints (in bytes) */
const MIN_IMAGE_SIZE = 10 * 1024;      // 10 KB
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB
const RECOMMENDED_MAX = 5 * 1024 * 1024; // 5 MB for performance

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
  if (file.size < MIN_IMAGE_SIZE) {
    const err = new Error(`${fieldName} is too small (${file.size} bytes, minimum ${MIN_IMAGE_SIZE} bytes)`);
    (err as any).statusCode = 400;
    throw err;
  }
  if (file.size > MAX_IMAGE_SIZE) {
    const err = new Error(
      `${fieldName} is too large (${(file.size / 1024 / 1024).toFixed(2)} MB, maximum 10 MB)`
    );
    (err as any).statusCode = 413;
    throw err;
  }
  if (file.size > RECOMMENDED_MAX) {
    console.warn(
      `[TryOn] ${fieldName} is larger than recommended (${(file.size / 1024 / 1024).toFixed(2)} MB > 5 MB). ` +
      `Processing may be slower.`
    );
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

    const personFile = pickFirstUploadedFile(req, PERSON_FIELD_ORDER);
    const garmentFile = pickFirstUploadedFile(req, GARMENT_FIELD_ORDER);

    if (!personFile) {
      return res.status(400).json({
        success: false,
        error: {
          message: "Person image is required",
          code: "MISSING_PERSON_IMAGE",
          details: {
            allowedFields: ["person_image", "person", "model", "model_image"],
            example: "Use form field 'person_image' with your image file"
          }
        }
      });
    }

    try {
      validateImageFile(personFile, "Person image");
      if (garmentFile) validateImageFile(garmentFile, "Garment image");
    } catch (validationErr: any) {
      return res.status(validationErr.statusCode || 400).json({
        success: false,
        error: {
          message: validationErr.message,
          code: "INVALID_IMAGE",
          details: { maxSize: `${RECOMMENDED_MAX / 1024 / 1024}MB recommended` }
        }
      });
    }

    const garmentId = req.body.garment_id
      ? parseInt(req.body.garment_id, 10)
      : undefined;
    const garmentSource = req.body.garment_source || "upload";
    const category = req.body.category || "upper_body";

    if (!garmentFile && !garmentId) {
      return res.status(400).json({
        success: false,
        error: {
          message: "Either garment image or garment ID is required",
          code: "MISSING_GARMENT",
          details: {
            options: ["Upload garment_image file", "Provide garment_id from product/wardrobe"]
          }
        }
      });
    }

    // Log try-on attempt
    console.log(`[TryOn] Starting try-on for user ${userId}, category: ${category}, source: ${garmentSource}`);

    const job = await performTryOn({
      userId,
      personImageBuffer: personFile.buffer,
      personMimeType:    personFile.mimetype,
      garmentImageBuffer: garmentFile?.buffer,
      garmentId,
      garmentSource: garmentSource as "upload" | "product" | "wardrobe",
      category: category as "upper_body" | "lower_body" | "dresses",
      garmentDescription: req.body.garment_description,
    });

    res.status(202).json({
      success: true,
      data: { job, jobId: job.id },
      meta: {
        statusUrl: `/api/tryon/${job.id}`,
        estimatedWaitTime: "30-120 seconds"
      }
    });
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
    const userId = getUserId(req);
    const personFile = pickFirstUploadedFile(req, PERSON_FIELD_ORDER);
    if (!personFile) {
      return res.status(400).json({
        success: false,
        error:
          "Person image required (multipart field: person_image, person, model, or model_image)",
      });
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
    const userId = getUserId(req);
    const personFile = pickFirstUploadedFile(req, PERSON_FIELD_ORDER);
    if (!personFile) {
      return res.status(400).json({
        success: false,
        error:
          "Person image required (multipart field: person_image, person, model, or model_image)",
      });
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

    res.status(202).json({ success: true, job, jobId: job.id });
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
    const userId = getUserId(req);
    const personFile = pickFirstUploadedFile(req, PERSON_FIELD_ORDER);
    const files = filesMap(req);

    if (!personFile) {
      return res.status(400).json({
        success: false,
        error:
          "Person image required (multipart field: person_image, person, model, or model_image)",
      });
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

// ============================================================================
// Webhook Management
// ============================================================================

/**
 * POST /api/tryon/webhooks
 * Body: { url: string, secret: string, events?: string[] }
 */
export async function createWebhook(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const userId = getUserId(req);
    const { url, secret, events } = req.body;
    
    if (!url || !secret) {
      return res.status(400).json({ 
        success: false, 
        error: "url and secret are required" 
      });
    }
    
    const webhook = await registerWebhook(userId, url, secret, events);
    res.status(201).json({ success: true, webhook });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/tryon/webhooks
 */
export async function getWebhook(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const userId = getUserId(req);
    const config = await getWebhookConfig(userId);
    
    if (!config) {
      return res.status(404).json({ 
        success: false, 
        error: "No webhook configured" 
      });
    }
    
    res.json({ success: true, webhook: config });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/tryon/webhooks
 */
export async function removeWebhook(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const userId = getUserId(req);
    await deleteWebhook(userId);
    res.json({ success: true, message: "Webhook removed" });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/tryon/webhooks/disable
 */
export async function pauseWebhook(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const userId = getUserId(req);
    await disableWebhook(userId);
    res.json({ success: true, message: "Webhook disabled" });
  } catch (err) {
    next(err);
  }
}

// ============================================================================
// Garment Validation (pre-check before submission)
// ============================================================================

/**
 * POST /api/tryon/validate
 * Body: { title: string, description?: string, category?: string }
 */
export async function validateGarmentEndpoint(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const { title, description, category } = req.body;
    
    if (!title) {
      return res.status(400).json({
        success: false,
        error: "title is required",
      });
    }
    
    const result = validateGarment(title, description, category);
    res.json({ success: true, validation: result });
  } catch (err) {
    next(err);
  }
}

// ============================================================================
// Dead Letter Queue Management (Admin)
// ============================================================================

/**
 * GET /api/tryon/admin/dlq
 * Query: limit? (default: 50)
 */
export async function getDLQ(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const entries = await getDeadLetterEntries(limit);
    res.json({ success: true, entries, count: entries.length });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/tryon/admin/dlq/:jobId/retry
 */
export async function retryDLQJob(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const jobId = parseInt(req.params.jobId, 10);
    const success = await retryFromDeadLetter(jobId);
    
    if (success) {
      res.json({ success: true, message: "Job queued for retry" });
    } else {
      res.status(404).json({ success: false, error: "Job not found in DLQ" });
    }
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/tryon/admin/process-retries
 * Manually trigger retry queue processing
 */
export async function processRetries(
  _req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const result = await processRetryQueue();
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}
