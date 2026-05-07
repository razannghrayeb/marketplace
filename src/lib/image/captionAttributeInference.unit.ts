import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { primaryColorHintFromCaption } from "./captionAttributeInference";

describe("primaryColorHintFromCaption", () => {
  it("uses the bottom color for jeans products instead of a top color", () => {
    const color = primaryColorHintFromCaption(
      "a model wearing a white top and blue jeans",
      { title: "High-rise straight jeans", category: "Jeans" },
    );

    assert.equal(color, "blue");
  });

  it("does not write a jeans color from a caption that only colors another garment", () => {
    const color = primaryColorHintFromCaption(
      "a model wearing a white top and jeans",
      { title: "High-rise straight jeans", category: "Jeans" },
    );

    assert.equal(color, null);
  });

  it("uses the top color for top products when multiple garments are present", () => {
    const color = primaryColorHintFromCaption(
      "a model wearing a white top and blue jeans",
      { title: "Cotton crop top", category: "T-Shirts" },
    );

    assert.equal(color, "off-white");
  });

  it("skips ambiguous multi-garment captions without product context", () => {
    const color = primaryColorHintFromCaption("a model wearing a white top and blue jeans");

    assert.equal(color, null);
  });
});
