import type { RawProduct } from "../types";

const FASHION_TOKENS = [
  "dress",
  "top",
  "shirt",
  "blouse",
  "tee",
  "t-shirt",
  "sweatshirt",
  "hoodie",
  "sweater",
  "cardigan",
  "jacket",
  "coat",
  "blazer",
  "pant",
  "trouser",
  "jean",
  "skirt",
  "short",
  "jumpsuit",
  "romper",
  "shoe",
  "sneaker",
  "heel",
  "boot",
  "loafer",
  "sandal",
  "bag",
  "accessory",
  "belt",
  "scarf",
  "hat",
  "cap",
  "jewelry",
  "necklace",
  "earring",
  "ring",
  "activewear",
  "swim",
  "lingerie",
];

function toBlob(product: RawProduct): string {
  return `${product.category || ""} ${product.subcategory || ""} ${product.title || ""} ${product.description || ""}`
    .toLowerCase()
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasToken(blob: string, token: string): boolean {
  const re = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(token)}(?:$|[^a-z0-9])`, "i");
  return re.test(blob);
}

function isFashionProduct(product: RawProduct): boolean {
  const blob = toBlob(product);
  return FASHION_TOKENS.some((token) => hasToken(blob, token));
}

function normalizeToken(value: string | undefined): string {
  return (value || "").trim().toLowerCase();
}

function inferAudienceGender(product: RawProduct): "women" | "men" | "unisex" | "unknown" {
  const explicit = normalizeToken(product.gender);
  if (/(women|woman|female|ladies|lady|girl)/.test(explicit)) return "women";
  if (/(men|man|male|boy)/.test(explicit)) return "men";
  if (/(unisex|all)/.test(explicit)) return "unisex";

  const blob = toBlob(product);
  if (/(women|woman|female|ladies|lady|girl)/.test(blob)) return "women";
  if (/(men|man|male|boy)/.test(blob)) return "men";
  if (/(unisex|all-gender|all gender)/.test(blob)) return "unisex";
  return "unknown";
}

function inferAgeGroup(product: RawProduct): "adult" | "teen" | "kids" | "baby" | "unknown" {
  const explicit = normalizeToken(product.ageGroup);
  if (/(baby|infant|newborn)/.test(explicit)) return "baby";
  if (/(kids|kid|child|children|toddler)/.test(explicit)) return "kids";
  if (/(teen|youth|junior)/.test(explicit)) return "teen";
  if (/(adult|women|woman|men|man|unisex)/.test(explicit)) return "adult";

  const blob = toBlob(product);
  if (/(baby|infant|newborn)/.test(blob)) return "baby";
  if (/(kids|kid|child|children|toddler)/.test(blob)) return "kids";
  if (/(teen|youth|junior)/.test(blob)) return "teen";
  if (/(women|woman|men|man|adult|unisex)/.test(blob)) return "adult";
  return "unknown";
}

const MAJOR_CATEGORY_TOKENS: Array<{ token: string; major: string }> = [
  { token: "dress", major: "one_piece" },
  { token: "jumpsuit", major: "one_piece" },
  { token: "romper", major: "one_piece" },
  { token: "top", major: "tops" },
  { token: "shirt", major: "tops" },
  { token: "blouse", major: "tops" },
  { token: "tee", major: "tops" },
  { token: "hoodie", major: "tops" },
  { token: "sweatshirt", major: "tops" },
  { token: "sweater", major: "tops" },
  { token: "cardigan", major: "tops" },
  { token: "pants", major: "bottoms" },
  { token: "pant", major: "bottoms" },
  { token: "trouser", major: "bottoms" },
  { token: "jeans", major: "bottoms" },
  { token: "jean", major: "bottoms" },
  { token: "skirt", major: "bottoms" },
  { token: "short", major: "bottoms" },
  { token: "blazer", major: "outerwear" },
  { token: "jacket", major: "outerwear" },
  { token: "coat", major: "outerwear" },
  { token: "shoe", major: "footwear" },
  { token: "sneaker", major: "footwear" },
  { token: "heel", major: "footwear" },
  { token: "boot", major: "footwear" },
  { token: "loafer", major: "footwear" },
  { token: "sandal", major: "footwear" },
  { token: "bag", major: "accessories" },
  { token: "accessory", major: "accessories" },
  { token: "belt", major: "accessories" },
  { token: "scarf", major: "accessories" },
  { token: "hat", major: "accessories" },
  { token: "cap", major: "accessories" },
  { token: "jewelry", major: "accessories" },
  { token: "necklace", major: "accessories" },
  { token: "earring", major: "accessories" },
  { token: "ring", major: "accessories" },
];

function inferMajorCategory(product: RawProduct): string {
  const blob = toBlob(product);
  const match = MAJOR_CATEGORY_TOKENS.find((entry) => hasToken(blob, entry.token));
  if (match) return match.major;
  return normalizeToken(product.category) || "other";
}

const CATEGORY_COMPATIBILITY: Record<string, Set<string>> = {
  tops: new Set(["tops", "bottoms", "outerwear", "footwear", "accessories"]),
  bottoms: new Set(["bottoms", "tops", "outerwear", "footwear", "accessories"]),
  one_piece: new Set(["one_piece", "outerwear", "footwear", "accessories"]),
  outerwear: new Set(["outerwear", "tops", "bottoms", "one_piece", "accessories"]),
  footwear: new Set(["footwear", "tops", "bottoms", "one_piece", "accessories"]),
  accessories: new Set(["accessories", "tops", "bottoms", "one_piece", "outerwear", "footwear"]),
};

function categoriesCompatible(a: string, b: string): boolean {
  if (a === b) return true;
  const allowed = CATEGORY_COMPATIBILITY[a];
  if (!allowed) return false;
  return allowed.has(b);
}

export function validateComparableProductSet(products: RawProduct[]): {
  valid: boolean;
  nonFashionProductIds: number[];
  crossGenderPairs: Array<{ leftProductId: number; rightProductId: number; leftGender: string; rightGender: string }>;
  crossAgePairs: Array<{ leftProductId: number; rightProductId: number; leftAgeGroup: string; rightAgeGroup: string }>;
  categoryMismatchPairs: Array<{ leftProductId: number; rightProductId: number; leftCategory: string; rightCategory: string }>;
  reasons: string[];
} {
  const nonFashionProductIds = products.filter((p) => !isFashionProduct(p)).map((p) => p.id);

  const crossGenderPairs: Array<{ leftProductId: number; rightProductId: number; leftGender: string; rightGender: string }> = [];
  const crossAgePairs: Array<{ leftProductId: number; rightProductId: number; leftAgeGroup: string; rightAgeGroup: string }> = [];
  const categoryMismatchPairs: Array<{ leftProductId: number; rightProductId: number; leftCategory: string; rightCategory: string }> = [];

  for (let i = 0; i < products.length; i += 1) {
    for (let j = i + 1; j < products.length; j += 1) {
      const left = products[i];
      const right = products[j];

      const leftGender = inferAudienceGender(left);
      const rightGender = inferAudienceGender(right);
      if (
        leftGender !== "unknown" &&
        rightGender !== "unknown" &&
        leftGender !== "unisex" &&
        rightGender !== "unisex" &&
        leftGender !== rightGender
      ) {
        crossGenderPairs.push({
          leftProductId: left.id,
          rightProductId: right.id,
          leftGender,
          rightGender,
        });
      }

      const leftAgeGroup = inferAgeGroup(left);
      const rightAgeGroup = inferAgeGroup(right);
      if (
        leftAgeGroup !== "unknown" &&
        rightAgeGroup !== "unknown" &&
        leftAgeGroup !== rightAgeGroup
      ) {
        crossAgePairs.push({
          leftProductId: left.id,
          rightProductId: right.id,
          leftAgeGroup,
          rightAgeGroup,
        });
      }

      const leftCategory = inferMajorCategory(left);
      const rightCategory = inferMajorCategory(right);
      if (!categoriesCompatible(leftCategory, rightCategory) || !categoriesCompatible(rightCategory, leftCategory)) {
        categoryMismatchPairs.push({
          leftProductId: left.id,
          rightProductId: right.id,
          leftCategory,
          rightCategory,
        });
      }
    }
  }

  const reasons: string[] = [];
  if (nonFashionProductIds.length > 0) reasons.push("contains_non_fashion_products");
  if (crossGenderPairs.length > 0) reasons.push("cross_gender_not_allowed");
  if (crossAgePairs.length > 0) reasons.push("cross_age_group_not_allowed");
  if (categoryMismatchPairs.length > 0) reasons.push("category_pair_not_compatible");

  return {
    valid:
      nonFashionProductIds.length === 0 &&
      crossGenderPairs.length === 0 &&
      crossAgePairs.length === 0 &&
      categoryMismatchPairs.length === 0,
    nonFashionProductIds,
    crossGenderPairs,
    crossAgePairs,
    categoryMismatchPairs,
    reasons,
  };
}
