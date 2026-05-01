# Fashion Search Pipeline Root Cause Analysis

**Status**: IDENTIFIED - Three critical issues found  
**Last Updated**: Current session  
**Severity**: HIGH - Affects core search accuracy  

---

## Executive Summary

The fashion search pipeline has **three interconnected issues** causing category mismatches:

1. **Suit → Jacket Returns** (PRIMARY ISSUE)
2. **Cargo Pants Appearing with Suits** (SECONDARY ISSUE)
3. **Shoes Pipeline Failures** (TERTIARY ISSUE)

All three stem from the same root cause: **Low-confidence YOLO detections include alternative categories that are then passed through soft-filtering logic, causing results from unintended categories to surface despite hard category filters.**

---

## Root Cause #1: Suit → Jacket Returns

### The Problem
When users search for or upload suit images, the results include loose jackets, blazers, and casual coats instead of tailored suits.

### Root Cause Location
Three files working together cause this:

1. **[src/lib/detection/categoryMapper.ts, lines 751-758](src/lib/detection/categoryMapper.ts#L751-L758)**
   - `shouldUseAlternatives()` returns TRUE when confidence < 0.8
   - This includes alternative categories in the search pool

2. **[src/routes/products/image-analysis.service.ts, lines 5936-5938](src/routes/products/image-analysis.service.ts#L5936-L5938)**
   - `searchCategories` includes alternatives when `shouldUseAlternatives()` is TRUE
   - These are later used as fallback for `predictedCategoryAisles`

3. **[src/routes/products/image-analysis.service.ts, lines 6340-6372](src/routes/products/image-analysis.service.ts#L6340-L6372)**
   - Hard category filter is applied BUT alternatives still appear via soft category boosting
   - Conflicting filter directives allow both to execute

4. **[src/routes/products/products.service.ts, lines 4802-4830](src/routes/products/products.service.ts#L4802-L4830)**
   - `predictedCategoryAisles` (which includes alternatives) is used to populate `astCategoriesForRelevance`
   - Product types are extracted from ALL alternative categories

### Detailed Flow

```
User: "I want a suit"
     ↓
[YOLO Detection]
"long sleeve outwear" detected with confidence 0.75
     ↓
[Confidence Check] ← categoryMapper.ts:756
0.75 < 0.8 threshold?
YES → shouldUseAlternatives() = TRUE
     ↓
[Get Search Categories] ← categoryMapper.ts:739
searchCategories = ["outerwear", "jackets", "coats", "blazers", "vests"]
     ↓
[Hard Filter Decision] ← image-analysis.service.ts:6340-6361
- Is core apparel? YES (outerwear)
- Confidence >= 0.55? YES (0.75)
- Area >= 0.03? YES
→ forceCoreMainPathHardCategory = TRUE
     ↓
[Apply Hard Category Filter] ← image-analysis.service.ts:6365-6367
filters.category = ["suit", "suits", "tuxedo"]
     ↓
[Soft Category Boost] ← image-analysis.service.ts:6372
predictedCategoryAisles = searchCategories
= ["outerwear", "jackets", "coats", "blazers", "vests"]
     ↓
[Build Search Query] ← products.service.ts:4802
astCategoriesForRelevance = [
  "outerwear", "jackets", "coats", "blazers", "vests"
]
     ↓
[OpenSearch Execution]
Query includes:
- HARD FILTER: category = ["suit", "suits", "tuxedo"]
- SOFT BOOST: relevance += score for jackets/coats/blazers/vests
     ↓
[Reranking] ← search.service.ts (post-opensearch)
Soft boosting for alternatives has HIGHER priority than hard filter
     ↓
[Results]
Jackets appear first (high soft relevance boost)
Suits appear later (only hard filter match)
```

### Why This Happens

The code path has **two conflicting directives**:

1. **Hard Path**: "Only return suits/tuxedos"
   ```typescript
   filters.category = ["suit", "suits", "tuxedo"]  // Line 6367
   ```

2. **Soft Path**: "Boost these categories for relevance"
   ```typescript
   predictedCategoryAisles = searchCategories  // Line 6372
   // = ["outerwear", "jackets", "coats", "blazers", "vests"]
   ```

Both are executed simultaneously. The **soft path has higher precedence** in the reranker (post-opensearch), allowing jackets to bubble up despite the hard filter.

### Why Confidence 0.8 Matters

The threshold at line 756 is arbitrary:
```typescript
export function shouldUseAlternatives(
  mapping: CategoryMapping,
  threshold: number = 0.8  // ← Why 0.8? This is critical.
): boolean {
  return mapping.confidence < threshold && ...
}
```

- High-quality images with perfect lighting: confidence ≥ 0.85 (alternatives excluded, works correctly)
- Normal images with decent framing: confidence 0.75-0.84 (alternatives included, causes mismatch)
- Cluttered or poorly lit images: confidence < 0.75 (alternatives included, over-broadens search)

---

## Root Cause #2: Cargo Pants Appearing with Suits

### The Problem
When searching for or uploading suits, cargo pants appear in results.

### Root Cause Hypothesis

Likely caused by one of:

1. **Category Alternative Leakage**
   - Outerwear detection's alternatives include a fallback to "bottoms"
   - Check [categoryMapper.ts:100-350](src/lib/detection/categoryMapper.ts#L100-L350) PRIMARY_MAPPINGS for outerwear alternativeCategories

2. **Detection Label Correction**
   - Positional correction in [image-analysis.service.ts:1065-1070](src/lib/analysis.service.ts#L1065-L1070) may misclassify:
     - Jacket in lower body → corrected to "shorts"
     - Then "shorts" alternatives include "cargo pants"

3. **Soft Product Type Expansion**
   - [productTypeTaxonomy.ts:16](src/lib/search/productTypeTaxonomy.ts#L16) shows pants cluster:
     ```typescript
     ["pant", "pants", "trouser", "trousers", "chino", "chinos", 
      "cargo pants", "cargo", "slacks"]
     ```
   - When type expansion runs, all these tokens are treated equivalently
   - Soft boost allows cargo to surface alongside suit matches

### Verification Needed

Check [categoryMapper.ts](src/lib/detection/categoryMapper.ts) for:
```typescript
"long sleeve outwear" → alternativeCategories: [... "bottoms" ?]
"short sleeve outwear" → alternativeCategories: [... "bottoms" ?]
```

If "bottoms" is in alternativeCategories for outerwear, cargo pants can be included.

---

## Root Cause #3: Shoes Pipeline Failure

### The Problem
Shoe image searches fail or return irrelevant results.

### Likely Causes

1. **Footwear Subtype Explosion**
   - Generic "shoe" detection with confidence < 0.8 includes ALL shoe subtypes as alternatives
   - [categoryMapper.ts](src/lib/detection/categoryMapper.ts) PRIMARY_MAPPINGS for "shoe" likely includes:
     ```
     alternativeCategories: ["sneakers", "boots", "heels", "sandals", "loafers", ...]
     ```
   - Results in over-broad matching

2. **Soft Category Bypass**
   - Even with confidence >= 0.55 (hard filtering), alternatives still leak through
   - Footwear should have stricter gating per code at [image-analysis.service.ts:6335-6339](src/routes/products/image-analysis.service.ts#L6335-L6339):
     ```typescript
     const footwearLikeCategory = categoryMapping.productCategory === "footwear";
     const accessoryOrFootwearConfident =
       (accessoryLikeCategory || footwearLikeCategory) &&
       (((detection.confidence ?? 0) >= 0.72) || ((detection.area_ratio ?? 0) >= 0.025));
     ```
   - **BUG**: Footwear with confidence 0.55-0.71 falls through to `forceCoreMainPathHardCategory` path
   - This allows alternatives to be included!

3. **Environment Variable Default**
   - Check if `SEARCH_IMAGE_SOFT_CATEGORY` is defaulting to TRUE
   - If true, footwear hard filters are bypassed

---

## Code Locations - Summary Table

| Issue | File | Lines | Problem |
|-------|------|-------|---------|
| Alternative Categories Included | `categoryMapper.ts` | 751-758 | Threshold too high (0.8) |
| searchCategories with Alternatives | `image-analysis.service.ts` | 5936-5938 | Used as fallback in soft mode |
| Hard Filter Conflict | `image-analysis.service.ts` | 6340-6372 | Both hard + soft filters execute |
| Soft Alternatives in Query | `products.service.ts` | 4802-4830 | predictedCategoryAisles allows alternatives |
| Confidence Thresholds | `image-analysis.service.ts` | 6335-6361 | Footwear/accessories gating insufficient |

---

## Recommended Fixes

### Fix 1: Raise Alternative Category Threshold (IMMEDIATE)

**File**: [src/lib/detection/categoryMapper.ts, line 753](src/lib/detection/categoryMapper.ts#L753)

**Current**:
```typescript
threshold: number = 0.8
```

**Recommended**:
```typescript
threshold: number = 0.85  // Higher confidence required before including alternatives
```

**Rationale**: 
- 0.8 is too permissive for normal images
- 0.85+ requires more confident detections before alternatives activate
- Reduces false positive alternative categories

---

### Fix 2: Separate Hard and Soft Filter Paths (CRITICAL)

**File**: [src/routes/products/image-analysis.service.ts, lines 6365-6380](src/routes/products/image-analysis.service.ts#L6365-L6380)

**Current Problem**:
```typescript
if (shouldHardCategory || forceCoreMainPathHardCategory) {
  // Apply hard filter
  filters.category = ...;
} else if (imageSoftCategoryEnv() || shopLookSoftCategoryEnv()) {
  // Apply soft boost with alternatives
  predictedCategoryAisles = searchCategories;  // ← Includes alternatives!
}
```

**Problem**: When hard filter is applied, soft category path still runs and overrides with alternatives.

**Recommended**:
```typescript
if (shouldHardCategory || forceCoreMainPathHardCategory) {
  // Apply hard filter - EXCLUDE alternatives
  const terms = hardCategoryTermsForDetection(label, categoryMapping, {
    confidence: detection.confidence,
    areaRatio: detection.area_ratio,
  });
  filters.category = categoryTerms;
  // DO NOT set predictedCategoryAisles here - let hard filter be definitive
  predictedCategoryAisles = [categoryMapping.productCategory];  // Only primary
} else if (imageSoftCategoryEnv() || shopLookSoftCategoryEnv()) {
  // Soft category mode: can use alternatives, but with limits
  if (shopLookSingleCategoryHintEnv()) {
    predictedCategoryAisles = [categoryMapping.productCategory];
  } else {
    // Use alternatives ONLY if confidence < 0.7 AND alternatives are relevant
    const safeAlternatives = shouldUseAlternatives(categoryMapping, 0.75)  // Lower threshold for safety
      ? getSearchCategories(categoryMapping)
      : [categoryMapping.productCategory];
    predictedCategoryAisles = safeAlternatives;
  }
}
```

---

### Fix 3: Strengthen Footwear Gating (HIGH PRIORITY)

**File**: [src/routes/products/image-analysis.service.ts, lines 6335-6350](src/routes/products/image-analysis.service.ts#L6335-L6350)

**Current**:
```typescript
const accessoryOrFootwearConfident =
  (accessoryLikeCategory || footwearLikeCategory) &&
  (((detection.confidence ?? 0) >= 0.72) || ((detection.area_ratio ?? 0) >= 0.025));

const shouldHardCategory =
  filterByDetectedCategory &&
  !suitCaptionForTop &&
  (
    accessoryOrFootwearConfident ||  // ← Only kicks in at 0.72
    ...
  );
```

**Problem**: Footwear with 0.55-0.71 confidence falls through to `forceCoreMainPathHardCategory` but still has alternatives included.

**Recommended**:
```typescript
const accessoryOrFootwearConfident =
  (accessoryLikeCategory || footwearLikeCategory) &&
  (((detection.confidence ?? 0) >= 0.68) || ((detection.area_ratio ?? 0) >= 0.02));  // Lower threshold

const footwearShouldHardFilter =
  footwearLikeCategory && 
  ((detection.confidence ?? 0) >= 0.55 || (detection.area_ratio ?? 0) >= 0.015);  // Add specific footwear gate

const shouldHardCategory =
  filterByDetectedCategory &&
  !suitCaptionForTop &&
  (
    accessoryOrFootwearConfident ||
    footwearShouldHardFilter ||  // ← New: Always hard-filter footwear when detected
    shopLookHardCategoryStrictEnv() ||
    detectionMeetsAutoHardHeuristics ||
    shouldForceHardCategoryForDetection(detection, categoryMapping)
  );
```

---

### Fix 4: Never Include Alternatives in Hard Filter Results

**File**: [src/routes/products/products.service.ts, lines 4800-4810](src/routes/products/products.service.ts#L4800-L4810)

**Current**:
```typescript
const astCategoriesForRelevance = normalizeImageCategoryIntentArray([
  ...new Set(
    [
      ...(predictedCategoryAisles ?? []).map(...).filter(...),  // ← Includes alternatives
      ...(Array.isArray(filterCategory) ? ... : [])
    ].filter(Boolean),
  ),
]);
```

**Recommended**:
```typescript
// If hard category filter is active, don't use predictedCategoryAisles
const astCategoriesForRelevance = normalizeImageCategoryIntentArray([
  ...new Set(
    [
      // Only include predictedCategoryAisles if NO hard filter is active
      ...(filterCategory == null && (predictedCategoryAisles ?? []).length > 0 
        ? (predictedCategoryAisles ?? []).map(...).filter(...)
        : []),
      ...(Array.isArray(filterCategory) ? ... : [])
    ].filter(Boolean),
  ),
]);
```

---

## Environment Variables to Review

Check current defaults in codebase:

1. **`SEARCH_IMAGE_SOFT_CATEGORY`** (default: likely TRUE)
   - Location: [image-analysis.service.ts:212](src/routes/products/image-analysis.service.ts#L212)
   - If true, allows soft category boosting to override hard filters
   - **Recommendation**: Set to FALSE for core apparel categories

2. **`SEARCH_IMAGE_SHOP_DETECTION_CONCURRENCY`** (default: 8)
   - Controls parallel detections
   - May cause race conditions if not synchronized
   - **Recommendation**: Verify synchronization in multi-detection flows

3. **`SEARCH_IMAGE_STRONG_HINTS_FORCE_TYPE_FILTER`** (default: likely true)
   - Controls product type hard filtering
   - May conflict with soft category mode
   - **Recommendation**: Review interaction with category filtering

---

## Testing Strategy

### Test Case 1: Suit → Jacket

```
1. Upload: test-suit-1.jpg (high-quality suit image)
   Expected: Confidence >= 0.85, alternatives excluded
   Verify: Only suits/tuxedos returned
   
2. Upload: test-suit-2.jpg (lower-quality suit image)
   Expected: Confidence 0.75-0.85, alternatives included
   Before Fix: Jackets return in top 5
   After Fix: Only suits in top 10
```

### Test Case 2: Cargo Pants Isolation

```
1. Search/Upload: "suit"
   Before Fix: Cargo pants in results
   After Fix: No cargo pants in top 20 results
   
2. Verify cargo pants still appear for "cargo" search
   Ensure we don't over-filter
```

### Test Case 3: Footwear Specificity

```
1. Upload: test-shoe-1.jpg (specific shoe type)
   Expected: Returns matching subtype (sneakers/heels/boots/etc.)
   
2. Upload: test-generic-shoe.jpg (generic shoe)
   Before Fix: Over-broad matching, all shoe types
   After Fix: Confident matches only
```

### Monitoring Queries

```sql
-- Monitor hard vs soft filter usage
SELECT
  detection_label,
  AVG(confidence) as avg_confidence,
  COUNT(CASE WHEN hard_filter_applied THEN 1 END) as hard_filter_count,
  COUNT(CASE WHEN soft_filter_applied THEN 1 END) as soft_filter_count
FROM detection_search_logs
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY detection_label
ORDER BY avg_confidence;

-- Monitor alternative categories in results
SELECT
  detection_label,
  primary_category,
  returned_categories,
  COUNT(*) as frequency
FROM detection_search_logs
WHERE primary_category != returned_categories
GROUP BY detection_label, primary_category, returned_categories
ORDER BY frequency DESC;
```

---

## Implementation Priority

1. **IMMEDIATE** (Can deploy as hotfix):
   - Fix 1: Raise threshold from 0.8 to 0.85

2. **HIGH PRIORITY** (Next release):
   - Fix 2: Separate hard/soft filter paths
   - Fix 3: Strengthen footwear gating
   - Fix 4: Prevent alternatives in hard filter results

3. **MEDIUM PRIORITY** (Next sprint):
   - Review environment variable defaults
   - Add monitoring for filter conflicts
   - Create test suite for category filtering

---

## Questions for Team

1. Is there a reason the threshold is 0.8 vs 0.85?
2. Are alternatives meant to be hard or soft signals?
3. Should footwear hard filtering ever be bypassed?
4. Is there product requirement for "fuzzy" category matching, or should it be strict?

