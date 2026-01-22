-- Migration: Recommendation System Training Data Tables
-- Purpose: Store impressions and labels for building a recommendation model

-- ============================================================================
-- Recommendation Impressions Table
-- Logs every recommendation shown with full feature breakdown
-- ============================================================================
CREATE TABLE IF NOT EXISTS recommendation_impressions (
    id SERIAL PRIMARY KEY,
    
    -- Request identification
    request_id UUID NOT NULL,              -- Groups all candidates from same request
    
    -- Product relationship
    base_product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    candidate_product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,             -- Rank position (1 = top recommendation)
    
    -- Core similarity scores (0-1 normalized)
    candidate_score DECIMAL(5,4),          -- Combined weighted score
    clip_sim DECIMAL(5,4),                 -- CLIP visual similarity (0-1)
    text_sim DECIMAL(5,4),                 -- Text/hybrid similarity (0-1)
    opensearch_score DECIMAL(10,4),        -- Raw OpenSearch score
    p_hash_dist INTEGER,                   -- Hamming distance (0-64), NULL if not available
    
    -- Style matching scores (from outfit engine)
    style_score DECIMAL(5,4),              -- Style compatibility score
    color_score DECIMAL(5,4),              -- Color harmony score
    final_match_score DECIMAL(8,4),        -- Final combined match score
    
    -- Context features
    category_pair TEXT,                    -- "base_category->candidate_category"
    price_ratio DECIMAL(6,4),              -- candidate_price / base_price
    same_brand BOOLEAN DEFAULT FALSE,
    same_vendor BOOLEAN DEFAULT FALSE,
    
    -- Detailed match reasons (for debugging/analysis)
    match_reasons JSONB DEFAULT '[]',      -- Array of reason strings
    
    -- Source tracking
    source TEXT NOT NULL CHECK (source IN ('clip', 'text', 'both', 'outfit')),
    context TEXT,                          -- e.g., 'similar_products', 'complete_outfit', 'category_reco'
    
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraints
    UNIQUE(request_id, base_product_id, candidate_product_id)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_reco_impressions_request_id ON recommendation_impressions(request_id);
CREATE INDEX IF NOT EXISTS idx_reco_impressions_base_product ON recommendation_impressions(base_product_id);
CREATE INDEX IF NOT EXISTS idx_reco_impressions_candidate ON recommendation_impressions(candidate_product_id);
CREATE INDEX IF NOT EXISTS idx_reco_impressions_created_at ON recommendation_impressions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reco_impressions_category_pair ON recommendation_impressions(category_pair);
CREATE INDEX IF NOT EXISTS idx_reco_impressions_source ON recommendation_impressions(source);

-- ============================================================================
-- Recommendation Labels Table
-- Manual labels for training data (since no user interactions yet)
-- ============================================================================
CREATE TABLE IF NOT EXISTS recommendation_labels (
    id SERIAL PRIMARY KEY,
    
    -- Link to impression (can be NULL if labeling directly)
    impression_id INTEGER REFERENCES recommendation_impressions(id) ON DELETE CASCADE,
    
    -- Or direct product pair (if labeling outside of impressions)
    base_product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    candidate_product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    
    -- Label
    label TEXT NOT NULL CHECK (label IN ('good', 'ok', 'bad')),
    label_score INTEGER CHECK (label_score >= 0 AND label_score <= 10),  -- Optional 0-10 score
    
    -- Labeler info
    labeler_id TEXT,                       -- Who labeled (admin username, etc.)
    notes TEXT,                            -- Optional notes explaining the label
    
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraints - one label per product pair per labeler
    UNIQUE(base_product_id, candidate_product_id, labeler_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_reco_labels_base_product ON recommendation_labels(base_product_id);
CREATE INDEX IF NOT EXISTS idx_reco_labels_candidate ON recommendation_labels(candidate_product_id);
CREATE INDEX IF NOT EXISTS idx_reco_labels_label ON recommendation_labels(label);
CREATE INDEX IF NOT EXISTS idx_reco_labels_labeler ON recommendation_labels(labeler_id);
CREATE INDEX IF NOT EXISTS idx_reco_labels_created_at ON recommendation_labels(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reco_labels_impression ON recommendation_labels(impression_id);

-- ============================================================================
-- Aggregation View for Training Data Export
-- ============================================================================
CREATE OR REPLACE VIEW v_recommendation_training_data AS
SELECT 
    ri.id as impression_id,
    ri.request_id,
    ri.base_product_id,
    ri.candidate_product_id,
    ri.position,
    ri.candidate_score,
    ri.clip_sim,
    ri.text_sim,
    ri.opensearch_score,
    ri.p_hash_dist,
    ri.style_score,
    ri.color_score,
    ri.final_match_score,
    ri.category_pair,
    ri.price_ratio,
    ri.same_brand,
    ri.same_vendor,
    ri.match_reasons,
    ri.source,
    ri.context,
    ri.created_at as impression_created_at,
    -- Label info (may be NULL if not labeled)
    rl.label,
    rl.label_score,
    rl.labeler_id,
    rl.notes as label_notes,
    rl.created_at as labeled_at,
    -- Base product info
    bp.title as base_title,
    bp.brand as base_brand,
    bp.category as base_category,
    bp.price_cents as base_price_cents,
    -- Candidate product info
    cp.title as candidate_title,
    cp.brand as candidate_brand,
    cp.category as candidate_category,
    cp.price_cents as candidate_price_cents
FROM recommendation_impressions ri
LEFT JOIN recommendation_labels rl ON rl.impression_id = ri.id
JOIN products bp ON bp.id = ri.base_product_id
JOIN products cp ON cp.id = ri.candidate_product_id;

-- ============================================================================
-- Stats View for Monitoring
-- ============================================================================
CREATE OR REPLACE VIEW v_recommendation_stats AS
SELECT 
    DATE_TRUNC('day', created_at) as day,
    source,
    context,
    COUNT(*) as impression_count,
    COUNT(DISTINCT request_id) as request_count,
    COUNT(DISTINCT base_product_id) as unique_base_products,
    AVG(candidate_score) as avg_candidate_score,
    AVG(clip_sim) as avg_clip_sim,
    AVG(text_sim) as avg_text_sim,
    AVG(final_match_score) as avg_match_score
FROM recommendation_impressions
GROUP BY DATE_TRUNC('day', created_at), source, context
ORDER BY day DESC, source;
