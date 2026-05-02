import test from "node:test";
import assert from "node:assert/strict";
import { computeColorContradictionPenalty } from "./colorRelevance";

test("color contradiction penalty stays visible for strong but wrong-color matches", () => {
  const penalty = computeColorContradictionPenalty({
    desiredColorsTier: ["blue"],
    rerankColorMode: "any",
    hasExplicitColorIntent: true,
    hasInferredColorSignal: false,
    hasCropColorSignal: false,
    rawVisual: 0.78,
    nearIdenticalRawMin: 0.93,
    docColors: ["red"],
    bucketOnlyConflict: true,
  });

  assert.equal(penalty, 0.8);
});

test("near-identical explicit color mismatches remain stricter than inferred color mismatches", () => {
  const explicitPenalty = computeColorContradictionPenalty({
    desiredColorsTier: ["blue"],
    rerankColorMode: "any",
    hasExplicitColorIntent: true,
    hasInferredColorSignal: false,
    hasCropColorSignal: false,
    rawVisual: 0.96,
    nearIdenticalRawMin: 0.93,
    docColors: ["red"],
    bucketOnlyConflict: true,
  });

  const inferredPenalty = computeColorContradictionPenalty({
    desiredColorsTier: ["blue"],
    rerankColorMode: "any",
    hasExplicitColorIntent: false,
    hasInferredColorSignal: true,
    hasCropColorSignal: false,
    rawVisual: 0.96,
    nearIdenticalRawMin: 0.93,
    docColors: ["red"],
    bucketOnlyConflict: true,
  });

  assert.equal(explicitPenalty, 0.9);
  assert.equal(inferredPenalty, 0.93);
  assert.ok(inferredPenalty > explicitPenalty);
});
