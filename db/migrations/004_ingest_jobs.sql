-- Migration: 004_ingest_jobs.sql
-- Purpose: Add ingest_jobs table for ingestion pipeline

CREATE TABLE IF NOT EXISTS ingest_jobs (
    id BIGSERIAL PRIMARY KEY,
    job_uuid TEXT NOT NULL UNIQUE,
    user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
    source TEXT NULL,
    r2_key TEXT NULL,
    cdn_url TEXT NULL,
    filename TEXT NULL,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','completed','failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    result_json JSONB NULL,
    error_message TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ingest_jobs_user_id ON ingest_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_ingest_jobs_status ON ingest_jobs(status);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_ingest_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS trg_update_ingest_jobs_updated_at ON ingest_jobs;
CREATE TRIGGER trg_update_ingest_jobs_updated_at
  BEFORE UPDATE ON ingest_jobs
  FOR EACH ROW EXECUTE FUNCTION update_ingest_jobs_updated_at();
