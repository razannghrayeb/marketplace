/**
 * Style Attributes Backfill Worker
 *
 * One-shot (or rerunnable) job that classifies every product whose primary
 * image has been embedded into OpenSearch via Fashion-CLIP zero-shot prompts
 * and stores:
 *   - aesthetic / occasion soft distributions (jsonb on products, object in OS)
 *   - argmax aesthetic / occasion labels
 *   - expected formality (1-10)
 *   - confidence margin
 *
 * Source of embeddings: **OpenSearch** (this repo's pipeline doesn't persist
 * embeddings into `product_images.embedding` — they live only in the OS index).
 *
 * Sinks:
 *   - `products` table (UPDATE with attr_*_probs columns + attr_style_clip_at)
 *   - OpenSearch index (partial doc update so retrieval reads them at runtime)
 *
 * Design notes:
 * - **Idempotent**: filters OS for docs that DON'T have `attr_aesthetic_top`
 *   yet. Re-running picks up only un-classified docs. Use --force to redo all.
 * - **No image inference**: classification is pure cosine math against cached
 *   Fashion-CLIP prompt embeddings. ~1ms per product — 100K → ~3-5 minutes
 *   dominated by Postgres UPDATE throughput.
 * - **Per-row failure is non-fatal**: malformed embedding rows are logged and
 *   skipped; the rest of the batch proceeds.
 * - **Bounded memory**: OpenSearch scroll API, fixed batch size, no full
 *   table SELECT.
 *
 * Run: `node dist/workers/styleAttributesBackfill.worker.js`
 *   Flags:
 *     --batch-size=200            (default 200, max 1000)
 *     --max-batches=N             (default no limit; useful for canary runs)
 *     --force                     re-classify all products, not just pending
 *     --dry-run                   classify but don't write — for spot-checking
 */

import { pg } from "../lib/core";
import { osClient, ensureStyleAttributeFields } from "../lib/core/opensearch";
import { config } from "../config";
import {
  classifyStyleAttributesFromEmbedding,
  type StyleAttributeDistribution,
} from "../lib/outfit/styleAttributesClip";

interface CliFlags {
  batchSize: number;
  maxBatches: number | null;
  force: boolean;
  dryRun: boolean;
}

function parseFlags(): CliFlags {
  const args = process.argv.slice(2);
  const get = (name: string): string | undefined => {
    const found = args.find((a) => a.startsWith(`--${name}=`));
    return found ? found.split("=", 2)[1] : undefined;
  };
  const has = (name: string): boolean => args.includes(`--${name}`);
  const batchSize = parseInt(get("batch-size") || "200", 10);
  const maxBatchesRaw = get("max-batches");
  return {
    batchSize: Number.isFinite(batchSize) && batchSize > 0 ? Math.min(batchSize, 1000) : 200,
    maxBatches:
      maxBatchesRaw && Number.isFinite(parseInt(maxBatchesRaw, 10))
        ? parseInt(maxBatchesRaw, 10)
        : null,
    force: has("force"),
    dryRun: has("dry-run"),
  };
}

interface OsHit {
  product_id: number;
  embedding: number[];
}

function coerceEmbedding(value: unknown): number[] | null {
  if (Array.isArray(value) && value.every((n) => typeof n === "number")) return value as number[];
  return null;
}

interface ClassifiedRow {
  productId: number;
  distribution: StyleAttributeDistribution;
}

/**
 * Open a scrolled cursor on the products index for docs that have an embedding
 * but no `attr_aesthetic_top` yet (or all of them when --force is set).
 */
async function openScroll(flags: CliFlags): Promise<{ scrollId: string; hits: any[] }> {
  const must: any[] = [{ exists: { field: "embedding" } }];
  const must_not: any[] = flags.force ? [] : [{ exists: { field: "attr_aesthetic_top" } }];

  const res = await osClient.search({
    index: config.opensearch.index,
    scroll: "5m",
    body: {
      size: flags.batchSize,
      // Sort by _doc — fastest scroll order. We're processing the entire matching
      // set, so meaningful ordering would only add cost.
      sort: ["_doc"],
      query: {
        bool: { must, must_not },
      },
      // Embeddings are large — explicitly request them so we don't fight any
      // index-level "exclude vectors from _source" defaults.
      _source: ["product_id", "embedding"],
    },
  });
  return {
    scrollId: String(res.body?._scroll_id ?? ""),
    hits: res.body?.hits?.hits ?? [],
  };
}

async function continueScroll(scrollId: string): Promise<{ scrollId: string; hits: any[] }> {
  const res = await osClient.scroll({
    body: { scroll: "5m", scroll_id: scrollId },
  });
  return {
    scrollId: String(res.body?._scroll_id ?? scrollId),
    hits: res.body?.hits?.hits ?? [],
  };
}

async function clearScroll(scrollId: string): Promise<void> {
  if (!scrollId) return;
  try {
    await osClient.clearScroll({ body: { scroll_id: scrollId } });
  } catch (err) {
    // Non-fatal — scrolls auto-expire after 5m anyway.
    console.warn("[styleAttributesBackfill] clearScroll failed (non-fatal):", err);
  }
}

function hitsToRows(hits: any[]): OsHit[] {
  const out: OsHit[] = [];
  for (const h of hits) {
    const src = h?._source || {};
    const idRaw = src.product_id ?? h._id;
    const id = parseInt(String(idRaw), 10);
    const emb = coerceEmbedding(src.embedding);
    if (Number.isFinite(id) && id >= 1 && emb) {
      out.push({ product_id: id, embedding: emb });
    }
  }
  return out;
}

/**
 * Persist a batch of classifications to Postgres in one round-trip using
 * `UPDATE ... FROM UNNEST(...)`. Sends each column as a parallel array so the
 * planner can inline the join cheaply.
 */
async function writeBatchToPostgres(rows: ClassifiedRow[]): Promise<void> {
  if (rows.length === 0) return;
  const ids: number[] = [];
  const aestheticProbs: string[] = [];
  const occasionProbs: string[] = [];
  const formality: number[] = [];
  const aestheticTops: string[] = [];
  const occasionTops: string[] = [];
  const margins: number[] = [];
  for (const r of rows) {
    ids.push(r.productId);
    aestheticProbs.push(JSON.stringify(r.distribution.aesthetic));
    occasionProbs.push(JSON.stringify(r.distribution.occasion));
    formality.push(r.distribution.formality);
    aestheticTops.push(r.distribution.topAesthetic);
    occasionTops.push(r.distribution.topOccasion);
    margins.push(r.distribution.aestheticMargin);
  }
  await pg.query(
    `UPDATE products AS p
        SET attr_aesthetic_probs   = data.aesthetic_probs::jsonb,
            attr_occasion_probs    = data.occasion_probs::jsonb,
            attr_clip_formality    = data.formality,
            attr_aesthetic_top     = data.aesthetic_top,
            attr_occasion_top      = data.occasion_top,
            attr_aesthetic_margin  = data.margin,
            attr_style_clip_at     = NOW()
       FROM UNNEST($1::bigint[], $2::text[], $3::text[], $4::real[], $5::text[], $6::text[], $7::real[])
              AS data(id, aesthetic_probs, occasion_probs, formality, aesthetic_top, occasion_top, margin)
      WHERE p.id = data.id`,
    [ids, aestheticProbs, occasionProbs, formality, aestheticTops, occasionTops, margins],
  );
}

/**
 * Mirror the same distributions to the OpenSearch document. We use partial
 * doc updates (`update` action) so we never overwrite fields the indexer is
 * responsible for. If the doc disappeared mid-run we tolerate the 404 — the
 * data is already in Postgres and a subsequent reindex will sync it back.
 */
async function writeBatchToOpenSearch(rows: ClassifiedRow[]): Promise<void> {
  if (rows.length === 0) return;
  const body: any[] = [];
  for (const r of rows) {
    body.push({ update: { _index: config.opensearch.index, _id: String(r.productId) } });
    body.push({
      doc: {
        attr_aesthetic_probs: r.distribution.aesthetic,
        attr_occasion_probs: r.distribution.occasion,
        attr_clip_formality: r.distribution.formality,
        attr_aesthetic_top: r.distribution.topAesthetic,
        attr_occasion_top: r.distribution.topOccasion,
        attr_aesthetic_margin: r.distribution.aestheticMargin,
      },
    });
  }
  const res = await osClient.bulk({ body, refresh: false });
  if (res.body?.errors) {
    const items: any[] = res.body.items || [];
    let benign = 0;
    let real = 0;
    for (const item of items) {
      const result = item.update;
      if (!result?.error) continue;
      if (result.status === 404) {
        benign++;
      } else {
        real++;
        if (real <= 5) {
          console.warn("[styleAttributesBackfill] OS error:", result.error);
        }
      }
    }
    if (benign > 0) {
      console.log(`[styleAttributesBackfill] ${benign} docs missing in OS (non-fatal)`);
    }
    if (real > 0) {
      console.warn(`[styleAttributesBackfill] ${real} OpenSearch errors in batch`);
    }
  }
}

async function main(): Promise<void> {
  const flags = parseFlags();
  console.log("[styleAttributesBackfill] starting", flags);

  // Make sure the OS index has the target fields. Cheap and idempotent.
  try {
    await ensureStyleAttributeFields();
  } catch (err) {
    console.warn(
      "[styleAttributesBackfill] could not ensure OS fields up-front; continuing — Postgres will still be written",
      err,
    );
  }

  let batchNum = 0;
  let totalSeen = 0;
  let totalClassified = 0;
  let totalSkippedNoVector = 0;
  let totalSkippedClassifierNull = 0;
  const startedAt = Date.now();

  let scroll = await openScroll(flags);
  try {
    while (true) {
      if (scroll.hits.length === 0) {
        console.log("[styleAttributesBackfill] scroll exhausted — done");
        break;
      }
      if (flags.maxBatches !== null && batchNum >= flags.maxBatches) {
        console.log(`[styleAttributesBackfill] reached max-batches=${flags.maxBatches}`);
        break;
      }
      batchNum++;
      const rows = hitsToRows(scroll.hits);
      totalSeen += scroll.hits.length;
      totalSkippedNoVector += scroll.hits.length - rows.length;

      const classified: ClassifiedRow[] = [];
      for (const row of rows) {
        // Classification is pure JS math against cached prompt embeddings.
        // The first call lazily initialises prompt embeddings and caches them
        // for the rest of the run.
        const dist = await classifyStyleAttributesFromEmbedding(row.embedding).catch((err) => {
          console.warn(
            `[styleAttributesBackfill] classify failed for product ${row.product_id}:`,
            err,
          );
          return null;
        });
        if (!dist) {
          totalSkippedClassifierNull++;
          continue;
        }
        classified.push({ productId: row.product_id, distribution: dist });
      }

      if (!flags.dryRun) {
        try {
          await writeBatchToPostgres(classified);
        } catch (err) {
          console.error(`[styleAttributesBackfill] PG write failed (batch ${batchNum}):`, err);
          // Hard stop: don't advance the scroll if we couldn't persist. The
          // user can re-run and we'll resume from where we are (the OS filter
          // skips classified products).
          break;
        }
        try {
          await writeBatchToOpenSearch(classified);
        } catch (err) {
          console.warn(
            `[styleAttributesBackfill] OS write failed (batch ${batchNum}, non-fatal):`,
            err,
          );
        }
      }
      totalClassified += classified.length;

      const elapsedS = (Date.now() - startedAt) / 1000;
      const rate = totalClassified > 0 ? Math.round(totalClassified / Math.max(0.001, elapsedS)) : 0;
      console.log(
        `[styleAttributesBackfill] batch ${batchNum} done | classified_total=${totalClassified} | no_vec=${totalSkippedNoVector} | classifier_null=${totalSkippedClassifierNull} | seen=${totalSeen} | ${elapsedS.toFixed(1)}s | ${rate}/s`,
      );

      scroll = await continueScroll(scroll.scrollId);
    }
  } finally {
    await clearScroll(scroll.scrollId);
  }

  const elapsedS = (Date.now() - startedAt) / 1000;
  console.log(
    `[styleAttributesBackfill] FINISHED in ${elapsedS.toFixed(1)}s | seen=${totalSeen} | classified=${totalClassified} | skipped(no_vec)=${totalSkippedNoVector} | skipped(classifier_null)=${totalSkippedClassifierNull}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[styleAttributesBackfill] fatal error:", err);
    process.exit(1);
  });
