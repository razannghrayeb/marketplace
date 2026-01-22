"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.productExists = productExists;
exports.fetchImageFromUrl = fetchImageFromUrl;
exports.toImageResponse = toImageResponse;
exports.uploadProductImage = uploadProductImage;
exports.uploadProductImageFromUrl = uploadProductImageFromUrl;
exports.getProductImages = getProductImages;
exports.setPrimaryImage = setPrimaryImage;
exports.deleteProductImage = deleteProductImage;
exports.updateProductIndex = updateProductIndex;
exports.getImagesForProducts = getImagesForProducts;
/**
 * Product Images Service
 * Handles all image business logic, storage, and retrieval
 */
const index_js_1 = require("../../lib/core/index.js");
const index_js_2 = require("../../lib/image/index.js");
const index_js_3 = require("../../lib/image/index.js");
const index_js_4 = require("../../lib/core/index.js");
const config_js_1 = require("../../config.js");
// ============================================================================
// Validation & Helpers
// ============================================================================
/**
 * Check if a product exists
 */
async function productExists(productId) {
    const result = await index_js_1.pg.query("SELECT 1 FROM products WHERE id = $1", [productId]);
    return (result.rowCount ?? 0) > 0;
}
/**
 * Fetch image from URL and return buffer with content type
 */
async function fetchImageFromUrl(url, timeoutMs = 30000) {
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
function toImageResponse(image) {
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
async function uploadProductImage(productId, buffer, options = {}) {
    const { isPrimary = false, contentType = "image/jpeg" } = options;
    // Validate image
    const validation = await (0, index_js_3.validateImage)(buffer);
    if (!validation.valid) {
        throw new Error(validation.error || "Invalid image");
    }
    // Upload to R2
    const key = (0, index_js_2.generateImageKey)(buffer, contentType.includes("png") ? ".png" : ".jpg");
    const { cdnUrl } = await (0, index_js_2.uploadImage)(buffer, key, contentType);
    // Compute embedding and pHash
    const embedding = await (0, index_js_3.processImageForEmbedding)(buffer);
    const pHash = await (0, index_js_3.computePHash)(buffer);
    // Insert into database
    const result = await index_js_1.pg.query(`INSERT INTO product_images (product_id, r2_key, cdn_url, embedding, p_hash, is_primary)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, product_id, r2_key, cdn_url, p_hash, is_primary, created_at`, [productId, key, cdnUrl, embedding, pHash, isPrimary]);
    const image = result.rows[0];
    // If primary, update the product record
    if (isPrimary) {
        await index_js_1.pg.query(`UPDATE products SET primary_image_id = $1, image_cdn = $2 WHERE id = $3`, [image.id, cdnUrl, productId]);
    }
    // Sync OpenSearch
    await updateProductIndex(productId);
    return { image, embedding };
}
/**
 * Upload an image from URL and attach to product
 */
async function uploadProductImageFromUrl(productId, imageUrl, options = {}) {
    const { buffer, contentType } = await fetchImageFromUrl(imageUrl);
    return uploadProductImage(productId, buffer, { ...options, contentType });
}
/**
 * Get all images for a product
 */
async function getProductImages(productId) {
    const result = await index_js_1.pg.query(`SELECT id, product_id, r2_key, cdn_url, p_hash, is_primary, created_at
     FROM product_images WHERE product_id = $1
     ORDER BY is_primary DESC, created_at ASC`, [productId]);
    return result.rows;
}
/**
 * Set an image as the primary image for a product
 */
async function setPrimaryImage(productId, imageId) {
    // Verify image belongs to product
    const imageCheck = await index_js_1.pg.query(`SELECT cdn_url FROM product_images WHERE id = $1 AND product_id = $2`, [imageId, productId]);
    if (imageCheck.rowCount === 0)
        return false;
    // Transaction: unset old primary, set new primary, update product
    await index_js_1.pg.query(`UPDATE product_images SET is_primary = false WHERE product_id = $1`, [productId]);
    await index_js_1.pg.query(`UPDATE product_images SET is_primary = true WHERE id = $1`, [imageId]);
    await index_js_1.pg.query(`UPDATE products SET primary_image_id = $1, image_cdn = $2 WHERE id = $3`, [imageId, imageCheck.rows[0].cdn_url, productId]);
    await updateProductIndex(productId);
    return true;
}
/**
 * Delete a product image
 */
async function deleteProductImage(productId, imageId) {
    const result = await index_js_1.pg.query(`DELETE FROM product_images WHERE id = $1 AND product_id = $2 RETURNING is_primary`, [imageId, productId]);
    if (result.rowCount === 0)
        return false;
    const wasPrimary = result.rows[0].is_primary;
    if (wasPrimary) {
        // Promote next image to primary, or clear if none left
        const nextImage = await index_js_1.pg.query(`SELECT id, cdn_url FROM product_images WHERE product_id = $1 ORDER BY created_at ASC LIMIT 1`, [productId]);
        if (nextImage.rows[0]) {
            await index_js_1.pg.query(`UPDATE product_images SET is_primary = true WHERE id = $1`, [nextImage.rows[0].id]);
            await index_js_1.pg.query(`UPDATE products SET primary_image_id = $1, image_cdn = $2 WHERE id = $3`, [nextImage.rows[0].id, nextImage.rows[0].cdn_url, productId]);
        }
        else {
            await index_js_1.pg.query(`UPDATE products SET primary_image_id = NULL, image_cdn = NULL WHERE id = $1`, [productId]);
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
async function updateProductIndex(productId) {
    const productResult = await index_js_1.pg.query(`SELECT id, vendor_id, title, brand, category, price_cents, availability, last_seen, image_cdn
     FROM products WHERE id = $1`, [productId]);
    if (productResult.rowCount === 0)
        return;
    const product = productResult.rows[0];
    const imagesResult = await index_js_1.pg.query(`SELECT cdn_url, embedding, p_hash, is_primary
     FROM product_images WHERE product_id = $1
     ORDER BY is_primary DESC, created_at ASC`, [productId]);
    const images = imagesResult.rows;
    const primaryImage = images.find((img) => img.is_primary) || images[0];
    const doc = {
        product_id: String(productId),
        vendor_id: String(product.vendor_id),
        title: product.title,
        brand: product.brand,
        category: product.category,
        price_usd: product.price_cents ? Math.round(product.price_cents / 100) : 0,
        availability: product.availability ? "in_stock" : "out_of_stock",
        image_cdn: product.image_cdn,
        images: images.map((img) => ({
            url: img.cdn_url,
            p_hash: img.p_hash,
            is_primary: img.is_primary,
        })),
        last_seen_at: product.last_seen,
    };
    if (primaryImage?.embedding?.length > 0) {
        doc.embedding = primaryImage.embedding;
    }
    await index_js_4.osClient.index({
        index: config_js_1.config.opensearch.index,
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
async function getImagesForProducts(productIds) {
    if (productIds.length === 0)
        return new Map();
    const result = await index_js_1.pg.query(`SELECT id, product_id, r2_key, cdn_url, p_hash, is_primary, created_at
     FROM product_images WHERE product_id = ANY($1)
     ORDER BY product_id, is_primary DESC, created_at ASC`, [productIds]);
    const imageMap = new Map();
    for (const row of result.rows) {
        const images = imageMap.get(row.product_id) || [];
        images.push(row);
        imageMap.set(row.product_id, images);
    }
    return imageMap;
}
