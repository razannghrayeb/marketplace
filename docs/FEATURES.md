# Product & platform features

**Last updated:** March 2026  

This document describes **what each feature does**, **who it is for**, **main API entry points**, and **where to read more**. It complements `api-reference.md` (full parameter lists) and `embeddings-and-search-pipelines.md` (how search uses vectors).

---

## How the API is mounted

In `src/server.ts`, search lives under **`/search`** (not `/api/search`). Catalog and image upload search also live under **`/products`**. There is **one** Node process for typical deployments (e.g. Cloud Run); older docs that describe separate “API vs ML” Render services may not apply.

| Area | Base path |
|------|-----------|
| Enhanced text + multi-image search | `/search` |
| Catalog, facets, **Discover-style image search** | `/products` |
| Shop-the-look / YOLO | `/api/images` |
| Auth, cart, favorites, compare, try-on | `/api/...` |

---

## 1. Discover & text search (semantic)

**User value:** Natural-language shopping (“red summer dress”, filters on category/brand/price).

**Flow:** Query → QueryAST (normalize, entities, intent) → OpenSearch bool (BM25 + optional kNN on `embedding`) → relevance rerank → Postgres hydration.

| Endpoint | Method | Notes |
|----------|--------|--------|
| `/search` | GET | `q` + filters; enhanced NLP path (`textSearch` in `search.service.ts`) |
| `/products/search` | GET | Title/catalog search via `fashionSearchFacade.searchBrowse` / legacy browse |

**Docs:** `text-search-architecture.md`, `embeddings-and-search-pipelines.md` §5, `SEARCH_API_COMPLETE.md`.

---

## 2. Visual search (single image)

**User value:** “Find items like this photo” (Discover upload).

**Flow:** Image → CLIP global + garment vectors, pHash, capped BLIP caption (product-type seeds), quick dominant-color hints → OpenSearch kNN on primary `embedding` → attribute similarity (color/style/pattern) + category soft signals → `computeHitRelevance` → optional pHash-related items.

| Endpoint | Method | Notes |
|----------|--------|--------|
| **`/products/search/image`** | **POST** | **Preferred for storefront**; multipart `image`; uses `fashionSearchFacade.searchImage` |
| `/search/image` | POST | Same facade; alternate mount under `/search` |

**Docs:** `embeddings-and-search-pipelines.md` §4, `image-embedding-pipeline.md` (preprocessing).

---

## 3. Multi-image & multi-vector search (power users)

**User value:** Combine several reference images + optional text prompt; or explicit attribute weights.

| Endpoint | Method | Notes |
|----------|--------|--------|
| `/search/multi-image` | POST | Multiple buffers + prompt (see `search.controller.ts`) |
| `/search/multi-vector` | POST | Weighted attribute control |

**Docs:** `SEARCH_API_COMPLETE.md`, `multi-vector-search.md`.

---

## 4. Shop the look (detection → per-item search)

**User value:** One outfit photo → detect pieces → similar products per detection.

| Endpoint | Method | Notes |
|----------|--------|--------|
| `/api/images/search` | POST | Multipart image; YOLO + similarity |
| `/api/images/search/url` | POST | Same from URL |
| `/api/images/detect` | POST | Detection only |

**Docs:** `IMPLEMENTATION_STATUS.md` (Image Analysis), `api-reference.md`.

---

## 5. Complete this look (outfit completion)

**User value:** From a product, get complementary categories (shoes, bag, etc.) with scored suggestions.

| Endpoint | Method | Notes |
|----------|--------|--------|
| `/products/:id/complete-style` | GET | Query params: `maxPerCategory`, `maxTotal`, price, brands |
| `/products/complete-style` | POST | Preferred body: `product_id` + optional `options`; fallback `product` object |
| `/products/:id/style-profile` | GET | Debug / UI profile |

**Implementation:** `outfit.controller.ts`, `outfit.service.ts`, `lib/outfit/completestyle.ts`. Optional `x-user-id` / JWT merges wardrobe-owned items when present.

---

## 6. Recommendations & similar items

**User value:** “More like this” on PDP; batch APIs for grids.

| Endpoint | Method | Notes |
|----------|--------|--------|
| `/products/:id/recommendations` | GET | XGBoost-ranked (when ranker available) |
| `/products/:id/similar` | GET | Legacy CLIP/candidate style |
| `/products/recommendations/batch` | POST | Batch |

---

## 7. Catalog, facets, price tools

| Endpoint | Method | Notes |
|----------|--------|--------|
| `/products` | GET | List + filters |
| `/products/facets` | GET | Aggregations for filters |
| `/products/:id` | GET | Detail |
| `/products/:id/images` | GET / POST | Images |
| `/products/price-drops` | GET | Promotions feed |
| `/products/:id/price-history` | GET | History |

---

## 8. Wardrobe (signed-in)

**User value:** Personal closet, embeddings for similarity, outfit suggestions, optional auto-sync from purchases.

**Auth:** JWT + routes under `/api/wardrobe` require auth (see `wardrobe.routes.ts`).

Highlights: CRUD items, profile, gaps, recommendations, `complete-look`, `outfit-suggestions`, `analyze-photo`, compatibility and layering endpoints (see `IMPLEMENTATION_STATUS.md` § Wardrobe).

Technical build details for complete-look stylist pipeline: `outfit-stylist-pipeline.md`.

---

## 9. Virtual try-on (signed-in)

**User value:** Person photo + garment → generated try-on image (Vertex AI).

**Requirements:**

- Env: `GCLOUD_PROJECT` / `GOOGLE_CLOUD_PROJECT`, Vertex access, R2 for assets
- DB: `007_virtual_tryon.sql` applied (`tryon_jobs`, etc.)
- Client: `x-user-id` or `user_id` in body (see `tryon.controller.ts`); optional `TRYON_DEMO_USER_ID` for demos

**Errors:** Global handler may return `error.code`: `TRYON_DB_NOT_MIGRATED`, `TRYON_NOT_CONFIGURED` with actionable messages.

| Endpoint | Method | Notes |
|----------|--------|--------|
| `/api/tryon` | POST | Multipart person + garment |
| `/api/tryon/from-wardrobe`, `/from-product` | POST | Alternate sources |
| `/api/tryon/:id` | GET | Poll job |
| `/api/tryon/history`, `/saved` | GET | Lists |

---

## 10. Compare

**User value:** Side-by-side analysis for selected product IDs.

| Endpoint | Method |
|----------|--------|
| `/api/compare` | POST `{ product_ids: [...] }` |

---

## 11. Cart & favorites (signed-in)

Standard e-commerce helpers: `/api/cart`, `/api/favorites` — no checkout pipeline (cart is storage only until orders exist).

---

## 12. Auth

`/api/auth/signup`, `/login`, `/refresh`, `/me`, **`/logout`** — JWT access + refresh. **`POST /api/auth/logout`** with `{ refresh_token }` blacklists that refresh token (see `auth.service.ts` + migration `008_refresh_token_blacklist.sql` when applied). No email verification or password reset yet.

---

## 13. Admin, ingest, labeling, metrics

- **`/admin`** — moderation and ops (**protected** with `requireAuth` + `requireAdmin` in code; ensure deploy uses real admin users).
- **`/api/ingest`** — image ingest jobs + worker pipeline.
- **`/api/labeling`** — active learning for recommendation labels.
- **`/metrics`**, **`/health/*`** — ops.

---

## Frontend integration checklist

1. Set **`NEXT_PUBLIC_API_URL`** (or equivalent) to the deployed API origin (no trailing slash).
2. **Discover image search:** `POST` multipart to **`/products/search/image`**.
3. **Semantic text:** `GET /search?q=...` with filters as query params where supported.
4. **Try-on:** send **`x-user-id`** header matching logged-in user; poll **`GET /api/tryon/:id`**.
5. **Complete style:** `GET /products/:id/complete-style`; handle `{ success, data }` and `{ success: false, error: { message } }`.

---

## Related documentation

| Topic | Document |
|--------|-----------|
| Vectors & search internals | `embeddings-and-search-pipelines.md` |
| Text query graph | `text-search-architecture.md` |
| Full endpoint spec | `api-reference.md` |
| Implementation truth table | `IMPLEMENTATION_STATUS.md` |
| Doc index | `INDEX.md` |
