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

import { pg, osClient } from "../../lib/core";
import { config } from "../../config";
import { getTextEmbedding, cosineSimilarity } from "../../lib/image";
import { buildLookupMaps, FABRICS, OCCASIONS, type OccasionEntry } from "../../lib/compare";
import { extractAttributesSync, type ExtractedAttributes } from "../../lib/search";

// ============================================================================
// Types
// ============================================================================

export interface Product {
  id: number;
  title: string;
  brand?: string;
  category?: string;
  color?: string;
  price_cents: number;
  currency: string;
  image_url?: string;
  image_cdn?: string;
  description?: string;
}

export interface StyleRecommendation {
  category: string;
  products: OutfitRecommendedProduct[];
  reason: string;
  priority: number;  // 1 = essential, 2 = recommended, 3 = optional
}

export interface OutfitRecommendedProduct extends Product {
  matchScore: number;
  matchReasons: string[];
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
  | "activewear" | "sportswear" | "swimwear"
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
  bag: ["bag", "bags", "handbag", "handbags", "شنطة", "purse", "purses", "satchel", "satchels", "wallet", "wallets"],
  clutch: ["clutch", "clutches", "evening bag", "evening bags", "كلتش"],
  tote: ["tote", "totes", "tote bag", "tote bags", "shopper"],
  backpack: ["backpack", "backpacks", "rucksack", "باكباك"],
  crossbody: ["crossbody", "cross body", "cross-body", "shoulder bag", "shoulder bags", "messenger"],
  
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

// ============================================================================
// Style & Occasion Rules
// ============================================================================

const CATEGORY_STYLE_MAP: Record<ProductCategory, Partial<StyleProfile>> = {
  // Dresses
  dress: { occasion: "semi-formal", formality: 6 },
  gown: { occasion: "formal", aesthetic: "classic", formality: 9 },
  maxi_dress: { occasion: "semi-formal", aesthetic: "bohemian", formality: 5 },
  mini_dress: { occasion: "party", aesthetic: "modern", formality: 5 },
  midi_dress: { occasion: "semi-formal", aesthetic: "classic", formality: 6 },
  
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
    { categories: ["heels"], priority: 1, reason: "Elegant heels for formal occasions" },
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
    { categories: ["heels"], priority: 1, reason: "Formal footwear" },
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
 * Detect product category from title and description
 */
export function detectCategory(title: string, description?: string): ProductCategory {
  const text = `${title} ${description || ""}`.toLowerCase();
  
  // Check each category's keywords (longer/more specific first)
  const sortedCategories = Object.entries(CATEGORY_KEYWORDS)
    .filter(([cat]) => cat !== "unknown")
    .sort((a, b) => {
      // Sort by max keyword length (more specific categories first)
      const maxLenA = Math.max(...a[1].map(k => k.length));
      const maxLenB = Math.max(...b[1].map(k => k.length));
      return maxLenB - maxLenA;
    });
  
  for (const [category, keywords] of sortedCategories) {
    for (const keyword of keywords) {
      // Word boundary check for more accurate matching
      const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (regex.test(text)) {
        return category as ProductCategory;
      }
    }
  }
  
  return "unknown";
}

/**
 * Extract color from product title/description
 */
export function detectColor(title: string, description?: string): string | undefined {
  const text = `${title} ${description || ""}`.toLowerCase();
  
  // Use attribute extractor for color detection
  const attributes = extractAttributesSync(title);
  if (attributes.attributes.color) {
    return attributes.attributes.color;
  }
  
  // Fallback: check our color wheel
  for (const color of Object.keys(COLOR_WHEEL)) {
    const regex = new RegExp(`\\b${color}\\b`, 'i');
    if (regex.test(text)) {
      return color;
    }
  }
  
  return undefined;
}

/**
 * Build complete style profile for a product
 */
export function buildStyleProfile(product: Product): StyleProfile {
  const category = detectCategory(product.title, product.description);
  const color = product.color || detectColor(product.title, product.description);
  
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
  
  // Detect category and style
  const detectedCategory = detectCategory(product.title, product.description);
  const detectedStyle = buildStyleProfile(product);
  
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
): Promise<OutfitRecommendedProduct[]> {
  try {
    // Build category keywords
    const categoryKeywords = [...new Set(categories
      .flatMap(cat => CATEGORY_KEYWORDS[cat] || [])
      .map(k => String(k).toLowerCase().trim())
      .filter(k => k.length > 2))];
    
    if (categoryKeywords.length === 0) return [];
    
    // Build OpenSearch query
    const query: any = {
      bool: {
        should: categoryKeywords.map(keyword => ({
          bool: {
            should: [
              {
                match: {
                  title: {
                    query: keyword,
                    boost: 2,
                  }
                }
              },
              {
                match: {
                  category: {
                    query: keyword,
                    boost: 2,
                  }
                }
              },
              {
                match: {
                  description: {
                    query: keyword,
                    boost: 0.8,
                  }
                }
              },
            ],
            minimum_should_match: 1,
          },
        })),
        minimum_should_match: 1,
        filter: [
          { term: { availability: true } }
        ]
      }
    };
    
    // Add price filter
    if (options.priceRange) {
      const priceFilter: any = { range: { price_cents: {} } };
      if (options.priceRange.min) priceFilter.range.price_cents.gte = options.priceRange.min;
      if (options.priceRange.max) priceFilter.range.price_cents.lte = options.priceRange.max;
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
        _source: ["id", "title", "brand", "category", "color", "price_cents", "currency", "image_url", "image_cdn", "description"],
      }
    });
    
    const hits = response.body.hits.hits || [];

    const isCategoryAligned = (product: Product): boolean => {
      const detected = detectCategory(
        `${String(product.title || "")} ${String(product.category || "")}`,
        product.description,
      );
      if (detected !== "unknown") {
        return categories.includes(detected);
      }

      const blob = `${String(product.title || "")} ${String(product.category || "")} ${String(product.description || "")}`.toLowerCase();
      return categoryKeywords.some((keyword) => {
        const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`\\b${escaped}\\b`, "i").test(blob);
      });
    };

    const normalizePriceCents = (value: unknown): number => {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return 0;
      const rounded = Math.round(n);
      // Some catalog feeds index cents scaled by 100; normalize obvious outliers.
      if (rounded >= 500_000 && rounded % 100 === 0) {
        return Math.round(rounded / 100);
      }
      return rounded;
    };
    
    // Score and rank products
    const scoredProducts: OutfitRecommendedProduct[] = [];
    const seen = new Set<string>();
    
    for (const hit of hits) {
      const source = (hit && hit._source ? hit._source : {}) as any;
      const product: Product = {
        id: Number(source.id ?? source.product_id ?? hit?._id ?? 0),
        title: String(source.title || ""),
        brand: source.brand != null ? String(source.brand) : undefined,
        category: source.category != null ? String(source.category) : undefined,
        color: source.color != null ? String(source.color) : undefined,
        price_cents: normalizePriceCents(source.price_cents),
        currency: source.currency != null ? String(source.currency) : "USD",
        image_url: source.image_url != null ? String(source.image_url) : undefined,
        image_cdn: source.image_cdn != null ? String(source.image_cdn) : undefined,
        description: source.description != null ? String(source.description) : undefined,
      };

      if (!product.id || !product.title) continue;
      if (!isCategoryAligned(product)) continue;

      const imageKey = String(product.image_cdn || product.image_url || "").split("?")[0].toLowerCase().trim();
      const dedupeKey = imageKey || `${String(product.brand || "").toLowerCase().trim()}|${product.title.toLowerCase().trim()}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const matchReasons: string[] = [];
      let matchScore = hit._score || 0;
      
      // Check style compatibility
      const productStyle = buildStyleProfile(product);
      
      // Formality match (±2 is acceptable)
      const formalityDiff = Math.abs(productStyle.formality - style.formality);
      if (formalityDiff <= 2) {
        matchScore += 10;
        matchReasons.push("Matches formality level");
      } else if (formalityDiff <= 4) {
        matchScore += 5;
      }
      
      // Color harmony check
      if (product.color || detectColor(product.title)) {
        const productColor = product.color || detectColor(product.title);
        if (productColor) {
          const isHarmonious = style.colorProfile.harmonies.some(h => 
            h.colors.includes(productColor.toLowerCase())
          );
          if (isHarmonious) {
            matchScore += 15;
            matchReasons.push("Color harmony match");
          }
        }
      }
      
      // Occasion match
      if (productStyle.occasion === style.occasion) {
        matchScore += 10;
        matchReasons.push(`Perfect for ${style.occasion} occasions`);
      }
      
      // Same brand bonus
      if (options.preferSameBrand && product.brand?.toLowerCase() === options.preferSameBrand.toLowerCase()) {
        matchScore += 5;
        matchReasons.push("Same brand for cohesive look");
      }
      
      scoredProducts.push({
        ...product,
        matchScore,
        matchReasons: matchReasons.length > 0 ? matchReasons : ["Complementary style"],
      });
    }
    
    // Sort by score and return top results
    return scoredProducts
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, options.maxResults);
      
  } catch (error) {
    console.error("Error finding complementary products:", error);
    return [];
  }
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
    const result = await pg.query<Product>(`
      SELECT 
        id, title, brand, category, color, 
        price_cents, currency, image_url, image_cdn, description
      FROM products 
      WHERE id = $1 AND availability = true
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
