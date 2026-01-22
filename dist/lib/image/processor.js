"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
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
const sharp_1 = __importDefault(require("sharp"));
const clip_1 = require("./clip");
const utils_1 = require("./utils");
/**
 * Process an uploaded image and generate CLIP embedding
 */
async function processImageForEmbedding(imageBuffer) {
    if (!(0, clip_1.isClipAvailable)()) {
        throw new Error("CLIP model not available. Run 'npx tsx scripts/download-clip.ts' first.");
    }
    // Use sharp to decode and resize image
    const { data, info } = await (0, sharp_1.default)(imageBuffer)
        .resize(224, 224, { fit: "cover" })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    // Preprocess for CLIP
    const preprocessed = (0, clip_1.preprocessImage)(new Uint8Array(data), info.width, info.height, info.channels);
    // Generate embedding
    const embedding = await (0, clip_1.getImageEmbedding)(preprocessed);
    return embedding;
}
/**
 * Validate image buffer
 */
async function validateImage(buffer) {
    try {
        const metadata = await (0, sharp_1.default)(buffer).metadata();
        if (!metadata.format) {
            return { valid: false, error: "Unknown image format" };
        }
        const allowedFormats = ["jpeg", "jpg", "png", "webp", "gif"];
        if (!allowedFormats.includes(metadata.format)) {
            return { valid: false, error: `Format ${metadata.format} not supported` };
        }
        if (!metadata.width || !metadata.height) {
            return { valid: false, error: "Could not determine image dimensions" };
        }
        // Reject very small images
        if (metadata.width < 32 || metadata.height < 32) {
            return { valid: false, error: "Image too small (min 32x32)" };
        }
        // Reject very large images
        if (metadata.width > 8000 || metadata.height > 8000) {
            return { valid: false, error: "Image too large (max 8000x8000)" };
        }
        return { valid: true };
    }
    catch (error) {
        return { valid: false, error: "Invalid or corrupted image" };
    }
}
/**
 * Compute perceptual hash (pHash) for an image buffer
 */
async function computePHash(buffer) {
    return (0, utils_1.pHash)(buffer);
}
/**
 * Load and normalize image into Float32Array CHW format
 */
async function loadAndNormalize(buffer, targetWidth = 224, targetHeight = 224) {
    const sharpImg = (0, sharp_1.default)(buffer).resize(targetWidth, targetHeight, { fit: "cover" }).removeAlpha().raw();
    const { data, info } = await sharpImg.toBuffer({ resolveWithObject: true });
    const normalized = (0, utils_1.normalizeImage)(data, info.width, info.height, info.channels, {
        mean: [0.48145466, 0.4578275, 0.40821073],
        std: [0.26862954, 0.26130258, 0.27577711],
    });
    return { normalized, width: info.width, height: info.height, channels: info.channels };
}
/**
 * Initialize image processing (loads CLIP model)
 */
async function initImageProcessing() {
    if ((0, clip_1.isClipAvailable)()) {
        await (0, clip_1.initClip)();
    }
}
