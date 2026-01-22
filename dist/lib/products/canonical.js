"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hammingDistance = hammingDistance;
exports.isPHashSimilar = isPHashSimilar;
exports.levenshteinDistance = levenshteinDistance;
exports.titleSimilarity = titleSimilarity;
exports.normalizeTitle = normalizeTitle;
exports.findMatchingCanonical = findMatchingCanonical;
exports.createCanonical = createCanonical;
exports.attachToCanonical = attachToCanonical;
exports.updateCanonicalStats = updateCanonicalStats;
exports.processProductCanonical = processProductCanonical;
exports.recomputeAllCanonicals = recomputeAllCanonicals;
exports.mergeCanonicals = mergeCanonicals;
exports.getCanonicalWithProducts = getCanonicalWithProducts;
exports.findSimilarByPHash = findSimilarByPHash;
/**
 * Canonical Products Service
 *
 * Handles product deduplication and canonical grouping using:
 * - pHash similarity (perceptual image hashing)
 * - Title similarity (Levenshtein distance)
 * - Brand + Category matching
 */
const core_1 = require("../core");
// ============================================================================
// pHash Similarity
// ============================================================================
/**
 * Calculate Hamming distance between two hex pHash strings
 * Lower = more similar (0 = identical)
 */
function hammingDistance(hash1, hash2) {
    if (!hash1 || !hash2 || hash1.length !== hash2.length)
        return 64; // Max distance
    let distance = 0;
    for (let i = 0; i < hash1.length; i++) {
        const b1 = parseInt(hash1[i], 16);
        const b2 = parseInt(hash2[i], 16);
        let xor = b1 ^ b2;
        while (xor) {
            distance += xor & 1;
            xor >>= 1;
        }
    }
    return distance;
}
/**
 * Check if two pHashes are similar (threshold: 10 bits difference out of 64)
 */
function isPHashSimilar(hash1, hash2, threshold = 10) {
    return hammingDistance(hash1, hash2) <= threshold;
}
// ============================================================================
// Title Similarity
// ============================================================================
/**
 * Levenshtein distance between two strings
 */
function levenshteinDistance(a, b) {
    const matrix = [];
    const aLower = a.toLowerCase();
    const bLower = b.toLowerCase();
    for (let i = 0; i <= bLower.length; i++)
        matrix[i] = [i];
    for (let j = 0; j <= aLower.length; j++)
        matrix[0][j] = j;
    for (let i = 1; i <= bLower.length; i++) {
        for (let j = 1; j <= aLower.length; j++) {
            if (bLower[i - 1] === aLower[j - 1]) {
                matrix[i][j] = matrix[i - 1][j - 1];
            }
            else {
                matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
            }
        }
    }
    return matrix[bLower.length][aLower.length];
}
/**
 * Calculate title similarity as a percentage (0-100)
 */
function titleSimilarity(a, b) {
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0)
        return 100;
    const distance = levenshteinDistance(a, b);
    return Math.round((1 - distance / maxLen) * 100);
}
/**
 * Normalize title for comparison (remove common words, lowercase)
 */
function normalizeTitle(title) {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\b(the|a|an|and|or|for|in|on|at|to|of)\b/g, "")
        .replace(/\s+/g, " ")
        .trim();
}
// ============================================================================
// Canonical Matching
// ============================================================================
/**
 * Find matching canonical for a product using heuristics
 */
async function findMatchingCanonical(product) {
    const matches = [];
    // 1. pHash match (highest confidence)
    if (product.p_hash) {
        const pHashCandidates = await core_1.pg.query(`SELECT id, representative_p_hash FROM canonical_products 
       WHERE representative_p_hash IS NOT NULL`);
        for (const row of pHashCandidates.rows) {
            const distance = hammingDistance(product.p_hash, row.representative_p_hash);
            if (distance <= 10) {
                // 10 bits = ~85% similar
                const score = 100 - (distance / 64) * 100;
                matches.push({ canonical_id: row.id, score, match_type: "phash" });
            }
        }
    }
    // 2. Title + Brand match
    if (product.brand) {
        const titleCandidates = await core_1.pg.query(`SELECT id, title FROM canonical_products WHERE brand = $1`, [product.brand]);
        const normalizedProductTitle = normalizeTitle(product.title);
        for (const row of titleCandidates.rows) {
            const similarity = titleSimilarity(normalizedProductTitle, normalizeTitle(row.title));
            if (similarity >= 80) {
                matches.push({ canonical_id: row.id, score: similarity, match_type: "title" });
            }
        }
    }
    // 3. Brand + Category match (lowest confidence, for new canonicals)
    if (product.brand && product.category) {
        const categoryMatches = await core_1.pg.query(`SELECT id, title FROM canonical_products WHERE brand = $1 AND category = $2`, [product.brand, product.category]);
        const normalizedProductTitle = normalizeTitle(product.title);
        for (const row of categoryMatches.rows) {
            const similarity = titleSimilarity(normalizedProductTitle, normalizeTitle(row.title));
            if (similarity >= 70) {
                matches.push({ canonical_id: row.id, score: similarity * 0.8, match_type: "brand_category" });
            }
        }
    }
    // Return best match (highest score)
    if (matches.length === 0)
        return null;
    matches.sort((a, b) => b.score - a.score);
    return matches[0];
}
/**
 * Create a new canonical from a product
 */
async function createCanonical(product) {
    const result = await core_1.pg.query(`INSERT INTO canonical_products 
     (title, brand, category, representative_image_url, representative_p_hash, product_count, min_price_cents, max_price_cents, avg_price_cents)
     VALUES ($1, $2, $3, $4, $5, 1, $6, $6, $6)
     RETURNING id`, [product.title, product.brand, product.category, product.image_cdn, product.p_hash, product.price_cents]);
    const canonicalId = result.rows[0].id;
    // Link product to canonical
    await core_1.pg.query(`UPDATE products SET canonical_id = $1 WHERE id = $2`, [canonicalId, product.id]);
    return canonicalId;
}
/**
 * Attach a product to an existing canonical
 */
async function attachToCanonical(productId, canonicalId) {
    // Update product
    await core_1.pg.query(`UPDATE products SET canonical_id = $1 WHERE id = $2`, [canonicalId, productId]);
    // Update canonical stats
    await updateCanonicalStats(canonicalId);
}
/**
 * Update canonical statistics (product count, price range)
 */
async function updateCanonicalStats(canonicalId) {
    await core_1.pg.query(`UPDATE canonical_products c SET
       product_count = (SELECT COUNT(*) FROM products WHERE canonical_id = $1 AND is_hidden = false),
       min_price_cents = (SELECT MIN(price_cents) FROM products WHERE canonical_id = $1 AND is_hidden = false),
       max_price_cents = (SELECT MAX(price_cents) FROM products WHERE canonical_id = $1 AND is_hidden = false),
       avg_price_cents = (SELECT AVG(price_cents)::INTEGER FROM products WHERE canonical_id = $1 AND is_hidden = false),
       updated_at = NOW()
     WHERE id = $1`, [canonicalId]);
}
/**
 * Process a single product: find or create canonical and attach
 */
async function processProductCanonical(productId) {
    // Get product data
    const productResult = await core_1.pg.query(`SELECT id, title, brand, category, p_hash, image_cdn, price_cents, canonical_id
     FROM products WHERE id = $1`, [productId]);
    if (productResult.rowCount === 0) {
        throw new Error(`Product ${productId} not found`);
    }
    const product = productResult.rows[0];
    // Already has canonical?
    if (product.canonical_id) {
        return { canonical_id: product.canonical_id, is_new: false };
    }
    // Find matching canonical
    const match = await findMatchingCanonical(product);
    if (match && match.score >= 70) {
        await attachToCanonical(productId, match.canonical_id);
        return { canonical_id: match.canonical_id, is_new: false, match_type: match.match_type };
    }
    // Create new canonical
    const canonicalId = await createCanonical(product);
    return { canonical_id: canonicalId, is_new: true };
}
/**
 * Recompute all canonicals (batch job)
 */
async function recomputeAllCanonicals() {
    let processed = 0;
    let newCanonicals = 0;
    let attached = 0;
    // Get all products without canonical
    const products = await core_1.pg.query(`SELECT id FROM products WHERE canonical_id IS NULL AND is_hidden = false`);
    for (const row of products.rows) {
        try {
            const result = await processProductCanonical(row.id);
            processed++;
            if (result.is_new)
                newCanonicals++;
            else
                attached++;
        }
        catch (err) {
            console.error(`Failed to process product ${row.id}:`, err);
        }
    }
    return { processed, new_canonicals: newCanonicals, attached };
}
// ============================================================================
// Merge Canonicals
// ============================================================================
/**
 * Merge multiple canonicals into one (admin action)
 */
async function mergeCanonicals(targetCanonicalId, sourceCanonicalIds) {
    let productsMoved = 0;
    for (const sourceId of sourceCanonicalIds) {
        if (sourceId === targetCanonicalId)
            continue;
        // Move products from source to target
        const result = await core_1.pg.query(`UPDATE products SET canonical_id = $1 WHERE canonical_id = $2`, [targetCanonicalId, sourceId]);
        productsMoved += result.rowCount ?? 0;
        // Delete source canonical
        await core_1.pg.query(`DELETE FROM canonical_products WHERE id = $1`, [sourceId]);
    }
    // Update target stats
    await updateCanonicalStats(targetCanonicalId);
    return { products_moved: productsMoved };
}
// ============================================================================
// Query Helpers
// ============================================================================
/**
 * Get canonical by ID with products
 */
async function getCanonicalWithProducts(canonicalId) {
    const canonicalResult = await core_1.pg.query(`SELECT * FROM canonical_products WHERE id = $1`, [canonicalId]);
    if (canonicalResult.rowCount === 0)
        return null;
    const productsResult = await core_1.pg.query(`SELECT p.*, v.name as vendor_name
     FROM products p
     LEFT JOIN vendors v ON v.id = p.vendor_id
     WHERE p.canonical_id = $1 AND p.is_hidden = false
     ORDER BY p.price_cents ASC`, [canonicalId]);
    return {
        canonical: canonicalResult.rows[0],
        products: productsResult.rows,
    };
}
/**
 * Find similar products by pHash
 */
async function findSimilarByPHash(pHash, threshold = 10, limit = 20) {
    const products = await core_1.pg.query(`SELECT id, p_hash FROM products WHERE p_hash IS NOT NULL AND is_hidden = false`);
    const similar = [];
    for (const row of products.rows) {
        const distance = hammingDistance(pHash, row.p_hash);
        if (distance <= threshold) {
            similar.push({ product_id: row.id, distance });
        }
    }
    similar.sort((a, b) => a.distance - b.distance);
    return similar.slice(0, limit);
}
