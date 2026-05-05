# IMAGE PROCESSING BUG: Crop Color Extraction for Tops

## Problem Statement

When an image is a **white shirt on top of navy/black pants** (worn outfit), the system extracts **navy/black** as the dominant crop color instead of white.

This causes:
- `cropDominantTokens: ["navy", "black"]` ← WRONG
- `inferredTokens: ["white"]` ← CORRECT  
- White-matching products ranked **LOWER** than brown/non-white products

---

## Root Cause: Top Crop Extends Too Far Down

**File:** [src/routes/products/image-analysis.service.ts](src/routes/products/image-analysis.service.ts#L1027)

**Function:** `extractDetectionCropColorsForRanking()`

### The Bug (Lines 1050-1058):

```typescript
} else if (topLike) {
  // Top/outerwear boxes can include pants near the lower edge.
  // Sample upper-mid torso and trim side edges to avoid background/pants bleed.
  left = Math.floor(w * (longSleeveTopLike ? 0.14 : 0.12));
  width = Math.max(16, Math.floor(w * (longSleeveTopLike ? 0.72 : 0.76)));
  top = Math.floor(h * (longSleeveTopLike ? 0.06 : 0.08));
  const bottom = Math.floor(h * (longSleeveTopLike ? 0.58 : 0.62));  ← PROBLEM!
  height = Math.max(24, bottom - top);
}
```

### What's Happening:

For a **short-sleeve top** (not `longSleeveTopLike`):
- `top = 0.08 * image_height` (8% from top) ✓ Good
- `bottom = 0.62 * image_height` (62% from top) ✗ **TOO FAR DOWN**

If the detection box includes both the white shirt AND the navy/black pants below:
- 62% of the bounding box height captures into the pants region
- The crop ends up with: `dark navy pixels + white pixels`
- K-means dominates on the dark colors → navy/black wins
- White is treated as background/less prominent

### Visual Example:

```
Detection Box (top to bottom):
├─ 0%   ┌─────────────────┐
├─ 8%   │ Upper white     │ ← crop starts here
├─ 30%  │ Middle white    │ ← this should be end
├─ 50%  │ Lower white     │
├─ 62%  │ NAVY PANTS ◄────┼─ crop ENDS here ← BUG!
├─ 80%  │ More navy       │
├─100%  └─────────────────┘
```

---

## Solution: Reduce Bottom Crop Percentage

The bottom crop for tops should be tightened to avoid pants spillover.

### Recommended Fix:

Change the bottom percentages for short-sleeve tops from **0.62** to **0.50** (or even 0.48):

```typescript
} else if (topLike) {
  left = Math.floor(w * (longSleeveTopLike ? 0.14 : 0.12));
  width = Math.max(16, Math.floor(w * (longSleeveTopLike ? 0.72 : 0.76)));
  top = Math.floor(h * (longSleeveTopLike ? 0.06 : 0.08));
  // FIXED: Reduce from 0.62 to 0.50 for short sleeves
  const bottom = Math.floor(h * (longSleeveTopLike ? 0.58 : 0.50));  ← FIX
  height = Math.max(24, bottom - top);
}
```

**Impact:**
- Short-sleeve tops: crop from 8% → 50% (42% height) instead of 8% → 62% (54% height)
- Eliminates bottom pants spillover
- White shirt color should now dominate

---

## Test Case

### Before Fix:
```json
{
  "cropDominantTokens": ["navy", "black"],        ← WRONG
  "inferredTokens": ["white"],                     ← CORRECT
  "finalRelevance01": 0.8334,                      ← LOWER
  "tierReason": "family match but wrong color"
}
```

### Expected After Fix:
```json
{
  "cropDominantTokens": ["white"],                 ← CORRECT
  "inferredTokens": ["white"],                     ← CORRECT
  "finalRelevance01": 0.88+,                       ← HIGHER
  "tierReason": "family match with correct color"
}
```

---

## Why This Matters

- **Crop color extraction** is used to detect what was actually worn
- **Detection box often includes multiple garments** (tops extend down to where pants start)
- **62% is too aggressive** for detecting just the top portion
- **Current behavior:** Navy pants dominate → wrong color intent → lower rankings

---

## Related Code

### Bottom Crop Percentages Across Categories:

| Category | Current % | Issue | Recommendation |
|----------|-----------|-------|-----------------|
| **Tops (short-sleeve)** | **0.62** | **TOO FAR** | **0.50** |
| **Tops (long-sleeve)** | **0.58** | OK (fabric bulk) | Keep 0.58 |
| **Bottoms (trousers)** | 0.94 | OK (full leg) | Keep 0.94 |
| **Bottoms (other)** | 0.78 | OK (includes shoes) | Keep 0.78 |
| **Dresses** | 0.72 | OK (hem buffer) | Keep 0.72 |

---

## Files to Update

1. **[src/routes/products/image-analysis.service.ts](src/routes/products/image-analysis.service.ts#L1058)** - Line 1058
   - Change: `const bottom = Math.floor(h * (longSleeveTopLike ? 0.58 : 0.62));`
   - To: `const bottom = Math.floor(h * (longSleeveTopLike ? 0.58 : 0.50));`

---

## Testing Steps

1. Upload an image of a white shirt with navy/black pants
2. Check `cropDominantTokens` in response
3. Verify it returns `["white"]` not `["navy", "black"]`
4. Verify white-matching products rank higher than brown products

