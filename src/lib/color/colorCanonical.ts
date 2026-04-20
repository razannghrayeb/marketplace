/**
 * Fashion canonical color tokens and tiered matching for retrieval/rerank.
 * Kept separate from search.service so indexing and query can share one vocabulary.
 */

/** Primary index / filter tokens (lowercase, hyphenated where needed) */
export const FASHION_CANONICAL_COLORS = [
  "black",
  "white",
  "off-white",
  "cream",
  "ivory",
  "beige",
  "brown",
  "camel",
  "tan",
  "gray",
  "charcoal",
  "silver",
  "navy",
  "blue",
  "light-blue",
  "green",
  "olive",
  "red",
  "burgundy",
  "pink",
  "purple",
  "yellow",
  "orange",
  "gold",
  "teal",
  "multicolor",
] as const;

export type FashionCanonicalColor = (typeof FASHION_CANONICAL_COLORS)[number];

/** Groups of canonicals that should score as strong family matches (not collapsed to one token). */
export const COLOR_FAMILY_GROUPS: string[][] = [
  ["off-white", "cream", "ivory", "white", "ecru", "eggshell"],
  ["navy", "blue", "light-blue", "cobalt", "denim", "midnight-blue", "royal-blue", "baby-blue", "sky-blue"],
  ["charcoal", "gray", "grey", "heather-gray", "silver"],
  ["burgundy", "red", "wine", "maroon", "cherry"],
  ["camel", "beige", "tan", "taupe", "khaki"],
  ["olive", "green", "sage", "mint", "forest-green", "army-green"],
  ["pink", "fuchsia", "fuschia", "fushia", "fuhsia", "magenta", "rose", "hot-pink", "blush"],
  ["purple", "violet", "plum", "lavender", "lilac", "mauve"],
  ["gold", "yellow", "mustard"],
  ["brown", "chocolate", "mocha"],
];

function normalizeToken(s: string): string {
  return s
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .trim();
}

const VERY_LIGHT_NEUTRAL_SET = new Set([
  "white",
  "off-white",
  "cream",
  "ivory",
  "ecru",
  "eggshell",
]);

function stripTonePrefix(token: string): string {
  return String(token || "")
    .replace(/^(light|dark|deep|pale|baby|sky|midnight|bright|soft|dusty)-/, "")
    .trim();
}

function colorTone(tokenRaw: string): "light" | "dark" | "mid" {
  const token = normalizeToken(tokenRaw);
  if (!token) return "mid";
  if (
    token.startsWith("light-") ||
    token.startsWith("pale-") ||
    token.startsWith("baby-") ||
    token.startsWith("sky-") ||
    token.startsWith("soft-") ||
    VERY_LIGHT_NEUTRAL_SET.has(token)
  ) {
    return "light";
  }
  if (
    token.startsWith("dark-") ||
    token.startsWith("deep-") ||
    token.startsWith("midnight-") ||
    token === "navy" ||
    token === "charcoal" ||
    token === "burgundy" ||
    token === "maroon"
  ) {
    return "dark";
  }
  return "mid";
}

function toneAdjustedFamilyScore(desiredRaw: string, productRaw: string): number {
  const desiredTone = colorTone(desiredRaw);
  const productTone = colorTone(productRaw);
  let score = 0.88;

  if (desiredTone === "light") {
    if (productTone === "light") score += 0.08;
    else if (productTone === "dark") score -= 0.1;
    else score -= 0.02;
  } else if (desiredTone === "dark") {
    if (productTone === "dark") score += 0.06;
    else if (productTone === "light") score -= 0.1;
    else score -= 0.01;
  }

  return Math.max(0, Math.min(0.98, score));
}

/** Map loose query/index strings to a coarse bucket used only for broad synonym expansion (filters). */
export function coarseColorBucket(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = normalizeToken(raw);
  if (!key) return null;
  const alias: Record<string, string> = {
    black: "black",
    charcoal: "black",
    white: "white",
    "off-white": "white",
    offwhite: "white",
    cream: "white",
    ivory: "white",
    ecru: "white",
    beige: "brown",
    camel: "brown",
    tan: "brown",
    brown: "brown",
    gray: "gray",
    grey: "gray",
    silver: "gray",
    navy: "blue",
    blue: "blue",
    cobalt: "blue",
    denim: "blue",
    "light-blue": "blue",
    green: "green",
    olive: "green",
    sage: "green",
    red: "red",
    burgundy: "red",
    wine: "red",
    pink: "pink",
    blush: "pink",
    rose: "pink",
    fuchsia: "pink",
    fuschia: "pink",
    fushia: "pink",
    fuhsia: "pink",
    magenta: "pink",
    "hot-pink": "pink",
    purple: "purple",
    yellow: "yellow",
    gold: "yellow",
    orange: "orange",
    teal: "blue",
    multicolor: "multicolor",
    multicolour: "multicolor",
  };
  const noDashKey = key.replace(/-/g, "");
  const baseKey = stripTonePrefix(key);
  const baseNoDashKey = baseKey.replace(/-/g, "");

  return (
    alias[key] ??
    alias[noDashKey] ??
    alias[baseKey] ??
    alias[baseNoDashKey] ??
    null
  );
}

/**
 * Tiered match for rerank: prefer exact > same family > same coarse bucket > none.
 * Scores in [0, 1].
 */
export function tieredColorMatchScore(
  desiredRaw: string,
  productColors: string[],
): { score: number; matchedColor: string | null; tier: "exact" | "family" | "bucket" | "none" } {
  const desired = normalizeToken(desiredRaw);
  if (!desired || productColors.length === 0) {
    return { score: 0, matchedColor: null, tier: "none" };
  }

  const prodNorm = productColors.map((c) => ({ raw: c, n: normalizeToken(String(c)) })).filter((x) => x.n);

  for (const { raw, n } of prodNorm) {
    if (n === desired || n === desiredRaw.toLowerCase().replace(/\s+/g, "-")) {
      return { score: 1, matchedColor: raw, tier: "exact" };
    }
  }

  let bestFamily: { score: number; matchedColor: string | null } = {
    score: 0,
    matchedColor: null,
  };
  for (const { raw, n } of prodNorm) {
    for (const group of COLOR_FAMILY_GROUPS) {
      const g = new Set(group.map(normalizeToken));
      if (g.has(desired) && g.has(n)) {
        const adjusted = toneAdjustedFamilyScore(desired, n);
        if (adjusted > bestFamily.score) {
          bestFamily = { score: adjusted, matchedColor: raw };
        }
      }
    }
  }
  if (bestFamily.matchedColor) {
    return { score: bestFamily.score, matchedColor: bestFamily.matchedColor, tier: "family" };
  }

  const db = coarseColorBucket(desired);
  const desiredTone = colorTone(desired);

  let bestBucket: { score: number; matchedColor: string | null } = {
    score: 0,
    matchedColor: null,
  };
  for (const { raw, n } of prodNorm) {
    const pb = coarseColorBucket(n);
    if (db && pb && db === pb) {
      let score = 0.58;
      const productTone = colorTone(n);
      if (desiredTone === "light") {
        if (productTone === "light") score += 0.04;
        else if (productTone === "dark") score -= 0.08;
      } else if (desiredTone === "dark") {
        if (productTone === "dark") score += 0.03;
        else if (productTone === "light") score -= 0.07;
      }
      score = Math.max(0, Math.min(0.7, score));
      if (score > bestBucket.score) {
        bestBucket = { score, matchedColor: raw };
      }
    }
  }

  // For light chromatic intents, allow very-light neutrals as weaker fallback.
  if (desiredTone === "light" && db && db !== "white") {
    for (const { raw, n } of prodNorm) {
      if (VERY_LIGHT_NEUTRAL_SET.has(n)) {
        const neutralFallbackScore = 0.56;
        if (neutralFallbackScore > bestBucket.score) {
          bestBucket = { score: neutralFallbackScore, matchedColor: raw };
        }
      }
    }
  }

  if (bestBucket.matchedColor) {
    return { score: bestBucket.score, matchedColor: bestBucket.matchedColor, tier: "bucket" };
  }

  return { score: 0, matchedColor: null, tier: "none" };
}

export function tieredColorListCompliance(
  desired: string[],
  productColors: string[],
  mode: "any" | "all",
): { compliance: number; bestMatch: string | null; tier: "exact" | "family" | "bucket" | "none" } {
  if (desired.length === 0) return { compliance: 1, bestMatch: null, tier: "none" };
  if (productColors.length === 0) return { compliance: 0, bestMatch: null, tier: "none" };

  const scores = desired.map((d) => {
    const m = tieredColorMatchScore(d, productColors);
    return m;
  });

  if (mode === "all") {
    const ok = scores.every((s) => s.score > 0);
    const avg = scores.reduce((a, s) => a + s.score, 0) / scores.length;
    const best = scores.map((s) => s.matchedColor).find(Boolean) ?? null;
    return {
      compliance: ok ? avg : 0,
      bestMatch: best,
      tier: scores.every((s) => s.tier === "exact") ? "exact" : scores[0]?.tier ?? "none",
    };
  }

  const best = scores.reduce((a, b) => (a.score >= b.score ? a : b));
  return {
    compliance: best.score,
    bestMatch: best.matchedColor,
    tier: best.tier,
  };
}
