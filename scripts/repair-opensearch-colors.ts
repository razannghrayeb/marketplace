/**
 * Repair OpenSearch Color Fields for Products with Embeddings
 * 
 * Purpose:
 *  - Read correct `products.color` values from PostgreSQL
 *  - Map them to canonical fashion colors
 *  - Update ONLY color-related fields in existing OpenSearch documents
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
 */

import "dotenv/config";
import { Pool } from "pg";
import { osClient } from "../src/lib/core/opensearch";
import { mapHexToFashionCanonical } from "../src/lib/color/garmentColorPipeline";
import { promises as fs } from "fs";
import { performance } from "perf_hooks";

// ============================================================================
// Constants & Types
// ============================================================================

interface RepairStats {
  processed: number;
  updated: number;
  skipped: number;
  errors: number;
  startTime: number;
  endTime?: number;
}

const BATCH_SIZE = 50;
const BULK_BUFFER_SIZE = 1000;

// Fashion canonical color tokens (from garmentColorPipeline.ts)
const CANONICAL_COLORS = [
  "black", "white", "off-white", "cream", "ivory", "beige", "brown", "camel", "tan",
  "gray", "charcoal", "silver", "navy", "blue", "light-blue", "green", "olive", "red",
  "burgundy", "pink", "purple", "yellow", "orange", "gold", "teal", "multicolor",
];

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Attempt to normalize color string to canonical format.
 * Handles hex colors, CSS color names, and fashion color tokens.
 */
function normalizeColorToCanonical(colorStr: string | null): string | null {
  if (!colorStr) return null;

  const raw = String(colorStr).trim().toLowerCase();
  if (!raw) return null;

  // Try hex color first (e.g., "#FF5733" or "FF5733")
  if (raw.startsWith("#") || /^[0-9a-f]{6}$/i.test(raw)) {
    const hex = raw.startsWith("#") ? raw : `#${raw}`;
    const canonical = mapHexToFashionCanonical(hex);
    if (canonical) return canonical;
  }

  // Check if it's already a canonical color
  if (CANONICAL_COLORS.includes(raw)) {
    return raw;
  }

  // Try common CSS color name mappings (basic normalization)
  const colorMap: Record<string, string> = {
    "light blue": "light-blue",
    "sky blue": "light-blue",
    "baby blue": "light-blue",
    "dark blue": "navy",
    "light green": "green",
    "dark green": "green",
    "light gray": "silver",
    "light grey": "silver",
    "dark gray": "charcoal",
    "dark grey": "charcoal",
    "light brown": "tan",
    "dark brown": "brown",
    "light pink": "pink",
    "hot pink": "pink",
    "light purple": "purple",
    "dark purple": "purple",
    "light yellow": "yellow",
    "light orange": "orange",
    "dark orange": "orange",
    "light red": "red",
    "dark red": "burgundy",
    "wine": "burgundy",
    "maroon": "burgundy",
    "forest green": "olive",
    "sage": "olive",
    "bronze": "brown",
    "rust": "burgundy",
    "khaki": "tan",
    "neutral": "beige",
    "sand": "beige",
    "nude": "beige",
    "blush": "pink",
  };

  if (colorMap[raw]) {
    return colorMap[raw];
  }

  // If no mapping found, return the raw string lowercased
  // (may match during OpenSearch fuzzy search)
  return raw;
}

/**
 * Fetch product IDs from PostgreSQL (those with color values).
 * We'll check if they have embeddings in OpenSearch later.
 */
async function fetchProductIdsWithColors(pool: Pool, limit?: number): Promise<number[]> {
  const query = `
    SELECT id
    FROM products
    WHERE color IS NOT NULL
    AND TRIM(color) != ''
    ORDER BY id ASC
    ${limit ? `LIMIT ${limit}` : ""}
  `;

  const result = await pool.query(query);
  return result.rows.map((row) => row.id);
}

/**
 * Build updated color fields for a product.
 * Returns an object with only color-related fields to merge into document.
 */
function buildColorUpdate(
  canonicalColor: string,
  confidence: number = 0.7,
): Record<string, any> {
  return {
    attr_color: canonicalColor,
    attr_colors: [canonicalColor],
    attr_colors_text: [], // DB color is not text-derived
    attr_colors_image: [], // DB color is not image-derived
    color_primary_canonical: canonicalColor,
    color_secondary_canonical: null,
    color_accent_canonical: null,
    color_palette_canonical: [canonicalColor],
    color_confidence_primary: confidence,
    color_confidence_text: confidence,
    color_confidence_image: 0,
    attr_color_source: "catalog", // Marks this as DB-sourced
  };
}

/**
 * Main repair loop.
 */
async function repairColors(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const limitStr = args.find((a) => a.startsWith("--limit="))?.split("=")[1];
  const limit = limitStr ? parseInt(limitStr, 10) : undefined;
  const category = args.find((a) => a.startsWith("--category="))?.split("=")[1];

  const stats: RepairStats = {
    processed: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    startTime: performance.now(),
  };

  const pool = new Pool();

  try {
    console.log(`[repair-colors] Starting color repair...`);
    console.log(`[repair-colors] Dry run: ${dryRun}`);
    if (limit) console.log(`[repair-colors] Limit: ${limit}`);
    if (category) console.log(`[repair-colors] Category filter: ${category}`);

    // Step 1: Fetch product IDs from PostgreSQL with color values
    console.log(`[repair-colors] Fetching product IDs with color values from database...`);
    let productIds = await fetchProductIdsWithColors(pool, limit);
    console.log(`[repair-colors] Found ${productIds.length} products with color values`);

    if (productIds.length === 0) {
      console.log(`[repair-colors] No products to process`);
      stats.endTime = performance.now();
      const duration = ((stats.endTime - stats.startTime) / 1000).toFixed(2);
      console.log(`[repair-colors] Duration: ${duration}s`);
      return;
    }

    // Step 2: Filter by category if specified
    if (category) {
      const categoryPlaceholders = productIds.map((_, i) => `$${i + 2}`).join(", ");
      const categoryQuery = `
        SELECT id FROM products
        WHERE id IN (${categoryPlaceholders})
        AND LOWER(COALESCE(category, '')) = LOWER($1)
      `;

      const categoryResult = await pool.query(categoryQuery, [category, ...productIds]);
      productIds = categoryResult.rows.map((r) => r.id);
      console.log(`[repair-colors] Filtered to ${productIds.length} products in category "${category}"`);
    }

    // Step 3: Fetch color values for these products
    console.log(`[repair-colors] Fetching color values from database...`);
    const colorMap = new Map<number, string | null>();

    const placeholders = productIds.map((_, i) => `$${i + 1}`).join(", ");
    const colorQuery = `
      SELECT id, color
      FROM products
      WHERE id IN (${placeholders})
      AND color IS NOT NULL
      AND TRIM(color) != ''
    `;

    const colorResult = await pool.query(colorQuery, productIds);
    for (const row of colorResult.rows) {
      colorMap.set(row.id, row.color);
    }

    console.log(`[repair-colors] Have colors for ${colorMap.size} products`);

    // Step 4: Fetch documents from OpenSearch and build updates
    console.log(`[repair-colors] Fetching documents from OpenSearch and building updates...`);
    const bulkOps: any[] = [];

    for (const [productId, dbColor] of Array.from(colorMap.entries())) {
      stats.processed++;

      try {
        // Normalize color to canonical
        const canonicalColor = normalizeColorToCanonical(dbColor);
        if (!canonicalColor) {
          console.warn(`[repair-colors] ⚠ Product ${productId}: Could not normalize color "${dbColor}"`);
          stats.skipped++;
          continue;
        }

        // Fetch existing document from OpenSearch using direct get
        let existingDoc: any;
        try {
          const docResp = await osClient.get({
            index: "products",
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

        // Build color update
        const colorUpdate = buildColorUpdate(canonicalColor);

        // Merge into existing document (preserves embeddings)
        const updatedDoc = {
          ...existingDoc,
          ...colorUpdate,
        };

        // Add to bulk buffer
        bulkOps.push(
          {
            index: {
              _index: "products",
              _id: String(productId),
            },
          },
          updatedDoc,
        );

        if (bulkOps.length >= BULK_BUFFER_SIZE) {
          console.log(`[repair-colors] Flushing bulk buffer (${bulkOps.length} ops)...`);
          if (!dryRun) {
            await osClient.bulk({ body: bulkOps });
          } else {
            console.log(`[repair-colors] [DRY-RUN] Would index ${bulkOps.length / 2} documents`);
          }
          stats.updated += bulkOps.length / 2;
          bulkOps.length = 0;
        }
      } catch (err) {
        console.error(`[repair-colors] ✗ Error processing product ${productId}:`, err);
        stats.errors++;
      }
    }

    // Final flush
    if (bulkOps.length > 0) {
      console.log(`[repair-colors] Final flush (${bulkOps.length} ops)...`);
      if (!dryRun) {
        await osClient.bulk({ body: bulkOps });
      } else {
        console.log(`[repair-colors] [DRY-RUN] Would index ${bulkOps.length / 2} documents`);
      }
      stats.updated += bulkOps.length / 2;
    }

    // Refresh index
    if (!dryRun && stats.updated > 0) {
      console.log(`[repair-colors] Refreshing OpenSearch index...`);
      await osClient.indices.refresh({ index: "products" });
    }

    stats.endTime = performance.now();
    const duration = ((stats.endTime - stats.startTime) / 1000).toFixed(2);

    console.log(`\n[repair-colors] ✓ Repair complete!`);
    console.log(`[repair-colors] Stats:
  - Processed: ${stats.processed}
  - Updated: ${stats.updated}
  - Skipped: ${stats.skipped}
  - Errors: ${stats.errors}
  - Duration: ${duration}s
  - Rate: ${stats.updated > 0 ? ((stats.updated / (stats.endTime! - stats.startTime)) * 1000).toFixed(1) : "0"} docs/sec`);

    // Save stats
    const statsPath = "./tmp/repair-colors-stats.json";
    await fs.writeFile(statsPath, JSON.stringify(stats, null, 2));
    console.log(`[repair-colors] Stats saved to ${statsPath}`);
  } catch (err) {
    console.error(`[repair-colors] Fatal error:`, err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// ============================================================================
// Entry Point
// ============================================================================

repairColors();
