import test from "node:test";
import assert from "node:assert/strict";
import { CompareDecisionRequestSchema } from "../api/schemas";

test("schema accepts snake_case and camelCase fields", () => {
  const parsed = CompareDecisionRequestSchema.parse({
    product_ids: [1, 2],
    compare_goal: "best_value",
    occasion: "work",
  });

  assert.deepEqual(parsed.productIds, [1, 2]);
  assert.equal(parsed.compareGoal, "best_value");
  assert.equal(parsed.occasion, "work");
});

test("schema accepts numeric string product IDs and normalizes to numbers", () => {
  const parsed = CompareDecisionRequestSchema.parse({
    product_ids: ["135598", "136405"],
  });

  assert.deepEqual(parsed.productIds, [135598, 136405]);
});

test("schema rejects duplicate IDs", () => {
  const result = CompareDecisionRequestSchema.safeParse({ productIds: [5, 5] });
  assert.equal(result.success, false);
});
