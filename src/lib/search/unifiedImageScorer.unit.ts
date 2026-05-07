import test from "node:test";
import assert from "node:assert/strict";
import { scoreCandidateUnified, type UnifiedScoreInputs } from "./unifiedImageScorer";

function baseInput(overrides: Partial<UnifiedScoreInputs> = {}): UnifiedScoreInputs {
  return {
    exactTypeScore: 1,
    productTypeCompliance: 1,
    siblingClusterScore: 1,
    parentHypernymScore: 0,
    intraFamilyPenalty: 0,
    crossFamilyPenalty: 0.18,
    colorCompliance: 1,
    colorTier: "exact",
    audienceCompliance: 1,
    styleCompliance: 0,
    sleeveCompliance: 0.68,
    lengthCompliance: 0,
    patternCompliance: 0,
    materialCompliance: 0,
    categoryRelevance01: 1,
    osSimilarity01: 0.88,
    hasTypeIntent: true,
    hasColorIntent: true,
    hasSleeveIntent: true,
    hasLengthIntent: false,
    hasStyleIntent: false,
    hasAudienceIntent: false,
    hasExplicitColorIntent: false,
    hasInferredColorSignal: true,
    hasCropColorSignal: false,
    reliableTypeIntent: true,
    detectionProductCategory: "tops",
    detectionYoloConfidence: 0.9,
    docIsTopLike: true,
    docIsBottomLike: false,
    docIsFootwearLike: false,
    docIsDressLike: false,
    docIsOuterwearOrTailoredLike: false,
    docIsBagLike: false,
    ...overrides,
  };
}

test("unified scorer rewards exact color only when tier and compliance agree", () => {
  const result = scoreCandidateUnified(baseInput());

  assert.equal(result.components.color, 1);
  assert.equal(result.floorReason, "exact_color_priority_floor");
  assert.ok(result.score >= 0.88);
});

test("unified scorer treats stale exact color tier with zero compliance as a mismatch", () => {
  const result = scoreCandidateUnified(baseInput({
    colorCompliance: 0,
    colorTier: "exact",
  }));

  assert.equal(result.components.color, 0.12);
  assert.equal(result.floorReason, null);
  assert.ok(result.caps.some((cap) => cap.reason === "color_tier_none_cap"));
  assert.ok(result.score < 0.5);
});
