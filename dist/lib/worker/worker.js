"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWorker = createWorker;
/**
 * Job Worker
 *
 * Processes scheduled jobs from the queue.
 */
const bullmq_1 = require("bullmq");
const config_1 = require("../../config");
const priceHistory_1 = require("../products/priceHistory");
const canonical_1 = require("../products/canonical");
const priceAnomalyDetector_1 = require("../compare/priceAnomalyDetector");
const core_1 = require("../core");
// ============================================================================
// Redis Connection
// ============================================================================
const redisConnection = {
    host: config_1.config.redis.host,
    port: config_1.config.redis.port,
    password: config_1.config.redis.password || undefined,
};
// ============================================================================
// Job Handlers
// ============================================================================
async function handlePriceSnapshot(job) {
    console.log(`[Job ${job.id}] Starting price snapshot...`);
    await job.updateProgress(10);
    const result = await (0, priceHistory_1.takePriceSnapshot)();
    await job.updateProgress(100);
    console.log(`[Job ${job.id}] Price snapshot complete: ${result.recorded} prices recorded`);
    return result;
}
async function handleCanonicalRecompute(job) {
    console.log(`[Job ${job.id}] Starting canonical recompute...`);
    await job.updateProgress(10);
    const result = await (0, canonical_1.recomputeAllCanonicals)();
    await job.updateProgress(100);
    console.log(`[Job ${job.id}] Canonical recompute complete: ${result.processed} processed, ${result.new_canonicals} new, ${result.attached} attached`);
    return result;
}
async function handleNightlyCrawl(job) {
    console.log(`[Job ${job.id}] Nightly crawl triggered...`);
    // TODO: Implement actual crawl logic
    // This would trigger the crawler service
    await job.updateProgress(100);
    return { message: "Nightly crawl completed (stub)" };
}
async function handleCleanupOldData(job) {
    console.log(`[Job ${job.id}] Starting data cleanup...`);
    await job.updateProgress(20);
    // Delete price history older than 1 year
    const priceResult = await core_1.pg.query(`DELETE FROM price_history WHERE recorded_at < NOW() - INTERVAL '365 days'`);
    await job.updateProgress(60);
    // Delete old job logs from job_schedules
    const jobResult = await core_1.pg.query(`DELETE FROM job_schedules WHERE completed_at < NOW() - INTERVAL '30 days'`);
    await job.updateProgress(100);
    const result = {
        deletedPrices: priceResult.rowCount ?? 0,
        deletedJobs: jobResult.rowCount ?? 0,
    };
    console.log(`[Job ${job.id}] Cleanup complete: ${result.deletedPrices} prices, ${result.deletedJobs} job records`);
    return result;
}
async function handlePriceDropDetection(job) {
    console.log(`[Job ${job.id}] Starting price drop detection...`);
    await job.updateProgress(10);
    // Find price drops (10% threshold, comparing last 1 day to previous 7 days)
    const drops = await (0, priceHistory_1.findPriceDrops)(10, 1);
    await job.updateProgress(50);
    // Insert new drops into price_drop_events table (avoid duplicates)
    let inserted = 0;
    for (const drop of drops) {
        try {
            // Check if this drop was already recorded recently
            const existing = await core_1.pg.query(`SELECT id FROM price_drop_events 
         WHERE product_id = $1 
           AND detected_at > NOW() - INTERVAL '24 hours'`, [drop.product_id]);
            if (existing.rowCount === 0) {
                await core_1.pg.query(`INSERT INTO price_drop_events (product_id, old_price_cents, new_price_cents, drop_percent)
           VALUES ($1, $2, $3, $4)`, [drop.product_id, drop.old_price, drop.new_price, drop.drop_percent]);
                inserted++;
            }
        }
        catch (err) {
            console.error(`Failed to insert price drop for product ${drop.product_id}:`, err);
        }
    }
    await job.updateProgress(100);
    console.log(`[Job ${job.id}] Price drop detection complete: ${drops.length} drops found, ${inserted} new events inserted`);
    return { dropsFound: drops.length, inserted };
}
async function handleCategoryBaselineCompute(job) {
    console.log(`[Job ${job.id}] Starting category baseline computation...`);
    await job.updateProgress(10);
    const result = await (0, priceAnomalyDetector_1.computeAllCategoryBaselines)();
    await job.updateProgress(100);
    console.log(`[Job ${job.id}] Category baseline computation complete: ${result.computed} categories`);
    return result;
}
// ============================================================================
// Worker Setup
// ============================================================================
function createWorker() {
    const worker = new bullmq_1.Worker("scheduled-jobs", async (job) => {
        const startTime = Date.now();
        // Log job start
        await core_1.pg.query(`INSERT INTO job_schedules (job_type, started_at, status)
         VALUES ($1, NOW(), 'running')
         RETURNING id`, [job.data.type]);
        try {
            let result;
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
                case "price-drop-detection":
                    result = await handlePriceDropDetection(job);
                    break;
                case "category-baseline-compute":
                    result = await handleCategoryBaselineCompute(job);
                    break;
                default:
                    throw new Error(`Unknown job type: ${job.data.type}`);
            }
            const duration = Date.now() - startTime;
            // Log job completion
            await core_1.pg.query(`UPDATE job_schedules 
           SET completed_at = NOW(), status = 'completed', result = $1, duration_ms = $2
           WHERE job_type = $3 AND status = 'running'
           ORDER BY started_at DESC LIMIT 1`, [JSON.stringify(result), duration, job.data.type]);
            return result;
        }
        catch (error) {
            const duration = Date.now() - startTime;
            // Log job failure
            await core_1.pg.query(`UPDATE job_schedules 
           SET completed_at = NOW(), status = 'failed', error = $1, duration_ms = $2
           WHERE job_type = $3 AND status = 'running'
           ORDER BY started_at DESC LIMIT 1`, [error.message, duration, job.data.type]);
            throw error;
        }
    }, {
        connection: redisConnection,
        concurrency: 1, // Process one job at a time
    });
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
if (process.argv[1]?.endsWith("worker.ts") || process.argv[1]?.endsWith("worker.js")) {
    console.log("🚀 Starting job worker...");
    const worker = createWorker();
    process.on("SIGTERM", async () => {
        console.log("Shutting down worker...");
        await worker.close();
        process.exit(0);
    });
}
