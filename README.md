# Fashion Aggregator API

A sophisticated fashion marketplace API that aggregates products from multiple vendors and provides advanced search, comparison, recommendation, wardrobe management, and virtual try-on capabilities powered by machine learning.

## Features

### Core Commerce
- **User Auth**: JWT-based signup/login with access + refresh tokens (bcrypt, 15m access / 7d refresh)
- **Cart**: Full cart management with quantity tracking and price totals
- **Favorites**: Toggle and batch-check product favorites
- **Product Aggregation**: Multi-vendor catalog with real-time price tracking

### Search & Discovery
- **Semantic Text Search**: CLIP embeddings + OpenSearch hybrid, NLP pipeline with intent classification, entity extraction, negation handling, Arabizi support, conversational context, spell correction
- **Single Image Search**: Fashion-CLIP visual similarity (ONNX, 512-dim)
- **Multi-Image Composite Search**: Up to 5 images + natural language prompt → Gemini intent parsing → 6 per-attribute embeddings → weighted re-ranking
- **Multi-Vector Search**: Explicit per-attribute weight control (color, style, texture, material, pattern)
- **Shop-the-Look Image Analysis**: YOLOv8 item detection → per-item CLIP search → grouped results
- **Autocomplete & Trending**: Query suggestions, trending queries, popular queries

### Recommendations & Comparison
- **ML Ranking**: XGBoost-based recommendations with feature engineering; heuristic fallback
- **Outfit Completion**: Category + color harmony rules; wardrobe + marketplace combined results
- **Product Comparison**: Multi-dimensional quality analysis (text, price, image, policy); letter grades; baselines
- **Price Intelligence**: Historical tracking, anomaly detection, price-drop events

### Wardrobe & Styling
- **Wardrobe CRUD**: Full item management with CLIP embeddings and image storage
- **Style Profile**: Computed dominant colors, patterns, aesthetic clusters
- **Gap Analysis**: Missing essentials by category and occasion
- **Compatibility Engine**: Static rules + learned rules from real user outfit data
- **Outfit Suggestions & Complete Look**
- **Auto-Sync from Purchases**: Payment integration detection syncs purchases to wardrobe
- **Hybrid Image Recognition**: YOLO + Gemini Vision auto-categorizes wardrobe photos
- **Visual Coherence Scoring**: 6-dimension outfit quality (color harmony, style, balance, pattern, texture, aesthetic — 100% weighted)
- **Layering Analysis**: 6-layer system with weather validation

### Virtual Try-On
- **Vertex AI Try-On**: Google Cloud `virtual-try-on-001` (`:predict` on Vertex AI), fully managed, no GPU
- **Async Job Pattern**: 202 Accepted immediately; background processing; client polls until complete
- **Multiple Input Modes**: File upload, from wardrobe item, from product catalog, batch (up to 5 garments)
- **Full Job Lifecycle**: Pending → processing → completed/failed; cancel, delete, save/bookmark results
- **Rate Limiting**: 10 try-ons/hour per user; IP-based rate limiting on submit routes

### Operations
- **Admin Tools**: Product moderation (hide/flag/canonical), job queue management, labeling workflow
- **Active Learning Labeling**: Task queue, assign, submit, skip for recommendation training data
- **Ingest Pipeline**: BullMQ worker — download → validate → CLIP + YOLO → crop → wardrobe items
- **Prometheus Metrics**: Request counts and durations via `/metrics`
- **Health Checks**: `/health/live` and `/health/ready`

---

## Architecture

### Technology Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 18+ + TypeScript (ES2022, CommonJS) |
| Framework | Express.js |
| Database | PostgreSQL via Supabase (`pg` pool + pgvector) |
| Search | OpenSearch (HNSW k-NN + BM25 hybrid) |
| Cache/Queue | Redis (ioredis) + BullMQ |
| Image Storage | Cloudflare R2 (S3-compatible) + Supabase Storage |
| ML (local) | ONNX Runtime (Fashion-CLIP), YOLOv8 client, BLIP client |
| ML (cloud) | Gemini 1.5 Flash (intent/attrs), Vertex AI (virtual try-on), Python FastAPI (XGBoost) |
| Frontend | Next.js 13 admin dashboard (`apps/dashboard-admin`) |

### Source Structure

```
src/
├── config.ts              # All env var mapping (DATABASE_URL, SUPABASE_*, JWT_*, etc.)
├── server.ts              # Express app factory — mounts all routers + middleware
├── index.ts               # Entry point
├── types.ts               # Core TypeScript types
├── middleware/            # auth, errorHandler, logger, metrics, rateLimit, validate
├── lib/
│   ├── core/              # pg pool, OpenSearch client
│   ├── image/             # CLIP (ONNX), BLIP, YOLOv8 client, TryOnClient, R2, processor
│   ├── search/            # semanticSearch, hybridSearch, multiVectorSearch, attributeEmbeddings
│   ├── queryProcessor/    # NLP pipeline: intent, entities, negation, conversational, autocomplete
│   ├── ranker/            # XGBoost client + feature engineering + pipeline
│   ├── compare/           # compareEngine, priceAnomaly, textQuality, verdictGenerator
│   ├── wardrobe/          # autoSync, imageRecognition, visualCoherence, learnedCompatibility, layeringOrder
│   ├── outfit/            # completeStyle logic
│   ├── prompt/            # Gemini Vision API client
│   └── scrape/            # Multi-vendor scrapers (Shopify, Everlane, Moustache, Hashtag, etc.)
└── routes/
    ├── auth/              # signup, login, refresh, me, update profile
    ├── cart/              # get, add, update, remove, clear
    ├── favorites/         # list, toggle, check, batch-check
    ├── products/          # listing, search, recommendations, outfit, images, price history
    ├── search/            # text, image, multi-image, multi-vector, autocomplete, trending
    ├── wardrobe/          # full CRUD + Feature #6 endpoints
    ├── tryon/             # full Virtual Try-On lifecycle
    ├── compare/           # quality/price/text comparison
    ├── admin/             # moderation, canonicals, jobs, labeling
    ├── ingest/            # image upload + queue
    ├── labeling/          # active learning task queue
    ├── health/            # live/ready probes
    └── metrics/           # Prometheus scrape
```

---

## API Endpoints (summary)

### Auth (`/api/auth`)
```
POST  /api/auth/signup          # register; returns access + refresh tokens
POST  /api/auth/login           # login; returns access + refresh tokens
POST  /api/auth/refresh         # exchange refresh token
GET   /api/auth/me              # current user profile (JWT required)
PATCH /api/auth/me              # update email or password (JWT required)
```

### Cart & Favorites (JWT required)
```
GET/POST/PATCH/DELETE  /api/cart
POST                   /api/favorites/toggle
GET                    /api/favorites
```

### Search (`/search`)
```
GET   /search                        # enhanced text search
POST  /search/image                  # single-image CLIP search
POST  /search/multi-image            # multi-image + Gemini composite
POST  /search/multi-vector           # explicit per-attribute weights
GET   /search/autocomplete
GET   /search/trending
GET   /search/popular
```

### Products (`/products`)
```
GET  /products                       # list with filters & pagination
GET  /products/:id/recommendations   # XGBoost ML recommendations
GET  /products/:id/complete-style    # outfit completion
POST /products/search/image          # image search via products router
```

### Image Analysis (`/api/images`)
```
POST /api/images/search              # shop-the-look detect + find similar
POST /api/images/detect              # YOLO detection only
POST /api/images/detect/batch        # batch YOLO (up to 10 images)
POST /api/images/search/url          # find similar from image URL
```

### Wardrobe (`/api/wardrobe`, JWT required)
```
GET/POST               /api/wardrobe/items
GET/PATCH/DELETE       /api/wardrobe/items/:id
POST                   /api/wardrobe/outfit-suggestions
POST                   /api/wardrobe/analyze-photo       # YOLO + Gemini auto-categorize
POST                   /api/wardrobe/outfit-coherence    # 6-dim coherence score
POST                   /api/wardrobe/layering/analyze    # layering order analysis
GET                    /api/wardrobe/compatibility/graph  # learned compat graph
```

### Virtual Try-On (`/api/tryon`)
Submit routes expect a numeric **`x-user-id`** header and/or **`user_id`** in the multipart body (same value). Browser example: `examples/styleai-web/marketplaceTryOn.ts`; dashboard helper: `apps/dashboard-admin/src/lib/api/tryon.ts`.
```
POST /api/tryon/                     # file upload; returns 202
POST /api/tryon/from-wardrobe        # from wardrobe item
POST /api/tryon/batch                # up to 5 garments
GET  /api/tryon/:id                  # poll job status
GET  /api/tryon/history
GET  /api/tryon/saved
```

### Admin (`/admin`)
```
POST /admin/products/:id/hide|unhide|flag|unflag
GET  /admin/products/flagged|hidden
GET  /admin/stats
POST /admin/jobs/:type/run
```

---

## Machine Learning Pipeline

### Models in Use

| Model | Purpose | Serving |
|-------|---------|---------|
| Fashion-CLIP (ONNX) | 512-dim image/text embeddings | ONNX Runtime (in-process) |
| YOLOv8 DeepFashion2 | Fashion item detection + bounding boxes | External HTTP client |
| BLIP | Image captioning for semantic descriptions | External HTTP client |
| XGBoost | Re-ranking recommendations | Python FastAPI (`RANKER_API_URL`) |
| Gemini 1.5 Flash | Intent parsing, attribute extraction, query rewriting | Google API (`GEMINI_API_KEY`) |
| Vertex AI Try-On | Virtual garment try-on | GCP REST API (`GCLOUD_PROJECT`) |

### Ranking Pipeline
```
Product ID → CLIP kNN (top 200) + Text kNN (top 200) →
Union + Deduplicate →
Feature Engineering (style, color, price, pHash similarity) →
XGBoost Score → Fallback: heuristic weights →
Top-N sorted results → Log impressions
```

---

## Getting Started

### Prerequisites
- Node.js 18+ with pnpm
- Docker and Docker Compose (for OpenSearch, Redis, Postgres)
- Python 3.8+ (for ML training scripts)
- Google Cloud project (for Virtual Try-On)

### Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Start infrastructure
docker-compose up -d

# 3. Run database migrations
npx tsx scripts/run-migration.ts

# 4. Download ML models
pnpm models:download

# 5. Create OpenSearch index
pnpm recreate-index

# 6. Start development server
pnpm dev
```

### Environment Configuration

Create a `.env` file:
```env
# Server
PORT=4000
CORS_ORIGIN=*
NODE_ENV=production
SERVICE_ROLE=all # all | api | ml
ML_SERVICE_URL=   # Optional: URL of ML service for client/service discovery

# Database (Supabase Postgres — single DATABASE_URL required)
DATABASE_URL=postgresql://postgres:<password>@db.<project>.supabase.co:5432/postgres
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# OpenSearch
OS_NODE=http://0.0.0.0:9200
OS_INDEX=products

# Redis
REDIS_URL=redis://0.0.0.0:6379

# Cloudflare R2
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=fashion-images
R2_PUBLIC_BASE_URL=https://your-domain.r2.dev

# JWT (must set a strong secret in production)
JWT_SECRET=<strong-random-secret>
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# CLIP
CLIP_MODEL_TYPE=fashion-clip

# Gemini
GEMINI_API_KEY=

# Vertex AI (Virtual Try-On)
GCLOUD_PROJECT=
GOOGLE_APPLICATION_CREDENTIALS=   # path to service account key (or use ADC)

# XGBoost Ranker (Python FastAPI)
RANKER_API_URL=http://0.0.0.0:8000
```

---

## Google Cloud Run Deployment (Recommended)

This repository now includes a Cloud Build pipeline that deploys the same image into two Cloud Run services:
- `marketplace-ml` with `SERVICE_ROLE=ml`
- `marketplace-api` with `SERVICE_ROLE=api` and `ML_SERVICE_URL=<ml-service-url>`

Files added for Cloud Run:
- `cloudbuild.cloudrun.yaml` — build + push + deploy both services
- `.env.example` — safe environment variable template
- `docs/deploy-cloud-run.md` — complete step-by-step deployment runbook

Quick deploy command:

```bash
gcloud builds submit \
  --config cloudbuild.cloudrun.yaml \
  --substitutions _REGION=us-central1,_REPOSITORY=marketplace,_SERVICE_API=marketplace-api,_SERVICE_ML=marketplace-ml,_IMAGE_NAME=marketplace
```

See `docs/deploy-cloud-run.md` for full setup (APIs, Artifact Registry, Secret Manager, IAM, verification).

---

## Render Split Deployment (API + ML)

Use two Render Web Services from the same repository with Docker:

### Docker Build Configuration

Both services use the same Dockerfile. The build has 3 stages:
1. **model-downloader** (Python) — Downloads ML models from HuggingFace
2. **builder** (Node) — Compiles TypeScript
3. **production** (Node) — Final runtime image with compiled code + models

**Critical:** Pass `HF_TOKEN` during build so models can be downloaded:

#### For Render Docker builds:
- In Render service settings, add environment variable during build:
  - Key: `HF_TOKEN`
  - Value: your HuggingFace token (from https://huggingface.co/settings/tokens)
  - Mark as "Secret" (not normal env var — it should not be in the runtime)

The Dockerfile will use this token to download models from `razangh/fashion-models` repo.

If model download fails (invalid token or repo inaccessible), the build will **fail early** with error: `ML models missing! Model download failed or HF_TOKEN invalid.`

### Service Configuration

1. **API Service**
- Runtime: Docker
- Health Check Path: `/health/live`
- Environment:
  - `SERVICE_ROLE=api`
  - `ML_SERVICE_URL=https://<your-ml-service>.onrender.com`
  - Plus: DATABASE_URL, SUPABASE_*, R2_*, etc.

2. **ML Service**
- Runtime: Docker
- Health Check Path: `/health/live`
- Environment:
  - `SERVICE_ROLE=ml`
  - Plus: DATABASE_URL, SUPABASE_*, OS_NODE, OS_USERNAME, OS_PASSWORD, R2_*, REDIS_URL, etc.

**Note:** HF_TOKEN should ONLY be set during build (Dockerfile ARG), NOT in runtime env vars.

### Behavior by role:
- `SERVICE_ROLE=api` mounts auth/cart/favorites/compare/admin/tryon plus health/metrics.
- `SERVICE_ROLE=ml` mounts search/products/image-analysis/wardrobe/ingest/labeling plus health/metrics.
- `SERVICE_ROLE=all` keeps current monolith behavior.

When `SERVICE_ROLE=api`, ML routes are transparently proxied to `ML_SERVICE_URL`.

---

## Development Scripts

```bash
pnpm dev                      # Development server (nodemon)
pnpm build                    # Compile TypeScript
pnpm start                    # Production server

pnpm recreate-index           # Rebuild OpenSearch k-NN index
pnpm reindex-embeddings       # Regenerate all CLIP embeddings
pnpm migrate:run              # Run a specific migration
pnpm backfill-r2              # Upload existing images to R2
pnpm worker                   # Start BullMQ ingest worker

pnpm models:download          # Download ONNX model files
pnpm docs:endpoints           # Auto-generate endpoint matrix from routes
```

---

## Database Migrations

Migrations live in `db/migrations/`. Run them in order:

```
001_recommendation_training.sql     — recommendation_impressions, recommendation_labels
002_product_image_detections.sql    — product_image_detections
003_digital_twin_phase0.sql         — users, wardrobe_items, outfits, outfit_items
004_ingest_jobs.sql                 — ingest_jobs
005_labeling_system.sql             — label_queue, labels
005a_cart_items.sql                 — cart_items table
006a_add_products_image_urls.sql    — image_urls column on products
006b_feature6_wardrobe_enhancements.sql  — wardrobe enhancement tables (pgvector required)
006c_feature6_wardrobe_enhancements_no_vector.sql — wardrobe fallback without pgvector
007_virtual_tryon.sql               — tryon_jobs, tryon_saved_results
008_refresh_token_blacklist.sql     — refresh token revoke/denylist
```

For first-time production setup, use one command:

```bash
pnpm migrate:bootstrap
```

This applies `db/schema.sql` first, then all SQL files in `db/migrations/` in lexical order.

You can preview the execution plan without applying SQL:

```bash
DRY_RUN=1 pnpm migrate:bootstrap
```

---

## Known Issues (see `docs/IMPLEMENTATION_STATUS.md` for full list)

1. `src/server.ts:36` has `process.env.NODE_ENV = "test"` hardcoded — must be removed before production
2. Admin routes have **no authentication middleware** — any unauthenticated user can call them
3. No `POST /api/auth/logout` endpoint — refresh tokens cannot be revoked
4. No checkout/payment/order flow — cart exists but stops before checkout
5. Missing `cart_items` table migration file

---

## Additional Documentation

| File | Contents |
|------|---------|
| `docs/IMPLEMENTATION_STATUS.md` | Full audit of what is done, missing, and known issues |
| `docs/api-reference.md` | Detailed endpoint documentation |
| `docs/architecture.md` | Architecture deep-dive |
| `docs/ml-models.md` | ML model details and evaluation |
| `docs/deployment.md` | Production deployment guide |
| `docs/deploy-cloud-run.md` | Google Cloud Run deployment runbook |
| `FEATURE_ANALYSIS.md` | In-depth feature analysis with strengths, weaknesses, grades |
| `docs/ENDPOINT_MATRIX.md` | Auto-generated endpoint matrix |
| `postman_collection.json` | Postman collection for API testing |

---

**Fashion Aggregator API** — Powered by AI, built for scale.
