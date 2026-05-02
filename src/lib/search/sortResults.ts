/**
 * Centralized sorting logic for ProductResults
 * Sorts by: category → finalRelevance01 → color → styleCompliance → rerankScore → similarity
 */

export type SortableProduct = {
  id?: string | number;
  category?: string | null;
  color?: string | null;
  finalRelevance01?: number;
  rerankScore?: number;
  similarity_score?: number;
  explain?: {
    styleCompliance?: number;
    [key: string]: any;
  };
  [key: string]: any;
};

/**
 * Sort products by category, then by finalRelevance01 (descending) within each category.
 * Tie-breakers prioritize: color presence → style compliance → rerankScore → similarity score
 */
export function sortProductsByRelevanceAndCategory<T extends SortableProduct>(
  products: T[],
  scoreMap?: Map<string, number>,
): T[] {
  return [...products].sort((a: any, b: any) => {
    // Primary sort: by category (null categories go to the end)
    const catA = String(a.category ?? "").toLowerCase().trim();
    const catB = String(b.category ?? "").toLowerCase().trim();

    if (catA !== catB) {
      // Categories without a name go to the end
      if (!catA) return 1;
      if (!catB) return -1;
      return catA.localeCompare(catB);
    }

    // Secondary sort: within same category, by finalRelevance01 descending
    const fa = typeof a.finalRelevance01 === "number" ? a.finalRelevance01 : 0;
    const fb = typeof b.finalRelevance01 === "number" ? b.finalRelevance01 : 0;
    if (Math.abs(fb - fa) > 1e-8) return fb - fa;

    // Tertiary tie-breaker: prioritize same color
    const colorA = String(a.color ?? "").toLowerCase().trim();
    const colorB = String(b.color ?? "").toLowerCase().trim();
    if (colorA && colorB && colorA !== colorB) {
      // Both have colors and they differ - maintain existing order (stable sort)
      return 0;
    }
    if (colorA && !colorB) return -1; // a has color, b doesn't - a comes first
    if (!colorA && colorB) return 1; // b has color, a doesn't - b comes first

    // Quaternary tie-breaker: prioritize same style (via explain.styleCompliance)
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
    const fa = a.finalRelevance01 ?? 0;
    const fb = b.finalRelevance01 ?? 0;
    if (Math.abs(fb - fa) > 1e-6) return fb - fa;

    // Fallback tie-breaker
    const ar = a.rerankScore ?? 0;
    const br = b.rerankScore ?? 0;
    if (br !== ar) return br - ar;

    return (b.similarity_score ?? 0) - (a.similarity_score ?? 0);
  });
}
