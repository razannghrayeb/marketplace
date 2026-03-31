# 🔍 Search API Complete Guide

**Purpose:** Complete reference for all search features (user guide + technical deep-dive)

**Product features (everyone):** **`FEATURES.md`** — Discover, complete style, wardrobe, try-on, compare, and **correct URL paths** (`/search` vs `/products` vs `/api/...`).

**Embeddings & pipelines (maintainers):** **`embeddings-and-search-pipelines.md`** — OpenSearch vector fields, ingestion vs query-time CLIP/BLIP/YOLO. The storefront typically uses **`POST /products/search/image`** and **`GET /search?q=`**; Part 1 examples may still cite `/search/image` only.

---

## 📋 Quick Overview

| Feature | Endpoint | Input | Use Case |
|---------|----------|-------|----------|
| **Normal Search** | `POST /search/image` | Single image | Find similar products to one image |
| **YOLO Detection** | `POST /api/images/search` | Single image | Upload outfit → detect items → find similar for each |
| **Multi-Image Composite** | `POST /search/multi-image` | Multiple images + prompt | Mix attributes from multiple images (industry-leading!) |

---

## PART 1: USER GUIDE & EXAMPLES

### 1️⃣ Normal Search (Single Image Similarity)

**Purpose**: Find products visually similar to a single image based on CLIP embeddings.

**When to Use:**
- You have one reference image
- Want to find visually similar products
- "Find me this" simple queries
- No attribute extraction needed

**Basic Usage:**
```bash
curl -X POST http://0.0.0.0:4000/search/image \
  -F "image=@dress.jpg" \
  -F "limit=20"
```

**Response:**
```json
{
  "results": [
    {
      "id": "prod_123",
      "title": "Red Floral Midi Dress",
      "score": 0.89,
      "price": 79.99,
      "brand": "StyleCo",
      "category": "dresses",
      "image_url": "https://cdn.example.com/dress.jpg"
    }
  ],
  "total": 147,
  "tookMs": 45
}
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `image` | File | ✅ | Image file (JPEG/PNG) |
| `limit` | Number | | Max results (default: 50, max: 200) |

---

### 2️⃣ YOLO Detection Search (Shop the Look)

**Purpose**: Upload outfit photos, auto-detect items, find similar products for each.

**When to Use:**
- Upload lookbook/outfit images
- "Shop the look" functionality
- Auto-detect items (don't want to crop manually)
- Finding products for multiple items in one image

**Basic Usage:**
```bash
curl -X POST http://0.0.0.0:4000/api/images/search \
  -F "image=@outfit.jpg" \
  -F "confidence=0.25" \
  -F "limit_per_item=10"
```

**Response:**
```json
{
  "detection": {
    "items": [
      {
        "label": "dress",
        "confidence": 0.92,
        "bbox": [0.1, 0.2, 0.5, 0.8]
      },
      {
        "label": "shoes",
        "confidence": 0.87,
        "bbox": [0.3, 0.8, 0.7, 1.0]
      }
    ]
  },
  "similarProducts": {
    "byDetection": [
      {
        "detection": { "label": "dress" },
        "products": [
          { "id": "prod_456", "title": "Floral Dress", "score": 0.91 }
        ]
      }
    ]
  }
}
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `image` | File | ✅ | Image file (JPEG/PNG) |
| `confidence` | Number | | Detection threshold (0-1, default: 0.25) |
| `limit_per_item` | Number | | Results per detected item (default: 10) |

---

### 3️⃣ Multi-Image Composite Search (NEW - Industry-Leading!)

**Purpose**: Combine attributes from multiple images using natural language.

**Unique Capability:** "Color from image 1, style from image 2, under $200" all in one query!

**When to Use:**
- Cross-image attribute mixing
- "Color from this, texture from that" queries
- Advanced fashion discovery
- Precise style matching

**Basic Usage:**
```bash
curl -X POST http://0.0.0.0:4000/search/multi-image \
  -F "images=@red_dress.jpg" \
  -F "images=@leather_jacket.jpg" \
  -F "prompt=Red color from first, leather texture from second, under $150" \
  -F "limit=20"
```

**Response:**
```json
{
  "results": [
    {
      "id": "prod_789",
      "title": "Red Leather-Trimmed Dress",
      "score": 0.87,
      "scoreBreakdown": {
        "color": 0.95,
        "texture": 0.82,
        "price": 0.78,
        "vector": 0.85
      },
      "price": 145.00
    }
  ],
  "total": 42,
  "tookMs": 220
}
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `images` | Files | ✅ | 1-5 image files (JPEG/PNG) |
| `prompt` | String | ✅ | Natural language describing what you want |
| `limit` | Number | | Max results (default: 50) |
| `explainScores` | Bool | | Include score breakdown (default: true) |

**Advanced: Explicit Weights**
```bash
curl -X POST http://0.0.0.0:4000/search/multi-vector \
  -F "images=@image1.jpg" \
  -F "images=@image2.jpg" \
  -F "prompt=Elegant evening wear" \
  -F "attributeWeights={\"color\":0.4,\"style\":0.4,\"texture\":0.2}" \
  -F "explainScores=true"
```

---

## PART 2: TECHNICAL DEEP-DIVE

### Architecture Overview

**Search Type Comparison:**

| Aspect | Normal | YOLO Detection | Multi-Image |
|--------|--------|----------------|-------------|
| **Models** | CLIP (ONNX) | YOLOv8 + CLIP | Gemini + 6x CLIP |
| **Detection** | ❌ | ✅ YOLOv8 | ❌ (prompt-based) |
| **Attribute Mixing** | ❌ | ❌ | ✅ Advanced |
| **Intent Parsing** | ❌ | ❌ | ✅ Gemini |
| **Per-Attribute Search** | ❌ | ❌ | ✅ 6 dimensions |
| **Response Time** | ~50ms | ~300ms | ~200ms |
| **Cost** | Free | Free | ≈$0.001 (Gemini) |
| **Scalability** | Linear | Linear | Linear + Gemini |

---

### Implementation Details

#### 1. Normal Search Pipeline
```
User Image
  ↓
[CLIP ONNX Model]
  ↓
512-dim embedding vector
  ↓
[OpenSearch kNN]
  ↓
Cosine similarity ranking
  ↓
Top-N results (sorted by score)
```

**Files:**
- `src/lib/image/clip.ts` — CLIP embedding generation
- `src/routes/search/search.service.ts` — Search logic
- `src/routes/search/search.controller.ts` — HTTP handler
- `src/lib/core/opensearch.ts` — OpenSearch client

**Performance:**
- Embedding generation: ~30ms
- kNN search: ~20ms
- Total: ~50ms average

---

#### 2. YOLO Detection Pipeline
```
User Image
  ↓
[YOLOv8 Fashion Model]
  ↓
Detected items (bounding boxes + labels)
  ↓
[Crop each item]
  ↓
[CLIP embedding per item]
  ↓
[Parallel kNN search]
  ↓
Results grouped by detection
```

**Files:**
- `src/lib/image/yolov8Client.ts` — YOLOv8 HTTP client
- `src/routes/products/image-analysis.service.ts` — Full pipeline
- `src/routes/products/image-analysis.controller.ts` — HTTP handler

**Performance:**
- YOLO detection: ~250ms
- Per-item embedding: ~10ms × (# items)
- Per-item kNN: ~10ms × (# items)
- Total: ~300ms average (for 3-4 items)

---

#### 3. Multi-Image Composite Pipeline (5 Phases)

**Phase 1: Intent Understanding**
- **Model:** Gemini 1.5 Flash
- **Input:** Images + natural language prompt
- **Output:** Structured intent (attribute weights, constraints, filters)
- **Time:** ~50ms

**Phase 2: Per-Image DNA Extraction**
- **Model:** Fashion-CLIP with attribute-focused prompts
- **Embeddings:**
  - `embedding_global` — overall appearance (512-dim)
  - `embedding_color` — color palette (512-dim)
  - `embedding_texture` — surface texture (512-dim)
  - `embedding_material` — fabric type (512-dim)
  - `embedding_style` — aesthetic/fashion style (512-dim)
  - `embedding_pattern` — prints/patterns (512-dim)
- **Time:** ~30ms per image

**Phase 3: Composite Query Builder**
- Blend embeddings based on intent weights
- Build OpenSearch boolean filters
- Configure multi-vector search parameters

**Phase 4: Smart Search (Multi-Vector)**
- **Method:** Parallel kNN per attribute
- **Union:** Merge candidates across attributes
- **Weighting:** Dynamic candidate scaling: `K_i = max(minK, baseK × (w_i × multiplier + ε))`
- **Re-ranking:** Weighted combination of attribute scores
- **Time:** ~80ms

**Phase 5: Intent-Aware Reranking**
- **Signal Weights:**
  - Vector similarity: 0.6 (default)
  - Attribute matches: 0.3 (default)
  - Price proximity: 0.1 (default)
  - Recency: 0.0 (default)
- **Output:** Final ranked results with score breakdown
- **Time:** ~20ms

**Total:** ~180-250ms for 2-3 images

---

### Database Schema (OpenSearch)

```typescript
{
  "id": { type: "integer" },
  "title": { type: "text" },
  "brand": { type: "keyword" },
  "category": { type: "keyword" },
  "price_cents": { type: "long" },

  // Core embedding (CLIP)
  "embedding": {
    type: "knn_vector",
    dimension: 512,
    method: { name: "hnsw", engine: "faiss" }
  },

  // Per-attribute embeddings (Multi-Vector Search)
  "embedding_color": { type: "knn_vector", dimension: 512 },
  "embedding_texture": { type: "knn_vector", dimension: 512 },
  "embedding_material": { type: "knn_vector", dimension: 512 },
  "embedding_style": { type: "knn_vector", dimension: 512 },
  "embedding_pattern": { type: "knn_vector", dimension: 512 },

  // Metadata for filtering
  "vendor_id": { type: "keyword" },
  "availability": { type: "boolean" },
  "last_seen": { type: "date" }
}
```

---

### Key Files

**Search Implementation:**
- `src/lib/search/semanticSearch.ts` — Text search engine
- `src/lib/search/multiVectorSearch.ts` — Multi-vector kNN
- `src/lib/search/attributeEmbeddings.ts` — Per-attribute embedding generation
- `src/routes/search/search.controller.ts` — All search endpoints
- `src/routes/search/search.service.ts` — Service layer

**Image Analysis:**
- `src/routes/products/image-analysis.service.ts` — YOLO pipeline
- `src/lib/image/yolov8Client.ts` — YOLOv8 wrapper
- `src/lib/image/clip.ts` — CLIP wrapper

**Ranking & Reranking:**
- `src/lib/ranker/intentReranker.ts` — Intent-aware reranking
- `src/lib/ranker/pipeline.ts` — Full ranking pipeline
- `src/lib/ranker/features.ts` — Feature engineering

---

### Performance Metrics

| Scenario | Latency | Throughput | Notes |
|----------|---------|-----------|-------|
| Normal search (1 image) | 50ms | 20 req/sec | Bottleneck: network I/O |
| YOLO detection (common) | 300ms | 3 req/sec | Bottleneck: YOLO inference |
| Multi-image (2-3 images) | 200ms | 5 req/sec | Bottleneck: Gemini/5 parallel kNN |
| Cached result | <10ms | >100 req/sec | Redis cache hit |

**Scaling Notes:**
- YOLO inference is CPU-bound; consider GPU acceleration
- CLIP embeddings are I/O-bound; Redis caching helps significantly
- Multi-vector search scales linearly with # attributes (currently 6)
- Gemini API calls are our main external dependency

---

### Configuration & Tuning

**Environment Variables:**
```env
# CLIP
CLIP_MODEL_TYPE=fashion-clip  # or vit-l-14, vit-b-32
CLIP_SIMILARITY_THRESHOLD=0.7

# Multi-Vector Search
MULTI_VECTOR_ENABLE=true
MULTI_VECTOR_WEIGHTS_DEFAULT='{"color":0.3,"style":0.3,"texture":0.2,"material":0.1,"pattern":0.05,"global":0.05}'

# Gemini (Intent Parsing)
GEMINI_API_KEY=...
```

**Performance Tuning:**
- Increase OpenSearch `k` parameter for broader search (higher recall, lower precision)
- Reduce `min_confidence` for YOLOv8 to detect more items
- Cache attribute embeddings for frequently searched items
- Batch embedding generation for bulk indexing

---

### Testing

**Unit Tests:**
- `src/lib/ranker/intentReranker.unit.ts` — Reranker logic

**Integration Tests:**
- `scripts/test-multi-vector-search.ts` — Full pipeline test
- Includes synthetic tests (no images required)
- Includes real image tests

**Manual Testing:**
```bash
# Normal search
curl -X POST http://0.0.0.0:4000/search/image -F "image=@test.jpg"

# YOLO detection
curl -X POST http://0.0.0.0:4000/api/images/search -F "image=@outfit.jpg"

# Multi-image
curl -X POST http://0.0.0.0:4000/search/multi-image \
  -F "images=@img1.jpg" \
  -F "images=@img2.jpg" \
  -F "prompt=Red color from first, modern style from second"
```

---

### Migration & Setup

**Initial Setup:**
```bash
# 1. Recreate OpenSearch index (adds per-attribute vectors)
npx tsx scripts/recreate-opensearch-index.ts

# 2. Backfill attribute embeddings for existing products
npx tsx scripts/generate-attribute-embeddings.ts --batch-size=100

# 3. Test
npx tsx scripts/test-multi-vector-search.ts

# 4. Monitor
curl http://0.0.0.0:4000/api/images/status
```

---

### Future Enhancements

- [ ] GPU acceleration for CLIP embeddings
- [ ] Query caching with automatic invalidation
- [ ] More granular attributes (neckline, sleeve length, hem)
- [ ] Ensemble multiple CLIP models
- [ ] Negative attribute support ("not too formal")
- [ ] Spatial relationship understanding ("stripes on sleeves")
- [ ] User feedback loop for ranking optimization

---

### Troubleshooting

**Problem: Search returns no results**
- Check OpenSearch is running: `curl http://0.0.0.0:9200`
- Verify index exists: `curl http://0.0.0.0:9200/_cat/indices`
- Check embedding generation: `curl http://0.0.0.0:4000/api/images/status`

**Problem: Multi-image search is slow**
- Currently ~200ms; if >500ms, check Gemini API latency
- Verify all 6 embeddings are present in OpenSearch
- Check Redis cache is running

**Problem: YOLO detection misses items**
- Lower `confidence` threshold (default: 0.25)
- Try darker detection model variant
- Manually crop image and use normal search

---

## Feature Comparison Matrix

| Aspect | Normal | YOLO Detection | Multi-Image |
|--------|--------|----------------|-------------|
| **Input** | 1 image | 1 image | 1-5 images |
| **Requires Prompt** | ❌ | ❌ | ✅ |
| **Item Detection** | ❌ | ✅ | ❌ |
| **Attribute Mixing** | ❌ | ❌ | ✅ |
| **Intent Parsing** | ❌ | ❌ | ✅ |
| **Per-Attribute Search** | ❌ | ❌ | ✅ |
| **Score Explanation** | ❌ | ❌ | ✅ |
| **Custom Weights** | ❌ | ❌ | ✅ |
| **Response Time** | ~50ms | ~300ms | ~200ms |

---

## Support & Resources

- **Full Docs:** See [api-reference.md](./api-reference.md)
- **Architecture:** See [architecture.md](./architecture.md)
- **Technical Deep-Dive:** See [multi-vector-search.md](./multi-vector-search.md) and [composite-query-system.md](./composite-query-system.md)
- **Image Analysis:** See [image-analysis-api.md](./image-analysis-api.md)

---

**Last Updated:** March 2026 (paths: use `/search`, `/products/search/image`; see `FEATURES.md`)
**Status:** ✅ All features production-ready
