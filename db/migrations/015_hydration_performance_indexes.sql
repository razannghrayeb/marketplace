-- Migration: Hydration Performance Indexes
-- Purpose: Optimize product hydration queries that fetch 44+ products per search
-- Issue: 556 cache misses during hydration (3604ms latency)
--
-- Main query pattern:
--   SELECT p.id, p.title, p.brand, p.price_cents, p.image_cdn, p.image_url,
--          p.category, p.description, p.vendor_id, p.size, p.color
--   FROM products p
--   WHERE p.id = ANY($1::bigint[])

-- ============================================================================
-- 1. COVERING INDEX: id + hydration columns (main win)
-- ============================================================================
-- This single index covers the entire hydration query on the products table.
-- PostgreSQL can satisfy the query without touching the main heap, reducing
-- I/O by ~70% for the hydration step.
CREATE INDEX IF NOT EXISTS idx_products_hydration_covering
  ON products(id)
  INCLUDE (title, brand, price_cents, image_cdn, image_url, category,
           description, vendor_id, size, color);

-- ============================================================================
-- 2. FILTER INDEX: active products only (common optimization)
-- ============================================================================
-- If you filter out inactive/delisted products, this reduces scanned rows.
-- Requires products table to have status/is_active column.
-- CREATE INDEX IF NOT EXISTS idx_products_hydration_active
--   ON products(id)
--   INCLUDE (title, brand, price_cents, image_cdn, image_url, category, description)
--   WHERE status = 'active' OR is_active = TRUE;

-- ============================================================================
-- 3. PARTIAL INDEX: by category (secondary optimization)
-- ============================================================================
-- If you frequently hydrate products filtered by category in reranking:
-- CREATE INDEX IF NOT EXISTS idx_products_by_category
--   ON products(category, id)
--   INCLUDE (title, brand, price_cents, image_url);

-- ============================================================================
-- 4. PARTIAL INDEX: by vendor (for vendor-specific queries)
-- ============================================================================
-- If you hydrate vendor-specific product batches:
-- CREATE INDEX IF NOT EXISTS idx_products_by_vendor
--   ON products(vendor_id, id)
--   INCLUDE (title, brand, price_cents);

-- ============================================================================
-- 5. COMPOSITE INDEX: category + color (reranking optimization)
-- ============================================================================
-- Reranking uses color harmony, style consistency filters during scoring.
-- This prevents table scans when filtering by category/color:
CREATE INDEX IF NOT EXISTS idx_products_category_color
  ON products(category, color)
  INCLUDE (id, brand, price_cents);

-- ============================================================================
-- 6. COMPOSITE INDEX: brand + category (outfit/style matching)
-- ============================================================================
-- Learned compatibility rules query products by brand+category pairs:
CREATE INDEX IF NOT EXISTS idx_products_brand_category
  ON products(brand, category)
  INCLUDE (id, color, price_cents);

-- ============================================================================
-- 7. SINGLE INDEX: color (color harmony scoring)
-- ============================================================================
-- Visual coherence scoring filters heavily on color in reranking:
CREATE INDEX IF NOT EXISTS idx_products_color
  ON products(color)
  INCLUDE (id, category, brand);

-- ============================================================================
-- 8. SINGLE INDEX: vendor_id (vendor filtering in search)
-- ============================================================================
-- Some queries filter by vendor_id directly:
CREATE INDEX IF NOT EXISTS idx_products_vendor_id
  ON products(vendor_id)
  INCLUDE (id, category);

-- ============================================================================
-- Analysis: What Each Index Solves
-- ============================================================================
--
-- PROBLEM: 556 cache misses → 3604ms hydration latency
--
-- ROOT CAUSE:
--   - Hydration fetches 44 rows × 10 columns per search
--   - Without a covering index, PostgreSQL must:
--     1. Scan index to find matching IDs
--     2. Jump to heap for each row (random I/O)
--     3. Read additional columns
--   - With cache misses, this multiplies disk seeks
--
-- SOLUTION (Covering Index):
--   - All data (id + 10 columns) stored in B-tree index pages
--   - PostgreSQL stays in index → Index-Only Scan
--   - Eliminates heap lookups → ~70% reduction in hydration time
--   - Expected: 3604ms → ~1000ms (pure network + aggregation)
--
-- SECONDARY: Reranking also queries products by attributes, so partial
-- indexes by category/vendor prevent additional table scans.

-- ============================================================================
-- Reranking Optimization (3028ms → ~900ms expected)
-- ============================================================================
--
-- Current reranking queries:
--   1. Visual coherence: filters by category+color (matching algorithm)
--   2. Learned compatibility: queries by brand+category pairs
--   3. Style scoring: filters by category alone
--   4. Color harmony: filters by exact color values
--
-- Indexes 5-8 optimize these patterns by providing pre-sorted data
-- in indexes without touching the main heap.
--
-- Expected reranking improvement: 40-50% reduction in I/O and CPU time

-- ============================================================================
-- Validation Queries (run after migration)
-- ============================================================================
--
-- Check index was created:
-- SELECT indexname FROM pg_indexes WHERE tablename = 'products';
--
-- Check index size:
-- SELECT
--   schemaname, tablename, indexname,
--   pg_size_pretty(pg_relation_size(indexrelid)) as size
-- FROM pg_stat_user_indexes
-- WHERE tablename = 'products' AND indexname LIKE '%hydration%';
--
-- Check if index is being used (should show Index-Only Scan in EXPLAIN):
-- EXPLAIN (ANALYZE, BUFFERS)
--   SELECT p.id, p.title, p.brand FROM products p
--   WHERE p.id = ANY(ARRAY[1, 2, 3, 4, 5]);
