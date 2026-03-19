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
Object.defineProperty(exports, "__esModule", { value: true });
exports.processImageForEmbedding = processImageForEmbedding;
exports.validateImage = validateImage;
exports.computePHash = computePHash;
exports.loadAndNormalize = loadAndNormalize;
exports.initImageProcessing = initImageProcessing;
/**
 * Image Processor
 *
 * High-level image processing: CLIP embeddings, validation, pHash.
 */
var sharp_1 = require("sharp");
// `sharp` is CommonJS callable, but TS/Node interop may expose it as `sharp.default`.
// Ensure `.default` is callable to match transpiled call sites.
if (typeof sharp_1.default !== "function") {
    sharp_1.default = sharp_1;
}
var clip_1 = require("./clip");
var utils_1 = require("./utils");
/**
 * Process an uploaded image and generate CLIP embedding
 */
function processImageForEmbedding(imageBuffer) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, data, info, preprocessed, embedding;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    if (!(0, clip_1.isClipAvailable)()) {
                        throw new Error("CLIP model not available. Run 'npx tsx scripts/download-clip.ts' first.");
                    }
                    return [4 /*yield*/, (0, sharp_1.default)(imageBuffer)
                            .resize(224, 224, { fit: "cover" })
                            .removeAlpha()
                            .raw()
                            .toBuffer({ resolveWithObject: true })];
                case 1:
                    _a = _b.sent(), data = _a.data, info = _a.info;
                    preprocessed = (0, clip_1.preprocessImage)(new Uint8Array(data), info.width, info.height, info.channels);
                    return [4 /*yield*/, (0, clip_1.getImageEmbedding)(preprocessed)];
                case 2:
                    embedding = _b.sent();
                    return [2 /*return*/, embedding];
            }
        });
    });
}
/**
 * Validate image buffer
 */
function validateImage(buffer) {
    return __awaiter(this, void 0, void 0, function () {
        var metadata, allowedFormats, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, (0, sharp_1.default)(buffer).metadata()];
                case 1:
                    metadata = _a.sent();
                    if (!metadata.format) {
                        return [2 /*return*/, { valid: false, error: "Unknown image format" }];
                    }
                    allowedFormats = ["jpeg", "jpg", "png", "webp", "gif"];
                    if (!allowedFormats.includes(metadata.format)) {
                        return [2 /*return*/, { valid: false, error: "Format ".concat(metadata.format, " not supported") }];
                    }
                    if (!metadata.width || !metadata.height) {
                        return [2 /*return*/, { valid: false, error: "Could not determine image dimensions" }];
                    }
                    // Reject very small images
                    if (metadata.width < 32 || metadata.height < 32) {
                        return [2 /*return*/, { valid: false, error: "Image too small (min 32x32)" }];
                    }
                    // Reject very large images
                    if (metadata.width > 8000 || metadata.height > 8000) {
                        return [2 /*return*/, { valid: false, error: "Image too large (max 8000x8000)" }];
                    }
                    return [2 /*return*/, { valid: true }];
                case 2:
                    error_1 = _a.sent();
                    return [2 /*return*/, { valid: false, error: "Invalid or corrupted image" }];
                case 3: return [2 /*return*/];
            }
        });
    });
}
/**
 * Compute perceptual hash (pHash) for an image buffer
 */
function computePHash(buffer) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, (0, utils_1.pHash)(buffer)];
        });
    });
}
/**
 * Load and normalize image into Float32Array CHW format
 */
function loadAndNormalize(buffer_1) {
    return __awaiter(this, arguments, void 0, function (buffer, targetWidth, targetHeight) {
        var sharpImg, _a, data, info, normalized;
        if (targetWidth === void 0) { targetWidth = 224; }
        if (targetHeight === void 0) { targetHeight = 224; }
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    sharpImg = (0, sharp_1.default)(buffer).resize(targetWidth, targetHeight, { fit: "cover" }).removeAlpha().raw();
                    return [4 /*yield*/, sharpImg.toBuffer({ resolveWithObject: true })];
                case 1:
                    _a = _b.sent(), data = _a.data, info = _a.info;
                    normalized = (0, utils_1.normalizeImage)(data, info.width, info.height, info.channels, {
                        mean: [0.48145466, 0.4578275, 0.40821073],
                        std: [0.26862954, 0.26130258, 0.27577711],
                    });
                    return [2 /*return*/, { normalized: normalized, width: info.width, height: info.height, channels: info.channels }];
            }
        });
    });
}
/**
 * Initialize image processing (loads CLIP model)
 */
function initImageProcessing() {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!(0, clip_1.isClipAvailable)()) return [3 /*break*/, 2];
                    return [4 /*yield*/, (0, clip_1.initClip)()];
                case 1:
                    _a.sent();
                    _a.label = 2;
                case 2: return [2 /*return*/];
            }
        });
    });
}
