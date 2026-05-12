import test from "node:test";
import assert from "node:assert/strict";
import { completeStyleCategoryLabel } from "./outfit-category";
import { __outfitServiceTest } from "./outfit.service";

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

test("skirt titles with trench coat color names stay grouped as bottoms", () => {
  const label = completeStyleCategoryLabel("Skirts Seamed Midi Skirt | Trench Coat Khaki");

  assert.equal(label, "Bottoms");
});

test("dress pants stay grouped as bottoms", () => {
  const label = completeStyleCategoryLabel("Women's Dress Pants Straight Leg Trouser");

  assert.equal(label, "Bottoms");
});

test("color extraction does not read red from embroidered copy", () => {
  const buckets = __outfitServiceTest.extractColorBucketsFromText(
    "Organic cotton Classic fit Embroidered crocodile on chest"
  );

  assert.equal(buckets.has("red"), false);
});

test("white source bottoms comfort palette stays neutral without hidden red", () => {
  const reason = __outfitServiceTest.colorComfortHintForCategory(
    {
      occasion: "semi-formal",
      aesthetic: "classic",
      season: "summer",
      formality: 6,
      colorProfile: {
        primary: "white",
        type: "neutral",
        harmonies: [{ type: "neutral", colors: ["black", "white", "gray", "beige", "cream", "navy", "tan", "camel"] }],
      },
    },
    "Bottoms",
    {
      color: "white",
      title: "Original L.12.12 Striped Cotton Polo Shirt - PH9753",
      category: "POLOS",
      description: "Organic cotton Classic fit, comfortable sleeves Polo collar Button placket Embroidered crocodile on chest",
    }
  );

  assert.equal(reason, "Comfortable bottoms colors with white: black, white, gray.");
});
