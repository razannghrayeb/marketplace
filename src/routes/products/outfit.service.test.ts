import test from "node:test";
import assert from "node:assert/strict";
import { completeStyleCategoryLabel } from "./outfit-category";

test("bag titles with jeans in the brand name stay grouped as bags", () => {
  const label = completeStyleCategoryLabel("Pepe Jeans Men Bag AMPJS26BABPP901");

  assert.equal(label, "Bags");
});
