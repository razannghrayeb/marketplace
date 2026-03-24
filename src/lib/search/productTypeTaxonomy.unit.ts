/* Minimal declarations for test globals to satisfy static checks */
declare const describe: any;
declare const test: any;
declare const expect: any;

import {
  extractFashionTypeNounTokens,
  extractLexicalProductTypeSeeds,
  scoreRerankProductTypeBreakdown,
} from "./productTypeTaxonomy";

describe("scoreRerankProductTypeBreakdown", () => {
  test("joggers vs leggings is not exact-type equivalent", () => {
    const r = scoreRerankProductTypeBreakdown(["joggers"], ["leggings"]);
    expect(r.exactTypeScore).toBe(0);
    expect(r.combinedTypeCompliance).toBeLessThan(0.5);
  });

  test("joggers vs joggers is full compliance", () => {
    const r = scoreRerankProductTypeBreakdown(["joggers"], ["joggers", "pants"]);
    expect(r.exactTypeScore).toBe(1);
    expect(r.combinedTypeCompliance).toBeGreaterThan(0.9);
  });

  test("blazer vs parka gets outerwear mismatch penalty", () => {
    const r = scoreRerankProductTypeBreakdown(["blazer"], ["parka", "outerwear"]);
    expect(r.exactTypeScore).toBe(0);
    expect(r.intraFamilyPenalty).toBeGreaterThan(0);
  });

  test("sneakers vs heels are not equivalent within footwear", () => {
    const r = scoreRerankProductTypeBreakdown(["sneakers"], ["heels", "shoes"]);
    expect(r.exactTypeScore).toBe(0);
    expect(r.combinedTypeCompliance).toBeLessThan(0.55);
  });

  test("hoodie vs dress shirt are distinct tops", () => {
    const r = scoreRerankProductTypeBreakdown(["hoodie"], ["shirt", "shirts"]);
    expect(r.exactTypeScore).toBe(0);
    expect(r.intraFamilyPenalty).toBeGreaterThan(0);
  });
});

describe("extractLexicalProductTypeSeeds", () => {
  test("does not match top inside laptop", () => {
    expect(extractLexicalProductTypeSeeds("laptop sleeve")).toEqual([]);
  });

  test("does not match heel inside wheel", () => {
    expect(extractLexicalProductTypeSeeds("steel wheel rim")).toEqual([]);
  });

  test("does not match bag inside garbage", () => {
    expect(extractLexicalProductTypeSeeds("kitchen garbage bin")).toEqual([]);
  });

  test("does not match top inside stop", () => {
    expect(extractLexicalProductTypeSeeds("bus stop")).toEqual([]);
  });

  test("does not match short as substring of shorts via wrong token", () => {
    expect(extractLexicalProductTypeSeeds("running shorts")).toContain("shorts");
    expect(extractLexicalProductTypeSeeds("running shorts")).not.toContain("short");
  });

  test("matches real garment tokens", () => {
    const j = extractLexicalProductTypeSeeds("blue jeans");
    expect(j).toContain("jeans");
    const t = extractLexicalProductTypeSeeds("women tops");
    expect(t.some((x) => x === "tops" || x === "top")).toBe(true);
  });
});

describe("extractFashionTypeNounTokens", () => {
  test("finds dress in color + noun queries", () => {
    expect(extractFashionTypeNounTokens("red dress")).toContain("dress");
  });

  test("stem plural footwear", () => {
    const t = extractFashionTypeNounTokens("black boots");
    expect(t.some((x) => x === "boot" || x === "boots")).toBe(true);
  });
});
