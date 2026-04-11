import test from "node:test";
import assert from "node:assert/strict";
import { serializeCompareDecisionResponse } from "../api/serializers";
import { runCompareDecisionEngine } from "../engine/compareEngine";
import { mockProducts } from "../mock/mockProducts";

test("serializer rounds numeric values while preserving structure", () => {
  const raw = runCompareDecisionEngine(
    mockProducts.slice(0, 2),
    { productIds: [101, 205], compareGoal: "best_value" },
    { version: "test" }
  );

  const out = serializeCompareDecisionResponse(raw);
  assert.equal(out.productInsights.length, raw.productInsights.length);
  assert.ok(Number.isFinite(out.decisionConfidence.score));
});
