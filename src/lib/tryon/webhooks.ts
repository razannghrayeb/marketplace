/**
 * Try-On Webhook & Push Notification System
 * 
 * Implements webhook notifications and Redis pub/sub for real-time
 * try-on job status updates. Removes need for client polling.
 */

import { createHmac } from "crypto";
import { pg } from "../core/db";
import { getRedis, isRedisAvailable } from "../redis";

// ============================================================================
// Types
// ============================================================================

export interface WebhookConfig {
  id: number;
  userId: number;
  url: string;
  secret: string;
  events: WebhookEvent[];
  enabled: boolean;
  createdAt: Date;
}

export type WebhookEvent = "job.completed" | "job.failed" | "job.started";

export interface WebhookPayload {
  event: WebhookEvent;
  jobId: number;
  userId: number;
  status: string;
  resultUrl?: string;
  error?: string;
  timestamp: number;
}

export interface PubSubMessage {
  event: WebhookEvent;
  jobId: number;
  resultUrl?: string;
  error?: string;
  timestamp: number;
}

// ============================================================================
// Configuration
// ============================================================================

const WEBHOOK_CONFIG = {
  timeoutMs: 10000,
  maxRetries: 3,
  retryDelayMs: 1000,
};

const PUBSUB_CHANNELS = {
  jobUpdates: (userId: number) => `tryon:user:${userId}`,
  globalUpdates: "tryon:global",
};

// ============================================================================
// Webhook Management
// ============================================================================

/**
 * Register a webhook URL for a user
 */
export async function registerWebhook(
  userId: number,
  url: string,
  secret: string,
  events: WebhookEvent[] = ["job.completed", "job.failed"]
): Promise<WebhookConfig> {
  const result = await pg.query<WebhookConfig>(
    `INSERT INTO tryon_webhooks (user_id, url, secret, events, enabled)
     VALUES ($1, $2, $3, $4, true)
     ON CONFLICT (user_id) DO UPDATE SET
       url = EXCLUDED.url,
       secret = EXCLUDED.secret,
       events = EXCLUDED.events,
       enabled = true
     RETURNING *`,
    [userId, url, secret, events]
  );
  
  return result.rows[0];
}

/**
 * Get webhook config for a user
 */
export async function getWebhookConfig(userId: number): Promise<WebhookConfig | null> {
  const result = await pg.query<WebhookConfig>(
    `SELECT * FROM tryon_webhooks WHERE user_id = $1 AND enabled = true`,
    [userId]
  );
  
  return result.rows[0] || null;
}

/**
 * Disable webhook for a user
 */
export async function disableWebhook(userId: number): Promise<void> {
  await pg.query(
    `UPDATE tryon_webhooks SET enabled = false WHERE user_id = $1`,
    [userId]
  );
}

/**
 * Delete webhook for a user
 */
export async function deleteWebhook(userId: number): Promise<void> {
  await pg.query(
    `DELETE FROM tryon_webhooks WHERE user_id = $1`,
    [userId]
  );
}

// ============================================================================
// Webhook Delivery
// ============================================================================

/**
 * Generate HMAC signature for webhook payload
 */
function generateSignature(payload: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
}

/**
 * Verify webhook signature
 */
export function verifySignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expected = generateSignature(payload, secret);
  return signature === expected;
}

/**
 * Send webhook notification
 */
async function sendWebhook(
  config: WebhookConfig,
  payload: WebhookPayload
): Promise<boolean> {
  const payloadJson = JSON.stringify(payload);
  const signature = generateSignature(payloadJson, config.secret);
  
  for (let attempt = 1; attempt <= WEBHOOK_CONFIG.maxRetries; attempt++) {
    try {
      const response = await fetch(config.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Signature": signature,
          "X-Webhook-Event": payload.event,
          "X-Webhook-Timestamp": payload.timestamp.toString(),
        },
        body: payloadJson,
        signal: AbortSignal.timeout(WEBHOOK_CONFIG.timeoutMs),
      });
      
      if (response.ok) {
        console.info(`[Webhook] Delivered ${payload.event} to user ${config.userId}`);
        return true;
      }
      
      console.warn(`[Webhook] Failed (${response.status}) attempt ${attempt}/${WEBHOOK_CONFIG.maxRetries}`);
    } catch (err: any) {
      console.warn(`[Webhook] Error attempt ${attempt}/${WEBHOOK_CONFIG.maxRetries}: ${err.message}`);
    }
    
    if (attempt < WEBHOOK_CONFIG.maxRetries) {
      await new Promise(r => setTimeout(r, WEBHOOK_CONFIG.retryDelayMs * attempt));
    }
  }
  
  // Log delivery failure
  await logWebhookFailure(config.userId, payload.event, "Max retries exceeded");
  
  return false;
}

/**
 * Log webhook delivery failure
 */
async function logWebhookFailure(
  userId: number,
  event: WebhookEvent,
  error: string
): Promise<void> {
  await pg.query(
    `INSERT INTO tryon_webhook_failures (user_id, event, error, created_at)
     VALUES ($1, $2, $3, NOW())`,
    [userId, event, error]
  );
}

// ============================================================================
// Redis Pub/Sub
// ============================================================================

/**
 * Publish job update to Redis pub/sub
 */
async function publishToPubSub(
  userId: number,
  message: PubSubMessage
): Promise<void> {
  if (!isRedisAvailable()) return;
  
  const redis = getRedis();
  if (!redis) return;
  
  try {
    const channel = PUBSUB_CHANNELS.jobUpdates(userId);
    await redis.publish(channel, JSON.stringify(message));
  } catch (err) {
    console.warn("[PubSub] Publish error:", err);
  }
}

// ============================================================================
// Notification Dispatcher
// ============================================================================

/**
 * Notify user of job completion
 */
export async function notifyJobCompleted(
  jobId: number,
  userId: number,
  resultUrl: string
): Promise<void> {
  const payload: WebhookPayload = {
    event: "job.completed",
    jobId,
    userId,
    status: "completed",
    resultUrl,
    timestamp: Date.now(),
  };
  
  // Try webhook first
  const webhookConfig = await getWebhookConfig(userId);
  if (webhookConfig && webhookConfig.events.includes("job.completed")) {
    await sendWebhook(webhookConfig, payload);
  }
  
  // Always publish to Redis for real-time clients
  await publishToPubSub(userId, {
    event: "job.completed",
    jobId,
    resultUrl,
    timestamp: Date.now(),
  });
}

/**
 * Notify user of job failure
 */
export async function notifyJobFailed(
  jobId: number,
  userId: number,
  error: string
): Promise<void> {
  const payload: WebhookPayload = {
    event: "job.failed",
    jobId,
    userId,
    status: "failed",
    error,
    timestamp: Date.now(),
  };
  
  // Try webhook
  const webhookConfig = await getWebhookConfig(userId);
  if (webhookConfig && webhookConfig.events.includes("job.failed")) {
    await sendWebhook(webhookConfig, payload);
  }
  
  // Publish to Redis
  await publishToPubSub(userId, {
    event: "job.failed",
    jobId,
    error,
    timestamp: Date.now(),
  });
}

/**
 * Notify user of job started (for long jobs)
 */
export async function notifyJobStarted(
  jobId: number,
  userId: number
): Promise<void> {
  const payload: WebhookPayload = {
    event: "job.started",
    jobId,
    userId,
    status: "processing",
    timestamp: Date.now(),
  };
  
  // Try webhook
  const webhookConfig = await getWebhookConfig(userId);
  if (webhookConfig && webhookConfig.events.includes("job.started")) {
    await sendWebhook(webhookConfig, payload);
  }
  
  // Publish to Redis
  await publishToPubSub(userId, {
    event: "job.started",
    jobId,
    timestamp: Date.now(),
  });
}

// ============================================================================
// SSE Support
// ============================================================================

/**
 * Create SSE subscription channel name for a user
 */
export function getSSEChannelName(userId: number): string {
  return PUBSUB_CHANNELS.jobUpdates(userId);
}

/**
 * Format message for SSE
 */
export function formatSSEMessage(message: PubSubMessage): string {
  return `event: ${message.event}\ndata: ${JSON.stringify(message)}\n\n`;
}

// ============================================================================
// Database Setup
// ============================================================================

/**
 * Ensure webhook tables exist
 */
export async function ensureWebhookTables(): Promise<void> {
  await pg.query(`
    CREATE TABLE IF NOT EXISTS tryon_webhooks (
      id SERIAL PRIMARY KEY,
      user_id INTEGER UNIQUE NOT NULL,
      url TEXT NOT NULL,
      secret VARCHAR(256) NOT NULL,
      events TEXT[] NOT NULL DEFAULT ARRAY['job.completed', 'job.failed'],
      enabled BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
    
    CREATE TABLE IF NOT EXISTS tryon_webhook_failures (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      event VARCHAR(32) NOT NULL,
      error TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
    
    CREATE INDEX IF NOT EXISTS idx_webhook_user ON tryon_webhooks (user_id);
    CREATE INDEX IF NOT EXISTS idx_webhook_failures_user ON tryon_webhook_failures (user_id, created_at DESC);
  `);
}
