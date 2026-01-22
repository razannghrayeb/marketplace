# Fashion Aggregator API

A sophisticated fashion marketplace API that aggregates products from multiple vendors and provides advanced search, comparison, and recommendation capabilities powered by machine learning.

## 🚀 Features

### Core Functionality
- **Product Aggregation**: Multi-vendor product catalog with real-time price tracking
- **Intelligent Search**: Semantic search powered by CLIP embeddings and OpenSearch
- **Image Search**: Visual similarity search using CLIP neural networks
- **Product Comparison**: AI-powered product quality analysis and comparison
- **Recommendations**: ML-driven similar product suggestions using XGBoost
- **Price Monitoring**: Historical price tracking and anomaly detection
- **Style Completion**: Outfit completion and complementary item suggestions

### AI/ML Capabilities
- **CLIP Embeddings**: 512-dimensional image embeddings for visual search
- **Semantic Understanding**: Query intent classification and entity extraction
- **Quality Analysis**: Automated product description quality scoring
- **Price Analytics**: Market position analysis and volatility detection
- **ML Ranking**: XGBoost-based ranking with feature engineering
- **Computer Vision**: Perceptual hashing (pHash) for duplicate detection

## 🏗️ Architecture

### Technology Stack
- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js with comprehensive middleware
- **Database**: PostgreSQL with vector support for embeddings
- **Search**: OpenSearch for full-text and vector search
- **Cache**: Redis for caching and job queues
- **Storage**: Cloudflare R2 for image storage
- **ML Models**: ONNX Runtime for CLIP, Python FastAPI for XGBoost
- **Queue**: BullMQ for background job processing

### Key Components

```
src/
├── config.ts                 # Environment configuration
├── index.ts                  # Application entry point
├── server.ts                 # Express server setup
├── types.ts                  # Core TypeScript types
├── lib/                      # Business logic libraries
│   ├── compare/              # Product comparison engine
│   ├── core/                 # Database and OpenSearch clients
│   ├── image/                # CLIP embeddings and image processing
│   ├── model/                # XGBoost training and serving
│   ├── ranker/               # ML-based ranking pipeline
│   ├── recommendations/      # Recommendation system
│   ├── search/               # Semantic search and query processing
│   └── ...
├── routes/                   # API endpoints
│   ├── products/             # Product-related endpoints
│   ├── search/               # Search endpoints
│   ├── compare/              # Comparison endpoints
│   └── admin/                # Administrative endpoints
└── middleware/               # Express middleware
```

## 📊 Database Schema

### Core Tables
- **products**: Main product catalog with metadata and pricing
- **vendors**: Store information and shipping capabilities
- **product_images**: R2 storage with CLIP embeddings and pHash
- **price_history**: Historical pricing data for trend analysis
- **product_quality_scores**: Cached quality analysis results
- **product_price_analysis**: Market position and volatility metrics

### ML/Analytics Tables
- **category_price_baselines**: Statistical baselines for price anomaly detection
- **price_drop_events**: Significant price change tracking
- **recommendation_impressions**: Training data for recommendation system
- **recommendation_labels**: User feedback for model training

## 🔍 API Endpoints

### Product Management
```
GET    /products              # List products with filters
GET    /products/facets       # Get available filters/facets
GET    /products/:id/price-history  # Price history for product
GET    /products/price-drops  # Recent price drop events
```

### Search & Discovery
```
GET    /search                # Text-based product search
POST   /search/image          # Image similarity search
GET    /products/:id/recommendations  # Similar product suggestions
POST   /products/:id/complete-style   # Outfit completion
```

### Product Comparison
```
POST   /api/compare           # Compare multiple products
GET    /api/compare/quality/:id      # Individual product quality analysis
POST   /api/compare/compute-baselines # Recompute price baselines
```

### Image Management
```
GET    /products/:id/images   # List product images
POST   /products/:id/images   # Upload new image
PUT    /products/:id/images/:imageId/primary # Set primary image
DELETE /products/:id/images/:imageId         # Remove image
```

### Administration
```
GET    /admin/opensearch      # OpenSearch cluster status
POST   /admin/opensearch/reindex     # Reindex products
GET    /admin/ranker          # ML ranker service status
GET    /admin/jobs            # Background job status
```

## 🧠 Machine Learning Pipeline

### 1. Image Embeddings (CLIP)
- **Model**: OpenAI CLIP ViT-B/32 (ONNX format)
- **Dimensions**: 512-dimensional embeddings
- **Usage**: Visual similarity search, duplicate detection
- **Processing**: Real-time embedding generation on image upload

### 2. Ranking Model (XGBoost)
- **Type**: Gradient boosting classifier
- **Features**: Style scores, price ratios, similarity metrics, category encoding
- **Training**: Automated retraining on user interaction data
- **Serving**: FastAPI microservice with fallback heuristics

### 3. Quality Analysis
- **Text Analysis**: Description completeness, attribute extraction, red flags
- **Price Analysis**: Market position, volatility, anomaly detection
- **Image Analysis**: Originality scoring via pHash comparison
- **Output**: Comprehensive quality scores (0-100) with explanations

### 4. Semantic Search
- **Query Processing**: Intent classification, entity extraction
- **Entity Types**: Brands, categories, colors, sizes, price ranges
- **Knowledge Base**: Expandable synonym and brand dictionaries
- **Hybrid Approach**: Combines keyword and semantic matching

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ with pnpm
- Docker and Docker Compose
- Python 3.8+ (for ML components)

### Quick Start

1. **Clone and Install**
   ```bash
   git clone <repository-url>
   cd marketplace
   pnpm install
   ```

2. **Start Infrastructure**
   ```bash
   docker-compose up -d
   ```

3. **Setup Database**
   ```bash
   # Run migrations
   psql -h localhost -U postgres -d fashion -f db/schema.sql
   ```

4. **Download ML Models**
   ```bash
   pnpm run-script download-clip
   ```

5. **Initialize Search Index**
   ```bash
   pnpm run recreate-index
   ```

6. **Start Development Server**
   ```bash
   pnpm dev
   ```

### Environment Configuration

Create `.env` file with required variables:
```env
# Database
PG_HOST=localhost
PG_PORT=5432
PG_USER=postgres
PG_PASSWORD=postgres
PG_DATABASE=fashion

# OpenSearch
OS_NODE=http://localhost:9200
OS_INDEX=products

# Redis
REDIS_URL=redis://localhost:6379

# Cloudflare R2
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_access_key
R2_SECRET_ACCESS_KEY=your_secret_key
R2_BUCKET=fashion-images
R2_PUBLIC_BASE_URL=https://your-domain.r2.dev

# API
PORT=4000
CORS_ORIGIN=*
```

## 🛠️ Development

### Available Scripts

```bash
# Development
pnpm dev                    # Start development server
pnpm build                  # Build TypeScript
pnpm start                  # Start production server

# Database & Search
pnpm recreate-index         # Rebuild OpenSearch index
pnpm reindex-embeddings     # Regenerate CLIP embeddings
pnpm migrate:canonicals     # Run canonical migrations

# ML & Data
pnpm backfill-r2           # Upload images to R2 storage
pnpm add-image-cdn-col     # Add CDN column to products
```

### Project Structure Details

#### Core Libraries (`src/lib/`)

- **`compare/`**: Product comparison engine with quality analysis
  - `compareEngine.ts`: Main comparison logic
  - `textQualityAnalyzer.ts`: Description quality scoring
  - `priceAnomalyDetector.ts`: Price analysis and market positioning
  - `verdictGenerator.ts`: Human-readable comparison results

- **`image/`**: Computer vision and image processing
  - `clip.ts`: CLIP model integration for embeddings
  - `processor.ts`: Image preprocessing and optimization
  - `r2.ts`: Cloudflare R2 storage interface
  - `utils.ts`: Image utilities and validation

- **`ranker/`**: ML-based ranking system
  - `pipeline.ts`: End-to-end ranking pipeline
  - `features.ts`: Feature engineering for ML models
  - `client.ts`: XGBoost service client with fallbacks

- **`search/`**: Intelligent search capabilities
  - `semanticSearch.ts`: Query understanding and expansion
  - `attributeExtractor.ts`: Product attribute extraction
  - `arabizi.ts`: Arabic transliteration support

#### Route Handlers (`src/routes/`)

Each route module follows the pattern:
- `*.routes.ts`: Route definitions only (mounting + middleware)
- `*.controller.ts`: HTTP request handlers (request/response, validation)
- `*.service.ts`: Business logic (database calls, orchestration)

Note: In this repository services are kept alongside their routes under `src/routes/<module>/` to make each module self-contained. For convenience and backward compatibility some `src/lib/*` entrypoints re-export service functions from the corresponding `src/routes/*` modules.

See `docs/architecture.md` for developer guidelines on adding new routes, controllers, and services.

### Testing & Quality

#### Manual Testing Scripts
```bash
# Test individual components
npx tsx scripts/test-semantic-search.ts
npx tsx scripts/test-attribute-extraction.ts
npx tsx scripts/test-query-processor.ts
```

#### Model Training
```bash
# Train XGBoost ranking model
cd src/lib/model
python train_xgb_classifier.py
```

#### Data Quality
- **Price Monitoring**: Automatic anomaly detection for suspicious pricing
- **Image Deduplication**: pHash-based duplicate image detection
- **Quality Scoring**: Automated product description quality analysis

## 📈 Performance & Scaling

### Caching Strategy
- **Redis**: Query results, embeddings, computed features
- **Application**: In-memory LRU caches for frequent operations
- **Database**: Optimized indexes on search columns

### Database Optimization
- **Indexes**: GIN indexes for full-text search, vector similarity
- **Partitioning**: Time-based partitioning for price history
- **Connection Pooling**: PostgreSQL connection pooling

### Search Performance
- **OpenSearch**: Distributed search with replicas
- **Vector Search**: Approximate nearest neighbor (ANN) search
- **Hybrid Queries**: Combined keyword and semantic search

### Background Processing
- **BullMQ**: Job queues for heavy operations
- **Workers**: Separate worker processes for ML tasks
- **Scheduling**: Automated retraining and maintenance tasks

## 🔧 Configuration

### Feature Flags
Control features via environment variables:
```env
ENABLE_ML_RANKING=true      # Use XGBoost for ranking
ENABLE_CLIP_SEARCH=true     # Enable image similarity search
ENABLE_PRICE_ALERTS=true    # Price drop notifications
ENABLE_QUALITY_ANALYSIS=true # Product quality scoring
```

### Model Configuration
```env
CLIP_MODEL_PATH=models/clip-image-vit-32.onnx
RANKER_SERVICE_URL=http://localhost:8000
EMBEDDING_BATCH_SIZE=32
QUALITY_SCORE_THRESHOLD=70
```

## 📚 Additional Resources

### Documentation Files
- [API Reference](docs/api-reference.md) - Detailed endpoint documentation
- [Deployment Guide](docs/deployment.md) - Production deployment instructions
- [ML Models Guide](docs/ml-models.md) - Machine learning components
- [Database Guide](docs/database.md) - Schema and migration details

### Key Concepts
- **Semantic Search**: Understanding user intent beyond keyword matching
- **Quality Signals**: Multi-dimensional product quality assessment
- **Visual Similarity**: CLIP-powered image understanding
- **Price Intelligence**: Market analysis and anomaly detection
- **Recommendation Systems**: Collaborative and content-based filtering

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines
- Follow TypeScript best practices
- Add tests for new features
- Update documentation for API changes
- Use semantic commit messages
- Ensure ML models are properly versioned

## 📄 License

This project is proprietary software. All rights reserved.

---

**Fashion Aggregator API** - Powered by AI, built for scale.