/**
 * Test: Query Processing Fix Verification
 * 
 * Tests that the semantic query maintains the original search term
 * while adding category context.
 * 
 * Issue: User searches for "blazer" → should find blazer products
 * Previous: semantic query became "outerwear", missing the original term
 * Fixed: semantic query now "blazer outerwear"
 */

import { parseQuery } from "./src/lib/search/semanticSearch";

// Test cases
const testCases = [
  {
    query: "blazer",
    expectedInSemantic: "blazer",
    description: "Single category keyword (blazer)",
  },
  {
    query: "red blazer",
    expectedInSemantic: "blazer",
    description: "Category keyword with color",
  },
  {
    query: "nike jacket",
    expectedInSemantic: "jacket",
    description: "Brand + category",
  },
  {
    query: "casual shirt",
    expectedInSemantic: "shirt",
    description: "Style + category",
  },
];

console.log("🧪 Testing Semantic Query Fix\n");

let passCount = 0;
let failCount = 0;

for (const test of testCases) {
  const result = parseQuery(test.query);
  const semanticLower = result.semanticQuery.toLowerCase();
  const expectedLower = test.expectedInSemantic.toLowerCase();
  
  const pass = semanticLower.includes(expectedLower);
  const status = pass ? "✅ PASS" : "❌ FAIL";
  
  if (pass) passCount++;
  else failCount++;
  
  console.log(`${status} | ${test.description}`);
  console.log(`     Input: "${test.query}"`);
  console.log(`     Expected "${test.expectedInSemantic}" in semantic query`);
  console.log(`     Got: "${result.semanticQuery}"`);
  console.log(`     Entities: categories=[${result.entities.categories.join(", ")}], colors=[${result.entities.colors.join(", ")}]`);
  console.log();
}

console.log(`\n📊 Results: ${passCount} passed, ${failCount} failed`);

if (failCount === 0) {
  console.log("✅ All tests passed! The fix is working correctly.");
  process.exit(0);
} else {
  console.log("❌ Some tests failed. Review the output above.");
  process.exit(1);
}
