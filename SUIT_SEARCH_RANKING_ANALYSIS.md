# Suit Search Ranking & Category Matching Analysis

## Executive Summary

The codebase implements a **two-tier relevance scoring system** where category matching affects the final score, but the impact is currently **limited and sub-optimal for suit searches**. Category matching provides only a **+25% boost** (`categoryBoost = 1 + catScore * 0.25`) in the final relevance calculation, meaning exact category matches get minimal benefit over visual similarity alone.

---

## 1. How Suit Searches Are Currently Handled

### 1.1 Category Detection & Mapping

**File:** [src/lib/search/categoryFilter.ts](src/lib/search/categoryFilter.ts)

**Category Hierarchy for Suits:**
```typescript
// "tailored" is the canonical category for suits, tuxedos, blazers, vests
tailored: [
  "tailored", "suit", "suits", "tuxedo", "tuxedos", 
  "suit jacket", "suit jackets", "dress jacket", "dress jackets",
  "waistcoat", "waistcoats", "vest", "vests", "gilet", "gilets",
  "structured jacket", "structured jackets",
  "tailored jacket", "tailored jackets"
]

// "outerwear" is broader, includes jackets/coats/blazers
outerwear: [
  "outerwear", "jacket", "jackets", "coat", "coats", "blazer", "blazers",
  // ... + 80+ other variants
]
```

**Inference Function:** `inferCategoryCanonical()` (line 580+)
- Detects suit-related terms via regex: `/\b(suit|suits|tuxedo|tuxedos|suit\s+jacket|suit\s+jackets|dress\s+jacket|dress\s+jackets|waistcoat|waistcoats|vest|vests|gilet|gilets|...)/`
- Maps to `"tailored"` category if matches

### 1.2 Suit Catalog Cues (Explicit Detection)

**File:** [src/lib/search/suitCatalogCue.ts](src/lib/search/suitCatalogCue.ts)

**Explainability Function:** `explainActualSuitCatalogCue()` - detects real tailored suits vs false positives

**Detection Rules:**
```
1. Explicit tuxedo token → matched
2. Full suit phrases ("two-piece suit", "matching suit", "suiting") → matched
3. Explicit suit token (after filtering "suit jacket") → matched
4. Blazer + bottom hints (pants/trouser/slacks/set) → matched
5. Suit category in raw catalog → matched
6. Non-tailored contexts → filtered out (swimsuit, tracksuit, bodysuit, jumpsuit, etc.)
```

**Example:**
```typescript
// TRUE POSITIVES:
- "Wool Two-Piece Suit" → matched: "full_suit_phrase"
- "Men's Blazer + Trouser Set" → matched: "blazer_plus_bottom_hint"
- "Tuxedo Jacket" → matched: "explicit_tuxedo_token"

// FALSE POSITIVES (filtered):
- "Swimsuit" → rejected: "non_tailored_suit_phrase"
- "Tracksuit" → rejected: "non_tailored_suit_category"
```

---

## 2. Final Relevance Score Calculation

### 2.1 Main Entry Point

**File:** [src/lib/search/searchHitRelevance.ts](src/lib/search/searchHitRelevance.ts#L1461)

**Function:** `computeHitRelevance()` (full signature line 1241+)
- Called for both text search and image search
- Returns structured breakdown: `{ finalRelevance01, ... }`

### 2.2 Score Formula

**Function:** `computeFinalRelevance01()` (line 110-210)

**Current Formula:**
```
categoryBoost = 1 + catScore * 0.25
globalScore = semScore * 0.6 + lexScore * 0.4

attrFactor = 0.5 + attrScore * 0.5

raw = globalScore 
    * typeGateFactor 
    * categoryBoost        ← CATEGORY BOOST HERE
    * attrFactor 
    * crossFamilySoftFactor 
    * intraFamilySoftFactor

bounded = max(0, min(1, raw))
softCap = min(1, semScore + capBonus)
finalRelevance01 = min(bounded, softCap)
```

**What This Means:**
- Category boost multiplies the final score by: `1.0` (no match) to `1.25` (exact match)
- This is a **+25% maximum increase**, applied multiplicatively
- For a score of `0.80`: exact match gives `0.80 * 1.25 = 1.0` (capped at 1)
- For a score of `0.65`: exact match gives `0.65 * 1.25 = 0.8125`

### 2.3 Category Score Calculation

**Function:** `scoreCategoryRelevance01()` (line 64-105)

**Scoring Tiers:**
```typescript
1.0  → Exact match: query category = document category or canonical
0.55 → Partial match: category names overlap significantly
0.0  → No match
```

**Logic:**
```typescript
// Build category hints from query
hints = [mergedCategory, ...astCategories]  // e.g., ["suit", "tailored"]

// Get aliases from category taxonomy
aliases = getCategorySearchTerms(h)  // e.g., for "suit" → all 10+ variants

// Score document
if (aliases.has(docCategory) || aliases.has(docCanonical)) 
  score = 1.0  // Exact match

if (docCategory includes alias OR alias includes docCategory)
  score = 0.55  // Partial match
```

---

## 3. Category Boost System

### 3.1 Current Implementation (Insufficient)

**Location:** [src/lib/search/searchHitRelevance.ts](src/lib/search/searchHitRelevance.ts#L165)

```typescript
const categoryBoost = 1 + params.catScore * 0.25;
```

**Problem:** The 25% boost is **multiplicative, not additive**:
- An exact category match (catScore=1.0) adds only +25% bonus
- Gets further constrained by the `softCap` which limits final score to `semScore + capBonus`
- Category matching cannot elevate a weak visual match to a strong result

### 3.2 Category Consistency Checks

**Function:** `topBottomCategoryConsistencyMultiplier()` (line 40-60)

Prevents cross-category mismatches:
```typescript
// Hard penalty if query category conflicts with product
if (queryCategory="tops" AND productCategory="bottoms")
  multiplier = 0.2  // 80% penalty

if (queryCategory="bottoms" AND productCategory="tops")
  multiplier = 0.2
```

**Status:** Only applies to tops/bottoms, NOT to suits/outerwear

---

## 4. Unified Image Scorer (Image Search Ranking)

### 4.1 Category-Specific Weights

**File:** [src/lib/search/unifiedImageScorer.ts](src/lib/search/unifiedImageScorer.ts#L211-L228)

For **"tailored"** (suits):
```typescript
if (detectionCategory === "tailored") 
  return { 
    visual: 0.30,    // Type matters most for suits
    type: 0.32,      // ← HIGHEST type weight in system
    color: 0.20,
    attrs: 0.18
  };
```

**For comparison:**
- Tops:      `visual: 0.40, type: 0.20, color: 0.25, attrs: 0.15`
- Footwear:  `visual: 0.42, type: 0.25, color: 0.20, attrs: 0.13`
- Outerwear: `visual: 0.40, type: 0.22, color: 0.20, attrs: 0.18`

**This is correct:** Suits get the *highest* type weight (0.32) and *lowest* visual weight (0.30)

### 4.2 Type Score Tiering

**Function:** `computeTypeScore()` (line 141-156)

```typescript
function computeTypeScore(input: UnifiedScoreInputs): number {
  const exact = clamp01(input.exactTypeScore);
  const compliance = clamp01(input.productTypeCompliance);
  const sibling = clamp01(input.siblingClusterScore);
  const parent = clamp01(input.parentHypernymScore);
  const cat = clamp01(input.categoryRelevance01);

  if (exact >= 1) return 1.0;           // Exact type match
  if (compliance >= 0.82) return 0.85;  
  if (compliance >= 0.62) return 0.70;  
  if (sibling >= 0.50) return 0.55;
  if (compliance >= 0.30) return 0.45;
  if (parent >= 0.50) return 0.40;
  if (cat >= 0.95) return 0.35;         // Bare category match only
  return Math.max(compliance * 0.6, cat * 0.30);
}
```

**Problem:** Category-only fallback is capped at 0.35, which is LOW

---

## 5. Image Search Pipeline

### 5.1 Detection-Based Category Mapping

**File:** [src/routes/products/image-analysis.service.ts](src/routes/products/image-analysis.service.ts#L1-L80)

**Flow:**
1. YOLO detects garment → produces `label` (e.g., "blazer")
2. `mapDetectionToCategory()` maps label to canonical category → "tailored" or "outerwear"
3. Category is passed to `searchByImageWithSimilarity()` as `detectionProductCategory`
4. Search service uses category to:
   - Apply category-aware type filtering
   - Weight components via `categoryWeights()`
   - Gate cross-category mismatches

### 5.2 How YOLO Detection Affects Ranking

When YOLO detects "blazer":
1. Detection category → "tailored" (via categoryMapper)
2. Applied to `computeHitRelevance()`:
   - `mergedCategory = "tailored"`
   - `catScore = scoreCategoryRelevance01("tailored", [], docCategory, docCanonical)`
3. Passed to `computeFinalRelevance01()`:
   - If document category="tailored" → catScore=1.0 → boost=1.25
   - If document category="outerwear" → catScore=0.55 → boost=1.1375
   - If document category="other" → catScore=0.0 → boost=1.0

---

## 6. How Category Matching Currently Works vs Should Work

### 6.1 Current Behavior

| Query | Doc Category | Suit Status | catScore | Impact on 0.80 Score |
|-------|--------------|-------------|----------|---------------------|
| "suit" | "tailored" | TRUE | 1.0 | 0.80 × 1.25 = 1.0 |
| "suit" | "outerwear" | MAYBE | 0.55 | 0.80 × 1.1375 = 0.91 |
| "suit" | "dresses" | FALSE | 0.0 | 0.80 × 1.0 = 0.80 |
| Image detect "blazer" | "outerwear" | MAYBE | 0.55 | Visual + 0.55 bonus |

**Issue:** The +25% boost is:
- ✓ Multiplicative (not additive)
- ✓ Applied to all components
- ✗ **TOO SMALL** — category match adds ~5-10 points to a 80-point score
- ✗ **GETS CAPPED** — softCap limits to semScore + capBonus

### 6.2 Desired Behavior

Category matching **should prioritize exact matches** over visual similarity:

| Scenario | Current | Should Be | Fix |
|----------|---------|-----------|-----|
| Suit query, tailored doc with 0.80 visual | 1.0 | 0.95 | **Hard floor:** min 0.95 for exact category |
| Suit query, outerwear doc with 0.85 visual | 0.91 | 0.75 | **Hard penalty:** -0.10 for wrong category |
| Image search "suit blazer" → outerwear doc | 0.90 | 0.78 | **Category gate:** Check if "blazer" appears in title |

---

## 7. Key Files & Functions

### Core Ranking Logic
| File | Function | Purpose |
|------|----------|---------|
| [searchHitRelevance.ts](src/lib/search/searchHitRelevance.ts) | `computeFinalRelevance01()` | Final score formula |
| [searchHitRelevance.ts](src/lib/search/searchHitRelevance.ts#L64) | `scoreCategoryRelevance01()` | Category score (0..1) |
| [unifiedImageScorer.ts](src/lib/search/unifiedImageScorer.ts) | `scoreCandidateUnified()` | Image search reranker |
| [unifiedImageScorer.ts](src/lib/search/unifiedImageScorer.ts#L214) | `categoryWeights()` | Category-specific component weights |

### Category Detection
| File | Function | Purpose |
|------|----------|---------|
| [categoryFilter.ts](src/lib/search/categoryFilter.ts#L580) | `inferCategoryCanonical()` | Map title to category |
| [suitCatalogCue.ts](src/lib/search/suitCatalogCue.ts) | `explainActualSuitCatalogCue()` | Detect tailored suits |
| [suitCatalogCue.ts](src/lib/search/suitCatalogCue.ts) | `hasActualSuitCatalogCue()` | Boolean check |

### Image Search
| File | Function | Purpose |
|------|----------|---------|
| [image-analysis.service.ts](src/routes/products/image-analysis.service.ts) | `mapDetectionToCategory()` | Map YOLO → category |
| [search.service.ts](src/routes/products/search.service.ts) | `searchByImageWithSimilarity()` | Main image search |

---

## 8. Problems Identified

### Problem 1: Category Boost is Multiplicative, Not Additive
- **Impact:** Exact category match adds only ~5-10 points to score
- **Location:** [searchHitRelevance.ts:165](src/lib/search/searchHitRelevance.ts#L165)
- **Root Cause:** `categoryBoost = 1 + catScore * 0.25` multiplies the final score

### Problem 2: Soft Cap Limits Category Benefit
- **Impact:** Strong category matches get capped by `softCap = semScore + capBonus`
- **Location:** [searchHitRelevance.ts:202-204](src/lib/search/searchHitRelevance.ts#L202-204)
- **Example:** `0.80 * 1.25 = 1.0` gets capped to `min(1.0, 0.85) = 0.85`

### Problem 3: Suit Category Not Prioritized for Cross-Family Prevention
- **Impact:** Blazer (outerwear) can outrank suit (tailored) with similar visual score
- **Location:** Lacking suit-specific cross-family penalty in [searchHitRelevance.ts](src/lib/search/searchHitRelevance.ts)
- **Should be:** If user searches "suit" + document is "outerwear", apply 0.15-0.25 penalty

### Problem 4: Detection Category Confidence Not Passed Through
- **Impact:** Image search doesn't know YOLO confidence for category detection
- **Location:** [image-analysis.service.ts](src/routes/products/image-analysis.service.ts) → [search.service.ts](src/routes/products/search.service.ts)
- **Should pass:** `detectionYoloConfidence` to relevance scoring

### Problem 5: Suit vs Blazer vs Outerwear Distinction Lost
- **Impact:** "suit" query can't distinguish between tailored suit vs blazer vs jacket
- **Location:** All category scores use simple presence/absence matching
- **Should use:** Explicit suit metadata (`hasActualSuitCatalogCue()`) as hard gate

---

## 9. Recommendations

### Priority 1: Explicit Suit Catalog Cue in Scoring
**Location:** [searchHitRelevance.ts](src/lib/search/searchHitRelevance.ts)

When user searches "suit":
- If document has actual suit metadata → boost by +0.15
- If document is outerwear/blazer → apply -0.10 penalty
- Use `hasActualSuitCatalogCue()` for boolean gate

### Priority 2: Category-Specific Final Relevance Formulas
**Location:** [searchHitRelevance.ts:165](src/lib/search/searchHitRelevance.ts#L165)

Instead of: `categoryBoost = 1 + catScore * 0.25`

Use category-specific boosts:
```typescript
if (detectedCategory === "tailored" && catScore >= 0.95)
  finalRelevance01 = Math.max(finalRelevance01, 0.88);  // Hard floor
else if (detectedCategory === "tailored" && catScore === 0)
  finalRelevance01 *= 0.85;  // Cross-category penalty
```

### Priority 3: Pass YOLO Confidence Through Pipeline
**Location:** [image-analysis.service.ts](src/routes/products/image-analysis.service.ts)

Add to detection blob:
```typescript
{
  detectionProductCategory: "tailored",
  detectionYoloConfidence: 0.92,  // ← NEW
  // ...existing fields
}
```

### Priority 4: Dynamic Category Gate Based on Query
**Location:** [searchHitRelevance.ts](src/lib/search/searchHitRelevance.ts)

When strict category intent exists (e.g., explicit "suit" search):
- Enforce category consistency check for tailored items
- Apply cross-category penalties for wrong categories
- Use `topBottomCategoryConsistencyMultiplier` pattern for suits

---

## 10. Current Environment Settings

**Relevant env vars:**
- `SEARCH_RERANK_SIM_WEIGHT` - Visual similarity weight (default 72)
- `SEARCH_RERANK_AUD_WEIGHT` - Audience weight (default 24)
- `SEARCH_BEAUTY_APPAREL_CROSS_PENALTY` - Garment vs beauty penalty (default 0.92)

**No suit-specific category boost settings exist** — this is the main gap.

---

## Appendix: Example Score Calculations

### Example 1: Text Search "suit" with Perfect Match
```
Query: "suit"
Document: {"category": "tailored", "title": "Men's Wool Suit", "product_types": ["suit"]}

scoreCategoryRelevance01("suit", ["tailored"], "tailored", null) → 1.0
categoryBoost = 1 + 1.0 * 0.25 = 1.25

semScore = 0.89, lexScore = 0.95
globalScore = 0.89 * 0.6 + 0.95 * 0.4 = 0.914
typeGateFactor = 1.0 (perfect type match)
attrFactor = 0.75 (colors/style match)

raw = 0.914 * 1.0 * 1.25 * 0.75 * 1.0 * 1.0 = 0.858
finalRelevance01 = min(0.858, min(1, 0.89 + 0.2)) = min(0.858, 1.0) = 0.858

✓ Result: 0.858 (Good)
```

### Example 2: Image Search "Blazer" but Document is Outerwear
```
Detection: YOLO "blazer", category = "outerwear" (confidence 0.88)
Document: {"category": "outerwear", "title": "Cotton Blazer", "product_types": ["blazer"]}

scoreCategoryRelevance01("outerwear", ["tailored"], "outerwear", null)
  → Partial match (outerwear overlaps with tailored aliases) = 0.55
categoryBoost = 1 + 0.55 * 0.25 = 1.1375

semScore = 0.82 (CLIP similarity)
typeCompliance = 0.78 (blazer vs outerwear)
unifiedImageScorer.categoryWeights("outerwear") 
  → {visual: 0.40, type: 0.22, color: 0.20, attrs: 0.18}

typeScore = 0.70 (sibling match)
colorScore = 0.85
attrScore = 0.72

base = 0.40 * 0.82 + 0.22 * 0.70 + 0.20 * 0.85 + 0.18 * 0.72 = 0.769

✗ Result: 0.769 (Weaker than suit would be; could rank below non-tailored)
```

---

## Summary

**Current system:** Category boost is **small (+25% max), multiplicative, and gated** by visual similarity.

**What's needed:** **Explicit suit prioritization** with hard floors for exact matches and penalties for cross-category mismatches, plus integration of YOLO confidence into the relevance pipeline.
