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
  if (/\b(bags?|backpacks?|purses?|clutches?|totes?|satchels?|crossbody|crossbodies|hand\s*bags?|handbags?|wallets?|briefcases?|luggage|suitcases?|trolley cases?|duffle|messenger|reporter|pouches?|bumbag|waist bags?|top handle bags?|shoulder bags?|phone bags?|laptop bags?|computer bags?)\b/.test(blob)) return "bags";
  if (/\b(footwear|shoes?|sneakers?|boots?|heels?|flats?|ballerinas?|sandals?|loafers?|trainers?|pumps?|oxfords?|clogs?|slides?|espadrilles?|hikers?|aqua shoes?|boat shoes?|dress shoes?|ski boots?|snowboard boots?|snow shoes?)\b/.test(blob)) return "footwear";
  if (/\b(dresses?|gowns?|frocks?|abayas?|kaftans?|jumpsuits?|playsuits?|jumpplaysuits|rompers?|dress\/top|jilbab|kimono)\b/.test(blob)) return "dresses";
  if (/\b(outerwear|outwear|jackets?|coats?|coats?\s*&\s*jackets?|blazers?|parkas?(?:\s*&\s*blousons)?|windbreakers?|trench(?:es)?|shackets?|denim jacket|sw\.jacket)\b/.test(blob)) return "outerwear";
  if (/\b(bottoms?|pants?|trousers?|jeans?|shorts?|skirts?|skorts?|leggings?|joggers?|slacks?|chinos?|cargo(?:es)?|bottom|bermudas?|tights?|3\/4 pant|3\/4 tight|7\/8 tight|track trousers?)\b/.test(blob)) return "bottoms";
  if (/\b(tops?|shirts?|shirt-[a-z]+|blouses?|tees?|t-?\s?shirts?|sweaters?|pullovers?|pulovers?|hoodies?|hoody|sweatshirts?|cardigans?|vests?|tanks?|camis?|polos?|knitwear|knit tops?|basic top|crop top|long sleeve|sleeveless|track top|rugby shirts?|woven tops?|woven shirts?|bodysuits?|body suit|bodies|baselayer)\b/.test(blob)) return "tops";
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
  if (/\b(top|shirt|blouse|tee|t.?shirt|sweater|hoodie|cardigan|vest|tank|polo|cami|pullover|jumper|knitwear|knit|turtleneck)\b/.test(blob)) return "tops";
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
  if (!category.trim()) return null;
  if (family === "footwear") {
    if (/\b(sneaker|trainer|running shoe|low top)\b/.test(category)) return "sneaker";
    if (/\b(boot|ankle boot|chelsea)\b/.test(category)) return "boot";
    if (/\b(loafer)\b/.test(category)) return "loafer";
    if (/\b(sandal|slide|flip flop)\b/.test(category)) return "sandal";
    if (/\b(flat|ballerinas?)\b/.test(category)) return "flat";
    if (/\b(heel|pump|stiletto)\b/.test(category)) return "heel";
    return "shoe";
  }
  if (family === "dresses") return "dress";
  if (family === "bottoms") {
    if (/\b(trousers?|slacks?|dress pants?|tailored pants?|chinos?)\b/.test(category)) return "trousers";
    if (/\b(jeans?|denim)\b/.test(category)) return "jeans";
    if (/\b(skirts?)\b/.test(category)) return "skirt";
    if (/\b(short|bermuda)\b/.test(category)) return "shorts";
    if (/\b(tights?|leggings?)\b/.test(category)) return "leggings";
    return "pants";
  }
  if (family === "tops") {
    return normalizeTopType(category);
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
  if (types.length === 0) return null;
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
    return normalizeSweaterSubtype(blob) ?? "sweater";
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
  if (family === "bottoms" && /\b(wide\s*leg|wide-leg|palazzo)\b/.test(blob)) return "wide_leg_trouser";
  if (family === "bottoms" && /\b(cargo|utility)\b/.test(blob)) return "cargo_pant";
  if (family === "bottoms" && /\b(denim)\b/.test(blob) && /\b(short)\b/.test(blob)) return "denim_shorts";
  if (family === "dresses" && /\b(tank|sleeveless|cami|camisole)\b/.test(blob)) return "tank_dress";
  if (family === "dresses" && /\b(slip)\b/.test(blob)) return "slip_dress";
  if (family === "dresses" && /\b(maxi)\b/.test(blob)) return "maxi_dress";
  if (family === "dresses" && /\b(midi)\b/.test(blob)) return "midi_dress";
  if (family === "dresses" && /\b(mini)\b/.test(blob)) return "mini_dress";
  if (family === "dresses" && /\b(short\s*sleeve|short-sleeve)\b/.test(blob)) return "short_sleeve_dress";
  if (family === "dresses" && /\b(beach|resort|vacation)\b/.test(blob)) return "beach_dress";
  if (family === "footwear" && /\b(sneaker|trainer|running shoe)\b/.test(blob)) return "sneaker";
  if (family === "footwear" && /\b(low\s*top|low-top)\b/.test(blob)) return "low_top_sneaker";
  if (family === "bags" && /\b(backpack|rucksack)\b/.test(blob)) return "backpack";
  if (family === "bags" && /\b(crossbody|cross-body)\b/.test(blob)) return "crossbody";
  if (family === "bags" && /\b(tote)\b/.test(blob)) return "tote";
  if (family === "bags" && /\b(clutch)\b/.test(blob)) return "clutch";
  return null;
}

function normalizeTopType(blob: string): string {
  const b = blob.toLowerCase();

  if (/\bpolo\b|\bpolo\s*shirt\b|\bpolos\b/.test(b)) return "polo";
  if (/\bt-?shirt\b|\btshirts\b|\bt-shirts\b|\btee\b|\btees\b/.test(b)) return "tshirt";
  if (/\bsweatshirt\b|\bsweatshirts\b/.test(b)) return "sweatshirt";
  if (/\bhoodie\b|\bhoodies\b/.test(b)) return "hoodie";
  if (/\bcardigan\b|\bcardigans\b/.test(b)) return "cardigan";
  if (/\bsweater\b|\bpullover\b|\bpulovers\b|\bjumper\b|\bknitwear\b|\bknit\b|\bturtleneck\b|\bturtle neck\b|\bturtle-neck\b/.test(b)) return "sweater";
  if (/\bbutton\s*up\b|\bbutton-up\b|\bbutton\s*down\b|\bbutton-down\b|\bdress\s*shirt\b|\bcollared\s*shirt\b/.test(b)) return "shirt";
  if (/\bblouse\b|\bblouses\b/.test(b)) return "blouse";
  if (/\btank\b|\bcami\b|\bcamisole\b|\bsleeveless\b/.test(b)) return "sleeveless_top";
  if (/\bshirt\b|\bshirts\b/.test(b)) return "shirt";
  return "top";
}

function normalizeSweaterSubtype(text: string): string | null {
  const b = text.toLowerCase();

  if (/\bturtleneck\b|\bturtle neck\b|\bturtle-neck\b|\broll neck\b|\bmock neck\b/.test(b)) return "turtleneck_sweater";
  if (/\bhalf[-\s]?zip\b|\bzipper\b|\bzip neck\b/.test(b)) return "half_zip_sweater";
  if (/\bcardigan\b|\bcardigans\b/.test(b)) return "cardigan";
  if (/\bpullover\b|\bpulovers\b|\bjumper\b/.test(b)) return "pullover";
  if (/\bknitwear\b|\bknit\b|\bknitted\b/.test(b)) return "knitwear";
  if (/\bsweater\b/.test(b)) return "sweater";

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
  const titleColorNoise = new Set([
    "cotton",
    "organic",
    "linen",
    "wool",
    "leather",
    "suede",
    "knit",
    "knitwear",
    "waffle",
    "rib",
    "ribbed",
    "tank",
    "dress",
    "shirt",
    "top",
    "trouser",
    "trousers",
    "pant",
    "pants",
    "sweater",
    "pullover",
    "backpack",
    "bag",
  ]);
  const parts = raw.split(/[^a-z0-9]+/g).filter(Boolean);
  const normalizeTitleColorPhrase = (phrase: string): string | null => {
    const phraseParts = phrase.split(/\s+/g).filter(Boolean);
    if (phraseParts.length > 0 && phraseParts.every((part) => titleColorNoise.has(part))) return null;
    return normalizeColorToken(phrase);
  };
  for (let i = 0; i < parts.length; i++) {
    const one = titleColorNoise.has(parts[i]) ? null : normalizeColorToken(parts[i]);
    if (one) return one;
    if (i < parts.length - 1) {
      const two = normalizeTitleColorPhrase(`${parts[i]} ${parts[i + 1]}`);
      if (two) return two;
    }
    if (i < parts.length - 2) {
      const three = normalizeTitleColorPhrase(`${parts[i]} ${parts[i + 1]} ${parts[i + 2]}`);
      if (three) return three;
    }
  }
  return null;
}

function normalizeColorFromPriority(
  product: Record<string, unknown>,
  title: string,
  url: string,
): string | null {
  const structured = normalizeColorToken(normalizedText(product.color));
  if (structured) return structured === "bone" ? "bone/off_white" : structured;

  const titleColor = extractColorFromText(title);
  if (titleColor) return titleColor === "bone" ? "bone/off_white" : titleColor;

  const urlColor = extractColorFromText(url);
  if (urlColor) return urlColor === "bone" ? "bone/off_white" : urlColor;

  return null;
}

export function normalizeHydratedProduct(product: Record<string, unknown>): NormalizedProductMetadata {
  const title = textValue(product.title ?? product.name);
  const category = textValue(product.category);
  const canonical = textValue(product.category_canonical);
  const structured = [canonical, category].filter(Boolean).join(" ");
  const productTypes = arrayText(product.product_types);
  const structuredWithTypes = [structured, productTypes.join(" ")].filter(Boolean).join(" ");
  const url = textValue(product.product_url ?? product.parent_product_url);
  const description = textValue(product.description);

  const normalizedFamily =
    familyFromCategory(structuredWithTypes) ??
    familyFromProductTypes(productTypes) ??
    familyFromTitle(title) ??
    familyFromUrl(url) ??
    familyFromDescription(description);

  const normalizedType =
    normalizeTypeFromCategory(structuredWithTypes, normalizedFamily) ??
    normalizeTypeFromProductTypes(productTypes, normalizedFamily) ??
    normalizeTypeFromTitle(title, normalizedFamily) ??
    normalizeTypeFromUrl(url, normalizedFamily) ??
    normalizeTypeFromTitle(description, normalizedFamily);

  return {
    normalizedFamily,
    normalizedType,
    normalizedSubtype: normalizeSubtypeFromPriority({ title, category: structured || category, productTypes, url }, normalizedFamily, normalizedType),
    normalizedColor: normalizeColorFromPriority(product, title, url),
    normalizedAudience: normalizeAudience(product, [title, category, productTypes.join(" "), url].join(" ")),
    normalizedMaterial: normalizeMaterial(`${title} ${category}`),
    normalizedStyle: normalizeStyle(`${title} ${category}`),
    normalizedOccasion: normalizeOccasion(`${title} ${category}`),
    normalizedSilhouette: normalizeSilhouette(`${title} ${category}`),
  };
}
