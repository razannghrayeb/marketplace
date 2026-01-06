/**
 * Test script for semantic query understanding
 */

import { parseQuery } from "../src/lib/semanticSearch";

const testQueries = [
  "nike blue running shoes",
  "adidas red shirt under $50",
  "vintage denim jacket",
  "black dress for party",
  "hoodie size large",
  "zara summer collection",
  "cheap sneakers",
  "men formal wear",
];

console.log("=== Semantic Query Understanding Tests ===\n");

for (const query of testQueries) {
  console.log(`Query: "${query}"`);
  const parsed = parseQuery(query);
  console.log(`  Intent: ${parsed.intent}`);
  console.log(`  Entities:`);
  if (parsed.entities.brands.length > 0) 
    console.log(`    Brands: ${parsed.entities.brands.join(", ")}`);
  if (parsed.entities.categories.length > 0) 
    console.log(`    Categories: ${parsed.entities.categories.join(", ")}`);
  if (parsed.entities.colors.length > 0) 
    console.log(`    Colors: ${parsed.entities.colors.join(", ")}`);
  if (parsed.entities.sizes.length > 0) 
    console.log(`    Sizes: ${parsed.entities.sizes.join(", ")}`);
  if (parsed.entities.attributes.length > 0) 
    console.log(`    Attributes: ${parsed.entities.attributes.join(", ")}`);
  if (parsed.entities.priceRange) 
    console.log(`    Price: $${parsed.entities.priceRange.min || 0} - $${parsed.entities.priceRange.max || "∞"}`);
  console.log(`  Expanded Terms: ${parsed.expandedTerms.slice(0, 5).join(", ")}${parsed.expandedTerms.length > 5 ? "..." : ""}`);
  console.log(`  Semantic Query: "${parsed.semanticQuery}"`);
  console.log("");
}
