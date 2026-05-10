/**
 * Backfill OpenSearch product_quality_score from already-indexed product fields.
 *
 * The score mirrors searchDocument.computeProductQualityScore:
 * image present, valid price, normalized colors, product_types, and audience_gender.
 *
 * Usage:
 *   npx tsx scripts/backfill-product-quality-score.ts --dry-run --limit 100
 *   npx tsx scripts/backfill-product-quality-score.ts
 */

import "dotenv/config";
import { osClient } from "../src/lib/core/opensearch";
import { config } from "../src/config";

type SourceDoc = {
  product_id?: string | number;
  image_cdn?: string | null;
  price_usd?: number | null;
  attr_colors?: unknown;
  product_types?: unknown;
  audience_gender?: string | null;
};

const FIELD = "product_quality_score";

function parseArgs() {
  const args = process.argv.slice(2);
  const readNumber = (name: string): number | undefined => {
    const eq = args.find((arg) => arg.startsWith(`${name}=`));
    const pos = args.indexOf(name);
    const raw = eq ? eq.split("=")[1] : pos >= 0 ? args[pos + 1] : undefined;
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
  };

  return {
    dryRun: args.includes("--dry-run"),
    limit: readNumber("--limit"),
    batchSize: Math.min(1000, Math.max(50, readNumber("--batch-size") ?? 500)),
  };
}

function arrayHasValues(value: unknown): boolean {
  return Array.isArray(value) && value.some((item) => String(item ?? "").trim().length > 0);
}

function computeProductQualityScore(src: SourceDoc): number {
  const hasValidImage = Boolean(String(src.image_cdn ?? "").trim());
  const price = Number(src.price_usd ?? 0);
  const hasValidPrice = Number.isFinite(price) && price > 0 && price < 100_000_000;
  const hasValidColor = arrayHasValues(src.attr_colors);
  const hasNormalizedType = arrayHasValues(src.product_types);
  const hasAudience = Boolean(String(src.audience_gender ?? "").trim());

  let score = 0.55;
  if (hasValidImage) score += 0.18;
  if (hasValidPrice) score += 0.08;
  if (hasValidColor) score += 0.08;
  if (hasNormalizedType) score += 0.08;
  if (hasAudience) score += 0.03;
  return Math.max(0.45, Math.min(1, Math.round(score * 1000) / 1000));
}

async function ensureMapping(index: string): Promise<void> {
  const mapping = await osClient.indices.getMapping({ index });
  const properties = (mapping as any).body?.[index]?.mappings?.properties ?? {};
  if (properties[FIELD]) return;

  await osClient.indices.putMapping({
    index,
    body: {
      properties: {
        [FIELD]: { type: "float" },
      },
    },
  });
}

async function run(): Promise<void> {
  const opts = parseArgs();
  const index = config.opensearch.index;
  await ensureMapping(index);

  const searchResp: any = await osClient.search({
    index,
    scroll: "2m",
    body: {
      size: opts.batchSize,
      _source: ["product_id", "image_cdn", "price_usd", "attr_colors", "product_types", "audience_gender"],
      query: { match_all: {} },
      sort: ["_doc"],
    },
  });

  let scrollId = searchResp.body?._scroll_id;
  let hits = searchResp.body?.hits?.hits ?? [];
  let processed = 0;
  let updated = 0;

  while (hits.length > 0) {
    const batch = opts.limit ? hits.slice(0, Math.max(0, opts.limit - processed)) : hits;
    if (batch.length === 0) break;

    const body: any[] = [];
    for (const hit of batch) {
      const score = computeProductQualityScore(hit._source ?? {});
      body.push({ update: { _index: index, _id: hit._id } });
      body.push({ doc: { [FIELD]: score } });
    }

    if (!opts.dryRun && body.length > 0) {
      const bulkResp: any = await osClient.bulk({ refresh: false, body });
      if (bulkResp.body?.errors) {
        const sample = (bulkResp.body?.items ?? []).find((item: any) => item.update?.error);
        throw new Error(`Bulk update failed: ${JSON.stringify(sample?.update?.error ?? sample)}`);
      }
      updated += body.length / 2;
    }

    processed += batch.length;
    console.log(`[quality-score] processed=${processed} updated=${opts.dryRun ? 0 : updated}`);
    if (opts.limit && processed >= opts.limit) break;

    const nextResp: any = await osClient.scroll({ scroll_id: scrollId, scroll: "2m" });
    scrollId = nextResp.body?._scroll_id;
    hits = nextResp.body?.hits?.hits ?? [];
  }

  if (scrollId) {
    await osClient.clearScroll({ scroll_id: scrollId }).catch(() => undefined);
  }

  console.log(`[quality-score] done dryRun=${opts.dryRun} processed=${processed} updated=${opts.dryRun ? 0 : updated}`);
}

run().catch((error) => {
  console.error("[quality-score] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
