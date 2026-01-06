/**
 * Job Worker
 * 
 * Processes scheduled jobs from the queue
 */
import { Worker, Job } from "bullmq";
import { config } from "../config";
import { ScheduledJobData } from "./jobScheduler";
import { takePriceSnapshot } from "./priceHistory";
import { recomputeAllCanonicals } from "./canonical";
import { pg } from "./db";

// ============================================================================
// Redis Connection
// ============================================================================

const redisConnection = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password || undefined,
};

// ============================================================================
// Job Handlers
// ============================================================================

async function handlePriceSnapshot(job: Job): Promise<{ recorded: number }> {
  console.log(`[Job ${job.id}] Starting price snapshot...`);
  
  await job.updateProgress(10);
  const result = await takePriceSnapshot();
  await job.updateProgress(100);

  console.log(`[Job ${job.id}] Price snapshot complete: ${result.recorded} prices recorded`);
  return result;
}

async function handleCanonicalRecompute(job: Job): Promise<{ processed: number; new_canonicals: number; attached: number }> {
  console.log(`[Job ${job.id}] Starting canonical recompute...`);
  
  await job.updateProgress(10);
  const result = await recomputeAllCanonicals();
  await job.updateProgress(100);

  console.log(`[Job ${job.id}] Canonical recompute complete: ${result.processed} processed, ${result.new_canonicals} new, ${result.attached} attached`);
  return result;
}

async function handleNightlyCrawl(job: Job): Promise<{ message: string }> {
  console.log(`[Job ${job.id}] Nightly crawl triggered...`);
  
  // TODO: Implement actual crawl logic
  // This would trigger the crawler service
  await job.updateProgress(100);
  
  return { message: "Nightly crawl completed (stub)" };
}

async function handleCleanupOldData(job: Job): Promise<{ deletedPrices: number; deletedJobs: number }> {
  console.log(`[Job ${job.id}] Starting data cleanup...`);
  
  await job.updateProgress(20);

  // Delete price history older than 1 year
  const priceResult = await pg.query(
    `DELETE FROM price_history WHERE recorded_at < NOW() - INTERVAL '365 days'`
  );

  await job.updateProgress(60);

  // Delete old job logs from job_schedules
  const jobResult = await pg.query(
    `DELETE FROM job_schedules WHERE completed_at < NOW() - INTERVAL '30 days'`
  );

  await job.updateProgress(100);

  const result = {
    deletedPrices: priceResult.rowCount ?? 0,
    deletedJobs: jobResult.rowCount ?? 0,
  };

  console.log(`[Job ${job.id}] Cleanup complete: ${result.deletedPrices} prices, ${result.deletedJobs} job records`);
  return result;
}

// ============================================================================
// Worker Setup
// ============================================================================

export function createWorker(): Worker {
  const worker = new Worker<ScheduledJobData>(
    "scheduled-jobs",
    async (job: Job<ScheduledJobData>) => {
      const startTime = Date.now();
      
      // Log job start
      await pg.query(
        `INSERT INTO job_schedules (job_type, started_at, status)
         VALUES ($1, NOW(), 'running')
         RETURNING id`,
        [job.data.type]
      );

      try {
        let result: any;

        switch (job.data.type) {
          case "price-snapshot":
            result = await handlePriceSnapshot(job);
            break;
          case "canonical-recompute":
            result = await handleCanonicalRecompute(job);
            break;
          case "nightly-crawl":
            result = await handleNightlyCrawl(job);
            break;
          case "cleanup-old-data":
            result = await handleCleanupOldData(job);
            break;
          default:
            throw new Error(`Unknown job type: ${job.data.type}`);
        }

        const duration = Date.now() - startTime;

        // Log job completion
        await pg.query(
          `UPDATE job_schedules 
           SET completed_at = NOW(), status = 'completed', result = $1, duration_ms = $2
           WHERE job_type = $3 AND status = 'running'
           ORDER BY started_at DESC LIMIT 1`,
          [JSON.stringify(result), duration, job.data.type]
        );

        return result;
      } catch (error) {
        const duration = Date.now() - startTime;

        // Log job failure
        await pg.query(
          `UPDATE job_schedules 
           SET completed_at = NOW(), status = 'failed', error = $1, duration_ms = $2
           WHERE job_type = $3 AND status = 'running'
           ORDER BY started_at DESC LIMIT 1`,
          [(error as Error).message, duration, job.data.type]
        );

        throw error;
      }
    },
    {
      connection: redisConnection,
      concurrency: 1, // Process one job at a time
    }
  );

  worker.on("completed", (job) => {
    console.log(`✅ Job ${job.id} (${job.data.type}) completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`❌ Job ${job?.id} (${job?.data.type}) failed:`, err.message);
  });

  worker.on("error", (err) => {
    console.error("Worker error:", err);
  });

  return worker;
}

// ============================================================================
// Standalone Worker Script
// ============================================================================

if (process.argv[1]?.endsWith("jobWorker.ts") || process.argv[1]?.endsWith("jobWorker.js")) {
  console.log("🚀 Starting job worker...");
  const worker = createWorker();
  
  process.on("SIGTERM", async () => {
    console.log("Shutting down worker...");
    await worker.close();
    process.exit(0);
  });
}
