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
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.initClip = initClip;
exports.isClipAvailable = isClipAvailable;
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
 */
const ort = __importStar(require("onnxruntime-node"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const MODEL_DIR = path.join(process.cwd(), "models");
const IMAGE_MODEL_PATH = path.join(MODEL_DIR, "clip-image-vit-32.onnx");
const TEXT_MODEL_PATH = path.join(MODEL_DIR, "clip-text-vit-32.onnx");
let imageSession = null;
let textSession = null;
// CLIP ViT-B/32 constants
const IMAGE_SIZE = 224;
const EMBEDDING_DIM = 512;
// ImageNet normalization values
const MEAN = [0.48145466, 0.4578275, 0.40821073];
const STD = [0.26862954, 0.26130258, 0.27577711];
/**
 * Initialize CLIP models
 */
async function initClip() {
    if (!fs.existsSync(IMAGE_MODEL_PATH)) {
        throw new Error(`CLIP image model not found at ${IMAGE_MODEL_PATH}. Run 'npx tsx scripts/download-clip.ts' first.`);
    }
    if (!imageSession) {
        console.log("Loading CLIP image model...");
        imageSession = await ort.InferenceSession.create(IMAGE_MODEL_PATH);
        console.log("CLIP image model loaded");
    }
    if (fs.existsSync(TEXT_MODEL_PATH) && !textSession) {
        console.log("Loading CLIP text model...");
        textSession = await ort.InferenceSession.create(TEXT_MODEL_PATH);
        console.log("CLIP text model loaded");
    }
}
/**
 * Check if CLIP models are available
 */
function isClipAvailable() {
    return fs.existsSync(IMAGE_MODEL_PATH);
}
/**
 * Preprocess image buffer for CLIP
 * Expects RGB image data, resizes to 224x224, normalizes
 */
function preprocessImage(imageData, width, height, channels = 3) {
    // Simple bilinear resize to 224x224
    const resized = resizeImage(imageData, width, height, channels, IMAGE_SIZE, IMAGE_SIZE);
    // Normalize and convert to CHW format (channels first)
    const normalized = new Float32Array(3 * IMAGE_SIZE * IMAGE_SIZE);
    for (let c = 0; c < 3; c++) {
        for (let h = 0; h < IMAGE_SIZE; h++) {
            for (let w = 0; w < IMAGE_SIZE; w++) {
                const srcIdx = (h * IMAGE_SIZE + w) * channels + c;
                const dstIdx = c * IMAGE_SIZE * IMAGE_SIZE + h * IMAGE_SIZE + w;
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
    const dst = new Uint8Array(dstW * dstH * channels);
    const xRatio = srcW / dstW;
    const yRatio = srcH / dstH;
    for (let y = 0; y < dstH; y++) {
        for (let x = 0; x < dstW; x++) {
            const srcX = Math.min(Math.floor(x * xRatio), srcW - 1);
            const srcY = Math.min(Math.floor(y * yRatio), srcH - 1);
            for (let c = 0; c < channels; c++) {
                dst[(y * dstW + x) * channels + c] = src[(srcY * srcW + srcX) * channels + c];
            }
        }
    }
    return dst;
}
/**
 * Generate image embedding from preprocessed image data
 */
async function getImageEmbedding(preprocessedImage) {
    if (!imageSession) {
        await initClip();
    }
    if (!imageSession) {
        throw new Error("CLIP image model not loaded");
    }
    // Create input tensor [1, 3, 224, 224]
    const inputTensor = new ort.Tensor("float32", preprocessedImage, [1, 3, IMAGE_SIZE, IMAGE_SIZE]);
    // Run inference
    const results = await imageSession.run({ input: inputTensor });
    // Get output embedding
    const outputName = imageSession.outputNames[0];
    const embedding = Array.from(results[outputName].data);
    // L2 normalize the embedding
    return normalizeVector(embedding);
}
/**
 * Generate image embedding directly from raw image buffer
 */
async function getImageEmbeddingFromBuffer(imageBuffer, width, height, channels = 3) {
    const preprocessed = preprocessImage(new Uint8Array(imageBuffer), width, height, channels);
    return getImageEmbedding(preprocessed);
}
/**
 * Generate text embedding (if text model is available)
 */
async function getTextEmbedding(text) {
    if (!textSession) {
        throw new Error("CLIP text model not loaded. Text search not available.");
    }
    // Simple tokenization (real CLIP uses BPE tokenizer)
    const tokens = simpleTokenize(text);
    const inputTensor = new ort.Tensor("int32", new Int32Array(tokens), [1, tokens.length]);
    const results = await textSession.run({ input: inputTensor });
    const outputName = textSession.outputNames[0];
    const embedding = Array.from(results[outputName].data);
    return normalizeVector(embedding);
}
/**
 * Simple tokenizer placeholder
 * In production, use proper CLIP BPE tokenizer
 */
function simpleTokenize(text) {
    const maxLen = 77;
    const tokens = new Array(maxLen).fill(0);
    tokens[0] = 49406; // <start>
    const chars = text.toLowerCase().slice(0, maxLen - 2).split("");
    for (let i = 0; i < chars.length; i++) {
        tokens[i + 1] = chars[i].charCodeAt(0);
    }
    tokens[chars.length + 1] = 49407; // <end>
    return tokens;
}
/**
 * L2 normalize a vector
 */
function normalizeVector(vec) {
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    if (norm === 0)
        return vec;
    return vec.map((v) => v / norm);
}
/**
 * Cosine similarity between two vectors
 */
function cosineSimilarity(a, b) {
    if (a.length !== b.length) {
        throw new Error("Vectors must have same length");
    }
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
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
