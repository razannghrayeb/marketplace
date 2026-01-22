-- ============================================================================
-- Migration: 003_digital_twin_phase0.sql
-- Purpose: Add Digital Twin foundation tables for wardrobe management
-- ============================================================================

-- ============================================================================
-- PART 1: Lookup / Enumeration Tables
-- ============================================================================

-- Categories (controlled vocabulary for garment types)
CREATE TABLE IF NOT EXISTS categories (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,          -- e.g., "tops", "bottoms", "dresses"
    parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO categories (name, display_order) VALUES
    ('tops', 1),
    ('bottoms', 2),
    ('dresses', 3),
    ('outerwear', 4),
    ('shoes', 5),
    ('bags', 6),
    ('accessories', 7),
    ('swimwear', 8),
    ('activewear', 9),
    ('loungewear', 10)
ON CONFLICT (name) DO NOTHING;

-- Subcategories (linked to parent categories)
INSERT INTO categories (name, parent_id, display_order)
SELECT sub.name, c.id, sub.ord
FROM (VALUES
    ('t-shirts', 'tops', 1),
    ('blouses', 'tops', 2),
    ('sweaters', 'tops', 3),
    ('hoodies', 'tops', 4),
    ('tank-tops', 'tops', 5),
    ('jeans', 'bottoms', 1),
    ('pants', 'bottoms', 2),
    ('shorts', 'bottoms', 3),
    ('skirts', 'bottoms', 4),
    ('leggings', 'bottoms', 5),
    ('midi-dresses', 'dresses', 1),
    ('maxi-dresses', 'dresses', 2),
    ('mini-dresses', 'dresses', 3),
    ('jackets', 'outerwear', 1),
    ('coats', 'outerwear', 2),
    ('blazers', 'outerwear', 3),
    ('vests', 'outerwear', 4),
    ('sneakers', 'shoes', 1),
    ('boots', 'shoes', 2),
    ('heels', 'shoes', 3),
    ('sandals', 'shoes', 4),
    ('flats', 'shoes', 5),
    ('handbags', 'bags', 1),
    ('backpacks', 'bags', 2),
    ('clutches', 'bags', 3),
    ('hats', 'accessories', 1),
    ('scarves', 'accessories', 2),
    ('belts', 'accessories', 3),
    ('jewelry', 'accessories', 4),
    ('sunglasses', 'accessories', 5)
) AS sub(name, parent_name, ord)
JOIN categories c ON c.name = sub.parent_name
ON CONFLICT (name) DO NOTHING;

-- Colors (canonical color palette)
CREATE TABLE IF NOT EXISTS colors (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,          -- e.g., "navy", "burgundy"
    hex TEXT NOT NULL,                  -- e.g., "#000080"
    color_family TEXT NOT NULL,         -- e.g., "blue", "red", "neutral"
    is_neutral BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO colors (name, hex, color_family, is_neutral) VALUES
    ('black', '#000000', 'neutral', true),
    ('white', '#FFFFFF', 'neutral', true),
    ('gray', '#808080', 'neutral', true),
    ('charcoal', '#36454F', 'neutral', true),
    ('cream', '#FFFDD0', 'neutral', true),
    ('beige', '#F5F5DC', 'neutral', true),
    ('tan', '#D2B48C', 'neutral', true),
    ('brown', '#8B4513', 'brown', false),
    ('navy', '#000080', 'blue', false),
    ('royal-blue', '#4169E1', 'blue', false),
    ('light-blue', '#ADD8E6', 'blue', false),
    ('teal', '#008080', 'blue', false),
    ('red', '#FF0000', 'red', false),
    ('burgundy', '#800020', 'red', false),
    ('coral', '#FF7F50', 'red', false),
    ('pink', '#FFC0CB', 'pink', false),
    ('blush', '#DE5D83', 'pink', false),
    ('green', '#008000', 'green', false),
    ('olive', '#808000', 'green', false),
    ('mint', '#98FF98', 'green', false),
    ('forest-green', '#228B22', 'green', false),
    ('yellow', '#FFFF00', 'yellow', false),
    ('mustard', '#FFDB58', 'yellow', false),
    ('orange', '#FFA500', 'orange', false),
    ('purple', '#800080', 'purple', false),
    ('lavender', '#E6E6FA', 'purple', false),
    ('gold', '#FFD700', 'metallic', false),
    ('silver', '#C0C0C0', 'metallic', false)
ON CONFLICT (name) DO NOTHING;

-- Patterns
CREATE TABLE IF NOT EXISTS patterns (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO patterns (name) VALUES
    ('solid'),
    ('stripes'),
    ('plaid'),
    ('checkered'),
    ('floral'),
    ('polka-dots'),
    ('geometric'),
    ('abstract'),
    ('animal-print'),
    ('camo'),
    ('tie-dye'),
    ('paisley'),
    ('houndstooth'),
    ('herringbone')
ON CONFLICT (name) DO NOTHING;

-- Materials
CREATE TABLE IF NOT EXISTS materials (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    is_natural BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO materials (name, is_natural) VALUES
    ('cotton', true),
    ('linen', true),
    ('silk', true),
    ('wool', true),
    ('cashmere', true),
    ('leather', true),
    ('suede', true),
    ('denim', true),
    ('polyester', false),
    ('nylon', false),
    ('rayon', false),
    ('spandex', false),
    ('viscose', false),
    ('acrylic', false),
    ('velvet', false),
    ('satin', false),
    ('chiffon', false),
    ('tweed', true),
    ('fleece', false),
    ('jersey', false)
ON CONFLICT (name) DO NOTHING;

-- Occasions
CREATE TABLE IF NOT EXISTS occasions (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    formality_level INTEGER DEFAULT 3 CHECK (formality_level >= 1 AND formality_level <= 5),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO occasions (name, formality_level) VALUES
    ('casual', 1),
    ('smart-casual', 2),
    ('business-casual', 3),
    ('work', 3),
    ('date-night', 3),
    ('formal', 4),
    ('black-tie', 5),
    ('wedding-guest', 4),
    ('sport', 1),
    ('beach', 1),
    ('lounge', 1),
    ('party', 3)
ON CONFLICT (name) DO NOTHING;

-- Seasons
CREATE TABLE IF NOT EXISTS seasons (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO seasons (name) VALUES
    ('spring'),
    ('summer'),
    ('fall'),
    ('winter'),
    ('all-season')
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- PART 2: Core Wardrobe Items Table (replaces users_closet concept)
-- ============================================================================

CREATE TABLE IF NOT EXISTS wardrobe_items (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Source: where did this item come from?
    source TEXT NOT NULL CHECK (source IN ('uploaded', 'purchased', 'manual', 'linked')),
    product_id BIGINT REFERENCES products(id) ON DELETE SET NULL,  -- if from catalog
    
    -- Images
    image_url TEXT,
    image_cdn TEXT,
    r2_key TEXT UNIQUE,
    p_hash TEXT,
    
    -- Core attributes (may be ML-extracted or user-provided)
    name TEXT,                          -- user-given name, e.g., "My favorite blue shirt"
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    brand TEXT,
    
    -- Dominant colors (top 3 with percentages)
    dominant_colors JSONB DEFAULT '[]', -- [{"color_id": 1, "hex": "#000", "percent": 0.6}, ...]
    
    -- Pattern & Material
    pattern_id INTEGER REFERENCES patterns(id) ON DELETE SET NULL,
    material_id INTEGER REFERENCES materials(id) ON DELETE SET NULL,
    
    -- Embedding for similarity search
    embedding vector(512),
    
    -- Extraction metadata
    attributes_extracted BOOLEAN DEFAULT FALSE,
    extraction_version TEXT,            -- e.g., "fashionclip-v1.0"
    extraction_confidence DECIMAL(4,3), -- 0.000 - 1.000
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wardrobe_items_user_id ON wardrobe_items(user_id);
CREATE INDEX IF NOT EXISTS idx_wardrobe_items_category_id ON wardrobe_items(category_id);
CREATE INDEX IF NOT EXISTS idx_wardrobe_items_source ON wardrobe_items(source);
CREATE INDEX IF NOT EXISTS idx_wardrobe_items_product_id ON wardrobe_items(product_id);

-- ============================================================================
-- PART 3: Wardrobe Item Junction Tables (many-to-many for occasions/seasons)
-- ============================================================================

CREATE TABLE IF NOT EXISTS wardrobe_item_occasions (
    wardrobe_item_id BIGINT NOT NULL REFERENCES wardrobe_items(id) ON DELETE CASCADE,
    occasion_id INTEGER NOT NULL REFERENCES occasions(id) ON DELETE CASCADE,
    PRIMARY KEY (wardrobe_item_id, occasion_id)
);

CREATE TABLE IF NOT EXISTS wardrobe_item_seasons (
    wardrobe_item_id BIGINT NOT NULL REFERENCES wardrobe_items(id) ON DELETE CASCADE,
    season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    PRIMARY KEY (wardrobe_item_id, season_id)
);

-- ============================================================================
-- PART 4: Style Profiles (aggregated user fingerprint)
-- ============================================================================

CREATE TABLE IF NOT EXISTS style_profiles (
    id SERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    
    -- Aggregated stats
    category_histogram JSONB DEFAULT '{}',      -- {"tops": 12, "bottoms": 8, ...}
    color_palette JSONB DEFAULT '[]',           -- [{"hex": "#1a1a1a", "weight": 0.3}, ...]
    pattern_histogram JSONB DEFAULT '{}',       -- {"solid": 20, "stripes": 5, ...}
    material_histogram JSONB DEFAULT '{}',      -- {"cotton": 15, "polyester": 8, ...}
    
    -- Style centroid (mean of all item embeddings)
    style_centroid vector(512),
    
    -- Coverage
    occasion_coverage TEXT[] DEFAULT '{}',      -- occasions user can dress for
    season_coverage TEXT[] DEFAULT '{}',        -- seasons user is covered for
    
    -- Stats
    total_items INTEGER DEFAULT 0,
    brands_count INTEGER DEFAULT 0,
    top_brands JSONB DEFAULT '[]',              -- [{"brand": "Zara", "count": 5}, ...]
    
    -- Versioning
    version TEXT DEFAULT '1.0.0',
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_style_profiles_user_id ON style_profiles(user_id);

-- ============================================================================
-- PART 5: Compatibility Edges (precomputed pairings)
-- ============================================================================

CREATE TABLE IF NOT EXISTS compatibility_edges (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_a_id BIGINT NOT NULL REFERENCES wardrobe_items(id) ON DELETE CASCADE,
    item_b_id BIGINT NOT NULL REFERENCES wardrobe_items(id) ON DELETE CASCADE,
    
    -- Scores
    score DECIMAL(4,3) NOT NULL CHECK (score >= 0 AND score <= 1),  -- 0.000 - 1.000
    color_harmony_score DECIMAL(4,3),
    style_similarity_score DECIMAL(4,3),
    
    -- Explanation (optional, from LLM or rules)
    reasoning TEXT,
    
    -- Metadata
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Ensure no duplicates and no self-pairs
    UNIQUE(user_id, item_a_id, item_b_id),
    CHECK (item_a_id < item_b_id)  -- canonical ordering to avoid (A,B) and (B,A)
);

CREATE INDEX IF NOT EXISTS idx_compatibility_edges_user_id ON compatibility_edges(user_id);
CREATE INDEX IF NOT EXISTS idx_compatibility_edges_item_a ON compatibility_edges(item_a_id);
CREATE INDEX IF NOT EXISTS idx_compatibility_edges_item_b ON compatibility_edges(item_b_id);
CREATE INDEX IF NOT EXISTS idx_compatibility_edges_score ON compatibility_edges(user_id, score DESC);

-- ============================================================================
-- PART 6: Refactor Outfits → outfit_items junction table
-- ============================================================================

-- Drop old constraint if exists (outfits.closet_id references users_closet which is deprecated)
ALTER TABLE outfits DROP CONSTRAINT IF EXISTS outfits_closet_id_fkey;

-- Modify outfits table: remove old columns, add new ones
ALTER TABLE outfits 
    DROP COLUMN IF EXISTS closet_id,
    DROP COLUMN IF EXISTS product_ids,
    ADD COLUMN IF NOT EXISTS description TEXT,
    ADD COLUMN IF NOT EXISTS occasion_id INTEGER REFERENCES occasions(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS season_id INTEGER REFERENCES seasons(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Outfit items junction table
CREATE TABLE IF NOT EXISTS outfit_items (
    id SERIAL PRIMARY KEY,
    outfit_id INTEGER NOT NULL REFERENCES outfits(id) ON DELETE CASCADE,
    wardrobe_item_id BIGINT NOT NULL REFERENCES wardrobe_items(id) ON DELETE CASCADE,
    layer_order INTEGER DEFAULT 0,      -- for layering: 0=base, 1=mid, 2=outer
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(outfit_id, wardrobe_item_id)
);

CREATE INDEX IF NOT EXISTS idx_outfit_items_outfit_id ON outfit_items(outfit_id);
CREATE INDEX IF NOT EXISTS idx_outfit_items_wardrobe_item_id ON outfit_items(wardrobe_item_id);

-- ============================================================================
-- PART 7: Add embedding to user_uploaded_images for backward compatibility
-- ============================================================================

ALTER TABLE user_uploaded_images 
    ADD COLUMN IF NOT EXISTS embedding vector(512),
    ADD COLUMN IF NOT EXISTS migrated_to_wardrobe BOOLEAN DEFAULT FALSE;

-- ============================================================================
-- PART 8: Gap Analysis Cache Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS wardrobe_gaps (
    id SERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    gap_type TEXT NOT NULL CHECK (gap_type IN ('category', 'color', 'occasion', 'season', 'compatibility')),
    gap_key TEXT NOT NULL,              -- e.g., "bottoms", "formal", "winter"
    severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
    
    -- Recommendation context
    recommendation_query TEXT,          -- suggested search query
    recommendation_categories INTEGER[], -- suggested category_ids to look for
    
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(user_id, gap_type, gap_key)
);

CREATE INDEX IF NOT EXISTS idx_wardrobe_gaps_user_id ON wardrobe_gaps(user_id);

-- ============================================================================
-- PART 9: Deprecate users_closet (keep for backward compat, but mark deprecated)
-- ============================================================================

COMMENT ON TABLE users_closet IS 'DEPRECATED: Use wardrobe_items instead. Kept for backward compatibility.';

-- ============================================================================
-- PART 10: Helper function to update updated_at timestamp
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to tables with updated_at
DROP TRIGGER IF EXISTS update_wardrobe_items_updated_at ON wardrobe_items;
CREATE TRIGGER update_wardrobe_items_updated_at
    BEFORE UPDATE ON wardrobe_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_style_profiles_updated_at ON style_profiles;
CREATE TRIGGER update_style_profiles_updated_at
    BEFORE UPDATE ON style_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_outfits_updated_at ON outfits;
CREATE TRIGGER update_outfits_updated_at
    BEFORE UPDATE ON outfits
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
