import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildProductSearchDocument,
  extractProductTypesFromTitle,
} from "./searchDocument";

describe("extractProductTypesFromTitle - robust type normalization", () => {
  it("does not collapse shirt into tshirt", () => {
    const types = extractProductTypesFromTitle("Men Shirt Jacket");
    assert.ok(types.includes("shirt"));
    assert.ok(!types.includes("tshirt"));
  });

  it("does not collapse blouse into tshirt", () => {
    const types = extractProductTypesFromTitle("Women Blouse");
    assert.ok(types.includes("blouse"));
    assert.ok(!types.includes("tshirt"));
  });

  it("short sleeve phrase does not create shorts type", () => {
    const types = extractProductTypesFromTitle("Short Sleeve Top");
    assert.ok(types.includes("top"));
    assert.ok(!types.includes("shorts"));
  });

  it("real shorts title still maps to shorts", () => {
    const types = extractProductTypesFromTitle("Cotton Shorts");
    assert.ok(types.includes("shorts"));
  });

  it("denim skirt title does not create trouser product types", () => {
    const doc = buildProductSearchDocument({
      productId: 3,
      title: "Mid Length Dark Blue Light Weight Denim Skirt",
      category: "skirt",
    });

    assert.ok(doc.product_types.includes("skirt"));
    assert.ok(!doc.product_types.includes("jeans"));
    assert.ok(!doc.product_types.includes("pants"));
  });

  it("multi-category sanity across families", () => {
    assert.ok(extractProductTypesFromTitle("Leather Boots").includes("boots"));
    assert.ok(extractProductTypesFromTitle("Cargo Pants").includes("pants"));
    assert.ok(extractProductTypesFromTitle("Zip Hoodie").includes("hoodie"));
  });

  it("shirt jacket titles are normalized toward outerwear in the indexed document", () => {
    const doc = buildProductSearchDocument({
      productId: 1,
      title: "Men Shirt Jacket",
      category: "shirts",
    });

    assert.equal(doc.category_canonical, "outerwear");
    assert.ok(!doc.product_types.includes("shirt"));
  });

  it("infers audience gender from parent product URL when title has no gender cue", () => {
    const doc = buildProductSearchDocument({
      productId: 2,
      title: "Clean Oxford Shirt",
      category: "shirts",
      parentProductUrl: "https://shop.test/collections/women-shirts/clean-oxford",
    });

    assert.equal(doc.attr_gender, "women");
    assert.equal(doc.audience_gender, "women");
  });
});
