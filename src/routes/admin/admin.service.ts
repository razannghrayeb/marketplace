/**
 * Admin Service
 * 
 * Business logic for admin operations: product moderation, canonical management
 */
import { pg } from "../../lib/core";
import { mergeCanonicals, getCanonicalWithProducts, findSimilarByPHash } from "../../lib/products";
import { triggerJob, getScheduleInfo, getQueueMetrics } from "../../lib/scheduler";

// ============================================================================
// Types
// ============================================================================

export interface ProductFlag {
  product_id: number;
  is_flagged: boolean;
  flag_reason: string | null;
  is_hidden: boolean;
}

export interface CanonicalInfo {
  id: number;
  title: string;
  brand: string | null;
  category: string | null;
  product_count: number;
  min_price_cents: number | null;
  max_price_cents: number | null;
  avg_price_cents: number | null;
  representative_image_url: string | null;
  products: Array<{
    id: number;
    title: string;
    price_cents: number;
    source: string;
    is_hidden: boolean;
    is_flagged: boolean;
  }>;
}

// ============================================================================
// Product Moderation
// ============================================================================

/**
 * Hide a product (remove from search results)
 */
export async function hideProduct(productId: number, reason?: string): Promise<void> {
  await pg.query(
    `UPDATE products SET is_hidden = true, flag_reason = COALESCE($2, flag_reason), updated_at = NOW()
     WHERE id = $1`,
    [productId, reason]
  );
}

/**
 * Unhide a product (restore to search results)
 */
export async function unhideProduct(productId: number): Promise<void> {
  await pg.query(
    `UPDATE products SET is_hidden = false, updated_at = NOW() WHERE id = $1`,
    [productId]
  );
}

/**
 * Flag a product for review
 */
export async function flagProduct(productId: number, reason: string): Promise<void> {
  await pg.query(
    `UPDATE products SET is_flagged = true, flag_reason = $2, updated_at = NOW() WHERE id = $1`,
    [productId, reason]
  );
}

/**
 * Clear flag from product
 */
export async function unflagProduct(productId: number): Promise<void> {
  await pg.query(
    `UPDATE products SET is_flagged = false, flag_reason = NULL, updated_at = NOW() WHERE id = $1`,
    [productId]
  );
}

/**
 * Batch hide multiple products
 */
export async function hideProductsBatch(productIds: number[], reason?: string): Promise<number> {
  const result = await pg.query(
    `UPDATE products SET is_hidden = true, flag_reason = COALESCE($2, flag_reason), updated_at = NOW()
     WHERE id = ANY($1)`,
    [productIds, reason]
  );
  return result.rowCount ?? 0;
}

/**
 * Get all flagged products
 */
export async function getFlaggedProducts(options: { 
  page?: number; 
  limit?: number;
  includeHidden?: boolean;
}): Promise<{ products: any[]; total: number }> {
  const { page = 1, limit = 50, includeHidden = true } = options;
  const offset = (page - 1) * limit;

  const hiddenClause = includeHidden ? "" : "AND is_hidden = false";

  const [countResult, productsResult] = await Promise.all([
    pg.query(`SELECT COUNT(*) FROM products WHERE is_flagged = true ${hiddenClause}`),
    pg.query(
      `SELECT id, title, brand, category, price_cents, source, is_hidden, flag_reason, created_at
       FROM products 
       WHERE is_flagged = true ${hiddenClause}
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    ),
  ]);

  return {
    products: productsResult.rows,
    total: parseInt(countResult.rows[0].count),
  };
}

/**
 * Get hidden products
 */
export async function getHiddenProducts(options: { 
  page?: number; 
  limit?: number;
}): Promise<{ products: any[]; total: number }> {
  const { page = 1, limit = 50 } = options;
  const offset = (page - 1) * limit;

  const [countResult, productsResult] = await Promise.all([
    pg.query(`SELECT COUNT(*) FROM products WHERE is_hidden = true`),
    pg.query(
      `SELECT id, title, brand, category, price_cents, source, flag_reason, updated_at
       FROM products 
       WHERE is_hidden = true
       ORDER BY updated_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    ),
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
export async function getCanonical(canonicalId: number): Promise<CanonicalInfo | null> {
  const result = await getCanonicalWithProducts(canonicalId);
  if (!result) return null;

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
    products: products.map((p: any) => ({
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
export async function listCanonicals(options: {
  page?: number;
  limit?: number;
  sortBy?: "product_count" | "created_at" | "avg_price_cents";
  sortOrder?: "asc" | "desc";
}): Promise<{ canonicals: any[]; total: number }> {
  const { page = 1, limit = 50, sortBy = "product_count", sortOrder = "desc" } = options;
  const offset = (page - 1) * limit;

  const [countResult, canonicalsResult] = await Promise.all([
    pg.query(`SELECT COUNT(*) FROM canonical_products`),
    pg.query(
      `SELECT * FROM canonical_products
       ORDER BY ${sortBy} ${sortOrder}
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    ),
  ]);

  return {
    canonicals: canonicalsResult.rows,
    total: parseInt(countResult.rows[0].count),
  };
}

/**
 * Merge two canonicals together
 */
export async function mergeCanonicalGroups(
  sourceCanonicalId: number,
  targetCanonicalId: number
): Promise<{ merged: boolean; newProductCount: number }> {
  const result = await mergeCanonicals(targetCanonicalId, [sourceCanonicalId]);
  return { merged: true, newProductCount: result.products_moved };
}

/**
 * Remove a product from its canonical group
 */
export async function detachFromCanonical(productId: number): Promise<void> {
  // Get current canonical
  const productResult = await pg.query(
    `SELECT canonical_id FROM products WHERE id = $1`,
    [productId]
  );

  const canonicalId = productResult.rows[0]?.canonical_id;
  if (!canonicalId) return;

  // Remove from canonical
  await pg.query(
    `UPDATE products SET canonical_id = NULL WHERE id = $1`,
    [productId]
  );

  // Update canonical stats
  await pg.query(
    `UPDATE canonical_products 
     SET product_count = product_count - 1,
         updated_at = NOW()
     WHERE id = $1`,
    [canonicalId]
  );

  // If canonical is now empty, delete it
  await pg.query(
    `DELETE FROM canonical_products WHERE id = $1 AND product_count <= 0`,
    [canonicalId]
  );
}

/**
 * Find potential duplicates for a product
 */
export async function findDuplicates(productId: number): Promise<any[]> {
  // Get product details
  const productResult = await pg.query(
    `SELECT p.id, p.title, p.brand, p.category, pi.p_hash
     FROM products p
     LEFT JOIN product_images pi ON pi.product_id = p.id
     WHERE p.id = $1`,
    [productId]
  );

  if (productResult.rowCount === 0) return [];

  const product = productResult.rows[0];

  if (product.p_hash) {
    return findSimilarByPHash(product.p_hash, 10, productId);
  }

  // Fallback: text similarity search
  const similarResult = await pg.query(
    `SELECT id, title, brand, category, price_cents, source
     FROM products
     WHERE id != $1
       AND (
         (brand IS NOT NULL AND brand = $2)
         OR LOWER(title) LIKE LOWER($3)
       )
     LIMIT 20`,
    [productId, product.brand, `%${product.title.split(" ").slice(0, 3).join("%")}%`]
  );

  return similarResult.rows;
}

// ============================================================================
// Job Management
// ============================================================================

/**
 * Trigger a scheduled job manually
 */
export async function runJob(jobType: string): Promise<{ jobId: string }> {
  const job = await triggerJob(jobType as any);
  return { jobId: job.id! };
}

/**
 * Get job schedule information
 */
export async function getSchedules(): Promise<any[]> {
  return getScheduleInfo();
}

/**
 * Get queue metrics
 */
export async function getJobQueueMetrics(): Promise<any> {
  return getQueueMetrics();
}

/**
 * Get recent job history
 */
export async function getJobHistory(options: {
  limit?: number;
  jobType?: string;
}): Promise<any[]> {
  const { limit = 50, jobType } = options;

  const typeClause = jobType ? `WHERE job_type = $2` : "";
  const params = jobType ? [limit, jobType] : [limit];

  const result = await pg.query(
    `SELECT * FROM job_schedules
     ${typeClause}
     ORDER BY started_at DESC
     LIMIT $1`,
    params
  );

  return result.rows;
}

// ============================================================================
// Statistics
// ============================================================================

/**
 * Get admin dashboard stats
 */
export async function getDashboardStats(): Promise<{
  totalProducts: number;
  hiddenProducts: number;
  flaggedProducts: number;
  totalCanonicals: number;
  productsWithoutCanonical: number;
  priceRecordsToday: number;
}> {
  const result = await pg.query(`
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

// ============================================================================
// Recommendation Labeling
// ============================================================================

// Re-export from recommendations library for admin use
export {
  getRecommendationsForLabeling,
  saveLabel,
  saveLabelsBatch,
  getLabeledData,
  getLabelStats,
  getImpressionStats,
  type LabelData,
  type RecommendationWithLabel,
} from "../../lib/recommendations";

/**
 * Get base product with similar recommendations for labeling
 * Uses getCandidateScoresForProducts if no existing impressions
 */
export async function getProductWithRecommendations(
  baseProductId: number,
  limit: number = 20
): Promise<{
  baseProduct: any;
  recommendations: any[];
  source: "impressions" | "generated";
}> {
  // First check if we have existing impressions for this product
  const existingRes = await pg.query(
    `SELECT COUNT(*) as count FROM recommendation_impressions WHERE base_product_id = $1`,
    [baseProductId]
  );
  
  const hasExistingImpressions = parseInt(existingRes.rows[0].count) > 0;
  
  // Fetch base product
  const baseRes = await pg.query(`
    SELECT id, title, brand, category, price_cents, currency,
           COALESCE(image_cdn, image_url) as image
    FROM products WHERE id = $1
  `, [baseProductId]);
  
  if (baseRes.rows.length === 0) {
    throw new Error(`Product ${baseProductId} not found`);
  }
  
  const baseProduct = baseRes.rows[0];
  
  if (hasExistingImpressions) {
    // Use existing impressions with their labels
    const { getRecommendationsForLabeling } = await import("../../lib/recommendations");
    const recommendations = await getRecommendationsForLabeling(baseProductId, limit);
    
    return {
      baseProduct,
      recommendations,
      source: "impressions",
    };
  } else {
    // Generate new recommendations using candidate generator
    const { getCandidateScoresForProducts } = await import("../products/products.service");
    const { logImpressionBatch } = await import("../../lib/recommendations");
    
    const result = await getCandidateScoresForProducts({
      baseProductId: String(baseProductId),
      limit,
      clipLimit: 100,
      textLimit: 100,
    });
    
    // Log these as impressions for future use
    if (result.candidates.length > 0) {
      const impressions = result.candidates.map((c, idx) => ({
        baseProductId,
        candidateProductId: parseInt(c.candidateId),
        position: idx + 1,
        candidateScore: c.clipSim * 0.6 + c.textSim * 0.4,
        clipSim: c.clipSim,
        textSim: c.textSim,
        opensearchScore: c.opensearchScore,
        pHashDist: c.pHashDist,
        categoryPair: `${baseProduct.category || "unknown"}->${c.product.category || "unknown"}`,
        priceRatio: c.product.price_cents / (baseProduct.price_cents || 1),
        sameBrand: c.product.brand?.toLowerCase() === baseProduct.brand?.toLowerCase(),
        matchReasons: [],
        source: c.source as "clip" | "text" | "both",
        context: "admin_label_generated",
      }));
      
      await logImpressionBatch({ baseProductId, impressions, context: "admin_label_generated" });
    }
    
    // Format for response
    const recommendations = result.candidates.map((c, idx) => ({
      impressionId: null,  // Will be set after refresh
      requestId: null,
      baseProductId,
      candidateProductId: parseInt(c.candidateId),
      position: idx + 1,
      candidateScore: c.clipSim * 0.6 + c.textSim * 0.4,
      clipSim: c.clipSim,
      textSim: c.textSim,
      opensearchScore: c.opensearchScore,
      pHashDist: c.pHashDist,
      styleScore: null,
      colorScore: null,
      finalMatchScore: null,
      categoryPair: `${baseProduct.category || "unknown"}->${c.product.category || "unknown"}`,
      priceRatio: c.product.price_cents / (baseProduct.price_cents || 1),
      matchReasons: [],
      source: c.source,
      context: "admin_label_generated",
      createdAt: new Date(),
      baseProduct: {
        id: baseProduct.id,
        title: baseProduct.title,
        brand: baseProduct.brand,
        category: baseProduct.category,
        priceCents: baseProduct.price_cents,
        image: baseProduct.image,
      },
      candidateProduct: {
        id: c.product.id,
        title: c.product.title,
        brand: c.product.brand,
        category: c.product.category,
        priceCents: c.product.price_cents,
        image: c.product.image_cdn || c.product.image_url,
      },
      label: null,
    }));
    
    return {
      baseProduct,
      recommendations,
      source: "generated",
    };
  }
}

