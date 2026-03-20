import "dotenv/config";
import axios from "axios";
import { pg, osClient } from "../src/lib/core";
import { config } from "../src/config";
import { processImageForEmbedding, computePHash } from "../src/lib/image";
import { buildProductSearchDocument } from "../src/lib/search/searchDocument";
import { extractDominantColorNames } from "../src/lib/color/dominantColor";

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
    if (!(await columnExists("image_url"))) {
      console.error("products.image_url column not found. Add image_url column before reindexing.");
      process.exit(1);
    }

    const { hasIsHidden, hasCanonicalId } = await getProductColumns();

    console.log("Fetching products with images...");
    const optionalColumns = [
      hasIsHidden ? "is_hidden" : "NULL::boolean AS is_hidden",
      hasCanonicalId ? "canonical_id" : "NULL::text AS canonical_id",
    ].join(", ");

    let res;
    try {
      res = await pg.query(
        `SELECT id, vendor_id, title, brand, category, price_cents, availability, last_seen, image_url, ${optionalColumns}
         FROM products
         WHERE image_url IS NOT NULL`
      );
    } catch (queryErr) {
      console.error("Database query failed:", queryErr);
      process.exit(1);
    }

    console.log(`Found ${res.rowCount} products with images`);

    for (const row of res.rows) {
      const { id, vendor_id, title, brand, category, price_cents, availability, last_seen, image_url, is_hidden, canonical_id } = row;
      const buf = await fetchImage(image_url);
      if (!buf) continue;

      // Validate and generate embedding
      try {
        const [embedding, ph, dominantColors] = await Promise.all([
          processImageForEmbedding(buf),
          computePHash(buf),
          extractDominantColorNames(buf).catch(() => []),
        ]);
        const body = buildProductSearchDocument({
          productId: id,
          vendorId: vendor_id,
          title,
          description: null,
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
          detectedColors: dominantColors,
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
