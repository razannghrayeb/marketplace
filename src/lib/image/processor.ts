/**
 * Image Processor
 * 
 * High-level image processing: CLIP embeddings, validation, pHash.
 */

import { getImageEmbedding, preprocessImage, isClipAvailable, initClip } from "./clip";
import { loadImage, normalizeImage, pHash } from "./utils";
import { prepareBufferForImageSearchQuery } from "./embeddingPrep";
import sharpLib from "sharp";
const sharp = typeof sharpLib === "function" ? sharpLib : (sharpLib as any).default;

export type PixelBox = { x1: number; y1: number; x2: number; y2: number };

/** Padding around YOLO / detector boxes — must match `resume-reindex` + garment CLIP crops. */
export const GARMENT_DETECTION_PAD_RATIO = 0.1;

export type YoloLikeDetection = {
  confidence?: number;
  area_ratio?: number;
  box?: PixelBox | null;
};

/**
 * Choose a primary detection for garment embedding: balances score and size so a huge
 * low-confidence box does not beat a smaller high-confidence garment (common on busy outfits).
 */
export function pickBestYoloDetectionForGarmentEmbedding<T extends YoloLikeDetection>(dets: T[]): T | undefined {
  if (!Array.isArray(dets) || dets.length === 0) return undefined;
  return [...dets].sort((a, b) => {
    const ar = Math.max(0, Number(a.area_ratio ?? 0));
    const br = Math.max(0, Number(b.area_ratio ?? 0));
    const ac = Math.max(0, Math.min(1, Number(a.confidence ?? 0)));
    const bc = Math.max(0, Math.min(1, Number(b.confidence ?? 0)));
    const scoreA = ac * Math.sqrt(ar + 1e-5);
    const scoreB = bc * Math.sqrt(br + 1e-5);
    if (Math.abs(scoreB - scoreA) > 1e-9) return scoreB - scoreA;
    return br - ar;
  })[0];
}

/** Map a box from src image pixel space to dst when rembg/resizing changed dimensions. */
export function scalePixelBoxToImageDims(
  box: PixelBox,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): PixelBox {
  if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0) return box;
  if (srcW === dstW && srcH === dstH) return box;
  const sx = dstW / srcW;
  const sy = dstH / srcH;
  return {
    x1: box.x1 * sx,
    y1: box.y1 * sy,
    x2: box.x2 * sx,
    y2: box.y2 * sy,
  };
}

/**
 * Crop garment ROI from an already query/catalog-prepared buffer (same geometry as garment index).
 * Falls back to a center crop when no reliable box is available so the garment vector stays
 * garment-focused instead of degrading to the full prepared frame.
 */
async function resolveGarmentEmbedBufferFromPrepared(
  processBuf: Buffer,
  box: PixelBox | null | undefined,
): Promise<Buffer> {
  if (
    box &&
    Number.isFinite(box.x1) &&
    Number.isFinite(box.y1) &&
    Number.isFinite(box.x2) &&
    Number.isFinite(box.y2)
  ) {
    try {
      const meta = await sharp(processBuf).metadata();
      const iw = meta.width ?? 0;
      const ih = meta.height ?? 0;

      if (iw > 32 && ih > 32) {
        const bx1 = Math.max(0, Math.min(iw, box.x1));
        const by1 = Math.max(0, Math.min(ih, box.y1));
        const bx2 = Math.max(bx1 + 4, Math.min(iw, box.x2));
        const by2 = Math.max(by1 + 4, Math.min(ih, box.y2));

        const bw = bx2 - bx1;
        const bh = by2 - by1;

        const padX = Math.round(bw * GARMENT_DETECTION_PAD_RATIO);
        const padY = Math.round(bh * GARMENT_DETECTION_PAD_RATIO);

        const left = Math.max(0, bx1 - padX);
        const top = Math.max(0, by1 - padY);
        const right = Math.min(iw, bx2 + padX);
        const bottom = Math.min(ih, by2 + padY);

        const cropW = Math.max(1, right - left);
        const cropH = Math.max(1, bottom - top);

        if (cropW >= 10 && cropH >= 10) {
          return sharp(processBuf)
            .extract({ left: Math.round(left), top: Math.round(top), width: cropW, height: cropH })
            .png()
            .toBuffer();
        }
      }
    } catch {
      // fall through to center crop
    }
  }
  return extractGarmentCenterCropBuffer(processBuf);
}

/**
 * Like `resolveGarmentEmbedBufferFromPrepared` but returns null when the padded crop would be
 * too small (legacy `extractPaddedDetectionCropBuffer` contract).
 */
async function tryStrictGarmentRoiFromPrepared(
  processBuf: Buffer,
  box: PixelBox,
): Promise<Buffer | null> {
  if (
    !Number.isFinite(box.x1) ||
    !Number.isFinite(box.y1) ||
    !Number.isFinite(box.x2) ||
    !Number.isFinite(box.y2)
  ) {
    return null;
  }
  try {
    const meta = await sharp(processBuf).metadata();
    const iw = meta.width ?? 0;
    const ih = meta.height ?? 0;
    if (iw <= 32 || ih <= 32) return null;
    const bx1 = Math.max(0, Math.min(iw, box.x1));
    const by1 = Math.max(0, Math.min(ih, box.y1));
    const bx2 = Math.max(bx1 + 4, Math.min(iw, box.x2));
    const by2 = Math.max(by1 + 4, Math.min(ih, box.y2));
    const bw = bx2 - bx1;
    const bh = by2 - by1;
    const padX = Math.round(bw * GARMENT_DETECTION_PAD_RATIO);
    const padY = Math.round(bh * GARMENT_DETECTION_PAD_RATIO);
    const left = Math.max(0, bx1 - padX);
    const top = Math.max(0, by1 - padY);
    const right = Math.min(iw, bx2 + padX);
    const bottom = Math.min(ih, by2 + padY);
    const cropW = Math.max(1, right - left);
    const cropH = Math.max(1, bottom - top);
    if (cropW < 10 || cropH < 10) return null;
    return sharp(processBuf)
      .extract({ left: Math.round(left), top: Math.round(top), width: cropW, height: cropH })
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

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

/**
 * Padded garment ROI on any same-size buffer as the box (legacy helper; prefer
 * `computeShopTheLookGarmentEmbeddingFromDetection` for search ↔ index alignment).
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
  return tryStrictGarmentRoiFromPrepared(imageBuffer, box);
}

/** Padded ROI bytes from a prepared (e.g. rembg) frame — same crop as `embedding_garment` indexing. */
export async function extractGarmentPaddedRoiFromPreparedImage(
  processBuf: Buffer,
  box: PixelBox | null | undefined,
): Promise<Buffer> {
  return resolveGarmentEmbedBufferFromPrepared(processBuf, box);
}

/**
 * Garment CLIP embedding: prefer YOLO/detector pixel box (padded), else center crop.
 * Boxes are assumed pixel coordinates in the original image space.
 */
export async function processImageForGarmentEmbeddingWithOptionalBox(
  _rawBuf: Buffer,
  processBuf: Buffer,
  box: PixelBox | null | undefined,
): Promise<number[]> {
  const embedBuf = await resolveGarmentEmbedBufferFromPrepared(processBuf, box);
  return processImageForEmbedding(embedBuf);
}

/**
 * Shop-the-look / selective search: same garment CLIP path as `resume-reindex` / `embedding_garment`
 * (full-frame query prep → padded ROI on prepared pixels). `detectionBox` is in original-upload space.
 */
export async function computeShopTheLookGarmentEmbeddingFromDetection(
  rawBuffer: Buffer,
  detectionBox: PixelBox,
): Promise<{ embedding: number[]; clipBufferForAttributes: Buffer; processBuf: Buffer }> {
  const { buffer: processBuf } = await prepareBufferForImageSearchQuery(rawBuffer);
  const [rawMeta, procMeta] = await Promise.all([
    sharp(rawBuffer).metadata(),
    sharp(processBuf).metadata(),
  ]);
  const rw = rawMeta.width ?? 0;
  const rh = rawMeta.height ?? 0;
  const pw = procMeta.width ?? 0;
  const ph = procMeta.height ?? 0;
  let box = detectionBox;
  if (rw > 0 && rh > 0 && pw > 0 && ph > 0 && (rw !== pw || rh !== ph)) {
    box = scalePixelBoxToImageDims(detectionBox, rw, rh, pw, ph);
  }
  const embedding = await processImageForGarmentEmbeddingWithOptionalBox(rawBuffer, processBuf, box);
  const clipBufferForAttributes = await extractGarmentPaddedRoiFromPreparedImage(processBuf, box);
  return { embedding, clipBufferForAttributes, processBuf };
}

/**
 * Garment query vector for image search, aligned with `scripts/resume-reindex.ts` →
 * `processImageForGarmentEmbeddingWithOptionalBox(raw, processBuf, garmentBox)`:
 * - `processBuf` from `prepareBufferForImageSearchQuery` (same as single-image + shop-the-look query prep)
 * - optional YOLO on **original** pixels (same as analyze / stored detections), box scaled onto `processBuf`
 *
 * **Why**: `processImageForGarmentEmbedding` (center crop only) does **not** match bulk-indexed
 * `embedding_garment` when the index used YOLO crops — threshold tuning cannot fix that mismatch.
 *
 * Modes (`SEARCH_IMAGE_GARMENT_QUERY_MODE`):
 * - `aligned` (default): rembg + optional YOLO, then `WithOptionalBox` (matches most `resume-reindex` docs)
 * - `legacy`: `processImageForGarmentEmbedding` only (center crop; closest to **upload** path that never ran YOLO)
 */
export async function computeImageSearchGarmentQueryEmbedding(imageBuffer: Buffer): Promise<number[]> {
  const mode = String(process.env.SEARCH_IMAGE_GARMENT_QUERY_MODE ?? "aligned").toLowerCase();
  if (mode === "legacy" || mode === "center" || mode === "center_crop") {
    return processImageForGarmentEmbedding(imageBuffer);
  }

  const { buffer: processBuf } = await prepareBufferForImageSearchQuery(imageBuffer);
  const [rawMeta, procMeta] = await Promise.all([
    sharp(imageBuffer).metadata(),
    sharp(processBuf).metadata(),
  ]);
  const rw = rawMeta.width ?? 0;
  const rh = rawMeta.height ?? 0;
  const pw = procMeta.width ?? 0;
  const ph = procMeta.height ?? 0;

  const useYolo = String(process.env.SEARCH_IMAGE_QUERY_GARMENT_USE_YOLO ?? "1").toLowerCase() !== "0";
  let box: PixelBox | null = null;
  /** Buffers already smaller than a typical full photo are usually garment ROIs; YOLO on them is noisy and wrong boxes hurt `embedding_garment` kNN. */
  const maxRawSide = Math.max(rw, rh);
  const skipYoloOnLikelyCrop = maxRawSide > 0 && maxRawSide <= 640;
  if (useYolo && !skipYoloOnLikelyCrop) {
    try {
      const { getYOLOv8Client } = await import("./yolov8Client");
      const yolo = getYOLOv8Client();
      if (await yolo.isAvailable()) {
        const res = await yolo.detectFromBuffer(imageBuffer, "query.jpg", { confidence: 0.45 });
        const dets = (res.detections ?? []).filter((d) => (d.confidence ?? 0) >= 0.45);
        const best = pickBestYoloDetectionForGarmentEmbedding(dets);
        if (best?.box) {
          let b: PixelBox = {
            x1: best.box.x1,
            y1: best.box.y1,
            x2: best.box.x2,
            y2: best.box.y2,
          };
          if (rw > 0 && rh > 0 && pw > 0 && ph > 0 && (rw !== pw || rh !== ph)) {
            b = scalePixelBoxToImageDims(b, rw, rh, pw, ph);
          }
          box = b;
        }
      }
    } catch {
      // no box — full-frame garment embed on processBuf
    }
  }

  const emb = await processImageForGarmentEmbeddingWithOptionalBox(imageBuffer, processBuf, box);
  if (Array.isArray(emb) && emb.length > 0) return emb;
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
