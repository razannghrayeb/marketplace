/**
 * Style Attributes Backfill Worker
 *
 * One-shot (or rerunnable) job that classifies every product with a usable
 * primary image embedding via Fashion-CLIP zero-shot prompts and stores:
 *   - aesthetic / occasion soft distributions (jsonb)
 *   - argmax aesthetic / occasion labels
 *   - expected formality (1-10)
 *   - confidence margin
 *
 * Persists to BOTH:
 *   - `products` table (via UPDATE in batches, idempotent on attr_style_clip_at)
 *   - OpenSearch index (via _bulk update calls, partial doc updates only)
 *
 * Design notes:
 * - **Idempotent**: filters on `attr_style_clip_at IS NULL`. To re-classify
 *   everything (e.g. after a CLIP model change), pass `--force` or clear the
 *   column manually.
 * - **No image inference**: reads the already-stored `product_images.embedding`
 *   and just computes cosine against the cached prompt embeddings. This is what
 *   makes 100K products take minutes instead of hours.
 * - **Graceful per-row failure**: a malformed embedding or missing image
 *   doesn't abort the batch — the row is logged and skipped.
 * - **Bounded memory**: cursor-style pagination by `id` ascending, fixed batch
 *   size, no full table SELECT.
 *
 * Run: `node dist/workers/styleAttributesBackfill.worker.js`
 *   Flags:
 *     --batch-size=200            (default 200)
 *     --max-batches=N             (default no limit; useful for canary runs)
 *     --force                     re-classify all products, not just pending
 *     --dry-run                   classify but don't write — for spot-checking
 */

import { pg, osClient, ensureStyleAttributeFields } from "../lib/core";
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

interface BatchRow {
  product_id: number;
  embedding: unknown;
}

function parseVector(value: unknown): number[] | null {
  if (Array.isArray(value) && value.every((n) => typeof n === "number")) return value as number[];
  if (typeof value === "string" && value.startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed) && parsed.every((n) => typeof n === "number")) return parsed;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Selects the next batch of products that:
 *   - Have at least one product_images row with a non-null embedding.
 *   - Have not been classified yet (unless --force).
 *   - Are sorted by product id so this is resumable.
 */
async function fetchNextBatch(
  flags: CliFlags,
  afterId: number,
): Promise<BatchRow[]> {
  const pendingClause = flags.force ? "" : "AND p.attr_style_clip_at IS NULL";
  const result = await pg.query<BatchRow>(
    `SELECT DISTINCT ON (p.id)
            p.id AS product_id,
            pi.embedding AS embedding
       FROM products p
       JOIN product_images pi ON pi.product_id = p.id
      WHERE p.id > $1
        AND pi.embedding IS NOT NULL
        ${pendingClause}
      ORDER BY p.id ASC, pi.is_primary DESC, pi.created_at ASC
      LIMIT $2`,
    [afterId, flags.batchSize],
  );
  return result.rows;
}

interface ClassifiedRow {
  productId: number;
  distribution: StyleAttributeDistribution;
}

/**
 * Persist a batch of classifications to Postgres in one round-trip using
 * `UPDATE ... FROM (VALUES ...)`. We send the JSONB distributions as a single
 * parameter array so the planner can inline the join cheaply.
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
 * responsible for. If the doc doesn't exist yet (unindexed product) we
 * tolerate the 404 — the next reindex will pick up the new fields from PG.
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
  // Bulk update returns per-action results. Document-missing (404) is benign
  // for products that aren't yet indexed; surface other errors so the operator
  // sees them but don't fail the whole run.
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
      console.log(`[styleAttributesBackfill] ${benign} docs not in OS yet (will pick up on next reindex)`);
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

  let afterId = 0;
  let batchNum = 0;
  let totalSeen = 0;
  let totalClassified = 0;
  let totalSkippedNoVector = 0;
  let totalSkippedClassifierNull = 0;
  const startedAt = Date.now();

  while (true) {
    if (flags.maxBatches !== null && batchNum >= flags.maxBatches) {
      console.log(`[styleAttributesBackfill] reached max-batches=${flags.maxBatches}`);
      break;
    }
    const batch = await fetchNextBatch(flags, afterId);
    if (batch.length === 0) {
      console.log("[styleAttributesBackfill] no more pending products — done");
      break;
    }
    batchNum++;
    totalSeen += batch.length;

    const classified: ClassifiedRow[] = [];
    for (const row of batch) {
      const vec = parseVector(row.embedding);
      if (!vec || vec.length === 0) {
        totalSkippedNoVector++;
        continue;
      }
      // Classification is pure JS math (cosine against cached prompt embeddings).
      // ensurePromptEmbeddings runs on the first call and caches for the rest.
      const dist = await classifyStyleAttributesFromEmbedding(vec).catch((err) => {
        console.warn(`[styleAttributesBackfill] classify failed for product ${row.product_id}:`, err);
        return null;
      });
      if (!dist) {
        totalSkippedClassifierNull++;
        continue;
      }
      classified.push({ productId: row.product_id, distribution: dist });
    }

    if (!flags.dryRun) {
      // Postgres first — the persistent record of "this row has been classified"
      // is `attr_style_clip_at`. If OpenSearch write fails, we still don't
      // re-classify on resume because PG already records the result. The OS
      // doc can be backfilled by a subsequent reindex.
      try {
        await writeBatchToPostgres(classified);
      } catch (err) {
        console.error(`[styleAttributesBackfill] PG write failed (batch ${batchNum}):`, err);
        // Don't advance afterId — let the next run retry this slice.
        break;
      }
      try {
        await writeBatchToOpenSearch(classified);
      } catch (err) {
        console.warn(`[styleAttributesBackfill] OS write failed (batch ${batchNum}, non-fatal):`, err);
      }
    }

    totalClassified += classified.length;
    afterId = batch[batch.length - 1].product_id;

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    const rate = totalClassified > 0 ? Math.round(totalClassified / Number(elapsed)) : 0;
    console.log(
      `[styleAttributesBackfill] batch ${batchNum} done | last_id=${afterId} | classified_total=${totalClassified} | no_vec=${totalSkippedNoVector} | classifier_null=${totalSkippedClassifierNull} | seen=${totalSeen} | ${elapsed}s | ${rate}/s`,
    );
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `[styleAttributesBackfill] FINISHED in ${elapsed}s | seen=${totalSeen} | classified=${totalClassified} | skipped(no_vec)=${totalSkippedNoVector} | skipped(classifier_null)=${totalSkippedClassifierNull}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[styleAttributesBackfill] fatal error:", err);
    process.exit(1);
  });
