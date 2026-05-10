import { unifiedScorerScore } from "./sortResults";

type ProductLike = Record<string, unknown>;

export interface PublicSearchProductOptions {
  includeExplain?: boolean;
}

/**
 * Public search payloads expose the chosen unified score, and can optionally
 * keep `explain` for ranking-debug workflows.
 */
export function toPublicSearchProduct<T extends ProductLike>(product: T, options: PublicSearchProductOptions = {}): ProductLike {
  const { includeExplain = false } = options;
  const {
    explain,
    finalRelevance01: _finalRelevance01,
    rerankScore: _rerankScore,
    mlRerankScore: _mlRerankScore,
    clipSim: _clipSim,
    textSim: _textSim,
    openSearchScore: _openSearchScore,
    candidateScore: _candidateScore,
    similarity_score: _similarityScore,
    pHashDist: _pHashDist,
    textSearchRerankScore: _textSearchRerankScore,
    rerankBreakdown: _rerankBreakdown,
    attributeScores: _attributeScores,
    relevanceFallbackPreserved: _relevanceFallbackPreserved,
    score: _score,
    ...publicProduct
  } = product;

  const score = unifiedScorerScore(product);
  const withExplain = includeExplain && explain !== undefined ? { ...publicProduct, explain } : publicProduct;
  return score === null ? withExplain : { ...withExplain, score };
}

export function toPublicSearchProducts<T extends ProductLike>(products: T[] | undefined | null, options: PublicSearchProductOptions = {}): ProductLike[] {
  return Array.isArray(products) ? products.map((product) => toPublicSearchProduct(product, options)) : [];
}
