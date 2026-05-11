/**
 * Color Intelligence — designer-grade color compatibility.
 *
 * Layered on top of the existing hue-wheel / bucket logic. This module adds:
 *   - Lab-space ΔE distance (perceptual, not just hue)
 *   - Curated "designer-approved" pairings the hue wheel misses
 *     (e.g. navy + camel, burgundy + cream, olive + rust, emerald + gold)
 *   - Known-clash table for combos hue math under-penalises
 *   - Undertone (warm/cool) awareness
 *
 * Output is always {score, confidence, reason}. When confidence is low the
 * caller is expected to fall back to the legacy scorer — never break the
 * existing pipeline.
 */

const HEX_BY_NAME: Record<string, string> = {
  // Neutrals
  black: "#000000",
  white: "#ffffff",
  cream: "#f5efe1",
  ivory: "#fffff0",
  beige: "#dac9a1",
  tan: "#c9a87a",
  taupe: "#8b7d6b",
  nude: "#e6c8b0",
  camel: "#b08151",
  brown: "#6b4423",
  chocolate: "#5d3a1a",
  gray: "#7f7f7f",
  grey: "#7f7f7f",
  charcoal: "#36454f",
  // Warms
  red: "#c0392b",
  burgundy: "#6b1f2a",
  maroon: "#5b1f1f",
  wine: "#5e1f2a",
  oxblood: "#4a1414",
  rust: "#b3551d",
  terracotta: "#c46a4d",
  coral: "#ff6f61",
  peach: "#ffb38a",
  salmon: "#fa8072",
  orange: "#e67e22",
  mustard: "#c9a227",
  gold: "#caa44b",
  yellow: "#f1c40f",
  pink: "#ec7c95",
  blush: "#e8b8b1",
  // Cools
  blue: "#2e6fb5",
  navy: "#1e2a4a",
  cobalt: "#1c4ea8",
  teal: "#1f7a7a",
  turquoise: "#39c5bb",
  aqua: "#5fd3d6",
  cyan: "#4bcdd6",
  green: "#3a8a3a",
  emerald: "#1f7a4d",
  forest: "#2c4a2c",
  olive: "#6b6f1f",
  sage: "#9ba888",
  mint: "#a8dfc1",
  purple: "#7c4a8d",
  violet: "#6f4a8d",
  lavender: "#b9a4d6",
  lilac: "#c8a9d6",
  plum: "#5a2f4a",
  fuchsia: "#cc3380",
  magenta: "#bf2db5",
  // Metallics (mid-grays with warm/cool bias)
  silver: "#c0c0c0",
  rose_gold: "#b76e79",
  bronze: "#8c6a3a",
  copper: "#9b573a",
};

const NEUTRAL_NAMES = new Set([
  "black", "white", "cream", "ivory", "beige", "tan", "taupe", "nude", "camel",
  "brown", "chocolate", "gray", "grey", "charcoal",
]);

const METALLIC_NAMES = new Set(["silver", "rose_gold", "bronze", "copper", "gold"]);

// Color undertone — warm pinks vs cool pinks, warm beiges vs cool grays, etc.
// Used to detect undertone clashes that hue distance alone misses
// (e.g. warm camel + cool blush is muddy even though both are "neutral-ish").
const WARM_NAMES = new Set([
  "red", "burgundy", "maroon", "wine", "oxblood", "rust", "terracotta",
  "coral", "peach", "salmon", "orange", "mustard", "gold", "yellow",
  "pink", "blush", "camel", "tan", "beige", "cream", "ivory", "brown",
  "chocolate", "rose_gold", "bronze", "copper",
]);

const COOL_NAMES = new Set([
  "blue", "navy", "cobalt", "teal", "turquoise", "aqua", "cyan", "green",
  "emerald", "forest", "sage", "mint", "purple", "violet", "lavender",
  "lilac", "plum", "fuchsia", "magenta", "silver", "charcoal",
]);

// Designer-approved pairings.  Hue math tends to under-rate these because the
// shades sit on the wheel at angles a naive complementary/analogous rule does
// not capture.  Each entry maps a color to peers that read as elevated, not
// novelty.
const DESIGNER_PAIRINGS: Record<string, string[]> = {
  navy:       ["camel", "white", "cream", "burgundy", "blush", "gold", "ivory", "tan", "gray"],
  burgundy:   ["cream", "navy", "camel", "gold", "blush", "olive", "forest", "beige"],
  black:      ["white", "cream", "camel", "tan", "burgundy", "emerald", "gold", "silver"],
  white:      ["black", "navy", "burgundy", "olive", "rust", "emerald", "cobalt"],
  camel:      ["navy", "white", "cream", "burgundy", "black", "olive", "rust", "forest"],
  cream:      ["navy", "burgundy", "olive", "rust", "camel", "forest", "black"],
  olive:      ["camel", "rust", "burgundy", "cream", "white", "navy", "mustard"],
  rust:       ["cream", "olive", "navy", "camel", "forest", "beige", "burgundy"],
  emerald:    ["gold", "cream", "black", "white", "blush", "camel", "ivory"],
  forest:     ["camel", "cream", "rust", "burgundy", "blush", "gold"],
  sage:       ["cream", "blush", "camel", "white", "rust", "navy"],
  blush:      ["navy", "cream", "camel", "sage", "olive", "burgundy", "gray"],
  mustard:    ["navy", "cream", "olive", "burgundy", "white"],
  gold:       ["black", "navy", "burgundy", "emerald", "cream", "ivory"],
  gray:       ["black", "white", "navy", "blush", "burgundy", "camel", "yellow"],
  charcoal:   ["white", "cream", "blush", "burgundy", "camel", "silver"],
  beige:      ["navy", "black", "burgundy", "rust", "olive", "white", "cream"],
  tan:        ["navy", "white", "olive", "burgundy", "cream", "black"],
  pink:       ["gray", "navy", "white", "cream", "olive"],
  red:        ["black", "white", "cream", "navy", "gold"],
  blue:       ["white", "cream", "camel", "tan", "rust", "gold"],
  cobalt:     ["white", "cream", "camel", "blush", "gold"],
  teal:       ["cream", "camel", "blush", "rust", "white"],
  green:      ["cream", "camel", "white", "rust", "navy", "blush"],
  purple:     ["cream", "white", "gold", "gray", "blush"],
  lavender:   ["white", "cream", "gray", "navy", "blush"],
  yellow:     ["navy", "gray", "white", "black"],
  orange:     ["navy", "cream", "white", "olive", "denim"],
  coral:      ["navy", "white", "cream", "olive"],
  silver:     ["black", "white", "navy", "charcoal", "burgundy"],
  rose_gold:  ["navy", "white", "cream", "blush", "burgundy"],
};

// Known clashes — pairs that read as "off" even if hue distance is fine.
// Catches the warm/cool undertone collisions and saturation fights.
const KNOWN_CLASHES: Array<[string, string]> = [
  ["red", "pink"],
  ["red", "orange"],
  ["red", "purple"],
  ["pink", "orange"],
  ["fuchsia", "red"],
  ["fuchsia", "orange"],
  ["magenta", "red"],
  ["coral", "pink"],
  ["yellow", "pink"],
  ["yellow", "purple"],
  ["mustard", "pink"],
  ["mustard", "fuchsia"],
  ["lime", "pink"],
  ["brown", "black"],   // muddy unless deliberately contrasted
];

function hexToLab(hex: string): { L: number; a: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return { L: 50, a: 0, b: 0 };
  const int = parseInt(m[1], 16);
  let r = ((int >> 16) & 0xff) / 255;
  let g = ((int >> 8) & 0xff) / 255;
  let b = (int & 0xff) / 255;

  const toLinear = (c: number) => (c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92);
  r = toLinear(r); g = toLinear(g); b = toLinear(b);

  // sRGB D65 → XYZ
  const X = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
  const Y = (r * 0.2126729 + g * 0.7151522 + b * 0.072175) / 1.0;
  const Z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;

  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : (7.787 * t) + (16 / 116));
  const fx = f(X), fy = f(Y), fz = f(Z);
  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

/** Standard CIE76 ΔE — close enough for our coarse purposes. Returns 0..~100. */
function deltaE(c1: string, c2: string): number {
  const a = hexToLab(c1);
  const b = hexToLab(c2);
  const dL = a.L - b.L;
  const da = a.a - b.a;
  const db = a.b - b.b;
  return Math.sqrt(dL * dL + da * da + db * db);
}

function normalizeColorName(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = String(value).toLowerCase().trim();
  if (!v) return null;
  // strip qualifiers ("light blue" → "blue", "dark green" → "green", but keep
  // multi-word brand colors like "rose gold")
  if (v === "rose gold" || v === "rose-gold") return "rose_gold";
  if (HEX_BY_NAME[v]) return v;
  // Try the last word ("dark olive" → "olive")
  const tail = v.split(/\s+/).pop() || v;
  if (HEX_BY_NAME[tail]) return tail;
  return null;
}

function isNeutral(name: string): boolean {
  return NEUTRAL_NAMES.has(name);
}

function undertone(name: string): "warm" | "cool" | "neutral" {
  if (isNeutral(name) && !["camel", "tan", "beige", "cream", "ivory", "brown", "chocolate"].includes(name)) {
    return "neutral";
  }
  if (WARM_NAMES.has(name)) return "warm";
  if (COOL_NAMES.has(name)) return "cool";
  return "neutral";
}

function isDesignerPair(a: string, b: string): boolean {
  return (DESIGNER_PAIRINGS[a] || []).includes(b) || (DESIGNER_PAIRINGS[b] || []).includes(a);
}

function isKnownClash(a: string, b: string): boolean {
  for (const [x, y] of KNOWN_CLASHES) {
    if ((x === a && y === b) || (x === b && y === a)) return true;
  }
  return false;
}

export interface DesignerColorJudgement {
  /** 0..1 — higher = better fashion combo. */
  score: number;
  /** 0..1 — how confident this module is. Caller blends with legacy score
   * proportionally; low confidence = let legacy decide. */
  confidence: number;
  reason: string;
  /** Whether either color was recognized — if both null the module returns
   * confidence 0 so the caller defers to legacy scoring. */
  recognized: { source: boolean; candidate: boolean };
}

/**
 * Designer-aware color compatibility for an anchor + candidate pair.
 *
 * Heuristic stack (highest-confidence first):
 *   1. Designer-approved pair → 0.94 score, confidence 0.95
 *   2. Known clash → 0.18 score, confidence 0.9
 *   3. Both neutrals / one neutral → graded score by ΔE, confidence 0.7
 *   4. Same color family / monochromatic → 0.78–0.85, confidence 0.75
 *   5. ΔE-derived score on Lab distance, undertone-penalised, confidence 0.55
 *
 * If we can't normalize either color, returns confidence 0 and the caller
 * falls back to the existing bucket scorer.
 */
export function designerColorScore(
  sourceColor: string | null | undefined,
  candidateColor: string | null | undefined,
  options?: { candidateIsCoreGarment?: boolean },
): DesignerColorJudgement {
  const src = normalizeColorName(sourceColor);
  const cnd = normalizeColorName(candidateColor);

  if (!src && !cnd) {
    return {
      score: 0.6,
      confidence: 0,
      reason: "no color information",
      recognized: { source: false, candidate: false },
    };
  }
  if (!src || !cnd) {
    // Only one side known — give a mild "safe" score and low confidence so
    // the legacy bucket scorer dominates.
    return {
      score: 0.6,
      confidence: 0.2,
      reason: "one side of the pair has no detected color",
      recognized: { source: Boolean(src), candidate: Boolean(cnd) },
    };
  }

  if (src === cnd) {
    return {
      score: 0.82,
      confidence: 0.75,
      reason: "monochromatic — same color",
      recognized: { source: true, candidate: true },
    };
  }

  // 1. Designer pairings beat everything else
  if (isDesignerPair(src, cnd)) {
    return {
      score: 0.95,
      confidence: 0.95,
      reason: `designer-approved pairing (${src} + ${cnd})`,
      recognized: { source: true, candidate: true },
    };
  }

  // 2. Known clashes
  if (isKnownClash(src, cnd)) {
    return {
      score: options?.candidateIsCoreGarment ? 0.14 : 0.26,
      confidence: 0.9,
      reason: `known clash (${src} + ${cnd})`,
      recognized: { source: true, candidate: true },
    };
  }

  const srcNeutral = isNeutral(src);
  const cndNeutral = isNeutral(cnd);
  const srcMetallic = METALLIC_NAMES.has(src);
  const cndMetallic = METALLIC_NAMES.has(cnd);

  // 3. Metallics are generally safe
  if (srcMetallic || cndMetallic) {
    return {
      score: 0.86,
      confidence: 0.7,
      reason: "metallic accent works broadly",
      recognized: { source: true, candidate: true },
    };
  }

  const de = deltaE(HEX_BY_NAME[src], HEX_BY_NAME[cnd]);

  // 4. Neutral + anything → high baseline, penalised only by very harsh ΔE
  if (srcNeutral || cndNeutral) {
    const score = de < 60 ? 0.84 : de < 90 ? 0.76 : 0.66;
    return {
      score,
      confidence: 0.7,
      reason: srcNeutral && cndNeutral ? "neutral + neutral" : "neutral pairs broadly",
      recognized: { source: true, candidate: true },
    };
  }

  // 5. Both chromatic — undertone agreement helps; harsh saturation conflict hurts
  const srcUnder = undertone(src);
  const cndUnder = undertone(cnd);
  const undertoneAligned = srcUnder === cndUnder || srcUnder === "neutral" || cndUnder === "neutral";

  // Map ΔE roughly:
  //   <25  → near-monochrome (safe but flat)
  //   25-60 → analogous/complementary territory (best when undertones agree)
  //   60-100 → high contrast (works only with neutrals or known designer combos)
  //   >100 → loud clash unless deliberate
  let score: number;
  let reason: string;
  if (de < 25) {
    score = 0.78;
    reason = "near-monochrome";
  } else if (de < 60) {
    score = undertoneAligned ? 0.84 : 0.62;
    reason = undertoneAligned ? "harmonious palette" : "warm/cool undertone conflict";
  } else if (de < 100) {
    score = undertoneAligned ? 0.66 : 0.42;
    reason = undertoneAligned ? "high contrast — bold but balanced" : "loud contrast across undertones";
  } else {
    score = undertoneAligned ? 0.5 : 0.28;
    reason = "saturated clash";
  }

  if (options?.candidateIsCoreGarment && score < 0.5) {
    score *= 0.85;
  }

  return {
    score: Math.max(0, Math.min(1, score)),
    confidence: 0.55,
    reason,
    recognized: { source: true, candidate: true },
  };
}

/**
 * Convenience helper: given a source color, returns a short list of color
 * names a stylist would reach for first. Useful for soft-boosting candidates
 * whose color is in this list.
 */
export function suggestedPalette(sourceColor: string | null | undefined, limit = 6): string[] {
  const src = normalizeColorName(sourceColor);
  if (!src) return ["black", "white", "navy", "cream", "camel", "beige"].slice(0, limit);
  const direct = DESIGNER_PAIRINGS[src] || [];
  if (direct.length >= limit) return direct.slice(0, limit);
  // pad with universal neutrals
  const padded = [...direct, "black", "white", "navy", "cream", "camel", "beige"]
    .filter((c, i, arr) => arr.indexOf(c) === i && c !== src);
  return padded.slice(0, limit);
}
