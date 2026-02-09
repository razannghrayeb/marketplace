/**
 * Test Multi-Vector Weighted Search
 * 
 * Interactive test script for the multi-vector search system.
 * 
 * Usage:
 *   npx tsx scripts/test-multi-vector-search.ts
 */

import { MultiVectorSearchEngine, AttributeEmbedding, normalizeVector } from '../src/lib/search/multiVectorSearch';
import { attributeEmbeddings } from '../src/lib/search/attributeEmbeddings';
import { initClip } from '../src/lib/image/clip';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Test Scenarios
// ============================================================================

interface TestScenario {
  name: string;
  description: string;
  imageFiles: string[];
  prompt: string;
  expectedAttributes: { attribute: string; weight: number }[];
  filters?: any;
}

const TEST_SCENARIOS: TestScenario[] = [
  {
    name: 'Color-Focused Search',
    description: 'Search prioritizing color match with minor style consideration',
    imageFiles: ['test-images/red-dress.jpg'],
    prompt: 'Find dresses with similar color',
    expectedAttributes: [
      { attribute: 'color', weight: 0.8 },
      { attribute: 'style', weight: 0.2 },
    ],
    filters: { categories: ['dresses'] },
  },
  {
    name: 'Texture-Focused Search',
    description: 'Search for matching fabric texture',
    imageFiles: ['test-images/knit-sweater.jpg'],
    prompt: 'Items with this knit texture',
    expectedAttributes: [
      { attribute: 'texture', weight: 0.7 },
      { attribute: 'material', weight: 0.3 },
    ],
  },
  {
    name: 'Cross-Image Attributes',
    description: 'Color from first image, style from second',
    imageFiles: ['test-images/blue-shirt.jpg', 'test-images/formal-suit.jpg'],
    prompt: 'Color from first image, formal style from second',
    expectedAttributes: [
      { attribute: 'color', weight: 0.5 },
      { attribute: 'style', weight: 0.5 },
    ],
  },
  {
    name: 'Multi-Attribute Balanced',
    description: 'Equal weight across multiple attributes',
    imageFiles: ['test-images/floral-dress.jpg'],
    prompt: 'Similar pattern and color scheme',
    expectedAttributes: [
      { attribute: 'pattern', weight: 0.5 },
      { attribute: 'color', weight: 0.5 },
    ],
  },
];

// ============================================================================
// Synthetic Test (No Images Required)
// ============================================================================

async function runSyntheticTest() {
  console.log('🧪 Running Synthetic Test (no images required)...\n');

  const engine = new MultiVectorSearchEngine();

  // Generate random embeddings (512-dim for CLIP ViT-B/32)
  const randomEmbedding = (seed: number) => {
    const vec = Array.from({ length: 512 }, (_, i) => Math.sin(seed + i * 0.1));
    return normalizeVector(vec);
  };

  const embeddings: AttributeEmbedding[] = [
    {
      attribute: 'color',
      vector: randomEmbedding(1),
      weight: 0.6,
    },
    {
      attribute: 'style',
      vector: randomEmbedding(2),
      weight: 0.4,
    },
  ];

  console.log('📊 Test Configuration:');
  console.log(`   Attributes: ${embeddings.map(e => `${e.attribute} (${e.weight})`).join(', ')}`);
  console.log(`   Vector dimension: ${embeddings[0].vector.length}`);
  console.log('');

  const startTime = Date.now();

  try {
    const results = await engine.search({
      embeddings,
      filters: { excludeHidden: true },
      size: 10,
      explainScores: true,
      baseK: 50,
    });

    const duration = Date.now() - startTime;

    console.log(`✅ Search completed in ${duration}ms`);
    console.log(`   Results: ${results.length}`);
    console.log('');

    if (results.length > 0) {
      console.log('🏆 Top 3 Results:');
      for (let i = 0; i < Math.min(3, results.length); i++) {
        const result = results[i];
        console.log(`\n   ${i + 1}. Product: ${result.productId}`);
        console.log(`      Score: ${result.score.toFixed(4)}`);
        
        if (result.product) {
          console.log(`      Title: ${result.product.title}`);
          console.log(`      Price: $${result.product.priceUsd}`);
          console.log(`      Category: ${result.product.category}`);
        }

        if (result.scoreBreakdown) {
          console.log(`      Score Breakdown:`);
          for (const breakdown of result.scoreBreakdown) {
            console.log(`        - ${breakdown.attribute}: ${breakdown.contribution.toFixed(4)} (sim: ${breakdown.similarity.toFixed(3)}, weight: ${breakdown.weight})`);
          }
        }
      }
    } else {
      console.log('⚠️  No results found (index may be empty or filters too restrictive)');
    }

  } catch (error: any) {
    console.error('❌ Search failed:', error.message);
    if (error.message.includes('index_not_found_exception')) {
      console.log('\n💡 Hint: Run `npx tsx scripts/recreate-opensearch-index.ts` to create the index');
    } else if (error.message.includes('Connection refused')) {
      console.log('\n💡 Hint: Ensure OpenSearch is running (check docker-compose)');
    }
  }
}

// ============================================================================
// Image-Based Test (Requires Test Images)
// ============================================================================

async function runImageTest(scenario: TestScenario) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🧪 Test: ${scenario.name}`);
  console.log(`   ${scenario.description}`);
  console.log(`${'='.repeat(60)}\n`);

  // Check if images exist
  for (const imageFile of scenario.imageFiles) {
    if (!fs.existsSync(imageFile)) {
      console.log(`⚠️  Skipping - Image not found: ${imageFile}`);
      return;
    }
  }

  // Load images
  const imageBuffers = scenario.imageFiles.map(file => fs.readFileSync(file));
  console.log(`📸 Loaded ${imageBuffers.length} image(s)`);

  // Generate embeddings
  const embeddings: AttributeEmbedding[] = [];

  for (const attrSpec of scenario.expectedAttributes) {
    const imageIndex = 0; // Simplified: use first image
    const buffer = imageBuffers[imageIndex];

    const embedding = await attributeEmbeddings.generateImageAttributeEmbedding(
      buffer,
      attrSpec.attribute as any
    );

    embeddings.push({
      attribute: attrSpec.attribute as any,
      vector: embedding,
      weight: attrSpec.weight,
    });
  }

  console.log(`🔢 Generated ${embeddings.length} attribute embeddings`);
  console.log('');

  // Execute search
  const engine = new MultiVectorSearchEngine();
  const startTime = Date.now();

  try {
    const results = await engine.search({
      embeddings,
      filters: scenario.filters || { excludeHidden: true },
      size: 10,
      explainScores: true,
    });

    const duration = Date.now() - startTime;

    console.log(`✅ Search completed in ${duration}ms`);
    console.log(`   Results: ${results.length}`);
    console.log('');

    if (results.length > 0) {
      console.log('🏆 Top 5 Results:');
      for (let i = 0; i < Math.min(5, results.length); i++) {
        const result = results[i];
        console.log(`\n   ${i + 1}. ${result.product?.title || result.productId}`);
        console.log(`      Score: ${result.score.toFixed(4)}`);
        console.log(`      Price: $${result.product?.priceUsd || 'N/A'}`);
        
        if (result.scoreBreakdown) {
          console.log(`      Breakdown: ${result.scoreBreakdown.map(b => `${b.attribute}=${b.contribution.toFixed(3)}`).join(', ')}`);
        }
      }
    }

  } catch (error: any) {
    console.error(`❌ Search failed:`, error.message);
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('\n🚀 Multi-Vector Weighted Search Test Suite\n');

  try {
    // Initialize CLIP models
    console.log('🔧 Initializing CLIP models...');
    await initClip();
    console.log('✅ CLIP models loaded\n');

    // Run synthetic test (always works, no images needed)
    await runSyntheticTest();

    // Check if test images directory exists
    const testImagesDir = path.join(process.cwd(), 'test-images');
    if (fs.existsSync(testImagesDir)) {
      console.log('\n\n📁 Found test-images directory, running image-based tests...\n');
      
      for (const scenario of TEST_SCENARIOS) {
        await runImageTest(scenario);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limit
      }
    } else {
      console.log('\n\n💡 Tip: Create a `test-images/` directory with sample images to run full tests');
    }

    console.log('\n\n✅ All tests complete!');
    process.exit(0);

  } catch (error: any) {
    console.error('\n❌ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run tests
main();
