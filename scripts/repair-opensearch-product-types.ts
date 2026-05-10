/**
 * Repair OpenSearch product_types and type_confidence from product metadata.
 * 
 * Purpose:
 *  - Read product metadata (title, description, category) from PostgreSQL
 *  - Regenerate product_types using the UPDATED searchDocument logic
 *  - Compute type_confidence based on new taxonomy and outerwear expansion
 *  - Partial-update ONLY product_types and type_confidence fields in OpenSearch
 *  - Preserve all embeddings, color, and other indexed data
 *  - NO re-processing of images, NO re-computing vectors
 * 
 * Fields updated:
 *  - product_types (expanded via new taxonomy)
 *  - type_confidence (recalculated with new logic)
 * 
 * Usage:
 *   npx tsx scripts/repair-opensearch-product-types.ts                    # Repair all
 *   npx tsx scripts/repair-opensearch-product-types.ts --limit 100        # Limit to 100
 *   npx tsx scripts/repair-opensearch-product-types.ts --dry-run          # No writes
 *   npx tsx scripts/repair-opensearch-product-types.ts --category Fleece  # One category
 *   npx tsx scripts/repair-opensearch-product-types.ts --start-id 8900    # Start from product ID
 *   npx tsx scripts/repair-opensearch-product-types.ts --batch-size 500   # Adjust batch size
 */

import "dotenv/config";
import { osClient } from "../src/lib/core/opensearch";
import { config } from "../src/config";
import { pg } from "../src/lib/core/db";
import { promises as fs } from "fs";
import { performance } from "perf_hooks";
import { buildProductSearchDocument } from "../src/lib/search/searchDocument";

type Queryable = Pick<typeof pg, "query">;

interface ProductMetadataRow {
  id: number;
  title: string | null;
  description: string | null;
  category: string | null;
  product_url: string | null;
  parent_product_url: string | null;
}

interface RepairStats {
  processed: number;
  updated: number;
  skipped: number;
  notFound: number;
  errors: number;
  startTime: number;
  endTime?: number;
}

const BULK_BUFFER_SIZE = 1000;
const DEFAULT_BATCH_SIZE = 500;

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Fetch product metadata directly from PostgreSQL.
 */
async function fetchProductMetadataRows(
  pool: Queryable,
  opts: { category?: string; limit?: number; startId?: number },
): Promise<ProductMetadataRow[]> {
  const params: Array<string | number> = [];
  const where: string[] = [];

  if (typeof opts.startId === "number" && Number.isFinite(opts.startId)) {
    params.push(opts.startId);
    where.push(`id >= $${params.length}`);
  }

  if (opts.category) {
    params.push(opts.category);
    where.push(`LOWER(COALESCE(category, '')) = LOWER($${params.length})`);
  }

  let limitClause = "";
  if (typeof opts.limit === "number" && Number.isFinite(opts.limit) && opts.limit > 0) {
    params.push(opts.limit);
    limitClause = `LIMIT $${params.length}`;
  }

  const query = `
    SELECT 
      id,
      title,
      description,
      category,
      product_url,
      parent_product_url
    FROM products
    WHERE id IS NOT NULL
    ${where.length > 0 ? "AND " + where.join(" AND ") : ""}
    ORDER BY id ASC
    ${limitClause}
  `;

  const result = await pool.query(query, params);
  return result.rows as ProductMetadataRow[];
}

/**
 * Compute product types using buildProductSearchDocument (the official indexing logic).
 * This ensures consistency with what gets indexed.
 */
function computeProductTypes(product: ProductMetadataRow): {
  productTypes: string[];
  typeConfidence: number;
} {
  const doc = buildProductSearchDocument({
    productId: product.id,
    title: product.title || "",
    description: product.description || "",
    category: product.category || "",
    productUrl: product.product_url || null,
    parentProductUrl: product.parent_product_url || null,
  });

  return {
    productTypes: doc.product_types ?? [],
    typeConfidence: doc.type_confidence ?? 0.32,
  };
}

/**
 * Build updated product type fields for partial-update.
 */
function buildProductTypeUpdate(productTypes: string[], typeConfidence: number): Record<string, any> {
  return {
    product_types: productTypes,
    type_confidence: typeConfidence,
  };
}

function countBulkUpdateResults(resp: any): { updated: number; notFound: number; errors: number } {
  let updated = 0;
  let notFound = 0;
  let errors = 0;

  for (const item of resp.body?.items ?? []) {
    const result = item.update;
    if (result?.result === "updated" || result?.result === "noop") updated++;
    else if (result?.status === 404) notFound++;
    else errors++;
  }

  return { updated, notFound, errors };
}

/**
 * Main repair loop.
 */
async function repairProductTypes(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  const parseArg = (name: string): string | undefined => {
    const eq = args.find((a) => a.startsWith(`--${name}=`));
    const pos = args.indexOf(`--${name}`);
    return eq ? eq.split("=")[1] : pos >= 0 ? args[pos + 1] : undefined;
  };

  const limitStr = parseArg("limit");
  const limit = limitStr ? parseInt(limitStr, 10) : undefined;

  const startIdStr = parseArg("start-id");
  const startId = startIdStr ? parseInt(startIdStr, 10) : undefined;

  const category = parseArg("category");

  const batchSizeStr = parseArg("batch-size");
  const batchSize = batchSizeStr ? parseInt(batchSizeStr, 10) : DEFAULT_BATCH_SIZE;

  const stats: RepairStats = {
    processed: 0,
    updated: 0,
    skipped: 0,
    notFound: 0,
    errors: 0,
    startTime: performance.now(),
  };

  const pool = pg;

  try {
    console.log(`[repair-product-types] Starting product type repair...`);
    console.log(`[repair-product-types] Dry run: ${dryRun}`);
    if (limit) console.log(`[repair-product-types] Limit: ${limit}`);
    if (typeof startId === "number" && Number.isFinite(startId)) {
      console.log(`[repair-product-types] Start ID: ${startId}`);
    }
    if (category) console.log(`[repair-product-types] Category filter: ${category}`);
    console.log(`[repair-product-types] Batch size: ${batchSize}`);

    // Step 1: Fetch product metadata
    console.log(`[repair-product-types] Fetching product metadata from database...`);
    const productMetadataRows = await fetchProductMetadataRows(pool, { category, limit, startId });
    console.log(`[repair-product-types] Found ${productMetadataRows.length} products`);

    if (productMetadataRows.length === 0) {
      console.log(`[repair-product-types] No products to process`);
      stats.endTime = performance.now();
      const duration = ((stats.endTime - stats.startTime) / 1000).toFixed(2);
      console.log(`[repair-product-types] Duration: ${duration}s`);
      return;
    }

    // Step 2: Process in batches and build OpenSearch updates
    console.log(`[repair-product-types] Computing product types and building OpenSearch updates...`);
    const bulkOps: any[] = [];

    for (const product of productMetadataRows) {
      stats.processed++;

      try {
        // Fetch existing document to verify it exists and has embeddings
        let existingDoc: any;
        try {
          const docResp = await osClient.get({
            index: config.opensearch.index,
            id: String(product.id),
          });
          existingDoc = docResp.body?._source ?? docResp.body;
        } catch (err: any) {
          if (err.statusCode === 404) {
            console.warn(`[repair-product-types] ⚠ Product ${product.id}: Not found in OpenSearch`);
            stats.skipped++;
            continue;
          }
          throw err;
        }

        // Verify document has embeddings (don't re-index without embeddings)
        if (!Array.isArray(existingDoc?.embedding) || existingDoc.embedding.length === 0) {
          console.warn(`[repair-product-types] ⚠ Product ${product.id}: No embedding found`);
          stats.skipped++;
          continue;
        }

        // Compute product types
        const { productTypes, typeConfidence } = computeProductTypes(product);

        // Check if this would change anything
        const existing = {
          types: existingDoc?.product_types ?? [],
          confidence: existingDoc?.type_confidence ?? 0,
        };

        const willChange =
          JSON.stringify(productTypes) !== JSON.stringify(existing.types) ||
          Math.abs(typeConfidence - existing.confidence) > 0.001;

        if (!willChange) {
          stats.skipped++;
          if (stats.processed % 1000 === 0) {
            console.log(`[repair-product-types] Processed ${stats.processed} (skipped ${stats.skipped} unchanged)...`);
          }
          continue;
        }

        const update = buildProductTypeUpdate(productTypes, typeConfidence);

        // Add to bulk buffer
        bulkOps.push(
          {
            update: {
              _index: config.opensearch.index,
              _id: String(product.id),
              retry_on_conflict: 2,
            },
          },
          { doc: update },
        );

        // Flush when buffer reaches size
        if (bulkOps.length >= BULK_BUFFER_SIZE * 2) {
          const docs = bulkOps.length / 2;
          console.log(
            `[repair-product-types] Flushing bulk buffer (${docs} docs, ${stats.processed} total processed)...`,
          );
          if (!dryRun) {
            const resp = await osClient.bulk({ body: bulkOps, timeout: "30s" });
            const result = countBulkUpdateResults(resp);
            stats.updated += result.updated;
            stats.notFound += result.notFound;
            stats.errors += result.errors;
          } else {
            console.log(`[repair-product-types] [DRY-RUN] Would update ${docs} documents`);
            stats.updated += docs;
          }
          bulkOps.length = 0;
        }
      } catch (err) {
        console.error(`[repair-product-types] ✗ Error processing product ${product.id}:`, err);
        stats.errors++;
      }
    }

    // Final flush
    if (bulkOps.length > 0) {
      const docs = bulkOps.length / 2;
      console.log(`[repair-product-types] Final flush (${docs} docs)...`);
      if (!dryRun) {
        const resp = await osClient.bulk({ body: bulkOps, timeout: "30s" });
        const result = countBulkUpdateResults(resp);
        stats.updated += result.updated;
        stats.notFound += result.notFound;
        stats.errors += result.errors;
      } else {
        console.log(`[repair-product-types] [DRY-RUN] Would update ${docs} documents`);
        stats.updated += docs;
      }
    }

    // Refresh index
    if (!dryRun && stats.updated > 0) {
      console.log(`[repair-product-types] Refreshing OpenSearch index...`);
      await osClient.indices.refresh({ index: config.opensearch.index });
    }

    stats.endTime = performance.now();
    const duration = ((stats.endTime - stats.startTime) / 1000).toFixed(2);

    console.log(`\n[repair-product-types] ✓ Repair complete!`);
    console.log(`[repair-product-types] Stats:
  - Processed: ${stats.processed}
  - Updated: ${stats.updated}
  - Skipped (unchanged): ${stats.skipped}
  - Not found in OpenSearch: ${stats.notFound}
  - Errors: ${stats.errors}
  - Duration: ${duration}s
  - Rate: ${stats.updated > 0 ? ((stats.updated / (stats.endTime! - stats.startTime)) * 1000).toFixed(1) : "0"} docs/sec`);

    // Save stats
    const statsPath = "./tmp/repair-product-types-stats.json";
    await fs.mkdir("./tmp", { recursive: true });
    await fs.writeFile(
      statsPath,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          dryRun,
          options: { limit, startId, category, batchSize },
          stats,
        },
        null,
        2,
      ),
    );
    console.log(`[repair-product-types] Stats saved to ${statsPath}`);
  } catch (err) {
    console.error(`[repair-product-types] Fatal error:`, err);
    stats.endTime = performance.now();
    process.exit(1);
  }
}

// Run
repairProductTypes().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
