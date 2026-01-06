/**
 * Query Processor Types
 * 
 * Types for query normalization, correction, and rewriting
 */

// ============================================================================
// Script Detection
// ============================================================================

export type ScriptType = "en" | "ar" | "arabizi" | "mixed";

export interface ScriptAnalysis {
  primary: ScriptType;
  hasArabic: boolean;
  hasLatin: boolean;
  hasArabizi: boolean;
  arabicRatio: number;
  latinRatio: number;
}

// ============================================================================
// Correction Results
// ============================================================================

export type CorrectionSource = 
  | "spell_check"      // Edit distance correction
  | "arabizi"          // Arabizi transliteration
  | "brand_alias"      // Brand alias expansion
  | "llm"              // LLM rewrite
  | "none";            // No correction needed

export type ConfidenceLevel = "high" | "medium" | "low";

export interface Correction {
  original: string;
  corrected: string;
  source: CorrectionSource;
  confidence: number;           // 0-1
  confidenceLevel: ConfidenceLevel;
  alternatives?: string[];      // Other possible corrections
}

export interface ExtractedFilters {
  gender?: string;
  color?: string;
  material?: string;
  category?: string;
  brand?: string;
  priceRange?: { min?: number; max?: number };
}

// ============================================================================
// Processed Query
// ============================================================================

export interface ProcessedQuery {
  // Original input
  originalQuery: string;
  
  // Normalized (lowercase, clean punctuation, etc.)
  normalizedQuery: string;
  
  // Script analysis
  script: ScriptAnalysis;
  
  // Corrections applied
  corrections: Correction[];
  
  // Final rewritten query (after all corrections)
  rewrittenQuery: string;
  
  // Should we suggest vs auto-apply?
  autoApply: boolean;
  suggestText?: string;  // "Did you mean...?"
  
  // Extracted filters (gender, etc.) - don't include in text search
  extractedFilters: ExtractedFilters;
  
  // For semantic search
  searchQuery: string;  // Text to use for BM25/vector search
  
  // Embedding (if computed)
  embedding?: number[];
  
  // Processing metadata
  processingTimeMs: number;
  llmUsed: boolean;
  cacheHit: boolean;
}

// ============================================================================
// Dictionary Types
// ============================================================================

export interface DictionaryEntry {
  term: string;
  normalizedTerm: string;
  type: "brand" | "category" | "attribute" | "common_query";
  aliases?: string[];
  arabicForm?: string;
  arabiziForm?: string;
  popularity: number;        // 0-1, from search logs
  embedding?: number[];      // Precomputed embedding
}

export interface Dictionary {
  brands: Map<string, DictionaryEntry>;
  categories: Map<string, DictionaryEntry>;
  attributes: Map<string, DictionaryEntry>;
  commonQueries: Map<string, DictionaryEntry>;
  version: string;
  lastUpdated: Date;
}

// ============================================================================
// LLM Types
// ============================================================================

export interface LLMRewriteRequest {
  originalQuery: string;
  normalizedQuery: string;
  script: ScriptAnalysis;
  allowedBrands: string[];
  allowedCategories: string[];
  allowedGenders: string[];
}

export interface LLMRewriteResponse {
  rewrittenQuery: string;
  confidence: number;
  extractedBrand?: string;
  extractedCategory?: string;
  extractedGender?: string;
  explanation?: string;
}

// ============================================================================
// Cache Types
// ============================================================================

export interface CacheEntry<T> {
  value: T;
  version: string;
  createdAt: number;
  expiresAt: number;
  hitCount: number;
}

export interface QueryCacheStats {
  size: number;
  maxSize: number;
  hitRate: number;
  version: string;
}
