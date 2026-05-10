import test from "node:test";
import assert from "node:assert/strict";
import { toPublicSearchProduct } from "./publicSearchResult";

test("public search product exposes debug for unified scorer score", () => {
  const product = {
    id: "123",
    title: "Black Tee",
    score: 0.42,
    similarity_score: 0.7,
    explain: {
      unifiedScorer: {
        score: 0.8123,
        detail: {
          score: 0.8123,
          components: { visual: 0.91, type: 0.85, color: 1, attrs: 0.6 },
          weights: { visual: 0.4, type: 0.2, color: 0.25, attrs: 0.15 },
          base: 0.86,
          caps: [{ reason: "example_cap", value: 0.9 }],
          effectiveCap: 0.9,
          floor: 0.72,
          floorReason: "close_visual_acceptable_floor",
          hardGate: null,
          matchLabel: "similar",
        },
      },
    },
  };

  const result = toPublicSearchProduct(product, { includeScoreDebug: true });

  assert.equal(result.score, 0.8123);
  assert.deepEqual(result.score_debug, {
    score: 0.8123,
    components: { visual: 0.91, type: 0.85, color: 1, attrs: 0.6 },
    weights: { visual: 0.4, type: 0.2, color: 0.25, attrs: 0.15 },
    base: 0.86,
    caps: [{ reason: "example_cap", value: 0.9 }],
    effectiveCap: 0.9,
    floor: 0.72,
    floorReason: "close_visual_acceptable_floor",
    hardGate: null,
    matchLabel: "similar",
  });
  assert.equal(result.explain, undefined);
});

test("public search product omits score debug unless requested", () => {
  const result = toPublicSearchProduct({
    id: "123",
    explain: { unifiedScorer: { score: 0.9 } },
  });

  assert.equal(result.score, 0.9);
  assert.equal(result.score_debug, undefined);
});
