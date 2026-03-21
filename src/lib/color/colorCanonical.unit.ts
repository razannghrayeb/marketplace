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
});
