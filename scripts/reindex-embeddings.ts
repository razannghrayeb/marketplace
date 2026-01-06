import axios from "axios";
import { pg } from "../src/lib/db";
import { osClient } from "../src/lib/opensearch";
import { config } from "../src/config";
import { processImageForEmbedding, computePHash } from "../src/lib/imageProcessor";

async function columnExists(columnName: string) {
  const res = await pg.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name=$1`,
    [columnName]
  );
  return res.rowCount > 0;
}

async function fetchImage(url: string): Promise<Buffer | null> {
  try {
    const res = await axios.get(url, { responseType: "arraybuffer", timeout: 20000 });
    return Buffer.from(res.data);
  } catch (err) {
    console.warn(`Failed to fetch image ${url}:`, err.message || err);
    return null;
  }
}

async function main() {
  if (!(await columnExists("image_url"))) {
    console.error("products.image_url column not found. Add image_url column before reindexing.");
    process.exit(1);
  }

  console.log("Fetching products with images...");
  const res = await pg.query(`SELECT id, vendor_id, title, brand, category, price_cents, availability, last_seen, image_url, is_hidden, canonical_id FROM products WHERE image_url IS NOT NULL`);

  console.log(`Found ${res.rowCount} products with images`);

  for (const row of res.rows) {
    const { id, vendor_id, title, brand, category, price_cents, availability, last_seen, image_url, is_hidden, canonical_id } = row;
    const buf = await fetchImage(image_url);
    if (!buf) continue;

    // Validate and generate embedding
    try {
      const embedding = await processImageForEmbedding(buf);
      const ph = await computePHash(buf);

      // Index into OpenSearch
      const body = {
        product_id: String(id),
        vendor_id: String(vendor_id),
        title,
        brand,
        category,
        price_usd: Math.round(price_cents / 89000),
        availability: availability ? "in_stock" : "out_of_stock",
        is_hidden: is_hidden ?? false,
        canonical_id: canonical_id ? String(canonical_id) : null,
        embedding,
        image_cdn: image_url,
        p_hash: ph,
        last_seen_at: last_seen,
      };

      await osClient.index({ index: config.opensearch.index, id: String(id), body, refresh: true });
      console.log(`Indexed ${id} (${title})`);
    } catch (err) {
      console.error(`Failed processing product ${id}:`, err);
    }
  }

  console.log("Reindexing completed.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
