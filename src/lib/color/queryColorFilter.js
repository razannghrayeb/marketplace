"use strict";
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
exports.COLOR_CANONICAL_ALIASES = void 0;
exports.inferColorGroupFromRaw = inferColorGroupFromRaw;
exports.normalizeColorToken = normalizeColorToken;
exports.normalizeColorTokensFromRaw = normalizeColorTokensFromRaw;
exports.expandColorTermsForFilter = expandColorTermsForFilter;
var colorCanonical_1 = require("./colorCanonical");
/**
 * Query-time color normalization and OpenSearch filter term expansion (shared by text + image search).
 */
exports.COLOR_CANONICAL_ALIASES = {
    black: [
        "black", "jet", "onyx", "heathered black",
        "heathered_black", "core black", "tnf black", "all black", "total black", "blackout",
        "black out", "raven", "ebony", "obsidian", "noir", "nero", "caviar", "ink black",
        "night black", "phantom black", "carbon black", "washed black", "faded black",
        "matte black", "mat black", "black heather", "black denim", "black rinse",
    ],
    white: [
        "white", "off white", "off-white", "offwhite", "ivory", "cream", "bone", "ecru",
        "natural", "sail", "summit white", "cloud white", "wonder white", "cream white",
        "chalk white", "vintage white", "gardenia white", "optic white", "optical white",
        "bright white", "snow white", "tnf white", "egret", "alabaster", "milk white",
        "coconut milk", "vanilla", "flour", "parchment", "paper white", "marshmallow",
        "winter white", "warm white", "broken white", "star white", "sea salt", "seasalt",
        "pearl white", "undyed white", "whitecap", "white cap",
    ],
    gray: [
        "gray", "grey", "heather grey", "heather gray", "silver", "charcoal",
        "dark gray", "dark grey", "wolf grey", "wolf gray",
        "smoke grey", "smoke gray", "light smoke grey", "dark smoke grey", "iron grey",
        "castlerock", "castle grey", "vast grey", "dove grey", "college grey", "halo gray",
        "halo grey", "titan gray", "titan grey", "thunder", "thunderstorm", "raincloud",
        "downpour", "storm", "stormy", "tempest", "cinder", "carbon", "forged iron",
        "magnet", "asphalt", "concrete", "cement", "pebble", "gravel", "pewter",
        "gunmetal", "graphite", "tungsten", "alloy", "aluminium", "aluminum", "platinum",
        "metallic silver", "silver metallic", "lunar silver", "chrome", "steel", "lead",
        "fog", "mist", "cloud grey", "cloud gray", "glacier grey", "glacier gray",
        "galactic grey", "moonstone", "quiet shade", "turbulence", "ironstone", "coal",
    ],
    blue: [
        "blue", "navy", "cobalt", "denim", "sky blue", "mid blue", "midnight blue",
        "royal blue", "royal-blue", "light blue", "light-blue", "powder blue", "baby blue",
        "teal", "turquoise", "indigo", "electric blue", "sapphire", "marine", "azure",
        "lapis", "petrol", "atlantic", "ocean", "cerulean", "cornflower", "periwinkle",
        "celeste", "niagara", "reef", "pool", "lagoon", "clear sky", "blue smoke",
        "smoky blue", "smokey blue", "blue cendre", "blue atlantis", "hero blue",
        "game royal", "bright royal", "hyper royal", "university blue", "estate blue",
        "diffused blue", "dutch blue", "mazarine", "dress blue", "peacoat", "new navy",
        "team navy", "nb navy", "shadow navy", "armoury navy", "armory navy",
        "collegiate navy", "ink", "inkwell", "legend ink", "blue void", "deep sea",
        "deep navy", "deep blue", "thunder blue", "steel blue", "blue slate",
        "slate blue", "blue stone", "bluestone", "dark blue", "navy blue", "chambray",
    ],
    red: [
        "red", "burgundy", "maroon", "wine", "cherry", "crimson", "scarlet", "ruby",
        "racer red", "university red", "pure ruby", "better scarlet", "victory crimson",
        "shadow red", "fire", "flame", "lava", "goji", "tomato", "berry red", "poppy",
        "rosewood", "henna", "paprika", "silt red", "pomegranate", "syrah", "merlot",
        "bordeaux", "bordo", "oxblood", "garnet", "currant", "zinfandel", "sangria",
        "tawny port",
    ],
    green: [
        "green", "olive", "khaki", "sage", "mint", "forest green", "forest-green",
        "hunter green", "army green", "emerald", "lime", "moss", "kaki", "military",
        "pine", "fir", "evergreen", "laurel", "thyme", "oregano", "eucalyptus",
        "bay leaf", "artichoke", "fennel", "celery", "pistachio", "matcha", "avocado",
        "cactus", "fern", "algae", "algal", "seagrass", "jade", "malachite",
        "lily pad", "lilypad", "waterlily", "bicoastal", "serpentine", "conifer",
        "cypress", "juniper", "balsam", "loden", "duffel", "duffle", "kalamata",
        "tapenade", "taiga", "field green", "terrain", "garden green", "leaf green",
        "bamboo", "apple green", "neon green", "cyber green", "hyper green",
        "green strike", "chlorophyll", "oil green", "dark olive", "olive drab",
        "olive strata", "cargo khaki", "trench coat khaki",
    ],
    beige: [
        "beige", "taupe", "stone", "sand", "light khaki", "toasted coconut", "beech",
        "greige", "mushroom", "porcini", "shiitake", "shitake", "cardboard", "natural",
        "canvas", "linen", "oatmeal", "oat", "wheat", "straw", "raffia", "rattan",
        "sandstone", "warm sand", "sanddrift", "dune", "desert", "parsnip", "cornstalk",
        "putty", "biscotti", "biscuit", "eggnog", "almond", "sesame", "flax",
    ],
    camel: [
        "camel", "tan", "camel brown", "light brown", "warm beige", "light camel",
        "dark camel", "british tan", "light british tan", "tawny", "toasted tan",
    ],
    brown: [
        "brown", "mocha", "chocolate", "coffee", "caramel", "cognac", "rust brown",
        "espresso", "moka", "mocca", "cocoa", "cappuccino", "latte", "toffee",
        "butterscotch", "honey", "golden brown", "chestnut", "walnut", "hazel",
        "hazelnut", "mahogany", "tobacco", "cinnamon", "ginger", "maple", "oak",
        "wood", "cedar", "bark", "acorn", "fawn", "truffle", "umber", "earth brown",
        "saddle brown", "carob", "pecan", "praline", "sepia", "cork",
    ],
    purple: [
        "purple", "violet", "plum", "lavender", "lilac", "mauve", "grape", "orchid",
        "iris", "amethyst", "wisteria", "eggplant", "aubergine", "ube", "raisin",
        "mulberry", "hyacinth", "grapeberry",
    ],
    pink: [
        "pink", "blush", "fuchsia", "fuschia", "fushia", "fuhsia", "magenta",
        "rose", "hot pink", "dusty pink", "dusty rose", "salmon", "coral pink",
        "guava", "hibiscus", "strawberry", "raspberry", "bubblegum", "taffy",
        "peony", "carnation", "flamingo", "aster", "baby pink", "pale pink",
        "light pink", "clear pink", "bliss pink", "glow pink", "elemental pink",
        "vivid pink", "neon pink", "rose gold", "nude", "skin", "bridal rose",
    ],
    yellow: [
        "yellow", "mustard", "golden", "gold", "lemon", "canary", "butter", "banana",
        "corn", "sunflower", "dandelion", "turmeric", "ochre", "citrine", "champagne",
        "honey gold", "lucid lemon", "solar yellow", "volt", "barely volt", "limelight",
    ],
    orange: [
        "orange", "rust", "peach", "coral", "burnt orange", "terracotta", "terra cotta",
        "amber", "tangerine", "papaya", "mango", "pumpkin", "kumquat", "marmalade",
        "mandarin", "clementine", "apricot", "copper", "ember", "sunrise", "sunset",
        "afterglow", "carrot", "tomato orange",
    ],
    teal: [
        "teal", "turquoise", "aqua", "cyan", "peacock", "acqua", "aquaverde",
        "aquamarine", "seafoam", "sea foam", "water green", "watergreen", "sea green",
        "tidal teal", "legacy teal", "preloved teal", "real teal", "deep turquoise",
    ],
    multicolor: [
        "multicolor", "multi color", "multi-color", "multicolour", "colour block",
        "color block", "printed", "pattern", "multi", "mix", "mixed", "assorted",
        "rainbow", "print", "camo", "camouflage", "leopard", "zebra", "tie dye",
        "tie-dye", "plaid", "gingham", "stripe", "herringbone", "floral", "hearts",
        "confetti", "ombre", "gradient", "marble", "aop", "allover", "check", "dots",
    ],
};
var COLOR_COMMON_MISSPELLINGS = {
    fuschia: "fuchsia",
    fushia: "fuchsia",
    fuhsia: "fuchsia",
    fichia: "fuchsia",
    fucsia: "fuchsia",
    fluxia: "fuchsia",
    magentaa: "magenta",
    biege: "beige",
    begie: "beige",
    bordeuax: "bordeaux",
    bordeax: "bordeaux",
    burgendy: "burgundy",
    antracite: "anthracite",
    antrasite: "anthracite",
    antrasit: "anthracite",
    anthracide: "anthracite",
    antractic: "anthracite",
    antra: "anthracite",
    whie: "white",
    whote: "white",
    whhite: "white",
    blk: "black",
    blak: "black",
    balck: "black",
    siliver: "silver",
    sliver: "silver",
    metalic: "metallic",
    caml: "camel",
    tumeric: "turmeric",
    drk: "dark",
    dk: "dark",
    lt: "light",
    offwhite: "off white",
    wht: "white",
    nvy: "navy",
};
var NON_COLOR_VALUE_RE = /^(?:null|none|n\/a|na|no photos?|standard|all hair type|kids?|short|long|regular|tall|one|m|s|xs|xl|2xl|3xl|4xl|5xl|l|\d+(?:\.\d+)?(?:\s?["”]|(?:\s?in(?:seam)?)|\s?eu|\s?ml)?|\d+[a-z]\d+.*)$/i;
var COLOR_NOISE_WORDS = new Set([
    "product", "code", "shade", "universal", "medium", "deep", "light", "dark",
    "mini", "full", "size", "mascara", "hydrator", "spf", "edition", "wash", "washed",
    "garment", "dyed", "heathered", "heather", "chine", "melange", "metallic", "suede",
    "plaid", "gingham", "stripe", "striped", "jacquard", "print", "printed", "allover",
    "twist", "grid", "block", "combo", "fun", "product", "code",
]);
for (var _i = 0, _a = [
    "mirror", "lens", "lenses", "frame", "strap", "with", "style", "item", "wordmark",
    "composition", "abstract", "heritage", "vintage", "classic", "team", "logo",
    "logos", "label", "model", "collaboration", "supplier", "colour", "color",
]; _i < _a.length; _i++) {
    var word = _a[_i];
    COLOR_NOISE_WORDS.add(word);
}
var EXTRA_NON_COLOR_VALUE_RE = /^(?:adult|youth|men|women|boys?|girls?|slim|straight|athletic|bikini|force|birthday|congratulation|usa|no pocket|one(?:\s+size(?:\s+for\s+(?:kids?|men|women|youth|adult))?)?|colors?\s+can\s+be\s+customi[sz]ed|supplier\s+colou?r|[ml]\/?[xl]|xs\/s|s\/m|m\/l|l\/xl|xl\/2xl|2xs\/xs|xl\/rg|l\/rg|m\/rg|xxxs|ns|w\d+\s*[-/]\s*l\d+|\d+w\s*[-/]\s*\d+l|\d+(?:\.\d+)?\s*(?:cm|w\s*cm|oz|ml|eu|eeu|l)|\d+\s+\d\/\d\s*eu|\d{2,3}\s*[a-z]{1,2}|[0-9]{2,3}[a-z]?)$/i;
function normalizeRawColorString(raw) {
    return String(raw !== null && raw !== void 0 ? raw : "")
        .toLowerCase()
        .replace(/&amp;?/g, " ")
        .replace(/[Â‎]/g, " ")
        .replace(/[“”]/g, '"')
        .replace(/[’]/g, "'")
        .replace(/\bmetalic\b/g, "metallic")
        .replace(/\bsiliver\b|\bsliver\b/g, "silver")
        .replace(/\bwhie\b|\bwhote\b|\bwhhite\b/g, "white")
        .replace(/\bblak\b|\bbalck\b/g, "black")
        .replace(/\bbegie\b|\bbiege\b/g, "beige")
        .replace(/\bfushia\b|\bfuschia\b|\bfichia\b|\bfucsia\b|\bfluxia\b/g, "fuchsia")
        .replace(/\banthracide\b|\bantracite\b|\bantrasit(?:e)?\b|\bantractic\b/g, "anthracite")
        .replace(/\bbordeax\b|\bbordeuax\b|\bburgendy\b/g, "bordeaux")
        .replace(/\bd[.\s-]*(blue|grey|gray|green|brown|beige|purple|navy)\b/g, "dark $1")
        .replace(/\bl[.\s-]*(blue|grey|gray|green|brown|beige|purple|navy)\b/g, "light $1")
        .replace(/\blt[.\s-]*(blue|grey|gray|green|brown|beige|purple|navy|pink|mint|lilac)\b/g, "light $1")
        .replace(/\bdrk[.\s-]*(blue|grey|gray|green|brown|beige|purple|navy)\b/g, "dark $1")
        .replace(/[_-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function isNonColorValue(raw) {
    var value = normalizeRawColorString(raw);
    return !value || NON_COLOR_VALUE_RE.test(value) || EXTRA_NON_COLOR_VALUE_RE.test(value);
}
var COLOR_ALIAS_TO_CANONICAL = (function () {
    var map = new Map();
    for (var _i = 0, _a = Object.entries(exports.COLOR_CANONICAL_ALIASES); _i < _a.length; _i++) {
        var _b = _a[_i], canonical = _b[0], aliases = _b[1];
        map.set(canonical, canonical);
        for (var _c = 0, aliases_1 = aliases; _c < aliases_1.length; _c++) {
            var alias = aliases_1[_c];
            map.set(alias.toLowerCase(), canonical);
        }
    }
    return map;
})();
var COLOR_BUCKET_TO_CANONICAL = {
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
var GROUP_KEYWORD_HINTS = {
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
function inferBucketFromKeywordHints(raw) {
    var s = normalizeRawColorString(raw);
    if (!s)
        return null;
    var best = null;
    var bestScore = 0;
    for (var _i = 0, _a = Object.entries(GROUP_KEYWORD_HINTS); _i < _a.length; _i++) {
        var _b = _a[_i], bucket = _b[0], words = _b[1];
        var score = 0;
        for (var _c = 0, words_1 = words; _c < words_1.length; _c++) {
            var w = words_1[_c];
            if (!w)
                continue;
            if (s === w)
                score += 4;
            else if (new RegExp("\\b".concat(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "\\b")).test(s))
                score += 2;
            else if (s.includes(w))
                score += 1;
        }
        if (score > bestScore) {
            bestScore = score;
            best = bucket;
        }
    }
    return bestScore > 0 ? best : null;
}
var COLOR_FAMILY_CLUSTERS = colorCanonical_1.COLOR_FAMILY_GROUPS.map(function (group) {
    var _a, _b;
    var normalizedMembers = group
        .map(function (v) { return String(v !== null && v !== void 0 ? v : "").toLowerCase().replace(/[_-]/g, " ").trim(); })
        .filter(Boolean);
    var representative = (_b = (_a = normalizeColorFamilyRepresentative(normalizedMembers)) !== null && _a !== void 0 ? _a : normalizedMembers[0]) !== null && _b !== void 0 ? _b : "multicolor";
    return { normalizedMembers: normalizedMembers, representative: representative };
});
function normalizeColorFamilyRepresentative(members) {
    for (var _i = 0, members_1 = members; _i < members_1.length; _i++) {
        var m = members_1[_i];
        var canonical = COLOR_ALIAS_TO_CANONICAL.get(m);
        if (canonical)
            return canonical;
    }
    return null;
}
function inferColorFromFamilyCluster(raw) {
    var key = normalizeRawColorString(raw)
        .replace(/["“”'`]/g, " ")
        .replace(/[()]/g, " ")
        .replace(/[_-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (!key)
        return null;
    var bestColor = null;
    var bestScore = 0;
    for (var _i = 0, COLOR_FAMILY_CLUSTERS_1 = COLOR_FAMILY_CLUSTERS; _i < COLOR_FAMILY_CLUSTERS_1.length; _i++) {
        var cluster = COLOR_FAMILY_CLUSTERS_1[_i];
        var score = 0;
        for (var _a = 0, _b = cluster.normalizedMembers; _a < _b.length; _a++) {
            var member = _b[_a];
            if (!member)
                continue;
            if (key === member)
                score += 4;
            else if (key.includes(member))
                score += 2;
            else {
                var words = member.split(" ").filter(Boolean);
                for (var _c = 0, words_2 = words; _c < words_2.length; _c++) {
                    var w = words_2[_c];
                    if (w.length < 3)
                        continue;
                    if (new RegExp("\\b".concat(w, "\\b")).test(key))
                        score += 1;
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
function inferColorGroupFromRaw(raw) {
    var _a, _b;
    if (!raw)
        return "unknown";
    var source = normalizeRawColorString(raw)
        .replace(/["“”'`]/g, " ")
        .replace(/[()]/g, " ")
        .replace(/[_-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (!source || isNonColorValue(source))
        return "unknown";
    var candidates = [];
    var addCandidate = function (token) {
        var _a, _b;
        var c = String(token !== null && token !== void 0 ? token : "").trim();
        if (!c)
            return;
        candidates.push(c);
        var normalized = (_b = (_a = normalizeColorToken(c)) !== null && _a !== void 0 ? _a : inferColorFromFamilyCluster(c)) !== null && _b !== void 0 ? _b : c;
        var bucket = (0, colorCanonical_1.coarseColorBucket)(normalized);
        if (bucket)
            candidates.push(bucket);
    };
    addCandidate(source);
    var parts = source
        .replace(/\band\b/g, ",")
        .replace(/\\/g, "/")
        .split(/[\/,&+|,-]/g)
        .map(function (s) { return s.trim(); })
        .filter(Boolean);
    for (var _i = 0, parts_1 = parts; _i < parts_1.length; _i++) {
        var p = parts_1[_i];
        if (isNonColorValue(p))
            continue;
        if (/^\d+([.\s]\d+)?$/.test(p))
            continue;
        addCandidate(p);
        var words = p.split(/\s+/g).filter(Boolean);
        for (var i = 0; i < words.length; i++) {
            var w = words[i];
            if (/^(?:[a-z]{1,4}\d+|\d+[a-z]{1,4})$/i.test(w))
                continue;
            if (COLOR_NOISE_WORDS.has(w))
                continue;
            addCandidate(w);
            if (i < words.length - 1)
                addCandidate("".concat(w, " ").concat(words[i + 1]));
        }
    }
    var votes = new Map();
    for (var _c = 0, candidates_1 = candidates; _c < candidates_1.length; _c++) {
        var token = candidates_1[_c];
        var bucket = (0, colorCanonical_1.coarseColorBucket)(token);
        if (!bucket)
            continue;
        votes.set(bucket, ((_a = votes.get(bucket)) !== null && _a !== void 0 ? _a : 0) + 1);
    }
    if (votes.size === 0) {
        var hinted = inferBucketFromKeywordHints(source);
        return (_b = hinted) !== null && _b !== void 0 ? _b : "unknown";
    }
    var winner = "unknown";
    var maxVotes = -1;
    for (var _d = 0, _e = votes.entries(); _d < _e.length; _d++) {
        var _f = _e[_d], bucket = _f[0], count = _f[1];
        if (count > maxVotes) {
            maxVotes = count;
            winner = bucket;
        }
    }
    if (winner === "unknown") {
        var hinted = inferBucketFromKeywordHints(source);
        if (hinted)
            return hinted;
    }
    return winner;
}
function normalizeColorToken(raw) {
    var _a;
    if (!raw)
        return null;
    var keyBase = normalizeRawColorString(raw)
        .replace(/["“”'`]/g, " ")
        .replace(/[()]/g, " ")
        .replace(/[_-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (!keyBase || isNonColorValue(keyBase))
        return null;
    var key = (_a = COLOR_COMMON_MISSPELLINGS[keyBase]) !== null && _a !== void 0 ? _a : keyBase;
    var direct = COLOR_ALIAS_TO_CANONICAL.get(key);
    if (direct)
        return direct;
    // Phrase fallback for compound merchant values like "mid wash denim".
    // Prefer explicit color words first, then infer denim family as blue.
    var hasWord = function (w) { return new RegExp("\\b".concat(w, "\\b")).test(key); };
    if (key.includes("denim")) {
        if (hasWord("black"))
            return "black";
        if (hasWord("white") || key.includes("off white") || key.includes("off-white"))
            return "white";
        if (hasWord("gray") || hasWord("grey") || hasWord("charcoal"))
            return "gray";
        return "blue";
    }
    // Generic fallback: if a known alias appears as a whole word/phrase inside
    // the value, resolve to that canonical color.
    for (var _i = 0, _b = COLOR_ALIAS_TO_CANONICAL.entries(); _i < _b.length; _i++) {
        var _c = _b[_i], alias = _c[0], canonical = _c[1];
        if (new RegExp("\\b".concat(alias.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&"), "\\b")).test(key)) {
            return canonical;
        }
    }
    // Family-cluster fallback for noisy merchant strings.
    var clustered = inferColorFromFamilyCluster(key);
    if (clustered)
        return clustered;
    return null;
}
/**
 * Parse noisy DB color strings into canonical color tokens.
 * Handles formats like "WHITE / NAVY BLUE", "Black Plaid", "CN 58 - Honey", etc.
 */
function normalizeColorTokensFromRaw(raw) {
    if (!raw)
        return [];
    var source = normalizeRawColorString(raw);
    if (!source || isNonColorValue(source))
        return [];
    var out = [];
    var add = function (token) {
        var _a;
        var norm = (_a = normalizeColorToken(token)) !== null && _a !== void 0 ? _a : inferColorFromFamilyCluster(token);
        if (norm && !out.includes(norm))
            out.push(norm);
    };
    // 1) Whole-phrase attempt first for values like "mid wash denim".
    add(source);
    // 2) Split composite merchant formats.
    var parts = source
        .replace(/\band\b/g, ",")
        .replace(/\\/g, "/")
        .split(/[\/,&+|,-]/g)
        .map(function (s) { return s.trim(); })
        .filter(Boolean);
    for (var _i = 0, parts_2 = parts; _i < parts_2.length; _i++) {
        var p = parts_2[_i];
        if (isNonColorValue(p))
            continue;
        if (/^\d+([.\s]\d+)?$/.test(p))
            continue;
        add(p);
        // 3) Token-level fallback for noisy chunks ("khaki green", "grey chine", "flashy yellow").
        var words = p.split(/\s+/g).filter(Boolean);
        for (var i = 0; i < words.length; i++) {
            var w = words[i];
            if (/^(?:[a-z]{1,4}\d+|\d+[a-z]{1,4})$/i.test(w))
                continue;
            if (COLOR_NOISE_WORDS.has(w))
                continue;
            add(w);
            if (i < words.length - 1)
                add("".concat(w, " ").concat(words[i + 1]));
        }
    }
    if (out.length === 0) {
        var group = inferColorGroupFromRaw(source);
        var canonical = COLOR_BUCKET_TO_CANONICAL[group];
        if (canonical)
            out.push(canonical);
    }
    return out;
}
function expandColorTermsForFilter(color) {
    var _a, _b;
    var canonical = (_a = normalizeColorToken(color)) !== null && _a !== void 0 ? _a : color.toLowerCase();
    var aliases = (_b = exports.COLOR_CANONICAL_ALIASES[canonical]) !== null && _b !== void 0 ? _b : [canonical];
    var out = new Set(__spreadArray([canonical], aliases.map(function (a) { return a.toLowerCase(); }), true));
    return __spreadArray([], out, true);
}
