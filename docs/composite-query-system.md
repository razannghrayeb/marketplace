# Composite Query Builder - Multi-Image Search System

## Overview

The Composite Query Builder enables sophisticated multi-image fashion search by:
1. **Parsing user intent** from multiple images + natural language
2. **Merging embeddings** with attribute-specific weights
3. **Extracting filters** from cross-image attribute references
4. **Generating hybrid queries** for OpenSearch + PostgreSQL
5. **Ranking results** with composite scoring

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   User Input Layer                           │
│  • Multiple images (up to 5)                                 │
│  • Text prompt: "color from first, texture from second"      │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              Intent Parser (Gemini)                          │
│  • Analyze each image → extract attributes                   │
│  • Parse cross-image references                              │
│  • Assign weights to each image/attribute                    │
│  Output: ParsedIntent                                        │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│           Composite Query Builder                            │
│  1. Generate CLIP embeddings for all images                  │
│  2. Merge embeddings:                                        │
│     • Global: E = Σ(w_i · e_i)                              │
│     • Per-attribute: E_attr = Σ(w_i,attr · e_i)             │
│     • Final: (1-α)·E_global + α·Σ(β_attr·E_attr)           │
│  3. Extract attribute filters from extractedValues           │
│  4. Parse constraints (price, category, brands)              │
│  Output: CompositeQuery                                      │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                Query Mapper                                  │
│  • Convert to OpenSearch kNN + filters                       │
│  • Generate SQL WHERE clauses                                │
│  • Configure hybrid scoring weights                          │
│  Output: SearchQueryBundle                                   │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│          Search Execution & Ranking                          │
│  1. OpenSearch: kNN with global embedding                    │
│  2. Apply filters (attribute, price, category)               │
│  3. Hydrate from PostgreSQL with SQL filters                 │
│  4. Composite scoring:                                       │
│     score = λ_vec·sim + λ_filter·match + λ_price·price     │
│  5. Return ranked results + explanation                      │
└─────────────────────────────────────────────────────────────┘
```

## Key Components

### 1. CompositeQueryBuilder
**File:** `src/lib/query/compositeQueryBuilder.ts`

**Responsibilities:**
- Merge image embeddings with intent weights
- Extract and normalize attribute filters
- Parse search constraints
- Generate explanations

**Key Method:**
```typescript
async buildQuery(
  intent: ParsedIntent,
  imageEmbeddings: number[][]
): Promise<CompositeQuery>
```

**Embedding Merge Formula:**
```
E_global = Σ(w_i · e_i)                    // Weighted average of all images
E_attr = Σ(w_i,attr · e_i)                 // Per-attribute embeddings
E_final = (1-α)·E_global + α·Σ(β_attr·E_attr)  // Blended result
```

Where:
- `w_i` = weight for image i (from intent parser)
- `e_i` = embedding vector for image i
- `α` = global blend factor (default 0.6)
- `β_attr` = boost factor for attribute (color=1.2, texture=1.1, etc.)

**Configuration:**
```typescript
const builder = new CompositeQueryBuilder({
  globalBlendFactor: 0.6,     // Favor global vs per-attribute
  attributeBoosts: {
    color: 1.2,               // Boost color matching
    texture: 1.1,
    material: 1.1,
    silhouette: 1.0,
  },
  normalizeWeights: true,     // Normalize to unit vectors
});
```

### 2. QueryMapper
**File:** `src/lib/query/queryMapper.ts`

**Responsibilities:**
- Convert CompositeQuery → OpenSearch DSL
- Generate SQL filters for PostgreSQL
- Configure hybrid scoring weights

**Key Method:**
```typescript
mapQuery(
  compositeQuery: CompositeQuery,
  options?: {
    maxResults?: number;
    vectorWeight?: number;
    filterWeight?: number;
    priceWeight?: number;
  }
): SearchQueryBundle
```

**OpenSearch Query Structure:**
```json
{
  "query": {
    "bool": {
      "must": [...],           // mustHave terms
      "should": [...],         // fuzzy attribute matches
      "filter": [...],         // exact filters + constraints
      "must_not": [...]        // mustNotHave terms
    }
  },
  "knn": {
    "embedding": {
      "vector": [0.1, 0.2, ...],  // Global embedding
      "k": 100
    }
  }
}
```

**SQL Filter Mapping:**
```typescript
// Attribute → Column mapping
{
  color: "attributes->'color'",
  material: "attributes->'material'",
  category: "category",
  brand: "brand",
  price: "price"
}
```

### 3. Search Service Integration
**File:** `src/routes/search/search.service.ts`

**New Endpoint:**
```typescript
POST /search/multi-image
Content-Type: multipart/form-data

Fields:
- images: file[] (up to 5 images)
- prompt: string (e.g., "color from first, texture from second")
- limit: number (optional, default 50)
```

**Response:**
```typescript
{
  results: Product[],
  total: number,
  tookMs: number,
  explanation: string,      // "Image 0: color (50% weight) | Image 1: texture (50%)"
  compositeQuery?: CompositeQuery  // Full query details
}
```

**Example Usage:**
```bash
curl -X POST http://localhost:3000/search/multi-image \
  -F "images=@jacket1.jpg" \
  -F "images=@jacket2.jpg" \
  -F "prompt=I want the color of the first picture with the texture from the second" \
  -F "limit=20"
```

## Evaluation Framework

### Metrics
**File:** `src/lib/query/evaluation.ts`

**Available Metrics:**
- **NDCG** (Normalized Discounted Cumulative Gain): Primary ranking quality metric
- **MAP** (Mean Average Precision): Overall precision across ranks
- **MRR** (Mean Reciprocal Rank): First relevant result position
- **Precision@k**: Fraction of top-k results that are relevant
- **Recall@k**: Fraction of relevant items in top-k
- **Attribute Accuracy**: Match quality for color, material, silhouette, style

**Usage:**
```typescript
import { evaluateSearch, printEvaluationReport } from './evaluation';

const evaluation: SearchEvaluation = {
  queryId: 'q001',
  results: [...],  // Search results with productId, rank, score
  groundTruth: [...], // RelevanceJudgment[] with relevance scores
};

const metrics = evaluateSearch(evaluation);
console.log(printEvaluationReport(metrics));
```

**Output:**
```
=== Search Evaluation Report ===

Ranking Metrics:
  NDCG:           0.8523
  MAP:            0.7891
  MRR:            0.9200

Precision@k:
  P@1:  1.0000
  P@3:  0.8333
  P@5:  0.7600
  P@10: 0.6800

Recall@k:
  R@1:  0.1500
  R@3:  0.3750
  R@5:  0.5700
  R@10: 0.8100

Attribute Match Accuracy:
  Color:          0.8900
  Material:       0.8500
  Silhouette:     0.7800
  Style:          0.8200
  Overall:        0.8350

Confidence:       1.0000
================================
```

### Test Dataset
**File:** `src/lib/query/testDataset.ts`

**8 Curated Test Queries:**
1. Color from first, texture from second
2. Style from first, fit from second
3. Mix three attributes from different images
4. Price constraint with color preference
5. Negative constraint (NOT oversized)
6. Modifier: darker version
7. Brand preference with style mix
8. Equal weight: both images important

**Query Structure:**
```typescript
{
  id: 'q001',
  description: 'Color from first image, texture from second',
  images: ['test_images/burgundy_dress.jpg', 'test_images/leather_jacket.jpg'],
  userPrompt: 'I want the color of the first with texture from second',
  expectedIntent: {
    primaryAttributes: {
      0: ['color', 'colorTone'],
      1: ['texture', 'material'],
    },
    constraints: { mustHave: ['burgundy', 'leather'] },
  },
  groundTruth: {
    relevantProducts: [101, 102, 105],
    perfectMatches: [101],
    attributeMatches: { /* per-product scores */ },
  },
}
```

## Testing

### Unit Tests

**CompositeQueryBuilder Tests:**
```bash
npm test -- compositeQueryBuilder.test.ts
```

**QueryMapper Tests:**
```bash
npm test -- queryMapper.test.ts
```

**Key Test Cases:**
- Single image embedding merge
- Two images with equal weights
- Unequal weight distribution
- Attribute filter extraction
- Constraint parsing
- Edge cases (empty, unnormalized weights)

### Integration Tests

Run full evaluation on test dataset:
```typescript
import { testDataset } from './testDataset';
import { multiImageSearch } from '../routes/search/search.service';
import { evaluateSearch } from './evaluation';

for (const testQuery of testDataset) {
  const images = await loadTestImages(testQuery.images);
  const results = await multiImageSearch({
    images,
    userPrompt: testQuery.userPrompt,
  });
  
  const metrics = evaluateSearch({
    queryId: testQuery.id,
    results: results.results.map((r, idx) => ({
      productId: r.id,
      rank: idx,
      score: r.compositeScore,
    })),
    groundTruth: testQuery.groundTruth,
  });
  
  console.log(`Query ${testQuery.id}: NDCG=${metrics.ndcg.toFixed(4)}`);
}
```

## Configuration & Tuning

### Embedding Merge Weights
Adjust in `CompositeQueryBuilder` constructor:
```typescript
{
  globalBlendFactor: 0.6,     // ↑ = favor global, ↓ = favor per-attribute
  attributeBoosts: {
    color: 1.2,               // ↑ = prioritize color matching
    texture: 1.1,
    material: 1.1,
    silhouette: 1.0,
    style: 0.9,
    pattern: 0.8,
  }
}
```

### Hybrid Scoring Weights
Adjust in `QueryMapper.mapQuery()`:
```typescript
{
  vectorWeight: 0.6,    // ↑ = favor embedding similarity
  filterWeight: 0.3,    // ↑ = favor attribute match
  priceWeight: 0.1,     // ↑ = favor price attractiveness
}
```

### Tuning Strategy

1. **Baseline**: Run evaluation on test dataset with default settings
2. **Attribute Priority**: If color mismatches, increase `attributeBoosts.color`
3. **Global vs Specific**: If mixing attributes poorly, adjust `globalBlendFactor`
4. **Filter Strength**: If too many irrelevant results, increase `filterWeight`
5. **A/B Test**: Use `compareSearchSystems()` to validate improvements

**Tuning Grid Search:**
```typescript
const configs = [
  { globalBlend: 0.5, vectorWeight: 0.6 },
  { globalBlend: 0.6, vectorWeight: 0.6 },
  { globalBlend: 0.7, vectorWeight: 0.6 },
  { globalBlend: 0.6, vectorWeight: 0.5 },
  { globalBlend: 0.6, vectorWeight: 0.7 },
];

for (const config of configs) {
  const metrics = await evaluateWithConfig(config);
  console.log(`Config ${JSON.stringify(config)}: NDCG=${metrics.ndcg}`);
}
```

## Dependencies

**New:**
- `@google/generative-ai` - Gemini API for intent parsing (already installed)
- `multer` - File upload handling (install: `npm install multer @types/multer`)

**Existing:**
- OpenSearch client
- PostgreSQL pool
- CLIP embedding service

## Environment Variables

```bash
# Required for intent parsing
GEMINI_API_KEY=your_gemini_api_key

# Existing
DATABASE_URL=postgresql://...
OPENSEARCH_URL=https://...
```

## Performance Considerations

**Latency Breakdown:**
1. Image upload: ~100-500ms (depends on size/count)
2. Intent parsing (Gemini): ~1-3s for 2-3 images
3. Embedding generation (CLIP): ~200-500ms per image
4. OpenSearch query: ~100-500ms
5. PostgreSQL hydration: ~50-200ms
6. **Total: ~2-5s for typical query**

**Optimization Tips:**
- Cache embeddings for uploaded images (user session)
- Parallelize embedding generation: `Promise.all()`
- Pre-compute common attribute embeddings
- Use OpenSearch approximate kNN for faster results
- Implement result caching for identical queries

## Error Handling

**Graceful Degradation:**
1. **Intent parsing fails** → Use fallback regex-based parser
2. **Embedding generation fails** → Fall back to text search
3. **OpenSearch unavailable** → Direct PostgreSQL full-text search
4. **Invalid image** → Skip image, use remaining images
5. **No relevant results** → Relax filters progressively

## Future Enhancements

- [ ] Real-time feedback loop (user clicks → improve weights)
- [ ] Per-user personalization (learn attribute preferences)
- [ ] Temporal attributes (season, trend, occasion)
- [ ] Cross-category search (outfit composition)
- [ ] Visual similarity reranking with YOLOv8 detections
- [ ] Confidence thresholds for clarifying questions
- [ ] Multi-modal fusion (text + image + user history)

## License

MIT


