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
  return alias[key] ?? alias[key.replace(/-/g, "")] ?? null;
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

  for (const { raw, n } of prodNorm) {
    for (const group of COLOR_FAMILY_GROUPS) {
      const g = new Set(group.map(normalizeToken));
      if (g.has(desired) && g.has(n)) {
        return { score: 0.88, matchedColor: raw, tier: "family" };
      }
    }
  }

  const db = coarseColorBucket(desired);
  for (const { raw, n } of prodNorm) {
    const pb = coarseColorBucket(n);
    if (db && pb && db === pb) {
      return { score: 0.58, matchedColor: raw, tier: "bucket" };
    }
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
