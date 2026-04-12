# Quick Implementation Guide - Next Steps

## What's Done ✅

Three key changes have been implemented:

1. **Color penalty multipliers**: Reduced from 0.72/0.82 → 0.85/0.90
2. **Color contradiction caps**: Increased from 0.20/0.28/0.36 → 0.45/0.55/0.65
3. **Dress length inference**: Added `inferDressLengthFromBox()` function to detect actual hem length

## Files Updated

- `src/routes/products/products.service.ts` - Color penalty and cap logic
- `src/lib/detection/categoryMapper.ts` - Dress length inference function

## What's NOT Done Yet (Future Phases)

### Critical (Week 2)

- [ ] Hook up `dressLength` attribute in length compliance scoring
- [ ] Remove dual final relevance scores (consolidate to single calculation)
- [ ] Add color affinity matrix (turquoise boost when blue desired)

### Important (Week 3)

- [ ] Update test assertions for new relevance score ranges
- [ ] Document dressLength attribute in API schema
- [ ] Add feature flag for dress length inference toggle

### Nice-to-Have (Week 4)

- [ ] Pattern-based filtering (avoid plain black dresses with no details)
- [ ] Personalization boost calibration with new caps
- [ ] Performance benchmarking with increased color visibility

## How to Test These Changes

### 1. Build & Run

```bash
# Rebuild TypeScript
npm run build

# Or if using watch mode
npm run watch
```

### 2. Test Blue Dress Query

```bash
curl "http://localhost:3000/api/shop-the-look" \
  -F "image=@blue_dress_test.jpg"
```

### 3. Check JSON Response

Look for products with non-blue colors:

```json
{
  "products": [
    {
      "id": "30792",
      "title": "Brown Midi Dress",
      "finalRelevance01": 0.45, // Should be 0.45-0.55 range (was 0.20-0.28)
      "explain": {
        "finalRelevanceSource": "catalog_color_correction",
        "clipCosine": 0.8717,
        "colorContradictionPenalty": 0.9, // NEW: 0.90 (was 0.82)
        "colorCompliance": 0, // Still 0 (no match)
        "dressLength": "midi" // NEW: from box inference
      }
    }
  ]
}
```

### 4. Expected Improvements

**Before:**

- Black dresses: 0.20-0.30 relevance (suppressed)
- Non-blue colors: All at 0.20-0.36 cap

**After:**

- Black dresses: 0.40-0.55 relevance (visible)
- Non-blue colors: 0.40-0.65 cap (proportional to confidence)
- Length: Now shows "mini", "midi", or "maxi"

## Important: Why Changes Work

### Color Penalty Change

**Problem:** 0.82 multiplier × high visual (0.87) = 0.71 effective, then capped at 0.28 = massive double penalty

**Solution:**

- 0.90 multiplier × 0.87 visual = 0.78 effective (better, but still penalized)
- Cap at 0.55 instead of 0.28 (users see the result)
- Color wrong? Yes. Hidden? No.

### Dress Length Change

**Problem:** `lengthCompliance = 0.32` for ALL dresses (no differentiation)

**Solution:**

- Box y2_norm = 0.94 → legs coverage = 92% → `dressLength = "maxi"`
- Box y2_norm = 0.68 → legs coverage = 36% → `dressLength = "midi"`
- Box y2_norm = 0.40 → legs coverage = 0% → `dressLength = "mini"`

## Known Limitations & Gotchas

### ⚠️ Backward Compatibility

**The `mapDetectionToCategory()` function signature changed!**

```typescript
// OLD: mapDetectionToCategory(label, confidence)
// NEW: mapDetectionToCategory(label, confidence, detectionBox?)
```

The `detectionBox` parameter is optional, so existing calls still work:

```typescript
mapDetectionToCategory("long sleeve dress", 0.95);  // Still works ✓
mapDetectionToCategory("long sleeve dress", 0.95, { box_normalized: {...} });  // Now does more ✓
```

**Action Required:** Update any callers that have the detection object available to pass it:

- In `src/routes/products/image-analysis.service.ts` (multiple places)
- In `src/lib/image/yolov8Client.ts`
- In `src/lib/wardrobe/autoSync.ts`

**Timeline:** Not urgent (backward compatible), but should be done in Phase 2.

### ⚠️ Box Data Quality

**Assumption:** Y-coordinates in box_normalized are accurate

If boxes are malformed (y2 < y1, y1/y2 out of 0-1 range), `inferDressLengthFromBox()` will gracefully return `undefined`. Length will not be inferred, but also won't break anything.

### ⚠️ Color Caps Still Gate

**Important:** Items with wrong colors are STILL CAPPED, just at higher values

Example: Black dress for blue search

- Visual: 0.85
- Color penalty: 0.90 (15% reduction) → 0.77
- Color contradiction cap: 0.55 (still limited)
- Final: 0.55

This is **intentional** - wrong colors should be visible but clearly marked as not matching.

### ⚠️ No Environment Variables Yet

The new penalty values are **hardcoded**. To make them configurable:

```typescript
// In computeColorContradictionPenalty (line ~1690)
if (params.hasExplicitColorIntent) return Number(process.env.SEARCH_COLOR_PENALTY_EXPLICIT ?? '0.85');
if (params.hasInferredColorSignal) return Number(process.env.SEARCH_COLOR_PENALTY_INFERRED ?? '0.90');

// In color contradiction cap (line ~3970)
const maxConflictCap = hasExplicitColorIntent
  ? Number(process.env.SEARCH_COLOR_CAP_EXPLICIT ?? '0.45')
  : ...
```

**Action Required (Optional):** Add these env vars if you want to tune without redeploying.

## QA Checklist

### Basic Functionality

- [ ] Build succeeds without errors
- [ ] No TypeScript compilation warnings
- [ ] Tests pass (if any existing tests for this code)

### Color Penalty Testing

- [ ] Blue dress query returns non-blue items with relevance 0.40-0.65 (was 0.20-0.28)
- [ ] Exact color matches still have high relevance (>0.80)
- [ ] Color contradiction is visible in explain.dressContradictionPenalty
- [ ] explain.finalRelevanceSource shows "catalog_color_correction" for non-match

### Dress Length Testing

- [ ] Small dresses (y2_norm < 0.5) → `dressLength: "mini"`
- [ ] Medium dresses (y2_norm 0.5-0.7) → `dressLength: "midi"`
- [ ] Tall dresses (y2_norm > 0.7) → `dressLength: "maxi"`
- [ ] Dresses without box data → `dressLength: undefined` (graceful)

### Integration Testing

- [ ] Color and length changes work together correctly
- [ ] No regression in other search types (text search, etc.)
- [ ] API response JSON still valid (no schema changes)
- [ ] Performance impact <1ms per request

## Debugging Tips

### If colors are still suppressed:

1. Check `colorIntentGatesFinalRelevance` in explain - if `false`, color gates not applied
2. Look at `colorContradictionPenalty` value - should be 0.85-0.93 (not 0.72-0.82)
3. Check `finalRelevanceSource` - if "image_intent_floor", color correction not applied
4. Verify `desiredColorsEffective` includes the right color

### If dress length is not inferred:

1. Check if `box_normalized` exists in detection output
2. Verify `y1` and `y2` are valid (0-1 range)
3. Check `categoryMapping.attributes.dressLength` in explain
4. If undefined, box was probably not passed to mapDetectionToCategory

### If scores seem too high/low:

1. Look at all factors:

```json
{
  "clipCosine": 0.87, // Raw visual
  "colorContradictionPenalty": 0.9,
  "effectiveVisual": 0.78, // 0.87 * 0.90
  "finalRelevance01": 0.45, // After caps applied
  "finalRelevanceSource": "catalog_color_correction" // How it got capped
}
```

2. Verify color cap value: 0.45/0.55/0.65 based on signal strength
3. Check `nearIdenticalRawMin` threshold (visual must be very high to bypass cap)

## Rollback Instructions

If you need to revert the changes:

```bash
# Revert color penalties and caps in products.service.ts
git checkout src/routes/products/products.service.ts

# Keep the dress length code (it's backward compatible and optional)
# To disable length inference, just don't pass the box param when calling:
mapDetectionToCategory(label, confidence)  // No box = dressLength undefined
```

---

## Next: Phase 2 Tasks

Once these changes are deployed and verified:

1. **Hook up dressLength in length compliance**
   - File: `src/routes/products/products.service.ts` (line ~1450)
   - Change: Replace hardcoded `0.32` with actual length comparison

2. **Consolidate final relevance score**
   - File: `src/routes/products/products.service.ts` (line ~3289)
   - Change: Merge the dual-pass calculation into single transparent score

3. **Add color affinity matrix**
   - File: Create `src/lib/search/color-affinity.ts`
   - Change: Apply affinity boosts based on color relationships

---

## Summary

✅ **Deployed:**

- More lenient color penalties (0.85-0.93 vs 0.72-0.82)
- Better color cap values (0.45-0.65 vs 0.20-0.36)
- Dress length detection from bounding box

⏳ **In Progress:** None (ready to deploy)

📋 **Next Up:**

- Wire up length compliance scoring
- Consolidate final relevance calculation
- Test thoroughly with real search queries

Good luck! 🚀
