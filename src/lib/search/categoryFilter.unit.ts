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

  test("inferCategoryCanonical maps vendor label to aisle", () => {
    expect(inferCategoryCanonical("Bags", "")).toBe("accessories");
    expect(inferCategoryCanonical(null, "Men crew neck tee shirt")).toBe("tops");
    expect(inferCategoryCanonical("CONCEALERS", "")).toBe("beauty");
  });
});
