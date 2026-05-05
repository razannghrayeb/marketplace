# Image Search Field Implementation Map

Complete reference for all fields in the image search response, where they're computed, and their relationships.

---

## SECTION 1: Basic Product Fields

| Field | Type | Source File | Computed By | Notes |
|-------|------|-------------|-------------|-------|
| `id` | string | OpenSearch | Document index | Product catalog ID |
| `title` | string | OpenSearch | Document index | Product title |
| `brand` | string | OpenSearch | Document index | Brand name |
| `category` | string | OpenSearch | Document index | Catalog category |
| `currency` | string | OpenSearch | Document index | Price currency (default USD) |
| `price_cents` | number | OpenSearch | Document index | List price in cents |
| `sales_price_cents` | number | OpenSearch | Document index | Sale price (if applicable) |
| `image_url` | string | OpenSearch | Document index | CDN product image |
| `image_cdn` | string \| null | OpenSearch | Document index | Alternative CDN (reserved) |

---

## SECTION 2: Visual Similarity Fields

| Field | Type | Source File | Computed By | Value Range | Notes |
|-------|------|-------------|-------------|-------------|-------|
| `similarity_score` | number | `src/lib/search/searchHitRelevance.ts` | CLIP cosine via kNN | 0.0–1.0 | **Primary visual signal** - raw embedding cosine similarity from CLIP model. Higher = more visually similar |
| `match_type` | string | `src/lib/search/searchHitRelevance.ts` | `computeMatchType()` | "exact"\|"similar"\|"related"\|"weak" | Categorical tier label based on tier assignment |
| `clipCosine` | number | `src/lib/search/merchandiseVisualSimilarity.ts` | `getMerchandiseSimilarity()` | 0.0–1.0 | Same as similarity_score; preserved in explain for debugging |
| `merchandiseSimilarity` | number | `src/lib/search/merchandiseVisualSimilarity.ts` | `getMerchandiseSimilarity()` | 0.0–1.0 | Visual similarity adjusted for catalog visual diversity |

---

## SECTION 3: Semantic & Fusion Scores

| Field | Type | Source File | Computed By | Value Range | Notes |
|-------|------|-------------|-------------|-------------|-------|
| `deepFusionTextAlignment` | number | `src/lib/search/attentionFusion.ts` | `fuse()` → text encoder attention | 0.0–1.0 | How well text description aligns with visual (0.117 = weak) |
| `deepFusionScore` | number | `src/lib/search/attentionFusion.ts` | `fuse()` | 0.0–1.0 | Combined text+visual fusion signal (0.29 = low agreement) |
| `imageCompositeScore` | number | `src/lib/search/searchHitRelevance.ts` | Multi-signal fusion | 0.0+| Aggregate weighted score across all visual signals (raw, unbounded) |
| `imageCompositeScore01` | number | `src/lib/search/searchHitRelevance.ts` | Normalize `imageCompositeScore` | 0.0–1.0 | Bounded version for display (0.6914 = moderate composite) |
| `fusedVisual` | number | `src/lib/search/searchHitRelevance.ts` | Multi-signal fusion | 0.0–1.0 | Final fused visual score after all adjustments |

---

## SECTION 4: Embedding Similarity Scores (By Attribute)

| Field | Type | Source File | Computed By | Value Range | Notes |
|-------|------|-------------|-------------|-------------|-------|
| `colorEmbeddingSim` | number | `src/lib/search/attributeEmbeddings.ts` | Embedding model | 0.0–1.0 | Cosine similarity for color embeddings (0.778 = good match) |
| `styleEmbeddingSim` | number | `src/lib/search/attributeEmbeddings.ts` | Embedding model | 0.0–1.0 | Style embedding similarity (0.718) |
| `patternEmbeddingSim` | number | `src/lib/search/attributeEmbeddings.ts` | Embedding model | 0.0–1.0 | Pattern embedding similarity (0.685) |
| `textureEmbeddingSim` | number | `src/lib/search/attributeEmbeddings.ts` | Embedding model | 0.0–1.0 | Texture embedding similarity (0.627) |
| `materialEmbeddingSim` | number | `src/lib/search/attributeEmbeddings.ts` | Embedding model | 0.0–1.0 | Material embedding similarity (0.77) |

**Relationship**: These are inputs to compliance scoring; high embedding similarity (0.7+) generally leads to high compliance (0.55+).

---

## SECTION 5: Product Type Compliance Fields

| Field | Type | Source File | Computed By | Value Range | Notes |
|-------|------|-------------|-------------|-------------|-------|
| `normalizedType` | string | `src/lib/search/productNormalization.ts` | Product hydration | string | Canonical product type (e.g., "shoe") |
| `exactTypeScore` | number | `src/lib/search/productTypeTaxonomy.ts` | `scoreRerankProductTypeBreakdown()` | 0.0–1.0 | Exact match score in type taxonomy (0.55 = not exact match) |
| `siblingClusterScore` | number | `src/lib/search/productTypeTaxonomy.ts` | `scoreRerankProductTypeBreakdown()` | 0.0–1.0 | Score from sibling cluster in taxonomy tree (1.0 = same cluster) |
| `parentHypernymScore` | number | `src/lib/search/productTypeTaxonomy.ts` | `scoreRerankProductTypeBreakdown()` | 0.0–1.0 | Parent category match (0.54 = partial parent match) |
| `productTypeCompliance` | number | `src/lib/search/searchHitRelevance.ts` | Type intent reconciliation | 0.0–1.0 | **Final type compliance** used in final relevance (0.55 in this case) |
| `semanticTypeScore` | number | `src/lib/search/searchHitRelevance.ts` | Type semantic distance | 0.0–1.0 | Semantic similarity between intent and detected type (0.55) |
| `typeScore` | number | `src/lib/search/searchHitRelevance.ts` | Parameter to `computeFinalRelevance01()` | 0.0–1.0 | **Input to final relevance** (0 in ranking_debug indicates 0-weighted type) |

**Relationship**:  
- `exactTypeScore`, `siblingClusterScore`, `parentHypernymScore` → contribute to `productTypeCompliance`
- `productTypeCompliance` / `semanticTypeScore` → used as `typeScore` input to `computeFinalRelevance01()`

---

## SECTION 6: Family & Category Fields

| Field | Type | Source File | Computed By | Value Range | Notes |
|-------|------|-------------|-------------|-------------|-------|
| `normalizedFamily` | string | `src/lib/search/productNormalization.ts` | Hydration | string | Product family (footwear, tops, bottoms, etc.) |
| `catalogAlignment` | number | `src/lib/search/searchHitRelevance.ts` | `scoreCatalogAlignment()` | 0.0–1.0 | How well product catalog aligns with expected category (1.0 = perfect) |
| `categoryScore` | number | `src/lib/search/searchHitRelevance.ts` | Category matching | 0.0–1.0 | **Input to final relevance** - category compliance (used in weighted formula) |

**Relationship**: `catalogAlignment` contributes to `categoryScore` → used in `computeFinalRelevance01()`

---

## SECTION 7: Color Compliance Fields

| Field | Type | Source File | Computed By | Value Range | Notes |
|-------|------|-------------|-------------|-------------|-------|
| `normalizedColor` | string | `src/lib/search/productNormalization.ts` | Product hydration | string | Canonical color name (e.g., "black") |
| `color` | string \| null | OpenSearch | Document source | string \| null | Raw color from product data |
| `matchedColor` | string | `src/lib/search/searchHitRelevance.ts` | Color matching logic | string | Matched color from product (for explain) |
| `colorTier` | string | `src/lib/search/colorCanonical.ts` | Tier classification | "exact"\|"shade"\|"bucket"\|"family"\|"none" | Tiered color match level |
| `colorCompliance` | number | `src/lib/search/colorCanonical.ts` | `tieredColorListCompliance()` | 0.0–1.0 | **Final color compliance score** (0 = no match; black ≠ blue) |
| `colorSimEffective` | number | `src/lib/search/searchHitRelevance.ts` | Weighted color formula | 0.0–1.0 | Effective color similarity after intent reconciliation (0.35 in example) |

**Relationship**:  
- `colorEmbeddingSim` (0.778) → supports `colorCompliance` calculation  
- `colorCompliance` → gates `finalRelevance01` if `hasColorIntent=true`  
- If no explicit color match, `colorCompliance=0` → hard penalty in final relevance

---

## SECTION 8: Style & Pattern Compliance

| Field | Type | Source File | Computed By | Value Range | Notes |
|-------|------|-------------|-------------|-------------|-------|
| `normalizedStyle` | string | `src/lib/search/productNormalization.ts` | Product hydration | string | Style classification |
| `normalizedSilhouette` | string | `src/lib/search/productNormalization.ts` | Product hydration | string | Silhouette classification |
| `styleCompliance` | number | `src/lib/search/searchHitRelevance.ts` | Style matching | 0.0–1.0 | Style compliance score (0 if no style intent) |
| `styleEmbeddingSim` (0.718) | number | attribute embeddings | | 0.0–1.0 | Supports style compliance calculation |
| `styleScore` | number | `src/lib/search/searchHitRelevance.ts` | Parameter to `computeFinalRelevance01()` | 0.0–1.0 | **Input to final relevance** |
| `patternEmbeddingSim` (0.685) | number | attribute embeddings | | 0.0–1.0 | Pattern embedding similarity |

---

## SECTION 9: Audience & Material Fields

| Field | Type | Source File | Computed By | Value Range | Notes |
|-------|------|-------------|-------------|-------------|-------|
| `normalizedAudience` | enum | `src/lib/search/productNormalization.ts` | Product hydration | "men"\|"women"\|"unisex"\|"unknown" | Target audience |
| `audienceCompliance` | number | `src/lib/search/searchHitRelevance.ts` | Audience matching | 0.0–1.0 | Audience match (1.0 = perfect match) |
| `normalizedMaterial` | string | `src/lib/search/productNormalization.ts` | Product hydration | string | Material classification |
| `materialEmbeddingSim` (0.77) | number | attribute embeddings | | 0.0–1.0 | Material similarity support |

---

## SECTION 10: Sleeve & Length Intent Fields

| Field | Type | Source File | Computed By | Value Range | Notes |
|-------|------|-------------|-------------|-------------|-------|
| `sleeveCompliance` | number | `src/lib/search/searchHitRelevance.ts` | Sleeve matching | 0.0–1.0 | Sleeve length compliance (0 = no match or no intent) |
| `lengthCompliance` | number | `src/lib/search/searchHitRelevance.ts` | Length matching | 0.0–1.0 | Length compliance for dresses/pants (0 = no match or no intent) |

---

## SECTION 11: Penalties & Multipliers

| Field | Type | Source File | Computed By | Value Range | Notes |
|-------|------|-------------|-------------|-------------|-------|
| `intraFamilyPenalty` | number | `src/lib/search/productTypeTaxonomy.ts` | `scoreCrossFamilyTypePenalty()` | 0.0–1.0 | Penalty for wrong subtype within same family (0.52 = moderate penalty) |
| `crossFamilyPenalty` | number | `src/lib/search/productTypeTaxonomy.ts` | `scoreCrossFamilyTypePenalty()` | 0.0–1.0 | Penalty for completely different family (0.92 = severe penalty) |
| `colorContradictionPenalty` | number | `src/lib/search/colorCanonical.ts` | Color contradiction detection | 0.0–1.0 | Applied when product color contradicts intent (0.74 = strong contradiction) |
| `blipColorConflictFactor` | number | `src/lib/search/searchHitRelevance.ts` | BLIP text analysis | 0.0–1.0 | Color conflict detected in caption (1.0 = no conflict) |
| `qualityModifier` | number | `src/lib/search/searchHitRelevance.ts` | Quality scoring | 0.0–1.0 | Quality multiplier for product data (0.9502) |

**Relationship**: These penalties are applied multiplicatively or as soft factors in `computeFinalRelevance01()`:
- `finalRelevance01 *= qualityModifier`
- Cross/intra-family penalties create soft factors: `crossFamilySoftFactor = Math.max(0.55, 1 - crossPen * 0.35)`

---

## SECTION 12: Tier Assignment Fields

| Field | Type | Source File | Computed By | Value Range | Notes |
|-------|------|-------------|-------------|-------------|-------|
| `matchTier` | enum | `src/lib/search/matchTierAssignment.ts` | `assignTier()` | "exact"\|"strong"\|"related"\|"weak"\|"fallback"\|"blocked" | **Tier label** - determines sorting priority (strong tier here) |
| `tierReason` | string | `src/lib/search/matchTierAssignment.ts` | `assignTier()` | string | Human explanation for tier assignment |
| `tierScore` | number | `src/lib/search/matchTierAssignment.ts` | Tier-specific calculation | 0.0–1.0 | Tier base score before capping (0.78) |
| `tierCap` | number | `src/lib/search/matchTierAssignment.ts` | Tier definition | 0.0–1.0 | **Maximum allowed finalRelevance01 for this tier** (strong tier = 0.78 cap) |

**Relationship**:  
- `matchTier` determined by: family match + type equivalence + audience match  
- `tierCap` is tier-specific ceiling (exact: 0.94, strong: 0.78, related: 0.74, weak: 0.55, fallback: 0.40)  
- `finalRelevance01 = Math.min(finalRelevance01, tierCap)` → final relevance cannot exceed tier cap

**Tier Ranges**:
- **exact**: 0.86–0.96 (same family, type, compatible color)
- **strong**: 0.76–0.86 (same family + type, subtype/color mismatch)
- **related**: 0.62–0.76 (same family, different type)
- **weak**: 0.45–0.62 (same family, significantly different)
- **fallback**: 0.30–0.45 (uncertain metadata or weak visual)
- **blocked**: 0.00 (hard dropped)

---

## SECTION 13: Rerank & Relevance Scores

| Field | Type | Source File | Computed By | Value Range | Notes |
|-------|------|-------------|-------------|-------------|-------|
| `rerankScore` | number | `src/lib/ranker/searchReranker.ts` | ML reranker delta | -∞ to +∞ | Raw delta score for sorting (negative = demotion) |
| `mlRerankScore` | number | `src/lib/ranker/searchReranker.ts` | ML model inference | 0.0–1.0 | **ML confidence score** from reranker model (0.8196 = high confidence) |
| `finalRelevance01` | number | `src/lib/search/searchHitRelevance.ts` | `computeFinalRelevance01()` | 0.0–1.0 | **PRIMARY RANKING SIGNAL** - final 0..1 relevance score for sorting |
| `oldCalibratedFinalRelevance01` | number | `src/lib/search/searchHitRelevance.ts` | Legacy calibration | 0.0–1.0 | Pre-PHASE-4 relevance score for A/B testing (0.677) |
| `finalRelevanceSource` | string | `src/lib/search/searchHitRelevance.ts` | Source tracking | string | Authority that computed final relevance ("footwear_legacy_visual_first") |

**Computation Flow**:
```
clipCosine (0.86)
    ↓
similarity_score (0.86)
    ↓
computeWeightedImageScore() [for image search]
    ↓
typeScore (0.0), colorScore (0.0), audienceScore (1.0), etc.
    ↓
Apply penalties (crossFamilyPenalty, intraFamilyPenalty, etc.)
    ↓
computeFinalRelevance01()
    ↓
Apply tierCap (0.78)
    ↓
finalRelevance01 = 0.8351999999999999
    ↓
mlRerankScore (from ML model)
    ↓
FINAL RANKING
```

---

## SECTION 14: Intent & Query Understanding Fields

| Field | Type | Source File | Computed By | Value Range | Notes |
|-------|------|-------------|-------------|-------------|-------|
| `hasTypeIntent` | boolean | `src/lib/search/fashionIntent.ts` | Intent parser | true\|false | User explicitly searched for a type |
| `hasColorIntent` | boolean | `src/lib/search/fashionIntent.ts` | Intent parser | true\|false | User mentioned color in query |
| `hasStyleIntent` | boolean | `src/lib/search/fashionIntent.ts` | Intent parser | true\|false | User mentioned style (casual, formal, etc.) |
| `hasSleeveIntent` | boolean | `src/lib/search/fashionIntent.ts` | Intent parser | true\|false | User specified sleeve length |
| `hasLengthIntent` | boolean | `src/lib/search/fashionIntent.ts` | Intent parser | true\|false | User specified length (for pants/dresses) |
| `hasAudienceIntent` | boolean | `src/lib/search/fashionIntent.ts` | Intent parser | true\|false | User specified gender/audience |
| `desiredProductTypes` | string[] | `src/lib/search/fashionIntent.ts` | Intent expansion | array | Expanded list of product types matching intent (50+ shoes types) |
| `desiredColors` | string[] | `src/lib/search/fashionIntent.ts` | Intent parser | array | Explicitly stated colors (empty in this case) |
| `desiredColorsExplicit` | string[] | `src/lib/search/fashionIntent.ts` | Intent parser | array | Normalized explicit colors |
| `desiredColorsEffective` | string[] | `src/lib/search/fashionIntent.ts` | Intent reconciliation | array | Final effective colors used for matching (["blue"]) |
| `colorIntentSource` | string | `src/lib/search/fashionIntent.ts` | Source tracking | "explicit"\|"inferred"\|"crop" | Where the color came from ("inferred") |
| `desiredStyle` | string | `src/lib/search/fashionIntent.ts` | Intent parser | string | Desired style ("casual") |
| `colorMode` | string | `src/lib/search/fashionIntent.ts` | Intent parser | "exact"\|"family"\|"semantic"\|"any" | Color matching mode ("any") |
| `colorIntentGatesFinalRelevance` | boolean | `src/lib/search/searchHitRelevance.ts` | Gate logic | true\|false | Whether color mismatches gate final relevance (false = soft penalty only) |

---

## SECTION 15: Detection & Image Analysis Fields

| Field | Type | Source File | Computed By | Value Range | Notes |
|-------|------|-------------|-------------|-------------|-------|
| `imageMode` | string | `src/lib/search/fashionIntent.ts` | Detection | "worn_outfit"\|"product"\|"full_body"\|"partial_body" | Type of image uploaded |
| `intentFamily` | string | `src/lib/search/fashionIntent.ts` | YOLO detection | string | Family detected from image (footwear) |
| `intentType` | string | `src/lib/search/fashionIntent.ts` | YOLO detection | string | Type detected from image (shoes) |
| `intentSubtype` | string | `src/lib/search/fashionIntent.ts` | YOLO detection | string | Subtype detected (shoe) |
| `detectedLabel` | string | `src/lib/search/searchHitRelevance.ts` | YOLO model | string | Raw YOLO detection label (shoe) |
| `cropDominantTokens` | string[] | `src/lib/image/cropColorExtraction.ts` | Image crop analysis | array | Dominant colors extracted from crop (["navy", "charcoal", "gray"]) |
| `inferredTokens` | string[] | `src/lib/search/fashionIntent.ts` | Color inference | array | Inferred colors from context (["blue"]) |
| `inferredVsCropConflict` | boolean | `src/lib/search/fashionIntent.ts` | Conflict detection | true\|false | Whether inferred colors conflict with crop (false) |
| `inferredColorTrusted` | boolean | `src/lib/search/fashionIntent.ts` | Confidence | true\|false | Whether to trust inferred colors (true) |
| `inferredColorForcedForFootwear` | boolean | `src/lib/search/fashionIntent.ts` | Footwear logic | true\|false | Override crop colors with inferred for footwear (false) |

---

## SECTION 16: Relevance Intent Debug (Deep Scoring Breakdown)

| Field | Type | Location | Purpose | Value |
|-------|------|----------|---------|-------|
| `relevanceIntentDebug.style` | object | `explain` | Style intent info | `{ gatesFinalRelevance01: true, usedInCompositeRerank: true, softHint: "casual" }` |
| `relevanceIntentDebug.type` | object | `explain` | Type intent info | `{ reliableTypeIntent: false, detectionAnchored: true }` |
| `relevanceIntentDebug.color` | object | `explain` | Color intent breakdown | Full reconciliation logic, crop vs inferred, gate status |
| `relevanceIntentDebug.types` | object | `explain` | Expanded type list | `{ desiredProductTypes: [...] }` |

---

## SECTION 17: Main Path Admission (Guard Logic)

| Field | Type | Source File | Computed By | Value Range | Notes |
|-------|------|-------------|-------------|-------------|-------|
| `mainPathAdmission.admitted` | boolean | `src/lib/search/searchHitRelevance.ts` | Guard check | true\|false | Does product pass acceptance gates? (true) |
| `mainPathAdmission.admissionFloor` | number | `src/lib/search/searchHitRelevance.ts` | Gate calculation | 0.0–1.0 | Minimum score required to be admitted (0.5285) |
| `mainPathAdmission.typeMismatchCap` | number | `src/lib/search/searchHitRelevance.ts` | Type penalty | 0.0–1.0 | Cap applied due to type mismatch (0.74) |
| `mainPathAdmission.reason` | string | `src/lib/search/searchHitRelevance.ts` | Reason code | string | Why product was admitted ("main_path_visual_admission") |
| `mainPathAdmission.productFamily` | string | `src/lib/search/searchHitRelevance.ts` | Metadata | string | Product family for admission logic |
| `mainPathAdmission.structuralScore` | number | `src/lib/search/searchHitRelevance.ts` | Metadata quality | 0.0–1.0 | How complete product metadata is (1.0 = complete) |
| `mainPathAdmission.visualFloor` | number | `src/lib/search/searchHitRelevance.ts` | Visual threshold | 0.0–1.0 | Minimum visual similarity to be admitted (0.62) |
| `mainPathAdmission.penalties` | array | `src/lib/search/searchHitRelevance.ts` | Applied penalties | array | List of penalties applied during admission |

**Relationship**: If `mainPathAdmission.admitted=false`, product is filtered out before reaching user. Penalties contribute to `finalRelevance01` reduction.

---

## SECTION 18: Ranking Debug Breakdown

Located in `explain.rankingDebug`, this provides a step-by-step calculation:

| Field | Type | Meaning | Value | Formula |
|-------|------|---------|-------|---------|
| `id` | string | Product ID | "81192" | |
| `visualSimilarity` | number | Raw CLIP cosine | 0.86 | CLIP model output |
| `exactTypeScore` | number | Taxonomy exact match | 0.55 | Type hierarchy match |
| `typeScore` | number | **Final type for ranking** | 0.0 | Used in `computeFinalRelevance01()` |
| `colorScore` | number | **Final color for ranking** | 0.4 | Color compliance (often 0 if no intent) |
| `exactColorMatch` | boolean | Perfect color match? | false | product.color === intent.color |
| `sameColorFamily` | boolean | Same color family? | false | Color family match |
| `familyMismatch` | boolean | Cross-family products? | false | Different product family |
| `nearIdenticalVisual` | boolean | 0.92+ visual? | false | Could bypass metadata gates |
| `visualBase` | number | Visual component before penalties | 0.72 | |
| `attributeAgreement` | number | Avg attribute compliance | 0.0751 | (sum of compliances) / (count) |
| `familyGate` | number | Family pass through? | 1.0 | 0 = hard blocked |
| `contradictionPenalty` | number | Color contradiction applied? | 1.0 | 1.0 = no penalty |
| `qualityModifier` | number | Product quality multiplier | 0.9502 | Data completeness factor |
| `maxFinal` | number | Theoretical max final relevance | 0.995 | Soft cap |
| `matchLabel` | string | Deprecated tier label | "weak" | Use `matchTier` instead |
| `finalScore` | number | **Final relevance after all calc** | 0.8351999999999999 | This is `finalRelevance01` |
| `calibratedFinalScore` | number | Legacy calibrated score | 0.677 | Pre-PHASE4 calculation |
| `scoreAuthority` | string | Calculation method used | "main_path_visual_admission" | |
| `boosts` | array | Applied boosts | [] | Any multipliers that increased score |
| `penalties` | array | Applied penalties | [] | Any multipliers that decreased score |
| `footwearRankingMode` | string | Footwear-specific logic | "legacy_visual_first" | Visual similarity prioritized for footwear |

---

## SECTION 19: Debug Contract (Simplified Breakdown)

Minimal version of scoring for quick validation:

| Field | Type | Source | Value | Purpose |
|-------|------|--------|-------|---------|
| `debugContract.imageMode` | string | Detection | "worn_outfit" | Query image type |
| `debugContract.intentFamily` | string | Detection | "footwear" | Detected family |
| `debugContract.intentType` | string | Detection | "shoes" | Detected type |
| `debugContract.intentSubtype` | string | Detection | "shoe" | Detected subtype |
| `debugContract.productFamily` | string | Catalog | "unknown" | Product family (missing hydration?) |
| `debugContract.productType` | string | Catalog | "shoe" | Product type |
| `debugContract.productSubtype` | string | Catalog | null | Product subtype |
| `debugContract.productAudience` | string | Catalog | "men" | Product audience |
| `debugContract.guardPassed` | boolean | Gate check | true | Passed admission guard |
| `debugContract.guardReason` | string | Guard logic | "main_path_visual_admission" | Why guard passed |
| `debugContract.scoreBreakdown` | object | Summary | `{ visual: 0.86, type: 0.55, color: 0, ... }` | Component scores |

---

## SECTION 20: Content-Based Fields

| Field | Type | Source File | Computed By | Notes |
|-------|------|-------------|-------------|-------|
| `hardBlocked` | boolean | `src/lib/search/searchHitRelevance.ts` | Guard logic | true = product removed entirely |
| `taxonomyMatch` | number | `src/lib/search/productTypeTaxonomy.ts` | Taxonomy scoring | 0.0–1.0 - taxonomy hierarchy match |
| `blipAlignment` | number | `src/lib/search/searchHitRelevance.ts` | BLIP caption analysis | 0.0–1.0 - visual caption alignment |
| `keywordSubtypeBoost` | number | `src/lib/search/searchHitRelevance.ts` | Keyword matching | 0.0–1.0 - keyword overlap bonus |
| `keywordSubtypeOverlap` | number | `src/lib/search/searchHitRelevance.ts` | Keyword analysis | Count of matching keywords |
| `keywordSubtypeExactHit` | boolean | `src/lib/search/searchHitRelevance.ts` | Exact keyword match | true if exact keyword found |

---

## SECTION 21: Metadata Fields

| Field | Type | Source File | Computed By | Notes |
|-------|------|-------------|-------------|-------|
| `normalizedSubtype` | string | `src/lib/search/productNormalization.ts` | Product hydration | Subtype classification |
| `normalizedOccasion` | string | `src/lib/search/productNormalization.ts` | Product hydration | Occasion classification |
| `normalizedMaterial` | string | `src/lib/search/productNormalization.ts` | Product hydration | Material classification |
| `metadataCompliance` | number | `src/lib/search/searchHitRelevance.ts` | Metadata quality check | 0.0–1.0 - completeness score |

---

## KEY COMPUTATION FLOWS

### Flow 1: From Image to Rerank Score (High-Level)

```
Query Image (YOLO Detection)
    ↓
Extract intent: { family: "footwear", type: "shoes", color: "blue" }
    ↓
Retrieve candidates from kNN (CLIP embeddings) → similarity_score (0.86)
    ↓
Hydrate products (normalize colors, types, audiences)
    ↓
Assign tier (matchTier, tierCap)
    ↓
Calculate compliance scores:
  - typeScore: 0.0 (shoe matches shoe? no type gate)
  - colorScore: 0.0 (black ≠ blue intent)
  - audienceScore: 1.0 (men = men)
  - styleScore: varies
    ↓
computeFinalRelevance01({
  similarity_score,
  typeScore,
  colorScore,
  audienceScore,
  styleScore,
  crossFamilyPenalty,
  intraFamilyPenalty,
  ...
}) → 0.8351999999999999
    ↓
ML Reranker (if enabled) → mlRerankScore (0.8351...)
    ↓
SORT by: (matchTier DESC, finalRelevance01 DESC, similarity_score DESC)
```

### Flow 2: Color Compliance Path

```
Query: "blue shoes"
    ↓
Color intent extraction: desiredColorsEffective = ["blue"]
    ↓
Product color: "black"
    ↓
Color tier assignment: colorTier = "none" (no match)
    ↓
Compliance score: colorCompliance = 0.0
    ↓
IF hasColorIntent AND colorIntentGatesFinalRelevance:
  finalRelevance01 *= colorScore  → hard gate
ELSE:
  finalRelevance01 gets soft penalty
    ↓
Result: color mismatch reduces but doesn't eliminate ranking
```

### Flow 3: Type Compliance Path

```
Intent: { type: "shoes" }
    ↓
Product: { type: "shoe" }
    ↓
Type equivalence check: topTypeEquivalence() / footwearTypeEquivalence()
    ↓
exactTypeScore = 0.55 (not exact match in taxonomy)
    ↓
IF hasTypeIntent AND hasReliableTypeIntent:
  typeScore = HIGH (0.9+)
ELSE:
  typeScore = taxnomy result (0.55 or lower)
    ↓
IF crossPen >= 0.8 (cross-family mismatch):
  HARD BLOCK (finalRelevance01 = 0)
ELSE:
  Apply soft penalty: crossFamilySoftFactor = max(0.55, 1 - crossPen * 0.35)
```

---

## FIELD DEPENDENCIES & RELATIONSHIPS

### Tier System (Highest Priority)
```
matchTier → determines tierCap
tierCap → LIMITS finalRelevance01 
  ├─ exact tier: cap ≤ 0.94
  ├─ strong tier: cap ≤ 0.78
  ├─ related tier: cap ≤ 0.74
  ├─ weak tier: cap ≤ 0.55
  └─ fallback tier: cap ≤ 0.40
```

### Compliance Scores (Medium Priority)
```
similarity_score (0.86) 
  + typeScore (0.0)
  + colorScore (0.0)
  + audienceScore (1.0)
  + styleScore (varies)
  = inputs to computeFinalRelevance01()
```

### Penalties (Applied After Computation)
```
computeFinalRelevance01(...)
  × crossFamilySoftFactor
  × intraFamilySoftFactor
  × qualityModifier
  × categoryConsistencyMultiplier
  = bounded score
  ↓
  min(bounded, tierCap)
  = finalRelevance01
```

### ML Reranker (Applied Last)
```
finalRelevance01 (0.8351)
  ↓
ML reranker inference
  ↓
mlRerankScore (0.8351) [optionally different]
  ↓
FINAL SORT KEY: (matchTier, mlRerankScore DESC, similarity_score DESC)
```

---

## TYPICAL VALUES & RANGES BY SCENARIO

### Scenario 1: Perfect Match (Black Shoes Search → Black Shoes Result)
- `similarity_score`: 0.92+
- `colorCompliance`: 1.0
- `typeScore`: 0.95+
- `matchTier`: "exact"
- `tierCap`: 0.94
- `finalRelevance01`: 0.92–0.94

### Scenario 2: Visual Match, Color Mismatch (Blue Shoes Search → Black Shoes Result)
- `similarity_score`: 0.86
- `colorCompliance`: 0.0 (black ≠ blue)
- `typeScore`: 0.55–0.90
- `matchTier`: "strong"
- `tierCap`: 0.78
- `finalRelevance01`: 0.60–0.78 (reduced by color penalty)

### Scenario 3: Cross-Family (Shoes Search → Clothing Result)
- `similarity_score`: 0.75
- `crossFamilyPenalty`: 0.92
- `matchTier`: "related"
- `tierCap`: 0.74
- `finalRelevance01`: 0.10–0.40 (severely penalized; may be hard-blocked)

### Scenario 4: Footwear Legacy Mode (Image Search)
- `footwearRankingMode`: "legacy_visual_first"
- Visual similarity (0.86) dominates over metadata
- `finalRelevance01` stays closer to `similarity_score`
- Metadata gating is softer (soft bias, not hard gate)

---

## FILES BY CATEGORY

### Core Computation
- [src/lib/search/searchHitRelevance.ts](src/lib/search/searchHitRelevance.ts) - Main relevance scoring (`computeFinalRelevance01`)
- [src/lib/search/matchTierAssignment.ts](src/lib/search/matchTierAssignment.ts) - Tier assignment logic
- [src/lib/ranker/searchReranker.ts](src/lib/ranker/searchReranker.ts) - ML reranker orchestration

### Visual Similarity
- [src/lib/search/merchandiseVisualSimilarity.ts](src/lib/search/merchandiseVisualSimilarity.ts) - Visual score calculation
- [src/lib/image/imageReranker.ts](src/lib/image/imageReranker.ts) - Image-based reranking
- [src/lib/search/attentionFusion.ts](src/lib/search/attentionFusion.ts) - Multi-signal fusion

### Attributes & Compliance
- [src/lib/search/attributeReranker.ts](src/lib/search/attributeReranker.ts) - Attribute reranking
- [src/lib/search/attributeRelevanceGates.ts](src/lib/search/attributeRelevanceGates.ts) - Per-attribute gates
- [src/lib/search/attributeEmbeddings.ts](src/lib/search/attributeEmbeddings.ts) - Embedding similarities
- [src/lib/search/colorCanonical.ts](src/lib/color/colorCanonical.ts) - Color matching & compliance

### Product Type & Taxonomy
- [src/lib/search/productTypeTaxonomy.ts](src/lib/search/productTypeTaxonomy.ts) - Type scoring
- [src/lib/search/productNormalization.ts](src/lib/search/productNormalization.ts) - Product normalization

### Intent & Query Understanding
- [src/lib/search/fashionIntent.ts](src/lib/search/fashionIntent.ts) - Fashion intent extraction
- [src/lib/search/intentReconciliation.ts](src/lib/search/intentReconciliation.ts) - Intent reconciliation
- [src/lib/search/intentParser.ts](src/lib/search/intentParser.ts) - Intent parsing

### Detection & Image Analysis
- [src/lib/search/queryUnderstanding.service.ts](src/lib/search/queryUnderstanding.service.ts) - Query understanding
- [src/lib/image/cropColorExtraction.ts](src/lib/image/cropColorExtraction.ts) - Crop color analysis

### Search Orchestration
- [src/lib/search/searchOrchestrator.ts](src/lib/search/searchOrchestrator.ts) - Search pipeline
- [src/routes/search/search.service.ts](src/routes/search/search.service.ts) - Search service
- [src/lib/search/fashionSearchFacade.ts](src/lib/search/fashionSearchFacade.ts) - Search facade

---

## QUICK REFERENCE: WHAT AFFECTS FINAL RANKING?

**In Order of Impact:**

1. **Tier (Highest Impact)** → `matchTier` → `tierCap` ceiling
2. **Visual Similarity** → `similarity_score` / `clipCosine` (47% weight in image search)
3. **Color Compliance** → `colorScore` (27% weight if color intent exists)
4. **Type Match** → `typeScore` (10% weight)
5. **Cross-Family Penalty** → `crossFamilyPenalty` (hard blocks if ≥0.8)
6. **Intra-Family Penalty** → `intraFamilyPenalty` (soft penalizes wrong subtype)
7. **Category Match** → `categoryScore` (10% weight)
8. **ML Reranker** → `mlRerankScore` (final ordering if enabled)
9. **Quality** → `qualityModifier` (multiplicative, 0.95–1.0)

---

## EXAMPLE PRODUCT SCORING STEP-BY-STEP

For the UGG Clog (id: 81192) when searching for "blue shoes":

```
Step 1: Detect Intent
  Query: image of person wearing blue shoes
  YOLO: detects footwear → family: "footwear", type: "shoes", color: "navy"
  Color reconciliation: inferred color = "blue"
  
Step 2: Retrieve Candidates (kNN)
  CLIP cosine similarity: 0.86
  Top-200 footwear products retrieved

Step 3: Hydrate Product
  id: 81192
  normalizedType: "shoe"
  normalizedFamily: "footwear"
  normalizedColor: "black"
  normalizedAudience: "men"
  
Step 4: Assign Tier
  Match type equivalence: "shoe" ≈ "shoes" → high match
  Cross-family penalty: footwear ↔ footwear = 0 (no penalty)
  → matchTier: "strong" (type equivalent + family match)
  → tierCap: 0.78

Step 5: Calculate Compliances
  Type compliance: shoe → shoe, not exact → typeScore: 0.55 (not used; type gate = 0)
  Color compliance: black ≠ blue → colorScore: 0 (no match, hard gate applies)
  Audience compliance: men = men → audienceScore: 1.0
  Style compliance: no style intent → styleScore: 1.0 (neutral)

Step 6: Weighted Scoring (Image Search Formula)
  weighted = 0.47×0.86 + 0.10×1.0 + 0.10×0.55 + 0.27×0.0 + 0.03×1.0 + 0.03×1.0
  weighted = 0.4042 + 0.10 + 0.055 + 0 + 0.03 + 0.03
  weighted = 0.6192

Step 7: Apply Penalties
  crossFamilySoftFactor: 1.0 (no family mismatch)
  intraFamilySoftFactor: 1.0 (no subtype mismatch)
  qualityModifier: 0.9502 (product data quality)
  
  scored = 0.6192 × 1.0 × 1.0 × 0.9502 = 0.5885

Step 8: Apply Tier Cap
  finalRelevance01 = min(0.5885, 0.78) = 0.5885
  
  [BUT IN ACTUAL OUTPUT: 0.8351 — indicates footwear_legacy_visual_first mode]
  
Step 9: ML Reranker
  mlRerankScore: 0.8351999999999999 (ML confirms strong match)

Step 10: Sort
  Results sorted by: (matchTier DESC, mlRerankScore DESC, similarity_score DESC)
  This product ranks in TOP tier for footwear category
```

**Note**: Actual value of 0.8351 indicates the example product uses `footwear_legacy_visual_first` mode which heavily weights visual similarity over metadata, explaining why color mismatch doesn't kill the score.

