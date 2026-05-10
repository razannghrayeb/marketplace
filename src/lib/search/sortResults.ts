/**
 * Centralized sorting logic for ProductResults
 * Sorts by: category → finalRelevance01 → explainable tie-breaks → rerankScore → similarity
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
  if (Number.isFinite(unified)) {
    return unified;
  }
  const fallback = Number(product.finalRelevance01 ?? 0);
  return Number.isFinite(fallback) ? fallback : 0;
}

export function unifiedScorerScore(product: unknown): number | null {
  const record = product as SortableProduct | null | undefined;
  const unified = Number(record?.explain?.unifiedScorer?.score ?? NaN);
  if (Number.isFinite(unified)) return unified;

  const exposedScore = Number(record?.score ?? NaN);
  return Number.isFinite(exposedScore) ? exposedScore : null;
}

export function explicitUnifiedScorerScore(product: unknown): number | null {
  const record = product as SortableProduct | null | undefined;
  const unified = Number(record?.explain?.unifiedScorer?.score ?? NaN);
  return Number.isFinite(unified) ? unified : null;
}

/**
 * Sort products by finalRelevance01 (descending), then tie-break by color, style,
 * rerank score, and similarity.
 */
export function sortProductsByRelevanceAndCategory<T extends SortableProduct>(
  products: T[],
  scoreMap?: Map<string, number>,
): T[] {
  const dbgUnified = String(process.env.SEARCH_IMAGE_DEBUG_UNIFIED ?? "").toLowerCase() === "1";
  
  return [...products].sort((a: any, b: any) => {
    // Primary sort: final relevance descending.
    const fa = primarySortScore(a);
    const fb = primarySortScore(b);
    
    if (dbgUnified && products.length <= 10) {
      const aUnified = a.explain?.unifiedScorer?.score;
      const aFinal = a.finalRelevance01;
      const bUnified = b.explain?.unifiedScorer?.score;
      const bFinal = b.finalRelevance01;
      if (Math.abs(fb - fa) > 1e-8) {
        console.warn('[sortResults] Primary sort:', {
          a_id: a.id,
          a_unified: aUnified,
          a_final: aFinal,
          a_score: fa,
          b_id: b.id,
          b_unified: bUnified,
          b_final: bFinal,
          b_score: fb,
          winner: fb > fa ? 'b' : 'a'
        });
      }
    }
    
    if (Math.abs(fb - fa) > 1e-8) return fb - fa;

    const sleeveA = Number(a.explain?.sleeveCompliance ?? 0);
    const sleeveB = Number(b.explain?.sleeveCompliance ?? 0);
    if (Math.abs(sleeveB - sleeveA) > 1e-8) return sleeveB - sleeveA;

    const colorCompA = Number(a.explain?.colorCompliance ?? 0);
    const colorCompB = Number(b.explain?.colorCompliance ?? 0);
    if (Math.abs(colorCompB - colorCompA) > 1e-8) return colorCompB - colorCompA;

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

    const typeA = Number(a.explain?.productTypeCompliance ?? 0);
    const typeB = Number(b.explain?.productTypeCompliance ?? 0);
    if (Math.abs(typeB - typeA) > 1e-8) return typeB - typeA;

    const sleeveA = Number(a.explain?.sleeveCompliance ?? 0);
    const sleeveB = Number(b.explain?.sleeveCompliance ?? 0);
    if (Math.abs(sleeveB - sleeveA) > 1e-8) return sleeveB - sleeveA;

    const colorCompA = Number(a.explain?.colorCompliance ?? 0);
    const colorCompB = Number(b.explain?.colorCompliance ?? 0);
    if (Math.abs(colorCompB - colorCompA) > 1e-8) return colorCompB - colorCompA;

    const styleA = Number(a.explain?.styleCompliance ?? 0);
    const styleB = Number(b.explain?.styleCompliance ?? 0);
    if (Math.abs(styleB - styleA) > 1e-8) return styleB - styleA;

    // Fallback tie-breaker
    const ar = a.rerankScore ?? 0;
    const br = b.rerankScore ?? 0;
    if (br !== ar) return br - ar;

    return (b.similarity_score ?? 0) - (a.similarity_score ?? 0);
  });
}

/**
 * Sort products strictly by `explain.unifiedScorer.score` descending.
 * Missing scores are placed after scored items and ties keep the original order.
 */
export function sortProductsByUnifiedScorer<T extends SortableProduct>(products: T[]): T[] {
  return [...products].sort((a: any, b: any) => {
    const aScore = unifiedScorerScore(a);
    const bScore = unifiedScorerScore(b);

    if (aScore === null && bScore === null) return 0;
    if (aScore === null) return 1;
    if (bScore === null) return -1;
    if (Math.abs(bScore - aScore) > 1e-8) return bScore - aScore;

    const sleeveA = Number(a.explain?.sleeveCompliance ?? 0);
    const sleeveB = Number(b.explain?.sleeveCompliance ?? 0);
    if (Math.abs(sleeveB - sleeveA) > 1e-8) return sleeveB - sleeveA;

    const colorA = Number(a.explain?.colorCompliance ?? 0);
    const colorB = Number(b.explain?.colorCompliance ?? 0);
    if (Math.abs(colorB - colorA) > 1e-8) return colorB - colorA;

    const rerankA = Number(a.rerankScore ?? 0);
    const rerankB = Number(b.rerankScore ?? 0);
    if (Math.abs(rerankB - rerankA) > 1e-8) return rerankB - rerankA;

    return Number(b.similarity_score ?? 0) - Number(a.similarity_score ?? 0);
  });
}
