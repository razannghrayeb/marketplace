import assert from "node:assert/strict";
import { describe, test } from "node:test";

function expect(actual: any) {
  return {
    toBe(expected: any) {
      assert.equal(actual, expected);
    },
    toEqual(expected: any) {
      assert.deepStrictEqual(actual, expected);
    },
    toContain(expected: any) {
      assert.ok(actual.includes(expected), `${JSON.stringify(actual)} does not contain ${JSON.stringify(expected)}`);
    },
    toHaveLength(expected: number) {
      assert.equal(actual.length, expected);
    },
    not: {
      toContain(expected: any) {
        assert.ok(!actual.includes(expected), `${JSON.stringify(actual)} unexpectedly contains ${JSON.stringify(expected)}`);
      },
    },
  };
}

import {
  applyRelevanceThresholdFilter,
  applySleeveIntentGuard,
  buildInitialTypeSearchHintsForDetection,
  hardCategoryTermsForDetection,
  inferOuterwearSuitSignal,
  inferFootwearSubtypeFromCaption,
  normalizeDetectionLabelForSearch,
  recoverFormalOuterwearTypes,
} from "./image-analysis.service";

describe("inferFootwearSubtypeFromCaption", () => {
  test("keeps explicit heel cues as heels", () => {
    expect(inferFootwearSubtypeFromCaption("shoe", "woman wearing heels")).toBe("heels");
  });

  test("maps formal shoe captions to formal dress shoes", () => {
    expect(inferFootwearSubtypeFromCaption("shoe", "man in a formal suit with dress shoes")).toBe("oxfords");
  });

  test("keeps sneaker cues as sneakers", () => {
    expect(inferFootwearSubtypeFromCaption("shoe", "running sneakers")).toBe("sneakers");
  });
});

describe("main-path detection search hints", () => {
  test("keeps generic long-sleeve top seeds balanced before generic synonyms", () => {
    expect(
      buildInitialTypeSearchHintsForDetection({
        detectionLabel: "long sleeve top",
        productCategory: "tops",
        softProductTypeHints: ["top", "tops", "shirt"],
        mainPathOnly: true,
        limit: 3,
      }),
    ).toEqual(["shirt", "woven tops", "sweater"]);
  });

  test("uses lightweight long-sleeve top seeds when material evidence is light", () => {
    expect(
      buildInitialTypeSearchHintsForDetection({
        detectionLabel: "long sleeve top",
        productCategory: "tops",
        materialHint: "cotton",
        softProductTypeHints: ["top", "sweater"],
        mainPathOnly: true,
        limit: 3,
      }),
    ).toEqual(["shirt", "woven tops", "shirting"]);
  });

  test("uses winter long-sleeve top seeds when material evidence is warm", () => {
    expect(
      buildInitialTypeSearchHintsForDetection({
        detectionLabel: "long sleeve top",
        productCategory: "tops",
        materialHint: "wool",
        softProductTypeHints: ["top", "shirt"],
        mainPathOnly: true,
        limit: 3,
      }),
    ).toEqual(["sweater", "knit tops", "sweatshirt"]);
  });

  test("keeps short-sleeve top seeds in the established main path", () => {
    expect(
      buildInitialTypeSearchHintsForDetection({
        detectionLabel: "short sleeve top",
        productCategory: "tops",
        softProductTypeHints: ["top", "tee"],
        mainPathOnly: true,
        limit: 3,
      }),
    ).toEqual(["tshirt", "shirt", "polo"]);
  });

  test("normalizes outwear labels for outerwear main-path search", () => {
    expect(normalizeDetectionLabelForSearch("Long Sleeve Outwear")).toBe("long sleeve outerwear");
    expect(
      buildInitialTypeSearchHintsForDetection({
        detectionLabel: "long sleeve outwear",
        productCategory: "outerwear",
        softProductTypeHints: ["outerwear"],
        mainPathOnly: true,
        limit: 3,
      }),
    ).toEqual(["outerwear", "jacket", "cardigan"]);
  });

  test("keeps generic long-sleeve outwear hard category terms out of the full-suit lane", () => {
    const terms = hardCategoryTermsForDetection(
      "long sleeve outwear",
      { productCategory: "outerwear" } as any,
      undefined,
      "a man standing on a street in front of a building",
    );

    expect(terms).toContain("jacket");
    expect(terms).toContain("blazer");
    expect(terms).not.toContain("suit");
    expect(terms).not.toContain("suits");
    expect(terms).not.toContain("tuxedo");
    expect(terms).not.toContain("tuxedos");
  });

  test("uses vest-specific seeds for vest detections", () => {
    expect(
      buildInitialTypeSearchHintsForDetection({
        detectionLabel: "vest",
        productCategory: "outerwear",
        softProductTypeHints: ["jacket", "coat", "blazer"],
        mainPathOnly: true,
        limit: 3,
      }),
    ).toEqual(["vest", "waistcoat", "gilet"]);
  });

  test("keeps catalog layer terms in one outerwear main-path call when explicit", () => {
    expect(
      buildInitialTypeSearchHintsForDetection({
        detectionLabel: "fleece jacket",
        productCategory: "outerwear",
        softProductTypeHints: ["outerwear"],
        mainPathOnly: true,
        limit: 3,
      }),
    ).toEqual(["fleece", "jacket", "coat"]);

    expect(
      buildInitialTypeSearchHintsForDetection({
        detectionLabel: "puffer jacket",
        productCategory: "outerwear",
        softProductTypeHints: ["outerwear"],
        mainPathOnly: true,
        limit: 3,
      }),
    ).toEqual(["puffer", "jacket", "coat"]);
  });
});

describe("applySleeveIntentGuard", () => {
  test("drops top candidates that fail the sleeve compliance floor when metadata is available", () => {
    const kept = applySleeveIntentGuard({
      detectionLabel: "long sleeve top",
      categoryMapping: {
        productCategory: "tops",
        attributes: { sleeveLength: "long" },
      } as any,
      products: [
        {
          id: "drop",
          title: "Short Sleeve Top",
          product_types: ["top"],
          explain: { sleeveCompliance: 0.18 },
        },
        {
          id: "keep",
          title: "Long Sleeve Top",
          product_types: ["top"],
          explain: { sleeveCompliance: 0.63 },
        },
      ] as any,
    } as any);

    expect(kept.map((p: any) => p.id)).toEqual(["keep"]);
  });

  test("uses a stricter floor for long-sleeve tops", () => {
    const kept = applySleeveIntentGuard({
      detectionLabel: "long sleeve top",
      categoryMapping: {
        productCategory: "tops",
        attributes: { sleeveLength: "long" },
      } as any,
      products: [
        {
          id: "drop-mid",
          title: "Top",
          product_types: ["top"],
          explain: { sleeveCompliance: 0.36 },
        },
        {
          id: "keep-high",
          title: "Long Sleeve Top",
          product_types: ["top"],
          explain: { sleeveCompliance: 0.63 },
        },
      ] as any,
    } as any);

    expect(kept.map((p: any) => p.id)).toEqual(["keep-high"]);
  });
});

describe("outerwear suit signal", () => {
  test("recovers formal generic outerwear through jacket terms without full-suit gating", () => {
    const recovered = recoverFormalOuterwearTypes(
      ["long sleeve outerwear", "outerwear"],
      "outerwear",
      "long sleeve outerwear",
      "a woman in a suit and heels stands in front of a wall",
      "blazer",
    );

    expect(recovered.slice(0, 4)).toEqual(["sport coat", "dress jacket", "blazer", "blazers"]);
    expect(recovered).toContain("tailored jacket");
    expect(recovered).not.toContain("suit");
    expect(recovered).not.toContain("suits");
  });

  test("keeps full-suit recovery only for explicit suit detector labels", () => {
    const recovered = recoverFormalOuterwearTypes(
      ["outerwear"],
      "outerwear",
      "suit",
      "formal portrait",
    );

    expect(recovered.slice(0, 4)).toEqual(["suit", "suits", "tuxedo", "tuxedos"]);
    expect(recovered).toContain("blazer");
  });

  test("keeps generic long-sleeve outwear as jacket when only outfit geometry is formal", () => {
    const signal = inferOuterwearSuitSignal({
      yoloLabel: "long sleeve outwear",
      detectionRawLabel: "long sleeve outwear",
      productCategoryFromMapping: "outerwear",
      blipCaption: "a man standing on a street in front of a building",
      contextualFormalityScore: 7,
    });

    expect(signal.subtype).toBe("jacket");
    expect(signal.detectionCategoryForSearch).toBe("outerwear");
    expect(signal.prioritySeedTypes.slice(0, 3)).toEqual(["jacket", "jackets", "bomber"]);
  });

  test("recovers cardigan as a valid generic outerwear family term", () => {
    const recovered = recoverFormalOuterwearTypes(
      ["long sleeve outerwear", "outerwear"],
      "outerwear",
      "long sleeve outerwear",
      "a person wearing a cardigan over a tee",
    );

    expect(recovered).toContain("cardigan");
    expect(recovered).toContain("cardigans");
  });

  test("uses jacket-first tailored seeds for generic outwear with suit caption", () => {
    const signal = inferOuterwearSuitSignal({
      yoloLabel: "long sleeve outwear",
      detectionRawLabel: "long sleeve outwear",
      productCategoryFromMapping: "outerwear",
      blipCaption: "a woman in a suit and heels stands in front of a wall",
      contextualFormalityScore: 7,
    });

    expect(signal.subtype).toBe("suit_jacket");
    expect(signal.detectionCategoryForSearch).toBe("tailored");
    expect(signal.prioritySeedTypes.slice(0, 4)).toEqual(["blazer", "blazers", "sport coat", "sportcoat"]);
    expect(signal.prioritySeedTypes.includes("suit")).toBe(false);
  });

  test("promotes a formal top crop into the tailored lane when the outfit context is strong", () => {
    const signal = inferOuterwearSuitSignal({
      yoloLabel: "long sleeve top",
      detectionRawLabel: "long sleeve top",
      productCategoryFromMapping: "tops",
      blipCaption: "formal portrait",
      contextualFormalityScore: 7,
    });

    expect(signal.isOuterwearOrSuit).toBe(true);
    expect(signal.subtype).toBe("suit_jacket");
    expect(signal.detectionCategoryForSearch).toBe("tailored");
    expect(signal.predictedAisles).toEqual(["tailored", "outerwear"]);
  });
});

describe("applyRelevanceThresholdFilter", () => {
  test("keeps detection candidates accepted by the unified scorer score", () => {
    const kept = applyRelevanceThresholdFilter(
      [
        {
          id: "1",
          title: "The Utility Barrel Pant",
          finalRelevance01: 0.235,
          explain: { unifiedScorer: { score: 0.691 } },
        } as any,
      ],
      0.3,
      { category: "bottoms" },
    );

    expect(kept).toHaveLength(1);
  });

  test("still rejects audience contradictions even with a strong acceptance score", () => {
    const kept = applyRelevanceThresholdFilter(
      [
        {
          id: "1",
          title: "Girls Leggings",
          finalRelevance01: 0.235,
          explain: {
            unifiedScorer: { score: 0.691 },
            hasAudienceIntent: true,
            audienceCompliance: 0,
          },
        } as any,
      ],
      0.3,
      { category: "bottoms" },
    );

    expect(kept).toHaveLength(0);
  });

  test("uses high-confidence inferred charcoal as a soft rank signal for outerwear", () => {
    const kept = applyRelevanceThresholdFilter(
      [
        { id: "grey", title: "Grey Suit", color: "GREY", finalRelevance01: 0.82, explain: {} } as any,
        { id: "black-1", title: "Black Suit", color: "BLACK", finalRelevance01: 0.52, explain: {} } as any,
        { id: "black-2", title: "Classic Black Suit", color: "black", finalRelevance01: 0.5, explain: {} } as any,
        { id: "black-3", title: "Charcoal Black Suit", color: "charcoal", finalRelevance01: 0.48, explain: {} } as any,
      ],
      0.3,
      { category: "outerwear", desiredColor: "charcoal", desiredColorConfidence: 0.80 },
    );

    expect(kept.map((p: any) => p.id)).toEqual(["black-1", "black-2", "black-3", "grey"]);
  });

  test("uses explicit charcoal as a hard color qualifier for outerwear when enough matches exist", () => {
    const kept = applyRelevanceThresholdFilter(
      [
        { id: "grey", title: "Grey Suit", color: "GREY", finalRelevance01: 0.82, explain: {} } as any,
        { id: "black-1", title: "Black Suit", color: "BLACK", finalRelevance01: 0.52, explain: {} } as any,
        { id: "black-2", title: "Classic Black Suit", color: "black", finalRelevance01: 0.5, explain: {} } as any,
        { id: "black-3", title: "Charcoal Black Suit", color: "charcoal", finalRelevance01: 0.48, explain: {} } as any,
      ],
      0.3,
      { category: "outerwear", desiredColor: "charcoal", desiredColorConfidence: 1 },
    );

    expect(kept.map((p: any) => p.id)).toEqual(["black-1", "black-2", "black-3"]);
  });

  test("keeps generic long-sleeve outerwear candidates accepted by final relevance", () => {
    const kept = applyRelevanceThresholdFilter(
      [
        {
          id: "248173",
          title: "The Oversized Blazer in Wool | Glen Plaid",
          category: "Outerwear",
          color: "Glen Plaid",
          similarity_score: 0.91,
          finalRelevance01: 0.48,
          explain: {
            unifiedScorer: { score: 0.24 },
            acceptanceRelevance01: 0.806,
            productTypeCompliance: 1,
            categoryScore: 1,
            colorCompliance: 0,
            colorTier: "none",
            audienceCompliance: 1,
            crossFamilyPenalty: 0,
            hardBlocked: false,
          },
        } as any,
      ],
      0.3,
      { category: "outerwear", detectionLabel: "long sleeve outerwear" },
    );

    expect(kept.map((p: any) => p.id)).toEqual(["248173"]);
  });

  test("does not apply the long-sleeve outerwear rescue to other categories", () => {
    const kept = applyRelevanceThresholdFilter(
      [
        {
          id: "plain-top",
          title: "Plain Top",
          finalRelevance01: 0.48,
          explain: {
            unifiedScorer: { score: 0.24 },
            acceptanceRelevance01: 0.806,
            productTypeCompliance: 1,
            categoryScore: 1,
            audienceCompliance: 1,
          },
        } as any,
      ],
      0.3,
      { category: "tops", detectionLabel: "long sleeve top" },
    );

    expect(kept).toHaveLength(0);
  });
});
