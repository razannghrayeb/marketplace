"use strict";
/**
 * Fashion canonical color tokens and tiered matching for retrieval/rerank.
 * Kept separate from search.service so indexing and query can share one vocabulary.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.COLOR_FAMILY_GROUPS = exports.FASHION_CANONICAL_COLORS = void 0;
exports.canonicalizeFashionColorToken = canonicalizeFashionColorToken;
exports.coarseColorBucket = coarseColorBucket;
exports.tieredColorMatchScore = tieredColorMatchScore;
exports.tieredColorListCompliance = tieredColorListCompliance;
/** Primary index / filter tokens (lowercase, hyphenated where needed) */
exports.FASHION_CANONICAL_COLORS = [
    "black",
    "white",
    "off-white",
    "cream",
    "ivory",
    "beige",
    "brown",
    "camel",
    "tan",
    "gray",
    "charcoal",
    "silver",
    "navy",
    "blue",
    "light-blue",
    "green",
    "olive",
    "red",
    "burgundy",
    "pink",
    "purple",
    "yellow",
    "orange",
    "gold",
    "teal",
    "multicolor",
];
var FASHION_COLOR_ALIASES = {
    offwhite: "off-white",
    "off-white": "off-white",
    "off white": "off-white",
    ivory: "off-white",
    cream: "cream",
    bone: "off-white",
    ecru: "off-white",
    natural: "off-white",
    eggshell: "off-white",
    camel: "camel",
    tan: "tan",
    sand: "beige",
    beige: "beige",
    khaki: "khaki",
    "toasted-coconut": "beige",
    "toasted coconut": "beige",
    beech: "beige",
    antra: "charcoal",
    anthracite: "charcoal",
    charcoal: "charcoal",
    "dark-gray": "charcoal",
    "dark-grey": "charcoal",
    "dark grey": "charcoal",
    heatheredblack: "black",
    "heathered-black": "black",
    "heathered black": "black",
    indigo: "denim",
    denim: "denim",
};
function canonicalizeFashionColorToken(raw) {
    var _a, _b;
    if (!raw)
        return null;
    var normalized = normalizeToken(String(raw));
    if (!normalized)
        return null;
    return (_b = (_a = FASHION_COLOR_ALIASES[normalized]) !== null && _a !== void 0 ? _a : FASHION_COLOR_ALIASES[normalized.replace(/-/g, "")]) !== null && _b !== void 0 ? _b : normalized;
}
/**
 * Ultra-granular shade groups: organized by specific shade names.
 * Tier structure: exact > light-shade > dark-shade > family > bucket > none
 *
 * Light-shade tiers (pale, soft, light variants):
 * - "light-blue", "sky-blue", "powder-blue", "baby-blue" (for blue family)
 *
 * Dark-shade tiers (deep, dark, rich variants):
 * - "navy", "midnight-blue", "indigo", "sapphire" (for blue family)
 *
 * Families remain broader for fallback matching.
 */
exports.COLOR_FAMILY_GROUPS = [
    // White family: very light neutrals
    ["white", "off-white", "cream", "ivory", "ecru", "eggshell"],
    // Blue family - split into granular shade groups
    ["light-blue", "sky-blue", "powder-blue", "baby-blue", "pale-blue"], // light shades
    ["blue", "cobalt", "royal-blue", "denim", "periwinkle"], // mid shades
    ["navy", "midnight-blue", "indigo", "sapphire", "dark-blue"], // dark shades
    // Gray/Charcoal family
    ["silver", "gray", "grey", "heather-gray", "ash"], // light gray
    ["charcoal", "dark-gray", "dark-grey", "slate", "gunmetal"], // dark gray
    // Red family - split into tones
    ["cherry", "scarlet", "crimson", "bright-red", "tomato"], // bright reds
    ["burgundy", "maroon", "wine", "claret", "oxblood", "garnet"], // deep reds
    // Pink family - split into tones
    ["blush", "dusty-rose", "dusty-pink", "rose", "mauve"], // soft pinks
    ["hot-pink", "fuchsia", "magenta", "fuschia", "bright-pink"], // bright pinks
    ["salmon", "coral", "peachy-pink", "apricot", "terracotta"], // warm pinks
    // Purple family
    ["lavender", "lilac", "periwinkle", "pale-purple", "mauve"], // light purples
    ["purple", "violet", "plum", "orchid", "grape", "aubergine"], // deep purples
    // Green family - split into undertones
    ["mint", "light-green", "sage", "seafoam", "pale-green"], // light/soft greens
    ["green", "forest-green", "hunter-green", "kelly-green", "pine"], // mid greens
    ["olive", "moss", "army-green", "khaki", "sage-green", "darkgreen"], // earthy/dark greens
    ["emerald", "teal-green", "aqua-green"], // jewel-tone greens
    // Brown/Camel family - split into undertones
    ["beige", "tan", "light-brown", "camel", "cream-brown", "sand"], // light browns
    ["brown", "chocolate", "mocha", "coffee", "walnut"], // mid browns
    ["caramel", "cognac", "toffee", "chestnut", "rust", "mahogany"], // warm/rich browns
    ["charcoal-brown", "dark-brown", "espresso", "burnt-umber"], // dark browns
    // Yellow/Gold family
    ["pale-yellow", "cream-yellow", "butter", "light-yellow"], // light yellows
    ["yellow", "golden", "mustard", "lemon", "canary"], // mid/warm yellows
    ["gold", "deep-gold", "bronze", "antique-gold"], // rich/deep golds
    // Orange family
    ["peach", "apricot", "light-orange", "coral", "salmon"], // soft oranges
    ["orange", "bright-orange", "tangerine", "pumpkin"], // mid oranges
    ["rust", "burnt-orange", "terracotta", "copper", "amber"], // deep/warm oranges
    // Teal/Cyan family
    ["aqua", "cyan", "seafoam", "pale-turquoise", "light-teal"], // light teals
    ["teal", "turquoise", "peacock", "sea-green"], // mid teals
    ["dark-teal", "deep-teal"], // dark teals
];
function normalizeToken(s) {
    return s
        .toLowerCase()
        .replace(/[_\s]+/g, "-")
        .replace(/[^a-z0-9-]/g, "")
        .replace(/-+/g, "-")
        .trim();
}
function specialColorMatchScore(desiredRaw, productRaw) {
    var desired = canonicalizeFashionColorToken(desiredRaw);
    var product = canonicalizeFashionColorToken(productRaw);
    if (!desired || !product)
        return null;
    if (desired === "off-white") {
        if (product === "white")
            return 0.95;
        if (["off-white", "cream", "ivory", "bone", "ecru"].includes(product))
            return 1;
        if (["beige", "sand", "tan"].includes(product))
            return 0.72;
        if (["gray", "grey", "silver", "light-gray", "light-grey"].includes(product))
            return 0.55;
        if (["pale-green", "light-green", "mint", "sage"].includes(product))
            return 0.35;
        if (["denim", "denim-blue", "blue", "light-blue"].includes(product))
            return 0.2;
        if (["black", "navy", "charcoal", "dark-gray", "dark-grey"].includes(product))
            return 0.1;
    }
    if (desired === "white" && product === "off-white")
        return 0.95;
    if (desired === "cream" && ["off-white", "ivory", "bone", "ecru"].includes(product))
        return 1;
    return null;
}
var VERY_LIGHT_NEUTRAL_SET = new Set([
    "white",
    "off-white",
    "cream",
    "ivory",
    "ecru",
    "eggshell",
]);
/**
 * Light-shade groups (tier: light-shade).
 * These are pale, soft, light variants of their families.
 */
var LIGHT_SHADE_GROUPS = [
    new Set(["light-blue", "sky-blue", "powder-blue", "baby-blue", "pale-blue"].map(normalizeToken)),
    new Set(["silver", "gray", "grey", "heather-gray", "ash"].map(normalizeToken)),
    new Set(["blush", "dusty-rose", "dusty-pink", "rose", "mauve"].map(normalizeToken)),
    new Set(["lavender", "lilac", "periwinkle", "pale-purple", "mauve"].map(normalizeToken)),
    new Set(["mint", "light-green", "sage", "seafoam", "pale-green"].map(normalizeToken)),
    new Set(["beige", "tan", "light-brown", "camel", "cream-brown", "sand"].map(normalizeToken)),
    new Set(["pale-yellow", "cream-yellow", "butter", "light-yellow"].map(normalizeToken)),
    new Set(["peach", "apricot", "light-orange", "coral", "salmon"].map(normalizeToken)),
    new Set(["aqua", "cyan", "seafoam", "pale-turquoise", "light-teal"].map(normalizeToken)),
];
/**
 * Dark-shade groups (tier: dark-shade).
 * These are deep, dark, rich variants of their families.
 */
var DARK_SHADE_GROUPS = [
    new Set(["navy", "midnight-blue", "indigo", "sapphire", "dark-blue"].map(normalizeToken)),
    new Set(["charcoal", "dark-gray", "dark-grey", "slate", "gunmetal"].map(normalizeToken)),
    new Set(["burgundy", "maroon", "wine", "claret", "oxblood", "garnet"].map(normalizeToken)),
    new Set(["hot-pink", "fuchsia", "magenta", "fuschia", "bright-pink"].map(normalizeToken)),
    new Set(["purple", "violet", "plum", "orchid", "grape", "aubergine"].map(normalizeToken)),
    new Set(["olive", "moss", "army-green", "khaki", "sage-green", "darkgreen"].map(normalizeToken)),
    new Set(["emerald", "teal-green", "aqua-green"].map(normalizeToken)),
    new Set(["caramel", "cognac", "toffee", "chestnut", "rust", "mahogany"].map(normalizeToken)),
    new Set(["charcoal-brown", "dark-brown", "espresso", "burnt-umber"].map(normalizeToken)),
    new Set(["gold", "deep-gold", "bronze", "antique-gold"].map(normalizeToken)),
    new Set(["rust", "burnt-orange", "terracotta", "copper", "amber"].map(normalizeToken)),
    new Set(["dark-teal", "deep-teal"].map(normalizeToken)),
];
/**
 * Shade tier classification: determines if a color falls into light-shade or dark-shade group.
 * Returns: "light-shade" | "dark-shade" | "mid" | null
 */
function getShadeGroup(token) {
    var normalized = normalizeToken(token);
    if (!normalized)
        return null;
    for (var _i = 0, LIGHT_SHADE_GROUPS_1 = LIGHT_SHADE_GROUPS; _i < LIGHT_SHADE_GROUPS_1.length; _i++) {
        var lightGroup = LIGHT_SHADE_GROUPS_1[_i];
        if (lightGroup.has(normalized))
            return "light-shade";
    }
    for (var _a = 0, DARK_SHADE_GROUPS_1 = DARK_SHADE_GROUPS; _a < DARK_SHADE_GROUPS_1.length; _a++) {
        var darkGroup = DARK_SHADE_GROUPS_1[_a];
        if (darkGroup.has(normalized))
            return "dark-shade";
    }
    return "mid";
}
function stripTonePrefix(token) {
    return String(token || "")
        .replace(/^(light|dark|deep|pale|baby|sky|midnight|bright|soft|dusty)-/, "")
        .trim();
}
function colorTone(tokenRaw) {
    var token = normalizeToken(tokenRaw);
    if (!token)
        return "mid";
    if (token.startsWith("light-") ||
        token.startsWith("pale-") ||
        token.startsWith("baby-") ||
        token.startsWith("sky-") ||
        token.startsWith("soft-") ||
        VERY_LIGHT_NEUTRAL_SET.has(token)) {
        return "light";
    }
    if (token.startsWith("dark-") ||
        token.startsWith("deep-") ||
        token.startsWith("midnight-") ||
        token === "navy" ||
        token === "charcoal" ||
        token === "burgundy" ||
        token === "maroon") {
        return "dark";
    }
    return "mid";
}
function toneAdjustedFamilyScore(desiredRaw, productRaw) {
    var desiredTone = colorTone(desiredRaw);
    var productTone = colorTone(productRaw);
    var score = 0.88;
    if (desiredTone === "light") {
        if (productTone === "light")
            score += 0.08;
        else if (productTone === "dark")
            score -= 0.1;
        else
            score -= 0.02;
    }
    else if (desiredTone === "dark") {
        if (productTone === "dark")
            score += 0.06;
        else if (productTone === "light")
            score -= 0.1;
        else
            score -= 0.01;
    }
    return Math.max(0, Math.min(0.98, score));
}
/** Map loose query/index strings to a coarse bucket used only for broad synonym expansion (filters). */
function coarseColorBucket(raw) {
    var _a, _b, _c, _d;
    if (!raw)
        return null;
    var key = normalizeToken(raw);
    if (!key)
        return null;
    var alias = {
        black: "black",
        charcoal: "black",
        white: "white",
        "off-white": "white",
        offwhite: "white",
        cream: "white",
        ivory: "white",
        ecru: "white",
        beige: "brown",
        camel: "brown",
        tan: "brown",
        brown: "brown",
        chocolate: "brown",
        mocha: "brown",
        caramel: "brown",
        cognac: "brown",
        gray: "gray",
        grey: "gray",
        silver: "gray",
        navy: "blue",
        blue: "blue",
        cobalt: "blue",
        denim: "blue",
        "light-blue": "blue",
        "royal-blue": "blue",
        "baby-blue": "blue",
        "sky-blue": "blue",
        "powder-blue": "blue",
        indigo: "blue",
        sapphire: "blue",
        green: "green",
        olive: "green",
        sage: "green",
        mint: "green",
        "forest-green": "green",
        "army-green": "green",
        "hunter-green": "green",
        emerald: "green",
        moss: "green",
        red: "red",
        burgundy: "red",
        wine: "red",
        crimson: "red",
        scarlet: "red",
        maroon: "red",
        pink: "pink",
        blush: "pink",
        rose: "pink",
        fuchsia: "pink",
        fuschia: "pink",
        fushia: "pink",
        fuhsia: "pink",
        magenta: "pink",
        "hot-pink": "pink",
        "dusty-pink": "pink",
        "dusty-rose": "pink",
        salmon: "pink",
        purple: "purple",
        lavender: "purple",
        lilac: "purple",
        mauve: "purple",
        violet: "purple",
        plum: "purple",
        grape: "purple",
        orchid: "purple",
        yellow: "yellow",
        gold: "yellow",
        mustard: "yellow",
        lemon: "yellow",
        canary: "yellow",
        orange: "orange",
        coral: "orange",
        rust: "orange",
        terracotta: "orange",
        peach: "orange",
        "burnt-orange": "orange",
        amber: "orange",
        teal: "teal",
        turquoise: "teal",
        aqua: "teal",
        cyan: "teal",
        peacock: "teal",
        multicolor: "multicolor",
        multicolour: "multicolor",
    };
    var noDashKey = key.replace(/-/g, "");
    var baseKey = stripTonePrefix(key);
    var baseNoDashKey = baseKey.replace(/-/g, "");
    return ((_d = (_c = (_b = (_a = alias[key]) !== null && _a !== void 0 ? _a : alias[noDashKey]) !== null && _b !== void 0 ? _b : alias[baseKey]) !== null && _c !== void 0 ? _c : alias[baseNoDashKey]) !== null && _d !== void 0 ? _d : null);
}
/**
 * Tiered match for rerank: prefer exact > light-shade > dark-shade > family > bucket > none.
 * Scores in [0, 1].
 *
 * Tier definitions:
 * - exact: identical color names
 * - light-shade: same light shade variant group (light-blue, sky-blue, etc.)
 * - dark-shade: same dark shade variant group (navy, midnight-blue, etc.)
 * - family: same color family but different shade
 * - bucket: same coarse color bucket
 * - none: no match
 */
function tieredColorMatchScore(desiredRaw, productColors) {
    var _a;
    var desired = (_a = canonicalizeFashionColorToken(desiredRaw)) !== null && _a !== void 0 ? _a : normalizeToken(desiredRaw);
    if (!desired || productColors.length === 0) {
        return { score: 0, matchedColor: null, tier: "none" };
    }
    var prodNorm = productColors
        .map(function (c) { var _a; return ({ raw: c, n: (_a = canonicalizeFashionColorToken(String(c))) !== null && _a !== void 0 ? _a : normalizeToken(String(c)) }); })
        .filter(function (x) { return x.n; });
    // Tier 1: Exact match
    for (var _i = 0, prodNorm_1 = prodNorm; _i < prodNorm_1.length; _i++) {
        var _b = prodNorm_1[_i], raw = _b.raw, n = _b.n;
        if (n === desired) {
            return { score: 1, matchedColor: raw, tier: "exact" };
        }
    }
    var bestSpecial = { score: 0, matchedColor: null };
    for (var _c = 0, prodNorm_2 = prodNorm; _c < prodNorm_2.length; _c++) {
        var _d = prodNorm_2[_c], raw = _d.raw, n = _d.n;
        var score = specialColorMatchScore(desired, n);
        if (score != null && score > bestSpecial.score) {
            bestSpecial = { score: score, matchedColor: raw };
        }
    }
    if (bestSpecial.matchedColor) {
        return {
            score: bestSpecial.score,
            matchedColor: bestSpecial.matchedColor,
            tier: bestSpecial.score >= 0.9 ? "family" : "bucket",
        };
    }
    // Tier 2 & 3: Shade-specific matches (light-shade or dark-shade)
    var desiredShade = getShadeGroup(desired);
    var bestShade = {
        score: 0,
        matchedColor: null,
        tier: null,
    };
    if (desiredShade === "light-shade" || desiredShade === "dark-shade") {
        var targetGroup = desiredShade === "light-shade" ? LIGHT_SHADE_GROUPS : DARK_SHADE_GROUPS;
        for (var _e = 0, targetGroup_1 = targetGroup; _e < targetGroup_1.length; _e++) {
            var shadeGroup = targetGroup_1[_e];
            if (shadeGroup.has(desired)) {
                // Found the desired color's shade group; check for matches in same group
                for (var _f = 0, prodNorm_3 = prodNorm; _f < prodNorm_3.length; _f++) {
                    var _g = prodNorm_3[_f], raw = _g.raw, n = _g.n;
                    if (shadeGroup.has(n)) {
                        var score = 0.92; // High score for same shade group
                        var productShade = getShadeGroup(n);
                        // Same exact shade nuance deserves higher score
                        if (desired === n)
                            score = 0.98;
                        // Same base color (e.g., both blues, both reds) gets bonus
                        else if (stripTonePrefix(desired) === stripTonePrefix(n))
                            score += 0.04;
                        if (score > bestShade.score) {
                            bestShade = { score: score, matchedColor: raw, tier: desiredShade };
                        }
                    }
                }
                break;
            }
        }
    }
    if (bestShade.matchedColor && bestShade.tier) {
        return { score: bestShade.score, matchedColor: bestShade.matchedColor, tier: bestShade.tier };
    }
    // Tier 4: Family match
    var bestFamily = {
        score: 0,
        matchedColor: null,
    };
    for (var _h = 0, prodNorm_4 = prodNorm; _h < prodNorm_4.length; _h++) {
        var _j = prodNorm_4[_h], raw = _j.raw, n = _j.n;
        for (var _k = 0, COLOR_FAMILY_GROUPS_1 = exports.COLOR_FAMILY_GROUPS; _k < COLOR_FAMILY_GROUPS_1.length; _k++) {
            var group = COLOR_FAMILY_GROUPS_1[_k];
            var g = new Set(group.map(normalizeToken));
            if (g.has(desired) && g.has(n)) {
                var adjusted = toneAdjustedFamilyScore(desired, n);
                if (adjusted > bestFamily.score) {
                    bestFamily = { score: adjusted, matchedColor: raw };
                }
            }
        }
    }
    if (bestFamily.matchedColor) {
        return { score: bestFamily.score, matchedColor: bestFamily.matchedColor, tier: "family" };
    }
    // Tier 5: Bucket match
    var db = coarseColorBucket(desired);
    var desiredTone = colorTone(desired);
    var bestBucket = {
        score: 0,
        matchedColor: null,
    };
    for (var _l = 0, prodNorm_5 = prodNorm; _l < prodNorm_5.length; _l++) {
        var _m = prodNorm_5[_l], raw = _m.raw, n = _m.n;
        var pb = coarseColorBucket(n);
        if (db && pb && db === pb) {
            var score = 0.58;
            var productTone = colorTone(n);
            if (desiredTone === "light") {
                if (productTone === "light")
                    score += 0.04;
                else if (productTone === "dark")
                    score -= 0.08;
            }
            else if (desiredTone === "dark") {
                if (productTone === "dark")
                    score += 0.03;
                else if (productTone === "light")
                    score -= 0.07;
            }
            score = Math.max(0, Math.min(0.7, score));
            if (score > bestBucket.score) {
                bestBucket = { score: score, matchedColor: raw };
            }
        }
    }
    // For light chromatic intents, only allow very-light neutrals as last-resort fallback
    // when there are NO bucket matches at all (strict priority for exact/shade/family/bucket matches first).
    if (desiredTone === "light" && db && db !== "white" && bestBucket.score === 0) {
        for (var _o = 0, prodNorm_6 = prodNorm; _o < prodNorm_6.length; _o++) {
            var _p = prodNorm_6[_o], raw = _p.raw, n = _p.n;
            if (VERY_LIGHT_NEUTRAL_SET.has(n)) {
                var neutralFallbackScore = 0.28;
                if (neutralFallbackScore > bestBucket.score) {
                    bestBucket = { score: neutralFallbackScore, matchedColor: raw };
                }
            }
        }
    }
    if (bestBucket.matchedColor) {
        return { score: bestBucket.score, matchedColor: bestBucket.matchedColor, tier: "bucket" };
    }
    // Tier 6: No match
    return { score: 0, matchedColor: null, tier: "none" };
}
function tieredColorListCompliance(desired, productColors, mode) {
    var _a, _b, _c;
    if (desired.length === 0)
        return { compliance: 1, bestMatch: null, tier: "none" };
    if (productColors.length === 0)
        return { compliance: 0, bestMatch: null, tier: "none" };
    var scores = desired.map(function (d) {
        var m = tieredColorMatchScore(d, productColors);
        return m;
    });
    if (mode === "all") {
        var ok = scores.every(function (s) { return s.score > 0; });
        var avg = scores.reduce(function (a, s) { return a + s.score; }, 0) / scores.length;
        var best_1 = (_a = scores.map(function (s) { return s.matchedColor; }).find(Boolean)) !== null && _a !== void 0 ? _a : null;
        return {
            compliance: ok ? avg : 0,
            bestMatch: best_1,
            tier: scores.every(function (s) { return s.tier === "exact"; }) ? "exact" : (_c = (_b = scores[0]) === null || _b === void 0 ? void 0 : _b.tier) !== null && _c !== void 0 ? _c : "none",
        };
    }
    var best = scores.reduce(function (a, b) { return (a.score >= b.score ? a : b); });
    return {
        compliance: best.score,
        bestMatch: best.matchedColor,
        tier: best.tier,
    };
}
