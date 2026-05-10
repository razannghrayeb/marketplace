/**
 * Repair OpenSearch attr_sleeve from explicit catalog text.
 *
 * Conservative by design:
 * - Only infers from explicit sleeve phrases such as "long sleeve", "short-sleeved",
 *   "sleeveless", "strapless", "tank top".
 * - Does NOT infer "long" by itself. This avoids mistakes like
 *   "long dress" -> long sleeve.
 * - Does NOT infer from generic shirt cuffs/buttons because those are suggestive,
 *   not definitive.
 * - Dry-run by default. Pass --apply to write partial OpenSearch updates.
 *
 * Usage:
 *   npx tsx scripts/repair-opensearch-sleeves.ts
 *   npx tsx scripts/repair-opensearch-sleeves.ts --apply
 *   npx tsx scripts/repair-opensearch-sleeves.ts --limit 100
 *   npx tsx scripts/repair-opensearch-sleeves.ts --category "Woven Tops"
 *   npx tsx scripts/repair-opensearch-sleeves.ts --start-id 100000
 *   npx tsx scripts/repair-opensearch-sleeves.ts --overwrite
 *   npx tsx scripts/repair-opensearch-sleeves.ts --all-categories
 */

import "dotenv/config";
import { performance } from "perf_hooks";
import { pg } from "../src/lib/core/db";
import { osClient } from "../src/lib/core/opensearch";
import { config } from "../src/config";

type Sleeve = "long-sleeve" | "short-sleeve" | "sleeveless";

type ProductRow = {
  id: number;
  title: string | null;
  description: string | null;
  category: string | null;
  product_url: string | null;
  parent_product_url: string | null;
};

type Stats = {
  scanned: number;
  inferred: number;
  updated: number;
  skippedNoSignal: number;
  skippedConflict: number;
  skippedExisting: number;
  notFound: number;
  errors: number;
};

const BULK_BUFFER_SIZE = 1000;

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&nbsp;/g, " ")
    .replace(/[_+./-]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUrlText(value: unknown): string {
  const raw = String(value ?? "").toLowerCase().trim();
  if (!raw) return "";
  const withoutQuery = raw.split(/[?#]/)[0] ?? raw;
  let decoded = withoutQuery;
  try {
    decoded = decodeURIComponent(withoutQuery);
  } catch {
    decoded = withoutQuery;
  }
  return normalizeText(decoded.replace(/^https?:\/\/[^/]+/i, " "));
}

function hasApparelSleeveContext(text: string): boolean {
  return /\b(top|tops|shirt|shirts|t\s*shirt|tshirt|tee|tees|polo|blouse|body|bodysuit|sweater|cardigan|pullover|hoodie|sweatshirt|dress|dresses|jumpsuit|romper|jacket|coat|blazer)\b/.test(text);
}

function explicitSleeveHits(text: string): Set<Sleeve> {
  const hits = new Set<Sleeve>();
  if (!text) return hits;

  if (/\b(long\s+sleeves?|long\s+sleeved|longsleeve|long\s+sleeve)\b/.test(text)) {
    hits.add("long-sleeve");
  }
  if (/\b(short\s+sleeves?|short\s+sleeved|shortsleeve|short\s+sleeve)\b/.test(text)) {
    hits.add("short-sleeve");
  }
  if (/\b(sleeveless|no\s+sleeves?|without\s+sleeves?|strapless|halter|spaghetti\s+straps?|tank\s+tops?|camisoles?|cami\b|tube\s+top)\b/.test(text)) {
    hits.add("sleeveless");
  }

  // Common retail abbreviation, but only with garment context to avoid random SKU/code matches.
  if (hasApparelSleeveContext(text) && /\b(s\s*s|ss)\b/.test(text)) {
    hits.add("short-sleeve");
  }

  return hits;
}

function inferSleeve(row: ProductRow): { sleeve: Sleeve | null; reason: string } {
  const title = normalizeText(row.title);
  const category = normalizeText(row.category);
  const description = normalizeText(row.description);
  const productUrl = normalizeUrlText(row.product_url);
  const parentUrl = normalizeUrlText(row.parent_product_url);

  const sources: Array<[string, string]> = [
    ["title", title],
    ["description", description],
    ["product_url", productUrl],
    ["parent_product_url", parentUrl],
    ["category", category],
  ];

  const hits = new Map<Sleeve, string[]>();
  for (const [name, text] of sources) {
    for (const sleeve of explicitSleeveHits(text)) {
      const reasons = hits.get(sleeve) ?? [];
      reasons.push(name);
      hits.set(sleeve, reasons);
    }
  }

  if (hits.size === 0) return { sleeve: null, reason: "no_explicit_signal" };
  if (hits.size > 1) {
    const details = [...hits.entries()].map(([s, r]) => `${s}:${r.join("+")}`).join(",");
    return { sleeve: null, reason: `conflict:${details}` };
  }

  const [[sleeve, reasons]] = [...hits.entries()];
  return { sleeve, reason: reasons.join("+") };
}

function parseArg(name: string): string | undefined {
  const args = process.argv.slice(2);
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  const pos = args.indexOf(`--${name}`);
  return eq ? eq.split("=")[1] : pos >= 0 ? args[pos + 1] : undefined;
}

async function fetchRows(opts: { limit?: number; startId?: number; category?: string; allCategories?: boolean }): Promise<ProductRow[]> {
  const params: Array<string | number> = [];
  const where = ["id IS NOT NULL"];

  if (typeof opts.startId === "number" && Number.isFinite(opts.startId)) {
    params.push(opts.startId);
    where.push(`id >= $${params.length}`);
  }

  if (opts.category) {
    params.push(opts.category);
    where.push(`LOWER(COALESCE(category, '')) = LOWER($${params.length})`);
  }

  if (!opts.allCategories && !opts.category) {
    where.push(`
      COALESCE(category, '') !~* '(bottom|bottoms|jeans|denim|pant|pants|trouser|trousers|short|shorts|skirt|legging|leggings|jogger|joggers|shoe|shoes|footwear|sneaker|sneakers|boot|boots|sandal|sandals|heel|heels|loafer|loafers|flat|flats|espadrille|espadrilles|slipper|slippers|bag|bags|wallet|wallets|pouch|pouches|backpack|backpacks|crossbody|shoulder bags|top handle bags|beauty|makeup|skin care|eau de parfum|eau de toilette|perfume|fragrance|lipstick|foundation|shampoo|eyebrow|swimwear|swim short|underwear|bra|brief|boxer|sock|socks|hosiery|belt|belts|hat|hats|cap|caps|beanie|helmet|goggles|gloves|scarf|scarves|necklace|necklaces|earring|earrings|bracelet|bracelets|ring|rings|pin|pins|watch|watches|bottle|ball|bike|racquet|lighters|key rings)'
    `);
  }

  let limitClause = "";
  if (typeof opts.limit === "number" && Number.isFinite(opts.limit) && opts.limit > 0) {
    params.push(opts.limit);
    limitClause = `LIMIT $${params.length}`;
  }

  const result = await pg.query(
    `
      SELECT id, title, description, category, product_url, parent_product_url
      FROM products
      WHERE ${where.join(" AND ")}
      ORDER BY id ASC
      ${limitClause}
    `,
    params,
  );

  return result.rows as ProductRow[];
}

function countBulkUpdateResults(resp: any): { updated: number; notFound: number; errors: number } {
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

async function flushBulk(bulkOps: any[], stats: Stats, apply: boolean): Promise<void> {
  if (bulkOps.length === 0) return;
  if (!apply) {
    stats.updated += bulkOps.length / 2;
    bulkOps.length = 0;
    return;
  }
  const resp = await osClient.bulk({ body: bulkOps, refresh: false } as any);
  const counted = countBulkUpdateResults(resp);
  stats.updated += counted.updated;
  stats.notFound += counted.notFound;
  stats.errors += counted.errors;
  bulkOps.length = 0;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const overwrite = args.includes("--overwrite");
  const allCategories = args.includes("--all-categories");
  const limit = parseArg("limit") ? Number(parseArg("limit")) : undefined;
  const startId = parseArg("start-id") ? Number(parseArg("start-id")) : undefined;
  const category = parseArg("category");
  const started = performance.now();
  const stats: Stats = {
    scanned: 0,
    inferred: 0,
    updated: 0,
    skippedNoSignal: 0,
    skippedConflict: 0,
    skippedExisting: 0,
    notFound: 0,
    errors: 0,
  };
  const samples: Array<Record<string, unknown>> = [];
  const conflicts: Array<Record<string, unknown>> = [];

  console.log(`[repair-sleeves] mode=${apply ? "apply" : "dry-run"} overwrite=${overwrite}`);
  console.log(`[repair-sleeves] scope=${allCategories ? "all categories" : "exclude non-sleeve categories"}`);
  if (limit) console.log(`[repair-sleeves] limit=${limit}`);
  if (startId) console.log(`[repair-sleeves] start-id=${startId}`);
  if (category) console.log(`[repair-sleeves] category=${category}`);

  const rows = await fetchRows({ limit, startId, category, allCategories });
  console.log(`[repair-sleeves] fetched=${rows.length}`);

  const bulkOps: any[] = [];
  for (const row of rows) {
    stats.scanned++;
    const inferred = inferSleeve(row);
    if (!inferred.sleeve) {
      if (inferred.reason.startsWith("conflict")) {
        stats.skippedConflict++;
        if (conflicts.length < 20) {
          conflicts.push({ id: row.id, title: row.title, reason: inferred.reason });
        }
      } else {
        stats.skippedNoSignal++;
      }
      continue;
    }

    stats.inferred++;

    let existingDoc: any;
    try {
      const docResp = await osClient.get({ index: config.opensearch.index, id: String(row.id) });
      existingDoc = docResp.body?._source ?? docResp.body;
    } catch (err: any) {
      if (err.statusCode === 404) {
        stats.notFound++;
        continue;
      }
      stats.errors++;
      console.warn(`[repair-sleeves] product=${row.id} get failed: ${err?.message ?? err}`);
      continue;
    }

    const existingSleeve = String(existingDoc?.attr_sleeve ?? "").trim();
    if (existingSleeve && !overwrite) {
      stats.skippedExisting++;
      continue;
    }

    if (samples.length < 30) {
      samples.push({
        id: row.id,
        sleeve: inferred.sleeve,
        reason: inferred.reason,
        title: row.title,
        category: row.category,
        description: row.description,
        parent_product_url: row.parent_product_url,
      });
    }

    bulkOps.push(
      { update: { _index: config.opensearch.index, _id: String(row.id), retry_on_conflict: 2 } },
      { doc: { attr_sleeve: inferred.sleeve } },
    );

    if (bulkOps.length >= BULK_BUFFER_SIZE * 2) {
      await flushBulk(bulkOps, stats, apply);
      console.log(
        `[repair-sleeves] scanned=${stats.scanned} inferred=${stats.inferred} ${apply ? "updated" : "wouldUpdate"}=${stats.updated}`,
      );
    }
  }

  await flushBulk(bulkOps, stats, apply);

  const duration = ((performance.now() - started) / 1000).toFixed(2);
  console.log(`[repair-sleeves] done in ${duration}s`);
  console.log(JSON.stringify({ stats, samples, conflicts }, null, 2));

  if (!apply) {
    console.log("[repair-sleeves] dry-run only. Re-run with --apply to write attr_sleeve updates.");
  }
}

main()
  .catch((err) => {
    console.error("[repair-sleeves] failed", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pg.end();
  });
