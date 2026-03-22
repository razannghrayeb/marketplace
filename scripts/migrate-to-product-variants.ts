/**
 * Merge flat variant rows (same parent listing) into:
 *   - one parent row in `products` (canonical listing URL, listing-level fields)
 *   - one row per SKU in `product_variants` (variant URL, variant_id, size, color, prices, …)
 *
 * Prerequisites: apply db/migrations/009_product_variants.sql (this script can apply it if missing).
 *
 * Usage:
 *   npx tsx scripts/migrate-to-product-variants.ts
 *   npx tsx scripts/migrate-to-product-variants.ts --execute
 *   npx tsx scripts/migrate-to-product-variants.ts --execute --vendor-id=8 --limit=20
 *   npx tsx scripts/migrate-to-product-variants.ts --execute --skip-opensearch
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import type { PoolClient } from "pg";
import { pg, osClient } from "../src/lib/core";
import { config } from "../src/config";

interface ParentGroup {
  vendor_id: string;
  listing_key: string;
  ids: number[];
  cnt: number;
}

interface ProductRow {
  id: number;
  vendor_id: number;
  product_url: string;
  parent_product_url: string | null;
  variant_id: string | null;
  title: string;
  brand: string | null;
  category: string | null;
  description: string | null;
  size: string | null;
  color: string | null;
  currency: string;
  price_cents: string;
  sales_price_cents: string | null;
  availability: boolean;
  last_seen: Date;
  image_url: string | null;
  image_urls: unknown;
  image_cdn: string | null;
  primary_image_id: number | null;
  p_hash: string | null;
  return_policy: string | null;
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

async function ensureProductVariantsTable(): Promise<void> {
  if (await tableExists("product_variants")) return;
  const sqlPath = path.join(__dirname, "..", "db", "migrations", "009_product_variants.sql");
  if (!fs.existsSync(sqlPath)) {
    throw new Error(`Missing ${sqlPath}`);
  }
  const raw = fs.readFileSync(sqlPath, "utf8");
  const chunks = raw
    .split(/;\s*\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const chunk of chunks) {
    await pg.query(chunk + (chunk.endsWith(";") ? "" : ";"));
  }
  console.log("Applied 009_product_variants.sql");
}

function parseArgs() {
  const argv = process.argv.slice(2);
  return {
    execute: argv.includes("--execute") || argv.includes("--excute"),
    skipOs: argv.includes("--skip-opensearch"),
    limit: (() => {
      const a = argv.find((x) => x.startsWith("--limit="));
      if (!a) return Infinity;
      const n = parseInt(a.split("=")[1], 10);
      return Number.isFinite(n) && n > 0 ? n : Infinity;
    })(),
    vendorId: (() => {
      const a = argv.find((x) => x.startsWith("--vendor-id="));
      if (!a) return null;
      const n = parseInt(a.split("=")[1], 10);
      return Number.isFinite(n) ? n : null;
    })(),
  };
}

async function fetchMultiVariantGroups(vendorId: number | null): Promise<ParentGroup[]> {
  const params: unknown[] = [];
  let vendorFilter = "";
  if (vendorId !== null) {
    params.push(vendorId);
    vendorFilter = `AND vendor_id = $${params.length}`;
  }

  const sql = `
    SELECT
      vendor_id::text,
      gkey AS listing_key,
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
    ORDER BY cnt DESC, vendor_id, listing_key
  `;

  const { rows } = await pg.query(sql, params);
  return rows.map((r: Record<string, unknown>) => ({
    vendor_id: String(r.vendor_id),
    listing_key: String(r.listing_key),
    ids: (r.ids as unknown[]).map((x) => Number(x)),
    cnt: Number(r.cnt),
  }));
}

function pickCanonicalParentUrl(rows: ProductRow[]): string {
  const parents = rows
    .map((r) => r.parent_product_url?.trim())
    .filter((p): p is string => Boolean(p));
  if (parents.length > 0) {
    const freq = new Map<string, number>();
    for (const p of parents) {
      const k = p.toLowerCase();
      freq.set(k, (freq.get(k) ?? 0) + 1);
    }
    return [...parents].sort((a, b) => (freq.get(b.toLowerCase()) ?? 0) - (freq.get(a.toLowerCase()) ?? 0))[0];
  }
  const u = rows[0].product_url.replace(/#.*$/, "").replace(/\?.*$/, "");
  return u.replace(/\/$/, "");
}

async function loadProducts(c: PoolClient, ids: number[]): Promise<ProductRow[]> {
  const { rows } = await c.query<ProductRow>(
    `SELECT id, vendor_id, product_url, parent_product_url, variant_id, title, brand, category,
            description, size, color, currency, price_cents::text, sales_price_cents::text,
            availability, last_seen, image_url, image_urls, image_cdn, primary_image_id, p_hash, return_policy
     FROM products WHERE id = ANY($1::bigint[]) ORDER BY id`,
    [ids]
  );
  return rows;
}

/**
 * Same listing can incorrectly have multiple `products` rows with the same Shopify variant_id.
 * `uq_product_variants_product_variant_id` allows only one row per (parent product_id, variant_id).
 * Pick one representative per variant_id (prefer keeper, else lowest id); extras remain in `losers` and are deleted.
 */
function dedupeProductRowsByVariantId(rows: ProductRow[], keeper: number): ProductRow[] {
  const buckets = new Map<string, ProductRow[]>();
  for (const r of rows) {
    const vid = r.variant_id?.trim();
    const key = vid && vid.length > 0 ? vid : `__row_${r.id}`;
    const arr = buckets.get(key);
    if (arr) arr.push(r);
    else buckets.set(key, [r]);
  }
  const out: ProductRow[] = [];
  for (const group of buckets.values()) {
    const rep =
      group.find((r) => r.id === keeper) ?? group.reduce((a, b) => (a.id < b.id ? a : b));
    out.push(rep);
  }
  out.sort((a, b) => a.id - b.id);
  return out;
}

async function mergeCartItems(c: PoolClient, keeper: number, losers: number[]): Promise<void> {
  await c.query(
    `DELETE FROM cart_items x USING cart_items k
     WHERE x.user_id = k.user_id AND x.product_id = ANY($1::bigint[]) AND k.product_id = $2`,
    [losers, keeper]
  );
  await c.query(`UPDATE cart_items SET product_id = $1 WHERE product_id = ANY($2::bigint[])`, [
    keeper,
    losers,
  ]);
}

async function mergeFavorites(c: PoolClient, keeper: number, losers: number[]): Promise<void> {
  await c.query(
    `DELETE FROM favorites x USING favorites k
     WHERE x.user_id = k.user_id AND x.product_id = ANY($1::bigint[]) AND k.product_id = $2`,
    [losers, keeper]
  );
  await c.query(`UPDATE favorites SET product_id = $1 WHERE product_id = ANY($2::bigint[])`, [
    keeper,
    losers,
  ]);
}

async function mergeUserSavedItems(c: PoolClient, keeper: number, losers: number[]): Promise<void> {
  if (!(await tableExists("user_saved_items"))) return;
  await c.query(
    `DELETE FROM user_saved_items x USING user_saved_items k
     WHERE x.user_id = k.user_id AND x.source = k.source
       AND x.product_id = ANY($1::bigint[]) AND k.product_id = $2`,
    [losers, keeper]
  );
  await c.query(`UPDATE user_saved_items SET product_id = $1 WHERE product_id = ANY($2::bigint[])`, [
    keeper,
    losers,
  ]);
}

async function remapUserUploadedImages(c: PoolClient, keeper: number, losers: number[]): Promise<void> {
  if (!(await tableExists("user_uploaded_images"))) return;
  await c.query(`UPDATE user_uploaded_images SET product_id = $1 WHERE product_id = ANY($2::bigint[])`, [
    keeper,
    losers,
  ]);
}

async function remapWardrobeItems(c: PoolClient, keeper: number, losers: number[]): Promise<void> {
  if (!(await tableExists("wardrobe_items"))) return;
  await c.query(`UPDATE wardrobe_items SET product_id = $1 WHERE product_id = ANY($2::bigint[])`, [
    keeper,
    losers,
  ]);
}

async function remapProductImageDetections(c: PoolClient, keeper: number, losers: number[]): Promise<void> {
  if (!(await tableExists("product_image_detections"))) return;
  await c.query(
    `UPDATE product_image_detections SET product_id = $1 WHERE product_id = ANY($2::bigint[])`,
    [keeper, losers]
  );
}

async function remapOutfits(c: PoolClient, keeper: number, losers: number[]): Promise<void> {
  if (!(await tableExists("outfits"))) return;
  // Legacy schema (db/schema.sql); migration 003 drops product_ids in favor of outfit_items → wardrobe_items
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
    `DELETE FROM price_history p USING price_history k
     WHERE p.product_id = ANY($1::bigint[]) AND k.product_id = $2
       AND k.recorded_at IS NOT DISTINCT FROM p.recorded_at`,
    [losers, keeper]
  );
  await c.query(`UPDATE price_history SET product_id = $1 WHERE product_id = ANY($2::bigint[])`, [
    keeper,
    losers,
  ]);
  await c.query(
    `DELETE FROM price_history ph WHERE ph.id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY product_id, recorded_at ORDER BY id) AS rn
        FROM price_history WHERE product_id = $1
      ) t WHERE t.rn > 1
    )`,
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

async function migrateGroup(
  c: PoolClient,
  group: ParentGroup,
  skipOs: boolean
): Promise<{ losers: number[] }> {
  const keeper = Math.min(...group.ids);
  const losers = group.ids.filter((id) => id !== keeper);

  const skip = await c.query(`SELECT 1 FROM product_variants WHERE product_id = $1 LIMIT 1`, [
    keeper,
  ]);
  if (skip.rowCount) {
    console.warn(
      `[migrate-to-product-variants] Skip vendor=${group.vendor_id} keeper=${keeper}: already has product_variants (resume-safe).`
    );
    return { losers: [] };
  }

  const rows = await loadProducts(c, group.ids);
  if (rows.length !== group.ids.length) {
    throw new Error(`Product row count mismatch for ids ${group.ids.join(",")}`);
  }

  const canonicalUrl = pickCanonicalParentUrl(rows);
  const minPrice = Math.min(...rows.map((r) => parseInt(r.price_cents, 10)));
  const salesVals = rows
    .map((r) => (r.sales_price_cents != null ? parseInt(r.sales_price_cents, 10) : NaN))
    .filter((n) => Number.isFinite(n));
  const minSales = salesVals.length ? Math.min(...salesVals) : null;
  const anyAvail = rows.some((r) => r.availability);
  const lastSeen = new Date(Math.max(...rows.map((r) => new Date(r.last_seen).getTime())));

  await mergeCartItems(c, keeper, losers);
  await mergeFavorites(c, keeper, losers);
  await mergeUserSavedItems(c, keeper, losers);
  await remapUserUploadedImages(c, keeper, losers);
  await remapWardrobeItems(c, keeper, losers);
  await remapProductImageDetections(c, keeper, losers);
  await remapOutfits(c, keeper, losers);
  await moveProductImages(c, keeper, losers);
  await dropLoserCacheRows(c, losers);
  await mergePriceHistory(c, keeper, losers);
  await mergePriceDropEvents(c, keeper, losers);

  const variantInsertRows = dedupeProductRowsByVariantId(rows, keeper);
  for (const r of variantInsertRows) {
    await c.query(
      `INSERT INTO product_variants (
         product_id, vendor_id, variant_id, product_url, size, color, currency,
         price_cents, sales_price_cents, availability, last_seen, image_url, image_urls,
         legacy_product_id, is_default
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        keeper,
        r.vendor_id,
        r.variant_id,
        r.product_url,
        r.size,
        r.color,
        r.currency,
        parseInt(r.price_cents, 10),
        r.sales_price_cents != null ? parseInt(r.sales_price_cents, 10) : null,
        r.availability,
        r.last_seen,
        r.image_url,
        r.image_urls != null ? JSON.stringify(r.image_urls) : null,
        r.id,
        r.id === keeper,
      ]
    );
  }

  // Losers often already use the canonical listing URL; keeper UPDATE would duplicate (vendor_id, product_url).
  for (const lid of losers) {
    await c.query(
      `UPDATE products SET product_url = $2 WHERE id = $1`,
      [lid, `https://__variant-merge-obsolete.invalid/p/${lid}`]
    );
  }

  const def = rows.find((r) => r.id === keeper) ?? rows[0];
  await c.query(
    `UPDATE products SET
       product_url = $2,
       parent_product_url = $2,
       variant_id = NULL,
       size = NULL,
       color = NULL,
       currency = $3,
       price_cents = $4,
       sales_price_cents = $5,
       availability = $6,
       last_seen = $7,
       image_url = $8,
       image_urls = $9,
       image_cdn = $10,
       p_hash = $11
     WHERE id = $1`,
    [
      keeper,
      canonicalUrl,
      def.currency,
      minPrice,
      minSales,
      anyAvail,
      lastSeen,
      def.image_url,
      def.image_urls != null ? JSON.stringify(def.image_urls) : null,
      def.image_cdn,
      def.p_hash,
    ]
  );

  await c.query(
    `UPDATE product_variants SET is_default = (legacy_product_id IS NOT DISTINCT FROM $2::bigint) WHERE product_id = $1`,
    [keeper, keeper]
  );

  await ensureKeeperPrimaryImage(c, keeper);
  await c.query(`DELETE FROM products WHERE id = ANY($1::bigint[])`, [losers]);

  if (!skipOs) {
    await deleteOpensearchDocs(losers);
  }

  return { losers };
}

async function main() {
  const { execute, skipOs, limit, vendorId } = parseArgs();

  await ensureProductVariantsTable();

  console.log(
    execute
      ? "MODE: EXECUTE — creates product_variants rows, collapses parents, deletes variant-only product ids"
      : "MODE: DRY-RUN — no writes. Pass --execute to apply."
  );
  if (vendorId != null) console.log(`Vendor filter: ${vendorId}`);
  if (limit !== Infinity) console.log(`Group limit: ${limit}`);

  const groups = (await fetchMultiVariantGroups(vendorId)).slice(0, limit);

  let extra = 0;
  for (const g of groups) extra += g.cnt - 1;
  console.log(`\nParent listing groups (≥2 variant rows): ${groups.length}`);
  console.log(`Variant product rows to fold into parents + variants table: ~${extra}\n`);

  for (const g of groups.slice(0, 30)) {
    console.log(`  cnt=${g.cnt} vendor=${g.vendor_id} listing=${g.listing_key.slice(0, 72)}… ids=${g.ids.join(",")}`);
  }
  if (groups.length > 30) console.log(`  … ${groups.length - 30} more groups`);

  if (!execute) {
    console.log("\nNo changes. See docs/product-variants.md. Then run with --execute.");
    process.exit(0);
  }

  let done = 0;
  for (const g of groups) {
    const client = await pg.connect();
    try {
      await client.query("BEGIN");
      await migrateGroup(client, g, skipOs);
      await client.query("COMMIT");
      done++;
      if (done % 10 === 0) console.log(`Progress: ${done}/${groups.length} listings migrated`);
    } catch (e) {
      await client.query("ROLLBACK");
      console.error(`Failed listing vendor=${g.vendor_id} key=${g.listing_key.slice(0, 80)}:`, e);
      throw e;
    } finally {
      client.release();
    }
  }

  console.log(`\nDone. Migrated ${done} parent listings into products + product_variants.`);
  if (skipOs) console.log("OpenSearch skipped; remove stale docs or reindex.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
