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
  MultiVectorSearchEngine,
  cosineSimilarity,
  normalizeVector,
  blendEmbeddings,
  type SemanticAttribute,
  type AttributeEmbedding,
  type MultiVectorSearchConfig,
  type SearchFilters as MultiVectorSearchFilters,
  type MultiVectorSearchResult,
} from "./multiVectorSearch";

export {
  AttributeEmbeddingGenerator,
  attributeEmbeddings,
} from "./attributeEmbeddings";

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

export {
  HybridSearchService,
  hybridSearch,
  type SearchVectors,
} from "./hybridsearch";

export {
  dedupeSearchResults,
  filterRelatedAgainstMain,
  type DedupSearchResultItem,
  type DedupOptions,
} from "./resultDedup";

export {
  getCategorySearchTerms,
  loadCategoryVocabulary,
  resolveCategoryTermsForOpensearch,
  shouldHardFilterAstCategory,
  isCategoryDominantQuery,
  inferCategoryCanonical,
} from "./categoryFilter";
