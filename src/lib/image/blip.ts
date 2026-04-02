// src/lib/image/blip.ts
//
// BLIP image captioning with a standalone BERT WordPiece tokenizer.
// No @xenova/transformers — that package pulls in onnxruntime-web which
// conflicts with onnxruntime-node at runtime and poisons the ONNX backend.

import * as ort from 'onnxruntime-node';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import sharpLib from 'sharp';

// See `src/lib/image/processor.ts` / `utils.ts` for why we guard this.
const sharp: any =
  typeof sharpLib === 'function' ? sharpLib : (sharpLib as any).default;

const BLIP_MEAN    = [0.48145466, 0.4578275,  0.40821073];
const BLIP_STD     = [0.26862954, 0.26130258, 0.27577711];
const INPUT_SIZE   = 384;
const MAX_NEW_TOKENS = 30;

const BOS_TOKEN_ID = 101;  // [CLS]
const EOS_TOKEN_ID = 102;  // [SEP]
const UNK_TOKEN_ID = 100;  // [UNK]

const MODEL_DIR = path.join(process.cwd(), 'models');
const CACHE_DIR = path.join(MODEL_DIR, '.cache');
const BLIP_API_URL = String(process.env.BLIP_API_URL || '').trim();
const BLIP_API_TIMEOUT_MS = Math.max(
  200,
  Number(process.env.BLIP_API_TIMEOUT_MS || 8000) || 8000
);

// BLIP uses standard BERT WordPiece vocab. google-bert/bert-base-uncased is
// public and doesn't require authentication (unlike the Xenova repo).
const BLIP_VOCAB_URL =
  'https://huggingface.co/google-bert/bert-base-uncased/resolve/main/vocab.txt';

// ============================================================================
// Standalone BERT WordPiece tokenizer
// ============================================================================

let vocab: Map<string, number> | null = null;
let inverseVocab: Map<number, string> | null = null;

function fetchTextFile(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const get = url.startsWith('https') ? https.get : http.get;
    get(url, { headers: { 'User-Agent': 'blip-tokenizer' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // HuggingFace redirects sometimes return a relative `location`.
        // Resolve it against the original URL so Node doesn't throw "Invalid URL".
        const nextUrl = new URL(res.headers.location, url).toString();
        fetchTextFile(nextUrl).then(resolve, reject);
        return;
      }
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function loadVocab(): Promise<void> {
  if (vocab) return;

  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

  const vocabPath = path.join(CACHE_DIR, 'blip-vocab.txt');
  let vocabText: string;

  if (fs.existsSync(vocabPath)) {
    vocabText = fs.readFileSync(vocabPath, 'utf-8');
    console.log('[BLIP] WordPiece vocab loaded from cache');
  } else {
    console.log('[BLIP] Downloading WordPiece vocab from HuggingFace...');
    vocabText = await fetchTextFile(BLIP_VOCAB_URL);
    fs.writeFileSync(vocabPath, vocabText);
    console.log('[BLIP] WordPiece vocab downloaded and cached');
  }

  vocab = new Map<string, number>();
  inverseVocab = new Map<number, string>();
  const lines = vocabText.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const token = lines[i].trimEnd();
    if (token.length === 0 && i > 0) continue;
    vocab.set(token, i);
    inverseVocab.set(i, token);
  }
  console.log(`[BLIP] WordPiece vocab ready (${vocab.size} tokens)`);
}

function wordPieceTokenize(text: string): number[] {
  if (!vocab) return [];
  const tokens: number[] = [];
  const words = text.toLowerCase().replace(/[^\w\s']/g, ' ').trim().split(/\s+/);

  for (const word of words) {
    let start = 0;
    let matched = false;
    const subTokens: number[] = [];

    while (start < word.length) {
      let end = word.length;
      let found = false;

      while (start < end) {
        const substr = (start > 0 ? '##' : '') + word.slice(start, end);
        const id = vocab.get(substr);
        if (id !== undefined) {
          subTokens.push(id);
          start = end;
          found = true;
          break;
        }
        end--;
      }

      if (!found) {
        subTokens.push(UNK_TOKEN_ID);
        start++;
      }
      matched = true;
    }

    if (matched) tokens.push(...subTokens);
  }

  return tokens;
}

function decodeTokenIds(ids: number[]): string {
  if (!inverseVocab) return '';
  const pieces: string[] = [];
  for (const id of ids) {
    if (id === BOS_TOKEN_ID || id === EOS_TOKEN_ID || id === 0) continue;
    const token = inverseVocab.get(id) ?? '[UNK]';
    if (token.startsWith('##')) {
      pieces.push(token.slice(2));
    } else {
      pieces.push((pieces.length > 0 ? ' ' : '') + token);
    }
  }
  return pieces.join('');
}

// ============================================================================
// BLIP Service
// ============================================================================

export class BlipService {
  private visionSession:  ort.InferenceSession | null = null;
  private decoderSession: ort.InferenceSession | null = null;
  private mode: 'onnx-local' | 'remote-api' | 'disabled' = 'disabled';

  async init() {
    if (BLIP_API_URL) {
      const ok = await this.checkRemoteHealth();
      if (!ok) {
        throw new Error(`BLIP_API_URL is set but remote health check failed: ${BLIP_API_URL}`);
      }
      this.mode = 'remote-api';
      console.log(`[BLIP] remote API mode ready: ${BLIP_API_URL}`);
      return;
    }

    await loadVocab();

    [this.visionSession, this.decoderSession] = await Promise.all([
      ort.InferenceSession.create(path.join(MODEL_DIR, 'blip-vision.onnx'),       { executionProviders: ['cpu'] }),
      ort.InferenceSession.create(path.join(MODEL_DIR, 'blip-text-decoder.onnx'), { executionProviders: ['cpu'] }),
    ]);

    this.mode = 'onnx-local';
    console.log('[BLIP] vision + decoder ready');
  }

  async caption(imageBuffer: Buffer): Promise<string> {
    if (this.mode === 'remote-api') {
      return this.captionViaRemoteApi(imageBuffer);
    }

    if (!this.visionSession || !this.decoderSession) {
      throw new Error('BlipService not initialized — call init() first');
    }

    const imageHiddenStates = await this.encodeImage(imageBuffer);
    const tokenIds = await this.generate(imageHiddenStates);
    return decodeTokenIds(tokenIds).trim();
  }

  private async checkRemoteHealth(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), BLIP_API_TIMEOUT_MS);
      const res = await fetch(`${BLIP_API_URL.replace(/\/$/, '')}/health`, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return res.ok;
    } catch {
      return false;
    }
  }

  private structuredToCaption(input: Record<string, unknown>): string {
    const productType = String(input.productType ?? '').trim();
    const primaryColor = String(input.primaryColor ?? '').trim();
    const secondaryColor = String(input.secondaryColor ?? '').trim();
    const style = String(input.style ?? '').trim();
    const material = String(input.material ?? '').trim();
    const occasion = String(input.occasion ?? '').trim();
    const gender = String(input.gender ?? '').trim();
    const ageGroup = String(input.ageGroup ?? '').trim();

    const parts = [
      primaryColor && primaryColor !== 'null' ? primaryColor : '',
      secondaryColor && secondaryColor !== 'null' ? secondaryColor : '',
      style && style !== 'other' ? style : '',
      material && material !== 'null' ? material : '',
      productType && productType !== 'other' ? productType : 'fashion item',
      gender && gender !== 'unisex' ? `for ${gender}` : '',
      ageGroup ? ageGroup : '',
      occasion && occasion !== 'null' ? `occasion ${occasion}` : '',
    ].filter(Boolean);

    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  private async captionViaRemoteApi(imageBuffer: Buffer): Promise<string> {
    const payload = {
      image_b64: imageBuffer.toString('base64'),
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), BLIP_API_TIMEOUT_MS);
    try {
      const res = await fetch(`${BLIP_API_URL.replace(/\/$/, '')}/caption`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`BLIP API HTTP ${res.status}`);
      const data = (await res.json()) as {
        caption?: unknown;
        caption_text?: unknown;
        error?: string | null;
      };
      if (typeof data.caption_text === 'string' && data.caption_text.trim()) {
        return data.caption_text.trim();
      }
      if (typeof data.caption === 'string' && data.caption.trim()) {
        return data.caption.trim();
      }
      if (data.caption && typeof data.caption === 'object') {
        return this.structuredToCaption(data.caption as Record<string, unknown>);
      }
      if (data.error) throw new Error(String(data.error));
      return '';
    } finally {
      clearTimeout(timeout);
    }
  }

  private async encodeImage(imageBuffer: Buffer): Promise<ort.Tensor> {
    const pixels = await this.preprocessImage(imageBuffer);
    const tensor = new ort.Tensor('float32', pixels, [1, 3, INPUT_SIZE, INPUT_SIZE]);
    const output = await this.visionSession!.run({ pixel_values: tensor });
    return output['last_hidden_state'];
  }

  private async generate(imageHiddenStates: ort.Tensor): Promise<number[]> {
    const generatedIds: number[] = [BOS_TOKEN_ID];

    for (let step = 0; step < MAX_NEW_TOKENS; step++) {
      const inputIdsTensor = new ort.Tensor(
        'int64',
        BigInt64Array.from(generatedIds.map(BigInt)),
        [1, generatedIds.length]
      );

      const output = await this.decoderSession!.run({
        input_ids:           inputIdsTensor,
        image_hidden_states: imageHiddenStates,
      });

      const logits = output['logits'].data as Float32Array;
      const vocabSize = logits.length / generatedIds.length;
      const lastLogits = logits.slice(
        (generatedIds.length - 1) * vocabSize,
         generatedIds.length      * vocabSize
      );

      const nextTokenId = this.argmax(lastLogits);
      if (nextTokenId === EOS_TOKEN_ID) break;
      generatedIds.push(nextTokenId);
    }

    return generatedIds.slice(1);
  }

  private argmax(arr: Float32Array): number {
    let maxIdx = 0;
    let maxVal = -Infinity;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] > maxVal) { maxVal = arr[i]; maxIdx = i; }
    }
    return maxIdx;
  }

  private async preprocessImage(imageBuffer: Buffer): Promise<Float32Array> {
    const { data } = await sharp(imageBuffer)
      .resize(INPUT_SIZE, INPUT_SIZE, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const float32 = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
    for (let i = 0; i < INPUT_SIZE * INPUT_SIZE; i++) {
      for (let c = 0; c < 3; c++) {
        float32[c * INPUT_SIZE * INPUT_SIZE + i] =
          (data[i * 3 + c] / 255.0 - BLIP_MEAN[c]) / BLIP_STD[c];
      }
    }
    return float32;
  }
}

export const blip = new BlipService();
