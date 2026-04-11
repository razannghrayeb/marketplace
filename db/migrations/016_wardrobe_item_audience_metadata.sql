-- ============================================================================
-- Migration: 016_wardrobe_item_audience_metadata.sql
-- Purpose: Persist user-provided audience/style hints for uploaded wardrobe items
-- ============================================================================

CREATE TABLE IF NOT EXISTS wardrobe_item_audience_metadata (
    wardrobe_item_id BIGINT PRIMARY KEY REFERENCES wardrobe_items(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    audience_gender TEXT CHECK (audience_gender IN ('men', 'women', 'unisex')),
    age_group TEXT CHECK (age_group IN ('kids', 'adult')),
    style_tags TEXT[] NOT NULL DEFAULT '{}',
    occasion_tags TEXT[] NOT NULL DEFAULT '{}',
    season_tags TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wardrobe_item_audience_metadata_user_id
ON wardrobe_item_audience_metadata(user_id);

CREATE INDEX IF NOT EXISTS idx_wardrobe_item_audience_metadata_gender
ON wardrobe_item_audience_metadata(audience_gender);

CREATE INDEX IF NOT EXISTS idx_wardrobe_item_audience_metadata_age_group
ON wardrobe_item_audience_metadata(age_group);
