/**
 * Advanced Color Harmony Analysis
 * 
 * HSL-based color harmony scoring with CLIP embedding fallback
 * for unknown or complex color names.
 */

import { getTextEmbedding, cosineSimilarity } from "../image/clip";

// ============================================================================
// Types
// ============================================================================

export interface HSLColor {
  h: number;  // Hue: 0-360
  s: number;  // Saturation: 0-1
  l: number;  // Lightness: 0-1
}

export interface ColorHarmonyResult {
  score: number;           // 0-1 harmony score
  harmonyType: HarmonyType;
  explanation: string;
}

export type HarmonyType = 
  | "complementary"
  | "analogous"
  | "triadic"
  | "split_complementary"
  | "tetradic"
  | "monochromatic"
  | "neutral"
  | "accent"
  | "unknown";

// ============================================================================
// CSS Named Colors to HSL
// ============================================================================

const NAMED_COLORS: Record<string, HSLColor> = {
  // Neutrals
  black: { h: 0, s: 0, l: 0 },
  white: { h: 0, s: 0, l: 1 },
  gray: { h: 0, s: 0, l: 0.5 },
  grey: { h: 0, s: 0, l: 0.5 },
  silver: { h: 0, s: 0, l: 0.75 },
  beige: { h: 60, s: 0.56, l: 0.91 },
  cream: { h: 60, s: 1, l: 0.94 },
  ivory: { h: 60, s: 1, l: 0.97 },
  tan: { h: 34, s: 0.44, l: 0.69 },
  taupe: { h: 30, s: 0.18, l: 0.45 },
  nude: { h: 25, s: 0.5, l: 0.8 },
  camel: { h: 34, s: 0.5, l: 0.55 },
  brown: { h: 30, s: 0.59, l: 0.41 },
  chocolate: { h: 25, s: 0.75, l: 0.27 },
  khaki: { h: 54, s: 0.38, l: 0.58 },
  charcoal: { h: 0, s: 0, l: 0.21 },
  
  // Reds
  red: { h: 0, s: 1, l: 0.5 },
  crimson: { h: 348, s: 0.83, l: 0.47 },
  maroon: { h: 0, s: 1, l: 0.25 },
  burgundy: { h: 345, s: 0.8, l: 0.25 },
  wine: { h: 348, s: 0.6, l: 0.3 },
  scarlet: { h: 4, s: 1, l: 0.47 },
  rust: { h: 20, s: 0.75, l: 0.4 },
  
  // Oranges
  orange: { h: 30, s: 1, l: 0.5 },
  coral: { h: 16, s: 1, l: 0.66 },
  peach: { h: 28, s: 1, l: 0.86 },
  salmon: { h: 6, s: 0.93, l: 0.71 },
  terracotta: { h: 18, s: 0.5, l: 0.5 },
  apricot: { h: 30, s: 0.9, l: 0.75 },
  
  // Yellows
  yellow: { h: 60, s: 1, l: 0.5 },
  gold: { h: 51, s: 1, l: 0.5 },
  mustard: { h: 50, s: 0.8, l: 0.45 },
  lemon: { h: 55, s: 1, l: 0.6 },
  honey: { h: 45, s: 0.9, l: 0.5 },
  
  // Greens
  green: { h: 120, s: 1, l: 0.25 },
  lime: { h: 75, s: 1, l: 0.5 },
  olive: { h: 80, s: 0.6, l: 0.35 },
  sage: { h: 110, s: 0.25, l: 0.55 },
  mint: { h: 150, s: 0.5, l: 0.75 },
  emerald: { h: 140, s: 0.8, l: 0.4 },
  forest: { h: 100, s: 0.5, l: 0.25 },
  teal: { h: 180, s: 1, l: 0.25 },
  hunter: { h: 130, s: 0.4, l: 0.3 },
  
  // Blues
  blue: { h: 210, s: 1, l: 0.5 },
  navy: { h: 220, s: 1, l: 0.2 },
  royal: { h: 225, s: 0.73, l: 0.57 },
  cobalt: { h: 215, s: 0.9, l: 0.4 },
  turquoise: { h: 174, s: 0.72, l: 0.56 },
  aqua: { h: 180, s: 1, l: 0.5 },
  cyan: { h: 180, s: 1, l: 0.5 },
  sky: { h: 200, s: 0.9, l: 0.7 },
  powder: { h: 200, s: 0.5, l: 0.85 },
  indigo: { h: 275, s: 1, l: 0.25 },
  
  // Purples
  purple: { h: 270, s: 1, l: 0.5 },
  violet: { h: 280, s: 0.8, l: 0.5 },
  lavender: { h: 240, s: 0.67, l: 0.87 },
  lilac: { h: 280, s: 0.5, l: 0.75 },
  plum: { h: 300, s: 0.5, l: 0.35 },
  mauve: { h: 292, s: 0.2, l: 0.5 },
  orchid: { h: 302, s: 0.59, l: 0.65 },
  magenta: { h: 300, s: 1, l: 0.5 },
  fuchsia: { h: 300, s: 1, l: 0.5 },
  
  // Pinks
  pink: { h: 350, s: 1, l: 0.88 },
  blush: { h: 350, s: 0.7, l: 0.85 },
  rose: { h: 340, s: 0.6, l: 0.65 },
  hotpink: { h: 330, s: 1, l: 0.71 },
  dusty_rose: { h: 350, s: 0.3, l: 0.7 },
  
  // Metallics
  gold_metallic: { h: 51, s: 0.85, l: 0.55 },
  silver_metallic: { h: 0, s: 0, l: 0.8 },
  bronze: { h: 30, s: 0.6, l: 0.45 },
  copper: { h: 20, s: 0.7, l: 0.55 },
  rose_gold: { h: 10, s: 0.5, l: 0.7 },
};

// ============================================================================
// Color Parsing
// ============================================================================

/**
 * Parse a color name to HSL
 */
export function parseColorToHSL(colorName: string): HSLColor | null {
  const normalized = colorName.toLowerCase().replace(/[_\-\s]/g, "");
  
  // Check exact match
  if (NAMED_COLORS[normalized]) {
    return NAMED_COLORS[normalized];
  }
  
  // Check partial matches
  for (const [name, hsl] of Object.entries(NAMED_COLORS)) {
    if (normalized.includes(name) || name.includes(normalized)) {
      return hsl;
    }
  }
  
  // Try CSS color function
  if (normalized.startsWith("hsl")) {
    return parseHSLString(colorName);
  }
  
  if (normalized.startsWith("#") || /^[0-9a-f]{6}$/i.test(normalized)) {
    return hexToHSL(normalized.replace("#", ""));
  }
  
  return null;
}

/**
 * Parse HSL string like "hsl(180, 50%, 50%)"
 */
function parseHSLString(str: string): HSLColor | null {
  const match = str.match(/hsl\s*\(\s*(\d+)\s*,\s*(\d+)%?\s*,\s*(\d+)%?\s*\)/i);
  if (!match) return null;
  
  return {
    h: parseInt(match[1], 10),
    s: parseInt(match[2], 10) / 100,
    l: parseInt(match[3], 10) / 100,
  };
}

/**
 * Convert hex to HSL
 */
function hexToHSL(hex: string): HSLColor {
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  
  if (max === min) {
    return { h: 0, s: 0, l };
  }
  
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  
  let h = 0;
  switch (max) {
    case r:
      h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
      break;
    case g:
      h = ((b - r) / d + 2) * 60;
      break;
    case b:
      h = ((r - g) / d + 4) * 60;
      break;
  }
  
  return { h, s, l };
}

// ============================================================================
// Harmony Calculation
// ============================================================================

/**
 * Calculate hue difference (0-180)
 */
function hueDifference(h1: number, h2: number): number {
  const diff = Math.abs(h1 - h2);
  return diff > 180 ? 360 - diff : diff;
}

/**
 * Check if color is neutral (low saturation or extreme lightness)
 */
function isNeutral(color: HSLColor): boolean {
  return color.s < 0.15 || color.l < 0.1 || color.l > 0.9;
}

/**
 * Calculate harmony score between two HSL colors
 */
export function calculateHarmonyScore(
  color1: HSLColor,
  color2: HSLColor
): ColorHarmonyResult {
  // Neutrals go with everything
  if (isNeutral(color1) || isNeutral(color2)) {
    return {
      score: 0.9,
      harmonyType: "neutral",
      explanation: "Neutral colors pair well with any color",
    };
  }
  
  const hueDiff = hueDifference(color1.h, color2.h);
  const satDiff = Math.abs(color1.s - color2.s);
  const lightDiff = Math.abs(color1.l - color2.l);
  
  // Monochromatic (same hue family)
  if (hueDiff < 15) {
    const score = 0.85 + (lightDiff * 0.15); // Benefit from light/dark contrast
    return {
      score: Math.min(0.95, score),
      harmonyType: "monochromatic",
      explanation: "Same color family creates elegant tonal outfit",
    };
  }
  
  // Complementary (opposite)
  if (hueDiff >= 150 && hueDiff <= 180) {
    const score = 0.85 - satDiff * 0.2;
    return {
      score: Math.max(0.6, score),
      harmonyType: "complementary",
      explanation: "Complementary colors create bold contrast",
    };
  }
  
  // Split-complementary
  if ((hueDiff >= 140 && hueDiff < 150) || (hueDiff >= 150 && hueDiff <= 165)) {
    return {
      score: 0.8,
      harmonyType: "split_complementary",
      explanation: "Split-complementary provides balanced contrast",
    };
  }
  
  // Triadic
  if (hueDiff >= 110 && hueDiff <= 130) {
    return {
      score: 0.75,
      harmonyType: "triadic",
      explanation: "Triadic harmony offers vibrant combination",
    };
  }
  
  // Analogous (adjacent)
  if (hueDiff >= 15 && hueDiff <= 45) {
    const score = 0.9 - (hueDiff - 15) / 90; // Closer = better
    return {
      score: Math.max(0.75, score),
      harmonyType: "analogous",
      explanation: "Adjacent colors create cohesive look",
    };
  }
  
  // Tetradic
  if (hueDiff >= 80 && hueDiff <= 100) {
    return {
      score: 0.65,
      harmonyType: "tetradic",
      explanation: "Tetradic harmony - use one dominant color",
    };
  }
  
  // Default: calculate based on relationship
  const baseScore = 0.5;
  const hueScore = 1 - Math.min(hueDiff / 180, 1) * 0.3;
  const contrastBonus = lightDiff > 0.3 ? 0.1 : 0;
  
  return {
    score: Math.max(0.4, baseScore + hueScore * 0.3 + contrastBonus),
    harmonyType: "unknown",
    explanation: "These colors can work with careful styling",
  };
}

// ============================================================================
// CLIP Embedding Fallback
// ============================================================================

// Cache for color embeddings
const colorEmbeddingCache = new Map<string, number[]>();

/**
 * Get or compute color embedding
 */
async function getColorEmbedding(colorName: string): Promise<number[]> {
  const cacheKey = colorName.toLowerCase();
  
  if (colorEmbeddingCache.has(cacheKey)) {
    return colorEmbeddingCache.get(cacheKey)!;
  }
  
  const prompt = `A fashion item in ${colorName} color`;
  const embedding = await getTextEmbedding(prompt);
  
  colorEmbeddingCache.set(cacheKey, embedding);
  return embedding;
}

/**
 * Calculate harmony using CLIP embeddings (for unknown colors)
 */
export async function calculateHarmonyWithCLIP(
  color1Name: string,
  color2Name: string
): Promise<ColorHarmonyResult> {
  try {
    const [emb1, emb2] = await Promise.all([
      getColorEmbedding(color1Name),
      getColorEmbedding(color2Name),
    ]);
    
    const similarity = cosineSimilarity(emb1, emb2);
    
    // Invert similarity for harmony (too similar = boring)
    // Sweet spot is around 0.5-0.7 similarity
    let score: number;
    if (similarity > 0.85) {
      score = 0.8; // Very similar colors (monochromatic)
    } else if (similarity > 0.65) {
      score = 0.75; // Similar-ish (analogous)
    } else if (similarity > 0.4) {
      score = 0.85; // Good contrast (complementary-ish)
    } else {
      score = 0.6; // Very different
    }
    
    return {
      score,
      harmonyType: "unknown",
      explanation: `Color relationship determined via visual similarity`,
    };
  } catch (err) {
    console.warn("[ColorHarmony] CLIP fallback failed:", err);
    return {
      score: 0.5,
      harmonyType: "unknown",
      explanation: "Could not determine color relationship",
    };
  }
}

// ============================================================================
// Main API
// ============================================================================

/**
 * Calculate color harmony between two color names
 */
export async function getColorHarmony(
  color1: string,
  color2: string
): Promise<ColorHarmonyResult> {
  const hsl1 = parseColorToHSL(color1);
  const hsl2 = parseColorToHSL(color2);
  
  // If both colors can be parsed, use HSL harmony
  if (hsl1 && hsl2) {
    return calculateHarmonyScore(hsl1, hsl2);
  }
  
  // Fallback to CLIP for unknown colors
  return calculateHarmonyWithCLIP(color1, color2);
}

/**
 * Get all harmonious colors for a given color
 */
export function getHarmoniousColors(color: string): string[] {
  const hsl = parseColorToHSL(color);
  if (!hsl) {
    return ["black", "white", "gray", "navy", "beige"]; // Safe defaults
  }
  
  const harmonious: string[] = [];
  
  // Always include neutrals
  harmonious.push("black", "white", "gray");
  
  // Add analogous colors
  const analogous1 = (hsl.h + 30) % 360;
  const analogous2 = (hsl.h - 30 + 360) % 360;
  
  // Add complementary
  const complementary = (hsl.h + 180) % 360;
  
  // Find named colors near these hues
  for (const [name, namedHsl] of Object.entries(NAMED_COLORS)) {
    if (isNeutral(namedHsl)) continue;
    
    const diff = hueDifference(namedHsl.h, analogous1);
    if (diff < 20) harmonious.push(name);
    
    const diff2 = hueDifference(namedHsl.h, analogous2);
    if (diff2 < 20) harmonious.push(name);
    
    const diffComp = hueDifference(namedHsl.h, complementary);
    if (diffComp < 20) harmonious.push(name);
  }
  
  return [...new Set(harmonious)].slice(0, 10);
}

/**
 * Score a full outfit's color harmony
 */
export async function scoreOutfitColors(
  colors: string[]
): Promise<{ score: number; issues: string[] }> {
  if (colors.length < 2) {
    return { score: 1, issues: [] };
  }
  
  let totalScore = 0;
  let pairCount = 0;
  const issues: string[] = [];
  
  // Check all pairs
  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      const harmony = await getColorHarmony(colors[i], colors[j]);
      totalScore += harmony.score;
      pairCount++;
      
      if (harmony.score < 0.5) {
        issues.push(`${colors[i]} and ${colors[j]} may clash`);
      }
    }
  }
  
  // Penalize too many bright colors
  const brightCount = colors.filter(c => {
    const hsl = parseColorToHSL(c);
    return hsl && hsl.s > 0.7 && hsl.l > 0.4 && hsl.l < 0.7;
  }).length;
  
  if (brightCount > 2) {
    issues.push("Consider balancing with more neutral tones");
    totalScore *= 0.9;
  }
  
  const avgScore = pairCount > 0 ? totalScore / pairCount : 1;
  
  return {
    score: Math.max(0, Math.min(1, avgScore)),
    issues,
  };
}
