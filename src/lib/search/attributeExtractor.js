"use strict";
/**
 * Attribute Extraction Service
 *
 * Production-grade title attribute extraction:
 * 1. Rule-based extraction (fast path) - handles ~90% of cases
 * 2. ML fallback (zero-shot) - handles edge cases
 * 3. Caching layer - prevents reprocessing
 *
 * Extracts: color, material, fit, style, gender, size
 */
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeTitle = normalizeTitle;
exports.hashTitle = hashTitle;
exports.extractWithRules = extractWithRules;
exports.getCached = getCached;
exports.setCache = setCache;
exports.clearCache = clearCache;
exports.getCacheStats = getCacheStats;
exports.extractAttributes = extractAttributes;
exports.extractAttributesSync = extractAttributesSync;
exports.extractAttributesBatch = extractAttributesBatch;
exports.getKnownColors = getKnownColors;
exports.getKnownMaterials = getKnownMaterials;
exports.getKnownFits = getKnownFits;
exports.validateAttributes = validateAttributes;
var crypto_1 = require("crypto");
// Current extractor version - bump when dictionaries/logic changes
var EXTRACTOR_VERSION = "1.0.0";
// ============================================================================
// Phrase Dictionaries (longest match first ordering)
// ============================================================================
// Colors - ordered by phrase length (longest first for greedy matching)
var COLOR_PHRASES = [
    // Multi-word colors first
    ["off white", "off-white"],
    ["dusty pink", "dusty-pink"],
    ["dusty rose", "dusty-rose"],
    ["baby blue", "baby-blue"],
    ["sky blue", "sky-blue"],
    ["royal blue", "royal-blue"],
    ["navy blue", "navy"],
    ["light blue", "light-blue"],
    ["dark blue", "dark-blue"],
    ["powder blue", "powder-blue"],
    ["cobalt blue", "cobalt"],
    ["midnight blue", "midnight-blue"],
    ["light grey", "light-gray"],
    ["light gray", "light-gray"],
    ["dark grey", "dark-gray"],
    ["dark gray", "dark-gray"],
    ["charcoal grey", "charcoal"],
    ["charcoal gray", "charcoal"],
    ["heather grey", "heather-gray"],
    ["heather gray", "heather-gray"],
    ["army green", "army-green"],
    ["olive green", "olive"],
    ["forest green", "forest-green"],
    ["mint green", "mint"],
    ["lime green", "lime"],
    ["hunter green", "hunter-green"],
    ["hot pink", "hot-pink"],
    ["light pink", "light-pink"],
    ["blush pink", "blush"],
    ["burnt orange", "burnt-orange"],
    ["rust orange", "rust"],
    ["wine red", "wine"],
    ["cherry red", "cherry"],
    ["burgundy red", "burgundy"],
    ["bright red", "bright-red"],
    ["dark red", "dark-red"],
    ["mustard yellow", "mustard"],
    ["pale yellow", "pale-yellow"],
    ["multi color", "multicolor"],
    ["multi colour", "multicolor"],
    ["multicolor", "multicolor"],
    ["multicolour", "multicolor"],
    // Single-word colors
    ["black", "black"],
    ["white", "white"],
    ["red", "red"],
    ["blue", "blue"],
    ["green", "green"],
    ["yellow", "yellow"],
    ["orange", "orange"],
    ["pink", "pink"],
    ["purple", "purple"],
    ["violet", "violet"],
    ["brown", "brown"],
    ["beige", "beige"],
    ["tan", "tan"],
    ["cream", "cream"],
    ["ivory", "ivory"],
    ["grey", "gray"],
    ["gray", "gray"],
    ["charcoal", "charcoal"],
    ["navy", "navy"],
    ["teal", "teal"],
    ["turquoise", "turquoise"],
    ["cyan", "cyan"],
    ["aqua", "aqua"],
    ["coral", "coral"],
    ["peach", "peach"],
    ["salmon", "salmon"],
    ["burgundy", "burgundy"],
    ["maroon", "maroon"],
    ["wine", "wine"],
    ["plum", "plum"],
    ["lavender", "lavender"],
    ["lilac", "lilac"],
    ["mauve", "mauve"],
    ["fuchsia", "fuchsia"],
    ["magenta", "magenta"],
    ["olive", "olive"],
    ["khaki", "khaki"],
    ["sage", "sage"],
    ["mint", "mint"],
    ["emerald", "emerald"],
    ["jade", "jade"],
    ["rust", "rust"],
    ["copper", "copper"],
    ["bronze", "bronze"],
    ["gold", "gold"],
    ["golden", "gold"],
    ["silver", "silver"],
    ["metallic", "metallic"],
    ["nude", "nude"],
    ["camel", "camel"],
    ["chocolate", "chocolate"],
    ["espresso", "espresso"],
    ["taupe", "taupe"],
    ["mocha", "mocha"],
    ["sand", "sand"],
    ["stone", "stone"],
    ["ash", "ash"],
    ["slate", "slate"],
    ["indigo", "indigo"],
    ["cobalt", "cobalt"],
    ["denim", "denim-blue"], // Color context
    ["neon", "neon"],
    ["pastel", "pastel"],
];
// Materials - ordered by phrase length
var MATERIAL_PHRASES = [
    // Multi-word materials first
    ["faux leather", "faux-leather"],
    ["vegan leather", "vegan-leather"],
    ["genuine leather", "genuine-leather"],
    ["full grain leather", "full-grain-leather"],
    ["patent leather", "patent-leather"],
    ["suede leather", "suede"],
    ["organic cotton", "organic-cotton"],
    ["pima cotton", "pima-cotton"],
    ["egyptian cotton", "egyptian-cotton"],
    ["cotton blend", "cotton-blend"],
    ["cotton linen", "cotton-linen"],
    ["cotton polyester", "cotton-poly-blend"],
    ["merino wool", "merino-wool"],
    ["virgin wool", "virgin-wool"],
    ["wool blend", "wool-blend"],
    ["cashmere blend", "cashmere-blend"],
    ["silk blend", "silk-blend"],
    ["linen blend", "linen-blend"],
    ["french terry", "french-terry"],
    ["fleece lined", "fleece-lined"],
    ["sherpa lined", "sherpa-lined"],
    ["faux fur", "faux-fur"],
    ["teddy fleece", "teddy-fleece"],
    ["stretch denim", "stretch-denim"],
    ["raw denim", "raw-denim"],
    ["selvedge denim", "selvedge-denim"],
    ["ponte knit", "ponte"],
    ["ribbed knit", "ribbed-knit"],
    ["cable knit", "cable-knit"],
    ["waffle knit", "waffle-knit"],
    ["jersey knit", "jersey"],
    ["tech fleece", "tech-fleece"],
    ["moisture wicking", "moisture-wicking"],
    ["quick dry", "quick-dry"],
    // Single-word materials
    ["cotton", "cotton"],
    ["polyester", "polyester"],
    ["nylon", "nylon"],
    ["spandex", "spandex"],
    ["elastane", "elastane"],
    ["lycra", "lycra"],
    ["rayon", "rayon"],
    ["viscose", "viscose"],
    ["modal", "modal"],
    ["tencel", "tencel"],
    ["lyocell", "lyocell"],
    ["bamboo", "bamboo"],
    ["linen", "linen"],
    ["hemp", "hemp"],
    ["silk", "silk"],
    ["satin", "satin"],
    ["chiffon", "chiffon"],
    ["velvet", "velvet"],
    ["velour", "velour"],
    ["corduroy", "corduroy"],
    ["tweed", "tweed"],
    ["twill", "twill"],
    ["flannel", "flannel"],
    ["chambray", "chambray"],
    ["poplin", "poplin"],
    ["oxford", "oxford"],
    ["canvas", "canvas"],
    ["denim", "denim"],
    ["leather", "leather"],
    ["suede", "suede"],
    ["wool", "wool"],
    ["cashmere", "cashmere"],
    ["mohair", "mohair"],
    ["angora", "angora"],
    ["alpaca", "alpaca"],
    ["fleece", "fleece"],
    ["terry", "terry"],
    ["mesh", "mesh"],
    ["lace", "lace"],
    ["crochet", "crochet"],
    ["knit", "knit"],
    ["woven", "woven"],
    ["jersey", "jersey"],
    ["ponte", "ponte"],
    ["scuba", "scuba"],
    ["neoprene", "neoprene"],
    ["sequin", "sequin"],
    ["sequins", "sequin"],
    ["beaded", "beaded"],
    ["embroidered", "embroidered"],
];
// Fit types - ordered by phrase length
var FIT_PHRASES = [
    // Multi-word fits first
    ["slim fit", "slim"],
    ["skinny fit", "skinny"],
    ["regular fit", "regular"],
    ["relaxed fit", "relaxed"],
    ["loose fit", "loose"],
    ["tailored fit", "tailored"],
    ["athletic fit", "athletic"],
    ["classic fit", "classic"],
    ["modern fit", "modern"],
    ["comfort fit", "comfort"],
    ["straight fit", "straight"],
    ["tapered fit", "tapered"],
    ["wide leg", "wide-leg"],
    ["flare leg", "flare"],
    ["bootcut", "bootcut"],
    ["boyfriend fit", "boyfriend"],
    ["girlfriend fit", "girlfriend"],
    ["mom fit", "mom"],
    ["dad fit", "dad"],
    ["cropped fit", "cropped"],
    ["longline", "longline"],
    ["oversized fit", "oversized"],
    ["boxy fit", "boxy"],
    ["fitted", "fitted"],
    ["form fitting", "form-fitting"],
    ["body con", "bodycon"],
    ["a line", "a-line"],
    // Single-word fits
    ["slim", "slim"],
    ["skinny", "skinny"],
    ["regular", "regular"],
    ["relaxed", "relaxed"],
    ["loose", "loose"],
    ["oversized", "oversized"],
    ["boxy", "boxy"],
    ["fitted", "fitted"],
    ["tailored", "tailored"],
    ["cropped", "cropped"],
    ["longline", "longline"],
    ["petite", "petite"],
    ["tall", "tall"],
    ["plus", "plus-size"],
    ["curvy", "curvy"],
    ["maternity", "maternity"],
    ["stretch", "stretch"],
    ["structured", "structured"],
    ["unstructured", "unstructured"],
    ["bodycon", "bodycon"],
    ["flowy", "flowy"],
    ["draped", "draped"],
];
// Style/occasion
var STYLE_PHRASES = [
    ["business casual", "business-casual"],
    ["smart casual", "smart-casual"],
    ["semi formal", "semi-formal"],
    ["black tie", "black-tie"],
    ["street style", "streetwear"],
    ["athleisure", "athleisure"],
    ["work wear", "workwear"],
    ["active wear", "activewear"],
    ["swim wear", "swimwear"],
    ["beach wear", "beachwear"],
    ["lounge wear", "loungewear"],
    ["sleep wear", "sleepwear"],
    ["night wear", "nightwear"],
    ["casual", "casual"],
    ["formal", "formal"],
    ["elegant", "elegant"],
    ["vintage", "vintage"],
    ["retro", "retro"],
    ["classic", "classic"],
    ["modern", "modern"],
    ["minimalist", "minimalist"],
    ["bohemian", "bohemian"],
    ["boho", "bohemian"],
    ["preppy", "preppy"],
    ["sporty", "sporty"],
    ["athletic", "athletic"],
    ["edgy", "edgy"],
    ["grunge", "grunge"],
    ["punk", "punk"],
    ["gothic", "gothic"],
    ["romantic", "romantic"],
    ["feminine", "feminine"],
    ["masculine", "masculine"],
    ["androgynous", "androgynous"],
    ["unisex", "unisex"],
    ["streetwear", "streetwear"],
    ["workwear", "workwear"],
    ["activewear", "activewear"],
    ["loungewear", "loungewear"],
    ["luxury", "luxury"],
    ["designer", "designer"],
    ["basic", "basic"],
    ["essential", "essential"],
    ["statement", "statement"],
    ["trendy", "trendy"],
    ["timeless", "timeless"],
];
// Gender
var GENDER_PHRASES = [
    ["women", "women"],
    ["women's", "women"],
    ["womens", "women"],
    ["woman's", "women"],
    ["ladies", "women"],
    ["lady's", "women"],
    ["female", "women"],
    ["men", "men"],
    ["men's", "men"],
    ["mens", "men"],
    ["man's", "men"],
    ["gentleman's", "men"],
    ["male", "men"],
    ["boys", "boys"],
    ["boy's", "boys"],
    ["girls", "girls"],
    ["girl's", "girls"],
    ["kids", "kids"],
    ["kid's", "kids"],
    ["children's", "kids"],
    ["childrens", "kids"],
    ["toddler", "toddler"],
    ["infant", "infant"],
    ["baby", "baby"],
    ["unisex", "unisex"],
    ["gender neutral", "unisex"],
];
// Patterns
var PATTERN_PHRASES = [
    ["polka dot", "polka-dot"],
    ["polka dots", "polka-dot"],
    ["pin stripe", "pinstripe"],
    ["pinstripe", "pinstripe"],
    ["pinstriped", "pinstripe"],
    ["chalk stripe", "chalk-stripe"],
    ["candy stripe", "candy-stripe"],
    ["color block", "colorblock"],
    ["colour block", "colorblock"],
    ["colorblock", "colorblock"],
    ["tie dye", "tie-dye"],
    ["tie dyed", "tie-dye"],
    ["animal print", "animal-print"],
    ["leopard print", "leopard"],
    ["zebra print", "zebra"],
    ["snake print", "snakeskin"],
    ["snakeskin", "snakeskin"],
    ["crocodile", "crocodile"],
    ["camo", "camo"],
    ["camouflage", "camo"],
    ["tropical", "tropical"],
    ["floral", "floral"],
    ["paisley", "paisley"],
    ["geometric", "geometric"],
    ["abstract", "abstract"],
    ["graphic", "graphic"],
    ["logo", "logo"],
    ["branded", "branded"],
    ["solid", "solid"],
    ["plain", "solid"],
    ["striped", "striped"],
    ["stripes", "striped"],
    ["stripe", "striped"],
    ["checked", "checked"],
    ["check", "checked"],
    ["checkered", "checked"],
    ["plaid", "plaid"],
    ["tartan", "tartan"],
    ["gingham", "gingham"],
    ["houndstooth", "houndstooth"],
    ["herringbone", "herringbone"],
    ["argyle", "argyle"],
    ["fair isle", "fair-isle"],
    ["nordic", "nordic"],
    ["aztec", "aztec"],
    ["tribal", "tribal"],
    ["ikat", "ikat"],
    ["batik", "batik"],
    ["embossed", "embossed"],
    ["quilted", "quilted"],
    ["ribbed", "ribbed"],
    ["textured", "textured"],
    ["distressed", "distressed"],
    ["washed", "washed"],
    ["faded", "faded"],
    ["acid wash", "acid-wash"],
    ["stone wash", "stone-wash"],
    ["ombre", "ombre"],
    ["gradient", "gradient"],
    ["printed", "printed"],
    ["print", "print"],
];
// Sleeve types
var SLEEVE_PHRASES = [
    ["long sleeve", "long-sleeve"],
    ["long sleeved", "long-sleeve"],
    ["short sleeve", "short-sleeve"],
    ["short sleeved", "short-sleeve"],
    ["three quarter sleeve", "3/4-sleeve"],
    ["3/4 sleeve", "3/4-sleeve"],
    ["half sleeve", "half-sleeve"],
    ["cap sleeve", "cap-sleeve"],
    ["flutter sleeve", "flutter-sleeve"],
    ["bell sleeve", "bell-sleeve"],
    ["puff sleeve", "puff-sleeve"],
    ["bishop sleeve", "bishop-sleeve"],
    ["balloon sleeve", "balloon-sleeve"],
    ["dolman sleeve", "dolman-sleeve"],
    ["batwing sleeve", "batwing-sleeve"],
    ["raglan sleeve", "raglan-sleeve"],
    ["set in sleeve", "set-in-sleeve"],
    ["sleeveless", "sleeveless"],
    ["strapless", "strapless"],
    ["spaghetti strap", "spaghetti-strap"],
    ["tank", "tank"],
    ["halter", "halter"],
    ["one shoulder", "one-shoulder"],
    ["off shoulder", "off-shoulder"],
    ["cold shoulder", "cold-shoulder"],
];
// Necklines
var NECKLINE_PHRASES = [
    ["crew neck", "crew-neck"],
    ["crewneck", "crew-neck"],
    ["round neck", "round-neck"],
    ["v neck", "v-neck"],
    ["vneck", "v-neck"],
    ["deep v", "deep-v"],
    ["scoop neck", "scoop-neck"],
    ["boat neck", "boat-neck"],
    ["bateau neck", "boat-neck"],
    ["square neck", "square-neck"],
    ["sweetheart", "sweetheart"],
    ["cowl neck", "cowl-neck"],
    ["turtle neck", "turtleneck"],
    ["turtleneck", "turtleneck"],
    ["mock neck", "mock-neck"],
    ["mock turtle", "mock-neck"],
    ["high neck", "high-neck"],
    ["funnel neck", "funnel-neck"],
    ["polo collar", "polo-collar"],
    ["mandarin collar", "mandarin-collar"],
    ["band collar", "band-collar"],
    ["collared", "collared"],
    ["collarless", "collarless"],
    ["hooded", "hooded"],
    ["hood", "hooded"],
    ["henley", "henley"],
    ["keyhole", "keyhole"],
    ["plunge", "plunge"],
    ["asymmetric", "asymmetric"],
];
// ============================================================================
// Normalization
// ============================================================================
/**
 * Normalize title for consistent matching
 * - lowercase
 * - remove punctuation (keep hyphens and apostrophes temporarily)
 * - collapse multiple spaces
 */
function normalizeTitle(title) {
    return title
        .toLowerCase()
        .replace(/[^\w\s'-]/g, " ") // Remove punctuation except hyphen/apostrophe
        .replace(/'/g, "") // Remove apostrophes (women's -> womens)
        .replace(/-/g, " ") // Replace hyphens with space (t-shirt -> t shirt)
        .replace(/\s+/g, " ") // Collapse spaces
        .trim();
}
/**
 * Generate hash for caching
 */
function hashTitle(normalizedTitle) {
    return crypto_1.default.createHash("sha256").update(normalizedTitle).digest("hex").slice(0, 16);
}
// ============================================================================
// Rule-Based Extraction (Fast Path)
// ============================================================================
/**
 * Extract phrase from text using word boundary matching
 * Returns normalized value and remaining text
 */
function extractPhrase(text, phrases) {
    for (var _i = 0, phrases_1 = phrases; _i < phrases_1.length; _i++) {
        var _a = phrases_1[_i], phrase = _a[0], normalized = _a[1];
        // Build regex with word boundaries
        var escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        var regex = new RegExp("\\b".concat(escaped, "\\b"), "i");
        var match = text.match(regex);
        if (match) {
            // Remove matched phrase from text
            var remaining = text.replace(regex, " ").replace(/\s+/g, " ").trim();
            return { value: normalized, remaining: remaining, confidence: 1.0 };
        }
    }
    return { value: null, remaining: text, confidence: 0 };
}
/**
 * Extract all matching phrases (for colors, materials with multiple values)
 */
function extractAllPhrases(text, phrases) {
    var values = [];
    var remaining = text;
    for (var _i = 0, phrases_2 = phrases; _i < phrases_2.length; _i++) {
        var _a = phrases_2[_i], phrase = _a[0], normalized = _a[1];
        var escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        var regex = new RegExp("\\b".concat(escaped, "\\b"), "i");
        if (remaining.match(regex)) {
            if (!values.includes(normalized)) {
                values.push(normalized);
            }
            remaining = remaining.replace(regex, " ").replace(/\s+/g, " ").trim();
        }
    }
    return { values: values, confidence: values.length > 0 ? 1.0 : 0 };
}
/**
 * Rule-based attribute extraction
 */
function extractWithRules(normalizedTitle) {
    var attributes = {};
    var confidence = {};
    var text = normalizedTitle;
    // Extract colors (can have multiple)
    var colorResult = extractAllPhrases(text, COLOR_PHRASES);
    if (colorResult.values.length > 0) {
        attributes.color = colorResult.values[0];
        attributes.colors = colorResult.values;
        confidence.color = colorResult.confidence;
    }
    // Extract materials (can have multiple)
    var materialResult = extractAllPhrases(text, MATERIAL_PHRASES);
    if (materialResult.values.length > 0) {
        attributes.material = materialResult.values[0];
        attributes.materials = materialResult.values;
        confidence.material = materialResult.confidence;
    }
    // Extract fit
    var fitResult = extractPhrase(text, FIT_PHRASES);
    if (fitResult.value) {
        attributes.fit = fitResult.value;
        confidence.fit = fitResult.confidence;
        text = fitResult.remaining;
    }
    // Extract style
    var styleResult = extractPhrase(text, STYLE_PHRASES);
    if (styleResult.value) {
        attributes.style = styleResult.value;
        confidence.style = styleResult.confidence;
        text = styleResult.remaining;
    }
    // Extract gender
    var genderResult = extractPhrase(text, GENDER_PHRASES);
    if (genderResult.value) {
        attributes.gender = genderResult.value;
        confidence.gender = genderResult.confidence;
        text = genderResult.remaining;
    }
    // Extract pattern
    var patternResult = extractPhrase(text, PATTERN_PHRASES);
    if (patternResult.value) {
        attributes.pattern = patternResult.value;
        confidence.pattern = patternResult.confidence;
        text = patternResult.remaining;
    }
    // Extract sleeve
    var sleeveResult = extractPhrase(text, SLEEVE_PHRASES);
    if (sleeveResult.value) {
        attributes.sleeve = sleeveResult.value;
        confidence.sleeve = sleeveResult.confidence;
        text = sleeveResult.remaining;
    }
    // Extract neckline
    var necklineResult = extractPhrase(text, NECKLINE_PHRASES);
    if (necklineResult.value) {
        attributes.neckline = necklineResult.value;
        confidence.neckline = necklineResult.confidence;
    }
    return { attributes: attributes, confidence: confidence };
}
// ============================================================================
// ML Fallback (Zero-Shot Classification)
// ============================================================================
var pipeline = null;
var mlInitialized = false;
var mlInitPromise = null;
/**
 * Initialize ML pipeline (lazy loading)
 */
function initML() {
    return __awaiter(this, void 0, void 0, function () {
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (mlInitialized)
                        return [2 /*return*/, pipeline !== null];
                    if (!mlInitPromise) return [3 /*break*/, 2];
                    return [4 /*yield*/, mlInitPromise];
                case 1:
                    _a.sent();
                    return [2 /*return*/, pipeline !== null];
                case 2:
                    mlInitPromise = (function () { return __awaiter(_this, void 0, void 0, function () {
                        return __generator(this, function (_a) {
                            // @xenova/transformers bundles onnxruntime-web which conflicts with
                            // onnxruntime-node at runtime (registers an incompatible backend and
                            // causes "TypeError: not a valid backend" globally). The ML zero-shot
                            // classifier is a nice-to-have fallback — disable it to keep the ONNX
                            // runtime healthy for CLIP and BLIP.
                            console.warn("[attributeExtractor] ML pipeline disabled — @xenova/transformers conflicts with onnxruntime-node");
                            mlInitialized = true;
                            pipeline = null;
                            return [2 /*return*/];
                        });
                    }); })();
                    return [4 /*yield*/, mlInitPromise];
                case 3:
                    _a.sent();
                    return [2 /*return*/, pipeline !== null];
            }
        });
    });
}
// Label sets for zero-shot classification
var COLOR_LABELS = ["black", "white", "red", "blue", "green", "yellow", "pink", "purple", "brown", "gray", "beige", "navy", "orange"];
var MATERIAL_LABELS = ["cotton", "polyester", "leather", "denim", "wool", "silk", "linen", "nylon", "synthetic", "knit"];
var FIT_LABELS = ["slim fit", "regular fit", "loose fit", "oversized", "fitted", "relaxed"];
/**
 * Extract attributes using ML (zero-shot classification)
 */
function extractWithML(normalizedTitle_1, missingAttributes_1) {
    return __awaiter(this, arguments, void 0, function (normalizedTitle, missingAttributes, threshold) {
        var attributes, confidence, mlAvailable, result, result, result, err_1;
        if (threshold === void 0) { threshold = 0.7; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    attributes = {};
                    confidence = {};
                    return [4 /*yield*/, initML()];
                case 1:
                    mlAvailable = _a.sent();
                    if (!mlAvailable || !pipeline) {
                        return [2 /*return*/, { attributes: attributes, confidence: confidence }];
                    }
                    _a.label = 2;
                case 2:
                    _a.trys.push([2, 9, , 10]);
                    if (!missingAttributes.includes("color")) return [3 /*break*/, 4];
                    return [4 /*yield*/, pipeline(normalizedTitle, COLOR_LABELS, {
                            multi_label: false,
                        })];
                case 3:
                    result = _a.sent();
                    if (result.scores[0] >= threshold) {
                        attributes.color = result.labels[0];
                        confidence.color = result.scores[0];
                    }
                    _a.label = 4;
                case 4:
                    if (!missingAttributes.includes("material")) return [3 /*break*/, 6];
                    return [4 /*yield*/, pipeline(normalizedTitle, MATERIAL_LABELS, {
                            multi_label: false,
                        })];
                case 5:
                    result = _a.sent();
                    if (result.scores[0] >= threshold) {
                        attributes.material = result.labels[0];
                        confidence.material = result.scores[0];
                    }
                    _a.label = 6;
                case 6:
                    if (!missingAttributes.includes("fit")) return [3 /*break*/, 8];
                    return [4 /*yield*/, pipeline(normalizedTitle, FIT_LABELS, {
                            multi_label: false,
                        })];
                case 7:
                    result = _a.sent();
                    if (result.scores[0] >= threshold) {
                        attributes.fit = result.labels[0].replace(" fit", "");
                        confidence.fit = result.scores[0];
                    }
                    _a.label = 8;
                case 8: return [3 /*break*/, 10];
                case 9:
                    err_1 = _a.sent();
                    console.warn("ML extraction failed:", err_1);
                    return [3 /*break*/, 10];
                case 10: return [2 /*return*/, { attributes: attributes, confidence: confidence }];
            }
        });
    });
}
// ============================================================================
// Caching Layer
// ============================================================================
// In-memory cache (replace with Redis/DB for production at scale)
var extractionCache = new Map();
var CACHE_MAX_SIZE = 10000;
/**
 * Get cached extraction result
 */
function getCached(hash) {
    var cached = extractionCache.get(hash);
    if (cached && cached.version === EXTRACTOR_VERSION) {
        return cached;
    }
    return null;
}
/**
 * Cache extraction result
 */
function setCache(hash, result) {
    // Simple LRU-like eviction
    if (extractionCache.size >= CACHE_MAX_SIZE) {
        var firstKey = extractionCache.keys().next().value;
        if (firstKey)
            extractionCache.delete(firstKey);
    }
    extractionCache.set(hash, result);
}
/**
 * Clear cache (useful when dictionaries are updated)
 */
function clearCache() {
    extractionCache.clear();
}
/**
 * Get cache stats
 */
function getCacheStats() {
    return {
        size: extractionCache.size,
        maxSize: CACHE_MAX_SIZE,
        version: EXTRACTOR_VERSION,
    };
}
// ============================================================================
// Main Extraction Function
// ============================================================================
/**
 * Extract attributes from product title
 *
 * 1. Normalize and hash title
 * 2. Check cache
 * 3. Run rule-based extraction (fast path)
 * 4. If core attributes missing, run ML fallback
 * 5. Cache and return result
 */
function extractAttributes(title_1) {
    return __awaiter(this, arguments, void 0, function (title, options) {
        var _a, useML, _b, mlThreshold, normalizedTitle, hash, cached, _c, attributes, confidence, extractor, missingAttributes, mlResult, result;
        if (options === void 0) { options = {}; }
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    _a = options.useML, useML = _a === void 0 ? true : _a, _b = options.mlThreshold, mlThreshold = _b === void 0 ? 0.7 : _b;
                    normalizedTitle = normalizeTitle(title);
                    hash = hashTitle(normalizedTitle);
                    cached = getCached(hash);
                    if (cached) {
                        return [2 /*return*/, cached];
                    }
                    _c = extractWithRules(normalizedTitle), attributes = _c.attributes, confidence = _c.confidence;
                    extractor = "rules";
                    if (!useML) return [3 /*break*/, 2];
                    missingAttributes = [];
                    if (!attributes.color)
                        missingAttributes.push("color");
                    if (!attributes.material)
                        missingAttributes.push("material");
                    if (!attributes.fit)
                        missingAttributes.push("fit");
                    if (!(missingAttributes.length > 0)) return [3 /*break*/, 2];
                    return [4 /*yield*/, extractWithML(normalizedTitle, missingAttributes, mlThreshold)];
                case 1:
                    mlResult = _d.sent();
                    // Merge ML results
                    if (Object.keys(mlResult.attributes).length > 0) {
                        extractor = "hybrid";
                        Object.assign(attributes, mlResult.attributes);
                        Object.assign(confidence, mlResult.confidence);
                    }
                    _d.label = 2;
                case 2:
                    result = {
                        attributes: attributes,
                        confidence: confidence,
                        extractor: extractor,
                        version: EXTRACTOR_VERSION,
                        normalized_title: normalizedTitle,
                        hash: hash,
                    };
                    // Cache result
                    setCache(hash, result);
                    return [2 /*return*/, result];
            }
        });
    });
}
/**
 * Synchronous rule-only extraction (for high-throughput indexing)
 * Skips ML fallback and caching overhead
 */
function extractAttributesSync(title) {
    var normalizedTitle = normalizeTitle(title);
    var hash = hashTitle(normalizedTitle);
    // Check cache first
    var cached = getCached(hash);
    if (cached) {
        return {
            attributes: cached.attributes,
            confidence: cached.confidence,
            normalized_title: cached.normalized_title,
            hash: cached.hash,
        };
    }
    var _a = extractWithRules(normalizedTitle), attributes = _a.attributes, confidence = _a.confidence;
    // Cache for future use
    setCache(hash, {
        attributes: attributes,
        confidence: confidence,
        extractor: "rules",
        version: EXTRACTOR_VERSION,
        normalized_title: normalizedTitle,
        hash: hash,
    });
    return { attributes: attributes, confidence: confidence, normalized_title: normalizedTitle, hash: hash };
}
/**
 * Batch extraction for indexing (rules-only, high throughput)
 */
function extractAttributesBatch(titles) {
    var results = new Map();
    for (var _i = 0, titles_1 = titles; _i < titles_1.length; _i++) {
        var title = titles_1[_i];
        var _a = extractAttributesSync(title), attributes = _a.attributes, confidence = _a.confidence, hash = _a.hash;
        results.set(hash, { attributes: attributes, confidence: confidence, title: title });
    }
    return results;
}
// ============================================================================
// Utility Functions
// ============================================================================
/**
 * Get all known colors (for facets)
 */
function getKnownColors() {
    var colors = new Set();
    for (var _i = 0, COLOR_PHRASES_1 = COLOR_PHRASES; _i < COLOR_PHRASES_1.length; _i++) {
        var _a = COLOR_PHRASES_1[_i], normalized = _a[1];
        colors.add(normalized);
    }
    return Array.from(colors).sort();
}
/**
 * Get all known materials (for facets)
 */
function getKnownMaterials() {
    var materials = new Set();
    for (var _i = 0, MATERIAL_PHRASES_1 = MATERIAL_PHRASES; _i < MATERIAL_PHRASES_1.length; _i++) {
        var _a = MATERIAL_PHRASES_1[_i], normalized = _a[1];
        materials.add(normalized);
    }
    return Array.from(materials).sort();
}
/**
 * Get all known fits (for facets)
 */
function getKnownFits() {
    var fits = new Set();
    for (var _i = 0, FIT_PHRASES_1 = FIT_PHRASES; _i < FIT_PHRASES_1.length; _i++) {
        var _a = FIT_PHRASES_1[_i], normalized = _a[1];
        fits.add(normalized);
    }
    return Array.from(fits).sort();
}
/**
 * Validate extracted attributes against known values
 */
function validateAttributes(attrs) {
    var warnings = [];
    var knownColors = new Set(getKnownColors());
    var knownMaterials = new Set(getKnownMaterials());
    var knownFits = new Set(getKnownFits());
    if (attrs.color && !knownColors.has(attrs.color)) {
        warnings.push("Unknown color: ".concat(attrs.color));
    }
    if (attrs.material && !knownMaterials.has(attrs.material)) {
        warnings.push("Unknown material: ".concat(attrs.material));
    }
    if (attrs.fit && !knownFits.has(attrs.fit)) {
        warnings.push("Unknown fit: ".concat(attrs.fit));
    }
    return { valid: warnings.length === 0, warnings: warnings };
}
