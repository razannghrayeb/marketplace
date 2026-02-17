/**
 * Query Processor
 * 
 * Main entry point for query normalization, correction, and rewriting.
 * Implements the full pipeline:
 * 1. Normalize query
 * 2. Detect script (en/ar/arabizi/mixed)
 * 3. Rule-based corrections (spell check, arabizi, brand aliases)
 * 4. Extract filters (gender, etc.)
 * 5. LLM fallback (if needed)
 * 6. Decide auto-apply vs suggest
 * 7. Cache result
 */

import {
  ProcessedQuery,
  ScriptAnalysis,
  Correction,
  ExtractedFilters,
  CorrectionSource,
  ConfidenceLevel,
} from "./types";

import {
  detectScript,
  arabiziToArabic,
  arabicToArabizi,
  normalizeArabic,
  getTransliterationVariants,
  expandFashionTerm,
  FASHION_ARABIZI,
} from "./arabizi";

import {
  correctQuery,
  confidenceToLevel,
  levenshteinDistance,
} from "./spellCorrector";

import {
  getDictionaries,
  findBrand,
  findCategory,
  findAttribute,
  getAllBrandNames,
  getAllCategoryNames,
  getAllGenders,
} from "./dictionary";

import {
  rewriteWithLLM,
  shouldUseLLM,
  isLLMAvailable,
} from "./llmRewriter";

import {
  getCachedQuery,
  cacheQuery,
  getCachedEmbedding,
  cacheEmbedding,
} from "./cache";

import { getTextEmbedding, isClipAvailable } from "../image";

// ============================================================================
// Configuration
// ============================================================================

const CONFIDENCE_THRESHOLDS = {
  autoApply: 0.85,      // Auto-apply correction
  suggest: 0.65,        // Suggest ("Did you mean...?")
  reject: 0.40,         // Reject correction
  llmThreshold: 0.70,   // Minimum LLM confidence to accept
};

// ============================================================================
// Query Normalization
// ============================================================================

/**
 * Normalize query text
 * - lowercase
 * - normalize spaces/punctuation
 * - limit repeated characters
 */
export function normalizeQuery(query: string): string {
  let normalized = query
    .toLowerCase()
    .trim()
    // Normalize Unicode spaces
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, " ")
    // Collapse multiple spaces
    .replace(/\s+/g, " ")
    // Remove excessive punctuation but keep apostrophes and hyphens
    .replace(/[^\w\s\u0600-\u06FF\u0750-\u077F'-]/g, " ")
    // Limit repeated characters (e.g., "niiiiice" → "niice")
    .replace(/(.)\1{2,}/g, "$1$1")
    // Normalize Arabic text
    .trim();
  
  // If contains Arabic, also normalize Arabic-specific characters
  if (/[\u0600-\u06FF]/.test(normalized)) {
    normalized = normalizeArabic(normalized);
  }
  
  return normalized;
}

// ============================================================================
// Filter Extraction
// ============================================================================

/**
 * Extract filters from query without modifying search text
 */
function extractFilters(query: string, script: ScriptAnalysis): {
  filters: ExtractedFilters;
  remainingQuery: string;
} {
  const filters: ExtractedFilters = {};
  let remaining = query;
  const dict = getDictionaries();
  
  // Gender patterns (extract and potentially remove from query)
  const genderPatterns: Array<{ pattern: RegExp; gender: string }> = [
    // English
    { pattern: /\b(mens?|male|boys?)\b/gi, gender: "men" },
    { pattern: /\b(womens?|female|ladies|lady|girls?)\b/gi, gender: "women" },
    { pattern: /\b(kids?|children|child)\b/gi, gender: "kids" },
    { pattern: /\b(unisex|gender\s*neutral)\b/gi, gender: "unisex" },
    // Arabic
    { pattern: /\b(رجالي|للرجال)\b/g, gender: "men" },
    { pattern: /\b(نسائي|للنساء|حريمي)\b/g, gender: "women" },
    { pattern: /\b(أطفال|للأطفال)\b/g, gender: "kids" },
    // Arabizi
    { pattern: /\b(rijali|rejali)\b/gi, gender: "men" },
    { pattern: /\b(nisa2i|nisai|nisaei|7arimi)\b/gi, gender: "women" },
    { pattern: /\b(atfal)\b/gi, gender: "kids" },
  ];
  
  for (const { pattern, gender } of genderPatterns) {
    if (pattern.test(remaining)) {
      filters.gender = gender;
      // Don't remove gender from query - it helps with relevance
      // remaining = remaining.replace(pattern, " ").trim();
      break;
    }
  }
  
  // Color extraction (for filtering, keep in query for relevance)
  for (const [key, entry] of dict.attributes) {
    if (entry.normalizedTerm && remaining.toLowerCase().includes(entry.normalizedTerm)) {
      // Check if it's a color attribute
      const attrData = findAttribute(key);
      if (attrData) {
        // Try to determine type from the entry or its aliases
        const colorTerms = ["black", "white", "red", "blue", "green", "yellow", "pink", "purple", "orange", "brown", "gray", "grey", "beige", "navy"];
        if (colorTerms.includes(entry.normalizedTerm)) {
          filters.color = entry.term;
          break;
        }
      }
    }
  }
  
  // Brand extraction (keep in query)
  const words = remaining.split(/\s+/);
  for (const word of words) {
    const brand = findBrand(word);
    if (brand) {
      filters.brand = brand.term;
      break;
    }
  }
  
  // Category extraction (keep in query)
  for (const word of words) {
    const category = findCategory(word);
    if (category) {
      filters.category = category.term;
      break;
    }
  }
  
  // Clean up remaining query
  remaining = remaining.replace(/\s+/g, " ").trim();
  
  return { filters, remainingQuery: remaining };
}

// ============================================================================
// Arabizi Processing
// ============================================================================

/**
 * Process Arabizi terms in query
 */
function processArabizi(query: string): Correction[] {
  const corrections: Correction[] = [];
  const words = query.split(/\s+/);
  
  for (const word of words) {
    const normalized = word.toLowerCase();
    
    // Check if it's a known Arabizi fashion term
    const fashionTerm = expandFashionTerm(normalized);
    if (fashionTerm) {
      // Use English form for search (more common in product titles)
      if (fashionTerm.english && fashionTerm.english !== normalized) {
        corrections.push({
          original: word,
          corrected: fashionTerm.english,
          source: "arabizi",
          confidence: 0.95,
          confidenceLevel: "high",
          alternatives: [fashionTerm.arabic || ""],
        });
      }
    } else {
      // Check if it looks like Arabizi (has numbers 2-9 mixed with letters)
      if (/[a-z]+[2-9]+[a-z]*/i.test(word) || /[2-9]+[a-z]+/i.test(word)) {
        // Try to transliterate
        const arabicForm = arabiziToArabic(normalized);
        if (arabicForm !== normalized) {
          corrections.push({
            original: word,
            corrected: arabicForm,
            source: "arabizi",
            confidence: 0.75,
            confidenceLevel: "medium",
          });
        }
      }
    }
  }
  
  return corrections;
}

// ============================================================================
// Brand Alias Expansion
// ============================================================================

/**
 * Expand brand aliases to canonical names
 */
function expandBrandAliases(query: string): Correction[] {
  const corrections: Correction[] = [];
  const words = query.split(/\s+/);
  const dict = getDictionaries();
  
  for (const word of words) {
    const normalized = word.toLowerCase();
    
    // Check if it's a brand alias
    const brandEntry = dict.brands.get(normalized);
    if (brandEntry && brandEntry.term.toLowerCase() !== normalized) {
      corrections.push({
        original: word,
        corrected: brandEntry.term,
        source: "brand_alias",
        confidence: 0.95,
        confidenceLevel: "high",
      });
    }
  }
  
  return corrections;
}

// ============================================================================
// Main Processing Pipeline
// ============================================================================

/**
 * Process a search query through the full pipeline
 */
export async function processQuery(query: string): Promise<ProcessedQuery> {
  const startTime = performance.now();
  
  // Check cache first
  const cached = getCachedQuery(query);
  if (cached) {
    return cached;
  }
  
  // Step 1: Normalize query
  const normalizedQuery = normalizeQuery(query);
  
  // Step 2: Detect script
  const script = detectScript(normalizedQuery);
  
  // Step 3: Collect all corrections
  const allCorrections: Correction[] = [];
  
  // 3a: Arabizi processing
  if (script.hasArabizi || script.primary === "arabizi") {
    const arabiziCorrections = processArabizi(normalizedQuery);
    allCorrections.push(...arabiziCorrections);
  }
  
  // 3b: Brand alias expansion
  const brandCorrections = expandBrandAliases(normalizedQuery);
  allCorrections.push(...brandCorrections);
  
  // 3c: Spell correction against dictionaries
  const dict = getDictionaries();
  const spellCorrections = correctQuery(normalizedQuery, {
    brands: dict.brands,
    categories: dict.categories,
    attributes: dict.attributes,
    commonQueries: dict.commonQueries,
  });
  
  // Add spell corrections that don't duplicate existing corrections
  for (const correction of spellCorrections) {
    const alreadyExists = allCorrections.some(
      c => c.original.toLowerCase() === correction.original.toLowerCase()
    );
    if (!alreadyExists) {
      allCorrections.push(correction);
    }
  }
  
  // Step 4: Extract filters
  const { filters, remainingQuery } = extractFilters(normalizedQuery, script);
  
  // Step 5: Calculate overall confidence
  let overallConfidence = 1.0;
  if (allCorrections.length > 0) {
    overallConfidence = allCorrections.reduce((sum, c) => sum + c.confidence, 0) / allCorrections.length;
  }
  
  // Step 6: Decide if LLM is needed
  let llmUsed = false;
  let llmCorrection: Correction | null = null;
  
  if (shouldUseLLM(normalizedQuery, script, allCorrections.length > 0, overallConfidence)) {
    const llmResult = await rewriteWithLLM({
      originalQuery: query,
      normalizedQuery,
      script,
      allowedBrands: getAllBrandNames(),
      allowedCategories: getAllCategoryNames(),
      allowedGenders: getAllGenders(),
    });
    
    if (llmResult && llmResult.confidence >= CONFIDENCE_THRESHOLDS.llmThreshold) {
      llmUsed = true;
      
      // Add LLM correction
      llmCorrection = {
        original: normalizedQuery,
        corrected: llmResult.rewrittenQuery,
        source: "llm",
        confidence: llmResult.confidence,
        confidenceLevel: confidenceToLevel(llmResult.confidence),
      };
      allCorrections.push(llmCorrection);
      
      // Update filters from LLM
      if (llmResult.extractedBrand) filters.brand = llmResult.extractedBrand;
      if (llmResult.extractedCategory) filters.category = llmResult.extractedCategory;
      if (llmResult.extractedGender) filters.gender = llmResult.extractedGender;
      
      // Recalculate overall confidence
      overallConfidence = (overallConfidence + llmResult.confidence) / 2;
    }
  }
  
  // Step 7: Build rewritten query
  let rewrittenQuery = normalizedQuery;
  
  // Apply corrections to query
  for (const correction of allCorrections) {
    if (correction.confidence >= CONFIDENCE_THRESHOLDS.reject) {
      // Case-insensitive replacement
      const regex = new RegExp(`\\b${escapeRegex(correction.original)}\\b`, "gi");
      rewrittenQuery = rewrittenQuery.replace(regex, correction.corrected);
    }
  }
  
  // If LLM provided a full rewrite, use that
  if (llmCorrection && llmCorrection.confidence >= CONFIDENCE_THRESHOLDS.autoApply) {
    rewrittenQuery = llmCorrection.corrected;
  }
  
  rewrittenQuery = rewrittenQuery.replace(/\s+/g, " ").trim();
  
  // Step 8: Decide auto-apply vs suggest
  const highConfidenceCorrections = allCorrections.filter(
    c => c.confidence >= CONFIDENCE_THRESHOLDS.autoApply
  );
  const autoApply = highConfidenceCorrections.length > 0 || 
                    (allCorrections.length > 0 && overallConfidence >= CONFIDENCE_THRESHOLDS.autoApply);
  
  let suggestText: string | undefined;
  if (!autoApply && allCorrections.length > 0 && overallConfidence >= CONFIDENCE_THRESHOLDS.suggest) {
    suggestText = `Did you mean "${rewrittenQuery}"?`;
  }
  
  // Step 9: Determine final search query
  const searchQuery = autoApply ? rewrittenQuery : normalizedQuery;
  
  // Build result
  const result: ProcessedQuery = {
    originalQuery: query,
    normalizedQuery,
    script,
    corrections: allCorrections,
    rewrittenQuery,
    autoApply,
    suggestText,
    extractedFilters: filters,
    searchQuery,
    processingTimeMs: performance.now() - startTime,
    llmUsed,
    cacheHit: false,
  };
  
  // Cache result
  cacheQuery(query, result);
  
  return result;
}

/**
 * Process query synchronously (no LLM, for high-throughput)
 */
export function processQuerySync(query: string): ProcessedQuery {
  const startTime = performance.now();
  
  // Check cache first
  const cached = getCachedQuery(query);
  if (cached) {
    return cached;
  }
  
  // Normalize
  const normalizedQuery = normalizeQuery(query);
  const script = detectScript(normalizedQuery);
  
  // Collect corrections (no LLM)
  const allCorrections: Correction[] = [];
  
  // Arabizi processing
  if (script.hasArabizi || script.primary === "arabizi") {
    allCorrections.push(...processArabizi(normalizedQuery));
  }
  
  // Brand aliases
  allCorrections.push(...expandBrandAliases(normalizedQuery));
  
  // Spell correction
  const dict = getDictionaries();
  const spellCorrections = correctQuery(normalizedQuery, {
    brands: dict.brands,
    categories: dict.categories,
    attributes: dict.attributes,
    commonQueries: dict.commonQueries,
  });
  
  for (const correction of spellCorrections) {
    const alreadyExists = allCorrections.some(
      c => c.original.toLowerCase() === correction.original.toLowerCase()
    );
    if (!alreadyExists) {
      allCorrections.push(correction);
    }
  }
  
  // Extract filters
  const { filters } = extractFilters(normalizedQuery, script);
  
  // Calculate confidence
  let overallConfidence = 1.0;
  if (allCorrections.length > 0) {
    overallConfidence = allCorrections.reduce((sum, c) => sum + c.confidence, 0) / allCorrections.length;
  }
  
  // Build rewritten query
  let rewrittenQuery = normalizedQuery;
  for (const correction of allCorrections) {
    if (correction.confidence >= CONFIDENCE_THRESHOLDS.reject) {
      const regex = new RegExp(`\\b${escapeRegex(correction.original)}\\b`, "gi");
      rewrittenQuery = rewrittenQuery.replace(regex, correction.corrected);
    }
  }
  rewrittenQuery = rewrittenQuery.replace(/\s+/g, " ").trim();
  
  // Decide auto-apply
  const autoApply = allCorrections.some(c => c.confidence >= CONFIDENCE_THRESHOLDS.autoApply) ||
                    (allCorrections.length > 0 && overallConfidence >= CONFIDENCE_THRESHOLDS.autoApply);
  
  let suggestText: string | undefined;
  if (!autoApply && allCorrections.length > 0 && overallConfidence >= CONFIDENCE_THRESHOLDS.suggest) {
    suggestText = `Did you mean "${rewrittenQuery}"?`;
  }
  
  const searchQuery = autoApply ? rewrittenQuery : normalizedQuery;
  
  const result: ProcessedQuery = {
    originalQuery: query,
    normalizedQuery,
    script,
    corrections: allCorrections,
    rewrittenQuery,
    autoApply,
    suggestText,
    extractedFilters: filters,
    searchQuery,
    processingTimeMs: performance.now() - startTime,
    llmUsed: false,
    cacheHit: false,
  };
  
  cacheQuery(query, result);
  return result;
}

/**
 * Get embedding for processed query (with caching)
 */
export async function getQueryEmbedding(query: string): Promise<number[] | null> {
  // Check cache
  const cached = getCachedEmbedding(query);
  if (cached) {
    return cached;
  }
  
  if (!isClipAvailable()) {
    return null;
  }
  
  try {
    const embedding = await getTextEmbedding(query);
    cacheEmbedding(query, embedding);
    return embedding;
  } catch (err) {
    console.warn("Failed to compute query embedding:", err);
    return null;
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Get all transliteration variants for a query
 */
export { getTransliterationVariants };

/**
 * Get script detection for a query
 */
export { detectScript };

/**
 * Normalize Arabic text
 */
export { normalizeArabic };

/**
 * Re-export types for external use
 */
export type {
  ProcessedQuery,
  ScriptAnalysis,
  Correction,
  ExtractedFilters,
  ConfidenceLevel,
} from "./types";
