/**
 * Unified Image Scorer
 *
 * Single coherent score for image-search rerank, replacing the cascading
 * tuning-block + dual-path-blend pipeline in products.service.ts.
 *
 * Pipeline:
 *   1. Hard gates (family / cross-family / audience / hard-color)  → return 0
 *   2. Component scores (visual / type / color / attrs)            → each 0..1
 *   3. Category-weighted base score                                → 0..1
 *   4. Caps from attribute disagreements                           → take min
 *   5. Coherence floor from strong visual+type+color alignment     → take max
 *   6. Final = max(floor, min(base, effectiveCap))
 *
 * Properties:
 *   - Deterministic. Same inputs → same score. No stacked Math.max boosts.
 *   - Hard gates run first, set score=0, and the contract is that the caller
 *     does not lift this back up. (Wired behind a feature flag.)
 *   - Caps are always-present ceilings; they don't compose with each other —
 *     the lowest cap wins. This avoids the "many small caps multiply to zero"
 *     surprise of the legacy pipeline.
 *   - Coherence floor is the only lift, and it's bounded by visual evidence,
 *     so a high-visual+aligned-attribute candidate cannot be silently dragged
 *     below the visual-anchored floor by sparse catalog metadata.
 *
 * Enable via env: SEARCH_IMAGE_UNIFIED_SCORER=1
 */

export type ColorTier = "exact" | "family" | "light-shade" | "dark-shade" | "bucket" | "none" | string;

export interface UnifiedScoreInputs {
  // ── Compliance signals (from computeHitRelevance) ──
  exactTypeScore: number;
  productTypeCompliance: number;
  siblingClusterScore: number;
  parentHypernymScore: number;
  intraFamilyPenalty: number;
  crossFamilyPenalty: number;
  colorCompliance: number;
  colorTier: ColorTier;
  audienceCompliance: number;
  styleCompliance: number;
  sleeveCompliance: number;
  lengthCompliance: number;
  patternCompliance: number; // optional — pass 0 if unavailable
  materialCompliance: number;
  categoryRelevance01: number;
  osSimilarity01: number;
  // ── Intent flags ──
  hasTypeIntent: boolean;
  hasColorIntent: boolean;
  hasSleeveIntent: boolean;
  hasLengthIntent: boolean;
  hasStyleIntent: boolean;
  hasAudienceIntent: boolean;
  hasExplicitColorIntent: boolean;
  hasInferredColorSignal: boolean;
  hasCropColorSignal: boolean;
  reliableTypeIntent: boolean;
  // ── Detection context ──
  detectionProductCategory: string;
  detectionYoloConfidence: number;
  // ── Doc family signals (precomputed by caller) ──
  docIsTopLike: boolean;
  docIsBottomLike: boolean;
  docIsFootwearLike: boolean;
  docIsDressLike: boolean;
  docIsOuterwearOrTailoredLike: boolean;
  docIsBagLike: boolean;
}

export interface UnifiedScoreResult {
  score: number;
  hardGate: string | null;
  components: {
    visual: number;
    type: number;
    color: number;
    attrs: number;
  };
  weights: {
    visual: number;
    type: number;
    color: number;
    attrs: number;
  };
  base: number;
  caps: { reason: string; value: number }[];
  effectiveCap: number;
  floor: number;
  floorReason: string | null;
  matchLabel: "same_product" | "near_identical" | "very_similar" | "similar" | "weak";
}

// ────────────────────────────────────────────────────────────────────────────
// Component score helpers
// ────────────────────────────────────────────────────────────────────────────

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function effectiveColorTier(input: Pick<UnifiedScoreInputs, "colorTier" | "colorCompliance">): string {
  const tier = String(input.colorTier ?? "none").toLowerCase();
  const compliance = clamp01(Number(input.colorCompliance));

  // Treat impossible tier/compliance pairs as the weaker signal. This protects
  // unified scoring from stale upstream tiers after catalog color correction.
  if (tier === "exact" && compliance < 0.6) {
    return compliance >= 0.35 ? "family" : "none";
  }
  if (
    (tier === "family" || tier === "light-shade" || tier === "dark-shade" || tier === "bucket") &&
    compliance <= 0.01
  ) {
    return "none";
  }

  return tier;
}

/**
 * Visual base curve. Same as legacy calibratedVisualBase (products.service.ts:1341)
 * so the unified scorer doesn't change visual semantics — only how visual is
 * combined with other signals.
 */
function calibratedVisualBase(sim: number): number {
  const s = clamp01(sim);
  if (s >= 0.985) return 0.96;
  if (s >= 0.970) return 0.94;
  if (s >= 0.950) return 0.91;
  if (s >= 0.930) return 0.88;
  if (s >= 0.900) return 0.84;
  if (s >= 0.870) return 0.78;
  if (s >= 0.840) return 0.72;
  return Math.max(0.55, s * 0.80);
}

function computeTypeScore(input: UnifiedScoreInputs): number {
  const exact = clamp01(input.exactTypeScore);
  const compliance = clamp01(input.productTypeCompliance);
  const sibling = clamp01(input.siblingClusterScore);
  const parent = clamp01(input.parentHypernymScore);
  const cat = clamp01(input.categoryRelevance01);

  // Tiered: exact match first, then high compliance, then sibling, then parent,
  // then category-only fallback. Each tier has a bounded value so a category
  // match can't masquerade as an exact match.
  if (exact >= 1) return 1.0;
  if (compliance >= 0.82) return 0.85;
  if (compliance >= 0.62) return 0.70;
  if (sibling >= 0.50) return 0.55;
  if (compliance >= 0.30) return 0.45;
  if (parent >= 0.50) return 0.40;
  if (cat >= 0.95) return 0.35; // bare category alignment, no type evidence
  return Math.max(compliance * 0.6, cat * 0.30);
}

function computeColorScore(input: UnifiedScoreInputs): number {
  const tier = effectiveColorTier(input);
  const compliance = clamp01(input.colorCompliance);
  const hasIntent = input.hasColorIntent;

  if (!hasIntent) {
    // No color intent: don't reward or punish color. Neutral.
    return 0.65;
  }

  if (tier === "exact") return 1.00;
  if (tier === "family") return Math.max(0.78, compliance);
  if (tier === "light-shade" || tier === "dark-shade") return Math.max(0.72, compliance);
  if (tier === "bucket") return Math.max(0.40, Math.min(0.65, compliance));
  if (tier === "none") {
    // Color contradiction. Return very low so the cap stage can drive total down.
    if (compliance > 0.10) return Math.min(0.30, compliance);
    return input.hasExplicitColorIntent ? 0.05 : input.hasInferredColorSignal ? 0.12 : 0.18;
  }
  // Unknown tier: fall back to compliance.
  return clamp01(compliance);
}

/**
 * Weighted average of attribute compliances over dimensions where intent is present.
 * When no intent dimensions are active, returns a neutral 0.6 (no information either way).
 */
function computeAttributeScore(input: UnifiedScoreInputs): number {
  type AttrEntry = { weight: number; value: number; active: boolean };
  const entries: AttrEntry[] = [
    { weight: 0.30, value: input.sleeveCompliance, active: input.hasSleeveIntent },
    { weight: 0.25, value: input.lengthCompliance, active: input.hasLengthIntent },
    { weight: 0.20, value: input.styleCompliance, active: input.hasStyleIntent },
    { weight: 0.15, value: input.audienceCompliance, active: input.hasAudienceIntent },
    { weight: 0.05, value: input.patternCompliance, active: input.patternCompliance > 0 },
    { weight: 0.05, value: input.materialCompliance, active: input.materialCompliance > 0 },
  ];

  const active = entries.filter((e) => e.active);
  if (active.length === 0) return 0.6; // no attribute intent → neutral

  const totalW = active.reduce((s, e) => s + e.weight, 0);
  if (totalW <= 0) return 0.6;
  const sum = active.reduce((s, e) => s + e.weight * clamp01(e.value), 0);
  return clamp01(sum / totalW);
}

// ────────────────────────────────────────────────────────────────────────────
// Category weights — sum to 1.0 each
// ────────────────────────────────────────────────────────────────────────────

interface CategoryWeights { visual: number; type: number; color: number; attrs: number; }

function categoryWeights(detectionCategory: string): CategoryWeights {
  const c = String(detectionCategory ?? "").toLowerCase().trim();
  // Tailored (suits) — type matters most, audience strongly via attrs.
  if (c === "tailored") return { visual: 0.30, type: 0.32, color: 0.20, attrs: 0.18 };
  // Bags — color is critical for outfit cohesion.
  if (c === "bags") return { visual: 0.40, type: 0.15, color: 0.35, attrs: 0.10 };
  // Accessories — visual identity dominates (jewelry, watches).
  if (c === "accessories") return { visual: 0.55, type: 0.20, color: 0.15, attrs: 0.10 };
  // Footwear — type drives subtype selection (sneaker vs heel vs boot).
  if (c === "footwear" || c === "shoes") return { visual: 0.42, type: 0.25, color: 0.20, attrs: 0.13 };
  // Dresses — length, style, color all balanced.
  if (c === "dresses") return { visual: 0.38, type: 0.18, color: 0.22, attrs: 0.22 };
  // Outerwear — type (jacket vs coat vs blazer) and color matter.
  if (c === "outerwear") return { visual: 0.40, type: 0.22, color: 0.20, attrs: 0.18 };
  // Bottoms — color and type weigh equally; sleeve doesn't apply.
  if (c === "bottoms") return { visual: 0.40, type: 0.22, color: 0.25, attrs: 0.13 };
  // Tops (default) — color emphasized per perceptual feedback.
  if (c === "tops") return { visual: 0.40, type: 0.20, color: 0.25, attrs: 0.15 };
  // Fallback — generic apparel.
  return { visual: 0.42, type: 0.20, color: 0.23, attrs: 0.15 };
}

// ────────────────────────────────────────────────────────────────────────────
// Hard gates
// ────────────────────────────────────────────────────────────────────────────

function checkHardGates(input: UnifiedScoreInputs): string | null {
  const c = String(input.detectionProductCategory ?? "").toLowerCase().trim();

  // ── Gate 1: family alignment ──
  // Block when doc has a CLEAR OPPOSITE family signal (e.g. dress doc vs tops query).
  // Do NOT block when doc has no family signals at all — sparse-metadata docs
  // (brand-only titles, empty categories) should fall through to scoring rather
  // than being silently dropped. This fixes the "many products dropped, no results"
  // issue while still hard-blocking actual cross-category candidates.
  //
  // Block also requires reasonable YOLO confidence so a borderline detection
  // doesn't aggressively reject candidates that may genuinely match.
  const yoloOk = input.detectionYoloConfidence >= 0.70;
  if (yoloOk) {
    if (c === "tops") {
      // For tops detection, block ONLY when doc has a clear non-top family signal.
      // Outerwear is partially overlapping (overshirt, shacket) — handled by intra
      // and cross-family caps below, not the hard gate.
      const oppositeSignal =
        input.docIsBottomLike ||
        input.docIsFootwearLike ||
        input.docIsDressLike ||
        input.docIsBagLike;
      if (oppositeSignal && !input.docIsTopLike) return "family_top_intent_opposite_doc";
    } else if (c === "bottoms") {
      const oppositeSignal =
        input.docIsTopLike ||
        input.docIsFootwearLike ||
        input.docIsDressLike ||
        input.docIsOuterwearOrTailoredLike ||
        input.docIsBagLike;
      if (oppositeSignal && !input.docIsBottomLike) return "family_bottom_intent_opposite_doc";
    } else if (c === "footwear" || c === "shoes") {
      const oppositeSignal =
        input.docIsTopLike ||
        input.docIsBottomLike ||
        input.docIsDressLike ||
        input.docIsOuterwearOrTailoredLike ||
        input.docIsBagLike;
      if (oppositeSignal && !input.docIsFootwearLike) return "family_footwear_intent_opposite_doc";
    } else if (c === "dresses") {
      const oppositeSignal =
        input.docIsBottomLike ||
        input.docIsFootwearLike ||
        input.docIsOuterwearOrTailoredLike ||
        input.docIsBagLike;
      if (oppositeSignal && !input.docIsDressLike) return "family_dress_intent_opposite_doc";
    } else if (c === "outerwear" || c === "tailored") {
      const oppositeSignal =
        input.docIsBottomLike ||
        input.docIsFootwearLike ||
        input.docIsDressLike ||
        input.docIsBagLike;
      if (oppositeSignal && !input.docIsOuterwearOrTailoredLike) return "family_outerwear_intent_opposite_doc";
    } else if (c === "bags") {
      const oppositeSignal =
        input.docIsTopLike ||
        input.docIsBottomLike ||
        input.docIsFootwearLike ||
        input.docIsDressLike;
      if (oppositeSignal && !input.docIsBagLike) return "family_bag_intent_opposite_doc";
    }
  }

  // ── Gate 2: severe cross-family penalty ──
  // Catches the few cases the regex above doesn't (e.g. shorts vs trouser intent
  // produces 0.92 cross-family penalty even though both are bottoms).
  if (input.crossFamilyPenalty >= 0.85 && input.reliableTypeIntent) return "cross_family_severe";

  // ── Gate 3: cross-gender contradiction ──
  // Strict (< 0.30) because scoreAudienceCompliance soft-multiplies down to ~0.35
  // for women-cue docs against men query (and vice versa). Without this, cross-gender
  // products slip through. User explicitly wants no cross-gender.
  if (input.hasAudienceIntent && input.audienceCompliance < 0.30) return "audience_contradiction";

  // ── Gate 4: hard color contradiction with explicit user filter ──
  // Only fires when the user explicitly typed/filtered a color (not when color was
  // inferred from BLIP/crop) AND tier is none AND raw compliance is essentially 0.
  if (
    input.hasExplicitColorIntent &&
    String(input.colorTier).toLowerCase() === "none" &&
    input.colorCompliance < 0.05
  ) {
    return "explicit_color_hard_contradiction";
  }

  return null;
}

/**
 * Effective intra-family penalty.
 *
 * `intraFamilyPenalty` from productTypeTaxonomy is computed as MAX over all
 * (query_seed × doc_type) pairs. This means a polo doc gets penalized 0.72 against
 * a query that includes "knit" alongside "polo" because (knit, polo) pairs to 0.72
 * in TOPS_PENALTY_TBL — even though the query also includes "polo" which pairs to
 * 0 with the doc. When an exact type match exists, the worst-pair penalty is the
 * wrong signal: there's a query seed that matches the doc perfectly, the user
 * intent is satisfied, intra-family mismatch shouldn't apply.
 *
 * Compensation:
 *   - exactTypeScore ≥ 1 → effective penalty = 0
 *   - productTypeCompliance ≥ 0.82 → effective penalty halved
 *   - productTypeCompliance ≥ 0.62 → effective penalty * 0.7
 *   - otherwise → effective penalty as-is
 */
function effectiveIntraFamilyPenalty(input: UnifiedScoreInputs): number {
  const raw = clamp01(input.intraFamilyPenalty);
  if (input.exactTypeScore >= 1) return 0;
  if (input.productTypeCompliance >= 0.82) return raw * 0.5;
  if (input.productTypeCompliance >= 0.62) return raw * 0.7;
  return raw;
}

// ────────────────────────────────────────────────────────────────────────────
// Caps
// ────────────────────────────────────────────────────────────────────────────

function computeCaps(input: UnifiedScoreInputs): { reason: string; value: number }[] {
  const caps: { reason: string; value: number }[] = [];
  const tier = effectiveColorTier(input);
  const detectionCategory = String(input.detectionProductCategory ?? "").toLowerCase().trim();
  const nearIdenticalTypeAligned =
    input.osSimilarity01 >= 0.97 &&
    (input.exactTypeScore >= 1 || input.productTypeCompliance >= 0.82);

  // ── Continuous caps ──
  // Use linear interpolation instead of stepped values so similar penalties produce
  // unique caps. Stepped caps caused visible score ties at 0.55, 0.65, 0.75, 0.78.
  // Each cap is clamped to a sensible floor to keep the formula bounded.

  // Sleeve mismatch — when intent active, mismatch caps the score continuously.
  // sleeveCompliance 0.0 → cap 0.50, 0.30 → cap 0.78, 0.50+ → no cap.
  if (input.hasSleeveIntent && input.sleeveCompliance < 0.50) {
    const cap = 0.50 + input.sleeveCompliance * 0.93; // [0.50, 0.965)
    caps.push({ reason: "sleeve_mismatch_cap", value: cap });
  }

  // Length mismatch — same shape as sleeve.
  if (input.hasLengthIntent && input.lengthCompliance < 0.55) {
    const cap = 0.50 + input.lengthCompliance * 0.85;
    caps.push({ reason: "length_mismatch_cap", value: cap });
  }

  // Color mismatch — discrete tier transitions but with continuous compliance bonus.
  if (input.hasColorIntent && tier === "none") {
    const baseCap = input.hasExplicitColorIntent ? 0.18 : input.hasInferredColorSignal ? 0.42 : 0.62;
    const cap = baseCap + clamp01(input.colorCompliance) * 0.06; // tiny continuous lift
    caps.push({ reason: "color_tier_none_cap", value: cap });
  } else if (input.hasColorIntent && tier === "bucket") {
    const baseCap = input.hasExplicitColorIntent ? 0.60 : 0.74;
    const cap = baseCap + clamp01(input.colorCompliance) * 0.08;
    caps.push({ reason: "color_tier_bucket_cap", value: cap });
  }

  // Audience — continuous between 0.30 (gated to 0 above) and 0.85.
  if (input.hasAudienceIntent && input.audienceCompliance < 0.85) {
    const ac = clamp01(input.audienceCompliance);
    // ac=0.30 → cap 0.50, ac=0.50 → 0.62, ac=0.70 → 0.78, ac=0.85 → 0.87.
    const cap = 0.36 + ac * 0.60;
    caps.push({ reason: "audience_compliance_cap", value: cap });
  }

  // Intra-family subtype — use EFFECTIVE penalty (zero when exactTypeScore=1).
  // This fixes the polo-vs-tee scenario: if doc IS a polo and query has polo, we
  // shouldn't cap because the expansion also added "tee" which pairs unfavorably.
  const intra = effectiveIntraFamilyPenalty(input);
  if (intra > 0.10) {
    // intra=0.10 → cap 0.92, intra=0.30 → 0.79, intra=0.50 → 0.66, intra=0.72 → 0.51.
    const cap = 0.99 - intra * 0.67;
    caps.push({ reason: "intra_family_cap", value: cap });
  }

  // Cross-family soft cap (≥ 0.80 was already a hard gate).
  if (input.crossFamilyPenalty >= 0.20) {
    // cf=0.20 → cap 0.86, cf=0.40 → 0.74, cf=0.60 → 0.62, cf=0.78 → 0.51.
    const cap = 0.98 - input.crossFamilyPenalty * 0.60;
    caps.push({ reason: "cross_family_cap", value: cap });
  }

  // Style hard mismatch only — soft mismatches blend through component score.
  // Tops and outerwear are visually close, especially for long sleeves.
  // Keep one retrieval path, but cap obvious family drift so exact color or
  // high visual similarity cannot rank a plain jacket as a top, or a plain
  // shirt as outerwear. Near-identical + type-aligned matches are preserved.
  if (!nearIdenticalTypeAligned) {
    if (detectionCategory === "tops" && input.docIsOuterwearOrTailoredLike && !input.docIsTopLike) {
      caps.push({ reason: "top_outerwear_family_cap", value: 0.56 });
    } else if (
      detectionCategory === "tops" &&
      input.docIsOuterwearOrTailoredLike &&
      input.docIsTopLike &&
      input.exactTypeScore < 1 &&
      input.productTypeCompliance < 0.50
    ) {
      caps.push({ reason: "top_layering_weak_type_cap", value: 0.68 });
    }

    if (
      (detectionCategory === "outerwear" || detectionCategory === "tailored") &&
      input.docIsTopLike &&
      !input.docIsOuterwearOrTailoredLike
    ) {
      caps.push({ reason: "outerwear_plain_top_family_cap", value: 0.56 });
    }
  }

  if (input.hasStyleIntent && input.styleCompliance <= 0.10) {
    const cap = 0.60 + input.styleCompliance * 0.5; // small continuous variation
    caps.push({ reason: "style_hard_mismatch_cap", value: cap });
  }

  return caps;
}

// ────────────────────────────────────────────────────────────────────────────
// Coherence floor
// ────────────────────────────────────────────────────────────────────────────

function computeFloor(
  input: UnifiedScoreInputs,
  components: { visual: number; type: number; color: number; attrs: number },
): { floor: number; reason: string | null } {
  const sim = clamp01(input.osSimilarity01);
  const detectionCategory = String(input.detectionProductCategory ?? "").toLowerCase().trim();
  const tier = effectiveColorTier(input);
  const sameColorFamily =
    tier === "exact" || tier === "family" || tier === "light-shade" || tier === "dark-shade";
  const nearIdenticalTypeAligned =
    sim >= 0.97 &&
    (input.exactTypeScore >= 1 || input.productTypeCompliance >= 0.82);
  const structuralFamilyDrift =
    !nearIdenticalTypeAligned &&
    (
      (detectionCategory === "tops" && input.docIsOuterwearOrTailoredLike && !input.docIsTopLike) ||
      ((detectionCategory === "outerwear" || detectionCategory === "tailored") &&
        input.docIsTopLike &&
        !input.docIsOuterwearOrTailoredLike)
    );

  let floor = 0;
  let reason: string | null = null;

  // ── Visual-anchored floors ──
  // Tier 1: visually identical (sim ≥ 0.97), exact type, same color family.
  if (sim >= 0.97 && components.type >= 0.85 && sameColorFamily) {
    const f = components.visual * 0.97;
    if (f > floor) { floor = f; reason = "near_identical_floor"; }
  }

  // Tier 2: very close visual + good type + same color family.
  if (sim >= 0.95 && components.type >= 0.70 && sameColorFamily) {
    const f = components.visual * 0.92;
    if (f > floor) { floor = f; reason = "high_visual_aligned_floor"; }
  }

  // Tier 3: close visual + decent type + acceptable color (not contradiction).
  if (sim >= 0.90 && components.type >= 0.50 && tier !== "none") {
    const f = components.visual * 0.80;
    if (f > floor) { floor = f; reason = "close_visual_acceptable_floor"; }
  }

  // ── Color-priority floors ──
  // Color is the most perceptually important attribute for fashion shopping.
  // When a candidate has an exact catalog color match AND meaningful type
  // alignment AND no audience contradiction, it deserves a high floor regardless
  // of intra-family or moderate cross-family caps that would otherwise drag it
  // down. This addresses the user's requirement: same-color products must rank
  // first.
  const audienceOk = !input.hasAudienceIntent || input.audienceCompliance >= 0.70;
  if (tier === "exact" && input.hasColorIntent && audienceOk && !structuralFamilyDrift) {
    // Floor scales with type + visual evidence so a wrong-type-but-exact-color item
    // doesn't get inflated.
    let colorFloor = 0;
    if (input.exactTypeScore >= 1) {
      colorFloor = sim >= 0.85 ? 0.88 : sim >= 0.75 ? 0.83 : sim >= 0.65 ? 0.78 : 0.72;
    } else if (components.type >= 0.70) {
      colorFloor = sim >= 0.85 ? 0.82 : sim >= 0.75 ? 0.76 : 0.70;
    } else if (components.type >= 0.50) {
      colorFloor = sim >= 0.80 ? 0.72 : 0.66;
    }
    if (colorFloor > floor) { floor = colorFloor; reason = "exact_color_priority_floor"; }
  }

  if (tier === "family" && input.hasColorIntent && audienceOk && !structuralFamilyDrift) {
    let familyColorFloor = 0;
    if (input.exactTypeScore >= 1) {
      familyColorFloor = sim >= 0.85 ? 0.80 : sim >= 0.75 ? 0.74 : sim >= 0.65 ? 0.68 : 0.62;
    } else if (components.type >= 0.70) {
      familyColorFloor = sim >= 0.80 ? 0.72 : 0.66;
    }
    if (familyColorFloor > floor) { floor = familyColorFloor; reason = "family_color_priority_floor"; }
  }

  return { floor, reason };
}

/**
 * Micro tie-breakers added to the final score (in [0, 0.012] range, so they
 * differentiate ties without affecting band placement). Without these, many
 * candidates land exactly on cap values (0.55, 0.65, 0.78) creating visible
 * score ties.
 */
function computeTieBreakers(input: UnifiedScoreInputs): number {
  const sim = clamp01(input.osSimilarity01);
  let bonus = 0;
  // Visual sim contributes up to 0.005.
  bonus += sim * 0.005;
  // Exact color match contributes 0.003.
  if (effectiveColorTier(input) === "exact") bonus += 0.003;
  // Exact type contributes 0.002.
  if (input.exactTypeScore >= 1) bonus += 0.002;
  // Color compliance fine-grained contribution up to 0.002.
  bonus += clamp01(input.colorCompliance) * 0.002;
  return bonus;
}

// ────────────────────────────────────────────────────────────────────────────
// Match label
// ────────────────────────────────────────────────────────────────────────────

function deriveMatchLabel(
  finalScore: number,
  visualSim: number,
): UnifiedScoreResult["matchLabel"] {
  if (visualSim >= 0.985 && finalScore >= 0.95) return "same_product";
  if (finalScore >= 0.92) return "near_identical";
  if (finalScore >= 0.85) return "very_similar";
  if (finalScore >= 0.72) return "similar";
  return "weak";
}

// ────────────────────────────────────────────────────────────────────────────
// Main entry point
// ────────────────────────────────────────────────────────────────────────────

export function scoreCandidateUnified(input: UnifiedScoreInputs): UnifiedScoreResult {
  // 1. Hard gates.
  const hardGate = checkHardGates(input);
  if (hardGate) {
    return {
      score: 0,
      hardGate,
      components: { visual: 0, type: 0, color: 0, attrs: 0 },
      weights: { visual: 0, type: 0, color: 0, attrs: 0 },
      base: 0,
      caps: [],
      effectiveCap: 0,
      floor: 0,
      floorReason: null,
      matchLabel: "weak",
    };
  }

  // 2. Component scores.
  const components = {
    visual: calibratedVisualBase(input.osSimilarity01),
    type: computeTypeScore(input),
    color: computeColorScore(input),
    attrs: computeAttributeScore(input),
  };

  // 3. Category-weighted base.
  const weights = categoryWeights(input.detectionProductCategory);
  const base = clamp01(
    weights.visual * components.visual +
      weights.type * components.type +
      weights.color * components.color +
      weights.attrs * components.attrs,
  );

  // 4. Caps.
  const caps = computeCaps(input);
  const effectiveCap = caps.length > 0 ? Math.min(...caps.map((c) => c.value)) : 1.0;

  // 5. Coherence floor.
  const { floor, reason: floorReason } = computeFloor(input, components);

  // 6. Final = max(floor, min(base, effectiveCap)) + micro tie-breakers.
  // Tie-breakers (≤ 0.012) split candidates that would otherwise land on identical
  // cap values. Score is clamped to (0, 0.998) so tie-breakers never push a
  // capped/floored score above its band.
  const cappedBase = Math.min(base, effectiveCap);
  const beforeTieBreak = clamp01(Math.max(floor, cappedBase));
  const tieBreaker = computeTieBreakers(input);
  const score = clamp01(Math.min(0.998, beforeTieBreak + tieBreaker));
  const rounded = Math.round(score * 10000) / 10000;

  return {
    score: rounded,
    hardGate: null,
    components,
    weights,
    base,
    caps,
    effectiveCap,
    floor,
    floorReason,
    matchLabel: deriveMatchLabel(rounded, input.osSimilarity01),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers for deriving doc-family signals (used by the caller before invoking
// scoreCandidateUnified).
// ────────────────────────────────────────────────────────────────────────────

const TOP_LIKE_RE = /\b(top|tops|shirt|shirts|blouse|blouses|tee|t-?shirt|tshirt|tank|camisole|cami|sweater|sweaters|hoodie|hoodies|sweatshirt|sweatshirts|cardigan|cardigans|overshirt|overshirts|polo|polos|tunic|loungewear|knitwear|pullover|jumper|henley|bodysuit|fleece)\b/;
const BOTTOM_LIKE_RE = /\b(bottom|bottoms|pants?|trousers?|jeans?|denim|shorts?|skirt|skirts|leggings?|joggers?|chinos?|culottes?|slacks?|sweatpants?|track\s*pants?)\b/;
const FOOTWEAR_LIKE_RE = /\b(footwear|shoe|shoes|sneaker|sneakers|trainer|trainers|boot|boots|loafer|loafers|heel|heels|pump|pumps|sandal|sandals|slipper|slippers|clog|clogs|mule|mules|flats?|oxford|oxfords|espadrille|espadrilles|brogue|brogues)\b/;
const DRESS_LIKE_RE = /\b(dress|dresses|gown|gowns|jumpsuit|jumpsuits|romper|rompers|playsuit|playsuits|sundress|sun\s*dress|abaya|kaftan|caftan|frock)\b/;
const OUTERWEAR_OR_TAILORED_RE = /\b(jacket|jackets|coat|coats|blazer|blazers|outerwear|outwear|parka|parkas|trench|windbreaker|windbreakers|bomber|bombers|blouson|blousons|fleece|fleeces|puffer|puffers|down\s+jackets?|quilted\s+jackets?|rain\s+jackets?|shell\s+jackets?|softshell(?:\s+jackets?)?|overcoat|overcoats|shacket|shackets|overshirt|overshirts|suit|suits|tuxedo|tuxedos|sport\s*coat|dress\s*jacket|waistcoat|waistcoats|gilet|gilets|tailored|vest|vests|poncho|anorak)\b/;
const BAG_LIKE_RE = /\b(bag|bags|handbag|handbags|tote|totes|clutch|clutches|purse|purses|backpack|backpacks|crossbody|satchel|satchels|wallet|wallets|fanny\s*pack|duffel|duffle|messenger\s*bag)\b/;

export interface DocFamilySignals {
  docIsTopLike: boolean;
  docIsBottomLike: boolean;
  docIsFootwearLike: boolean;
  docIsDressLike: boolean;
  docIsOuterwearOrTailoredLike: boolean;
  docIsBagLike: boolean;
}

export function computeDocFamilySignals(src: Record<string, unknown>): DocFamilySignals {
  const productTypes = Array.isArray(src.product_types)
    ? (src.product_types as unknown[]).map((t) => String(t ?? "").toLowerCase())
    : [];
  const blob = [
    src.title,
    src.category,
    src.category_canonical,
    ...productTypes,
  ]
    .map((v) => String(v ?? "").toLowerCase())
    .join(" ");

  return {
    docIsTopLike: TOP_LIKE_RE.test(blob),
    docIsBottomLike: BOTTOM_LIKE_RE.test(blob),
    docIsFootwearLike: FOOTWEAR_LIKE_RE.test(blob),
    docIsDressLike: DRESS_LIKE_RE.test(blob),
    docIsOuterwearOrTailoredLike: OUTERWEAR_OR_TAILORED_RE.test(blob),
    docIsBagLike: BAG_LIKE_RE.test(blob),
  };
}

export function isUnifiedImageScorerEnabled(): boolean {
  const v = String(process.env.SEARCH_IMAGE_UNIFIED_SCORER ?? "0").toLowerCase().trim();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}
