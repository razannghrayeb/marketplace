import test from "node:test";
import assert from "node:assert/strict";
import { normalizeProduct } from "../engine/normalization";
import { scoreQuality, scoreRisk, scoreStyle, scoreValue } from "../engine/scoring";

test("scores remain deterministic and bounded", () => {
  const profile = normalizeProduct({
    id: 1,
    title: "Minimal Cotton Shirt",
    brand: "A",
    category: "shirt",
    price: 80,
    description: "Minimal cotton shirt with clean lines and machine wash care.",
    imageUrls: ["x"],
  });

  const request = { productIds: [1, 2], compareGoal: "style_match" as const };
  const value = scoreValue(profile, 50, 120);
  const quality = scoreQuality(profile);
  const style = scoreStyle(profile, request);
  const risk = scoreRisk(profile);

  for (const s of [value, quality, style, risk]) {
    assert.ok(s >= 0 && s <= 1);
  }

  assert.equal(scoreQuality(profile), scoreQuality(profile));
});
