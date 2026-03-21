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
  return COLOR_ALIAS_TO_CANONICAL.get(key) ?? null;
}

export function expandColorTermsForFilter(color: string): string[] {
  const canonical = normalizeColorToken(color) ?? color.toLowerCase();
  const aliases = COLOR_CANONICAL_ALIASES[canonical] ?? [canonical];
  const out = new Set<string>([canonical, ...aliases.map((a) => a.toLowerCase())]);
  return [...out];
}
