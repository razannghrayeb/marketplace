import test from "node:test";
import assert from "node:assert/strict";
import { validateComparableProductSet } from "../api/comparability";
import type { RawProduct } from "../types";

function p(id: number, title: string, category: string): RawProduct {
  return {
    id,
    title,
    brand: "Brand",
    category,
    price: 100,
    imageUrls: [],
  };
}

test("accepts all-fashion set", () => {
  const result = validateComparableProductSet([
    p(1, "Seamed Mini Dress", "dress"),
    p(2, "Colorblock Sweatshirt", "tops"),
    p(3, "Leather Ankle Boot", "footwear"),
  ]);

  assert.equal(result.valid, true);
  assert.deepEqual(result.nonFashionProductIds, []);
});

test("rejects mixed set with non-fashion item", () => {
  const result = validateComparableProductSet([
    p(154711, "The Caftan Dress | Beech", "dress"),
    p(38672, "Vamp! Creamy Duo", "beauty"),
  ]);

  assert.equal(result.valid, false);
  assert.deepEqual(result.nonFashionProductIds, [38672]);
});
