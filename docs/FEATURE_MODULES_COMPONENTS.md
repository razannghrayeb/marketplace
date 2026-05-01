# Feature Modules and Components Reference

This document maps each platform feature to the modules/components that implement it.

Use this as an engineering handoff reference for:
- onboarding
- impact analysis before changes
- ownership and dependency tracing

Related docs:
- `docs/FEATURES.md` (feature behavior and API view)
- `docs/architecture.md` (module design conventions)
- `docs/SYSTEM_ARCHITECTURE_UML_USE_CASES.md` (architecture/UML/use-case view)

---

## Component Legend

- **API Module**: route/controller/service in `src/routes/*`
- **Domain Component**: reusable logic in `src/lib/*`
- **Infra Component**: DB, OpenSearch, Redis, object storage, queue, external AI

---

## 1) Discover and Semantic Text Search

**Feature goal:** Natural-language discovery with filters and relevance ranking.

- **API Modules**
  - `src/routes/search/search.controller.ts`
  - `src/routes/search/search.service.ts`
  - `src/routes/search/index.ts`
  - `src/routes/products/search.service.ts`
- **Domain Components**
  - `src/lib/queryProcessor/*` (intent, entities, spell correction, negation, conversational context)
  - `src/lib/search/semanticSearch.ts`
  - `src/lib/search/hybridsearch.ts`
  - `src/lib/search/searchOrchestrator.ts`
  - `src/lib/search/fashionSearchFacade.ts`
  - `src/lib/search/resultDedup.ts`
  - `src/lib/search/candidateHydrator.ts`
- **Infra Components**
  - OpenSearch (`src/lib/core/opensearch.ts`)
  - PostgreSQL (`src/lib/core/db.ts`)
  - Optional cache (`src/lib/cache/*`)

---

## 2) Visual Search (Single Image)

**Feature goal:** Find products visually similar to a single uploaded image.

- **API Modules**
  - `src/routes/products/image-analysis.controller.ts`
  - `src/routes/products/image-analysis.service.ts`
  - `src/routes/search/search.controller.ts` (`/search/image`)
  - `src/routes/search/search.service.ts`
- **Domain Components**
  - `src/lib/image/clip.ts`
  - `src/lib/image/embeddingPrep.ts`
  - `src/lib/image/blip.ts`
  - `src/lib/search/searchHitRelevance.ts`
  - `src/lib/search/fashionSearchFacade.ts`
  - `src/lib/search/vectorSearchEngine.ts`
  - `src/lib/search/merchandiseVisualSimilarity.ts`
- **Infra Components**
  - OpenSearch vector fields
  - Optional BLIP/YOLO side services
  - Object storage for image assets (`src/lib/image/r2.ts`)

---

## 3) Multi-Image and Multi-Vector Search

**Feature goal:** Composite search from multiple references and weighted attributes.

- **API Modules**
  - `src/routes/search/search.controller.ts` (`/search/multi-image`, `/search/multi-vector`)
  - `src/routes/search/search.service.ts`
- **Domain Components**
  - `src/lib/search/multiVectorSearch.ts`
  - `src/lib/search/multiImagePreprocess.ts`
  - `src/lib/search/attributeEmbeddings.ts`
  - `src/lib/search/attentionFusion.ts`
  - `src/lib/search/attributeReranker.ts`
  - `src/lib/search/attributeRelevanceGates.ts`
  - `src/lib/search/intentParser.ts`
  - `src/lib/prompt/gemeni.ts`
- **Infra Components**
  - OpenSearch for retrieval
  - Gemini API for prompt/attribute interpretation

---

## 4) Shop-the-Look (Detection + Per-Item Search)

**Feature goal:** Detect fashion pieces from one outfit image and search per detected item.

- **API Modules**
  - `src/routes/products/image-analysis.controller.ts`
  - `src/routes/products/image-analysis.service.ts`
- **Domain Components**
  - `src/lib/image/yolov8Client.ts`
  - `src/lib/image/detectionEngine.ts`
  - `src/lib/image/partExtraction.ts`
  - `src/lib/image/partCropping.ts`
  - `src/lib/detection/categoryMapper.ts`
  - `src/lib/search/fashionSearchFacade.ts`
- **Infra Components**
  - YOLO sidecar/API
  - OpenSearch
  - R2/object storage (if artifacts are persisted)

---

## 5) Complete This Look (Outfit Completion)

**Feature goal:** Suggest complementary items by category/style coherence.

- **API Modules**
  - `src/routes/products/outfit.controller.ts`
  - `src/routes/products/outfit.service.ts`
  - `src/routes/products/completestyle.service.ts`
- **Domain Components**
  - `src/lib/outfit/completestyle.ts`
  - `src/lib/outfit/styleAwareSlotQuery.ts`
  - `src/lib/outfit/occasionInference.ts`
  - `src/lib/outfit/outfitNarrative.ts`
  - `src/lib/outfit/wardrobeAware.ts`
- **Infra Components**
  - PostgreSQL for product and user-context hydration
  - OpenSearch for candidate retrieval

---

## 6) Recommendations and Similar Items

**Feature goal:** Product-level recommendations and related-item retrieval.

- **API Modules**
  - `src/routes/products/recommendations.controller.ts`
  - `src/routes/products/recommendations.service.ts`
  - `src/routes/products/candidates.service.ts`
  - `src/routes/products/recommendations-logger.service.ts`
- **Domain Components**
  - `src/lib/ranker/pipeline.ts`
  - `src/lib/ranker/client.ts`
  - `src/lib/ranker/features.ts`
  - `src/lib/ranker/searchReranker.ts`
  - `src/lib/recommendations/*`
  - `src/lib/search/relatedProducts.ts`
- **Infra Components**
  - Python ranker API (`RANKER_API_URL`)
  - PostgreSQL impression/feedback tables
  - OpenSearch candidate retrieval

---

## 7) Catalog, Facets, and Price Intelligence

**Feature goal:** Listing, filtering, product details, facets, and pricing timeline views.

- **API Modules**
  - `src/routes/products/products.controller.ts`
  - `src/routes/products/products.service.ts`
  - `src/routes/products/facets.service.ts`
  - `src/routes/products/priceHistory.service.ts`
  - `src/routes/products/images.controller.ts`
  - `src/routes/products/images.service.ts`
  - `src/routes/products/variants.controller.ts`
  - `src/routes/products/variants.service.ts`
- **Domain Components**
  - `src/lib/products/priceHistory.ts`
  - `src/lib/products/canonical.ts`
  - `src/lib/productImages.ts`
  - `src/lib/compare/priceAnomalyDetector.ts`
- **Infra Components**
  - PostgreSQL
  - OpenSearch (listing/search facets)
  - Object storage/CDN image URLs

---

## 8) Wardrobe and Styling Intelligence

**Feature goal:** Personal wardrobe CRUD, analysis, compatibility, and styling guidance.

- **API Modules**
  - `src/routes/wardrobe/wardrobe.controller.ts`
  - `src/routes/wardrobe/wardrobe.service.ts`
  - `src/routes/wardrobe/recommendations.service.ts`
  - `src/routes/wardrobe/styleProfile.service.ts`
  - `src/routes/wardrobe/compatibility.service.ts`
  - `src/routes/wardrobe/gaps.service.ts`
  - `src/routes/wardrobe/wardrobe.routes.ts`
- **Domain Components**
  - `src/lib/wardrobe/imageRecognition.ts`
  - `src/lib/wardrobe/visualCoherence.ts`
  - `src/lib/wardrobe/learnedCompatibility.ts`
  - `src/lib/wardrobe/layeringOrder.ts`
  - `src/lib/wardrobe/outfitSlotInference.ts`
  - `src/lib/wardrobe/autoSync.ts`
  - `src/lib/color/*` (harmony/canonicalization)
- **Infra Components**
  - PostgreSQL + pgvector
  - CLIP/YOLO/Gemini integration
  - Object storage for wardrobe media

---

## 9) Virtual Try-On

**Feature goal:** Async garment try-on generation with robust job lifecycle.

- **API Modules**
  - `src/routes/tryon/tryon.controller.ts`
  - `src/routes/tryon/tryon.service.ts`
  - `src/routes/tryon/tryon.routes.ts`
  - `src/routes/tryon/index.ts`
- **Domain Components**
  - `src/lib/tryon/index.ts`
  - `src/lib/tryon/garmentValidation.ts`
  - `src/lib/image/tryonClient.ts`
  - `src/lib/tryon/retryQueue.ts`
  - `src/lib/tryon/webhooks.ts`
- **Infra Components**
  - Vertex AI Try-On endpoint
  - PostgreSQL job state tables
  - R2/object storage for generated outputs
  - Rate-limit middleware for submission endpoints

---

## 10) Product Compare Intelligence

**Feature goal:** Multi-dimensional product comparison and decision support.

- **API Modules**
  - `src/routes/compare/compare.controller.ts`
  - `src/routes/compare/compare.service.ts`
  - `src/routes/compare/compare-enhanced.service.ts`
  - `src/routes/compare/compare-decision.service.ts`
  - `src/routes/compare/compare-decision.adapter.ts`
  - `src/routes/compare/compare-decision.schema.ts`
- **Domain Components**
  - `src/lib/compare/compareEngine.ts`
  - `src/lib/compare/textQualityAnalyzer.ts`
  - `src/lib/compare/verdictGenerator.ts`
  - `src/lib/compare/fashionDictionary.ts`
- **Infra Components**
  - PostgreSQL product/price/policy data
  - Optional LLM components for narrative/decision explanations

---

## 11) Cart and Favorites

**Feature goal:** Core shopper state management for shortlisting and purchase intent.

- **API Modules**
  - `src/routes/cart/cart.controller.ts`
  - `src/routes/cart/cart.service.ts`
  - `src/routes/cart/cart.routes.ts`
  - `src/routes/favorites/favorites.controller.ts`
  - `src/routes/favorites/favorites.service.ts`
  - `src/routes/favorites/favorites.routes.ts`
- **Domain Components**
  - Module-local service logic (primarily route service layer)
- **Infra Components**
  - PostgreSQL user/cart/favorites tables
  - Auth middleware for user scoping

---

## 12) Auth and Session Security

**Feature goal:** User identity, token issuance/refresh/logout, role-aware access.

- **API Modules**
  - `src/routes/auth/auth.controller.ts`
  - `src/routes/auth/auth.service.ts`
  - `src/routes/auth/auth.routes.ts`
  - `src/routes/auth/index.ts`
- **Domain Components**
  - `src/lib/auth/refreshTokenBlacklist.ts`
  - Auth middleware in `src/middleware/*` (require auth/admin)
- **Infra Components**
  - PostgreSQL users + refresh token blacklist
  - JWT secret/config (`src/config.ts`)
  - bcrypt and jsonwebtoken libraries

---

## 13) Admin, Dashboard, Ingest, and Labeling

**Feature goal:** Platform operations, moderation, analytics, ingestion, and active-learning loops.

- **API Modules**
  - Admin:
    - `src/routes/admin/admin.controller.ts`
    - `src/routes/admin/admin.service.ts`
  - Dashboard:
    - `src/routes/dashboard/dashboard.controller.ts`
    - `src/routes/dashboard/dashboard.service.ts`
  - Ingest:
    - `src/routes/ingest/ingest.controller.ts`
    - `src/routes/ingest/ingest.service.ts`
    - `src/routes/ingest/ingest.routes.ts`
  - Labeling:
    - `src/routes/labeling/labeling.controller.ts`
    - `src/routes/labeling/labeling.service.ts`
    - `src/routes/labeling/labeling.routes.ts`
- **Domain Components**
  - `src/lib/scrape/*` (vendor collectors)
  - `src/lib/labeling/*`
  - `src/lib/queue/*`
  - `src/lib/worker/*`
  - `src/lib/scheduler/*`
- **Infra Components**
  - Redis queue/backplane
  - BullMQ/worker execution
  - PostgreSQL for job/task state
  - Object storage for ingest artifacts

---

## 14) Observability and Platform Runtime

**Feature goal:** Service reliability, diagnostics, and operational control.

- **API Modules**
  - `src/routes/health/health.controller.ts`
  - `src/routes/health/health.service.ts`
  - `src/routes/metrics/index.ts`
- **Domain Components**
  - `src/lib/metrics/index.ts`
  - `src/middleware/metrics.ts`
  - `src/middleware/logger.ts`
  - `src/middleware/errorHandler.ts`
  - `src/server.ts` and `src/index.ts` bootstrap lifecycle
- **Infra Components**
  - Prometheus scraping via `/metrics`
  - readiness/liveness probing via `/health/*`

---

## Cross-Feature Core Components

These components are reused by many features and should be treated as high-impact change zones:

- `src/config.ts` (environment and service wiring)
- `src/lib/core/db.ts` and `src/lib/core/opensearch.ts` (data/search clients)
- `src/middleware/*` (auth, limits, logging, errors, validation)
- `src/lib/cache/*` (retrieval and embedding cache paths)
- `src/lib/image/*` and `src/lib/search/*` foundations for discovery features

