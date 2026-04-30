# Compare Feature Pipeline (Detailed)

This document describes the compare feature based on current implementation.

It covers:

- route-level API contracts
- decision-intelligence compare flow (primary path for `POST /api/compare`)
- legacy compare engine and verdict generation
- adapter-based `/api/compare/decision` path
- review and enhanced compare sub-features
- scoring, mode resolution, and failure behavior

---

## 1) Routing and Entry Points

Compare routes are mounted at:

- `/api/compare` from `src/server.ts` via `src/routes/compare/index.ts`

Primary endpoints:

- `POST /api/compare` -> decision-intelligence compare service
- `POST /api/compare/decision` -> legacy compare adapter into new contract

Additional endpoints:

- `GET /api/compare/quality/:productId`
- `POST /api/compare/analyze-text`
- `GET /api/compare/price/:productId`
- `GET /api/compare/baseline/:category`
- `POST /api/compare/admin/compute-baselines`
- `GET /api/compare/tooltips`
- `GET /api/compare/reviews/:productId`
- `POST /api/compare/reviews`
- `POST /api/compare/enhanced`
- `GET /api/compare/inventory/:productId`
- `GET /api/compare/price-trend/:productId`
- `GET /api/compare/merchant/:productId`
- `GET /api/compare/shipping/:productId`

---

## 2) Main Pipeline: `POST /api/compare`

`POST /api/compare` is the main compare feature path and calls:

- `compareProductsWithDecisionIntelligence(...)`

### 2.1 Input normalization

Controller accepts both:

- JSON body (`product_ids`/`productIds`)
- multipart form-data (`multer().none()`)

`coerceCompareProductIdsInput(...)` supports:

- arrays of numbers
- arrays of numeric strings
- stringified JSON arrays
- comma/space/semicolon separated strings

### 2.2 Request schema validation

Decision-intelligence schema (`CompareDecisionRequestSchema`) accepts:

- `productIds` or `product_ids` (2..5 unique positive ints)
- compare goal fields (`compareGoal`, `compare_goal`, `requestedGoal`, `requested_goal`)
- occasion fields (`occasion`, `requestedOccasion`, `requested_occasion`)
- `comparisonMode`/`comparison_mode`
- `mode` (`standard`/`alter_ego`)
- `identityContext`
- `userSignals`
- `debug`

Validation failures return:

- `INVALID_REQUEST` -> HTTP 400

### 2.3 Product loading

Service loads products from DB (`products`) and normalizes to `RawProduct`:

- id/title/brand/category/gender
- price + sale price converted from cents to major units
- color/image arrays normalized
- inferred tags from text:
  - `material` from description keywords
  - `fit` from description keywords
  - `styleTags` from description/category keywords

If requested products are missing:

- `PRODUCTS_NOT_FOUND` with `missingProductIds` -> HTTP 404

If <2 products after normalization:

- `INSUFFICIENT_PRODUCT_DATA` -> HTTP 422

### 2.4 Comparability gate

`validateComparableProductSet(...)` blocks incompatible sets before scoring.

On failure, returns `INVALID_REQUEST` with details including:

- non-fashion/non-comparable IDs
- cross-gender conflicts
- cross-age conflicts
- category mismatch pairs
- human-readable reasons

### 2.5 Engine execution

If validation passes, service calls:

- `runCompareDecisionEngine(products, request, { publisher, version })`

Publisher emits telemetry events like:

- `compare_request_received`
- `compare_mode_resolved`
- `fallback_heuristics_used`
- `low_data_quality_detected`
- `why_not_both_triggered`
- `response_generated`

---

## 3) Decision-Intelligence Engine Internals

### 3.1 Product normalization into decision profiles

`normalizeProducts(...)` (engine normalization module) creates `ProductDecisionProfile` used by downstream scoring modules.

Profiles contain:

- style signals
- trust signals
- usage signals
- image-derived/visual proxies
- derived decision signals

### 3.2 Comparison mode resolution

Mode resolution logic (`modeResolver`):

1. infer major category group per product (tops/bottoms/one_piece/outerwear/footwear/accessories)
2. if multiple major groups -> `outfit_compare`
3. else if subtypes differ -> `scenario_compare`
4. else -> `direct_head_to_head`

If client forces `comparisonMode`, engine still logs whether it matches auto-resolved mode.

### 3.3 Scoring dimensions per product

For each product, engine computes normalized [0..1] scores:

- `value` (`scoreValue`)
- `quality` (`scoreQuality`)
- `style` (`scoreStyle`)
- `risk` (`scoreRisk`) (higher = safer)
- `occasion` (`scoreOccasion`)
- `practical` (`scorePractical`)
- `expressive` (`scoreExpressive`)

Additional decision signals:

- attraction score
- identity alignment (`currentSelf`, `aspirationalSelf`)
- friction index
- regret probability + regret flash
- consequences
- compliment prediction
- wear frequency estimate
- photo-reality gap
- hidden flaw
- micro-story

### 3.4 Goal-aware overall weighting

Engine starts with base weights (occasion-aware) then shifts by `compareGoal`:

- `best_value` boosts value
- `premium_quality` boosts quality
- `style_match` boosts style/expressive
- `low_risk_return` boosts risk/safety
- `occasion_fit` boosts occasion + style

Final overall score combines all dimension scores with these weights and is clamped [0..1].

### 3.5 Occasion mismatch penalty

When occasion is requested and product occasion score is weak, engine penalizes overall score.

Penalty severity is stronger for:

- `formal`, `work`, `party`

than for:

- `casual`, `travel`

### 3.6 Winner selection by context

Engine selects winners for many contexts:

- overall
- value, quality, style, risk, occasion
- practical, expressive, safest, mostExciting
- currentSelf, aspirationalSelf

For `overall`, if occasion is requested, only occasion-eligible products (occasion score threshold) are considered first.

### 3.7 Decision confidence

Confidence module consumes:

- sorted overall margins
- data quality score
- winner consistency across contexts
- all overall scores

Output:

- `clear_choice` / `leaning_choice` / `toss_up`
- confidence score
- explanation lines (with recommendation suffix appended by engine)

### 3.8 Why-not-both detection

`whyNotBoth` can activate when:

- top margin is small
- complementarity (practical vs expressive separation) is high

Output includes:

- explanation
- role labels (`daily_anchor` / `statement_lift`)

### 3.9 Outfit impact mode

When mode is `outfit_compare`, engine adds `outfitImpact` scoring.

### 3.10 Serialization

Response is finalized through:

- `serializeCompareDecisionResponse(...)`

---

## 4) `POST /api/compare/decision` (Adapter Path)

This route validates camelCase request (`compare-decision.schema.ts`) then runs:

- `runCompareDecision(...)`

Current behavior:

1. executes legacy compare engine (`compareProductsWithVerdict`)
2. maps legacy output to new decision response contract via adapter

Adapter notes:

- marked temporary in code comments
- emits placeholder/mapped values for newer fields not native to legacy engine
- uses `legacy-adapter-v1` response version

This endpoint is effectively a compatibility bridge.

---

## 5) Legacy Compare Engine (Core Heuristic Pipeline)

Legacy engine lives in `src/lib/compare/compareEngine.ts`.

### 5.1 Data fetch

Loads selected products with:

- title/brand/category/description
- color/gender
- price fields
- primary image pHash
- return policy

### 5.2 Per-product signals

For each product:

1. text quality analysis
2. price anomaly analysis
3. image originality analysis (LSH fast path)
4. return-policy parsing

### 5.3 Component scoring

Component scores:

- text score = text quality score
- price score = `100 - price risk`
- image score from originality/quality rules
- policy score from policy/returns/final-sale/window rules

Overall score:

- weighted blend: text 0.28, price 0.32, image 0.22, policy 0.18
- mapped to levels:
  - `green` >=70
  - `yellow` >=45
  - `red` <45

### 5.4 Compatibility and mode

Engine infers category groups. If products are cross-group:

- marks non-comparable
- switches to `outfit_compare`

If same group but subtype-diverse:

- `scenario_compare`

Else:

- `direct_head_to_head`

### 5.5 Goal-specific winners

Computes separate winners for:

- value
- quality
- style
- risk
- occasion

Requested goal selects leader. Margin thresholds determine confidence:

- >=20 high
- >=10 medium
- >=5 low
- otherwise tie

### 5.6 Shopping insights and alternatives

Engine produces:

- best quality/value/budget/weakest link
- evidence notes
- alternatives (better cheaper / better quality / similar style safer)
- risk summary per product
- timing insight (`buy_now` / `monitor` / `wait`)

### 5.7 Reason generation

Top reasons are derived from winner-vs-runner deltas/signals:

- description quality
- premium fabric
- sizing/care detail
- price stability/risk
- image originality
- return policy clarity

### 5.8 Failure behavior

If <2 requested products exist:

- throws `InsufficientProductsForCompareError` including missing IDs

---

## 6) Verdict Generator (Legacy Human Output Layer)

`verdictGenerator.ts` converts compare verdict into storefront-friendly narrative payload.

Outputs:

- verdict title/subtitle/recommendation
- bullet points (max 3)
- tradeoff text
- confidence label/description
- per-product summaries:
  - highlights
  - concerns
  - UI tooltips

Mode-aware templates:

- direct compare templates
- scenario compare subtitle override
- outfit compare guidance mode (no direct winner narrative)

Language safety:

- avoids legally risky wording like “scam/fake”

---

## 7) Enhanced Compare Subsystem

`compare-enhanced.service.ts` provides non-core operational/commercial enrichments:

- inventory estimation
- price trend volatility
- merchant reputation
- shipping/returns logistics

### 7.1 Endpoints

- `POST /api/compare/enhanced`
- and per-item enrichers (`inventory`, `price-trend`, `merchant`, `shipping`)

### 7.2 Composition

`getEnhancedComparison(productIds)` gathers all enrichments and computes:

- `total_cost_cents` = product price + standard shipping

Ranking helpers:

- `findBestValue`
- `findMostReliable`
- `findBestShipping`

Note:

- parts of enhanced data are currently simulated/placeholders (explicit in comments).

---

## 8) Review Analysis Paths

Review-specific compare endpoints delegate to sentiment module:

- single product review analysis
- multi-product review comparison

`POST /api/compare/reviews` supports optional pagination in response.

---

## 9) Error Mapping and HTTP Behavior

Main compare (`POST /api/compare`) maps service error codes to HTTP:

- `INVALID_REQUEST` -> 400
- `PRODUCTS_NOT_FOUND` -> 404
- `INSUFFICIENT_PRODUCT_DATA` -> 422
- fallback -> 500

Legacy insufficient-products exception is also handled in controllers with 404 + missing IDs payload.

---

## 10) Pagination Support in Compare Module

Pagination helper (`paginate=1|true`, `page`, `limit`) is used by:

- `GET /api/compare/tooltips`
- `POST /api/compare/reviews`

Limit is capped (`<=200`) and returns metadata:

- page/limit/total/total_pages/has_next/has_prev

---

## 11) Observability and Operability

Decision-intelligence path provides structured event publishing at key milestones.

Useful operational signals:

- mode resolution drift (requested vs auto mode)
- fallback heuristic usage (missing vision signals)
- low data quality events
- why-not-both trigger frequency
- confidence distribution (`clear_choice` vs `toss_up`)

---

## 12) End-to-End Compare Flow Summary

For `POST /api/compare`:

1. normalize/validate request
2. load and normalize products from DB
3. enforce comparability constraints
4. run decision-intelligence engine
5. compute multi-axis scores, winners, confidence, narratives
6. serialize and return decision response
7. optionally enrich response when `enhanced=true` is requested

For `POST /api/compare/decision`:

1. validate camelCase schema
2. run legacy compare + verdict
3. adapt to new decision contract
4. return compatibility payload

