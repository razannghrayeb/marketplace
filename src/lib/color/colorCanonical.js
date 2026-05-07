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
const FASHION_COLOR_ALIASES = {
    offwhite: "off-white",
    "off-white": "off-white",
    "off white": "off-white",
    ivory: "off-white",
    cream: "cream",
    bone: "off-white",
    ecru: "off-white",
    natural: "off-white",
    eggshell: "off-white",
    // Modern fashion off-white / cream variants used by Everlane, Madewell, etc.
    oatmeal: "off-white",
    oat: "off-white",
    vanilla: "cream",
    alabaster: "white",
    parchment: "off-white",
    pearl: "off-white",
    milk: "white",
    snow: "white",
    // Tan / camel / beige
    camel: "camel",
    tan: "tan",
    sand: "beige",
    beige: "beige",
    khaki: "khaki",
    "toasted-coconut": "beige",
    "toasted coconut": "beige",
    beech: "beige",
    fawn: "tan",
    almond: "beige",
    biscuit: "beige",
    wheat: "beige",
    rye: "beige",
    // Brown family
    caramel: "brown",
    cognac: "brown",
    toffee: "brown",
    chestnut: "brown",
    mahogany: "brown",
    walnut: "brown",
    coffee: "brown",
    latte: "brown",
    truffle: "brown",
    nutmeg: "brown",
    cinnamon: "brown",
    terracotta: "brown",
    clay: "brown",
    sienna: "brown",
    // Gray family
    antra: "charcoal",
    anthracite: "charcoal",
    charcoal: "charcoal",
    "dark-gray": "charcoal",
    "dark-grey": "charcoal",
    "dark grey": "charcoal",
    cement: "gray",
    putty: "beige",
    pebble: "gray",
    mushroom: "gray",
    smoke: "gray",
    fog: "gray",
    mist: "gray",
    dove: "gray",
    heather: "gray",
    pewter: "silver",
    gunmetal: "charcoal",
    ash: "gray",
    slate: "charcoal",
    stone: "gray",
    // Black variants
    heatheredblack: "black",
    "heathered-black": "black",
    "heathered black": "black",
    jet: "black",
    onyx: "black",
    ebony: "black",
    raven: "black",
    // Blue family
    indigo: "denim",
    denim: "denim",
    "denim-blue": "denim",
    midnight: "navy",
    sapphire: "navy",
    cobalt: "blue",
    azure: "blue",
    periwinkle: "light-blue",
    cornflower: "light-blue",
    sky: "light-blue",
    "sky-blue": "light-blue",
    sea: "blue",
    ocean: "blue",
    lake: "blue",
    "icy-water": "light-blue",
    "icy water": "light-blue",
    // Green family
    seafoam: "green",
    pine: "green",
    moss: "olive",
    military: "olive",
    hunter: "green",
    pistachio: "green",
    lime: "green",
    chartreuse: "green",
    emerald: "green",
    jade: "green",
    // Yellow / gold family
    saffron: "yellow",
    ochre: "yellow",
    amber: "yellow",
    canary: "yellow",
    butter: "yellow",
    lemon: "yellow",
    honey: "yellow",
    mustard: "yellow",
    golden: "gold",
    // Red / pink family
    ruby: "red",
    crimson: "red",
    scarlet: "red",
    claret: "burgundy",
    oxblood: "burgundy",
    wine: "burgundy",
    maroon: "burgundy",
    raspberry: "pink",
    watermelon: "pink",
    bubblegum: "pink",
    pink: "pink",
    blush: "pink",
    rose: "pink",
    "dusty-pink": "pink",
    "dusty pink": "pink",
    "dusty-rose": "pink",
    "dusty rose": "pink",
    fuchsia: "pink",
    fuschia: "pink",
    fushia: "pink",
    fuhsia: "pink",
    magenta: "pink",
    hotpink: "pink",
    "hot-pink": "pink",
    "hot pink": "pink",
    apricot: "orange",
    peach: "orange",
    coral: "orange",
    salmon: "orange",
    // Purple family
    eggplant: "purple",
    aubergine: "purple",
    orchid: "purple",
    grape: "purple",
    plum: "purple",
    violet: "purple",
    lavender: "purple",
    lilac: "purple",
    mauve: "purple",
};
function canonicalizeFashionColorToken(raw) {
    var _a, _b;
    if (!raw)
        return null;
    const normalized = normalizeToken(String(raw));
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
    const desired = canonicalizeFashionColorToken(desiredRaw);
    const product = canonicalizeFashionColorToken(productRaw);
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
const VERY_LIGHT_NEUTRAL_SET = new Set([
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
const LIGHT_SHADE_GROUPS = [
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
const DARK_SHADE_GROUPS = [
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
    const normalized = normalizeToken(token);
    if (!normalized)
        return null;
    for (const lightGroup of LIGHT_SHADE_GROUPS) {
        if (lightGroup.has(normalized))
            return "light-shade";
    }
    for (const darkGroup of DARK_SHADE_GROUPS) {
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
    const token = normalizeToken(tokenRaw);
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
    const desiredTone = colorTone(desiredRaw);
    const productTone = colorTone(productRaw);
    let score = 0.88;
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
    const key = normalizeToken(raw);
    if (!key)
        return null;
    const alias = {
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
    const noDashKey = key.replace(/-/g, "");
    const baseKey = stripTonePrefix(key);
    const baseNoDashKey = baseKey.replace(/-/g, "");
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
    const desired = (_a = canonicalizeFashionColorToken(desiredRaw)) !== null && _a !== void 0 ? _a : normalizeToken(desiredRaw);
    if (!desired || productColors.length === 0) {
        return { score: 0, matchedColor: null, tier: "none" };
    }
    const prodNorm = productColors
        .map((c) => { var _a; return ({ raw: c, n: (_a = canonicalizeFashionColorToken(String(c))) !== null && _a !== void 0 ? _a : normalizeToken(String(c)) }); })
        .filter((x) => x.n);
    // Tier 1: Exact match
    for (const { raw, n } of prodNorm) {
        if (n === desired) {
            return { score: 1, matchedColor: raw, tier: "exact" };
        }
    }
    let bestSpecial = { score: 0, matchedColor: null };
    for (const { raw, n } of prodNorm) {
        const score = specialColorMatchScore(desired, n);
        if (score != null && score > bestSpecial.score) {
            bestSpecial = { score, matchedColor: raw };
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
    const desiredShade = getShadeGroup(desired);
    let bestShade = {
        score: 0,
        matchedColor: null,
        tier: null,
    };
    if (desiredShade === "light-shade" || desiredShade === "dark-shade") {
        const targetGroup = desiredShade === "light-shade" ? LIGHT_SHADE_GROUPS : DARK_SHADE_GROUPS;
        for (const shadeGroup of targetGroup) {
            if (shadeGroup.has(desired)) {
                // Found the desired color's shade group; check for matches in same group
                for (const { raw, n } of prodNorm) {
                    if (shadeGroup.has(n)) {
                        let score = 0.92; // High score for same shade group
                        const productShade = getShadeGroup(n);
                        // Same exact shade nuance deserves higher score
                        if (desired === n)
                            score = 0.98;
                        // Same base color (e.g., both blues, both reds) gets bonus
                        else if (stripTonePrefix(desired) === stripTonePrefix(n))
                            score += 0.04;
                        if (score > bestShade.score) {
                            bestShade = { score, matchedColor: raw, tier: desiredShade };
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
    let bestFamily = {
        score: 0,
        matchedColor: null,
    };
    for (const { raw, n } of prodNorm) {
        for (const group of exports.COLOR_FAMILY_GROUPS) {
            const g = new Set(group.map(normalizeToken));
            if (g.has(desired) && g.has(n)) {
                const adjusted = toneAdjustedFamilyScore(desired, n);
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
    const db = coarseColorBucket(desired);
    const desiredTone = colorTone(desired);
    let bestBucket = {
        score: 0,
        matchedColor: null,
    };
    for (const { raw, n } of prodNorm) {
        const pb = coarseColorBucket(n);
        if (db && pb && db === pb) {
            let score = 0.58;
            const productTone = colorTone(n);
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
                bestBucket = { score, matchedColor: raw };
            }
        }
    }
    // For light chromatic intents, only allow very-light neutrals as last-resort fallback
    // when there are NO bucket matches at all (strict priority for exact/shade/family/bucket matches first).
    if (desiredTone === "light" && db && db !== "white" && bestBucket.score === 0) {
        for (const { raw, n } of prodNorm) {
            if (VERY_LIGHT_NEUTRAL_SET.has(n)) {
                const neutralFallbackScore = 0.28;
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
    const scores = desired.map((d) => {
        const m = tieredColorMatchScore(d, productColors);
        return m;
    });
    if (mode === "all") {
        const ok = scores.every((s) => s.score > 0);
        const avg = scores.reduce((a, s) => a + s.score, 0) / scores.length;
        const best = (_a = scores.map((s) => s.matchedColor).find(Boolean)) !== null && _a !== void 0 ? _a : null;
        return {
            compliance: ok ? avg : 0,
            bestMatch: best,
            tier: scores.every((s) => s.tier === "exact") ? "exact" : (_c = (_b = scores[0]) === null || _b === void 0 ? void 0 : _b.tier) !== null && _c !== void 0 ? _c : "none",
        };
    }
    const best = scores.reduce((a, b) => (a.score >= b.score ? a : b));
    return {
        compliance: best.score,
        bestMatch: best.matchedColor,
        tier: best.tier,
    };
}
