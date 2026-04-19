/**
 * Phase 2: Attribute Embeddings Backfill
 *
 * Ensures all catalog products have complete attribute embeddings
 * (global, color, texture, material, style, pattern).
 *
 * Finds products missing texture/material embeddings and backfills them.
 * Uses the same pipeline as the main reindex but targets specific attributes.
 *
 * Usage:
 *   npx tsx scripts/backfill-attribute-embeddings.ts                    # Resume
 *   npx tsx scripts/backfill-attribute-embeddings.ts --force            # Force all
 *   npx tsx scripts/backfill-attribute-embeddings.ts --attributes color # Specific attributes
 *   npx tsx scripts/backfill-attribute-embeddings.ts --dry-run          # Simulation
 *   npx tsx scripts/backfill-attribute-embeddings.ts --limit 100        # Limit products
 */

import "dotenv/config";
import { Pool } from "pg";
import { osClient } from "../src/lib/core/opensearch";
import { config } from "../src/config";
import { attributeEmbeddings } from "../src/lib/search/attributeEmbeddings";
import { preparePrimaryImageBufferForCatalogEmbedding } from "../src/lib/image/embeddingPrep";
import { fetchProductImageFromR2, isPrimaryImageRetrievable } from "../src/lib/image/imageStorage";
import { promises as fs } from "fs";
import type { SemanticAttribute } from "../src/lib/search/multiVectorSearch";

// ============================================================================
// Types & Constants
// ============================================================================

interface BackfillConfig {
  dryRun: boolean;
  force: boolean;
  attributes: SemanticAttribute[];
  batchSize: number;
  limit?: number;
  progressFile: string;
}

type AttributeToBackfill =
  | "global"
  | "color"
  | "texture"
  | "material"
  | "style"
  | "pattern";

// By default, backfill texture and material (usually missing in older catalogs)
const DEFAULT_ATTRIBUTES: AttributeToBackfill[] = ["texture", "material"];

const BATCH_SIZE = 50;
const CONCURRENCY = 3;
const PROGRESS_FILE = ".backfill-attributes-progress.json";

// ============================================================================
// Progress Tracking
// ============================================================================

interface BackfillProgress {
  lastProductId: number;
  totalProcessed: number;
  successCount: number;
  failureCount: number;
  startTime: number;
  attributes: AttributeToBackfill[];
}

async function loadProgress(file: string): Promise<BackfillProgress | null> {
  try {
    const data = await fs.readFile(file, "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function saveProgress(file: string, progress: BackfillProgress): Promise<void> {
  await fs.writeFile(file, JSON.stringify(progress, null, 2));
}

// ============================================================================
// Database Query
// ============================================================================

async function findProductsNeedingAttributeBackfill(
  db: Pool,
  fromId: number,
  attributes: AttributeToBackfill[],
  limit: number,
): Promise<Array<{ product_id: number; image_url: string }>> {
  // Build WHERE clause: product must have image AND lack at least one of the target attributes
  const attrColumns = attributes
    .map((attr) => `embedding_${attr}`)
    .map((col) => `(${col} IS NULL OR array_length(${col}, 1) IS NULL OR array_length(${col}, 1) = 0)`)
    .join(" OR ");

  const query = `
    SELECT DISTINCT ON (p.product_id)
      p.product_id,
      p.image_cdn
    FROM products p
    WHERE p.product_id > $1
      AND p.image_cdn IS NOT NULL
      AND p.image_cdn != ''
      AND (${attrColumns})
    ORDER BY p.product_id ASC
    LIMIT $2
  `;

  const result = await db.query(query, [fromId, limit]);
  return result.rows.map((row) => ({
    product_id: row.product_id,
    image_url: row.image_cdn,
  }));
}

// ============================================================================
// Attribute Generation
// ============================================================================

async function generateMissingAttributeEmbeddings(
  imageBuffer: Buffer,
  attributes: AttributeToBackfill[],
): Promise<Partial<Record<AttributeToBackfill, number[]>>> {
  const embeddings: Partial<Record<AttributeToBackfill, number[]>> = {};

  for (const attr of attributes) {
    try {
      const embedding = await attributeEmbeddings.generateImageAttributeEmbedding(
        imageBuffer,
        attr as SemanticAttribute,
      );
      if (embedding && embedding.length > 0) {
        embeddings[attr] = embedding;
      }
    } catch (error) {
      console.warn(`[backfill] Failed to generate ${attr} for image:`, error);
    }
  }

  return embeddings;
}

// ============================================================================
// OpenSearch Update
// ============================================================================

async function updateProductAttributeEmbeddings(
  productId: number,
  embeddings: Partial<Record<AttributeToBackfill, number[]>>,
): Promise<boolean> {
  try {
    const updateBody: Record<string, any> = {};

    for (const [attr, vec] of Object.entries(embeddings)) {
      if (vec && vec.length > 0) {
        updateBody[`embedding_${attr}`] = vec;
      }
    }

    if (Object.keys(updateBody).length === 0) {
      return false; // Nothing to update
    }

    await osClient.update({
      index: config.opensearch.index,
      id: String(productId),
      body: {
        doc: updateBody,
      },
    });

    return true;
  } catch (error) {
    console.warn(`[backfill] Failed to update product ${productId}:`, error);
    return false;
  }
}

// ============================================================================
// Main Backfill Loop
// ============================================================================

async function runBackfill(config: BackfillConfig): Promise<void> {
  const db = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    console.log(`
======================================================================
🔄 Phase 2: Attribute Embeddings Backfill
======================================================================
    `);

    const progress: BackfillProgress = (await loadProgress(config.progressFile)) || {
      lastProductId: 0,
      totalProcessed: 0,
      successCount: 0,
      failureCount: 0,
      startTime: Date.now(),
      attributes: config.attributes,
    };

    if (!config.force && progress.lastProductId > 0) {
      console.log(`Resuming from product ${progress.lastProductId}...`);
      console.log(
        `  Progress: ${progress.successCount} ✓ | ${progress.failureCount} ✗ | ${progress.totalProcessed} total`,
      );
    }

    let continueFetching = true;
    let currentFromId = config.force ? 0 : progress.lastProductId;

    while (continueFetching) {
      // Fetch batch of products needing backfill
      const batchLimit = config.limit
        ? Math.min(config.batchSize, config.limit - progress.totalProcessed)
        : config.batchSize;

      const batch = await findProductsNeedingAttributeBackfill(db, currentFromId, config.attributes, batchLimit);

      if (batch.length === 0) {
        console.log(`✅ No more products found. Backfill complete!`);
        continueFetching = false;
        break;
      }

      console.log(`📦 Batch: ${batch.length} products needing backfill`);

      // Process products concurrently
      for (let i = 0; i < batch.length; i += CONCURRENCY) {
        const chunk = batch.slice(i, i + CONCURRENCY);
        await Promise.all(
          chunk.map(async (product) => {
            try {
              // Fetch image from R2
              const imgBuffer = await fetchProductImageFromR2(product.image_url);

              // Prepare for CLIP
              const prepBuf = await preparePrimaryImageBufferForCatalogEmbedding(imgBuffer);

              // Generate missing attributes
              const attrEmbeddings = await generateMissingAttributeEmbeddings(
                prepBuf,
                config.attributes,
              );

              // Update OpenSearch
              if (!config.dryRun) {
                await updateProductAttributeEmbeddings(product.product_id, attrEmbeddings);
                progress.successCount++;
              }

              console.log(`  ✓ [${product.product_id}] Generated attributes:`, Object.keys(attrEmbeddings).join(","));
            } catch (error) {
              progress.failureCount++;
              console.warn(`  ✗ [${product.product_id}] Error:`, error instanceof Error ? error.message : error);
            }

            progress.totalProcessed++;
            progress.lastProductId = product.product_id;
          }),
        );

        // Save progress periodically
        if (!config.dryRun && progress.totalProcessed % (BATCH_SIZE * 2) === 0) {
          await saveProgress(config.progressFile, progress);
          console.log(`  💾 Progress saved`);
        }
      }

      currentFromId = batch[batch.length - 1].product_id;

      // Stop if reached limit
      if (config.limit && progress.totalProcessed >= config.limit) {
        continueFetching = false;
      }
    }

    // Final summary
    const elapsedMs = Date.now() - progress.startTime;
    const successRate = ((progress.successCount / progress.totalProcessed) * 100).toFixed(1);

    console.log(`
======================================================================
📊 Backfill Complete
======================================================================
Total products processed: ${progress.totalProcessed}
Success: ${progress.successCount} ✓ | Failures: ${progress.failureCount} ✗
Success rate: ${successRate}%
Attributes backfilled: ${config.attributes.join(", ")}
Elapsed time: ${(elapsedMs / 1000 / 60).toFixed(1)} minutes

${config.dryRun ? "🏃 [DRY RUN] No changes made" : "✅ All changes written to OpenSearch"}
    `);

    // Clean up progress file on success
    if (!config.dryRun) {
      try {
        await fs.unlink(config.progressFile);
      } catch {
        // File may not exist
      }
    }
  } finally {
    await db.end();
  }
}

// ============================================================================
// CLI
// ============================================================================

const args = process.argv.slice(2);
const config: BackfillConfig = {
  dryRun: args.includes("--dry-run"),
  force: args.includes("--force"),
  batchSize: BATCH_SIZE,
  progressFile: PROGRESS_FILE,
  attributes: DEFAULT_ATTRIBUTES,
};

// Parse --attributes color,texture,material
const attrIdx = args.findIndex((a) => a === "--attributes");
if (attrIdx >= 0 && args[attrIdx + 1]) {
  const attrs = args[attrIdx + 1].split(",") as AttributeToBackfill[];
  config.attributes = attrs;
}

// Parse --limit 1000
const limitIdx = args.findIndex((a) => a === "--limit");
if (limitIdx >= 0 && args[limitIdx + 1]) {
  config.limit = parseInt(args[limitIdx + 1], 10);
}

runBackfill(config).catch((error) => {
  console.error("❌ Backfill failed:", error);
  process.exit(1);
});
