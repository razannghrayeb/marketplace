import test from "node:test";
import assert from "node:assert/strict";
import { runCompareDecisionEngine } from "../engine/compareEngine";
import { mockProducts } from "../mock/mockProducts";

test("engine returns stable response shape for 2 products", () => {
  const response = runCompareDecisionEngine(
    mockProducts.slice(0, 2),
    {
      productIds: [101, 205],
      compareGoal: "best_value",
      occasion: "work",
      mode: "standard",
    },
    { version: "test" }
  );

  assert.ok(response.comparisonMode);
  assert.equal(response.comparisonContext.productIds.length, 2);
  assert.equal(response.productInsights.length, 2);
  assert.ok(response.winnersByContext.overall);
});
