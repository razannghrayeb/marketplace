/**
 * Product Images Service
 * Handles all image business logic, storage, and retrieval
 */
import {
  pg,
  productsTableHasIsHiddenColumn,
  productsTableHasCanonicalIdColumn,
  productsTableHasGenderColumn,
  toPgVectorParam,
} from "../../lib/core/index";
import { uploadImage, generateImageKey, getYOLOv8Client } from "../../lib/image/index";
import {
  processImageForEmbedding,
  processImageForGarmentEmbedding,
  processImageForGarmentEmbeddingWithOptionalBox,
  pickBestYoloDetectionForGarmentEmbedding,
  scalePixelBoxToImageDims,
  computePHash,
  validateImage,
  blip,
} from "../../lib/image/index";
import { applyBlipCaptionToMissingProductFields } from "../../lib/image/blipCatalogBackfill";
import { osClient } from "../../lib/core/index";
import { config } from "../../config";

/**
 * BLIP caption → fill only empty `products.description`, `color`, `gender` (helps search + listing quality).
 * Runs on primary image upload only; gated by `PRODUCT_IMAGE_BLIP_FILL_MISSING` (default on).
 */
async function maybeBlipBackfillMissingCatalogFields(productId: number, buffer: Buffer): Promise<void> {
  if (!config.search.blipFillMissingOnImageUpload) return;
  try {
    const caption = await Promise.race([
      blip.caption(buffer),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error("blip_timeout")), config.search.blipCaptionTimeoutMs),
      ),
    ]).catch(() => "");
    await applyBlipCaptionToMissingProductFields(productId, caption);
  } catch (e) {
    console.warn("[uploadProductImage] BLIP catalog backfill skipped:", (e as Error).message);
  }
}
import { buildProductSearchDocument } from "../../lib/search/searchDocument";
import { loadProductSearchEnrichmentByIds } from "../../lib/search/loadProductSearchEnrichment";
import { extractGarmentFashionColors } from "../../lib/color/garmentColorPipeline";
import type { PixelBox } from "../../lib/image";
import sharpLib from "sharp";

const sharp = typeof sharpLib === "function" ? sharpLib : (sharpLib as any).default;

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

  const primaryState = await pg.query<{
    has_primary_image: boolean;
    has_product_primary: boolean;
  }>(
    `SELECT
        EXISTS(SELECT 1 FROM product_images WHERE product_id = $1 AND is_primary = true) AS has_primary_image,
        EXISTS(SELECT 1 FROM products WHERE id = $1 AND primary_image_id IS NOT NULL) AS has_product_primary`,
    [productId],
  );
  const hasPrimaryImage = Boolean(primaryState.rows[0]?.has_primary_image);
  const hasProductPrimary = Boolean(primaryState.rows[0]?.has_product_primary);
  const effectiveIsPrimary =
    isPrimary || (!hasPrimaryImage && !hasProductPrimary);

  // Validate image
  const validation = await validateImage(buffer);
  if (!validation.valid) {
    throw new Error(validation.error || "Invalid image");
  }

  // Upload to R2
  const key = generateImageKey(buffer, contentType.includes("png") ? ".png" : ".jpg");
  const { cdnUrl } = await uploadImage(buffer, key, contentType);

  const { prepareBufferForPrimaryCatalogEmbedding } = await import("../../lib/image/embeddingPrep");
  const { buffer: clipBuf } = await prepareBufferForPrimaryCatalogEmbedding(buffer);

  const [embedding, pHash] = await Promise.all([
    processImageForEmbedding(clipBuf),
    computePHash(buffer),
  ]);

  let garmentEmbedding: number[] | null = null;
  try {
    const yolo = getYOLOv8Client();
    if (await yolo.isAvailable()) {
      const res = await yolo.detectFromBuffer(buffer, "catalog-upload.jpg", { confidence: 0.45 });
      const dets = (res.detections ?? []).filter((d) => (d.confidence ?? 0) >= 0.45);
      const best = pickBestYoloDetectionForGarmentEmbedding(dets);
      if (best?.box) {
        const [rawMeta, procMeta] = await Promise.all([sharp(buffer).metadata(), sharp(clipBuf).metadata()]);
        const rw = rawMeta.width ?? 0;
        const rh = rawMeta.height ?? 0;
        const pw = procMeta.width ?? 0;
        const ph = procMeta.height ?? 0;
        let box: PixelBox = {
          x1: best.box.x1,
          y1: best.box.y1,
          x2: best.box.x2,
          y2: best.box.y2,
        };
        if (rw > 0 && rh > 0 && pw > 0 && ph > 0 && (rw !== pw || rh !== ph)) {
          box = scalePixelBoxToImageDims(box, rw, rh, pw, ph);
        }
        const ge = await processImageForGarmentEmbeddingWithOptionalBox(buffer, clipBuf, box);
        if (Array.isArray(ge) && ge.length > 0) garmentEmbedding = ge;
      }
    }
  } catch {
    /* YOLO optional on upload */
  }
  if (!garmentEmbedding || garmentEmbedding.length === 0) {
    garmentEmbedding = await processImageForGarmentEmbedding(clipBuf).catch(() => null);
  }

  // Insert into database
  if (effectiveIsPrimary) {
    await pg.query(`UPDATE product_images SET is_primary = false WHERE product_id = $1`, [productId]);
  }

  const result = await pg.query(
    `INSERT INTO product_images (product_id, r2_key, cdn_url, embedding, p_hash, is_primary)
     VALUES ($1, $2, $3, $4::vector, $5, $6)
     RETURNING id, product_id, r2_key, cdn_url, p_hash, is_primary, created_at`,
    [productId, key, cdnUrl, toPgVectorParam(embedding), pHash, effectiveIsPrimary]
  );

  const image = result.rows[0] as ProductImage;

  // If primary, update the product record
  if (effectiveIsPrimary) {
    await pg.query(
      `UPDATE products SET primary_image_id = $1, image_cdn = $2 WHERE id = $3`,
      [image.id, cdnUrl, productId]
    );
    await maybeBlipBackfillMissingCatalogFields(productId, buffer);
  }

  // Sync OpenSearch (pass both embeddings so embedding_garment is populated)
  await updateProductIndex(productId, buffer, { embedding, garmentEmbedding });

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

export interface UpdateProductIndexOpts {
  embedding?: number[];
  garmentEmbedding?: number[] | null;
}

/**
 * Update product document in OpenSearch with current images
 */
export async function updateProductIndex(productId: number, sourceBuffer?: Buffer, opts?: UpdateProductIndexOpts): Promise<void> {
  const hasIsHidden = await productsTableHasIsHiddenColumn();
  const hasCanonicalId = await productsTableHasCanonicalIdColumn();
  const hasGender = await productsTableHasGenderColumn();
  const productResult = await pg.query(
    `SELECT id, vendor_id, title, description, brand, category, price_cents, availability, last_seen, image_cdn, color,
            parent_product_url, image_url,
            ${hasGender ? "gender" : "NULL::text AS gender"},
            ${hasIsHidden ? "is_hidden" : "false AS is_hidden"},
            ${hasCanonicalId ? "canonical_id" : "NULL::integer AS canonical_id"}
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

  let garmentBox: PixelBox | null = null;
  try {
    if (primaryImage?.id) {
      const det = await pg.query(
        `SELECT box_x1, box_y1, box_x2, box_y2, confidence, area_ratio
         FROM product_image_detections
         WHERE product_image_id = $1
           AND box_x1 IS NOT NULL AND box_y1 IS NOT NULL
           AND box_x2 IS NOT NULL AND box_y2 IS NOT NULL
           AND COALESCE(confidence, 0) >= 0.22
         ORDER BY COALESCE(area_ratio, 0) DESC NULLS LAST, id DESC
         LIMIT 1`,
        [primaryImage.id],
      );
      const r = det.rows[0];
      if (r) {
        const x1 = Number(r.box_x1);
        const y1 = Number(r.box_y1);
        const x2 = Number(r.box_x2);
        const y2 = Number(r.box_y2);
        if (
          Number.isFinite(x1) &&
          Number.isFinite(y1) &&
          Number.isFinite(x2) &&
          Number.isFinite(y2) &&
          x2 > x1 &&
          y2 > y1
        ) {
          garmentBox = { x1, y1, x2, y2 };
        }
      }
    }
  } catch {
    garmentBox = null;
  }

  let garmentColorAnalysis: Awaited<ReturnType<typeof extractGarmentFashionColors>> | null = null;
  if (sourceBuffer && sourceBuffer.length > 0) {
    garmentColorAnalysis = await extractGarmentFashionColors(sourceBuffer).catch(() => null);
  }

  const enrichMap = await loadProductSearchEnrichmentByIds([productId]);
  const enrichRow = enrichMap.get(productId);

  const providedEmbedding = opts?.embedding?.length ? opts.embedding : null;
  const providedGarmentEmbedding = opts?.garmentEmbedding?.length ? opts.garmentEmbedding : null;
  const doc: any = buildProductSearchDocument({
    productId,
    vendorId: product.vendor_id,
    title: product.title,
    description: product.description ?? null,
    catalogColor: product.color ?? null,
    catalogGender: hasGender ? (product.gender ?? null) : null,
    brand: product.brand,
    category: product.category,
    priceCents: product.price_cents,
    availability: Boolean(product.availability),
    isHidden: Boolean(product.is_hidden),
    canonicalId: hasCanonicalId ? product.canonical_id : null,
    parentProductUrl: product.parent_product_url ?? null,
    imageCdn: product.image_cdn,
    pHash: primaryImage?.p_hash ?? null,
    lastSeenAt: product.last_seen,
    images: images.map((img: any) => ({
      url: img.cdn_url,
      p_hash: img.p_hash,
      is_primary: img.is_primary,
    })),
    embedding: providedEmbedding ?? (primaryImage?.embedding?.length > 0 ? primaryImage.embedding : null),
    embeddingGarment: providedGarmentEmbedding,
    detectedColors: garmentColorAnalysis?.paletteCanonical ?? [],
    garmentColorAnalysis,
    enrichment: enrichRow
      ? {
          norm_confidence: enrichRow.norm_confidence,
          category_confidence: enrichRow.category_confidence,
          brand_confidence: enrichRow.brand_confidence,
          canonical_type_ids: enrichRow.canonical_type_ids,
        }
      : null,
  });

  // If dominant colors weren't provided (e.g. only primary image changed),
  // fetch the primary image buffer and derive dominant colors so strict
  // color filters have reliable data.
  if (!garmentColorAnalysis && primaryImage) {
    try {
      let buffer: Buffer | null = null;
      if (primaryImage.cdn_url) {
        try {
          const res = await fetch(primaryImage.cdn_url, { signal: AbortSignal.timeout(20000) });
          if (res.ok) buffer = Buffer.from(await res.arrayBuffer());
        } catch {}
      }

      if (!buffer && primaryImage.r2_key) {
        try {
          const { r2Client } = await import("../../lib/image/r2");
          const { GetObjectCommand } = await import("@aws-sdk/client-s3");
          const resp: any = await r2Client.send(
            new GetObjectCommand({ Bucket: config.r2.bucket, Key: primaryImage.r2_key })
          );
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
        let box: PixelBox | null = null;
        try {
          const det = await pg.query(
            `SELECT box_x1, box_y1, box_x2, box_y2, confidence, area_ratio
             FROM product_image_detections
             WHERE product_image_id = $1
               AND box_x1 IS NOT NULL AND box_y1 IS NOT NULL
               AND box_x2 IS NOT NULL AND box_y2 IS NOT NULL
               AND COALESCE(confidence, 0) >= 0.22
             ORDER BY COALESCE(area_ratio, 0) DESC NULLS LAST, id DESC
             LIMIT 1`,
            [primaryImage.id],
          );
          const r = det.rows[0];
          if (r) {
            const x1 = Number(r.box_x1);
            const y1 = Number(r.box_y1);
            const x2 = Number(r.box_x2);
            const y2 = Number(r.box_y2);
            if (
              Number.isFinite(x1) &&
              Number.isFinite(y1) &&
              Number.isFinite(x2) &&
              Number.isFinite(y2) &&
              x2 > x1 &&
              y2 > y1
            ) {
              box = { x1, y1, x2, y2 };
            }
          }
        } catch {
          box = null;
        }
        const analysis = await extractGarmentFashionColors(buffer, { box }).catch(() => null);
        if (analysis && analysis.paletteCanonical.length > 0) {
          const extractedColors = analysis.paletteCanonical;
          const current = Array.isArray(doc.attr_colors) ? doc.attr_colors.map((c: any) => String(c).toLowerCase()) : [];
          const merged = [...new Set([...current, ...extractedColors.map((c) => String(c).toLowerCase())])];
          doc.attr_colors = merged;
          doc.attr_color = merged[0] ?? null;
          doc.attr_colors_image = extractedColors;
          doc.attr_color_source = "image";
          doc.color_primary_canonical = analysis.primaryCanonical;
          doc.color_secondary_canonical = analysis.secondaryCanonical;
          doc.color_accent_canonical = analysis.accentCanonical;
          doc.color_palette_canonical = analysis.paletteCanonical;
          doc.color_confidence_primary = analysis.confidencePrimary;
          doc.color_confidence_image = Math.max(0.2, Math.min(0.95, analysis.confidencePrimary));
        }
      }
    } catch {
      // Best-effort only; fallback to title-extracted colors.
    }
  }

  const needsEmbeddingBackfill = !doc.embedding && primaryImage;
  const needsGarmentBackfill = !doc.embedding_garment && primaryImage;

  if (needsEmbeddingBackfill || needsGarmentBackfill) {
    // Attempt to backfill missing vectors by computing them now.
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
        const { prepareBufferForPrimaryCatalogEmbedding } = await import("../../lib/image/embeddingPrep");
        const { buffer: clipBuf } = await prepareBufferForPrimaryCatalogEmbedding(buffer);

        const { processImageForEmbedding, processImageForGarmentEmbedding } = await import(
          "../../lib/image/processor"
        );

        // Garment colors from original pixels; CLIP from catalog-aligned buffer (matches search + reindex).
        const [embedding, embeddingGarment, garmentAnalysis] = await Promise.all([
          needsEmbeddingBackfill ? processImageForEmbedding(clipBuf) : Promise.resolve(null as unknown as number[]),
          needsGarmentBackfill
            ? (async () => {
                if (garmentBox) {
                  try {
                    return await processImageForGarmentEmbeddingWithOptionalBox(buffer, clipBuf, garmentBox);
                  } catch {
                    // Fall through to center-crop fallback below.
                  }
                }
                return processImageForGarmentEmbedding(clipBuf).catch(() => null as unknown as number[]);
              })()
            : Promise.resolve(null as unknown as number[]),
          (needsEmbeddingBackfill || needsGarmentBackfill)
            ? extractGarmentFashionColors(buffer, { box: garmentBox }).catch(() => null)
            : Promise.resolve(null),
        ]);
        // Update DB for this image row and include in document.
        if (needsEmbeddingBackfill && Array.isArray(embedding) && embedding.length > 0) {
          await pg.query(
            `UPDATE product_images SET embedding = $1::vector WHERE id = $2`,
            [toPgVectorParam(embedding), primaryImage.id]
          );
          doc.embedding = embedding;
        }
        if (needsGarmentBackfill && Array.isArray(embeddingGarment) && embeddingGarment.length > 0) {
          doc.embedding_garment = embeddingGarment;
        }
        if ((!doc.attr_colors || doc.attr_colors.length === 0) && garmentAnalysis && garmentAnalysis.paletteCanonical.length > 0) {
          const extractedColors = garmentAnalysis.paletteCanonical;
          doc.attr_colors = extractedColors;
          doc.attr_colors_image = extractedColors;
          doc.attr_color = String(extractedColors[0]).toLowerCase();
          doc.attr_color_source = "image";
          doc.color_primary_canonical = garmentAnalysis.primaryCanonical;
          doc.color_secondary_canonical = garmentAnalysis.secondaryCanonical;
          doc.color_accent_canonical = garmentAnalysis.accentCanonical;
          doc.color_palette_canonical = garmentAnalysis.paletteCanonical;
          doc.color_confidence_primary = garmentAnalysis.confidencePrimary;
          doc.color_confidence_image = Math.max(0.2, Math.min(0.95, garmentAnalysis.confidencePrimary));
        }
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
