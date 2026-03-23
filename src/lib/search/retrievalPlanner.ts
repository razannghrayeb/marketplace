/**
 * Maps search mode + embeddings + intent into concrete per-field kNN plans.
 */

import type { SemanticAttribute, AttributeEmbedding, SearchFilters } from "./multiVectorSearch";
import { opensearchFieldForSemanticAttribute } from "./opensearchVectorFields";
import type { RetrievalPlan, RerankConfig, VectorQueryPlan } from "./searchTypes";

const DEFAULT_RERANK: RerankConfig = {
  vectorWeight: 0.6,
  attributeWeight: 0.3,
  priceWeight: 0.1,
  recencyWeight: 0,
  explainMode: false,
};

function planQueriesFromEmbeddings(
  embeddings: AttributeEmbedding[],
  baseK: number,
  candidateMultiplier: number,
  minK: number,
): VectorQueryPlan[] {
  const normalized = normalizeEmbeddingWeights(embeddings);
  return normalized.map((emb) => {
    const k = Math.max(
      minK,
      Math.ceil(baseK * (emb.weight * candidateMultiplier + 0.1)),
    );
    return {
      opensearchField: opensearchFieldForSemanticAttribute(emb.attribute),
      vector: emb.vector,
      k,
      attribute: emb.attribute,
      weight: emb.weight,
    };
  });
}

function normalizeEmbeddingWeights(embeddings: AttributeEmbedding[]): AttributeEmbedding[] {
  const total = embeddings.reduce((s, e) => s + e.weight, 0);
  if (total <= 0) return embeddings.map((e) => ({ ...e, weight: 1 / Math.max(1, embeddings.length) }));
  return embeddings.map((e) => ({ ...e, weight: e.weight / total }));
}

export function buildMultiVectorRetrievalPlan(params: {
  embeddings: AttributeEmbedding[];
  filters: SearchFilters;
  baseK?: number;
  candidateMultiplier?: number;
  minCandidatesPerAttribute?: number;
  explainScores?: boolean;
  rerank?: Partial<RerankConfig>;
}): RetrievalPlan {
  const {
    embeddings,
    filters,
    baseK = 100,
    candidateMultiplier = 2,
    minCandidatesPerAttribute = 20,
    explainScores = false,
    rerank,
  } = params;

  return {
    vectorQueries: planQueriesFromEmbeddings(
      embeddings,
      baseK,
      candidateMultiplier,
      minCandidatesPerAttribute,
    ),
    filters,
    rerankConfig: { ...DEFAULT_RERANK, ...rerank, explainMode: explainScores },
    explainMode: explainScores,
  };
}

export function buildSingleGlobalRetrievalPlan(params: {
  vector: number[];
  k: number;
  filters: SearchFilters;
}): RetrievalPlan {
  const { vector, k, filters } = params;
  const field = opensearchFieldForSemanticAttribute("global");
  return {
    vectorQueries: [
      {
        opensearchField: field,
        vector,
        k,
        attribute: "global",
        weight: 1,
      },
    ],
    filters,
    rerankConfig: { ...DEFAULT_RERANK, explainMode: false },
    explainMode: false,
  };
}

/** When an attribute embedding fails, drop it and renormalize remaining weights. */
export function dropFailedEmbeddings(embeddings: AttributeEmbedding[]): AttributeEmbedding[] {
  const ok = embeddings.filter((e) => Array.isArray(e.vector) && e.vector.length > 0);
  if (ok.length === 0) return [];
  const t = ok.reduce((s, e) => s + e.weight, 0);
  if (t <= 0) return ok.map((e) => ({ ...e, weight: 1 / ok.length }));
  return ok.map((e) => ({ ...e, weight: e.weight / t }));
}
