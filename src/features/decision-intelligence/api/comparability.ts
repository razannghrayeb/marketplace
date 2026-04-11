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
  return `${product.category || ""} ${product.subcategory || ""} ${product.title || ""}`
    .toLowerCase()
    .trim();
}

function isFashionProduct(product: RawProduct): boolean {
  const blob = toBlob(product);
  return FASHION_TOKENS.some((token) => blob.includes(token));
}

export function validateComparableProductSet(products: RawProduct[]): {
  valid: boolean;
  nonFashionProductIds: number[];
} {
  const nonFashionProductIds = products.filter((p) => !isFashionProduct(p)).map((p) => p.id);
  return {
    valid: nonFashionProductIds.length === 0,
    nonFashionProductIds,
  };
}
