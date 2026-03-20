/**
 * Conversational Context Manager
 *
 * Manages multi-turn query context for conversational search:
 * - Session tracking
 * - Query history
 * - Contextual resolution ("show me blue ones" → infers category from previous query)
 * - Refinement tracking ("cheaper", "but in red", "similar")
 *
 * Example conversation:
 *   User: "show me dresses"
 *   → context.category = "dresses"
 *   User: "under $100"
 *   → infers: "dresses under $100"
 *   User: "in blue"
 *   → infers: "blue dresses under $100"
 */

import type { QueryAST, QueryEntities, QueryFilters } from "./types";

export interface ConversationTurn {
  query: string;
  ast: QueryAST;
  timestamp: number;
  resultCount?: number;
}

export interface SessionContext {
  sessionId: string;
  userId?: string;
  turns: ConversationTurn[];
  createdAt: number;
  lastAccessedAt: number;
  accumulatedFilters: QueryFilters;
  accumulatedEntities: QueryEntities;
  lastCategory?: string;
  lastBrand?: string;
}

export interface ContextualQuery {
  original: string;
  enriched: string;
  inheritedFilters: QueryFilters;
  inheritedEntities: QueryEntities;
  isRefinement: boolean;
  referencesPrevious: boolean;
}

// ─── In-Memory Session Store (replace with Redis in production) ─────────────

const sessions = new Map<string, SessionContext>();
const SESSION_TTL = 30 * 60 * 1000; // 30 minutes

// ─── Session Management ──────────────────────────────────────────────────────

/**
 * Get or create a conversation session
 */
export function getSession(sessionId: string, userId?: string): SessionContext {
  const existing = sessions.get(sessionId);

  if (existing) {
    existing.lastAccessedAt = Date.now();
    return existing;
  }

  // Create new session
  const session: SessionContext = {
    sessionId,
    userId,
    turns: [],
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
    accumulatedFilters: {},
    accumulatedEntities: {
      brands: [],
      categories: [],
      colors: [],
      productTypes: [],
      materials: [],
      patterns: [],
      sizes: [],
    },
  };

  sessions.set(sessionId, session);
  return session;
}

/**
 * Add a turn to the conversation
 */
export function addTurn(
  sessionId: string,
  query: string,
  ast: QueryAST,
  resultCount?: number
): void {
  const session = getSession(sessionId);

  session.turns.push({
    query,
    ast,
    timestamp: Date.now(),
    resultCount,
  });

  // Limit history to last 10 turns
  if (session.turns.length > 10) {
    session.turns.shift();
  }

  // Update accumulated context
  updateAccumulatedContext(session, ast);
  session.lastAccessedAt = Date.now();
}

/**
 * Clear session context
 */
export function clearSession(sessionId: string): void {
  sessions.delete(sessionId);
}

/**
 * Clean up expired sessions (call periodically)
 */
export function cleanupExpiredSessions(): number {
  const now = Date.now();
  let cleaned = 0;

  for (const [sessionId, session] of Array.from(sessions.entries())) {
    if (now - session.lastAccessedAt > SESSION_TTL) {
      sessions.delete(sessionId);
      cleaned++;
    }
  }

  return cleaned;
}

// ─── Contextual Query Resolution ─────────────────────────────────────────────

/**
 * Enrich a query with conversational context
 */
export function enrichQueryWithContext(
  query: string,
  sessionId: string
): ContextualQuery {
  const session = getSession(sessionId);

  // Check if query is a refinement
  const isRefinement = isRefinementQuery(query);
  const referencesPrevious = referencesPreviousContext(query);

  if (session.turns.length === 0 || (!isRefinement && !referencesPrevious)) {
    // First query or independent query
    return {
      original: query,
      enriched: query,
      inheritedFilters: {},
      inheritedEntities: {
        brands: [],
        categories: [],
        colors: [],
        productTypes: [],
        materials: [],
        patterns: [],
        sizes: [],
      },
      isRefinement: false,
      referencesPrevious: false,
    };
  }

  // Build enriched query
  let enriched = query;
  const inheritedFilters: QueryFilters = { ...session.accumulatedFilters };
  const inheritedEntities: QueryEntities = { ...session.accumulatedEntities };

  // Resolve pronouns and references
  enriched = resolvePronouns(enriched, session);

  // Add implicit context if needed
  if (isRefinement && !hasExplicitCategory(enriched)) {
    if (session.lastCategory) {
      enriched = `${session.lastCategory} ${enriched}`;
    }
  }

  return {
    original: query,
    enriched,
    inheritedFilters,
    inheritedEntities,
    isRefinement,
    referencesPrevious,
  };
}

// ─── Context Analysis ────────────────────────────────────────────────────────

/**
 * Check if query is a refinement of previous search
 */
function isRefinementQuery(query: string): boolean {
  const normalized = query.toLowerCase().trim();

  const refinementPatterns = [
    /^(?:under|over|below|above|between)\s+\$?\d+/i,              // "under $50"
    /^(?:in|with)\s+[a-z]+/i,                                      // "in blue"
    /^(?:cheaper|more expensive|better|similar)/i,                 // "cheaper"
    /^(?:but|and|or)\s+/i,                                         // "but in red"
    /^(?:without|except|no)\s+/i,                                  // "without stripes"
    /^(?:show|find|get)\s+(?:me\s+)?(?:the\s+)?(?:cheaper|blue)/i, // "show me cheaper"
  ];

  return refinementPatterns.some(p => p.test(normalized));
}

/**
 * Check if query references previous context
 */
function referencesPreviousContext(query: string): boolean {
  const pronounPatterns = [
    /\b(?:it|them|these|those|that|this)\b/i,
    /\b(?:one|ones)\b/i,
    /\b(?:same|similar)\b/i,
  ];

  return pronounPatterns.some(p => p.test(query));
}

/**
 * Check if query has explicit category
 */
function hasExplicitCategory(query: string): boolean {
  const categoryKeywords = [
    "dress", "shirt", "pants", "jeans", "shoes", "boots", "bag", "purse",
    "jacket", "coat", "sweater", "top", "blouse", "skirt", "shorts",
  ];

  const normalized = query.toLowerCase();
  return categoryKeywords.some(k => normalized.includes(k));
}

/**
 * Resolve pronouns to explicit references
 */
function resolvePronouns(query: string, session: SessionContext): string {
  if (session.turns.length === 0) return query;

  let resolved = query;

  // Get last turn
  const lastTurn = session.turns[session.turns.length - 1];

  // Resolve "them" / "those" → last category
  if (/\b(?:them|those)\b/i.test(resolved) && session.lastCategory) {
    resolved = resolved.replace(/\b(?:them|those)\b/gi, session.lastCategory);
  }

  // Resolve "it" / "that" → last brand or category
  if (/\b(?:it|that)\b/i.test(resolved)) {
    const reference = session.lastBrand || session.lastCategory || "";
    if (reference) {
      resolved = resolved.replace(/\b(?:it|that)\b/gi, reference);
    }
  }

  // Resolve "ones" → last category
  if (/\b(?:ones?)\b/i.test(resolved) && session.lastCategory) {
    resolved = resolved.replace(/\b(?:ones?)\b/gi, session.lastCategory);
  }

  // Resolve "same" → inherit all filters
  if (/\bsame\b/i.test(resolved) && lastTurn.query) {
    resolved = resolved.replace(/\bsame\b/gi, lastTurn.query);
  }

  return resolved;
}

/**
 * Update accumulated context from AST
 */
function updateAccumulatedContext(session: SessionContext, ast: QueryAST): void {
  // Update filters (replace or merge)
  if (ast.filters.priceRange) {
    session.accumulatedFilters.priceRange = ast.filters.priceRange;
  }

  if (ast.filters.brand && ast.filters.brand.length > 0) {
    session.accumulatedFilters.brand = ast.filters.brand;
    session.lastBrand = ast.filters.brand[0];
  }

  if (ast.filters.category && ast.filters.category.length > 0) {
    session.accumulatedFilters.category = ast.filters.category;
    session.lastCategory = ast.filters.category[0];
  }

  if (ast.filters.color && ast.filters.color.length > 0) {
    session.accumulatedFilters.color = ast.filters.color;
  }

  if (ast.filters.material && ast.filters.material.length > 0) {
    session.accumulatedFilters.material = ast.filters.material;
  }

  if (ast.filters.gender) {
    session.accumulatedFilters.gender = ast.filters.gender;
  }

  // Update entities (accumulate)
  if (ast.entities.brands.length > 0) {
    session.accumulatedEntities.brands = Array.from(
      new Set([...session.accumulatedEntities.brands, ...ast.entities.brands])
    );
  }

  if (ast.entities.categories.length > 0) {
    session.accumulatedEntities.categories = Array.from(
      new Set([...session.accumulatedEntities.categories, ...ast.entities.categories])
    );
  }

  if (ast.entities.colors.length > 0) {
    session.accumulatedEntities.colors = Array.from(
      new Set([...session.accumulatedEntities.colors, ...ast.entities.colors])
    );
  }
}

// ─── Session Analytics ───────────────────────────────────────────────────────

/**
 * Get session statistics
 */
export function getSessionStats(sessionId: string): {
  turnCount: number;
  duration: number;
  refinementCount: number;
  lastQuery: string | null;
} {
  const session = getSession(sessionId);

  const refinementCount = session.turns.filter((_, i) =>
    i > 0 && isRefinementQuery(session.turns[i].query)
  ).length;

  return {
    turnCount: session.turns.length,
    duration: Date.now() - session.createdAt,
    refinementCount,
    lastQuery: session.turns.length > 0 ? session.turns[session.turns.length - 1].query : null,
  };
}

/**
 * Get all active sessions count
 */
export function getActiveSessionsCount(): number {
  return sessions.size;
}

// ─── Cleanup Timer (start on module load) ───────────────────────────────────

// Clean up expired sessions every 5 minutes
setInterval(() => {
  const cleaned = cleanupExpiredSessions();
  if (cleaned > 0) {
    console.log(`[ConversationContext] Cleaned ${cleaned} expired sessions`);
  }
}, 5 * 60 * 1000);
