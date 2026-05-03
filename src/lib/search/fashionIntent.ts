/**
 * FashionIntent - Canonical structured representation of a detected fashion item
 *
 * This is the source of truth for every image search. Instead of raw YOLO labels
 * or broad desiredProductTypes, all detection flows produce one FashionIntent.
 *
 * Architecture principle: Detect once, classify richly, search semantically.
 */

export type ImageMode = "single_product" | "worn_outfit" | "flatlay_collage";

export type ProductFamily =
  | "tops"
  | "bottoms"
  | "dresses"
  | "outerwear"
  | "footwear"
  | "bags"
  | "accessories";

export interface ConfidenceScores {
  family: number; // 0-1: how confident is family classification
  type: number; // 0-1: how confident is product type
  subtype: number; // 0-1: how confident is subtype/style variant
  color: number; // 0-1: how confident is color extraction
  audience: number; // 0-1: how confident is gender/age
  sleeve: number; // 0-1: how confident is sleeve length (if applicable)
  length: number; // 0-1: how confident is garment length (if applicable)
  style?: number; // 0-1: how confident is style classification
  material?: number; // 0-1: how confident is material identification
}

export interface FashionIntent {
  /**
   * Single product, person wearing outfit, or flatlay group.
   * Affects recall strategy: single = stricter, outfit/flatlay = broader cross-family.
   */
  imageMode: ImageMode;

  /**
   * High-level product category: tops, bottoms, dresses, outerwear, footwear, bags, accessories.
   * Mandatory. Used for hard family guards.
   */
  family: ProductFamily;

  /**
   * Base product type: shirt, dress, pant, sweater, jacket, shoe, bag, etc.
   * Mandatory. Used for contract exact/strong/related recall.
   */
  type: string;

  /**
   * Optional style variant: button_up_shirt, knit_pullover, wide_leg_pant, etc.
   * When present, used for exact-tier matching. When absent, strong/related used.
   */
  subtype?: string;

  /**
   * Detected color: white, black, blue, gray, beige, red, green, pink, etc.
   * Optional. When present, constrains color tier. When absent, embedding color can't override.
   */
  color?: string;

  /**
   * Inferred target audience: men, women, unisex, unknown.
   * Used for audience compliance. Unknown = no constraint. Opposite = hard cap.
   */
  audience?: "men" | "women" | "unisex" | "unknown";

  /**
   * Sleeve length (if applicable to this family): sleeveless, short, long, unknown.
   * Used for compliance gating on tops/dresses. Only for detection-scoped image search.
   */
  sleeve?: "sleeveless" | "short" | "long" | "unknown";

  /**
   * Garment length (if applicable to this family): mini, midi, maxi, cropped, full, unknown.
   * Used for length compliance gating on dresses/skirts/bottoms.
   */
  length?: "mini" | "midi" | "maxi" | "cropped" | "full" | "unknown";

  /**
   * Silhouette hint: fitted, loose, relaxed, oversized, A-line, straight, etc.
   * Optional. Soft hint for ranking, not hard gate.
   */
  silhouette?: string;

  /**
   * Material hint: cotton, silk, wool, denim, linen, synthetic, knit, etc.
   * Optional. Soft hint for ranking.
   */
  material?: string;

  /**
   * Style intent: formal, casual, sporty, bohemian, minimalist, vintage, etc.
   * Optional. Soft hint for styling compliance.
   */
  style?: string;

  /**
   * Occasion context: daily, business, party, wedding, beach, gym, etc.
   * Optional. Soft hint for occasion compliance.
   */
  occasion?: string;

  /**
   * Confidence scores for each field.
   * Used to modulate tier assignment: high confidence (>0.85) → exact tier possible;
   * low confidence (<0.45) → cap at weak/fallback even with good visual match.
   */
  confidence: ConfidenceScores;
}

/**
 * Build default confidence scores (all 0.5 = uncertain)
 */
export function defaultConfidence(): ConfidenceScores {
  return {
    family: 0.5,
    type: 0.5,
    subtype: 0.5,
    color: 0.5,
    audience: 0.5,
    sleeve: 0.5,
    length: 0.5,
  };
}

/**
 * Build high-confidence scores (all 0.9 = certain)
 */
export function highConfidence(): ConfidenceScores {
  return {
    family: 0.9,
    type: 0.9,
    subtype: 0.9,
    color: 0.9,
    audience: 0.9,
    sleeve: 0.9,
    length: 0.9,
  };
}

/**
 * Create a FashionIntent from explicit parameters
 */
export function createFashionIntent(opts: {
  imageMode: ImageMode;
  family: ProductFamily;
  type: string;
  subtype?: string;
  color?: string;
  audience?: "men" | "women" | "unisex" | "unknown";
  sleeve?: "sleeveless" | "short" | "long" | "unknown";
  length?: "mini" | "midi" | "maxi" | "cropped" | "full" | "unknown";
  silhouette?: string;
  material?: string;
  style?: string;
  occasion?: string;
  confidence?: Partial<ConfidenceScores>;
}): FashionIntent {
  return {
    imageMode: opts.imageMode,
    family: opts.family,
    type: opts.type,
    subtype: opts.subtype,
    color: opts.color,
    audience: opts.audience ?? "unknown",
    sleeve: opts.sleeve,
    length: opts.length,
    silhouette: opts.silhouette,
    material: opts.material,
    style: opts.style,
    occasion: opts.occasion,
    confidence: {
      ...defaultConfidence(),
      ...opts.confidence,
    },
  };
}
