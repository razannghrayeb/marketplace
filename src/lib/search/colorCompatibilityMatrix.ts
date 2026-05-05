/**
 * Universal Color Compatibility Matrix
 *
 * Replaces hardcoded color logic ("if white dress then...") with
 * a generic distance function that works for all colors/products.
 *
 * Pattern: intentColor × productColor → compatibility score [0, 1]
 */

type ColorToken = string;

/**
 * Color family groupings (canonical families)
 */
const COLOR_FAMILIES: Record<string, string[]> = {
  // Neutral families
  white: ["white", "off_white", "ivory", "cream", "bone", "ecru", "off-white"],
  black: ["black", "ebony", "charcoal"],
  gray: ["gray", "grey", "charcoal", "slate", "silver", "light_gray", "dark_gray"],
  brown: ["brown", "chocolate", "mocha", "tan", "caramel", "bronze", "cognac"],
  beige: ["beige", "tan", "sand", "stone", "camel", "taupe", "khaki"],
  nude: ["nude", "skin", "blush", "flesh"],

  // Cool families
  blue: ["blue", "navy", "light_blue", "periwinkle", "cornflower", "cobalt", "royal_blue", "sapphire", "denim"],
  teal: ["teal", "turquoise", "cyan", "aqua", "turquoise_blue"],
  green: ["green", "olive", "forest_green", "sage", "mint", "emerald", "lime"],
  purple: ["purple", "violet", "lavender", "plum", "eggplant", "orchid"],
  pink: ["pink", "rose", "fuchsia", "magenta", "hot_pink", "coral_pink", "blush"],
  red: ["red", "crimson", "scarlet", "burgundy", "maroon", "wine", "ruby"],

  // Warm families
  orange: ["orange", "apricot", "peach", "coral", "tangerine"],
  yellow: ["yellow", "gold", "pale_yellow", "butter", "lemon", "mustard"],
  gold: ["gold", "champagne", "bronze", "copper"],

  // Multi-color
  multicolor: ["multicolor", "multi_color", "patterned", "print", "floral", "striped", "checkered"],
  mixed: ["mixed"],
};

/**
 * Canonical color token (normalizes variants to family representative)
 */
function canonicalColorToken(token: string): string {
  const lower = token.toLowerCase().trim().replace(/[\s_-]+/g, "_");

  for (const [family, tokens] of Object.entries(COLOR_FAMILIES)) {
    if (tokens.includes(lower)) {
      return family;
    }
  }

  // Return as-is if not recognized
  return lower;
}

/**
 * Check if two colors are in the same family
 */
function sameColorFamily(color1: string | null, color2: string | null): boolean {
  if (!color1 || !color2) return false;
  return canonicalColorToken(color1) === canonicalColorToken(color2);
}

/**
 * Check if two colors are compatible neutrals (white/black/gray/brown/beige/nude)
 */
function neutralCompatible(color1: string | null, color2: string | null): boolean {
  if (!color1 || !color2) return false;

  const neutrals = ["white", "black", "gray", "brown", "beige", "nude"];
  const c1 = canonicalColorToken(color1);
  const c2 = canonicalColorToken(color2);

  return neutrals.includes(c1) && neutrals.includes(c2);
}

/**
 * Check if two colors are in strong contradiction
 * Examples: white vs black, white vs very dark color
 */
function clearContradiction(color1: string | null, color2: string | null): boolean {
  if (!color1 || !color2) return false;

  const c1 = canonicalColorToken(color1);
  const c2 = canonicalColorToken(color2);

  // White contradicts black, dark colors
  if ((c1 === "white" && (c2 === "black" || c2 === "navy" || c2 === "purple" || c2 === "brown")) ||
      (c2 === "white" && (c1 === "black" || c1 === "navy" || c1 === "purple" || c1 === "brown"))) {
    return true;
  }

  // Black contradicts white, very light colors
  if ((c1 === "black" && (c2 === "white" || c2 === "ivory" || c2 === "cream" || c2 === "nude")) ||
      (c2 === "black" && (c1 === "white" || c1 === "ivory" || c1 === "cream" || c1 === "nude"))) {
    return true;
  }

  return false;
}

/**
 * Check if two colors are exactly the same (canonically)
 */
function sameCanonicalColor(color1: string | null, color2: string | null): boolean {
  if (!color1 || !color2) return false;
  return canonicalColorToken(color1) === canonicalColorToken(color2);
}

/**
 * Universal color compatibility function
 *
 * @param intentColor The intent/desired color (from detection or explicit search)
 * @param productColor The product's normalized color
 * @returns Compatibility score [0, 1]
 *
 * Scoring logic:
 * - Same color: 1.0
 * - Same family: 0.8
 * - Neutral compatible: 0.45
 * - Clear contradiction: 0.15
 * - Unrelated colors: 0.18
 * - No color info: 0.5 (uncertain, not penalized)
 */
export function colorCompatibility(
  intentColor: string | null | undefined,
  productColor: string | null | undefined
): number {
  // No intent color: no color constraint
  if (!intentColor) {
    return 0.5;
  }

  // No product color: cannot judge, neutral position
  if (!productColor) {
    return 0.5;
  }

  // Exact match
  if (sameCanonicalColor(intentColor, productColor)) {
    return 1.0;
  }

  // Same color family
  if (sameColorFamily(intentColor, productColor)) {
    return 0.8;
  }

  // Both neutral: compatible (can wear gray with beige, brown with white, etc.)
  if (neutralCompatible(intentColor, productColor)) {
    return 0.45;
  }

  // Clear contradiction
  if (clearContradiction(intentColor, productColor)) {
    return 0.15;
  }

  // Unrelated colors (e.g., blue vs red, yellow vs purple)
  return 0.18;
}

/**
 * Color score used in match-tier calculation
 * Incorporates both intent-product compatibility and embedding confidence
 *
 * @param intentColor Intent color (from detection/search)
 * @param productColor Product's known normalized color
 * @param embeddingColorSim Raw embedding color similarity [0,1] (optional)
 * @returns Effective color score [0, 1]
 *
 * Rule: Known product color always beats embedding guess
 */
export function effectiveColorScore(
  intentColor: string | null | undefined,
  productColor: string | null | undefined,
  embeddingColorSim?: number
): number {
  const compatibility = colorCompatibility(intentColor, productColor);

  // If we have known product color, use compatibility
  if (productColor) {
    return compatibility;
  }

  // If no product color, can try embedding but cap it
  if (embeddingColorSim !== undefined && embeddingColorSim > 0) {
    // Embedding is uncertain guess; cap at 0.55 (neutral position)
    // This prevents embedding color from overriding intent
    return Math.min(embeddingColorSim, 0.55);
  }

  // No known color, no embedding → uncertain
  return 0.5;
}

/**
 * Get color family name (for debugging/logging)
 */
export function colorFamily(color: string | null | undefined): string {
  if (!color) return "unknown";
  return canonicalColorToken(color);
}

/**
 * Get all canonical color families
 */
export function getAllColorFamilies(): string[] {
  return Object.keys(COLOR_FAMILIES);
}

/**
 * Check if a color token is in a specific family
 */
export function isInColorFamily(color: string | null | undefined, family: string): boolean {
  if (!color) return false;
  const tokens = COLOR_FAMILIES[family.toLowerCase()];
  if (!tokens) return false;
  return tokens.includes(canonicalColorToken(color));
}
