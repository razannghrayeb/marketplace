# Outfit Stylist Pipeline: How Complete-Look Is Built

Last updated: April 11, 2026

This document explains how the wardrobe complete-look stylist pipeline is built, from input anchors to ranked outfit sets.

---

## 1) Entry Point and API Flow

Request endpoint:
- POST /api/wardrobe/complete-look

Controller:
- src/routes/wardrobe/wardrobe.controller.ts

Service entry points:
- completeLookSuggestions(...) for wardrobe item_ids
- completeLookSuggestionsForCatalogProducts(...) for catalog product_ids

Core orchestrator:
- runCompleteLookCore(...)

High-level flow:
1. Accept anchor items from wardrobe or catalog.
2. Infer current outfit slots (tops, bottoms, shoes, dresses, outerwear, bags, accessories).
3. Infer missing categories needed to complete the outfit.
4. Retrieve candidates from OpenSearch per missing slot.
5. Apply stylist-aware scoring and strict filters.
6. Merge + rerank using fashion profile features.
7. Build multi-item outfit sets and apply pairwise coherence gating.
8. Return suggestions, outfitSets, and missingCategories.

---

## 2) Inputs and Modes

Supported payload modes:
- item_ids: wardrobe anchor items
- product_ids: catalog anchor products

Optional hints:
- audience_gender
- age_group

Modes in response:
- completionMode = wardrobe
- completionMode = catalog-product

Design note:
- catalog-product mode can use detectedCategories to improve slot inference when metadata is weak.

---

## 3) Slot Inference and Gap Detection

Tracked slots:
- tops, bottoms, shoes, dresses, outerwear, bags, accessories

Current-slot inference stack:
1. Structured category fields (preferred).
2. Free-text fallback from title/name/category text.
3. Vision fallback only when structured signals are sparse.

Missing-slot logic:
- If dress exists: shoes is essential.
- Otherwise: tops, bottoms, shoes are essential.
- Add complements (bags, accessories, outerwear when weather supports it).
- Cap to at most 3 missing slots.

Weather-aware behavior:
- avoid outerwear recommendation in warm context.

Validation script:
- scripts/validate-complete-look-matrix.ts
- validates all slot combinations across warm/neutral/cold contexts.

---

## 4) Candidate Retrieval

For each missing category:
1. Build strict filters:
- category_canonical target
- audience/age filters when inferred
- slot-intent query filter
- price tier (when available)
- exclude owned products

2. Retrieve candidates:
- vector kNN search when centroid exists
- lexical fallback search

3. Recall safety net:
- if low recall, remove slot-intent filter
- slightly relax floor
- still keep audience/age guards

Top-up stage:
- if merged pool < requested limit, fetch additional category top-ups with the same fashion-aware scoring model.

---

## 5) Scoring Model (Per Candidate)

Primary scoring blend inside slot retrieval:
- embeddingNorm * 0.24
- categoryCompat * 0.20
- colorHarmony * 0.20
- styleAlignment * 0.20
- patternAlignment * 0.08
- materialAlignment * 0.04
- formalityAlignment * 0.04

Minimum acceptance floor by slot:
- bags/accessories: 0.62
- shoes: 0.58
- bottoms: 0.54
- tops/outerwear/dresses: 0.57

Hard guards before scoring acceptance:
- slot contamination rejection (for mislabeled products)
- strict gender/age matching policy where configured
- reject poor style-occasion matches when style intent is reliable

Stored scoring explanation:
- fitBreakdown with normalized sub-scores
- human-readable reason string

---

## 6) Stylist Signals (New)

Each candidate now carries stylistSignals for downstream set-level reasoning:
- slot
- color
- formalityScore
- aesthetic (added in rerank stage)
- styleTokens

Why this matters:
- previously, set construction mostly combined high single-item scores.
- now, set scoring can use explicit pairwise style features between recommended items.

---

## 7) Fashion-Aware Reranking Layer

Function:
- rerankCompleteLookFashionAware(...)

Adds/updates:
- audience and age mismatch penalties
- style profile from product metadata via buildStyleProfile(...)
- aesthetic compatibility
- formality compatibility
- color harmony with wardrobe

Rerank blend:
- final = fashionScore * 0.72 + baseRetrieval * 0.28

Where fashionScore =
- categoryCompat * 0.22
- colorHarmony * 0.16
- styleTokenScore * 0.24
- formalityScore * 0.20
- aestheticScore * 0.18

Output remains sorted by final score descending.

---

## 8) Outfit Set Builder (Stylist Coherence)

Set generator:
- buildOutfitSets(...)

Set scoring:
- scoreOutfitSet(...)

Generation logic:
- take top 3 candidates per missing category
- enumerate combinations (2-3 missing categories)
- score each set
- keep top 5 sets

Pairwise set features:
- category compatibility (bidirectional)
- color pair harmony
- formality compatibility
- style-token overlap

Pairwise weighted score:
- categoryCompat * 0.34
- colorPair * 0.26
- formalityPair * 0.24
- stylePair * 0.16

Final set coherence:
- avgItemScore * 0.58 + avgPairScore * 0.32 + avgColorHarmony * 0.10

Coherence gate:
- drop sets with coherenceScore < 0.58

This gate prevents combinations that are individually relevant but not visually coherent together.

---

## 9) Compatibility Engine Note

File:
- src/routes/wardrobe/compatibility.service.ts

Style similarity was updated to a stylist sweet-spot model:
- normalize cosine similarity to [0,1]
- target sweetSpot around 0.62
- penalize distance from sweet spot

This stabilizes pair matching so style does not over-reward poor extremes.

---

## 10) Output Contract

Response includes:
- completionMode
- suggestions (each with score, reason, fitBreakdown, stylistSignals)
- outfitSets (coherence-scored combinations)
- missingCategories

---

## 11) What Makes It "Stylist" vs "Retriever"

Stylist behavior comes from combining:
- slot-aware essentials and complements
- strict compatibility filters (slot, audience, age)
- fashion-feature scoring (color/style/formality/material/pattern)
- reranking with learned style profile signals
- pairwise outfit coherence gating at set level

Retriever-only behavior would stop at nearest-neighbor similarity. This pipeline goes further by enforcing cross-item outfit logic.

---

## 12) Validation and Safety Checks

Recommended checks before release:
1. Type check:
- pnpm -s tsc -p . --noEmit

2. Slot/gap regression matrix:
- pnpm test:complete-look-matrix --timeout=60000

3. Manual API smoke tests:
- wardrobe mode with item_ids
- catalog mode with product_ids
- audience_gender + age_group strict scenarios
- warm-weather and cold-weather scenarios

4. Quality monitoring in production:
- acceptance rate of returned suggestions
- save-to-outfit rate
- user edits after recommendation

---

## 13) Key Files

Core logic:
- src/routes/wardrobe/recommendations.service.ts

API controller:
- src/routes/wardrobe/wardrobe.controller.ts

Pair compatibility engine:
- src/routes/wardrobe/compatibility.service.ts

Regression matrix:
- scripts/validate-complete-look-matrix.ts

API docs:
- docs/api-reference.md

Status tracking:
- docs/IMPLEMENTATION_STATUS.md
