"use strict";
/**
 * Products Module Exports
 *
 * Product-related business logic: canonical grouping, price history.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.findPriceDrops = exports.getPriceHistoryDaily = exports.getPriceStats = exports.getPriceHistory = exports.takePriceSnapshot = exports.recordPricesBatch = exports.recordPrice = exports.findSimilarByPHash = exports.getCanonicalWithProducts = exports.mergeCanonicals = exports.recomputeAllCanonicals = exports.processProductCanonical = exports.updateCanonicalStats = exports.attachToCanonical = exports.createCanonical = exports.findMatchingCanonical = exports.normalizeTitle = exports.titleSimilarity = exports.levenshteinDistance = exports.isPHashSimilar = exports.hammingDistance = void 0;
// Canonical products
var canonical_js_1 = require("./canonical.js");
Object.defineProperty(exports, "hammingDistance", { enumerable: true, get: function () { return canonical_js_1.hammingDistance; } });
Object.defineProperty(exports, "isPHashSimilar", { enumerable: true, get: function () { return canonical_js_1.isPHashSimilar; } });
Object.defineProperty(exports, "levenshteinDistance", { enumerable: true, get: function () { return canonical_js_1.levenshteinDistance; } });
Object.defineProperty(exports, "titleSimilarity", { enumerable: true, get: function () { return canonical_js_1.titleSimilarity; } });
Object.defineProperty(exports, "normalizeTitle", { enumerable: true, get: function () { return canonical_js_1.normalizeTitle; } });
Object.defineProperty(exports, "findMatchingCanonical", { enumerable: true, get: function () { return canonical_js_1.findMatchingCanonical; } });
Object.defineProperty(exports, "createCanonical", { enumerable: true, get: function () { return canonical_js_1.createCanonical; } });
Object.defineProperty(exports, "attachToCanonical", { enumerable: true, get: function () { return canonical_js_1.attachToCanonical; } });
Object.defineProperty(exports, "updateCanonicalStats", { enumerable: true, get: function () { return canonical_js_1.updateCanonicalStats; } });
Object.defineProperty(exports, "processProductCanonical", { enumerable: true, get: function () { return canonical_js_1.processProductCanonical; } });
Object.defineProperty(exports, "recomputeAllCanonicals", { enumerable: true, get: function () { return canonical_js_1.recomputeAllCanonicals; } });
Object.defineProperty(exports, "mergeCanonicals", { enumerable: true, get: function () { return canonical_js_1.mergeCanonicals; } });
Object.defineProperty(exports, "getCanonicalWithProducts", { enumerable: true, get: function () { return canonical_js_1.getCanonicalWithProducts; } });
Object.defineProperty(exports, "findSimilarByPHash", { enumerable: true, get: function () { return canonical_js_1.findSimilarByPHash; } });
// Price history
var priceHistory_js_1 = require("./priceHistory.js");
Object.defineProperty(exports, "recordPrice", { enumerable: true, get: function () { return priceHistory_js_1.recordPrice; } });
Object.defineProperty(exports, "recordPricesBatch", { enumerable: true, get: function () { return priceHistory_js_1.recordPricesBatch; } });
Object.defineProperty(exports, "takePriceSnapshot", { enumerable: true, get: function () { return priceHistory_js_1.takePriceSnapshot; } });
Object.defineProperty(exports, "getPriceHistory", { enumerable: true, get: function () { return priceHistory_js_1.getPriceHistory; } });
Object.defineProperty(exports, "getPriceStats", { enumerable: true, get: function () { return priceHistory_js_1.getPriceStats; } });
Object.defineProperty(exports, "getPriceHistoryDaily", { enumerable: true, get: function () { return priceHistory_js_1.getPriceHistoryDaily; } });
Object.defineProperty(exports, "findPriceDrops", { enumerable: true, get: function () { return priceHistory_js_1.findPriceDrops; } });
