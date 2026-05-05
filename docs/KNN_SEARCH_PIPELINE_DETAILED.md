# Detailed KNN Search Documentation

This document explains the real kNN search pipeline used by image search, with focus on:

- query vector routing (`embedding` vs `embedding_garment`)
- OpenSearch request construction
- retrieval pool sizing
- sparse/timeout fallback behavior
- threshold/relax logic
- downstream rerank and final acceptance gates

The behavior described here corresponds to the implemented runtime pipeline.

---

## 1) Scope

This document focuses on **image kNN retrieval flow** in the product search stack (especially paths used by image search and detection-scoped shop-the-look).

It covers:

1. index vector schema relevant to kNN
2. request-time kNN query formation
3. retrieval strategies for normal and detection-scoped searches
4. failure and fallback ladders
5. how kNN results are transformed into final ranked output

---

## 2) Vector Fields Used by kNN

Primary kNN fields:

- `embedding` (full-image CLIP vector)
- `embedding_garment` (garment ROI CLIP vector)

Secondary vector families exist (attribute and part vectors), but primary nearest-neighbor retrieval for image search centers on the two fields above.

---

## 3) Index-Level kNN Configuration

## 3.1 Engine and methods

From index mapping:

- `embedding` and `embedding_garment` use `knn_vector` with FAISS HNSW
- attribute/part vectors use IVF configuration (mainly for secondary signals)

## 3.2 Dimension consistency

All vector fields share one embedding dimension derived from `EXPECTED_EMBEDDING_DIM`.

Dimension mismatch between model output and index mapping is treated as fatal upstream.

## 3.3 ef_search defaults

Index settings include a tuned `knn.algo_param.ef_search` baseline and provide operational function to apply/verify settings on existing indexes.

---

## 4) kNN Entry Point in Search Flow

Image retrieval enters via image search pipeline and eventually reaches kNN execution logic in product image search.

Inputs influencing kNN behavior:

- query vectors (`imageEmbedding`, optionally `imageEmbeddingGarment`)
- `knnField` hint
- detection context (`detectionProductCategory`, `detectionYoloConfidence`)
- category/aisle/type filters
- retrieval limits and thresholds
- fallback switches (`relaxThresholdWhenEmpty`, detection relax mode)

---

## 5) kNN Query Construction

The system constructs OpenSearch bool+kNN requests and supports:

- per-query `ef_search` (when cluster supports it)
- `num_candidates` tuning (important for FAISS HNSW traversal behavior)
- dynamic `k` sizing (`retrievalK`)

If cluster rejects unsupported parameters, query is retried with stripped fields for compatibility.

---

## 6) Retrieval Pool Sizing (`retrievalK`)

`retrievalK` is category- and context-aware:

- detection-scoped searches can use dynamic caps tuned for latency/quality
- non-detection searches can use broader pools

Design intent:

- fetch enough candidates for downstream rerank/gates
- avoid overloading OpenSearch on high-concurrency detection fan-out

---

## 7) kNN Field Strategy

Field selection can be:

1. fixed single field (`embedding` or `embedding_garment`)
2. dual-field strategy (global + garment) with merge
3. runtime fallback from garment to global if garment path is sparse/invalid

Detection paths often start with garment-aware intent but can merge global neighbors to recover recall.

---

## 8) OpenSearch Call Execution Model

## 8.1 Single-call path

Uses direct kNN query execution with timeout controls.

## 8.2 Batched path (`_msearch`)

When multiple kNN subqueries are needed (e.g., global + garment), system can batch into one `_msearch` HTTP call.

If msearch or sub-responses fail, fallback to individual calls is used.

## 8.3 Timeout handling

On timeout:

- logs timeout event
- retries with extended timeout
- marks timeout observability flags for downstream diagnostics

---

## 9) Detection-Scoped kNN Behavior (Shop-the-look critical path)

Detection-scoped searches differ from generic image search:

- constrained by per-detection latency and call budgets
- use category-aware thresholds and fallback stages
- may run deterministic two-pass strategy
- include detection-specific retry ladder from orchestrator

kNN retrieval is therefore part of a broader adaptive loop, not a one-shot call.

---

## 10) Sparse Recall Detection and kNN Fallback

The system detects sparse candidate conditions (e.g., too few hits after strict constraints).

When sparse recall is detected, it can:

1. run relaxed kNN filter variant
2. merge additional hits from alternate field/path
3. preserve a broader candidate pool for rerank guards

This prevents empty/low-quality outputs caused by over-pruning at ANN stage.

---

## 11) Score Normalization and Visual Similarity Handling

kNN output scores are normalized and transformed for downstream logic:

- OpenSearch score interpretation handling
- cosine-derived similarity normalization
- optional exact-cosine paths for diagnostics/special modes

Resulting visual similarity participates in both:

1. threshold-based visual gates
2. final composite relevance scoring

---

## 12) Threshold and Relax Logic

## 12.1 Strict visual gate

Initial gate keeps candidates above configured similarity threshold.

## 12.2 Relax-when-empty behavior

If strict gate yields zero and relax is enabled:

- fallback keeps best neighbors above configured relax floor
- threshold-relaxed state is tracked in metadata/observability

This is controlled and does not fully disable relevance protection.

---

## 13) Post-kNN Pipeline (why kNN alone does not decide output)

After kNN retrieval, results go through additional stages:

1. category/type/style/color/audience compliance logic
2. final relevance score computation (`finalRelevance01`)
3. dedupe and variant collapse
4. optional related/pHash adjunct handling

So kNN provides candidate recall; final output quality is enforced downstream.

---

## 14) Dedupe and Variant Consolidation

Before return, image results can be deduplicated and variant groups collapsed to avoid near-identical flooding.

This is especially important in detection-grouped search where multiple detections may surface overlapping catalog variants.

---

## 15) Category and Aisle Interaction with kNN

kNN candidate generation can be influenced by:

- hard category filters (strict mode or forced conditions)
- soft category/aisle hints (`predictedCategoryAisles`) used for rerank behavior

Detection orchestrator decides when to keep hard category vs soften/drop it in fallback phases.

---

## 16) Retry/Fallback Ladder Around kNN (Detection path)

In detection jobs, kNN is invoked across staged reasons such as:

- initial
- deterministic second pass
- retries dropping style/type/length constraints
- category fallback and structural fallback
- multicrop and category-specific recovery

Each stage remains bounded by:

- max calls per detection
- per-detection wall-clock budget
- global concurrency limits

---

## 17) Operational Knobs Affecting kNN

Key tuning surfaces include:

- `ef_search` controls
- `num_candidates` behavior
- retrieval pool limits and category-aware caps
- timeout settings
- relax floor and threshold settings
- field choice (`embedding` vs `embedding_garment`)

Any tuning should be validated with both relevance metrics and latency/error rates.

---

## 18) Observability Signals for kNN Health

Important runtime indicators:

- kNN timeout flags
- raw kNN hit counts
- post-visual-gate counts
- post-final-gate counts
- sparse-fallback activation
- cross-category leak proxies and color compliance indicators

These metrics reveal whether failures are from ANN recall, filter over-constraint, or downstream gates.

---

## 19) Failure and Degradation Model

If kNN path degrades:

- unsupported query params -> compatibility retry
- msearch failure -> single-call fallback
- timeout -> extended retry
- sparse hits -> relaxed fallback retrieval
- detection-stage exhaustion -> fallback stages or partial success from other detections

The system prefers graceful degradation over hard endpoint failure.

---

## 20) Practical Summary

The kNN pipeline is a recall engine with adaptive resilience:

1. choose/compose vector field strategy
2. retrieve bounded ANN pools with compatibility-safe requests
3. recover from sparse/timeout conditions
4. feed richer rerank and relevance gates
5. return stabilized, deduped, detection-aware results

In short, kNN is the first half of relevance; the final half is downstream compliance and gating.

