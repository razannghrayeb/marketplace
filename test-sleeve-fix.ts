/**
 * Test to verify sleeve intent ranking fix
 * 
 * Before fix: Short sleeve detection returning long sleeve products as #1 match
 * After fix: Short sleeve products ranked higher when sleeve intent is explicit
 */

import { computeHitRelevance } from "./src/lib/search/searchHitRelevance";

console.log("Testing sleeve intent ranking fix...\n");

// Scenario: User searches with short-sleeve top image
// BEFORE FIX: Long-sleeve white shirt scores 0.82 due to high color similarity
// AFTER FIX: Long-sleeve white shirt should score much lower due to sleeve penalty

const testCases = [
  {
    name: "Long-sleeve white shirt (SHOULD RANK LOW for short-sleeve intent)",
    hit: {
      _source: {
        title: "Men Long Sleeve White Shirt",
        category: "shirts",
        category_canonical: "tops",
        product_types: ["shirt"],
        attr_sleeve: "long-sleeve",
        color: "white",
      },
    },
    similarity: 0.89, // High visual similarity due to color match
    intent: {
      desiredProductTypes: ["tshirt", "tee", "shirt"],
      desiredColors: ["white"],
      desiredColorsTier: ["exact"],
      desiredStyle: "casual",
      desiredSleeve: "short", // Explicit short sleeve intent
      rerankColorMode: "any" as any,
      mergedCategory: "tops",
      astCategories: ["tops"],
      hasAudienceIntent: false,
      crossFamilyPenaltyWeight: 420,
      tightSemanticCap: true,
    },
  },
  {
    name: "Short-sleeve white shirt (SHOULD RANK HIGH for short-sleeve intent)",
    hit: {
      _source: {
        title: "Men Short Sleeve White T-Shirt",
        category: "t-shirts",
        category_canonical: "tops",
        product_types: ["tshirt", "tee"],
        attr_sleeve: "short-sleeve",
        color: "white",
      },
    },
    similarity: 0.88, // Nearly same visual similarity
    intent: {
      desiredProductTypes: ["tshirt", "tee", "shirt"],
      desiredColors: ["white"],
      desiredColorsTier: ["exact"],
      desiredStyle: "casual",
      desiredSleeve: "short", // Explicit short sleeve intent
      rerankColorMode: "any" as any,
      mergedCategory: "tops",
      astCategories: ["tops"],
      hasAudienceIntent: false,
      crossFamilyPenaltyWeight: 420,
      tightSemanticCap: true,
    },
  },
];

const results = testCases.map((tc) => {
  const result = computeHitRelevance(tc.hit, tc.similarity, tc.intent as any);
  return {
    name: tc.name,
    similarity: tc.similarity,
    sleeveCompliance: result.sleeveCompliance,
    finalRelevance: result.finalRelevance01,
  };
});

// Display results
console.log("Results:");
console.log("-".repeat(80));
results.forEach((r) => {
  console.log(`\n${r.name}`);
  console.log(`  Similarity:       ${(r.similarity * 100).toFixed(1)}%`);
  console.log(`  Sleeve Compliance: ${(r.sleeveCompliance * 100).toFixed(1)}%`);
  console.log(`  Final Relevance:  ${(r.finalRelevance * 100).toFixed(2)}%`);
});

console.log("\n" + "-".repeat(80));
console.log("Expected behavior:");
console.log(`✓ Long-sleeve < Short-sleeve (${(results[0].finalRelevance).toFixed(3)} < ${(results[1].finalRelevance).toFixed(3)})`);
console.log(`✓ Difference should be ~0.10+ (sleeve penalty impact)`);

const diff = results[1].finalRelevance - results[0].finalRelevance;
console.log(`\nActual difference: ${(diff).toFixed(3)}`);

if (results[0].finalRelevance < results[1].finalRelevance && diff > 0.05) {
  console.log("\n✅ FIX WORKING: Short-sleeve products now rank higher!");
} else {
  console.log(
    "\n❌ FIX NOT WORKING: Sleeve penalty not strong enough"
  );
}
