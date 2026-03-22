/**
 * Parents that already went through variant migration may have empty `products.description`
 * if the keeper row never had PDP text (it lived only on deleted "loser" rows).
 * That text is not stored on `product_variants`, so it cannot be rebuilt from SQL alone.
 *
 * This script:
 * 1) Reports how many variant parents are missing descriptions (dry-run by default).
 * 2) Optionally copies `description` from OpenSearch → Postgres when the index still has it
 *    (e.g. never wiped by a bad reindex).
 * 3) Prints parent `product_url` lines you can feed back through your vendor crawlers.
 *
 * Usage:
 *   npx tsx scripts/backfill-parent-descriptions.ts
 *   npx tsx scripts/backfill-parent-descriptions.ts --apply-os --limit=200
 *   npx tsx scripts/backfill-parent-descriptions.ts --vendor-id=8
 */
import "dotenv/config";
import { pg } from "../src/lib/core";
import { osClient } from "../src/lib/core/opensearch";
import { config } from "../src/config";

function parseArgs() {
  const argv = process.argv.slice(2);
  return {
    applyOs: argv.includes("--apply-os"),
    vendorId: (() => {
      const a = argv.find((x) => x.startsWith("--vendor-id="));
      if (!a) return null;
      const n = parseInt(a.split("=")[1], 10);
      return Number.isFinite(n) ? n : null;
    })(),
    limit: (() => {
      const a = argv.find((x) => x.startsWith("--limit="));
      if (!a) return null;
      const n = parseInt(a.split("=")[1], 10);
      return Number.isFinite(n) && n > 0 ? n : null;
    })(),
  };
}

async function tableExists(name: string): Promise<boolean> {
  const r = await pg.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1`,
    [name],
  );
  return (r.rowCount ?? 0) > 0;
}

interface ParentRow {
  id: number;
  vendor_id: number;
  product_url: string;
  title: string | null;
}

async function fetchTargets(vendorId: number | null, limit: number | null): Promise<ParentRow[]> {
  const params: unknown[] = [];
  let v = "";
  if (vendorId !== null) {
    params.push(vendorId);
    v = `AND p.vendor_id = $${params.length}`;
  }
  let lim = "";
  if (limit !== null) {
    params.push(limit);
    lim = `LIMIT $${params.length}`;
  }
  const { rows } = await pg.query<ParentRow>(
    `SELECT p.id, p.vendor_id, p.product_url, p.title
     FROM products p
     WHERE EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id)
       AND (p.description IS NULL OR btrim(p.description) = '')
       ${v}
     ORDER BY p.id
     ${lim}`,
    params,
  );
  return rows;
}

async function mgetDescriptions(ids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (ids.length === 0) return out;
  const chunk = 80;
  for (let i = 0; i < ids.length; i += chunk) {
    const slice = ids.slice(i, i + chunk);
    const result = await osClient.mget({
      index: config.opensearch.index,
      body: { ids: slice.map(String) },
    });
    const docs = (result.body as { docs?: Array<{ found?: boolean; _id?: string; _source?: { description?: string | null } }> })
      .docs ?? [];
    for (const doc of docs) {
      if (!doc?.found || doc._id == null) continue;
      const id = parseInt(doc._id, 10);
      if (!Number.isFinite(id)) continue;
      const d = doc._source?.description;
      const t = typeof d === "string" ? d.trim() : "";
      if (t.length > 0) out.set(id, t);
    }
  }
  return out;
}

async function main(): Promise<void> {
  const { applyOs, vendorId, limit } = parseArgs();

  if (!(await tableExists("product_variants"))) {
    console.log("No product_variants table — nothing to do.");
    process.exit(0);
  }

  const targets = await fetchTargets(vendorId, limit);
  console.log(
    `Parents with ≥1 variant and empty description: ${targets.length}` +
      (vendorId != null ? ` (vendor_id=${vendorId})` : "") +
      (limit != null ? ` (limit ${limit})` : ""),
  );

  if (targets.length === 0) {
    console.log("Nothing to backfill.");
    process.exit(0);
  }

  const ids = targets.map((r) => r.id);
  console.log("Fetching OpenSearch descriptions for those ids…");
  const fromOs = await mgetDescriptions(ids);
  console.log(`OpenSearch had non-empty description for ${fromOs.size} of ${ids.length} ids.`);

  if (applyOs && fromOs.size > 0) {
    let updated = 0;
    for (const [id, description] of fromOs) {
      const r = await pg.query(`UPDATE products SET description = $2 WHERE id = $1`, [id, description]);
      if ((r.rowCount ?? 0) > 0) updated++;
    }
    console.log(`Updated products.description from OpenSearch for ${updated} rows.`);
    console.log("Reindex those products (e.g. resume-reindex --force) if search still looks stale.");
  } else if (!applyOs && fromOs.size > 0) {
    console.log("Re-run with --apply-os to copy those OpenSearch descriptions into Postgres.");
  }

  const stillNeedCrawl = targets.filter((r) => !fromOs.has(r.id)).length;
  console.log(
    `\n${stillNeedCrawl} parents still have no description in Postgres` +
      (fromOs.size > 0 ? " (and none in OpenSearch to recover)" : "") +
      ". Re-scrape the parent product_url (canonical PDP) for those listings.",
  );

  console.log("\nSample URLs to re-crawl (first 25):");
  for (const r of targets.filter((x) => !fromOs.has(x.id)).slice(0, 25)) {
    console.log(`${r.id}\t${r.product_url}`);
  }
  if (stillNeedCrawl > 25) console.log(`… and ${stillNeedCrawl - 25} more`);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
