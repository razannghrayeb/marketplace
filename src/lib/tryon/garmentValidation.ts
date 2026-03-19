/**
 * Garment Validation for Virtual Try-On
 * 
 * Pre-validates garment category before submitting to Vertex AI.
 * Prevents wasted API calls for unsupported garment types.
 */

import { pg } from "../core/db";
import { detectCategoryFromText } from "../products/categoryDetector";

// ============================================================================
// Types
// ============================================================================

export interface ValidationResult {
  valid: boolean;
  category: string;
  tryonCategory: TryOnCategory;
  error?: string;
  suggestion?: string;
}

export type TryOnCategory = "upper_body" | "lower_body" | "dresses" | "unsupported";

// ============================================================================
// Supported Categories
// ============================================================================

/**
 * Categories supported by Vertex AI Virtual Try-On
 */
const SUPPORTED_CATEGORIES: Record<TryOnCategory, Set<string>> = {
  upper_body: new Set([
    "shirt", "t-shirt", "tshirt", "blouse", "top", "sweater", "hoodie",
    "sweatshirt", "cardigan", "tank top", "polo", "vest", "crop top",
    "قميص", "بلوزة", "سويتر", "هودي", "تيشيرت",
  ]),
  lower_body: new Set([
    "pants", "jeans", "trousers", "shorts", "skirt", "leggings",
    "بنطلون", "جينز", "شورت", "تنورة",
  ]),
  dresses: new Set([
    "dress", "gown", "maxi dress", "mini dress", "midi dress",
    "jumpsuit", "romper", "فستان",
  ]),
  unsupported: new Set([
    "shoes", "sneakers", "heels", "boots", "sandals",
    "bag", "handbag", "clutch", "backpack",
    "watch", "jewelry", "necklace", "bracelet", "earrings", "ring",
    "belt", "scarf", "hat", "sunglasses", "wallet",
    "swimwear", "underwear", "socks",
    "حذاء", "شنطة", "ساعة", "مجوهرات", "حزام",
  ]),
};

/**
 * Map detected category to try-on category
 */
const CATEGORY_MAPPING: Record<string, TryOnCategory> = {
  // Upper body
  "shirt": "upper_body",
  "t-shirt": "upper_body",
  "tshirt": "upper_body",
  "blouse": "upper_body",
  "top": "upper_body",
  "sweater": "upper_body",
  "hoodie": "upper_body",
  "sweatshirt": "upper_body",
  "cardigan": "upper_body",
  "tank_top": "upper_body",
  "crop_top": "upper_body",
  "polo": "upper_body",
  "vest": "upper_body",
  "jacket": "upper_body",
  "blazer": "upper_body",
  "coat": "upper_body",
  
  // Lower body
  "pants": "lower_body",
  "jeans": "lower_body",
  "trousers": "lower_body",
  "shorts": "lower_body",
  "skirt": "lower_body",
  "leggings": "lower_body",
  
  // Dresses
  "dress": "dresses",
  "gown": "dresses",
  "maxi_dress": "dresses",
  "mini_dress": "dresses",
  "midi_dress": "dresses",
  "jumpsuit": "dresses",
  "romper": "dresses",
  
  // Unsupported
  "shoes": "unsupported",
  "sneakers": "unsupported",
  "heels": "unsupported",
  "boots": "unsupported",
  "sandals": "unsupported",
  "bag": "unsupported",
  "clutch": "unsupported",
  "backpack": "unsupported",
  "watch": "unsupported",
  "jewelry": "unsupported",
  "belt": "unsupported",
  "hat": "unsupported",
  "sunglasses": "unsupported",
  "swimwear": "unsupported",
};

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate a garment for virtual try-on
 */
export function validateGarment(
  title: string,
  description?: string,
  providedCategory?: string
): ValidationResult {
  // Use provided category if available
  let detectedCategory = providedCategory?.toLowerCase() || "";
  
  // Otherwise detect from text
  if (!detectedCategory) {
    detectedCategory = detectCategoryFromText(title, description);
  }
  
  // Map to try-on category
  const tryonCategory = CATEGORY_MAPPING[detectedCategory] || inferTryOnCategory(title, description);
  
  // Check if supported
  if (tryonCategory === "unsupported") {
    return {
      valid: false,
      category: detectedCategory || "unknown",
      tryonCategory: "unsupported",
      error: `Virtual try-on is not supported for ${detectedCategory || "this item type"}. ` +
             `Supported categories: tops, pants/skirts, and dresses.`,
      suggestion: getSuggestion(detectedCategory),
    };
  }
  
  return {
    valid: true,
    category: detectedCategory,
    tryonCategory,
  };
}

/**
 * Validate garment from product ID
 */
export async function validateGarmentFromProductId(
  productId: number
): Promise<ValidationResult> {
  const result = await pg.query(
    `SELECT title, description, category FROM products WHERE id = $1`,
    [productId]
  );
  
  if (result.rows.length === 0) {
    return {
      valid: false,
      category: "unknown",
      tryonCategory: "unsupported",
      error: `Product ${productId} not found`,
    };
  }
  
  const product = result.rows[0];
  return validateGarment(product.title, product.description, product.category);
}

/**
 * Validate garment from wardrobe item ID
 */
export async function validateGarmentFromWardrobeId(
  itemId: number,
  userId: number
): Promise<ValidationResult> {
  const result = await pg.query(
    `SELECT wi.name, wi.notes, c.name as category
     FROM wardrobe_items wi
     LEFT JOIN categories c ON wi.category_id = c.id
     WHERE wi.id = $1 AND wi.user_id = $2`,
    [itemId, userId]
  );
  
  if (result.rows.length === 0) {
    return {
      valid: false,
      category: "unknown",
      tryonCategory: "unsupported",
      error: `Wardrobe item ${itemId} not found`,
    };
  }
  
  const item = result.rows[0];
  return validateGarment(item.name, item.notes, item.category);
}

/**
 * Infer try-on category from text when no exact match
 */
function inferTryOnCategory(
  title: string,
  description?: string
): TryOnCategory {
  const text = `${title} ${description || ""}`.toLowerCase();
  
  // Check for upper body keywords
  const upperBodyPatterns = [
    /\b(top|shirt|blouse|sweater|hoodie|jacket|tee)\b/i,
    /\b(بلوزة|قميص|سويتر)\b/,
  ];
  for (const pattern of upperBodyPatterns) {
    if (pattern.test(text)) return "upper_body";
  }
  
  // Check for lower body keywords
  const lowerBodyPatterns = [
    /\b(pant|jean|trouser|short|skirt|legging)\b/i,
    /\b(بنطلون|جينز|شورت)\b/,
  ];
  for (const pattern of lowerBodyPatterns) {
    if (pattern.test(text)) return "lower_body";
  }
  
  // Check for dress keywords
  const dressPatterns = [
    /\b(dress|gown|jumpsuit|romper)\b/i,
    /\b(فستان)\b/,
  ];
  for (const pattern of dressPatterns) {
    if (pattern.test(text)) return "dresses";
  }
  
  // Check for unsupported keywords
  const unsupportedPatterns = [
    /\b(shoe|sneaker|heel|boot|sandal|slipper)\b/i,
    /\b(bag|purse|clutch|tote|backpack)\b/i,
    /\b(watch|jewelry|necklace|bracelet|ring|earring)\b/i,
    /\b(belt|scarf|hat|cap|sunglasses)\b/i,
    /\b(swim|bikini|underwear|sock)\b/i,
  ];
  for (const pattern of unsupportedPatterns) {
    if (pattern.test(text)) return "unsupported";
  }
  
  // Default to upper_body as most common
  return "upper_body";
}

/**
 * Get suggestion for unsupported item
 */
function getSuggestion(category: string): string {
  const suggestions: Record<string, string> = {
    shoes: "Try the virtual try-on with a top or dress instead.",
    sneakers: "Virtual try-on works best with clothing items like shirts and dresses.",
    bag: "Bags and accessories are not supported for virtual try-on.",
    watch: "Accessories like watches are not supported for virtual try-on.",
    jewelry: "Jewelry is not supported for virtual try-on.",
    swimwear: "Swimwear is not currently supported for virtual try-on.",
  };
  
  return suggestions[category] || 
    "Try using a top, pants, skirt, or dress for the best results.";
}

// ============================================================================
// Batch Validation
// ============================================================================

/**
 * Validate multiple garments at once
 */
export function validateGarments(
  garments: Array<{ title: string; description?: string; category?: string }>
): ValidationResult[] {
  return garments.map(g => validateGarment(g.title, g.description, g.category));
}

/**
 * Filter to only valid garments for try-on
 */
export function filterValidGarments<T extends { title: string; description?: string }>(
  garments: T[]
): { valid: T[]; invalid: Array<T & { error: string }> } {
  const valid: T[] = [];
  const invalid: Array<T & { error: string }> = [];
  
  for (const garment of garments) {
    const result = validateGarment(garment.title, garment.description);
    if (result.valid) {
      valid.push(garment);
    } else {
      invalid.push({ ...garment, error: result.error || "Unsupported garment type" });
    }
  }
  
  return { valid, invalid };
}

// ============================================================================
// Category Detection Helper
// ============================================================================

/**
 * Detect category from text (simplified version)
 */
function detectCategoryFromText(title: string, description?: string): string {
  const text = `${title} ${description || ""}`.toLowerCase();
  
  // Order matters: more specific first
  const categoryPatterns: Array<[string, RegExp]> = [
    ["maxi_dress", /maxi\s*dress/i],
    ["mini_dress", /mini\s*dress/i],
    ["midi_dress", /midi\s*dress/i],
    ["tank_top", /tank\s*(top)?/i],
    ["crop_top", /crop\s*(top)?/i],
    ["t-shirt", /t-?shirt|tee\b/i],
    ["dress", /dress|gown/i],
    ["jumpsuit", /jumpsuit|romper/i],
    ["hoodie", /hoodie|hooded/i],
    ["sweatshirt", /sweatshirt/i],
    ["sweater", /sweater|pullover|knit/i],
    ["cardigan", /cardigan/i],
    ["blouse", /blouse/i],
    ["shirt", /shirt|button/i],
    ["top", /top\b/i],
    ["jeans", /jeans|denim/i],
    ["pants", /pants|trousers|chinos/i],
    ["shorts", /shorts/i],
    ["skirt", /skirt/i],
    ["leggings", /leggings|tights/i],
    ["jacket", /jacket/i],
    ["blazer", /blazer/i],
    ["coat", /coat|overcoat/i],
    ["sneakers", /sneakers?|trainers/i],
    ["heels", /heels?|pumps|stiletto/i],
    ["boots", /boots?/i],
    ["sandals", /sandals?/i],
    ["bag", /bag|handbag|purse/i],
    ["clutch", /clutch/i],
    ["backpack", /backpack|rucksack/i],
    ["watch", /watch/i],
    ["jewelry", /jewelry|jewellery/i],
    ["necklace", /necklace|pendant/i],
    ["bracelet", /bracelet|bangle/i],
    ["earrings", /earrings?/i],
    ["ring", /\bring\b/i],
    ["belt", /belt/i],
    ["scarf", /scarf|scarves/i],
    ["hat", /hat|cap|beanie/i],
    ["sunglasses", /sunglasses|shades/i],
    ["swimwear", /swimwear|swimsuit|bikini/i],
  ];
  
  for (const [category, pattern] of categoryPatterns) {
    if (pattern.test(text)) {
      return category;
    }
  }
  
  return "unknown";
}
