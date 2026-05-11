/* Minimal declarations for test globals to satisfy static checks */
declare const describe: any;
declare const test: any;
declare const expect: any;

import {
  expandProductTypesForQuery,
  extractExplicitSleeveIntent,
  extractFashionTypeNounTokens,
  extractLexicalProductTypeSeeds,
  filterProductTypeSeedsByMappedCategory,
  inferMacroFamiliesFromListingCategoryFields,
  scoreRerankProductTypeBreakdown,
} from "./productTypeTaxonomy";

describe("scoreRerankProductTypeBreakdown", () => {
  test("joggers vs leggings is not exact-type equivalent", () => {
    const r = scoreRerankProductTypeBreakdown(["joggers"], ["leggings"]);
    expect(r.exactTypeScore).toBe(0.7);
    expect(r.combinedTypeCompliance).toBeLessThan(0.5);
  });

  test("joggers vs joggers is full compliance", () => {
    const r = scoreRerankProductTypeBreakdown(["joggers"], ["joggers", "pants"]);
    expect(r.exactTypeScore).toBe(1);
    expect(r.combinedTypeCompliance).toBeGreaterThan(0.9);
  });

  test("blazer vs parka gets outerwear mismatch penalty", () => {
    const r = scoreRerankProductTypeBreakdown(["blazer"], ["parka", "outerwear"]);
    expect(r.exactTypeScore).toBe(0.7);
    expect(r.intraFamilyPenalty).toBeGreaterThan(0);
  });

  test("plain jacket intent is distinct from blazer and vest", () => {
    const blazer = scoreRerankProductTypeBreakdown(["jacket"], ["blazer", "outerwear"]);
    const vest = scoreRerankProductTypeBreakdown(["jacket"], ["vest", "outerwear"]);

    expect(blazer.exactTypeScore).toBe(0.7);
    expect(blazer.combinedTypeCompliance).toBeLessThan(0.35);
    expect(vest.combinedTypeCompliance).toBeLessThan(0.35);
  });

  test("outerwear phrase variants stay in their micro-clusters", () => {
    expect(scoreRerankProductTypeBreakdown(["jacket"], ["shacket", "outerwear"]).combinedTypeCompliance).toBeGreaterThan(0.6);
    expect(scoreRerankProductTypeBreakdown(["coat"], ["parka", "outerwear"]).combinedTypeCompliance).toBeGreaterThan(0.6);
    expect(scoreRerankProductTypeBreakdown(["vest"], ["waistcoat", "outerwear"]).combinedTypeCompliance).toBeGreaterThan(0.6);
  });

  test("catalog outerwear layer buckets score as jacket-family matches", () => {
    expect(scoreRerankProductTypeBreakdown(["jacket"], ["fleece", "outerwear"]).combinedTypeCompliance).toBeGreaterThan(0.6);
    expect(scoreRerankProductTypeBreakdown(["jacket"], ["puffer", "outerwear"]).combinedTypeCompliance).toBeGreaterThan(0.6);
    expect(scoreRerankProductTypeBreakdown(["jacket"], ["blouson", "outerwear"]).combinedTypeCompliance).toBeGreaterThan(0.6);
    expect(filterProductTypeSeedsByMappedCategory(["fleece", "puffer", "blouson"], "outerwear")).toEqual([
      "fleece",
      "puffer",
      "blouson",
    ]);
    expect(filterProductTypeSeedsByMappedCategory(["jackets", "coats"], "outerwear")).toEqual([
      "jackets",
      "coats",
    ]);
  });

  test("sneakers vs heels are not equivalent within footwear", () => {
    const r = scoreRerankProductTypeBreakdown(["sneakers"], ["heels", "shoes"]);
    expect(r.exactTypeScore).toBe(0.7);
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
    expect(r.exactTypeScore).toBe(0.7);
    expect(r.intraFamilyPenalty).toBeGreaterThan(0);
  });

  test("pants intent does not treat suits as bottom-like", () => {
    const r = scoreRerankProductTypeBreakdown(["pants", "trousers"], ["suit", "outerwear"]);
    expect(r.exactTypeScore).toBe(0.2);
    expect(r.combinedTypeCompliance).toBeLessThan(0.35);
  });

  test("full suit intent does not treat standalone blazers as exact suits", () => {
    const r = scoreRerankProductTypeBreakdown(["suit"], ["blazer", "outerwear"]);
    expect(r.exactTypeScore).toBe(0.2);
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

  test("does not treat short sleeve wording as shorts intent", () => {
    const topSeeds = extractLexicalProductTypeSeeds("short sleeve tops");
    expect(topSeeds).toContain("tops");
    expect(topSeeds).not.toContain("short");
    expect(topSeeds).not.toContain("shorts");
    expect(extractLexicalProductTypeSeeds("short sleeve shirt")).toEqual(["shirt"]);

    const expanded = expandProductTypesForQuery(["shorts"]);
    expect(expanded).toContain("shorts");
    expect(expanded).not.toContain("short");
    expect(expanded).not.toContain("board shorts");
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
    expect(expanded).toContain("knit tops");
    expect(expanded).toContain("woven tops");
    expect(expanded).toContain("shirting");
    expect(expanded).toContain("polo short sleeve");
  });

  test("catalog category labels participate in subtype matching without collapsing outerwear", () => {
    expect(scoreRerankProductTypeBreakdown(["sweater"], ["Knit Tops"]).combinedTypeCompliance).toBeGreaterThan(0.6);
    expect(scoreRerankProductTypeBreakdown(["shirt"], ["Woven Tops"]).combinedTypeCompliance).toBeGreaterThan(0.6);
    expect(scoreRerankProductTypeBreakdown(["jacket"], ["Outerwear & Jackets"]).combinedTypeCompliance).toBeGreaterThan(0.6);
    expect(scoreRerankProductTypeBreakdown(["jacket"], ["blazer", "outerwear"]).combinedTypeCompliance).toBeLessThan(0.35);
  });

  test("vest dress: outerwear vest token dropped when aisle is dresses", () => {
    const seeds = extractLexicalProductTypeSeeds("vest dress");
    expect(seeds).toContain("vest");
    expect(seeds).toContain("dress");
    expect(filterProductTypeSeedsByMappedCategory(seeds, "dresses")).toEqual(["dress"]);
  });

  test("vest top stays in tops instead of formal vest seeds", () => {
    const seeds = extractLexicalProductTypeSeeds("sleeveless vest top");
    expect(seeds).toContain("tank");
    expect(seeds).not.toContain("vest");
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

describe("extractExplicitSleeveIntent", () => {
  test("extracts explicit short and long sleeve phrases", () => {
    expect(extractExplicitSleeveIntent("short sleeve tops")).toBe("short");
    expect(extractExplicitSleeveIntent("Long Sleeve")).toBe("long");
    expect(extractExplicitSleeveIntent("polo short-sleeved shirt")).toBe("short");
    expect(extractExplicitSleeveIntent("short white tshirt")).toBe("short");
    expect(extractExplicitSleeveIntent("short black tee")).toBe("short");
    expect(extractExplicitSleeveIntent("white tshirt")).toBe("short");
    expect(extractExplicitSleeveIntent("long sleeve tshirt")).toBe("long");
  });

  test("ignores ambiguous length words and conflicting sleeve phrases", () => {
    expect(extractExplicitSleeveIntent("short tops")).toBeUndefined();
    expect(extractExplicitSleeveIntent("long top")).toBeUndefined();
    expect(extractExplicitSleeveIntent("short sleeve or long sleeve tops")).toBeUndefined();
  });

  test("extracts no-sleeve top phrases without treating bare vest as sleeveless", () => {
    expect(extractExplicitSleeveIntent("tank top")).toBe("sleeveless");
    expect(extractExplicitSleeveIntent("sleeveless vest top")).toBe("sleeveless");
    expect(extractExplicitSleeveIntent("tailored vest")).toBeUndefined();
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
  test("maps observed outerwear catalog labels to outerwear family", () => {
    for (const label of ["outwear", "denim jacket", "women blazer", "men coat", "sw.jacket"]) {
      const fams = inferMacroFamiliesFromListingCategoryFields(label, "");
      expect(fams.has("outerwear")).toBe(true);
    }
  });

  test("does not infer tops from top handle bag phrases", () => {
    const fams = inferMacroFamiliesFromListingCategoryFields("bags", "Top Handle Bag");
    expect(fams.has("tops")).toBe(false);
    expect(fams.has("bags")).toBe(true);
  });

  test("maps tailored listing categories to tailored family", () => {
    const fams = inferMacroFamiliesFromListingCategoryFields("tailored", "waistcoat");
    expect(fams.has("tailored")).toBe(true);
  });
});
