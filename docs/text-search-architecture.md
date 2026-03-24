# Text search architecture

This document is the canonical flow for **enhanced** product text search (`textSearch` in `src/routes/search/search.service.ts`, exposed via `searchText` in `src/lib/search/fashionSearchFacade.ts` and `GET /api/search`).

## End-to-end flow (Mermaid)

```mermaid
flowchart TB
  subgraph ingress["Ingress"]
    REQ["GET /api/search q + filters"]
    PARSE["parseParameters\n(control params strip)"]
    NEGP["parseNegations (enhanced)\ncleaned query"]
    FACADE["searchText / textSearch"]
    REQ --> PARSE --> NEGP --> FACADE
  end

  subgraph qp["Query processor"]
    AST["processQueryAST\n(cache · normalize · script · tokenize · corrections · LLM · entities · intent · expansions)"]
    EF["computeEmbeddingFashionScore\n(CLIP text vs fashion prototype)"]
    QU["buildQueryUnderstanding\n(domain gate · borderline · expansion caps)"]
    AST --> EF
    EF --> QU
  end

  FACADE --> AST

  subgraph osbuild["OpenSearch query build"]
    BOOL["bool: must / should / filter / must_not"]
    BM25["multi_match on title · category.search · brand.search …"]
    COL["knn embedding_color\n(when color intent)"]
    TXTEMB["getQueryEmbedding → knn embedding\n(gated: not borderline; after domain gate)"]
    BOOL --> BM25
    QU -->|"single orchestration edge:\nexpansion terms · soft/hard filters · kNN mode"| BOOL
    QU -->|"hasColorIntent + color embedding"| COL
    AST -->|"searchQuery + entities\n(build must/should)"| BOOL
    COL --> BOOL
    TXTEMB --> BOOL
    NEGP -.->|"negationConstraints →\nappendNegationsToTextSearchBool"| BOOL
  end

  QU -->|"offDomain → early return\n(no retrieval embedding for search body)"| HALT["[] results"]
  AST -.->|"fashion signal only\n(needed before QU)"| EF

  subgraph exec["Execute & recover"]
    OS1["OpenSearch search (primary body)"]
    FB["Fallback / relax retries\n(parse safe · strip knn · relax filters)"]
    OS1 --> FB
    FB -->|"same bool shape;\ntracked in meta.retrieval.search_retry_trace"| OS1
  end

  BOOL --> OS1

  subgraph post["Post-retrieval"]
    REL["computeHitRelevance + hybrid stats"]
    GATE["finalAcceptMin gate"]
    HYDR["hydrate · dedupe"]
    RELP["findRelatedProducts"]
    OS1 --> REL --> GATE --> HYDR
    HYDR <-->|"Promise.all with getImagesForProducts"| RELP
  end
```

### Diagram notes (bug list alignment)

| Topic | How it is represented |
|--------|------------------------|
| **Single QU → bool edge** | One labeled edge from `buildQueryUnderstanding` to the bool builder. AST feeds lexical/entity structure separately; retrieval embedding is not drawn as AST → TXTEMB. |
| **Domain gate vs CLIP** | `computeEmbeddingFashionScore` runs before `buildQueryUnderstanding` because the score **is an input** to the domain blend (`queryUnderstanding.service.ts`). `getQueryEmbedding` for **search** runs only after `qu.offDomain` is false and `!qu.borderlineFashion`. |
| **COLOR knn** | Trigger is `hasColorIntent` (caller/AST colors) → `attributeEmbeddings.generateTextAttributeEmbedding` → `should` knn on `embedding_color`. |
| **EF → QU** | Fashion embedding score is consumed inside `buildQueryUnderstanding` (not a dead end in code). |
| **Fallback → bool** | Retries rebuild `bool` (must/should/filter); steps are recorded in `meta.retrieval.search_retry_trace` (and eval `flags.search_retry_trace`). |
| **Negations** | Enhanced route passes `negationConstraints` into `textSearch`; clauses are appended as `must_not` on index fields (`appendNegationsToTextSearchBool`). |
| **Related failures** | `findRelatedProducts` errors surface as `meta.related_fetch_error` when the fetch rejects. |
| **recallWindow vs finalAcceptMin** | `recall_size` fetches a window; `final_accept_min` filters after `computeHitRelevance`. When OpenSearch returns hits but the gate removes all, see `meta.retrieval` (`below_relevance_threshold`, counts). |

## Key files

| Stage | File |
|--------|------|
| Ingress / negation parse | `src/routes/search/search.controller.ts`, `src/lib/queryProcessor/parameterParser.ts`, `src/lib/queryProcessor/negationHandler.ts` |
| AST pipeline | `src/lib/queryProcessor/index.ts` |
| Query understanding | `src/lib/search/queryUnderstanding.service.ts` |
| Fashion embedding signal | `src/lib/search/fashionDomainSignal.ts` |
| OpenSearch body + retries | `src/routes/search/search.service.ts` (`textSearch`) |
| Relevance / gate | `src/lib/search/searchHitRelevance.ts`, `config.search.finalAcceptMin` |
| Related | `src/lib/search/relatedProducts.ts` |
| Config | `src/config.ts` (`recallWindow`, `finalAcceptMin`, …) |

## Improvement backlog (from product review)

- **A – Query cache before heavy AST** – L1: `getCachedQueryAST(raw, { useLLM, useMLIntent })`. L2: opt-in `SEARCH_QUERY_AST_REDIS=1` + Upstash (`queryAstRedisCache.ts`), TTL `SEARCH_QUERY_AST_REDIS_TTL_SEC`, locale segment `SEARCH_QUERY_AST_LOCALE`.
- **B – Proactive knn-in-must demotion** – `SEARCH_KNN_DEMOTE_LOW_FASHION_EMB=1` and score below `SEARCH_KNN_DEMOTE_FASHION_EMB_MAX` forces kNN should-boost before OpenSearch when `SEARCH_KNN_TEXT_IN_MUST=1`.
- **C – Observability** – `SEARCH_DEBUG=1` adds `meta.debug.pipeline_stages` (wall-clock markers). Extend as needed for spans export.
- **F – Gender filter** – `SEARCH_GENDER_UNISEX_OR` (default on) adds indexed `unisex` to strict/soft gender clauses for binary men/women-style queries.

## Environment variables (partial)

See `.env.example` for full list. Text search often uses: `SEARCH_DEBUG`, `SEARCH_RECALL_WINDOW`, `SEARCH_FINAL_ACCEPT_MIN_TEXT` (or legacy `SEARCH_FINAL_ACCEPT_MIN`), `SEARCH_EVAL_LOG`, `SEARCH_KNN_TEXT_IN_MUST`, domain gate flags in `queryUnderstanding.service.ts`. Image search uses `SEARCH_FINAL_ACCEPT_MIN_IMAGE` separately.
