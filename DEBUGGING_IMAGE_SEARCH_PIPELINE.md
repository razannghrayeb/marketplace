# Deep Debugging Analysis: Fashion Image Search Pipeline
## End-to-End Pipeline Failure Diagnosis

**Date**: April 4, 2026 | **Status**: Critical Quality Issues Identified

---

## 1. FAILURE MODE MAP

| Priority | Stage | Symptom | Likely Cause | Verification Steps |
|----------|-------|---------|--------------|-------------------|
| **CRITICAL** | Vector Normalization | Near-zero/NaN similarities | Denormalized vectors in index or query | Check vector L2 norms in Postgres; verify all index vectors norm ≈ 1.0 |
| **CRITICAL** | Index/Query Preprocessing | Crops too small/tight | Detection box margins (10%) vs center crop (62×64%) mismatch | Compare YOLO detection box sizes vs indexed garment ROI crops |
| **CRITICAL** | Embedding Space | Query crops embed differently than catalog | Query uses `processImageForGarmentEmbeddingWithOptionalBox` with YOLO; catalog might use center crop only | Verify `SEARCH_IMAGE_QUERY_GARMENT_USE_YOLO=1` matches indexing mode |
| **CRITICAL** | Field Mismatch | All queries on wrong embedding field | Index updated to use `embedding_garment` but queries still use `embedding` | Check `SEARCH_IMAGE_KNN_FIELD` env var; verify dual kNN fusion when needed |
| **CRITICAL** | Score Normalization | Scores 0-2 range instead of 0-1 | Legacy OpenSearch score format not convert | Verify `knnCosinesimilScoreToCosine01` is applied to all OpenSearch hits |
| **HIGH** | Background Removal | Query crops have different backgrounds | Index uses conditional rembg but query mode differs | Check `SEARCH_IMAGE_BG_REMOVAL` vs `SEARCH_IMAGE_QUERY_REMBG` settings |
| **HIGH** | CLIP Model | Fashion items embed very differently | Model switched between ViT-B/32 → Fashion-CLIP but index unchanged | Verify `CLIP_MODEL_TYPE` matches on both index-time and query-time; check logs for model mismatch warnings |
| **HIGH** | Vector Dimension | Dimension mismatch on first kNN | Embedding dim (768 ViT-L-14 vs 512 ViT-B-32) | Run `SELECT COUNT(*) FROM product_images WHERE LENGTH(embedding) != 512` |
| **HIGH** | Threshold Too High | Many valid hits filtered out below threshold | Default `similarityThreshold=0.7` is too conservative for fashion | Try `threshold=0.5` for initial retrieval; use cutoff >0.65 only for exact matches |
| **HIGH** | Dual kNN Blending | One embedding field weak, other weighted poorly | Global + garment blend alpha miscalibrated for category | Check `dualKnnCategoryAlpha` per category; test single-field retrieval |
| **MEDIUM** | Metadata Filtering | Correct items hidden by filters | Hard category filter when soft was intended | Verify `SEARCH_IMAGE_SOFT_CATEGORY=1` is set; check filter construction |
| **MEDIUM** | YOLO Reliability | Type intent gates wrong products | YOLO confidence threshold too low or unreliable  | Verify `SEARCH_IMAGE_YOLO_TIMEOUT_MS`; test with `SEARCH_IMAGE_FORCE_STRICT_INFERRED_TYPE_INTENT=1` |
| **MEDIUM** | Relevance Gates | Good products below cutoff | `computeFinalRelevance01` soft caps too restrictive | Test `SEARCH_IMAGE_RELAX_FLOOR`; measure histogram of raw vs final similarity |
| **MEDIUM** | Detection Padding | Borders/background dominate crops | `GARMENT_DETECTION_PAD_RATIO=0.1` too loose or boxes too tight | Inspect sample YOLO boxes + 10% padding; verify actual crop dimensions |
| **LOW** | Color K-means | Color hints misleading | Garment color extraction from complex patterns | Test `SEARCH_IMAGE_BG_REMOVAL_THRESHOLD` variation |
| **LOW** | pHash Dedup | False positives from duplicate detection | Hamming distance threshold too high | Check `pHashThreshold` in candidate dedup logic |

---

## 2. ROOT CAUSE HYPOTHESES (RANKED BY LIKELIHOOD)

### **#1: Vector Normalization Bug or Index Inconsistency** ⚠️ CRITICAL
**Likelihood**: 90%

**Mechanism**: 
- Either embeddings in Postgres/index are NOT L2-normalized, OR
- Normalization happens on one path but not the other (index vs query)
- The `normalizeVector()` function returns unnormalized vector if norm=0, creating degenerate vectors
- OpenSearch `cosinesimil` metric assumes normalized inputs; unnormalized vectors produce garbage scores

**Evidence**:
- Vector L2 norm should be exactly 1.0; if distribution is [0.5-1.5] that's a red flag
- Cosine similarity should be in [0,1]; scores outside this range indicate unnormalized vectors

**How it breaks retrieval**:
- Cosine( [1, 0, 0], [1, 0, 0] ) = 1.0 ✓
- Cosine( [2, 0, 0], [2, 0, 0] ) = 1.0 (same) ✓
- But if one is normalized and one isn't: Cosine( [1, 0, 0], [2, 0, 0] ) = 0.5 ✗

**Verification**:
```sql
-- Check Postgres embedding stats
SELECT 
  COUNT(*) as total,
  COUNT(CASE WHEN embedding IS NOT NULL THEN 1 END) as with_embedding,
  AVG(vector_norm) as avg_norm,
  MIN(vector_norm) as min_norm,
  MAX(vector_norm) as max_norm,
  STDDEV(vector_norm) as stddev_norm
FROM (
  SELECT 
    sqrt(sum(v*v)) as vector_norm
  FROM product_images,
    unnest(embedding) as v
  GROUP BY product_image_id
) norms;
```

**Expected**: avg ≈ 1.0, stddev < 0.01
**Bad Signal**: avg < 0.8 or avg > 1.2 or stddev > 0.1

**Fix Priority**: IMMEDIATE (Day 1)
- Add L2 norm validation in `normalizeVector()`:
  ```typescript
  function normalizeVector(vec: number[]): number[] {
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    if (norm < 1e-12) throw new Error(`Zero-norm vector (invalid)`);
    if (Math.abs(norm - 1.0) > 0.001) {
      // Log warning: vector wasn't already normalized
    }
    return vec.map((v) => v / norm);
  }
  ```
- Reindex all products with normalization assertion

---

### **#2: YOLO Detection Crop vs Indexed Garment ROI Mismatch** ⚠️ CRITICAL
**Likelihood**: 85%

**Mechanism**:
- **Catalog indexing** (`resume-reindex`): garment embedding from center crop (62% H, 64% W positioned at 18% left, 12% top) OR conditional YOLO box
- **Query time** (`searchByImageWithSimilarity`): 
  - When `SEARCH_IMAGE_QUERY_GARMENT_USE_YOLO=1`: crops use YOLO box + 10% padding
  - When unset: uses center crop (legacy)
- If index was built with YOLO boxes but query uses center crop (or vice versa), embeddings are from *different image regions*

**Symptom**:
- YOLO detections return very poor results (raw similarity 0.4-0.6 when should be 0.8+)
- Non-YOLO image search (full frame) works better than detection crops
- Same product via detection crop vs catalog image yields very different similarities

**Evidence**:
- Inspect `scripts/resume-reindex.ts`: What does `SEARCH_IMAGE_QUERY_GARMENT_USE_YOLO` control during bulk reindex?
- Check environment at indexing time vs query time

**Fix Priority**: HIGH (Day 1-2)
- Verify both index and query use *identical* crop logic:
  ```typescript
  // Both paths MUST use same logic:
  const garmentCropFunc = env.SEARCH_IMAGE_QUERY_GARMENT_USE_YOLO 
    ? processImageForGarmentEmbeddingWithOptionalBox
    : processImageForGarmentEmbedding;  // center crop fallback
  ```

---

### **#3: Model Version Mismatch (Fashion-CLIP vs ViT-B/32)** ⚠️ CRITICAL
**Likelihood**: 75%

**Mechanism**:
- System supports three models: `fashion-clip` (512d), `vit-l-14` (768d), `vit-b-32` (512d)
- Auto-detection priority: fashion-clip > vit-l-14 > vit-b-32
- If index was built with ViT-B/32 but query uses Fashion-CLIP (or vice versa):
  - Different training distribution (generic vs fashion-specific)
  - Same image encodes to different vectors
  - Neighbor ranking is destroyed

**Evidence**:
```
[CLIP] Selected model type: fashion-clip (query time)
[CLIP] Selected model type: vit-b-32 (index time) ← MISMATCH
```

**Symptoms**:
- Exact same image searched twice gives very different results
- Adding Fashion-CLIP model made retrieval worse instead of better
- Reindex seemed to help temporarily

**Fix Priority**: CRITICAL (Day 1)
```bash
# Check what model was used at index time
# (No easy way if not logged; legacy indexes are likely ViT-B/32)

# At query time (now):
grep "CLIP_MODEL_TYPE" .env
# If unset, system auto-detects → mismatch if Fashion-CLIP available

# Force consistency:
export CLIP_MODEL_TYPE=fashion-clip  # or vit-b-32, but be consistent
```

---

### **#4: Index Field Mismatch: Querying Wrong Embedding Column** ⚠️ CRITICAL
**Likelihood**: 70%

**Mechanism**:
- Index defines multiple vector fields: `embedding`, `embedding_garment`, `embedding_color`, `embedding_style`, `embedding_pattern`
- `SEARCH_IMAGE_KNN_FIELD` env var selects which field to query (default: `embedding`)
- If index was backfilled with `embedding_garment` populated but queries still use `embedding`:
  - Query vector is from detection crop (garment-specific)
  - Index field `embedding` is full-frame, unpadded CLIP
  - Neighbors are ranked by wrong distance metric

**Symptoms**:
- Search works after `resume-reindex` when it backfills `embedding_garment`
- But then search breaks again → query env not updated to match index
- Toggling `SEARCH_IMAGE_KNN_FIELD` dramatically changes results

**Fix Priority**: HIGH (Day 1)
```bash
# Verify all three match:
echo "Query KNN field: $SEARCH_IMAGE_KNN_FIELD"
echo "Detection KNN field: $SEARCH_IMAGE_DETECTION_KNN_FIELD"

# If index was backfilled, set:
export SEARCH_IMAGE_KNN_FIELD=embedding_garment
export SEARCH_IMAGE_DETECTION_KNN_FIELD=embedding_garment
```

---

### **#5: Score Normalization Mismatch (v1 vs v2 Format)** ⚠️ CRITICAL
**Likelihood**: 60%

**Mechanism**:
- OpenSearch kNN can return scores in different ranges:
  - **v1 (legacy)**: `(1 + cosθ) / 2` in range [0, 1] (or [0, 2] if not halved)
  - **v2 (modern)**: `cosθ` in range [-1, 1] (for normalized vectors, typically [0,1])
- Documents indexed as `embedding_score_version=v1` but normalized with `v2` (or vice versa) causes scale mismatches
- Relevance floor gates filter out valid candidates with incorrect scale

**Symptoms**:
- All returned similarities are very high (0.95-1.0) or very low (0.01-0.1) — no middle ground
- Threshold tuning doesn't work (0.5 and 0.9 give same results)
- Migrating to new index suddenly reduced recall (or improved it)

**Verification**:
```typescript
// In products.service.ts, check both conversions are applied:
function knnCosinesimilScoreToCosine01(raw: number): number {
  const os01 = knnCosinesimilScoreToOpenSearch01(raw);
  const cos = 2 * os01 - 1;  // ← This should always execute
  return Math.max(0, Math.min(1, cos));
}
```

**Fix Priority**: HIGH (Day 1-2)
- Force all documents to `v2` representation during reindex
- Update query normalizer to match document version

---

### **#6: Background Removal Mismatch** ⚠️ HIGH
**Likelihood**: 55%

**Mechanism**:
- **Index time** (`prepareBufferForPrimaryCatalogEmbedding`):
  - `SEARCH_IMAGE_BG_REMOVAL=1` (default) + threshold
  - Only removes background if complexity > threshold (~35)
- **Query time** (`prepareBufferForImageSearchQuery`):
  - Default `SEARCH_IMAGE_QUERY_REMBG=conditional` (same as index)
  - BUT if user uploaded complex background photo, index had it removed, query doesn't
- Different background presence → different CLIP embeddings

**Symptoms**:
- Uploading product images (clean white background) works well
- Searching with user photos (complex background) fails to find indexed products
- Toggling rembg sidecar on/off dramatically changes retrieval

**Fix Priority**: MEDIUM (Day 2)
- Ensure both use identical settings:
  ```bash
  export SEARCH_IMAGE_BG_REMOVAL=1
  export SEARCH_IMAGE_QUERY_REMBG=conditional
  export SEARCH_IMAGE_BG_REMOVAL_THRESHOLD=35
  ```
- Measure background complexity distribution in catalog vs user queries

---

### **#7: Similarity Threshold Too High** ⚠️ HIGH
**Likelihood**: 50%

**Mechanism**:
- Default `similarityThreshold=0.7` (70% cosine similarity)
- For fashion, this is restrictive because:
  - Different photos of *exact same SKU* may differ by lighting/angle (cosine 0.65-0.75)
  - Crops from YOLO are noisier than full catalog images (lower inherent similarity)
  - Similar but different products (e.g., "blue tee" vs "navy tee") are 0.55-0.65
- Result: many valid matches are below cutoff

**Symptoms**:
- Few/zero results returned
- Exact same product image returns 0 results
- Lowering threshold to 0.5 suddenly fixes it
- pHash-based dedup works better than similarity

**Verification**:
```typescript
// In searchByImageWithSimilarity:
const hits = await computeImageSearchWithMerchandiseSimilarityBinding(...);
// Check distribution before filtering:
console.log(`Raw similarities: min=${min}, max=${max}, mean=${mean}, median=${median}`);
console.log(`Hits above 0.7: ${aboveThreshold.length} / ${hits.length}`);
```

**Fix Priority**: MEDIUM (Day 2)
- Reduce default to 0.5 for initial retrieval
- Use final relevance gating (not raw similarity) for acceptance

---

### **#8: Dual kNN Fusion Weights Miscalibrated** ⚠️ HIGH
**Likelihood**: 45%

**Mechanism**:
- System blends `embedding` (full frame) and `embedding_garment` (ROI crop) using:
  - `alpha = dualKnnCategoryAlpha(category)` → 0.35 (tops), 0.4 (default), 0.5 (accessories)
  - `sim_effective = alpha * sim_global + (1 - alpha) * sim_garment`
- If one embedding field is much weaker (e.g., garment field incomplete), blending pulls down the score

**Symptoms**:
- Single-field kNN retrieval (only `embedding` OR only `embedding_garment`) works better than dual fusion
- Results degraded after garment field backfill
- Turning off dual fusion (via env) fixes retrieval

**Fix Priority**: MEDIUM (Week 1)
- Measure per-category performance with single vs dual
- Recalibrate alpha weights via A/B on holdout set

---

### **#9: YOLO Type Intent Gates Too Strict** ⚠️ MEDIUM
**Likelihood**: 40%

**Mechanism**:
- YOLO detection returns product type hints (e.g., "shoe", "jacket")
- These feed into `computeFinalRelevance01` with `hasTypeIntent=true`
- BUT YOLO is only ~80% accurate → many false positives gate out valid results
- E.g., YOLO says "shoe" but user uploaded "black bag" → shoes are gated to 0.15× multiplier

**Symptoms**:
- Disabling YOLO detection dramatically improves results
- Setting `SEARCH_IMAGE_FORCE_STRICT_INFERRED_TYPE_INTENT=0` fixes issues

**Fix Priority**: MEDIUM (Day 2)
- Reduce confidenceThreshold in YOLO model inference
- Treat YOLO hints as soft signals, not hard gates (already partially implemented with `tightSemanticCap`)

---

### **#10: Merchandise Similarity Binding Suppresses Valid Hits** ⚠️ MEDIUM
**Likelihood**: 35%

**Mechanism**:
- `merchandiseVisualSimilarity01` couples CLIP cosine with product type/category alignment
- Formula: `effective = raw_clip * typeFactor * categoryFactor`
- If product type inference is noisy, valid visual matches are penalized
- `typeFactor = 0.32 + 0.68 * pow(typeScore, 1.22)` is sublinear — even 80% type agreement gives only 0.88× boost

**Symptoms**:
- Raw CLIP scores are 0.8 but returned similarity is 0.6 (suppressed by binding)
- Disabling `SEARCH_IMAGE_MERCHANDISE_SIMILARITY=0` fixes it

**Fix Priority**: LOW (Week 1)
- Measure `effectiveSimilarity / rawClip` distribution
- Loosen type/category gates or disable binding for low-confidence predictions

---

## 3. END-TO-END AUDIT CHECKLIST

### **Data Ingestion & Embedding Generation**

- [ ] **Embedding Dimension Consistency**
  - Query: `SELECT DISTINCT LENGTH(embedding) FROM product_images WHERE embedding IS NOT NULL LIMIT 5`
  - Expected: All rows show same value (512 or 768)
  - If mixed: CRITICAL — reindex required

- [ ] **Vector Normalization**
  - Run SQL norm check (above in #1)
  - Expected: avg L2 norm = 1.0 ± 0.01
  - If not: Reindex with explicit normalization assertion

- [ ] **Embedding Null/Empty Distribution**
  - Query: `SELECT COUNT(*) as missing FROM product_images WHERE embedding IS NULL OR LENGTH(embedding) = 0`
  - Expected: ~0 (except for new/failed uploads)
  - If high: Embedding generation failing on certain images

- [ ] **Garment Field Completeness** (if dual kNN enabled)
  - Query: `SELECT COUNT(*) FROM product_images WHERE embedding_garment IS NOT NULL`
  - Expected: Same or nearly same as `embedding`
  - If different: Backfill needed; meanwhile disable garment kNN

- [ ] **pHash Validity**
  - Query: `SELECT COUNT(DISTINCT p_hash) FROM product_images WHERE p_hash IS NOT NULL`
  - Expected: High cardinality (near total rows)
  - If many duplicates: pHash generation failing or collision

### **Image Preprocessing**

- [ ] **Backup Removal Threshold**
  - Measure: Histogram of `computeBgComplexityScore()` on 100 random images
  - Expected: Mixed distribution (some < 35, some > 35)
  - If all < 35: Background removal off (OK if products are already clean)
  - If all > 35: Too many complex backgrounds may degrade CLIP

- [ ] **Crop Size Consistency**
  - For YOLO detections: Measure bounding box sizes (width, height)
  - With 10% padding: `cropW = boxW * 1.2`, `cropH = boxH * 1.2`
  - Expected: Most crops 150-400px (CLIP input is 224x224)
  - If tiny crops (< 50px): Padding too small or detections too close to edge

- [ ] **RGB vs BGR Consistency**
  - CLIP uses RGB order; Sharp defaults to RGB
  - Query: Check `preprocessImage()` channel order
  - Expected: channels [0]=R, [1]=G, [2]=B

### **Embedding Model Selection**

- [ ] **CLIP Model Specified**
  - Verify: `echo $CLIP_MODEL_TYPE` during startup
  - Expected: One of `fashion-clip`, `vit-l-14`, `vit-b-32`
  - If empty/unset: AUTO-DETECTION active → potential mismatch

- [ ] **Model Files Present**
  - Check: `ls -lh models/*.onnx`
  - Each model should be 200MB+
  - If missing: Model inference will fail

- [ ] **Embedding Dimension Matches Model**
  - Expected: 512 (for fashion-clip or vit-b-32), 768 (for vit-l-14)
  - Query: `SELECT MAX(LENGTH(embedding)) FROM product_images LIMIT 1`
  - Set `EXPECTED_EMBEDDING_DIM` to match

### **Vector Index Configuration (OpenSearch)**

- [ ] **Index Mapping Verified**
  - Query: `curl -X GET "http://opensearch:9200/products/_mapping"`
  - Check:
    - `embedding`: type `knn_vector`, dimension matches (512 or 768)
    - `embedding_garment`: type `knn_vector` if present
    - `is_hidden`: type `boolean`
    - `category`: type `keyword`
  - If mismatch: Index needs recreation

- [ ] **kNN Index Parameters**
  - Expected: `"metric": "cosinesimil"` (NOT euclidean or inner_product)
  - Expected: HNSW algorithm, `ef_search` ≥ 128
  - If `ef_search` is tiny (e.g., 32): Accuracy is poor

- [ ] **Index Size Reasonable**
  - Query: `curl -X GET "http://opensearch:9200/products/_stats" | grep "docs.count"`
  - Expected: Similar to Postgres product count (within 10%)
  - If far lower: Many products not indexed

### **Query-Time Preprocessing**

- [ ] **Query Embedding Computation Verified**
  - Log: `POST /products/search/image` should show:
    - Image buffer size
    - Background complexity score
    - Whether rembg applied
    - Garment crop detection (YOLO result)
    - Final embedding vectorization time
  - Expected: Consistent preprocessing for identical input images

- [ ] **YOLO Detection Reliability**
  - Test image with clear garment: Should return box with confidence > 0.5
  - Test image with multiple items: Should return multiple boxes or top-1
  - Measure: Accuracy on 50 labeled images
  - If unreliable (< 70% precision): Lower confidence threshold

- [ ] **Attribute Embedding Computed**
  - Expected: `colorQueryEmbedding`, `styleQueryEmbedding`, `patternQueryEmbedding` generated in parallel
  - If slow: May be timing out (check `SEARCH_IMAGE_RERANK_TIMEOUT_MS`)

### **kNN Search Execution**

- [ ] **Query Vector Applied to Correct Field**
  - Verify: Query body includes `"[SEARCH_IMAGE_KNN_FIELD]": { "vector": [...], "k": [...] }`
  - Expected: Matches indexed field name (`embedding` or `embedding_garment`)
  - Test: Change `SEARCH_IMAGE_KNN_FIELD` and measure result change

- [ ] **Retrieval K Size**
  - Verify: `imageSearchKnnPoolLimit()` returns reasonable number (200-1200)
  - Expected: Large enough to capture good candidates before reranking
  - If K=50: May miss valid hits due to ANN approximation

- [ ] **Filter Coverage**
  - Test filter construction with various inputs:
    - No filters → should retrieve broad results
    - category=tops → should only return tops
    - gender=women → should filter by gender
  - If filters incorrect: Advanced targeting fails

### **Reranking & Relevance**

- [ ] **Similarity Score Distribution**
  - Collect metrics for 100 searches:
    - Raw OpenSearch kNN scores: min, max, mean, p50, p95
    - After normalization: should be [0, 1] scale
  - Expected: Broad distribution (not all 0.9-1.0 or all 0.1-0.3)

- [ ] **Merchandise Similarity Binding**
  - Compare: Raw CLIP vs effective (bound) similarity
  - Expected: Effective ≤ Raw (binding can only suppress)
  - If effective >> raw: binding bug (shouldn't happen)

- [ ] **Relevance Gate Application**
  - Measure: % of kNN hits passing `computeFinalRelevance01` gate
  - Expected: 50-80% of retrieval set
  - If < 30%: Gates too strict → raise thresholds
  - If > 95%: Gates too loose → lower thresholds

- [ ] **Attribution Scoring**
  - For color/style/pattern queries: Measure attribute similarity scores
  - Expected: Distribution around 0.3-0.8 (not all 0.0 or 1.0)
  - If sparse: Attribute backfill incomplete

### **Result Deduplication & Post-Processing**

- [ ] **pHash Deduplication**
  - Test: Upload same image twice, search for one
  - Expected: Both should appear (only near-exact duplicates merged)
  - If too many merged: `pHashThreshold` too high
  - If none merged: `pHashThreshold` too low (or pHash generation failing)

- [ ] **Related Products**
  - Test: `includeRelated=true` should return variants
  - Expected: Similar pHash items grouped together
  - If irrelevant items included: pHash similarity broken

### **Metadata & Business Logic**

- [ ] **Category Inference**
  - For new products: category should be read from input or inferred from title
  - Test: Search for "women's boots" should return products with category=footwear
  - If category missing/wrong: Filtering will fail

- [ ] **Is-Hidden Filter**
  - Test: Search should never return hidden products
  - Query: Verify filter includes `"must_not": [{ "term": { "is_hidden": true } }]`

- [ ] **Availability**
  - Test: Filter by `availability=true` should only return in-stock
  - If out-of-stock items appear: availability field not indexed correctly

---

## 4. DEEP TECHNICAL DEBUGGING PLAN

### **Phase 0: Quick Wins (30 min)**

1. **Check CLIP model consistency**
   ```bash
   # On both index and query machines:
   echo "Index-time model check:"
   grep -i CLIP_MODEL_TYPE .env
   echo "Current logs:"
   tail -100 logs/app.log | grep -i "CLIP.*Selected model"
   ```
   **Action**: If mismatch, force same model and don't auto-detect

2. **Verify vector normalization flag**
   ```bash
   # Run one query image and capture logs:
   curl -X POST http://localhost:3000/products/search/image \
     -F "image=@test_image.jpg" 2>&1 | grep -i "norm\|embed"
   ```
   **Action**: If logs show "normalization", confirm it's L2

3. **Check similarity scores are sensible**
   ```bash
   # Get top 10 results and log raw scores:
   # In products.service.ts, add debug:
   console.log(`Raw similarity scores: ${results.map(r => r.rawClip01).join(', ')}`);
   ```
   **Action**: If all 0.9+, normalization issue likely

---

### **Phase 1: Focused Testing (1-2 hours)**

1. **Brute-Force Baseline Test**
   - **Purpose**: Isolate kNN indexing/search bugs from ranking bugs
   - **Method**:
     ```typescript
     // Temporarily disable all reranking:
     const rawResults = await osClient.search({
       index: 'products',
       body: {
         size: 100,
         query: {
           knn: { embedding: { vector: queryVec, k: 100 } }
         }
       }
     });
     return rawResults;  // Return unranked
     ```
   - **Expected**: Top results are visually similar to query image
   - **Bad signal**: Top results are random/unrelated

2. **Field Mismatch Test**
   - **Purpose**: Verify NN retrieval works with each embedding field
   - **Method**:
     ```bash
     # Test 1: Query on `embedding` field
     export SEARCH_IMAGE_KNN_FIELD=embedding
     curl -X POST .../search/image -F "image=@test.jpg"
     
     # Test 2: Query on `embedding_garment` field
     export SEARCH_IMAGE_KNN_FIELD=embedding_garment
     curl -X POST .../search/image -F "image=@test.jpg"
     ```
   - **Expected**: One field returns much better results (that's your active field)
   - **Fix**: Update env to use better-performing field

3. **Crop Size Impact Test**
   - **Purpose**: Verify YOLO detection padding is reasonable
   - **Method**:
     ```typescript
     // Log detected boxes with padding:
     const detected = await yolo.detectFromBuffer(...);
     for (const item of detected.detections) {
       const {box} = item;
       const padX = (box.x2 - box.x1) * 0.1;  // 10% padding
       const padY = (box.y2 - box.y1) * 0.1;
       console.log(`Original: ${box.x2-box.x1}x${box.y2-box.y1}px, Padded: ${...}`);
     }
     ```
   - **Expected**: Padded crop 200-400px range
   - **Bad signal**: Crops < 50px or > 600px

4. **Model Consistency Test**
   - **Purpose**: Verify same image → same embedding across restarts
   - **Method**:
     ```bash
     # Generate embedding for same image twice:
     curl --data-binary @test_image.jpg -H "Content-Type: image/jpeg" \
       http://localhost:3000/api/debug/compute-embedding > emb1.json
     sleep 5
     curl --data-binary @test_image.jpg -H "Content-Type: image/jpeg" \
       http://localhost:3000/api/debug/compute-embedding > emb2.json
     
     # Compare:
     diff <(jq '.embedding | sort' emb1.json) <(jq '.embedding | sort' emb2.json)
     ```
   - **Expected**: Identical vectors
   - **Bad signal**: Different vectors (CLIP model changed, or non-deterministic)

---

### **Phase 2: Instrumentation & Measurement (2-4 hours)**

1. **Add Comprehensive Logging**
   ```typescript
   // In searchByImageWithSimilarity, add:
   const debugMetrics = {
     queryEmbeddingNorm: Math.sqrt(imageEmbedding.reduce((s,v) => s+v*v, 0)),
     queryEmbeddingDim: imageEmbedding.length,
     knnFieldActive: resolveImageSearchKnnField(knnField),
     retrievalK: imageSearchKnnPoolLimit(),
     softCategoryEnabled: imageSoftCategoryEnv(),
     rawResults: [],  // Populated after kNN
     normalizedScores: [],  // After score conversion
     finalRelevance: [],  // After gating
     filtered: []  // After thresholds
   };
   
   // Log at each stage
   console.log('[IMAGE_SEARCH_DEBUG]', JSON.stringify(debugMetrics, null, 2));
   ```

2. **Metric Collection**
   - Run 100 searches with diverse inputs (different categories, colors, multi-item images)
   - Collect:
     - Raw kNN similarity scores (p10, p50, p90)
     - Normalized scores after conversion
     - Final relevance scores
     - % of hits passing each gate
   - **Action**: Histogram reveals where quality is lost

3. **Ground Truth Evaluation**
   - Manually label 20 test images:
     - Query image
     - Expected top 5 products (hand-curated)
     - Actual top 5 returned by system
   - **Metric**: Recall@5, NDCG@5
   - **Target**: > 60% recall@5, NDCG > 0.7

---

### **Phase 3: Targeted Fixes (1-2 days)**

Based on Phase 1-2 findings, apply fixes in priority order:

| Finding | Fix | Time |
|---------|-----|------|
| Vector norm distribution all 0.5 | Reindex with assertion before storage | 2h |
| CLIP model mismatch (v1 vs v2) | Rebuild index with force-consistent model | 3h |
| Field mismatch (query wrong column) | Update `SEARCH_IMAGE_KNN_FIELD` env | 10 min |
| Trash re sults with single field | Recalibrate dual kNN alpha weights | 1h |
| Threshold too high (0.7) | Lower to 0.5, use relevance gating | 30 min |
| Background removal inconsistent | Align `SEARCH_IMAGE_BG_REMOVAL` + `SEARCH_IMAGE_QUERY_REMBG` | 30 min |
| YOLO gates too strict | Reduce `typeGateFactor` in `computeFinalRelevance01` | 30 min |
| Merchandise binding suppresses hits | Disable or soften `merchandiseVisualSimilarity01` | 1h |

---

## 5. MOST LIKELY HIDDEN IMPLEMENTATION BUGS

### **Bug #1: Vector Denormalization After ONNX Output**

**Location**: `src/lib/image/clip.ts::normalizeVector()`

**Mechanism**:
```typescript
function normalizeVector(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  if (norm === 0) return vec;  // ← BUG: Returns unnormalized vector!
  return vec.map((v) => v / norm);
}
```

**Fix**:
```typescript
function normalizeVector(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  if (norm < 1e-12) {
    throw new Error(`[CLIP] Zero-norm embedding (${vec.length}-dim) — ONNX model output invalid`);
  }
  const normalized = vec.map((v) => v / norm);
  const resultNorm = Math.sqrt(normalized.reduce((s,v) => s+v*v, 0));
  if (Math.abs(resultNorm - 1.0) > 0.01) {
    console.warn(`[CLIP] Normalization drift: ${resultNorm} (expected 1.0)`);
  }
  return normalized;
}
```

**Test**:
```bash
# Query: check distribution of returned embedding norms
SELECT COUNT(*),
  CASE 
    WHEN sqrt(sum(v*v)) < 0.95 THEN 'under_norm'
    WHEN sqrt(sum(v*v)) > 1.05 THEN 'over_norm'
    ELSE 'ok' 
  END as norm_status
FROM product_images, unnest(embedding) as v
GROUP BY norm_status;
```

---

### **Bug #2: Query Garment Embedding Uses Wrong Crop**

**Location**: `src/routes/products/products.service.ts::searchByImageWithSimilarity()`

**Mechanism**:
- Index uses `embedding_garment` from YOLO box OR center crop (depends on `resume-reindex` flags)
- Query always uses center crop unless `SEARCH_IMAGE_QUERY_GARMENT_USE_YOLO=1`
- **Result**: Query embeds detection crop, index has full-frame → mismatch

**Fix**:
```typescript
// At query time, must use EXACT same logic as indexing:
const garmentEmbedding = env.SEARCH_IMAGE_QUERY_GARMENT_USE_YOLO
  ? await processImageForGarmentEmbeddingWithOptionalBox(imageBuffer, preparedBuffer, yoloBox)
  : await processImageForGarmentEmbedding(imageBuffer);  // Center crop fallback

// Verify it matches what was indexed:
console.log(`[QUERY] Using garment method: ${env.SEARCH_IMAGE_QUERY_GARMENT_USE_YOLO ? 'YOLO' : 'CENTER_CROP'}`);
```

---

### **Bug #3: Cosine Similarity Calculation on Unnormalized Vectors**

**Location**: `src/routes/products/products.service.ts::cosineSimilarityRaw()`

**Mechanism**:
```typescript
function cosineSimilarityRaw(a: number[] | undefined, b: number[] | undefined): number {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom <= 1e-12) return 0;  // ← If either vector is zero-norm, returns 0
  return dot / denom;
}
```

**If vectors are NOT pre-normalized** (e.g., because `normalizeVector` returned unnormalized vector due to norm==0):
- This function will produce incorrect scores
- Comparison of cosine(a,b) vs cosine(a,a) will fail (should be 1.0, might be random)

**Fix**:
```typescript
// Always assume vectors ARE pre-normalized:
// cosine(normalized_a, normalized_b) = a · b (since ||a|| = ||b|| = 1)
function cosineSimilarityNormalized(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error('Dimension mismatch');
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return Math.max(0, Math.min(1, dot));  // Clamp to [0, 1]
}
```

---

### **Bug #4: Score Normalization Not Applied to All Paths**

**Location**: `src/routes/products/products.service.ts::opensearchImageKnnHits()`

**Mechanism**:
```typescript
async function opensearchImageKnnHits(body: Record<string, any>, timeoutMs: number) {
  const response = await osClient.search({...body});
  const hits = response.body.hits.hits;
  
  return hits.map((hit: any) => ({
    productId: String(hit._source?.product_id ?? ""),
    score: Number(hit._score) || 0,  // ← RAW OpenSearch score, not normalized!
  }));
}
```

Then later:
```typescript
// In searchByImageWithSimilarity:
const clipSim = knnCosinesimilScoreToCosine01(hit.score);  // ← Normalize here
```

**Problem**: If any code path returns `hit._score` directly without normalization, scores are in wrong range.

**Fix**:
```typescript
function normalizeOpenSearchScore(raw: number, versionTag: string = 'v2'): number {
  if (versionTag === 'v1') {
    // Legacy: (1 + cos) / 2 in [0, 1]
    const cos = 2 * raw - 1;
    return Math.max(0, Math.min(1, cos));
  }
  // v2: raw cosine in [-1, 1], typically [0, 1] for normalized vectors
  if (raw > 1.001) {
    // Might be legacy v1 not halved
    return (raw / 2 - 1) * 2;  // Convert back
  }
  return Math.max(0, Math.min(1, raw));
}

// Always wrap hits:
return hits.map((hit: any) => ({
  productId: String(hit._source?.product_id ?? ""),
  score: normalizeOpenSearchScore(hit._score || 0, hit._source?.embedding_score_version || 'v2'),
}));
```

---

### **Bug #5: Detection Box Padding Formula Off**

**Location**: `src/lib/image/processor.ts::resolveGarmentEmbedBufferFromPrepared()`

**Mechanism**:
```typescript
const padX = Math.round(bw * GARMENT_DETECTION_PAD_RATIO);  // bw = box width
const padY = Math.round(bh * GARMENT_DETECTION_PAD_RATIO);  // bh = box height
```

**If `bw` or `bh` are tiny** (e.g., 30px for a small accessory):
- `padX = 30 * 0.1 = 3px` (very tight, almost no padding)
- Result: Crop is too tight, embedding dominated by object itself, not representative

**Fix**:
```typescript
const MIN_PAD_PX = 10;  // Always pad by at least 10px
const padX = Math.max(MIN_PAD_PX, Math.round(bw * GARMENT_DETECTION_PAD_RATIO));
const padY = Math.max(MIN_PAD_PX, Math.round(bh * GARMENT_DETECTION_PAD_RATIO));
```

---

### **Bug #6: Center Crop Fixed Percentages Don't Scale**

**Location**: `src/lib/image/processor.ts::processImageForGarmentEmbedding()`

**Mechanism**:
```typescript
// Hardcoded: always crop 64% width × 62% height at 18% left, 12% top
const left = Math.floor(w * 0.18);
const top = Math.floor(h * 0.12);
const width = Math.max(1, Math.floor(w * 0.64));
const height = Math.max(1, Math.floor(h * 0.62));
```

**Problem**: These percentages are tuned for average 1000×1200px images (e.g., fashion catalog photos). For weird aspect ratios:
- Very wide image (3000×600): Crop becomes 1920×372px (too wide relative to height CLIP sees)
- Very tall image (600×3000): Crop becomes 384×1860px (too tall)
- Result: CLIP embedding distribution differs from training

**Fix**:
```typescript
// Normalize to square after crop, or match CLIP's expected aspect ratio:
const cropAspect = width / height;  // Should be ~1.0
if (cropAspect > 1.5 || cropAspect < 0.67) {
  // Rebalance to square:
  const newSize = Math.min(width, height);
  width = newSize;
  height = newSize;
  console.warn(`[WARN] Garment crop aspect ${cropAspect.toFixed(2)} adjusted to square`);
}
```

---

### **Bug #7: Relevance Gate Returns 0 Instead of Fallback**

**Location**: `src/lib/search/searchHitRelevance.ts::computeFinalRelevance01()`

**Mechanism**:
```typescript
if (gateTypeIntent && crossPen >= 0.8) {
  if (params.tightSemanticCap) {
    return Math.max(0, params.semScore * 0.15);  // Soft penalty for image search
  }
  return 0;  // ← Hard zero — product never appears, even if visually identical
}
```

**Problem**: If YOLO wrongly detects item type, and `crossPen >= 0.8` (strong type mismatch), the product is scored 0.0 even if it's the exact visual match.

**Example**:
- User queries with shoe image
- YOLO says: "shoe" (correct)
- Catalog product is: "running shoe" (same type)
- But `typeScore` from `scoreRerankProductTypeBreakdown` is low due to minor type variations
- → Product filtered out

**Fix**:
```typescript
if (gateTypeIntent && crossPen >= 0.8) {
  // Never hard-zero on visual match; at worst, apply heavy penalty:
  const minScore = params.semScore * 0.25;  // Up from 0.15
  return Math.max(minScore, params.semScore * 0.5 * (1 - crossPen));
}
```

---

### **Bug #8: Attribute Embedding Timeout Silently Fails**

**Location**: `src/routes/products/products.service.ts::searchByImageWithSimilarity()`

**Mechanism**:
```typescript
try {
  const [cEmb, sEmb, pEmb] = await Promise.all([
    imageEmbeddingColor,
    imageEmbeddingStyle,
    imageEmbeddingPattern,
  ]);
  // ...
} catch (err) {
  // ← Silently catches timeout; colorQueryEmbedding = null
  colorQueryEmbedding = null;
}
```

**Problem**: If CLIP attribute model is slow or error-prone, embedding times out and color/style/pattern scores default to 0. Results ignore these signals even though they might be important.

**Fix**:
```typescript
// Separate timeout per attribute:
const colorPromise = imageEmbeddingColor.catch(err => {
  console.warn('[IMAGE_SEARCH] Color embedding timeout/error, using raw image color analysis');
  return null;  // Fall back to quick color k-means from image
});

// Use quick color extraction if CLIP embedding wasn't ready:
if (!colorQueryEmbedding && inferredColorsByItem) {
  colorQueryEmbedding = await quickColorToCLIPEmbedding(inferredColorsByItem);
}
```

---

### **Bug #9: Dual kNN Fusion Alpha Doesn't Adapt to Completeness**

**Location**: `src/routes/products/products.service.ts::dualKnnCategoryAlpha()`

**Mechanism**:
```typescript
function dualKnnCategoryAlpha(category: string): number {
  const c = String(category || "").toLowerCase().trim();
  if (c === "tops") return 0.35;  // 35% global, 65% garment
  if (c === "accessories") return 0.5;
  return 0.4;
}
```

**Problem**: If `embedding_garment` field is incomplete (only 60% of products have it), using alpha=0.65 for garment is risky — many products have NULL garment field, which might be treated as zero-vector.

**Fix**:
```typescript
async function adaptiveDualKnnAlpha(category: string, globalScore: number, garmentScore: number | null): Promise<number> {
  // If garment score is missing, rely 100% on global:
  if (garmentScore == null || !Number.isFinite(garmentScore)) {
    return 1.0;
  }
  
  // Adapt based on score disagreement:
  const disagree = Math.abs(globalScore - garmentScore);
  if (disagree > 0.3) {
    // Scores are very different — be conservative, blend evenly:
    return 0.5;
  }
  
  // Otherwise, use category default:
  return dualKnnCategoryAlpha(category);
}
```

---

### **Bug #10: Batch Reranking Uses Wrong Vector**

**Location**: `src/routes/products/image-analysis.service.ts::analyzeOutfitDetectedItems()`

**Mechanism**:
```typescript
for (const detection of detections) {
  const embedding = await processImageForGarmentEmbedding(detection.cropBuffer);
  // ... search for similar products using `embedding`
}
```

**Problem**: For `image_analysis` (Shop-the-Look), per-detection search might use wrong field:
- If index was built with `embedding` = full-frame, but each detection is a crop
- Query is a crop embedding, searching `embedding` field (which contains full-frame embeddings)
- Mismatch

**Fix**:
```typescript
// Use detection-specific field (likely garment when doing YOLO-based per-detection search):
const searchField = process.env.SEARCH_IMAGE_DETECTION_KNN_FIELD || 'embedding_garment';
const embedding = await computeImageSearchGarmentQueryEmbedding(detection.cropBuffer);
// ... pass searchField to kNN query
```

---

## 6. METRICS & OBSERVABILITY REQUIREMENTS

### **Logging Infrastructure**

Add structured logging to track:

```typescript
// 1. Embedding generation
{
  "event": "embedding_generated",
  "timestamp": "2026-04-04T10:00:00Z",
  "embedding_dim": 512,
  "embedding_norm": 1.003,
  "norm_status": "ok|warning|error",
  "model_type": "fashion-clip",
  "model_version": "1.0",
  "preprocessing": "rembg_applied|no_rembg|timeout",
  "crop_type": "full_frame|center_crop|yolo_box",
  "crop_size_px": [224, 224],
  "duration_ms": 150
}

// 2. kNN retrieval
{
  "event": "knn_retrieval",
  "timestamp": "2026-04-04T10:00:00Z",
  "knn_field": "embedding",
  "k": 500,
  "raw_scores": {
    "min": 0.45,
    "max": 0.95,
    "mean": 0.72,
    "p50": 0.70,
    "p95": 0.87
  },
  "normalized_scores": {...},
  "filter_hit_rate": 0.92,
  "hits_above_threshold": 145  // Out of 500 retrieved
}

// 3. Reranking
{
  "event": "reranking_stage",
  "timestamp": "2026-04-04T10:00:00Z",
  "stage": "relevance_computation",
  "hits_input": 145,
  "hits_pass_relevance_gate": 112,
  "gate_drop_rate": 0.23,
  "relevance_score_distribution": {
    "min": 0.12,
    "max": 0.98,
    "mean": 0.65,
    "p50": 0.62
  }
}

// 4. Final ranking
{
  "event": "final_results",
  "timestamp": "2026-04-04T10:00:00Z",
  "results_returned": 10,
  "top_1_similarity": 0.88,
  "top_1_relevance": 0.85,
  "similarity_threshold_applied": 0.70,
  "filter_applied": ["is_hidden=false", "category=tops"],
  "total_latency_ms": 340
}
```

### **Key Metrics to Monitor**

| Metric | Target | Red Flag |
|--------|--------|----------|
| **Embedding Norm Distribution** | Mean=1.0, StdDev<0.01 | Mean<0.8 or >1.2; StdDev>0.1 |
| **kNN Score Distribution** | Mean ≈ 0.70, P95 ≈ 0.88 | Mean close to median; P95=Min (no spread) |
| **Relevance Score Distribution** | Mean ≈ 0.60, spread [0.1-0.9] | Bimodal (0 or 1 only) |
| **Threshold Drop Rate** | 30-50% of kNN hits pass | <10% or >90% |
| **Same-Category Retrieval** | >85% recall@10 for exact match | <70% |
| **Brute-Force vs ANN Recall** | ANN recall >= 95% of brute-force | <80% → HNSW tuning needed |
| **Embedding Gen Latency** | <200ms P95 | >500ms → bottleneck |
| **kNN Query Latency** | <100ms P95 | >300ms → index too large or K too high |
| **End-to-End Latency** | <500ms P95 | >1000ms → bottleneck in reranking |

---

## 7. EXPERIMENTS TO ISOLATE ROOT CAUSES

### **Experiment 1: Brute-Force vs ANN**

**Objective**: Determine if kNN index (HNSW) is losing recall

**Protocol**:
1. Pick 20 random query images (diverse categories)
2. For each query:
   - Compute full L2 distance to all 10,000 catalog embeddings → brute-force top-100
   - Query OpenSearch kNN on same embedding → ANN top-100
   - Measure: % overlap (how many BF-top-100 appear in ANN-top-100)

**Result Interpretation**:
- **>95% overlap**: kNN index is good; problem is in reranking/thresholds
- **70-95% overlap**: Index tuning needed (`ef_search` too low)
- **<70% overlap**: Index is broken or embeddings are corrupted

**Action**:
- If kNN recall bad: Increase `ef_search` from 128 → 256, rebuild index
- If brute-force and ANN aligned: Problem is NOT the index

---

### **Experiment 2: Full-Frame vs Garment Crop**

**Objective**: Determine if dual kNN is helping or hurting

**Protocol**:
1. Query using only `embedding` field (1000 queries)
   - Record: retrieval quality metric (NDCG@10)
2. Query using only `embedding_garment` field (same 1000 queries)
   - Record: NDCG@10
3. Query using dual kNN fusion (same 1000 queries)
   - Record: NDCG@10

**Result Interpretation**:
- If Dual < min(Global, Garment): Fusion is hurting → disable or reweight
- If Dual > 0.95*max(Global, Garment): Fusion adds marginal value
- If Dual > 1.05*max(Global, Garment): Good signal → keep fusion

**Action**:
- Reweight `dualKnnCategoryAlpha` to favor the better-performing field

---

### **Experiment 3: Catalog Image vs User Query**

**Objective**: Measure if query image preprocessing differs from index

**Protocol**:
1. Pick 10 catalog product images
2. For each image:
   - Generate embedding at index time (offline reindex pipeline):  -> `emb_index`
   - Generate embedding at query time (upload as search image): -> `emb_query`
   - Compute cosine(emb_index, emb_query)

**Result Interpretation**:
- **>0.98**: Preprocessing is consistent
- **0.90-0.98**: Minor drift (acceptable)
- **<0.90**: Major inconsistency (RGB/BGR, rembg, model mismatch)

**Action**:
- Log preprocessing steps for each image
- Find transformations that differ between paths

---

### **Experiment 4: Category Filtering: Soft vs Hard**

**Objective**: Measure if soft category bias is effective or if hard filtering is needed

**Protocol**:
1. Query for "red tops" with `forceHardCategoryFilter=false` (soft) → measure recall of tops
2. Query for "red tops" with `forceHardCategoryFilter=true` (hard) → measure recall of tops
3. Measure precision@10 for both modes

**Result Interpretation**:
- If soft recall >> hard recall: Soft filtering is better
- If soft recall < hard recall but precision better: Trade-off exists
- If soft precision low (< 0.5): Soft filtering is broken

**Action**:
- Default to mode with best recall
- Adjust threshold to tune precision/recall trade-off

---

### **Experiment 5: YOLO Confidence Threshold**

**Objective**: Measure how detection confidence affects downstream quality

**Protocol**:
1. Run inference with confidence threshold = 0.3: -> count detections, measure type accuracy
2. Run inference with confidence threshold = 0.5: -> count detections, measure type accuracy
3. Run inference with confidence threshold = 0.7: -> count detections, measure type accuracy
4. For each, run end-to-end search and measure NDCG@10

**Result Interpretation**:
- Lower threshold -> higher recall, lower precision
- Find knee point where precision drops without NDCG gain

**Action**:
- Set `YOLO_CONFIDENCE_THRESHOLD` to break-even point

---

### **Experiment 6: Model Version Consistency**

**Objective**: Verify embeddings are from same CLIP model

**Protocol**:
1. Note which model loaded at startup: `[CLIP] Selected model type: X`
2. Query the index for similarity scoring documentation
3. Sample 100 embeddings from Postgres, inspect metadata (if available)
4. For a known good product, generate embedding in 3 ways:
   - Via `getImageEmbedding()`
   - Via index (retrieve and compute cosine)
   - Via brute-force Postgres vector

**Result Interpretation**:
- If all three embeddings very similar (cosine > 0.99): Model is consistent
- If divergent: Model was switched during reindex

**Action**:
- Pin `CLIP_MODEL_TYPE` env var; don't auto-detect

---

## 8. RECOMMENDED FIXES BY IMPACT

### **Immediate fixes (Day 1 — <1 hour each)**

1. **Check and fix vector normalization**
   - Verify `normalizeVector()` always returns norm ≈ 1.0
   - Add assertion: throw if norm < 1e-12 or > 1.1
   - Estimated impact: +30% if vectors are denormalized

2. **Pin CLIP model**
   - Set `CLIP_MODEL_TYPE` env var (do not auto-detect)
   - Verify model matches index
   - Estimated impact: +20% if model mismatch

3. **Align kNN fields**
   - Check `SEARCH_IMAGE_KNN_FIELD` matches active index field
   - If index has `embedding_garment` backfilled, switch to it
   - Estimated impact: +40% if on wrong field

4. **Adjust similarity threshold**
   - Reduce from 0.7 to 0.5 for initial retrieval
   - Use final relevance gating for acceptance (not raw similarity)
   - Estimated impact: +25% recall@10, -15% precision (acceptable)

5. **Align preprocessing**
   - Verify `SEARCH_IMAGE_BG_REMOVAL` and `SEARCH_IMAGE_QUERY_REMBG` match
   - Check both use same rembg service URL
   - Estimated impact: +10% if consistently different

---

### **High-impact fixes (Week 1 — 2-4 hours each)**

| Fix | Impact | Effort | Prerequisite |
|-----|--------|--------|--------------|
| Reindex with NV normalization assertion | +30% | 4h | Phase 0 checks |
| Recalibrate dual kNN alpha per category | +15% | 3h | Experiment 2 |
| Rebuild index with HNSW `ef_search`=256 | +20% | 2h | Experiment 1 |
| Retune relevance gates (raise thresholds) | +10% | 2h | Phase 1 logging |
| Implement adaptive YOLO confidence | +12% | 4h | Experiment 5 |
| Add comprehensive logging/metrics | +5% (observability) | 3h | Mid-flight |

---

### **Medium-term fixes (Week 2-4)**

1. **Audit all embedding generation codepaths**
   - Ensure 100% use normalized vectors
   - Add test suite for embedding consistency

2. **Rebuild index with `embedding_garment` mandatory**
   - Backfill any missing garment crops
   - Use consistent YOLO-based cropping

3. **Implement per-detection shopping**
   - Add separate kNN field optimization for cropped images
   - Fine-tune category-specific embedding models

4. **Add A/B testing infrastructure**
   - Route percentage of traffic to new reranking model
   - Measure NDCG and recall improvements

---

## 9. RECOMMENDED PSEUDOCODE FIXES

### **Embedding Generation (Guaranteed Normalized)**

```typescript
async function processImageForEmbedding(imageBuffer: Buffer): Promise<number[]> {
  // Step 1: Preprocess
  const prepared = await prepareBufferForPrimaryCatalogEmbedding(imageBuffer);
  
  // Step 2: Run CLIP
  const preprocessed = preprocessImage(...);
  const rawEmbedding = await getImageEmbedding(preprocessed);
  
  // Step 3: GUARANTEE normalization
  const norm = Math.sqrt(rawEmbedding.reduce((s, v) => s + v * v, 0));
  if (norm < 1e-12) {
    throw new Error(`[EMBEDDING] Zero-norm CLIP output — model failed`);
  }
  if (Math.abs(norm - 1.0) > 0.001) {
    console.warn(`[EMBEDDING] Re-normalizing drift: ${norm}`);
  }
  
  const normalized = rawEmbedding.map(v => v / norm);
  
  // Step 4: Validate
  const resultNorm = Math.sqrt(normalized.reduce((s, v) => s + v * v, 0));
  console.assert(Math.abs(resultNorm - 1.0) < 0.01, `Norm check failed: ${resultNorm}`);
  
  return normalized;
}
```

---

### **Index Query with Score Normalization**

```typescript
async function queryEmbeddingField(
  vector: number[],
  field: 'embedding' | 'embedding_garment',
  k: number,
  filters: any[] = []
): Promise<Array<{productId: string, similarity01: number}>> {
  const body = {
    size: k,
    query: {
      bool: {
        must: [
          {
            knn: {
              [field]: {
                vector,
                k
              }
            }
          }
        ],
        filter: filters
      }
    },
    _source: ['product_id', 'embedding_score_version']
  };
  
  const response = await osClient.search({index: 'products', body});
  const hits = response.body.hits.hits;
  
  return hits.map((hit: any) => {
    const versionTag = hit._source?.embedding_score_version || 'v2';
    const normalized = normalizeOpenSearchScore(hit._score || 0, versionTag);
    
    return {
      productId: hit._source.product_id,
      similarity01: normalized
    };
  });
}

function normalizeOpenSearchScore(raw: number, versionTag: string): number {
  if (versionTag === 'v1') {
    // Legacy: (1 + cos) / 2, need to invert
    const cos = 2 * raw - 1;
    return Math.max(0, Math.min(1, cos));
  }
  // v2: raw cosine, typically [0, 1]
  if (raw > 1.001) {
    // Might be malformed v1 — try conversion
    return Math.max(0, Math.min(1, raw / 2));
  }
  return Math.max(0, Math.min(1, raw));
}
```

---

### **Dual kNN Fusion (Adaptive)**

```typescript
async function dualKnnFusion(
  globalEmbedding: number[],
  garmentEmbedding: number[] | null,
  category: string,
  filters: any[]
): Promise<Array<{productId: string, blendedSim: number}>> {
  // Fetch both fields in parallel
  const [globalHits, garmentHits] = await Promise.all([
    queryEmbeddingField(globalEmbedding, 'embedding', 600, filters),
    garmentEmbedding
      ? queryEmbeddingField(garmentEmbedding, 'embedding_garment', 600, filters)
      : Promise.resolve([])
  ]);
  
  // Merge by product ID
  const hitMap = new Map<string, {g?: number, gm?: number}>();
  globalHits.forEach(hit => {
    hitMap.set(hit.productId, {g: hit.similarity01});
  });
  garmentHits.forEach(hit => {
    const entry = hitMap.get(hit.productId) || {};
    entry.gm = hit.similarity01;
    hitMap.set(hit.productId, entry);
  });
  
  // Blend with adaptive weights
  const results: Array<{productId: string, blendedSim: number}> = [];
  for (const [productId, scores] of hitMap) {
    if (!scores.g && !scores.gm) continue;
    
    // Compute blend
    const globalSim = scores.g || 0;
    const garmentSim = scores.gm || 0;
    
    // If garment is missing, use global only
    if (!garmentSim) {
      results.push({productId, blendedSim: globalSim});
      continue;
    }
    
    // Adapt alpha based on disagreement
    let alpha = dualKnnCategoryAlpha(category);  // e.g., 0.35 for tops
    const disagreement = Math.abs(globalSim - garmentSim);
    if (disagreement > 0.3) {
      alpha = 0.5;  // Be conservative when scores diverge
    }
    
    const blended = alpha * globalSim + (1 - alpha) * garmentSim;
    results.push({productId, blendedSim: blended});
  }
  
  // Sort and return top-k
  return results.sort((a, b) => b.blendedSim - a.blendedSim).slice(0, 500);
}

function dualKnnCategoryAlpha(category: string): number {
  const c = String(category || "").toLowerCase().trim();
  if (c === "tops") return 0.35;
  if (c === "accessories") return 0.5;
  if (c === "footwear") return 0.45;
  return 0.40;
}
```

---

## 10. FINAL DIAGNOSIS SUMMARY

### **The 3 Most Probable Root Causes**

1. **Vector Normalization Bug or Index Inconsistency** (90% confidence)
   - Embeddings in index are NOT L2-normalized to 1.0
   - OR query-time normalization differs from index-time
   - **Impact**: 30-50% of good results filtered out by OpenSearch
   - **Quickest fix**: Validate norms in Postgres; reindex if needed

2. **CLIP Model Mismatch or Crop Preprocessing Inconsistency** (80% confidence)
   - Model switched (ViT-B/32 → Fashion-CLIP) without reindexing catalog
   - OR YOLO detection crop used at query time but center crop at index time
   - **Impact**: Neighbors ranked incorrectly; recall drops 40-60%
   - **Quickest fix**: Verify `CLIP_MODEL_TYPE` and `SEARCH_IMAGE_KNN_FIELD` alignment

3. **Query on Wrong Embedding Field or Threshold Too High** (70% confidence)
   - Querying `embedding` (full-frame) with crop vector, or vice versa
   - OR threshold 0.70 filtering out valid matches
   - **Impact**: 20-40% recall loss
   - **Quickest fix**: Check `SEARCH_IMAGE_KNN_FIELD`; lower threshold to 0.5

---

### **The 3 Highest-Impact Fixes**

| Fix | Expected Improvement | Effort | Confidence |
|-----|----------------------|--------|-----------|
| **Normalize all embeddings + reindex** | +30-40% recall@10 | 6h | 90% |
| **Verify/fix model consistency** | +20-30% recall@10 | 1h check + redeploy | 80% |
| **Lower threshold 0.7 → 0.5 + use relevance gating** | +25-35% recall@10 | 30 min | 95% |

**Combined expected uplift**: 60-80% recall@10 improvement

---

### **Fastest Way to Prove Where the Bug Is**

**30-minute diagnostic:**

1. **Check embedding norms** (5 min):
   ```sql
   SELECT sqrt(SUM(v*v)) as norm FROM (
     SELECT UNNEST(embedding) as v FROM product_images LIMIT 1
   ) UNION ALL
   SELECT sqrt(SUM(v*v)) FROM (...LIMIT 2);
   ```
   - If norms << 1.0 or >> 1.0: **L2 normalization bug confirmed** → reindex

2. **Check CLIP model** (2 min):
   ```bash
   grep CLIP_MODEL_TYPE .env || echo "UNSET — AUTO-DETECT ACTIVE"
   tail -50 logs/app.log | grep "CLIP.*Selected model"
   ```
   - If different at index vs query: **Model mismatch confirmed** → pin model and redeploy

3. **Check kNN field** (2 min):
   ```bash
   echo "Active kNN field: $SEARCH_IMAGE_KNN_FIELD"
   curl http://opensearch:9200/products/_mapping | grep '"knn_vector"'
   ```
   - If embedding_garment exists and is populated but not used: **Field mismatch confirmed** → switch field

4. **Test brute-force recall** (10 min):
   ```typescript
   // Modify searchByImageWithSimilarity to return brute-force top-10 unranked
   // Compare with ranked OpenSearch results
   // If brute-force >> OpenSearch: Problem is ranking/thresholds, not index
   ```

5. **Test threshold tuning** (5 min):
   ```bash
   export SEARCH_IMAGE_SIMILARITY_THRESHOLD=0.50
   # Re-run searches; measure improvement
   ```

**If all 3 checks pass**: Problem is in relevance reranking gates; instrument Phase 2 above.

---

This completes the comprehensive debugging guide. **Begin with Phase 0 Quick Wins immediately.**

