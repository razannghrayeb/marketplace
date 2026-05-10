import { unifiedScorerScore } from "./sortResults";

type ProductLike = Record<string, unknown>;

type PublicSearchOptions = {
  includeExplain?: boolean;
  includeScoreDebug?: boolean;
};

/**
 * Public search payloads expose the chosen unified score, not the internal
 * relevance/debug fields used to build it.
 */
export function toPublicSearchProduct<T extends ProductLike>(product: T): ProductLike {
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
  return score === null ? publicProduct : { ...publicProduct, score };
}

export function toPublicSearchProducts<T extends ProductLike>(
  products: T[] | undefined | null,
  options: PublicSearchOptions = {},
): ProductLike[] {
  if (!Array.isArray(products)) return [];
  return products.map((product) => {
    const base = toPublicSearchProduct(product);
    if (!options.includeExplain && !options.includeScoreDebug) return base;

    const withDebug = base as ProductLike;
    if (options.includeExplain && "explain" in product) {
      withDebug.explain = (product as ProductLike).explain;
    }
    if (options.includeScoreDebug) {
      if ("finalRelevance01" in product) withDebug.finalRelevance01 = (product as ProductLike).finalRelevance01;
      if ("rerankScore" in product) withDebug.rerankScore = (product as ProductLike).rerankScore;
      if ("similarity_score" in product) withDebug.similarity_score = (product as ProductLike).similarity_score;
    }
    return withDebug;
  });
}
