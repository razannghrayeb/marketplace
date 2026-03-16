-- Migration: 007_virtual_tryon.sql
-- Virtual Try-On: IDM-VTON integration tables

-- ============================================================================
-- Try-On Jobs Table (tracks each try-on request)
-- ============================================================================

CREATE TABLE IF NOT EXISTS tryon_jobs (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,

    -- Source garment reference
    garment_source VARCHAR(20) NOT NULL CHECK (garment_source IN ('wardrobe', 'product', 'upload')),
    garment_ref_id BIGINT,
    garment_image_r2_key TEXT,
    garment_image_url TEXT,
    garment_description TEXT,

    -- Person image
    person_image_r2_key TEXT,
    person_image_url TEXT,

    -- Result
    result_image_r2_key TEXT,
    result_image_url TEXT,

    -- Configuration
    category VARCHAR(20) NOT NULL DEFAULT 'upper_body'
        CHECK (category IN ('upper_body', 'lower_body', 'dresses')),

    -- Processing metadata
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    error_message TEXT,
    processing_time_ms INTEGER,
    inference_time_ms INTEGER,
    seed_used INTEGER,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days')
);

CREATE INDEX IF NOT EXISTS idx_tryon_jobs_user_id ON tryon_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_tryon_jobs_status ON tryon_jobs(status);
CREATE INDEX IF NOT EXISTS idx_tryon_jobs_user_created ON tryon_jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tryon_jobs_garment_ref ON tryon_jobs(garment_source, garment_ref_id);
CREATE INDEX IF NOT EXISTS idx_tryon_jobs_expires ON tryon_jobs(expires_at) WHERE status = 'completed';

-- ============================================================================
-- Try-On Saved Results (user bookmarks)
-- ============================================================================

CREATE TABLE IF NOT EXISTS tryon_saved_results (
    id SERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    tryon_job_id BIGINT NOT NULL REFERENCES tryon_jobs(id) ON DELETE CASCADE,
    note TEXT,
    is_favorite BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(user_id, tryon_job_id)
);

CREATE INDEX IF NOT EXISTS idx_tryon_saved_user ON tryon_saved_results(user_id);
