/**
 * Job Scheduler Service using BullMQ
 * 
 * Manages recurring jobs: nightly crawl, price snapshots, canonical recompute
 */
import { Queue, Job } from "bullmq";
import { config } from "../../config";

// ============================================================================
// Queue Configuration
// ============================================================================

const redisConnection = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password || undefined,
};

// ============================================================================
// Queues
// ============================================================================

export const scheduledJobsQueue = new Queue("scheduled-jobs", {
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
// Job Types
// ============================================================================

export type JobType = 
  | "nightly-crawl"
  | "price-snapshot"
  | "canonical-recompute"
  | "cleanup-old-data"
  | "price-drop-detection"
  | "category-baseline-compute";

export interface ScheduledJobData {
  type: JobType;
  params?: Record<string, any>;
  triggeredBy?: string;
}

// ============================================================================
// Schedule Setup
// ============================================================================

/**
 * Initialize all recurring job schedules
 */
export async function setupSchedules(): Promise<void> {
  // Remove existing repeatable jobs first
  const existingJobs = await scheduledJobsQueue.getRepeatableJobs();
  for (const job of existingJobs) {
    await scheduledJobsQueue.removeRepeatableByKey(job.key);
  }

  // Price snapshot: Every 6 hours
  await scheduledJobsQueue.add(
    "price-snapshot",
    { type: "price-snapshot" } as ScheduledJobData,
    {
      repeat: { pattern: "0 */6 * * *" }, // Every 6 hours
      jobId: "price-snapshot-recurring",
    }
  );

  // Price drop detection: Every 6 hours
  await scheduledJobsQueue.add(
    "price-drop-detection",
    { type: "price-drop-detection" } as ScheduledJobData,
    {
      repeat: { pattern: "0 */6 * * *" }, // Every 6 hours
      jobId: "price-drop-detection-recurring",
    }
  );

  // Canonical recompute: Every night at 2 AM
  await scheduledJobsQueue.add(
    "canonical-recompute",
    { type: "canonical-recompute" } as ScheduledJobData,
    {
      repeat: { pattern: "0 2 * * *" }, // 2 AM daily
      jobId: "canonical-recompute-recurring",
    }
  );

  // Cleanup old data: Weekly on Sunday at 3 AM
  await scheduledJobsQueue.add(
    "cleanup-old-data",
    { type: "cleanup-old-data" } as ScheduledJobData,
    {
      repeat: { pattern: "0 3 * * 0" }, // Sunday 3 AM
      jobId: "cleanup-old-data-recurring",
    }
  );

  // Category baseline computation: Weekly on Monday at 4 AM
  await scheduledJobsQueue.add(
    "category-baseline-compute",
    { type: "category-baseline-compute" } as ScheduledJobData,
    {
      repeat: { pattern: "0 4 * * 1" }, // Monday 4 AM
      jobId: "category-baseline-compute-recurring",
    }
  );

  console.log("✅ Job schedules configured");
}

// ============================================================================
// Manual Job Triggers
// ============================================================================

/**
 * Manually trigger a job
 */
export async function triggerJob(type: JobType, params?: Record<string, any>): Promise<Job> {
  return scheduledJobsQueue.add(
    type,
    { type, params, triggeredBy: "manual" } as ScheduledJobData,
    { priority: 1 } // Higher priority for manual jobs
  );
}

/**
 * Get job status
 */
export async function getJobStatus(jobId: string): Promise<{
  id: string;
  state: string;
  progress: number;
  data: any;
  failedReason?: string;
} | null> {
  const job = await scheduledJobsQueue.getJob(jobId);
  if (!job) return null;

  const state = await job.getState();
  return {
    id: job.id!,
    state,
    progress: job.progress as number,
    data: job.data,
    failedReason: job.failedReason,
  };
}

/**
 * Get all scheduled jobs info
 */
export async function getScheduleInfo(): Promise<Array<{
  name: string;
  pattern: string;
  next: Date | null;
}>> {
  const jobs = await scheduledJobsQueue.getRepeatableJobs();
  return jobs.map((j) => ({
    name: j.name,
    pattern: j.pattern ?? "unknown",
    next: j.next ? new Date(j.next) : null,
  }));
}

/**
 * Get queue metrics
 */
export async function getQueueMetrics(): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}> {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    scheduledJobsQueue.getWaitingCount(),
    scheduledJobsQueue.getActiveCount(),
    scheduledJobsQueue.getCompletedCount(),
    scheduledJobsQueue.getFailedCount(),
    scheduledJobsQueue.getDelayedCount(),
  ]);

  return { waiting, active, completed, failed, delayed };
}
