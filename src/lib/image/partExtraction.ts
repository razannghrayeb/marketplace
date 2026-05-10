/**
 * Part-Level Extraction & Embedding
 *
 * Canonical part slots for fine-grain fashion matching:
 * - Sleeves: top-left, top-right of detected garment ROI
 * - Neckline: top-center of detected garment
 * - Hem/Length: bottom of detected garment
 * - Waistline: lower-third for pants/skirts
 * - Heel/Toe: for shoes
 * - Bag Handle/Body: for bags
 * - Pattern Patch: dominant pattern area if detected
 *
 * INVARIANTS:
 * 1. All part types require minimum 32×32 crop to be meaningful
 * 2. Parts are only extracted for applicable YOLO labels
 * 3. Coordinates are always in ROI-relative space (0-1 normalized)
 * 4. If part extraction fails, return null (not an error)
 * 5. Part embeddings are optional in index (no hard dependency)
 */

// ============================================================================
// Types
// ============================================================================

/** Canonical part types for detailed feature matching */
export enum PartType {
  /** Sleeve area of tops/dresses (applicable to: tshirt, shirt, blouse, dress, jacket, sweater, etc.) */
  Sleeve = 'sleeve',
  
  /** Neckline area of tops (applicable to: tshirt, shirt, blouse, dress, sweater, jacket, etc.) */
  Neckline = 'neckline',
  
  /** Hem/bottom of dresses/pants/skirts (applicable to: dress, pants, jeans, skirt, etc.) */
  Hem = 'hem',
  
  /** Waistline area of pants/skirts (applicable to: pants, jeans, skirt, shorts, etc.) */
  Waistline = 'waistline',
  
  /** Heel area of shoes (applicable to: shoe, heel, boot, etc.) */
  Heel = 'heel',
  
  /** Toe area of shoes (applicable to: shoe, heel, boot, sneaker, etc.) */
  Toe = 'toe',
  
  /** Handle of bags (applicable to: bag, handbag, purse, tote, backpack, etc.) */
  BagHandle = 'bag_handle',
  
  /** Main body of bags (applicable to: bag, handbag, purse, tote, etc.) */
  BagBody = 'bag_body',
  
  /** Pattern patch for patterned items (applicable to: any item with pattern) */
  PatternPatch = 'pattern_patch',
}

/**
 * Part slot definition: defines how to extract a specific part from a detected garment ROI.
 *
 * Coordinates are normalized (0-1) relative to the ROI bounds:
 * - (0, 0) = top-left
 * - (1, 1) = bottom-right
 */
export interface PartSlot {
  /** Unique part identifier */
  type: PartType;
  
  /** Relative bounds within detected ROI (normalized 0-1) */
  relativeBox: {
    x1: number;  // left edge (0 = ROI left, 1 = ROI right)
    y1: number;  // top edge (0 = ROI top, 1 = ROI bottom)
    x2: number;  // right edge
    y2: number;  // bottom edge
  };
  
  /** Minimum pixel dimension for extracted crop (e.g., 32×32 minimum) */
  minDimensionPx: number;
  
  /**
   * YOLO labels this part is applicable to.
   * Lowercase, trimmed strings. Examples: 'dress', 'shirt', 'shoe', 'bag', 'pants'.
   */
  applicableLabels: string[];
  
  /** Human-readable description of this part */
  description: string;
}

/**
 * Part extraction configuration indexed by PartType.
 * These are expert-tuned geometries based on typical garment proportions.
 */
export const CANONICAL_PART_SLOTS: Record<PartType, PartSlot> = {
  /* ========================================================================
   * TOPS / DRESSES (applicable to: tshirt, shirt, blouse, dress, sweater, etc.)
   * ======================================================================== */
  
  [PartType.Sleeve]: {
    type: PartType.Sleeve,
    // Sleeves are at the top-left and top-right of the detected garment.
    // Relative box extracts left shoulder region (can be mirrored for right).
    // Height: from 5% to 35% of ROI (near neckline down past shoulder)
    // Width: left 25% of ROI
    relativeBox: {
      x1: 0.0,    // left edge
      y1: 0.08,   // slightly below neckline
      x2: 0.3,    // ~30% width left side
      y2: 0.42,   // extend to mid-torso
    },
    minDimensionPx: 32,
    applicableLabels: [
      'tshirt', 't-shirt', 'shirt', 'blouse', 'dress', 'gown', 'frock',
      'sweater', 'pullover', 'jumper', 'knitwear', 'hoodie', 'hooded sweatshirt',
      'jacket', 'coat', 'outerwear', 'blazer', 'sportcoat', 'cardigan',
      'vest', 'waistcoat',
    ],
    description: 'Sleeve area (top-left shoulder region)',
  },
  
  [PartType.Neckline]: {
    type: PartType.Neckline,
    // Neckline is at the very top-center of the detected garment ROI.
    // Extracts 40% of width, 15% of height, from top.
    relativeBox: {
      x1: 0.3,    // center-left
      y1: 0.0,    // topmost
      x2: 0.7,    // center-right
      y2: 0.15,   // ~15% height (neckline band)
    },
    minDimensionPx: 32,
    applicableLabels: [
      'tshirt', 't-shirt', 'shirt', 'blouse', 'dress', 'gown', 'frock',
      'sweater', 'pullover', 'jumper', 'knitwear', 'hoodie', 'hooded sweatshirt',
      'jacket', 'coat', 'outerwear', 'blazer', 'sportcoat', 'cardigan',
      'vest', 'waistcoat', 'tank top', 'halter',
    ],
    description: 'Neckline area (top-center of garment)',
  },
  
  [PartType.Hem]: {
    type: PartType.Hem,
    // Hem is the bottom edge of dresses/pants/skirts.
    // Extracts central 60% width, bottom 12% height.
    relativeBox: {
      x1: 0.2,    // slightly inset from edges
      y1: 0.88,   // near bottom
      x2: 0.8,    // central 60%
      y2: 1.0,    // absolute bottom
    },
    minDimensionPx: 32,
    applicableLabels: [
      'dress', 'gown', 'frock', 'pants', 'jeans', 'denim',
      'shorts', 'short pants', 'skirt', 'mini skirt', 'maxi skirt',
      'legging', 'leggings', 'tights',
    ],
    description: 'Hem area (bottom edge of garment)',
  },
  
  [PartType.Waistline]: {
    type: PartType.Waistline,
    // Waistline for pants/skirts is in the lower-middle region.
    // Not at absolute bottom (that's hem), but in the lower third.
    // Extracts 70% width, 12% height.
    relativeBox: {
      x1: 0.15,   // slightly inset
      y1: 0.50,   // middle of garment
      x2: 0.85,   // 70% width
      y2: 0.62,   // ~12% height band
    },
    minDimensionPx: 32,
    applicableLabels: [
      'pants', 'jeans', 'denim', 'shorts', 'short pants',
      'skirt', 'mini skirt', 'maxi skirt',
      'legging', 'leggings', 'tights',
    ],
    description: 'Waistline area (middle of pants/skirts)',
  },
  
  /* ========================================================================
   * SHOES (applicable to: shoe, heel, boot, sneaker, sandal, etc.)
   * ======================================================================== */
  
  [PartType.Heel]: {
    type: PartType.Heel,
    // Heel of shoe is typically at the back (bottom-right area of shoe side view).
    // For shoes in catalog (often top-down view), assume heel is rear 20% width,
    // bottom 30% height.
    relativeBox: {
      x1: 0.75,   // rear/right of shoe
      y1: 0.7,    // lower portion
      x2: 1.0,    // rightmost
      y2: 1.0,    // bottom
    },
    minDimensionPx: 32,
    applicableLabels: [
      'shoe', 'shoes', 'heel', 'heels', 'pump', 'pumps', 'stiletto', 'stilettos',
      'boot', 'boots', 'ankle boot', 'combat boot', 'chelsea boot',
      'sandal', 'sandals', 'flip flops',
    ],
    description: 'Heel area (rear-bottom of shoe)',
  },
  
  [PartType.Toe]: {
    type: PartType.Toe,
    // Toe of shoe is at the front.
    // Typically front 30% width, bottom 40% height.
    relativeBox: {
      x1: 0.0,    // front/left of shoe
      y1: 0.6,    // lower portion
      x2: 0.35,   // front 35%
      y2: 1.0,    // bottommost
    },
    minDimensionPx: 32,
    applicableLabels: [
      'shoe', 'shoes', 'heel', 'heels', 'pump', 'pumps', 'stiletto', 'stilettos',
      'boot', 'boots', 'ankle boot', 'combat boot', 'chelsea boot',
      'sneaker', 'sneakers', 'sandal', 'sandals', 'flip flops',
    ],
    description: 'Toe area (front of shoe)',
  },
  
  /* ========================================================================
   * BAGS (applicable to: bag, handbag, purse, tote, backpack, etc.)
   * ======================================================================== */
  
  [PartType.BagHandle]: {
    type: PartType.BagHandle,
    // Bag handle is at the top-center of a bag image.
    // Extracts central 50%, top 20% of image.
    relativeBox: {
      x1: 0.25,   // center-left
      y1: 0.0,    // topmost
      x2: 0.75,   // center-right
      y2: 0.2,    // top 20%
    },
    minDimensionPx: 32,
    applicableLabels: [
      'bag', 'handbag', 'purse', 'tote', 'tote bag',
      'backpack', 'satchel', 'crossbody', 'clutch',
      'duffel', 'weekender',
    ],
    description: 'Bag handle area (top-center)',
  },
  
  [PartType.BagBody]: {
    type: PartType.BagBody,
    // Bag body is the main visible surface (excluding handle and bottom).
    // Extracts central 70%, middle to bottom 60% of image.
    relativeBox: {
      x1: 0.15,   // sides inset
      y1: 0.25,   // below handle
      x2: 0.85,   // 70% width
      y2: 0.9,    // upper 90%
    },
    minDimensionPx: 32,
    applicableLabels: [
      'bag', 'handbag', 'purse', 'tote', 'tote bag',
      'backpack', 'satchel', 'crossbody', 'clutch',
      'duffel', 'weekender',
    ],
    description: 'Bag body area (main visible surface)',
  },
  
  /* ========================================================================
   * PATTERN PATCH (applicable to any item with observable pattern)
   * ======================================================================== */
  
  [PartType.PatternPatch]: {
    type: PartType.PatternPatch,
    // Pattern patch captures a representative area of item texture/pattern.
    // For patterned items, extract center-right area (often where patterns are most visible).
    // If no pattern detected, this will have low value anyway (filtered in query).
    relativeBox: {
      x1: 0.35,   // right-center
      y1: 0.3,    // middle height
      x2: 0.75,   // right side
      y2: 0.6,    // middle height range
    },
    minDimensionPx: 32,
    applicableLabels: [
      // Applicable to any item (filtered at query time by pattern confidence)
      'tshirt', 't-shirt', 'shirt', 'blouse', 'dress', 'gown', 'frock',
      'sweater', 'pullover', 'jumper', 'pants', 'jeans', 'shorts',
      'skirt', 'jacket', 'coat', 'cardigan', 'bag', 'shoe',
    ],
    description: 'Texture/pattern patch (representative area)',
  },
};

/**
 * Mapping from YOLO label (lowercase) to applicable PartTypes.
 * Used at query time to filter which parts are relevant for retrieved products.
 */
export function getApplicablePartTypesForLabel(label: string): PartType[] {
  const normalized = String(label).toLowerCase().trim();
  if (normalized === "generic" || normalized === "outfit" || normalized === "garment") {
    return getAllPartTypes();
  }
  const applicable: PartType[] = [];
  
  for (const [, slot] of Object.entries(CANONICAL_PART_SLOTS)) {
    if (slot.applicableLabels.includes(normalized)) {
      applicable.push(slot.type);
    }
  }
  
  return applicable;
}

/**
 * Check if a PartType is applicable to a given YOLO label.
 */
export function isPartApplicableToLabel(partType: PartType, label: string): boolean {
  const slot = CANONICAL_PART_SLOTS[partType];
  return slot.applicableLabels.includes(String(label).toLowerCase().trim());
}

/**
 * Get the PartSlot definition for a given PartType.
 */
export function getPartSlot(partType: PartType): PartSlot {
  return CANONICAL_PART_SLOTS[partType];
}

/**
 * Get all PartTypes (used for iteration and benchmarking).
 */
export function getAllPartTypes(): PartType[] {
  return Object.values(PartType);
}

// ============================================================================
// Constants for Safety Checks
// ============================================================================

/** Minimum pixel dimension for a part crop to be usable (32×32 baseline) */
export const MINIMUM_PART_CROP_DIMENSION = 32;

/** All supported part types as an array (for iteration) */
export const PART_TYPES_ARRAY = getAllPartTypes();

/** Number of total part types (for pre-allocation) */
export const PART_TYPES_COUNT = PART_TYPES_ARRAY.length;

// ============================================================================
// Helper: Part Embeddings Result Type
// ============================================================================

/**
 * Result of part extraction & embedding pipeline.
 * Maps PartType to embedding vector (or null if extraction/embedding failed).
 */
export type PartEmbeddingsMap = {
  [K in PartType]?: number[] | null;
};

/**
 * Create an empty part embeddings map for initialization.
 */
export function createEmptyPartEmbeddingsMap(): PartEmbeddingsMap {
  const map: PartEmbeddingsMap = {};
  for (const pt of PART_TYPES_ARRAY) {
    map[pt as PartType] = null;
  }
  return map;
}

/**
 * Count how many part embeddings are non-null (for metrics/logging).
 */
export function countValidPartEmbeddings(map: PartEmbeddingsMap): number {
  return Object.values(map).filter((v) => Array.isArray(v) && v.length > 0).length;
}

/**
 * Validate that a part embeddings map has correct structure.
 * Useful for indexing/retrieval safety checks.
 */
export function isValidPartEmbeddingsMap(
  map: unknown,
  expectedDim: number
): map is PartEmbeddingsMap {
  if (!map || typeof map !== 'object') return false;
  const record = map as Record<string, unknown>;
  
  for (const key of Object.keys(record)) {
    const val = record[key];
    if (val === null || val === undefined) continue;
    if (!Array.isArray(val)) return false;
    if (val.length !== expectedDim) return false;
    if (!val.every((v) => typeof v === 'number')) return false;
  }
  
  return true;
}

// ============================================================================
// Helpful Type for OpenSearch Indexing
// ============================================================================

/**
 * Document fields for part embeddings in OpenSearch.
 * Maps to embedding_part_sleeve, embedding_part_neckline, etc.
 */
export type PartEmbeddingFields = {
  embedding_part_sleeve?: number[] | null;
  embedding_part_neckline?: number[] | null;
  embedding_part_hem?: number[] | null;
  embedding_part_waistline?: number[] | null;
  embedding_part_heel?: number[] | null;
  embedding_part_toe?: number[] | null;
  embedding_part_bag_handle?: number[] | null;
  embedding_part_bag_body?: number[] | null;
  embedding_part_pattern_patch?: number[] | null;
};

/**
 * Convert PartEmbeddingsMap to OpenSearch document fields.
 * Filters out null values to keep document lean.
 */
export function partEmbeddingsToOsFields(
  map: PartEmbeddingsMap
): Partial<PartEmbeddingFields> {
  const fields: Partial<PartEmbeddingFields> = {};
  
  for (const [key, value] of Object.entries(map)) {
    if (Array.isArray(value) && value.length > 0) {
      const fieldName = `embedding_part_${key}` as keyof PartEmbeddingFields;
      (fields as any)[fieldName] = value;
    }
  }
  
  return fields;
}
