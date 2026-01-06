/**
 * Search Module Exports
 * 
 * Semantic search and attribute extraction.
 */

export {
  parseQuery,
  loadBrandsFromDB,
  loadCategoriesFromDB,
  calculateHybridScore,
  countEntityMatches,
  buildSemanticOpenSearchQuery,
  type QueryEntities,
  type ParsedQuery,
  type QueryIntent,
  type HybridSearchWeights,
} from "./semanticSearch";

export {
  extractAttributes,
  extractAttributesSync,
  extractAttributesBatch,
  normalizeTitle,
  hashTitle,
  extractWithRules,
  getCached,
  setCache,
  clearCache,
  getCacheStats,
  getKnownColors,
  getKnownMaterials,
  getKnownFits,
  validateAttributes,
  type ExtractedAttributes,
  type ExtractionResult,
  type ExtractionOptions,
} from "./attributeExtractor";
