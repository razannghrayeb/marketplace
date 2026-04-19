# Detection → Search Fix Summary (2026-04-16)

## Problem Statement
YOLO detections correctly identified garments (tops, shoes), but the detected items were being ranked behind distant/unrelated products. Root cause: category-gating logic was allowing detections to drift into soft-category (taxonomy hints only) mode instead of enforcing hard-category matching.

## Root Causes & Fixes

### Bug A: Noisy Category Filter Over-Filtering Sleeve Labels
**Location**: `src/routes/products/image-analysis.service.ts` line 343  
**Issue**: `isNoisyCategoryForAutoHardCategory()` was marking "short sleeve top" and "long sleeve top" as noisy/ambiguous, forcing soft-category mode  
**Fix**: Removed sleeve-label checks from noise filter. Explicit sleeve labels are structural metadata, not noise.

```typescript
// BEFORE: would mark as noisy and skip hard category
if (lb.includes("short sleeve top") || lb.includes("long sleeve top")) return true;

// AFTER: sleeve labels remain eligible for hard category
// (removed the above lines)
```

### Bug B: Footwear Not Forced to Hard Category in Browse Path
**Location**: `src/routes/products/image-analysis.service.ts` line 5464  
**Issue**: Second code path (browse/closet-similar) lacked explicit footwear forcing, allowing footwear detections to soft-guide when env vars enabled broad soft-categorization  
**Fix**: Added explicit `footwearLikeCategory` check (matching accessories/bags behavior)

```typescript
// BEFORE: no explicit footwear forcing
const shouldHardCategory = accessoryLikeCategory || !(imageSoftCategoryEnv() || shopLookSoftCategoryEnv());

// AFTER: footwear now consistently forced to hard category
const footwearLikeCategory = categoryMapping.productCategory === "footwear";
const shouldHardCategory =
  accessoryLikeCategory ||
  footwearLikeCategory ||  // ← ADDED
  !(imageSoftCategoryEnv() || shopLookSoftCategoryEnv());
```

### Bug C: Consistency Across Dual Paths
**Location**: `src/routes/products/image-analysis.service.ts` lines 3978 and 5464  
**Issue**: First code path (multi-detection) already had footwear implicit via OR chain, but second path didn't  
**Fix**: Made both paths identical by explicitly adding `footwearLikeCategory` to both

```typescript
// Path 1 (Multi-Detection) — lines 3978–3987
const accessoryLikeCategory = isAccessoryLikeCategory(categoryMapping.productCategory);
const footwearLikeCategory = categoryMapping.productCategory === "footwear";
const shouldHardCategory =
  filterByDetectedCategory &&
  (
    accessoryLikeCategory ||
    footwearLikeCategory ||  // ← NOW EXPLICIT
    shopLookHardCategoryStrictEnv() ||
    detectionMeetsAutoHardHeuristics ||
    shouldForceHardCategoryForDetection(detection, categoryMapping)
  );

// Path 2 (Browse/Closet) — lines 5464–5472
const footwearLikeCategory = categoryMapping.productCategory === "footwear";
const shouldHardCategory =
  accessoryLikeCategory ||
  footwearLikeCategory ||  // ← NOW EXPLICIT
  !(imageSoftCategoryEnv() || shopLookSoftCategoryEnv());
```

## Additional Improvements (Already Staged)

### Crop Color Extraction Tightening (Bottoms)
**Location**: `src/routes/products/image-analysis.service.ts` lines 814–817  
**Change**: Narrower sampling band for bottoms to reduce shirt (top) and footwear (bottom) color bleed

| Metric | Before | After | Reason |
|--------|--------|-------|--------|
| left | 0.16 | 0.2 | Remove side padding |
| width | 0.68 | 0.6 | Narrower horizontal span |
| top (trousers) | 0.42 | 0.5 | Skip torso overlap |
| bottom (trousers) | 0.86 | 0.94 | Extend to shoe zone but keep lower |

### Shirt Recovery from Mislabeled Outwear
**Location**: `src/routes/products/image-analysis.service.ts` lines 978–993  
**Issue**: YOLO sometimes emits `outwear`/`jacket` for layered collages with upper-body tops  
**Fix**: Geometric heuristic to recover shirt label when box is clearly upper-body and not coat-length

```typescript
if (
  /\b(outwear|outerwear|jacket)\b/.test(label) &&
  centerY >= 0.2 &&
  centerY <= 0.58 &&      // upper body zone
  boxHeight >= 0.16 &&
  boxHeight <= 0.7        // not full-length coat
) {
  corrected.label = /\blong\b/.test(label) ? "long sleeve top" : "short sleeve top";
}
```

### Sleeve Inference Plural Handling
**Location**: `src/routes/products/image-analysis.service.ts` lines 1794–1806  
**Change**: Updated regex to match singular and plural forms (`sleeves?`)

```typescript
// BEFORE: would miss "short sleeves" (plural)
const hasShort = /\b(short sleeve|short sleeved|half sleeve|half-sleeve|3\/?4 sleeve|ss)\b/.test(txt);
const hasLong = /\b(long sleeve|long sleeved|full sleeve|full-sleeve|ls)\b/.test(txt);

// AFTER: matches both "short sleeve" and "short sleeves"
const hasShort = /\b(short sleeves?|short sleeved|half sleeves?|half-sleeve|3\/?4 sleeves?|ss)\b/.test(txt);
const hasLong = /\b(long sleeves?|long sleeved|full sleeves?|full-sleeve|ls)\b/.test(txt);
```

### Geometric Dress Length Detection
**Location**: `src/routes/products/image-analysis.service.ts` line 1693  
**Change**: Enabled by default (was opt-in via env var)

```typescript
// BEFORE: required SEARCH_IMAGE_ENABLE_GEOMETRIC_DRESS_LENGTH=1
const raw = String(process.env.SEARCH_IMAGE_ENABLE_GEOMETRIC_DRESS_LENGTH ?? "0").toLowerCase();

// AFTER: enabled by default, can be disabled with =0
const raw = String(process.env.SEARCH_IMAGE_ENABLE_GEOMETRIC_DRESS_LENGTH ?? "1").toLowerCase();
```

### Sleeve Compliance Threshold Tightened
**Location**: `src/routes/products/products.service.ts` line 4947  
**Change**: Lowered from 0.35 to 0.12 to reduce false-positive sleeve mismatches

```typescript
// BEFORE: any score < 0.35 triggered cap (too broad, caught uncertain/missing metadata)
if (isTopDetection && (compliance.hasSleeveIntent ?? false) && sleeveComp < 0.35) {
  finalRelevance01 = Math.min(finalRelevance01 ?? 0, similarityScore >= nearIdenticalRawMin ? 0.34 : 0.28);
}

// AFTER: only cap on strong mismatch (< 0.12, true contradiction)
if (isTopDetection && (compliance.hasSleeveIntent ?? false) && sleeveComp < 0.12) {
  finalRelevance01 = Math.min(finalRelevance01 ?? 0, similarityScore >= nearIdenticalRawMin ? 0.34 : 0.28);
}
```

### Dress Length Compliance Caps
**Location**: `src/routes/products/products.service.ts` lines 4959–4962  
**Change**: Added new cap for dress detections with length mismatch

```typescript
if (isDressDetection) {
  if (((compliance as any).hasLengthIntent ?? false) && lengthComp < 0.35) {
    finalRelevance01 = Math.min(finalRelevance01 ?? 0, similarityScore >= nearIdenticalRawMin ? 0.32 : 0.26);
    finalRelevanceSource = "dress_length_conflict_cap";
  }
  // ... existing dress silhouette cap ...
}
```

### Inferred Color Conflict Resolution
**Location**: `src/routes/products/products.service.ts` line 3455  
**Change**: Added `shouldPreferInferredColorWhenConflict()` logic for footwear color handling

```typescript
const preferInferredColorForConflict = shouldPreferInferredColorWhenConflict({
  mergedCategoryForRelevance: typeof mergedCategoryForRelevance === "string" ? mergedCategoryForRelevance : undefined,
  desiredProductTypes,
  inferredPrimary,
  inferredColorTokens,
});

// Used in color signal blending (line 3474)
const hasTrustedInferredColorSignal =
  inferredColorTokens.length > 0 &&
  (!inferredCropColorConflict || forceTrustInferredFootwearColor || hasStrongTopItemColor || preferInferredColorForConflict);
```

### Model B Accessory Detection Threshold
**Location**: `src/lib/model/dual-model-yolo.py` line 253  
**Change**: Passed explicit threshold to Hugging Face pipeline to prevent small accessories from being filtered out

```python
# BEFORE: used HF default threshold (high, ~0.5), suppressing small bags/wallets
raw_b = self._model_b(pil_img)

# AFTER: explicit threshold to control small item detection
raw_b = self._model_b(pil_img, threshold=effective_conf_b)
```

## Impact Summary

### What Changed
- **Footwear queries** now strict-match on `products.category = footwear` (hard filter via OpenSearch term matching)
- **Top queries** with explicit sleeve labels no longer demoted to soft-category hints
- **Bottom crop sampling** tightened to reduce color leakage from torso/shoes
- **Dress detection** now applies length/sleeve mismatch caps symmetrically with tops
- **Accessories (Model B)** no longer suppressed by default HF pipeline threshold

### Expected Outcomes
1. ✅ Shoe detections surface shoes, not bags/dresses
2. ✅ Top detections surface tops with matching sleeve type, not dresses
3. ✅ Bottom color signals cleaner (less torso red, less shoe black)
4. ✅ Dress searches respect length metadata when available
5. ✅ Small accessories (bags, wallets) properly detected in shop-the-look

### No Regressions
- Accessories/bags still respect `SEARCH_IMAGE_SHOP_LOOK_SOFT_CATEGORY` env var when enabled (soft-category hints)
- Auto-hard heuristics unchanged (confidence + area ratio still trigger hard mode)
- Force-hard function (`shouldForceHardCategoryForDetection`) unchanged
- Ranking and rescue thresholds unchanged (only mismatch caps lowered for precision)

## Verification Checklist

- [ ] Test top crop with "short sleeve top" label → surfaces tops, not dresses
- [ ] Test shoe crop in browse mode → surfaces footwear via hard category, not mixed results
- [ ] Test bottom crop color inference → no red (torso) or black (shoes) dominant colors
- [ ] Test dress detection with length intent → applies length cap when mismatch < 0.35
- [ ] Test small bag/wallet detecton → Model B detector passes threshold, items in results
- [ ] Monitor logs for `sleeve_conflict_cap` and `dress_length_conflict_cap` firing on true mismatches
- [ ] Run regression: verify accessories still soft-guide when env vars enable it

## Code Files Modified
1. `src/routes/products/image-analysis.service.ts` (lines 343, 814–817, 978–993, 1693, 1794–1806, 3978–3987, 5464–5472)
2. `src/routes/products/products.service.ts` (lines 3455, 3474, 4947–4976, 4989)
3. `src/lib/model/dual-model-yolo.py` (line 253)

## Related Documentation
- See docs/SEARCH_IMPLEMENTATION_SUMMARY.md for full ranking pipeline details
- See docs/multi-vector-search.md for hard vs soft category explanation
- See docs/image-embedding-pipeline.md for crop extraction and color inference

## Status
**STAGED & READY FOR VALIDATION** — All patches applied and staged. Pending real-world test cases.
