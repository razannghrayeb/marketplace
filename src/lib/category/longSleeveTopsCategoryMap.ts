/**
 * Long Sleeve Tops & Outerwear Category Mapping
 * 
 * Normalizes fragmented category variants into canonical categories for search ranking.
 * Improves search by treating "T-Shirt", "T-SHIRT", "t-shirt" as the same product type.
 * 
 * Purpose:
 *  - Map 100+ category variants to 15 canonical categories
 *  - Support color prioritization in results for long sleeve items
 *  - Enable category-specific ranking rules
 *  - Track unmapped categories for data quality
 * 
 * Usage:
 *   import { normalizeCategory, isLongSleeveTop, isOuterwear } from './longSleeveTopsCategoryMap';
 *   
 *   const canonical = normalizeCategory('t-shirt');  // → 'tshirt'
 *   if (isLongSleeveTop(canonical)) { ... }  // Apply long sleeve specific logic
 */

// ============================================================================
// Canonical Categories (15 primary categories)
// ============================================================================

export type LongSleeveTopCategory =
  | 'tshirt'           // T-Shirt, Tee, etc.
  | 'shirt'            // Button-up shirt, woven tops
  | 'blouse'           // Women's blouses
  | 'polo'             // Polo shirts (with/without sleeves)
  | 'knit_top'         // Knit tops, knitwear
  | 'crop_top'         // Crop tops, short tops
  | 'tank'             // Tank tops, sleeveless
  | 'top'              // Generic tops
  | 'sweater'          // Sweater, pullover, cardigan
  | 'hoodie'           // Hoodie, hoody
  | 'sweatshirt'       // Sweatshirt, crewneck
  | 'cardigan'         // Cardigan (long sleeve layer)
  | 'fleece'           // Fleece tops/layers
  | 'jacket'           // Jacket, blazer, denim
  | 'coat'             // Coat, parka, outerwear
  | 'vest'             // Vest, waistcoat (formal/layering)
  | 'tracksuit'        // Tracksuit, jogger sets
  | 'suit';            // Suit, formal wear

export type OuterwearCategory = Extract<LongSleeveTopCategory, 'jacket' | 'coat' | 'vest' | 'suit' | 'tracksuit' | 'fleece'>;
export type TopCategory = Exclude<LongSleeveTopCategory, OuterwearCategory>;

// ============================================================================
// Category Mapping (Raw → Canonical)
// ============================================================================

const LONG_SLEEVE_TOPS_MAP: Record<string, LongSleeveTopCategory> = {
  // T-SHIRT variants (case-insensitive)
  't-shirt': 'tshirt',
  't-shirt ': 'tshirt',
  't- shirt': 'tshirt',
  't-shirts': 'tshirt',
  't-shirts ': 'tshirt',
  'tshirt': 'tshirt',
  'tee': 'tshirt',
  't-shirt-os': 'tshirt',
  't-shirt-bos': 'tshirt',
  'trendeyol t': 'tshirt',
  'alba active': 'tshirt',

  // SHIRT variants
  'shirt': 'shirt',
  'shirts': 'shirt',
  'shirting': 'shirt',
  'woven shirt': 'shirt',
  'woven shirts': 'shirt',
  'woven tops': 'shirt',
  'dress shirt': 'shirt',
  'button shirt': 'shirt',
  'oxford shirt': 'shirt',
  'shirt-ox': 'shirt',
  'shirt-cl': 'shirt',
  'shirt-ni': 'shirt',
  'shirt-sp': 'shirt',
  'shirt-ln': 'shirt',
  'chemise': 'shirt',
  'trendeyol shirt': 'shirt',
  'xint men': 'shirt',
  'xint women': 'shirt',
  'men shirt': 'shirt',
  'women shirt': 'shirt',

  // BLOUSE variants
  'blouse': 'blouse',
  'blouses': 'blouse',
  'trendeyol blouse': 'blouse',
  'womens blouse': 'blouse',

  // POLO variants
  'polo': 'polo',
  'polo shirt': 'polo',
  'polo shirts': 'polo',
  'polo short sleeve': 'polo',
  'polo long sleeve': 'polo',
  'men polo': 'polo',
  'women polo': 'polo',

  // KNIT TOP variants
  'knit top': 'knit_top',
  'knit tops': 'knit_top',
  'knitwear': 'knit_top',
  'basic': 'knit_top',
  'basic top': 'knit_top',

  // CROP TOP variants
  'crop top': 'crop_top',

  // TANK variants
  'tank': 'tank',
  'tank top': 'tank',
  'sleeveless': 'tank',

  // TOP (generic)
  'top': 'top',
  'tops': 'top',
  'women top': 'top',
  'penti top': 'top',
  'lefon top': 'top',
  'track top': 'top',
  'long sleeve': 'top',  // Generic long sleeve

  // SWEATER variants
  'sweater': 'sweater',
  'sweaters': 'sweater',
  'women sweater': 'sweater',
  'men sweater': 'sweater',

  // HOODIE variants
  'hoodie': 'hoodie',
  'hoody': 'hoodie',
  'hoodies': 'hoodie',
  'men hoodie': 'hoodie',

  // SWEATSHIRT variants
  'sweatshirt': 'sweatshirt',
  'sweatshirts': 'sweatshirt',
  'crew neck': 'sweatshirt',
  'crewneck': 'sweatshirt',

  // CARDIGAN variants
  'cardigan': 'cardigan',
  'cardigans': 'cardigan',
  'women cardigan': 'cardigan',

  // FLEECE variants
  'fleece': 'fleece',

  // JACKET variants
  'jacket': 'jacket',
  'jackets': 'jacket',
  'blazer': 'jacket',
  'blazers': 'jacket',
  'women blazer': 'jacket',
  'men blazer': 'jacket',
  'denim jacket': 'jacket',
  'women jacket': 'jacket',
  'men jacket': 'jacket',
  'jacket-sp': 'jacket',
  'lefon blazer': 'jacket',

  // COAT variants
  'coat': 'coat',
  'coats': 'coat',
  'coats & jackets': 'coat',
  'outerwear': 'coat',
  'outwear': 'coat',
  'outerwear & jackets': 'coat',
  'parka': 'coat',
  'parkas & blousons': 'coat',
  'women coat': 'coat',
  'men coat': 'coat',
  'women winter': 'coat',
  'men winter': 'coat',

  // VEST variants
  'vest': 'vest',
  'vests': 'vest',
  'waistcoat': 'vest',
  'women vest': 'vest',
  'men vest': 'vest',
  'lefon vest': 'vest',

  // SUIT variants
  'suit': 'suit',
  'suit-2p': 'suit',
  'suit-2pnos': 'suit',
  'suit-txd': 'suit',
  'men suits': 'suit',
  'formal suit': 'suit',

  // TRACKSUIT variants
  'tracksuit': 'tracksuit',
  'tracksuits': 'tracksuit',
  'tracksuits & track trousers': 'tracksuit',
  'jogging': 'tracksuit',
  'jogging set': 'tracksuit',
  'jogger': 'tracksuit',

  // PULLOVER variants (map to sweater for consistency)
  'pullover': 'sweater',
  'pullovers': 'sweater',
  'women pullover': 'sweater',
  'men pullover': 'sweater',
};

// ============================================================================
// Category Classification
// ============================================================================

const OUTERWEAR_CATEGORIES: Set<LongSleeveTopCategory> = new Set([
  'jacket',
  'coat',
  'vest',
  'suit',
  'tracksuit',
  'fleece',
]);

const TOP_CATEGORIES: Set<LongSleeveTopCategory> = new Set([
  'tshirt',
  'shirt',
  'blouse',
  'polo',
  'knit_top',
  'crop_top',
  'tank',
  'top',
  'sweater',
  'hoodie',
  'sweatshirt',
  'cardigan',
]);

const LONG_SLEEVE_BIASED_CATEGORIES: Set<LongSleeveTopCategory> = new Set([
  'sweater',
  'hoodie',
  'sweatshirt',
  'cardigan',
  'shirt',
  'blouse',
  'polo',
  'knit_top',
  'tracksuit',
  'jacket',
  'coat',
]);

// ============================================================================
// Public API
// ============================================================================

/**
 * Normalize a category name to canonical form.
 * Returns null if category cannot be mapped.
 */
export function normalizeCategory(rawCategory: string | null | undefined): LongSleeveTopCategory | null {
  if (rawCategory === undefined || rawCategory === null) return null;

  const normalized = String(rawCategory).toLowerCase().trim();
  const mapped = LONG_SLEEVE_TOPS_MAP[normalized];

  if (mapped) {
    return mapped;
  }

  // Try fuzzy matching for close matches
  const fuzzyMatch = findFuzzyMatch(normalized);
  return fuzzyMatch ? LONG_SLEEVE_TOPS_MAP[fuzzyMatch] : null;
}

/**
 * Check if a category is a top (not outerwear).
 */
export function isTop(category: LongSleeveTopCategory): category is TopCategory {
  return TOP_CATEGORIES.has(category);
}

/**
 * Check if a category is outerwear.
 */
export function isOuterwear(category: LongSleeveTopCategory): category is OuterwearCategory {
  return OUTERWEAR_CATEGORIES.has(category);
}

/**
 * Check if a category typically includes long sleeve variants.
 * Used to boost color matching in rankings.
 */
export function isLongSleeveTypical(category: LongSleeveTopCategory): boolean {
  return LONG_SLEEVE_BIASED_CATEGORIES.has(category);
}

/**
 * Get all mapped categories for reference.
 */
export function getAllMappedCategories(): LongSleeveTopCategory[] {
  return Array.from(new Set(Object.values(LONG_SLEEVE_TOPS_MAP)));
}

/**
 * Get the mapping for a specific canonical category.
 */
export function getCategoryVariants(canonical: LongSleeveTopCategory): string[] {
  return Object.entries(LONG_SLEEVE_TOPS_MAP)
    .filter(([, value]) => value === canonical)
    .map(([key]) => key);
}

// ============================================================================
// Fuzzy Matching (fallback for edge cases)
// ============================================================================

function findFuzzyMatch(normalized: string): string | null {
  const keys = Object.keys(LONG_SLEEVE_TOPS_MAP);
  
  // Check for substring matches
  for (const key of keys) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return key;
    }
  }

  // Check Levenshtein distance for typos
  const matches = keys.sort((a, b) => levenshteinDistance(a, normalized) - levenshteinDistance(b, normalized));
  const bestMatch = matches[0];

  if (levenshteinDistance(bestMatch, normalized) <= 2) {
    return bestMatch;
  }

  return null;
}

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
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

  return matrix[b.length][a.length];
}
