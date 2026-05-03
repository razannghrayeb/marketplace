/**
 * Match Tier Assignment System
 *
 * Assigns products to tiers (exact, strong, related, weak, fallback, blocked)
 * based on normalized metadata, contract tier, and FashionIntent alignment.
 *
 * Tier Ranges (min–max score cap):
 *  exact:    0.86–0.96 (tier cap: 0.94) — same family, type, and compatible color
 *  strong:   0.76–0.86 (tier cap: 0.78) — same family + type but subtype/color mismatch
 *  related:  0.62–0.76 (tier cap: 0.74) — same family but different type
 *  weak:     0.45–0.62 (tier cap: 0.55) — same family but significantly different
 *  fallback: 0.30–0.45 (tier cap: 0.40) — uncertain metadata or weak visual match
 *  blocked:  0.00 — known wrong family, hard dropped
 *
 * Canonical rule: Less similar exact item beats more similar wrong/related item.
 * Sorting is by (tier, then finalRelevance01 within tier, then visualSimilarity).
 */

export type MatchTier = "exact" | "strong" | "related" | "weak" | "fallback" | "blocked";

import type { FashionIntent } from "./fashionIntent";
import { defaultConfidence } from "./fashionIntent";
import { colorCompatibility } from "./colorCompatibilityMatrix";

export interface TierAssignmentResult {
  tier: MatchTier;
  reason: string;
  tierCap: number;
}

/**
 * Contract tier from buildSemanticContract (represents how the product entered recall)
 */
export type ContractTier = "exact" | "related" | "weak" | "bad" | "blocked";

/**
 * Normalized product metadata post-hydration
 */
export interface NormalizedProduct {
  normalizedFamily?: string | null;
  normalizedType?: string | null;
  normalizedSubtype?: string | null;
  normalizedColor?: string | null;
  normalizedAudience?: "men" | "women" | "unisex" | "unknown";
  normalizedMaterial?: string | null;
  normalizedStyle?: string | null;
  normalizedOccasion?: string | null;
  normalizedSilhouette?: string | null;
}

/**
 * Build a FashionIntent from simple search intent properties
 * Used during interim phase while detection pipeline is being refactored
 */
export function buildFashionIntentFromSearch(props: {
  family?: string | null;
  type?: string | null;
  subtype?: string | null;
  color?: string | null;
  audience?: "men" | "women" | "unisex" | "unknown";
  style?: string | null;
  material?: string | null;
  /** Confidence that the family was detected (0-1) */
  familyConfidence?: number;
  /** Confidence that the type was detected (0-1) */
  typeConfidence?: number;
  /** Confidence that the color was extracted (0-1) */
  colorConfidence?: number;
  /** Confidence that the audience was inferred (0-1) */
  audienceConfidence?: number;
}): FashionIntent {
  const conf = defaultConfidence();
  
  // Set confidence scores based on inputs or defaults
  if (props.familyConfidence !== undefined) conf.family = Math.max(0, Math.min(1, props.familyConfidence));
  else if (props.family) conf.family = 0.8; // Default family confidence when family provided
  
  if (props.typeConfidence !== undefined) conf.type = Math.max(0, Math.min(1, props.typeConfidence));
  else if (props.type) conf.type = 0.75; // Default type confidence when type provided
  
  if (props.colorConfidence !== undefined) conf.color = Math.max(0, Math.min(1, props.colorConfidence));
  else if (props.color) conf.color = 0.7; // Default color confidence when color provided
  
  if (props.audienceConfidence !== undefined) conf.audience = Math.max(0, Math.min(1, props.audienceConfidence));
  else if (props.audience) conf.audience = 0.7; // Default audience confidence when audience provided
  
  if (props.style) conf.style = 0.6;
  if (props.material) conf.material = 0.6;
  
  return {
    imageMode: "single_product",
    family: (props.family as any) || "unknown",
    type: props.type || "",
    subtype: props.subtype || undefined,
    color: props.color || undefined,
    audience: props.audience || "unknown",
    material: props.material || undefined,
    style: props.style || undefined,
    confidence: conf,
  };
}

/**
 * Assign match tier based on contract tier and normalized metadata alignment with FashionIntent.
 *
 * @param contractTier Tier from buildSemanticContract (exact | related | weak | bad | blocked)
 * @param product Hydrated product with normalized metadata
 * @param intent FashionIntent (structured detection result)
 * @returns Tier assignment with reason and cap
 */
export function assignMatchTier(
  contractTier: ContractTier,
  product: NormalizedProduct,
  intent: FashionIntent
): TierAssignmentResult {
  // Blocked contract tier → blocked
  if (contractTier === "blocked") {
    return {
      tier: "blocked",
      reason: "Blocked by contract (known wrong family or hard-blocked term)",
      tierCap: 0.0,
    };
  }

  // Bad contract tier → weak (product entered via fallback)
  if (contractTier === "bad") {
    const reason = buildTierReason(product, intent, "weak");
    return {
      tier: "weak" as const,
      reason: reason || "Entered via fallback (bad contract tier)",
      tierCap: 0.55,
    };
  }

  // Compute match strength: exact, strong, related, or weak
  const strength = computeMatchStrength(product, intent);

  // Map strength + contract tier to final tier
  if (contractTier === "exact") {
    if (strength === "exact") {
      return {
        tier: "exact",
        reason: buildTierReason(product, intent, "exact") || "Exact family & type match",
        tierCap: 0.94,
      };
    } else if (strength === "strong") {
      return {
        tier: "strong",
        reason: buildTierReason(product, intent, "strong") || "Strong metadata alignment",
        tierCap: 0.78,
      };
    } else if (strength === "related") {
      return {
        tier: "related",
        reason: buildTierReason(product, intent, "related") || "Related type match",
        tierCap: 0.74,
      };
    } else {
      return {
        tier: "weak",
        reason: buildTierReason(product, intent, "weak") || "Weak alignment",
        tierCap: 0.55,
      };
    }
  }

  if (contractTier === "related") {
    if (strength === "exact") {
      return {
        tier: "strong",
        reason: buildTierReason(product, intent, "strong") || "Exact match but related contract tier",
        tierCap: 0.78,
      };
    } else if (strength === "strong") {
      return {
        tier: "related",
        reason: buildTierReason(product, intent, "related") || "Related family & strong match",
        tierCap: 0.74,
      };
    } else if (strength === "related") {
      return {
        tier: "weak",
        reason: buildTierReason(product, intent, "weak") || "Related contract with related strength",
        tierCap: 0.55,
      };
    } else {
      return {
        tier: "fallback",
        reason: buildTierReason(product, intent, "fallback") || "Weak strength on related contract",
        tierCap: 0.40,
      };
    }
  }

  // contractTier === "weak"
  if (strength === "exact") {
    return {
      tier: "related",
      reason: buildTierReason(product, intent, "related") || "Exact match on weak contract",
      tierCap: 0.74,
    };
  } else if (strength === "strong") {
    return {
      tier: "weak",
      reason: buildTierReason(product, intent, "weak") || "Strong match on weak contract",
      tierCap: 0.55,
    };
  } else if (strength === "related") {
    return {
      tier: "fallback",
      reason: buildTierReason(product, intent, "fallback") || "Related match on weak contract",
      tierCap: 0.40,
    };
  } else {
    return {
      tier: "fallback",
      reason: buildTierReason(product, intent, "fallback") || "Weak match on weak contract",
      tierCap: 0.40,
    };
  }
}

/**
 * Compute match strength based on normalized metadata vs FashionIntent
 */
function computeMatchStrength(product: NormalizedProduct, intent: FashionIntent): MatchTier {
  const familyMatch = product.normalizedFamily && intent.family
    ? canonicalEq(product.normalizedFamily, intent.family)
    : false;

  const typeMatch = product.normalizedType && intent.type
    ? canonicalEq(product.normalizedType, intent.type)
    : false;

  const subtypeMatch = product.normalizedSubtype && intent.subtype
    ? canonicalEq(product.normalizedSubtype, intent.subtype)
    : false;

  const colorCompatScore = colorCompatibility(intent.color, product.normalizedColor);
  const colorMatch = colorCompatScore >= 0.8; // Exact or same-family color

  const audienceMatch = product.normalizedAudience && intent.audience
    ? product.normalizedAudience === intent.audience ||
      product.normalizedAudience === "unisex" ||
      intent.audience === "unisex"
    : false;

  // Exact: family + type + (subtype or color match)
  if (familyMatch && typeMatch && (subtypeMatch || colorMatch)) {
    return "exact";
  }

  // Strong: family + type + acceptable color
  if (familyMatch && typeMatch && colorCompatScore >= 0.55) {
    return "strong";
  }

  // Strong: family + type (even if color unclear)
  if (familyMatch && typeMatch) {
    return "strong";
  }

  // Related: family (or type for fallback families like "top fallback")
  if (familyMatch) {
    return "related";
  }

  // Weak: audience + style or material hint
  if (audienceMatch && (intent.style || intent.material)) {
    if (
      (product.normalizedStyle && intent.style && canonicalEq(product.normalizedStyle, intent.style)) ||
      (product.normalizedMaterial && intent.material && canonicalEq(product.normalizedMaterial, intent.material))
    ) {
      return "weak";
    }
  }

  // No match
  return "fallback";
}

/**
 * Canonical comparison: lowercase + trim
 */
function canonicalEq(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.toLowerCase().trim() === b.toLowerCase().trim();
}

/**
 * Build human-readable tier reason string
 */
function buildTierReason(product: NormalizedProduct, intent: FashionIntent, targetTier: MatchTier): string {
  const parts: string[] = [];

  if (product.normalizedFamily && intent.family && canonicalEq(product.normalizedFamily, intent.family)) {
    parts.push(`family match (${product.normalizedFamily})`);
  }

  if (product.normalizedType && intent.type && canonicalEq(product.normalizedType, intent.type)) {
    parts.push(`type match (${product.normalizedType})`);
  } else if (intent.type) {
    parts.push(`type mismatch (expected ${intent.type}, got ${product.normalizedType || "unknown"})`);
  }

  if (product.normalizedSubtype && intent.subtype && canonicalEq(product.normalizedSubtype, intent.subtype)) {
    parts.push(`subtype match (${product.normalizedSubtype})`);
  }

  if (product.normalizedColor && intent.color) {
    const colorScore = colorCompatibility(intent.color, product.normalizedColor);
    if (colorScore >= 0.8) {
      parts.push(`color match (${product.normalizedColor})`);
    } else if (colorScore >= 0.55) {
      parts.push(`color compatible (${product.normalizedColor})`);
    } else {
      parts.push(`color mismatch (expected ${intent.color}, got ${product.normalizedColor})`);
    }
  } else if (intent.color) {
    parts.push(`no product color (intent: ${intent.color})`);
  }

  if (product.normalizedAudience && intent.audience) {
    if (product.normalizedAudience === intent.audience) {
      parts.push(`audience match (${product.normalizedAudience})`);
    } else if (product.normalizedAudience !== "unisex" && intent.audience !== "unisex") {
      parts.push(`audience mismatch (expected ${intent.audience}, got ${product.normalizedAudience})`);
    }
  }

  return parts.join("; ") || `Tier: ${targetTier}`;
}

/**
 * Get tier cap value (used for final score computation)
 */
export function getTierCap(tier: MatchTier): number {
  const caps: Record<MatchTier, number> = {
    exact: 0.94,
    strong: 0.78,
    related: 0.74,
    weak: 0.55,
    fallback: 0.40,
    blocked: 0.0,
  };
  return caps[tier] ?? 0.0;
}

/**
 * Get tier min threshold (used for score bucketing within tier)
 */
export function getTierMin(tier: MatchTier): number {
  const mins: Record<MatchTier, number> = {
    exact: 0.86,
    strong: 0.76,
    related: 0.62,
    weak: 0.45,
    fallback: 0.30,
    blocked: 0.0,
  };
  return mins[tier] ?? 0.0;
}

/**
 * Compute tier-based score: bounds final relevance by tier constraints
 * 
 * Tier-based scoring replaces flat relevance with tier-aware ranking:
 * - Each tier has a min/max range and a hard cap
 * - Score is clamped to [tierMin, tierCap]
 * - Within-tier sorting uses final score, then visual similarity
 * 
 * @param tier Assigned tier (exact, strong, related, weak, fallback, blocked)
 * @param visualSimilarity Base visual similarity [0,1]
 * @param typeMatch Product type matches search intent (0-1)
 * @param colorMatch Product color matches intent (0-1) 
 * @param audienceMatch Product audience matches intent (0-1)
 * @returns Score bounded to [tierMin, tierCap]
 */
export function computeTierBasedScore(params: {
  tier: MatchTier;
  visualSimilarity: number;
  typeMatch: number;
  colorMatch: number;
  audienceMatch: number;
}): number {
  if (params.tier === "blocked") {
    return 0.0;
  }

  const tierCap = getTierCap(params.tier);
  const tierMin = getTierMin(params.tier);

  // Base score is visual similarity, boosted by metadata alignment
  const baseScore = Math.max(0, Math.min(1, params.visualSimilarity));
  
  // Apply metadata boosts (up to +0.15 for perfect alignment)
  const typeBoost = Math.max(0, Math.min(1, params.typeMatch)) * 0.08;
  const colorBoost = Math.max(0, Math.min(1, params.colorMatch)) * 0.05;
  const audienceBoost = Math.max(0, Math.min(1, params.audienceMatch)) * 0.02;
  
  const rawScore = baseScore + typeBoost + colorBoost + audienceBoost;

  // Clamp to tier range [tierMin, tierCap]
  const tierBoundedScore = Math.max(tierMin, Math.min(tierCap, rawScore));
  
  return Math.max(0, Math.min(1, tierBoundedScore));
}

/**
 * Infer contract tier from product metadata (for kNN products without explicit _recallChannel)
 * This maps product families/types to whether they would be in exact/related/weak tiers
 * based on canonical category and product type classification.
 */
export function inferContractTierFromProduct(
  normalizedFamily: string | null | undefined,
  normalizedType: string | null | undefined,
  detectionCategory: string | null | undefined
): ContractTier {
  // If no family/type, default to weak (fallback recall)
  if (!normalizedFamily && !normalizedType) {
    return "weak";
  }

  // Exact tier: when family+type alignment is very strong
  if (normalizedFamily && normalizedType) {
    const knownExactFamilies = ["dress", "shirt", "sweater", "trouser", "pant", "pant", "sock", "shoe", "boot"];
    const isKnownExact = knownExactFamilies.some((f) => canonicalEq(f, normalizedFamily));
    if (isKnownExact) {
      return "exact";
    }
  }

  // Related tier: when family is known but type uncertain
  if (normalizedFamily) {
    const knownFamilies = [
      "dress", "shirt", "sweater", "trouser", "pant", "sock", "shoe", "boot",
      "coat", "jacket", "blazer", "cardigan", "top", "blouse", "jeans",
    ];
    const isKnown = knownFamilies.some((f) => canonicalEq(f, normalizedFamily));
    if (isKnown) {
      return "related";
    }
  }

  // Weak tier: uncertain family/type
  return "weak";
}
