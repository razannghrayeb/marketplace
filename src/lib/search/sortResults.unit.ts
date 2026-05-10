import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { sortProductsByFinalRelevance } from "./sortResults";

function expect(actual: any) {
  return {
    toBe(expected: any) {
      assert.equal(actual, expected);
    },
  };
}

describe("sortProductsByFinalRelevance", () => {
  test("breaks ties using explainable relevance before raw similarity", () => {
    const products = [
      {
        id: "offwhite-pullover",
        finalRelevance01: 0.72,
        rerankScore: 1.1,
        similarity_score: 0.91,
        explain: {
          productTypeCompliance: 0.22,
          sleeveCompliance: 0.4,
          colorCompliance: 1,
          styleCompliance: 0.15,
        },
      },
      {
        id: "white-shirt",
        finalRelevance01: 0.72,
        rerankScore: 1.1,
        similarity_score: 0.63,
        explain: {
          productTypeCompliance: 0.92,
          sleeveCompliance: 0.9,
          colorCompliance: 0.92,
          styleCompliance: 0.15,
        },
      },
      {
        id: "white-shirt-low-color",
        finalRelevance01: 0.72,
        rerankScore: 1.1,
        similarity_score: 0.99,
        explain: {
          productTypeCompliance: 0.92,
          sleeveCompliance: 0.9,
          colorCompliance: 0.7,
          styleCompliance: 0.15,
        },
      },
    ];

    const sorted = sortProductsByFinalRelevance(products as any);

    expect(sorted[0].id).toBe("white-shirt");
    expect(sorted[1].id).toBe("white-shirt-low-color");
    expect(sorted[2].id).toBe("offwhite-pullover");
  });
});