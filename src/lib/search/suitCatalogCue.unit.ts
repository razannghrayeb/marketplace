import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { explainActualSuitCatalogCue, hasActualSuitCatalogCue } from "./suitCatalogCue";

describe("suitCatalogCue", () => {
  it("accepts true suit and tuxedo catalog cues", () => {
    assert.equal(hasActualSuitCatalogCue({ title: "Men Slim Fit Suit", category: "Suits" }), true);
    assert.equal(hasActualSuitCatalogCue({ title: "Black Tuxedo", category: "Formalwear" }), true);
    assert.equal(hasActualSuitCatalogCue({ title: "Blazer and Trouser Set", category: "Tailored" }), true);
  });

  it("does not treat activewear suit phrases as formal suits", () => {
    const cue = explainActualSuitCatalogCue({
      title: "Reebok Workout Ready Men Training Suit Black",
      category: "Suit",
      brand: "Reebok",
    });

    assert.equal(cue.matched, false);
    assert.ok(cue.reasons.includes("non_tailored_suit_phrase"));
  });

  it("accepts suit jacket listings when they live in a formal context", () => {
    assert.equal(
      hasActualSuitCatalogCue({
        title: "Men Wool Suit Jacket",
        category: "Tailored",
        category_canonical: "tailored",
      }),
      true,
    );
  });

  it("does not treat suit jackets as full suits outside formal context", () => {
    const cue = explainActualSuitCatalogCue({
      title: "Men Wool Suit Jacket",
      category: "Outerwear",
    });

    assert.equal(cue.matched, false);
    assert.ok(cue.reasons.includes("suit_jacket_only"));
  });
});
