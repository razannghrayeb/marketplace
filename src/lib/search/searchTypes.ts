/**
 * Canonical types for the unified image retrieval platform (all entry modes).
 */

import type { SemanticAttribute } from "./multiVectorSearch";

export type SearchMode =
  | "single_image"
  | "detected_items"
  | "multi_image"
  | "multi_vector";

/** Cross-mode filter bag (HTTP layers map legacy names here). */
export interface SearchFilters {
  brand?: string;
  category?: string | string[];
  minPrice?: number;
  maxPrice?: number;
  color?: string;
  colors?: string[];
  colorMode?: "any" | "all";
  size?: string;
  gender?: string;
  ageGroup?: string;
  vendorId?: number;
  /** Passed through to legacy image search (taxonomy soft boost). */
  productTypes?: string[];
  softStyle?: string;
  softColor?: string;
}

export interface SearchSelectiveShopOptions {
  selectedItemIndices?: number[];
  excludedItemIndices?: number[];
  userDefinedBoxes?: Array<{
    box: { x1: number; y1: number; x2: number; y2: number };
    categoryHint?: string;
    label?: string;
  }>;
  preprocessing?: {
    enhanceContrast?: boolean;
    enhanceSharpness?: boolean;
    bilateralFilter?: boolean;
  };
}

export interface SearchOptions {
  limit?: number;
  /** Shop-the-look: only the strongest garment detection (by confidence × area). */
  mainGarmentOnly?: boolean;
  similarityThreshold?: number;
  limitPerDetection?: number;
  filterByDetectedCategory?: boolean;
  groupByDetection?: boolean;
  includeEmptyDetectionGroups?: boolean;
  explainScores?: boolean;
  rerankWeights?: Record<string, number>;
  storeImage?: boolean;
  /** Detection confidence threshold (shop-the-look). */
  detectionConfidence?: number;
  originalFilename?: string;
  includeRelated?: boolean;
  pHash?: string;
  predictedCategoryAisles?: string[];
  knnField?: string;
  forceHardCategoryFilter?: boolean;
  relaxThresholdWhenEmpty?: boolean;
  selective?: SearchSelectiveShopOptions;
}

export interface SearchRequestContext {
  mode: SearchMode;
  images: Buffer[];
  prompt?: string;
  filters?: SearchFilters;
  attributeWeights?: Partial<Record<SemanticAttribute, number>>;
  options?: SearchOptions;
  precomputedEmbeddings?: {
    global?: number[];
    garment?: number[];
  };
}

export interface SearchDiagnostics {
  embeddingsUsed?: string[];
  attributesUsed?: string[];
  filtersApplied?: Record<string, unknown>;
  rerankSignals?: Record<string, number>;
  detectionFallback?: boolean;
  intentFallback?: boolean;
  geminiDegraded?: boolean;
  searchResultCacheHit?: boolean;
}

export interface RankedProductResult {
  id?: string | number;
  productId?: string;
  score?: number;
  rerankScore?: number;
  rerankBreakdown?: Record<string, number>;
  [key: string]: unknown;
}

export interface DetectionGroupResult {
  detection: {
    label?: string;
    confidence?: number;
    box?: { x1: number; y1: number; x2: number; y2: number };
    [key: string]: unknown;
  };
  category?: string;
  products: RankedProductResult[];
  count?: number;
  detectionIndex?: number;
  /** Selective shop-the-look: `yolo` vs `user_defined` */
  source?: string;
  originalIndex?: number;
}

export interface BaseSearchResponse {
  mode: SearchMode;
  results?: RankedProductResult[];
  groups?: DetectionGroupResult[];
  total: number;
  tookMs: number;
  explanation?: string;
  compositeQuery?: unknown;
  diagnostics?: SearchDiagnostics;
  meta?: Record<string, unknown>;
  /** Present for single_image when callers used the legacy facade shape */
  related?: unknown;
}

export interface VectorQueryPlan {
  opensearchField: string;
  vector: number[];
  k: number;
  attribute: SemanticAttribute;
  weight: number;
}

export interface RerankConfig {
  vectorWeight: number;
  attributeWeight: number;
  priceWeight: number;
  recencyWeight: number;
  explainMode: boolean;
}

export interface RetrievalPlan {
  vectorQueries: VectorQueryPlan[];
  filters: import("./multiVectorSearch").SearchFilters;
  rerankConfig: RerankConfig;
  explainMode: boolean;
}
