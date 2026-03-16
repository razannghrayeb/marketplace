# Multi-Vector Weighted Search

## Overview

The multi-vector weighted search system implements **Option B**: parallel per-attribute kNN retrieval with weighted re-ranking. This architecture enables fine-grained control over semantic attributes in visual search queries.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    User Query + Images                       │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              Intent Parser (Gemini)                          │
│  Extracts: attribute weights, cross-image refs, constraints  │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│         Attribute Embedding Generator                        │
│  Generates per-attribute embeddings: color, texture, style...│
└────────────────────────┬────────────────────────────────────┘
                         │
          ┌──────────────┼──────────────┐
          │              │              │
          ▼              ▼              ▼
   ┌──────────┐   ┌──────────┐   ┌──────────┐
   │ kNN      │   │ kNN      │   │ kNN      │
   │ color    │   │ texture  │   │ style    │
   │ K=120    │   │ K=80     │   │ K=100    │
   └──────────┘   └──────────┘   └──────────┘
          │              │              │
          └──────────────┼──────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│            Union Candidates (deduplicate)                    │
│            Compute weighted scores:                          │
│            score = Σ w_i × sim(q_i, doc_i)                  │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│            Re-rank by combined score                         │
│            Apply filters (price, category, etc.)             │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│            Return Top-N Results                              │
│            (with optional score breakdown)                   │
└─────────────────────────────────────────────────────────────┘
```

## Key Components

### 1. MultiVectorSearchEngine

Core search engine that orchestrates the multi-kNN pipeline.

**Key Methods:**
- `search(config)` - Execute full multi-vector search
- `fetchAttributeCandidates()` - Run parallel kNN queries
- `unionAndScore()` - Merge candidates with weighted scoring
- `hydrateResults()` - Fetch product data from PostgreSQL

### 2. AttributeEmbeddingGenerator

Generates attribute-specific embeddings using prompt engineering and CLIP.

**Key Methods:**
- `generateImageAttributeEmbedding(buffer, attribute)` - Per-attribute image embedding
- `generateTextAttributeEmbedding(text, attribute)` - Attribute-focused text embedding
- `generateAllAttributeEmbeddings(buffer)` - Bulk generation for ingestion

### 3. Semantic Attributes

```typescript
type SemanticAttribute = 
  | "global"     // Overall appearance
  | "color"      // Color palette
  | "texture"    // Surface texture
  | "material"   // Fabric material
  | "style"      // Fashion style
  | "pattern";   // Visual patterns
```

## Index Mapping

OpenSearch index now includes per-attribute vector fields:

```json
{
  "mappings": {
    "properties": {
      "embedding": { "type": "knn_vector", "dimension": 512 },
      "embedding_color": { "type": "knn_vector", "dimension": 512 },
      "embedding_texture": { "type": "knn_vector", "dimension": 512 },
      "embedding_material": { "type": "knn_vector", "dimension": 512 },
      "embedding_style": { "type": "knn_vector", "dimension": 512 },
      "embedding_pattern": { "type": "knn_vector", "dimension": 512 }
    }
  }
}
```

## API Endpoints

### POST /api/search/multi-vector

Advanced multi-vector weighted search with per-attribute control.

**Request:**
```bash
curl -X POST http://localhost:3000/api/search/multi-vector \
  -F "images=@dress1.jpg" \
  -F "images=@dress2.jpg" \
  -F "prompt=I want the color from the first image with the style from the second" \
  -F "attributeWeights={\"color\":0.6,\"style\":0.4}" \
  -F "explainScores=true" \
  -F "limit=20"
```

**Response:**
```json
{
  "results": [
    {
      "productId": "prod_123",
      "score": 0.87,
      "scoreBreakdown": [
        {
          "attribute": "color",
          "weight": 0.6,
          "similarity": 0.92,
          "contribution": 0.552
        },
        {
          "attribute": "style",
          "weight": 0.4,
          "similarity": 0.79,
          "contribution": 0.316
        }
      ],
      "product": {
        "vendorId": "vendor_456",
        "title": "Floral Summer Dress",
        "brand": "FashionCo",
        "category": "dresses",
        "priceUsd": 89.99,
        "availability": "in_stock",
        "imageCdn": "https://cdn.example.com/prod_123.jpg"
      }
    }
  ],
  "total": 147,
  "tookMs": 234
}
```

## Configuration

### Search Parameters

```typescript
interface MultiVectorSearchConfig {
  embeddings: AttributeEmbedding[];       // Per-attribute vectors + weights
  baseK?: number;                         // Base candidates per attribute (default: 100)
  candidateMultiplier?: number;           // Scale K by weight (default: 2.0)
  minCandidatesPerAttribute?: number;     // Min K per attribute (default: 20)
  maxTotalCandidates?: number;            // Performance cap (default: 1000)
  filters?: SearchFilters;                // Category, price, etc.
  size?: number;                          // Final result count (default: 20)
  explainScores?: boolean;                // Include score breakdown
}
```

### Weight Calculation

The candidate size for each attribute is scaled by its weight:

```
K_i = max(minCandidates, baseK × (w_i × multiplier + ε))
```

Example:
- baseK = 100, multiplier = 2.0, ε = 0.1
- Color weight = 0.6 → K_color = max(20, 100 × (0.6 × 2.0 + 0.1)) = 130
- Style weight = 0.4 → K_style = max(20, 100 × (0.4 × 2.0 + 0.1)) = 90

## Scoring Algorithm

### Combined Score Computation

For each candidate product:

```
combined_score = Σ w_i × normalize(sim_i)

where:
  w_i = normalized weight for attribute i
  sim_i = cosine similarity from kNN search
  normalize(s) = (s + 1) / 2  [maps [-1,1] to [0,1]]
```

### Score Normalization

- Cosine similarity returns values in [-1, 1]
- Normalized to [0, 1] for intuitive interpretation
- Weights sum to 1.0 across all attributes

## Performance Considerations

### Candidate Size Tuning

- **baseK**: Higher values increase recall but add latency
  - Recommended: 100-200 for production
- **candidateMultiplier**: Controls weight-based scaling
  - Recommended: 1.5-2.5
- **maxTotalCandidates**: Caps memory/compute
  - Recommended: 500-1500 depending on hardware

### Parallelization

All per-attribute kNN queries run in parallel via `Promise.all()`, significantly reducing latency compared to sequential execution.

### Index Size

Each per-attribute vector field adds ~2KB per product (512 dims × 4 bytes). For 1M products:
- Global: ~2GB
- 5 attributes: ~10GB total
- Use FAISS quantization to reduce by 4-8x

## Use Cases

### Cross-Image Attribute Search

"I want the color from this dress but the style from that one"

```typescript
await multiVectorWeightedSearch({
  images: [colorRef.jpg, styleRef.jpg],
  userPrompt: "color from first, style from second",
  attributeWeights: { color: 0.5, style: 0.5 },
});
```

### Attribute-Focused Search

"Find items with this exact texture, any color"

```typescript
await multiVectorWeightedSearch({
  images: [textureRef.jpg],
  userPrompt: "matching texture",
  attributeWeights: { texture: 1.0 },
});
```

### Multi-Attribute Blending

"Similar overall look but prioritize color match"

```typescript
await multiVectorWeightedSearch({
  images: [reference.jpg],
  userPrompt: "similar style, prioritize color",
  attributeWeights: { global: 0.3, color: 0.5, style: 0.2 },
});
```

## Testing

Run unit tests:

```bash
npm test src/lib/search/multiVectorSearch.test.ts
```

Integration tests (requires OpenSearch + DB):

```bash
npm test -- --testPathPattern=multiVectorSearch.test.ts --testNamePattern="Integration"
```

## Future Enhancements

1. **Attention-based attribute extraction**: Use vision transformers with attention masks to isolate per-attribute features
2. **Fine-tuned attribute models**: Train separate CLIP variants per attribute for better separation
3. **Dynamic weight tuning**: Learn optimal weights from user interaction data
4. **Approximate re-ranking**: Use FAISS index union + approximate scoring for ultra-low latency
5. **GPU acceleration**: Move embedding generation and similarity computation to GPU

## Migration Guide

To enable multi-vector search on an existing index:

1. **Update mapping** (requires reindex):
   ```bash
   npx tsx scripts/recreate-opensearch-index.ts
   ```

2. **Generate per-attribute embeddings**:
   ```bash
   npx tsx scripts/generate-attribute-embeddings.ts
   ```

3. **Update ingestion pipeline** to generate all embeddings during product ingest

4. **Test endpoint**:
   ```bash
   curl -X POST http://localhost:3000/api/search/multi-vector \
     -F "images=@test.jpg" \
     -F "prompt=test query"
   ```

## References

- CLIP: [Learning Transferable Visual Models From Natural Language Supervision](https://arxiv.org/abs/2103.00020)
- Fashion-CLIP: [Contrastive Language and Vision Learning of General Fashion Concepts](https://arxiv.org/abs/2210.15162)
- HNSW: [Efficient and robust approximate nearest neighbor search](https://arxiv.org/abs/1603.09320)
