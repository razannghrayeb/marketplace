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
import { catalogGenderFromCaption } from "../../lib/image/captionAttributeInference";
import { coarseColorBucket } from "../../lib/color/colorCanonical";
import { completeStyleCategoryLabel } from "./outfit-category";

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
  sourceMode?: "default" | "tryon";
  audienceGenderHint?: "men" | "women" | "unisex";
  allowLegacyFallback?: boolean;
}

export interface StyleRecommendationResponse {
  completionMode: "product" | "tryon";
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

  // Skip outfit recommendations for non-clothing items (makeup, skincare, jewelry, accessories, etc.)
  if (!isClothingItem(sourceProduct)) {
    return null;
  }

  // Use the wardrobe complete-look engine for product pages so both catalog product
  // and user wardrobe context influence the recommendations.
  const maxTotal = Math.max(1, Math.min(options.maxTotal ?? 20, 50));
  const maxPerCategory = Math.max(1, Math.min(options.maxPerCategory ?? 8, 20));
  const retrievalPoolSize = Math.max(maxTotal * 3, 30);
  const anchorProductIds = [productId];
  
  const detected = await detectCategory(sourceProduct.title, sourceProduct.description);
  const resolvedSourceCategory = correctDetectedSourceCategory(
    detected.category as ProductCategory,
    sourceProduct
  );
  
  // Infer audience gender from product metadata first, then BLIP if unknown
  let audienceGenderHint =
    options.audienceGenderHint ||
    normalizeAudienceHint(sourceProduct.gender) ||
    inferAudienceGenderHintFromProduct(sourceProduct);
  
  // If gender is unknown and we have an image, use BLIP to detect gender from image content.
  // We only trust BLIP when caption parsing yields a concrete retail gender signal.
  if (!audienceGenderHint && sourceProduct.image_url) {
    try {
      audienceGenderHint = await inferGenderFromImageUrl(sourceProduct.image_url, sourceProduct.title);
    } catch (err) {
      // Silently fail - fall back to text-based inference
      console.debug("[OutfitService] BLIP gender detection failed, using text hints");
    }
  }
  
  const ageGroupHint = inferAgeGroupHintFromProduct(sourceProduct);
  const rawSourceStyle = await buildStyleProfile(sourceProduct);
  const sourceStyle = calibrateSourceStyleFromAnchor(sourceProduct, resolvedSourceCategory, rawSourceStyle);

  // Pass detected category to wardrobe engine for accurate gap detection
  const detectedCategoryMap = new Map<number, string>();
  if (resolvedSourceCategory !== "unknown") {
    detectedCategoryMap.set(productId, resolvedSourceCategory);
  }

  const completeLookResult = await completeLookSuggestionsForCatalogProducts(
    userId ?? 0,
    anchorProductIds,
    retrievalPoolSize,
    undefined,
    { 
      audienceGenderHint, 
      ageGroupHint,
      occasionHint: sourceStyle.occasion,
      styleHints: [sourceStyle.aesthetic, sourceStyle.occasion === "active" ? "sporty" : ""].filter(Boolean),
      colorHints: [sourceProduct.color || sourceStyle.colorProfile.primary].filter(Boolean),
      weatherHint: sourceStyle.season === "winter"
        ? { season: "winter", temperatureC: 8 }
        : sourceStyle.season === "summer"
          ? { season: "summer", temperatureC: 30 }
          : sourceStyle.season === "spring"
            ? { season: "spring", temperatureC: 20 }
            : sourceStyle.season === "fall"
              ? { season: "fall", temperatureC: 16 }
              : undefined,
      detectedCategories: detectedCategoryMap,
    }
  );

  const rerankedSuggestions = await rerankCompleteStyleSuggestions({
    sourceProduct,
    sourceStyle,
    sourceCategory: resolvedSourceCategory,
    suggestions: completeLookResult.suggestions,
    userId,
    maxSuggestions: Math.max(retrievalPoolSize * 2, maxTotal * 2),
    sourceAudienceGenderHint: audienceGenderHint,
    sourceAgeGroupHint: ageGroupHint,
  });

  const filteredSuggestions = applyCompleteStyleOptionFilters(
    rerankedSuggestions,
    options,
    sourceProduct
  );
  const prioritizedMissingCategories = mergeMissingCategoriesWithCoverageNeeds(
    completeLookResult.missingCategories,
    resolvedSourceCategory
  );

  const balancedSuggestions = balanceSuggestionsForCoverage(
    filteredSuggestions,
    prioritizedMissingCategories,
    maxTotal,
    maxPerCategory
  );

  const ensureCoreSlotsPresent = (
    base: CompleteLookMappedSuggestion[],
    backup: CompleteLookMappedSuggestion[]
  ): CompleteLookMappedSuggestion[] => {
    const out = [...base];
    const hasSlot = (slot: string) =>
      out.some((s) => categoryFamily(`${s.category || ""} ${s.title || ""}`) === slot);
    const usedIds = new Set(out.map((s) => s.product_id));
    const needShoes = prioritizedMissingCategories.includes("shoes") && !hasSlot("shoes");
    const needBags = prioritizedMissingCategories.includes("bags") && !hasSlot("bags");
    if (!needShoes && !needBags) return out;

    const rankedBackup = [...backup].sort((a, b) => (b.score || 0) - (a.score || 0));
    for (const candidate of rankedBackup) {
      if (out.length >= maxTotal) break;
      if (usedIds.has(candidate.product_id)) continue;
      const family = categoryFamily(`${candidate.category || ""} ${candidate.title || ""}`);
      if ((needShoes && family === "shoes") || (needBags && family === "bags")) {
        out.push(candidate);
        usedIds.add(candidate.product_id);
        if (needShoes && family === "shoes") {
          // no-op: recomputed by hasSlot below
        }
        if (needBags && family === "bags") {
          // no-op: recomputed by hasSlot below
        }
        if ((!needShoes || hasSlot("shoes")) && (!needBags || hasSlot("bags"))) break;
      }
    }
    return out;
  };
  const balancedWithCoreSlots = ensureCoreSlotsPresent(
    balancedSuggestions,
    rerankedSuggestions
  );

  if (balancedWithCoreSlots.length > 0) {
    return mapCompleteLookToStyleResponse({
      sourceProduct,
      completeLookResult: {
        ...completeLookResult,
        missingCategories: prioritizedMissingCategories,
        suggestions: balancedWithCoreSlots,
      },
      maxPerCategory,
      detectedCategory: resolvedSourceCategory,
      sourceStyle,
    });
  }

  // Main-path rescue: keep response in complete-look pipeline with a lighter coverage fallback.
  const relaxedSuggestions = balanceSuggestionsForCoverage(
    rerankedSuggestions,
    prioritizedMissingCategories,
    maxTotal,
    maxPerCategory
  );
  const relaxedWithCoreSlots = ensureCoreSlotsPresent(
    relaxedSuggestions,
    rerankedSuggestions
  );
  if (relaxedWithCoreSlots.length > 0) {
    return mapCompleteLookToStyleResponse({
      sourceProduct,
      completeLookResult: {
        ...completeLookResult,
        missingCategories: prioritizedMissingCategories,
        suggestions: relaxedWithCoreSlots,
      },
      maxPerCategory,
      detectedCategory: resolvedSourceCategory,
      sourceStyle,
    });
  }

  // Optional legacy fallback, disabled by default to avoid quality regressions.
  if (options.allowLegacyFallback === true) {
    const result = await completeOutfitFromProductId(productId, {
      maxPerCategory: options.maxPerCategory,
      maxTotal: options.maxTotal,
      priceRange: options.priceRange,
      excludeBrands: options.excludeBrands,
      preferSameBrand: options.preferSameBrand,
      disablePriceFilter: options.disablePriceFilter,
    });
    if (!result) return null;
    return formatOutfitCompletion(userId ? await mergeWardrobeOwnedIntoCompletion(result, userId, options) : result);
  }

  return mapCompleteLookToStyleResponse({
    sourceProduct,
    completeLookResult: {
      ...completeLookResult,
      missingCategories: prioritizedMissingCategories,
      suggestions: [],
    },
    maxPerCategory,
    detectedCategory: resolvedSourceCategory,
    sourceStyle,
  });

  // Log impressions for training data (async, non-blocking)
  // Intentionally skipped when no legacy result is used.
}

/**
 * Get outfit recommendations for a product object (not from database)
 */
export async function getOutfitRecommendationsFromProduct(
  product: Product,
  options: CompleteStyleOptions = {},
  userId?: number
): Promise<StyleRecommendationResponse> {
  if (options.sourceMode !== "tryon") {
    const catalogProductId = await resolveCatalogProductIdForCompleteStyle(product);
    if (catalogProductId) {
      const completeLookBacked = await getOutfitRecommendations(catalogProductId, options, userId);
      if (completeLookBacked) return completeLookBacked;
    }
  }

  const result = await completeMyStyle(product, {
    maxPerCategory: options.maxPerCategory,
    maxTotal: options.maxTotal,
    priceRange: options.priceRange,
    excludeBrands: options.excludeBrands,
    preferSameBrand: options.preferSameBrand,
    disablePriceFilter: options.disablePriceFilter,
  });

  const formatted = formatOutfitCompletion(
    userId ? await mergeWardrobeOwnedIntoCompletion(result, userId, options) : result
  );
  if (options.sourceMode === "tryon") {
    return {
      ...formatted,
      completionMode: "tryon",
    };
  }
  return formatted;
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

/**
 * Check if product is a clothing/apparel item (vs makeup, skincare, jewelry, etc.)
 * Returns false for non-apparel items to skip outfit recommendations
 */
function isClothingItem(product: { category?: string | null; title?: string | null; description?: string | null }): boolean {
  const text = `${String(product.category || "")} ${String(product.title || "")} ${String(product.description || "")}`.toLowerCase();
  
  // Non-apparel keywords that should be excluded
  const nonApparel = [
    "makeup", "cosmetics", "skincare", "beauty", "serum", "lotion", "cream", "moisturizer",
    "lipstick", "mascara", "eyeshadow", "foundation", "concealer", "blush", "bronzer",
    "nail polish", "nail care", "shampoo", "conditioner", "hair care", "hair product",
    "perfume", "fragrance", "cologne", "deodorant", "antiperspirant",
    "face wash", "cleanser", "toner", "essence", "mask", "exfoliator",
    "sunscreen", "spf", "sunblock", "retinol", "niacinamide", "hyaluronic",
    "jewelry box", "watch case", "jewelry cleaner", "jewelry box",
    "phone case", "phone cover", "screen protector",
    "home decor", "pillow", "bedding", "blanket", "throw"
  ];
  
  // Apparel keywords that should be included
  const apparel = [
    "fashion", "clothes", "clothing", "apparel", "garment",
    "dress", "shirt", "pants", "jeans", "shorts", "skirt", "tops", "tops",
    "jacket", "coat", "blazer", "sweater", "hoodie", "cardigan", "sweatshirt",
    "shoe", "shoes", "sneaker", "boot", "heel", "sandal", "loafer", "flat",
    "bag", "backpack", "tote", "clutch", "wallet",
    "scarf", "belt", "hat", "glove", "sock", "stocking",
    "swimsuit", "swimwear", "bikini", "bathing",
    "athletic", "activewear", "sportswear", "workout", "gym wear"
  ];
  
  // Check for non-apparel exclusions first
  for (const keyword of nonApparel) {
    if (text.includes(keyword)) {
      return false;
    }
  }
  
  // Check for apparel inclusions
  for (const keyword of apparel) {
    if (text.includes(keyword)) {
      return true;
    }
  }
  
  // Default: if category exists and isn't explicitly non-apparel, allow it
  // This handles generic cases and edge cases
  return Boolean(product.category);
}

/**
 * Infer audience gender from image URL using BLIP vision model
 * Returns "men" | "women" | undefined based on high-confidence visual cues
 */
async function inferGenderFromImageUrl(imageUrl: string, productTitle?: string | null): Promise<string | undefined> {
  try {
    // Fetch image buffer from URL with explicit abort timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(imageUrl, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return undefined;

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (!buffer || buffer.length === 0) return undefined;

    // Use BLIP to generate caption describing the image
    const { blip } = await import("../../lib/image");
    const caption = await blip.caption(buffer).catch(() => null);
    if (!caption || typeof caption !== "string") return undefined;

    // Extract gender from caption using same logic as image analysis service
    const parsed = catalogGenderFromCaption(caption, productTitle);
    if (parsed === "men" || parsed === "women" || parsed === "unisex") {
      return parsed;
    }
    return undefined;
  } catch (err) {
    // Silently fail - BLIP may not be available or image may be unreachable
    return undefined;
  }
}

// ============================================================================
function formatOutfitCompletion(result: OutfitCompletion): StyleRecommendationResponse {
  const seenProductIds = new Set<number>();
  const seenNearDuplicateKeys = new Set<string>();
  const sourceText = `${String(result.sourceProduct.title || "")} ${String(result.sourceProduct.category || "")} ${String(result.sourceProduct.description || "")}`.toLowerCase();
  const sourceIsDress = /\b(dress|midi dress|mini dress|maxi dress|gown)\b/.test(sourceText) || categoryFamily(result.detectedCategory) === "dress";
  const dressOccasion = result.detectedStyle.occasion;
  const dressSeason = result.detectedStyle.season;

  const shouldKeepProductForResponse = (category: string, product: Product): boolean => {
    const text = `${String(product.title || "")} ${String(product.category || "")} ${String(product.description || "")}`.toLowerCase();
    const normalizedCategory = String(category || "").toLowerCase();

    // Final guard: exclude bag-accessory placeholders without concrete bag subtype.
    if (normalizedCategory.includes("bag")) {
      const isBagAccessoryBucket = /\bbag accessories?\b/.test(text);
      const hasRealBagSubtype = /\b(tote|crossbody|clutch|satchel|backpack|shoulder bag|messenger|hobo|bucket bag|handbag|top handle|mini bag)\b/.test(text);
      if (isBagAccessoryBucket && !hasRealBagSubtype) return false;
      if (/\b(wallet|card holder|card case|keychain|key ring|strap|bag charm|coin purse|phone case)\b/.test(text)) return false;
    }

    // Final guard for dress styling: spring/summer semi-formal or party should avoid heavy boots.
    if (normalizedCategory.includes("shoe") && sourceIsDress) {
      const isBootLike = /\b(boot|boots|ankle boot|combat boot)\b/.test(text);
      const isDressySummerShoe = /\b(heel|heels|pump|pumps|sandal|sandals|mule|mules|ballet|flat|loafer|espadrille)\b/.test(text);
      if ((dressOccasion === "party" || dressOccasion === "semi-formal" || dressOccasion === "formal") &&
          (dressSeason === "spring" || dressSeason === "summer")) {
        if (isBootLike) return false;
        return isDressySummerShoe;
      }
    }

    return true;
  };

  const recommendations = result.recommendations
    .map((rec) => {
      const products = rec.products
        .filter((p) => shouldKeepProductForResponse(rec.category, p))
        .map((p) => {
          const raw = p as Product & { product_id?: number };
          const id = raw.id ?? raw.product_id;
          const priceCents =
            typeof raw.price_cents === "number" && Number.isFinite(raw.price_cents)
              ? Math.max(0, Math.round(raw.price_cents))
              : 0;

          const normalizedTitle = String(p.title || "")
            .toLowerCase()
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 120);
          const normalizedBrand = String(p.brand || "")
            .toLowerCase()
            .replace(/\s+/g, " ")
            .trim();
          const normalizedImage = String(p.image_cdn || p.image_url || "")
            .toLowerCase()
            .replace(/^https?:\/\//, "")
            .trim();

          const resolvedId = typeof id === "number" && Number.isFinite(id) ? id : 0;
          const nearDuplicateKey = `${normalizedBrand}|${normalizedTitle}|${normalizedImage}`;

          if (resolvedId < 1) return null;
          if (seenProductIds.has(resolvedId)) return null;
          if (seenNearDuplicateKeys.has(nearDuplicateKey)) return null;

          seenProductIds.add(resolvedId);
          seenNearDuplicateKeys.add(nearDuplicateKey);

          return {
            id: resolvedId,
            title: p.title,
            brand: p.brand,
            price: priceCents,
            currency: p.currency || "USD",
            image: p.image_cdn || p.image_url,
            matchScore: Math.round(p.matchScore),
            matchReasons: p.matchReasons,
            owned: (p as any).owned === true ? true : undefined,
          };
        })
        .filter((row): row is NonNullable<typeof row> => Boolean(row));

      return {
        category: rec.category,
        reason: rec.reason,
        priority: rec.priority,
        priorityLabel: getPriorityLabel(rec.priority),
        products,
      };
    })
    .filter((rec) => rec.products.length > 0);

  const correctedDetectedCategory = correctDetectedSourceCategory(
    result.detectedCategory as ProductCategory,
    result.sourceProduct
  );

  return {
    completionMode: "product",
    sourceProduct: result.sourceProduct,
    detectedCategory: correctedDetectedCategory,
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
    recommendations,
    totalRecommendations: recommendations.reduce((sum, r) => sum + r.products.length, 0),
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

async function resolveCatalogProductIdForCompleteStyle(product: Product): Promise<number | null> {
  const directId = Number(product.id);
  if (Number.isFinite(directId) && directId >= 1) {
    const existing = await getCatalogProductById(Math.floor(directId));
    if (existing?.id) return existing.id;
  }

  const normalizedTitle = String(product.title || "").trim();
  if (!normalizedTitle) return null;
  const normalizedBrand = String(product.brand || "").trim();

  try {
    if (normalizedBrand) {
      const exact = await pg.query<{ id: number }>(
        `SELECT id
         FROM products
         WHERE lower(title) = lower($1)
           AND lower(brand) = lower($2)
         ORDER BY id DESC
         LIMIT 1`,
        [normalizedTitle, normalizedBrand]
      );
      if (exact.rows[0]?.id) return exact.rows[0].id;
    }

    const titleOnly = await pg.query<{ id: number }>(
      `SELECT id
       FROM products
       WHERE lower(title) = lower($1)
       ORDER BY id DESC
       LIMIT 1`,
      [normalizedTitle]
    );
    if (titleOnly.rows[0]?.id) return titleOnly.rows[0].id;
  } catch (err) {
    console.warn("[OutfitService] resolve catalog product for complete-style failed", {
      title: normalizedTitle,
      brand: normalizedBrand || undefined,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return null;
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
  sourceAudienceGenderHint?: string;
  sourceAgeGroupHint?: string;
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
  gender?: string | null;
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

function inferAgeSegmentFromText(value: string): "adult" | "kids" | "unknown" {
  const text = normalizeStyleToken(value);
  if (!text) return "unknown";
  const kidsHits = (text.match(/\b(kids?|children|child|baby|newborn|infant|toddler|youth|junior|teen|teens|boy|boys|girl|girls)\b/g) || []).length;
  const adultHits = (text.match(/\b(men|mens|men's|women|womens|women's|adult|ladies|gents|male|female)\b/g) || []).length;
  if (kidsHits > adultHits && kidsHits > 0) return "kids";
  if (adultHits > kidsHits && adultHits > 0) return "adult";
  return "unknown";
}

function inferGenderSegmentFromText(value: string): "men" | "women" | "unisex" | "unknown" {
  const text = normalizeStyleToken(value);
  if (!text) return "unknown";
  if (/\b(unisex|all gender|all-gender|neutral)\b/.test(text)) return "unisex";
  const menHits = (text.match(/\b(men|mens|men's|male|gents)\b/g) || []).length;
  const womenHits = (text.match(/\b(women|womens|women's|female|ladies)\b/g) || []).length;
  if (menHits > womenHits && menHits > 0) return "men";
  if (womenHits > menHits && womenHits > 0) return "women";
  return "unknown";
}

function shouldRejectByDemographicRestrictions(params: {
  sourceAge: "adult" | "kids" | "unknown";
  sourceGender: "men" | "women" | "unisex" | "unknown";
  candidateAge: "adult" | "kids" | "unknown";
  candidateGender: "men" | "women" | "unisex" | "unknown";
}): boolean {
  const { sourceAge, sourceGender, candidateAge, candidateGender } = params;
  if (sourceAge === "adult" && candidateAge === "kids") return true;
  if (sourceAge === "kids" && candidateAge === "adult") return true;
  if (
    (sourceGender === "women" || sourceGender === "men") &&
    candidateGender !== "unknown" &&
    candidateGender !== "unisex" &&
    candidateGender !== sourceGender
  ) {
    return true;
  }
  return false;
}

function hasPatternCue(value: string): boolean {
  const text = normalizeStyleToken(value);
  if (!text) return false;
  return /\b(stripe|striped|plaid|check|checked|tartan|print|printed|pattern|patterned|floral|animal|leopard|zebra|paisley|polka)\b/.test(text);
}

function isPatternHeavyPair(sourceText: string, candidateText: string): boolean {
  return hasPatternCue(sourceText) && hasPatternCue(candidateText);
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

function footwearSubtypeLabel(value: string): string {
  const text = normalizeStyleToken(value);
  if (/\b(heel|pump|stiletto|mule)\b/.test(text)) return "heels";
  if (/\b(loafer|moccasin|oxford)\b/.test(text)) return "loafers";
  if (/\b(flat|ballerina)\b/.test(text)) return "flats";
  if (/\b(sandal|slide|flip flop|espadrille)\b/.test(text)) return "sandals";
  if (/\b(sneaker|trainer|running shoe|canvas)\b/.test(text)) return "sneakers";
  if (/\b(boot|ankle boot|knee boot|combat)\b/.test(text)) return "boots";
  return "other";
}

function isFeminineShoeCue(value: string): boolean {
  const text = normalizeStyleToken(value);
  return /\b(heel|heels|pump|pumps|stiletto|stilettos|sandal|sandals|dress sandal|mule|mules|ballet flat|ballerina|mary jane|slingback|kitten heel|espadrille|loafer|loafers|boot|boots|ankle boot)\b/.test(text);
}

function preferredShoeSubtypesByOccasion(
  occasion: StyleProfile["occasion"],
  season: StyleProfile["season"]
): string[] {
  if (occasion === "party") return ["heels", "sandals", "flats"];
  if (occasion === "formal" || occasion === "semi-formal") return ["loafers", "heels", "flats", "boots"];
  if (occasion === "active") return ["sneakers"];
  if (occasion === "beach") return ["sandals", "flats", "sneakers"];
  if (season === "winter" || season === "fall") return ["boots", "loafers", "sneakers", "flats"];
  return ["sneakers", "flats", "sandals", "loafers"];
}

function topSubtypeLabel(value: string): "tee" | "shirt" | "blouse" | "sweater" | "hoodie" | "tank" | "other" {
  const text = normalizeStyleToken(value);
  if (/\b(t-?shirt|tee|crew neck tee|crew-neck tee)\b/.test(text)) return "tee";
  if (/\b(shirt|oxford|button down|button-down)\b/.test(text)) return "shirt";
  if (/\b(blouse)\b/.test(text)) return "blouse";
  if (/\b(sweater|knit|cardigan)\b/.test(text)) return "sweater";
  if (/\b(hoodie|sweatshirt)\b/.test(text)) return "hoodie";
  if (/\b(tank|cami|strapless|crop top)\b/.test(text)) return "tank";
  return "other";
}

function preferredTopSubtypesByOccasion(
  occasion: StyleProfile["occasion"]
): Array<ReturnType<typeof topSubtypeLabel>> {
  if (occasion === "party") return ["blouse", "shirt", "tank"];
  if (occasion === "formal" || occasion === "semi-formal") return ["shirt", "blouse", "sweater"];
  if (occasion === "active") return ["tee", "tank", "hoodie"];
  if (occasion === "beach") return ["tank", "tee", "shirt"];
  return ["tee", "shirt", "sweater", "hoodie", "tank"];
}

function preferredTopSubtypesBySeason(
  season: StyleProfile["season"]
): Array<ReturnType<typeof topSubtypeLabel>> {
  if (season === "summer") return ["tank", "tee", "shirt", "blouse"];
  if (season === "winter") return ["sweater", "hoodie", "shirt", "blouse"];
  if (season === "fall") return ["sweater", "shirt", "tee", "hoodie"];
  return ["tee", "shirt", "blouse", "sweater"];
}

function assessTopCandidate(params: {
  sourceStyle: StyleProfile;
  candidateTitle?: string | null;
  candidateCategory?: string | null;
  candidateDescription?: string | null;
}): {
  subtype: ReturnType<typeof topSubtypeLabel>;
  isNoise: boolean;
  pipelineScore: number;
} {
  const { sourceStyle, candidateTitle, candidateCategory, candidateDescription } = params;
  const text = normalizeStyleToken(`${candidateTitle || ""} ${candidateCategory || ""} ${candidateDescription || ""}`);
  const subtype = topSubtypeLabel(text);
  const hasTopCue = /\b(top|t-?shirt|tee|shirt|blouse|sweater|hoodie|sweatshirt|tank|cami|crop top|knit|cardigan)\b/.test(text);
  const accessoryNoise = /\b(belt|watch|bracelet|earring|ring|necklace|hat|cap|beanie|scarf)\b/.test(text);
  const preferredByOccasion = preferredTopSubtypesByOccasion(sourceStyle.occasion);
  const preferredBySeason = preferredTopSubtypesBySeason(sourceStyle.season);
  const heavyCue = /\b(sweater|hoodie|wool|fleece|thermal|knit)\b/.test(text);
  const lightCue = /\b(tank|sleeveless|linen|short sleeve|cami)\b/.test(text);

  let pipelineScore = 0.45;
  if (hasTopCue) pipelineScore += 0.2;
  if (subtype !== "other") pipelineScore += 0.16;
  if (preferredByOccasion.includes(subtype)) pipelineScore += 0.12;
  if (preferredBySeason.includes(subtype)) pipelineScore += 0.1;
  if (sourceStyle.season === "winter" && lightCue) pipelineScore -= 0.22;
  if (sourceStyle.season === "summer" && heavyCue) pipelineScore -= 0.18;
  if (sourceStyle.occasion === "active" && !["tee", "tank", "hoodie"].includes(subtype)) pipelineScore -= 0.18;
  if (accessoryNoise) pipelineScore -= 0.35;

  return {
    subtype,
    isNoise: !hasTopCue || accessoryNoise,
    pipelineScore: Math.max(0, Math.min(1, pipelineScore)),
  };
}

function assessShoeCandidate(params: {
  sourceStyle: StyleProfile;
  sourceFamily: string;
  candidateTitle?: string | null;
  candidateCategory?: string | null;
  candidateDescription?: string | null;
}): {
  subtype: string;
  isNoise: boolean;
  pipelineScore: number;
} {
  const { sourceStyle, sourceFamily, candidateTitle, candidateCategory, candidateDescription } = params;
  const text = normalizeStyleToken(`${candidateTitle || ""} ${candidateCategory || ""} ${candidateDescription || ""}`);
  const subtype = footwearSubtypeLabel(text);
  const footwearCue = /\b(shoe|shoes|sneaker|trainer|boot|heel|pump|sandal|loafer|flat|oxford|mule|espadrille)\b/.test(text);
  const accessoryNoiseCue = /\b(sock|socks|shoe lace|shoelace|insole|insoles|care kit|cleaner|deodorizer)\b/.test(text);
  const preferred = preferredShoeSubtypesByOccasion(sourceStyle.occasion, sourceStyle.season);
  const weatherFit = isWeatherSuitableShoeForSeason(sourceStyle.season, text);

  let pipelineScore = 0.45;
  if (footwearCue) pipelineScore += 0.22;
  if (subtype !== "other") pipelineScore += 0.2;
  if (preferred.includes(subtype)) pipelineScore += 0.14;
  if (!weatherFit) pipelineScore -= 0.28;
  if (accessoryNoiseCue) pipelineScore -= 0.3;
  if (sourceFamily === "dress" && sourceStyle.occasion !== "casual" && subtype === "sneakers") pipelineScore -= 0.22;

  return {
    subtype,
    isNoise: accessoryNoiseCue || !footwearCue,
    pipelineScore: Math.max(0, Math.min(1, pipelineScore)),
  };
}

function isWeatherSuitableShoeForSeason(
  season: StyleProfile["season"],
  value: string
): boolean {
  const text = normalizeStyleToken(value);
  const heavyWinterCue = /\b(boot|boots|fur|fleece|lined|thermal|waterproof)\b/.test(text);
  const lightWarmCue = /\b(sandal|sandals|mule|mules|espadrille|open toe|slides?|flip flop)\b/.test(text);

  if (season === "summer") {
    if (heavyWinterCue) return false;
    return true;
  }
  if (season === "winter") {
    if (lightWarmCue) return false;
    return true;
  }
  return true;
}

function isStrictBagProduct(
  title?: string | null,
  category?: string | null,
  description?: string | null
): boolean {
  const assessment = assessBagCandidate(`${title || ""} ${category || ""} ${description || ""}`);
  return assessment.isBagCandidate && !assessment.isAccessoryNoise && assessment.pipelineScore >= 0.58;
}

function assessBagCandidate(value: string): {
  isBagCandidate: boolean;
  subtype: ReturnType<typeof bagSubtypeLabel>;
  isAccessoryNoise: boolean;
  isTravelUtility: boolean;
  pipelineScore: number;
} {
  const text = normalizeStyleToken(value);
  const hasBagCue = /\b(bag|handbag|tote|crossbody|clutch|satchel|backpack|shoulder bag|messenger|hobo|bucket bag|belt bag|mini bag|top handle)\b/.test(text);
  const subtype = bagSubtypeLabel(text);
  const isAccessoryNoise = /\b(wallet|card holder|card case|keychain|key ring|bag charm|charm|strap|belt only|coin purse|phone case|pouch accessory)\b/.test(text);
  const isTravelUtility = /\b(duffle|duffel|luggage|suitcase|travel pouch|toiletry|passport holder)\b/.test(text);
  const isBagAccessoriesBucket = /\bbag accessories?\b/.test(text);

  let pipelineScore = 0.5;
  if (hasBagCue) pipelineScore += 0.2;
  if (subtype !== "other") pipelineScore += 0.2;
  if (isBagAccessoriesBucket && subtype === "other") pipelineScore -= 0.24;
  if (isAccessoryNoise) pipelineScore -= 0.24;
  if (isTravelUtility) pipelineScore -= 0.16;

  return {
    isBagCandidate: hasBagCue,
    subtype,
    isAccessoryNoise,
    isTravelUtility,
    pipelineScore: Math.max(0, Math.min(1, pipelineScore)),
  };
}

function bagSubtypeLabel(value: string): "clutch" | "crossbody" | "tote" | "backpack" | "satchel" | "shoulder" | "other" {
  const text = normalizeStyleToken(value);
  if (/\b(clutch|evening bag)\b/.test(text)) return "clutch";
  if (/\b(crossbody|cross body|messenger)\b/.test(text)) return "crossbody";
  if (/\b(tote|shopper)\b/.test(text)) return "tote";
  if (/\b(backpack|rucksack)\b/.test(text)) return "backpack";
  if (/\b(satchel|top handle|structured bag)\b/.test(text)) return "satchel";
  if (/\b(shoulder bag|hobo)\b/.test(text)) return "shoulder";
  return "other";
}

function preferredBagSubtypesByOccasion(occasion: StyleProfile["occasion"]): Array<ReturnType<typeof bagSubtypeLabel>> {
  if (occasion === "party") return ["clutch", "satchel", "shoulder"];
  if (occasion === "formal" || occasion === "semi-formal") return ["satchel", "clutch", "shoulder"];
  if (occasion === "active") return ["backpack", "crossbody"];
  if (occasion === "beach") return ["tote", "crossbody"];
  return ["crossbody", "tote", "shoulder", "backpack"];
}

function preferredBagSubtypesBySeason(
  season: StyleProfile["season"]
): Array<ReturnType<typeof bagSubtypeLabel>> {
  if (season === "summer") return ["tote", "crossbody", "shoulder", "clutch"];
  if (season === "winter") return ["satchel", "shoulder", "crossbody", "backpack"];
  if (season === "fall") return ["satchel", "crossbody", "shoulder", "tote"];
  return ["crossbody", "tote", "shoulder", "satchel"];
}

function scoreFootwearAestheticCompatibility(
  sourceStyle: StyleProfile,
  candidateTitle: string,
  candidateCategory?: string | null
): number {
  const text = normalizeStyleToken(`${candidateTitle || ""} ${candidateCategory || ""}`);
  const isSneakerLike = /\b(sneaker|trainer|running|tennis shoe|athletic)\b/.test(text);
  const isHeelLike = /\b(heel|pump|stiletto)\b/.test(text);
  const isLoaferLike = /\b(loafer|oxford|derby)\b/.test(text);
  const isBootLike = /\b(boot|ankle boot)\b/.test(text);

  if (sourceStyle.aesthetic === "classic" || sourceStyle.aesthetic === "minimalist") {
    if (isSneakerLike && sourceStyle.formality >= 3.5) return 0.42;
    if (isHeelLike && sourceStyle.occasion === "casual") return 0.48;
    if (isLoaferLike || isBootLike) return 0.92;
    return 0.72;
  }
  if (sourceStyle.aesthetic === "streetwear" || sourceStyle.aesthetic === "sporty") {
    if (isSneakerLike) return 0.94;
    if (isHeelLike) return 0.44;
    return 0.74;
  }
  return 0.78;
}

function isSportBottomCue(value: string): boolean {
  const text = normalizeStyleToken(value);
  return /\b(legging|leggings|jogger|joggers|track pant|track pants|sports legging|athletic|training|gym|running|padel)\b/.test(text);
}

function isSkirtBottomCue(value: string): boolean {
  const text = normalizeStyleToken(value);
  return /\b(skirt|mini skirt|midi skirt|maxi skirt|pleated skirt)\b/.test(text);
}

function isCozyTopAnchor(source: { title?: string | null; category?: string | null; description?: string | null }): boolean {
  const text = normalizeStyleToken(`${source.title || ""} ${source.category || ""} ${source.description || ""}`);
  return /\b(sweater|hoodie|sweatshirt|cardigan|knit|wool|fleece|crew neck|crew-neck)\b/.test(text);
}

function isSportAnchorProduct(source: {
  title?: string | null;
  category?: string | null;
  description?: string | null;
}): boolean {
  const text = normalizeStyleToken(`${source.title || ""} ${source.category || ""} ${source.description || ""}`);
  return /\b(legging|leggings|sports legging|activewear|sportswear|workout|gym|training|running|quick-drying|spandex|technical shorts?|track|athletic)\b/.test(text);
}

function isWinterAnchorProduct(source: { title?: string | null; category?: string | null; description?: string | null }, sourceStyle: StyleProfile): boolean {
  if (sourceStyle.season === "winter") return true;
  const text = normalizeStyleToken(`${source.title || ""} ${source.category || ""} ${source.description || ""}`);
  return /\b(wool|knit|knitted|cardigan|sweater|cashmere|fleece|thermal|heavy)\b/.test(text);
}

function isWarmSeasonItem(title?: string | null, category?: string | null): boolean {
  const text = normalizeStyleToken(`${title || ""} ${category || ""}`);
  return /\b(short|shorts|mini skirt|linen short|swim|bikini|tank|sleeveless|sandal|flip flop|slide|espadrille)\b/.test(text);
}

function isColdAccessoryCandidate(value: string): boolean {
  const text = normalizeStyleToken(value);
  return /\b(scarf|scarves|beanie|earmuffs?|gloves?|mittens?|wool hat|knit hat|winter hat)\b/.test(text);
}

function shouldRejectAccessoryForSourceWeather(
  sourceProduct: { title?: string | null; category?: string | null; description?: string | null },
  sourceStyle: StyleProfile,
  candidateTitle?: string | null,
  candidateCategory?: string | null,
  candidateDescription?: string | null,
): boolean {
  const candidateText = `${String(candidateTitle || "")} ${String(candidateCategory || "")} ${String(candidateDescription || "")}`;
  if (!isColdAccessoryCandidate(candidateText)) return false;

  const sourceText = normalizeStyleToken(
    `${sourceProduct.title || ""} ${sourceProduct.category || ""} ${sourceProduct.description || ""}`
  );
  const explicitlyColdAnchor =
    sourceStyle.season === "winter" ||
    /\b(winter|cold|coat|jacket|parka|puffer|sweater|cardigan|hoodie|knit|knitted|wool|cashmere|fleece|thermal)\b/.test(sourceText);
  const beachOnlyScarf = /\b(beach scarf|sarong|pareo)\b/.test(normalizeStyleToken(candidateText));

  if (sourceStyle.occasion === "beach" && beachOnlyScarf) return false;
  return !explicitlyColdAnchor;
}

function hasAnyCue(text: string, cues: RegExp): boolean {
  return cues.test(normalizeStyleToken(text));
}

function violatesFormalPolicy(candidateFamily: string, candidateText: string): boolean {
  const sportCue = /\b(track|tracksuit|jogger|jogging|gym|running|training|athletic|basketball|football|sport)\b/;
  const beachCue = /\b(swim|bikini|flip flop|slide sandal|beach short|tank top)\b/;
  const loudCasualCue = /\b(ripped|distressed|cargo short|graphic tee|hoodie)\b/;

  if (candidateFamily === "shoes") {
    const formalShoes = /\b(heel|pump|stiletto|loafer|oxford|derby|ankle boot|boot|flat|mule)\b/;
    if (!hasAnyCue(candidateText, formalShoes)) return true;
  }
  if (candidateFamily === "bags") {
    const formalBags = /\b(clutch|satchel|top handle|structured|mini bag|shoulder bag|crossbody)\b/;
    if (!hasAnyCue(candidateText, formalBags)) return true;
  }
  if (candidateFamily === "bottoms") {
    const formalBottoms = /\b(trouser|tailored|pleat|slack|straight pant|wide leg pant|midi skirt|pencil skirt)\b/;
    if (!hasAnyCue(candidateText, formalBottoms) && hasAnyCue(candidateText, loudCasualCue)) return true;
  }
  if (hasAnyCue(candidateText, sportCue) || hasAnyCue(candidateText, beachCue)) return true;
  return false;
}

function violatesSportPolicy(candidateFamily: string, candidateText: string): boolean {
  const formalCue = /\b(stiletto|pump|oxford|evening|cocktail|gown|tailored blazer|clutch|strapless|sequin|sequined|metallic|corset|bodycon|party top|cami dress)\b/;
  const athleticCue = /\b(sneaker|trainer|running|track|jogger|legging|sports bra|active|gym|sport|hoodie|tee|tank|backpack|duffle)\b/;

  if (candidateFamily === "shoes" && !hasAnyCue(candidateText, /\b(sneaker|trainer|running|training|sport shoe)\b/)) {
    return true;
  }
  if (candidateFamily === "bags" && !hasAnyCue(candidateText, /\b(backpack|duffle|crossbody|belt bag|gym bag)\b/)) {
    return true;
  }
  if ((candidateFamily === "tops" || candidateFamily === "bottoms") && !hasAnyCue(candidateText, athleticCue) && hasAnyCue(candidateText, formalCue)) {
    return true;
  }
  if (hasAnyCue(candidateText, formalCue) && !hasAnyCue(candidateText, athleticCue)) return true;
  return false;
}

function calibrateSourceStyleFromAnchor(
  sourceProduct: { title?: string | null; category?: string | null; description?: string | null; color?: string | null },
  detectedCategory: ProductCategory,
  sourceStyle: StyleProfile,
): StyleProfile {
  const text = `${String(sourceProduct.title || "")} ${String(sourceProduct.category || "")} ${String(sourceProduct.description || "")}`.toLowerCase();
  const sportCue = /\b(track|tracksuit|track pant|track pants|jogger|joggers|jogging|sweatpant|sweatpants|athletic|activewear|sportswear|gym|training|running|workout|fleece jogg|legging|leggings|sports legging|technical shorts?|quick-drying|spandex)\b/;
  const formalBottomCue = /\b(tailored|trouser|trousers|slacks|dress pant|office pant|formal pant|pleated)\b/;
  const partyCue = /\b(sequin|metallic|party|cocktail|strapless|corset|bodycon|evening)\b/;
  const coolWeatherCue = /\b(sweater|cardigan|hoodie|sweatshirt|knit|knitted|wool|cashmere|fleece|thermal|long sleeve|long-sleeve|heavyweight)\b/;
  const warmWeatherCue = /\b(tank|sleeveless|short sleeve|short-sleeve|linen|swim|bikini|beach|resort|cropped cami)\b/;
  const outerwearCue = /\b(jacket|windbreaker|coat|parka|blazer|outerwear|bomber|anorak)\b/;
  const lightweightOuterwearCue = /\b(windbreaker|lightweight jacket|rain jacket|shell jacket)\b/;
  const longSleeveTopCue = /\b(long sleeve|long-sleeve|long sleeves|crew neck|crew-neck)\b/;
  const heavyFabricCue = /\b(wool|fleece|thermal|heavyweight|knit|cashmere)\b/;

  let occasion = sourceStyle.occasion;
  let aesthetic = sourceStyle.aesthetic;
  let formality = sourceStyle.formality;
  let season = sourceStyle.season;

  if (sportCue.test(text) || detectedCategory === "activewear" || detectedCategory === "sportswear") {
    occasion = "active";
    aesthetic = "sporty";
    formality = Math.min(formality, 2);
  }

  if (detectedCategory === "pants") {
    if (sportCue.test(text)) {
      occasion = "active";
      aesthetic = "sporty";
      formality = Math.min(formality, 2);
    } else if (formalBottomCue.test(text)) {
      occasion = "semi-formal";
      aesthetic = sourceStyle.aesthetic === "sporty" ? "classic" : sourceStyle.aesthetic;
      formality = Math.max(formality, 5.5);
    } else {
      // Default pants without explicit formal cues should lean casual.
      occasion = sourceStyle.occasion === "semi-formal" ? "casual" : sourceStyle.occasion;
      formality = sourceStyle.occasion === "semi-formal" ? Math.min(formality, 4) : formality;
    }
  }

  if (partyCue.test(text) && !sportCue.test(text)) {
    occasion = "party";
    formality = Math.max(formality, 5);
  }

  // Weather sanity calibration for anchor garment: heavy knit/long-sleeve tops should not resolve to summer.
  if (coolWeatherCue.test(text) && !warmWeatherCue.test(text)) {
    if (season === "summer") season = "fall";
    if (season === "spring") season = "fall";
  } else if (warmWeatherCue.test(text) && !coolWeatherCue.test(text)) {
    if (season === "winter") season = "summer";
  }

  // Long-sleeve tops are rarely true summer defaults unless explicitly warm-weather oriented.
  if (detectedCategory === "top" || detectedCategory === "tshirt" || detectedCategory === "sweatshirt") {
    if (longSleeveTopCue.test(text) && !warmWeatherCue.test(text)) {
      if (season === "summer" || season === "all-season" || season === "spring") {
        season = heavyFabricCue.test(text) ? "winter" : "fall";
      }
    }
  }

  // Outerwear should not default to all-season in most cases.
  if (outerwearCue.test(text) || detectedCategory === "jacket") {
    if (season === "all-season") {
      season = lightweightOuterwearCue.test(text) ? "fall" : "winter";
    } else if (season === "spring" && !lightweightOuterwearCue.test(text)) {
      season = "fall";
    }
  }

  return {
    ...sourceStyle,
    occasion,
    aesthetic,
    season,
    formality,
  };
}

function violatesCasualPolicy(candidateFamily: string, candidateText: string): boolean {
  const ultraFormalCue = /\b(gown|black tie|evening gown|stiletto|ceremony|cocktail dress)\b/;
  const beachOnlyCue = /\b(swim|bikini|beachwear|flip flop)\b/;

  if (candidateFamily === "shoes") {
    if (hasAnyCue(candidateText, /\b(stiletto)\b/)) return true;
  }
  if (hasAnyCue(candidateText, ultraFormalCue)) return true;
  if (hasAnyCue(candidateText, beachOnlyCue)) return true;
  return false;
}

function violatesOccasionPolicy(
  sourceOccasion: StyleProfile["occasion"],
  candidateFamily: string,
  candidateTitle?: string | null,
  candidateCategory?: string | null
): boolean {
  const candidateText = `${String(candidateTitle || "")} ${String(candidateCategory || "")}`;
  if (sourceOccasion === "formal" || sourceOccasion === "semi-formal" || sourceOccasion === "party") {
    return violatesFormalPolicy(candidateFamily, candidateText);
  }
  if (sourceOccasion === "active") {
    return violatesSportPolicy(candidateFamily, candidateText);
  }
  if (sourceOccasion === "casual") {
    return violatesCasualPolicy(candidateFamily, candidateText);
  }
  return false;
}

function isVividColorBucketSet(bucketSet: Set<string>): boolean {
  for (const bucket of bucketSet) {
    if (["red", "pink", "purple", "yellow", "orange"].includes(bucket)) return true;
  }
  return false;
}

function shouldHardRejectFashionCandidate(params: {
  sourceFamily: string;
  candidateFamily: string;
  sourceStyle: StyleProfile;
  sourceProduct: CompleteLookMappedSourceProduct;
  candidateProduct: Product;
  colorScore: number;
  patternHeavyPair: boolean;
  candidateColorBuckets: Set<string>;
  footwearOccasionScore: number;
  bagOccasionScore: number;
  garmentOccasionScore: number;
}): boolean {
  const {
    sourceFamily,
    candidateFamily,
    sourceStyle,
    sourceProduct,
    candidateProduct,
    colorScore,
    patternHeavyPair,
    candidateColorBuckets,
    footwearOccasionScore,
    bagOccasionScore,
    garmentOccasionScore,
  } = params;
  const candidateText = `${String(candidateProduct.title || "")} ${String(candidateProduct.category || "")}`;
  const sneakerCue = /\b(sneaker|sneakers|trainer|trainers|running shoe|tennis shoe|tennis shoes|sportswear shoes?|athletic shoes?)\b/;
  const shoeCue = /\b(shoe|shoes|sneaker|trainer|boot|heel|pump|sandal|loafer|flat|oxford)\b/;

  // Defensive hard gate: for party/formal contexts, never allow sneaker-like footwear
  // even if candidate family detection is imperfect.
  if (
    (sourceStyle.occasion === "party" || sourceStyle.occasion === "formal" || sourceStyle.occasion === "semi-formal") &&
    sneakerCue.test(normalizeStyleToken(candidateText)) &&
    (candidateFamily === "shoes" || shoeCue.test(normalizeStyleToken(candidateText)))
  ) {
    return true;
  }

  if (candidateFamily === "shoes") {
    const shoeAssessment = assessShoeCandidate({
      sourceStyle,
      sourceFamily,
      candidateTitle: candidateProduct.title,
      candidateCategory: candidateProduct.category,
      candidateDescription: candidateProduct.description,
    });
    if (shoeAssessment.isNoise || shoeAssessment.pipelineScore < 0.5) return true;
    // Dress anchors should prioritize feminine shoe silhouettes.
    if (sourceFamily === "dress" && !isFeminineShoeCue(candidateText)) {
      return true;
    }
    // Shoes must respect seasonal weather cues.
    if (!isWeatherSuitableShoeForSeason(sourceStyle.season, candidateText)) {
      return true;
    }
  }

  if (candidateFamily === "shoes" && footwearOccasionScore < minimumOccasionCompatibilityForFamily(sourceStyle.occasion, candidateFamily)) return true;
  if (candidateFamily === "bags" && bagOccasionScore < minimumOccasionCompatibilityForFamily(sourceStyle.occasion, candidateFamily)) return true;
  if (candidateFamily === "bags" && !isStrictBagProduct(candidateProduct.title, candidateProduct.category, candidateProduct.description)) return true;
  if (candidateFamily === "tops") {
    const topAssessment = assessTopCandidate({
      sourceStyle,
      candidateTitle: candidateProduct.title,
      candidateCategory: candidateProduct.category,
      candidateDescription: candidateProduct.description,
    });
    if (topAssessment.isNoise || topAssessment.pipelineScore < 0.48) return true;
  }
  if (candidateFamily === "bags") {
    const bagAssessment = assessBagCandidate(`${candidateProduct.title || ""} ${candidateProduct.category || ""} ${candidateProduct.description || ""}`);
    if (bagAssessment.pipelineScore < 0.58) return true;
  }
  if (
    candidateFamily === "bottoms" &&
    (sourceStyle.aesthetic === "classic" || sourceStyle.aesthetic === "minimalist") &&
    sourceStyle.formality >= 3 &&
    isSportBottomCue(`${candidateProduct.title || ""} ${candidateProduct.category || ""}`)
  ) {
    return true;
  }
  if (
    sourceFamily === "bottoms" &&
    isSportAnchorProduct(sourceProduct) &&
    candidateFamily === "tops"
  ) {
    const topText = `${candidateProduct.title || ""} ${candidateProduct.category || ""}`;
    const sportyTopCue = /\b(t-?shirt|tee|tank|sports bra|hoodie|sweatshirt|active|athletic|running|training|gym)\b/;
    const nonSportTopCue = /\b(strapless|corset|blouse|dress shirt|formal shirt|sequin|party top|silk top)\b/;
    if (nonSportTopCue.test(normalizeStyleToken(topText))) return true;
    if (!sportyTopCue.test(normalizeStyleToken(topText))) return true;
  }
  if (
    sourceFamily === "bottoms" &&
    isSportAnchorProduct(sourceProduct) &&
    candidateFamily === "accessories"
  ) {
    const accText = `${candidateProduct.title || ""} ${candidateProduct.category || ""}`;
    const allowedActiveAccessoryCue = /\b(cap|beanie|headband|sport watch|fitness watch|sunglasses|wristband)\b/;
    const blockedAccessoryCue = /\b(belt|necklace|bracelet|earring|ring|pearl|clutch chain)\b/;
    if (blockedAccessoryCue.test(normalizeStyleToken(accText))) return true;
    if (!allowedActiveAccessoryCue.test(normalizeStyleToken(accText))) return true;
  }
  if (
    candidateFamily === "accessories" &&
    shouldRejectAccessoryForSourceWeather(
      sourceProduct,
      sourceStyle,
      candidateProduct.title,
      candidateProduct.category,
      candidateProduct.description,
    )
  ) {
    return true;
  }
  if (
    candidateFamily === "bottoms" &&
    isSkirtBottomCue(`${candidateProduct.title || ""} ${candidateProduct.category || ""}`) &&
    isCozyTopAnchor(sourceProduct) &&
    sourceStyle.occasion !== "party" &&
    sourceStyle.occasion !== "formal" &&
    sourceStyle.occasion !== "semi-formal" &&
    sourceStyle.season !== "summer"
  ) {
    return true;
  }
  if ((candidateFamily === "tops" || candidateFamily === "bottoms" || candidateFamily === "outerwear" || candidateFamily === "accessories") && garmentOccasionScore < minimumOccasionCompatibilityForFamily(sourceStyle.occasion, candidateFamily)) return true;
  if (violatesOccasionPolicy(sourceStyle.occasion, candidateFamily, candidateProduct.title, candidateProduct.category)) return true;

  // Prevent strong chromatic clashes on core garment recommendations.
  if ((candidateFamily === "tops" || candidateFamily === "bottoms" || candidateFamily === "dress" || candidateFamily === "outerwear") && colorScore < 0.2) {
    return true;
  }

  // If source is top/outerwear, keep bottoms mostly neutral unless compatibility is strong.
  if ((sourceFamily === "tops" || sourceFamily === "outerwear") && candidateFamily === "bottoms" && colorScore < 0.42 && isVividColorBucketSet(candidateColorBuckets)) {
    return true;
  }

  // Pattern-heavy pairings on core garments are usually noisy in catalog data.
  if (patternHeavyPair && (candidateFamily === "tops" || candidateFamily === "bottoms" || candidateFamily === "outerwear" || candidateFamily === "dress")) {
    return true;
  }

  // Winter anchors should not receive summer-only pieces.
  if (isWinterAnchorProduct(sourceProduct, sourceStyle) && isWarmSeasonItem(candidateProduct.title, candidateProduct.category)) {
    return true;
  }

  return false;
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

const FASHION_COLOR_LEXICON = [
  "black", "white", "off white", "off-white", "cream", "ivory", "beige", "brown", "camel", "tan",
  "gray", "grey", "charcoal", "silver", "navy", "blue", "light blue", "light-blue", "green", "olive",
  "red", "burgundy", "pink", "purple", "yellow", "orange", "gold", "teal", "multicolor", "multi color",
];

const CORE_GARMENT_FAMILIES = new Set(["tops", "bottoms", "dress", "outerwear"]);
const NEUTRAL_COLOR_BUCKETS = new Set(["black", "white", "gray", "brown"]);

const COLOR_BUCKET_COMPATIBILITY: Record<string, string[]> = {
  blue: ["earth", "red", "green"],
  green: ["earth", "blue"],
  red: ["blue", "earth", "green"],
  pink: ["green", "blue", "earth"],
  purple: ["blue", "pink", "earth"],
  yellow: ["blue", "earth"],
  orange: ["blue", "earth"],
  brown: ["blue", "green", "red"],
};

function normalizeFashionColorAlias(value: string): string {
  return value
    .replace(/\bbordo\b/g, " burgundy ")
    .replace(/\bbordeaux\b/g, " burgundy ")
    .replace(/\bwine\b/g, " burgundy ")
    .replace(/\bmaroon\b/g, " burgundy ")
    .replace(/\boxblood\b/g, " burgundy ")
    .replace(/\bgrey\b/g, " gray ");
}

function extractColorBucketsFromText(value?: string | null): Set<string> {
  const out = new Set<string>();
  const raw = normalizeFashionColorAlias(String(value || "").toLowerCase());
  if (!raw) return out;

  const normalized = raw
    .replace(/[()\[\],]/g, " ")
    .replace(/[|/\\;+]/g, " ")
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return out;

  const phrases: string[] = [];
  for (const phrase of FASHION_COLOR_LEXICON) {
    if (normalized.includes(phrase)) phrases.push(phrase);
  }

  const tokens = normalized.split(" ").filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    phrases.push(tokens[i]);
    if (i + 1 < tokens.length) phrases.push(`${tokens[i]} ${tokens[i + 1]}`);
  }

  for (const phrase of phrases) {
    const bucket = coarseColorBucket(phrase);
    if (bucket) out.add(bucket);
  }

  return out;
}

function isCoreGarmentFamily(family: string): boolean {
  return CORE_GARMENT_FAMILIES.has(String(family || "").toLowerCase());
}

function hasChromaticColor(bucketSet: Set<string>): boolean {
  if (bucketSet.size === 0) return false;
  for (const b of bucketSet) {
    if (!NEUTRAL_COLOR_BUCKETS.has(b)) return true;
  }
  return false;
}

function scoreColorCompatibilityByBuckets(
  sourceBuckets: Set<string>,
  candidateBuckets: Set<string>,
  candidateFamily: string,
): number {
  const sourceHasColor = sourceBuckets.size > 0;
  const candidateHasColor = candidateBuckets.size > 0;
  const coreFamily = isCoreGarmentFamily(candidateFamily);

  if (!sourceHasColor && !candidateHasColor) return 0.6;
  if (!candidateHasColor) return coreFamily ? 0.46 : 0.54;

  // Neutral candidates are generally safe anchors.
  for (const c of candidateBuckets) {
    if (NEUTRAL_COLOR_BUCKETS.has(c)) return 0.82;
  }
  if (!sourceHasColor) return 0.7;

  for (const c of candidateBuckets) {
    if (sourceBuckets.has(c)) return 0.88;
  }

  for (const s of sourceBuckets) {
    const comp = COLOR_BUCKET_COMPATIBILITY[s] || [];
    for (const c of candidateBuckets) {
      if (comp.includes(c)) return coreFamily ? 0.68 : 0.72;
    }
  }

  // Chromatic mismatch should be strongly discouraged for core garments.
  return coreFamily ? 0.18 : 0.34;
}

function scoreCategoryCompatibility(sourceFamily: string, candidateFamily: string): number {
  if (!sourceFamily || !candidateFamily) return 0.5;
  if (sourceFamily === candidateFamily) return sourceFamily === "accessories" ? 0.82 : 0.92;
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
  const isSneakerLike = /\b(sneaker|sneakers|trainer|trainers|running shoe|canvas shoe|basketball shoe|tennis shoe|tennis shoes|sportswear shoes?|athletic shoes?)\b/.test(text);
  const isDressyFootwear = /\b(heel|heels|pump|pumps|stiletto|stilettos|dress sandal|dress sandals|mule|mules|loafer|loafers|oxford|oxfords)\b/.test(text);
  const isBootLike = /\b(boot|boots|ankle boot|ankle boots)\b/.test(text);
  const isCasualFlat = /\b(flat|flats|ballet flat|ballet flats|espadrille|espadrilles|slip-?on)\b/.test(text);
  const isBeachFootwear = /\b(sandal|sandals|slides?|flip flop|flip-flop)\b/.test(text);

  if (sourceOccasion === "party") {
    if (isSneakerLike) return 0.12;
    if (isDressyFootwear) return 0.98;
    if (isBootLike) return 0.72;
    if (isCasualFlat) return 0.42;
    if (isBeachFootwear) return 0.25;
    return 0.48;
  }

  if (sourceOccasion === "formal" || sourceOccasion === "semi-formal") {
    if (isSneakerLike) return 0.18;
    if (isDressyFootwear) return 0.96;
    if (isBootLike) return 0.78;
    if (isCasualFlat) return 0.5;
    if (isBeachFootwear) return 0.2;
    return 0.5;
  }

  if (sourceOccasion === "casual") {
    if (isSneakerLike) return 0.96;
    if (isDressyFootwear) return 0.66;
    if (isBootLike || isCasualFlat) return 0.84;
    if (isBeachFootwear) return 0.7;
    return 0.74;
  }

  if (sourceOccasion === "active") {
    if (isSneakerLike) return 0.98;
    if (isCasualFlat) return 0.52;
    if (isDressyFootwear || isBootLike) return 0.22;
    if (isBeachFootwear) return 0.42;
    return 0.5;
  }

  if (sourceOccasion === "beach") {
    if (/\b(sandal|sandals|slides?|flip flop|espadrille)\b/.test(text)) return 0.95;
    if (isSneakerLike) return 0.74;
    if (isDressyFootwear || isBootLike) return 0.3;
    if (isCasualFlat) return 0.66;
    return 0.56;
  }

  return 0.72;
}

function scoreBagOccasionCompatibility(
  sourceOccasion: StyleProfile["occasion"],
  candidateTitle: string,
  candidateCategory?: string | null
): number {
  const text = `${String(candidateTitle || "")} ${String(candidateCategory || "")}`.toLowerCase();
  const bagAssessment = assessBagCandidate(text);
  const isFormalBag = /\b(clutch|evening bag|mini bag|top handle|satchel)\b/.test(text);
  const isCasualBag = /\b(tote|crossbody|backpack|hobo|messenger|shoulder bag)\b/.test(text);
  const isSportBag = /\b(backpack|duffle|duffel|gym bag|belt bag|sling bag)\b/.test(text);
  const isBeachBag = /\b(straw|woven|raffia|canvas tote|beach bag)\b/.test(text);
  const isTravelBag = /\b(duffle|luggage|suitcase|travel)\b/.test(text);

  if (!bagAssessment.isBagCandidate || bagAssessment.isAccessoryNoise) return 0.16;

  if (isTravelBag) return 0.2;

  if (sourceOccasion === "party") {
    if (isFormalBag) return 0.96;
    if (/\b(crossbody|shoulder bag|hobo)\b/.test(text)) return 0.72;
    if (/\b(tote)\b/.test(text)) return 0.62;
    if (/\b(backpack|messenger)\b/.test(text)) return 0.42;
    if (isSportBag) return 0.2;
    if (isBeachBag) return 0.24;
    return 0.64;
  }

  if (sourceOccasion === "formal" || sourceOccasion === "semi-formal") {
    if (isFormalBag) return 0.95;
    if (isCasualBag) return 0.4;
    if (isSportBag) return 0.22;
    if (isBeachBag) return 0.28;
    return 0.58;
  }

  if (sourceOccasion === "casual") {
    if (isCasualBag) return 0.92;
    if (isFormalBag) return 0.64;
    if (isSportBag) return 0.84;
    if (isBeachBag) return 0.82;
    return 0.74;
  }

  if (sourceOccasion === "active") {
    if (isSportBag) return 0.96;
    if (isCasualBag) return 0.72;
    if (isFormalBag) return 0.24;
    if (isBeachBag) return 0.56;
    return 0.54;
  }

  if (sourceOccasion === "beach") {
    if (/\b(tote|straw|woven|canvas|crossbody)\b/.test(text)) return 0.92;
    if (isFormalBag) return 0.42;
    if (isSportBag) return 0.64;
    return 0.72;
  }

  return 0.72;
}

function minimumOccasionCompatibilityForFamily(
  sourceOccasion: StyleProfile["occasion"],
  candidateFamily: string
): number {
  if (candidateFamily === "shoes") {
    if (sourceOccasion === "party") return 0.72;
    if (sourceOccasion === "formal" || sourceOccasion === "semi-formal") return 0.68;
    if (sourceOccasion === "active") return 0.72;
    if (sourceOccasion === "beach") return 0.64;
    return 0.4;
  }
  if (candidateFamily === "bags") {
    if (sourceOccasion === "party") return 0.52;
    if (sourceOccasion === "formal" || sourceOccasion === "semi-formal") return 0.6;
    if (sourceOccasion === "active") return 0.58;
    if (sourceOccasion === "beach") return 0.58;
    return 0.38;
  }
  if (candidateFamily === "tops" || candidateFamily === "bottoms" || candidateFamily === "outerwear" || candidateFamily === "accessories") {
    if (sourceOccasion === "party") return 0.6;
    if (sourceOccasion === "formal" || sourceOccasion === "semi-formal") return 0.58;
    if (sourceOccasion === "active") return 0.62;
    if (sourceOccasion === "beach") return 0.56;
    return 0.34;
  }
  return 0.3;
}

function scoreOccasionGarmentCompatibility(
  sourceOccasion: StyleProfile["occasion"],
  candidateFamily: string,
  candidateTitle: string,
  candidateCategory?: string | null
): number {
  const text = `${String(candidateTitle || "")} ${String(candidateCategory || "")}`.toLowerCase();
  const isBottomFormal = /\b(dress pant|dress pants|trouser|trousers|slacks|tailored pant)\b/.test(text);
  const isBottomCasual = /\b(short|shorts|jogger|joggers|cargo|linen short|swim short)\b/.test(text);
  const isTopFormal = /\b(dress shirt|oxford shirt|blazer|tailored|formal shirt)\b/.test(text);
  const isTopCasual = /\b(t-?shirt|tee|tank|polo|linen shirt|hawaiian|resort shirt)\b/.test(text);
  const isAccessoryFormal = /\b(watch|pearl|gold|silver|leather belt|silk scarf|fine jewelry|necklace|bracelet|ring|earring)\b/.test(text);
  const isAccessoryCasual = /\b(cap|beanie|canvas belt|woven belt|sport watch|sunglasses|bucket hat)\b/.test(text);
  const isAccessoryNoise = /\b(key ?ring|keychain|phone case|hair accessory|scrunchie|headband|travel accessories?|toiletry kit|rfid waist belt|passport holder|luggage tag)\b/.test(text);

  if (candidateFamily === "accessories") {
    if (isAccessoryNoise) return 0.38;
    if (sourceOccasion === "active") {
      if (/\b(sport watch|fitness watch|cap|beanie|sunglasses|headband|wristband)\b/.test(text)) return 0.92;
      if (isAccessoryFormal) return 0.3;
      return 0.68;
    }
    if (sourceOccasion === "beach") {
      if (/\b(straw|woven|raffia|sunglasses|cap|hat|scarf)\b/.test(text)) return 0.9;
      if (isAccessoryFormal) return 0.52;
      return 0.72;
    }
    if (sourceOccasion === "party") {
      if (/\b(clutch chain|statement earring|statement earrings|choker|party jewelry|cocktail ring|glitter|metallic)\b/.test(text)) return 0.94;
      if (isAccessoryFormal) return 0.9;
      if (isAccessoryCasual) return 0.52;
      return 0.7;
    }
    if (sourceOccasion === "formal" || sourceOccasion === "semi-formal") {
      if (isAccessoryFormal) return 0.92;
      if (isAccessoryCasual) return 0.62;
      return 0.74;
    }
    if (sourceOccasion === "casual") {
      if (isAccessoryCasual) return 0.9;
      if (isAccessoryFormal) return 0.7;
      return 0.76;
    }
    return 0.74;
  }

  if (sourceOccasion === "beach") {
    if (candidateFamily === "bottoms") {
      if (isBottomCasual) return 0.95;
      if (isBottomFormal) return 0.24;
      return 0.68;
    }
    if (candidateFamily === "tops") {
      if (isTopCasual) return 0.92;
      if (isTopFormal) return 0.28;
      return 0.7;
    }
    if (candidateFamily === "outerwear") return 0.36;
    return 0.78;
  }

  if (sourceOccasion === "formal" || sourceOccasion === "semi-formal") {
    if (candidateFamily === "bottoms") {
      if (isBottomFormal) return 0.95;
      if (isBottomCasual) return 0.38;
    }
    if (candidateFamily === "tops") {
      if (isTopFormal) return 0.94;
      if (isTopCasual) return 0.54;
    }
  }

  if (sourceOccasion === "casual") {
    if (candidateFamily === "bottoms" && isBottomCasual) return 0.9;
    if (candidateFamily === "tops" && isTopCasual) return 0.9;
  }

  return 0.74;
}

function scoreAestheticGarmentCompatibility(
  sourceStyle: StyleProfile,
  candidateFamily: string,
  candidateTitle: string,
  candidateCategory?: string | null
): number {
  const text = `${String(candidateTitle || "")} ${String(candidateCategory || "")}`.toLowerCase();
  const sportyCue = /\b(track|tracksuit|jogger|legging|gym|running|training|athletic|sport|sports|basketball|football)\b/;
  const tailoredCue = /\b(tailored|trouser|pleat|straight|wide leg|loafer|oxford|satchel|structured|coat|wool|knit)\b/;
  const ruggedCue = /\b(combat|distressed|ripped|cargo)\b/;

  if (sourceStyle.occasion === "active") return 0.86;

  if (sourceStyle.aesthetic === "classic" || sourceStyle.aesthetic === "minimalist") {
    if (sportyCue.test(text) && (candidateFamily === "bottoms" || candidateFamily === "shoes")) return 0.34;
    if (ruggedCue.test(text)) return 0.44;
    if (tailoredCue.test(text)) return 0.94;
    return 0.76;
  }

  if (sourceStyle.aesthetic === "sporty") {
    if (sportyCue.test(text)) return 0.95;
    if (tailoredCue.test(text) && candidateFamily !== "bags") return 0.56;
    return 0.74;
  }

  if (sourceStyle.aesthetic === "edgy") {
    if (ruggedCue.test(text)) return 0.9;
    if (tailoredCue.test(text)) return 0.68;
    return 0.76;
  }

  return 0.78;
}

function scoreWeatherCompatibility(
  sourceSeason: StyleProfile["season"],
  candidateTitle: string,
  candidateCategory?: string | null
): number {
  const text = `${String(candidateTitle || "")} ${String(candidateCategory || "")}`.toLowerCase();
  const warmCue = /\b(wool|knit|knitted|cashmere|fleece|thermal|boot|boots|coat|jacket|cardigan|sweater)\b/;
  const coolCue = /\b(linen|sleeveless|tank|short|shorts|mini|sandal|flip flop|slide|mesh)\b/;
  const allSeasonCue = /\b(cotton|denim|tee|t-?shirt|shirt|blouse|trouser|jean|loafer|sneaker)\b/;

  if (sourceSeason === "all-season") return allSeasonCue.test(text) ? 0.9 : 0.76;
  if (sourceSeason === "winter") {
    if (warmCue.test(text)) return 0.96;
    if (coolCue.test(text)) return 0.34;
    return 0.72;
  }
  if (sourceSeason === "summer") {
    if (coolCue.test(text)) return 0.95;
    if (warmCue.test(text)) return 0.44;
    return 0.74;
  }
  if (sourceSeason === "fall") {
    if (warmCue.test(text)) return 0.88;
    if (coolCue.test(text)) return 0.6;
    return 0.76;
  }
  if (sourceSeason === "spring") {
    if (coolCue.test(text)) return 0.84;
    if (warmCue.test(text)) return 0.66;
    return 0.78;
  }
  return 0.74;
}

function buildFashionReasons(params: {
  categoryScore: number;
  colorScore: number;
  aestheticScore: number;
  formalityScore: number;
  seasonScore: number;
  weatherScore: number;
  aestheticGarmentScore: number;
  occasionGarmentScore: number;
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
  if (params.weatherScore >= 0.84) reasons.push("weather-appropriate fabric/weight");
  if (params.aestheticGarmentScore >= 0.84) reasons.push("silhouette fits the aesthetic");
  if (params.occasionGarmentScore >= 0.86) reasons.push("occasion-appropriate item type");
  if (params.patternScore >= 0.8) reasons.push("pattern balance");
  if (params.materialScore >= 0.8) reasons.push("material-compatible");
  if (params.priceScore >= 0.82) reasons.push("price-tier aligned");
  if (reasons.length === 0) reasons.push("fashion-balanced match");
  return reasons.slice(0, 4);
}

function colorComfortHintForCategory(
  sourceStyle: StyleProfile,
  category: string,
  sourceProduct?: { color?: string | null; title?: string | null; category?: string | null; description?: string | null },
): string {
  const titleForBucket = (bucket: string): string => {
    switch (bucket) {
      case "blue": return "blue";
      case "green": return "green";
      case "red": return "red";
      case "pink": return "pink";
      case "purple": return "purple";
      case "yellow": return "yellow";
      case "orange": return "orange";
      case "brown": return "brown";
      case "black": return "black";
      case "white": return "white";
      case "gray": return "gray";
      default: return bucket;
    }
  };

  const sourceBuckets = new Set<string>();
  for (const b of extractColorBucketsFromText(sourceProduct?.color)) sourceBuckets.add(b);
  for (const b of extractColorBucketsFromText(sourceProduct?.title)) sourceBuckets.add(b);
  for (const b of extractColorBucketsFromText(sourceProduct?.category)) sourceBuckets.add(b);
  for (const b of extractColorBucketsFromText(sourceProduct?.description)) sourceBuckets.add(b);
  for (const b of extractColorBucketsFromText(sourceStyle.colorProfile.primary)) sourceBuckets.add(b);
  for (const harmony of sourceStyle.colorProfile.harmonies || []) {
    for (const c of harmony.colors || []) {
      for (const b of extractColorBucketsFromText(c)) sourceBuckets.add(b);
    }
  }

  const neutralOrder = ["black", "white", "gray", "brown"];
  const neutrals = neutralOrder.filter((n) => sourceBuckets.has(n));
  const chromatic = Array.from(sourceBuckets).filter((b) => !neutralOrder.includes(b));
  const primaryBucket =
    extractColorBucketsFromText(sourceStyle.colorProfile.primary).values().next().value ||
    chromatic[0];

  const formattedPrimary = primaryBucket ? titleForBucket(primaryBucket) : "this palette";

  const pickPalette = (target: string): string[] => {
    const safeNeutrals = neutrals.length > 0 ? neutrals : ["black", "white", "gray", "brown"];
    const compatibleChromatic =
      primaryBucket && COLOR_BUCKET_COMPATIBILITY[primaryBucket]
        ? COLOR_BUCKET_COMPATIBILITY[primaryBucket]
        : [];
    const harmonyChromatic = chromatic.filter((c) => c !== primaryBucket);
    const accentPool = Array.from(new Set([...harmonyChromatic, ...compatibleChromatic])).slice(0, 2);

    if (target === "Bottoms") {
      return [...safeNeutrals.slice(0, 3), ...accentPool.slice(0, 1)];
    }
    if (target === "Shoes" || target === "Bags") {
      return [...safeNeutrals.slice(0, 4), ...accentPool.slice(0, 1)];
    }
    if (target === "Tops") {
      return [...safeNeutrals.slice(0, 2), formattedPrimary, ...accentPool.slice(0, 1)];
    }
    return [...safeNeutrals.slice(0, 3), ...accentPool.slice(0, 1)];
  };

  const colors = pickPalette(category)
    .map((c) => titleForBucket(c))
    .filter(Boolean)
    .slice(0, 4);

  const joined = colors.join(", ");
  if (category === "Bottoms") return `Comfortable bottoms colors with ${formattedPrimary}: ${joined}.`;
  if (category === "Shoes") return `Comfortable shoe colors with ${formattedPrimary}: ${joined}.`;
  if (category === "Bags") return `Comfortable bag colors with ${formattedPrimary}: ${joined}.`;
  if (category === "Tops") return `Comfortable top colors with ${formattedPrimary}: ${joined}.`;
  return `Comfortable colors with ${formattedPrimary}: ${joined}.`;
}

async function rerankCompleteStyleSuggestions(params: FashionRerankContext): Promise<CompleteLookMappedSuggestion[]> {
  if (!params.suggestions.length) return [];

  const topSuggestions = [...params.suggestions]
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(params.maxSuggestions, 20));

  const candidateIds = Array.from(new Set(topSuggestions.map((s) => s.product_id))).slice(0, 80);
  const candidateRows = await pg.query<CandidateStyleRow>(
    `SELECT id, title, brand, category, color, price_cents, currency, image_url, image_cdn, description, gender
     FROM products
     WHERE id = ANY($1)`,
    [candidateIds]
  );

  const rowById = new Map<number, CandidateStyleRow>();
  for (const row of candidateRows.rows) {
    rowById.set(row.id, row);
  }

  const sourceColorBuckets = new Set<string>();
  for (const b of extractColorBucketsFromText(params.sourceProduct.color)) sourceColorBuckets.add(b);
  for (const b of extractColorBucketsFromText(params.sourceStyle.colorProfile.primary)) sourceColorBuckets.add(b);
  for (const h of params.sourceStyle.colorProfile.harmonies || []) {
    for (const c of h.colors || []) {
      for (const b of extractColorBucketsFromText(c)) sourceColorBuckets.add(b);
    }
  }
  const sourceHasChromaticColor = hasChromaticColor(sourceColorBuckets);
  const sourceAudienceText = [
    params.sourceProduct.title,
    params.sourceProduct.category,
    params.sourceProduct.description,
    params.sourceAudienceGenderHint,
    params.sourceAgeGroupHint,
  ]
    .filter(Boolean)
    .join(" ");
  const sourceAge: "adult" | "kids" | "unknown" =
    params.sourceAgeGroupHint === "adult" || params.sourceAgeGroupHint === "kids"
      ? params.sourceAgeGroupHint
      : inferAgeSegmentFromText(sourceAudienceText);
  const sourceGender: "men" | "women" | "unisex" | "unknown" =
    params.sourceAudienceGenderHint === "men" ||
    params.sourceAudienceGenderHint === "women" ||
    params.sourceAudienceGenderHint === "unisex"
      ? params.sourceAudienceGenderHint
      : inferGenderSegmentFromText(sourceAudienceText);

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
      gender: row.gender ?? undefined,
    };

    const candidateAudienceText = [
      candidateProduct.title,
      candidateProduct.category,
      candidateProduct.description,
      candidateProduct.gender,
    ]
      .filter(Boolean)
      .join(" ");
    const candidateAge = inferAgeSegmentFromText(candidateAudienceText);
    const candidateGender = inferGenderSegmentFromText(candidateAudienceText);
    if (
      shouldRejectByDemographicRestrictions({
        sourceAge,
        sourceGender,
        candidateAge,
        candidateGender,
      })
    ) {
      return null;
    }

    const candidateCategory = await detectCategory(candidateProduct.title, candidateProduct.description);
    const candidateStyle = await buildStyleProfile(candidateProduct);

    const sourceFamily = categoryFamily(params.sourceCategory);
    const detectedFamily = categoryFamily(candidateCategory.category);
    const rawFamily = categoryFamily(`${candidateProduct.category || ""} ${candidateProduct.title || ""}`);
    const candidateFamily = detectedFamily !== "unknown" ? detectedFamily : rawFamily;
    const categoryScore = scoreCategoryCompatibility(sourceFamily, candidateFamily);
    const candidateColorBuckets = new Set<string>();
    for (const b of extractColorBucketsFromText(candidateProduct.color)) candidateColorBuckets.add(b);
    for (const b of extractColorBucketsFromText(candidateStyle.colorProfile.primary)) candidateColorBuckets.add(b);
    for (const b of extractColorBucketsFromText(candidateProduct.title)) candidateColorBuckets.add(b);
    const colorScore = scoreColorCompatibilityByBuckets(sourceColorBuckets, candidateColorBuckets, candidateFamily);
    const aestheticScore = scoreAestheticCompatibility(params.sourceStyle.aesthetic, candidateStyle.aesthetic);
    const formalityScore = scoreFormalityCompatibility(params.sourceStyle.formality, candidateStyle.formality);
    const seasonScore = scoreSeasonCompatibility(params.sourceStyle.season, candidateStyle.season);
    const weatherScore = scoreWeatherCompatibility(
      params.sourceStyle.season,
      candidateProduct.title,
      candidateProduct.category
    );
    const aestheticGarmentScore = scoreAestheticGarmentCompatibility(
      params.sourceStyle,
      candidateFamily,
      candidateProduct.title,
      candidateProduct.category
    );
    const footwearAestheticScore =
      candidateFamily === "shoes"
        ? scoreFootwearAestheticCompatibility(params.sourceStyle, candidateProduct.title, candidateProduct.category)
        : 1;
    const priceScore = scoreRangeMatch(params.sourceProduct.price_cents, candidateProduct.price_cents);
    const footwearOccasionScore =
      candidateFamily === "shoes"
        ? scoreFootwearOccasionCompatibility(params.sourceStyle.occasion, candidateProduct.title, candidateProduct.category)
        : 1;
    const shoePipelineScore =
      candidateFamily === "shoes"
        ? assessShoeCandidate({
            sourceStyle: params.sourceStyle,
            sourceFamily,
            candidateTitle: candidateProduct.title,
            candidateCategory: candidateProduct.category,
            candidateDescription: candidateProduct.description,
          }).pipelineScore
        : 1;
    const bagOccasionScore =
      candidateFamily === "bags"
        ? scoreBagOccasionCompatibility(params.sourceStyle.occasion, candidateProduct.title, candidateProduct.category)
        : 1;
    const topPipelineScore =
      candidateFamily === "tops"
        ? assessTopCandidate({
            sourceStyle: params.sourceStyle,
            candidateTitle: candidateProduct.title,
            candidateCategory: candidateProduct.category,
            candidateDescription: candidateProduct.description,
          }).pipelineScore
        : 1;
    const bagPipelineScore =
      candidateFamily === "bags"
        ? assessBagCandidate(`${candidateProduct.title || ""} ${candidateProduct.category || ""} ${candidateProduct.description || ""}`).pipelineScore
        : 1;
    const garmentOccasionScore = scoreOccasionGarmentCompatibility(
      params.sourceStyle.occasion,
      candidateFamily,
      candidateProduct.title,
      candidateProduct.category
    );

    const sourcePatternText = `${params.sourceProduct.category || ""} ${params.sourceProduct.title || ""} ${params.sourceProduct.description || ""}`;
    const candidatePatternText = `${candidateProduct.category || ""} ${candidateProduct.title || ""} ${candidateProduct.description || ""}`;
    const patternHeavyPair = isPatternHeavyPair(sourcePatternText, candidatePatternText);
    const patternOverlap = patternHeavyPair ? 0.28 : 0.82;

    const sourceMaterial = normalizeStyleToken(params.sourceProduct.description);
    const candidateMaterial = normalizeStyleToken(candidateProduct.description);
    const materialOverlap = sourceMaterial && candidateMaterial && sourceMaterial === candidateMaterial ? 0.88 : 0.65;

    const fashionScoreRaw =
      categoryScore * 0.23 +
      aestheticScore * 0.18 +
      colorScore * 0.14 +
      formalityScore * 0.14 +
      seasonScore * 0.07 +
      weatherScore * 0.09 +
      aestheticGarmentScore * 0.08 +
      topPipelineScore * 0.08 +
      shoePipelineScore * 0.1 +
      footwearAestheticScore * 0.08 +
      footwearOccasionScore * 0.16 +
      bagOccasionScore * 0.1 +
      bagPipelineScore * 0.08 +
      garmentOccasionScore * 0.1 +
      patternOverlap * 0.06 +
      materialOverlap * 0.04 +
      priceScore * 0.02;
    const fashionScore = Math.max(0, Math.min(1, fashionScoreRaw / 1.5));

    const retrievalScore = Math.max(0, Math.min(1, s.score || 0));
    let finalScore = Math.round((fashionScore * 0.7 + retrievalScore * 0.3) * 1000) / 1000;

    if (candidateFamily === "bags") {
      const bagText = `${candidateProduct.title || ""} ${candidateProduct.category || ""} ${candidateProduct.description || ""}`;
      const bagAssessment = assessBagCandidate(bagText);
      const subtype = bagAssessment.subtype;
      const preferred = preferredBagSubtypesByOccasion(params.sourceStyle.occasion);
      const seasonalPreferred = preferredBagSubtypesBySeason(params.sourceStyle.season);
      const hasAccessoryLikeCategory = /\b(accessories?|wallet|card holder|card case|keychain|key ring|strap|charm|coin purse|phone case)\b/.test(
        normalizeStyleToken(candidateProduct.category)
      );
      if (subtype === "other") {
        finalScore = Math.round(finalScore * 0.58 * 1000) / 1000;
      }
      if (hasAccessoryLikeCategory) {
        finalScore = Math.round(finalScore * 0.62 * 1000) / 1000;
      }
      if (bagAssessment.pipelineScore < 0.58) {
        finalScore = Math.round(finalScore * 0.46 * 1000) / 1000;
      }
      if (preferred.includes(subtype)) {
        finalScore = Math.round(Math.min(1, finalScore * 1.08) * 1000) / 1000;
      }
      if (seasonalPreferred.includes(subtype)) {
        finalScore = Math.round(Math.min(1, finalScore * 1.05) * 1000) / 1000;
      }
    }

    if (candidateFamily === "shoes" && footwearOccasionScore < 0.45) {
      finalScore = Math.round(finalScore * 0.72 * 1000) / 1000;
    }
    if (candidateFamily === "shoes" && shoePipelineScore < 0.52) {
      finalScore = Math.round(finalScore * 0.62 * 1000) / 1000;
    }
    if (candidateFamily === "tops" && topPipelineScore < 0.5) {
      finalScore = Math.round(finalScore * 0.64 * 1000) / 1000;
    }
    if (candidateFamily === "shoes" && footwearAestheticScore < 0.55) {
      finalScore = Math.round(finalScore * 0.66 * 1000) / 1000;
    }
    if (candidateFamily === "bags" && bagOccasionScore < 0.45) {
      finalScore = Math.round(finalScore * 0.76 * 1000) / 1000;
    }
    if (
      (candidateFamily === "tops" || candidateFamily === "bottoms" || candidateFamily === "shoes") &&
      aestheticGarmentScore < 0.5
    ) {
      finalScore = Math.round(finalScore * 0.62 * 1000) / 1000;
    }
    if (weatherScore < 0.46) {
      finalScore = Math.round(finalScore * 0.65 * 1000) / 1000;
    }

    // Strongly penalize chromatic clashes for core garments (tops, bottoms, dresses, outerwear).
    if (
      sourceHasChromaticColor &&
      isCoreGarmentFamily(candidateFamily) &&
      colorScore < 0.28
    ) {
      finalScore = Math.round(finalScore * 0.48 * 1000) / 1000;
    }

    if (
      sourceHasChromaticColor &&
      candidateFamily === "bottoms" &&
      colorScore < 0.2
    ) {
      finalScore = Math.round(finalScore * 0.4 * 1000) / 1000;
    }
    if (patternHeavyPair && isCoreGarmentFamily(candidateFamily)) {
      finalScore = Math.round(finalScore * 0.62 * 1000) / 1000;
    }
    if (shouldHardRejectFashionCandidate({
      sourceFamily,
      candidateFamily,
      sourceStyle: params.sourceStyle,
      sourceProduct: params.sourceProduct,
      candidateProduct,
      colorScore,
      patternHeavyPair,
      candidateColorBuckets,
      footwearOccasionScore,
      bagOccasionScore,
      garmentOccasionScore,
    })) {
      return null;
    }

    const matchReasons = buildFashionReasons({
      categoryScore,
      colorScore,
      aestheticScore,
      formalityScore,
      seasonScore,
      weatherScore,
      aestheticGarmentScore,
      occasionGarmentScore: garmentOccasionScore,
      priceScore,
      patternScore: patternOverlap,
      materialScore: materialOverlap,
    });
    if (candidateFamily === "shoes") {
      matchReasons.push(
        footwearOccasionScore < 0.45
          ? "footwear is less suitable for this occasion"
          : "footwear matches the occasion"
      );
    }
    if (candidateFamily === "bags") {
      matchReasons.push(
        bagOccasionScore < 0.45
          ? "bag style is less suitable for this occasion"
          : "bag style matches the occasion"
      );
    }
    if (candidateFamily === "accessories") {
      matchReasons.push(
        garmentOccasionScore < 0.5
          ? "accessory style is less suitable for this occasion"
          : "accessory style matches the occasion"
      );
    }
    if (aestheticGarmentScore < 0.5) {
      matchReasons.push("less aligned with this aesthetic");
    }
    if (weatherScore < 0.46) {
      matchReasons.push("weather mismatch risk");
    }
    if (sourceHasChromaticColor && isCoreGarmentFamily(candidateFamily) && colorScore < 0.28) {
      matchReasons.push("color contrast is risky for this core piece");
    }
    if (patternHeavyPair && isCoreGarmentFamily(candidateFamily)) {
      matchReasons.push("pattern clash risk with your anchor piece");
    }

    return {
      ...s,
      score: finalScore,
      fashionScore: Math.round(fashionScore * 1000) / 1000,
      matchReasons: matchReasons.slice(0, 5),
      reason: s.reason || "fashion-aware match",
    };
  }));

  return enriched
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .filter((row) => !isHeadbandLikeRecommendation(row))
    .filter((row) => {
      const family = categoryFamily(row.category);
      const minScore = family === "bags" ? 0.44 : family === "shoes" ? 0.38 : family === "tops" ? 0.42 : family === "accessories" ? 0.43 : 0.5;
      return (row.score || 0) >= minScore;
    })
    .sort((a, b) => (b.score || 0) - (a.score || 0));
}

function normalizeAudienceHint(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  const tokens = Array.isArray(raw)
    ? raw.flatMap((v) => String(v).split(/[|,;/]+/g))
    : String(raw).split(/[|,;/]+/g);

  let hasMen = false;
  let hasWomen = false;
  let hasUnisex = false;

  for (const token of tokens) {
    const s = String(token).toLowerCase().trim();
    if (!s) continue;

    if (["unisex", "neutral", "all", "all-gender", "all gender", "all genders"].includes(s)) {
      hasUnisex = true;
      continue;
    }

    if (["men", "man", "male", "mens", "men's", "gents", "gentlemen", "boy", "boys", "boys-kids", "boys_kids", "m", "male-adult"].includes(s)) {
      hasMen = true;
      continue;
    }

    if (["women", "woman", "female", "womens", "women's", "ladies", "lady", "girl", "girls", "girls-kids", "girls_kids", "f", "female-adult"].includes(s)) {
      hasWomen = true;
      continue;
    }
  }

  if (hasUnisex || (hasMen && hasWomen)) return "unisex";
  if (hasMen) return "men";
  if (hasWomen) return "women";
  return undefined;
}

function isHeadbandLikeRecommendation(item: {
  title?: string | null;
  category?: string | null;
  description?: string | null;
}): boolean {
  const text = `${String(item.title || "")} ${String(item.category || "")} ${String(item.description || "")}`
    .toLowerCase()
    .trim();
  if (!text) return false;
  return /\b(headband|head band|hairband|hair band|hair accessory|scrunchie)\b/.test(text);
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

/**
 * Validate if a product's category family matches the target slot
 * Prevents bags from appearing in bottoms, accessories in shoes, etc.
 */
function isProductValidForSlot(product: { category?: string | null }, targetSlot: string): boolean {
  const family = categoryFamily(product.category);
  const normalizedSlot = targetSlot.toLowerCase().trim();

  // Exact family match is always valid
  if (family === normalizedSlot) return true;

  // Handle slot-to-family mappings
  const slotToFamilies: Record<string, string[]> = {
    bottoms: ["bottoms"],
    shoes: ["shoes"],
    bags: ["bags"],
    accessories: ["accessories"],
    dresses: ["dress"],
    tops: ["tops"],
    outerwear: ["outerwear"],
  };

  const validFamilies = slotToFamilies[normalizedSlot];
  if (!validFamilies) return true; // Unknown slot, allow by default
  
  return validFamilies.includes(family);
}

function balanceSuggestionsForCoverage(
  suggestions: CompleteLookMappedSuggestion[],
  missingCategories: string[],
  maxTotal: number,
  maxPerCategory: number
): CompleteLookMappedSuggestion[] {
  if (!Array.isArray(suggestions) || suggestions.length === 0) return [];
  const slotPriority = missingCategories.map((m) => String(m || "").toLowerCase().trim()).filter(Boolean);
  const normalizedSlot = (value?: string | null) => {
    const family = categoryFamily(value);
    if (family === "dress") return "dresses";
    return family || "accessories";
  };

  const deduped = suggestions.filter((s, idx, arr) => {
    const key = `${String(s.brand || "").toLowerCase().trim()}|${String(s.title || "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 90)}`;
    return arr.findIndex((x) => `${String(x.brand || "").toLowerCase().trim()}|${String(x.title || "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 90)}` === key) === idx;
  });

  const bySlot = new Map<string, CompleteLookMappedSuggestion[]>();

  for (const s of deduped.slice().sort((a, b) => (b.score || 0) - (a.score || 0))) {
    const slot = normalizedSlot(s.category);
    if (!bySlot.has(slot)) bySlot.set(slot, []);
    bySlot.get(slot)!.push(s);
  }

  const out: CompleteLookMappedSuggestion[] = [];
  const used = new Set<number>();

  // Pass 1: ensure each missing slot gets at least one recommendation when available.
  for (const slot of slotPriority) {
    const pool = bySlot.get(slot) || [];
    const pick = pool.find((p) => !used.has(p.product_id) && isProductValidForSlot(p, slot));
    if (pick && out.length < maxTotal) {
      out.push(pick);
      used.add(pick.product_id);
    }
  }

  // Pass 2: round-robin by missing slots up to per-category cap.
  let progressed = true;
  while (out.length < maxTotal && progressed) {
    progressed = false;
    for (const slot of slotPriority) {
      if (out.length >= maxTotal) break;
      const slotCount = out.filter((x) => normalizedSlot(x.category) === slot).length;
      if (slotCount >= maxPerCategory) continue;
      const pool = bySlot.get(slot) || [];
      const pick = pool.find((p) => !used.has(p.product_id) && isProductValidForSlot(p, slot));
      if (!pick) continue;
      out.push(pick);
      used.add(pick.product_id);
      progressed = true;
    }
  }

  // Pass 3: fill remaining with best global suggestions.
  for (const s of deduped) {
    if (out.length >= maxTotal) break;
    if (used.has(s.product_id)) continue;
    const slot = normalizedSlot(s.category);
    const slotCount = out.filter((x) => normalizedSlot(x.category) === slot).length;
    if (slot && slotCount >= maxPerCategory) continue;
    // Only add if product is valid for its assigned slot
    if (!isProductValidForSlot(s, slot)) continue;
    out.push(s);
    used.add(s.product_id);
  }

  return out.slice(0, maxTotal);
}

function inferSourceCategoryFallback(sourceProduct: {
  category?: string | null;
  title?: string | null;
  description?: string | null;
}): ProductCategory {
  const text = `${String(sourceProduct.category || "")} ${String(sourceProduct.title || "")} ${String(sourceProduct.description || "")}`.toLowerCase();
  if (/\b(jacket|coat|blazer|outerwear|bomber|parka|windbreaker)\b/.test(text)) return "jacket" as ProductCategory;
  if (/\b(trouser|trousers|pants|jeans|skirt|shorts?|leggings|bottoms?)\b/.test(text)) return "pants" as ProductCategory;
  if (/\b(top|tops|shirt|shirts|blouse|blouses|tee|t-?shirt|hoodie|hoodies|sweater|sweaters|sweatshirt|sweatshirts|knit)\b/.test(text)) return "top" as ProductCategory;
  if (/\b(dress|gown|romper|jumpsuit|playsuit)\b/.test(text)) return "dress" as ProductCategory;
  
  // For shoes, detect specific type or default to loafers
  if (/\b(shoe|shoes|sneaker|sneakers|trainer|trainers|running shoe|athletic|canvas)\b/.test(text)) return "sneakers" as ProductCategory;
  if (/\b(heel|heels|pump|pumps|stiletto|stilettos)\b/.test(text)) return "heels" as ProductCategory;
  if (/\b(boot|boots|ankle boot|knee boot|combat)\b/.test(text)) return "boots" as ProductCategory;
  if (/\b(sandal|sandals|flip flop|slide|slide sandal)\b/.test(text)) return "sandals" as ProductCategory;
  if (/\b(loafer|loafers|moccasin|moccasins|slip-?on|penny)\b/.test(text)) return "loafers" as ProductCategory;
  if (/\b(flat|flats|ballet flat|ballerina|flat shoe)\b/.test(text)) return "flats" as ProductCategory;
  if (/\b(shoe|footwear|shoes?)\b/.test(text)) return "loafers" as ProductCategory; // Default to loafers for generic shoes
  
  if (/\b(bag|wallet|backpack|accessor|crossbody|clutch|tote)\b/.test(text)) return "accessories" as ProductCategory;
  return "unknown" as ProductCategory;
}

function expectedCoverageSlotsForSource(
  sourceCategory: ProductCategory
): string[] {
  const family = categoryFamily(sourceCategory);
  if (family === "shoes") return ["tops", "bottoms", "bags"];
  if (family === "bottoms") return ["tops", "shoes", "bags"];
  if (family === "tops" || family === "outerwear") return ["bottoms", "shoes", "bags"];
  if (family === "dress") return ["shoes", "bags", "accessories"];
  return ["bottoms", "shoes", "bags"];
}

function mergeMissingCategoriesWithCoverageNeeds(
  rawMissing: string[] | undefined,
  sourceCategory: ProductCategory
): string[] {
  const normalized = (rawMissing || [])
    .map((m) => String(m || "").toLowerCase().trim())
    .filter(Boolean);
  const expected = expectedCoverageSlotsForSource(sourceCategory);
  const out: string[] = [];
  for (const slot of expected) {
    if (!out.includes(slot)) out.push(slot);
  }
  for (const slot of normalized) {
    if (!out.includes(slot)) out.push(slot);
  }
  return out;
}

function correctDetectedSourceCategory(
  detectedCategory: ProductCategory,
  sourceProduct: {
    category?: string | null;
    title?: string | null;
    description?: string | null;
  }
): ProductCategory {
  const text = `${String(sourceProduct.category || "")} ${String(sourceProduct.title || "")} ${String(sourceProduct.description || "")}`.toLowerCase();
  const hasBottomCue = /\b(legging|leggings|pants?|trousers?|jeans?|skirt|shorts?|bottoms?)\b/.test(text);
  const hasTopCue = /\b(t-?shirt|tee|shirt|blouse|hoodie|sweater|cardigan|sweatshirt|top|tops|knit)\b/.test(text);
  const hasDressCue = /\b(dress|gown|jumpsuit|romper)\b/.test(text);
  const hasShoeCue = /\b(shoe|sneaker|boot|heel|loafer|sandal|flat|trainer)\b/.test(text);
  const hasBagCue = /\b(bag|crossbody|clutch|tote|backpack)\b/.test(text);

  // Dress cues must win before bottom cues to avoid false "pants" on dress descriptions.
  if (hasDressCue) return "dress" as ProductCategory;
  // Strong correction for obvious bottoms mislabeled as tops.
  if (hasBottomCue && !hasTopCue && !hasDressCue) return "pants" as ProductCategory;
  if (hasShoeCue) {
    if (/\b(heel|pump|stiletto)\b/.test(text)) return "heels" as ProductCategory;
    if (/\b(boot|boots)\b/.test(text)) return "boots" as ProductCategory;
    if (/\b(sandal|sandals|slide|flip flop)\b/.test(text)) return "sandals" as ProductCategory;
    if (/\b(loafer|loafers|oxford)\b/.test(text)) return "loafers" as ProductCategory;
    return "sneakers" as ProductCategory;
  }
  if (hasBagCue) return "accessories" as ProductCategory;
  if (hasTopCue && !hasBottomCue) return "top" as ProductCategory;

  if (detectedCategory && detectedCategory !== ("unknown" as ProductCategory)) {
    return detectedCategory;
  }
  return inferSourceCategoryFallback(sourceProduct);
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
  const sourceText = `${String(sourceProduct.title || "")} ${String(sourceProduct.category || "")} ${String(sourceProduct.description || "")}`.toLowerCase();
  const sourceLooksCozyTop = /\b(cardigan|sweater|sweatshirt|hoodie|knit|wool|cashmere|fleece)\b/.test(sourceText);
  const sourceIsDressAnchor =
    /\b(dress|gown|midi dress|mini dress|maxi dress)\b/.test(sourceText) ||
    categoryFamily(detectedCategory) === "dress";
  const sourceIsDressyOccasion =
    sourceStyle.occasion === "party" ||
    sourceStyle.occasion === "formal" ||
    sourceStyle.occasion === "semi-formal";

  // Detect if source is an outerwear item (suit, blazer, jacket, etc.)
  const sourceIsOuterwear = detectedCategory === "jacket" || categoryFamily(detectedCategory) === "outerwear";
  const sourceIsSuit = /\b(suit|suits|tuxedo|two[-\s]?piece|three[-\s]?piece|formal suit|business suit)\b/.test(sourceText);
  const sourceIsBlazer = /\b(blazer|blazers|sport\s*coat|sportcoat|suit\s*jacket|dress\s*jacket|tailored\s*jacket)\b/.test(sourceText);
  const sourceIsJacket = sourceIsOuterwear && !sourceIsSuit && !sourceIsBlazer;

  const isShoeLike = (value: string): boolean =>
    /\b(shoe|shoes|sneaker|trainer|heel|pump|stiletto|sandal|loafer|flat|mule|boot|oxford|espadrille)\b/.test(value);
  const isSneakerLike = (value: string): boolean =>
    /\b(sneaker|sneakers|trainer|trainers|tennis shoe|running shoe|athletic shoes?|sportswear shoes?)\b/.test(value);
  const isDressyShoeLike = (value: string): boolean =>
    /\b(heel|heels|pump|pumps|stiletto|stilettos|sandal|sandals|dress sandal|mule|mules|ballet flat|ballerina|slingback|kitten heel|espadrille|loafer|loafers)\b/.test(value);
  const isRealBagLike = (value: string): boolean =>
    /\b(tote|crossbody|clutch|satchel|backpack|shoulder bag|handbag|hobo|messenger|bucket bag|top handle|mini bag)\b/.test(value);
  const looksLikeBagAccessoryNoise = (value: string): boolean =>
    /\b(wallet|card holder|card case|keychain|key ring|strap|bag charm|coin purse|phone case)\b/.test(value);

  const stagedSuggestions = completeLookResult.suggestions
    .slice()
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  const shouldKeepMappedSuggestion = (categoryLabel: string, s: CompleteLookMappedSuggestion): boolean => {
    const text = `${String(s.title || "")} ${String(s.category || "")}`.toLowerCase();

    // Never allow bag-accessory placeholders unless concrete bag subtype exists.
    if (categoryLabel === "Bags") {
      const bagAssessment = assessBagCandidate(`${s.title || ""} ${s.category || ""}`);
      if (
        !bagAssessment.isBagCandidate ||
        bagAssessment.isAccessoryNoise ||
        bagAssessment.isTravelUtility ||
        bagAssessment.pipelineScore < 0.58
      ) {
        return false;
      }
      if (looksLikeBagAccessoryNoise(text)) return false;
    }

    if (categoryLabel === "Shoes") {
      const shoeAssessment = assessShoeCandidate({
        sourceStyle,
        sourceFamily: categoryFamily(detectedCategory),
        candidateTitle: s.title,
        candidateCategory: s.category,
      });
      if (shoeAssessment.isNoise || shoeAssessment.pipelineScore < 0.5) return false;
    }

    if (categoryLabel === "Tops") {
      const topAssessment = assessTopCandidate({
        sourceStyle,
        candidateTitle: s.title,
        candidateCategory: s.category,
      });
      if (topAssessment.isNoise || topAssessment.pipelineScore < 0.48) return false;
    }

    if (categoryLabel === "Bottoms") {
      // When source is a formal outerwear item (suit or blazer), prefer formal button/tailored bottoms
      if ((sourceIsSuit || sourceIsBlazer) && sourceStyle.formality >= 5) {
        // For formal occasions with suit/blazer, require formal button or tailored bottoms
        const hasFormalButton = /\b(formal button|dress pant|dress pants|tailored trouser|tailored trousers|tailored pant|pleated|slacks?|formal|tuxedo|dress)\b/.test(text);
        if (!hasFormalButton) {
          // Allow some flexibility for semi-formal occasions, but reject casual/sporty bottoms
          if (
            /\b(short|shorts|jogger|joggers|sweatpants|track pant|track pants|cargo|swim short|biker short|cycling short|legging|leggings|casual|athletic|training|gym)\b/.test(text)
          ) {
            return false;
          }
        }
      }
      
      if (
        (sourceStyle.occasion === "formal" || sourceStyle.occasion === "semi-formal" || sourceStyle.occasion === "party") &&
        /\b(short|shorts|jogger|joggers|sweatpants|track pant|track pants|cargo|swim short|biker short|cycling short)\b/.test(text)
      ) {
        return false;
      }
      if (
        sourceStyle.occasion === "active" &&
        /\b(dress pant|dress pants|slacks|tailored trouser|tailored trousers|pleated trouser|pleated trousers|formal trouser)\b/.test(text)
      ) {
        return false;
      }
    }

    // For classic/minimalist moderate+ formality, remove sporty bottoms.
    if (
      categoryLabel === "Bottoms" &&
      (sourceStyle.aesthetic === "classic" || sourceStyle.aesthetic === "minimalist") &&
      sourceStyle.formality >= 3 &&
      /\b(legging|leggings|jogger|joggers|track pant|track pants|sports legging|athletic|training|gym|running|padel)\b/.test(text)
    ) {
      return false;
    }

    // Seasonal sanity: fall/winter tops should avoid shorts as main bottoms.
    if (
      categoryLabel === "Bottoms" &&
      (sourceStyle.season === "fall" || sourceStyle.season === "winter") &&
      /\b(short|shorts|bermuda)\b/.test(text)
    ) {
      return false;
    }
    if (
      categoryLabel === "Bottoms" &&
      (sourceStyle.season === "fall" || sourceStyle.season === "winter") &&
      (sourceStyle.occasion === "casual" || sourceStyle.occasion === "active") &&
      /\b(skirt|mini skirt|midi skirt|maxi skirt|pleated skirt)\b/.test(text)
    ) {
      return false;
    }

    // Streetwear does not imply activewear by default; block sports leggings unless occasion is active.
    if (
      categoryLabel === "Bottoms" &&
      sourceStyle.aesthetic === "streetwear" &&
      sourceStyle.occasion !== "active" &&
      /\b(sports legging|sport legging|training legging|gym legging|running legging|workout legging)\b/.test(text)
    ) {
      return false;
    }

    // Outfit-aware tops filtering: when source is a suit/blazer, return suits not just jackets
    if (categoryLabel === "Tops") {
      if (sourceIsSuit) {
        // For suit sources, also include other suits in the tops recommendations
        // Don't reject suits - they're valid companions for complete looks
        const isSuitLike = /\b(suit|suits|tuxedo|blazer|sport\s*coat|dress\s*jacket|tailored\s*jacket)\b/.test(text);
        // But still filter out inappropriate casual tops if it's a formal suit
        if (!isSuitLike && sourceStyle.formality >= 6) {
          const isFormalTop = /\b(dress shirt|oxford|formal shirt|button[-\s]?up|crisp|tailored|structured)\b/.test(text);
          if (!isFormalTop && /\b(hoodie|hoody|sweatshirt|tshirt|t-shirt|casual|sporty|athletic)\b/.test(text)) {
            return false;
          }
        }
      } else if (sourceIsBlazer && sourceStyle.formality >= 5) {
        // For blazer sources, exclude full suits to prevent redundancy
        const isFullSuit = /\b(full suit|complete suit|two[-\s]?piece|three[-\s]?piece|matching suit)\b/.test(text);
        if (isFullSuit) return false;
        // But allow tailored tops and other blazers
      }
    }

    // Hard dress-shoe gate in mapped response path.
    if (categoryLabel === "Shoes" && sourceIsDressAnchor) {
      if (isSneakerLike(text)) return false;
      const dressyLike = isDressyShoeLike(text);
      if (!dressyLike && sourceIsDressyOccasion) {
        return false;
      }
    }

    // Cozy winter-like tops should avoid skirts unless clearly party/formal or summer.
    if (
      categoryLabel === "Bottoms" &&
      sourceLooksCozyTop &&
      sourceStyle.occasion !== "party" &&
      sourceStyle.occasion !== "formal" &&
      sourceStyle.occasion !== "semi-formal" &&
      sourceStyle.season !== "summer" &&
      /\b(skirt|mini skirt|midi skirt|maxi skirt)\b/.test(text)
    ) {
      return false;
    }

    return true;
  };

  for (const s of stagedSuggestions) {
    const categoryLabel = completeStyleCategoryLabel(`${s.category || ""} ${s.title || ""}`);
    if (!categoryLabel) continue;
    if (!shouldKeepMappedSuggestion(categoryLabel, s)) continue;
    if (!groups.has(categoryLabel)) groups.set(categoryLabel, []);
    const bucket = groups.get(categoryLabel)!;
    if (bucket.length >= maxPerCategory) continue;
    if (categoryLabel === "Shoes") {
      const subtype = footwearSubtypeLabel(`${s.title || ""} ${s.category || ""}`);
      const sameSubtypeCount = bucket.filter((item) =>
        footwearSubtypeLabel(item.title) === subtype
      ).length;
      const normalizedBrand = String(s.brand || "").toLowerCase().trim();
      const sameBrandCount = bucket.filter(
        (item) => String(item.brand || "").toLowerCase().trim() === normalizedBrand
      ).length;
      // Diversity-aware caps: prevent monotony but avoid collapsing to too few results.
      if (bucket.length >= 2 && sameSubtypeCount >= 2) continue;
      if (bucket.length >= 2 && normalizedBrand && sameBrandCount >= 2) continue;
    }
    if (categoryLabel === "Tops") {
      const subtype = topSubtypeLabel(`${s.title || ""} ${s.category || ""}`);
      const sameSubtypeCount = bucket.filter(
        (item) => topSubtypeLabel(item.title) === subtype
      ).length;
      const normalizedBrand = String(s.brand || "").toLowerCase().trim();
      const sameBrandCount = bucket.filter(
        (item) => String(item.brand || "").toLowerCase().trim() === normalizedBrand
      ).length;
      if (bucket.length >= 2 && sameSubtypeCount >= 2) continue;
      if (bucket.length >= 3 && normalizedBrand && sameBrandCount >= 2) continue;
    }
    if (categoryLabel === "Bags") {
      const normalizedBrand = String(s.brand || "").toLowerCase().trim();
      const subtype = bagSubtypeLabel(`${s.title || ""} ${s.category || ""}`);
      const sameSubtypeCount = bucket.filter(
        (item) => bagSubtypeLabel(item.title) === subtype
      ).length;
      const sameBrandCount = bucket.filter(
        (item) => String(item.brand || "").toLowerCase().trim() === normalizedBrand
      ).length;
      // Diversity-aware caps for bags: allow depth, avoid monotony.
      if (bucket.length >= 2 && sameSubtypeCount >= 2) continue;
      if (bucket.length >= 2 && normalizedBrand && sameBrandCount >= 2) continue;
    }

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

  // Pass 2 fallback: ensure shoes/bags are populated with best valid candidates.
  const ensureCategoryFilled = (categoryLabel: "Shoes" | "Bags") => {
    const existing = groups.get(categoryLabel) || [];
    if (existing.length >= Math.min(4, maxPerCategory)) return;
    if (!groups.has(categoryLabel)) groups.set(categoryLabel, []);
    const bucket = groups.get(categoryLabel)!;

    for (const s of stagedSuggestions) {
      if (bucket.length >= Math.min(4, maxPerCategory)) break;
      const text = `${String(s.title || "")} ${String(s.category || "")}`.toLowerCase();
      const productId = s.product_id;
      if (bucket.some((b) => b.id === productId)) continue;

      if (categoryLabel === "Shoes") {
        const familyLooksShoes = categoryFamily(s.category) === "shoes";
        if (!isShoeLike(text) && !familyLooksShoes) continue;
        const shoeAssessment = assessShoeCandidate({
          sourceStyle,
          sourceFamily: categoryFamily(detectedCategory),
          candidateTitle: s.title,
          candidateCategory: s.category,
        });
        if (shoeAssessment.isNoise || shoeAssessment.pipelineScore < 0.5) continue;
        if (sourceIsDressyOccasion && sourceIsDressAnchor) {
          if (isSneakerLike(text)) continue;
          // Prefer dressy shoes, but don't force-empty category if metadata is noisy.
          if (!isDressyShoeLike(text) && bucket.length === 0) continue;
        }
      } else {
        const familyLooksBags = categoryFamily(s.category) === "bags";
        if (looksLikeBagAccessoryNoise(text)) continue;
        const bagAssessment = assessBagCandidate(`${s.title || ""} ${s.category || ""}`);
        if (
          !bagAssessment.isBagCandidate ||
          bagAssessment.isAccessoryNoise ||
          bagAssessment.isTravelUtility ||
          bagAssessment.pipelineScore < 0.58
        ) {
          continue;
        }
        // Accept true bag subtype OR bag family classification for fallback fill.
        if (!isRealBagLike(text) && !familyLooksBags) continue;
      }

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
  };

  ensureCategoryFilled("Shoes");
  ensureCategoryFilled("Bags");

  const recommendations = Array.from(groups.entries()).map(([category, products]) => {
    const priority = completeStylePriorityFromCategory(category, completeLookResult.missingCategories || []);
    const colorHint = colorComfortHintForCategory(sourceStyle, category, sourceProduct);
    const styleReason = reasons.get(category) || `Recommended ${category.toLowerCase()} for this look`;
    return {
      category,
      reason: `${styleReason}. ${colorHint}`,
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
    if (isHeadbandLikeRecommendation(s)) return false;
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
 * Infer audience gender from image URL using BLIP vision model
 * Returns "men" | "women" | undefined based on high-confidence visual cues
 */
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
