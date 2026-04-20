/**
 * Multi-Vector Weighted Search
 * 
 * Implements parallel per-attribute kNN retrieval with weighted re-ranking.
 * Architecture: Run multiple kNN queries → Union candidates → Re-rank by weighted combination
 * 
 * @see docs/composite-query-system.md for architecture details
 */

import { osClient } from "../core/opensearch";
import { pg } from "../core/db";
import { config } from "../../config";

// ============================================================================
// Types & Interfaces
// ============================================================================

/**
 * Semantic attributes that can be searched independently
 */
export type SemanticAttribute = 
  | "global"     // Overall appearance/composition
  | "color"      // Color palette and tones
  | "texture"    // Surface texture and fabric
  | "material"   // Material type (denim, silk, leather, etc.)
  | "style"      // Style/aesthetic (vintage, modern, casual, etc.)
  | "pattern";   // Patterns (stripes, floral, solid, etc.)

/**
 * Embedding for a specific semantic attribute
 */
export interface AttributeEmbedding {
  attribute: SemanticAttribute;
  vector: number[];
  weight: number;  // Importance weight (0-1, sum to 1 across all attributes)
}

/**
 * Configuration for multi-vector search
 */
export interface MultiVectorSearchConfig {
  /** Per-attribute embeddings with weights */
  embeddings: AttributeEmbedding[];
  
  /** Base number of candidates to retrieve per attribute (before scaling) */
  baseK?: number;
  
  /** Multiplier for high-weight attributes (K_i = baseK * (weight * multiplier + epsilon)) */
  candidateMultiplier?: number;
  
  /** Minimum candidates per attribute (prevents zero candidates for low weights) */
  minCandidatesPerAttribute?: number;
  
  /** Maximum total candidates to process (performance cap) */
  maxTotalCandidates?: number;
  
  /** Filter constraints (category, price range, etc.) */
  filters?: SearchFilters;
  
  /** Final result size */
  size?: number;
  
  /** Whether to include per-attribute scores in result explanation */
  explainScores?: boolean;
}

/**
 * Search filter constraints
 */
export interface SearchFilters {
  categories?: string[];
  priceMin?: number;
  priceMax?: number;
  vendors?: string[];
  availability?: string[];
  gender?: string;
  brands?: string[];
  excludeHidden?: boolean;
}

/**
 * Candidate from a single attribute search
 */
interface AttributeCandidate {
  productId: string;
  attribute: SemanticAttribute;
  score: number;  // Cosine similarity from kNN
  rank: number;   // Rank within this attribute's results
}

/**
 * Unified candidate after merging
 */
interface UnifiedCandidate {
  productId: string;
  /** Per-attribute scores (sparse - only attributes that matched) */
  attributeScores: Partial<Record<SemanticAttribute, number>>;
  /** Weighted combined score */
  combinedScore: number;
  /** Metadata for explanation */
  ranks: Partial<Record<SemanticAttribute, number>>;
}

/**
 * Final search result with product data
 */
export interface MultiVectorSearchResult {
  productId: string;
  score: number;
  /** Breakdown of per-attribute contributions */
  scoreBreakdown?: {
    attribute: SemanticAttribute;
    weight: number;
    similarity: number;
    contribution: number;  // weight * similarity
  }[];
  /** Product metadata (hydrated from DB) */
  product?: {
    vendorId: string;
    title: string;
    brand?: string;
    category?: string;
    priceUsd: number;
    availability: string;
    imageCdn?: string;
    [key: string]: any;
  };
  /** Fusion / OS scores before downstream normalization (for rerank parity with composite path). */
  _rawScores?: { vectorScore: number; compositeScore?: number };
}

/**
 * Map batch scores to [0, 1] by top-hit max so multi-vector and composite fusion scales align for A/B.
 */
export function normalizeMultiVectorScoresToUnitRange(
  results: MultiVectorSearchResult[],
): MultiVectorSearchResult[] {
  if (results.length === 0) return results;
  const maxS = Math.max(...results.map((r) => r.score), 1e-12);
  return results.map((r) => ({
    ...r,
    _rawScores: { vectorScore: r.score },
    score: Math.max(0, Math.min(1, r.score / maxS)),
  }));
}

// ============================================================================
// Multi-Vector Search Engine
// ============================================================================

export class MultiVectorSearchEngine {
  private readonly indexName: string;
  private readonly defaultBaseK: number = 100;
  private readonly defaultCandidateMultiplier: number = 2.0;
  private readonly defaultMinCandidates: number = 20;
  private readonly defaultMaxCandidates: number = 1000;

  constructor(indexName?: string) {
    this.indexName = indexName || config.opensearch.index;
  }

  /**
   * Execute multi-vector weighted search
   */
  async search(searchConfig: MultiVectorSearchConfig): Promise<MultiVectorSearchResult[]> {
    const {
      embeddings,
      baseK = this.defaultBaseK,
      candidateMultiplier = this.defaultCandidateMultiplier,
      minCandidatesPerAttribute = this.defaultMinCandidates,
      maxTotalCandidates = this.defaultMaxCandidates,
      filters = {},
      size = 20,
      explainScores = false,
    } = searchConfig;

    // Validate and normalize weights
    const normalizedEmbeddings = this.normalizeWeights(embeddings);

    // Step 1: Run parallel per-attribute kNN searches
    const attributeCandidates = await this.fetchAttributeCandidates(
      normalizedEmbeddings,
      baseK,
      candidateMultiplier,
      minCandidatesPerAttribute,
      filters
    );

    // Step 2: Union and merge candidates
    const unifiedCandidates = this.unionAndScore(
      attributeCandidates,
      normalizedEmbeddings,
      maxTotalCandidates
    );

    // Step 3: Re-rank by combined score
    const rankedCandidates = unifiedCandidates
      .sort((a, b) => b.combinedScore - a.combinedScore)
      .slice(0, size);

    // Step 4: Hydrate with product data from PostgreSQL
    const results = await this.hydrateResults(
      rankedCandidates,
      normalizedEmbeddings,
      explainScores
    );

    return results;
  }

  /**
   * Normalize embedding weights to sum to 1
   */
  private normalizeWeights(embeddings: AttributeEmbedding[]): AttributeEmbedding[] {
    const totalWeight = embeddings.reduce((sum, emb) => sum + emb.weight, 0);
    
    if (totalWeight === 0) {
      throw new Error("Total embedding weight cannot be zero");
    }

    return embeddings.map(emb => ({
      ...emb,
      weight: emb.weight / totalWeight,
    }));
  }

  /**
   * Fetch candidates from each attribute in parallel
   */
  private async fetchAttributeCandidates(
    embeddings: AttributeEmbedding[],
    baseK: number,
    candidateMultiplier: number,
    minCandidates: number,
    filters: SearchFilters
  ): Promise<AttributeCandidate[]> {
    // Build filter query (shared across all attribute searches)
    const filterQuery = this.buildFilterQuery(filters);

    // Run parallel kNN searches for each attribute
    const searchPromises = embeddings.map(async (emb) => {
      // Scale K by weight: higher weight → more candidates
      const k = Math.max(
        minCandidates,
        Math.ceil(baseK * (emb.weight * candidateMultiplier + 0.1))
      );

      const fieldName = this.getEmbeddingFieldName(emb.attribute);

      try {
        const response = await osClient.search({
          index: this.indexName,
          body: {
            size: k,
            query: {
              bool: {
                must: [
                  {
                    knn: {
                      [fieldName]: {
                        vector: emb.vector,
                        k: k,
                      },
                    },
                  },
                ],
                filter: filterQuery,
              },
            },
            _source: ["product_id"],
          },
        });

        const hits = response.body.hits.hits;
        return hits.map((hit: any, index: number) => ({
          productId: hit._source.product_id,
          attribute: emb.attribute,
          score: hit._score || 0,
          rank: index + 1,
        })) as AttributeCandidate[];
      } catch (error) {
        console.error(`Error searching attribute ${emb.attribute}:`, error);
        return [] as AttributeCandidate[];
      }
    });

    const results = await Promise.all(searchPromises);
    return results.flat();
  }

  /**
   * Union candidates and compute weighted combined scores
   */
  private unionAndScore(
    attributeCandidates: AttributeCandidate[],
    embeddings: AttributeEmbedding[],
    maxCandidates: number
  ): UnifiedCandidate[] {
    // Group by product_id
    const candidateMap = new Map<string, UnifiedCandidate>();

    for (const candidate of attributeCandidates) {
      if (!candidateMap.has(candidate.productId)) {
        candidateMap.set(candidate.productId, {
          productId: candidate.productId,
          attributeScores: {},
          ranks: {},
          combinedScore: 0,
        });
      }

      const unified = candidateMap.get(candidate.productId)!;
      unified.attributeScores[candidate.attribute] = candidate.score;
      unified.ranks[candidate.attribute] = candidate.rank;
    }

    // Compute combined score for each candidate.
    //
    // OpenSearch cosinesimil (FAISS engine) returns scores in [0, 1] where
    // 1.0 = identical vectors.  No further normalization needed — using the
    // raw score preserves the full dynamic range for ranking.
    const weightMap = new Map(embeddings.map(e => [e.attribute, e.weight]));
    const numAttributes = embeddings.length;

    for (const unified of candidateMap.values()) {
      let combinedScore = 0;
      const matchedAttributes = Object.keys(unified.attributeScores).length;

      for (const [attr, score] of Object.entries(unified.attributeScores)) {
        const weight = weightMap.get(attr as SemanticAttribute) || 0;
        combinedScore += weight * score;
      }

      // Penalize candidates that only appeared in a subset of attribute
      // searches — they are likely partial matches.  A candidate that
      // matched 1/4 attributes gets its score multiplied by 0.625.
      if (matchedAttributes < numAttributes) {
        const coverage = matchedAttributes / numAttributes;
        const coveragePenalty = 0.5 + 0.5 * coverage;
        combinedScore *= coveragePenalty;
      }

      unified.combinedScore = combinedScore;
    }

    // Cap candidates and sort by score
    const unifiedArray = Array.from(candidateMap.values())
      .sort((a, b) => b.combinedScore - a.combinedScore)
      .slice(0, maxCandidates);

    return unifiedArray;
  }

  /**
   * Hydrate results with product data from PostgreSQL
   */
  private async hydrateResults(
    candidates: UnifiedCandidate[],
    embeddings: AttributeEmbedding[],
    explainScores: boolean
  ): Promise<MultiVectorSearchResult[]> {
    if (candidates.length === 0) {
      return [];
    }

    const productIds = candidates.map(c => c.productId);
    const numericIds = productIds.map(id => Number(id)).filter(id => !isNaN(id));

    // Batch fetch from DB
    // PG table uses `id` (not `product_id`) and `price_cents` (not `price_usd`)
    const query = `
      SELECT 
        p.id::text AS product_id,
        p.vendor_id::text AS vendor_id,
        p.title,
        p.brand,
        p.category,
        ROUND(p.price_cents / 100.0, 2) AS price_usd,
        CASE WHEN p.availability THEN 'in_stock' ELSE 'out_of_stock' END AS availability,
        COALESCE(p.image_cdn, p.image_url) AS image_cdn
      FROM products p
      WHERE p.id = ANY($1::bigint[])
    `;

    const dbResult = await pg.query(query, [numericIds]);
    const productMap = new Map(
      dbResult.rows.map((row: any) => [row.product_id, row])
    );

    // Merge candidate scores with product data
    const weightMap = new Map(embeddings.map(e => [e.attribute, e.weight]));

    return candidates.map(candidate => {
      const product = productMap.get(candidate.productId);

      const result: MultiVectorSearchResult = {
        productId: candidate.productId,
        score: candidate.combinedScore,
        product: product ? {
          vendorId: product.vendor_id,
          title: product.title,
          brand: product.brand,
          category: product.category,
          priceUsd: parseFloat(product.price_usd),
          availability: product.availability,
          imageCdn: product.image_cdn,
        } : undefined,
      };

      if (explainScores) {
        result.scoreBreakdown = Object.entries(candidate.attributeScores).map(
          ([attr, similarity]) => {
            const weight = weightMap.get(attr as SemanticAttribute) || 0;
            return {
              attribute: attr as SemanticAttribute,
              weight,
              similarity,
              contribution: weight * similarity,
            };
          }
        );
      }

      return result;
    });
  }

  /**
   * Build OpenSearch filter query from constraints
   */
  private buildFilterQuery(filters: SearchFilters): any[] {
    const filterClauses: any[] = [];

    if (filters.excludeHidden !== false) {
      filterClauses.push({ bool: { must_not: [{ term: { is_hidden: true } }] } });
    }

    if (filters.categories && filters.categories.length > 0) {
      filterClauses.push({ terms: { category: filters.categories } });
    }

    if (filters.vendors && filters.vendors.length > 0) {
      filterClauses.push({ terms: { vendor_id: filters.vendors } });
    }

    if (filters.brands && filters.brands.length > 0) {
      filterClauses.push({ terms: { brand: filters.brands } });
    }

    if (filters.availability && filters.availability.length > 0) {
      filterClauses.push({ terms: { availability: filters.availability } });
    }

    if (filters.gender) {
      filterClauses.push({ term: { attr_gender: filters.gender } });
    }

    if (filters.priceMin !== undefined || filters.priceMax !== undefined) {
      const rangeClause: any = { range: { price_usd: {} } };
      if (filters.priceMin !== undefined) {
        rangeClause.range.price_usd.gte = filters.priceMin;
      }
      if (filters.priceMax !== undefined) {
        rangeClause.range.price_usd.lte = filters.priceMax;
      }
      filterClauses.push(rangeClause);
    }

    return filterClauses;
  }

  /**
   * Map semantic attribute to OpenSearch field name
   */
  private getEmbeddingFieldName(attribute: SemanticAttribute): string {
    const fieldMap: Record<SemanticAttribute, string> = {
      global: "embedding",  // Primary global embedding (existing field)
      color: "embedding_color",
      texture: "embedding_texture",
      material: "embedding_material",
      style: "embedding_style",
      pattern: "embedding_pattern",
    };

    return fieldMap[attribute];
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Compute cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error("Vectors must have same dimension");
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

/**
 * Normalize vector to unit length (L2 normalization)
 */
export function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  
  if (magnitude === 0) {
    return vector;
  }

  return vector.map(val => val / magnitude);
}

/**
 * Blend multiple embeddings with weights into a single vector
 * (Client-side merge for single-kNN fallback)
 */
export function blendEmbeddings(embeddings: AttributeEmbedding[]): number[] {
  if (embeddings.length === 0) {
    throw new Error("Cannot blend zero embeddings");
  }

  const dimension = embeddings[0].vector.length;
  const blended = new Array(dimension).fill(0);

  // Weighted sum
  for (const emb of embeddings) {
    for (let i = 0; i < dimension; i++) {
      blended[i] += emb.weight * emb.vector[i];
    }
  }

  // Normalize to unit length
  return normalizeVector(blended);
}
