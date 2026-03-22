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
 * Calibrated 0..1 relevance for acceptance gating (SEARCH_FINAL_ACCEPT_MIN).
 * Multiplicative blend: type gate × text relevance × category boost × attribute factor.
 */
export function computeFinalRelevance01(params: {
  hasTypeIntent: boolean;
  typeScore: number;
  catScore: number;
  semScore: number;
  lexScore: number;
  colorScore: number;
  audScore: number;
  hasColorIntent: boolean;
  hasAudienceIntent: boolean;
}): number {
  const typeGate = params.hasTypeIntent ? (params.typeScore >= 0.5 ? 1 : 0) : 1;
  const categoryBoost = 1 + params.catScore * 0.3;
  const textRelevance = params.semScore * 0.6 + params.lexScore * 0.4;
  const colorPart = params.hasColorIntent ? params.colorScore : 1;
  const audPart = params.hasAudienceIntent ? params.audScore : 1;
  const attrMultiplier = Math.min(1, colorPart * 0.5 + audPart * 0.5);
  const attrFactor = 0.5 + attrMultiplier * 0.5;
  const raw = typeGate * textRelevance * categoryBoost * attrFactor;
  return Math.max(0, Math.min(1, raw));
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

export interface SearchHitRelevanceIntent {
  desiredProductTypes: string[];
  desiredColors: string[];
  desiredColorsTier: string[];
  rerankColorMode: "any" | "all";
  mergedCategory?: string;
  astCategories: string[];
  queryAgeGroup?: string;
  /** Second argument to audience scoring (text: normalizeQueryGender(merged.gender) ?? merged.gender). */
  audienceGenderForScoring?: string;
  hasAudienceIntent: boolean;
  crossFamilyPenaltyWeight: number;
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
  osSimilarity01: number;
  categoryRelevance01: number;
  semanticScore01: number;
  lexicalScore01: number;
  rerankScore: number;
  finalRelevance01: number;
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
    rerankColorMode,
    mergedCategory,
    astCategories,
    queryAgeGroup,
    audienceGenderForScoring,
    hasAudienceIntent,
    crossFamilyPenaltyWeight,
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
  const semScore01 = similarity;
  const lexScore01 = similarity;

  const normDoc = Number(hit?._source?.norm_confidence);
  const docTrustNorm =
    Number.isFinite(normDoc) && normDoc >= 0 && normDoc <= 1 ? 0.55 + 0.45 * normDoc : 0.92;
  const typeDoc = Number(hit?._source?.type_confidence);
  const typeDocTrust =
    Number.isFinite(typeDoc) && typeDoc >= 0 && typeDoc <= 1 ? 0.45 + 0.55 * typeDoc : 1;
  const docTrust = Math.max(0.25, Math.min(1, docTrustNorm * typeDocTrust));

  const rerankScore =
    productTypeCompliance * 1000 * docTrust +
    colorCompliance * 100 * docTrust +
    audienceCompliance * 80 * docTrust +
    similarity * 10 -
    crossFamilyPenalty * crossFamilyPenaltyWeight;

  const finalRelevance01 = computeFinalRelevance01({
    hasTypeIntent: desiredProductTypes.length > 0,
    typeScore: productTypeCompliance,
    catScore: categoryRelevance01,
    semScore: semScore01,
    lexScore: lexScore01,
    colorScore: colorCompliance,
    audScore: audienceCompliance,
    hasColorIntent: desiredColors.length > 0,
    hasAudienceIntent,
  });

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
    osSimilarity01: similarity,
    categoryRelevance01,
    semanticScore01: semScore01,
    lexicalScore01: lexScore01,
    rerankScore,
    finalRelevance01,
    primaryColor,
  };
}
