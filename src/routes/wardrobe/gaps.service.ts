/**
 * Wardrobe Gap Analysis Service
 * Identifies missing items and opportunities in user's wardrobe
 */
import { pg } from "../../lib/core";
import { getStyleProfile } from "./styleProfile.service";

// ============================================================================
// Types
// ============================================================================

export interface WardrobeGap {
  id: number;
  user_id: number;
  gap_type: "category" | "color" | "occasion" | "season" | "compatibility";
  gap_key: string;
  severity: "low" | "medium" | "high";
  recommendation_query?: string;
  recommendation_categories?: number[];
  computed_at: Date;
}

export interface GapAnalysisResult {
  gaps: WardrobeGap[];
  summary: {
    total_gaps: number;
    high_priority: number;
    categories_missing: string[];
    occasions_missing: string[];
    seasons_missing: string[];
  };
  recommendations: Array<{
    type: string;
    message: string;
    search_query: string;
    priority: "high" | "medium" | "low";
  }>;
}

// ============================================================================
// Gap Detection
// ============================================================================

const ESSENTIAL_CATEGORIES = ["tops", "bottoms", "shoes", "outerwear"];
const ESSENTIAL_OCCASIONS = ["casual", "work", "formal"];
const ESSENTIAL_SEASONS = ["spring", "summer", "fall", "winter"];

/**
 * Analyze wardrobe and identify gaps
 */
export async function analyzeWardrobeGaps(userId: number): Promise<GapAnalysisResult> {
  const profile = await getStyleProfile(userId);
  const gaps: WardrobeGap[] = [];
  const recommendations: GapAnalysisResult["recommendations"] = [];

  // Get current category coverage
  const categoryResult = await pg.query(
    `SELECT c.name, COUNT(wi.id) as count
     FROM categories c
     LEFT JOIN wardrobe_items wi ON wi.category_id = c.id AND wi.user_id = $1
     WHERE c.parent_id IS NULL
     GROUP BY c.id, c.name`,
    [userId]
  );

  const categoryMap = new Map(
    categoryResult.rows.map((r: any) => [r.name, parseInt(r.count, 10)])
  );

  // Check essential categories
  const categoriesMissing: string[] = [];
  for (const cat of ESSENTIAL_CATEGORIES) {
    const count = categoryMap.get(cat) || 0;
    if (count === 0) {
      categoriesMissing.push(cat);
      gaps.push({
        id: 0,
        user_id: userId,
        gap_type: "category",
        gap_key: cat,
        severity: "high",
        recommendation_query: cat,
        computed_at: new Date()
      });
      recommendations.push({
        type: "category",
        message: `You don't have any ${cat} in your wardrobe`,
        search_query: cat,
        priority: "high"
      });
    } else if (count < 3) {
      gaps.push({
        id: 0,
        user_id: userId,
        gap_type: "category",
        gap_key: cat,
        severity: "medium",
        recommendation_query: cat,
        computed_at: new Date()
      });
      recommendations.push({
        type: "category",
        message: `Your ${cat} collection is limited (${count} items)`,
        search_query: cat,
        priority: "medium"
      });
    }
  }

  // Check occasion coverage
  const occasionsMissing: string[] = [];
  const currentOccasions = profile?.occasion_coverage || [];
  for (const occ of ESSENTIAL_OCCASIONS) {
    if (!currentOccasions.includes(occ)) {
      occasionsMissing.push(occ);
      gaps.push({
        id: 0,
        user_id: userId,
        gap_type: "occasion",
        gap_key: occ,
        severity: occ === "work" ? "high" : "medium",
        recommendation_query: `${occ} clothing`,
        computed_at: new Date()
      });
      recommendations.push({
        type: "occasion",
        message: `Missing items suitable for ${occ} occasions`,
        search_query: `${occ} wear`,
        priority: occ === "work" ? "high" : "medium"
      });
    }
  }

  // Check season coverage
  const seasonsMissing: string[] = [];
  const currentSeasons = profile?.season_coverage || [];
  for (const season of ESSENTIAL_SEASONS) {
    if (!currentSeasons.includes(season)) {
      seasonsMissing.push(season);
      gaps.push({
        id: 0,
        user_id: userId,
        gap_type: "season",
        gap_key: season,
        severity: "medium",
        recommendation_query: `${season} clothing`,
        computed_at: new Date()
      });
      recommendations.push({
        type: "season",
        message: `Limited options for ${season}`,
        search_query: `${season} fashion`,
        priority: "medium"
      });
    }
  }

  // Check color variety
  const colorPalette = profile?.color_palette || [];
  if (colorPalette.length < 4) {
    gaps.push({
      id: 0,
      user_id: userId,
      gap_type: "color",
      gap_key: "variety",
      severity: "low",
      recommendation_query: "colorful clothing",
      computed_at: new Date()
    });
    recommendations.push({
      type: "color",
      message: "Your wardrobe could use more color variety",
      search_query: "colorful fashion",
      priority: "low"
    });
  }

  // Persist gaps to database
  await persistGaps(userId, gaps);

  return {
    gaps,
    summary: {
      total_gaps: gaps.length,
      high_priority: gaps.filter(g => g.severity === "high").length,
      categories_missing: categoriesMissing,
      occasions_missing: occasionsMissing,
      seasons_missing: seasonsMissing
    },
    recommendations: recommendations.sort((a, b) => {
      const priority = { high: 0, medium: 1, low: 2 };
      return priority[a.priority] - priority[b.priority];
    })
  };
}

/**
 * Persist computed gaps to database
 */
async function persistGaps(userId: number, gaps: WardrobeGap[]): Promise<void> {
  // Clear old gaps
  await pg.query(`DELETE FROM wardrobe_gaps WHERE user_id = $1`, [userId]);

  // Insert new gaps
  for (const gap of gaps) {
    await pg.query(
      `INSERT INTO wardrobe_gaps (user_id, gap_type, gap_key, severity, recommendation_query, computed_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (user_id, gap_type, gap_key) DO UPDATE SET
         severity = EXCLUDED.severity,
         recommendation_query = EXCLUDED.recommendation_query,
         computed_at = NOW()`,
      [userId, gap.gap_type, gap.gap_key, gap.severity, gap.recommendation_query]
    );
  }
}

/**
 * Get cached gaps for a user
 */
export async function getWardrobeGaps(userId: number): Promise<WardrobeGap[]> {
  const result = await pg.query<WardrobeGap>(
    `SELECT * FROM wardrobe_gaps WHERE user_id = $1 ORDER BY 
     CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END`,
    [userId]
  );
  return result.rows;
}

/**
 * Get priority gaps (high severity only)
 */
export async function getPriorityGaps(userId: number): Promise<WardrobeGap[]> {
  const result = await pg.query<WardrobeGap>(
    `SELECT * FROM wardrobe_gaps WHERE user_id = $1 AND severity = 'high'`,
    [userId]
  );
  return result.rows;
}
