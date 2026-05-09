/* Minimal declarations for test globals to satisfy static checks */
declare const describe: any;
declare const test: any;
declare const expect: any;

import {
  applyRelevanceThresholdFilter,
  buildInitialTypeSearchHintsForDetection,
  inferFootwearSubtypeFromCaption,
  normalizeDetectionLabelForSearch,
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
  test("uses distinct long-sleeve top seeds before generic top synonyms", () => {
    expect(
      buildInitialTypeSearchHintsForDetection({
        detectionLabel: "long sleeve top",
        productCategory: "tops",
        softProductTypeHints: ["top", "tops", "shirt"],
        mainPathOnly: true,
        limit: 3,
      }),
    ).toEqual(["shirt", "sweater", "hoodie"]);
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
    ).toEqual(["jacket", "coat", "blazer"]);
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
});
