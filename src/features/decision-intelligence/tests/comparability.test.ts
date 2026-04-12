import test from "node:test";
import assert from "node:assert/strict";
import { validateComparableProductSet } from "../api/comparability";
import type { RawProduct } from "../types";

function p(
  id: number,
  title: string,
  category: string,
  opts?: { gender?: string; ageGroup?: string; description?: string }
): RawProduct {
  return {
    id,
    title,
    brand: "Brand",
    category,
    gender: opts?.gender,
    ageGroup: opts?.ageGroup,
    description: opts?.description,
    price: 100,
    imageUrls: [],
  };
}

test("accepts all-fashion set", () => {
  const result = validateComparableProductSet([
    p(1, "Seamed Mini Dress", "dress"),
    p(2, "Structured Blazer", "blazer"),
  ]);

  assert.equal(result.valid, true);
  assert.deepEqual(result.nonFashionProductIds, []);
  assert.deepEqual(result.crossGenderPairs, []);
  assert.deepEqual(result.crossAgePairs, []);
  assert.deepEqual(result.categoryMismatchPairs, []);
});

test("rejects mixed set with non-fashion item", () => {
  const result = validateComparableProductSet([
    p(154711, "The Caftan Dress | Beech", "dress"),
    p(38672, "Vamp! Creamy Duo", "beauty"),
  ]);

  assert.equal(result.valid, false);
  assert.deepEqual(result.nonFashionProductIds, [38672]);
});

test("rejects cross-gender comparisons unless one side is unisex", () => {
  const result = validateComparableProductSet([
    p(101, "Women's Tailored Blazer", "blazer", { gender: "women" }),
    p(102, "Men's Slim Blazer", "blazer", { gender: "men" }),
  ]);

  assert.equal(result.valid, false);
  assert.equal(result.crossGenderPairs.length, 1);
  assert.equal(result.reasons.includes("cross_gender_not_allowed"), true);
});

test("rejects cross-age comparisons", () => {
  const result = validateComparableProductSet([
    p(201, "Kids Cotton Hoodie", "hoodie", { ageGroup: "kids" }),
    p(202, "Adult Cotton Hoodie", "hoodie", { ageGroup: "adult" }),
  ]);

  assert.equal(result.valid, false);
  assert.equal(result.crossAgePairs.length, 1);
  assert.equal(result.reasons.includes("cross_age_group_not_allowed"), true);
});

test("rejects incompatible category pairs", () => {
  const result = validateComparableProductSet([
    p(301, "Colorblock Sweatshirt", "tops"),
    p(302, "Linen Caftan Dress", "dress"),
  ]);

  assert.equal(result.valid, false);
  assert.equal(result.categoryMismatchPairs.length, 1);
  assert.equal(result.reasons.includes("category_pair_not_compatible"), true);
});

test("accepts unisex with gendered item", () => {
  const result = validateComparableProductSet([
    p(401, "Unisex Crew Tee", "top", { gender: "unisex" }),
    p(402, "Women's Crew Tee", "top", { gender: "women" }),
  ]);

  assert.equal(result.valid, true);
  assert.equal(result.crossGenderPairs.length, 0);
});

test("does not treat 'distressed' as dress token", () => {
  const result = validateComparableProductSet([
    p(501, "Distressed Knitwear Top", "tops", { description: "Distressed texture knitwear" }),
    p(502, "Crew Sweatshirt", "tops", { description: "Cotton sweatshirt" }),
  ]);

  assert.equal(result.valid, true);
  assert.deepEqual(result.categoryMismatchPairs, []);
});
