/**
 * Enhanced Category Mapping Module
 *
 * Maps YOLO detection labels to product categories with:
 * - Comprehensive primary mappings for all YOLO raw labels
 * - Fuzzy pattern matching for missing/ambiguous categories
 * - Confidence scoring for search quality
 * - Alternative categories for broader search fallback
 */

// ============================================================================
// Types
// ============================================================================

export interface CategoryMapping {
  /** Primary product category for filtering */
  productCategory: string;
  /** Confidence in this mapping (0-1) */
  confidence: number;
  /** Alternative categories for broader search */
  alternativeCategories: string[];
  /** Extracted attributes from the detection */
  attributes: CategoryAttributes;
}

export interface CategoryAttributes {
  sleeveLength?: "short" | "long" | "sleeveless";
  dressLength?: "mini" | "midi" | "maxi" | "long";
  formalityHint?: number;
}

// ============================================================================
// Primary Mappings (Exact Match)
// ============================================================================

/**
 * Maps YOLO raw labels to product categories.
 * Includes both dual-model detector labels and legacy labels.
 */
const PRIMARY_MAPPINGS: Record<string, CategoryMapping> = {
  // -------------------------------------------------------------------------
  // Model A: deepfashion2_yolov8s-seg (13 clothing classes)
  // -------------------------------------------------------------------------
  "long sleeve top": {
    productCategory: "tops",
    confidence: 0.95,
    alternativeCategories: ["shirts", "blouses"],
    attributes: { sleeveLength: "long" },
  },
  "short sleeve top": {
    productCategory: "tops",
    confidence: 0.95,
    alternativeCategories: ["tshirts"],
    attributes: { sleeveLength: "short" },
  },
  "long sleeve outwear": {
    productCategory: "outerwear",
    confidence: 0.9,
    alternativeCategories: ["jackets", "coats", "suits", "blazers", "dress jackets"],
    attributes: { sleeveLength: "long" },
  },
  "short sleeve outwear": {
    productCategory: "outerwear",
    confidence: 0.85,
    alternativeCategories: ["blazers", "vests"],
    attributes: { sleeveLength: "short" },
  },
  vest: {
    productCategory: "outerwear",
    confidence: 0.8,
    alternativeCategories: ["tops", "activewear"],
    attributes: { sleeveLength: "sleeveless" },
  },
  sling: {
    productCategory: "tops",
    confidence: 0.8,
    alternativeCategories: ["dresses"],
    attributes: { sleeveLength: "sleeveless" },
  },
  shorts: {
    productCategory: "bottoms",
    confidence: 0.95,
    alternativeCategories: [],
    attributes: {},
  },
  trousers: {
    productCategory: "bottoms",
    confidence: 0.95,
    alternativeCategories: ["pants", "jeans"],
    attributes: {},
  },
  skirt: {
    productCategory: "bottoms",
    confidence: 0.95,
    alternativeCategories: [],
    attributes: {},
  },
  "short sleeve dress": {
    productCategory: "dresses",
    confidence: 0.95,
    alternativeCategories: [],
    attributes: { sleeveLength: "short" },
  },
  "long sleeve dress": {
    productCategory: "dresses",
    confidence: 0.95,
    alternativeCategories: [],
    attributes: { sleeveLength: "long" },
  },
  "vest dress": {
    productCategory: "dresses",
    confidence: 0.9,
    alternativeCategories: ["jumpsuits"],
    attributes: { sleeveLength: "sleeveless" },
  },
  "sling dress": {
    productCategory: "dresses",
    confidence: 0.9,
    alternativeCategories: [],
    attributes: { sleeveLength: "sleeveless" },
  },

  // -------------------------------------------------------------------------
  // Model B: yolos-fashionpedia (accessories)
  // -------------------------------------------------------------------------
  shoe: {
    productCategory: "footwear",
    confidence: 0.9,
    alternativeCategories: ["sneakers", "boots", "heels", "sandals"],
    attributes: {},
  },
  "bag, wallet": {
    productCategory: "bags",
    confidence: 0.85,
    alternativeCategories: ["accessories"],
    attributes: {},
  },
  hat: {
    productCategory: "accessories",
    confidence: 0.9,
    alternativeCategories: [],
    attributes: {},
  },
  "headband, head covering, hair accessory": {
    productCategory: "accessories",
    confidence: 0.85,
    alternativeCategories: [],
    attributes: {},
  },

  // -------------------------------------------------------------------------
  // Legacy/Alternative Labels (for backward compatibility)
  // -------------------------------------------------------------------------
  // Tops
  shirt: {
    productCategory: "tops",
    confidence: 0.95,
    alternativeCategories: ["shirts"],
    attributes: {},
  },
  tshirt: {
    productCategory: "tops",
    confidence: 0.95,
    alternativeCategories: ["tshirts"],
    attributes: { sleeveLength: "short" },
  },
  blouse: {
    productCategory: "tops",
    confidence: 0.95,
    alternativeCategories: ["blouses"],
    attributes: {},
  },
  sweater: {
    productCategory: "tops",
    confidence: 0.9,
    alternativeCategories: ["knitwear"],
    attributes: { sleeveLength: "long" },
  },
  hoodie: {
    productCategory: "tops",
    confidence: 0.9,
    alternativeCategories: ["hoodies", "activewear"],
    attributes: { sleeveLength: "long" },
  },
  cardigan: {
    productCategory: "tops",
    confidence: 0.9,
    alternativeCategories: ["knitwear", "outerwear"],
    attributes: { sleeveLength: "long" },
  },
  tank_top: {
    productCategory: "tops",
    confidence: 0.9,
    alternativeCategories: ["activewear"],
    attributes: { sleeveLength: "sleeveless" },
  },
  crop_top: {
    productCategory: "tops",
    confidence: 0.9,
    alternativeCategories: [],
    attributes: { sleeveLength: "short" },
  },
  top: {
    productCategory: "tops",
    confidence: 0.85,
    alternativeCategories: [],
    attributes: {},
  },

  // Bottoms
  jeans: {
    productCategory: "bottoms",
    confidence: 0.95,
    alternativeCategories: ["jeans", "denim"],
    attributes: {},
  },
  pants: {
    productCategory: "bottoms",
    confidence: 0.95,
    alternativeCategories: ["pants", "trousers"],
    attributes: {},
  },
  leggings: {
    productCategory: "bottoms",
    confidence: 0.9,
    alternativeCategories: ["activewear"],
    attributes: {},
  },

  // Dresses
  dress: {
    productCategory: "dresses",
    confidence: 0.95,
    alternativeCategories: [],
    attributes: {},
  },
  gown: {
    productCategory: "dresses",
    confidence: 0.95,
    alternativeCategories: [],
    attributes: { formalityHint: 9 },
  },
  maxi_dress: {
    productCategory: "dresses",
    confidence: 0.95,
    alternativeCategories: [],
    attributes: { dressLength: "maxi" },
  },
  long_dress: {
    productCategory: "dresses",
    confidence: 0.95,
    alternativeCategories: [],
    attributes: { dressLength: "long" },
  },
  mini_dress: {
    productCategory: "dresses",
    confidence: 0.95,
    alternativeCategories: [],
    attributes: { dressLength: "mini" },
  },
  midi_dress: {
    productCategory: "dresses",
    confidence: 0.95,
    alternativeCategories: [],
    attributes: { dressLength: "midi" },
  },
  jumpsuit: {
    productCategory: "dresses",
    confidence: 0.9,
    alternativeCategories: ["jumpsuits"],
    attributes: {},
  },
  romper: {
    productCategory: "dresses",
    confidence: 0.9,
    alternativeCategories: ["jumpsuits"],
    attributes: {},
  },

  // Outerwear
  jacket: {
    productCategory: "outerwear",
    confidence: 0.9,
    alternativeCategories: ["jackets"],
    attributes: {},
  },
  coat: {
    productCategory: "outerwear",
    confidence: 0.9,
    alternativeCategories: ["coats"],
    attributes: { formalityHint: 6 },
  },
  blazer: {
    productCategory: "outerwear",
    confidence: 0.9,
    alternativeCategories: ["blazers"],
    attributes: { formalityHint: 7 },
  },
  parka: {
    productCategory: "outerwear",
    confidence: 0.9,
    alternativeCategories: ["jackets"],
    attributes: {},
  },
  bomber: {
    productCategory: "outerwear",
    confidence: 0.9,
    alternativeCategories: ["jackets"],
    attributes: {},
  },

  // Footwear
  sneakers: {
    productCategory: "footwear",
    confidence: 0.95,
    alternativeCategories: ["sneakers"],
    attributes: { formalityHint: 3 },
  },
  boots: {
    productCategory: "footwear",
    confidence: 0.95,
    alternativeCategories: ["boots"],
    attributes: {},
  },
  heels: {
    productCategory: "footwear",
    confidence: 0.95,
    alternativeCategories: ["heels"],
    attributes: { formalityHint: 8 },
  },
  sandals: {
    productCategory: "footwear",
    confidence: 0.95,
    alternativeCategories: ["sandals"],
    attributes: { formalityHint: 2 },
  },
  loafers: {
    productCategory: "footwear",
    confidence: 0.95,
    alternativeCategories: ["loafers"],
    attributes: { formalityHint: 6 },
  },
  flats: {
    productCategory: "footwear",
    confidence: 0.95,
    alternativeCategories: ["flats"],
    attributes: {},
  },

  // Bags
  bag: {
    productCategory: "bags",
    confidence: 0.9,
    alternativeCategories: ["bags"],
    attributes: {},
  },
  backpack: {
    productCategory: "bags",
    confidence: 0.9,
    alternativeCategories: ["backpacks"],
    attributes: {},
  },
  clutch: {
    productCategory: "bags",
    confidence: 0.9,
    alternativeCategories: ["clutches"],
    attributes: { formalityHint: 8 },
  },
  tote: {
    productCategory: "bags",
    confidence: 0.9,
    alternativeCategories: ["totes"],
    attributes: {},
  },
  crossbody: {
    productCategory: "bags",
    confidence: 0.9,
    alternativeCategories: ["crossbody bags"],
    attributes: {},
  },

  // Accessories
  sunglasses: {
    productCategory: "accessories",
    confidence: 0.9,
    alternativeCategories: ["eyewear"],
    attributes: {},
  },
  watch: {
    productCategory: "accessories",
    confidence: 0.9,
    alternativeCategories: ["watches"],
    attributes: {},
  },
  belt: {
    productCategory: "accessories",
    confidence: 0.9,
    alternativeCategories: ["belts"],
    attributes: {},
  },
  tie: {
    productCategory: "accessories",
    confidence: 0.9,
    alternativeCategories: ["ties"],
    attributes: { formalityHint: 8 },
  },
  scarf: {
    productCategory: "accessories",
    confidence: 0.9,
    alternativeCategories: ["scarves"],
    attributes: {},
  },
  jewelry: {
    productCategory: "accessories",
    confidence: 0.85,
    alternativeCategories: ["jewelry"],
    attributes: {},
  },
  necklace: {
    productCategory: "accessories",
    confidence: 0.9,
    alternativeCategories: ["jewelry", "necklaces"],
    attributes: {},
  },
  bracelet: {
    productCategory: "accessories",
    confidence: 0.9,
    alternativeCategories: ["jewelry", "bracelets"],
    attributes: {},
  },
  earrings: {
    productCategory: "accessories",
    confidence: 0.9,
    alternativeCategories: ["jewelry", "earrings"],
    attributes: {},
  },
};

// ============================================================================
// Fuzzy Pattern Matching (for missing/ambiguous categories)
// ============================================================================

interface FuzzyPattern {
  pattern: RegExp;
  mapping: CategoryMapping;
}

/**
 * Fuzzy patterns for categories not in primary mappings.
 * Order matters: first match wins.
 */
const FUZZY_PATTERNS: FuzzyPattern[] = [
  // Missing categories
  {
    pattern: /\bsock(?:s)?\b|\bhosiery\b/i,
    mapping: {
      productCategory: "accessories",
      confidence: 0.8,
      alternativeCategories: ["underwear", "socks"],
      attributes: {},
    },
  },
  {
    pattern: /\bunderwear\b|\bbriefs?\b|\bboxers?\b|\bbra\b|\blingerie\b|\bpanties\b/i,
    mapping: {
      productCategory: "underwear",
      confidence: 0.85,
      alternativeCategories: [],
      attributes: {},
    },
  },
  {
    pattern: /\bgloves?\b/i,
    mapping: {
      productCategory: "accessories",
      confidence: 0.85,
      alternativeCategories: ["gloves"],
      attributes: {},
    },
  },
  {
    pattern: /\btie\b|\bbow\s*tie\b|\bnecktie\b/i,
    mapping: {
      productCategory: "accessories",
      confidence: 0.9,
      alternativeCategories: ["ties"],
      attributes: { formalityHint: 8 },
    },
  },

  // Ambiguous category disambiguation
  {
    pattern: /\bblazer\b|\bsuit\s*jacket\b|\bsport\s*coat\b/i,
    mapping: {
      productCategory: "outerwear",
      confidence: 0.9,
      alternativeCategories: ["blazers"],
      attributes: { formalityHint: 7 },
    },
  },
  {
    pattern: /\bdenim\s*jacket\b|\bjean\s*jacket\b/i,
    mapping: {
      productCategory: "outerwear",
      confidence: 0.9,
      alternativeCategories: ["jackets", "denim"],
      attributes: { formalityHint: 4 },
    },
  },
  {
    pattern: /\bleather\s*jacket\b/i,
    mapping: {
      productCategory: "outerwear",
      confidence: 0.9,
      alternativeCategories: ["jackets", "leather"],
      attributes: { formalityHint: 5 },
    },
  },

  // Swimwear
  {
    pattern: /\bswim(?:suit|wear)?\b|\bbikini\b|\btrunks\b/i,
    mapping: {
      productCategory: "swimwear",
      confidence: 0.9,
      alternativeCategories: [],
      attributes: {},
    },
  },

  // Activewear
  {
    pattern: /\bactivewear\b|\bsportswear\b|\bgym\b|\bworkout\b|\byoga\b/i,
    mapping: {
      productCategory: "activewear",
      confidence: 0.85,
      alternativeCategories: [],
      attributes: {},
    },
  },

  // Generic footwear patterns
  {
    pattern: /\bshoes?\b|\bfootwear\b/i,
    mapping: {
      productCategory: "footwear",
      confidence: 0.75,
      alternativeCategories: ["sneakers", "boots", "heels", "sandals"],
      attributes: {},
    },
  },
];

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Maps a detection label to a product category with confidence scoring.
 *
 * @param label - The YOLO detection label (e.g., "long sleeve top", "shoe")
 * @param detectionConfidence - YOLO detection confidence (0-1), defaults to 1.0
 * @returns CategoryMapping with category, confidence, alternatives, and attributes
 */
export function mapDetectionToCategory(
  label: string,
  detectionConfidence: number = 1.0
): CategoryMapping {
  const normalized = label.toLowerCase().trim();

  // 1. Try exact match in primary mappings
  if (PRIMARY_MAPPINGS[normalized]) {
    const mapping = { ...PRIMARY_MAPPINGS[normalized] };
    mapping.attributes = { ...mapping.attributes };
    mapping.alternativeCategories = [...mapping.alternativeCategories];
    mapping.confidence = mapping.confidence * detectionConfidence;
    return mapping;
  }

  // 2. Try fuzzy pattern matching
  for (const { pattern, mapping } of FUZZY_PATTERNS) {
    if (pattern.test(normalized)) {
      const result = { ...mapping };
      result.attributes = { ...mapping.attributes };
      result.alternativeCategories = [...mapping.alternativeCategories];
      // Slight confidence penalty for fuzzy match
      result.confidence = result.confidence * detectionConfidence * 0.9;
      return result;
    }
  }

  // 3. Fallback: use the label itself as category with low confidence
  return {
    productCategory: normalized.replace(/[_-]/g, " "),
    confidence: 0.5 * detectionConfidence,
    alternativeCategories: [],
    attributes: {},
  };
}

/**
 * Gets all categories to search for (primary + alternatives).
 * Useful for broader search when detection confidence is low.
 *
 * @param mapping - The category mapping result
 * @returns Array of category strings to search
 */
export function getSearchCategories(mapping: CategoryMapping): string[] {
  return [mapping.productCategory, ...mapping.alternativeCategories];
}

/**
 * Determines if we should use alternative categories for broader search.
 * Returns true when confidence is below threshold.
 *
 * @param mapping - The category mapping result
 * @param threshold - Confidence threshold (default 0.8)
 * @returns True if alternatives should be included in search
 */
export function shouldUseAlternatives(
  mapping: CategoryMapping,
  threshold: number = 0.8
): boolean {
  return mapping.confidence < threshold && mapping.alternativeCategories.length > 0;
}

/**
 * Gets a simple category string (backward compatible).
 * Use this when you only need the primary category without confidence.
 *
 * @param label - The YOLO detection label
 * @returns Primary product category string
 */
export function getSimpleCategory(label: string): string {
  return mapDetectionToCategory(label).productCategory;
}
