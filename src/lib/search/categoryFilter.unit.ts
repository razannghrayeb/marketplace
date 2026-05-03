/* Minimal declarations for test globals to satisfy static checks */
declare const describe: any;
declare const test: any;
declare const expect: any;

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
  });

  test("getCategorySearchTerms expands tailored aliases", () => {
    const t = getCategorySearchTerms("tailored");
    expect(t.includes("suit")).toBe(true);
    expect(t.includes("waistcoat")).toBe(true);
  });

  test("inferCategoryCanonical maps vendor label to aisle", () => {
    expect(inferCategoryCanonical("Bags", "")).toBe("bags");
    expect(inferCategoryCanonical(null, "Men crew neck tee shirt")).toBe("tops");
    expect(inferCategoryCanonical(null, "Top Handle Bag")).toBe("bags");
    expect(inferCategoryCanonical("CONCEALERS", "")).toBe("beauty");
    expect(inferCategoryCanonical(null, "Men's suit jacket")).toBe("tailored");
    expect(inferCategoryCanonical(null, "Sleeveless vest top")).toBe("tops");
    expect(inferCategoryCanonical(null, "Wool waistcoat vest")).toBe("tailored");
  });

  test("maps real catalog category labels to canonical aisles", () => {
    expect(inferCategoryCanonical("women dress", "")).toBe("dresses");
    expect(inferCategoryCanonical("Dress Shoes", "")).toBe("footwear");
    expect(inferCategoryCanonical("CROSSBODY BAGS", "")).toBe("bags");
    expect(inferCategoryCanonical("Knitwear", "")).toBe("tops");
    expect(inferCategoryCanonical("TRACKSUITS & TRACK TROUSERS", "")).toBe("bottoms");
    expect(inferCategoryCanonical("COATS & JACKETS", "")).toBe("outerwear");
  });

  test("expands canonical filters using catalog-native labels", () => {
    const bags = getCategorySearchTerms("bags");
    expect(bags.includes("crossbody bags")).toBe(true);
    expect(bags.includes("phone bags")).toBe(true);

    const footwear = getCategorySearchTerms("footwear");
    expect(footwear.includes("ballerinas")).toBe(true);
    expect(footwear.includes("dress shoes")).toBe(true);

    const tops = getCategorySearchTerms("tops");
    expect(tops.includes("women pullover")).toBe(true);
    expect(tops.includes("shirt-cl")).toBe(true);
  });
});
