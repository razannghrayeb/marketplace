-- Migration: 015_tryon_usage_and_webhooks.sql
-- Adds try-on analytics and webhook tables that are referenced by runtime code.

CREATE TABLE IF NOT EXISTS tryon_usage (
    id SERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    period VARCHAR(7) NOT NULL,
    total_jobs INTEGER NOT NULL DEFAULT 0,
    successful_jobs INTEGER NOT NULL DEFAULT 0,
    failed_jobs INTEGER NOT NULL DEFAULT 0,
    total_processing_ms BIGINT NOT NULL DEFAULT 0,
    estimated_cost_usd DECIMAL(10, 4) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT unique_tryon_usage_user_period UNIQUE (user_id, period)
);

CREATE INDEX IF NOT EXISTS idx_tryon_usage_user ON tryon_usage (user_id);
CREATE INDEX IF NOT EXISTS idx_tryon_usage_period ON tryon_usage (period);

CREATE TABLE IF NOT EXISTS tryon_webhooks (
    id SERIAL PRIMARY KEY,
    user_id BIGINT UNIQUE NOT NULL,
    url TEXT NOT NULL,
    secret VARCHAR(256) NOT NULL,
    events TEXT[] NOT NULL DEFAULT ARRAY['job.completed', 'job.failed'],
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tryon_webhooks_user ON tryon_webhooks (user_id);

CREATE TABLE IF NOT EXISTS tryon_webhook_failures (
    id SERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    event VARCHAR(32) NOT NULL,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tryon_webhook_failures_user_created
    ON tryon_webhook_failures (user_id, created_at DESC);
