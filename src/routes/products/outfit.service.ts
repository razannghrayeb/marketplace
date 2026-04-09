/**
 * Outfit Service
 * 
 * Business logic for "Complete My Style" outfit recommendations.
 */
import {
  completeOutfitFromProductId,
  completeMyStyle,
  detectCategory,
  buildStyleProfile,
  type Product,
  type OutfitCompletion,
  type StyleProfile,
  type ProductCategory,
} from "../../lib/outfit/index";
import { type ExtractedAttributes } from "../../lib/search/attributeExtractor";
import { pg } from "../../lib/core";
import { completeLookSuggestionsForCatalogProducts } from "../wardrobe/recommendations.service";
import {
  logImpressionBatch,
  type RecommendationImpression,
} from "../../lib/recommendations";

// ============================================================================
// Types
// ============================================================================

export interface CompleteStyleOptions {
  maxPerCategory?: number;
  maxTotal?: number;
  priceRange?: { min?: number; max?: number };
  excludeBrands?: string[];
  preferSameBrand?: boolean;
  disablePriceFilter?: boolean;  // Disable default 0.5x-2.5x price range
}

export interface StyleRecommendationResponse {
  completionMode: "product";
  sourceProduct: Product;
  detectedCategory: ProductCategory;
  style: {
    occasion: string;
    aesthetic: string;
    season: string;
    formality: number;
    colorProfile: {
      primary: string;
      type: string;
    };
  };
  outfitSuggestion: string;
  recommendations: Array<{
    category: string;
    reason: string;
    priority: number;
    priorityLabel: string;
    products: Array<{
      id: number;
      title: string;
      brand?: string;
      price: number;
      currency: string;
      image?: string;
      matchScore: number;
      matchReasons: string[];
      owned?: boolean;
    }>;
  }>;
  totalRecommendations: number;
}

export interface StyleProfileResponse {
  product: {
    id: number;
    title: string;
    brand?: string;
  };
  detectedCategory: ProductCategory;
  categoryConfidence: number;
  extractedAttributes: ExtractedAttributes;
  styleProfile: {
    occasion: string;
    aesthetic: string;
    season: string;
    formality: number;
    formalityLabel: string;
    colorProfile: {
      primary: string;
      type: string;
      harmonies: Array<{
        type: string;
        colors: string[];
      }>;
    };
  };
}

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Get outfit completion recommendations for a product by ID
 */
export async function getOutfitRecommendations(
  productId: number,
  options: CompleteStyleOptions = {},
  userId?: number
): Promise<StyleRecommendationResponse | null> {
  const sourceProduct = await getCatalogProductById(productId);
  if (!sourceProduct) {
    return null;
  }

  // Use the wardrobe complete-look engine for product pages so both catalog product
  // and user wardrobe context influence the recommendations.
  const maxTotal = Math.max(1, Math.min(options.maxTotal ?? 20, 50));
  const maxPerCategory = Math.max(1, Math.min(options.maxPerCategory ?? 5, 20));
  const anchorProductIds = [productId];
  const audienceGenderHint =
    normalizeAudienceHint(sourceProduct.gender) || inferAudienceGenderHintFromProduct(sourceProduct);
  const ageGroupHint = inferAgeGroupHintFromProduct(sourceProduct);
  const detected = await detectCategory(sourceProduct.title, sourceProduct.description);
  const resolvedSourceCategory =
    detected.category === "unknown"
      ? inferSourceCategoryFallback(sourceProduct)
      : detected.category;
  const sourceStyle = await buildStyleProfile(sourceProduct);

  const completeLookResult = await completeLookSuggestionsForCatalogProducts(
    userId ?? 0,
    anchorProductIds,
    maxTotal,
    { audienceGenderHint, ageGroupHint }
  );

  const rerankedSuggestions = await rerankCompleteStyleSuggestions({
    sourceProduct,
    sourceStyle,
    sourceCategory: resolvedSourceCategory,
    suggestions: completeLookResult.suggestions,
    userId,
    maxSuggestions: maxTotal * 2,
  });

  const filteredSuggestions = applyCompleteStyleOptionFilters(
    rerankedSuggestions,
    options,
    sourceProduct
  ).slice(0, maxTotal);

  if (filteredSuggestions.length > 0) {
    return mapCompleteLookToStyleResponse({
      sourceProduct,
      completeLookResult: {
        ...completeLookResult,
        suggestions: filteredSuggestions,
      },
      maxPerCategory,
      detectedCategory: resolvedSourceCategory,
      sourceStyle,
    });
  }

  // Fallback keeps legacy behavior if complete-look cannot produce candidates.
  const result = await completeOutfitFromProductId(productId, {
    maxPerCategory: options.maxPerCategory,
    maxTotal: options.maxTotal,
    priceRange: options.priceRange,
    excludeBrands: options.excludeBrands,
    preferSameBrand: options.preferSameBrand,
    disablePriceFilter: options.disablePriceFilter,
  });
  if (!result) return null;

  const response = formatOutfitCompletion(userId ? await mergeWardrobeOwnedIntoCompletion(result, userId, options) : result);

  // Log impressions for training data (async, non-blocking)
  logOutfitImpressions(productId, result).catch((err) =>
    console.error("[OutfitService] Failed to log impressions:", err)
  );

  return response;
}

/**
 * Get outfit recommendations for a product object (not from database)
 */
export async function getOutfitRecommendationsFromProduct(
  product: Product,
  options: CompleteStyleOptions = {},
  userId?: number
): Promise<StyleRecommendationResponse> {
  const result = await completeMyStyle(product, {
    maxPerCategory: options.maxPerCategory,
    maxTotal: options.maxTotal,
    priceRange: options.priceRange,
    excludeBrands: options.excludeBrands,
    preferSameBrand: options.preferSameBrand,
    disablePriceFilter: options.disablePriceFilter,
  });

  return formatOutfitCompletion(
    userId ? await mergeWardrobeOwnedIntoCompletion(result, userId, options) : result
  );
}

/**
 * Get style profile for a product by ID
 */
export async function getProductStyleProfile(
  productId: number
): Promise<StyleProfileResponse | null> {
  const result = await pg.query(`
    SELECT id, title, brand, category, color, price_cents, currency, 
           image_url, image_cdn, description
    FROM products 
    WHERE id = $1
  `, [productId]);

  if (result.rows.length === 0) {
    return null;
  }

  const product = result.rows[0] as Product;
  const categoryResult = await detectCategory(product.title, product.description);
  const styleProfile = await buildStyleProfile(product);

  return {
    product: {
      id: product.id,
      title: product.title,
      brand: product.brand,
    },
    detectedCategory: categoryResult.category,
    categoryConfidence: categoryResult.confidence,
    extractedAttributes: categoryResult.attributes,
    styleProfile: {
      occasion: styleProfile.occasion,
      aesthetic: styleProfile.aesthetic,
      season: styleProfile.season,
      formality: styleProfile.formality,
      formalityLabel: getFormalityLabel(styleProfile.formality),
      colorProfile: {
        primary: styleProfile.colorProfile.primary,
        type: styleProfile.colorProfile.type,
        harmonies: styleProfile.colorProfile.harmonies.map(h => ({
          type: h.type,
          colors: h.colors.slice(0, 5),
        })),
      },
    },
  };
}

/**
 * Analyze a product and return its detected category and style
 */
export async function analyzeProductStyle(product: Product): Promise<{
  category: ProductCategory;
  categoryConfidence: number;
  attributes: ExtractedAttributes;
  style: StyleProfile;
}> {
  const categoryResult = await detectCategory(product.title, product.description);
  const style = await buildStyleProfile(product);
  return {
    category: categoryResult.category,
    categoryConfidence: categoryResult.confidence,
    attributes: categoryResult.attributes,
    style,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format OutfitCompletion to API response format
 */
function formatOutfitCompletion(result: OutfitCompletion): StyleRecommendationResponse {
  return {
    completionMode: "product",
    sourceProduct: result.sourceProduct,
    detectedCategory: result.detectedCategory,
    style: {
      occasion: result.detectedStyle.occasion,
      aesthetic: result.detectedStyle.aesthetic,
      season: result.detectedStyle.season,
      formality: result.detectedStyle.formality,
      colorProfile: {
        primary: result.detectedStyle.colorProfile.primary,
        type: result.detectedStyle.colorProfile.type,
      },
    },
    outfitSuggestion: result.outfitSuggestion,
    recommendations: result.recommendations.map(rec => ({
      category: rec.category,
      reason: rec.reason,
      priority: rec.priority,
      priorityLabel: getPriorityLabel(rec.priority),
      products: rec.products.map(p => {
        const raw = p as Product & { product_id?: number };
        const id = raw.id ?? raw.product_id;
        const priceCents =
          typeof raw.price_cents === "number" && Number.isFinite(raw.price_cents)
            ? Math.round(raw.price_cents)
            : 0;
        return {
          id: typeof id === "number" && Number.isFinite(id) ? id : 0,
          title: p.title,
          brand: p.brand,
          price: priceCents,
          currency: p.currency || "USD",
          image: p.image_cdn || p.image_url,
          matchScore: Math.round(p.matchScore),
          matchReasons: p.matchReasons,
          owned: (p as any).owned === true ? true : undefined,
        };
      }).filter((row) => row.id >= 1),
    })),
    totalRecommendations: result.recommendations.reduce((sum, r) => sum + r.products.length, 0),
  };
}

type CompleteLookMappedSourceProduct = Product & { gender?: string | null };

type CompleteLookMappedSuggestion = {
  product_id: number;
  title: string;
  brand?: string;
  category?: string;
  price_cents?: number;
  image_url?: string;
  image_cdn?: string;
  score: number;
  reason: string;
  matchReasons?: string[];
  fashionScore?: number;
};

async function getCatalogProductById(productId: number): Promise<CompleteLookMappedSourceProduct | null> {
  const result = await pg.query(
    `SELECT id, title, brand, category, color, price_cents, currency,
            image_url, image_cdn, description, gender, product_url, parent_product_url
     FROM products
     WHERE id = $1`,
    [productId]
  );
  return (result.rows[0] as CompleteLookMappedSourceProduct | undefined) ?? null;
}

function inferAgeGroupHintFromProduct(product: {
  title?: string | null;
  category?: string | null;
  description?: string | null;
  product_url?: string | null;
  parent_product_url?: string | null;
}): string | undefined {
  const text = `${String(product.title || "")} ${String(product.category || "")} ${String(product.description || "")} ${String(product.product_url || "")} ${String(product.parent_product_url || "")}`.toLowerCase();
  const kidsHits = (text.match(/\bkids?\b|\bchildren\b|\bchild\b|\bbaby\b|\btoddler\b|\byouth\b|\bjunior\b|\bboys?\b|\bgirls?\b/g) || []).length;
  const adultHits = (text.match(/\bmen\b|\bwomen\b|\badult\b|\bladies\b|\bgents\b|\bmale\b|\bfemale\b/g) || []).length;
  if (kidsHits > adultHits && kidsHits > 0) return "kids";
  if (adultHits > kidsHits && adultHits > 0) return "adult";
  return undefined;
}

function inferAudienceGenderHintFromProduct(product: {
  title?: string | null;
  category?: string | null;
  description?: string | null;
  product_url?: string | null;
  parent_product_url?: string | null;
}): string | undefined {
  const text = `${String(product.title || "")} ${String(product.category || "")} ${String(product.description || "")} ${String(product.product_url || "")} ${String(product.parent_product_url || "")}`.toLowerCase();
  const menHits = (text.match(/\bmen\b|\bmens\b|\bmen's\b|\bboy\b|\bboys\b|\bgents\b|\bmale\b/g) || []).length;
  const womenHits = (text.match(/\bwomen\b|\bwomens\b|\bwomen's\b|\bgirl\b|\bgirls\b|\bladies\b|\bfemale\b/g) || []).length;
  if (menHits > womenHits && menHits > 0) return "men";
  if (womenHits > menHits && womenHits > 0) return "women";
  return undefined;
}

type FashionRerankContext = {
  sourceProduct: CompleteLookMappedSourceProduct;
  sourceStyle: StyleProfile;
  sourceCategory: ProductCategory;
  suggestions: CompleteLookMappedSuggestion[];
  userId?: number;
  maxSuggestions: number;
};

type CandidateStyleRow = {
  id: number;
  title: string;
  brand?: string | null;
  category?: string | null;
  color?: string | null;
  price_cents?: number | null;
  currency?: string | null;
  image_url?: string | null;
  image_cdn?: string | null;
  description?: string | null;
};

function normalizeStyleToken(value: unknown): string {
  return String(value || "").toLowerCase().trim();
}

function splitStyleTokens(value: string): string[] {
  return value
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter(Boolean);
}

function categoryFamily(label?: string | null): string {
  const text = normalizeStyleToken(label);
  if (!text) return "unknown";
  if (text.includes("dress") || text.includes("gown")) return "dress";
  if (text.includes("top") || text.includes("shirt") || text.includes("blouse") || text.includes("hoodie") || text.includes("sweater") || text.includes("sweatshirt") || text.includes("tshirt") || text.includes("tee")) return "tops";
  if (text.includes("bottom") || text.includes("pant") || text.includes("trouser") || text.includes("jean") || text.includes("skirt") || text.includes("short")) return "bottoms";
  if (text.includes("outer") || text.includes("jacket") || text.includes("coat") || text.includes("blazer") || text.includes("cardigan") || text.includes("bomber")) return "outerwear";
  if (text.includes("shoe") || text.includes("sneaker") || text.includes("heel") || text.includes("boot") || text.includes("sandal") || text.includes("loafer") || text.includes("flat")) return "shoes";
  if (text.includes("bag") || text.includes("clutch") || text.includes("tote") || text.includes("backpack") || text.includes("crossbody")) return "bags";
  if (text.includes("accessor") || text.includes("watch") || text.includes("scarf") || text.includes("hat") || text.includes("sunglass") || text.includes("jewel") || text.includes("belt")) return "accessories";
  return text;
}

function scoreRangeMatch(source: number, candidate: number): number {
  if (!Number.isFinite(source) || source <= 0 || !Number.isFinite(candidate) || candidate <= 0) return 0.55;
  const ratio = candidate / source;
  if (ratio >= 0.8 && ratio <= 1.35) return 1;
  if (ratio >= 0.65 && ratio <= 1.7) return 0.82;
  if (ratio >= 0.5 && ratio <= 2.2) return 0.65;
  return 0.35;
}

function scoreAestheticCompatibility(source: StyleProfile["aesthetic"], candidate: StyleProfile["aesthetic"]): number {
  if (source === candidate) return 1;
  const compat: Record<StyleProfile["aesthetic"], StyleProfile["aesthetic"][]> = {
    classic: ["minimalist", "modern", "romantic"],
    modern: ["minimalist", "classic", "streetwear"],
    bohemian: ["romantic", "classic", "modern"],
    minimalist: ["modern", "classic", "streetwear"],
    streetwear: ["sporty", "modern", "edgy"],
    romantic: ["classic", "bohemian", "minimalist"],
    edgy: ["streetwear", "modern", "sporty"],
    sporty: ["streetwear", "modern", "minimalist"],
  };
  return compat[source]?.includes(candidate) ? 0.86 : 0.45;
}

function scoreSeasonCompatibility(source: StyleProfile["season"], candidate: StyleProfile["season"]): number {
  if (source === candidate) return 1;
  if (source === "all-season" || candidate === "all-season") return 0.82;
  const pairs: Record<StyleProfile["season"], StyleProfile["season"][]> = {
    spring: ["summer", "all-season"],
    summer: ["spring", "all-season"],
    fall: ["winter", "all-season"],
    winter: ["fall", "all-season"],
    "all-season": ["spring", "summer", "fall", "winter", "all-season"],
  };
  return pairs[source]?.includes(candidate) ? 0.74 : 0.42;
}

function scoreFormalityCompatibility(source: number, candidate: number): number {
  const diff = Math.abs(source - candidate);
  if (diff <= 1.2) return 1;
  if (diff <= 2.5) return 0.86;
  if (diff <= 4) return 0.62;
  return 0.34;
}

function scoreColorHarmony(sourceStyle: StyleProfile, candidateColor: string | undefined): number {
  const color = normalizeStyleToken(candidateColor);
  if (!color) return 0.58;
  const primary = normalizeStyleToken(sourceStyle.colorProfile.primary);
  if (!primary || primary === "neutral") return 0.92;
  if (primary === color) return 0.88;
  const harmonyHit = sourceStyle.colorProfile.harmonies.some((h) => h.colors.map(normalizeStyleToken).includes(color));
  if (harmonyHit) return 0.84;
  const neutralColors = ["black", "white", "gray", "grey", "beige", "cream", "navy", "tan", "camel", "brown"];
  if (neutralColors.includes(color)) return 0.78;
  return 0.46;
}

function scoreCategoryCompatibility(sourceFamily: string, candidateFamily: string): number {
  if (!sourceFamily || !candidateFamily) return 0.5;
  if (sourceFamily === candidateFamily) return sourceFamily === "accessories" ? 0.74 : 0.38;
  const pairingMap: Record<string, string[]> = {
    dress: ["shoes", "bags", "outerwear", "accessories"],
    tops: ["bottoms", "outerwear", "shoes", "accessories"],
    bottoms: ["tops", "outerwear", "shoes", "accessories"],
    outerwear: ["tops", "bottoms", "shoes", "accessories", "dress"],
    shoes: ["tops", "bottoms", "dress", "outerwear", "bags", "accessories"],
    bags: ["dress", "tops", "bottoms", "outerwear", "shoes", "accessories"],
    accessories: ["dress", "tops", "bottoms", "outerwear", "shoes", "bags"],
  };
  if (pairingMap[sourceFamily]?.includes(candidateFamily)) return 0.93;
  if (pairingMap[candidateFamily]?.includes(sourceFamily)) return 0.87;
  return 0.44;
}

function scoreFootwearOccasionCompatibility(
  sourceOccasion: StyleProfile["occasion"],
  candidateTitle: string,
  candidateCategory?: string | null
): number {
  const text = `${String(candidateTitle || "")} ${String(candidateCategory || "")}`.toLowerCase();
  const isSneakerLike = /\b(sneaker|sneakers|trainer|trainers|running shoe|canvas shoe|basketball shoe)\b/.test(text);
  const isDressyFootwear = /\b(heel|heels|pump|pumps|stiletto|stilettos|sandal|sandals|mule|mules|loafer|loafers|boot|boots|flat|flats|oxford|oxfords)\b/.test(text);

  if (sourceOccasion === "party") {
    if (isSneakerLike) return 0.22;
    if (isDressyFootwear) return 0.98;
    return 0.72;
  }

  if (sourceOccasion === "formal" || sourceOccasion === "semi-formal") {
    if (isSneakerLike) return 0.3;
    if (isDressyFootwear) return 0.95;
    return 0.68;
  }

  if (sourceOccasion === "casual") {
    if (isSneakerLike) return 0.95;
    if (isDressyFootwear) return 0.72;
  }

  return 0.74;
}

function buildFashionReasons(params: {
  categoryScore: number;
  colorScore: number;
  aestheticScore: number;
  formalityScore: number;
  seasonScore: number;
  priceScore: number;
  patternScore: number;
  materialScore: number;
}): string[] {
  const reasons: string[] = [];
  if (params.categoryScore >= 0.9) reasons.push("strong outfit compatibility");
  if (params.aestheticScore >= 0.85) reasons.push("same style family");
  if (params.colorScore >= 0.84) reasons.push("harmonious color palette");
  if (params.formalityScore >= 0.86) reasons.push("matching formality");
  if (params.seasonScore >= 0.82) reasons.push("season-aligned");
  if (params.patternScore >= 0.8) reasons.push("pattern balance");
  if (params.materialScore >= 0.8) reasons.push("material-compatible");
  if (params.priceScore >= 0.82) reasons.push("price-tier aligned");
  if (reasons.length === 0) reasons.push("fashion-balanced match");
  return reasons.slice(0, 4);
}

async function rerankCompleteStyleSuggestions(params: FashionRerankContext): Promise<CompleteLookMappedSuggestion[]> {
  if (!params.suggestions.length) return [];

  const topSuggestions = [...params.suggestions]
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(params.maxSuggestions, 20));

  const candidateIds = Array.from(new Set(topSuggestions.map((s) => s.product_id))).slice(0, 80);
  const candidateRows = await pg.query<CandidateStyleRow>(
    `SELECT id, title, brand, category, color, price_cents, currency, image_url, image_cdn, description
     FROM products
     WHERE id = ANY($1)`,
    [candidateIds]
  );

  const rowById = new Map<number, CandidateStyleRow>();
  for (const row of candidateRows.rows) {
    rowById.set(row.id, row);
  }

  const enriched = await Promise.all(topSuggestions.map(async (s) => {
    const row = rowById.get(s.product_id);
    if (!row) {
      return {
        ...s,
        matchReasons: [s.reason || "fashion-compatible"],
        fashionScore: Math.max(0, Math.min(1, s.score || 0)),
      };
    }

    const candidateProduct: Product = {
      id: row.id,
      title: row.title,
      brand: row.brand ?? undefined,
      category: row.category ?? undefined,
      color: row.color ?? undefined,
      price_cents: Math.max(0, Math.round(Number(row.price_cents || 0))),
      currency: row.currency || "USD",
      image_url: row.image_url ?? undefined,
      image_cdn: row.image_cdn ?? undefined,
      description: row.description ?? undefined,
    };

    const candidateCategory = await detectCategory(candidateProduct.title, candidateProduct.description);
    const candidateStyle = await buildStyleProfile(candidateProduct);

    const sourceFamily = categoryFamily(params.sourceCategory);
    const candidateFamily = categoryFamily(candidateCategory.category);
    const categoryScore = scoreCategoryCompatibility(sourceFamily, candidateFamily);
    const colorScore = scoreColorHarmony(params.sourceStyle, candidateStyle.colorProfile.primary);
    const aestheticScore = scoreAestheticCompatibility(params.sourceStyle.aesthetic, candidateStyle.aesthetic);
    const formalityScore = scoreFormalityCompatibility(params.sourceStyle.formality, candidateStyle.formality);
    const seasonScore = scoreSeasonCompatibility(params.sourceStyle.season, candidateStyle.season);
    const priceScore = scoreRangeMatch(params.sourceProduct.price_cents, candidateProduct.price_cents);
    const footwearOccasionScore =
      candidateFamily === "shoes"
        ? scoreFootwearOccasionCompatibility(params.sourceStyle.occasion, candidateProduct.title, candidateProduct.category)
        : 1;

    const sourcePattern = splitStyleTokens(`${params.sourceProduct.category || ""} ${params.sourceProduct.title || ""}`);
    const candidatePattern = splitStyleTokens(`${candidateProduct.category || ""} ${candidateProduct.title || ""}`);
    const patternOverlap = candidatePattern.some((token) => sourcePattern.includes(token)) ? 0.9 : 0.62;

    const sourceMaterial = normalizeStyleToken(params.sourceProduct.description);
    const candidateMaterial = normalizeStyleToken(candidateProduct.description);
    const materialOverlap = sourceMaterial && candidateMaterial && sourceMaterial === candidateMaterial ? 0.88 : 0.65;

    const fashionScore =
      categoryScore * 0.24 +
      aestheticScore * 0.22 +
      colorScore * 0.18 +
      formalityScore * 0.16 +
      seasonScore * 0.08 +
      footwearOccasionScore * 0.14 +
      patternOverlap * 0.06 +
      materialOverlap * 0.04 +
      priceScore * 0.02;

    const retrievalScore = Math.max(0, Math.min(1, s.score || 0));
    const finalScore = Math.round((fashionScore * 0.7 + retrievalScore * 0.3) * 1000) / 1000;

    return {
      ...s,
      score: finalScore,
      fashionScore: Math.round(fashionScore * 1000) / 1000,
      matchReasons: buildFashionReasons({
        categoryScore,
        colorScore,
        aestheticScore,
        formalityScore,
        seasonScore,
        priceScore,
        patternScore: patternOverlap,
        materialScore: materialOverlap,
      }),
      ...(candidateFamily === "shoes"
        ? [
            params.sourceStyle.occasion === "party" && /\b(sneaker|sneakers|trainer|trainers)\b/i.test(`${candidateProduct.title} ${candidateProduct.category || ""}`)
              ? "too casual for a party look"
              : "footwear matches the occasion",
          ]
        : []),
      reason: s.reason || "fashion-aware match",
    };
  }));

  return enriched.sort((a, b) => b.score - a.score);
}

function normalizeAudienceHint(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  const s = String(raw).toLowerCase().trim();
  if (!s) return undefined;
  if (["men", "man", "male", "mens", "men's", "gents"].includes(s)) return "men";
  if (["women", "woman", "female", "womens", "women's", "ladies"].includes(s)) return "women";
  if (["unisex", "neutral"].includes(s)) return "unisex";
  return undefined;
}

function completeStyleCategoryLabel(raw?: string): string {
  const c = String(raw || "").toLowerCase().trim();
  if (!c) return "Recommended";
  if (c.includes("pyjama") || c.includes("pajama") || c.includes("sleepwear") || c.includes("nightwear") || c.includes("loungewear")) return "";
  if (c.includes("footwear") || c.includes("shoe") || c.includes("sneaker") || c.includes("boot") || c.includes("sandal") || c.includes("loafer") || c.includes("heel") || c.includes("flat") || c.includes("mule") || c.includes("trainer")) return "Shoes";
  if (c.includes("dress")) return "Dresses";
  if (c.includes("outerwear") || c.includes("jacket") || c.includes("coat") || c.includes("blazer")) return "Outerwear";
  if (c.includes("top") || c.includes("shirt") || c.includes("blouse") || c.includes("hoodie") || c.includes("sweater")) return "Tops";
  if (c.includes("bottom") || c.includes("pants") || c.includes("trouser") || c.includes("jeans") || c.includes("skirt") || c.includes("short")) return "Bottoms";
  if (
    c.includes("bag") ||
    c.includes("accessor") ||
    c.includes("wallet") ||
    c.includes("backpack") ||
    c.includes("crossbody") ||
    c.includes("clutch") ||
    c.includes("tote") ||
    c.includes("waist")
  ) return "Accessories";
  if (c === "recommended") return "Accessories";
  return c.charAt(0).toUpperCase() + c.slice(1);
}

function completeStylePriorityFromCategory(categoryLabel: string, missingCategories: string[]): number {
  const key = categoryLabel.toLowerCase();
  const expandedKey = key === "accessories" ? "accessories bags" : key;
  const idx = missingCategories.findIndex((m) => key.includes(String(m).toLowerCase()));
  const idxExpanded = missingCategories.findIndex((m) => expandedKey.includes(String(m).toLowerCase()));
  const resolvedIdx = idx >= 0 ? idx : idxExpanded;
  if (resolvedIdx === 0) return 1;
  if (resolvedIdx >= 1) return 2;
  return 3;
}

function inferSourceCategoryFallback(sourceProduct: {
  category?: string | null;
  title?: string | null;
  description?: string | null;
}): ProductCategory {
  const text = `${String(sourceProduct.category || "")} ${String(sourceProduct.title || "")} ${String(sourceProduct.description || "")}`.toLowerCase();
  if (/\b(jacket|coat|blazer|outerwear|bomber|parka|windbreaker)\b/.test(text)) return "outerwear" as ProductCategory;
  if (/\b(trouser|trousers|pants|jeans|skirt|shorts?|leggings|bottoms?)\b/.test(text)) return "bottoms" as ProductCategory;
  if (/\b(top|tops|shirt|shirts|blouse|blouses|tee|t-?shirt|hoodie|hoodies|sweater|sweaters|sweatshirt|sweatshirts|knit)\b/.test(text)) return "tops" as ProductCategory;
  if (/\b(dress|gown|romper|jumpsuit|playsuit)\b/.test(text)) return "dress" as ProductCategory;
  if (/\b(shoe|sneaker|boot|heel|sandal|loafer|flats?)\b/.test(text)) return "shoes" as ProductCategory;
  if (/\b(bag|wallet|backpack|accessor|crossbody|clutch|tote)\b/.test(text)) return "accessories" as ProductCategory;
  return "unknown" as ProductCategory;
}

function mapCompleteLookToStyleResponse(params: {
  sourceProduct: CompleteLookMappedSourceProduct;
  completeLookResult: {
    suggestions: CompleteLookMappedSuggestion[];
    missingCategories: string[];
  };
  maxPerCategory: number;
  detectedCategory: ProductCategory;
  sourceStyle: StyleProfile;
}): StyleRecommendationResponse {
  const { sourceProduct, completeLookResult, maxPerCategory, detectedCategory, sourceStyle } = params;
  const groups = new Map<string, Array<{
    id: number;
    title: string;
    brand?: string;
    price: number;
    currency: string;
    image?: string;
    matchScore: number;
    matchReasons: string[];
  }>>();
  const reasons = new Map<string, string>();

  for (const s of completeLookResult.suggestions) {
    const categoryLabel = completeStyleCategoryLabel(s.category);
    if (!categoryLabel) continue;
    if (!groups.has(categoryLabel)) groups.set(categoryLabel, []);
    const bucket = groups.get(categoryLabel)!;
    if (bucket.length >= maxPerCategory) continue;

    bucket.push({
      id: s.product_id,
      title: s.title,
      brand: s.brand,
      price: typeof s.price_cents === "number" && Number.isFinite(s.price_cents) ? Math.round(s.price_cents) : 0,
      currency: sourceProduct.currency || "USD",
      image: s.image_cdn || s.image_url,
      matchScore: Math.round(Math.max(0, Math.min(1, s.score || 0)) * 100),
      matchReasons: s.matchReasons?.length ? s.matchReasons : [s.reason || "Complements your selected item"],
    });

    if (!reasons.has(categoryLabel)) {
      reasons.set(categoryLabel, s.reason || `Recommended ${categoryLabel.toLowerCase()} for this look`);
    }
  }

  const recommendations = Array.from(groups.entries()).map(([category, products]) => {
    const priority = completeStylePriorityFromCategory(category, completeLookResult.missingCategories || []);
    return {
      category,
      reason: reasons.get(category) || `Recommended ${category.toLowerCase()} for this look`,
      priority,
      priorityLabel: getPriorityLabel(priority),
      products,
    };
  }).sort((a, b) => a.priority - b.priority);

  return {
    completionMode: "product",
    sourceProduct,
    detectedCategory,
    style: {
      occasion: sourceStyle.occasion,
      aesthetic: sourceStyle.aesthetic,
      season: sourceStyle.season,
      formality: sourceStyle.formality,
      colorProfile: {
        primary: sourceStyle.colorProfile.primary,
        type: sourceStyle.colorProfile.type,
      },
    },
    outfitSuggestion:
      completeLookResult.missingCategories && completeLookResult.missingCategories.length > 0
        ? `Try adding ${completeLookResult.missingCategories.join(", ")} to complete this outfit.`
        : "Recommended pieces to complete your style.",
    recommendations,
    totalRecommendations: recommendations.reduce((sum, r) => sum + r.products.length, 0),
  };
}

function applyCompleteStyleOptionFilters(
  suggestions: CompleteLookMappedSuggestion[],
  options: CompleteStyleOptions,
  sourceProduct: { brand?: string | null }
) {
  const excludedBrands = new Set((options.excludeBrands || []).map((b) => String(b).toLowerCase().trim()).filter(Boolean));
  const minPrice = options.priceRange?.min;
  const maxPrice = options.priceRange?.max;
  const preferSameBrand = Boolean(options.preferSameBrand && sourceProduct.brand);
  const sourceBrand = String(sourceProduct.brand || "").toLowerCase().trim();

  let out = suggestions.filter((s) => {
    const brand = String(s.brand || "").toLowerCase().trim();
    if (excludedBrands.size > 0 && brand && excludedBrands.has(brand)) return false;
    const price = typeof s.price_cents === "number" && Number.isFinite(s.price_cents) ? Math.round(s.price_cents) : null;
    if (minPrice != null && price != null && price < minPrice) return false;
    if (maxPrice != null && price != null && price > maxPrice) return false;
    return true;
  });

  if (preferSameBrand && sourceBrand) {
    out = out.slice().sort((a, b) => {
      const aSame = String(a.brand || "").toLowerCase().trim() === sourceBrand ? 1 : 0;
      const bSame = String(b.brand || "").toLowerCase().trim() === sourceBrand ? 1 : 0;
      if (aSame !== bSame) return bSame - aSame;
      return (b.score || 0) - (a.score || 0);
    });
  }

  return out.slice().sort((a, b) => (b.score || 0) - (a.score || 0));
}

async function mergeWardrobeOwnedIntoCompletion(
  completion: OutfitCompletion,
  userId: number,
  options: CompleteStyleOptions
): Promise<OutfitCompletion> {
  const ownedMaxPerCategory = Math.max(1, options.maxPerCategory ?? 5);

  // Fetch products the user already owns (wardrobe-backed).
  // We only return website products, but we merge in owned products and mark them.
  const ownedRows = await pg.query<Product>(`
    SELECT
      p.id,
      p.title,
      p.brand,
      p.category,
      p.color,
      p.price_cents,
      p.currency,
      p.image_url,
      p.image_cdn,
      p.description
    FROM wardrobe_items wi
    JOIN products p ON p.id = wi.product_id
    WHERE wi.user_id = $1
      AND wi.product_id IS NOT NULL
      AND p.availability = true
  `, [userId]);

  if (!ownedRows.rows.length) {
    return completion;
  }

  const ownedProducts = ownedRows.rows.slice(0, 50);

  // Detect product categories for owned items so they can be merged into the right rec buckets.
  const ownedWithDetected = await Promise.all(
    ownedProducts.map(async (p) => {
      const cat = await detectCategory(p.title, p.description);
      return { product: p, detectedCategory: cat.category as ProductCategory };
    })
  );

  for (const rec of completion.recommendations) {
    const tokens = rec.category
      .split(" / ")
      .map(t => t.trim())
      .filter(Boolean);

    const ownedForRec = ownedWithDetected.filter(o =>
      tokens.includes(o.detectedCategory)
    );
    if (ownedForRec.length === 0) continue;

    const ownedIdSet = new Set<number>(ownedForRec.map(o => o.product.id));

    // Mark existing website products that are also owned.
    for (const p of rec.products) {
      if (ownedIdSet.has(p.id)) {
        (p as any).owned = true;
      }
    }

    // Add owned products that weren’t present in the website engine output.
    const existingIds = new Set<number>(rec.products.map(p => p.id));
    const ownedExtras = ownedForRec
      .map(o => o.product)
      .filter(p => !existingIds.has(p.id));

    if (ownedExtras.length > 0) {
      const baseStyle = completion.detectedStyle;
      const stylePrimary = baseStyle.colorProfile.primary.toLowerCase();

      const extras = ownedExtras.map((p) => {
        const candidateColor = (p.color || "").toLowerCase();

        // Basic color-based score so owned items feel relevant (without breaking website scoring).
        let colorHarmony = 0.6;
        if (!candidateColor) {
          colorHarmony = 0.6;
        } else if (stylePrimary === "neutral") {
          colorHarmony = 0.9;
        } else if (candidateColor === stylePrimary) {
          colorHarmony = 0.85;
        } else if (baseStyle.colorProfile.harmonies.some(h => h.colors.includes(candidateColor))) {
          colorHarmony = 0.8;
        }

        const matchScore = Math.round(60 + colorHarmony * 40); // 84-100 range typical

        const matchReasons: string[] = ["In your wardrobe"];
        if (baseStyle.colorProfile.primary && baseStyle.colorProfile.primary !== "neutral") {
          matchReasons.push(
            colorHarmony >= 0.8 ? "Color aligns with your style" : "Good color harmony"
          );
        } else {
          matchReasons.push("Neutral base matches your style");
        }

        return {
          ...p,
          matchScore,
          matchReasons,
          owned: true,
        } as any;
      });

      rec.products = [...extras, ...rec.products];
    }

    // Put owned items first, then keep best matchScore order.
    rec.products = rec.products
      .sort((a: any, b: any) => {
        const aOwned = a.owned === true ? 1 : 0;
        const bOwned = b.owned === true ? 1 : 0;
        if (aOwned !== bOwned) return bOwned - aOwned;
        return (b.matchScore ?? 0) - (a.matchScore ?? 0);
      })
      .slice(0, ownedMaxPerCategory);
  }

  return completion;
}

/**
 * Get human-readable formality label
 */
function getFormalityLabel(formality: number): string {
  if (formality <= 2) return "Very Casual";
  if (formality <= 4) return "Casual";
  if (formality <= 6) return "Smart Casual";
  if (formality <= 8) return "Semi-Formal";
  return "Formal";
}

/**
 * Get human-readable priority label
 */
function getPriorityLabel(priority: number): string {
  switch (priority) {
    case 1: return "Essential";
    case 2: return "Recommended";
    default: return "Optional";
  }
}

// ============================================================================
// Impression Logging
// ============================================================================

/**
 * Log outfit recommendations as impressions for training data
 * Maps outfit completion results to the impression format
 */
async function logOutfitImpressions(
  baseProductId: number,
  result: OutfitCompletion
): Promise<void> {
  const impressions: RecommendationImpression[] = [];
  let globalPosition = 0;

  const basePriceCents = result.sourceProduct.price_cents || 1;
  const baseCategory = result.detectedCategory;

  for (const recommendation of result.recommendations) {
    for (const product of recommendation.products) {
      globalPosition++;

      // Calculate price ratio
      const priceRatio = product.price_cents / basePriceCents;

      // Build category pair string
      const candidateCategory = recommendation.category.split(" / ")[0]?.toLowerCase() || "unknown";
      const categoryPair = `${baseCategory}->${candidateCategory}`;

      // Extract style/color scores from match reasons
      const matchReasons = product.matchReasons || [];
      const hasColorMatch = matchReasons.some((r) => r.toLowerCase().includes("color"));
      const hasStyleMatch = matchReasons.some(
        (r) => r.toLowerCase().includes("formality") || r.toLowerCase().includes("occasion")
      );

      // Normalize matchScore to 0-1 (assuming max ~100)
      const normalizedMatchScore = Math.min(1, product.matchScore / 100);

      impressions.push({
        baseProductId,
        candidateProductId: product.id,
        position: globalPosition,
        
        // Core scores - outfit engine doesn't have CLIP/text scores directly
        candidateScore: normalizedMatchScore,
        clipSim: undefined,  // Not available from outfit engine
        textSim: undefined,
        opensearchScore: undefined,
        pHashDist: undefined,
        
        // Style matching scores
        styleScore: hasStyleMatch ? normalizedMatchScore * 0.7 : normalizedMatchScore * 0.3,
        colorScore: hasColorMatch ? 0.8 : 0.2,
        finalMatchScore: product.matchScore,
        
        // Context features
        categoryPair,
        priceRatio,
        sameBrand: product.brand?.toLowerCase() === result.sourceProduct.brand?.toLowerCase(),
        sameVendor: false,  // Not tracked in outfit completion
        
        // Match reasons
        matchReasons,
        
        // Source
        source: "outfit",
        context: "complete_outfit",
      });
    }
  }

  if (impressions.length > 0) {
    await logImpressionBatch({
      baseProductId,
      impressions,
      context: "complete_outfit",
    });
  }
}
