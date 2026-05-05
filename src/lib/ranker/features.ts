/**
 * Feature Builder - Computes rule-based scores and builds feature rows for ranking
 * 
 * This module:
 * 1. Computes style/color/formality scores using rules
 * 2. Builds one-hot encoded category pair features
 * 3. Assembles complete feature rows for the ranker model
 */
import type { CandidateResult, ProductResult } from "../../routes/products/types";
import type { RankerFeatureRow } from "./client";

// ============================================================================
// Types
// ============================================================================

export interface BaseProductContext {
  id: number;
  title: string;
  brand?: string | null;
  category?: string | null;
  color?: string | null;
  priceCents: number;
  vendorId?: string | null;
  // Detected style attributes
  formality?: number;       // 1-10 scale
  occasion?: string;        // casual, formal, party, etc.
  aesthetic?: string;       // minimalist, bohemian, etc.
  season?: string;          // spring, summer, etc.
}

export interface CandidateWithScores {
  candidate: CandidateResult;
  ruleScores: {
    styleScore: number;
    colorScore: number;
    formalityScore: number;
    occasionScore: number;
  };
  featureRow: Partial<RankerFeatureRow>;
  rankerScore?: number;
}

// ============================================================================
// Color Harmony Rules
// ============================================================================

const COLOR_GROUPS: Record<string, string[]> = {
  neutral:  ["black", "white", "gray", "grey", "beige", "cream", "ivory", "navy", "khaki", "tan", "brown", "charcoal"],
  warm:     ["red", "orange", "yellow", "coral", "peach", "rust", "burgundy", "maroon", "terracotta", "mustard"],
  cool:     ["blue", "green", "purple", "teal", "cyan", "mint", "lavender", "violet", "turquoise", "aqua", "sage", "emerald"],
  pastel:   ["pink", "blush", "lilac", "light blue", "baby blue", "powder", "pale"],
  bright:   ["neon", "hot pink", "electric", "vivid", "fluorescent", "fuchsia", "magenta"],
  metallic: ["silver", "gold", "bronze", "copper", "metallic", "rose gold"],
};

const COLOR_COMPLEMENTS: Record<string, string[]> = {
  // Complementary pairs
  red: ["green", "teal", "cyan"],
  orange: ["blue", "navy"],
  yellow: ["purple", "violet"],
  blue: ["orange", "coral", "rust"],
  green: ["red", "burgundy", "maroon"],
  purple: ["yellow", "gold", "mustard"],
  // Neutrals go with everything
  black: ["white", "red", "pink", "gold", "silver"],
  white: ["black", "navy", "red", "any"],
  navy: ["white", "cream", "gold", "coral"],
  beige: ["navy", "brown", "white", "burgundy"],
};

/**
 * Detect color from product title/color field
 */
function detectColor(product: ProductResult | BaseProductContext): string | null {
  const text = `${(product as any).color || ""} ${product.title || ""}`.toLowerCase();
  
  for (const [group, colors] of Object.entries(COLOR_GROUPS)) {
    for (const color of colors) {
      if (text.includes(color)) {
        return color;
      }
    }
  }
  return null;
}

/**
 * Get color group (neutral, warm, cool, etc.)
 */
function getColorGroup(color: string | null): string {
  if (!color) return "unknown";
  
  for (const [group, colors] of Object.entries(COLOR_GROUPS)) {
    if (colors.some(c => color.includes(c) || c.includes(color))) {
      return group;
    }
  }
  return "unknown";
}

/**
 * Compute color harmony score between base and candidate (0–1).
 * Metallics work universally; neutrals are flexible; non-neutral pairs
 * use the complementary-color map and group-based fallbacks.
 */
export function computeColorScore(base: BaseProductContext, candidate: ProductResult): number {
  const baseColor    = base.color?.toLowerCase()      || detectColor(base);
  const candidateColor = candidate.color?.toLowerCase() || detectColor(candidate);

  if (!baseColor || !candidateColor) return 0.5;

  const baseGroup      = getColorGroup(baseColor);
  const candidateGroup = getColorGroup(candidateColor);

  // Metallics are universally harmonious (silver/gold elevate any outfit)
  if (baseGroup === "metallic" || candidateGroup === "metallic") return 0.88;

  // Neutrals match everything; same neutral = strong monochromatic match
  if (baseGroup === "neutral" || candidateGroup === "neutral") {
    return baseColor === candidateColor ? 0.95 : 0.85;
  }

  // Exact same color
  if (baseColor === candidateColor) return 0.72;

  // Complementary pairs (explicitly listed)
  const complements = COLOR_COMPLEMENTS[baseColor] || [];
  if (complements.some(c => c === "any" || candidateColor.includes(c) || c.includes(candidateColor))) {
    return 0.95;
  }

  // Same color family (e.g., two warm tones)
  if (baseGroup === candidateGroup) return 0.65;

  // Warm + cool contrast — can work stylistically
  if ((baseGroup === "warm" && candidateGroup === "cool") ||
      (baseGroup === "cool" && candidateGroup === "warm")) return 0.58;

  // Pastel pairs well with neutrals and other pastels (handled above), moderate with others
  if (baseGroup === "pastel" || candidateGroup === "pastel") return 0.55;

  return 0.40;
}

// ============================================================================
// Formality/Occasion Rules
// ============================================================================

const FORMALITY_KEYWORDS: Record<string, number> = {
  // Formal (8-10)
  "evening": 9, "gown": 10, "tuxedo": 10, "suit": 9, "blazer": 8,
  "formal": 9, "elegant": 8, "cocktail": 8, "black tie": 10,
  // Semi-formal (5-7)
  "dress": 6, "blouse": 6, "slacks": 6, "loafers": 6, "heels": 7,
  "smart casual": 6, "office": 6, "business": 7,
  // Casual (3-4)
  "jeans": 4, "t-shirt": 3, "tshirt": 3, "sneakers": 3, "casual": 3,
  "cardigan": 4, "polo": 4, "chinos": 4,
  // Very casual (1-2)
  "hoodie": 2, "sweatpants": 1, "shorts": 2, "flip flops": 1,
  "athletic": 2, "sportswear": 2, "activewear": 2, "gym": 1,
};

const OCCASION_KEYWORDS: Record<string, string> = {
  "gym": "active", "workout": "active", "running": "active", "yoga": "active",
  "beach": "beach", "swim": "beach", "pool": "beach",
  "party": "party", "club": "party", "night out": "party", "cocktail": "party",
  "work": "work", "office": "work", "business": "work", "meeting": "work",
  "casual": "casual", "everyday": "casual", "weekend": "casual",
  "formal": "formal", "wedding": "formal", "gala": "formal", "black tie": "formal",
};

/**
 * Detect formality level from product (1-10 scale)
 */
export function detectFormality(product: ProductResult | BaseProductContext): number {
  const text = `${product.title || ""} ${product.category || ""}`.toLowerCase();
  
  let maxFormality = 5; // Default middle
  
  for (const [keyword, formality] of Object.entries(FORMALITY_KEYWORDS)) {
    if (text.includes(keyword)) {
      maxFormality = Math.max(maxFormality, formality);
    }
  }
  
  return maxFormality;
}

/**
 * Detect occasion from product
 */
export function detectOccasion(product: ProductResult | BaseProductContext): string {
  const text = `${product.title || ""} ${product.category || ""}`.toLowerCase();
  
  for (const [keyword, occasion] of Object.entries(OCCASION_KEYWORDS)) {
    if (text.includes(keyword)) {
      return occasion;
    }
  }
  
  return "casual"; // Default
}

/**
 * Compute formality match score
 */
export function computeFormalityScore(base: BaseProductContext, candidate: ProductResult): number {
  const baseFormality = base.formality ?? detectFormality(base as any);
  const candidateFormality = detectFormality(candidate);
  
  const diff = Math.abs(baseFormality - candidateFormality);
  
  // Perfect match
  if (diff === 0) return 1.0;
  // Close (±1)
  if (diff <= 1) return 0.9;
  // Acceptable (±2)
  if (diff <= 2) return 0.75;
  // Stretching it (±3)
  if (diff <= 3) return 0.5;
  // Mismatch
  return Math.max(0.1, 1 - diff * 0.1);
}

/**
 * Compute occasion match score
 */
export function computeOccasionScore(base: BaseProductContext, candidate: ProductResult): number {
  const baseOccasion = base.occasion ?? detectOccasion(base as any);
  const candidateOccasion = detectOccasion(candidate);
  
  if (baseOccasion === candidateOccasion) return 1.0;
  
  // Compatible occasions
  const compatible: Record<string, string[]> = {
    casual: ["work", "beach"],
    work: ["casual", "formal"],
    formal: ["work", "party"],
    party: ["formal", "casual"],
    beach: ["casual", "active"],
    active: ["casual", "beach"],
  };
  
  if (compatible[baseOccasion]?.includes(candidateOccasion)) {
    return 0.7;
  }
  
  return 0.3;
}

/**
 * Compute overall style compatibility score
 */
export function computeStyleScore(base: BaseProductContext, candidate: ProductResult): number {
  const formalityScore = computeFormalityScore(base, candidate);
  const occasionScore = computeOccasionScore(base, candidate);
  
  // Weighted combination
  return formalityScore * 0.6 + occasionScore * 0.4;
}

// ============================================================================
// Category Pair Encoding
// ============================================================================

/**
 * Normalize category name for feature encoding
 */
function normalizeCategory(category: string | null | undefined): string {
  if (!category) return "unknown";
  return category.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 20);
}

/**
 * Build one-hot encoded category pair feature
 */
export function buildCategoryPairFeature(
  baseCategory: string | null | undefined,
  candidateCategory: string | null | undefined
): Record<string, number> {
  const base = normalizeCategory(baseCategory);
  const candidate = normalizeCategory(candidateCategory);
  
  // Return single one-hot feature
  return {
    [`cat_${base}__${candidate}`]: 1,
  };
}

// ============================================================================
// Feature Row Builder
// ============================================================================

/**
 * Build a complete feature row for a candidate
 */
export function buildFeatureRow(
  base: BaseProductContext,
  candidate: CandidateResult,
  position: number
): { featureRow: Partial<RankerFeatureRow>; ruleScores: CandidateWithScores["ruleScores"] } {
  const product = candidate.product;
  
  // Compute rule-based scores
  const colorScore = computeColorScore(base, product);
  const styleScore = computeStyleScore(base, product);
  const formalityScore = computeFormalityScore(base, product);
  const occasionScore = computeOccasionScore(base, product);
  
  // Price features
  const basePriceCents = base.priceCents || 1;
  const candidatePriceCents = product.price_cents || 1;
  const priceRatio = candidatePriceCents / basePriceCents;
  const priceDiffNormalized = Math.min(1, Math.abs(priceRatio - 1) / 2); // Normalize to 0-1
  
  // pHash features
  const pHashDist = candidate.pHashDist ?? 64;
  const pHashSim = 1 - pHashDist / 64;
  
  // Category pair one-hot
  const categoryPair = buildCategoryPairFeature(base.category, product.category);
  
  // Build feature row
  const featureRow: Partial<RankerFeatureRow> = {
    // Core similarity scores
    clip_sim: candidate.clipSim,
    text_sim: candidate.textSim,
    opensearch_score: candidate.opensearchScore,
    candidate_score: candidate.clipSim * 0.6 + candidate.textSim * 0.4,
    
    // pHash
    phash_dist: pHashDist,
    phash_sim: pHashSim,
    
    // Rule-based scores
    style_score: styleScore,
    color_score: colorScore,
    formality_score: formalityScore,
    occasion_score: occasionScore,
    
    // Price features
    price_ratio: priceRatio,
    price_diff_normalized: priceDiffNormalized,
    
    // Brand/vendor
    same_brand: (base.brand?.toLowerCase() === product.brand?.toLowerCase()) ? 1 : 0,
    same_vendor: (base.vendorId === product.vendor_id) ? 1 : 0,
    
    // Position
    original_position: position,
    
    // Category pair one-hot
    ...categoryPair,
  };
  
  return {
    featureRow,
    ruleScores: { styleScore, colorScore, formalityScore, occasionScore },
  };
}

/**
 * Build feature rows for all candidates
 */
export function buildFeatureRows(
  base: BaseProductContext,
  candidates: CandidateResult[]
): CandidateWithScores[] {
  return candidates.map((candidate, index) => {
    const { featureRow, ruleScores } = buildFeatureRow(base, candidate, index + 1);
    
    return {
      candidate,
      ruleScores,
      featureRow,
    };
  });
}
