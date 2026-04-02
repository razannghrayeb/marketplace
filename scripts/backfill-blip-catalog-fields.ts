/**
 * Batch BLIP backfill: fill empty products.description, color, gender, style, material, occasion
 * from primary image caption.
 *
 * Prerequisites: BLIP ONNX models + vocab; migration 013 (gender column) optional.
 *
 * Usage:
 *   npx tsx scripts/backfill-blip-catalog-fields.ts
 *   npx tsx scripts/backfill-blip-catalog-fields.ts --batch 100 --concurrency 2
 *   npx tsx scripts/backfill-blip-catalog-fields.ts --dry-run --limit 50
 *   npx tsx scripts/backfill-blip-catalog-fields.ts --reindex-os
 *
 * Env: DATABASE_URL / PG_* ; SEARCH_BLIP_CAPTION_TIMEOUT_MS (caption timeout per image)
 */
import "dotenv/config";
import { pg } from "../src/lib/core/db";
import { productsTableHasGenderColumn } from "../src/lib/core/db";
import { blip, validateImage } from "../src/lib/image";
import { applyBlipCaptionToMissingProductFields } from "../src/lib/image/blipCatalogBackfill";
import { updateProductIndex } from "../src/routes/products/images.service";

function parseArgs() {
  const argv = process.argv.slice(2);
  const get = (flag: string, def?: string) => {
    const i = argv.indexOf(flag);
    if (i >= 0 && argv[i + 1] != null && !argv[i + 1].startsWith("-")) return argv[i + 1];
    return def;
  };
  return {
    batch: Math.max(1, Number(get("--batch", "50")) || 50),
    concurrency: Math.max(1, Math.min(8, Number(get("--concurrency", "2")) || 2)),
    limit: get("--limit") ? Math.max(1, Number(get("--limit")) || 0) : null as number | null,
    dryRun: argv.includes("--dry-run"),
    reindexOs: argv.includes("--reindex-os"),
    fetchTimeoutMs: Math.max(5000, Number(get("--fetch-timeout-ms", "45000")) || 45000),
    captionTimeoutMs: Math.max(1500, Number(get("--caption-timeout-ms", "7000")) || 7000),
  };
}

async function fetchImageBuffer(url: string, timeoutMs: number): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

async function optionalColumns() {
  const q = await pg.query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'products'
       AND column_name = ANY($1::text[])`,
    [["style", "material", "occasion"]],
  );
  const set = new Set((q.rows ?? []).map((r) => r.column_name));
  return {
    hasStyle: set.has("style"),
    hasMaterial: set.has("material"),
    hasOccasion: set.has("occasion"),
  };
}

function missingCatalogFieldsClause(
  hasGender: boolean,
  opts: { hasStyle: boolean; hasMaterial: boolean; hasOccasion: boolean },
): string {
  const needGender = hasGender ? `OR NULLIF(TRIM(COALESCE(p.gender, '')), '') IS NULL` : "";
  const needStyle = opts.hasStyle ? `OR NULLIF(TRIM(COALESCE(p.style, '')), '') IS NULL` : "";
  const needMaterial = opts.hasMaterial ? `OR NULLIF(TRIM(COALESCE(p.material, '')), '') IS NULL` : "";
  const needOccasion = opts.hasOccasion ? `OR NULLIF(TRIM(COALESCE(p.occasion, '')), '') IS NULL` : "";
  return `
        NULLIF(TRIM(COALESCE(p.description, '')), '') IS NULL
        OR NULLIF(TRIM(COALESCE(p.color, '')), '') IS NULL
        ${needGender}
        ${needStyle}
        ${needMaterial}
        ${needOccasion}
  `.trim();
}

function buildSelectQuery(
  hasGender: boolean,
  colOpts: { hasStyle: boolean; hasMaterial: boolean; hasOccasion: boolean },
  cursorId: number,
  batchSize: number,
): { text: string; values: unknown[] } {
  const missing = missingCatalogFieldsClause(hasGender, colOpts);
  // Prefer first non-empty product_images URL (primary first); else products.image_cdn (scraped / legacy feeds).
  const text = `
    SELECT p.id,
      COALESCE(
        pi.cdn_url,
        NULLIF(TRIM(COALESCE(p.image_cdn, '')), '')
      ) AS cdn_url
    FROM products p
    LEFT JOIN LATERAL (
      SELECT cdn_url
      FROM product_images
      WHERE product_id = p.id
        AND TRIM(COALESCE(cdn_url, '')) <> ''
      ORDER BY is_primary DESC NULLS LAST, created_at ASC NULLS LAST, id ASC
      LIMIT 1
    ) pi ON true
    WHERE p.id > $1
      AND NULLIF(TRIM(COALESCE(pi.cdn_url, p.image_cdn, '')), '') IS NOT NULL
      AND (
        ${missing}
      )
    ORDER BY p.id
    LIMIT $2
  `;
  return { text, values: [cursorId, batchSize] };
}

/** Helps explain "no more rows" (wrong DB, nothing missing, or no image URLs). */
async function logBackfillCandidateStats(
  hasGender: boolean,
  colOpts: { hasStyle: boolean; hasMaterial: boolean; hasOccasion: boolean },
): Promise<void> {
  const missing = missingCatalogFieldsClause(hasGender, colOpts);
  try {
    const [{ n: missingAny }] = (
      await pg.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM products p WHERE (${missing})`)
    ).rows;
    const [{ n: withPi }] = (
      await pg.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM products p
         WHERE (${missing})
           AND EXISTS (
             SELECT 1 FROM product_images pi
             WHERE pi.product_id = p.id AND TRIM(COALESCE(pi.cdn_url, '')) <> ''
           )`,
      )
    ).rows;
    const [{ n: withLegacyCdn }] = (
      await pg.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM products p
         WHERE (${missing})
           AND TRIM(COALESCE(p.image_cdn, '')) <> ''
           AND NOT EXISTS (
             SELECT 1 FROM product_images pi
             WHERE pi.product_id = p.id AND TRIM(COALESCE(pi.cdn_url, '')) <> ''
           )`,
      )
    ).rows;
    const [{ n: totalProducts }] = (await pg.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM products`)).rows;
    const [{ n: missDesc }] = (
      await pg.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM products WHERE NULLIF(TRIM(COALESCE(description, '')), '') IS NULL`,
      )
    ).rows;
    const [{ n: missColor }] = (
      await pg.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM products WHERE NULLIF(TRIM(COALESCE(color, '')), '') IS NULL`,
      )
    ).rows;
    let missGender: string | undefined;
    if (hasGender) {
      const r = await pg.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM products WHERE NULLIF(TRIM(COALESCE(gender, '')), '') IS NULL`,
      );
      missGender = r.rows[0]?.n;
    }
    console.log("[backfill-blip-catalog] DB stats:", {
      totalProducts: Number(totalProducts),
      productsMissingAnyOfBackfillFields: Number(missingAny),
      missingDescriptionOnlyCount: Number(missDesc),
      missingColorOnlyCount: Number(missColor),
      ...(hasGender ? { missingGenderCount: Number(missGender) } : {}),
      missingButHaveProductImagesCdn: Number(withPi),
      missingButOnlyProductsImageCdn: Number(withLegacyCdn),
    });
  } catch (e) {
    console.warn("[backfill-blip-catalog] DB stats skipped:", (e as Error).message);
  }
}

async function main() {
  const opts = parseArgs();
  console.log("[backfill-blip-catalog] starting", opts);

  const hasGender = await productsTableHasGenderColumn();
  const colOpts = await optionalColumns();
  console.log("[backfill-blip-catalog] products.gender column:", hasGender ? "yes" : "no (gender skipped in SQL)");
  console.log("[backfill-blip-catalog] optional columns:", colOpts);
  await logBackfillCandidateStats(hasGender, colOpts);

  await blip.init();

  let cursorId = 0;
  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let skipFetchFail = 0;
  let skipBufferSmall = 0;
  let skipValidate = 0;
  let skipNoExtractedFields = 0;
  const blipMs = opts.captionTimeoutMs;
  console.log("[backfill-blip-catalog] caption timeout ms:", blipMs);

  while (true) {
    if (opts.limit != null && processed >= opts.limit) break;

    const batchSize = opts.limit != null ? Math.min(opts.batch, opts.limit - processed) : opts.batch;
    if (batchSize <= 0) break;

    const { text, values } = buildSelectQuery(hasGender, colOpts, cursorId, batchSize);
    const { rows } = await pg.query<{ id: number; cdn_url: string }>(text, values);
    if (rows.length === 0) {
      if (cursorId === 0) {
        console.log(
          "[backfill-blip-catalog] no rows in first batch — check DB stats above (e.g. all fields already filled, or no CDN URLs on product_images / products.image_cdn).",
        );
      } else {
        console.log("[backfill-blip-catalog] no more rows.");
      }
      break;
    }

    for (let i = 0; i < rows.length; i += opts.concurrency) {
      const chunk = rows.slice(i, i + opts.concurrency);
      await Promise.all(
        chunk.map(async (row) => {
          const id = row.id;
          try {
            const buf = await fetchImageBuffer(row.cdn_url, opts.fetchTimeoutMs);
            if (!buf || buf.length < 2048) {
              if (!buf) skipFetchFail++;
              else skipBufferSmall++;
              skipped++;
              return;
            }
            const v = await validateImage(buf);
            if (!v.valid) {
              skipValidate++;
              skipped++;
              return;
            }

            const caption = await Promise.race([
              blip.caption(buf),
              new Promise<never>((_, rej) =>
                setTimeout(() => rej(new Error("blip_timeout")), blipMs),
              ),
            ]).catch(() => "");

            const result = await applyBlipCaptionToMissingProductFields(id, caption, {
              dryRun: opts.dryRun,
            });

            if (!result.updated) {
              skipNoExtractedFields++;
              skipped++;
              return;
            }

            updated++;
            if (!opts.dryRun && opts.reindexOs) {
              await updateProductIndex(id).catch((e) =>
                console.warn(`[backfill-blip-catalog] reindex failed id=${id}`, (e as Error).message),
              );
            }
          } catch (e) {
            failed++;
            console.warn(`[backfill-blip-catalog] id=${id}`, (e as Error).message);
          } finally {
            processed++;
          }
        }),
      );
    }

    cursorId = rows[rows.length - 1]!.id;
    console.log(
      `[backfill-blip-catalog] cursor=${cursorId} processed=${processed} updated=${updated} skipped=${skipped} failed=${failed}`,
    );
  }

  console.log("[backfill-blip-catalog] done.", {
    processed,
    updated,
    skipped,
    failed,
    dryRun: opts.dryRun,
    skipReasons: {
      fetchFailed: skipFetchFail,
      bufferUnder2k: skipBufferSmall,
      validateImageFailed: skipValidate,
      noExtractedFields: skipNoExtractedFields,
    },
  });
  await pg.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
