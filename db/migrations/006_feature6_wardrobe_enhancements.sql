-- Migration: 006_feature6_wardrobe_enhancements.sql
-- Feature #6 Enhancements: Auto-sync, Image Recognition, Visual Coherence, Layering, Learned Compatibility

-- ============================================================================
-- Auto-Sync Settings Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_auto_sync_settings (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    auto_sync_enabled BOOLEAN DEFAULT true,
    auto_categorize BOOLEAN DEFAULT true,
    min_confidence_threshold REAL DEFAULT 0.7,
    auto_tag_enabled BOOLEAN DEFAULT true,
    notification_on_sync BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_auto_sync_settings_user_id ON user_auto_sync_settings(user_id);

-- ============================================================================
-- Learned Compatibility Rules Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS learned_compatibility_rules (
    id SERIAL PRIMARY KEY,
    rule_id VARCHAR(255) UNIQUE NOT NULL,
    category1 VARCHAR(100) NOT NULL,
    category2 VARCHAR(100) NOT NULL,
    score REAL DEFAULT 0.5,                    -- 0.0 to 1.0 compatibility score
    confidence REAL DEFAULT 0.5,               -- How confident we are in this score
    co_occurrences INTEGER DEFAULT 0,          -- Number of times seen together
    success_rate REAL DEFAULT 0.5,             -- Percentage of successful outfits
    constraints JSONB,                          -- Color, style, occasion constraints
    evidence JSONB,                             -- { sampleSize, sources, lastUpdated }
    regions TEXT[],                             -- Cultural regions this applies to
    average_rating REAL,                       -- Average user rating of this combination
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_learned_compatibility_categories
  ON learned_compatibility_rules(
    LEAST(category1, category2),
    GREATEST(category1, category2)
  );

CREATE INDEX IF NOT EXISTS idx_learned_compatibility_score
  ON learned_compatibility_rules(score DESC)
  WHERE confidence > 0.5;

CREATE INDEX IF NOT EXISTS idx_learned_compatibility_category1
  ON learned_compatibility_rules(category1);

CREATE INDEX IF NOT EXISTS idx_learned_compatibility_category2
  ON learned_compatibility_rules(category2);

-- ============================================================================
-- Wardrobe Item Enhancements (Extensions to existing wardrobe_items table)
-- ============================================================================

-- Alter wardrobe_items table if needed (these columns may already exist)
-- ALTER TABLE wardrobe_items ADD COLUMN IF NOT EXISTS detection_source VARCHAR(50);  -- 'yolo', 'gemini', 'hybrid', 'manual'
-- ALTER TABLE wardrobe_items ADD COLUMN IF NOT EXISTS detection_metadata JSONB;
-- ALTER TABLE wardrobe_items ADD COLUMN IF NOT EXISTS style_profile JSONB;           -- { occasion, season, formality, etc }
-- ALTER TABLE wardrobe_items ADD COLUMN IF NOT EXISTS visual_attributes JSONB;      -- { colors, pattern, material, texture, fit }
-- ALTER TABLE wardrobe_items ADD COLUMN IF NOT EXISTS layering_level INTEGER;       -- 0-5 for layering order
-- ALTER TABLE wardrobe_items ADD COLUMN IF NOT EXISTS last_auto_synced_at TIMESTAMPTZ;

-- ============================================================================
-- Outfit Coherence Scores Cache
-- ============================================================================

CREATE TABLE IF NOT EXISTS outfit_coherence_scores (
    id SERIAL PRIMARY KEY,
    outfit_id INTEGER NOT NULL REFERENCES outfits(id) ON DELETE CASCADE,
    overall_score REAL NOT NULL,               -- 0.0-1.0
    color_harmony REAL NOT NULL,
    style_consistency REAL NOT NULL,
    visual_balance REAL NOT NULL,
    pattern_mixing REAL NOT NULL,
    texture_coordination REAL NOT NULL,
    aesthetic_similarity REAL NOT NULL,
    confidence REAL NOT NULL,
    breakdown JSONB,                           -- { strengths, weaknesses, recommendations }
    computed_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ                     -- Cache expiration for re-computation
);

CREATE INDEX IF NOT EXISTS idx_outfit_coherence_outfit_id
  ON outfit_coherence_scores(outfit_id);

CREATE INDEX IF NOT EXISTS idx_outfit_coherence_score
  ON outfit_coherence_scores(overall_score DESC);

-- ============================================================================
-- Purchase-to-Wardrobe Sync Log
-- ============================================================================

CREATE TABLE IF NOT EXISTS purchase_sync_log (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purchase_id INTEGER,                       -- Reference to original purchase/order
    order_item_id INTEGER,
    product_id INTEGER,
    wardrobe_item_id INTEGER REFERENCES wardrobe_items(id),
    status VARCHAR(50) DEFAULT 'pending',      -- 'pending', 'synced', 'skipped', 'failed'
    reason_skipped VARCHAR(255),               -- Why it was skipped
    detection_confidence REAL,
    detected_category VARCHAR(100),
    sync_metadata JSONB,                       -- { detectionMethod, processingTimeMs, etc }
    synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchase_sync_log_user_id
  ON purchase_sync_log(user_id);

CREATE INDEX IF NOT EXISTS idx_purchase_sync_log_status
  ON purchase_sync_log(status);

CREATE INDEX IF NOT EXISTS idx_purchase_sync_log_wardrobe_item_id
  ON purchase_sync_log(wardrobe_item_id);

-- ============================================================================
-- Image Recognition Analysis Cache
-- ============================================================================

CREATE TABLE IF NOT EXISTS wardrobe_item_analysis_cache (
    id SERIAL PRIMARY KEY,
    wardrobe_item_id INTEGER UNIQUE NOT NULL REFERENCES wardrobe_items(id) ON DELETE CASCADE,
    analysis_json JSONB NOT NULL,              -- Full WardrobeItemAnalysis object
    detection_method VARCHAR(50),              -- 'yolo', 'gemini', 'hybrid'
    processing_time_ms INTEGER,
    embedding_vector VECTOR(768),              -- CLIP embedding (if pgvector available)
    analysis_version VARCHAR(20) DEFAULT '1.0',
    analyzed_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ                     -- For cache invalidation
);

CREATE INDEX IF NOT EXISTS idx_wardrobe_analysis_cache_item_id
  ON wardrobe_item_analysis_cache(wardrobe_item_id);

-- ============================================================================
-- Compatibility Graph Nodes (for visualization/caching)
-- ============================================================================

CREATE TABLE IF NOT EXISTS compatibility_graph_nodes (
    id SERIAL PRIMARY KEY,
    category VARCHAR(100) UNIQUE NOT NULL,
    popularity INTEGER DEFAULT 0,              -- Number of edges connected
    average_score REAL DEFAULT 0.5,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compatibility_graph_nodes_category
  ON compatibility_graph_nodes(category);

-- ============================================================================
-- Compatibility Graph Edges (for visualization/caching)
-- ============================================================================

CREATE TABLE IF NOT EXISTS compatibility_graph_edges (
    id SERIAL PRIMARY KEY,
    from_category VARCHAR(100) NOT NULL,
    to_category VARCHAR(100) NOT NULL,
    weight REAL NOT NULL,                      -- Compatibility score
    co_occurrences INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(from_category, to_category)
);

CREATE INDEX IF NOT EXISTS idx_compatibility_graph_edges_from
  ON compatibility_graph_edges(from_category);

CREATE INDEX IF NOT EXISTS idx_compatibility_graph_edges_to
  ON compatibility_graph_edges(to_category);

CREATE INDEX IF NOT EXISTS idx_compatibility_graph_edges_weight
  ON compatibility_graph_edges(weight DESC);

-- ============================================================================
-- Outfit Layering Analysis Log
-- ============================================================================

CREATE TABLE IF NOT EXISTS outfit_layering_analysis (
    id SERIAL PRIMARY KEY,
    outfit_id INTEGER NOT NULL REFERENCES outfits(id) ON DELETE CASCADE,
    layer_structure JSONB NOT NULL,            -- Full LayeringStructure object
    is_valid BOOLEAN,
    issues TEXT[],
    suggestions TEXT[],
    analyzed_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_outfit_layering_analysis_outfit_id
  ON outfit_layering_analysis(outfit_id);
