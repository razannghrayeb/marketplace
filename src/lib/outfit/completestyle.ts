/**
 * Complete My Style - Fashion Outfit Recommendation Engine
 * 
 * ML-powered outfit completion that recommends complementary products
 * based on a selected item. Uses:
 * - Category compatibility rules (what goes with what)
 * - Color harmony algorithms (complementary, analogous, neutral)
 * - Style/occasion matching
 * - CLIP embeddings for visual similarity
 * - Fashion industry best practices
 */

import { pg, osClient, productsTableHasIsHiddenColumn } from "../core";
import { config } from "../../config";
import { getTextEmbedding, getImageEmbedding, cosineSimilarity, initClip, preprocessImage, loadImage } from "../image";
import { buildLookupMaps, FABRICS, OCCASIONS, type OccasionEntry } from "../compare";
import { extractAttributesSync, extractAttributes, type ExtractedAttributes } from "../search";
import { type RankerFeatureRow } from "../ranker/types";
import { predictWithFallback as predictRankerScoresWithFallback } from "../ranker/client";
import { MultiVectorSearchEngine, blendEmbeddings, type AttributeEmbedding } from "../search/multiVectorSearch";

// ============================================================================
// Types
// ============================================================================

export interface Product {
  id: number;
  title: string;
  brand?: string;
  category?: string;
  color?: string;
  gender?: string | null;
  age_group?: string | null;
  price_cents: number;
  currency: string;
  image_url?: string;
  image_cdn?: string;
  description?: string;
}

export interface StyleRecommendation {
  category: string;
  products: RecommendedProduct[];
  reason: string;
  priority: number;  // 1 = essential, 2 = recommended, 3 = optional
}

export interface RecommendedProduct extends Product {
  matchScore: number;
  confidence: number;
  matchReasons: string[];
  explainability: {
    visualSimilarity: number;
    attributeMatch: number;
    colorHarmony: number;
    styleCompatibility: number;
    occasionAlignment: number;
  };
  rankerFeatures?: Partial<RankerFeatureRow>;
  diversityScore?: number;
}

export interface OutfitCompletion {
  sourceProduct: Product;
  detectedCategory: ProductCategory;
  detectedStyle: StyleProfile;
  recommendations: StyleRecommendation[];
  outfitSuggestion: string;
}

export type ProductCategory = 
  | "dress" | "gown" | "maxi_dress" | "mini_dress" | "midi_dress"
  | "hoodie" | "sweatshirt" | "sweater" | "cardigan"
  | "tshirt" | "shirt" | "blouse" | "top" | "tank_top" | "crop_top"
  | "jeans" | "pants" | "shorts" | "skirt" | "leggings"
  | "jacket" | "blazer" | "coat" | "parka" | "bomber"
  | "sneakers" | "heels" | "boots" | "sandals" | "loafers" | "flats"
  | "bag" | "clutch" | "tote" | "backpack" | "crossbody"
  | "watch" | "jewelry" | "necklace" | "bracelet" | "earrings" | "ring"
  | "belt" | "scarf" | "hat" | "sunglasses" | "wallet"
  | "activewear" | "sportswear" | "swimwear" | "long_dress"
  | "unknown";

export interface StyleProfile {
  occasion: "formal" | "semi-formal" | "casual" | "active" | "party" | "beach";
  aesthetic: "classic" | "modern" | "bohemian" | "minimalist" | "streetwear" | "romantic" | "edgy" | "sporty";
  season: "spring" | "summer" | "fall" | "winter" | "all-season";
  colorProfile: ColorProfile;
  formality: number;  // 1-10 scale
}

export interface ColorProfile {
  primary: string;
  type: "neutral" | "warm" | "cool" | "bright" | "pastel" | "dark" | "metallic";
  harmonies: ColorHarmony[];
}

export interface ColorHarmony {
  type: "complementary" | "analogous" | "triadic" | "neutral" | "monochromatic";
  colors: string[];
}

// ============================================================================
// Category Detection Rules
// ============================================================================

export const CATEGORY_KEYWORDS: Record<ProductCategory, string[]> = {
  // Dresses
  dress: ["dress", "فستان", "robe"],
  gown: ["gown", "evening gown", "ball gown", "فستان سهرة"],
  maxi_dress: ["maxi dress", "maxi", "long dress"],
  mini_dress: ["mini dress", "mini", "short dress"],
  midi_dress: ["midi dress", "midi"],
  long_dress: ["long dress", "long dress", "long"],
  
  // Tops - Casual
  hoodie: ["hoodie", "hooded", "هودي", "kapuchon"],
  sweatshirt: ["sweatshirt", "sweater", "pullover", "سويتر", "كنزة"],
  sweater: ["sweater", "knit", "knitwear", "jumper", "pullover"],
  cardigan: ["cardigan", "كارديجان", "open front"],
  tshirt: ["t-shirt", "tshirt", "t shirt", "tee", "تيشيرت"],
  shirt: ["shirt", "button down", "button-down", "قميص", "oxford"],
  blouse: ["blouse", "بلوزة", "chiffon top"],
  top: ["top", "tops"],
  tank_top: ["tank top", "tank", "sleeveless", "vest top", "camisole"],
  crop_top: ["crop top", "cropped", "crop"],
  
  // Bottoms
  jeans: ["jeans", "denim", "جينز"],
  pants: ["pants", "trousers", "بنطلون", "chinos", "slacks"],
  shorts: ["shorts", "short", "شورت"],
  skirt: ["skirt", "تنورة", "jupe"],
  leggings: ["leggings", "tights", "ليجنز"],
  
  // Outerwear
  jacket: ["jacket", "جاكيت", "veste"],
  blazer: ["blazer", "suit jacket", "بليزر", "sport coat"],
  coat: ["coat", "overcoat", "معطف", "trench"],
  parka: ["parka", "puffer", "down jacket", "winter jacket"],
  bomber: ["bomber", "bomber jacket", "flight jacket"],
  
  // Footwear
  sneakers: ["sneakers", "sneaker", "trainers", "athletic shoes", "سنيكرز", "tennis shoes"],
  heels: ["heels", "high heels", "stiletto", "pumps", "كعب"],
  boots: ["boots", "boot", "بوت", "ankle boots", "knee boots", "combat boots"],
  sandals: ["sandals", "sandal", "صندل", "flip flops", "slides"],
  loafers: ["loafers", "loafer", "moccasins", "slip-on", "penny loafers"],
  flats: ["flats", "flat shoes", "ballet flats", "ballerinas"],
  
  // Bags
  bag: ["bag", "handbag", "شنطة", "purse"],
  clutch: ["clutch", "evening bag", "كلتش"],
  tote: ["tote", "tote bag", "shopper"],
  backpack: ["backpack", "rucksack", "باكباك"],
  crossbody: ["crossbody", "cross body", "shoulder bag", "messenger"],
  
  // Accessories - Jewelry
  watch: ["watch", "ساعة", "timepiece"],
  jewelry: ["jewelry", "jewellery", "مجوهرات"],
  necklace: ["necklace", "pendant", "chain", "قلادة", "عقد"],
  bracelet: ["bracelet", "bangle", "cuff", "اسوارة"],
  earrings: ["earrings", "earring", "studs", "hoops", "حلق"],
  ring: ["ring", "خاتم", "band"],
  
  // Accessories - Other
  belt: ["belt", "حزام", "waist belt"],
  scarf: ["scarf", "scarves", "شال", "pashmina", "hijab", "حجاب"],
  hat: ["hat", "cap", "beanie", "قبعة", "fedora", "beret"],
  sunglasses: ["sunglasses", "shades", "نظارة شمسية", "sunnies"],
  wallet: ["wallet", "محفظة", "card holder", "billfold"],
  
  // Athletic
  activewear: ["activewear", "athletic", "gym wear", "workout"],
  sportswear: ["sportswear", "sports", "athletic wear", "fitness"],
  swimwear: ["swimwear", "swimsuit", "bikini", "مايوه", "bathing suit"],
  
  unknown: [],
};

// ============================================================================
// Color Theory & Harmony Rules
// ============================================================================

export const COLOR_WHEEL: Record<string, { hue: number; type: "neutral" | "warm" | "cool" | "metallic" }> = {
  // Neutrals (no hue, match everything)
  black: { hue: 0, type: "neutral" },
  white: { hue: 0, type: "neutral" },
  gray: { hue: 0, type: "neutral" },
  grey: { hue: 0, type: "neutral" },
  beige: { hue: 40, type: "neutral" },
  cream: { hue: 45, type: "neutral" },
  ivory: { hue: 50, type: "neutral" },
  tan: { hue: 35, type: "neutral" },
  taupe: { hue: 30, type: "neutral" },
  nude: { hue: 25, type: "neutral" },
  camel: { hue: 35, type: "neutral" },
  brown: { hue: 30, type: "neutral" },
  
  // Warm colors
  red: { hue: 0, type: "warm" },
  orange: { hue: 30, type: "warm" },
  yellow: { hue: 60, type: "warm" },
  coral: { hue: 16, type: "warm" },
  peach: { hue: 25, type: "warm" },
  salmon: { hue: 6, type: "warm" },
  burgundy: { hue: 345, type: "warm" },
  maroon: { hue: 340, type: "warm" },
  wine: { hue: 348, type: "warm" },
  rust: { hue: 20, type: "warm" },
  terracotta: { hue: 18, type: "warm" },
  mustard: { hue: 50, type: "warm" },
  gold: { hue: 50, type: "warm" },
  
  // Cool colors
  blue: { hue: 210, type: "cool" },
  navy: { hue: 220, type: "cool" },
  teal: { hue: 180, type: "cool" },
  turquoise: { hue: 175, type: "cool" },
  aqua: { hue: 185, type: "cool" },
  cyan: { hue: 190, type: "cool" },
  green: { hue: 120, type: "cool" },
  olive: { hue: 80, type: "warm" },  // Olive is warmer green
  sage: { hue: 110, type: "cool" },
  mint: { hue: 150, type: "cool" },
  emerald: { hue: 140, type: "cool" },
  purple: { hue: 270, type: "cool" },
  violet: { hue: 280, type: "cool" },
  lavender: { hue: 275, type: "cool" },
  lilac: { hue: 280, type: "cool" },
  plum: { hue: 300, type: "cool" },
  pink: { hue: 330, type: "warm" },  // Pink is warmer
  blush: { hue: 340, type: "warm" },
  fuchsia: { hue: 315, type: "cool" },
  magenta: { hue: 300, type: "cool" },
  
  // Metallics
  silver: { hue: 0, type: "metallic" },
  rose_gold: { hue: 10, type: "metallic" },
  bronze: { hue: 30, type: "metallic" },
  copper: { hue: 20, type: "metallic" },
};

/**
 * Get complementary colors (opposite on color wheel)
 */
export function getComplementaryColors(color: string): string[] {
  const colorInfo = COLOR_WHEEL[color.toLowerCase()];
  if (!colorInfo || colorInfo.type === "neutral") {
    return ["black", "white", "gray", "navy", "beige"]; // Neutrals go with everything
  }
  
  const complementaryHue = (colorInfo.hue + 180) % 360;
  return Object.entries(COLOR_WHEEL)
    .filter(([_, info]) => Math.abs(info.hue - complementaryHue) < 30 || info.type === "neutral")
    .map(([name]) => name);
}

/**
 * Get analogous colors (adjacent on color wheel)
 */
export function getAnalogousColors(color: string): string[] {
  const colorInfo = COLOR_WHEEL[color.toLowerCase()];
  if (!colorInfo || colorInfo.type === "neutral") {
    return Object.entries(COLOR_WHEEL)
      .filter(([_, info]) => info.type === "neutral")
      .map(([name]) => name);
  }
  
  return Object.entries(COLOR_WHEEL)
    .filter(([_, info]) => {
      const hueDiff = Math.abs(info.hue - colorInfo.hue);
      return hueDiff < 45 || hueDiff > 315 || info.type === "neutral";
    })
    .map(([name]) => name);
}

/**
 * Get all harmonious colors for an item
 */
export function getColorHarmonies(color: string): ColorHarmony[] {
  const harmonies: ColorHarmony[] = [];
  
  // Always include neutrals
  harmonies.push({
    type: "neutral",
    colors: ["black", "white", "gray", "beige", "cream", "navy", "tan", "camel"],
  });
  
  // Monochromatic (same color family)
  harmonies.push({
    type: "monochromatic",
    colors: getAnalogousColors(color).slice(0, 5),
  });
  
  // Complementary
  harmonies.push({
    type: "complementary",
    colors: getComplementaryColors(color),
  });
  
  // Analogous
  harmonies.push({
    type: "analogous",
    colors: getAnalogousColors(color),
  });
  
  return harmonies;
}

const COLOR_TOKEN_ALIASES: Record<string, string> = {
  "off white": "white",
  "off-white": "white",
  "light blue": "blue",
  "light-blue": "blue",
  "navy blue": "navy",
  "dark blue": "navy",
  "hot pink": "pink",
  "rose gold": "gold",
};

const COLOR_FAMILY_BY_TOKEN: Record<string, string> = {
  black: "neutral",
  white: "neutral",
  gray: "neutral",
  grey: "neutral",
  beige: "neutral",
  cream: "neutral",
  ivory: "neutral",
  tan: "earth",
  camel: "earth",
  brown: "earth",
  gold: "earth",
  yellow: "earth",
  orange: "earth",
  blue: "blue",
  navy: "blue",
  teal: "blue",
  turquoise: "blue",
  aqua: "blue",
  cyan: "blue",
  red: "red",
  burgundy: "red",
  maroon: "red",
  wine: "red",
  green: "green",
  olive: "green",
  mint: "green",
  sage: "green",
  emerald: "green",
  pink: "pink",
  blush: "pink",
  magenta: "pink",
  fuchsia: "pink",
  purple: "purple",
  violet: "purple",
  lavender: "purple",
  lilac: "purple",
  plum: "purple",
};

const CORE_GARMENT_HINT = /\b(top|shirt|blouse|hoodie|sweater|cardigan|pants?|trousers?|jeans?|skirt|shorts?|dress|gown|jumpsuit|romper|jacket|coat|blazer|outerwear)\b/;

function extractColorTokens(value?: string): string[] {
  const raw = String(value || "").toLowerCase().trim();
  if (!raw) return [];

  const normalized = raw
    .replace(/[()\[\],]/g, " ")
    .replace(/[|/\\;+]/g, " ")
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return [];

  const tokens: string[] = [];
  const parts = normalized.split(" ").filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const one = parts[i];
    const two = i + 1 < parts.length ? `${parts[i]} ${parts[i + 1]}` : "";
    if (two && COLOR_TOKEN_ALIASES[two]) tokens.push(COLOR_TOKEN_ALIASES[two]);
    if (two && COLOR_WHEEL[two]) tokens.push(two);
    if (COLOR_TOKEN_ALIASES[one]) tokens.push(COLOR_TOKEN_ALIASES[one]);
    if (COLOR_WHEEL[one]) tokens.push(one);
  }

  return Array.from(new Set(tokens));
}

function colorFamiliesFromTokens(tokens: string[]): Set<string> {
  const out = new Set<string>();
  for (const t of tokens) {
    const key = String(t || "").toLowerCase().trim();
    if (!key) continue;
    const family = COLOR_FAMILY_BY_TOKEN[key];
    if (family) out.add(family);
  }
  return out;
}

function isCoreGarmentProduct(product: Product): boolean {
  const blob = `${String(product.category || "")} ${String(product.title || "")}`.toLowerCase();
  return CORE_GARMENT_HINT.test(blob);
}

function colorCompatibilityScore(
  sourceFamilies: Set<string>,
  candidateFamilies: Set<string>,
  coreGarment: boolean,
): number {
  if (candidateFamilies.size === 0) return coreGarment ? 0.25 : 0.45;
  if (sourceFamilies.size === 0) return 0.6;
  if (candidateFamilies.has("neutral") || sourceFamilies.has("neutral")) return 0.82;
  for (const f of candidateFamilies) {
    if (sourceFamilies.has(f)) return 0.9;
  }

  const complementary: Record<string, string[]> = {
    blue: ["earth", "red", "green"],
    green: ["earth", "blue"],
    red: ["blue", "earth", "green"],
    pink: ["green", "blue", "earth"],
    purple: ["blue", "pink", "earth"],
    earth: ["blue", "green", "red"],
  };
  for (const s of sourceFamilies) {
    const comp = complementary[s] || [];
    for (const c of candidateFamilies) {
      if (comp.includes(c)) return coreGarment ? 0.68 : 0.74;
    }
  }

  return coreGarment ? 0.1 : 0.28;
}

type AudienceGender = "men" | "women" | "unisex";
type AudienceAgeGroup = "kids" | "adult";

function normalizeAudienceGender(raw: unknown): AudienceGender | null {
  if (raw == null) return null;
  const tokens = Array.isArray(raw)
    ? raw.flatMap((value) => String(value).split(/[|,;/]+/g))
    : String(raw).split(/[|,;/]+/g);

  let hasMen = false;
  let hasWomen = false;
  let hasUnisex = false;

  for (const token of tokens) {
    const value = String(token).toLowerCase().trim();
    if (!value) continue;
    if (["unisex", "neutral", "all", "all-gender", "all gender", "all genders"].includes(value)) {
      hasUnisex = true;
      continue;
    }
    if (["men", "man", "male", "mens", "men's", "gents", "gentlemen", "boy", "boys", "boys-kids", "boys_kids"].includes(value)) {
      hasMen = true;
      continue;
    }
    if (["women", "woman", "female", "womens", "women's", "ladies", "lady", "girl", "girls", "girls-kids", "girls_kids"].includes(value)) {
      hasWomen = true;
      continue;
    }
  }

  if (hasUnisex || (hasMen && hasWomen)) return "unisex";
  if (hasMen) return "men";
  if (hasWomen) return "women";
  return null;
}

function inferAudienceGenderFromText(text: string): AudienceGender | null {
  const value = String(text || "").toLowerCase();
  const menHits = (value.match(/\bmen\b|\bmens\b|\bmen's\b|\bmale\b|\bman\b|\bgents?\b|\bboys?\b/g) || []).length;
  const womenHits = (value.match(/\bwomen\b|\bwomens\b|\bwomen's\b|\bfemale\b|\bwoman\b|\bladies\b|\blady\b|\bgirls?\b/g) || []).length;
  if (menHits > womenHits) return "men";
  if (womenHits > menHits) return "women";
  return null;
}

function inferAudienceAgeGroupFromText(text: string): AudienceAgeGroup | null {
  const value = String(text || "").toLowerCase();
  if (/\bkids?\b|\bchildren\b|\bchild\b|\bbaby\b|\btoddler\b|\byouth\b|\bjunior\b/.test(value)) {
    return "kids";
  }
  if (/\badult\b|\bmen\b|\bwomen\b|\bmale\b|\bfemale\b|\bladies\b|\bgents\b/.test(value)) {
    return "adult";
  }
  return null;
}

function inferSourceAudience(product: Product): { gender: AudienceGender | null; ageGroup: AudienceAgeGroup | null } {
  const text = `${String(product.gender || "")} ${String(product.title || "")} ${String(product.category || "")} ${String(product.description || "")}`;
  const gender = normalizeAudienceGender(product.gender) || inferAudienceGenderFromText(text);
  const hasExplicitKidsCue = /\bkids?\b|\bchildren\b|\bchild\b|\bbaby\b|\btoddler\b|\byouth\b|\bjunior\b/.test(text.toLowerCase());
  const ageGroup = hasExplicitKidsCue ? "kids" : gender ? "adult" : inferAudienceAgeGroupFromText(text);
  return { gender, ageGroup };
}

function inferCandidateAgeGroup(product: Product): AudienceAgeGroup | null {
  return inferAudienceAgeGroupFromText(`${String(product.gender || "")} ${String(product.title || "")} ${String(product.category || "")} ${String(product.description || "")}`);
}

function isAudienceCompatible(sourceProduct: Product, candidateProduct: Product): boolean {
  const sourceAudience = inferSourceAudience(sourceProduct);
  const candidateGender = normalizeAudienceGender(candidateProduct.gender) || inferAudienceGenderFromText(`${String(candidateProduct.gender || "")} ${String(candidateProduct.title || "")} ${String(candidateProduct.category || "")} ${String(candidateProduct.description || "")}`);
  const candidateAgeGroup = inferCandidateAgeGroup(candidateProduct);

  if (sourceAudience.gender && sourceAudience.gender !== "unisex" && candidateGender && candidateGender !== "unisex" && candidateGender !== sourceAudience.gender) {
    return false;
  }

  if (sourceAudience.gender && candidateAgeGroup === "kids") {
    return false;
  }

  if (sourceAudience.ageGroup === "kids" && candidateAgeGroup === "adult") {
    return false;
  }

  return true;
}

// ============================================================================
// Style & Occasion Rules
// ============================================================================

export const CATEGORY_STYLE_MAP: Record<ProductCategory, Partial<StyleProfile>> = {
  // Dresses
  dress: { occasion: "semi-formal", formality: 6 },
  gown: { occasion: "formal", aesthetic: "classic", formality: 9 },
  maxi_dress: { occasion: "semi-formal", aesthetic: "bohemian", formality: 5 },
  mini_dress: { occasion: "party", aesthetic: "modern", formality: 5 },
  midi_dress: { occasion: "semi-formal", aesthetic: "classic", formality: 6 },
  long_dress: { occasion: "semi-formal", aesthetic: "classic", formality: 6 },
  
  // Casual Tops
  hoodie: { occasion: "casual", aesthetic: "streetwear", formality: 2 },
  sweatshirt: { occasion: "casual", aesthetic: "streetwear", formality: 2 },
  sweater: { occasion: "casual", aesthetic: "classic", formality: 4 },
  cardigan: { occasion: "casual", aesthetic: "classic", formality: 4 },
  tshirt: { occasion: "casual", aesthetic: "streetwear", formality: 2 },
  shirt: { occasion: "semi-formal", aesthetic: "classic", formality: 6 },
  blouse: { occasion: "semi-formal", aesthetic: "romantic", formality: 6 },
  top: { occasion: "casual", formality: 4 },
  tank_top: { occasion: "casual", aesthetic: "sporty", formality: 2 },
  crop_top: { occasion: "party", aesthetic: "modern", formality: 3 },
  
  // Bottoms
  jeans: { occasion: "casual", aesthetic: "modern", formality: 3 },
  pants: { occasion: "semi-formal", aesthetic: "classic", formality: 5 },
  shorts: { occasion: "casual", aesthetic: "sporty", formality: 2 },
  skirt: { occasion: "semi-formal", aesthetic: "romantic", formality: 5 },
  leggings: { occasion: "active", aesthetic: "sporty", formality: 1 },
  
  // Outerwear
  jacket: { occasion: "casual", formality: 4 },
  blazer: { occasion: "semi-formal", aesthetic: "classic", formality: 7 },
  coat: { occasion: "semi-formal", aesthetic: "classic", formality: 6 },
  parka: { occasion: "casual", aesthetic: "streetwear", formality: 3 },
  bomber: { occasion: "casual", aesthetic: "streetwear", formality: 3 },
  
  // Footwear
  sneakers: { occasion: "casual", aesthetic: "streetwear", formality: 2 },
  heels: { occasion: "formal", aesthetic: "classic", formality: 8 },
  boots: { occasion: "casual", aesthetic: "edgy", formality: 4 },
  sandals: { occasion: "beach", aesthetic: "bohemian", formality: 2 },
  loafers: { occasion: "semi-formal", aesthetic: "classic", formality: 6 },
  flats: { occasion: "casual", aesthetic: "minimalist", formality: 4 },
  
  // Bags
  bag: { formality: 5 },
  clutch: { occasion: "formal", aesthetic: "classic", formality: 8 },
  tote: { occasion: "casual", aesthetic: "minimalist", formality: 4 },
  backpack: { occasion: "casual", aesthetic: "streetwear", formality: 2 },
  crossbody: { occasion: "casual", aesthetic: "modern", formality: 4 },
  
  // Jewelry
  watch: { formality: 6 },
  jewelry: { formality: 6 },
  necklace: { formality: 6 },
  bracelet: { formality: 5 },
  earrings: { formality: 6 },
  ring: { formality: 6 },
  
  // Accessories
  belt: { formality: 5 },
  scarf: { formality: 5 },
  hat: { occasion: "casual", formality: 3 },
  sunglasses: { occasion: "casual", formality: 4 },
  wallet: { formality: 5 },
  
  // Athletic
  activewear: { occasion: "active", aesthetic: "sporty", formality: 1 },
  sportswear: { occasion: "active", aesthetic: "sporty", formality: 1 },
  swimwear: { occasion: "beach", aesthetic: "sporty", formality: 1 },
  
  unknown: { formality: 5 },
};

// ============================================================================
// Category Pairing Rules - What Goes With What
// ============================================================================

interface CategoryPairing {
  categories: ProductCategory[];
  priority: 1 | 2 | 3;  // 1=essential, 2=recommended, 3=optional
  reason: string;
}

export const CATEGORY_PAIRINGS: Record<ProductCategory, CategoryPairing[]> = {
  // ==================== DRESSES ====================
  dress: [
    { categories: ["heels", "flats", "sandals", "boots"], priority: 1, reason: "Complete the look with matching footwear" },
    { categories: ["clutch", "crossbody", "bag"], priority: 1, reason: "A bag to complement your dress" },
    { categories: ["necklace", "earrings", "bracelet"], priority: 2, reason: "Jewelry to elevate your style" },
    { categories: ["jacket", "blazer", "cardigan"], priority: 2, reason: "Layer for versatility" },
    { categories: ["belt"], priority: 3, reason: "Define your waist" },
    { categories: ["sunglasses", "scarf"], priority: 3, reason: "Finishing touches" },
  ],
  gown: [
    { categories: ["heels", "flats", "boots", "loafers"], priority: 1, reason: "Elegant formal footwear options" },
    { categories: ["clutch"], priority: 1, reason: "An evening clutch for essentials" },
    { categories: ["earrings", "necklace", "bracelet"], priority: 1, reason: "Statement jewelry for the occasion" },
    { categories: ["ring"], priority: 3, reason: "Subtle jewelry accents" },
  ],
  maxi_dress: [
    { categories: ["sandals", "flats", "heels"], priority: 1, reason: "Footwear to complement the length" },
    { categories: ["tote", "crossbody", "clutch"], priority: 1, reason: "A bag for your belongings" },
    { categories: ["earrings", "bracelet", "necklace"], priority: 2, reason: "Bohemian jewelry pieces" },
    { categories: ["hat", "sunglasses"], priority: 2, reason: "Sun protection with style" },
    { categories: ["cardigan", "jacket"], priority: 3, reason: "Light layering option" },
  ],
  long_dress: [
    { categories: ["sandals", "flats", "heels"], priority: 1, reason: "Footwear to complement the length" },
    { categories: ["tote", "crossbody", "clutch"], priority: 1, reason: "A bag for your belongings" },
    { categories: ["earrings", "bracelet", "necklace"], priority: 2, reason: "Bohemian jewelry pieces" },
    { categories: ["hat", "sunglasses"], priority: 2, reason: "Sun protection with style" },
    { categories: ["cardigan", "jacket"], priority: 3, reason: "Light layering option" },
  ],
  mini_dress: [
    { categories: ["heels", "boots", "sneakers"], priority: 1, reason: "Footwear to complete the look" },
    { categories: ["crossbody", "clutch"], priority: 1, reason: "A chic bag" },
    { categories: ["earrings", "necklace"], priority: 2, reason: "Statement accessories" },
    { categories: ["jacket", "blazer"], priority: 2, reason: "Layering for night out" },
  ],
  midi_dress: [
    { categories: ["heels", "boots", "flats", "loafers"], priority: 1, reason: "Footwear for the perfect midi length" },
    { categories: ["bag", "crossbody", "tote"], priority: 1, reason: "Complementary bag" },
    { categories: ["earrings", "necklace", "bracelet"], priority: 2, reason: "Elegant jewelry" },
    { categories: ["blazer", "cardigan", "jacket"], priority: 2, reason: "Professional layering" },
    { categories: ["belt"], priority: 3, reason: "Waist definition" },
  ],
  
  // ==================== CASUAL TOPS ====================
  hoodie: [
    { categories: ["jeans", "pants", "shorts", "leggings"], priority: 1, reason: "Casual bottoms to complete the look" },
    { categories: ["sneakers", "boots"], priority: 1, reason: "Casual footwear" },
    { categories: ["backpack", "crossbody"], priority: 2, reason: "Streetwear-style bag" },
    { categories: ["hat", "sunglasses"], priority: 3, reason: "Streetwear accessories" },
    { categories: ["watch"], priority: 3, reason: "Subtle accessory" },
  ],
  sweatshirt: [
    { categories: ["jeans", "pants", "leggings", "shorts"], priority: 1, reason: "Casual bottoms" },
    { categories: ["sneakers"], priority: 1, reason: "Sporty casual footwear" },
    { categories: ["backpack", "tote"], priority: 2, reason: "Casual bag" },
    { categories: ["watch"], priority: 3, reason: "Simple accessory" },
  ],
  sweater: [
    { categories: ["jeans", "pants", "skirt"], priority: 1, reason: "Bottoms for layered look" },
    { categories: ["boots", "loafers", "sneakers", "flats"], priority: 1, reason: "Complementary footwear" },
    { categories: ["tote", "crossbody"], priority: 2, reason: "Bag for the outfit" },
    { categories: ["scarf"], priority: 2, reason: "Cozy layering" },
    { categories: ["necklace", "earrings"], priority: 3, reason: "Subtle jewelry" },
  ],
  cardigan: [
    { categories: ["jeans", "pants", "skirt"], priority: 1, reason: "Bottoms to layer with" },
    { categories: ["tshirt", "blouse", "tank_top"], priority: 1, reason: "Top to wear underneath" },
    { categories: ["flats", "loafers", "boots"], priority: 1, reason: "Classic footwear" },
    { categories: ["necklace"], priority: 2, reason: "Layered necklace look" },
    { categories: ["tote", "crossbody"], priority: 2, reason: "Everyday bag" },
  ],
  tshirt: [
    { categories: ["jeans", "shorts", "skirt", "pants"], priority: 1, reason: "Essential bottoms" },
    { categories: ["sneakers", "sandals", "flats"], priority: 1, reason: "Casual footwear" },
    { categories: ["jacket", "hoodie", "cardigan"], priority: 2, reason: "Layering options" },
    { categories: ["backpack", "tote", "crossbody"], priority: 2, reason: "Casual bag" },
    { categories: ["watch", "bracelet"], priority: 3, reason: "Simple accessories" },
    { categories: ["sunglasses", "hat"], priority: 3, reason: "Sun protection" },
  ],
  shirt: [
    { categories: ["pants", "jeans", "skirt"], priority: 1, reason: "Smart bottoms" },
    { categories: ["loafers", "heels", "boots", "flats"], priority: 1, reason: "Professional footwear" },
    { categories: ["blazer"], priority: 2, reason: "Business layering" },
    { categories: ["belt"], priority: 2, reason: "Polished detail" },
    { categories: ["watch", "bracelet"], priority: 2, reason: "Professional accessories" },
    { categories: ["bag", "tote"], priority: 2, reason: "Work-appropriate bag" },
  ],
  blouse: [
    { categories: ["pants", "skirt", "jeans"], priority: 1, reason: "Elegant bottoms" },
    { categories: ["heels", "flats", "loafers"], priority: 1, reason: "Feminine footwear" },
    { categories: ["blazer", "cardigan"], priority: 2, reason: "Sophisticated layering" },
    { categories: ["earrings", "necklace", "bracelet"], priority: 2, reason: "Elegant jewelry" },
    { categories: ["bag", "clutch", "tote"], priority: 2, reason: "Complementary bag" },
  ],
  top: [
    { categories: ["jeans", "pants", "skirt", "shorts"], priority: 1, reason: "Matching bottoms" },
    { categories: ["sneakers", "heels", "sandals", "flats"], priority: 1, reason: "Versatile footwear" },
    { categories: ["bag", "crossbody"], priority: 2, reason: "Everyday bag" },
    { categories: ["necklace", "earrings"], priority: 3, reason: "Accessorize" },
  ],
  tank_top: [
    { categories: ["shorts", "jeans", "skirt", "leggings"], priority: 1, reason: "Summer bottoms" },
    { categories: ["sandals", "sneakers", "flats"], priority: 1, reason: "Casual footwear" },
    { categories: ["cardigan", "jacket"], priority: 2, reason: "Light cover-up" },
    { categories: ["crossbody", "backpack"], priority: 2, reason: "Casual bag" },
    { categories: ["sunglasses", "hat"], priority: 2, reason: "Sun protection" },
  ],
  crop_top: [
    { categories: ["jeans", "skirt", "pants", "shorts"], priority: 1, reason: "High-waisted bottoms work best" },
    { categories: ["heels", "sneakers", "sandals"], priority: 1, reason: "Trendy footwear" },
    { categories: ["crossbody", "clutch"], priority: 2, reason: "Small stylish bag" },
    { categories: ["earrings", "necklace"], priority: 2, reason: "Statement jewelry" },
  ],
  
  // ==================== BOTTOMS ====================
  jeans: [
    { categories: ["tshirt", "blouse", "shirt", "sweater", "hoodie"], priority: 1, reason: "Top to complete the look" },
    { categories: ["sneakers", "boots", "heels", "loafers", "flats"], priority: 1, reason: "Versatile footwear options" },
    { categories: ["jacket", "blazer", "cardigan"], priority: 2, reason: "Layering piece" },
    { categories: ["belt"], priority: 2, reason: "Define the waist" },
    { categories: ["bag", "crossbody", "tote", "backpack"], priority: 2, reason: "Everyday bag" },
    { categories: ["watch", "bracelet"], priority: 3, reason: "Simple accessories" },
  ],
  pants: [
    { categories: ["shirt", "blouse", "sweater", "tshirt"], priority: 1, reason: "Matching top" },
    { categories: ["loafers", "heels", "boots", "flats"], priority: 1, reason: "Professional footwear" },
    { categories: ["blazer", "jacket"], priority: 2, reason: "Complete the professional look" },
    { categories: ["belt"], priority: 2, reason: "Essential detail" },
    { categories: ["tote", "bag"], priority: 2, reason: "Work-appropriate bag" },
    { categories: ["watch"], priority: 2, reason: "Professional accessory" },
  ],
  shorts: [
    { categories: ["tshirt", "tank_top", "blouse", "crop_top"], priority: 1, reason: "Summer tops" },
    { categories: ["sandals", "sneakers", "flats"], priority: 1, reason: "Casual summer footwear" },
    { categories: ["crossbody", "backpack", "tote"], priority: 2, reason: "Casual bag" },
    { categories: ["sunglasses", "hat"], priority: 2, reason: "Sun essentials" },
  ],
  skirt: [
    { categories: ["blouse", "tshirt", "top", "sweater", "shirt"], priority: 1, reason: "Complementary top" },
    { categories: ["heels", "flats", "boots", "sandals", "loafers"], priority: 1, reason: "Footwear for skirt length" },
    { categories: ["blazer", "cardigan", "jacket"], priority: 2, reason: "Layering option" },
    { categories: ["belt"], priority: 2, reason: "Waist definition" },
    { categories: ["bag", "clutch", "crossbody"], priority: 2, reason: "Matching bag" },
    { categories: ["earrings", "necklace"], priority: 3, reason: "Feminine jewelry" },
  ],
  leggings: [
    { categories: ["hoodie", "sweatshirt", "tshirt", "tank_top", "sweater"], priority: 1, reason: "Casual/athletic tops" },
    { categories: ["sneakers"], priority: 1, reason: "Athletic footwear" },
    { categories: ["backpack", "crossbody"], priority: 2, reason: "Sporty bag" },
    { categories: ["watch"], priority: 3, reason: "Fitness tracker or watch" },
  ],
  
  // ==================== OUTERWEAR ====================
  jacket: [
    { categories: ["jeans", "pants", "skirt"], priority: 1, reason: "Bottoms to layer with" },
    { categories: ["tshirt", "sweater", "blouse", "shirt"], priority: 1, reason: "Top underneath" },
    { categories: ["sneakers", "boots", "loafers"], priority: 1, reason: "Complementary footwear" },
    { categories: ["bag", "crossbody", "backpack"], priority: 2, reason: "Matching bag" },
    { categories: ["scarf"], priority: 3, reason: "Cold weather accessory" },
  ],
  blazer: [
    { categories: ["pants", "jeans", "skirt"], priority: 1, reason: "Professional bottoms" },
    { categories: ["shirt", "blouse", "tshirt"], priority: 1, reason: "Top for layering" },
    { categories: ["loafers", "heels", "flats"], priority: 1, reason: "Professional footwear" },
    { categories: ["bag", "tote"], priority: 2, reason: "Work-appropriate bag" },
    { categories: ["watch"], priority: 2, reason: "Professional accessory" },
    { categories: ["belt"], priority: 3, reason: "Polished detail" },
  ],
  coat: [
    { categories: ["sweater", "shirt", "blouse"], priority: 1, reason: "Layers underneath" },
    { categories: ["jeans", "pants"], priority: 1, reason: "Matching bottoms" },
    { categories: ["boots", "loafers", "heels"], priority: 1, reason: "Winter-appropriate footwear" },
    { categories: ["scarf", "hat"], priority: 2, reason: "Cold weather accessories" },
    { categories: ["bag", "tote"], priority: 2, reason: "Complementary bag" },
  ],
  parka: [
    { categories: ["jeans", "pants", "leggings"], priority: 1, reason: "Warm bottoms" },
    { categories: ["hoodie", "sweater", "sweatshirt"], priority: 1, reason: "Warm layers" },
    { categories: ["boots", "sneakers"], priority: 1, reason: "Weather-appropriate footwear" },
    { categories: ["backpack"], priority: 2, reason: "Casual bag" },
    { categories: ["hat", "scarf"], priority: 2, reason: "Cold weather essentials" },
  ],
  bomber: [
    { categories: ["jeans", "pants"], priority: 1, reason: "Casual bottoms" },
    { categories: ["tshirt", "hoodie"], priority: 1, reason: "Streetwear tops" },
    { categories: ["sneakers", "boots"], priority: 1, reason: "Streetwear footwear" },
    { categories: ["backpack", "crossbody"], priority: 2, reason: "Street style bag" },
    { categories: ["watch", "sunglasses"], priority: 3, reason: "Cool accessories" },
  ],
  
  // ==================== FOOTWEAR ====================
  sneakers: [
    { categories: ["jeans", "pants", "shorts", "leggings"], priority: 1, reason: "Casual bottoms" },
    { categories: ["tshirt", "hoodie", "sweatshirt"], priority: 1, reason: "Casual tops" },
    { categories: ["backpack", "crossbody"], priority: 2, reason: "Sporty bag" },
    { categories: ["watch"], priority: 3, reason: "Sport watch" },
  ],
  heels: [
    { categories: ["dress", "skirt", "pants", "jeans"], priority: 1, reason: "Elegant bottoms" },
    { categories: ["blouse", "top", "shirt"], priority: 1, reason: "Sophisticated tops" },
    { categories: ["clutch", "bag"], priority: 1, reason: "Evening or elegant bag" },
    { categories: ["earrings", "necklace", "bracelet"], priority: 2, reason: "Statement jewelry" },
  ],
  boots: [
    { categories: ["jeans", "pants", "skirt", "dress"], priority: 1, reason: "Versatile bottoms" },
    { categories: ["sweater", "jacket", "coat", "blouse"], priority: 1, reason: "Layered tops" },
    { categories: ["bag", "crossbody", "tote"], priority: 2, reason: "Matching bag" },
    { categories: ["scarf"], priority: 3, reason: "Cold weather pairing" },
  ],
  sandals: [
    { categories: ["dress", "shorts", "skirt", "jeans"], priority: 1, reason: "Summer bottoms" },
    { categories: ["tank_top", "tshirt", "blouse", "top"], priority: 1, reason: "Summer tops" },
    { categories: ["crossbody", "tote"], priority: 2, reason: "Summer bag" },
    { categories: ["sunglasses", "hat"], priority: 2, reason: "Sun accessories" },
  ],
  loafers: [
    { categories: ["pants", "jeans", "skirt"], priority: 1, reason: "Smart casual bottoms" },
    { categories: ["shirt", "blouse", "sweater"], priority: 1, reason: "Smart casual tops" },
    { categories: ["blazer"], priority: 2, reason: "Professional layering" },
    { categories: ["bag", "tote"], priority: 2, reason: "Classic bag" },
    { categories: ["watch"], priority: 3, reason: "Timeless accessory" },
  ],
  flats: [
    { categories: ["dress", "skirt", "pants", "jeans"], priority: 1, reason: "Versatile bottoms" },
    { categories: ["blouse", "top", "tshirt"], priority: 1, reason: "Comfortable tops" },
    { categories: ["crossbody", "tote"], priority: 2, reason: "Everyday bag" },
    { categories: ["earrings", "necklace"], priority: 3, reason: "Feminine accessories" },
  ],
  
  // ==================== BAGS ====================
  bag: [
    { categories: ["dress", "pants", "jeans", "skirt"], priority: 1, reason: "Outfit to match" },
    { categories: ["heels", "flats", "boots", "loafers"], priority: 1, reason: "Matching footwear" },
    { categories: ["watch", "bracelet"], priority: 3, reason: "Coordinating accessories" },
  ],
  clutch: [
    { categories: ["dress", "gown", "skirt"], priority: 1, reason: "Evening outfit" },
    { categories: ["heels", "flats", "loafers", "boots"], priority: 1, reason: "Formal footwear" },
    { categories: ["earrings", "necklace", "bracelet"], priority: 2, reason: "Statement jewelry" },
  ],
  tote: [
    { categories: ["pants", "jeans", "dress"], priority: 1, reason: "Work or casual outfit" },
    { categories: ["flats", "loafers", "sneakers"], priority: 1, reason: "Comfortable footwear" },
    { categories: ["blazer", "cardigan"], priority: 2, reason: "Professional layer" },
  ],
  backpack: [
    { categories: ["jeans", "pants", "shorts", "leggings"], priority: 1, reason: "Casual bottoms" },
    { categories: ["tshirt", "hoodie", "sweatshirt"], priority: 1, reason: "Casual tops" },
    { categories: ["sneakers"], priority: 1, reason: "Sporty footwear" },
  ],
  crossbody: [
    { categories: ["jeans", "dress", "skirt", "shorts"], priority: 1, reason: "Versatile outfit" },
    { categories: ["sneakers", "sandals", "flats"], priority: 1, reason: "Casual footwear" },
    { categories: ["tshirt", "top", "blouse"], priority: 1, reason: "Everyday tops" },
  ],
  
  // ==================== JEWELRY ====================
  watch: [
    { categories: ["shirt", "blouse", "tshirt"], priority: 1, reason: "Visible with any top" },
    { categories: ["bracelet"], priority: 2, reason: "Stack with bracelets" },
  ],
  jewelry: [
    { categories: ["dress", "blouse", "top"], priority: 1, reason: "Showcase your jewelry" },
    { categories: ["heels", "flats"], priority: 2, reason: "Elegant footwear" },
  ],
  necklace: [
    { categories: ["dress", "blouse", "top", "tshirt"], priority: 1, reason: "Tops to showcase necklace" },
    { categories: ["earrings"], priority: 2, reason: "Coordinating earrings" },
    { categories: ["bracelet", "ring"], priority: 3, reason: "Complete jewelry set" },
  ],
  bracelet: [
    { categories: ["watch"], priority: 2, reason: "Stack with watch" },
    { categories: ["ring"], priority: 3, reason: "Matching jewelry" },
    { categories: ["necklace", "earrings"], priority: 3, reason: "Complete the set" },
  ],
  earrings: [
    { categories: ["necklace"], priority: 2, reason: "Coordinating necklace" },
    { categories: ["bracelet", "ring"], priority: 3, reason: "Matching set" },
    { categories: ["dress", "blouse"], priority: 1, reason: "Outfit to showcase" },
  ],
  ring: [
    { categories: ["bracelet"], priority: 2, reason: "Matching metals" },
    { categories: ["watch"], priority: 3, reason: "Coordinating accessories" },
  ],
  
  // ==================== OTHER ACCESSORIES ====================
  belt: [
    { categories: ["jeans", "pants", "skirt", "dress"], priority: 1, reason: "Bottoms or dress to belt" },
    { categories: ["shirt", "blouse", "tshirt"], priority: 1, reason: "Top to tuck in" },
    { categories: ["loafers", "boots", "heels"], priority: 2, reason: "Matching leather footwear" },
    { categories: ["bag"], priority: 3, reason: "Matching leather bag" },
  ],
  scarf: [
    { categories: ["coat", "jacket", "blazer"], priority: 1, reason: "Outerwear to layer with" },
    { categories: ["sweater", "blouse"], priority: 1, reason: "Top to accent" },
    { categories: ["boots"], priority: 2, reason: "Cold weather footwear" },
  ],
  hat: [
    { categories: ["jacket", "coat", "hoodie"], priority: 1, reason: "Outerwear pairing" },
    { categories: ["jeans", "pants"], priority: 1, reason: "Casual bottoms" },
    { categories: ["sneakers", "boots"], priority: 2, reason: "Casual footwear" },
    { categories: ["sunglasses"], priority: 2, reason: "Sun protection set" },
  ],
  sunglasses: [
    { categories: ["dress", "tshirt", "top", "tank_top"], priority: 1, reason: "Summer outfit" },
    { categories: ["shorts", "skirt", "jeans"], priority: 1, reason: "Summer bottoms" },
    { categories: ["sandals", "sneakers"], priority: 2, reason: "Summer footwear" },
    { categories: ["hat"], priority: 2, reason: "Complete sun protection" },
  ],
  wallet: [
    { categories: ["bag", "clutch", "crossbody"], priority: 2, reason: "Matching bag" },
  ],
  
  // ==================== ACTIVEWEAR ====================
  activewear: [
    { categories: ["sneakers"], priority: 1, reason: "Athletic footwear" },
    { categories: ["backpack", "crossbody"], priority: 2, reason: "Gym bag" },
    { categories: ["watch"], priority: 2, reason: "Fitness tracker" },
    { categories: ["sunglasses", "hat"], priority: 3, reason: "Outdoor workout essentials" },
  ],
  sportswear: [
    { categories: ["sneakers"], priority: 1, reason: "Sport shoes" },
    { categories: ["backpack"], priority: 2, reason: "Sports bag" },
    { categories: ["watch"], priority: 2, reason: "Sport watch" },
  ],
  swimwear: [
    { categories: ["sandals"], priority: 1, reason: "Beach footwear" },
    { categories: ["hat", "sunglasses"], priority: 1, reason: "Sun protection" },
    { categories: ["tote"], priority: 2, reason: "Beach bag" },
  ],
  
  unknown: [
    { categories: ["bag"], priority: 2, reason: "A bag completes any outfit" },
    { categories: ["watch"], priority: 3, reason: "Timeless accessory" },
  ],
};

// ============================================================================
// Detection Functions
// ============================================================================

/**
 * AI-Enhanced Category Detection using ONNX Attribute Extraction
 * 
 * Phase 1: Use ONNX attribute model instead of keyword matching
 * - Higher accuracy for fashion items
 * - Handles typos and variations
 * - Confidence scoring
 */
export async function detectCategory(title: string, description?: string): Promise<{
  category: ProductCategory;
  confidence: number;
  attributes: ExtractedAttributes;
}> {
  const text = `${title} ${description || ""}`.trim();
  
  try {
    // Use ONNX attribute extractor
    const result = await extractAttributes(text, {
      useML: true,
      mlThreshold: 0.7,
    });
    
    const { attributes, confidence } = result;
    
    // Map extracted style/type to our category system
    let detectedCategory: ProductCategory = "unknown";
    let categoryConfidence = 0;
    
    // First try: direct style mapping
    if (attributes.style) {
      detectedCategory = mapStyleToCategory(attributes.style, text);
      categoryConfidence = confidence.style || 0.7;
    }
    
    // Fallback: pattern matching with higher confidence
    if (detectedCategory === "unknown" || categoryConfidence < 0.6) {
      const fallbackResult = detectCategoryFallback(text);
      if (fallbackResult.confidence > categoryConfidence) {
        detectedCategory = fallbackResult.category;
        categoryConfidence = fallbackResult.confidence;
      }
    }
    
    return {
      category: detectedCategory,
      confidence: categoryConfidence,
      attributes,
    };
  } catch (error) {
    console.warn('[detectCategory] ONNX extraction failed, using fallback:', error);
    const fallback = detectCategoryFallback(text);
    return {
      category: fallback.category,
      confidence: fallback.confidence,
      attributes: {},
    };
  }
}

/**
 * Map extracted style attribute to product category
 */
function mapStyleToCategory(style: string, text: string): ProductCategory {
  const styleMap: Record<string, ProductCategory[]> = {
    "dress": ["dress", "gown", "maxi_dress", "mini_dress", "midi_dress", "long_dress"],
    "formal": ["gown", "blazer", "heels", "dress"],
    "casual": ["tshirt", "jeans", "sneakers", "hoodie"],
    "athletic": ["activewear", "sneakers", "leggings"],
    "swimwear": ["swimwear"],
    "workwear": ["blazer", "pants", "shirt", "loafers"],
    "streetwear": ["hoodie", "sneakers", "jeans", "bomber"],
    "activewear": ["activewear", "sneakers", "leggings"],
    "sportswear": ["sportswear", "sneakers"],
  };
  
  // Check text for specific indicators
  const lowerText = text.toLowerCase();
  
  // Direct category matches
  if (lowerText.includes("dress")) return "dress";
  if (lowerText.includes("hoodie")) return "hoodie";
  if (lowerText.includes("jeans")) return "jeans";
  if (lowerText.includes("sneaker")) return "sneakers";
  if (lowerText.includes("heel")) return "heels";
  if (lowerText.includes("boot")) return "boots";
  if (lowerText.includes("jacket")) return "jacket";
  if (lowerText.includes("blazer")) return "blazer";
  
  // Style-based mapping
  const candidates = styleMap[style] || [];
  return candidates.length > 0 ? candidates[0] : "unknown";
}

/**
 * Fallback category detection using improved keyword matching
 */
function detectCategoryFallback(text: string): { category: ProductCategory; confidence: number } {
  const lowerText = text.toLowerCase();
  
  // Direct "polo" keyword match → prioritize shirt
  if (/\b(polo|polo shirt|polo shirt)\b/.test(lowerText)) {
    return {
      category: 'shirt',
      confidence: 0.95,
    };
  }
  
  // Weighted keyword matching with confidence scores
  const categoryScores: Record<ProductCategory, number> = {
    dress: 0, gown: 0, maxi_dress: 0, mini_dress: 0, midi_dress: 0,
    hoodie: 0, sweatshirt: 0, sweater: 0, cardigan: 0,
    tshirt: 0, shirt: 0, blouse: 0, top: 0, tank_top: 0, crop_top: 0,
    jeans: 0, pants: 0, shorts: 0, skirt: 0, leggings: 0,
    jacket: 0, blazer: 0, coat: 0, parka: 0, bomber: 0,
    sneakers: 0, heels: 0, boots: 0, sandals: 0, loafers: 0, flats: 0,
    bag: 0, clutch: 0, tote: 0, backpack: 0, crossbody: 0,
    watch: 0, jewelry: 0, necklace: 0, bracelet: 0, earrings: 0, ring: 0,
    belt: 0, scarf: 0, hat: 0, sunglasses: 0, wallet: 0,
    activewear: 0, sportswear: 0, swimwear: 0, unknown: 0,
    long_dress: 0,
  };
  
  // Score based on exact keyword matches
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (category === "unknown") continue;
    
    for (const keyword of keywords) {
      const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (regex.test(lowerText)) {
        categoryScores[category as ProductCategory] += 1.0;
      }
    }
  }
  
  // Direct "shoes" keyword match → prioritize footwear
  if (/\b(shoes?|footwear)\b/.test(lowerText)) {
    const footwearCategories = ['loafers', 'flats', 'boots', 'heels', 'sandals', 'sneakers'];
    for (const cat of footwearCategories) {
      if (categoryScores[cat as ProductCategory] > 0) {
        // High confidence if "shoes" is mentioned + any footwear match found
        return {
          category: cat as ProductCategory,
          confidence: 0.85,
        };
      }
    }
    // If "shoes" is mentioned but no specific type found, return unknown with shoes note
    return {
      category: 'unknown',
      confidence: 0.5,
    };
  }
  
  // Find highest scoring category
  let bestCategory: ProductCategory = "unknown";
  let bestScore = 0;
  
  for (const [category, score] of Object.entries(categoryScores)) {
    if (score > bestScore) {
      bestCategory = category as ProductCategory;
      bestScore = score;
    }
  }
  
  return {
    category: bestCategory,
    confidence: Math.min(bestScore, 1.0),
  };
}

/**
 * AI-Enhanced Color Detection using ONNX Attribute Extraction
 * 
 * Phase 1: Use ONNX attribute model for accurate color extraction
 * - Handles color variations and synonyms
 * - Multi-color support
 * - Confidence scoring
 */
export async function detectColor(title: string, description?: string): Promise<{
  primary?: string;
  colors?: string[];
  confidence: number;
}> {
  const text = `${title} ${description || ""}`.trim();
  
  try {
    // Use ONNX attribute extractor for color detection
    const result = await extractAttributes(text, {
      useML: true,
      mlThreshold: 0.6, // Lower threshold for colors
    });
    
    const { attributes, confidence } = result;
    
    if (attributes.color) {
      return {
        primary: attributes.color,
        colors: attributes.colors || [attributes.color],
        confidence: confidence.color || 0.7,
      };
    }
    
    // Fallback to manual color detection
    const fallbackColor = detectColorFallback(text);
    return {
      primary: fallbackColor,
      colors: fallbackColor ? [fallbackColor] : [],
      confidence: fallbackColor ? 0.8 : 0,
    };
  } catch (error) {
    console.warn('[detectColor] ONNX extraction failed, using fallback:', error);
    const fallbackColor = detectColorFallback(text);
    return {
      primary: fallbackColor,
      colors: fallbackColor ? [fallbackColor] : [],
      confidence: fallbackColor ? 0.6 : 0,
    };
  }
}

/**
 * Fallback color detection using color wheel matching
 */
function detectColorFallback(text: string): string | undefined {
  const lowerText = text.toLowerCase();
  
  // Check our color wheel for matches (prioritize specific colors)
  const sortedColors = Object.keys(COLOR_WHEEL)
    .sort((a, b) => b.length - a.length); // Longer color names first
  
  for (const color of sortedColors) {
    const regex = new RegExp(`\\b${color.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (regex.test(lowerText)) {
      return color;
    }
  }
  
  return undefined;
}

/**
 * Build complete style profile for a product (AI-Enhanced)
 * 
 * Phase 1: Uses ONNX attribute extraction for accurate categorization
 * - Async to support ML models
 * - Returns confidence scores
 * - Handles multiple colors
 */
export async function buildStyleProfile(product: Product): Promise<StyleProfile> {
  // Use async category detection
  const categoryResult = await detectCategory(product.title, product.description);
  const category = categoryResult.category;
  
  // Use async color detection with fallback
  let color: string | undefined;
  if (product.color) {
    color = product.color;
  } else {
    const colorResult = await detectColor(product.title, product.description);
    color = colorResult.primary;
  }
  
  // Get base style from category
  const categoryStyle = CATEGORY_STYLE_MAP[category] || {};
  
  // Detect color profile
  const colorInfo = color ? COLOR_WHEEL[color.toLowerCase()] : null;
  const colorProfile: ColorProfile = {
    primary: color || "neutral",
    type: colorInfo?.type || "neutral",
    harmonies: color ? getColorHarmonies(color) : [],
  };
  
  // Build complete profile
  return {
    occasion: categoryStyle.occasion || "casual",
    aesthetic: categoryStyle.aesthetic || "modern",
    season: detectSeason(product.title, product.description),
    colorProfile,
    formality: categoryStyle.formality || 5,
  };
}

/**
 * Phase 2: Generate Ensemble CLIP Embeddings (Fashion-CLIP + OpenAI CLIP)
 * 
 * Combines multiple CLIP models for better visual similarity matching:
 * - Fashion-CLIP: Specialized for apparel details
 * - OpenAI CLIP: General visual understanding
 * - Blended: Weighted combination for robust matching
 */
async function generateEnsembleEmbeddings(product: Product): Promise<{
  fashion: number[];
  openai: number[];
  blended: number[];
} | null> {
  try {
    // Ensure image URL exists
    const imageUrl = product.image_cdn || product.image_url;
    if (!imageUrl) return null;

    // Load and preprocess image buffer
    const response = await fetch(imageUrl);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const { data, width, height, channels } = await (await import("../image/utils")).loadImage(buffer);

    // Get Fashion-CLIP embedding
    await initClip("fashion-clip");
    const preprocessedFashion = preprocessImage(new Uint8Array(data), width, height, channels);
    const fashionEmbedding = await getImageEmbedding(preprocessedFashion);

    // Get OpenAI CLIP embedding
    await initClip("vit-l-14");
    const preprocessedOpenai = preprocessImage(new Uint8Array(data), width, height, channels);
    const openaiEmbedding = await getImageEmbedding(preprocessedOpenai);

    // Create weighted blend (60% Fashion-CLIP, 40% OpenAI)
    const blendedEmbedding = blendEmbeddings([
      { attribute: "global", vector: fashionEmbedding, weight: 0.6 },
      { attribute: "global", vector: openaiEmbedding, weight: 0.4 },
    ]);

    return {
      fashion: fashionEmbedding,
      openai: openaiEmbedding,
      blended: blendedEmbedding,
    };
  } catch (error) {
    console.warn('[generateEnsembleEmbeddings] Failed to generate embeddings:', error);
    return null;
  }
}

/**
 * Detect season from product text
 */
function detectSeason(title: string, description?: string): StyleProfile["season"] {
  const text = `${title} ${description || ""}`.toLowerCase();
  
  if (/winter|cold|warm|wool|fleece|puffer|down|thermal|cozy/i.test(text)) return "winter";
  if (/summer|light|linen|cotton|breathable|cool|beach/i.test(text)) return "summer";
  if (/spring|floral|pastel|light/i.test(text)) return "spring";
  if (/fall|autumn|layering|knit/i.test(text)) return "fall";
  
  return "all-season";
}

// ============================================================================
// Recommendation Engine
// ============================================================================

/**
 * Get complementary product recommendations
 */
export async function completeMyStyle(
  product: Product,
  options: {
    maxPerCategory?: number;
    maxTotal?: number;
    priceRange?: { min?: number; max?: number };
    excludeBrands?: string[];
    preferSameBrand?: boolean;
    useVisualSimilarity?: boolean;
    disablePriceFilter?: boolean;  // Set true to disable default price range
  } = {}
): Promise<OutfitCompletion> {
  const {
    maxPerCategory = 5,
    maxTotal = 20,
    priceRange,
    excludeBrands = [],
    preferSameBrand = false,
    useVisualSimilarity = true,
    disablePriceFilter = false,
  } = options;
  
  // Default price range: 0.5x to 2.5x of source product price
  // Only apply if product has a price and no explicit range provided
  const effectivePriceRange = priceRange ?? (
    !disablePriceFilter && product.price_cents > 0
      ? {
          min: Math.round(product.price_cents * 0.5),
          max: Math.round(product.price_cents * 2.5),
        }
      : undefined
  );
  
  // Detect category and style (now async with AI models)
  const categoryResult = await detectCategory(product.title, product.description);
  const detectedCategory = categoryResult.category;
  const detectedStyle = await buildStyleProfile(product);
  
  // Get pairing rules
  const pairings = CATEGORY_PAIRINGS[detectedCategory] || CATEGORY_PAIRINGS.unknown;
  
  // Build recommendations for each pairing category
  const recommendations: StyleRecommendation[] = [];
  let totalProducts = 0;
  
  for (const pairing of pairings) {
    if (totalProducts >= maxTotal) break;
    
    const categoryProducts = await findProductsForCategory(
      pairing.categories,
      detectedStyle,
      {
        maxResults: maxPerCategory,
        priceRange: effectivePriceRange,
        excludeBrands,
        preferSameBrand: preferSameBrand ? product.brand : undefined,
        useVisualSimilarity,
        sourceProduct: product,
      }
    );
    
    if (categoryProducts.length > 0) {
      recommendations.push({
        category: pairing.categories.join(" / "),
        products: categoryProducts,
        reason: pairing.reason,
        priority: pairing.priority,
      });
      totalProducts += categoryProducts.length;
    }
  }
  
  // Sort by priority
  recommendations.sort((a, b) => a.priority - b.priority);
  
  // Generate outfit suggestion
  const outfitSuggestion = generateOutfitSuggestion(product, detectedCategory, detectedStyle, recommendations);
  
  return {
    sourceProduct: product,
    detectedCategory,
    detectedStyle,
    recommendations,
    outfitSuggestion,
  };
}

function normalizeOutfitText(value: unknown): string {
  return String(value || "").toLowerCase();
}

function isRelevantForRequestedCategories(product: Product, categories: ProductCategory[]): boolean {
  const haystack = normalizeOutfitText(`${product.title} ${product.category || ""} ${product.description || ""}`);
  if (!haystack.trim()) return false;

  return categories.some((cat) => {
    const keywords = CATEGORY_KEYWORDS[cat] || [];
    return keywords.some((keyword) => {
      const token = normalizeOutfitText(keyword).trim();
      return token.length >= 3 && haystack.includes(token);
    });
  });
}

function productNearDuplicateKey(product: Product): string {
  const normalizedTitle = normalizeOutfitText(product.title)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  const normalizedBrand = normalizeOutfitText(product.brand).replace(/\s+/g, " ").trim();
  const normalizedImage = normalizeOutfitText(product.image_cdn || product.image_url)
    .replace(/^https?:\/\//, "")
    .trim();
  return `${normalizedBrand}|${normalizedTitle}|${normalizedImage}`;
}

function normalizePriceCentsFromSearchSource(raw: Record<string, unknown>): number {
  if (typeof raw.price_cents === "number" && Number.isFinite(raw.price_cents)) {
    return Math.max(0, Math.round(raw.price_cents));
  }

  if (typeof raw.price_usd === "number" && Number.isFinite(raw.price_usd)) {
    const priceUsd = Number(raw.price_usd);
    if (priceUsd > 1000) {
      return Math.max(0, Math.round(priceUsd));
    }
    return Math.max(0, Math.round(priceUsd * 100));
  }

  return 0;
}

/**
 * Find products matching category and style criteria
 */
async function findProductsForCategory(
  categories: ProductCategory[],
  style: StyleProfile,
  options: {
    maxResults: number;
    priceRange?: { min?: number; max?: number };
    excludeBrands?: string[];
    preferSameBrand?: string;
    useVisualSimilarity: boolean;
    sourceProduct: Product;
  }
): Promise<RecommendedProduct[]> {
  try {
    // Build category keywords
    const categoryKeywords = categories
      .flatMap(cat => CATEGORY_KEYWORDS[cat] || [])
      .filter(k => k.length > 2);
    
    if (categoryKeywords.length === 0) return [];
    
    const categoryShouldClauses = categoryKeywords.map((keyword) => ({
      multi_match: {
        query: keyword,
        fields: ["title^3", "category^2", "description"],
        operator: "or",
      },
    }));

    // Build OpenSearch query
    const query: any = {
      bool: {
        must: [
          {
            bool: {
              should: categoryShouldClauses,
              minimum_should_match: 1,
            },
          },
        ],
        should: [],
        filter: [
          // Allow BOTH in_stock and out_of_stock products for outfit recommendations
          { bool: { should: [{ term: { availability: "in_stock" } }, { term: { availability: "out_of_stock" } }], minimum_should_match: 1 } },
        ]
      }
    };
    
    // Add price filter (indexed field is price_usd float; options.priceRange is cents)
    if (options.priceRange) {
      const priceFilter: any = { range: { price_usd: {} } };
      if (options.priceRange.min != null) {
        priceFilter.range.price_usd.gte = options.priceRange.min / 100;
      }
      if (options.priceRange.max != null) {
        priceFilter.range.price_usd.lte = options.priceRange.max / 100;
      }
      query.bool.filter.push(priceFilter);
    }
    
    // Exclude brands
    if (options.excludeBrands && options.excludeBrands.length > 0) {
      query.bool.must_not = options.excludeBrands.map(brand => ({
        match: { brand: brand }
      }));
    }
    
    // Boost same brand if preferred
    if (options.preferSameBrand) {
      query.bool.should.push({
        match: { brand: { query: options.preferSameBrand, boost: 1.5 } }
      });
    }
    
    // Add color harmony boost
    if (style.colorProfile.primary && style.colorProfile.primary !== "neutral") {
      const harmoniousColors = style.colorProfile.harmonies
        .flatMap(h => h.colors)
        .slice(0, 10);
      
      for (const color of harmoniousColors) {
        query.bool.should.push({
          match: { title: { query: color, boost: 0.5 } }
        });
      }
    }
    
    // Execute search
    const response = await osClient.search({
      index: config.opensearch.index,
      body: {
        query,
        size: options.maxResults * 2,  // Get more to filter
        _source: [
          "product_id",
          "title",
          "brand",
          "category",
          "gender",
          "color",
          "price_usd",
          "currency",
          "image_url",
          "image_cdn",
          "description",
        ],
      }
    });
    
    const hits = response.body.hits.hits || [];
    
    // Phase 2-4: Advanced AI-powered scoring with neural ranking
    const scoredProducts: RecommendedProduct[] = [];
    const rankerFeatures: Partial<RankerFeatureRow>[] = [];
    
    // Generate ensemble embeddings for source product if visual similarity is enabled
    let sourceEmbeddings: Awaited<ReturnType<typeof generateEnsembleEmbeddings>> = null;
    if (options.useVisualSimilarity && options.sourceProduct) {
      sourceEmbeddings = await generateEnsembleEmbeddings(options.sourceProduct);
    }
    
    const seenNearDuplicateKeys = new Set<string>();

    for (const hit of hits) {
      const raw = (hit._source || {}) as Record<string, unknown>;
      const pid = parseInt(String(raw.product_id ?? raw.id ?? ""), 10);
      if (!Number.isFinite(pid) || pid < 1) continue;
      if (pid === options.sourceProduct.id) continue;

      const priceCents = normalizePriceCentsFromSearchSource(raw);

      const product: Product = {
        id: pid,
        title: String(raw.title ?? ""),
        brand: raw.brand != null ? String(raw.brand) : undefined,
        category: raw.category != null ? String(raw.category) : undefined,
        gender: raw.gender != null ? String(raw.gender) : undefined,
        color: raw.color != null ? String(raw.color) : undefined,
        price_cents: priceCents,
        currency: raw.currency != null ? String(raw.currency) : "USD",
        image_url: raw.image_url != null ? String(raw.image_url) : undefined,
        image_cdn:
          raw.image_cdn != null
            ? String(raw.image_cdn)
            : raw.image_url != null
              ? String(raw.image_url)
              : undefined,
        description: raw.description != null ? String(raw.description) : undefined,
      };

      if (!isAudienceCompatible(options.sourceProduct, product)) {
        continue;
      }

      if (!isRelevantForRequestedCategories(product, categories)) {
        continue;
      }

      const nearDuplicateKey = productNearDuplicateKey(product);
      if (seenNearDuplicateKeys.has(nearDuplicateKey)) {
        continue;
      }
      seenNearDuplicateKeys.add(nearDuplicateKey);

      const matchReasons: string[] = [];
      let baseScore = hit._score || 0;
      
      // Check style compatibility (now async)
      const productStyle = await buildStyleProfile(product);
      
      // Extract attributes for hybrid retrieval
      const productAttributes = await extractAttributes(product.title, { useML: true });
      
      // Initialize explainability scores
      const explainability = {
        visualSimilarity: 0,
        attributeMatch: 0,
        colorHarmony: 0,
        styleCompatibility: 0,
        occasionAlignment: 0,
      };
      
      // Phase 2: Visual Similarity with Ensemble CLIP
      let visualScore = 0;
      let clipSim = 0;
      if (options.useVisualSimilarity && sourceEmbeddings) {
        const candidateEmbeddings = await generateEnsembleEmbeddings(product);
        if (candidateEmbeddings) {
          // Use blended embedding for primary similarity
          const blendedSim = cosineSimilarity(sourceEmbeddings.blended, candidateEmbeddings.blended);
          const fashionSim = cosineSimilarity(sourceEmbeddings.fashion, candidateEmbeddings.fashion);
          const openaiSim = cosineSimilarity(sourceEmbeddings.openai, candidateEmbeddings.openai);
          
          // Weighted ensemble (prioritize fashion for detail matching)
          visualScore = blendedSim * 0.5 + fashionSim * 0.3 + openaiSim * 0.2;
          clipSim = blendedSim;
          
          if (visualScore > 0.7) {
            matchReasons.push("Strong visual similarity");
          } else if (visualScore > 0.5) {
            matchReasons.push("Good visual match");
          }
          
          explainability.visualSimilarity = visualScore;
        }
      }
      
      // Phase 3: Hybrid Attribute Matching
      let attributeScore = 0;
      const sourceAttributes = await extractAttributes(
        options.sourceProduct.title,
        { useML: true }
      );
      
      // Material matching
      if (productAttributes.attributes.material && sourceAttributes.attributes.material) {
        if (productAttributes.attributes.material === sourceAttributes.attributes.material) {
          attributeScore += 0.3;
          matchReasons.push("Similar material");
        }
      }
      
      // Fit matching
      if (productAttributes.attributes.fit && sourceAttributes.attributes.fit) {
        if (productAttributes.attributes.fit === sourceAttributes.attributes.fit) {
          attributeScore += 0.2;
          matchReasons.push("Matching fit style");
        }
      }
      
      // Pattern compatibility
      if (productAttributes.attributes.pattern) {
        // Avoid too many patterns in one outfit
        if (sourceAttributes.attributes.pattern && 
            productAttributes.attributes.pattern !== sourceAttributes.attributes.pattern) {
          attributeScore -= 0.1; // Small penalty for pattern clash
        } else if (!sourceAttributes.attributes.pattern) {
          attributeScore += 0.1; // Bonus for complementary plain item
        }
      }
      
      explainability.attributeMatch = Math.max(0, attributeScore);
      
      // Formality match (±2 is acceptable)
      const formalityDiff = Math.abs(productStyle.formality - style.formality);
      let styleScore = 0;
      if (formalityDiff <= 2) {
        styleScore += 0.5;
        matchReasons.push("Matches formality level");
      } else if (formalityDiff <= 4) {
        styleScore += 0.25;
      } else {
        styleScore -= 0.2; // Penalty for formality mismatch
      }
      
      explainability.styleCompatibility = Math.max(0, styleScore);
      // Color harmony check (now async)
      let productColor: string | undefined = product.color;
      if (!productColor) {
        const colorResult = await detectColor(product.title);
        productColor = colorResult.primary;
      }
      
      const sourceColorTokens = extractColorTokens(
        `${style.colorProfile.primary} ${(style.colorProfile.harmonies || []).map((h) => h.colors.join(" ")).join(" ")}`
      );
      const productColorTokens = extractColorTokens(
        `${productColor || ""} ${product.title || ""} ${product.category || ""}`
      );
      const sourceColorFamilies = colorFamiliesFromTokens(sourceColorTokens);
      const candidateColorFamilies = colorFamiliesFromTokens(productColorTokens);
      const isCoreGarment = isCoreGarmentProduct(product);

      let colorScore = colorCompatibilityScore(sourceColorFamilies, candidateColorFamilies, isCoreGarment);
      if (colorScore >= 0.85) {
        matchReasons.push("Color harmony match");
      } else if (colorScore >= 0.65) {
        matchReasons.push("Good color compatibility");
      } else if (isCoreGarment && colorScore < 0.22) {
        matchReasons.push("Risky color clash for a core piece");
      }

      // Hard reject obvious color clashes for core garments to prevent low-fashion recommendations.
      if (isCoreGarment && sourceColorFamilies.size > 0 && colorScore < 0.18) {
        continue;
      }
      
      explainability.colorHarmony = colorScore;
      
      // Occasion match
      let occasionScore = 0;
      if (productStyle.occasion === style.occasion) {
        occasionScore = 1.0;
        matchReasons.push(`Perfect for ${style.occasion} occasions`);
      } else {
        // Check if occasions are compatible (e.g., casual + semi-formal)
        const compatibleOccasions: Record<string, string[]> = {
          'formal': ['semi-formal'],
          'semi-formal': ['formal', 'casual'],
          'casual': ['semi-formal', 'active'],
          'active': ['casual'],
          'party': ['semi-formal', 'casual'],
        };
        const compatible = compatibleOccasions[style.occasion]?.includes(productStyle.occasion);
        if (compatible) {
          occasionScore = 0.5;
        }
      }
      
      explainability.occasionAlignment = occasionScore;
      
      // Same brand bonus
      const sameBrand = options.preferSameBrand && 
        product.brand?.toLowerCase() === options.preferSameBrand.toLowerCase() ? 1 : 0;
      if (sameBrand) {
        matchReasons.push("Same brand for cohesive look");
      }
      
      // Phase 2: Build features for neural ranker
      const features: Partial<RankerFeatureRow> = {
        clip_sim: clipSim,
        text_sim: 0, // Could add text embedding similarity
        style_score: styleScore,
        color_score: colorScore,
        same_brand: sameBrand,
        phash_sim: 0, // Could add perceptual hash if available
        price_ratio: options.sourceProduct.price_cents > 0
          ? product.price_cents / options.sourceProduct.price_cents
          : 1.0,
        formality_score: 1 - Math.min(formalityDiff / 10, 1), // Normalize to 0-1, higher is better
      };

      rankerFeatures.push(features);

      // Calculate preliminary confidence based on attribute extraction
      const avgConfidence = Object.values(productAttributes.confidence)
        .reduce((sum, c) => sum + c, 0) / Math.max(Object.keys(productAttributes.confidence).length, 1);

      // Add required fields for RecommendedProduct
      scoredProducts.push({
        ...product,
        matchScore: baseScore, // Will be updated by ranker
        confidence: avgConfidence,
        matchReasons: matchReasons.length > 0 ? matchReasons : ["Complementary style"],
        explainability,
        rankerFeatures: features,
      });
    }
    
    // Phase 2: Neural Ranking - Replace manual scoring with ML model
    let rankingMethod: 'neural' | 'fallback' = 'fallback';
    if (scoredProducts.length > 0) {
      try {
        const rankerResult = await predictRankerScoresWithFallback(rankerFeatures);
        rankingMethod = rankerResult.source === 'model' ? 'neural' : 'fallback';

        // Update match scores with ranker predictions
        rankerResult.scores.forEach((score, idx) => {
          scoredProducts[idx].matchScore = score * 100; // Scale to 0-100
        });

        if (rankingMethod === 'neural') {
          console.log('[CompleteMyStyle] Using neural ranking model');
        }
      } catch (error) {
        console.warn('[CompleteMyStyle] Ranker failed, using heuristic scores:', error);
      }
    }

    // Phase 3: Confidence-based Quality Filtering
    // Filter out low-confidence predictions (below 40% confidence)
    const highConfidenceProducts = scoredProducts.filter(p => p.confidence >= 0.4);

    // Phase 3: Diversification - Avoid all products from same brand
    const diversified = diversifyRecommendations(highConfidenceProducts, {
      maxSameBrand: Math.ceil(options.maxResults / 3), // Max 1/3 from same brand
      maxSamePrice: Math.ceil(options.maxResults / 2), // Max 1/2 in same price range
    });

    // Sort by score and return top results
    return diversified
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, options.maxResults);
      
  } catch (error) {
    console.error("Error finding complementary products:", error);
    return [];
  }
}

/**
 * Phase 3: Diversification Algorithm
 * 
 * Ensures variety in recommendations by limiting:
 * - Same brand products
 * - Same price range products
 * - Similar visual styles
 */
function diversifyRecommendations(
  products: RecommendedProduct[],
  options: {
    maxSameBrand: number;
    maxSamePrice: number;
  }
): RecommendedProduct[] {
  const { maxSameBrand, maxSamePrice } = options;
  
  // Track counts
  const brandCounts = new Map<string, number>();
  const priceRangeCounts = new Map<string, number>();
  
  const diversified: RecommendedProduct[] = [];
  
  // Helper to get price range bucket
  const getPriceRange = (price: number): string => {
    if (price < 5000) return 'budget'; // < $50
    if (price < 15000) return 'mid'; // $50-$150
    if (price < 30000) return 'premium'; // $150-$300
    return 'luxury'; // > $300
  };
  
  // Sort by match score first
  const sorted = [...products].sort((a, b) => b.matchScore - a.matchScore);
  
  for (const product of sorted) {
    const brand = product.brand?.toLowerCase() || 'unknown';
    const priceRange = getPriceRange(product.price_cents);
    
    const brandCount = brandCounts.get(brand) || 0;
    const priceCount = priceRangeCounts.get(priceRange) || 0;
    
    // Check diversification constraints
    const exceedsBrandLimit = brandCount >= maxSameBrand;
    const exceedsPriceLimit = priceCount >= maxSamePrice;
    
    // Skip if exceeds both limits (too similar)
    if (exceedsBrandLimit && exceedsPriceLimit) {
      continue;
    }
    
    // Add diversity score to explainability
    const diversityPenalty = (brandCount / maxSameBrand + priceCount / maxSamePrice) / 2;
    product.diversityScore = 1 - diversityPenalty;
    
    diversified.push(product);
    brandCounts.set(brand, brandCount + 1);
    priceRangeCounts.set(priceRange, priceCount + 1);
  }
  
  return diversified;
}

/**
 * Generate human-readable outfit suggestion
 */
function generateOutfitSuggestion(
  product: Product,
  category: ProductCategory,
  style: StyleProfile,
  recommendations: StyleRecommendation[]
): string {
  const categoryName = category.replace(/_/g, " ");
  const color = style.colorProfile.primary;
  const occasion = style.occasion;
  
  let suggestion = `For your ${color !== "neutral" ? color + " " : ""}${categoryName}`;
  
  // Add occasion context
  switch (occasion) {
    case "formal":
      suggestion += ", perfect for elegant occasions";
      break;
    case "semi-formal":
      suggestion += ", ideal for smart casual settings";
      break;
    case "casual":
      suggestion += ", great for everyday wear";
      break;
    case "active":
      suggestion += ", perfect for active lifestyles";
      break;
    case "party":
      suggestion += ", ideal for nights out";
      break;
    case "beach":
      suggestion += ", perfect for vacation vibes";
      break;
  }
  
  // Add key recommendations
  const essentials = recommendations.filter(r => r.priority === 1);
  if (essentials.length > 0) {
    const essentialCategories = essentials.map(r => r.category).join(", ");
    suggestion += `. We recommend pairing with ${essentialCategories}`;
  }
  
  // Add color advice
  if (color && color !== "neutral") {
    const colorInfo = COLOR_WHEEL[color.toLowerCase()];
    if (colorInfo) {
      if (colorInfo.type === "neutral") {
        suggestion += ". As a neutral color, it pairs beautifully with almost anything";
      } else if (colorInfo.type === "warm") {
        suggestion += `. The warm ${color} tone pairs well with earth tones and complementary cool colors`;
      } else if (colorInfo.type === "cool") {
        suggestion += `. The cool ${color} shade works great with other cool tones or warm accent colors`;
      }
    }
  }
  
  suggestion += ".";
  
  return suggestion;
}

// ============================================================================
// Database Integration
// ============================================================================

/**
 * Get product by ID for outfit completion
 */
export async function getProductForOutfit(productId: number): Promise<Product | null> {
  try {
    const hasIsHidden = await productsTableHasIsHiddenColumn();
    const hiddenClause = hasIsHidden ? "AND (p.is_hidden IS NOT TRUE)" : "";
    const result = await pg.query<Product>(`
      SELECT 
        p.id, p.title, p.brand, p.category, p.color, p.gender,
        p.price_cents, p.currency, p.image_url, p.image_cdn, p.description
      FROM products p
      WHERE p.id = $1 ${hiddenClause}
    `, [productId]);

    return result.rows[0] || null;
  } catch (error) {
    console.error("Error fetching product for outfit:", error);
    return null;
  }
}

/**
 * Main entry point: Complete outfit from product ID
 */
export async function completeOutfitFromProductId(
  productId: number,
  options?: Parameters<typeof completeMyStyle>[1]
): Promise<OutfitCompletion | null> {
  const product = await getProductForOutfit(productId);
  if (!product) return null;
  
  return completeMyStyle(product, options);
}
