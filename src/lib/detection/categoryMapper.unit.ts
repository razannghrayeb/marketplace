import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mapDetectionToCategory } from "./categoryMapper";

describe("categoryMapper tailored detections", () => {
  it("maps explicit suit labels to tailored instead of an unknown suit category", () => {
    const suit = mapDetectionToCategory("suit", 1);
    assert.equal(suit.productCategory, "tailored");
    assert.ok(suit.alternativeCategories.includes("outerwear"));

    const tuxedo = mapDetectionToCategory("black tuxedo", 1);
    assert.equal(tuxedo.productCategory, "tailored");
  });
});

describe("categoryMapper outerwear spelling aliases", () => {
  it("maps detector outwear and normalized outerwear labels to the same category", () => {
    const raw = mapDetectionToCategory("long sleeve outwear", 1);
    const normalized = mapDetectionToCategory("long sleeve outerwear", 1);

    assert.equal(raw.productCategory, "outerwear");
    assert.equal(normalized.productCategory, "outerwear");
    assert.equal(raw.attributes.sleeveLength, "long");
    assert.equal(normalized.attributes.sleeveLength, "long");
  });
});
