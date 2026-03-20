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
  ["tshirt", "tee", "tees", "shirt", "shirts", "blouse", "blouses", "top", "tops", "polo", "polos"],
  ["dress", "dresses", "gown", "gowns", "jumpsuit", "jumpsuits", "romper", "rompers"],
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
] as const;

/** Map specific surface forms to indexed hypernyms (adds recall without exploding all siblings on every doc). */
const TYPE_TO_HYPERNYM: Record<string, string> = {
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
};

let clusterIndex: Map<string, Set<string>> | null = null;

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

function getClusterIndex(): Map<string, Set<string>> {
  if (!clusterIndex) clusterIndex = buildClusterIndex();
  return clusterIndex;
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
