/**
 * Complex Query Parser
 *
 * Handles multi-constraint queries with advanced NLP parsing:
 * - Multiple filters ("show me dresses under $100 similar to Zara style but in blue")
 * - Comparative queries ("better than", "cheaper than", "similar to")
 * - Compound conditions ("and", "or", "but")
 * - Negations (handled by negationHandler)
 *
 * Example:
 *   "show me dresses under $100 similar to Zara style but in blue"
 *   → category: dress, maxPrice: 100, styleSimilar: Zara, color: blue
 */

import type { QueryEntities, ExtractedFilters } from "./types";
import { FASHION_CANONICAL_COLORS } from "../color/colorCanonical";

export interface ComplexConstraint {
  type: "price" | "brand" | "category" | "color" | "style" | "comparison" | "similarity";
  operator: "eq" | "lt" | "gt" | "lte" | "gte" | "similar" | "not" | "like";
  value: string | number;
  confidence: number;
  originalText: string;
}

export interface ComplexQueryResult {
  constraints: ComplexConstraint[];
  logicalOps: Array<{ position: number; operator: "and" | "or" | "but" }>;
  primaryIntent: string;
  complexity: "simple" | "medium" | "complex";
  parseSuccess: boolean;
}

// ─── Patterns ────────────────────────────────────────────────────────────────

const PATTERNS = {
  // Price patterns
  price: {
    under:    /\b(?:under|below|less than|cheaper than|<)\s*\$?(\d+(?:\.\d{2})?)/gi,
    over:     /\b(?:over|above|more than|greater than|>)\s*\$?(\d+(?:\.\d{2})?)/gi,
    between:  /\b(?:between)\s*\$?(\d+(?:\.\d{2})?)\s*(?:and|to|-)\s*\$?(\d+(?:\.\d{2})?)/gi,
    exactly:  /\b(?:exactly|at|around)\s*\$?(\d+(?:\.\d{2})?)/gi,
  },

  // Comparison patterns
  comparison: {
    similar:  /\b(?:similar to|like|resembles?|looks? like)\s+([a-z0-9\s-]+?)(?:\s+(?:style|brand|look))?(?:\s+but|\s+and|\s+or|$)/gi,
    better:   /\b(?:better than|superior to|nicer than)\s+([a-z0-9\s-]+)/gi,
    cheaper:  /\b(?:cheaper than|less expensive than)\s+([a-z0-9\s-]+)/gi,
  },

  // Logical operators
  logical: {
    and: /\b(?:and|with|plus|also)\b/gi,
    or:  /\b(?:or|alternatively|maybe)\b/gi,
    but: /\b(?:but|however|except|without)\b/gi,
  },

  // Style descriptors
  style: {
    formal:   /\b(?:formal|elegant|sophisticated|dressy)\b/gi,
    casual:   /\b(?:casual|relaxed|laid-back|everyday)\b/gi,
    sporty:   /\b(?:sporty|athletic|active|gym)\b/gi,
    vintage:  /\b(?:vintage|retro|classic|old-school)\b/gi,
    modern:   /\b(?:modern|contemporary|trendy|current)\b/gi,
  },
};

// Color tokens for complex query extraction (longest first for word-boundary matches)
const EXTRA_COMPLEX_QUERY_COLORS = [
  "multicolour",
  "violet",
  "maroon",
  "wine",
  "burgundy",
  "charcoal",
  "camel",
  "ivory",
  "khaki",
  "sage",
  "mint",
  "blush",
  "rose",
  "coral",
  "peach",
  "plum",
  "lavender",
  "lilac",
  "mauve",
  "fuchsia",
  "magenta",
  "emerald",
  "jade",
  "rust",
  "copper",
  "bronze",
  "nude",
];
const KNOWN_COLORS: string[] = [
  ...new Set([...FASHION_CANONICAL_COLORS, ...EXTRA_COMPLEX_QUERY_COLORS]),
].sort((a, b) => b.length - a.length);

// ─── Main Parser ─────────────────────────────────────────────────────────────

/**
 * Parse complex queries with multiple constraints
 */
export function parseComplexQuery(query: string): ComplexQueryResult {
  const constraints: ComplexConstraint[] = [];
  const logicalOps: Array<{ position: number; operator: "and" | "or" | "but" }> = [];

  const normalized = query.toLowerCase().trim();

  // Extract price constraints
  constraints.push(...extractPriceConstraints(normalized));

  // Extract color constraints (multi-color queries)
  constraints.push(...extractColorConstraints(normalized));

  // Extract comparison constraints
  constraints.push(...extractComparisonConstraints(normalized));

  // Extract style constraints
  constraints.push(...extractStyleConstraints(normalized));

  // Extract logical operators
  logicalOps.push(...extractLogicalOperators(normalized));

  // Determine primary intent
  const primaryIntent = determinePrimaryIntent(constraints, normalized);

  // Calculate complexity
  const complexity = calculateComplexity(constraints, logicalOps);

  return {
    constraints,
    logicalOps,
    primaryIntent,
    complexity,
    parseSuccess: constraints.length > 0,
  };
}

// ─── Extraction Functions ────────────────────────────────────────────────────

function extractPriceConstraints(query: string): ComplexConstraint[] {
  const constraints: ComplexConstraint[] = [];

  // Under/below
  let match: RegExpExecArray | null;
  while ((match = PATTERNS.price.under.exec(query)) !== null) {
    constraints.push({
      type: "price",
      operator: "lte",
      value: parseFloat(match[1]),
      confidence: 0.95,
      originalText: match[0],
    });
  }

  // Over/above
  PATTERNS.price.over.lastIndex = 0;
  while ((match = PATTERNS.price.over.exec(query)) !== null) {
    constraints.push({
      type: "price",
      operator: "gte",
      value: parseFloat(match[1]),
      confidence: 0.95,
      originalText: match[0],
    });
  }

  // Between
  PATTERNS.price.between.lastIndex = 0;
  while ((match = PATTERNS.price.between.exec(query)) !== null) {
    constraints.push({
      type: "price",
      operator: "gte",
      value: parseFloat(match[1]),
      confidence: 0.98,
      originalText: match[0],
    });
    constraints.push({
      type: "price",
      operator: "lte",
      value: parseFloat(match[2]),
      confidence: 0.98,
      originalText: match[0],
    });
  }

  // Exactly/around
  PATTERNS.price.exactly.lastIndex = 0;
  while ((match = PATTERNS.price.exactly.exec(query)) !== null) {
    const price = parseFloat(match[1]);
    const range = price * 0.15; // ±15% range
    constraints.push({
      type: "price",
      operator: "gte",
      value: price - range,
      confidence: 0.85,
      originalText: match[0],
    });
    constraints.push({
      type: "price",
      operator: "lte",
      value: price + range,
      confidence: 0.85,
      originalText: match[0],
    });
  }

  return constraints;
}

function extractComparisonConstraints(query: string): ComplexConstraint[] {
  const constraints: ComplexConstraint[] = [];

  // Similar to
  let match: RegExpExecArray | null;
  PATTERNS.comparison.similar.lastIndex = 0;
  while ((match = PATTERNS.comparison.similar.exec(query)) !== null) {
    const reference = match[1].trim();
    constraints.push({
      type: "similarity",
      operator: "similar",
      value: reference,
      confidence: 0.90,
      originalText: match[0],
    });
  }

  // Better than
  PATTERNS.comparison.better.lastIndex = 0;
  while ((match = PATTERNS.comparison.better.exec(query)) !== null) {
    const reference = match[1].trim();
    constraints.push({
      type: "comparison",
      operator: "gt",
      value: reference,
      confidence: 0.80,
      originalText: match[0],
    });
  }

  // Cheaper than
  PATTERNS.comparison.cheaper.lastIndex = 0;
  while ((match = PATTERNS.comparison.cheaper.exec(query)) !== null) {
    const reference = match[1].trim();
    constraints.push({
      type: "price",
      operator: "lt",
      value: reference,
      confidence: 0.85,
      originalText: match[0],
    });
  }

  return constraints;
}

function extractColorConstraints(query: string): ComplexConstraint[] {
  const constraints: ComplexConstraint[] = [];

  for (const color of KNOWN_COLORS) {
    const escaped = color.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Word-boundary match to reduce accidental substring hits
    const regex = new RegExp(`\\b${escaped}\\b`, "gi");
    let match: RegExpExecArray | null;

    // Reset lastIndex before each new regex usage
    regex.lastIndex = 0;

    while ((match = regex.exec(query)) !== null) {
      constraints.push({
        type: "color",
        operator: "eq",
        value: color,
        confidence: 0.9,
        originalText: match[0],
      });
    }
  }

  return constraints;
}

function extractStyleConstraints(query: string): ComplexConstraint[] {
  const constraints: ComplexConstraint[] = [];

  for (const [styleType, pattern] of Object.entries(PATTERNS.style)) {
    pattern.lastIndex = 0;
    if (pattern.test(query)) {
      constraints.push({
        type: "style",
        operator: "eq",
        value: styleType,
        confidence: 0.85,
        originalText: styleType,
      });
    }
  }

  return constraints;
}

function extractLogicalOperators(query: string): Array<{ position: number; operator: "and" | "or" | "but" }> {
  const ops: Array<{ position: number; operator: "and" | "or" | "but" }> = [];

  for (const [operator, pattern] of Object.entries(PATTERNS.logical)) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(query)) !== null) {
      ops.push({
        position: match.index,
        operator: operator as "and" | "or" | "but",
      });
    }
  }

  return ops.sort((a, b) => a.position - b.position);
}

// ─── Intent & Complexity ─────────────────────────────────────────────────────

function determinePrimaryIntent(constraints: ComplexConstraint[], query: string): string {
  if (constraints.some(c => c.type === "similarity")) return "similarity_search";
  if (constraints.some(c => c.type === "comparison")) return "comparison_search";
  if (constraints.filter(c => c.type === "price").length >= 2) return "price_filtered_search";
  if (constraints.some(c => c.type === "style")) return "style_search";
  if (constraints.some(c => c.type === "color")) return "product_search";

  // Fallback to keyword analysis
  if (/\b(?:show|find|search|look(?:ing)? for)\b/i.test(query)) return "product_search";

  return "general_search";
}

function calculateComplexity(
  constraints: ComplexConstraint[],
  logicalOps: Array<{ position: number; operator: string }>
): "simple" | "medium" | "complex" {
  const score = constraints.length + logicalOps.length;

  if (score <= 2) return "simple";
  if (score <= 5) return "medium";
  return "complex";
}

// ─── Integration with Existing QueryAST ──────────────────────────────────────

/**
 * Merge complex constraints into existing filters
 */
export function mergeComplexConstraints(
  existingFilters: ExtractedFilters,
  complexResult: ComplexQueryResult
): ExtractedFilters {
  const merged = { ...existingFilters };

  // Apply price constraints
  const priceConstraints = complexResult.constraints.filter(c => c.type === "price");
  if (priceConstraints.length > 0) {
    const minPrice = Math.min(
      ...priceConstraints
        .filter(c => c.operator === "gte")
        .map(c => c.value as number)
    );
    const maxPrice = Math.max(
      ...priceConstraints
        .filter(c => c.operator === "lte")
        .map(c => c.value as number)
    );

    if (isFinite(minPrice) || isFinite(maxPrice)) {
      merged.priceRange = {
        min: isFinite(minPrice) ? minPrice : undefined,
        max: isFinite(maxPrice) ? maxPrice : undefined,
      };
    }
  }

  // Apply style constraints
  const styleConstraints = complexResult.constraints.filter(c => c.type === "style");
  if (styleConstraints.length > 0 && !merged.style) {
    merged.style = styleConstraints.map(c => c.value as string);
  }

  // Store similarity references for later use
  const similarityConstraints = complexResult.constraints.filter(c => c.type === "similarity");
  if (similarityConstraints.length > 0) {
    merged.similarityReference = similarityConstraints[0].value as string;
  }

  // Apply color constraints (multi-color)
  const colorConstraints = complexResult.constraints.filter(c => c.type === "color");
  if (colorConstraints.length > 0) {
    const colors = Array.from(new Set(colorConstraints.map(c => String(c.value))));
    merged.colors = colors;
    merged.color = colors[0]; // backward compat

    // Mode: if the query contains an OR connector, treat as "any",
    // otherwise treat as "all" when multiple colors are present.
    const hasOr = complexResult.logicalOps.some(op => op.operator === "or");
    if (colors.length > 1) merged.colorMode = hasOr ? "any" : "all";
    else merged.colorMode = "any";
  }

  return merged;
}

/**
 * Apply complex constraints to OpenSearch query
 */
export function applyComplexConstraintsToQuery(
  baseQuery: any,
  complexResult: ComplexQueryResult
): any {
  const query = JSON.parse(JSON.stringify(baseQuery)); // deep clone

  // Boost queries based on similarity constraints
  const similarityConstraints = complexResult.constraints.filter(c => c.type === "similarity");
  if (similarityConstraints.length > 0) {
    const similarityBoost = similarityConstraints[0].value as string;

    if (!query.bool) query.bool = {};
    if (!query.bool.should) query.bool.should = [];

    query.bool.should.push({
      multi_match: {
        query: similarityBoost,
        fields: ["brand^2", "description", "style"],
        boost: 1.5,
      },
    });
  }

  // Apply style filters
  const styleConstraints = complexResult.constraints.filter(c => c.type === "style");
  if (styleConstraints.length > 0) {
    if (!query.bool) query.bool = {};
    if (!query.bool.should) query.bool.should = [];

    for (const style of styleConstraints) {
      query.bool.should.push({
        match: {
          style: {
            query: style.value,
            boost: 1.3,
          },
        },
      });
    }
  }

  return query;
}
