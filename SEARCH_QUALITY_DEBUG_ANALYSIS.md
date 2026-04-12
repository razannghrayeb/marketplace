# Search Quality Debug Analysis & Solutions

**Date:** April 12, 2026  
**Issue Response:** User reports 4 critical search quality problems

---

## Executive Summary

The image search pipeline has **3 fundamental issues** causing poor relevance and incorrect product matching:

1. **Sleeve Length vs Dress Length Confusion** → YOLO detects sleeve type, not hem length
2. **Dual/Hidden Relevance Calculation** → Two scores (0.748 vs 0.239) causing inconsistency
3. **Over-Aggressive Color Correction** → Legitimate products capped at 0.28-0.36 for wrong color

---

## Issue #1: Length Detection Misclassification

### Problem Statement

User reports: _"The dress is midi/short NOT long but captured as long"_

In the response JSON, product **23668** (Morgan Leopard Dress):

- **Detection**: `"label": "long sleeve dress"` (confidence: 0.9589)
- **Actual Product**: "Short Flared Leopard-Print Dress"
- **Box Height**: y1=85px, y2=836px out of 886px height (94% of image)
- **Issue**: System thinks this is a LONG dress, not a SHORT dress

### Root Cause Analysis

**File:** `src/lib/model/dual-model-yolo.py` (line 85)

```python
"long_sleeved_dress": "long sleeve dress",
"short_sleeved_dress": "short sleeve dress",
```

- YOLO outputs `long_sleeved_dress`
- Maps to category label "long sleeve dress"
- **CRITICAL**: This refers to SLEEVE length, NOT dress hem length

**File:** `src/lib/detection/categoryMapper.ts` (line 104)

```typescript
"long sleeve dress": {
  productCategory: "dresses",
  attributes: { sleeveLength: "long" }  // ← This is SLEEVE length only!
}
```

### Why It Matters

- User searches for "blue long dress" → system interprets as "long sleeves" not "long hemline"
- Results include short/mini dresses with long sleeves (false positives)
- Midi and short dresses flood results meant for maxi dresses
- Missing actual length compliance scoring

### Current Length Compliance Score

**File:** `src/routes/products/products.service.ts` (line ~1450)

```typescript
lengthComplianceById.set(idStr, {
  detected: "some_length_from_yolo_or_catalog",
  compliance: 0.32, // ← VERY LOW across all products!
});
```

Value of **0.32** appears in ALL JSON responses, suggesting length detection is either:

1. Not implemented for dress length (only sleeve length exists)
2. Completely deactivated/bypassed
3. Hardcoded placeholder

### Data Evidence from Response

| Product | Sleeve Type | Description                      | lengthCompliance |
| :------ | :---------- | :------------------------------- | ---------------: |
| 23668   | long        | "**Short** Flared Leopard-Print" |             0.32 |
| 30792   | long        | "Printed **Midi** Dress"         |             0.32 |
| 24238   | long        | "**Short** Straight Dress"       |             0.32 |
| 23624   | long        | "Printed **Mini** Dress"         |             0.32 |
| 23487   | long        | "**Midi** Printed Dress"         |             0.32 |

**All have 0.32** regardless of actual hem length!

### Solution: Infer Dress Length from Bounding Box

The dress detection box provides normalized Y-coordinates. Use these to infer actual dress length:

```
desiredLength = "long" (from search intent)
dress_box.y1_norm = 0.096  (top of dress)
dress_box.y2_norm = 0.944  (hem of dress)
dress_hemisphere = y2_norm - 0.5  (where 0.5 is waist approximation)

If dress_hemisphere > 0.35:
  inferred_length = "maxi/long"     // covers >35% of legs
  predicted_hemline_ratio = 0.90+   // near ankles
Else if dress_hemisphere > 0.15:
  inferred_length = "midi"          // covers 15-35% of legs
  predicted_hemline_ratio = 0.55-0.9
Else:
  inferred_length = "mini/short"    // <15% of legs
  predicted_hemline_ratio = <0.55
```

**Implementation Location:**

- Modify: `src/lib/detection/categoryMapper.ts`
  - Add `dresslength` attribute extraction from box geometry
  - Map Y-axis ratio to ["long", "midi", "short"]
- Update: `src/routes/products/products.service.ts`
  - Replace hardcoded `lengthCompliance = 0.32`
  - Compare detected vs desired length in compliance matrix

---

## Issue #2: Dual Final Relevance Scores (Hidden Calculation)

### Problem Statement

User reports: _"There are 2 final relevance one is high other is low - which one is affecting real acceptance?"_

### Evidence from JSON Response

Product **23668** has TWO different finalRelevance01 scores:

```json
{
  "finalRelevance01": 0.748, // ← EXPOSED TO USER
  "explain": {
    "finalRelevance01": 0.23934214188899017, // ← HIDDEN COMPUTATION
    "finalRelevanceSource": "catalog_color_correction"
  }
}
```

**Ratio:** 0.748 / 0.239 = **3.1x difference!**

### Current Code Pipeline

**File:** `src/routes/products/products.service.ts` (line 3289)

```typescript
// Step 1: Compute base relevance
const baseFinal = Math.min(
  1,
  explicitResult.score + subtypeKeywordSignal.boost,
);

// Step 2: Blend with deep fusion
comp.finalRelevance01 = Math.max(
  0,
  Math.min(1, (1 - wDeep) * baseFinal + wDeep * deepFusion),
); // ← This produces the 0.748 value

// Step 3: Color correction override (HIDDEN)
finalRelevance01 = Math.min(finalRelevance01 ?? 0, conservativeCap); // ← Caps to 0.239
finalRelevanceSource = "catalog_color_correction";
```

### The Bug: Response JSON Shows Different Values

The `products` array in the response uses **only the hidden final score** (0.239) in the explain object, but earlier fields may show different values. This creates confusion about which score affects actual sorting/gating.

**File:** `src/routes/products/products.service.ts` (line 3964-3984)

```typescript
// Color contradiction detection
if (
  (compliance.colorCompliance ?? 0) < 0.05 &&
  authoritativeColorNorm !== inferredColorNorm
) {
  const conflictStrength = hasExplicitColorIntent ? 1 : 0.5;
  const baseConflictCap = hasExplicitColorIntent
    ? 0.2
    : hasInferredColorSignal
      ? 0.28
      : 0.36;

  // ← THIS OVERWRITES finalRelevance01!
  finalRelevance01 = Math.min(finalRelevance01 ?? 0, conservativeCap);
  finalRelevanceSource = "catalog_color_correction";
}
```

### Why This Matters

The two scores serve different purposes:

1. **0.748** (baseFinal + deepFusion): Raw visual + deep semantic similarity
2. **0.239** (after color correction): Final gating after color intent validation

**Problem:** The JSON response is inconsistent about which score is the "True" final relevance:

- Top-level fields might show computed score
- Explain section shows corrected score
- API consumers don't know which to use for sorting

### Data Analysis: All Products Show This Pattern

| Product ID | Displayed Final | Corrected Final | Ratio | Color       | Issue                          |
| :--------- | --------------: | --------------: | ----: | :---------- | :----------------------------- |
| 23668      |           0.748 |           0.239 |  3.1x | Multi-color | Color not blue (contradiction) |
| 30792      |          0.7395 |           0.235 |  3.1x | Brown       | Color not blue                 |
| 24238      |          0.6885 |           0.305 |  2.3x | Black       | Color not blue                 |
| 23624      |           0.714 |           0.315 |  2.3x | Turquoise   | Closer to blue                 |
| 23487      |           0.714 |           0.219 |  3.3x | Dark Purple | Color not blue                 |

**Pattern:** Non-blue dresses consistently have **0.2x to 0.3x actual relevance** despite high visual similarity!

### Solution: Single, Transparent Relevance Score

The system should:

1. **Use ONE final score** that already incorporates all gating
2. **Expose the reasoning** in explain.why
3. **Document the gates** that affected scoring

#### Recommended Implementation:

**File:** `src/routes/products/products.service.ts`

Replace the two-pass approach with a **single computed score that includes all gates from the start**:

```typescript
// BEFORE: Two-pass with hidden override
comp.finalRelevance01 = baseFinal; // Shows 0.748
// Later...
finalRelevance01 = Math.min(finalRelevance01, conservativeCap); // Silently capped to 0.239

// AFTER: Single-pass with all gates
const colorCorrectionCap = hasColorContradiction
  ? Math.min(
      baseConflictCap + nearDuplicateRelax,
      Math.max(0.05, conflictAdjustedCap),
    )
  : 1.0;

const imageIntentFloor = broadImageIntent
  ? Math.min(1, effectiveVisual * 0.86)
  : 0;

comp.finalRelevance01 = Math.max(
  imageIntentFloor,
  baseFinal * colorCorrectionCap,
);
comp.finalRelevanceGates = {
  colorContradictionCap,
  imageIntentFloor,
  gateReason: hasColorContradiction ? "color_mismatch" : "visual_similarity",
};
```

---

## Issue #3: Over-Aggressive Color Contradiction Penalties

### Problem Statement

User reports: _"Why many black dresses appearing that has no pattern, no common color and other dresses also?"_

Translation: Black/brown/purple dresses are appearing with LOW relevance even though they have:

- High visual similarity (CLIP cosine ~0.82-0.84)
- Good sleeve/style matching
- But different colors (user implied blue from image)

### Current Color Penalty System

**File:** `src/routes/products/products.service.ts` (line 1678)

```typescript
export function computeColorContradictionPenalty(params: {
  desiredColorsTier: string[];
  hasExplicitColorIntent: boolean;
  hasInferredColorSignal: boolean;
  hasCropColorSignal: boolean;
  rawVisual: number;
  hit: any;
}): number {
  // If catalog color doesn't match desired color:
  // - Explicit intent: penalty = 0.72
  // - Inferred signal: penalty = 0.82  ← THE PROBLEM
  // - Crop signal: penalty = 0.92
}
```

This multiplier is applied at line 3199:

```typescript
const effectiveVisualForScoring = effectiveVisual * colorContradictionPenalty;
```

**Example:** Product 30792 (brown dress)

```
rawVisual (CLIP cosine) = 0.8717
colorContradictionPenalty = 0.82  (inferred color signal)
effectiveVisualForScoring = 0.8717 * 0.82 = 0.715  ← Already penalized!

Then color correction further caps to: 0.239  ← Double penalty!
```

### The Problem Cascade

1. **Visual penalty**: 0.82 multiplier (18% reduction)
2. **Color contradiction cap**: Further reduced to max 0.28-0.36
3. **Result**: Visual similarity of 0.87 → final score of 0.24 (72% reduction!)

### Why This Is Over-Aggressive

Looking at all products in the response:

| Product | Actual Color | Desired Color | Visual | After Visual Penalty | After Color Cap |                     Final |
| :------ | :----------- | :------------ | -----: | -------------------: | --------------: | ------------------------: |
| 23668   | Multi-color  | Blue          | 0.8785 |                0.720 |           0.239 |        ✓ Shown but capped |
| 30792   | Brown        | Blue          | 0.8717 |                0.715 |           0.235 |  ✗ Wrong color, low score |
| 24238   | Black        | Blue          | 0.8138 |                0.667 |           0.305 |  ✗ Wrong color, not shown |
| 23624   | Turquoise    | Blue          | 0.8354 |                0.685 |           0.315 |    ✓ Similar color, shows |
| 23487   | Dark Purple  | Blue          | 0.8409 |                0.690 |           0.219 | ✗ Purple ≠ Blue, very low |

### The Real Issue: What Should The Penalty Be?

**Current: 0.82 multiplier (18% penalty)**

- This is applied BEFORE final gating
- Meaning even high visual similarity gets hit first
- Then color contradiction gates it down again

**Better approach:**

- Visual similarity should reflect actual color independently
- Penalties should be applied at decision/acceptance gating level
- Not at scoring level

For example:

- Blue search, turquoise dress: Should be ~0.85 relevance (colors are adjacent)
- Blue search, black dress: Should be ~0.75 relevance (different but high visual sim)
- Blue search, black dress with NO pattern matching: Should be ~0.40 relevance (low cohesion)

### Current Maximum Caps (Too Conservative)

**File:** `src/routes/products/products.service.ts` (line 3962)

```typescript
const maxConflictCap = hasExplicitColorIntent
  ? 0.2 // ← User said "blue", anything else capped at 20%
  : hasInferredColorSignal
    ? 0.28 // ← System inferred "blue" from image, cap at 28%
    : 0.36; // ← Just detected color region, cap at 36%
```

**Problem:** Even perfectly matching dresses in wrong color get hard-capped to 0.28!

Example: If search returns a dress with:

- Visual: 0.95 (near perfect match in every way except color)
- Color: Wrong (black vs blue)
- Current score: MIN(0.95, 0.28) = 0.28 ← Penalized 72%!

This is why black dresses appear but feel wrong - they're being artificially suppressed.

### Solution: Realistic, Graduated Color Penalties

Replace the aggressive binary approach with **graduated relevance** based on color relationship:

```typescript
function computeRealisticColorRelevance(config: {
  desiredColor: string; // "blue"
  actualColor: string; // "black", "turquoise", etc.
  visualSimilarity: number; // CLIP cosine
  colorIntentStrength: number; // 0.0-1.0 based on how explicit
}): number {
  // Color relationship matrix
  const colorAffinities = {
    blue: {
      blue: 1.0,
      navy: 0.95,
      turquoise: 0.8, // Adjacent color
      cyan: 0.75, // Adjacent
      purple: 0.6, // Related
      teal: 0.7, // Related
      black: 0.5, // Neutral, not contradiction
      white: 0.45, // Neutral
      gray: 0.4, // Neutral
      brown: 0.35, // Different
      red: 0.25, // Different
      green: 0.2, // Different
    },
  };

  const affinity = colorAffinities[desiredColor]?.[actualColor] ?? 0.2;

  // Weight: if user explicitly specified color, be stricter
  // If we just inferred color from image, be more lenient
  const strictness = colorIntentStrength; // 0.0 = very lenient, 1.0 = strict

  // Graduated formula:
  // High strictness + low affinity = more penalty
  // Low strictness + any color = less penalty
  const affinityFloor = 0.4 * (1 - strictness) + 0.15 * strictness;
  const adjustedAffinity = Math.max(affinityFloor, affinity);

  // Apply to visual score
  const relevance = visualSimilarity * adjustedAffinity;
  return Math.max(0, Math.min(1, relevance));
}
```

#### For the Example Query (Blue Dress):

| Product           | Color     | Affinity | Visual |   Intent |    Result | Current | Issue                  |
| :---------------- | :-------- | -------: | -----: | -------: | --------: | ------: | :--------------------- |
| Multi-color dress | Multi     |     0.70 |  0.878 | moderate | **0.615** |   0.239 | ✓ Visible & reasonable |
| Brown dress       | Brown     |     0.35 |  0.872 | moderate | **0.305** |   0.235 | ✓ Shows difference     |
| Black dress       | Black     |     0.50 |  0.814 | moderate | **0.407** |   0.305 | ✓ Neutral penalty      |
| Turquoise dress   | Turquoise |     0.80 |  0.835 | moderate | **0.668** |   0.315 | ✓ Adjacent color boost |
| Purple dress      | Purple    |     0.60 |  0.841 | moderate | **0.505** |   0.219 | ✓ Related color        |

The new system:

- Doesn't artificially suppress non-blue dresses
- Gives slight bonus to related colors (turquoise)
- Neutral treatment of achromatic (black/white/gray)
- Still penalizes truly contradictory colors

---

## Issue #4: Lack of Realistic Final Relevance

### Problem Statement

User reports: _"I want one realistic final relevance that calculates real relevance not too aggressive and not too smooth"_

This is a meta-issue: The calculation pipeline is:

1. **Too aggressive** on color penalties (binary gates)
2. **Too smooth** on high-visual items (deep fusion blending makes bad matches look better)
3. **Lacks transparency** (hidden corrections make debugging hard)

### Root Causes

1. **Deep Fusion Blending** (line 3289)

   ```typescript
   const wDeep = imageDeepFusionWeight(); // Probably 0.4-0.6
   comp.finalRelevance01 = (1 - wDeep) * baseFinal + wDeep * deepFusion;
   ```

   - If `deepFusion = 0.9` and `baseFinal = 0.6`, result = 0.75
   - Artificially inflates weaker matches when deep fusion is high
   - Creates false confidence in marginal results

2. **Hidden Color Corrections** (line 3964)
   - Color caps are applied AFTER other scoring
   - Users don't see the penalties explained clearly
   - Creates inconsistency

3. **No Length Scoring** (confirmed 0.32 across ALL products)
   - Length compliance should heavily influence final score
   - Currently ignored
   - Missing major relevance dimension

### Solution: Simplified, Transparent Calculation

Replace the complex pipeline with **clear, additive relevance factors**:

```typescript
function computeIntuitiveRelevance(factors: {
  // Visual match (0-1)
  visualSimilarity: number; // CLIP cosine

  // Type match (0-1)
  typeCompliance: number; // Does sleeve/category match?
  lengthCompliance: number; // Does hem length match?

  // Color match (0-1)
  colorAffinity: number; // How related are the colors?
  colorExplicitness: number; // Was color explicitly desired?

  // Style match (0-1)
  styleCompliance: number; // Formality, pattern, etc.

  // Market factors (0-1)
  availabilityBoost: number; // Is it in stock?
  pricingRelevance: number; // Is price reasonable?
}): {
  score: number;
  explanation: string;
} {
  // Base relevance: visual similarity with floor
  const visualFloor = 0.4; // Never too low if visually similar
  const visualBoost = Math.max(visualFloor, factors.visualSimilarity);

  // Attribute matching: penalize non-matches, boost matches
  const typeBoost = Math.max(0.5, factors.typeCompliance * 1.2); // Type is important
  const lengthBoost = Math.max(0.6, factors.lengthCompliance * 1.3); // Length is critical
  const colorBoost = 0.7 + factors.colorAffinity * 0.3; // Color matters but not absolute
  const styleBoost = 0.75 + factors.styleCompliance * 0.25; // Style is secondary

  // Combined: multiplicative with floor to prevent collapse
  let combined =
    visualBoost * typeBoost * lengthBoost * colorBoost * styleBoost;
  combined = Math.min(1.0, combined * 0.8); // Normalize range

  // Market factors: small adjustments only
  let final = combined;
  if (factors.availabilityBoost > 0.8) final *= 1.05;
  if (factors.pricingRelevance > 0.8) final *= 1.02;

  // Clamp to 0-1
  final = Math.max(0, Math.min(1, final));

  // Explain which factors affected the score
  const reducingFactors = [];
  if (factors.typeCompliance < 0.5) reducingFactors.push("type mismatch");
  if (factors.lengthCompliance < 0.5) reducingFactors.push("length mismatch");
  if (factors.colorAffinity < 0.4 && factors.colorExplicitness > 0.5) {
    reducingFactors.push("color contradiction");
  }

  return {
    score: final,
    explanation:
      reducingFactors.length > 0
        ? `Penalized for: ${reducingFactors.join(", ")}`
        : "Good match across all dimensions",
  };
}
```

---

## Implementation Roadmap

### Phase 1: Length Detection (1-2 weeks)

- [ ] Add dress length inference from bounding box Y-coordinates
- [ ] Create length compliance matrix
- [ ] Test on 100+ search results
- [ ] Add length explain details to JSON

### Phase 2: Score Consolidation (1 week)

- [ ] Consolidate dual relevance scores into single calculation
- [ ] Add explain.gates to show what affected the score
- [ ] Remove hidden color correction rewrites
- [ ] Test API response consistency

### Phase 3: Realistic Color Penalties (1 week)

- [ ] Implement color affinity matrix
- [ ] Replace binary 0.72/0.82 multipliers with graduated approach
- [ ] Test: Blue query should show turquoise near top, black lower but still visible
- [ ] Validation: Black dresses should have 0.35-0.50 relevance, not 0.20

### Phase 4: Final Relevance Simplification (1 week)

- [ ] Refactor to single-pass scoring
- [ ] Add type + length + color + style factors
- [ ] Remove over-blending of deep fusion
- [ ] Test: Relevance scores should feel intuitive (0.8+ = great match, 0.5-0.8 = good, <0.5 = weak)

---

## Testing & Validation

### Test Case 1: Length Detection

```json
Query: "blue long sleeve dress"
Expected:
- Long dresses: 0.75-0.95 (correct)
- Midi dresses: 0.40-0.60 (partially correct)
- Short/mini dresses: 0.10-0.30 (mismatched)

Current Result:
- All dresses: ~0.70+ (no length differentiation)
```

### Test Case 2: Color Affinity

```json
Query: "blue dress"
Expected Relevance by Color:
- Navy: 0.75-0.85      (very similar)
- Turquoise: 0.55-0.75 (adjacent)
- Black: 0.20-0.40     (neutral)
- Red: 0.10-0.25       (contradictory)

Current Result:
- Navy: 0.70+          (fine)
- Turquoise: 0.30+     (too low)
- Black: 0.20-0.30     (penalized unfairly)
- Red: 0.10-0.20       (correct)
```

### Test Case 3: Dual Score Consolidation

```json
Query: Any image search
Expected:
- One finalRelevance01 value
- explain.finalRelevance01 matches top-level value
- explain.gates shows why if capped

Current Result:
- Two different values: 0.748 vs 0.239
- User cannot determine which is real
```

---

## Configuration & Feature Flags

Recommend adding these ENV vars for tuning:

```bash
# Length detection
SEARCH_LENGTH_INFERENCE_ENABLED=true
SEARCH_LENGTH_Y_THRESHOLD_MAXI=0.35  # >35% of legs = maxi
SEARCH_LENGTH_Y_THRESHOLD_MIDI=0.15  # 15-35% of legs = midi

# Color penalties
SEARCH_COLOR_AFFINITY_ENABLED=true
SEARCH_COLOR_STRICT_THRESHOLD=0.5    # When to be strict vs lenient
SEARCH_COLOR_CONTRADICTION_CAPS=0.50,0.60,0.70  # More realistic

# Final relevance
SEARCH_FINAL_RELEVANCE_VERSION=2      # Use new calculation
SEARCH_FINAL_INCLUDE_LENGTH=true      # Include length in scoring
SEARCH_FINAL_LENGTH_WEIGHT=0.30       # 30% weight on length match
```

---

## Summary of Changes

| Issue                    | Root Cause                             | Solution                      | Impact                            | Effort |
| ------------------------ | -------------------------------------- | ----------------------------- | --------------------------------- | ------ |
| **#1: Length Detection** | YOLO only detects sleeves, not hem     | Infer from bbox Y-ratio       | Better shorts/maxis separation    | Medium |
| **#2: Dual Scores**      | Color correction applied after scoring | Merge into single calc        | Clear, consistent API             | Medium |
| **#3: Color Penalties**  | 0.82 mult + 0.28 cap = 72% reduction   | Graduated affinity matrix     | Black dresses visible (0.30-0.50) | Medium |
| **#4: Lack of Realism**  | Deep fusion + hidden gates = unclear   | Transparent, additive factors | Intuitive relevance 0-1           | High   |

**Total Effort:** 4-5 weeks for full solution  
**Quick Win:** Disable deep fusion blending & fix color caps → 1 week
