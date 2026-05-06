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
  const tier = String(input.colorTier ?? "none").toLowerCase();
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

  // Gate 1: family alignment based on detection category.
  // Skip when YOLO is too uncertain or category is too broad to enforce.
  const yoloOk = input.detectionYoloConfidence >= 0.65;
  if (yoloOk) {
    if (c === "tops" && !input.docIsTopLike) return "family_top_intent_non_top_doc";
    if (c === "bottoms" && !input.docIsBottomLike) return "family_bottom_intent_non_bottom_doc";
    if ((c === "footwear" || c === "shoes") && !input.docIsFootwearLike) return "family_footwear_intent_non_footwear_doc";
    if (c === "dresses" && !input.docIsDressLike) return "family_dress_intent_non_dress_doc";
    if ((c === "outerwear" || c === "tailored") && !input.docIsOuterwearOrTailoredLike) return "family_outerwear_intent_non_outerwear_doc";
    if (c === "bags" && !input.docIsBagLike) return "family_bag_intent_non_bag_doc";
  }

  // Gate 2: cross-family penalty severe (catches cases the doc-family regex misses,
  // e.g. when the doc has both top and outerwear words).
  if (input.crossFamilyPenalty >= 0.80 && input.reliableTypeIntent) return "cross_family_severe";

  // Gate 3: audience hard contradiction.
  if (input.hasAudienceIntent && input.audienceCompliance <= 0.05) return "audience_hard_contradiction";

  // Gate 4: hard color contradiction with explicit user intent (filters.color set).
  if (
    input.hasExplicitColorIntent &&
    String(input.colorTier).toLowerCase() === "none" &&
    input.colorCompliance < 0.05
  ) {
    return "explicit_color_hard_contradiction";
  }

  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Caps
// ────────────────────────────────────────────────────────────────────────────

function computeCaps(input: UnifiedScoreInputs): { reason: string; value: number }[] {
  const caps: { reason: string; value: number }[] = [];
  const tier = String(input.colorTier ?? "none").toLowerCase();

  // Sleeve mismatch caps.
  if (input.hasSleeveIntent) {
    if (input.sleeveCompliance <= 0.10) caps.push({ reason: "sleeve_hard_mismatch", value: 0.55 });
    else if (input.sleeveCompliance <= 0.30) caps.push({ reason: "sleeve_weak_match", value: 0.75 });
  }

  // Length mismatch caps.
  if (input.hasLengthIntent) {
    if (input.lengthCompliance <= 0.15) caps.push({ reason: "length_hard_mismatch", value: 0.55 });
    else if (input.lengthCompliance <= 0.40) caps.push({ reason: "length_weak_match", value: 0.75 });
  }

  // Color mismatch caps. Different intent strengths → different ceilings.
  if (input.hasColorIntent && tier === "none") {
    const v = input.hasExplicitColorIntent ? 0.20 : input.hasInferredColorSignal ? 0.45 : 0.65;
    caps.push({ reason: "color_tier_none", value: v });
  } else if (input.hasColorIntent && tier === "bucket") {
    const v = input.hasExplicitColorIntent ? 0.65 : 0.78;
    caps.push({ reason: "color_tier_bucket", value: v });
  }

  // Audience compliance caps (soft contradictions; hard contradiction already
  // gated to 0 above).
  if (input.hasAudienceIntent) {
    if (input.audienceCompliance < 0.50) caps.push({ reason: "audience_low_compliance", value: 0.55 });
    else if (input.audienceCompliance < 0.70) caps.push({ reason: "audience_weak_compliance", value: 0.78 });
  }

  // Intra-family subtype mismatch (e.g. blazer-vs-bomber, hoodie-vs-cardigan, sneaker-vs-boot).
  if (input.intraFamilyPenalty >= 0.50) caps.push({ reason: "intra_family_severe", value: 0.65 });
  else if (input.intraFamilyPenalty >= 0.30) caps.push({ reason: "intra_family_moderate", value: 0.78 });

  // Cross-family soft cap (≥ 0.80 was already a hard gate).
  if (input.crossFamilyPenalty >= 0.50) caps.push({ reason: "cross_family_strong", value: 0.55 });
  else if (input.crossFamilyPenalty >= 0.30) caps.push({ reason: "cross_family_moderate", value: 0.75 });

  // Style mismatch (when style intent present).
  if (input.hasStyleIntent && input.styleCompliance <= 0.10) {
    caps.push({ reason: "style_hard_mismatch", value: 0.65 });
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
  const tier = String(input.colorTier ?? "none").toLowerCase();
  const sameColorFamily =
    tier === "exact" || tier === "family" || tier === "light-shade" || tier === "dark-shade";

  // Tier 1: visually identical (sim ≥ 0.97), exact type, same color family.
  // Pixels are authoritative; metadata sparseness must not drag this below
  // a visual-anchored floor.
  if (sim >= 0.97 && components.type >= 0.85 && sameColorFamily) {
    return { floor: components.visual * 0.97, reason: "near_identical_floor" };
  }

  // Tier 2: very close visual + good type + same color family.
  if (sim >= 0.95 && components.type >= 0.70 && sameColorFamily) {
    return { floor: components.visual * 0.92, reason: "high_visual_aligned_floor" };
  }

  // Tier 3: close visual + decent type + acceptable color (not contradiction).
  if (sim >= 0.90 && components.type >= 0.50 && tier !== "none") {
    return { floor: components.visual * 0.80, reason: "close_visual_acceptable_floor" };
  }

  return { floor: 0, reason: null };
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

  // 6. Final = max(floor, min(base, effectiveCap)).
  const cappedBase = Math.min(base, effectiveCap);
  const score = clamp01(Math.max(floor, cappedBase));
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

const TOP_LIKE_RE = /\b(top|tops|shirt|shirts|blouse|blouses|tee|t-?shirt|tshirt|tank|camisole|cami|sweater|sweaters|hoodie|hoodies|sweatshirt|sweatshirts|cardigan|cardigans|overshirt|overshirts|polo|polos|tunic|loungewear|knitwear|pullover|jumper|henley|bodysuit)\b/;
const BOTTOM_LIKE_RE = /\b(bottom|bottoms|pants?|trousers?|jeans?|denim|shorts?|skirt|skirts|leggings?|joggers?|chinos?|culottes?|slacks?|sweatpants?|track\s*pants?)\b/;
const FOOTWEAR_LIKE_RE = /\b(footwear|shoe|shoes|sneaker|sneakers|trainer|trainers|boot|boots|loafer|loafers|heel|heels|pump|pumps|sandal|sandals|slipper|slippers|clog|clogs|mule|mules|flats?|oxford|oxfords|espadrille|espadrilles|brogue|brogues)\b/;
const DRESS_LIKE_RE = /\b(dress|dresses|gown|gowns|jumpsuit|jumpsuits|romper|rompers|playsuit|playsuits|sundress|sun\s*dress|abaya|kaftan|caftan|frock)\b/;
const OUTERWEAR_OR_TAILORED_RE = /\b(jacket|jackets|coat|coats|blazer|blazers|outerwear|outwear|parka|parkas|trench|windbreaker|windbreakers|bomber|bombers|overcoat|overcoats|shacket|shackets|overshirt|overshirts|suit|suits|tuxedo|tuxedos|sport\s*coat|dress\s*jacket|waistcoat|waistcoats|gilet|gilets|tailored|vest|vests|poncho|anorak)\b/;
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
