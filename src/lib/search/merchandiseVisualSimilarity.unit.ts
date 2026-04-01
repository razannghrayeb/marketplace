/* Minimal declarations for static checks in test runners */
declare const describe: any;
declare const test: any;
declare const expect: any;

import { merchandiseVisualSimilarity01 } from "./merchandiseVisualSimilarity";

describe("merchandiseVisualSimilarity01", () => {
  test("no seeds returns raw cosine", () => {
    const r = merchandiseVisualSimilarity01({
      rawClip01: 0.81,
      productTypeCompliance: 0,
      categoryRelevance01: 0,
      hasProductTypeSeeds: false,
      hasStructuredCategoryHints: false,
    });
    expect(r.effective01).toBe(0.81);
    expect(r.alignmentFactor).toBe(1);
  });

  test("low type + category alignment crushes spurious high CLIP", () => {
    const r = merchandiseVisualSimilarity01({
      rawClip01: 0.81,
      productTypeCompliance: 0.34,
      categoryRelevance01: 0,
      hasProductTypeSeeds: true,
      hasStructuredCategoryHints: true,
    });
    expect(r.effective01).toBeLessThan(0.35);
    expect(r.rawClip01).toBe(0.81);
  });
});
