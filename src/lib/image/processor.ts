/**
 * Image Processor
 * 
 * High-level image processing: CLIP embeddings, validation, pHash.
 */

import { getImageEmbedding, preprocessImage, isClipAvailable, initClip } from "./clip";
import { loadImage, normalizeImage, pHash } from "./utils";
import sharpLib from "sharp";
const sharp = typeof sharpLib === "function" ? sharpLib : (sharpLib as any).default;

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
 * Process an uploaded image and generate CLIP embedding
 */
export async function processImageForEmbedding(imageBuffer: Buffer): Promise<number[]> {
  if (!isClipAvailable()) {
    throw new Error("CLIP model not available. Run 'npx tsx scripts/download-clip.ts' first.");
  }

  // Use sharp to decode and resize image
  const { data, info } = await sharp(imageBuffer)
    .resize(224, 224, { fit: "cover" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Preprocess for CLIP
  const preprocessed = preprocessImage(
    new Uint8Array(data),
    info.width,
    info.height,
    info.channels
  );

  // Generate embedding
  const embedding = await getImageEmbedding(preprocessed);
  return embedding;
}

/** CLIP embedding on garment-centered crop (for `embedding_garment` in OpenSearch). */
export async function processImageForGarmentEmbedding(imageBuffer: Buffer): Promise<number[]> {
  const cropped = await extractGarmentCenterCropBuffer(imageBuffer);
  return processImageForEmbedding(cropped);
}

export type PixelBox = { x1: number; y1: number; x2: number; y2: number };

/**
 * Garment CLIP embedding: prefer YOLO/detector pixel box (padded), else center crop.
 * Boxes are assumed pixel coordinates in the original image space.
 */
export async function processImageForGarmentEmbeddingWithOptionalBox(
  imageBuffer: Buffer,
  box: PixelBox | null | undefined,
): Promise<number[]> {
  if (
    box &&
    Number.isFinite(box.x1) &&
    Number.isFinite(box.y1) &&
    Number.isFinite(box.x2) &&
    Number.isFinite(box.y2) &&
    box.x2 > box.x1 + 2 &&
    box.y2 > box.y1 + 2
  ) {
    const meta = await sharp(imageBuffer).metadata();
    const iw = meta.width ?? 0;
    const ih = meta.height ?? 0;
    if (iw > 32 && ih > 32) {
      const bw = box.x2 - box.x1;
      const bh = box.y2 - box.y1;
      const padX = bw * 0.08;
      const padY = bh * 0.08;
      const x1 = Math.max(0, Math.floor(box.x1 - padX));
      const y1 = Math.max(0, Math.floor(box.y1 - padY));
      const x2 = Math.min(iw, Math.ceil(box.x2 + padX));
      const y2 = Math.min(ih, Math.ceil(box.y2 + padY));
      const w = Math.max(1, x2 - x1);
      const h = Math.max(1, y2 - y1);
      const cropped = await sharp(imageBuffer)
        .extract({ left: x1, top: y1, width: w, height: h })
        .png()
        .toBuffer();
      return processImageForEmbedding(cropped);
    }
  }
  return processImageForGarmentEmbedding(imageBuffer);
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
  const sharpImg = sharp(buffer).resize(targetWidth, targetHeight, { fit: "cover" }).removeAlpha().raw();
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
