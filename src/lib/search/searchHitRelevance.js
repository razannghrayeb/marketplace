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
exports.scoreCategoryRelevance01 = scoreCategoryRelevance01;
exports.computeFinalRelevance01 = computeFinalRelevance01;
exports.normalizeQueryGender = normalizeQueryGender;
exports.scoreAudienceCompliance = scoreAudienceCompliance;
exports.scoreTitleLexicalOverlap01 = scoreTitleLexicalOverlap01;
exports.computeHitRelevance = computeHitRelevance;
/**
 * Per-hit compliance + final relevance (shared by text search and image kNN search).
 */
var categoryFilter_1 = require("./categoryFilter");
var productTypeTaxonomy_1 = require("./productTypeTaxonomy");
var categoryFilter_2 = require("./categoryFilter");
var attributeExtractor_1 = require("./attributeExtractor");
var colorCanonical_1 = require("../color/colorCanonical");
var queryColorFilter_1 = require("../color/queryColorFilter");
/** Visual / hybrid similarity should dominate tie-breaks when type/color intent is absent. */
function rerankSimilarityWeight() {
    var n = Number(process.env.SEARCH_RERANK_SIM_WEIGHT);
    return Number.isFinite(n) ? Math.min(120, Math.max(10, n)) : 72;
}
function rerankAudienceWeight() {
    var n = Number(process.env.SEARCH_RERANK_AUD_WEIGHT);
    return Number.isFinite(n) ? Math.min(50, Math.max(8, n)) : 24;
}
function isTopIntentToken(value) {
    return /\b(top|tops|shirt|shirts|blouse|blouses|tee|t-?shirt|tshirt|tank|cami|camisole|sweater|sweaters|hoodie|hoodies|sweatshirt|sweatshirts|cardigan|cardigans|polo|polos)\b/.test(String(value !== null && value !== void 0 ? value : "").toLowerCase());
}
function isBottomIntentToken(value) {
    return /\b(bottom|bottoms|pant|pants|trouser|trousers|jean|jeans|denim|shorts|bermudas?|skirt|skirts|legging|leggings|jogger|joggers|slack|slacks|chino|chinos|cargo|cargos)\b/.test(String(value !== null && value !== void 0 ? value : "").toLowerCase());
}
function topBottomCategoryConsistencyMultiplier(params) {
    var _a, _b;
    var detectionBlob = __spreadArray([
        params.mergedCategory
    ], ((_a = params.astCategories) !== null && _a !== void 0 ? _a : []), true).join(" ");
    var productBlob = __spreadArray([
        params.docCategory,
        params.docCanonical
    ], ((_b = params.docProductTypes) !== null && _b !== void 0 ? _b : []), true).join(" ");
    if (isTopIntentToken(detectionBlob) && isBottomIntentToken(productBlob))
        return 0.2;
    if (isBottomIntentToken(detectionBlob) && isTopIntentToken(productBlob))
        return 0.2;
    return 1;
}
/** 0..1: query category hints vs document `category` / `category_canonical` (alias-aware). */
function scoreCategoryRelevance01(mergedCategory, astCategories, docCategory, docCanonical) {
    var hints = [];
    if (mergedCategory)
        hints.push(String(mergedCategory).toLowerCase().trim());
    for (var _i = 0, _a = astCategories || []; _i < _a.length; _i++) {
        var c = _a[_i];
        var x = String(c).toLowerCase().trim();
        if (x && !hints.includes(x))
            hints.push(x);
    }
    if (hints.length === 0)
        return 0;
    var dc = docCategory != null ? String(docCategory).toLowerCase().trim() : "";
    var dcc = docCanonical != null ? String(docCanonical).toLowerCase().trim() : "";
    if (!dc && !dcc)
        return 0;
    var best = 0;
    for (var _b = 0, hints_1 = hints; _b < hints_1.length; _b++) {
        var h = hints_1[_b];
        if (!h)
            continue;
        var aliases = new Set((0, categoryFilter_1.getCategorySearchTerms)(h).map(function (t) { return t.toLowerCase(); }));
        aliases.add(h);
        if (aliases.has(dc) || aliases.has(dcc)) {
            best = 1;
            break;
        }
        for (var _c = 0, aliases_1 = aliases; _c < aliases_1.length; _c++) {
            var a = aliases_1[_c];
            if (!a)
                continue;
            if ((dc && (dc === a || dc.includes(a) || a.includes(dc))) ||
                (dcc && (dcc === a || dcc.includes(a) || a.includes(dcc)))) {
                best = Math.max(best, 0.55);
            }
        }
    }
    return Math.max(0, Math.min(1, best));
}
/**
 * Calibrated 0..1 relevance for acceptance gating (text: SEARCH_FINAL_ACCEPT_MIN_TEXT;
 * image: SEARCH_FINAL_ACCEPT_MIN_IMAGE — see config.search).
 * Type intent + cross-family taxonomy penalties gate hard; text similarity and category
 * boost score compliant hits. Cross-family soft factor applies below the hard block threshold.
 */
function computeFinalRelevance01(params) {
    var _a;
    var crossPen = Math.max(0, params.crossFamilyPenalty);
    var intraPen = Math.max(0, (_a = params.intraFamilyPenalty) !== null && _a !== void 0 ? _a : 0);
    // Hard block for cross-family mismatch (e.g. footwear query returning dresses).
    // For image search (tightSemanticCap), type intent comes from YOLO which can be
    // wrong — don't hard-zero, just heavily penalize so visual similarity can still
    // rescue genuinely similar products.
    var gateTypeIntent = params.hasTypeIntent && params.hasReliableTypeIntent !== false;
    if (gateTypeIntent && crossPen >= 0.8) {
        if (params.tightSemanticCap) {
            return Math.max(0, params.semScore * 0.15);
        }
        return 0;
    }
    // For image search (tightSemanticCap), type intent often comes from noisy YOLO
    // predictions. Use softer gates so a wrong category prediction doesn't nuke all
    // visually similar results. For text search, keep the strict gates since the user
    // explicitly typed the product type.
    var typeGateFactor = !gateTypeIntent
        ? 1
        : params.typeScore >= 0.5
            ? 1
            : params.typeScore >= 0.2
                ? (params.tightSemanticCap ? 0.75 : 0.3)
                : (params.tightSemanticCap ? 0.55 : 0.05);
    var categoryBoost = 1 + params.catScore * 0.25;
    var applyLex = params.applyLexicalToGlobal !== false;
    var globalScore = applyLex
        ? params.semScore * 0.6 + params.lexScore * 0.4
        : params.semScore;
    var colorPart = params.hasColorIntent ? params.colorScore : 1;
    var audPart = params.hasAudienceIntent ? params.audScore : 1;
    var stylePart = params.hasStyleIntent ? params.styleScore : 1;
    var patternPart = params.hasPatternIntent && typeof params.patternScore === 'number' ? params.patternScore : 1;
    var sleevePart = params.hasSleeveIntent ? params.sleeveScore : 1;
    // Attribute blend: keep color dominant, but allow style and pattern to influence as well.
    var attrScore = colorPart * 0.4 + stylePart * 0.15 + patternPart * 0.15 + sleevePart * 0.15 + audPart * 0.15;
    var attrFactor = 0.5 + attrScore * 0.5;
    var crossFamilySoftFactor = params.hasReliableTypeIntent === false
        ? Math.max(0.72, 1 - crossPen * 0.25)
        : Math.max(0, 1 - crossPen * 0.6);
    var intraFamilySoftFactor = params.hasTypeIntent
        ? params.tightSemanticCap
            ? Math.max(0.25, 1 - intraPen * 0.95)
            : Math.max(0.4, 1 - intraPen * 0.7)
        : 1;
    var raw = globalScore * typeGateFactor * categoryBoost * attrFactor * crossFamilySoftFactor * intraFamilySoftFactor;
    var bounded = Math.max(0, Math.min(1, raw));
    // Prevent final relevance from being unrealistically higher than visual/semantic evidence.
    // With tightSemanticCap (image search), allow a wider bonus so that products with
    // strong attribute/type compliance can surface above pure visual similarity.
    // Previous 0.035/0.07 caps were too restrictive and collapsed all image search
    // results into a narrow band near raw cosine, making the relevance layer useless.
    var hasIntent = params.hasTypeIntent || params.hasColorIntent || params.hasStyleIntent || params.hasAudienceIntent;
    var capBonus = params.tightSemanticCap
        ? hasIntent
            ? 0.25
            : 0.32
        : hasIntent
            ? 0.12
            : 0.2;
    var softCap = Math.min(1, params.semScore + capBonus);
    return Math.min(bounded, softCap);
}
function normalizeQueryGender(g) {
    if (!g)
        return null;
    var x = g.toLowerCase().trim();
    if (["men", "man", "male", "mens", "men's", "boy", "boys", "boys-kids", "boys_kids"].includes(x)) {
        return "men";
    }
    if (["women", "woman", "female", "womens", "women's", "girl", "girls", "girls-kids", "girls_kids", "lady", "ladies"].includes(x)) {
        return "women";
    }
    if (x === "unisex")
        return "unisex";
    return null;
}
function docAgeGroup(hit) {
    var _a;
    var raw = (_a = hit === null || hit === void 0 ? void 0 : hit._source) === null || _a === void 0 ? void 0 : _a.age_group;
    if (raw === undefined || raw === null)
        return null;
    return String(raw).toLowerCase().trim() || null;
}
function docAudienceGender(hit) {
    var _a, _b, _c, _d, _e;
    var raw = (_d = (_b = (_a = hit === null || hit === void 0 ? void 0 : hit._source) === null || _a === void 0 ? void 0 : _a.audience_gender) !== null && _b !== void 0 ? _b : (_c = hit === null || hit === void 0 ? void 0 : hit._source) === null || _c === void 0 ? void 0 : _c.attr_gender) !== null && _d !== void 0 ? _d : (_e = hit === null || hit === void 0 ? void 0 : hit._source) === null || _e === void 0 ? void 0 : _e.gender;
    if (raw === undefined || raw === null)
        return null;
    return normalizeQueryGender(String(raw));
}
/**
 * 0..1: query age_group / audience_gender vs indexed audience fields.
 */
function scoreAudienceCompliance(queryAgeGroup, queryGender, hit) {
    var _a, _b, _c, _d;
    var wantAge = queryAgeGroup === null || queryAgeGroup === void 0 ? void 0 : queryAgeGroup.toLowerCase().trim();
    var wantG = normalizeQueryGender(queryGender);
    var docAge = docAgeGroup(hit);
    var docG = docAudienceGender(hit);
    var title = typeof ((_a = hit === null || hit === void 0 ? void 0 : hit._source) === null || _a === void 0 ? void 0 : _a.title) === "string" ? hit._source.title.toLowerCase() : "";
    var category = typeof ((_b = hit === null || hit === void 0 ? void 0 : hit._source) === null || _b === void 0 ? void 0 : _b.category) === "string" ? hit._source.category.toLowerCase() : "";
    var canonical = typeof ((_c = hit === null || hit === void 0 ? void 0 : hit._source) === null || _c === void 0 ? void 0 : _c.category_canonical) === "string"
        ? hit._source.category_canonical.toLowerCase()
        : "";
    var productTypes = Array.isArray((_d = hit === null || hit === void 0 ? void 0 : hit._source) === null || _d === void 0 ? void 0 : _d.product_types)
        ? hit._source.product_types.map(function (t) { return String(t).toLowerCase(); }).join(" ")
        : "";
    var audienceBlob = "".concat(title, " ").concat(category, " ").concat(canonical, " ").concat(productTypes);
    var womenStyleCue = /\b(dress|dresses|gown|skirt|skirted|blouse|camisole|cami|heels?|pumps?|stiletto|mary jane|handbag|clutch|tote|purse|vest\s*dress|sling\s*dress|abaya|kaftan|mini\s*skirt|midi\s*skirt|maxi\s*skirt)\b/;
    var menStyleCue = /\b(suit|suits|tie|oxford|oxfords|dress\s*shirt|button\s*down|button-down|briefs|boxer|boxers|cargo\s*pants?|chino|chinos|loafer|loafers|briefcase|messenger|sport\s*coat|blazer)\b/;
    var score = 1;
    var factors = 0;
    if (wantAge) {
        factors += 1;
        if (!docAge) {
            if (wantAge === "kids" && /\b(kids?|child|children|boys?|girls?|toddler|baby|youth)\b/.test(audienceBlob)) {
                score *= 0.92;
            }
            else if (wantAge === "adult" || wantAge === "teen") {
                score *= 0.88;
            }
            else {
                score *= 0.72;
            }
        }
        else if (docAge === wantAge) {
            score *= 1;
        }
        else if (wantAge === "kids" && (docAge === "baby" || docAge === "teen")) {
            score *= 0.88;
        }
        else if (wantAge === "baby" && docAge === "kids") {
            score *= 0.85;
        }
        else {
            // Hard contradiction: explicit indexed age group disagrees with requested age group.
            score *= 0;
        }
    }
    if (wantG) {
        factors += 1;
        if (!docG) {
            var hasKidsCue = /\b(kids?|child|children|boys?|girls?|toddler|baby|youth)\b/.test(audienceBlob);
            var hasWomenStyleCue = womenStyleCue.test(audienceBlob);
            var hasMenStyleCue = menStyleCue.test(audienceBlob);
            if (wantG === "men") {
                if (hasKidsCue)
                    score *= 0;
                else if (hasWomenStyleCue && !hasMenStyleCue)
                    score *= 0.12;
                else if (/\b(men|mens|male)\b/.test(audienceBlob))
                    score *= 0.9;
                else if (/\b(women|womens|female|ladies|woman|girl|girls)\b/.test(audienceBlob))
                    score *= 0.28;
                else
                    score *= 0.78;
            }
            else if (wantG === "women") {
                if (hasKidsCue)
                    score *= 0;
                else if (hasMenStyleCue && !hasWomenStyleCue)
                    score *= 0.12;
                else if (/\b(women|womens|female|ladies|woman)\b/.test(audienceBlob))
                    score *= 0.9;
                else if (/\b(men|mens|male|man|boy|boys)\b/.test(audienceBlob))
                    score *= 0.28;
                else
                    score *= 0.78;
            }
            else {
                score *= 0.85;
            }
        }
        else if (docG === "unisex" || docG === wantG) {
            score *= 1;
        }
        else {
            // Hard contradiction: explicit indexed audience gender disagrees with request.
            score *= 0;
        }
    }
    if (factors === 0)
        return 1;
    return Math.max(0, Math.min(1, Math.pow(score, 1 / factors)));
}
function normalizeTextForTokenMatch(s) {
    return s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function escapeRegexToken(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/** Lexical proxy when BM25 is not exposed separately (share of query tokens as whole words in title). */
function scoreTitleLexicalOverlap01(query, title) {
    var qNorm = normalizeTextForTokenMatch(query);
    var tokens = qNorm.split(/\s+/).filter(function (t) { return t.length >= 2; });
    if (tokens.length === 0)
        return 1;
    var tNorm = normalizeTextForTokenMatch(title);
    var matched = 0;
    for (var _i = 0, tokens_1 = tokens; _i < tokens_1.length; _i++) {
        var tok = tokens_1[_i];
        if (new RegExp("\\b".concat(escapeRegexToken(tok), "\\b"), "i").test(tNorm))
            matched++;
    }
    return Math.max(0, Math.min(1, matched / tokens.length));
}
function normalizeRawTo01(raw, maxRaw, useTanh, tanhScale) {
    var positive = Math.max(0, raw);
    var v = useTanh
        ? Math.tanh(positive / tanhScale)
        : maxRaw > 0
            ? positive / maxRaw
            : 0;
    return Math.max(0, Math.min(1, Math.round(v * 100) / 100));
}
function mergeColorArrays() {
    var parts = [];
    for (var _i = 0; _i < arguments.length; _i++) {
        parts[_i] = arguments[_i];
    }
    var out = [];
    for (var _a = 0, parts_1 = parts; _a < parts_1.length; _a++) {
        var part = parts_1[_a];
        var arr = Array.isArray(part)
            ? part.map(function (x) { return String(x).toLowerCase(); })
            : part
                ? [String(part).toLowerCase()]
                : [];
        for (var _b = 0, arr_1 = arr; _b < arr_1.length; _b++) {
            var c = arr_1[_b];
            if (c && !out.includes(c))
                out.push(c);
        }
    }
    return out;
}
function normalizeSleeveToken(raw) {
    if (!raw)
        return null;
    var s = String(raw).toLowerCase().trim();
    if (!s)
        return null;
    if (/\b(tank|cami|camisole|sleeveless|strapless|halter|strap top|vest top|spaghetti strap)\b/.test(s)) {
        return "sleeveless";
    }
    if (s.includes("sleeveless"))
        return "sleeveless";
    if (s.includes("short"))
        return "short";
    if (s.includes("long"))
        return "long";
    return null;
}
function inferSleeveFromCatalogSignals(src, title, description) {
    var bag = [
        src.category,
        src.category_canonical,
        title,
        description,
    ]
        .map(function (x) { return String(x !== null && x !== void 0 ? x : "").toLowerCase(); })
        .join(" ");
    if (!bag.trim())
        return null;
    // Explicit no-sleeve families.
    if (/\b(tank|cami|camisole|halter|strapless|tube top|vest top|spaghetti strap|sleeveless)\b/.test(bag)) {
        return "sleeveless";
    }
    // Type-level defaults when explicit sleeve fields are missing.
    if (/\b(hoodie|hooded|sweater|cardigan|pullover|jacket|coat|parka|trench|blazer|windbreaker|overcoat)\b/.test(bag)) {
        return "long";
    }
    if (/\b(t-?shirt|tee\b|tees\b|polo\b|polo shirt|jersey tee|short sleeve)\b/.test(bag)) {
        return "short";
    }
    return null;
}
function docSupportsSleeveIntent(src) {
    var bag = __spreadArray([
        src.category,
        src.category_canonical,
        src.title
    ], (Array.isArray(src.product_types) ? src.product_types : []), true).map(function (x) { return String(x !== null && x !== void 0 ? x : "").toLowerCase(); })
        .join(" ");
    if (!bag.trim())
        return false;
    if (/\b(pant|pants|trouser|trousers|jean|jeans|shorts|skirt|skirts|legging|leggings|jogger|joggers|chino|chinos|cargo|cargos|bottom|bottoms|shoe|shoes|sneaker|sneakers|boot|boots|sandal|sandals|heel|heels|loafer|loafers|bag|bags|wallet|wallets|belt|belts|hat|hats|cap|caps|scarf|scarves|jewelry|jewellery|ring|rings|earring|earrings|necklace|necklaces|bracelet|bracelets)\b/.test(bag)) {
        return false;
    }
    return /\b(dress|dressy|top|shirt|shirts|blouse|blouses|tee|t-?shirt|tank|camisole|cami|sweater|sweaters|cardigan|cardigans|hoodie|hoodies|jacket|jackets|coat|coats|blazer|blazers|outerwear|suit|suits|romper|jumpsuit|vest)\b/.test(bag);
}
function rawColorList() {
    var parts = [];
    for (var _i = 0; _i < arguments.length; _i++) {
        parts[_i] = arguments[_i];
    }
    return __spreadArray([], new Set(mergeColorArrays.apply(void 0, parts).map(function (c) { return String(c).toLowerCase().trim(); })
        .filter(Boolean)), true);
}
function normalizedFashionColorList(values) {
    var _a, _b;
    var out = [];
    for (var _i = 0, values_1 = values; _i < values_1.length; _i++) {
        var value = values_1[_i];
        var canonical = (_b = (_a = (0, colorCanonical_1.canonicalizeFashionColorToken)(value)) !== null && _a !== void 0 ? _a : (0, queryColorFilter_1.normalizeColorToken)(value)) !== null && _b !== void 0 ? _b : String(value).toLowerCase().trim();
        if (canonical && !out.includes(canonical))
            out.push(canonical);
    }
    return out;
}
function resolveProductColorForRanking(params) {
    var metadata = normalizedFashionColorList(params.metadataColors);
    if (metadata.length > 0)
        return { colors: metadata, confidence: 1, source: "metadata" };
    var url = normalizedFashionColorList(params.urlColors);
    if (url.length > 0)
        return { colors: url, confidence: 0.9, source: "url" };
    var title = normalizedFashionColorList(params.titleColors);
    if (title.length > 0)
        return { colors: title, confidence: 0.8, source: "title" };
    var image = normalizedFashionColorList(params.imageColors);
    if (image.length > 0)
        return { colors: image, confidence: 0.45, source: "image" };
    return { colors: [], confidence: 0, source: "none" };
}
function extractColorHintsFromProductUrl(productUrl) {
    var raw = String(productUrl !== null && productUrl !== void 0 ? productUrl : "").trim();
    if (!raw)
        return [];
    var hints = new Set();
    var push = function (v) {
        var s = String(v !== null && v !== void 0 ? v : "")
            .toLowerCase()
            .replace(/[+_]/g, " ")
            .replace(/%20/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        if (!s)
            return;
        hints.add(s);
        var norm = (0, queryColorFilter_1.normalizeColorToken)(s);
        if (norm)
            hints.add(norm);
    };
    // Handle both query params and fragment params, e.g. ?color=white or #color=off%20white.
    var candidate = raw.replace(/^#/, "");
    var qIdx = candidate.indexOf("?");
    var hIdx = candidate.indexOf("#");
    var queryPart = qIdx >= 0 ? candidate.slice(qIdx + 1, hIdx >= 0 && hIdx > qIdx ? hIdx : undefined) : "";
    var hashPart = hIdx >= 0 ? candidate.slice(hIdx + 1) : (qIdx < 0 ? candidate : "");
    var parsePart = function (part) {
        if (!part)
            return;
        for (var _i = 0, _a = part.split("&"); _i < _a.length; _i++) {
            var segment = _a[_i];
            var _b = segment.split("="), kRaw = _b[0], vRaw = _b[1];
            var k = decodeURIComponent(String(kRaw !== null && kRaw !== void 0 ? kRaw : "")).toLowerCase().trim();
            var v = decodeURIComponent(String(vRaw !== null && vRaw !== void 0 ? vRaw : "")).trim();
            if (!k || !v)
                continue;
            if (k === "color" || k === "colour" || k === "variant" || k === "shade")
                push(v);
        }
    };
    parsePart(queryPart);
    parsePart(hashPart);
    return __spreadArray([], hints, true);
}
function clamp01(x) {
    if (!Number.isFinite(x))
        return 0;
    return Math.max(0, Math.min(1, x));
}
function confidenceBlend(score, confidence, neutralFloor) {
    var s = clamp01(score);
    var c = clamp01(confidence);
    var floor = clamp01(neutralFloor);
    return s * c + floor * (1 - c);
}
/**
 * Full text-search-equivalent compliance + rerank + final relevance for one OpenSearch hit.
 */
function computeHitRelevance(hit, similarity, intent) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10, _11, _12, _13, _14, _15, _16, _17, _18, _19, _20, _21, _22, _23, _24, _25, _26, _27, _28;
    var src = (_a = hit === null || hit === void 0 ? void 0 : hit._source) !== null && _a !== void 0 ? _a : {};
    var desiredProductTypes = intent.desiredProductTypes, desiredColors = intent.desiredColors, desiredColorsTier = intent.desiredColorsTier, desiredStyle = intent.desiredStyle, desiredPattern = intent.desiredPattern, // new
    desiredSleeve = intent.desiredSleeve, rerankColorMode = intent.rerankColorMode, mergedCategory = intent.mergedCategory, astCategories = intent.astCategories, queryAgeGroup = intent.queryAgeGroup, audienceGenderForScoring = intent.audienceGenderForScoring, hasAudienceIntent = intent.hasAudienceIntent, crossFamilyPenaltyWeight = intent.crossFamilyPenaltyWeight, lexicalMatchQuery = intent.lexicalMatchQuery, hybridScoreRecall = intent.hybridScoreRecall, negationExcludeTerms = intent.negationExcludeTerms, enforcePromptConstraints = intent.enforcePromptConstraints, promptAnchoredColorIntent = intent.promptAnchoredColorIntent, promptAnchoredTypeIntent = intent.promptAnchoredTypeIntent, tightSemanticCap = intent.tightSemanticCap, softColorBiasOnly = intent.softColorBiasOnly;
    var productTypesRaw = (_b = hit === null || hit === void 0 ? void 0 : hit._source) === null || _b === void 0 ? void 0 : _b.product_types;
    var productTypes = Array.isArray(productTypesRaw)
        ? productTypesRaw.map(function (x) { return String(x).toLowerCase(); })
        : productTypesRaw
            ? [String(productTypesRaw).toLowerCase()]
            : [];
    if (productTypes.length > 0) {
        var mappedDocCategory = typeof ((_c = hit === null || hit === void 0 ? void 0 : hit._source) === null || _c === void 0 ? void 0 : _c.category_canonical) === "string"
            ? String(hit._source.category_canonical).toLowerCase().trim()
            : typeof ((_d = hit === null || hit === void 0 ? void 0 : hit._source) === null || _d === void 0 ? void 0 : _d.category) === "string"
                ? String(hit._source.category).toLowerCase().trim()
                : "";
        var filtered = (0, productTypeTaxonomy_1.filterProductTypeSeedsByMappedCategory)(productTypes, mappedDocCategory);
        if (filtered.length > 0)
            productTypes = filtered;
    }
    var attrColorsRaw = (_e = hit === null || hit === void 0 ? void 0 : hit._source) === null || _e === void 0 ? void 0 : _e.attr_colors;
    var attrText = (_f = hit === null || hit === void 0 ? void 0 : hit._source) === null || _f === void 0 ? void 0 : _f.attr_colors_text;
    var attrImg = (_g = hit === null || hit === void 0 ? void 0 : hit._source) === null || _g === void 0 ? void 0 : _g.attr_colors_image;
    var imgTierRaw = rawColorList((_h = hit === null || hit === void 0 ? void 0 : hit._source) === null || _h === void 0 ? void 0 : _h.color_palette_canonical, attrImg);
    var textTierRaw = rawColorList(attrText);
    var attrColorSource = String((_k = (_j = hit === null || hit === void 0 ? void 0 : hit._source) === null || _j === void 0 ? void 0 : _j.attr_color_source) !== null && _k !== void 0 ? _k : "").toLowerCase().trim();
    var catalogTierRaw = rawColorList((_l = hit === null || hit === void 0 ? void 0 : hit._source) === null || _l === void 0 ? void 0 : _l.color, attrColorSource === "catalog" ? (_m = hit === null || hit === void 0 ? void 0 : hit._source) === null || _m === void 0 ? void 0 : _m.color_primary_canonical : null, attrColorSource === "catalog" ? (_o = hit === null || hit === void 0 ? void 0 : hit._source) === null || _o === void 0 ? void 0 : _o.attr_color : null);
    var urlTierRaw = rawColorList(extractColorHintsFromProductUrl((_p = hit === null || hit === void 0 ? void 0 : hit._source) === null || _p === void 0 ? void 0 : _p.product_url), extractColorHintsFromProductUrl((_q = hit === null || hit === void 0 ? void 0 : hit._source) === null || _q === void 0 ? void 0 : _q.parent_product_url));
    var unionTierRaw = rawColorList((_r = hit === null || hit === void 0 ? void 0 : hit._source) === null || _r === void 0 ? void 0 : _r.color_palette_canonical, attrColorsRaw, attrText, attrImg, (_s = hit === null || hit === void 0 ? void 0 : hit._source) === null || _s === void 0 ? void 0 : _s.color, (_t = hit === null || hit === void 0 ? void 0 : hit._source) === null || _t === void 0 ? void 0 : _t.color_primary_canonical, (_u = hit === null || hit === void 0 ? void 0 : hit._source) === null || _u === void 0 ? void 0 : _u.color_secondary_canonical, (_v = hit === null || hit === void 0 ? void 0 : hit._source) === null || _v === void 0 ? void 0 : _v.color_accent_canonical);
    if (unionTierRaw.length === 0 && ((_w = hit === null || hit === void 0 ? void 0 : hit._source) === null || _w === void 0 ? void 0 : _w.attr_color)) {
        unionTierRaw = rawColorList(hit._source.attr_color);
    }
    if (unionTierRaw.length === 0) {
        var urlColorHints = urlTierRaw;
        if (urlColorHints.length > 0) {
            unionTierRaw = rawColorList(urlColorHints);
            if (textTierRaw.length === 0) {
                textTierRaw = rawColorList(urlColorHints);
            }
        }
    }
    if (unionTierRaw.length === 0 && typeof ((_x = hit === null || hit === void 0 ? void 0 : hit._source) === null || _x === void 0 ? void 0 : _x.title) === "string") {
        var inferred = (0, attributeExtractor_1.extractAttributesSync)(String(hit._source.title));
        var inferredColors = inferred.attributes.colors && inferred.attributes.colors.length > 0
            ? inferred.attributes.colors
            : inferred.attributes.color
                ? [inferred.attributes.color]
                : [];
        for (var _i = 0, inferredColors_1 = inferredColors; _i < inferredColors_1.length; _i++) {
            var c = inferredColors_1[_i];
            var x = String(c).toLowerCase().trim();
            if (x && !unionTierRaw.includes(x))
                unionTierRaw.push(x);
        }
        if (textTierRaw.length === 0 && inferredColors.length > 0) {
            textTierRaw = rawColorList(inferredColors);
        }
    }
    var titleTierRaw = __spreadArray([], textTierRaw, true);
    var resolvedColor = resolveProductColorForRanking({
        metadataColors: catalogTierRaw,
        urlColors: urlTierRaw,
        titleColors: titleTierRaw,
        imageColors: imgTierRaw,
    });
    var productColors = resolvedColor.colors.length > 0
        ? resolvedColor.colors
        : normalizedFashionColorList(unionTierRaw);
    var primaryColor = ((_y = hit === null || hit === void 0 ? void 0 : hit._source) === null || _y === void 0 ? void 0 : _y.color_primary_canonical)
        ? String(hit._source.color_primary_canonical).toLowerCase()
        : ((_z = hit === null || hit === void 0 ? void 0 : hit._source) === null || _z === void 0 ? void 0 : _z.attr_color)
            ? String(hit._source.attr_color).toLowerCase()
            : productColors.length > 0
                ? productColors[0]
                : null;
    var productTypeCompliance = 0;
    var exactTypeScore = 0;
    var siblingClusterScore = 0;
    var parentHypernymScore = 0;
    var intraFamilyPenalty = 0;
    if (desiredProductTypes.length > 0) {
        var typeBreak = (0, productTypeTaxonomy_1.scoreRerankProductTypeBreakdown)(desiredProductTypes, productTypes);
        productTypeCompliance = typeBreak.combinedTypeCompliance;
        exactTypeScore = typeBreak.exactTypeScore;
        siblingClusterScore = typeBreak.siblingClusterScore;
        parentHypernymScore = typeBreak.parentHypernymScore;
        intraFamilyPenalty = typeBreak.intraFamilyPenalty;
        var docCategoryRaw = typeof ((_0 = hit === null || hit === void 0 ? void 0 : hit._source) === null || _0 === void 0 ? void 0 : _0.category) === "string" ? hit._source.category : undefined;
        var spurious = (0, productTypeTaxonomy_1.downrankSpuriousProductTypeFromCategory)(desiredProductTypes, productTypes, docCategoryRaw);
        if (spurious.forceExactZero)
            exactTypeScore = 0;
        productTypeCompliance = Math.max(0, Math.min(1, productTypeCompliance * spurious.complianceScale));
    }
    var wcText = Number((_1 = hit === null || hit === void 0 ? void 0 : hit._source) === null || _1 === void 0 ? void 0 : _1.color_confidence_text);
    var wcImg = Number((_2 = hit === null || hit === void 0 ? void 0 : hit._source) === null || _2 === void 0 ? void 0 : _2.color_confidence_image);
    var wText = Number.isFinite(wcText) && wcText > 0 ? wcText : 0;
    var wImg = Number.isFinite(wcImg) && wcImg > 0 ? wcImg : 0;
    var wSum = wText + wImg + 1e-6;
    var wtImg = wImg / wSum;
    var wtText = wText / wSum;
    var colorCompliance = 0;
    var matchedColor = null;
    var colorTier = "none";
    if (desiredColorsTier.length > 0) {
        var tImg = (0, colorCanonical_1.tieredColorListCompliance)(desiredColorsTier, imgTierRaw, rerankColorMode);
        var tText = (0, colorCanonical_1.tieredColorListCompliance)(desiredColorsTier, textTierRaw, rerankColorMode);
        var tResolved = (0, colorCanonical_1.tieredColorListCompliance)(desiredColorsTier, resolvedColor.colors, rerankColorMode);
        var tUnion = (0, colorCanonical_1.tieredColorListCompliance)(desiredColorsTier, unionTierRaw, rerankColorMode);
        matchedColor = (_4 = (_3 = tUnion.bestMatch) !== null && _3 !== void 0 ? _3 : tImg.bestMatch) !== null && _4 !== void 0 ? _4 : tText.bestMatch;
        colorTier = tUnion.tier;
        if (resolvedColor.colors.length > 0 && resolvedColor.source !== "image") {
            colorCompliance = tResolved.compliance;
            matchedColor = (_5 = tResolved.bestMatch) !== null && _5 !== void 0 ? _5 : matchedColor;
            colorTier = tResolved.tier;
        }
        else if (imgTierRaw.length > 0 && textTierRaw.length > 0) {
            colorCompliance = wtImg * tImg.compliance + wtText * tText.compliance;
        }
        else if (imgTierRaw.length > 0) {
            colorCompliance = tImg.compliance;
            matchedColor = (_6 = tImg.bestMatch) !== null && _6 !== void 0 ? _6 : matchedColor;
            colorTier = tImg.tier;
        }
        else if (textTierRaw.length > 0) {
            colorCompliance = tText.compliance;
            matchedColor = (_7 = tText.bestMatch) !== null && _7 !== void 0 ? _7 : matchedColor;
            colorTier = tText.tier;
        }
        else {
            colorCompliance = tUnion.compliance;
        }
    }
    // Guardrail: if catalog color explicitly contradicts desired color, demote tier to force proper gating.
    // This ensures products with contradictory indexed colors don't bypass family/bucket compliance checks.
    var catalogColorRaw = typeof ((_8 = hit === null || hit === void 0 ? void 0 : hit._source) === null || _8 === void 0 ? void 0 : _8.color) === "string" ? String(hit._source.color).toLowerCase() : "";
    var catalogColorNorm = catalogColorRaw ? (_9 = (0, queryColorFilter_1.normalizeColorToken)(catalogColorRaw)) !== null && _9 !== void 0 ? _9 : catalogColorRaw : "";
    var catalogColorContradicts = false;
    if (desiredColorsTier.length > 0 && catalogColorNorm) {
        var tCatalog = (0, colorCanonical_1.tieredColorListCompliance)(desiredColorsTier, [catalogColorNorm], rerankColorMode);
        if (tCatalog.compliance <= 0) {
            catalogColorContradicts = true;
            // Catalog color contradicts desired color: heavily penalize to force exact-match products to rank higher.
            // For family/bucket tiers especially (e.g., white product matched via silver→gray), 
            // reduce compliance drastically so indexed gray/charcoal products win.
            var catalogContradictionPenalty = colorTier === "exact" ? 0
                : (colorTier === "light-shade" || colorTier === "dark-shade") ? 0.02
                    : colorTier === "family" ? 0.08
                        : 0.15;
            colorCompliance = colorCompliance * catalogContradictionPenalty;
            if (colorTier === "exact")
                colorTier = "none";
            // Demote family/shade tiers to bucket so it gets gated by bucketLimit logic
            if (colorTier === "family" || colorTier === "light-shade" || colorTier === "dark-shade")
                colorTier = "bucket";
            // Keep `matchedColor` tied to query-vs-hit match evidence only; do not replace it
            // with catalog color, otherwise explain output can look like query color was rewritten.
        }
    }
    // Additional guard: many vendors encode variant color in URL params/fragments.
    // If URL color contradicts desired color, don't allow optimistic "exact" tiers.
    var urlColorHintsForGuard = extractColorHintsFromProductUrl((_10 = hit === null || hit === void 0 ? void 0 : hit._source) === null || _10 === void 0 ? void 0 : _10.product_url);
    if (desiredColorsTier.length > 0 && urlColorHintsForGuard.length > 0) {
        var tUrl = (0, colorCanonical_1.tieredColorListCompliance)(desiredColorsTier, urlColorHintsForGuard, rerankColorMode);
        if (tUrl.compliance <= 0) {
            colorCompliance = colorCompliance * 0.45;
            if (colorTier === "exact")
                colorTier = "none";
        }
    }
    // Explain consistency: avoid reporting "exact" when weighted compliance is weak.
    // This prevents contradictions like exact-tier with very low effective color match.
    if (colorTier === "exact" && colorCompliance < 0.6) {
        colorTier = colorCompliance >= 0.35 ? "family" : "none";
    }
    // Explain hygiene: don't expose a matched color when effective color signal is none.
    if (colorTier === "none" || colorCompliance <= 0.01) {
        matchedColor = null;
    }
    var docCategoryForPenalty = typeof ((_11 = hit === null || hit === void 0 ? void 0 : hit._source) === null || _11 === void 0 ? void 0 : _11.category) === "string" ? hit._source.category : undefined;
    var docCanonicalForPenalty = typeof ((_12 = hit === null || hit === void 0 ? void 0 : hit._source) === null || _12 === void 0 ? void 0 : _12.category_canonical) === "string"
        ? hit._source.category_canonical
        : undefined;
    var crossFamilyPenalty = desiredProductTypes.length > 0
        ? (0, productTypeTaxonomy_1.scoreCrossFamilyTypePenalty)(desiredProductTypes, productTypes, {
            category: docCategoryForPenalty,
            categoryCanonical: docCanonicalForPenalty,
        })
        : 0;
    // Style compliance: keyword match on indexed `attr_style`.
    // We keep this intentionally simple so it works well with `keyword` fields.
    var normalizedDesiredStyle = desiredStyle ? String(desiredStyle).toLowerCase().trim() : "";
    var hitStyleRaw = (_13 = hit === null || hit === void 0 ? void 0 : hit._source) === null || _13 === void 0 ? void 0 : _13.attr_style;
    var hitStyle = typeof hitStyleRaw === "string" ? hitStyleRaw.toLowerCase().trim() : "";
    var title = typeof ((_14 = hit === null || hit === void 0 ? void 0 : hit._source) === null || _14 === void 0 ? void 0 : _14.title) === "string" ? hit._source.title.toLowerCase() : "";
    var styleCompliance = 0;
    if (normalizedDesiredStyle) {
        if (hitStyle) {
            // If explicit indexed style exists, treat mismatch as hard contradiction.
            if (hitStyle === normalizedDesiredStyle)
                styleCompliance = 1;
            else if (hitStyle.includes(normalizedDesiredStyle) || normalizedDesiredStyle.includes(hitStyle))
                styleCompliance = 0.7;
            else
                styleCompliance = 0;
        }
        else if (title.includes(normalizedDesiredStyle)) {
            styleCompliance = 0.6;
        }
        else {
            styleCompliance = 0;
        }
    }
    // Pattern compliance (new, similar to style)
    var patternCompliance = 0;
    var normalizedDesiredPattern = desiredPattern ? String(desiredPattern).toLowerCase().trim() : "";
    var hitPatternRaw = (_15 = hit === null || hit === void 0 ? void 0 : hit._source) === null || _15 === void 0 ? void 0 : _15.attr_pattern;
    var hitPattern = typeof hitPatternRaw === "string" ? hitPatternRaw.toLowerCase().trim() : "";
    if (normalizedDesiredPattern) {
        if (hitPattern) {
            if (hitPattern === normalizedDesiredPattern)
                patternCompliance = 1;
            else if (hitPattern.includes(normalizedDesiredPattern) || normalizedDesiredPattern.includes(hitPattern))
                patternCompliance = 0.7;
            else
                patternCompliance = 0;
        }
        else if (title.includes(normalizedDesiredPattern)) {
            patternCompliance = 0.6;
        }
        else {
            patternCompliance = 0;
        }
    }
    var sleeveCompliance = 0;
    var wantedSleeve = normalizeSleeveToken(desiredSleeve);
    var sleeveIntentApplicable = docSupportsSleeveIntent(src);
    var hasSleeveIntentForDoc = Boolean(wantedSleeve) && sleeveIntentApplicable;
    if (hasSleeveIntentForDoc) {
        var description = typeof ((_16 = hit === null || hit === void 0 ? void 0 : hit._source) === null || _16 === void 0 ? void 0 : _16.description) === "string" ? hit._source.description : "";
        var docSleeveRaw = typeof ((_17 = hit === null || hit === void 0 ? void 0 : hit._source) === null || _17 === void 0 ? void 0 : _17.attr_sleeve) === "string"
            ? hit._source.attr_sleeve
            : typeof ((_18 = hit === null || hit === void 0 ? void 0 : hit._source) === null || _18 === void 0 ? void 0 : _18.sleeve) === "string"
                ? hit._source.sleeve
                : "".concat(description);
        var docSleeve = normalizeSleeveToken(docSleeveRaw);
        var titleSleeve = normalizeSleeveToken(title);
        var observed = (_19 = docSleeve !== null && docSleeve !== void 0 ? docSleeve : titleSleeve) !== null && _19 !== void 0 ? _19 : normalizeSleeveToken(description);
        var inferredObserved = observed !== null && observed !== void 0 ? observed : inferSleeveFromCatalogSignals(src, title, description);
        if (!inferredObserved) {
            sleeveCompliance = 0.15;
        }
        else if (inferredObserved === wantedSleeve) {
            // Inferred sleeve from type/category cues is weaker than explicit sleeve metadata.
            // Keep this conservative so noisy catalog signals (e.g. bad type tags) do not
            // incorrectly satisfy sleeve intent for long-sleeve products.
            sleeveCompliance = observed ? 1 : 0.28;
        }
        else if (!observed) {
            // Avoid hard contradiction penalty when mismatch comes from heuristic inference only.
            sleeveCompliance = 0.12;
        }
        else if (docSleeve) {
            sleeveCompliance = 0;
        }
        else {
            sleeveCompliance = 0.15;
        }
    }
    var audienceCompliance = scoreAudienceCompliance(queryAgeGroup, audienceGenderForScoring, hit);
    var categoryRelevance01 = scoreCategoryRelevance01(mergedCategory, astCategories, (_20 = hit === null || hit === void 0 ? void 0 : hit._source) === null || _20 === void 0 ? void 0 : _20.category, (_21 = hit === null || hit === void 0 ? void 0 : hit._source) === null || _21 === void 0 ? void 0 : _21.category_canonical);
    /** Garment/footwear image intent vs makeup/skincare listing — CLIP is often high on shared skintone/packaging cues. */
    var garmentVersusBeautyPenalty = (function () {
        var _a;
        var raw = Number((_a = process.env.SEARCH_BEAUTY_APPAREL_CROSS_PENALTY) !== null && _a !== void 0 ? _a : "0.92");
        var p = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0.92;
        if (p <= 0)
            return 0;
        if (!desiredProductTypes.length)
            return 0;
        if (!(0, productTypeTaxonomy_1.hasGarmentLikeFamilyFromProductTypeSeeds)(desiredProductTypes))
            return 0;
        if (!(0, categoryFilter_2.isBeautyRetailListingFromFields)(src.category, src.category_canonical))
            return 0;
        return p;
    })();
    crossFamilyPenalty = Math.max(crossFamilyPenalty, garmentVersusBeautyPenalty);
    if (productTypeCompliance >= 1) {
        crossFamilyPenalty = 0;
    }
    // General fallback: if the index misses/undercounts `product_types`, recover
    // type compliance from lexical evidence in title+description.
    // Only when there is an actual user/search lexical query: for pure image search
    // (vision-derived type seeds, no text), title overlap creates false type matches
    // and floats irrelevant products above true kNN neighbors.
    if (desiredProductTypes.length > 0 &&
        productTypeCompliance < 0.2 &&
        (lexicalMatchQuery === null || lexicalMatchQuery === void 0 ? void 0 : lexicalMatchQuery.trim())) {
        var typeTextFallbackWeightRaw = Number((_22 = process.env.SEARCH_TYPE_TEXT_FALLBACK_WEIGHT) !== null && _22 !== void 0 ? _22 : "0.25");
        var typeTextFallbackWeight = Number.isFinite(typeTextFallbackWeightRaw) && typeTextFallbackWeightRaw > 0
            ? Math.min(1, typeTextFallbackWeightRaw)
            : 0.25;
        var desiredTypesText = desiredProductTypes.join(" ");
        var title_1 = typeof src.title === "string" ? src.title : "";
        var description = typeof src.description === "string" ? src.description : "";
        var hitText = "".concat(title_1, " ").concat(description).trim();
        var typeTextOverlap01 = hitText.length > 0
            ? scoreTitleLexicalOverlap01(desiredTypesText, hitText)
            : 0;
        var categoryAgreed01 = categoryRelevance01 !== null && categoryRelevance01 !== void 0 ? categoryRelevance01 : 0;
        var candidateTypeCompliance = typeTextOverlap01 * categoryAgreed01;
        var effectiveTypeCompliance = Math.max(productTypeCompliance, candidateTypeCompliance * typeTextFallbackWeight);
        productTypeCompliance = effectiveTypeCompliance;
    }
    var recall = hybridScoreRecall;
    var semScore01 = similarity;
    var lexScore01 = similarity;
    if ((recall === null || recall === void 0 ? void 0 : recall.hasSplitScores) &&
        recall.maxClip > 0 &&
        recall.maxBm25 > 0 &&
        src.clip_score != null &&
        src.bm25_score != null) {
        semScore01 = normalizeRawTo01(Number(src.clip_score), recall.maxClip, recall.useTanhSim, recall.tanhScale);
        lexScore01 = normalizeRawTo01(Number(src.bm25_score), recall.maxBm25, recall.useTanhSim, recall.tanhScale);
    }
    else {
        var qLex = lexicalMatchQuery === null || lexicalMatchQuery === void 0 ? void 0 : lexicalMatchQuery.trim();
        if (qLex) {
            lexScore01 = scoreTitleLexicalOverlap01(qLex, String((_23 = src.title) !== null && _23 !== void 0 ? _23 : ""));
        }
    }
    var hasOsSplitLex = Boolean(recall === null || recall === void 0 ? void 0 : recall.hasSplitScores) &&
        ((_24 = recall === null || recall === void 0 ? void 0 : recall.maxClip) !== null && _24 !== void 0 ? _24 : 0) > 0 &&
        ((_25 = recall === null || recall === void 0 ? void 0 : recall.maxBm25) !== null && _25 !== void 0 ? _25 : 0) > 0 &&
        src.clip_score != null &&
        src.bm25_score != null;
    var lexicalScoreDistinct = hasOsSplitLex || Boolean(lexicalMatchQuery === null || lexicalMatchQuery === void 0 ? void 0 : lexicalMatchQuery.trim());
    var normDoc = Number((_26 = hit === null || hit === void 0 ? void 0 : hit._source) === null || _26 === void 0 ? void 0 : _26.norm_confidence);
    var docTrustNorm = Number.isFinite(normDoc) && normDoc >= 0 && normDoc <= 1 ? 0.55 + 0.45 * normDoc : 0.92;
    var typeDoc = Number((_27 = hit === null || hit === void 0 ? void 0 : hit._source) === null || _27 === void 0 ? void 0 : _27.type_confidence);
    var typeDocTrust = Number.isFinite(typeDoc) && typeDoc >= 0 && typeDoc <= 1 ? 0.45 + 0.55 * typeDoc : 1;
    var docTrust = Math.max(0.25, Math.min(1, docTrustNorm * typeDocTrust));
    var typeMetadataConfidence = clamp01(Number.isFinite(typeDoc) && typeDoc >= 0 && typeDoc <= 1
        ? typeDoc
        : Number.isFinite(normDoc) && normDoc >= 0 && normDoc <= 1
            ? normDoc
            : 0.72);
    var colorMetadataConfidence = clamp01(Math.max(Number.isFinite(wcText) ? wcText : 0, Number.isFinite(wcImg) ? wcImg : 0, Number.isFinite(normDoc) && normDoc >= 0 && normDoc <= 1 ? normDoc * 0.9 : 0, 0.58));
    var styleMetadataConfidence = clamp01(Number.isFinite(normDoc) && normDoc >= 0 && normDoc <= 1 ? normDoc * 0.95 : 0.62);
    var wSim = rerankSimilarityWeight();
    var wAud = rerankAudienceWeight();
    var typeComponent = productTypeCompliance * 420 * docTrust;
    var hasTypeIntent = desiredProductTypes.length > 0;
    // Prevent non-type attributes from overpowering clear crop/type intent when type compliance is weak.
    var attrTypeGate = !hasTypeIntent
        ? 1
        : productTypeCompliance >= 0.5
            ? 1
            : productTypeCompliance >= 0.2
                ? 0.35
                : 0.08;
    var attrComponentRaw = colorCompliance * 90 * docTrust +
        styleCompliance * 65 * docTrust +
        patternCompliance * 40 * docTrust + // new
        sleeveCompliance * 52 * docTrust +
        audienceCompliance * wAud * docTrust;
    var attrComponent = attrComponentRaw * attrTypeGate;
    // Similarity term strengthened and modulated by type compliance.
    var visualComponent = similarity * (wSim + 120 * (0.35 + 0.65 * productTypeCompliance));
    var penaltyComponent = crossFamilyPenalty * crossFamilyPenaltyWeight;
    var categoryConsistencyMultiplier = topBottomCategoryConsistencyMultiplier({
        mergedCategory: mergedCategory,
        astCategories: astCategories,
        docCategory: docCategoryForPenalty,
        docCanonical: docCanonicalForPenalty,
        docProductTypes: productTypes,
    });
    var rerankScore = typeComponent + attrComponent + visualComponent - penaltyComponent;
    if (categoryConsistencyMultiplier < 1) {
        rerankScore *= categoryConsistencyMultiplier;
    }
    var hasReliableTypeIntent = hasTypeIntent && intent.reliableTypeIntent !== false;
    var hasColorIntent = desiredColors.length > 0;
    /** Soft-only auto colors must not gate final acceptance the same as user `filters.color`. */
    var hasColorIntentForFinalRelevance = hasColorIntent && !softColorBiasOnly;
    var typeScoreForFinal = hasReliableTypeIntent
        ? confidenceBlend(productTypeCompliance, typeMetadataConfidence, 0.38)
        : productTypeCompliance;
    var colorScoreForFinal = hasColorIntentForFinalRelevance
        ? confidenceBlend(colorCompliance, colorMetadataConfidence, 0.34)
        : colorCompliance;
    var styleScoreForFinal = normalizedDesiredStyle
        ? confidenceBlend(styleCompliance, styleMetadataConfidence, 0.32)
        : styleCompliance;
    var patternScoreForFinal = normalizedDesiredPattern
        ? confidenceBlend(patternCompliance, styleMetadataConfidence, 0.32)
        : patternCompliance;
    var sleeveScoreForFinal = hasSleeveIntentForDoc
        ? confidenceBlend(sleeveCompliance, styleMetadataConfidence, 0.28)
        : sleeveCompliance;
    var crossFamilyPenaltyForFinal = hasReliableTypeIntent
        ? crossFamilyPenalty * (0.55 + 0.45 * typeMetadataConfidence)
        : crossFamilyPenalty;
    var crossPenTrace = Math.max(0, crossFamilyPenaltyForFinal);
    var hardBlocked = hasReliableTypeIntent && crossPenTrace >= 0.9;
    var typeGateFactor = !hasReliableTypeIntent
        ? 1
        : productTypeCompliance >= 0.5
            ? 1
            : productTypeCompliance >= 0.2
                ? 0.55
                : 0.18;
    var finalRelevance01 = computeFinalRelevance01({
        hasTypeIntent: hasTypeIntent,
        hasReliableTypeIntent: hasReliableTypeIntent,
        typeScore: typeScoreForFinal,
        catScore: categoryRelevance01,
        semScore: semScore01,
        lexScore: lexScore01,
        colorScore: colorScoreForFinal,
        audScore: audienceCompliance,
        styleScore: styleScoreForFinal,
        patternScore: patternScoreForFinal, // new
        sleeveScore: sleeveScoreForFinal,
        hasColorIntent: hasColorIntentForFinalRelevance,
        hasStyleIntent: Boolean(normalizedDesiredStyle),
        hasPatternIntent: Boolean(normalizedDesiredPattern), // new
        hasSleeveIntent: hasSleeveIntentForDoc,
        hasAudienceIntent: hasAudienceIntent,
        crossFamilyPenalty: crossFamilyPenaltyForFinal,
        intraFamilyPenalty: intraFamilyPenalty,
        applyLexicalToGlobal: lexicalScoreDistinct,
        tightSemanticCap: tightSemanticCap,
    });
    if (categoryConsistencyMultiplier < 1) {
        finalRelevance01 *= categoryConsistencyMultiplier;
    }
    if (garmentVersusBeautyPenalty >= 0.85) {
        finalRelevance01 = Math.min(finalRelevance01, semScore01 * 0.22);
    }
    var productQualityRaw = Number((_28 = hit === null || hit === void 0 ? void 0 : hit._source) === null || _28 === void 0 ? void 0 : _28.product_quality_score);
    var productQuality = Number.isFinite(productQualityRaw) && productQualityRaw >= 0 && productQualityRaw <= 1
        ? productQualityRaw
        : null;
    var qualityModifier = productQuality == null
        ? 1
        : Math.max(0.85, Math.min(1.03, 0.85 + productQuality * 0.18));
    finalRelevance01 = Math.max(0, Math.min(1, finalRelevance01 * qualityModifier));
    // Precision safety for image-led fashion retrieval:
    // when bottoms/footwear color intent is present, mismatched color should not survive
    // as a strong final match even if visual similarity is high.
    var intentBlob = __spreadArray(__spreadArray([
        mergedCategory !== null && mergedCategory !== void 0 ? mergedCategory : ""
    ], (Array.isArray(astCategories) ? astCategories : []), true), (Array.isArray(desiredProductTypes) ? desiredProductTypes : []), true).map(function (x) { return String(x).toLowerCase(); })
        .join(" ");
    var isTopLikeIntent = /\b(top|tops|shirt|shirts|blouse|blouses|tee|t-?shirt|tshirt|tank|camisole|cami|sweater|sweaters|hoodie|hoodies|sweatshirt|sweatshirts|cardigan|cardigans|overshirt|overshirts|polo|polos|loungewear)\b/.test(intentBlob);
    var isBottomLikeIntent = /\b(bottom|bottoms|pants?|trousers?|jeans?|shorts|bermudas?|skirt|skirts|leggings?)\b/.test(intentBlob);
    var isFootwearLikeIntent = /\b(footwear|shoe|shoes|sneaker|sneakers|boot|boots|loafer|loafers|heel|heels|sandal|sandals)\b/.test(intentBlob);
    // Detect explicit suit queries and relax color gating so coordinated
    // trousers/dress-pants and shoes surface alongside jackets.
    var suitIntent = /\b(suit|suits|two[-\s]?piece|three[-\s]?piece|matching\s*suit)\b/.test(intentBlob);
    if (hasColorIntentForFinalRelevance && (isTopLikeIntent || isBottomLikeIntent || isFootwearLikeIntent)) {
        var suitRelax = suitIntent;
        var noneTierLimit = suitRelax ? (isBottomLikeIntent ? 0.16 : isTopLikeIntent ? 0.18 : 0.12) : (isBottomLikeIntent ? 0.06 : isTopLikeIntent ? 0.08 : 0.08);
        var lowComplianceLimit = suitRelax ? (isBottomLikeIntent ? 0.2 : isTopLikeIntent ? 0.22 : 0.18) : (isBottomLikeIntent ? 0.1 : isTopLikeIntent ? 0.12 : 0.12);
        var bucketLimit = suitRelax ? (isBottomLikeIntent ? 0.5 : 0.56) : (isBottomLikeIntent ? 0.32 : 0.36);
        // Shade tiers (light-shade, dark-shade) get slightly higher cap than bucket but lower than family
        var shadeLimit = bucketLimit + 0.08;
        if (colorTier === "none") {
            finalRelevance01 = Math.min(finalRelevance01, noneTierLimit);
        }
        else if (colorCompliance < 0.2) {
            finalRelevance01 = Math.min(finalRelevance01, lowComplianceLimit);
        }
        else if ((isBottomLikeIntent || isTopLikeIntent) && colorTier === "bucket") {
            finalRelevance01 = Math.min(finalRelevance01, bucketLimit);
        }
        else if ((isBottomLikeIntent || isTopLikeIntent) && (colorTier === "light-shade" || colorTier === "dark-shade")) {
            finalRelevance01 = Math.min(finalRelevance01, shadeLimit);
        }
    }
    var negationBlocked = false;
    if (negationExcludeTerms && negationExcludeTerms.length > 0) {
        var desc = typeof src.description === "string" ? src.description : "";
        var blob_1 = [src.title, src.category, src.brand, desc]
            .filter(function (x) { return x != null && String(x).trim() !== ""; })
            .join(" ")
            .toLowerCase();
        negationBlocked = negationExcludeTerms.some(function (term) {
            var t = String(term).toLowerCase().trim();
            return t.length >= 2 && blob_1.includes(t);
        });
        if (negationBlocked) {
            finalRelevance01 = 0;
        }
    }
    if (!negationBlocked && enforcePromptConstraints) {
        if (promptAnchoredColorIntent && hasColorIntent && colorTier === "none") {
            finalRelevance01 = Math.min(finalRelevance01, 0.03);
        }
        if (promptAnchoredTypeIntent && hasTypeIntent && productTypeCompliance < 0.3) {
            finalRelevance01 = Math.min(finalRelevance01, 0.04);
        }
    }
    // Hard filter: when the user is searching for "short" (sleeve/shorts intent)
    // but did NOT ask for swimwear, exclude swimwear listings completely.
    var swimBlocked = false;
    try {
        var swimRegex_1 = /\b(swim|swimwear|swimsuit|bikini|one[-\s]?piece|tankini|trunks|boardshorts?|board[-\s]?shorts?|swimshorts?|swim[-\s]?short|bottom[-\s]?sw|suit[-\s]?sw|beach\s*wear|beachwear)\b/;
        var docBlobForSwim = __spreadArray([src.category, src.category_canonical, src.title], (Array.isArray(productTypes) ? productTypes : []), true).filter(Boolean)
            .join(" ")
            .toLowerCase();
        var docIsSwim = swimRegex_1.test(docBlobForSwim);
        var userAskedSwim = Boolean((mergedCategory && swimRegex_1.test(String(mergedCategory).toLowerCase())) ||
            (Array.isArray(astCategories) && astCategories.some(function (c) { return swimRegex_1.test(String(c).toLowerCase()); })) ||
            (Array.isArray(desiredProductTypes) && desiredProductTypes.some(function (t) { return swimRegex_1.test(String(t).toLowerCase()); })) ||
            (String(lexicalMatchQuery !== null && lexicalMatchQuery !== void 0 ? lexicalMatchQuery : "").toLowerCase().includes("swim")));
        var userSearchingShort = Boolean(wantedSleeve === "short" || /\bshorts?\b/.test(String(lexicalMatchQuery !== null && lexicalMatchQuery !== void 0 ? lexicalMatchQuery : "").toLowerCase()) || (Array.isArray(desiredProductTypes) && desiredProductTypes.some(function (t) { return /shorts?/.test(String(t).toLowerCase()); })));
        if (userSearchingShort && docIsSwim && !userAskedSwim) {
            finalRelevance01 = 0;
            swimBlocked = true;
        }
    }
    catch (e) {
        // Non-fatal: if anything goes wrong, don't crash relevance computation.
        swimBlocked = false;
    }
    return {
        productTypeCompliance: productTypeCompliance,
        exactTypeScore: exactTypeScore,
        siblingClusterScore: siblingClusterScore,
        parentHypernymScore: parentHypernymScore,
        intraFamilyPenalty: intraFamilyPenalty,
        colorCompliance: colorCompliance,
        matchedColor: matchedColor,
        colorTier: colorTier,
        crossFamilyPenalty: crossFamilyPenalty,
        audienceCompliance: audienceCompliance,
        styleCompliance: styleCompliance,
        sleeveCompliance: sleeveCompliance,
        osSimilarity01: similarity,
        categoryRelevance01: categoryRelevance01,
        semanticScore01: semScore01,
        lexicalScore01: lexScore01,
        rerankScore: rerankScore,
        finalRelevance01: finalRelevance01,
        visualComponent: visualComponent,
        typeComponent: typeComponent,
        attrComponent: attrComponent,
        penaltyComponent: penaltyComponent,
        primaryColor: primaryColor,
        hasTypeIntent: hasTypeIntent,
        hasColorIntent: hasColorIntentForFinalRelevance,
        hasSleeveIntent: hasSleeveIntentForDoc,
        hasAudienceIntent: hasAudienceIntent,
        typeGateFactor: typeGateFactor,
        hardBlocked: hardBlocked || negationBlocked || swimBlocked,
        // swimBlocked: true when a swimwear hit was zeroed due to short/shorts intent
        // without explicit swim intent from the user.
        // Included in `hardBlocked` above via `swimBlocked` variable.
        lexicalScoreDistinct: lexicalScoreDistinct,
    };
}
