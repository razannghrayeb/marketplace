import { unifiedScorerScore } from "./sortResults";

type ProductLike = Record<string, unknown>;

/**
 * Public search payloads expose the chosen unified score, not the internal
 * relevance/debug fields used to build it.
 */
export function toPublicSearchProduct<T extends ProductLike>(product: T): ProductLike {
  const {
    explain: _explain,
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
  return score === null ? publicProduct : { ...publicProduct, score };
}

export function toPublicSearchProducts<T extends ProductLike>(products: T[] | undefined | null): ProductLike[] {
  return Array.isArray(products) ? products.map((product) => toPublicSearchProduct(product)) : [];
}
