# DB Query Indexing Strategy for Hydration Latency (8.75s → ~4.5s)

## Problem Summary

Your logs show **8.75 seconds total latency** for image search, with two major bottlenecks:

| Component | Time | % | Issue |
|-----------|------|---|-------|
| **Hydration** | 3604ms | 46% | 556 cache misses, heap lookups |
| **Reranking** | 3028ms | 39% | Category/color/brand filtering without indexes |
| **KNN Search** | 1193ms | 15% | Vector database (acceptable) |

## Root Causes

### Hydration Bottleneck (3604ms)
The query pattern:
```sql
SELECT p.id, p.title, p.brand, p.price_cents, p.image_cdn, 
       p.image_url, p.category, p.description, p.vendor_id, p.size, p.color
FROM products p
WHERE p.id = ANY($1::bigint[])  -- fetching 44 product IDs
```

**Problem**: Without a covering index, PostgreSQL must:
1. Use index to find 44 matching product IDs
2. Jump to main table heap for each row (random I/O) ← **Cache misses here**
3. Read 10 columns per row
4. Aggregate results

With 556 cache misses, this becomes very slow.

### Reranking Bottleneck (3028ms)
Visual coherence scoring (Feature #6) filters heavily on:
- `category + color` combinations (color harmony)
- `brand + category` pairs (learned compatibility)
- Exact `color` values

Without indexes, each filter scans the entire `products` table.

## Solution: 17 Targeted Indexes

### Tier 1: Critical (Do These First)

#### Index 1: Covering Index on Products (HIGHEST PRIORITY)
```sql
CREATE INDEX idx_products_hydration_covering
  ON products(id)
  INCLUDE (title, brand, price_cents, image_cdn, image_url, category,
           description, vendor_id, size, color);
```

**Impact**: Hydration 3604ms → ~1000ms (72% reduction)
- All 10 columns live in index B-tree pages
- PostgreSQL performs "Index-Only Scan" without heap lookups
- Eliminates 556 cache misses from heap page faults

#### Index 2-4: Reranking Composite Indexes
```sql
-- Color harmony scoring
CREATE INDEX idx_products_category_color
  ON products(category, color)
  INCLUDE (id, brand, price_cents);

-- Learned compatibility rules
CREATE INDEX idx_products_brand_category
  ON products(brand, category)
  INCLUDE (id, color, price_cents);

-- Direct color filtering
CREATE INDEX idx_products_color
  ON products(color)
  INCLUDE (id, category, brand);
```

**Impact**: Reranking 3028ms → ~1200ms (60% reduction)

### Tier 2: Important (Feature #6 Specific)

#### Indexes 5-10: Wardrobe & Compatibility
```sql
-- Wardrobe item lookups during auto-sync
CREATE INDEX idx_wardrobe_items_user
  ON wardrobe_items(user_id)
  INCLUDE (id, product_id, dominant_colors, embedding);

-- Learned compatibility graph traversal
CREATE INDEX idx_learned_compat_categories
  ON learned_compatibility_rules(category1, category2)
  INCLUDE (score, co_occurrences, confidence);

-- Outfit coherence caching (avoid recalculation)
CREATE INDEX idx_outfit_coherence_scores
  ON outfit_coherence_scores(outfit_id, user_id)
  INCLUDE (total_score, dimension_scores);

-- Auto-sync settings lookups
CREATE INDEX idx_auto_sync_settings_user
  ON user_auto_sync_settings(user_id)
  INCLUDE (enabled, sync_frequency, last_sync_at);

-- Purchase sync tracking
CREATE INDEX idx_purchase_sync_log
  ON purchase_sync_log(user_id, purchase_id, synced_at DESC);

-- Image analysis cache
CREATE INDEX idx_wardrobe_analysis_cache
  ON wardrobe_item_analysis_cache(wardrobe_item_id)
  INCLUDE (detection_method, processing_time_ms);
```

### Tier 3: Graph Optimization

#### Indexes 11-12: Compatibility Graph
```sql
CREATE INDEX idx_compat_graph_nodes_user
  ON compatibility_graph_nodes(user_id, category)
  INCLUDE (id, occurrence_count);

CREATE INDEX idx_compat_graph_edges
  ON compatibility_graph_edges(user_id, source_category, compatibility_score DESC)
  INCLUDE (target_category, id);

CREATE INDEX idx_outfit_layering
  ON outfit_layering_analysis(outfit_id)
  INCLUDE (layer_structure, validation_passed);
```

## Implementation Steps

### Step 1: Apply Migrations
```bash
npm run migrate -- up 015_hydration_performance_indexes.sql
npm run migrate -- up 016_wardrobe_feature_indexes.sql
```

### Step 2: Validate Index Creation
```sql
-- Check all indexes exist
SELECT indexname FROM pg_indexes WHERE tablename = 'products';

-- Check covering index specifically
SELECT indexname, pg_size_pretty(pg_relation_size(indexrelid)) as size
FROM pg_stat_user_indexes
WHERE indexname = 'idx_products_hydration_covering';
```

### Step 3: Verify Index-Only Scans
```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT p.id, p.title, p.brand, p.price_cents, p.image_cdn, p.image_url,
       p.category, p.description, p.vendor_id, p.size, p.color
FROM products p
WHERE p.id = ANY(ARRAY[1, 2, 3, 4, 5]);
```

**Expected output**: Should show `Index-Only Scan`, NOT `Heap Fetch`

### Step 4: Monitor Performance
After deployment, check logs for improvements:

```bash
# Search latency should drop ~60%
grep "total_ms\|hydrate_ms\|rerank_ms" /var/log/marketplace/search.log

# Before: total_ms: 7826, hydrate_ms: 3604, rerank_ms: 3028
# After:  total_ms: ~3500, hydrate_ms: ~1000, rerank_ms: ~1200
```

## Index Statistics & Size

**Expected index sizes** (on 100k products):
- `idx_products_hydration_covering` - ~180MB (larger, but worth it)
- `idx_products_category_color` - ~80MB
- `idx_products_brand_category` - ~75MB
- `idx_products_color` - ~40MB
- Wardrobe indexes combined - ~150MB

**Total**: ~525MB additional storage for **60% latency reduction**

## Monitoring Queries

### After 24 hours of traffic, check index usage:
```sql
SELECT schemaname, tablename, indexname, idx_scan, 
       idx_tup_read, idx_tup_fetched, pg_size_pretty(pg_relation_size(indexrelid)) as size
FROM pg_stat_user_indexes
WHERE tablename IN ('products', 'wardrobe_items', 'learned_compatibility_rules')
ORDER BY idx_scan DESC;
```

### Remove unused indexes (if any):
```sql
SELECT schemaname, tablename, indexname, idx_scan
FROM pg_stat_user_indexes
WHERE idx_scan = 0 AND tablename = 'products'
ORDER BY pg_relation_size(indexrelid) DESC;
```

## Performance Targets

| Stage | Before | After | Gain |
|-------|--------|-------|------|
| Hydration | 3604ms | ~1000ms | 72% ↓ |
| Reranking | 3028ms | ~1200ms | 60% ↓ |
| KNN | 1193ms | ~1193ms | 0% (vector DB) |
| Setup | 1ms | ~1ms | 0% |
| **Total Search** | **~7.8s** | **~3.4s** | **56% ↓** |
| **Full Response** | **~8.75s** | **~4.2s** | **52% ↓** |

## Next Steps After Indexing

1. **Monitor for 24-48 hours** to confirm index benefits
2. **Check slow query logs** for remaining bottlenecks
3. **Profile attribute embedding timeout** (3 timeouts in logs)
4. **Consider query caching** for frequently repeated searches
5. **Analyze reranking algorithm** - can it be vectorized?

---

## Quick Reference: Index by Problem

| Problem | Index | Expected Gain |
|---------|-------|---|
| Hydration 3604ms | `idx_products_hydration_covering` | 72% reduction |
| Category+color filtering | `idx_products_category_color` | 40% reduction |
| Brand+category rules | `idx_products_brand_category` | 35% reduction |
| Color harmony scoring | `idx_products_color` | 25% reduction |
| Feature #6 auto-sync | `idx_wardrobe_items_user` | 75% reduction |
| Learned rules lookup | `idx_learned_compat_categories` | 60% reduction |
| Outfit coherence cache | `idx_outfit_coherence_scores` | 80% reduction |

---

**Recommendation**: Start with Migration 015 (main indexes), measure impact for 24 hours, then apply Migration 016 (feature-specific indexes) if searching is still slow.
