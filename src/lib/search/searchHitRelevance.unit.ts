/* Minimal declarations for test globals to satisfy static checks */
declare const describe: any;
declare const test: any;
declare const expect: any;

import { computeHitRelevance } from "./searchHitRelevance";

describe("computeHitRelevance - sleeve intent", () => {
  test("short-sleeve intent penalizes long-sleeve product", () => {
    const hit = {
      _source: {
        title: "Men Long Sleeve Shirt",
        category: "shirts",
        category_canonical: "tops",
        product_types: ["shirt"],
        attr_sleeve: "long-sleeve",
      },
    } as any;

    const rel = computeHitRelevance(hit, 0.86, {
      desiredProductTypes: ["tshirt", "tee"],
      desiredColors: [],
      desiredColorsTier: [],
      desiredStyle: "casual",
      desiredSleeve: "short",
      rerankColorMode: "any",
      mergedCategory: "tops",
      astCategories: ["tops"],
      hasAudienceIntent: false,
      crossFamilyPenaltyWeight: 420,
      tightSemanticCap: true,
    });

    expect(rel.sleeveCompliance).toBeLessThan(0.3);
    expect(rel.finalRelevance01).toBeLessThan(0.75);
  });

  test("matching sleeve intent boosts compliance", () => {
    const hit = {
      _source: {
        title: "Men Short Sleeve T-Shirt",
        category: "t-shirts",
        category_canonical: "tops",
        product_types: ["tshirt", "tee"],
        attr_sleeve: "short-sleeve",
      },
    } as any;

    const rel = computeHitRelevance(hit, 0.86, {
      desiredProductTypes: ["tshirt", "tee"],
      desiredColors: [],
      desiredColorsTier: [],
      desiredStyle: "casual",
      desiredSleeve: "short",
      rerankColorMode: "any",
      mergedCategory: "tops",
      astCategories: ["tops"],
      hasAudienceIntent: false,
      crossFamilyPenaltyWeight: 420,
      tightSemanticCap: true,
    });

    expect(rel.sleeveCompliance).toBe(1);
    expect(rel.finalRelevance01).toBeGreaterThan(0.75);
  });
});
