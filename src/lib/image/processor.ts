/**
 * Image Processor
 * 
 * High-level image processing: CLIP embeddings, validation, pHash.
 */

import { getImageEmbedding, preprocessImage, isClipAvailable, initClip } from "./clip";
import { loadImage, normalizeImage, pHash } from "./utils";
import sharpLib from "sharp";
const sharp = typeof sharpLib === "function" ? sharpLib : (sharpLib as any).default;

// ── Background removal (rembg sidecar) ─────────────────────────────────────

let rembgHealthy: boolean | null = null;
let rembgLastCheck = 0;
const REMBG_HEALTH_TTL_MS = 30_000;
const REMBG_QUERY_TIMEOUT_MS = 3_000;

function rembgUrl(): string {
  return process.env.REMBG_SERVICE_URL || "http://127.0.0.1:7788";
}

async function isRembgAvailable(): Promise<boolean> {
  if (rembgHealthy !== null && Date.now() - rembgLastCheck < REMBG_HEALTH_TTL_MS) {
    return rembgHealthy;
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(`${rembgUrl()}/health`, { signal: ctrl.signal });
    clearTimeout(timer);
    rembgHealthy = res.ok;
  } catch {
    rembgHealthy = false;
  }
  rembgLastCheck = Date.now();
  return rembgHealthy;
}

/**
 * Remove background via the rembg sidecar with a tight timeout.
 * Returns the cleaned buffer flattened onto white, or null on any failure.
 */
export async function removeBackgroundForQuery(imageBuffer: Buffer): Promise<Buffer | null> {
  if (!(await isRembgAvailable())) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REMBG_QUERY_TIMEOUT_MS);
    const res = await fetch(`${rembgUrl()}/remove-bg`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: new Uint8Array(imageBuffer),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const pngWithAlpha = Buffer.from(await res.arrayBuffer());
    return sharp(pngWithAlpha)
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .jpeg({ quality: 92 })
      .toBuffer();
  } catch {
    return null;
  }
}

/** Center-weighted crop aligned with `extractDominantColorNames` — reduces model/background in embeddings. */
export async function extractGarmentCenterCropBuffer(imageBuffer: Buffer): Promise<Buffer> {
  const meta = await sharp(imageBuffer).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (w <= 32 || h <= 32) return imageBuffer;
  const left = Math.floor(w * 0.18);
  const top = Math.floor(h * 0.12);
  const width = Math.max(1, Math.floor(w * 0.64));
  const height = Math.max(1, Math.floor(h * 0.62));
  return sharp(imageBuffer).extract({ left, top, width, height }).png().toBuffer();
}

/**
 * Process an uploaded image and generate CLIP embedding.
 *
 * Uses `fit: "cover"` (center-crop to fill) to match CLIP's training
 * distribution.  Previous `fit: "contain"` added white letterbox padding
 * which diluted the garment signal and shifted embeddings away from the
 * model's learned manifold.
 */
export async function processImageForEmbedding(imageBuffer: Buffer): Promise<number[]> {
  if (!isClipAvailable()) {
    throw new Error("CLIP model not available. Run 'npx tsx scripts/download-clip.ts' first.");
  }

  const { data, info } = await sharp(imageBuffer)
    .resize(224, 224, {
      fit: "cover",
    })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const preprocessed = preprocessImage(
    new Uint8Array(data),
    info.width,
    info.height,
    info.channels,
  );

  return getImageEmbedding(preprocessed);
}

/** CLIP embedding on garment-centered crop (for `embedding_garment` in OpenSearch). */
export async function processImageForGarmentEmbedding(imageBuffer: Buffer): Promise<number[]> {
  const cropped = await extractGarmentCenterCropBuffer(imageBuffer);
  return processImageForEmbedding(cropped);
}

export type PixelBox = { x1: number; y1: number; x2: number; y2: number };

/**
 * Padded pixel crop for a detection box (same geometry as garment indexing / CLIP).
 * Returns null when the box is unusable or the crop would be tiny.
 */
export async function extractPaddedDetectionCropBuffer(
  imageBuffer: Buffer,
  box: PixelBox | null | undefined,
): Promise<Buffer | null> {
  if (
    !box ||
    !Number.isFinite(box.x1) ||
    !Number.isFinite(box.y1) ||
    !Number.isFinite(box.x2) ||
    !Number.isFinite(box.y2)
  ) {
    return null;
  }
  const meta = await sharp(imageBuffer).metadata();
  const iw = meta.width ?? 0;
  const ih = meta.height ?? 0;
  if (iw <= 32 || ih <= 32) return null;
  // Clamp raw box to image bounds before padding (YOLO coords may extend past edges).
  const bx1 = Math.max(0, Math.min(iw, box.x1));
  const by1 = Math.max(0, Math.min(ih, box.y1));
  const bx2 = Math.max(bx1 + 3, Math.min(iw, box.x2));
  const by2 = Math.max(by1 + 3, Math.min(ih, box.y2));
  if (bx2 <= bx1 + 2 || by2 <= by1 + 2) {
    return null;
  }
  const bw = bx2 - bx1;
  const bh = by2 - by1;
  const padX = bw * 0.08;
  const padY = bh * 0.08;
  const x1 = Math.max(0, Math.floor(bx1 - padX));
  const y1 = Math.max(0, Math.floor(by1 - padY));
  const x2 = Math.min(iw, Math.ceil(bx2 + padX));
  const y2 = Math.min(ih, Math.ceil(by2 + padY));
  const w = Math.max(1, x2 - x1);
  const h = Math.max(1, y2 - y1);
  if (w < 10 || h < 10) return null;
  return sharp(imageBuffer)
    .extract({ left: x1, top: y1, width: w, height: h })
    .png()
    .toBuffer();
}

/**
 * Garment CLIP embedding: prefer YOLO/detector pixel box (padded), else center crop.
 * Boxes are assumed pixel coordinates in the original image space.
 */
export async function processImageForGarmentEmbeddingWithOptionalBox(
  rawBuf: Buffer,
  processBuf: Buffer,
  box: PixelBox | null | undefined,
): Promise<number[]> {

  // ── Step 1: determine the best buffer to embed ────────────────────────────
  let embedBuf: Buffer;

  if (box &&
    Number.isFinite(box.x1) && Number.isFinite(box.y1) &&
    Number.isFinite(box.x2) && Number.isFinite(box.y2)
  ) {
    // Crop from the rembg-cleaned image using YOLO box + 10% padding
    try {
      const meta = await sharp(processBuf).metadata();
      const iw = meta.width ?? 0;
      const ih = meta.height ?? 0;

      if (iw > 32 && ih > 32) {
        // Clamp raw box to image bounds first
        const bx1 = Math.max(0, Math.min(iw, box.x1));
        const by1 = Math.max(0, Math.min(ih, box.y1));
        const bx2 = Math.max(bx1 + 4, Math.min(iw, box.x2));
        const by2 = Math.max(by1 + 4, Math.min(ih, box.y2));

        const bw = bx2 - bx1;
        const bh = by2 - by1;

        // 10% padding on each side
        const padX = Math.round(bw * 0.10);
        const padY = Math.round(bh * 0.10);

        const left   = Math.max(0, bx1 - padX);
        const top    = Math.max(0, by1 - padY);
        const right  = Math.min(iw, bx2 + padX);
        const bottom = Math.min(ih, by2 + padY);

        const cropW = Math.max(1, right - left);
        const cropH = Math.max(1, bottom - top);

        if (cropW >= 10 && cropH >= 10) {
          embedBuf = await sharp(processBuf)
            .extract({ left: Math.round(left), top: Math.round(top), width: cropW, height: cropH })
            .png()
            .toBuffer();
        } else {
          // Box too small after clamping — use full clean image
          embedBuf = processBuf;
        }
      } else {
        embedBuf = processBuf;
      }
    } catch {
      // Crop failed — use full clean image
      embedBuf = processBuf;
    }
  } else {
    // No box — use full rembg-cleaned image
    embedBuf = processBuf;
  }

  // ── Step 2: resize with cover (matching CLIP training) and embed ────────
  // Must match processImageForEmbedding so query-time and index-time
  // embeddings live in the same region of CLIP's latent space.
  return processImageForEmbedding(embedBuf);
}

/**
 * Validate image buffer
 */
export async function validateImage(buffer: Buffer): Promise<{ valid: boolean; error?: string }> {
  try {
    const metadata = await sharp(buffer).metadata();

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
  } catch (error) {
    return { valid: false, error: "Invalid or corrupted image" };
  }
}

/**
 * Compute perceptual hash (pHash) for an image buffer
 */
export async function computePHash(buffer: Buffer): Promise<string> {
  return pHash(buffer);
}

/**
 * Load and normalize image into Float32Array CHW format
 */
export async function loadAndNormalize(buffer: Buffer, targetWidth = 224, targetHeight = 224) {
  const sharpImg = sharp(buffer).resize(targetWidth, targetHeight, { fit: "cover" }).removeAlpha();
  const { data, info } = await sharpImg.toBuffer({ resolveWithObject: true });
  const normalized = normalizeImage(data, info.width, info.height, info.channels, {
    mean: [0.48145466, 0.4578275, 0.40821073],
    std: [0.26862954, 0.26130258, 0.27577711],
  });
  return { normalized, width: info.width, height: info.height, channels: info.channels };
}

/**
 * Initialize image processing (loads CLIP model)
 */
export async function initImageProcessing(): Promise<void> {
  if (isClipAvailable()) {
    await initClip();
  }
}
