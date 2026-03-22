import "dotenv/config";
import axios from "axios";
import { pg, osClient } from "../src/lib/core";
import { config } from "../src/config";
import { processImageForEmbedding, processImageForGarmentEmbedding, computePHash } from "../src/lib/image";
import { buildProductSearchDocument } from "../src/lib/search/searchDocument";
import { extractDominantColorNames } from "../src/lib/color/dominantColor";
import { loadProductSearchEnrichmentByIds } from "../src/lib/search/loadProductSearchEnrichment";

async function columnExists(columnName: string) {
  const res = await pg.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name=$1`,
    [columnName]
  );
  return !!res.rowCount && res.rowCount > 0;
}

async function getProductColumns(): Promise<{ hasIsHidden: boolean; hasCanonicalId: boolean }> {
  const [hasIsHidden, hasCanonicalId] = await Promise.all([
    columnExists("is_hidden"),
    columnExists("canonical_id"),
  ]);
  return { hasIsHidden, hasCanonicalId };
}

async function fetchImage(url: string): Promise<Buffer | null> {
  try {
    const res = await axios.get(url, { responseType: "arraybuffer", timeout: 20000 });
    return Buffer.from(res.data);
  } catch (err) {
    if (err instanceof Error) {
      console.warn(`Failed to fetch image ${url}:`, err.message);
    } else {
      console.warn(`Failed to fetch image ${url}:`, err);
    }
    return null;
  }
}

async function main() {
  try {
    const hasProductImageUrl = await columnExists("image_url");
    if (!hasProductImageUrl) {
      console.error("Need products.image_url — nothing to reindex.");
      process.exit(1);
    }

    const { hasIsHidden, hasCanonicalId } = await getProductColumns();

    const optionalColumns = [
      hasIsHidden ? "p.is_hidden" : "NULL::boolean AS is_hidden",
      hasCanonicalId ? "p.canonical_id" : "NULL::text AS canonical_id",
    ].join(", ");

    console.log("Fetching products with images...");

    let res;
    try {
      res = await pg.query(
        `SELECT id, vendor_id, title, description, brand, category, price_cents, availability, last_seen, image_url, ${optionalColumns.replace(/p\./g, "")}
         FROM products
         WHERE image_url IS NOT NULL`,
      );
    } catch (queryErr) {
      console.error("Database query failed:", queryErr);
      process.exit(1);
    }

    console.log(`Found ${res.rowCount} products with images`);

    const allIds = res.rows.map((r: { id: number }) => r.id);
    const enrichMap = await loadProductSearchEnrichmentByIds(allIds);

    for (const row of res.rows) {
      const {
        id,
        vendor_id,
        title,
        description,
        brand,
        category,
        price_cents,
        availability,
        last_seen,
        image_url,
        is_hidden,
        canonical_id,
      } = row;
      const buf = await fetchImage(image_url);
      if (!buf) continue;

      // Validate and generate embedding
      try {
        const enrichRow = enrichMap.get(id);
        const [embedding, embeddingGarment, ph, dominantColors] = await Promise.all([
          processImageForEmbedding(buf),
          processImageForGarmentEmbedding(buf).catch(() => [] as number[]),
          computePHash(buf),
          extractDominantColorNames(buf).catch(() => []),
        ]);
        const body = buildProductSearchDocument({
          productId: id,
          vendorId: vendor_id,
          title,
          description: description ?? null,
          brand,
          category,
          priceCents: price_cents,
          availability: Boolean(availability),
          isHidden: is_hidden ?? false,
          canonicalId: canonical_id,
          imageCdn: image_url,
          pHash: ph,
          lastSeenAt: last_seen,
          embedding,
          embeddingGarment: embeddingGarment?.length ? embeddingGarment : null,
          detectedColors: dominantColors,
          enrichment: enrichRow
            ? {
                norm_confidence: enrichRow.norm_confidence,
                category_confidence: enrichRow.category_confidence,
                brand_confidence: enrichRow.brand_confidence,
                canonical_type_ids: enrichRow.canonical_type_ids,
              }
            : null,
          images: image_url
            ? [{ url: image_url, p_hash: ph, is_primary: true }]
            : [],
        });
        await osClient.index({ index: config.opensearch.index, id: String(id), body, refresh: true });
        console.log(`Indexed ${id} (${title})`);
      } catch (err) {
        console.error(`Failed processing product ${id}:`, err);
      }
    }

    console.log("Reindexing completed.");
    process.exit(0);
  } catch (e) {
    console.error("Fatal error in main():", e);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Unhandled error in main():", e);
  process.exit(1);
});
