/**
 * Per-hit compliance + final relevance (shared by text search and image kNN search).
 */
import { getCategorySearchTerms } from "./categoryFilter";
import {
  downrankSpuriousProductTypeFromCategory,
  scoreCrossFamilyTypePenalty,
  scoreRerankProductTypeBreakdown,
} from "./productTypeTaxonomy";
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
  typeScore: number;
  catScore: number;
  semScore: number;
  lexScore: number;
  colorScore: number;
  audScore: number;
  styleScore: number;
  hasColorIntent: boolean;
  hasStyleIntent: boolean;
  hasAudienceIntent: boolean;
  /** From scoreCrossFamilyTypePenalty; strong garment↔footwear mismatches are typically ≥ 0.8 */
  crossFamilyPenalty: number;
  /**
   * When false, the global term is semantic-only (image-only kNN or no lexical query).
   * Avoids 0.6·sem + 0.4·lex collapsing to sem while still exposing the same number twice in explain.
   */
  applyLexicalToGlobal?: boolean;
  /** Image similar-search: keep final relevance closer to raw cosine so weak visuals cannot rank as strong matches. */
  tightSemanticCap?: boolean;
}): number {
  const crossPen = Math.max(0, params.crossFamilyPenalty);
  if (params.hasTypeIntent && crossPen >= 0.8) {
    return 0;
  }

  const typeGateFactor = !params.hasTypeIntent
    ? 1
    : params.typeScore >= 0.5
      ? 1
      : params.typeScore >= 0.2
        ? 0.3
        : 0.05;

  const categoryBoost = 1 + params.catScore * 0.25;
  const applyLex = params.applyLexicalToGlobal !== false;
  const globalScore = applyLex
    ? params.semScore * 0.6 + params.lexScore * 0.4
    : params.semScore;

  const colorPart = params.hasColorIntent ? params.colorScore : 1;
  const audPart = params.hasAudienceIntent ? params.audScore : 1;
  const stylePart = params.hasStyleIntent ? params.styleScore : 1;
  // Attribute blend: keep color dominant, but allow style to influence as well.
  const attrScore = colorPart * 0.5 + stylePart * 0.3 + audPart * 0.2;
  const attrFactor = 0.5 + attrScore * 0.5;

  const crossFamilySoftFactor = Math.max(0, 1 - crossPen * 0.6);

  const raw =
    globalScore * typeGateFactor * categoryBoost * attrFactor * crossFamilySoftFactor;
  const bounded = Math.max(0, Math.min(1, raw));
  // Prevent final relevance from being unrealistically higher than visual/semantic evidence.
  // This keeps type/category/attribute boosts important but not dominant enough to mask bad similarity.
  const hasIntent =
    params.hasTypeIntent || params.hasColorIntent || params.hasStyleIntent || params.hasAudienceIntent;
  const capBonus = params.tightSemanticCap
    ? hasIntent
      ? 0.035
      : 0.07
    : hasIntent
      ? 0.08
      : 0.15;
  const softCap = Math.min(1, params.semScore + capBonus);
  return Math.min(bounded, softCap);
}

export function normalizeQueryGender(g: string | undefined): string | null {
  if (!g) return null;
  const x = g.toLowerCase();
  if (x === "men" || x === "women" || x === "unisex") return x;
  return null;
}

function docAgeGroup(hit: { _source?: Record<string, unknown> }): string | null {
  const raw = hit?._source?.age_group;
  if (raw === undefined || raw === null) return null;
  return String(raw).toLowerCase().trim() || null;
}

function docAudienceGender(hit: { _source?: Record<string, unknown> }): string | null {
  const raw = hit?._source?.audience_gender ?? hit?._source?.attr_gender;
  if (raw === undefined || raw === null) return null;
  const s = String(raw).toLowerCase().trim();
  if (s === "men" || s === "women" || s === "unisex") return s;
  return null;
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

  let score = 1;
  let factors = 0;

  if (wantAge) {
    factors += 1;
    if (!docAge) {
      if (wantAge === "kids" && /\b(kids?|child|children|boys?|girls?|toddler|baby|youth)\b/.test(title)) {
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
      score *= 0.38;
    }
  }

  if (wantG) {
    factors += 1;
    if (!docG) {
      if (wantG === "men" && /\b(men|mens|male)\b/.test(title)) score *= 0.9;
      else if (wantG === "women" && /\b(women|womens|female|ladies)\b/.test(title)) score *= 0.9;
      else score *= 0.78;
    } else if (docG === "unisex" || docG === wantG) {
      score *= 1;
    } else {
      score *= 0.35;
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

function rawColorList(...parts: unknown[]): string[] {
  return [
    ...new Set(
      mergeColorArrays(...parts)
        .map((c: string) => String(c).toLowerCase().trim())
        .filter(Boolean),
    ),
  ];
}

/**
 * Full text-search-equivalent compliance + rerank + final relevance for one OpenSearch hit.
 */
export function computeHitRelevance(
  hit: { _source?: Record<string, unknown> },
  similarity: number,
  intent: SearchHitRelevanceIntent,
): HitCompliance & { primaryColor: string | null } {
  const {
    desiredProductTypes,
    desiredColors,
    desiredColorsTier,
    desiredStyle,
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
  } = intent;

  const productTypesRaw = hit?._source?.product_types;
  const productTypes: string[] = Array.isArray(productTypesRaw)
    ? productTypesRaw.map((x: unknown) => String(x).toLowerCase())
    : productTypesRaw
      ? [String(productTypesRaw).toLowerCase()]
      : [];

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

  const crossFamilyPenalty =
    desiredProductTypes.length > 0
      ? scoreCrossFamilyTypePenalty(desiredProductTypes, productTypes)
      : 0;

  // Style compliance: keyword match on indexed `attr_style`.
  // We keep this intentionally simple so it works well with `keyword` fields.
  const normalizedDesiredStyle = desiredStyle ? String(desiredStyle).toLowerCase().trim() : "";
  const hitStyleRaw = hit?._source?.attr_style;
  const hitStyle = typeof hitStyleRaw === "string" ? hitStyleRaw.toLowerCase().trim() : "";
  const title = typeof hit?._source?.title === "string" ? hit._source.title.toLowerCase() : "";

  let styleCompliance = 0;
  if (normalizedDesiredStyle) {
    if (hitStyle === normalizedDesiredStyle) styleCompliance = 1;
    else if (hitStyle && (hitStyle.includes(normalizedDesiredStyle) || normalizedDesiredStyle.includes(hitStyle))) styleCompliance = 0.7;
    else if (title.includes(normalizedDesiredStyle)) styleCompliance = 0.6;
    else styleCompliance = 0;
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

  const src = hit?._source ?? {};

  // General fallback: if the index misses/undercounts `product_types`, recover
  // type compliance from lexical evidence in title+description.
  // This prevents `typeGateFactor` from collapsing relevance to ~0.05.
  if (desiredProductTypes.length > 0 && productTypeCompliance < 0.2) {
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

    // #region agent log
    if (effectiveTypeCompliance > productTypeCompliance) {
      fetch("http://127.0.0.1:7383/ingest/ccea0d1b-4b26-441e-9797-fbae444c347a", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "00a194" },
        body: JSON.stringify({
          sessionId: "00a194",
          runId: "type-fallback-verify",
          hypothesisId: "H-type-fallback",
          location: "searchHitRelevance.ts:productTypeFallback",
          message: "Recovered type compliance from title+description",
          data: {
            productId: src.product_id ?? null,
            desiredTypesText,
            typeTextOverlap01,
            categoryRelevance01,
            oldProductTypeCompliance: productTypeCompliance,
            candidateTypeCompliance,
            typeTextFallbackWeight,
            effectiveTypeCompliance,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
    }
    // #endregion

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

  const wSim = rerankSimilarityWeight();
  const wAud = rerankAudienceWeight();
  const typeComponent = productTypeCompliance * 420 * docTrust;
  const attrComponent =
    colorCompliance * 90 * docTrust +
    styleCompliance * 65 * docTrust +
    audienceCompliance * wAud * docTrust;
  // Similarity term strengthened and modulated by type compliance.
  const visualComponent =
    similarity * (wSim + 120 * (0.35 + 0.65 * productTypeCompliance));
  const penaltyComponent = crossFamilyPenalty * crossFamilyPenaltyWeight;
  const rerankScore = typeComponent + attrComponent + visualComponent - penaltyComponent;

  const hasTypeIntent = desiredProductTypes.length > 0;
  const hasColorIntent = desiredColors.length > 0;
  const crossPenTrace = Math.max(0, crossFamilyPenalty);
  const hardBlocked = hasTypeIntent && crossPenTrace >= 0.8;
  const typeGateFactor = !hasTypeIntent
    ? 1
    : productTypeCompliance >= 0.5
      ? 1
      : productTypeCompliance >= 0.2
        ? 0.3
        : 0.05;

  let finalRelevance01 = computeFinalRelevance01({
    hasTypeIntent,
    typeScore: productTypeCompliance,
    catScore: categoryRelevance01,
    semScore: semScore01,
    lexScore: lexScore01,
    colorScore: colorCompliance,
    audScore: audienceCompliance,
    styleScore: styleCompliance,
    hasColorIntent,
    hasStyleIntent: Boolean(normalizedDesiredStyle),
    hasAudienceIntent,
    crossFamilyPenalty,
    applyLexicalToGlobal: lexicalScoreDistinct,
    tightSemanticCap,
  });

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
    hasColorIntent,
    typeGateFactor,
    hardBlocked: hardBlocked || negationBlocked,
    lexicalScoreDistinct,
  };
}
