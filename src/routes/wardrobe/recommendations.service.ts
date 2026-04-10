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
import { attrGenderFilterClause } from "../products/opensearchFilters";
import { buildStyleProfile, type Product as OutfitProduct } from "../../lib/outfit/index";

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
  completionMode: "wardrobe" | "catalog-product";
  suggestions: CompleteLookSuggestion[];
  outfitSets: OutfitSetSuggestion[];
  missingCategories: string[];
}

/** Slots used for gap detection (DB name, vision, and OpenSearch slot labels). */
export const TRACKED_OUTFIT_SLOTS = new Set([
  "tops",
  "bottoms",
  "shoes",
  "dresses",
  "outerwear",
  "bags",
  "accessories",
]);

const STYLE_TERMS_LEXICON = [
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
] as const;

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

function inferSlotsFromFreeText(value?: string | null): Set<string> {
  const out = new Set<string>();
  const raw = String(value || "").toLowerCase().trim();
  if (!raw) return out;

  if (/\b(dress|dresses|gown|frock|maxi|midi|mini|sundress|jumpsuit|romper|abaya|kaftan)\b/.test(raw)) out.add("dresses");
  if (/\b(top|tops|shirt|shirts|blouse|blouses|t-?shirt|tee|polo|hoodie|sweater|sweatshirt|cardigan|tank|crop top|camisole)\b/.test(raw)) out.add("tops");
  if (/\b(bottom|bottoms|pant|pants|trouser|trousers|jeans|joggers|leggings|skirt|skirts|shorts?)\b/.test(raw)) out.add("bottoms");
  if (/\b(shoe|shoes|sneaker|sneakers|boot|boots|heel|heels|loafer|loafers|sandal|sandals|flats?|pumps?|mules?|trainers?)\b/.test(raw)) out.add("shoes");
  if (/\b(outerwear|jacket|jackets|coat|coats|blazer|blazers|parka|windbreaker|trench|bomber)\b/.test(raw)) out.add("outerwear");
  if (/\b(bag|bags|handbag|handbags|tote|totes|clutch|clutches|purse|wallet|backpack|crossbody|satchel|messenger)\b/.test(raw)) out.add("bags");
  if (/\b(accessor|watch|scarf|hat|sunglass|jewel|necklace|earring|bracelet|ring|belt)\b/.test(raw)) out.add("accessories");

  return out;
}

function shouldSuggestOuterwear(
  warmWeatherLikely: boolean,
  currentItems: CompleteLookAnchorRow[],
  seasonCoverage: string[]
): boolean {
  if (warmWeatherLikely) return false;
  const seasons = new Set((seasonCoverage || []).map((s) => String(s || "").toLowerCase().trim()));
  if (seasons.has("winter") || seasons.has("fall")) return true;

  const blob = currentItems
    .map((i) => `${String(i.name || "")} ${String(i.title || "")} ${String(i.category_name || "")}`)
    .join(" ")
    .toLowerCase();
  const coldHits = (blob.match(/\bjacket\b|\bcoat\b|\bhoodie\b|\bsweater\b|\bcardigan\b|\bblazer\b|\bwinter\b|\bcold\b/g) || []).length;
  return coldHits > 0;
}

export function inferMissingCategoriesForOutfit(params: {
  currentCategories: Set<string>;
  warmWeatherLikely: boolean;
  shouldOfferOuterwear: boolean;
}): string[] {
  const { currentCategories, warmWeatherLikely, shouldOfferOuterwear } = params;
  const hasDress = currentCategories.has("dresses");
  const missing: string[] = [];

  if (hasDress) {
    if (!currentCategories.has("shoes")) missing.push("shoes");
  } else {
    if (!currentCategories.has("tops")) missing.push("tops");
    if (!currentCategories.has("bottoms")) missing.push("bottoms");
    if (!currentCategories.has("shoes")) missing.push("shoes");
  }

  const complements: string[] = ["bags", "accessories"];
  if (shouldOfferOuterwear && !warmWeatherLikely) complements.push("outerwear");
  for (const extra of complements) {
    if (missing.length >= 2) break;
    if (!currentCategories.has(extra) && !missing.includes(extra)) missing.push(extra);
  }

  if (missing.length === 0) {
    if (!currentCategories.has("bags")) missing.push("bags");
    else if (!currentCategories.has("accessories")) missing.push("accessories");
    else if (shouldOfferOuterwear && !warmWeatherLikely && !currentCategories.has("outerwear")) missing.push("outerwear");
    else missing.push("accessories");
  }

  return missing.slice(0, 3);
}

function slotKeywordRegex(slot: string): RegExp | null {
  const map: Record<string, RegExp> = {
    tops: /\b(top|tops|shirt|shirts|blouse|blouses|t-?shirt|tee|hoodie|sweater|sweatshirt|cardigan|tank|camisole|polo)\b/,
    bottoms: /\b(bottom|bottoms|pants?|trousers?|jeans?|joggers?|leggings?|skirts?|shorts?)\b/,
    dresses: /\b(dress|dresses|gown|frock|sundress|maxi|midi|mini|jumpsuit|romper|abaya|kaftan)\b/,
    outerwear: /\b(outerwear|jacket|jackets|coat|coats|blazer|blazers|parka|windbreaker|trench|bomber|anorak)\b/,
    shoes: /\b(shoe|shoes|sneaker|sneakers|boot|boots|heel|heels|loafer|loafers|sandal|sandals|flat|flats|pump|pumps|mule|mules|trainer|trainers|footwear)\b/,
    bags: /\b(bag|bags|handbag|handbags|tote|totes|clutch|clutches|purse|purses|crossbody|satchel|messenger|shoulder bag|bucket bag|hobo bag)\b/,
    accessories: /\b(accessor|watch|watches|scarf|scarves|hat|hats|cap|caps|sunglass|sunglasses|jewel|jewelry|jewellery|necklace|earring|bracelet|ring|belt)\b/,
  };
  return map[slot] || null;
}

function slotMismatchRegex(slot: string): RegExp | null {
  const sleepwear = /\b(pyjama|pyjamas|pajama|pajamas|sleepwear|nightwear|loungewear|lingerie)\b/;
  if (slot !== "dresses" && slot !== "outerwear") {
    if (sleepwear.test(slot)) return sleepwear;
  }
  if (slot === "bags") return /\b(headband|hair accessory|hairband|headwear|hat|cap|beanie|wallet|backpack|duffle|luggage|suitcase|travel accessory|key ring|keychain)\b/;
  if (slot === "accessories") {
    return /\b(handbag|bag|tote|clutch|wallet|crossbody|backpack|satchel|messenger)\b/;
  }
  return sleepwear;
}

function sourceMatchesSlot(slot: string, source: any): boolean {
  const canonical = normalizeWardrobeCategory(source?.category_canonical || source?.category);
  const blob = `${String(source?.title || "")} ${String(source?.category || "")} ${String(source?.category_canonical || "")}`.toLowerCase();
  if (/\b(pyjama|pyjamas|pajama|pajamas|sleepwear|nightwear|loungewear|lingerie)\b/.test(blob)) return false;
  const allow = slotKeywordRegex(slot);
  const reject = slotMismatchRegex(slot);
  if (reject && reject.test(blob)) return false;
  if (!allow) return canonical === slot;

  const textMatches = allow.test(blob);
  if (!textMatches) return false;

  // Require the text intent to agree with the canonical slot when the index is noisy.
  // This prevents mislabeled items (e.g. shirts indexed as shoes) from leaking through.
  if (canonical && canonical !== slot) {
    // Special case: hooded/hoodie items can be used as tops even if categorizied as outerwear
    if (slot === "tops" && /\b(hoodie|hooded)\b/.test(blob)) return true;
    
    const canonicalRegex = slotKeywordRegex(canonical);
    if (canonicalRegex && canonicalRegex.test(blob)) return false;
  }

  return true;
}

function buildSlotIntentFilter(slot: string): any | null {
  const bagTerms = ["bag", "handbag", "tote", "clutch", "purse", "crossbody", "satchel", "messenger", "shoulder bag", "bucket bag", "hobo bag"];
  const accessoryTerms = ["accessories", "jewelry", "watch", "scarf", "belt", "sunglasses", "hat", "earrings", "necklace", "bracelet", "ring"];
  const outerwearTerms = ["outerwear", "jacket", "coat", "blazer", "cardigan", "parka", "trench", "bomber"];
  const topTerms = ["top", "tops", "shirt", "shirts", "blouse", "blouses", "t-shirt", "tee", "hoodie", "sweater", "sweatshirt", "cardigan", "tank", "camisole", "polo"];
  const bottomTerms = ["bottom", "bottoms", "pant", "pants", "trouser", "trousers", "jeans", "joggers", "leggings", "skirt", "skirts", "shorts"];
  const shoeTerms = ["shoe", "shoes", "sneaker", "sneakers", "boot", "boots", "heel", "heels", "loafer", "loafers", "sandal", "sandals", "flat", "flats", "pump", "pumps", "mule", "mules", "trainer", "trainers", "footwear"];

  const rejectTerms =
    slot === "shoes"
      ? topTerms.concat(bottomTerms).concat(["bag", "handbag", "backpack", "wallet"])
      : slot === "tops"
        ? bottomTerms.concat(shoeTerms).concat(["bag", "handbag", "backpack", "wallet"])
        : slot === "bottoms"
          ? topTerms.concat(shoeTerms).concat(["bag", "handbag", "backpack", "wallet"])
          : slot === "bags"
            ? ["shirt", "top", "pant", "shoe", "sneaker", "jacket", "wallet", "backpack", "duffle", "luggage", "suitcase", "travel accessory", "key ring", "keychain"]
            : [];

  if (slot === "bags") {
    return {
      bool: {
        should: bagTerms.map((kw) => ({ match_phrase: { title: kw } })),
        minimum_should_match: 1,
        must_not: [
          {
            bool: {
              should: [
                { match_phrase: { title: "hair accessory" } },
                { match_phrase: { title: "headwear" } },
                { match_phrase: { title: "headband" } },
                { match_phrase: { title: "wallet" } },
                { match_phrase: { title: "backpack" } },
                { match_phrase: { title: "duffle" } },
                { match_phrase: { title: "luggage" } },
                { match_phrase: { title: "suitcase" } },
                { match_phrase: { title: "travel accessory" } },
                { match_phrase: { title: "key ring" } },
                { match_phrase: { title: "keychain" } },
              ],
              minimum_should_match: 1,
            },
          },
        ],
      },
    };
  }

  if (slot === "accessories") {
    return {
      bool: {
        should: accessoryTerms.map((kw) => ({ match_phrase: { title: kw } })),
        minimum_should_match: 1,
      },
    };
  }

  if (slot === "outerwear") {
    return {
      bool: {
        should: outerwearTerms.map((kw) => ({ match_phrase: { title: kw } })),
        minimum_should_match: 1,
      },
    };
  }

  if (slot === "tops" || slot === "bottoms" || slot === "shoes" || slot === "dresses") {
    return {
      bool: {
        should:
          slot === "tops"
            ? topTerms.map((kw) => ({ match_phrase: { title: kw } }))
            : slot === "bottoms"
              ? bottomTerms.map((kw) => ({ match_phrase: { title: kw } }))
              : slot === "shoes"
                ? shoeTerms.map((kw) => ({ match_phrase: { title: kw } }))
                : [{ match_phrase: { title: "dress" } }, { match_phrase: { title: "gown" } }],
        minimum_should_match: 1,
        must_not: rejectTerms.length
          ? [
              {
                bool: {
                  should: rejectTerms.map((kw) => ({ match_phrase: { title: kw } })),
                  minimum_should_match: 1,
                },
              },
            ]
          : undefined,
      },
    };
  }

  return null;
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

function minimumSlotScore(slot: string): number {
  const normalized = normalizeWardrobeCategory(slot) || String(slot || "").toLowerCase().trim();
  if (normalized === "bags" || normalized === "accessories") return 0.62;
  if (normalized === "shoes") return 0.58;
  if (normalized === "tops" || normalized === "bottoms" || normalized === "outerwear" || normalized === "dresses") return 0.57;
  return 0.56;
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
  age_group?: string | null;
  style_tags?: string[] | null;
  occasion_tags?: string[] | null;
  season_tags?: string[] | null;
};

type AudienceGender = "men" | "women" | "unisex";
type AudienceAgeGroup = "kids" | "adult";

type CompleteLookAudienceOptions = {
  audienceGenderHint?: string | null;
  ageGroupHint?: string | null;
  allowUserAudienceFallback?: boolean;
  enforceNeutralAudienceWhenUnknown?: boolean;
  useDetectedCategoryForCurrentItems?: boolean;
};

async function runCompleteLookCore(
  userId: number,
  currentItems: CompleteLookAnchorRow[],
  limit: number,
  completionMode: CompleteLookSuggestionsResult["completionMode"],
  audienceOptions: CompleteLookAudienceOptions = {}
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

  // Pass 0: use detected category if provided (e.g., image-detected "hoodie" for a jacket)
  if (audienceOptions.useDetectedCategoryForCurrentItems) {
    for (const row of currentItems as Array<any>) {
      if (row.detected_category) {
        pushCategory(normalizeWardrobeCategory(row.detected_category));
      }
    }
  }

  // Pass 1: trust structured category signal first (unless detected category was used).
  if (!audienceOptions.useDetectedCategoryForCurrentItems) {
    for (const row of currentItems) {
      pushCategory(normalizeWardrobeCategory(row.category_name));
    }
  }

  // Pass 2: only use weak text hints when structured categories are sparse.
  if (currentCategories.size < 2) {
    for (const row of currentItems) {
      pushCategory(normalizeWardrobeCategory(row.name));
      pushCategory(normalizeWardrobeCategory(row.title));

      const freeTextSignals = inferSlotsFromFreeText(
        `${String(row.name || "")} ${String(row.title || "")} ${String(row.category_name || "")}`
      );
      for (const signal of freeTextSignals) pushCategory(signal);
    }
  }

  const styleProfile = await getStyleProfile(userId).catch(() => null);
  // Vision is useful when wardrobe metadata is sparse, but it can overfire on
  // already-labeled outfits (e.g. shirt + pants turning into false shoes/bags).
  // Only use it as a supplement when the structured signals are weak.
  if (currentCategories.size < 2) {
    const visionSlots = await inferWardrobeSlotsFromWardrobeRows(currentItems);
    for (const slot of visionSlots) pushCategory(slot);
  }

  const warmWeatherLikely = inferWarmWeatherLook(currentItems);
  const shouldOfferOuterwear = shouldSuggestOuterwear(
    warmWeatherLikely,
    currentItems,
    styleProfile?.season_coverage || []
  );
  const currentEmbeddings = currentItems
    .map((row) => parseVector(row.embedding))
    .filter((vec): vec is number[] => Array.isArray(vec) && vec.length > 0);

  let centroid = meanEmbedding(currentEmbeddings);
  if (!centroid && styleProfile?.style_centroid && styleProfile.style_centroid.length > 0) {
    centroid = styleProfile.style_centroid;
  }

  const visualContext = centroid
    ? await inferVisualContextFromCentroid(centroid, currentCategoryList).catch(() => ({
        inferredAudienceGender: null as AudienceGender | null,
        inferredAgeGroup: null as AudienceAgeGroup | null,
        styleTerms: [] as string[],
      }))
    : { inferredAudienceGender: null as AudienceGender | null, inferredAgeGroup: null as AudienceAgeGroup | null, styleTerms: [] as string[] };

  const hintedAudienceGender = normalizeAudienceGenderValue(audienceOptions.audienceGenderHint);
  const hintedAgeGroup = normalizeAudienceAgeGroupValue(audienceOptions.ageGroupHint);
  const inferredFromAnchors = await inferPreferredAudienceGender(userId, currentItems, {
    allowWardrobeHistory: false,
    allowUserProfile: false,
  });
  const inferredAgeFromAnchors = inferPreferredAgeGroup(currentItems);
  const inferredAudienceGender =
    hintedAudienceGender ||
    inferredFromAnchors ||
    visualContext.inferredAudienceGender ||
    (await inferPreferredAudienceGender(userId, currentItems, {
      allowWardrobeHistory: audienceOptions.allowUserAudienceFallback !== false,
      allowUserProfile: audienceOptions.allowUserAudienceFallback !== false,
    }));
  const inferredAgeGroup = hintedAgeGroup || inferredAgeFromAnchors || visualContext.inferredAgeGroup;
  const enforceNeutralAudienceWhenUnknown =
    Boolean(audienceOptions.enforceNeutralAudienceWhenUnknown) || !inferredAudienceGender;
  const missingCategories = inferMissingCategoriesForOutfit({
    currentCategories,
    warmWeatherLikely,
    shouldOfferOuterwear,
  });
  const relaxedBagAudienceMode =
    missingCategories.length === 1 && normalizeWardrobeCategory(missingCategories[0]) === "bags";

  const userPriceTier = await inferPriceTier(userId).catch(() => null);
  const ownedProductIds = new Set<string>(
    currentItems
      .map((r) => (r.product_id !== null && r.product_id !== undefined ? String(r.product_id) : ""))
      .filter(Boolean)
  );

  const wardrobeColorFamilies = extractWardrobeColorFamilies(currentItems);
  const preferredPatterns = topHistogramKeys(styleProfile?.pattern_histogram, 3);
  const preferredMaterials = topHistogramKeys(styleProfile?.material_histogram, 3);
  const preferredStyleTerms = Array.from(
    new Set(
      inferStyleTermsFromCurrentItems(currentItems, styleProfile?.occasion_coverage || []).concat(
        visualContext.styleTerms
      )
    )
  ).slice(0, 8);
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
    "product_types",
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
        if (inferredAudienceGender && inferredAudienceGender !== "unisex" && !(relaxedBagAudienceMode && category === "bags")) {
          f.push(buildAudienceGenderFilter(inferredAudienceGender));
        }
        if (inferredAgeGroup && !(relaxedBagAudienceMode && category === "bags")) {
          f.push(buildAgeGroupFilter(inferredAgeGroup));
        }
        const slotIntentFilter = buildSlotIntentFilter(category);
        if (slotIntentFilter) {
          f.push(slotIntentFilter);
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
          if (!sourceMatchesSlot(category, source)) continue;
          if (!audienceGenderMatchesForSlot(inferredAudienceGender, source, category, enforceNeutralAudienceWhenUnknown, {
            allowUnknownForBags: relaxedBagAudienceMode && category === "bags",
          })) continue;
          if (!audienceAgeGroupMatchesWithOptions(inferredAgeGroup, source, {
            allowUnknown: relaxedBagAudienceMode && category === "bags",
          })) continue;
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

          // Enforce style/occasion compatibility when we have a reliable style intent.
          if (preferredStyleTerms.length > 0 && styleAlignment < 0.52 && formalityAlignment < 0.5) {
            continue;
          }

          const finalScore =
            embeddingNorm * 0.32 +
            categoryCompat * 0.18 +
            colorHarmony * 0.12 +
            styleAlignment * 0.18 +
            patternAlignment * 0.08 +
            materialAlignment * 0.05 +
            formalityAlignment * 0.07;

          if (finalScore < minimumSlotScore(category)) {
            continue;
          }

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
      inferredAgeGroup,
      enforceNeutralAudienceWhenUnknown,
      relaxedBagAudienceMode,
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

  mergedSuggestions = await rerankCompleteLookFashionAware({
    suggestions: mergedSuggestions,
    preferredStyleTerms,
    preferredFormality,
    wardrobeColorFamilies,
    currentCategoryList,
    inferredAudienceGender,
    inferredAgeGroup,
    limit,
  }).catch(() => mergedSuggestions);

  mergedSuggestions = mergedSuggestions.slice(0, limit);

  const outfitSets = buildOutfitSets(suggestionsByCategory, missingCategories);

  return {
    completionMode,
    suggestions: mergedSuggestions,
    outfitSets,
    missingCategories,
  };
}

function preferredFormalityToScore(value: "casual" | "business" | "formal" | "mixed"): number {
  if (value === "casual") return 3;
  if (value === "business") return 6;
  if (value === "formal") return 8.5;
  return 5;
}

function scoreFormalityCompatibility(source: number, candidate: number): number {
  const diff = Math.abs(source - candidate);
  if (diff <= 1.2) return 1;
  if (diff <= 2.5) return 0.86;
  if (diff <= 4) return 0.62;
  return 0.34;
}

function inferPreferredAesthetic(preferredStyleTerms: string[]): StyleProfileAesthetic | null {
  const tokenSet = new Set(preferredStyleTerms.map((t) => String(t).toLowerCase().trim()).filter(Boolean));
  if (!tokenSet.size) return null;
  const has = (x: string) => tokenSet.has(x);
  if (has("streetwear") || has("edgy")) return "streetwear";
  if (has("sporty") || has("athleisure")) return "sporty";
  if (has("minimalist") || has("business")) return "minimalist";
  if (has("classic") || has("formal") || has("elegant")) return "classic";
  if (has("boho")) return "bohemian";
  if (has("romantic") || has("chic")) return "romantic";
  if (has("vintage")) return "classic";
  return null;
}

type StyleProfileAesthetic =
  | "classic"
  | "modern"
  | "bohemian"
  | "minimalist"
  | "streetwear"
  | "romantic"
  | "edgy"
  | "sporty";

function aestheticCompatibility(
  preferred: StyleProfileAesthetic | null,
  candidate: StyleProfileAesthetic
): number {
  if (!preferred) return 0.66;
  if (preferred === candidate) return 1;
  const map: Record<StyleProfileAesthetic, StyleProfileAesthetic[]> = {
    classic: ["minimalist", "modern", "romantic"],
    modern: ["minimalist", "classic", "streetwear"],
    bohemian: ["romantic", "classic", "modern"],
    minimalist: ["modern", "classic", "streetwear"],
    streetwear: ["sporty", "modern", "edgy"],
    romantic: ["classic", "bohemian", "minimalist"],
    edgy: ["streetwear", "modern", "sporty"],
    sporty: ["streetwear", "modern", "minimalist"],
  };
  return map[preferred].includes(candidate) ? 0.84 : 0.42;
}

async function rerankCompleteLookFashionAware(params: {
  suggestions: CompleteLookSuggestion[];
  preferredStyleTerms: string[];
  preferredFormality: "casual" | "business" | "formal" | "mixed";
  wardrobeColorFamilies: Set<string>;
  currentCategoryList: string[];
  inferredAudienceGender: AudienceGender | null;
  inferredAgeGroup: AudienceAgeGroup | null;
  limit: number;
}): Promise<CompleteLookSuggestion[]> {
  if (!Array.isArray(params.suggestions) || params.suggestions.length <= 1) {
    return params.suggestions;
  }

  const candidateIds = Array.from(new Set(params.suggestions.map((s) => s.product_id))).slice(0, Math.max(40, params.limit * 4));
  const rows = await pg.query(
    `SELECT id, title, brand, category, color, price_cents, currency, image_url, image_cdn, description, gender
     FROM products
     WHERE id = ANY($1)`,
    [candidateIds]
  );
  const rowById = new Map<number, any>();
  for (const r of rows.rows) {
    const id = Number(r.id);
    if (Number.isFinite(id) && id >= 1) rowById.set(id, r);
  }

  const preferredAesthetic = inferPreferredAesthetic(params.preferredStyleTerms);
  const targetFormalityScore = preferredFormalityToScore(params.preferredFormality);

  const rescored = await Promise.all(params.suggestions.map(async (s) => {
    const row = rowById.get(s.product_id);
    if (!row) return s;

    const docAudience = normalizeAudienceGenderValue(row.gender);
    if (
      params.inferredAudienceGender &&
      params.inferredAudienceGender !== "unisex" &&
      docAudience &&
      docAudience !== "unisex" &&
      docAudience !== params.inferredAudienceGender
    ) {
      return {
        ...s,
        score: Math.max(0, (s.score || 0) * 0.35),
        reason: `Add ${String(s.category || "item")} to complete the look (gender mismatch penalty applied)`,
      };
    }

    const docAge = normalizeAudienceAgeGroupValue(row.age_group);
    const textAge = inferAgeGroupFromText(`${String(row.title || "")} ${String(row.category || "")}`);
    const effectiveDocAge = docAge || textAge;
    if (params.inferredAgeGroup === "kids" && effectiveDocAge === "adult") {
      return {
        ...s,
        score: Math.max(0, (s.score || 0) * 0.25),
        reason: `Add ${String(s.category || "item")} to complete the look (age mismatch penalty applied)`,
      };
    }
    if (params.inferredAgeGroup === "adult" && effectiveDocAge === "kids") {
      return {
        ...s,
        score: Math.max(0, (s.score || 0) * 0.22),
        reason: `Add ${String(s.category || "item")} to complete the look (age mismatch penalty applied)`,
      };
    }

    const product: OutfitProduct = {
      id: Number(row.id),
      title: String(row.title || s.title || ""),
      brand: row.brand != null ? String(row.brand) : undefined,
      category: row.category != null ? String(row.category) : undefined,
      color: row.color != null ? String(row.color) : undefined,
      price_cents:
        Number.isFinite(Number(row.price_cents)) && Number(row.price_cents) > 0
          ? Math.round(Number(row.price_cents))
          : Number.isFinite(Number(s.price_cents))
            ? Math.round(Number(s.price_cents))
            : 0,
      currency: row.currency != null ? String(row.currency) : "USD",
      image_url: row.image_url != null ? String(row.image_url) : s.image_url,
      image_cdn: row.image_cdn != null ? String(row.image_cdn) : s.image_cdn,
      description: row.description != null ? String(row.description) : undefined,
    };

    const style = await buildStyleProfile(product);
    const categoryNorm = normalizeWardrobeCategory(product.category || s.category) || "accessories";
    const categoryCompat = computeCategoryCompatibility(
      categoryNorm,
      params.currentCategoryList.length > 0 ? params.currentCategoryList : ["other"]
    );

    const candidateColor = normalizeColorName(product.color || style.colorProfile.primary);
    const colorHarmony = computeColorHarmonyWithWardrobe(params.wardrobeColorFamilies, candidateColor);

    const styleTokenBlob = `${product.title} ${product.category || ""} ${style.aesthetic} ${style.occasion}`.toLowerCase();
    const styleTokenScore =
      params.preferredStyleTerms.length === 0
        ? 0.62
        : params.preferredStyleTerms.some((t) => t && styleTokenBlob.includes(t))
          ? 0.9
          : 0.46;

    const formalityScore = scoreFormalityCompatibility(targetFormalityScore, style.formality);
    const aestheticScore = aestheticCompatibility(preferredAesthetic, style.aesthetic as StyleProfileAesthetic);
    const baseRetrieval = Math.max(0, Math.min(1, Number(s.score || 0)));

    const fashionScore =
      categoryCompat * 0.22 +
      colorHarmony * 0.16 +
      styleTokenScore * 0.24 +
      formalityScore * 0.2 +
      aestheticScore * 0.18;

    const final = Math.round((fashionScore * 0.72 + baseRetrieval * 0.28) * 1000) / 1000;
    const reasons: string[] = [];
    if (styleTokenScore >= 0.85) reasons.push("style-aligned");
    if (formalityScore >= 0.86) reasons.push("formality-consistent");
    if (aestheticScore >= 0.84) reasons.push("aesthetic-compatible");
    if (colorHarmony >= 0.78) reasons.push("harmonious palette");
    if (reasons.length === 0) reasons.push("fashion-balanced");

    return {
      ...s,
      score: final,
      reason: `Add ${String(s.category || categoryNorm)} to complete the look (${reasons.join(", ")})`,
    };
  }));

  return rescored.sort((a, b) => (b.score || 0) - (a.score || 0));
}

/**
 * Complete look from existing wardrobe item IDs.
 */
export async function completeLookSuggestions(
  userId: number,
  currentItemIds: number[],
  limit: number = 10,
  options: Pick<CompleteLookAudienceOptions, "audienceGenderHint" | "ageGroupHint"> = {}
): Promise<CompleteLookSuggestionsResult> {
  const currentItemsResult = await pg.query(
    `SELECT wi.id, wi.product_id, wi.embedding, wi.dominant_colors, wi.name, wi.image_url, wi.image_cdn,
            p.title,
            COALESCE(wam.audience_gender, p.gender) as gender,
            wam.age_group,
            wam.style_tags,
            wam.occasion_tags,
            wam.season_tags,
            c.name as category_name
     FROM wardrobe_items wi
     LEFT JOIN products p ON p.id = wi.product_id
     LEFT JOIN categories c ON wi.category_id = c.id
     LEFT JOIN wardrobe_item_audience_metadata wam ON wam.wardrobe_item_id = wi.id
     WHERE wi.id = ANY($1) AND wi.user_id = $2`,
    [currentItemIds, userId]
  );

  return await runCompleteLookCore(userId, currentItemsResult.rows as CompleteLookAnchorRow[], limit, "wardrobe", {
    audienceGenderHint: options.audienceGenderHint,
    ageGroupHint: options.ageGroupHint,
  });
}

/**
 * Complete look from catalog product IDs (used when user has no wardrobe item IDs yet).
 */
export async function completeLookSuggestionsForCatalogProducts(
  userId: number,
  productIds: number[],
  limit: number = 10,
  options: Pick<CompleteLookAudienceOptions, "audienceGenderHint" | "ageGroupHint"> & { detectedCategories?: Map<number, string> } = {}
): Promise<CompleteLookSuggestionsResult> {
  if (!Array.isArray(productIds) || productIds.length === 0) {
    return {
      completionMode: "catalog-product",
      suggestions: [],
      outfitSets: [],
      missingCategories: ["tops", "bottoms", "shoes"],
    };
  }

  // Embeddings are now stored in product_images table, not on products.
  // This query fetches catalog products without embedding (embeddings will be
  // loaded from product_images if needed for vector operations).
  const productResult = await pg.query(
    `SELECT p.id as product_id,
            NULL::text as embedding,
            p.title as name,
            p.title,
            p.image_url as image_url,
            p.image_cdn,
            p.gender,
            NULL::text as age_group,
            NULL::text[] as style_tags,
            NULL::text[] as occasion_tags,
            NULL::text[] as season_tags,
            p.category as category_name
     FROM products p
     WHERE p.id = ANY($1)`,
    [productIds]
  );

  // Attach detected categories to rows if provided
  const rows = productResult.rows as Array<CompleteLookAnchorRow & { detected_category?: string }>;
  if (options.detectedCategories) {
    for (const row of rows) {
      const detected = options.detectedCategories.get(Number(row.product_id));
      if (detected) row.detected_category = detected;
    }
  }

  return await runCompleteLookCore(userId, rows, limit, "catalog-product", {
    audienceGenderHint: options.audienceGenderHint,
    ageGroupHint: options.ageGroupHint,
    allowUserAudienceFallback: false,
    enforceNeutralAudienceWhenUnknown: true,
    useDetectedCategoryForCurrentItems: true,
  });
}

function topHistogramKeys(histogram?: Record<string, number> | null, limit: number = 3): string[] {
  if (!histogram) return [];
  return Object.entries(histogram)
    .filter(([key, value]) => typeof key === "string" && key.trim().length > 0 && Number.isFinite(Number(value)) && Number(value) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, Math.max(1, limit))
    .map(([key]) => key.toLowerCase().trim());
}

function extractStyleTokensFromText(text: string): string[] {
  const s = text.toLowerCase();
  const out = new Set<string>();
  for (const token of STYLE_TERMS_LEXICON) {
    if (new RegExp(`\\b${token}\\b`).test(s)) out.add(token);
  }
  return Array.from(out);
}

async function inferVisualContextFromCentroid(
  centroid: number[],
  currentCategoryList: string[]
): Promise<{ inferredAudienceGender: AudienceGender | null; inferredAgeGroup: AudienceAgeGroup | null; styleTerms: string[] }> {
  const filter: any[] = [{ term: { availability: "in_stock" } }];
  const canonicalCandidates = Array.from(
    new Set(currentCategoryList.map((slot) => wardrobeSlotToCategoryCanonical(slot)))
  ).filter(Boolean);
  if (canonicalCandidates.length > 0) {
    filter.push({ terms: { category_canonical: canonicalCandidates } });
  }

  const response = await osClient.search({
    index: config.opensearch.index,
    body: {
      size: 30,
      query: {
        bool: {
          must: {
            knn: {
              embedding: {
                vector: centroid,
                k: 80,
              },
            },
          },
          filter,
        },
      },
      _source: ["title", "attr_style", "audience_gender", "attr_gender", "age_group"],
    },
  });

  const hits = response.body?.hits?.hits || [];
  const styleCounts = new Map<string, number>();
  const genderCounts: Record<AudienceGender, number> = { men: 0, women: 0, unisex: 0 };
  const ageCounts: Record<AudienceAgeGroup, number> = { kids: 0, adult: 0 };

  for (const hit of hits) {
    const source = hit?._source || {};
    const rawScore = Number(hit?._score);
    const weight = Number.isFinite(rawScore) ? Math.max(0.15, Math.min(1.5, rawScore / 6)) : 0.35;

    const audience =
      normalizeAudienceGenderValue(source?.audience_gender) ||
      normalizeAudienceGenderValue(source?.attr_gender);
    if (audience) {
      genderCounts[audience] += audience === "unisex" ? weight * 0.4 : weight;
    }

    const ageGroup = normalizeAudienceAgeGroupValue(source?.age_group) || inferAgeGroupFromText(String(source?.title || ""));
    if (ageGroup) ageCounts[ageGroup] += weight;

    const styleBlob = `${String(source?.attr_style || "")} ${String(source?.title || "")}`;
    for (const token of extractStyleTokensFromText(styleBlob)) {
      styleCounts.set(token, (styleCounts.get(token) || 0) + weight);
    }
  }

  const styleTerms = Array.from(styleCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k]) => k);

  let inferredAudienceGender: AudienceGender | null = null;
  if (genderCounts.men > genderCounts.women && genderCounts.men >= 1.1) inferredAudienceGender = "men";
  else if (genderCounts.women > genderCounts.men && genderCounts.women >= 1.1) inferredAudienceGender = "women";
  else if (genderCounts.unisex >= 1.4) inferredAudienceGender = "unisex";

  let inferredAgeGroup: AudienceAgeGroup | null = null;
  if (ageCounts.kids >= 1.1 && ageCounts.kids > ageCounts.adult) inferredAgeGroup = "kids";
  else if (ageCounts.adult >= 1.1 && ageCounts.adult > ageCounts.kids) inferredAgeGroup = "adult";

  return { inferredAudienceGender, inferredAgeGroup, styleTerms };
}

function normalizeAudienceAgeGroupValue(raw: unknown): AudienceAgeGroup | null {
  if (raw == null) return null;
  const s = String(raw).toLowerCase().trim();
  if (!s) return null;
  if (["kids", "kid", "children", "child", "baby", "toddler", "youth", "junior", "boys", "girls"].includes(s)) return "kids";
  if (["adult", "adults", "men", "women", "unisex"].includes(s)) return "adult";
  return null;
}

function strictAudienceMatchEnabled(): boolean {
  const raw = String(process.env.SEARCH_STRICT_AUDIENCE_MATCH ?? "1").toLowerCase().trim();
  return !(raw === "0" || raw === "false" || raw === "no");
}

function inferAgeGroupFromText(text: string): AudienceAgeGroup | null {
  const s = String(text || "").toLowerCase();
  const kidsHits = (s.match(/\bkids?\b|\bchildren\b|\bchild\b|\bbaby\b|\btoddler\b|\byouth\b|\bjunior\b|\bboys?\b|\bgirls?\b/g) || []).length;
  const adultHits = (s.match(/\bmen\b|\bwomen\b|\badult\b|\bladies\b|\bgents\b|\bmale\b|\bfemale\b/g) || []).length;
  if (kidsHits > adultHits && kidsHits > 0) return "kids";
  if (adultHits > kidsHits && adultHits > 0) return "adult";
  return null;
}

function inferPreferredAgeGroup(currentItems: CompleteLookAnchorRow[]): AudienceAgeGroup | null {
  let kids = 0;
  let adult = 0;
  for (const item of currentItems) {
    const explicit = normalizeAudienceAgeGroupValue(item.age_group);
    if (explicit === "kids") kids += 2;
    if (explicit === "adult") adult += 2;
    const inferred = inferAgeGroupFromText(`${String(item.name || "")} ${String(item.title || "")} ${String(item.category_name || "")}`);
    if (inferred === "kids") kids += 1;
    if (inferred === "adult") adult += 1;
  }
  if (kids > adult && kids > 0) return "kids";
  if (adult > kids && adult > 0) return "adult";
  return null;
}

function buildAgeGroupFilter(ageGroup: AudienceAgeGroup): any {
  const strictAudience = strictAudienceMatchEnabled();
  if (ageGroup === "kids") {
    return {
      bool: {
        should: [
          { terms: { age_group: ["kids", "kid", "children", "child", "youth", "junior"] } },
          { match: { title: "kids" } },
          { match: { title: "children" } },
          { match: { title: "junior" } },
        ],
        minimum_should_match: 1,
        must_not: [
          {
            bool: {
              should: [{ match: { title: "men" } }, { match: { title: "women" } }, { match: { title: "adult" } }],
              minimum_should_match: 1,
            },
          },
        ],
      },
    };
  }
  if (strictAudience) {
    return {
      bool: {
        should: [
          { terms: { age_group: ["adult", "adults"] } },
          { match: { title: "men" } },
          { match: { title: "women" } },
          { match: { title: "adult" } },
        ],
        minimum_should_match: 1,
        must_not: [
          {
            bool: {
              should: [
                { terms: { age_group: ["kids", "kid", "children", "child", "youth", "junior"] } },
                { match: { title: "kids" } },
                { match: { title: "children" } },
                { match: { title: "junior" } },
                { match: { title: "boys" } },
                { match: { title: "girls" } },
              ],
              minimum_should_match: 1,
            },
          },
        ],
      },
    };
  }
  return {
    bool: {
      must_not: [
        {
          bool: {
            should: [
              { terms: { age_group: ["kids", "kid", "children", "child", "youth", "junior"] } },
              { match: { title: "kids" } },
              { match: { title: "children" } },
              { match: { title: "junior" } },
            ],
            minimum_should_match: 1,
          },
        },
      ],
    },
  };
}

function normalizeAudienceGenderValue(raw: unknown): AudienceGender | null {
  if (raw === null || raw === undefined) return null;

  const values = Array.isArray(raw)
    ? raw.flatMap((v) => String(v).split(/[|,;/]+/g))
    : String(raw).split(/[|,;/]+/g);

  let hasMen = false;
  let hasWomen = false;
  let hasUnisex = false;

  for (const part of values) {
    const s = String(part).toLowerCase().trim();
    if (!s) continue;
    const normalized = normalizeQueryGender(s);
    if (normalized === "unisex") {
      hasUnisex = true;
      continue;
    }
    if (normalized === "men") {
      hasMen = true;
      continue;
    }
    if (normalized === "women") {
      hasWomen = true;
      continue;
    }
    if (["male", "man", "mens", "men's", "gents", "gentlemen", "boy", "boys", "boys-kids", "boys_kids"].includes(s)) hasMen = true;
    if (["female", "woman", "womens", "women's", "ladies", "lady", "girl", "girls", "girls-kids", "girls_kids"].includes(s)) hasWomen = true;
  }

  if (hasUnisex || (hasMen && hasWomen)) return "unisex";
  if (hasMen) return "men";
  if (hasWomen) return "women";
  return null;
}

function inferGenderFromText(text: string): AudienceGender | null {
  const s = text.toLowerCase();
  const menHits =
    (s.match(/\bmen\b|\bmens\b|\bmen's\b|\bmale\b|\bman\b|\bgents?\b|\bboys?\b/g) || []).length;
  const womenHits =
    (s.match(/\bwomen\b|\bwomens\b|\bwomen's\b|\bfemale\b|\bwoman\b|\bladies\b|\blady\b|\bgirls?\b/g) || []).length;
  if (menHits > womenHits) return "men";
  if (womenHits > menHits) return "women";
  return null;
}

async function inferPreferredAudienceGender(
  userId: number,
  currentItems: CompleteLookAnchorRow[],
  options: { allowWardrobeHistory?: boolean; allowUserProfile?: boolean } = {}
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

  if (counts.men === 0 && counts.women === 0 && options.allowWardrobeHistory !== false) {
    const wardrobeGenderRows = await pg
      .query(
        `SELECT p.gender, COUNT(*)::int AS cnt
         FROM wardrobe_items wi
         JOIN products p ON p.id = wi.product_id
         WHERE wi.user_id = $1 AND p.gender IS NOT NULL
         GROUP BY p.gender`,
        [userId]
      )
      .then((r) => r.rows)
      .catch(() => [] as Array<{ gender: unknown; cnt: number }>);

    for (const row of wardrobeGenderRows) {
      const normalized = normalizeAudienceGenderValue(row.gender);
      if (!normalized) continue;
      const weight = Math.max(1, Number(row.cnt) || 1);
      counts[normalized] += normalized === "unisex" ? weight * 0.25 : weight;
    }
  }

  if (counts.men === 0 && counts.women === 0 && options.allowUserProfile !== false) {
    const userGender = await pg
      .query(`SELECT gender FROM users WHERE id = $1`, [userId])
      .then((r) => normalizeAudienceGenderValue(r.rows?.[0]?.gender))
      .catch(() => null);
    if (userGender && userGender !== "unisex") {
      counts[userGender] += 2;
    }
  }

  if (counts.men === 0 && counts.women === 0 && counts.unisex === 0) return null;
  if (counts.men > counts.women) return "men";
  if (counts.women > counts.men) return "women";
  // Ambiguous tie between men/women signals: keep neutral instead of defaulting to men.
  // Only return unisex if truly no gender signal from user, wardrobe, or profile
  return null;
}

function buildAudienceGenderFilter(gender: "men" | "women"): any {
  const strictAudience = strictAudienceMatchEnabled();
  const allowTerms = strictAudience ? [gender] : [gender, "unisex"];
  const attrGenderTerms = [
    ...new Set([
      ...(attrGenderFilterClause(gender).terms.attr_gender || []),
      ...(attrGenderFilterClause("unisex").terms.attr_gender || []),
    ]),
  ];
  const oppositeTitleTerms =
    gender === "men"
      ? ["women", "womens", "female", "ladies", "woman", "girls", "girl"]
      : ["men", "mens", "male", "man", "gents", "boys", "boy"];
  const oppositeGender = gender === "men" ? "women" : "men";
  const oppositeAttrTerms = [
    ...new Set(attrGenderFilterClause(oppositeGender).terms.attr_gender || []),
  ];

  return {
    bool: {
      should: [
        { terms: { attr_gender: attrGenderTerms } },
        { terms: { audience_gender: allowTerms } },
        ...allowTerms.map((kw) => ({ match: { title: kw } })),
      ],
      minimum_should_match: 1,
      must_not: [
        ...(oppositeAttrTerms.length > 0 ? [{ terms: { attr_gender: oppositeAttrTerms } }] : []),
        { terms: { audience_gender: [oppositeGender] } },
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

function audienceGenderMatches(
  inferred: AudienceGender | null,
  source: any,
  enforceNeutralWhenUnknown: boolean = false
): boolean {
  const strictAudience = strictAudienceMatchEnabled();
  const textBlob = `${String(source?.title || "")} ${String(source?.category || "")} ${String(
    source?.category_canonical || ""
  )}`;
  const doc =
    normalizeAudienceGenderValue(source?.audience_gender) ||
    normalizeAudienceGenderValue(source?.attr_gender);

  // When inferred gender is null/unknown, accept items of any gender.
  // Unknown-gender products (e.g., unbranded sweatshirts) should pair with items from all genders.
  if (!inferred) {
    return true;
  }

  if (inferred === "unisex") {
    if (!enforceNeutralWhenUnknown) return true;
    if (doc && doc !== "unisex") return false;
    const fromTextUnknown = inferGenderFromText(textBlob);
    return !fromTextUnknown;
  }

  if (doc) {
    if (strictAudience) return doc === inferred;
    return doc === inferred || doc === "unisex";
  }
  const fromText = inferGenderFromText(textBlob);
  if (!fromText) return false;
  return fromText === inferred;
}

function audienceAgeGroupMatches(inferredAgeGroup: AudienceAgeGroup | null, source: any): boolean {
  return audienceAgeGroupMatchesWithOptions(inferredAgeGroup, source, {});
}

function audienceAgeGroupMatchesWithOptions(
  inferredAgeGroup: AudienceAgeGroup | null,
  source: any,
  options: { allowUnknown?: boolean } = {}
): boolean {
  const allowUnknown = Boolean(options.allowUnknown);
  const strictAudience = strictAudienceMatchEnabled();
  if (!inferredAgeGroup) return true;
  const docAge = normalizeAudienceAgeGroupValue(source?.age_group);
  const textAge = inferAgeGroupFromText(`${String(source?.title || "")} ${String(source?.category || "")} ${String(source?.category_canonical || "")}`);
  const effective = docAge || textAge;
  if (!effective) return allowUnknown ? true : strictAudience ? false : inferredAgeGroup !== "kids";
  return effective === inferredAgeGroup;
}

function audienceGenderMatchesForSlot(
  inferred: AudienceGender | null,
  source: any,
  slot: string,
  enforceNeutralWhenUnknown: boolean = false,
  options: { allowUnknownForBags?: boolean } = {}
): boolean {
  const allowUnknownForBags = Boolean(options.allowUnknownForBags);
  const base = audienceGenderMatches(inferred, source, enforceNeutralWhenUnknown);
  if (!base) return false;

  // Bags/accessories often miss structured gender tags; in gendered looks,
  // avoid accepting unknown-gender docs for these slots.
  if (inferred && inferred !== "unisex" && (slot === "bags" || slot === "accessories")) {
    const doc =
      normalizeAudienceGenderValue(source?.audience_gender) ||
      normalizeAudienceGenderValue(source?.attr_gender);
    if (doc) return doc === inferred || doc === "unisex";
    const fromText = inferGenderFromText(
      `${String(source?.title || "")} ${String(source?.category || "")} ${String(source?.category_canonical || "")}`
    );
    if (!fromText && slot === "bags" && allowUnknownForBags) return true;
    return fromText === inferred;
  }

  if (slot === "bags") {
    const bagBlob = `${String(source?.title || "")} ${String(source?.category || "")} ${String(source?.category_canonical || "")}`.toLowerCase();
    if (/\b(wallet|backpack|duffle|luggage|suitcase|travel accessory|key ring|keychain)\b/.test(bagBlob)) {
      return false;
    }
  }

  return true;
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
  items: Array<{
    name?: string | null;
    title?: string | null;
    category_name?: string | null;
    style_tags?: string[] | null;
    occasion_tags?: string[] | null;
  }>,
  occasionCoverage: string[]
): string[] {
  const terms = new Set<string>();

  for (const item of items) {
    const blob = `${String(item.name || "")} ${String(item.title || "")} ${String(item.category_name || "")}`.toLowerCase();
    for (const token of STYLE_TERMS_LEXICON) {
      if (blob.includes(token)) terms.add(token);
    }
    for (const tag of item.style_tags || []) {
      const normalized = String(tag || "").toLowerCase().trim();
      if (!normalized) continue;
      if (STYLE_TERMS_LEXICON.includes(normalized as any)) terms.add(normalized);
    }
    for (const occ of item.occasion_tags || []) {
      const normalized = String(occ || "").toLowerCase().trim();
      if (!normalized) continue;
      if (normalized.includes("work")) terms.add("business");
      else if (STYLE_TERMS_LEXICON.includes(normalized as any)) terms.add(normalized);
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
  inferredAgeGroup: AudienceAgeGroup | null;
  enforceNeutralAudienceWhenUnknown?: boolean;
  relaxedBagAudienceMode?: boolean;
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
  const slotIntentFilters = params.missingCategories
    .map((slot) => buildSlotIntentFilter(slot))
    .filter((f): f is Record<string, any> => Boolean(f));
  if (slotIntentFilters.length > 0) {
    filter.push({ bool: { should: slotIntentFilters, minimum_should_match: 1 } });
  }
  const topUpBagOnlyRelaxed = Boolean(params.relaxedBagAudienceMode) && params.missingCategories.length === 1;
  if (params.inferredAudienceGender && params.inferredAudienceGender !== "unisex" && !topUpBagOnlyRelaxed) {
    filter.push(buildAudienceGenderFilter(params.inferredAudienceGender));
  }
  if (params.inferredAgeGroup && !topUpBagOnlyRelaxed) {
    filter.push(buildAgeGroupFilter(params.inferredAgeGroup));
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
        "product_types",
      ],
      sort: [{ _score: { order: "desc" } }, { last_seen_at: { order: "desc", missing: "_last" } }],
    },
  });

  const hits = response.body?.hits?.hits || [];
  const maxRawScore = Math.max(1, ...hits.map((h: any) => (Number.isFinite(h?._score) ? h._score : 0)));
  const out: CompleteLookSuggestion[] = [];

  for (const hit of hits) {
    const source = hit?._source || {};
    const matchedSlot =
      params.missingCategories.find((slot) => sourceMatchesSlot(slot, source)) || "accessories";
    if (!params.missingCategories.some((slot) => sourceMatchesSlot(slot, source))) continue;
    if (!audienceGenderMatchesForSlot(
      params.inferredAudienceGender,
      source,
      matchedSlot,
      Boolean(params.enforceNeutralAudienceWhenUnknown),
      { allowUnknownForBags: topUpBagOnlyRelaxed && matchedSlot === "bags" }
    )) continue;
    if (!audienceAgeGroupMatchesWithOptions(params.inferredAgeGroup, source, {
      allowUnknown: topUpBagOnlyRelaxed && matchedSlot === "bags",
    })) continue;
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
      embeddingNorm * 0.31 +
      categoryCompat * 0.18 +
      colorHarmony * 0.12 +
      styleAlignment * 0.19 +
      patternAlignment * 0.08 +
      materialAlignment * 0.05 +
      formalityAlignment * 0.07;

    if (score < minimumSlotScore(matchedSlot)) continue;

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






