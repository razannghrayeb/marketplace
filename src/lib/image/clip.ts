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
import * as https from "https";
import * as http from "http";
import { withCircuitBreaker } from "../core/circuitBreaker";

const MODEL_DIR = path.join(process.cwd(), "models");

/**
 * ONNX Runtime execution providers for CLIP sessions.
 * - `CLIP_EXECUTION_PROVIDERS=cuda,cpu` — try CUDA first (Linux GPU / Cloud Run GPU), then CPU.
 * - `CLIP_EXECUTION_PROVIDERS=dml,cpu` — DirectML on Windows laptops with GPU.
 * - `CLIP_USE_GPU=true` — shorthand for `cuda,cpu`.
 * - Default: Windows uses `dml,cpu`; other platforms use `cuda,cpu`.
 *
 * Requires a GPU-capable onnxruntime build where deployed; otherwise creation falls back to CPU.
 */
export function getClipExecutionProviders(): string[] {
  const raw = process.env.CLIP_EXECUTION_PROVIDERS?.trim();
  if (raw) {
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
  const gpu = process.env.CLIP_USE_GPU?.trim().toLowerCase();
  if (gpu === "false" || gpu === "0" || gpu === "no") {
    return ["cpu"];
  }
  if (process.platform === "win32") {
    return ["dml", "cpu"];
  }
  return ["cuda", "cpu"];
}

let resolvedClipProviders: string[] = ["cpu"];

function providersSuggestGpu(providers: string[]): boolean {
  return providers.some((p) => {
    const v = String(p).toLowerCase();
    return v === "cuda" || v === "dml" || v === "coreml" || v === "tensorrt";
  });
}

function logClipRuntimeProviders(scope: "image" | "text", providers: string[]): void {
  const gpu = providersSuggestGpu(providers);
  console.log(
    `[CLIP] ${scope} runtime providers=${providers.join(",")} (device_hint=${gpu ? "gpu" : "cpu"})`
  );
}

async function createClipInferenceSession(modelPath: string): Promise<ort.InferenceSession> {
  const providers = getClipExecutionProviders();
  try {
    const session = await ort.InferenceSession.create(modelPath, { executionProviders: providers });
    resolvedClipProviders = [...providers];
    return session;
  } catch (err) {
    const first = providers[0]?.toLowerCase();
    if (first && first !== "cpu") {
      console.warn(
        "[CLIP] executionProviders",
        providers.join(","),
        "failed; falling back to CPU:",
        (err as Error).message
      );
      const session = await ort.InferenceSession.create(modelPath, { executionProviders: ["cpu"] });
      resolvedClipProviders = ["cpu"];
      return session;
    }
    throw err;
  }
}

// ============================================================================
// CLIP BPE Tokenizer (standalone implementation — no @xenova/transformers
// dependency, which conflicts with onnxruntime-node)
// ============================================================================

const VOCAB_URL = "https://huggingface.co/openai/clip-vit-base-patch32/resolve/main/vocab.json";
const MERGES_URL = "https://huggingface.co/openai/clip-vit-base-patch32/resolve/main/merges.txt";

let bpeRanks: Map<string, number> | null = null;
let encoder: Map<string, number> | null = null;
let decoder: Map<number, string> | null = null;
let byteEncoder: Map<number, string> | null = null;
let bpeCache: Map<string, string> = new Map();
let tokenizerReady = false;
let tokenizerInitPromise: Promise<void> | null = null;

/**
 * Serialize CLIP text ONNX inference. Concurrent `session.run()` calls on the same
 * CPU-bound session cause failures and spurious circuit-breaker opens during reindex.
 */
let textEncoderChain: Promise<unknown> = Promise.resolve();

function enqueueTextEncoder<T>(fn: () => Promise<T>): Promise<T> {
  const run = textEncoderChain.then(() => fn());
  textEncoderChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

const MAX_HTTP_REDIRECTS = 15;

/**
 * HuggingFace often returns a relative Location on 3xx (e.g. /api/resolve-cache/...).
 * Node's http(s).get requires an absolute URL — resolve against the request URL.
 */
function resolveRedirectUrl(currentUrl: string, location: string): string {
  const loc = location.trim();

  // Already absolute
  if (/^https?:\/\//i.test(loc)) return loc;

  // Relative path — resolve against the origin of the current URL
  try {
    const base = new URL(currentUrl);
    return new URL(loc, base.origin).href;
  } catch {
    // Last resort: if currentUrl itself is malformed, try constructing from HuggingFace origin
    try {
      return new URL(loc, "https://huggingface.co").href;
    } catch {
      return loc;
    }
  }
}

function fetchJSON(url: string, redirectDepth = 0): Promise<any> {
  return new Promise((resolve, reject) => {
    if (redirectDepth > MAX_HTTP_REDIRECTS) {
      reject(new Error(`fetchJSON: too many redirects (${MAX_HTTP_REDIRECTS})`));
      return;
    }
    const get = url.startsWith("https") ? https.get : http.get;
    get(url, { headers: { "User-Agent": "clip-tokenizer" } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = resolveRedirectUrl(url, res.headers.location);
        fetchJSON(next, redirectDepth + 1).then(resolve, reject);
        return;
      }
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8"))); }
        catch (e) { reject(e); }
      });
      res.on("error", reject);
    }).on("error", reject);
  });
}

function fetchText(url: string, redirectDepth = 0): Promise<string> {
  return new Promise((resolve, reject) => {
    if (redirectDepth > MAX_HTTP_REDIRECTS) {
      reject(new Error(`fetchText: too many redirects (${MAX_HTTP_REDIRECTS})`));
      return;
    }
    const get = url.startsWith("https") ? https.get : http.get;
    get(url, { headers: { "User-Agent": "clip-tokenizer" } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = resolveRedirectUrl(url, res.headers.location);
        fetchText(next, redirectDepth + 1).then(resolve, reject);
        return;
      }
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      res.on("error", reject);
    }).on("error", reject);
  });
}

function buildByteEncoder(): Map<number, string> {
  const bs: number[] = [];
  for (let i = 33; i <= 126; i++) bs.push(i);    // '!' to '~'
  for (let i = 161; i <= 172; i++) bs.push(i);   // '¡' to '¬'
  for (let i = 174; i <= 255; i++) bs.push(i);   // '®' to 'ÿ'
  const cs = [...bs];
  let n = 0;
  for (let b = 0; b < 256; b++) {
    if (!bs.includes(b)) {
      bs.push(b);
      cs.push(256 + n);
      n++;
    }
  }
  const map = new Map<number, string>();
  for (let i = 0; i < bs.length; i++) {
    map.set(bs[i], String.fromCharCode(cs[i]));
  }
  return map;
}

function getPairs(word: string[]): Set<string> {
  const pairs = new Set<string>();
  for (let i = 0; i < word.length - 1; i++) {
    pairs.add(word[i] + " " + word[i + 1]);
  }
  return pairs;
}

function bpe(token: string): string {
  if (bpeCache.has(token)) return bpeCache.get(token)!;
  if (!bpeRanks) return token;

  let word = token.slice(0, -1).split("").concat([token.slice(-1) + "</w>"]);
  let pairs = getPairs(word);
  if (pairs.size === 0) {
    bpeCache.set(token, token + "</w>");
    return token + "</w>";
  }

  while (true) {
    let minRank = Infinity;
    let bigram = "";
    for (const pair of pairs) {
      const rank = bpeRanks.get(pair);
      if (rank !== undefined && rank < minRank) {
        minRank = rank;
        bigram = pair;
      }
    }
    if (minRank === Infinity) break;

    const [first, second] = bigram.split(" ");
    const newWord: string[] = [];
    let i = 0;
    while (i < word.length) {
      const j = word.indexOf(first, i);
      if (j === -1) {
        newWord.push(...word.slice(i));
        break;
      }
      newWord.push(...word.slice(i, j));
      if (j < word.length - 1 && word[j] === first && word[j + 1] === second) {
        newWord.push(first + second);
        i = j + 2;
      } else {
        newWord.push(word[j]);
        i = j + 1;
      }
    }
    word = newWord;
    if (word.length === 1) break;
    pairs = getPairs(word);
  }

  const result = word.join(" ");
  bpeCache.set(token, result);
  return result;
}

async function ensureTokenizer(): Promise<void> {
  if (tokenizerReady) return;
  if (tokenizerInitPromise) return tokenizerInitPromise;

  tokenizerInitPromise = (async () => {
    try {
      const vocabCachePath = path.join(MODEL_DIR, ".cache", "vocab.json");
      const mergesCachePath = path.join(MODEL_DIR, ".cache", "merges.txt");

      let vocabData: Record<string, number>;
      let mergesText: string;

      const cacheDir = path.join(MODEL_DIR, ".cache");
      if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

      if (fs.existsSync(vocabCachePath) && fs.existsSync(mergesCachePath)) {
        vocabData = JSON.parse(fs.readFileSync(vocabCachePath, "utf-8"));
        mergesText = fs.readFileSync(mergesCachePath, "utf-8");
        console.log("[CLIP] BPE tokenizer loaded from cache");
      } else {
        console.log("[CLIP] Downloading BPE vocab and merges from HuggingFace...");
        [vocabData, mergesText] = await Promise.all([
          fetchJSON(VOCAB_URL),
          fetchText(MERGES_URL),
        ]);
        fs.writeFileSync(vocabCachePath, JSON.stringify(vocabData));
        fs.writeFileSync(mergesCachePath, mergesText);
        console.log("[CLIP] BPE vocab and merges downloaded and cached");
      }

      encoder = new Map(Object.entries(vocabData));
      decoder = new Map<number, string>();
      for (const [k, v] of encoder) decoder.set(v, k);

      const mergeLines = mergesText.split("\n").filter(l => l.trim() && !l.startsWith("#"));
      bpeRanks = new Map<string, number>();
      for (let i = 0; i < mergeLines.length; i++) {
        bpeRanks.set(mergeLines[i].trim(), i);
      }

      byteEncoder = buildByteEncoder();
      bpeCache = new Map();
      tokenizerReady = true;
      console.log(`[CLIP] BPE tokenizer ready (${encoder.size} vocab, ${bpeRanks.size} merges)`);
    } catch (err) {
      console.warn("[CLIP] Failed to load BPE tokenizer, falling back to simple tokenizer:", err);
      tokenizerReady = false;
      // Allow retries — clear the init promise so subsequent calls re-attempt
      tokenizerInitPromise = null;
      throw err;
    }
  })();

  // Don't propagate the error to callers — they will fall back to simpleTokenizeFallback
  return tokenizerInitPromise.catch(() => {});
}

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

  if (!envModel) {
    console.warn(
      `[CLIP] ⚠️  CLIP_MODEL_TYPE not set — auto-detecting model. ` +
      `This can cause model mismatch between indexing and search. ` +
      `Set CLIP_MODEL_TYPE in .env to ensure consistency.`
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
  console.log(`[CLIP] ONNX executionProviders : ${getClipExecutionProviders().join(", ")}`);
  console.log(`[CLIP] Model embedding dim : ${EMBEDDING_DIM}`);
  console.log(`[CLIP] Index expected dim  : ${EXPECTED_INDEX_DIM}`);
  console.log(`[CLIP] Image model path    : ${imageModelPath}`);
  console.log(`[CLIP] Text  model path    : ${textModelPath}`);
  console.log(`[CLIP] Image model usable  : ${isUsableModelFile(imageModelPath)}`);
  console.log(`[CLIP] Text  model usable  : ${isUsableModelFile(textModelPath)}`);

  if (EMBEDDING_DIM !== EXPECTED_INDEX_DIM) {
    throw new Error(
      `[CLIP] FATAL: Model "${activeModelType}" produces ${EMBEDDING_DIM}-dim embeddings, ` +
      `but the index expects ${EXPECTED_INDEX_DIM}-dim. ` +
      `Fix by setting CLIP_MODEL_TYPE to a ${EXPECTED_INDEX_DIM}-dim model, ` +
      `or change EXPECTED_EMBEDDING_DIM=${EMBEDDING_DIM} and recreate the index.`
    );
  }

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
  imageSession = await createClipInferenceSession(imageModelPath);
  console.log(`[CLIP] ✅ Image model loaded`);
  logClipRuntimeProviders("image", resolvedClipProviders);

  // ── Load text model ───────────────────────────────────────────────────────
  // FIX: use isUsableModelFile (size-aware) instead of just fs.existsSync
  if (isUsableModelFile(textModelPath)) {
    console.log(`[CLIP] Loading text model: ${activeConfig.name}...`);
    textSession = await createClipInferenceSession(textModelPath);
    console.log(`[CLIP] ✅ Text model loaded`);
    logClipRuntimeProviders("text", resolvedClipProviders);

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
 * Check if CLIP text model is loaded, BPE tokenizer ready, and text search is usable.
 */
export function isTextSearchAvailable(): boolean {
  return textSession !== null && tokenizerReady;
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
 * Bilinear image resize with proper interpolation.
 *
 * The original used nearest-neighbor (Math.floor) which creates aliasing
 * artifacts that degrade CLIP embedding quality.  Bilinear interpolation
 * produces smoother down-sampled images that match what CLIP was trained on.
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
  const xRatio = (srcW - 1) / Math.max(dstW - 1, 1);
  const yRatio = (srcH - 1) / Math.max(dstH - 1, 1);

  for (let y = 0; y < dstH; y++) {
    const srcYf = y * yRatio;
    const y0 = Math.floor(srcYf);
    const y1 = Math.min(y0 + 1, srcH - 1);
    const wy = srcYf - y0;

    for (let x = 0; x < dstW; x++) {
      const srcXf = x * xRatio;
      const x0 = Math.floor(srcXf);
      const x1 = Math.min(x0 + 1, srcW - 1);
      const wx = srcXf - x0;

      for (let c = 0; c < channels; c++) {
        const v00 = src[(y0 * srcW + x0) * channels + c];
        const v10 = src[(y0 * srcW + x1) * channels + c];
        const v01 = src[(y1 * srcW + x0) * channels + c];
        const v11 = src[(y1 * srcW + x1) * channels + c];

        const top = v00 * (1 - wx) + v10 * wx;
        const bot = v01 * (1 - wx) + v11 * wx;
        dst[(y * dstW + x) * channels + c] = Math.round(top * (1 - wy) + bot * wy);
      }
    }
  }

  return dst;
}

/**
 * Expected embedding dimension for the index. All embeddings MUST match
 * this value.  Set via EXPECTED_EMBEDDING_DIM env var or defaults to 512.
 */
const EXPECTED_INDEX_DIM = parseInt(process.env.EXPECTED_EMBEDDING_DIM || "512", 10);

/**
 * Validate that an embedding has the expected dimension for the index.
 * Throws immediately on mismatch so corrupt vectors never reach storage.
 */
function assertEmbeddingDim(embedding: number[], context: string): void {
  if (embedding.length !== EXPECTED_INDEX_DIM) {
    throw new Error(
      `[CLIP] Embedding dimension mismatch in ${context}: ` +
      `got ${embedding.length}, expected ${EXPECTED_INDEX_DIM}. ` +
      `Active model "${activeModelType}" produces ${EMBEDDING_DIM}-dim vectors. ` +
      `Set CLIP_MODEL_TYPE or EXPECTED_EMBEDDING_DIM to fix.`
    );
  }
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
    const normalized = normalizeVector(embedding);

    assertEmbeddingDim(normalized, "getImageEmbedding");
    return normalized;
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
        const normalized = normalizeVector(slice);
        assertEmbeddingDim(normalized, `getImageEmbeddingBatch[${i}]`);
        embeddings.push(normalized);
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
 * Build the text-model input tensor with the dtype the active ONNX graph expects.
 */
function createClipTextInputTensor(tokens: number[]): ort.Tensor {
  const shape: readonly number[] = [1, tokens.length];
  if (activeModelType === "vit-b-32") {
    return new ort.Tensor("int32", new Int32Array(tokens), shape);
  }
  return new ort.Tensor("int64", new BigInt64Array(tokens.map(BigInt)), shape);
}

/**
 * Generate text embedding (if text model is available).
 * Wrapped with a circuit breaker to fast-fail when ONNX is unhealthy.
 *
 * Requires the BPE tokenizer — throws immediately if it's not loaded,
 * preventing garbage embeddings from polluting the circuit breaker stats.
 */
export async function getTextEmbedding(text: string): Promise<number[]> {
  // Pre-check: ensure tokenizer is loaded BEFORE entering the serialized
  // queue + circuit breaker.  This avoids counting tokenizer failures as
  // ONNX failures and stops the circuit breaker from tripping falsely.
  await ensureTokenizer();
  if (!tokenizerReady) {
    throw new Error("[CLIP] BPE tokenizer not available — text embedding disabled");
  }

  return enqueueTextEncoder(() =>
    withCircuitBreaker("clip-text", async () => {
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
      // Rocca's clip-text-vit-32-float32-**int32**.onnx expects int32 input_ids.
      // Xenova exports (fashion-clip, vit-l-14) use int64. Wrong dtype makes every
      // text run fail → clip-text circuit opens during reindex (see terminal logs).
      const inputTensor = createClipTextInputTensor(tokens);

      const inputName = textSession.inputNames[0];
      const feeds: Record<string, ort.Tensor> = { [inputName]: inputTensor };
      const results = await textSession.run(feeds);

      const outputName = textSession.outputNames[0];
      const embedding = Array.from(results[outputName].data as Float32Array);
      const normalized = normalizeVector(embedding);

      assertEmbeddingDim(normalized, "getTextEmbedding");
      return normalized;
    }),
  );
}

/**
 * Tokenize text using the built-in CLIP BPE tokenizer.
 * Throws if the BPE tokenizer is not available — callers should catch and
 * fall back to image-only embeddings rather than producing garbage vectors.
 */
async function tokenize(text: string): Promise<number[]> {
  await ensureTokenizer();

  if (tokenizerReady && encoder && byteEncoder) {
    const SOT = 49406; // <|startoftext|>
    const EOT = 49407; // <|endoftext|>
    const maxLen = 77;

    const cleaned = text.toLowerCase().trim();
    const pat = /<\|startoftext\|>|<\|endoftext\|>|'s|'t|'re|'ve|'m|'ll|'d|[a-z]+|[0-9]+|[^\sa-z0-9]+/gi;
    const matches = cleaned.match(pat) || [];

    const bpeTokens: number[] = [SOT];
    for (const token of matches) {
      const encoded_bytes = Array.from(Buffer.from(token, "utf-8"))
        .map(b => byteEncoder!.get(b) || "")
        .join("");
      const bpeResult = bpe(encoded_bytes);
      for (const bpeToken of bpeResult.split(" ")) {
        const id = encoder!.get(bpeToken);
        if (id !== undefined) bpeTokens.push(id);
      }
      if (bpeTokens.length >= maxLen - 1) break;
    }
    bpeTokens.push(EOT);

    // Pad/truncate to maxLen
    const result = new Array(maxLen).fill(0);
    for (let i = 0; i < Math.min(bpeTokens.length, maxLen); i++) {
      result[i] = bpeTokens[i];
    }
    return result;
  }

  return simpleTokenizeFallback(text);
}

/**
 * Last-resort fallback if the BPE tokenizer cannot load.
 *
 * CRITICAL: The char-code approach is invalid — CLIP's vocabulary expects
 * BPE token IDs, not raw char codes.  Feeding char codes produces garbage
 * embeddings that pollute the index and degrade search quality.
 *
 * Instead, refuse to produce text embeddings until the real tokenizer is
 * ready.  Callers catch this error and fall back to image-only embeddings.
 */
function simpleTokenizeFallback(_text: string): number[] {
  throw new Error(
    "[CLIP] BPE tokenizer not loaded — cannot produce valid text embeddings. " +
    "Ensure vocab.json and merges.txt are downloaded or cached."
  );
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
 * Get the embedding dimension produced by the active model.
 */
export function getEmbeddingDimension(): number {
  return EMBEDDING_DIM;
}

/**
 * Get the expected index dimension (what OpenSearch expects).
 * This is the source of truth used for dimension validation.
 */
export function getExpectedIndexDimension(): number {
  return EXPECTED_INDEX_DIM;
}
