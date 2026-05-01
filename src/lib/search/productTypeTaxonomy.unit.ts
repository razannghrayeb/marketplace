/* Minimal declarations for test globals to satisfy static checks */
declare const describe: any;
declare const test: any;
declare const expect: any;

import {
  expandProductTypesForQuery,
  extractFashionTypeNounTokens,
  extractLexicalProductTypeSeeds,
  filterProductTypeSeedsByMappedCategory,
  inferMacroFamiliesFromListingCategoryFields,
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

  test("plain jacket intent is distinct from blazer and vest", () => {
    const blazer = scoreRerankProductTypeBreakdown(["jacket"], ["blazer", "outerwear"]);
    const vest = scoreRerankProductTypeBreakdown(["jacket"], ["vest", "outerwear"]);

    expect(blazer.exactTypeScore).toBe(0);
    expect(blazer.combinedTypeCompliance).toBeLessThan(0.35);
    expect(vest.combinedTypeCompliance).toBeLessThan(0.35);
  });

  test("outerwear phrase variants stay in their micro-clusters", () => {
    expect(scoreRerankProductTypeBreakdown(["jacket"], ["shacket", "outerwear"]).combinedTypeCompliance).toBeGreaterThan(0.6);
    expect(scoreRerankProductTypeBreakdown(["coat"], ["parka", "outerwear"]).combinedTypeCompliance).toBeGreaterThan(0.6);
    expect(scoreRerankProductTypeBreakdown(["vest"], ["waistcoat", "outerwear"]).combinedTypeCompliance).toBeGreaterThan(0.6);
  });

  test("sneakers vs heels are not equivalent within footwear", () => {
    const r = scoreRerankProductTypeBreakdown(["sneakers"], ["heels", "shoes"]);
    expect(r.exactTypeScore).toBe(0);
    expect(r.combinedTypeCompliance).toBeLessThan(0.55);
  });

  test("generic shoe stays neutral between sneakers and heels", () => {
    const sneakerMatch = scoreRerankProductTypeBreakdown(["shoes"], ["sneakers"]);
    const heelMatch = scoreRerankProductTypeBreakdown(["shoes"], ["heels"]);

    expect(sneakerMatch.combinedTypeCompliance).toBeGreaterThanOrEqual(heelMatch.combinedTypeCompliance - 0.01);
    expect(Math.abs(sneakerMatch.combinedTypeCompliance - heelMatch.combinedTypeCompliance)).toBeLessThanOrEqual(0.15);
  });

  test("generic shoe intent keeps broad footwear recall", () => {
    expect(scoreRerankProductTypeBreakdown(["shoes"], ["boots", "shoes"]).combinedTypeCompliance).toBeGreaterThan(0.9);
    expect(scoreRerankProductTypeBreakdown(["shoes"], ["sandals", "shoes"]).combinedTypeCompliance).toBeGreaterThan(0.9);
  });

  test("common footwear catalog phrases map to subtype clusters", () => {
    expect(scoreRerankProductTypeBreakdown(["sneakers"], ["running shoes"]).combinedTypeCompliance).toBeGreaterThan(0.6);
    expect(scoreRerankProductTypeBreakdown(["dress shoes"], ["oxfords"]).combinedTypeCompliance).toBeGreaterThan(0.6);
  });

  test("hoodie vs dress shirt are distinct tops", () => {
    const r = scoreRerankProductTypeBreakdown(["hoodie"], ["shirt", "shirts"]);
    expect(r.exactTypeScore).toBe(0);
    expect(r.intraFamilyPenalty).toBeGreaterThan(0);
  });

  test("pants intent does not treat suits as bottom-like", () => {
    const r = scoreRerankProductTypeBreakdown(["pants", "trousers"], ["suit", "outerwear"]);
    expect(r.exactTypeScore).toBe(0);
    expect(r.combinedTypeCompliance).toBeLessThan(0.35);
  });

  test("full suit intent does not treat standalone blazers as exact suits", () => {
    const r = scoreRerankProductTypeBreakdown(["suit"], ["blazer", "outerwear"]);
    expect(r.exactTypeScore).toBe(0);
    expect(r.combinedTypeCompliance).toBeLessThan(0.35);
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

  test("expands broad tops into common top subtypes for recall", () => {
    const expanded = expandProductTypesForQuery(["tops"]);
    expect(expanded).toContain("blouse");
    expect(expanded).toContain("blouses");
    expect(expanded).toContain("shirt");
    expect(expanded).toContain("tee");
    expect(expanded).toContain("tank top");
    expect(expanded).toContain("cardigan");
  });

  test("vest dress: outerwear vest token dropped when aisle is dresses", () => {
    const seeds = extractLexicalProductTypeSeeds("vest dress");
    expect(seeds).toContain("vest");
    expect(seeds).toContain("dress");
    expect(filterProductTypeSeedsByMappedCategory(seeds, "dresses")).toEqual(["dress"]);
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

describe("filterProductTypeSeedsByMappedCategory - accessory isolation", () => {
  test("head accessory seeds do not drift into bag family", () => {
    const seeds = ["headband, head covering, hair accessory", "bag", "hat", "accessories"];
    const filtered = filterProductTypeSeedsByMappedCategory(seeds, "accessories");
    expect(filtered).not.toContain("bag");
  });
});

describe("inferMacroFamiliesFromListingCategoryFields", () => {
  test("does not infer tops from top handle bag phrases", () => {
    const fams = inferMacroFamiliesFromListingCategoryFields("bags", "Top Handle Bag");
    expect(fams.has("tops")).toBe(false);
    expect(fams.has("bags")).toBe(true);
  });
});
