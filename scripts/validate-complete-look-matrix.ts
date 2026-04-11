import assert from "node:assert/strict";
import {
  TRACKED_OUTFIT_SLOTS,
  inferMissingCategoriesForOutfit,
} from "../src/routes/wardrobe/recommendations.service";

type ScenarioContext = {
  warmWeatherLikely: boolean;
  shouldOfferOuterwear: boolean;
  label: string;
};

const SLOTS = Array.from(TRACKED_OUTFIT_SLOTS);

const CONTEXTS: ScenarioContext[] = [
  { warmWeatherLikely: true, shouldOfferOuterwear: false, label: "warm" },
  { warmWeatherLikely: true, shouldOfferOuterwear: true, label: "warm_with_outerwear_flag" },
  { warmWeatherLikely: false, shouldOfferOuterwear: false, label: "neutral" },
  { warmWeatherLikely: false, shouldOfferOuterwear: true, label: "cold" },
];

function subsetFromMask(mask: number): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < SLOTS.length; i++) {
    if ((mask & (1 << i)) !== 0) out.add(SLOTS[i]);
  }
  return out;
}

function scenarioName(currentCategories: Set<string>, context: ScenarioContext): string {
  const cats = Array.from(currentCategories).sort().join(",") || "none";
  return `${context.label}::[${cats}]`;
}

function validateScenario(currentCategories: Set<string>, context: ScenarioContext): void {
  const missing = inferMissingCategoriesForOutfit({
    currentCategories,
    warmWeatherLikely: context.warmWeatherLikely,
    shouldOfferOuterwear: context.shouldOfferOuterwear,
  });

  const label = scenarioName(currentCategories, context);
  const hasDress = currentCategories.has("dresses");
  const hasTops = currentCategories.has("tops");
  const hasBottoms = currentCategories.has("bottoms");
  const hasShoes = currentCategories.has("shoes");

  assert.ok(missing.length >= 1, `${label}: should return at least one missing category`);
  assert.ok(missing.length <= 3, `${label}: should return at most three missing categories`);
  assert.equal(new Set(missing).size, missing.length, `${label}: missing categories must be unique`);

  for (const m of missing) {
    assert.ok(TRACKED_OUTFIT_SLOTS.has(m), `${label}: unknown missing category '${m}'`);
  }

  if (hasDress) {
    if (!hasShoes) {
      assert.ok(missing.includes("shoes"), `${label}: dress outfit without shoes must request shoes`);
    }
  } else {
    if (!hasTops) {
      assert.ok(missing.includes("tops"), `${label}: non-dress outfit without tops must request tops`);
    }
    if (!hasBottoms) {
      assert.ok(missing.includes("bottoms"), `${label}: non-dress outfit without bottoms must request bottoms`);
    }
    if (!hasShoes) {
      assert.ok(missing.includes("shoes"), `${label}: non-dress outfit without shoes must request shoes`);
    }
  }

  if (context.warmWeatherLikely) {
    assert.ok(!missing.includes("outerwear"), `${label}: warm-weather scenario must not request outerwear`);
  }

  if (hasDress && !hasShoes) {
    assert.equal(missing[0], "shoes", `${label}: dress-only essential order should prioritize shoes first`);
  }
}

function runMatrix(): { scenarios: number; contexts: number; assertions: number } {
  let assertions = 0;
  const scenarioCount = 1 << SLOTS.length;

  for (let mask = 0; mask < scenarioCount; mask++) {
    const currentCategories = subsetFromMask(mask);
    for (const context of CONTEXTS) {
      validateScenario(currentCategories, context);
      assertions += 1;
    }
  }

  return {
    scenarios: scenarioCount,
    contexts: CONTEXTS.length,
    assertions,
  };
}

function runNamedRegressionCases(): void {
  const cases: Array<{ name: string; categories: string[]; context: ScenarioContext; mustInclude: string[]; mustExclude?: string[] }> = [
    {
      name: "shirt+pants (warm)",
      categories: ["tops", "bottoms"],
      context: CONTEXTS[0],
      mustInclude: ["shoes"],
      mustExclude: ["outerwear"],
    },
    {
      name: "dress-only",
      categories: ["dresses"],
      context: CONTEXTS[2],
      mustInclude: ["shoes"],
    },
    {
      name: "t-shirt+shorts (warm)",
      categories: ["tops", "bottoms"],
      context: CONTEXTS[0],
      mustInclude: ["shoes"],
      mustExclude: ["outerwear"],
    },
    {
      name: "winter layered base (tops+bottoms+outerwear)",
      categories: ["tops", "bottoms", "outerwear"],
      context: CONTEXTS[3],
      mustInclude: ["shoes"],
    },
  ];

  for (const c of cases) {
    const currentCategories = new Set(c.categories);
    const missing = inferMissingCategoriesForOutfit({
      currentCategories,
      warmWeatherLikely: c.context.warmWeatherLikely,
      shouldOfferOuterwear: c.context.shouldOfferOuterwear,
    });
    for (const req of c.mustInclude) {
      assert.ok(missing.includes(req), `${c.name}: expected '${req}' in missing categories; got ${missing.join(",")}`);
    }
    for (const blocked of c.mustExclude || []) {
      assert.ok(!missing.includes(blocked), `${c.name}: '${blocked}' must not appear; got ${missing.join(",")}`);
    }
  }
}

function main(): void {
  runNamedRegressionCases();
  const result = runMatrix();
  console.log(
    `complete-look matrix passed: ${result.scenarios} slot-combinations x ${result.contexts} contexts = ${result.assertions} validated scenarios`
  );
}

main();
