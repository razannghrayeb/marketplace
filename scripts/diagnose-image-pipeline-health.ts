import "dotenv/config";
import { Pool } from "pg";
import { osClient } from "../src/lib/core/opensearch";
import { config } from "../src/config";

function pct(part: number, total: number): string {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return "n/a";
  return `${((part / total) * 100).toFixed(2)}%`;
}

async function main(): Promise<void> {
  const pool = new Pool({
    connectionString: config.database.url,
    ssl: { rejectUnauthorized: false },
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 20_000,
  });

  try {
    const [
      productsTotalRes,
      productsWithImageRes,
      primaryImagesRes,
      detectionsTotalRes,
      detectionsUsableRes,
      primaryWithUsableDetectionRes,
    ] = await Promise.all([
      pool.query(`SELECT COUNT(*)::bigint AS n FROM products`),
      pool.query(`
        SELECT COUNT(*)::bigint AS n
        FROM products p
        WHERE COALESCE(TRIM(COALESCE(p.image_cdn, p.image_url)), '') <> ''
      `),
      pool.query(`
        SELECT COUNT(*)::bigint AS n
        FROM product_images pi
        WHERE pi.is_primary = true
      `),
      pool.query(`SELECT COUNT(*)::bigint AS n FROM product_image_detections`),
      pool.query(`
        SELECT COUNT(*)::bigint AS n
        FROM product_image_detections d
        WHERE d.box_x1 IS NOT NULL
          AND d.box_y1 IS NOT NULL
          AND d.box_x2 IS NOT NULL
          AND d.box_y2 IS NOT NULL
          AND d.box_x2 > d.box_x1
          AND d.box_y2 > d.box_y1
          AND COALESCE(d.confidence, 0) >= 0.22
      `),
      pool.query(`
        SELECT COUNT(*)::bigint AS n
        FROM product_images pi
        WHERE pi.is_primary = true
          AND EXISTS (
            SELECT 1
            FROM product_image_detections d
            WHERE d.product_image_id = pi.id
              AND d.box_x1 IS NOT NULL
              AND d.box_y1 IS NOT NULL
              AND d.box_x2 IS NOT NULL
              AND d.box_y2 IS NOT NULL
              AND d.box_x2 > d.box_x1
              AND d.box_y2 > d.box_y1
              AND COALESCE(d.confidence, 0) >= 0.22
          )
      `),
    ]);

    const productsTotal = Number(productsTotalRes.rows[0]?.n ?? 0);
    const productsWithImage = Number(productsWithImageRes.rows[0]?.n ?? 0);
    const primaryImages = Number(primaryImagesRes.rows[0]?.n ?? 0);
    const detectionsTotal = Number(detectionsTotalRes.rows[0]?.n ?? 0);
    const detectionsUsable = Number(detectionsUsableRes.rows[0]?.n ?? 0);
    const primaryWithUsableDetection = Number(primaryWithUsableDetectionRes.rows[0]?.n ?? 0);

    const indexName = config.opensearch.index;
    const [
      osTotalRes,
      osWithEmbeddingRes,
      osWithGarmentRes,
      osWithBothRes,
    ] = await Promise.all([
      osClient.count({ index: indexName, body: { query: { match_all: {} } } }),
      osClient.count({ index: indexName, body: { query: { exists: { field: "embedding" } } } }),
      osClient.count({ index: indexName, body: { query: { exists: { field: "embedding_garment" } } } }),
      osClient.count({
        index: indexName,
        body: {
          query: {
            bool: {
              must: [{ exists: { field: "embedding" } }, { exists: { field: "embedding_garment" } }],
            },
          },
        },
      }),
    ]);

    const osTotal = Number((osTotalRes as any).body?.count ?? 0);
    const osWithEmbedding = Number((osWithEmbeddingRes as any).body?.count ?? 0);
    const osWithGarment = Number((osWithGarmentRes as any).body?.count ?? 0);
    const osWithBoth = Number((osWithBothRes as any).body?.count ?? 0);

    console.log("=".repeat(88));
    console.log("IMAGE PIPELINE HEALTH REPORT");
    console.log("=".repeat(88));
    console.log(`OpenSearch index: ${indexName}`);
    console.log("");

    console.log("Database coverage");
    console.log(`  products total                          : ${productsTotal}`);
    console.log(`  products with image                     : ${productsWithImage} (${pct(productsWithImage, productsTotal)})`);
    console.log(`  primary product_images                  : ${primaryImages}`);
    console.log(`  detections total                        : ${detectionsTotal}`);
    console.log(`  detections with usable box              : ${detectionsUsable} (${pct(detectionsUsable, detectionsTotal)})`);
    console.log(`  primary images with usable detection    : ${primaryWithUsableDetection} (${pct(primaryWithUsableDetection, primaryImages)})`);
    console.log("");

    console.log("OpenSearch embedding coverage");
    console.log(`  indexed docs total                      : ${osTotal}`);
    console.log(`  docs with embedding                     : ${osWithEmbedding} (${pct(osWithEmbedding, osTotal)})`);
    console.log(`  docs with embedding_garment             : ${osWithGarment} (${pct(osWithGarment, osTotal)})`);
    console.log(`  docs with both vectors                  : ${osWithBoth} (${pct(osWithBoth, osTotal)})`);
    console.log("");

    const garmentGap = osWithEmbedding - osWithGarment;
    if (garmentGap > 0) {
      console.log(`WARNING: ${garmentGap} docs have embedding but are missing embedding_garment.`);
      console.log("         These docs may reduce detection-crop search quality until backfilled.");
    } else {
      console.log("OK: embedding and embedding_garment coverage are aligned.");
    }
  } finally {
    await pool.end().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error("[diagnose-image-pipeline-health] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
