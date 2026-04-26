import { COLOR_FAMILY_GROUPS, coarseColorBucket } from "./colorCanonical";

/**
 * Query-time color normalization and OpenSearch filter term expansion (shared by text + image search).
 */

export const COLOR_CANONICAL_ALIASES: Record<string, string[]> = {
  black: ["black", "charcoal", "dark gray", "dark grey", "jet", "onyx"],
  white: ["white", "off white", "off-white", "ivory", "cream", "ecru"],
  gray: ["gray", "grey", "heather grey", "heather gray", "silver"],
  blue: [
    "blue", "navy", "cobalt", "denim", "sky blue", "mid blue", "midnight blue",
    "royal blue", "royal-blue", "light blue", "light-blue", "powder blue", "baby blue",
    "teal", "turquoise", "indigo", "electric blue", "sapphire",
  ],
  red: ["red", "burgundy", "maroon", "wine", "cherry", "crimson", "scarlet"],
  green: [
    "green", "olive", "khaki", "sage", "mint", "forest green", "forest-green",
    "hunter green", "army green", "emerald", "lime", "moss",
  ],
  beige: ["beige", "taupe", "stone", "sand", "light khaki"],
  camel: ["camel", "tan", "camel brown", "light brown", "warm beige"],
  brown: ["brown", "mocha", "chocolate", "coffee", "caramel", "cognac", "rust brown"],
  purple: ["purple", "violet", "plum", "lavender", "lilac", "mauve", "grape", "orchid"],
  pink: [
    "pink", "blush", "fuchsia", "fuschia", "fushia", "fuhsia", "magenta",
    "rose", "hot pink", "dusty pink", "dusty rose", "salmon",
  ],
  yellow: ["yellow", "mustard", "golden", "gold", "lemon", "canary", "butter"],
  orange: ["orange", "rust", "peach", "coral", "burnt orange", "terracotta", "amber"],
  teal: ["teal", "turquoise", "aqua", "cyan", "peacock"],
  multicolor: ["multicolor", "multi color", "multi-color", "colour block", "color block", "printed", "pattern"],
};

const COLOR_COMMON_MISSPELLINGS: Record<string, string> = {
  fuschia: "fuchsia",
  fushia: "fuchsia",
  fuhsia: "fuchsia",
  magentaa: "magenta",
  biege: "beige",
  bordeuax: "bordeaux",
  burgendy: "burgundy",
  antracite: "anthracite",
  antrasite: "anthracite",
  drk: "dark",
  dk: "dark",
  lt: "light",
  offwhite: "off white",
  wht: "white",
  nvy: "navy",
};

const NON_COLOR_VALUE_RE =
  /^(?:null|none|n\/a|na|no photos?|standard|all hair type|kids?|short|long|regular|tall|one|m|s|xs|xl|2xl|3xl|4xl|5xl|l|\d+(?:\.\d+)?(?:\s?["”]|(?:\s?in(?:seam)?)|\s?eu|\s?ml)?|\d+[a-z]\d+.*)$/i;

const COLOR_NOISE_WORDS = new Set([
  "product", "code", "shade", "universal", "medium", "deep", "light", "dark",
  "mini", "full", "size", "mascara", "hydrator", "spf", "edition", "wash", "washed",
  "garment", "dyed", "heathered", "heather", "chine", "melange", "metallic", "suede",
  "plaid", "gingham", "stripe", "striped", "jacquard", "print", "printed", "allover",
  "twist", "grid", "block", "combo", "fun", "product", "code",
]);

const COLOR_ALIAS_TO_CANONICAL = (() => {
  const map = new Map<string, string>();
  for (const [canonical, aliases] of Object.entries(COLOR_CANONICAL_ALIASES)) {
    map.set(canonical, canonical);
    for (const alias of aliases) map.set(alias.toLowerCase(), canonical);
  }
  return map;
})();

const COLOR_BUCKET_TO_CANONICAL: Record<string, string> = {
  black: "black",
  white: "white",
  gray: "gray",
  blue: "blue",
  green: "green",
  red: "red",
  pink: "pink",
  purple: "purple",
  yellow: "yellow",
  orange: "orange",
  brown: "brown",
  teal: "teal",
  multicolor: "multicolor",
};

const GROUP_KEYWORD_HINTS: Record<string, string[]> = {
  white: [
    "bone", "alabaster", "porcelain", "vanilla", "ivory", "cream", "ecru", "off", "snow", "milk",
    "pearl", "eggshell", "chalk", "linen", "pale", "cloud", "frost", "buttermilk", "oat",
    "beech", "birch", "parchment", "flour", "crema", "coconut", "whipped cream",
  ],
  gray: [
    "graphite", "slate", "steel", "tungsten", "anthracite", "charcoal", "ash", "smoke", "mist",
    "silver", "pewter", "stone", "granite", "iron", "lead", "fog", "drizzle", "carbon",
  ],
  black: [
    "black", "noir", "onyx", "jet", "ebony", "caviar", "ink", "raven", "midnight", "obsidian",
  ],
  blue: [
    "navy", "blue", "indigo", "denim", "cobalt", "azure", "sky", "ocean", "marine", "royal",
    "sapphire", "teal blue", "lapis", "aqua blue", "turquin", "ultramarine", "chambray",
    "pelican", "atlantic", "sea glass", "spring lake", "longbay", "skywriting",
    "midnight", "inkwell", "ocean cavern", "estate blue", "ray blue",
  ],
  green: [
    "green", "olive", "kalamata", "moss", "sage", "mint", "forest", "leaf", "laurel", "thyme",
    "fennel", "kiwi", "emerald", "hunter", "army", "seagrass", "chlorophyll", "balsam",
    "scarab", "lily pad", "tapenade", "oregano", "eucalyptus", "leek", "pine", "juniper",
    "agave", "bay leaf", "artichoke", "field", "waterlily", "celadon",
  ],
  brown: [
    "brown", "camel", "tan", "beige", "taupe", "khaki", "cocoa", "mocha", "coffee", "espresso",
    "caramel", "cognac", "chestnut", "walnut", "hazel", "sand", "sahara", "toffee", "umber",
    "mahogany", "russet", "biscuit", "parchment", "canvas", "raffia", "peyote", "acorn",
    "truffle", "nutmeg", "ginger", "ochre", "earth", "stone", "desert",
    "tiger's eye", "tigereye", "brandy", "aged brass", "toasted coconut", "toasted almond",
    "russet", "farro", "clay", "cider", "fudge", "latte", "cappuccino", "coffee bean",
    "walnut", "wood", "cedarwood", "castagna", "moraine", "nutria",
  ],
  red: [
    "red", "burgundy", "bordeaux", "bordo", "maroon", "wine", "crimson", "scarlet", "ruby", "cherry",
    "sangria", "oxblood", "claret", "tomato", "cinnabar", "vermilion", "brick", "pepper",
    "merlot",
  ],
  pink: [
    "pink", "rose", "blush", "fuchsia", "magenta", "mauve", "peony", "berry", "raspberry",
    "bubblegum", "peachy", "nude", "dusty rose", "cotton candy", "lavaliere",
  ],
  purple: [
    "purple", "violet", "lilac", "lavender", "plum", "orchid", "aubergine", "amethyst", "grape",
    "wisteria",
  ],
  yellow: [
    "yellow", "gold", "mustard", "lemon", "canary", "butter", "banana", "sun", "amberlight",
    "dandelion", "corn", "citrine",
  ],
  orange: [
    "orange", "coral", "peach", "apricot", "terracotta", "rust", "tangerine", "papaya", "carrot",
    "amber", "cantaloupe",
  ],
  teal: [
    "teal", "turquoise", "aqua", "cyan", "peacock", "seafoam", "water", "lagoon", "aquarius",
    "kambaba", "deep sea", "undersea",
  ],
  multicolor: [
    "multi", "multico", "tie dye", "tie-dye", "print", "pattern", "plaid", "gingham", "stripes",
    "zebra", "leopard", "floral", "camo", "color block", "colour block", "mixed",
    "confetti", "moonsplatter", "check", "herringbone",
  ],
};

export type RawColorGroup =
  | "black"
  | "white"
  | "gray"
  | "blue"
  | "green"
  | "red"
  | "pink"
  | "purple"
  | "yellow"
  | "orange"
  | "brown"
  | "teal"
  | "multicolor"
  | "unknown";

function inferBucketFromKeywordHints(raw: string): string | null {
  const s = String(raw ?? "").toLowerCase();
  if (!s) return null;
  let best: string | null = null;
  let bestScore = 0;
  for (const [bucket, words] of Object.entries(GROUP_KEYWORD_HINTS)) {
    let score = 0;
    for (const w of words) {
      if (!w) continue;
      if (s === w) score += 4;
      else if (new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(s)) score += 2;
      else if (s.includes(w)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = bucket;
    }
  }
  return bestScore > 0 ? best : null;
}

const COLOR_FAMILY_CLUSTERS = COLOR_FAMILY_GROUPS.map((group) => {
  const normalizedMembers = group
    .map((v) => String(v ?? "").toLowerCase().replace(/[_-]/g, " ").trim())
    .filter(Boolean);
  const representative =
    normalizeColorFamilyRepresentative(normalizedMembers) ??
    normalizedMembers[0] ??
    "multicolor";
  return { normalizedMembers, representative };
});

function normalizeColorFamilyRepresentative(members: string[]): string | null {
  for (const m of members) {
    const canonical = COLOR_ALIAS_TO_CANONICAL.get(m);
    if (canonical) return canonical;
  }
  return null;
}

function inferColorFromFamilyCluster(raw: string): string | null {
  const key = String(raw ?? "")
    .toLowerCase()
    .replace(/["“”'`]/g, " ")
    .replace(/[()]/g, " ")
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!key) return null;

  let bestColor: string | null = null;
  let bestScore = 0;
  for (const cluster of COLOR_FAMILY_CLUSTERS) {
    let score = 0;
    for (const member of cluster.normalizedMembers) {
      if (!member) continue;
      if (key === member) score += 4;
      else if (key.includes(member)) score += 2;
      else {
        const words = member.split(" ").filter(Boolean);
        for (const w of words) {
          if (w.length < 3) continue;
          if (new RegExp(`\\b${w}\\b`).test(key)) score += 1;
        }
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestColor = cluster.representative;
    }
  }
  return bestScore > 0 ? bestColor : null;
}

/**
 * Assign every raw DB color value to a coarse color group.
 * Used for clustering/auditing noisy merchant values.
 */
export function inferColorGroupFromRaw(raw: string | null | undefined): RawColorGroup {
  if (!raw) return "unknown";
  const source = String(raw ?? "")
    .toLowerCase()
    .replace(/["“”'`]/g, " ")
    .replace(/[()]/g, " ")
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!source || NON_COLOR_VALUE_RE.test(source)) return "unknown";

  const candidates: string[] = [];
  const addCandidate = (token: string) => {
    const c = String(token ?? "").trim();
    if (!c) return;
    candidates.push(c);
    const normalized = normalizeColorToken(c) ?? inferColorFromFamilyCluster(c) ?? c;
    const bucket = coarseColorBucket(normalized);
    if (bucket) candidates.push(bucket);
  };

  addCandidate(source);
  const parts = source
    .replace(/\band\b/g, ",")
    .replace(/\\/g, "/")
    .split(/[\/,&+|,-]/g)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const p of parts) {
    if (NON_COLOR_VALUE_RE.test(p)) continue;
    if (/^\d+([.\s]\d+)?$/.test(p)) continue;
    addCandidate(p);
    const words = p.split(/\s+/g).filter(Boolean);
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (COLOR_NOISE_WORDS.has(w)) continue;
      addCandidate(w);
      if (i < words.length - 1) addCandidate(`${w} ${words[i + 1]}`);
    }
  }

  const votes = new Map<string, number>();
  for (const token of candidates) {
    const bucket = coarseColorBucket(token);
    if (!bucket) continue;
    votes.set(bucket, (votes.get(bucket) ?? 0) + 1);
  }

  if (votes.size === 0) {
    const hinted = inferBucketFromKeywordHints(source);
    return (hinted as RawColorGroup) ?? "unknown";
  }
  let winner = "unknown";
  let maxVotes = -1;
  for (const [bucket, count] of votes.entries()) {
    if (count > maxVotes) {
      maxVotes = count;
      winner = bucket;
    }
  }
  if (winner === "unknown") {
    const hinted = inferBucketFromKeywordHints(source);
    if (hinted) return hinted as RawColorGroup;
  }
  return winner as RawColorGroup;
}

export function normalizeColorToken(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const keyBase = raw
    .toLowerCase()
    .replace(/["“”'`]/g, " ")
    .replace(/[()]/g, " ")
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!keyBase || NON_COLOR_VALUE_RE.test(keyBase)) return null;
  const key = COLOR_COMMON_MISSPELLINGS[keyBase] ?? keyBase;
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

  // Family-cluster fallback for noisy merchant strings.
  const clustered = inferColorFromFamilyCluster(key);
  if (clustered) return clustered;

  return null;
}

/**
 * Parse noisy DB color strings into canonical color tokens.
 * Handles formats like "WHITE / NAVY BLUE", "Black Plaid", "CN 58 - Honey", etc.
 */
export function normalizeColorTokensFromRaw(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const source = String(raw).toLowerCase().trim();
  if (!source || NON_COLOR_VALUE_RE.test(source)) return [];

  const out: string[] = [];
  const add = (token: string) => {
    const norm = normalizeColorToken(token) ?? inferColorFromFamilyCluster(token);
    if (norm && !out.includes(norm)) out.push(norm);
  };

  // 1) Whole-phrase attempt first for values like "mid wash denim".
  add(source);

  // 2) Split composite merchant formats.
  const parts = source
    .replace(/\band\b/g, ",")
    .replace(/\\/g, "/")
    .split(/[\/,&+|,-]/g)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const p of parts) {
    if (NON_COLOR_VALUE_RE.test(p)) continue;
    if (/^\d+([.\s]\d+)?$/.test(p)) continue;
    add(p);

    // 3) Token-level fallback for noisy chunks ("khaki green", "grey chine", "flashy yellow").
    const words = p.split(/\s+/g).filter(Boolean);
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (COLOR_NOISE_WORDS.has(w)) continue;
      add(w);
      if (i < words.length - 1) add(`${w} ${words[i + 1]}`);
    }
  }

  if (out.length === 0) {
    const group = inferColorGroupFromRaw(source);
    const canonical = COLOR_BUCKET_TO_CANONICAL[group];
    if (canonical) out.push(canonical);
  }

  return out;
}

export function expandColorTermsForFilter(color: string): string[] {
  const canonical = normalizeColorToken(color) ?? color.toLowerCase();
  const aliases = COLOR_CANONICAL_ALIASES[canonical] ?? [canonical];
  const out = new Set<string>([canonical, ...aliases.map((a) => a.toLowerCase())]);
  return [...out];
}
