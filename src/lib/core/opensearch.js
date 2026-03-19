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
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.osClient = void 0;
exports.ensureIndex = ensureIndex;
exports.recreateIndex = recreateIndex;
exports.getIndexStats = getIndexStats;
/**
 * OpenSearch Client & Index Management
 *
 * Manages OpenSearch connection and index configuration.
 */
var opensearch_1 = require("@opensearch-project/opensearch");
var config_1 = require("../../config");
console.log("OS config:", config_1.config.opensearch.node, config_1.config.opensearch.username, (_a = config_1.config.opensearch.password) === null || _a === void 0 ? void 0 : _a.length);
exports.osClient = new opensearch_1.Client({
    node: config_1.config.opensearch.node,
    auth: {
        username: config_1.config.opensearch.username,
        password: config_1.config.opensearch.password,
    },
    ssl: { rejectUnauthorized: false },
});
// CLIP ViT-B/32 embedding dimension
var EMBEDDING_DIM = 512;
/**
 * Ensure the products index exists with proper mapping
 */
function ensureIndex() {
    return __awaiter(this, void 0, void 0, function () {
        var index, exists;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    index = config_1.config.opensearch.index;
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
                                        "knn.algo_param.ef_search": 100,
                                    },
                                },
                                mappings: {
                                    properties: {
                                        product_id: { type: "keyword" },
                                        vendor_id: { type: "keyword" },
                                        title: { type: "text" },
                                        brand: { type: "keyword" },
                                        category: { type: "keyword" },
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
                                        attr_pattern: { type: "keyword" },
                                        attr_sleeve: { type: "keyword" },
                                        attr_neckline: { type: "keyword" },
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
                                        // CLIP image embedding for vector search (primary image)
                                        embedding: {
                                            type: "knn_vector",
                                            dimension: EMBEDDING_DIM,
                                            method: {
                                                name: "hnsw",
                                                space_type: "cosinesimil",
                                                engine: "faiss",
                                                parameters: {
                                                    ef_construction: 128,
                                                    m: 16,
                                                },
                                            },
                                        },
                                        // Per-attribute embeddings for multi-vector weighted search
                                        embedding_color: {
                                            type: "knn_vector",
                                            dimension: EMBEDDING_DIM,
                                            method: {
                                                name: "hnsw",
                                                space_type: "cosinesimil",
                                                engine: "faiss",
                                                parameters: {
                                                    ef_construction: 128,
                                                    m: 16,
                                                },
                                            },
                                        },
                                        embedding_texture: {
                                            type: "knn_vector",
                                            dimension: EMBEDDING_DIM,
                                            method: {
                                                name: "hnsw",
                                                space_type: "cosinesimil",
                                                engine: "faiss",
                                                parameters: {
                                                    ef_construction: 128,
                                                    m: 16,
                                                },
                                            },
                                        },
                                        embedding_material: {
                                            type: "knn_vector",
                                            dimension: EMBEDDING_DIM,
                                            method: {
                                                name: "hnsw",
                                                space_type: "cosinesimil",
                                                engine: "faiss",
                                                parameters: {
                                                    ef_construction: 128,
                                                    m: 16,
                                                },
                                            },
                                        },
                                        embedding_style: {
                                            type: "knn_vector",
                                            dimension: EMBEDDING_DIM,
                                            method: {
                                                name: "hnsw",
                                                space_type: "cosinesimil",
                                                engine: "faiss",
                                                parameters: {
                                                    ef_construction: 128,
                                                    m: 16,
                                                },
                                            },
                                        },
                                        embedding_pattern: {
                                            type: "knn_vector",
                                            dimension: EMBEDDING_DIM,
                                            method: {
                                                name: "hnsw",
                                                space_type: "cosinesimil",
                                                engine: "faiss",
                                                parameters: {
                                                    ef_construction: 128,
                                                    m: 16,
                                                },
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
