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
import { Pool } from "pg";
import { osClient, ensureIndex } from "../src/lib/core/opensearch";
import { config } from "../src/config";

/**
 * Dedicated pool for this script only — max 1 by default so PgBouncer "session"
 * mode is not starved by the shared app pool (default max 10). Other services
 * using the same DATABASE_URL still consume slots; stop them or wait for retries.
 */
const REINDEX_PG_MAX = Math.max(1, parseInt(process.env.REINDEX_PG_POOL_MAX || "1", 10));
const reindexPg = new Pool({
  connectionString: config.database.url,
  ssl: { rejectUnauthorized: false },
  max: REINDEX_PG_MAX,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 120000,
  keepAlive: true,
});
import { processImageForEmbedding, computePHash } from "../src/lib/image";
import { extractAttributesSync } from "../src/lib/search/attributeExtractor";
import { attributeEmbeddings } from "../src/lib/search/attributeEmbeddings";
import { promises as fs } from "fs";

// ============================================================================
// Configuration
// ============================================================================

interface ReindexConfig {
  startFromId?: number;          // Start from this product ID
  force: boolean;                // Force reindex even if already exists
  failedOnly: boolean;           // Only reindex products not in OpenSearch
  dryRun: boolean;               // Don't actually index, just show what would happen
  recreate: boolean;             // Delete and recreate the OpenSearch index before starting
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
  recreate: false,
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

const DB_RETRY = {
  attempts: 8,
  baseDelayMs: 2000,
} as const;

// ============================================================================
// Helpers
// ============================================================================

function isTransientPgError(err: any): boolean {
  const msg = String(err?.message || "").toLowerCase();
  return (
    msg.includes("maxclientsinsessionmode") ||
    msg.includes("max clients reached") ||
    msg.includes("connection terminated unexpectedly") ||
    msg.includes("terminating connection") ||
    msg.includes("connection reset") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("timeout") ||
    msg.includes("server closed the connection unexpectedly")
  );
}

async function queryWithRetry<T = any>(
  sql: string,
  params: any[] = [],
  label: string = "query"
): Promise<T> {
  let lastErr: any;

  for (let attempt = 1; attempt <= DB_RETRY.attempts; attempt++) {
    try {
      return (await reindexPg.query(sql, params)) as T;
    } catch (err: any) {
      lastErr = err;
      const transient = isTransientPgError(err);
      if (!transient || attempt === DB_RETRY.attempts) {
        throw err;
      }

      const delayMs = DB_RETRY.baseDelayMs * attempt;
      console.warn(
        `⚠️  DB ${label} failed (attempt ${attempt}/${DB_RETRY.attempts}): ${err.message}. ` +
          `Retrying in ${delayMs}ms...`
      );

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastErr;
}

async function columnExists(columnName: string): Promise<boolean> {
  const res = await queryWithRetry(
    `SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name=$1`,
    [columnName],
    "columnExists"
  );
  return res.rowCount! > 0;
}

async function getProductColumns(): Promise<{ hasIsHidden: boolean; hasCanonicalId: boolean }> {
  // Run sequentially to minimize concurrent DB sessions when PgBouncer
  // session mode limits clients aggressively.
  const hasIsHidden = await columnExists("is_hidden");
  const hasCanonicalId = await columnExists("canonical_id");
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
    const result = await osClient.mget({
      index: config.opensearch.index,
      body: {
        ids: productIds.map(String),
      },
    });

    const docs = result.body.docs ?? [];

    const unindexed: number[] = [];
    for (let i = 0; i < productIds.length; i++) {
      const doc = docs[i];
      if (!doc?.found) {
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
  reindexConfig: ReindexConfig
): Promise<boolean> {
  const { id, vendor_id, title, brand, category, price_cents, availability, last_seen, image_url, is_hidden, canonical_id, description } = product;

  try {
    // Fetch image
    const buf = await fetchImage(image_url, reindexConfig.maxRetries, reindexConfig.timeoutMs);
    if (!buf) {
      console.error(`  ❌ Product ${id}: Failed to fetch image`);
      return false;
    }

    if (reindexConfig.dryRun) {
      console.log(`  [DRY RUN] Would index product ${id}: ${title}`);
      return true;
    }

    // Generate global embedding, attribute embeddings, and hash in parallel
    const [embedding, attrEmbeddings, ph] = await Promise.all([
      processImageForEmbedding(buf),
      attributeEmbeddings.generateAllAttributeEmbeddings(buf).catch((err: any) => {
        console.warn(`  ⚠️  Product ${id}: attribute embeddings failed (${err.message}), using global only`);
        return null;
      }),
      computePHash(buf),
    ]);

    // Extract attributes from title
    const { attributes } = extractAttributesSync(title);

    const body: Record<string, any> = {
      product_id: String(id),
      vendor_id: String(vendor_id),
      title,
      description: description || null,
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

    // Include per-attribute embeddings when available
    if (attrEmbeddings) {
      body.embedding_color    = attrEmbeddings.color;
      body.embedding_texture  = attrEmbeddings.texture;
      body.embedding_material = attrEmbeddings.material;
      body.embedding_style    = attrEmbeddings.style;
      body.embedding_pattern  = attrEmbeddings.pattern;
    }

    await osClient.index({
      index: config.opensearch.index,
      id: String(id),
      body,
      refresh: false,
    });

    console.log(`  ✅ Product ${id}: ${title.substring(0, 60)}`);
    return true;
  } catch (err: any) {
    console.error(`  ❌ Product ${id}: ${err.message || err}`);
    return false;
  }
}

function isMaxClientsError(err: unknown): boolean {
  const m = String((err as Error)?.message || "").toLowerCase();
  return m.includes("maxclientsinsessionmode") || m.includes("max clients reached");
}

/**
 * Wait until a PgBouncer slot is free. Session pools are tiny; production + local
 * API often fill them — many retries with backoff is required.
 */
async function waitForDatabase(): Promise<void> {
  const maxAttempts = parseInt(process.env.REINDEX_DB_WAIT_ATTEMPTS || "40", 10);
  const baseDelayMs = parseInt(process.env.REINDEX_DB_WAIT_MS || "8000", 10);

  console.log(
    `🔌 Reindex DB pool: max ${REINDEX_PG_MAX} connection(s). ` +
      `If you see max-clients errors, stop other apps using DATABASE_URL or increase PgBouncer pool.\n`
  );

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`🔌 Connecting to database (attempt ${attempt}/${maxAttempts})...`);
      await reindexPg.query("SELECT 1");
      console.log("✅ Database connected\n");
      return;
    } catch (err: any) {
      console.warn(`   ⚠️  Attempt ${attempt} failed: ${err.message}`);
      if (attempt >= maxAttempts) break;
      const mult = isMaxClientsError(err) ? Math.min(attempt, 6) : 1;
      const delayMs = Math.min(120_000, baseDelayMs * mult);
      console.log(`   Retrying in ${Math.round(delayMs / 1000)}s...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error(
    "Could not connect to database after all retries. " +
      "Free a slot: stop Cloud Run / local server, or use Aiven direct (non-pooler) URL for reindex only."
  );
}

async function closeReindexPool(): Promise<void> {
  try {
    await reindexPg.end();
  } catch {
    /* ignore */
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
      case "--recreate":
        reindexConfig.recreate = true;
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
  --recreate              ⚠️  DELETE and recreate the OpenSearch index before starting
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
  
  # FULL REINDEX: Delete index and reindex all products from scratch
  npx tsx scripts/resume-reindex.ts --recreate --force
        `);
        process.exit(0);
      default:
        break;
    }
  }

  console.log("=".repeat(70));
  console.log("📦 Resumable Product Reindexing");
  console.log("=".repeat(70));
  console.log("Configuration:");
  console.log(`  Start from ID:      ${reindexConfig.startFromId || "auto-detect"}`);
  console.log(`  Force reindex:      ${reindexConfig.force}`);
  console.log(`  Failed only:        ${reindexConfig.failedOnly}`);
  console.log(`  Dry run:            ${reindexConfig.dryRun}`);
  console.log(`  Recreate index:     ${reindexConfig.recreate}`);
  console.log(`  Batch size:         ${reindexConfig.batchSize}`);
  console.log(`  Max retries:        ${reindexConfig.maxRetries}`);
  console.log();

  // ── RECREATE INDEX IF REQUESTED ──────────────────────────────────────────────
  if (reindexConfig.recreate) {
    console.log("⚠️  --recreate flag set: Deleting and recreating OpenSearch index...");
    const indexName = config.opensearch.index;
    try {
      const exists = await osClient.indices.exists({ index: indexName });
      if (exists.body) {
        console.log(`   Deleting existing index: ${indexName}`);
        await osClient.indices.delete({ index: indexName });
      }
      console.log(`   Creating fresh index: ${indexName}`);
      await ensureIndex();
      console.log("✅ Index recreated successfully.");
      
      // Reset progress file when recreating index
      console.log("   Resetting progress file...");
      try {
        await fs.unlink(reindexConfig.progressFile);
        console.log("   Progress file deleted.");
      } catch {
        // File may not exist
      }
    } catch (err: any) {
      console.error("❌ Failed to recreate index:", err.message);
      process.exit(1);
    }
    console.log();
  }

  await waitForDatabase();

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

  console.log("📊 Preparing product pagination...");
  const optionalColumns = [
    columns.hasIsHidden ? "is_hidden" : "NULL::boolean AS is_hidden",
    columns.hasCanonicalId ? "canonical_id" : "NULL::text AS canonical_id",
  ].join(", ");

  // Estimate total for progress reporting (streaming/paged fetch avoids one huge query).
  const totalRes = await queryWithRetry<{ rowCount: number; rows: Array<{ count: string }> }>(
    `SELECT COUNT(*)::text AS count
     FROM products
     WHERE image_url IS NOT NULL
       AND ($1::bigint = 0 OR id >= $1::bigint)`,
    [startFromId],
    "count products"
  );
  const totalProducts = parseInt(totalRes.rows[0]?.count || "0", 10);

  console.log(`Found ${totalProducts} products to process`);
  console.log();

  if (totalProducts === 0) {
    console.log("✅ No products to reindex. All done!");
    process.exit(0);
  }

  let processed = 0;
  let lastSeenId = startFromId > 0 ? startFromId - 1 : 0;

  // Stream products in ID order to avoid long-running, memory-heavy full-table reads.
  while (true) {
    const batchRes = await queryWithRetry<any>(
      `SELECT id, vendor_id, title, description, brand, category, price_cents, availability, last_seen, image_url, ${optionalColumns}
       FROM products
       WHERE image_url IS NOT NULL
         AND id > $1::bigint
       ORDER BY id ASC
       LIMIT $2`,
      [lastSeenId, reindexConfig.batchSize],
      "load product batch"
    );

    const batch = batchRes.rows as any[];
    if (batch.length === 0) break;

    lastSeenId = Number(batch[batch.length - 1].id);
    const batchNum = Math.floor(processed / reindexConfig.batchSize) + 1;
    const totalBatches = Math.max(1, Math.ceil(totalProducts / reindexConfig.batchSize));

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
      const success = await reindexProduct(product, reindexConfig);

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
  console.log("=".repeat(70));
  console.log("✅ Reindexing Complete!");
  console.log("=".repeat(70));
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

}

main()
  .then(async () => {
    await closeReindexPool();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error("❌ Fatal error:", e);
    await closeReindexPool();
    process.exit(1);
  });
