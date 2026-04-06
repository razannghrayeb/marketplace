# Implementation Status — Updated March 2026

> **Purpose:** Authoritative ground-truth of what is implemented in code, what is missing, and known issues.
> Re-audit routes when adding major features.

---

## Runtime & Routing

- Default port: `4000` (`PORT` env var, fallback in `src/config.ts`)
- **OpenSearch:** `ensureIndex()` runs when `NODE_ENV !== "test"` (see `src/server.ts`). Tests skip index creation.
- **Feature overview (user-facing):** **`docs/FEATURES.md`**

### Active route mounts in `src/server.ts`

| Mount path | Router file |
|------------|-------------|
| `/metrics` | `src/routes/metrics/index.ts` |
| `/health` | `src/routes/health/index.ts` |
| `/search` | `src/routes/search/index.ts` |
| `/products` | `src/routes/products/index.ts` |
| `/admin` | `src/routes/admin/index.ts` |
| `/api/compare` | `src/routes/compare/index.ts` |
| `/api/images` | `src/routes/products/image-analysis.controller.ts` |
| `/api/ingest` | `src/routes/ingest/ingest.routes.ts` |
| `/api/wardrobe` | `src/routes/wardrobe/wardrobe.routes.ts` |
| `/api/tryon` | `src/routes/tryon/tryon.routes.ts` |
| `/api/labeling` | `src/routes/labeling/labeling.routes.ts` |
| `/api/auth` | `src/routes/auth/auth.routes.ts` |
| `/api/cart` | `src/routes/cart/cart.routes.ts` |
| `/api/favorites` | `src/routes/favorites/favorites.routes.ts` |

---

## Auth & User System — COMPLETE ✓

Implemented in `src/routes/auth/`.

| Method | Endpoint | Notes |
|--------|----------|-------|
| POST | `/api/auth/signup` | bcrypt (12 rounds), returns access + refresh JWTs |
| POST | `/api/auth/login` | validates `is_active`, updates `last_login` |
| POST | `/api/auth/refresh` | validates refresh token type; returns new token pair |
| POST | `/api/auth/logout` | body `{ refresh_token }` — blacklists refresh token until expiry |
| GET | `/api/auth/me` | requires `requireAuth` middleware |
| PATCH | `/api/auth/me` | update email or password; prevents duplicate emails |

**Missing / gaps:**
- No email verification flow
- No password reset / forgot-password flow
- JWT secret defaults to `"change-me-in-production"` — must be overridden in env

---

## Cart — COMPLETE ✓

Implemented in `src/routes/cart/`. All routes require `requireAuth`.

| Method | Endpoint | Notes |
|--------|----------|-------|
| GET | `/api/cart` | Returns items with joined product data + total price |
| POST | `/api/cart` | Upserts on conflict (increments quantity) |
| PATCH | `/api/cart/:productId` | quantity=0 removes the item |
| DELETE | `/api/cart/:productId` | Remove single item |
| DELETE | `/api/cart/clear` | Delete all items for user |

**Missing / gaps:**
- No checkout / payment flow — cart exists but there is no order creation
- No `cart_items` table migration in the `/db/migrations/` directory (relies on table being created separately)
- No stock/availability enforcement on add-to-cart

---

## Favorites — COMPLETE ✓

Implemented in `src/routes/favorites/`. All routes require `requireAuth`.

| Method | Endpoint |
|--------|----------|
| GET | `/api/favorites` |
| POST | `/api/favorites/toggle` |
| GET | `/api/favorites/check/:productId` |
| POST | `/api/favorites/check` (batch) |

---

## Products — COMPLETE ✓

| Method | Endpoint | Notes |
|--------|----------|-------|
| GET | `/products` | List/filter with pagination |
| GET | `/products/facets` | Brand/category/price facets |
| GET | `/products/search` | Text search |
| POST | `/products/search/image` | CLIP image search |
| GET | `/products/price-drops` | Recent price drops |
| GET | `/products/:id/price-history` | Historical price data |
| GET | `/products/:id/similar` | Legacy CLIP candidate generator |
| GET | `/products/:id/recommendations` | XGBoost ML ranked recommendations |
| POST | `/products/recommendations/batch` | Batch recommendations |
| GET | `/products/:id/complete-style` | Outfit completion suggestions |
| GET | `/products/:id/style-profile` | Style profile for product |
| POST | `/products/complete-style` | Outfit completion from body (preferred: `product_id`; fallback: `product`) |
| GET | `/products/:id/images` | List product images |
| POST | `/products/:id/images` | Upload product image |
| PUT | `/products/:id/images/:imageId/primary` | Set primary image |
| DELETE | `/products/:id/images/:imageId` | Delete image |

---

## Search — COMPLETE ✓

Mounted at `/search` (not `/api/search`).

| Method | Endpoint | Notes |
|--------|----------|-------|
| GET | `/search` | NLP pipeline: intent classification, entity extraction, negation, conversational context, spell correction, Arabizi |
| POST | `/search/image` | Single-image CLIP + BLIP hybrid search |
| POST | `/search/multi-image` | Up to 5 images + Gemini intent → 6 per-attribute embeddings |
| POST | `/search/multi-vector` | Explicit per-attribute weight control |
| GET | `/search/autocomplete` | Query autocomplete suggestions |
| GET | `/search/trending` | Trending queries (last 7 days from log) |
| GET | `/search/popular` | All-time popular queries |
| GET | `/search/session/:sessionId` | Conversational session context |
| GET | `/search/prompt-templates` | Multi-image prompt templates |
| POST | `/search/prompt-analyze` | Analyze and improve a search prompt |
| GET | `/search/prompt-suggestions` | Prompt writing suggestions by type |

---

## Image Analysis — COMPLETE ✓

Mounted at `/api/images`.

| Method | Endpoint |
|--------|----------|
| GET | `/api/images/status` |
| GET | `/api/images/labels` |
| POST | `/api/images/analyze` |
| POST | `/api/images/search` (shop-the-look) |
| POST | `/api/images/search/selective` |
| POST | `/api/images/search/url` |
| POST | `/api/images/detect` |
| POST | `/api/images/detect/url` |
| POST | `/api/images/detect/batch` |

---

## Wardrobe — COMPLETE incl. Feature #6 ✓

All routes require `requireAuth`. Mounted at `/api/wardrobe`.

### Core CRUD
- GET/POST `/api/wardrobe/items`
- GET/PATCH/DELETE `/api/wardrobe/items/:id`
- GET `/api/wardrobe/profile`, POST `/api/wardrobe/profile/recompute`
- GET `/api/wardrobe/gaps`
- GET `/api/wardrobe/recommendations`
- GET `/api/wardrobe/compatibility/score`
- GET `/api/wardrobe/compatibility/:itemId`
- POST `/api/wardrobe/compatibility/precompute`
- POST `/api/wardrobe/outfit-suggestions`
- POST `/api/wardrobe/complete-look`
- POST `/api/wardrobe/backfill-embeddings`
- GET `/api/wardrobe/similar/:itemId`

### Feature #6: Wardrobe Enhancements
- GET/PUT `/api/wardrobe/auto-sync/settings`
- POST `/api/wardrobe/auto-sync/manual`
- POST `/api/wardrobe/analyze-photo`
- POST `/api/wardrobe/analyze-photos/batch`
- POST `/api/wardrobe/items/:id/re-analyze`
- POST `/api/wardrobe/outfit-coherence`
- POST `/api/wardrobe/outfit/:outfitId/coherence`
- POST `/api/wardrobe/layering/analyze`
- POST `/api/wardrobe/layering/suggest`
- GET `/api/wardrobe/layering/weather-check`
- GET `/api/wardrobe/compatibility/:category/learned`
- GET `/api/wardrobe/compatibility/graph`
- POST `/api/wardrobe/compatibility/learn`

---

## Virtual Try-On — COMPLETE ✓ (Feature #7)

Mounted at `/api/tryon`. Full async Vertex AI job lifecycle.

| Method | Endpoint | Notes |
|--------|----------|-------|
| POST | `/api/tryon/` | Person + garment upload; 202 pending |
| POST | `/api/tryon/from-wardrobe` | Person + wardrobe_item_id; 202 pending |
| POST | `/api/tryon/from-product` | Person + product_id; 202 pending |
| POST | `/api/tryon/batch` | 1 person + up to 5 garments; 202 array |
| GET | `/api/tryon/history` | Paginated history + optional `?status=` |
| GET | `/api/tryon/:id` | Poll job status/result |
| DELETE | `/api/tryon/:id` | Delete job + R2 cleanup |
| POST | `/api/tryon/:id/cancel` | Cancel pending job |
| POST | `/api/tryon/:id/save` | Bookmark completed result |
| GET | `/api/tryon/saved` | List saved results |
| PATCH | `/api/tryon/saved/:savedId` | Update note/is_favorite |
| DELETE | `/api/tryon/saved/:savedId` | Remove bookmark |
| GET | `/api/tryon/service/health` | GCP credential + project check |

**Required env vars:**
- `GCLOUD_PROJECT` (required)
- `TRYON_LOCATION` (default: `us-central1`)
- `TRYON_MODEL` (default: `virtual-try-on-001` in `config.ts`; override per Google model ID)
- `TRYON_TIMEOUT` (default: `60000` ms)
- `GOOGLE_APPLICATION_CREDENTIALS` (if not using ADC)

---

## Compare — COMPLETE ✓

Mounted at `/api/compare`. Multi-dimensional quality analysis + verdicts.

Key endpoints: `POST /api/compare`, `GET /quality/:id`, `POST /analyze-text`,
`GET /price/:id`, `GET /baseline/:category`, `POST /admin/compute-baselines`,
`GET /tooltips`.

---

## Admin — COMPLETE ✓ (protected)

Mounted at `/admin`. **`requireAuth` + `requireAdmin`** are applied in `src/routes/admin/index.ts`.

Covers: product moderation (hide/unhide/flag/unflag/batch), canonical groups,
job queue management, stats, recommendation labeling.

---

## Ingest — COMPLETE ✓

- `POST /api/ingest/image` — upload + queue for embedding/detection processing
- `GET /api/ingest/:jobId` — check job status

BullMQ worker (`src/workers/ingest.worker.ts`): download from R2 → validate → CLIP
embedding → YOLO detection → crop detected items → create wardrobe items in DB.

---

## Labeling — COMPLETE ✓

Active-learning labeling system for recommendation training data.
Endpoints: tasks list, assign, submit, skip, stats, queue, category/pattern/material data.

---

## Metrics & Health — COMPLETE ✓

- `GET /metrics` — Prometheus-format scrape endpoint
- `GET /health/live` and `GET /health/ready` — liveness/readiness probes

---

## Database Migrations

| File | Status |
|------|--------|
| `001_recommendation_training.sql` | Applied |
| `002_product_image_detections.sql` | Applied |
| `003_digital_twin_phase0.sql` | Applied — creates `users`, `wardrobe_items`, `outfits`, etc. |
| `004_ingest_jobs.sql` | Applied |
| `005_labeling_system.sql` | Applied |
| `006_add_products_image_urls.sql` | Applied |
| `006_feature6_wardrobe_enhancements.sql` | Applied (use this, not the `_no_vector` variant) |
| `006_feature6_wardrobe_enhancements_no_vector.sql` | Fallback — only if pgvector not available |
| `007_virtual_tryon.sql` | Applied |

**Migration numbering conflict:** Three files share the `006_` prefix. This will cause
ordering ambiguity in any automated runner. Rename `006_add_products_image_urls.sql`
to `005b_` or `006a_` to resolve.

**Missing migrations (tables used in code but no migration files found):**
- `cart_items` table (used by `cart.service.ts`)
- `price_history` table (referenced in products)
- `product_quality_scores` and `product_price_analysis` (referenced in compare services)
- `recommendation_impressions` logging table (001 migration covers this)
- `user_preferences` / `user_profiles` (no extended user data beyond `users`)

---

## Known Issues & Gaps

### Critical (block production)

| # | Issue | File | Description |
|---|-------|------|-------------|
| 1 | Weak JWT default secret | `src/config.ts` | `"change-me-in-production"` is the fallback. Set `JWT_SECRET` in env. |
| 2 | Missing `cart_items` migration | `db/migrations/` | Table used in code but no migration file may exist on fresh deploys. |

### High Priority (affect functionality)

| # | Issue | Description |
|---|-------|-------------|
| 3 | No checkout / order flow | Cart is complete but no checkout, payment, or order tables. |
| 4 | No email verification | Users can register with unverified emails. |
| 5 | Migration `006_` numbering conflict | Three files share the same numeric prefix — fix ordering for automated runners. |

### Medium Priority (UX / feature gaps)

| # | Issue | Description |
|---|-------|-------------|
| 6 | Try-on env / DB setup | Vertex project, R2, and `007_virtual_tryon.sql` must be correct or users see 503 / errors (see `FEATURES.md`). |
| 7 | No price-drop user alerts | Price history tracked but no notification system. |
| 8 | No A/B testing framework | Ranking experiments can't be measured. |
| 9 | No automated model retraining | XGBoost model is static once trained. |
| 10 | Thin automated test coverage | Prefer integration tests for search and auth paths. |
| 11 | No password-reset flow | Users cannot recover a forgotten password. |

---

## Environment Variables — Complete Reference

```env
# Server
PORT=4000
CORS_ORIGIN=*
NODE_ENV=production

# Database (Supabase)
DATABASE_URL=postgresql://...
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_STORAGE_BUCKET=product-images

# OpenSearch
OS_NODE=http://opensearch-node:9200
OS_INDEX=products
OS_USERNAME=
OS_PASSWORD=

# Redis
REDIS_URL=redis://0.0.0.0:6379
REDIS_HOST=0.0.0.0
REDIS_PORT=6379
REDIS_PASSWORD=

# Cloudflare R2
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=fashion-images
R2_PUBLIC_BASE_URL=https://your-domain.r2.dev

# JWT
JWT_SECRET=<strong-random-secret>
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# CLIP
CLIP_MODEL_TYPE=fashion-clip
CLIP_SIMILARITY_THRESHOLD=0.7
CLIP_DUPLICATE_THRESHOLD=0.92

# Vertex AI (Virtual Try-On)
GCLOUD_PROJECT=
TRYON_LOCATION=us-central1
TRYON_MODEL=virtual-try-on-001
TRYON_TIMEOUT=60000
GOOGLE_APPLICATION_CREDENTIALS=

# External ML services
RANKER_API_URL=http://0.0.0.0:8000
GEMINI_API_KEY=
```

---

## Admin Dashboard (`apps/dashboard-admin`)

A Next.js 13 admin frontend. Currently covers:
- Overview with charts
- Product listing and management
- Vendor listing
- Price monitoring charts
- Data freshness monitoring

Missing from dashboard: wardrobe management, try-on job monitoring,
user management, auth, order management.

---

*Last updated: March 2026 — aligned with `FEATURES.md` and current `server.ts`*
