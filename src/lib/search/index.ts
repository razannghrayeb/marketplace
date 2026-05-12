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
  dedupeImageSearchResults,
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
  isProductTypeDominantQuery,
  inferCategoryCanonical,
} from "./categoryFilter";

export {
  merchandiseVisualSimilarity01,
  type MerchandiseVisualSimilarityResult,
} from "./merchandiseVisualSimilarity";

export {
  expandProductTypesForQuery,
  expandProductTypesForIndexing,
  scoreProductTypeTaxonomyMatch,
  scoreCrossFamilyTypePenalty,
  inferMacroFamiliesFromListingCategoryFields,
  scoreRerankProductTypeBreakdown,
  scoreHypernymDocMatch,
  crossFamilyTypePenaltyEnabled,
  PRODUCT_TYPE_CLUSTERS,
  extractLexicalProductTypeSeeds,
  filterProductTypeSeedsByMappedCategory,
  intentFamiliesForProductCategory,
  extractFashionTypeNounTokens,
  getProductTypePhrasesLongestFirst,
  type RerankTypeBreakdown,
} from "./productTypeTaxonomy";

export { loadProductSearchEnrichmentByIds, canonicalTypeIdsToProductTypeTokens } from "./loadProductSearchEnrichment";
export { computeEmbeddingFashionScore } from "./fashionDomainSignal";
export { isExpansionTermAllowed } from "./expansionAllowlist";

export { searchProductsFilteredBrowse } from "./filteredBrowseSearch";

export {
  buildQueryUnderstanding,
  searchDomainGateEnabled,
  type QueryUnderstanding,
} from "./queryUnderstanding.service";

export {
  emitTextSearchEval,
  emitImageSearchEval,
  searchEvalEnabled,
  searchEvalVariant,
  newSearchEvalId,
  type TextSearchEvalPayload,
  type ImageSearchEvalPayload,
} from "./evalHooks";

export { altImageSearch } from "./altPipeline";
