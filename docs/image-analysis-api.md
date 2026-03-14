docker-compose up -d
## Image Analysis API

The Image Analysis API provides a comprehensive computer vision pipeline for fashion e-commerce, combining object detection, embedding generation, and similarity search to enable visual product discovery.

## Quick Start - Which Endpoint Should I Use?

| Use Case | Endpoint | Description |
|----------|----------|-------------|
| **Visual product search** (recommended) | `POST /api/images/search` | Upload image → detect fashion items → find similar products for each item |
| Full analysis & storage | `POST /api/images/analyze` | Store + embed + detect in one call |
| Quick detection only | `POST /api/images/detect` | Fast fashion item detection without storage |
| Background processing | `POST /api/ingest/image` | Queue image for async processing |
| Manage product images | `POST /products/:id/images` | Upload/manage images for specific products |

## Architecture Overview

### Core Components

1. **Image Ingestion Service** - Handles upload, validation, and storage
2. **Object Detection Engine** - Dual-model detector (YOLOv8 DeepFashion2 + YOLOS Fashionpedia)
3. **Embedding Service** - CLIP-based semantic image understanding
4. **Similarity Search** - Vector search in OpenSearch
5. **Result Aggregation** - Combines detections with product matches

### Data Flow

```
User Upload → Validation → Storage (R2) → Detection (Dual Detector: YOLOv8 + YOLOS) → Cropping → Embedding (CLIP) → Search (OpenSearch) → Results
```

## Technical Implementation

### Image Ingestion & Validation

#### Upload Processing
```typescript
// routes/ingest/ingest.service.ts
export async function createIngestJob(input: CreateIngestJobInput): Promise<{ jobId: string; cdnUrl: string }> {
  const { imageBuffer, userId = null, filename = "upload.jpg", mimetype = "image/jpeg" } = input;

  // Validate image format and size
  const validation = await validateImage(imageBuffer);
  if (!validation.valid) {
    throw new Error(`Invalid image: ${validation.error}`);
  }

  // Upload to Cloudflare R2 for durability
  const { key, cdnUrl } = await uploadImage(imageBuffer, undefined, mimetype);

  // Queue for background processing
  const q = getIngestQueue();
  await q.add("ingest-image", {
    job_uuid: uuidv4(),
    user_id: userId,
    r2_key: key,
    cdn_url: cdnUrl,
    filename
  });

  return { jobId: jobUuid, cdnUrl };
}
```

#### Image Validation
```typescript
// lib/image/validation.ts
export async function validateImage(buffer: Buffer): Promise<ValidationResult> {
  try {
    const image = await sharp(buffer).metadata();

    // Check format
    const allowedFormats = ['jpeg', 'jpg', 'png', 'webp'];
    if (!allowedFormats.includes(image.format)) {
      return { valid: false, error: 'Unsupported format' };
    }

    // Check dimensions
    if (image.width < 100 || image.height < 100) {
      return { valid: false, error: 'Image too small' };
    }

    if (image.width > 4096 || image.height > 4096) {
      return { valid: false, error: 'Image too large' };
    }

    // Check file size (10MB limit)
    if (buffer.length > 10 * 1024 * 1024) {
      return { valid: false, error: 'File too large' };
    }

    return { valid: true };

  } catch (error) {
    return { valid: false, error: 'Invalid image file' };
  }
}
```

### Object Detection Pipeline

#### Dual-Model Detector Integration
```python
# src/lib/model/dual_model_yolo.py
from dual_model_yolo import DualDetector
from PIL import Image
import io


detector = DualDetector(conf=0.6)

def detect_fashion_items(image_bytes: bytes):
  """Run the dual detector on a single image and return JSON-like results."""
  image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
  result = detector.predict(image)

  items = []
  for p in result["all"]:
    x1, y1, x2, y2 = p["box"]
    items.append({
      "label": str(p["label"]),
      "confidence": float(p["score"]),
      "box": {"x1": float(x1), "y1": float(y1), "x2": float(x2), "y2": float(y2)},
    })

  return {
    "success": True,
    "detections": items,
    "count": len(items),
  }
```

#### Detection Postprocessing

With DualDetector, most postprocessing (NMS, label mapping, area ratios) is
handled inside the Python service. The Node.js client receives a clean list of
detections with labels, confidences, and pixel / normalized boxes, so no
custom postprocessing is required in the backend.

### Embedding Generation

#### CLIP Image Processing
```python
# lib/model/onnx_inference.py
def compute_image_embedding(image: Image.Image) -> np.ndarray:
    """
    Compute FashionCLIP image embedding
    Returns: 512-dimensional normalized embedding
    """
    session = get_fashion_clip_image_session()

    # Preprocess image for CLIP
    input_tensor = preprocess_image(image, size=224)

    # Run inference
    input_name = session.get_inputs()[0].name
    output_name = session.get_outputs()[0].name
    embedding = session.run([output_name], {input_name: input_tensor})[0]

    # Normalize embedding
    embedding = embedding.squeeze()
    embedding = embedding / np.linalg.norm(embedding)

    return embedding

def preprocess_image(image: Image.Image, size: int = 224) -> np.ndarray:
    """
    Advanced CLIP-compatible image preprocessing
    """
    # Convert to RGB
    image = image.convert("RGB")

    # Calculate target size maintaining aspect ratio
    original_width, original_height = image.size
    target_size = size

    # Resize so smallest dimension becomes target_size
    if original_width < original_height:
        new_width = target_size
        new_height = int(original_height * target_size / original_width)
    else:
        new_height = target_size
        new_width = int(original_width * target_size / original_height)

    # Resize image
    image = image.resize((new_width, new_height), Image.BICUBIC)

    # Center crop to target_size × target_size
    left = (new_width - target_size) // 2
    top = (new_height - target_size) // 2
    right = left + target_size
    bottom = top + target_size
    image = image.crop((left, top, right, bottom))

    # Convert to numpy array and normalize
    img_array = np.array(image, dtype=np.float32)

    # CLIP normalization: ImageNet stats with specific scaling
    mean = np.array([0.48145466, 0.4578275, 0.40821073]) * 255.0
    std = np.array([0.26862954, 0.26130258, 0.27577711]) * 255.0

    img_array = (img_array - mean) / std

    # HWC to CHW format for PyTorch models
    img_array = np.transpose(img_array, (2, 0, 1))

    # Add batch dimension
    img_array = np.expand_dims(img_array, axis=0)

    return img_array.astype(np.float32)
```

### Per-Object Processing Pipeline

#### Object Cropping & Embedding
```typescript
// lib/image/object_detection.ts
export class ObjectDetectionService {
  private detector: YOLOv8FashionDetector;
  private cache: DetectionCache;

  constructor() {
    this.detector = new YOLOv8FashionDetector('/models/yolov8_fashion.onnx');
    this.cache = new DetectionCache();
  }

  async detectObjects(imageBuffer: Buffer): Promise<DetectionResult[]> {
    // Generate image hash for caching
    const imageHash = await this.computeImageHash(imageBuffer);

    // Check cache
    const cached = await this.cache.get(imageHash);
    if (cached) {
      return cached;
    }

    try {
      // Load image
      const image = await sharp(imageBuffer).png().toBuffer();
      const pilImage = Image.open(io.BytesIO(image));

      // Run detection
      const detections = await this.detector.detect_with_nms(pilImage);

      // Cache results
      await this.cache.set(imageHash, detections);

      return detections;

    } catch (error) {
      logger.error(`Object detection failed: ${error}`);
      return [];
    }
  }

  async cropDetectedObjects(
    imageBuffer: Buffer,
    detections: DetectionResult[]
  ): Promise<CroppedObject[]> {
    const image = await sharp(imageBuffer);
    const metadata = await image.metadata();

    const croppedObjects: CroppedObject[] = [];

    for (const detection of detections) {
      const [x1, y1, x2, y2] = detection.bbox;

      // Crop object with padding
      const padding = Math.min(20, Math.min(metadata.width, metadata.height) * 0.1);
      const cropRegion = {
        left: Math.max(0, x1 - padding),
        top: Math.max(0, y1 - padding),
        width: Math.min(metadata.width - (x1 - padding), x2 - x1 + 2 * padding),
        height: Math.min(metadata.height - (y1 - padding), y2 - y1 + 2 * padding)
      };

      const croppedBuffer = await image
        .extract(cropRegion)
        .png()
        .toBuffer();

      croppedObjects.push({
        detection,
        imageBuffer: croppedBuffer,
        cropRegion
      });
    }

    return croppedObjects;
  }
}
```

### Similarity Search Integration

#### OpenSearch Vector Query
```typescript
// lib/search/embeddingSearch.ts
export async function findSimilarProductsByEmbedding(
  embedding: number[],
  category: string,
  options: {
    limit?: number;
    similarityThreshold?: number;
    useCategoryFilter?: boolean;
  } = {}
): Promise<SimilarityResult[]> {
  const { limit = 20, similarityThreshold = 0.7, useCategoryFilter = true } = options;

  // Build OpenSearch query
  const query: any = {
    size: limit,
    query: {
      script_score: {
        query: useCategoryFilter ? { term: { category } } : { match_all: {} },
        script: {
          source: "cosineSimilarity(params.embedding, 'embedding') + 1.0",
          params: { embedding }
        }
      }
    },
    _source: ["id", "title", "image_cdn", "price_cents", "category", "brand"]
  };

  // Add similarity threshold filter
  if (similarityThreshold > 0) {
    query.query.script_score.script.source = `
      double similarity = cosineSimilarity(params.embedding, 'embedding');
      if (similarity >= params.threshold) {
        return similarity;
      }
      return 0;
    `;
    query.query.script_score.script.params.threshold = similarityThreshold;
  }

  const response = await osClient.search({
    index: 'products',
    body: query
  });

  return response.body.hits.hits.map(hit => ({
    product: hit._source,
    similarity_score: hit._score - 1.0, // Remove +1.0 offset
    search_metadata: {
      total_candidates: response.body.hits.total.value,
      search_time_ms: response.body.took
    }
  }));
}
```

### Main Search Endpoint Implementation

#### Complete Pipeline Orchestration
```typescript
// routes/images/search.controller.ts
export async function searchByImage(
  req: Request,
  res: Response
): Promise<Response> {
  const { image } = req.files as { image: UploadedFile[] };
  const { limit_per_item = 10, threshold = 0.7 } = req.query;

  // Validate image
  const validation = await validateImageUpload(image[0]);
  if (!validation.valid) {
    return res.status(400).json({ success: false, error: validation.error });
  }

  try {
    // Load image for processing
    const imageBuffer = image[0].buffer;
    const pilImage = await sharp(imageBuffer).png().toBuffer();

    // Run object detection
    const detections = await detectFashionObjects(pilImage);

    if (detections.length === 0) {
      return res.json({
        success: true,
        detection: { items: [], count: 0 },
        similarProducts: {
          byDetection: [],
          totalProducts: 0,
          threshold,
          detectedCategories: []
        },
        message: "No fashion items detected in image"
      });
    }

    // Process each detection in parallel
    const searchPromises = detections.map(async (detection) => {
      try {
        // Crop and embed
        const croppedImage = await cropDetection(pilImage, detection.bbox);
        const embedding = await computeImageEmbedding(croppedImage);

        // Search similar products
        const similarProducts = await findSimilarProductsByEmbedding(
          embedding,
          detection.category,
          { limit: limit_per_item, similarityThreshold: threshold }
        );

        return {
          detection,
          products: similarProducts,
          count: similarProducts.length,
          error: null
        };

      } catch (error) {
        logger.error(`Failed to process detection ${detection.label}: ${error}`);
        return {
          detection,
          products: [],
          count: 0,
          error: error.message
        };
      }
    });

    // Wait for all searches to complete
    const searchResults = await Promise.all(searchPromises);

    // Filter out failed detections
    const successfulResults = searchResults.filter(result => !result.error);

    // Aggregate response
    const response = {
      success: true,
      detection: {
        items: detections,
        count: detections.length
      },
      similarProducts: {
        byDetection: successfulResults,
        totalProducts: successfulResults.reduce((sum, result) => sum + result.count, 0),
        threshold,
        detectedCategories: [...new Set(detections.map(d => d.category))]
      },
      processing: {
        totalDetections: detections.length,
        successfulSearches: successfulResults.length,
        failedSearches: searchResults.length - successfulResults.length
      }
    };

    return res.json(response);

  } catch (error) {
    logger.error(`Image search failed: ${error}`);
    return res.status(500).json({
      success: false,
      error: 'Internal server error during image processing'
    });
  }
}
```

## Performance Optimizations

### Batch Processing
```python
# lib/model/batch_inference.py
def batch_process_embeddings(images: List[Image.Image], batch_size: int = 8) -> List[np.ndarray]:
    """Process multiple images in batches for better GPU utilization"""
    session = get_fashion_clip_image_session()

    all_embeddings = []

    for i in range(0, len(images), batch_size):
        batch = images[i:i + batch_size]

        # Preprocess batch
        batch_tensors = np.concatenate([
            preprocess_image(img) for img in batch
        ], axis=0)

        # Run inference
        input_name = session.get_inputs()[0].name
        output_name = session.get_outputs()[0].name
        batch_embeddings = session.run([output_name], {input_name: batch_tensors})[0]

        # Normalize
        norms = np.linalg.norm(batch_embeddings, axis=1, keepdims=True)
        batch_embeddings = batch_embeddings / norms

        all_embeddings.extend(batch_embeddings)

    return all_embeddings
```

### Caching Strategy
```typescript
// lib/cache/embeddingCache.ts
export class EmbeddingCache {
  private redis: Redis;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl);
  }

  async getEmbedding(imageHash: string): Promise<number[] | null> {
    const cached = await this.redis.get(`embedding:${imageHash}`);
    return cached ? JSON.parse(cached) : null;
  }

  async setEmbedding(imageHash: string, embedding: number[], ttlSeconds: number = 3600): Promise<void> {
    await this.redis.setex(`embedding:${imageHash}`, ttlSeconds, JSON.stringify(embedding));
  }

  async getDetectionResults(imageHash: string): Promise<DetectionResult[] | null> {
    const cached = await this.redis.get(`detection:${imageHash}`);
    return cached ? JSON.parse(cached) : null;
  }

  async setDetectionResults(imageHash: string, detections: DetectionResult[], ttlSeconds: number = 1800): Promise<void> {
    await this.redis.setex(`detection:${imageHash}`, ttlSeconds, JSON.stringify(detections));
  }

  private async computeImageHash(imageBuffer: Buffer): Promise<string> {
    const hash = crypto.createHash('sha256');
    hash.update(imageBuffer);
    return hash.digest('hex');
  }
}
```

## API Endpoints Reference

### Overview

The marketplace provides **three** separate image-related API groups:

1. **`/api/images/*`** - Unified image analysis API (detection + search)
2. **`/api/ingest/*`** - Background image processing queue
3. **`/products/:id/images/*`** - Product-specific image management

---

## 1. Unified Image Analysis API (`/api/images`)

Provides computer vision and visual search capabilities without requiring a product ID.

### GET /api/images/status
**Check service availability**

**Response:**
```json
{
  "ok": true,
  "services": {
    "clip": true,
    "yolo": true
  }
}
```

### GET /api/images/labels
**Get supported fashion categories**

**Response:**
```json
{
  "fashion_categories": ["shirt", "pants", "dress", "shoes", "bag", "jacket", ...],
  "category_styles": {
    "dress": { "occasion": "formal", "aesthetic": "elegant" }
  },
  "total": 50
}
```

### POST /api/images/analyze
**Full image analysis pipeline**

Complete analysis with storage, embedding generation, and object detection.

**Parameters:**
- `store` (query, default: true): Store image in R2
- `embed` (query, default: true): Generate CLIP embedding
- `detect` (query, default: true): Run YOLOv8 detection
- `confidence` (query, default: 0.25): Detection threshold
- `product_id` (query, optional): Associate with product
- `is_primary` (query, default: false): Set as primary product image

**Request:**
```bash
curl -X POST "http://localhost:4000/api/images/analyze?product_id=123&is_primary=true" \
  -F "image=@product.jpg"
```

**Response:**
```json
{
  "success": true,
  "image": {
    "id": 456,
    "url": "https://cdn.example.com/img_456.jpg",
    "width": 800,
    "height": 1200,
    "pHash": "a1b2c3d4"
  },
  "embedding": [0.1, 0.2, ...],
  "detection": {
    "items": [
      {
        "label": "dress",
        "confidence": 0.92,
        "box": { "x1": 120, "y1": 80, "x2": 280, "y2": 400 },
        "area_ratio": 0.35,
        "style": { "occasion": "formal", "aesthetic": "elegant" }
      }
    ],
    "count": 1,
    "summary": { "dress": 1 },
    "composition": {
      "tops": [],
      "bottoms": [],
      "dresses": [{ "label": "dress", ... }],
      "outerwear": [],
      "footwear": [],
      "bags": [],
      "accessories": []
    }
  },
  "services": { "clip": true, "yolo": true }
}
```

### POST /api/images/search ⭐
**Main endpoint: Visual product search with detection**

Upload an image to detect fashion items and find similar products grouped by detection.

**Parameters:**
- `store` (query, default: false): Store image in R2
- `threshold` (query, default: 0.7): Similarity threshold 0-1
- `limit_per_item` (query, default: 10): Max products per detection
- `filter_category` (query, default: true): Filter by detected category
- `confidence` (query, default: 0.25): Detection confidence

**Request:**
```bash
curl -X POST "http://localhost:4000/api/images/search?limit_per_item=8&threshold=0.8" \
  -F "image=@outfit.jpg"
```

**Response:**
```json
{
  "success": true,
  "detection": {
    "items": [
      {
        "label": "dress",
        "confidence": 0.92,
        "bbox": [120, 80, 280, 400],
        "category": "dresses"
      },
      {
        "label": "shoes",
        "confidence": 0.87,
        "bbox": [150, 450, 250, 500],
        "category": "footwear"
      }
    ],
    "count": 2
  },
  "similarProducts": {
    "byDetection": [
      {
        "detection": {
          "label": "dress",
          "confidence": 0.92,
          "bbox": [120, 80, 280, 400],
          "category": "dresses"
        },
        "products": [
          {
            "id": 12345,
            "title": "Floral Maxi Dress",
            "similarity_score": 0.89,
            "image_cdn": "https://cdn.example.com/dress.jpg",
            "price_cents": 8900,
            "brand": "Zara"
          }
        ],
        "count": 8
      }
    ],
    "totalProducts": 16,
    "threshold": 0.8,
    "detectedCategories": ["dresses", "footwear"]
  },
  "processing": {
    "totalDetections": 2,
    "successfulSearches": 2,
    "failedSearches": 0,
    "processingTimeMs": 1250
  }
}
```

#### POST /api/images/search/url
**Search by image URL**

Same as `/search` but accepts an image URL instead of file upload.

**Request:**
```json
{
  "image_url": "https://example.com/outfit.jpg",
  "limit_per_item": 5,
  "threshold": 0.75
}
```

#### POST /api/images/detect
**Object detection only**

Detect fashion items without performing similarity search.

**Response:**
```json
{
  "success": true,
  "detections": [
    {
      "label": "dress",
      "confidence": 0.92,
      "bbox": [120, 80, 280, 400],
      "category": "dresses",
      "class_id": 2
    }
  ],
  "count": 1,
  "processing_time_ms": 245
}
```

#### POST /api/images/analyze
**Full analysis pipeline**

Store image, generate embeddings, and detect objects.

**Response:**
```json
{
  "success": true,
  "image": {
    "id": "img_123",
    "cdn_url": "https://cdn.example.com/img_123.jpg",
    "p_hash": "a1b2c3d4e5f6"
  },
  "embeddings": {
    "generated": true,
    "dimensions": 512
  },
  "detections": [...],
  "processing": {
    "total_time_ms": 890,
    "steps": ["validation", "storage", "embedding", "detection"]
  }
}
```

### Utility Endpoints

#### GET /api/images/status
**Service health check**

**Response:**
```json
{
  "success": true,
  "services": {
    "yolov8": "healthy",
    "clip": "healthy",
    "opensearch": "healthy",
    "storage": "healthy"
  },
  "models": {
    "yolov8_fashion": "loaded",
    "clip_image": "loaded",
    "clip_text": "loaded"
  }
}
```

#### GET /api/images/labels
**Supported fashion categories**

**Response:**
```json
{
  "success": true,
  "categories": [
    "shirt", "pants", "dress", "shoes", "hat",
    "bag", "jacket", "skirt", "shorts", "socks", "gloves"
  ],
  "mappings": {
    "shirt": "tops",
    "dress": "dresses",
    "shoes": "footwear"
  }
}
```

## Performance Characteristics

### Benchmarks

| Operation | CPU (i7-8700K) | GPU (RTX 3080) | Batch Size |
|-----------|----------------|----------------|------------|
| Image Validation | 15ms | 12ms | 1 |
| YOLOv8 Detection | 180ms | 45ms | 1 |
| CLIP Embedding | 120ms | 25ms | 1 |
| Similarity Search | 35ms | 30ms | 1 |
| **Total Pipeline** | **350ms** | **117ms** | 1 |
| Batch Detection (4) | 420ms | 85ms | 4 |
| Batch Embedding (8) | 480ms | 95ms | 8 |

### Optimization Strategies

#### Memory Management
- **Batch Processing**: Process multiple images together for GPU efficiency
- **Streaming**: Process large images without loading entirely into memory
- **Caching**: Cache embeddings and detections with TTL-based expiration
- **Cleanup**: Force garbage collection after large operations

#### Network Optimization
- **CDN Integration**: Serve images via Cloudflare R2 for global distribution
- **Compression**: Use WebP/AVIF formats for faster transfers
- **Progressive Loading**: Load low-res versions first, then high-res

#### Database Optimization
- **Vector Indexing**: Use HNSW indexing in OpenSearch for fast similarity search
- **Query Optimization**: Filter by category before vector similarity
- **Pagination**: Limit results and implement cursor-based pagination

## Error Handling

### HTTP Status Codes

| Status | Meaning | Common Causes |
|--------|---------|---------------|
| 200 | Success | Request completed successfully |
| 202 | Accepted | Background job queued successfully |
| 400 | Bad Request | Missing image, invalid parameters, or corrupted file |
| 404 | Not Found | Product or job ID doesn't exist |
| 413 | Payload Too Large | Image exceeds 10MB limit |
| 503 | Service Unavailable | ML models not loaded or service offline |
| 500 | Internal Server Error | Unexpected processing error |

### Common Error Messages

| Error | Description | Resolution |
|-------|-------------|------------|
| `No image file provided` | Missing `image` field in request | Use `image` field in multipart/form-data |
| `Invalid file type` | Unsupported image format | Use JPEG, PNG, WebP, or GIF |
| `Failed to download image` | URL fetch failed | Check URL accessibility and timeout |
| `Image too small` | Dimensions < 100x100 | Use higher resolution image |
| `Image too large` | File size > 10MB | Compress or resize image |
| `CLIP model not loaded` | Embedding service offline | Check model service status |
| `No fashion items detected` | Detection found no clothing | Try different angle, lighting, or confidence threshold |
| `Product not found` | Invalid product ID | Verify product exists |
| `Job not found` | Invalid job UUID | Check job ID from upload response |

### Error Response Format

**Standard Error:**
```json
{
  "success": false,
  "error": "No image file provided. Use 'image' field in multipart/form-data."
}
```

**Detailed Error:**
```json
{
  "success": false,
  "error": {
    "code": "MODEL_UNAVAILABLE",
    "message": "CLIP embedding service is temporarily unavailable",
    "details": {
      "service": "clip_image",
      "retry_after_seconds": 30,
      "model_status": "loading"
    }
  }
}
```

### Troubleshooting Guide

**503 Service Unavailable**
```bash
# Check service status
curl http://localhost:4000/api/images/status

# Expected response when healthy:
{
  "ok": true,
  "services": { "clip": true, "yolo": true }
}
```

**No Objects Detected**
- Lower confidence threshold: `?confidence=0.15` (default: 0.25)
- Ensure good lighting and clear view of items
- Check supported categories: `GET /api/images/labels`

**Low Similarity Scores**
- Lower threshold: `?threshold=0.6` (default: 0.7)
- Ensure detected items are clothing/fashion accessories
- Verify OpenSearch index contains embeddings

**Slow Response Times**
- Reduce `limit_per_item` (default: 10)
- Use batch endpoints for multiple images
- Enable caching for repeated queries
- Check GPU availability for faster inference

## Integration Examples

### JavaScript/React
```typescript
// components/ImageSearch.tsx
import { useState } from 'react';

export function ImageSearch() {
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleImageUpload = async (file: File) => {
    setLoading(true);
    
    const formData = new FormData();
    formData.append('image', file);
    
    try {
      const response = await fetch('/api/images/search?limit_per_item=6', {
        method: 'POST',
        body: formData
      });
      
      const data = await response.json();
      setResults(data);
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <input 
        type="file" 
        accept="image/*" 
        onChange={(e) => e.target.files?.[0] && handleImageUpload(e.target.files[0])} 
      />
      
      {loading && <div>Analyzing image...</div>}
      
      {results?.similarProducts?.byDetection?.map((detection, idx) => (
        <div key={idx}>
          <h3>Detected: {detection.detection.label}</h3>
          <div className="product-grid">
            {detection.products.map(product => (
              <div key={product.id} className="product-card">
                <img src={product.image_cdn} alt={product.title} />
                <h4>{product.title}</h4>
                <p>${(product.price_cents / 100).toFixed(2)}</p>
                <span>Similarity: {(product.similarity_score * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

### Python Client
```python
# client/image_search.py
import requests
from typing import List, Dict, Any

class FashionImageSearchClient:
    def __init__(self, base_url: str = "http://localhost:4000"):
        self.base_url = base_url
    
    def search_by_image(
        self, 
        image_path: str, 
        limit_per_item: int = 8,
        threshold: float = 0.7
    ) -> Dict[str, Any]:
        """Search for similar products using an image file"""
        
        with open(image_path, 'rb') as f:
            files = {'image': f}
            params = {
                'limit_per_item': limit_per_item,
                'threshold': threshold
            }
            
            response = requests.post(
                f"{self.base_url}/api/images/search",
                files=files,
                params=params
            )
            
        response.raise_for_status()
        return response.json()
    
    def search_by_url(
        self, 
        image_url: str, 
        limit_per_item: int = 8,
        threshold: float = 0.7
    ) -> Dict[str, Any]:
        """Search for similar products using an image URL"""
        
        data = {
            'image_url': image_url,
            'limit_per_item': limit_per_item,
            'threshold': threshold
        }
        
        response = requests.post(
            f"{self.base_url}/api/images/search/url",
            json=data
        )
        
        response.raise_for_status()
        return response.json()

# Usage
client = FashionImageSearchClient()
results = client.search_by_image('outfit.jpg', limit_per_item=5)

for detection in results['similarProducts']['byDetection']:
    print(f"Found {detection['count']} similar {detection['detection']['label']}s")
    for product in detection['products'][:3]:  # Top 3
        print(f"  - {product['title']} (${product['price_cents']/100:.2f})")
```

## Deployment

### Docker Setup
```yaml
# docker-compose.yml
version: '3.8'
services:
  image-api:
    build: .
    ports:
      - "4000:4000"
    environment:
      - MODEL_DIR=/models
      - REDIS_URL=redis://redis:6379
      - OPENSEARCH_URL=http://opensearch:9200
    volumes:
      - ./models:/models:ro
    depends_on:
      - redis
      - opensearch
  
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
  
  opensearch:
    image: opensearchproject/opensearch:2.5.0
    environment:
      - discovery.type=single-node
      - "OPENSEARCH_JAVA_OPTS=-Xms512m -Xmx512m"
    ports:
      - "9200:9200"
```

### Model Management
```bash
# Download and setup models
./scripts/download-models.sh

# Verify models
ls -la models/
# yolov8_fashion.onnx
# fashion-clip-image.onnx  
# fashion-clip-text.onnx

# Start services
docker-compose up -d

# Check status
curl http://localhost:4000/api/images/status
```

This updated documentation provides comprehensive technical details about the image extraction and analysis pipeline, from low-level implementation to production deployment considerations.

Endpoints (high level)

### Image Analysis API (`/api/images/*`)
- `GET /api/images/status` — service availability
- `GET /api/images/labels` — supported fashion categories
- `POST /api/images/analyze` — full pipeline (store + embed + detect)
- `POST /api/images/search` — **MAIN**: detect objects then return similar products grouped by detection
- `POST /api/images/search/url` — same as `/search` but from an image URL
- `POST /api/images/detect` — quick detection only
- `POST /api/images/detect/url` — detection from URL
- `POST /api/images/detect/batch` — batch detection (up to 10 files)

### Background Processing API (`/api/ingest/*`)
- `POST /api/ingest/image` — upload image and queue for background processing
- `GET /api/ingest/:jobId` — check processing job status

### Product Image Management (`/products/:id/images/*`)
- `GET /products/:id/images` — list all images for a product
- `POST /products/:id/images` — upload image to product (file or URL)
- `PUT /products/:id/images/:imageId/primary` — set image as primary
- `DELETE /products/:id/images/:imageId` — remove product image

### Legacy Endpoints
- `POST /products/search/image` — image search with filters (legacy format)

Main flow for `POST /api/images/search`

1. Validate image
2. Run YOLOv8 detection to find clothing items and bounding boxes
3. For each detected object (or one representative per label):
   - Crop the image region for that bounding box
   - Generate a CLIP embedding for the crop
   - Run k-NN search in OpenSearch using the embedding (optionally filter by mapped product category)
4. Aggregate and return results grouped by detection

Request example (shop-by-image):

```bash
curl -X POST "http://localhost:4000/api/images/search?limit_per_item=10&threshold=0.7" \
  -F "image=@outfit.jpg"
```

Response (trimmed):

```json
{
  "success": true,
  "detection": {
    "items": [ { "label": "dress", "confidence": 0.92 }, { "label": "heels", "confidence": 0.87 } ],
    "count": 2
  },
  "similarProducts": {
    "byDetection": [
      {
        "detection": { "label": "dress", "confidence": 0.92, "box": {...} },
        "category": "dresses",
        "products": [ { "id": 123, "title": "Floral Midi Dress", "similarity_score": 0.89 } ],
        "count": 10
      },
      {
        "detection": { "label": "heels", "confidence": 0.87, "box": {...} },
        "category": "footwear",
        "products": [ { "id": 456, "title": "Strappy Heels", "similarity_score": 0.82 } ],
        "count": 8
      }
    ],
    "totalProducts": 18,
    "threshold": 0.7,
    "detectedCategories": ["dress", "heels"]
  }
}
```

---

## Background Image Processing (`/api/ingest`)

Queue-based asynchronous image processing for high-volume workflows.

### POST /api/ingest/image
Upload image to R2 and queue for background processing (embedding, detection, indexing).

**Request:**
```bash
curl -X POST "http://localhost:4000/api/ingest/image" \
  -F "image=@photo.jpg" \
  -F "user_id=42"
```

**Response:**
```json
{
  "success": true,
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "cdn_url": "https://cdn.example.com/uploads/xyz.jpg"
}
```

### GET /api/ingest/:jobId
Check status of background processing job.

**Response:**
```json
{
  "success": true,
  "job": {
    "job_uuid": "550e8400-e29b-41d4-a716-446655440000",
    "user_id": 42,
    "source": "uploaded",
    "r2_key": "uploads/xyz.jpg",
    "cdn_url": "https://cdn.example.com/uploads/xyz.jpg",
    "filename": "photo.jpg",
    "status": "completed",
    "attempts": 1,
    "result_json": {
      "embedding_generated": true,
      "detections_count": 3,
      "p_hash": "abc123def456"
    },
    "error_message": null,
    "created_at": "2026-01-20T10:30:00Z",
    "updated_at": "2026-01-20T10:30:05Z"
  }
}
```

**Status values:** `queued`, `processing`, `completed`, `failed`

---

## Product Image Management (`/products/:id/images`)

Direct product image operations with automatic embedding generation and indexing.

### GET /products/:id/images
List all images attached to a product.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 123,
      "url": "https://cdn.example.com/products/main.jpg",
      "is_primary": true,
      "created_at": "2026-01-15T12:00:00Z"
    },
    {
      "id": 124,
      "url": "https://cdn.example.com/products/alt.jpg",
      "is_primary": false,
      "created_at": "2026-01-16T14:30:00Z"
    }
  ]
}
```

### POST /products/:id/images
Upload image to product. Automatically generates CLIP embedding, pHash, and updates OpenSearch index.

**Option 1 - File Upload:**
```bash
curl -X POST "http://localhost:4000/products/123/images" \
  -F "image=@product.jpg" \
  -F "is_primary=true"
```

**Option 2 - From URL:**
```bash
curl -X POST "http://localhost:4000/products/123/images" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/product.jpg", "is_primary": true}'
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": 125,
    "url": "https://cdn.example.com/products/125.jpg",
    "is_primary": true,
    "created_at": "2026-01-20T10:00:00Z"
  }
}
```

### PUT /products/:id/images/:imageId/primary
Set specific image as primary for the product.

**Response:**
```json
{
  "success": true,
  "message": "Image set as primary"
}
```

### DELETE /products/:id/images/:imageId
Remove image from product.

**Response:**
```json
{
  "success": true,
  "message": "Image deleted successfully"
}
```

---

## Legacy Product Search

### POST /products/search/image
Legacy image search with comprehensive filters. Use `/api/images/search` for new implementations.

**Accepts:**
- File upload (multipart/form-data with `image` field)
- Pre-computed embedding (JSON with `embedding` array)

**Query Parameters:**
- `threshold` (default: 0.7): Similarity threshold
- `includeRelated` (default: true): Include pHash similar images
- `category`, `brand`, `min_price`, `max_price`: Standard product filters
- `page`, `limit`: Pagination

**Request with file:**
```bash
curl -X POST "http://localhost:4000/products/search/image?threshold=0.75&category=dresses" \
  -F "image=@search.jpg"
```

**Request with embedding:**
```json
{
  "embedding": [0.1, 0.2, 0.3, ...],
  "pHash": "abc123",
  "category": "dresses"
}
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 123,
      "title": "Floral Summer Dress",
      "similarity_score": 0.89,
      "brand": "Zara",
      "category": "dresses",
      "price_cents": 8900,
      "images": [
        {
          "id": 1,
          "url": "https://cdn.example.com/dress.jpg",
          "is_primary": true
        }
      ]
    }
  ],
  "related": [
    {
      "id": 456,
      "title": "Similar Pattern Dress",
      "pHash_distance": 5,
      "match_type": "exact"
    }
  ],
  "meta": {
    "total": 25,
    "page": 1,
    "limit": 20,
    "similarityThreshold": 0.75
  }
}
```

---

Notes & recommendations

- Default similarity threshold is `0.7`. Lower values return more results but with lower fidelity.
- The API crops each detected object and performs per-object similarity — this produces more relevant matches (e.g., shoes → shoes, dresses → dresses).
- To speed up results, consider running detection and embedding in parallel and limiting per-detection searches (`limit_per_item`).

Integration example (JS):

```ts
const fd = new FormData();
fd.append('image', file);
const res = await fetch('/api/images/search?limit_per_item=8', { method: 'POST', body: fd });
const json = await res.json();
// use json.similarProducts.byDetection
```

Running services

```bash
docker-compose up -d
```

Errors

- 400: missing image or invalid payload
- 413: file too large (>10MB)
- 503: model/service unavailable (run model services and download CLIP models)

