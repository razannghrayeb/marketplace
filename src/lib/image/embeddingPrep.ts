/**
 * Align query-time image bytes with catalog indexing (`resume-reindex` / bulk embed).
 * Root issue addressed: primary CLIP vectors must see the same pixels as indexed docs
 * (conditional background removal on busy scenes), not a mix of raw vs cleaned.
 */
import sharpLib from "sharp";
const sharp = typeof sharpLib === "function" ? sharpLib : (sharpLib as any).default;

let rembgHealthy: boolean | null = null;
let rembgLastCheck = 0;
const REMBG_HEALTH_TTL_MS = 30_000;

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

/** Samples corners/edges (64²) — same heuristic as `scripts/resume-reindex.ts`. */
export async function computeBgComplexityScore(imageBuffer: Buffer): Promise<number> {
  try {
    const { data, info } = await sharp(imageBuffer)
      .resize(64, 64, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const ch = info.channels as number;
    const sampleCoords: [number, number][] = [
      [0, 0],
      [63, 0],
      [0, 63],
      [63, 63],
      [31, 0],
      [0, 31],
      [63, 31],
      [31, 63],
      [8, 8],
      [55, 8],
      [8, 55],
      [55, 55],
    ];

    let totalDist = 0;
    for (const [x, y] of sampleCoords) {
      const idx = (y * 64 + x) * ch;
      const r = data[idx] ?? 255;
      const g = data[idx + 1] ?? 255;
      const b = data[idx + 2] ?? 255;
      totalDist += Math.sqrt(Math.pow(255 - r, 2) + Math.pow(255 - g, 2) + Math.pow(255 - b, 2));
    }

    return totalDist / sampleCoords.length;
  } catch {
    return 999;
  }
}

function bgRemovalThreshold(): number {
  const raw = Number(process.env.SEARCH_IMAGE_BG_REMOVAL_THRESHOLD ?? "35");
  return Number.isFinite(raw) ? Math.max(0, Math.min(200, raw)) : 35;
}

function rembgIndexTimeoutMs(): number {
  const raw = Number(process.env.SEARCH_IMAGE_REMBG_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw >= 3000) return Math.min(120_000, Math.floor(raw));
  return 30_000;
}

/**
 * Remove background using the same flatten-to-JPEG output as indexing (matches `resume-reindex`).
 */
async function removeBackgroundCatalogAligned(imageBuffer: Buffer): Promise<Buffer | null> {
  if (!(await isRembgAvailable())) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), rembgIndexTimeoutMs());
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

export interface PrepareBufferResult {
  buffer: Buffer;
  /** True when rembg ran successfully and replaced the input. */
  bgRemoved: boolean;
}

/**
 * Prepare raw upload bytes the same way bulk indexing prepares `processBuf` before
 * `processImageForEmbedding` (conditional rembg on visually complex backgrounds).
 *
 * Set `SEARCH_IMAGE_BG_REMOVAL=0` to always use the raw buffer (legacy / debugging).
 */
export async function prepareBufferForPrimaryCatalogEmbedding(
  rawBuffer: Buffer,
): Promise<PrepareBufferResult> {
  const disabled =
    String(process.env.SEARCH_IMAGE_BG_REMOVAL ?? "1").toLowerCase() === "0" ||
    String(process.env.SEARCH_IMAGE_BG_REMOVAL ?? "1").toLowerCase() === "false";
  if (disabled) {
    return { buffer: rawBuffer, bgRemoved: false };
  }

  const score = await computeBgComplexityScore(rawBuffer);
  if (score < bgRemovalThreshold()) {
    return { buffer: rawBuffer, bgRemoved: false };
  }

  const cleaned = await removeBackgroundCatalogAligned(rawBuffer);
  if (cleaned && cleaned.length > 0) {
    return { buffer: cleaned, bgRemoved: true };
  }
  return { buffer: rawBuffer, bgRemoved: false };
}
