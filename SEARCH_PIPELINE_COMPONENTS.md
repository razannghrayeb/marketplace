# Search/Ranking Pipeline Components

This document maps the key components of the search and ranking pipeline in TypeScript/JavaScript files within the `src/` directory.

---

## 1. Reranking Logic and Attribute Fetching (attr_mget)

### Core Reranking Service
- **[src/routes/products/products.service.ts](src/routes/products/products.service.ts#L5365)**
  - Main reranking pipeline orchestrator
  - Contains `rerankTimings` object tracking (Line 5365+)
  - **attr_mget timing** at Line 5462 (attribute multi-get operation)
  - Tracks: `signals_wait_ms`, `attr_mget_ms`, `part_similarity_ms`, `attribute_similarity_ms`, `final_relevance_ms`, `sorting_ms`, `post_filtering_ms`, `total_rerank_ms`
  - Multiple rerank functions: `applyImageDiversityRerank()` (L918), `imageDiversityRerankEnabled()` (L358), `imageExactCosineRerankEnabled()` (L4117)

### Ranker Module
- **[src/lib/ranker/searchReranker.ts](src/lib/ranker/searchReranker.ts)**
  - Search result reranking logic
  - Applies multiple ranking signals

- **[src/lib/ranker/intentReranker.ts](src/lib/ranker/intentReranker.ts)**
  - Intent-based reranking for query understanding
  - Aligns results with detected user intent

- **[src/lib/ranker/mmr.ts](src/lib/ranker/mmr.ts)**
  - Maximum Marginal Relevance (MMR) reranking
  - Diversity-aware ranking

### Search Attribute Processing
- **[src/lib/search/attributeReranker.ts](src/lib/search/attributeReranker.ts)**
  - Attribute-based reranking signals
  - Scores products by attribute relevance

- **[src/lib/search/attributeExtractor.ts](src/lib/search/attributeExtractor.ts)**
  - Extracts and normalizes product attributes
  - Feeds attributes to reranking pipeline

- **[src/lib/search/attributeRelevanceGates.ts](src/lib/search/attributeRelevanceGates.ts)**
  - Attribute filtering and gating logic
  - Determines attribute-based filtering thresholds

### Color and Style Reranking
- **[src/routes/products/colorRelevance.ts](src/routes/products/colorRelevance.ts)**
  - Color relevance scoring for reranking
  - Supports `rerankColorMode` ("any" or "all")
  - Prioritizes color matches in ranking

- **[src/features/decision-intelligence/engine/compareEngine.ts](src/features/decision-intelligence/engine/compareEngine.ts#L662)**
  - **`applyTopBlackColorPriority()`** (L662) - Black color prioritization
  - **`applyColorIntentPriority()`** (L714) - Intent-aware color priority
  - Modifies `rerankScore` field (L701, L750)

---

## 2. KNN Search Implementation

### Shop-the-Look / Detection-Based KNN
- **[src/routes/products/image-analysis.service.ts](src/routes/products/image-analysis.service.ts)**
  - Per-detection KNN search (Line 172+)
  - **`shopTheLookKnnField()`** (L176) - Returns KNN field name (embedding or embedding_garment)
  - Dual-KNN search with pass A/B fallback (L7970)
  - KNN candidate pool capping (L272, L1274)
  - Handles KNN timeouts (L7923) and recovery chains
  - Tracks KNN timing metrics (L9006)
  - Configuration: `knnField`, detection count limits, timeout handling

### Text + Vector Hybrid Search
- **[src/routes/search/search.service.ts](src/routes/search/search.service.ts#L939)**
  - Hybrid KNN + BM25 search (L939 comment)
  - **KNN boost-only vs must clauses** (L1041-L1052)
  - **`knnBoostOnly`** logic for fashion queries (L1047-L1052)
  - **`knnDemoteLowFashionEmb`** setting to demote low fashion embeddings
  - KNN clause in `must` (line 1645+) or `should` (boost-only, default)
  - Retry without KNN (`mustWithoutKnnForRetry`) for failure recovery

### Vector Search Engine
- **[src/lib/search/vectorSearchEngine.ts](src/lib/search/vectorSearchEngine.ts)**
  - Core vector search implementation
  - KNN query building and execution

- **[src/lib/search/multiVectorSearch.ts](src/lib/search/multiVectorSearch.ts)**
  - Multi-vector search combining different embedding fields
  - Handles `embedding`, `embedding_garment`, `embedding_color`, `embedding_pattern` fields

- **[src/lib/search/fashionSearchFacade.ts](src/lib/search/fashionSearchFacade.ts)**
  - Facade for fashion-specific search logic
  - Orchestrates KNN and text search

### OpenSearch KNN Configuration
- **[src/lib/core/opensearch.ts](src/lib/core/opensearch.ts#L61)**
  - KNN index settings and parameters (L61+)
  - **`ef_search`** tuning (L61-L69)
  - KNN field definitions: `embedding`, `embedding_garment`, `embedding_color`, etc. (L232+)
  - Vector field type configuration (`knn_vector`)

### KNN Initialization & Warmup
- **[src/index.ts](src/index.ts#L53)**
  - **`applyIndexSpeedSettings()`** (L53) - Live-tunable KNN speed settings
  - **`warmupKnnIndex()`** (L63) - KNN index warmup on startup

- **[src/lib/core/index.ts](src/lib/core/index.ts)**
  - KNN index speed settings management

---

## 3. Hydration Logic

### Product Hydration (Search Results)
- **[src/routes/search/search.service.ts](src/routes/search/search.service.ts#L2112)**
  - **`hydrateProductDetails()`** (L4687) - Main hydration function
  - **Hydration window** (L2112-L2116) - Limits how many top results to hydrate
  - **Product batch fetching** via `getSearchProductsByIdsOrdered()` (L2120)
  - **Image hydration** via `getImagesForProducts()` (L2124)
  - Concurrent hydration with `Promise.all()` (L2119)
  - Tracks `hydratedProductsCount`, `hydratedFirstProductId`, `hydrated_results` metrics

### Database Batch Fetching
- **[src/lib/core/db.ts](src/lib/core/db.ts#L271)**
  - **`getSearchProductsByIdsOrdered()`** (L271) - Ordered batch product fetching from database
  - Returns products in order matching input IDs

### Candidate Hydrator
- **[src/lib/search/candidateHydrator.ts](src/lib/search/candidateHydrator.ts)**
  - Hydrates search candidates with full product details
  - Enriches candidates with images, attributes, pricing

### Search Retrieval Cache
- **[src/lib/cache/searchRetrievalCache.ts](src/lib/cache/searchRetrievalCache.ts#L5)**
  - Caches search results (product IDs + scores)
  - Short TTL; hydrates fresh details on hit
  - Reduces database load on repeated queries

---

## 4. Timing Breakdown Metrics

### Image Pipeline Timing (Analysis Stage)
- **[src/routes/products/image-analysis.service.ts](src/routes/products/image-analysis.service.ts#L5460)**
  - **`ImageAnalysisStageTimings`** interface (L5460) with fields:
    - `totalMs`, `validateMs`, `serviceStatusMs`, `metadataMs`, `pHashMs`
    - `storageMs`, `clipEmbeddingMs`, `yoloInitialMs`, `yoloRetryMs`
    - `accessoryRecoveryMs`, `postProcessMs`, `deferredFullFrameEmbeddingMs`, `detectionPersistQueueMs`
  - Timing collection (L5963+) with `analysisTimings` object

### Image Pipeline Timing (Similarity Stage)
- **[src/routes/products/image-analysis.service.ts](src/routes/products/image-analysis.service.ts#L5476)**
  - **`ImageSimilarityStageTimings`** interface (L5476) with fields:
    - `totalMs`, `fullCaptionMs`, `detectionSetupMs`, `detectionTaskWallMs`
    - `detectionTaskTotalMs`, `detectionTaskAvgMs`, `detectionTaskMaxMs`
    - Detection crop embed/BLIP/search timings (avg/max)
    - `postProcessingMs`
  - Timing collection (L6320+) with `similarityTimings` object
  - Per-detection substep timing (L9006): `crop_clip_ms`, `blip_ms`, `search_first_ms`

### Complete Pipeline Timing
- **[src/routes/products/image-analysis.service.ts](src/routes/products/image-analysis.service.ts#L5497)**
  - **`ImagePipelineTimings`** interface (L5497) - Aggregates analysis + similarity stages

### Reranking Stage Timing
- **[src/routes/products/products.service.ts](src/routes/products/products.service.ts#L5365)**
  - **`rerankTimings`** object (L5365) with breakdown:
    - `signals_wait_ms` (L5412) - Signal preparation time
    - `attr_mget_ms` (L5462) - Attribute multi-get operation
    - `part_similarity_ms` (L5517) - Part/category similarity
    - `attribute_similarity_ms` (L6613) - Attribute scoring
    - `final_relevance_ms` (L7610) - Final relevance computation
    - `sorting_ms` (L7698) - Result sorting
    - `post_filtering_ms` (L9276) - Post-filtering operations
    - `total_rerank_ms` (L9277) - Total reranking time
  - Debug logging if `DEBUG_RERANK_TIMING=1` or > 4000ms (L10755)

### HTTP Metrics Middleware
- **[src/middleware/metrics.ts](src/middleware/metrics.ts#L14)**
  - **`metricsMiddleware()`** (L14) - Records HTTP request metrics
  - Normalizes paths to avoid high cardinality (L17, L36)
  - Tracks request duration and status codes

### Metrics Routing
- **[src/server.ts](src/server.ts#L22)**
  - **`metricsMiddleware`** applied globally (L59)
  - **`metricsRouter`** mounted at `/metrics` (L63)

- **[src/routes/metrics/index.ts](src/routes/metrics/index.ts)**
  - Metrics endpoint router
  - Exposes Prometheus metrics

### Metrics Library
- **[src/lib/metrics/index.ts](src/lib/metrics/index.ts)**
  - Central metrics collection and definitions
  - Prometheus counters, gauges, histograms

---

## Configuration & Constants

### Search Configuration
- **[src/config.ts](src/config.ts)**
  - KNN gate: `SEARCH_IMAGE_KNN_GATE` (L99)
  - Text gate: `SEARCH_FINAL_ACCEPT_MIN_TEXT` (L151)
  - Reranking: `SEARCH_XGB_RERANK_FULL_RECALL` (L171-L172)
  - KNN recall window: `SEARCH_RECALL_WINDOW` (L119)
  - KNN demote: `SEARCH_KNN_DEMOTE_LOW_FASHION_EMB` (L191-L195)

### Image Analysis Configuration
- **[src/routes/products/image-analysis.service.ts](src/routes/products/image-analysis.service.ts#L162)**
  - Soft/hard reranking modes (L162-L216)
  - KNN field selection (L176)
  - Per-detection pool cap (L272)
  - Concurrent KNN limit (L1274)

---

## Key Search Types & Interfaces
- **[src/routes/products/types.ts](src/routes/products/types.ts)**
  - `rerankScore?` field (L188) - Deterministic reranking score
  - `mlRerankScore?` field (L193) - ML-based rerank score
  - Multi-signal reranking fields (L244)
  - Diversity rerank diagnostics (L420)

- **[src/lib/search/searchTypes.ts](src/lib/search/searchTypes.ts)**
  - Search query types, result types, filter structures

---

## Supporting Search Components

These enhance the main pipeline:
- **[src/lib/search/searchOrchestrator.ts](src/lib/search/searchOrchestrator.ts)** - Orchestrates overall search flow
- **[src/lib/search/retrievalPlanner.ts](src/lib/search/retrievalPlanner.ts)** - Plans retrieval strategy
- **[src/lib/search/resultDedup.ts](src/lib/search/resultDedup.ts)** - Deduplicates results
- **[src/lib/search/sortResults.ts](src/lib/search/sortResults.ts)** - Final result sorting
- **[src/lib/search/searchHitRelevance.ts](src/lib/search/searchHitRelevance.ts)** - Relevance scoring for hits
- **[src/lib/search/fashionDomainSignal.ts](src/lib/search/fashionDomainSignal.ts)** - Fashion-specific scoring signals
- **[src/lib/search/intentReconciliation.ts](src/lib/search/intentReconciliation.ts)** - Reconciles multiple intents

