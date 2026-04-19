import test from "node:test";
import assert from "node:assert/strict";
import { CompareDecisionRequestSchema } from "../api/schemas";
import { runCompareDecisionEngine } from "../engine/compareEngine";
import type { RawProduct } from "../types";

const products: RawProduct[] = [
  {
    id: 141076,
    title: "Seamed Mini Dress | Peyote",
    brand: "A",
    category: "dress",
    subcategory: "mini dress",
    price: 120,
    description: "Polished expressive party dress with structured silhouette.",
    imageUrls: [],
    styleTags: ["polished", "expressive"],
    occasionTags: ["party"],
  },
  {
    id: 154711,
    title: "The Caftan Dress | Beech",
    brand: "B",
    category: "dress",
    subcategory: "caftan dress",
    price: 140,
    description: "Relaxed versatile dress designed for daily comfort and repeat wear.",
    imageUrls: [],
    styleTags: ["relaxed", "minimal"],
    occasionTags: ["casual"],
  },
];

test("schema maps requestedGoal/requestedOccasion aliases", () => {
  const parsed = CompareDecisionRequestSchema.safeParse({
    product_ids: [141076, 154711],
    requestedGoal: "style_match",
    requestedOccasion: "party",
  });

  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.compareGoal, "style_match");
    assert.equal(parsed.data.occasion, "party");
  }
});

test("explicit comparisonMode override is honored", () => {
  const response = runCompareDecisionEngine(products, {
    productIds: [141076, 154711],
    comparisonMode: "direct_head_to_head",
  });

  assert.equal(response.comparisonMode, "direct_head_to_head");
  assert.match(response.comparisonContext.modeReason, /Requested mode 'direct_head_to_head' was applied|matches auto-resolved mode/);
});

test("requestedOccasion alias propagates to response and occasion scoring path", () => {
  const parsed = CompareDecisionRequestSchema.parse({
    product_ids: [141076, 154711],
    requestedGoal: "style_match",
    requestedOccasion: "party",
  });

  const response = runCompareDecisionEngine(products, parsed);

  assert.equal(response.requestedGoal, "style_match");
  assert.equal(response.requestedOccasion, "party");
});
