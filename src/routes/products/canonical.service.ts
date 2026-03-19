/**
 * Canonical Products Service
 * 
 * Handles product deduplication and canonical grouping using:
 * - pHash similarity (perceptual image hashing)
 * - Title similarity (Levenshtein distance)
 * - Brand + Category matching
 */
import { pg, productsTableHasIsHiddenColumn } from "../../lib/core";

// ============================================================================
// Types
// ============================================================================

export interface CanonicalProduct {
  id: number;
  title: string;
  brand: string | null;
  category: string | null;
  representative_image_url: string | null;
  representative_p_hash: string | null;
  product_count: number;
  min_price_cents: number | null;
  max_price_cents: number | null;
  avg_price_cents: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface CanonicalMatch {
  canonical_id: number;
  score: number;
  match_type: "phash" | "title" | "brand_category";
}

// ============================================================================
// pHash Similarity
// ============================================================================

/**
 * Calculate Hamming distance between two hex pHash strings
 * Lower = more similar (0 = identical)
 */
export function hammingDistance(hash1: string, hash2: string): number {
  if (!hash1 || !hash2 || hash1.length !== hash2.length) return 64; // Max distance

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
export function isPHashSimilar(hash1: string, hash2: string, threshold = 10): boolean {
  return hammingDistance(hash1, hash2) <= threshold;
}

// ============================================================================
// Title Similarity
// ============================================================================

/**
 * Levenshtein distance between two strings
 */
export function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();

  for (let i = 0; i <= bLower.length; i++) matrix[i] = [i];
  for (let j = 0; j <= aLower.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= bLower.length; i++) {
    for (let j = 1; j <= aLower.length; j++) {
      if (bLower[i - 1] === aLower[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[bLower.length][aLower.length];
}

/**
 * Calculate title similarity as a percentage (0-100)
 */
export function titleSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 100;
  const distance = levenshteinDistance(a, b);
  return Math.round((1 - distance / maxLen) * 100);
}

/**
 * Normalize title for comparison (remove common words, lowercase)
 */
export function normalizeTitle(title: string): string {
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
export async function findMatchingCanonical(product: {
  title: string;
  brand?: string | null;
  category?: string | null;
  p_hash?: string | null;
}): Promise<CanonicalMatch | null> {
  const matches: CanonicalMatch[] = [];

  // 1. pHash match (highest confidence)
  if (product.p_hash) {
    const pHashCandidates = await pg.query(
      `SELECT id, representative_p_hash FROM canonical_products 
       WHERE representative_p_hash IS NOT NULL`,
    );

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
    const titleCandidates = await pg.query(
      `SELECT id, title FROM canonical_products WHERE brand = $1`,
      [product.brand]
    );

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
    const categoryMatches = await pg.query(
      `SELECT id, title FROM canonical_products WHERE brand = $1 AND category = $2`,
      [product.brand, product.category]
    );

    const normalizedProductTitle = normalizeTitle(product.title);
    for (const row of categoryMatches.rows) {
      const similarity = titleSimilarity(normalizedProductTitle, normalizeTitle(row.title));
      if (similarity >= 70) {
        matches.push({ canonical_id: row.id, score: similarity * 0.8, match_type: "brand_category" });
      }
    }
  }

  // Return best match (highest score)
  if (matches.length === 0) return null;
  matches.sort((a, b) => b.score - a.score);
  return matches[0];
}

/**
 * Create a new canonical from a product
 */
export async function createCanonical(product: {
  id: number;
  title: string;
  brand?: string | null;
  category?: string | null;
  p_hash?: string | null;
  image_cdn?: string | null;
  price_cents?: number | null;
}): Promise<number> {
  const result = await pg.query(
    `INSERT INTO canonical_products 
     (title, brand, category, representative_image_url, representative_p_hash, product_count, min_price_cents, max_price_cents, avg_price_cents)
     VALUES ($1, $2, $3, $4, $5, 1, $6, $6, $6)
     RETURNING id`,
    [product.title, product.brand, product.category, product.image_cdn, product.p_hash, product.price_cents]
  );

  const canonicalId = result.rows[0].id;

  // Link product to canonical
  await pg.query(`UPDATE products SET canonical_id = $1 WHERE id = $2`, [canonicalId, product.id]);

  return canonicalId;
}

/**
 * Attach a product to an existing canonical
 */
export async function attachToCanonical(productId: number, canonicalId: number): Promise<void> {
  // Update product
  await pg.query(`UPDATE products SET canonical_id = $1 WHERE id = $2`, [canonicalId, productId]);

  // Update canonical stats
  await updateCanonicalStats(canonicalId);
}

/**
 * Update canonical statistics (product count, price range)
 */
export async function updateCanonicalStats(canonicalId: number): Promise<void> {
  await pg.query(
    `UPDATE canonical_products c SET
       product_count = (SELECT COUNT(*) FROM products WHERE canonical_id = $1 AND is_hidden = false),
       min_price_cents = (SELECT MIN(price_cents) FROM products WHERE canonical_id = $1 AND is_hidden = false),
       max_price_cents = (SELECT MAX(price_cents) FROM products WHERE canonical_id = $1 AND is_hidden = false),
       avg_price_cents = (SELECT AVG(price_cents)::INTEGER FROM products WHERE canonical_id = $1 AND is_hidden = false),
       updated_at = NOW()
     WHERE id = $1`,
    [canonicalId]
  );
}

/**
 * Process a single product: find or create canonical and attach
 */
export async function processProductCanonical(productId: number): Promise<{
  canonical_id: number;
  is_new: boolean;
  match_type?: string;
}> {
  // Get product data
  const productResult = await pg.query(
    `SELECT id, title, brand, category, p_hash, image_cdn, price_cents, canonical_id
     FROM products WHERE id = $1`,
    [productId]
  );

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
export async function recomputeAllCanonicals(): Promise<{
  processed: number;
  new_canonicals: number;
  attached: number;
}> {
  let processed = 0;
  let newCanonicals = 0;
  let attached = 0;

  // Get all products without canonical
  const products = await pg.query(
    `SELECT id FROM products WHERE canonical_id IS NULL AND is_hidden = false`
  );

  for (const row of products.rows) {
    try {
      const result = await processProductCanonical(row.id);
      processed++;
      if (result.is_new) newCanonicals++;
      else attached++;
    } catch (err) {
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
export async function mergeCanonicals(
  targetCanonicalId: number,
  sourceCanonicalIds: number[]
): Promise<{ products_moved: number }> {
  let productsMoved = 0;

  for (const sourceId of sourceCanonicalIds) {
    if (sourceId === targetCanonicalId) continue;

    // Move products from source to target
    const result = await pg.query(
      `UPDATE products SET canonical_id = $1 WHERE canonical_id = $2`,
      [targetCanonicalId, sourceId]
    );
    productsMoved += result.rowCount ?? 0;

    // Delete source canonical
    await pg.query(`DELETE FROM canonical_products WHERE id = $1`, [sourceId]);
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
export async function getCanonicalWithProducts(canonicalId: number): Promise<{
  canonical: CanonicalProduct;
  products: any[];
} | null> {
  const canonicalResult = await pg.query(
    `SELECT * FROM canonical_products WHERE id = $1`,
    [canonicalId]
  );

  if (canonicalResult.rowCount === 0) return null;

  const productsResult = await pg.query(
    `SELECT p.*, v.name as vendor_name
     FROM products p
     LEFT JOIN vendors v ON v.id = p.vendor_id
     WHERE p.canonical_id = $1 AND p.is_hidden = false
     ORDER BY p.price_cents ASC`,
    [canonicalId]
  );

  return {
    canonical: canonicalResult.rows[0],
    products: productsResult.rows,
  };
}

/**
 * Find similar products by pHash
 */
export async function findSimilarByPHash(
  pHash: string,
  threshold = 10,
  limit = 20
): Promise<Array<{ product_id: number; distance: number }>> {
  const hasIsHidden = await productsTableHasIsHiddenColumn();
  const hiddenClause = hasIsHidden ? "AND is_hidden = false" : "";
  const products = await pg.query(
    `SELECT id, p_hash FROM products WHERE p_hash IS NOT NULL ${hiddenClause}`
  );

  const similar: Array<{ product_id: number; distance: number }> = [];

  for (const row of products.rows) {
    const distance = hammingDistance(pHash, row.p_hash);
    if (distance <= threshold) {
      similar.push({ product_id: row.id, distance });
    }
  }

  similar.sort((a, b) => a.distance - b.distance);
  return similar.slice(0, limit);
}
