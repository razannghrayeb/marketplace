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
    toBeGreaterThan(expected: number) {
      assert.ok(actual > expected, `${actual} is not greater than ${expected}`);
    },
    toBeGreaterThanOrEqual(expected: number) {
      assert.ok(actual >= expected, `${actual} is not greater than or equal to ${expected}`);
    },
    toBeLessThan(expected: number) {
      assert.ok(actual < expected, `${actual} is not less than ${expected}`);
    },
    toBeLessThanOrEqual(expected: number) {
      assert.ok(actual <= expected, `${actual} is not less than or equal to ${expected}`);
    },
    toBeUndefined() {
      assert.equal(actual, undefined);
    },
    toContain(expected: any) {
      if (Array.isArray(actual)) {
        assert.ok(actual.includes(expected), `Expected array to contain ${expected}`);
      } else if (typeof actual === 'string') {
        assert.ok(actual.indexOf(String(expected)) !== -1, `Expected string to contain ${expected}`);
      } else {
        assert.fail('toContain called on non-string, non-array');
      }
    },
    not: {
      toBe(expected: any) {
        assert.notEqual(actual, expected);
      },
      toContain(expected: any) {
        if (Array.isArray(actual)) {
          assert.ok(!actual.includes(expected), `Expected array to not contain ${expected}`);
        } else if (typeof actual === 'string') {
          assert.ok(actual.indexOf(String(expected)) === -1, `Expected string to not contain ${expected}`);
        } else {
          // Nothing to assert; treat as pass
        }
      },
    },
  };
}

import {
  expandProductTypesForQuery,
  extractExplicitSleeveIntent,
  extractFashionTypeNounTokens,
  extractLexicalProductTypeSeeds,
  filterProductTypeSeedsByMappedCategory,
  inferMacroFamiliesFromListingCategoryFields,
  scoreCrossFamilyTypePenalty,
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
    expect(scoreRerankProductTypeBreakdown(["flats"], ["Flats + Other"]).combinedTypeCompliance).toBeGreaterThan(0.6);
    expect(scoreRerankProductTypeBreakdown(["sneakers"], ["shoes-sp"]).combinedTypeCompliance).toBeGreaterThan(0.6);
    expect(scoreRerankProductTypeBreakdown(["loafers"], ["shoes-cl"]).combinedTypeCompliance).toBeGreaterThan(0.6);
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

  test("broad trouser recall hints do not cross-family block plain pants", () => {
    const penalty = scoreCrossFamilyTypePenalty(
      [
        "pants",
        "pant",
        "trousers",
        "chinos",
        "cargo pants",
        "track trousers",
        "tracksuits & track trousers",
        "chino",
        "slacks",
        "jeans",
        "jean",
      ],
      ["pants", "trouser"],
      { category: "Bottoms", categoryCanonical: "bottoms" },
    );

    expect(penalty).toBe(0);
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

  test("catalog title/url garment cues cover long-sleeve and outerwear wording", () => {
    expect(extractLexicalProductTypeSeeds("ribbed crewneck long sleeve top")).toContain("long sleeve");
    expect(extractLexicalProductTypeSeeds("mock neck sweater")).toContain("mock neck");
    expect(extractLexicalProductTypeSeeds("waterproof raincoat")).toContain("raincoat");
    expect(extractLexicalProductTypeSeeds("/women/outerwear/quilted-raincoat")).toContain("raincoat");
  });

  test("high-volume vendor category labels produce searchable type seeds", () => {
    expect(extractLexicalProductTypeSeeds("TRACKSUITS & TRACK TROUSERS")).toContain("tracksuits & track trousers");
    expect(extractLexicalProductTypeSeeds("7/8 Tight")).toContain("7/8 tight");
    expect(extractLexicalProductTypeSeeds("After Ski Boot")).toContain("after ski boot");
    expect(extractLexicalProductTypeSeeds("Flats + Other")).toContain("flats + other");
    expect(extractLexicalProductTypeSeeds("shoes-cl")).toContain("shoes-cl");
    expect(extractLexicalProductTypeSeeds("shoes-sp")).toContain("shoes-sp");
    expect(extractLexicalProductTypeSeeds("POUCHES")).toContain("pouches");
    expect(extractLexicalProductTypeSeeds("CARD HOLDERS")).toContain("card holders");
    expect(extractLexicalProductTypeSeeds("TOP HANDLE BAGS")).toContain("top handle bags");
    expect(extractLexicalProductTypeSeeds("Bags cases and Luggage")).toContain("bags cases and luggage");
    expect(extractLexicalProductTypeSeeds("CARRY ON")).toContain("carry on");
    expect(extractLexicalProductTypeSeeds("SHOULDER STRAPS")).toContain("shoulder straps");
    expect(extractLexicalProductTypeSeeds("MINI BAGS")).toContain("mini bags");
    expect(extractLexicalProductTypeSeeds("TOTE BAGS")).toContain("tote bags");
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
    expect(extractExplicitSleeveIntent("long sleeve top")).toBe("long");
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
  test("does not infer tops from top handle bag phrases", () => {
    const fams = inferMacroFamiliesFromListingCategoryFields("bags", "Top Handle Bag");
    expect(fams.has("tops")).toBe(false);
    expect(fams.has("bags")).toBe(true);
  });

  test("maps tailored listing categories to tailored family", () => {
    const fams = inferMacroFamiliesFromListingCategoryFields("tailored", "waistcoat");
    expect(fams.has("tailored")).toBe(true);
  });

  test("maps descriptive title cues to top and outerwear families", () => {
    expect(inferMacroFamiliesFromListingCategoryFields(undefined, "crewneck long sleeve")).toEqual(new Set(["tops"]));
    expect(inferMacroFamiliesFromListingCategoryFields(undefined, "waterproof raincoat")).toEqual(new Set(["outerwear"]));
    expect(inferMacroFamiliesFromListingCategoryFields(undefined, "lapel blazer")).toEqual(new Set(["outerwear"]));
    expect(inferMacroFamiliesFromListingCategoryFields(undefined, "After Ski Boot")).toEqual(new Set(["footwear"]));
    expect(inferMacroFamiliesFromListingCategoryFields(undefined, "shoes-cl")).toEqual(new Set(["footwear"]));
    expect(inferMacroFamiliesFromListingCategoryFields(undefined, "POUCHES")).toEqual(new Set(["bags"]));
    expect(inferMacroFamiliesFromListingCategoryFields(undefined, "Bags cases and Luggage")).toEqual(new Set(["bags"]));
    expect(inferMacroFamiliesFromListingCategoryFields(undefined, "CARRY ON")).toEqual(new Set(["bags"]));
  });
});
