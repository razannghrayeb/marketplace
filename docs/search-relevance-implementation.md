# Search relevance redesign — implementation guide

This document matches the codebase in `src/routes/search/search.service.ts`, `src/lib/search/productTypeTaxonomy.ts`, `src/lib/search/searchDocument.ts`, `src/routes/products/products.service.ts`, and migration `db/migrations/010_fashion_search_taxonomy.sql`.

---

## Jeans / product-type recall (kNN `must` trap)

Single-token queries like `jeans` set `productTypes` in QueryAST, which **disabled** hard AST category mode. Hybrid search then put **CLIP kNN in `must` with `min_score`**, intersecting BM25. Text–image space mismatch removed most category/title matches. **Fix:** `isProductTypeDominantQuery` (≤2 words, no brand, has `productTypes`) uses the same **kNN-as-`should` boost** path as category-dominant queries, plus looser `minimum_should_match` on text.

---

## 1. Code changes (implemented)

| Area | Change |
|------|--------|
| Taxonomy graph | `src/lib/search/productTypeTaxonomy.ts` — clusters, query expansion, indexing hypernyms, soft match score |
| OpenSearch docs | `buildProductSearchDocument` adds hypernyms to `product_types` (e.g. jeans → pants) |
| Text search | Default **soft** product-type boost + taxonomy rerank; `SEARCH_STRICT_PRODUCT_TYPE=1` restores hard filter |
| Image search | `SEARCH_IMAGE_SOFT_CATEGORY=1` drops hard category filter, reranks kNN with aisle hints via `predictedCategoryAisles` |
| DB (Phase 2) | `010_fashion_search_taxonomy.sql` — canonical types, aliases, edges, `product_search_enrichment` |
| Types | `src/lib/search/taxonomyTypes.ts`, `ImageSearchParams.predictedCategoryAisles` |

**Reindex:** Run your embedding/index pipeline after deploy so existing documents get enriched `product_types`.

---

## 2. Data model

### Minimal (Phase 1 — shipped in code)

- No new tables required.
- Taxonomy lives in `productTypeTaxonomy.ts`.
- OpenSearch fields: `product_types[]`, `category`, `category_canonical`, `title`, embeddings.

### Ideal (Phase 2 — SQL)

See `taxonomyTypes.ts` and migration `010_fashion_search_taxonomy.sql`:

- `canonical_product_types(id, slug, display_name, parent_id)`
- `product_type_aliases(canonical_id, alias, locale, source, weight)`
- `product_type_edges(from_id, to_id, kind, weight)` — `parent | related | sibling_cluster`
- `product_search_enrichment(product_id, canonical_type_ids[], confidences, attribute_json, raw_*)`

Loader job: sync DB edges → in-memory graph or periodic export to JSON consumed by API pods.

---

## 3. Search pipeline redesign

### Text query

| Step | Input | Output | When | Online/offline |
|------|--------|--------|------|----------------|
| QueryAST | raw `q` | `searchQuery`, entities, expansions | **Now** | Online |
| Merge filters | AST + caller | merged filters | **Now** | Online |
| Candidate gen | bool query | OS hits | **Now** | Online |
| Hybrid | CLIP text embedding | kNN + BM25 | **Now** | Online |
| Rerank | hits + AST | order + `explain` | **Now** | Online |
| Normalization job | raw vendor rows | `product_search_enrichment` | Later | Offline |
| ML ranker | features | tie-break | Optional | Online |

### Image query

| Step | Input | Output | When | Online/offline |
|------|--------|--------|------|----------------|
| Embedding | crop / full image | vector | **Now** | Online |
| Detection | YOLO | labels + boxes | **Now** | Online |
| Category map | label | aisle + alternatives | **Now** | Online |
| kNN | vector | top-k | **Now** | Online |
| Soft aisle rerank | hints + `_source` | order | **Now** (flag) | Online |
| Type classifier on image | crop | predicted types | Later | Online or offline |

---

## 4. Viable fix (biggest gain / effort)

1. **Soft product-type retrieval + taxonomy rerank** (done) — fixes pants/jeans without hard intersect.
2. **Index-time hypernyms on `product_types`** (done) — jeans documents match pants intent after reindex.
3. **`SEARCH_IMAGE_SOFT_CATEGORY=1` in prod** after QA — fixes brittle category filters on image search.
4. **Reindex** — required for (2) on existing catalog.

---

## 5. Task breakdown

### Phase 1: Quick wins

- [x] Taxonomy module + text soft boost + rerank
- [x] Index enrichment for `product_types`
- [x] Image soft category mode + wiring from image-analysis
- [ ] Full catalog reindex (ops ticket)
- [ ] Enable `SEARCH_IMAGE_SOFT_CATEGORY=true` on staging → prod

### Phase 2: Structural

- [ ] Apply `010_fashion_search_taxonomy.sql`
- [ ] Ingest job: write `product_search_enrichment` from rules + ML
- [ ] Index builder: merge enrichment into OpenSearch document
- [ ] Admin UI or script to edit aliases/edges

### Phase 3: Advanced relevance

- [ ] Learned cross-encoder rerank on top 50
- [ ] Query/session features (CTR, purchases)
- [ ] Image→type classifier probabilities in score
- [x] Eval hooks: `src/lib/search/evalHooks.ts` + `pnpm run search:eval` (query set + optional labels JSON)

---

## 6. API signatures (reference)

```ts
// src/lib/search/productTypeTaxonomy.ts
export function expandProductTypesForQuery(seeds: string[]): string[];
export function expandProductTypesForIndexing(types: string[]): string[];
export function scoreProductTypeTaxonomyMatch(
  queryTypes: string[],
  docTypes: string[],
  opts?: { sameClusterWeight?: number },
): TaxonomyMatchResult;

// buildProductSearchDocument — product_types use expandProductTypesForIndexing
```

---

## 7. Ranking formula (implementation-ready)

**Stage A — OpenSearch:** bool `must` (BM25 + optional kNN min_score), `should` (entity boosts + soft product_types), `filter` (price, hidden, caller category, strict flags).

**Stage B — Deterministic rerank** (`textSearch`):

Let `sim = normalized OS score ∈ [0,1]`, `type = scoreProductTypeTaxonomyMatch(...) ∈ [0,1]`, `col = color compliance ∈ [0,1]`.

```
rerankScore = type * 1000 + col * 100 + sim * 10
```

**Weights (tunable env later):**

| Feature | Weight | Notes |
|---------|--------|--------|
| Taxonomy type match | 1000 | Exact type = 1.0; same cluster = 0.82 (default) |
| Color compliance | 100 | Keeps existing behavior |
| Lexical/semantic blend | 10 | OS normalized score |

**Taxonomy distance:** Not tree distance yet — cluster membership yields 0.82; exact token 1.0. Phase 2 can replace with weighted graph shortest path capped at 1.

**Confidence (future):** Multiply type contribution by `min(category_conf, norm_conf)` from `product_search_enrichment`.

**Image blend (soft category mode):**

```
score = visualSim * 1000 + categorySoft * 220
```

`categorySoft ∈ {0, 0.88, 1}` from aisle term set vs `category`, `category_canonical`, `product_types`.

**Pants vs jeans:** Query expands to cluster; document has `jeans` + indexed `pants`; rerank gives type=1 or 0.82.

---

## 8. Example walkthroughs

### `pants`

- **Intent:** `productTypes: [pants]`, maybe `category: bottoms`
- **Expansion:** cluster includes jeans, chinos, …
- **Retrieval:** soft `should` on `product_types` + title (no hard filter unless strict env)
- **Rerank:** jeans-only doc matches via cluster or hypernym `pants` on doc after reindex
- **Why better:** No exclusion of jeans rows at filter stage

### `white sneakers`

- **Intent:** colors [white], types [sneakers → shoes cluster]
- **Retrieval:** color filter on `attr_color` / `attr_colors` + soft footwear expansion
- **Rerank:** high `col` for white, high `type` for sneakers/trainers/shoes cluster

### `formal black shoes`

- **Intent:** colors [black], types [shoes]; style "formal" from title/BM25
- **Retrieval:** BM25 on title/description; optional style embedding if indexed
- **Rerank:** type cluster lifts oxfords/loafers/heels with shoes

### Image: blue denim jeans

- **Detection:** trousers/jeans → aisle `bottoms` or mapped category
- **Soft mode:** kNN without hard `category` filter; hints `["bottoms", ...]`
- **Rerank:** visual sim primary; catalog rows matching bottoms/jeans/pants boosted
- **Why better:** Mis-tagged `category: "nike"` no longer zero-results

---

## 9. Common mistakes

- Hard-filtering product type before union retrieval
- Treating vendor `category` as ground truth
- Putting brand strings into category filters
- Expanding query to entire catalog (cap expanded terms ~24 in OS clause)
- Requiring image classifier type == doc type (use soft score only)
- **Intersecting** BM25 ∩ kNN ∩ category instead of union + rerank

---

## 10. Recommendation

**Ship:** soft product-type behavior (default), reindex, then enable `SEARCH_IMAGE_SOFT_CATEGORY` on staging.

**Long term:** DB-backed taxonomy + `product_search_enrichment` + learned reranker + offline evaluation sets (labeled queries).

---

## Evaluation hooks & offline script

- **Runtime:** Set `SEARCH_EVAL_LOG=1` (or `true` / `jsonl`). Each text search emits one JSON line prefixed with `[search_eval]`; image similarity search does the same when eval is enabled.
- **File sink:** `SEARCH_EVAL_LOG_FILE=/path/to/eval.jsonl` appends the same JSON (one object per line).
- **A/B label:** `SEARCH_EVAL_VARIANT=control|treatment_b` is included on every payload.
- **Stable id:** Pass `evalCorrelationId` in `textSearch(..., { evalCorrelationId })` to correlate with request logs.
- **Offline batch:** `pnpm run search:eval` runs `scripts/search-eval-queries.example.json`. Optional second arg: labels JSON mapping query string → relevant product id list for P@k / R@k.

---

## Feature flags

| Env | Effect |
|-----|--------|
| `SEARCH_STRICT_PRODUCT_TYPE=true` | Legacy hard filter on product type |
| `SEARCH_IMAGE_SOFT_CATEGORY=true` | Image search: no hard category filter; soft rerank |
| `SEARCH_STRICT_CATEGORY_DEFAULT=true` | Existing AST category hard filter behavior |
| `SEARCH_EVAL_LOG=1` | Emit structured search eval JSON (text + image paths) |

## Rollout

1. Deploy API + reindex in low traffic window  
2. A/B: 10% traffic strict vs soft (log `relaxedUsed`, hit counts)  
3. Enable image soft category after text metrics stable  
