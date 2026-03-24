/**
 * Try-On Service
 *
 * Business logic for virtual try-on: resolves garment sources,
 * calls the Vertex AI Virtual Try-On API, stores all images in R2.
 *
 * All create operations are non-blocking: job is inserted as 'pending'
 * and returned immediately; Vertex AI processing runs in the background.
 * 
 * New features:
 * - Exponential backoff retry with dead letter queue
 * - Webhook/push notifications (removes need for polling)
 * - Garment validation before submission
 * - Usage tracking for cost analytics
 */
import { config } from "../../config";
import { pg } from "../../lib/core/db";
import { getTryOnClient } from "../../lib/image/tryonClient";
import type { TryOnOptions } from "../../lib/image/tryonClient";
import { uploadImage, deleteImage } from "../../lib/image/r2";
import { 
  isRetryableError, 
  scheduleRetry, 
  trackTryOnUsage 
} from "../../lib/tryon/retryQueue";
import { 
  notifyJobCompleted, 
  notifyJobFailed, 
  notifyJobStarted 
} from "../../lib/tryon/webhooks";
import { validateGarment } from "../../lib/tryon/garmentValidation";

// ============================================================================
// Types
// ============================================================================

export interface TryOnJobRow {
  id: number;
  user_id: number;
  garment_source: string;
  garment_ref_id: number | null;
  garment_image_r2_key: string | null;
  garment_image_url: string | null;
  garment_description: string | null;
  person_image_r2_key: string | null;
  person_image_url: string | null;
  result_image_r2_key: string | null;
  result_image_url: string | null;
  category: string;
  status: string;
  error_message: string | null;
  processing_time_ms: number | null;
  inference_time_ms: number | null;
  seed_used: number | null;
  created_at: Date;
  completed_at: Date | null;
  expires_at: Date | null;
}

export interface SavedResultRow {
  id: number;
  user_id: number;
  tryon_job_id: number;
  note: string | null;
  is_favorite: boolean;
  created_at: Date;
}

export type SavedResultWithJob = SavedResultRow & { job: TryOnJobRow };

export interface PerformTryOnInput {
  userId: number;
  personImageBuffer: Buffer;
  personMimeType?: string;
  garmentImageBuffer?: Buffer;
  garmentId?: number;
  garmentSource: "wardrobe" | "product" | "upload";
  category: "upper_body" | "lower_body" | "dresses";
  garmentDescription?: string;
}

export interface BatchGarmentInput {
  garmentImageBuffer?: Buffer;
  garmentId?: number;
  garmentSource: "wardrobe" | "product" | "upload";
  category?: "upper_body" | "lower_body" | "dresses";
  garmentDescription?: string;
}

export interface PerformBatchTryOnInput {
  userId: number;
  personImageBuffer: Buffer;
  personMimeType?: string;
  garments: BatchGarmentInput[];
}

// ============================================================================
// Helpers
// ============================================================================

/** Detect MIME type from the first bytes of a buffer. */
function detectMimeType(buffer: Buffer): string {
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return "image/png";
  if (buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return "image/jpeg";
}

function mimeToExt(mimeType: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png":  "png",
    "image/webp": "webp",
  };
  return map[mimeType] ?? "jpg";
}

/** Per-user rate limit: max 10 try-on submissions per hour (checked via DB). */
const TRYON_RATE_LIMIT_PER_HOUR = 10;

async function checkRateLimit(userId: number, count = 1): Promise<void> {
  const result = await pg.query<{ count: string }>(
    `SELECT COUNT(*) FROM tryon_jobs
     WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
    [userId]
  );
  const used = parseInt(result.rows[0].count, 10);
  if (used + count > TRYON_RATE_LIMIT_PER_HOUR) {
    const err = new Error(
      `Try-on rate limit: max ${TRYON_RATE_LIMIT_PER_HOUR} per hour. ` +
      `Current usage: ${used}/${TRYON_RATE_LIMIT_PER_HOUR}`
    );
    (err as any).statusCode = 429;
    throw err;
  }
}

interface ResolvedGarment {
  buffer: Buffer;
  imageUrl: string | null;
  description: string;
}

/** Resolve garment image buffer + metadata from wardrobe, product, or direct upload. */
async function resolveGarment(input: PerformTryOnInput): Promise<ResolvedGarment> {
  let buffer = input.garmentImageBuffer;
  let imageUrl: string | null = null;
  let description = input.garmentDescription || "";

  if (!buffer && input.garmentId) {
    if (input.garmentSource === "wardrobe") {
      const row = await pg.query(
        `SELECT image_url, image_cdn, name, brand
         FROM wardrobe_items WHERE id = $1 AND user_id = $2`,
        [input.garmentId, input.userId]
      );
      if (!row.rows[0]) throw new Error("Wardrobe item not found");
      imageUrl = row.rows[0].image_cdn || row.rows[0].image_url;
      if (!imageUrl) throw new Error("Wardrobe item has no image");
      buffer = await downloadImage(imageUrl);
      if (!description) {
        description = [row.rows[0].name, row.rows[0].brand].filter(Boolean).join(" ");
      }
    } else if (input.garmentSource === "product") {
      const row = await pg.query(
        `SELECT p.image_cdn, p.image_url, p.title, p.brand,
                pi.cdn_url AS pi_cdn_url
         FROM products p
         LEFT JOIN product_images pi ON pi.id = p.primary_image_id
         WHERE p.id = $1`,
        [input.garmentId]
      );
      if (!row.rows[0]) throw new Error("Product not found");
      imageUrl =
        row.rows[0].pi_cdn_url ||
        row.rows[0].image_cdn   ||
        row.rows[0].image_url;
      if (!imageUrl) throw new Error("Product has no image");
      buffer = await downloadImage(imageUrl);
      if (!description) {
        description = [row.rows[0].title, row.rows[0].brand].filter(Boolean).join(" ");
      }
    }
  }

  if (!buffer) throw new Error("Could not resolve garment image");
  return { buffer, imageUrl, description };
}

// ============================================================================
// Background job processor
// ============================================================================

interface JobProcessOpts {
  jobId: number;
  userId: number;
  personBuffer: Buffer;
  personMimeType: string;
  garmentBuffer: Buffer;
  garmentSource: string;
  tryonOpts: TryOnOptions & { category: string };
}

async function processJobInBackground(opts: JobProcessOpts, attempt: number = 1): Promise<void> {
  const {
    jobId, userId, personBuffer, personMimeType,
    garmentBuffer, garmentSource, tryonOpts,
  } = opts;

  const client = getTryOnClient();

  // Mark processing and notify
  await pg.query(
    `UPDATE tryon_jobs SET status = 'processing' WHERE id = $1`,
    [jobId]
  );
  await notifyJobStarted(jobId, userId);

  try {
    // 1. Upload garment image to R2 for permanent reference
    const garmentMime = detectMimeType(garmentBuffer);
    const garmentR2Key = `tryon/${userId}/garment-${Date.now()}-${jobId}.${mimeToExt(garmentMime)}`;
    const garmentUpload = await uploadImage(garmentBuffer, garmentR2Key, garmentMime);

    // 2. Call Vertex AI Virtual Try-On
    const tryonResult = await client.tryOnFromBuffers(personBuffer, garmentBuffer, tryonOpts);

    // 3. Upload result image
    const resultBuffer = Buffer.from(tryonResult.image_base64, "base64");
    const resultR2Key = `tryon/${userId}/result-${Date.now()}-${jobId}.png`;
    const resultUpload = await uploadImage(resultBuffer, resultR2Key, "image/png");

    // 4. Upload person image
    const personExt = mimeToExt(personMimeType);
    const personR2Key = `tryon/${userId}/person-${Date.now()}-${jobId}.${personExt}`;
    const personUpload = await uploadImage(personBuffer, personR2Key, personMimeType);

    // 5. Update job as completed
    await pg.query<TryOnJobRow>(
      `UPDATE tryon_jobs
       SET status               = 'completed',
           result_image_r2_key  = $1,
           result_image_url     = $2,
           person_image_r2_key  = $3,
           person_image_url     = $4,
           garment_image_r2_key = $5,
           garment_image_url    = COALESCE(garment_image_url, $6),
           processing_time_ms   = $7,
           inference_time_ms    = $8,
           seed_used            = $9,
           completed_at         = NOW()
       WHERE id = $10`,
      [
        resultR2Key,
        resultUpload.cdnUrl,
        personR2Key,
        personUpload.cdnUrl,
        garmentR2Key,
        garmentUpload.cdnUrl,
        tryonResult.processing_time_ms,
        tryonResult.inference_time_ms,
        tryonResult.seed_used,
        jobId,
      ]
    );
    
    // Track usage and notify success
    await trackTryOnUsage(userId, tryonResult.processing_time_ms, true);
    await notifyJobCompleted(jobId, userId, resultUpload.cdnUrl);
    
  } catch (err: any) {
    console.error(`[TryOn] Job ${jobId} failed (attempt ${attempt}):`, err.message);
    
    // Check if error is retryable
    if (isRetryableError(err) && attempt < 3) {
      // Schedule retry with exponential backoff
      await scheduleRetry(jobId, userId, err.message, attempt);
      return;
    }
    
    // Permanent failure
    await pg.query(
      `UPDATE tryon_jobs SET status = 'failed', error_message = $1 WHERE id = $2`,
      [err.message?.slice(0, 500), jobId]
    );
    
    // Track usage and notify failure
    await trackTryOnUsage(userId, 0, false);
    await notifyJobFailed(jobId, userId, err.message);
  }
}

/**
 * Fire-and-forget after HTTP response works on a long-running Node server, but on
 * Google Cloud Run the instance often loses CPU as soon as the response is sent,
 * so `setImmediate` jobs never run and jobs stay `pending` forever.
 *
 * - Set TRYON_INLINE_PROCESSING=true to always await Vertex processing before returning.
 * - Set TRYON_INLINE_PROCESSING=false to force async (worker / local dev with background CPU).
 * - If unset, defaults to inline on Cloud Run (`K_SERVICE`) or Render (`RENDER`).
 */
function shouldProcessTryOnInline(): boolean {
  const v = process.env.TRYON_INLINE_PROCESSING?.trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  return Boolean(process.env.K_SERVICE || process.env.RENDER);
}

async function scheduleTryOnProcessing(
  opts: JobProcessOpts,
  inline: boolean
): Promise<void> {
  if (inline) {
    await processJobInBackground(opts);
    return;
  }
  setImmediate(() => {
    processJobInBackground(opts).catch(() => {
      /* logged inside processJobInBackground */
    });
  });
}

// ============================================================================
// Core try-on logic
// ============================================================================

export async function performTryOn(input: PerformTryOnInput): Promise<TryOnJobRow> {
  const project = config.tryon.project?.trim();
  if (!project) {
    const err = new Error(
      "Virtual try-on is not configured: set GCLOUD_PROJECT or GOOGLE_CLOUD_PROJECT on the API server and grant Vertex AI access to the runtime service account."
    );
    (err as any).statusCode = 503;
    throw err;
  }

  await checkRateLimit(input.userId);

  const { buffer: garmentBuffer, imageUrl: garmentImageUrl, description: garmentDescription } =
    await resolveGarment(input);
  
  // Validate garment category before submitting to Vertex AI
  const validation = validateGarment(garmentDescription, undefined, input.category);
  if (!validation.valid) {
    const err = new Error(validation.error || "Unsupported garment type for virtual try-on");
    (err as any).statusCode = 400;
    (err as any).suggestion = validation.suggestion;
    throw err;
  }

  // Insert as pending — return immediately; processing happens in background
  const jobRow = await pg.query<TryOnJobRow>(
    `INSERT INTO tryon_jobs
       (user_id, garment_source, garment_ref_id, garment_image_url,
        garment_description, category, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending')
     RETURNING *`,
    [
      input.userId,
      input.garmentSource,
      input.garmentId ?? null,
      garmentImageUrl,
      garmentDescription,
      input.category,
    ]
  );
  const job = jobRow.rows[0];
  const inline = shouldProcessTryOnInline();

  await scheduleTryOnProcessing(
    {
      jobId: job.id,
      userId: input.userId,
      personBuffer: input.personImageBuffer,
      personMimeType: input.personMimeType ?? detectMimeType(input.personImageBuffer),
      garmentBuffer,
      garmentSource: input.garmentSource,
      tryonOpts: {
        garmentDescription,
        category: input.category,
      },
    },
    inline
  );

  if (inline) {
    const refreshed = await getTryOnJob(job.id, input.userId);
    return refreshed ?? job;
  }

  return job;
}

export async function performBatchTryOn(
  input: PerformBatchTryOnInput
): Promise<TryOnJobRow[]> {
  const project = config.tryon.project?.trim();
  if (!project) {
    const err = new Error(
      "Virtual try-on is not configured: set GCLOUD_PROJECT or GOOGLE_CLOUD_PROJECT on the API server."
    );
    (err as any).statusCode = 503;
    throw err;
  }

  if (input.garments.length === 0) {
    const err = new Error("At least one garment is required");
    (err as any).statusCode = 400;
    throw err;
  }
  if (input.garments.length > 5) {
    const err = new Error("Batch try-on is limited to 5 garments at a time");
    (err as any).statusCode = 400;
    throw err;
  }

  // Single rate-limit check for the entire batch
  await checkRateLimit(input.userId, input.garments.length);

  const personMimeType =
    input.personMimeType ?? detectMimeType(input.personImageBuffer);
  const inline = shouldProcessTryOnInline();

  const jobs = await Promise.all(
    input.garments.map(async (g) => {
      const singleInput: PerformTryOnInput = {
        userId:            input.userId,
        personImageBuffer: input.personImageBuffer,
        personMimeType,
        garmentImageBuffer: g.garmentImageBuffer,
        garmentId:          g.garmentId,
        garmentSource:      g.garmentSource,
        category:           g.category ?? "upper_body",
        garmentDescription: g.garmentDescription,
      };

      const { buffer: garmentBuffer, imageUrl: garmentImageUrl, description: garmentDescription } =
        await resolveGarment(singleInput);

      const row = await pg.query<TryOnJobRow>(
        `INSERT INTO tryon_jobs
           (user_id, garment_source, garment_ref_id, garment_image_url,
            garment_description, category, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending')
         RETURNING *`,
        [
          input.userId,
          g.garmentSource,
          g.garmentId ?? null,
          garmentImageUrl,
          garmentDescription,
          g.category ?? "upper_body",
        ]
      );
      const job = row.rows[0];

      await scheduleTryOnProcessing(
        {
          jobId: job.id,
          userId: input.userId,
          personBuffer: input.personImageBuffer,
          personMimeType,
          garmentBuffer,
          garmentSource: g.garmentSource,
          tryonOpts: {
            garmentDescription,
            category: g.category ?? "upper_body",
          },
        },
        inline
      );

      if (inline) {
        const refreshed = await getTryOnJob(job.id, input.userId);
        return refreshed ?? job;
      }
      return job;
    })
  );

  return jobs;
}

export async function cancelTryOnJob(
  jobId: number,
  userId: number
): Promise<boolean> {
  const result = await pg.query(
    `UPDATE tryon_jobs
     SET status = 'failed', error_message = 'Cancelled by user'
     WHERE id = $1 AND user_id = $2 AND status = 'pending'
     RETURNING id`,
    [jobId, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

// ============================================================================
// History / retrieval
// ============================================================================

export async function getTryOnHistory(
  userId: number,
  limit = 20,
  offset = 0,
  status?: string
): Promise<{ jobs: TryOnJobRow[]; total: number }> {
  const statusFilter = status ? `AND status = $4` : "";
  const params: (number | string)[] = status
    ? [userId, limit, offset, status]
    : [userId, limit, offset];

  const countResult = await pg.query<{ count: string }>(
    `SELECT COUNT(*) FROM tryon_jobs WHERE user_id = $1 ${status ? "AND status = $2" : ""}`,
    status ? [userId, status] : [userId]
  );

  const result = await pg.query<TryOnJobRow>(
    `SELECT * FROM tryon_jobs
     WHERE user_id = $1 ${statusFilter}
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    params
  );

  return {
    jobs:  result.rows,
    total: parseInt(countResult.rows[0].count, 10),
  };
}

export async function getTryOnJob(
  jobId: number,
  userId: number
): Promise<TryOnJobRow | null> {
  const result = await pg.query<TryOnJobRow>(
    `SELECT * FROM tryon_jobs WHERE id = $1 AND user_id = $2`,
    [jobId, userId]
  );
  return result.rows[0] ?? null;
}

export async function deleteTryOnJob(
  jobId: number,
  userId: number
): Promise<boolean> {
  const job = await getTryOnJob(jobId, userId);
  if (!job) return false;

  // Clean up R2 objects
  const keysToDelete = [
    job.result_image_r2_key,
    job.person_image_r2_key,
    job.garment_image_r2_key,
  ].filter(Boolean) as string[];

  for (const key of keysToDelete) {
    try { await deleteImage(key); } catch { /* ignore R2 cleanup errors */ }
  }

  const result = await pg.query(
    `DELETE FROM tryon_jobs WHERE id = $1 AND user_id = $2`,
    [jobId, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

// ============================================================================
// Saved results (bookmarks / favourites)
// ============================================================================

export async function saveTryOnResult(
  jobId: number,
  userId: number,
  note?: string,
  isFavorite = false
): Promise<SavedResultRow> {
  // Verify the job belongs to the user
  const job = await getTryOnJob(jobId, userId);
  if (!job) {
    const err = new Error("Try-on job not found");
    (err as any).statusCode = 404;
    throw err;
  }
  if (job.status !== "completed") {
    const err = new Error("Only completed try-on results can be saved");
    (err as any).statusCode = 400;
    throw err;
  }

  const result = await pg.query<SavedResultRow>(
    `INSERT INTO tryon_saved_results (user_id, tryon_job_id, note, is_favorite)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, tryon_job_id)
       DO UPDATE SET note = EXCLUDED.note, is_favorite = EXCLUDED.is_favorite
     RETURNING *`,
    [userId, jobId, note ?? null, isFavorite]
  );
  return result.rows[0];
}

export async function getSavedResults(
  userId: number,
  favoritesOnly = false,
  limit = 20,
  offset = 0
): Promise<SavedResultWithJob[]> {
  const result = await pg.query(
    `SELECT
       s.id, s.user_id, s.tryon_job_id, s.note, s.is_favorite, s.created_at,
       row_to_json(j.*) AS job
     FROM tryon_saved_results s
     JOIN tryon_jobs j ON j.id = s.tryon_job_id
     WHERE s.user_id = $1
       AND ($2::boolean IS FALSE OR s.is_favorite = TRUE)
     ORDER BY s.created_at DESC
     LIMIT $3 OFFSET $4`,
    [userId, favoritesOnly, limit, offset]
  );
  return result.rows as SavedResultWithJob[];
}

export async function updateSavedResult(
  savedId: number,
  userId: number,
  updates: { note?: string; is_favorite?: boolean }
): Promise<SavedResultRow | null> {
  const sets: string[] = [];
  const values: (string | boolean | number)[] = [];
  let i = 1;

  if (updates.note !== undefined) {
    sets.push(`note = $${i++}`);
    values.push(updates.note);
  }
  if (updates.is_favorite !== undefined) {
    sets.push(`is_favorite = $${i++}`);
    values.push(updates.is_favorite);
  }
  if (sets.length === 0) return null;

  values.push(savedId, userId);
  const result = await pg.query<SavedResultRow>(
    `UPDATE tryon_saved_results
     SET ${sets.join(", ")}
     WHERE id = $${i} AND user_id = $${i + 1}
     RETURNING *`,
    values
  );
  return result.rows[0] ?? null;
}

export async function deleteSavedResult(
  savedId: number,
  userId: number
): Promise<boolean> {
  const result = await pg.query(
    `DELETE FROM tryon_saved_results WHERE id = $1 AND user_id = $2`,
    [savedId, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

// ============================================================================
// Helpers
// ============================================================================

async function downloadImage(url: string): Promise<Buffer> {
  const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!resp.ok) {
    throw new Error(`Failed to download image from ${url}: ${resp.status}`);
  }
  return Buffer.from(await resp.arrayBuffer());
}
