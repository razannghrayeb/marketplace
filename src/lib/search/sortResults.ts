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

function deterministicProductKey(product: SortableProduct): string {
  const id = String(product.id ?? "").trim();
  const url = String((product as any).product_url ?? "").trim().toLowerCase();
  const vendor = String((product as any).vendor_id ?? "").trim().toLowerCase();
  const title = String(product.title ?? "").trim().toLowerCase();
  return [id, vendor, url, title].join("|");
}

function compareDeterministicProductKey(a: SortableProduct, b: SortableProduct): number {
  const ka = deterministicProductKey(a);
  const kb = deterministicProductKey(b);
  if (ka < kb) return -1;
  if (ka > kb) return 1;
  return 0;
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
    const fa = typeof a.finalRelevance01 === "number" ? a.finalRelevance01 : 0;
    const fb = typeof b.finalRelevance01 === "number" ? b.finalRelevance01 : 0;
    if (Math.abs(fb - fa) > 1e-8) return fb - fa;

    // Tie-breaker: prioritize same color / color presence.
    const colorA = String(a.color ?? "").toLowerCase().trim();
    const colorB = String(b.color ?? "").toLowerCase().trim();
    if (colorA && colorB && colorA !== colorB) {
      return colorA.localeCompare(colorB);
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
      const scoreDelta = (scoreMap.get(String(b.id)) ?? 0) - (scoreMap.get(String(a.id)) ?? 0);
      if (Math.abs(scoreDelta) > 1e-8) return scoreDelta;
    }

    // Fallback: by similarity_score
    const simDelta = (b.similarity_score ?? 0) - (a.similarity_score ?? 0);
    if (Math.abs(simDelta) > 1e-8) return simDelta;

    // Deterministic tie-break for exact ties.
    return compareDeterministicProductKey(a, b);
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

    const simDelta = (b.similarity_score ?? 0) - (a.similarity_score ?? 0);
    if (Math.abs(simDelta) > 1e-8) return simDelta;

    return compareDeterministicProductKey(a, b);
  });
}
