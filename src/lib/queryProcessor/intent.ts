/**
 * Intent Classification
 *
 * Simple rule-based intent detection for search queries
 * Hybrid approach: Rules first, ML fallback when confidence is low
 */

export interface IntentResult {
  type: "price_search" | "product_search" | "comparison" | "brand_search" | "outfit_completion" | "trending_search";
  confidence: "high" | "medium" | "low";
  source?: "rules" | "ml_model";
}

/**
 * Classify query intent using simple rules
 */
export function classifyQueryIntent(query: string, knownBrands: string[] = []): IntentResult {
  const lowerQuery = query.toLowerCase().trim();
  const words = lowerQuery.split(/\s+/);

  // Rule 1: Price search intent
  // Patterns: "under", "less than", "<", "$", "ليرة" (Lebanese Lira), price indicators
  const pricePatterns = [
    /\b(under|less\s+than|below|cheaper\s+than|max|maximum)\b/i,
    /[<]/,
    /[$]/,
    /\bليرة\b/,
    /\b(budget|affordable|cheap)\b/i,
    /\b\d+\s*(dollar|usd|lira|ليرة)\b/i
  ];

  for (const pattern of pricePatterns) {
    if (pattern.test(query)) {
      return {
        type: "price_search",
        confidence: "high",
        source: "rules"
      };
    }
  }

  // Rule 2: Comparison intent
  // Patterns: "vs", "versus", "compare", "مقارنة" (Arabic: comparison)
  const comparisonPatterns = [
    /\b(vs|versus|compare|comparison|difference|between)\b/i,
    /\bمقارنة\b/,
    /\b(or|either)\b.*\b(or)\b/i // "nike or adidas"
  ];

  for (const pattern of comparisonPatterns) {
    if (pattern.test(query)) {
      return {
        type: "comparison",
        confidence: "high",
        source: "rules"
      };
    }
  }

  // Rule 3: Brand search intent
  // Check if query is only a known brand (single word or brand name)
  if (knownBrands.length > 0) {
    const normalizedBrands = knownBrands.map(brand => brand.toLowerCase());
    const queryWords = words.filter(word => word.length > 1); // Filter out short words

    // Check if entire query is just a brand name
    if (queryWords.length === 1 && normalizedBrands.includes(queryWords[0])) {
      return {
        type: "brand_search",
        confidence: "high",
        source: "rules"
      };
    }

    // Check if query is multi-word brand name
    const queryText = queryWords.join(' ');
    for (const brand of normalizedBrands) {
      if (brand.includes(' ') && queryText === brand) {
        return {
          type: "brand_search",
          confidence: "high",
          source: "rules"
        };
      }
    }
  }

  // Rule 4: Outfit completion intent
  // Patterns: "outfit", "match", "goes with", "complete", occasion-based
  const outfitPatterns = [
    /\b(outfit|complete|match|goes\s+with|pair\s+with|coordinate)\b/i,
    /\b(wedding|party|work|formal|casual|beach|winter|summer)\s+(outfit|dress|clothes)\b/i,
    /\b(eid|christmas|graduation|interview)\s+(outfit|clothes|dress)\b/i,
    // Arabic
    /\b(ملابس|فستان)\s+(العرس|الحفلة|العمل|العيد)\b/,
    /\b(تنسيق|مجموعة)\s+ملابس\b/,
    // Arabizi
    /\b(tiyab|fstan)\s+(3ars|7afle|shaghil|3eed)\b/i,
    /\btansee2 tiyab\b/i
  ];

  for (const pattern of outfitPatterns) {
    if (pattern.test(query)) {
      return {
        type: "outfit_completion",
        confidence: "high",
        source: "rules"
      };
    }
  }

  // Rule 5: Trending search intent
  // Patterns: "trending", "popular", "new", "latest", "hot"
  const trendingPatterns = [
    /\b(trending|popular|latest|new|hot|fashionable|in\s+style)\b/i,
    /\b(what's|whats)\s+(hot|new|trending|popular)\b/i,
    /\b(fashion\s+trends|latest\s+arrivals|new\s+collection)\b/i,
    // Arabic
    /\b(موضة|أحدث|جديد|رائج|صيحات)\b/,
    /\b(آخر\s+صيحة|أحدث\s+الصيحات)\b/,
    // Arabizi
    /\b(moda|a7dash|sa7at|trending)\b/i,
    /\b(akhir sa7a)\b/i
  ];

  for (const pattern of trendingPatterns) {
    if (pattern.test(query)) {
      return {
        type: "trending_search",
        confidence: "high",
        source: "rules"
      };
    }
  }

  // Rule 6: Product search with gender filter
  // Patterns: "for men", "رجالي" (men's), "men", "women", "kids", etc.
  const genderPatterns = [
    // English
    /\b(for\s+)?(men|mens?|male|boys?|man)\b/i,
    /\b(for\s+)?(women|womens?|female|girls?|ladies|lady)\b/i,
    /\b(for\s+)?(kids?|children|child|unisex)\b/i,
    // Arabic
    /\b(رجالي|للرجال|رجال)\b/,
    /\b(نسائي|للنساء|حريمي|نساء)\b/,
    /\b(أطفال|للأطفال|طفل)\b/,
    // Arabizi
    /\b(rijali|rejali|rigali)\b/i,
    /\b(nisa2i|nisai|nisaei|7arimi)\b/i,
    /\b(atfal|tfl)\b/i
  ];

  for (const pattern of genderPatterns) {
    if (pattern.test(query)) {
      // High confidence if explicit "for men" pattern
      const confidence = /\b(for\s+)?(men|women|kids|رجالي|نسائي|أطفال)\b/i.test(query) ? "high" : "medium";
      return {
        type: "product_search",
        confidence,
        source: "rules"
      };
    }
  }

  // Check for very ambiguous queries that need ML
  const ambiguousPatterns = [
    /^(nice|good|great|beautiful|cute|lovely)\s+\w+$/i, // "nice shoes"
    /^(show\s+me|give\s+me|i\s+want|i\s+need)\b/i,    // "show me something"
    /^(something|anything|stuff|things)\b/i,            // "something nice"
    /^(shi|ay\s+shi|baddi)\b/i,                        // Arabizi ambiguous
    /^(أريد|بدي|ورني)\b/,                               // Arabic ambiguous
  ];

  for (const pattern of ambiguousPatterns) {
    if (pattern.test(query)) {
      return {
        type: "product_search",
        confidence: "low", // This will trigger ML
        source: "rules"
      };
    }
  }

  // Default: Product search with medium confidence
  return {
    type: "product_search",
    confidence: "medium",
    source: "rules"
  };
}

/**
 * Get detailed intent explanation (for debugging)
 */
export function getIntentExplanation(query: string, result: IntentResult): string {
  const lowerQuery = query.toLowerCase();

  switch (result.type) {
    case "price_search":
      if (/[$ليرة]/.test(query)) {
        return "Currency symbol detected";
      }
      if (/\b(under|less\s+than|below)\b/i.test(query)) {
        return "Price comparison keywords found";
      }
      if (/\b(budget|affordable|cheap)\b/i.test(query)) {
        return "Budget-related keywords detected";
      }
      return "Price-related patterns detected";

    case "comparison":
      if (/\b(vs|versus)\b/i.test(query)) {
        return "Comparison keywords (vs/versus) found";
      }
      if (/\bمقارنة\b/.test(query)) {
        return "Arabic comparison keyword detected";
      }
      if (/\bcompare\b/i.test(query)) {
        return "Explicit comparison request";
      }
      return "Comparison patterns detected";

    case "brand_search":
      return "Query appears to be a brand name only";

    case "product_search":
      if (/\b(for\s+)?(men|women|kids)\b/i.test(query)) {
        return "Gender-specific product search";
      }
      if (/\b(رجالي|نسائي|أطفال)\b/.test(query)) {
        return "Arabic gender keywords detected";
      }
      return "General product search";

    default:
      return "Default classification";
  }
}

/**
 * Extract confidence score as number (0-1)
 */
export function getConfidenceScore(confidence: "high" | "medium" | "low"): number {
  switch (confidence) {
    case "high":
      return 0.9;
    case "medium":
      return 0.7;
    case "low":
      return 0.5;
    default:
      return 0.5;
  }
}

/**
 * Hybrid Intent Classification - Rules first, ML fallback
 */
export async function classifyQueryIntentHybrid(
  query: string,
  knownBrands: string[] = [],
  useML: boolean = false
): Promise<IntentResult> {
  // Step 1: Try rule-based classification
  const ruleResult = classifyQueryIntent(query, knownBrands);

  // Step 2: If confidence is low and ML is available, use ML
  if (useML && ruleResult.confidence === "low") {
    try {
      // Import ML functions dynamically to avoid dependency issues
      const { shouldUseML, getMLIntentPrediction } = await import("./ml-intent");

      if (shouldUseML(ruleResult)) {
        const mlResult = await getMLIntentPrediction(query);

        if (mlResult && mlResult.confidence > 0.7) {
          return {
            type: mlResult.type,
            confidence: mlResult.confidence > 0.85 ? "high" : "medium",
            source: "ml_model"
          };
        }
      }
    } catch (error) {
      console.warn("ML intent classification failed, using rules:", error);
    }
  }

  // Step 3: Return rule-based result
  return ruleResult;
}





