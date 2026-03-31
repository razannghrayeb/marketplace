# Embeddings & search pipelines

**Last updated:** March 2026  

This document is the **architecture reference** for how **vector embeddings** are produced, stored in **OpenSearch**, and consumed by **text** and **image** search. It complements:

- `text-search-architecture.md` — detailed **QueryAST → OpenSearch bool** flow for **`GET /search`**
- `image-embedding-pipeline.md` — **preprocessing** (Sharp, crops, normalization, ONNX internals)
- `multi-vector-search.md` — **multi-vector kNN** weighting and blending
- `search-relevance-implementation.md` — **reranking** (`computeHitRelevance`, color/type gates)

---

## 1. Mental model

| Layer | Role |
|--------|------|
| **Postgres** | Source of truth for products and `product_images`; stores primary image **CLIP vector** per row (`embedding` column, `pgvector`) for DB-side use. |
| **OpenSearch** | Search index: **BM25** on text + **kNN** on one or more **dense vectors** per product document. |
| **Runtime (Node)** | CLIP ONNX for image/text vectors; optional **BLIP** caption; **YOLO** (HTTP sidecar) for category hints; **attribute** CLIP fusion for color/style/pattern signals. |

**Retrieval** is mostly “**broad kNN / bool recall → hydrate from Postgres → rerank in app**”, not a single embedding score.

---

## 2. OpenSearch vector fields (products index)

Defined in `src/lib/core/opensearch.ts` (`ensureIndex`). All `knn_vector` fields use **cosinesimil** + **FAISS HNSW**. Dimension = `EXPECTED_EMBEDDING_DIM` (default **512**, must match the CLIP model).

| Field | Purpose |
|--------|---------|
| `embedding` | **Primary image** CLIP vector — main **image search** kNN field and default **text hybrid** visual field. |
| `embedding_garment` | **Garment-focused** CLIP vector (`processImageForGarmentEmbedding`) — less background; optional kNN via `SEARCH_IMAGE_KNN_FIELD` / dual fusion. |
| `embedding_color` | Attribute-aligned vector (indexing + query-time **image** attribute embedding) for color-aware similarity. |
| `embedding_style` | Same pattern for **style** aesthetic. |
| `embedding_pattern` | Same pattern for **pattern / print**. |
| `embedding_texture` | Reserved for texture-focused vectors when populated at index time. |
| `embedding_material` | Reserved for material-focused vectors when populated at index time. |

Lexical / filter fields used with vectors include `product_types`, `category`, `attr_*`, `color_*`, `is_hidden`, etc. See the same mapping file for the full schema.

---

## 3. Ingestion pipeline (catalog → index)

High-level flow:

```text
Product image upload / reindex
  → validate + optional garment color analysis
  → CLIP: processImageForEmbedding(buffer)  → global vector
  → CLIP: processImageForGarmentEmbedding(buffer) (optional) → garment vector
  → pHash (duplicate / related-by-image)
  → Postgres: product_images.embedding, p_hash, cdn_url
  → buildProductSearchDocument(...) in src/lib/search/searchDocument.ts
  → OpenSearch index API (bulk or single doc)
```

**Key code paths**

| Step | Location |
|------|-----------|
| Upload & embed | `src/routes/products/images.service.ts` — `uploadProductImage`, `updateProductIndex` |
| Document shape | `src/lib/search/searchDocument.ts` — `buildProductSearchDocument` writes `embedding`, `embedding_garment`, and optional `embedding_*` from `attributeEmbeddings` |
| Backfill / reindex | `scripts/resume-reindex.ts` (and related npm scripts) — recomputes embeddings and refreshes OpenSearch docs |

At index time, **attribute vectors** (`embedding_color`, …) are included when `input.attributeEmbeddings` is passed into `buildProductSearchDocument`. If a reindex job does not compute them, those fields may be missing on older documents until backfilled.

---

## 4. Image search pipeline (query image → results)

**HTTP:** `POST /products/search/image` (multipart `image`) — `src/routes/products/products.controller.ts` → `searchImage` in `src/lib/search/fashionSearchFacade.ts` → `searchByImageWithSimilarity` in `src/routes/products/products.service.ts`.

**Request-time steps (typical)**

1. **Validate** image; require CLIP available (`isClipAvailable()`).
2. **Quick color hints** — `src/lib/color/quickImageColor.ts` (`extractQuickFashionColorHints`) seeds `filters.colors` for reranking when the user did not pass color filters.
3. **Parallel-ish compute:** CLIP **global** embedding, **garment** embedding, **pHash**; **BLIP** caption is **time-capped** (`config.search.blipCaptionTimeoutMs`) and feeds **product type** lexical seeds (`extractLexicalProductTypeSeeds`) when it finishes in time.
4. **Facade:** optional **YOLO** category hints via `inferPredictedCategoryAislesFromImage` (time-capped with `SEARCH_IMAGE_YOLO_TIMEOUT_MS`) to soft-bias category / type.
5. **OpenSearch:** **kNN** on `embedding` (large `k`, e.g. `SEARCH_IMAGE_RETRIEVAL_K`) with catalog **filters** (hidden, category, gender, …).
6. **Query-side attribute embeddings:** from the **same upload buffer**, parallel CLIP attribute encodings (`attributeEmbeddings.generateImageAttributeEmbedding` for color / style / pattern) — used to score hits against stored `embedding_color` / `embedding_style` / `embedding_pattern` on candidates (not necessarily a second full kNN for each).
7. **Composite score** — blends visual similarity, category soft match, and attribute cosine scores (weights env-tunable, e.g. `SEARCH_IMAGE_RERANK_COLOR_WEIGHT`).
8. **Relevance layer** — `computeHitRelevance` (`src/lib/search/searchHitRelevance.ts`) applies type/color/audience intent; **final** filter uses `config.search.finalAcceptMinImage`.
9. **Optional related** — `findSimilarByPHash` when `includeRelated` and pHash present.

**Facade export:** `GET /products/search` title search and `POST /products/search/image` both route through `fashionSearchFacade.ts` so the storefront can share one mental model.

---

## 5. Text search pipeline (query string → results)

**Canonical diagram:** `docs/text-search-architecture.md`.

**Short summary**

1. **QueryAST** — `processQueryAST` in the query processor (normalize, entities, intent, expansions).
2. **Domain / fashion signal** — `computeEmbeddingFashionScore` (CLIP text vs fashion prototype) feeds **query understanding**; off-domain queries can short-circuit.
3. **OpenSearch bool** — BM25 / `multi_match` on title, description, brand, category, plus **filters** from AST + caller.
4. **Hybrid kNN** — when allowed, **text query embedding** (`getQueryEmbedding`) becomes a `should` **kNN** on `embedding` (same field as catalog primary image vector).
5. **Color intent** — when query understanding detects color intent, a **kNN** (or boosted clause) on `embedding_color` using **text attribute** embedding may apply.
6. **Post-retrieval** — `computeHitRelevance`, `finalAcceptMinText`, optional XGB ranker (`SEARCH_USE_XGB_RANKER`), hydration from Postgres.

**Key file:** `src/routes/search/search.service.ts` — `textSearch`.

---

## 6. Supporting services (same embeddings idea)

| Feature | Embedding use |
|---------|----------------|
| **Wardrobe** | On image upload, CLIP vector stored in Postgres and optionally indexed for similarity — `src/routes/wardrobe/wardrobe.service.ts` |
| **Complete style / outfits** | Multi-vector and OpenSearch in `src/lib/outfit/completestyle.ts` (see `MultiVectorSearchEngine`) |
| **Image analysis** | Richer vision flows in `src/routes/products/image-analysis.service.ts` (detection, similar items) |

---

## 7. Configuration cheat sheet

| Variable | Area |
|----------|------|
| `CLIP_MODEL_TYPE` | CLIP variant (e.g. fashion-clip) — keep in sync with training / index dim |
| `EXPECTED_EMBEDDING_DIM` | Must match OpenSearch `knn_vector` dimension and CLIP output |
| `OS_INDEX`, `OS_NODE` | OpenSearch target |
| `SEARCH_IMAGE_RETRIEVAL_K`, `SEARCH_IMAGE_RERANK_*_WEIGHT` | Image search recall and rerank blend |
| `SEARCH_BLIP_CAPTION_TIMEOUT_MS` | Cap BLIP for `/products/search/image` |
| `SEARCH_IMAGE_YOLO_TIMEOUT_MS` | Cap YOLO aisle inference in facade |
| `SEARCH_RECALL_WINDOW`, `SEARCH_FINAL_ACCEPT_MIN_TEXT`, `SEARCH_FINAL_ACCEPT_MIN_IMAGE` | Text/image relevance gates |

---

## 8. Operational checklist

1. After changing **CLIP model** or **dimension**: recreate or migrate index (`recreateIndex` / migrations), set `EXPECTED_EMBEDDING_DIM`, **reindex** all products.
2. If **image search** is slow: check BLIP cap, YOLO timeout, attribute embedding cache (`src/lib/cache/embeddingCache.ts`), and OpenSearch latency.
3. If **results ignore color**: ensure **query** passes color intent or quick hints run; confirm index has `attr_colors` / `color_*` and rerank weights; verify `embedding_color` backfill for older docs.

---

## 9. Related docs (by task)

| Task | Doc |
|------|-----|
| ONNX / resize / crop details | `image-embedding-pipeline.md` |
| QueryAST & bool query mermaid | `text-search-architecture.md` |
| Multi-vector fusion math | `multi-vector-search.md` |
| Hit-level relevance scores | `search-relevance-implementation.md` |
| API surface & feature map | **`FEATURES.md`**, `api-reference.md`, `SEARCH_API_COMPLETE.md` |
