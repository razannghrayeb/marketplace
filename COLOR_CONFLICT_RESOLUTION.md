# Color Conflict Resolution: What Happens When Inferred ≠ Crop Colors

## Overview

When there's a **conflict** between inferred color (from AI/BLIP caption) and crop dominant color (from k-means pixel analysis), the system uses a **multi-level priority system** to decide which color wins.

---

## Conflict Detection

```typescript
const inferredCropColorConflict =
  normalizedInferredColors.length > 0 &&
  normalizedCropColorsForMerge.length > 0 &&
  tieredColorListCompliance(normalizedInferredColors, normalizedCropColorsForMerge, "any").compliance <= 0;
```

**When is there a conflict?**
- Inferred colors exist (from BLIP/AI)
- Crop colors exist (from pixel analysis)
- The two lists have **ZERO compliance** (no match between them)

**Example:** Inferred = `["white"]`, Crop = `["navy", "black"]` → **CONFLICT**

---

## Resolution Priority Tree

When a conflict is detected, the system checks these conditions in order:

### **1. Footwear Exception (Top Priority)**
```typescript
const forceTrustInferredFootwearColor =
  isFootwearDetectionIntent &&
  inferredCropColorConflict &&
  hasHighConfidenceDarkFootwearConsensus({...});
```
- **If:** Category is **footwear** + conflict + dark shoe consensus
- **Then:** **USE INFERRED COLOR** (ignore crop)
- **Why:** Footwear crops often pick up floor/shadows (dark colors), not the actual shoe color

---

### **2. Strong Top Color (Tops & Outerwear)**
```typescript
const hasStrongTopItemColor =
  (detectionCategoryNorm === "tops" || ...) &&
  preferredInferredColorConfidence >= 0.84;
```
- **If:** Category is **tops** + confidence ≥ 84%
- **Then:** **USE INFERRED COLOR**
- **Why:** Tops are visually cleaner; AI detection is reliable

---

### **3. Strong Apparel Color (Bottoms, Dresses, Outerwear)**
```typescript
const hasStrongApparelItemColor =
  (detectionCategoryNorm === "bottoms" || 
   detectionCategoryNorm === "dresses" || ...) &&
  preferredInferredColorConfidence >= 0.82;
```
- **If:** Bottoms/dresses/outerwear + confidence ≥ 82%
- **Then:** **USE INFERRED COLOR**
- **Why:** Stronger garments have reliable AI color detection

---

### **4. Strong Accessory/Footwear Color**
```typescript
const hasStrongAccessoryItemColor =
  (detectionCategoryNorm === "bags" || 
   detectionCategoryNorm === "footwear") &&
  preferredInferredColorConfidence >= 0.72;
```
- **If:** Bags or footwear + confidence ≥ 72%
- **Then:** **USE INFERRED COLOR**
- **Why:** Accessories have lower detection confidence threshold

---

### **5. Category-Specific Preferences**
```typescript
function shouldPreferInferredColorWhenConflict(params) {
  // One-piece garments (dresses) → prefer inferred
  if (/\b(dress|gown|jumpsuit|romper|playsuit)\b/.test(merged)) return true;
  
  // Upper-body garments → prefer inferred
  if (/\b(top|shirt|tee|t-?shirt|blouse|sweater|hoodie|jacket|coat|blazer|outerwear)\b/.test(merged)) 
    return true;
  
  return false;
}
```

**Decision Rules:**
- **Dresses, jumpsuits, playsuits** → **USE INFERRED** (crop-based detection is unreliable for full-body garments)
- **Tops, shirts, hoodies, blazers, outerwear** → **USE INFERRED** (upper-body items have cleaner crop signals)
- **Bottoms, footwear, bags** → **USE CROP** (by default, unless confidence is very high)

---

### **6. Fallback: Use Crop Colors**
```typescript
if (!hasTrustedInferredColorSignal) {
  allColorsForRelevance = [...normalizedCropColorsForMerge];
}
```

If none of the above conditions pass:
- **USE CROP DOMINANT COLORS**
- **Why:** Crop is pixel-based ground truth, less prone to AI hallucination

---

## Final Decision Logic

```typescript
const hasTrustedInferredColorSignal =
  inferredColorTokens.length > 0 &&
  (
    !inferredCropColorConflict ||
    forceTrustInferredFootwearColor ||
    hasStrongTopItemColor ||
    hasStrongApparelItemColor ||
    hasStrongAccessoryItemColor ||
    hasStrongSlotAnchoredItemColor ||
    preferInferredColorForConflict
  );

// Then choose the winning color source:
let allColorsForRelevance;
if (hasExplicitColorIntent) {
  allColorsForRelevance = explicitColorsForRelevance;  // User filter wins all
} else if (hasTrustedInferredColorSignal) {
  allColorsForRelevance = normalizedInferredColors;    // Inferred wins
} else {
  allColorsForRelevance = normalizedCropColorsForMerge; // Crop wins
}
```

---

## Example Scenarios

### **Scenario 1: White Shirt (BEFORE FIX)**
```
Image: White shirt over navy pants
Inferred: ["white"]
Crop: ["navy", "black"]
Conflict: YES (compliance = 0)

Category: tops
Confidence: 0.85

Decision Path:
  → hasStrongTopItemColor? YES (0.85 ≥ 0.84) ✓
  → Result: USE INFERRED ["white"] ✓

Final Color Intent: white
```

### **Scenario 2: Brown Dress**
```
Image: Brown dress
Inferred: ["brown"]
Crop: ["gray"] (background bleed)
Conflict: YES

Category: dresses
Confidence: 0.78

Decision Path:
  → hasExplicitColorIntent? NO
  → forceTrustInferredFootwearColor? NO (not footwear)
  → hasStrongTopItemColor? NO (not tops)
  → hasStrongApparelItemColor? NO (0.78 < 0.82)
  → preferInferredColorForConflict? YES (dress) ✓
  → Result: USE INFERRED ["brown"] ✓

Final Color Intent: brown
```

### **Scenario 3: Navy Jeans**
```
Image: Navy jeans
Inferred: ["white"] (shirt above detected)
Crop: ["navy"]
Conflict: YES

Category: bottoms
Confidence: 0.80

Decision Path:
  → hasExplicitColorIntent? NO
  → forceTrustInferredFootwearColor? NO (not footwear)
  → hasStrongTopItemColor? NO (not tops)
  → hasStrongApparelItemColor? NO (0.80 < 0.82)
  → preferInferredColorForConflict? NO (not tops/dresses)
  → Result: USE CROP ["navy"] ✓

Final Color Intent: navy
```

### **Scenario 4: Black Shoes on Gray Floor**
```
Image: Black shoes on gray floor
Inferred: ["black"]
Crop: ["gray"] (floor dominates)
Conflict: YES

Category: footwear
Confidence: 0.75

Decision Path:
  → hasExplicitColorIntent? NO
  → forceTrustInferredFootwearColor? YES (0.75 ≥ 0.72 + dark consensus) ✓
  → Result: USE INFERRED ["black"] ✓

Final Color Intent: black
```

---

## Summary: Who Wins?

| Category | Has Conflict? | Inferred Conf. | Winner | Why |
|----------|---------------|---|--------|-----|
| **Tops** | YES | ≥ 0.84 | Inferred ✓ | Upper-body clean signals |
| **Tops** | YES | < 0.84 | Inferred ✓ | Category preference |
| **Bottoms** | YES | ≥ 0.82 | Inferred ✓ | Strong confidence |
| **Bottoms** | YES | < 0.82 | Crop ✓ | Crop is more reliable |
| **Dresses** | YES | Any | Inferred ✓ | Category preference (dresses) |
| **Footwear** | YES | ≥ 0.72 | Inferred ✓ | Floor avoidance |
| **Footwear** | YES | < 0.72 | Crop ✓ | But only if not dark consensus |
| **Explicit** | - | - | User Filter | User always wins |

---

## The White Shirt Bug (Fixed)

**Original Problem:** White shirt + navy pants
- Inferred: `["white"]` (correct)
- Crop: `["navy", "black"]` (wrong - extended too far down)
- No conflict detected because... crop was WRONG!

**After Fix:** White shirt + navy pants
- Inferred: `["white"]` (correct)
- Crop: `["white"]` (correct - crop now stops at 0.50 instead of 0.62)
- **No conflict** → both agree → use white ✓

