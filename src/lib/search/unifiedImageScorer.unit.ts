import test from "node:test";
import assert from "node:assert/strict";
import { computeDocFamilySignals, scoreCandidateUnified, type UnifiedScoreInputs } from "./unifiedImageScorer";

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
    desiredSleeve: "short",
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

test("unified scorer caps pure outerwear leakage in top searches", () => {
  const result = scoreCandidateUnified(baseInput({
    exactTypeScore: 0,
    productTypeCompliance: 0.34,
    siblingClusterScore: 0,
    parentHypernymScore: 0,
    crossFamilyPenalty: 0.55,
    osSimilarity01: 0.93,
    sleeveCompliance: 1,
    detectionProductCategory: "tops",
    docIsTopLike: false,
    docIsOuterwearOrTailoredLike: true,
  }));

  assert.ok(result.caps.some((cap) => cap.reason === "top_outerwear_family_cap"));
  assert.notEqual(result.floorReason, "exact_color_priority_floor");
  assert.ok(result.score <= 0.572);
});

test("unified scorer does not let exact color floor rescue sleeve mismatches", () => {
  const matching = scoreCandidateUnified(baseInput({
    sleeveCompliance: 1,
    osSimilarity01: 0.86,
  }));
  const mismatched = scoreCandidateUnified(baseInput({
    sleeveCompliance: 0,
    osSimilarity01: 0.89,
  }));

  assert.equal(mismatched.floorReason, null);
  assert.ok(mismatched.caps.some((cap) => cap.reason === "sleeve_mismatch_cap"));
  assert.ok(matching.score > mismatched.score);
});

test("unified scorer treats sparse long-sleeve catalog evidence as unknown, not a confirmed mismatch", () => {
  const sparseLongSleeve = scoreCandidateUnified(baseInput({
    desiredSleeve: "long",
    sleeveCompliance: 0.15,
    exactTypeScore: 1,
    productTypeCompliance: 1,
    colorTier: "family",
    colorCompliance: 0.82,
    osSimilarity01: 0.86,
  }));
  const confirmedSleeveless = scoreCandidateUnified(baseInput({
    desiredSleeve: "long",
    sleeveCompliance: 0,
    exactTypeScore: 1,
    productTypeCompliance: 1,
    colorTier: "family",
    colorCompliance: 0.82,
    osSimilarity01: 0.86,
  }));

  assert.ok(!sparseLongSleeve.caps.some((cap) => cap.reason === "sleeve_mismatch_cap"));
  assert.ok(confirmedSleeveless.caps.some((cap) => cap.reason === "sleeve_mismatch_cap"));
  assert.ok(sparseLongSleeve.score > confirmedSleeveless.score);
});

test("unified scorer caps plain top leakage in outerwear searches", () => {
  const result = scoreCandidateUnified(baseInput({
    exactTypeScore: 0,
    productTypeCompliance: 0.34,
    siblingClusterScore: 0,
    parentHypernymScore: 0,
    crossFamilyPenalty: 0.55,
    osSimilarity01: 0.93,
    sleeveCompliance: 1,
    detectionProductCategory: "outerwear",
    docIsTopLike: true,
    docIsOuterwearOrTailoredLike: false,
  }));

  assert.ok(result.caps.some((cap) => cap.reason === "outerwear_plain_top_family_cap"));
  assert.notEqual(result.floorReason, "exact_color_priority_floor");
  assert.ok(result.score <= 0.572);
});

test("unified scorer preserves near-identical type-aligned matches across top outerwear ambiguity", () => {
  const result = scoreCandidateUnified(baseInput({
    exactTypeScore: 1,
    productTypeCompliance: 1,
    crossFamilyPenalty: 0.55,
    osSimilarity01: 0.98,
    detectionProductCategory: "tops",
    docIsTopLike: false,
    docIsOuterwearOrTailoredLike: true,
  }));

  assert.ok(!result.caps.some((cap) => cap.reason === "top_outerwear_family_cap"));
  assert.equal(result.floorReason, "near_identical_floor");
  assert.ok(result.score >= 0.91);
});

test("unified scorer treats fleece catalog rows as layered top and outerwear signals", () => {
  const signals = computeDocFamilySignals({
    title: "Thermal Full Zip",
    category: "Fleece",
    category_canonical: "outerwear",
    product_types: ["fleece", "outerwear"],
  });

  assert.equal(signals.docIsTopLike, true);
  assert.equal(signals.docIsOuterwearOrTailoredLike, true);
});
