/**
 * Style Profile Service
 * Computes and maintains user style fingerprints
 */
import { pg, toPgVectorParam } from "../../lib/core";

// ============================================================================
// Types
// ============================================================================

export interface StyleProfile {
  id: number;
  user_id: number;
  category_histogram: Record<string, number>;
  color_palette: Array<{ hex: string; weight: number }>;
  pattern_histogram: Record<string, number>;
  material_histogram: Record<string, number>;
  style_centroid?: number[];
  occasion_coverage: string[];
  season_coverage: string[];
  total_items: number;
  brands_count: number;
  top_brands: Array<{ brand: string; count: number }>;
  version: string;
  computed_at: Date;
  updated_at: Date;
}

export interface StyleProfileStats {
  total_items: number;
  categories: Record<string, number>;
  colors: Record<string, number>;
  patterns: Record<string, number>;
  materials: Record<string, number>;
  brands: Record<string, number>;
  occasions: string[];
  seasons: string[];
}

// ============================================================================
// Style Profile Computation
// ============================================================================

/**
 * Compute or recompute style profile for a user
 */
export async function computeStyleProfile(userId: number): Promise<StyleProfile> {
  // Get all wardrobe items with their attributes
  const itemsResult = await pg.query(
    `SELECT 
       wi.id,
       wi.category_id,
       wi.brand,
       wi.pattern_id,
       wi.material_id,
       wi.dominant_colors,
       wi.embedding,
       c.name as category_name,
       p.name as pattern_name,
       m.name as material_name
     FROM wardrobe_items wi
     LEFT JOIN categories c ON wi.category_id = c.id
     LEFT JOIN patterns p ON wi.pattern_id = p.id
     LEFT JOIN materials m ON wi.material_id = m.id
     WHERE wi.user_id = $1`,
    [userId]
  );

  const items = itemsResult.rows;

  // Compute histograms
  const categoryHistogram: Record<string, number> = {};
  const patternHistogram: Record<string, number> = {};
  const materialHistogram: Record<string, number> = {};
  const brandCounts: Record<string, number> = {};
  const colorCounts: Record<string, number> = {};
  const embeddings: number[][] = [];

  for (const item of items) {
    // Categories
    if (item.category_name) {
      categoryHistogram[item.category_name] = (categoryHistogram[item.category_name] || 0) + 1;
    }

    // Patterns
    if (item.pattern_name) {
      patternHistogram[item.pattern_name] = (patternHistogram[item.pattern_name] || 0) + 1;
    }

    // Materials
    if (item.material_name) {
      materialHistogram[item.material_name] = (materialHistogram[item.material_name] || 0) + 1;
    }

    // Brands
    if (item.brand) {
      brandCounts[item.brand] = (brandCounts[item.brand] || 0) + 1;
    }

    // Colors
    if (item.dominant_colors && Array.isArray(item.dominant_colors)) {
      for (const color of item.dominant_colors) {
        if (color.hex) {
          colorCounts[color.hex] = (colorCounts[color.hex] || 0) + (color.percent || 1);
        }
      }
    }

    // Embeddings for centroid
    if (item.embedding && Array.isArray(item.embedding)) {
      embeddings.push(item.embedding);
    }
  }

  // Compute style centroid (mean of embeddings)
  let styleCentroid: number[] | null = null;
  if (embeddings.length > 0) {
    const dim = embeddings[0].length;
    styleCentroid = new Array(dim).fill(0);
    for (const emb of embeddings) {
      for (let i = 0; i < dim; i++) {
        styleCentroid[i] += emb[i];
      }
    }
    for (let i = 0; i < dim; i++) {
      styleCentroid[i] /= embeddings.length;
    }
    // Normalize
    const norm = Math.sqrt(styleCentroid.reduce((sum, v) => sum + v * v, 0));
    if (norm > 0) {
      styleCentroid = styleCentroid.map(v => v / norm);
    }
  }

  // Build color palette (top colors)
  const totalColorWeight = Object.values(colorCounts).reduce((a, b) => a + b, 0) || 1;
  const colorPalette = Object.entries(colorCounts)
    .map(([hex, count]) => ({ hex, weight: count / totalColorWeight }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 10);

  // Top brands
  const topBrands = Object.entries(brandCounts)
    .map(([brand, count]) => ({ brand, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Get occasion/season coverage
  const occasionResult = await pg.query(
    `SELECT DISTINCT o.name FROM wardrobe_item_occasions wio
     JOIN occasions o ON wio.occasion_id = o.id
     JOIN wardrobe_items wi ON wio.wardrobe_item_id = wi.id
     WHERE wi.user_id = $1`,
    [userId]
  );
  const occasionCoverage = occasionResult.rows.map((r: any) => r.name);

  const seasonResult = await pg.query(
    `SELECT DISTINCT s.name FROM wardrobe_item_seasons wis
     JOIN seasons s ON wis.season_id = s.id
     JOIN wardrobe_items wi ON wis.wardrobe_item_id = wi.id
     WHERE wi.user_id = $1`,
    [userId]
  );
  const seasonCoverage = seasonResult.rows.map((r: any) => r.name);

  // Upsert style profile
  const upsertResult = await pg.query<StyleProfile>(
    `INSERT INTO style_profiles (
       user_id, category_histogram, color_palette, pattern_histogram, material_histogram,
       style_centroid, occasion_coverage, season_coverage, total_items, brands_count,
       top_brands, version, computed_at
     ) VALUES ($1, $2, $3, $4, $5, $6::vector, $7, $8, $9, $10, $11, $12, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       category_histogram = EXCLUDED.category_histogram,
       color_palette = EXCLUDED.color_palette,
       pattern_histogram = EXCLUDED.pattern_histogram,
       material_histogram = EXCLUDED.material_histogram,
       style_centroid = EXCLUDED.style_centroid,
       occasion_coverage = EXCLUDED.occasion_coverage,
       season_coverage = EXCLUDED.season_coverage,
       total_items = EXCLUDED.total_items,
       brands_count = EXCLUDED.brands_count,
       top_brands = EXCLUDED.top_brands,
       version = EXCLUDED.version,
       computed_at = NOW(),
       updated_at = NOW()
     RETURNING *`,
    [
      userId,
      JSON.stringify(categoryHistogram),
      JSON.stringify(colorPalette),
      JSON.stringify(patternHistogram),
      JSON.stringify(materialHistogram),
      toPgVectorParam(styleCentroid),
      occasionCoverage,
      seasonCoverage,
      items.length,
      Object.keys(brandCounts).length,
      JSON.stringify(topBrands),
      "1.0.0"
    ]
  );

  return upsertResult.rows[0];
}

/**
 * Get style profile for user
 */
export async function getStyleProfile(userId: number): Promise<StyleProfile | null> {
  const result = await pg.query<StyleProfile>(
    `SELECT * FROM style_profiles WHERE user_id = $1`,
    [userId]
  );
  return result.rows[0] || null;
}

/**
 * Incrementally update style profile when a new item is added
 */
export async function updateStyleProfileIncremental(
  userId: number,
  newItemId: number
): Promise<void> {
  // For simplicity, just recompute. For production, could do incremental updates.
  await computeStyleProfile(userId);
}

/**
 * Get style compatibility between two users (for social features)
 */
export async function getStyleCompatibility(userIdA: number, userIdB: number): Promise<number> {
  const [profileA, profileB] = await Promise.all([
    getStyleProfile(userIdA),
    getStyleProfile(userIdB)
  ]);

  if (!profileA?.style_centroid || !profileB?.style_centroid) {
    return 0;
  }

  // Cosine similarity between style centroids
  const dot = profileA.style_centroid.reduce(
    (sum, v, i) => sum + v * (profileB.style_centroid![i] || 0),
    0
  );

  return Math.max(0, Math.min(1, dot));
}
