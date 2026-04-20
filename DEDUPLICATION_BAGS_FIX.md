# Detection Deduplication and Bag Search Fix

## Summary

This document describes two key improvements made to the image analysis service to address detection handling and bag search issues.

## Issue 1: Multiple Detections with Same Category

### Problem

When an image contains multiple detected items of the same category (e.g., two bags, two shoes), the shop-the-look endpoint was processing both separately, each performing independent similarity searches. This resulted in:

**Example from user data:**

- 2x "bag, wallet" detections with confidence 0.4609 and 0.7833 → Both searched independently
- 2x "shoe" detections with confidence 0.2663 and 0.9293 → Both searched independently

This was inefficient and could return duplicate or lower-quality results from the weaker detection.

### Solution: Category-Based Deduplication

Added a new function `dedupeDetectionsByCategoryHighestConfidence()` that:

1. **Groups detections by their mapped product category** (using `mapDetectionToCategory()`)
2. **Keeps only the detection with the highest confidence per category**
3. **Logs deduplication activity** for debugging

**Code Location:** `image-analysis.service.ts`

```typescript
function dedupeDetectionsByCategoryHighestConfidence(
  detections: Detection[],
): Detection[] {
  // Groups by mapped category (e.g., "bags", "footwear", "tops")
  // For each category, returns only the highest-confidence detection
}
```

### Why This Improves Results

- **Better Quality**: Uses the most reliable detection per category
- **More Efficient**: Reduces redundant similarity searches
- **Clearer Results**: Each category appears once in results with best detection

### Integration

The deduplication is applied after IoU-based deduplication (for same-label duplicates):

```
YOLO Detections → IoU Deduplication → Category Deduplication → Search
```

## Issue 2: Bag Search Returning No Results

### Problem

Even when bags were detected with reasonable confidence (0.46, 0.78), the similarity search returned zero products:

```json
{
  "category": "bags",
  "products": [],
  "count": 0,
  "appliedFilters": {
    "category": [
      "bag",
      "bags",
      "wallet",
      "purse",
      "handbag",
      "tote",
      "backpack",
      "clutch"
    ]
  }
}
```

### Root Causes

1. **Bag embeddings are difficult to match visually** - bag texture/pattern varies widely
2. **Limited bag inventory in catalog** - fewer bags available than clothing
3. **Strict initial similarity threshold** - default CLIP threshold may be too high for bags
4. **Category guards filtering out results** - precision guards may over-filter small boxes

### Solution: Bag Recovery Fallback

Added a specialized recovery mechanism for bags that triggers when initial search returns no results:

**Location:** `image-analysis.service.ts`, in detection processing loop

**Strategy:**

```
Initial Bag Search (empty) →
  Retry #1: Full-image embedding (wider visual range) + 75% of original threshold
  Retry #2: Garment embedding + 75% of original threshold
  Result: Returns best available matches even if similarity is slightly lower
```

**Key Changes:**

1. **Relaxed threshold**: Reduces threshold to 75% of original (e.g., 0.63 → 0.47)
2. **Alternative embeddings**: Tries both full-image and garment embeddings
3. **Lighter filtering**: Skips aggressive category guards during recovery
4. **Fallback minimum**: Returns results if even 1 match is found (vs requiring more for other categories)

### Configuration

The bag recovery is automatically triggered with these conditions:

- `categoryMapping.productCategory === "bags"`
- `similarResult.results.length === 0` (no initial results)

To disable: Set environment variable `SEARCH_IMAGE_SHOP_DISABLE_BAG_RECOVERY=1`

## Code Changes

### File: `src/routes/products/image-analysis.service.ts`

**Added Functions:**

1. `dedupeDetectionsByCategoryHighestConfidence()` - Deduplicate by category keeping highest confidence
2. Bag recovery fallback block in detection processing

**Modified Methods:**

1. `analyzeAndFindSimilar()` - Integrated category deduplication into detection job setup
2. Detection search loop - Added bag recovery fallback

### Line Changes

- **Lines ~1800-1850**: New deduplication function
- **Lines ~3950-3980**: Integration of deduplication into analyzeAndFindSimilar
- **Lines ~5100-5200**: New bag recovery fallback mechanism

## Testing

### Manual Test Case

Using the provided JSON response:

**Before:**

- 2 bag detections searched → 0 + 0 results
- 2 shoe detections searched → 1 + 1 results (duplicate processing)

**After:**

- 1 bag detection (higher confidence 0.783) searched → Bag recovery enabled → 1-3 bag results
- 1 shoe detection (higher confidence 0.929) searched → 1-2 shoe results

### Expected Outcomes

1. **Fewer detection searches** - One per category instead of per detection
2. **Bag results available** - Recovery fallback provides at least some matches
3. **Better overall shop-the-look** - More complete outfit with bags included
4. **Log visibility** - Deduplication and recovery logged for debugging

## Debugging

### Logs to Monitor

```
[dedupe-by-category] category="bags" kept="bag, wallet" (conf=0.783) skipped=1 items (lower confidence)
[recovery-attempt] detection="bag, wallet" type=bag_recovery reason="empty bag search"
[recovery-result] detection="bag, wallet" type=bag_recovery recovered=2 products
```

### Environment Variables

```bash
# Disable category deduplication (keep all detections as-is)
SEARCH_IMAGE_SHOP_GROUP_BY_DETECTION=1

# Disable bag recovery
SEARCH_IMAGE_SHOP_DISABLE_BAG_RECOVERY=1

# Adjust bag recovery similarity threshold
SEARCH_IMAGE_SHOP_BAG_RECOVERY_THRESHOLD=0.45
```

## Performance Impact

**Before:**

- Image with 2 bags + 2 shoes = 4 detection searches
- Detection cost: ~37-56s per search (from timing data)
- Total: ~150-220s for similarity stage

**After:**

- Image with 2 bags + 2 shoes = 2 detection searches
- One bag search includes recovery fallback (minimal extra time)
- Total: ~75-110s for similarity stage (≈50% improvement)

## Future Improvements

1. **Bag-specific embeddings** - Fine-tune CLIP on bag crops
2. **Bag catalog expansion** - Increase bag inventory for better matching
3. **Dynamic thresholding** - Adjust similarity threshold based on detection category
4. **Material-aware matching** - Use texture embeddings for bags specifically
