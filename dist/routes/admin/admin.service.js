"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hideProduct = hideProduct;
exports.unhideProduct = unhideProduct;
exports.flagProduct = flagProduct;
exports.unflagProduct = unflagProduct;
exports.hideProductsBatch = hideProductsBatch;
exports.getFlaggedProducts = getFlaggedProducts;
exports.getHiddenProducts = getHiddenProducts;
exports.getCanonical = getCanonical;
exports.listCanonicals = listCanonicals;
exports.mergeCanonicalGroups = mergeCanonicalGroups;
exports.detachFromCanonical = detachFromCanonical;
exports.findDuplicates = findDuplicates;
exports.runJob = runJob;
exports.getSchedules = getSchedules;
exports.getJobQueueMetrics = getJobQueueMetrics;
exports.getJobHistory = getJobHistory;
exports.getDashboardStats = getDashboardStats;
/**
 * Admin Service
 *
 * Business logic for admin operations: product moderation, canonical management
 */
const index_js_1 = require("../../lib/core/index.js");
const products_1 = require("../../lib/products");
const scheduler_1 = require("../../lib/scheduler");
// ============================================================================
// Product Moderation
// ============================================================================
/**
 * Hide a product (remove from search results)
 */
async function hideProduct(productId, reason) {
    await index_js_1.pg.query(`UPDATE products SET is_hidden = true, flag_reason = COALESCE($2, flag_reason), updated_at = NOW()
     WHERE id = $1`, [productId, reason]);
}
/**
 * Unhide a product (restore to search results)
 */
async function unhideProduct(productId) {
    await index_js_1.pg.query(`UPDATE products SET is_hidden = false, updated_at = NOW() WHERE id = $1`, [productId]);
}
/**
 * Flag a product for review
 */
async function flagProduct(productId, reason) {
    await index_js_1.pg.query(`UPDATE products SET is_flagged = true, flag_reason = $2, updated_at = NOW() WHERE id = $1`, [productId, reason]);
}
/**
 * Clear flag from product
 */
async function unflagProduct(productId) {
    await index_js_1.pg.query(`UPDATE products SET is_flagged = false, flag_reason = NULL, updated_at = NOW() WHERE id = $1`, [productId]);
}
/**
 * Batch hide multiple products
 */
async function hideProductsBatch(productIds, reason) {
    const result = await index_js_1.pg.query(`UPDATE products SET is_hidden = true, flag_reason = COALESCE($2, flag_reason), updated_at = NOW()
     WHERE id = ANY($1)`, [productIds, reason]);
    return result.rowCount ?? 0;
}
/**
 * Get all flagged products
 */
async function getFlaggedProducts(options) {
    const { page = 1, limit = 50, includeHidden = true } = options;
    const offset = (page - 1) * limit;
    const hiddenClause = includeHidden ? "" : "AND is_hidden = false";
    const [countResult, productsResult] = await Promise.all([
        index_js_1.pg.query(`SELECT COUNT(*) FROM products WHERE is_flagged = true ${hiddenClause}`),
        index_js_1.pg.query(`SELECT id, title, brand, category, price_cents, source, is_hidden, flag_reason, created_at
       FROM products 
       WHERE is_flagged = true ${hiddenClause}
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`, [limit, offset]),
    ]);
    return {
        products: productsResult.rows,
        total: parseInt(countResult.rows[0].count),
    };
}
/**
 * Get hidden products
 */
async function getHiddenProducts(options) {
    const { page = 1, limit = 50 } = options;
    const offset = (page - 1) * limit;
    const [countResult, productsResult] = await Promise.all([
        index_js_1.pg.query(`SELECT COUNT(*) FROM products WHERE is_hidden = true`),
        index_js_1.pg.query(`SELECT id, title, brand, category, price_cents, source, flag_reason, updated_at
       FROM products 
       WHERE is_hidden = true
       ORDER BY updated_at DESC
       LIMIT $1 OFFSET $2`, [limit, offset]),
    ]);
    return {
        products: productsResult.rows,
        total: parseInt(countResult.rows[0].count),
    };
}
// ============================================================================
// Canonical Management
// ============================================================================
/**
 * Get canonical details with all products
 */
async function getCanonical(canonicalId) {
    const result = await (0, products_1.getCanonicalWithProducts)(canonicalId);
    if (!result)
        return null;
    const { canonical, products } = result;
    return {
        id: canonical.id,
        title: canonical.title,
        brand: canonical.brand,
        category: canonical.category,
        product_count: canonical.product_count,
        min_price_cents: canonical.min_price_cents,
        max_price_cents: canonical.max_price_cents,
        avg_price_cents: canonical.avg_price_cents,
        representative_image_url: canonical.representative_image_url,
        products: products.map((p) => ({
            id: p.id,
            title: p.title,
            price_cents: p.price_cents,
            source: p.source || p.vendor_name,
            is_hidden: p.is_hidden,
            is_flagged: p.is_flagged,
        })),
    };
}
/**
 * List all canonicals
 */
async function listCanonicals(options) {
    const { page = 1, limit = 50, sortBy = "product_count", sortOrder = "desc" } = options;
    const offset = (page - 1) * limit;
    const [countResult, canonicalsResult] = await Promise.all([
        index_js_1.pg.query(`SELECT COUNT(*) FROM canonical_products`),
        index_js_1.pg.query(`SELECT * FROM canonical_products
       ORDER BY ${sortBy} ${sortOrder}
       LIMIT $1 OFFSET $2`, [limit, offset]),
    ]);
    return {
        canonicals: canonicalsResult.rows,
        total: parseInt(countResult.rows[0].count),
    };
}
/**
 * Merge two canonicals together
 */
async function mergeCanonicalGroups(sourceCanonicalId, targetCanonicalId) {
    const result = await (0, products_1.mergeCanonicals)(targetCanonicalId, [sourceCanonicalId]);
    return { merged: true, newProductCount: result.products_moved };
}
/**
 * Remove a product from its canonical group
 */
async function detachFromCanonical(productId) {
    // Get current canonical
    const productResult = await index_js_1.pg.query(`SELECT canonical_id FROM products WHERE id = $1`, [productId]);
    const canonicalId = productResult.rows[0]?.canonical_id;
    if (!canonicalId)
        return;
    // Remove from canonical
    await index_js_1.pg.query(`UPDATE products SET canonical_id = NULL WHERE id = $1`, [productId]);
    // Update canonical stats
    await index_js_1.pg.query(`UPDATE canonical_products 
     SET product_count = product_count - 1,
         updated_at = NOW()
     WHERE id = $1`, [canonicalId]);
    // If canonical is now empty, delete it
    await index_js_1.pg.query(`DELETE FROM canonical_products WHERE id = $1 AND product_count <= 0`, [canonicalId]);
}
/**
 * Find potential duplicates for a product
 */
async function findDuplicates(productId) {
    // Get product details
    const productResult = await index_js_1.pg.query(`SELECT p.id, p.title, p.brand, p.category, pi.p_hash
     FROM products p
     LEFT JOIN product_images pi ON pi.product_id = p.id
     WHERE p.id = $1`, [productId]);
    if (productResult.rowCount === 0)
        return [];
    const product = productResult.rows[0];
    if (product.p_hash) {
        return (0, products_1.findSimilarByPHash)(product.p_hash, 10, productId);
    }
    // Fallback: text similarity search
    const similarResult = await index_js_1.pg.query(`SELECT id, title, brand, category, price_cents, source
     FROM products
     WHERE id != $1
       AND (
         (brand IS NOT NULL AND brand = $2)
         OR LOWER(title) LIKE LOWER($3)
       )
     LIMIT 20`, [productId, product.brand, `%${product.title.split(" ").slice(0, 3).join("%")}%`]);
    return similarResult.rows;
}
// ============================================================================
// Job Management
// ============================================================================
/**
 * Trigger a scheduled job manually
 */
async function runJob(jobType) {
    const job = await (0, scheduler_1.triggerJob)(jobType);
    return { jobId: job.id };
}
/**
 * Get job schedule information
 */
async function getSchedules() {
    return (0, scheduler_1.getScheduleInfo)();
}
/**
 * Get queue metrics
 */
async function getJobQueueMetrics() {
    return (0, scheduler_1.getQueueMetrics)();
}
/**
 * Get recent job history
 */
async function getJobHistory(options) {
    const { limit = 50, jobType } = options;
    const typeClause = jobType ? `WHERE job_type = $2` : "";
    const params = jobType ? [limit, jobType] : [limit];
    const result = await index_js_1.pg.query(`SELECT * FROM job_schedules
     ${typeClause}
     ORDER BY started_at DESC
     LIMIT $1`, params);
    return result.rows;
}
// ============================================================================
// Statistics
// ============================================================================
/**
 * Get admin dashboard stats
 */
async function getDashboardStats() {
    const result = await index_js_1.pg.query(`
    SELECT
      (SELECT COUNT(*) FROM products) as total_products,
      (SELECT COUNT(*) FROM products WHERE is_hidden = true) as hidden_products,
      (SELECT COUNT(*) FROM products WHERE is_flagged = true) as flagged_products,
      (SELECT COUNT(*) FROM canonical_products) as total_canonicals,
      (SELECT COUNT(*) FROM products WHERE canonical_id IS NULL) as products_without_canonical,
      (SELECT COUNT(*) FROM price_history WHERE recorded_at > CURRENT_DATE) as price_records_today
  `);
    const row = result.rows[0];
    return {
        totalProducts: parseInt(row.total_products),
        hiddenProducts: parseInt(row.hidden_products),
        flaggedProducts: parseInt(row.flagged_products),
        totalCanonicals: parseInt(row.total_canonicals),
        productsWithoutCanonical: parseInt(row.products_without_canonical),
        priceRecordsToday: parseInt(row.price_records_today),
    };
}
