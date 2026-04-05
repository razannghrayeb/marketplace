/**
 * Wardrobe Recommendations Service
 * Personalized product recommendations based on wardrobe analysis
 */
import { pg } from "../../lib/core";
import { osClient } from "../../lib/core";
import { config } from "../../config";
import { getStyleProfile } from "./styleProfile.service";
import { analyzeWardrobeGaps } from "./gaps.service";
import { getTopCompatibleItems } from "./compatibility.service";
import { 
  getOnboardingRecommendations as getColdStartOnboarding,
  isUserColdStart 
} from "../../lib/recommendations/coldStart";
import { getAdaptedEssentials, inferPriceTier } from "../../lib/wardrobe/lifestyleAdapter";
import { inferWardrobeSlotsFromWardrobeRows } from "../../lib/wardrobe/outfitSlotInference";
import { normalizeQueryGender } from "../../lib/search/searchHitRelevance";

// ============================================================================
// Types
// ============================================================================

export interface ProductRecommendation {
  product_id: number;
  title: string;
  brand?: string;
  category?: string;
  price_cents?: number;
  image_url?: string;
  image_cdn?: string;
  score: number;
  reason: string;
  reason_type: "gap" | "style_match" | "compatible" | "trending";
}

export interface RecommendationOptions {
  limit?: number;
  includeGapBased?: boolean;
  includeStyleBased?: boolean;
  includeCompatibilityBased?: boolean;
  priceMin?: number;
  priceMax?: number;
  categories?: string[];
}

export interface CompleteLookSuggestion extends ProductRecommendation {
  fitBreakdown?: {
    embeddingNorm: number;
    categoryCompat: number;
    colorHarmony: number;
    styleAlignment?: number;
    patternAlignment?: number;
    materialAlignment?: number;
    formalityAlignment?: number;
  };
}

export interface OutfitSetSuggestion {
  productIds: number[];
  categories: string[];
  coherenceScore: number;
  totalScore: number;
  reasons: string[];
}

export interface CompleteLookSuggestionsResult {
  suggestions: CompleteLookSuggestion[];
  outfitSets: OutfitSetSuggestion[];
  missingCategories: string[];
}

/** Slots used for gap detection (DB name, vision, and OpenSearch slot labels). */
const TRACKED_OUTFIT_SLOTS = new Set([
  "tops",
  "bottoms",
  "shoes",
  "dresses",
  "outerwear",
  "bags",
  "accessories",
]);

function isTrackedOutfitSlot(value: string): boolean {
  return TRACKED_OUTFIT_SLOTS.has(value);
}

function normalizeWardrobeCategory(value?: string | null): string | null {
  if (!value) return null;
  const raw = value.toLowerCase().trim();
  if (!raw) return null;
  if (raw.includes("dress") || raw.includes("gown")) return "dresses";
  if (raw.includes("top") || raw.includes("shirt") || raw.includes("blouse") || raw.includes("hoodie") || raw.includes("sweater"))
    return "tops";
  if (
    raw.includes("bottom") ||
    raw.includes("pant") ||
    raw.includes("trouser") ||
    raw.includes("jeans") ||
    raw.includes("skirt") ||
    raw.includes("short")
  )
    return "bottoms";
  if (
    raw.includes("footwear") ||
    raw.includes("shoe") ||
    raw.includes("sneaker") ||
    raw.includes("heel") ||
    raw.includes("boot") ||
    raw.includes("sandal") ||
    raw.includes("loafer") ||
    raw.includes("flat")
  )
    return "shoes";
  if (raw.includes("outerwear") || raw.includes("coat") || raw.includes("jacket") || raw.includes("blazer") || raw.includes("cardigan"))
    return "outerwear";
  if (raw.includes("bag") || raw.includes("tote") || raw.includes("clutch") || raw.includes("wallet")) return "bags";
  if (raw.includes("accessor") || raw.includes("watch") || raw.includes("scarf") || raw.includes("hat") || raw.includes("sunglass") || raw.includes("jewelry"))
    return "accessories";
  return raw;
}

function dedupeCompleteLookSuggestions(items: CompleteLookSuggestion[]): CompleteLookSuggestion[] {
  const seen = new Set<string>();
  const out: CompleteLookSuggestion[] = [];
  for (const s of items) {
    const img = String(s.image_cdn || s.image_url || "")
      .split("?")[0]
      .toLowerCase()
      .trim();
    const key =
      img ||
      `${String(s.brand || "")
        .toLowerCase()
        .trim()}|${String(s.title || "")
        .toLowerCase()
        .trim()
        .slice(0, 96)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

// ============================================================================
// Recommendation Generation
// ============================================================================

/**
 * Get personalized product recommendations
 */
export async function getRecommendations(
  userId: number,
  options: RecommendationOptions = {}
): Promise<ProductRecommendation[]> {
  const {
    limit = 20,
    includeGapBased = true,
    includeStyleBased = true,
    includeCompatibilityBased = true,
    priceMin,
    priceMax,
    categories
  } = options;

  const recommendations: ProductRecommendation[] = [];
  const seenProductIds = new Set<number>();

  // Build price filter
  const priceFilter: any[] = [];
  if (priceMin !== undefined) {
    priceFilter.push({ range: { price_usd: { gte: priceMin / 100 } } });
  }
  if (priceMax !== undefined) {
    priceFilter.push({ range: { price_usd: { lte: priceMax / 100 } } });
  }

  // 1. Gap-based recommendations
  if (includeGapBased) {
    const gapRecs = await getGapBasedRecommendations(userId, Math.ceil(limit / 3), priceFilter);
    for (const rec of gapRecs) {
      if (!seenProductIds.has(rec.product_id)) {
        recommendations.push(rec);
        seenProductIds.add(rec.product_id);
      }
    }
  }

  // 2. Style-based recommendations (similar to user's style centroid)
  if (includeStyleBased) {
    const styleRecs = await getStyleBasedRecommendations(userId, Math.ceil(limit / 3), priceFilter);
    for (const rec of styleRecs) {
      if (!seenProductIds.has(rec.product_id)) {
        recommendations.push(rec);
        seenProductIds.add(rec.product_id);
      }
    }
  }

  // 3. Compatibility-based (items that go with user's wardrobe)
  if (includeCompatibilityBased) {
    const compatRecs = await getCompatibilityBasedRecommendations(userId, Math.ceil(limit / 3), priceFilter);
    for (const rec of compatRecs) {
      if (!seenProductIds.has(rec.product_id)) {
        recommendations.push(rec);
        seenProductIds.add(rec.product_id);
      }
    }
  }

  // Sort by score and limit
  return recommendations
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Get recommendations based on wardrobe gaps
 */
async function getGapBasedRecommendations(
  userId: number,
  limit: number,
  priceFilter: any[]
): Promise<ProductRecommendation[]> {
  const { gaps, recommendations: gapRecs } = await analyzeWardrobeGaps(userId);
  const products: ProductRecommendation[] = [];

  for (const gap of gapRecs.slice(0, 3)) {
    try {
      const filter: any[] = [
        { term: { availability: "in_stock" } },
        ...priceFilter
      ];

      const response = await osClient.search({
        index: config.opensearch.index,
        body: {
          size: Math.ceil(limit / 3),
          query: {
            bool: {
              must: {
                multi_match: {
                  query: gap.search_query,
                  fields: ["title^2", "category", "brand"]
                }
              },
              filter
            }
          }
        }
      });

      for (const hit of response.body.hits.hits) {
        const source = hit._source;
        products.push({
          product_id: parseInt(source.product_id, 10),
          title: source.title,
          brand: source.brand,
          category: source.category,
          price_cents: source.price_usd ? source.price_usd * 100 : undefined,
          image_url: source.image_cdn,
          score: hit._score * (gap.priority === "high" ? 1.5 : gap.priority === "medium" ? 1.2 : 1.0),
          reason: gap.message,
          reason_type: "gap"
        });
      }
    } catch (err) {
      console.error("Error fetching gap-based recommendations:", err);
    }
  }

  return products;
}

/**
 * Get recommendations based on user's style profile
 */
async function getStyleBasedRecommendations(
  userId: number,
  limit: number,
  priceFilter: any[]
): Promise<ProductRecommendation[]> {
  const profile = await getStyleProfile(userId);
  if (!profile?.style_centroid) {
    return [];
  }

  try {
    const response = await osClient.search({
      index: config.opensearch.index,
      body: {
        size: limit,
        query: {
          bool: {
            must: {
              knn: {
                embedding: {
                  vector: profile.style_centroid,
                  k: limit * 2
                }
              }
            },
            filter: [
              { term: { availability: "in_stock" } },
              ...priceFilter
            ]
          }
        }
      }
    });

    return response.body.hits.hits.map((hit: any) => ({
      product_id: parseInt(hit._source.product_id, 10),
      title: hit._source.title,
      brand: hit._source.brand,
      category: hit._source.category,
      price_cents: hit._source.price_usd ? hit._source.price_usd * 100 : undefined,
      image_url: hit._source.image_cdn,
      score: hit._score,
      reason: "Matches your style",
      reason_type: "style_match" as const
    }));
  } catch (err) {
    console.error("Error fetching style-based recommendations:", err);
    return [];
  }
}

/**
 * Get recommendations based on wardrobe compatibility
 */
async function getCompatibilityBasedRecommendations(
  userId: number,
  limit: number,
  priceFilter: any[]
): Promise<ProductRecommendation[]> {
  // Get user's favorite/most used items
  const favItems = await pg.query<{ id: number; embedding: number[] }>(
    `SELECT id, embedding FROM wardrobe_items 
     WHERE user_id = $1 AND embedding IS NOT NULL
     ORDER BY created_at DESC
     LIMIT 5`,
    [userId]
  );

  if (favItems.rows.length === 0) {
    return [];
  }

  // Use the most recent item's embedding to find compatible products
  const recentItem = favItems.rows[0];
  if (!recentItem.embedding) {
    return [];
  }

  try {
    const response = await osClient.search({
      index: config.opensearch.index,
      body: {
        size: limit,
        query: {
          bool: {
            must: {
              knn: {
                embedding: {
                  vector: recentItem.embedding,
                  k: limit * 2
                }
              }
            },
            filter: [
              { term: { availability: "in_stock" } },
              ...priceFilter
            ]
          }
        }
      }
    });

    return response.body.hits.hits.map((hit: any) => ({
      product_id: parseInt(hit._source.product_id, 10),
      title: hit._source.title,
      brand: hit._source.brand,
      category: hit._source.category,
      price_cents: hit._source.price_usd ? hit._source.price_usd * 100 : undefined,
      image_url: hit._source.image_cdn,
      score: hit._score * 0.9, // Slightly lower priority than gap/style
      reason: "Goes well with items in your wardrobe",
      reason_type: "compatible" as const
    }));
  } catch (err) {
    console.error("Error fetching compatibility-based recommendations:", err);
    return [];
  }
}

/**
 * Get outfit suggestions for a specific item
 */
export async function getOutfitSuggestions(
  userId: number,
  itemId: number,
  limit: number = 5
): Promise<Array<{ items: number[]; score: number }>> {
  // Get compatible items from wardrobe
  const compatible = await getTopCompatibleItems(userId, itemId, 20);

  // Group into potential outfits
  const outfits: Array<{ items: number[]; score: number }> = [];

  // Simple greedy outfit building
  for (let i = 0; i < Math.min(limit, compatible.length); i++) {
    const outfit = [itemId, compatible[i].item_id];
    let score = compatible[i].score;

    // Try to add more items
    for (const c of compatible.slice(i + 1)) {
      if (outfit.length >= 4) break;
      outfit.push(c.item_id);
      score += c.score * 0.5;
    }

    outfits.push({ items: outfit, score });
  }

  return outfits.sort((a, b) => b.score - a.score);
}

/** Rows that anchor complete-look (wardrobe items or catalog products). */
type CompleteLookAnchorRow = {
  id?: number;
  product_id?: number | null;
  embedding?: unknown;
  dominant_colors?: Array<{ hex?: string }>;
  name?: string | null;
  image_url?: string | null;
  image_cdn?: string | null;
  category_name?: string | null;
  title?: string | null;
  gender?: string | null;
};

type AudienceGender = "men" | "women" | "unisex";

async function runCompleteLookCore(
  userId: number,
  currentItems: CompleteLookAnchorRow[],
  limit: number
): Promise<CompleteLookSuggestionsResult> {
  const currentCategories = new Set<string>();
  const currentCategoryList: string[] = [];
  const pushCategory = (normalized: string | null) => {
    if (!normalized || !isTrackedOutfitSlot(normalized)) return;
    if (!currentCategories.has(normalized)) {
      currentCategories.add(normalized);
      currentCategoryList.push(normalized);
    }
  };

  for (const row of currentItems) {
    pushCategory(normalizeWardrobeCategory(row.category_name));
    pushCategory(normalizeWardrobeCategory(row.name));
  }

  const visionSlots = await inferWardrobeSlotsFromWardrobeRows(currentItems);
  for (const slot of visionSlots) pushCategory(slot);

  const hasDress = currentCategoryList.some((c) => c === "dresses");
  const warmWeatherLikely = inferWarmWeatherLook(currentItems);
  const inferredAudienceGender = await inferPreferredAudienceGender(userId, currentItems);
  const essentialForOutfit = hasDress ? ["shoes", "outerwear"] : ["tops", "bottoms", "shoes"];
  const missingCategories = essentialForOutfit.filter((c) => !currentCategories.has(c));
  const optionalComplements = hasDress
    ? (["bags", "accessories", "outerwear"] as const)
    : (warmWeatherLikely
        ? (["accessories", "bags", "outerwear"] as const)
        : (["bags", "accessories", "outerwear"] as const));
  for (const extra of optionalComplements) {
    if (missingCategories.length >= 2) break;
    if (!currentCategories.has(extra) && !missingCategories.includes(extra)) {
      missingCategories.push(extra);
    }
  }
  if (missingCategories.length === 0) {
    missingCategories.push("accessories", "bags");
  }

  const currentEmbeddings = currentItems
    .map((row) => parseVector(row.embedding))
    .filter((vec): vec is number[] => Array.isArray(vec) && vec.length > 0);

  const styleProfile = await getStyleProfile(userId).catch(() => null);
  let centroid = meanEmbedding(currentEmbeddings);
  if (!centroid && styleProfile?.style_centroid && styleProfile.style_centroid.length > 0) {
    centroid = styleProfile.style_centroid;
  }

  const userPriceTier = await inferPriceTier(userId).catch(() => null);
  const ownedProductIds = new Set<string>(
    currentItems
      .map((r) => (r.product_id !== null && r.product_id !== undefined ? String(r.product_id) : ""))
      .filter(Boolean)
  );

  const wardrobeColorFamilies = extractWardrobeColorFamilies(currentItems);
  const preferredPatterns = topHistogramKeys(styleProfile?.pattern_histogram, 3);
  const preferredMaterials = topHistogramKeys(styleProfile?.material_histogram, 3);
  const preferredStyleTerms = inferStyleTermsFromCurrentItems(currentItems, styleProfile?.occasion_coverage || []);
  const preferredFormality = inferPreferredFormality(styleProfile?.occasion_coverage || []);
  const suggestionsByCategory = new Map<string, CompleteLookSuggestion[]>();

  const sourceFields = [
    "product_id",
    "title",
    "brand",
    "category",
    "category_canonical",
    "price_usd",
    "image_cdn",
    "color_primary_canonical",
    "attr_color",
    "attr_style",
    "attr_pattern",
    "attr_material",
    "attr_gender",
    "audience_gender",
    "age_group",
  ];

  for (const category of missingCategories) {
    try {
      const perCategoryPool = Math.max(20, Math.ceil(limit / Math.max(missingCategories.length, 1)) * 8);
      const minPerCategory = Math.max(4, Math.ceil(limit / Math.max(1, missingCategories.length)));
      const canonical = wardrobeSlotToCategoryCanonical(category);

      const buildFilters = (applyPriceTier: boolean): any[] => {
        const f: any[] = [
          { term: { availability: "in_stock" } },
          { term: { category_canonical: canonical } },
        ];
        if (inferredAudienceGender && inferredAudienceGender !== "unisex") {
          f.push(buildAudienceGenderFilter(inferredAudienceGender));
        }
        if (applyPriceTier && userPriceTier) {
          f.push({
            range: {
              price_usd: {
                gte: Math.max(0, userPriceTier.min / 100),
                lte: Math.max(userPriceTier.max / 100, userPriceTier.min / 100),
              },
            },
          });
        }
        if (ownedProductIds.size > 0) {
          f.push({ bool: { must_not: [{ terms: { product_id: Array.from(ownedProductIds) } }] } });
        }
        return f;
      };

      const scoreHits = (hits: any[]): CompleteLookSuggestion[] => {
        const maxRawScore = Math.max(1, ...hits.map((h: any) => (Number.isFinite(h._score) ? h._score : 0)));
        const scored: CompleteLookSuggestion[] = [];

        for (const hit of hits) {
          const source = hit._source || {};
          if (!audienceGenderMatches(inferredAudienceGender, source)) continue;
          const productId = parseInt(source.product_id, 10);
          if (!productId || ownedProductIds.has(String(productId))) continue;

          const embeddingNorm = Number.isFinite(hit._score) ? Math.min(1, hit._score / maxRawScore) : 0.35;
          const categoryCompat = computeCategoryCompatibility(
            category,
            currentCategoryList.length > 0 ? currentCategoryList : ["other"]
          );
          const candidateColor = normalizeColorName(source.color_primary_canonical || source.attr_color);
          const colorHarmony = computeColorHarmonyWithWardrobe(wardrobeColorFamilies, candidateColor);
          const styleAlignment = computeStyleAlignment(source, preferredStyleTerms);
          const patternAlignment = computeTokenAffinity(source.attr_pattern, preferredPatterns);
          const materialAlignment = computeTokenAffinity(source.attr_material, preferredMaterials);
          const formalityAlignment = computeFormalityAlignment(source, preferredFormality);
          const finalScore =
            embeddingNorm * 0.38 +
            categoryCompat * 0.19 +
            colorHarmony * 0.13 +
            styleAlignment * 0.11 +
            patternAlignment * 0.06 +
            materialAlignment * 0.05 +
            formalityAlignment * 0.08;

          const reasons: string[] = [];
          if (embeddingNorm >= 0.75) reasons.push("strong style similarity");
          if (categoryCompat >= 0.8) reasons.push("high category compatibility");
          if (colorHarmony >= 0.75) reasons.push("good color harmony");
          if (styleAlignment >= 0.75) reasons.push("style-aware match");
          if (formalityAlignment >= 0.8) reasons.push("occasion/formality aligned");
          if (reasons.length === 0) reasons.push("balances the current outfit");

          scored.push({
            product_id: productId,
            title: source.title,
            brand: source.brand,
            category: source.category,
            price_cents:
              source.price_usd != null && Number.isFinite(Number(source.price_usd))
                ? Math.round(Number(source.price_usd) * 100)
                : undefined,
            image_url: source.image_cdn,
            image_cdn: source.image_cdn,
            score: Math.round(finalScore * 1000) / 1000,
            reason: `Add ${category} to complete the look (${reasons.join(", ")})`,
            reason_type: "compatible",
            fitBreakdown: {
              embeddingNorm: Math.round(embeddingNorm * 1000) / 1000,
              categoryCompat: Math.round(categoryCompat * 1000) / 1000,
              colorHarmony: Math.round(colorHarmony * 1000) / 1000,
              styleAlignment: Math.round(styleAlignment * 1000) / 1000,
              patternAlignment: Math.round(patternAlignment * 1000) / 1000,
              materialAlignment: Math.round(materialAlignment * 1000) / 1000,
              formalityAlignment: Math.round(formalityAlignment * 1000) / 1000,
            },
          });
        }

        return scored;
      };

      const runSearch = async (filters: any[], useVector: boolean) => {
        const styleHint = preferredStyleTerms.slice(0, 4).join(" ").trim();
        const lexicalHint = `${canonical} ${styleHint}`.trim();
        const queryBody: any = centroid && useVector
          ? {
              size: perCategoryPool,
              query: {
                bool: {
                  must: {
                    knn: {
                      embedding: {
                        vector: centroid,
                        k: perCategoryPool * 2,
                      },
                    },
                  },
                  filter: filters,
                },
              },
              _source: sourceFields,
            }
          : {
              size: perCategoryPool,
              query: {
                bool: {
                  filter: filters,
                  should: [
                    {
                      multi_match: {
                        query: lexicalHint,
                        fields: ["title^3", "category^2", "brand", "attr_style", "attr_pattern", "attr_material"],
                      },
                    },
                  ],
                  minimum_should_match: 0,
                },
              },
              sort: [{ _score: { order: "desc" } }, { last_seen_at: { order: "desc", missing: "_last" } }],
              _source: sourceFields,
            };

        const response = await osClient.search({
          index: config.opensearch.index,
          body: queryBody,
        });
        return response.body.hits.hits || [];
      };

      let hits = await runSearch(buildFilters(true), true);
      let scored = scoreHits(hits);
      if (scored.length < minPerCategory) {
        const lexicalHits = await runSearch(buildFilters(true), false);
        scored = dedupeCompleteLookSuggestions(scored.concat(scoreHits(lexicalHits)).sort((a, b) => b.score - a.score));
      }
      if (scored.length === 0 && userPriceTier) {
        hits = await runSearch(buildFilters(false), true);
        scored = scoreHits(hits);
        if (scored.length < minPerCategory) {
          const relaxedLexicalHits = await runSearch(buildFilters(false), false);
          scored = dedupeCompleteLookSuggestions(scored.concat(scoreHits(relaxedLexicalHits)).sort((a, b) => b.score - a.score));
        }
      }

      scored.sort((a, b) => b.score - a.score);
      suggestionsByCategory.set(category, scored.slice(0, Math.max(minPerCategory, 6)));
    } catch (err) {
      console.error(`Error fetching ${category} suggestions:`, err);
      suggestionsByCategory.set(category, []);
    }
  }

  let mergedSuggestions = dedupeCompleteLookSuggestions(
    Array.from(suggestionsByCategory.values())
      .flat()
      .sort((a, b) => b.score - a.score)
  );

  if (mergedSuggestions.length < limit) {
    const topUp = await fetchCategoryTopUpSuggestions({
      missingCategories,
      ownedProductIds,
      existingProductIds: new Set(mergedSuggestions.map((s) => String(s.product_id))),
      preferredStyleTerms,
      preferredPatterns,
      preferredMaterials,
      preferredFormality,
      inferredAudienceGender,
      wardrobeColorFamilies,
      currentCategoryList,
      needed: limit - mergedSuggestions.length,
    }).catch(() => []);
    if (topUp.length > 0) {
      mergedSuggestions = dedupeCompleteLookSuggestions(
        mergedSuggestions.concat(topUp).sort((a, b) => b.score - a.score)
      );
    }
  }

  mergedSuggestions = mergedSuggestions.slice(0, limit);

  const outfitSets = buildOutfitSets(suggestionsByCategory, missingCategories);

  return {
    suggestions: mergedSuggestions,
    outfitSets,
    missingCategories,
  };
}

/**
 * Complete look from existing wardrobe item IDs.
 */
export async function completeLookSuggestions(
  userId: number,
  currentItemIds: number[],
  limit: number = 10
): Promise<CompleteLookSuggestionsResult> {
  const currentItemsResult = await pg.query(
    `SELECT wi.id, wi.product_id, wi.embedding, wi.dominant_colors, wi.name, wi.image_url, wi.image_cdn,
            p.title,
            p.gender,
            c.name as category_name
     FROM wardrobe_items wi
     LEFT JOIN products p ON p.id = wi.product_id
     LEFT JOIN categories c ON wi.category_id = c.id
     WHERE wi.id = ANY($1) AND wi.user_id = $2`,
    [currentItemIds, userId]
  );

  return runCompleteLookCore(userId, currentItemsResult.rows as CompleteLookAnchorRow[], limit);
}

/**
 * Complete look from catalog product IDs (used when user has no wardrobe item IDs yet).
 */
export async function completeLookSuggestionsForCatalogProducts(
  userId: number,
  productIds: number[],
  limit: number = 10
): Promise<CompleteLookSuggestionsResult> {
  if (!Array.isArray(productIds) || productIds.length === 0) {
    return {
      suggestions: [],
      outfitSets: [],
      missingCategories: ["tops", "bottoms", "shoes"],
    };
  }

  const productResult = await pg.query(
    `SELECT p.id as product_id,
            p.embedding,
            p.title as name,
            p.title,
            p.gender,
            p.image as image_url,
            p.image_cdn,
            p.category as category_name
     FROM products p
     WHERE p.id = ANY($1)`,
    [productIds]
  );

  return runCompleteLookCore(userId, productResult.rows as CompleteLookAnchorRow[], limit);
}

function topHistogramKeys(histogram?: Record<string, number> | null, limit: number = 3): string[] {
  if (!histogram) return [];
  return Object.entries(histogram)
    .filter(([key, value]) => typeof key === "string" && key.trim().length > 0 && Number.isFinite(Number(value)) && Number(value) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, Math.max(1, limit))
    .map(([key]) => key.toLowerCase().trim());
}

function normalizeAudienceGenderValue(raw: unknown): AudienceGender | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).toLowerCase().trim();
  if (!s) return null;
  const normalized = normalizeQueryGender(s);
  if (normalized === "men" || normalized === "women" || normalized === "unisex") return normalized;
  if (["male", "man", "mens", "men's", "gents", "gentlemen"].includes(s)) return "men";
  if (["female", "woman", "womens", "women's", "ladies", "lady"].includes(s)) return "women";
  return null;
}

function inferGenderFromText(text: string): AudienceGender | null {
  const s = text.toLowerCase();
  const menHits =
    (s.match(/\bmen\b|\bmens\b|\bmen's\b|\bmale\b|\bman\b|\bgents?\b/g) || []).length;
  const womenHits =
    (s.match(/\bwomen\b|\bwomens\b|\bwomen's\b|\bfemale\b|\bwoman\b|\bladies\b|\blady\b/g) || []).length;
  if (menHits > womenHits) return "men";
  if (womenHits > menHits) return "women";
  return null;
}

async function inferPreferredAudienceGender(
  userId: number,
  currentItems: CompleteLookAnchorRow[]
): Promise<AudienceGender | null> {
  const counts: Record<AudienceGender, number> = { men: 0, women: 0, unisex: 0 };

  for (const item of currentItems) {
    const explicit = normalizeAudienceGenderValue(item.gender);
    if (explicit) {
      counts[explicit] += explicit === "unisex" ? 0.5 : 2;
    }

    const textSignal = inferGenderFromText(
      `${String(item.name || "")} ${String(item.title || "")} ${String(item.category_name || "")}`
    );
    if (textSignal) counts[textSignal] += 1;
  }

  if (counts.men === 0 && counts.women === 0) {
    const userGender = await pg
      .query(`SELECT gender FROM users WHERE id = $1`, [userId])
      .then((r) => normalizeAudienceGenderValue(r.rows?.[0]?.gender))
      .catch(() => null);
    if (userGender && userGender !== "unisex") counts[userGender] += 1;
  }

  if (counts.men === 0 && counts.women === 0 && counts.unisex === 0) return null;
  if (counts.men >= counts.women && counts.men > 0) return "men";
  if (counts.women > counts.men && counts.women > 0) return "women";
  return counts.unisex > 0 ? "unisex" : null;
}

function buildAudienceGenderFilter(gender: "men" | "women"): any {
  const allowTerms = [gender, "unisex"];
  const oppositeTitleTerms =
    gender === "men"
      ? ["women", "womens", "female", "ladies", "woman", "girls", "girl"]
      : ["men", "mens", "male", "man", "gents", "boys", "boy"];

  return {
    bool: {
      should: [
        { terms: { attr_gender: allowTerms } },
        { terms: { audience_gender: allowTerms } },
        ...allowTerms.map((kw) => ({ match: { title: kw } })),
      ],
      minimum_should_match: 1,
      must_not: [
        {
          bool: {
            should: oppositeTitleTerms.map((kw) => ({ match: { title: kw } })),
            minimum_should_match: 1,
          },
        },
      ],
    },
  };
}

function audienceGenderMatches(inferred: AudienceGender | null, source: any): boolean {
  if (!inferred || inferred === "unisex") return true;
  const doc = normalizeAudienceGenderValue(source?.audience_gender ?? source?.attr_gender);
  if (doc) {
    return doc === inferred || doc === "unisex";
  }
  const fromText = inferGenderFromText(String(source?.title || ""));
  return !fromText || fromText === inferred;
}

function inferWarmWeatherLook(items: CompleteLookAnchorRow[]): boolean {
  const blob = items
    .map((i) => `${String(i.name || "")} ${String(i.title || "")} ${String(i.category_name || "")}`)
    .join(" ")
    .toLowerCase();

  const warmHits = (blob.match(/\bt-?shirt\b|\btee\b|\bshorts?\b|\bsandal\b|\bslipper\b/g) || []).length;
  const coldHits = (blob.match(/\bjacket\b|\bcoat\b|\bhoodie\b|\bsweater\b|\bcardigan\b|\bblazer\b/g) || []).length;
  return warmHits > 0 && coldHits === 0;
}

function inferStyleTermsFromCurrentItems(
  items: Array<{ name?: string | null; category_name?: string | null }>,
  occasionCoverage: string[]
): string[] {
  const terms = new Set<string>();
  const styleLexicon = [
    "casual",
    "formal",
    "minimalist",
    "streetwear",
    "classic",
    "vintage",
    "sporty",
    "athleisure",
    "boho",
    "elegant",
    "chic",
    "edgy",
    "business",
    "romantic",
  ];

  for (const item of items) {
    const blob = `${String(item.name || "")} ${String(item.category_name || "")}`.toLowerCase();
    for (const token of styleLexicon) {
      if (blob.includes(token)) terms.add(token);
    }
  }

  for (const occ of occasionCoverage) {
    const normalized = String(occ || "").toLowerCase().trim();
    if (!normalized) continue;
    if (normalized.includes("work")) terms.add("business");
    else terms.add(normalized);
  }

  return Array.from(terms);
}

function computeStyleAlignment(source: any, preferredStyleTerms: string[]): number {
  if (preferredStyleTerms.length === 0) return 0.62;
  const blob = `${String(source?.attr_style || "")} ${String(source?.title || "")}`.toLowerCase();
  if (!blob.trim()) return 0.58;

  let best = 0.45;
  for (const token of preferredStyleTerms) {
    if (!token) continue;
    if (blob === token) best = Math.max(best, 0.92);
    else if (blob.includes(token)) best = Math.max(best, 0.82);
  }
  return best;
}

function computeTokenAffinity(candidateRaw: unknown, preferredTokens: string[]): number {
  if (preferredTokens.length === 0) return 0.62;
  const candidate = String(candidateRaw || "").toLowerCase().trim();
  if (!candidate) return 0.55;
  for (const token of preferredTokens) {
    if (candidate === token) return 0.9;
    if (candidate.includes(token) || token.includes(candidate)) return 0.78;
  }
  return 0.42;
}

function inferPreferredFormality(occasionCoverage: string[]): "casual" | "business" | "formal" | "mixed" {
  const set = new Set(occasionCoverage.map((o) => String(o || "").toLowerCase().trim()).filter(Boolean));
  if (set.size === 0) return "mixed";
  if (set.has("formal") && !set.has("casual") && !set.has("work")) return "formal";
  if (set.has("work") && !set.has("casual") && !set.has("formal")) return "business";
  if (set.has("casual") && !set.has("formal") && !set.has("work")) return "casual";
  return "mixed";
}

function inferCandidateFormality(source: any): "casual" | "business" | "formal" | "mixed" {
  const blob = `${String(source?.attr_style || "")} ${String(source?.title || "")}`.toLowerCase();
  if (/formal|evening|cocktail|gown|wedding|tux|tailored/.test(blob)) return "formal";
  if (/business|office|blazer|suit|work/.test(blob)) return "business";
  if (/casual|street|sport|athleisure|denim|daily/.test(blob)) return "casual";
  return "mixed";
}

function computeFormalityAlignment(
  source: any,
  preferred: "casual" | "business" | "formal" | "mixed"
): number {
  const candidate = inferCandidateFormality(source);
  if (preferred === "mixed" || candidate === "mixed") return 0.68;
  if (preferred === candidate) return 0.9;
  const adjacent =
    (preferred === "business" && candidate === "formal") ||
    (preferred === "formal" && candidate === "business") ||
    (preferred === "business" && candidate === "casual") ||
    (preferred === "casual" && candidate === "business");
  if (adjacent) return 0.72;
  return 0.42;
}

async function fetchCategoryTopUpSuggestions(params: {
  missingCategories: string[];
  ownedProductIds: Set<string>;
  existingProductIds: Set<string>;
  preferredStyleTerms: string[];
  preferredPatterns: string[];
  preferredMaterials: string[];
  preferredFormality: "casual" | "business" | "formal" | "mixed";
  inferredAudienceGender: AudienceGender | null;
  wardrobeColorFamilies: Set<string>;
  currentCategoryList: string[];
  needed: number;
}): Promise<CompleteLookSuggestion[]> {
  if (params.needed <= 0 || params.missingCategories.length === 0) return [];
  const canonicalCategories = Array.from(
    new Set(params.missingCategories.map((c) => wardrobeSlotToCategoryCanonical(c)))
  );

  const filter: any[] = [
    { term: { availability: "in_stock" } },
    { terms: { category_canonical: canonicalCategories } },
  ];
  if (params.inferredAudienceGender && params.inferredAudienceGender !== "unisex") {
    filter.push(buildAudienceGenderFilter(params.inferredAudienceGender));
  }

  const blockedProductIds = Array.from(new Set([...params.ownedProductIds, ...params.existingProductIds]));
  if (blockedProductIds.length > 0) {
    filter.push({ bool: { must_not: [{ terms: { product_id: blockedProductIds } }] } });
  }

  const hint = [
    ...params.preferredStyleTerms.slice(0, 3),
    ...params.preferredPatterns.slice(0, 2),
    ...params.preferredMaterials.slice(0, 2),
  ]
    .join(" ")
    .trim();

  const response = await osClient.search({
    index: config.opensearch.index,
    body: {
      size: Math.max(12, params.needed * 6),
      query: {
        bool: {
          filter,
          should: [
            {
              multi_match: {
                query: hint || canonicalCategories.join(" "),
                fields: ["title^3", "category^2", "brand", "attr_style", "attr_pattern", "attr_material"],
              },
            },
          ],
          minimum_should_match: 0,
        },
      },
      _source: [
        "product_id",
        "title",
        "brand",
        "category",
        "category_canonical",
        "price_usd",
        "image_cdn",
        "color_primary_canonical",
        "attr_color",
        "attr_style",
        "attr_pattern",
        "attr_material",
        "attr_gender",
        "audience_gender",
      ],
      sort: [{ _score: { order: "desc" } }, { last_seen_at: { order: "desc", missing: "_last" } }],
    },
  });

  const hits = response.body?.hits?.hits || [];
  const maxRawScore = Math.max(1, ...hits.map((h: any) => (Number.isFinite(h?._score) ? h._score : 0)));
  const out: CompleteLookSuggestion[] = [];

  for (const hit of hits) {
    const source = hit?._source || {};
    if (!audienceGenderMatches(params.inferredAudienceGender, source)) continue;
    const productId = parseInt(source.product_id, 10);
    if (!productId) continue;
    const productKey = String(productId);
    if (params.ownedProductIds.has(productKey) || params.existingProductIds.has(productKey)) continue;

    const guessedSlot = normalizeWardrobeCategory(source.category_canonical || source.category) || "accessories";
    const embeddingNorm = Number.isFinite(hit._score) ? Math.min(1, hit._score / maxRawScore) : 0.52;
    const categoryCompat = computeCategoryCompatibility(
      guessedSlot,
      params.currentCategoryList.length > 0 ? params.currentCategoryList : ["other"]
    );
    const colorHarmony = computeColorHarmonyWithWardrobe(
      params.wardrobeColorFamilies,
      normalizeColorName(source.color_primary_canonical || source.attr_color)
    );
    const styleAlignment = computeStyleAlignment(source, params.preferredStyleTerms);
    const patternAlignment = computeTokenAffinity(source.attr_pattern, params.preferredPatterns);
    const materialAlignment = computeTokenAffinity(source.attr_material, params.preferredMaterials);
    const formalityAlignment = computeFormalityAlignment(source, params.preferredFormality);

    const score =
      embeddingNorm * 0.36 +
      categoryCompat * 0.2 +
      colorHarmony * 0.14 +
      styleAlignment * 0.12 +
      patternAlignment * 0.07 +
      materialAlignment * 0.05 +
      formalityAlignment * 0.06;

    out.push({
      product_id: productId,
      title: source.title,
      brand: source.brand,
      category: source.category,
      price_cents:
        source.price_usd != null && Number.isFinite(Number(source.price_usd))
          ? Math.round(Number(source.price_usd) * 100)
          : undefined,
      image_url: source.image_cdn,
      image_cdn: source.image_cdn,
      score: Math.round(score * 1000) / 1000,
      reason: `Add ${guessedSlot} to complete the look (fashion-aware top-up match)`,
      reason_type: "compatible",
      fitBreakdown: {
        embeddingNorm: Math.round(embeddingNorm * 1000) / 1000,
        categoryCompat: Math.round(categoryCompat * 1000) / 1000,
        colorHarmony: Math.round(colorHarmony * 1000) / 1000,
        styleAlignment: Math.round(styleAlignment * 1000) / 1000,
        patternAlignment: Math.round(patternAlignment * 1000) / 1000,
        materialAlignment: Math.round(materialAlignment * 1000) / 1000,
        formalityAlignment: Math.round(formalityAlignment * 1000) / 1000,
      },
    });
  }

  return dedupeCompleteLookSuggestions(out.sort((a, b) => b.score - a.score)).slice(0, params.needed);
}

const COLOR_FAMILIES_BY_NAME: Record<string, string> = {
  black: "neutral",
  white: "neutral",
  gray: "neutral",
  grey: "neutral",
  beige: "neutral",
  navy: "neutral",
  brown: "earth",
  tan: "earth",
  camel: "earth",
  blue: "blue",
  teal: "blue",
  cyan: "blue",
  aqua: "blue",
  red: "red",
  maroon: "red",
  burgundy: "red",
  pink: "pink",
  fuchsia: "pink",
  magenta: "pink",
  green: "green",
  olive: "green",
  emerald: "green",
  yellow: "earth",
  orange: "earth",
  gold: "earth",
  purple: "pink",
  violet: "pink",
  lavender: "pink",
};

const GOOD_PAIRINGS: Record<string, string[]> = {
  tops: ["bottoms", "skirts", "outerwear", "accessories"],
  bottoms: ["tops", "outerwear", "shoes", "accessories"],
  dresses: ["outerwear", "shoes", "bags", "accessories"],
  outerwear: ["tops", "bottoms", "dresses", "shoes"],
  shoes: ["bottoms", "dresses", "outerwear"],
  bags: ["dresses", "tops", "outerwear"],
  accessories: ["tops", "bottoms", "dresses", "outerwear"],
};

/** Wardrobe "missing slot" labels → OpenSearch `category_canonical` (see searchDocument + categoryFilter). */
function wardrobeSlotToCategoryCanonical(slot: string): string {
  const map: Record<string, string> = {
    shoes: "footwear",
    bags: "accessories",
    tops: "tops",
    bottoms: "bottoms",
    outerwear: "outerwear",
    dresses: "dresses",
    accessories: "accessories",
  };
  return map[slot] ?? slot;
}

function parseVector(value: unknown): number[] | null {
  if (Array.isArray(value) && value.every((n) => typeof n === "number")) return value as number[];
  if (typeof value === "string" && value.startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed) && parsed.every((n) => typeof n === "number")) return parsed;
    } catch {
      return null;
    }
  }
  return null;
}

function meanEmbedding(vectors: number[][]): number[] | null {
  if (vectors.length === 0) return null;
  const dim = vectors[0].length;
  if (dim === 0) return null;
  const out = new Array(dim).fill(0);
  for (const vec of vectors) {
    if (vec.length !== dim) continue;
    for (let i = 0; i < dim; i++) out[i] += vec[i];
  }
  for (let i = 0; i < dim; i++) out[i] /= vectors.length;
  const norm = Math.sqrt(out.reduce((sum, v) => sum + v * v, 0));
  if (norm > 0) {
    for (let i = 0; i < dim; i++) out[i] /= norm;
  }
  return out;
}

function normalizeColorName(value?: string): string | null {
  if (!value) return null;
  const token = value.toLowerCase().replace(/[_-]/g, " ").trim();
  if (!token) return null;
  const parts = token.split(/\s+/);
  for (const part of parts) {
    if (COLOR_FAMILIES_BY_NAME[part]) return part;
  }
  return parts[0] || null;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const cleaned = hex.replace("#", "").trim();
  if (cleaned.length !== 6) return null;
  const n = Number.parseInt(cleaned, 16);
  if (!Number.isFinite(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToFamily(r: number, g: number, b: number): string {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  if (chroma < 20) return "neutral";
  if (max === r && g > b) return "earth";
  if (max === r) return "red";
  if (max === g) return "green";
  return "blue";
}

function extractWardrobeColorFamilies(items: Array<{ dominant_colors?: Array<{ hex?: string }> }>): Set<string> {
  const families = new Set<string>();
  for (const item of items) {
    if (!item.dominant_colors || !Array.isArray(item.dominant_colors)) continue;
    for (const c of item.dominant_colors) {
      if (!c?.hex) continue;
      const rgb = hexToRgb(c.hex);
      if (!rgb) continue;
      families.add(rgbToFamily(rgb.r, rgb.g, rgb.b));
    }
  }
  return families;
}

function computeCategoryCompatibility(targetCategory: string, currentCategories: string[]): number {
  if (currentCategories.length === 0) return 0.6;
  const target = normalizeWardrobeCategory(targetCategory) || targetCategory;
  let best = 0.45;
  for (const raw of currentCategories) {
    const current = normalizeWardrobeCategory(raw) || raw;
    if (target === current) {
      best = Math.max(best, target === "accessories" ? 0.75 : 0.3);
      continue;
    }
    const pairs = GOOD_PAIRINGS[current] || [];
    if (pairs.includes(target)) {
      best = Math.max(best, 0.9);
      continue;
    }
    if ((GOOD_PAIRINGS[target] || []).includes(current)) {
      best = Math.max(best, 0.85);
    }
  }
  return best;
}

function computeColorHarmonyWithWardrobe(wardrobeFamilies: Set<string>, candidateColor: string | null): number {
  if (!candidateColor || wardrobeFamilies.size === 0) return 0.6;
  const candidateFamily = COLOR_FAMILIES_BY_NAME[candidateColor] || "other";
  if (candidateFamily === "neutral" || wardrobeFamilies.has("neutral")) return 0.9;
  if (wardrobeFamilies.has(candidateFamily)) return 0.82;
  const complementary: Record<string, string[]> = {
    blue: ["earth", "red"],
    green: ["pink", "red"],
    red: ["blue", "green"],
    earth: ["blue"],
    pink: ["green"],
  };
  const comp = complementary[candidateFamily] || [];
  for (const fam of wardrobeFamilies) {
    if (comp.includes(fam)) return 0.75;
  }
  return 0.5;
}

function buildOutfitSets(
  suggestionsByCategory: Map<string, CompleteLookSuggestion[]>,
  missingCategories: string[]
): OutfitSetSuggestion[] {
  if (missingCategories.length < 2 || missingCategories.length > 3) return [];

  const pools = missingCategories.map((cat) => ({
    category: cat,
    items: (suggestionsByCategory.get(cat) || []).slice(0, 3),
  }));

  if (pools.some((p) => p.items.length === 0)) return [];

  const results: OutfitSetSuggestion[] = [];
  const current: CompleteLookSuggestion[] = [];

  const walk = (idx: number) => {
    if (idx >= pools.length) {
      const scored = scoreOutfitSet(current, pools.map((p) => p.category));
      results.push(scored);
      return;
    }
    for (const item of pools[idx].items) {
      current.push(item);
      walk(idx + 1);
      current.pop();
    }
  };

  walk(0);
  return results.sort((a, b) => b.totalScore - a.totalScore).slice(0, 5);
}

function scoreOutfitSet(items: CompleteLookSuggestion[], categories: string[]): OutfitSetSuggestion {
  const avgItemScore = items.reduce((sum, item) => sum + item.score, 0) / Math.max(items.length, 1);
  const avgColorHarmony =
    items.reduce((sum, i) => sum + (i.fitBreakdown?.colorHarmony ?? 0.6), 0) /
    Math.max(items.length, 1);

  const coherenceScore = Math.round((avgItemScore * 0.75 + avgColorHarmony * 0.25) * 1000) / 1000;
  const reasons = [`balanced across ${categories.join(", ")}`, "ranked by style+compatibility+color"];

  return {
    productIds: items.map((i) => i.product_id),
    categories,
    coherenceScore,
    totalScore: coherenceScore,
    reasons,
  };
}

// ============================================================================
// Cold Start / Onboarding Recommendations
// ============================================================================

/**
 * Get onboarding recommendations for new users with empty/small wardrobes
 */
export async function getOnboardingRecommendationsForUser(
  userId: number,
  limit: number = 20
): Promise<ProductRecommendation[]> {
  const isColdStart = await isUserColdStart(userId);
  
  if (!isColdStart) {
    // User has enough wardrobe items, use regular recommendations
    return getRecommendations(userId, { limit });
  }
  
  // Use cold start onboarding logic
  const onboardingRecs = await getColdStartOnboarding(userId, limit);
  
  return onboardingRecs.map(rec => ({
    product_id: rec.productId,
    title: rec.title,
    brand: rec.brand,
    category: rec.category,
    price_cents: rec.priceCents,
    image_url: rec.imageUrl,
    score: rec.score,
    reason: rec.reason,
    reason_type: rec.reasonType as "gap" | "style_match" | "compatible" | "trending",
  }));
}

/**
 * Get user's adapted essential categories based on their lifestyle
 */
export async function getAdaptedEssentialsForUser(userId: number) {
  return getAdaptedEssentials(userId);
}

/**
 * Get user's inferred price tier
 */
export async function getUserPriceTier(userId: number) {
  return inferPriceTier(userId);
}






