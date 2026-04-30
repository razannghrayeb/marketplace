/**
 * Deduplicate OpenSearch index by removing size-variant documents.
 *
 * For each group of products sharing the same parent_product_url (or image_url),
 * keep the single best representative (prefer in-stock, then newest last_seen)
 * and delete all others from OpenSearch.
 *
 * Postgres and embeddings are untouched — this only removes redundant OS docs.
 * After this runs: ~39k unique docs instead of 107k, so k=200 covers 5x more products.
 *
 * Run:   npx ts-node -r dotenv/config scripts/dedup-opensearch-variants.ts
 * Dry:   DRY_RUN=1 npx ts-node -r dotenv/config scripts/dedup-opensearch-variants.ts
 *
 * ~5-10 min for 107k products.
 */
import "dotenv/config";
import { pg, osClient } from "../src/lib/core";
import { config } from "../src/config";

const INDEX = config.opensearch.index;
const BATCH_SIZE = 500;
const CONCURRENCY = 5;
const DRY_RUN = process.env.DRY_RUN === "1";

interface CanonicalRow {
  canonical_id: string;
  group_key: string;
}

/**
 * For each group sharing the same parent_product_url (or image_url),
 * pick the canonical representative:
 *   1. availability = true preferred
 *   2. newest last_seen as tiebreaker
 */
async function fetchCanonicalIds(): Promise<Map<string, string>> {
  const res = await pg.query<CanonicalRow>(`
    SELECT DISTINCT ON (COALESCE(parent_product_url, image_url, id::text))
      id::text AS canonical_id,
      COALESCE(parent_product_url, image_url, id::text) AS group_key
    FROM products
    ORDER BY
      COALESCE(parent_product_url, image_url, id::text),
      availability DESC,
      last_seen DESC NULLS LAST,
      id ASC
  `);
  const map = new Map<string, string>();
  for (const row of res.rows) {
    map.set(row.group_key, row.canonical_id);
  }
  return map;
}

/** Fetch all (id, parent_product_url, image_url) from Postgres. */
async function fetchAllProducts(): Promise<Array<{ id: string; parent_product_url: string | null; image_url: string | null }>> {
  const res = await pg.query<{ id: string; parent_product_url: string | null; image_url: string | null }>(
    `SELECT id::text, parent_product_url, image_url FROM products ORDER BY id`,
  );
  return res.rows;
}

async function bulkDelete(ids: string[]): Promise<{ deleted: number; notFound: number; errors: number }> {
  if (ids.length === 0) return { deleted: 0, notFound: 0, errors: 0 };
  const body: any[] = ids.flatMap((id) => [{ delete: { _index: INDEX, _id: id } }]);
  const resp = await osClient.bulk({ body, timeout: "30s" });
  let deleted = 0;
  let notFound = 0;
  let errors = 0;
  for (const item of (resp.body?.items ?? [])) {
    const r = item.delete;
    if (r?.result === "deleted") deleted++;
    else if (r?.status === 404) notFound++;
    else errors++;
  }
  return { deleted, notFound, errors };
}

async function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

async function main() {
  if (DRY_RUN) console.log("=== DRY RUN — no deletes will be sent ===\n");

  console.log("Fetching canonical IDs from Postgres...");
  const canonicalMap = await fetchCanonicalIds();
  console.log(`Canonical unique products: ${canonicalMap.size}`);

  console.log("Fetching all products from Postgres...");
  const allProducts = await fetchAllProducts();
  console.log(`Total products: ${allProducts.size ?? allProducts.length}`);

  // Build set of IDs to delete: any product whose group_key maps to a DIFFERENT canonical ID
  const toDelete: string[] = [];
  for (const product of allProducts) {
    const groupKey = product.parent_product_url ?? product.image_url ?? product.id;
    const canonicalId = canonicalMap.get(groupKey);
    if (canonicalId && canonicalId !== product.id) {
      toDelete.push(product.id);
    }
  }

  console.log(`Variant docs to delete from OpenSearch: ${toDelete.length}`);
  console.log(`Docs to keep: ${allProducts.length - toDelete.length}`);

  if (DRY_RUN) {
    console.log("\nDry run complete — no changes made.");
    await pg.end();
    return;
  }

  // Batch-delete
  const batches: string[][] = [];
  for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
    batches.push(toDelete.slice(i, i + BATCH_SIZE));
  }

  let totalDeleted = 0;
  let totalNotFound = 0;
  let totalErrors = 0;
  const startMs = Date.now();

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx += CONCURRENCY) {
    const chunk = batches.slice(batchIdx, batchIdx + CONCURRENCY);
    const results = await Promise.all(chunk.map((b) => bulkDelete(b)));
    for (const r of results) {
      totalDeleted += r.deleted;
      totalNotFound += r.notFound;
      totalErrors += r.errors;
    }

    const done = Math.min((batchIdx + CONCURRENCY) * BATCH_SIZE, toDelete.length);
    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
    const rate = done > 0 ? (done / ((Date.now() - startMs) / 1000)).toFixed(0) : "0";
    console.log(`  ${done}/${toDelete.length} (${((done / toDelete.length) * 100).toFixed(1)}%) — ${elapsed}s elapsed, ~${rate} docs/s`);

    if (batchIdx + CONCURRENCY < batches.length) await sleep(100);
  }

  const totalSec = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(`\nDone in ${totalSec}s`);
  console.log(`  deleted: ${totalDeleted}`);
  console.log(`  not found in OpenSearch (already gone): ${totalNotFound}`);
  console.log(`  errors: ${totalErrors}`);

  await pg.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
