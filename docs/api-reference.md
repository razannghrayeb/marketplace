# API Reference

This document provides detailed information about all API endpoints available in the Fashion Aggregator API.

## Base URL
```
Local Node (pnpm dev): http://localhost:4000
Docker Compose API:    http://localhost:3000
```

## Code Organization

The codebase follows a modular route structure. Each API module lives under `src/routes/<module>/` and is split into:

- `*.routes.ts` — route definitions only (mounting, middleware)
- `*.controller.ts` — HTTP handlers (request/response logic)
- `*.service.ts` — business logic (DB, search, orchestration)

Keeping services alongside routes makes modules self-contained. See `docs/architecture.md` for developer guidance and examples.

## Authentication
Authentication is currently disabled for all routes in this repository snapshot (including `/admin/*`).

If you deploy behind an auth gateway or add middleware, document that in your environment-specific runbook.

## Route Prefixes (Current)

The server mounts modules with these prefixes:

| Module | Prefix |
|--------|--------|
| Health | `/health` |
| Search | `/search` |
| Products | `/products` |
| Admin | `/admin` |
| Compare | `/api/compare` |
| Image Analysis | `/api/images` |
| Ingest Queue | `/api/ingest` |
| Wardrobe | `/api/wardrobe` |
| Labeling | `/api/labeling` |

See also: `docs/ENDPOINT_MATRIX.md` (auto-generated endpoint inventory).

## Response Format
All API responses follow a consistent JSON format:

```json
{
  "success": true,
  "data": {},
  "meta": {
    "total": 100,
    "page": 1,
    "limit": 20
  }
}
```

Error responses:
```json
{
  "success": false,
  "error": {
    "message": "Error description",
    "code": "ERROR_CODE",
    "details": {}
  }
}
```

## Features Overview

The Fashion Aggregator API provides a comprehensive suite of features for fashion e-commerce, powered by machine learning and computer vision. Here's what you can build with this platform:

### 🖼️ **Visual Fashion Intelligence**
- **Image Upload & Processing**: Upload fashion images for automatic attribute extraction
- **Fashion Attribute Detection**: AI-powered recognition of categories, colors, patterns, and materials
- **Visual Similarity Search**: Find similar fashion items using CLIP embeddings
- **Smart Categorization**: Automatic classification of fashion items into 100+ categories

### 🔍 **Advanced Search & Discovery**
- **Semantic Text Search**: Search using natural language ("red summer dress", "casual sneakers")
- **Visual Search**: Upload an image to find similar products
- **Hybrid Search**: Combine text and visual queries for precise results
- **Personalized Recommendations**: ML-powered outfit suggestions and product recommendations

### 👔 **Wardrobe Management**
- **Personal Wardrobe**: Upload and organize your fashion collection
- **Style Analysis**: Get insights about your fashion preferences
- **Outfit Suggestions**: AI-generated outfit combinations from your wardrobe
- **Gap Detection**: Identify missing wardrobe essentials

### 🎯 **Active Learning System**
- **Human-in-the-Loop**: AI flags uncertain predictions for human review
- **Labeling Interface**: Web UI for efficient manual categorization
- **Continuous Improvement**: Models learn from human corrections
- **Quality Assurance**: Maintain high accuracy through active learning

### 📊 **Analytics & Insights**
- **Fashion Trends**: Analyze popular categories, colors, and patterns
- **Price Intelligence**: Track price changes and find deals
- **Market Analysis**: Understand fashion market dynamics
- **Personalization Metrics**: Measure recommendation effectiveness

### 🔧 **Developer Features**
- **RESTful API**: Clean, consistent API design
- **Real-time Processing**: Asynchronous image processing with job tracking
- **Scalable Architecture**: Built for high-volume fashion marketplaces
- **Extensible ML Pipeline**: Easy to add new models and features

### 🏗️ **Technical Architecture**
- **ONNX Models**: Fast inference with FashionCLIP for embeddings
- **OpenSearch**: High-performance vector similarity search
- **PostgreSQL**: Robust data storage with advanced queries
- **Redis Queue**: Asynchronous job processing
- **Cloudflare R2**: Global CDN for image storage

## Technical Deep Dive

### 🤖 **Machine Learning Pipeline**

#### FashionCLIP Integration
- **Dual Encoder Architecture**: Separate text and image encoders sharing 512-dim embedding space
- **CLIP Tokenizer**: HuggingFace transformers for proper text tokenization (77-token max length)
- **Image Preprocessing**: Center crop, resize to 224×224, ImageNet normalization
- **Cosine Similarity**: Measures semantic alignment between text and images

#### Attribute Extraction Models
- **Multi-Head Classification**: Separate heads for category, pattern, material, color prediction
- **ONNX Runtime**: Optimized inference with CPU threading and graph optimization
- **Confidence Thresholding**: Active learning triggers below 70% confidence scores
- **Batch Processing**: Efficient GPU/CPU utilization for multiple images

#### Ranking & Recommendations
- **XGBoost Classifier**: Trained on user interaction data for personalization
- **Feature Engineering**: Price ratios, category compatibility, visual similarity scores
- **A/B Testing Framework**: Compare ranking algorithms and measure engagement
- **Real-time Inference**: Sub-100ms response times for recommendation serving

### 🔍 **Search & Retrieval Systems**

#### OpenSearch Integration
- **Vector Fields**: 512-dimensional float arrays for CLIP embeddings
- **Hybrid Scoring**: Combines BM25 text search with cosine similarity
- **Index Optimization**: Custom analyzers for fashion-specific terminology
- **Real-time Updates**: Streaming ingestion for new products and price changes

#### Semantic Search Processing
- **Query Expansion**: Synonym expansion ("sneakers" → "athletic shoes", "runners")
- **Entity Recognition**: Extract brands, categories, colors, sizes from natural language
- **Intent Classification**: Distinguish product search from style advice queries
- **Query Rewriting**: LLM-powered query enhancement for better results

#### Visual Search Pipeline
- **Perceptual Hashing**: dHash/pHash for duplicate detection and fast similarity
- **CLIP Embeddings**: Semantic visual understanding beyond pixel matching
- **Multi-Modal Retrieval**: Combine visual and textual features for hybrid search
- **Similarity Thresholding**: Configurable thresholds (0.7-0.9) for result quality

### 📊 **Data Processing & Analytics**

#### Price Intelligence
- **Time Series Analysis**: Track price volatility and trends over time
- **Anomaly Detection**: Statistical methods to identify unusual price movements
- **Market Positioning**: Compare prices against category averages and competitors
- **Discount Detection**: Automated identification of sales and promotions

#### Quality Analysis
- **NLP Text Analysis**: Sentiment analysis, readability scores, information completeness
- **Image Quality Metrics**: Resolution, composition, uniqueness scoring
- **Policy Analysis**: Automated parsing of return policies and shipping terms
- **Trust Scoring**: Aggregate quality signals into overall product trustworthiness

### ⚡ **Performance & Scalability**

#### Asynchronous Processing
- **Redis Queue**: Bull.js for job queuing with retry logic and dead letter queues
- **Worker Pools**: Configurable concurrency for CPU-intensive ML tasks
- **Progress Tracking**: Real-time job status updates for long-running operations
- **Error Handling**: Circuit breakers and exponential backoff for external services

#### Caching Strategy
- **Multi-Level Caching**: Redis for hot data, application-level for computed results
- **Cache Invalidation**: Event-driven cache clearing on data updates
- **Cache Warming**: Pre-populate frequently accessed data on startup
- **TTL Management**: Intelligent cache expiration based on data volatility

#### Database Optimization
- **Connection Pooling**: PgBouncer for efficient PostgreSQL connection management
- **Query Optimization**: Strategic indexing on search-heavy columns
- **Partitioning**: Time-based partitioning for large tables (price_history, search_logs)
- **Read Replicas**: Separate read/write workloads for analytics queries

### 🔒 **Security & Reliability**

#### Input Validation
- **File Upload Security**: Type validation, size limits, malware scanning
- **Rate Limiting**: Token bucket algorithm with Redis backing
- **SQL Injection Prevention**: Parameterized queries with type checking
- **XSS Protection**: Input sanitization and output encoding

#### Monitoring & Observability
- **Structured Logging**: JSON logs with correlation IDs for request tracing
- **Metrics Collection**: Prometheus metrics for latency, error rates, throughput
- **Health Checks**: Comprehensive endpoint monitoring for all services
- **Alerting**: Automated alerts for service degradation and anomalies

#### Data Integrity
- **Transactional Operations**: ACID compliance for multi-table updates
- **Referential Integrity**: Foreign key constraints and cascade operations
- **Backup Strategy**: Automated daily backups with point-in-time recovery
- **Data Validation**: Schema validation and business rule enforcement

### 🚀 **Deployment & DevOps**

#### Container Orchestration
- **Docker Images**: Multi-stage builds for optimized production images
- **Kubernetes Manifests**: Declarative deployment with rolling updates
- **Service Mesh**: Istio for traffic management and observability
- **Config Management**: Environment-based configuration with validation

#### CI/CD Pipeline
- **Automated Testing**: Unit, integration, and E2E test suites
- **Code Quality**: ESLint, Prettier, and TypeScript strict mode
- **Security Scanning**: Dependency vulnerability checks and SAST
- **Performance Testing**: Load testing with k6 and synthetic monitoring

---

## Products API

### List Products
Retrieve a paginated list of products with optional filtering.

```http
GET /products
```

#### Query Parameters
| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `page` | integer | Page number (1-based) | 1 |
| `limit` | integer | Items per page (max 100) | 20 |
| `category` | string | Filter by category | - |
| `brand` | string | Filter by brand | - |
| `vendor_ids` | string | Comma-separated vendor IDs | - |
| `min_price` | number | Minimum price in cents | - |
| `max_price` | number | Maximum price in cents | - |
| `availability` | boolean | Filter by availability | - |
| `sort` | string | Sort field (`price`, `title`, `last_seen`) | `last_seen` |
| `order` | string | Sort order (`asc`, `desc`) | `desc` |

#### Example Request
```http
GET /products?category=shoes&brand=nike&min_price=5000&max_price=20000&page=1&limit=10
```

#### Example Response
```json
{
  "success": true,
  "data": [
    {
      "id": 12345,
      "vendor_id": 1,
      "title": "Nike Air Max 90",
      "brand": "Nike",
      "category": "shoes",
      "description": "Classic Nike Air Max 90 sneakers...",
      "size": "US 9",
      "color": "White/Black",
      "currency": "USD",
      "price_cents": 12000,
      "sales_price_cents": 10000,
      "availability": true,
      "last_seen": "2026-01-17T10:30:00Z",
      "image_url": "https://example.com/image.jpg",
      "image_cdn": "https://cdn.example.com/image.jpg",
      "primary_image_id": 567,
      "return_policy": "30-day return policy"
    }
  ],
  "meta": {
    "total": 150,
    "page": 1,
    "limit": 10,
    "pages": 15
  }
}
```

### Get product by ID
Returns one product (Postgres + images). Used by the storefront product detail page.

```http
GET /products/{id}
```

#### Example Response
```json
{
  "success": true,
  "data": {
    "id": 37755,
    "title": "Example item",
    "brand": "Brand",
    "price_cents": 1999,
    "sales_price_cents": null,
    "image_cdn": "https://…",
    "images": [{ "id": 1, "url": "https://…", "is_primary": true }]
  }
}
```

**Note:** On `SERVICE_ROLE=api` hosts, this route is mounted locally (same as `SERVICE_ROLE=all` / `ml`). The storefront should call `{API_BASE}/products/{id}` — same base URL as `GET /products`.

### Get Product Facets
Retrieve available filter options for products.

```http
GET /products/facets
```

#### Example Response
```json
{
  "success": true,
  "data": {
    "categories": [
      { "value": "shoes", "count": 450 },
      { "value": "clothing", "count": 320 },
      { "value": "accessories", "count": 180 }
    ],
    "brands": [
      { "value": "Nike", "count": 120 },
      { "value": "Adidas", "count": 98 },
      { "value": "Puma", "count": 75 }
    ],
    "price_ranges": [
      { "min": 0, "max": 5000, "count": 200 },
      { "min": 5000, "max": 15000, "count": 350 },
      { "min": 15000, "max": 50000, "count": 180 }
    ],
    "vendors": [
      { "id": 1, "name": "Fashion Store A", "count": 300 },
      { "id": 2, "name": "Fashion Store B", "count": 250 }
    ]
  }
}
```

### Get Product Price History
Retrieve historical pricing data for a specific product.

```http
GET /products/{id}/price-history
```

#### Path Parameters
| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | integer | Product ID |

#### Query Parameters
| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `days` | integer | Number of days to retrieve | 30 |
| `interval` | string | Data interval (`daily`, `weekly`) | `daily` |

#### Example Request
```http
GET /products/12345/price-history?days=90&interval=daily
```

#### Example Response
```json
{
  "success": true,
  "data": {
    "product_id": 12345,
    "currency": "USD",
    "history": [
      {
        "date": "2026-01-17",
        "price_cents": 12000,
        "sales_price_cents": 10000
      },
      {
        "date": "2026-01-16",
        "price_cents": 12000,
        "sales_price_cents": null
      }
    ],
    "analytics": {
      "volatility_30d": 5.2,
      "min_price_cents": 9500,
      "max_price_cents": 12500,
      "avg_price_cents": 11200,
      "trend": "stable"
    }
  }
}
```

### Get Price Drops
Retrieve recent significant price drop events.

```http
GET /products/price-drops
```

#### Query Parameters
| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `days` | integer | Number of days to look back | 7 |
| `min_drop_percent` | number | Minimum drop percentage | 15 |
| `category` | string | Filter by category | - |
| `limit` | integer | Maximum results | 50 |

#### Example Response
```json
{
  "success": true,
  "data": [
    {
      "product_id": 12345,
      "title": "Nike Air Max 90",
      "brand": "Nike",
      "category": "shoes",
      "old_price_cents": 15000,
      "new_price_cents": 10000,
      "drop_percent": 33.33,
      "detected_at": "2026-01-17T08:00:00Z",
      "image_cdn": "https://cdn.example.com/image.jpg"
    }
  ]
}
```

---

## Search API

### Text Search
Perform intelligent text-based product search with semantic understanding.

```http
GET /search
```

#### Query Parameters
| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `q` | string | Search query (required) | - |
| `page` | integer | Page number | 1 |
| `limit` | integer | Results per page | 20 |
| `category` | string | Filter by category | - |
| `brand` | string | Filter by brand | - |
| `min_price` | number | Minimum price filter | - |
| `max_price` | number | Maximum price filter | - |
| `use_semantic` | boolean | Enable semantic search | true |

#### Example Request
```http
GET /search?q=red running shoes nike&limit=10&use_semantic=true
```

#### Example Response
```json
{
  "success": true,
  "data": {
    "query": {
      "original": "red running shoes nike",
      "normalized": "red running shoes nike",
      "entities": {
        "brands": ["Nike"],
        "categories": ["shoes", "athletic"],
        "colors": ["red"],
        "attributes": ["running"]
      },
      "intent": "product_search",
      "expanded_terms": ["red", "crimson", "scarlet", "running", "athletic", "jogging"]
    },
    "results": [
      {
        "id": 12345,
        "title": "Nike Air Zoom Pegasus 40 - Red",
        "brand": "Nike",
        "category": "shoes",
        "price_cents": 13000,
        "relevance_score": 0.95,
        "match_reasons": ["brand_match", "color_match", "category_match"],
        "image_cdn": "https://cdn.example.com/image.jpg"
      }
    ]
  },
  "meta": {
    "total": 45,
    "page": 1,
    "limit": 10,
    "processing_time_ms": 125
  }
}
```

---

## Search API

The Fashion Aggregator provides **THREE distinct search capabilities**:

1. **Text Search** - Traditional keyword + filter search
2. **Single Image Search** - Find similar products to one image
3. **Multi-Image Composite Search** - Mix attributes from multiple images (NEW)

For YOLO-based product detection ("shop the look"), see [Image Analysis API](#image-analysis-api).

### Quick Comparison

| Feature | Endpoint | Input | Best For |
|---------|----------|-------|----------|
| **Text Search** | `GET /search` | Query + filters | Keyword search, filtering |
| **Image Search** | `POST /search/image` | 1 image | "Find similar to this" |
| **Multi-Image** | `POST /search/multi-image` | 1-5 images + prompt | "Color from first, style from second" |
| **YOLO Detection** | `POST /images/search` | 1 image | "Shop this outfit" |

📚 **See [SEARCH_FEATURES_GUIDE.md](./SEARCH_FEATURES_GUIDE.md) for comprehensive comparison and examples.**

---

### Text Search
Search products using keywords and filters.

```http
GET /search
```

#### Query Parameters
| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `q` | string | Search query | - |
| `brand` | string | Filter by brand | - |
| `category` | string | Filter by category | - |
| `minPrice` | number | Minimum price | - |
| `maxPrice` | number | Maximum price | - |
| `color` | string | Filter by color | - |
| `size` | string | Filter by size | - |
| `vendor_id` | number | Filter by vendor | - |
| `limit` | integer | Max results | 20 |
| `offset` | integer | Pagination offset | 0 |

#### Example Request
```bash
curl "http://localhost:3000/api/search?q=red+dress&brand=Nike&maxPrice=15000&limit=10"
```

---

### Single Image Search
Find visually similar products using image uploads.

```http
POST /search/image
```

#### Request
- **Content-Type**: `multipart/form-data`
- **Body**: Form data with `image` file field

#### Query Parameters
| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `limit` | integer | Maximum results | 50 |

#### Example Request
```bash
curl -X POST http://localhost:3000/api/search/image \
  -F "image=@dress.jpg" \
  -F "limit=20"
```

#### Example Response
```json
{
  "results": [
    {
      "id": 12345,
      "name": "Similar Red Dress",
      "score": 0.92,
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

---

### Multi-Image Composite Search (NEW)
Mix attributes from multiple images using natural language prompts.

```http
POST /search/multi-image
```

This is the **unique feature** that enables cross-image attribute mixing with AI-powered intent parsing.

#### Request
- **Content-Type**: `multipart/form-data`
- **Body**: 
  - `images`: 1-5 image files (order matters!)
  - `prompt`: Natural language description
  - `limit`: Max results (optional)
  - `rerankWeights`: JSON object for ranking weights (optional)

#### Example Requests

**Basic Cross-Image Attributes:**
```bash
curl -X POST http://localhost:3000/api/search/multi-image \
  -F "images=@red_dress.jpg" \
  -F "images=@leather_jacket.jpg" \
  -F "prompt=I want the red color from the first image with the leather texture from the second" \
  -F "limit=20"
```

**With Custom Ranking Weights:**
```bash
curl -X POST http://localhost:3000/api/search/multi-image \
  -F "images=@vintage_coat.jpg" \
  -F "images=@modern_blazer.jpg" \
  -F "prompt=Vintage style from first with modern fit like second, under $200" \
  -F "rerankWeights={\"vectorWeight\":0.5,\"attributeWeight\":0.4,\"priceWeight\":0.1}"
```

#### Rerank Weights
```json
{
  "vectorWeight": 0.6,      // Vector similarity (default: 0.6)
  "attributeWeight": 0.3,   // Attribute matches (default: 0.3)
  "priceWeight": 0.1,       // Price relevance (default: 0.1)
  "recencyWeight": 0.0      // Recency (default: 0.0)
}
```

#### Example Response
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
      "category": "jackets"
    }
  ],
  "total": 147,
  "tookMs": 234,
  "explanation": "Found products matching burgundy color (image 0) with distressed leather texture (image 1)"
}
```

#### How It Works (5-Phase Pipeline)
1. **Intent Understanding** - Gemini AI parses natural language + images
2. **DNA Extraction** - Extract per-attribute embeddings (color, texture, style, etc.)
3. **Composite Query** - Build weighted query from intent
4. **Multi-Vector Search** - Parallel kNN + union + weighted re-rank
5. **Intent-Aware Ranking** - Final ranking with vector + attributes + price + recency

---

### Advanced Multi-Vector Search
For power users who want explicit control over attribute weights.

```http
POST /search/multi-vector
```

#### Request Body
- `images`: 1-5 image files
- `prompt`: Text description
- `attributeWeights`: JSON with explicit weights per attribute
- `explainScores`: Boolean - return per-attribute breakdown
- `limit`: Max results (optional)

#### Example Request
```bash
curl -X POST http://localhost:3000/api/search/multi-vector \
  -F "images=@dress1.jpg" \
  -F "images=@dress2.jpg" \
  -F "prompt=Elegant evening wear" \
  -F "attributeWeights={\"color\":0.4,\"style\":0.4,\"texture\":0.2}" \
  -F "explainScores=true"
```

#### Example Response
```json
{
  "results": [
    {
      "id": "prod_456",
      "name": "Navy Silk Evening Gown",
      "score": 0.88,
      "rerankScore": 0.92,
      "attributeScores": {
        "global": 0.85,
        "color": 0.91,
        "texture": 0.87,
        "material": 0.89,
        "style": 0.90,
        "pattern": 0.78
      },
      "price": 299.99
    }
  ],
  "total": 89,
  "tookMs": 187
}
```

---

## Image Analysis API

For YOLO-based product detection and "shop the look" functionality.

### Visual Product Search (Shop the Look)
Upload an image to detect fashion items and find similar products for each.

```http
POST /images/search
```

#### Request
- **Content-Type**: `multipart/form-data`
- **Body**: Form data with `image` file field

#### Query Parameters
| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `confidence` | number | Detection confidence (0-1) | 0.25 |
| `threshold` | number | Similarity threshold (0-1) | 0.7 |
| `limit_per_item` | number | Max products per detected item | 10 |
| `filter_category` | boolean | Filter by detected category | true |
| `store` | boolean | Store image in R2 | false |

#### Example Request
```bash
curl -X POST http://localhost:3000/api/images/search \
  -F "image=@outfit.jpg" \
  -F "confidence=0.25" \
  -F "limit_per_item=10"
```

#### Example Response
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
      }
    ],
    "count": 2
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
            "price": 79.99
          }
        ],
        "count": 10
      }
    ],
    "totalProducts": 18
  }
}
```

---
        "similarity_score": 0.92,
        "clip_similarity": 0.89,
        "visual_features": ["similar_color", "similar_shape", "similar_texture"],
        "image_cdn": "https://cdn.example.com/image.jpg",
        "price_cents": 12000
      }
    ]
  },
  "meta": {
    "total_matches": 15,
    "processing_time_ms": 450
  }
}
```

---

## Recommendations API

### Get Similar Products
Get ML-powered recommendations for similar products.

```http
GET /products/{id}/recommendations
```

#### Path Parameters
| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | integer | Product ID |

#### Query Parameters
| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `limit` | integer | Maximum recommendations | 10 |
| `use_ml_ranking` | boolean | Use ML model for ranking | true |
| `min_score` | number | Minimum recommendation score | 0.5 |

#### Example Response
```json
{
  "success": true,
  "data": {
    "source_product": {
      "id": 12345,
      "title": "Nike Air Max 90",
      "category": "shoes"
    },
    "recommendations": [
      {
        "id": 12346,
        "title": "Nike Air Max 95",
        "similarity_score": 0.89,
        "rank_position": 1,
        "ranking_source": "model",
        "match_features": {
          "style_score": 0.92,
          "color_score": 0.85,
          "clip_similarity": 0.88,
          "price_ratio": 1.1
        },
        "image_cdn": "https://cdn.example.com/image.jpg",
        "price_cents": 13500
      }
    ]
  },
  "meta": {
    "model_version": "v2.1",
    "ranking_time_ms": 89,
    "total_candidates": 150
  }
}
```

### Batch Recommendations
Get recommendations for multiple products at once.

```http
POST /products/recommendations/batch
```

#### Request Body
```json
{
  "product_ids": [12345, 12346, 12347],
  "limit": 5,
  "use_ml_ranking": true
}
```

#### Example Response
```json
{
  "success": true,
  "data": {
    "12345": {
      "recommendations": [...],
      "meta": {...}
    },
    "12346": {
      "recommendations": [...],
      "meta": {...}
    }
  }
}
```

---

## Style Completion API

### Complete Style/Outfit
Get complementary items to complete an outfit or style.

```http
POST /products/{id}/complete-style
```

#### Request Body
```json
{
  "context": {
    "occasion": "casual",
    "season": "summer",
    "style_preference": "minimalist"
  },
  "exclude_categories": ["shoes"],
  "price_range": {
    "min_cents": 2000,
    "max_cents": 15000
  },
  "limit": 8
}
```

#### Example Response
```json
{
  "success": true,
  "data": {
    "base_product": {
      "id": 12345,
      "title": "White T-Shirt",
      "category": "tops"
    },
    "completions": [
      {
        "category": "bottoms",
        "suggestions": [
          {
            "id": 12350,
            "title": "Blue Jeans",
            "compatibility_score": 0.91,
            "style_match": "casual",
            "color_harmony": 0.88
          }
        ]
      },
      {
        "category": "accessories",
        "suggestions": [...]
      }
    ]
  }
}
```

---

## Product Comparison API

### Compare Products
Perform detailed quality and feature comparison between products.

```http
POST /api/compare
```

#### Request Body
```json
{
  "product_ids": [12345, 12346, 12347],
  "analysis_type": "full"
}
```

#### Example Response
```json
{
  "success": true,
  "data": {
    "winner": {
      "product_id": 12345,
      "title": "Nike Air Max 90",
      "overall_score": 89,
      "verdict": "recommended"
    },
    "comparison": {
      "12345": {
        "overall_score": 89,
        "quality_level": "green",
        "scores": {
          "text_quality": 92,
          "price_analysis": 85,
          "image_quality": 90,
          "policy_score": 88
        },
        "strengths": ["detailed_description", "competitive_pricing", "good_return_policy"],
        "weaknesses": ["limited_size_info"]
      },
      "12346": {
        "overall_score": 75,
        "quality_level": "yellow",
        "scores": {...},
        "strengths": [...],
        "weaknesses": [...]
      }
    },
    "recommendations": [
      {
        "type": "price_alert",
        "message": "Product 12345 is priced 15% below market average"
      }
    ]
  }
}
```

### Get Product Quality Analysis
Get detailed quality analysis for a single product.

```http
GET /api/compare/quality/{id}
```

#### Example Response
```json
{
  "success": true,
  "data": {
    "product_id": 12345,
    "overall_score": 89,
    "quality_level": "green",
    "confidence": 92,
    "analysis": {
      "text_quality": {
        "score": 92,
        "word_count": 245,
        "has_fabric_info": true,
        "has_size_guide": true,
        "has_care_instructions": true,
        "red_flags": []
      },
      "price_analysis": {
        "score": 85,
        "market_position": "normal",
        "volatility_level": "stable",
        "discount_frequency": "occasional"
      },
      "image_analysis": {
        "score": 90,
        "has_multiple_angles": true,
        "image_quality": "high",
        "originality_score": 95
      }
    },
    "computed_at": "2026-01-17T10:30:00Z"
  }
}
```

---

## Image Management API

### List Product Images
Get all images associated with a product.

```http
GET /products/{id}/images
```

#### Example Response
```json
{
  "success": true,
  "data": [
    {
      "id": 567,
      "product_id": 12345,
      "r2_key": "products/12345/image1.jpg",
      "cdn_url": "https://cdn.example.com/image1.jpg",
      "is_primary": true,
      "p_hash": "a1b2c3d4e5f6",
      "created_at": "2026-01-15T09:00:00Z"
    }
  ]
}
```

### Upload Product Image
Upload a new image for a product.

```http
POST /products/{id}/images
```

#### Request
- **Content-Type**: `multipart/form-data`
- **Body**: Form data with `image` file field

#### Example Response
```json
{
  "success": true,
  "data": {
    "id": 568,
    "product_id": 12345,
    "cdn_url": "https://cdn.example.com/new-image.jpg",
    "is_primary": false,
    "embedding_generated": true
  }
}
```

### Set Primary Image
Set an image as the primary image for a product.

```http
PUT /products/{id}/images/{imageId}/primary
```

### Remove Image
Delete an image from a product.

```http
DELETE /products/{id}/images/{imageId}
```

---

## Health API

```http
GET /health/ready
GET /health/live
```

- `/health/ready`: dependency-aware readiness probe
- `/health/live`: lightweight liveness probe

---

## Wardrobe API

Most wardrobe endpoints require a user identity. In the current implementation, user identity is read from:

- `x-user-id` header, or
- `user_id` query/body field.

### Endpoint Inventory

```http
GET    /api/wardrobe/items
POST   /api/wardrobe/items
GET    /api/wardrobe/items/{id}
PATCH  /api/wardrobe/items/{id}
DELETE /api/wardrobe/items/{id}
GET    /api/wardrobe/profile
POST   /api/wardrobe/profile/recompute
GET    /api/wardrobe/gaps
GET    /api/wardrobe/recommendations
GET    /api/wardrobe/compatibility/score
GET    /api/wardrobe/compatibility/{itemId}
POST   /api/wardrobe/compatibility/precompute
POST   /api/wardrobe/outfit-suggestions
POST   /api/wardrobe/complete-look
POST   /api/wardrobe/backfill-embeddings
GET    /api/wardrobe/similar/{itemId}
```

### Create Wardrobe Item

```http
POST /api/wardrobe/items
```

Request: multipart/form-data (or JSON without image)

```bash
curl -X POST "http://localhost:3000/api/wardrobe/items" \
  -H "x-user-id: 42" \
  -F "name=Black Linen Shirt" \
  -F "brand=Zara" \
  -F "source=manual" \
  -F "category_id=12" \
  -F "pattern_id=1" \
  -F "material_id=3" \
  -F "image=@shirt.jpg"
```

Example response:

```json
{
  "success": true,
  "item": {
    "id": 901,
    "user_id": 42,
    "name": "Black Linen Shirt",
    "brand": "Zara",
    "category_id": 12
  }
}
```

### Get Wardrobe Recommendations

```http
GET /api/wardrobe/recommendations
```

Example request:

```bash
curl "http://localhost:3000/api/wardrobe/recommendations?user_id=42&limit=20&price_min=2000&price_max=15000&include_gaps=true&include_style=true&include_compat=true"
```

Example response:

```json
{
  "success": true,
  "recommendations": [
    {
      "product_id": 12345,
      "score": 0.89,
      "reason": "gap+style"
    }
  ]
}
```

### Complete Look Suggestions

```http
POST /api/wardrobe/complete-look
```

Example request:

```json
{
  "user_id": 42,
  "item_ids": [901, 910],
  "limit": 10
}
```

Example response:

```json
{
  "success": true,
  "suggestions": [
    {
      "product_id": 7788,
      "score": 0.86,
      "slot": "footwear"
    }
  ]
}
```

---

## Admin API

Authentication note: current code does not enforce admin auth middleware yet.

### Endpoint Inventory

```http
POST /admin/products/{id}/hide
POST /admin/products/{id}/unhide
POST /admin/products/{id}/flag
POST /admin/products/{id}/unflag
POST /admin/products/hide-batch
GET  /admin/products/flagged
GET  /admin/products/hidden
GET  /admin/products/{id}/duplicates

GET  /admin/canonicals
GET  /admin/canonicals/{id}
POST /admin/canonicals/merge
POST /admin/canonicals/{id}/detach/{productId}

POST /admin/jobs/{type}/run
GET  /admin/jobs/schedules
GET  /admin/jobs/metrics
GET  /admin/jobs/history

GET  /admin/stats

GET  /admin/reco/label
POST /admin/reco/label
POST /admin/reco/label/batch
GET  /admin/reco/labels
GET  /admin/reco/stats
```

### Flag Product

```http
POST /admin/products/{id}/flag
```

Example request:

```json
{
  "reason": "suspected duplicate listing"
}
```

Example response:

```json
{
  "success": true,
  "message": "Product flagged"
}
```

### Merge Canonical Groups

```http
POST /admin/canonicals/merge
```

Example request:

```json
{
  "sourceId": 120,
  "targetId": 55
}
```

Example response:

```json
{
  "success": true,
  "movedCount": 8
}
```

### Trigger Background Job

```http
POST /admin/jobs/{type}/run
```

Valid `type` values:

- `nightly-crawl`
- `price-snapshot`
- `canonical-recompute`
- `cleanup-old-data`

Example response:

```json
{
  "success": true,
  "message": "Job nightly-crawl queued"
}
```

### Save Recommendation Label

```http
POST /admin/reco/label
```

Example request:

```json
{
  "baseProductId": 111,
  "candidateProductId": 222,
  "label": "good",
  "labelScore": 9,
  "labelerId": "ops-admin",
  "notes": "Great style match"
}
```

Example response:

```json
{
  "success": true,
  "labelId": 3456,
  "message": "Label 'good' saved for 111 -> 222"
}
```

Legacy examples like `/admin/opensearch` and `/admin/ranker` are removed from this reference because they are not mounted in the current code.

---

## Error Codes

| Code | Description |
|------|-------------|
| `PRODUCT_NOT_FOUND` | Product with specified ID does not exist |
| `INVALID_IMAGE_FORMAT` | Uploaded image format not supported |
| `SEARCH_QUERY_EMPTY` | Search query parameter is required |
| `COMPARISON_LIMIT_EXCEEDED` | Too many products for comparison (max 10) |
| `ML_SERVICE_UNAVAILABLE` | Machine learning service is temporarily unavailable |
| `RATE_LIMIT_EXCEEDED` | API rate limit exceeded |
| `VALIDATION_ERROR` | Request validation failed |
| `INTERNAL_SERVER_ERROR` | Unexpected server error |

## Rate Limits

- **Default**: 100 requests per minute per IP
- **Search endpoints**: 60 requests per minute per IP
- **Image upload**: 20 requests per minute per IP
- **ML predictions**: 40 requests per minute per IP

Rate limit headers are included in responses:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1642341600
```

## SDKs and Libraries

### JavaScript/Node.js
```bash
npm install @fashion-aggregator/api-client
```

### Python
```bash
pip install fashion-aggregator-client
```

### Example Usage
```javascript
import { FashionApi } from '@fashion-aggregator/api-client';

const api = new FashionApi('http://localhost:4000');

// Search for products
const results = await api.search.text({ q: 'red sneakers', limit: 10 });

// Get recommendations
const recommendations = await api.products.getRecommendations(12345);

// Upload image for search
const imageResults = await api.search.image({ image: fileBuffer });
```

