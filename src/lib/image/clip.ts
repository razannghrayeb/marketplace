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
    console.warn(`Requested CLIP_MODEL_TYPE=${envModel}, but model file is missing/empty: ${envModelPath}`);
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

/**
 * Initialize CLIP models
 */
export async function initClip(modelType?: ClipModelType): Promise<void> {
  // Allow explicit model selection
  if (modelType && MODEL_CONFIGS[modelType]) {
    activeModelType = modelType;
    activeConfig = MODEL_CONFIGS[modelType];
    IMAGE_SIZE = activeConfig.imageSize;
    EMBEDDING_DIM = activeConfig.embeddingDim;
  } else {
    // Re-detect best available model
    activeModelType = getActiveModelType();
    activeConfig = MODEL_CONFIGS[activeModelType];
    IMAGE_SIZE = activeConfig.imageSize;
    EMBEDDING_DIM = activeConfig.embeddingDim;
  }

  const imageModelPath = getImageModelPath();
  const textModelPath = getTextModelPath();

  if (!isUsableModelFile(imageModelPath)) {
    throw new Error(
      `CLIP image model missing/invalid at ${imageModelPath}. Run 'npx tsx scripts/download-clip.ts' first.\n` +
      `Available models: fashion-clip, vit-l-14, vit-b-32`
    );
  }

  // Reset sessions if switching models
  if (imageSession) {
    imageSession = null;
  }
  if (textSession) {
    textSession = null;
  }

  if (!imageSession) {
    console.log(`Loading ${activeConfig.name} image model...`);
    console.log(`  - Embedding dimension: ${EMBEDDING_DIM}`);
    console.log(`  - ${activeConfig.description}`);
    imageSession = await ort.InferenceSession.create(imageModelPath);
    console.log(`${activeConfig.name} image model loaded`);
  }

  if (fs.existsSync(textModelPath) && !textSession) {
    console.log(`Loading ${activeConfig.name} text model...`);
    textSession = await ort.InferenceSession.create(textModelPath);
    console.log(`${activeConfig.name} text model loaded`);
  }
}

/**
 * Check if CLIP models are available
 */
export function isClipAvailable(): boolean {
  return isUsableModelFile(getImageModelPath());
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
export function listAvailableModels(): Array<{ type: ClipModelType; available: boolean; config: ModelConfig }> {
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
 * Generate image embedding from preprocessed image data
 */
export async function getImageEmbedding(
  preprocessedImage: Float32Array
): Promise<number[]> {
  if (!imageSession) {
    await initClip();
  }

  if (!imageSession) {
    throw new Error("CLIP image model not loaded");
  }

  // Create input tensor [1, 3, 224, 224]
  const inputTensor = new ort.Tensor("float32", preprocessedImage, [1, 3, IMAGE_SIZE, IMAGE_SIZE]);

  // Run inference - use dynamic input name (supports both "input" and "pixel_values")
  const inputName = imageSession.inputNames[0];
  const feeds: Record<string, ort.Tensor> = { [inputName]: inputTensor };
  const results = await imageSession.run(feeds);

  // Get output embedding
  const outputName = imageSession.outputNames[0];
  const embedding = Array.from(results[outputName].data as Float32Array);

  // L2 normalize the embedding
  return normalizeVector(embedding);
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
 * Generate text embedding (if text model is available)
 */
export async function getTextEmbedding(text: string): Promise<number[]> {
  if (!textSession) {
    throw new Error("CLIP text model not loaded. Text search not available.");
  }

  // Simple tokenization (real CLIP uses BPE tokenizer)
  const tokens = simpleTokenize(text);
  const inputTensor = new ort.Tensor("int32", new Int32Array(tokens), [1, tokens.length]);

  // Run inference - use dynamic input name (supports both "input" and "input_ids")
  const inputName = textSession.inputNames[0];
  const feeds: Record<string, ort.Tensor> = { [inputName]: inputTensor };
  const results = await textSession.run(feeds);

  const outputName = textSession.outputNames[0];
  const embedding = Array.from(results[outputName].data as Float32Array);

  return normalizeVector(embedding);
}

/**
 * Simple tokenizer placeholder
 * In production, use proper CLIP BPE tokenizer
 */
function simpleTokenize(text: string): number[] {
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
