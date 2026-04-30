# API Documentation: `POST /api/images/search`

This document explains the real runtime architecture and behavior of the `POST /api/images/search` pipeline in detail.

It is intentionally logic-first (how things work end-to-end), with model/component responsibilities, decision flow, fallback graph, ranking/gating behavior, and response assembly.

---

## 1) Purpose and System Role

`POST /api/images/search` is the primary "shop by image" endpoint.

At runtime, it is not a single model call. It is an orchestration pipeline that combines:

1. Image understanding (detection + semantic enrichment)
2. Per-item visual retrieval (vector search)
3. Multi-stage retry/fallback strategies
4. Relevance gating and result stabilization
5. Grouped response assembly with dual pagination

The endpoint transforms one uploaded image into a structured result graph:

- detection groups (items found in the image)
- products per detection group
- confidence/coverage/coherence metadata

---

## 2) High-Level Architecture

The runtime architecture is layered:

1. **API edge layer**  
   Input parsing, validation, query normalization, response shaping.

2. **Orchestration layer**  
   Controls pipeline order, branching, retries, and aggregation.

3. **Perception layer**  
   YOLO (detections), CLIP (embeddings), BLIP (caption/semantic hints), color/style inference.

4. **Retrieval layer**  
   kNN candidate retrieval on vector index with adaptive retrieval/fallback behavior.

5. **Ranking/compliance layer**  
   Category/type/color/style/audience compliance scoring, final relevance gating, dedupe/variant collapse.

6. **Presentation layer**  
   Grouping, coverage/coherence outputs, two-dimensional pagination.

---

## 3) Request Contract and Input Semantics

### 3.1 Accepted upload fields

The route accepts multipart image file in any of:

- `image`
- `file`
- `photo`
- `outfit`

If no valid image is present, the endpoint returns `400`.

### 3.2 File constraints

- Max file size: `10MB`
- Allowed MIME types:
  - `image/jpeg`
  - `image/png`
  - `image/webp`

### 3.3 Main query controls

- `threshold`: similarity threshold (default `0.63`)
- `confidence`: detection confidence (default `0.25`)
- `filter_category`: default enabled (category-aware behavior)
- `group_by_detection`: default disabled; when enabled keeps one output group per raw detection instance
- `include_empty_groups`: include empty detection groups in output when enabled
- `enhance_contrast`, `enhance_sharpness`, `bilateral_filter`: optional preprocessing toggles
- `session_id` or header `x-session-id`: conversational/session filter context
- `user_id`: optional user context

### 3.4 Pagination controls (dual-level)

1. **Products pagination** within each detection group
   - `products_page` (default `1`)
   - `products_limit` (clamped)
   - `limit_per_item` as fallback input

2. **Detections pagination** over groups
   - `detections_page` (default `1`)
   - `detections_limit` (clamped)

Both are applied to the final payload shape.

---

## 4) Pipeline Walkthrough (End-to-End)

## Stage A: API normalization

The controller:

1. selects the first valid image from accepted fields
2. validates/normalizes numeric query params
3. computes product-page and detection-page offsets/limits
4. builds orchestration options object
5. invokes image analysis orchestrator

At this stage, no catalog search is executed yet.

## Stage B: Base image analysis

The orchestrator runs core analysis:

1. image validation
2. service status probing (CLIP/YOLO/BLIP)
3. metadata + pHash extraction
4. parallel branches:
   - optional storage path
   - embedding generation path
   - YOLO detection path

### Detection resilience inside Stage B

If YOLO returns zero detections:

1. retry with lower confidence and stronger preprocessing
2. accessory recovery path (low-threshold speculative pass)
3. merge recovered detections and dedupe overlaps

Then detection post-processing enriches output fields (style/mask/composition-friendly shape).

## Stage C: Topology branch

After Stage B, pipeline chooses one path:

1. **Detection-driven search path** if detections exist
2. **Full-image fallback path** if no detections remain

This is the central fault-tolerance switch.

## Stage D: Semantic enrichment and signal extraction

Pipeline extracts/derives additional signals:

- BLIP full caption + structured parse
- audience hints (gender/age group)
- item/type lexical hints
- color signals (caption colors, dominant colors, per-item inferred colors)
- contextual formality/style cues

These signals influence retrieval and rerank behavior (mostly as soft constraints).

## Stage E: Detection job creation

The orchestrator builds search jobs from detections.

Two modes:

- `group_by_detection=true`: one job per detection instance
- default mode: dedupe by same-label IoU then category-level confidence dedupe

Each detection job receives:

- region/label/confidence context
- category mapping and aisle/type hints
- per-detection embeddings
- session/user constraints
- local search budgets and retry budget

## Stage F: Per-detection search execution

Jobs execute with controlled concurrency.

Each job attempts staged retrieval with bounded retries:

1. initial search
2. optional deterministic second pass
3. retry/fallback ladder when results are weak/empty:
   - drop style constraints
   - drop hard type constraints
   - drop sleeve/length constraints
   - category fallback
   - structural fallback
   - multicrop fallbacks
   - category-specific recovery branches (tops/footwear/bags, ablation variants)

Guardrails during this stage:

- max search calls per detection
- max detection task wall-clock budget
- concurrency throttling across detections

## Stage G: Candidate consolidation and quality gates

After all jobs settle:

1. merge group outputs
2. apply relevance gate thresholding
3. optionally collapse variant groups
4. recompute counts and totals
5. compute coverage stats:
   - total detections
   - covered detections
   - empty detections
   - coverage ratio

## Stage H: Outfit coherence computation

A coherence module evaluates final detection set (with inferred colors) to produce:

- overall coherence score
- pair/category/style compatibility signals
- coherence metadata/recommendation context

This is additive metadata, not the primary search selector.

## Stage I: Response pagination and shaping

Controller performs final slicing:

1. products pagination inside each group
2. detection-group pagination across groups

Then returns:

- `success`
- analysis/detection payload
- `similarProducts` grouped output + pagination metadata
- `outfitCoherence`
- timing/observability fields

Raw internal embedding payload is excluded from client response.

---

## 5) Detailed Component Roles

## 5.1 YOLO role

YOLO is the structural perception engine:

- detects wearable objects
- outputs labels, boxes, confidences, area ratios
- determines retrieval topology (per-item vs fallback)
- informs category mapping and confidence-aware decisions

YOLO is not the product ranker.

## 5.2 CLIP role

CLIP is the visual retrieval backbone:

- computes vector embeddings for query image/crops
- drives vector kNN candidate retrieval
- supplies base visual similarity signal

CLIP is high-recall; downstream gates improve precision.

## 5.3 BLIP role

BLIP is semantic enrichment:

- provides caption and structured semantic hints
- helps disambiguate ambiguous detections
- contributes type/style/color/audience soft alignment

BLIP improves semantic precision, but retrieval still works if BLIP is unavailable.

## 5.4 Category mapping and taxonomy role

Mapping translates detection labels into catalog-aware search intent:

- macro category alignment
- search category alternatives
- lexical type expansion seeds

This is essential for reducing cross-category leakage.

## 5.5 Session/user context role

If `session_id`/`user_id` is present:

- accumulated session filters can be merged
- retrieval receives contextual constraints/preferences

This influences candidate compliance/ranking behavior.

---

## 6) Similarity, Color, and Style: Real Scoring Behavior

## 6.1 Similarity is multi-layered

Similarity is not one number.

Practical acceptance emerges from layered stages:

1. kNN visual proximity (CLIP-space retrieval)
2. category/type alignment checks
3. soft attribute compliance (color/style/audience/material)
4. final relevance scoring/gating

Request threshold is only one part of final keep/drop.

## 6.2 Color behavior

Color intent is fused from multiple sources:

- caption-derived color hints
- dominant color extraction
- per-detection inferred colors with confidence

Color usually acts as soft rerank/compliance signal, with safeguards against over-hard filtering due to noisy color inference.

## 6.3 Style behavior

Style/occasion/material hints (from BLIP + context) bias reranking.
When style over-constrains sparse detections, retry stages can drop style constraints to recover recall.

---

## 7) Retrieval Engine Behavior (Inside Each Search Call)

Per detection search call uses adaptive retrieval:

1. choose kNN strategy (`embedding`, `embedding_garment`, or combined behavior)
2. retrieve candidate pool with configured limits
3. if garment recall sparse, merge fallback/global embedding candidates
4. sparse-kNN fallback with relaxed filter set when over-pruned
5. threshold visual gate
6. optional relax-when-empty floor behavior
7. compliance rerank and final relevance score computation
8. dedupe and variant collapse

This creates precision-first outputs while preserving recovery paths.

---

## 8) Retry/Fallback Architecture

Fallback logic exists at multiple levels:

1. **Detection level**
   - retry on empty detections
   - accessory recovery pass

2. **Pipeline topology level**
   - full-image fallback branch when detection path is not viable

3. **Per-detection retrieval level**
   - staged constraint dropping
   - category and structural fallbacks
   - multicrop and category-specific recoveries

4. **kNN internals**
   - sparse-recall fallback
   - timeout/retry behavior

All fallback paths are bounded by budgets to avoid unbounded latency.

---

## 9) Related Results and pHash in this Endpoint

`api/images/search` is primarily detection-group retrieval.

Related/pHash behavior exists in the broader image-search engine, but for this endpoint path:

- main contract is `similarProducts.byDetection`
- pHash-related list is auxiliary and not the core grouped deliverable

Identity and near-exact mechanisms exist in search internals, but grouped shop-the-look results remain primary.

---

## 10) Observability and Runtime Signals

The pipeline tracks timing/quality dimensions such as:

- stage timing breakdowns
- per-detection search call counts
- executed vs skipped fallback reasons
- kNN timeout/sparsity indicators
- coverage metrics (covered/empty detections)
- relevance gate before/after impact

These metrics support production debugging and tuning.

---

## 11) Output Contract (Logical)

Main response blocks:

- `success`
- detection/analysis details
- `similarProducts`:
  - `byDetection`
  - total counts
  - threshold
  - detected categories
  - shop-the-look coverage stats
  - pagination metadata
- `outfitCoherence`
- timing/debug metadata (when enabled)

The endpoint always aims for structured partial success when possible, rather than all-or-nothing failure.

---

## 12) Precision vs Recall Design Philosophy

The architecture intentionally balances:

- **Recall preservation**
  - broad retrieval pools
  - adaptive fallback ladders
  - full-image fallback branch

- **Precision control**
  - category/type compliance
  - color/style/audience alignment
  - final relevance gating
  - dedupe/variant collapsing

This is why behavior is robust under noisy images, sparse metadata, and heterogeneous catalogs.

---

## 13) Failure and Degradation Model

If any subsystem degrades:

- weak/empty detections -> retries and fallback topology
- missing BLIP -> visual path continues with reduced semantic precision
- sparse/slow retrieval -> relaxed bounded fallback calls
- per-detection failure -> other groups can still succeed

The endpoint is designed for graceful degradation and partial-yet-structured outputs.

---

## 14) Practical Reading of Results

For consumers of this endpoint:

1. Treat `byDetection` as the canonical product output.
2. Use coverage stats to understand confidence and completeness.
3. Use coherence as outfit-level quality signal, not strict retrieval correctness.
4. Use pagination metadata because detection and product pagination are independent axes.
5. Expect variability across detections based on confidence, category metadata quality, and fallback activation.

---

## 15) Concise Architectural Summary

`POST /api/images/search` is a resilient hybrid pipeline that decomposes a photo into detected fashion intents, executes adaptive per-item vector retrieval with semantic/color/style guidance, then applies strict quality gates and returns a grouped, paginated, coherence-aware result graph designed for real-world noisy inputs.

