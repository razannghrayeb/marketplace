/**
 * Resumable Product Reindexing Script
 *
 * Features:
 * - Check which products are already indexed in OpenSearch
 * - Skip successfully indexed products
 * - Retry failed products
 * - Track progress
 * - Support starting from specific product ID
 * - Batch processing for efficiency
 * - Graceful error handling (skip failed images, continue with others)
 *
 * Usage:
 *   # Resume from scratch (auto-detects what's already indexed)
 *   npx tsx scripts/resume-reindex.ts
 *
 *   # Start from specific product ID
 *   npx tsx scripts/resume-reindex.ts --start-from-id 1000
 *
 *   # Force reindex all products (ignore existing)
 *   npx tsx scripts/resume-reindex.ts --force
 *
 *   # Only reindex failed products (those not in OpenSearch)
 *   npx tsx scripts/resume-reindex.ts --failed-only
 *
 *   # Dry run (show what would be reindexed without doing it)
 *   npx tsx scripts/resume-reindex.ts --dry-run
 */

import "dotenv/config";
import axios from "axios";
import { pg, osClient } from "../src/lib/core";
import { config } from "../src/config";
import { processImageForEmbedding, computePHash } from "../src/lib/image";
import { extractAttributesSync } from "../src/lib/search/attributeExtractor";
import { promises as fs } from "fs";
import path from "path";

// ============================================================================
// Configuration
// ============================================================================

interface ReindexConfig {
  startFromId?: number;          // Start from this product ID
  force: boolean;                // Force reindex even if already exists
  failedOnly: boolean;           // Only reindex products not in OpenSearch
  dryRun: boolean;               // Don't actually index, just show what would happen
  batchSize: number;             // Process N products at a time
  maxRetries: number;            // Retry failed image fetches
  timeoutMs: number;             // Image fetch timeout
  saveProgressEvery: number;     // Save progress every N products
  progressFile: string;          // File to track progress
}

const DEFAULT_CONFIG: ReindexConfig = {
  force: false,
  failedOnly: false,
  dryRun: false,
  batchSize: 50,
  maxRetries: 3,
  timeoutMs: 30000,
  saveProgressEvery: 10,
  progressFile: ".reindex-progress.json",
};

interface Progress {
  lastProcessedId: number;
  totalProcessed: number;
  totalSuccess: number;
  totalFailed: number;
  totalSkipped: number;
  failedIds: number[];
  startedAt: string;
  lastUpdatedAt: string;
}

// ============================================================================
// Helpers
// ============================================================================

async function columnExists(columnName: string): Promise<boolean> {
  const res = await pg.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name=$1`,
    [columnName]
  );
  return res.rowCount! > 0;
}

async function getProductColumns(): Promise<{ hasIsHidden: boolean; hasCanonicalId: boolean }> {
  const [hasIsHidden, hasCanonicalId] = await Promise.all([
    columnExists("is_hidden"),
    columnExists("canonical_id"),
  ]);
  return { hasIsHidden, hasCanonicalId };
}

async function loadProgress(progressFile: string): Promise<Progress | null> {
  try {
    const data = await fs.readFile(progressFile, "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function saveProgress(progress: Progress, progressFile: string): Promise<void> {
  progress.lastUpdatedAt = new Date().toISOString();
  await fs.writeFile(progressFile, JSON.stringify(progress, null, 2));
}

async function isProductIndexed(productId: number): Promise<boolean> {
  try {
    const result = await osClient.exists({
      index: config.opensearch.index,
      id: String(productId),
    });
    return result.body === true;
  } catch {
    return false;
  }
}

async function getUnindexedProductIds(productIds: number[]): Promise<number[]> {
  if (productIds.length === 0) return [];

  try {
    // Batch check existence
    const body = productIds.flatMap((id) => [
      { index: config.opensearch.index },
      { query: { term: { product_id: String(id) } } },
    ]);

    const result = await osClient.msearch({ body });
    const responses = result.body.responses;

    const unindexed: number[] = [];
    for (let i = 0; i < productIds.length; i++) {
      const response = responses[i];
      if (!response.hits || response.hits.total.value === 0) {
        unindexed.push(productIds[i]);
      }
    }

    return unindexed;
  } catch (err) {
    console.warn("Failed to batch check indexed status, falling back to individual checks");
    const unindexed: number[] = [];
    for (const id of productIds) {
      if (!(await isProductIndexed(id))) {
        unindexed.push(id);
      }
    }
    return unindexed;
  }
}

async function fetchImage(url: string, retries: number, timeoutMs: number): Promise<Buffer | null> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: timeoutMs,
      });
      return Buffer.from(res.data);
    } catch (err: any) {
      if (attempt === retries) {
        console.warn(`Failed to fetch image after ${retries} attempts: ${url} - ${err.message}`);
        return null;
      }
      // Wait before retry (exponential backoff)
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
  return null;
}

// ============================================================================
// Main Reindexing Logic
// ============================================================================

async function reindexProduct(
  product: any,
  config: ReindexConfig,
  columns: { hasIsHidden: boolean; hasCanonicalId: boolean }
): Promise<boolean> {
  const { id, vendor_id, title, brand, category, price_cents, availability, last_seen, image_url, is_hidden, canonical_id } = product;

  try {
    // Fetch image
    const buf = await fetchImage(image_url, config.maxRetries, config.timeoutMs);
    if (!buf) {
      console.error(`  ❌ Product ${id}: Failed to fetch image`);
      return false;
    }

    if (config.dryRun) {
      console.log(`  [DRY RUN] Would index product ${id}: ${title}`);
      return true;
    }

    // Generate embedding and hash
    const embedding = await processImageForEmbedding(buf);
    const ph = await computePHash(buf);

    // Extract attributes
    const { attributes } = extractAttributesSync(title);

    // Index into OpenSearch
    const body = {
      product_id: String(id),
      vendor_id: String(vendor_id),
      title,
      brand,
      category,
      price_usd: Math.round(price_cents / 89000),
      availability: availability ? "in_stock" : "out_of_stock",
      is_hidden: is_hidden ?? false,
      canonical_id: canonical_id ? String(canonical_id) : null,
      embedding,
      image_cdn: image_url,
      p_hash: ph,
      last_seen_at: last_seen,
      // Extracted attributes
      attr_color: attributes.color || null,
      attr_colors: attributes.colors || [],
      attr_material: attributes.material || null,
      attr_materials: attributes.materials || [],
      attr_fit: attributes.fit || null,
      attr_style: attributes.style || null,
      attr_gender: attributes.gender || null,
      attr_pattern: attributes.pattern || null,
      attr_sleeve: attributes.sleeve || null,
      attr_neckline: attributes.neckline || null,
    };

    await osClient.index({
      index: config.opensearch.index,
      id: String(id),
      body,
      refresh: false, // Don't refresh immediately for performance
    });

    console.log(`  ✅ Product ${id}: ${title.substring(0, 60)}`);
    return true;
  } catch (err: any) {
    console.error(`  ❌ Product ${id}: ${err.message || err}`);
    return false;
  }
}

async function main() {
  // Parse CLI args
  const args = process.argv.slice(2);
  const reindexConfig: ReindexConfig = { ...DEFAULT_CONFIG };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--start-from-id":
        reindexConfig.startFromId = parseInt(args[++i], 10);
        break;
      case "--force":
        reindexConfig.force = true;
        break;
      case "--failed-only":
        reindexConfig.failedOnly = true;
        break;
      case "--dry-run":
        reindexConfig.dryRun = true;
        break;
      case "--batch-size":
        reindexConfig.batchSize = parseInt(args[++i], 10);
        break;
      case "--help":
        console.log(`
Resumable Product Reindexing

Usage:
  npx tsx scripts/resume-reindex.ts [options]

Options:
  --start-from-id <id>    Start from this product ID
  --force                 Force reindex even if already exists
  --failed-only           Only reindex products not in OpenSearch
  --dry-run               Show what would be reindexed without doing it
  --batch-size <n>        Process N products at a time (default: 50)
  --help                  Show this help message

Examples:
  # Resume from scratch
  npx tsx scripts/resume-reindex.ts

  # Start from product 1000
  npx tsx scripts/resume-reindex.ts --start-from-id 1000

  # Only reindex failed products
  npx tsx scripts/resume-reindex.ts --failed-only

  # Dry run to see what would happen
  npx tsx scripts/resume-reindex.ts --dry-run
        `);
        process.exit(0);
      default:
        break;
    }
  }

  console.log("="*70);
  console.log("📦 Resumable Product Reindexing");
  console.log("="*70);
  console.log("Configuration:");
  console.log(`  Start from ID:      ${reindexConfig.startFromId || "auto-detect"}`);
  console.log(`  Force reindex:      ${reindexConfig.force}`);
  console.log(`  Failed only:        ${reindexConfig.failedOnly}`);
  console.log(`  Dry run:            ${reindexConfig.dryRun}`);
  console.log(`  Batch size:         ${reindexConfig.batchSize}`);
  console.log(`  Max retries:        ${reindexConfig.maxRetries}`);
  console.log();

  // Check columns
  if (!(await columnExists("image_url"))) {
    console.error("❌ products.image_url column not found. Add image_url column before reindexing.");
    process.exit(1);
  }

  const columns = await getProductColumns();

  // Load progress
  let progress: Progress = await loadProgress(reindexConfig.progressFile) || {
    lastProcessedId: 0,
    totalProcessed: 0,
    totalSuccess: 0,
    totalFailed: 0,
    totalSkipped: 0,
    failedIds: [],
    startedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
  };

  const startFromId = reindexConfig.startFromId || progress.lastProcessedId;

  console.log("📊 Loading products...");
  const optionalColumns = [
    columns.hasIsHidden ? "is_hidden" : "NULL::boolean AS is_hidden",
    columns.hasCanonicalId ? "canonical_id" : "NULL::text AS canonical_id",
  ].join(", ");

  const whereClause = startFromId > 0 ? `WHERE image_url IS NOT NULL AND id > ${startFromId}` : `WHERE image_url IS NOT NULL`;

  const res = await pg.query(
    `SELECT id, vendor_id, title, brand, category, price_cents, availability, last_seen, image_url, ${optionalColumns}
     FROM products
     ${whereClause}
     ORDER BY id ASC`
  );

  console.log(`Found ${res.rowCount} products to process`);
  console.log();

  if (res.rowCount === 0) {
    console.log("✅ No products to reindex. All done!");
    process.exit(0);
  }

  // Process in batches
  const products = res.rows;
  const totalProducts = products.length;
  let processed = 0;

  for (let batchStart = 0; batchStart < products.length; batchStart += reindexConfig.batchSize) {
    const batch = products.slice(batchStart, batchStart + reindexConfig.batchSize);
    const batchNum = Math.floor(batchStart / reindexConfig.batchSize) + 1;
    const totalBatches = Math.ceil(products.length / reindexConfig.batchSize);

    console.log(`\n📦 Batch ${batchNum}/${totalBatches} (${batch.length} products)`);

    // Check which products are already indexed (unless force mode)
    let productsToIndex = batch;
    if (!reindexConfig.force || reindexConfig.failedOnly) {
      const batchIds = batch.map((p: any) => p.id);
      const unindexedIds = await getUnindexedProductIds(batchIds);

      if (!reindexConfig.force) {
        productsToIndex = batch.filter((p: any) => unindexedIds.includes(p.id));
        const skipped = batch.length - productsToIndex.length;
        if (skipped > 0) {
          console.log(`  ⏭️  Skipping ${skipped} already-indexed products`);
          progress.totalSkipped += skipped;
        }
      }
    }

    // Process each product
    for (const product of productsToIndex) {
      const success = await reindexProduct(product, reindexConfig, columns);

      processed++;
      progress.totalProcessed++;
      progress.lastProcessedId = product.id;

      if (success) {
        progress.totalSuccess++;
      } else {
        progress.totalFailed++;
        progress.failedIds.push(product.id);
      }

      // Save progress periodically
      if (processed % reindexConfig.saveProgressEvery === 0) {
        await saveProgress(progress, reindexConfig.progressFile);
      }
    }

    // Refresh OpenSearch after each batch (for consistency)
    if (!reindexConfig.dryRun && productsToIndex.length > 0) {
      await osClient.indices.refresh({ index: config.opensearch.index });
    }

    console.log(`  Progress: ${processed}/${totalProducts} (${Math.round(100 * processed / totalProducts)}%)`);
  }

  // Final save
  await saveProgress(progress, reindexConfig.progressFile);

  // Final summary
  console.log();
  console.log("="*70);
  console.log("✅ Reindexing Complete!");
  console.log("="*70);
  console.log(`Total processed:  ${progress.totalProcessed}`);
  console.log(`Successful:       ${progress.totalSuccess} ✅`);
  console.log(`Failed:           ${progress.totalFailed} ❌`);
  console.log(`Skipped:          ${progress.totalSkipped} ⏭️`);
  console.log();

  if (progress.failedIds.length > 0) {
    console.log(`⚠️  ${progress.failedIds.length} products failed to index:`);
    console.log(`   IDs: ${progress.failedIds.slice(0, 20).join(", ")}${progress.failedIds.length > 20 ? "..." : ""}`);
    console.log();
    console.log("To retry only failed products:");
    console.log(`  npx tsx scripts/resume-reindex.ts --start-from-id ${progress.failedIds[0]}`);
    console.log();
  }

  console.log(`Progress saved to: ${reindexConfig.progressFile}`);
  console.log();

  process.exit(0);
}

main().catch((e) => {
  console.error("❌ Fatal error:", e);
  process.exit(1);
});
