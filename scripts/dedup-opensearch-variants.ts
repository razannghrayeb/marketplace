import "dotenv/config";
import { osClient } from "../src/lib/core";
import { config } from "../src/config";

const INDEX = config.opensearch.index;
const SCROLL_TTL = "3m";
const FETCH_SIZE = 500;
const BULK_BATCH = 100;
const FAST_INGEST = process.env.FAST_INGEST !== "0";

function groupKey(src: any): string | null {
  // Group by parent_product_url + primary color to keep one variant per color.
  // This preserves size variants of DIFFERENT colors but removes duplicate sizes of the same color.
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

async function fetchAllDocs() {
  const map = new Map<string, Array<any>>();
  const keepUnkeyed: Array<any> = [];

  let resp = await osClient.search({
    index: INDEX,
    scroll: SCROLL_TTL,
    size: FETCH_SIZE,
    _source: ["parent_product_url", "image_url", "availability", "last_seen_at", "color_primary_canonical", "attr_color"],
    body: { query: { match_all: {} } },
  });

  let total = resp.body.hits.total?.value ?? resp.body.hits.total ?? 0;
  console.log(`Found ~${total} documents in index ${INDEX}.`);

  while (resp.body.hits.hits.length > 0) {
    for (const h of resp.body.hits.hits) {
      const key = groupKey(h._source);
      if (!key) {
        keepUnkeyed.push({ id: h._id, source: h._source });
        continue;
      }
      const arr = map.get(key) ?? [];
      arr.push({ id: h._id, source: h._source });
      map.set(key, arr);
    }

    const scrollId = resp.body._scroll_id;
    let scrollRetries = 0;
    while (true) {
      try {
        resp = await osClient.scroll({ scroll_id: scrollId, scroll: SCROLL_TTL });
        break;
      } catch (err: any) {
        scrollRetries++;
        if (scrollRetries >= 5) { console.warn("Scroll failed after retries, stopping fetch early."); break; }
        const delay = Math.pow(2, scrollRetries) * 1000;
        console.warn(`Scroll retry ${scrollRetries}/5 after ${delay}ms (${err.code || err.message})`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    if (scrollRetries >= 5) break;
  }

  return { groups: map, unkeyed: keepUnkeyed };
}

function pickCanonical(docs: Array<any>): string {
  if (docs.length === 1) return docs[0].id;
  const inStock = docs.filter((d) => isInStock(d.source?.availability));
  const candidate = (inStock.length ? inStock : docs).sort((a, b) => parseDate(b.source?.last_seen_at) - parseDate(a.source?.last_seen_at))[0];
  return candidate.id;
}

async function getIndexSettingsAndMappings(indexName: string) {
  const resp = await osClient.indices.get({ index: indexName });
  const meta = resp.body[indexName];
  const settings = meta.settings ?? {};
  const mappings = meta.mappings ?? {};
  const idxSettings = { ...(settings.index ?? {}) };
  delete (idxSettings as any).creation_date;
  delete (idxSettings as any).uuid;
  delete (idxSettings as any).provided_name;
  delete (idxSettings as any).version;
  return { settings: { index: idxSettings }, mappings };
}

async function createIndex(newIndex: string, dryRun: boolean) {
  const exists = await osClient.indices.exists({ index: newIndex });
  if (exists.body) {
    console.log(`Index ${newIndex} already exists.`);
    return;
  }
  if (dryRun) {
    console.log(`Dry-run: would create index ${newIndex} with copied settings/mappings.`);
    return;
  }

  const { settings, mappings } = await getIndexSettingsAndMappings(INDEX);
  await osClient.indices.create({ index: newIndex, body: { settings, mappings } });
  console.log(`Created index ${newIndex}`);
}

async function setFastIngestSettings(indexName: string, dryRun: boolean) {
  if (!FAST_INGEST) return;
  if (dryRun) {
    console.log(`Dry-run: would set ${indexName} refresh_interval=-1 and number_of_replicas=0 for faster ingest.`);
    return;
  }
  await osClient.indices.putSettings({
    index: indexName,
    body: {
      index: {
        refresh_interval: "-1",
        number_of_replicas: 0,
      },
    },
  });
  console.log(`Applied fast-ingest settings to ${indexName}`);
}

async function restoreIngestSettings(indexName: string, dryRun: boolean) {
  if (!FAST_INGEST) return;
  if (dryRun) {
    console.log(`Dry-run: would restore ${indexName} refresh_interval=1s and number_of_replicas=1 after ingest.`);
    return;
  }
  await osClient.indices.putSettings({
    index: indexName,
    body: {
      index: {
        refresh_interval: "1s",
        number_of_replicas: 1,
      },
    },
  });
  console.log(`Restored ingest settings on ${indexName}`);
}

async function reindexCanonicals(newIndex: string, canonicalIds: string[], dryRun: boolean) {
  console.log(`Reindexing ${canonicalIds.length} canonical docs into ${newIndex} (dryRun=${dryRun})`);
  if (dryRun) return;

  // Check how many docs are already in the target index to support resume
  let alreadyIndexed = 0;
  try {
    const countResp = await osClient.count({ index: newIndex });
    alreadyIndexed = countResp.body?.count ?? 0;
    if (alreadyIndexed > 0) {
      console.log(`Target index ${newIndex} already has ${alreadyIndexed} docs. Resuming from offset ${alreadyIndexed}.`);
    }
  } catch {
    alreadyIndexed = 0;
  }

  for (let i = 0; i < canonicalIds.length; i += BULK_BATCH) {
    if (i < alreadyIndexed) continue; // Skip already-indexed batches

    const batch = canonicalIds.slice(i, i + BULK_BATCH);
    let mgetResp: any;
    let retries = 0;
    const maxRetries = 5;

    while (retries < maxRetries) {
      try {
        mgetResp = await osClient.mget({ index: INDEX, body: { ids: batch } });
        break;
      } catch (err: any) {
        retries++;
        if (retries >= maxRetries) throw err;
        const delay = Math.pow(2, retries) * 1000;
        console.warn(`mget retry ${retries}/${maxRetries} after ${delay}ms (error: ${err.code || err.message})`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    const body: any[] = [];
    for (const doc of mgetResp.body.docs) {
      if (!doc.found) continue;
      body.push({ index: { _index: newIndex, _id: doc._id } });
      body.push(doc._source);
    }
    if (body.length === 0) continue;

    let resp: any;
    retries = 0;
    while (retries < maxRetries) {
      try {
        resp = await osClient.bulk({ body, timeout: "60s" });
        break;
      } catch (err: any) {
        retries++;
        if (retries >= maxRetries) throw err;
        const delay = Math.pow(2, retries) * 1000;
        console.warn(`bulk retry ${retries}/${maxRetries} after ${delay}ms (error: ${err.code || err.message})`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    if (resp.body?.errors) {
      console.error(`Errors reindexing batch starting ${i}`);
      for (const it of resp.body.items) {
        const op = it.index || it.create;
        if (op && op.status >= 400) console.error(JSON.stringify(op));
      }
      throw new Error("Reindex bulk errors");
    }
    console.log(`Indexed batch ${i}-${i + batch.length}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function run(dryRun = true, newIndexName?: string) {
  console.log(`Starting dedup/reindex: dryRun=${dryRun}`);
  const { groups, unkeyed } = await fetchAllDocs();
  console.log(`Grouped into ${groups.size} unique parent/image keys. Unkeyed docs: ${unkeyed.length}`);

  const canonicalIds: string[] = [];
  let totalDocs = 0;
  let keepCount = 0;

  for (const [k, arr] of groups) {
    totalDocs += arr.length;
    const canonical = pickCanonical(arr);
    canonicalIds.push(canonical);
    keepCount += 1;
  }

  for (const d of unkeyed) {
    canonicalIds.push(d.id);
    totalDocs += 1;
    keepCount += 1;
  }

  console.log(`Total docs scanned: ${totalDocs}`);
  console.log(`Canonical documents to keep: ${keepCount}`);
  console.log(`Estimated duplicates removed: ${totalDocs - keepCount}`);

  const targetIndex = newIndexName || `${INDEX}_dedup_v1`;
  await createIndex(targetIndex, dryRun);
  await setFastIngestSettings(targetIndex, dryRun);
  await reindexCanonicals(targetIndex, canonicalIds, dryRun);
  await restoreIngestSettings(targetIndex, dryRun);

  console.log(`Done. To switch aliases, POST to /_aliases with actions to point your read alias to ${targetIndex}.`);
}

async function main() {
  const execute = process.argv.includes("--execute");
  const targetArgIdx = process.argv.findIndex((s) => s === "--target");
  const target = targetArgIdx >= 0 ? process.argv[targetArgIdx + 1] : undefined;
  try {
    await run(!execute, target);
    console.log("Finished.");
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();
