/**
 * Semantic Query Understanding Service
 * 
 * Provides intelligent query processing:
 * 1. Entity extraction (brands, categories, colors, sizes)
 * 2. Query expansion (synonyms, related terms)
 * 3. Intent classification
 * 4. Hybrid search (semantic + keyword)
 */
import { pg } from "../core";

// ============================================================================
// Types
// ============================================================================

export interface QueryEntities {
  brands: string[];
  categories: string[];
  colors: string[];
  sizes: string[];
  priceRange?: { min?: number; max?: number };
  attributes: string[];  // Other extracted attributes
}

export interface ParsedQuery {
  originalQuery: string;
  normalizedQuery: string;
  entities: QueryEntities;
  intent: QueryIntent;
  expandedTerms: string[];
  semanticQuery: string;  // Query optimized for semantic search
}

export type QueryIntent = 
  | "product_search"      // General product search
  | "brand_search"        // Looking for specific brand
  | "category_browse"     // Browsing a category
  | "style_search"        // Looking for style/aesthetic
  | "price_search"        // Price-focused query
  | "comparison"          // Comparing products
  | "specific_item";      // Looking for exact item

// ============================================================================
// Knowledge Base (expandable)
// ============================================================================

const KNOWN_BRANDS = new Set([
  "nike", "adidas", "puma", "reebok", "new balance", "under armour",
  "levi's", "levis", "gap", "h&m", "zara", "uniqlo",
  "gucci", "prada", "louis vuitton", "chanel", "dior", "versace",
  "ralph lauren", "tommy hilfiger", "calvin klein", "armani",
  "north face", "patagonia", "columbia", "the north face",
]);

const CATEGORY_MAP: Record<string, string[]> = {
  "tops": ["shirt", "shirts", "tee", "tees", "t-shirt", "t-shirts", "blouse", "blouses", "top", "tank", "tanks", "polo", "polos", "sweater", "sweaters", "hoodie", "hoodies", "sweatshirt"],
  "bottoms": ["pants", "jeans", "shorts", "trousers", "skirt", "skirts", "leggings", "joggers"],
  "dresses": ["dress", "dresses", "gown", "gowns", "maxi", "mini"],
  "outerwear": ["jacket", "jackets", "coat", "coats", "blazer", "blazers", "cardigan", "cardigans", "parka", "windbreaker"],
  "footwear": ["shoes", "shoe", "sneakers", "sneaker", "boots", "boot", "sandals", "sandal", "heels", "loafers", "flats"],
  "accessories": ["bag", "bags", "purse", "purses", "wallet", "wallets", "belt", "belts", "hat", "hats", "cap", "caps", "scarf", "scarves", "sunglasses", "watch", "watches", "jewelry"],
  "activewear": ["sportswear", "athletic", "gym", "workout", "running", "yoga", "training"],
};

const COLOR_MAP: Record<string, string[]> = {
  "black": ["black", "noir", "ebony", "onyx", "charcoal"],
  "white": ["white", "ivory", "cream", "off-white", "snow"],
  "red": ["red", "crimson", "scarlet", "burgundy", "maroon", "wine"],
  "blue": ["blue", "navy", "royal", "cobalt", "azure", "teal", "turquoise", "cyan"],
  "green": ["green", "olive", "forest", "emerald", "sage", "mint", "lime"],
  "yellow": ["yellow", "gold", "golden", "mustard", "lemon"],
  "orange": ["orange", "coral", "peach", "tangerine"],
  "pink": ["pink", "rose", "blush", "fuchsia", "magenta"],
  "purple": ["purple", "violet", "lavender", "plum", "lilac"],
  "brown": ["brown", "tan", "beige", "khaki", "camel", "chocolate", "coffee"],
  "gray": ["gray", "grey", "silver", "slate", "ash"],
};

const SIZE_PATTERNS = [
  /\b(xx?s|xx?l|xx?xx?l|small|medium|large)\b/i,
  /\bsize\s*(\d+)\b/i,
  /\b(\d{1,2})\s*(us|uk|eu)\b/i,
  /\b(one\s*size|os|free\s*size)\b/i,
];

const PRICE_PATTERNS = [
  /under\s*\$?(\d+)/i,
  /below\s*\$?(\d+)/i,
  /less\s*than\s*\$?(\d+)/i,
  /\$?(\d+)\s*-\s*\$?(\d+)/,
  /between\s*\$?(\d+)\s*and\s*\$?(\d+)/i,
  /above\s*\$?(\d+)/i,
  /over\s*\$?(\d+)/i,
  /cheap|budget|affordable|expensive|luxury|premium/i,
];

const SYNONYMS: Record<string, string[]> = {
  "tshirt": ["t-shirt", "tee", "shirt"],
  "pants": ["trousers", "slacks", "bottoms"],
  "sneakers": ["trainers", "athletic shoes", "kicks"],
  "hoodie": ["hooded sweatshirt", "pullover"],
  "jeans": ["denim", "denims"],
  "jacket": ["coat", "outerwear"],
  "bag": ["purse", "handbag", "tote"],
  "cheap": ["affordable", "budget", "inexpensive"],
  "expensive": ["luxury", "premium", "high-end", "designer"],
};

// ============================================================================
// Query Parsing
// ============================================================================

/**
 * Parse and understand a search query
 */
export function parseQuery(query: string): ParsedQuery {
  const normalizedQuery = normalizeQuery(query);
  const entities = extractEntities(normalizedQuery);
  const intent = classifyIntent(normalizedQuery, entities);
  const expandedTerms = expandQuery(normalizedQuery, entities);
  const semanticQuery = buildSemanticQuery(normalizedQuery, entities, intent);

  return {
    originalQuery: query,
    normalizedQuery,
    entities,
    intent,
    expandedTerms,
    semanticQuery,
  };
}

/**
 * Normalize query text
 */
function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .replace(/[^\w\s'-]/g, " ")  // Keep apostrophes and hyphens
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract entities from query
 */
function extractEntities(query: string): QueryEntities {
  const words = query.split(/\s+/);
  const entities: QueryEntities = {
    brands: [],
    categories: [],
    colors: [],
    sizes: [],
    attributes: [],
  };

  // Extract brands
  for (const brand of KNOWN_BRANDS) {
    if (query.includes(brand)) {
      entities.brands.push(brand);
    }
  }

  // Extract categories
  for (const [category, keywords] of Object.entries(CATEGORY_MAP)) {
    for (const keyword of keywords) {
      if (words.includes(keyword) || query.includes(keyword)) {
        if (!entities.categories.includes(category)) {
          entities.categories.push(category);
        }
        break;
      }
    }
  }

  // Extract colors
  for (const [baseColor, variants] of Object.entries(COLOR_MAP)) {
    for (const variant of variants) {
      if (words.includes(variant) || query.includes(variant)) {
        if (!entities.colors.includes(baseColor)) {
          entities.colors.push(baseColor);
        }
        break;
      }
    }
  }

  // Extract sizes
  for (const pattern of SIZE_PATTERNS) {
    const match = query.match(pattern);
    if (match) {
      entities.sizes.push(match[0].toLowerCase());
    }
  }

  // Extract price range
  for (const pattern of PRICE_PATTERNS) {
    const match = query.match(pattern);
    if (match) {
      if (query.match(/under|below|less than/i) && match[1]) {
        entities.priceRange = { max: parseInt(match[1]) };
      } else if (query.match(/above|over/i) && match[1]) {
        entities.priceRange = { min: parseInt(match[1]) };
      } else if (match[1] && match[2]) {
        entities.priceRange = { min: parseInt(match[1]), max: parseInt(match[2]) };
      } else if (query.match(/cheap|budget|affordable/i)) {
        entities.priceRange = { max: 50 };  // Configurable threshold
      } else if (query.match(/expensive|luxury|premium/i)) {
        entities.priceRange = { min: 200 };  // Configurable threshold
      }
      break;
    }
  }

  // Extract style attributes
  const styleWords = ["casual", "formal", "vintage", "modern", "classic", "trendy", "minimalist", "bohemian", "streetwear", "athletic", "elegant", "sporty"];
  for (const style of styleWords) {
    if (words.includes(style)) {
      entities.attributes.push(style);
    }
  }

  return entities;
}

/**
 * Classify query intent
 */
function classifyIntent(query: string, entities: QueryEntities): QueryIntent {
  // Brand-focused queries
  if (entities.brands.length > 0 && entities.categories.length === 0) {
    return "brand_search";
  }

  // Category browsing
  if (entities.categories.length > 0 && entities.brands.length === 0 && query.split(/\s+/).length <= 3) {
    return "category_browse";
  }

  // Price-focused
  if (entities.priceRange || query.match(/cheap|expensive|budget|affordable|price/i)) {
    return "price_search";
  }

  // Style search
  if (entities.attributes.length > 0) {
    return "style_search";
  }

  // Comparison queries
  if (query.match(/vs|versus|compare|better|or/i)) {
    return "comparison";
  }

  // Specific item (detailed query)
  if (query.split(/\s+/).length >= 5 || (entities.brands.length > 0 && entities.categories.length > 0)) {
    return "specific_item";
  }

  return "product_search";
}

/**
 * Expand query with synonyms and related terms
 */
function expandQuery(query: string, entities: QueryEntities): string[] {
  const expanded: Set<string> = new Set();
  const words = query.split(/\s+/);

  for (const word of words) {
    // Add synonyms
    for (const [term, synonyms] of Object.entries(SYNONYMS)) {
      if (word === term || synonyms.includes(word)) {
        expanded.add(term);
        synonyms.forEach(s => expanded.add(s));
      }
    }
  }

  // Add category keywords
  for (const category of entities.categories) {
    const keywords = CATEGORY_MAP[category];
    if (keywords) {
      keywords.slice(0, 3).forEach(k => expanded.add(k));  // Top 3 keywords
    }
  }

  // Add color variants
  for (const color of entities.colors) {
    const variants = COLOR_MAP[color];
    if (variants) {
      variants.slice(0, 2).forEach(v => expanded.add(v));
    }
  }

  return Array.from(expanded);
}

/**
 * Build optimized query for semantic search
 * 
 * IMPORTANT: Preserve the original query term while adding semantic context.
 * Example: "blazer" → "blazer outerwear" (not just "outerwear")
 */
function buildSemanticQuery(query: string, entities: QueryEntities, intent: QueryIntent): string {
  const parts: string[] = [];

  // ⭐ PRIORITY: Add original query first (most important for matching)
  parts.push(query);

  // Add entity context for semantic enhancement
  if (entities.brands.length > 0) {
    parts.push(entities.brands.join(" "));
  }

  // Add category but only if it differs from query
  // (Avoid duplication like "blazer" + "blazer" from category name)
  if (entities.categories.length > 0) {
    const categoryStr = entities.categories.join(" ");
    if (!query.toLowerCase().includes(categoryStr.toLowerCase())) {
      parts.push(categoryStr);
    }
  }

  if (entities.colors.length > 0) {
    parts.push(entities.colors.join(" "));
  }

  if (entities.attributes.length > 0) {
    parts.push(entities.attributes.join(" "));
  }

  // Add intent-specific context for CLIP
  switch (intent) {
    case "style_search":
      parts.push("fashion style");
      break;
    case "brand_search":
      parts.push("clothing apparel");
      break;
    case "category_browse":
      parts.push("fashion");
      break;
  }

  const result = parts.join(" ").replace(/\s+/g, " ").trim();
  return result;
}

// ============================================================================
// Dynamic Entity Learning
// ============================================================================

let _dbEntitiesLoaded = false;

/**
 * One-time DB enrichment — safe to call multiple times (no-op after first).
 * Call once at startup before serving traffic.
 */
export async function loadEntitiesFromDB(): Promise<void> {
  if (_dbEntitiesLoaded) return;

  try {
    const [brandsResult, categoriesResult] = await Promise.all([
      pg.query(`SELECT DISTINCT LOWER(brand) as brand FROM products WHERE brand IS NOT NULL`),
      pg.query(`SELECT DISTINCT LOWER(category) as category FROM products WHERE category IS NOT NULL`),
    ]);

    for (const row of brandsResult.rows) {
      KNOWN_BRANDS.add(row.brand);
    }

    for (const row of categoriesResult.rows) {
      if (!CATEGORY_MAP[row.category]) {
        CATEGORY_MAP[row.category] = [row.category];
      }
    }

    _dbEntitiesLoaded = true;
    console.log(`[SemanticSearch] Loaded ${brandsResult.rowCount} brands + ${categoriesResult.rowCount} categories from DB`);
  } catch (err) {
    console.warn("[SemanticSearch] Could not load entities from DB:", err);
  }
}

/** @deprecated Use loadEntitiesFromDB() instead */
export const loadBrandsFromDB = loadEntitiesFromDB;
/** @deprecated Use loadEntitiesFromDB() instead */
export const loadCategoriesFromDB = loadEntitiesFromDB;

// ============================================================================
// Hybrid Search Scoring
// ============================================================================

export interface HybridSearchWeights {
  semantic: number;    // Weight for vector similarity (0-1)
  keyword: number;     // Weight for BM25 text match (0-1)
  entityBoost: number; // Boost for entity matches (multiplier)
}

const DEFAULT_WEIGHTS: HybridSearchWeights = {
  semantic: 0.6,
  keyword: 0.4,
  entityBoost: 1.2,
};

/**
 * Calculate hybrid score combining semantic and keyword scores
 */
export function calculateHybridScore(
  semanticScore: number,
  keywordScore: number,
  entityMatches: number,
  weights: HybridSearchWeights = DEFAULT_WEIGHTS
): number {
  const baseScore = (semanticScore * weights.semantic) + (keywordScore * weights.keyword);
  const boost = entityMatches > 0 ? Math.pow(weights.entityBoost, Math.min(entityMatches, 3)) : 1;
  return baseScore * boost;
}

/**
 * Check how many entities match a product
 */
export function countEntityMatches(
  product: { brand?: string; category?: string; color?: string; title?: string },
  entities: QueryEntities
): number {
  let matches = 0;

  if (product.brand && entities.brands.includes(product.brand.toLowerCase())) {
    matches++;
  }

  if (product.category && entities.categories.includes(product.category.toLowerCase())) {
    matches++;
  }

  const title = product.title?.toLowerCase() || "";
  
  for (const color of entities.colors) {
    if (title.includes(color)) {
      matches++;
      break;
    }
  }

  for (const attr of entities.attributes) {
    if (title.includes(attr)) {
      matches++;
      break;
    }
  }

  return matches;
}

// ============================================================================
// OpenSearch Query Builder
// ============================================================================

/**
 * Build OpenSearch query with semantic understanding
 */
export function buildSemanticOpenSearchQuery(
  parsedQuery: ParsedQuery,
  embedding?: number[],
  limit: number = 20
): any {
  const { entities, expandedTerms, semanticQuery, intent } = parsedQuery;

  // Base filter
  const filter: any[] = [{ term: { is_hidden: false } }];

  // Add entity filters
  if (entities.brands.length === 1) {
    filter.push({ term: { brand: entities.brands[0] } });
  } else if (entities.brands.length > 1) {
    filter.push({ terms: { brand: entities.brands } });
  }

  if (entities.categories.length === 1) {
    filter.push({ term: { category: entities.categories[0] } });
  } else if (entities.categories.length > 1) {
    filter.push({ terms: { category: entities.categories } });
  }

  // Price filter
  if (entities.priceRange) {
    const priceFilter: any = {};
    if (entities.priceRange.min) priceFilter.gte = entities.priceRange.min;
    if (entities.priceRange.max) priceFilter.lte = entities.priceRange.max;
    filter.push({ range: { price_usd: priceFilter } });
  }

  // Build query based on available data
  if (embedding && embedding.length > 0) {
    // Hybrid: k-NN + text
    return {
      size: limit,
      query: {
        bool: {
          should: [
            // Semantic vector search
            {
              knn: {
                embedding: {
                  vector: embedding,
                  k: limit,
                },
              },
            },
            // Text search with expanded terms
            {
              multi_match: {
                query: [semanticQuery, ...expandedTerms].join(" "),
                fields: ["title^3", "brand^2", "category", "description"],
                fuzziness: "AUTO",
                operator: "or",
              },
            },
          ],
          filter: filter,
          minimum_should_match: 1,
        },
      },
    };
  } else {
    // Text-only search with semantic understanding
    const should: any[] = [
      // Main query
      {
        multi_match: {
          query: semanticQuery,
          fields: ["title^3", "brand^2", "category", "description"],
          fuzziness: "AUTO",
          type: "best_fields",
          boost: 2,
        },
      },
    ];

    // Add expanded term matches
    if (expandedTerms.length > 0) {
      should.push({
        multi_match: {
          query: expandedTerms.join(" "),
          fields: ["title", "description"],
          fuzziness: "AUTO",
          operator: "or",
          boost: 0.5,
        },
      });
    }

    // Boost color matches
    for (const color of entities.colors) {
      should.push({
        match: { title: { query: color, boost: 1.5 } },
      });
    }

    // Boost style matches
    for (const attr of entities.attributes) {
      should.push({
        match: { title: { query: attr, boost: 1.3 } },
      });
    }

    return {
      size: limit,
      query: {
        bool: {
          should,
          filter,
          minimum_should_match: 1,
        },
      },
    };
  }
}
