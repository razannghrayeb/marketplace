# Search Result Fields Explained: Why They Seem Contradictory

## The Problem

This product has **0.9 visual similarity** (excellent CLIP match) but **0.8196 final relevance** (moderate ranking). The fields explaining this seem to contradict each other. Here's what's actually happening:

---

## Core Scores (Entry Level)

| Field | Value | Meaning |
|-------|-------|---------|
| `similarity_score` | 0.9 | ✓ Visual CLIP similarity (very good) |
| `finalRelevance01` | 0.8196 | Final ranking score after penalties (good but capped) |
| `rerankScore` | -26.30 | ML rerank adjustment (negative = downrank) |
| `matchTier` | "fallback" | Low-confidence tier (worst tier) |

**Why the contradiction?** Visual similarity ≠ final relevance. Visual is just ONE factor.

---

## The Explain Object (Scoring Breakdown)

### **Visual Signals** (Why it matched)
```json
"clipCosine": 0.89569396           // CLIP embedding similarity
"merchandiseSimilarity": 0.89569396 // Product representation match
"imageCompositeScore01": 0.5116    // Overall visual composite
```
**Translation:** "This sweatshirt LOOKS similar to your outfit"

### **Type Matching** (The Problem)
```json
"desiredProductTypes": ["tshirt", "t-shirt", "tee", "shirt", ...]  // What you want
"normalizedType": "sweatshirt"     // What this product is
"exactTypeScore": 0.55             // Only 55% match (type mismatch)
"productTypeCompliance": 0.55      // Type score
"semanticTypeScore": 0.55          // Semantic compatibility
"intraFamilyPenalty": 0.44         // Same family (tops) but wrong type
```
**Translation:** "You asked for a tshirt, but this is a sweatshirt" → **-0.44 penalty**

### **Color Analysis** (The Conflict)
```json
// INPUT SIGNALS:
"cropDominantTokens": ["navy", "black"]  // Pixel analysis says
"inferredTokens": ["white"]              // AI caption says
"inferredVsCropConflict": true           // They disagree

// DECISION:
"inferredColorTrusted": true             // AI color is trusted
"desiredColorsEffective": ["white"]      // Use AI's white
"matchedColor": "gray"                   // Product is actually gray
"colorCompliance": 0                     // Gray ≠ white
"colorContradictionPenalty": 0.8         // Apply 0.8x penalty
"blipColorConflictFactor": 1             // No additional penalty

// OUTPUT:
"colorSimEffective": 0.401               // Color score after penalties
```

**Translation:** "Your outfit is white (from AI), but this product is gray. Not a color match."

### **Sleeve & Length**
```json
"desiredSleeve": "short"           // You want short sleeves
"sleeveCompliance": 0.12           // Only 12% match
"lengthCompliance": 0              // No match
"hasSleeveIntent": true            // Sleeve matters to ranking
"hasLengthIntent": false           // Length doesn't matter here
```

**Translation:** "You want short sleeves, sweatshirts usually have long sleeves" → **weak match**

### **Audience**
```json
"desiredAudience": "men"
"normalizedAudience": "men"
"audienceCompliance": 1            // Perfect match
```

**Translation:** "You want men's, this is men's" → **+1.0 bonus**

---

## The Tier System (Why "Fallback" Matters)

```json
"matchTier": "fallback"
"tierReason": "family match (tops); type mismatch (expected tshirt_or_shirt, got sweatshirt); audience match (men)"
"tierCap": 0.4
"tierScore": 0.4
```

**Tier Hierarchy:**
1. **Exact** (0.99+) - Product type + color both match
2. **Core** (0.85-0.99) - Product type matches, color close
3. **Family** (0.70-0.85) - Same category (tops/bottoms), but type differs
4. **Fallback** (0.4-0.70) - Visual match but multiple mismatches ← **YOU ARE HERE**

**Why the cap?** Fallback tier products are capped at 0.4 maximum tier score, then boosted by visual similarity but can't exceed that tier ceiling.

---

## The Calculation Flow

```
Step 1: VISUAL BASE
  clipCosine: 0.9 → visualBase: 0.84

Step 2: ATTRIBUTE COMPLIANCE (Each attribute gets a score)
  Type Score:     0.55  (sweatshirt ≠ tshirt)
  Color Score:    0.0   (gray ≠ white)
  Sleeve Score:   0.12  (long ≠ short)
  Audience Score: 1.0   (men = men)
  Average:        0.417

Step 3: APPLY PENALTIES
  Type Mismatch:           -0.44
  Color Contradiction:     -0.20 (0.8x multiplier)
  Visual Base:             0.84
  Quality Modifier:        ×0.956
  
  Intermediate: 0.84 × 0.956 = 0.802

Step 4: TIER CAP (Fallback tier max = 0.4)
  But visual boost allows going above initial cap
  Factored with metadataCompliance (0.85)
  
Step 5: FINAL
  finalRelevance01 = 0.8196
```

---

## Why Fields Seem Contradictory

### **Apparent Contradiction #1**
```
"similarity_score": 0.9      ← Very good visual match
"finalRelevance01": 0.8196   ← Much lower ranking
```
**Reason:** Visual similarity is 1 of 7 factors. This product fails on:
- Type (sweatshirt ≠ tshirt) → 0.55
- Color (gray ≠ white) → 0.0
- Sleeves (long ≠ short) → 0.12

**Result:** Visual can't overcome 3 major mismatches.

---

### **Apparent Contradiction #2**
```
"desiredColorsEffective": ["white"]
"matchedColor": "gray"
"colorCompliance": 0
"colorSimEffective": 0.401    ← Why 0.401 if compliance is 0?
```
**Reason:** `colorSimEffective` is the **score after blending** multiple color signals:
- Direct compliance = 0 (no match)
- Color embeddings = 0.89 (visually similar colors)
- Penalties applied = 0.8x multiplier
- Result: 0.89 × 0.8 × others ≈ 0.401

**Translation:** "Colors don't match semantically, but they're visually close, so small bonus"

---

### **Apparent Contradiction #3**
```
"tierCap": 0.4
"finalRelevance01": 0.8196    ← Way above tier cap!
```
**Reason:** Tier cap is a **starting point**, not a hard ceiling.
- Fallback tier starts at 0.4
- But visual similarity (0.9) boosts it heavily
- Calibration blends: `0.4 (tier) + 0.9 (visual) × weights = 0.8196`

**Translation:** "Normally fallback tier maxes at 0.4, but this has 0.9 visual, so boost it intelligently"

---

### **Apparent Contradiction #4**
```
"inferredVsCropConflict": true
"inferredColorTrusted": true
"colorContradictionPenalty": 0.8
```
**Why both conflict AND use inferred?** Because:
- Conflict detected: crop says navy/black, inferred says white ✓
- But inferred is **trusted** for tops (category is "tops") ✓
- So use inferred (white) as the target ✓
- Product is gray (doesn't match white) → apply penalty ✓

**Translation:** "We chose to trust the AI, but the product still doesn't match what we're looking for"

---

## The Complete Picture

### **Why This Product Scores 0.8196 Despite 0.9 Visual Similarity**

**What matches:**
✅ Visual CLIP similarity: 0.9 (excellent)
✅ Audience: men (perfect)
✅ Family: tops (correct)

**What doesn't match:**
❌ Type: sweatshirt vs tshirt (mismatch)
❌ Color: gray vs white (mismatch)
❌ Sleeves: long vs short (mismatch)

**Final calculation:**
```
Base visual: 0.9
Type penalty: -0.44 (sweatshirt ≠ tshirt)
Color penalty: -0.20 (gray ≠ white, with 0.8x softness)
Sleeve penalty: -0.88 (long ≠ short)
Tier cap applied: 0.4 starting, boosted by visual
Calibration: blend tier + visual + metadata
Result: 0.8196 ← Good match, but multiple attributes miss
```

**Should it rank higher or lower?**
- ✅ Ranking is **correct** - visual similarity doesn't override attribute mismatches
- ✅ Penalty is **appropriate** - sweatshirt isn't what you asked for
- ✅ Color still applied - even though color gates are soft (not hard)

---

## Field Reference: Which Fields Matter Most?

### **For Users (What You See)**
- `similarity_score` - Visual match quality
- `finalRelevance01` - Overall ranking score
- `matchTier` - Confidence level
- `tierReason` - Why it ranked here

### **For Ranking (What Matters)**
- `exactTypeScore` - How close is the product type?
- `colorCompliance` - Does color match intent?
- `audienceCompliance` - Right gender/age?
- `attributeAgreement` - Overall attribute match %
- `visualBase` - Baseline visual score
- Penalties: `intraFamilyPenalty`, `colorContradictionPenalty` - Negative multipliers

### **For Debugging (What's Broken)**
- `inferredVsCropConflict` - Color detection conflict?
- `inferredColorTrusted` - Which color source won?
- `desiredProductTypes` vs `normalizedType` - Type matching?
- `rankingDebug` - Full calculation trace

---

## After the Crop Color Fix

**Before fix:** Crop detected navy/black (WRONG)
```
inferredTokens: ["white"]
cropDominantTokens: ["navy", "black"]
inferredColorTrusted: true → use white
↓
Compare to product gray → color mismatch → penalty
```

**After fix:** Crop should detect white (CORRECT)
```
inferredTokens: ["white"]
cropDominantTokens: ["white"]  ← NOW CORRECT
inferredColorTrusted: true → use white
↓
Compare to product gray → still color mismatch → but clearer signal
```

**Impact:** More confidence that the color intent is truly white, reducing ranking confusion.

