import "dotenv/config";
import axios from "axios";
import { pg, osClient } from "../src/lib/core";
import { config } from "../src/config";
import { processImageForEmbedding, computePHash } from "../src/lib/image";
import { extractAttributesSync } from "../src/lib/search/attributeExtractor";

async function columnExists(columnName: string) {
  const res = await pg.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name=$1`,
    [columnName]
  );
  return res.rowCount > 0;
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
    console.warn(`Failed to fetch image ${url}:`, err.message || err);
    return null;
  }
}

async function main() {
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

  const res = await pg.query(
    `SELECT id, vendor_id, title, brand, category, price_cents, availability, last_seen, image_url, ${optionalColumns}
     FROM products
     WHERE image_url IS NOT NULL`
  );

  console.log(`Found ${res.rowCount} products with images`);

  for (const row of res.rows) {
    const { id, vendor_id, title, brand, category, price_cents, availability, last_seen, image_url, is_hidden, canonical_id } = row;
    const buf = await fetchImage(image_url);
    if (!buf) continue;

    // Validate and generate embedding
    try {
      const embedding = await processImageForEmbedding(buf);
      const ph = await computePHash(buf);
      
      // Extract attributes from title
      const { attributes } = extractAttributesSync(title);

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
        // Extracted attributes
        attr_color: attributes.color || null,
        attr_colors: attributes.colors || [],
        attr_material: attributes.material || null,
        attr_materials: attributes.materials || [],
        attr_fit: attributes.fit || null,
        attr_style: attributes.style || null,
        attr_gender: attributes.gender || null,
        attr_pattern: attributes.pattern || null,
        attr_sleeve: attributes.sleeve || null,
        attr_neckline: attributes.neckline || null,
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
