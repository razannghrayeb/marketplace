/**
 * Products Module Types
 *
 * Shared type definitions for the products service layer.
 * Organized by concern: search, candidates, facets, results.
 */
import type { ParsedQuery } from "../../lib/search";
import type { QueryAST } from "../../lib/queryProcessor";

// ============================================================================
// Search Filters
// ============================================================================

export interface SearchFilters {
  category?: string | string[];
  brand?: string;
  minPriceCents?: number;
  maxPriceCents?: number;
  currency?: string; // 'LBP' or 'USD' - defaults to LBP
  availability?: boolean;
  vendorId?: string;
  // Attribute filters (extracted from titles)
  color?: string;
  material?: string;
  fit?: string;
  style?: string;
  gender?: string;
  pattern?: string;
}

// ============================================================================
// Search Parameters
// ============================================================================

export interface SearchParams {
  query?: string; // Text search (title)
  imageEmbedding?: number[]; // Vector search (image embedding)
  filters?: SearchFilters;
  page?: number;
  limit?: number;
}

export interface ImageSearchParams extends SearchParams {
  similarityThreshold?: number; // 0-1, default 0.7 (70% similarity)
  includeRelated?: boolean; // Include related by pHash
  pHash?: string; // Optional pHash for visual similarity
}

export interface TextSearchParams extends SearchParams {
  includeRelated?: boolean; // Include related products (same category/brand)
  relatedLimit?: number; // Max related products to return
  useLLM?: boolean; // Allow LLM for ambiguous queries (default false)
}

// ============================================================================
// Product Results
// ============================================================================

export interface ProductImage {
  id: number;
  url: string;
  is_primary: boolean;
}

export interface ProductResult {
  id: string;
  vendor_id: string;
  title: string;
  brand: string | null;
  category: string | null;
  description: string | null;
  size: string | null;
  color: string | null;
  currency: string;
  price_cents: number;
  sales_price_cents: number | null;
  availability: boolean;
  last_seen: Date;
  image_url?: string;
  image_cdn?: string;
  images?: ProductImage[];
  similarity_score?: number; // For image search results
  match_type?: "exact" | "similar" | "related"; // How the product matched
  // Scores from candidate generator
  clipSim?: number; // 0..1 (cosine or normalized)
  textSim?: number; // 0..1 (normalized)
  openSearchScore?: number; // raw or normalized
  pHashDist?: number;
  candidateScore?: number;
}

export interface SearchResultWithRelated {
  results: ProductResult[];
  related?: ProductResult[];
  meta: {
    query?: string;
    threshold?: number;
    total_results: number;
    total_related?: number;
    parsed_query?: ParsedQuery; // Include parsed query info for debugging/transparency
    processed_query?: QueryAST; // Query processing info (corrections, etc.)
    did_you_mean?: string; // Suggestion if not auto-applied
  };
}

// ============================================================================
// Candidate Generator Types
// ============================================================================

export type CandidateSource = "clip" | "text" | "both";

export interface CandidateResult {
  candidateId: string;
  clipSim: number; // 0..1 normalized CLIP similarity
  textSim: number; // 0..1 normalized text/hybrid similarity
  opensearchScore: number; // raw OpenSearch score from text search
  pHashDist?: number; // Hamming distance (0-64), lower = more similar
  source: CandidateSource; // where did this candidate come from
  // Product data
  product: ProductResult;
}

export interface CandidateGeneratorParams {
  baseProductId: string;
  limit?: number; // final number of candidates returned (default 30)
  clipLimit?: number; // how many to pull from CLIP kNN (default 200)
  textLimit?: number; // how many to pull from text search (default 200)
  usePHashDedup?: boolean; // use pHash to filter near-duplicates (default false)
  pHashThreshold?: number; // max Hamming distance to consider duplicate (default 5)
}

export interface CandidateTimings {
  clipMs: number;
  textMs: number;
  pHashMs: number;
  totalMs: number;
}

export interface CandidateGeneratorMeta {
  baseProductId: string;
  clipCandidates: number;
  textCandidates: number;
  mergedTotal: number;
  pHashFiltered: number;
  finalCount: number;
  timings?: CandidateTimings;
}

export interface CandidateGeneratorResult {
  candidates: CandidateResult[];
  meta: CandidateGeneratorMeta;
}

// ============================================================================
// Facets / Aggregations
// ============================================================================

export interface FacetValue {
  value: string;
  count: number;
}

export interface AttributeFacets {
  colors: FacetValue[];
  materials: FacetValue[];
  fits: FacetValue[];
  styles: FacetValue[];
  genders: FacetValue[];
  patterns: FacetValue[];
  brands: FacetValue[];
  categories: FacetValue[];
}

// ============================================================================
// Price Drop Types
// ============================================================================

export interface PriceDropEvent {
  id: number;
  product_id: number;
  old_price_cents: number;
  new_price_cents: number;
  drop_percent: number;
  detected_at: Date;
  title: string;
  brand: string | null;
  image_cdn: string | null;
}
