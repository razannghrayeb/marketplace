/**
 * User Lifestyle Adaptation
 * 
 * Learns user-specific essentials and preferences from behavior.
 * Adapts recommendations to match user's actual lifestyle rather
 * than assuming generic "essential categories".
 */

import { pg } from "../core/db";

// ============================================================================
// Types
// ============================================================================

export interface UserLifestyle {
  userId: number;
  primaryOccasions: string[];
  activeSeasons: string[];
  priceRange: PriceRange;
  preferredCategories: string[];
  preferredBrands: string[];
  styleProfile: StyleProfile;
  shoppingPatterns: ShoppingPatterns;
}

export interface PriceRange {
  p25: number;      // 25th percentile
  median: number;   // 50th percentile
  p75: number;      // 75th percentile
  currency: string;
}

export interface StyleProfile {
  dominantStyle: string;
  colorPreferences: string[];
  formalityLevel: "casual" | "smart_casual" | "business" | "formal" | "mixed";
  aestheticTags: string[];
}

export interface ShoppingPatterns {
  averageFrequencyDays: number;
  preferredSeason: string | null;
  categoryRotation: string[];   // Categories they buy in order
  loyaltyScore: number;         // 0-1, brand loyalty
}

export interface AdaptedEssentials {
  categories: AdaptedCategory[];
  occasions: string[];
  seasons: string[];
}

export interface AdaptedCategory {
  name: string;
  priority: 1 | 2 | 3;
  reason: string;
  currentCount: number;
  recommendedMin: number;
}

// ============================================================================
// Lifestyle Learning
// ============================================================================

/**
 * Learn user lifestyle from wardrobe and behavior
 */
export async function learnUserLifestyle(userId: number): Promise<UserLifestyle> {
  const [
    occasions,
    seasons,
    priceRange,
    categories,
    brands,
    styleProfile,
    shoppingPatterns,
  ] = await Promise.all([
    learnPrimaryOccasions(userId),
    learnActiveSeasons(userId),
    learnPriceRange(userId),
    learnPreferredCategories(userId),
    learnPreferredBrands(userId),
    learnStyleProfile(userId),
    learnShoppingPatterns(userId),
  ]);
  
  return {
    userId,
    primaryOccasions: occasions,
    activeSeasons: seasons,
    priceRange,
    preferredCategories: categories,
    preferredBrands: brands,
    styleProfile,
    shoppingPatterns,
  };
}

/**
 * Learn primary occasions from wardrobe items
 */
async function learnPrimaryOccasions(userId: number): Promise<string[]> {
  const result = await pg.query<{ occasion: string; count: string }>(
    `SELECT occasion, COUNT(*) as count
     FROM wardrobe_items
     WHERE user_id = $1 AND occasion IS NOT NULL
     GROUP BY occasion
     ORDER BY count DESC
     LIMIT 5`,
    [userId]
  );
  
  // Filter to occasions with significant representation
  const total = result.rows.reduce((sum, r) => sum + parseInt(r.count, 10), 0);
  return result.rows
    .filter(r => parseInt(r.count, 10) / total > 0.1)
    .map(r => r.occasion);
}

/**
 * Learn active seasons from purchase/add dates
 */
async function learnActiveSeasons(userId: number): Promise<string[]> {
  const result = await pg.query<{ season: string }>(
    `SELECT DISTINCT
       CASE 
         WHEN EXTRACT(MONTH FROM created_at) IN (3,4,5) THEN 'spring'
         WHEN EXTRACT(MONTH FROM created_at) IN (6,7,8) THEN 'summer'
         WHEN EXTRACT(MONTH FROM created_at) IN (9,10,11) THEN 'fall'
         ELSE 'winter'
       END as season
     FROM wardrobe_items
     WHERE user_id = $1
       AND created_at > NOW() - INTERVAL '2 years'`,
    [userId]
  );
  
  return result.rows.map(r => r.season);
}

/**
 * Learn user's price range from purchases
 */
async function learnPriceRange(userId: number): Promise<PriceRange> {
  const result = await pg.query<{
    p25: string;
    median: string;
    p75: string;
    currency: string;
  }>(
    `SELECT 
       percentile_cont(0.25) WITHIN GROUP (ORDER BY price_cents) as p25,
       percentile_cont(0.50) WITHIN GROUP (ORDER BY price_cents) as median,
       percentile_cont(0.75) WITHIN GROUP (ORDER BY price_cents) as p75,
       COALESCE(MAX(currency), 'USD') as currency
     FROM wardrobe_items
     WHERE user_id = $1 AND price_cents > 0`,
    [userId]
  );
  
  const row = result.rows[0];
  return {
    p25: parseFloat(row?.p25 || "2000"),     // $20 default
    median: parseFloat(row?.median || "5000"), // $50 default
    p75: parseFloat(row?.p75 || "10000"),    // $100 default
    currency: row?.currency || "USD",
  };
}

/**
 * Learn preferred categories from wardrobe
 */
async function learnPreferredCategories(userId: number): Promise<string[]> {
  const result = await pg.query<{ category: string; count: string }>(
    `SELECT c.name as category, COUNT(*) as count
     FROM wardrobe_items wi
     JOIN categories c ON wi.category_id = c.id
     WHERE wi.user_id = $1
     GROUP BY c.name
     ORDER BY count DESC
     LIMIT 10`,
    [userId]
  );
  
  return result.rows.map(r => r.category);
}

/**
 * Learn preferred brands
 */
async function learnPreferredBrands(userId: number): Promise<string[]> {
  const result = await pg.query<{ brand: string; count: string }>(
    `SELECT brand, COUNT(*) as count
     FROM wardrobe_items
     WHERE user_id = $1 AND brand IS NOT NULL
     GROUP BY brand
     ORDER BY count DESC
     LIMIT 5`,
    [userId]
  );
  
  return result.rows.map(r => r.brand);
}

/**
 * Learn style profile
 */
async function learnStyleProfile(userId: number): Promise<StyleProfile> {
  // Get dominant colors
  const colorsResult = await pg.query<{ color: string; count: string }>(
    `SELECT color, COUNT(*) as count
     FROM wardrobe_items
     WHERE user_id = $1 AND color IS NOT NULL
     GROUP BY color
     ORDER BY count DESC
     LIMIT 5`,
    [userId]
  );
  
  // Get style tags
  const tagsResult = await pg.query<{ style: string; count: string }>(
    `SELECT unnest(style_tags) as style, COUNT(*) as count
     FROM wardrobe_items
     WHERE user_id = $1 AND style_tags IS NOT NULL
     GROUP BY style
     ORDER BY count DESC
     LIMIT 5`,
    [userId]
  );
  
  // Determine formality level
  const formalityResult = await pg.query<{ occasion: string; count: string }>(
    `SELECT occasion, COUNT(*) as count
     FROM wardrobe_items
     WHERE user_id = $1 AND occasion IS NOT NULL
     GROUP BY occasion
     ORDER BY count DESC`,
    [userId]
  );
  
  let formalityLevel: StyleProfile["formalityLevel"] = "mixed";
  const total = formalityResult.rows.reduce((s, r) => s + parseInt(r.count, 10), 0);
  
  for (const row of formalityResult.rows) {
    const ratio = parseInt(row.count, 10) / total;
    if (ratio > 0.5) {
      if (row.occasion === "casual") formalityLevel = "casual";
      else if (row.occasion === "work") formalityLevel = "business";
      else if (row.occasion === "formal") formalityLevel = "formal";
      break;
    }
  }
  
  return {
    dominantStyle: tagsResult.rows[0]?.style || "classic",
    colorPreferences: colorsResult.rows.map(r => r.color),
    formalityLevel,
    aestheticTags: tagsResult.rows.map(r => r.style),
  };
}

/**
 * Learn shopping patterns
 */
async function learnShoppingPatterns(userId: number): Promise<ShoppingPatterns> {
  // Average frequency
  const freqResult = await pg.query<{ avg_days: string }>(
    `SELECT AVG(days_between) as avg_days
     FROM (
       SELECT 
         EXTRACT(DAY FROM created_at - LAG(created_at) OVER (ORDER BY created_at)) as days_between
       FROM wardrobe_items
       WHERE user_id = $1
         AND created_at > NOW() - INTERVAL '1 year'
     ) sub
     WHERE days_between IS NOT NULL`,
    [userId]
  );
  
  // Category rotation
  const rotationResult = await pg.query<{ category: string }>(
    `SELECT c.name as category
     FROM wardrobe_items wi
     JOIN categories c ON wi.category_id = c.id
     WHERE wi.user_id = $1
     ORDER BY wi.created_at DESC
     LIMIT 20`,
    [userId]
  );
  
  // Brand loyalty
  const loyaltyResult = await pg.query<{ distinct_brands: string; total: string }>(
    `SELECT 
       COUNT(DISTINCT brand) as distinct_brands,
       COUNT(*) as total
     FROM wardrobe_items
     WHERE user_id = $1 AND brand IS NOT NULL`,
    [userId]
  );
  
  const distinctBrands = parseInt(loyaltyResult.rows[0]?.distinct_brands || "0", 10);
  const totalItems = parseInt(loyaltyResult.rows[0]?.total || "1", 10);
  const loyaltyScore = Math.max(0, 1 - (distinctBrands / totalItems));
  
  return {
    averageFrequencyDays: parseFloat(freqResult.rows[0]?.avg_days || "30"),
    preferredSeason: null, // Could be computed from seasonal purchase patterns
    categoryRotation: [...new Set(rotationResult.rows.map(r => r.category))],
    loyaltyScore,
  };
}

// ============================================================================
// Adaptive Essentials
// ============================================================================

/**
 * Get adapted essential categories based on user lifestyle
 */
export async function getAdaptedEssentials(
  userId: number
): Promise<AdaptedEssentials> {
  const lifestyle = await learnUserLifestyle(userId);
  
  // Get current wardrobe counts by category
  const countsResult = await pg.query<{ category: string; count: string }>(
    `SELECT c.name as category, COUNT(*) as count
     FROM wardrobe_items wi
     JOIN categories c ON wi.category_id = c.id
     WHERE wi.user_id = $1
     GROUP BY c.name`,
    [userId]
  );
  
  const currentCounts = new Map(
    countsResult.rows.map(r => [r.category, parseInt(r.count, 10)])
  );
  
  // Build adapted categories based on occasions
  const adaptedCategories: AdaptedCategory[] = [];
  
  // Core categories everyone needs
  const coreCategories = ["tops", "bottoms"];
  for (const cat of coreCategories) {
    adaptedCategories.push({
      name: cat,
      priority: 1,
      reason: "Wardrobe essential",
      currentCount: currentCounts.get(cat) || 0,
      recommendedMin: 5,
    });
  }
  
  // Occasion-based categories
  if (lifestyle.primaryOccasions.includes("work") || 
      lifestyle.styleProfile.formalityLevel === "business") {
    adaptedCategories.push({
      name: "blazers",
      priority: 1,
      reason: "Important for your work wardrobe",
      currentCount: currentCounts.get("blazers") || 0,
      recommendedMin: 2,
    });
    adaptedCategories.push({
      name: "dress_pants",
      priority: 1,
      reason: "Professional wardrobe essential",
      currentCount: currentCounts.get("dress_pants") || 0,
      recommendedMin: 3,
    });
  }
  
  if (lifestyle.primaryOccasions.includes("casual") ||
      lifestyle.styleProfile.formalityLevel === "casual") {
    adaptedCategories.push({
      name: "jeans",
      priority: 1,
      reason: "Core casual wardrobe piece",
      currentCount: currentCounts.get("jeans") || 0,
      recommendedMin: 3,
    });
    adaptedCategories.push({
      name: "sneakers",
      priority: 2,
      reason: "Casual footwear essential",
      currentCount: currentCounts.get("sneakers") || 0,
      recommendedMin: 2,
    });
  }
  
  if (lifestyle.primaryOccasions.includes("formal")) {
    adaptedCategories.push({
      name: "dresses",
      priority: 2,
      reason: "For formal occasions",
      currentCount: currentCounts.get("dresses") || 0,
      recommendedMin: 2,
    });
    adaptedCategories.push({
      name: "heels",
      priority: 2,
      reason: "Formal footwear",
      currentCount: currentCounts.get("heels") || 0,
      recommendedMin: 1,
    });
  }
  
  // Season-based categories
  if (lifestyle.activeSeasons.includes("winter")) {
    adaptedCategories.push({
      name: "outerwear",
      priority: 1,
      reason: "Winter wardrobe essential",
      currentCount: currentCounts.get("outerwear") || 0,
      recommendedMin: 2,
    });
  }
  
  if (lifestyle.activeSeasons.includes("summer")) {
    adaptedCategories.push({
      name: "shorts",
      priority: 2,
      reason: "Summer wardrobe essential",
      currentCount: currentCounts.get("shorts") || 0,
      recommendedMin: 2,
    });
  }
  
  // Sort by priority
  adaptedCategories.sort((a, b) => a.priority - b.priority);
  
  return {
    categories: adaptedCategories,
    occasions: lifestyle.primaryOccasions,
    seasons: lifestyle.activeSeasons,
  };
}

/**
 * Infer user's price tier for recommendations
 */
export async function inferPriceTier(
  userId: number
): Promise<{ min: number; max: number; label: string }> {
  const lifestyle = await learnUserLifestyle(userId);
  const { p25, median, p75 } = lifestyle.priceRange;
  
  // Determine tier label
  let label: string;
  if (median < 3000) {
    label = "budget";
  } else if (median < 8000) {
    label = "mid-range";
  } else if (median < 20000) {
    label = "premium";
  } else {
    label = "luxury";
  }
  
  return {
    min: Math.round(p25 * 0.8),    // 20% below 25th percentile
    max: Math.round(p75 * 1.3),    // 30% above 75th percentile
    label,
  };
}

/**
 * Check if a product matches user's lifestyle
 */
export async function productMatchesLifestyle(
  productId: number,
  userId: number
): Promise<{ matches: boolean; score: number; reasons: string[] }> {
  const lifestyle = await learnUserLifestyle(userId);
  
  const productResult = await pg.query(
    `SELECT price_cents, brand, category, occasion, style_tags
     FROM products p
     JOIN categories c ON p.category_id = c.id
     WHERE p.id = $1`,
    [productId]
  );
  
  if (productResult.rows.length === 0) {
    return { matches: false, score: 0, reasons: ["Product not found"] };
  }
  
  const product = productResult.rows[0];
  let score = 50;
  const reasons: string[] = [];
  
  // Price match
  const { p25, p75 } = lifestyle.priceRange;
  if (product.price_cents >= p25 * 0.5 && product.price_cents <= p75 * 1.5) {
    score += 15;
    reasons.push("Within your price range");
  } else if (product.price_cents > p75 * 2) {
    score -= 10;
    reasons.push("Above your typical budget");
  }
  
  // Brand match
  if (lifestyle.preferredBrands.includes(product.brand)) {
    score += 10;
    reasons.push("From a brand you like");
  }
  
  // Category match
  if (lifestyle.preferredCategories.includes(product.category)) {
    score += 10;
    reasons.push("Category you often buy");
  }
  
  // Occasion match
  if (product.occasion && lifestyle.primaryOccasions.includes(product.occasion)) {
    score += 10;
    reasons.push("Fits your lifestyle occasions");
  }
  
  // Style match
  const productStyles = product.style_tags || [];
  const matchingStyles = productStyles.filter((s: string) => 
    lifestyle.styleProfile.aestheticTags.includes(s)
  );
  if (matchingStyles.length > 0) {
    score += 5 * matchingStyles.length;
    reasons.push("Matches your style");
  }
  
  return {
    matches: score >= 60,
    score: Math.min(100, score),
    reasons,
  };
}
