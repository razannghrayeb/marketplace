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
  ["jogger", "joggers", "sweatpants", "track pants", "track trousers", "tracksuits", "tracksuits & track trousers", "jogging pants", "jogging bottoms", "trackpants"],
  ["legging", "leggings", "tight", "tights", "7/8 tight"],
  ["jean", "jeans", "denim", "denims"],
  ["pant", "pants", "trouser", "trousers", "chino", "chinos", "cargo pants", "cargo", "slacks"],
  // Shorts / skirt (2)
  ["shorts", "bermuda", "board shorts"],
  ["skirt", "skirts", "mini skirt", "midi skirt"],
  // Footwear (8) — was one mega-cluster; now siblings are distinguishable in rerank
  ["sneaker", "sneakers", "trainer", "trainers", "running shoe", "running shoes", "athletic shoe", "athletic shoes", "sport shoe", "sport shoes", "tennis shoe", "tennis shoes", "shoes-sp"],
  ["boot", "boots", "ankle boot", "ankle boots", "chelsea boot", "chelsea boots", "combat boot", "combat boots", "after ski", "after ski boot"],
  ["sandal", "sandals", "flip flop", "flip flops", "flip-flop", "flip-flops", "gladiator sandal", "gladiator sandals"],
  ["heel", "heels", "pump", "pumps", "stiletto", "stilettos", "wedge", "wedges", "slingback", "slingbacks", "kitten heel", "kitten heels"],
  ["flat", "flats", "flats + other", "ballerina", "ballerinas", "ballet flat", "ballet flats", "loafer", "loafers", "moccasin", "moccasins", "oxford", "oxfords", "derby", "derbies", "brogue", "brogues", "dress shoe", "dress shoes", "shoes-cl"],
  ["mule", "mules", "slide", "slides", "clog", "clogs"],
  ["slipper", "slippers", "slip-on", "slip on", "slip ons", "slip-ons", "espadrille", "espadrilles"],
  ["shoe", "shoes", "footwear"],
  // Tops (6)
  ["hoodie", "hoodies", "hoody", "sweatshirt", "sweatshirts", "pullover", "pullovers"],
  [
    "sweater",
    "sweaters",
    "cardigan",
    "cardigans",
    "jumper",
    "jumpers",
    "knitwear",
    "knit tops",
    "long sleeve",
    "crewneck",
    "crew neck",
    "v-neck",
    "v neck",
    "mock neck",
    "turtleneck",
    "turteneck",
  ],
  ["shirt", "shirts", "blouse", "blouses", "button down", "button-down", "woven tops", "woven shirts", "shirting", "chemise"],
  ["tshirt", "tee", "tees", "t-shirt", "t-shirts", "t-shirt-os", "shirt-sp", "tank", "camisole", "camis"],
  ["top", "tops", "cami", "track top", "baselayer", "body"],
  ["polo", "polos", "polo shirt", "polo shirts", "polo short sleeve"],
  // Tailored / formal (2)
  ["suit", "suits", "tuxedo", "tuxedos", "suit jacket", "dress jacket"],
  ["vest", "vests", "gilet", "gilets", "waistcoat", "waistcoats"],
  // Outerwear (4)
  ["blazer", "blazers", "sport coat", "sportcoat"],
  [
    "outerwear & jackets",
    "coats & jackets",
    "jacket",
    "jackets",
    "shirt jacket",
    "shirt jackets",
    "shacket",
    "shackets",
    "overshirt",
    "overshirts",
    "bomber",
    "bomber jacket",
    "blouson",
    "blousons",
    "fleece",
    "fleeces",
    "fleece jacket",
    "fleece jackets",
    "puffer",
    "puffer jacket",
    "down jacket",
    "quilted jacket",
    "rain jacket",
    "rain jackets",
    "raincoat",
    "raincoats",
    "shell jacket",
    "shell jackets",
    "softshell",
    "softshell jacket",
  ],
  [
    "coat",
    "coats",
    "parka",
    "parkas",
    "parkas & blousons",
    "trench",
    "windbreaker",
    "windbreakers",
    "overcoat",
    "overcoats",
    "puffer coat",
    "puffer coats",
    "down coat",
    "down coats",
    "long coat",
    "wool coat",
  ],
  ["poncho", "anorak"],
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
    "tote bag",
    "tote bags",
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
    "mini bag",
    "mini bags",
    "shoulder bag",
    "shoulder bags",
    "shoulder strap",
    "shoulder straps",
    "shopping bag",
    "shopping bags",
    "waist bag",
    "waist bags",
    "duffle bag",
    "duffle bags",
    "duffel bag",
    "duffel bags",
    "lunch bag",
    "lunch bags",
    "travel bag",
    "travel bags",
    "toiletry bag",
    "toiletry bags",
    "pouch",
    "pouches",
    "card holder",
    "card holders",
    "carry on",
    "carry-on",
    "luggage",
    "luggages",
    "large luggage",
    "large luggages",
    "medium luggage",
    "medium luggages",
    "bags cases and luggage",
    "crossbody bag",
    "crossbody bags",
    "crossover bag",
    "crossover bags",
    "top handle bag",
    "top handle bags",
    "leather goods",
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

const BROAD_TOP_QUERY_EXPANSION = [
  "top",
  "tops",
  "shirt",
  "shirts",
  "blouse",
  "blouses",
  "button down",
  "button-down",
  "tshirt",
  "tee",
  "tees",
  "t-shirt",
  "t-shirts",
  "tank",
  "tank top",
  "camisole",
  "cami",
  "camis",
  "polo",
  "polos",
  "polo shirt",
  "polo shirts",
  "polo short sleeve",
  "sweater",
  "sweaters",
  "knit tops",
  "cardigan",
  "cardigans",
  "jumper",
  "jumpers",
  "knitwear",
  "hoodie",
  "hoodies",
  "hoody",
  "sweatshirt",
  "sweatshirts",
  "pullover",
  "pullovers",
  "woven tops",
  "woven shirts",
  "shirting",
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
  tight: "pants",
  tights: "pants",
  "7/8 tight": "pants",
  jogger: "pants",
  joggers: "pants",
  sweatpants: "pants",
  tracksuits: "pants",
  "track trousers": "pants",
  "tracksuits & track trousers": "pants",
  pant: "pants",
  pants: "pants",
  cargo: "pants",

  sneaker: "shoes",
  sneakers: "shoes",
  trainer: "shoes",
  trainers: "shoes",
  "running shoe": "shoes",
  "running shoes": "shoes",
  "athletic shoe": "shoes",
  "athletic shoes": "shoes",
  "sport shoe": "shoes",
  "sport shoes": "shoes",
  "tennis shoe": "shoes",
  "tennis shoes": "shoes",
  "shoes-sp": "shoes",
  boot: "shoes",
  boots: "shoes",
  "ankle boot": "shoes",
  "ankle boots": "shoes",
  "chelsea boot": "shoes",
  "chelsea boots": "shoes",
  "combat boot": "shoes",
  "combat boots": "shoes",
  "after ski": "shoes",
  "after ski boot": "shoes",
  sandal: "shoes",
  sandals: "shoes",
  loafer: "shoes",
  loafers: "shoes",
  heel: "shoes",
  heels: "shoes",
  flat: "shoes",
  flats: "shoes",
  "flats + other": "shoes",
  "ballet flat": "shoes",
  "ballet flats": "shoes",
  mule: "shoes",
  mules: "shoes",
  oxford: "shoes",
  oxfords: "shoes",
  pump: "shoes",
  pumps: "shoes",
  derby: "shoes",
  derbies: "shoes",
  brogue: "shoes",
  brogues: "shoes",
  moccasin: "shoes",
  moccasins: "shoes",
  "dress shoe": "shoes",
  "dress shoes": "shoes",
  "shoes-cl": "shoes",
  slide: "shoes",
  slides: "shoes",
  slipper: "shoes",
  slippers: "shoes",
  shoe: "shoes",
  shoes: "shoes",
  footwear: "shoes",

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
  "sport coat": "outerwear",
  sportcoat: "outerwear",
  "suit jacket": "tailored",
  "dress jacket": "tailored",
  suit: "tailored",
  suits: "tailored",
  tuxedo: "tailored",
  tuxedos: "tailored",
  jacket: "outerwear",
  jackets: "outerwear",
  "shirt jacket": "outerwear",
  "shirt jackets": "outerwear",
  shacket: "outerwear",
  shackets: "outerwear",
  overshirt: "outerwear",
  overshirts: "outerwear",
  bomber: "outerwear",
  "bomber jacket": "outerwear",
  blouson: "outerwear",
  blousons: "outerwear",
  fleece: "outerwear",
  fleeces: "outerwear",
  "fleece jacket": "outerwear",
  "fleece jackets": "outerwear",
  puffer: "outerwear",
  puffers: "outerwear",
  "puffer jacket": "outerwear",
  "puffer jackets": "outerwear",
  "down jacket": "outerwear",
  "down jackets": "outerwear",
  "quilted jacket": "outerwear",
  "quilted jackets": "outerwear",
  "rain jacket": "outerwear",
  "rain jackets": "outerwear",
  raincoat: "outerwear",
  raincoats: "outerwear",
  "shell jacket": "outerwear",
  "shell jackets": "outerwear",
  softshell: "outerwear",
  "softshell jacket": "outerwear",
  "softshell jackets": "outerwear",
  coat: "outerwear",
  coats: "outerwear",
  "puffer coat": "outerwear",
  "puffer coats": "outerwear",
  "down coat": "outerwear",
  "down coats": "outerwear",
  "long coat": "outerwear",
  "wool coat": "outerwear",
  parka: "outerwear",
  parkas: "outerwear",
  trench: "outerwear",
  windbreaker: "outerwear",
  windbreakers: "outerwear",
  overcoat: "outerwear",
  overcoats: "outerwear",
  vest: "tailored",
  vests: "tailored",
  gilet: "tailored",
  gilets: "tailored",
  waistcoat: "tailored",
  waistcoats: "tailored",
  tailored: "tailored",
  poncho: "outerwear",
  anorak: "outerwear",

  tote: "bag",
  totes: "bag",
  "tote bag": "bag",
  "tote bags": "bag",
  pouch: "bag",
  pouches: "bag",
  clutch: "bag",
  clutches: "bag",
  purse: "bag",
  purses: "bag",
  backpack: "bag",
  backpacks: "bag",
  "shopping bag": "bag",
  "shopping bags": "bag",
  "shoulder bag": "bag",
  "shoulder bags": "bag",
  "shoulder strap": "bag",
  "shoulder straps": "bag",
  "mini bag": "bag",
  "mini bags": "bag",
  "waist bag": "bag",
  "waist bags": "bag",
  "duffle bag": "bag",
  "duffle bags": "bag",
  "duffel bag": "bag",
  "duffel bags": "bag",
  "lunch bag": "bag",
  "lunch bags": "bag",
  "travel bag": "bag",
  "travel bags": "bag",
  "toiletry bag": "bag",
  "toiletry bags": "bag",
  "card holder": "bag",
  "card holders": "bag",
  "carry on": "bag",
  "carry-on": "bag",
  luggage: "bag",
  luggages: "bag",
  "large luggage": "bag",
  "large luggages": "bag",
  "medium luggage": "bag",
  "medium luggages": "bag",
  "bags cases and luggage": "bag",
  satchel: "bag",
  satchels: "bag",
  crossbody: "bag",
  "crossbody bag": "bag",
  "crossbody bags": "bag",
  "crossover bag": "bag",
  "crossover bags": "bag",
  "top handle bag": "bag",
  "top handle bags": "bag",
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
  "footwear",
  "tops",
  "tops",
  "tops",
  "tops",
  "tops",
  "tops",
  "tailored",
  "tailored",
  "outerwear",
  "outerwear",
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
    tops: 0.9,
    dress: 0.85,
    bottoms: 0.92,
    shorts_skirt: 0.8,
    footwear: 0.52,
    outerwear: 0.9,
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
    outerwear: 0.62,
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
    // Tops vs outerwear: jackets/blazers/coats are visually similar to sweaters/shirts and
    // were leaking into top searches at zero penalty. Treat them as a soft cross-family
    // mismatch so visual-only similarity cannot promote a jacket above a real sweater.
    outerwear: 0.55,
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
    bottoms: 0.62,
    shorts_skirt: 0.58,
    head_covering: 0.28,
    footwear: 0.92,
    bags: 0.9,
    jewellery: 0.85,
    // Symmetric with tops -> outerwear above. Pure tops should not bleed into a coat/blazer
    // search either; overshirt/shacket products are still indexed under outerwear cluster
    // and remain reachable when desiredProductTypes contain matching surface forms.
    tops: 0.55,
  },
  tailored: {
    modest_full: 0.28,
    dress: 0.16,
    bottoms: 0.68,
    shorts_skirt: 0.62,
    tops: 0.56,
    outerwear: 0.34,
    head_covering: 0.3,
    footwear: 0.88,
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
  ["m_bt_jog", "m_bt_tail", 0.71],
  ["m_bt_jog", "m_bt_cargo", 0.55],
  ["m_bt_leg", "m_bt_jean", 0.48],
  ["m_bt_leg", "m_bt_tail", 0.42],
  ["m_bt_leg", "m_bt_cargo", 0.5],
  ["m_bt_jean", "m_bt_tail", 0.35],
  ["m_bt_jean", "m_bt_cargo", 0.3],
  ["m_bt_tail", "m_bt_cargo", 0.31],
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
  ["m_tp_knit", "m_tp_shirt", 0.72],
  ["m_tp_knit", "m_tp_tee", 0.42],
  ["m_tp_knit", "m_tp_gen", 0.38],
  ["m_tp_knit", "m_tp_polo", 0.72],
  ["m_tp_shirt", "m_tp_tee", 0.36],
  ["m_tp_shirt", "m_tp_gen", 0.35],
  ["m_tp_shirt", "m_tp_polo", 0.15],
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
  cargo: "m_bt_cargo",
} as const;

export function bottomMicroGroup(token: string): keyof typeof BOTTOM_MICRO | null {
  const t = token.toLowerCase().trim();
  if (!t) return null;
  const jog = new Set([
    "jogger",
    "joggers",
    "sweatpants",
    "track pants",
    "track trousers",
    "tracksuits",
    "tracksuits & track trousers",
    "jogging pants",
    "jogging bottoms",
    "trackpants",
  ]);
  const leg = new Set(["legging", "leggings", "tight", "tights", "7/8 tight"]);
  const jean = new Set(["jean", "jeans", "denim", "denims"]);
  const tail = new Set(["pant", "pants", "trouser", "trousers", "chino", "chinos", "slacks", "dress pants", "dress pant"]);
  const cargo = new Set(["cargo", "cargo pants", "cargos"]);
  if (jog.has(t)) return "jogger";
  if (leg.has(t)) return "legging";
  if (jean.has(t)) return "jeans";
  if (cargo.has(t)) return "cargo";
  if (tail.has(t)) return "tailored";
  return null;
}

const SHORTS_MICRO = new Set(["shorts", "bermuda", "bermudas", "board shorts"]);
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
  const athletic = new Set([
    "sneaker",
    "sneakers",
    "trainer",
    "trainers",
    "running shoe",
    "running shoes",
    "athletic shoe",
    "athletic shoes",
    "sport shoe",
    "sport shoes",
    "tennis shoe",
    "tennis shoes",
    "shoes-sp",
  ]);
  const genericShoe = new Set(["shoe", "shoes"]);
  const boot = new Set(["boot", "boots", "ankle boot", "ankle boots", "chelsea boot", "chelsea boots", "combat boot", "combat boots", "after ski", "after ski boot"]);
  const sandal = new Set(["sandal", "sandals", "flip flop", "flip flops", "flip-flop", "flip-flops", "gladiator sandal", "gladiator sandals"]);
  const heel = new Set(["heel", "heels", "pump", "pumps", "stiletto", "stilettos", "wedge", "wedges", "slingback", "slingbacks", "kitten heel", "kitten heels"]);
  const flatDress = new Set([
    "flat",
    "flats",
    "flats + other",
    "ballerina",
    "ballerinas",
    "ballet flat",
    "ballet flats",
    "loafer",
    "loafers",
    "moccasin",
    "moccasins",
    "oxford",
    "oxfords",
    "derby",
    "derbies",
    "brogue",
    "brogues",
    "dress shoe",
    "dress shoes",
    "shoes-cl",
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
  if (genericShoe.has(t)) return null;
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
  if (
    new Set([
      "sweater",
      "sweaters",
      "cardigan",
      "cardigans",
      "jumper",
      "jumpers",
      "knitwear",
      "long sleeve",
      "crewneck",
      "crew neck",
      "v-neck",
      "v neck",
      "mock neck",
      "turtleneck",
      "turteneck",
    ]).has(t)
  ) return "knit";
  if (new Set(["shirt", "shirts", "blouse", "blouses", "button down", "button-down"]).has(t)) return "shirt";
  if (new Set(["tshirt", "tee", "tees", "t-shirt", "tank", "camisole", "camis"]).has(t)) return "tee";
  if (new Set(["top", "tops", "cami"]).has(t)) return "generic_top";
  if (new Set(["polo", "polos", "polo shirt"]).has(t)) return "polo";
  return null;
}

const OUTER_MICRO_SUIT = new Set([
  "suit",
  "suits",
  "tuxedo",
  "tuxedos",
]);
const OUTER_MICRO_BLAZER = new Set(["blazer", "blazers", "sport coat", "sportcoat", "suit jacket", "dress jacket"]);
const OUTER_MICRO_JACKET = new Set([
  "jacket",
  "jackets",
  "shirt jacket",
  "shirt jackets",
  "shacket",
  "shackets",
  "overshirt",
  "overshirts",
  "bomber",
  "bomber jacket",
  "blouson",
  "blousons",
  "fleece",
  "fleeces",
  "fleece jacket",
  "fleece jackets",
  "puffer",
  "puffer jacket",
  "down jacket",
  "quilted jacket",
  "rain jacket",
  "rain jackets",
  "raincoat",
  "raincoats",
  "shell jacket",
  "shell jackets",
  "softshell",
  "softshell jacket",
]);
const OUTER_MICRO_COAT = new Set([
  "coat",
  "coats",
  "parka",
  "parkas",
  "trench",
  "windbreaker",
  "windbreakers",
  "overcoat",
  "overcoats",
  "puffer coat",
  "puffer coats",
  "down coat",
  "down coats",
  "long coat",
  "wool coat",
]);
const OUTER_MICRO_VEST = new Set([
  "vest",
  "vests",
  "gilet",
  "gilets",
  "waistcoat",
  "waistcoats",
  "poncho",
  "anorak",
]);

function outerMicroGroup(token: string): "suit" | "blazer" | "jacket" | "coat" | "vest" | null {
  const t = token.toLowerCase().trim();
  if (OUTER_MICRO_SUIT.has(t)) return "suit";
  if (OUTER_MICRO_BLAZER.has(t)) return "blazer";
  if (OUTER_MICRO_JACKET.has(t)) return "jacket";
  if (OUTER_MICRO_COAT.has(t)) return "coat";
  if (OUTER_MICRO_VEST.has(t)) return "vest";
  return null;
}

// Penalty between outerwear micro-types. Keep generic jacket reasonably close to
// coats, but do not let blazer/suit/vest drift into plain jacket searches.
const OUTER_PAIR_PENALTY: Record<string, Record<string, number>> = {
  suit: { suit: 0, blazer: 0.50, jacket: 0.65, coat: 0.72, vest: 0.58 },
  blazer: { suit: 0.50, blazer: 0, jacket: 0.44, coat: 0.58, vest: 0.50 },
  jacket: { suit: 0.65, blazer: 0.44, jacket: 0, coat: 0.32, vest: 0.50 },
  coat: { suit: 0.72, blazer: 0.58, jacket: 0.32, coat: 0, vest: 0.62 },
  vest: { suit: 0.58, blazer: 0.50, jacket: 0.50, coat: 0.62, vest: 0 },
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

/**
 * Cross-cluster soft siblings: token pairs from different clusters within the same family
 * that are visually/functionally related but not synonyms (e.g. vest-as-top ↔ tank/cami).
 * Score kept at 0.58 — above zero but below the within-cluster default of 0.64.
 */
const SOFT_SIBLING_RAW: [string, string, number][] = [
  ["vest", "tank", 0.58],
  ["vest", "cami", 0.58],
  ["vest", "camisole", 0.58],
  ["vest", "camis", 0.58],
  ["vests", "tank", 0.58],
  ["vests", "cami", 0.58],
  ["vests", "camisole", 0.58],
  ["vests", "camis", 0.58],
];

const SOFT_SIBLING_MAP = (() => {
  const m = new Map<string, Map<string, number>>();
  for (const [a, b, score] of SOFT_SIBLING_RAW) {
    if (!m.has(a)) m.set(a, new Map());
    if (!m.has(b)) m.set(b, new Map());
    m.get(a)!.set(b, score);
    m.get(b)!.set(a, score);
  }
  return m;
})();

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

const GARMENT_LIKE_FAMILIES = new Set<string>([
  "footwear",
  "dress",
  "bottoms",
  "tops",
  "shorts_skirt",
  "outerwear",
  "tailored",
  "modest_full",
  "activewear",
  "swimwear",
  "underwear",
]);

/**
 * True when product-type seeds (BLIP/YOLO/user) map to garment/footwear families — used to
 * downrank beauty listings that only match on palette/texture in CLIP space.
 */
export function hasGarmentLikeFamilyFromProductTypeSeeds(seeds: string[]): boolean {
  if (!seeds.length) return false;
  const expanded = expandProductTypesForQuery(
    seeds.map((s) => String(s).toLowerCase().trim()).filter(Boolean),
  );
  const fams = familiesForTokens(expanded);
  for (const f of fams) {
    if (GARMENT_LIKE_FAMILIES.has(f)) return true;
  }
  return false;
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

const GENERIC_SHORTS_QUERY_SEEDS = new Set(["shorts", "bermuda", "bermudas"]);
const GENERIC_SHORTS_EXPANSION_EXCLUDES = new Set(["short", "board shorts"]);

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
  const isVestTopQuery = /\b(?:sleeveless\s+)?vest\s+top\b/.test(qNorm);
  if (isVestTopQuery) hits.push("tank");
  for (const phrase of getProductTypePhrasesLongestFirst()) {
    if (!phrase || phrase.length < 2) continue;
    if (isVestTopQuery && phrase === "vest") continue;
    if (phraseMatchesWholeWords(qNorm, phrase)) hits.push(phrase);
  }
  const fam = getTypeToFamily();
  for (const w of qNorm.split(/\s+/)) {
    if (w.length < 2) continue;
    if (isVestTopQuery && w === "vest") continue;
    if (fam.has(w)) hits.push(w);
  }
  return [...new Set(hits)];
}

export type ExplicitSleeveIntent = "short" | "long" | "sleeveless";

/**
 * Extract sleeve intent only from explicit sleeve/no-sleeve phrases.
 * Plain "short top" / "long top" are intentionally ignored because those can
 * describe garment length or fit, and ambiguous conflicting phrases fail closed.
 */
export function extractExplicitSleeveIntent(rawText: string): ExplicitSleeveIntent | undefined {
  const qNorm = normalizeForLexicalMatch(rawText);
  if (!qNorm) return undefined;

  const hits = new Set<ExplicitSleeveIntent>();
  if (/\b(short\s+sleeves?|short\s+sleeved|shortsleeve|short-sleeve(?:d)?)\b/.test(qNorm)) {
    hits.add("short");
  }
  if (/\b(long\s+sleeves?|long\s+sleeved|longsleeve|long-sleeve(?:d)?)\b/.test(qNorm)) {
    hits.add("long");
  }
  if (
    /\b(sleeveless|no\s+sleeves?|without\s+sleeves?|tank\s+tops?|camisoles?|cami\b|vest\s+tops?|spaghetti\s+straps?|strapless|halter)\b/.test(
      qNorm,
    )
  ) {
    hits.add("sleeveless");
  }

  // Shopper shorthand: "white tshirt" and "short white tshirt" generally mean a
  // short-sleeve tee. Only apply this when no explicit/conflicting sleeve phrase
  // was found, so "long sleeve tshirt" stays long and "tank top" stays sleeveless.
  if (hits.size === 0 && /\b(?:short(?:\s+\w+){0,3}\s+)?(?:t\s*shirt|tshirt|tee|tees)\b/.test(qNorm)) {
    hits.add("short");
  }

  return hits.size === 1 ? [...hits][0] : undefined;
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
    tailored: ["tailored"],
    footwear: ["footwear"],
    bags: ["bags"],
    // Keep "accessories" separate from bags to avoid headwear/hair labels
    // drifting into handbags during type-seed filtering.
    accessories: ["head_covering", "jewellery"],
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
  "flat",
  "flats",
  "ballerina",
  "ballerinas",
  "clog",
  "clogs",
  "slipper",
  "slippers",
  "espadrille",
  "espadrilles",
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
  "pouch",
  "luggage",
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

/**
 * When indexed `product_types` is empty or does not map to taxonomy families, infer
 * macro families from `category` / `category_canonical` so cross-family penalties
 * still apply (e.g. tops query vs footwear listing that lacks `product_types`).
 */
export function inferMacroFamiliesFromListingCategoryFields(
  categoryCanonical: unknown,
  category: unknown,
): Set<string> {
  const parts: string[] = [];
  if (categoryCanonical != null && String(categoryCanonical).trim()) {
    parts.push(String(categoryCanonical));
  }
  if (category != null && String(category).trim()) {
    parts.push(String(category));
  }
  const combined = parts.join(" ").toLowerCase().replace(/[\s_-]+/g, " ").trim();
  if (!combined) return new Set();

  const direct = intentFamiliesForProductCategory(combined);
  if (direct && direct.size > 0) return direct;

  for (const seg of combined.split(/\s+/)) {
    const d = intentFamiliesForProductCategory(seg);
    if (d && d.size > 0) return d;
  }

  const out = new Set<string>();
  if (
    /\b(footwear|sneaker|sneakers|boot|boots|after\s+ski(?:\s+boot)?|sandal|sandals|loafer|loafers|heel|heels|flats?|slipper|slippers|mule|mules|clog|clogs|trainer|trainers|ballerinas?|espadrilles?|flipflop|flip-flop|flip flops|crocs?|shoe|shoes|shoes[-\s]?(?:cl|sp))\b/.test(
      combined,
    )
  ) {
    out.add("footwear");
  }
  const hasTopAccessoryPhrase = /\btop(?:\s|-)+(handle|zip|zipper|stitch|stitching|coat|bag|satchel|clutch|pouch|wallet|case|cover|closure)\b/.test(
    combined,
  );
  if (
    !hasTopAccessoryPhrase &&
    /\b(shirt|shirts|blouse|blouses|tee|tees|t-?shirt|tshirt|polos?|sweater|sweaters|hoodie|hoodies|cardigan|cardigans|tank|tanks|camisole|bodysuit|top|tops|long\s+sleeve|crew\s*neck|crewneck|v[-\s]?neck|mock\s+neck|turtleneck|turteneck)\b/.test(
      combined,
    )
  ) {
    out.add("tops");
  }
  if (/\b(pants?|jeans?|trousers?|leggings?|tights?|joggers?|chinos?|cargos?|track\s+trousers|tracksuits?)\b/.test(combined)) {
    out.add("bottoms");
  }
  if (/\b(shorts|bermudas?|skirt|skirts)\b/.test(combined)) {
    out.add("shorts_skirt");
  }
  if (/\b(dresses?|gown|gowns)\b/.test(combined)) {
    out.add("dress");
  }
  if (/\b(coat|coats|jacket|jackets|blazer|blazers|parka|parkas|puffer|puffers|blouson|blousons|fleece|fleeces|rain\s+jackets?|raincoats?|shell\s+jackets?|softshell|down\s+jackets?|quilted\s+jackets?|vests?)\b/.test(combined)) {
    out.add("outerwear");
  }
  if (/\b(suit|suits|tuxedo|tuxedos|waistcoat|waistcoats|vest|vests|gilet|gilets|tailored)\b/.test(combined)) {
    out.add("tailored");
  }
  if (/\b(bag|bags|handbag|handbags|tote|totes|backpack|backpacks|wallets?|purses?|pouches?|clutches|crossbody|crossover|shoulder\s+(?:bags?|straps?)|shopping\s+bags?|tote\s+bags?|mini\s+bags?|waist\s+bags?|duff(?:le|el)\s+bags?|lunch\s+bags?|travel\s+bags?|toiletry\s+bags?|card\s+holders?|top\s+handle\s+bags?|carry[-\s]?on|(?:large|medium)\s+luggages?|luggages?|leather\s+goods|bags?\s+cases?\s+(?:and\s+)?luggage)\b/.test(combined)) {
    out.add("bags");
  }
  return out;
}

export interface ScoreCrossFamilyTypePenaltyOpts {
  /** Indexed listing category (human-readable). */
  category?: string;
  /** Indexed `category_canonical` aisle key when present. */
  categoryCanonical?: string;
  sameClusterWeight?: number;
}

export function scoreCrossFamilyTypePenalty(
  querySeeds: string[],
  docProductTypes: string[],
  opts?: ScoreCrossFamilyTypePenaltyOpts,
): number {
  if (!crossFamilyTypePenaltyEnabled()) return 0;
  const seeds = querySeeds.map((s) => s.toLowerCase().trim()).filter(Boolean);
  if (seeds.length === 0) return 0;

  const expandedQuery = expandProductTypesForQuery(seeds);
  const qFam = familiesForTokens(expandedQuery);
  if (qFam.size === 0) return 0;

  let dFam = familiesForTokens(docProductTypes.map((t) => t.toLowerCase().trim()).filter(Boolean));
  const dFromCategory = inferMacroFamiliesFromListingCategoryFields(
    opts?.categoryCanonical,
    opts?.category,
  );
  if (dFromCategory.size > 0) {
    dFam = new Set([...dFam, ...dFromCategory]);
  }
  if (dFam.size === 0) return 0;

  let max = 0;
  for (const qf of qFam) {
    for (const df of dFam) {
      max = Math.max(max, pairPenalty(qf, df));
    }
  }
  const qHints = inferGarmentHintsFromQuerySeeds(seeds);
  const dHints = dedupeGarmentHints([
    ...inferGarmentHintsFromQuerySeeds(docProductTypes),
    ...inferGarmentHintsFromCategoryString(opts?.categoryCanonical),
    ...inferGarmentHintsFromCategoryString(opts?.category),
  ]);
  for (const qh of qHints) {
    for (const dh of dHints) {
      if (!garmentHintsConflict(qh, dh)) continue;
      if (qh.kind === "bottom" && dh.kind === "bottom") continue;
      const severeBottomAxis =
        (qh.kind === "bottom" && dh.kind === "shorts_skirt") ||
        (qh.kind === "shorts_skirt" && dh.kind === "bottom");
      max = Math.max(max, severeBottomAxis ? 0.92 : 0.72);
    }
  }
  const queryHasFullSuitIntent = seeds.some((s) =>
    /\b(suit|suits|tuxedo|tuxedos|matching\s*suit|two[-\s]?piece|three[-\s]?piece)\b/.test(s),
  );
  const docBlob = [
    ...docProductTypes,
    opts?.categoryCanonical,
    opts?.category,
  ]
    .filter(Boolean)
    .map((x) => String(x).toLowerCase())
    .join(" ");
  const docHasExplicitSuitCue =
    /\b(suit|suits|tuxedo|tuxedos|suit\s+jackets?|dress\s+jackets?|matching\s*suit|two[-\s]?piece|three[-\s]?piece)\b/.test(
      docBlob,
    );
  if (queryHasFullSuitIntent && docHasExplicitSuitCue) {
    // A suit query may be expanded with pants/trousers so coordinated bottoms can rank.
    // Do not let those auxiliary bottom hints penalize actual suit/tuxedo listings,
    // especially sparse catalog rows where the suit cue lives in category/title only.
    max = Math.min(max, 0.18);
  }
  const docIsOuterwearWithoutSuit =
    /\b(coat|coats|overcoat|overcoats|parka|parkas|trench|outerwear|jacket|jackets)\b/.test(docBlob) &&
    !docHasExplicitSuitCue;
  if (queryHasFullSuitIntent && docIsOuterwearWithoutSuit) {
    max = Math.max(max, 0.94);
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
    if (key === "top" || key === "tops") {
      for (const t of BROAD_TOP_QUERY_EXPANSION) out.add(t);
    }
    const cluster = idx.get(key);
    if (cluster) {
      for (const t of cluster) {
        if (GENERIC_SHORTS_QUERY_SEEDS.has(key) && GENERIC_SHORTS_EXPANSION_EXCLUDES.has(t)) {
          continue;
        }
        out.add(t);
      }
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

  // Soft cross-cluster siblings (e.g. vest-as-top ↔ tank/cami)
  if (best < wCluster) {
    for (const qt of q) {
      const softRow = SOFT_SIBLING_MAP.get(qt);
      if (!softRow) continue;
      for (const dt of d) {
        const softScore = softRow.get(dt);
        if (softScore !== undefined && softScore > best) {
          best = softScore;
          bestQ = qt;
          bestD = dt;
        }
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

function isBroadExactToken(token: string): boolean {
  const t = String(token || "").toLowerCase().trim();
  if (!t) return false;
  // "top/tops/cami" is intentionally a broad catch-all; treat as non-exact for rerank.
  if (topsMicroGroup(t) === "generic_top") return true;
  // Hypernym-level labels are too broad for "exact" matching (e.g. shoes/pants/outerwear/bag).
  const hyperValues = new Set(Object.values(TYPE_TO_HYPERNYM).map((x) => String(x).toLowerCase().trim()));
  return hyperValues.has(t);
}

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

  const clusterTax = scoreProductTypeTaxonomyMatch(seeds, docs, { sameClusterWeight: wSib });
  const parentHypernymScore = scoreHypernymDocMatch(seeds, docs);

  const intraFamilyPenalty = intraFamilySubtypePenalty(seeds, docs);

  const exactTax = scoreProductTypeTaxonomyMatch(seeds, docs, { sameClusterWeight: 0 });
  const exactToken = exactTax.bestQueryType ?? exactTax.bestDocType ?? "";
  const hasExactType = exactTax.score >= 1 && !isBroadExactToken(exactToken);
  const hasSameFamilyType = Math.max(clusterTax.score, parentHypernymScore) > 0 || intraFamilyPenalty > 0;
  const siblingClusterScore = hasExactType ? 1 : clusterTax.score;

  const base =
    hasExactType ? 1 : Math.max(clusterTax.score, parentHypernymScore);

  const combinedTypeCompliance = Math.max(0, Math.min(1, base - intraFamilyPenalty * wIntra));
  const exactTypeScore = hasExactType
    ? 1
    : hasSameFamilyType
      ? Math.max(0.2, Math.min(0.65, combinedTypeCompliance))
      : 0;

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
  if (/\b(bag|bags|handbag|handbags|tote|totes|clutch|clutches|purse|purses|pouch|pouches|backpack|backpacks|satchel|satchels|crossbody|crossover|wallet|wallets|shoulder\s+(?:bags?|straps?)|shopping\s+bags?|tote\s+bags?|mini\s+bags?|waist\s+bags?|duff(?:le|el)\s+bags?|lunch\s+bags?|travel\s+bags?|toiletry\s+bags?|card\s+holders?|top\s+handle\s+bags?|carry[-\s]?on|(?:large|medium)\s+luggages?|luggages?|leather\s+goods|bags?\s+cases?\s+(?:and\s+)?luggage)\b/.test(s)) {
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
      "tote bag",
      "tote bags",
      "clutch",
      "clutches",
      "purse",
      "purses",
      "pouch",
      "pouches",
      "backpack",
      "backpacks",
      "satchel",
      "satchels",
      "crossbody",
      "crossbody bag",
      "crossbody bags",
      "crossover",
      "crossover bag",
      "crossover bags",
      "wallet",
      "wallets",
      "shopping bag",
      "shopping bags",
      "shoulder bag",
      "shoulder bags",
      "shoulder strap",
      "shoulder straps",
      "mini bag",
      "mini bags",
      "waist bag",
      "waist bags",
      "duffle bag",
      "duffle bags",
      "duffel bag",
      "duffel bags",
      "lunch bag",
      "lunch bags",
      "travel bag",
      "travel bags",
      "toiletry bag",
      "toiletry bags",
      "card holder",
      "card holders",
      "carry on",
      "carry-on",
      "luggage",
      "luggages",
      "large luggage",
      "large luggages",
      "medium luggage",
      "medium luggages",
      "bags cases and luggage",
      "top handle bag",
      "top handle bags",
      "leather goods",
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
