/**
 * Detection Module
 *
 * Provides enhanced detection analysis including:
 * - Category mapping with fuzzy matching
 * - Outfit coherence scoring
 */

export {
  mapDetectionToCategory,
  getSearchCategories,
  shouldUseAlternatives,
  getSimpleCategory,
  type CategoryMapping,
  type CategoryAttributes,
} from "./categoryMapper";

export {
  computeOutfitCoherence,
  type DetectionWithColor,
  type PairwiseScore,
  type OutfitCoherenceResult,
  type CategoryAnalysis,
  type StyleAnalysis,
} from "./outfitCoherence";
