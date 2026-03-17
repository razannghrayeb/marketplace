/**
 * Product Images Service
 * Handles all image business logic, storage, and retrieval
 */
import { pg } from "../../lib/core/index";
import { uploadImage, generateImageKey } from "../../lib/image/index";
import { processImageForEmbedding, computePHash, validateImage } from "../../lib/image/index";
import { osClient } from "../../lib/core/index";
import { config } from "../../config";

// ============================================================================
// Types
// ============================================================================

export interface ProductImage {
  id: number;
  product_id: number;
  r2_key: string;
  cdn_url: string;
  p_hash: string | null;
  is_primary: boolean;
  created_at: Date;
}

export interface ProductImageResponse {
  id: number;
  url: string;
  is_primary: boolean;
  created_at: Date;
}

export interface UploadImageResult {
  image: ProductImage;
  embedding: number[];
}

export interface UploadOptions {
  isPrimary?: boolean;
  contentType?: string;
}

// ============================================================================
// Validation & Helpers
// ============================================================================

/**
 * Check if a product exists
 */
export async function productExists(productId: number): Promise<boolean> {
  const result = await pg.query("SELECT 1 FROM products WHERE id = $1", [productId]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Fetch image from URL and return buffer with content type
 */
export async function fetchImageFromUrl(
  url: string,
  timeoutMs = 30000
): Promise<{ buffer: Buffer; contentType: string }> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    throw new Error(`Failed to fetch image: HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") || "image/jpeg";
  return { buffer, contentType };
}

/**
 * Transform database row to API response format
 */
export function toImageResponse(image: ProductImage): ProductImageResponse {
  return {
    id: image.id,
    url: image.cdn_url,
    is_primary: image.is_primary,
    created_at: image.created_at,
  };
}

// ============================================================================
// Core Image Operations
// ============================================================================

/**
 * Upload and attach an image to a product
 */
export async function uploadProductImage(
  productId: number,
  buffer: Buffer,
  options: UploadOptions = {}
): Promise<UploadImageResult> {
  const { isPrimary = false, contentType = "image/jpeg" } = options;

  // Validate image
  const validation = await validateImage(buffer);
  if (!validation.valid) {
    throw new Error(validation.error || "Invalid image");
  }

  // Upload to R2
  const key = generateImageKey(buffer, contentType.includes("png") ? ".png" : ".jpg");
  const { cdnUrl } = await uploadImage(buffer, key, contentType);

  // Compute embedding and pHash
  const embedding = await processImageForEmbedding(buffer);
  const pHash = await computePHash(buffer);

  // Insert into database
  const result = await pg.query(
    `INSERT INTO product_images (product_id, r2_key, cdn_url, embedding, p_hash, is_primary)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, product_id, r2_key, cdn_url, p_hash, is_primary, created_at`,
    [productId, key, cdnUrl, embedding, pHash, isPrimary]
  );

  const image = result.rows[0] as ProductImage;

  // If primary, update the product record
  if (isPrimary) {
    await pg.query(
      `UPDATE products SET primary_image_id = $1, image_cdn = $2 WHERE id = $3`,
      [image.id, cdnUrl, productId]
    );
  }

  // Sync OpenSearch
  await updateProductIndex(productId);

  return { image, embedding };
}

/**
 * Upload an image from URL and attach to product
 */
export async function uploadProductImageFromUrl(
  productId: number,
  imageUrl: string,
  options: UploadOptions = {}
): Promise<UploadImageResult> {
  const { buffer, contentType } = await fetchImageFromUrl(imageUrl);
  return uploadProductImage(productId, buffer, { ...options, contentType });
}

/**
 * Get all images for a product
 */
export async function getProductImages(productId: number): Promise<ProductImage[]> {
  const result = await pg.query(
    `SELECT id, product_id, r2_key, cdn_url, p_hash, is_primary, created_at
     FROM product_images WHERE product_id = $1
     ORDER BY is_primary DESC, created_at ASC`,
    [productId]
  );
  return result.rows;
}

/**
 * Set an image as the primary image for a product
 */
export async function setPrimaryImage(productId: number, imageId: number): Promise<boolean> {
  // Verify image belongs to product
  const imageCheck = await pg.query(
    `SELECT cdn_url FROM product_images WHERE id = $1 AND product_id = $2`,
    [imageId, productId]
  );
  if (imageCheck.rowCount === 0) return false;

  // Transaction: unset old primary, set new primary, update product
  await pg.query(`UPDATE product_images SET is_primary = false WHERE product_id = $1`, [productId]);
  await pg.query(`UPDATE product_images SET is_primary = true WHERE id = $1`, [imageId]);
  await pg.query(
    `UPDATE products SET primary_image_id = $1, image_cdn = $2 WHERE id = $3`,
    [imageId, imageCheck.rows[0].cdn_url, productId]
  );

  await updateProductIndex(productId);
  return true;
}

/**
 * Delete a product image
 */
export async function deleteProductImage(productId: number, imageId: number): Promise<boolean> {
  const result = await pg.query(
    `DELETE FROM product_images WHERE id = $1 AND product_id = $2 RETURNING is_primary`,
    [imageId, productId]
  );

  if (result.rowCount === 0) return false;

  const wasPrimary = result.rows[0].is_primary;

  if (wasPrimary) {
    // Promote next image to primary, or clear if none left
    const nextImage = await pg.query(
      `SELECT id, cdn_url FROM product_images WHERE product_id = $1 ORDER BY created_at ASC LIMIT 1`,
      [productId]
    );

    if (nextImage.rows[0]) {
      await pg.query(`UPDATE product_images SET is_primary = true WHERE id = $1`, [nextImage.rows[0].id]);
      await pg.query(
        `UPDATE products SET primary_image_id = $1, image_cdn = $2 WHERE id = $3`,
        [nextImage.rows[0].id, nextImage.rows[0].cdn_url, productId]
      );
    } else {
      await pg.query(
        `UPDATE products SET primary_image_id = NULL, image_cdn = NULL WHERE id = $1`,
        [productId]
      );
    }
  }

  await updateProductIndex(productId);
  return true;
}

// ============================================================================
// OpenSearch Sync
// ============================================================================

/**
 * Update product document in OpenSearch with current images
 */
export async function updateProductIndex(productId: number): Promise<void> {
  const productResult = await pg.query(
    `SELECT id, vendor_id, title, brand, category, price_cents, availability, last_seen, image_cdn
     FROM products WHERE id = $1`,
    [productId]
  );

  if (productResult.rowCount === 0) return;

  const product = productResult.rows[0];

  const imagesResult = await pg.query(
    `SELECT id, r2_key, cdn_url, embedding, p_hash, is_primary
     FROM product_images WHERE product_id = $1
     ORDER BY is_primary DESC, created_at ASC`,
    [productId]
  );

  const images = imagesResult.rows;
  let primaryImage = images.find((img: any) => img.is_primary) || images[0];

  const doc: any = {
    product_id: String(productId),
    vendor_id: String(product.vendor_id),
    title: product.title,
    brand: product.brand,
    category: product.category,
    price_usd: product.price_cents ? Math.round(product.price_cents / 100) : 0,
    availability: product.availability ? "in_stock" : "out_of_stock",
    image_cdn: product.image_cdn,
    images: images.map((img: any) => ({
      url: img.cdn_url,
      p_hash: img.p_hash,
      is_primary: img.is_primary,
    })),
    last_seen_at: product.last_seen,
  };

  if (primaryImage?.embedding?.length > 0) {
    doc.embedding = primaryImage.embedding;
  } else if (primaryImage) {
    // Attempt to backfill missing embedding by computing it now
    try {
      // Prefer fetching from public CDN URL; fallback to R2 if needed
      let buffer: Buffer | null = null;
      if (primaryImage.cdn_url) {
        try {
          const res = await fetch(primaryImage.cdn_url, { signal: AbortSignal.timeout(20000) });
          if (res.ok) {
            buffer = Buffer.from(await res.arrayBuffer());
          }
        } catch {}
      }

      if (!buffer && primaryImage.r2_key) {
        try {
          const { r2Client } = await import("../../lib/image/r2");
          const { GetObjectCommand } = await import("@aws-sdk/client-s3");
          const resp: any = await r2Client.send(new GetObjectCommand({ Bucket: config.r2.bucket, Key: primaryImage.r2_key }));
          const chunks: Uint8Array[] = [];
          await new Promise<void>((resolve, reject) => {
            resp.Body.on("data", (chunk: Uint8Array) => chunks.push(chunk));
            resp.Body.on("end", () => resolve());
            resp.Body.on("error", (err: any) => reject(err));
          });
          buffer = Buffer.concat(chunks);
        } catch {}
      }

      if (buffer) {
        const { processImageForEmbedding } = await import("../../lib/image/processor");
        const embedding = await processImageForEmbedding(buffer);
        // Update DB for this image row and include in document
        await pg.query(
          `UPDATE product_images SET embedding = $1 WHERE id = $2`,
          [embedding, primaryImage.id]
        );
        doc.embedding = embedding;
        // Refresh local variable for any further usage
        primaryImage = { ...primaryImage, embedding };
      }
    } catch (err) {
      console.warn(`[updateProductIndex] Failed to backfill embedding for product ${productId}:`, err);
    }
  }

  await osClient.index({
    index: config.opensearch.index,
    id: String(productId),
    body: doc,
    refresh: true,
  });
}

// ============================================================================
// Bulk Operations
// ============================================================================

/**
 * Get images for multiple products (bulk fetch)
 */
export async function getImagesForProducts(productIds: number[]): Promise<Map<number, ProductImage[]>> {
  if (productIds.length === 0) return new Map();

  const result = await pg.query(
    `SELECT id, product_id, r2_key, cdn_url, p_hash, is_primary, created_at
     FROM product_images WHERE product_id = ANY($1)
     ORDER BY product_id, is_primary DESC, created_at ASC`,
    [productIds]
  );

  const imageMap = new Map<number, ProductImage[]>();
  for (const row of result.rows) {
    const images = imageMap.get(row.product_id) || [];
    images.push(row);
    imageMap.set(row.product_id, images);
  }

  return imageMap;
}
