/**
 * Image Processor
 * 
 * High-level image processing: CLIP embeddings, validation, pHash.
 */

import { getImageEmbedding, preprocessImage, isClipAvailable, initClip } from "./clip";
import { loadImage, normalizeImage, pHash } from "./utils";
import sharpLib from "sharp";
const sharp = typeof sharpLib === "function" ? sharpLib : (sharpLib as any).default;
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
