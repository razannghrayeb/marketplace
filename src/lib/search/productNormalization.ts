import { normalizeColorToken } from "../color/queryColorFilter";

export type NormalizedAudience = "men" | "women" | "unisex" | "unknown";

export interface NormalizedProductMetadata {
  normalizedFamily: string | null;
  normalizedType: string | null;
  normalizedSubtype: string | null;
  normalizedColor: string | null;
  normalizedAudience: NormalizedAudience;
  normalizedMaterial: string | null;
  normalizedStyle: string | null;
  normalizedOccasion: string | null;
  normalizedSilhouette: string | null;
}

function blobFromProduct(product: Record<string, unknown>): string {
  return [
    product.title,
    product.name,
    product.category,
    product.category_canonical,
    product.description,
    product.product_url,
    product.parent_product_url,
    product.brand,
    product.color,
    Array.isArray(product.product_types) ? product.product_types.join(" ") : product.product_types,
  ]
    .filter((x) => x != null)
    .map((x) => String(x).toLowerCase())
    .join(" ");
}

function normalizeFamily(blob: string): string | null {
  if (/\b(shoe|sneaker|boot|loafer|flat|sandal|heel|trainer|footwear|oxford|pump)\b/.test(blob)) return "footwear";
  if (/\b(dress|gown|frock)\b/.test(blob)) return "dresses";
  if (/\b(pant|trouser|jean|denim|short|skirt|legging|chino|cargo|slack|jogger|bottom)\b/.test(blob)) return "bottoms";
  if (/\b(top|shirt|blouse|tee|t-?shirt|sweater|hoodie|cardigan|tank|cami|polo|vest)\b/.test(blob)) return "tops";
  if (/\b(jacket|coat|blazer|parka|windbreaker|outerwear|trench|shacket)\b/.test(blob)) return "outerwear";
  if (/\b(bag|backpack|purse|clutch|tote|satchel|crossbody|handbag|wallet)\b/.test(blob)) return "bags";
  if (/\b(hat|cap|scarf|belt|glove|watch|jewel|sunglasses|accessor)\b/.test(blob)) return "accessories";
  return null;
}

function normalizeType(blob: string, family: string | null): string | null {
  if (family === "footwear") {
    if (/\b(sneaker|trainer|running shoe|low top)\b/.test(blob)) return "sneaker";
    if (/\b(boot|ankle boot|chelsea)\b/.test(blob)) return "boot";
    if (/\b(loafer)\b/.test(blob)) return "loafer";
    if (/\b(sandal|slide|flip flop)\b/.test(blob)) return "sandal";
    if (/\b(heel|pump|stiletto)\b/.test(blob)) return "heel";
    return "shoe";
  }
  if (family === "dresses") return "dress";
  if (family === "bottoms") {
    if (/\b(trouser|slack|dress pant|tailored pant|chino)\b/.test(blob)) return "trousers";
    if (/\b(jean|denim)\b/.test(blob)) return "jeans";
    if (/\b(skirt)\b/.test(blob)) return "skirt";
    if (/\b(short)\b/.test(blob)) return "shorts";
    return "pants";
  }
  if (family === "tops") {
    if (/\b(sweater|pullover|jumper|knitwear|knit)\b/.test(blob)) return "sweater";
    if (/\b(shirt|button\s*up|button-up|button\s*down|collared)\b/.test(blob)) return "shirt";
    if (/\b(blouse)\b/.test(blob)) return "blouse";
    if (/\b(polo)\b/.test(blob)) return "polo";
    if (/\b(t-?shirt|tee)\b/.test(blob)) return "tshirt";
    if (/\b(tank|cami|camisole|sleeveless)\b/.test(blob)) return "sleeveless_top";
    return "top";
  }
  if (family === "outerwear") {
    if (/\b(blazer)\b/.test(blob)) return "blazer";
    if (/\b(coat|trench|parka)\b/.test(blob)) return "coat";
    return "jacket";
  }
  if (family === "bags") return "bag";
  return null;
}

function normalizeSubtype(blob: string, family: string | null, type: string | null): string | null {
  if (family === "tops" && type === "sweater") {
    if (/\b(round neck|crew neck)\b/.test(blob)) return "knit_pullover_round_neck";
    return "knit_pullover";
  }
  if (family === "tops" && type === "shirt") {
    if (/\b(button\s*up|button-up|button\s*down|button-down)\b/.test(blob)) return "button_up_shirt";
    return "shirt";
  }
  if (family === "bottoms" && /\b(kick flare|flare|flared)\b/.test(blob)) return "kick_flare_pant";
  if (family === "bottoms" && /\b(wide\s*leg|wide-leg|palazzo)\b/.test(blob)) return "wide_leg_tailored_trousers";
  if (family === "bottoms" && /\b(denim)\b/.test(blob) && /\b(short)\b/.test(blob)) return "denim_shorts";
  if (family === "dresses" && /\b(short\s*sleeve|short-sleeve)\b/.test(blob)) return "short_sleeve_dress";
  if (family === "dresses" && /\b(beach|resort|vacation)\b/.test(blob)) return "beach_dress";
  if (family === "footwear" && /\b(low\s*top|low-top)\b/.test(blob)) return "low_top_sneaker";
  return null;
}

function normalizeAudience(product: Record<string, unknown>, blob: string): NormalizedAudience {
  const gender = String(product.gender ?? product.audience_gender ?? product.attr_gender ?? "").toLowerCase().trim();
  if (["men", "man", "male", "mens", "men's"].includes(gender)) return "men";
  if (["women", "woman", "female", "womens", "women's"].includes(gender)) return "women";
  if (["unisex", "both", "all"].includes(gender)) return "unisex";
  if (/\b(mens?|men's|boys?)\b/.test(blob)) return "men";
  if (/\b(womens?|women's|girls?)\b/.test(blob)) return "women";
  return "unknown";
}

function normalizeMaterial(blob: string): string | null {
  if (/\b(denim|jean)\b/.test(blob)) return "denim";
  if (/\b(knit|knitted|wool)\b/.test(blob)) return "knit";
  if (/\b(cotton)\b/.test(blob)) return "cotton";
  if (/\b(linen)\b/.test(blob)) return "linen";
  if (/\b(leather|suede)\b/.test(blob)) return "leather";
  if (/\b(satin|silk)\b/.test(blob)) return "silk";
  return null;
}

function normalizeStyle(blob: string): string | null {
  if (/\b(formal|tailored|business|office|smart\s*casual)\b/.test(blob)) return "smart_casual";
  if (/\b(beach|resort|vacation)\b/.test(blob)) return "beach";
  if (/\b(casual|everyday)\b/.test(blob)) return "casual";
  if (/\b(semi\s*formal|semi-formal)\b/.test(blob)) return "semi_formal";
  return null;
}

function normalizeOccasion(blob: string): string | null {
  if (/\b(beach|resort|vacation|holiday)\b/.test(blob)) return "resort";
  if (/\b(work|office|business)\b/.test(blob)) return "work";
  if (/\b(party|evening|event)\b/.test(blob)) return "evening";
  return null;
}

function normalizeSilhouette(blob: string): string | null {
  if (/\b(wide\s*leg|wide-leg|palazzo)\b/.test(blob)) return "wide_leg";
  if (/\b(flare|flared|kick flare)\b/.test(blob)) return "flare";
  if (/\b(straight)\b/.test(blob)) return "straight";
  if (/\b(slim|skinny)\b/.test(blob)) return "slim";
  return null;
}

function normalizeColor(product: Record<string, unknown>): string | null {
  const raw = String(product.color ?? "").toLowerCase().trim();
  if (!raw) return null;
  const normalized = normalizeColorToken(raw) ?? raw;
  if (normalized === "bone" || /\bbone\b/.test(raw)) return "bone/off_white";
  return normalized;
}

export function normalizeHydratedProduct(product: Record<string, unknown>): NormalizedProductMetadata {
  const blob = blobFromProduct(product);
  const normalizedFamily = normalizeFamily(blob);
  const normalizedType = normalizeType(blob, normalizedFamily);

  return {
    normalizedFamily,
    normalizedType,
    normalizedSubtype: normalizeSubtype(blob, normalizedFamily, normalizedType),
    normalizedColor: normalizeColor(product),
    normalizedAudience: normalizeAudience(product, blob),
    normalizedMaterial: normalizeMaterial(blob),
    normalizedStyle: normalizeStyle(blob),
    normalizedOccasion: normalizeOccasion(blob),
    normalizedSilhouette: normalizeSilhouette(blob),
  };
}
