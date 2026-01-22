"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduledJobsQueue = void 0;
exports.setupSchedules = setupSchedules;
exports.triggerJob = triggerJob;
exports.getJobStatus = getJobStatus;
exports.getScheduleInfo = getScheduleInfo;
exports.getQueueMetrics = getQueueMetrics;
/**
 * Job Scheduler Service using BullMQ
 *
 * Manages recurring jobs: nightly crawl, price snapshots, canonical recompute
 */
const bullmq_1 = require("bullmq");
const config_1 = require("../../config");
// ============================================================================
// Queue Configuration
// ============================================================================
const redisConnection = {
    host: config_1.config.redis.host,
    port: config_1.config.redis.port,
    password: config_1.config.redis.password || undefined,
};
// ============================================================================
// Queues
// ============================================================================
exports.scheduledJobsQueue = new bullmq_1.Queue("scheduled-jobs", {
    connection: redisConnection,
    defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 500,
        attempts: 3,
        backoff: {
            type: "exponential",
            delay: 5000,
        },
    },
});
// ============================================================================
// Schedule Setup
// ============================================================================
/**
 * Initialize all recurring job schedules
 */
async function setupSchedules() {
    // Remove existing repeatable jobs first
    const existingJobs = await exports.scheduledJobsQueue.getRepeatableJobs();
    for (const job of existingJobs) {
        await exports.scheduledJobsQueue.removeRepeatableByKey(job.key);
    }
    // Price snapshot: Every 6 hours
    await exports.scheduledJobsQueue.add("price-snapshot", { type: "price-snapshot" }, {
        repeat: { pattern: "0 */6 * * *" }, // Every 6 hours
        jobId: "price-snapshot-recurring",
    });
    // Price drop detection: Every 6 hours
    await exports.scheduledJobsQueue.add("price-drop-detection", { type: "price-drop-detection" }, {
        repeat: { pattern: "0 */6 * * *" }, // Every 6 hours
        jobId: "price-drop-detection-recurring",
    });
    // Canonical recompute: Every night at 2 AM
    await exports.scheduledJobsQueue.add("canonical-recompute", { type: "canonical-recompute" }, {
        repeat: { pattern: "0 2 * * *" }, // 2 AM daily
        jobId: "canonical-recompute-recurring",
    });
    // Cleanup old data: Weekly on Sunday at 3 AM
    await exports.scheduledJobsQueue.add("cleanup-old-data", { type: "cleanup-old-data" }, {
        repeat: { pattern: "0 3 * * 0" }, // Sunday 3 AM
        jobId: "cleanup-old-data-recurring",
    });
    // Category baseline computation: Weekly on Monday at 4 AM
    await exports.scheduledJobsQueue.add("category-baseline-compute", { type: "category-baseline-compute" }, {
        repeat: { pattern: "0 4 * * 1" }, // Monday 4 AM
        jobId: "category-baseline-compute-recurring",
    });
    console.log("✅ Job schedules configured");
}
// ============================================================================
// Manual Job Triggers
// ============================================================================
/**
 * Manually trigger a job
 */
async function triggerJob(type, params) {
    return exports.scheduledJobsQueue.add(type, { type, params, triggeredBy: "manual" }, { priority: 1 } // Higher priority for manual jobs
    );
}
/**
 * Get job status
 */
async function getJobStatus(jobId) {
    const job = await exports.scheduledJobsQueue.getJob(jobId);
    if (!job)
        return null;
    const state = await job.getState();
    return {
        id: job.id,
        state,
        progress: job.progress,
        data: job.data,
        failedReason: job.failedReason,
    };
}
/**
 * Get all scheduled jobs info
 */
async function getScheduleInfo() {
    const jobs = await exports.scheduledJobsQueue.getRepeatableJobs();
    return jobs.map((j) => ({
        name: j.name,
        pattern: j.pattern ?? "unknown",
        next: j.next ? new Date(j.next) : null,
    }));
}
/**
 * Get queue metrics
 */
async function getQueueMetrics() {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
        exports.scheduledJobsQueue.getWaitingCount(),
        exports.scheduledJobsQueue.getActiveCount(),
        exports.scheduledJobsQueue.getCompletedCount(),
        exports.scheduledJobsQueue.getFailedCount(),
        exports.scheduledJobsQueue.getDelayedCount(),
    ]);
    return { waiting, active, completed, failed, delayed };
}
