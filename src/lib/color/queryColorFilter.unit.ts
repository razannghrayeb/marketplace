import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  inferColorGroupFromRaw,
  normalizeColorTokensFromRaw,
} from "./queryColorFilter";

describe("queryColorFilter", () => {
  it("normalizes composite vendor color names", () => {
    const cases: Array<[string, string[]]> = [
      ["White/Navy/Wolf Grey", ["white", "blue", "gray"]],
      ["Core Black/Cloud White/Carbon", ["black", "white", "gray"]],
      ["Blue/Lemon/Aqua", ["blue", "yellow", "teal"]],
      ["White/Red Sol-X Mirror", ["white", "red"]],
      ["Olivine/Moonbeam", ["green", "white"]],
      ["Cinder/Pearl", ["gray", "white"]],
    ];

    for (const [raw, expected] of cases) {
      assert.deepEqual(normalizeColorTokensFromRaw(raw), expected, raw);
    }
  });

  it("maps vendor shade names and code-prefixed shades", () => {
    const cases: Array<[string, string[]]> = [
      ["Grape Leaf", ["green"]],
      ["Black Sage (Green)", ["green"]],
      ["Deep Cypress", ["green"]],
      ["525 french bisou", ["pink"]],
      ["2c0 - cool vanilla", ["white"]],
      ["4w2 - toasty toffee", ["brown"]],
      ["BE68 D.BLUE", ["blue"]],
      ["GR32 GRAY", ["gray"]],
      ["LA66 PINK", ["pink"]],
      ["Legink", ["blue"]],
      ["Pea Pod", ["green"]],
    ];

    for (const [raw, expected] of cases) {
      assert.deepEqual(normalizeColorTokensFromRaw(raw), expected, raw);
    }
  });

  it("maps frequent merchant color values to canonical tiers", () => {
    const cases: Array<[string, string[]]> = [
      ["Classic Blue", ["blue"]],
      ["Navy / White", ["blue", "white"]],
      ["Lily Pad", ["green"]],
      ["Tiger Stripe Toasted Coconut", ["beige", "multicolor"]],
      ["Golden Palm", ["yellow"]],
      ["Skywriting", ["blue"]],
      ["Fennel Seed", ["green"]],
      ["Kambaba", ["green"]],
      ["Bluebell", ["blue"]],
      ["Affogato", ["brown"]],
      ["Aged Brass", ["yellow"]],
      ["Pelican", ["white"]],
      ["Pepper", ["gray"]],
      ["Iron Gate", ["gray"]],
      ["Shadow Rinse", ["blue"]],
      ["White Sage", ["green"]],
      ["Vintage Tint", ["blue"]],
      ["dreamy geo combo", ["multicolor"]],
      ["paper", ["white"]],
      ["turtledove", ["beige"]],
      ["Trench Coat Khaki", ["beige"]],
      ["khaki green", ["green"]],
    ];

    for (const [raw, expected] of cases) {
      assert.deepEqual(normalizeColorTokensFromRaw(raw), expected, raw);
    }
  });

  it("does not turn size and numeric values into colors", () => {
    const inch = String.fromCharCode(34);
    const curlyInch = String.fromCharCode(0x201d);
    const cases = [
      "18964",
      "159 cm",
      "W30-L36",
      "3-4 Years",
      "30 EU",
      "46/48",
      `33${inch} Inseam`,
      `27.5${curlyInch} Inseam`,
      `29 1/2${inch} Inseam`,
      "No Pocket",
      "Pocket",
      "Ankle",
      "Thong",
      "Standard",
      "Slim",
      "Straight",
      "Regular",
      "M",
      "XL",
      "2XL",
    ];

    for (const raw of cases) {
      assert.deepEqual(normalizeColorTokensFromRaw(raw), [], raw);
      assert.equal(inferColorGroupFromRaw(raw), "unknown", raw);
    }
  });
});
