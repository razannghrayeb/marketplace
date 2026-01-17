/**
 * Products Service - Main Entry Point
 *
 * This module re-exports from specialized sub-modules:
 * - types.ts: Shared type definitions
 * - search.service.ts: Text and image search
 * - candidates.service.ts: Candidate generation for recommendations
 * - facets.service.ts: Attribute aggregations
 *
 * Import from this file for backward compatibility,
 * or import from specific sub-modules for cleaner dependencies.
 */

// ============================================================================
// Types
// ============================================================================

export type {
  // Search types
  SearchFilters,
  SearchParams,
  ImageSearchParams,
  TextSearchParams,
  ProductResult,
  ProductImage,
  SearchResultWithRelated,
  // Candidate types
  CandidateSource,
  CandidateResult,
  CandidateGeneratorParams,
  CandidateGeneratorResult,
  CandidateGeneratorMeta,
  CandidateTimings,
  // Facet types
  AttributeFacets,
  FacetValue,
  // Price drop types
  PriceDropEvent,
} from "./types";

// ============================================================================
// Search Functions
// ============================================================================

export {
  searchProducts,
  searchByImageWithSimilarity,
  searchByTextWithRelated,
  findSimilarByPHash,
  findRelatedProducts,
} from "./search.service";

// ============================================================================
// Candidate Generation
// ============================================================================

export { getCandidateScoresForProducts } from "./candidates.service";

// ============================================================================
// Facets & Aggregations
// ============================================================================

export { getAttributeFacets, dropPriceProducts } from "./facets.service";
