/**
 * Ingest Service
 * Business logic for image ingestion
 */
import { randomUUID } from "node:crypto";
import { pg } from "../../lib/core";
import { uploadImage } from "../../lib/image";
import { upstashSet } from "../../lib/queue";

// ============================================================================
// Types
// ============================================================================

export interface IngestJob {
  job_uuid: string;
  user_id: number | null;
  source: string;
  r2_key: string;
  cdn_url: string;
  filename: string;
  status: "queued" | "processing" | "completed" | "failed";
  attempts: number;
  result_json?: any;
  error_message?: string;
  created_at: Date;
  updated_at: Date;
}

export interface CreateIngestJobInput {
  imageBuffer: Buffer;
  userId?: number | null;
  filename?: string;
  mimetype?: string;
}

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Create a new ingest job
 */
export async function createIngestJob(input: CreateIngestJobInput): Promise<{ jobId: string; cdnUrl: string }> {
  const { imageBuffer, userId = null, filename = "upload.jpg", mimetype = "image/jpeg" } = input;
  const jobUuid = randomUUID();

  // Upload raw image to R2 immediately (so worker can fetch)
  const { key, cdnUrl } = await uploadImage(imageBuffer, undefined, mimetype);

  // Insert job record (idempotent by job_uuid)
  await pg.query(
    `INSERT INTO ingest_jobs(job_uuid, user_id, source, r2_key, cdn_url, filename, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (job_uuid) DO NOTHING`,
    [jobUuid, userId, "uploaded", key, cdnUrl, filename, "queued"]
  );

  // Enqueue job using Upstash REST API
  try {
    // Store job data
    await upstashSet(`ingest-job:${jobUuid}`, JSON.stringify({ job_uuid: jobUuid, user_id: userId, r2_key: key, cdn_url: cdnUrl, filename }));

    // Add job UUID to ingest-job-queue list
    const queueRes = await upstashGet("ingest-job-queue");
    let jobQueue: string[] = [];
    if (queueRes.result) {
      try {
        jobQueue = JSON.parse(queueRes.result);
      } catch (e) {
        jobQueue = [];
      }
    }
    jobQueue.push(jobUuid);
    await upstashSet("ingest-job-queue", JSON.stringify(jobQueue));
  } catch (err) {
    console.warn("[Ingest] Could not enqueue job (Upstash REST unavailable):", (err as Error).message);
    // Job is still recorded in database, can be processed later
  }

  return { jobId: jobUuid, cdnUrl };
}

/**
 * Get an ingest job by ID
 */
export async function getIngestJob(jobId: string): Promise<IngestJob | null> {
  const result = await pg.query<IngestJob>(
    `SELECT job_uuid, user_id, source, r2_key, cdn_url, filename, status, attempts, result_json, error_message, created_at, updated_at
     FROM ingest_jobs WHERE job_uuid = $1 LIMIT 1`,
    [jobId]
  );

  return result.rows[0] || null;
}

/**
 * Get all ingest jobs for a user
 */
export async function getUserIngestJobs(userId: number, limit = 50, offset = 0): Promise<IngestJob[]> {
  const result = await pg.query<IngestJob>(
    `SELECT job_uuid, user_id, source, r2_key, cdn_url, filename, status, attempts, result_json, error_message, created_at, updated_at
     FROM ingest_jobs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );

  return result.rows;
}

/**
 * Update ingest job status
 */
export async function updateIngestJobStatus(
  jobId: string,
  status: IngestJob["status"],
  resultJson?: any,
  errorMessage?: string
): Promise<void> {
  await pg.query(
    `UPDATE ingest_jobs SET status = $2, result_json = $3, error_message = $4, updated_at = NOW()
     WHERE job_uuid = $1`,
    [jobId, status, resultJson ? JSON.stringify(resultJson) : null, errorMessage || null]
  );
}
