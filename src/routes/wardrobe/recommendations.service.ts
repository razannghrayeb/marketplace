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
import {
  outfitEmbeddingCoverage,
  outfitNarrativeLatencyMs,
  outfitSetCoherence,
  outfitSlotRejectionRate,
  outfitSuggestionsReturned,
  outfitSuggestionsTotal,
} from "../../lib/metrics";
import { inferOccasion, type InferredOccasion } from "../../lib/outfit/occasionInference";
import {
  applyNarrativeToProducts,
  generateOutfitNarrativeWithCache,
  type OutfitNarrative,
} from "../../lib/outfit/outfitNarrative";
import type { ProductCategory, StyleProfile, StyleRecommendation } from "../../lib/outfit/completestyle";
import { mapHexToFashionCanonical } from "../../lib/color/garmentColorPipeline";
import {
  getStyleAwareSlotTerms,
  resolveWeatherContext,
  type FashionAesthetic,
  type OutfitOccasion,
  type StyleSlotQuery,
} from "../../lib/outfit/styleAwareSlotQuery";
import type { StylistDirection } from "../../lib/outfit/stylistDirection";

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
    colorPreferenceAlignment?: number;
    styleAlignment?: number;
    patternAlignment?: number;
    formalityAlignment?: number;
    weatherAlignment?: number;
    materialAlignment?: number;
    footwearStyleAlignment?: number;
    bagStyleAlignment?: number;
    bagColorAlignment?: number;
    bottomSilhouetteAlignment?: number;
    colorDecisionAlignment?: number;
    accessoryStyleAlignment?: number;
  };
  stylistSignals?: {
    slot?: string;
    color?: string | null;
    formalityScore?: number;
    aesthetic?: string;
    styleTokens?: string[];
  };
  attributionTags?: string[];
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
  outfitNarrative?: OutfitNarrative;
  inferredOccasion?: InferredOccasion;
}

/** Slots used for gap detection (DB name, vision, and OpenSearch slot labels). */
export const TRACKED_OUTFIT_SLOTS = new Set([
  "tops",
  "bags",
  "accessories",
  "dresses",
  "bottoms",
  "shoes",
  "outerwear",
  "tailored",
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
  "bohemian",
  "elegant",
  "chic",
  "edgy",
  "business",
  "romantic",
  "modern",
] as const;

function isTrackedOutfitSlot(value: string): boolean {
  return TRACKED_OUTFIT_SLOTS.has(value);
}

function normalizeWardrobeCategory(value?: string | null): string | null {
  if (!value) return null;
  const raw = value.toLowerCase().trim();
  if (!raw) return null;
  if (raw.includes("dress") || raw.includes("gown")) return "dresses";
  if (raw.includes("top") || raw.includes("shirt") || raw.includes("polo") || raw.includes("blouse") || raw.includes("hoodie") || raw.includes("sweater"))
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
  if (raw.includes("bag") || raw.includes("tote") || raw.includes("clutch") || raw.includes("backpack") || raw.includes("crossbody") || raw.includes("satchel") || raw.includes("messenger") || raw.includes("purse"))
    return "bags";
  if (raw.includes("accessor") || raw.includes("wallet") || raw.includes("card holder") || raw.includes("watch") || raw.includes("scarf") || raw.includes("hat") || raw.includes("sunglass") || raw.includes("jewelry"))
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
    if (missing.length >= 3) break;
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

function categoryLabelToSlot(label?: string | null): string {
  const text = String(label || "").toLowerCase().trim();
  if (!text) return "accessories";
  if (text.includes("bag") || text.includes("backpack") || text.includes("crossbody") || text.includes("clutch") || text.includes("tote") || text.includes("satchel") || text.includes("messenger") || text.includes("purse")) return "bags";
  if (text.includes("wallet") || text.includes("card holder") || text.includes("accessor") || text.includes("watch") || text.includes("scarf") || text.includes("hat") || text.includes("belt") || text.includes("jewel") || text.includes("sunglass")) return "accessories";
  if (text.includes("shoe") || text.includes("sneaker") || text.includes("boot") || text.includes("heel") || text.includes("sandal") || text.includes("loafer") || text.includes("flat") || text.includes("mule") || text.includes("trainer")) return "shoes";
  if (text.includes("dress")) return "dresses";
  if (text.includes("outer") || text.includes("jacket") || text.includes("coat") || text.includes("blazer")) return "outerwear";
  if (text.includes("top") || text.includes("shirt") || text.includes("hoodie") || text.includes("sweater") || text.includes("blouse")) return "tops";
  if (text.includes("bottom") || text.includes("pant") || text.includes("trouser") || text.includes("jean") || text.includes("skirt") || text.includes("short")) return "bottoms";
  return "accessories";
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
  if (slot === "bags") return /\b(wallet|card holder|card case|coin purse|phone case|bag charm|strap|headband|hair accessory|hairband|headwear|hat|cap|beanie|duffle|luggage|suitcase|travel accessory|key ring|keychain)\b/;
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
  if (slot === "bags" && canonical === "bags") {
    const bagNoise = /\b(wallet|card holder|card case|coin purse|phone case|bag charm|strap|duffle|duffel|luggage|suitcase|travel accessory|key ring|keychain|sleeping bag|toiletry|passport holder)\b/.test(blob);
    return !bagNoise;
  }
  if (!allow) return canonical === slot;

  const textMatches = allow.test(blob);
  if (!textMatches) return false;

  // Hard cross-slot contamination guards (e.g. "Shoe Bag" should not be classified as shoes).
  if (slot === "shoes" && /\b(bag|bags|handbag|tote|clutch|purse|wallet|backpack|crossbody|satchel|messenger)\b/.test(blob)) {
    return false;
  }
  if (slot === "bottoms" && /\b(shoe|shoes|sneaker|boot|heel|loafer|sandal|bag|bags|handbag|tote|clutch|purse|wallet)\b/.test(blob)) {
    return false;
  }
  if (slot === "bottoms" && /\b(top|tops|shirt|shirts|blouse|blouses|t-?shirt|tee|polo|hoodie|sweater|sweatshirt|cardigan|tank|camisole|knitwear|short sleeves?|long sleeves?)\b/.test(blob)) {
    return false;
  }
  // Swimwear and underwear are not outfit bottoms.
  if (slot === "bottoms" && /\b(bikini|swimsuit|swimwear|swim wear|swimming|swim brief|swim short|underwear|briefs?|thong|panty|panties|boxer|lingerie)\b/.test(blob)) {
    return false;
  }
  if (slot === "tops" && /\b(shoe|shoes|sneaker|boot|heel|loafer|sandal|bag|bags|handbag|tote|clutch|purse|wallet)\b/.test(blob)) {
    return false;
  }

  // Require the text intent to agree with the canonical slot when the index is noisy.
  // This prevents mislabeled items (e.g. shirts indexed as shoes) from leaking through.
  if (canonical && canonical !== slot) {
    if (slot === "accessories") {
      const strongAccessoryIntent = /\b(watch|watches|scarf|scarves|hat|hats|cap|caps|sunglass|sunglasses|jewel|jewelry|jewellery|necklace|earring|bracelet|ring|belt)\b/.test(blob);
      const bagLikeIntent = /\b(bag|bags|handbag|handbags|tote|totes|clutch|clutches|wallet|crossbody|backpack|satchel|messenger)\b/.test(blob);
      if (strongAccessoryIntent && !bagLikeIntent) return true;
    }
    // Special case: hooded/hoodie items can be used as tops even if categorizied as outerwear
    if (slot === "tops" && /\b(hoodie|hooded)\b/.test(blob)) return true;
    
    const canonicalRegex = slotKeywordRegex(canonical);
    if (canonicalRegex && canonicalRegex.test(blob)) return false;
  }

  return true;
}

function stylistSlotKey(slot: string): keyof StylistDirection["slots"] | null {
  const normalized = normalizeWardrobeCategory(slot) || String(slot || "").toLowerCase().trim();
  if (normalized === "dresses") return "dress";
  if (normalized === "tops" || normalized === "bottoms" || normalized === "shoes" || normalized === "bags" || normalized === "outerwear" || normalized === "accessories") {
    return normalized;
  }
  return null;
}

function mergeStylistDirectionIntoSlotQuery(
  base: StyleSlotQuery,
  slot: string,
  direction?: StylistDirection,
): StyleSlotQuery {
  if (!direction) return base;
  const key = stylistSlotKey(slot);
  const ideal = key ? direction.slots[key] : undefined;
  const unique = (items: string[], limit: number) => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      const s = String(item || "").toLowerCase().trim();
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
      if (out.length >= limit) break;
    }
    return out;
  };

  const avoidForSlot = (direction.avoid.families || []).includes(String(key || "").toLowerCase())
    ? ["avoid-this-slot"]
    : [];
  return {
    primaryTerms: unique([...(ideal?.keywords || []), ...base.primaryTerms], 12),
    boostTerms: unique([...(ideal?.styles || []), ...(ideal?.colors || []), ...base.boostTerms], 12),
    avoidTerms: unique([...(direction.avoid.keywords || []), ...(direction.avoid.styles || []), ...avoidForSlot, ...base.avoidTerms], 14),
  };
}

function inferStrongTitleSlot(source: any): string | null {
  const titleSlots = inferSlotsFromFreeText(String(source?.title || ""));
  if (titleSlots.size === 1) {
    return Array.from(titleSlots)[0] || null;
  }
  return null;
}

function buildSlotIntentFilter(slot: string): any | null {
  const bagTerms = [
    "bag",
    "handbag",
    "tote",
    "clutch",
    "purse",
    "crossbody",
    "satchel",
    "messenger",
    "shoulder bag",
    "bucket bag",
    "hobo bag",
    "backpack",
    "mini bag",
  ];
  const accessoryTerms = ["accessories", "jewelry", "watch", "scarf", "belt", "sunglasses", "hat", "earrings", "necklace", "bracelet", "ring"];
  const outerwearTerms = ["outerwear", "jacket", "coat", "blazer", "cardigan", "parka", "trench", "bomber"];
  const topTerms = ["top", "tops", "shirt", "shirts", "blouse", "blouses", "t-shirt", "tee", "hoodie", "sweater", "sweatshirt", "cardigan", "tank", "camisole", "polo", "knitwear", "short sleeve", "short sleeves", "long sleeve", "long sleeves"];
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
            ? ["shirt", "top", "pant", "shoe", "sneaker", "jacket", "wallet", "card holder", "card case", "coin purse", "phone case", "bag charm", "strap", "duffle", "luggage", "suitcase", "travel accessory", "key ring", "keychain"]
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
                { match_phrase: { title: "duffle" } },
                { match_phrase: { title: "luggage" } },
                { match_phrase: { title: "suitcase" } },
                { match_phrase: { title: "travel accessory" } },
                { match_phrase: { title: "wallet" } },
                { match_phrase: { title: "card holder" } },
                { match_phrase: { title: "card case" } },
                { match_phrase: { title: "coin purse" } },
                { match_phrase: { title: "phone case" } },
                { match_phrase: { title: "bag charm" } },
                { match_phrase: { title: "strap" } },
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

function scoreFootwearStyleCompatibility(
  inferredOccasion: InferredOccasion,
  preferredStyleTerms: string[],
  source: any
): number {
  const blob = `${String(source?.title || "")} ${String(source?.category || "")} ${String(source?.attr_style || "")} ${String(source?.product_types || "")}`.toLowerCase();
  const isSporty = /\b(sneaker|sneakers|trainer|trainers|running shoe|athletic|gym|sport|canvas shoe|basketball shoe)\b/.test(blob);
  const isDressy = /\b(heel|heels|pump|pumps|stiletto|mule|mules|loafer|loafers|oxford|oxfords|dress shoe|kitten heel)\b/.test(blob);
  const styleSet = new Set(preferredStyleTerms.map((t) => String(t || "").toLowerCase().trim()).filter(Boolean));
  const prefersSporty = styleSet.has("sporty") || styleSet.has("athleisure") || styleSet.has("streetwear");
  const prefersFormal = styleSet.has("business") || styleSet.has("elegant") || styleSet.has("classic") || styleSet.has("formal");

  if (inferredOccasion === "formal" || inferredOccasion === "semi-formal" || inferredOccasion === "party") {
    if (isSporty && !prefersSporty) return 0.24;
    if (isDressy) return 0.96;
    return 0.68;
  }

  if (inferredOccasion === "casual") {
    if (isSporty) return prefersFormal ? 0.72 : 0.96;
    if (isDressy) return prefersFormal ? 0.84 : 0.7;
  }

  if (inferredOccasion === "beach") {
    if (/\b(sandal|sandals|slides?|flip flop|espadrille)\b/.test(blob)) return 0.95;
    if (isSporty) return 0.74;
    if (isDressy) return 0.48;
  }

  return 0.74;
}

function scoreFootwearDressAlignment(
  currentCategoryList: string[],
  source: any,
): number {
  if (!currentCategoryList.includes("dresses")) return 1;
  const blob = `${String(source?.title || "")} ${String(source?.category || "")} ${String(source?.attr_style || "")} ${String(source?.product_types || "")}`.toLowerCase();
  const isSneaker = /\b(sneaker|sneakers|trainer|trainers|running shoe|athletic|gym|sport|canvas shoe|basketball shoe)\b/.test(blob);
  const isDressFriendly =
    /\b(heel|heels|pump|pumps|stiletto|kitten heel|sandal|sandals|flat|flats|loafer|loafers|mule|mules|espadrille|mary jane|strappy)\b/.test(
      blob
    );
  if (isDressFriendly) return 0.98;
  if (isSneaker) return 0.34;
  return 0.72;
}

function scoreBagStyleCompatibility(
  inferredOccasion: InferredOccasion,
  preferredStyleTerms: string[],
  source: any
): number {
  const blob = `${String(source?.title || "")} ${String(source?.category || "")} ${String(source?.attr_style || "")} ${String(source?.product_types || "")}`.toLowerCase();
  const isFormalBag = /\b(clutch|evening bag|top handle|mini bag|satchel)\b/.test(blob);
  const isCasualBag = /\b(backpack|crossbody|hobo|tote|messenger|shoulder bag)\b/.test(blob);
  const isTravel = /\b(duffle|luggage|suitcase|travel)\b/.test(blob);
  const styleSet = new Set(preferredStyleTerms.map((t) => String(t || "").toLowerCase().trim()).filter(Boolean));
  const prefersFormal = styleSet.has("business") || styleSet.has("elegant") || styleSet.has("classic") || styleSet.has("formal");

  if (isTravel) return 0.22;

  if (inferredOccasion === "formal" || inferredOccasion === "semi-formal" || inferredOccasion === "party") {
    if (isFormalBag) return 0.95;
    if (isCasualBag) return prefersFormal ? 0.42 : 0.58;
    return 0.7;
  }

  if (inferredOccasion === "casual") {
    if (isCasualBag) return 0.92;
    if (isFormalBag) return prefersFormal ? 0.74 : 0.6;
    return 0.72;
  }

  if (inferredOccasion === "beach") {
    if (/\b(tote|straw|woven|canvas|crossbody)\b/.test(blob)) return 0.9;
    if (isFormalBag) return 0.44;
    return 0.72;
  }

  return 0.72;
}

function scoreBottomSilhouetteCompatibility(params: {
  currentItems: CompleteLookAnchorRow[];
  currentCategoryList: string[];
  source: any;
  inferredOccasion: InferredOccasion;
  preferredStyleTerms: string[];
  preferredFormality: "casual" | "business" | "formal" | "mixed";
  weatherHint?: WeatherHint;
}): number {
  const candidate = `${String(params.source?.title || "")} ${String(params.source?.category || "")} ${String(params.source?.attr_style || "")} ${String(params.source?.product_types || "")}`.toLowerCase();
  const anchorBlob = params.currentItems
    .map((item) => `${String(item.title || "")} ${String(item.name || "")} ${String(item.category_name || "")}`)
    .join(" ")
    .toLowerCase();
  const styleSet = new Set(params.preferredStyleTerms.map((t) => String(t || "").toLowerCase().trim()).filter(Boolean));

  const isTailored = /\b(tailored|dress pant|dress pants|trouser|trousers|slack|slacks|pleated|wide leg|wide-leg|straight leg|straight-leg|pencil skirt|midi skirt)\b/.test(candidate);
  const isDenim = /\b(jean|jeans|denim)\b/.test(candidate);
  const isSkirt = /\b(skirt|mini skirt|midi skirt|maxi skirt)\b/.test(candidate);
  const isShort = /\b(short|shorts|bermuda)\b/.test(candidate);
  const isSport = /\b(legging|leggings|jogger|joggers|sweatpants|track pant|track pants|training|gym|running|workout|athletic)\b/.test(candidate);
  const isSlim = /\b(skinny|slim|legging|leggings)\b/.test(candidate);
  const isWideStraight = /\b(wide leg|wide-leg|straight leg|straight-leg|relaxed|barrel|cargo pant|cargo pants)\b/.test(candidate);

  const anchorOversizedOrCozy = /\b(oversized|boxy|relaxed|sweater|hoodie|sweatshirt|cardigan|knit|wool|fleece|cashmere)\b/.test(anchorBlob);
  const anchorTailored = /\b(blazer|suit|tailored|button[-\s]?down|dress shirt|coat)\b/.test(anchorBlob);
  const anchorLightSummer = /\b(tank|cami|sleeveless|linen|beach|crop top|summer)\b/.test(anchorBlob);
  const anchorDressy = params.inferredOccasion === "formal" || params.inferredOccasion === "semi-formal" || params.inferredOccasion === "party" || params.preferredFormality === "formal" || params.preferredFormality === "business";
  const prefersStreet = styleSet.has("streetwear") || styleSet.has("edgy");
  const prefersSport = styleSet.has("sporty") || styleSet.has("athleisure") || params.inferredOccasion === "active";

  let score = 0.68;
  if (isTailored) score += anchorDressy || anchorTailored ? 0.24 : 0.08;
  if (isDenim) score += anchorDressy ? -0.08 : 0.14;
  if (isWideStraight) score += anchorOversizedOrCozy || prefersStreet ? 0.14 : 0.06;
  if (isSlim) score += anchorOversizedOrCozy ? 0.1 : -0.02;
  if (isSkirt) score += anchorDressy ? 0.12 : anchorOversizedOrCozy ? -0.2 : 0.02;
  if (isShort) score += anchorLightSummer || params.inferredOccasion === "beach" ? 0.14 : -0.26;
  if (isSport) score += prefersSport ? 0.18 : -0.34;

  if (params.weatherHint?.season === "winter" && isShort) score -= 0.28;
  if (params.weatherHint?.temperatureC != null && params.weatherHint.temperatureC <= 12 && isShort) score -= 0.24;
  if (anchorDressy && (isSport || isShort)) score -= 0.28;
  if (anchorTailored && isSport) score -= 0.22;

  return Math.max(0, Math.min(1, score));
}

function scoreAccessoryStyleCompatibility(
  inferredOccasion: InferredOccasion,
  preferredStyleTerms: string[],
  source: any
): number {
  const blob = `${String(source?.title || "")} ${String(source?.category || "")} ${String(source?.attr_style || "")} ${String(source?.product_types || "")}`.toLowerCase();
  const isStatement = /\b(statement|chunky|oversized|bold|layered|gem|crystal|embellished|drop earring)\b/.test(blob);
  const isFormal = /\b(watch|pearl|gold|silver|leather belt|silk scarf|minimal|dainty|fine jewelry|cufflink|brooch)\b/.test(blob);
  const isCasual = /\b(cap|baseball cap|beanie|canvas belt|woven belt|cotton scarf|sport watch|sunglasses)\b/.test(blob);
  const isNoisy = /\b(key ?ring|keychain|phone case|hair accessory|scrunchie|headband)\b/.test(blob);
  const styleSet = new Set(preferredStyleTerms.map((t) => String(t || "").toLowerCase().trim()).filter(Boolean));
  const prefersMinimal = styleSet.has("minimalist") || styleSet.has("classic") || styleSet.has("business");
  const prefersBold = styleSet.has("edgy") || styleSet.has("streetwear") || styleSet.has("boho");

  if (isNoisy) return 0.38;

  if (inferredOccasion === "formal" || inferredOccasion === "semi-formal" || inferredOccasion === "party") {
    if (isFormal) return 0.94;
    if (isCasual) return 0.6;
    if (isStatement) return inferredOccasion === "party" ? 0.9 : 0.76;
    return 0.74;
  }

  if (inferredOccasion === "casual") {
    if (isCasual) return 0.9;
    if (isFormal) return prefersMinimal ? 0.8 : 0.66;
    if (isStatement) return prefersBold ? 0.86 : 0.72;
    return 0.74;
  }

  if (inferredOccasion === "beach") {
    if (/\b(straw|woven|canvas|raffia|sunglasses|cap|hat|scarf)\b/.test(blob)) return 0.9;
    if (isFormal) return 0.52;
    return 0.7;
  }

  if (prefersBold && isStatement) return 0.86;
  if (prefersMinimal && isFormal) return 0.84;
  return 0.72;
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

function normalizeTitleForVariantDiversity(title?: string | null): string {
  const base = String(title || "").toLowerCase();
  const noPunct = base.replace(/[^a-z0-9\s-]/g, " ");
  const tokens = noPunct
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !COLOR_FAMILIES_BY_NAME[t])
    .filter((t) => !/^(aw|ss)?\d{2,}[a-z0-9-]*$/.test(t))
    .filter((t) => !/^\d{2,}$/.test(t));
  return tokens.join(" ").trim().slice(0, 110);
}

function enforceVariantDiversity(
  items: CompleteLookSuggestion[],
  maxPerSignature: number = 2,
): CompleteLookSuggestion[] {
  const bySignature = new Map<string, number>();
  const out: CompleteLookSuggestion[] = [];
  for (const item of items) {
    const sig = `${String(item.brand || "").toLowerCase().trim()}|${normalizeTitleForVariantDiversity(item.title)}`;
    const seen = bySignature.get(sig) || 0;
    if (seen >= maxPerSignature) continue;
    bySignature.set(sig, seen + 1);
    out.push(item);
  }
  return out;
}

function minimumSlotScore(slot: string): number {
  const normalized = normalizeWardrobeCategory(slot) || String(slot || "").toLowerCase().trim();
  if (normalized === "bags" || normalized === "accessories") return 0.44;
  if (normalized === "shoes") return 0.42;
  if (normalized === "bottoms") return 0.42;
  if (normalized === "tops" || normalized === "outerwear" || normalized === "dresses") return 0.45;
  return 0.42;
}

/**
 * Outfit-level coherence gate.
 *
 * After each slot is scored independently, outliers that are too far from the
 * outfit's formality centre are penalised. This prevents a single formal item
 * (blazer, formality 7) from coexisting with a beach item (flip-flops, formality 1)
 * in the same completion set.
 *
 * Logic:
 *   1. Take the top suggestion per slot to compute the outfit's formality centre.
 *   2. Any suggestion whose formality deviates more than `MAX_FORMALITY_GAP` from
 *      that centre receives a proportional score penalty.
 *   3. Hard-incompatible aesthetic pairs (e.g. active + formal) are penalised more.
 */
function enforceOutfitCoherence(suggestions: CompleteLookSuggestion[]): CompleteLookSuggestion[] {
  if (suggestions.length <= 2) return suggestions;

  const MAX_FORMALITY_GAP = 3.5;

  // Collect formality from top item per slot
  const topBySlot = new Map<string, number>();
  for (const s of suggestions) {
    const slot = normalizeWardrobeCategory(s.stylistSignals?.slot || s.category) || "accessories";
    if (!topBySlot.has(slot)) {
      const f = s.stylistSignals?.formalityScore;
      if (f != null && Number.isFinite(f)) topBySlot.set(slot, f);
    }
  }

  if (topBySlot.size < 2) return suggestions;

  const formalityValues = Array.from(topBySlot.values());
  formalityValues.sort((a, b) => a - b);
  // Use median as the outfit's formality centre
  const mid = Math.floor(formalityValues.length / 2);
  const centre =
    formalityValues.length % 2 === 0
      ? (formalityValues[mid - 1] + formalityValues[mid]) / 2
      : formalityValues[mid];

  // Collect dominant aesthetic tokens from all suggestions
  const aestheticCounts: Record<string, number> = {};
  for (const s of suggestions) {
    const ae = String(s.stylistSignals?.aesthetic || "").toLowerCase().trim();
    if (ae) aestheticCounts[ae] = (aestheticCounts[ae] || 0) + 1;
  }
  const dominantAesthetic = Object.entries(aestheticCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "";

  // Hard-incompatible aesthetic pairs
  const HARD_CLASHES: Array<[string, string]> = [
    ["active", "formal"],
    ["active", "romantic"],
    ["sporty", "formal"],
    ["streetwear", "formal"],
    ["beach", "formal"],
  ];
  function isHardAestheticClash(a: string, b: string): boolean {
    return HARD_CLASHES.some(
      ([x, y]) => (a.includes(x) && b.includes(y)) || (a.includes(y) && b.includes(x))
    );
  }

  return suggestions
    .map((s) => {
      const f = s.stylistSignals?.formalityScore ?? centre;
      const diff = Math.abs(f - centre);
      let penalty = 1;

      // Formality outlier penalty
      if (diff > MAX_FORMALITY_GAP) {
        const excess = diff - MAX_FORMALITY_GAP;
        penalty *= Math.max(0.3, 1 - excess * 0.14);
      }

      // Aesthetic clash penalty
      if (dominantAesthetic) {
        const candidateAe = String(s.stylistSignals?.aesthetic || "").toLowerCase().trim();
        if (candidateAe && isHardAestheticClash(dominantAesthetic, candidateAe)) {
          penalty *= 0.45;
        }
      }

      if (penalty >= 0.99) return s;
      return {
        ...s,
        score: Math.round((s.score || 0) * penalty * 1000) / 1000,
      };
    })
    .sort((a, b) => (b.score || 0) - (a.score || 0));
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
        // Allow BOTH in_stock and out_of_stock products
        { bool: { should: [{ term: { availability: "in_stock" } }, { term: { availability: "out_of_stock" } }], minimum_should_match: 1 } },
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
              // Allow BOTH in_stock and out_of_stock products
              { bool: { should: [{ term: { availability: "in_stock" } }, { term: { availability: "out_of_stock" } }], minimum_should_match: 1 } },
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
              // Allow BOTH in_stock and out_of_stock products
              { bool: { should: [{ term: { availability: "in_stock" } }, { term: { availability: "out_of_stock" } }], minimum_should_match: 1 } },
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
  color?: string | null;
  name?: string | null;
  title?: string | null;
  gender?: string | null;
  image_url?: string | null;
  image_cdn?: string | null;
  category_name?: string | null;
  audience_gender?: string | null;
  age_group?: string | null;
};

export type CompleteLookCatalogFilters = {
  audience_gender?: string;
  age_group?: string;
};

type AudienceGender = "men" | "women" | "unisex";
type AudienceAgeGroup = "kids" | "adult";
type WeatherSeason = "spring" | "summer" | "fall" | "winter";

type WeatherHint = {
  temperatureC?: number;
  season?: WeatherSeason;
};

type CompleteLookAudienceOptions = {
  audienceGenderHint?: string | null;
  ageGroupHint?: string | null;
  occasionHint?: string | null;
  styleHints?: string[];
  colorHints?: string[];
  weatherHint?: WeatherHint;
  stylistDirection?: StylistDirection;
  allowUserAudienceFallback?: boolean;
  enforceNeutralAudienceWhenUnknown?: boolean;
  useDetectedCategoryForCurrentItems?: boolean;
};

function normalizeOccasionHint(value?: string | null): InferredOccasion | null {
  const v = String(value || "").toLowerCase().trim();
  if (v === "formal") return "formal";
  if (v === "semi-formal" || v === "semiformal" || v === "business") return "semi-formal";
  if (v === "casual") return "casual";
  if (v === "active" || v === "sport") return "active";
  if (v === "party" || v === "date") return "party";
  if (v === "beach" || v === "resort") return "beach";
  return null;
}

function occasionToFormality(occasion: InferredOccasion): "casual" | "business" | "formal" | "mixed" {
  if (occasion === "formal") return "formal";
  if (occasion === "semi-formal") return "business";
  if (occasion === "party") return "business";
  return "casual";
}

function buildAttributionTags(
  fitBreakdown?: CompleteLookSuggestion["fitBreakdown"],
): string[] {
  if (!fitBreakdown) return ["general_complement"];
  const tags: string[] = [];
  if ((fitBreakdown.colorHarmony ?? 0) > 0.75) tags.push("color_match");
  if ((fitBreakdown.colorPreferenceAlignment ?? 0) > 0.8) tags.push("preferred_color_match");
  if ((fitBreakdown.styleAlignment ?? 0) > 0.75) tags.push("style_match");
  if ((fitBreakdown.formalityAlignment ?? 0) > 0.75) tags.push("formality_match");
  if ((fitBreakdown.weatherAlignment ?? 0) > 0.75) tags.push("weather_appropriate");
  if ((fitBreakdown.categoryCompat ?? 0) > 0.75) tags.push("category_complement");
  if ((fitBreakdown.embeddingNorm ?? 0) > 0.75) tags.push("visual_similarity");
  return tags.length > 0 ? tags : ["general_complement"];
}

async function runCompleteLookCore(
  userId: number,
  currentItems: CompleteLookAnchorRow[],
  limit: number,
  catalogFilters: CompleteLookCatalogFilters | undefined,
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

  // Pass 0: always use detected category first when available.
  // This keeps image-derived anchors authoritative even when stored category labels are noisy.
  for (const row of currentItems as Array<any>) {
    if (row.detected_category) {
      pushCategory(normalizeWardrobeCategory(row.detected_category));
    }
  }

  // Pass 1: trust structured category signal as a fallback/additional signal.
  for (const row of currentItems) {
    pushCategory(normalizeWardrobeCategory(row.category_name));
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

  outfitSuggestionsTotal.inc({ mode: completionMode });
  const embeddingCoverage = currentItems.length > 0 ? currentEmbeddings.length / currentItems.length : 0;
  outfitEmbeddingCoverage.set({ mode: completionMode }, Math.max(0, Math.min(1, embeddingCoverage)));

  const visualContext = centroid
    ? await inferVisualContextFromCentroid(centroid, currentCategoryList).catch(() => ({
        inferredAudienceGender: null as AudienceGender | null,
        inferredAgeGroup: null as AudienceAgeGroup | null,
        styleTerms: [] as string[],
      }))
    : { inferredAudienceGender: null as AudienceGender | null, inferredAgeGroup: null as AudienceAgeGroup | null, styleTerms: [] as string[] };

  const hintedAudienceGender = normalizeAudienceGenderValue(audienceOptions.audienceGenderHint);
  const hintedAgeGroup = normalizeAudienceAgeGroupValue(audienceOptions.ageGroupHint);
  const hintedOccasion = normalizeOccasionHint(audienceOptions.occasionHint);
  const hintedStyleTerms = normalizeStyleHints(audienceOptions.styleHints);
  const inferredStyleTerms = inferStyleTermsFromCurrentItems(currentItems, styleProfile?.occasion_coverage || []);
  const extractedTitleStyleTerms = currentItems
    .map((item) =>
      extractStyleTokensFromText(
        `${String(item.name || "")} ${String(item.title || "")} ${String(item.category_name || "")}`
      )
    )
    .flat();
  const preferredStyleTerms = Array.from(
    new Set(hintedStyleTerms.concat(inferredStyleTerms).concat(visualContext.styleTerms).concat(extractedTitleStyleTerms))
  ).slice(0, 12);
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

  let inferredOccasion: InferredOccasion = hintedOccasion || "casual";
  if (!hintedOccasion) {
    const coverageOccasion = inferOccasionFromCoverageSignals(
      styleProfile?.occasion_coverage || [],
      preferredStyleTerms,
      currentItems,
    );
    const occasionInference = await inferOccasion(
      currentItems.map((row) => ({
        title: String(row.title || row.name || ""),
        category: String(row.category_name || ""),
        color: String(row.color || "") || undefined,
        styleTokens: extractStyleTokensFromText(
          `${String(row.title || "")} ${String(row.name || "")} ${String(row.category_name || "")}`,
        ),
      })),
    );
    inferredOccasion =
      coverageOccasion && occasionInference.confidence < 0.58
        ? coverageOccasion
        : occasionInference.occasion;
    if (
      coverageOccasion === "active" &&
      occasionInference.occasion === "casual" &&
      (preferredStyleTerms.includes("sporty") || preferredStyleTerms.includes("athleisure"))
    ) {
      inferredOccasion = "active";
    }
  }
  const enforceNeutralAudienceWhenUnknown =
    Boolean(audienceOptions.enforceNeutralAudienceWhenUnknown) || !inferredAudienceGender;
  const missingCategories = inferMissingCategoriesForOutfit({
    currentCategories,
    warmWeatherLikely,
    shouldOfferOuterwear,
  });
  const requestTrace: {
    mode: CompleteLookSuggestionsResult["completionMode"];
    currentSlots: string[];
    missingSlots: string[];
    stylistSource?: string;
    slots: Record<string, { evaluated: number; rejected: number; returned: number }>;
    finalReturned?: number;
  } = {
    mode: completionMode,
    currentSlots: currentCategoryList.slice(),
    missingSlots: missingCategories.slice(),
    stylistSource: audienceOptions.stylistDirection?.source,
    slots: {},
  };

  const userPriceTier = await inferPriceTier(userId).catch(() => null);
  const ownedProductIds = new Set<string>(
    currentItems
      .map((r) => (r.product_id !== null && r.product_id !== undefined ? String(r.product_id) : ""))
      .filter(Boolean)
  );

  const wardrobeCanonicalColors = extractWardrobeCanonicalColors(currentItems);
  const wardrobeColorFamilies = extractWardrobeColorFamilies(currentItems);
  const explicitWeather = normalizeWeatherHint(audienceOptions.weatherHint);
  const inferredWeather = inferWeatherHintFromContext({
    currentItems,
    seasonCoverage: styleProfile?.season_coverage || [],
    inferredOccasion,
  });
  const hintedWeather = explicitWeather || inferredWeather;
  const explicitColorSignals = extractColorHintSignals(
    audienceOptions.colorHints,
  );
  const inferredColorSignals = inferColorPreferenceSignals({
    wardrobeCanonicalColors,
    wardrobeColorFamilies,
    colorPalette: (styleProfile as any)?.color_palette,
  });
  const preferredColorHints =
    explicitColorSignals.colors.size > 0 || explicitColorSignals.families.size > 0
      ? new Set<string>([...inferredColorSignals.colors, ...explicitColorSignals.colors])
      : inferredColorSignals.colors;
  const preferredColorFamilies =
    explicitColorSignals.colors.size > 0 || explicitColorSignals.families.size > 0
      ? new Set<string>([...inferredColorSignals.families, ...explicitColorSignals.families])
      : inferredColorSignals.families;
  const preferredPatterns = topHistogramKeys(styleProfile?.pattern_histogram, 3);
  const preferredMaterials = topHistogramKeys(styleProfile?.material_histogram, 3);
  const preferredFormality =
    hintedOccasion || !styleProfile?.occasion_coverage?.length
      ? occasionToFormality(inferredOccasion)
      : inferPreferredFormality(styleProfile?.occasion_coverage || []);
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
    "color_palette_canonical",
    "attr_color",
    "attr_style",
    "attr_pattern",
    "attr_material",
    "attr_gender",
    "audience_gender",
    "age_group",
    "product_types",
  ];

  // Each category's ES retrieval is independent — running them concurrently
  // collapses the per-slot wall-time (2-4 ES round-trips × N slots) into a
  // single round-trip's worth of latency. Loop-body shared state
  // (suggestionsByCategory, requestTrace.slots) is keyed by category, so
  // parallel writes don't collide.
  await Promise.all(missingCategories.map(async (category) => {
    try {
      const perCategoryPool = Math.max(40, Math.ceil(limit / Math.max(missingCategories.length, 1)) * 10);
      const minPerCategory = Math.max(6, Math.ceil(limit / Math.max(1, missingCategories.length)));
      const canonical = wardrobeSlotToCategoryCanonical(category);

      const buildFilters = (applyPriceTier: boolean, includeSlotIntent: boolean = true): any[] => {
        const f: any[] = [
          // Allow BOTH in_stock and out_of_stock products (availability status doesn't affect outfit recommendations)
          { bool: { should: [{ term: { availability: "in_stock" } }, { term: { availability: "out_of_stock" } }], minimum_should_match: 1 } },
          { term: { category_canonical: canonical } },
        ];
        if (catalogFilters?.audience_gender) {
          f.push({ term: { audience_gender: catalogFilters.audience_gender } });
        }
        if (catalogFilters?.age_group) {
          f.push({ term: { age_group: catalogFilters.age_group } });
        }
        if (inferredAudienceGender && inferredAudienceGender !== "unisex") {
          f.push(buildAudienceGenderFilter(inferredAudienceGender));
        }
        if (inferredAgeGroup) {
          f.push(buildAgeGroupFilter(inferredAgeGroup));
        }
        const slotIntentFilter = includeSlotIntent ? buildSlotIntentFilter(category) : null;
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

      let slotCandidatesEvaluated = 0;
      let slotCandidatesRejected = 0;

      const scoreHits = (hits: any[], options: { relaxedFloor?: boolean } = {}): CompleteLookSuggestion[] => {
        const relaxedFloor = Boolean(options.relaxedFloor);
        const maxRawScore = Math.max(1, ...hits.map((h: any) => (Number.isFinite(h._score) ? h._score : 0)));
        const scored: CompleteLookSuggestion[] = [];

        for (const hit of hits) {
          const source = hit._source || {};
          slotCandidatesEvaluated += 1;
          if (!sourceMatchesSlot(category, source)) {
            slotCandidatesRejected += 1;
            continue;
          }
          const strongTitleSlot = inferStrongTitleSlot(source);
          if (strongTitleSlot && strongTitleSlot !== category) continue;
          if (!audienceGenderMatchesForSlot(inferredAudienceGender, source, category, enforceNeutralAudienceWhenUnknown, {
            allowUnknownForBags: category === "bags",
          })) continue;
          if (!audienceAgeGroupMatchesWithOptions(inferredAgeGroup, source, {
            allowUnknown: true,
          })) continue;
          const productId = parseInt(source.product_id, 10);
          if (!productId || ownedProductIds.has(String(productId))) continue;

          const embeddingNorm = Number.isFinite(hit._score) ? Math.min(1, hit._score / maxRawScore) : 0.35;
          const categoryCompat = computeCategoryCompatibility(
            category,
            currentCategoryList.length > 0 ? currentCategoryList : ["other"]
          );
          const candidateColor = extractCandidateColorFromSource(source);
          const colorDecisionAlignment = scoreSlotColorAlignment(
            category,
            candidateColor,
            wardrobeColorFamilies,
            currentCategoryList,
          );
          const bagColorAlignment = category === "bags" ? colorDecisionAlignment : 1;
          const colorHarmonyBase = computeColorHarmonyWithWardrobe(
            wardrobeColorFamilies,
            candidateColor,
            wardrobeCanonicalColors,
          );
          const colorPreferenceAlignment = scoreColorPreferenceAlignment(
            candidateColor,
            preferredColorHints,
            preferredColorFamilies,
          );
          // Color is the most user-visible signal in outfit completion: anchor
          // pair score gets the dominant weight, with slot-aware decision and
          // user-preferred color hints layered on top.
          const colorHarmony = Math.max(
            0,
            Math.min(1, colorHarmonyBase * 0.60 + colorDecisionAlignment * 0.24 + colorPreferenceAlignment * 0.16)
          );
          const styleAlignment = computeStyleAlignment(source, preferredStyleTerms);
          const patternAlignment = computeTokenAffinity(source.attr_pattern, preferredPatterns);
          const materialAlignment = computeTokenAffinity(source.attr_material, preferredMaterials);
          const formalityAlignment = computeFormalityAlignment(source, preferredFormality);
          let weatherAlignment = scoreWeatherAlignment(category, source, hintedWeather);
          const footwearStyleAlignment =
            category === "shoes"
              ? scoreFootwearStyleCompatibility(inferredOccasion, preferredStyleTerms, source)
              : 1;
          const footwearDressAlignment =
            category === "shoes"
              ? scoreFootwearDressAlignment(currentCategoryList, source)
              : 1;
          const bagStyleAlignment =
            category === "bags"
              ? scoreBagStyleCompatibility(inferredOccasion, preferredStyleTerms, source)
              : 1;
          const bottomSilhouetteAlignment =
            category === "bottoms"
              ? scoreBottomSilhouetteCompatibility({
                  currentItems,
                  currentCategoryList,
                  source,
                  inferredOccasion,
                  preferredStyleTerms,
                  preferredFormality,
                  weatherHint: hintedWeather,
                })
              : 1;
          const accessoryStyleAlignment =
            category === "accessories"
              ? scoreAccessoryStyleCompatibility(inferredOccasion, preferredStyleTerms, source)
              : 1;

          // Enforce style/occasion compatibility when we have a reliable style intent.
          if (preferredStyleTerms.length > 0 && styleAlignment < 0.52 && formalityAlignment < 0.5) {
            continue;
          }
          if (shouldEnforceStrictColorGate(category, currentCategoryList) && colorDecisionAlignment < 0.4) {
            continue;
          }
          // Hard color-clash gate: when the candidate is chromatic and clearly
          // clashes with the anchor's color (pair score < 0.5), drop it for
          // visible slots regardless of dress anchoring.
          if (
            (category === "bottoms" || category === "shoes" || category === "bags" || category === "outerwear") &&
            wardrobeCanonicalColors.size > 0 &&
            candidateColor &&
            colorHarmonyBase < 0.5
          ) {
            continue;
          }
          if ((preferredColorHints.size > 0 || preferredColorFamilies.size > 0) && colorPreferenceAlignment < 0.4) {
            continue;
          }
          if (hintedWeather && isWeatherIncompatibleForSlot(category, source, hintedWeather)) {
            continue;
          }
          if (category === "bottoms" && bottomSilhouetteAlignment < 0.34) {
            continue;
          }

          // Aesthetic keyword alignment: how well the product title matches
          // aesthetic-specific terms for this slot (e.g. "chunky sneakers" for
          // streetwear shoes). Treated as a proper scoring dimension (not a
          // multiplier) so items without explicit style words in their title
          // aren't systematically penalised.
          const titleBlob = String(source?.title || "").toLowerCase();
          const hasPrimaryTerms = slotQuerySpec.primaryTerms.length > 0;
          const primaryHits = slotQuerySpec.primaryTerms.filter((t) => titleBlob.includes(String(t || "").toLowerCase())).length;
          const boostHits = slotQuerySpec.boostTerms.filter((t) => titleBlob.includes(String(t || "").toLowerCase())).length;
          const avoidHits = slotQuerySpec.avoidTerms.filter((t) => titleBlob.includes(String(t || "").toLowerCase())).length;
          let aestheticKeywordAlignment: number;
          if (!hasPrimaryTerms) {
            // No aesthetic context — neutral score, no penalty.
            aestheticKeywordAlignment = 0.72;
          } else {
            const posDen = Math.max(1, slotQuerySpec.primaryTerms.length + 0.5 * slotQuerySpec.boostTerms.length);
            const positive = Math.min(1, (primaryHits + 0.5 * boostHits) / posDen);
            const avoidPenalty = slotQuerySpec.avoidTerms.length > 0 ? Math.min(1, avoidHits / Math.max(1, slotQuerySpec.avoidTerms.length)) : 0;
            // Range: 0.62 (no match, no avoid) → 1.0 (full match).
            // Avoid terms can reduce but not eliminate a good score.
            aestheticKeywordAlignment = Math.max(0.28, (0.62 + 0.38 * positive) * (1 - 0.5 * avoidPenalty));
          }

          // Weighted scoring: color compatibility carries the highest weight
          // because it is the most visible signal when the user evaluates an
          // outfit completion. Aesthetic keyword alignment remains a first-class
          // dimension so titles without explicit style words aren't penalised.
          const finalScore =
            embeddingNorm * 0.13 +
            categoryCompat * 0.13 +
            colorHarmony * 0.25 +
            styleAlignment * 0.16 +
            aestheticKeywordAlignment * 0.11 +
            patternAlignment * 0.05 +
            materialAlignment * 0.04 +
            formalityAlignment * 0.07 +
            weatherAlignment * 0.06;

          const slotStyleScore = Math.min(1, footwearStyleAlignment * bagStyleAlignment * bottomSilhouetteAlignment * accessoryStyleAlignment);
          const slotAwareFinalScore = Math.round((finalScore * (0.7 + slotStyleScore * 0.3) * footwearDressAlignment) * 1000) / 1000;

          const floor = relaxedFloor ? Math.max(0.32, minimumSlotScore(category) - 0.06) : minimumSlotScore(category);
          if (slotAwareFinalScore < floor) {
            continue;
          }

          const reasons: string[] = [];
          if (embeddingNorm >= 0.75) reasons.push("strong style similarity");
          if (categoryCompat >= 0.8) reasons.push("high category compatibility");
          if (colorHarmony >= 0.75) reasons.push("good color harmony");
          if (styleAlignment >= 0.75) reasons.push("style-aware match");
          if (formalityAlignment >= 0.8) reasons.push("occasion/formality aligned");
          if (weatherAlignment >= 0.78) reasons.push("weather appropriate");
          if (colorPreferenceAlignment >= 0.82) reasons.push("matches preferred colors");
          if (category === "shoes" && footwearStyleAlignment >= 0.85) reasons.push("footwear fits the occasion");
          if (category === "bags" && bagStyleAlignment >= 0.85) reasons.push("bag style suits the outfit");
          if (category === "bottoms" && bottomSilhouetteAlignment >= 0.82) reasons.push("bottom silhouette balances the anchor");
          if (category === "accessories" && accessoryStyleAlignment >= 0.82) reasons.push("accessories suit the occasion");
          if (reasons.length === 0) reasons.push("balances the current outfit");

          const fitBreakdown = {
            embeddingNorm: Math.round(embeddingNorm * 1000) / 1000,
            categoryCompat: Math.round(categoryCompat * 1000) / 1000,
            colorHarmony: Math.round(colorHarmony * 1000) / 1000,
            colorPreferenceAlignment: Math.round(colorPreferenceAlignment * 1000) / 1000,
            styleAlignment: Math.round(styleAlignment * 1000) / 1000,
            patternAlignment: Math.round(patternAlignment * 1000) / 1000,
            materialAlignment: Math.round(materialAlignment * 1000) / 1000,
            formalityAlignment: Math.round(formalityAlignment * 1000) / 1000,
            weatherAlignment: Math.round(weatherAlignment * 1000) / 1000,
            footwearStyleAlignment: Math.round(footwearStyleAlignment * 1000) / 1000,
            bagStyleAlignment: Math.round(bagStyleAlignment * 1000) / 1000,
            bagColorAlignment: Math.round(bagColorAlignment * 1000) / 1000,
            bottomSilhouetteAlignment: Math.round(bottomSilhouetteAlignment * 1000) / 1000,
            colorDecisionAlignment: Math.round(colorDecisionAlignment * 1000) / 1000,
            accessoryStyleAlignment: Math.round(accessoryStyleAlignment * 1000) / 1000,
          };

          scored.push({
            product_id: productId,
            title: source.title,
            brand: source.brand,
            category,
            price_cents:
              source.price_usd != null && Number.isFinite(Number(source.price_usd))
                ? Math.round(Number(source.price_usd) * 100)
                : undefined,
            image_url: source.image_cdn,
            image_cdn: source.image_cdn,
            score: slotAwareFinalScore,
            reason: `Add ${category} to complete the look (${reasons.join(", ")})`,
            reason_type: "compatible",
            fitBreakdown,
            stylistSignals: {
              slot: category,
              color: candidateColor,
              formalityScore: preferredFormalityToScore(inferCandidateFormality(source)),
              styleTokens: extractStyleTokensFromText(
                `${String(source.title || "")} ${String(source.category || "")} ${String(source.attr_style || "")}`
              ),
            },
            attributionTags: buildAttributionTags(fitBreakdown),
          });
        }

        return scored;
      };

      // Compute aesthetic-aware slot terms once per category (reused inside runSearch)
      const weatherCtx = resolveWeatherContext(hintedWeather?.temperatureC, hintedWeather?.season);
      const detectedAesthetic = inferPreferredAesthetic(preferredStyleTerms) as FashionAesthetic;
      const slotQuerySpecBase = getStyleAwareSlotTerms({
        aesthetic: detectedAesthetic,
        occasion: inferredOccasion as OutfitOccasion,
        sourceCategory: currentCategoryList[0] || "unknown",
        targetSlot: category,
        weather: weatherCtx,
      });
      const slotQuerySpec = mergeStylistDirectionIntoSlotQuery(
        slotQuerySpecBase,
        category,
        audienceOptions.stylistDirection,
      );
      if (slotQuerySpec.primaryTerms.length > 0) {
        console.info("[outfit-stylist]", {
          slot: category,
          aesthetic: detectedAesthetic,
          occasion: inferredOccasion,
          styleTerms: preferredStyleTerms.slice(0, 6),
          primaryTerms: slotQuerySpec.primaryTerms.slice(0, 4),
        });
      }

      const runSearch = async (filters: any[], useVector: boolean) => {
        const styleHint = preferredStyleTerms.slice(0, 4).join(" ").trim();
        const lexicalHint = `${canonical} ${styleHint}`.trim();

        // Build style-aware should clauses for lexical search
        const styleAwareShould: any[] = [
          // Broad fallback: generic category + style hint
          {
            multi_match: {
              query: lexicalHint,
              fields: ["title^3", "category^2", "brand", "attr_style", "attr_pattern", "attr_material"],
            },
          },
        ];
        // Primary aesthetic terms get a strong boost so they surface above generic matches
        for (const term of slotQuerySpec.primaryTerms.slice(0, 6)) {
          styleAwareShould.push({ match_phrase: { title: { query: term, boost: 4 } } });
        }
        // Secondary terms get a lighter boost
        for (const term of slotQuerySpec.boostTerms.slice(0, 4)) {
          styleAwareShould.push({ match_phrase: { title: { query: term, boost: 1.8 } } });
        }

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
                  should: styleAwareShould,
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

      /**
       * Aesthetic-targeted search: requires at least one specific style term to match.
       * This is the key fix for shoes/bags always returning the same generic items —
       * the KNN vector path retrieves visually similar items but ignores whether a shoe
       * is "strappy sandals" vs "combat boots". This search guarantees aesthetically
       * appropriate items reach the scoring pool regardless of embedding similarity.
       */
      const runAestheticSearch = async (filters: any[]): Promise<any[]> => {
        if (slotQuerySpec.primaryTerms.length === 0) return [];
        try {
          // Use `match` with `operator: "and"` instead of `match_phrase` so that
          // product titles with extra words still match.
          // e.g. "Women's Strappy Flat Sandals" matches "strappy sandals" because
          // both tokens appear in the title even though they aren't adjacent.
          const shouldClauses = [
            ...slotQuerySpec.primaryTerms.slice(0, 8).map((term) => ({
              match: { title: { query: term, operator: "and", boost: 3 } },
            })),
            ...slotQuerySpec.boostTerms.slice(0, 4).map((term) => ({
              match: { title: { query: term, operator: "and", boost: 1.5 } },
            })),
          ];
          const res = await osClient.search({
            index: config.opensearch.index,
            body: {
              size: perCategoryPool,
              query: {
                bool: {
                  filter: filters,
                  should: shouldClauses,
                  minimum_should_match: 1, // MUST match at least one aesthetic term
                },
              },
              sort: [{ _score: { order: "desc" } }, { last_seen_at: { order: "desc", missing: "_last" } }],
              _source: sourceFields,
            },
          });
          return res.body.hits.hits || [];
        } catch {
          return [];
        }
      };

      // Always run both the vector search and the aesthetic-targeted search in parallel.
      // The vector search finds visually similar items; the aesthetic search guarantees
      // style-appropriate items (e.g. "strappy sandals" for bohemian, "combat boots"
      // for edgy) are in the pool even when they aren't near the embedding centroid.
      let [hits, aestheticHits] = await Promise.all([
        runSearch(buildFilters(true), true),
        runAestheticSearch(buildFilters(true)),
      ]);
      let scored = dedupeCompleteLookSuggestions(
        scoreHits(hits).concat(scoreHits(aestheticHits)).sort((a, b) => b.score - a.score)
      );

      if (scored.length < minPerCategory) {
        const lexicalHits = await runSearch(buildFilters(true), false);
        scored = dedupeCompleteLookSuggestions(scored.concat(scoreHits(lexicalHits)).sort((a, b) => b.score - a.score));
      }
      if (scored.length === 0 && userPriceTier) {
        const [relaxedHits, relaxedAestheticHits] = await Promise.all([
          runSearch(buildFilters(false), true),
          runAestheticSearch(buildFilters(false)),
        ]);
        scored = dedupeCompleteLookSuggestions(
          scoreHits(relaxedHits).concat(scoreHits(relaxedAestheticHits)).sort((a, b) => b.score - a.score)
        );
        if (scored.length < minPerCategory) {
          const relaxedLexicalHits = await runSearch(buildFilters(false), false);
          scored = dedupeCompleteLookSuggestions(scored.concat(scoreHits(relaxedLexicalHits)).sort((a, b) => b.score - a.score));
        }
      }
      // Safety-net recall path: keep strict gender/age, but remove slot-intent filter
      // and relax floor slightly to prevent zero-result categories.
      if (scored.length < minPerCategory) {
        // Source-level slot guards are now precise enough to allow broad bag
        // recall; this prevents strict title intent filters from starving bags.
        const fallbackSlotIntentFilter = false;
        const recallVectorHits = await runSearch(buildFilters(fallbackSlotIntentFilter, false), true);
        const recallLexicalHits = await runSearch(buildFilters(fallbackSlotIntentFilter, false), false);
        scored = dedupeCompleteLookSuggestions(
          scored
            .concat(scoreHits(recallVectorHits, { relaxedFloor: true }))
            .concat(scoreHits(recallLexicalHits, { relaxedFloor: true }))
            .sort((a, b) => b.score - a.score)
        );
      }

      if (slotCandidatesEvaluated > 0) {
        const rejectionRate = slotCandidatesRejected / slotCandidatesEvaluated;
        outfitSlotRejectionRate.observe({ slot: category }, rejectionRate);
        if (slotCandidatesRejected > 0) {
          console.info("[complete-look][slot-guard]", {
            slot: category,
            evaluated: slotCandidatesEvaluated,
            rejected: slotCandidatesRejected,
            rejectionRate: Math.round(rejectionRate * 1000) / 1000,
          });
        }
      }

      scored.sort((a, b) => b.score - a.score);
      suggestionsByCategory.set(category, scored.slice(0, Math.max(minPerCategory * 2, 12)));
      requestTrace.slots[category] = {
        evaluated: slotCandidatesEvaluated,
        rejected: slotCandidatesRejected,
        returned: scored.length,
      };
    } catch (err) {
      console.error(`Error fetching ${category} suggestions:`, err);
      suggestionsByCategory.set(category, []);
      requestTrace.slots[category] = { evaluated: 0, rejected: 0, returned: 0 };
    }
  }));

  let mergedSuggestions = dedupeCompleteLookSuggestions(
    Array.from(suggestionsByCategory.values())
      .flat()
      .sort((a, b) => b.score - a.score)
  );
  mergedSuggestions = enforceVariantDiversity(mergedSuggestions, 2);

  if (mergedSuggestions.length < limit) {
    const topUp = await fetchCategoryTopUpSuggestions({
      missingCategories,
      ownedProductIds,
      existingProductIds: new Set(mergedSuggestions.map((s) => String(s.product_id))),
      preferredStyleTerms,
      preferredPatterns,
      preferredMaterials,
      preferredFormality,
      preferredColorHints,
      preferredColorFamilies,
      weatherHint: hintedWeather,
      inferredAudienceGender,
      inferredAgeGroup,
      enforceNeutralAudienceWhenUnknown,
      wardrobeColorFamilies,
      wardrobeCanonicalColors,
      currentCategoryList,
      needed: limit - mergedSuggestions.length,
    }).catch(() => []);
    if (topUp.length > 0) {
      mergedSuggestions = dedupeCompleteLookSuggestions(
        mergedSuggestions.concat(topUp).sort((a, b) => b.score - a.score)
      );
      mergedSuggestions = enforceVariantDiversity(mergedSuggestions, 2);
    }
  }

  mergedSuggestions = await rerankCompleteLookFashionAware({
    suggestions: mergedSuggestions,
    preferredStyleTerms,
    preferredFormality,
    inferredOccasion,
    wardrobeColorFamilies,
    wardrobeCanonicalColors,
    preferredColorHints,
    preferredColorFamilies,
    weatherHint: hintedWeather,
    currentCategoryList,
    inferredAudienceGender,
    inferredAgeGroup,
    limit,
  }).catch(() => mergedSuggestions);
  if (hintedWeather) {
    mergedSuggestions = mergedSuggestions.filter(
      (s) => !isWeatherIncompatibleForSlot(s.stylistSignals?.slot || s.category || "accessories", s, hintedWeather),
    );
  }
  mergedSuggestions = enforceVariantDiversity(mergedSuggestions, 2);

  // Outfit-level coherence: penalise cross-slot formality/aesthetic outliers
  // (e.g. formal blazer + beach sandals coexisting in the same set).
  mergedSuggestions = enforceOutfitCoherence(mergedSuggestions);
  mergedSuggestions = enforceVariantDiversity(mergedSuggestions, 2);

  mergedSuggestions = mergedSuggestions.slice(0, limit);
  requestTrace.finalReturned = mergedSuggestions.length;
  if (process.env.DEBUG_COMPLETE_STYLE === "1" || mergedSuggestions.length < Math.min(4, limit)) {
    console.info("[complete-look][trace]", requestTrace);
  }

  const outfitSets = buildOutfitSets(suggestionsByCategory, missingCategories);
  for (const set of outfitSets) {
    outfitSetCoherence.observe(set.coherenceScore);
  }

  outfitSuggestionsReturned.observe({ mode: completionMode }, mergedSuggestions.length);

  const groupedForNarrative = new Map<string, CompleteLookSuggestion[]>();
  for (const s of mergedSuggestions) {
    const key = normalizeWardrobeCategory(s.stylistSignals?.slot || s.category) || "accessories";
    const arr = groupedForNarrative.get(key) || [];
    arr.push(s);
    groupedForNarrative.set(key, arr);
  }

  const styleRecommendations: StyleRecommendation[] = Array.from(groupedForNarrative.entries()).map(
    ([slot, items]) => ({
      category: slot,
      priority: missingCategories.indexOf(slot) + 1 > 0 ? Math.min(3, missingCategories.indexOf(slot) + 1) : 2,
      reason: `Recommended ${slot} based on color/style/formality compatibility`,
      products: items.slice(0, 4).map((item) => ({
        id: item.product_id,
        title: item.title,
        brand: item.brand,
        category: item.category,
        color: item.stylistSignals?.color || undefined,
        price_cents: item.price_cents || 0,
        currency: "USD",
        image_url: item.image_url,
        image_cdn: item.image_cdn,
        matchScore: Math.round((item.score || 0) * 100),
        confidence: item.score || 0,
        matchReasons: [item.reason],
        explainability: {
          visualSimilarity: item.fitBreakdown?.embeddingNorm ?? 0,
          attributeMatch: item.fitBreakdown?.categoryCompat ?? 0,
          colorHarmony: item.fitBreakdown?.colorHarmony ?? 0,
          styleCompatibility: item.fitBreakdown?.styleAlignment ?? 0,
          occasionAlignment: item.fitBreakdown?.formalityAlignment ?? 0,
        },
      })),
    }),
  );

  const seedAnchor = currentItems[0];
  const narrativeAnchorCategory =
    normalizeWardrobeCategory((seedAnchor as any)?.detected_category) ||
    currentCategoryList[0] ||
    normalizeWardrobeCategory(seedAnchor?.category_name) ||
    "unknown";
  const seedProduct = {
    id: Number(seedAnchor?.product_id || seedAnchor?.id || 0),
    title: String(seedAnchor?.title || seedAnchor?.name || "Current item"),
    category: narrativeAnchorCategory,
    color: undefined,
    price_cents: 0,
    currency: "USD",
    image_url: String(seedAnchor?.image_url || "") || undefined,
    image_cdn: String(seedAnchor?.image_cdn || "") || undefined,
  };

  const styleForNarrative: StyleProfile = {
    occasion: inferredOccasion === "semi-formal" ? "semi-formal" : inferredOccasion,
    aesthetic: "modern",
    season: "all-season",
    colorProfile: {
      primary: "neutral",
      type: "neutral",
      harmonies: [{ type: "neutral", colors: ["neutral"] }],
    },
    formality: preferredFormalityToScore(preferredFormality),
  };

  const narrativeStart = Date.now();
  const outfitNarrative = await generateOutfitNarrativeWithCache({
    seedProduct,
    detectedCategory: narrativeAnchorCategory as ProductCategory,
    style: styleForNarrative,
    recommendations: styleRecommendations,
    userGender: seedAnchor?.gender,
    userAgeGroup: seedAnchor?.age_group,
  });
  outfitNarrativeLatencyMs.observe(
    { generated_by: outfitNarrative.generatedBy },
    Date.now() - narrativeStart,
  );
  applyNarrativeToProducts(styleRecommendations, outfitNarrative);

  const reasonById = new Map<number, string>();
  for (const rec of styleRecommendations) {
    for (const p of rec.products) {
      if (Array.isArray(p.matchReasons) && p.matchReasons.length > 0) {
        reasonById.set(p.id, p.matchReasons[0]);
      }
    }
  }
  mergedSuggestions = mergedSuggestions.map((s) => ({
    ...s,
    reason: reasonById.get(s.product_id) || s.reason,
  }));

  return {
    completionMode,
    suggestions: mergedSuggestions,
    outfitSets,
    missingCategories,
    outfitNarrative,
    inferredOccasion,
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
  // Order matters: check more specific/distinctive aesthetics first
  if (has("edgy")) return "edgy";
  if (has("streetwear")) return "streetwear";
  if (has("sporty") || has("athleisure")) return "sporty";
  if (has("bohemian") || has("boho")) return "bohemian";
  if (has("romantic") || has("chic")) return "romantic";
  if (has("minimalist")) return "minimalist";
  if (has("classic") || has("elegant")) return "classic";
  if (has("modern")) return "modern";
  if (has("business")) return "classic"; // business → classic for slot queries
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
  inferredOccasion?: InferredOccasion;
  wardrobeColorFamilies: Set<string>;
  wardrobeCanonicalColors: Set<string>;
  preferredColorHints: Set<string>;
  preferredColorFamilies: Set<string>;
  weatherHint?: WeatherHint;
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
    const categoryNorm = normalizeWardrobeCategory(s.stylistSignals?.slot || s.category || product.category) || "accessories";
    const categoryCompat = computeCategoryCompatibility(
      categoryNorm,
      params.currentCategoryList.length > 0 ? params.currentCategoryList : ["other"]
    );

    const candidateColor = normalizeColorName(product.color || style.colorProfile.primary);
    const colorHarmony = computeColorHarmonyWithWardrobe(
      params.wardrobeColorFamilies,
      candidateColor,
      params.wardrobeCanonicalColors,
    );
    const colorPreferenceAlignment = scoreColorPreferenceAlignment(
      candidateColor,
      params.preferredColorHints,
      params.preferredColorFamilies,
    );

    const styleTokenBlob = `${product.title} ${product.category || ""} ${style.aesthetic} ${style.occasion}`.toLowerCase();
    const styleTokenScore =
      params.preferredStyleTerms.length === 0
        ? 0.62
        : params.preferredStyleTerms.some((t) => t && styleTokenBlob.includes(t))
          ? 0.9
          : 0.46;

    const formalityScore = scoreFormalityCompatibility(targetFormalityScore, style.formality);
    const weatherSource = {
      title: product.title,
      category: product.category,
      attr_material: product.description,
      attr_style: style.aesthetic,
      product_types: style.occasion,
    };
    const weatherAlignment = scoreWeatherAlignment(categoryNorm, weatherSource, params.weatherHint);
    if (params.weatherHint && isWeatherIncompatibleForSlot(categoryNorm, weatherSource, params.weatherHint)) {
      return {
        ...s,
        score: 0,
        reason: `Filtered by weather rules`,
      };
    }
    const aestheticScore = aestheticCompatibility(preferredAesthetic, style.aesthetic as StyleProfileAesthetic);
    const baseRetrieval = Math.max(0, Math.min(1, Number(s.score || 0)));

    const fashionScore =
      categoryCompat * 0.22 +
      (colorHarmony * 0.65 + colorPreferenceAlignment * 0.35) * 0.18 +
      styleTokenScore * 0.22 +
      formalityScore * 0.18 +
      weatherAlignment * 0.12 +
      aestheticScore * 0.18;
    const slotForSanity = normalizeWardrobeCategory(s.stylistSignals?.slot || s.category || categoryNorm) || categoryNorm;
    const sanity = computeFashionSanityScore({
      slot: slotForSanity,
      source: row,
      preferredFormality: params.preferredFormality,
      inferredOccasion: params.inferredOccasion,
      currentCategoryList: params.currentCategoryList,
    });
    const final = Math.round((fashionScore * 0.72 + baseRetrieval * 0.28) * (0.62 + sanity * 0.38) * 1000) / 1000;
    const reasons: string[] = [];
    if (styleTokenScore >= 0.85) reasons.push("style-aligned");
    if (formalityScore >= 0.86) reasons.push("formality-consistent");
    if (aestheticScore >= 0.84) reasons.push("aesthetic-compatible");
    if (colorHarmony >= 0.78) reasons.push("harmonious palette");
    if (colorPreferenceAlignment >= 0.82) reasons.push("preferred-color aligned");
    if (weatherAlignment >= 0.78) reasons.push("weather-appropriate");
    if (reasons.length === 0) reasons.push("fashion-balanced");

    return {
      ...s,
      score: final,
      category: categoryNorm,
      reason: `Add ${categoryNorm} to complete the look (${reasons.join(", ")})`,
      stylistSignals: {
        slot: categoryNorm,
        color: candidateColor,
        formalityScore: style.formality,
        aesthetic: String(style.aesthetic || ""),
        styleTokens: extractStyleTokensFromText(
          `${product.title} ${product.category || ""} ${String(style.aesthetic || "")} ${String(style.occasion || "")}`
        ),
      },
    };
  }));
  const ranked = rescored.sort((a, b) => (b.score || 0) - (a.score || 0));
  return enforceFashionDiversity(ranked, params.limit);
}

/**
 * Complete look from existing wardrobe item IDs.
 */
export async function completeLookSuggestions(
  userId: number,
  currentItemIds: number[],
  limit: number = 10,
  requestCatalogFilters?: CompleteLookCatalogFilters,
  options: Pick<CompleteLookAudienceOptions, "audienceGenderHint" | "ageGroupHint" | "occasionHint" | "styleHints" | "colorHints" | "weatherHint"> = {}
): Promise<CompleteLookSuggestionsResult> {
  const currentItemsResult = await pg.query(
    `SELECT wi.id, wi.product_id, wi.embedding, wi.dominant_colors, wi.name, wi.image_url, wi.image_cdn,
            p.title,
            p.color,
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
     WHERE wi.id = ANY($1) AND wi.user_id = $2
     ORDER BY array_position($1::int[], wi.id)`,
    [currentItemIds, userId]
  );

  const currentItems = currentItemsResult.rows as CompleteLookAnchorRow[];
  const row = currentItems[0];
  const ag = requestCatalogFilters?.audience_gender ?? row?.audience_gender ?? undefined;
  const age = requestCatalogFilters?.age_group ?? row?.age_group ?? undefined;
  const effectiveFilters: CompleteLookCatalogFilters | undefined =
    ag || age
      ? {
          ...(ag ? { audience_gender: ag } : {}),
          ...(age ? { age_group: age } : {}),
        }
      : undefined;

  return await runCompleteLookCore(userId, currentItems, limit, effectiveFilters, "wardrobe", {
    audienceGenderHint: options.audienceGenderHint,
    ageGroupHint: options.ageGroupHint,
    occasionHint: options.occasionHint,
    styleHints: options.styleHints,
    colorHints: options.colorHints,
    weatherHint: options.weatherHint,
  });
}

/**
 * Complete look from catalog product IDs (used when user has no wardrobe item IDs yet).
 */
export async function completeLookSuggestionsForCatalogProducts(
  userId: number,
  productIds: number[],
  limit: number = 10,
  requestCatalogFilters?: CompleteLookCatalogFilters,
  options: Pick<CompleteLookAudienceOptions, "audienceGenderHint" | "ageGroupHint" | "occasionHint" | "styleHints" | "colorHints" | "weatherHint" | "stylistDirection"> & { detectedCategories?: Map<number, string> } = {}
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
            p.color,
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

  const ag = requestCatalogFilters?.audience_gender;
  const age = requestCatalogFilters?.age_group;
  const effectiveFilters: CompleteLookCatalogFilters | undefined =
    ag || age
      ? {
          ...(ag ? { audience_gender: ag } : {}),
          ...(age ? { age_group: age } : {}),
        }
      : undefined;

  return await runCompleteLookCore(userId, rows, limit, effectiveFilters, "catalog-product", {
    audienceGenderHint: options.audienceGenderHint,
    ageGroupHint: options.ageGroupHint,
    occasionHint: options.occasionHint,
    styleHints: options.styleHints,
    colorHints: options.colorHints,
    weatherHint: options.weatherHint,
    stylistDirection: options.stylistDirection,
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
  const filter: any[] = [
    // Allow BOTH in_stock and out_of_stock products
    { bool: { should: [{ term: { availability: "in_stock" } }, { term: { availability: "out_of_stock" } }], minimum_should_match: 1 } }
  ];
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

  // When inferred gender is null/unknown, avoid leaking explicitly gendered docs
  // when neutral enforcement is requested; otherwise allow broad matching.
  if (!inferred) {
    if (!enforceNeutralWhenUnknown) return true;
    if (doc && doc !== "unisex") return false;
    const fromTextUnknown = inferGenderFromText(textBlob);
    return !fromTextUnknown;
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
    if (/\b(duffle|luggage|suitcase|travel accessory|key ring|keychain)\b/.test(bagBlob)) {
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

  const warmHits = (blob.match(/\bt-?shirt\b|\btee\b|\bshort\s*sleeves?\b|\bsleeveless\b|\btank\b|\bshorts?\b|\bsandal\b|\bslipper\b|\blinen\b|\bbeach\b|\bresort\b/g) || []).length;
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

/** Coarse aesthetic family inferred from text — used for compatibility matrix. */
function inferAestheticFamily(blob: string): "athleisure" | "streetwear" | "formal" | "elegant" | "boho" | "minimalist" | "classic" | "modern" | "edgy" | null {
  const b = blob.toLowerCase();
  if (/\b(athletic|gym|workout|running|tennis|sport|sporty|track|jogger|sweatpant|hoodie|technical fabric)\b/.test(b)) return "athleisure";
  if (/\b(streetwear|street|graphic|skate|hype|oversized|baggy|cargo|distressed|hip[- ]?hop)\b/.test(b)) return "streetwear";
  if (/\b(tuxedo|black tie|formal gown|evening gown|cocktail dress|tailored suit|black-tie)\b/.test(b)) return "formal";
  if (/\b(elegant|cocktail|silk|satin|chiffon|pearl|lace|sequin|embellished)\b/.test(b)) return "elegant";
  if (/\b(boho|bohemian|fringe|crochet|tassel|paisley|kaftan|peasant|flowy|ethnic)\b/.test(b)) return "boho";
  if (/\b(minimalist|clean lines?|understated|simple|essential|basic)\b/.test(b)) return "minimalist";
  if (/\b(classic|preppy|tailored|oxford|loafer|cardigan|trench|polo)\b/.test(b)) return "classic";
  if (/\b(edgy|leather|stud|spike|punk|gothic|combat|moto|biker)\b/.test(b)) return "edgy";
  if (/\b(modern|contemporary|sleek|architectural)\b/.test(b)) return "modern";
  return null;
}

/** Mutual aesthetic compatibility — symmetric. 1.0 = perfect, 0.3 = clash. */
function aestheticFamilyCompatibility(a: string, b: string): number {
  if (a === b) return 1.0;
  const key = [a, b].sort().join("|");
  const matrix: Record<string, number> = {
    "classic|minimalist":   0.92,
    "classic|modern":       0.88,
    "classic|elegant":      0.86,
    "classic|formal":       0.82,
    "classic|streetwear":   0.50,
    "classic|athleisure":   0.42,
    "classic|edgy":         0.55,
    "classic|boho":         0.55,
    "elegant|formal":       0.92,
    "elegant|minimalist":   0.84,
    "elegant|modern":       0.82,
    "elegant|athleisure":   0.30,
    "elegant|streetwear":   0.32,
    "elegant|edgy":         0.62,
    "elegant|boho":         0.66,
    "formal|minimalist":    0.78,
    "formal|modern":        0.78,
    "formal|athleisure":    0.22,
    "formal|streetwear":    0.24,
    "formal|edgy":          0.55,
    "formal|boho":          0.40,
    "minimalist|modern":    0.92,
    "minimalist|athleisure": 0.70,
    "minimalist|streetwear": 0.66,
    "minimalist|edgy":      0.68,
    "minimalist|boho":      0.50,
    "modern|streetwear":    0.74,
    "modern|athleisure":    0.74,
    "modern|edgy":          0.78,
    "modern|boho":          0.58,
    "athleisure|streetwear": 0.86,
    "athleisure|edgy":      0.66,
    "athleisure|boho":      0.45,
    "boho|edgy":            0.58,
    "boho|streetwear":      0.55,
    "edgy|streetwear":      0.82,
  };
  return matrix[key] ?? 0.55;
}

function computeStyleAlignment(source: any, preferredStyleTerms: string[]): number {
  if (preferredStyleTerms.length === 0) return 0.62;
  const blob = `${String(source?.attr_style || "")} ${String(source?.title || "")} ${String(source?.category || "")} ${String(source?.product_types || "")}`.toLowerCase();
  if (!blob.trim()) return 0.62;

  // Hard mismatch detection: formal items for casual request and vice-versa.
  const styleSet = new Set(preferredStyleTerms.map((t) => String(t || "").toLowerCase().trim()));
  const isCasualStyle = styleSet.has("casual") || styleSet.has("streetwear") || styleSet.has("sporty") || styleSet.has("athleisure") || styleSet.has("boho") || styleSet.has("bohemian");
  const isFormalStyle = styleSet.has("formal") || styleSet.has("business") || styleSet.has("elegant");
  if (isCasualStyle && /\b(formal gown|evening gown|cocktail dress|black tie|tuxedo|tailored suit)\b/.test(blob)) return 0.30;
  if (isFormalStyle && /\b(athletic|skate|surf|streetwear graphic|sportswear|hoodie|sweatpant|jogger|track pant)\b/.test(blob)) return 0.34;

  // Direct token overlap: high reward when explicit.
  let directBest = 0;
  for (const token of preferredStyleTerms) {
    if (!token) continue;
    if (blob === token) directBest = Math.max(directBest, 0.94);
    else if (blob.includes(token)) directBest = Math.max(directBest, 0.84);
  }

  // Aesthetic-family compatibility: gives a richer signal even when titles
  // don't carry explicit style labels (most product titles don't).
  const candidateFamily = inferAestheticFamily(blob);
  let familyBest = 0;
  if (candidateFamily) {
    for (const token of preferredStyleTerms) {
      const t = String(token || "").toLowerCase().trim();
      if (!t) continue;
      const prefFamily =
        ["minimalist", "classic", "modern", "elegant", "formal", "boho", "bohemian", "edgy", "streetwear", "athleisure", "sporty", "athletic", "casual"].includes(t)
          ? (t === "bohemian" ? "boho" : t === "sporty" || t === "athletic" ? "athleisure" : t === "casual" ? null : t)
          : null;
      if (!prefFamily) continue;
      familyBest = Math.max(familyBest, aestheticFamilyCompatibility(prefFamily, candidateFamily));
    }
  }

  // If neither signal fired, default to neutral — most titles lack explicit style words.
  if (directBest === 0 && familyBest === 0) return 0.62;
  // Blend: direct token match dominates, but family compat fills the gap.
  return Math.max(directBest, familyBest);
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
  preferredColorHints: Set<string>;
  preferredColorFamilies: Set<string>;
  weatherHint?: WeatherHint;
  inferredAudienceGender: AudienceGender | null;
  inferredAgeGroup: AudienceAgeGroup | null;
  enforceNeutralAudienceWhenUnknown?: boolean;
  wardrobeColorFamilies: Set<string>;
  wardrobeCanonicalColors: Set<string>;
  currentCategoryList: string[];
  needed: number;
}): Promise<CompleteLookSuggestion[]> {
  if (params.needed <= 0 || params.missingCategories.length === 0) return [];
  const canonicalCategories = Array.from(
    new Set(params.missingCategories.map((c) => wardrobeSlotToCategoryCanonical(c)))
  );

  const filter: any[] = [
    // Allow BOTH in_stock and out_of_stock products
    { bool: { should: [{ term: { availability: "in_stock" } }, { term: { availability: "out_of_stock" } }], minimum_should_match: 1 } },
    { terms: { category_canonical: canonicalCategories } },
  ];
  const slotIntentFilters = params.missingCategories
    .map((slot) => buildSlotIntentFilter(slot))
    .filter((f): f is Record<string, any> => Boolean(f));
  if (slotIntentFilters.length > 0) {
    filter.push({ bool: { should: slotIntentFilters, minimum_should_match: 1 } });
  }
  if (params.inferredAudienceGender && params.inferredAudienceGender !== "unisex") {
    filter.push(buildAudienceGenderFilter(params.inferredAudienceGender));
  }
  if (params.inferredAgeGroup) {
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

  const topupOccasion: InferredOccasion =
    params.preferredFormality === "formal"
      ? "formal"
      : params.preferredFormality === "business"
        ? "semi-formal"
        : "casual";

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
        "color_palette_canonical",
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
    const strongTitleSlot = inferStrongTitleSlot(source);
    if (strongTitleSlot && strongTitleSlot !== matchedSlot) continue;
    if (!audienceGenderMatchesForSlot(
      params.inferredAudienceGender,
      source,
      matchedSlot,
      Boolean(params.enforceNeutralAudienceWhenUnknown),
      { allowUnknownForBags: categoryLabelToSlot(source.category_canonical || source.category) === "bags" }
    )) continue;
    if (!audienceAgeGroupMatchesWithOptions(params.inferredAgeGroup, source, {
      allowUnknown: categoryLabelToSlot(source.category_canonical || source.category) === "bags",
    })) continue;
    const productId = parseInt(source.product_id, 10);
    if (!productId) continue;
    const productKey = String(productId);
    if (params.ownedProductIds.has(productKey) || params.existingProductIds.has(productKey)) continue;

    const embeddingNorm = Number.isFinite(hit._score) ? Math.min(1, hit._score / maxRawScore) : 0.52;
    const categoryCompat = computeCategoryCompatibility(
      matchedSlot,
      params.currentCategoryList.length > 0 ? params.currentCategoryList : ["other"]
    );
    const candidateColor = extractCandidateColorFromSource(source);
    const colorDecisionAlignment = scoreSlotColorAlignment(
      matchedSlot,
      candidateColor,
      params.wardrobeColorFamilies,
      params.currentCategoryList,
    );
    const bagColorAlignment = matchedSlot === "bags" ? colorDecisionAlignment : 1;
    const colorHarmonyBase = computeColorHarmonyWithWardrobe(
      params.wardrobeColorFamilies,
      candidateColor,
      params.wardrobeCanonicalColors,
    );
    const colorPreferenceAlignment = scoreColorPreferenceAlignment(
      candidateColor,
      params.preferredColorHints,
      params.preferredColorFamilies,
    );
    const colorHarmony = Math.max(
      0,
      Math.min(1, colorHarmonyBase * 0.52 + colorDecisionAlignment * 0.28 + colorPreferenceAlignment * 0.2)
    );
    const styleAlignment = computeStyleAlignment(source, params.preferredStyleTerms);
    const patternAlignment = computeTokenAffinity(source.attr_pattern, params.preferredPatterns);
    const materialAlignment = computeTokenAffinity(source.attr_material, params.preferredMaterials);
    const formalityAlignment = computeFormalityAlignment(source, params.preferredFormality);
    let weatherAlignment = scoreWeatherAlignment(matchedSlot, source, params.weatherHint);
    const footwearStyleAlignment =
      matchedSlot === "shoes"
        ? scoreFootwearStyleCompatibility(topupOccasion, params.preferredStyleTerms, source)
        : 1;
    const footwearDressAlignment =
      matchedSlot === "shoes"
        ? scoreFootwearDressAlignment(params.currentCategoryList, source)
        : 1;
    const bagStyleAlignment =
      matchedSlot === "bags"
        ? scoreBagStyleCompatibility(topupOccasion, params.preferredStyleTerms, source)
        : 1;
    const accessoryStyleAlignment =
      matchedSlot === "accessories"
        ? scoreAccessoryStyleCompatibility(topupOccasion, params.preferredStyleTerms, source)
        : 1;

    if (shouldEnforceStrictColorGate(matchedSlot, params.currentCategoryList) && colorDecisionAlignment < 0.4) continue;
    if ((params.preferredColorHints.size > 0 || params.preferredColorFamilies.size > 0) && colorPreferenceAlignment < 0.4) continue;
    if (params.weatherHint && isWeatherIncompatibleForSlot(matchedSlot, source, params.weatherHint)) continue;

    const score =
      embeddingNorm * 0.24 +
      categoryCompat * 0.2 +
      colorHarmony * 0.18 +
      styleAlignment * 0.16 +
      patternAlignment * 0.08 +
      materialAlignment * 0.05 +
      formalityAlignment * 0.06 +
      weatherAlignment * 0.03;

    const slotStyleScore = Math.min(1, footwearStyleAlignment * bagStyleAlignment * accessoryStyleAlignment);
    const slotAwareScore = Math.round((score * (0.72 + slotStyleScore * 0.28) * footwearDressAlignment) * 1000) / 1000;

    if (slotAwareScore < minimumSlotScore(matchedSlot)) continue;

    out.push({
      product_id: productId,
      title: source.title,
      brand: source.brand,
      category: matchedSlot,
      price_cents:
        source.price_usd != null && Number.isFinite(Number(source.price_usd))
          ? Math.round(Number(source.price_usd) * 100)
          : undefined,
      image_url: source.image_cdn,
      image_cdn: source.image_cdn,
      score: slotAwareScore,
      reason: `Add ${matchedSlot} to complete the look (fashion-aware top-up match)`,
      reason_type: "compatible",
      fitBreakdown: {
        embeddingNorm: Math.round(embeddingNorm * 1000) / 1000,
        categoryCompat: Math.round(categoryCompat * 1000) / 1000,
        colorHarmony: Math.round(colorHarmony * 1000) / 1000,
        colorPreferenceAlignment: Math.round(colorPreferenceAlignment * 1000) / 1000,
        styleAlignment: Math.round(styleAlignment * 1000) / 1000,
        patternAlignment: Math.round(patternAlignment * 1000) / 1000,
        materialAlignment: Math.round(materialAlignment * 1000) / 1000,
        formalityAlignment: Math.round(formalityAlignment * 1000) / 1000,
        weatherAlignment: Math.round(weatherAlignment * 1000) / 1000,
        footwearStyleAlignment: Math.round(footwearStyleAlignment * 1000) / 1000,
        bagStyleAlignment: Math.round(bagStyleAlignment * 1000) / 1000,
        bagColorAlignment: Math.round(bagColorAlignment * 1000) / 1000,
        colorDecisionAlignment: Math.round(colorDecisionAlignment * 1000) / 1000,
        accessoryStyleAlignment: Math.round(accessoryStyleAlignment * 1000) / 1000,
      },
      stylistSignals: {
        slot: matchedSlot,
        color: candidateColor,
        formalityScore: preferredFormalityToScore(inferCandidateFormality(source)),
        styleTokens: extractStyleTokensFromText(
          `${String(source.title || "")} ${String(source.category || "")} ${String(source.attr_style || "")}`
        ),
      },
    });
  }

  return dedupeCompleteLookSuggestions(out.sort((a, b) => b.score - a.score)).slice(0, params.needed);
}

const COLOR_FAMILIES_BY_NAME: Record<string, string> = {
  black: "neutral",
  white: "neutral",
  "off-white": "neutral",
  cream: "neutral",
  ivory: "neutral",
  gray: "neutral",
  grey: "neutral",
  silver: "neutral",
  charcoal: "neutral",
  beige: "neutral",
  navy: "neutral",
  brown: "earth",
  tan: "earth",
  camel: "earth",
  khaki: "earth",
  rust: "earth",
  terracotta: "earth",
  mustard: "earth",
  blue: "blue",
  "light-blue": "blue",
  teal: "blue",
  cyan: "blue",
  aqua: "blue",
  turquoise: "blue",
  red: "red",
  maroon: "red",
  burgundy: "red",
  wine: "red",
  coral: "red",
  pink: "pink",
  fuchsia: "pink",
  magenta: "pink",
  blush: "pink",
  rose: "pink",
  green: "green",
  olive: "green",
  emerald: "green",
  sage: "green",
  mint: "green",
  yellow: "earth",
  orange: "earth",
  gold: "earth",
  purple: "purple",
  violet: "purple",
  lavender: "purple",
  lilac: "purple",
  plum: "purple",
};

/** Hue angle (0-360) and temperature for named colors — used for complementary/analogous scoring. */
const COLOR_HUE_MAP: Record<string, { hue: number; temp: "neutral" | "warm" | "cool" }> = {
  red:        { hue: 0,   temp: "warm" },
  coral:      { hue: 16,  temp: "warm" },
  orange:     { hue: 30,  temp: "warm" },
  rust:       { hue: 20,  temp: "warm" },
  terracotta: { hue: 18,  temp: "warm" },
  gold:       { hue: 50,  temp: "warm" },
  mustard:    { hue: 50,  temp: "warm" },
  yellow:     { hue: 60,  temp: "warm" },
  olive:      { hue: 80,  temp: "warm" },
  sage:       { hue: 110, temp: "cool" },
  green:      { hue: 120, temp: "cool" },
  mint:       { hue: 150, temp: "cool" },
  emerald:    { hue: 140, temp: "cool" },
  teal:       { hue: 180, temp: "cool" },
  turquoise:  { hue: 175, temp: "cool" },
  aqua:       { hue: 185, temp: "cool" },
  cyan:       { hue: 190, temp: "cool" },
  blue:       { hue: 210, temp: "cool" },
  navy:       { hue: 220, temp: "cool" },
  purple:     { hue: 270, temp: "cool" },
  violet:     { hue: 280, temp: "cool" },
  lavender:   { hue: 275, temp: "cool" },
  lilac:      { hue: 280, temp: "cool" },
  plum:       { hue: 300, temp: "cool" },
  magenta:    { hue: 300, temp: "cool" },
  fuchsia:    { hue: 315, temp: "cool" },
  pink:       { hue: 330, temp: "warm" },
  blush:      { hue: 340, temp: "warm" },
  rose:       { hue: 345, temp: "warm" },
  burgundy:   { hue: 345, temp: "warm" },
  maroon:     { hue: 340, temp: "warm" },
  wine:       { hue: 348, temp: "warm" },
};

/**
 * Named fashion color pairs with known compatibility scores.
 * Key is alphabetically sorted "colorA|colorB". Values 0-1 (1 = perfect match).
 * Covers the most common high-performing and clash combos in fashion styling.
 */
const NAMED_COLOR_PAIR_SCORE: Record<string, number> = {
  // Neutrals with chromatic colors — almost always safe
  "beige|black":    0.96,
  "beige|brown":    0.88,
  "beige|burgundy": 0.88,
  "beige|camel":    0.85,
  "beige|coral":    0.87,
  "beige|navy":     0.93,
  "beige|olive":    0.84,
  "beige|rust":     0.88,
  "beige|white":    0.93,
  "black|camel":    0.92,
  "black|gold":     0.90,
  "black|ivory":    0.94,
  "black|navy":     0.83,
  "black|pink":     0.88,
  "black|red":      0.87,
  "black|silver":   0.90,
  "black|white":    0.98,
  "brown|cream":    0.88,
  "brown|gold":     0.84,
  "brown|tan":      0.85,
  "brown|white":    0.87,
  "camel|cream":    0.88,
  "camel|navy":     0.92,
  "camel|white":    0.92,
  "cream|navy":     0.91,
  "cream|pink":     0.88,
  "cream|teal":     0.84,
  "cream|terracotta": 0.85,
  "gray|navy":      0.88,
  "gray|pink":      0.86,
  "gray|white":     0.91,
  "ivory|navy":     0.91,
  "khaki|navy":     0.88,
  "khaki|white":    0.90,
  // Classic chromatic pairs
  "blue|white":     0.93,
  "burgundy|camel": 0.92,
  "burgundy|cream": 0.88,
  "burgundy|gold":  0.86,
  "burgundy|gray":  0.82,
  "coral|navy":     0.88,
  "coral|white":    0.90,
  "emerald|gold":   0.88,
  "emerald|navy":   0.85,
  "emerald|white":  0.88,
  "gold|navy":      0.88,
  "gold|white":     0.86,
  "lavender|gray":  0.82,
  "lavender|white": 0.88,
  "mustard|navy":   0.88,
  "navy|orange":    0.87,
  "navy|red":       0.82,
  "navy|white":     0.96,
  "navy|yellow":    0.84,
  "olive|rust":     0.86,
  "olive|tan":      0.84,
  "olive|white":    0.83,
  "pink|white":     0.91,
  "pink|gray":      0.85,
  "red|white":      0.88,
  "rust|cream":     0.87,
  "rust|navy":      0.84,
  "tan|white":      0.90,
  "teal|coral":     0.87,
  "teal|white":     0.88,
  "terracotta|white": 0.84,
  "white|yellow":   0.83,
  // Tricky pairs — decent but need care
  "green|orange":   0.74,
  "mustard|olive":  0.78,
  "navy|burgundy":  0.79,
  "purple|yellow":  0.76,
  // Known clashing combos
  "orange|pink":    0.35,
  "red|orange":     0.40,
  "green|purple":   0.38,
  "red|pink":       0.42,
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
    tailored: "tailored",
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

function normalizeStyleHints(hints?: string[] | null): string[] {
  if (!Array.isArray(hints)) return [];
  const allow = new Set(STYLE_TERMS_LEXICON as readonly string[]);
  const out = new Set<string>();
  for (const raw of hints) {
    const token = String(raw || "").toLowerCase().trim();
    if (!token) continue;
    if (allow.has(token)) out.add(token);
  }
  return Array.from(out).slice(0, 12);
}

function inferOccasionFromCoverageSignals(
  occasionCoverage: string[],
  preferredStyleTerms: string[],
  currentItems: CompleteLookAnchorRow[],
): InferredOccasion | null {
  const score: Record<InferredOccasion, number> = {
    formal: 0,
    "semi-formal": 0,
    casual: 0,
    active: 0,
    party: 0,
    beach: 0,
  };

  for (const occ of occasionCoverage || []) {
    const normalized = normalizeOccasionHint(occ);
    if (normalized) score[normalized] += 2;
  }

  for (const t of preferredStyleTerms || []) {
    if (t === "sporty" || t === "athleisure") score.active += 1.8;
    if (t === "business" || t === "classic") score["semi-formal"] += 1.4;
    if (t === "formal" || t === "elegant") score.formal += 1.6;
    if (t === "streetwear" || t === "casual") score.casual += 1.2;
    if (t === "chic" || t === "romantic") score.party += 0.9;
  }

  const text = currentItems
    .map((i) => `${String(i.name || "")} ${String(i.title || "")} ${String(i.category_name || "")}`)
    .join(" ")
    .toLowerCase();

  if (/\b(gym|athletic|training|running|jogger|activewear|track|sport)\b/.test(text)) score.active += 2.2;
  if (/\b(tuxedo|gown|cocktail|sequin|evening|party|heels?|clutch)\b/.test(text)) score.party += 2.1;
  if (/\b(office|work|blazer|shirt|trouser|loafer|tailored)\b/.test(text)) score["semi-formal"] += 1.8;
  if (/\b(formal|wedding|black tie)\b/.test(text)) score.formal += 1.8;
  if (/\b(beach|resort|swim|sandals?|linen shorts?)\b/.test(text)) score.beach += 2.1;
  if (/\b(jeans|tee|hoodie|everyday|casual)\b/.test(text)) score.casual += 1.1;

  let winner: InferredOccasion | null = null;
  let best = 0;
  for (const key of Object.keys(score) as InferredOccasion[]) {
    if (score[key] > best) {
      best = score[key];
      winner = key;
    }
  }

  return best >= 1.8 ? winner : null;
}

function inferWeatherHintFromContext(params: {
  currentItems: CompleteLookAnchorRow[];
  seasonCoverage: string[];
  inferredOccasion: InferredOccasion;
}): WeatherHint | undefined {
  const seasonCounts: Record<WeatherSeason, number> = {
    spring: 0,
    summer: 0,
    fall: 0,
    winter: 0,
  };
  for (const s of params.seasonCoverage || []) {
    const v = String(s || "").toLowerCase().trim();
    if (v === "spring") seasonCounts.spring += 1;
    if (v === "summer") seasonCounts.summer += 1;
    if (v === "fall" || v === "autumn") seasonCounts.fall += 1;
    if (v === "winter") seasonCounts.winter += 1;
  }

  const text = params.currentItems
    .map((i) => `${String(i.name || "")} ${String(i.title || "")} ${String(i.category_name || "")}`)
    .join(" ")
    .toLowerCase();

  const coldHits = (text.match(/\b(wool|coat|jacket|parka|puffer|sweater|hoodie|boots?|thermal|cashmere)\b/g) || []).length;
  const hotHits = (text.match(/\b(shorts?|short\s*sleeves?|tank|sleeveless|linen|sandals?|slides?|beach|resort|lightweight)\b/g) || []).length;

  let season: WeatherSeason | undefined;
  let bestSeason = 0;
  for (const k of ["spring", "summer", "fall", "winter"] as WeatherSeason[]) {
    if (seasonCounts[k] > bestSeason) {
      bestSeason = seasonCounts[k];
      season = k;
    }
  }

  if (!season) {
    if (coldHits >= hotHits + 1) season = "winter";
    else if (hotHits >= coldHits + 1) season = "summer";
  }
  if (!season && params.inferredOccasion === "beach") season = "summer";

  let temperatureC: number | undefined;
  if (season === "winter") temperatureC = 7;
  else if (season === "fall") temperatureC = 16;
  else if (season === "spring") temperatureC = 18;
  else if (season === "summer") temperatureC = 30;

  if (temperatureC !== undefined) {
    temperatureC += Math.min(7, hotHits * 1.5);
    temperatureC -= Math.min(7, coldHits * 1.5);
    temperatureC = Math.max(-10, Math.min(42, temperatureC));
  }

  if (temperatureC === undefined && !season) return undefined;
  return { temperatureC, season };
}

function inferColorPreferenceSignals(params: {
  wardrobeCanonicalColors: Set<string>;
  wardrobeColorFamilies: Set<string>;
  colorPalette?: Array<{ hex?: string; weight?: number }> | null;
}): { colors: Set<string>; families: Set<string> } {
  const colorScores = new Map<string, number>();
  const familyScores = new Map<string, number>();

  for (const color of params.wardrobeCanonicalColors) {
    colorScores.set(color, (colorScores.get(color) || 0) + 1);
    const fam = COLOR_FAMILIES_BY_NAME[color];
    if (fam) familyScores.set(fam, (familyScores.get(fam) || 0) + 1);
  }

  for (const palette of params.colorPalette || []) {
    const canonical = palette?.hex ? mapHexToFashionCanonical(palette.hex) : null;
    if (!canonical) continue;
    const w = Number.isFinite(Number(palette?.weight)) ? Math.max(0.15, Number(palette?.weight)) : 0.25;
    colorScores.set(canonical, (colorScores.get(canonical) || 0) + w);
    const fam = COLOR_FAMILIES_BY_NAME[canonical];
    if (fam) familyScores.set(fam, (familyScores.get(fam) || 0) + w);
  }

  for (const fam of params.wardrobeColorFamilies) {
    familyScores.set(fam, (familyScores.get(fam) || 0) + 0.4);
  }

  const colors = new Set(
    Array.from(colorScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([k]) => k)
  );
  const families = new Set(
    Array.from(familyScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k]) => k)
  );

  return { colors, families };
}

function normalizeWeatherHint(input?: WeatherHint | null): WeatherHint | undefined {
  if (!input) return undefined;
  const out: WeatherHint = {};
  const temp = Number(input.temperatureC);
  if (Number.isFinite(temp)) {
    out.temperatureC = Math.max(-25, Math.min(50, temp));
  }
  const season = String(input.season || "").toLowerCase().trim();
  if (season === "spring" || season === "summer" || season === "fall" || season === "winter") {
    out.season = season;
  }
  return out.temperatureC !== undefined || out.season ? out : undefined;
}

function extractColorHintSignals(colorHints?: string[] | null): { colors: Set<string>; families: Set<string> } {
  const colors = new Set<string>();
  const families = new Set<string>();
  if (!Array.isArray(colorHints)) return { colors, families };

  for (const raw of colorHints) {
    const normalized = normalizeColorName(String(raw || ""));
    if (!normalized) continue;
    colors.add(normalized);
    const fam = COLOR_FAMILIES_BY_NAME[normalized];
    if (fam) families.add(fam);
  }
  return { colors, families };
}

function scoreColorPreferenceAlignment(
  candidateColor: string | null,
  preferredColors: Set<string>,
  preferredFamilies: Set<string>,
): number {
  if (preferredColors.size === 0 && preferredFamilies.size === 0) return 0.64;
  if (!candidateColor) return 0.42;
  // Exact color match
  if (preferredColors.has(candidateColor)) return 0.96;
  const family = COLOR_FAMILIES_BY_NAME[candidateColor] || "other";
  // Neutral candidate — always safe alongside preferred colors
  if (family === "neutral") return 0.74;
  // Same color family as a preferred color
  if (preferredFamilies.has(family)) return 0.86;
  // Check if this candidate harmonizes with any specific preferred color via
  // the named pair table or hue math (complementary/analogous welcome)
  const candidateHue = COLOR_HUE_MAP[candidateColor];
  if (candidateHue) {
    let bestPairScore = 0;
    for (const pref of preferredColors) {
      const pairKey = [candidateColor, pref].sort().join("|");
      const named = NAMED_COLOR_PAIR_SCORE[pairKey];
      if (named !== undefined) {
        bestPairScore = Math.max(bestPairScore, named);
        continue;
      }
      const prefHue = COLOR_HUE_MAP[pref];
      if (!prefHue) continue;
      const diff = Math.abs(candidateHue.hue - prefHue.hue);
      const hueDist = Math.min(diff, 360 - diff);
      if (hueDist < 55) bestPairScore = Math.max(bestPairScore, 0.80);
      else if (hueDist >= 155 && hueDist <= 205) bestPairScore = Math.max(bestPairScore, 0.78);
    }
    if (bestPairScore >= 0.76) return Math.min(0.92, bestPairScore);
  }
  return 0.38;
}

function scoreWeatherAlignment(slotRaw: string, source: any, weatherHint?: WeatherHint): number {
  if (!weatherHint || (weatherHint.temperatureC === undefined && !weatherHint.season)) return 0.66;
  const slot = normalizeWardrobeCategory(slotRaw) || slotRaw;
  const blob = `${String(source?.title || "")} ${String(source?.category || "")} ${String(source?.attr_material || "")} ${String(source?.attr_style || "")} ${String(source?.product_types || "")}`.toLowerCase();
  const hasHeavySignal = /\b(wool|fleece|puffer|thermal|down|cashmere|heavy|coat|parka|snow|fur-lined|insulated|boots?)\b/.test(blob);
  const hasLightSignal = /\b(linen|cotton|breathable|airy|shorts?|tank|sleeveless|short\s*sleeves?|t-?shirt|tee|sandal|slides?|espadrille|beach|resort)\b/.test(blob);
  const hasRainSignal = /\b(rain|waterproof|windbreaker|trench)\b/.test(blob);

  let score = 0.7;
  const t = weatherHint.temperatureC;
  if (Number.isFinite(t)) {
    if ((t as number) >= 30) {
      if (slot === "outerwear") score -= 0.52;
      if (slot === "shoes" && /\b(boots?)\b/.test(blob)) score -= 0.32;
      if (hasHeavySignal) score -= 0.34;
      if (hasLightSignal) score += 0.18;
    } else if ((t as number) >= 24) {
      if (slot === "outerwear") score -= 0.34;
      if (hasHeavySignal) score -= 0.2;
      if (hasLightSignal) score += 0.12;
    } else if ((t as number) <= 8) {
      if (slot === "outerwear") score += 0.2;
      if (slot === "shoes" && /\b(sandal|slides?|espadrille)\b/.test(blob)) score -= 0.36;
      if (hasHeavySignal) score += 0.2;
      if (hasLightSignal) score -= 0.2;
    } else if ((t as number) <= 14) {
      if (slot === "outerwear") score += 0.12;
      if (hasHeavySignal) score += 0.08;
      if (hasLightSignal) score -= 0.08;
    }
  }

  if (weatherHint.season === "summer") {
    if (slot === "outerwear") score -= 0.34;
    if (hasHeavySignal) score -= 0.22;
    if (hasLightSignal) score += 0.12;
  }
  if (weatherHint.season === "winter") {
    if (slot === "outerwear") score += 0.16;
    if (hasHeavySignal) score += 0.14;
    if (hasLightSignal) score -= 0.18;
  }
  if (weatherHint.season === "fall" || weatherHint.season === "spring") {
    if (slot === "outerwear") score += hasRainSignal ? 0.12 : 0.06;
  }

  return Math.max(0.2, Math.min(1, score));
}

function isWeatherIncompatibleForSlot(slotRaw: string, source: any, weatherHint?: WeatherHint): boolean {
  if (!weatherHint || (weatherHint.temperatureC === undefined && !weatherHint.season)) return false;
  const slot = normalizeWardrobeCategory(slotRaw) || slotRaw;
  const blob = `${String(source?.title || "")} ${String(source?.category || "")} ${String(source?.attr_material || "")} ${String(source?.attr_style || "")} ${String(source?.product_types || "")}`.toLowerCase();
  const weather = resolveWeatherContext(weatherHint.temperatureC, weatherHint.season);
  const isHot = weather === "hot";
  const isWarm = weather === "warm";
  const isCool = weather === "cool";
  const isCold = weather === "cold";
  const coldAccessory = /\b(scarf|scarves|beanie|earmuffs?|gloves?|mittens?|wool hat|knit hat|winter hat)\b/.test(blob);
  const heavyOuterwear = /\b(puffer|parka|heavy coat|winter coat|wool coat|down jacket|fur[-\s]?lined|insulated|blazer|jacket|coat)\b/.test(blob);
  const winterBoot = /\b(snow boots?|winter boots?|fur[-\s]?lined boots?|insulated boots?|combat boots?)\b/.test(blob);
  const summerFootwear = /\b(sandal|sandals|slides?|flip flop|flip-flop|espadrille|open toe|open-toe)\b/.test(blob);
  const coldTop = /\b(tank|sleeveless|strapless|halter|cami|tube top|short\s*sleeves?|short[-\s]?sleeve|t-?shirt|tee)\b/.test(blob);
  const coldBottom = /\b(shorts?|bermuda|skort)\b/.test(blob);
  const heavyTop = /\b(wool sweater|chunky knit|heavy knit|fleece|thermal|hoodie|sweatshirt|cardigan)\b/.test(blob);

  if ((isHot || isWarm) && slot === "accessories" && coldAccessory) return true;
  if (isHot && slot === "outerwear") return true;
  if (isWarm && slot === "outerwear" && heavyOuterwear) return true;
  if ((isHot || isWarm) && slot === "shoes" && winterBoot) return true;
  if ((isCool || isCold) && slot === "shoes" && summerFootwear) return true;
  if ((isCool || isCold) && slot === "tops" && coldTop) return true;
  if (isCold && slot === "bottoms" && coldBottom) return true;
  if (isHot && slot === "tops" && heavyTop) return true;
  if (isHot && slot === "bottoms" && /\b(thermal pants?|wool pants?|fleece pants?)\b/.test(blob)) return true;
  return false;
}

function extractCandidateColorFromSource(source: any): string | null {
  const primary = normalizeColorName(source?.color_primary_canonical || source?.attr_color);
  if (primary) return primary;
  const palette = Array.isArray(source?.color_palette_canonical) ? source.color_palette_canonical : [];
  for (const p of palette) {
    const normalized = normalizeColorName(String(p || ""));
    if (normalized) return normalized;
  }
  const titleColor = normalizeColorName(String(source?.title || ""));
  if (titleColor) return titleColor;
  return null;
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

function extractWardrobeColorFamilies(items: Array<{
  dominant_colors?: Array<{ hex?: string }>;
  color?: string | null;
  title?: string | null;
  name?: string | null;
  category_name?: string | null;
}>): Set<string> {
  const families = new Set<string>();
  const addColorHintsFromText = (text?: string | null) => {
    const raw = String(text || "").toLowerCase().trim();
    if (!raw) return;
    const parts = raw.split(/[^a-z]+/).filter(Boolean);
    for (const part of parts) {
      const normalized = normalizeColorName(part);
      if (!normalized) continue;
      const family = COLOR_FAMILIES_BY_NAME[normalized];
      if (family) families.add(family);
    }
  };
  for (const item of items) {
    const namedColor = normalizeColorName(item.color || undefined);
    if (namedColor) {
      const namedFamily = COLOR_FAMILIES_BY_NAME[namedColor];
      if (namedFamily) families.add(namedFamily);
    }
    addColorHintsFromText(item.title);
    addColorHintsFromText(item.name);
    addColorHintsFromText(item.category_name);

    if (!item.dominant_colors || !Array.isArray(item.dominant_colors)) continue;
    for (const c of item.dominant_colors) {
      if (!c?.hex) continue;
      const pipelineCanonical = mapHexToFashionCanonical(c.hex);
      if (pipelineCanonical) {
        const family = COLOR_FAMILIES_BY_NAME[pipelineCanonical];
        if (family) families.add(family);
      }
      const rgb = hexToRgb(c.hex);
      if (!rgb) continue;
      families.add(rgbToFamily(rgb.r, rgb.g, rgb.b));
    }
  }
  return families;
}

function extractWardrobeCanonicalColors(items: Array<{
  dominant_colors?: Array<{ hex?: string }>;
  color?: string | null;
}>): Set<string> {
  const out = new Set<string>();
  for (const item of items) {
    const named = normalizeColorName(item.color || undefined);
    if (named) out.add(named);
    if (!Array.isArray(item.dominant_colors)) continue;
    for (const c of item.dominant_colors) {
      if (!c?.hex) continue;
      const canonical = mapHexToFashionCanonical(c.hex);
      if (canonical) out.add(canonical);
    }
  }
  return out;
}

function computeCategoryCompatibility(targetCategory: string, currentCategories: string[]): number {
  if (currentCategories.length === 0) return 0.6;
  const target = normalizeWardrobeCategory(targetCategory) || targetCategory;
  let best = 0.45;
  for (const raw of currentCategories) {
    const current = normalizeWardrobeCategory(raw) || raw;
    if (target === current) {
      best = Math.max(best, target === "accessories" ? 0.75 : 0.9);
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

function computeColorHarmonyWithWardrobe(
  wardrobeFamilies: Set<string>,
  candidateColor: string | null,
  wardrobeCanonicalColors?: Set<string>,
): number {
  if (wardrobeFamilies.size === 0) return 0.6;
  if (!candidateColor) return 0.52;
  if (wardrobeCanonicalColors && wardrobeCanonicalColors.size > 0) {
    let bestPair = 0.45;
    for (const anchorColor of wardrobeCanonicalColors) {
      bestPair = Math.max(bestPair, scoreColorPair(anchorColor, candidateColor));
    }
    // Blend exact color-pair harmony with family-level harmony.
    const familyBase = computeColorHarmonyWithWardrobe(wardrobeFamilies, candidateColor, undefined);
    return Math.max(0, Math.min(1, bestPair * 0.65 + familyBase * 0.35));
  }
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
  return 0.46;
}

function scoreSlotColorAlignment(
  slot: string,
  candidateColor: string | null,
  wardrobeFamilies: Set<string>,
  currentCategoryList: string[],
): number {
  if (!candidateColor) return 0.55;
  const family = COLOR_FAMILIES_BY_NAME[candidateColor] || "other";
  const normalizedSlot = normalizeWardrobeCategory(slot) || slot;
  const hasDressAnchor = currentCategoryList.includes("dresses");

  // Universal: neutral candidates are safe choices for every slot.
  if (family === "neutral") return 0.95;

  // Dress-led looks: tighter rules for the slots most visible alongside a dress.
  if (hasDressAnchor) {
    if (family === "pink") return normalizedSlot === "shoes" ? 0.84 : 0.88;
    if (family === "earth") return normalizedSlot === "accessories" ? 0.76 : 0.8;
    if (family === "blue") return normalizedSlot === "accessories" ? 0.68 : 0.74;
    if (family === "red") return normalizedSlot === "bags" || normalizedSlot === "accessories" ? 0.4 : 0.5;
    if (family === "green") return normalizedSlot === "bags" || normalizedSlot === "accessories" ? 0.36 : 0.48;
    return 0.52;
  }

  // Top + bottom looks: bottoms should harmonise tightly with the existing
  // wardrobe palette; shoes should not clash with the bottom; bags can be a
  // contrast piece but should still avoid hard clashes.
  const baseHarmony = computeColorHarmonyWithWardrobe(wardrobeFamilies, candidateColor);
  if (normalizedSlot === "bottoms") {
    // Bottoms anchor the lower half — stricter on chromatic clashes.
    if (baseHarmony >= 0.82) return Math.min(0.95, baseHarmony + 0.04);
    if (baseHarmony < 0.55) return Math.max(0.30, baseHarmony - 0.10);
    return baseHarmony;
  }
  if (normalizedSlot === "shoes") {
    // Shoes rarely clash with neutrals; a mid clash with chromatic anchor is harsh.
    if (baseHarmony < 0.5) return Math.max(0.28, baseHarmony - 0.12);
    return baseHarmony;
  }
  if (normalizedSlot === "bags") {
    // Allow bags a wider contrast envelope but still penalise clear clashes.
    if (baseHarmony < 0.45) return Math.max(0.30, baseHarmony - 0.08);
    return baseHarmony;
  }
  return baseHarmony;
}

function shouldEnforceStrictColorGate(slot: string, currentCategoryList: string[]): boolean {
  const normalizedSlot = normalizeWardrobeCategory(slot) || slot;
  const hasDressAnchor = currentCategoryList.includes("dresses");
  // Strict anti-clash gating: dress-led looks plus the visually dominant
  // outfit slots (shoes, bottoms, bags). These are the pieces where the
  // wrong color is most obvious in the final outfit.
  if (hasDressAnchor) {
    return (
      normalizedSlot === "bags" ||
      normalizedSlot === "accessories" ||
      normalizedSlot === "shoes"
    );
  }
  return (
    normalizedSlot === "shoes" ||
    normalizedSlot === "bottoms" ||
    normalizedSlot === "bags"
  );
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
      if (scored.coherenceScore < 0.58) {
        return;
      }
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
  const ranked = results.sort((a, b) => b.totalScore - a.totalScore);
  const selected: OutfitSetSuggestion[] = [];
  const maxSets = 5;
  const maxJaccard = 0.4;

  for (const candidate of ranked) {
    const c = new Set(candidate.productIds.map((id) => String(id)));
    const tooSimilar = selected.some((picked) => {
      const p = new Set(picked.productIds.map((id) => String(id)));
      let overlap = 0;
      for (const id of c) {
        if (p.has(id)) overlap += 1;
      }
      const union = c.size + p.size - overlap;
      const jaccard = union > 0 ? overlap / union : 1;
      return jaccard >= maxJaccard;
    });

    if (!tooSimilar) {
      selected.push(candidate);
      if (selected.length >= maxSets) break;
    }
  }

  return selected;
}

function scoreColorPair(colorA: string | null | undefined, colorB: string | null | undefined): number {
  const a = normalizeColorName(colorA || undefined);
  const b = normalizeColorName(colorB || undefined);
  if (!a || !b) return 0.56;
  // Monochromatic — same named color, always cohesive
  if (a === b) return 0.90;

  // Named pair lookup wins when available (covers the most fashion-relevant combos)
  const pairKey = [a, b].sort().join("|");
  const namedScore = NAMED_COLOR_PAIR_SCORE[pairKey];
  if (namedScore !== undefined) return namedScore;

  const familyA = COLOR_FAMILIES_BY_NAME[a] || "other";
  const familyB = COLOR_FAMILIES_BY_NAME[b] || "other";

  // Neutrals go with everything
  if (familyA === "neutral" || familyB === "neutral") return 0.90;

  // Hue-based scoring for pairs not in the named table
  const hueA = COLOR_HUE_MAP[a];
  const hueB = COLOR_HUE_MAP[b];
  if (hueA && hueB) {
    const diff = Math.abs(hueA.hue - hueB.hue);
    const hueDist = Math.min(diff, 360 - diff);
    // Monochromatic zone (< 25°): same hue family, very cohesive
    if (hueDist < 25) return 0.84;
    // Analogous zone (25–55°): adjacent on wheel, harmonious
    if (hueDist < 55) return 0.80;
    // Complementary zone (155–205°): opposite sides, high-contrast fashion staple
    if (hueDist >= 155 && hueDist <= 205) return 0.82;
    // Split-complementary / triadic zone (110–145° or 215–250°): creative, trendy
    if ((hueDist >= 110 && hueDist <= 145) || (hueDist >= 215 && hueDist <= 250)) return 0.75;
    // Warm-cool tension without clear harmony
    if (hueA.temp !== hueB.temp) return 0.58;
  }

  // Family-level fallback
  if (familyA === familyB) return 0.82;
  const complementaryFamilies: Record<string, string[]> = {
    blue:   ["earth", "red", "green"],
    green:  ["pink", "red", "earth"],
    red:    ["blue", "green"],
    earth:  ["blue", "green"],
    pink:   ["green", "blue"],
    purple: ["earth", "green"],
  };
  if ((complementaryFamilies[familyA] || []).includes(familyB)) return 0.74;
  return 0.52;
}

function scoreStyleTokenOverlap(a: string[] | undefined, b: string[] | undefined): number {
  const aa = new Set((a || []).map((x) => String(x || "").toLowerCase().trim()).filter(Boolean));
  const bb = new Set((b || []).map((x) => String(x || "").toLowerCase().trim()).filter(Boolean));
  if (aa.size === 0 || bb.size === 0) return 0.62;
  let overlap = 0;
  for (const t of aa) {
    if (bb.has(t)) overlap += 1;
  }
  const union = aa.size + bb.size - overlap;
  if (union <= 0) return 0.62;
  const jaccard = overlap / union;
  return 0.44 + jaccard * 0.56;
}

function inferFashionArchetype(slot: string, text: string): string {
  const s = text.toLowerCase();
  const normalizedSlot = normalizeWardrobeCategory(slot) || slot;
  if (normalizedSlot === "shoes") {
    if (/\b(heel|heels|pump|pumps|stiletto|kitten heel|mary jane|strappy)\b/.test(s)) return "heels";
    if (/\b(sandal|sandals|espadrille|slides?)\b/.test(s)) return "sandals";
    if (/\b(flat|flats|ballet)\b/.test(s)) return "flats";
    if (/\b(loafer|loafers|oxford|oxfords)\b/.test(s)) return "loafers";
    if (/\b(boot|boots)\b/.test(s)) return "boots";
    if (/\b(sneaker|sneakers|trainer|trainers|athletic|running)\b/.test(s)) return "sneakers";
  }
  if (normalizedSlot === "bags") {
    if (/\b(clutch)\b/.test(s)) return "clutch";
    if (/\b(crossbody|shoulder)\b/.test(s)) return "crossbody";
    if (/\b(tote|shopper)\b/.test(s)) return "tote";
    if (/\b(backpack)\b/.test(s)) return "backpack";
  }
  if (normalizedSlot === "accessories") {
    if (/\b(earring|earrings)\b/.test(s)) return "earrings";
    if (/\b(necklace|pendant)\b/.test(s)) return "necklace";
    if (/\b(bracelet|bangle)\b/.test(s)) return "bracelet";
    if (/\b(belt)\b/.test(s)) return "belt";
    if (/\b(sunglasses|glasses)\b/.test(s)) return "eyewear";
  }
  return "generic";
}

function computeFashionSanityScore(params: {
  slot: string;
  source: any;
  preferredFormality: "casual" | "business" | "formal" | "mixed";
  inferredOccasion?: InferredOccasion;
  currentCategoryList: string[];
}): number {
  const slot = normalizeWardrobeCategory(params.slot) || params.slot;
  const text = `${String(params.source?.title || "")} ${String(params.source?.category || "")} ${String(params.source?.product_types || "")}`.toLowerCase();
  let score = 0.72;
  if (!String(params.source?.title || "").trim()) score -= 0.18;
  if (/open-graph|placeholder|default|image not available/.test(String(params.source?.image_url || ""))) score -= 0.2;
  if (/open-graph|placeholder|default/.test(text)) score -= 0.18;

  const preferredFormal = params.preferredFormality === "business" || params.preferredFormality === "formal";
  const occasionFormal = params.inferredOccasion === "formal" || params.inferredOccasion === "semi-formal" || params.inferredOccasion === "party";
  if (slot === "shoes") {
    const isSneaker = /\b(sneaker|sneakers|trainer|trainers|athletic|running)\b/.test(text);
    if ((preferredFormal || occasionFormal) && isSneaker) score -= 0.3;
    if (params.currentCategoryList.includes("dresses") && isSneaker) score -= 0.24;
  }
  if (slot === "bags" || slot === "accessories") {
    if (/\b(keychain|key ring|phone case|hair accessory|scrunchie)\b/.test(text)) score -= 0.24;
  }
  return Math.max(0.25, Math.min(1, score));
}

function enforceFashionDiversity(items: CompleteLookSuggestion[], limit: number): CompleteLookSuggestion[] {
  const out: CompleteLookSuggestion[] = [];
  const bySlotArchetype = new Map<string, number>();
  const bySlotBrand = new Map<string, number>();
  for (const item of items) {
    if (out.length >= Math.max(limit * 3, 40)) break;
    const slot = normalizeWardrobeCategory(item.stylistSignals?.slot || item.category) || "accessories";
    const blob = `${String(item.title || "")} ${String(item.category || "")}`.toLowerCase();
    const archetype = inferFashionArchetype(slot, blob);
    const brand = String(item.brand || "unknown").toLowerCase().trim();
    const sk = `${slot}|${archetype}`;
    const bk = `${slot}|${brand}`;
    const saCount = bySlotArchetype.get(sk) || 0;
    const sbCount = bySlotBrand.get(bk) || 0;
    if (saCount >= 6) continue;
    if (sbCount >= 5) continue;
    bySlotArchetype.set(sk, saCount + 1);
    bySlotBrand.set(bk, sbCount + 1);
    out.push(item);
  }
  return out;
}

function extractFormalityScore(item: CompleteLookSuggestion): number {
  if (Number.isFinite(item.stylistSignals?.formalityScore)) {
    return Number(item.stylistSignals?.formalityScore);
  }
  const aligned = Number(item.fitBreakdown?.formalityAlignment);
  if (Number.isFinite(aligned)) {
    return 2.5 + aligned * 6;
  }
  return 5;
}

function scoreOutfitSet(items: CompleteLookSuggestion[], categories: string[]): OutfitSetSuggestion {
  const avgItemScore = items.reduce((sum, item) => sum + item.score, 0) / Math.max(items.length, 1);
  const avgColorHarmony =
    items.reduce((sum, i) => sum + (i.fitBreakdown?.colorHarmony ?? 0.6), 0) /
    Math.max(items.length, 1);

  const pairScores: number[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const left = items[i];
      const right = items[j];
      const leftSlot = normalizeWardrobeCategory(left.stylistSignals?.slot || left.category) || "accessories";
      const rightSlot = normalizeWardrobeCategory(right.stylistSignals?.slot || right.category) || "accessories";

      const categoryCompat = Math.min(
        computeCategoryCompatibility(leftSlot, [rightSlot]),
        computeCategoryCompatibility(rightSlot, [leftSlot])
      );
      const colorPair = scoreColorPair(left.stylistSignals?.color, right.stylistSignals?.color);
      const formalityPair = scoreFormalityCompatibility(extractFormalityScore(left), extractFormalityScore(right));
      const stylePair = scoreStyleTokenOverlap(left.stylistSignals?.styleTokens, right.stylistSignals?.styleTokens);
      const pairScore =
        categoryCompat * 0.34 +
        colorPair * 0.26 +
        formalityPair * 0.24 +
        stylePair * 0.16;
      pairScores.push(pairScore);
    }
  }

  const avgPairScore =
    pairScores.length > 0 ? pairScores.reduce((sum, v) => sum + v, 0) / pairScores.length : 0.62;

  const coherenceScore = Math.round((avgItemScore * 0.58 + avgPairScore * 0.32 + avgColorHarmony * 0.1) * 1000) / 1000;
  const reasons = [`balanced across ${categories.join(", ")}`, "ranked by pairwise stylist compatibility"];
  if (avgPairScore < 0.62) {
    reasons.push("pairwise coherence is moderate");
  } else {
    reasons.push("pairwise coherence is strong");
  }

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
