// src/lib/image/blip.ts
import * as ort from 'onnxruntime-node';
import sharp from 'sharp';

const BLIP_MEAN    = [0.48145466, 0.4578275,  0.40821073];
const BLIP_STD     = [0.26862954, 0.26130258, 0.27577711];
const INPUT_SIZE   = 384;
const MAX_NEW_TOKENS = 30;

// BLIP tokenizer special tokens (BERT-based)
const BOS_TOKEN_ID = 101;  // [CLS]
const EOS_TOKEN_ID = 102;  // [SEP]
const PAD_TOKEN_ID = 0;

export class BlipService {
  private visionSession:  ort.InferenceSession | null = null;
  private decoderSession: ort.InferenceSession | null = null;
  private tokenizer: any = null;

  async init() {
    // Load both ONNX models in parallel
    [this.visionSession, this.decoderSession] = await Promise.all([
      ort.InferenceSession.create('models/blip-vision.onnx',       { executionProviders: ['cpu'] }),
      ort.InferenceSession.create('models/blip-text-decoder.onnx', { executionProviders: ['cpu'] }),
    ]);

    // Load tokenizer from HuggingFace hub (BERT tokenizer)
    const { AutoTokenizer } = await import('@xenova/transformers');
    this.tokenizer = await AutoTokenizer.from_pretrained(
      'Xenova/blip-image-captioning-base'
    );

    console.log('✅ BLIP vision + decoder ready');
  }

  // ── Main entry point ─────────────────────────────────────────────────
  async caption(imageBuffer: Buffer): Promise<string> {
    if (!this.visionSession || !this.decoderSession) {
      throw new Error('BlipService not initialized — call init() first');
    }

    // 1. Encode image → hidden states
    const imageHiddenStates = await this.encodeImage(imageBuffer);

    // 2. Autoregressively generate token ids
    const tokenIds = await this.generate(imageHiddenStates);

    // 3. Decode token ids → string
    const caption = await this.tokenizer.decode(tokenIds, {
      skip_special_tokens: true,
    });

    return caption.trim();
  }

  // ── Step 1: Vision Encoder ───────────────────────────────────────────
  private async encodeImage(imageBuffer: Buffer): Promise<ort.Tensor> {
    const pixels = await this.preprocessImage(imageBuffer);
    const tensor = new ort.Tensor('float32', pixels, [1, 3, INPUT_SIZE, INPUT_SIZE]);

    const output = await this.visionSession!.run({ pixel_values: tensor });
    return output['last_hidden_state']; // shape: (1, 577, 768)
  }

  // ── Step 2: Autoregressive Decode Loop ───────────────────────────────
  private async generate(imageHiddenStates: ort.Tensor): Promise<number[]> {
    // Start with [BOS] token
    const generatedIds: number[] = [BOS_TOKEN_ID];

    for (let step = 0; step < MAX_NEW_TOKENS; step++) {
      // Build input_ids tensor from tokens generated so far
      const inputIdsTensor = new ort.Tensor(
        'int64',
        BigInt64Array.from(generatedIds.map(BigInt)),
        [1, generatedIds.length]
      );

      // Run decoder — get logits for all positions
      const output = await this.decoderSession!.run({
        input_ids:           inputIdsTensor,
        image_hidden_states: imageHiddenStates,
      });

      const logits = output['logits'].data as Float32Array;
      // logits shape: (1, seq_len, vocab_size)
      // We only care about the LAST position (next token prediction)
      const vocabSize = logits.length / generatedIds.length;
      const lastLogits = logits.slice(
        (generatedIds.length - 1) * vocabSize,
         generatedIds.length      * vocabSize
      );

      // Greedy: pick highest logit
      const nextTokenId = this.argmax(lastLogits);

      // Stop if EOS
      if (nextTokenId === EOS_TOKEN_ID) break;

      generatedIds.push(nextTokenId);
    }

    // Strip BOS from output
    return generatedIds.slice(1);
  }

  // ── Helpers ──────────────────────────────────────────────────────────
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
