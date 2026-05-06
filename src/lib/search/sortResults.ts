/**
 * Centralized sorting logic for ProductResults
 * Sorts by: category → finalRelevance01 → color → styleCompliance → rerankScore → similarity
 */

export type SortableProduct = {
  id?: string | number;
  category?: string | null;
  color?: string | null;
  finalRelevance01?: number;
  explain?: {
    unifiedScorer?: {
      score?: number;
      [key: string]: any;
    };
    styleCompliance?: number;
    [key: string]: any;
  };
  rerankScore?: number;
  similarity_score?: number;
  [key: string]: any;
};

function primarySortScore(product: SortableProduct): number {
  const unified = Number(product.explain?.unifiedScorer?.score ?? NaN);
  if (Number.isFinite(unified)) return unified;
  const fallback = Number(product.finalRelevance01 ?? 0);
  return Number.isFinite(fallback) ? fallback : 0;
}

/**
 * Sort products by finalRelevance01 (descending), then tie-break by color, style,
 * rerank score, and similarity.
 */
export function sortProductsByRelevanceAndCategory<T extends SortableProduct>(
  products: T[],
  scoreMap?: Map<string, number>,
): T[] {
  return [...products].sort((a: any, b: any) => {
    // Primary sort: final relevance descending.
    const fa = primarySortScore(a);
    const fb = primarySortScore(b);
    if (Math.abs(fb - fa) > 1e-8) return fb - fa;

    // Tie-breaker: prioritize same color / color presence.
    const colorA = String(a.color ?? "").toLowerCase().trim();
    const colorB = String(b.color ?? "").toLowerCase().trim();
    if (colorA && colorB && colorA !== colorB) {
      // Both have colors and they differ - maintain existing order (stable sort)
      return 0;
    }
    if (colorA && !colorB) return -1; // a has color, b doesn't - a comes first
    if (!colorA && colorB) return 1; // b has color, a doesn't - b comes first

    // Next tie-breaker: style compliance.
    const styleA = a.explain?.styleCompliance ?? 0;
    const styleB = b.explain?.styleCompliance ?? 0;
    if (Math.abs(styleB - styleA) > 1e-8) return styleB - styleA;

    // Quinary sort: by rerankScore descending
    const ar = a.rerankScore ?? 0;
    const br = b.rerankScore ?? 0;
    if (br !== ar) return br - ar;

    // Final tie-breaker: by original OpenSearch score descending (if scoreMap provided)
    if (scoreMap) {
      return (scoreMap.get(String(b.id)) ?? 0) - (scoreMap.get(String(a.id)) ?? 0);
    }

    // Fallback: by similarity_score
    return (b.similarity_score ?? 0) - (a.similarity_score ?? 0);
  });
}

/**
 * Sort products by finalRelevance01 only (simple descending)
 */
export function sortProductsByFinalRelevance<T extends SortableProduct>(products: T[]): T[] {
  return [...products].sort((a: any, b: any) => {
    const fa = primarySortScore(a);
    const fb = primarySortScore(b);
    if (Math.abs(fb - fa) > 1e-6) return fb - fa;

    // Fallback tie-breaker
    const ar = a.rerankScore ?? 0;
    const br = b.rerankScore ?? 0;
    if (br !== ar) return br - ar;

    return (b.similarity_score ?? 0) - (a.similarity_score ?? 0);
  });
}
