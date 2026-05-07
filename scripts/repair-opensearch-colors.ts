/**
 * Repair OpenSearch color fields from products.color.
 * 
 * Purpose:
 *  - Read correct `products.color` values from PostgreSQL
 *  - Map them through the shared query-time color normalizer
 *  - Partial-update ONLY color-related fields in existing OpenSearch documents
 *  - Preserve all embeddings and other indexed data
 *  - NO re-processing of images, NO re-computing vectors
 * 
 * Color fields updated:
 *  - attr_color (primary color display)
 *  - attr_colors (all normalized colors for BM25)
 *  - color_primary_canonical (canonical fashion token)
 *  - color_secondary_canonical (if applicable)
 *  - color_accent_canonical (if applicable)
 *  - color_palette_canonical (full palette)
 *  - color_confidence_primary (confidence score)
 *  - attr_color_source ("catalog" for DB color)
 *  - color_confidence_text (0.7 when sourced from DB)
 * 
 * Usage:
 *   npx tsx scripts/repair-opensearch-colors.ts                    # Repair all
 *   npx tsx scripts/repair-opensearch-colors.ts --limit 100        # Limit to 100
 *   npx tsx scripts/repair-opensearch-colors.ts --dry-run          # No writes
 *   npx tsx scripts/repair-opensearch-colors.ts --category dresses # One category
 *   npx tsx scripts/repair-opensearch-colors.ts --start-id 8900     # Start from product ID
 */

import "dotenv/config";
import { osClient } from "../src/lib/core/opensearch";
import { config } from "../src/config";
import { pg } from "../src/lib/core/db";
import { mapHexToFashionCanonical } from "../src/lib/color/garmentColorPipeline";
import { normalizeColorTokensFromRaw } from "../src/lib/color/queryColorFilter";
import { promises as fs } from "fs";
import { performance } from "perf_hooks";

type Queryable = Pick<typeof pg, "query">;
type ProductColorRow = { id: number; color: string };

// ============================================================================
// Constants & Types
// ============================================================================

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

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Normalize raw DB color strings to canonical tokens using the shared parser.
 * Keeps hex fallback for rare rows that store a raw color value as #RRGGBB.
 */
function normalizeColorToCanonicalTokens(colorStr: string | null): string[] {
  if (!colorStr) return [];

  const raw = String(colorStr).trim();
  if (!raw) return [];

  const normalizedTokens = normalizeColorTokensFromRaw(raw);
  if (normalizedTokens.length > 0) return normalizedTokens;

  // Try hex color fallback (e.g., "#FF5733" or "FF5733").
  const rawLower = raw.toLowerCase();
  if (raw.startsWith("#") || /^[0-9a-f]{6}$/i.test(raw)) {
    const hex = rawLower.startsWith("#") ? rawLower : `#${rawLower}`;
    const canonical = mapHexToFashionCanonical(hex);
    return canonical ? [canonical] : [];
  }

  return [];
}

/**
 * Fetch product IDs + colors directly from PostgreSQL.
 * Keeps bind parameter count small even for very large datasets.
 */
async function fetchProductColorRows(
  pool: Queryable,
  opts: { category?: string; limit?: number; startId?: number },
): Promise<ProductColorRow[]> {
  const params: Array<string | number> = [];
  const where: string[] = ["color IS NOT NULL", "TRIM(color) <> ''"];

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
    SELECT id, color
    FROM products
    WHERE ${where.join(" AND ")}
    ORDER BY id ASC
    ${limitClause}
  `;

  const result = await pool.query(query, params);
  return result.rows as ProductColorRow[];
}

/**
 * Build updated color fields for a product.
 * Returns an object with only color-related fields to merge into document.
 */
function buildColorUpdate(
  canonicalColors: string[],
  confidence: number = 0.7,
): Record<string, any> {
  const colors = [...new Set(canonicalColors.map((c) => String(c ?? "").trim().toLowerCase()).filter(Boolean))];
  const primary = colors[0] ?? null;

  return {
    attr_color: primary,
    attr_colors: colors,
    attr_colors_text: [], // DB color is not text-derived
    attr_colors_image: [], // DB color is not image-derived
    color_primary_canonical: primary,
    color_secondary_canonical: colors[1] ?? null,
    color_accent_canonical: colors[2] ?? null,
    color_palette_canonical: colors,
    color_confidence_primary: confidence,
    color_confidence_text: confidence,
    color_confidence_image: 0,
    attr_color_source: "catalog", // Marks this as DB-sourced
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
async function repairColors(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const limitArgEq = args.find((a) => a.startsWith("--limit="));
  const limitArgPos = args.indexOf("--limit");
  const limitStr = limitArgEq
    ? limitArgEq.split("=")[1]
    : limitArgPos >= 0
      ? args[limitArgPos + 1]
      : undefined;
  const limit = limitStr ? parseInt(limitStr, 10) : undefined;
  const startIdArgEq = args.find((a) => a.startsWith("--start-id="));
  const startIdArgPos = args.indexOf("--start-id");
  const startIdStr = startIdArgEq
    ? startIdArgEq.split("=")[1]
    : startIdArgPos >= 0
      ? args[startIdArgPos + 1]
      : undefined;
  const startId = startIdStr ? parseInt(startIdStr, 10) : undefined;
  const categoryArgEq = args.find((a) => a.startsWith("--category="));
  const categoryArgPos = args.indexOf("--category");
  const category = categoryArgEq
    ? categoryArgEq.split("=")[1]
    : categoryArgPos >= 0
      ? args[categoryArgPos + 1]
      : undefined;

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
    console.log(`[repair-colors] Starting color repair...`);
    console.log(`[repair-colors] Dry run: ${dryRun}`);
    if (limit) console.log(`[repair-colors] Limit: ${limit}`);
    if (typeof startId === "number" && Number.isFinite(startId)) {
      console.log(`[repair-colors] Start ID: ${startId}`);
    }
    if (category) console.log(`[repair-colors] Category filter: ${category}`);

    // Step 1: Fetch product IDs + colors from PostgreSQL
    console.log(`[repair-colors] Fetching product colors from database...`);
    const productColorRows = await fetchProductColorRows(pool, { category, limit, startId });
    console.log(`[repair-colors] Found ${productColorRows.length} products with color values`);

    if (productColorRows.length === 0) {
      console.log(`[repair-colors] No products to process`);
      stats.endTime = performance.now();
      const duration = ((stats.endTime - stats.startTime) / 1000).toFixed(2);
      console.log(`[repair-colors] Duration: ${duration}s`);
      return;
    }

    // Step 2: Build color map
    const colorMap = new Map<number, string | null>();

    for (const row of productColorRows) {
      colorMap.set(row.id, row.color);
    }

    console.log(`[repair-colors] Have colors for ${colorMap.size} products`);

    // Step 3: Build OpenSearch partial updates.
    console.log(`[repair-colors] Building OpenSearch color updates...`);
    const bulkOps: any[] = [];

    for (const [productId, dbColor] of Array.from(colorMap.entries())) {
      stats.processed++;

      try {
        const canonicalColors = normalizeColorToCanonicalTokens(dbColor);
        if (canonicalColors.length === 0) {
          console.warn(`[repair-colors] ⚠ Product ${productId}: Could not normalize color "${dbColor}"`);
          stats.skipped++;
          continue;
        }

        // Fetch existing document from OpenSearch using direct get
        let existingDoc: any;
        try {
          const docResp = await osClient.get({
            index: config.opensearch.index,
            id: String(productId),
          });
          existingDoc = docResp.body?._source ?? docResp.body;
        } catch (err: any) {
          if (err.statusCode === 404) {
            console.warn(`[repair-colors] ⚠ Product ${productId}: Not found in OpenSearch`);
            stats.skipped++;
            continue;
          }
          throw err;
        }

        // Check if document has embeddings
        if (!Array.isArray(existingDoc?.embedding) || existingDoc.embedding.length === 0) {
          console.warn(`[repair-colors] ⚠ Product ${productId}: No embedding found`);
          stats.skipped++;
          continue;
        }

        const colorUpdate = buildColorUpdate(canonicalColors);

        // Add to bulk buffer
        bulkOps.push(
          {
            update: {
              _index: config.opensearch.index,
              _id: String(productId),
              retry_on_conflict: 2,
            },
          },
          { doc: colorUpdate },
        );

        if (bulkOps.length >= BULK_BUFFER_SIZE * 2) {
          const docs = bulkOps.length / 2;
          console.log(`[repair-colors] Flushing bulk buffer (${docs} docs)...`);
          if (!dryRun) {
            const resp = await osClient.bulk({ body: bulkOps, timeout: "30s" });
            const result = countBulkUpdateResults(resp);
            stats.updated += result.updated;
            stats.notFound += result.notFound;
            stats.errors += result.errors;
          } else {
            console.log(`[repair-colors] [DRY-RUN] Would update ${docs} documents`);
            stats.updated += docs;
          }
          bulkOps.length = 0;
        }
      } catch (err) {
        console.error(`[repair-colors] ✗ Error processing product ${productId}:`, err);
        stats.errors++;
      }
    }

    // Final flush
    if (bulkOps.length > 0) {
      const docs = bulkOps.length / 2;
      console.log(`[repair-colors] Final flush (${docs} docs)...`);
      if (!dryRun) {
        const resp = await osClient.bulk({ body: bulkOps, timeout: "30s" });
        const result = countBulkUpdateResults(resp);
        stats.updated += result.updated;
        stats.notFound += result.notFound;
        stats.errors += result.errors;
      } else {
        console.log(`[repair-colors] [DRY-RUN] Would update ${docs} documents`);
        stats.updated += docs;
      }
    }

    // Refresh index
    if (!dryRun && stats.updated > 0) {
      console.log(`[repair-colors] Refreshing OpenSearch index...`);
      await osClient.indices.refresh({ index: config.opensearch.index });
    }

    stats.endTime = performance.now();
    const duration = ((stats.endTime - stats.startTime) / 1000).toFixed(2);

    console.log(`\n[repair-colors] ✓ Repair complete!`);
    console.log(`[repair-colors] Stats:
  - Processed: ${stats.processed}
  - Updated: ${stats.updated}
  - Not found in OpenSearch: ${stats.notFound}
  - Skipped: ${stats.skipped}
  - Errors: ${stats.errors}
  - Duration: ${duration}s
  - Rate: ${stats.updated > 0 ? ((stats.updated / (stats.endTime! - stats.startTime)) * 1000).toFixed(1) : "0"} docs/sec`);

    // Save stats
    const statsPath = "./tmp/repair-colors-stats.json";
    await fs.mkdir("./tmp", { recursive: true });
    await fs.writeFile(statsPath, JSON.stringify(stats, null, 2));
    console.log(`[repair-colors] Stats saved to ${statsPath}`);
  } catch (err) {
    console.error(`[repair-colors] Fatal error:`, err);
    process.exit(1);
  }
}

// ============================================================================
// Entry Point
// ============================================================================

repairColors();
