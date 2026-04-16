# Test Guide: Detection → Search Fix Validation

## Pre-Deployment Testing

### 1. Top Detection Hard Category Test ✓
**Scenario**: User uploads image with "short sleeve top" or "long sleeve top" detected

**Before Fix**:
- Detection marked as "noisy" → soft-category mode
- kNN retrieves from mixed categories (tops, dresses, outerwear)
- Ranking: visual similarity vs taxonomy hints (low weight)
- Result: top crop might rank dresses or outerwear above tops

**After Fix**:
- Detection NOT marked as noisy → hard-category mode
- kNN retrieves ONLY from tops (OpenSearch term filter: `products.category = tops`)
- Ranking: visual similarity vs tight compliance gates
- Result: top crop returns tops with matching sleeve type first

**Test Cases**:
- [ ] Upload image with visible short-sleeve t-shirt → verify results are all t-shirts/short-sleeve tops, not dresses
- [ ] Upload image with visible long-sleeve blouse → verify results are all long-sleeve tops, not sweaters/outerwear
- [ ] Upload BLIP caption: "woman wearing short sleeves blue shirt" → verify sleeve inference works, returns blue short-sleeve tops
- [ ] Monitor log: check `forceHardCategoryFilterUsed = true` for "short sleeve top" / "long sleeve top" detections

---

### 2. Footwear Hard Category Test (Browse Path) ✓
**Scenario**: User browses/closet-similar with shoe detection in second code path

**Before Fix**:
- Second path lacked explicit footwear forcing
- If `SEARCH_IMAGE_SHOP_LOOK_SOFT_CATEGORY=1` and `SEARCH_IMAGE_FASHION_INTENT_SOFT_CATEGORY=1`, footwear would soft-guide
- kNN could retrieve from any category, then rerank by taxonomy hints
- Result: shoe crop might surface bags/belts/fashion items

**After Fix**:
- Footwear explicitly forced to hard-category in line 5465
- kNN retrieves ONLY from footwear (OpenSearch term filter: `products.category = footwear`)
- Ranking: visual similarity vs footwear-specific compliance gates (color strict, type floor)
- Result: shoe crop returns shoes consistently across both code paths

**Test Cases**:
- [ ] Enable soft-category env vars, then upload shoe detection in browse mode → verify hard-category override, returns shoes not bags
- [ ] Test both code paths (multi-detection vs browse) return same category level filtering
- [ ] Monitor log: check `forceHardCategoryFilterUsed = true` for "shoe" / "boot" / "sneaker" detections even when soft env vars are on

---

### 3. Bottom Crop Color Extraction Tightening ✓
**Scenario**: User uploads image with bottoms detection, crop extraction samples colors

**Before Fix**:
- Crop band: left 0.16, width 0.68, top 0.42 (trousers)
- Often includes torso (red/pattern from shirt above)
- Often includes shoes (black/white from feet below)
- Result: inferred color often wrong (red for blue jeans, black for white pants)

**After Fix**:
- Crop band: left 0.2, width 0.6, top 0.5 (trousers)
- Narrows horizontal band (0.68 → 0.6), shifts down to skip torso (0.42 → 0.5)
- Extends lower band (0.86 → 0.94) to capture more fabric before shoe zone
- Result: color cleaner, closer to actual garment

**Test Cases**:
- [ ] Upload image with blue jeans + red shirt above → verify inferred color is blue (not red)
- [ ] Upload image with black pants + white shoes below → verify inferred color is black (not white)
- [ ] Compare dominant color extraction before/after: measure variance in extracted colors
- [ ] Monitor log: check dominant color tokens for bottoms are more consistent with actual fabric

---

### 4. Shirt Recovery from Outwear Mislabel ✓
**Scenario**: YOLO mislabels upper-body top as "outwear" or "jacket" in layered collage

**Before Fix**:
- Mislabeled "outwear" would force hard-category to outerwear
- Search would retrieve outerwear (coats, jackets) instead of blouses/shirts
- Result: wrong category, wrong products

**After Fix**:
- Geometric heuristic: if box is in upper-body zone (centerY 0.2–0.58) and reasonable height (0.16–0.7), recover to "short sleeve top" or "long sleeve top"
- Corrected label then follows normal top hard-category path
- Result: mislabeled tops still surface tops

**Test Cases**:
- [ ] Upload layered collage image with blouse labeled as "jacket" by model → verify `raw_label` shows correction, category recovered to tops
- [ ] Verify detection box area ratio and position check correctly identify upper-body vs full-length coat
- [ ] Monitor log: watch for `[corrected:shirt-recovery]` in `raw_label` field

---

### 5. Sleeve Inference Plural Matching ✓
**Scenario**: Product text uses plural form "sleeves" instead of singular "sleeve"

**Before Fix**:
- Regex: `/\bshort sleeve\b/` (no plural support)
- Missed product text like "short sleeves" or "with sleeves"
- Result: sleeve intent not inferred from catalog, no matching during ranking

**After Fix**:
- Regex: `/\bshort sleeves?\b/` (plural optional)
- Matches both "short sleeve" and "short sleeves"
- Result: sleeve metadata detected even when product text uses plural

**Test Cases**:
- [ ] Search with product text "blue top with long sleeves" → verify sleeve intent inferred as "long"
- [ ] Verify regex handles: "short sleeve", "short sleeves", "short sleeved", "half sleeves", "3/4 sleeves"
- [ ] Monitor log: check `inferredSleeve` field for products with "sleeves" (plural)

---

### 6. Dress Length Compliance Cap ✓
**Scenario**: User uploads dress detection with explicit length intent (midi/maxi/mini)

**Before Fix**:
- Dress detection had NO length-based cap
- Ranking penalized via weight, but no hard floor
- Result: short-sleeve midi dress could rank alongside sleeveless minis

**After Fix**:
- If dress is detected AND has length intent AND length compliance < 0.35, cap finalRelevance01 to 0.32 (or 0.26 for low visual)
- Prevents length-mismatched catalogs from ranking highly
- Result: midi-detected dress search returns midis first, not minis/maxis

**Test Cases**:
- [ ] Upload midi-length dress detection → verify length intent inferred, results prioritize midi-length dresses
- [ ] Upload mini dress detection → verify mini dresses rank higher than midi/maxi options
- [ ] Monitor log: watch `dress_length_conflict_cap` firing when length compliance < 0.35
- [ ] Verify existing dress silhouette cap (one-piece check) still applies independently

---

### 7. Sleeve Threshold Tightening (0.35 → 0.12) ✓
**Scenario**: Top detection with sleeve intent ranking against catalog products

**Before Fix**:
- Cap fired when sleeveCompliance < 0.35 (too broad)
- Often caught uncertain/missing sleeve metadata, not true contradictions
- Result: false positives, good products incorrectly penalized

**After Fix**:
- Cap fires when sleeveCompliance < 0.12 (tight threshold)
- Only catches strong contradictions (e.g., sleeveless detected, but catalog says "long sleeve")
- Result: less false-positive capping, better ranking precision

**Test Cases**:
- [ ] Upload short-sleeve top detection → verify blue short-sleeve shirts rank above short-sleeve dresses (not equally)
- [ ] Upload long-sleeve top → verify long-sleeve blouses rank highest even if metadata sparse
- [ ] Monitor log: `sleeve_conflict_cap` should only fire on extreme mismatches (e.g., sleeveless vs long)
- [ ] Verify threshold doesn't suppress valid results when sleeve metadata is partial

---

### 8. Model B Accessory Detection Threshold ✓
**Scenario**: Dual-model YOLO runs on shop-the-look image with bags/wallets

**Before Fix**:
- Model B used HF default threshold (~0.5, high)
- Small accessories (bags, wallets) filtered out before post-processing
- Result: shop-the-look missed bags/wallets, returned only apparel

**After Fix**:
- Model B passed explicit `threshold=effective_conf_b` to HF pipeline
- Small accessories now pass threshold, are included in post-processing
- Result: shop-the-look surfaces matching bags, belts, hats

**Test Cases**:
- [ ] Upload outfit with small bag in corner → verify bag detected and returned in shop-the-look results
- [ ] Upload outfit with wallet on table → verify wallet detected and ranked
- [ ] Monitor log: check accessories count in detections per image, should increase
- [ ] Verify apparel detection unchanged (apparel threshold not affected)

---

### 9. Consistency Check: Both Code Paths ✓
**Scenario**: Same detection processed through multi-detection path vs browse/closet path

**Before Fix**:
- Path 1 (multi-detection): footnote forcing implicit in OR chain
- Path 2 (browse/closet): no explicit footwear forcing
- Result: footwear might hard-force in path 1 but soft-guide in path 2 depending on env vars

**After Fix**:
- Both paths explicitly check `footwearLikeCategory = categoryMapping.productCategory === "footwear"`
- Both include in OR: `shouldHardCategory = acc || footwear || !(soft env vars)`
- Result: identical behavior across both paths

**Test Cases**:
- [ ] Run same shoe detection through both paths (direct image search vs closet-similar)
- [ ] Verify both return shoes (hard-category), not mixed results
- [ ] Monitor log: both paths should show `forceHardCategoryFilterUsed = true` for footwear
- [ ] Test switching between paths doesn't change footwear filtering behavior

---

### 10. Regression: Soft-Category Still Works for Accessories ✓
**Scenario**: Soft-category env vars enabled; accessories should still respect soft mode

**Test Cases**:
- [ ] Enable `SEARCH_IMAGE_SHOP_LOOK_SOFT_CATEGORY=1`
- [ ] Upload bag/hat detection → verify `shouldHardCategory = false`, uses soft-guide hints
- [ ] Verify `accessoryLikeCategory || footwear` in shouldHardCategory OR chain only forces hard for accessories and footwear when env is off
- [ ] Run accessories through soft-category path and confirm they use taxonomy hints, not hard term filtering

---

### 11. Regression: Non-Forced Categories Still Auto-Hard ✓
**Scenario**: Non-accessories, non-footwear categories (tops, dresses, bottoms, outerwear) should still use auto-hard heuristics

**Test Cases**:
- [ ] Top with high confidence + large area → includes auto-hard heuristics (baseHardAuto OR relaxedGarmentHardAuto)
- [ ] Dress with medium confidence + medium area → may depend on relaxedGarmentHardAuto
- [ ] Monitor log: `detectionMeetsAutoHardHeuristics = true` should still fire for garments even without explicit forcing

---

## Post-Deployment Monitoring

### Logs to Watch
- `forceHardCategoryFilterUsed`: Should be true for shoes, footwear; may be true for accessories
- `sleeve_conflict_cap`: Should fire only on strong mismatches (< 0.12)
- `dress_length_conflict_cap`: Should fire when dress length compliance < 0.35
- `dress_sleeve_conflict_cap`: Should fire when dress sleeve compliance < 0.12
- Dominant color tokens for bottoms: Should be garment color, not shirt/shoe bleed
- Accessory detection count: Should increase with Model B threshold fix

### Metrics to Track
- **Top search**: Average rank position of matching-sleeve-type tops (should improve with hard-category fixing)
- **Footwear search**: Average rank position of matching-footwear category items (should improve with hard-forcing)
- **Bottom color accuracy**: % of searches where inferred color matches actual garment (should improve with crop tightening)
- **Dress search**: Average rank position of matching-length dresses (should improve with length cap)
- **Shop-the-look**: Detection count for accessories, especially small items (should increase with Model B threshold)
- **False-cap rate**: % of results penalized by sleeve/length caps; should be low (< 2% for true mismatches)

### Alert Thresholds
- If top search ranking degrades (avg rank > 3): Check if hard-category forcing regressed
- If footwear results include bags (> 5% false positives): Check if footwear hard-category is applied
- If bottom color inference fails (accuracy < 80%): Check if crop band calculations are off
- If sleeve caps fire excessively (> 10% of results): Check if threshold (0.12) is too high
- If accessory detection drops below pre-fix baseline: Check Model B threshold passthrough

## Rollback Plan
If regression detected:
1. Revert changes in image-analysis.service.ts (footwear forcing, sleeve noise filter, crop adjustments, shirt recovery, dress length enable)
2. Revert changes in products.service.ts (sleeve/length caps, prefer inferred color logic)
3. Revert changes in dual-model-yolo.py (Model B threshold)
4. Run tests to confirm baseline restored

## Sign-Off Criteria
- [ ] All 11 test scenarios pass
- [ ] No regression in other categories (accessories, bags, bottoms, dresses still ranking correctly)
- [ ] Logs show expected caps firing only on true mismatches
- [ ] Metrics show improvement in affected areas (top rank, footwear rank, bottom color, dress length)
- [ ] Accessibility of soft-category env vars preserved for accessories when needed
