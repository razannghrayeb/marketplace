# Complete Pipeline Documentation (April 2026)

Last updated: April 12, 2026
Audience: Backend engineers, search/ML engineers, platform/ops, API integrators

This is the most detailed end-to-end reference for the current production pipeline, including all major upgrades implemented in the latest workstream:
- Session-aware image search context propagation
- User personalization in image ranking
- Variant-group collapsing in image result sets
- Deep fusion + diversity reranking instrumentation
- Shop-the-look session-context integration
- Reindex hardening for missing detection metadata

## 1. System-level architecture

The platform is a hybrid retrieval and reranking system:
- Postgres: source of truth for catalog, images, detections, user/interaction data
- OpenSearch: lexical + vector retrieval index for low-latency candidate recall
- Runtime services (Node): query understanding, image embeddings, candidate hydration, reranking, dedupe, business constraints
- Optional sidecars/services: BLIP captioning, YOLO detection, rembg background removal

At runtime, search is not a single similarity lookup. It is:
1. Candidate generation (kNN and/or lexical retrieval)
2. Candidate hydration from Postgres
3. Multi-signal reranking
4. Acceptance gates and rescue paths
5. Dedupe, variant collapsing, optional diversity reranking
6. Response metadata and diagnostics

## 2. Entry points and route topology

Primary user-facing routes:
- GET /search: enhanced text pipeline with context and negation support
- POST /search/image: single-image search through unified facade
- POST /products/search/image: storefront image search route through unified facade
- POST /api/images/search: shop-the-look (detect items and run per-detection image search)

Controller-level context extraction now supports:
- session_id query parameter and x-session-id header
- user_id query value and authenticated user identity where available

These values are propagated to unified search so conversational context and personalization can influence image ranking.

### 2.1 API-to-pipeline mapping

`POST /api/images/search` is the canonical YOLO/shop-the-look endpoint.

It maps to the following internal stages:
- controller request parsing and image validation
- detection and image analysis
- per-detection crop embedding generation
- unified image search invocation with session/user context
- final ranking, rescue, dedupe, variant collapse, and pagination

This route is the main place where YOLO-derived intent becomes product retrieval.

## 3. Unified image search request lifecycle

Main implementation path:
- Controller receives image upload or embedding payload
- Facade performs preprocessing and context merge
- Products service executes retrieval + rerank + acceptance + post-processing

### 3.1 Controller layer behavior

Products and search controllers:
- Parse session/user identity
- Validate image or embedding payload
- Extract lightweight image hints (for example, soft color hints)
- Forward all ranking context to unified search

Important behavior:
- session and user identity are optional
- if no image and no embedding is present, request is rejected

### 3.2 Facade layer behavior

Facade responsibilities:
- Compute query embedding from image when client did not send embedding
- Build garment embedding when possible (for dual-kNN fusion)
- Optionally infer YOLO aisle hints for soft category ranking
- Compute pHash when image bytes exist (not only when includeRelated=true)
- Merge request filters with inherited session filters

Filter merge semantics:
- Request filters override inherited session filters
- Session filters only fill missing fields

### 3.3 Products service behavior (core ranking pipeline)

Image search in products service performs:
1. OpenSearch retrieval from configured kNN field (embedding or embedding_garment)
2. Optional dual-kNN fusion of global + garment vectors
3. Similarity normalization and merchandise alignment logic
4. Multi-signal scoring including visual, attribute, and metadata compliance
5. Final relevance gating and threshold relax/degrade rescue behavior
6. Hydration from Postgres images and product fields
7. Dedupe
8. Variant-group collapse (enabled by default)
9. Diversity rerank (MMR style) on top candidate pool
10. Optional pHash related retrieval and identity rescue

## 4. Personalization and session-context scoring

New context-aware scoring integrates two optional sources:
- Session filters (category/brand/color/material/fit/style/gender/pattern/ageGroup/priceRange)
- User lifestyle snapshot from wardrobe adapter

Lifestyle signals include:
- preferred brands
- preferred categories
- style profile color preferences
- dominant style and aesthetic tags
- learned price range percentiles

Personalization operation:
- Lifestyle is loaded lazily and cached per user in-process
- Context score is blended into ranking as a bounded additive factor
- Missing or failed lifestyle load is non-fatal and silently degrades to base behavior

Meta diagnostics include whether personalization was applied.

## 5. Variant-group collapse behavior

Problem solved:
- multiple near-identical variants of one parent product can flood top results

Current behavior:
- results are grouped by normalized variant key (parent_product_url + vendor id)
- best representative per group is selected by:
  1. finalRelevance01
  2. similarity_score
  3. rerankScore
- representative result contains:
  - variant_group_key
  - variant_group_size
  - variant_group_ids

Default:
- collapseVariantGroups defaults to enabled

Meta diagnostics include:
- variant_group_collapsing_applied
- variant_group_count
- variant_group_representatives

## 6. Deep fusion and diversity rerank

Deep fusion:
- Enabled by default
- Controlled by SEARCH_IMAGE_DEEP_FUSION and SEARCH_IMAGE_DEEP_FUSION_WEIGHT
- Adds a text/intent alignment contribution to final visual ranking in bounded form

Diversity rerank:
- Enabled by default
- MMR-style reranking over the top candidate window
- Controlled by SEARCH_IMAGE_DIVERSITY_RERANK, SEARCH_IMAGE_DIVERSITY_LAMBDA, SEARCH_IMAGE_DIVERSITY_POOL_CAP
- Objective balances relevance vs redundancy

Meta diagnostics expose whether diversity rerank ran and with which lambda/pool cap.

## 7. Shop-the-look integration details

Shop-the-look route (/api/images/search) now forwards session/user context to per-detection image search.

Image-analysis service additions:
- options include sessionId, userId, sessionFilters, collapseVariantGroups
- mergeImageSearchSessionFilters helper aligns detection-level filters with session context
- merge is applied in main per-detection search and recovery branches

Net effect:
- per-detection searches can now inherit conversational filters and personalization behavior similar to single-image search

## 8. Reindex and ingestion behavior

Reindex script: scripts/resume-reindex.ts

### 8.1 What reindex writes

Reindex builds OpenSearch documents. It does not SQL-update product embedding columns as its primary output path.

Document fields populated during reindex include:
- embedding (primary)
- embedding_garment (when available)
- embedding_color, embedding_style, embedding_pattern, embedding_texture, embedding_material (when attribute embeddings succeed)
- embedding_part_* fields (when part-level extraction succeeds)
- pHash and enrichment metadata

### 8.2 Detection metadata is optional for baseline

Current hardening:
- Reindex checks if product_image_detections exists
- Reindex checks if product_image_detections.label exists
- If table is missing: continue, disable detection crop path
- If label column is missing: continue, disable label-dependent part-level embeddings

This makes reindex fail-open for incomplete schemas while preserving baseline indexing.

### 8.3 Why detections still matter

Detections are optional for baseline continuity but important for quality:
- better garment-focused crops improve embedding_garment quality
- label-aware part embeddings improve fine-grained matching
- lower background noise in visual vectors

## 9. Response metadata contract (image search)

The image search meta payload now includes detailed diagnostics used for tuning and observability, including:
- threshold
- final_accept_min
- final_accept_min_effective
- threshold_relaxed
- relevance_relaxed_for_min_count
- image_knn_field
- deep_fusion_enabled
- deep_fusion_weight
- diversity_rerank_applied
- diversity_lambda
- diversity_pool_cap
- session_id
- user_id
- personalization_applied
- variant_group_collapsing_applied
- variant_group_count
- variant_group_representatives
- pipeline_counts (drop/recovery counters across ranking stages)

These fields are intended for engineering diagnostics, A/B verification, and regression monitoring.

### 9.1 finalRelevance01 interpretation

Each product object contains one `finalRelevance01` value.
- High values indicate the product survived the ranking pipeline with strong support.
- Low values often come from rescue or fallback paths where the system intentionally returns the best available candidate instead of an empty group.
- On `/api/images/search`, this is common in detections that are visually ambiguous, tiny, or only partially supported by metadata.

## 10. Configuration map (high impact)

Core retrieval/rerank:
- SEARCH_IMAGE_RETRIEVAL_K
- SEARCH_IMAGE_KNN_FIELD
- SEARCH_IMAGE_DUAL_GARMENT_FUSION
- SEARCH_IMAGE_DEEP_FUSION
- SEARCH_IMAGE_DEEP_FUSION_WEIGHT
- SEARCH_IMAGE_DIVERSITY_RERANK
- SEARCH_IMAGE_DIVERSITY_LAMBDA
- SEARCH_IMAGE_DIVERSITY_POOL_CAP

Quality gates:
- SEARCH_FINAL_ACCEPT_MIN_IMAGE
- SEARCH_IMAGE_RELAX_FLOOR
- SEARCH_IMAGE_MIN_RESULTS_TARGET

Auxiliary services:
- SEARCH_IMAGE_YOLO_TIMEOUT_MS
- SEARCH_BLIP_CAPTION_TIMEOUT_MS
- BLIP_API_URL / BLIP_API_TIMEOUT_MS

Reindex and embedding:
- CLIP_MODEL_TYPE (must match expected model family)
- EXPECTED_EMBEDDING_DIM (must match OpenSearch mapping)
- REMBG_SERVICE_URL
- REINDEX_PG_POOL_MAX

## 11. Operational runbook

### 11.1 Standard pipeline refresh after ranking/model changes

1. Ensure OpenSearch mapping supports expected embedding fields
2. Run reindex to regenerate vectors:
   - npx tsx scripts/resume-reindex.ts
3. If schema changes were introduced, run migration/schema scripts before reindex
4. Validate API responses and meta diagnostics on representative queries

### 11.2 Safe behavior with incomplete detection schema

No immediate schema hotfix is required for baseline operation.
If detections table/label column are missing:
- reindex continues
- advanced ROI/part-level quality enhancements are skipped

### 11.3 Recommended quality path

For best image quality:
1. Keep product_image_detections populated
2. Keep label column available
3. Periodically reindex after preprocessing/model updates

## 12. Verification checklist

Use this checklist after deploying ranking changes:
- Controllers pass session and user context to unified image search
- Facade inherits and merges session filters correctly
- Meta shows personalization_applied when user profile exists
- Meta shows variant grouping counters when collapse is enabled
- Diversity rerank counters appear for sufficiently large result sets
- Reindex logs expected warning (not crash) when detection metadata is absent
- No TypeScript compile regressions

## 13. Known limitations and next steps

Current limitations:
- Personalization depends on available wardrobe/lifestyle signal quality
- Some advanced part embeddings depend on detection label coverage
- Metadata payload is large and mostly diagnostic; client contracts should consume only stable fields

Suggested next improvements:
- Add explicit API docs for all image-search meta keys and stability levels
- Add runtime metrics for percentage of reindexed products missing detection-label path
- Add periodic doc sync automation against route/type signatures

## 14. Source-of-truth files for this documentation

Primary implementation references:
- src/lib/search/fashionSearchFacade.ts
- src/routes/products/products.service.ts
- src/routes/products/products.controller.ts
- src/routes/search/search.controller.ts
- src/routes/products/image-analysis.service.ts
- src/routes/products/image-analysis.controller.ts
- src/routes/products/types.ts
- scripts/resume-reindex.ts

This document is intended to remain synchronized with those files.
