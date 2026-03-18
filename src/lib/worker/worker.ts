/**
 * Job Worker - Upstash-based polling (no ioredis/BullMQ)
 *
 * Polls scheduled-job-queue from Upstash and processes jobs.
 * Run as: npx tsx src/lib/worker/worker.ts
 */
import { upstashGet, upstashSet } from "../queue";
import { ScheduledJobData } from "../scheduler";
import { takePriceSnapshot, findPriceDrops } from "../products/priceHistory";
import { recomputeAllCanonicals } from "../products/canonical";
import { computeAllCategoryBaselines } from "../compare/priceAnomalyDetector";
import { pg } from "../core";
import { getRedis } from "../redis";

// ============================================================================
// Job Handlers
// ============================================================================

async function handlePriceSnapshot(): Promise<{ recorded: number }> {
  return takePriceSnapshot();
}

async function handleCanonicalRecompute(): Promise<{ processed: number; new_canonicals: number; attached: number }> {
  return recomputeAllCanonicals();
}

async function handleNightlyCrawl(): Promise<{ message: string }> {
  return { message: "Nightly crawl completed (stub)" };
}

async function handleCleanupOldData(): Promise<{ deletedPrices: number; deletedJobs: number }> {
  const priceResult = await pg.query(
    `DELETE FROM price_history WHERE recorded_at < NOW() - INTERVAL '365 days'`
  );
  const jobResult = await pg.query(
    `DELETE FROM job_schedules WHERE completed_at < NOW() - INTERVAL '30 days'`
  );
  return {
    deletedPrices: priceResult.rowCount ?? 0,
    deletedJobs: jobResult.rowCount ?? 0,
  };
}

async function handlePriceDropDetection(): Promise<{ dropsFound: number; inserted: number }> {
  const drops = await findPriceDrops(10, 1);
  let inserted = 0;
  for (const drop of drops) {
    try {
      const existing = await pg.query(
        `SELECT id FROM price_drop_events 
         WHERE product_id = $1 AND detected_at > NOW() - INTERVAL '24 hours'`,
        [drop.product_id]
      );
      if (existing.rowCount === 0) {
        await pg.query(
          `INSERT INTO price_drop_events (product_id, old_price_cents, new_price_cents, drop_percent)
           VALUES ($1, $2, $3, $4)`,
          [drop.product_id, drop.old_price, drop.new_price, drop.drop_percent]
        );
        inserted++;
      }
    } catch (err) {
      console.error(`Failed to insert price drop for product ${drop.product_id}:`, err);
    }
  }
  return { dropsFound: drops.length, inserted };
}

async function handleCategoryBaselineCompute(): Promise<{ computed: number; errors: string[] }> {
  return computeAllCategoryBaselines();
}

async function processJob(jobId: string, data: ScheduledJobData): Promise<any> {
  const startTime = Date.now();
  await pg.query(
    `INSERT INTO job_schedules (job_type, started_at, status) VALUES ($1, NOW(), 'running') RETURNING id`,
    [data.type]
  );

  try {
    let result: any;
    switch (data.type) {
      case "price-snapshot":
        result = await handlePriceSnapshot();
        break;
      case "canonical-recompute":
        result = await handleCanonicalRecompute();
        break;
      case "nightly-crawl":
        result = await handleNightlyCrawl();
        break;
      case "cleanup-old-data":
        result = await handleCleanupOldData();
        break;
      case "price-drop-detection":
        result = await handlePriceDropDetection();
        break;
      case "category-baseline-compute":
        result = await handleCategoryBaselineCompute();
        break;
      default:
        throw new Error(`Unknown job type: ${data.type}`);
    }

    const duration = Date.now() - startTime;
    await pg.query(
      `UPDATE job_schedules SET completed_at = NOW(), status = 'completed', result = $1, duration_ms = $2
       WHERE job_type = $3 AND status = 'running' ORDER BY started_at DESC LIMIT 1`,
      [JSON.stringify(result), duration, data.type]
    );
    console.log(`✅ Job ${jobId} (${data.type}) completed in ${duration}ms`);
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    await pg.query(
      `UPDATE job_schedules SET completed_at = NOW(), status = 'failed', error = $1, duration_ms = $2
       WHERE job_type = $3 AND status = 'running' ORDER BY started_at DESC LIMIT 1`,
      [(error as Error).message, duration, data.type]
    );
    console.error(`❌ Job ${jobId} (${data.type}) failed:`, (error as Error).message);
    throw error;
  }
}

/**
 * Poll and process one job from the queue
 */
export async function pollAndProcessOne(): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;

  const queueRes = await upstashGet("scheduled-job-queue");
  let jobQueue: string[] = [];
  if (queueRes.result) {
    try {
      jobQueue = JSON.parse(queueRes.result);
    } catch {
      jobQueue = [];
    }
  }
  if (jobQueue.length === 0) return false;

  const jobId = jobQueue.shift()!;
  await upstashSet("scheduled-job-queue", JSON.stringify(jobQueue));

  const jobRes = await upstashGet(`scheduled-job:${jobId}`);
  if (!jobRes.result) return true;

  const jobData = JSON.parse(jobRes.result) as ScheduledJobData;
  await processJob(jobId, jobData);
  return true;
}

/**
 * Run worker loop (poll every N seconds)
 */
export async function runWorkerLoop(pollIntervalMs = 10000): Promise<void> {
  console.log("🚀 Starting job worker (Upstash polling)...");
  if (!getRedis()) {
    console.warn("[redis] disabled: missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN");
    return;
  }

  const poll = async () => {
    try {
      await pollAndProcessOne();
    } catch (err) {
      console.error("Worker poll error:", err);
    }
    setTimeout(poll, pollIntervalMs);
  };
  poll();
}
