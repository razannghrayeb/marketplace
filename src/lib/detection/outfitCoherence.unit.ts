/* Minimal declarations for test globals to satisfy static checks */
declare const describe: any;
declare const test: any;
declare const expect: any;

import { computeOutfitCoherence } from "./outfitCoherence";

describe("computeOutfitCoherence", () => {
  test("treats top and skirt as a compatible outfit pairing", () => {
    const result = computeOutfitCoherence([
      {
        label: "long sleeve top",
        raw_label: "long sleeve top",
        confidence: 0.93,
        box: { x1: 0, y1: 0, x2: 100, y2: 100 } as any,
        style: { occasion: "casual", formality: 5 },
        dominantColor: "white",
      } as any,
      {
        label: "skirt",
        raw_label: "skirt",
        confidence: 0.9,
        box: { x1: 0, y1: 0, x2: 100, y2: 100 } as any,
        style: { occasion: "casual", formality: 5 },
        dominantColor: "white",
      } as any,
    ]);

    expect(result.categoryAnalysis.hasTop).toBe(true);
    expect(result.categoryAnalysis.hasBottom).toBe(true);
    expect(result.pairwiseScores[0].categoryCompatibility).toBeGreaterThan(0.9);
    expect(result.pairwiseScores[0].colorHarmony).toBeGreaterThan(0.8);
  });

  test("keeps color harmony non-neutral when colors are provided", () => {
    const result = computeOutfitCoherence([
      {
        label: "shirt",
        raw_label: "shirt",
        confidence: 0.91,
        box: { x1: 0, y1: 0, x2: 100, y2: 100 } as any,
        style: { occasion: "casual", formality: 5 },
        dominantColor: "white",
      } as any,
      {
        label: "shoe",
        raw_label: "shoe",
        confidence: 0.92,
        box: { x1: 0, y1: 0, x2: 100, y2: 100 } as any,
        style: { occasion: "casual", formality: 3 },
        dominantColor: "white",
      } as any,
    ]);

    expect(result.pairwiseScores[0].colorHarmony).toBeGreaterThan(0.8);
  });

  test("does not mark footwear as missing for a single shoe detection", () => {
    const result = computeOutfitCoherence([
      {
        label: "shoe",
        raw_label: "shoe",
        confidence: 0.95,
        box: { x1: 0, y1: 0, x2: 100, y2: 100 } as any,
        style: { occasion: "casual", formality: 3 },
        dominantColor: "brown",
      } as any,
    ]);

    expect(result.categoryAnalysis.hasFootwear).toBe(true);
    expect(result.categoryAnalysis.missingEssentials).toEqual(["top", "bottom"]);
  });
});
