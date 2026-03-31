/**
 * Fashion product-type graph for recall (query expansion) and ranking.
 *
 * - Each `PRODUCT_TYPE_CLUSTERS` entry is a **narrow micro-cluster** (exact-ish synonyms only).
 * - **Intra-family** mismatch penalties apply when query and document fall in the same macro
 *   family (bottoms, footwear, tops, …) but different micro-clusters (e.g. sneakers vs boots).
 * - **Cross-family** penalties use `FAMILY_PAIR_PENALTY` (dress vs pants, etc.).
 */

/** Narrow micro-clusters — avoid mega-clusters that equate unrelated garment types. */
export const PRODUCT_TYPE_CLUSTERS: readonly (readonly string[])[] = [
  // Bottoms (4)
  ["jogger", "joggers", "sweatpants", "track pants", "jogging pants", "jogging bottoms", "trackpants"],
  ["legging", "leggings", "tights"],
  ["jean", "jeans", "denim", "denims"],
  ["pant", "pants", "trouser", "trousers", "chino", "chinos", "cargo pants", "cargo", "slacks"],
  // Shorts / skirt (2)
  ["shorts", "short", "bermuda", "board shorts"],
  ["skirt", "skirts", "mini skirt", "midi skirt"],
  // Footwear (7) — was one mega-cluster; now siblings are distinguishable in rerank
  ["sneaker", "sneakers", "trainer", "trainers", "shoe", "shoes"],
  ["boot", "boots", "ankle boot", "chelsea boot"],
  ["sandal", "sandals", "flip flop", "flip flops"],
  ["heel", "heels", "pump", "pumps", "stiletto", "stilettos"],
  ["flat", "flats", "ballerina", "ballet flat", "loafer", "loafers", "oxford", "oxfords", "brogue", "brogues"],
  ["mule", "mules", "slide", "slides", "clog", "clogs"],
  ["slipper", "slippers", "slip-on", "slip on", "slip ons", "slip-ons", "espadrille", "espadrilles"],
  // Tops (6)
  ["hoodie", "hoodies", "sweatshirt", "sweatshirts", "pullover", "pullovers"],
  ["sweater", "sweaters", "cardigan", "cardigans", "jumper", "jumpers", "knitwear"],
  ["shirt", "shirts", "blouse", "blouses", "button down", "button-down"],
  ["tshirt", "tee", "tees", "t-shirt", "tank", "camisole", "camis"],
  ["top", "tops", "cami"],
  ["polo", "polos", "polo shirt"],
  // Outerwear (2)
  ["blazer", "blazers", "sport coat", "sportcoat", "suit jacket"],
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
    "poncho",
    "anorak",
    "bomber",
    "bomber jacket",
  ],
  // Dress (2)
  ["dress", "dresses", "gown", "gowns", "frock", "midi dress", "maxi dress", "mini dress"],
  ["jumpsuit", "jumpsuits", "romper", "rompers", "playsuit", "playsuits"],
  // Modest / regional (2)
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
  // Accessories (cross-family vs apparel / footwear)
  [
    "bag",
    "bags",
    "handbag",
    "handbags",
    "tote",
    "totes",
    "clutch",
    "clutches",
    "purse",
    "purses",
    "backpack",
    "backpacks",
    "crossbody",
    "satchel",
    "satchels",
    "wallet",
    "wallets",
    "bucket bag",
    "shoulder bag",
  ],
  ["hat", "hats", "cap", "caps", "beanie", "beanies", "beret", "berets"],
  ["scarf", "scarves", "shawl", "shawls", "wrap", "wraps", "stole", "stoles"],
  ["belt", "belts"],
  ["sock", "socks", "hosiery", "stocking", "stockings"],
  [
    "necklace",
    "necklaces",
    "earring",
    "earrings",
    "bracelet",
    "bracelets",
    "ring",
    "rings",
    "jewellery",
    "jewelry",
    "pendant",
    "pendants",
    "brooch",
    "brooches",
    "anklet",
    "anklets",
    "choker",
    "chokers",
  ],
] as const;

/** Map specific surface forms to indexed hypernyms (index-time recall). */
export const TYPE_TO_HYPERNYM: Record<string, string> = {
  jeans: "pants",
  jean: "pants",
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

  blazer: "outerwear",
  blazers: "outerwear",
  jacket: "outerwear",
  jackets: "outerwear",
  coat: "outerwear",
  coats: "outerwear",

  tote: "bag",
  totes: "bag",
  clutch: "bag",
  clutches: "bag",
  purse: "bag",
  purses: "bag",
  backpack: "bag",
  backpacks: "bag",
  satchel: "bag",
  satchels: "bag",
  crossbody: "bag",
  handbag: "bag",
  handbags: "bag",
  wallet: "bag",
  wallets: "bag",
  hat: "hat",
  hats: "hat",
  cap: "hat",
  caps: "hat",
  beanie: "hat",
  beanies: "hat",
  beret: "hat",
  berets: "hat",
  scarf: "scarf",
  scarves: "scarf",
  shawl: "scarf",
  shawls: "scarf",
  wrap: "scarf",
  wraps: "scarf",
  stole: "scarf",
  stoles: "scarf",
  belt: "belt",
  belts: "belt",
  sock: "sock",
  socks: "sock",
  hosiery: "sock",
  stocking: "sock",
  stockings: "sock",

  earring: "jewellery",
  earrings: "jewellery",
  bracelet: "jewellery",
  bracelets: "jewellery",
  pendant: "jewellery",
  pendants: "jewellery",
  brooch: "jewellery",
  brooches: "jewellery",
  anklet: "jewellery",
  anklets: "jewellery",
  choker: "jewellery",
  chokers: "jewellery",
  jewelry: "jewellery",
  necklace: "jewellery",
  necklaces: "jewellery",
  ring: "jewellery",
  rings: "jewellery",
  jewellery: "jewellery",
  bag: "bag",
  bags: "bag",
};

/**
 * Macro family per cluster — order must match `PRODUCT_TYPE_CLUSTERS` exactly.
 * (Length must equal `PRODUCT_TYPE_CLUSTERS.length`; a past off-by-one here mapped
 * `dress` → `outerwear` and broke `filterProductTypeSeedsByMappedCategory`.)
 */
const CLUSTER_FAMILY: readonly string[] = [
  "bottoms",
  "bottoms",
  "bottoms",
  "bottoms",
  "shorts_skirt",
  "shorts_skirt",
  "footwear",
  "footwear",
  "footwear",
  "footwear",
  "footwear",
  "footwear",
  "footwear",
  "tops",
  "tops",
  "tops",
  "tops",
  "tops",
  "tops",
  "outerwear",
  "outerwear",
  "dress",
  "dress",
  "modest_full",
  "modest_full",
  "head_covering",
  "bags",
  "head_covering",
  "head_covering",
  "jewellery",
  "jewellery",
  "jewellery",
];

const FAMILY_PAIR_PENALTY: Record<string, Record<string, number>> = {
  modest_full: {
    bottoms: 1,
    shorts_skirt: 0.92,
    footwear: 0.48,
    tops: 0.58,
    dress: 0.2,
    outerwear: 0.25,
    head_covering: 0.22,
    bags: 0.88,
    jewellery: 0.82,
  },
  head_covering: {
    modest_full: 0.2,
    tops: 0.42,
    dress: 0.35,
    bottoms: 0.92,
    shorts_skirt: 0.8,
    footwear: 0.52,
    outerwear: 0.3,
    bags: 0.85,
    jewellery: 0.78,
  },
  dress: {
    bottoms: 0.88,
    shorts_skirt: 0.55,
    footwear: 1,
    tops: 0.35,
    modest_full: 0.22,
    outerwear: 0.18,
    head_covering: 0.32,
    bags: 0.9,
    jewellery: 0.85,
  },
  bottoms: {
    modest_full: 1,
    dress: 0.72,
    tops: 0.2,
    outerwear: 0.12,
    footwear: 0.92,
    head_covering: 0.88,
    bags: 0.9,
    jewellery: 0.85,
  },
  tops: {
    bottoms: 0.22,
    modest_full: 0.55,
    dress: 0.35,
    footwear: 0.92,
    shorts_skirt: 0.18,
    head_covering: 0.42,
    bags: 0.9,
    jewellery: 0.85,
  },
  footwear: {
    modest_full: 0.45,
    dress: 1,
    bottoms: 0.92,
    tops: 0.92,
    shorts_skirt: 0.88,
    outerwear: 0.92,
    head_covering: 0.5,
    bags: 0.9,
    jewellery: 0.85,
  },
  shorts_skirt: {
    modest_full: 0.85,
    dress: 0.45,
    footwear: 0.88,
    head_covering: 0.78,
    bags: 0.9,
    jewellery: 0.85,
  },
  outerwear: {
    modest_full: 0.22,
    dress: 0.15,
    head_covering: 0.28,
    footwear: 0.92,
    bags: 0.9,
    jewellery: 0.85,
  },
  bags: {
    modest_full: 0.88,
    head_covering: 0.85,
    dress: 0.9,
    bottoms: 0.9,
    tops: 0.9,
    footwear: 0.9,
    shorts_skirt: 0.9,
    outerwear: 0.9,
    jewellery: 0.65,
  },
  jewellery: {
    modest_full: 0.82,
    head_covering: 0.78,
    dress: 0.85,
    bottoms: 0.85,
    tops: 0.85,
    footwear: 0.85,
    shorts_skirt: 0.85,
    outerwear: 0.85,
    bags: 0.65,
  },
};

function buildSymmetricFromList(pairs: [string, string, number][]): Record<string, Record<string, number>> {
  const ids = new Set<string>();
  for (const [a, b] of pairs) {
    ids.add(a);
    ids.add(b);
  }
  const out: Record<string, Record<string, number>> = {};
  for (const id of ids) {
    out[id] = {};
    for (const id2 of ids) {
      out[id][id2] = id === id2 ? 0 : 0;
    }
  }
  for (const [a, b, p] of pairs) {
    out[a][b] = Math.max(out[a][b], p);
    out[b][a] = Math.max(out[b][a], p);
  }
  return out;
}

function lookupPairPenalty(
  tbl: Record<string, Record<string, number>>,
  a: string,
  b: string,
): number {
  if (a === b) return 0;
  return tbl[a]?.[b] ?? 0;
}

/** Symmetric intra-family penalty tables (all fashion families with micro-types). */
const BOTTOM_PENALTY_TBL = buildSymmetricFromList([
  ["m_bt_jog", "m_bt_leg", 0.52],
  ["m_bt_jog", "m_bt_jean", 0.45],
  ["m_bt_jog", "m_bt_tail", 0.38],
  ["m_bt_leg", "m_bt_jean", 0.48],
  ["m_bt_leg", "m_bt_tail", 0.42],
  ["m_bt_jean", "m_bt_tail", 0.35],
]);

const SHORTS_SKIRT_PENALTY_TBL = buildSymmetricFromList([["shorts", "skirt", 0.58]]);

const FOOTWEAR_PENALTY_TBL = buildSymmetricFromList([
  ["m_ft_ath", "m_ft_boot", 0.42],
  ["m_ft_ath", "m_ft_sand", 0.45],
  ["m_ft_ath", "m_ft_heel", 0.52],
  ["m_ft_ath", "m_ft_flat", 0.48],
  ["m_ft_ath", "m_ft_mule", 0.46],
  ["m_ft_ath", "m_ft_slip", 0.5],
  ["m_ft_boot", "m_ft_sand", 0.44],
  ["m_ft_boot", "m_ft_heel", 0.5],
  ["m_ft_boot", "m_ft_flat", 0.46],
  ["m_ft_boot", "m_ft_mule", 0.48],
  ["m_ft_boot", "m_ft_slip", 0.52],
  ["m_ft_sand", "m_ft_heel", 0.48],
  ["m_ft_sand", "m_ft_flat", 0.44],
  ["m_ft_sand", "m_ft_mule", 0.4],
  ["m_ft_sand", "m_ft_slip", 0.46],
  ["m_ft_heel", "m_ft_flat", 0.42],
  ["m_ft_heel", "m_ft_mule", 0.45],
  ["m_ft_heel", "m_ft_slip", 0.5],
  ["m_ft_flat", "m_ft_mule", 0.38],
  ["m_ft_flat", "m_ft_slip", 0.45],
  ["m_ft_mule", "m_ft_slip", 0.4],
]);

const TOPS_PENALTY_TBL = buildSymmetricFromList([
  ["m_tp_hood", "m_tp_knit", 0.38],
  ["m_tp_hood", "m_tp_shirt", 0.44],
  ["m_tp_hood", "m_tp_tee", 0.42],
  ["m_tp_hood", "m_tp_gen", 0.4],
  ["m_tp_hood", "m_tp_polo", 0.43],
  ["m_tp_knit", "m_tp_shirt", 0.4],
  ["m_tp_knit", "m_tp_tee", 0.42],
  ["m_tp_knit", "m_tp_gen", 0.38],
  ["m_tp_knit", "m_tp_polo", 0.4],
  ["m_tp_shirt", "m_tp_tee", 0.36],
  ["m_tp_shirt", "m_tp_gen", 0.35],
  ["m_tp_shirt", "m_tp_polo", 0.34],
  ["m_tp_tee", "m_tp_gen", 0.32],
  ["m_tp_tee", "m_tp_polo", 0.35],
  ["m_tp_gen", "m_tp_polo", 0.34],
]);

const DRESS_PENALTY_TBL = buildSymmetricFromList([["m_dr_dress", "m_dr_jump", 0.52]]);

const MODEST_PENALTY_TBL = buildSymmetricFromList([["m_md_abaya", "m_md_eth", 0.55]]);

const HEAD_PENALTY_TBL = buildSymmetricFromList([["m_hd_hijab", "m_hd_face", 0.5]]);

/** Canonical micro-ids for symmetric penalty tables (same macro family, different item). */
const BOTTOM_MICRO = {
  jogger: "m_bt_jog",
  legging: "m_bt_leg",
  jeans: "m_bt_jean",
  tailored: "m_bt_tail",
} as const;

export function bottomMicroGroup(token: string): keyof typeof BOTTOM_MICRO | null {
  const t = token.toLowerCase().trim();
  if (!t) return null;
  const jog = new Set([
    "jogger",
    "joggers",
    "sweatpants",
    "track pants",
    "jogging pants",
    "jogging bottoms",
    "trackpants",
  ]);
  const leg = new Set(["legging", "leggings", "tights"]);
  const jean = new Set(["jean", "jeans", "denim", "denims"]);
  const tail = new Set(["pant", "pants", "trouser", "trousers", "chino", "chinos", "cargo", "cargo pants", "slacks"]);
  if (jog.has(t)) return "jogger";
  if (leg.has(t)) return "legging";
  if (jean.has(t)) return "jeans";
  if (tail.has(t)) return "tailored";
  return null;
}

const SHORTS_MICRO = new Set(["shorts", "short", "bermuda", "board shorts"]);
const SKIRT_MICRO = new Set(["skirt", "skirts", "mini skirt", "midi skirt"]);

function shortsSkirtMicro(token: string): "shorts" | "skirt" | null {
  const t = token.toLowerCase().trim();
  if (SHORTS_MICRO.has(t)) return "shorts";
  if (SKIRT_MICRO.has(t)) return "skirt";
  return null;
}

/** Footwear micro-ids align with cluster splits (order matches clusters 6–12). */
const FOOTWEAR_MICRO = {
  athletic: "m_ft_ath",
  boot: "m_ft_boot",
  sandal: "m_ft_sand",
  heel: "m_ft_heel",
  flat_dress: "m_ft_flat",
  mule_slide: "m_ft_mule",
  slipper: "m_ft_slip",
} as const;

export function footwearMicroGroup(token: string): keyof typeof FOOTWEAR_MICRO | null {
  const t = token.toLowerCase().trim();
  if (!t) return null;
  const athletic = new Set(["sneaker", "sneakers", "trainer", "trainers", "shoe", "shoes"]);
  const boot = new Set(["boot", "boots", "ankle boot", "chelsea boot"]);
  const sandal = new Set(["sandal", "sandals", "flip flop", "flip flops"]);
  const heel = new Set(["heel", "heels", "pump", "pumps", "stiletto", "stilettos"]);
  const flatDress = new Set([
    "flat",
    "flats",
    "ballerina",
    "ballet flat",
    "loafer",
    "loafers",
    "oxford",
    "oxfords",
    "brogue",
    "brogues",
  ]);
  const mule = new Set(["mule", "mules", "slide", "slides", "clog", "clogs"]);
  const slipper = new Set([
    "slipper",
    "slippers",
    "slip-on",
    "slip on",
    "slip ons",
    "slip-ons",
    "espadrille",
    "espadrilles",
  ]);
  if (athletic.has(t)) return "athletic";
  if (boot.has(t)) return "boot";
  if (sandal.has(t)) return "sandal";
  if (heel.has(t)) return "heel";
  if (flatDress.has(t)) return "flat_dress";
  if (mule.has(t)) return "mule_slide";
  if (slipper.has(t)) return "slipper";
  return null;
}

const TOPS_MICRO = {
  hoodie: "m_tp_hood",
  knit: "m_tp_knit",
  shirt: "m_tp_shirt",
  tee: "m_tp_tee",
  generic_top: "m_tp_gen",
  polo: "m_tp_polo",
} as const;

export function topsMicroGroup(token: string): keyof typeof TOPS_MICRO | null {
  const t = token.toLowerCase().trim();
  if (!t) return null;
  if (new Set(["hoodie", "hoodies", "sweatshirt", "sweatshirts", "pullover", "pullovers"]).has(t)) return "hoodie";
  if (new Set(["sweater", "sweaters", "cardigan", "cardigans", "jumper", "jumpers", "knitwear"]).has(t)) return "knit";
  if (new Set(["shirt", "shirts", "blouse", "blouses", "button down", "button-down"]).has(t)) return "shirt";
  if (new Set(["tshirt", "tee", "tees", "t-shirt", "tank", "camisole", "camis"]).has(t)) return "tee";
  if (new Set(["top", "tops", "cami"]).has(t)) return "generic_top";
  if (new Set(["polo", "polos", "polo shirt"]).has(t)) return "polo";
  return null;
}

const OUTER_MICRO_BLAZER = new Set([
  "blazer",
  "blazers",
  "sport coat",
  "sportcoat",
  "suit jacket",
]);
const OUTER_MICRO_JACKET = new Set([
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
  "poncho",
  "anorak",
  "bomber",
  "bomber jacket",
]);

function outerMicroGroup(token: string): "blazer" | "jacket" | null {
  const t = token.toLowerCase().trim();
  if (OUTER_MICRO_BLAZER.has(t)) return "blazer";
  if (OUTER_MICRO_JACKET.has(t)) return "jacket";
  return null;
}

const OUTER_PAIR_PENALTY: Record<string, Record<string, number>> = {
  blazer: { blazer: 0, jacket: 0.48 },
  jacket: { blazer: 0.48, jacket: 0 },
};

const DRESS_MICRO = {
  dress: "m_dr_dress",
  jumpsuit: "m_dr_jump",
} as const;

function dressMicroGroup(token: string): keyof typeof DRESS_MICRO | null {
  const t = token.toLowerCase().trim();
  if (
    new Set([
      "dress",
      "dresses",
      "gown",
      "gowns",
      "frock",
      "midi dress",
      "maxi dress",
      "mini dress",
    ]).has(t)
  )
    return "dress";
  if (new Set(["jumpsuit", "jumpsuits", "romper", "rompers", "playsuit", "playsuits"]).has(t)) return "jumpsuit";
  return null;
}

const MODEST_MICRO = {
  abaya_row: "m_md_abaya",
  ethnic_south_asian: "m_md_eth",
} as const;

function modestEthnicMicroGroup(token: string): keyof typeof MODEST_MICRO | null {
  const t = token.toLowerCase().trim();
  if (
    new Set([
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
    ]).has(t)
  )
    return "abaya_row";
  if (
    new Set([
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
    ]).has(t)
  )
    return "ethnic_south_asian";
  return null;
}

const HEAD_MICRO = {
  hijab_scarf: "m_hd_hijab",
  face: "m_hd_face",
} as const;

function headMicroGroup(token: string): keyof typeof HEAD_MICRO | null {
  const t = token.toLowerCase().trim();
  if (new Set(["hijab", "hijabs", "headscarf", "headscarves", "headwrap", "sheyla", "shayla"]).has(t)) return "hijab_scarf";
  if (new Set(["niqab", "burqa"]).has(t)) return "face";
  return null;
}

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

function escapeRegexForLexical(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeForLexicalMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function phraseMatchesWholeWords(queryNorm: string, phrase: string): boolean {
  const pn = normalizeForLexicalMatch(phrase);
  if (!pn || pn.length < 2) return false;
  const words = pn.split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  const core = words.map(escapeRegexForLexical).join("\\s+");
  const re = new RegExp(`\\b(?:${core})\\b`, "i");
  return re.test(queryNorm);
}

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

export function extractLexicalProductTypeSeeds(rawQuery: string): string[] {
  const qNorm = normalizeForLexicalMatch(rawQuery);
  if (!qNorm) return [];
  const hits: string[] = [];
  for (const phrase of getProductTypePhrasesLongestFirst()) {
    if (!phrase || phrase.length < 2) continue;
    if (phraseMatchesWholeWords(qNorm, phrase)) hits.push(phrase);
  }
  const fam = getTypeToFamily();
  for (const w of qNorm.split(/\s+/)) {
    if (w.length < 2) continue;
    if (fam.has(w)) hits.push(w);
  }
  return [...new Set(hits)];
}

/** Map vision/catalog aisle strings to taxonomy macro families (tops, dress, outerwear, …). */
export function intentFamiliesForProductCategory(productCategory: string): Set<string> | null {
  const c = String(productCategory || "")
    .toLowerCase()
    .trim()
    .replace(/[\s_-]+/g, " ");
  const m: Record<string, readonly string[]> = {
    dresses: ["dress"],
    tops: ["tops"],
    bottoms: ["bottoms", "shorts_skirt"],
    outerwear: ["outerwear"],
    footwear: ["footwear"],
    bags: ["bags"],
    accessories: ["head_covering", "bags", "jewellery"],
  };
  const list = m[c];
  if (!list) return null;
  return new Set(list);
}

function familiesForExpandedSeed(seed: string): Set<string> {
  const t = String(seed || "")
    .toLowerCase()
    .trim();
  if (!t) return new Set();
  return familiesForTokens(expandProductTypesForQuery([t]));
}

/**
 * Drop lexical type seeds whose taxonomy macro-family does not match the mapped product aisle.
 * Prevents compound labels (e.g. "vest dress" → dress + vest tokens) from pulling in sibling
 * clusters in another family (vest ↔ coat/jacket), and the same class of bug for tops/bottoms/etc.
 */
export function filterProductTypeSeedsByMappedCategory(
  seeds: string[],
  productCategory: string,
): string[] {
  const allowed = intentFamiliesForProductCategory(productCategory);
  if (!allowed || seeds.length === 0) return seeds;

  const kept = seeds.filter((seed) => {
    const fams = familiesForExpandedSeed(String(seed));
    if (fams.size === 0) return true;
    for (const f of fams) {
      if (allowed.has(f)) return true;
    }
    return false;
  });

  return kept.length > 0 ? kept : seeds;
}

/** Whole-word fashion product nouns — backs `hasTypeIntent` when AST misses type entities. */
const FASHION_TYPE_NOUNS = new Set([
  "dress",
  "gown",
  "top",
  "blouse",
  "shirt",
  "tee",
  "pants",
  "jeans",
  "trousers",
  "skirt",
  "jacket",
  "blazer",
  "coat",
  "cardigan",
  "hoodie",
  "sweater",
  "shorts",
  "suit",
  "jumpsuit",
  "romper",
  "vest",
  "leggings",
  "boot",
  "boots",
  "shoe",
  "shoes",
  "sneaker",
  "sneakers",
  "heel",
  "heels",
  "sandal",
  "sandals",
  "trainer",
  "trainers",
  "pump",
  "pumps",
  "loafer",
  "loafers",
  "mule",
  "mules",
  "bag",
  "handbag",
  "tote",
  "clutch",
  "purse",
  "backpack",
  "satchel",
  "wallet",
  "belt",
  "scarf",
  "hat",
  "cap",
  "gloves",
  "sunglasses",
]);

function fashionNounStemCandidates(token: string): string[] {
  const t = token.toLowerCase();
  const out = new Set<string>([t]);
  if (t.length > 3 && t.endsWith("ies")) {
    out.add(t.slice(0, -3) + "y");
  }
  if (t.length > 3 && t.endsWith("es")) {
    out.add(t.slice(0, -2));
  }
  if (t.length > 2 && t.endsWith("s") && !t.endsWith("ss")) {
    out.add(t.slice(0, -1));
  }
  return [...out];
}

/**
 * Explicit garment/footwear/accessory nouns from tokenized query text.
 * Complements {@link extractLexicalProductTypeSeeds} when NLP leaves product types out of AST entities.
 */
export function extractFashionTypeNounTokens(rawQuery: string): string[] {
  const qNorm = normalizeForLexicalMatch(rawQuery);
  if (!qNorm) return [];
  const found: string[] = [];
  for (const w of qNorm.split(/\s+/)) {
    if (w.length < 2) continue;
    for (const cand of fashionNounStemCandidates(w)) {
      if (FASHION_TYPE_NOUNS.has(cand)) {
        found.push(cand);
        break;
      }
    }
  }
  return [...new Set(found)];
}

export function crossFamilyTypePenaltyEnabled(): boolean {
  const v = String(process.env.SEARCH_TYPE_CROSS_FAMILY_PENALTY ?? "1").toLowerCase();
  return v !== "0" && v !== "false" && v !== "off";
}

/**
 * Max penalty when query and document tokens are in the same macro family but different
 * garment micro-types (covers all major fashion families in this taxonomy).
 */
function intraFamilySubtypePenalty(querySeeds: string[], docTypes: string[]): number {
  const seeds = querySeeds.map((s) => s.toLowerCase().trim()).filter(Boolean);
  const docs = docTypes.map((s) => s.toLowerCase().trim()).filter(Boolean);
  if (seeds.length === 0 || docs.length === 0) return 0;

  let maxPen = 0;

  for (const s of seeds) {
    for (const d of docs) {
      const bq = bottomMicroGroup(s);
      const bd = bottomMicroGroup(d);
      if (bq && bd) {
        const ia = BOTTOM_MICRO[bq];
        const ib = BOTTOM_MICRO[bd];
        maxPen = Math.max(maxPen, lookupPairPenalty(BOTTOM_PENALTY_TBL, ia, ib));
      }

      const fq = footwearMicroGroup(s);
      const fd = footwearMicroGroup(d);
      if (fq && fd) {
        maxPen = Math.max(
          maxPen,
          lookupPairPenalty(FOOTWEAR_PENALTY_TBL, FOOTWEAR_MICRO[fq], FOOTWEAR_MICRO[fd]),
        );
      }

      const tq = topsMicroGroup(s);
      const td = topsMicroGroup(d);
      if (tq && td) {
        maxPen = Math.max(
          maxPen,
          lookupPairPenalty(TOPS_PENALTY_TBL, TOPS_MICRO[tq], TOPS_MICRO[td]),
        );
      }

      const oq = outerMicroGroup(s);
      const od = outerMicroGroup(d);
      if (oq && od) {
        maxPen = Math.max(maxPen, OUTER_PAIR_PENALTY[oq][od] ?? 0);
      }

      const dq = dressMicroGroup(s);
      const dd = dressMicroGroup(d);
      if (dq && dd) {
        maxPen = Math.max(
          maxPen,
          lookupPairPenalty(DRESS_PENALTY_TBL, DRESS_MICRO[dq], DRESS_MICRO[dd]),
        );
      }

      const sq = shortsSkirtMicro(s);
      const sd = shortsSkirtMicro(d);
      if (sq && sd) {
        maxPen = Math.max(maxPen, lookupPairPenalty(SHORTS_SKIRT_PENALTY_TBL, sq, sd));
      }

      const mq = modestEthnicMicroGroup(s);
      const md = modestEthnicMicroGroup(d);
      if (mq && md) {
        maxPen = Math.max(
          maxPen,
          lookupPairPenalty(MODEST_PENALTY_TBL, MODEST_MICRO[mq], MODEST_MICRO[md]),
        );
      }

      const hq = headMicroGroup(s);
      const hd = headMicroGroup(d);
      if (hq && hd) {
        maxPen = Math.max(maxPen, lookupPairPenalty(HEAD_PENALTY_TBL, HEAD_MICRO[hq], HEAD_MICRO[hd]));
      }
    }
  }
  return maxPen;
}

export function scoreCrossFamilyTypePenalty(
  querySeeds: string[],
  docProductTypes: string[],
  _opts?: { sameClusterWeight?: number },
): number {
  if (!crossFamilyTypePenaltyEnabled()) return 0;
  const seeds = querySeeds.map((s) => s.toLowerCase().trim()).filter(Boolean);
  if (seeds.length === 0) return 0;

  const expandedQuery = expandProductTypesForQuery(seeds);
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
  score: number;
  bestQueryType: string | null;
  bestDocType: string | null;
}

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

export function scoreHypernymDocMatch(querySeeds: string[], docTypes: string[]): number {
  const seeds = querySeeds.map((s) => s.toLowerCase().trim()).filter(Boolean);
  const d = new Set(docTypes.map((t) => t.toLowerCase().trim()).filter(Boolean));
  if (seeds.length === 0 || d.size === 0) return 0;
  for (const s of seeds) {
    const hyper = TYPE_TO_HYPERNYM[s];
    if (hyper && d.has(hyper)) return 0.54;
  }
  return 0;
}

export interface RerankTypeBreakdown {
  exactTypeScore: number;
  siblingClusterScore: number;
  parentHypernymScore: number;
  intraFamilyPenalty: number;
  combinedTypeCompliance: number;
}

const DEFAULT_SIBLING_CLUSTER_WEIGHT = 0.64;

export function scoreRerankProductTypeBreakdown(
  querySeeds: string[],
  docTypes: string[],
  opts?: { siblingClusterWeight?: number; intraPenaltyWeight?: number },
): RerankTypeBreakdown {
  const seeds = [...new Set(querySeeds.map((s) => s.toLowerCase().trim()).filter(Boolean))];
  const docs = docTypes.map((t) => t.toLowerCase().trim()).filter(Boolean);
  if (seeds.length === 0) {
    return {
      exactTypeScore: 0,
      siblingClusterScore: 0,
      parentHypernymScore: 0,
      intraFamilyPenalty: 0,
      combinedTypeCompliance: 0,
    };
  }

  const wSib = opts?.siblingClusterWeight ?? DEFAULT_SIBLING_CLUSTER_WEIGHT;
  const wIntra = opts?.intraPenaltyWeight ?? 0.62;

  const exactTax = scoreProductTypeTaxonomyMatch(seeds, docs, { sameClusterWeight: 0 });
  const exactTypeScore = exactTax.score >= 1 ? 1 : 0;

  const clusterTax = scoreProductTypeTaxonomyMatch(seeds, docs, { sameClusterWeight: wSib });
  const siblingClusterScore = exactTypeScore >= 1 ? 1 : clusterTax.score;

  const parentHypernymScore = scoreHypernymDocMatch(seeds, docs);

  const intraFamilyPenalty = intraFamilySubtypePenalty(seeds, docs);

  const base =
    exactTypeScore >= 1 ? 1 : Math.max(clusterTax.score, parentHypernymScore);

  const combinedTypeCompliance = Math.max(0, Math.min(1, base - intraFamilyPenalty * wIntra));

  return {
    exactTypeScore,
    siblingClusterScore,
    parentHypernymScore,
    intraFamilyPenalty,
    combinedTypeCompliance,
  };
}

/** Minimum intra-family penalty to treat two bottom/footwear/tops hints as conflicting. */
const SPURIOUS_CATEGORY_MIN_SAME_FAMILY_PENALTY = 0.38;

type GarmentHint =
  | { kind: "bottom"; id: string }
  | { kind: "shorts_skirt"; sk: "shorts" | "skirt" }
  | { kind: "footwear"; id: string }
  | { kind: "tops"; id: string }
  | { kind: "dress"; id: string }
  | {
      kind: "accessory";
      id: "bag" | "headwear" | "scarf" | "belt" | "jewelry" | "hosiery";
    };

function dedupeGarmentHints(hints: GarmentHint[]): GarmentHint[] {
  const seen = new Set<string>();
  const out: GarmentHint[] = [];
  for (const h of hints) {
    const key = JSON.stringify(h);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }
  return out;
}

function inferGarmentHintsFromQuerySeeds(seeds: string[]): GarmentHint[] {
  const out: GarmentHint[] = [];
  for (const raw of seeds) {
    const t = raw.toLowerCase().trim();
    if (!t) continue;
    const b = bottomMicroGroup(t);
    if (b) out.push({ kind: "bottom", id: BOTTOM_MICRO[b] });
    const ss = shortsSkirtMicro(t);
    if (ss) out.push({ kind: "shorts_skirt", sk: ss });
    const ft = footwearMicroGroup(t);
    if (ft) out.push({ kind: "footwear", id: FOOTWEAR_MICRO[ft] });
    const tp = topsMicroGroup(t);
    if (tp) out.push({ kind: "tops", id: TOPS_MICRO[tp] });
    const dr = dressMicroGroup(t);
    if (dr) out.push({ kind: "dress", id: DRESS_MICRO[dr] });
    const ax = accessoryMicroGroup(t);
    if (ax) out.push({ kind: "accessory", id: ax });
  }
  return dedupeGarmentHints(out);
}

function inferGarmentHintsFromCategoryString(raw: string | undefined): GarmentHint[] {
  if (!raw) return [];
  const s = String(raw).toLowerCase();
  const out: GarmentHint[] = [];
  const words = s.split(/[^a-z0-9]+/).filter(Boolean);
  for (const w of words) {
    const b = bottomMicroGroup(w);
    if (b) out.push({ kind: "bottom", id: BOTTOM_MICRO[b] });
    const ss = shortsSkirtMicro(w);
    if (ss) out.push({ kind: "shorts_skirt", sk: ss });
    const ft = footwearMicroGroup(w);
    if (ft) out.push({ kind: "footwear", id: FOOTWEAR_MICRO[ft] });
    const tp = topsMicroGroup(w);
    if (tp) out.push({ kind: "tops", id: TOPS_MICRO[tp] });
    const dr = dressMicroGroup(w);
    if (dr) out.push({ kind: "dress", id: DRESS_MICRO[dr] });
    const ax = accessoryMicroGroup(w);
    if (ax) out.push({ kind: "accessory", id: ax });
  }
  if (/\bskirts?\b/.test(s)) out.push({ kind: "shorts_skirt", sk: "skirt" });
  if (/\b(?:board\s+)?shorts\b|\bbermuda\b/.test(s)) out.push({ kind: "shorts_skirt", sk: "shorts" });
  if (/\b(sweater|cardigan|hoodie|blouse|shirt|tee|knitwear|polo)\b/.test(s)) {
    const m = s.match(/\b(sweaters?|cardigans?|hoodies?|blouses?|shirts?|tees?|knitwear|polos?)\b/);
    if (m) {
      const tp = topsMicroGroup(m[1]);
      if (tp) out.push({ kind: "tops", id: TOPS_MICRO[tp] });
    }
  }
  if (/\b(dresses?|gowns?|jumpsuits?|rompers?)\b/.test(s)) {
    const m = s.match(/\b(dresses?|gowns?|jumpsuits?|rompers?)\b/);
    if (m) {
      const dr = dressMicroGroup(m[1]);
      if (dr) out.push({ kind: "dress", id: DRESS_MICRO[dr] });
    }
  }
  if (/\b(bag|bags|handbag|handbags|tote|totes|clutch|clutches|purse|purses|backpack|backpacks|satchel|satchels|crossbody|wallet|wallets)\b/.test(s)) {
    out.push({ kind: "accessory", id: "bag" });
  }
  if (/\b(hat|hats|cap|caps|beanie|beanies|beret|berets)\b/.test(s)) {
    out.push({ kind: "accessory", id: "headwear" });
  }
  if (/\b(scarf|scarves|shawl|shawls|stole|stoles|wrap|wraps)\b/.test(s)) {
    out.push({ kind: "accessory", id: "scarf" });
  }
  if (/\b(belt|belts)\b/.test(s)) {
    out.push({ kind: "accessory", id: "belt" });
  }
  if (/\b(necklace|necklaces|earring|earrings|bracelet|bracelets|ring|rings|jewelry|jewellery|brooch|brooches|anklet|anklets|choker|chokers)\b/.test(s)) {
    out.push({ kind: "accessory", id: "jewelry" });
  }
  if (/\b(sock|socks|hosiery|stocking|stockings)\b/.test(s)) {
    out.push({ kind: "accessory", id: "hosiery" });
  }
  return dedupeGarmentHints(out);
}

function accessoryMicroGroup(
  token: string,
): "bag" | "headwear" | "scarf" | "belt" | "jewelry" | "hosiery" | null {
  const t = token.toLowerCase().trim();
  if (
    new Set([
      "bag",
      "bags",
      "handbag",
      "handbags",
      "tote",
      "totes",
      "clutch",
      "clutches",
      "purse",
      "purses",
      "backpack",
      "backpacks",
      "satchel",
      "satchels",
      "crossbody",
      "wallet",
      "wallets",
    ]).has(t)
  )
    return "bag";
  if (new Set(["hat", "hats", "cap", "caps", "beanie", "beanies", "beret", "berets"]).has(t))
    return "headwear";
  if (new Set(["scarf", "scarves", "shawl", "shawls", "stole", "stoles", "wrap", "wraps"]).has(t))
    return "scarf";
  if (new Set(["belt", "belts"]).has(t)) return "belt";
  if (
    new Set([
      "necklace",
      "necklaces",
      "earring",
      "earrings",
      "bracelet",
      "bracelets",
      "ring",
      "rings",
      "jewelry",
      "jewellery",
      "brooch",
      "brooches",
      "anklet",
      "anklets",
      "choker",
      "chokers",
    ]).has(t)
  )
    return "jewelry";
  if (new Set(["sock", "socks", "hosiery", "stocking", "stockings"]).has(t))
    return "hosiery";
  return null;
}

function docSupportsGarmentHint(docProductTypes: string[], hint: GarmentHint): boolean {
  const docs = docProductTypes.map((t) => t.toLowerCase().trim()).filter(Boolean);
  if (docs.length === 0) return false;
  switch (hint.kind) {
    case "bottom":
      return docs.some((d) => {
        const g = bottomMicroGroup(d);
        return g ? BOTTOM_MICRO[g] === hint.id : false;
      });
    case "shorts_skirt":
      return docs.some((d) => shortsSkirtMicro(d) === hint.sk);
    case "footwear":
      return docs.some((d) => {
        const g = footwearMicroGroup(d);
        return g ? FOOTWEAR_MICRO[g] === hint.id : false;
      });
    case "tops":
      return docs.some((d) => {
        const g = topsMicroGroup(d);
        return g ? TOPS_MICRO[g] === hint.id : false;
      });
    case "dress":
      return docs.some((d) => {
        const g = dressMicroGroup(d);
        return g ? DRESS_MICRO[g] === hint.id : false;
      });
    case "accessory":
      return docs.some((d) => accessoryMicroGroup(d) === hint.id);
    default:
      return false;
  }
}

function garmentHintsConflict(a: GarmentHint, b: GarmentHint): boolean {
  if (a.kind === "bottom" && b.kind === "bottom") {
    return (
      lookupPairPenalty(BOTTOM_PENALTY_TBL, a.id, b.id) >= SPURIOUS_CATEGORY_MIN_SAME_FAMILY_PENALTY
    );
  }
  if (a.kind === "footwear" && b.kind === "footwear") {
    return (
      lookupPairPenalty(FOOTWEAR_PENALTY_TBL, a.id, b.id) >= SPURIOUS_CATEGORY_MIN_SAME_FAMILY_PENALTY
    );
  }
  if (a.kind === "tops" && b.kind === "tops") {
    return (
      lookupPairPenalty(TOPS_PENALTY_TBL, a.id, b.id) >= SPURIOUS_CATEGORY_MIN_SAME_FAMILY_PENALTY
    );
  }
  if (a.kind === "dress" && b.kind === "dress") {
    return (
      lookupPairPenalty(DRESS_PENALTY_TBL, a.id, b.id) >= SPURIOUS_CATEGORY_MIN_SAME_FAMILY_PENALTY
    );
  }
  if (a.kind === "shorts_skirt" && b.kind === "shorts_skirt") {
    return (
      a.sk !== b.sk &&
      lookupPairPenalty(SHORTS_SKIRT_PENALTY_TBL, a.sk, b.sk) >= 0.5
    );
  }
  if (
    (a.kind === "shorts_skirt" && b.kind === "bottom") ||
    (a.kind === "bottom" && b.kind === "shorts_skirt")
  ) {
    return true;
  }
  if (
    (a.kind === "tops" && b.kind === "bottom") ||
    (a.kind === "bottom" && b.kind === "tops")
  ) {
    return true;
  }
  if (
    (a.kind === "tops" && b.kind === "shorts_skirt") ||
    (a.kind === "shorts_skirt" && b.kind === "tops")
  ) {
    return true;
  }
  if (
    (a.kind === "dress" && b.kind === "bottom") ||
    (a.kind === "bottom" && b.kind === "dress")
  ) {
    return true;
  }
  if (
    (a.kind === "dress" && b.kind === "tops") ||
    (a.kind === "tops" && b.kind === "dress")
  ) {
    return true;
  }
  if (
    (a.kind === "dress" && b.kind === "shorts_skirt") ||
    (a.kind === "shorts_skirt" && b.kind === "dress")
  ) {
    return true;
  }
  if (
    (a.kind === "footwear" && b.kind === "bottom") ||
    (a.kind === "bottom" && b.kind === "footwear")
  ) {
    return true;
  }
  if (
    (a.kind === "footwear" && b.kind === "shorts_skirt") ||
    (a.kind === "shorts_skirt" && b.kind === "footwear")
  ) {
    return true;
  }
  if (
    (a.kind === "footwear" && b.kind === "tops") ||
    (a.kind === "tops" && b.kind === "footwear")
  ) {
    return true;
  }
  if (
    (a.kind === "footwear" && b.kind === "dress") ||
    (a.kind === "dress" && b.kind === "footwear")
  ) {
    return true;
  }
  if (a.kind === "accessory" && b.kind === "accessory") {
    return a.id !== b.id;
  }
  if (a.kind === "accessory" || b.kind === "accessory") {
    return true;
  }
  return false;
}

/**
 * When `product_types` match the query (brand bleed, bad tags) but the **category**
 * string implies a different garment family, taxonomy-based rerank would still score
 * a false "exact" type match. Down-rank those rows.
 *
 * Uses the same micro-groups as `intraFamilySubtypePenalty` plus cross-axis
 * conflicts (e.g. bottoms vs skirts, tops vs bottoms, footwear vs bottoms).
 */
export function downrankSpuriousProductTypeFromCategory(
  querySeeds: string[],
  docProductTypes: string[],
  docCategoryRaw: string | undefined,
): { complianceScale: number; forceExactZero: boolean } {
  const seeds = querySeeds.map((s) => s.toLowerCase().trim()).filter(Boolean);
  const docs = docProductTypes.map((t) => t.toLowerCase().trim()).filter(Boolean);
  if (seeds.length === 0 || docs.length === 0) return { complianceScale: 1, forceExactZero: false };

  const qHints = inferGarmentHintsFromQuerySeeds(seeds);
  const catHints = inferGarmentHintsFromCategoryString(docCategoryRaw);
  if (qHints.length === 0 || catHints.length === 0) return { complianceScale: 1, forceExactZero: false };

  for (const qh of qHints) {
    for (const ch of catHints) {
      if (!garmentHintsConflict(qh, ch)) continue;
      if (!docSupportsGarmentHint(docs, qh)) continue;
      if (docSupportsGarmentHint(docs, ch)) continue;
      return { complianceScale: 0.22, forceExactZero: true };
    }
  }

  return { complianceScale: 1, forceExactZero: false };
}
