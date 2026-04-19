import test from "node:test";
import assert from "node:assert/strict";
import { compareProductsWithDecisionIntelligence } from "../api/compareDecision.service";

test("api service returns validation error for invalid payload", async () => {
  const result = await compareProductsWithDecisionIntelligence({ productIds: [1] });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "INVALID_REQUEST");
  }
});
