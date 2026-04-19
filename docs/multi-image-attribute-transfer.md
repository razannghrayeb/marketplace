# Multi-Image Attribute Transfer Search

Last updated: 2026-04-09

## Purpose

This feature lets users combine fashion attributes across multiple reference images with a natural-language prompt.

Example intent:
- color from first image
- style from second image

Primary endpoint:
- POST /search/multi-image

Advanced endpoint:
- POST /search/multi-vector

## What Problem It Solves

Classic image search returns items similar to one image as a whole.
This feature supports compositional search, where each image contributes different attributes.

Examples:
- color from image 1 + style from image 2
- pattern from image 2 + silhouette from image 1
- style from image 1, but not shiny

## High-Level Architecture

1. HTTP request ingestion (multipart images + prompt)
2. Intent extraction (local-first, Gemini optional)
3. Prompt-aware and image-aware attribute enrichment
4. Composite embedding/query generation
5. OpenSearch retrieval
6. Relevance scoring and hard constraints
7. Constraint relaxation to preserve recall
8. Hydration from PostgreSQL + final rerank + response telemetry

Core files:
- src/routes/search/search.controller.ts
- src/routes/search/search.service.ts
- src/lib/prompt/gemeni.ts
- src/lib/query/compositeQueryBuilder.ts
- src/lib/query/queryMapper.ts
- src/lib/search/searchHitRelevance.ts
- src/lib/image/blipStructured.ts
- src/lib/color/quickImageColor.ts

## API Contract

### POST /search/multi-image

Content type:
- multipart/form-data

Required form fields:
- images: one or more images (max MAX_MULTI_IMAGE_UPLOADS)
- prompt: user intent text

Optional form fields:
- limit: integer (default 50)
- rerankWeights: JSON string/object

Success response shape:
- success: boolean
- results: ranked product list
- total: count returned
- tookMs: latency
- explanation: pipeline explanation summary
- compositeQuery: effective query object (embeddings, filters, constraints)
- meta: pipeline telemetry and fallback flags

### POST /search/multi-vector

For explicit attribute weights.
Useful when the caller wants deterministic weighting rather than natural-language mapping.

## Detailed Pipeline

### 1) Request Parsing and Validation

Implemented in search controller.

Behavior:
- validates image presence
- validates prompt presence
- caps upload count
- parses optional rerankWeights JSON
- forwards to multiImageSearch in search service

### 2) Image Preprocessing

Preprocesses incoming images before embedding and analysis.

Goal:
- stabilize inference quality
- ensure consistent input format for downstream embedding and BLIP analysis

### 3) Intent Provider Resolution

The service supports two providers:
- local (default)
- gemini (optional)

Provider resolution:
- MULTI_IMAGE_INTENT_PROVIDER=local or gemini

Local mode characteristics:
- no dependency on Gemini/OpenAI
- deterministic fallback behavior
- heavily uses prompt anchors and BLIP-derived hints

Gemini mode characteristics:
- parsed through IntentParserService
- bounded by time budget and per-call timeout
- degraded fallback returns clip-only intent if unavailable

### 4) Prompt-Anchor Mapping

The system maps attributes to specific image indexes.

Supported anchor kinds:
- color
- style
- texture/material
- pattern
- silhouette/fit

Supported references:
- first/second/third/... image
- image 1/image 2
- last/final image

Robust separator handling:
- supports and, ans, comma, ampersand, plus
- clause-local matching reduces cross-clause ambiguity

This is how prompts like:
- color from first image and style from second image
are translated into image-intent rows.

### 5) Local Enrichment for Missing Signals

When local or degraded mode is active, enrichment functions add strict, practical signals.

Includes:
- type hints from BLIP productTypeHints (consensus and style-anchored preference)
- color hints from caption colors + quick image color hints
- neutral-color de-biasing (preference for vivid garment colors over background neutrals)
- mustHave/category reinforcement using inferred type terms

Key outcomes:
- better type compliance
- less white-background color drift
- improved behavior for cross-image prompts

### 6) AST Parsing and Prompt Overrides

The prompt is parsed via query AST pipeline.

Behavior:
- processQueryAST first
- fallback to processQueryFast if needed
- merge AST entities into parsed intent

Merged constraints may include:
- category
- brands
- gender
- price range
- mustHave terms

### 7) Composite Query Build

The service builds a composite query from:
- per-image embeddings
- per-attribute intent rows
- merged filters/constraints

Then it optionally blends prompt CLIP embedding into global vector:
- controlled by MULTI_IMAGE_PROMPT_EMBED_WEIGHT

### 8) Retrieval

OpenSearch query is generated via query mapper.

Modes:
- strict constraint mode when prompt signals are strong
- relaxed fallback query when strict retrieval yields zero hits

Candidate sizing:
- dynamic by limit and strictness mode

### 9) Relevance Scoring

The service computes a multi-signal relevance profile per hit.

Includes:
- productTypeCompliance
- colorCompliance
- audienceCompliance
- categoryRelevance01
- crossFamilyPenalty
- finalRelevance01

This profile is used for:
- sorting
- threshold gating
- response diagnostics

### 10) Hard Constraints and Adaptive Relaxation

Strict prompt constraints can enforce:
- type consistency
- color consistency
- required keywords
- pattern/length requirements
- forbidden terms

Adaptive color gating:
- supports requiredColorTerms and minColorCompliance
- applies staged relaxation to avoid dead-end zero results

Relaxation stages:
1. reduce required keyword pressure and lower compliance thresholds
2. drop strict color/type enforcement if needed

This keeps precision high while avoiding empty responses.

### 11) Product Hydration and Final Rerank

After retrieval and gating:
- product IDs are hydrated from PostgreSQL
- intent-aware rerank is applied with tunable weights
- final result filtering and dedupe run

Final output includes:
- vectorScore and compositeScore (normalized)
- rerankScore and rerankBreakdown
- relevanceCompliance object
- explanation and meta telemetry

## Telemetry and Debug Signals

Useful response fields:
- explanation
- compositeQuery.filters
- compositeQuery.mustHave
- meta.intent_provider
- meta.intent_degraded_reason
- meta.pipeline_counts
- meta.hard_constraint_relaxation_level
- meta.final_floor_fallback_used

These fields are critical for diagnosing precision vs recall behavior.

## Configuration

Important environment variables:

Intent provider and Gemini guards:
- MULTI_IMAGE_INTENT_PROVIDER
- MULTI_IMAGE_GEMINI_BUDGET_MS
- MULTI_IMAGE_GEMINI_CALL_TIMEOUT_MS
- GEMINI_INTENT_MAX_RETRIES

Prompt/vector mixing:
- MULTI_IMAGE_PROMPT_EMBED_WEIGHT
- MULTI_IMAGE_STRICT_PROMPT

Search precision/thresholds:
- SEARCH_FINAL_ACCEPT_MIN_IMAGE
- SEARCH_IMAGE_MIN_RESULTS
- SEARCH_IMAGE_RELEVANCE_RELAX_DELTA
- SEARCH_CROSS_FAMILY_PENALTY_WEIGHT

Color behavior:
- SEARCH_COLOR_POSTFILTER_STRICT

## Typical Failure Modes and Fix Strategy

### A) Empty result set

Symptoms:
- UI shows no matching products
- strong constraints and high strictness

Mitigations already built:
- retrieval fallback (strict -> relaxed)
- hard-constraint staged relaxation
- adaptive color relaxation
- final floor fallback when appropriate

### B) Good type, poor color compliance

Symptoms:
- productTypeCompliance high
- colorCompliance mostly zero

Likely causes:
- prompt anchor not parsed
- extracted color too uncertain
- color gate too strict for catalog metadata quality

Mitigations:
- clause-local anchor parser
- caption + quick color fusion
- requiredColorTerms + minColorCompliance + staged relaxation

### C) Cross-clause anchor ambiguity

Symptoms:
- explanation missing mapped attributes
- prompt says color/style from different images but mapping is empty

Mitigations:
- clause splitting on and/ans/comma/&/+ and local matching
- reduced bridge span leakage across clauses

## How To Extend Safely

1. Add new attribute kinds:
- update promptAnchorKindRegex
- map extraction logic in enrichment
- add scoring signal in relevance calculator

2. Add domain-specific constraints:
- extend buildMultiImageHardConstraints
- ensure relaxMultiImageHardConstraints has safe degradation path

3. Tune ranking without regressions:
- keep meta telemetry fields intact
- A/B with strict and relaxed thresholds
- track color/type compliance distributions, not only click metrics

## Verification Checklist

For each deployment, verify:

1. Prompt anchoring:
- color from first image and style from second image
- explanation must include both mapped attributes

2. Constraint propagation:
- compositeQuery.filters includes expected color/producttype terms
- mustHave contains intended type signals

3. Compliance quality:
- top results should show non-zero colorCompliance when color transfer is requested
- type compliance should remain high under dress-focused prompts

4. Recall safety:
- no unexpected zero-result regressions for valid prompts

5. Provider traceability:
- meta.intent_provider is present
- intent degradation reasons are visible when fallback occurs

## Related Docs

- docs/SEARCH_API_COMPLETE.md
- docs/embeddings-and-search-pipelines.md
- docs/multi-vector-search.md
- docs/api-reference.md
