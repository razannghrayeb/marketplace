"use strict";
/**
 * Image Module Exports
 *
 * Image processing, storage, and embeddings.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCdnUrl = exports.deleteImage = exports.imageExists = exports.getSignedImageUrl = exports.uploadImageFromUrl = exports.uploadImage = exports.generateImageKey = exports.r2Client = exports.initImageProcessing = exports.loadAndNormalize = exports.computePHash = exports.validateImage = exports.processImageForEmbedding = exports.pHash = exports.normalizeImage = exports.loadImage = exports.getEmbeddingDimension = exports.cosineSimilarity = exports.getTextEmbedding = exports.getImageEmbeddingFromBuffer = exports.getImageEmbedding = exports.preprocessImage = exports.isClipAvailable = exports.initClip = void 0;
// CLIP embeddings
var clip_1 = require("./clip");
Object.defineProperty(exports, "initClip", { enumerable: true, get: function () { return clip_1.initClip; } });
Object.defineProperty(exports, "isClipAvailable", { enumerable: true, get: function () { return clip_1.isClipAvailable; } });
Object.defineProperty(exports, "preprocessImage", { enumerable: true, get: function () { return clip_1.preprocessImage; } });
Object.defineProperty(exports, "getImageEmbedding", { enumerable: true, get: function () { return clip_1.getImageEmbedding; } });
Object.defineProperty(exports, "getImageEmbeddingFromBuffer", { enumerable: true, get: function () { return clip_1.getImageEmbeddingFromBuffer; } });
Object.defineProperty(exports, "getTextEmbedding", { enumerable: true, get: function () { return clip_1.getTextEmbedding; } });
Object.defineProperty(exports, "cosineSimilarity", { enumerable: true, get: function () { return clip_1.cosineSimilarity; } });
Object.defineProperty(exports, "getEmbeddingDimension", { enumerable: true, get: function () { return clip_1.getEmbeddingDimension; } });
// Image utilities
var utils_1 = require("./utils");
Object.defineProperty(exports, "loadImage", { enumerable: true, get: function () { return utils_1.loadImage; } });
Object.defineProperty(exports, "normalizeImage", { enumerable: true, get: function () { return utils_1.normalizeImage; } });
Object.defineProperty(exports, "pHash", { enumerable: true, get: function () { return utils_1.pHash; } });
// Image processor
var processor_1 = require("./processor");
Object.defineProperty(exports, "processImageForEmbedding", { enumerable: true, get: function () { return processor_1.processImageForEmbedding; } });
Object.defineProperty(exports, "validateImage", { enumerable: true, get: function () { return processor_1.validateImage; } });
Object.defineProperty(exports, "computePHash", { enumerable: true, get: function () { return processor_1.computePHash; } });
Object.defineProperty(exports, "loadAndNormalize", { enumerable: true, get: function () { return processor_1.loadAndNormalize; } });
Object.defineProperty(exports, "initImageProcessing", { enumerable: true, get: function () { return processor_1.initImageProcessing; } });
// R2 storage
var r2_1 = require("./r2");
Object.defineProperty(exports, "r2Client", { enumerable: true, get: function () { return r2_1.r2Client; } });
Object.defineProperty(exports, "generateImageKey", { enumerable: true, get: function () { return r2_1.generateImageKey; } });
Object.defineProperty(exports, "uploadImage", { enumerable: true, get: function () { return r2_1.uploadImage; } });
Object.defineProperty(exports, "uploadImageFromUrl", { enumerable: true, get: function () { return r2_1.uploadImageFromUrl; } });
Object.defineProperty(exports, "getSignedImageUrl", { enumerable: true, get: function () { return r2_1.getSignedImageUrl; } });
Object.defineProperty(exports, "imageExists", { enumerable: true, get: function () { return r2_1.imageExists; } });
Object.defineProperty(exports, "deleteImage", { enumerable: true, get: function () { return r2_1.deleteImage; } });
Object.defineProperty(exports, "getCdnUrl", { enumerable: true, get: function () { return r2_1.getCdnUrl; } });
