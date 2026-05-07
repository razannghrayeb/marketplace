/**
 * Backfill missing products.gender from catalog text and URL signals.
 *
 * Checks title, description, product_url, and parent_product_url. Dry-run by default.
 *
 * Usage:
 *   npx tsx scripts/backfill-product-gender.ts
 *   npx tsx scripts/backfill-product-gender.ts --apply
 *   npx tsx scripts/backfill-product-gender.ts --apply --sync-os --min-confidence=0.8
 *   npx tsx scripts/backfill-product-gender.ts --apply --os-only
 *   npx tsx scripts/backfill-product-gender.ts --apply --limit=5000 --vendor-id=8
 *   npx tsx scripts/backfill-product-gender.ts --min-confidence=0.6
 */
import "dotenv/config";
import { pg } from "../src/lib/core/db";
import { osClient } from "../src/lib/core/opensearch";
import { config } from "../src/config";
import {
  DEFAULT_CATALOG_GENDER_MIN_CONFIDENCE,
  inferProductGender,
  type CatalogGender,
  type InferredGenderResult,
} from "../src/lib/search/productGenderInference";

const INDEX = config.opensearch.index;

interface Args {
  apply: boolean;
  batch: number;
  limit: number | null;
  minConfidence: number;
  noRefreshOs: boolean;
  osOnly: boolean;
  sample: number;
  syncOpenSearch: boolean;
  vendorId: number | null;
  help: boolean;
}

interface ProductRow {
  id: number;
  title: string | null;
  description: string | null;
  gender: string | null;
  product_url: string | null;
  parent_product_url: string | null;
}

interface GenderUpdate {
  id: number;
  gender: CatalogGender;
  inferred: InferredGenderResult;
  row: ProductRow;
}

interface OpenSearchGenderUpdate {
  id: number;
  gender: CatalogGender;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseNullablePositiveInt(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parsePositiveFloat(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function readFlagValue(name: string, argv: string[]): string | undefined {
  const prefix = `${name}=`;
  const joined = argv.find((arg) => arg.startsWith(prefix));
  if (joined) return joined.slice(prefix.length);
  const idx = argv.indexOf(name);
  return idx >= 0 ? argv[idx + 1] : undefined;
}

function parseArgs(argv = process.argv.slice(2)): Args {
  return {
    apply: argv.includes("--apply"),
    batch: parsePositiveInt(readFlagValue("--batch", argv), 1000),
    limit: parseNullablePositiveInt(readFlagValue("--limit", argv)),
    minConfidence: Math.min(
      1,
      parsePositiveFloat(
        readFlagValue("--min-confidence", argv),
        DEFAULT_CATALOG_GENDER_MIN_CONFIDENCE,
      ),
    ),
    noRefreshOs: argv.includes("--no-refresh-os"),
    osOnly: argv.includes("--os-only"),
    sample: parsePositiveInt(readFlagValue("--sample", argv), 20),
    syncOpenSearch: argv.includes("--sync-os") || argv.includes("--os-only"),
    vendorId: parseNullablePositiveInt(readFlagValue("--vendor-id", argv)),
    help: argv.includes("--help") || argv.includes("-h"),
  };
}

function printHelp(): void {
  console.log(`
Backfill Product Gender

Dry-run:
  npx tsx scripts/backfill-product-gender.ts

Apply:
  npx tsx scripts/backfill-product-gender.ts --apply

Apply and update OpenSearch without recomputing embeddings:
  npx tsx scripts/backfill-product-gender.ts --apply --sync-os --min-confidence=0.8

If products.gender is already filled and you only need OpenSearch updated:
  npx tsx scripts/backfill-product-gender.ts --apply --os-only

Options:
  --apply                  Write products.gender. Without this, only reports.
  --batch=<n>              Rows to scan per DB batch. Default: 1000.
  --limit=<n>              Scan at most n missing-gender rows.
  --vendor-id=<id>         Restrict to one vendor.
  --min-confidence=<n>     Minimum inference confidence. Default: ${DEFAULT_CATALOG_GENDER_MIN_CONFIDENCE}.
  --sync-os                Partial-update OpenSearch attr_gender/audience_gender/gender.
  --os-only                Copy existing products.gender to OpenSearch only.
  --no-refresh-os          Skip OpenSearch refresh at the end.
  --sample=<n>             Number of matched sample rows to print. Default: 20.
`);
}

async function productsHasGenderColumn(): Promise<boolean> {
  const res = await pg.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'products'
       AND column_name = 'gender'
     LIMIT 1`,
  );
  return (res.rowCount ?? 0) > 0;
}

function vendorClause(args: Args, params: unknown[]): string {
  if (args.vendorId == null) return "";
  params.push(args.vendorId);
  return `AND vendor_id = $${params.length}`;
}

async function countTargets(args: Args): Promise<number> {
  const params: unknown[] = [];
  const vendor = vendorClause(args, params);
  const genderPredicate = args.osOnly
    ? "NULLIF(BTRIM(COALESCE(gender, '')), '') IS NOT NULL"
    : "NULLIF(BTRIM(COALESCE(gender, '')), '') IS NULL";
  const res = await pg.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM products
     WHERE ${genderPredicate}
       ${vendor}`,
    params,
  );
  const count = parseInt(res.rows[0]?.count ?? "0", 10);
  return args.limit == null ? count : Math.min(count, args.limit);
}

async function fetchBatch(args: Args, cursorId: number, batchSize: number): Promise<ProductRow[]> {
  const params: unknown[] = [cursorId, batchSize];
  const vendor = args.vendorId == null ? "" : `AND vendor_id = $${params.push(args.vendorId)}`;
  const genderPredicate = args.osOnly
    ? "NULLIF(BTRIM(COALESCE(gender, '')), '') IS NOT NULL"
    : "NULLIF(BTRIM(COALESCE(gender, '')), '') IS NULL";
  const res = await pg.query<ProductRow>(
    `SELECT id, title, description, gender, product_url, parent_product_url
     FROM products
     WHERE id > $1::bigint
       AND ${genderPredicate}
       ${vendor}
     ORDER BY id ASC
     LIMIT $2::int`,
    params,
  );
  return res.rows;
}

function acceptedGender(
  row: ProductRow,
  minConfidence: number,
): { gender: CatalogGender; inferred: InferredGenderResult } | null {
  const inferred = inferProductGender({
    title: row.title,
    description: row.description,
    product_url: row.product_url,
    parent_product_url: row.parent_product_url,
  });
  if (inferred.gender === "unknown") return null;
  if (inferred.confidence < minConfidence) return null;
  return { gender: inferred.gender, inferred };
}

function normalizeCatalogGender(raw: unknown): CatalogGender | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return null;
  if (["men", "mens", "male", "man", "m"].includes(s)) return "men";
  if (["women", "womens", "female", "woman", "w", "f"].includes(s)) return "women";
  if (["unisex", "both", "all", "all-gender", "all gender", "gender-neutral", "gender neutral"].includes(s)) {
    return "unisex";
  }
  return null;
}

async function updateBatch(updates: GenderUpdate[]): Promise<number> {
  if (updates.length === 0) return 0;

  const params: unknown[] = [];
  const tuples = updates.map((u) => {
    params.push(u.id, u.gender);
    const idParam = params.length - 1;
    const genderParam = params.length;
    return `($${idParam}::bigint, $${genderParam}::text)`;
  });

  const res = await pg.query(
    `UPDATE products AS p
     SET gender = v.gender
     FROM (VALUES ${tuples.join(", ")}) AS v(id, gender)
     WHERE p.id = v.id
       AND NULLIF(BTRIM(COALESCE(p.gender, '')), '') IS NULL`,
    params,
  );
  return res.rowCount ?? 0;
}

async function bulkUpdateOpenSearchGender(
  updates: OpenSearchGenderUpdate[],
): Promise<{ updated: number; notFound: number; errors: number }> {
  if (updates.length === 0) return { updated: 0, notFound: 0, errors: 0 };

  const body: any[] = [];
  for (const row of updates) {
    body.push({ update: { _index: INDEX, _id: String(row.id) } });
    body.push({
      doc: {
        attr_gender: row.gender,
        audience_gender: row.gender,
        gender: row.gender,
      },
    });
  }

  const resp = await osClient.bulk({ body, timeout: "30s" });
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

function addStat(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function clip(value: unknown, max = 90): string {
  const s = String(value ?? "").replace(/\s+/g, " ").trim();
  return s.length <= max ? s : `${s.slice(0, max - 3)}...`;
}

function sampleSource(inferred: InferredGenderResult): string {
  return (
    inferred.signals.find((s) => s.startsWith("parent_url=")) ??
    inferred.signals.find((s) => s.startsWith("url=")) ??
    inferred.signals[0] ??
    inferred.source
  );
}

async function main(): Promise<void> {
  const args = parseArgs();
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (!(await productsHasGenderColumn())) {
    throw new Error("products.gender column does not exist. Run migration 013_products_gender.sql first.");
  }

  const totalTargets = await countTargets(args);
  console.log(
    `[backfill-product-gender] mode=${args.apply ? "apply" : "dry-run"} ` +
      (args.osOnly ? "osOnly=true " : "") +
      (args.syncOpenSearch ? "syncOs=true " : "") +
      `targets=${totalTargets} batch=${args.batch} minConfidence=${args.minConfidence}` +
      (args.vendorId != null ? ` vendorId=${args.vendorId}` : ""),
  );

  let cursorId = 0;
  let scanned = 0;
  let matched = 0;
  let updated = 0;
  let osUpdated = 0;
  let osNotFound = 0;
  let osErrors = 0;
  const genderStats = new Map<string, number>();
  const sourceStats = new Map<string, number>();
  const samples: GenderUpdate[] = [];

  while (args.limit == null || scanned < args.limit) {
    const remaining = args.limit == null ? args.batch : Math.min(args.batch, args.limit - scanned);
    if (remaining <= 0) break;

    const rows = await fetchBatch(args, cursorId, remaining);
    if (rows.length === 0) break;
    cursorId = Number(rows[rows.length - 1].id);
    scanned += rows.length;

    const batchUpdates: GenderUpdate[] = [];
    const batchOsUpdates: OpenSearchGenderUpdate[] = [];

    if (args.osOnly) {
      for (const row of rows) {
        const gender = normalizeCatalogGender(row.gender);
        if (!gender) continue;
        batchOsUpdates.push({ id: Number(row.id), gender });
        matched++;
        addStat(genderStats, gender);
        addStat(sourceStats, "db_gender");
      }
    } else {
      for (const row of rows) {
        const accepted = acceptedGender(row, args.minConfidence);
        if (!accepted) continue;

        const update: GenderUpdate = {
          id: Number(row.id),
          gender: accepted.gender,
          inferred: accepted.inferred,
          row,
        };
        batchUpdates.push(update);
        batchOsUpdates.push({ id: Number(row.id), gender: accepted.gender });
        matched++;
        addStat(genderStats, accepted.gender);
        addStat(sourceStats, accepted.inferred.source);
        if (samples.length < args.sample) samples.push(update);
      }
    }

    if (args.apply && !args.osOnly) {
      updated += await updateBatch(batchUpdates);
    }
    if (args.apply && args.syncOpenSearch) {
      const osResult = await bulkUpdateOpenSearchGender(batchOsUpdates);
      osUpdated += osResult.updated;
      osNotFound += osResult.notFound;
      osErrors += osResult.errors;
    }

    console.log(
      `[backfill-product-gender] scanned=${scanned}/${totalTargets} matched=${matched}` +
        (args.apply && !args.osOnly ? ` updated=${updated}` : "") +
        (args.apply && args.syncOpenSearch
          ? ` osUpdated=${osUpdated} osNotFound=${osNotFound} osErrors=${osErrors}`
          : ""),
    );
  }

  if (args.apply && args.syncOpenSearch && !args.noRefreshOs && osUpdated > 0) {
    console.log(`\nRefreshing OpenSearch index ${INDEX}...`);
    await osClient.indices.refresh({ index: INDEX });
  }

  console.log("\nSummary");
  console.log(`  scanned: ${scanned}`);
  console.log(`  matched: ${matched}`);
  if (args.apply && !args.osOnly) console.log(`  updated: ${updated}`);
  if (args.apply && args.syncOpenSearch) {
    console.log(`  opensearch updated/noop: ${osUpdated}`);
    console.log(`  opensearch not found: ${osNotFound}`);
    console.log(`  opensearch errors: ${osErrors}`);
  }
  console.log(
    `  gender counts: ${JSON.stringify(Object.fromEntries([...genderStats.entries()].sort()))}`,
  );
  console.log(
    `  source counts: ${JSON.stringify(Object.fromEntries([...sourceStats.entries()].sort()))}`,
  );

  if (samples.length > 0) {
    console.log("\nSamples");
    for (const item of samples) {
      console.log(
        `  ${item.id}\t${item.gender}\tconf=${item.inferred.confidence.toFixed(2)}` +
          `\t${sampleSource(item.inferred)}\t${clip(item.row.title)}` +
          `\t${clip(item.row.parent_product_url ?? item.row.product_url, 100)}`,
      );
    }
  }

  if (!args.apply && matched > 0) {
    console.log(
      "\nDry-run only. Re-run with --apply to write changes" +
        (args.syncOpenSearch ? " and update OpenSearch." : "."),
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pg.end().catch(() => undefined);
  });
