# Suit Intent Detection Fix - Summary

## Problem
The image caption correctly identified "suit and tie" but the system was classifying it as:
- **Detected**: `long sleeve outwear, intentType: shirt, intentSubtype: button_up_shirt`
- **Should be**: `intentFamily: suits, intentType: suit, occasion: formal`

Result: Search returned jackets and shirts instead of actual suits.

## Root Cause
The caption signal for "suit" was being ignored by the intent builder. Even though BLIP correctly generated the caption "a man in a suit and tie", the downstream processing:
1. Extracted product types from the caption
2. Didn't prioritize "suit" when found
3. Ranked generic "shirt" type higher
4. Didn't remove conflicting shirt/casual types when suit was detected

## Solution: Three-Part Fix

### 1. **Caption Override Logic** (`blipStructured.ts`)
Added `applyCaptionOverridesToTypeHints()` function that:
- Detects when caption explicitly mentions "suit", "tie", or "tuxedo"
- **Removes** conflicting generic types (shirt, button-up, casual shirt, polo, tee, etc.)
- **Injects** suit-specific variants at priority 1: ["suit", "suit jacket", "blazer", "dress jacket", "formal jacket"]
- Filters output to exact 12 hints, ensuring suit variants rank at the top

**Code change**: Applied caption overrides **before** filtering and ranking to catch suit signals early.

### 2. **Suit Type Prioritization** (`blipStructured.ts`)
Updated `rankProductTypeHint()` to give suits priority `1.5` (highest among outerwear):
- Suits: `1.5` (highest formal)
- Blazers/formal jackets: `2.0` (still high but below suits)
- Generic jackets/coats: `2.0` (same as blazers, but suits preferred first)

This ensures when both "suit" and "jacket" are extracted, "suit" ranks first.

### 3. **Semantic Contract for Suits** (`semanticProductContract.ts`)
Created dedicated `buildSuitContract()` function that:
- **exactTypes**: Suit and suit variants
- **strongTypes**: Suit jacket, blazer, dress jacket, formal variants (high confidence matches)
- **relatedTypes**: Formal coats, structured jackets (medium confidence)
- **weakTypes**: Casual jackets, parkas, windbreakers (low confidence - should avoid)
- **badTypes**: Shirts, pants, casual wear (must not return - explicitly blocked)
- **blockedFamilies**: tops, bottoms, dresses (hard family filters)

This replaces the generic `buildOuterwearContract()` when suit type is detected.

### 4. **Type Equivalence for Suits** (`matchTierAssignment.ts`)
Added `suitTypeEquivalence()` function that:
- Recognizes "suit jacket" and "blazer" as equivalents to "suit" intent (score: 0.98-1.0)
- Used during match strength computation for proper tier assignment
- Ensures formal wear variants get scored as exact/strong matches

## Expected Behavior After Fix

**Input**: Image caption: "a man in a suit and tie"

**Intent Builder Output**:
```ts
// BEFORE:
productTypeHints: ["shirt", "blouse", "jacket", ...]
// After caption extraction only

// AFTER:
productTypeHints: ["suit", "suit jacket", "blazer", "dress jacket", "formal jacket"]
// Captured by caption override, shifted to front, conflicting types removed
```

**Search Contract Applied**: 
- exactTypes: ["suit"]
- strongTypes: ["suit jacket", "blazer", "dress jacket", "formal jacket", ...]
- badTypes: ["shirt", "button up", "casual shirt", ...] ← explicitly blocked
- blockedFamilies: ["tops", "bottoms", "dresses"]

**Result**: Search will return:
1. Actual suits (exact tier: 0.86-0.94)
2. Suit jackets/blazers (strong tier: 0.76-0.86)
3. Formal coats (related tier: 0.62-0.76)
4. NOT: casual shirts, outerwear, generic jackets

## Files Modified

1. **`src/lib/image/blipStructured.ts`**
   - Added `applyCaptionOverridesToTypeHints()` 
   - Updated `buildStructuredBlipOutput()` to apply overrides before ranking
   - Updated `rankProductTypeHint()` to prioritize suits (1.5 vs 2.0)
   - Updated `inferStyleFromCaption()` to include "suit" and "tie" as formal cues

2. **`src/lib/search/semanticProductContract.ts`**
   - Updated `buildSemanticContract()` to route suit intents to new contract
   - Added `buildSuitContract()` with suit-specific type mappings

3. **`src/lib/search/matchTierAssignment.ts`**
   - Added `suitTypeEquivalence()` function
   - Updated `computeMatchStrength()` to use suit equivalence when matching

## Testing Recommendations

1. **Unit Test: Caption Override**
   - Input: "man in a suit and tie" 
   - Expected: productTypeHints starts with "suit", no shirt/button-up
   
2. **Integration Test: Suit Search**
   - Upload image of formal suit
   - Verify results are actual suits (not casual jackets or shirts)
   - Check tier distribution: mostly exact/strong, not weak

3. **Negative Test: Casual Jacket**
   - Upload casual bomber/denim jacket
   - Should NOT trigger suit contract (no "suit"/"tie" in caption)
   - Should return casual jackets, not formal wear

4. **Edge Case: Formal Blazer**
   - Upload blazer with tie
   - Caption override catches "tie" signal
   - Should return formal suits + blazers in top results

## Impact

- **Color Priority**: Not affected (separate ranking layer)
- **Other Garment Types**: Not affected (switch statement ensures other families unmodified)
- **Performance**: Minimal (caption override only runs when caption contains "suit"/"tie")
- **Backwards Compatibility**: Existing suit handling in other files remains intact
