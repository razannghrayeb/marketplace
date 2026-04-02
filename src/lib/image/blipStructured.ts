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

function inferStyleFromCaption(caption: string): StructuredBlipStyle {
  const s = caption.toLowerCase();
  if (/\b(formal|elegant|gown|tailored|blazer)\b/.test(s)) {
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

export function buildStructuredBlipOutput(rawCaption: string): StructuredBlipOutput {
  const normalizedCaption = String(rawCaption || "").replace(/\s+/g, " ").trim().toLowerCase();
  const audience = inferAudienceFromCaption(normalizedCaption);
  const slotColors = inferColorFromCaption(normalizedCaption);
  const lexicalTypes = extractLexicalProductTypeSeeds(normalizedCaption).map(normalizeTypeToken);
  const expanded = expandProductTypesForQuery(lexicalTypes).map(normalizeTypeToken);
  const productTypeHints = [...new Set([...lexicalTypes, ...expanded])].filter(Boolean).slice(0, 12);

  const colorCandidates = [
    slotColors.topColor,
    slotColors.jeansColor,
    slotColors.garmentColor,
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
