import { extractAttributesSync } from "./attributeExtractor";
import type { GarmentColorAnalysis } from "../color/garmentColorPipeline";
import { normalizeColorTokensFromRaw } from "../color/queryColorFilter";
import { inferCategoryCanonical } from "./categoryFilter";
import {
  expandProductTypesForIndexing,
  extractLexicalProductTypeSeeds,
  filterProductTypeSeedsByMappedCategory,
} from "./productTypeTaxonomy";
import { canonicalTypeIdsToProductTypeTokens } from "./loadProductSearchEnrichment";
import { inferCatalogGenderValue } from "./productGenderInference";

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

function normalizeCatalogUrlText(value: unknown): string {
  const raw = String(value ?? "").toLowerCase().trim();
  if (!raw) return "";
  const withoutQuery = raw.split(/[?#]/)[0] ?? raw;
  let decoded = withoutQuery;
  try {
    decoded = decodeURIComponent(withoutQuery);
  } catch {
    decoded = withoutQuery;
  }
  return decoded
    .replace(/^https?:\/\/[^/]+/i, " ")
    .replace(/\.[a-z0-9]{2,5}$/i, " ")
    .replace(/[_+./-]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function computeProductQualityScore(input: {
  imageCdn?: string | null;
  priceCents?: number | null;
  colors: string[];
  productTypes: string[];
  audienceGender: string | null;
}): number {
  const hasValidImage = Boolean(String(input.imageCdn ?? "").trim());
  const price = Number(input.priceCents ?? 0);
  const hasValidPrice = Number.isFinite(price) && price > 0 && price < 10_000_000_000;
  const hasValidColor = input.colors.length > 0;
  const hasNormalizedType = input.productTypes.length > 0;
  const hasAudience = Boolean(input.audienceGender);

  let score = 0.55;
  if (hasValidImage) score += 0.18;
  if (hasValidPrice) score += 0.08;
  if (hasValidColor) score += 0.08;
  if (hasNormalizedType) score += 0.08;
  if (hasAudience) score += 0.03;
  return Math.max(0.45, Math.min(1, Math.round(score * 1000) / 1000));
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
    ["shirt jacket", "jacket"],
    ["shirt jackets", "jacket"],
    ["fleece jacket", "fleece"],
    ["fleece jackets", "fleece"],
    ["puffer jacket", "puffer"],
    ["puffer jackets", "puffer"],
    ["puffer coat", "coat"],
    ["puffer coats", "coat"],
    ["down jacket", "puffer"],
    ["down jackets", "puffer"],
    ["quilted jacket", "puffer"],
    ["quilted jackets", "puffer"],
    ["rain jacket", "jacket"],
    ["rain jackets", "jacket"],
    ["shell jacket", "jacket"],
    ["shell jackets", "jacket"],
    ["softshell jacket", "jacket"],
    ["softshell jackets", "jacket"],
    ["shacket", "jacket"],
    ["overshirt", "jacket"],
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
    boot: "boots",
    boots: "boots",
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
    skirt: "skirt",
    skirts: "skirt",
    skort: "skirt",
    skorts: "skirt",
    sweater: "sweater",
    sweaters: "sweater",
    blazer: "blazer",
    blazers: "blazer",
    jacket: "jacket",
    jackets: "jacket",
    coat: "coat",
    coats: "coat",
    parka: "parka",
    parkas: "parka",
    windbreaker: "windbreaker",
    windbreakers: "windbreaker",
    overcoat: "overcoat",
    overcoats: "overcoat",
    bomber: "bomber",
    bombers: "bomber",
    blouson: "blouson",
    blousons: "blouson",
    fleece: "fleece",
    fleeces: "fleece",
    puffer: "puffer",
    puffers: "puffer",
    anorak: "anorak",
    anoraks: "anorak",
    poncho: "poncho",
    ponchos: "poncho",
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
  productUrl?: string | null;
  /** From `products.gender` when title did not yield gender (e.g. BLIP backfill). */
  catalogGender?: string | null;
  /** Base product URL without size/variant query params — used for pre-hydration dedup. */
  parentProductUrl?: string | null;
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
  // Map raw vendor color strings to canonical search tokens before indexing.
  // e.g. "White/Navy/Wolf Grey" -> ["white", "blue", "gray"].
  const normalizedCatalogColors = normalizeColorTokensFromRaw(input.catalogColor ?? null);
  if (normalizedTitleColors.length === 0 && normalizedCatalogColors.length > 0) {
    normalizedTitleColors = normalizeArray(normalizedCatalogColors);
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
  const titleSeedsLexicalRaw = input.title
    ? extractLexicalProductTypeSeeds(input.title)
    : [];
  const titleTypes =
    categoryCanonical && categoryCanonical !== "all"
      ? filterProductTypeSeedsByMappedCategory([...new Set([...titleTypesRaw, ...titleSeedsLexicalRaw])], categoryCanonical)
      : [...new Set([...titleTypesRaw, ...titleSeedsLexicalRaw])];
  const descriptionSeedsLexicalRaw = input.description
    ? extractLexicalProductTypeSeeds(input.description)
    : [];
  const descriptionSeedsLexical =
    categoryCanonical && categoryCanonical !== "all"
      ? filterProductTypeSeedsByMappedCategory(descriptionSeedsLexicalRaw, categoryCanonical)
      : descriptionSeedsLexicalRaw;
  const categorySeedsLexicalRaw = input.category
    ? extractLexicalProductTypeSeeds(input.category)
    : [];
  const categorySeedsLexical =
    categoryCanonical && categoryCanonical !== "all"
      ? filterProductTypeSeedsByMappedCategory(categorySeedsLexicalRaw, categoryCanonical)
      : categorySeedsLexicalRaw;
  const urlSeedsLexicalRaw = [
    ...extractLexicalProductTypeSeeds(normalizeCatalogUrlText(input.productUrl)),
    ...extractLexicalProductTypeSeeds(normalizeCatalogUrlText(input.parentProductUrl)),
  ];
  // URL paths often carry vendor breadcrumbs/handles and can correct bad category labels.
  const urlSeedsLexical = urlSeedsLexicalRaw;

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
  if (categoryCanonical === "outerwear" || categoryCanonical === "tailored") {
    for (const t of categorySeedsLexical) {
      if (t && !mergedTypeSeeds.includes(t)) mergedTypeSeeds.push(t);
    }
  }
  for (const t of descriptionSeedsLimited) {
    if (!mergedTypeSeeds.includes(t)) mergedTypeSeeds.push(t);
  }
  for (const t of urlSeedsLexical.slice(0, 4)) {
    if (!mergedTypeSeeds.includes(t)) mergedTypeSeeds.push(t);
  }
  for (const t of enrichTokens) {
    if (!mergedTypeSeeds.includes(t)) mergedTypeSeeds.push(t);
  }
  const categoryAndTitleText = `${input.title ?? ""} ${input.category ?? ""}`.toLowerCase();
  const hasExplicitSkirtOrSkort = /\b(skorts?|skirts?|mini\s+skirt|midi\s+skirt|maxi\s+skirt)\b/.test(categoryAndTitleText);
  if (hasExplicitSkirtOrSkort) {
    for (let i = mergedTypeSeeds.length - 1; i >= 0; i -= 1) {
      if (/\b(jeans?|denim|pants?|trousers?|chinos?|slacks?)\b/.test(String(mergedTypeSeeds[i]).toLowerCase())) {
        mergedTypeSeeds.splice(i, 1);
      }
    }
    if (!mergedTypeSeeds.includes("skirt")) mergedTypeSeeds.unshift("skirt");
  }
  const hasExplicitOuterwearPhrase = /\b(shirt\s+jackets?|shackets?|overshirts?|fleece\s+jackets?|puffer\s+(?:jackets?|coats?)|down\s+(?:jackets?|coats?)|quilted\s+jackets?|rain\s+jackets?|shell\s+jackets?|softshell\s+jackets?|blousons?)\b/.test(categoryAndTitleText);
  if (hasExplicitOuterwearPhrase) {
    for (let i = mergedTypeSeeds.length - 1; i >= 0; i -= 1) {
      if (String(mergedTypeSeeds[i]).toLowerCase().trim() === "shirt") {
        mergedTypeSeeds.splice(i, 1);
      }
    }
    if (!mergedTypeSeeds.includes("jacket")) mergedTypeSeeds.unshift("jacket");
  }
  const productTypesIndexed: string[] = [];
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
    toLowerTrim(attributes.gender) ||
    toLowerTrim(input.catalogGender ?? null) ||
    inferCatalogGenderValue({
      title: input.title,
      description: input.description,
      category: input.category,
      category_canonical: categoryCanonical,
      product_url: input.productUrl,
      parent_product_url: input.parentProductUrl,
      product_types: productTypesIndexed,
      attr_style: attributes.style,
    });
  const audience = inferAudienceFromTitle(input.title || "", attrGenderRaw);
  const productQualityScore = computeProductQualityScore({
    imageCdn: input.imageCdn,
    priceCents: input.priceCents,
    colors: normalizedColors,
    productTypes: productTypesIndexed,
    audienceGender: audience.audience_gender,
  });

  const doc: Record<string, any> = {
    product_id: String(input.productId),
    vendor_id: input.vendorId !== null && input.vendorId !== undefined ? String(input.vendorId) : null,
    title: input.title,
    description: input.description ?? null,
    brand: toLowerTrim(input.brand),
    category: categoryLower,
    color: input.catalogColor ?? null,
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
    product_quality_score: productQualityScore,
    color_confidence_text: colorConfidenceText,
    color_confidence_image: colorConfidenceImage,
    image_cdn: input.imageCdn ?? null,
    p_hash: input.pHash ?? null,
    product_url: input.productUrl ?? null,
    parent_product_url: input.parentProductUrl ?? null,
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
