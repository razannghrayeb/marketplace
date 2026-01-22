/**
 * Compatibility Engine Service
 * Computes and caches outfit compatibility scores
 */
import { pg } from "../../lib/core";

// ============================================================================
// Types
// ============================================================================

export interface CompatibilityEdge {
  id: number;
  user_id: number;
  item_a_id: number;
  item_b_id: number;
  score: number;
  color_harmony_score?: number;
  style_similarity_score?: number;
  reasoning?: string;
  computed_at: Date;
}

export interface CompatibilityResult {
  item_a_id: number;
  item_b_id: number;
  score: number;
  factors: {
    color_harmony: number;
    style_match: number;
    occasion_match: number;
    formality_match: number;
  };
  reasoning: string;
}

// ============================================================================
// Color Harmony Rules
// ============================================================================

const COLOR_FAMILIES: Record<string, string[]> = {
  neutral: ["#000000", "#FFFFFF", "#808080", "#36454F", "#F5F5DC", "#D2B48C"],
  blue: ["#000080", "#4169E1", "#ADD8E6", "#008080"],
  red: ["#FF0000", "#800020", "#FF7F50"],
  pink: ["#FFC0CB", "#DE5D83"],
  green: ["#008000", "#808000", "#98FF98", "#228B22"],
  earth: ["#8B4513", "#D2B48C", "#808000"]
};

function getColorFamily(hex: string): string {
  const normalizedHex = hex.toUpperCase();
  for (const [family, colors] of Object.entries(COLOR_FAMILIES)) {
    if (colors.some(c => c.toUpperCase() === normalizedHex)) {
      return family;
    }
  }
  return "other";
}

function computeColorHarmony(colorsA: Array<{ hex: string }>, colorsB: Array<{ hex: string }>): number {
  if (!colorsA?.length || !colorsB?.length) return 0.5;

  const familiesA = new Set(colorsA.map(c => getColorFamily(c.hex)));
  const familiesB = new Set(colorsB.map(c => getColorFamily(c.hex)));

  // Neutrals go with everything
  if (familiesA.has("neutral") || familiesB.has("neutral")) {
    return 0.9;
  }

  // Same family = good
  const intersection = [...familiesA].filter(f => familiesB.has(f));
  if (intersection.length > 0) {
    return 0.85;
  }

  // Complementary pairs
  const complementary: Record<string, string[]> = {
    blue: ["earth", "red"],
    green: ["pink", "red"],
    red: ["blue", "green"]
  };

  for (const famA of familiesA) {
    const comps = complementary[famA] || [];
    for (const famB of familiesB) {
      if (comps.includes(famB)) {
        return 0.75;
      }
    }
  }

  return 0.4;
}

// ============================================================================
// Category Pairing Rules
// ============================================================================

const GOOD_PAIRINGS: Record<string, string[]> = {
  "tops": ["bottoms", "skirts", "outerwear", "accessories"],
  "bottoms": ["tops", "outerwear", "shoes", "accessories"],
  "dresses": ["outerwear", "shoes", "bags", "accessories"],
  "outerwear": ["tops", "bottoms", "dresses", "shoes"],
  "shoes": ["bottoms", "dresses", "outerwear"],
  "bags": ["dresses", "tops", "outerwear"],
  "accessories": ["tops", "bottoms", "dresses", "outerwear"]
};

function getCategoryCompatibility(catA: string, catB: string): number {
  if (catA === catB) return 0.3; // Same category usually not worn together (except accessories)
  
  const goodPairs = GOOD_PAIRINGS[catA] || [];
  if (goodPairs.includes(catB)) {
    return 0.9;
  }

  return 0.5;
}

// ============================================================================
// Main Compatibility Functions
// ============================================================================

/**
 * Compute compatibility between two wardrobe items
 */
export async function computeItemCompatibility(
  userId: number,
  itemAId: number,
  itemBId: number
): Promise<CompatibilityResult> {
  // Ensure canonical ordering
  const [minId, maxId] = itemAId < itemBId ? [itemAId, itemBId] : [itemBId, itemAId];

  // Fetch both items
  const itemsResult = await pg.query(
    `SELECT 
       wi.id, wi.category_id, wi.dominant_colors, wi.embedding,
       c.name as category_name
     FROM wardrobe_items wi
     LEFT JOIN categories c ON wi.category_id = c.id
     WHERE wi.id IN ($1, $2) AND wi.user_id = $3`,
    [minId, maxId, userId]
  );

  if (itemsResult.rows.length < 2) {
    return {
      item_a_id: minId,
      item_b_id: maxId,
      score: 0,
      factors: { color_harmony: 0, style_match: 0, occasion_match: 0, formality_match: 0 },
      reasoning: "One or both items not found"
    };
  }

  const itemA = itemsResult.rows.find((r: any) => r.id === minId);
  const itemB = itemsResult.rows.find((r: any) => r.id === maxId);

  // Color harmony
  const colorHarmony = computeColorHarmony(
    itemA.dominant_colors || [],
    itemB.dominant_colors || []
  );

  // Category pairing
  const categoryCompat = getCategoryCompatibility(
    itemA.category_name || "other",
    itemB.category_name || "other"
  );

  // Embedding similarity (style match)
  let styleMatch = 0.5;
  if (itemA.embedding && itemB.embedding) {
    const dot = itemA.embedding.reduce(
      (sum: number, v: number, i: number) => sum + v * (itemB.embedding[i] || 0),
      0
    );
    // For fashion, moderate similarity is good (too similar = boring)
    styleMatch = 0.3 + 0.7 * Math.abs(dot - 0.5) * 2;
  }

  // Combine factors
  const weights = {
    color_harmony: 0.35,
    category: 0.35,
    style: 0.3
  };

  const totalScore = (
    colorHarmony * weights.color_harmony +
    categoryCompat * weights.category +
    styleMatch * weights.style
  );

  // Generate reasoning
  const reasons: string[] = [];
  if (colorHarmony > 0.7) reasons.push("Colors complement each other well");
  if (categoryCompat > 0.7) reasons.push("Classic category pairing");
  if (styleMatch > 0.6) reasons.push("Similar style aesthetic");

  return {
    item_a_id: minId,
    item_b_id: maxId,
    score: Math.round(totalScore * 1000) / 1000,
    factors: {
      color_harmony: colorHarmony,
      style_match: styleMatch,
      occasion_match: 0.5, // TODO: implement
      formality_match: 0.5  // TODO: implement
    },
    reasoning: reasons.length > 0 ? reasons.join("; ") : "Basic compatibility"
  };
}

/**
 * Precompute and cache compatibility edges for a user's wardrobe
 */
export async function precomputeCompatibilityEdges(
  userId: number,
  batchSize: number = 100
): Promise<number> {
  // Get all wardrobe items
  const itemsResult = await pg.query<{ id: number }>(
    `SELECT id FROM wardrobe_items WHERE user_id = $1`,
    [userId]
  );

  const itemIds = itemsResult.rows.map(r => r.id);
  let edgesComputed = 0;

  // Generate all pairs
  for (let i = 0; i < itemIds.length; i++) {
    for (let j = i + 1; j < itemIds.length; j++) {
      const result = await computeItemCompatibility(userId, itemIds[i], itemIds[j]);

      // Upsert edge
      await pg.query(
        `INSERT INTO compatibility_edges 
         (user_id, item_a_id, item_b_id, score, color_harmony_score, style_similarity_score, reasoning, computed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (user_id, item_a_id, item_b_id) DO UPDATE SET
           score = EXCLUDED.score,
           color_harmony_score = EXCLUDED.color_harmony_score,
           style_similarity_score = EXCLUDED.style_similarity_score,
           reasoning = EXCLUDED.reasoning,
           computed_at = NOW()`,
        [
          userId,
          result.item_a_id,
          result.item_b_id,
          result.score,
          result.factors.color_harmony,
          result.factors.style_match,
          result.reasoning
        ]
      );

      edgesComputed++;

      // Yield to event loop periodically
      if (edgesComputed % batchSize === 0) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
  }

  return edgesComputed;
}

/**
 * Get top compatible items for a given item
 */
export async function getTopCompatibleItems(
  userId: number,
  itemId: number,
  limit: number = 10
): Promise<Array<{ item_id: number; score: number; reasoning: string }>> {
  const result = await pg.query(
    `SELECT 
       CASE WHEN item_a_id = $2 THEN item_b_id ELSE item_a_id END as item_id,
       score,
       reasoning
     FROM compatibility_edges
     WHERE user_id = $1 AND (item_a_id = $2 OR item_b_id = $2)
     ORDER BY score DESC
     LIMIT $3`,
    [userId, itemId, limit]
  );

  return result.rows;
}

/**
 * Get overall wardrobe compatibility score
 */
export async function getWardrobeCompatibilityScore(userId: number): Promise<number> {
  const result = await pg.query(
    `SELECT AVG(score) as avg_score FROM compatibility_edges WHERE user_id = $1`,
    [userId]
  );

  return parseFloat(result.rows[0]?.avg_score || "0");
}
