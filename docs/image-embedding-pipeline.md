# Image Processing, Embedding & OpenSearch Pipeline Documentation

## Table of Contents

1. [Overview](#overview)
2. [Image Preprocessing](#image-preprocessing)
3. [Embedding Models](#embedding-models)
4. [Embedding Types](#embedding-types)
5. [Attention-Based Fusion](#attention-based-fusion)
6. [OpenSearch Vector Storage](#opensearch-vector-storage)
7. [Complete Pipeline Flow](#complete-pipeline-flow)
8. [Database Schema](#database-schema)
9. [Configuration](#configuration)
10. [Search Query Flow](#search-query-flow)

---

## Overview

This pipeline handles the complete lifecycle of images from ingestion to vector storage in OpenSearch. It enables semantic image search by converting product images into dense vector embeddings using CLIP (Contrastive Language-Image Pre-training) models.

### Key Components

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           IMAGE INGESTION PIPELINE                          │
└─────────────────────────────────────────────────────────────────────────────┘

Raw Image → Validation → Preprocessing → YOLO Detection → CLIP Embedding
                                                    ↓
                                          Attribute Embeddings
                                                    ↓
                                          Redis Caching (optional)
                                                    ↓
                                          Document Building
                                                    ↓
                                          OpenSearch Indexing
```

---

## Image Preprocessing

### 1. Image Validation (`src/lib/image/processor.ts:125-156`)

Before processing, images are validated:

| Check | Criteria |
|-------|----------|
| Format | JPEG, PNG, WebP, GIF only |
| Minimum Size | 32x32 pixels |
| Maximum Size | 8000x8000 pixels |

```typescript
// From validateImage()
const allowedFormats = ["jpeg", "jpg", "png", "webp", "gif"];
if (metadata.width < 32 || metadata.height < 32) return invalid;
if (metadata.width > 8000 || metadata.height > 8000) return invalid;
```

### 2. Core Image Transformations

#### Sharp.js Processing (`src/lib/image/processor.ts:28-51`)

```typescript
// From processImageForEmbedding()
await sharp(imageBuffer)
  .resize(224, 224, { fit: "cover" })  // Resize to CLIP input size
  .removeAlpha()                         // Convert RGBA → RGB
  .raw()                                // Output raw pixels
  .toBuffer();
```

#### Garment Center Crop (`src/lib/image/processor.ts:13-23`)

Extracts the center region where garments typically appear:

```typescript
// Dimensions: 64% width × 62% height, positioned at 18% left, 12% top
const left = Math.floor(w * 0.18);
const top = Math.floor(h * 0.12);
const width = Math.max(1, Math.floor(w * 0.64));
const height = Math.max(1, Math.floor(h * 0.62));
```

#### Detection Crop with Padding (`src/lib/image/processor.ts:65-105`)

For YOLO detections, extracts bounding boxes with 8% padding:

```typescript
const padX = boxWidth * 0.08;
const padY = boxHeight * 0.08;
```

### 3. Normalization (`src/lib/image/utils.ts:35-61`)

Images are normalized to ImageNet statistics:

| Channel | Mean | Std |
|---------|------|-----|
| R | 0.48145466 | 0.26862954 |
| G | 0.4578275 | 0.26130258 |
| B | 0.40821073 | 0.27577711 |

```typescript
// Formula: (pixel / 255.0 - mean) / std
normalized[dstIdx] = (pixelValue / 255.0 - mean[c]) / std[c];
```

### 4. Bilinear Resize (`src/lib/image/clip.ts:566-604`)

Uses bilinear interpolation for smooth downsampling (better than nearest-neighbor):

```typescript
// Bilinear interpolation formula
const top = v00 * (1 - wx) + v10 * wx;
const bot = v01 * (1 - wx) + v11 * wx;
dst[(y * dstW + x) * channels + c] = top * (1 - wy) + bot * wy;
```

### 5. Perceptual Hash (pHash) (`src/lib/image/utils.ts:67-126`)

Computes a 64-bit perceptual hash for duplicate detection:

1. Resize to 32x32 grayscale
2. Apply 2D DCT (Discrete Cosine Transform)
3. Take top-left 8x8 coefficients (excluding DC)
4. Compute median of coefficients
5. Generate 64-bit hash based on comparison to median

---

## Embedding Models

### Supported Models (`src/lib/image/clip.ts:276-301`)

| Model | File | Dimensions | Input Size | Best For |
|-------|------|------------|------------|----------|
| **Fashion-CLIP** (default) | `fashion-clip-*.onnx` | 512 | 224x224 | Fashion details, textures |
| **ViT-L/14** | `clip-image-vit-l-14.onnx` | 768 | 224x224 | Higher accuracy, larger |
| **ViT-B/32** | `clip-image-vit-32.onnx` | 512 | 224x224 | Baseline (legacy) |

### Model Selection

```bash
# Environment variable
CLIP_MODEL_TYPE=fashion-clip  # Options: "fashion-clip" | "vit-l-14" | "vit-b-32"
EXPECTED_EMBEDDING_DIM=512    # Must match model (512 or 768)
```

### ONNX Inference (`src/lib/image/clip.ts:631-658`)

```typescript
const inputTensor = new ort.Tensor("float32", preprocessedImage, [
  1, 3, IMAGE_SIZE, IMAGE_SIZE  // [batch, channels, height, width]
]);
const results = await imageSession.run(feeds);
const embedding = Array.from(results[outputName].data as Float32Array);
const normalized = normalizeVector(embedding);  // L2 normalize
```

---

## Embedding Types

### 1. Global Embedding (`embedding`)

Full image CLIP embedding for general similarity search.

```typescript
async function processImageForEmbedding(imageBuffer: Buffer): Promise<number[]> {
  const { data, info } = await sharp(imageBuffer)
    .resize(224, 224, { fit: "cover" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  
  const preprocessed = preprocessImage(new Uint8Array(data), info.width, info.height, info.channels);
  return getImageEmbedding(preprocessed);
}
```

### 2. Garment ROI Embedding (`embedding_garment`)

Center-cropped embedding focusing on the garment region, ignoring background.

```typescript
async function processImageForGarmentEmbedding(imageBuffer: Buffer): Promise<number[]> {
  const cropped = await extractGarmentCenterCropBuffer(imageBuffer);
  return processImageForEmbedding(cropped);
}
```

### 3. Attribute-Specific Embeddings (`src/lib/search/attributeEmbeddings.ts`)

Specialized embeddings for different semantic aspects:

| Attribute | Prompt | Fusion Weight (img/txt) |
|-----------|--------|------------------------|
| `global` | Full image | 0.75 / 0.25 |
| `color` | "a fashion item in this color, showing the dominant color of the garment" | 0.60 / 0.40 |
| `texture` | "a close-up of the fabric texture of this clothing item" | 0.80 / 0.20 |
| `material` | "a fashion product made of this fabric material" | 0.55 / 0.45 |
| `style` | "a fashion outfit in this style aesthetic" | 0.65 / 0.35 |
| `pattern` | "a garment with this pattern or print design" | 0.70 / 0.30 |

### 4. Text Tokenizer (`src/lib/image/clip.ts:124-830`)

Custom BPE tokenizer for CLIP text encoding:

- Downloads vocab.json and merges.txt from HuggingFace
- Caches tokenizer files locally
- Supports max 77 tokens per text input
- Handles text → token ID conversion for ONNX input

---

## Attention-Based Fusion

### Overview (`src/lib/search/attentionFusion.ts`)

Replaces static 70/30 fusion with learned, attribute-specific weights.

### Learned Attribute Weights (`src/lib/search/attentionFusion.ts:55-62`)

```typescript
const LEARNED_ATTRIBUTE_WEIGHTS: Record<SemanticAttribute, AttentionWeights> = {
  global:    { imageWeight: 0.75, textWeight: 0.25 },
  color:     { imageWeight: 0.60, textWeight: 0.40 },  // Text helps describe color
  texture:   { imageWeight: 0.80, textWeight: 0.20 }, // Texture is mostly visual
  material:  { imageWeight: 0.55, textWeight: 0.45 },  // Text often describes material
  style:     { imageWeight: 0.65, textWeight: 0.35 },
  pattern:   { imageWeight: 0.70, textWeight: 0.30 },
};
```

### Fusion Algorithm (`src/lib/search/attentionFusion.ts:149-164`)

```typescript
function fuseEmbeddings(imageEmbed: number[], textEmbed: number[], weights: AttentionWeights): number[] {
  const dim = imageEmbed.length;
  const fused = new Array(dim);
  
  for (let i = 0; i < dim; i++) {
    fused[i] = imageEmbed[i] * weights.imageWeight + textEmbed[i] * weights.textWeight;
  }
  
  // L2 normalize result
  const norm = Math.sqrt(fused.reduce((s, v) => s + v * v, 0));
  return fused.map((v) => v / (norm + 1e-8));
}
```

### Adaptive Attention (`src/lib/search/attentionFusion.ts:91-115`)

Computes attention scores based on embedding alignment:

```typescript
function computeAttentionWeights(imageEmbed: number[], textEmbed: number[]): AttentionWeights {
  // Dot product attention
  const imageScore = dotProduct(imageEmbed, imageEmbed);
  const textScore = dotProduct(textEmbed, textEmbed);
  const crossScore = dotProduct(imageEmbed, textEmbed);
  
  // Softmax with temperature
  const scores = [imageScore + crossScore, textScore + crossScore];
  const expScores = scores.map(s => Math.exp(s / temperature));
  const sumExp = expScores.reduce((a, b) => a + b, 0);
  
  return {
    imageWeight: clamp(expScores[0] / sumExp, 0.3, 0.9),
    textWeight: clamp(expScores[1] / sumExp, 0.1, 0.7),
  };
}
```

---

## OpenSearch Vector Storage

### Index Configuration (`src/lib/core/opensearch.ts:56-285`)

```typescript
const EMBEDDING_DIM = parseInt(process.env.EXPECTED_EMBEDDING_DIM || "512", 10);

// Index settings
{
  "index.knn": true,
  "index.knn.algo_param.ef_search": 256,
}
```

### Vector Field Mappings

| Field | Dimensions | Space Type | Engine | HNSW Parameters |
|-------|------------|------------|--------|-----------------|
| `embedding` | 512 | cosinesimil | faiss | ef_construction: 128, m: 16 |
| `embedding_garment` | 512 | cosinesimil | faiss | ef_construction: 128, m: 16 |
| `embedding_color` | 512 | cosinesimil | faiss | ef_construction: 128, m: 16 |
| `embedding_texture` | 512 | cosinesimil | faiss | ef_construction: 128, m: 16 |
| `embedding_material` | 512 | cosinesimil | faiss | ef_construction: 128, m: 16 |
| `embedding_style` | 512 | cosinesimil | faiss | ef_construction: 128, m: 16 |
| `embedding_pattern` | 512 | cosinesimil | faiss | ef_construction: 128, m: 16 |

### HNSW Algorithm Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `ef_construction` | 128 | Build time accuracy (higher = slower build, better recall) |
| `m` | 16 | Max connections per node |
| `ef_search` | 256 | Query time accuracy (higher = slower query, better recall) |

### Synonyms (`src/lib/core/opensearch.ts:83-105`)

```typescript
synonyms: [
  "pant,pants,trousers",
  "shirt,top,blouse,tee",
  "dress,gown,frock",
  "jacket,coat,outerwear",
  "jeans,denim",
  "hoodie,hooded sweatshirt,pullover",
  // ... more
]
```

---

## Complete Pipeline Flow

### Ingestion Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           IMAGE INGESTION PIPELINE                           │
└─────────────────────────────────────────────────────────────────────────────┘

1. IMAGE UPLOAD/STORAGE
   ┌──────────────┐
   │ Raw Image    │ ──── Cloudflare R2 Storage
   │ Buffer       │ ──── Returns CDN URL
   └──────────────┘

2. IMAGE VALIDATION
   ┌──────────────────────────────────────────────────────────────────┐
   │ validateImage()                                                   │
   │ ✓ Check format (jpeg, png, webp, gif)                              │
   │ ✓ Check dimensions (32x32 to 8000x8000)                          │
   └──────────────────────────────────────────────────────────────────┘

3. PREPROCESSING
   ┌──────────────────────────────────────────────────────────────────┐
   │ a) Resize: 224x224 (fit: "cover")                                │
   │ b) Remove alpha channel                                          │
   │ c) Bilinear interpolation for smooth resize                      │
   │ d) Normalize: (pixel - mean) / std                               │
   │ e) CHW format: [3, 224, 224]                                     │
   └──────────────────────────────────────────────────────────────────┘

4. OPTIONAL: YOLO DETECTION
   ┌──────────────────────────────────────────────────────────────────┐
   │ dual-model-yolo.py (Python server)                                │
   │ - Clothing detection + Accessory detection                        │
   │ - Returns bounding boxes, labels, confidence                      │
   └──────────────────────────────────────────────────────────────────┘

5. OPTIONAL: COLOR EXTRACTION
   ┌──────────────────────────────────────────────────────────────────┐
   │ garmentColorPipeline.ts                                           │
   │ - K-means clustering (k=4)                                       │
   │ - LAB color space mapping                                         │
   │ - Primary, secondary, accent colors                              │
   └──────────────────────────────────────────────────────────────────┘

6. EMBEDDING GENERATION
   ┌──────────────────────────────────────────────────────────────────┐
   │ a) Global Embedding (embedding)                                  │
   │    - Full 224x224 → CLIP → 512-dim vector                        │
   │                                                                     │
   │ b) Garment ROI Embedding (embedding_garment)                     │
   │    - Center crop → CLIP → 512-dim vector                          │
   │                                                                     │
   │ c) Attribute Embeddings                                          │
   │    - For each: color, texture, material, style, pattern           │
   │    - Image crop + text prompt → CLIP dual encode                  │
   │    - Attention fusion → 512-dim vector                            │
   └──────────────────────────────────────────────────────────────────┘

7. CACHING (optional)
   ┌──────────────────────────────────────────────────────────────────┐
   │ Redis caching                                                     │
   │ - Key: emb:img:{hash}:{attribute}                               │
   │ - TTL: 24 hours                                                  │
   └──────────────────────────────────────────────────────────────────┘

8. DOCUMENT BUILDING
   ┌──────────────────────────────────────────────────────────────────┐
   │ buildProductSearchDocument()                                      │
   │ - Product metadata + vectors + attributes                         │
   │ - Canonical color mapping                                         │
   │ - Audience inference (men/women/unisex)                           │
   │ - Product type tokens                                             │
   └──────────────────────────────────────────────────────────────────┘

9. OPENSEARCH INDEXING
   ┌──────────────────────────────────────────────────────────────────┐
   │ osClient.index()                                                 │
   │ - Index: products_v1                                             │
   │ - Document ID: product_id                                        │
   │ - Refresh: true (immediate availability)                         │
   └──────────────────────────────────────────────────────────────────┘
```

---

## Database Schema

### products Table

```sql
CREATE TABLE products (
    id BIGSERIAL PRIMARY KEY,
    vendor_id BIGINT REFERENCES vendors(id),
    product_url TEXT NOT NULL,
    title TEXT NOT NULL,
    brand TEXT,
    category TEXT,
    description TEXT,
    price_cents BIGINT NOT NULL,
    availability BOOLEAN DEFAULT FALSE,
    image_url TEXT,
    image_cdn TEXT,
    primary_image_id INTEGER REFERENCES product_images(id),
    p_hash TEXT
);
```

### product_images Table

```sql
CREATE TABLE product_images (
    id SERIAL PRIMARY KEY,
    product_id BIGINT REFERENCES products(id),
    r2_key TEXT UNIQUE,              -- Cloudflare R2 key
    cdn_url TEXT,                    -- CDN URL
    embedding vector(512),           -- pgvector column (optional)
    p_hash TEXT,                     -- Perceptual hash
    is_primary BOOLEAN,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### product_image_detections Table

```sql
CREATE TABLE product_image_detections (
    id SERIAL PRIMARY KEY,
    product_image_id INTEGER REFERENCES product_images(id),
    product_id INTEGER REFERENCES products(id),
    label TEXT NOT NULL,
    confidence DECIMAL(5,4),
    box JSONB,
    box_x1 INTEGER, box_y1 INTEGER, box_x2 INTEGER, box_y2 INTEGER,
    area_ratio DECIMAL(6,4),
    style JSONB
);
```

---

## Configuration

### Environment Variables

#### CLIP/Embedding Configuration
```bash
CLIP_MODEL_TYPE=fashion-clip        # "fashion-clip" | "vit-l-14" | "vit-b-32"
EXPECTED_EMBEDDING_DIM=512           # 512 or 768 (must match model)
CLIP_SIMILARITY_THRESHOLD=0.7
CLIP_IMAGE_SIMILARITY_THRESHOLD=0.65
```

#### OpenSearch Configuration
```bash
OS_NODE=https://...aivencloud.com:12588
OS_INDEX=products_v1
OS_USERNAME=admin
OS_PASSWORD=...
```

#### Redis Caching
```bash
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...
DISABLE_EMBEDDING_CACHE=0            # Set to 1 to disable
```

#### Image Search
```bash
SEARCH_IMAGE_KNN_FIELD=embedding_garment
SEARCH_FINAL_ACCEPT_MIN_IMAGE=0.6
SEARCH_IMAGE_RELAX_FLOOR=0.5
SEARCH_IMAGE_RETRIEVAL_K=500
```

---

## Search Query Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           IMAGE SEARCH QUERY FLOW                            │
└─────────────────────────────────────────────────────────────────────────────┘

1. USER UPLOADS IMAGE
   │
   ▼
2. PREPROCESS (same as ingestion)
   - Validate format/size
   - Resize to 224x224
   - Normalize with ImageNet stats
   │
   ▼
3. GENERATE QUERY EMBEDDING
   - CLIP inference on processed image
   - Returns 512-dim vector
   - L2 normalized
   │
   ▼
4. OPTIONAL: YOLO DETECTION
   - Extract detection crops
   - Generate per-detection embeddings
   │
   ▼
5. OPEN SEARCH kNN QUERY
   ┌─────────────────────────────────────────────────────────────────┐
   │ {                                                                  │
   │   "query": {                                                       │
   │     "bool": {                                                      │
   │       "must": [{ "knn": { "embedding_garment": {                  │
   │         "vector": [...],                                            │
   │         "k": 500                                                   │
   │       }}],                                                          │
   │       "filter": [                                                   │
   │         { "term": { "is_hidden": false }},                        │
   │         { "term": { "attr_gender": "women" }},                    │
   │         { "terms": { "category": ["dresses"] }}                    │
   │       ]                                                             │
   │     }                                                               │
   │   }                                                                │
   │ }                                                                   │
   └─────────────────────────────────────────────────────────────────┘
   │
   ▼
6. MULTI-VECTOR WEIGHTED SEARCH (optional)
   - Parallel kNN on attribute fields
   - Weighted score combination
   │
   ▼
7. POSTGRES HYDRATION
   - Batch fetch product details
   - Include title, price, image
   │
   ▼
8. RERANKING (optional)
   - XGBoost ranker
   - Deduplication
   │
   ▼
9. RETURN RESULTS
```

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/lib/image/processor.ts` | High-level image processing, CLIP embeddings |
| `src/lib/image/clip.ts` | CLIP model loading, ONNX inference, tokenizer |
| `src/lib/image/utils.ts` | Low-level utilities, pHash computation |
| `src/lib/image/r2.ts` | Cloudflare R2 storage integration |
| `src/lib/search/attributeEmbeddings.ts` | Attribute-specific embedding generation |
| `src/lib/search/attentionFusion.ts` | Attention-based embedding fusion |
| `src/lib/search/searchDocument.ts` | OpenSearch document builder |
| `src/lib/search/vectorSearchEngine.ts` | kNN query execution |
| `src/lib/core/opensearch.ts` | OpenSearch client and index management |
| `src/lib/core/db.ts` | PostgreSQL connection pool |
| `src/lib/color/garmentColorPipeline.ts` | Color extraction via k-means |
| `src/lib/cache/embeddingCache.ts` | Redis caching for embeddings |

---

## Scripts

### Reindex All Products
```bash
npx tsx scripts/reindex-embeddings.ts
```

### Recreate OpenSearch Index
```bash
npx tsx scripts/recreate-opensearch-index.ts
```

### Backfill Garment Embeddings
```bash
npx tsx scripts/backfill-embedding-garment.ts
```

---

## Dependencies

### Node.js/TypeScript
- **onnxruntime-node** - ONNX model inference
- **sharp** - Image processing
- **@opensearch-project/opensearch** - OpenSearch client
- **pg** - PostgreSQL client
- **ioredis** - Redis client
- **@aws-sdk/client-s3** - Cloudflare R2/S3 API

### Python (YOLO Server)
- **onnxruntime** - ONNX inference
- **opencv-python** - Image processing
- **ultralytics** - YOLOv8
- **Pillow** - Image manipulation
- **numpy** - Array operations
