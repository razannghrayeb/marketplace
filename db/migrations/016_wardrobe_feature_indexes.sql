-- Additional performance indexes for wardrobe features and visual coherence
-- These indexes optimize feature #6 (wardrobe enhancements) queries

-- ============================================================================
-- 9. Wardrobe Item Lookups (auto-sync, analysis)
-- ============================================================================
-- Optimize: SELECT * FROM wardrobe_items WHERE user_id = $1
CREATE INDEX IF NOT EXISTS idx_wardrobe_items_user
  ON wardrobe_items(user_id, id);

-- Optimize: SELECT * FROM wardrobe_items WHERE product_id = $1
CREATE INDEX IF NOT EXISTS idx_wardrobe_items_product
  ON wardrobe_items(product_id, user_id);

-- ============================================================================
-- 10. Learned Compatibility Rules (reranking + suggestions)
-- ============================================================================
-- Optimize: SELECT * FROM learned_compatibility_rules WHERE category1 = $1 AND category2 = $2
CREATE INDEX IF NOT EXISTS idx_learned_compat_categories
  ON learned_compatibility_rules(category1, category2);

-- ============================================================================
-- 11. Outfit Coherence Scores Cache (avoid recalculation)
-- ============================================================================
-- Optimize: SELECT * FROM outfit_coherence_scores WHERE outfit_id = $1
CREATE INDEX IF NOT EXISTS idx_outfit_coherence_scores
  ON outfit_coherence_scores(outfit_id);

-- ============================================================================
-- 12. User Auto-Sync Settings (auto-sync trigger checks)
-- ============================================================================
-- Optimize: SELECT * FROM user_auto_sync_settings WHERE user_id = $1
CREATE INDEX IF NOT EXISTS idx_auto_sync_settings_user
  ON user_auto_sync_settings(user_id);

-- ============================================================================
-- 13. Purchase Sync Log (track what's been synced to avoid duplicates)
-- ============================================================================
-- Optimize: SELECT * FROM purchase_sync_log WHERE user_id = $1 AND purchase_id = $2
CREATE INDEX IF NOT EXISTS idx_purchase_sync_log
  ON purchase_sync_log(user_id, purchase_id);

-- ============================================================================
-- 14. Wardrobe Item Analysis Cache (avoid re-analyzing images)
-- ============================================================================
-- Optimize: SELECT * FROM wardrobe_item_analysis_cache WHERE wardrobe_item_id = $1
CREATE INDEX IF NOT EXISTS idx_wardrobe_analysis_cache
  ON wardrobe_item_analysis_cache(wardrobe_item_id);

-- ============================================================================
-- 15. Compatibility Graph Nodes (visual compatibility graph)
-- ============================================================================
-- Optimize: SELECT * FROM compatibility_graph_nodes WHERE category = $1
CREATE INDEX IF NOT EXISTS idx_compat_graph_nodes_category
  ON compatibility_graph_nodes(category);

-- ============================================================================
-- 16. Compatibility Graph Edges (traverse graph for suggestions)
-- ============================================================================
-- Optimize: SELECT * FROM compatibility_graph_edges WHERE from_category = $1 ORDER BY weight DESC
CREATE INDEX IF NOT EXISTS idx_compat_graph_edges_from_category
  ON compatibility_graph_edges(from_category, weight DESC);

-- ============================================================================
-- 17. Layering Analysis Results (outfit visualization)
-- ============================================================================
-- Optimize: SELECT * FROM outfit_layering_analysis WHERE outfit_id = $1
CREATE INDEX IF NOT EXISTS idx_outfit_layering
  ON outfit_layering_analysis(outfit_id);

-- ============================================================================
-- Expected Performance Improvements
-- ============================================================================
--
-- HYDRATION (Primary bottleneck):
--   Before: 3604ms (556 cache misses, heap lookups)
--   After:  ~1000ms (Index-Only Scan, no heap jumps)
--   Improvement: ~72%
--
-- RERANKING (Secondary bottleneck):
--   Before: 3028ms (category/color/brand filtering causes table scans)
--   After:  ~1200ms (composite indexes + INCLUDE columns)
--   Improvement: ~60%
--
-- FEATURE #6 OPERATIONS:
--   Auto-sync: 200ms → 50ms (wardrobe_items user index)
--   Visual coherence: 300ms → 80ms (outfit_coherence_scores cache)
--   Learned rules: 150ms → 30ms (compatibility_rules composite index)
--
-- TOTAL SEARCH LATENCY:
--   Before: 7826ms total + 3604ms hydration = ~11.4s
--   After:  7826ms → ~3500ms (reranking optimized)
--           + ~1000ms hydration
--           = ~4.5s total (60% reduction)
--
-- NOTE: These are estimates. Actual gains depend on:
--   - Table size (index effectiveness increases with larger tables)
--   - Cache locality (SSD vs HDD matters)
--   - Query patterns (these indexes are tuned for current patterns)
--   - PostgreSQL version (9.3+ fully supports INCLUDE)

-- ============================================================================
-- Validation & Monitoring
-- ============================================================================
--
-- 1. Check all indexes were created:
--    SELECT indexname FROM pg_indexes WHERE tablename IN ('products', 'wardrobe_items', 'learned_compatibility_rules', 'outfit_coherence_scores', 'user_auto_sync_settings', 'purchase_sync_log', 'wardrobe_item_analysis_cache', 'compatibility_graph_nodes', 'compatibility_graph_edges', 'outfit_layering_analysis');
--
-- 2. Check index sizes:
--    SELECT schemaname, tablename, indexname, pg_size_pretty(pg_relation_size(indexrelid)) as size
--    FROM pg_stat_user_indexes
--    WHERE tablename = 'products'
--    ORDER BY pg_relation_size(indexrelid) DESC;
--
-- 3. Monitor index usage (after 24 hours of traffic):
--    SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read, idx_tup_fetched
--    FROM pg_stat_user_indexes
--    WHERE schemaname = 'public'
--    ORDER BY idx_scan DESC;
--
-- 4. Check for unused indexes (remove if never used):
--    SELECT schemaname, tablename, indexname, idx_scan
--    FROM pg_stat_user_indexes
--    WHERE idx_scan = 0 AND indexname LIKE '%hydration%'
--    ORDER BY pg_relation_size(indexrelid) DESC;
--
-- 5. Verify Index-Only Scans with EXPLAIN:
--    EXPLAIN (ANALYZE, BUFFERS)
--    SELECT p.id, p.title, p.brand FROM products p
--    WHERE p.id = ANY(ARRAY[1,2,3,4,5]);
--    -- Look for "Index-Only Scan" in plan (not "Index Scan" + "Heap Fetch")
--
-- 6. Monitor query performance in logs:
--    grep "hydrate_ms\|rerank_ms" /var/log/marketplace/search.log
--    -- Should see 40-60% reduction in these metrics

-- ============================================================================
-- Cleanup (if needed - removes all performance indexes)
-- ============================================================================
--
-- DROP INDEX IF EXISTS idx_products_hydration_covering;
-- DROP INDEX IF EXISTS idx_products_category_color;
-- DROP INDEX IF EXISTS idx_products_brand_category;
-- DROP INDEX IF EXISTS idx_products_color;
-- DROP INDEX IF EXISTS idx_products_vendor_id;
-- DROP INDEX IF EXISTS idx_wardrobe_items_user;
-- DROP INDEX IF EXISTS idx_wardrobe_items_product;
-- DROP INDEX IF EXISTS idx_learned_compat_categories;
-- DROP INDEX IF EXISTS idx_learned_compat_confidence;
-- DROP INDEX IF EXISTS idx_outfit_coherence_scores;
-- DROP INDEX IF EXISTS idx_auto_sync_settings_user;
-- DROP INDEX IF EXISTS idx_purchase_sync_log;
-- DROP INDEX IF EXISTS idx_wardrobe_analysis_cache;
-- DROP INDEX IF EXISTS idx_compat_graph_nodes_user;
-- DROP INDEX IF EXISTS idx_compat_graph_edges;
-- DROP INDEX IF EXISTS idx_outfit_layering;
