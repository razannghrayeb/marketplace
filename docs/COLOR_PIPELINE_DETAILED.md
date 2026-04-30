# Detailed Color Pipeline Documentation (Image Search)

This document explains, in full detail, how color is produced, fused, scored, and used in the image-search stack (especially `POST /api/images/search`).

It focuses on runtime logic and decision flow:

- where color signals come from
- how signals are normalized and confidence-weighted
- how conflicts are resolved
- how color affects ranking vs hard gating
- where color is intentionally de-emphasized to avoid false negatives

---

## 1) Why the color pipeline is complex

Color is noisy in fashion search because:

- user photos include lighting/background bias
- captions can mix multiple garments ("blue top and black pants")
- crop color extraction can leak neighboring items/background
- catalog metadata color values are inconsistent/noisy across vendors

The system solves this by combining multiple color channels with confidence, then applying color mostly as a **precision-oriented ranking signal**, and only hard-gating color under strict conditions.

---

## 2) Color sources (all channels)

The pipeline uses five main color sources:

1. **BLIP caption slot colors** (`topColor`, `jeansColor`, `garmentColor`, `shoeColor`, `bagColor`)
2. **BLIP full-image primary color hint**
3. **Dominant pixel colors from full image** (restricted fallback)
4. **Dominant pixel colors from per-detection crop** (k-means + canonical mapping)
5. **Catalog-side document colors** (`attr_color`, `attr_colors`, canonical palettes)

All search-time color behavior is a fusion of these channels plus query/category context.

---

## 3) Canonical color vocabulary and normalization

Color normalization is centralized around canonical tokens and family/bucket logic.

### 3.1 Canonical tokens

Examples: `black`, `white`, `off-white`, `navy`, `light-blue`, `olive`, `burgundy`, `teal`, etc.

### 3.2 Family groups

Families group close colors:

- white-family (`white`, `off-white`, `cream`, `ivory`, ...)
- blue-family (`navy`, `blue`, `light-blue`, `denim`, ...)
- red-family (`red`, `burgundy`, `maroon`, ...)
- etc.

These are used for tiered matching (exact > family > bucket > none).

### 3.3 Coarse buckets

A broad bucket map (`blue`, `green`, `brown`, etc.) supports robust fallback matching and expansion while preventing cross-family drift.

### 3.4 Raw vendor color cleanup

Raw strings are cleaned with:

- misspelling corrections
- alias mapping
- family-cluster inference
- noisy token filtering
- multi-value parsing (`/`, `,`, `and`, etc.)

This allows noisy catalog values to align with canonical search-time color semantics.

---

## 4) Caption color extraction (semantic color channel)

Caption parsing is slot-aware and proximity-aware.

### 4.1 Slot extraction strategy

From caption text, it extracts color by garment slot:

- top garments -> `topColor`
- bottoms -> `jeansColor`
- dress/one-piece/outerwear -> `garmentColor`
- footwear -> `shoeColor`
- bag/accessories -> `bagColor`

### 4.2 Nearest-color-before-garment rule

The parser does not simply pick first color mention.  
It selects nearest valid color token before garment keyword and rejects color matches if another garment cue appears in between (prevents cross-garment bleed).

### 4.3 Full-image primary color from caption

A conservative resolver decides global caption primary color:

- if caption clearly multi-item, avoid collapsing all slots into one global color
- preserve slot-specific semantics where possible

---

## 5) Dominant pixel color extraction (visual color channel)

Color extraction from image/crops uses a garment-focused path:

1. crop ROI (center crop or detection box with padding)
2. resize and remove alpha
3. remove near-white background pixels when safe
4. k-means clustering in RGB
5. map cluster centroids into canonical color tokens via LAB-distance and handcrafted guards

### 5.1 LAB mapping and guard heuristics

The mapper contains safeguards for common errors:

- avoid collapsing dark chromatic tones into black/charcoal
- protect light-blue from becoming off-white
- separate yellow/cream/beige in low-chroma cases
- preserve warm neutral distinctions (`brown`, `camel`, `tan`)

### 5.2 Output of pixel extraction

For each analysis call:

- primary, secondary, accent canonical color
- palette list (ordered by prominence)
- confidence score for primary color

For search, a subset of top palette colors is used.

---

## 6) Full-image color selection strategy

Before per-detection jobs, orchestrator computes global color candidates:

1. `captionPrimaryColor` from BLIP text + structure
2. optional `dominantPrimaryColor` from image pixels (only in narrow conditions)

Then chooses inferred global primary via confidence-weighted selector.

### Important guard

Dominant full-image color fallback is restricted for multi-item scenes, because global dominant often reflects background or wrong garment.

---

## 7) Per-detection color pipeline

Per-detection color is the core of shop-the-look precision.

## Stage A: slot bootstrap from full caption

For each detection category, pipeline picks corresponding full-caption slot color (`topColor`, `jeansColor`, etc.) as low-priority fallback.

## Stage B: crop pixel colors

Detection ROI is category-shaped before color extraction:

- one-piece: trim hem overlap
- bottoms: center-lower band to avoid shirt/shoes bleed
- tops: upper-mid torso crop to avoid pants bleed
- footwear: inner crop to reduce floor pixels

Then extract dominant crop colors and set detection color with confidence derived from detection quality.

## Stage C: promotion rules (caption vs crop)

Caption slot color can override/promote in specific cases:

- category requires slot-specific color
- caption confidence passes threshold
- caption color is meaningful
- special neutral-vs-chromatic correction paths

This handles failure mode where crop pixel pipeline picks wrong hue due to lighting or overlap.

## Stage D: per-detection BLIP caption colors

Detection-level BLIP caption runs in parallel with search.  
If confidence + CLIP-caption consistency are strong, detection-caption slot color may update per-item color state.

## Stage E: source tracking

Each detection color stores:

- color token
- confidence
- source rank (caption full slot / crop / detection-caption)

Source is later attached to output and coherence stages.

---

## 8) Color confidence model

Confidence is not binary; every color signal has strength.

Confidence drivers include:

- BLIP structured confidence
- caption-CLIP consistency for detection captions
- detection confidence + area ratio
- source-specific priors (caption slot fallback vs crop-derived vs detection-caption)

Only confident signals are allowed to influence hard behaviors.

---

## 9) Color intent construction in retrieval layer

The search engine receives color from several fields:

- explicit query colors (`color`, `colors`)
- inferred primary color
- inferred per-item colors + confidence
- crop dominant colors
- preferred item color key

It constructs color intent in this order:

1. explicit color intent (highest authority)
2. trusted inferred per-item intent
3. crop-dominant fallback intent

Then expands via nearest/family-safe variants while preserving bucket/tone constraints.

---

## 10) Conflict resolution logic (critical)

When channels disagree, resolver applies category-aware rules:

- prefer slot-anchored inferred colors for slot-sensitive categories
- avoid borrowing color from unrelated item keys (top color should not gate bottoms)
- suppress noisy full-image dominant color when confident per-item apparel colors exist
- for footwear, avoid dark-floor contamination unless strong consensus supports dark color
- for bags with warm-neutral signals, prune light-neutral drift

This is one of the biggest precision improvements in the pipeline.

---

## 11) Color matching tiers in ranking

Color match uses tiered compliance:

- **exact**: token match
- **family**: same family group
- **bucket**: same broad bucket
- **none**: mismatch

Scores are tone-aware and adjusted by intent type.

In addition:

- expanded color terms are penalized versus primary desired terms
- bucket-only conflicts receive explicit penalties
- hard contradictions (different families) apply stronger penalty, especially for near-identical visuals

---

## 12) Color in final relevance scoring

Final relevance blends visual and metadata channels.

Color contributions:

1. raw color embedding similarity (if available)
2. color tier compliance score
3. color coherence weighting with intent
4. color gate multiplier (intent-strength dependent)
5. color tier factor multiplier

Weights are category-sensitive:

- bags and bottoms are more color-sensitive than many other categories
- tops keep meaningful but balanced color weight

---

## 13) Hard gate vs soft bias policy

Color is often **soft bias**, not hard filter.

Hard color gating is allowed only under strict conditions, typically:

- no explicit contradiction with stronger signals
- detection-anchored intent is reliable
- inferred color confidence is above threshold
- slot-safe categories (tops/bottoms/dresses)

If inferred color is chromatic and confidence is not strong enough, pipeline intentionally keeps color as ranking-only bias to avoid false negatives.

---

## 14) Relevance gate interaction

After ranking, per-detection relevance threshold is applied.  
Dropped counts include color-gate attribution for diagnostics.

The system logs drops where final relevance is below threshold and source indicates color-driven suppression.

This makes color impact observable and tunable.

---

## 15) Color and coherence output

Before coherence analysis, detections are enriched with resolved per-item colors:

- dominantColor
- colorConfidence
- colorSource

Coherence engine consumes these enriched detections, so color pipeline affects both retrieval ranking and outfit-level coherence evaluation.

---

## 16) Behavior by category (practical)

### Tops

- slot-specific color strongly preferred
- sleeve/style interactions can influence tie-breaks
- avoids bottom/accessory color bleed

### Bottoms

- crop region tuned to avoid torso/shoe contamination
- warm-neutral families expanded intelligently
- style gates softened when needed

### Dresses / one-piece

- strong slot-sensitive color semantics
- one-piece conflict handling prioritizes consistent garment signal

### Footwear

- footwear-specific crop and noise guards
- dark-floor false-positive controls
- formal footwear pruning can affect candidate aisles

### Bags/accessories

- visual similarity remains dominant
- color still significant in rerank, but with anti-drift rules (e.g., warm-neutral bag intent)

---

## 17) Fallback and safety philosophy for color

The color system is designed to avoid two failures:

1. returning wrong-color near duplicates at top ranks
2. over-filtering true matches because one color signal is noisy

So architecture applies:

- multi-source fusion
- confidence-aware overrides
- category-aware conflict rules
- soft-first, hard-only-when-safe gating

---

## 18) Key operational tuning knobs (color-related)

The pipeline behavior can be tuned with environment-driven thresholds/weights, including:

- minimum confidence gates for inferred color usage
- rerank color weight
- style/pattern/texture relative weights
- detection confidence thresholds for hard-category/hard-intent paths

Color behavior should be tuned together with category/type precision settings, not in isolation.

---

## 19) End-to-end color flow summary

1. BLIP caption gives slot colors + structured hints
2. Full-image dominant color may supplement (restricted)
3. Each detection computes crop colors with category-specific crops
4. Signals are fused per item with confidence and source priority
5. Retrieval engine builds explicit/inferred/crop color intent
6. Tiered color compliance contributes to rerank and final relevance
7. Hard color gates trigger only when confidence + context justify
8. Final output exposes color source/confidence and coherence uses resolved colors

---

## 20) Final takeaway

The color pipeline is a hybrid semantic-visual system:

- semantic channel (BLIP slot colors)
- visual channel (crop/full-image dominant colors)
- catalog normalization channel (canonical families/buckets)
- decision channel (confidence + category-aware conflict resolution)

This layered design is what allows color to improve relevance without collapsing recall in real-world noisy fashion photos.

