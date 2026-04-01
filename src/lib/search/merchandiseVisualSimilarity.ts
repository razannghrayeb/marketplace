/**
 * Catalog image similarity is not the same as raw CLIP cosine.
 *
 * Embedding space is continuous: neighbors often share lighting, palette, packaging, or
 * "product on white" layout without being substitutable SKUs. E‑commerce similarity should
 * couple geometry (cosine) with **indexed catalog semantics** (product_types, category aisles)
 * whenever those axes are known for the query.
 *
 * This module produces a single **merchandise similarity** in [0,1]:
 *   effective ≈ rawClip × typeFactor × categoryFactor
 *
 * When there are no product-type seeds and no structured category hints, effective === rawClip.
 */

export interface MerchandiseVisualSimilarityResult {
  /** Similarity after binding to catalog axes (API `similarity_score` when binding is on). */
  effective01: number;
  /** Raw CLIP/OpenSearch cosine in [0,1] (same as passed into relevance as `similarity`). */
  rawClip01: number;
  /** typeFactor × categoryFactor */
  alignmentFactor: number;
  typeFactor: number;
  categoryFactor: number;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

export function merchandiseVisualSimilarity01(inp: {
  rawClip01: number;
  productTypeCompliance: number;
  categoryRelevance01: number;
  /** BLIP/YOLO/filter-derived `desiredProductTypes` non-empty */
  hasProductTypeSeeds: boolean;
  /** Predicted aisles, AST categories, or merged filter category present */
  hasStructuredCategoryHints: boolean;
}): MerchandiseVisualSimilarityResult {
  const raw = clamp01(inp.rawClip01);

  if (!inp.hasProductTypeSeeds && !inp.hasStructuredCategoryHints) {
    return {
      effective01: raw,
      rawClip01: raw,
      alignmentFactor: 1,
      typeFactor: 1,
      categoryFactor: 1,
    };
  }

  let typeFactor = 1;
  if (inp.hasProductTypeSeeds) {
    const t = clamp01(inp.productTypeCompliance);
    // Sublinear: mediocre taxonomy agreement cannot read as "very similar" on the API.
    typeFactor = 0.18 + 0.82 * Math.pow(t, 1.08);
  }

  let categoryFactor = 1;
  if (inp.hasStructuredCategoryHints) {
    const c = clamp01(inp.categoryRelevance01);
    const cLift = Math.max(c, 0.05);
    categoryFactor = 0.22 + 0.78 * Math.pow(cLift, 0.85);
  }

  const alignmentFactor = typeFactor * categoryFactor;
  const effective01 = clamp01(raw * alignmentFactor);

  return { effective01, rawClip01: raw, alignmentFactor, typeFactor, categoryFactor };
}
