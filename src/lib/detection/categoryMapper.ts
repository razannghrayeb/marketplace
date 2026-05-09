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

/**
 * Detection box in normalized coordinates (0-1 range)
 * Used to infer dress length from vertical coverage
 */
export interface NormalizedBox {
  y1: number; // Top edge normalized (0 = image top)
  y2: number; // Bottom edge normalized (1 = image bottom)
}

/**
 * Infers dress length from bounding box height in normalized coordinates.
 * 
 * On a typical full-body fashion image (person standing):
 * - 0.0 = top of image (head)
 * - ~0.5 = waist/hip level
 * - 1.0 = bottom of image (feet)
 * 
 * Dress length calculation:
 * - dress_hemisphere = (y2_norm - 0.5) / 0.5  →  how far dress extends from waist
 * - If > 0.35 of leg height: maxi/long (covers >35% of legs)
 * - If 0.15-0.35: midi (covers 15-35% of legs)
 * - If < 0.15: mini/short (covers <15% of legs)
 * 
 * @param box - Bounding box with normalized Y coordinates
 * @returns "maxi" | "midi" | "mini" | undefined if box data insufficient
 */
export function inferDressLengthFromBox(box: NormalizedBox | undefined): "maxi" | "midi" | "mini" | undefined {
  if (!box || typeof box.y2 !== 'number') return undefined;

  const y1 = box.y1 ?? 0;
  const y2 = box.y2;
  const boxHeight = Math.max(0, y2 - y1);

  // Skip length inference when the dress box is tiny (not a full-body view)
  // or covers the entire image (no frame of reference).
  if (boxHeight < 0.25 || boxHeight > 0.95) return undefined;

  // Portrait / close-crop detection: box starts very near the image top AND
  // spans most of the image height. In this framing the absolute hem position
  // (y2) is unreliable — the image may be cropped to the dress itself rather
  // than showing the full body. Skip inference to avoid mis-classifying a
  // mini or midi as maxi because y2 is large due to cropping.
  if (y1 < 0.06 && boxHeight > 0.65) return undefined;

  // Full-body framing: use the absolute hem position as the length signal.
  const hemRatio = y2;
  if (hemRatio > 0.88) return "maxi";
  if (hemRatio > 0.72) return "midi";
  if (hemRatio > 0.0) return "mini";

  return undefined;
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
    confidence: 0.92,
    alternativeCategories: ["jackets", "coats", "blazers", "vests"],
    attributes: { sleeveLength: "long" },
  },
  "long sleeve outerwear": {
    productCategory: "outerwear",
    confidence: 0.92,
    alternativeCategories: ["jackets", "coats", "blazers", "vests"],
    attributes: { sleeveLength: "long" },
  },
  "short sleeve outwear": {
    productCategory: "outerwear",
    confidence: 0.88,
    alternativeCategories: ["blazers", "vests", "jackets"],
    attributes: { sleeveLength: "short" },
  },
  "short sleeve outerwear": {
    productCategory: "outerwear",
    confidence: 0.88,
    alternativeCategories: ["blazers", "vests", "jackets"],
    attributes: { sleeveLength: "short" },
  },
  vest: {
    productCategory: "outerwear",
    confidence: 0.82,
    alternativeCategories: ["vests", "tops", "activewear"],
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
    alternativeCategories: ["midi-dresses", "mini-dresses", "maxi-dresses"],
    attributes: { sleeveLength: "short" },
  },
  "long sleeve dress": {
    productCategory: "dresses",
    confidence: 0.95,
    alternativeCategories: ["midi-dresses", "maxi-dresses", "mini-dresses"],
    attributes: { sleeveLength: "long" },
  },
  "vest dress": {
    productCategory: "dresses",
    confidence: 0.9,
    alternativeCategories: ["midi-dresses", "mini-dresses", "jumpsuits"],
    attributes: { sleeveLength: "sleeveless" },
  },
  "sling dress": {
    productCategory: "dresses",
    confidence: 0.9,
    alternativeCategories: ["midi-dresses", "mini-dresses", "maxi-dresses"],
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
    alternativeCategories: ["midi-dresses", "mini-dresses", "maxi-dresses"],
    attributes: {},
  },
  gown: {
    productCategory: "dresses",
    confidence: 0.95,
    alternativeCategories: ["maxi-dresses"],
    attributes: { formalityHint: 9 },
  },
  maxi_dress: {
    productCategory: "maxi-dresses",
    confidence: 0.95,
    alternativeCategories: ["dresses", "midi-dresses"],
    attributes: { dressLength: "maxi" },
  },
  long_dress: {
    productCategory: "maxi-dresses",
    confidence: 0.95,
    alternativeCategories: ["dresses", "midi-dresses"],
    attributes: { dressLength: "long" },
  },
  mini_dress: {
    productCategory: "mini-dresses",
    confidence: 0.95,
    alternativeCategories: ["dresses", "midi-dresses"],
    attributes: { dressLength: "mini" },
  },
  midi_dress: {
    productCategory: "midi-dresses",
    confidence: 0.95,
    alternativeCategories: ["dresses", "mini-dresses", "maxi-dresses"],
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
  suit: {
    productCategory: "tailored",
    confidence: 0.92,
    alternativeCategories: ["suits", "blazers", "outerwear"],
    attributes: { formalityHint: 9 },
  },
  suits: {
    productCategory: "tailored",
    confidence: 0.92,
    alternativeCategories: ["suits", "blazers", "outerwear"],
    attributes: { formalityHint: 9 },
  },
  tuxedo: {
    productCategory: "tailored",
    confidence: 0.94,
    alternativeCategories: ["tuxedos", "suits", "blazers", "outerwear"],
    attributes: { formalityHint: 10 },
  },
  tuxedos: {
    productCategory: "tailored",
    confidence: 0.94,
    alternativeCategories: ["tuxedos", "suits", "blazers", "outerwear"],
    attributes: { formalityHint: 10 },
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
  oxfords: {
    productCategory: "footwear",
    confidence: 0.95,
    alternativeCategories: ["oxfords"],
    attributes: { formalityHint: 7 },
  },
  pumps: {
    productCategory: "footwear",
    confidence: 0.95,
    alternativeCategories: ["pumps"],
    attributes: { formalityHint: 8 },
  },
  trainers: {
    productCategory: "footwear",
    confidence: 0.95,
    alternativeCategories: ["sneakers"],
    attributes: { formalityHint: 3 },
  },
  "dress shoes": {
    productCategory: "footwear",
    confidence: 0.95,
    alternativeCategories: ["oxfords"],
    attributes: { formalityHint: 8 },
  },
  "dress shoe": {
    productCategory: "footwear",
    confidence: 0.95,
    alternativeCategories: ["oxfords"],
    attributes: { formalityHint: 8 },
  },
  "running shoes": {
    productCategory: "footwear",
    confidence: 0.95,
    alternativeCategories: ["sneakers"],
    attributes: { formalityHint: 3 },
  },
  "running shoe": {
    productCategory: "footwear",
    confidence: 0.95,
    alternativeCategories: ["sneakers"],
    attributes: { formalityHint: 3 },
  },
  "athletic shoes": {
    productCategory: "footwear",
    confidence: 0.95,
    alternativeCategories: ["sneakers"],
    attributes: { formalityHint: 3 },
  },
  "athletic shoe": {
    productCategory: "footwear",
    confidence: 0.95,
    alternativeCategories: ["sneakers"],
    attributes: { formalityHint: 3 },
  },
  stilettos: {
    productCategory: "footwear",
    confidence: 0.95,
    alternativeCategories: ["heels"],
    attributes: { formalityHint: 9 },
  },
  mules: {
    productCategory: "footwear",
    confidence: 0.95,
    alternativeCategories: ["mules"],
    attributes: { formalityHint: 5 },
  },
  "ankle boots": {
    productCategory: "footwear",
    confidence: 0.95,
    alternativeCategories: ["boots"],
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

function canonicalizeLabelForLookup(value: string): string {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[\/_-]+/g, " ")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const PRIMARY_MAPPINGS_CANONICAL: Record<string, CategoryMapping> = Object.entries(PRIMARY_MAPPINGS).reduce(
  (acc, [label, mapping]) => {
    const key = canonicalizeLabelForLookup(label);
    if (key && !acc[key]) {
      acc[key] = mapping;
    }
    return acc;
  },
  {} as Record<string, CategoryMapping>,
);

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

  // Specific footwear subtypes — BEFORE generic shoe patterns so we catch these first.
  {
    pattern: /\b(oxfords?|brogues?|derbies?|loafers?|moccasins?|dress\s*shoes?|formal\s*shoes?|penny\s*loafers?)\b/i,
    mapping: {
      productCategory: "footwear",
      confidence: 0.92,
      alternativeCategories: ["oxfords", "dress shoes"],
      attributes: { formalityHint: 8 },
    },
  },
  {
    pattern: /\b(pumps?|stilettos?|heels?|wedges?|kitten\s*heels?|platform|slingbacks?)\b/i,
    mapping: {
      productCategory: "footwear",
      confidence: 0.92,
      alternativeCategories: ["heels"],
      attributes: { formalityHint: 8 },
    },
  },
  {
    pattern: /\b(sneakers?|trainers?|running\s*shoes?|athletic\s*shoes?|sport\s*shoes?|tennis\s*shoes?)\b/i,
    mapping: {
      productCategory: "footwear",
      confidence: 0.92,
      alternativeCategories: ["sneakers"],
      attributes: { formalityHint: 3 },
    },
  },
  {
    pattern: /\b(boots?|ankle\s*boots?|chelsea\s*boots?|combat\s*boots?|hiking\s*boots?|rain\s*boots?|cowboy\s*boots?)\b/i,
    mapping: {
      productCategory: "footwear",
      confidence: 0.92,
      alternativeCategories: ["boots"],
      attributes: {},
    },
  },
  {
    pattern: /\b(sandals?|slides?|flip\s*flops?|mules?|clogs?)\b/i,
    mapping: {
      productCategory: "footwear",
      confidence: 0.92,
      alternativeCategories: ["sandals"],
      attributes: { formalityHint: 2 },
    },
  },
  {
    pattern: /\b(flats?|ballet\s*flats?|ballerinas?)\b/i,
    mapping: {
      productCategory: "footwear",
      confidence: 0.92,
      alternativeCategories: ["flats"],
      attributes: {},
    },
  },

  // Bag-specific patterns that frequently appear in captions / detector outputs.
  // Keep these before generic footwear so bag-like labels do not fall through to
  // unknown categories and get dropped by strict bag recovery filters.
  {
    pattern: /\b(handbag|hand bags?|purse|purses|wallet|wallets|tote bag|tote bags?|backpack|backpacks|crossbody bag|crossbody bags?|satchel|satchels|messenger bag|messenger bags?|shoulder bag|shoulder bags?|bucket bag|bucket bags?|hobo bag|hobo bags?|clutch|clutches)\b/i,
    mapping: {
      productCategory: "bags",
      confidence: 0.88,
      alternativeCategories: ["bags", "accessories"],
      attributes: {},
    },
  },

  // Ambiguous category disambiguation
  {
    pattern: /\bsuits?\b|\btuxedos?\b/i,
    mapping: {
      productCategory: "tailored",
      confidence: 0.92,
      alternativeCategories: ["suits", "blazers", "outerwear"],
      attributes: { formalityHint: 9 },
    },
  },
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
 * Optionally infers dress length from bounding box geometry.
 *
 * @param label - The YOLO detection label (e.g., "long sleeve top", "shoe")
 * @param detectionConfidence - YOLO detection confidence (0-1), defaults to 1.0
 * @param detectionBox - Optional normalized bounding box to infer dress length from
 * @returns CategoryMapping with category, confidence, alternatives, and attributes
 */
export function mapDetectionToCategory(
  label: string,
  detectionConfidence: number = 1.0,
  detectionBox?: { box_normalized?: { y1?: number; y2?: number } }
): CategoryMapping {
  const normalized = label.toLowerCase().trim();
  const canonical = canonicalizeLabelForLookup(label);

  // 1. Try exact match in primary mappings
  if (PRIMARY_MAPPINGS[normalized] || (canonical && PRIMARY_MAPPINGS_CANONICAL[canonical])) {
    const baseMapping = PRIMARY_MAPPINGS[normalized] ?? PRIMARY_MAPPINGS_CANONICAL[canonical];
    const mapping = { ...baseMapping };
    mapping.attributes = { ...mapping.attributes };
    mapping.alternativeCategories = [...mapping.alternativeCategories];
    mapping.confidence = mapping.confidence * detectionConfidence;
    
    // Infer dress length from bounding box — store as attribute only; keep productCategory="dresses"
    // so isDressLikeDetectionCategory, isStrictDetectionCategory, and kNN pool sizing still fire.
    if (mapping.productCategory === "dresses" && detectionBox?.box_normalized) {
      const inferredLength = inferDressLengthFromBox({
        y1: detectionBox.box_normalized.y1 ?? 0,
        y2: detectionBox.box_normalized.y2 ?? 1,
      });
      if (inferredLength) {
        mapping.attributes.dressLength = inferredLength;
        // Surface length-specific DB categories as alternatives for soft scoring without
        // changing the primary category (which drives pool sizing and strict gate logic).
        const lengthCategory = inferredLength === "maxi" ? "maxi-dresses" : inferredLength === "midi" ? "midi-dresses" : "mini-dresses";
        const otherLengths = ["midi-dresses", "maxi-dresses", "mini-dresses"].filter(c => c !== lengthCategory);
        mapping.alternativeCategories = [
          lengthCategory,
          ...otherLengths,
          ...mapping.alternativeCategories.filter(c => !["midi-dresses","maxi-dresses","mini-dresses"].includes(c)),
        ];
      }
    }

    return mapping;
  }

  // 2. Try fuzzy pattern matching
  for (const { pattern, mapping } of FUZZY_PATTERNS) {
    if (pattern.test(normalized)) {
      const result = { ...mapping };
      result.attributes = { ...mapping.attributes };
      result.alternativeCategories = [...mapping.alternativeCategories];
      result.confidence = result.confidence * detectionConfidence * 0.9;

      if (result.productCategory === "dresses" && detectionBox?.box_normalized) {
        const inferredLength = inferDressLengthFromBox({
          y1: detectionBox.box_normalized.y1 ?? 0,
          y2: detectionBox.box_normalized.y2 ?? 1,
        });
        if (inferredLength) {
          result.attributes.dressLength = inferredLength;
          const lengthCategory = inferredLength === "maxi" ? "maxi-dresses" : inferredLength === "midi" ? "midi-dresses" : "mini-dresses";
          const otherLengths = ["midi-dresses", "maxi-dresses", "mini-dresses"].filter(c => c !== lengthCategory);
          result.alternativeCategories = [
            lengthCategory,
            ...otherLengths,
            ...result.alternativeCategories.filter(c => !["midi-dresses","maxi-dresses","mini-dresses"].includes(c)),
          ];
        }
      }

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
 * @param threshold - Confidence threshold (default 0.85, raised from 0.8 to prevent low-confidence alternative leakage)
 * @returns True if alternatives should be included in search
 */
export function shouldUseAlternatives(
  mapping: CategoryMapping,
  threshold: number = 0.85
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
