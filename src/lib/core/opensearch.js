"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
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
exports.osClient = void 0;
exports.ensureIndex = ensureIndex;
exports.applyIndexSpeedSettings = applyIndexSpeedSettings;
exports.warmupKnnIndex = warmupKnnIndex;
exports.recreateIndex = recreateIndex;
exports.getIndexStats = getIndexStats;
/**
 * OpenSearch Client & Index Management
 *
 * Manages OpenSearch connection and index configuration.
 *
 * EMBEDDING_DIM is derived from the same env var (EXPECTED_EMBEDDING_DIM)
 * that clip.ts validates against, ensuring model ↔ index consistency.
 */
var opensearch_1 = require("@opensearch-project/opensearch");
var config_1 = require("../../config");
/**
 * Extract auth from URL if separate username/password are not provided.
 * Aiven connection strings embed creds: https://user:pass@host:port
 */
function buildOsClientConfig() {
    var nodeUrl = config_1.config.opensearch.node;
    var username = config_1.config.opensearch.username;
    var password = config_1.config.opensearch.password;
    if (!username || !password) {
        try {
            var parsed = new URL(nodeUrl);
            if (parsed.username && parsed.password) {
                username = decodeURIComponent(parsed.username);
                password = decodeURIComponent(parsed.password);
            }
        }
        catch (_a) {
            // URL parsing failed — proceed without extracted creds
        }
    }
    console.log("OS config:", nodeUrl, username, password === null || password === void 0 ? void 0 : password.length);
    return __assign(__assign({ node: nodeUrl }, (username && password ? { auth: { username: username, password: password } } : {})), { ssl: { rejectUnauthorized: false }, maxRetries: 5, requestTimeout: 60000 });
}
exports.osClient = new opensearch_1.Client(buildOsClientConfig());
function readEfSearchFromIndexSettings(indexSettings) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x;
    if (!indexSettings)
        return undefined;
    return ((_w = (_u = (_r = (_o = (_j = (_h = (_g = (_e = (_c = (_b = (_a = indexSettings === null || indexSettings === void 0 ? void 0 : indexSettings.knn) === null || _a === void 0 ? void 0 : _a.algo_param) === null || _b === void 0 ? void 0 : _b.ef_search) !== null && _c !== void 0 ? _c : (_d = indexSettings === null || indexSettings === void 0 ? void 0 : indexSettings["knn.algo_param"]) === null || _d === void 0 ? void 0 : _d.ef_search) !== null && _e !== void 0 ? _e : (_f = indexSettings === null || indexSettings === void 0 ? void 0 : indexSettings["index.knn.algo_param"]) === null || _f === void 0 ? void 0 : _f.ef_search) !== null && _g !== void 0 ? _g : indexSettings === null || indexSettings === void 0 ? void 0 : indexSettings["knn.algo_param.ef_search"]) !== null && _h !== void 0 ? _h : indexSettings === null || indexSettings === void 0 ? void 0 : indexSettings["index.knn.algo_param.ef_search"]) !== null && _j !== void 0 ? _j : (_m = (_l = (_k = indexSettings === null || indexSettings === void 0 ? void 0 : indexSettings.index) === null || _k === void 0 ? void 0 : _k.knn) === null || _l === void 0 ? void 0 : _l.algo_param) === null || _m === void 0 ? void 0 : _m.ef_search) !== null && _o !== void 0 ? _o : (_q = (_p = indexSettings === null || indexSettings === void 0 ? void 0 : indexSettings.index) === null || _p === void 0 ? void 0 : _p["knn.algo_param"]) === null || _q === void 0 ? void 0 : _q.ef_search) !== null && _r !== void 0 ? _r : (_t = (_s = indexSettings === null || indexSettings === void 0 ? void 0 : indexSettings.index) === null || _s === void 0 ? void 0 : _s["index.knn.algo_param"]) === null || _t === void 0 ? void 0 : _t.ef_search) !== null && _u !== void 0 ? _u : (_v = indexSettings === null || indexSettings === void 0 ? void 0 : indexSettings.index) === null || _v === void 0 ? void 0 : _v["knn.algo_param.ef_search"]) !== null && _w !== void 0 ? _w : (_x = indexSettings === null || indexSettings === void 0 ? void 0 : indexSettings.index) === null || _x === void 0 ? void 0 : _x["index.knn.algo_param.ef_search"]);
}
function readEfSearchFromSettingsPayload(indexPayload) {
    var _a, _b, _c, _d, _e;
    if (!indexPayload)
        return undefined;
    return ((_e = (_c = (_b = readEfSearchFromIndexSettings((_a = indexPayload === null || indexPayload === void 0 ? void 0 : indexPayload.settings) === null || _a === void 0 ? void 0 : _a.index)) !== null && _b !== void 0 ? _b : readEfSearchFromIndexSettings(indexPayload === null || indexPayload === void 0 ? void 0 : indexPayload.settings)) !== null && _c !== void 0 ? _c : readEfSearchFromIndexSettings((_d = indexPayload === null || indexPayload === void 0 ? void 0 : indexPayload.defaults) === null || _d === void 0 ? void 0 : _d.index)) !== null && _e !== void 0 ? _e : readEfSearchFromIndexSettings(indexPayload === null || indexPayload === void 0 ? void 0 : indexPayload.defaults));
}
/**
 * Single source of truth for embedding dimension.
 * Shared with clip.ts via the EXPECTED_EMBEDDING_DIM env var.
 * Defaults to 512 (CLIP ViT-B/32).
 */
var EMBEDDING_DIM = parseInt(process.env.EXPECTED_EMBEDDING_DIM || "512", 10);
/**
 * Ensure the products index exists with proper mapping
 */
function ensureIndex() {
    return __awaiter(this, void 0, void 0, function () {
        var index, efSearchValue, exists;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    index = config_1.config.opensearch.index;
                    efSearchValue = parseInt(process.env.OS_EF_SEARCH || "100", 10);
                    return [4 /*yield*/, exports.osClient.indices.exists({ index: index })];
                case 1:
                    exists = _a.sent();
                    if (!!exists.body) return [3 /*break*/, 3];
                    return [4 /*yield*/, exports.osClient.indices.create({
                            index: index,
                            body: {
                                settings: {
                                    index: {
                                        knn: true,
                                        // ef_search from OS_EF_SEARCH env var (default 100).
                                        // With k=200 as the new default pool limit, ef_search=100 is
                                        // sufficient — HNSW traversal = max(ef_search, k) = 200. Halving traversal cuts
                                        // disk I/O in half on memory-pressured managed nodes.
                                        "knn.algo_param.ef_search": efSearchValue,
                                    },
                                    analysis: {
                                        analyzer: {
                                            product_analyzer: {
                                                type: "custom",
                                                tokenizer: "standard",
                                                filter: ["lowercase", "product_stemmer", "product_synonyms"],
                                            },
                                        },
                                        filter: {
                                            product_stemmer: {
                                                type: "stemmer",
                                                language: "light_english",
                                            },
                                            product_synonyms: {
                                                type: "synonym",
                                                synonyms: [
                                                    "pant,pants,trousers",
                                                    "shirt,top,blouse,tee",
                                                    "dress,gown,frock",
                                                    "jacket,coat,outerwear",
                                                    "blazer,blazers,sportcoat",
                                                    "shoe,shoes,sneaker,sneakers,footwear,boot,boots",
                                                    "bag,handbag,purse,tote",
                                                    "jeans,denim",
                                                    "hoodie,hooded sweatshirt,pullover",
                                                    "tshirt,t-shirt,tee",
                                                    "sweater,pullover,jumper,knitwear",
                                                    "skirt,mini skirt,maxi skirt",
                                                    "shorts,short pants",
                                                    "sandal,sandals,flip flops",
                                                    "heel,heels,pumps,stilettos",
                                                    "cap,hat,beanie",
                                                    "scarf,scarves,shawl",
                                                    "cardigan,knit jacket",
                                                    "vest,waistcoat,gilet",
                                                    "legging,leggings,tights",
                                                ],
                                            },
                                        },
                                    },
                                },
                                mappings: {
                                    properties: {
                                        product_id: { type: "keyword" },
                                        vendor_id: { type: "keyword" },
                                        title: {
                                            type: "text",
                                            analyzer: "product_analyzer",
                                            fields: {
                                                keyword: { type: "keyword", ignore_above: 256 },
                                                raw: { type: "text", analyzer: "standard" },
                                            },
                                        },
                                        description: {
                                            type: "text",
                                            analyzer: "product_analyzer",
                                        },
                                        brand: {
                                            type: "keyword",
                                            fields: {
                                                search: { type: "text", analyzer: "standard" },
                                            },
                                        },
                                        category: {
                                            type: "keyword",
                                            fields: {
                                                search: { type: "text", analyzer: "product_analyzer" },
                                            },
                                        },
                                        category_canonical: { type: "keyword" },
                                        // Canonical product-type tokens used for strict garment matching
                                        // (e.g. hoodie, joggers). Stored as multi-value keyword.
                                        product_types: { type: "keyword" },
                                        price_usd: { type: "float" },
                                        availability: { type: "keyword" },
                                        is_hidden: { type: "boolean" },
                                        canonical_id: { type: "keyword" },
                                        image_cdn: { type: "keyword" },
                                        // Extracted attributes (keyword for fast filtering/facets)
                                        attr_color: { type: "keyword" },
                                        attr_colors: { type: "keyword" }, // Multi-value
                                        attr_material: { type: "keyword" },
                                        attr_materials: { type: "keyword" }, // Multi-value
                                        attr_fit: { type: "keyword" },
                                        attr_style: { type: "keyword" },
                                        attr_gender: { type: "keyword" },
                                        /** Normalized men | women | unisex from title when detectable */
                                        audience_gender: { type: "keyword" },
                                        /** adult | kids | baby | teen */
                                        age_group: { type: "keyword" },
                                        attr_pattern: { type: "keyword" },
                                        attr_sleeve: { type: "keyword" },
                                        attr_neckline: { type: "keyword" },
                                        attr_colors_text: { type: "keyword" },
                                        attr_colors_image: { type: "keyword" },
                                        attr_color_source: { type: "keyword" },
                                        color_primary_canonical: { type: "keyword" },
                                        color_secondary_canonical: { type: "keyword" },
                                        color_accent_canonical: { type: "keyword" },
                                        color_palette_canonical: { type: "keyword" },
                                        color_confidence_primary: { type: "float" },
                                        color_confidence_text: { type: "float" },
                                        color_confidence_image: { type: "float" },
                                        norm_confidence: { type: "float" },
                                        category_confidence: { type: "float" },
                                        brand_confidence: { type: "float" },
                                        type_confidence: { type: "float" },
                                        // Array of product images
                                        images: {
                                            type: "nested",
                                            properties: {
                                                url: { type: "keyword" },
                                                p_hash: { type: "keyword" },
                                                is_primary: { type: "boolean" },
                                            },
                                        },
                                        last_seen_at: { type: "date" },
                                        // CLIP image embedding for vector search (primary image).
                                        // HNSW + FP16 scalar quantization: 2x memory reduction, ~2x SIMD speedup,
                                        // <0.5% recall loss. m=24 (was 48): still high-recall, ~1.5x faster traversal.
                                        embedding: {
                                            type: "knn_vector",
                                            dimension: EMBEDDING_DIM,
                                            method: {
                                                name: "hnsw",
                                                space_type: "cosinesimil",
                                                engine: "faiss",
                                                parameters: {
                                                    ef_construction: 256,
                                                    m: 24,
                                                    encoder: { name: "sq", parameters: { type: "fp16" } },
                                                },
                                            },
                                        },
                                        /** Vector score semantics for `embedding`: v1 legacy OpenSearch score path, v2 cosine-normalized path. */
                                        embedding_score_version: { type: "keyword" },
                                        // Garment ROI CLIP vector — HNSW + FP16 SQ, same rationale as `embedding`.
                                        embedding_garment: {
                                            type: "knn_vector",
                                            dimension: EMBEDDING_DIM,
                                            method: {
                                                name: "hnsw",
                                                space_type: "cosinesimil",
                                                engine: "faiss",
                                                parameters: {
                                                    ef_construction: 128,
                                                    m: 16,
                                                    encoder: { name: "sq", parameters: { type: "fp16" } },
                                                },
                                            },
                                        },
                                        /** Vector score semantics for `embedding_garment`: v1 legacy OpenSearch score path, v2 cosine-normalized path. */
                                        embedding_garment_score_version: { type: "keyword" },
                                        // Per-attribute embeddings for multi-vector weighted search.
                                        // IVF + FP16 SQ: these are reranking signals, not primary retrieval — IVF gives
                                        // 10-50x faster approximate search vs HNSW with acceptable recall at nprobes=8.
                                        embedding_color: {
                                            type: "knn_vector",
                                            dimension: EMBEDDING_DIM,
                                            method: {
                                                name: "ivf",
                                                space_type: "cosinesimil",
                                                engine: "faiss",
                                                parameters: {
                                                    nlist: 128,
                                                    nprobes: 8,
                                                    encoder: { name: "sq", parameters: { type: "fp16" } },
                                                },
                                            },
                                        },
                                        embedding_texture: {
                                            type: "knn_vector",
                                            dimension: EMBEDDING_DIM,
                                            method: {
                                                name: "ivf",
                                                space_type: "cosinesimil",
                                                engine: "faiss",
                                                parameters: {
                                                    nlist: 128,
                                                    nprobes: 8,
                                                    encoder: { name: "sq", parameters: { type: "fp16" } },
                                                },
                                            },
                                        },
                                        embedding_material: {
                                            type: "knn_vector",
                                            dimension: EMBEDDING_DIM,
                                            method: {
                                                name: "ivf",
                                                space_type: "cosinesimil",
                                                engine: "faiss",
                                                parameters: {
                                                    nlist: 128,
                                                    nprobes: 8,
                                                    encoder: { name: "sq", parameters: { type: "fp16" } },
                                                },
                                            },
                                        },
                                        embedding_style: {
                                            type: "knn_vector",
                                            dimension: EMBEDDING_DIM,
                                            method: {
                                                name: "ivf",
                                                space_type: "cosinesimil",
                                                engine: "faiss",
                                                parameters: {
                                                    nlist: 128,
                                                    nprobes: 8,
                                                    encoder: { name: "sq", parameters: { type: "fp16" } },
                                                },
                                            },
                                        },
                                        embedding_pattern: {
                                            type: "knn_vector",
                                            dimension: EMBEDDING_DIM,
                                            method: {
                                                name: "ivf",
                                                space_type: "cosinesimil",
                                                engine: "faiss",
                                                parameters: {
                                                    nlist: 128,
                                                    nprobes: 8,
                                                    encoder: { name: "sq", parameters: { type: "fp16" } },
                                                },
                                            },
                                        },
                                        // ====================================================================
                                        // PART-LEVEL EMBEDDINGS — IVF + FP16 SQ (same rationale as attributes)
                                        // ====================================================================
                                        // Sleeve area of tops/dresses
                                        embedding_part_sleeve: {
                                            type: "knn_vector",
                                            dimension: EMBEDDING_DIM,
                                            method: {
                                                name: "ivf",
                                                space_type: "cosinesimil",
                                                engine: "faiss",
                                                parameters: { nlist: 128, nprobes: 8, encoder: { name: "sq", parameters: { type: "fp16" } } },
                                            },
                                        },
                                        // Neckline area of tops
                                        embedding_part_neckline: {
                                            type: "knn_vector",
                                            dimension: EMBEDDING_DIM,
                                            method: {
                                                name: "ivf",
                                                space_type: "cosinesimil",
                                                engine: "faiss",
                                                parameters: { nlist: 128, nprobes: 8, encoder: { name: "sq", parameters: { type: "fp16" } } },
                                            },
                                        },
                                        // Hem/bottom edge of garments
                                        embedding_part_hem: {
                                            type: "knn_vector",
                                            dimension: EMBEDDING_DIM,
                                            method: {
                                                name: "ivf",
                                                space_type: "cosinesimil",
                                                engine: "faiss",
                                                parameters: { nlist: 128, nprobes: 8, encoder: { name: "sq", parameters: { type: "fp16" } } },
                                            },
                                        },
                                        // Waistline area of pants/skirts
                                        embedding_part_waistline: {
                                            type: "knn_vector",
                                            dimension: EMBEDDING_DIM,
                                            method: {
                                                name: "ivf",
                                                space_type: "cosinesimil",
                                                engine: "faiss",
                                                parameters: { nlist: 128, nprobes: 8, encoder: { name: "sq", parameters: { type: "fp16" } } },
                                            },
                                        },
                                        // Heel area of shoes
                                        embedding_part_heel: {
                                            type: "knn_vector",
                                            dimension: EMBEDDING_DIM,
                                            method: {
                                                name: "ivf",
                                                space_type: "cosinesimil",
                                                engine: "faiss",
                                                parameters: { nlist: 128, nprobes: 8, encoder: { name: "sq", parameters: { type: "fp16" } } },
                                            },
                                        },
                                        // Toe area of shoes
                                        embedding_part_toe: {
                                            type: "knn_vector",
                                            dimension: EMBEDDING_DIM,
                                            method: {
                                                name: "ivf",
                                                space_type: "cosinesimil",
                                                engine: "faiss",
                                                parameters: { nlist: 128, nprobes: 8, encoder: { name: "sq", parameters: { type: "fp16" } } },
                                            },
                                        },
                                        // Handle area of bags
                                        embedding_part_bag_handle: {
                                            type: "knn_vector",
                                            dimension: EMBEDDING_DIM,
                                            method: {
                                                name: "ivf",
                                                space_type: "cosinesimil",
                                                engine: "faiss",
                                                parameters: { nlist: 128, nprobes: 8, encoder: { name: "sq", parameters: { type: "fp16" } } },
                                            },
                                        },
                                        // Main body area of bags
                                        embedding_part_bag_body: {
                                            type: "knn_vector",
                                            dimension: EMBEDDING_DIM,
                                            method: {
                                                name: "ivf",
                                                space_type: "cosinesimil",
                                                engine: "faiss",
                                                parameters: { nlist: 128, nprobes: 8, encoder: { name: "sq", parameters: { type: "fp16" } } },
                                            },
                                        },
                                        // Pattern/texture patch for detailed matching
                                        embedding_part_pattern_patch: {
                                            type: "knn_vector",
                                            dimension: EMBEDDING_DIM,
                                            method: {
                                                name: "ivf",
                                                space_type: "cosinesimil",
                                                engine: "faiss",
                                                parameters: { nlist: 128, nprobes: 8, encoder: { name: "sq", parameters: { type: "fp16" } } },
                                            },
                                        },
                                    },
                                },
                            },
                        })];
                case 2:
                    _a.sent();
                    console.log("Created OpenSearch index: ".concat(index));
                    _a.label = 3;
                case 3: return [2 /*return*/];
            }
        });
    });
}
/**
 * Apply ef_search and other live-tunable kNN settings to the existing index.
 * Safe to run against a live index — no reindex required.
 * Run this once after deploying to fix the ef_search=1024 bottleneck on existing indexes.
 *
 * Configurable via OS_EF_SEARCH env var (defaults to 100).
 */
function applyIndexSpeedSettings() {
    return __awaiter(this, void 0, void 0, function () {
        var index, expected, readCurrentEfSearch, cur, _a, efSearchValue, applyAttempts, applied, _i, applyAttempts_1, attempt, _b, after, indexPayload, settingsIndexKeys, settingsKeys, defaultsIndexKeys, defaultsKeys, _c;
        var _this = this;
        var _d, _e, _f, _g, _h, _j, _k;
        return __generator(this, function (_l) {
            switch (_l.label) {
                case 0:
                    index = config_1.config.opensearch.index;
                    expected = String(process.env.OS_EF_SEARCH || "100");
                    readCurrentEfSearch = function () { return __awaiter(_this, void 0, void 0, function () {
                        var settingsResp;
                        var _a;
                        return __generator(this, function (_b) {
                            switch (_b.label) {
                                case 0: return [4 /*yield*/, exports.osClient.indices.getSettings({
                                        index: index,
                                        include_defaults: true,
                                    })];
                                case 1:
                                    settingsResp = _b.sent();
                                    return [2 /*return*/, readEfSearchFromSettingsPayload((_a = settingsResp.body) === null || _a === void 0 ? void 0 : _a[index])];
                            }
                        });
                    }); };
                    _l.label = 1;
                case 1:
                    _l.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, readCurrentEfSearch()];
                case 2:
                    cur = _l.sent();
                    console.log("[opensearch] ef_search on ".concat(index, " before apply: ").concat(cur !== null && cur !== void 0 ? cur : "unknown"));
                    return [3 /*break*/, 4];
                case 3:
                    _a = _l.sent();
                    return [3 /*break*/, 4];
                case 4:
                    efSearchValue = parseInt(expected, 10);
                    applyAttempts = [
                        // Preferred index-settings shape.
                        {
                            label: "nested-index",
                            body: { index: { "knn.algo_param.ef_search": efSearchValue } },
                        },
                        // Some managed clusters only honor flattened keys.
                        {
                            label: "flat-index-key",
                            body: { "index.knn.algo_param.ef_search": efSearchValue },
                        },
                        // Some variants expose `knn.algo_param` object.
                        {
                            label: "flat-object-key",
                            body: { "index.knn.algo_param": { ef_search: efSearchValue } },
                        },
                    ];
                    _i = 0, applyAttempts_1 = applyAttempts;
                    _l.label = 5;
                case 5:
                    if (!(_i < applyAttempts_1.length)) return [3 /*break*/, 11];
                    attempt = applyAttempts_1[_i];
                    _l.label = 6;
                case 6:
                    _l.trys.push([6, 9, , 10]);
                    return [4 /*yield*/, exports.osClient.indices.putSettings({
                            index: index,
                            body: attempt.body,
                        })];
                case 7:
                    _l.sent();
                    return [4 /*yield*/, readCurrentEfSearch()];
                case 8:
                    applied = _l.sent();
                    if (String(applied) === expected) {
                        if (process.env.NODE_ENV !== "production") {
                            console.log("[opensearch] ef_search apply mode: ".concat(attempt.label));
                        }
                        return [3 /*break*/, 11];
                    }
                    return [3 /*break*/, 10];
                case 9:
                    _b = _l.sent();
                    return [3 /*break*/, 10];
                case 10:
                    _i++;
                    return [3 /*break*/, 5];
                case 11:
                    _l.trys.push([11, 13, , 14]);
                    return [4 /*yield*/, exports.osClient.indices.getSettings({ index: index, include_defaults: true })];
                case 12:
                    after = _l.sent();
                    indexPayload = (_d = after.body) === null || _d === void 0 ? void 0 : _d[index];
                    applied = applied !== null && applied !== void 0 ? applied : readEfSearchFromSettingsPayload(indexPayload);
                    console.log("[opensearch] ef_search on ".concat(index, " after apply: ").concat(applied !== null && applied !== void 0 ? applied : "unknown — verify manually"));
                    if (String(applied) !== expected) {
                        settingsIndexKeys = Object.keys((_f = (_e = indexPayload === null || indexPayload === void 0 ? void 0 : indexPayload.settings) === null || _e === void 0 ? void 0 : _e.index) !== null && _f !== void 0 ? _f : {});
                        settingsKeys = Object.keys((_g = indexPayload === null || indexPayload === void 0 ? void 0 : indexPayload.settings) !== null && _g !== void 0 ? _g : {});
                        defaultsIndexKeys = Object.keys((_j = (_h = indexPayload === null || indexPayload === void 0 ? void 0 : indexPayload.defaults) === null || _h === void 0 ? void 0 : _h.index) !== null && _j !== void 0 ? _j : {});
                        defaultsKeys = Object.keys((_k = indexPayload === null || indexPayload === void 0 ? void 0 : indexPayload.defaults) !== null && _k !== void 0 ? _k : {});
                        console.warn("[opensearch] WARNING: ef_search may not have applied \u2014 got ".concat(applied, ", expected ").concat(expected));
                        console.warn("[opensearch] debug setting keys", JSON.stringify({ settingsIndexKeys: settingsIndexKeys, settingsKeys: settingsKeys, defaultsIndexKeys: defaultsIndexKeys, defaultsKeys: defaultsKeys }));
                    }
                    return [3 /*break*/, 14];
                case 13:
                    _c = _l.sent();
                    console.warn("[opensearch] Could not verify ef_search was applied to ".concat(index));
                    return [3 /*break*/, 14];
                case 14: return [2 /*return*/];
            }
        });
    });
}
/**
 * Preload FAISS graph segments into native memory for all shards of the index.
 * Without this, the first kNN queries after a restart pay the disk-read cost
 * for each FAISS segment file — making early searches 5-20x slower.
 *
 * Uses the OpenSearch kNN warmup API: GET /_plugins/_knn/warmup/<index>
 * Safe to call on a live index — read-only operation.
 */
function warmupKnnIndex() {
    return __awaiter(this, void 0, void 0, function () {
        var index, resp, shards, err_1;
        var _a, _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    index = config_1.config.opensearch.index;
                    _c.label = 1;
                case 1:
                    _c.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, exports.osClient.transport.request({
                            method: "GET",
                            path: "/_plugins/_knn/warmup/".concat(encodeURIComponent(index)),
                        })];
                case 2:
                    resp = _c.sent();
                    shards = (_a = resp === null || resp === void 0 ? void 0 : resp.body) === null || _a === void 0 ? void 0 : _a._shards;
                    console.log("[opensearch] kNN warmup complete for ".concat(index, ":"), shards
                        ? "total=".concat(shards.total, " successful=").concat(shards.successful, " failed=").concat(shards.failed)
                        : "ok");
                    return [3 /*break*/, 4];
                case 3:
                    err_1 = _c.sent();
                    // Non-fatal: warmup API may not be available on all managed clusters.
                    console.warn("[opensearch] kNN warmup failed (non-fatal, queries may be slow initially):", (_b = err_1 === null || err_1 === void 0 ? void 0 : err_1.message) !== null && _b !== void 0 ? _b : err_1);
                    return [3 /*break*/, 4];
                case 4: return [2 /*return*/];
            }
        });
    });
}
/**
 * Delete and recreate the index (use with caution)
 */
function recreateIndex() {
    return __awaiter(this, void 0, void 0, function () {
        var index, exists;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    index = config_1.config.opensearch.index;
                    return [4 /*yield*/, exports.osClient.indices.exists({ index: index })];
                case 1:
                    exists = _a.sent();
                    if (!exists.body) return [3 /*break*/, 3];
                    return [4 /*yield*/, exports.osClient.indices.delete({ index: index })];
                case 2:
                    _a.sent();
                    console.log("Deleted OpenSearch index: ".concat(index));
                    _a.label = 3;
                case 3: return [4 /*yield*/, ensureIndex()];
                case 4:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Get index stats
 */
function getIndexStats() {
    return __awaiter(this, void 0, void 0, function () {
        var index, stats;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    index = config_1.config.opensearch.index;
                    return [4 /*yield*/, exports.osClient.indices.stats({ index: index })];
                case 1:
                    stats = _a.sent();
                    return [2 /*return*/, {
                            docCount: stats.body._all.primaries.docs.count,
                            sizeBytes: stats.body._all.primaries.store.size_in_bytes,
                        }];
            }
        });
    });
}
