/**
  * Enhanced Search Service with Advanced Query Understanding
 *
 * Integrates:
 * - Complex Query Parser (multi-constraint queries)
 * - Negation Handler ("not", "without", "except")
 * - Conversational Context (multi-turn queries)
 * - Query Autocomplete & Trending Queries
 */

import { textSearch as baseTextSearch, SearchFilters, SearchResult } from "../../routes/search/search.service";
import {
  parseComplexQuery,
  mergeComplexConstraints,
  applyComplexConstraintsToQuery,
  type ComplexQueryResult,
} from "./complexQueryParser";
import {
  parseNegations,
  applyNegationsToQuery,
  explainNegations,
  type NegationResult,
} from "./negationHandler";
import {
  enrichQueryWithContext,
  addTurn,
  getSession,
  type ContextualQuery,
} from "./conversationalContext";
import {
  logSearchQuery,
  getAutocompleteSuggestions,
  getTrendingQueries,
  type QuerySuggestion,
} from "./queryAutocomplete";
import { processQuery, type QueryAST } from "./index";

// ─── Enhanced Search Interface ───────────────────────────────────────────────

export interface EnhancedSearchRequest {
  query: string;
  filters?: SearchFilters;
  options?: {
    limit?: number;
    offset?: number;
  };
  sessionId?: string;
  userId?: string;
  category?: string;
}

export interface EnhancedSearchResult extends SearchResult {
  // Original fields from SearchResult
  // Enhanced fields:
  complexQuery?: ComplexQueryResult;
  negations?: NegationResult;
  contextual?: ContextualQuery;
  explanation?: string;
  suggestions?: string[];
}

// ─── Main Enhanced Search Function ──────────────────────────────────────────

/**
 * Enhanced text search with complex query understanding
 */
export async function enhancedTextSearch(
  request: EnhancedSearchRequest
): Promise<EnhancedSearchResult> {
  const { query, filters, options, sessionId, userId, category } = request;

  // Step 1: Conversational Context (if session provided)
  let contextual: ContextualQuery | undefined;
  let enrichedQuery = query;

  if (sessionId) {
    contextual = enrichQueryWithContext(query, sessionId);
    enrichedQuery = contextual.enriched;
  }

  // Step 2: Parse Negations
  const negations = parseNegations(enrichedQuery);
  const cleanedQuery = negations.cleanedQuery;

  // Step 3: Parse Complex Constraints
  const complexQuery = parseComplexQuery(cleanedQuery);

  // Step 4: Process query through QueryAST pipeline
  const ast = await processQuery(cleanedQuery);

  // Step 5: Merge all filters
  let mergedFilters = mergeComplexConstraints(
    { ...filters } as any,
    complexQuery
  );

  // Apply inherited context filters
  if (contextual?.inheritedFilters) {
    const inherited = contextual.inheritedFilters;
    mergedFilters = {
      gender: mergedFilters.gender ?? inherited.gender,
      priceRange: mergedFilters.priceRange ?? inherited.priceRange,
      color: mergedFilters.color ?? (Array.isArray(inherited.color) ? inherited.color[0] : inherited.color),
      material: mergedFilters.material ?? (Array.isArray(inherited.material) ? inherited.material[0] : inherited.material),
      category: mergedFilters.category ?? (Array.isArray(inherited.category) ? inherited.category[0] : inherited.category),
      brand: mergedFilters.brand ?? (Array.isArray(inherited.brand) ? inherited.brand[0] : inherited.brand),
      style: mergedFilters.style,
      similarityReference: mergedFilters.similarityReference,
    };
  }

  // Step 6: Execute base search
  const baseResult = await baseTextSearch(cleanedQuery, mergedFilters as SearchFilters, options);

  // Step 7: Log search for autocomplete/trending
  await logSearchQuery(query, userId, category, baseResult.total);

  // Step 8: Add turn to conversation context
  if (sessionId) {
    addTurn(sessionId, query, ast, baseResult.total);
  }

  // Step 9: Build explanation
  const explanation = buildExplanation({
    original: query,
    enriched: enrichedQuery,
    cleaned: cleanedQuery,
    negations,
    complexQuery,
    contextual,
  });

  // Step 10: Generate smart suggestions
  const suggestions = generateSmartSuggestions({
    query: cleanedQuery,
    ast,
    resultCount: baseResult.total,
    negations,
    complexQuery,
  });

  // Step 11: Build enhanced result
  return {
    ...baseResult,
    complexQuery,
    negations,
    contextual,
    explanation,
    suggestions,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build human-readable explanation of query understanding
 */
function buildExplanation(context: {
  original: string;
  enriched: string;
  cleaned: string;
  negations: NegationResult;
  complexQuery: ComplexQueryResult;
  contextual?: ContextualQuery;
}): string {
  const parts: string[] = [];

  // Contextual enrichment
  if (context.contextual?.isRefinement) {
    parts.push("Refined previous search");
  } else if (context.contextual?.referencesPrevious) {
    parts.push("Referenced previous context");
  }

  // Complex constraints
  if (context.complexQuery.complexity !== "simple") {
    const constraintTypes = Array.from(
      new Set(context.complexQuery.constraints.map(c => c.type))
    );
    parts.push(`Multiple filters: ${constraintTypes.join(", ")}`);
  }

  // Negations
  if (context.negations.hasNegation) {
    const negExplanation = explainNegations(context.negations.negations);
    parts.push(negExplanation);
  }

  // Intent
  parts.push(`Intent: ${context.complexQuery.primaryIntent.replace(/_/g, " ")}`);

  return parts.length > 0 ? parts.join(" • ") : "Standard search";
}

/**
 * Generate smart suggestions based on query analysis
 */
function generateSmartSuggestions(context: {
  query: string;
  ast: QueryAST;
  resultCount: number;
  negations: NegationResult;
  complexQuery: ComplexQueryResult;
}): string[] {
  const suggestions: string[] = [];

  // Zero results → suggest simpler query
  if (context.resultCount === 0) {
    if (context.negations.hasNegation) {
      suggestions.push(`Try without: "${context.negations.negations[0].value}"`);
    }
    if (context.complexQuery.constraints.length > 2) {
      suggestions.push("Try with fewer filters");
    }
    if (context.ast.corrections.length > 0) {
      suggestions.push(`Did you mean: "${context.ast.searchQuery}"?`);
    }
  }

  // Many results → suggest refinements
  if (context.resultCount > 100) {
    const priceConstraint = context.complexQuery.constraints.find(c => c.type === "price");
    if (!priceConstraint) {
      suggestions.push("Add price range to narrow results");
    }

    if (context.ast.entities.colors.length === 0) {
      suggestions.push("Specify a color");
    }

    if (!context.ast.entities.gender) {
      suggestions.push("Add gender filter (men/women/kids)");
    }
  }

  // Suggest related searches
  if (context.ast.entities.categories.length > 0) {
    const category = context.ast.entities.categories[0];
    const relatedCategories = getRelatedCategories(category);
    if (relatedCategories.length > 0) {
      suggestions.push(`Also try: ${relatedCategories[0]}`);
    }
  }

  return suggestions.slice(0, 3);
}

/**
 * Get related categories for cross-sell suggestions
 */
function getRelatedCategories(category: string): string[] {
  const relations: Record<string, string[]> = {
    dress: ["shoes", "bag", "jewelry"],
    shirt: ["pants", "jeans", "blazer"],
    pants: ["shirt", "belt", "shoes"],
    shoes: ["socks", "shoe care", "insoles"],
    bag: ["wallet", "keychain", "sunglasses"],
    jacket: ["scarf", "gloves", "hat"],
  };

  return relations[category.toLowerCase()] || [];
}

// ─── Export public API ───────────────────────────────────────────────────────

export {
  // Autocomplete & Trending
  getAutocompleteSuggestions,
  getTrendingQueries,

  // Session management
  getSession,
  enrichQueryWithContext,

  // Parsers (for testing/debugging)
  parseComplexQuery,
  parseNegations,
};

export type {
  QuerySuggestion,
  ContextualQuery,
  ComplexQueryResult,
  NegationResult,
};
