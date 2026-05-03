/**
 * Post-hydration family and audience guards
 *
 * Applies hard rules after product hydration to ensure:
 * 1. Product family matches detection family (prevent shoes→dresses)
 * 2. Audience is resolved accurately from metadata
 * 3. Cross-gender mismatches apply appropriate penalties
 */

/**
 * Extract normalized family from product metadata
 * Priority: category_canonical > category > product_types > title
 */
export function extractProductFamily(product: any): string | null {
  const normalizedFamily = String(product?.normalizedFamily ?? "").toLowerCase().trim();
  if (normalizedFamily) return normalizeFamily(normalizedFamily);

  const canonical = String(product?.category_canonical ?? "").toLowerCase().trim();
  if (isValidFamily(canonical)) return normalizeFamily(canonical);

  const category = String(product?.category ?? "").toLowerCase().trim();
  if (isValidFamily(category)) return normalizeFamily(category);

  const types = Array.isArray(product?.product_types)
    ? product.product_types.map((t) => String(t).toLowerCase().trim()).filter(Boolean)
    : [];
  for (const type of types) {
    if (isValidFamily(type)) return normalizeFamily(type);
  }

  const title = String(product?.name ?? product?.title ?? "").toLowerCase().trim();
  if (title) {
    const inferred = inferFamilyFromTitle(title);
    if (inferred) return inferred;
  }

  return null;
}

/**
 * Normalize family name to canonical form
 */
export function normalizeFamily(raw: string): string {
  const s = String(raw ?? "").toLowerCase().trim();

  // Tops family
  if (/\b(top|shirt|blouse|tee|t.?shirt|sweater|hoodie|sweatshirt|cardigan|vest|tank|cami|polo|long.?sleeve|short.?sleeve)\b/.test(s)) {
    return "tops";
  }

  // Bottoms family
  if (/\b(pant|trouser|jean|denim|short|skirt|legging|jogger|slack|chino|cargo|bottom)\b/.test(s)) {
    return "bottoms";
  }

  // Dresses family
  if (/\b(dress)\b/.test(s)) {
    return "dresses";
  }

  // Outerwear family
  if (/\b(jacket|coat|blazer|outerwear|parka|windbreaker|hoodie|sweater.?coat)\b/.test(s)) {
    return "outerwear";
  }

  // Footwear family
  if (/\b(shoe|sneaker|boot|heel|flat|sandal|loafer|flip.?flop|footwear|trainer|pump)\b/.test(s)) {
    return "footwear";
  }

  // Bags family
  if (/\b(bag|backpack|purse|clutch|tote|satchel|crossbody|handbag|wallet)\b/.test(s)) {
    return "bags";
  }

  // Accessories family
  if (/\b(accessory|hat|cap|scarf|belt|glove|jewelry|watch|sunglasses|tie|pocket|square)\b/.test(s)) {
    return "accessories";
  }

  return null;
}

/**
 * Check if a string represents a valid product family
 */
function isValidFamily(s: string): boolean {
  const families = ["tops", "bottoms", "dresses", "outerwear", "footwear", "bags", "accessories"];
  return families.includes(String(s ?? "").toLowerCase().trim());
}

/**
 * Infer family from product title
 */
function inferFamilyFromTitle(title: string): string | null {
  const t = String(title ?? "").toLowerCase().trim().slice(0, 300);

  // Check each family with keywords
  if (/\b(shoe|sneaker|boot|loafer|flat|sandal|heel|trainer)\b/.test(t)) return "footwear";
  if (/\b(dress)\b/.test(t)) return "dresses";
  if (/\b(pant|trouser|jean|denim|shorts?|skirt|legging|jogger)\b/.test(t)) return "bottoms";
  if (/\b(top|shirt|blouse|tee|t.?shirt|sweater|hoodie|cardigan|vest|tank|polo|cami)\b/.test(t)) return "tops";
  if (/\b(bag|backpack|purse|tote|clutch)\b/.test(t)) return "bags";
  if (/\b(jacket|coat|blazer|parka|windbreaker)\b/.test(t)) return "outerwear";

  return null;
}

/**
 * Apply hard family guard: drop product if it doesn't match intent family
 * Returns true if product should be kept, false if it should be dropped
 */
export function applyFamilyGuard(intentFamily: string | null, productFamily: string | null): boolean {
  // No intent family → no guard, keep product
  if (!intentFamily) return true;

  // No product family → drop (unknown product)
  if (!productFamily) return false;

  // Same family → keep
  if (intentFamily === productFamily) return true;

  // Different family → drop (hard guard)
  return false;
}

/**
 * Resolve audience (gender) from product metadata
 * Returns: "men" | "women" | "unisex" | "unknown"
 */
export function resolveProductAudience(product: any): string {
  const normalizedAudience = String(product?.normalizedAudience ?? "").toLowerCase().trim();
  if (["men", "women", "unisex", "unknown"].includes(normalizedAudience)) {
    return normalizedAudience;
  }

  // Check explicit gender field
  const gender = String(product?.gender ?? product?.audience ?? "").toLowerCase().trim();
  if (gender === "men" || gender === "m" || gender === "male") return "men";
  if (gender === "women" || gender === "w" || gender === "female") return "women";
  if (gender === "unisex" || gender === "both" || gender === "all") return "unisex";

  // Try to infer from URL
  const url = String(product?.product_url ?? product?.url ?? "").toLowerCase();
  if (url) {
    if (/\b(mens?|boys?|men's)\b/.test(url)) return "men";
    if (/\b(womens?|girls?|women's)\b/.test(url)) return "women";
  }

  // Try to infer from category
  const category = String(product?.category ?? product?.category_canonical ?? "").toLowerCase();
  if (category) {
    if (/\b(mens?|boys?|men's)\b/.test(category)) return "men";
    if (/\b(womens?|girls?|women's)\b/.test(category)) return "women";
  }

  // Try to infer from brand collection
  const brand = String(product?.brand ?? "").toLowerCase();
  const collection = String(product?.collection ?? "").toLowerCase();
  const brandCollection = [brand, collection].join(" ");
  if (brandCollection) {
    if (/\b(mens?|boys?)\b/.test(brandCollection)) return "men";
    if (/\b(womens?|girls?)\b/.test(brandCollection)) return "women";
  }

  // Try to infer from title
  const title = String(product?.name ?? product?.title ?? "").toLowerCase();
  if (title) {
    if (/\b(mens?|boys?|men's)\b/.test(title)) return "men";
    if (/\b(womens?|girls?|women's)\b/.test(title)) return "women";
  }

  return "unknown";
}

/**
 * Calculate audience score (0..1) accounting for mismatches
 * - same audience: 1.0
 * - unisex: 0.82
 * - unknown: 0.55 (allow but penalize)
 * - opposite gender: 0.10
 */
export function computeAudienceScore(intentAudience: string | null, productAudience: string): number {
  if (!intentAudience || intentAudience === "unisex") {
    // No intent or unisex intent → all products acceptable
    if (productAudience === "unisex") return 0.82;
    if (productAudience === "unknown") return 0.55;
    return 1.0; // men/women allowed
  }

  if (intentAudience === "unisex") {
    // Unisex intent
    if (productAudience === "unisex") return 1.0;
    if (productAudience === "unknown") return 0.78;
    return 0.82; // men/women somewhat acceptable
  }

  // Specific gender intent (men/women)
  if (intentAudience === productAudience) return 1.0; // exact match
  if (productAudience === "unisex") return 0.82; // unisex acceptable
  if (productAudience === "unknown") return 0.55; // unknown acceptable but penalized
  return 0.10; // opposite gender - hard penalty
}

/**
 * Get maximum final relevance cap based on audience match
 * - same gender: no cap
 * - unisex: no cap
 * - unknown: 0.78 (allow but limit)
 * - opposite gender: 0.48 (hard cap)
 */
export function getAudienceCap(intentAudience: string | null, productAudience: string): number {
  if (!intentAudience) return 1.0;

  if (intentAudience === productAudience) return 1.0;
  if (productAudience === "unisex") return 1.0;
  if (productAudience === "unknown") return 0.78;
  // opposite gender
  return 0.48;
}

/**
 * Verify product after hydration against intent
 * Returns object with: { isValid, reason, shouldDrop, audienceCap }
 */
export function verifyProductPostHydration(
  product: any,
  intentFamily: string | null,
  intentAudience: string | null
): {
  isValid: boolean;
  reason?: string;
  shouldDrop: boolean;
  audienceCap: number;
} {
  const productFamily = extractProductFamily(product);
  const productAudience = resolveProductAudience(product);

  // Hard family guard
  if (!applyFamilyGuard(intentFamily, productFamily)) {
    return {
      isValid: false,
      reason: `Family mismatch: expected ${intentFamily}, got ${productFamily}`,
      shouldDrop: true,
      audienceCap: 1.0,
    };
  }

  // Audience cap (soft, not hard drop)
  const audienceCap = getAudienceCap(intentAudience, productAudience);

  return {
    isValid: true,
    audienceCap,
  };
}
