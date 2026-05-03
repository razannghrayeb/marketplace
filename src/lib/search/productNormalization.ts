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

function normalizedText(raw: unknown): string {
  return String(raw ?? "").toLowerCase().trim();
}

function textValue(raw: unknown): string {
  return normalizedText(raw);
}

function arrayText(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizedText(item)).filter(Boolean);
}

function familyFromCategory(value: unknown): string | null {
  const blob = textValue(value);
  if (!blob) return null;
  if (/\b(tops?|shirts?|blouses?|tees?|t-?shirts?|sweaters?|hoodies?|sweatshirts?|cardigans?|vests?|tanks?|camis?|polos?)\b/.test(blob)) return "tops";
  if (/\b(bottoms?|pants?|trousers?|jeans?|shorts?|skirts?|leggings?|joggers?|slacks?|chinos?|cargo(?:es)?|bottom)\b/.test(blob)) return "bottoms";
  if (/\b(dresses?|gowns?|frocks?)\b/.test(blob)) return "dresses";
  if (/\b(outerwear|jackets?|coats?|blazers?|parkas?|windbreakers?|trench(?:es)?|shackets?)\b/.test(blob)) return "outerwear";
  if (/\b(footwear|shoes?|sneakers?|boots?|heels?|flats?|sandals?|loafers?|trainers?|pumps?|oxfords?)\b/.test(blob)) return "footwear";
  if (/\b(bags?|backpacks?|purses?|clutches?|totes?|satchels?|crossbodies?|handbags?|wallets?)\b/.test(blob)) return "bags";
  if (/\b(accessories?|hats?|caps?|scarves?|belts?|gloves?|watches?|sunglasses?|ties?)\b/.test(blob)) return "accessories";
  return null;
}

function familyFromProductTypes(values: string[]): string | null {
  for (const value of values) {
    const family = familyFromCategory(value);
    if (family) return family;
  }
  return null;
}

function familyFromTitle(value: unknown): string | null {
  const blob = textValue(value);
  if (!blob) return null;
  if (/\b(shoe|sneaker|boot|loafer|flat|sandal|heel|trainer)\b/.test(blob)) return "footwear";
  if (/\b(dress|gown|frock)\b/.test(blob)) return "dresses";
  if (/\b(pant|trouser|jean|denim|shorts?|skirt|legging|jogger|slack|chino|cargo|bottom)\b/.test(blob)) return "bottoms";
  if (/\b(top|shirt|blouse|tee|t.?shirt|sweater|hoodie|cardigan|vest|tank|polo|cami)\b/.test(blob)) return "tops";
  if (/\b(bag|backpack|purse|tote|clutch)\b/.test(blob)) return "bags";
  if (/\b(jacket|coat|blazer|parka|windbreaker)\b/.test(blob)) return "outerwear";
  return null;
}

function familyFromUrl(value: unknown): string | null {
  const blob = textValue(value);
  if (!blob) return null;
  return familyFromTitle(blob);
}

function familyFromDescription(value: unknown): string | null {
  const blob = textValue(value);
  if (!blob) return null;
  return familyFromTitle(blob);
}

function normalizeTypeFromCategory(category: string, family: string | null): string | null {
  if (!family) return null;
  if (family === "footwear") {
    if (/\b(sneaker|trainer|running shoe|low top)\b/.test(category)) return "sneaker";
    if (/\b(boot|ankle boot|chelsea)\b/.test(category)) return "boot";
    if (/\b(loafer)\b/.test(category)) return "loafer";
    if (/\b(sandal|slide|flip flop)\b/.test(category)) return "sandal";
    if (/\b(heel|pump|stiletto)\b/.test(category)) return "heel";
    return "shoe";
  }
  if (family === "dresses") return "dress";
  if (family === "bottoms") {
    if (/\b(trouser|slack|dress pant|tailored pant|chino)\b/.test(category)) return "trousers";
    if (/\b(jean|denim)\b/.test(category)) return "jeans";
    if (/\b(skirt)\b/.test(category)) return "skirt";
    if (/\b(short)\b/.test(category)) return "shorts";
    return "pants";
  }
  if (family === "tops") {
    if (/\b(sweater|pullover|jumper|knitwear|knit|turtleneck|turtle neck|turtle-neck)\b/.test(category)) return "sweater";
    if (/\b(shirt|button\s*up|button-up|button\s*down|collared)\b/.test(category)) return "shirt";
    if (/\b(blouse)\b/.test(category)) return "blouse";
    if (/\b(polo)\b/.test(category)) return "polo";
    if (/\b(t-?shirt|tee)\b/.test(category)) return "tshirt";
    if (/\b(tank|cami|camisole|sleeveless|vest)\b/.test(category)) return "sleeveless_top";
    return "top";
  }
  if (family === "outerwear") {
    if (/\b(blazer)\b/.test(category)) return "blazer";
    if (/\b(coat|trench|parka)\b/.test(category)) return "coat";
    return "jacket";
  }
  if (family === "bags") return "bag";
  return null;
}

function normalizeTypeFromProductTypes(types: string[], family: string | null): string | null {
  const blob = types.join(" ");
  return normalizeTypeFromCategory(blob, family);
}

function normalizeTypeFromTitle(value: unknown, family: string | null): string | null {
  const blob = textValue(value);
  return normalizeTypeFromCategory(blob, family);
}

function normalizeTypeFromUrl(value: unknown, family: string | null): string | null {
  const blob = textValue(value);
  return normalizeTypeFromCategory(blob, family);
}

function normalizeSubtypeFromPriority(params: {
  title: string;
  category: string;
  productTypes: string[];
  url: string;
}, family: string | null, type: string | null): string | null {
  const blob = [params.title, params.category, params.productTypes.join(" "), params.url].join(" ");
  if (family === "tops" && type === "sweater") {
    if (/\b(turtleneck|turtle neck|roll neck|mock neck)\b/.test(blob)) return "knit_pullover_turtleneck";
    if (/\b(knit|knitted|pullover|jumper)\b/.test(blob)) return "knit_pullover";
    return "sweater";
  }
  if (family === "tops" && type === "shirt") {
    if (/\b(button\s*up|button-up|button\s*down|button-down|collared)\b/.test(blob)) return "button_up_shirt";
    return "shirt";
  }
  if (family === "tops" && type === "sleeveless_top") {
    if (/\b(vest)\b/.test(blob) && /\b(sleeveless|tank|cami)\b/.test(blob)) return "sleeveless_top";
    return "sleeveless_top";
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
  if (/\b(semi\s*formal|semi-formal)\b/.test(blob)) return "semi_formal";
  if (/\b(formal|tailored|business|office|smart\s*casual)\b/.test(blob)) return "smart_casual";
  if (/\b(beach|resort|vacation)\b/.test(blob)) return "beach";
  if (/\b(casual|everyday)\b/.test(blob)) return "casual";
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

function extractColorFromText(text: unknown): string | null {
  const raw = normalizedText(text);
  if (!raw) return null;
  const direct = normalizeColorToken(raw);
  if (direct) return direct;
  const parts = raw.split(/[^a-z0-9]+/g).filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const one = normalizeColorToken(parts[i]);
    if (one) return one;
    if (i < parts.length - 1) {
      const two = normalizeColorToken(`${parts[i]} ${parts[i + 1]}`);
      if (two) return two;
    }
    if (i < parts.length - 2) {
      const three = normalizeColorToken(`${parts[i]} ${parts[i + 1]} ${parts[i + 2]}`);
      if (three) return three;
    }
  }
  return null;
}

function normalizeColorFromPriority(
  product: Record<string, unknown>,
  title: string,
  url: string,
  category: string,
): string | null {
  const structured = normalizeColorToken(normalizedText(product.color));
  if (structured) return structured === "bone" ? "bone/off_white" : structured;

  const titleColor = extractColorFromText(title);
  if (titleColor) return titleColor === "bone" ? "bone/off_white" : titleColor;

  const urlColor = extractColorFromText(url);
  if (urlColor) return urlColor === "bone" ? "bone/off_white" : urlColor;

  const categoryColor = extractColorFromText(category);
  if (categoryColor) return categoryColor === "bone" ? "bone/off_white" : categoryColor;

  return null;
}

export function normalizeHydratedProduct(product: Record<string, unknown>): NormalizedProductMetadata {
  const title = textValue(product.title ?? product.name);
  const category = textValue(product.category_canonical ?? product.category);
  const productTypes = arrayText(product.product_types);
  const url = textValue(product.product_url ?? product.parent_product_url);
  const description = textValue(product.description);

  const normalizedFamily =
    familyFromCategory(category) ??
    familyFromProductTypes(productTypes) ??
    familyFromTitle(title) ??
    familyFromUrl(url) ??
    familyFromDescription(description);

  const normalizedType =
    normalizeTypeFromCategory(category, normalizedFamily) ??
    normalizeTypeFromProductTypes(productTypes, normalizedFamily) ??
    normalizeTypeFromTitle(title, normalizedFamily) ??
    normalizeTypeFromUrl(url, normalizedFamily);

  return {
    normalizedFamily,
    normalizedType,
    normalizedSubtype: normalizeSubtypeFromPriority({ title, category, productTypes, url }, normalizedFamily, normalizedType),
    normalizedColor: normalizeColorFromPriority(product, title, url, category),
    normalizedAudience: normalizeAudience(product, [title, category, productTypes.join(" "), url, description].join(" ")),
    normalizedMaterial: normalizeMaterial(`${title} ${category}`),
    normalizedStyle: normalizeStyle(`${title} ${category}`),
    normalizedOccasion: normalizeOccasion(`${title} ${category}`),
    normalizedSilhouette: normalizeSilhouette(`${title} ${category}`),
  };
}
