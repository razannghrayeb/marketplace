/**
 * Visual Coherence Assessment for Outfits
 *
 * Evaluates how well outfit pieces work together visually using:
 * - Color harmony analysis (complementary, analogous, triadic, etc.)
 * - Style consistency (do pieces match aesthetically?)
 * - Visual balance (proportion, contrast, focal points)
 * - Pattern mixing compatibility
 * - Texture coordination
 * - CLIP embedding similarity for overall aesthetic coherence
 */

import { cosineSimilarity } from '../image/clip';
import { computeOutfitCoherence, type DetectionWithColor } from '../detection/outfitCoherence';

// ============================================================================
// Types
// ============================================================================

export interface OutfitPiece {
  id: number;
  category: string;
  embedding?: number[];
  colors: {
    primary: string[];
    secondary: string[];
    hexCodes: string[];
  };
  pattern?: string;
  material?: string;
  style?: string[];
  formality?: number;  // 1-10 scale
  imageUrl?: string;
}

export interface VisualCoherenceScore {
  overallScore: number;        // 0.0 - 1.0 (1 = perfect coherence)
  colorHarmony: number;         // Color compatibility score
  styleConsistency: number;     // Style alignment score
  visualBalance: number;        // Visual balance score
  patternMixing: number;        // Pattern compatibility score
  textureCoordination: number;  // Texture compatibility score
  aestheticSimilarity: number;  // CLIP embedding similarity

  breakdown: {
    strengths: string[];
    weaknesses: string[];
    recommendations: string[];
  };

  confidence: number;           // How confident we are in this assessment
}

export interface ColorHarmonyAnalysis {
  harmonyType: 'complementary' | 'analogous' | 'triadic' | 'monochromatic' | 'neutral' | 'mixed';
  score: number;
  explanation: string;
  dominantColors: string[];
  accentColors: string[];
}

export interface StyleAnalysis {
  dominantStyle: string;
  styleAlignment: number;       // How well styles align
  conflictingStyles: string[];
  recommendations: string[];
}

// ============================================================================
// Main Assessment Function
// ============================================================================

/**
 * Assess visual coherence of an outfit
 */
export async function assessOutfitCoherence(
  pieces: OutfitPiece[]
): Promise<VisualCoherenceScore> {
  if (pieces.length < 2) {
    throw new Error('Need at least 2 pieces to assess outfit coherence');
  }

  // 1. Color Harmony (30% weight)
  const colorHarmony = assessColorHarmony(pieces);

  // 2. Style Consistency (25% weight)
  const styleConsistency = assessStyleConsistency(pieces);

  // 3. Visual Balance (15% weight)
  const visualBalance = assessVisualBalance(pieces);

  // 4. Pattern Mixing (15% weight)
  const patternMixing = assessPatternMixing(pieces);

  // 5. Texture Coordination (10% weight)
  const textureCoordination = assessTextureCoordination(pieces);

  // 6. Aesthetic Similarity via CLIP (5% weight)
  const aestheticSimilarity = await assessAestheticSimilarity(pieces);

  // Calculate overall score (weighted average)
  const overallScore =
    colorHarmony * 0.30 +
    styleConsistency * 0.25 +
    visualBalance * 0.15 +
    patternMixing * 0.15 +
    textureCoordination * 0.10 +
    aestheticSimilarity * 0.05;

  // Generate feedback
  const breakdown = generateFeedback({
    colorHarmony,
    styleConsistency,
    visualBalance,
    patternMixing,
    textureCoordination,
    pieces,
  });

  // Confidence is higher when we have more data about each piece
  const avgDataCompleteness = pieces.reduce((sum, p) => {
    let completeness = 0;
    if (p.colors.primary.length > 0) completeness += 0.3;
    if (p.pattern) completeness += 0.2;
    if (p.material) completeness += 0.2;
    if (p.style && p.style.length > 0) completeness += 0.2;
    if (p.embedding && p.embedding.length > 0) completeness += 0.1;
    return sum + completeness;
  }, 0) / pieces.length;

  return {
    overallScore,
    colorHarmony,
    styleConsistency,
    visualBalance,
    patternMixing,
    textureCoordination,
    aestheticSimilarity,
    breakdown,
    confidence: avgDataCompleteness,
  };
}

// ============================================================================
// Color Harmony Assessment
// ============================================================================

/**
 * Assess color harmony across outfit pieces
 */
function assessColorHarmony(pieces: OutfitPiece[]): number {
  const allColors: string[] = [];
  const colorCounts = new Map<string, number>();

  // Collect all colors
  for (const piece of pieces) {
    for (const color of [...piece.colors.primary, ...piece.colors.secondary]) {
      allColors.push(color.toLowerCase());
      colorCounts.set(color.toLowerCase(), (colorCounts.get(color.toLowerCase()) || 0) + 1);
    }
  }

  if (allColors.length === 0) {
    return 0.5; // Neutral score if no color data
  }

  // Check for monochromatic (all same color family)
  const uniqueColors = new Set(allColors);
  if (uniqueColors.size <= 2) {
    return 0.9; // High score for monochromatic
  }

  // Check for neutral-heavy outfits (safe choice)
  const neutralColors = ['black', 'white', 'gray', 'grey', 'beige', 'navy', 'brown'];
  const neutralCount = allColors.filter(c => neutralColors.some(n => c.includes(n))).length;
  const neutralRatio = neutralCount / allColors.length;

  if (neutralRatio > 0.7) {
    return 0.85; // High score for neutral-dominated outfits
  }

  // Check for complementary colors (opposite on color wheel)
  const complementaryPairs = [
    ['red', 'green'],
    ['blue', 'orange'],
    ['yellow', 'purple'],
  ];

  for (const [color1, color2] of complementaryPairs) {
    const hasColor1 = allColors.some(c => c.includes(color1));
    const hasColor2 = allColors.some(c => c.includes(color2));
    if (hasColor1 && hasColor2) {
      return 0.8; // Good score for complementary
    }
  }

  // Check for analogous colors (adjacent on color wheel)
  const analogousSets = [
    ['red', 'orange', 'yellow'],
    ['blue', 'green', 'teal'],
    ['purple', 'pink', 'red'],
  ];

  for (const set of analogousSets) {
    const matchCount = set.filter(color => allColors.some(c => c.includes(color))).length;
    if (matchCount >= 2) {
      return 0.85; // High score for analogous
    }
  }

  // Check for too many colors (visual chaos)
  if (uniqueColors.size > 5) {
    return 0.4; // Low score for too many colors
  }

  // Default: moderate harmony
  return 0.65;
}

// ============================================================================
// Style Consistency Assessment
// ============================================================================

/**
 * Assess if styles align well
 */
function assessStyleConsistency(pieces: OutfitPiece[]): number {
  const allStyles: string[] = [];
  const formalityScores: number[] = [];

  for (const piece of pieces) {
    if (piece.style) {
      allStyles.push(...piece.style.map(s => s.toLowerCase()));
    }
    if (piece.formality) {
      formalityScores.push(piece.formality);
    }
  }

  if (allStyles.length === 0) {
    return 0.5; // Neutral if no style data
  }

  // Check for conflicting styles
  const conflictingPairs = [
    ['formal', 'casual'],
    ['sporty', 'formal'],
    ['bohemian', 'minimalist'],
    ['romantic', 'edgy'],
  ];

  for (const [style1, style2] of conflictingPairs) {
    const has1 = allStyles.some(s => s.includes(style1));
    const has2 = allStyles.some(s => s.includes(style2));
    if (has1 && has2) {
      return 0.3; // Low score for conflicting styles
    }
  }

  // Check formality consistency
  if (formalityScores.length >= 2) {
    const maxFormality = Math.max(...formalityScores);
    const minFormality = Math.min(...formalityScores);
    const formalityGap = maxFormality - minFormality;

    if (formalityGap > 4) {
      return 0.4; // Low score for large formality gap
    } else if (formalityGap <= 2) {
      return 0.9; // High score for consistent formality
    }
  }

  // Check for matching styles
  const styleCounts = new Map<string, number>();
  for (const style of allStyles) {
    styleCounts.set(style, (styleCounts.get(style) || 0) + 1);
  }

  const maxStyleCount = Math.max(...Array.from(styleCounts.values()));
  const styleConsistency = maxStyleCount / allStyles.length;

  return Math.min(0.5 + styleConsistency * 0.5, 1.0);
}

// ============================================================================
// Visual Balance Assessment
// ============================================================================

/**
 * Assess visual balance (simplified heuristic)
 */
function assessVisualBalance(pieces: OutfitPiece[]): number {
  // Check for basic outfit structure
  const categories = pieces.map(p => p.category.toLowerCase());

  const hasTop = categories.some(c => ['top', 'shirt', 'blouse', 't-shirt', 'sweater'].includes(c));
  const hasBottom = categories.some(c => ['bottom', 'pants', 'jeans', 'skirt', 'shorts'].includes(c));
  const hasDress = categories.some(c => ['dress', 'gown'].includes(c));
  const hasFootwear = categories.some(c => c.includes('shoe') || c.includes('boot') || c.includes('sandal'));

  // Basic outfit needs top+bottom or dress
  const hasBase = (hasTop && hasBottom) || hasDress;

  if (!hasBase) {
    return 0.4; // Incomplete outfit
  }

  // Bonus for footwear
  const footwearBonus = hasFootwear ? 0.2 : 0;

  // Bonus for outerwear in appropriate categories
  const hasOuterwear = categories.some(c => ['outerwear', 'jacket', 'coat', 'blazer', 'cardigan'].includes(c));
  const outerwearBonus = hasOuterwear ? 0.1 : 0;

  return Math.min(0.7 + footwearBonus + outerwearBonus, 1.0);
}

// ============================================================================
// Pattern Mixing Assessment
// ============================================================================

/**
 * Assess if patterns work together
 */
function assessPatternMixing(pieces: OutfitPiece[]): number {
  const patterns = pieces.map(p => p.pattern?.toLowerCase()).filter(Boolean) as string[];

  if (patterns.length === 0) {
    return 0.9; // No patterns = safe
  }

  if (patterns.length === 1) {
    return 0.85; // Single pattern = generally safe
  }

  // All solid = perfect
  const allSolid = patterns.every(p => p === 'solid' || p === 'plain');
  if (allSolid) {
    return 1.0;
  }

  // Multiple busy patterns = risky
  const busyPatterns = ['floral', 'geometric', 'animal print', 'paisley'];
  const busyCount = patterns.filter(p => busyPatterns.some(b => p.includes(b))).length;

  if (busyCount >= 2) {
    return 0.4; // Low score for multiple busy patterns
  }

  // Stripe + solid = good
  const hasStripes = patterns.some(p => p.includes('stripe'));
  const hasSolid = patterns.some(p => p === 'solid' || p === 'plain');

  if (hasStripes && hasSolid) {
    return 0.85;
  }

  // Different simple patterns can work
  return 0.65;
}

// ============================================================================
// Texture Coordination Assessment
// ============================================================================

/**
 * Assess texture coordination
 */
function assessTextureCoordination(pieces: OutfitPiece[]): number {
  const materials = pieces.map(p => p.material?.toLowerCase()).filter(Boolean) as string[];

  if (materials.length < 2) {
    return 0.7; // Not enough data
  }

  // Check for texture variety (good)
  const uniqueMaterials = new Set(materials);
  if (uniqueMaterials.size === materials.length && materials.length <= 3) {
    return 0.9; // Good variety
  }

  // Check for conflicting textures
  const hasLeather = materials.some(m => m.includes('leather'));
  const hasSilk = materials.some(m => m.includes('silk'));
  const hasDenim = materials.some(m => m.includes('denim'));
  const hasWool = materials.some(m => m.includes('wool'));

  // Leather + silk can be sophisticated
  if (hasLeather && hasSilk) {
    return 0.75;
  }

  // Denim + most things work
  if (hasDenim) {
    return 0.8;
  }

  return 0.7; // Default moderate score
}

// ============================================================================
// Aesthetic Similarity (CLIP Embeddings)
// ============================================================================

/**
 * Assess aesthetic similarity using CLIP embeddings
 */
async function assessAestheticSimilarity(pieces: OutfitPiece[]): Promise<number> {
  const embeddings = pieces
    .map(p => p.embedding)
    .filter((e): e is number[] => e !== undefined && e.length > 0);

  if (embeddings.length < 2) {
    return 0.5; // Can't assess without embeddings
  }

  // Compute pairwise similarities
  const similarities: number[] = [];
  for (let i = 0; i < embeddings.length; i++) {
    for (let j = i + 1; j < embeddings.length; j++) {
      const sim = cosineSimilarity(embeddings[i], embeddings[j]);
      similarities.push(sim);
    }
  }

  // Average similarity
  const avgSimilarity = similarities.reduce((a, b) => a + b, 0) / similarities.length;

  // Convert to 0-1 scale (cosine similarity is -1 to 1, but fashion items usually 0-1)
  return Math.max(0, Math.min(1, avgSimilarity));
}

// ============================================================================
// Feedback Generation
// ============================================================================

/**
 * Generate human-readable feedback
 */
function generateFeedback(scores: {
  colorHarmony: number;
  styleConsistency: number;
  visualBalance: number;
  patternMixing: number;
  textureCoordination: number;
  pieces: OutfitPiece[];
}): { strengths: string[]; weaknesses: string[]; recommendations: string[] } {
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const recommendations: string[] = [];

  // Color Harmony
  if (scores.colorHarmony > 0.8) {
    strengths.push('Excellent color harmony');
  } else if (scores.colorHarmony < 0.5) {
    weaknesses.push('Colors may clash');
    recommendations.push('Try sticking to 2-3 main colors');
  }

  // Style Consistency
  if (scores.styleConsistency > 0.8) {
    strengths.push('Cohesive style');
  } else if (scores.styleConsistency < 0.5) {
    weaknesses.push('Conflicting styles detected');
    recommendations.push('Choose pieces from the same style family');
  }

  // Visual Balance
  if (scores.visualBalance > 0.8) {
    strengths.push('Well-balanced outfit');
  } else {
    recommendations.push('Consider adding footwear or outerwear to complete the look');
  }

  // Pattern Mixing
  if (scores.patternMixing > 0.8) {
    strengths.push('Patterns work well together');
  } else if (scores.patternMixing < 0.5) {
    weaknesses.push('Too many competing patterns');
    recommendations.push('Mix one patterned piece with solids');
  }

  // Texture
  if (scores.textureCoordination > 0.75) {
    strengths.push('Good texture variety');
  }

  return { strengths, weaknesses, recommendations };
}
