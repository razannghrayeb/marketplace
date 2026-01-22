/**
 * Recommendation Logger Service
 * 
 * Logs recommendation impressions for building training data.
 * Since there's no user data yet, this creates a dataset by logging
 * what's shown so it can be manually labeled later.
 */
import { pg } from "../../lib/core";
import { randomUUID } from "crypto";

// ============================================================================
// Types
// ============================================================================

export interface RecommendationImpression {
  baseProductId: number;
  candidateProductId: number;
  position: number;
  
  // Core similarity scores
  candidateScore?: number;       // Combined weighted score
  clipSim?: number;              // CLIP visual similarity (0-1)
  textSim?: number;              // Text/hybrid similarity (0-1)
  opensearchScore?: number;      // Raw OpenSearch score
  pHashDist?: number;            // Hamming distance (0-64)
  
  // Style matching scores
  styleScore?: number;           // Style compatibility
  colorScore?: number;           // Color harmony score
  finalMatchScore?: number;      // Final combined score
  
  // Context features
  categoryPair?: string;         // "base_cat->candidate_cat"
  priceRatio?: number;           // candidate_price / base_price
  sameBrand?: boolean;
  sameVendor?: boolean;
  
  // Match reasons
  matchReasons?: string[];
  
  // Source tracking
  source: "clip" | "text" | "both" | "outfit";
  context?: string;              // e.g., 'similar_products', 'complete_outfit'
}

export interface LogImpressionBatchParams {
  baseProductId: number;
  impressions: RecommendationImpression[];
  context?: string;
}

export interface LabelData {
  baseProductId: number;
  candidateProductId: number;
  label: "good" | "ok" | "bad";
  labelScore?: number;           // 0-10 optional granular score
  labelerId?: string;
  notes?: string;
  impressionId?: number;         // Link to existing impression
}

export interface LabelQueryParams {
  baseProductId?: number;
  label?: "good" | "ok" | "bad";
  labelerId?: string;
  limit?: number;
  offset?: number;
}

export interface RecommendationWithLabel {
  impressionId: number;
  requestId: string;
  baseProductId: number;
  candidateProductId: number;
  position: number;
  candidateScore: number | null;
  clipSim: number | null;
  textSim: number | null;
  opensearchScore: number | null;
  pHashDist: number | null;
  styleScore: number | null;
  colorScore: number | null;
  finalMatchScore: number | null;
  categoryPair: string | null;
  priceRatio: number | null;
  matchReasons: string[];
  source: string;
  context: string | null;
  createdAt: Date;
  // Product info
  baseProduct: {
    id: number;
    title: string;
    brand: string | null;
    category: string | null;
    priceCents: number;
    image: string | null;
  };
  candidateProduct: {
    id: number;
    title: string;
    brand: string | null;
    category: string | null;
    priceCents: number;
    image: string | null;
  };
  // Label info (if exists)
  label?: {
    id: number;
    label: string;
    labelScore: number | null;
    labelerId: string | null;
    notes: string | null;
    createdAt: Date;
  } | null;
}

// ============================================================================
// Impression Logging
// ============================================================================

/**
 * Log a batch of recommendation impressions
 * Returns the request ID for the batch
 */
export async function logImpressionBatch(
  params: LogImpressionBatchParams
): Promise<string> {
  const { baseProductId, impressions, context } = params;
  
  if (impressions.length === 0) {
    return "";
  }
  
  const requestId = randomUUID();
  
  // Build batch insert values
  const values: any[] = [];
  const placeholders: string[] = [];
  let paramIndex = 1;
  
  for (const imp of impressions) {
    const categoryPair = imp.categoryPair || null;
    
    placeholders.push(`(
      $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++},
      $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++},
      $${paramIndex++}, $${paramIndex++}, $${paramIndex++},
      $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++},
      $${paramIndex++}, $${paramIndex++}, $${paramIndex++}
    )`);
    
    values.push(
      requestId,
      baseProductId,
      imp.candidateProductId,
      imp.position,
      imp.candidateScore ?? null,
      imp.clipSim ?? null,
      imp.textSim ?? null,
      imp.opensearchScore ?? null,
      imp.pHashDist ?? null,
      imp.styleScore ?? null,
      imp.colorScore ?? null,
      imp.finalMatchScore ?? null,
      categoryPair,
      imp.priceRatio ?? null,
      imp.sameBrand ?? false,
      imp.sameVendor ?? false,
      JSON.stringify(imp.matchReasons || []),
      imp.source,
      context || imp.context || null
    );
  }
  
  const query = `
    INSERT INTO recommendation_impressions (
      request_id, base_product_id, candidate_product_id, position,
      candidate_score, clip_sim, text_sim, opensearch_score, p_hash_dist,
      style_score, color_score, final_match_score,
      category_pair, price_ratio, same_brand, same_vendor,
      match_reasons, source, context
    ) VALUES ${placeholders.join(", ")}
    ON CONFLICT (request_id, base_product_id, candidate_product_id) DO NOTHING
  `;
  
  try {
    await pg.query(query, values);
    console.log(`[RecoLogger] Logged ${impressions.length} impressions for base=${baseProductId} requestId=${requestId}`);
  } catch (err) {
    console.error(`[RecoLogger] Failed to log impressions:`, err);
    // Don't throw - logging failures shouldn't break the main flow
  }
  
  return requestId;
}

/**
 * Log a single impression (convenience wrapper)
 */
export async function logImpression(
  impression: RecommendationImpression
): Promise<string> {
  return logImpressionBatch({
    baseProductId: impression.baseProductId,
    impressions: [impression],
    context: impression.context,
  });
}

// ============================================================================
// Label Management
// ============================================================================

/**
 * Save a label for a recommendation pair
 */
export async function saveLabel(data: LabelData): Promise<number> {
  const { 
    baseProductId, 
    candidateProductId, 
    label, 
    labelScore, 
    labelerId, 
    notes,
    impressionId 
  } = data;
  
  const result = await pg.query(`
    INSERT INTO recommendation_labels (
      impression_id, base_product_id, candidate_product_id, 
      label, label_score, labeler_id, notes
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (base_product_id, candidate_product_id, labeler_id) 
    DO UPDATE SET 
      label = EXCLUDED.label,
      label_score = EXCLUDED.label_score,
      notes = EXCLUDED.notes,
      updated_at = NOW()
    RETURNING id
  `, [impressionId, baseProductId, candidateProductId, label, labelScore, labelerId, notes]);
  
  return result.rows[0].id;
}

/**
 * Save multiple labels at once
 */
export async function saveLabelsBatch(labels: LabelData[]): Promise<number> {
  if (labels.length === 0) return 0;
  
  let count = 0;
  for (const label of labels) {
    try {
      await saveLabel(label);
      count++;
    } catch (err) {
      console.error(`[RecoLogger] Failed to save label:`, err);
    }
  }
  return count;
}

/**
 * Get recommendations for labeling (unlabeled first)
 */
export async function getRecommendationsForLabeling(
  baseProductId: number,
  limit: number = 20
): Promise<RecommendationWithLabel[]> {
  const result = await pg.query(`
    SELECT 
      ri.id as impression_id,
      ri.request_id,
      ri.base_product_id,
      ri.candidate_product_id,
      ri.position,
      ri.candidate_score,
      ri.clip_sim,
      ri.text_sim,
      ri.opensearch_score,
      ri.p_hash_dist,
      ri.style_score,
      ri.color_score,
      ri.final_match_score,
      ri.category_pair,
      ri.price_ratio,
      ri.match_reasons,
      ri.source,
      ri.context,
      ri.created_at,
      -- Base product
      bp.id as base_id,
      bp.title as base_title,
      bp.brand as base_brand,
      bp.category as base_category,
      bp.price_cents as base_price,
      COALESCE(bp.image_cdn, bp.image_url) as base_image,
      -- Candidate product
      cp.id as candidate_id,
      cp.title as candidate_title,
      cp.brand as candidate_brand,
      cp.category as candidate_category,
      cp.price_cents as candidate_price,
      COALESCE(cp.image_cdn, cp.image_url) as candidate_image,
      -- Label (if exists)
      rl.id as label_id,
      rl.label,
      rl.label_score,
      rl.labeler_id,
      rl.notes as label_notes,
      rl.created_at as label_created_at
    FROM recommendation_impressions ri
    JOIN products bp ON bp.id = ri.base_product_id
    JOIN products cp ON cp.id = ri.candidate_product_id
    LEFT JOIN recommendation_labels rl ON rl.impression_id = ri.id
    WHERE ri.base_product_id = $1
    ORDER BY rl.id IS NULL DESC, ri.position ASC, ri.created_at DESC
    LIMIT $2
  `, [baseProductId, limit]);
  
  return result.rows.map(formatRecommendationRow);
}

/**
 * Get all labeled data (for training export)
 */
export async function getLabeledData(params: LabelQueryParams = {}): Promise<any[]> {
  const { baseProductId, label, labelerId, limit = 1000, offset = 0 } = params;
  
  const conditions: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;
  
  if (baseProductId) {
    conditions.push(`rl.base_product_id = $${paramIndex++}`);
    values.push(baseProductId);
  }
  if (label) {
    conditions.push(`rl.label = $${paramIndex++}`);
    values.push(label);
  }
  if (labelerId) {
    conditions.push(`rl.labeler_id = $${paramIndex++}`);
    values.push(labelerId);
  }
  
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  
  values.push(limit, offset);
  
  const result = await pg.query(`
    SELECT 
      rl.id,
      rl.impression_id,
      rl.base_product_id,
      rl.candidate_product_id,
      rl.label,
      rl.label_score,
      rl.labeler_id,
      rl.notes,
      rl.created_at,
      -- Impression features (if linked)
      ri.clip_sim,
      ri.text_sim,
      ri.opensearch_score,
      ri.p_hash_dist,
      ri.style_score,
      ri.color_score,
      ri.final_match_score,
      ri.category_pair,
      ri.price_ratio,
      ri.match_reasons,
      ri.source,
      -- Product info
      bp.title as base_title,
      bp.brand as base_brand,
      bp.category as base_category,
      cp.title as candidate_title,
      cp.brand as candidate_brand,
      cp.category as candidate_category
    FROM recommendation_labels rl
    LEFT JOIN recommendation_impressions ri ON ri.id = rl.impression_id
    JOIN products bp ON bp.id = rl.base_product_id
    JOIN products cp ON cp.id = rl.candidate_product_id
    ${whereClause}
    ORDER BY rl.created_at DESC
    LIMIT $${paramIndex++} OFFSET $${paramIndex}
  `, values);
  
  return result.rows;
}

/**
 * Get label stats
 */
export async function getLabelStats(): Promise<{
  total: number;
  byLabel: { label: string; count: number }[];
  byLabeler: { labelerId: string; count: number }[];
  recentLabels: number;
}> {
  const [totalRes, byLabelRes, byLabelerRes, recentRes] = await Promise.all([
    pg.query(`SELECT COUNT(*) as count FROM recommendation_labels`),
    pg.query(`
      SELECT label, COUNT(*) as count 
      FROM recommendation_labels 
      GROUP BY label 
      ORDER BY count DESC
    `),
    pg.query(`
      SELECT COALESCE(labeler_id, 'anonymous') as labeler_id, COUNT(*) as count 
      FROM recommendation_labels 
      GROUP BY labeler_id 
      ORDER BY count DESC
    `),
    pg.query(`
      SELECT COUNT(*) as count 
      FROM recommendation_labels 
      WHERE created_at > NOW() - INTERVAL '7 days'
    `),
  ]);
  
  return {
    total: parseInt(totalRes.rows[0].count),
    byLabel: byLabelRes.rows.map(r => ({ label: r.label, count: parseInt(r.count) })),
    byLabeler: byLabelerRes.rows.map(r => ({ labelerId: r.labeler_id, count: parseInt(r.count) })),
    recentLabels: parseInt(recentRes.rows[0].count),
  };
}

/**
 * Get impression stats
 */
export async function getImpressionStats(): Promise<{
  total: number;
  uniqueRequests: number;
  uniqueBaseProducts: number;
  bySource: { source: string; count: number }[];
  byContext: { context: string; count: number }[];
  recentImpressions: number;
}> {
  const [totalRes, uniqueRes, bySourceRes, byContextRes, recentRes] = await Promise.all([
    pg.query(`SELECT COUNT(*) as count FROM recommendation_impressions`),
    pg.query(`
      SELECT 
        COUNT(DISTINCT request_id) as unique_requests,
        COUNT(DISTINCT base_product_id) as unique_base_products
      FROM recommendation_impressions
    `),
    pg.query(`
      SELECT source, COUNT(*) as count 
      FROM recommendation_impressions 
      GROUP BY source 
      ORDER BY count DESC
    `),
    pg.query(`
      SELECT COALESCE(context, 'unknown') as context, COUNT(*) as count 
      FROM recommendation_impressions 
      GROUP BY context 
      ORDER BY count DESC
    `),
    pg.query(`
      SELECT COUNT(*) as count 
      FROM recommendation_impressions 
      WHERE created_at > NOW() - INTERVAL '7 days'
    `),
  ]);
  
  return {
    total: parseInt(totalRes.rows[0].count),
    uniqueRequests: parseInt(uniqueRes.rows[0].unique_requests || 0),
    uniqueBaseProducts: parseInt(uniqueRes.rows[0].unique_base_products || 0),
    bySource: bySourceRes.rows.map(r => ({ source: r.source, count: parseInt(r.count) })),
    byContext: byContextRes.rows.map(r => ({ context: r.context, count: parseInt(r.count) })),
    recentImpressions: parseInt(recentRes.rows[0].count),
  };
}

// ============================================================================
// Helpers
// ============================================================================

function formatRecommendationRow(row: any): RecommendationWithLabel {
  return {
    impressionId: row.impression_id,
    requestId: row.request_id,
    baseProductId: row.base_product_id,
    candidateProductId: row.candidate_product_id,
    position: row.position,
    candidateScore: row.candidate_score ? parseFloat(row.candidate_score) : null,
    clipSim: row.clip_sim ? parseFloat(row.clip_sim) : null,
    textSim: row.text_sim ? parseFloat(row.text_sim) : null,
    opensearchScore: row.opensearch_score ? parseFloat(row.opensearch_score) : null,
    pHashDist: row.p_hash_dist,
    styleScore: row.style_score ? parseFloat(row.style_score) : null,
    colorScore: row.color_score ? parseFloat(row.color_score) : null,
    finalMatchScore: row.final_match_score ? parseFloat(row.final_match_score) : null,
    categoryPair: row.category_pair,
    priceRatio: row.price_ratio ? parseFloat(row.price_ratio) : null,
    matchReasons: row.match_reasons || [],
    source: row.source,
    context: row.context,
    createdAt: row.created_at,
    baseProduct: {
      id: row.base_id,
      title: row.base_title,
      brand: row.base_brand,
      category: row.base_category,
      priceCents: row.base_price,
      image: row.base_image,
    },
    candidateProduct: {
      id: row.candidate_id,
      title: row.candidate_title,
      brand: row.candidate_brand,
      category: row.candidate_category,
      priceCents: row.candidate_price,
      image: row.candidate_image,
    },
    label: row.label_id ? {
      id: row.label_id,
      label: row.label,
      labelScore: row.label_score,
      labelerId: row.labeler_id,
      notes: row.label_notes,
      createdAt: row.label_created_at,
    } : null,
  };
}

// Export types
export type { RecommendationImpression as ImpressionData };
