# 🔍 Complete Search Features Guide

This document explains all three search capabilities in the Fashion Aggregator API.

---

## 📋 Quick Overview

| Feature | Endpoint | Input | Use Case |
|---------|----------|-------|----------|
| **Normal Search** | `POST /api/search/image` | Single image | Find similar products to one image |
| **YOLO Detection Search** | `POST /api/images/search` | Single image | Upload image → detect items → find similar for each item |
| **Multi-Image Composite** | `POST /api/search/multi-image` | Multiple images + prompt | Mix attributes from multiple images |

---

## 1️⃣ Normal Search (Single Image Similarity)

**Purpose**: Find products most similar to a single image based on visual embeddings.

### Endpoint
```
POST /api/search/image
```

### When to Use
- You have one reference image
- Want to find visually similar products
- Simple "find me this" queries
- No need to extract specific attributes

### Request
```bash
curl -X POST http://localhost:3000/api/search/image \
  -F "image=@dress.jpg" \
  -F "limit=20"
```

### Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `image` | File | ✓ | Single image file (JPEG/PNG) |
| `limit` | Number | | Max results (default: 50) |

### Response
```json
{
  "results": [
    {
      "id": "prod_123",
      "name": "Red Floral Midi Dress",
      "score": 0.89,
      "price": 79.99,
      "brand": "StyleCo",
      "category": "dresses",
      "imageUrl": "https://cdn.example.com/dress.jpg"
    }
  ],
  "total": 147,
  "tookMs": 45
}
```

### How It Works
1. Extract CLIP embedding from input image (512-dim vector)
2. Perform kNN search in OpenSearch against `embedding` field
3. Return products ranked by cosine similarity
4. No attribute extraction or prompt parsing

---

## 2️⃣ YOLO Detection Search (Shop the Look)

**Purpose**: Upload an image with multiple items, detect each fashion item, and find similar products for each detected item.

### Endpoint
```
POST /api/images/search
```

### When to Use
- Upload outfit/lookbook images with multiple items
- Want to "shop the look" - find products for each item
- Need automatic product detection in images
- Don't want to crop images manually

### Request
```bash
curl -X POST http://localhost:3000/api/images/search \
  -F "image=@outfit.jpg" \
  -F "confidence=0.25" \
  -F "threshold=0.7" \
  -F "limit_per_item=10"
```

### Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `image` | File | ✓ | Single image file (JPEG/PNG) |
| `confidence` | Number | | Detection confidence (0-1, default: 0.25) |
| `threshold` | Number | | Similarity threshold (0-1, default: 0.7) |
| `limit_per_item` | Number | | Max products per detected item (default: 10) |
| `filter_category` | Boolean | | Filter by detected category (default: true) |
| `store` | Boolean | | Store image in R2 (default: false) |

### Response
```json
{
  "success": true,
  "detection": {
    "items": [
      {
        "label": "dress",
        "confidence": 0.92,
        "bbox": [120, 50, 300, 450],
        "category": "dresses"
      },
      {
        "label": "heels",
        "confidence": 0.87,
        "bbox": [150, 420, 220, 495],
        "category": "footwear"
      },
      {
        "label": "bag",
        "confidence": 0.84,
        "bbox": [280, 180, 360, 260],
        "category": "accessories"
      }
    ],
    "count": 3,
    "summary": { "dress": 1, "heels": 1, "bag": 1 }
  },
  "similarProducts": {
    "byDetection": [
      {
        "detection": { "label": "dress", "confidence": 0.92 },
        "category": "dresses",
        "products": [
          {
            "id": 123,
            "title": "Floral Midi Dress",
            "similarity_score": 0.89,
            "price": 79.99,
            "brand": "StyleCo"
          }
        ],
        "count": 10
      },
      {
        "detection": { "label": "heels", "confidence": 0.87 },
        "category": "footwear",
        "products": [
          {
            "id": 456,
            "title": "Strappy Heels",
            "similarity_score": 0.85,
            "price": 89.99
          }
        ],
        "count": 8
      }
    ],
    "totalProducts": 18,
    "threshold": 0.7,
    "detectedCategories": ["dress", "heels", "bag"]
  }
}
```

### How It Works
1. **YOLOv8 Detection**: Detect fashion items in image (bounding boxes)
2. **Crop & Extract**: Crop each detected item and extract CLIP embedding
3. **Category Mapping**: Map YOLO labels to product categories
4. **Parallel Search**: Search for similar products for each detected item
5. **Grouped Results**: Return products grouped by detected item

### Use Cases
- "Shop this outfit" functionality
- Lookbook image search
- Multi-item product discovery
- Fashion influencer image analysis

---

## 3️⃣ Multi-Image Composite Search (NEW - Unique Feature)

**Purpose**: Mix and match attributes from multiple images using natural language prompts.

### Endpoints
- `POST /api/search/multi-image` - Main endpoint (recommended)
- `POST /api/search/multi-vector` - Advanced with explicit attribute weights

### When to Use
- Want color from one image, texture from another
- Mix style of one item with pattern of another
- Cross-image attribute blending
- Natural language attribute specification
- Advanced fashion discovery with precise control

### Request (Main Endpoint)
```bash
curl -X POST http://localhost:3000/api/search/multi-image \
  -F "images=@red_dress.jpg" \
  -F "images=@leather_jacket.jpg" \
  -F "prompt=I want the red color from the first image with the leather texture from the second" \
  -F "limit=20" \
  -F "rerankWeights={\"vectorWeight\":0.6,\"attributeWeight\":0.3,\"priceWeight\":0.1}"
```

### Parameters (Main Endpoint)
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `images` | File[] | ✓ | 1-5 image files (order matters!) |
| `prompt` | String | ✓ | Natural language description |
| `limit` | Number | | Max results (default: 50) |
| `rerankWeights` | JSON | | Ranking weights (see below) |

### Rerank Weights Structure
```json
{
  "vectorWeight": 0.6,      // Vector similarity importance (0-1)
  "attributeWeight": 0.3,   // Attribute match importance (0-1)
  "priceWeight": 0.1,       // Price relevance importance (0-1)
  "recencyWeight": 0.0      // Recency importance (0-1)
}
```
**Default**: `0.6 / 0.3 / 0.1 / 0.0`

### Example Use Cases

#### ✅ Cross-Image Color + Texture
```bash
curl -X POST http://localhost:3000/api/search/multi-image \
  -F "images=@red_dress.jpg" \
  -F "images=@leather_jacket.jpg" \
  -F "prompt=Red color from first, leather texture from second"
```

#### ✅ Style Mixing
```bash
curl -X POST http://localhost:3000/api/search/multi-image \
  -F "images=@vintage_coat.jpg" \
  -F "images=@modern_blazer.jpg" \
  -F "prompt=Vintage style from first with modern fit like second, under $200"
```

#### ✅ Pattern + Silhouette
```bash
curl -X POST http://localhost:3000/api/search/multi-image \
  -F "images=@floral_dress.jpg" \
  -F "images=@aline_skirt.jpg" \
  -F "prompt=Floral pattern from image 1 with A-line silhouette from image 2"
```

#### ✅ Material + Color + Style
```bash
curl -X POST http://localhost:3000/api/search/multi-image \
  -F "images=@silk_blouse.jpg" \
  -F "images=@navy_pants.jpg" \
  -F "images=@professional_blazer.jpg" \
  -F "prompt=Silk material from first, navy color from second, professional style from third"
```

### Response
```json
{
  "results": [
    {
      "id": "prod_789",
      "name": "Burgundy Leather Bomber Jacket",
      "score": 0.87,
      "rerankScore": 0.91,
      "rerankBreakdown": {
        "vector": 0.52,
        "attribute": 0.27,
        "price": 0.09,
        "recency": 0.03
      },
      "price": 189.99,
      "brand": "StyleCo",
      "category": "jackets",
      "imageUrl": "https://cdn.example.com/jacket.jpg"
    }
  ],
  "total": 147,
  "tookMs": 234,
  "explanation": "Found products matching burgundy color (image 0) with distressed leather texture (image 1)"
}
```

### How It Works (5-Phase Pipeline)

#### Phase 1: Intent Understanding
- Send images + prompt to Gemini AI
- Parse natural language to extract:
  - Which attributes from which images
  - Price constraints
  - Style preferences
  - Category filters

#### Phase 2: Per-Image DNA Extraction
- Generate CLIP embeddings for each image
- Extract per-attribute embeddings:
  - Global (overall appearance)
  - Color
  - Texture
  - Material
  - Style
  - Pattern

#### Phase 3: Composite Query Builder
- Blend embeddings based on intent weights
- Build OpenSearch filters from constraints
- Prepare multi-vector search configuration

#### Phase 4: Smart Search (Multi-Vector)
- Parallel kNN queries per attribute
- Union candidates across attributes
- Weighted re-ranking based on importance

#### Phase 5: Intelligent Ranking
- Apply intent-aware reranking
- Consider vector similarity
- Match specific attributes mentioned
- Factor in price/recency if specified
- Return score breakdown

---

## 🎯 Feature Comparison

| Aspect | Normal Search | YOLO Detection | Multi-Image Composite |
|--------|---------------|----------------|----------------------|
| **Input Images** | 1 | 1 | 1-5 |
| **Prompt Required** | ❌ | ❌ | ✓ |
| **Item Detection** | ❌ | ✓ (YOLOv8) | ❌ |
| **Attribute Mixing** | ❌ | ❌ | ✓ |
| **Intent Parsing** | ❌ | ❌ | ✓ (Gemini AI) |
| **Result Grouping** | Single list | Per detected item | Single ranked list |
| **Use Case** | Find similar | Shop the look | Custom attribute mix |
| **Complexity** | Simple | Medium | Advanced |
| **Response Time** | ~50ms | ~300ms | ~200ms |

---

## 🚀 Quick Start Examples

### Scenario 1: Find Similar Products
**Goal**: Find products similar to a dress I like

**Use**: Normal Search (`/api/search/image`)
```bash
curl -X POST http://localhost:3000/api/search/image \
  -F "image=@my_dress.jpg" \
  -F "limit=20"
```

---

### Scenario 2: Shop an Outfit
**Goal**: I have a lookbook image with dress, shoes, bag - want to find products for each

**Use**: YOLO Detection (`/api/images/search`)
```bash
curl -X POST http://localhost:3000/api/images/search \
  -F "image=@lookbook.jpg" \
  -F "limit_per_item=5"
```

---

### Scenario 3: Custom Mix & Match
**Goal**: I want the red color from this dress but the leather texture from this jacket

**Use**: Multi-Image Composite (`/api/search/multi-image`)
```bash
curl -X POST http://localhost:3000/api/search/multi-image \
  -F "images=@red_dress.jpg" \
  -F "images=@leather_jacket.jpg" \
  -F "prompt=Red color from first, leather texture from second"
```

---

## 📚 Additional Documentation

- **Normal Search**: See [api-reference.md](./api-reference.md#search-api)
- **YOLO Detection**: See [image-analysis-api.md](./image-analysis-api.md)
- **Multi-Image Composite**: See [multi-vector-search.md](./multi-vector-search.md)
- **Architecture**: See [architecture.md](./architecture.md)

---

## 🔧 Technical Details

### Embeddings
- **Model**: Fashion-CLIP (ONNX)
- **Dimensions**: 512
- **Similarity**: Cosine similarity
- **Storage**: OpenSearch with HNSW indexing

### Per-Attribute Embeddings (Multi-Image Only)
- `embedding_global` - Overall appearance
- `embedding_color` - Color information
- `embedding_texture` - Surface texture
- `embedding_material` - Material type
- `embedding_style` - Style/aesthetic
- `embedding_pattern` - Patterns/prints

### YOLO Detection
- **Model**: YOLOv8 Fashion-trained
- **Categories**: 100+ fashion categories
- **Min Confidence**: 0.25 (configurable)
- **Output**: Bounding boxes + labels

### Multi-Image Intent Parsing
- **Model**: Gemini 1.5 Flash
- **Input**: Images + natural language
- **Output**: Structured intent with attribute weights
- **Features**: Cross-image references, price constraints, style preferences

---

## ❓ FAQ

### Q: Which search should I use?
- **One image, find similar**: Normal Search
- **Multiple items in one image**: YOLO Detection
- **Mix attributes from multiple images**: Multi-Image Composite

### Q: Can I use multiple images with Normal Search?
No. Normal Search accepts only one image. Use Multi-Image Composite for multiple images.

### Q: Does YOLO Detection support multiple input images?
No. It detects multiple items within ONE image. For multiple input images, use Multi-Image Composite.

### Q: What's the difference between multi-image and multi-vector endpoints?
- `/multi-image`: Automatic intent parsing from natural language
- `/multi-vector`: Manual attribute weight control (advanced users)

### Q: How do I tune ranking weights?
Pass `rerankWeights` JSON parameter:
```json
{
  "vectorWeight": 0.5,
  "attributeWeight": 0.4,
  "priceWeight": 0.1,
  "recencyWeight": 0.0
}
```

### Q: Can I combine YOLO detection with multi-image search?
Not directly. You can:
1. Use YOLO Detection to find items in an image
2. Crop detected items
3. Use cropped images in Multi-Image Composite search

---

## 🎨 Best Practices

### Normal Search
- Use high-quality reference images
- Ensure good lighting and clear view
- Works best with single-item images

### YOLO Detection
- Use images with clear item separation
- Avoid heavily cluttered backgrounds
- Good lighting improves detection accuracy
- Works with 1-10 items per image

### Multi-Image Composite
- Be specific in prompts ("first image", "second image")
- Mention exact attributes (color, texture, style, material, pattern)
- Order matters: "first image" = index 0
- Max 5 images for optimal performance
- Use natural language: "I want...", "Mix...", "Combine..."

---

## 🛠️ Implementation Status

| Feature | Status | Endpoints |
|---------|--------|-----------|
| Normal Search | ✅ Live | `/api/search/image` |
| YOLO Detection | ✅ Live | `/api/images/search` |
| Multi-Image Composite | ✅ Live | `/api/search/multi-image`, `/api/search/multi-vector` |

All features are production-ready and available now! 🚀

---

## 4️⃣ Complete My Style (Outfit Completion & Explainable Recommendations)

**Purpose**: Given a partial outfit or a product, suggest complementary items to "complete the look" with explainable, diversified recommendations.

### Endpoints
- `GET /api/products/:id/complete-style` - Complete a product page with suggested complementary items
- `POST /api/products/complete-style` - Submit an outfit (images or product ids) and receive completion suggestions

### When to Use
- You have a product page and want suggested accessories/outerwear/shoes to complete a set
- You have a partial outfit and want curated, diverse options to finish the look
- You want explainability about why each suggestion was returned

### Inputs
- `productId` (path) or `items` (body): product ids or images representing the partial outfit
- `preferences` (optional): style/vibe, price range, color constraints
- `limit` / `diversity` controls

### Example (POST)
```bash
curl -X POST http://localhost:3000/api/products/complete-style \
  -F "items=@top.jpg" \
  -F "items=@skirt.jpg" \
  -F "preferences={\"style\":\"casual\",\"maxPrice\":150}" \
  -F "limit=12"
```

### Response (summary)
```json
{
  "results": [
    {
      "id": "prod_321",
      "title": "Suede Ankle Boots",
      "score": 0.89,
      "rerankBreakdown": { "vector": 0.47, "attribute": 0.30, "price": 0.12, "diversity": 0.00 },
      "explanation": "Matches warm brown tone (top) and casual silhouette (skirt).",
      "attributeEvidence": { "color": "top:dominant_color", "style": "skirt:style_scores" }
    }
  ],
  "tookMs": 210
}
```

### How It Works (pipeline)
1. Attribute extraction: ONNX attribute models extract colors, materials, patterns and per-attribute confidences from images or product images.
2. Ensemble embeddings: Fashion-CLIP + CLIP ensemble generate global + per-attribute vectors (color, texture, style).
3. Candidate retrieval: Multi-vector per-attribute kNN + category/price filters produce diversified candidate pool.
4. Neural-ranking: XGBoost / neural ranker re-ranks candidates using combined feature vectors (similarity, attribute match, popularity, price).
5. Diversification & explainability: Apply MMR-style diversification; compute human-readable explanations and attribute evidence for each suggestion.

### Implementation notes
- Core logic: [src/lib/outfit/completestyle.ts](../src/lib/outfit/completestyle.ts#L1)
- API controllers: [src/routes/products/outfit.controller.ts](../src/routes/products/outfit.controller.ts#L1)
- Service layer: [src/routes/products/outfit.service.ts](../src/routes/products/outfit.service.ts#L1)
- Models: ONNX attribute models and ensemble weights live under `marketplace-model/`

### Best practices
- Provide product images when possible (better attribute extraction)
- Use `preferences` to guide price/style constraints
- Tune `limit` + `diversity` for broader or tighter suggestions

---
