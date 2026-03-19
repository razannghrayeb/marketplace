"use strict";
/**
 * Dual-Model Fashion Detection Client
 *
 * TypeScript client for the Dual-Model Fashion Detection API.
 * Uses a hybrid detector combining:
 *   - Model A: deepfashion2_yolov8s-seg (clothing: tops, bottoms, dresses, outerwear)
 *   - Model B: valentinafeve/yolos-fashionpedia (accessories: shoes, bags, hats)
 * Provides type-safe methods for detecting fashion items in images.
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
exports.YOLOv8Client = void 0;
exports.getYOLOv8Client = getYOLOv8Client;
exports.filterByCategory = filterByCategory;
exports.filterByConfidence = filterByConfidence;
exports.getPrimaryDetection = getPrimaryDetection;
exports.groupByCategory = groupByCategory;
exports.extractOutfitComposition = extractOutfitComposition;
// ============================================================================
// Client Class
// ============================================================================
var YOLOv8Client = /** @class */ (function () {
    function YOLOv8Client(baseUrl, timeout) {
        this.baseUrl =
            baseUrl || process.env.YOLOV8_SERVICE_URL || "http://0.0.0.0:8001";
        this.timeout = timeout || 30000;
    }
    /**
     * Check if the YOLO service is available
     */
    YOLOv8Client.prototype.isAvailable = function () {
        return __awaiter(this, void 0, void 0, function () {
            var health, _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _b.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, this.health()];
                    case 1:
                        health = _b.sent();
                        return [2 /*return*/, health.ok && health.model_loaded];
                    case 2:
                        _a = _b.sent();
                        return [2 /*return*/, false];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Health check endpoint
     */
    YOLOv8Client.prototype.health = function () {
        return __awaiter(this, void 0, void 0, function () {
            var response;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, fetch("".concat(this.baseUrl, "/health"), {
                            method: "GET",
                            signal: AbortSignal.timeout(5000),
                        })];
                    case 1:
                        response = _a.sent();
                        if (!response.ok) {
                            throw new Error("Health check failed: ".concat(response.status));
                        }
                        return [2 /*return*/, response.json()];
                }
            });
        });
    };
    /**
     * Get all supported fashion categories and their style attributes
     */
    YOLOv8Client.prototype.getLabels = function () {
        return __awaiter(this, void 0, void 0, function () {
            var response;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, fetch("".concat(this.baseUrl, "/labels"), {
                            method: "GET",
                            signal: AbortSignal.timeout(5000),
                        })];
                    case 1:
                        response = _a.sent();
                        if (!response.ok) {
                            throw new Error("Failed to get labels: ".concat(response.status));
                        }
                        return [2 /*return*/, response.json()];
                }
            });
        });
    };
    /**
     * Detect fashion items in an image from a Buffer
     */
    YOLOv8Client.prototype.detectFromBuffer = function (imageBuffer_1) {
        return __awaiter(this, arguments, void 0, function (imageBuffer, filename, options) {
            var formData, uint8Array, blob, url, response, error;
            var _a, _b, _c;
            if (filename === void 0) { filename = "image.jpg"; }
            if (options === void 0) { options = {}; }
            return __generator(this, function (_d) {
                switch (_d.label) {
                    case 0:
                        formData = new FormData();
                        uint8Array = new Uint8Array(imageBuffer);
                        blob = new Blob([uint8Array], { type: this.getMimeType(filename) });
                        formData.append("file", blob, filename);
                        url = new URL("".concat(this.baseUrl, "/detect"));
                        if (options.confidence !== undefined) {
                            url.searchParams.set("confidence", options.confidence.toString());
                        }
                        if (options.includePerson !== undefined) {
                            url.searchParams.set("include_person", options.includePerson.toString());
                        }
                        if (options.normalizedBoxes !== undefined) {
                            url.searchParams.set("normalized_boxes", options.normalizedBoxes.toString());
                        }
                        if (options.includeMasks !== undefined) {
                            url.searchParams.set("include_masks", options.includeMasks.toString());
                        }
                        // Preprocessing options for cluttered backgrounds
                        if ((_a = options.preprocessing) === null || _a === void 0 ? void 0 : _a.enhanceContrast) {
                            url.searchParams.set("enhance_contrast", "true");
                        }
                        if ((_b = options.preprocessing) === null || _b === void 0 ? void 0 : _b.enhanceSharpness) {
                            url.searchParams.set("enhance_sharpness", "true");
                        }
                        if ((_c = options.preprocessing) === null || _c === void 0 ? void 0 : _c.bilateralFilter) {
                            url.searchParams.set("bilateral_filter", "true");
                        }
                        return [4 /*yield*/, fetch(url.toString(), {
                                method: "POST",
                                body: formData,
                                signal: AbortSignal.timeout(this.timeout),
                            })];
                    case 1:
                        response = _d.sent();
                        if (!!response.ok) return [3 /*break*/, 3];
                        return [4 /*yield*/, response.text()];
                    case 2:
                        error = _d.sent();
                        throw new Error("Detection failed: ".concat(response.status, " - ").concat(error));
                    case 3: return [2 /*return*/, response.json()];
                }
            });
        });
    };
    /**
     * Detect fashion items from a URL (downloads and sends to API)
     */
    YOLOv8Client.prototype.detectFromUrl = function (imageUrl_1) {
        return __awaiter(this, arguments, void 0, function (imageUrl, options) {
            var response, arrayBuffer, buffer, filename;
            if (options === void 0) { options = {}; }
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, fetch(imageUrl, {
                            signal: AbortSignal.timeout(10000),
                        })];
                    case 1:
                        response = _a.sent();
                        if (!response.ok) {
                            throw new Error("Failed to download image: ".concat(response.status));
                        }
                        return [4 /*yield*/, response.arrayBuffer()];
                    case 2:
                        arrayBuffer = _a.sent();
                        buffer = Buffer.from(arrayBuffer);
                        filename = imageUrl.split("/").pop() || "image.jpg";
                        return [2 /*return*/, this.detectFromBuffer(buffer, filename, options)];
                }
            });
        });
    };
    /**
     * Detect fashion items in multiple images
     */
    YOLOv8Client.prototype.detectBatch = function (images, confidence) {
        return __awaiter(this, void 0, void 0, function () {
            var formData, _i, images_1, img, uint8Array, blob, url, response, result;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        formData = new FormData();
                        for (_i = 0, images_1 = images; _i < images_1.length; _i++) {
                            img = images_1[_i];
                            uint8Array = new Uint8Array(img.buffer);
                            blob = new Blob([uint8Array], {
                                type: this.getMimeType(img.filename),
                            });
                            formData.append("files", blob, img.filename);
                        }
                        url = new URL("".concat(this.baseUrl, "/detect/batch"));
                        if (confidence !== undefined) {
                            url.searchParams.set("confidence", confidence.toString());
                        }
                        return [4 /*yield*/, fetch(url.toString(), {
                                method: "POST",
                                body: formData,
                                signal: AbortSignal.timeout(this.timeout * images.length),
                            })];
                    case 1:
                        response = _a.sent();
                        if (!response.ok) {
                            throw new Error("Batch detection failed: ".concat(response.status));
                        }
                        return [4 /*yield*/, response.json()];
                    case 2:
                        result = _a.sent();
                        return [2 /*return*/, result.results];
                }
            });
        });
    };
    /**
     * Reload the YOLO model
     */
    YOLOv8Client.prototype.reload = function () {
        return __awaiter(this, void 0, void 0, function () {
            var response;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, fetch("".concat(this.baseUrl, "/reload"), {
                            method: "POST",
                            signal: AbortSignal.timeout(30000),
                        })];
                    case 1:
                        response = _a.sent();
                        if (!response.ok) {
                            throw new Error("Model reload failed: ".concat(response.status));
                        }
                        return [2 /*return*/, response.json()];
                }
            });
        });
    };
    /**
     * Get MIME type from filename
     */
    YOLOv8Client.prototype.getMimeType = function (filename) {
        var ext = filename.toLowerCase().split(".").pop();
        switch (ext) {
            case "png":
                return "image/png";
            case "webp":
                return "image/webp";
            case "gif":
                return "image/gif";
            default:
                return "image/jpeg";
        }
    };
    return YOLOv8Client;
}());
exports.YOLOv8Client = YOLOv8Client;
// ============================================================================
// Singleton Instance
// ============================================================================
var clientInstance = null;
function getYOLOv8Client() {
    if (!clientInstance) {
        clientInstance = new YOLOv8Client();
    }
    return clientInstance;
}
// ============================================================================
// Utility Functions
// ============================================================================
/**
 * Filter detections by category
 */
function filterByCategory(detections, categories) {
    var categorySet = new Set(categories.map(function (c) { return c.toLowerCase(); }));
    return detections.filter(function (d) { return categorySet.has(d.label.toLowerCase()); });
}
/**
 * Filter detections by minimum confidence
 */
function filterByConfidence(detections, minConfidence) {
    return detections.filter(function (d) { return d.confidence >= minConfidence; });
}
/**
 * Get the primary (largest) detection
 */
function getPrimaryDetection(detections) {
    if (detections.length === 0)
        return null;
    return detections.reduce(function (prev, curr) {
        return curr.area_ratio > prev.area_ratio ? curr : prev;
    });
}
/**
 * Group detections by category
 */
function groupByCategory(detections) {
    return detections.reduce(function (acc, detection) {
        var category = detection.label;
        if (!acc[category]) {
            acc[category] = [];
        }
        acc[category].push(detection);
        return acc;
    }, {});
}
/**
 * Extract outfit composition from detections
 */
function extractOutfitComposition(detections) {
    var tops = filterByCategory(detections, [
        "shirt",
        "tshirt",
        "blouse",
        "sweater",
        "hoodie",
        "sweatshirt",
        "cardigan",
        "tank_top",
        "crop_top",
        "top",
    ]);
    var bottoms = filterByCategory(detections, [
        "jeans",
        "pants",
        "shorts",
        "skirt",
        "leggings",
    ]);
    var dresses = filterByCategory(detections, [
        "dress",
        "gown",
        "maxi_dress",
        "mini_dress",
        "midi_dress",
    ]);
    var outerwear = filterByCategory(detections, [
        "jacket",
        "coat",
        "blazer",
        "parka",
        "bomber",
    ]);
    var footwear = filterByCategory(detections, [
        "sneakers",
        "boots",
        "heels",
        "sandals",
        "loafers",
        "flats",
    ]);
    var bags = filterByCategory(detections, [
        "bag",
        "backpack",
        "clutch",
        "tote",
        "crossbody",
    ]);
    var accessories = filterByCategory(detections, [
        "hat",
        "sunglasses",
        "watch",
        "belt",
        "tie",
        "scarf",
        "gloves",
        "necklace",
        "bracelet",
        "earrings",
        "ring",
        "jewelry",
    ]);
    return { tops: tops, bottoms: bottoms, dresses: dresses, outerwear: outerwear, footwear: footwear, bags: bags, accessories: accessories };
}
