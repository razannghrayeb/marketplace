/**
 * Per-hit compliance + final relevance (shared by text search and image kNN search).
 */
import { getCategorySearchTerms } from "./categoryFilter";
import {
  downrankSpuriousProductTypeFromCategory,
  filterProductTypeSeedsByMappedCategory,
  hasGarmentLikeFamilyFromProductTypeSeeds,
  scoreCrossFamilyTypePenalty,
  scoreRerankProductTypeBreakdown,
} from "./productTypeTaxonomy";
import { isBeautyRetailListingFromFields } from "./categoryFilter";
import { extractAttributesSync } from "./attributeExtractor";
import { tieredColorListCompliance } from "../color/colorCanonical";
import { normalizeColorToken } from "../color/queryColorFilter";

/** Visual / hybrid similarity should dominate tie-breaks when type/color intent is absent. */
function rerankSimilarityWeight(): number {
  const n = Number(process.env.SEARCH_RERANK_SIM_WEIGHT);
  return Number.isFinite(n) ? Math.min(120, Math.max(10, n)) : 72;
}

function rerankAudienceWeight(): number {
  const n = Number(process.env.SEARCH_RERANK_AUD_WEIGHT);
  return Number.isFinite(n) ? Math.min(50, Math.max(8, n)) : 24;
}

/** 0..1: query category hints vs document `category` / `category_canonical` (alias-aware). */
export function scoreCategoryRelevance01(
  mergedCategory: string | undefined,
  astCategories: string[],
  docCategory: unknown,
  docCanonical: unknown,
): number {
  const hints: string[] = [];
  if (mergedCategory) hints.push(String(mergedCategory).toLowerCase().trim());
  for (const c of astCategories || []) {
    const x = String(c).toLowerCase().trim();
    if (x && !hints.includes(x)) hints.push(x);
  }
  if (hints.length === 0) return 0;

  const dc = docCategory != null ? String(docCategory).toLowerCase().trim() : "";
  const dcc = docCanonical != null ? String(docCanonical).toLowerCase().trim() : "";
  if (!dc && !dcc) return 0;

  let best = 0;
  for (const h of hints) {
    if (!h) continue;
    const aliases = new Set(getCategorySearchTerms(h).map((t) => t.toLowerCase()));
    aliases.add(h);
    if (aliases.has(dc) || aliases.has(dcc)) {
      best = 1;
      break;
    }
    for (const a of aliases) {
      if (!a) continue;
      if (
        (dc && (dc === a || dc.includes(a) || a.includes(dc))) ||
        (dcc && (dcc === a || dcc.includes(a) || a.includes(dcc)))
      ) {
        best = Math.max(best, 0.55);
      }
    }
  }
  return Math.max(0, Math.min(1, best));
}

/**
 * Calibrated 0..1 relevance for acceptance gating (text: SEARCH_FINAL_ACCEPT_MIN_TEXT;
 * image: SEARCH_FINAL_ACCEPT_MIN_IMAGE — see config.search).
 * Type intent + cross-family taxonomy penalties gate hard; text similarity and category
 * boost score compliant hits. Cross-family soft factor applies below the hard block threshold.
 */
export function computeFinalRelevance01(params: {
  hasTypeIntent: boolean;
  hasReliableTypeIntent?: boolean;
  typeScore: number;
  catScore: number;
  semScore: number;
  lexScore: number;
  colorScore: number;
  audScore: number;
  styleScore: number;
  patternScore?: number;
  sleeveScore: number;
  hasColorIntent: boolean;
  hasStyleIntent: boolean;
  hasPatternIntent?: boolean;
  hasSleeveIntent: boolean;
  hasAudienceIntent: boolean;
  /** From scoreCrossFamilyTypePenalty; strong garment↔footwear mismatches are typically ≥ 0.8 */
  crossFamilyPenalty: number;
  /** Intra-family subtype mismatch penalty from product type taxonomy. */
  intraFamilyPenalty?: number;
  /**
   * When false, the global term is semantic-only (image-only kNN or no lexical query).
   * Avoids 0.6·sem + 0.4·lex collapsing to sem while still exposing the same number twice in explain.
   */
  applyLexicalToGlobal?: boolean;
  /** Image similar-search: keep final relevance closer to raw cosine so weak visuals cannot rank as strong matches. */
  tightSemanticCap?: boolean;
}): number {
  const crossPen = Math.max(0, params.crossFamilyPenalty);
  const intraPen = Math.max(0, params.intraFamilyPenalty ?? 0);
  // Hard block for cross-family mismatch (e.g. footwear query returning dresses).
  // For image search (tightSemanticCap), type intent comes from YOLO which can be
  // wrong — don't hard-zero, just heavily penalize so visual similarity can still
  // rescue genuinely similar products.
  const gateTypeIntent = params.hasTypeIntent && params.hasReliableTypeIntent !== false;
  if (gateTypeIntent && crossPen >= 0.8) {
    if (params.tightSemanticCap) {
      return Math.max(0, params.semScore * 0.15);
    }
    return 0;
  }

  // For image search (tightSemanticCap), type intent often comes from noisy YOLO
  // predictions. Use softer gates so a wrong category prediction doesn't nuke all
  // visually similar results. For text search, keep the strict gates since the user
  // explicitly typed the product type.
  const typeGateFactor = !gateTypeIntent
    ? 1
    : params.typeScore >= 0.5
      ? 1
      : params.typeScore >= 0.2
        ? (params.tightSemanticCap ? 0.75 : 0.3)
        : (params.tightSemanticCap ? 0.55 : 0.05);

  const categoryBoost = 1 + params.catScore * 0.25;
  const applyLex = params.applyLexicalToGlobal !== false;
  const globalScore = applyLex
    ? params.semScore * 0.6 + params.lexScore * 0.4
    : params.semScore;

  const colorPart = params.hasColorIntent ? params.colorScore : 1;
  const audPart = params.hasAudienceIntent ? params.audScore : 1;
  const stylePart = params.hasStyleIntent ? params.styleScore : 1;
  const patternPart = params.hasPatternIntent && typeof params.patternScore === 'number' ? params.patternScore : 1;
  const sleevePart = params.hasSleeveIntent ? params.sleeveScore : 1;
  // Attribute blend: keep color dominant, but allow style and pattern to influence as well.
  const attrScore = colorPart * 0.4 + stylePart * 0.15 + patternPart * 0.15 + sleevePart * 0.15 + audPart * 0.15;
  const attrFactor = 0.5 + attrScore * 0.5;

  const crossFamilySoftFactor = Math.max(0, 1 - crossPen * 0.6);
  const intraFamilySoftFactor = params.hasTypeIntent
    ? params.tightSemanticCap
      ? Math.max(0.25, 1 - intraPen * 0.95)
      : Math.max(0.4, 1 - intraPen * 0.7)
    : 1;

  const raw =
    globalScore * typeGateFactor * categoryBoost * attrFactor * crossFamilySoftFactor * intraFamilySoftFactor;
  const bounded = Math.max(0, Math.min(1, raw));
  // Prevent final relevance from being unrealistically higher than visual/semantic evidence.
  // With tightSemanticCap (image search), allow a wider bonus so that products with
  // strong attribute/type compliance can surface above pure visual similarity.
  // Previous 0.035/0.07 caps were too restrictive and collapsed all image search
  // results into a narrow band near raw cosine, making the relevance layer useless.
  const hasIntent =
    params.hasTypeIntent || params.hasColorIntent || params.hasStyleIntent || params.hasAudienceIntent;
  const capBonus = params.tightSemanticCap
    ? hasIntent
      ? 0.25
      : 0.32
    : hasIntent
      ? 0.12
      : 0.2;
  const softCap = Math.min(1, params.semScore + capBonus);
  return Math.min(bounded, softCap);
}

export function normalizeQueryGender(g: string | undefined): string | null {
  if (!g) return null;
  const x = g.toLowerCase().trim();
  if (["men", "man", "male", "mens", "men's", "boy", "boys", "boys-kids", "boys_kids"].includes(x)) {
    return "men";
  }
  if (["women", "woman", "female", "womens", "women's", "girl", "girls", "girls-kids", "girls_kids", "lady", "ladies"].includes(x)) {
    return "women";
  }
  if (x === "unisex") return "unisex";
  return null;
}

function docAgeGroup(hit: { _source?: Record<string, unknown> }): string | null {
  const raw = hit?._source?.age_group;
  if (raw === undefined || raw === null) return null;
  return String(raw).toLowerCase().trim() || null;
}

function docAudienceGender(hit: { _source?: Record<string, unknown> }): string | null {
  const raw = hit?._source?.audience_gender ?? hit?._source?.attr_gender ?? hit?._source?.gender;
  if (raw === undefined || raw === null) return null;
  return normalizeQueryGender(String(raw));
}

/**
 * 0..1: query age_group / audience_gender vs indexed audience fields.
 */
export function scoreAudienceCompliance(
  queryAgeGroup: string | undefined,
  queryGender: string | undefined,
  hit: { _source?: Record<string, unknown> },
): number {
  const wantAge = queryAgeGroup?.toLowerCase().trim();
  const wantG = normalizeQueryGender(queryGender);
  const docAge = docAgeGroup(hit);
  const docG = docAudienceGender(hit);
  const title = typeof hit?._source?.title === "string" ? hit._source.title.toLowerCase() : "";
  const category = typeof hit?._source?.category === "string" ? hit._source.category.toLowerCase() : "";
  const canonical =
    typeof hit?._source?.category_canonical === "string"
      ? hit._source.category_canonical.toLowerCase()
      : "";
  const productTypes = Array.isArray(hit?._source?.product_types)
    ? hit._source.product_types.map((t) => String(t).toLowerCase()).join(" ")
    : "";
  const audienceBlob = `${title} ${category} ${canonical} ${productTypes}`;

  let score = 1;
  let factors = 0;

  if (wantAge) {
    factors += 1;
    if (!docAge) {
      if (wantAge === "kids" && /\b(kids?|child|children|boys?|girls?|toddler|baby|youth)\b/.test(audienceBlob)) {
        score *= 0.92;
      } else if (wantAge === "adult" || wantAge === "teen") {
        score *= 0.88;
      } else {
        score *= 0.72;
      }
    } else if (docAge === wantAge) {
      score *= 1;
    } else if (wantAge === "kids" && (docAge === "baby" || docAge === "teen")) {
      score *= 0.88;
    } else if (wantAge === "baby" && docAge === "kids") {
      score *= 0.85;
    } else {
      // Hard contradiction: explicit indexed age group disagrees with requested age group.
      score *= 0;
    }
  }

  if (wantG) {
    factors += 1;
    if (!docG) {
      const hasKidsCue = /\b(kids?|child|children|boys?|girls?|toddler|baby|youth)\b/.test(audienceBlob);
      if (wantG === "men") {
        if (hasKidsCue) score *= 0;
        else if (/\b(men|mens|male)\b/.test(audienceBlob)) score *= 0.9;
        else if (/\b(women|womens|female|ladies|woman|girl|girls)\b/.test(audienceBlob)) score *= 0.28;
        else score *= 0.78;
      } else if (wantG === "women") {
        if (hasKidsCue) score *= 0;
        else if (/\b(women|womens|female|ladies|woman)\b/.test(audienceBlob)) score *= 0.9;
        else if (/\b(men|mens|male|man|boy|boys)\b/.test(audienceBlob)) score *= 0.28;
        else score *= 0.78;
      } else {
        score *= 0.85;
      }
    } else if (docG === "unisex" || docG === wantG) {
      score *= 1;
    } else {
      // Hard contradiction: explicit indexed audience gender disagrees with request.
      score *= 0;
    }
  }

  if (factors === 0) return 1;
  return Math.max(0, Math.min(1, Math.pow(score, 1 / factors)));
}

/** When indexed hits expose separate hybrid components, rerank uses them for sem vs lex. */
export interface HybridScoreRecallStats {
  hasSplitScores: boolean;
  maxClip: number;
  maxBm25: number;
  useTanhSim: boolean;
  tanhScale: number;
}

export interface SearchHitRelevanceIntent {
  desiredProductTypes: string[];
  desiredColors: string[];
  desiredColorsTier: string[];
  /** Canonical attr_style token (e.g. "casual", "formal", "smart-casual"). */
  desiredStyle?: string;
  /** Canonical attr_pattern token (e.g. "striped", "floral", "solid"). */
  desiredPattern?: string;
  /** short | long | sleeveless */
  desiredSleeve?: string;
  rerankColorMode: "any" | "all";
  mergedCategory?: string;
  astCategories: string[];
  queryAgeGroup?: string;
  /** Second argument to audience scoring (text: normalizeQueryGender(merged.gender) ?? merged.gender). */
  audienceGenderForScoring?: string;
  hasAudienceIntent: boolean;
  crossFamilyPenaltyWeight: number;
  /**
   * Processed query string for a lexical 0..1 score (title token overlap) when OS does not
   * return separate BM25 vs vector scores.
   */
  lexicalMatchQuery?: string;
  hybridScoreRecall?: HybridScoreRecallStats;
  /** True when AST pipeline fell back to processQueryFast (shallower text understanding). */
  astPipelineDegraded?: boolean;
  /**
   * Lowercased substrings; if any appear in title/category/brand, relevance is forced to 0.
   * Used for mix-and-match: user "no leather", "without stripes", etc.
   */
  negationExcludeTerms?: string[];
  /**
   * When true, prompt-derived type/color requirements cap relevance for non-compliant hits
   * (mix-and-match: text instructions must restrict what appears).
   */
  enforcePromptConstraints?: boolean;
  /** Colors in desired* came from the text query (AST), not from image extraction alone. */
  promptAnchoredColorIntent?: boolean;
  /** Product types came from prompt/AST/lexical seeds, not only from vision model category fallback. */
  promptAnchoredTypeIntent?: boolean;
  /** Image kNN: cap final relevance near cosine similarity (see computeFinalRelevance01). */
  tightSemanticCap?: boolean;
  /**
   * When true, colors in `desiredColors*` come only from soft hints (e.g. auto dominant color on upload).
   * They still affect `colorCompliance` / rerankScore, but must not set `hasColorIntent` in
   * `computeFinalRelevance01` — otherwise a wrong auto-color nukes `finalRelevance01` for visually close items.
   */
  softColorBiasOnly?: boolean;
  /**
   * Whether type intent is reliable enough to act as a hard gate in final relevance.
   * False for weak inferred hints (e.g. image-only predicted aisle); true for explicit
   * text/filter/product-type constraints.
   */
  reliableTypeIntent?: boolean;
}

export interface HitCompliance {
  productTypeCompliance: number;
  exactTypeScore: number;
  siblingClusterScore: number;
  parentHypernymScore: number;
  intraFamilyPenalty: number;
  colorCompliance: number;
  matchedColor: string | null;
  colorTier: "exact" | "family" | "bucket" | "none";
  crossFamilyPenalty: number;
  audienceCompliance: number;
  styleCompliance: number;
  sleeveCompliance: number;
  osSimilarity01: number;
  categoryRelevance01: number;
  semanticScore01: number;
  lexicalScore01: number;
  rerankScore: number;
  finalRelevance01: number;
  visualComponent?: number;
  typeComponent?: number;
  attrComponent?: number;
  penaltyComponent?: number;
  /** Dev / explain: type gate and intent trace */
  hasTypeIntent?: boolean;
  hasColorIntent?: boolean;
  hasSleeveIntent?: boolean;
  hasLengthIntent?: boolean;
  typeGateFactor?: number;
  hardBlocked?: boolean;
  /** False when lexical score is not a separate signal (e.g. image-only kNN): omit from API explain. */
  lexicalScoreDistinct?: boolean;
}

function normalizeTextForTokenMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegexToken(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Lexical proxy when BM25 is not exposed separately (share of query tokens as whole words in title). */
export function scoreTitleLexicalOverlap01(query: string, title: string): number {
  const qNorm = normalizeTextForTokenMatch(query);
  const tokens = qNorm.split(/\s+/).filter((t) => t.length >= 2);
  if (tokens.length === 0) return 1;
  const tNorm = normalizeTextForTokenMatch(title);
  let matched = 0;
  for (const tok of tokens) {
    if (new RegExp(`\\b${escapeRegexToken(tok)}\\b`, "i").test(tNorm)) matched++;
  }
  return Math.max(0, Math.min(1, matched / tokens.length));
}

function normalizeRawTo01(
  raw: number,
  maxRaw: number,
  useTanh: boolean,
  tanhScale: number,
): number {
  const positive = Math.max(0, raw);
  const v = useTanh
    ? Math.tanh(positive / tanhScale)
    : maxRaw > 0
      ? positive / maxRaw
      : 0;
  return Math.max(0, Math.min(1, Math.round(v * 100) / 100));
}

function mergeColorArrays(...parts: unknown[]): string[] {
  const out: string[] = [];
  for (const part of parts) {
    const arr = Array.isArray(part)
      ? part.map((x: unknown) => String(x).toLowerCase())
      : part
        ? [String(part).toLowerCase()]
        : [];
    for (const c of arr) {
      if (c && !out.includes(c)) out.push(c);
    }
  }
  return out;
}

function normalizeSleeveToken(raw: string | undefined): "short" | "long" | "sleeveless" | null {
  if (!raw) return null;
  const s = String(raw).toLowerCase().trim();
  if (!s) return null;
  if (/\b(tank|cami|camisole|sleeveless|strapless|halter|strap top|vest top|spaghetti strap)\b/.test(s)) {
    return "sleeveless";
  }
  if (s.includes("sleeveless")) return "sleeveless";
  if (s.includes("short")) return "short";
  if (s.includes("long")) return "long";
  return null;
}

function inferSleeveFromCatalogSignals(
  src: Record<string, unknown>,
  title: string,
  description: string,
): "short" | "long" | "sleeveless" | null {
  const bag = [
    src.category,
    src.category_canonical,
    ...(Array.isArray(src.product_types) ? src.product_types : []),
    title,
    description,
  ]
    .map((x) => String(x ?? "").toLowerCase())
    .join(" ");

  if (!bag.trim()) return null;

  // Explicit no-sleeve families.
  if (/\b(tank|cami|camisole|halter|strapless|tube top|vest top|spaghetti strap|sleeveless)\b/.test(bag)) {
    return "sleeveless";
  }

  // Type-level defaults when explicit sleeve fields are missing.
  if (/\b(hoodie|hooded|sweater|cardigan|pullover|jacket|coat|parka|trench|blazer|windbreaker|overcoat)\b/.test(bag)) {
    return "long";
  }

  if (/\b(t-?shirt|tee\b|tees\b|polo\b|polo shirt|jersey tee|short sleeve)\b/.test(bag)) {
    return "short";
  }

  return null;
}

function docSupportsSleeveIntent(src: Record<string, unknown>): boolean {
  const bag = [
    src.category,
    src.category_canonical,
    src.title,
    ...(Array.isArray(src.product_types) ? src.product_types : []),
  ]
    .map((x) => String(x ?? "").toLowerCase())
    .join(" ");
  if (!bag.trim()) return true;
  // Bottoms have no sleeves — do not score sleeve compliance (avoids misleading 0 on pants).
  // Use "shorts" not "short" so "short sleeve" / "short dress" on tops & dresses still get sleeve/length logic.
  if (
    /\b(pant|pants|trouser|trousers|jean|jeans|shorts|skirt|skirts|legging|leggings|jogger|joggers|chino|chinos|cargo|cargos|bottom|bottoms)\b/.test(
      bag,
    )
  ) {
    return false;
  }
  if (/\b(shoe|shoes|sneaker|sneakers|boot|boots|sandal|sandals|heel|heels|loafer|loafers)\b/.test(bag)) {
    return false;
  }
  if (/\b(bag|bags|wallet|wallets|belt|belts|hat|hats|cap|caps|scarf|scarves|jewelry|jewellery|ring|rings|earring|earrings|necklace|necklaces|bracelet|bracelets)\b/.test(bag)) {
    return false;
  }
  return true;
}

function rawColorList(...parts: unknown[]): string[] {
  return [
    ...new Set(
      mergeColorArrays(...parts)
        .map((c: string) => String(c).toLowerCase().trim())
        .filter(Boolean),
    ),
  ];
}

function extractColorHintsFromProductUrl(productUrl: unknown): string[] {
  const raw = String(productUrl ?? "").trim();
  if (!raw) return [];

  const hints = new Set<string>();
  const push = (v: string | null | undefined) => {
    const s = String(v ?? "")
      .toLowerCase()
      .replace(/[+_]/g, " ")
      .replace(/%20/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!s) return;
    hints.add(s);
    const norm = normalizeColorToken(s);
    if (norm) hints.add(norm);
  };

  // Handle both query params and fragment params, e.g. ?color=white or #color=off%20white.
  const candidate = raw.replace(/^#/, "");
  const qIdx = candidate.indexOf("?");
  const hIdx = candidate.indexOf("#");
  const queryPart = qIdx >= 0 ? candidate.slice(qIdx + 1, hIdx >= 0 && hIdx > qIdx ? hIdx : undefined) : "";
  const hashPart = hIdx >= 0 ? candidate.slice(hIdx + 1) : (qIdx < 0 ? candidate : "");

  const parsePart = (part: string) => {
    if (!part) return;
    for (const segment of part.split("&")) {
      const [kRaw, vRaw] = segment.split("=");
      const k = decodeURIComponent(String(kRaw ?? "")).toLowerCase().trim();
      const v = decodeURIComponent(String(vRaw ?? "")).trim();
      if (!k || !v) continue;
      if (k === "color" || k === "colour" || k === "variant" || k === "shade") push(v);
    }
  };

  parsePart(queryPart);
  parsePart(hashPart);
  return [...hints];
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function confidenceBlend(score: number, confidence: number, neutralFloor: number): number {
  const s = clamp01(score);
  const c = clamp01(confidence);
  const floor = clamp01(neutralFloor);
  return s * c + floor * (1 - c);
}

/**
 * Full text-search-equivalent compliance + rerank + final relevance for one OpenSearch hit.
 */
export function computeHitRelevance(
  hit: { _source?: Record<string, unknown> },
  similarity: number,
  intent: SearchHitRelevanceIntent,
): HitCompliance & { primaryColor: string | null } {
  const src = hit?._source ?? {};
  const {
    desiredProductTypes,
    desiredColors,
    desiredColorsTier,
    desiredStyle,
    desiredPattern, // new
    desiredSleeve,
    rerankColorMode,
    mergedCategory,
    astCategories,
    queryAgeGroup,
    audienceGenderForScoring,
    hasAudienceIntent,
    crossFamilyPenaltyWeight,
    lexicalMatchQuery,
    hybridScoreRecall,
    negationExcludeTerms,
    enforcePromptConstraints,
    promptAnchoredColorIntent,
    promptAnchoredTypeIntent,
    tightSemanticCap,
    softColorBiasOnly,
  } = intent;

  const productTypesRaw = hit?._source?.product_types;
  let productTypes: string[] = Array.isArray(productTypesRaw)
    ? productTypesRaw.map((x: unknown) => String(x).toLowerCase())
    : productTypesRaw
      ? [String(productTypesRaw).toLowerCase()]
      : [];
  if (productTypes.length > 0) {
    const mappedDocCategory =
      typeof hit?._source?.category_canonical === "string"
        ? String(hit._source.category_canonical).toLowerCase().trim()
        : typeof hit?._source?.category === "string"
          ? String(hit._source.category).toLowerCase().trim()
          : "";
    const filtered = filterProductTypeSeedsByMappedCategory(productTypes, mappedDocCategory);
    if (filtered.length > 0) productTypes = filtered;
  }

  const attrColorsRaw = hit?._source?.attr_colors;
  const attrText = hit?._source?.attr_colors_text;
  const attrImg = hit?._source?.attr_colors_image;

  let imgTierRaw = rawColorList(hit?._source?.color_palette_canonical, attrImg);
  let textTierRaw = rawColorList(attrText);
  let unionTierRaw = rawColorList(
    hit?._source?.color_palette_canonical,
    attrColorsRaw,
    attrText,
    attrImg,
    hit?._source?.color_primary_canonical,
    hit?._source?.color_secondary_canonical,
    hit?._source?.color_accent_canonical,
  );

  if (unionTierRaw.length === 0 && hit?._source?.attr_color) {
    unionTierRaw = rawColorList(hit._source.attr_color);
  }

  if (unionTierRaw.length === 0) {
    const urlColorHints = extractColorHintsFromProductUrl(hit?._source?.product_url);
    if (urlColorHints.length > 0) {
      unionTierRaw = rawColorList(urlColorHints);
      if (textTierRaw.length === 0) {
        textTierRaw = rawColorList(urlColorHints);
      }
    }
  }

  if (unionTierRaw.length === 0 && typeof hit?._source?.title === "string") {
    const inferred = extractAttributesSync(String(hit._source.title));
    const inferredColors =
      inferred.attributes.colors && inferred.attributes.colors.length > 0
        ? inferred.attributes.colors
        : inferred.attributes.color
          ? [inferred.attributes.color]
          : [];
    for (const c of inferredColors) {
      const x = String(c).toLowerCase().trim();
      if (x && !unionTierRaw.includes(x)) unionTierRaw.push(x);
    }
    if (textTierRaw.length === 0 && inferredColors.length > 0) {
      textTierRaw = rawColorList(inferredColors);
    }
  }

  const productColors = [
    ...new Set(unionTierRaw.map((c) => normalizeColorToken(c) ?? c).filter(Boolean)),
  ];

  const primaryColor = hit?._source?.color_primary_canonical
    ? String(hit._source.color_primary_canonical).toLowerCase()
    : hit?._source?.attr_color
      ? String(hit._source.attr_color).toLowerCase()
      : productColors.length > 0
        ? productColors[0]
        : null;

  let productTypeCompliance = 0;
  let exactTypeScore = 0;
  let siblingClusterScore = 0;
  let parentHypernymScore = 0;
  let intraFamilyPenalty = 0;
  if (desiredProductTypes.length > 0) {
    const typeBreak = scoreRerankProductTypeBreakdown(desiredProductTypes, productTypes);
    productTypeCompliance = typeBreak.combinedTypeCompliance;
    exactTypeScore = typeBreak.exactTypeScore;
    siblingClusterScore = typeBreak.siblingClusterScore;
    parentHypernymScore = typeBreak.parentHypernymScore;
    intraFamilyPenalty = typeBreak.intraFamilyPenalty;

    const docCategoryRaw =
      typeof hit?._source?.category === "string" ? hit._source.category : undefined;
    const spurious = downrankSpuriousProductTypeFromCategory(
      desiredProductTypes,
      productTypes,
      docCategoryRaw,
    );
    if (spurious.forceExactZero) exactTypeScore = 0;
    productTypeCompliance = Math.max(
      0,
      Math.min(1, productTypeCompliance * spurious.complianceScale),
    );
  }

  const wcText = Number(hit?._source?.color_confidence_text);
  const wcImg = Number(hit?._source?.color_confidence_image);
  const wText = Number.isFinite(wcText) && wcText > 0 ? wcText : 0;
  const wImg = Number.isFinite(wcImg) && wcImg > 0 ? wcImg : 0;
  const wSum = wText + wImg + 1e-6;
  const wtImg = wImg / wSum;
  const wtText = wText / wSum;

  let colorCompliance = 0;
  let matchedColor: string | null = null;
  let colorTier: "exact" | "family" | "bucket" | "none" = "none";
  if (desiredColorsTier.length > 0) {
    const tImg = tieredColorListCompliance(desiredColorsTier, imgTierRaw, rerankColorMode);
    const tText = tieredColorListCompliance(desiredColorsTier, textTierRaw, rerankColorMode);
    const tUnion = tieredColorListCompliance(desiredColorsTier, unionTierRaw, rerankColorMode);
    matchedColor = tUnion.bestMatch ?? tImg.bestMatch ?? tText.bestMatch;
    colorTier = tUnion.tier;
    if (imgTierRaw.length > 0 && textTierRaw.length > 0) {
      colorCompliance = wtImg * tImg.compliance + wtText * tText.compliance;
    } else if (imgTierRaw.length > 0) {
      colorCompliance = tImg.compliance;
      matchedColor = tImg.bestMatch ?? matchedColor;
      colorTier = tImg.tier;
    } else if (textTierRaw.length > 0) {
      colorCompliance = tText.compliance;
      matchedColor = tText.bestMatch ?? matchedColor;
      colorTier = tText.tier;
    } else {
      colorCompliance = tUnion.compliance;
    }
  }

  // Guardrail: if catalog color explicitly contradicts desired color, do not allow
  // image-palette/text color extraction to claim an "exact" match.
  const catalogColorRaw = typeof hit?._source?.color === "string" ? String(hit._source.color).toLowerCase() : "";
  const catalogColorNorm = catalogColorRaw ? normalizeColorToken(catalogColorRaw) ?? catalogColorRaw : "";
  if (desiredColorsTier.length > 0 && catalogColorNorm) {
    const tCatalog = tieredColorListCompliance(desiredColorsTier, [catalogColorNorm], rerankColorMode);
    if (tCatalog.compliance <= 0) {
      // Hard safety: when catalog color contradicts desired color, never allow
      // inferred palette/text signals to look like a strong color match.
      colorCompliance = 0;
      if (colorTier === "exact") colorTier = "none";
      // Keep `matchedColor` tied to query-vs-hit match evidence only; do not replace it
      // with catalog color, otherwise explain output can look like query color was rewritten.
    }
  }

  const docCategoryForPenalty =
    typeof hit?._source?.category === "string" ? hit._source.category : undefined;
  const docCanonicalForPenalty =
    typeof hit?._source?.category_canonical === "string"
      ? hit._source.category_canonical
      : undefined;

  let crossFamilyPenalty =
    desiredProductTypes.length > 0
      ? scoreCrossFamilyTypePenalty(desiredProductTypes, productTypes, {
          category: docCategoryForPenalty,
          categoryCanonical: docCanonicalForPenalty,
        })
      : 0;

  // Style compliance: keyword match on indexed `attr_style`.
  // We keep this intentionally simple so it works well with `keyword` fields.
  const normalizedDesiredStyle = desiredStyle ? String(desiredStyle).toLowerCase().trim() : "";
  const hitStyleRaw = hit?._source?.attr_style;
  const hitStyle = typeof hitStyleRaw === "string" ? hitStyleRaw.toLowerCase().trim() : "";
  const title = typeof hit?._source?.title === "string" ? hit._source.title.toLowerCase() : "";

  let styleCompliance = 0;
  if (normalizedDesiredStyle) {
    if (hitStyle) {
      // If explicit indexed style exists, treat mismatch as hard contradiction.
      if (hitStyle === normalizedDesiredStyle) styleCompliance = 1;
      else if (hitStyle.includes(normalizedDesiredStyle) || normalizedDesiredStyle.includes(hitStyle)) styleCompliance = 0.7;
      else styleCompliance = 0;
    } else if (title.includes(normalizedDesiredStyle)) {
      styleCompliance = 0.6;
    } else {
      styleCompliance = 0;
    }
  }

  // Pattern compliance (new, similar to style)
  let patternCompliance = 0;
  const normalizedDesiredPattern = desiredPattern ? String(desiredPattern).toLowerCase().trim() : "";
  const hitPatternRaw = hit?._source?.attr_pattern;
  const hitPattern = typeof hitPatternRaw === "string" ? hitPatternRaw.toLowerCase().trim() : "";
  if (normalizedDesiredPattern) {
    if (hitPattern) {
      if (hitPattern === normalizedDesiredPattern) patternCompliance = 1;
      else if (hitPattern.includes(normalizedDesiredPattern) || normalizedDesiredPattern.includes(hitPattern)) patternCompliance = 0.7;
      else patternCompliance = 0;
    } else if (title.includes(normalizedDesiredPattern)) {
      patternCompliance = 0.6;
    } else {
      patternCompliance = 0;
    }
  }

  let sleeveCompliance = 0;
  const wantedSleeve = normalizeSleeveToken(desiredSleeve);
  const sleeveIntentApplicable = docSupportsSleeveIntent(src);
  const hasSleeveIntentForDoc = Boolean(wantedSleeve) && sleeveIntentApplicable;
  if (hasSleeveIntentForDoc) {
    const description = typeof hit?._source?.description === "string" ? hit._source.description : "";
    const docSleeveRaw =
      typeof hit?._source?.attr_sleeve === "string"
        ? hit._source.attr_sleeve
        : typeof hit?._source?.sleeve === "string"
          ? hit._source.sleeve
          : `${description}`;
    const docSleeve = normalizeSleeveToken(docSleeveRaw);
    const titleSleeve = normalizeSleeveToken(title);
    const observed = docSleeve ?? titleSleeve ?? normalizeSleeveToken(description);
    const inferredObserved =
      observed ?? inferSleeveFromCatalogSignals(src, title, description);

    if (!inferredObserved) {
      sleeveCompliance = 0.15;
    } else if (inferredObserved === wantedSleeve) {
      // Inferred sleeve from type/category cues is weaker than explicit sleeve metadata.
      sleeveCompliance = observed ? 1 : 0.62;
    } else if (!observed) {
      // Avoid hard contradiction penalty when mismatch comes from heuristic inference only.
      sleeveCompliance = 0.12;
    } else if (docSleeve) {
      sleeveCompliance = 0;
    } else {
      sleeveCompliance = 0.15;
    }
  }

  const audienceCompliance = scoreAudienceCompliance(
    queryAgeGroup,
    audienceGenderForScoring,
    hit,
  );

  const categoryRelevance01 = scoreCategoryRelevance01(
    mergedCategory,
    astCategories,
    hit?._source?.category,
    hit?._source?.category_canonical,
  );

  /** Garment/footwear image intent vs makeup/skincare listing — CLIP is often high on shared skintone/packaging cues. */
  const garmentVersusBeautyPenalty = (() => {
    const raw = Number(process.env.SEARCH_BEAUTY_APPAREL_CROSS_PENALTY ?? "0.92");
    const p = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0.92;
    if (p <= 0) return 0;
    if (!desiredProductTypes.length) return 0;
    if (!hasGarmentLikeFamilyFromProductTypeSeeds(desiredProductTypes)) return 0;
    if (!isBeautyRetailListingFromFields(src.category, src.category_canonical)) return 0;
    return p;
  })();
  crossFamilyPenalty = Math.max(crossFamilyPenalty, garmentVersusBeautyPenalty);

  // General fallback: if the index misses/undercounts `product_types`, recover
  // type compliance from lexical evidence in title+description.
  // Only when there is an actual user/search lexical query: for pure image search
  // (vision-derived type seeds, no text), title overlap creates false type matches
  // and floats irrelevant products above true kNN neighbors.
  if (
    desiredProductTypes.length > 0 &&
    productTypeCompliance < 0.2 &&
    lexicalMatchQuery?.trim()
  ) {
    const typeTextFallbackWeightRaw = Number(
      process.env.SEARCH_TYPE_TEXT_FALLBACK_WEIGHT ?? "0.25",
    );
    const typeTextFallbackWeight =
      Number.isFinite(typeTextFallbackWeightRaw) && typeTextFallbackWeightRaw > 0
        ? Math.min(1, typeTextFallbackWeightRaw)
        : 0.25;

    const desiredTypesText = desiredProductTypes.join(" ");
    const title = typeof src.title === "string" ? src.title : "";
    const description = typeof src.description === "string" ? src.description : "";
    const hitText = `${title} ${description}`.trim();

    const typeTextOverlap01 =
      hitText.length > 0
        ? scoreTitleLexicalOverlap01(desiredTypesText, hitText)
        : 0;
    const categoryAgreed01 = categoryRelevance01 ?? 0;
    const candidateTypeCompliance = typeTextOverlap01 * categoryAgreed01;
    const effectiveTypeCompliance = Math.max(
      productTypeCompliance,
      candidateTypeCompliance * typeTextFallbackWeight,
    );

    productTypeCompliance = effectiveTypeCompliance;
  }

  const recall = hybridScoreRecall;
  let semScore01 = similarity;
  let lexScore01 = similarity;
  if (
    recall?.hasSplitScores &&
    recall.maxClip > 0 &&
    recall.maxBm25 > 0 &&
    src.clip_score != null &&
    src.bm25_score != null
  ) {
    semScore01 = normalizeRawTo01(
      Number(src.clip_score),
      recall.maxClip,
      recall.useTanhSim,
      recall.tanhScale,
    );
    lexScore01 = normalizeRawTo01(
      Number(src.bm25_score),
      recall.maxBm25,
      recall.useTanhSim,
      recall.tanhScale,
    );
  } else {
    const qLex = lexicalMatchQuery?.trim();
    if (qLex) {
      lexScore01 = scoreTitleLexicalOverlap01(qLex, String(src.title ?? ""));
    }
  }

  const hasOsSplitLex =
    Boolean(recall?.hasSplitScores) &&
    (recall?.maxClip ?? 0) > 0 &&
    (recall?.maxBm25 ?? 0) > 0 &&
    src.clip_score != null &&
    src.bm25_score != null;
  const lexicalScoreDistinct = hasOsSplitLex || Boolean(lexicalMatchQuery?.trim());

  const normDoc = Number(hit?._source?.norm_confidence);
  const docTrustNorm =
    Number.isFinite(normDoc) && normDoc >= 0 && normDoc <= 1 ? 0.55 + 0.45 * normDoc : 0.92;
  const typeDoc = Number(hit?._source?.type_confidence);
  const typeDocTrust =
    Number.isFinite(typeDoc) && typeDoc >= 0 && typeDoc <= 1 ? 0.45 + 0.55 * typeDoc : 1;
  const docTrust = Math.max(0.25, Math.min(1, docTrustNorm * typeDocTrust));

  const typeMetadataConfidence = clamp01(
    Number.isFinite(typeDoc) && typeDoc >= 0 && typeDoc <= 1
      ? typeDoc
      : Number.isFinite(normDoc) && normDoc >= 0 && normDoc <= 1
        ? normDoc
        : 0.72,
  );
  const colorMetadataConfidence = clamp01(
    Math.max(
      Number.isFinite(wcText) ? wcText : 0,
      Number.isFinite(wcImg) ? wcImg : 0,
      Number.isFinite(normDoc) && normDoc >= 0 && normDoc <= 1 ? normDoc * 0.9 : 0,
      0.58,
    ),
  );
  const styleMetadataConfidence = clamp01(
    Number.isFinite(normDoc) && normDoc >= 0 && normDoc <= 1 ? normDoc * 0.95 : 0.62,
  );

  const wSim = rerankSimilarityWeight();
  const wAud = rerankAudienceWeight();
  const typeComponent = productTypeCompliance * 420 * docTrust;
  const hasTypeIntent = desiredProductTypes.length > 0;
  // Prevent non-type attributes from overpowering clear crop/type intent when type compliance is weak.
  const attrTypeGate = !hasTypeIntent
    ? 1
    : productTypeCompliance >= 0.5
      ? 1
      : productTypeCompliance >= 0.2
        ? 0.35
        : 0.08;
  const attrComponentRaw =
    colorCompliance * 90 * docTrust +
    styleCompliance * 65 * docTrust +
    patternCompliance * 40 * docTrust + // new
    sleeveCompliance * 52 * docTrust +
    audienceCompliance * wAud * docTrust;
  const attrComponent = attrComponentRaw * attrTypeGate;
  // Similarity term strengthened and modulated by type compliance.
  const visualComponent =
    similarity * (wSim + 120 * (0.35 + 0.65 * productTypeCompliance));
  const penaltyComponent = crossFamilyPenalty * crossFamilyPenaltyWeight;
  const rerankScore = typeComponent + attrComponent + visualComponent - penaltyComponent;

  const hasReliableTypeIntent = hasTypeIntent && intent.reliableTypeIntent !== false;
  const hasColorIntent = desiredColors.length > 0;
  /** Soft-only auto colors must not gate final acceptance the same as user `filters.color`. */
  const hasColorIntentForFinalRelevance = hasColorIntent && !softColorBiasOnly;
  const typeScoreForFinal = hasReliableTypeIntent
    ? confidenceBlend(productTypeCompliance, typeMetadataConfidence, 0.38)
    : productTypeCompliance;
  const colorScoreForFinal = hasColorIntentForFinalRelevance
    ? confidenceBlend(colorCompliance, colorMetadataConfidence, 0.34)
    : colorCompliance;
  const styleScoreForFinal = normalizedDesiredStyle
    ? confidenceBlend(styleCompliance, styleMetadataConfidence, 0.32)
    : styleCompliance;
  const patternScoreForFinal = normalizedDesiredPattern
    ? confidenceBlend(patternCompliance, styleMetadataConfidence, 0.32)
    : patternCompliance;
  const sleeveScoreForFinal = hasSleeveIntentForDoc
    ? confidenceBlend(sleeveCompliance, styleMetadataConfidence, 0.28)
    : sleeveCompliance;
  const crossFamilyPenaltyForFinal = hasReliableTypeIntent
    ? crossFamilyPenalty * (0.55 + 0.45 * typeMetadataConfidence)
    : crossFamilyPenalty;
  const crossPenTrace = Math.max(0, crossFamilyPenaltyForFinal);
  const hardBlocked = hasReliableTypeIntent && crossPenTrace >= 0.8;
  const typeGateFactor = !hasReliableTypeIntent
    ? 1
    : productTypeCompliance >= 0.5
      ? 1
      : productTypeCompliance >= 0.2
        ? 0.3
        : 0.05;

  let finalRelevance01 = computeFinalRelevance01({
    hasTypeIntent,
    hasReliableTypeIntent,
    typeScore: typeScoreForFinal,
    catScore: categoryRelevance01,
    semScore: semScore01,
    lexScore: lexScore01,
    colorScore: colorScoreForFinal,
    audScore: audienceCompliance,
    styleScore: styleScoreForFinal,
    patternScore: patternScoreForFinal, // new
    sleeveScore: sleeveScoreForFinal,
    hasColorIntent: hasColorIntentForFinalRelevance,
    hasStyleIntent: Boolean(normalizedDesiredStyle),
    hasPatternIntent: Boolean(normalizedDesiredPattern), // new
    hasSleeveIntent: hasSleeveIntentForDoc,
    hasAudienceIntent,
    crossFamilyPenalty: crossFamilyPenaltyForFinal,
    intraFamilyPenalty,
    applyLexicalToGlobal: lexicalScoreDistinct,
    tightSemanticCap,
  });

  if (garmentVersusBeautyPenalty >= 0.85) {
    finalRelevance01 = Math.min(finalRelevance01, semScore01 * 0.22);
  }

  // Precision safety for image-led fashion retrieval:
  // when bottoms/footwear color intent is present, mismatched color should not survive
  // as a strong final match even if visual similarity is high.
  const intentBlob = [
    mergedCategory ?? "",
    ...(Array.isArray(astCategories) ? astCategories : []),
    ...(Array.isArray(desiredProductTypes) ? desiredProductTypes : []),
  ]
    .map((x) => String(x).toLowerCase())
    .join(" ");
  const isBottomLikeIntent =
    /\b(bottom|bottoms|pants?|trousers?|jeans?|shorts?|skirt|skirts|leggings?)\b/.test(intentBlob);
  const isFootwearLikeIntent =
    /\b(footwear|shoe|shoes|sneaker|sneakers|boot|boots|loafer|loafers|heel|heels|sandal|sandals)\b/.test(intentBlob);
  if (hasColorIntentForFinalRelevance && (isBottomLikeIntent || isFootwearLikeIntent)) {
    if (colorTier === "none") {
      finalRelevance01 = Math.min(finalRelevance01, isBottomLikeIntent ? 0.06 : 0.08);
    } else if (colorCompliance < 0.2) {
      finalRelevance01 = Math.min(finalRelevance01, isBottomLikeIntent ? 0.1 : 0.12);
    } else if (isBottomLikeIntent && colorTier === "bucket") {
      // Bottom color is high-value for perceived similarity; bucket-level match is
      // acceptable but should not be treated as near-exact.
      finalRelevance01 = Math.min(finalRelevance01, 0.32);
    }
  }

  let negationBlocked = false;
  if (negationExcludeTerms && negationExcludeTerms.length > 0) {
    const desc = typeof src.description === "string" ? src.description : "";
    const blob = [src.title, src.category, src.brand, desc]
      .filter((x) => x != null && String(x).trim() !== "")
      .join(" ")
      .toLowerCase();
    negationBlocked = negationExcludeTerms.some((term) => {
      const t = String(term).toLowerCase().trim();
      return t.length >= 2 && blob.includes(t);
    });
    if (negationBlocked) {
      finalRelevance01 = 0;
    }
  }

  if (!negationBlocked && enforcePromptConstraints) {
    if (promptAnchoredColorIntent && hasColorIntent && colorTier === "none") {
      finalRelevance01 = Math.min(finalRelevance01, 0.03);
    }
    if (promptAnchoredTypeIntent && hasTypeIntent && productTypeCompliance < 0.3) {
      finalRelevance01 = Math.min(finalRelevance01, 0.04);
    }
  }

  return {
    productTypeCompliance,
    exactTypeScore,
    siblingClusterScore,
    parentHypernymScore,
    intraFamilyPenalty,
    colorCompliance,
    matchedColor,
    colorTier,
    crossFamilyPenalty,
    audienceCompliance,
    styleCompliance,
    sleeveCompliance,
    osSimilarity01: similarity,
    categoryRelevance01,
    semanticScore01: semScore01,
    lexicalScore01: lexScore01,
    rerankScore,
    finalRelevance01,
    visualComponent,
    typeComponent,
    attrComponent,
    penaltyComponent,
    primaryColor,
    hasTypeIntent,
    hasColorIntent: hasColorIntentForFinalRelevance,
    hasSleeveIntent: hasSleeveIntentForDoc,
    typeGateFactor,
    hardBlocked: hardBlocked || negationBlocked,
    lexicalScoreDistinct,
  };
}
