import test from "node:test";
import assert from "node:assert/strict";
import { completeStyleCategoryLabel } from "./outfit-category";

test("bag titles with jeans in the brand name stay grouped as bags", () => {
  const label = completeStyleCategoryLabel("Pepe Jeans Men Bag AMPJS26BABPP901");

  assert.equal(label, "Bags");
});

test("dress shoes stay grouped as shoes", () => {
  const label = completeStyleCategoryLabel("Women's Dress Shoes Penny Loafer");

  assert.equal(label, "Shoes");
});

test("fitness belts stay grouped as accessories, not bags", () => {
  const label = completeStyleCategoryLabel("Adidas Accessories Nylon Weightlifting Fitness Belt Black/Red");

  assert.equal(label, "Accessories");
});
