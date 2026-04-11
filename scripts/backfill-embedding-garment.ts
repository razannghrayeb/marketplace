/**
 * One-time backfill: compute embedding_garment for existing products and partial-update OpenSearch.
 *
 * New uploads get embedding_garment at index time (images.service). This script backfills
 * the existing catalog: fetch primary image → processImageForGarmentEmbedding → partial update.
 *
 * Usage:
 *   npx tsx scripts/backfill-embedding-garment.ts
 *   npx tsx scripts/backfill-embedding-garment.ts --batch-size 20
 *   npx tsx scripts/backfill-embedding-garment.ts --start-from-id 5000
 *   npx tsx scripts/backfill-embedding-garment.ts --dry-run
 */

import "dotenv/config";
import axios from "axios";
import { Pool } from "pg";
import { osClient } from "../src/lib/core/opensearch";
import { config } from "../src/config";
import {
  processImageForGarmentEmbedding,
  processImageForGarmentEmbeddingWithOptionalBox,
} from "../src/lib/image";
import { prepareBufferForPrimaryCatalogEmbedding } from "../src/lib/image/embeddingPrep";
import { promises as fs } from "fs";

const reindexPg = new Pool({
  connectionString: config.database.url,
  ssl: { rejectUnauthorized: false },
  max: 2,
  idleTimeoutMillis: 30000,
});

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_TIMEOUT_MS = 20000;
const PROGRESS_FILE = ".backfill-embedding-garment-progress.json";

async function fetchImageBuffer(url: string, timeoutMs: number): Promise<Buffer | null> {
  try {
    const res = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: timeoutMs,
    });
    return Buffer.from(res.data);
  } catch (err: any) {
    console.warn(`  ⚠️  Failed to fetch image: ${url} - ${err.message}`);
    return null;
  }
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

async function main() {
  const args = process.argv.slice(2);
  let batchSize = DEFAULT_BATCH_SIZE;
  let startFromId = 0;
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--batch-size":
        batchSize = parseInt(args[++i], 10) || DEFAULT_BATCH_SIZE;
        break;
      case "--start-from-id":
        startFromId = parseInt(args[++i], 10) || 0;
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--help":
        console.log(`
Backfill embedding_garment for existing products

Usage:
  npx tsx scripts/backfill-embedding-garment.ts [options]

Options:
  --batch-size <n>     Process N products per batch (default: 50)
  --start-from-id <id> Start from this product ID (for resuming)
  --dry-run            Show what would be updated without writing
  --help               Show this help
        `);
        process.exit(0);
    }
  }

  console.log("=".repeat(60));
  console.log("📦 Backfill embedding_garment");
  console.log("=".repeat(60));
  console.log(`  Batch size:     ${batchSize}`);
  console.log(`  Start from ID:  ${startFromId || "0"}`);
  console.log(`  Dry run:        ${dryRun}`);
  console.log();

  // Load progress (for resumability)
  let lastProcessedId = startFromId;
  try {
    const data = await fs.readFile(PROGRESS_FILE, "utf-8");
    const prog = JSON.parse(data);
    if (prog.lastProcessedId != null) lastProcessedId = Math.max(startFromId, prog.lastProcessedId);
  } catch {
    /* ignore */
  }

  const indexName = config.opensearch.index;
  let totalUpdated = 0;
  let totalFailed = 0;

  while (true) {
    const offsetClause = lastProcessedId > 0 ? "AND p.id > $2" : "";
    const params = lastProcessedId > 0 ? [batchSize, lastProcessedId] : [batchSize];

    const { rows } = await reindexPg.query(
      `SELECT p.id,
              COALESCE(p.image_cdn, pi.cdn_url, p.image_url) AS image_url,
              d.box_x1,
              d.box_y1,
              d.box_x2,
              d.box_y2
       FROM products p
       LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_primary = true
       LEFT JOIN LATERAL (
         SELECT box_x1, box_y1, box_x2, box_y2
         FROM product_image_detections
         WHERE product_image_id = pi.id
            AND box_x1 IS NOT NULL AND box_y1 IS NOT NULL
            AND box_x2 IS NOT NULL AND box_y2 IS NOT NULL
           AND COALESCE(confidence, 0) >= 0.22
         ORDER BY COALESCE(area_ratio, 0) DESC NULLS LAST, id DESC
         LIMIT 1
       ) d ON true
       WHERE COALESCE(p.image_cdn, pi.cdn_url, p.image_url) IS NOT NULL
         AND COALESCE(TRIM(COALESCE(p.image_cdn, pi.cdn_url, p.image_url)), '') != ''
         ${offsetClause}
       ORDER BY p.id ASC
       LIMIT $1`,
      params
    );

    if (rows.length === 0) {
      console.log("No more products to process.");
      break;
    }

    let batchUpdated = 0;
    let batchFailed = 0;

    for (const row of rows) {
      const productId = row.id;
      const imageUrl = row.image_url;

      if (!(await isProductIndexed(productId))) {
        lastProcessedId = productId;
        continue;
      }

      const buf = await fetchImageBuffer(imageUrl, DEFAULT_TIMEOUT_MS);
      if (!buf) {
        batchFailed++;
        lastProcessedId = productId;
        continue;
      }

      let box: { x1: number; y1: number; x2: number; y2: number } | null = null;
      if (row.box_x1 != null && row.box_y1 != null && row.box_x2 != null && row.box_y2 != null) {
        box = {
          x1: Number(row.box_x1),
          y1: Number(row.box_y1),
          x2: Number(row.box_x2),
          y2: Number(row.box_y2),
        };
      }

      const { buffer: clipBuf } = await prepareBufferForPrimaryCatalogEmbedding(buf);

      let garmentEmbedding: number[];
      try {
        garmentEmbedding = box
          ? await processImageForGarmentEmbeddingWithOptionalBox(buf, clipBuf, box)
          : await processImageForGarmentEmbedding(clipBuf);
      } catch (err: any) {
        console.warn(`  ⚠️  Product ${productId}: garment embedding failed - ${err.message}`);
        batchFailed++;
        lastProcessedId = productId;
        continue;
      }

      if (!garmentEmbedding?.length) {
        batchFailed++;
        lastProcessedId = productId;
        continue;
      }

      if (dryRun) {
        console.log(`  [DRY RUN] Would update product ${productId}`);
        batchUpdated++;
        lastProcessedId = productId;
        continue;
      }

      try {
        await osClient.update({
          index: indexName,
          id: String(productId),
          body: {
            doc: { embedding_garment: garmentEmbedding },
            doc_as_upsert: false,
          },
          refresh: false,
        });
        batchUpdated++;
        lastProcessedId = productId;
      } catch (err: any) {
        console.warn(`  ⚠️  Product ${productId}: OpenSearch update failed - ${err.message}`);
        batchFailed++;
      }
    }

    totalUpdated += batchUpdated;
    totalFailed += batchFailed;

    console.log(
      `  Batch: updated ${batchUpdated}, failed ${batchFailed} (last ID: ${lastProcessedId}, total: ${totalUpdated})`
    );

    // Save progress after each batch
    try {
      await fs.writeFile(
        PROGRESS_FILE,
        JSON.stringify(
          { lastProcessedId, totalUpdated, totalFailed, lastRun: new Date().toISOString() },
          null,
          2
        )
      );
    } catch {
      /* ignore */
    }
  }

  console.log();
  console.log(`Done. Total updated: ${totalUpdated}, Total failed: ${totalFailed}`);
  await reindexPg.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
