/**
 * Backfill only OpenSearch embedding_part_* fields.
 *
 * This does not recreate the index and does not rewrite full product embeddings.
 *
 * Safe rollout examples:
 *   npx tsx scripts/backfill-part-embeddings.ts --dry-run --limit 20
 *   npx tsx scripts/backfill-part-embeddings.ts --limit 500 --exclude-categories footwear,shoes
 *   npx tsx scripts/backfill-part-embeddings.ts --category bags --limit 1000
 */

import "dotenv/config";
import axios from "axios";
import { osClient } from "../src/lib/core/opensearch";
import { config } from "../src/config";
import { computeAllPartEmbeddingsFromDetection } from "../src/lib/image/processor";
import { getApplicablePartTypesForLabel } from "../src/lib/image/partExtraction";

const PART_FIELDS = [
  "embedding_part_sleeve",
  "embedding_part_neckline",
  "embedding_part_hem",
  "embedding_part_waistline",
  "embedding_part_heel",
  "embedding_part_toe",
  "embedding_part_bag_handle",
  "embedding_part_bag_body",
  "embedding_part_pattern_patch",
];

type SourceDoc = {
  product_id?: string;
  title?: string | null;
  category?: string | null;
  category_canonical?: string | null;
  product_types?: unknown;
  image_cdn?: string | null;
  image_url?: string | null;
};

function parseArgs() {
  const args = process.argv.slice(2);
  const value = (name: string): string | undefined => {
    const eq = args.find((arg) => arg.startsWith(`${name}=`));
    const pos = args.indexOf(name);
    return eq ? eq.split("=").slice(1).join("=") : pos >= 0 ? args[pos + 1] : undefined;
  };
  const numberValue = (name: string, fallback: number): number => {
    const n = Number(value(name));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  };
  const listValue = (name: string): string[] =>
    String(value(name) ?? "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);

  return {
    dryRun: args.includes("--dry-run"),
    force: args.includes("--force"),
    limit: value("--limit") ? numberValue("--limit", 0) : undefined,
    batchSize: Math.min(500, Math.max(20, numberValue("--batch-size", 100))),
    category: value("--category")?.trim().toLowerCase(),
    excludeCategories: new Set(listValue("--exclude-categories")),
  };
}

function textBlob(src: SourceDoc): string {
  return [
    src.title,
    src.category,
    src.category_canonical,
    ...(Array.isArray(src.product_types) ? src.product_types : []),
  ]
    .map((v) => String(v ?? "").toLowerCase())
    .join(" ");
}

function inferPartLabel(src: SourceDoc): string | null {
  const blob = textBlob(src);
  const cat = String(src.category_canonical ?? src.category ?? "").toLowerCase();

  if (/\b(bag|handbag|tote|purse|clutch|backpack|crossbody|satchel)\b/.test(blob)) return "bag";
  if (/\b(sneaker|trainer)\b/.test(blob)) return "sneaker";
  if (/\b(boot|boots)\b/.test(blob)) return "boot";
  if (/\b(heel|heels|pump|pumps)\b/.test(blob)) return "heel";
  if (/\b(shoe|shoes|footwear|sandal|sandals)\b/.test(blob) || cat === "footwear") return "shoe";
  if (/\b(dress|gown|frock)\b/.test(blob) || cat === "dresses") return "dress";
  if (/\b(pants|jeans|denim|shorts|skirt|leggings|trousers|bottoms)\b/.test(blob) || cat === "bottoms") return "pants";
  if (/\b(jacket|coat|blazer|outerwear|cardigan|vest)\b/.test(blob) || cat === "outerwear") return "jacket";
  if (/\b(tshirt|t-shirt|shirt|blouse|sweater|hoodie|top|tops|knitwear|pullover)\b/.test(blob) || cat === "tops") return "shirt";
  return null;
}

function excluded(src: SourceDoc, excludedCategories: Set<string>): boolean {
  if (excludedCategories.size === 0) return false;
  const values = [
    String(src.category_canonical ?? "").toLowerCase(),
    String(src.category ?? "").toLowerCase(),
    inferPartLabel(src) ?? "",
  ];
  return values.some((v) => excludedCategories.has(v)) ||
    (values.includes("shoe") && (excludedCategories.has("shoes") || excludedCategories.has("footwear")));
}

async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  try {
    const response = await axios.get<ArrayBuffer>(url, {
      responseType: "arraybuffer",
      timeout: 30_000,
      maxContentLength: 20 * 1024 * 1024,
      validateStatus: (status) => status >= 200 && status < 300,
    });
    return Buffer.from(response.data);
  } catch {
    return null;
  }
}

function missingPartQuery(opts: ReturnType<typeof parseArgs>) {
  const filter: any[] = [{ exists: { field: "image_cdn" } }];
  if (opts.category) {
    filter.push({
      bool: {
        should: [
          { term: { category_canonical: opts.category } },
          { term: { category: opts.category } },
        ],
        minimum_should_match: 1,
      },
    });
  }

  const mustNot = opts.force ? [] : PART_FIELDS.map((field) => ({ exists: { field } }));
  return { bool: { filter, must_not: mustNot } };
}

async function run(): Promise<void> {
  const opts = parseArgs();
  const index = config.opensearch.index;

  const searchResp: any = await osClient.search({
    index,
    scroll: "2m",
    body: {
      size: opts.batchSize,
      _source: ["product_id", "title", "category", "category_canonical", "product_types", "image_cdn", "image_url"],
      query: missingPartQuery(opts),
      sort: ["_doc"],
    },
  });

  let scrollId = searchResp.body?._scroll_id;
  let hits = searchResp.body?.hits?.hits ?? [];
  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  while (hits.length > 0) {
    const remaining = opts.limit ? Math.max(0, opts.limit - processed) : hits.length;
    const batch = opts.limit ? hits.slice(0, remaining) : hits;
    if (batch.length === 0) break;

    const bulkBody: any[] = [];
    for (const hit of batch) {
      processed++;
      const src = (hit._source ?? {}) as SourceDoc;
      const label = inferPartLabel(src);
      const url = String(src.image_cdn ?? src.image_url ?? "").trim();

      if (!label || !url || excluded(src, opts.excludeCategories) || getApplicablePartTypesForLabel(label).length === 0) {
        skipped++;
        continue;
      }

      if (opts.dryRun) {
        console.log(`[dry-run] ${src.product_id ?? hit._id} label=${label} url=${url.slice(0, 90)}`);
        updated++;
        continue;
      }

      const image = await fetchImageBuffer(url);
      if (!image) {
        failed++;
        continue;
      }

      const parts = await computeAllPartEmbeddingsFromDetection(image, label);
      const doc: Record<string, number[]> = {};
      for (const [partType, embedding] of Object.entries(parts)) {
        if (Array.isArray(embedding) && embedding.length > 0) {
          doc[`embedding_part_${partType}`] = embedding;
        }
      }

      if (Object.keys(doc).length === 0) {
        skipped++;
        continue;
      }

      bulkBody.push({ update: { _index: index, _id: hit._id } });
      bulkBody.push({ doc });
    }

    if (bulkBody.length > 0) {
      const bulkResp: any = await osClient.bulk({ refresh: false, body: bulkBody });
      if (bulkResp.body?.errors) {
        failed += bulkBody.length / 2;
      } else {
        updated += bulkBody.length / 2;
      }
    }

    console.log(`[part-backfill] processed=${processed} updated=${updated} skipped=${skipped} failed=${failed}`);
    if (opts.limit && processed >= opts.limit) break;

    const nextResp: any = await osClient.scroll({ scroll_id: scrollId, scroll: "2m" });
    scrollId = nextResp.body?._scroll_id;
    hits = nextResp.body?.hits?.hits ?? [];
  }

  if (scrollId) await osClient.clearScroll({ scroll_id: scrollId }).catch(() => undefined);
  console.log(`[part-backfill] done dryRun=${opts.dryRun} processed=${processed} updated=${updated} skipped=${skipped} failed=${failed}`);
}

run().catch((error) => {
  console.error("[part-backfill] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
