/**
 * Try-On Job Retry Queue with Dead Letter Queue
 * 
 * Implements exponential backoff retry for Vertex AI failures
 * with dead letter queue for failed jobs.
 */

import { pg } from "../core/db";
import { getRedis, isRedisAvailable } from "../redis";
import { getTryOnClient } from "../image/tryonClient";
import { uploadImage } from "../image/r2";

// ============================================================================
// Types
// ============================================================================

export interface RetryableJob {
  jobId: number;
  userId: number;
  personR2Key: string;
  garmentR2Key: string;
  garmentDescription: string;
  category: string;
  attempt: number;
  lastError: string;
  scheduledAt: number;
}

export interface DeadLetterEntry {
  jobId: number;
  userId: number;
  error: string;
  attempts: number;
  failedAt: number;
  canRetry: boolean;
}

// ============================================================================
// Configuration
// ============================================================================

const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 2000,        // 2 seconds
  maxDelayMs: 60000,        // 1 minute
  retryableStatusCodes: [429, 503, 504],
  retryableErrors: ["timeout", "econnreset", "network", "rate limit"],
};

const REDIS_KEYS = {
  retryQueue: "tryon:retry:queue",
  deadLetter: "tryon:dlq",
  processing: "tryon:retry:processing",
};

// ============================================================================
// Retry Logic
// ============================================================================

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: any): boolean {
  const message = (error.message || "").toLowerCase();
  const statusCode = error.statusCode || error.status;
  
  // Check status codes
  if (statusCode && RETRY_CONFIG.retryableStatusCodes.includes(statusCode)) {
    return true;
  }
  
  // Check error messages
  for (const pattern of RETRY_CONFIG.retryableErrors) {
    if (message.includes(pattern)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Calculate delay for retry attempt (exponential backoff)
 */
export function calculateRetryDelay(attempt: number): number {
  const delay = RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt - 1);
  return Math.min(delay, RETRY_CONFIG.maxDelayMs);
}

/**
 * Schedule a job for retry
 */
export async function scheduleRetry(
  jobId: number,
  userId: number,
  error: string,
  attempt: number
): Promise<boolean> {
  if (attempt >= RETRY_CONFIG.maxRetries) {
    await moveToDeadLetter(jobId, userId, error, attempt);
    return false;
  }
  
  const delay = calculateRetryDelay(attempt + 1);
  const scheduledAt = Date.now() + delay;
  
  // Update job in database
  await pg.query(
    `UPDATE tryon_jobs SET 
       retry_count = $1,
       last_error = $2,
       next_retry_at = to_timestamp($3 / 1000.0),
       status = 'retry_scheduled'
     WHERE id = $4`,
    [attempt + 1, error, scheduledAt, jobId]
  );
  
  // Add to Redis queue if available
  if (isRedisAvailable()) {
    const redis = getRedis();
    if (redis) {
      const entry: RetryableJob = {
        jobId,
        userId,
        personR2Key: "", // Will be fetched from DB
        garmentR2Key: "",
        garmentDescription: "",
        category: "upper_body",
        attempt: attempt + 1,
        lastError: error,
        scheduledAt,
      };
      
      await redis.zadd(REDIS_KEYS.retryQueue, {
        score: scheduledAt,
        member: JSON.stringify(entry),
      });
    }
  }
  
  console.info(`[TryOn] Job ${jobId} scheduled for retry ${attempt + 1} in ${delay}ms`);
  return true;
}

/**
 * Move failed job to dead letter queue
 */
export async function moveToDeadLetter(
  jobId: number,
  userId: number,
  error: string,
  attempts: number
): Promise<void> {
  // Update job status
  await pg.query(
    `UPDATE tryon_jobs SET 
       status = 'failed_permanent',
       error_message = $1,
       retry_count = $2
     WHERE id = $3`,
    [`[DLQ] ${error}`, attempts, jobId]
  );
  
  // Add to Redis DLQ if available
  if (isRedisAvailable()) {
    const redis = getRedis();
    if (redis) {
      const entry: DeadLetterEntry = {
        jobId,
        userId,
        error,
        attempts,
        failedAt: Date.now(),
        canRetry: false,
      };
      
      await redis.lpush(REDIS_KEYS.deadLetter, JSON.stringify(entry));
    }
  }
  
  console.warn(`[TryOn] Job ${jobId} moved to DLQ after ${attempts} attempts: ${error}`);
}

/**
 * Process retry queue (call periodically)
 */
export async function processRetryQueue(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
}> {
  if (!isRedisAvailable()) {
    return await processRetryQueueFromDB();
  }
  
  const redis = getRedis();
  if (!redis) {
    return await processRetryQueueFromDB();
  }
  
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  
  const now = Date.now();
  
  // Get jobs ready for retry
  const entries = await redis.zrangebyscore<string[]>(
    REDIS_KEYS.retryQueue,
    0,
    now,
    { offset: 0, count: 10 }
  );
  
  for (const entry of entries) {
    const job: RetryableJob = JSON.parse(entry);
    
    // Remove from queue
    await redis.zrem(REDIS_KEYS.retryQueue, entry);
    
    try {
      await executeRetry(job.jobId, job.attempt);
      succeeded++;
    } catch (err: any) {
      if (isRetryableError(err) && job.attempt < RETRY_CONFIG.maxRetries) {
        await scheduleRetry(job.jobId, job.userId, err.message, job.attempt);
      } else {
        await moveToDeadLetter(job.jobId, job.userId, err.message, job.attempt);
      }
      failed++;
    }
    
    processed++;
  }
  
  return { processed, succeeded, failed };
}

/**
 * Process retry queue from database (fallback when Redis unavailable)
 */
async function processRetryQueueFromDB(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
}> {
  const result = await pg.query<{ id: number; retry_count: number }>(
    `SELECT id, retry_count FROM tryon_jobs
     WHERE status = 'retry_scheduled'
       AND next_retry_at <= NOW()
     LIMIT 10`
  );
  
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  
  for (const row of result.rows) {
    try {
      await executeRetry(row.id, row.retry_count);
      succeeded++;
    } catch (err: any) {
      failed++;
    }
    processed++;
  }
  
  return { processed, succeeded, failed };
}

/**
 * Execute a retry for a job
 */
async function executeRetry(jobId: number, _attempt: number): Promise<void> {
  // Fetch job details
  const jobResult = await pg.query(
    `SELECT * FROM tryon_jobs WHERE id = $1`,
    [jobId]
  );
  
  if (jobResult.rows.length === 0) {
    throw new Error(`Job ${jobId} not found`);
  }
  
  const job = jobResult.rows[0];
  
  // Update status to processing
  await pg.query(
    `UPDATE tryon_jobs SET status = 'processing' WHERE id = $1`,
    [jobId]
  );
  
  // Download images from R2
  const [personBuffer, garmentBuffer] = await Promise.all([
    downloadFromR2(job.person_image_r2_key),
    downloadFromR2(job.garment_image_r2_key),
  ]);
  
  // Call Vertex AI
  const client = getTryOnClient();
  const result = await client.tryOnFromBuffers(personBuffer, garmentBuffer, {
    category: job.category,
    garmentDescription: job.garment_description,
  });
  
  // Upload result
  const resultBuffer = Buffer.from(result.image_base64, "base64");
  const resultR2Key = `tryon/${job.user_id}/result-${Date.now()}-${jobId}.png`;
  const resultUpload = await uploadImage(resultBuffer, resultR2Key, "image/png");
  
  // Update job as completed
  await pg.query(
    `UPDATE tryon_jobs SET
       status = 'completed',
       result_image_r2_key = $1,
       result_image_url = $2,
       processing_time_ms = $3,
       completed_at = NOW()
     WHERE id = $4`,
    [resultR2Key, resultUpload.cdnUrl, result.processing_time_ms, jobId]
  );
  
  console.info(`[TryOn] Job ${jobId} completed on retry`);
}

/**
 * Download image from R2
 */
async function downloadFromR2(key: string): Promise<Buffer> {
  // This would use the R2 client to download
  // Placeholder implementation
  const r2Url = `${process.env.R2_PUBLIC_URL}/${key}`;
  const response = await fetch(r2Url, { signal: AbortSignal.timeout(15000) });
  
  if (!response.ok) {
    throw new Error(`Failed to download from R2: ${response.status}`);
  }
  
  return Buffer.from(await response.arrayBuffer());
}

// ============================================================================
// DLQ Management
// ============================================================================

/**
 * Get dead letter queue entries
 */
export async function getDeadLetterEntries(
  limit: number = 50
): Promise<DeadLetterEntry[]> {
  if (!isRedisAvailable()) {
    // Fall back to database
    const result = await pg.query(
      `SELECT id as "jobId", user_id as "userId", error_message as error,
              retry_count as attempts, updated_at as "failedAt"
       FROM tryon_jobs
       WHERE status = 'failed_permanent'
       ORDER BY updated_at DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  }
  
  const redis = getRedis();
  if (!redis) return [];
  
  const entries = await redis.lrange<string>(REDIS_KEYS.deadLetter, 0, limit - 1);
  return entries.map(e => JSON.parse(e));
}

/**
 * Retry a job from the dead letter queue
 */
export async function retryFromDeadLetter(jobId: number): Promise<boolean> {
  // Reset job for retry
  await pg.query(
    `UPDATE tryon_jobs SET
       status = 'retry_scheduled',
       retry_count = 0,
       next_retry_at = NOW()
     WHERE id = $1`,
    [jobId]
  );
  
  // Remove from DLQ if in Redis
  if (isRedisAvailable()) {
    const redis = getRedis();
    if (redis) {
      const entries = await redis.lrange<string>(REDIS_KEYS.deadLetter, 0, -1);
      for (const entry of entries) {
        const parsed: DeadLetterEntry = JSON.parse(entry);
        if (parsed.jobId === jobId) {
          await redis.lrem(REDIS_KEYS.deadLetter, 1, entry);
          break;
        }
      }
    }
  }
  
  // Queue for immediate processing
  await processRetryQueue();
  
  return true;
}

/**
 * Clear dead letter queue
 */
export async function clearDeadLetterQueue(): Promise<number> {
  if (!isRedisAvailable()) {
    const result = await pg.query(
      `UPDATE tryon_jobs SET status = 'failed_cleared' WHERE status = 'failed_permanent'`
    );
    return result.rowCount ?? 0;
  }
  
  const redis = getRedis();
  if (!redis) return 0;
  
  const length = await redis.llen(REDIS_KEYS.deadLetter);
  await redis.del(REDIS_KEYS.deadLetter);
  
  return length;
}

// ============================================================================
// Usage Tracking
// ============================================================================

/**
 * Track try-on usage for cost analytics
 */
export async function trackTryOnUsage(
  userId: number,
  processingTimeMs: number,
  success: boolean
): Promise<void> {
  const period = new Date().toISOString().slice(0, 7); // YYYY-MM
  const estimatedCost = 0.004; // ~$0.004 per try-on
  
  await pg.query(
    `INSERT INTO tryon_usage (user_id, period, total_jobs, successful_jobs, failed_jobs, 
                              total_processing_ms, estimated_cost_usd)
     VALUES ($1, $2, 1, $3, $4, $5, $6)
     ON CONFLICT (user_id, period) DO UPDATE SET
       total_jobs = tryon_usage.total_jobs + 1,
       successful_jobs = tryon_usage.successful_jobs + $3,
       failed_jobs = tryon_usage.failed_jobs + $4,
       total_processing_ms = tryon_usage.total_processing_ms + $5,
       estimated_cost_usd = tryon_usage.estimated_cost_usd + $6`,
    [
      userId,
      period,
      success ? 1 : 0,
      success ? 0 : 1,
      processingTimeMs,
      estimatedCost,
    ]
  );
}

/**
 * Ensure usage tracking table exists
 */
export async function ensureUsageTable(): Promise<void> {
  await pg.query(`
    CREATE TABLE IF NOT EXISTS tryon_usage (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      period VARCHAR(7) NOT NULL,
      total_jobs INTEGER DEFAULT 0,
      successful_jobs INTEGER DEFAULT 0,
      failed_jobs INTEGER DEFAULT 0,
      total_processing_ms BIGINT DEFAULT 0,
      estimated_cost_usd DECIMAL(10, 4) DEFAULT 0,
      
      CONSTRAINT unique_user_period UNIQUE (user_id, period)
    );
    
    CREATE INDEX IF NOT EXISTS idx_usage_user ON tryon_usage (user_id);
    CREATE INDEX IF NOT EXISTS idx_usage_period ON tryon_usage (period);
  `);
}
