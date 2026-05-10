import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { computeHitRelevance, scoreAudienceCompliance, type SearchHitRelevanceIntent } from "./searchHitRelevance";
import { scoreCrossFamilyTypePenalty } from "./productTypeTaxonomy";

function expect(actual: any) {
  return {
    toBe(expected: any) {
      assert.equal(actual, expected);
    },
    toBeGreaterThan(expected: number) {
      assert.ok(actual > expected, `${actual} is not greater than ${expected}`);
    },
    toBeGreaterThanOrEqual(expected: number) {
      assert.ok(actual >= expected, `${actual} is not greater than or equal to ${expected}`);
    },
    toBeLessThan(expected: number) {
      assert.ok(actual < expected, `${actual} is not less than ${expected}`);
    },
    not: {
      toBe(expected: any) {
        assert.notEqual(actual, expected);
      },
    },
  };
}

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

  test("keeps inferred short sleeve conservative when sleeve metadata is missing", () => {
    const hit = {
      _source: {
        title: "Men Core Tee",
        category: "T-Shirts",
        category_canonical: "tops",
        product_types: ["tee"],
        attr_sleeve: null,
      },
    } as any;

    const rel = computeHitRelevance(hit, 0.84, {
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

    expect(rel.sleeveCompliance).toBeGreaterThan(0.2);
    expect(rel.sleeveCompliance).toBeLessThan(0.4);
  });

  test("long-sleeve intent hard-penalizes explicit short-sleeve title without metadata", () => {
    const hit = {
      _source: {
        title: "Women Short Sleeve Top",
        category: "tops",
        category_canonical: "tops",
        product_types: ["top"],
        attr_sleeve: null,
      },
    } as any;

    const rel = computeHitRelevance(hit, 0.9, {
      desiredProductTypes: ["shirt", "top"],
      desiredColors: [],
      desiredColorsTier: [],
      desiredStyle: "casual",
      desiredSleeve: "long",
      rerankColorMode: "any",
      mergedCategory: "tops",
      astCategories: ["tops"],
      hasAudienceIntent: false,
      crossFamilyPenaltyWeight: 420,
      tightSemanticCap: true,
    });

    expect(rel.sleeveCompliance).toBe(0);
    expect(rel.finalRelevance01).toBeLessThan(0.72);
  });

  test("long-sleeve intent treats sweater defaults as weak without explicit sleeve metadata", () => {
    const hit = {
      _source: {
        title: "Wool Crewneck Sweater",
        category: "sweaters",
        category_canonical: "tops",
        product_types: ["sweater"],
        attr_sleeve: null,
      },
    } as any;

    const rel = computeHitRelevance(hit, 0.86, {
      desiredProductTypes: ["shirt", "top"],
      desiredColors: [],
      desiredColorsTier: [],
      desiredStyle: "casual",
      desiredSleeve: "long",
      rerankColorMode: "any",
      mergedCategory: "tops",
      astCategories: ["tops"],
      hasAudienceIntent: false,
      crossFamilyPenaltyWeight: 420,
      tightSemanticCap: true,
    });

    expect(rel.sleeveCompliance).toBeLessThan(0.52);
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

  test("suit query with formal-bottom expansion does not penalize suit category rows", () => {
    const p = scoreCrossFamilyTypePenalty(["suit", "pants", "trousers"], [], {
      categoryCanonical: "tailored",
      category: "Suits",
    });
    expect(p).toBeLessThan(0.3);
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

  test("uses catalog category labels as type evidence when product_types are sparse", () => {
    const rel = computeHitRelevance({
      _source: {
        title: "Soft Rib Long Sleeve",
        category: "Knit Tops",
        category_canonical: "tops",
        product_types: [],
      },
    } as any, 0.82, {
      desiredProductTypes: ["sweater"],
      desiredColors: [],
      desiredColorsTier: [],
      rerankColorMode: "any",
      mergedCategory: "tops",
      astCategories: ["tops"],
      hasAudienceIntent: false,
      crossFamilyPenaltyWeight: 420,
      reliableTypeIntent: true,
    });

    expect(rel.productTypeCompliance).toBeGreaterThan(0.6);
    expect(rel.catalogTypeEvidenceSource).toBe("category");
  });

  test("uses title and url as bounded type evidence without making url exact", () => {
    const titleRel = computeHitRelevance({
      _source: {
        title: "Classic Zip Jacket",
        category: "Outerwear",
        category_canonical: "outerwear",
        product_types: [],
      },
    } as any, 0.82, {
      desiredProductTypes: ["jacket"],
      desiredColors: [],
      desiredColorsTier: [],
      rerankColorMode: "any",
      mergedCategory: "outerwear",
      astCategories: ["outerwear"],
      hasAudienceIntent: false,
      crossFamilyPenaltyWeight: 420,
      reliableTypeIntent: true,
    });

    const urlRel = computeHitRelevance({
      _source: {
        title: "Classic Zip",
        category: "Misc",
        category_canonical: "misc",
        product_types: [],
        product_url: "https://example.test/products/classic-zip-jacket-black",
      },
    } as any, 0.82, {
      desiredProductTypes: ["jacket"],
      desiredColors: [],
      desiredColorsTier: [],
      rerankColorMode: "any",
      mergedCategory: "outerwear",
      astCategories: ["outerwear"],
      hasAudienceIntent: false,
      crossFamilyPenaltyWeight: 420,
      reliableTypeIntent: true,
    });

    expect(titleRel.productTypeCompliance).toBeGreaterThan(urlRel.productTypeCompliance);
    expect(urlRel.productTypeCompliance).toBeGreaterThan(0.3);
    expect(urlRel.catalogTypeEvidenceSource).toBe("url");
    expect(urlRel.exactTypeScore).toBeLessThan(1);
  });

  test("title evidence rescues long-sleeve tops when category metadata is sparse", () => {
    const rel = computeHitRelevance({
      _source: {
        title: "Ribbed Crewneck Long Sleeve Top",
        category: null,
        category_canonical: null,
        product_types: [],
      },
    } as any, 0.86, {
      desiredProductTypes: ["top", "long sleeve"],
      desiredColors: [],
      desiredColorsTier: [],
      desiredSleeve: "long",
      rerankColorMode: "any",
      mergedCategory: "tops",
      astCategories: ["tops"],
      hasAudienceIntent: false,
      crossFamilyPenaltyWeight: 420,
      reliableTypeIntent: true,
    });

    expect(rel.productTypeCompliance).toBeGreaterThan(0.55);
    expect(rel.sleeveCompliance).toBeGreaterThan(0.7);
    expect(rel.finalRelevance01).toBeGreaterThan(0.25);
    expect(rel.hardBlocked).toBe(false);
  });

  test("url/description evidence rescues outerwear when category is misleading", () => {
    const rel = computeHitRelevance({
      _source: {
        title: "Waterproof Layer",
        description: "Lightweight quilted raincoat for layering.",
        category: "Shoes",
        category_canonical: "footwear",
        product_types: [],
        product_url: "https://example.test/women/outerwear/quilted-raincoat",
      },
    } as any, 0.88, {
      desiredProductTypes: ["jacket", "raincoat"],
      desiredColors: [],
      desiredColorsTier: [],
      rerankColorMode: "any",
      mergedCategory: "outerwear",
      astCategories: ["outerwear"],
      hasAudienceIntent: false,
      crossFamilyPenaltyWeight: 420,
      reliableTypeIntent: true,
    });

    expect(rel.catalogTypeEvidenceSource === "description" || rel.catalogTypeEvidenceSource === "url").toBe(true);
    expect(rel.crossFamilyPenalty).toBeLessThan(0.8);
    expect(rel.finalRelevance01).toBeGreaterThan(0.2);
    expect(rel.hardBlocked).toBe(false);
  });

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

describe("computeHitRelevance - shorts intent", () => {
  const shortsIntent: SearchHitRelevanceIntent = {
    desiredProductTypes: ["shorts"],
    desiredColors: [],
    desiredColorsTier: [],
    rerankColorMode: "any",
    mergedCategory: "bottoms",
    astCategories: ["bottoms"],
    hasAudienceIntent: false,
    crossFamilyPenaltyWeight: 420,
    lexicalMatchQuery: "shorts",
    reliableTypeIntent: true,
  };

  test("generic shorts blocks swim catalog categories", () => {
    const rel = computeHitRelevance({
      _source: {
        title: "Classic Pull-On Shorts",
        category: "BOTTOM-SW",
        category_canonical: "swimwear",
        product_types: ["shorts"],
      },
    } as any, 0.88, shortsIntent);

    expect(rel.finalRelevance01).toBe(0);
    expect(rel.hardBlocked).toBe(true);
  });

  test("short-sleeve tops do not satisfy shorts intent", () => {
    const rel = computeHitRelevance({
      _source: {
        title: "Women Short Sleeve Top",
        category: "Short Sleeve",
        category_canonical: "tops",
        product_types: ["short"],
        attr_sleeve: "short-sleeve",
      },
    } as any, 0.88, shortsIntent);

    expect(rel.productTypeCompliance).toBeLessThan(0.3);
    expect(rel.finalRelevance01).toBeLessThan(0.05);
  });
});

describe("computeHitRelevance - suit composite intent", () => {
  test("formal-bottom expansion does not reject tailored suit listings", () => {
    const suitHit = {
      _source: {
        title: "Men Black Two Piece Suit",
        category: "Suits",
        category_canonical: "tailored",
        product_types: ["suit"],
        attr_gender: "men",
      },
    } as any;

    const rel = computeHitRelevance(suitHit, 0.86, {
      desiredProductTypes: ["suit", "pants", "trousers", "slacks"],
      desiredColors: [],
      desiredColorsTier: [],
      rerankColorMode: "any",
      mergedCategory: "tailored",
      astCategories: ["tailored"],
      hasAudienceIntent: false,
      crossFamilyPenaltyWeight: 420,
      tightSemanticCap: true,
      reliableTypeIntent: true,
    });

    expect(rel.productTypeCompliance).toBeGreaterThanOrEqual(1);
    expect(rel.finalRelevance01).toBeGreaterThan(0.3);
  });

  test("formal-bottom expansion keeps sparse suit category rows viable", () => {
    const sparseSuitHit = {
      _source: {
        title: "Men Black Suit",
        category: "Suits",
        category_canonical: "tailored",
        product_types: [],
        attr_gender: "men",
      },
    } as any;

    const rel = computeHitRelevance(sparseSuitHit, 0.86, {
      desiredProductTypes: ["suit", "pants", "trousers", "slacks"],
      desiredColors: [],
      desiredColorsTier: [],
      rerankColorMode: "any",
      mergedCategory: "tailored",
      astCategories: ["tailored"],
      hasAudienceIntent: false,
      crossFamilyPenaltyWeight: 420,
      tightSemanticCap: true,
      reliableTypeIntent: true,
    });

    expect(rel.crossFamilyPenalty).toBeLessThan(0.3);
    expect(rel.finalRelevance01).toBeGreaterThan(0.3);
  });

  test("suit composite intent still rejects unrelated footwear", () => {
    const shoeHit = {
      _source: {
        title: "Men Running Sneaker",
        category: "shoes",
        category_canonical: "footwear",
        product_types: ["sneaker", "shoes"],
        attr_gender: "men",
      },
    } as any;

    const rel = computeHitRelevance(shoeHit, 0.9, {
      desiredProductTypes: ["suit", "pants", "trousers", "slacks"],
      desiredColors: [],
      desiredColorsTier: [],
      rerankColorMode: "any",
      mergedCategory: "tailored",
      astCategories: ["tailored"],
      hasAudienceIntent: false,
      crossFamilyPenaltyWeight: 420,
      tightSemanticCap: true,
      reliableTypeIntent: true,
    });

    expect(rel.crossFamilyPenalty).toBeGreaterThanOrEqual(0.8);
    expect(rel.finalRelevance01).toBeLessThan(0.2);
  });
});

describe("computeHitRelevance - footwear family gating", () => {
  test("footwear intent accepts flat-style aliases in doc metadata", () => {
    const hit = {
      _source: {
        title: "Robin Blue Satin Flat",
        category: "Flats + Other",
        category_canonical: "footwear",
        product_types: ["flat"],
      },
    } as any;

    const rel = computeHitRelevance(hit, 0.91, {
      desiredProductTypes: ["shoe"],
      desiredColors: [],
      desiredColorsTier: [],
      rerankColorMode: "any",
      mergedCategory: "footwear",
      astCategories: ["footwear"],
      hasAudienceIntent: false,
      crossFamilyPenaltyWeight: 420,
      tightSemanticCap: true,
      reliableTypeIntent: true,
    });

    expect(rel.hardBlocked).toBe(false);
    expect(rel.finalRelevance01).toBeGreaterThan(0.1);
  });

  test("footwear color intent caps family-tier matches more tightly", () => {
    const hit = {
      _source: {
        title: "Navy Leather Pump",
        category: "shoes",
        category_canonical: "footwear",
        product_types: ["pump"],
        color: "navy",
      },
    } as any;

    const rel = computeHitRelevance(hit, 0.96, {
      desiredProductTypes: ["shoe"],
      desiredColors: ["blue"],
      desiredColorsTier: ["blue"],
      rerankColorMode: "any",
      mergedCategory: "footwear",
      astCategories: ["footwear"],
      hasAudienceIntent: false,
      crossFamilyPenaltyWeight: 420,
      tightSemanticCap: true,
      reliableTypeIntent: true,
    });

    expect(rel.colorTier === "exact").toBe(false);
    expect(rel.finalRelevance01).toBeLessThan(0.45);
  });
});

describe("computeHitRelevance - color typo normalization", () => {
  test("tops color intent caps mismatched color relevance", () => {
    const hit = {
      _source: {
        title: "Women Red Cotton Shirt",
        category: "shirts",
        category_canonical: "tops",
        product_types: ["shirt"],
        color: "red",
      },
    } as any;

    const rel = computeHitRelevance(hit, 0.92, {
      desiredProductTypes: ["shirt"],
      desiredColors: ["blue"],
      desiredColorsTier: ["blue"],
      rerankColorMode: "any",
      mergedCategory: "tops",
      astCategories: ["tops"],
      hasAudienceIntent: false,
      crossFamilyPenaltyWeight: 420,
      tightSemanticCap: true,
      reliableTypeIntent: true,
    });

    expect(rel.colorCompliance).toBeLessThan(0.2);
    expect(rel.finalRelevance01).toBeLessThan(0.2);
  });

  test("pink intent matches catalog color typo fuhsia", () => {
    const hit = {
      _source: {
        title: "Women Satin Slip Dress",
        category: "dresses",
        category_canonical: "dresses",
        product_types: ["dress"],
        color: "fuhsia",
      },
    } as any;

    const rel = computeHitRelevance(hit, 0.84, {
      desiredProductTypes: ["dress"],
      desiredColors: ["pink"],
      desiredColorsTier: ["pink"],
      rerankColorMode: "any",
      mergedCategory: "dresses",
      astCategories: ["dresses"],
      hasAudienceIntent: false,
      crossFamilyPenaltyWeight: 420,
      tightSemanticCap: true,
      reliableTypeIntent: true,
    });

    expect(rel.colorCompliance).toBeGreaterThan(0.7);
    expect(rel.colorTier === "exact" || rel.colorTier === "family").toBe(true);
  });

  test("pink intent matches color list typo fuschia", () => {
    const hit = {
      _source: {
        title: "Women Pleated Skirt",
        category: "skirts",
        category_canonical: "bottoms",
        product_types: ["skirt"],
        attr_colors: ["fuschia"],
      },
    } as any;

    const rel = computeHitRelevance(hit, 0.81, {
      desiredProductTypes: ["skirt"],
      desiredColors: ["pink"],
      desiredColorsTier: ["pink"],
      rerankColorMode: "any",
      mergedCategory: "bottoms",
      astCategories: ["bottoms"],
      hasAudienceIntent: false,
      crossFamilyPenaltyWeight: 420,
      tightSemanticCap: true,
      reliableTypeIntent: true,
    });

    expect(rel.colorCompliance).toBeGreaterThan(0.7);
    expect(rel.colorTier === "exact" || rel.colorTier === "family").toBe(true);
  });
});

describe("computeHitRelevance - image palette color authority", () => {
  const baseIntent: SearchHitRelevanceIntent = {
    desiredProductTypes: ["shirt"],
    desiredColors: ["white"],
    desiredColorsTier: ["white"],
    rerankColorMode: "any",
    mergedCategory: "tops",
    astCategories: ["tops"],
    hasAudienceIntent: false,
    crossFamilyPenaltyWeight: 420,
    tightSemanticCap: true,
    reliableTypeIntent: true,
  };

  test("does not treat a secondary image-palette white as authoritative exact color", () => {
    const hit = {
      _source: {
        title: "Women Printed Shirt",
        category: "shirts",
        category_canonical: "tops",
        product_types: ["shirt"],
        attr_colors_image: ["charcoal", "white", "off-white", "multicolor"],
        color_palette_canonical: ["charcoal", "white", "off-white", "multicolor"],
        color_confidence_image: 0.92,
        attr_color_source: "image",
      },
    } as any;

    const rel = computeHitRelevance(hit, 0.86, baseIntent);

    expect(rel.colorTier === "exact").toBe(false);
    expect(rel.colorCompliance).toBeLessThan(0.6);
  });

  test("keeps a primary off-white image palette as a strong white-family match", () => {
    const hit = {
      _source: {
        title: "Women Light Shirt",
        category: "shirts",
        category_canonical: "tops",
        product_types: ["shirt"],
        attr_colors_image: ["off-white", "silver", "white", "tan"],
        color_palette_canonical: ["off-white", "silver", "white", "tan"],
        color_confidence_image: 0.9,
        attr_color_source: "image",
      },
    } as any;

    const rel = computeHitRelevance(hit, 0.86, baseIntent);

    expect(rel.colorTier).toBe("family");
    expect(rel.matchedColor).toBe("off-white");
    expect(rel.colorCompliance).toBeGreaterThan(0.8);
  });

  test("keeps a primary white image palette as exact", () => {
    const hit = {
      _source: {
        title: "Women White Shirt",
        category: "shirts",
        category_canonical: "tops",
        product_types: ["shirt"],
        attr_colors_image: ["white", "silver", "off-white", "multicolor"],
        color_palette_canonical: ["white", "silver", "off-white", "multicolor"],
        color_confidence_image: 0.9,
        attr_color_source: "image",
      },
    } as any;

    const rel = computeHitRelevance(hit, 0.86, baseIntent);

    expect(rel.colorTier).toBe("exact");
    expect(rel.colorCompliance).toBe(1);
  });

  test("does not let title color override contradictory image palette", () => {
    const hit = {
      _source: {
        title: "Brown Leather Shoe",
        category: "shoes",
        category_canonical: "footwear",
        product_types: ["shoe"],
        attr_colors_text: ["brown"],
        attr_colors_image: ["charcoal", "black", "silver"],
        color_palette_canonical: ["charcoal", "black", "silver"],
        color_confidence_text: 0.55,
        color_confidence_image: 0.9,
      },
    } as any;

    const rel = computeHitRelevance(hit, 0.86, {
      ...baseIntent,
      desiredProductTypes: ["shoe"],
      desiredColors: ["brown"],
      desiredColorsTier: ["brown"],
      mergedCategory: "footwear",
      astCategories: ["footwear"],
    });

    expect(rel.colorTier).not.toBe("exact");
    expect(rel.colorCompliance).toBeLessThan(0.6);
  });

  test("does not treat mixed title color with secondary image match as exact", () => {
    const hit = {
      _source: {
        title: "Black White Sneaker",
        category: "shoes",
        category_canonical: "footwear",
        product_types: ["sneaker"],
        attr_colors_text: ["black", "white"],
        attr_colors_image: ["black", "white", "off-white"],
        color_palette_canonical: ["black", "white", "off-white"],
        color_confidence_text: 0.75,
        color_confidence_image: 0.9,
      },
    } as any;

    const rel = computeHitRelevance(hit, 0.86, {
      ...baseIntent,
      desiredProductTypes: ["sneaker"],
      desiredColors: ["white"],
      desiredColorsTier: ["white"],
      mergedCategory: "footwear",
      astCategories: ["footwear"],
    });

    expect(rel.colorTier).not.toBe("exact");
    expect(rel.colorCompliance).toBeLessThan(0.6);
    expect(rel.colorCompliance).toBeGreaterThan(0.3);
  });

  test("keeps mixed title color strong when primary image confirms desired color", () => {
    const hit = {
      _source: {
        title: "White Olive Sneaker",
        category: "shoes",
        category_canonical: "footwear",
        product_types: ["sneaker"],
        attr_colors_text: ["white", "olive"],
        attr_colors_image: ["white", "off-white", "olive"],
        color_palette_canonical: ["white", "off-white", "olive"],
        color_confidence_text: 0.75,
        color_confidence_image: 0.9,
      },
    } as any;

    const rel = computeHitRelevance(hit, 0.86, {
      ...baseIntent,
      desiredProductTypes: ["sneaker"],
      desiredColors: ["white"],
      desiredColorsTier: ["white"],
      mergedCategory: "footwear",
      astCategories: ["footwear"],
    });

    expect(rel.colorTier).toBe("family");
    expect(rel.colorCompliance).toBeGreaterThan(0.75);
    expect(rel.colorCompliance).toBeLessThan(0.9);
  });
});

describe("scoreAudienceCompliance - cue-based gender inference", () => {
  test("men query hard-penalizes a women department brand even when category is mislabeled men", () => {
    const hit = {
      _source: {
        title: "Long Sleeved Grey Buttoned Pullover",
        brand: "MOUSTACHE women",
        category: "men pullover",
        category_canonical: "tops",
        product_types: ["pullover"],
      },
    } as any;

    const compliance = scoreAudienceCompliance(undefined, "men", hit);
    expect(compliance).toBeLessThan(0.3);
  });

  test("explicit men search blocks women department hits before acceptance", () => {
    const hit = {
      _source: {
        title: "Long Sleeved Grey Buttoned Pullover",
        brand: "MOUSTACHE women",
        category: "men pullover",
        category_canonical: "tops",
        product_types: ["pullover"],
      },
    } as any;

    const rel = computeHitRelevance(hit, 0.95, {
      desiredProductTypes: ["pullover"],
      desiredColors: [],
      desiredColorsTier: [],
      rerankColorMode: "any",
      mergedCategory: "tops",
      astCategories: ["tops"],
      audienceGenderForScoring: "men",
      hasAudienceIntent: true,
      crossFamilyPenaltyWeight: 420,
      reliableTypeIntent: true,
    });

    expect(rel.audienceCompliance).toBeLessThan(0.3);
    expect(rel.finalRelevance01).toBe(0);
    expect(rel.hardBlocked).toBe(true);
  });

  test("women query is penalized by masculine style cues even without gender words", () => {
    const hit = {
      _source: {
        title: "Tailored Oxford Shirt",
        category: "shirts",
        category_canonical: "tops",
        product_types: ["shirt", "oxford"],
      },
    } as any;

    const compliance = scoreAudienceCompliance(undefined, "women", hit);
    expect(compliance).toBeLessThan(0.4);
  });

  test("men query is penalized by feminine style cues even without gender words", () => {
    const hit = {
      _source: {
        title: "Floral Blouse",
        category: "shirts",
        category_canonical: "tops",
        product_types: ["blouse"],
      },
    } as any;

    const compliance = scoreAudienceCompliance(undefined, "men", hit);
    expect(compliance).toBeLessThan(0.4);
  });
});
