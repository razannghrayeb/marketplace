# Complete Field Reference: Role, Relations & Calculation Workflow

## Workflow Overview (Complete Pipeline)

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. IMAGE INPUT & INTENT DETECTION                               │
│    ↓ Detect what you're wearing, infer intent                   │
│    imageMode, intentFamily, intentType, desiredProductTypes     │
│    desiredColors (inferred), desiredSleeve                      │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 2. PRODUCT RETRIEVAL & MATCHING                                 │
│    ↓ Fetch candidate products from OpenSearch                   │
│    similarity_score (CLIP), clipCosine, merchandiseSimilarity   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 3. ATTRIBUTE COMPLIANCE SCORING                                 │
│    ↓ Rate each attribute: type, color, sleeve, audience         │
│    exactTypeScore, colorCompliance, sleeveCompliance, etc.      │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 4. CONFLICT DETECTION & RESOLUTION                              │
│    ↓ Inferred vs crop color, determine trustworthiness          │
│    inferredVsCropConflict, inferredColorTrusted                 │
│    colorContradictionPenalty                                    │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 5. PENALTY & MODIFIER APPLICATION                               │
│    ↓ Apply penalties for mismatches                             │
│    intraFamilyPenalty, crossFamilyPenalty, qualityModifier      │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 6. TIER ASSIGNMENT                                              │
│    ↓ Categorize into confidence tiers                           │
│    matchTier, tierScore, tierCap, tierReason                    │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 7. FINAL CALIBRATION & RELEVANCE                                │
│    ↓ Blend scores, apply gates, calculate final rank            │
│    finalRelevance01, finalRelevanceSource, rerankScore          │
└─────────────────────────────────────────────────────────────────┘
```

---

## SECTION 1: PRODUCT IDENTITY FIELDS

### Top-Level Product Info
```json
"id": "136529"                          // Unique product identifier
"title": "Bugatti Men Sweatshirt..."    // Display name
"brand": "Boss"                         // Brand
"category": "Sweatshirts"               // Catalog category
"currency": "USD"                       // Price currency
"price_cents": "17900"                  // Price in cents (0.01 units)
"sales_price_cents": null               // Discounted price (if any)
"image_url": "https://..."              // Primary product image
"image_cdn": "https://..."              // CDN image (cached/optimized)
```

**Role:** These are metadata fields that identify and describe the product for display and commerce.

---

## SECTION 2: VISUAL MATCHING SCORES

### CLIP Embedding Similarity (The Primary Match Signal)
```json
"similarity_score": 0.9                 // Primary ranking signal (0-1)
"clipCosine": 0.89569396                // Detailed CLIP cosine similarity
"merchandiseSimilarity": 0.89569396     // Alias for CLIP (same value)
"imageCompositeScore": 1102.1178...     // Raw composite score (not normalized)
"imageCompositeScore01": 0.5116...      // Normalized to 0-1 (actual visual quality)
"fusedVisual": 0.32                     // Visual after attribute penalties
"catalogAlignment": 1                   // Whether product type is in catalog
```

**Relationships:**
- `similarity_score` ≈ `clipCosine` (same CLIP embedding distance)
- `imageCompositeScore` is raw; `imageCompositeScore01` is normalized (0-1)
- `fusedVisual` = visual score AFTER penalties applied
- **Key insight:** Visual similarity is HIGH (0.9) but that alone doesn't guarantee high ranking

**Calculation note:**
```
Raw visual ≈ 0.9 (CLIP match)
After penalties = 0.32 (fusedVisual)
Final uses both: blended, not replaced
```

---

## SECTION 3: ATTRIBUTE SCORES (Individual Factors)

### Type/Category Matching
```json
// What you want vs what this is:
"desiredProductTypes": [
  "tshirt", "t-shirt", "tee", "shirt", "top", "tops", "shirts",
  "tank", "short", "camisole", "short sleeve top", "blouse",
  "blouses", "button down"
]                                       // Expected types
"normalizedType": "sweatshirt"          // What this product actually is
"normalizedFamily": "tops"              // Product category (both in "tops")

// Type scoring:
"exactTypeScore": 0.55                  // How close is sweatshirt to tshirt?
"productTypeCompliance": 0.55           // Alias for exactTypeScore (0-1)
"semanticTypeScore": 0.55               // Semantic similarity (same as above)
"siblingClusterScore": 0                // Is product in sibling group? (0 = not)
"parentHypernymScore": 0                // Is product in parent group? (0 = not)
"taxonomyMatch": 0                      // Exact taxonomy match? (0 = no)

// Penalties from type mismatch:
"intraFamilyPenalty": 0.44              // Same family but wrong type → -0.44
"crossFamilyPenalty": 0.56              // Would be if different family (tops vs bottoms)
```

**Relationships:**
- `desiredProductTypes` ≠ `normalizedType` → Mismatch triggered
- `exactTypeScore: 0.55` means sweatshirt is ~55% compatible with "tshirt_or_shirt" intent
- `intraFamilyPenalty: 0.44` = 1.0 - 0.55 = penalty amount
- All type scores align (0.55)

**Calculation:**
```
Visual base: 0.9
Type score: 0.55
Family match: YES (both "tops")
Penalty: -0.44 (intraFamilyPenalty)

Intermediate: 0.9 × some_weights - 0.44 = ...
```

---

### Color Matching (Most Complex - Multiple Signals)
```json
// User intent color:
"desiredColors": []                     // Explicit user filter (empty)
"desiredColorsExplicit": []             // Same (no user override)
"desiredColorsEffective": ["white"]     // Final color target (inferred)
"colorIntentSource": "inferred"         // Where intent came from

// Detected colors from outfit:
"relevanceIntentDebug": {
  "color": {
    "cropDominantTokens": ["navy", "black"],  // Pixel analysis of crop
    "inferredTokens": ["white"],              // AI/BLIP says white
    "inferredVsCropConflict": true,           // They disagree
    "inferredColorTrusted": true,             // But AI is trusted
    "inferredColorForcedForFootwear": false,  // (not footwear)
    "softBiasOnly": true,                     // Color is soft gate, not hard
    "effectiveDesired": ["white"]             // Final target = white
  }
}

// Product actual color:
"color": null                           // Not populated in this response
"matchedColor": "gray"                  // What color the product actually is
"colorTier": "none"                     // Quality tier of color match

// Color compliance & scoring:
"colorCompliance": 0                    // Gray ≠ white → 0% match
"colorSimEffective": 0.401              // Effective color score after penalties
"colorEmbeddingSim": 0.89               // How visually similar are the colors?
"colorContradictionPenalty": 0.8        // Soft penalty multiplier (0.8x)
"blipColorConflictFactor": 1            // Additional conflict penalty multiplier (1.0 = none)
```

**Relationships & Workflow:**
```
Step 1: Detect outfit color
  crop says: ["navy", "black"]
  inferred says: ["white"]
  → Conflict detected ✓

Step 2: Resolve conflict
  inferredColorTrusted = true (tops category)
  → Use inferred ["white"] as intent

Step 3: Check product
  matchedColor = "gray"
  → Compare to intent "white"

Step 4: Score
  colorCompliance = 0 (no direct match)
  colorEmbeddingSim = 0.89 (colors are visually similar)
  
Step 5: Apply penalty
  Base = 0.89
  × colorContradictionPenalty (0.8) = 0.712
  × blipColorConflictFactor (1.0) = 0.712
  ≈ colorSimEffective (0.401) after more blending
```

**Key insight:** `colorCompliance: 0` but `colorSimEffective: 0.401` because:
- Compliance = semantic match (0)
- Effective = visual similarity + penalties blended

---

### Sleeve Matching
```json
"desiredSleeve": "short"                // Want short sleeves
"sleeveCompliance": 0.12                // Product has only 12% sleeve match
"hasSleeveIntent": true                 // Sleeve matters to this search
```

**Relationship:** You asked for short, sweatshirts typically have long → only 12% match

---

### Length Matching
```json
"lengthCompliance": 0                   // No length match
"hasLengthIntent": false                // Length doesn't matter for this search
```

**Relationship:** Doesn't gate ranking, but would if `hasLengthIntent: true`

---

### Style & Appearance Matching
```json
"styleCompliance": 0                    // Style doesn't match
"styleEmbeddingSim": 0.833              // But visually similar style
"styleSimEffective": 0.833              // Effective style similarity
"hasStyleIntent": false                 // Style not part of this search intent

"patternEmbeddingSim": 0.816            // Pattern similarity
"textureEmbeddingSim": 0.784            // Texture similarity
"materialEmbeddingSim": 0.865           // Material similarity (highest)
```

**Relationships:**
- These embeddings (pattern, texture, material) feed into the overall visual composite
- They're soft signals (don't gate), but boost visual credibility
- `materialEmbeddingSim: 0.865` is highest (sweatshirt fabric is similar to worn top)

---

### Audience Matching (Highest Compliance)
```json
"normalizedAudience": "men"             // Product is for men
"audienceCompliance": 1                 // Perfect match (you want men's)
"hasAudienceIntentForRelevance": true   // Audience was part of detection
```

**Relationship:** Perfect match (1.0) → +1.0 bonus to aggregated score

---

## SECTION 4: CONFLICT DETECTION & RESOLUTION

### Color Conflict System
```json
"inferredVsCropConflict": true          // YES: crop ≠ inferred
"inferredColorTrusted": true            // DECISION: trust inferred anyway
"inferredColorForcedForFootwear": false // NOT forced (not footwear category)
"softBiasOnly": true                    // Color gates are SOFT, not HARD
"blipColorConflictFactor": 1            // No additional penalty for conflict
"colorContradictionPenalty": 0.8        // Soft penalty: apply 0.8x multiplier
```

**Decision Tree That Led to These Values:**
```
Conflict detected? YES (navy/black ≠ white)
  ↓
Is footwear with dark consensus? NO
  ↓
Is tops/outerwear/dress? YES (tops)
  ↓
Is confidence ≥ 0.84? YES (inferred high confidence)
  ↓
Result: inferredColorTrusted = true ✓

Color intent gates final relevance? NO
  ↓
Result: softBiasOnly = true ✓ (only soft penalty, not hard gate)
```

---

## SECTION 5: GATES & GATES (Hard vs Soft)

```json
"colorIntentGatesFinalRelevance": false     // Color doesn't BLOCK ranking
"hardBlocked": false                        // Not hard-blocked entirely
"styleIntentGatesFinalRelevance": false     // Style doesn't gate

"hasTypeIntent": true                       // Type IS part of intent
"hasColorIntent": true                      // Color IS part of intent
"hasStyleIntent": false                     // Style is NOT part of intent
"hasSleeveIntent": true                     // Sleeve IS part of intent
"hasLengthIntent": false                    // Length is NOT part of intent
```

**Relationships:**
- `hasXIntent: true` means X is part of the search intent
- `XIntentGatesFinalRelevance: false` means X can't block the product
- Combined: Type matters but won't block; color matters but won't block
- **Result:** Both can reduce score (penalties) but won't eliminate product

---

## SECTION 6: AGGREGATE COMPLIANCE SCORES

```json
"attributeAgreement": 0.2376844...      // Average of all attribute compliances
"metadataCompliance": 0.85              // Overall metadata quality (85%)

// Calculation:
// attributeAgreement = avg(
//   type: 0.55,
//   color: 0,
//   sleeve: 0.12,
//   audience: 1,
//   style: 0,
//   length: 0
// ) = (0.55 + 0 + 0.12 + 1 + 0 + 0) / 6 = 0.237...
```

**Relationship:** Lower aggregate compliance → product doesn't match many attributes → needs strong visual to compensate

---

## SECTION 7: TIER ASSIGNMENT

### Tier Concept
```
Tier Hierarchy (Confidence Levels):
  Exact    (0.95+)  → Type + color both match perfectly
    ↓
  Core     (0.80+)  → Type matches, color close
    ↓
  Family   (0.70+)  → Same category, but type differs
    ↓
  Fallback (0.40+)  → Visual match but multiple mismatches ← YOU ARE HERE
    ↓
  Low      (0.00+)  → Barely acceptable
```

### Tier Assignment Fields
```json
"matchTier": "fallback"                 // Which tier?
"tierReason": "family match (tops); type mismatch (expected tshirt_or_shirt, got sweatshirt); audience match (men)"
                                        // Why this tier?
"tierScore": 0.4                        // Base score for this tier
"tierCap": 0.4                          // Starting cap for this tier
```

**Calculation Logic:**
```
Tier determination:
  Same family (tops = tops)? YES
  Type matches (sweatshirt = tshirt)? NO
  Audience matches (men = men)? YES
  
  Result: Family match but type mismatch → FALLBACK tier
  tierScore = 0.4 (fallback baseline)
  tierCap = 0.4 (fallback max starting point)
```

---

## SECTION 8: FINAL RELEVANCE CALCULATION

### Final Score Computation
```json
"finalRelevance01": 0.8196              // Final ranking score (0-1)
"finalRelevanceSource": "calibrated_image_score"
                                        // How was it calculated?

// Alternative calculations (for comparison):
"oldCalibratedFinalRelevance01": 0.8196 // Previous calibration
"mlRerankScore": 0.8196                 // ML rerank agrees
"rerankScore": -26.303884...            // Raw rerank delta (for sorting)
```

**The Calculation (Simplified):**
```
Input factors:
  Visual (CLIP): 0.9
  Type score: 0.55
  Color score: 0.0 (compliance) → 0.401 (effective)
  Sleeve score: 0.12
  Audience score: 1.0
  Tier baseline: 0.4

Calculation steps:
  1. Average attributes: (0.55 + 0.401 + 0.12 + 1.0) / 4 ≈ 0.518
  2. Apply visual boost: 0.9 × weight + 0.518 × weight ≈ 0.70
  3. Tier calibration: 0.4 (baseline) boosted by visual (0.9)
  4. Metadata blend: 0.70 × 0.85 (metadataCompliance) ≈ 0.595
  5. Final calibration: blend(0.595, visual, tier) ≈ 0.8196

Result: 0.8196 ← This is your final score
```

---

## SECTION 9: RANKING DEBUG INFO

```json
"rankingDebug": {
  "id": "136529"                        // Product ID
  "detectedLabel": "short sleeve top"   // What the detection thought you wanted
  "visualSimilarity": 0.9               // Core visual match
  "exactTypeScore": 0.55                // Type match score
  "typeScore": 0                        // Applied type score (with penalties)
  "colorScore": 0.4                     // Applied color score (after penalties)
  "exactColorMatch": false              // Semantic match? (gray ≠ white)
  "sameColorFamily": false              // Same family? (gray and white not same family)
  "familyMismatch": false               // Category mismatch? (both tops)
  "nearIdenticalVisual": false          // Nearly identical? (no, just 0.9)
  "visualBase": 0.84                    // Baseline visual score (after cleanup)
  "attributeAgreement": 0.237...        // Average attribute compliance
  "familyGate": 1                       // Same family gate pass (1 = pass)
  "contradictionPenalty": 1             // Penalty multiplier (1 = no penalty)
  "qualityModifier": 0.9552...          // Quality adjustment multiplier
  "maxFinal": 0.995                     // Maximum possible final score
  "matchLabel": "weak"                  // Overall match quality
  "finalScore": 0.8196                  // Final score computed
  "boosts": []                          // Applied bonuses (none)
  "penalties": []                       // Applied penalties (tracked elsewhere)
}
```

**Relationships:**
- `visualSimilarity (0.9)` → `visualBase (0.84)` (small cleanup)
- `typeScore (0)` = applied penalty; `exactTypeScore (0.55)` = raw
- `colorScore (0.4)` vs `colorCompliance (0)` vs `colorSimEffective (0.401)` are different calculations at different stages
- `matchLabel: "weak"` explains the final result qualitatively

---

## SECTION 10: DEBUG CONTRACT (What The Calculation Saw)

```json
"debugContract": {
  "imageMode": "worn_outfit"            // Single item on person
  "intentFamily": "tops"                // You want tops
  "intentType": "tshirt_or_shirt"       // Specifically tshirt/shirt
  "intentSubtype": "short_sleeve_top"   // Specifically short sleeve
  
  "productFamily": "tops"               // Product is tops
  "productType": "sweatshirt"           // Product is sweatshirt
  "productSubtype": null                // No subtype specified
  "productAudience": "men"              // Product is men's
  
  "guardPassed": true                   // Did it pass safety checks?
  "guardReason": "calibrated_image_score"  // Why did it pass?
  
  "scoreBreakdown": {
    "visual": 0.9                       // Visual similarity
    "type": 0.55                        // Type compliance
    "color": 0                          // Color compliance
    "sleeve": 0.12                      // Sleeve compliance
    "length": 0                         // Length compliance
    "style": 0                          // Style compliance
    "audience": 1                       // Audience compliance
    "final": 0.8196                     // Final score
  }
}
```

**This is the simplified scoring used in the final calculation:**
```
Scores per category:
  visual:   90% match
  type:     55% match (sweatshirt isn't exactly tshirt)
  color:    0% match (gray ≠ white)
  sleeve:   12% match (long ≠ short)
  audience: 100% match (men = men)
  length:   0% match (not measured)
  style:    0% match (not measured)

Final: 0.8196 (weighted average of these + visual boost)
```

---

## SECTION 11: DEEP FUSION & ML SCORING

```json
"deepFusionTextAlignment": 0.029        // Text description alignment (very low)
"deepFusionScore": 0.326                // Deep learning fusion score
"blipAlignment": 0                      // BLIP caption alignment (0 = not aligned)
```

**What are these?**
- Deep fusion = multimodal model combining text + image
- Text alignment low (0.029) because "sweatshirt" description doesn't mention short sleeves
- BLIP alignment (0) because no caption describes the product

---

## THE COMPLETE WORKFLOW CALCULATION

```
INPUT STAGE:
  Your outfit: White shirt (inferred from CLIP + BLIP)
  Crop detail: Navy/black pants (crop extraction)
  Your intent: Short-sleeve tshirt/shirt in white
  Detection: 90% visual match to a sweatshirt
  
CONFLICT RESOLUTION:
  Inferred (white) vs Crop (navy/black) → Use inferred (trusted)
  Target color = white
  
COMPLIANCE STAGE:
  Type: sweatshirt vs tshirt = 0.55 ✗
  Color: gray vs white = 0.0 ✗
  Sleeve: long vs short = 0.12 ✗
  Audience: men vs men = 1.0 ✓
  Average: 0.417
  
PENALTY STAGE:
  Type mismatch: -0.44 (intraFamilyPenalty)
  Color mismatch: -0.20 (colorContradictionPenalty 0.8x)
  
TIER STAGE:
  Family match + type mismatch = FALLBACK
  Base tier cap = 0.4
  But visual (0.9) boosts it
  
CALIBRATION STAGE:
  Blend:
    - Tier baseline (0.4)
    - Visual similarity (0.9)
    - Attribute average (0.417)
    - Metadata quality (0.85)
  Intermediate: ≈ 0.70
  
FINAL:
  Apply quality modifier (0.9552)
  Result: 0.8196
  
OUTPUT:
  finalRelevance01 = 0.8196
  matchTier = "fallback"
  tierReason = "family match but type mismatch"
```

---

## FIELD DEPENDENCY MAP

```
INPUTS → DETECTION
  ├─ image (worn_outfit)
  └─ inferred intent (tshirt, white, short-sleeve, men)
  
DETECTION → ATTRIBUTES
  ├─ clipCosine (0.9)
  ├─ productType (sweatshirt) vs desiredProductTypes (tshirt_or_shirt)
  ├─ matchedColor (gray) vs desiredColorsEffective (white)
  └─ inferred color conflict resolution
  
ATTRIBUTES → COMPLIANCE
  ├─ exactTypeScore (0.55)
  ├─ colorCompliance (0)
  ├─ sleeveCompliance (0.12)
  ├─ audienceCompliance (1.0)
  └─ attributeAgreement (0.237)
  
COMPLIANCE → PENALTIES
  ├─ intraFamilyPenalty (0.44)
  ├─ colorContradictionPenalty (0.8x multiplier)
  └─ crossFamilyPenalty (not applied)
  
PENALTIES + VISUAL → TIER
  ├─ Type mismatch → FALLBACK tier
  ├─ tierCap (0.4)
  └─ tierReason
  
TIER + VISUAL + COMPLIANCE → FINAL
  ├─ Blend scores
  ├─ Apply modifiers (0.9552)
  ├─ Final = 0.8196
  ├─ finalRelevanceSource = calibrated_image_score
  └─ mlRerankScore = 0.8196 (confirms)
  
FINAL → RANKING
  ├─ rerankScore = -26.303 (for sorting)
  └─ matchLabel = "weak"
```

---

## Summary: What Each Field Group Does

| Group | Fields | Purpose | Impact on Score |
|-------|--------|---------|-----------------|
| **Product ID** | id, title, brand, category, price | Display & tracking | None (metadata only) |
| **Visual Match** | similarity_score, clipCosine, imageCompositeScore01 | How visually similar? | ✓ Major (0.9 = boost) |
| **Type/Category** | desiredProductTypes, normalizedType, exactTypeScore | Does type match? | ✓ Major (-0.44 penalty) |
| **Color** | cropDominantTokens, inferredTokens, colorCompliance, colorSimEffective | Does color match? | ✓ Major (-0.20 penalty) |
| **Sleeve/Length** | desiredSleeve, sleeveCompliance, lengthCompliance | Do attributes match? | ✗ Minor (only 0.12) |
| **Audience** | normalizedAudience, audienceCompliance | Is gender/age right? | ✓ Perfect (+1.0) |
| **Compliance Aggregate** | attributeAgreement, metadataCompliance | Overall attribute fit | ✓ Major (0.237 = low) |
| **Conflict Resolution** | inferredVsCropConflict, inferredColorTrusted, softBiasOnly | Which color source wins? | ✓ Major (affects intent) |
| **Tier** | matchTier, tierScore, tierCap, tierReason | Confidence category | ✓ Major (caps starting score) |
| **Penalties** | intraFamilyPenalty, colorContradictionPenalty, qualityModifier | Reductions applied | ✓ Major (0.44 + 0.20 = -0.64) |
| **Final** | finalRelevance01, finalRelevanceSource, mlRerankScore | Final ranking score | ✓ Your output (0.8196) |
| **Debug** | rankingDebug, debugContract | Explains calculation | None (just info) |

---

## Why This Product Scores 0.8196 (Not Higher Despite 0.9 Visual)

```
PENALTY STACK:
  Start: 0.9 visual
  - Type mismatch: -0.44
  - Color mismatch: -0.20
  = 0.26 remaining
  
BOOST:
  + Audience match: +1.0
  + Metadata quality: ×0.85
  + Visual re-weight: ×weight
  + Tier calibration: blend(0.4 baseline, 0.9 visual)
  
FINAL BLEND:
  ≈ 0.8196
```

**The math: Visual is high, but 3 major attributes miss → Score capped at tier ceiling → Boosted by strong visual → Results in 0.8196 (good but not great)**

