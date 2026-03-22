/**
 * Sanity-check `products` + `product_variants` after migration or ongoing ingest.
 *
 *   npx tsx scripts/verify-product-variants.ts
 *
 * Exits 1 if any hard check fails. Warnings do not fail the run.
 */
import "dotenv/config";
import { pg } from "../src/lib/core";

async function tableExists(name: string): Promise<boolean> {
  const r = await pg.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1`,
    [name],
  );
  return (r.rowCount ?? 0) > 0;
}

async function main(): Promise<void> {
  const hasVariants = await tableExists("product_variants");
  if (!hasVariants) {
    console.log("OK   product_variants table does not exist — nothing to verify.");
    process.exit(0);
  }

  let failed = false;
  const fail = (msg: string) => {
    console.error(`FAIL ${msg}`);
    failed = true;
  };
  const ok = (msg: string) => console.log(`OK   ${msg}`);
  const warn = (msg: string) => console.warn(`WARN ${msg}`);
  const info = (msg: string) => console.log(`     ${msg}`);

  // 1) Orphan SKUs (no parent row). Should be impossible with FK ON DELETE from parent.
  const orphan = await pg.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c
     FROM product_variants pv
     LEFT JOIN products p ON p.id = pv.product_id
     WHERE p.id IS NULL`,
  );
  const orphanN = parseInt(orphan.rows[0]?.c ?? "0", 10);
  if (orphanN > 0) fail(`${orphanN} product_variants rows have no matching products row (orphans)`);
  else ok("No orphan product_variants (every product_id resolves to products)");

  // 2) vendor_id must match parent (variants table denormalizes vendor_id)
  const vMis = await pg.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c
     FROM product_variants pv
     JOIN products p ON p.id = pv.product_id
     WHERE pv.vendor_id IS DISTINCT FROM p.vendor_id`,
  );
  const vMisN = parseInt(vMis.rows[0]?.c ?? "0", 10);
  if (vMisN > 0)
    fail(`${vMisN} product_variants rows have vendor_id ≠ parent products.vendor_id`);
  else ok("product_variants.vendor_id matches parent products.vendor_id");

  // 3) At most one default SKU per parent
  const multiDef = await pg.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM (
       SELECT product_id
       FROM product_variants
       GROUP BY product_id
       HAVING COUNT(*) FILTER (WHERE is_default) > 1
     ) t`,
  );
  const multiDefN = parseInt(multiDef.rows[0]?.c ?? "0", 10);
  if (multiDefN > 0) fail(`${multiDefN} parents have more than one is_default variant`);
  else ok("At most one is_default variant per product_id");

  // 4) Multi-SKU parents should have exactly one default (migration sets this)
  const noDef = await pg.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM (
       SELECT product_id
       FROM product_variants
       GROUP BY product_id
       HAVING COUNT(*) > 1 AND COUNT(*) FILTER (WHERE is_default) = 0
     ) t`,
  );
  const noDefN = parseInt(noDef.rows[0]?.c ?? "0", 10);
  if (noDefN > 0)
    warn(
      `${noDefN} parents with 2+ variants have no is_default — UI may not know which SKU to show first`,
    );
  else ok("Every multi-variant parent has at least one is_default");

  // 5) Duplicate (vendor_id, product_url) on variants
  const dupUrl = await pg.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM (
       SELECT vendor_id, product_url
       FROM product_variants
       GROUP BY vendor_id, product_url
       HAVING COUNT(*) > 1
     ) t`,
  );
  const dupUrlN = parseInt(dupUrl.rows[0]?.c ?? "0", 10);
  if (dupUrlN > 0) fail(`${dupUrlN} duplicate (vendor_id, product_url) groups in product_variants`);
  else ok("No duplicate (vendor_id, product_url) in product_variants");

  // 6) Leftover merge placeholder rows (losers should be deleted after migration)
  const ghosts = await pg.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM products
     WHERE product_url LIKE 'https://__variant-merge-obsolete.invalid/%'`,
  );
  const ghostsN = parseInt(ghosts.rows[0]?.c ?? "0", 10);
  if (ghostsN > 0)
    fail(`${ghostsN} products rows still use __variant-merge-obsolete.invalid URLs (stuck merge?)`);
  else ok("No leftover variant-merge obsolete placeholder product_url rows");

  // 7) Optional: parent still has SKU columns while variants exist (post-migration style is NULL on parent)
  const hybrid = await pg.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c
     FROM products p
     WHERE EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id)
       AND (
         p.variant_id IS NOT NULL AND btrim(p.variant_id::text) <> ''
         OR p.size IS NOT NULL AND btrim(p.size::text) <> ''
         OR p.color IS NOT NULL AND btrim(p.color::text) <> ''
       )`,
  );
  const hybridN = parseInt(hybrid.rows[0]?.c ?? "0", 10);
  if (hybridN > 0)
    warn(
      `${hybridN} parents have product_variants but products still has variant_id/size/color set — OK if you have not normalized parents yet`,
    );
  else ok("Parents with variants have empty variant_id/size/color on products (normalized)");

  // Summary counts
  const sums = await pg.query<{ products: string; variants: string; parents_with_v: string }>(
    `SELECT
       (SELECT COUNT(*)::text FROM products) AS products,
       (SELECT COUNT(*)::text FROM product_variants) AS variants,
       (SELECT COUNT(DISTINCT product_id)::text FROM product_variants) AS parents_with_v`,
  );
  const row = sums.rows[0];
  info(`products row count: ${row?.products ?? "?"}`);
  info(`product_variants row count: ${row?.variants ?? "?"}`);
  info(`distinct parent product_ids in product_variants: ${row?.parents_with_v ?? "?"}`);

  if (failed) {
    console.error("\nSome checks failed — fix data or re-run migration as appropriate.");
    process.exit(1);
  }
  console.log("\nAll hard checks passed.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
