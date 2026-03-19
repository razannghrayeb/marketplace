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
import * as ort from "onnxruntime-node";
import * as fs from "fs";
import * as path from "path";
import { withCircuitBreaker } from "../core/circuitBreaker";

// ============================================================================
// CLIP BPE Tokenizer (lazy-loaded from @xenova/transformers)
// ============================================================================

let clipTokenizer: any = null;
let tokenizerInitPromise: Promise<void> | null = null;

async function ensureTokenizer(): Promise<void> {
  if (clipTokenizer) return;
  if (tokenizerInitPromise) return tokenizerInitPromise;

  tokenizerInitPromise = (async () => {
    try {
      const { AutoTokenizer } = await import("@xenova/transformers");
      clipTokenizer = await AutoTokenizer.from_pretrained(
        "Xenova/clip-vit-base-patch32"
      );
      console.log("[CLIP] BPE tokenizer loaded (Xenova/clip-vit-base-patch32)");
    } catch (err) {
      console.warn("[CLIP] Failed to load BPE tokenizer, falling back to simple tokenizer:", err);
      tokenizerInitPromise = null;
    }
  })();

  return tokenizerInitPromise;
}

const MODEL_DIR = path.join(process.cwd(), "models");

// ============================================================================
// Model Configuration
// ============================================================================

export type ClipModelType = "fashion-clip" | "vit-l-14" | "vit-b-32";

interface ModelConfig {
  name: string;
  imageModelFile: string;
  textModelFile: string;
  imageSize: number;
  embeddingDim: number;
  description: string;
}

const MODEL_CONFIGS: Record<ClipModelType, ModelConfig> = {
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

const MIN_BYTES_BY_MODEL_FILE: Record<string, number> = {
  "fashion-clip-image.onnx": 200 * 1024 * 1024,
  "fashion-clip-text.onnx": 120 * 1024 * 1024,
  "clip-image-vit-l-14.onnx": 900 * 1024 * 1024,
  "clip-text-vit-l-14.onnx": 300 * 1024 * 1024,
  "clip-image-vit-32.onnx": 250 * 1024 * 1024,
  "clip-text-vit-32.onnx": 120 * 1024 * 1024,
};

function isUsableModelFile(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    const minBytes = MIN_BYTES_BY_MODEL_FILE[path.basename(filePath)] ?? 1;
    return stat.isFile() && stat.size >= minBytes;
  } catch {
    return false;
  }
}

// Determine which model to use (priority: env var > fashion-clip > vit-l-14 > vit-b-32)
function getActiveModelType(): ClipModelType {
  const envModel = process.env.CLIP_MODEL_TYPE as ClipModelType;
  if (envModel && MODEL_CONFIGS[envModel]) {
    const envConfig = MODEL_CONFIGS[envModel];
    const envModelPath = path.join(MODEL_DIR, envConfig.imageModelFile);
    if (isUsableModelFile(envModelPath)) {
      return envModel;
    }
    console.warn(
      `[CLIP] Requested CLIP_MODEL_TYPE=${envModel}, but model file is missing/too small: ${envModelPath}`
    );
  }

  // Auto-detect: prefer fashion-clip > vit-l-14 > vit-b-32
  const priority: ClipModelType[] = ["fashion-clip", "vit-l-14", "vit-b-32"];
  for (const modelType of priority) {
    const config = MODEL_CONFIGS[modelType];
    const modelPath = path.join(MODEL_DIR, config.imageModelFile);
    if (isUsableModelFile(modelPath)) {
      return modelType;
    }
  }

  return "vit-b-32"; // Default fallback
}

let activeModelType: ClipModelType = getActiveModelType();
let activeConfig: ModelConfig = MODEL_CONFIGS[activeModelType];

// Model paths (dynamically set based on active model)
const getImageModelPath = () => path.join(MODEL_DIR, activeConfig.imageModelFile);
const getTextModelPath = () => path.join(MODEL_DIR, activeConfig.textModelFile);

let imageSession: ort.InferenceSession | null = null;
let textSession: ort.InferenceSession | null = null;

// Dynamic model constants
let IMAGE_SIZE = activeConfig.imageSize;
let EMBEDDING_DIM = activeConfig.embeddingDim;

// ImageNet normalization values (same for all CLIP variants)
const MEAN = [0.48145466, 0.4578275, 0.40821073];
const STD = [0.26862954, 0.26130258, 0.27577711];

// ============================================================================
// FIX: in-flight init guard — prevents parallel calls each triggering their
//      own InferenceSession.create() during concurrent startup requests
// ============================================================================
let initPromise: Promise<void> | null = null;

/**
 * Initialize CLIP models.
 * Safe to call multiple times — subsequent calls are no-ops once loaded.
 */
export async function initClip(modelType?: ClipModelType): Promise<void> {
  // If already initializing, wait for that to finish instead of double-loading
  if (initPromise) {
    return initPromise;
  }

  initPromise = _doInit(modelType).catch((err) => {
    // Reset so a retry is possible
    initPromise = null;
    throw err;
  });

  return initPromise;
}

async function _doInit(modelType?: ClipModelType): Promise<void> {
  // ── Diagnostics: always log what we see on disk ──────────────────────────
  console.log(`[CLIP] MODEL_DIR = ${MODEL_DIR}`);
  try {
    const files = fs.readdirSync(MODEL_DIR);
    console.log(`[CLIP] Files in model dir: ${files.join(", ")}`);
    for (const f of files) {
      const fp = path.join(MODEL_DIR, f);
      const stat = fs.statSync(fp);
      console.log(`[CLIP]   ${f} — ${(stat.size / 1024 / 1024).toFixed(1)} MB`);
    }
  } catch (e) {
    console.error(`[CLIP] ⚠️  Cannot read MODEL_DIR: ${e}`);
  }

  // ── Model selection ───────────────────────────────────────────────────────
  if (modelType && MODEL_CONFIGS[modelType]) {
    activeModelType = modelType;
    activeConfig = MODEL_CONFIGS[modelType];
    IMAGE_SIZE = activeConfig.imageSize;
    EMBEDDING_DIM = activeConfig.embeddingDim;
  } else {
    activeModelType = getActiveModelType();
    activeConfig = MODEL_CONFIGS[activeModelType];
    IMAGE_SIZE = activeConfig.imageSize;
    EMBEDDING_DIM = activeConfig.embeddingDim;
  }

  const imageModelPath = getImageModelPath();
  const textModelPath = getTextModelPath();

  console.log(`[CLIP] Selected model type : ${activeModelType}`);
  console.log(`[CLIP] Image model path    : ${imageModelPath}`);
  console.log(`[CLIP] Text  model path    : ${textModelPath}`);
  console.log(`[CLIP] Image model usable  : ${isUsableModelFile(imageModelPath)}`);
  console.log(`[CLIP] Text  model usable  : ${isUsableModelFile(textModelPath)}`);

  if (!isUsableModelFile(imageModelPath)) {
    throw new Error(
      `[CLIP] Image model missing or too small at: ${imageModelPath}\n` +
        `Available .onnx files in ${MODEL_DIR}: ` +
        (fs.existsSync(MODEL_DIR)
          ? fs
              .readdirSync(MODEL_DIR)
              .filter((f) => f.endsWith(".onnx"))
              .join(", ") || "none"
          : "directory does not exist")
    );
  }

  // ── Reset sessions if switching models ───────────────────────────────────
  imageSession = null;
  textSession = null;

  // ── Load image model ─────────────────────────────────────────────────────
  console.log(`[CLIP] Loading image model: ${activeConfig.name}...`);
  console.log(`[CLIP]   Embedding dim: ${EMBEDDING_DIM}`);
  console.log(`[CLIP]   ${activeConfig.description}`);
  // Force CPU in Cloud Run: avoid ONNX Runtime selecting unsupported GPU/DML devices.
  imageSession = await ort.InferenceSession.create(imageModelPath, {
    executionProviders: ["cpu"],
  });
  console.log(`[CLIP] ✅ Image model loaded`);

  // ── Load text model ───────────────────────────────────────────────────────
  // FIX: use isUsableModelFile (size-aware) instead of just fs.existsSync
  if (isUsableModelFile(textModelPath)) {
    console.log(`[CLIP] Loading text model: ${activeConfig.name}...`);
    // Force CPU in Cloud Run: avoid ONNX Runtime selecting unsupported GPU/DML devices.
    textSession = await ort.InferenceSession.create(textModelPath, {
      executionProviders: ["cpu"],
    });
    console.log(`[CLIP] ✅ Text model loaded`);

    // Pre-load BPE tokenizer so the first text embedding is fast
    console.log(`[CLIP] Loading BPE tokenizer...`);
    await ensureTokenizer();
  } else {
    console.warn(
      `[CLIP] ⚠️  Text model missing or too small at: ${textModelPath}. ` +
        `Text search will not be available.`
    );
  }
}

/**
 * Check if CLIP image model is available on disk
 */
export function isClipAvailable(): boolean {
  return isUsableModelFile(getImageModelPath());
}

/**
 * Check if CLIP text model is loaded and ready
 */
export function isTextSearchAvailable(): boolean {
  return textSession !== null;
}

/**
 * Get current model info
 */
export function getModelInfo(): { type: ClipModelType; config: ModelConfig } {
  return { type: activeModelType, config: activeConfig };
}

/**
 * List available models (downloaded)
 */
export function listAvailableModels(): Array<{
  type: ClipModelType;
  available: boolean;
  config: ModelConfig;
}> {
  return (Object.keys(MODEL_CONFIGS) as ClipModelType[]).map((type) => ({
    type,
    available: isUsableModelFile(path.join(MODEL_DIR, MODEL_CONFIGS[type].imageModelFile)),
    config: MODEL_CONFIGS[type],
  }));
}

/**
 * Preprocess image buffer for CLIP
 * Expects RGB image data, resizes to 224x224, normalizes
 */
export function preprocessImage(
  imageData: Uint8Array,
  width: number,
  height: number,
  channels: number = 3
): Float32Array {
  const resized = resizeImage(imageData, width, height, channels, IMAGE_SIZE, IMAGE_SIZE);

  const normalized = new Float32Array(3 * IMAGE_SIZE * IMAGE_SIZE);

  for (let c = 0; c < 3; c++) {
    for (let h = 0; h < IMAGE_SIZE; h++) {
      for (let w = 0; w < IMAGE_SIZE; w++) {
        const srcIdx = (h * IMAGE_SIZE + w) * channels + c;
        const dstIdx = c * IMAGE_SIZE * IMAGE_SIZE + h * IMAGE_SIZE + w;
        normalized[dstIdx] = (resized[srcIdx] / 255.0 - MEAN[c]) / STD[c];
      }
    }
  }

  return normalized;
}

/**
 * Simple bilinear image resize
 */
function resizeImage(
  src: Uint8Array,
  srcW: number,
  srcH: number,
  channels: number,
  dstW: number,
  dstH: number
): Uint8Array {
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
 * Generate image embedding from preprocessed image data.
 * Wrapped with a circuit breaker to fast-fail when ONNX is unhealthy.
 */
export async function getImageEmbedding(preprocessedImage: Float32Array): Promise<number[]> {
  return withCircuitBreaker("clip", async () => {
    if (!imageSession) {
      await initClip();
    }

    if (!imageSession) {
      throw new Error("[CLIP] Image model not loaded after initialization attempt.");
    }

    const inputTensor = new ort.Tensor("float32", preprocessedImage, [
      1,
      3,
      IMAGE_SIZE,
      IMAGE_SIZE,
    ]);

    const inputName = imageSession.inputNames[0];
    const feeds: Record<string, ort.Tensor> = { [inputName]: inputTensor };
    const results = await imageSession.run(feeds);

    const outputName = imageSession.outputNames[0];
    const embedding = Array.from(results[outputName].data as Float32Array);

    return normalizeVector(embedding);
  });
}

/**
 * Batch image embedding: stack N preprocessed images into one tensor and
 * run a single ONNX forward pass. Falls back to sequential if batch size is 1
 * or if the ONNX model doesn't support dynamic batch.
 */
export async function getImageEmbeddingBatch(
  preprocessedImages: Float32Array[]
): Promise<number[][]> {
  if (preprocessedImages.length === 0) return [];
  if (preprocessedImages.length === 1) {
    return [await getImageEmbedding(preprocessedImages[0])];
  }

  return withCircuitBreaker("clip", async () => {
    if (!imageSession) await initClip();
    if (!imageSession) throw new Error("[CLIP] Image model not loaded.");

    const N = preprocessedImages.length;
    const pixelsPerImage = 3 * IMAGE_SIZE * IMAGE_SIZE;

    try {
      // Stack into [N, 3, H, W]
      const stacked = new Float32Array(N * pixelsPerImage);
      for (let i = 0; i < N; i++) {
        stacked.set(preprocessedImages[i], i * pixelsPerImage);
      }

      const inputTensor = new ort.Tensor("float32", stacked, [N, 3, IMAGE_SIZE, IMAGE_SIZE]);
      const inputName = imageSession.inputNames[0];
      const results = await imageSession.run({ [inputName]: inputTensor });

      const outputName = imageSession.outputNames[0];
      const flat = results[outputName].data as Float32Array;
      const dim = flat.length / N;

      const embeddings: number[][] = [];
      for (let i = 0; i < N; i++) {
        const slice = Array.from(flat.slice(i * dim, (i + 1) * dim));
        embeddings.push(normalizeVector(slice));
      }
      return embeddings;
    } catch {
      // Dynamic batch not supported — fall back to sequential
      const embeddings: number[][] = [];
      for (const img of preprocessedImages) {
        embeddings.push(await getImageEmbedding(img));
      }
      return embeddings;
    }
  });
}

/**
 * Generate image embedding directly from raw image buffer
 */
export async function getImageEmbeddingFromBuffer(
  imageBuffer: Buffer,
  width: number,
  height: number,
  channels: number = 3
): Promise<number[]> {
  const preprocessed = preprocessImage(new Uint8Array(imageBuffer), width, height, channels);
  return getImageEmbedding(preprocessed);
}

/**
 * Generate text embedding (if text model is available).
 * Wrapped with a circuit breaker to fast-fail when ONNX is unhealthy.
 */
export async function getTextEmbedding(text: string): Promise<number[]> {
  return withCircuitBreaker("clip", async () => {
    if (!textSession) {
      await initClip();
    }

    if (!textSession) {
      throw new Error(
        `[CLIP] Text model not loaded. ` +
          `Path: ${getTextModelPath()} | ` +
          `Exists: ${fs.existsSync(getTextModelPath())} | ` +
          `Usable (size check): ${isUsableModelFile(getTextModelPath())}`
      );
    }

    const tokens = await tokenize(text);
    const inputTensor = new ort.Tensor("int64", new BigInt64Array(tokens.map(BigInt)), [1, tokens.length]);

    const inputName = textSession.inputNames[0];
    const feeds: Record<string, ort.Tensor> = { [inputName]: inputTensor };
    const results = await textSession.run(feeds);

    const outputName = textSession.outputNames[0];
    const embedding = Array.from(results[outputName].data as Float32Array);

    return normalizeVector(embedding);
  });
}

/**
 * Tokenize text using CLIP BPE tokenizer from @xenova/transformers.
 * Falls back to a basic char-code tokenizer only if the BPE model fails to load.
 */
async function tokenize(text: string): Promise<number[]> {
  await ensureTokenizer();

  if (clipTokenizer) {
    const encoded = await clipTokenizer(text, {
      padding: "max_length",
      max_length: 77,
      truncation: true,
    });
    return Array.from(encoded.input_ids.data as BigInt64Array, Number);
  }

  return simpleTokenizeFallback(text);
}

/**
 * Last-resort fallback if the BPE tokenizer cannot load.
 * Produces degraded embeddings — logs a warning on every call.
 */
function simpleTokenizeFallback(text: string): number[] {
  console.warn("[CLIP] Using char-code fallback tokenizer — text embeddings will be degraded");
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
function normalizeVector(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}

/**
 * Cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
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
export function getEmbeddingDimension(): number {
  return EMBEDDING_DIM;
}