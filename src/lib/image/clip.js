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
exports.initClip = initClip;
exports.isClipAvailable = isClipAvailable;
exports.getModelInfo = getModelInfo;
exports.listAvailableModels = listAvailableModels;
exports.preprocessImage = preprocessImage;
exports.getImageEmbedding = getImageEmbedding;
exports.getImageEmbeddingFromBuffer = getImageEmbeddingFromBuffer;
exports.getTextEmbedding = getTextEmbedding;
exports.cosineSimilarity = cosineSimilarity;
exports.getEmbeddingDimension = getEmbeddingDimension;
/**
 * CLIP Model Service
 *
 * CLIP (Contrastive Language-Image Pre-training) model for image embeddings.
 *
 * Supported models (in order of preference for fashion):
 * 1. Fashion-CLIP (patrickjohncyh/fashion-clip) - Best for apparel details
 * 2. ViT-L/14 - Higher accuracy, larger embeddings (768-dim)
 * 3. ViT-B/32 - Baseline model (512-dim) - LEGACY
 *
 * Set CLIP_MODEL_TYPE env var to: "fashion-clip", "vit-l-14", or "vit-b-32"
 */
var ort = require("onnxruntime-node");
var fs = require("fs");
var path = require("path");
var MODEL_DIR = path.join(process.cwd(), "models");
var MODEL_CONFIGS = {
    "fashion-clip": {
        name: "Fashion-CLIP (ViT-B/32 fine-tuned)",
        imageModelFile: "fashion-clip-image.onnx",
        textModelFile: "fashion-clip-text.onnx",
        imageSize: 224,
        embeddingDim: 512,
        description: "Fine-tuned on fashion data - best for apparel details, fabric textures, styles",
    },
    "vit-l-14": {
        name: "CLIP ViT-L/14",
        imageModelFile: "clip-image-vit-l-14.onnx",
        textModelFile: "clip-text-vit-l-14.onnx",
        imageSize: 224,
        embeddingDim: 768,
        description: "Larger model with higher accuracy and 768-dim embeddings",
    },
    "vit-b-32": {
        name: "CLIP ViT-B/32 (Legacy)",
        imageModelFile: "clip-image-vit-32.onnx",
        textModelFile: "clip-text-vit-32.onnx",
        imageSize: 224,
        embeddingDim: 512,
        description: "Baseline model - faster but less accurate for subtle details",
    },
};
var MIN_BYTES_BY_MODEL_FILE = {
    "fashion-clip-image.onnx": 200 * 1024 * 1024,
    "fashion-clip-text.onnx": 120 * 1024 * 1024,
    "clip-image-vit-l-14.onnx": 900 * 1024 * 1024,
    "clip-text-vit-l-14.onnx": 300 * 1024 * 1024,
    "clip-image-vit-32.onnx": 250 * 1024 * 1024,
    "clip-text-vit-32.onnx": 120 * 1024 * 1024,
};
function isUsableModelFile(filePath) {
    var _a;
    try {
        var stat = fs.statSync(filePath);
        var minBytes = (_a = MIN_BYTES_BY_MODEL_FILE[path.basename(filePath)]) !== null && _a !== void 0 ? _a : 1;
        return stat.isFile() && stat.size >= minBytes;
    }
    catch (_b) {
        return false;
    }
}
// Determine which model to use (priority: env var > fashion-clip > vit-l-14 > vit-b-32)
function getActiveModelType() {
    var envModel = process.env.CLIP_MODEL_TYPE;
    if (envModel && MODEL_CONFIGS[envModel]) {
        var envConfig = MODEL_CONFIGS[envModel];
        var envModelPath = path.join(MODEL_DIR, envConfig.imageModelFile);
        if (isUsableModelFile(envModelPath)) {
            return envModel;
        }
        console.warn("Requested CLIP_MODEL_TYPE=".concat(envModel, ", but model file is missing/empty: ").concat(envModelPath));
    }
    // Auto-detect: prefer fashion-clip > vit-l-14 > vit-b-32
    var priority = ["fashion-clip", "vit-l-14", "vit-b-32"];
    for (var _i = 0, priority_1 = priority; _i < priority_1.length; _i++) {
        var modelType = priority_1[_i];
        var config = MODEL_CONFIGS[modelType];
        var modelPath = path.join(MODEL_DIR, config.imageModelFile);
        if (isUsableModelFile(modelPath)) {
            return modelType;
        }
    }
    return "vit-b-32"; // Default fallback
}
var activeModelType = getActiveModelType();
var activeConfig = MODEL_CONFIGS[activeModelType];
// Model paths (dynamically set based on active model)
var getImageModelPath = function () { return path.join(MODEL_DIR, activeConfig.imageModelFile); };
var getTextModelPath = function () { return path.join(MODEL_DIR, activeConfig.textModelFile); };
var imageSession = null;
var textSession = null;
// Dynamic model constants
var IMAGE_SIZE = activeConfig.imageSize;
var EMBEDDING_DIM = activeConfig.embeddingDim;
// ImageNet normalization values (same for all CLIP variants)
var MEAN = [0.48145466, 0.4578275, 0.40821073];
var STD = [0.26862954, 0.26130258, 0.27577711];
/**
 * Initialize CLIP models
 */
function initClip(modelType) {
    return __awaiter(this, void 0, void 0, function () {
        var imageModelPath, textModelPath;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    // Allow explicit model selection
                    if (modelType && MODEL_CONFIGS[modelType]) {
                        activeModelType = modelType;
                        activeConfig = MODEL_CONFIGS[modelType];
                        IMAGE_SIZE = activeConfig.imageSize;
                        EMBEDDING_DIM = activeConfig.embeddingDim;
                    }
                    else {
                        // Re-detect best available model
                        activeModelType = getActiveModelType();
                        activeConfig = MODEL_CONFIGS[activeModelType];
                        IMAGE_SIZE = activeConfig.imageSize;
                        EMBEDDING_DIM = activeConfig.embeddingDim;
                    }
                    imageModelPath = getImageModelPath();
                    textModelPath = getTextModelPath();
                    if (!isUsableModelFile(imageModelPath)) {
                        throw new Error("CLIP image model missing/invalid at ".concat(imageModelPath, ". Run 'npx tsx scripts/download-clip.ts' first.\n") +
                            "Available models: fashion-clip, vit-l-14, vit-b-32");
                    }
                    // Reset sessions if switching models
                    if (imageSession) {
                        imageSession = null;
                    }
                    if (textSession) {
                        textSession = null;
                    }
                    if (!!imageSession) return [3 /*break*/, 2];
                    console.log("Loading ".concat(activeConfig.name, " image model..."));
                    console.log("  - Embedding dimension: ".concat(EMBEDDING_DIM));
                    console.log("  - ".concat(activeConfig.description));
                    return [4 /*yield*/, ort.InferenceSession.create(imageModelPath, { executionProviders: ["cpu"] })];
                case 1:
                    imageSession = _a.sent();
                    console.log("".concat(activeConfig.name, " image model loaded"));
                    _a.label = 2;
                case 2:
                    if (!(fs.existsSync(textModelPath) && !textSession)) return [3 /*break*/, 4];
                    console.log("Loading ".concat(activeConfig.name, " text model..."));
                    return [4 /*yield*/, ort.InferenceSession.create(textModelPath, { executionProviders: ["cpu"] })];
                case 3:
                    textSession = _a.sent();
                    console.log("".concat(activeConfig.name, " text model loaded"));
                    _a.label = 4;
                case 4: return [2 /*return*/];
            }
        });
    });
}
/**
 * Check if CLIP models are available
 */
function isClipAvailable() {
    return isUsableModelFile(getImageModelPath());
}
/**
 * Get current model info
 */
function getModelInfo() {
    return { type: activeModelType, config: activeConfig };
}
/**
 * List available models (downloaded)
 */
function listAvailableModels() {
    return Object.keys(MODEL_CONFIGS).map(function (type) { return ({
        type: type,
        available: isUsableModelFile(path.join(MODEL_DIR, MODEL_CONFIGS[type].imageModelFile)),
        config: MODEL_CONFIGS[type],
    }); });
}
/**
 * Preprocess image buffer for CLIP
 * Expects RGB image data, resizes to 224x224, normalizes
 */
function preprocessImage(imageData, width, height, channels) {
    if (channels === void 0) { channels = 3; }
    // Simple bilinear resize to 224x224
    var resized = resizeImage(imageData, width, height, channels, IMAGE_SIZE, IMAGE_SIZE);
    // Normalize and convert to CHW format (channels first)
    var normalized = new Float32Array(3 * IMAGE_SIZE * IMAGE_SIZE);
    for (var c = 0; c < 3; c++) {
        for (var h = 0; h < IMAGE_SIZE; h++) {
            for (var w = 0; w < IMAGE_SIZE; w++) {
                var srcIdx = (h * IMAGE_SIZE + w) * channels + c;
                var dstIdx = c * IMAGE_SIZE * IMAGE_SIZE + h * IMAGE_SIZE + w;
                // Normalize: (pixel/255 - mean) / std
                normalized[dstIdx] = (resized[srcIdx] / 255.0 - MEAN[c]) / STD[c];
            }
        }
    }
    return normalized;
}
/**
 * Simple bilinear image resize
 */
function resizeImage(src, srcW, srcH, channels, dstW, dstH) {
    var dst = new Uint8Array(dstW * dstH * channels);
    var xRatio = srcW / dstW;
    var yRatio = srcH / dstH;
    for (var y = 0; y < dstH; y++) {
        for (var x = 0; x < dstW; x++) {
            var srcX = Math.min(Math.floor(x * xRatio), srcW - 1);
            var srcY = Math.min(Math.floor(y * yRatio), srcH - 1);
            for (var c = 0; c < channels; c++) {
                dst[(y * dstW + x) * channels + c] = src[(srcY * srcW + srcX) * channels + c];
            }
        }
    }
    return dst;
}
/**
 * Generate image embedding from preprocessed image data
 */
function getImageEmbedding(preprocessedImage) {
    return __awaiter(this, void 0, void 0, function () {
        var inputTensor, inputName, feeds, results, outputName, embedding;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    if (!!imageSession) return [3 /*break*/, 2];
                    return [4 /*yield*/, initClip()];
                case 1:
                    _b.sent();
                    _b.label = 2;
                case 2:
                    if (!imageSession) {
                        throw new Error("CLIP image model not loaded");
                    }
                    inputTensor = new ort.Tensor("float32", preprocessedImage, [1, 3, IMAGE_SIZE, IMAGE_SIZE]);
                    inputName = imageSession.inputNames[0];
                    feeds = (_a = {}, _a[inputName] = inputTensor, _a);
                    return [4 /*yield*/, imageSession.run(feeds)];
                case 3:
                    results = _b.sent();
                    outputName = imageSession.outputNames[0];
                    embedding = Array.from(results[outputName].data);
                    // L2 normalize the embedding
                    return [2 /*return*/, normalizeVector(embedding)];
            }
        });
    });
}
/**
 * Generate image embedding directly from raw image buffer
 */
function getImageEmbeddingFromBuffer(imageBuffer_1, width_1, height_1) {
    return __awaiter(this, arguments, void 0, function (imageBuffer, width, height, channels) {
        var preprocessed;
        if (channels === void 0) { channels = 3; }
        return __generator(this, function (_a) {
            preprocessed = preprocessImage(new Uint8Array(imageBuffer), width, height, channels);
            return [2 /*return*/, getImageEmbedding(preprocessed)];
        });
    });
}
/**
 * Generate text embedding (if text model is available)
 */
function getTextEmbedding(text) {
    return __awaiter(this, void 0, void 0, function () {
        var tokens, inputTensor, inputName, feeds, results, outputName, embedding;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    if (!textSession) {
                        throw new Error("CLIP text model not loaded. Text search not available.");
                    }
                    tokens = simpleTokenize(text);
                    inputTensor = new ort.Tensor("int32", new Int32Array(tokens), [1, tokens.length]);
                    inputName = textSession.inputNames[0];
                    feeds = (_a = {}, _a[inputName] = inputTensor, _a);
                    return [4 /*yield*/, textSession.run(feeds)];
                case 1:
                    results = _b.sent();
                    outputName = textSession.outputNames[0];
                    embedding = Array.from(results[outputName].data);
                    return [2 /*return*/, normalizeVector(embedding)];
            }
        });
    });
}
/**
 * Simple tokenizer placeholder
 * In production, use proper CLIP BPE tokenizer
 */
function simpleTokenize(text) {
    var maxLen = 77;
    var tokens = new Array(maxLen).fill(0);
    tokens[0] = 49406; // <start>
    var chars = text.toLowerCase().slice(0, maxLen - 2).split("");
    for (var i = 0; i < chars.length; i++) {
        tokens[i + 1] = chars[i].charCodeAt(0);
    }
    tokens[chars.length + 1] = 49407; // <end>
    return tokens;
}
/**
 * L2 normalize a vector
 */
function normalizeVector(vec) {
    var norm = Math.sqrt(vec.reduce(function (sum, v) { return sum + v * v; }, 0));
    if (norm === 0)
        return vec;
    return vec.map(function (v) { return v / norm; });
}
/**
 * Cosine similarity between two vectors
 */
function cosineSimilarity(a, b) {
    if (a.length !== b.length) {
        throw new Error("Vectors must have same length");
    }
    var dot = 0;
    var normA = 0;
    var normB = 0;
    for (var i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
/**
 * Get embedding dimension
 */
function getEmbeddingDimension() {
    return EMBEDDING_DIM;
}
