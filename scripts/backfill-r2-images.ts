/**
 * Backfill script: Upload existing product images to R2 and update DB/OpenSearch
 *
 * For each product with image_url but no images in product_images:
 * 1. Download the image from image_url
 * 2. Upload to Cloudflare R2
 * 3. Insert into product_images table
 * 4. Compute embedding & pHash
 * 5. Update products.image_cdn and primary_image_id
 * 6. Index/update document in OpenSearch
 */
import "dotenv/config";
import { pg } from "../src/lib/db";
import { osClient } from "../src/lib/opensearch";
import { config } from "../src/config";
import { uploadImage, generateImageKey } from "../src/lib/r2";
import { processImageForEmbedding, processImageForGarmentEmbedding, computePHash, validateImage } from "../src/lib/image";
import { buildProductSearchDocument } from "../src/lib/search/searchDocument";
import { extractDominantColorNames } from "../src/lib/color/dominantColor";
import { loadProductSearchEnrichmentByIds } from "../src/lib/search/loadProductSearchEnrichment";
import axios from "axios";

async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await axios.get(url, { responseType: "arraybuffer", timeout: 30000 });
    return Buffer.from(res.data);
  } catch (err: any) {
    console.warn(`Failed to fetch image ${url}:`, err.message || err);
    return null;
  }
}

async function main() {
  console.log("Starting R2 image backfill...\n");

  // Ensure product_images table exists
  await pg.query(`
    CREATE TABLE IF NOT EXISTS product_images (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      r2_key TEXT NOT NULL,
      cdn_url TEXT NOT NULL,
      embedding FLOAT8[],
      p_hash TEXT,
      is_primary BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Find products with image_url that don't have any images in product_images
  const res = await pg.query(`
    SELECT p.id, p.vendor_id, p.title, p.description, p.brand, p.category, p.price_cents, p.availability, p.last_seen, p.image_url
    FROM products p
    LEFT JOIN product_images pi ON pi.product_id = p.id
    WHERE p.image_url IS NOT NULL AND pi.id IS NULL
  `);

  console.log(`Found ${res.rowCount} products to backfill\n`);

  let success = 0;
  let failed = 0;

  for (const row of res.rows) {
    const { id, vendor_id, title, brand, category, price_cents, availability, last_seen, image_url } = row;

    console.log(`[${success + failed + 1}/${res.rowCount}] Processing product ${id}: ${title}`);

    try {
      // 1. Fetch image from source URL
      const buffer = await fetchImageBuffer(image_url);
      if (!buffer) {
        console.warn(`  ⚠ Skipping: failed to fetch image`);
        failed++;
        continue;
      }

      // Validate image
      const validation = await validateImage(buffer);
      if (!validation.valid) {
        console.warn(`  ⚠ Skipping: invalid image - ${validation.error}`);
        failed++;
        continue;
      }

      // 2. Upload to R2
      const contentType = "image/jpeg"; // Default, could detect from response
      const key = generateImageKey(buffer, ".jpg");
      const { cdnUrl } = await uploadImage(buffer, key, contentType);
      console.log(`  ✓ Uploaded to R2: ${cdnUrl}`);

      // 3. Compute embedding and pHash
      const [embedding, embeddingGarment, pHash, dominantColors, enrichMap] = await Promise.all([
        processImageForEmbedding(buffer),
        processImageForGarmentEmbedding(buffer).catch(() => [] as number[]),
        computePHash(buffer),
        extractDominantColorNames(buffer).catch(() => []),
        loadProductSearchEnrichmentByIds([id]),
      ]);
      const enrichRow = enrichMap.get(id);
      console.log(`  ✓ Computed embedding and pHash`);

      // 4. Insert into product_images
      const imgResult = await pg.query(
        `INSERT INTO product_images (product_id, r2_key, cdn_url, embedding, p_hash, is_primary)
         VALUES ($1, $2, $3, $4, $5, true)
         RETURNING id`,
        [id, key, cdnUrl, embedding, pHash]
      );
      const imageId = imgResult.rows[0].id;

      // 5. Update products table with CDN URL and primary image
      await pg.query(
        `UPDATE products SET image_cdn = $1, primary_image_id = $2 WHERE id = $3`,
        [cdnUrl, imageId, id]
      );
      console.log(`  ✓ Updated product record`);

      // 6. Index in OpenSearch
      const doc: any = buildProductSearchDocument({
        productId: id,
        vendorId: vendor_id,
        title,
        description: description ?? null,
        brand,
        category,
        priceCents: price_cents,
        availability: Boolean(availability),
        isHidden: false,
        canonicalId: null,
        imageCdn: cdnUrl,
        pHash,
        lastSeenAt: last_seen,
        embedding,
        embeddingGarment: embeddingGarment.length > 0 ? embeddingGarment : null,
        detectedColors: dominantColors,
        enrichment: enrichRow
          ? {
              norm_confidence: enrichRow.norm_confidence,
              category_confidence: enrichRow.category_confidence,
              brand_confidence: enrichRow.brand_confidence,
              canonical_type_ids: enrichRow.canonical_type_ids,
            }
          : null,
        images: [{ url: cdnUrl, p_hash: pHash, is_primary: true }],
      });

      await osClient.index({
        index: config.opensearch.index,
        id: String(id),
        body: doc,
        refresh: true,
      });
      console.log(`  ✓ Indexed in OpenSearch\n`);

      success++;
    } catch (err: any) {
      console.error(`  ✗ Failed: ${err.message || err}\n`);
      failed++;
    }
  }

  console.log(`\n========================================`);
  console.log(`Backfill completed: ${success} success, ${failed} failed`);
  console.log(`========================================\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
