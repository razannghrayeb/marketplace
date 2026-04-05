import test from "node:test";
import assert from "node:assert/strict";
import { normalizeProducts } from "../engine/normalization";
import { resolveComparisonMode } from "../engine/modeResolver";

test("mode resolver returns outfit_compare for mixed categories", () => {
  const profiles = normalizeProducts([
    { id: 1, title: "Blazer", brand: "A", category: "blazer", price: 100, imageUrls: ["x"] },
    { id: 2, title: "Sneaker", brand: "B", category: "sneaker", price: 90, imageUrls: ["x"] },
  ]);

  const mode = resolveComparisonMode(profiles);
  assert.equal(mode.comparisonMode, "outfit_compare");
});
