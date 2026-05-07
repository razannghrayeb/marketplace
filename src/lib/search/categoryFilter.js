"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
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
exports.getCategorySearchTerms = getCategorySearchTerms;
exports.loadCategoryVocabulary = loadCategoryVocabulary;
exports.resolveCategoryTermsForOpensearch = resolveCategoryTermsForOpensearch;
exports.isCategoryDominantQuery = isCategoryDominantQuery;
exports.isProductTypeDominantQuery = isProductTypeDominantQuery;
exports.shouldHardFilterAstCategory = shouldHardFilterAstCategory;
exports.isBeautyRetailListingFromFields = isBeautyRetailListingFromFields;
exports.inferCategoryCanonical = inferCategoryCanonical;
var db_1 = require("../core/db");
/** Canonical aisle → search terms (aligned with queryProcessor dictionary). */
var CATEGORY_ALIASES = {
    tops: [
        "tops",
        "top",
        "shirts",
        "shirt",
        "blouse",
        "blouses",
        "tshirt",
        "t-shirt",
        "t-shirts",
        "tee",
        "tank top",
        "tank-top",
        "tank-tops",
        "polo",
        "henley",
        "tunic",
        "crop top",
        "camisole",
        "sweater",
        "sweaters",
        "pullover",
        "hoodie",
        "hoodies",
        "sweatshirt",
        "sweatshirts",
        "cardigan",
        "cardigans",
        "knitwear",
        "knit tops",
        "woven tops",
        "woven shirts",
        "shirting",
        "short sleeve",
        "short sleeves",
        "long sleeve",
        "polo shirts",
        "polo short sleeve",
        "track top",
        "baselayer",
        "men pullover",
        "women pullover",
        "overshirt",
        "overshirts",
        "bodysuit",
        "bodysuits",
        "jersey",
        "loungewear",
    ],
    bottoms: [
        "bottoms",
        "bottom",
        "pants",
        "pant",
        "trousers",
        "jeans",
        "jean",
        "chinos",
        "leggings",
        "shorts",
        "short",
        "skirt",
        "skirts",
        "culottes",
        "cargo pants",
        "sweatpants",
        "bermudas",
        "7/8 tight",
        "tight",
        "tights",
        "track trousers",
    ],
    joggers: ["joggers", "jogger", "jogging", "jogging pants", "track pants", "trackpants", "jogging bottoms"],
    dresses: [
        "dresses",
        "dress",
        "midi-dresses",
        "midi-dress",
        "midi dress",
        "maxi-dresses",
        "maxi-dress",
        "maxi dress",
        "mini-dresses",
        "mini-dress",
        "mini dress",
        "gown",
        "gowns",
        "frock",
        "sundress",
        "jumpsuit",
        "jumpsuits",
        "romper",
        "rompers",
        "abaya",
        "abayas",
        "kaftan",
        "kaftans",
        "jalabiya",
        "thobe",
    ],
    outerwear: [
        "outerwear",
        "jacket",
        "jackets",
        "coat",
        "coats",
        "blazer",
        "blazers",
        "sport coat",
        "sport coats",
        "sportcoat",
        "coats & jackets",
        "outerwear & jackets",
        "tuxedo",
        "tuxedos",
        "cardigan",
        "cardigans",
        "parka",
        "parkas",
        "windbreaker",
        "windbreakers",
        "vest",
        "vests",
        "gilet",
        "gilets",
        "waistcoat",
        "waistcoats",
        "bomber",
        "bombers",
        "anorak",
        "anoraks",
        "poncho",
        "ponchos",
        "cape",
        "capes",
        "trench",
        "trenches",
        "overcoat",
        "overcoats",
        "shacket",
        "shackets",
        "shirt jacket",
        "shirt jackets",
        "parkas & blousons",
    ],
    tailored: [
        "tailored",
        "suit",
        "suits",
        "tuxedo",
        "tuxedos",
        "suit jacket",
        "suit jackets",
        "dress jacket",
        "dress jackets",
        "waistcoat",
        "waistcoats",
        "vest",
        "vests",
        "gilet",
        "gilets",
        "structured jacket",
        "structured jackets",
        "tailored jacket",
        "tailored jackets",
    ],
    footwear: [
        "footwear",
        "shoes",
        "shoe",
        "sneakers",
        "sneaker",
        "trainers",
        "trainer",
        "running shoes",
        "running shoe",
        "athletic shoes",
        "athletic shoe",
        "tennis shoes",
        "tennis shoe",
        "boots",
        "boot",
        "ankle boots",
        "ankle boot",
        "chelsea boots",
        "chelsea boot",
        "after ski boot",
        "ski boots",
        "sandals",
        "sandal",
        "heels",
        "heel",
        "pumps",
        "pump",
        "stilettos",
        "stiletto",
        "loafers",
        "loafer",
        "moccasins",
        "moccasin",
        "flats",
        "flat",
        "mules",
        "mule",
        "slides",
        "slide",
        "slippers",
        "slipper",
        "oxfords",
        "oxford",
        "derbies",
        "derby",
        "brogues",
        "brogue",
        "clogs",
        "clog",
        "espadrilles",
        "espadrille",
        "dress shoes",
        "dress shoe",
    ],
    accessories: [
        "accessories",
        "accessory",
        "bag",
        "bags",
        "belt",
        "belts",
        "hat",
        "hats",
        "cap",
        "watch",
        "watches",
        "scarf",
        "scarves",
        "sunglasses",
        "jewelry",
        "bracelet",
        "necklace",
        "earrings",
        "wallet",
        "purse",
        "handbag",
        "tote",
        "backpack",
        "clutch",
        "clutches",
        "pouch",
        "pouches",
    ],
    bags: [
        "bags",
        "bag",
        "handbag",
        "handbags",
        "wallet",
        "wallets",
        "purse",
        "purses",
        "tote",
        "totes",
        "backpack",
        "backpacks",
        "hand bags",
        "shopping bags",
        "shoulder bags",
        "top handle bags",
        "waist bags",
        "duffle bags",
        "travel bags",
        "lunch bags",
        "toiletry bags",
        "laptop cases",
        "phone cases",
        "pen cases",
        "card holders",
        "bags cases and luggage",
        "carry on",
        "large luggages",
        "medium luggages",
        "crossbody",
        "crossbody bags",
        "crossover bags",
        "satchel",
        "satchels",
        "clutch",
        "clutches",
    ],
    activewear: [
        "activewear",
        "sportswear",
        "athletic",
        "gym",
        "workout",
        "running",
        "yoga",
        "training",
        "sports bra",
        "track pants",
        "performance",
    ],
    swimwear: [
        "swimwear",
        "swim",
        "swimming",
        "bikini",
        "swimsuit",
        "swim trunks",
        "one piece",
        "two piece",
        "beach wear",
        "board shorts",
        "swim short",
        "bottom-sw",
        "suit-sw",
        "monokini",
    ],
    underwear: ["underwear", "lingerie", "undergarments", "innerwear", "boxers", "briefs", "bra", "panties", "thong", "undershirt"],
    /** Skincare / color cosmetics — not apparel; blocks spurious high CLIP scores vs dress/shoe queries */
    beauty: [
        "beauty",
        "makeup",
        "cosmetics",
        "cosmetic",
        "concealer",
        "concealers",
        "foundation",
        "lipstick",
        "lipsticks",
        "mascara",
        "eyeliner",
        "eyeshadow",
        "blush",
        "bronzer",
        "primer",
        "highlighter",
        "skincare",
        "serum",
        "moisturizer",
        "cleanser",
        "toner",
        "sunscreen",
        "perfume",
        "fragrance",
        "cologne",
        "nail polish",
        "nail care",
        "nails",
        "bath & body",
        "body care",
        "blushes",
        "cleansers",
        "concealers",
        "eye liners",
        "eye shadows",
        "eyeb rows",
        "eyes",
        "face",
        "face cream",
        "face serum",
        "foundations",
        "gift sets",
        "hair care",
        "lip liners",
        "lips",
        "lipsticks",
        "mascaras",
        "nail care",
        "powders",
        "serums",
        "shampoos",
        "skin care",
        "skin whitening",
        "sun care",
        "eau de parfum",
        "eau de toilette",
    ],
};
/**
 * All search terms for a category (canonical name + aliases).
 */
function getCategorySearchTerms(category) {
    var key = category.toLowerCase();
    if (CATEGORY_ALIASES[key])
        return __spreadArray([], CATEGORY_ALIASES[key], true);
    for (var _i = 0, _a = Object.entries(CATEGORY_ALIASES); _i < _a.length; _i++) {
        var _b = _a[_i], cat = _b[0], aliases = _b[1];
        if (aliases.includes(key))
            return __spreadArray([], CATEGORY_ALIASES[cat], true);
    }
    return [key];
}
var vocabCache = null;
var VOCAB_TTL_MS = 5 * 60 * 1000;
/** Distinct lowercased categories from DB (refresh every 5m). */
function loadCategoryVocabulary() {
    return __awaiter(this, void 0, void 0, function () {
        var r, set, _i, _a, row;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    if (vocabCache && Date.now() - vocabCache.at < VOCAB_TTL_MS) {
                        return [2 /*return*/, vocabCache.set];
                    }
                    return [4 /*yield*/, db_1.pg.query("SELECT DISTINCT LOWER(TRIM(category)) AS c FROM products WHERE category IS NOT NULL AND TRIM(category) <> ''")];
                case 1:
                    r = _b.sent();
                    set = new Set();
                    for (_i = 0, _a = r.rows; _i < _a.length; _i++) {
                        row = _a[_i];
                        if (row.c)
                            set.add(String(row.c));
                    }
                    vocabCache = { at: Date.now(), set: set };
                    return [2 /*return*/, set];
            }
        });
    });
}
/**
 * Terms to use in OpenSearch `terms` filter: prefer labels that exist in the catalog.
 */
function resolveCategoryTermsForOpensearch(canonicalCategory, vocab) {
    var aliases = getCategorySearchTerms(canonicalCategory).map(function (t) { return t.toLowerCase(); });
    var inVocab = aliases.filter(function (a) { return vocab.has(a); });
    return inVocab.length > 0 ? inVocab : aliases;
}
function strictCategoryEnv() {
    var _a;
    var v = String((_a = process.env.SEARCH_STRICT_CATEGORY_DEFAULT) !== null && _a !== void 0 ? _a : "").toLowerCase();
    return v === "1" || v === "true";
}
function filterHardMinAstConfidence() {
    var _a;
    var n = Number((_a = process.env.SEARCH_FILTER_HARD_MIN_CONFIDENCE) !== null && _a !== void 0 ? _a : "0.55");
    return Number.isFinite(n) ? Math.min(0.95, Math.max(0.35, n)) : 0.55;
}
/** True when the query is primarily an aisle / category browse (precision filter). */
function isCategoryDominantQuery(ast, rawQuery) {
    var q = rawQuery.trim().toLowerCase();
    if (!q)
        return false;
    var words = q.split(/\s+/).filter(Boolean);
    if (words.length > 2)
        return false;
    if (ast.entities.brands.length > 0)
        return false;
    if (ast.entities.categories.length === 0)
        return false;
    if (ast.entities.productTypes && ast.entities.productTypes.length > 0)
        return false;
    var primaryCat = ast.entities.categories[0];
    if (!primaryCat)
        return false;
    var aliasSet = new Set(getCategorySearchTerms(primaryCat).map(function (t) { return t.toLowerCase(); }));
    for (var _i = 0, words_1 = words; _i < words_1.length; _i++) {
        var w = words_1[_i];
        if (aliasSet.has(w))
            return true;
    }
    if (words.length === 1 && words[0] === primaryCat.toLowerCase())
        return true;
    return false;
}
/**
 * Short, product-type-focused queries (e.g. "jeans", "hoodie", "white sneakers") where the
 * intent is lexical/type browse. Hybrid search must NOT require CLIP agreement in `must`:
 * image embeddings and text embeddings for "jeans" are poorly aligned for many valid products,
 * which collapses recall vs BM25 + DB category matches.
 */
function isProductTypeDominantQuery(ast, rawQuery) {
    var q = rawQuery.trim().toLowerCase();
    if (!q)
        return false;
    var words = q.split(/\s+/).filter(Boolean);
    if (words.length > 2)
        return false;
    if (ast.entities.brands.length > 0)
        return false;
    var pts = ast.entities.productTypes;
    if (!pts || pts.length === 0)
        return false;
    return true;
}
/**
 * Use hard category filter (AST) when caller did not pin category and either env strict mode
 * or heuristics say the query is category-dominant.
 *
 * When `SEARCH_STRICT_CATEGORY_DEFAULT=1`, any merged AST category becomes a hard filter
 * (unless caller pinned category or a product-type constraint blocks it) — not only
 * category-dominant queries. Prefer leaving the env off unless you want that behavior.
 */
function shouldHardFilterAstCategory(ast, rawQuery, callerCategory, mergedCategory, hasProductTypeConstraint) {
    if (callerCategory || !mergedCategory)
        return false;
    if (hasProductTypeConstraint)
        return false;
    if (strictCategoryEnv())
        return true;
    if (!isCategoryDominantQuery(ast, rawQuery))
        return false;
    return ast.confidence >= filterHardMinAstConfidence();
}
/**
 * Map vendor listing category + title hints to a canonical aisle label for filtering.
 */
/**
 * True when indexed `category` / `category_canonical` indicates beauty (makeup/skincare/fragrance),
 * so ranking can penalize vs garment/footwear image intent even when `product_types` is empty.
 */
function isBeautyRetailListingFromFields(category, categoryCanonical) {
    var cc = categoryCanonical != null ? String(categoryCanonical).toLowerCase().trim() : "";
    if (cc === "beauty")
        return true;
    var beautyAliases = getCategorySearchTerms("beauty").map(function (t) { return t.toLowerCase(); });
    if (cc && beautyAliases.includes(cc))
        return true;
    var cat = category != null ? String(category).toLowerCase().trim() : "";
    if (!cat)
        return false;
    if (beautyAliases.includes(cat))
        return true;
    return /\b(concealer|foundation|lipstick|mascara|cosmetic|makeup|skincare|serum|perfume|fragrance|moisturizer|cleanser|bronzer|blush|eyeshadow|primer|highlighter|eyeliner|sunscreen|nail\s*polish)\b/i.test(cat);
}
function inferCategoryCanonical(rawCategory, title) {
    var cat = rawCategory ? String(rawCategory).toLowerCase().trim() : "";
    for (var _i = 0, _a = Object.entries(CATEGORY_ALIASES); _i < _a.length; _i++) {
        var _b = _a[_i], key = _b[0], aliases = _b[1];
        if (cat === key)
            return key;
        if (cat && aliases.some(function (a) { return a === cat; }))
            return key;
    }
    var norm = (title || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (norm) {
        // Resolve high-signal garment classes first to avoid ambiguous alias collisions
        // like "short jacket" being mapped to bottoms due the token "short".
        if (/\b(vest\s*top|sleeveless\s*top|tank\s*top|camisole|cami)\b/.test(norm)) {
            return "tops";
        }
        if (/\b(suit|suits|tuxedo|tuxedos|suit\s+jacket|suit\s+jackets|dress\s+jacket|dress\s+jackets|waistcoat|waistcoats|vest|vests|gilet|gilets|tailored\s+jacket|tailored\s+jackets|structured\s+jacket|structured\s+jackets)\b/.test(norm)) {
            return "tailored";
        }
        if (/\b(jacket|jackets|coat|coats|blazer|blazers|cardigan|cardigans|parka|parkas|windbreaker|windbreakers|trench|trenches|overcoat|overcoats|bomber|bombers|anorak|anoraks|poncho|ponchos|cape|capes|shacket|shackets|shirt\s+jackets?|overshirt|overshirts)\b/.test(norm)) {
            return "outerwear";
        }
        if (/\b(dress|dresses|gown|frock|maxi dress|mini dress|midi dress|sundress|jumpsuit|romper|abaya|kaftan|jalabiya|thobe)\b/.test(norm)) {
            return "dresses";
        }
        if (/\b(shoes?|sneakers?|boots?|sandals?|heels?|loafers?|flats?|mules?|slides?|slippers?|pumps?|oxfords?|trainers?|derbies|derby|brogues?|clogs?|espadrilles?|stilettos?|moccasins?)\b/.test(norm)) {
            return "footwear";
        }
        if (/\b(shorts|bermuda|bermudas|cargo shorts|denim shorts|jeans|trousers|pants|chinos|leggings|skirt|skirts|culottes|sweatpants)\b/.test(norm)) {
            return "bottoms";
        }
        var hasTopAccessoryPhrase = /\btop(?:\s|-)+(handle|zip|zipper|stitch|stitching|coat|bag|satchel|clutch|pouch|wallet|case|cover|closure)\b/.test(norm);
        if (!hasTopAccessoryPhrase && /\b(top|tops|shirt|shirts|blouse|blouses|tshirt|t-shirt|tee|tank top|polo|henley|tunic|crop top|camisole|sweater|pullover|hoodie|sweatshirt)\b/.test(norm)) {
            return "tops";
        }
        var tokens = new Set(norm.split(/\s+/));
        for (var _c = 0, _d = Object.entries(CATEGORY_ALIASES); _c < _d.length; _c++) {
            var _e = _d[_c], key = _e[0], aliases = _e[1];
            for (var _f = 0, aliases_1 = aliases; _f < aliases_1.length; _f++) {
                var a = aliases_1[_f];
                // Ambiguous single token; do not classify bottoms by "short" alone.
                if (a === "short")
                    continue;
                if (a.length > 2 && tokens.has(a))
                    return key;
                if (a.length > 3 && norm.includes(a))
                    return key;
            }
        }
    }
    return cat || null;
}
