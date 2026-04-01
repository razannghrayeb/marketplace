/**
 * Catalog vs image-search query preparation before CLIP (`processImageForEmbedding`).
 *
 * - **Catalog** (`prepareBufferForPrimaryCatalogEmbedding`, reindex/upload/backfill): conditional
 *   rembg on busy backgrounds (matches `resume-reindex` defaults).
 * - **Image search** (`prepareBufferForImageSearchQuery`): default **always** rembg when sidecar is
 *   up, so user photos resemble cutout catalog embeddings.
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

/** Samples corners/edges (64²) — shared with `scripts/resume-reindex.ts`. */
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

export function catalogBgRemovalThresholdFromEnv(): number {
  const raw = Number(process.env.SEARCH_IMAGE_BG_REMOVAL_THRESHOLD ?? "35");
  return Number.isFinite(raw) ? Math.max(0, Math.min(200, raw)) : 35;
}

function rembgIndexTimeoutMs(): number {
  const raw = Number(process.env.SEARCH_IMAGE_REMBG_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw >= 3000) return Math.min(120_000, Math.floor(raw));
  return 30_000;
}

/**
 * Remove background — flatten to white JPEG @ quality 92 (same as bulk reindex).
 */
async function removeBackgroundCatalogAligned(
  imageBuffer: Buffer,
  timeoutMs: number,
): Promise<Buffer | null> {
  if (!(await isRembgAvailable())) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
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
  bgRemoved: boolean;
}

export interface CatalogImagePrepOptions {
  /** When false, input is passed through (no rembg). */
  enableBgRemoval: boolean;
  /** Run rembg when `computeBgComplexityScore` >= threshold. */
  threshold: number;
  rembgTimeoutMs: number;
}

/**
 * Explicit-options entry point (used by `resume-reindex` and tests).
 * Upload/backfill use `prepareBufferForPrimaryCatalogEmbedding` (env-driven).
 */
export async function preparePrimaryImageBufferForCatalogEmbedding(
  rawBuffer: Buffer,
  options: CatalogImagePrepOptions,
): Promise<PrepareBufferResult> {
  if (!options.enableBgRemoval) {
    return { buffer: rawBuffer, bgRemoved: false };
  }

  const score = await computeBgComplexityScore(rawBuffer);
  if (score < options.threshold) {
    return { buffer: rawBuffer, bgRemoved: false };
  }

  const cleaned = await removeBackgroundCatalogAligned(rawBuffer, options.rembgTimeoutMs);
  if (cleaned && cleaned.length > 0) {
    return { buffer: cleaned, bgRemoved: true };
  }
  return { buffer: rawBuffer, bgRemoved: false };
}

/**
 * Env-driven preparation for API paths (image search, upload, OpenSearch backfill).
 *
 * Default **on** (`SEARCH_IMAGE_BG_REMOVAL=1`): matches `scripts/resume-reindex.ts` default
 * (`bgRemoval: true`). Set `SEARCH_IMAGE_BG_REMOVAL=0` only if every indexed document was
 * built with `--no-bg-removal` (raw pixels only).
 */
export async function prepareBufferForPrimaryCatalogEmbedding(
  rawBuffer: Buffer,
): Promise<PrepareBufferResult> {
  const flag = String(process.env.SEARCH_IMAGE_BG_REMOVAL ?? "1").toLowerCase().trim();
  const disabled = flag === "0" || flag === "false" || flag === "off";
  if (disabled) {
    return { buffer: rawBuffer, bgRemoved: false };
  }

  return preparePrimaryImageBufferForCatalogEmbedding(rawBuffer, {
    enableBgRemoval: true,
    threshold: catalogBgRemovalThresholdFromEnv(),
    rembgTimeoutMs: rembgIndexTimeoutMs(),
  });
}

/**
 * Query-time prep for `POST /products/search/image` (and facade image search).
 *
 * - **`always`** (default): if rembg sidecar is healthy, always remove background (then flatten
 *   to white JPEG like indexing). Matches embedded catalog style for user street/room photos.
 * - **`conditional`**: same heuristic as catalog (`SEARCH_IMAGE_BG_REMOVAL` + complexity threshold).
 * - **`off`**: raw bytes.
 */
export async function prepareBufferForImageSearchQuery(
  rawBuffer: Buffer,
): Promise<PrepareBufferResult> {
  const mode = String(process.env.SEARCH_IMAGE_QUERY_REMBG ?? "always").toLowerCase().trim();

  if (mode === "off" || mode === "0" || mode === "false") {
    return { buffer: rawBuffer, bgRemoved: false };
  }

  if (mode === "conditional" || mode === "catalog") {
    return prepareBufferForPrimaryCatalogEmbedding(rawBuffer);
  }

  // always (default) — try rembg whenever sidecar is up
  const cleaned = await removeBackgroundCatalogAligned(rawBuffer, rembgIndexTimeoutMs());
  if (cleaned && cleaned.length > 0) {
    return { buffer: cleaned, bgRemoved: true };
  }
  return { buffer: rawBuffer, bgRemoved: false };
}
