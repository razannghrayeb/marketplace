/**
 * Find duplicate products and delete extras, keeping one row per group.
 * Remaps user-facing FKs (cart, favorites, wardrobe, etc.) so data is not lost.
 *
 * IMPORTANT — Shopify-style URLs:
 *   Rows like .../abaya-116#variant=111 and ...#variant=222 are DIFFERENT SKUs
 *   (size/color). Search may show similarity 1 between them; that is not a DB duplicate.
 *   --match=exact finds 0 groups if each product_url is unique (expected).
 *
 * Match modes (--match=…):
 *   exact     — same vendor + identical product_url (default)
 *   normalize — same vendor + URL after stripping ?query, #fragment, https→http, trim /
 *               (merges ALL variants of a product into ONE row — usually wrong for size/color)
 *   variant   — same vendor + same variant_id (only removes true re-ingest duplicates)
 *   parent    — same vendor + same parent listing URL (keeps ONE row per parent_product_url;
 *               DELETES other size/color variants). Requires --ack-destroy-variants with --execute.
 *   image     — same vendor + identical image_url (different product_url / id, same listing image)
 *
 * Usage:
 *   npx tsx scripts/dedupe-products.ts
 *   npx tsx scripts/dedupe-products.ts --match=variant --execute
 *   npx tsx scripts/dedupe-products.ts --match=parent --execute --ack-destroy-variants
 *   npx tsx scripts/dedupe-products.ts --execute --keep=latest --vendor-id=8
 *   npx tsx scripts/dedupe-products.ts --execute --skip-opensearch
 *   npx tsx scripts/dedupe-products.ts --match=image --execute
 *     (same vendor + identical image_url — when duplicate listings share one CDN image)
 *
 * Legacy: --normalize-url is the same as --match=normalize.
 *
 * After a large delete, reindex OpenSearch if you skipped deletes:
 *   pnpm run reindex-embeddings
 */
import "dotenv/config";
import type { PoolClient } from "pg";
import { pg, osClient } from "../src/lib/core";
import { config } from "../src/config";

type KeepStrategy = "min-id" | "latest";
type MatchMode = "exact" | "normalize" | "variant" | "parent" | "image";

interface DupGroupRow {
  vendor_id: string;
  /** Grouping key (exact URL, normalized URL, variant_id, or parent URL) */
  url_key: string;
  /** One example product_url from the group for logs */
  sample_url: string;
  ids: number[];
  cnt: number;
}

async function tableExists(name: string): Promise<boolean> {
  const r = await pg.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
    [name]
  );
  return (r.rowCount ?? 0) > 0;
}

async function columnExists(c: PoolClient, table: string, column: string): Promise<boolean> {
  const r = await c.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column]
  );
  return (r.rowCount ?? 0) > 0;
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const execute = argv.includes("--execute") || argv.includes("--excute");
  const skipOs = argv.includes("--skip-opensearch");
  let keep: KeepStrategy = "min-id";
  const keepArg = argv.find((a) => a.startsWith("--keep="));
  if (keepArg?.endsWith("latest")) keep = "latest";

  let limit = Infinity;
  const limArg = argv.find((a) => a.startsWith("--limit="));
  if (limArg) {
    const n = parseInt(limArg.split("=")[1], 10);
    if (Number.isFinite(n) && n > 0) limit = n;
  }

  let vendorId: number | null = null;
  const vArg = argv.find((a) => a.startsWith("--vendor-id="));
  if (vArg) {
    const n = parseInt(vArg.split("=")[1], 10);
    if (Number.isFinite(n)) vendorId = n;
  }

  let match: MatchMode = "exact";
  const matchArg = argv.find((a) => a.startsWith("--match="));
  if (matchArg) {
    const v = matchArg.split("=")[1]?.toLowerCase();
    if (v === "normalize" || v === "normalized") match = "normalize";
    else if (v === "variant") match = "variant";
    else if (v === "parent") match = "parent";
    else if (v === "image") match = "image";
    else if (v === "exact" || v === "url") match = "exact";
  }
  if (argv.includes("--normalize-url")) match = "normalize";

  const ackDestroyVariants = argv.includes("--ack-destroy-variants");

  return { execute, skipOs, keep, limit, vendorId, match, ackDestroyVariants };
}

function normalizedProductUrlExpr(): string {
  return `
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            lower(btrim(product_url)),
            '^https:', 'http:'
          ),
          '#[^#]*$', ''
        ),
        '\\?.*$', ''
      ),
      '/$', ''
    )
  `.replace(/\s+/g, " ");
}

async function fetchDuplicateGroups(
  vendorId: number | null,
  match: MatchMode
): Promise<DupGroupRow[]> {
  const params: unknown[] = [];
  let vendorFilter = "";
  if (vendorId !== null) {
    params.push(vendorId);
    vendorFilter = `AND vendor_id = $${params.length}`;
  }

  let sql: string;

  if (match === "exact") {
    sql = `
      SELECT
        vendor_id::text,
        product_url AS url_key,
        (array_agg(product_url ORDER BY id))[1] AS sample_url,
        array_agg(id ORDER BY id) AS ids,
        count(*)::int AS cnt
      FROM products
      WHERE product_url IS NOT NULL
        AND btrim(product_url) <> ''
        ${vendorFilter}
      GROUP BY vendor_id, product_url
      HAVING count(*) > 1
      ORDER BY cnt DESC, vendor_id, url_key
    `;
  } else if (match === "normalize") {
    const norm = normalizedProductUrlExpr();
    sql = `
      SELECT
        vendor_id::text,
        url_key,
        (array_agg(product_url ORDER BY id))[1] AS sample_url,
        array_agg(id ORDER BY id) AS ids,
        count(*)::int AS cnt
      FROM (
        SELECT id, vendor_id, product_url, ${norm} AS url_key
        FROM products
        WHERE product_url IS NOT NULL
          AND btrim(product_url) <> ''
          ${vendorFilter}
      ) sub
      GROUP BY vendor_id, url_key
      HAVING count(*) > 1
      ORDER BY cnt DESC, vendor_id, url_key
    `;
  } else if (match === "variant") {
    sql = `
      SELECT
        vendor_id::text,
        lower(btrim(variant_id)) AS url_key,
        (array_agg(product_url ORDER BY id))[1] AS sample_url,
        array_agg(id ORDER BY id) AS ids,
        count(*)::int AS cnt
      FROM products
      WHERE variant_id IS NOT NULL
        AND btrim(variant_id::text) <> ''
        ${vendorFilter}
      GROUP BY vendor_id, lower(btrim(variant_id))
      HAVING count(*) > 1
      ORDER BY cnt DESC, vendor_id, url_key
    `;
  } else if (match === "image") {
    sql = `
      SELECT
        vendor_id::text,
        image_url AS url_key,
        (array_agg(product_url ORDER BY id))[1] AS sample_url,
        array_agg(id ORDER BY id) AS ids,
        count(*)::int AS cnt
      FROM products
      WHERE image_url IS NOT NULL
        AND btrim(image_url) <> ''
        ${vendorFilter}
      GROUP BY vendor_id, image_url
      HAVING count(*) > 1
      ORDER BY cnt DESC, vendor_id, url_key
    `;
  } else {
    const parentCol = await pg.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'parent_product_url'`
    );
    if (!parentCol.rowCount) {
      throw new Error("products.parent_product_url is missing; cannot use --match=parent");
    }
    sql = `
      SELECT
        vendor_id::text,
        gkey AS url_key,
        (array_agg(product_url ORDER BY id))[1] AS sample_url,
        array_agg(id ORDER BY id) AS ids,
        count(*)::int AS cnt
      FROM (
        SELECT
          id,
          vendor_id,
          product_url,
          lower(btrim(
            regexp_replace(
              regexp_replace(
                coalesce(
                  nullif(btrim(parent_product_url), ''),
                  regexp_replace(regexp_replace(product_url, '#[^#]*$', ''), '\\?.*$', '')
                ),
                '^https:', 'http:'
              ),
              '/$', ''
            )
          )) AS gkey
        FROM products
        WHERE product_url IS NOT NULL
          AND btrim(product_url) <> ''
          ${vendorFilter}
      ) t
      WHERE gkey IS NOT NULL AND gkey <> ''
      GROUP BY vendor_id, gkey
      HAVING count(*) > 1
      ORDER BY cnt DESC, vendor_id, url_key
    `;
  }

  const { rows } = await pg.query(sql, params);
  return rows.map((r: Record<string, unknown>) => ({
    vendor_id: String(r.vendor_id),
    url_key: String(r.url_key),
    sample_url: String(r.sample_url ?? ""),
    ids: (r.ids as unknown[]).map((x) => Number(x)),
    cnt: Number(r.cnt),
  }));
}

async function pickKeeper(ids: number[], keep: KeepStrategy): Promise<number> {
  if (keep === "min-id") return Math.min(...ids);
  const { rows } = await pg.query<{ id: string }>(
    `SELECT id::text FROM products WHERE id = ANY($1::bigint[]) ORDER BY last_seen DESC NULLS LAST, id DESC LIMIT 1`,
    [ids]
  );
  return rows[0] ? Number(rows[0].id) : Math.min(...ids);
}

async function mergeCartItems(
  c: PoolClient,
  keeper: number,
  losers: number[]
): Promise<void> {
  await c.query(
    `DELETE FROM cart_items x
     USING cart_items k
     WHERE x.user_id = k.user_id
       AND x.product_id = ANY($1::bigint[])
       AND k.product_id = $2`,
    [losers, keeper]
  );
  await c.query(`UPDATE cart_items SET product_id = $1 WHERE product_id = ANY($2::bigint[])`, [
    keeper,
    losers,
  ]);
}

async function mergeFavorites(c: PoolClient, keeper: number, losers: number[]): Promise<void> {
  await c.query(
    `DELETE FROM favorites x
     USING favorites k
     WHERE x.user_id = k.user_id
       AND x.product_id = ANY($1::bigint[])
       AND k.product_id = $2`,
    [losers, keeper]
  );
  await c.query(`UPDATE favorites SET product_id = $1 WHERE product_id = ANY($2::bigint[])`, [
    keeper,
    losers,
  ]);
}

async function mergeUserSavedItems(
  c: PoolClient,
  keeper: number,
  losers: number[]
): Promise<void> {
  if (!(await tableExists("user_saved_items"))) return;
  await c.query(
    `DELETE FROM user_saved_items x
     USING user_saved_items k
     WHERE x.user_id = k.user_id
       AND x.source = k.source
       AND x.product_id = ANY($1::bigint[])
       AND k.product_id = $2`,
    [losers, keeper]
  );
  await c.query(
    `UPDATE user_saved_items SET product_id = $1 WHERE product_id = ANY($2::bigint[])`,
    [keeper, losers]
  );
}

async function remapUserUploadedImages(
  c: PoolClient,
  keeper: number,
  losers: number[]
): Promise<void> {
  if (!(await tableExists("user_uploaded_images"))) return;
  await c.query(
    `UPDATE user_uploaded_images SET product_id = $1 WHERE product_id = ANY($2::bigint[])`,
    [keeper, losers]
  );
}

async function remapWardrobeItems(
  c: PoolClient,
  keeper: number,
  losers: number[]
): Promise<void> {
  if (!(await tableExists("wardrobe_items"))) return;
  await c.query(`UPDATE wardrobe_items SET product_id = $1 WHERE product_id = ANY($2::bigint[])`, [
    keeper,
    losers,
  ]);
}

async function remapProductImageDetections(
  c: PoolClient,
  keeper: number,
  losers: number[]
): Promise<void> {
  if (!(await tableExists("product_image_detections"))) return;
  await c.query(
    `UPDATE product_image_detections SET product_id = $1 WHERE product_id = ANY($2::bigint[])`,
    [keeper, losers]
  );
}

async function remapOutfits(c: PoolClient, keeper: number, losers: number[]): Promise<void> {
  if (!(await tableExists("outfits"))) return;
  if (!(await columnExists(c, "outfits", "product_ids"))) return;
  const { rows } = await c.query<{ id: number; product_ids: number[] | null }>(
    `SELECT id, product_ids FROM outfits WHERE product_ids && $1::bigint[]`,
    [losers]
  );
  const loserSet = new Set(losers);
  for (const row of rows) {
    const arr = row.product_ids;
    if (!arr?.length) continue;
    const mapped = arr.map((pid) => (loserSet.has(Number(pid)) ? keeper : Number(pid)));
    const next = [...new Set(mapped)];
    const changed =
      next.length !== arr.length || next.some((v, i) => v !== Number(arr[i]));
    if (changed) {
      await c.query(`UPDATE outfits SET product_ids = $2 WHERE id = $1`, [row.id, next]);
    }
  }
}

async function moveProductImages(c: PoolClient, keeper: number, losers: number[]): Promise<void> {
  await c.query(
    `UPDATE product_images SET product_id = $1 WHERE product_id = ANY($2::bigint[])`,
    [keeper, losers]
  );
}

async function dropLoserCacheRows(c: PoolClient, losers: number[]): Promise<void> {
  if (await tableExists("product_quality_scores")) {
    await c.query(`DELETE FROM product_quality_scores WHERE product_id = ANY($1::bigint[])`, [losers]);
  }
  if (await tableExists("product_price_analysis")) {
    await c.query(`DELETE FROM product_price_analysis WHERE product_id = ANY($1::bigint[])`, [losers]);
  }
}

async function mergePriceHistory(c: PoolClient, keeper: number, losers: number[]): Promise<void> {
  if (!(await tableExists("price_history"))) return;
  await c.query(
    `DELETE FROM price_history p
     USING price_history k
     WHERE p.product_id = ANY($1::bigint[])
       AND k.product_id = $2
       AND k.recorded_at IS NOT DISTINCT FROM p.recorded_at`,
    [losers, keeper]
  );
  await c.query(`UPDATE price_history SET product_id = $1 WHERE product_id = ANY($2::bigint[])`, [
    keeper,
    losers,
  ]);
  await c.query(
    `
    DELETE FROM price_history ph
    WHERE ph.id IN (
      SELECT id FROM (
        SELECT id,
               ROW_NUMBER() OVER (PARTITION BY product_id, recorded_at ORDER BY id) AS rn
        FROM price_history
        WHERE product_id = $1
      ) t
      WHERE t.rn > 1
    )
    `,
    [keeper]
  );
}

async function mergePriceDropEvents(c: PoolClient, keeper: number, losers: number[]): Promise<void> {
  if (!(await tableExists("price_drop_events"))) return;
  await c.query(
    `UPDATE price_drop_events SET product_id = $1 WHERE product_id = ANY($2::bigint[])`,
    [keeper, losers]
  );
}

async function ensureKeeperPrimaryImage(c: PoolClient, keeper: number): Promise<void> {
  const primary = await c.query<{ id: number }>(
    `SELECT id FROM product_images WHERE product_id = $1 AND is_primary = true ORDER BY id LIMIT 1`,
    [keeper]
  );
  if (primary.rows[0]) {
    await c.query(
      `UPDATE products SET primary_image_id = $2 WHERE id = $1 AND primary_image_id IS NULL`,
      [keeper, primary.rows[0].id]
    );
    return;
  }
  const anyImg = await c.query<{ id: number }>(
    `SELECT id FROM product_images WHERE product_id = $1 ORDER BY id LIMIT 1`,
    [keeper]
  );
  if (!anyImg.rows[0]) return;
  await c.query(
    `UPDATE product_images SET is_primary = true WHERE id = $1 AND NOT EXISTS (
      SELECT 1 FROM product_images WHERE product_id = $2 AND is_primary = true
    )`,
    [anyImg.rows[0].id, keeper]
  );
  await c.query(`UPDATE products SET primary_image_id = $2 WHERE id = $1`, [
    keeper,
    anyImg.rows[0].id,
  ]);
}

async function deleteOpensearchDocs(ids: number[]): Promise<void> {
  const index = config.opensearch.index;
  for (const id of ids) {
    try {
      await osClient.delete({ index, id: String(id) });
    } catch (e: unknown) {
      const status = (e as { meta?: { statusCode?: number } })?.meta?.statusCode;
      if (status === 404) continue;
      console.warn(`OpenSearch delete ${id}:`, e instanceof Error ? e.message : e);
    }
  }
}

async function dedupeOneGroup(
  group: DupGroupRow,
  keep: KeepStrategy,
  skipOs: boolean
): Promise<number> {
  const keeper = await pickKeeper(group.ids, keep);
  const losers = group.ids.filter((id) => id !== keeper);

  const client = await pg.connect();
  try {
    await client.query("BEGIN");
    await mergeCartItems(client, keeper, losers);
    await mergeFavorites(client, keeper, losers);
    await mergeUserSavedItems(client, keeper, losers);
    await remapUserUploadedImages(client, keeper, losers);
    await remapWardrobeItems(client, keeper, losers);
    await remapProductImageDetections(client, keeper, losers);
    await remapOutfits(client, keeper, losers);
    await moveProductImages(client, keeper, losers);
    await dropLoserCacheRows(client, losers);
    await mergePriceHistory(client, keeper, losers);
    await mergePriceDropEvents(client, keeper, losers);
    await ensureKeeperPrimaryImage(client, keeper);
    await client.query(`DELETE FROM products WHERE id = ANY($1::bigint[])`, [losers]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  if (!skipOs) {
    await deleteOpensearchDocs(losers);
  }

  return losers.length;
}

async function main() {
  const { execute, skipOs, keep, limit, vendorId, match, ackDestroyVariants } = parseArgs();

  console.log(
    execute
      ? "MODE: EXECUTE (database will be modified)"
      : "MODE: DRY-RUN (no writes). Pass --execute to apply."
  );
  console.log(`Keep strategy: ${keep}, OpenSearch deletes: ${skipOs ? "skipped" : "on"}`);
  const matchLabel: Record<MatchMode, string> = {
    exact: "exact product_url",
    normalize: "normalized URL (merges #variant / ?query — one row per path)",
    variant: "same variant_id (true re-scrape duplicates only)",
    parent: "parent listing URL (ONE row per parent — removes other size/color SKUs)",
    image: "same vendor + identical image_url (duplicate listings, same primary image)",
  };
  console.log(`Match: ${match} — ${matchLabel[match]}`);
  if (vendorId !== null) console.log(`Vendor filter: ${vendorId}`);
  if (limit !== Infinity) console.log(`Group limit: ${limit}`);

  if (execute && match === "parent" && !ackDestroyVariants) {
    console.error(
      "\nRefusing --execute: --match=parent keeps only one product per parent URL and deletes every other variant.\n" +
        "If that is what you want, add --ack-destroy-variants (after backup). Otherwise use --match=variant for same variant_id dupes only.\n"
    );
    process.exit(1);
  }

  const groups = await fetchDuplicateGroups(vendorId, match);
  const slice = groups.slice(0, limit);

  let totalDupRows = 0;
  for (const g of slice) {
    totalDupRows += g.cnt - 1;
  }

  console.log(`\nDuplicate groups: ${slice.length}`);
  console.log(`Product rows that would be removed (extras only): ~${totalDupRows}\n`);

  for (const g of slice.slice(0, 50)) {
    const u = g.sample_url.length > 90 ? `${g.sample_url.slice(0, 90)}…` : g.sample_url;
    console.log(`  cnt=${g.cnt} vendor=${g.vendor_id} url=${JSON.stringify(u)} ids=${g.ids.join(",")}`);
  }
  if (slice.length > 50) console.log(`  … ${slice.length - 50} more groups`);

  if (!execute) {
    console.log("\nNo changes made. Review groups, back up DB, then run with --execute.");
    process.exit(0);
  }

  let removedTotal = 0;
  for (let i = 0; i < slice.length; i++) {
    const g = slice[i];
    try {
      const removed = await dedupeOneGroup(g, keep, skipOs);
      removedTotal += removed;
      if ((i + 1) % 20 === 0 || i === slice.length - 1) {
        console.log(`Progress: ${i + 1}/${slice.length} groups, removed ${removedTotal} rows so far`);
      }
    } catch (err) {
      console.error(
        `Failed on group vendor=${g.vendor_id} url_key=${JSON.stringify(g.url_key.slice(0, 120))} ids=${g.ids.join(",")}:`,
        err
      );
      throw err;
    }
  }

  console.log(`\nDone. Removed ${removedTotal} duplicate product rows.`);
  if (skipOs) {
    console.log("OpenSearch was skipped; delete stale docs or run reindex-embeddings.");
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
