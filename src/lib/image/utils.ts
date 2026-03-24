/**
 * Image Utilities
 *
 * Low-level image manipulation: loading, normalization, pHash computation.
 */
import sharpLib from "sharp";

// `sharp` is published as a CommonJS callable function.
// Depending on TS/Node module interop settings, `import sharp from "sharp"`
// may produce a non-callable object. This guards against that at runtime.
const sharp: any =
  typeof sharpLib === "function" ? sharpLib : (sharpLib as any).default;

export interface ImageData {
  data: Buffer;
  width: number;
  height: number;
  channels: number;
}

/**
 * Load image buffer into raw pixel data
 */
export async function loadImage(buffer: Buffer): Promise<ImageData> {
  const img = sharp(buffer);
  const { data, info } = await img.raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  return { data: Buffer.from(data), width: info.width, height: info.height, channels };
}

/**
 * Normalize image bytes to Float32Array in CHW order (channels first)
 * Scales pixels to [0,1] and applies optional mean/std normalization
 */
export function normalizeImage(
  data: Buffer | Uint8Array,
  width: number,
  height: number,
  channels: number,
  options?: { mean?: number[]; std?: number[] }
): Float32Array {
  const mean = options?.mean ?? [0, 0, 0];
  const std = options?.std ?? [1, 1, 1];
  const out = new Float32Array(channels * width * height);

  // If data has alpha channel (4), ignore alpha channel in normalization
  const useChannels = Math.min(channels, 3);

  for (let c = 0; c < useChannels; c++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const srcIdx = (y * width + x) * channels + c;
        const dstIdx = c * width * height + y * width + x;
        const v = (data[srcIdx] & 0xff) / 255.0;
        out[dstIdx] = (v - (mean[c] ?? 0)) / (std[c] ?? 1);
      }
    }
  }

  return out;
}

/**
 * Compute perceptual hash (pHash) for an image buffer
 * Returns a 16-character hex string (64-bit hash)
 */
export async function pHash(buffer: Buffer): Promise<string> {
  if (!buffer?.length) {
    throw new Error("pHash: empty image buffer");
  }
  const input = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer as Buffer | Uint8Array);
  // Resize to 32x32 grayscale
  const resized = await sharp(input)
    .resize(32, 32, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { data } = resized as any as { data: Uint8Array };
  // `sharp` typings vary across versions/interops; normalize to Uint8Array.
  const pixels: number[] = Array.from(data, (v: number) => v & 0xff);

  const N = 32;
  // build 32x32 matrix
  const mat: number[][] = new Array(N);
  for (let y = 0; y < N; y++) {
    mat[y] = new Array(N);
    for (let x = 0; x < N; x++) {
      mat[y][x] = pixels[y * N + x];
    }
  }

  // 2D DCT
  const dct = dct2d(mat);

  // take top-left 8x8 (excluding DC at [0][0])
  const vals: number[] = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (y === 0 && x === 0) continue; // skip DC
      vals.push(dct[y][x]);
    }
  }

  const median = medianOfArray(vals);

  // build 64-bit hash (we used 8x8 minus DC → 63 bits; to make 64 bits include DC parity)
  const bits: number[] = [];
  for (let i = 0; i < vals.length; i++) {
    bits.push(vals[i] > median ? 1 : 0);
  }
  // pad to 64 bits by adding parity bit
  const parity = bits.reduce((a, b) => a ^ b, 0);
  bits.push(parity);

  // convert to hex
  let hex = BigInt(0);
  for (let i = 0; i < bits.length; i++) {
    if (bits[i]) {
      hex = hex | (BigInt(1) << BigInt(bits.length - 1 - i));
    }
  }

  // ensure 16 hex chars (64 bits)
  let s = hex.toString(16).padStart(16, "0");
  return s;
}

function medianOfArray(arr: number[]): number {
  const sorted = arr.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

// 2D DCT using separable DCT-II
function dct2d(mat: number[][]): number[][] {
  const N = mat.length;
  const tmp: number[][] = new Array(N).fill(null).map(() => new Array(N).fill(0));
  const out: number[][] = new Array(N).fill(null).map(() => new Array(N).fill(0));

  // 1D DCT on rows
  for (let y = 0; y < N; y++) {
    tmp[y] = dct1d(mat[y]);
  }

  // 1D DCT on columns
  for (let x = 0; x < N; x++) {
    const col = new Array(N);
    for (let y = 0; y < N; y++) col[y] = tmp[y][x];
    const dcol = dct1d(col);
    for (let y = 0; y < N; y++) out[y][x] = dcol[y];
  }

  return out;
}

function dct1d(vec: number[]): number[] {
  const N = vec.length;
  const out = new Array(N).fill(0);
  const factor = Math.PI / (2 * N);
  for (let k = 0; k < N; k++) {
    let sum = 0;
    for (let n = 0; n < N; n++) {
      sum += vec[n] * Math.cos((2 * n + 1) * k * factor);
    }
    const ck = k === 0 ? Math.sqrt(1 / N) : Math.sqrt(2 / N);
    out[k] = ck * sum;
  }
  return out;
}
