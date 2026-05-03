/**
 * Semantic Product Contract Builder
 *
 * Builds product recall contracts from FashionIntent, not raw desired terms.
 * Prevents broad term leakage into exact recall.
 *
 * Pattern: family → type → subtype → semantic grouping
 * Never: "exactTypes: [...desiredProductTypes]"
 */

import type { FashionIntent, ProductFamily } from "./fashionIntent";

export interface ProductContract {
  /** Product types that should match exactly (same family + same type/subtype) */
  exactTypes: string[];
  /** Product types in strong tier (same family + close type/subtype) */
  strongTypes: string[];
  /** Product types in related tier (same family + acceptable alternative) */
  relatedTypes: string[];
  /** Product types in weak tier (same family but noticeably different) */
  weakTypes: string[];
  /** Product types that should be filtered out (wrong family or bad subtypes) */
  badTypes: string[];
  /** Product families that should be hard-dropped for this intent */
  blockedFamilies: string[];
}

/**
 * Build semantic product contract from FashionIntent
 * This is the central place where intent → search terms mapping happens
 */
export function buildSemanticContract(intent: FashionIntent): ProductContract {
  switch (intent.family) {
    case "dresses":
      return buildDressContract(intent);
    case "tops":
      return buildTopContract(intent);
    case "bottoms":
      return buildBottomContract(intent);
    case "outerwear":
      return buildOuterwearContract(intent);
    case "footwear":
      return buildFootwearContract(intent);
    case "bags":
      return buildBagContract(intent);
    case "accessories":
      return buildAccessoryContract(intent);
    default:
      // Fallback: treat as unknown family
      return {
        exactTypes: [],
        strongTypes: [],
        relatedTypes: [],
        weakTypes: [],
        badTypes: [],
        blockedFamilies: [],
      };
  }
}

function buildDressContract(intent: FashionIntent): ProductContract {
  // exactTypes: include the detected type and subtype
  const exactTypes = [
    "dress",
    intent.subtype && normalizeType(intent.subtype),
  ].filter(Boolean) as string[];

  // strongTypes: common dress variants and sleeves
  const strongTypes = [
    "casual dress",
    "sleeveless dress",
    "short sleeve dress",
    "long sleeve dress",
    "midi dress",
    "mini dress",
    "maxi dress",
    "fit and flare",
    "a-line dress",
    "wrap dress",
    "bodycon dress",
    "shirt dress",
    "shift dress",
  ];

  // relatedTypes: similar dresses but different family often
  const relatedTypes = [
    "halter dress",
    "slip dress",
    "sundress",
    "skater dress",
    "sheath dress",
    "empire dress",
    "smock dress",
    "tunic dress",
  ];

  // weakTypes: very different but still dresses
  const weakTypes = [
    "gown",
    "kaftan",
    "abaya",
    "saree",
    "kimono dress",
    "maxi gown",
  ];

  // badTypes: not dresses
  const badTypes = [
    "top",
    "blouse",
    "shirt",
    "sweater",
    "tank top",
    "t-shirt",
    "pants",
    "jeans",
    "skirt",
    "shorts",
    "legging",
    "jacket",
    "coat",
    "cardigan",
    "blazer",
  ];

  // blockedFamilies: enforce dress family only
  const blockedFamilies = ["tops", "bottoms", "outerwear", "footwear", "bags", "accessories"];

  return { exactTypes, strongTypes, relatedTypes, weakTypes, badTypes, blockedFamilies };
}

function buildTopContract(intent: FashionIntent): ProductContract {
  const typeLower = normalizeType(intent.type);
  const subtypeLower = intent.subtype ? normalizeType(intent.subtype) : "";

  // exactTypes: the detected type and subtype
  const exactTypes = [typeLower, subtypeLower].filter(Boolean) as string[];

  // strongTypes depend on the top type
  let strongTypes: string[] = [];

  if (typeLower.includes("shirt")) {
    strongTypes = [
      "button up shirt",
      "button-up shirt",
      "dress shirt",
      "casual shirt",
      "oxford shirt",
      "linen shirt",
      "silk shirt",
      "blouse",
      "chambray shirt",
    ];
  } else if (typeLower.includes("sweater")) {
    strongTypes = [
      "knit",
      "knit sweater",
      "pullover",
      "crew neck",
      "v-neck sweater",
      "turtleneck",
      "cardigan",
      "crewneck sweater",
      "pullover sweater",
    ];
  } else if (typeLower.includes("t-shirt") || typeLower.includes("tshirt")) {
    strongTypes = ["tee", "graphic tee", "t shirt", "casual tee", "short sleeve tee"];
  } else {
    // Generic top types
    strongTypes = [
      "blouse",
      "shirt",
      "sweater",
      "pullover",
      "top",
      "long sleeve top",
      "short sleeve top",
      "sleeveless top",
    ];
  }

  // relatedTypes: closely related tops
  const relatedTypes = [
    "tank top",
    "camisole",
    "halter top",
    "crop top",
    "tube top",
    "bralette",
    "cardigan",
    "shrug",
    "poncho",
    "vest",
  ];

  // weakTypes: barely tops
  const weakTypes = ["sweatshirt", "hoodie", "windbreaker", "tunic", "dress"];

  // badTypes: clearly not tops
  const badTypes = [
    "pants",
    "jeans",
    "shorts",
    "skirt",
    "legging",
    "dress",
    "jacket",
    "coat",
    "blazer",
    "trench",
    "shoe",
    "boot",
    "sneaker",
  ];

  // Tops can go with many families in outfits, so only block non-apparel
  const blockedFamilies = ["footwear", "bags", "accessories"];

  return { exactTypes, strongTypes, relatedTypes, weakTypes, badTypes, blockedFamilies };
}

function buildBottomContract(intent: FashionIntent): ProductContract {
  const typeLower = normalizeType(intent.type);
  const subtypeLower = intent.subtype ? normalizeType(intent.subtype) : "";

  // exactTypes: pant/trouser + subtype (e.g., "pant", "wide_leg_pant")
  const exactTypes = [
    typeLower.includes("pant") || typeLower.includes("trouser") ? "pant" : typeLower,
    subtypeLower,
  ].filter(Boolean) as string[];

  // strongTypes: pant variants (no jeans in exact/strong for fashion intent)
  const strongTypes = [
    "pant",
    "pants",
    "trousers",
    "trouser",
    "dress pants",
    "formal pants",
    "wide leg",
    "wide leg pants",
    "straight leg",
    "straight leg pants",
    "slim pants",
    "tapered pants",
    "cropped pants",
    "capri",
    "capris",
    "chinos",
    "khaki",
    "linen pants",
    "wool pants",
  ];

  // relatedTypes: casual bottoms (includes jeans for fashion-forward outfits)
  const relatedTypes = [
    "jeans",
    "denim",
    "cargo pants",
    "utility pants",
    "joggers",
    "jogging pants",
    "sweatpants",
    "legging",
    "leggings",
    "cycling shorts",
    "bike shorts",
  ];

  // weakTypes: very casual or skirts
  const weakTypes = [
    "shorts",
    "short pants",
    "bermuda shorts",
    "athletic shorts",
    "skirt",
    "skirts",
    "mini skirt",
    "midi skirt",
    "maxi skirt",
    "pencil skirt",
  ];

  // badTypes: clearly not bottoms
  const badTypes = [
    "top",
    "shirt",
    "blouse",
    "sweater",
    "t-shirt",
    "tank",
    "dress",
    "jacket",
    "coat",
    "cardigan",
    "blazer",
    "shoe",
    "boot",
  ];

  // Bottoms only with bottoms family
  const blockedFamilies = ["tops", "dresses", "outerwear", "footwear", "bags", "accessories"];

  return { exactTypes, strongTypes, relatedTypes, weakTypes, badTypes, blockedFamilies };
}

function buildOuterwearContract(intent: FashionIntent): ProductContract {
  const typeLower = normalizeType(intent.type);

  // exactTypes: the detected outerwear type
  const exactTypes = [typeLower].filter(Boolean) as string[];

  // strongTypes: similar outerwear
  const strongTypes = [
    "jacket",
    "coat",
    "blazer",
    "cardigan",
    "bomber jacket",
    "denim jacket",
    "leather jacket",
    "wool coat",
    "parka",
    "windbreaker",
    "rain jacket",
    "sports coat",
  ];

  // relatedTypes: looser outerwear
  const relatedTypes = [
    "sweater",
    "pullover",
    "shawl",
    "wrap",
    "shrug",
    "poncho",
    "cape",
    "cloak",
  ];

  // weakTypes: borderline outerwear
  const weakTypes = ["vest", "gilet", "quilted vest"];

  // badTypes: not outerwear
  const badTypes = [
    "shirt",
    "blouse",
    "top",
    "t-shirt",
    "pants",
    "jeans",
    "dress",
    "skirt",
    "shoe",
    "boot",
  ];

  const blockedFamilies = ["footwear", "bags", "accessories"];

  return { exactTypes, strongTypes, relatedTypes, weakTypes, badTypes, blockedFamilies };
}

function buildFootwearContract(intent: FashionIntent): ProductContract {
  const typeLower = normalizeType(intent.type);

  // exactTypes: the detected shoe type
  const exactTypes = [typeLower].filter(Boolean) as string[];

  // strongTypes: similar footwear
  const strongTypes = [
    "shoe",
    "shoes",
    "sneaker",
    "sneakers",
    "shoe",
    "athletic shoe",
    "running shoe",
    "trainer",
    "trainers",
    "boot",
    "boots",
    "ankle boot",
    "work boot",
    "rain boot",
    "high heel",
    "heel",
    "heels",
    "pump",
    "pumps",
    "flat",
    "flats",
    "sandal",
    "sandals",
    "loafer",
    "loafers",
    "oxford",
    "slip-on",
    "slipper",
    "slippers",
    "moccasin",
    "moccasins",
  ];

  // relatedTypes: less common footwear
  const relatedTypes = [
    "platform",
    "wedge",
    "wedges",
    "espadrille",
    "flip flop",
    "flip-flop",
    "thong",
    "strappy sandal",
    "gladiator sandal",
  ];

  // weakTypes: barely footwear
  const weakTypes = ["sock", "socks", "leg warmer"];

  // badTypes: not footwear
  const badTypes = [
    "pant",
    "pants",
    "jeans",
    "shirt",
    "top",
    "dress",
    "jacket",
    "bag",
  ];

  // Footwear only
  const blockedFamilies = ["tops", "bottoms", "dresses", "outerwear", "bags", "accessories"];

  return { exactTypes, strongTypes, relatedTypes, weakTypes, badTypes, blockedFamilies };
}

function buildBagContract(intent: FashionIntent): ProductContract {
  const typeLower = normalizeType(intent.type);

  // exactTypes: the detected bag type
  const exactTypes = [typeLower].filter(Boolean) as string[];

  // strongTypes: similar bags
  const strongTypes = [
    "bag",
    "bags",
    "tote",
    "tote bag",
    "shoulder bag",
    "crossbody",
    "crossbody bag",
    "satchel",
    "hobo bag",
    "bucket bag",
    "backpack",
    "knapsack",
    "rucksack",
    "briefcase",
    "messenger bag",
    "clutch",
    "pouch",
    "wristlet",
    "handbag",
    "purse",
    "purses",
  ];

  // relatedTypes: specialized bags
  const relatedTypes = [
    "duffle bag",
    "weekender",
    "luggage",
    "travel bag",
    "gym bag",
    "beach bag",
    "diaper bag",
    "drawstring bag",
    "chain bag",
  ];

  // weakTypes: barely bags
  const weakTypes = ["belt bag", "fanny pack", "money belt"];

  // badTypes: not bags
  const badTypes = [
    "pant",
    "shirt",
    "dress",
    "shoe",
    "jacket",
  ];

  // Bags are standalone
  const blockedFamilies = ["tops", "bottoms", "dresses", "outerwear", "footwear"];

  return { exactTypes, strongTypes, relatedTypes, weakTypes, badTypes, blockedFamilies };
}

function buildAccessoryContract(intent: FashionIntent): ProductContract {
  const typeLower = normalizeType(intent.type);

  // exactTypes: the detected accessory type
  const exactTypes = [typeLower].filter(Boolean) as string[];

  // strongTypes: similar accessories
  const strongTypes = [
    "accessory",
    "accessories",
    "jewelry",
    "necklace",
    "bracelet",
    "ring",
    "earring",
    "earrings",
    "watch",
    "belt",
    "belts",
    "hat",
    "hats",
    "cap",
    "beanie",
    "scarf",
    "scarves",
    "sunglasses",
    "glasses",
    "eyewear",
  ];

  // relatedTypes: less common accessories
  const relatedTypes = [
    "hair clip",
    "hair accessory",
    "brooch",
    "pin",
    "gloves",
    "mittens",
    "socks",
  ];

  // weakTypes: barely accessories
  const weakTypes = ["bag charm", "keychain"];

  // badTypes: not accessories
  const badTypes = [
    "pant",
    "shirt",
    "dress",
    "shoe",
    "jacket",
    "bag",
  ];

  // Accessories are standalone
  const blockedFamilies = ["tops", "bottoms", "dresses", "outerwear", "footwear", "bags"];

  return { exactTypes, strongTypes, relatedTypes, weakTypes, badTypes, blockedFamilies };
}

/**
 * Normalize product type string: lowercase, trim, collapse variants
 */
function normalizeType(type: string): string {
  return type
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^\w_]/g, "");
}
