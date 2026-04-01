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
  /** Used to bias ranking without hard filtering (image search "closet similar"). */
  softColor?: string;
  /** Multi-color intent (image / enhanced search). */
  colors?: string[];
  colorMode?: "any" | "all";
  /** Taxonomy product types for relevance (e.g. from vision: `["dress"]`, BLIP caption seeds on image upload). */
  productTypes?: string[];
  /** Canonical: kids | baby | teen | adult */
  ageGroup?: string;
  material?: string;
  fit?: string;
  style?: string;
  /** Used to bias ranking without hard filtering (image search "closet similar"). */
  softStyle?: string;
  /** Sleeve intent (short | long | sleeveless) used by reranking. */
  sleeve?: string;
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
  /** Minimum OpenSearch kNN `cosinesimil` score (0–1). Same as raw `hit._score`; monotonic with cosine similarity. */
  similarityThreshold?: number;
  includeRelated?: boolean; // Include related by pHash
  pHash?: string; // Optional pHash for visual similarity
  /** Garment ROI CLIP vector; fused with primary `embedding` kNN when `SEARCH_IMAGE_DUAL_GARMENT_FUSION` is on. */
  imageEmbeddingGarment?: number[];
  /** When set with `includeRelated`, used to compute pHash if `pHash` is omitted */
  imageBuffer?: Buffer;
  /**
   * Aisle-level hints (e.g. bottoms, footwear) for soft category reranking when
   * `SEARCH_IMAGE_SOFT_CATEGORY=1` — avoids hard OpenSearch category filters.
   */
  predictedCategoryAisles?: string[];
  /**
   * OpenSearch kNN vector field name (e.g. `embedding` vs `embedding_garment`).
   * Shop-the-Look / detection crops often match `embedding_garment` when the index is built with garment ROI vectors.
   */
  knnField?: string;
  /**
   * Forces image search into "hard category" mode for this call.
   * When enabled, the OpenSearch `filters.category` terms are applied even if
   * `SEARCH_IMAGE_SOFT_CATEGORY=1` (global soft category).
   */
  forceHardCategoryFilter?: boolean;
  /**
   * When true: if kNN returns hits but none pass `similarityThreshold`, still return the best-scoring candidates
   * (used for Shop-the-Look where crop↔catalog scores are often below a strict gate).
   */
  relaxThresholdWhenEmpty?: boolean;
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
  /** Primary image pHash when loaded from DB (optional, for dedup) */
  p_hash?: string | null;
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
  embedding?: number[]; // Optional vector payload when returned from vector search
  created_at?: string | Date; // Optional for exploration/cold-start logic
  interaction_count?: number; // Optional interaction signal for ranking/boosting
  /** Cosine similarity in [0, 1] (from OpenSearch score via 2·score−1). */
  similarity_score?: number;
  match_type?: "exact" | "similar" | "related"; // How the product matched
  // Deterministic reranking fields (Phase 3)
  rerankScore?: number;
  /** Calibrated 0..1 relevance (text search acceptance gating). */
  finalRelevance01?: number;
  mlRerankScore?: number;
  explain?: {
    exactTypeScore?: number;
    siblingClusterScore?: number;
    parentHypernymScore?: number;
    intraFamilyPenalty?: number;
    productTypeCompliance?: number;
    categoryScore?: number;
    /** Omitted when there is no separate lexical signal (e.g. image-only kNN). */
    lexicalScore?: number;
    semanticScore?: number;
    styleSim?: number;
    colorSim?: number;
    patternSim?: number;
    taxonomyMatch?: number;
    imageCompositeScore?: number;
    colorCompliance?: number; // 0..1
    colorScore?: number;
    globalScore?: number;
    matchedColor?: string;
    colorTier?: "exact" | "family" | "bucket" | "none";
    audienceCompliance?: number;
    crossFamilyPenalty?: number;
    hasTypeIntent?: boolean;
    hasColorIntent?: boolean;
    typeGateFactor?: number;
    hardBlocked?: boolean;
    desiredProductTypes?: string[];
    desiredColors?: string[];
    colorMode?: "any" | "all";
    finalRelevance01?: number;
  };
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
    /** True when every candidate in the recall window scored below the path final-accept gate (text vs image env). */
    below_relevance_threshold?: boolean;
    /** Image search: kNN recall passed CLIP gate but every hit failed final relevance gate (hard mode). */
    below_final_relevance_gate?: boolean;
    relevance_gate_soft?: boolean;
    /** Image kNN: strict similarity gate removed all hits; best candidates returned anyway (relaxThresholdWhenEmpty). */
    threshold_relaxed?: boolean;
    /** OpenSearch kNN field used for retrieval (`embedding` | `embedding_garment`). */
    image_knn_field?: string;
    recall_size?: number;
    final_accept_min?: number;
    /** Floor used after sparse recall when strict gate yields too few hits (≤ `image_min_results_target`). */
    final_accept_min_effective?: number;
    relevance_relaxed_for_min_count?: boolean;
    image_min_results_target?: number;
    /** Count after relevance gate + dedupe (before pagination slice). */
    total_above_threshold?: number;
    open_search_total_estimate?: number;
    pipeline_counts?: {
      /** True when kNN hits were re-scored with exact cosine(query, stored vector). */
      exact_cosine_rerank: boolean;
      /** True when parallel global + garment kNN were merged (max cosine). */
      dual_knn_fusion: boolean;
      /** Unconstrained image search: order by CLIP similarity before metadata relevance. */
      image_rank_visual_first: boolean;
      raw_open_search_hits: number;
      base_candidates: number;
      ranked_candidates: number;
      threshold_passed_visual: number;
      visual_gated_hits: number;
      hits_after_final_accept_min: number;
      hits_after_color_postfilter: number;
      hits_after_hydration: number;
      hits_after_dedupe: number;
      final_returned_count: number;
    };
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
