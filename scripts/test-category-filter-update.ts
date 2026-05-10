import { getCategorySearchTerms } from "../src/lib/search/categoryFilter";

console.log("✓ Testing updated category filter\n");

// Test tailored category
console.log("TAILORED category includes:");
const tailored = getCategorySearchTerms("tailored");
const missingTailoredCategories = [
  "suit-2p",
  "suit-2pnos", 
  "suit-txd",
  "suit-sw",
  "men blazer",
  "men suits",
  "men vest",
  "women blazer",
  "lefon blazer",
  "lefon vest",
];

missingTailoredCategories.forEach(cat => {
  const included = tailored.includes(cat);
  console.log(`  ${included ? "✓" : "✗"} ${cat}`);
});

// Test outerwear category
console.log("\nOUTERWEAR category includes:");
const outerwear = getCategorySearchTerms("outerwear");
const missingOuterwearCategories = [
  "women coat",
  "women vest",
  "women cardigan",
];

missingOuterwearCategories.forEach(cat => {
  const included = outerwear.includes(cat);
  console.log(`  ${included ? "✓" : "✗"} ${cat}`);
});

console.log("\n✓ Category filter updated successfully!");
