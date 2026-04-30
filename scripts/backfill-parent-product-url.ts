/**
 * Backfill parent_product_url (and image_url) into existing OpenSearch documents
 * using partial updates — embeddings and all other fields are left untouched.
 *
 * Run: npx ts-node -r dotenv/config scripts/backfill-parent-product-url.ts
 *
 * ~5-10 min for 107k products at batch=500, concurrency=5.
 */
import "dotenv/config";
import { pg, osClient } from "../src/lib/core";
import { config } from "../src/config";

const INDEX = config.opensearch.index;
const BATCH_SIZE = 500;
const CONCURRENCY = 5;

async function fetchProducts(): Promise<Array<{ id: string; parent_product_url: string | null; image_url: string | null }>> {
  const res = await pg.query<{ id: string; parent_product_url: string | null; image_url: string | null }>(
    `SELECT id::text, parent_product_url, image_url FROM products ORDER BY id`,
  );
  return res.rows;
}

async function bulkPartialUpdate(batch: Array<{ id: string; parent_product_url: string | null; image_url: string | null }>): Promise<{ updated: number; notFound: number; errors: number }> {
  const body: any[] = [];
  for (const row of batch) {
    body.push({ update: { _index: INDEX, _id: row.id } });
    body.push({ doc: { parent_product_url: row.parent_product_url ?? null, image_url: row.image_url ?? null } });
  }

  const resp = await osClient.bulk({ body, timeout: "30s" });
  let updated = 0;
  let notFound = 0;
  let errors = 0;

  for (const item of (resp.body?.items ?? [])) {
    const r = item.update;
    if (r?.result === "updated" || r?.result === "noop") updated++;
    else if (r?.status === 404) notFound++;
    else errors++;
  }
  return { updated, notFound, errors };
}

async function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

async function main() {
  console.log("Fetching all products from Postgres...");
  const products = await fetchProducts();
  console.log(`Found ${products.length} products. Sending partial OpenSearch updates...`);

  const batches: typeof products[] = [];
  for (let i = 0; i < products.length; i += BATCH_SIZE) {
    batches.push(products.slice(i, i + BATCH_SIZE));
  }

  let totalUpdated = 0;
  let totalNotFound = 0;
  let totalErrors = 0;
  const startMs = Date.now();

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx += CONCURRENCY) {
    const chunk = batches.slice(batchIdx, batchIdx + CONCURRENCY);
    const results = await Promise.all(chunk.map((b) => bulkPartialUpdate(b)));
    for (const r of results) {
      totalUpdated += r.updated;
      totalNotFound += r.notFound;
      totalErrors += r.errors;
    }

    const done = Math.min((batchIdx + CONCURRENCY) * BATCH_SIZE, products.length);
    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
    const rate = (done / ((Date.now() - startMs) / 1000)).toFixed(0);
    console.log(`  ${done}/${products.length} (${((done / products.length) * 100).toFixed(1)}%) — ${elapsed}s elapsed, ~${rate} docs/s`);

    // Brief pause to avoid overwhelming the cluster
    if (batchIdx + CONCURRENCY < batches.length) await sleep(100);
  }

  const totalSec = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(`\nDone in ${totalSec}s`);
  console.log(`  updated/noop: ${totalUpdated}`);
  console.log(`  not found in OpenSearch: ${totalNotFound}`);
  console.log(`  errors: ${totalErrors}`);

  if (totalNotFound > 0) {
    console.log(`\nNote: ${totalNotFound} products exist in Postgres but not in OpenSearch (not yet indexed).`);
  }

  await pg.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
