/**
 * Test Query Processor
 * 
 * Tests the query processing pipeline with various Arabic, English, and Arabizi inputs.
 * 
 * Run: npx tsx scripts/test-query-processor.ts
 */

import { 
  processQuery, 
  processQuerySync, 
  normalizeQuery, 
  detectScript,
  getTransliterationVariants,
} from "../src/lib/queryProcessor";
import { getAllCacheStats, clearAllCaches } from "../src/lib/queryProcessor/cache";
import { buildDictionaries, getDictionaries } from "../src/lib/queryProcessor/dictionary";
import { correctQuery } from "../src/lib/queryProcessor/spellCorrector";

// ============================================================================
// Test Cases
// ============================================================================

const TEST_QUERIES = [
  // English - correct spelling
  { query: "nike air max", expected: "nike air max", type: "english" },
  { query: "zara dress", expected: "zara dress", type: "english" },
  
  // English - misspellings
  { query: "niike shoes", expected: "nike", type: "english-typo" },
  { query: "adiddas sneakers", expected: "adidas", type: "english-typo" },
  { query: "leater jacket", expected: "leather", type: "english-typo" },
  
  // Arabizi (Arabic written in Latin with numbers)
  { query: "7arimi abaya", expected: "women", type: "arabizi" },
  { query: "rijali qamis", expected: "men", type: "arabizi" },
  { query: "fistan 3arous", expected: "فستان", type: "arabizi" },
  
  // Arabic
  { query: "فستان أحمر", expected: "فستان احمر", type: "arabic" },
  { query: "نايك رياضي", expected: "نايك", type: "arabic" },
  { query: "عباية سوداء", expected: "عباية سوداء", type: "arabic" },
  
  // Mixed
  { query: "nike رياضي men", expected: "nike", type: "mixed" },
  { query: "حذاء adidas أسود", expected: "adidas", type: "mixed" },
  
  // Gender extraction
  { query: "mens black jacket", expected: "men", type: "gender" },
  { query: "womens red dress", expected: "women", type: "gender" },
  { query: "kids shoes", expected: "kids", type: "gender" },
  
  // Brand aliases
  { query: "h&m dress", expected: "H&M", type: "brand-alias" },
  { query: "ck jeans", expected: "Calvin Klein", type: "brand-alias" },
  
  // Complex queries
  { query: "niike blak mens jaket", expected: "nike black men jacket", type: "complex" },
];

// ============================================================================
// Test Functions
// ============================================================================

async function testNormalization(): Promise<void> {
  console.log("\n=== Testing Query Normalization ===\n");
  
  const testCases = [
    { input: "  Nike   SHOES  ", expected: "nike shoes" },
    { input: "NIIIICE dress", expected: "niice dress" },
    { input: "فُسْتان", expected: "فستان" },  // Remove Arabic diacritics
    { input: "hello  \u00A0 world", expected: "hello world" },
  ];
  
  for (const { input, expected } of testCases) {
    const result = normalizeQuery(input);
    const status = result === expected ? "✓" : "✗";
    console.log(`${status} "${input}" → "${result}" (expected: "${expected}")`);
  }
}

async function testScriptDetection(): Promise<void> {
  console.log("\n=== Testing Script Detection ===\n");
  
  const testCases = [
    { input: "nike shoes", expected: "en" },
    { input: "فستان أحمر", expected: "ar" },
    { input: "7arimi dress", expected: "arabizi" },
    { input: "nike فستان", expected: "mixed" },
    { input: "3arous abaya", expected: "arabizi" },
  ];
  
  for (const { input, expected } of testCases) {
    const result = detectScript(input);
    const status = result.primary === expected ? "✓" : "✗";
    console.log(`${status} "${input}" → ${result.primary} (expected: ${expected})`);
    console.log(`   Details: latin=${Math.round(result.latinRatio*100)}%, ar=${Math.round(result.arabicRatio*100)}%, arabizi=${result.hasArabizi}`);
  }
}

async function testArabiziTransliteration(): Promise<void> {
  console.log("\n=== Testing Arabizi Transliteration ===\n");
  
  const testCases = [
    { input: "7arimi", description: "حريمي (women's)" },
    { input: "rijali", description: "رجالي (men's)" },
    { input: "fistan", description: "فستان (dress)" },
    { input: "3arous", description: "عروس (bride)" },
    { input: "abaya", description: "عباية (abaya)" },
  ];
  
  for (const { input, description } of testCases) {
    const variants = getTransliterationVariants(input);
    console.log(`"${input}" → ${description}`);
    console.log(`   Variants: ${variants.slice(0, 5).join(", ")}${variants.length > 5 ? "..." : ""}`);
  }
}

async function testSpellCorrection(): Promise<void> {
  console.log("\n=== Testing Spell Correction ===\n");
  
  // Build dictionaries first
  await buildDictionaries();
  const dict = getDictionaries();
  
  const testCases = [
    { input: "niike", dictionary: "brands" },
    { input: "adiddas", dictionary: "brands" },
    { input: "leater", dictionary: "attributes" },
    { input: "cottn", dictionary: "attributes" },
    { input: "dreses", dictionary: "categories" },
  ];
  
  for (const { input, dictionary } of testCases) {
    const corrections = correctQuery(input, {
      brands: dict.brands,
      categories: dict.categories,
      attributes: dict.attributes,
      commonQueries: dict.commonQueries,
    });
    
    if (corrections.length > 0) {
      const c = corrections[0];
      console.log(`✓ "${input}" → "${c.corrected}" (${c.source}, confidence: ${Math.round(c.confidence * 100)}%)`);
    } else {
      console.log(`✗ "${input}" → no correction found`);
    }
  }
}

async function testFullPipeline(): Promise<void> {
  console.log("\n=== Testing Full Processing Pipeline ===\n");
  
  // Build dictionaries
  await buildDictionaries();
  
  for (const testCase of TEST_QUERIES) {
    const result = processQuerySync(testCase.query);
    
    console.log(`\n[${testCase.type}] "${testCase.query}"`);
    console.log(`   Script: ${result.script.primary}`);
    console.log(`   Normalized: "${result.normalizedQuery}"`);
    console.log(`   Search Query: "${result.searchQuery}"`);
    
    if (result.corrections.length > 0) {
      console.log(`   Corrections: ${result.corrections.map(c => 
        `"${c.original}"→"${c.corrected}" (${c.source}, ${Math.round(c.confidence * 100)}%)`
      ).join(", ")}`);
    }
    
    if (Object.keys(result.extractedFilters).length > 0) {
      console.log(`   Extracted Filters: ${JSON.stringify(result.extractedFilters)}`);
    }
    
    if (result.autoApply) {
      console.log(`   Auto-applied: Yes`);
    } else if (result.suggestText) {
      console.log(`   Suggestion: ${result.suggestText}`);
    }
    
    console.log(`   Processing Time: ${result.processingTimeMs.toFixed(2)}ms`);
  }
}

async function testCaching(): Promise<void> {
  console.log("\n=== Testing Caching ===\n");
  
  clearAllCaches();
  
  // First query (cache miss)
  const start1 = performance.now();
  const result1 = processQuerySync("nike shoes");
  const time1 = performance.now() - start1;
  console.log(`First query: ${time1.toFixed(2)}ms (cache hit: ${result1.cacheHit})`);
  
  // Second query (cache hit)
  const start2 = performance.now();
  const result2 = processQuerySync("nike shoes");
  const time2 = performance.now() - start2;
  console.log(`Second query: ${time2.toFixed(2)}ms (cache hit: ${result2.cacheHit})`);
  
  // Cache stats
  const stats = getAllCacheStats();
  console.log(`\nCache Stats:`);
  console.log(`   Query Cache: ${stats.query.size}/${stats.query.maxSize} items`);
  console.log(`   Hit Rate: ${(stats.query.hitRate * 100).toFixed(1)}%`);
}

async function testThroughput(): Promise<void> {
  console.log("\n=== Testing Throughput ===\n");
  
  // Build dictionaries
  await buildDictionaries();
  clearAllCaches();
  
  const iterations = 1000;
  const queries = [
    "nike shoes",
    "adidas sneakers",
    "zara dress",
    "levis jeans",
    "mens black jacket",
    "womens red dress",
    "kids shoes",
    "cotton shirt",
  ];
  
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    const query = queries[i % queries.length];
    processQuerySync(query);
  }
  const elapsed = performance.now() - start;
  
  const qps = Math.round(iterations / (elapsed / 1000));
  console.log(`Processed ${iterations} queries in ${elapsed.toFixed(2)}ms`);
  console.log(`Throughput: ${qps.toLocaleString()} queries/sec`);
  
  // With cache hits
  console.log(`\nWith cache (warm):`);
  const start2 = performance.now();
  for (let i = 0; i < iterations; i++) {
    const query = queries[i % queries.length];
    processQuerySync(query);
  }
  const elapsed2 = performance.now() - start2;
  
  const qps2 = Math.round(iterations / (elapsed2 / 1000));
  console.log(`Processed ${iterations} queries in ${elapsed2.toFixed(2)}ms`);
  console.log(`Throughput: ${qps2.toLocaleString()} queries/sec (${Math.round(qps2/qps)}x faster)`);
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  console.log("=".repeat(60));
  console.log("Query Processor Test Suite");
  console.log("=".repeat(60));
  
  try {
    await testNormalization();
    await testScriptDetection();
    await testArabiziTransliteration();
    await testSpellCorrection();
    await testFullPipeline();
    await testCaching();
    await testThroughput();
    
    console.log("\n" + "=".repeat(60));
    console.log("All tests completed!");
    console.log("=".repeat(60));
  } catch (error) {
    console.error("\nTest failed:", error);
    process.exit(1);
  }
}

main();
