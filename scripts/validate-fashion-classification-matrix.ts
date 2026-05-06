import assert from "node:assert/strict";
import { buildStructuredBlipOutput } from "../src/lib/image/blipStructured";
import { inferColorFromCaption } from "../src/lib/image/captionAttributeInference";
import { normalizeHydratedProduct } from "../src/lib/search/productNormalization";
import { computeHitRelevance } from "../src/lib/search/searchHitRelevance";

type ProductSource = Record<string, unknown>;

function hit(source: ProductSource) {
  return { _source: source } as any;
}

function relevance(source: ProductSource, intent: Partial<Parameters<typeof computeHitRelevance>[2]> = {}) {
  return relevanceAt(0.88, source, intent);
}

function relevanceAt(
  clipSimilarity: number,
  source: ProductSource,
  intent: Partial<Parameters<typeof computeHitRelevance>[2]> = {},
) {
  return computeHitRelevance(hit(source), clipSimilarity, {
    desiredProductTypes: [],
    desiredColors: [],
    desiredColorsTier: [],
    rerankColorMode: "any",
    mergedCategory: "",
    astCategories: [],
    hasAudienceIntent: false,
    crossFamilyPenaltyWeight: 420,
    tightSemanticCap: true,
    reliableTypeIntent: true,
    ...intent,
  });
}

const normalizationCases: Array<{
  name: string;
  product: ProductSource;
  family: string | null;
  type: string | null;
  subtype?: string | null;
  color?: string | null;
}> = [
  { name: "t-shirt", product: { category: "T-Shirts" }, family: "tops", type: "tshirt" },
  { name: "polo", product: { category: "Polo Shirts" }, family: "tops", type: "polo" },
  { name: "shirt", product: { category: "Shirts" }, family: "tops", type: "shirt" },
  { name: "blouse", product: { category: "Blouses" }, family: "tops", type: "blouse" },
  { name: "sleeveless top", product: { title: "Sleeveless Cami Top" }, family: "tops", type: "sleeveless_top" },
  { name: "sweater", product: { category: "Knitwear" }, family: "tops", type: "sweater", subtype: "knitwear" },
  { name: "cardigan", product: { category: "Cardigan" }, family: "tops", type: "cardigan" },
  { name: "sweatshirt", product: { category: "Sweatshirts" }, family: "tops", type: "sweatshirt" },
  { name: "hoodie", product: { title: "Men Hoodie" }, family: "tops", type: "hoodie" },
  { name: "trousers", product: { category: "Tailored Trousers" }, family: "bottoms", type: "trousers" },
  { name: "jeans", product: { category: "Blue Jeans" }, family: "bottoms", type: "jeans" },
  { name: "skirt", product: { category: "Skirts" }, family: "bottoms", type: "skirt" },
  { name: "shorts", product: { category: "Bermuda Shorts" }, family: "bottoms", type: "shorts" },
  { name: "leggings", product: { category: "Leggings" }, family: "bottoms", type: "leggings" },
  { name: "mini dress", product: { title: "Black Mini Dress" }, family: "dresses", type: "dress", subtype: "mini_dress", color: "black" },
  { name: "midi dress", product: { title: "Red Midi Dress" }, family: "dresses", type: "dress", subtype: "midi_dress", color: "red" },
  { name: "maxi dress", product: { title: "Green Maxi Dress" }, family: "dresses", type: "dress", subtype: "maxi_dress", color: "green" },
  { name: "tank dress", product: { title: "White Tank Dress" }, family: "dresses", type: "dress", subtype: "tank_dress", color: "white" },
  { name: "short sleeve dress", product: { title: "Blue Short Sleeve Dress" }, family: "dresses", type: "dress", subtype: "short_sleeve_dress", color: "blue" },
];

for (const c of normalizationCases) {
  const normalized = normalizeHydratedProduct(c.product);
  assert.equal(normalized.normalizedFamily, c.family, `${c.name}: family`);
  assert.equal(normalized.normalizedType, c.type, `${c.name}: type`);
  if ("subtype" in c) assert.equal(normalized.normalizedSubtype, c.subtype ?? null, `${c.name}: subtype`);
  if ("color" in c) assert.equal(normalized.normalizedColor, c.color ?? null, `${c.name}: color`);
}

const colorCases: Array<{
  name: string;
  desired: string[];
  productColor: string;
  min?: number;
  max?: number;
}> = [
  { name: "white exact", desired: ["white"], productColor: "white", min: 1 },
  { name: "white/off-white compatible", desired: ["white", "off-white"], productColor: "cream", min: 0.9 },
  { name: "white vs brown low", desired: ["white", "off-white"], productColor: "brown", max: 0.45 },
  { name: "gray vs brown low", desired: ["gray"], productColor: "brown", max: 0.18 },
  { name: "blue exact", desired: ["blue"], productColor: "blue", min: 1 },
  { name: "pink typo family", desired: ["pink"], productColor: "fuhsia", min: 0.7 },
];

for (const c of colorCases) {
  const rel = relevance(
    {
      title: `${c.productColor} test product`,
      category: "shirts",
      category_canonical: "tops",
      product_types: ["shirt"],
      color: c.productColor,
    },
    {
      desiredProductTypes: ["shirt"],
      desiredColors: c.desired,
      desiredColorsTier: c.desired,
      mergedCategory: "tops",
      astCategories: ["tops"],
    },
  );
  if (typeof c.min === "number") assert.ok(rel.colorCompliance >= c.min, `${c.name}: ${rel.colorCompliance}`);
  if (typeof c.max === "number") assert.ok(rel.colorCompliance <= c.max, `${c.name}: ${rel.colorCompliance}`);
}

const sleeveCases: Array<{
  name: string;
  desiredSleeve: "short" | "long" | "sleeveless";
  source: ProductSource;
  min?: number;
  max?: number;
}> = [
  {
    name: "short sleeve shirt matches short intent",
    desiredSleeve: "short",
    source: { title: "Men Short Sleeve Shirt", category: "shirts", category_canonical: "tops", product_types: ["shirt"], attr_sleeve: "short-sleeve" },
    min: 1,
  },
  {
    name: "long sleeve shirt mismatches short intent",
    desiredSleeve: "short",
    source: { title: "Men Long Sleeve Shirt", category: "shirts", category_canonical: "tops", product_types: ["shirt"], attr_sleeve: "long-sleeve" },
    max: 0.2,
  },
  {
    name: "sleeveless tank matches sleeveless intent",
    desiredSleeve: "sleeveless",
    source: { title: "Women Tank Top", category: "tops", category_canonical: "tops", product_types: ["tank"], attr_sleeve: "sleeveless" },
    min: 1,
  },
  {
    name: "hoodie infers long sleeve",
    desiredSleeve: "long",
    source: { title: "Men Hoodie", category: "hoodies", category_canonical: "tops", product_types: ["hoodie"] },
    min: 0.6,
  },
  {
    name: "bottoms ignore sleeve intent",
    desiredSleeve: "short",
    source: { title: "Blue Jeans", category: "jeans", category_canonical: "bottoms", product_types: ["jeans"] },
    max: 0,
  },
];

for (const c of sleeveCases) {
  const rel = relevance(c.source, {
    desiredProductTypes: ["top", "shirt"],
    desiredSleeve: c.desiredSleeve,
    mergedCategory: "tops",
    astCategories: ["tops"],
  });
  if (typeof c.min === "number") assert.ok(rel.sleeveCompliance >= c.min, `${c.name}: ${rel.sleeveCompliance}`);
  if (typeof c.max === "number") assert.ok(rel.sleeveCompliance <= c.max, `${c.name}: ${rel.sleeveCompliance}`);
}

const categoryTreatmentCases: Array<{
  name: string;
  source: ProductSource;
  desiredProductTypes: string[];
  mergedCategory: string;
  astCategories: string[];
  minCategory?: number;
  minCrossFamily?: number;
  maxFinal?: number;
}> = [
  {
    name: "top intent accepts top",
    source: { title: "White T-Shirt", category: "T-Shirts", category_canonical: "tops", product_types: ["tshirt"] },
    desiredProductTypes: ["tshirt"],
    mergedCategory: "tops",
    astCategories: ["tops"],
    minCategory: 0.9,
  },
  {
    name: "bottom intent accepts jeans",
    source: { title: "Blue Jeans", category: "Jeans", category_canonical: "bottoms", product_types: ["jeans"] },
    desiredProductTypes: ["jeans"],
    mergedCategory: "bottoms",
    astCategories: ["bottoms"],
    minCategory: 0.9,
  },
  {
    name: "dress intent accepts dress",
    source: { title: "White Midi Dress", category: "Dresses", category_canonical: "dresses", product_types: ["dress"] },
    desiredProductTypes: ["dress"],
    mergedCategory: "dresses",
    astCategories: ["dresses"],
    minCategory: 0.9,
  },
  {
    name: "top intent rejects shoes",
    source: { title: "Running Sneaker", category: "Shoes", category_canonical: "footwear", product_types: ["sneaker"] },
    desiredProductTypes: ["shirt"],
    mergedCategory: "tops",
    astCategories: ["tops"],
    minCrossFamily: 0.8,
    maxFinal: 0.2,
  },
  {
    name: "dress intent rejects trousers",
    source: { title: "Tailored Trousers", category: "Trousers", category_canonical: "bottoms", product_types: ["trousers"] },
    desiredProductTypes: ["dress"],
    mergedCategory: "dresses",
    astCategories: ["dresses"],
    minCrossFamily: 0.8,
    maxFinal: 0.2,
  },
];

for (const c of categoryTreatmentCases) {
  const rel = relevance(c.source, {
    desiredProductTypes: c.desiredProductTypes,
    mergedCategory: c.mergedCategory,
    astCategories: c.astCategories,
  });
  if (typeof c.minCategory === "number") assert.ok(rel.categoryRelevance01 >= c.minCategory, `${c.name}: category ${rel.categoryRelevance01}`);
  if (typeof c.minCrossFamily === "number") assert.ok(rel.crossFamilyPenalty >= c.minCrossFamily, `${c.name}: cross ${rel.crossFamilyPenalty}`);
  if (typeof c.maxFinal === "number") assert.ok(rel.finalRelevance01 <= c.maxFinal, `${c.name}: final ${rel.finalRelevance01}`);
}

const trouserVsShorts = relevance(
  {
    title: "Bermuda Shorts",
    category: "Shorts",
    category_canonical: "bottoms",
    product_types: ["shorts"],
  },
  {
    desiredProductTypes: ["trousers"],
    mergedCategory: "bottoms",
    astCategories: ["bottoms"],
  },
);
assert.ok(trouserVsShorts.crossFamilyPenalty >= 0.8, `trouser intent vs shorts: cross ${trouserVsShorts.crossFamilyPenalty}`);
assert.ok(trouserVsShorts.finalRelevance01 <= 0.02, `trouser intent vs shorts: final ${trouserVsShorts.finalRelevance01}`);

const suitVsCoat = relevance(
  {
    title: "Wool Overcoat",
    category: "Coats",
    category_canonical: "outerwear",
    product_types: ["coat"],
  },
  {
    desiredProductTypes: ["suits"],
    mergedCategory: "tailored",
    astCategories: ["tailored"],
  },
);
assert.ok(suitVsCoat.finalRelevance01 <= 0.02, `full suit intent vs coat: final ${suitVsCoat.finalRelevance01}`);
assert.equal(suitVsCoat.hardBlocked, true, "full suit intent vs coat should hard block");

const womenSuitUnknownGender = relevance(
  {
    title: "Tailored Suit Set",
    category: "Tailored",
    category_canonical: "tailored",
    product_types: ["suit"],
  },
  {
    desiredProductTypes: ["suits"],
    mergedCategory: "tailored",
    astCategories: ["tailored"],
    audienceGenderForScoring: "women",
    hasAudienceIntent: true,
  },
);
assert.ok(
  womenSuitUnknownGender.audienceCompliance >= 0.7,
  `women suit with unknown gender should not be treated as men's-only: audience ${womenSuitUnknownGender.audienceCompliance}`,
);

const menDressAudience = relevance(
  {
    title: "Floral Midi Dress",
    category: "Dresses",
    category_canonical: "dresses",
    product_types: ["dress"],
  },
  {
    desiredProductTypes: ["dress"],
    mergedCategory: "dresses",
    astCategories: ["dresses"],
    audienceGenderForScoring: "men",
    hasAudienceIntent: true,
  },
);
assert.equal(menDressAudience.audienceCompliance, 0, `men query vs dress audience ${menDressAudience.audienceCompliance}`);

const blipCases: Array<{
  name: string;
  caption: string;
  expectedMain?: string;
  expectedTypeHint?: string;
  expectedColorSlot?: Partial<ReturnType<typeof inferColorFromCaption>>;
  expectedGender?: string;
  expectedMinConfidence?: number;
}> = [
  {
    name: "BLIP white shirt and blue jeans",
    caption: "A man wearing a white shirt and blue jeans",
    expectedTypeHint: "shirt",
    expectedColorSlot: { topColor: "off-white", jeansColor: "blue" },
    expectedGender: "men",
    expectedMinConfidence: 0.6,
  },
  {
    name: "BLIP gray sweater and black pants",
    caption: "A woman wearing a gray sweater and black pants",
    expectedTypeHint: "sweater",
    expectedColorSlot: { topColor: "gray", jeansColor: "black" },
    expectedGender: "women",
    expectedMinConfidence: 0.6,
  },
  {
    name: "BLIP white dress",
    caption: "A white sleeveless midi dress on a mannequin",
    expectedMain: "dress",
    expectedTypeHint: "dress",
    expectedColorSlot: { garmentColor: "off-white" },
    expectedMinConfidence: 0.5,
  },
  {
    name: "BLIP shoe color",
    caption: "A pair of white sneakers on the floor",
    expectedTypeHint: "shoe",
    expectedColorSlot: { shoeColor: "off-white" },
    expectedMinConfidence: 0.45,
  },
];

for (const c of blipCases) {
  const structured = buildStructuredBlipOutput(c.caption);
  const colors = inferColorFromCaption(c.caption);
  if (c.expectedMain) assert.equal(structured.mainItem, c.expectedMain, `${c.name}: mainItem ${structured.mainItem}`);
  if (c.expectedTypeHint) {
    assert.ok(
      structured.productTypeHints.includes(c.expectedTypeHint),
      `${c.name}: productTypeHints ${JSON.stringify(structured.productTypeHints)}`,
    );
  }
  if (c.expectedColorSlot) {
    for (const [slot, expected] of Object.entries(c.expectedColorSlot)) {
      assert.equal((colors as any)[slot], expected, `${c.name}: ${slot}`);
    }
  }
  if (c.expectedGender) assert.equal(structured.audience.gender, c.expectedGender, `${c.name}: gender`);
  if (typeof c.expectedMinConfidence === "number") {
    assert.ok(structured.confidence >= c.expectedMinConfidence, `${c.name}: confidence ${structured.confidence}`);
  }
}

const clipCases: Array<{
  name: string;
  highSource: ProductSource;
  intent: Partial<Parameters<typeof computeHitRelevance>[2]>;
  lowClip?: number;
  highClip?: number;
  minHighFinal?: number;
  maxHighFinal?: number;
  highShouldBeatLow?: boolean;
  minCrossFamily?: number;
  maxExactType?: number;
}> = [
  {
    name: "CLIP high visual raises correct top",
    highSource: { title: "White T-Shirt", category: "T-Shirts", category_canonical: "tops", product_types: ["tshirt"], color: "white" },
    intent: {
      desiredProductTypes: ["tshirt"],
      desiredColors: ["white"],
      desiredColorsTier: ["white"],
      mergedCategory: "tops",
      astCategories: ["tops"],
      reliableTypeIntent: true,
    },
    lowClip: 0.58,
    highClip: 0.94,
    minHighFinal: 0.8,
    highShouldBeatLow: true,
  },
  {
    name: "CLIP high visual cannot override reliable top-vs-shoe mismatch",
    highSource: { title: "Running Sneaker", category: "Shoes", category_canonical: "footwear", product_types: ["sneaker"] },
    intent: {
      desiredProductTypes: ["shirt"],
      mergedCategory: "tops",
      astCategories: ["tops"],
      reliableTypeIntent: true,
    },
    highClip: 0.96,
    maxHighFinal: 0.2,
    minCrossFamily: 0.8,
  },
  {
    name: "CLIP high visual survives weak BLIP type intent but stays penalized",
    highSource: { title: "Running Sneaker", category: "Shoes", category_canonical: "footwear", product_types: ["sneaker"] },
    intent: {
      desiredProductTypes: ["dress"],
      mergedCategory: "dresses",
      astCategories: ["dresses"],
      reliableTypeIntent: false,
    },
    highClip: 0.92,
    minHighFinal: 0.45,
    minCrossFamily: 0.45,
    maxExactType: 0.65,
  },
  {
    name: "BLIP soft color bias scores color but does not hard-nuke high CLIP",
    highSource: { title: "Brown Knitwear", category: "Knitwear", category_canonical: "tops", product_types: ["sweater"], color: "brown" },
    intent: {
      desiredProductTypes: ["sweater"],
      desiredColors: ["gray"],
      desiredColorsTier: ["gray"],
      mergedCategory: "tops",
      astCategories: ["tops"],
      reliableTypeIntent: true,
      softColorBiasOnly: true,
    },
    highClip: 0.94,
    minHighFinal: 0.5,
  },
];

for (const c of clipCases) {
  const high = relevanceAt(c.highClip ?? 0.9, c.highSource, c.intent);
  if (typeof c.lowClip === "number" && c.highShouldBeatLow) {
    const low = relevanceAt(c.lowClip, c.highSource, c.intent);
    assert.ok(high.finalRelevance01 > low.finalRelevance01, `${c.name}: high ${high.finalRelevance01}, low ${low.finalRelevance01}`);
  }
  if (typeof c.minHighFinal === "number") assert.ok(high.finalRelevance01 >= c.minHighFinal, `${c.name}: final ${high.finalRelevance01}`);
  if (typeof c.maxHighFinal === "number") assert.ok(high.finalRelevance01 <= c.maxHighFinal, `${c.name}: final ${high.finalRelevance01}`);
  if (typeof c.minCrossFamily === "number") assert.ok(high.crossFamilyPenalty >= c.minCrossFamily, `${c.name}: cross ${high.crossFamilyPenalty}`);
  if (typeof c.maxExactType === "number") assert.ok(high.exactTypeScore <= c.maxExactType, `${c.name}: exact ${high.exactTypeScore}`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      normalizationCases: normalizationCases.length,
      colorCases: colorCases.length,
      sleeveCases: sleeveCases.length,
      categoryTreatmentCases: categoryTreatmentCases.length,
      blipCases: blipCases.length,
      clipCases: clipCases.length,
    },
    null,
    2,
  ),
);
