/**
 * Job Scheduler Service using BullMQ
 * 
 * Manages recurring jobs: nightly crawl, price snapshots, canonical recompute
 */
import { upstashGet, upstashSet } from "../queue";
import { config } from "../../config";

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
 * (Upstash REST API placeholder, implement scheduling logic as needed)
 */
export async function setupSchedules(): Promise<void> {
  // Recurring jobs: store schedule definitions in Upstash
  const schedules = [
    { name: "price-snapshot", pattern: "0 1 * * *", type: "price-snapshot" }, // 1 AM daily
    { name: "nightly-crawl", pattern: "0 0 * * *", type: "nightly-crawl" }, // Midnight daily
    { name: "price-drop-detection", pattern: "0 */6 * * *", type: "price-drop-detection" }, // Every 6 hours
    { name: "canonical-recompute", pattern: "0 2 * * *", type: "canonical-recompute" }, // 2 AM daily
    { name: "cleanup-old-data", pattern: "0 3 * * 0", type: "cleanup-old-data" }, // Sunday 3 AM
    { name: "category-baseline-compute", pattern: "0 4 * * 1", type: "category-baseline-compute" }, // Monday 4 AM
  ];
  await upstashSet("scheduled-job-definitions", JSON.stringify(schedules));
  console.log("✅ Job schedules configured (Upstash REST)");
}
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
  // Manual trigger: enqueue job to Upstash
  const jobId = `${type}-manual-${Date.now()}`;
  const jobData = { type, params, triggeredBy: "manual", job_uuid: jobId };
  // Store job data
  await upstashSet(`scheduled-job:${jobId}`, JSON.stringify(jobData));
  // Add job to scheduled-job-queue
  const queueRes = await upstashGet("scheduled-job-queue");
  let jobQueue: string[] = [];
  if (queueRes.result) {
    try {
      jobQueue = JSON.parse(queueRes.result);
    } catch (e) {
      jobQueue = [];
    }
  }
  jobQueue.push(jobId);
  await upstashSet("scheduled-job-queue", JSON.stringify(jobQueue));
  return jobData;
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
  // Fetch job status from Upstash
  const jobRes = await upstashGet(`scheduled-job:${jobId}`);
  if (!jobRes.result) return null;
  const jobData = JSON.parse(jobRes.result);
  // Example status fields
  return {
    id: jobId,
    state: jobData.status || "unknown",
    progress: jobData.progress || 0,
    data: jobData,
    failedReason: jobData.error_message || undefined,
  };
}

/**
 * Get all scheduled jobs info
 * (Upstash REST API placeholder)
 */
export async function getScheduleInfo(): Promise<Array<{ name: string; pattern: string; next: Date | null }>> {
  // Fetch schedule definitions from Upstash
  const res = await upstashGet("scheduled-job-definitions");
  if (!res.result) return [];
  const schedules = JSON.parse(res.result);
  // Optionally compute next run time (not implemented)
  return schedules.map((s: any) => ({ name: s.name, pattern: s.pattern, next: null }));
}

/**
 * Get queue metrics
 * (Upstash REST API placeholder)
 */
export async function getQueueMetrics(): Promise<{ waiting: number; active: number; completed: number; failed: number; delayed: number }> {
  // Fetch queue metrics from Upstash
  const queueRes = await upstashGet("scheduled-job-queue");
  let waiting = 0;
  if (queueRes.result) {
    try {
      const jobQueue = JSON.parse(queueRes.result);
      waiting = Array.isArray(jobQueue) ? jobQueue.length : 0;
    } catch (e) {
      waiting = 0;
    }
  }
  // Other metrics not tracked in Upstash REST (placeholders)
  return { waiting, active: 0, completed: 0, failed: 0, delayed: 0 };
}
