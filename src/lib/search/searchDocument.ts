import { extractAttributesSync } from "./attributeExtractor";
import { inferCategoryCanonical } from "./categoryFilter";
import { expandProductTypesForIndexing } from "./productTypeTaxonomy";

const LBP_TO_USD = 89000;

function toLowerTrim(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim().toLowerCase();
  return s.length > 0 ? s : null;
}

function normalizeArray(values: Array<unknown> | undefined): string[] {
  if (!Array.isArray(values) || values.length === 0) return [];
  const out: string[] = [];
  for (const value of values) {
    const normalized = toLowerTrim(value);
    if (!normalized) continue;
    if (!out.includes(normalized)) out.push(normalized);
  }
  return out;
}

/**
 * Extract canonical product-type tokens for strict matching.
 * Keep this synchronized with query-side extraction.
 */
export function extractProductTypesFromTitle(title: string): string[] {
  const normalized = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const found: string[] = [];
  const add = (t: string) => {
    if (!found.includes(t)) found.push(t);
  };

  if (!normalized) return found;

  const phrases: Array<[string, string]> = [
    ["hooded sweatshirt", "hoodie"],
    ["pullover hoodie", "hoodie"],
    ["hoodie", "hoodie"],
    ["jogging pants", "joggers"],
    ["track pants", "joggers"],
    ["sweat pants", "joggers"],
    ["crop top", "tshirt"],
    ["tank top", "tshirt"],
  ];
  for (const [needle, mapped] of phrases) {
    if (normalized.includes(needle)) add(mapped);
  }

  const tokenMap: Record<string, string> = {
    hoodi: "hoodie",
    hoodie: "hoodie",
    hoodies: "hoodie",
    hooded: "hoodie",
    sweatshirt: "hoodie",
    sweatshirts: "hoodie",
    joggin: "joggers",
    jogger: "joggers",
    joggers: "joggers",
    jogging: "joggers",
    track: "joggers",
    jean: "jeans",
    jeans: "jeans",
    denim: "jeans",
    denims: "jeans",
    tshirt: "tshirt",
    "t-shirt": "tshirt",
    tee: "tshirt",
    tees: "tshirt",
    pant: "pants",
    pants: "pants",
    trouser: "pants",
    trousers: "pants",
    leggings: "leggings",
    legging: "leggings",
    short: "shorts",
    shorts: "shorts",
    sweater: "sweater",
    sweaters: "sweater",
    blazer: "blazer",
    blazers: "blazer",
    top: "tshirt",
    tops: "tshirt",
    blouse: "tshirt",
    blouses: "tshirt",
    shirt: "tshirt",
    shirts: "tshirt",
    camisole: "tshirt",
    tunic: "tshirt",
  };

  for (const token of normalized.split(" ")) {
    const mapped = tokenMap[token];
    if (mapped) add(mapped);
  }

  return found;
}

export interface BuildSearchDocumentInput {
  productId: number | string;
  vendorId?: number | string | null;
  title: string;
  description?: string | null;
  brand?: string | null;
  category?: string | null;
  priceCents?: number | null;
  availability?: boolean | null;
  isHidden?: boolean | null;
  canonicalId?: number | string | null;
  imageCdn?: string | null;
  pHash?: string | null;
  lastSeenAt?: Date | string | null;
  embedding?: number[] | null;
  images?: Array<{ url?: string | null; p_hash?: string | null; is_primary?: boolean | null }>;
  detectedColors?: string[] | null;
  attributeEmbeddings?: {
    color?: number[];
    texture?: number[];
    material?: number[];
    style?: number[];
    pattern?: number[];
  } | null;
}

export function buildProductSearchDocument(input: BuildSearchDocumentInput): Record<string, any> {
  const { attributes } = extractAttributesSync(input.title || "");

  const normalizedDetectedColors = normalizeArray(input.detectedColors ?? undefined);
  const normalizedTitleColors = normalizeArray(
    attributes.colors && attributes.colors.length > 0
      ? attributes.colors
      : attributes.color
        ? [attributes.color]
        : []
  );
  // Merge title-based + image-based color signals.
  // This prevents strict filters from failing when the detector slightly
  // misclassifies (e.g. "black" vs "charcoal"/"gray").
  const normalizedColors: string[] = [];
  for (const c of [...normalizedTitleColors, ...normalizedDetectedColors]) {
    if (!normalizedColors.includes(c)) normalizedColors.push(c);
  }
  const normalizedMaterials = normalizeArray(
    attributes.materials && attributes.materials.length > 0
      ? attributes.materials
      : attributes.material
        ? [attributes.material]
        : []
  );

  const categoryLower = toLowerTrim(input.category);
  const categoryCanonical = inferCategoryCanonical(input.category ?? null, input.title || "");

  const doc: Record<string, any> = {
    product_id: String(input.productId),
    vendor_id: input.vendorId !== null && input.vendorId !== undefined ? String(input.vendorId) : null,
    title: input.title,
    description: input.description ?? null,
    brand: toLowerTrim(input.brand),
    category: categoryLower,
    category_canonical: categoryCanonical,
    price_usd: Math.round(Number(input.priceCents ?? 0) / LBP_TO_USD),
    availability: input.availability ? "in_stock" : "out_of_stock",
    is_hidden: Boolean(input.isHidden ?? false),
    canonical_id:
      input.canonicalId !== null && input.canonicalId !== undefined
        ? String(input.canonicalId)
        : null,
    product_types: expandProductTypesForIndexing(extractProductTypesFromTitle(input.title || "")),
    image_cdn: input.imageCdn ?? null,
    p_hash: input.pHash ?? null,
    last_seen_at: input.lastSeenAt ?? null,
    attr_color: normalizedColors[0] ?? null,
    attr_colors: normalizedColors,
    attr_material: normalizedMaterials[0] ?? null,
    attr_materials: normalizedMaterials,
    attr_fit: toLowerTrim(attributes.fit),
    attr_style: toLowerTrim(attributes.style),
    attr_gender: toLowerTrim(attributes.gender),
    attr_pattern: toLowerTrim(attributes.pattern),
    attr_sleeve: toLowerTrim(attributes.sleeve),
    attr_neckline: toLowerTrim(attributes.neckline),
    images: Array.isArray(input.images)
      ? input.images.map((img) => ({
          url: img.url ?? null,
          p_hash: img.p_hash ?? null,
          is_primary: Boolean(img.is_primary),
        }))
      : [],
  };

  if (input.embedding && input.embedding.length > 0) {
    doc.embedding = input.embedding;
  }

  if (input.attributeEmbeddings) {
    if (input.attributeEmbeddings.color?.length) doc.embedding_color = input.attributeEmbeddings.color;
    if (input.attributeEmbeddings.texture?.length) doc.embedding_texture = input.attributeEmbeddings.texture;
    if (input.attributeEmbeddings.material?.length) doc.embedding_material = input.attributeEmbeddings.material;
    if (input.attributeEmbeddings.style?.length) doc.embedding_style = input.attributeEmbeddings.style;
    if (input.attributeEmbeddings.pattern?.length) doc.embedding_pattern = input.attributeEmbeddings.pattern;
  }

  return doc;
}
