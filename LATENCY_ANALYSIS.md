# Latency Analysis & Optimization Opportunities

**Total Latency: 16.5s** | **Key Bottleneck: Reranking (11s, 67% of total)**

---

## 📊 Current Timing Breakdown

```
Total:                16,565ms (100%)
├─ KNN Search:         2,152ms (13%)
├─ Reranking:         11,375ms (67%) ⚠️ MAIN BOTTLENECK
├─ Hydration:          3,037ms (18%)
└─ Setup:                  1ms (<1%)

Reranking Details:
├─ attr_mget:          5,228ms (46% of rerank) ⚠️ PRIMARY ISSUE
│  └─ batches: 4
├─ rerank operations:  ~6,147ms (54%)
│  ├─ attribute_similarity:      9ms
│  ├─ final_relevance:         303ms
│  ├─ sorting:                   4ms
│  ├─ post_filtering:           13ms
│  └─ other overhead:       ~5,818ms
└─ hits_processed: 486
```

---

## 🎯 Priority Opportunities (Ordered by Impact)

### **1. Parallelize attr_mget + Hydration (CRITICAL)**
**Current Flow:** Sequential
```
KNN (2.1s) → attr_mget (5.2s) → hydrate (3.0s) = 10.3s
```

**Optimized Flow:** Parallel
```
KNN (2.1s) → [attr_mget (5.2s) PARALLEL WITH hydrate (3.0s)] = 5.2s
Total savings: ~3s (30% reduction)
```

**Why Parallelizable:**
- `attr_mget` fetches embeddings from OpenSearch (colors, textures, styles, patterns, materials)
- Hydration fetches product details from PostgreSQL (title, brand, price)
- **Zero dependencies** between these two operations—both read-only, independent data sources

**Implementation:**
- Move `productHydrationPromise` creation earlier (before reranking phase)
- Create both promises at the same time instead of hydrating after signals
- Keep existing sequential flow after both complete

---

### **2. Batch attr_mget Calls (HIGH)**
**Current:** Single mget call for top 200 IDs (but tracking shows 4 batches?)
**Issue:** If 4 sequential mget calls are happening, they're blocking each other

**Solution:**
- Combine all 4 batches into 1-2 mget calls by prefetching all needed IDs upfront
- Batch size: OpenSearch handles 500+ docs easily
- Estimated savings: **~1.5-2.5s** (reduce sequential fetches to single call)

**Check:** Verify where the 4 batches originate from (likely attribute reranker loop?)

---

### **3. Optimize OpenSearch mget Request Size (MEDIUM)**
**Current:** Fetching only necessary embedding fields
```javascript
_source: ["embedding_color", "embedding_texture", "embedding_material", "embedding_style", "embedding_pattern", ...]
```

**Issue:** Large vectors (typically 512-1024 dimensions) × 486 hits = significant payload

**Optimizations:**
- **Lazy-fetch pattern:** Only fetch embeddings for top K candidates (e.g., top 100), not all 486
- **Separate mget by signal:** Split into:
  - Color-only mget (if only color query)
  - Full mget (if all signals needed)
- Estimated savings: **500-800ms**

---

### **4. Pipeline Reranking Operations (MEDIUM)**
**Current:** Sequential scoring through all 486 hits
- Attribute similarity: 9ms (vectorized, fast ✓)
- Final relevance: 303ms (likely aggregation of multiple signal scores)
- Other: ~5.8s (unknown - needs investigation)

**Optimization Strategies:**
- **Early termination:** Sort by visual similarity first, cut to top 200 before attribute scoring
- **Vectorized operations:** Ensure CLIP cosine similarity uses SIMD (check implementation)
- **Worker threads:** Move attribute scoring to worker pool if CPU-bound
- Estimated savings: **800-1200ms**

---

### **5. Reduce Hydration Scope (MEDIUM)**
**Current:** Hydrating based on `hydrationPrefetchMultiplier`

**Issue:** Fetching 200+ product details sequentially from PostgreSQL

**Optimizations:**
- **Increase prefetch multiplier** only for top results needed for ranking
- **Two-pass hydration:**
  - Pass 1: Fetch top 50-100 for reranking (fast)
  - Pass 2: Lazy-fetch remaining on-demand
- **Connection pooling:** Ensure pg.query uses connection pool
- Estimated savings: **500-700ms**

---

### **6. Cache Attribute Embeddings (LONG-TERM)**
**Current:** Fetching embeddings from OpenSearch every request

**Optimization:**
- **Redis cache layer** for frequently-searched attributes:
  - Color embeddings (small cardinality: ~50 colors)
  - Style embeddings (small cardinality: ~30 styles)
  - TTL: 1 hour
- **Impact:** 
  - Saves 5.2s mget → 200-500ms for top colors/styles
  - Only works for text-to-image; skip for image-to-image
- Estimated savings: **2-3s** (if color/style hits cache)

---

## 📍 Key Code Locations

| Component | File | Line(s) | Issue |
|-----------|------|---------|-------|
| Reranking Start | `products.service.ts` | 5365 | Sequential flow begins |
| Attribute Fetching | `products.service.ts` | 5440-5475 | Single mget, but 4 batches tracked |
| Hydration | `products.service.ts` | 5400 | Sequential, no parallelization |
| Hydration Query | `db.ts` | 271-300 | Uses PostgreSQL |
| Reranking Ops | `products.service.ts` | 5600-9276 | Final relevance calculation |
| Logging | `products.service.ts` | 10755-10770 | Where metrics reported |

---

## 🚀 Recommended Immediate Actions

### **Week 1: Quick Wins (5-7s savings)**
1. **Parallelize attr_mget + hydration** → 3s savings
2. **Consolidate 4 batches into 1** → 1.5s savings
3. **Investigate "other" 5.8s** → Find unknown bottleneck

### **Week 2: Medium Effort (1-2s savings)**
1. **Early termination in scoring** → 800ms savings
2. **Lazy hydration** → 500ms savings

### **Week 3: Long-term (2-3s savings)**
1. **Implement Redis cache for attributes** → 2-3s for color/style queries

---

## 🔍 Investigation Checklist

- [ ] Confirm 4 attr_mget batches location (might be in loop)
- [ ] Profile attribute_similarity computation (vectorized?)
- [ ] Check final_relevance calculation (303ms seems high for 486 items)
- [ ] Profile "other" 5.8s unknown time
- [ ] Verify hydration query efficiency (connection pool active?)
- [ ] Check OpenSearch mget response time vs. payload size tradeoff
- [ ] Review CLIP cosine implementation (SIMD enabled?)

---

## Expected Results After Optimization

**Conservative (quick wins only):**
- Baseline: 16.5s → **12-13s** (20-25% reduction)

**Aggressive (all optimizations):**
- Baseline: 16.5s → **7-9s** (45-55% reduction)

**Best case (with caching):**
- Baseline: 16.5s → **4-6s** (70% reduction for color/style queries)
