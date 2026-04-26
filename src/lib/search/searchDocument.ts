import { extractAttributesSync } from "./attributeExtractor";
import type { GarmentColorAnalysis } from "../color/garmentColorPipeline";
import { normalizeCatalogColorToCanonical } from "../color/garmentColorPipeline";
import { inferCategoryCanonical } from "./categoryFilter";
import {
  expandProductTypesForIndexing,
  extractLexicalProductTypeSeeds,
  filterProductTypeSeedsByMappedCategory,
} from "./productTypeTaxonomy";
import { canonicalTypeIdsToProductTypeTokens } from "./loadProductSearchEnrichment";

const LBP_TO_USD = 89000;

/** Indexed audience signals (canonical enums) derived from title + extracted gender. */
function inferAudienceFromTitle(
  title: string,
  attrGender: string | null,
): { audience_gender: string | null; age_group: string } {
  const t = (title || "").toLowerCase();
  let age_group = "adult";
  if (/\b(baby|infant|newborn)\b/.test(t)) age_group = "baby";
  else if (/\b(toddler)\b/.test(t)) age_group = "kids";
  else if (/\b(teen|youth)\b/.test(t)) age_group = "teen";
  else if (/\b(kids?|children|child|boys?|girls?)\b/.test(t)) age_group = "kids";

  let audience_gender: string | null = null;
  const ag = attrGender ? String(attrGender).toLowerCase().trim() : "";
  if (ag === "men" || ag === "women" || ag === "unisex") audience_gender = ag;
  else if (ag === "boys" || ag === "girls") {
    audience_gender = ag;
    age_group = "kids";
  } else if (/\b(men|mens|male)\b/.test(t)) audience_gender = "men";
  else if (/\b(women|womens|female|ladies)\b/.test(t)) audience_gender = "women";
  else if (/\b(unisex)\b/.test(t)) audience_gender = "unisex";

  return { audience_gender, age_group };
}

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
    ["abaya", "abaya"],
    ["abayas", "abaya"],
    ["kaftan", "kaftan"],
    ["caftan", "kaftan"],
    ["jalabiya", "abaya"],
    ["thobe", "abaya"],
    ["dishdasha", "abaya"],
    ["salwar kameez", "kameez"],
    ["shalwar kameez", "kameez"],
    ["lehenga choli", "lengha"],
    ["sherwani suit", "sherwani"],
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
    shorts: "shorts",
    sweater: "sweater",
    sweaters: "sweater",
    blazer: "blazer",
    blazers: "blazer",
    top: "top",
    tops: "tops",
    blouse: "blouse",
    blouses: "blouse",
    shirt: "shirt",
    shirts: "shirt",
    camisole: "tshirt",
    tunic: "top",
    abaya: "abaya",
    abayas: "abaya",
    kaftan: "kaftan",
    kaftans: "kaftan",
    caftan: "kaftan",
    caftans: "kaftan",
    jalabiya: "abaya",
    thobe: "abaya",
    thobes: "abaya",
    dishdasha: "abaya",
    bisht: "abaya",
    sherwani: "sherwani",
    kurta: "kurta",
    kurti: "kurti",
    kurtis: "kurti",
    salwar: "salwar",
    shalwar: "salwar",
    kameez: "kameez",
    churidar: "churidar",
    lengha: "lengha",
    lehenga: "lengha",
    sari: "sari",
    saree: "sari",
    dupatta: "dupatta",
    dirac: "dirac",
    hijab: "hijab",
    hijabs: "hijab",
    headscarf: "hijab",
    niqab: "niqab",
    burqa: "burqa",
    headwrap: "hijab",
  };

  for (const token of normalized.split(" ")) {
    const mapped = tokenMap[token];
    if (mapped) add(mapped);
  }

  return found;
}

/** Optional row from `product_search_enrichment` (Phase 2). */
export interface BuildSearchDocumentEnrichmentInput {
  norm_confidence?: number;
  category_confidence?: number;
  brand_confidence?: number;
  canonical_type_ids?: string[];
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
  /** Garment-focused CLIP embedding (ROI / center crop) — dual-write with `embedding`. */
  embeddingGarment?: number[] | null;
  images?: Array<{ url?: string | null; p_hash?: string | null; is_primary?: boolean | null }>;
  detectedColors?: string[] | null;
  /** When set, overrides coarse `detectedColors` for canonical fields and confidence. */
  garmentColorAnalysis?: GarmentColorAnalysis | null;
  /** From `products.color` when title/image did not yield color (e.g. BLIP backfill). */
  catalogColor?: string | null;
  /** From `products.gender` when title did not yield gender (e.g. BLIP backfill). */
  catalogGender?: string | null;
  enrichment?: BuildSearchDocumentEnrichmentInput | null;
  attributeEmbeddings?: {
    color?: number[];
    texture?: number[];
    material?: number[];
    style?: number[];
    pattern?: number[];
  } | null;
}

export function buildProductSearchDocument(input: BuildSearchDocumentInput): Record<string, any> {
  const { attributes, confidence: attrConfidence } = extractAttributesSync(input.title || "");

  const analysis = input.garmentColorAnalysis ?? null;
  const normalizedDetectedFromLegacy = normalizeArray(input.detectedColors ?? undefined);
  const normalizedDetectedColors = analysis
    ? normalizeArray(analysis.paletteCanonical)
    : normalizedDetectedFromLegacy;
  let normalizedTitleColors = normalizeArray(
    attributes.colors && attributes.colors.length > 0
      ? attributes.colors
      : attributes.color
        ? [attributes.color]
        : [],
  );
  const catalogColorHint = toLowerTrim(input.catalogColor ?? null);
  // Map raw vendor color string to a canonical token before using it in index fields.
  // e.g. "Navy Blue" → "navy", "#1A2B3C" → "navy", "blush" → "pink".
  const catalogCanonical = normalizeCatalogColorToCanonical(catalogColorHint);
  const normalizedCatalogColors = catalogCanonical ? [catalogCanonical] : [];
  if (normalizedTitleColors.length === 0 && normalizedCatalogColors.length > 0) {
    normalizedTitleColors = normalizeArray([catalogCanonical]);
  }
  const colorConfidenceText =
    normalizedTitleColors.length > 0 ? Math.max(0.35, attrConfidence.color ?? 0.52) : 0;
  const colorConfidenceImage = analysis
    ? Math.max(0.2, Math.min(0.95, analysis.confidencePrimary))
    : normalizedDetectedColors.length > 0
      ? Math.min(0.92, 0.58 + 0.12 * normalizedDetectedColors.length)
      : 0;

  // Merge catalog + title + image for backward-compatible `attr_colors` / BM25 / legacy filters.
  const normalizedColors: string[] = [];
  for (const c of [...normalizedCatalogColors, ...normalizedTitleColors, ...normalizedDetectedColors]) {
    if (!normalizedColors.includes(c)) normalizedColors.push(c);
  }

  const attrColorPrimary =
    normalizedCatalogColors[0] ??
    normalizedDetectedColors[0] ??
    normalizedTitleColors[0] ??
    null;
  const attrColorSource: "catalog" | "image" | "text" | "none" =
    normalizedCatalogColors.length > 0
      ? "catalog"
      : normalizedDetectedColors.length > 0
        ? "image"
        : normalizedTitleColors.length > 0
          ? "text"
          : "none";

  const enrich = input.enrichment;
  const normConfidence =
    typeof enrich?.norm_confidence === "number" && Number.isFinite(enrich.norm_confidence)
      ? Math.max(0, Math.min(1, enrich.norm_confidence))
      : 0.42;
  const categoryConfidence =
    typeof enrich?.category_confidence === "number" && Number.isFinite(enrich.category_confidence)
      ? Math.max(0, Math.min(1, enrich.category_confidence))
      : 0.48;
  const brandConfidence =
    typeof enrich?.brand_confidence === "number" && Number.isFinite(enrich.brand_confidence)
      ? Math.max(0, Math.min(1, enrich.brand_confidence))
      : 0;

  const categoryLower = toLowerTrim(input.category);
  const categoryCanonical = inferCategoryCanonical(input.category ?? null, input.title || "");

  const titleTypesRaw = extractProductTypesFromTitle(input.title || "");
  const titleTypes =
    categoryCanonical && categoryCanonical !== "all"
      ? filterProductTypeSeedsByMappedCategory(titleTypesRaw, categoryCanonical)
      : titleTypesRaw;
  const descriptionSeedsLexicalRaw = input.description
    ? extractLexicalProductTypeSeeds(input.description)
    : [];
  const descriptionSeedsLexical =
    categoryCanonical && categoryCanonical !== "all"
      ? filterProductTypeSeedsByMappedCategory(descriptionSeedsLexicalRaw, categoryCanonical)
      : descriptionSeedsLexicalRaw;

  // Keep precision: description is noisier than title, so cap how many
  // description-derived type seeds we merge in.
  const extraSeedsFromDescriptionMax = titleTypes.length > 0 ? 2 : 4;
  const descriptionSeedsLimited = descriptionSeedsLexical
    .filter((t) => t && t.length >= 2)
    .slice()
    .sort((a, b) => b.length - a.length) // prefer longer phrases like "mini dress"
    .slice(0, extraSeedsFromDescriptionMax);

  const enrichTokens = canonicalTypeIdsToProductTypeTokens(enrich?.canonical_type_ids ?? []);
  const mergedTypeSeeds = [...titleTypes];
  for (const t of descriptionSeedsLimited) {
    if (!mergedTypeSeeds.includes(t)) mergedTypeSeeds.push(t);
  }
  for (const t of enrichTokens) {
    if (!mergedTypeSeeds.includes(t)) mergedTypeSeeds.push(t);
  }
  const productTypesIndexed = expandProductTypesForIndexing(mergedTypeSeeds);
  const typeConfidence = (() => {
    const fromEnrich =
      enrichTokens.length > 0
        ? Math.min(0.92, 0.56 + 0.12 * Math.min(enrichTokens.length, 3))
        : 0;
    const fromTitle =
      mergedTypeSeeds.length > 0
        ? Math.min(0.88, 0.42 + 0.12 * Math.min(mergedTypeSeeds.length, 4))
        : 0.35;
    return Math.max(fromEnrich, fromTitle, 0.32);
  })();

  const normalizedMaterials = normalizeArray(
    attributes.materials && attributes.materials.length > 0
      ? attributes.materials
      : attributes.material
        ? [attributes.material]
        : []
  );

  const primaryAttrColor = toLowerTrim(attrColorPrimary);
  const attrGenderRaw =
    toLowerTrim(attributes.gender) || toLowerTrim(input.catalogGender ?? null);
  const audience = inferAudienceFromTitle(input.title || "", attrGenderRaw);

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
    product_types: productTypesIndexed,
    norm_confidence: normConfidence,
    category_confidence: categoryConfidence,
    brand_confidence: brandConfidence,
    type_confidence: typeConfidence,
    color_confidence_text: colorConfidenceText,
    color_confidence_image: colorConfidenceImage,
    image_cdn: input.imageCdn ?? null,
    p_hash: input.pHash ?? null,
    last_seen_at: input.lastSeenAt ?? null,
    attr_color: primaryAttrColor,
    attr_colors: normalizedColors,
    attr_colors_text: normalizedTitleColors,
    attr_colors_image: normalizedDetectedColors,
    attr_color_source: attrColorSource,
    color_primary_canonical: normalizedCatalogColors[0] ?? (analysis ? analysis.primaryCanonical : toLowerTrim(attrColorPrimary)),
    color_secondary_canonical: analysis?.secondaryCanonical ?? null,
    color_accent_canonical: analysis?.accentCanonical ?? null,
    color_palette_canonical: analysis ? analysis.paletteCanonical : normalizedDetectedColors,
    color_confidence_primary: analysis ? analysis.confidencePrimary : null,
    attr_material: normalizedMaterials[0] ?? null,
    attr_materials: normalizedMaterials,
    attr_fit: toLowerTrim(attributes.fit),
    attr_style: toLowerTrim(attributes.style),
    attr_gender: attrGenderRaw,
    audience_gender: audience.audience_gender,
    age_group: audience.age_group,
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
    doc.embedding_score_version = "v2";
  }
  if (input.embeddingGarment && input.embeddingGarment.length > 0) {
    doc.embedding_garment = input.embeddingGarment;
    doc.embedding_garment_score_version = "v2";
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
