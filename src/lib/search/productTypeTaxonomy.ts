/**
 * Fashion product-type graph for recall (query expansion) and soft ranking.
 * Treats types as clusters + hypernyms — not string equality.
 */

/** Single-token / phrase keys normalized to lowercase. */
export const PRODUCT_TYPE_CLUSTERS: readonly (readonly string[])[] = [
  [
    "pants",
    "jeans",
    "chino",
    "chinos",
    "trouser",
    "trousers",
    "leggings",
    "legging",
    "jogger",
    "joggers",
    "sweatpants",
    "cargo pants",
    "cargo",
  ],
  [
    "shorts",
    "short",
    "bermuda",
    "board shorts",
  ],
  [
    "skirt",
    "skirts",
    "mini skirt",
    "midi skirt",
  ],
  [
    "shoes",
    "sneaker",
    "sneakers",
    "trainer",
    "trainers",
    "boot",
    "boots",
    "sandal",
    "sandals",
    "loafer",
    "loafers",
    "heel",
    "heels",
    "flat",
    "flats",
    "mule",
    "mules",
    "oxford",
    "oxfords",
    "pump",
    "pumps",
    "slide",
    "slides",
    "slipper",
    "slippers",
  ],
  ["hoodie", "hoodies", "sweatshirt", "sweatshirts", "pullover", "pullovers"],
  ["blazer", "blazers", "sport coat", "sportcoat"],
  ["sweater", "sweaters", "cardigan", "cardigans", "jumper", "jumpers"],
  ["tshirt", "tee", "tees", "shirt", "shirts", "blouse", "blouses", "top", "tops", "polo", "polos", "tank", "camisole"],
  ["dress", "dresses", "gown", "gowns", "jumpsuit", "jumpsuits", "romper", "rompers"],
  [
    "abaya",
    "abayas",
    "kaftan",
    "kaftans",
    "caftan",
    "caftans",
    "jalabiya",
    "jalabiyas",
    "thobe",
    "thobes",
    "dishdasha",
    "bisht",
  ],
  [
    "jacket",
    "jackets",
    "coat",
    "coats",
    "parka",
    "parkas",
    "trench",
    "windbreaker",
    "windbreakers",
    "vest",
    "vests",
    "gilet",
  ],
  [
    "sherwani",
    "kurta",
    "kurti",
    "kurtis",
    "salwar",
    "salwar kameez",
    "shalwar",
    "kameez",
    "churidar",
    "lengha",
    "lehenga",
    "sari",
    "saree",
    "dupatta",
    "dirac",
  ],
  ["hijab", "hijabs", "headscarf", "headscarves", "niqab", "burqa", "headwrap", "sheyla", "shayla"],
] as const;

/** Map specific surface forms to indexed hypernyms (adds recall without exploding all siblings on every doc). */
export const TYPE_TO_HYPERNYM: Record<string, string> = {
  jeans: "pants",
  chino: "pants",
  chinos: "pants",
  trouser: "pants",
  trousers: "pants",
  legging: "pants",
  leggings: "pants",
  jogger: "pants",
  joggers: "pants",
  sweatpants: "pants",
  pant: "pants",
  pants: "pants",
  cargo: "pants",

  sneaker: "shoes",
  sneakers: "shoes",
  trainer: "shoes",
  trainers: "shoes",
  boot: "shoes",
  boots: "shoes",
  sandal: "shoes",
  sandals: "shoes",
  loafer: "shoes",
  loafers: "shoes",
  heel: "shoes",
  heels: "shoes",
  flat: "shoes",
  flats: "shoes",
  mule: "shoes",
  mules: "shoes",
  oxford: "shoes",
  oxfords: "shoes",
  pump: "shoes",
  pumps: "shoes",
  slide: "shoes",
  slides: "shoes",
  slipper: "shoes",
  slippers: "shoes",
  shoe: "shoes",
  shoes: "shoes",

  abaya: "abaya",
  abayas: "abaya",
  kaftan: "kaftan",
  kaftans: "kaftan",
  caftan: "kaftan",
  caftans: "kaftan",
  jalabiya: "abaya",
  thobe: "abaya",
  thobes: "abaya",
  dishdasha: "abaya",
  bisht: "abaya",

  sherwani: "sherwani",
  kurta: "kurta",
  kurti: "kurti",
  kurtis: "kurti",
  salwar: "salwar",
  shalwar: "salwar",
  kameez: "kameez",
  churidar: "churidar",
  lengha: "lengha",
  lehenga: "lengha",
  sari: "sari",
  saree: "sari",
  dupatta: "dupatta",
  dirac: "dirac",
  hijab: "hijab",
  hijabs: "hijab",
  headscarf: "hijab",
  headscarves: "hijab",
  niqab: "niqab",
  burqa: "burqa",
  headwrap: "hijab",
  sheyla: "hijab",
  shayla: "hijab",
};

/**
 * Garment families for cross-family mismatch penalties (query vs document).
 * Index aligns with PRODUCT_TYPE_CLUSTERS order.
 */
const CLUSTER_FAMILY: readonly string[] = [
  "bottoms",
  "shorts_skirt",
  "shorts_skirt",
  "footwear",
  "tops",
  "outerwear",
  "tops",
  "tops",
  "dress",
  "modest_full",
  "outerwear",
  "modest_full",
  "head_covering",
] as const;

const FAMILY_PAIR_PENALTY: Record<string, Record<string, number>> = {
  modest_full: {
    bottoms: 1,
    shorts_skirt: 0.92,
    footwear: 0.48,
    tops: 0.58,
    dress: 0.2,
    outerwear: 0.25,
    head_covering: 0.22,
  },
  head_covering: {
    modest_full: 0.2,
    tops: 0.42,
    dress: 0.35,
    bottoms: 0.92,
    shorts_skirt: 0.8,
    footwear: 0.52,
    outerwear: 0.3,
  },
  dress: {
    bottoms: 0.88,
    shorts_skirt: 0.55,
    footwear: 0.38,
    tops: 0.35,
    modest_full: 0.22,
    outerwear: 0.18,
    head_covering: 0.32,
  },
  bottoms: {
    modest_full: 1,
    dress: 0.72,
    tops: 0.2,
    outerwear: 0.12,
    footwear: 0.15,
    head_covering: 0.88,
  },
  tops: {
    bottoms: 0.22,
    modest_full: 0.55,
    dress: 0.35,
    footwear: 0.2,
    shorts_skirt: 0.18,
    head_covering: 0.42,
  },
  footwear: {
    modest_full: 0.45,
    dress: 0.35,
    bottoms: 0.18,
    tops: 0.2,
    shorts_skirt: 0.15,
    head_covering: 0.5,
  },
  shorts_skirt: {
    modest_full: 0.85,
    dress: 0.45,
    footwear: 0.2,
    head_covering: 0.78,
  },
  outerwear: {
    modest_full: 0.22,
    dress: 0.15,
    head_covering: 0.28,
  },
};

let clusterIndex: Map<string, Set<string>> | null = null;
let typeToFamilyIndex: Map<string, string> | null = null;

function buildClusterIndex(): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const cluster of PRODUCT_TYPE_CLUSTERS) {
    const set = new Set<string>(cluster as readonly string[]);
    for (const t of cluster) {
      m.set(t, set);
    }
  }
  return m;
}

function buildTypeToFamily(): Map<string, string> {
  const m = new Map<string, string>();
  PRODUCT_TYPE_CLUSTERS.forEach((cluster, i) => {
    const fam = CLUSTER_FAMILY[i] ?? "other";
    for (const t of cluster) {
      m.set(t, fam);
    }
  });
  return m;
}

function getClusterIndex(): Map<string, Set<string>> {
  if (!clusterIndex) clusterIndex = buildClusterIndex();
  return clusterIndex;
}

function getTypeToFamily(): Map<string, string> {
  if (!typeToFamilyIndex) typeToFamilyIndex = buildTypeToFamily();
  return typeToFamilyIndex;
}

function familiesForTokens(tokens: string[]): Set<string> {
  const fam = getTypeToFamily();
  const out = new Set<string>();
  for (const raw of tokens) {
    const t = raw.toLowerCase().trim();
    if (!t) continue;
    const f = fam.get(t);
    if (f) out.add(f);
  }
  return out;
}

function pairPenalty(a: string, b: string): number {
  if (a === b) return 0;
  const row = FAMILY_PAIR_PENALTY[a];
  if (row && row[b] !== undefined) return row[b];
  const row2 = FAMILY_PAIR_PENALTY[b];
  if (row2 && row2[a] !== undefined) return row2[a];
  return 0;
}

let sortedTypePhrases: string[] | null = null;

/** All surface forms (longest-first) for lexical product-type detection in queries. */
export function getProductTypePhrasesLongestFirst(): string[] {
  if (sortedTypePhrases) return sortedTypePhrases;
  const s = new Set<string>();
  for (const cluster of PRODUCT_TYPE_CLUSTERS) {
    for (const t of cluster) s.add(String(t).toLowerCase().trim());
  }
  for (const k of Object.keys(TYPE_TO_HYPERNYM)) s.add(k.toLowerCase());
  sortedTypePhrases = [...s].filter(Boolean).sort((a, b) => b.length - a.length);
  return sortedTypePhrases;
}

/**
 * Cheap substring match of query against taxonomy phrases (when AST misses a type).
 */
export function extractLexicalProductTypeSeeds(rawQuery: string): string[] {
  const q = rawQuery
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!q) return [];
  const hits: string[] = [];
  for (const phrase of getProductTypePhrasesLongestFirst()) {
    if (!phrase || phrase.length < 2) continue;
    if (q.includes(phrase)) hits.push(phrase);
  }
  return [...new Set(hits)];
}

export function crossFamilyTypePenaltyEnabled(): boolean {
  const v = String(process.env.SEARCH_TYPE_CROSS_FAMILY_PENALTY ?? "1").toLowerCase();
  return v !== "0" && v !== "false" && v !== "off";
}

/**
 * 0 = no penalty; up to ~1 = strong mismatch (e.g. abaya query vs pants doc).
 * Skipped when taxonomy already agrees (exact or same cluster).
 */
export function scoreCrossFamilyTypePenalty(
  querySeeds: string[],
  docProductTypes: string[],
  opts?: { sameClusterWeight?: number },
): number {
  if (!crossFamilyTypePenaltyEnabled()) return 0;
  const seeds = querySeeds.map((s) => s.toLowerCase().trim()).filter(Boolean);
  if (seeds.length === 0) return 0;

  const expandedQuery = expandProductTypesForQuery(seeds);
  const tax = scoreProductTypeTaxonomyMatch(expandedQuery, docProductTypes, opts);
  if (tax.score >= (opts?.sameClusterWeight ?? 0.82)) return 0;

  const qFam = familiesForTokens(expandedQuery);
  const dFam = familiesForTokens(docProductTypes.map((t) => t.toLowerCase().trim()).filter(Boolean));
  if (qFam.size === 0 || dFam.size === 0) return 0;

  let max = 0;
  for (const qf of qFam) {
    for (const df of dFam) {
      max = Math.max(max, pairPenalty(qf, df));
    }
  }
  return max;
}

/** All types in the same cluster(s) as any of the seeds (query-side expansion). */
export function expandProductTypesForQuery(seeds: string[]): string[] {
  const idx = getClusterIndex();
  const out = new Set<string>();
  for (const s of seeds) {
    const key = s.toLowerCase().trim();
    if (!key) continue;
    out.add(key);
    const cluster = idx.get(key);
    if (cluster) {
      for (const t of cluster) out.add(t);
    }
  }
  return [...out];
}

/** Add hypernyms so e.g. jeans documents also match "pants" intents (index-time). */
export function expandProductTypesForIndexing(types: string[]): string[] {
  const out = new Set<string>();
  for (const t of types) {
    const key = t.toLowerCase().trim();
    if (!key) continue;
    out.add(key);
    const hyper = TYPE_TO_HYPERNYM[key];
    if (hyper) out.add(hyper);
  }
  return [...out];
}

export interface TaxonomyMatchResult {
  /** 0..1 */
  score: number;
  /** best matching query token */
  bestQueryType: string | null;
  /** best matching doc token */
  bestDocType: string | null;
}

/**
 * Soft type agreement: exact token match = 1; same cluster = hypernym weight; else 0.
 * Used after high-recall retrieval to avoid punishing "pants" vs "jeans".
 */
export function scoreProductTypeTaxonomyMatch(
  queryTypes: string[],
  docTypes: string[],
  opts?: { sameClusterWeight?: number },
): TaxonomyMatchResult {
  const wCluster = opts?.sameClusterWeight ?? 0.82;
  const q = new Set(queryTypes.map((t) => t.toLowerCase().trim()).filter(Boolean));
  const d = new Set(docTypes.map((t) => t.toLowerCase().trim()).filter(Boolean));
  if (q.size === 0) return { score: 0, bestQueryType: null, bestDocType: null };

  for (const qt of q) {
    if (d.has(qt)) {
      return { score: 1, bestQueryType: qt, bestDocType: qt };
    }
  }

  const idx = getClusterIndex();
  let best = 0;
  let bestQ: string | null = null;
  let bestD: string | null = null;

  for (const qt of q) {
    const cq = idx.get(qt);
    if (!cq) continue;
    for (const dt of d) {
      if (cq.has(dt)) {
        best = Math.max(best, wCluster);
        bestQ = qt;
        bestD = dt;
      }
    }
  }

  return { score: best, bestQueryType: bestQ, bestDocType: bestD };
}
