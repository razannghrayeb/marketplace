import { inferAudienceFromCaption, inferColorFromCaption } from "./captionAttributeInference";
import {
  extractLexicalProductTypeSeeds,
  expandProductTypesForQuery,
} from "../search/productTypeTaxonomy";

export interface StructuredBlipAudience {
  gender?: string;
  ageGroup?: string;
}

export interface StructuredBlipStyle {
  attrStyle?: string;
  occasion?: string;
  formality?: number;
}

export interface StructuredBlipOutput {
  rawCaption: string;
  normalizedCaption: string;
  mainItem: string | null;
  secondaryItems: string[];
  colors: string[];
  audience: StructuredBlipAudience;
  style: StructuredBlipStyle;
  productTypeHints: string[];
  confidence: number;
}

const TYPE_SYNONYMS: Record<string, string> = {
  tee: "tshirt",
  tees: "tshirt",
  "t-shirt": "tshirt",
  "t shirt": "tshirt",
  blouse: "shirt",
  sneakers: "shoe",
  trainers: "shoe",
  loafers: "shoe",
  heels: "shoe",
  boots: "shoe",
  sandals: "shoe",
  denims: "jeans",
};

const COLOR_SYNONYMS: Record<string, string> = {
  navy: "blue",
  denim: "blue",
  burgundy: "red",
  maroon: "red",
  gray: "gray",
  grey: "gray",
  ivory: "off-white",
  cream: "off-white",
  camel: "tan",
};

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function normalizeTypeToken(token: string): string {
  const x = String(token || "").toLowerCase().trim();
  return TYPE_SYNONYMS[x] ?? x;
}

function normalizeColorToken(token: string): string {
  const x = String(token || "").toLowerCase().trim();
  return COLOR_SYNONYMS[x] ?? x;
}

function isFootwearHint(token: string): boolean {
  return /\b(sneaker|sneakers|trainer|trainers|shoe|shoes|boot|boots|sandal|sandals|heel|heels|pump|pumps|flat|flats|loafer|loafers|mule|mules|slipper|slippers|oxford|oxfords|brogue|brogues|slide|slides|clog|clogs|espadrille|espadrilles)\b/.test(
    token,
  );
}

function isApparelHint(token: string): boolean {
  return /\b(dress|dresses|gown|gowns|frock|jumpsuit|jumpsuits|romper|rompers|playsuit|playsuits|blazer|blazers|jacket|jackets|coat|coats|parka|parkas|trench|windbreaker|windbreakers|vest|vests|hoodie|hoodies|sweatshirt|sweatshirts|pullover|pullovers|sweater|sweaters|cardigan|cardigans|jumper|jumpers|shirt|shirts|blouse|blouses|button down|button-down|tshirt|tee|tees|t-shirt|tank|camisole|camis|top|tops|cami|polo|polos|pant|pants|trouser|trousers|chino|chinos|cargo|cargos|legging|leggings|tights|shorts|short|bermuda|board shorts|skirt|skirts|swimsuit|swimwear|bikini|bikinis|underwear)\b/.test(
    token,
  );
}

function rankProductTypeHint(token: string): number {
  const t = normalizeTypeToken(token);
  if (!t) return 999;
  if (/\b(dress|dresses|gown|gowns|frock|midi dress|maxi dress|mini dress)\b/.test(t)) return 0;
  if (/\b(jumpsuit|jumpsuits|romper|rompers|playsuit|playsuits)\b/.test(t)) return 1;
  // Suits have highest priority in tailored/formal category (before generic jackets)
  if (/\b(suit|suits|tuxedo|tuxedos|suit jacket|dress jacket)\b/.test(t)) return 1.5;
  if (/\b(blazer|blazers|sport coat|sportcoat|jacket|jackets|coat|coats|parka|parkas|trench|windbreaker|windbreakers|vest|vests|gilet|poncho|anorak|bomber|bomber jacket)\b/.test(t)) return 2;
  if (/\b(hoodie|hoodies|sweatshirt|sweatshirts|pullover|pullovers|sweater|sweaters|cardigan|cardigans|jumper|jumpers|knitwear|shirt|shirts|blouse|blouses|button down|button-down|tshirt|tee|tees|t-shirt|tank|camisole|camis|top|tops|cami|polo|polos|polo shirt)\b/.test(t)) return 3;
  if (/\b(pant|pants|trouser|trousers|chino|chinos|cargo pants|cargo|slacks|jean|jeans|denim|denims|legging|leggings|tights)\b/.test(t)) return 4;
  if (/\b(shorts|short|bermuda|board shorts|skirt|skirts|mini skirt|midi skirt)\b/.test(t)) return 5;
  if (/\b(swimsuit|swimwear|bikini|bikinis|underwear)\b/.test(t)) return 6;
  if (isFootwearHint(t)) return 7;
  if (/\b(bag|bags|handbag|handbags|tote|totes|clutch|clutches|purse|purses|backpack|backpacks|crossbody|satchel|satchels|wallet|wallets)\b/.test(t)) return 8;
  return 20;
}

function inferStyleFromCaption(caption: string): StructuredBlipStyle {
  const s = caption.toLowerCase();
  if (/\b(formal|elegant|gown|tailored|blazer|suit|tie|tuxedo)\b/.test(s)) {
    return { attrStyle: "formal", occasion: "formal", formality: 0.86 };
  }
  if (/\b(smart casual|semi formal|semi-formal|office|workwear)\b/.test(s)) {
    return { attrStyle: "smart-casual", occasion: "smart-casual", formality: 0.68 };
  }
  if (/\b(sport|athletic|gym|running|training)\b/.test(s)) {
    return { attrStyle: "casual", occasion: "sport", formality: 0.34 };
  }
  if (/\b(casual|everyday|streetwear|denim)\b/.test(s)) {
    return { attrStyle: "casual", occasion: "casual", formality: 0.42 };
  }
  return {};
}

/**
 * Apply caption-driven overrides for well-known garment signals.
 * Captures signals that lexical extraction might miss or misclassify.
 * Example: "man in a suit and tie" correctly overrides detected "shirt" → "suit"
 */
function applyCaptionOverridesToTypeHints(
  caption: string,
  hints: string[]
): string[] {
  const s = caption.toLowerCase();

  // **SUIT OVERRIDE**: Caption explicitly mentions "suit" or "tie"
  // Override: Remove generic shirt/top/outerwear confusion, inject "suit" + formal variants
  if (/\b(suit|suits|tie|tuxedo)\b/.test(s)) {
    // Remove conflicting types that might have been detected
    const filtered = hints.filter(
      (t) =>
        !/\b(shirt|blouse|button.*up|casual.*shirt|dress.*shirt|polo|tee|t.?shirt|top|camisole|tank|cami)\b/.test(
          t
        )
    );

    // Always include suit variants if not already present
    const suitVariants = ["suit", "suit jacket", "blazer", "dress jacket", "formal jacket"];
    for (const variant of suitVariants) {
      if (!filtered.includes(variant)) {
        filtered.unshift(variant);
      }
    }
    return filtered.slice(0, 12);
  }

  // **FORMAL OUTERWEAR OVERRIDE**: Caption mentions "blazer" + formal context
  if (/\b(blazer|blazers|sport\s+coat|sportcoat)\b/.test(s) && /\b(formal|tailored|structured)\b/.test(s)) {
    const filtered = hints.filter(
      (t) =>
        !/\b(casual.*jacket|denim.*jacket|shirt jacket|shacket|bomber|windbreaker|rain)\b/.test(t)
    );
    if (!filtered.includes("blazer")) {
      filtered.unshift("blazer");
    }
    return filtered.slice(0, 12);
  }

  return hints;
}

export function buildStructuredBlipOutput(rawCaption: string): StructuredBlipOutput {
  const normalizedCaption = String(rawCaption || "").replace(/\s+/g, " ").trim().toLowerCase();
  const audience = inferAudienceFromCaption(normalizedCaption);
  const slotColors = inferColorFromCaption(normalizedCaption);
  const lexicalTypes = extractLexicalProductTypeSeeds(normalizedCaption).map(normalizeTypeToken);
  const expanded = expandProductTypesForQuery(lexicalTypes).map(normalizeTypeToken);
  let mergedHints = [...new Set([...lexicalTypes, ...expanded])].filter(Boolean);
  
  // Apply caption-driven overrides **before** filtering and ranking
  mergedHints = applyCaptionOverridesToTypeHints(normalizedCaption, mergedHints);
  
  const hasApparel = mergedHints.some((t) => isApparelHint(t));
  const productTypeHints = (hasApparel ? mergedHints.filter((t) => !isFootwearHint(t)) : mergedHints)
    .sort((a, b) => rankProductTypeHint(a) - rankProductTypeHint(b) || a.localeCompare(b))
    .slice(0, 12);

  const colorCandidates = [
    slotColors.topColor,
    slotColors.jeansColor,
    slotColors.garmentColor,
    slotColors.shoeColor,
    slotColors.bagColor,
  ]
    .filter((x): x is string => Boolean(x))
    .map(normalizeColorToken);
  const colors = [...new Set(colorCandidates)];

  const style = inferStyleFromCaption(normalizedCaption);
  const mainItem = productTypeHints[0] ?? null;
  const secondaryItems = productTypeHints.slice(1, 5);

  let confidence = 0.1;
  if (normalizedCaption.length >= 12) confidence += 0.12;
  if (mainItem) confidence += 0.26;
  if (secondaryItems.length > 0) confidence += 0.1;
  if (colors.length > 0) confidence += 0.16;
  if (audience.gender) confidence += 0.12;
  if (audience.ageGroup) confidence += 0.06;
  if (style.attrStyle) confidence += 0.1;

  return {
    rawCaption: rawCaption ?? "",
    normalizedCaption,
    mainItem,
    secondaryItems,
    colors,
    audience: {
      gender: audience.gender,
      ageGroup: audience.ageGroup,
    },
    style,
    productTypeHints,
    confidence: clamp01(confidence),
  };
}
