import assert from "node:assert/strict";
import { mergeComplexConstraints } from "../src/lib/queryProcessor/complexQueryParser";
import { finalizeTextSearchResponse } from "../src/lib/search/fashionSearchFacade";

function testPriceConstraintIntersection() {
  const merged = mergeComplexConstraints(
    {},
    {
      constraints: [
        { type: "price", operator: "gte", value: 20 },
        { type: "price", operator: "gte", value: 50 },
        { type: "price", operator: "lte", value: 300 },
        { type: "price", operator: "lte", value: 120 },
      ],
      logicalOps: [],
      complexity: "complex",
      explanation: [],
    } as any,
  );

  assert.equal(merged.priceRange?.min, 50, "priceRange.min must use highest gte bound");
  assert.equal(merged.priceRange?.max, 120, "priceRange.max must use lowest lte bound");
}

function testTextSearchTotalContract() {
  const output = finalizeTextSearchResponse({
    results: [{ id: "1" }, { id: "2" }] as any,
    related: [{ id: "3" }] as any,
    meta: { stage: "test" } as any,
    total: 987,
    tookMs: 12,
  });

  assert.equal(output.total, 987, "total must preserve upstream total");
  assert.equal(output.results.length, 2, "results must not be post-filtered by facade");
  assert.equal(output.related.length, 1, "related must not be post-filtered by facade");
  assert.equal((output.meta as any).total_results, 987, "meta.total_results must match total");
}

function main() {
  testPriceConstraintIntersection();
  testTextSearchTotalContract();
  console.log("verify-search-phase1: OK");
}

main();
