import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tieredColorMatchScore, tieredColorListCompliance } from "./colorCanonical";

describe("colorCanonical", () => {
  it("tieredColorMatchScore exact off-white", () => {
    const m = tieredColorMatchScore("off-white", ["off-white", "cream"]);
    assert.equal(m.tier, "exact");
    assert.equal(m.score, 1);
  });

  it("tieredColorMatchScore family cream vs white query", () => {
    const m = tieredColorMatchScore("cream", ["white", "ivory"]);
    assert.equal(m.tier, "family");
    assert.ok(m.score > 0.5);
  });

  it("tieredColorListCompliance any mode", () => {
    const r = tieredColorListCompliance(["navy", "blue"], ["navy", "denim"], "any");
    assert.ok(r.compliance > 0);
  });

  it("tieredColorMatchScore light-blue exact match preferred over white", () => {
    // User searches for "light-blue" → product has both "light-blue" and "white"
    // Should return light-blue as exact match, not white fallback
    const m = tieredColorMatchScore("light-blue", ["white", "light-blue"]);
    assert.equal(m.tier, "exact");
    assert.equal(m.score, 1);
    assert.equal(m.matchedColor, "light-blue");
  });

  it("tieredColorMatchScore light color with white-only product returns low fallback score", () => {
    // User searches for "light-blue" → product only has "white"
    // Should return white as bucket fallback with low score (0.28, not 0.56)
    const m = tieredColorMatchScore("light-blue", ["white"]);
    assert.equal(m.tier, "bucket");
    assert.ok(m.score > 0, "Should have some score for white fallback");
    assert.ok(m.score < 0.35, "White fallback score should be low (around 0.28)");
    assert.equal(m.matchedColor, "white");
  });

  it("tieredColorMatchScore light color prefers blue bucket over white fallback", () => {
    // User searches for "light-blue" → product has "navy" (same bucket)
    // Should prefer navy bucket match over white fallback
    const m = tieredColorMatchScore("light-blue", ["navy"]);
    assert.equal(m.tier, "bucket");
    assert.ok(m.score > 0.5, "Blue bucket match should score > 0.5");
    assert.equal(m.matchedColor, "navy");
  });

  it("treats merchant black names as black for charcoal suit matching", () => {
    const m = tieredColorMatchScore("charcoal", ["Night Black"]);
    assert.equal(m.tier, "family");
    assert.ok(m.score >= 0.9);
    assert.equal(m.matchedColor, "Night Black");
  });

  it("treats Iron Gate as charcoal for dark suit matching", () => {
    const m = tieredColorMatchScore("charcoal", ["Iron Gate"]);
    assert.equal(m.tier, "exact");
    assert.equal(m.score, 1);
    assert.equal(m.matchedColor, "Iron Gate");
  });
});
