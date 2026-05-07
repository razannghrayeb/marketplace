"use strict";
/**
 * Fashion product-type graph for recall (query expansion) and ranking.
 *
 * - Each `PRODUCT_TYPE_CLUSTERS` entry is a **narrow micro-cluster** (exact-ish synonyms only).
 * - **Intra-family** mismatch penalties apply when query and document fall in the same macro
 *   family (bottoms, footwear, tops, …) but different micro-clusters (e.g. sneakers vs boots).
 * - **Cross-family** penalties use `FAMILY_PAIR_PENALTY` (dress vs pants, etc.).
 */
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TYPE_TO_HYPERNYM = exports.PRODUCT_TYPE_CLUSTERS = void 0;
exports.bottomMicroGroup = bottomMicroGroup;
exports.footwearMicroGroup = footwearMicroGroup;
exports.topsMicroGroup = topsMicroGroup;
exports.hasGarmentLikeFamilyFromProductTypeSeeds = hasGarmentLikeFamilyFromProductTypeSeeds;
exports.getProductTypePhrasesLongestFirst = getProductTypePhrasesLongestFirst;
exports.extractLexicalProductTypeSeeds = extractLexicalProductTypeSeeds;
exports.extractExplicitSleeveIntent = extractExplicitSleeveIntent;
exports.intentFamiliesForProductCategory = intentFamiliesForProductCategory;
exports.filterProductTypeSeedsByMappedCategory = filterProductTypeSeedsByMappedCategory;
exports.extractFashionTypeNounTokens = extractFashionTypeNounTokens;
exports.crossFamilyTypePenaltyEnabled = crossFamilyTypePenaltyEnabled;
exports.inferMacroFamiliesFromListingCategoryFields = inferMacroFamiliesFromListingCategoryFields;
exports.scoreCrossFamilyTypePenalty = scoreCrossFamilyTypePenalty;
exports.expandProductTypesForQuery = expandProductTypesForQuery;
exports.expandProductTypesForIndexing = expandProductTypesForIndexing;
exports.scoreProductTypeTaxonomyMatch = scoreProductTypeTaxonomyMatch;
exports.scoreHypernymDocMatch = scoreHypernymDocMatch;
exports.scoreRerankProductTypeBreakdown = scoreRerankProductTypeBreakdown;
exports.downrankSpuriousProductTypeFromCategory = downrankSpuriousProductTypeFromCategory;
/** Narrow micro-clusters — avoid mega-clusters that equate unrelated garment types. */
exports.PRODUCT_TYPE_CLUSTERS = [
    // Bottoms (4)
    ["jogger", "joggers", "sweatpants", "track pants", "jogging pants", "jogging bottoms", "trackpants"],
    ["legging", "leggings", "tights"],
    ["jean", "jeans", "denim", "denims"],
    ["pant", "pants", "trouser", "trousers", "chino", "chinos", "cargo pants", "cargo", "slacks"],
    // Shorts / skirt (2)
    ["shorts", "bermuda", "board shorts"],
    ["skirt", "skirts", "mini skirt", "midi skirt"],
    // Footwear (7) — was one mega-cluster; now siblings are distinguishable in rerank
    ["sneaker", "sneakers", "trainer", "trainers", "running shoe", "running shoes", "athletic shoe", "athletic shoes", "sport shoe", "sport shoes", "tennis shoe", "tennis shoes"],
    ["boot", "boots", "ankle boot", "ankle boots", "chelsea boot", "chelsea boots", "combat boot", "combat boots"],
    ["sandal", "sandals", "flip flop", "flip flops", "flip-flop", "flip-flops", "gladiator sandal", "gladiator sandals"],
    ["heel", "heels", "pump", "pumps", "stiletto", "stilettos", "wedge", "wedges", "slingback", "slingbacks", "kitten heel", "kitten heels"],
    ["flat", "flats", "ballerina", "ballerinas", "ballet flat", "ballet flats", "loafer", "loafers", "moccasin", "moccasins", "oxford", "oxfords", "derby", "derbies", "brogue", "brogues", "dress shoe", "dress shoes"],
    ["mule", "mules", "slide", "slides", "clog", "clogs"],
    ["slipper", "slippers", "slip-on", "slip on", "slip ons", "slip-ons", "espadrille", "espadrilles"],
    ["shoe", "shoes"],
    // Tops (6)
    ["hoodie", "hoodies", "sweatshirt", "sweatshirts", "pullover", "pullovers"],
    ["sweater", "sweaters", "cardigan", "cardigans", "jumper", "jumpers", "knitwear"],
    ["shirt", "shirts", "blouse", "blouses", "button down", "button-down"],
    ["tshirt", "tee", "tees", "t-shirt", "tank", "camisole", "camis"],
    ["top", "tops", "cami"],
    ["polo", "polos", "polo shirt"],
    // Tailored / formal (2)
    ["suit", "suits", "tuxedo", "tuxedos", "suit jacket", "dress jacket"],
    ["vest", "vests", "gilet", "gilets", "waistcoat", "waistcoats"],
    // Outerwear (3)
    ["blazer", "blazers", "sport coat", "sportcoat"],
    [
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
    ],
    [
        "coat",
        "coats",
        "parka",
        "parkas",
        "trench",
        "windbreaker",
        "windbreakers",
        "overcoat",
        "overcoats",
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
];
var BROAD_TOP_QUERY_EXPANSION = [
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
    "tank",
    "tank top",
    "camisole",
    "cami",
    "camis",
    "polo",
    "polos",
    "polo shirt",
    "sweater",
    "sweaters",
    "cardigan",
    "cardigans",
    "jumper",
    "jumpers",
    "knitwear",
    "hoodie",
    "hoodies",
    "sweatshirt",
    "sweatshirts",
    "pullover",
    "pullovers",
];
/** Map specific surface forms to indexed hypernyms (index-time recall). */
exports.TYPE_TO_HYPERNYM = {
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
    "running shoe": "shoes",
    "running shoes": "shoes",
    "athletic shoe": "shoes",
    "athletic shoes": "shoes",
    "sport shoe": "shoes",
    "sport shoes": "shoes",
    "tennis shoe": "shoes",
    "tennis shoes": "shoes",
    boot: "shoes",
    boots: "shoes",
    "ankle boot": "shoes",
    "ankle boots": "shoes",
    "chelsea boot": "shoes",
    "chelsea boots": "shoes",
    "combat boot": "shoes",
    "combat boots": "shoes",
    sandal: "shoes",
    sandals: "shoes",
    loafer: "shoes",
    loafers: "shoes",
    heel: "shoes",
    heels: "shoes",
    flat: "shoes",
    flats: "shoes",
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
    coat: "outerwear",
    coats: "outerwear",
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
    poncho: "outerwear",
    anorak: "outerwear",
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
var CLUSTER_FAMILY = [
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
    "tailored",
    "tailored",
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
var FAMILY_PAIR_PENALTY = {
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
function buildSymmetricFromList(pairs) {
    var ids = new Set();
    for (var _i = 0, pairs_1 = pairs; _i < pairs_1.length; _i++) {
        var _a = pairs_1[_i], a = _a[0], b = _a[1];
        ids.add(a);
        ids.add(b);
    }
    var idList = Array.from(ids);
    var out = {};
    for (var _b = 0, idList_1 = idList; _b < idList_1.length; _b++) {
        var id = idList_1[_b];
        out[id] = {};
        for (var _c = 0, idList_2 = idList; _c < idList_2.length; _c++) {
            var id2 = idList_2[_c];
            out[id][id2] = id === id2 ? 0 : 0;
        }
    }
    for (var _d = 0, pairs_2 = pairs; _d < pairs_2.length; _d++) {
        var _e = pairs_2[_d], a = _e[0], b = _e[1], p = _e[2];
        out[a][b] = Math.max(out[a][b], p);
        out[b][a] = Math.max(out[b][a], p);
    }
    return out;
}
function lookupPairPenalty(tbl, a, b) {
    var _a, _b;
    if (a === b)
        return 0;
    return (_b = (_a = tbl[a]) === null || _a === void 0 ? void 0 : _a[b]) !== null && _b !== void 0 ? _b : 0;
}
/** Symmetric intra-family penalty tables (all fashion families with micro-types). */
var BOTTOM_PENALTY_TBL = buildSymmetricFromList([
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
var SHORTS_SKIRT_PENALTY_TBL = buildSymmetricFromList([["shorts", "skirt", 0.58]]);
var FOOTWEAR_PENALTY_TBL = buildSymmetricFromList([
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
var TOPS_PENALTY_TBL = buildSymmetricFromList([
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
var DRESS_PENALTY_TBL = buildSymmetricFromList([["m_dr_dress", "m_dr_jump", 0.52]]);
var MODEST_PENALTY_TBL = buildSymmetricFromList([["m_md_abaya", "m_md_eth", 0.55]]);
var HEAD_PENALTY_TBL = buildSymmetricFromList([["m_hd_hijab", "m_hd_face", 0.5]]);
/** Canonical micro-ids for symmetric penalty tables (same macro family, different item). */
var BOTTOM_MICRO = {
    jogger: "m_bt_jog",
    legging: "m_bt_leg",
    jeans: "m_bt_jean",
    tailored: "m_bt_tail",
    cargo: "m_bt_cargo",
};
function bottomMicroGroup(token) {
    var t = token.toLowerCase().trim();
    if (!t)
        return null;
    var jog = new Set([
        "jogger",
        "joggers",
        "sweatpants",
        "track pants",
        "jogging pants",
        "jogging bottoms",
        "trackpants",
    ]);
    var leg = new Set(["legging", "leggings", "tights"]);
    var jean = new Set(["jean", "jeans", "denim", "denims"]);
    var tail = new Set(["pant", "pants", "trouser", "trousers", "chino", "chinos", "slacks", "dress pants", "dress pant"]);
    var cargo = new Set(["cargo", "cargo pants", "cargos"]);
    if (jog.has(t))
        return "jogger";
    if (leg.has(t))
        return "legging";
    if (jean.has(t))
        return "jeans";
    if (cargo.has(t))
        return "cargo";
    if (tail.has(t))
        return "tailored";
    return null;
}
var SHORTS_MICRO = new Set(["shorts", "bermuda", "bermudas", "board shorts"]);
var SKIRT_MICRO = new Set(["skirt", "skirts", "mini skirt", "midi skirt"]);
function shortsSkirtMicro(token) {
    var t = token.toLowerCase().trim();
    if (SHORTS_MICRO.has(t))
        return "shorts";
    if (SKIRT_MICRO.has(t))
        return "skirt";
    return null;
}
/** Footwear micro-ids align with cluster splits (order matches clusters 6–12). */
var FOOTWEAR_MICRO = {
    athletic: "m_ft_ath",
    boot: "m_ft_boot",
    sandal: "m_ft_sand",
    heel: "m_ft_heel",
    flat_dress: "m_ft_flat",
    mule_slide: "m_ft_mule",
    slipper: "m_ft_slip",
};
function footwearMicroGroup(token) {
    var t = token.toLowerCase().trim();
    if (!t)
        return null;
    var athletic = new Set([
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
    ]);
    var genericShoe = new Set(["shoe", "shoes"]);
    var boot = new Set(["boot", "boots", "ankle boot", "ankle boots", "chelsea boot", "chelsea boots", "combat boot", "combat boots"]);
    var sandal = new Set(["sandal", "sandals", "flip flop", "flip flops", "flip-flop", "flip-flops", "gladiator sandal", "gladiator sandals"]);
    var heel = new Set(["heel", "heels", "pump", "pumps", "stiletto", "stilettos", "wedge", "wedges", "slingback", "slingbacks", "kitten heel", "kitten heels"]);
    var flatDress = new Set([
        "flat",
        "flats",
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
    ]);
    var mule = new Set(["mule", "mules", "slide", "slides", "clog", "clogs"]);
    var slipper = new Set([
        "slipper",
        "slippers",
        "slip-on",
        "slip on",
        "slip ons",
        "slip-ons",
        "espadrille",
        "espadrilles",
    ]);
    if (athletic.has(t))
        return "athletic";
    if (genericShoe.has(t))
        return null;
    if (boot.has(t))
        return "boot";
    if (sandal.has(t))
        return "sandal";
    if (heel.has(t))
        return "heel";
    if (flatDress.has(t))
        return "flat_dress";
    if (mule.has(t))
        return "mule_slide";
    if (slipper.has(t))
        return "slipper";
    return null;
}
var TOPS_MICRO = {
    hoodie: "m_tp_hood",
    knit: "m_tp_knit",
    shirt: "m_tp_shirt",
    tee: "m_tp_tee",
    generic_top: "m_tp_gen",
    polo: "m_tp_polo",
};
function topsMicroGroup(token) {
    var t = token.toLowerCase().trim();
    if (!t)
        return null;
    if (new Set(["hoodie", "hoodies", "sweatshirt", "sweatshirts", "pullover", "pullovers"]).has(t))
        return "hoodie";
    if (new Set(["sweater", "sweaters", "cardigan", "cardigans", "jumper", "jumpers", "knitwear"]).has(t))
        return "knit";
    if (new Set(["shirt", "shirts", "blouse", "blouses", "button down", "button-down"]).has(t))
        return "shirt";
    if (new Set(["tshirt", "tee", "tees", "t-shirt", "tank", "camisole", "camis"]).has(t))
        return "tee";
    if (new Set(["top", "tops", "cami"]).has(t))
        return "generic_top";
    if (new Set(["polo", "polos", "polo shirt"]).has(t))
        return "polo";
    return null;
}
var OUTER_MICRO_SUIT = new Set([
    "suit",
    "suits",
    "tuxedo",
    "tuxedos",
]);
var OUTER_MICRO_BLAZER = new Set(["blazer", "blazers", "sport coat", "sportcoat", "suit jacket", "dress jacket"]);
var OUTER_MICRO_JACKET = new Set([
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
]);
var OUTER_MICRO_COAT = new Set([
    "coat",
    "coats",
    "parka",
    "parkas",
    "trench",
    "windbreaker",
    "windbreakers",
    "overcoat",
    "overcoats",
]);
var OUTER_MICRO_VEST = new Set([
    "vest",
    "vests",
    "gilet",
    "gilets",
    "waistcoat",
    "waistcoats",
    "poncho",
    "anorak",
]);
function outerMicroGroup(token) {
    var t = token.toLowerCase().trim();
    if (OUTER_MICRO_SUIT.has(t))
        return "suit";
    if (OUTER_MICRO_BLAZER.has(t))
        return "blazer";
    if (OUTER_MICRO_JACKET.has(t))
        return "jacket";
    if (OUTER_MICRO_COAT.has(t))
        return "coat";
    if (OUTER_MICRO_VEST.has(t))
        return "vest";
    return null;
}
// Penalty between outerwear micro-types. Keep generic jacket reasonably close to
// coats, but do not let blazer/suit/vest drift into plain jacket searches.
var OUTER_PAIR_PENALTY = {
    suit: { suit: 0, blazer: 0.50, jacket: 0.65, coat: 0.72, vest: 0.58 },
    blazer: { suit: 0.50, blazer: 0, jacket: 0.44, coat: 0.58, vest: 0.50 },
    jacket: { suit: 0.65, blazer: 0.44, jacket: 0, coat: 0.32, vest: 0.50 },
    coat: { suit: 0.72, blazer: 0.58, jacket: 0.32, coat: 0, vest: 0.62 },
    vest: { suit: 0.58, blazer: 0.50, jacket: 0.50, coat: 0.62, vest: 0 },
};
var DRESS_MICRO = {
    dress: "m_dr_dress",
    jumpsuit: "m_dr_jump",
};
function dressMicroGroup(token) {
    var t = token.toLowerCase().trim();
    if (new Set([
        "dress",
        "dresses",
        "gown",
        "gowns",
        "frock",
        "midi dress",
        "maxi dress",
        "mini dress",
    ]).has(t))
        return "dress";
    if (new Set(["jumpsuit", "jumpsuits", "romper", "rompers", "playsuit", "playsuits"]).has(t))
        return "jumpsuit";
    return null;
}
var MODEST_MICRO = {
    abaya_row: "m_md_abaya",
    ethnic_south_asian: "m_md_eth",
};
function modestEthnicMicroGroup(token) {
    var t = token.toLowerCase().trim();
    if (new Set([
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
    ]).has(t))
        return "abaya_row";
    if (new Set([
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
    ]).has(t))
        return "ethnic_south_asian";
    return null;
}
var HEAD_MICRO = {
    hijab_scarf: "m_hd_hijab",
    face: "m_hd_face",
};
function headMicroGroup(token) {
    var t = token.toLowerCase().trim();
    if (new Set(["hijab", "hijabs", "headscarf", "headscarves", "headwrap", "sheyla", "shayla"]).has(t))
        return "hijab_scarf";
    if (new Set(["niqab", "burqa"]).has(t))
        return "face";
    return null;
}
/**
 * Cross-cluster soft siblings: token pairs from different clusters within the same family
 * that are visually/functionally related but not synonyms (e.g. vest-as-top ↔ tank/cami).
 * Score kept at 0.58 — above zero but below the within-cluster default of 0.64.
 */
var SOFT_SIBLING_RAW = [
    ["vest", "tank", 0.58],
    ["vest", "cami", 0.58],
    ["vest", "camisole", 0.58],
    ["vest", "camis", 0.58],
    ["vests", "tank", 0.58],
    ["vests", "cami", 0.58],
    ["vests", "camisole", 0.58],
    ["vests", "camis", 0.58],
];
var SOFT_SIBLING_MAP = (function () {
    var m = new Map();
    for (var _i = 0, SOFT_SIBLING_RAW_1 = SOFT_SIBLING_RAW; _i < SOFT_SIBLING_RAW_1.length; _i++) {
        var _a = SOFT_SIBLING_RAW_1[_i], a = _a[0], b = _a[1], score = _a[2];
        if (!m.has(a))
            m.set(a, new Map());
        if (!m.has(b))
            m.set(b, new Map());
        m.get(a).set(b, score);
        m.get(b).set(a, score);
    }
    return m;
})();
var clusterIndex = null;
var typeToFamilyIndex = null;
function buildClusterIndex() {
    var m = new Map();
    for (var _i = 0, PRODUCT_TYPE_CLUSTERS_1 = exports.PRODUCT_TYPE_CLUSTERS; _i < PRODUCT_TYPE_CLUSTERS_1.length; _i++) {
        var cluster = PRODUCT_TYPE_CLUSTERS_1[_i];
        var set = new Set(cluster);
        for (var _a = 0, cluster_1 = cluster; _a < cluster_1.length; _a++) {
            var t = cluster_1[_a];
            m.set(t, set);
        }
    }
    return m;
}
function buildTypeToFamily() {
    var m = new Map();
    exports.PRODUCT_TYPE_CLUSTERS.forEach(function (cluster, i) {
        var _a;
        var fam = (_a = CLUSTER_FAMILY[i]) !== null && _a !== void 0 ? _a : "other";
        for (var _i = 0, cluster_2 = cluster; _i < cluster_2.length; _i++) {
            var t = cluster_2[_i];
            m.set(t, fam);
        }
    });
    return m;
}
function getClusterIndex() {
    if (!clusterIndex)
        clusterIndex = buildClusterIndex();
    return clusterIndex;
}
function getTypeToFamily() {
    if (!typeToFamilyIndex)
        typeToFamilyIndex = buildTypeToFamily();
    return typeToFamilyIndex;
}
function familiesForTokens(tokens) {
    var fam = getTypeToFamily();
    var out = new Set();
    for (var _i = 0, tokens_1 = tokens; _i < tokens_1.length; _i++) {
        var raw = tokens_1[_i];
        var t = raw.toLowerCase().trim();
        if (!t)
            continue;
        var f = fam.get(t);
        if (f)
            out.add(f);
    }
    return out;
}
var GARMENT_LIKE_FAMILIES = new Set([
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
function hasGarmentLikeFamilyFromProductTypeSeeds(seeds) {
    if (!seeds.length)
        return false;
    var expanded = expandProductTypesForQuery(seeds.map(function (s) { return String(s).toLowerCase().trim(); }).filter(Boolean));
    var fams = familiesForTokens(expanded);
    for (var _i = 0, fams_1 = fams; _i < fams_1.length; _i++) {
        var f = fams_1[_i];
        if (GARMENT_LIKE_FAMILIES.has(f))
            return true;
    }
    return false;
}
function pairPenalty(a, b) {
    if (a === b)
        return 0;
    var row = FAMILY_PAIR_PENALTY[a];
    if (row && row[b] !== undefined)
        return row[b];
    var row2 = FAMILY_PAIR_PENALTY[b];
    if (row2 && row2[a] !== undefined)
        return row2[a];
    return 0;
}
var sortedTypePhrases = null;
function escapeRegexForLexical(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function normalizeForLexicalMatch(s) {
    return s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function phraseMatchesWholeWords(queryNorm, phrase) {
    var pn = normalizeForLexicalMatch(phrase);
    if (!pn || pn.length < 2)
        return false;
    var words = pn.split(/\s+/).filter(Boolean);
    if (words.length === 0)
        return false;
    var core = words.map(escapeRegexForLexical).join("\\s+");
    var re = new RegExp("\\b(?:".concat(core, ")\\b"), "i");
    return re.test(queryNorm);
}
var GENERIC_SHORTS_QUERY_SEEDS = new Set(["shorts", "bermuda", "bermudas"]);
var GENERIC_SHORTS_EXPANSION_EXCLUDES = new Set(["short", "board shorts"]);
function getProductTypePhrasesLongestFirst() {
    if (sortedTypePhrases)
        return sortedTypePhrases;
    var s = new Set();
    for (var _i = 0, PRODUCT_TYPE_CLUSTERS_2 = exports.PRODUCT_TYPE_CLUSTERS; _i < PRODUCT_TYPE_CLUSTERS_2.length; _i++) {
        var cluster = PRODUCT_TYPE_CLUSTERS_2[_i];
        for (var _a = 0, cluster_3 = cluster; _a < cluster_3.length; _a++) {
            var t = cluster_3[_a];
            s.add(String(t).toLowerCase().trim());
        }
    }
    for (var _b = 0, _c = Object.keys(exports.TYPE_TO_HYPERNYM); _b < _c.length; _b++) {
        var k = _c[_b];
        s.add(k.toLowerCase());
    }
    sortedTypePhrases = __spreadArray([], s, true).filter(Boolean).sort(function (a, b) { return b.length - a.length; });
    return sortedTypePhrases;
}
function extractLexicalProductTypeSeeds(rawQuery) {
    var qNorm = normalizeForLexicalMatch(rawQuery);
    if (!qNorm)
        return [];
    var hits = [];
    var isVestTopQuery = /\b(?:sleeveless\s+)?vest\s+top\b/.test(qNorm);
    if (isVestTopQuery)
        hits.push("tank");
    for (var _i = 0, _a = getProductTypePhrasesLongestFirst(); _i < _a.length; _i++) {
        var phrase = _a[_i];
        if (!phrase || phrase.length < 2)
            continue;
        if (isVestTopQuery && phrase === "vest")
            continue;
        if (phraseMatchesWholeWords(qNorm, phrase))
            hits.push(phrase);
    }
    var fam = getTypeToFamily();
    for (var _b = 0, _c = qNorm.split(/\s+/); _b < _c.length; _b++) {
        var w = _c[_b];
        if (w.length < 2)
            continue;
        if (isVestTopQuery && w === "vest")
            continue;
        if (fam.has(w))
            hits.push(w);
    }
    return __spreadArray([], new Set(hits), true);
}
function extractExplicitSleeveIntent(rawText) {
    var qNorm = normalizeForLexicalMatch(rawText);
    if (!qNorm)
        return undefined;
    var hits = new Set();
    if (/\b(short\s+sleeves?|short\s+sleeved|shortsleeve|short-sleeve(?:d)?)\b/.test(qNorm)) {
        hits.add("short");
    }
    if (/\b(long\s+sleeves?|long\s+sleeved|longsleeve|long-sleeve(?:d)?)\b/.test(qNorm)) {
        hits.add("long");
    }
    if (/\b(sleeveless|no\s+sleeves?|without\s+sleeves?|tank\s+tops?|camisoles?|cami\b|vest\s+tops?|spaghetti\s+straps?|strapless|halter)\b/.test(qNorm)) {
        hits.add("sleeveless");
    }
    return hits.size === 1 ? Array.from(hits)[0] : undefined;
}
/** Map vision/catalog aisle strings to taxonomy macro families (tops, dress, outerwear, …). */
function intentFamiliesForProductCategory(productCategory) {
    var c = String(productCategory || "")
        .toLowerCase()
        .trim()
        .replace(/[\s_-]+/g, " ");
    var m = {
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
    var list = m[c];
    if (!list)
        return null;
    return new Set(list);
}
function familiesForExpandedSeed(seed) {
    var t = String(seed || "")
        .toLowerCase()
        .trim();
    if (!t)
        return new Set();
    return familiesForTokens(expandProductTypesForQuery([t]));
}
/**
 * Drop lexical type seeds whose taxonomy macro-family does not match the mapped product aisle.
 * Prevents compound labels (e.g. "vest dress" → dress + vest tokens) from pulling in sibling
 * clusters in another family (vest ↔ coat/jacket), and the same class of bug for tops/bottoms/etc.
 */
function filterProductTypeSeedsByMappedCategory(seeds, productCategory) {
    var allowed = intentFamiliesForProductCategory(productCategory);
    if (!allowed || seeds.length === 0)
        return seeds;
    var kept = seeds.filter(function (seed) {
        var fams = familiesForExpandedSeed(String(seed));
        if (fams.size === 0)
            return true;
        for (var _i = 0, fams_2 = fams; _i < fams_2.length; _i++) {
            var f = fams_2[_i];
            if (allowed.has(f))
                return true;
        }
        return false;
    });
    return kept.length > 0 ? kept : seeds;
}
/** Whole-word fashion product nouns — backs `hasTypeIntent` when AST misses type entities. */
var FASHION_TYPE_NOUNS = new Set([
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
function fashionNounStemCandidates(token) {
    var t = token.toLowerCase();
    var out = new Set([t]);
    if (t.length > 3 && t.endsWith("ies")) {
        out.add(t.slice(0, -3) + "y");
    }
    if (t.length > 3 && t.endsWith("es")) {
        out.add(t.slice(0, -2));
    }
    if (t.length > 2 && t.endsWith("s") && !t.endsWith("ss")) {
        out.add(t.slice(0, -1));
    }
    return __spreadArray([], out, true);
}
/**
 * Explicit garment/footwear/accessory nouns from tokenized query text.
 * Complements {@link extractLexicalProductTypeSeeds} when NLP leaves product types out of AST entities.
 */
function extractFashionTypeNounTokens(rawQuery) {
    var qNorm = normalizeForLexicalMatch(rawQuery);
    if (!qNorm)
        return [];
    var found = [];
    for (var _i = 0, _a = qNorm.split(/\s+/); _i < _a.length; _i++) {
        var w = _a[_i];
        if (w.length < 2)
            continue;
        for (var _b = 0, _c = fashionNounStemCandidates(w); _b < _c.length; _b++) {
            var cand = _c[_b];
            if (FASHION_TYPE_NOUNS.has(cand)) {
                found.push(cand);
                break;
            }
        }
    }
    return __spreadArray([], new Set(found), true);
}
function crossFamilyTypePenaltyEnabled() {
    var _a;
    var v = String((_a = process.env.SEARCH_TYPE_CROSS_FAMILY_PENALTY) !== null && _a !== void 0 ? _a : "1").toLowerCase();
    return v !== "0" && v !== "false" && v !== "off";
}
/**
 * Max penalty when query and document tokens are in the same macro family but different
 * garment micro-types (covers all major fashion families in this taxonomy).
 */
function intraFamilySubtypePenalty(querySeeds, docTypes) {
    var _a;
    var seeds = querySeeds.map(function (s) { return s.toLowerCase().trim(); }).filter(Boolean);
    var docs = docTypes.map(function (s) { return s.toLowerCase().trim(); }).filter(Boolean);
    if (seeds.length === 0 || docs.length === 0)
        return 0;
    var maxPen = 0;
    for (var _i = 0, seeds_1 = seeds; _i < seeds_1.length; _i++) {
        var s = seeds_1[_i];
        for (var _b = 0, docs_1 = docs; _b < docs_1.length; _b++) {
            var d = docs_1[_b];
            var bq = bottomMicroGroup(s);
            var bd = bottomMicroGroup(d);
            if (bq && bd) {
                var ia = BOTTOM_MICRO[bq];
                var ib = BOTTOM_MICRO[bd];
                maxPen = Math.max(maxPen, lookupPairPenalty(BOTTOM_PENALTY_TBL, ia, ib));
            }
            var fq = footwearMicroGroup(s);
            var fd = footwearMicroGroup(d);
            if (fq && fd) {
                maxPen = Math.max(maxPen, lookupPairPenalty(FOOTWEAR_PENALTY_TBL, FOOTWEAR_MICRO[fq], FOOTWEAR_MICRO[fd]));
            }
            var tq = topsMicroGroup(s);
            var td = topsMicroGroup(d);
            if (tq && td) {
                maxPen = Math.max(maxPen, lookupPairPenalty(TOPS_PENALTY_TBL, TOPS_MICRO[tq], TOPS_MICRO[td]));
            }
            var oq = outerMicroGroup(s);
            var od = outerMicroGroup(d);
            if (oq && od) {
                maxPen = Math.max(maxPen, (_a = OUTER_PAIR_PENALTY[oq][od]) !== null && _a !== void 0 ? _a : 0);
            }
            var dq = dressMicroGroup(s);
            var dd = dressMicroGroup(d);
            if (dq && dd) {
                maxPen = Math.max(maxPen, lookupPairPenalty(DRESS_PENALTY_TBL, DRESS_MICRO[dq], DRESS_MICRO[dd]));
            }
            var sq = shortsSkirtMicro(s);
            var sd = shortsSkirtMicro(d);
            if (sq && sd) {
                maxPen = Math.max(maxPen, lookupPairPenalty(SHORTS_SKIRT_PENALTY_TBL, sq, sd));
            }
            var mq = modestEthnicMicroGroup(s);
            var md = modestEthnicMicroGroup(d);
            if (mq && md) {
                maxPen = Math.max(maxPen, lookupPairPenalty(MODEST_PENALTY_TBL, MODEST_MICRO[mq], MODEST_MICRO[md]));
            }
            var hq = headMicroGroup(s);
            var hd = headMicroGroup(d);
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
function inferMacroFamiliesFromListingCategoryFields(categoryCanonical, category) {
    var parts = [];
    if (categoryCanonical != null && String(categoryCanonical).trim()) {
        parts.push(String(categoryCanonical));
    }
    if (category != null && String(category).trim()) {
        parts.push(String(category));
    }
    var combined = parts.join(" ").toLowerCase().replace(/[\s_-]+/g, " ").trim();
    if (!combined)
        return new Set();
    var direct = intentFamiliesForProductCategory(combined);
    if (direct && direct.size > 0)
        return direct;
    for (var _i = 0, _a = combined.split(/\s+/); _i < _a.length; _i++) {
        var seg = _a[_i];
        var d = intentFamiliesForProductCategory(seg);
        if (d && d.size > 0)
            return d;
    }
    var out = new Set();
    if (/\b(footwear|sneaker|sneakers|boot|boots|sandal|sandals|loafer|loafers|heel|heels|slipper|slippers|mule|mules|clog|clogs|trainer|trainers|flipflop|flip-flop|flip flops|crocs?|shoe|shoes)\b/.test(combined)) {
        out.add("footwear");
    }
    var hasTopAccessoryPhrase = /\btop(?:\s|-)+(handle|zip|zipper|stitch|stitching|coat|bag|satchel|clutch|pouch|wallet|case|cover|closure)\b/.test(combined);
    if (!hasTopAccessoryPhrase &&
        /\b(shirt|shirts|blouse|blouses|tee|tees|t-?shirt|tshirt|polos?|sweater|sweaters|hoodie|hoodies|cardigan|cardigans|tank|tanks|camisole|bodysuit|top|tops)\b/.test(combined)) {
        out.add("tops");
    }
    if (/\b(pants?|jeans?|trousers?|leggings?|joggers?|chinos?|cargos?)\b/.test(combined)) {
        out.add("bottoms");
    }
    if (/\b(shorts|bermudas?|skirt|skirts)\b/.test(combined)) {
        out.add("shorts_skirt");
    }
    if (/\b(dresses?|gown|gowns)\b/.test(combined)) {
        out.add("dress");
    }
    if (/\b(coat|coats|jacket|jackets|blazer|blazers|parka|parkas|puffer|vests?)\b/.test(combined)) {
        out.add("outerwear");
    }
    if (/\b(suit|suits|tuxedo|tuxedos|waistcoat|waistcoats|vest|vests|gilet|gilets)\b/.test(combined)) {
        out.add("tailored");
    }
    if (/\b(bag|bags|handbag|handbags|tote|totes|backpack|backpacks)\b/.test(combined)) {
        out.add("bags");
    }
    return out;
}
function scoreCrossFamilyTypePenalty(querySeeds, docProductTypes, opts) {
    if (!crossFamilyTypePenaltyEnabled())
        return 0;
    var seeds = querySeeds.map(function (s) { return s.toLowerCase().trim(); }).filter(Boolean);
    if (seeds.length === 0)
        return 0;
    var expandedQuery = expandProductTypesForQuery(seeds);
    var qFam = familiesForTokens(expandedQuery);
    if (qFam.size === 0)
        return 0;
    var dFam = familiesForTokens(docProductTypes.map(function (t) { return t.toLowerCase().trim(); }).filter(Boolean));
    var dFromCategory = inferMacroFamiliesFromListingCategoryFields(opts === null || opts === void 0 ? void 0 : opts.categoryCanonical, opts === null || opts === void 0 ? void 0 : opts.category);
    if (dFromCategory.size > 0) {
        dFam = new Set(__spreadArray(__spreadArray([], dFam, true), dFromCategory, true));
    }
    if (dFam.size === 0)
        return 0;
    var max = 0;
    for (var _i = 0, qFam_1 = qFam; _i < qFam_1.length; _i++) {
        var qf = qFam_1[_i];
        for (var _a = 0, dFam_1 = dFam; _a < dFam_1.length; _a++) {
            var df = dFam_1[_a];
            max = Math.max(max, pairPenalty(qf, df));
        }
    }
    return max;
}
function expandProductTypesForQuery(seeds) {
    var idx = getClusterIndex();
    var out = new Set();
    for (var _i = 0, seeds_2 = seeds; _i < seeds_2.length; _i++) {
        var s = seeds_2[_i];
        var key = s.toLowerCase().trim();
        if (!key)
            continue;
        out.add(key);
        if (key === "top" || key === "tops") {
            for (var _a = 0, BROAD_TOP_QUERY_EXPANSION_1 = BROAD_TOP_QUERY_EXPANSION; _a < BROAD_TOP_QUERY_EXPANSION_1.length; _a++) {
                var t = BROAD_TOP_QUERY_EXPANSION_1[_a];
                out.add(t);
            }
        }
        var cluster = idx.get(key);
        if (cluster) {
            for (var _b = 0, cluster_4 = cluster; _b < cluster_4.length; _b++) {
                var t = cluster_4[_b];
                if (GENERIC_SHORTS_QUERY_SEEDS.has(key) && GENERIC_SHORTS_EXPANSION_EXCLUDES.has(t)) {
                    continue;
                }
                out.add(t);
            }
        }
    }
    return __spreadArray([], out, true);
}
function expandProductTypesForIndexing(types) {
    var out = new Set();
    for (var _i = 0, types_1 = types; _i < types_1.length; _i++) {
        var t = types_1[_i];
        var key = t.toLowerCase().trim();
        if (!key)
            continue;
        out.add(key);
        var hyper = exports.TYPE_TO_HYPERNYM[key];
        if (hyper)
            out.add(hyper);
    }
    return __spreadArray([], out, true);
}
function scoreProductTypeTaxonomyMatch(queryTypes, docTypes, opts) {
    var _a;
    var wCluster = (_a = opts === null || opts === void 0 ? void 0 : opts.sameClusterWeight) !== null && _a !== void 0 ? _a : 0.82;
    var q = new Set(queryTypes.map(function (t) { return t.toLowerCase().trim(); }).filter(Boolean));
    var d = new Set(docTypes.map(function (t) { return t.toLowerCase().trim(); }).filter(Boolean));
    if (q.size === 0)
        return { score: 0, bestQueryType: null, bestDocType: null };
    for (var _i = 0, q_1 = q; _i < q_1.length; _i++) {
        var qt = q_1[_i];
        if (d.has(qt)) {
            return { score: 1, bestQueryType: qt, bestDocType: qt };
        }
    }
    var idx = getClusterIndex();
    var best = 0;
    var bestQ = null;
    var bestD = null;
    for (var _b = 0, q_2 = q; _b < q_2.length; _b++) {
        var qt = q_2[_b];
        var cq = idx.get(qt);
        if (!cq)
            continue;
        for (var _c = 0, d_1 = d; _c < d_1.length; _c++) {
            var dt = d_1[_c];
            if (cq.has(dt)) {
                best = Math.max(best, wCluster);
                bestQ = qt;
                bestD = dt;
            }
        }
    }
    // Soft cross-cluster siblings (e.g. vest-as-top ↔ tank/cami)
    if (best < wCluster) {
        for (var _d = 0, q_3 = q; _d < q_3.length; _d++) {
            var qt = q_3[_d];
            var softRow = SOFT_SIBLING_MAP.get(qt);
            if (!softRow)
                continue;
            for (var _e = 0, d_2 = d; _e < d_2.length; _e++) {
                var dt = d_2[_e];
                var softScore = softRow.get(dt);
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
function scoreHypernymDocMatch(querySeeds, docTypes) {
    var seeds = querySeeds.map(function (s) { return s.toLowerCase().trim(); }).filter(Boolean);
    var d = new Set(docTypes.map(function (t) { return t.toLowerCase().trim(); }).filter(Boolean));
    if (seeds.length === 0 || d.size === 0)
        return 0;
    for (var _i = 0, seeds_3 = seeds; _i < seeds_3.length; _i++) {
        var s = seeds_3[_i];
        var hyper = exports.TYPE_TO_HYPERNYM[s];
        if (hyper && d.has(hyper))
            return 0.54;
    }
    return 0;
}
var DEFAULT_SIBLING_CLUSTER_WEIGHT = 0.64;
function isBroadExactToken(token) {
    var t = String(token || "").toLowerCase().trim();
    if (!t)
        return false;
    // "top/tops/cami" is intentionally a broad catch-all; treat as non-exact for rerank.
    if (topsMicroGroup(t) === "generic_top")
        return true;
    // Hypernym-level labels are too broad for "exact" matching (e.g. shoes/pants/outerwear/bag).
    var hyperValues = new Set(Object.values(exports.TYPE_TO_HYPERNYM).map(function (x) { return String(x).toLowerCase().trim(); }));
    return hyperValues.has(t);
}
function scoreRerankProductTypeBreakdown(querySeeds, docTypes, opts) {
    var _a, _b, _c, _d;
    var seeds = __spreadArray([], new Set(querySeeds.map(function (s) { return s.toLowerCase().trim(); }).filter(Boolean)), true);
    var docs = docTypes.map(function (t) { return t.toLowerCase().trim(); }).filter(Boolean);
    if (seeds.length === 0) {
        return {
            exactTypeScore: 0,
            siblingClusterScore: 0,
            parentHypernymScore: 0,
            intraFamilyPenalty: 0,
            combinedTypeCompliance: 0,
        };
    }
    var wSib = (_a = opts === null || opts === void 0 ? void 0 : opts.siblingClusterWeight) !== null && _a !== void 0 ? _a : DEFAULT_SIBLING_CLUSTER_WEIGHT;
    var wIntra = (_b = opts === null || opts === void 0 ? void 0 : opts.intraPenaltyWeight) !== null && _b !== void 0 ? _b : 0.62;
    var clusterTax = scoreProductTypeTaxonomyMatch(seeds, docs, { sameClusterWeight: wSib });
    var parentHypernymScore = scoreHypernymDocMatch(seeds, docs);
    var intraFamilyPenalty = intraFamilySubtypePenalty(seeds, docs);
    var exactTax = scoreProductTypeTaxonomyMatch(seeds, docs, { sameClusterWeight: 0 });
    var exactToken = (_d = (_c = exactTax.bestQueryType) !== null && _c !== void 0 ? _c : exactTax.bestDocType) !== null && _d !== void 0 ? _d : "";
    var hasExactType = exactTax.score >= 1 && !isBroadExactToken(exactToken);
    var hasSameFamilyType = Math.max(clusterTax.score, parentHypernymScore) > 0 || intraFamilyPenalty > 0;
    var siblingClusterScore = hasExactType ? 1 : clusterTax.score;
    var base = hasExactType ? 1 : Math.max(clusterTax.score, parentHypernymScore);
    var combinedTypeCompliance = Math.max(0, Math.min(1, base - intraFamilyPenalty * wIntra));
    var exactTypeScore = hasExactType
        ? 1
        : hasSameFamilyType
            ? Math.max(0.2, Math.min(0.65, combinedTypeCompliance))
            : docs.length > 0
                ? 0.2
                : 0;
    return {
        exactTypeScore: exactTypeScore,
        siblingClusterScore: siblingClusterScore,
        parentHypernymScore: parentHypernymScore,
        intraFamilyPenalty: intraFamilyPenalty,
        combinedTypeCompliance: combinedTypeCompliance,
    };
}
/** Minimum intra-family penalty to treat two bottom/footwear/tops hints as conflicting. */
var SPURIOUS_CATEGORY_MIN_SAME_FAMILY_PENALTY = 0.38;
function dedupeGarmentHints(hints) {
    var seen = new Set();
    var out = [];
    for (var _i = 0, hints_1 = hints; _i < hints_1.length; _i++) {
        var h = hints_1[_i];
        var key = JSON.stringify(h);
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(h);
    }
    return out;
}
function inferGarmentHintsFromQuerySeeds(seeds) {
    var out = [];
    for (var _i = 0, seeds_4 = seeds; _i < seeds_4.length; _i++) {
        var raw = seeds_4[_i];
        var t = raw.toLowerCase().trim();
        if (!t)
            continue;
        var b = bottomMicroGroup(t);
        if (b)
            out.push({ kind: "bottom", id: BOTTOM_MICRO[b] });
        var ss = shortsSkirtMicro(t);
        if (ss)
            out.push({ kind: "shorts_skirt", sk: ss });
        var ft = footwearMicroGroup(t);
        if (ft)
            out.push({ kind: "footwear", id: FOOTWEAR_MICRO[ft] });
        var tp = topsMicroGroup(t);
        if (tp)
            out.push({ kind: "tops", id: TOPS_MICRO[tp] });
        var dr = dressMicroGroup(t);
        if (dr)
            out.push({ kind: "dress", id: DRESS_MICRO[dr] });
        var ax = accessoryMicroGroup(t);
        if (ax)
            out.push({ kind: "accessory", id: ax });
    }
    return dedupeGarmentHints(out);
}
function inferGarmentHintsFromCategoryString(raw) {
    if (!raw)
        return [];
    var s = String(raw).toLowerCase();
    var out = [];
    var words = s.split(/[^a-z0-9]+/).filter(Boolean);
    for (var _i = 0, words_1 = words; _i < words_1.length; _i++) {
        var w = words_1[_i];
        var b = bottomMicroGroup(w);
        if (b)
            out.push({ kind: "bottom", id: BOTTOM_MICRO[b] });
        var ss = shortsSkirtMicro(w);
        if (ss)
            out.push({ kind: "shorts_skirt", sk: ss });
        var ft = footwearMicroGroup(w);
        if (ft)
            out.push({ kind: "footwear", id: FOOTWEAR_MICRO[ft] });
        var tp = topsMicroGroup(w);
        if (tp)
            out.push({ kind: "tops", id: TOPS_MICRO[tp] });
        var dr = dressMicroGroup(w);
        if (dr)
            out.push({ kind: "dress", id: DRESS_MICRO[dr] });
        var ax = accessoryMicroGroup(w);
        if (ax)
            out.push({ kind: "accessory", id: ax });
    }
    if (/\bskirts?\b/.test(s))
        out.push({ kind: "shorts_skirt", sk: "skirt" });
    if (/\b(?:board\s+)?shorts\b|\bbermuda\b/.test(s))
        out.push({ kind: "shorts_skirt", sk: "shorts" });
    if (/\b(sweater|cardigan|hoodie|blouse|shirt|tee|knitwear|polo)\b/.test(s)) {
        var m = s.match(/\b(sweaters?|cardigans?|hoodies?|blouses?|shirts?|tees?|knitwear|polos?)\b/);
        if (m) {
            var tp = topsMicroGroup(m[1]);
            if (tp)
                out.push({ kind: "tops", id: TOPS_MICRO[tp] });
        }
    }
    if (/\b(dresses?|gowns?|jumpsuits?|rompers?)\b/.test(s)) {
        var m = s.match(/\b(dresses?|gowns?|jumpsuits?|rompers?)\b/);
        if (m) {
            var dr = dressMicroGroup(m[1]);
            if (dr)
                out.push({ kind: "dress", id: DRESS_MICRO[dr] });
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
function accessoryMicroGroup(token) {
    var t = token.toLowerCase().trim();
    if (new Set([
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
    ]).has(t))
        return "bag";
    if (new Set(["hat", "hats", "cap", "caps", "beanie", "beanies", "beret", "berets"]).has(t))
        return "headwear";
    if (new Set(["scarf", "scarves", "shawl", "shawls", "stole", "stoles", "wrap", "wraps"]).has(t))
        return "scarf";
    if (new Set(["belt", "belts"]).has(t))
        return "belt";
    if (new Set([
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
    ]).has(t))
        return "jewelry";
    if (new Set(["sock", "socks", "hosiery", "stocking", "stockings"]).has(t))
        return "hosiery";
    return null;
}
function docSupportsGarmentHint(docProductTypes, hint) {
    var docs = docProductTypes.map(function (t) { return t.toLowerCase().trim(); }).filter(Boolean);
    if (docs.length === 0)
        return false;
    switch (hint.kind) {
        case "bottom":
            return docs.some(function (d) {
                var g = bottomMicroGroup(d);
                return g ? BOTTOM_MICRO[g] === hint.id : false;
            });
        case "shorts_skirt":
            return docs.some(function (d) { return shortsSkirtMicro(d) === hint.sk; });
        case "footwear":
            return docs.some(function (d) {
                var g = footwearMicroGroup(d);
                return g ? FOOTWEAR_MICRO[g] === hint.id : false;
            });
        case "tops":
            return docs.some(function (d) {
                var g = topsMicroGroup(d);
                return g ? TOPS_MICRO[g] === hint.id : false;
            });
        case "dress":
            return docs.some(function (d) {
                var g = dressMicroGroup(d);
                return g ? DRESS_MICRO[g] === hint.id : false;
            });
        case "accessory":
            return docs.some(function (d) { return accessoryMicroGroup(d) === hint.id; });
        default:
            return false;
    }
}
function garmentHintsConflict(a, b) {
    if (a.kind === "bottom" && b.kind === "bottom") {
        return (lookupPairPenalty(BOTTOM_PENALTY_TBL, a.id, b.id) >= SPURIOUS_CATEGORY_MIN_SAME_FAMILY_PENALTY);
    }
    if (a.kind === "footwear" && b.kind === "footwear") {
        return (lookupPairPenalty(FOOTWEAR_PENALTY_TBL, a.id, b.id) >= SPURIOUS_CATEGORY_MIN_SAME_FAMILY_PENALTY);
    }
    if (a.kind === "tops" && b.kind === "tops") {
        return (lookupPairPenalty(TOPS_PENALTY_TBL, a.id, b.id) >= SPURIOUS_CATEGORY_MIN_SAME_FAMILY_PENALTY);
    }
    if (a.kind === "dress" && b.kind === "dress") {
        return (lookupPairPenalty(DRESS_PENALTY_TBL, a.id, b.id) >= SPURIOUS_CATEGORY_MIN_SAME_FAMILY_PENALTY);
    }
    if (a.kind === "shorts_skirt" && b.kind === "shorts_skirt") {
        return (a.sk !== b.sk &&
            lookupPairPenalty(SHORTS_SKIRT_PENALTY_TBL, a.sk, b.sk) >= 0.5);
    }
    if ((a.kind === "shorts_skirt" && b.kind === "bottom") ||
        (a.kind === "bottom" && b.kind === "shorts_skirt")) {
        return true;
    }
    if ((a.kind === "tops" && b.kind === "bottom") ||
        (a.kind === "bottom" && b.kind === "tops")) {
        return true;
    }
    if ((a.kind === "tops" && b.kind === "shorts_skirt") ||
        (a.kind === "shorts_skirt" && b.kind === "tops")) {
        return true;
    }
    if ((a.kind === "dress" && b.kind === "bottom") ||
        (a.kind === "bottom" && b.kind === "dress")) {
        return true;
    }
    if ((a.kind === "dress" && b.kind === "tops") ||
        (a.kind === "tops" && b.kind === "dress")) {
        return true;
    }
    if ((a.kind === "dress" && b.kind === "shorts_skirt") ||
        (a.kind === "shorts_skirt" && b.kind === "dress")) {
        return true;
    }
    if ((a.kind === "footwear" && b.kind === "bottom") ||
        (a.kind === "bottom" && b.kind === "footwear")) {
        return true;
    }
    if ((a.kind === "footwear" && b.kind === "shorts_skirt") ||
        (a.kind === "shorts_skirt" && b.kind === "footwear")) {
        return true;
    }
    if ((a.kind === "footwear" && b.kind === "tops") ||
        (a.kind === "tops" && b.kind === "footwear")) {
        return true;
    }
    if ((a.kind === "footwear" && b.kind === "dress") ||
        (a.kind === "dress" && b.kind === "footwear")) {
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
function downrankSpuriousProductTypeFromCategory(querySeeds, docProductTypes, docCategoryRaw) {
    var seeds = querySeeds.map(function (s) { return s.toLowerCase().trim(); }).filter(Boolean);
    var docs = docProductTypes.map(function (t) { return t.toLowerCase().trim(); }).filter(Boolean);
    if (seeds.length === 0 || docs.length === 0)
        return { complianceScale: 1, forceExactZero: false };
    var qHints = inferGarmentHintsFromQuerySeeds(seeds);
    var catHints = inferGarmentHintsFromCategoryString(docCategoryRaw);
    if (qHints.length === 0 || catHints.length === 0)
        return { complianceScale: 1, forceExactZero: false };
    for (var _i = 0, qHints_1 = qHints; _i < qHints_1.length; _i++) {
        var qh = qHints_1[_i];
        for (var _a = 0, catHints_1 = catHints; _a < catHints_1.length; _a++) {
            var ch = catHints_1[_a];
            if (!garmentHintsConflict(qh, ch))
                continue;
            if (!docSupportsGarmentHint(docs, qh))
                continue;
            if (docSupportsGarmentHint(docs, ch))
                continue;
            return { complianceScale: 0.22, forceExactZero: true };
        }
    }
    return { complianceScale: 1, forceExactZero: false };
}
