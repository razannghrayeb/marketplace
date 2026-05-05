# CompleteStyle Unified Pipeline (Wardrobe + CompleteStyle)

This is the final technical spec for a single CompleteStyle pipeline.

- Wardrobe is integrated into the same ranking flow.
- `complete-look` is intentionally excluded.
- Each step includes inputs, processing rules, and outputs.

## 1) Request Contract

Endpoints:

- `GET /products/:id/complete-style`
- `POST /products/complete-style`
- `POST /products/complete-style/try-on`

Core options:

- `maxPerCategory`, `maxTotal`
- `priceRange.min/max`, `disablePriceFilter`
- `excludeBrands`, `preferSameBrand`
- `audienceGenderHint`
- `sourceMode` (`default` / `tryon`)

Normalization:

1. Body options override query options when valid.
2. Numeric options are clamped to safe maximums.
3. `excludeBrands` accepts comma text or arrays.
4. Try-on route enforces `sourceMode="tryon"`.

Validation:

- invalid ID -> `400`
- missing payload title (when no valid ID) -> `400`
- missing source product -> `404`

---

## 2) Stage A - Source Anchor Resolution

### Inputs

- request source (ID or product payload)
- optional `userId`

### Processing

1. Build source product object from:
   - catalog record (`GET`/ID path), or
   - payload (`POST` path).
2. Normalize fields:
   - id/title/brand/category/color/gender
   - price/currency
   - image fields
   - description
3. Reject non-clothing anchors.

### Output

- `sourceProduct` (validated)

---

## 3) Stage B - Source Understanding

### 3.1 Category Detection

Resolution stack:

1. ML attribute extraction path
2. style-to-category mapping
3. weighted keyword fallback

Output:

- `detectedCategory`
- `categoryConfidence`

### 3.2 Style Profile Build

Build:

- `occasion`
- `aesthetic`
- `season`
- `formality`
- `colorProfile`:
  - primary
  - color type
  - harmony sets (neutral/analogous/complementary/monochromatic)

### 3.3 Audience Inference

Priority order:

1. explicit request hint
2. product metadata
3. text inference
4. image-caption fallback

Output:

- gender hint (`men` / `women` / `unisex` / unknown)
- age-group hint (`adult` / `kids` / unknown)

---

## 4) Stage C - Candidate Retrieval

### Inputs

- source category and style profile
- normalized options

### Processing

1. Expand complementary target categories from source category.
2. Build search query with:
   - category relevance
   - availability filters
   - optional price range
   - brand exclusion
   - same-brand soft boost
   - color harmony soft boosts
3. Oversample retrieval pool to preserve headroom for downstream pruning.

### Output

- `retrievedCandidates[]` with base score + product metadata

---

## 5) Stage D - Candidate Scoring

### 5.1 Hard Gates (Reject)

Drop candidate when:

- candidate invalid
- candidate == source product
- audience incompatible
- category irrelevant to requested slot family
- severe rule-based core garment color clash

### 5.2 Soft Signals

Compute and combine:

1. style/formality compatibility
2. color-family harmony compatibility
3. occasion alignment
4. attribute compatibility (material/fit/pattern)
5. same-brand preference bonus
6. optional visual similarity contribution

### 5.3 Explainability

Attach:

- `visualSimilarity`
- `attributeMatch`
- `colorHarmony`
- `styleCompatibility`
- `occasionAlignment`

### Output

- `scoredCandidates[]`

---

## 6) Stage E - Reranking and Quality Filtering

### Processing

1. Apply ML ranker when available.
2. Fallback to heuristic scoring when ranker fails/unavailable.
3. Remove low-confidence rows.
4. Apply early diversity guards:
   - same-brand overconcentration
   - same-price-band overconcentration

### Output

- `rankedCandidates[]`

---

## 7) Stage F - Wardrobe Fusion (Native)

Wardrobe is not a post-feature add-on; it is part of final ranking utility.

### Processing

1. Load owned products (`userId` path).
2. Map owned items to recommendation categories.
3. Mark overlapping web candidates as `owned=true`.
4. Inject owned extras in sparse categories.
5. Reorder in category:
   - keep relevance-first ordering
   - prefer owned when utility is comparable
   - do not push weak owned rows above clearly stronger rows

### Output

- `wardrobeAwareCandidates[]`

---

## 8) Stage G - Coverage Balancing

Goal: maximize outfit completeness while preserving recommendation quality.

### Rules

1. prioritize essential categories
2. enforce core slots where relevant
3. apply `maxPerCategory`
4. apply `maxTotal`
5. deduplicate by id and near-duplicate keys

### Relaxation

If strict balancing over-prunes:

- relax softly in controlled order
- keep safety/audience gates strict
- keep non-empty result when valid candidates exist

### Output

- final grouped category buckets

---

## 9) Stage H - Response Mapping

Return stable schema:

- `sourceProduct`
- `detectedCategory`
- `style`
- `recommendations[]` grouped by category:
  - category
  - reason
  - priority
  - products:
    - id/title/brand/price/currency/image
    - `matchScore`
    - `matchReasons`
    - `owned` (optional)
- `outfitSuggestion`
- `totalRecommendations`
- `completionMode`

Empty candidate case still returns valid schema with empty recommendation groups.

---

## 10) Try-On Specific Rules

Try-on mode:

- keeps payload-first source anchor
- avoids strict dependency on catalog identity
- reuses same retrieval/scoring/fusion/balancing logic
- sets `completionMode: "tryon"`

---

## 11) Quality-Critical Execution Order

1. hard gates
2. soft scoring
3. reranking
4. confidence filter
5. wardrobe fusion
6. coverage balancing
7. caps + dedupe + response mapping

Applying caps too early harms slot completeness and personalization quality.

---

## 12) Failure and Degradation

Request-level:

- `400` invalid input
- `404` source not found

Pipeline-level degradation:

- visual scoring unavailable -> disable visual signal
- ranker unavailable -> fallback heuristic
- wardrobe load unavailable -> continue without owned merge
- sparse categories -> controlled relaxation path

Stability requirement:

- no single component failure should crash endpoint when core retrieval/scoring can proceed.

---

## 13) Observability Requirements

Per request, log/trace:

- source detection outputs
- retrieval pool sizes
- reject counts by reason
- score component distribution
- owned mark/injection counts
- final slot coverage status

These diagnostics are mandatory for quality tuning and regression detection.

---

## 14) Final Decision Flow

1. normalize request + options
2. resolve source anchor
3. validate clothing eligibility
4. detect source category/style/audience
5. retrieve complementary candidates
6. compute compatibility signals
7. rerank + confidence-filter
8. fuse wardrobe ownership
9. balance coverage + caps + dedupe
10. map final response

This is the single complete pipeline definition for CompleteStyle.

