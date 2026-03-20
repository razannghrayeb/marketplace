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
  | "common_query"     // Matched a known common query pattern
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
  // Single color (kept for backward compatibility)
  color?: string;
  // Multi-color support
  colors?: string[];
  colorMode?: "any" | "all";
  material?: string;
  category?: string;
  brand?: string;
  priceRange?: { min?: number; max?: number };
  style?: string[];
  similarityReference?: string;
  productTypes?: string[];
}

// ============================================================================
// Query AST (Abstract Syntax Tree) - NEW UNIFIED STRUCTURE
// ============================================================================

export interface QueryIntent {
  type: "search" | "filter" | "comparison" | "completion" | "exploration";
  confidence: number; // 0-1
  description?: string;
}

export interface QueryExpansions {
  synonyms: string[];           // Related terms
  transliterations: string[];   // Arabic/Arabizi variants
  brandAliases: string[];       // Nike -> Just Do It, etc.
  categoryExpansions: string[]; // shirt -> top, blouse, etc.
  corrections: string[];        // Spell corrections
}

export interface QueryEntities {
  brands: string[];
  categories: string[];
  colors: string[];
  productTypes: string[];
  materials: string[];
  patterns: string[];
  sizes: string[];
  gender?: string;
  occasion?: string;
  season?: string;
}

export interface QueryFilters {
  priceRange?: { min?: number; max?: number };
  sizeRange?: string[];
  availability?: "in_stock" | "all";
  rating?: { min?: number };
  brand?: string[];
  category?: string[];
  color?: string[];
  colorMode?: "any" | "all";
  material?: string[];
  gender?: string;
}

export interface QueryTokens {
  original: string[];      // Original words
  normalized: string[];    // Cleaned/lowercased
  stemmed: string[];      // Stemmed forms
  important: string[];    // High-importance terms
  stopwords: string[];    // Filtered out terms
}

/**
 * Unified Query AST - Single output format for all query processing
 */
export interface QueryAST {
  // ========== ORIGINAL INPUT ==========
  original: string;
  normalized: string;

  // ========== TOKENIZATION ==========
  tokens: QueryTokens;

  // ========== ENTITIES ==========
  entities: QueryEntities;

  // ========== FILTERS ==========
  filters: QueryFilters;

  // ========== INTENT ==========
  intent: QueryIntent;

  // ========== EXPANSIONS ==========
  expansions: QueryExpansions;

  // ========== PROCESSING METADATA ==========
  script: ScriptAnalysis;
  corrections: Correction[];
  processingTimeMs: number;
  llmUsed: boolean;
  cacheHit: boolean;
  confidence: number;      // Overall processing confidence

  // ========== SEARCH READY ==========
  searchQuery: string;     // Final query for BM25/vector search
  embedding?: number[];    // Precomputed embedding if available
}

// ============================================================================
// Backward Compatibility - DEPRECATED but maintained
// ============================================================================

/**
 * @deprecated Use QueryAST instead. Maintained for backward compatibility.
 */
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
