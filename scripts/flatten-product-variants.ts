/**
 * Flatten `product_variants` back into one row per SKU on `products`, then drop `product_variants`.
 *
 * Run BEFORE deploying application code that removes variant support:
 *   pnpm tsx scripts/flatten-product-variants.ts           # dry-run
 *   pnpm tsx scripts/flatten-product-variants.ts --execute
 *   pnpm tsx scripts/flatten-product-variants.ts --execute --skip-opensearch
 *
 * After success, apply db/migrations/012_drop_product_variants.sql (no-op if table already gone).
 */
import "dotenv/config";
import type { PoolClient } from "pg";
import { pg, osClient } from "../src/lib/core";
import { config } from "../src/config";

function parseArgs() {
  const argv = process.argv.slice(2);
  return {
    execute: argv.includes("--execute"),
    skipOs: argv.includes("--skip-opensearch"),
  };
}

async function tableExists(c: PoolClient, name: string): Promise<boolean> {
  const r = await c.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
    [name],
  );
  return (r.rowCount ?? 0) > 0;
}

async function columnExists(c: PoolClient, table: string, column: string): Promise<boolean> {
  const r = await c.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return (r.rowCount ?? 0) > 0;
}

/** Compare listing URLs for dedupe (trim, case, trailing slash). */
function sqlNormProductUrl(expr: string): string {
  return `lower(btrim(regexp_replace(coalesce(${expr}, ''), '/$', '')))`;
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

export async function flattenProductVariants(opts: { execute: boolean; skipOs: boolean }): Promise<void> {
  /** Filled after a successful COMMIT; OpenSearch cleanup runs only after the DB client is released. */
  let opensearchParentIdsToRemove: number[] = [];

  const client = await pg.connect();
  try {
    await client.query("BEGIN");

    if (!(await tableExists(client, "product_variants"))) {
      console.log("No product_variants table — nothing to do.");
      await client.query("ROLLBACK");
      return;
    }

    const { rows: cntRows } = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM product_variants`,
    );
    const variantCount = parseInt(cntRows[0]?.n ?? "0", 10);
    if (variantCount === 0) {
      console.log("product_variants is empty — dropping table only.");
      if (opts.execute) {
        await client.query(`DROP TABLE IF EXISTS product_variants`);
        await client.query("COMMIT");
      } else {
        await client.query("ROLLBACK");
        console.log("Dry-run: would DROP TABLE product_variants");
      }
      return;
    }

    if (await columnExists(client, "products", "_flatten_pv_id")) {
      throw new Error(
        "products._flatten_pv_id exists — previous run may have failed. Fix manually or restore from backup.",
      );
    }

    const optCols: string[] = [];
    if (await columnExists(client, "products", "is_hidden")) optCols.push("is_hidden");
    if (await columnExists(client, "products", "is_flagged")) optCols.push("is_flagged");
    if (await columnExists(client, "products", "flag_reason")) optCols.push("flag_reason");
    if (await columnExists(client, "products", "canonical_id")) optCols.push("canonical_id");
    if (await columnExists(client, "products", "source")) optCols.push("source");
    if (await columnExists(client, "products", "created_at")) optCols.push("created_at");
    if (await columnExists(client, "products", "updated_at")) optCols.push("updated_at");

    const baseCols = [
      "vendor_id",
      "product_url",
      "parent_product_url",
      "variant_id",
      "title",
      "brand",
      "category",
      "description",
      "size",
      "color",
      "currency",
      "price_cents",
      "sales_price_cents",
      "availability",
      "last_seen",
      "image_url",
      "image_urls",
      "image_cdn",
      "primary_image_id",
      "p_hash",
      "return_policy",
      "_flatten_pv_id",
    ];
    const insertCols = [...baseCols, ...optCols].join(", ");

    const baseSelect = [
      "pv.vendor_id",
      "pv.product_url",
      "NULLIF(btrim(p.product_url), '')",
      "pv.variant_id",
      "p.title",
      "p.brand",
      "p.category",
      "COALESCE(NULLIF(btrim(pv.description), ''), p.description)",
      "pv.size",
      "pv.color",
      "pv.currency",
      "pv.price_cents",
      "pv.sales_price_cents",
      "pv.availability",
      "pv.last_seen",
      "COALESCE(pv.image_url, p.image_url)",
      "COALESCE(pv.image_urls, p.image_urls)",
      "COALESCE(NULLIF(btrim(pv.image_url), ''), p.image_cdn)",
      "NULL::integer",
      "p.p_hash",
      "p.return_policy",
      "pv.id",
    ];
    const selectExprs = [...baseSelect, ...optCols.map((c) => `p.${c}`)].join(",\n        ");

    const uP = sqlNormProductUrl("p.product_url");
    const uPv = sqlNormProductUrl("pv.product_url");
    const uX = sqlNormProductUrl("x.product_url");
    const uO = sqlNormProductUrl("o.product_url");

    /** Same sellable URL as parent row — cannot INSERT without violating (vendor_id, product_url). */
    const insertSql = `
      INSERT INTO products (${insertCols})
      SELECT
        ${selectExprs}
      FROM product_variants pv
      INNER JOIN products p ON p.id = pv.product_id
      WHERE ${uP} <> ${uPv}
        AND NOT EXISTS (
          SELECT 1 FROM products x
          WHERE x.vendor_id = pv.vendor_id
            AND ${uX} = ${uPv}
        )
    `;

    const optAssignFromP = optCols.length ? `, ${optCols.map((c) => `${c} = p.${c}`).join(", ")}` : "";

    const { rows: parentRows } = await client.query<{ id: string }>(
      `SELECT DISTINCT product_id::text AS id FROM product_variants`,
    );
    const parentIds = parentRows.map((r) => parseInt(r.id, 10)).filter((n) => Number.isFinite(n) && n > 0);

    console.log(
      `[flatten-product-variants] ${variantCount} variant rows → new product rows for ${parentIds.length} parent listings`,
    );

    if (!opts.execute) {
      await client.query("ROLLBACK");
      console.log("Dry-run: no changes. Pass --execute to apply.");
      return;
    }

    await client.query(`ALTER TABLE products ADD COLUMN _flatten_pv_id BIGINT`);

    const updSameUrl = await client.query(`
      UPDATE products p
      SET
        parent_product_url = COALESCE(NULLIF(btrim(p.parent_product_url), ''), NULLIF(btrim(p.product_url), '')),
        variant_id = pv.variant_id,
        description = COALESCE(NULLIF(btrim(pv.description), ''), p.description),
        size = pv.size,
        color = pv.color,
        currency = pv.currency,
        price_cents = pv.price_cents,
        sales_price_cents = pv.sales_price_cents,
        availability = pv.availability,
        last_seen = pv.last_seen,
        image_url = COALESCE(pv.image_url, p.image_url),
        image_urls = COALESCE(pv.image_urls, p.image_urls),
        image_cdn = COALESCE(NULLIF(btrim(pv.image_url), ''), p.image_cdn),
        _flatten_pv_id = pv.id
      FROM product_variants pv
      WHERE p.id = pv.product_id
        AND ${uP} = ${uPv}
    `);

    const updOrphanUrl = await client.query(`
      UPDATE products o
      SET
        parent_product_url = COALESCE(NULLIF(btrim(p.parent_product_url), ''), NULLIF(btrim(p.product_url), '')),
        title = p.title,
        brand = p.brand,
        category = p.category,
        description = COALESCE(NULLIF(btrim(pv.description), ''), p.description),
        variant_id = pv.variant_id,
        size = pv.size,
        color = pv.color,
        currency = pv.currency,
        price_cents = pv.price_cents,
        sales_price_cents = pv.sales_price_cents,
        availability = pv.availability,
        last_seen = pv.last_seen,
        image_url = COALESCE(pv.image_url, p.image_url),
        image_urls = COALESCE(pv.image_urls, p.image_urls),
        image_cdn = COALESCE(NULLIF(btrim(pv.image_url), ''), p.image_cdn),
        p_hash = p.p_hash,
        return_policy = p.return_policy,
        _flatten_pv_id = pv.id
        ${optAssignFromP}
      FROM product_variants pv
      INNER JOIN products p ON p.id = pv.product_id
      WHERE o.vendor_id = pv.vendor_id
        AND ${uO} = ${uPv}
        AND o.id <> p.id
        AND o._flatten_pv_id IS NULL
    `);

    const ins = await client.query(insertSql);

    console.log(
      `[flatten-product-variants] merged in-place (variant URL = parent URL): ${updSameUrl.rowCount ?? 0} rows; ` +
        `merged orphan duplicate URL: ${updOrphanUrl.rowCount ?? 0}; inserted new product rows: ${ins.rowCount ?? 0}`,
    );

    await client.query(`
      CREATE UNIQUE INDEX uq_products_flatten_pv_id ON products (_flatten_pv_id)
      WHERE _flatten_pv_id IS NOT NULL
    `);

    // Map parent_id -> new product id for default variant (cart / favorites / FK remaps)
    await client.query(`
      CREATE TEMP TABLE _pv_parent_default_new AS
      SELECT DISTINCT ON (pv.product_id)
        pv.product_id AS parent_id,
        np.id AS new_id
      FROM product_variants pv
      INNER JOIN products np ON np._flatten_pv_id = pv.id
      ORDER BY pv.product_id, pv.is_default DESC, pv.id ASC
    `);

    const remapCartFavorites = async () => {
      await client.query(`
        DELETE FROM cart_items c USING cart_items k, _pv_parent_default_new m
        WHERE c.user_id = k.user_id
          AND c.product_id = m.new_id
          AND k.product_id = m.parent_id
      `);
      await client.query(`
        UPDATE cart_items c
        SET product_id = m.new_id
        FROM _pv_parent_default_new m
        WHERE c.product_id = m.parent_id
      `);
      await client.query(`
        DELETE FROM favorites f USING favorites k, _pv_parent_default_new m
        WHERE f.user_id = k.user_id
          AND f.product_id = m.new_id
          AND k.product_id = m.parent_id
      `);
      await client.query(`
        UPDATE favorites f
        SET product_id = m.new_id
        FROM _pv_parent_default_new m
        WHERE f.product_id = m.parent_id
      `);
    };

    await remapCartFavorites();

    if (await tableExists(client, "user_saved_items")) {
      await client.query(`
        DELETE FROM user_saved_items u USING user_saved_items k, _pv_parent_default_new m
        WHERE u.user_id = k.user_id AND u.source = k.source
          AND u.product_id = m.new_id
          AND k.product_id = m.parent_id
      `);
      await client.query(`
        UPDATE user_saved_items u
        SET product_id = m.new_id
        FROM _pv_parent_default_new m
        WHERE u.product_id = m.parent_id AND u.product_id IS NOT NULL
      `);
    }

    if (await tableExists(client, "user_uploaded_images")) {
      await client.query(`
        UPDATE user_uploaded_images u
        SET product_id = m.new_id
        FROM _pv_parent_default_new m
        WHERE u.product_id = m.parent_id
      `);
    }

    if (await tableExists(client, "wardrobe_items")) {
      await client.query(`
        UPDATE wardrobe_items w
        SET product_id = m.new_id
        FROM _pv_parent_default_new m
        WHERE w.product_id = m.parent_id
      `);
    }

    if (await tableExists(client, "product_image_detections")) {
      await client.query(`
        UPDATE product_image_detections d
        SET product_id = m.new_id
        FROM _pv_parent_default_new m
        WHERE d.product_id = m.parent_id
      `);
    }

    if (await tableExists(client, "tryon_jobs")) {
      await client.query(`
        UPDATE tryon_jobs j
        SET garment_ref_id = m.new_id
        FROM _pv_parent_default_new m
        WHERE j.garment_source = 'product'
          AND j.garment_ref_id = m.parent_id
      `);
    }

    if (await tableExists(client, "price_drop_events")) {
      await client.query(`
        UPDATE price_drop_events e
        SET product_id = m.new_id
        FROM _pv_parent_default_new m
        WHERE e.product_id = m.parent_id
      `);
    }

    if (await tableExists(client, "price_history")) {
      await client.query(`
        DELETE FROM price_history p USING price_history k, _pv_parent_default_new m
        WHERE p.product_id = m.new_id
          AND k.product_id = m.parent_id
          AND k.recorded_at IS NOT DISTINCT FROM p.recorded_at
      `);
      await client.query(`
        UPDATE price_history ph
        SET product_id = m.new_id
        FROM _pv_parent_default_new m
        WHERE ph.product_id = m.parent_id
      `);
      await client.query(`
        DELETE FROM price_history ph WHERE ph.id IN (
          SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY product_id, recorded_at ORDER BY id) AS rn
            FROM price_history
          ) t WHERE t.rn > 1
        )
      `);
    }

    if (await tableExists(client, "product_quality_scores")) {
      await client.query(`
        UPDATE product_quality_scores q
        SET product_id = m.new_id
        FROM _pv_parent_default_new m
        WHERE q.product_id = m.parent_id
      `);
    }

    if (await tableExists(client, "product_price_analysis")) {
      await client.query(`
        UPDATE product_price_analysis a
        SET product_id = m.new_id
        FROM _pv_parent_default_new m
        WHERE a.product_id = m.parent_id
      `);
    }

    if (await tableExists(client, "product_search_enrichment")) {
      await client.query(`
        INSERT INTO product_search_enrichment (
          product_id, canonical_type_ids, raw_category, raw_brand,
          norm_confidence, category_confidence, brand_confidence,
          attribute_json, classifier_version, updated_at
        )
        SELECT
          np.id,
          e.canonical_type_ids,
          e.raw_category,
          e.raw_brand,
          e.norm_confidence,
          e.category_confidence,
          e.brand_confidence,
          e.attribute_json,
          e.classifier_version,
          e.updated_at
        FROM product_search_enrichment e
        INNER JOIN product_variants pv ON pv.product_id = e.product_id
        INNER JOIN products np ON np._flatten_pv_id = pv.id
        ON CONFLICT (product_id) DO NOTHING
      `);
    }

    if (await tableExists(client, "recommendation_impressions")) {
      await client.query(`
        UPDATE recommendation_impressions ri
        SET base_product_id = m.new_id
        FROM _pv_parent_default_new m
        WHERE ri.base_product_id = m.parent_id
      `);
      await client.query(`
        UPDATE recommendation_impressions ri
        SET candidate_product_id = m.new_id
        FROM _pv_parent_default_new m
        WHERE ri.candidate_product_id = m.parent_id
      `);
    }

    if (await tableExists(client, "recommendation_labels")) {
      await client.query(`
        UPDATE recommendation_labels rl
        SET base_product_id = m.new_id
        FROM _pv_parent_default_new m
        WHERE rl.base_product_id = m.parent_id
      `);
      await client.query(`
        UPDATE recommendation_labels rl
        SET candidate_product_id = m.new_id
        FROM _pv_parent_default_new m
        WHERE rl.candidate_product_id = m.parent_id
      `);
    }

    if (await columnExists(client, "outfits", "product_ids")) {
      const { rows } = await client.query<{ id: number; product_ids: number[] | null }>(
        `SELECT id, product_ids FROM outfits WHERE product_ids IS NOT NULL AND cardinality(product_ids) > 0`,
      );
      const mapRes = await client.query<{ parent_id: string; new_id: string }>(
        `SELECT parent_id::text, new_id::text FROM _pv_parent_default_new`,
      );
      const parentToNew = new Map(mapRes.rows.map((r) => [r.parent_id, r.new_id]));
      for (const row of rows) {
        const arr = row.product_ids;
        if (!arr?.length) continue;
        const next = [...new Set(arr.map((pid) => parentToNew.get(String(pid)) ?? String(pid)))].map((x) =>
          parseInt(x, 10),
        );
        const changed = next.length !== arr.length || next.some((v, i) => v !== Number(arr[i]));
        if (changed) {
          await client.query(`UPDATE outfits SET product_ids = $2 WHERE id = $1`, [row.id, next]);
        }
      }
    }

    // Gallery rows: keep on default SKU listing only
    if (await tableExists(client, "product_images")) {
      await client.query(`
        UPDATE product_images pi
        SET product_id = m.new_id
        FROM _pv_parent_default_new m
        WHERE pi.product_id = m.parent_id
      `);
      await client.query(`
        UPDATE products p
        SET primary_image_id = sub.pid
        FROM (
          SELECT p2.id AS nid,
                 (SELECT id FROM product_images WHERE product_id = p2.id AND is_primary = true ORDER BY id LIMIT 1) AS pid
          FROM products p2
          WHERE p2._flatten_pv_id IS NOT NULL
        ) sub
        WHERE p.id = sub.nid AND sub.pid IS NOT NULL AND p.primary_image_id IS NULL
      `);
    }

    const { rows: osDropRows } = await client.query<{ id: string }>(
      `SELECT id::text FROM products
       WHERE id IN (SELECT DISTINCT product_id FROM product_variants)
         AND _flatten_pv_id IS NULL`,
    );
    opensearchParentIdsToRemove = osDropRows
      .map((r) => parseInt(r.id, 10))
      .filter((n) => Number.isFinite(n) && n > 0);

    await client.query(`
      DELETE FROM products
      WHERE id IN (SELECT DISTINCT product_id FROM product_variants)
        AND _flatten_pv_id IS NULL
    `);

    await client.query(`DROP INDEX IF EXISTS uq_products_flatten_pv_id`);
    await client.query(`ALTER TABLE products DROP COLUMN _flatten_pv_id`);

    await client.query(`DROP TABLE product_variants`);

    await client.query("COMMIT");
    console.log("Flatten complete. product_variants dropped.");
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* connection may already be closed */
    }
    throw e;
  } finally {
    client.removeAllListeners("error");
    client.release();
  }

  if (!opts.skipOs && opensearchParentIdsToRemove.length > 0) {
    console.log(
      `Removing ${opensearchParentIdsToRemove.length} stale OpenSearch docs (collapsed parent ids only)…`,
    );
    await deleteOpensearchDocs(opensearchParentIdsToRemove);
  }
}

async function main() {
  const { execute, skipOs } = parseArgs();
  try {
    await flattenProductVariants({ execute, skipOs });
  } finally {
    await pg.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
