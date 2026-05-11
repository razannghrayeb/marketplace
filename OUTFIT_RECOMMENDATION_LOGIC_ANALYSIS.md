# Outfit/Style Recommendation Logic Analysis

## Executive Summary
The codebase contains outfit/style recommendation logic spread across 5 main files. Found several issues with season detection (not using sleeve attributes), shoe recommendations (allowing incompatible footwear for occasions), and style incompatibility enforcement (too permissive).

---

## 1. SEASON DETECTION FROM SLEEVE LENGTH

### Problem Location
**File:** [src/routes/products/completestyle.service.ts](src/routes/products/completestyle.service.ts#L931-L939)

**Function:** `detectSeason(title: string, description?: string)`

### Current Implementation (PROBLEMATIC)
```typescript
function detectSeason(title: string, description?: string): StyleProfile["season"] {
  const text = `${title} ${description || ""}`.toLowerCase();
  
  if (/winter|cold|warm|wool|fleece|puffer|down|thermal|cozy/i.test(text)) return "winter";
  if (/summer|light|linen|cotton|breathable|cool|beach/i.test(text)) return "summer";
  if (/spring|floral|pastel|light/i.test(text)) return "spring";
  if (/fall|autumn|layering|knit/i.test(text)) return "fall";
  
  return "all-season";
}
```

**Issues:**
1. ❌ **Ignores actual sleeve length** - A product titled "Sleeveless Tank" or "Short Sleeve Top" gets matched against hardcoded keywords only
2. ❌ **No attribute-based detection** - Doesn't analyze `product.sleeve_length` or similar structured data
3. ❌ **Contradictory matching** - "thermal" matches winter, but "light" can match summer (conflict)
4. ❌ **Overly broad fallback** - "all-season" used for any product without clear keyword

### Calibration Override Location
**File:** [src/routes/products/outfit.service.ts](src/routes/products/outfit.service.ts#L1189-L1250)

**Function:** `calibrateSourceStyleFromAnchor()` - Lines 1189-1250

This attempts partial fixes but is applied too late:
```typescript
// Lines 1187-1188: Detected late, not in initial detection
const longSleeveTopCue = /\b(long sleeve|long-sleeve|long sleeves|crew neck|crew-neck)\b/;
const heavyFabricCue = /\b(wool|fleece|thermal|heavyweight|knit|cashmere)\b/;

// Lines 1226-1240: Overwrites initial season detection
if (longSleeveTopCue.test(text) && !warmWeatherCue.test(text)) {
  if (season === "summer" || season === "spring") {
    season = "fall";  // Changes summer/spring to fall if long-sleeve detected
  }
}
```

**Problem:** This is a correction pass, not primary detection. Misclassified items propagate first.

---

## 2. SHOE/HEEL RECOMMENDATIONS FOR OCCASION/FORMALITY

### Problem Location
**File:** [src/routes/products/outfit.service.ts](src/routes/products/outfit.service.ts#L1640-L1690)

**Function:** `scoreFootwearOccasionCompatibility(sourceOccasion, candidateTitle, candidateCategory)`

### Heel/Shoe Scoring Rules (PERMISSIVE)
```typescript
if (sourceOccasion === "party") {
  if (isSneakerLike) return 0.12;        // ⚠️  Low score (0.12) but not rejected
  if (isDressyFootwear) return 0.98;     // ✅ High score for heels
  if (isBootLike) return 0.72;           // ✅ Medium-high for boots
  if (isCasualFlat) return 0.42;         // ⚠️  PROBLEM: 0.42 allows casual flats for party!
  if (isBeachFootwear) return 0.25;      // ⚠️  PROBLEM: 0.25 still allows sandals/flip-flops!
  return 0.48;
}

if (sourceOccasion === "formal" || sourceOccasion === "semi-formal") {
  if (isSneakerLike) return 0.18;        // ⚠️  Low but permissive
  if (isDressyFootwear) return 0.96;     // ✅ Correct: heels preferred
  if (isBootLike) return 0.78;           // ⚠️  Problem: boots score higher than formal flats (0.5)
  if (isCasualFlat) return 0.5;          // ⚠️  PROBLEM: Casual flats score 0.5 for formal!
  if (isBeachFootwear) return 0.2;
  return 0.5;
}

if (sourceOccasion === "casual") {
  if (isSneakerLike) return 0.96;        // ✅ Correct: sneakers preferred
  if (isDressyFootwear) return 0.66;     // ✅ Acceptable: heels allowed as secondary
  if (isBootLike || isCasualFlat) return 0.84;
  if (isBeachFootwear) return 0.7;
  return 0.74;
}
```

### Minimum Compatibility Gates (ALSO PERMISSIVE)
**File:** [src/routes/products/outfit.service.ts](src/routes/products/outfit.service.ts#L2000-L2020) - Function `minimumOccasionCompatibilityForFamily()`

```typescript
if (candidateFamily === "shoes") {
  if (sourceOccasion === "party") return 0.72;           // Minimum 0.72
  if (sourceOccasion === "formal" || sourceOccasion === "semi-formal") return 0.68;
  if (sourceOccasion === "active") return 0.72;
  if (sourceOccasion === "beach") return 0.64;
  return 0.4;
}
```

**Issues:**
- ❌ **Casual flats allowed for party** (0.42 score vs 0.72 minimum gate doesn't hard-reject)
- ❌ **Beach footwear allowed for party** (0.25 score - barely penalized)
- ❌ **Heels allowed for casual** (0.66 score - too permissive)
- ❌ **Casual flats allowed for formal** (0.5 score vs 0.68 minimum - borderline but passes)
- ⚠️  **No hard veto** - All scores are soft penalties, not rejections

### Shoe Filtering in Response
**File:** [src/routes/products/outfit.service.ts](src/routes/products/outfit.service.ts#L2800-L2815)

There's a hard gate for sneakers but NOT for heels/flats:
```typescript
// HARD GATE: sneakers rejected for party/formal
if (
  (sourceStyle.occasion === "party" || sourceStyle.occasion === "formal" || sourceStyle.occasion === "semi-formal") &&
  sneakerCue.test(normalizeStyleToken(candidateText)) &&
  (candidateFamily === "shoes" || shoeCue.test(normalizeStyleToken(candidateText)))
) {
  return true;  // REJECT
}

// BUT NO HARD GATE for casual flats/heels for wrong occasions!
// Hard dress-shoe gate only checks for sneakers with dress, not incompatible heels for casual
if (categoryLabel === "Shoes" && sourceIsDressAnchor) {
  if (isSneakerLike(text)) return false;  // ✅ Reject sneakers with dress
  const dressyLike = isDressyShoeLike(text);
  if (!dressyLike && sourceIsDressyOccasion) {
    return false;  // ✅ Reject casual shoes with dressy occasion
  }
}
```

**Problem:** Asymmetric logic - strict on sneakers, lenient on heels.

---

## 3. STYLE INCOMPATIBILITIES IGNORED

### Problem Location #1: Occasion-Based Filtering (Too Lenient)
**File:** [src/routes/products/outfit.service.ts](src/routes/products/outfit.service.ts#L2725-L2900)

**Function:** `mapCompleteLookToStyleResponse()` - `shouldKeepMappedSuggestion()` sub-function

```typescript
// Lines 2739-2754: Formal bottoms filtering
if ((sourceStyle.occasion === "formal" || sourceStyle.occasion === "semi-formal" || sourceStyle.occasion === "party") &&
    /\b(short|shorts|jogger|joggers|sweatpants|track pant|track pants|cargo|swim short|biker short|cycling short)\b/.test(text)
) {
  return false;  // ✅ Correct: Reject shorts for formal
}

// BUT then there are MANY exceptions that override these rules...
// Lines 2730-2738: Blazer/suit filter has exception
if ((sourceIsSuit || sourceIsBlazer) && sourceStyle.formality >= 5) {
  const hasFormalButton = /\b(formal button|dress pant|dress pants|...)\b/.test(text);
  if (!hasFormalButton) {
    if (/\b(short|shorts|jogger|...)\b/.test(text)) {
      return false;  // ✅ Reject casual bottoms
    }
  }
  // BUT: If hasFormalButton is undefined, the rejection is skipped!
}
```

### Problem Location #2: Formality-Aesthetic Mismatch (Not Enforced)
**File:** [src/routes/wardrobe/recommendations.service.ts](src/routes/wardrobe/recommendations.service.ts#L691-L720)

**Function:** `enforceOutfitCoherence()`

```typescript
const conflictingPairs = [
  ["sporty", "formal"],
  ["streetwear", "formal"],
  ["beach", "formal"],
];

// BUT this is only applied as a soft penalty:
if (dominantAesthetic) {
  const candidateAe = String(s.stylistSignals?.aesthetic || "").toLowerCase().trim();
  if (isHardAestheticClash(dominantAesthetic, candidateAe)) {
    penalty *= Math.max(0.3, 1 - excess * 0.14);  // Only penalty multiplier, not rejection
  }
}

// Minimum penalty is 0.3 (30% of base score) - NOT REJECTION!
```

**Issues:**
- ❌ **"Sporty" shoes allowed for formal occasions** - Only gets 0.3x multiplier penalty
- ❌ **"Beach" bags allowed for formal occasions** - Only soft penalty
- ❌ **"Streetwear" aesthetic allowed with formal formality** - Score reduced but not rejected

### Problem Location #3: Shoe-Occasion Mismatch (Fallback Route)
**File:** [src/routes/products/outfit.service.ts](src/routes/products/outfit.service.ts#L2870-2920)

In the `mapCompleteLookToStyleResponse()` function, there's a **fallback pass that ignores minimum scores**:

```typescript
// Pass 2 fallback: ensure shoes/bags are populated with best valid candidates.
const ensureCategoryFilled = (categoryLabel: "Shoes" | "Bags") => {
  const existing = groups.get(categoryLabel) || [];
  if (existing.length >= Math.min(4, maxPerCategory)) return;
  if (!groups.has(categoryLabel)) groups.set(categoryLabel, []);
  
  // ⚠️ PROBLEM: This bypasses ALL previous filtering!
  // If shoes weren't populated, it just fills with "best valid candidates"
  // even if they violate occasion/formality rules
};
```

---

## 4. DETAILED FILE STRUCTURE

### Core Recommendation Files

#### [src/routes/products/outfit.service.ts](src/routes/products/outfit.service.ts)
- **Main function:** `getOutfitRecommendations()` (Line 150)
- **Season calibration:** `calibrateSourceStyleFromAnchor()` (Line 1178)
- **Shoe scoring:** `scoreFootwearOccasionCompatibility()` (Line 1640)
- **Formality checks:** `scoreOccasionGarmentCompatibility()` (Line 1787)
- **Hard rejects:** `shouldHardRejectFashionCandidate()` (Line 1327)
- **Response filtering:** `mapCompleteLookToStyleResponse()` (Line 2656)
- **Minimum gates:** `minimumOccasionCompatibilityForFamily()` (Line 2000)

#### [src/routes/products/completestyle.service.ts](src/routes/products/completestyle.service.ts)
- **Style profile building:** `buildStyleProfile()` (Line 903)
- **Season detection (PROBLEMATIC):** `detectSeason()` (Line 931)

#### [src/lib/outfit/completestyle.ts](src/lib/outfit/completestyle.ts)
- **Alternative season detection:** `detectSeason()` (Line 1286)
- **Style profile type:** `StyleProfile` interface
- **Category mappings:** `CATEGORY_STYLE_MAP` (Line 558)

#### [src/lib/outfit/styleAwareSlotQuery.ts](src/lib/outfit/styleAwareSlotQuery.ts)
- **Shoe preferences by occasion/aesthetic:** Lines 82-200+
- Example: "semi-formal" + "classic" aesthetic prefers "pointed flats, simple heels, minimalist loafers"
- Avoid terms defined but not enforced in main recommendation engine

#### [src/routes/wardrobe/recommendations.service.ts](src/routes/wardrobe/recommendations.service.ts)
- **Shoe compatibility scoring:** `scoreFootwearStyleCompatibility()` (Line 460)
- **Bag compatibility scoring:** `scoreBagStyleCompatibility()` (Line 508)
- **Aesthetic family compatibility:** `aestheticFamilyCompatibility()` (Line 2778)
- **Outfit coherence enforcement:** `enforceOutfitCoherence()` (Line 691)

---

## 5. KEY API ENDPOINTS

Based on the code structure:

```
POST /api/products/{id}/outfit-recommendations
  - Endpoint: src/routes/products/outfit.service.ts :: getOutfitRecommendations()
  - Uses: buildStyleProfile(), calibrateSourceStyleFromAnchor()

POST /api/wardrobe/complete-look
  - Endpoint: src/routes/wardrobe/recommendations.service.ts :: runCompleteLookCore()
  - Uses: rerankCompleteLookFashionAware(), enforceOutfitCoherence()

POST /api/products/{id}/style-profile
  - Endpoint: src/routes/products/outfit.service.ts :: getStyleProfile()
  - Line: 374+
```

---

## 6. SCORING SYSTEM REFERENCE

### Formality Scale (0-10)
- 0-2: Casual/Sporty
- 3-5: Smart Casual
- 6-7: Semi-Formal
- 8-10: Formal

### Occasion Categories
- `"casual"` - Everyday wear
- `"semi-formal"` - Office, smart casual
- `"formal"` - Weddings, galas
- `"party"` - Social events
- `"active"` - Athletic wear
- `"beach"` - Beach/resort

### Aesthetic Categories
- `"classic"` - Timeless, tailored
- `"modern"` - Contemporary
- `"bohemian"` - Relaxed, flowing
- `"minimalist"` - Simple, neutral
- `"streetwear"` - Urban, casual
- `"romantic"` - Feminine, delicate
- `"edgy"` - Bold, rebellious
- `"sporty"` - Athletic

---

## 7. PROBLEMATIC SCORING THRESHOLDS

| Occasion | Shoe Type | Score | Gate | Status |
|----------|-----------|-------|------|--------|
| Party | Heels | 0.98 | 0.72 | ✅ Correct |
| Party | Casual Flats | 0.42 | 0.72 | ⚠️ Passes gate incorrectly |
| Party | Beach Sandals | 0.25 | 0.72 | ❌ Should fail gate |
| Formal | Heels | 0.96 | 0.68 | ✅ Correct |
| Formal | Casual Flats | 0.50 | 0.68 | ❌ Below gate (but weird) |
| Formal | Sneakers | 0.18 | 0.68 | ❌ Below gate (hard rejected) |
| Casual | Sneakers | 0.96 | 0.40 | ✅ Correct |
| Casual | Heels | 0.66 | 0.40 | ⚠️ Too permissive |

---

## 8. RECOMMENDED FIXES (SUMMARY)

### Fix #1: Sleeve-Based Season Detection
- Add check for `product.sleeve_length` attribute (if available)
- Mapping: `sleeveless/tank` → summer, `long_sleeve` → winter/fall
- Apply this BEFORE keyword matching, not after

### Fix #2: Hard Reject for Incompatible Heels
- Create asymmetric rule: heels hard-rejected for casual/active (like sneakers are for formal)
- Add gate: `if (occasion === "casual" || occasion === "active") && isHeelLike → return 0.0 (rejection)`
- Move from scoring to hard veto

### Fix #3: Enforce Minimum Gates
- Remove Pass 2 fallback that bypasses shoe/bag filtering
- If a category can't be filled with occasion-compatible items, return fewer items rather than violating constraints
- Document this behavior to frontend

---

## 9. RELEVANT CODE SNIPPETS FOR REFERENCE

### Problematic Heel Scoring (Line 1656-1670)
```typescript
if (sourceOccasion === "formal" || sourceOccasion === "semi-formal") {
  if (isSneakerLike) return 0.18;
  if (isDressyFootwear) return 0.96;
  if (isBootLike) return 0.78;
  if (isCasualFlat) return 0.5;  // ⚠️ PROBLEM HERE
  if (isBeachFootwear) return 0.2;
  return 0.5;
}
```

### Heels NOT Hard-Rejected for Casual (Line 2810-2820)
```typescript
// HARD GATE: sneakers rejected for party/formal
if (
  (sourceStyle.occasion === "party" || sourceStyle.occasion === "formal" || sourceStyle.occasion === "semi-formal") &&
  sneakerCue.test(normalizeStyleToken(candidateText)) &&
  (candidateFamily === "shoes" || shoeCue.test(normalizeStyleToken(candidateText)))
) {
  return true;  // REJECT sneakers
}
// ❌ No corresponding hard gate for heels with casual occasion
```

### Fallback Filling (Line 2900+)
```typescript
// Pass 2 fallback: ensure shoes/bags are populated with best valid candidates.
const ensureCategoryFilled = (categoryLabel: "Shoes" | "Bags") => {
  const existing = groups.get(categoryLabel) || [];
  if (existing.length >= Math.min(4, maxPerCategory)) return;
  // ⚠️ This bypasses occasion compatibility checks
};
```
