import assert from "node:assert/strict";
import { describe, test } from "node:test";

function expect(actual: any) {
  return {
    toBe(expected: any) {
      assert.equal(actual, expected);
    },
    toEqual(expected: any) {
      assert.deepEqual(actual, expected);
    },
  };
}

import {
  getCategorySearchTerms,
  resolveCategoryTermsForOpensearch,
  inferCategoryCanonical,
} from "./categoryFilter";

describe("categoryFilter", () => {
  test("getCategorySearchTerms expands accessories", () => {
    const t = getCategorySearchTerms("accessories");
    expect(t.includes("bags")).toBe(true);
    expect(t.includes("belt")).toBe(true);
  });

  test("resolveCategoryTermsForOpensearch prefers vocabulary intersection", () => {
    const vocab = new Set(["bags", "tops"]);
    const r = resolveCategoryTermsForOpensearch("accessories", vocab);
    expect(r).toEqual(["bags"]);
  });

  test("resolveCategoryTermsForOpensearch falls back to aliases when vocab empty", () => {
    const vocab = new Set<string>();
    const r = resolveCategoryTermsForOpensearch("tops", vocab);
    expect(r.includes("tops")).toBe(true);
  });

  test("getCategorySearchTerms expands bags aliases", () => {
    const t = getCategorySearchTerms("bags");
    expect(t.includes("handbag")).toBe(true);
    expect(t.includes("wallet")).toBe(true);
    expect(t.includes("pouches")).toBe(true);
    expect(t.includes("crossbody bags")).toBe(true);
    expect(t.includes("card holders")).toBe(true);
  });

  test("getCategorySearchTerms expands tailored aliases", () => {
    const t = getCategorySearchTerms("tailored");
    expect(t.includes("suit")).toBe(true);
    expect(t.includes("waistcoat")).toBe(true);
  });

  test("getCategorySearchTerms includes catalog outerwear layer buckets", () => {
    const t = getCategorySearchTerms("outerwear");
    expect(t.includes("fleece")).toBe(true);
    expect(t.includes("blouson")).toBe(true);
    expect(t.includes("outerwear & jackets")).toBe(true);
    expect(t.includes("coats & jackets")).toBe(true);
    expect(t.includes("parkas & blousons")).toBe(true);
    expect(t.includes("puffer jacket")).toBe(true);
    expect(t.includes("rain jacket")).toBe(true);
  });

  test("getCategorySearchTerms includes observed catalog top buckets", () => {
    const t = getCategorySearchTerms("tops");
    expect(t.includes("knit tops")).toBe(true);
    expect(t.includes("woven tops")).toBe(true);
    expect(t.includes("shirting")).toBe(true);
    expect(t.includes("polo short sleeve")).toBe(true);
    expect(t.includes("hoody")).toBe(true);
    expect(t.includes("body")).toBe(true);
  });

  test("inferCategoryCanonical maps vendor label to aisle", () => {
    expect(inferCategoryCanonical("Bags", "")).toBe("bags");
    expect(inferCategoryCanonical(null, "Men crew neck tee shirt")).toBe("tops");
    expect(inferCategoryCanonical(null, "Top Handle Bag")).toBe("bags");
    expect(inferCategoryCanonical("TOP HANDLE BAGS", "")).toBe("bags");
    expect(inferCategoryCanonical("Knit Tops", "")).toBe("tops");
    expect(inferCategoryCanonical("Woven Tops", "")).toBe("tops");
    expect(inferCategoryCanonical("Long Sleeve", "")).toBe("tops");
    expect(inferCategoryCanonical("Short Sleeve", "")).toBe("tops");
    expect(inferCategoryCanonical("Polo Short Sleeve", "")).toBe("tops");
    expect(inferCategoryCanonical("Fleece", "")).toBe("outerwear");
    expect(inferCategoryCanonical("PARKAS & BLOUSONS", "")).toBe("outerwear");
    expect(inferCategoryCanonical("After Ski Boot", "")).toBe("footwear");
    expect(inferCategoryCanonical("Flats + Other", "")).toBe("footwear");
    expect(inferCategoryCanonical("Ballerinas", "")).toBe("footwear");
    expect(inferCategoryCanonical("TRACKSUITS & TRACK TROUSERS", "")).toBe("bottoms");
    expect(inferCategoryCanonical("7/8 Tight", "")).toBe("bottoms");
    expect(inferCategoryCanonical("POUCHES", "")).toBe("bags");
    expect(inferCategoryCanonical("CARD HOLDERS", "")).toBe("bags");
    expect(inferCategoryCanonical("CAPS & HATS", "")).toBe("accessories");
    expect(inferCategoryCanonical("UNDERWEAR TRUNKS", "")).toBe("underwear");
    expect(inferCategoryCanonical("Bathroom Essentials", "")).toBe("beauty");
    expect(inferCategoryCanonical("SKIN CARE", "")).toBe("beauty");
    expect(inferCategoryCanonical("CONCEALERS", "")).toBe("beauty");
    expect(inferCategoryCanonical(null, "Men's suit jacket")).toBe("tailored");
    expect(inferCategoryCanonical(null, "Sleeveless vest top")).toBe("tops");
    expect(inferCategoryCanonical(null, "Wool waistcoat vest")).toBe("tailored");
  });
});
