/**
 * Outfit Coherence Module
 *
 * Computes outfit coherence scores for detected items in an image.
 * Analyzes pairwise compatibility, category completeness, and style consistency.
 * Returns actionable recommendations for improving the outfit.
 */

import type { Detection } from "../image/yolov8Client";
import {
  COLOR_WHEEL,
  CATEGORY_PAIRINGS,
  CATEGORY_STYLE_MAP,
  getColorHarmonies,
  type ProductCategory,
} from "../outfit/completestyle";
import { mapDetectionToCategory } from "./categoryMapper";

// ============================================================================
// Types
// ============================================================================

/** Detection with optional dominant color info */
export interface DetectionWithColor extends Detection {
  dominantColor?: string;
  colorConfidence?: number;
}

/** Pairwise compatibility score between two items */
export interface PairwiseScore {
  itemA: string;
  itemB: string;
  categoryCompatibility: number;
  colorHarmony: number;
  formalityMatch: number;
  overallScore: number;
  reasoning: string;
}

/** Complete outfit coherence analysis */
export interface OutfitCoherenceResult {
  /** Overall coherence score (0-1) */
  overallScore: number;
  /** Pairwise compatibility scores for all item pairs */
  pairwiseScores: PairwiseScore[];
  /** Category composition analysis */
  categoryAnalysis: CategoryAnalysis;
  /** Style consistency analysis */
  styleAnalysis: StyleAnalysis;
  /** Human-readable recommendations */
  recommendations: string[];
}

/** Category composition breakdown */
export interface CategoryAnalysis {
  hasTop: boolean;
  hasBottom: boolean;
  hasDress: boolean;
  hasOuterwear: boolean;
  hasFootwear: boolean;
  hasBag: boolean;
  hasAccessories: boolean;
  /** Whether the outfit has all essential items */
  isCompleteOutfit: boolean;
  /** List of missing essential items */
  missingEssentials: string[];
  /** Categories present in the outfit */
  presentCategories: string[];
}

/** Style consistency analysis */
export interface StyleAnalysis {
  /** Most common occasion from detected items */
  dominantOccasion: string;
  /** Range of formality levels [min, max] */
  formalityRange: [number, number];
  /** How consistent the formality is across items (0-1) */
  formalityConsistency: number;
  /** Average formality level */
  averageFormality: number;
  /** List of aesthetic/style conflicts */
  aestheticConflicts: string[];
}

// ============================================================================
// Category Grouping
// ============================================================================

/** Maps detection labels to outfit groups */
const CATEGORY_GROUPS: Record<string, string[]> = {
  tops: [
    "long sleeve top", "short sleeve top", "shirt", "blouse", "tshirt",
    "sweater", "hoodie", "cardigan", "tank_top", "crop_top", "top",
    "vest", "sling", "sweatshirt",
  ],
  bottoms: [
    "trousers", "pants", "jeans", "shorts", "skirt", "leggings",
  ],
  dresses: [
    "short sleeve dress", "long sleeve dress", "vest dress", "sling dress",
    "dress", "gown", "maxi_dress", "mini_dress", "midi_dress",
    "jumpsuit", "romper",
  ],
  outerwear: [
    "long sleeve outwear", "short sleeve outwear", "jacket", "coat",
    "blazer", "parka", "bomber",
  ],
  footwear: [
    "shoe", "sneakers", "heels", "boots", "sandals", "loafers", "flats",
  ],
  bags: [
    "bag, wallet", "bag", "backpack", "clutch", "tote", "crossbody",
  ],
  accessories: [
    "hat", "headband, head covering, hair accessory", "sunglasses",
    "watch", "belt", "tie", "scarf", "jewelry", "necklace",
    "bracelet", "earrings", "ring", "gloves",
  ],
};

/**
 * Gets the outfit group (tops, bottoms, etc.) for a detection label
 */
function getItemGroup(label: string): string {
  const normalized = label.toLowerCase();
  for (const [group, labels] of Object.entries(CATEGORY_GROUPS)) {
    if (labels.some(l => normalized.includes(l) || l.includes(normalized))) {
      return group;
    }
  }
  return "unknown";
}

// ============================================================================
// Category Compatibility
// ============================================================================

/**
 * Computes category compatibility score between two items
 */
function computeCategoryCompatibility(labelA: string, labelB: string): { score: number; reason: string } {
  const groupA = getItemGroup(labelA);
  const groupB = getItemGroup(labelB);

  // Same group (except accessories) - usually not ideal
  if (groupA === groupB && groupA !== "accessories") {
    // Exception: layering is acceptable
    if (groupA === "tops" || groupA === "outerwear") {
      return { score: 0.6, reason: "Layering combination" };
    }
    return { score: 0.3, reason: "Two items from same category" };
  }

  // Accessories always work
  if (groupA === "accessories" || groupB === "accessories") {
    return { score: 0.85, reason: "Accessories complement any item" };
  }

  // Check if there's a defined pairing
  const categoryA = mapDetectionToCategory(labelA).productCategory as ProductCategory;
  const pairings = CATEGORY_PAIRINGS[categoryA] || [];

  for (const pairing of pairings) {
    const pairingCategories = pairing.categories.map(c => c.toLowerCase());
    const targetGroup = getItemGroup(labelB);
    const targetCategory = mapDetectionToCategory(labelB).productCategory;

    if (pairingCategories.some(c => c === targetCategory || getItemGroup(c) === targetGroup)) {
      // Priority 1 = essential = 0.95, Priority 2 = recommended = 0.8, Priority 3 = optional = 0.65
      const scoreMap: Record<number, number> = { 1: 0.95, 2: 0.8, 3: 0.65 };
      return {
        score: scoreMap[pairing.priority] || 0.7,
        reason: pairing.reason,
      };
    }
  }

  // Check reverse pairing
  const categoryB = mapDetectionToCategory(labelB).productCategory as ProductCategory;
  const reversePairings = CATEGORY_PAIRINGS[categoryB] || [];

  for (const pairing of reversePairings) {
    const pairingCategories = pairing.categories.map(c => c.toLowerCase());
    const targetGroup = getItemGroup(labelA);
    const targetCategory = mapDetectionToCategory(labelA).productCategory;

    if (pairingCategories.some(c => c === targetCategory || getItemGroup(c) === targetGroup)) {
      const scoreMap: Record<number, number> = { 1: 0.95, 2: 0.8, 3: 0.65 };
      return {
        score: scoreMap[pairing.priority] || 0.7,
        reason: pairing.reason,
      };
    }
  }

  return { score: 0.5, reason: "Neutral pairing" };
}

// ============================================================================
// Color Harmony
// ============================================================================

/**
 * Computes color harmony between two items
 */
function computeDetectionColorHarmony(
  colorA: string | undefined,
  colorB: string | undefined
): { score: number; reason: string } {
  if (!colorA || !colorB) {
    return { score: 0.5, reason: "Color information unavailable" };
  }

  const normalizedA = colorA.toLowerCase();
  const normalizedB = colorB.toLowerCase();

  const infoA = COLOR_WHEEL[normalizedA];
  const infoB = COLOR_WHEEL[normalizedB];

  if (!infoA || !infoB) {
    return { score: 0.5, reason: "Unknown color combination" };
  }

  // Neutrals match everything
  if (infoA.type === "neutral" || infoB.type === "neutral") {
    return { score: 0.9, reason: "Neutral color pairs well" };
  }

  // Same color = decent but potentially too matchy
  if (normalizedA === normalizedB) {
    return { score: 0.7, reason: "Monochromatic look" };
  }

  // Check color harmonies
  const harmonies = getColorHarmonies(normalizedA);
  for (const harmony of harmonies) {
    if (harmony.colors.includes(normalizedB)) {
      const typeScores: Record<string, number> = {
        complementary: 0.95,
        analogous: 0.85,
        neutral: 0.9,
        monochromatic: 0.75,
        triadic: 0.8,
      };
      return {
        score: typeScores[harmony.type] || 0.7,
        reason: `${harmony.type} color harmony`,
      };
    }
  }

  // Same color temperature
  if (infoA.type === infoB.type) {
    return { score: 0.65, reason: "Same color temperature" };
  }

  // Warm + cool contrast
  if (
    (infoA.type === "warm" && infoB.type === "cool") ||
    (infoA.type === "cool" && infoB.type === "warm")
  ) {
    return { score: 0.6, reason: "Warm-cool contrast" };
  }

  return { score: 0.4, reason: "Colors may clash" };
}

// ============================================================================
// Formality Analysis
// ============================================================================

/** Formality scores by detection label (1-10 scale) */
const FORMALITY_MAP: Record<string, number> = {
  // Dresses
  gown: 9,
  "long sleeve dress": 7,
  "short sleeve dress": 6,
  "vest dress": 5,
  "sling dress": 4,
  dress: 6,
  maxi_dress: 5,
  mini_dress: 5,
  midi_dress: 6,

  // Tops
  "long sleeve top": 5,
  "short sleeve top": 4,
  shirt: 6,
  blouse: 6,
  vest: 4,
  sling: 3,
  tshirt: 3,
  hoodie: 2,
  sweatshirt: 2,
  sweater: 4,
  cardigan: 4,
  tank_top: 2,
  crop_top: 3,
  top: 4,

  // Bottoms
  trousers: 6,
  pants: 5,
  jeans: 3,
  shorts: 2,
  skirt: 5,
  leggings: 1,

  // Outerwear
  "long sleeve outwear": 6,
  "short sleeve outwear": 5,
  blazer: 7,
  coat: 6,
  jacket: 4,
  parka: 3,
  bomber: 3,

  // Footwear
  shoe: 5,
  heels: 8,
  loafers: 6,
  boots: 4,
  flats: 5,
  sneakers: 2,
  sandals: 2,

  // Bags
  clutch: 8,
  "bag, wallet": 5,
  bag: 5,
  tote: 4,
  crossbody: 4,
  backpack: 2,

  // Accessories
  tie: 8,
  watch: 6,
  hat: 3,
  sunglasses: 4,
  belt: 5,
  scarf: 5,
  jewelry: 6,
  necklace: 6,
  bracelet: 5,
  earrings: 6,
};

/**
 * Gets formality score for a detection label
 */
function getDetectionFormality(label: string): number {
  const normalized = label.toLowerCase();
  if (FORMALITY_MAP[normalized] !== undefined) {
    return FORMALITY_MAP[normalized];
  }

  // Try mapping through category
  const mapping = mapDetectionToCategory(label);
  if (mapping.attributes.formalityHint !== undefined) {
    return mapping.attributes.formalityHint;
  }

  // Check CATEGORY_STYLE_MAP
  const category = mapping.productCategory as ProductCategory;
  const style = CATEGORY_STYLE_MAP[category];
  if (style?.formality !== undefined) {
    return style.formality;
  }

  return 5; // Default middle value
}

/**
 * Gets occasion for a detection label
 */
function getDetectionOccasion(label: string): string {
  const category = mapDetectionToCategory(label).productCategory as ProductCategory;
  const style = CATEGORY_STYLE_MAP[category];
  return style?.occasion || "casual";
}

// ============================================================================
// Main Coherence Calculator
// ============================================================================

/**
 * Computes outfit coherence for a set of detections.
 *
 * @param detections - Array of detected items from YOLO
 * @returns Complete coherence analysis with scores and recommendations
 */
export function computeOutfitCoherence(
  detections: DetectionWithColor[]
): OutfitCoherenceResult {
  if (detections.length === 0) {
    return createEmptyResult();
  }

  if (detections.length === 1) {
    return createSingleItemResult(detections[0]);
  }

  const pairwiseScores: PairwiseScore[] = [];
  const groups = new Set<string>();
  const presentCategories: string[] = [];

  // Track which groups are present
  for (const det of detections) {
    const group = getItemGroup(det.label);
    groups.add(group);
    const category = mapDetectionToCategory(det.label).productCategory;
    if (!presentCategories.includes(category)) {
      presentCategories.push(category);
    }
  }

  // Compute pairwise compatibility
  for (let i = 0; i < detections.length; i++) {
    for (let j = i + 1; j < detections.length; j++) {
      const itemA = detections[i];
      const itemB = detections[j];

      const categoryResult = computeCategoryCompatibility(itemA.label, itemB.label);
      const colorResult = computeDetectionColorHarmony(
        itemA.dominantColor,
        itemB.dominantColor
      );

      const formalityA = getDetectionFormality(itemA.label);
      const formalityB = getDetectionFormality(itemB.label);
      const formalityDiff = Math.abs(formalityA - formalityB);
      const formalityScore =
        formalityDiff <= 2 ? 1.0 : formalityDiff <= 4 ? 0.7 : 0.4;

      // Weighted combination
      const overall =
        categoryResult.score * 0.4 +
        colorResult.score * 0.35 +
        formalityScore * 0.25;

      const reasons: string[] = [];
      if (categoryResult.score > 0.7) reasons.push(categoryResult.reason);
      if (colorResult.score > 0.7) reasons.push(colorResult.reason);
      if (formalityScore > 0.7) reasons.push("Consistent formality level");

      pairwiseScores.push({
        itemA: itemA.label,
        itemB: itemB.label,
        categoryCompatibility: categoryResult.score,
        colorHarmony: colorResult.score,
        formalityMatch: formalityScore,
        overallScore: Math.round(overall * 1000) / 1000,
        reasoning: reasons.join("; ") || "Basic compatibility",
      });
    }
  }

  // Category analysis
  const hasTop = groups.has("tops");
  const hasBottom = groups.has("bottoms");
  const hasDress = groups.has("dresses");
  const hasOuterwear = groups.has("outerwear");
  const hasFootwear = groups.has("footwear");
  const hasBag = groups.has("bags");
  const hasAccessories = groups.has("accessories");

  const isCompleteOutfit =
    (hasTop && hasBottom && hasFootwear) || (hasDress && hasFootwear);

  const missingEssentials: string[] = [];
  if (!hasDress) {
    if (!hasTop) missingEssentials.push("top");
    if (!hasBottom) missingEssentials.push("bottom");
  }
  if (!hasFootwear) missingEssentials.push("footwear");

  // Style analysis
  const formalities = detections.map((d) => getDetectionFormality(d.label));
  const minFormality = Math.min(...formalities);
  const maxFormality = Math.max(...formalities);
  const avgFormality =
    formalities.reduce((a, b) => a + b, 0) / formalities.length;
  const formalitySpread = maxFormality - minFormality;
  const formalityConsistency =
    formalitySpread <= 2 ? 1.0 : formalitySpread <= 4 ? 0.7 : 0.4;

  // Detect aesthetic conflicts
  const aestheticConflicts: string[] = [];
  if (formalitySpread > 5) {
    const formalItems = detections
      .filter((d) => getDetectionFormality(d.label) >= 7)
      .map((d) => d.label);
    const casualItems = detections
      .filter((d) => getDetectionFormality(d.label) <= 3)
      .map((d) => d.label);
    if (formalItems.length > 0 && casualItems.length > 0) {
      aestheticConflicts.push(
        `Formal items (${formalItems.join(", ")}) mixed with casual items (${casualItems.join(", ")})`
      );
    }
  }

  // Determine dominant occasion
  const occasionCounts: Record<string, number> = {};
  for (const det of detections) {
    const occasion = getDetectionOccasion(det.label);
    occasionCounts[occasion] = (occasionCounts[occasion] || 0) + 1;
  }
  const dominantOccasion = Object.entries(occasionCounts).sort(
    (a, b) => b[1] - a[1]
  )[0]?.[0] || "casual";

  // Aggregate overall score
  const avgPairwiseScore =
    pairwiseScores.length > 0
      ? pairwiseScores.reduce((sum, p) => sum + p.overallScore, 0) /
        pairwiseScores.length
      : 0.5;

  const completenessBonus = isCompleteOutfit ? 0.1 : 0;
  const consistencyBonus = formalityConsistency > 0.7 ? 0.05 : 0;
  const overallScore = Math.min(
    1.0,
    avgPairwiseScore + completenessBonus + consistencyBonus
  );

  // Generate recommendations
  const recommendations = generateRecommendations({
    isCompleteOutfit,
    missingEssentials,
    formalityConsistency,
    hasBag,
    hasAccessories,
    aestheticConflicts,
    avgFormality,
  });

  return {
    overallScore: Math.round(overallScore * 1000) / 1000,
    pairwiseScores,
    categoryAnalysis: {
      hasTop,
      hasBottom,
      hasDress,
      hasOuterwear,
      hasFootwear,
      hasBag,
      hasAccessories,
      isCompleteOutfit,
      missingEssentials,
      presentCategories,
    },
    styleAnalysis: {
      dominantOccasion,
      formalityRange: [minFormality, maxFormality],
      formalityConsistency,
      averageFormality: Math.round(avgFormality * 10) / 10,
      aestheticConflicts,
    },
    recommendations,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

function createEmptyResult(): OutfitCoherenceResult {
  return {
    overallScore: 0,
    pairwiseScores: [],
    categoryAnalysis: {
      hasTop: false,
      hasBottom: false,
      hasDress: false,
      hasOuterwear: false,
      hasFootwear: false,
      hasBag: false,
      hasAccessories: false,
      isCompleteOutfit: false,
      missingEssentials: ["top", "bottom", "footwear"],
      presentCategories: [],
    },
    styleAnalysis: {
      dominantOccasion: "unknown",
      formalityRange: [0, 0],
      formalityConsistency: 0,
      averageFormality: 0,
      aestheticConflicts: [],
    },
    recommendations: ["No items detected in the image"],
  };
}

function createSingleItemResult(detection: DetectionWithColor): OutfitCoherenceResult {
  const category = mapDetectionToCategory(detection.label).productCategory;
  const group = getItemGroup(detection.label);
  const formality = getDetectionFormality(detection.label);
  const occasion = getDetectionOccasion(detection.label);

  const hasTop = group === "tops";
  const hasBottom = group === "bottoms";
  const hasDress = group === "dresses";

  const missingEssentials: string[] = [];
  if (!hasDress) {
    if (!hasTop) missingEssentials.push("top");
    if (!hasBottom) missingEssentials.push("bottom");
  }
  missingEssentials.push("footwear");

  return {
    overallScore: 0.5,
    pairwiseScores: [],
    categoryAnalysis: {
      hasTop,
      hasBottom,
      hasDress,
      hasOuterwear: group === "outerwear",
      hasFootwear: group === "footwear",
      hasBag: group === "bags",
      hasAccessories: group === "accessories",
      isCompleteOutfit: false,
      missingEssentials,
      presentCategories: [category],
    },
    styleAnalysis: {
      dominantOccasion: occasion,
      formalityRange: [formality, formality],
      formalityConsistency: 1.0,
      averageFormality: formality,
      aestheticConflicts: [],
    },
    recommendations: [
      `Single ${detection.label} detected`,
      `Add ${missingEssentials.join(" and ")} to complete the outfit`,
    ],
  };
}

interface RecommendationContext {
  isCompleteOutfit: boolean;
  missingEssentials: string[];
  formalityConsistency: number;
  hasBag: boolean;
  hasAccessories: boolean;
  aestheticConflicts: string[];
  avgFormality: number;
}

function generateRecommendations(ctx: RecommendationContext): string[] {
  const recommendations: string[] = [];

  if (!ctx.isCompleteOutfit && ctx.missingEssentials.length > 0) {
    recommendations.push(
      `Add ${ctx.missingEssentials.join(" and ")} to complete the outfit`
    );
  }

  if (ctx.formalityConsistency < 0.7) {
    recommendations.push(
      "Consider more cohesive styling - mix of formal and casual items detected"
    );
  }

  if (ctx.aestheticConflicts.length > 0) {
    for (const conflict of ctx.aestheticConflicts) {
      recommendations.push(conflict);
    }
  }

  if (!ctx.hasBag && ctx.isCompleteOutfit) {
    recommendations.push("Consider adding a bag to complete the look");
  }

  if (!ctx.hasAccessories && ctx.isCompleteOutfit && ctx.avgFormality >= 5) {
    recommendations.push("Consider adding accessories to elevate the outfit");
  }

  if (recommendations.length === 0) {
    recommendations.push("Well-coordinated outfit!");
  }

  return recommendations;
}
