/**
 * Generate Attribute Embeddings for Existing Products
 * 
 * Backfills per-attribute embeddings (color, texture, material, style, pattern)
 * for products that already have global embeddings in OpenSearch.
 * 
 * Usage:
 *   npx tsx scripts/generate-attribute-embeddings.ts [--batch-size=100] [--start=0]
 */

import { pg } from '../src/lib/core/db';
import { osClient } from '../src/lib/core/opensearch';
import { attributeEmbeddings } from '../src/lib/search/attributeEmbeddings';
import { config } from '../src/config';
import axios from 'axios';

// ============================================================================
// Configuration
// ============================================================================

const BATCH_SIZE = parseInt(process.argv.find(arg => arg.startsWith('--batch-size='))?.split('=')[1] || '100');
const START_OFFSET = parseInt(process.argv.find(arg => arg.startsWith('--start='))?.split('=')[1] || '0');
const INDEX_NAME = config.opensearch.index;

interface Product {
  product_id: string;
  image_cdn?: string;
  image_url?: string;
  title?: string;
  description?: string;
  attr_color?: string;
  attr_material?: string;
  attr_style?: string;
  attr_pattern?: string;
}

// ============================================================================
// Main Migration
// ============================================================================

async function main() {
  console.log('🚀 Starting attribute embedding generation...');
  console.log(`   Batch size: ${BATCH_SIZE}`);
  console.log(`   Starting offset: ${START_OFFSET}`);
  console.log(`   Index: ${INDEX_NAME}`);
  console.log('');

  // Step 1: Count total products
  const countResult = await pg.query('SELECT COUNT(*) FROM products WHERE image_cdn IS NOT NULL OR image_url IS NOT NULL');
  const totalProducts = parseInt(countResult.rows[0].count);
  console.log(`📊 Total products with images: ${totalProducts}`);

  let processed = 0;
  let updated = 0;
  let failed = 0;
  let offset = START_OFFSET;

  while (offset < totalProducts) {
    console.log(`\n📦 Processing batch ${Math.floor(offset / BATCH_SIZE) + 1}...`);
    console.log(`   Range: ${offset} - ${offset + BATCH_SIZE - 1}`);

    try {
      // Fetch batch of products
      const query = `
        SELECT 
          product_id, 
          image_cdn, 
          image_url,
          title,
          description,
          attr_color,
          attr_material,
          attr_style,
          attr_pattern
        FROM products 
        WHERE image_cdn IS NOT NULL OR image_url IS NOT NULL
        ORDER BY product_id
        LIMIT $1 OFFSET $2
      `;

      const result = await pg.query(query, [BATCH_SIZE, offset]);
      const products = result.rows as Product[];

      console.log(`   Fetched ${products.length} products`);

      // Process each product
      for (const product of products) {
        try {
          const imageUrl = product.image_cdn || product.image_url;
          if (!imageUrl) {
            console.log(`   ⚠️  Skipping ${product.product_id} (no image URL)`);
            processed++;
            continue;
          }

          // Download image
          let imageBuffer: Buffer;
          try {
            const response = await axios.get(imageUrl, {
              responseType: 'arraybuffer',
              timeout: 10000,
            });
            imageBuffer = Buffer.from(response.data);
          } catch (error) {
            console.log(`   ❌ Failed to download image for ${product.product_id}`);
            failed++;
            processed++;
            continue;
          }

          // Generate all attribute embeddings
          const embeddings = await attributeEmbeddings.generateAllAttributeEmbeddings(imageBuffer);

          // Update OpenSearch document
          await osClient.update({
            index: INDEX_NAME,
            id: product.product_id,
            body: {
              doc: {
                embedding_color: embeddings.color,
                embedding_texture: embeddings.texture,
                embedding_material: embeddings.material,
                embedding_style: embeddings.style,
                embedding_pattern: embeddings.pattern,
              },
            },
            retry_on_conflict: 3,
          });

          console.log(`   ✅ Updated ${product.product_id}`);
          updated++;
          processed++;

        } catch (error: any) {
          console.error(`   ❌ Error processing ${product.product_id}:`, error.message);
          failed++;
          processed++;
        }

        // Progress update every 10 products
        if (processed % 10 === 0) {
          const progress = ((processed / totalProducts) * 100).toFixed(1);
          console.log(`   Progress: ${processed}/${totalProducts} (${progress}%)`);
        }
      }

      offset += BATCH_SIZE;

      // Rate limiting: pause between batches
      if (offset < totalProducts) {
        console.log('   ⏸️  Pausing 2s between batches...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

    } catch (error: any) {
      console.error(`\n❌ Batch processing error:`, error.message);
      console.error('   Continuing with next batch...');
      offset += BATCH_SIZE;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ Migration complete!');
  console.log(`   Total processed: ${processed}`);
  console.log(`   Successfully updated: ${updated}`);
  console.log(`   Failed: ${failed}`);
  console.log(`   Success rate: ${((updated / processed) * 100).toFixed(1)}%`);
  console.log('='.repeat(60));

  process.exit(0);
}

// ============================================================================
// Error Handling
// ============================================================================

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled error:', error);
  process.exit(1);
});

// Run migration
main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
