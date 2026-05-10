import { unifiedScorerScore } from "./sortResults";

type ProductLike = Record<string, unknown>;

export interface PublicSearchProductOptions {
  includeExplain?: boolean;
  includeScoreDebug?: boolean;
}

function finiteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function unifiedScoreDebug(explain: unknown, score: number): Record<string, unknown> {
  const unified = ((explain as any)?.unifiedScorer ?? {}) as Record<string, unknown>;
  const detail = ((unified as any).detail ?? {}) as Record<string, unknown>;
  return {
    score,
    components: detail.components ?? null,
    weights: detail.weights ?? null,
    base: finiteNumber(detail.base),
    caps: Array.isArray(detail.caps) ? detail.caps : [],
    effectiveCap: finiteNumber(detail.effectiveCap),
    floor: finiteNumber(detail.floor),
    floorReason: detail.floorReason ?? null,
    hardGate: detail.hardGate ?? null,
    matchLabel: detail.matchLabel ?? null,
  };
}

/**
 * Public search payloads expose the chosen unified score, and can optionally
 * keep `explain` for ranking-debug workflows.
 */
export function toPublicSearchProduct<T extends ProductLike>(product: T, options: PublicSearchProductOptions = {}): ProductLike {
  const { includeExplain = false, includeScoreDebug = false } = options;
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
  const unifiedScore = finiteNumber((explain as any)?.unifiedScorer?.score);
  const scoreDebug =
    includeScoreDebug && score !== null
      ? unifiedScore !== null
        ? unifiedScoreDebug(explain, unifiedScore)
        : { score }
      : undefined;
  const withExplain = includeExplain && explain !== undefined ? { ...publicProduct, explain } : publicProduct;
  const withScore = score === null ? withExplain : { ...withExplain, score };
  return scoreDebug ? { ...withScore, score_debug: scoreDebug } : withScore;
}

export function toPublicSearchProducts<T extends ProductLike>(products: T[] | undefined | null, options: PublicSearchProductOptions = {}): ProductLike[] {
  return Array.isArray(products) ? products.map((product) => toPublicSearchProduct(product, options)) : [];
}
