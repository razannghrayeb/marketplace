# Implementation Status (March 2026)

This document summarizes what is currently implemented in code and now reflected in documentation.

## Runtime and Routing Snapshot

- Local dev default: `http://localhost:4000` (from `PORT` fallback in `src/config.ts`)
- Docker Compose API mapping: `http://localhost:3000`
- Current route mounts in `src/server.ts`:
  - `/health`
  - `/search`
  - `/products`
  - `/admin`
  - `/api/compare`
  - `/api/images`
  - `/api/ingest`
  - `/api/wardrobe`
  - `/api/labeling`

## Implemented APIs (High-Level)

### Search
- `GET /search`
- `POST /search/image`
- `POST /search/multi-image`
- `POST /search/multi-vector`

### Image Analysis
- `GET /api/images/status`
- `GET /api/images/labels`
- `POST /api/images/analyze`
- `POST /api/images/search`
- `POST /api/images/search/url`
- `POST /api/images/detect`
- `POST /api/images/detect/url`
- `POST /api/images/detect/batch`

### Ingest Queue
- `POST /api/ingest/image`
- `GET /api/ingest/:jobId`

### Compare
- `POST /api/compare`
- `GET /api/compare/quality/:productId`
- `POST /api/compare/analyze-text`
- `GET /api/compare/price/:productId`
- `GET /api/compare/baseline/:category`
- `POST /api/compare/admin/compute-baselines`
- `GET /api/compare/tooltips`

### Wardrobe
- CRUD for wardrobe items
- Profile and recompute profile
- Gap analysis
- Recommendations
- Compatibility scoring and precompute
- Outfit suggestion and complete look
- Embedding backfill and similar item lookup

### Admin
- Product moderation (`hide`, `unhide`, `flag`, `unflag`, batch hide)
- Duplicate review endpoints
- Canonical management endpoints
- Job operations and metrics endpoints
- Recommendation labeling endpoints

## Ranker Behavior

- Ranker API client defaults to `RANKER_API_URL=http://localhost:8000`
- Ranker pipeline retries model calls with configurable attempts/delay
- If model is unavailable, pipeline falls back to heuristic scoring
- Heuristic fallback combines vector + rule features via fixed weights

## Notable Current-State Clarifications

- Search routes are mounted at `/search` (not `/api/search`)
- Product routes are mounted at `/products` (not `/api/products`)
- Health checks are `/health/live` and `/health/ready`
- Config expects `DATABASE_URL` (not split `PG_*` variables)
- Current code does not enforce auth middleware on admin routes

## Documentation Updated in This Pass

- `docs/api-reference.md`
- `docs/QUICK_REFERENCE.md`
- `docs/deployment.md`
- Search/product endpoint prefixes corrected across docs (`/search`, `/products`)

## Suggested Next Documentation Work

- Add an endpoint matrix generated from route sources (to prevent drift)
- Add request/response examples for Wardrobe and Admin APIs
- Add a dedicated runbook for ranker service training and deployment
- Add an auth roadmap section once middleware is introduced
