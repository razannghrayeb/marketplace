# Detailed Embedding Pipeline Documentation

This document explains how embeddings are generated, validated, stored, and consumed in the marketplace search stack.

It covers:

- CLIP model/runtime behavior
- image embedding generation paths
- garment/crop embedding alignment
- query-time image preparation
- text embeddings
- attribute and part embeddings
- OpenSearch vector schema and retrieval implications

---

## 1) Embedding Architecture Overview

The system is built around **CLIP-space embeddings** and several embedding families:

1. `embedding` (primary full-image vector)
2. `embedding_garment` (garment ROI vector)
3. attribute vectors (`embedding_color`, `embedding_style`, etc.)
4. part vectors (`embedding_part_sleeve`, `embedding_part_toe`, etc.)
5. text vectors (for caption/query compatibility and text-related scoring paths)

All vector fields share one enforced dimension (`EXPECTED_EMBEDDING_DIM`, default `512`).

---

## 2) CLIP Runtime and Model Selection

## 2.1 Supported CLIP variants

Runtime supports:

- `fashion-clip` (preferred for apparel)
- `vit-l-14`
- `vit-b-32`

Model can be selected by `CLIP_MODEL_TYPE`.

## 2.2 Execution providers

CLIP ONNX sessions use provider chain from:

- `CLIP_EXECUTION_PROVIDERS`
- or `CLIP_USE_GPU`
- default: GPU-first with CPU fallback

If GPU provider fails, session falls back to CPU and logs fallback.

## 2.3 Session lifecycle

- guarded initialization (single in-flight init)
- separate image and text sessions
- BPE tokenizer bootstrap for text embeddings
- resilience via circuit breakers (`clip`, `clip-text`)

## 2.4 Dimension safety

Every embedding is validated against expected index dimension.  
If model output dimension differs from index expectation, initialization/embedding generation fails fast.

This prevents corrupt vectors entering index.

---

## 3) Image Embedding Core Path

The base image embedding flow:

1. resize to `224x224` using `fit: cover`
2. remove alpha
3. CLIP normalization (ImageNet/CLIP mean/std)
4. ONNX inference
5. L2 normalize output vector
6. assert dimension

Output is used for primary `embedding` field and multiple query paths.

---

## 4) Query Image Preparation (Alignment Layer)

Before query embedding, image may be transformed by query prep:

- background removal (rembg sidecar)
- mode:
  - `off`
  - `conditional` (default, same heuristic as catalog prep)
  - `always`

Why this exists:

- query and indexed vectors must live in similar visual distribution
- inconsistent preprocessing causes vector-space mismatch and threshold instability

Important design principle: query prep defaults to catalog-aligned behavior.

---

## 5) Garment Embedding Path (`embedding_garment`)

`embedding_garment` is a garment-focused vector path for shop-the-look precision.

## 5.1 Concept

Instead of embedding whole frame, pipeline embeds padded garment ROI (usually from detection box).

This improves discrimination for item-level retrieval (dress/top/shoe/etc.) where background/model pose should not dominate.

## 5.2 ROI strategy

If detection box exists:

- use padded ROI on prepared image
- scale box when prepared image dimensions differ from raw

If no valid box:

- fallback to center garment crop

## 5.3 Shop-the-look alignment helpers

The service uses dedicated helpers to ensure query-time garment vectors match indexing-time strategy:

- single detection embedding helper
- batched detection embedding helper (preprocess in parallel + batch CLIP forward pass)

This is critical for stable similarity on `embedding_garment`.

---

## 6) Full-Image vs Garment Embeddings

Both vectors can be used in retrieval:

- `embedding` = full-frame semantics/context
- `embedding_garment` = item-focused detail

Some query paths combine or fallback between both depending on category/recall quality.

Common behavior:

- prefer garment vector for detection-scoped jobs
- merge global vector candidates when garment recall is sparse

---

## 7) Text Embeddings

Text embeddings are produced by CLIP text model with BPE tokenization.

Key details:

- tokenizer is mandatory (no fake fallback embedding generation)
- token dtype depends on model variant (`int32` vs `int64`)
- serialized text encoder queue prevents concurrent ONNX contention
- vectors are normalized and dimension-validated

Text embeddings are used for:

- caption consistency checks
- semantic alignment/rerank contexts
- shared multimodal compatibility logic

---

## 8) Attribute Embeddings (Multi-Vector Signals)

In addition to primary image vectors, system supports per-attribute vectors:

- `embedding_color`
- `embedding_texture`
- `embedding_material`
- `embedding_style`
- `embedding_pattern`

Role:

- not always primary retrieval channel
- mostly rerank/compliance enhancement channels
- help separate visually close but semantically different items

These vectors are indexed with IVF+FP16 settings (optimized for fast secondary search/rerank use).

---

## 9) Part Embeddings (Fine-Grained Regions)

Part-level vectors are extracted from garment ROI for specific slots:

- sleeve, neckline, hem, waistline
- heel, toe
- bag handle, bag body
- pattern patch

Purpose:

- better fine-detail matching (e.g., neckline/sleeve/part patterns)
- support precision reranking beyond whole-garment similarity

Pipeline behavior:

- extract applicable parts
- embed each part crop
- skip failed parts gracefully
- store per-part vectors when available

---

## 10) OpenSearch Vector Schema

Vector fields are created as `knn_vector` with shared dimension.

Main differences by field family:

- primary/garment embeddings use HNSW + FP16
- attribute/part embeddings use IVF + FP16

Rationale:

- primary retrieval needs high-quality neighbor graph
- secondary channels prioritize speed for weighted reranking

---

## 11) Embedding Integrity and Failure Modes

## 11.1 Integrity guards

- strict dimension checks
- model/index dimension consistency checks at startup
- preprocessing alignment between query and catalog

## 11.2 Typical failure modes

1. model dimension mismatch vs index
2. inconsistent preprocessing between indexing and query
3. garment ROI mismatch between index and query path
4. missing text tokenizer causing text embedding failures

## 11.3 Graceful degradation

If specialized embedding channel fails (e.g., part/attribute), pipeline generally falls back to available channels instead of hard-failing request.

---

## 12) Performance Design

Embedding pipeline includes throughput optimizations:

- batch CLIP inference for multiple detection crops
- concurrency-limited preprocessing
- provider fallback logic
- selective channel use by path (primary vs rerank channels)

This keeps latency bounded in multi-detection image search flows.

---

## 13) How embeddings are used in image search (practical)

For `api/images/search`:

1. detection creates one or more query intents
2. per-intent vectors are generated (garment + sometimes full-frame support)
3. retrieval executes against vector index (`embedding` / `embedding_garment`)
4. fallback/merge logic expands candidate pool when sparse
5. attribute/part signals refine ranking
6. final relevance gates decide returned products

Embedding quality/alignment is therefore foundational for both recall and precision.

---

## 14) Operational Recommendations

1. Keep `CLIP_MODEL_TYPE` fixed across indexing and serving.
2. Keep `EXPECTED_EMBEDDING_DIM` aligned with active index mapping.
3. Avoid changing query/background-removal mode without re-validating retrieval quality.
4. Keep garment query mode aligned with indexing strategy (`aligned` recommended for detection-based catalog vectors).
5. Treat tokenizer/model artifact health as production dependency, not optional.

---

## 15) Summary

The embedding system is a multimodal, multi-vector architecture:

- CLIP image/text core vectors
- garment-aligned retrieval vectors
- attribute and part vectors for precision refinement
- strict dimension and preprocessing alignment safeguards

This design enables stable nearest-neighbor retrieval while supporting complex fashion-specific reranking behavior.

