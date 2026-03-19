"use strict";
/**
 * Resumable Product Reindexing Script
 *
 * Features:
 * - Check which products are already indexed in OpenSearch
 * - Skip successfully indexed products
 * - Retry failed products
 * - Track progress
 * - Support starting from specific product ID
 * - Batch processing for efficiency
 * - Graceful error handling (skip failed images, continue with others)
 *
 * Usage:
 *   # Resume from scratch (auto-detects what's already indexed)
 *   npx tsx scripts/resume-reindex.ts
 *
 *   # Start from specific product ID
 *   npx tsx scripts/resume-reindex.ts --start-from-id 1000
 *
 *   # Force reindex all products (ignore existing)
 *   npx tsx scripts/resume-reindex.ts --force
 *
 *   # Only reindex failed products (those not in OpenSearch)
 *   npx tsx scripts/resume-reindex.ts --failed-only
 *
 *   # Dry run (show what would be reindexed without doing it)
 *   npx tsx scripts/resume-reindex.ts --dry-run
 */
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
require("dotenv/config");
var axios_1 = require("axios");
var core_1 = require("../src/lib/core");
var config_1 = require("../src/config");
var image_1 = require("../src/lib/image");
var attributeExtractor_1 = require("../src/lib/search/attributeExtractor");
var fs_1 = require("fs");
var DEFAULT_CONFIG = {
    force: false,
    failedOnly: false,
    dryRun: false,
    batchSize: 50,
    maxRetries: 3,
    timeoutMs: 30000,
    saveProgressEvery: 10,
    progressFile: ".reindex-progress.json",
};
// ============================================================================
// Helpers
// ============================================================================
function columnExists(columnName) {
    return __awaiter(this, void 0, void 0, function () {
        var res;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, core_1.pg.query("SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name=$1", [columnName])];
                case 1:
                    res = _a.sent();
                    return [2 /*return*/, res.rowCount > 0];
            }
        });
    });
}
function getProductColumns() {
    return __awaiter(this, void 0, void 0, function () {
        var _a, hasIsHidden, hasCanonicalId;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, Promise.all([
                        columnExists("is_hidden"),
                        columnExists("canonical_id"),
                    ])];
                case 1:
                    _a = _b.sent(), hasIsHidden = _a[0], hasCanonicalId = _a[1];
                    return [2 /*return*/, { hasIsHidden: hasIsHidden, hasCanonicalId: hasCanonicalId }];
            }
        });
    });
}
function loadProgress(progressFile) {
    return __awaiter(this, void 0, void 0, function () {
        var data, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, fs_1.promises.readFile(progressFile, "utf-8")];
                case 1:
                    data = _b.sent();
                    return [2 /*return*/, JSON.parse(data)];
                case 2:
                    _a = _b.sent();
                    return [2 /*return*/, null];
                case 3: return [2 /*return*/];
            }
        });
    });
}
function saveProgress(progress, progressFile) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    progress.lastUpdatedAt = new Date().toISOString();
                    return [4 /*yield*/, fs_1.promises.writeFile(progressFile, JSON.stringify(progress, null, 2))];
                case 1:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
function isProductIndexed(productId) {
    return __awaiter(this, void 0, void 0, function () {
        var result, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, core_1.osClient.exists({
                            index: config_1.config.opensearch.index,
                            id: String(productId),
                        })];
                case 1:
                    result = _b.sent();
                    return [2 /*return*/, result.body === true];
                case 2:
                    _a = _b.sent();
                    return [2 /*return*/, false];
                case 3: return [2 /*return*/];
            }
        });
    });
}
function getUnindexedProductIds(productIds) {
    return __awaiter(this, void 0, void 0, function () {
        var result, docs, unindexed, i, doc, err_1, unindexed, _i, productIds_1, id;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    if (productIds.length === 0)
                        return [2 /*return*/, []];
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 3, , 8]);
                    return [4 /*yield*/, core_1.osClient.mget({
                            index: config_1.config.opensearch.index,
                            body: {
                                ids: productIds.map(String),
                            },
                        })];
                case 2:
                    result = _b.sent();
                    docs = (_a = result.body.docs) !== null && _a !== void 0 ? _a : [];
                    unindexed = [];
                    for (i = 0; i < productIds.length; i++) {
                        doc = docs[i];
                        if (!(doc === null || doc === void 0 ? void 0 : doc.found)) {
                            unindexed.push(productIds[i]);
                        }
                    }
                    return [2 /*return*/, unindexed];
                case 3:
                    err_1 = _b.sent();
                    console.warn("Failed to batch check indexed status, falling back to individual checks");
                    unindexed = [];
                    _i = 0, productIds_1 = productIds;
                    _b.label = 4;
                case 4:
                    if (!(_i < productIds_1.length)) return [3 /*break*/, 7];
                    id = productIds_1[_i];
                    return [4 /*yield*/, isProductIndexed(id)];
                case 5:
                    if (!(_b.sent())) {
                        unindexed.push(id);
                    }
                    _b.label = 6;
                case 6:
                    _i++;
                    return [3 /*break*/, 4];
                case 7: return [2 /*return*/, unindexed];
                case 8: return [2 /*return*/];
            }
        });
    });
}
function fetchImage(url, retries, timeoutMs) {
    return __awaiter(this, void 0, void 0, function () {
        var _loop_1, attempt, state_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _loop_1 = function (attempt) {
                        var res, err_2;
                        return __generator(this, function (_b) {
                            switch (_b.label) {
                                case 0:
                                    _b.trys.push([0, 2, , 4]);
                                    return [4 /*yield*/, axios_1.default.get(url, {
                                            responseType: "arraybuffer",
                                            timeout: timeoutMs,
                                        })];
                                case 1:
                                    res = _b.sent();
                                    return [2 /*return*/, { value: Buffer.from(res.data) }];
                                case 2:
                                    err_2 = _b.sent();
                                    if (attempt === retries) {
                                        console.warn("Failed to fetch image after ".concat(retries, " attempts: ").concat(url, " - ").concat(err_2.message));
                                        return [2 /*return*/, { value: null }];
                                    }
                                    // Wait before retry (exponential backoff)
                                    return [4 /*yield*/, new Promise(function (resolve) { return setTimeout(resolve, 1000 * attempt); })];
                                case 3:
                                    // Wait before retry (exponential backoff)
                                    _b.sent();
                                    return [3 /*break*/, 4];
                                case 4: return [2 /*return*/];
                            }
                        });
                    };
                    attempt = 1;
                    _a.label = 1;
                case 1:
                    if (!(attempt <= retries)) return [3 /*break*/, 4];
                    return [5 /*yield**/, _loop_1(attempt)];
                case 2:
                    state_1 = _a.sent();
                    if (typeof state_1 === "object")
                        return [2 /*return*/, state_1.value];
                    _a.label = 3;
                case 3:
                    attempt++;
                    return [3 /*break*/, 1];
                case 4: return [2 /*return*/, null];
            }
        });
    });
}
// ============================================================================
// Main Reindexing Logic
// ============================================================================
function reindexProduct(product, reindexConfig) {
    return __awaiter(this, void 0, void 0, function () {
        var id, vendor_id, title, brand, category, price_cents, availability, last_seen, image_url, is_hidden, canonical_id, buf, embedding, ph, attributes, body, err_3;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    id = product.id, vendor_id = product.vendor_id, title = product.title, brand = product.brand, category = product.category, price_cents = product.price_cents, availability = product.availability, last_seen = product.last_seen, image_url = product.image_url, is_hidden = product.is_hidden, canonical_id = product.canonical_id;
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 6, , 7]);
                    return [4 /*yield*/, fetchImage(image_url, reindexConfig.maxRetries, reindexConfig.timeoutMs)];
                case 2:
                    buf = _a.sent();
                    if (!buf) {
                        console.error("  \u274C Product ".concat(id, ": Failed to fetch image"));
                        return [2 /*return*/, false];
                    }
                    if (reindexConfig.dryRun) {
                        console.log("  [DRY RUN] Would index product ".concat(id, ": ").concat(title));
                        return [2 /*return*/, true];
                    }
                    return [4 /*yield*/, (0, image_1.processImageForEmbedding)(buf)];
                case 3:
                    embedding = _a.sent();
                    return [4 /*yield*/, (0, image_1.computePHash)(buf)];
                case 4:
                    ph = _a.sent();
                    attributes = (0, attributeExtractor_1.extractAttributesSync)(title).attributes;
                    body = {
                        product_id: String(id),
                        vendor_id: String(vendor_id),
                        title: title,
                        brand: brand,
                        category: category,
                        price_usd: Math.round(price_cents / 89000),
                        availability: availability ? "in_stock" : "out_of_stock",
                        is_hidden: is_hidden !== null && is_hidden !== void 0 ? is_hidden : false,
                        canonical_id: canonical_id ? String(canonical_id) : null,
                        embedding: embedding,
                        image_cdn: image_url,
                        p_hash: ph,
                        last_seen_at: last_seen,
                        // Extracted attributes
                        attr_color: attributes.color || null,
                        attr_colors: attributes.colors || [],
                        attr_material: attributes.material || null,
                        attr_materials: attributes.materials || [],
                        attr_fit: attributes.fit || null,
                        attr_style: attributes.style || null,
                        attr_gender: attributes.gender || null,
                        attr_pattern: attributes.pattern || null,
                        attr_sleeve: attributes.sleeve || null,
                        attr_neckline: attributes.neckline || null,
                    };
                    return [4 /*yield*/, core_1.osClient.index({
                            index: config_1.config.opensearch.index,
                            id: String(id),
                            body: body,
                            refresh: false, // Don't refresh immediately for performance
                        })];
                case 5:
                    _a.sent();
                    console.log("  \u2705 Product ".concat(id, ": ").concat(title.substring(0, 60)));
                    return [2 /*return*/, true];
                case 6:
                    err_3 = _a.sent();
                    console.error("  \u274C Product ".concat(id, ": ").concat(err_3.message || err_3));
                    return [2 /*return*/, false];
                case 7: return [2 /*return*/];
            }
        });
    });
}
function main() {
    return __awaiter(this, void 0, void 0, function () {
        var args, reindexConfig, i, arg, columns, progress, startFromId, optionalColumns, whereClause, res, products, totalProducts, processed, _loop_2, batchStart;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    args = process.argv.slice(2);
                    reindexConfig = __assign({}, DEFAULT_CONFIG);
                    for (i = 0; i < args.length; i++) {
                        arg = args[i];
                        switch (arg) {
                            case "--start-from-id":
                                reindexConfig.startFromId = parseInt(args[++i], 10);
                                break;
                            case "--force":
                                reindexConfig.force = true;
                                break;
                            case "--failed-only":
                                reindexConfig.failedOnly = true;
                                break;
                            case "--dry-run":
                                reindexConfig.dryRun = true;
                                break;
                            case "--batch-size":
                                reindexConfig.batchSize = parseInt(args[++i], 10);
                                break;
                            case "--help":
                                console.log("\nResumable Product Reindexing\n\nUsage:\n  npx tsx scripts/resume-reindex.ts [options]\n\nOptions:\n  --start-from-id <id>    Start from this product ID\n  --force                 Force reindex even if already exists\n  --failed-only           Only reindex products not in OpenSearch\n  --dry-run               Show what would be reindexed without doing it\n  --batch-size <n>        Process N products at a time (default: 50)\n  --help                  Show this help message\n\nExamples:\n  # Resume from scratch\n  npx tsx scripts/resume-reindex.ts\n\n  # Start from product 1000\n  npx tsx scripts/resume-reindex.ts --start-from-id 1000\n\n  # Only reindex failed products\n  npx tsx scripts/resume-reindex.ts --failed-only\n\n  # Dry run to see what would happen\n  npx tsx scripts/resume-reindex.ts --dry-run\n        ");
                                process.exit(0);
                            default:
                                break;
                        }
                    }
                    console.log("=".repeat(70));
                    console.log("📦 Resumable Product Reindexing");
                    console.log("=".repeat(70));
                    console.log("Configuration:");
                    console.log("  Start from ID:      ".concat(reindexConfig.startFromId || "auto-detect"));
                    console.log("  Force reindex:      ".concat(reindexConfig.force));
                    console.log("  Failed only:        ".concat(reindexConfig.failedOnly));
                    console.log("  Dry run:            ".concat(reindexConfig.dryRun));
                    console.log("  Batch size:         ".concat(reindexConfig.batchSize));
                    console.log("  Max retries:        ".concat(reindexConfig.maxRetries));
                    console.log();
                    return [4 /*yield*/, columnExists("image_url")];
                case 1:
                    // Check columns
                    if (!(_a.sent())) {
                        console.error("❌ products.image_url column not found. Add image_url column before reindexing.");
                        process.exit(1);
                    }
                    return [4 /*yield*/, getProductColumns()];
                case 2:
                    columns = _a.sent();
                    return [4 /*yield*/, loadProgress(reindexConfig.progressFile)];
                case 3:
                    progress = (_a.sent()) || {
                        lastProcessedId: 0,
                        totalProcessed: 0,
                        totalSuccess: 0,
                        totalFailed: 0,
                        totalSkipped: 0,
                        failedIds: [],
                        startedAt: new Date().toISOString(),
                        lastUpdatedAt: new Date().toISOString(),
                    };
                    startFromId = reindexConfig.startFromId || progress.lastProcessedId;
                    console.log("📊 Loading products...");
                    optionalColumns = [
                        columns.hasIsHidden ? "is_hidden" : "NULL::boolean AS is_hidden",
                        columns.hasCanonicalId ? "canonical_id" : "NULL::text AS canonical_id",
                    ].join(", ");
                    whereClause = startFromId > 0 ? "WHERE image_url IS NOT NULL AND id > ".concat(startFromId) : "WHERE image_url IS NOT NULL";
                    return [4 /*yield*/, core_1.pg.query("SELECT id, vendor_id, title, brand, category, price_cents, availability, last_seen, image_url, ".concat(optionalColumns, "\n     FROM products\n     ").concat(whereClause, "\n     ORDER BY id ASC"))];
                case 4:
                    res = _a.sent();
                    console.log("Found ".concat(res.rowCount, " products to process"));
                    console.log();
                    if (res.rowCount === 0) {
                        console.log("✅ No products to reindex. All done!");
                        process.exit(0);
                    }
                    products = res.rows;
                    totalProducts = products.length;
                    processed = 0;
                    _loop_2 = function (batchStart) {
                        var batch, batchNum, totalBatches, productsToIndex, batchIds, unindexedIds_1, skipped, _i, productsToIndex_1, product, success;
                        return __generator(this, function (_b) {
                            switch (_b.label) {
                                case 0:
                                    batch = products.slice(batchStart, batchStart + reindexConfig.batchSize);
                                    batchNum = Math.floor(batchStart / reindexConfig.batchSize) + 1;
                                    totalBatches = Math.ceil(products.length / reindexConfig.batchSize);
                                    console.log("\n\uD83D\uDCE6 Batch ".concat(batchNum, "/").concat(totalBatches, " (").concat(batch.length, " products)"));
                                    productsToIndex = batch;
                                    if (!(!reindexConfig.force || reindexConfig.failedOnly)) return [3 /*break*/, 2];
                                    batchIds = batch.map(function (p) { return p.id; });
                                    return [4 /*yield*/, getUnindexedProductIds(batchIds)];
                                case 1:
                                    unindexedIds_1 = _b.sent();
                                    if (!reindexConfig.force) {
                                        productsToIndex = batch.filter(function (p) { return unindexedIds_1.includes(p.id); });
                                        skipped = batch.length - productsToIndex.length;
                                        if (skipped > 0) {
                                            console.log("  \u23ED\uFE0F  Skipping ".concat(skipped, " already-indexed products"));
                                            progress.totalSkipped += skipped;
                                        }
                                    }
                                    _b.label = 2;
                                case 2:
                                    _i = 0, productsToIndex_1 = productsToIndex;
                                    _b.label = 3;
                                case 3:
                                    if (!(_i < productsToIndex_1.length)) return [3 /*break*/, 7];
                                    product = productsToIndex_1[_i];
                                    return [4 /*yield*/, reindexProduct(product, reindexConfig)];
                                case 4:
                                    success = _b.sent();
                                    processed++;
                                    progress.totalProcessed++;
                                    progress.lastProcessedId = product.id;
                                    if (success) {
                                        progress.totalSuccess++;
                                    }
                                    else {
                                        progress.totalFailed++;
                                        progress.failedIds.push(product.id);
                                    }
                                    if (!(processed % reindexConfig.saveProgressEvery === 0)) return [3 /*break*/, 6];
                                    return [4 /*yield*/, saveProgress(progress, reindexConfig.progressFile)];
                                case 5:
                                    _b.sent();
                                    _b.label = 6;
                                case 6:
                                    _i++;
                                    return [3 /*break*/, 3];
                                case 7:
                                    if (!(!reindexConfig.dryRun && productsToIndex.length > 0)) return [3 /*break*/, 9];
                                    return [4 /*yield*/, core_1.osClient.indices.refresh({ index: config_1.config.opensearch.index })];
                                case 8:
                                    _b.sent();
                                    _b.label = 9;
                                case 9:
                                    console.log("  Progress: ".concat(processed, "/").concat(totalProducts, " (").concat(Math.round(100 * processed / totalProducts), "%)"));
                                    return [2 /*return*/];
                            }
                        });
                    };
                    batchStart = 0;
                    _a.label = 5;
                case 5:
                    if (!(batchStart < products.length)) return [3 /*break*/, 8];
                    return [5 /*yield**/, _loop_2(batchStart)];
                case 6:
                    _a.sent();
                    _a.label = 7;
                case 7:
                    batchStart += reindexConfig.batchSize;
                    return [3 /*break*/, 5];
                case 8: 
                // Final save
                return [4 /*yield*/, saveProgress(progress, reindexConfig.progressFile)];
                case 9:
                    // Final save
                    _a.sent();
                    // Final summary
                    console.log();
                    console.log("=".repeat(70));
                    console.log("✅ Reindexing Complete!");
                    console.log("=".repeat(70));
                    console.log("Total processed:  ".concat(progress.totalProcessed));
                    console.log("Successful:       ".concat(progress.totalSuccess, " \u2705"));
                    console.log("Failed:           ".concat(progress.totalFailed, " \u274C"));
                    console.log("Skipped:          ".concat(progress.totalSkipped, " \u23ED\uFE0F"));
                    console.log();
                    if (progress.failedIds.length > 0) {
                        console.log("\u26A0\uFE0F  ".concat(progress.failedIds.length, " products failed to index:"));
                        console.log("   IDs: ".concat(progress.failedIds.slice(0, 20).join(", ")).concat(progress.failedIds.length > 20 ? "..." : ""));
                        console.log();
                        console.log("To retry only failed products:");
                        console.log("  npx tsx scripts/resume-reindex.ts --start-from-id ".concat(progress.failedIds[0]));
                        console.log();
                    }
                    console.log("Progress saved to: ".concat(reindexConfig.progressFile));
                    console.log();
                    process.exit(0);
                    return [2 /*return*/];
            }
        });
    });
}
main().catch(function (e) {
    console.error("❌ Fatal error:", e);
    process.exit(1);
});
