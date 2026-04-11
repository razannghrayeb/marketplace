/**
 * Query-time color normalization and OpenSearch filter term expansion (shared by text + image search).
 */

export const COLOR_CANONICAL_ALIASES: Record<string, string[]> = {
  black: ["black", "charcoal", "dark gray", "dark grey", "jet", "onyx"],
  white: ["white", "off white", "off-white", "ivory", "cream", "ecru"],
  gray: ["gray", "grey", "heather grey", "heather gray", "silver"],
  blue: ["blue", "navy", "cobalt", "denim", "sky blue", "mid blue", "midnight blue"],
  red: ["red", "burgundy", "maroon", "wine", "cherry"],
  green: ["green", "olive", "khaki", "sage", "mint", "forest green", "hunter green"],
  brown: ["brown", "camel", "tan", "taupe", "mocha", "chocolate", "beige"],
  purple: ["purple", "violet", "plum", "lavender", "lilac", "mauve"],
  pink: ["pink", "blush", "fuchsia", "magenta", "rose"],
  yellow: ["yellow", "mustard", "golden", "gold"],
  orange: ["orange", "rust", "peach", "coral", "burnt orange"],
  multicolor: ["multicolor", "multi color", "multi-color", "colour block", "color block"],
};

const COLOR_ALIAS_TO_CANONICAL = (() => {
  const map = new Map<string, string>();
  for (const [canonical, aliases] of Object.entries(COLOR_CANONICAL_ALIASES)) {
    map.set(canonical, canonical);
    for (const alias of aliases) map.set(alias.toLowerCase(), canonical);
  }
  return map;
})();

export function normalizeColorToken(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw.toLowerCase().replace(/[_-]/g, " ").replace(/\s+/g, " ").trim();
  const direct = COLOR_ALIAS_TO_CANONICAL.get(key);
  if (direct) return direct;

  // Phrase fallback for compound merchant values like "mid wash denim".
  // Prefer explicit color words first, then infer denim family as blue.
  const hasWord = (w: string) => new RegExp(`\\b${w}\\b`).test(key);

  if (key.includes("denim")) {
    if (hasWord("black")) return "black";
    if (hasWord("white") || key.includes("off white") || key.includes("off-white")) return "white";
    if (hasWord("gray") || hasWord("grey") || hasWord("charcoal")) return "gray";
    return "blue";
  }

  // Generic fallback: if a known alias appears as a whole word/phrase inside
  // the value, resolve to that canonical color.
  for (const [alias, canonical] of COLOR_ALIAS_TO_CANONICAL.entries()) {
    if (new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`).test(key)) {
      return canonical;
    }
  }

  return null;
}

export function expandColorTermsForFilter(color: string): string[] {
  const canonical = normalizeColorToken(color) ?? color.toLowerCase();
  const aliases = COLOR_CANONICAL_ALIASES[canonical] ?? [canonical];
  const out = new Set<string>([canonical, ...aliases.map((a) => a.toLowerCase())]);
  return [...out];
}
