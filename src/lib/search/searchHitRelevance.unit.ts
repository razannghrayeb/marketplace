/* Minimal declarations for test globals to satisfy static checks */
declare const describe: any;
declare const test: any;
declare const expect: any;

import { computeHitRelevance } from "./searchHitRelevance";
import { scoreCrossFamilyTypePenalty } from "./productTypeTaxonomy";

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

describe("scoreCrossFamilyTypePenalty - category fallback", () => {
  test("tops query vs empty product_types + footwear canonical still penalizes", () => {
    const p = scoreCrossFamilyTypePenalty(["shirt"], [], {
      categoryCanonical: "footwear",
      category: "athletic shoes",
    });
    expect(p).toBeGreaterThanOrEqual(0.8);
  });

  test("tops query vs shoes category string with no types still penalizes", () => {
    const p = scoreCrossFamilyTypePenalty(["tee"], [], {
      category: "Men's Running Shoes",
    });
    expect(p).toBeGreaterThanOrEqual(0.8);
  });
});

describe("computeHitRelevance - type intent reliability", () => {
  const footwearHit = {
    _source: {
      title: "Running Sneaker",
      category: "shoes",
      category_canonical: "footwear",
      product_types: ["sneaker", "shoes"],
      attr_sleeve: null,
    },
  } as any;

  test("weak inferred type hints do not hard-zero high visual matches", () => {
    const rel = computeHitRelevance(footwearHit, 0.92, {
      desiredProductTypes: ["dress"],
      desiredColors: [],
      desiredColorsTier: [],
      rerankColorMode: "any",
      mergedCategory: "dresses",
      astCategories: ["dresses"],
      hasAudienceIntent: false,
      crossFamilyPenaltyWeight: 420,
      tightSemanticCap: true,
      reliableTypeIntent: false,
    });

    expect(rel.crossFamilyPenalty).toBeGreaterThanOrEqual(0.8);
    expect(rel.finalRelevance01).toBeGreaterThan(0.45);
  });

  test("reliable type intent still enforces strict cross-family blocking", () => {
    const rel = computeHitRelevance(footwearHit, 0.92, {
      desiredProductTypes: ["dress"],
      desiredColors: [],
      desiredColorsTier: [],
      rerankColorMode: "any",
      mergedCategory: "dresses",
      astCategories: ["dresses"],
      hasAudienceIntent: false,
      crossFamilyPenaltyWeight: 420,
      tightSemanticCap: true,
      reliableTypeIntent: true,
    });

    expect(rel.crossFamilyPenalty).toBeGreaterThanOrEqual(0.8);
    expect(rel.finalRelevance01).toBeLessThan(0.2);
  });

  test("shirt intent vs footwear listing with missing product_types uses category penalty", () => {
    const hitNoTypes = {
      _source: {
        title: "Running Sneaker",
        category: "shoes",
        category_canonical: "footwear",
        product_types: [],
        attr_sleeve: null,
      },
    } as any;

    const rel = computeHitRelevance(hitNoTypes, 0.92, {
      desiredProductTypes: ["shirt", "tee"],
      desiredColors: [],
      desiredColorsTier: [],
      rerankColorMode: "any",
      mergedCategory: "tops",
      astCategories: ["tops"],
      hasAudienceIntent: false,
      crossFamilyPenaltyWeight: 420,
      tightSemanticCap: true,
      reliableTypeIntent: true,
    });

    expect(rel.crossFamilyPenalty).toBeGreaterThanOrEqual(0.8);
    expect(rel.finalRelevance01).toBeLessThan(0.2);
  });
});
