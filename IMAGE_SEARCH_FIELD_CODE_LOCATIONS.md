# Image Search Field - Code Location Reference

Quick lookup for where each field is defined, computed, and used in source code.

---

## Core Scoring Functions

### `computeFinalRelevance01()` - PRIMARY RANKING SCORER
**Location**: [src/lib/search/searchHitRelevance.ts](src/lib/search/searchHitRelevance.ts#L350)  
**Input Parameters**:
- `hasTypeIntent`, `hasReliableTypeIntent`, `typeScore`
- `catScore`, `semScore`, `lexScore`
- `colorScore`, `audScore`, `styleScore`, `patternScore`
- `sleeveScore`
- `hasColorIntent`, `hasStyleIntent`, `hasPatternIntent`, `hasSleeveIntent`, `hasAudienceIntent`
- `crossFamilyPenalty`, `intraFamilyPenalty`
- `tightSemanticCap` (true for image search)
- `audienceMismatchCap`

**Output**: `finalRelevance01` (0.0–1.0 bounded score)

**Key Logic**:
- If `tightSemanticCap=true` (image search): uses `computeWeightedImageScore()` with weighted sum
- If `tightSemanticCap=false` (text search): uses traditional multiplication approach
- Applies soft factors: `crossFamilySoftFactor`, `intraFamilySoftFactor`
- Applies hard gates: blocks if cross-family penalty ≥ 0.8 (unless tightSemanticCap)
- Applies tiered cap: `finalRelevance01 = min(finalRelevance01, tierCap)`

---

## Tier Assignment System

### `assignTier()` - TIER DETERMINATION
**Location**: [src/lib/search/matchTierAssignment.ts](src/lib/search/matchTierAssignment.ts)  
**Returns**: `{ tier, reason, tierCap }`

**Tier Caps** (hard limits for `finalRelevance01`):
- `exact`: 0.94 (same family + type + compatible color)
- `strong`: 0.78 (same family + type, but subtype/color mismatch)
- `related`: 0.74 (same family, different type)
- `weak`: 0.55 (same family, significantly different)
- `fallback`: 0.40 (uncertain metadata)
- `blocked`: 0.00 (hard dropped)

**Decision Logic**:
1. Check `normalizedFamily` + `normalizedType` equivalence
2. Apply type equivalence functions:
   - `topTypeEquivalence()` - tshirt/shirt variants
   - `bottomsTypeEquivalence()` - jeans/pants equivalence
   - `footwearTypeEquivalence()` - shoe family clustering
   - `outerwearTypeEquivalence()` - jacket/coat similarity
   - `dressTypeEquivalence()` - dress length variants
   - `bagTypeEquivalence()` - bag type families
   - `suitTypeEquivalence()` - formal wear equivalence
3. Check audience match
4. Return tier label + reason + cap

---

## Visual Similarity Scoring

### `getMerchandiseSimilarity()` - VISUAL MATCH
**Location**: [src/lib/search/merchandiseVisualSimilarity.ts](src/lib/search/merchandiseVisualSimilarity.ts)  
**Returns**: `number` (0.0–1.0)

**Inputs**:
- `similarity_score` from kNN CLIP embedding (raw cosine)
- Product metadata for weighting
- Visual diversity adjustments

**Output Fields**:
- `similarity_score` (raw)
- `clipCosine` (same as similarity_score, preserved in explain)
- `merchandiseSimilarity` (potentially adjusted)

---

### `computeWeightedImageScore()` - IMAGE SEARCH FORMULA
**Location**: [src/lib/search/searchHitRelevance.ts](src/lib/search/searchHitRelevance.ts#L230)  
**Formula**:
```
weighted = 0.47 × visual
         + 0.10 × category
         + 0.10 × type
         + 0.27 × color
         + 0.03 × style
         + 0.03 × pattern
```

**Weights Rationale**:
- Visual dominance (47%) prevents metadata from killing visually similar products
- Color is strong secondary signal (27%) → color-matched products rank clearly higher
- Type and category equally weighted (10% each)
- Style and pattern are weak signals (3% each)

---

## Attribute Compliance Scoring

### Color Compliance

**Source Fields**:
- `color` - Raw catalog color
- `normalizedColor` - Canonical color (e.g., "black")
- `colorEmbeddingSim` - Embedding similarity to intent color (0.778)

**Computation**: [src/lib/search/searchHitRelevance.ts](src/lib/search/searchHitRelevance.ts) + [src/lib/color/colorCanonical.ts](src/lib/color/colorCanonical.ts)  
**Function**: `tieredColorListCompliance()`  
**Output Fields**:
- `colorCompliance` (0.0–1.0) - **Primary input to finalRelevance01**
- `colorTier` ("exact", "shade", "bucket", "family", "none")
- `matchedColor` - Matched color for explanation
- `colorSimEffective` (0.35) - Effective similarity after reconciliation

**Tier Logic**:
- `exact`: product color = intent color → 1.0
- `shade`: same shade family → 0.85
- `bucket`: same color bucket (e.g., blues) → 0.55
- `family`: related colors (e.g., blue ↔ purple) → 0.4
- `none`: unrelated colors → 0.0

---

### Type Compliance

**Source Fields**:
- `normalizedType` - Canonical product type
- `desiredProductTypes` - Expanded intent types (50+ for shoes)

**Computation**: [src/lib/search/productTypeTaxonomy.ts](src/lib/search/productTypeTaxonomy.ts)  
**Functions**:
- `scoreRerankProductTypeBreakdown()` - Returns: `{ exactTypeScore, siblingClusterScore, parentHypernymScore }`
- `getTypeEquivalenceScore()` - Routes to family-specific equivalence functions

**Output Fields**:
- `exactTypeScore` (0.55) - Exact match in taxonomy
- `siblingClusterScore` (1.0) - Same cluster in tree
- `parentHypernymScore` (0.54) - Parent category match
- `productTypeCompliance` (0.55) - **Combined compliance**
- `typeScore` (0.0) - **Input to finalRelevance01** (0-weighted if no type gate)
- `semanticTypeScore` (0.55) - Semantic distance

---

### Style Compliance

**Location**: [src/lib/search/searchHitRelevance.ts](src/lib/search/searchHitRelevance.ts)  
**Inputs**:
- `hasStyleIntent` (true if user specified style like "casual")
- `desiredStyle` ("casual")
- `styleEmbeddingSim` (0.718)

**Output Fields**:
- `styleCompliance` (0.0–1.0)
- `styleScore` (0.0–1.0) - **Input to finalRelevance01**

---

### Audience Compliance

**Location**: [src/lib/search/searchHitRelevance.ts](src/lib/search/searchHitRelevance.ts)  
**Inputs**:
- `hasAudienceIntent`
- `normalizedAudience` ("men")
- Query audience from intent

**Output Fields**:
- `audienceCompliance` (1.0 if match, 0.0 if mismatch)
- `audScore` - **Input to finalRelevance01**

---

### Sleeve & Length Compliance

**Location**: [src/lib/search/searchHitRelevance.ts](src/lib/search/searchHitRelevance.ts)  
**Inputs**:
- `hasSleeveIntent` / `hasLengthIntent`
- Product sleeve/length attributes
- Intent sleeve/length preferences

**Output Fields**:
- `sleeveCompliance` (0.0–1.0)
- `lengthCompliance` (0.0–1.0)
- Input to `computeFinalRelevance01()`

---

## Penalty & Factor Calculation

### Cross-Family Penalty

**Location**: [src/lib/search/productTypeTaxonomy.ts](src/lib/search/productTypeTaxonomy.ts)  
**Function**: `scoreCrossFamilyTypePenalty()`  
**Output**: `crossFamilyPenalty` (0.0–1.0)

**Values**:
- 0.0: Same family (footwear ↔ footwear)
- 0.5–0.7: Related families (tops ↔ outerwear)
- 0.8–0.95: Very different families (shoes ↔ dresses)
- 1.0: Completely unrelated

**Applied As**:
```
IF crossFamilyPenalty >= 0.8 AND hasTypeIntent AND hasReliableTypeIntent:
  finalRelevance01 = 0 (hard block)
ELSE:
  crossFamilySoftFactor = max(0.55, 1 - crossFamilyPenalty * 0.35)
  finalRelevance01 *= crossFamilySoftFactor
```

---

### Intra-Family Penalty

**Location**: [src/lib/search/productTypeTaxonomy.ts](src/lib/search/productTypeTaxonomy.ts)  
**Function**: `scoreCrossFamilyTypePenalty()` (second return value)  
**Output**: `intraFamilyPenalty` (0.0–1.0)

**Values**:
- 0.0: Exact type match within family
- 0.3–0.5: Similar types (boots ↔ sandals both footwear)
- 0.7–0.9: Subtype mismatch (dress shoes ↔ sneakers)

**Applied As**:
```
intraFamilySoftFactor = max(0.25, 1 - intraFamilyPenalty * 0.95)  // image search
intraFamilySoftFactor = max(0.4, 1 - intraFamilyPenalty * 0.7)   // text search
finalRelevance01 *= intraFamilySoftFactor
```

---

### Quality Modifier

**Location**: [src/lib/search/searchHitRelevance.ts](src/lib/search/searchHitRelevance.ts)  
**Computed From**: Product data completeness

**Output**: `qualityModifier` (0.9–1.0)

**Applied As**:
```
finalRelevance01 = max(0, min(1, finalRelevance01 * qualityModifier))
```

---

## Intent & Query Understanding

### Fashion Intent Extraction

**Location**: [src/lib/search/fashionIntent.ts](src/lib/search/fashionIntent.ts)  
**Function**: `parseFashionIntent()`

**Output Fields** (all `boolean` or `string[]`):
- `hasTypeIntent` - User specified type
- `hasColorIntent` - User specified color
- `hasStyleIntent` - User specified style (casual, formal, etc.)
- `hasSleeveIntent` - User specified sleeve length
- `hasLengthIntent` - User specified length
- `hasAudienceIntent` - User specified gender/audience
- `hasPatternIntent` - User specified pattern
- `desiredProductTypes` - Expanded type list (50+ for shoes)
- `desiredColors` - Explicit colors from query
- `desiredColorsExplicit` - Normalized explicit colors
- `desiredColorsEffective` - Final colors used for matching
- `desiredStyle` - Style value ("casual")
- `colorIntentSource` - "explicit", "inferred", or "crop"
- `colorMode` - "exact", "family", "semantic", "any"
- `colorIntentGatesFinalRelevance` - Whether color mismatches hard-gate final relevance

---

### Intent Reconciliation

**Location**: [src/lib/search/intentReconciliation.ts](src/lib/search/intentReconciliation.ts)  
**Reconciles**:
- YOLO detection (from image)
- User explicit intent (if text search)
- Crop analysis (dominant colors)
- Query context

**Output Fields**:
- `cropDominantTokens` (["navy", "charcoal", "gray"])
- `inferredTokens` (["blue"])
- `inferredVsCropConflict` (false)
- `inferredColorTrusted` (true)
- `inferredColorForcedForFootwear` (false)

---

## Detection & Image Analysis

### YOLO Detection

**Location**: Query understanding pipeline  
**Output Fields**:
- `imageMode` - "worn_outfit", "product", "full_body", "partial_body"
- `intentFamily` - Detected family from image
- `intentType` - Detected type from image
- `intentSubtype` - Detected subtype from image
- `detectedLabel` - Raw YOLO output

---

### Crop Color Extraction

**Location**: [src/lib/image/cropColorExtraction.ts](src/lib/image/cropColorExtraction.ts)  
**Function**: Crop analysis from outfit image

**Output Fields**:
- `cropDominantTokens` - Most common colors in crop area

---

## Reranking

### ML Reranker

**Location**: [src/lib/ranker/searchReranker.ts](src/lib/ranker/searchReranker.ts)  
**Transport**: gRPC (configurable via `SEARCH_IMAGE_RERANK_TRANSPORT`)  
**Address**: `ONNX_GRPC_ADDRESS` (default: 127.0.0.1:50051)

**Input**: Product features extracted by [src/lib/ranker/features.ts](src/lib/ranker/features.ts)  
**Output Fields**:
- `rerankScore` - Raw ML delta (used for sorting)
- `mlRerankScore` - ML confidence (0.0–1.0)

**Configuration**:
- `SEARCH_IMAGE_ONNX_RERANK` (enabled=1, disabled=0)
- `SEARCH_IMAGE_RERANK_TOPK` (default: 200)
- `SEARCH_IMAGE_RERANK_TIMEOUT_MS` (default: 8000)

---

### Intent Reranker

**Location**: [src/lib/ranker/intentReranker.ts](src/lib/ranker/intentReranker.ts)  
**Purpose**: Re-rank candidates based on intent alignment

**Logic**:
- Boosts products matching intent (type, color, audience)
- Penalizes mismatches

---

## Debugging Fields

### Ranking Debug Breakdown

**Location**: `explain.rankingDebug` in response  
**Fields**:
- `visualSimilarity` (0.86) - Raw CLIP cosine
- `exactTypeScore` (0.55) - Taxonomy match
- `typeScore` (0.0) - Used in ranking
- `colorScore` (0.4) - Used in ranking
- `visualBase` (0.72) - Before penalties
- `attributeAgreement` (0.0751) - Avg compliance
- `familyGate` (1.0) - Pass through?
- `contradictionPenalty` (1.0) - Applied?
- `qualityModifier` (0.9502) - Data quality
- `maxFinal` (0.995) - Theoretical max
- `finalScore` (0.8351999999999999) - **Final output**
- `calibratedFinalScore` (0.677) - Legacy score
- `scoreAuthority` - Calculation method
- `footwearRankingMode` - Special logic for footwear

### Debug Contract

**Location**: `debugContract` in response  
**Purpose**: Simplified breakdown for validation

**Fields**:
- `imageMode`, `intentFamily`, `intentType`, `productFamily`, `productType`
- `guardPassed` - Admission gate result
- `scoreBreakdown` - Component scores

---

## Gate & Filter Functions

### Main Path Admission Guard

**Location**: [src/lib/search/searchHitRelevance.ts](src/lib/search/searchHitRelevance.ts)  
**Purpose**: Determine if product should be included in results

**Output Fields**:
- `mainPathAdmission.admitted` (true/false)
- `mainPathAdmission.admissionFloor` (0.5285) - Minimum score
- `mainPathAdmission.typeMismatchCap` (0.74) - Type penalty applied
- `mainPathAdmission.reason` - Why admitted/rejected
- `mainPathAdmission.visualFloor` (0.62) - Minimum visual similarity
- `mainPathAdmission.penalties` - List of applied penalties

**Logic**:
```
IF hasTypeIntent AND crossFamilyPenalty >= 0.8:
  admitted = false (hard block)
ELSE IF visualSimilarity < visualFloor:
  admitted = false (too weak visual)
ELSE:
  admitted = true
```

---

### Attribute Relevance Gates

**Location**: [src/lib/search/attributeRelevanceGates.ts](src/lib/search/attributeRelevanceGates.ts)  
**Function**: `evaluateAttributeRelevance()`  
**Purpose**: Per-attribute compliance evaluation

**Output**: `AttributeRelevanceResult` with per-attribute gate status

---

## Search Pipeline Integration

### Search Service

**Location**: [src/routes/search/search.service.ts](src/routes/search/search.service.ts)  
**Purpose**: Main search orchestration

**Calls**:
- `searchOrchestrator()` - Orchestrates retrieval
- `computeFinalRelevance01()` - Scores each hit
- `assignTier()` - Tier assignment
- `evaluateProductAttributeMatch()` - Attribute reranking

---

### Search Orchestrator

**Location**: [src/lib/search/searchOrchestrator.ts](src/lib/search/searchOrchestrator.ts)  
**Purpose**: Orchestrates search stages

**Stages**:
1. Query understanding
2. Retrieval (kNN + BM25)
3. Hydration
4. Relevance scoring
5. Tier assignment
6. Attribute reranking
7. Result filtering/sorting

---

### Fashion Search Facade

**Location**: [src/lib/search/fashionSearchFacade.ts](src/lib/search/fashionSearchFacade.ts)  
**Purpose**: High-level search API

**Filtering Logic**:
- Filters by `finalRelevance01` against threshold (default: 0.5)
- Enforces tier-based sorting
- Applies deduplication

---

## Configuration

### Environment Variables

**Reranking**:
- `SEARCH_IMAGE_EXACT_COSINE_RERANK` - Enable exact cosine rerank
- `SEARCH_IMAGE_CANDIDATE_RERANKER_ENABLED` - Enable candidate reranker
- `SEARCH_IMAGE_DIVERSITY_RERANK` - Enable diversity reranking
- `SEARCH_IMAGE_DETECTION_RERANK_CANDIDATE_CAP` - Max candidates for rerank (700)
- `SEARCH_IMAGE_RERANK_TRANSPORT` - gRPC or HTTP
- `SEARCH_IMAGE_ONNX_RERANK` - Enable ONNX reranker
- `SEARCH_IMAGE_RERANK_TOPK` - Top-K for reranking (200)
- `ONNX_API_URL` - Reranker endpoint
- `ONNX_GRPC_ADDRESS` - gRPC address
- `ONNX_RERANK_TIMEOUT_MS` - Timeout (8000)

**Search Thresholds**:
- `SEARCH_FINAL_ACCEPT_MIN_IMAGE` - Min final relevance for image search
- `SEARCH_FINAL_ACCEPT_MIN_TEXT` - Min final relevance for text search

---

## Related Utilities

### Normalization

**Location**: [src/lib/search/productNormalization.ts](src/lib/search/productNormalization.ts)  
**Purpose**: Normalize product metadata into canonical fields

**Output**:
- `normalizedFamily`
- `normalizedType`
- `normalizedSubtype`
- `normalizedColor`
- `normalizedAudience`
- `normalizedMaterial`
- `normalizedStyle`
- `normalizedOccasion`
- `normalizedSilhouette`

---

### Color Canonicalization

**Location**: [src/lib/color/colorCanonical.ts](src/lib/color/colorCanonical.ts)  
**Functions**:
- `canonicalizeFashionColorToken()` - Normalize color names
- `tieredColorListCompliance()` - Calculate color compliance
- `colorCompatibility()` - Check color pair compatibility

---

## Unit Tests

**Test Files**:
- [src/lib/search/searchHitRelevance.unit.ts](src/lib/search/searchHitRelevance.unit.ts) - Relevance scoring tests
- [src/lib/search/matchTierAssignment.unit.ts](src/lib/search/matchTierAssignment.unit.ts) - Tier assignment tests
- [src/lib/search/productTypeTaxonomy.unit.ts](src/lib/search/productTypeTaxonomy.unit.ts) - Type taxonomy tests
- [src/lib/ranker/intentReranker.unit.ts](src/lib/ranker/intentReranker.unit.ts) - Intent reranker tests

