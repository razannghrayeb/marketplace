/**
 * Delta patch: Add missing color variants to existing deduplicated index
 *
 * The original dedup script grouped by (parent_product_url, color), so it should have
 * one doc per color per product. If the index was created with old grouping logic
 * (only parent_product_url), this script finds the missing color variants and adds them.
 *
 * Run: npx ts-node -r dotenv/config scripts/dedup-opensearch-add-missing-colors.ts --execute
 */
import "dotenv/config";
import { osClient } from "../src/lib/core";
import { config } from "../src/config";

const SOURCE_INDEX = config.opensearch.index;
const TARGET_INDEX = "products_dedup_v1";
const SCROLL_TTL = "3m";
const FETCH_SIZE = 500;
const BULK_BATCH = 100;

function groupKey(src: any): string | null {
  const p = src?.parent_product_url ?? null;
  const c = src?.color_primary_canonical ?? src?.attr_color ?? null;

  if (!p || String(p).trim().length === 0) return null;

  const parentTrim = String(p).trim();
  const colorTrim = c ? String(c).trim() : "no_color";
  return `${parentTrim}::${colorTrim}`;
}

function isInStock(av: any): boolean {
  if (av === true) return true;
  if (!av) return false;
  const s = String(av).toLowerCase();
  return s.includes("in") || s.includes("available") || s.includes("instock") || s === "1";
}

function parseDate(v: any): number {
  if (!v) return 0;
  const t = Date.parse(String(v));
  if (Number.isFinite(t)) return t;
  return 0;
}

async function fetchCanonicalsByColorFromSource() {
  const map = new Map<string, Array<any>>();

  let resp = await osClient.search({
    index: SOURCE_INDEX,
    scroll: SCROLL_TTL,
    size: FETCH_SIZE,
    _source: ["parent_product_url", "color_primary_canonical", "attr_color", "availability", "last_seen_at"],
    body: { query: { match_all: {} } },
  });

  let total = resp.body.hits.total?.value ?? resp.body.hits.total ?? 0;
  console.log(`Fetching ${total} docs from ${SOURCE_INDEX}...`);

  while (resp.body.hits.hits.length > 0) {
    for (const h of resp.body.hits.hits) {
      const key = groupKey(h._source);
      if (!key) continue;
      const arr = map.get(key) ?? [];
      arr.push({ id: h._id, source: h._source });
      map.set(key, arr);
    }

    const scrollId = resp.body._scroll_id;
    try {
      resp = await osClient.scroll({ scroll_id: scrollId, scroll: SCROLL_TTL });
    } catch {
      break;
    }
  }

  return map;
}

function pickCanonical(docs: Array<any>): string {
  if (docs.length === 1) return docs[0].id;
  const inStock = docs.filter((d) => isInStock(d.source?.availability));
  const candidate = (inStock.length ? inStock : docs).sort((a, b) => parseDate(b.source?.last_seen_at) - parseDate(a.source?.last_seen_at))[0];
  return candidate.id;
}

async function fetchExistingCanonicalIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  let resp = await osClient.search({
    index: TARGET_INDEX,
    scroll: SCROLL_TTL,
    size: FETCH_SIZE,
    _source: [],
    body: { query: { match_all: {} } },
  });

  while (resp.body.hits.hits.length > 0) {
    for (const h of resp.body.hits.hits) {
      ids.add(h._id);
    }
    try {
      resp = await osClient.scroll({ scroll_id: resp.body._scroll_id, scroll: SCROLL_TTL });
    } catch {
      break;
    }
  }

  return ids;
}

async function run(dryRun = true) {
  console.log(`Starting delta patch: dryRun=${dryRun}`);

  const byColor = await fetchCanonicalsByColorFromSource();
  console.log(`Found ${byColor.size} unique (parent_product_url + color) groups.`);

  const canonicalIds: string[] = [];
  for (const [k, arr] of byColor) {
    const canonical = pickCanonical(arr);
    canonicalIds.push(canonical);
  }
  console.log(`Canonical docs to ensure in target: ${canonicalIds.length}`);

  const existing = await fetchExistingCanonicalIds();
  console.log(`Already in ${TARGET_INDEX}: ${existing.size} docs`);

  const missing = canonicalIds.filter((id) => !existing.has(id));
  console.log(`Missing (to add): ${missing.length}`);

  if (missing.length === 0) {
    console.log("No missing docs. Done.");
    return;
  }

  if (dryRun) {
    console.log(`Dry-run: would add ${missing.length} missing color variants to ${TARGET_INDEX}`);
    return;
  }

  // Bulk-index missing docs
  console.log(`Adding ${missing.length} missing docs to ${TARGET_INDEX}...`);
  for (let i = 0; i < missing.length; i += BULK_BATCH) {
    const batch = missing.slice(i, i + BULK_BATCH);
    const mgetResp = await osClient.mget({ index: SOURCE_INDEX, body: { ids: batch } });
    const body: any[] = [];
    for (const doc of mgetResp.body.docs) {
      if (!doc.found) continue;
      body.push({ index: { _index: TARGET_INDEX, _id: doc._id } });
      body.push(doc._source);
    }
    if (body.length === 0) continue;
    const resp = await osClient.bulk({ body, timeout: "60s" });
    if (resp.body?.errors) {
      console.error(`Errors at batch ${i}`);
      throw new Error("Bulk errors");
    }
    console.log(`Indexed batch ${i}-${i + batch.length}`);
    await new Promise((r) => setTimeout(r, 100));
  }

  console.log(`Done. Added ${missing.length} missing color variants to ${TARGET_INDEX}.`);
}

async function main() {
  const execute = process.argv.includes("--execute");
  try {
    await run(!execute);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();
