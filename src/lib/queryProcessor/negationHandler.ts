/**
 * Negation Handler
 *
 * Handles negation patterns in search queries:
 * - "not too formal" → exclude formal styles
 * - "without buttons" → exclude button attribute
 * - "except red" → exclude red color
 * - "no stripes" → exclude striped pattern
 *
 * Integrates with OpenSearch must_not clauses for efficient filtering.
 */

export interface NegationConstraint {
  type: "color" | "pattern" | "material" | "style" | "brand" | "category" | "attribute";
  value: string;
  confidence: number;
  originalText: string;
  modifier?: "very" | "too" | "extremely"; // intensity modifiers
}

export interface NegationResult {
  negations: NegationConstraint[];
  hasNegation: boolean;
  cleanedQuery: string; // query with negation phrases removed
}

// ─── Negation Patterns ───────────────────────────────────────────────────────

const NEGATION_PATTERNS = {
  // Direct negations
  not: /\b(?:not|no|dont|don't|never)\s+(?:(too|very|extremely)\s+)?([a-z]+)\b/gi,
  without: /\bwithout\s+([a-z\s]+?)(?:\s+(?:and|or|but)|$)/gi,
  except: /\bexcept\s+([a-z\s]+?)(?:\s+(?:and|or|but)|$)/gi,
  avoid: /\bavoid(?:ing)?\s+([a-z\s]+?)(?:\s+(?:and|or|but)|$)/gi,

  // Compound negations
  notLike: /\bnot\s+(?:like|similar\s+to)\s+([a-z0-9\s-]+)/gi,
  noneOf: /\bnone\s+of\s+(?:these|those|the)?\s*:?\s*([a-z,\s]+)/gi,
};

// Fashion-specific attribute dictionaries
const ATTRIBUTE_DICT = {
  colors: new Set([
    "red", "blue", "green", "yellow", "black", "white", "pink", "purple",
    "orange", "brown", "gray", "grey", "navy", "beige", "burgundy", "teal"
  ]),
  patterns: new Set([
    "striped", "stripes", "stripe", "polka dot", "dots", "floral", "flowers",
    "plaid", "checkered", "checked", "leopard", "animal print", "solid", "plain"
  ]),
  materials: new Set([
    "cotton", "silk", "wool", "leather", "denim", "polyester", "linen",
    "suede", "velvet", "cashmere", "synthetic", "nylon", "spandex"
  ]),
  styles: new Set([
    "formal", "casual", "sporty", "elegant", "vintage", "modern", "classic",
    "boho", "preppy", "grunge", "minimalist", "romantic", "edgy"
  ]),
};

// ─── Main Handler ────────────────────────────────────────────────────────────

/**
 * Extract negation constraints from query
 */
export function parseNegations(query: string): NegationResult {
  const negations: NegationConstraint[] = [];
  const normalized = query.toLowerCase();

  // Extract "not" negations
  negations.push(...extractNotNegations(normalized));

  // Extract "without" negations
  negations.push(...extractWithoutNegations(normalized));

  // Extract "except" negations
  negations.push(...extractExceptNegations(normalized));

  // Extract "avoid" negations
  negations.push(...extractAvoidNegations(normalized));

  // Extract compound negations
  negations.push(...extractCompoundNegations(normalized));

  // Remove negation phrases from query
  const cleanedQuery = removeNegationPhrases(query, negations);

  return {
    negations,
    hasNegation: negations.length > 0,
    cleanedQuery,
  };
}

// ─── Extraction Functions ────────────────────────────────────────────────────

function extractNotNegations(query: string): NegationConstraint[] {
  const negations: NegationConstraint[] = [];
  let match: RegExpExecArray | null;

  NEGATION_PATTERNS.not.lastIndex = 0;
  while ((match = NEGATION_PATTERNS.not.exec(query)) !== null) {
    const modifier = match[1] as "very" | "too" | "extremely" | undefined;
    const value = match[2];
    const type = classifyAttribute(value);

    if (type) {
      negations.push({
        type,
        value,
        confidence: 0.90,
        originalText: match[0],
        modifier,
      });
    }
  }

  return negations;
}

function extractWithoutNegations(query: string): NegationConstraint[] {
  const negations: NegationConstraint[] = [];
  let match: RegExpExecArray | null;

  NEGATION_PATTERNS.without.lastIndex = 0;
  while ((match = NEGATION_PATTERNS.without.exec(query)) !== null) {
    const value = match[1].trim();
    const type = classifyAttribute(value);

    if (type) {
      negations.push({
        type,
        value,
        confidence: 0.95,
        originalText: match[0],
      });
    }
  }

  return negations;
}

function extractExceptNegations(query: string): NegationConstraint[] {
  const negations: NegationConstraint[] = [];
  let match: RegExpExecArray | null;

  NEGATION_PATTERNS.except.lastIndex = 0;
  while ((match = NEGATION_PATTERNS.except.exec(query)) !== null) {
    const value = match[1].trim();
    const type = classifyAttribute(value);

    if (type) {
      negations.push({
        type,
        value,
        confidence: 0.93,
        originalText: match[0],
      });
    }
  }

  return negations;
}

function extractAvoidNegations(query: string): NegationConstraint[] {
  const negations: NegationConstraint[] = [];
  let match: RegExpExecArray | null;

  NEGATION_PATTERNS.avoid.lastIndex = 0;
  while ((match = NEGATION_PATTERNS.avoid.exec(query)) !== null) {
    const value = match[1].trim();
    const type = classifyAttribute(value);

    if (type) {
      negations.push({
        type,
        value,
        confidence: 0.88,
        originalText: match[0],
      });
    }
  }

  return negations;
}

function extractCompoundNegations(query: string): NegationConstraint[] {
  const negations: NegationConstraint[] = [];
  let match: RegExpExecArray | null;

  // "not like" / "not similar to"
  NEGATION_PATTERNS.notLike.lastIndex = 0;
  while ((match = NEGATION_PATTERNS.notLike.exec(query)) !== null) {
    const value = match[1].trim();
    negations.push({
      type: "brand", // Assume brand for "not like X" unless classified otherwise
      value,
      confidence: 0.85,
      originalText: match[0],
    });
  }

  // "none of: red, blue, green"
  NEGATION_PATTERNS.noneOf.lastIndex = 0;
  while ((match = NEGATION_PATTERNS.noneOf.exec(query)) !== null) {
    const values = match[1].split(/[,;]/).map(v => v.trim()).filter(Boolean);
    for (const value of values) {
      const type = classifyAttribute(value);
      if (type) {
        negations.push({
          type,
          value,
          confidence: 0.92,
          originalText: match[0],
        });
      }
    }
  }

  return negations;
}

// ─── Attribute Classification ────────────────────────────────────────────────

function classifyAttribute(value: string): NegationConstraint["type"] | null {
  const normalized = value.toLowerCase().trim();

  if (ATTRIBUTE_DICT.colors.has(normalized)) return "color";
  if (ATTRIBUTE_DICT.patterns.has(normalized) || normalized.includes("dot")) return "pattern";
  if (ATTRIBUTE_DICT.materials.has(normalized)) return "material";
  if (ATTRIBUTE_DICT.styles.has(normalized)) return "style";

  // Heuristics for brands (capitalized words)
  if (/^[A-Z][a-z]+/.test(value)) return "brand";

  // Check for category keywords
  const categoryKeywords = ["dress", "shirt", "pants", "shoes", "bag", "jacket", "coat", "skirt"];
  if (categoryKeywords.some(k => normalized.includes(k))) return "category";

  // Default to attribute
  return "attribute";
}

// ─── Query Cleaning ──────────────────────────────────────────────────────────

function removeNegationPhrases(query: string, negations: NegationConstraint[]): string {
  let cleaned = query;

  for (const neg of negations) {
    // Remove the negation phrase but keep surrounding context
    cleaned = cleaned.replace(new RegExp(escapeRegex(neg.originalText), "gi"), " ");
  }

  // Clean up extra spaces
  return cleaned.replace(/\s+/g, " ").trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── OpenSearch Integration ──────────────────────────────────────────────────

/**
 * Apply negations to OpenSearch query using must_not clauses
 */
export function applyNegationsToQuery(baseQuery: any, negations: NegationConstraint[]): any {
  if (negations.length === 0) return baseQuery;

  const query = JSON.parse(JSON.stringify(baseQuery)); // deep clone

  if (!query.bool) query.bool = {};
  if (!query.bool.must_not) query.bool.must_not = [];

  for (const negation of negations) {
    switch (negation.type) {
      case "color":
        query.bool.must_not.push({
          term: { color: negation.value.toLowerCase() },
        });
        break;

      case "pattern":
        query.bool.must_not.push({
          match: { pattern: negation.value },
        });
        break;

      case "material":
        query.bool.must_not.push({
          match: { material: negation.value },
        });
        break;

      case "style":
        query.bool.must_not.push({
          match: { style: negation.value },
        });
        break;

      case "brand":
        query.bool.must_not.push({
          term: { "brand.keyword": negation.value.toLowerCase() },
        });
        break;

      case "category":
        query.bool.must_not.push({
          term: { category: negation.value.toLowerCase() },
        });
        break;

      case "attribute":
        // Generic attribute negation
        query.bool.must_not.push({
          multi_match: {
            query: negation.value,
            fields: ["attributes", "description", "name"],
          },
        });
        break;
    }
  }

  return query;
}

/**
 * Convert negations to human-readable explanation
 */
export function explainNegations(negations: NegationConstraint[]): string {
  if (negations.length === 0) return "";

  const parts = negations.map(neg => {
    const modifier = neg.modifier ? `${neg.modifier} ` : "";
    return `excluding ${modifier}${neg.value}`;
  });

  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;

  const last = parts.pop();
  return `${parts.join(", ")}, and ${last}`;
}
