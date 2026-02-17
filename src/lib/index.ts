/**
 * Library exports
 * 
 * Organized by functionality:
 * - core/      - Database and OpenSearch clients
 * - image/     - CLIP, image processing, R2 storage
 * - scheduler/ - Job scheduling with BullMQ
 * - worker/    - Job processing worker
 * - products/  - Canonical products and price history
 * - search/    - Semantic search and attribute extraction
 * - compare/   - Product comparison features
 */
export * from "./core/index";
export * from "./image/index";
export * from "./scheduler/index";
export * from "./worker/index";
export * from "./compare/index";
export * from "./outfit/index";

// Product services (import specific exports to avoid conflicts)
export {
  hammingDistance,
  isPHashSimilar,
  levenshteinDistance,
  titleSimilarity,
  normalizeTitle, // Use canonical's version as the main one
  findMatchingCanonical,
  createCanonical,
  attachToCanonical,
  updateCanonicalStats,
  processProductCanonical,
  recomputeAllCanonicals,
  mergeCanonicals,
  getCanonicalWithProducts,
  findSimilarByPHash,
  type CanonicalProduct,
  type CanonicalMatch,
  recordPrice,
  recordPricesBatch,
  takePriceSnapshot,
  getPriceHistory,
  getPriceStats,
  getPriceHistoryDaily,
  findPriceDrops,
  type PriceRecord,
  type PriceStats,
} from "./products/index";

// Search services (rename normalizeTitle to avoid conflict)
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
  extractAttributes,
  extractAttributesSync,
  extractAttributesBatch,
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
} from "./search/index";

// Search normalizeTitle as alias
export { normalizeTitle as normalizeAttributeTitle } from "./search/attributeExtractor";

// Compare services
export * from "./compare";

// Outfit completion / Complete My Style
export * from "./outfit";

// Recommendation system training data
export * from "./recommendations";
