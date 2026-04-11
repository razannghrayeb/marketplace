import test from "node:test";
import assert from "node:assert/strict";
import { normalizeProduct } from "../engine/normalization";

test("normalization computes effective price and bounded signals", () => {
  const product = normalizeProduct({
    id: 1,
    title: "Slim Tailored Blazer",
    brand: "A",
    category: "blazer",
    price: 100,
    salePrice: 80,
    description: "Tailored blazer with structured shoulders and wool blend.",
    imageUrls: ["x"],
  });

  assert.equal(product.effectivePrice, 80);
  assert.ok(product.imageSignals.structureLevel >= 0 && product.imageSignals.structureLevel <= 1);
  assert.ok(product.usageSignals.versatility >= 0 && product.usageSignals.versatility <= 1);
});
