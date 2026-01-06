/**
 * Test script for attribute extraction
 */

import { 
  extractAttributes, 
  extractAttributesSync,
  normalizeTitle,
  getCacheStats,
  clearCache 
} from "../src/lib/attributeExtractor";

const testTitles = [
  "Nike Men's Slim Fit Black Cotton T-Shirt",
  "Women's Oversized Denim Jacket - Vintage Wash",
  "Classic Navy Blue Wool Blazer Regular Fit",
  "Adidas Running Shorts Polyester Mesh Grey",
  "Floral Print Silk Maxi Dress V-Neck Sleeveless",
  "Kids Striped Cotton Polo Shirt Long Sleeve",
  "Faux Leather Bomber Jacket Black",
  "Cashmere Blend Turtleneck Sweater Cream",
  "High Waist Skinny Jeans Stretch Denim Dark Blue",
  "Linen Blend Wide Leg Pants Beige Relaxed Fit",
  "Off White Cropped Hoodie Cotton Fleece",
  "Leopard Print Satin Blouse Puff Sleeve",
  "Men's Formal Business Casual Oxford Shirt Blue Pinstripe",
  "Athletic Moisture Wicking Tank Top Neon Green",
  "Bohemian Embroidered Peasant Top Cream Lace Trim",
  // Edge cases
  "Basic Tee",
  "Pants",
  "Unknown Product XYZ-123",
];

async function runTests() {
  console.log("=== Attribute Extraction Tests ===\n");
  console.log("Testing synchronous rule-based extraction:\n");

  for (const title of testTitles) {
    console.log(`Title: "${title}"`);
    const normalized = normalizeTitle(title);
    console.log(`  Normalized: "${normalized}"`);
    
    const result = extractAttributesSync(title);
    const attrs = result.attributes;
    const conf = result.confidence;
    
    const extracted: string[] = [];
    if (attrs.color) extracted.push(`color: ${attrs.color} (${(conf.color * 100).toFixed(0)}%)`);
    if (attrs.colors && attrs.colors.length > 1) extracted.push(`colors: [${attrs.colors.join(", ")}]`);
    if (attrs.material) extracted.push(`material: ${attrs.material} (${(conf.material * 100).toFixed(0)}%)`);
    if (attrs.materials && attrs.materials.length > 1) extracted.push(`materials: [${attrs.materials.join(", ")}]`);
    if (attrs.fit) extracted.push(`fit: ${attrs.fit} (${(conf.fit * 100).toFixed(0)}%)`);
    if (attrs.style) extracted.push(`style: ${attrs.style} (${(conf.style * 100).toFixed(0)}%)`);
    if (attrs.gender) extracted.push(`gender: ${attrs.gender} (${(conf.gender * 100).toFixed(0)}%)`);
    if (attrs.pattern) extracted.push(`pattern: ${attrs.pattern} (${(conf.pattern * 100).toFixed(0)}%)`);
    if (attrs.sleeve) extracted.push(`sleeve: ${attrs.sleeve} (${(conf.sleeve * 100).toFixed(0)}%)`);
    if (attrs.neckline) extracted.push(`neckline: ${attrs.neckline} (${(conf.neckline * 100).toFixed(0)}%)`);
    
    if (extracted.length > 0) {
      console.log(`  Extracted: ${extracted.join(", ")}`);
    } else {
      console.log(`  Extracted: (none)`);
    }
    console.log("");
  }

  // Cache stats
  const stats = getCacheStats();
  console.log(`Cache stats: ${stats.size}/${stats.maxSize} entries, version ${stats.version}\n`);

  // Test ML fallback (async)
  console.log("=== Testing ML Fallback ===\n");
  console.log("(ML model loading may take a moment on first run...)\n");
  
  const mlTestTitles = [
    "Soft comfortable everyday tee",  // No explicit color/material
    "Elegant evening gown",           // No explicit material
    "Cozy winter sweater",            // No explicit fit
  ];

  for (const title of mlTestTitles) {
    console.log(`Title: "${title}"`);
    try {
      const result = await extractAttributes(title, { useML: true, mlThreshold: 0.5 });
      console.log(`  Extractor: ${result.extractor}`);
      console.log(`  Attributes: ${JSON.stringify(result.attributes)}`);
      console.log(`  Confidence: ${JSON.stringify(result.confidence)}`);
    } catch (err) {
      console.log(`  ML extraction failed: ${err.message}`);
    }
    console.log("");
  }

  // Performance test
  console.log("=== Performance Test ===\n");
  clearCache();
  
  const iterations = 1000;
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    extractAttributesSync(testTitles[i % testTitles.length]);
  }
  const elapsed = performance.now() - start;
  
  console.log(`Processed ${iterations} titles in ${elapsed.toFixed(2)}ms`);
  console.log(`Average: ${(elapsed / iterations).toFixed(3)}ms per title`);
  console.log(`Throughput: ${(iterations / (elapsed / 1000)).toFixed(0)} titles/sec`);
  
  const finalStats = getCacheStats();
  console.log(`\nFinal cache: ${finalStats.size} entries`);
}

runTests().catch(console.error);
