"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeAttributeTitle = exports.validateAttributes = exports.getKnownFits = exports.getKnownMaterials = exports.getKnownColors = exports.getCacheStats = exports.clearCache = exports.setCache = exports.getCached = exports.extractWithRules = exports.hashTitle = exports.extractAttributesBatch = exports.extractAttributesSync = exports.extractAttributes = exports.buildSemanticOpenSearchQuery = exports.countEntityMatches = exports.calculateHybridScore = exports.loadCategoriesFromDB = exports.loadBrandsFromDB = exports.parseQuery = exports.findPriceDrops = exports.getPriceHistoryDaily = exports.getPriceStats = exports.getPriceHistory = exports.takePriceSnapshot = exports.recordPricesBatch = exports.recordPrice = exports.findSimilarByPHash = exports.getCanonicalWithProducts = exports.mergeCanonicals = exports.recomputeAllCanonicals = exports.processProductCanonical = exports.updateCanonicalStats = exports.attachToCanonical = exports.createCanonical = exports.findMatchingCanonical = exports.normalizeTitle = exports.titleSimilarity = exports.levenshteinDistance = exports.isPHashSimilar = exports.hammingDistance = void 0;
/**
 * Library exports
 *
 * Organized by functionality:
 * - core/      - Database and OpenSearch clients
 * - image/     - CLIP, image processing, R2 storage
 * - scheduler/ - Job scheduling with BullMQ
 * - worker/    - Job processing worker
 * - products/  - Canonical products and price history
 * - search/    - Semantic search and attribute extraction
 * - compare/   - Product comparison features
 */
__exportStar(require("./core/index.js"), exports);
__exportStar(require("./image/index.js"), exports);
__exportStar(require("./scheduler/index.js"), exports);
__exportStar(require("./worker/index.js"), exports);
__exportStar(require("./compare/index.js"), exports);
__exportStar(require("./outfit/index.js"), exports);
// Product services (import specific exports to avoid conflicts)
var index_js_1 = require("./products/index.js");
Object.defineProperty(exports, "hammingDistance", { enumerable: true, get: function () { return index_js_1.hammingDistance; } });
Object.defineProperty(exports, "isPHashSimilar", { enumerable: true, get: function () { return index_js_1.isPHashSimilar; } });
Object.defineProperty(exports, "levenshteinDistance", { enumerable: true, get: function () { return index_js_1.levenshteinDistance; } });
Object.defineProperty(exports, "titleSimilarity", { enumerable: true, get: function () { return index_js_1.titleSimilarity; } });
Object.defineProperty(exports, "normalizeTitle", { enumerable: true, get: function () { return index_js_1.normalizeTitle; } });
Object.defineProperty(exports, "findMatchingCanonical", { enumerable: true, get: function () { return index_js_1.findMatchingCanonical; } });
Object.defineProperty(exports, "createCanonical", { enumerable: true, get: function () { return index_js_1.createCanonical; } });
Object.defineProperty(exports, "attachToCanonical", { enumerable: true, get: function () { return index_js_1.attachToCanonical; } });
Object.defineProperty(exports, "updateCanonicalStats", { enumerable: true, get: function () { return index_js_1.updateCanonicalStats; } });
Object.defineProperty(exports, "processProductCanonical", { enumerable: true, get: function () { return index_js_1.processProductCanonical; } });
Object.defineProperty(exports, "recomputeAllCanonicals", { enumerable: true, get: function () { return index_js_1.recomputeAllCanonicals; } });
Object.defineProperty(exports, "mergeCanonicals", { enumerable: true, get: function () { return index_js_1.mergeCanonicals; } });
Object.defineProperty(exports, "getCanonicalWithProducts", { enumerable: true, get: function () { return index_js_1.getCanonicalWithProducts; } });
Object.defineProperty(exports, "findSimilarByPHash", { enumerable: true, get: function () { return index_js_1.findSimilarByPHash; } });
Object.defineProperty(exports, "recordPrice", { enumerable: true, get: function () { return index_js_1.recordPrice; } });
Object.defineProperty(exports, "recordPricesBatch", { enumerable: true, get: function () { return index_js_1.recordPricesBatch; } });
Object.defineProperty(exports, "takePriceSnapshot", { enumerable: true, get: function () { return index_js_1.takePriceSnapshot; } });
Object.defineProperty(exports, "getPriceHistory", { enumerable: true, get: function () { return index_js_1.getPriceHistory; } });
Object.defineProperty(exports, "getPriceStats", { enumerable: true, get: function () { return index_js_1.getPriceStats; } });
Object.defineProperty(exports, "getPriceHistoryDaily", { enumerable: true, get: function () { return index_js_1.getPriceHistoryDaily; } });
Object.defineProperty(exports, "findPriceDrops", { enumerable: true, get: function () { return index_js_1.findPriceDrops; } });
// Search services (rename normalizeTitle to avoid conflict)
var index_js_2 = require("./search/index.js");
Object.defineProperty(exports, "parseQuery", { enumerable: true, get: function () { return index_js_2.parseQuery; } });
Object.defineProperty(exports, "loadBrandsFromDB", { enumerable: true, get: function () { return index_js_2.loadBrandsFromDB; } });
Object.defineProperty(exports, "loadCategoriesFromDB", { enumerable: true, get: function () { return index_js_2.loadCategoriesFromDB; } });
Object.defineProperty(exports, "calculateHybridScore", { enumerable: true, get: function () { return index_js_2.calculateHybridScore; } });
Object.defineProperty(exports, "countEntityMatches", { enumerable: true, get: function () { return index_js_2.countEntityMatches; } });
Object.defineProperty(exports, "buildSemanticOpenSearchQuery", { enumerable: true, get: function () { return index_js_2.buildSemanticOpenSearchQuery; } });
Object.defineProperty(exports, "extractAttributes", { enumerable: true, get: function () { return index_js_2.extractAttributes; } });
Object.defineProperty(exports, "extractAttributesSync", { enumerable: true, get: function () { return index_js_2.extractAttributesSync; } });
Object.defineProperty(exports, "extractAttributesBatch", { enumerable: true, get: function () { return index_js_2.extractAttributesBatch; } });
Object.defineProperty(exports, "hashTitle", { enumerable: true, get: function () { return index_js_2.hashTitle; } });
Object.defineProperty(exports, "extractWithRules", { enumerable: true, get: function () { return index_js_2.extractWithRules; } });
Object.defineProperty(exports, "getCached", { enumerable: true, get: function () { return index_js_2.getCached; } });
Object.defineProperty(exports, "setCache", { enumerable: true, get: function () { return index_js_2.setCache; } });
Object.defineProperty(exports, "clearCache", { enumerable: true, get: function () { return index_js_2.clearCache; } });
Object.defineProperty(exports, "getCacheStats", { enumerable: true, get: function () { return index_js_2.getCacheStats; } });
Object.defineProperty(exports, "getKnownColors", { enumerable: true, get: function () { return index_js_2.getKnownColors; } });
Object.defineProperty(exports, "getKnownMaterials", { enumerable: true, get: function () { return index_js_2.getKnownMaterials; } });
Object.defineProperty(exports, "getKnownFits", { enumerable: true, get: function () { return index_js_2.getKnownFits; } });
Object.defineProperty(exports, "validateAttributes", { enumerable: true, get: function () { return index_js_2.validateAttributes; } });
// Search normalizeTitle as alias
var attributeExtractor_js_1 = require("./search/attributeExtractor.js");
Object.defineProperty(exports, "normalizeAttributeTitle", { enumerable: true, get: function () { return attributeExtractor_js_1.normalizeTitle; } });
