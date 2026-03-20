-- Fashion search taxonomy + per-product enrichment (Phase 2).
-- Phase 1 relies on src/lib/search/productTypeTaxonomy.ts + OpenSearch product_types.
-- Run after products exist; indexing jobs read enrichment when present.

CREATE TABLE IF NOT EXISTS canonical_product_types (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    parent_id TEXT REFERENCES canonical_product_types (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_type_aliases (
    id BIGSERIAL PRIMARY KEY,
    canonical_id TEXT NOT NULL REFERENCES canonical_product_types (id) ON DELETE CASCADE,
    alias TEXT NOT NULL,
    locale TEXT,
    source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'mined', 'vendor', 'ml')),
    weight REAL NOT NULL DEFAULT 1.0,
    UNIQUE (canonical_id, alias)
);

CREATE INDEX IF NOT EXISTS idx_product_type_aliases_alias_lower
ON product_type_aliases (lower(alias));

CREATE TABLE IF NOT EXISTS product_type_edges (
    id BIGSERIAL PRIMARY KEY,
    from_id TEXT NOT NULL REFERENCES canonical_product_types (id) ON DELETE CASCADE,
    to_id TEXT NOT NULL REFERENCES canonical_product_types (id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('parent', 'related', 'sibling_cluster')),
    weight REAL NOT NULL DEFAULT 1.0,
    UNIQUE (from_id, to_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_product_type_edges_from ON product_type_edges (from_id);
CREATE INDEX IF NOT EXISTS idx_product_type_edges_to ON product_type_edges (to_id);

CREATE TABLE IF NOT EXISTS product_search_enrichment (
    product_id BIGINT PRIMARY KEY REFERENCES products (id) ON DELETE CASCADE,
    canonical_type_ids TEXT[] NOT NULL DEFAULT '{}',
    raw_category TEXT,
    raw_brand TEXT,
    norm_confidence REAL NOT NULL DEFAULT 0 CHECK (norm_confidence >= 0 AND norm_confidence <= 1),
    category_confidence REAL NOT NULL DEFAULT 0 CHECK (category_confidence >= 0 AND category_confidence <= 1),
    brand_confidence REAL NOT NULL DEFAULT 0 CHECK (brand_confidence >= 0 AND brand_confidence <= 1),
    attribute_json JSONB NOT NULL DEFAULT '{}',
    classifier_version TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_search_enrichment_canonical
ON product_search_enrichment USING gin (canonical_type_ids);

-- Seed minimal canonical nodes (expand via admin / ETL)
INSERT INTO canonical_product_types (id, slug, display_name, parent_id) VALUES
    ('bottoms', 'bottoms', 'Bottoms', NULL),
    ('bottoms_pants', 'pants', 'Pants & trousers', 'bottoms'),
    ('bottoms_shorts', 'shorts', 'Shorts', 'bottoms'),
    ('footwear', 'footwear', 'Footwear', NULL),
    ('footwear_shoes', 'shoes', 'Shoes', 'footwear'),
    ('tops', 'tops', 'Tops', NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO product_type_aliases (canonical_id, alias, source, weight) VALUES
    ('bottoms_pants', 'pants', 'manual', 1),
    ('bottoms_pants', 'jeans', 'manual', 1),
    ('bottoms_pants', 'trousers', 'manual', 1),
    ('bottoms_pants', 'chinos', 'manual', 1),
    ('bottoms_pants', 'leggings', 'manual', 1),
    ('bottoms_pants', 'joggers', 'manual', 1),
    ('footwear_shoes', 'shoes', 'manual', 1),
    ('footwear_shoes', 'sneakers', 'manual', 1),
    ('footwear_shoes', 'trainers', 'manual', 1),
    ('footwear_shoes', 'boots', 'manual', 1)
ON CONFLICT (canonical_id, alias) DO NOTHING;

INSERT INTO product_type_edges (from_id, to_id, kind, weight) VALUES
    ('bottoms_pants', 'bottoms', 'parent', 1),
    ('bottoms_shorts', 'bottoms', 'parent', 1),
    ('footwear_shoes', 'footwear', 'parent', 1)
ON CONFLICT (from_id, to_id, kind) DO NOTHING;
