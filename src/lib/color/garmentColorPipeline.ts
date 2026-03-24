/**
 * Garment-focused color extraction: crop → k-means in RGB → map to fashion canonical tokens.
 * Optional pixel box uses the same convention as processImageForGarmentEmbeddingWithOptionalBox.
 */
import sharp from "sharp";
import type { PixelBox } from "../image/processor";
import { extractGarmentCenterCropBuffer } from "../image/processor";

export interface GarmentColorAnalysis {
  /** Primary fashion canonical (hyphenated token) */
  primaryCanonical: string;
  secondaryCanonical: string | null;
  accentCanonical: string | null;
  /** All distinct canonicals ordered by prominence */
  paletteCanonical: string[];
  /** Confidence in primary assignment [0, 1] */
  confidencePrimary: number;
  /** Raw cluster weights (sum ~1) aligned with palette order */
  clusterWeights: number[];
}

/** Reference sRGB centers for mapping (D65). */
const CANONICAL_REF_RGB: Record<string, [number, number, number]> = {
  black: [18, 18, 20],
  white: [248, 248, 248],
  "off-white": [236, 232, 224],
  cream: [242, 236, 220],
  ivory: [240, 240, 230],
  beige: [218, 206, 188],
  brown: [110, 72, 52],
  camel: [188, 148, 108],
  tan: [196, 162, 128],
  gray: [145, 145, 148],
  charcoal: [58, 58, 62],
  silver: [178, 182, 188],
  navy: [28, 42, 86],
  blue: [48, 92, 196],
  "light-blue": [156, 198, 238],
  green: [42, 128, 72],
  olive: [96, 98, 52],
  red: [196, 48, 48],
  burgundy: [96, 28, 44],
  pink: [232, 168, 188],
  purple: [118, 62, 148],
  yellow: [246, 220, 52],
  orange: [238, 128, 42],
  gold: [212, 168, 56],
  teal: [32, 128, 128],
  multicolor: [128, 128, 128],
};

function rgbToXyz(r: number, g: number, b: number): [number, number, number] {
  const fn = (c: number) => {
    c = c / 255;
    return c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92;
  };
  const R = fn(r);
  const G = fn(g);
  const B = fn(b);
  const X = R * 0.4124564 + G * 0.3575761 + B * 0.1804375;
  const Y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  const Z = R * 0.0193339 + G * 0.119192 + B * 0.9503041;
  return [X, Y, Z];
}

function xyzToLab(x: number, y: number, z: number): [number, number, number] {
  const Xn = 0.95047;
  const Yn = 1.0;
  const Zn = 1.08883;
  let xr = x / Xn;
  let yr = y / Yn;
  let zr = z / Zn;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(xr);
  const fy = f(yr);
  const fz = f(zr);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const [x, y, z] = rgbToXyz(r, g, b);
  return xyzToLab(x, y, z);
}

function labDist(a: [number, number, number], b: [number, number, number]): number {
  return Math.sqrt(
    (a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]) + (a[2] - b[2]) * (a[2] - b[2]),
  );
}

function mapRgbToCanonical(r: number, g: number, b: number): string {
  const lab = rgbToLab(r, g, b);
  let bestName = "gray";
  let bestD = Infinity;
  for (const [name, rgb] of Object.entries(CANONICAL_REF_RGB)) {
    const L = rgbToLab(rgb[0], rgb[1], rgb[2]);
    const d = labDist(lab, L);
    if (d < bestD) {
      bestD = d;
      bestName = name;
    }
  }
  // Very dark → black
  if (lab[0] < 18 && bestD > 18) return "black";
  // Very light near-neutral → white/off-white/cream
  if (lab[0] > 88 && Math.abs(lab[1]) < 10 && Math.abs(lab[2]) < 10) {
    if (lab[2] > 6) return "cream";
    if (lab[2] < -4) return "off-white";
    return "white";
  }
  return bestName;
}

type Cluster = { r: number; g: number; b: number; w: number };

function kMeansRgb(pixels: [number, number, number][], k: number, iterations: number): Cluster[] {
  if (pixels.length === 0) return [];
  const n = Math.min(k, pixels.length);
  const centroids: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    centroids.push([...pixels[(Math.floor((i * pixels.length) / n) | 0) % pixels.length]] as [
      number,
      number,
      number,
    ]);
  }

  const assignments = new Array(pixels.length).fill(0);

  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < pixels.length; i++) {
      const p = pixels[i];
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const [cr, cg, cb] = centroids[c];
        const d =
          (p[0] - cr) * (p[0] - cr) + (p[1] - cg) * (p[1] - cg) + (p[2] - cb) * (p[2] - cb);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      assignments[i] = best;
    }

    const sums: [number, number, number][] = centroids.map(() => [0, 0, 0]);
    const counts = new Array(centroids.length).fill(0);
    for (let i = 0; i < pixels.length; i++) {
      const a = assignments[i];
      sums[a][0] += pixels[i][0];
      sums[a][1] += pixels[i][1];
      sums[a][2] += pixels[i][2];
      counts[a]++;
    }
    for (let c = 0; c < centroids.length; c++) {
      if (counts[c] > 0) {
        centroids[c] = [sums[c][0] / counts[c], sums[c][1] / counts[c], sums[c][2] / counts[c]];
      }
    }
  }

  const counts = new Array(centroids.length).fill(0);
  for (const a of assignments) counts[a]++;

  const out: Cluster[] = centroids.map((c, i) => ({
    r: c[0],
    g: c[1],
    b: c[2],
    w: counts[i] / Math.max(1, pixels.length),
  }));

  out.sort((a, b) => b.w - a.w);
  return out;
}

export interface ExtractGarmentFashionColorsOpts {
  /** Optional garment box in original image pixels */
  box?: PixelBox | null;
  /** Max k-means clusters (default 4) */
  k?: number;
  /** Minimum cluster share to include as secondary/accent (default 0.1) */
  minShare?: number;
}

/**
 * Extract primary/secondary/accent fashion canonical colors from a product image buffer.
 */
export async function extractGarmentFashionColors(
  imageBuffer: Buffer,
  opts?: ExtractGarmentFashionColorsOpts,
): Promise<GarmentColorAnalysis> {
  const k = Math.min(6, Math.max(2, opts?.k ?? 4));
  const minShare = opts?.minShare ?? 0.1;

  let cropBuf: Buffer;
  if (opts?.box) {
    const meta = await sharp(imageBuffer).metadata();
    const iw = meta.width ?? 0;
    const ih = meta.height ?? 0;
    const box = opts.box;
    if (iw > 32 && ih > 32 && box.x2 > box.x1 + 2 && box.y2 > box.y1 + 2) {
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
      cropBuf = await sharp(imageBuffer).extract({ left: x1, top: y1, width: w, height: h }).png().toBuffer();
    } else {
      cropBuf = await extractGarmentCenterCropBuffer(imageBuffer);
    }
  } else {
    cropBuf = await extractGarmentCenterCropBuffer(imageBuffer);
  }

  const { data, info } = await sharp(cropBuf)
    .resize(96, 96, { fit: "cover" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const ch = info.channels;
  const pixels: [number, number, number][] = [];
  for (let i = 0; i < data.length; i += ch) {
    pixels.push([data[i], data[i + 1], data[i + 2]]);
  }

  // Subsample for speed
  const step = 2;
  const sampled: [number, number, number][] = [];
  for (let i = 0; i < pixels.length; i += step) sampled.push(pixels[i]);

  const clusters = kMeansRgb(sampled, k, 8);
  const canonList: string[] = [];
  const weights: number[] = [];
  const seen = new Set<string>();

  for (const cl of clusters) {
    if (cl.w < minShare * 0.35 && canonList.length >= 1) continue;
    const canon = mapRgbToCanonical(cl.r, cl.g, cl.b);
    if (!seen.has(canon)) {
      seen.add(canon);
      canonList.push(canon);
      weights.push(cl.w);
    }
    if (canonList.length >= 5) break;
  }

  if (canonList.length === 0) {
    return {
      primaryCanonical: "gray",
      secondaryCanonical: null,
      accentCanonical: null,
      paletteCanonical: ["gray"],
      confidencePrimary: 0.2,
      clusterWeights: [1],
    };
  }

  const primaryCanonical = canonList[0];
  const secondaryCanonical = canonList.length > 1 ? canonList[1] : null;
  const accentCanonical = canonList.length > 2 ? canonList[2] : null;

  const w0 = weights[0] ?? 1;
  const w1 = weights[1] ?? 0;
  const separation =
    clusters.length >= 2
      ? Math.sqrt(
          (clusters[0].r - clusters[1].r) ** 2 +
            (clusters[0].g - clusters[1].g) ** 2 +
            (clusters[0].b - clusters[1].b) ** 2,
        ) /
        441.0
      : 0.5;
  const confidencePrimary = Math.max(0.25, Math.min(0.95, w0 * 0.55 + separation * 0.35 + (canonList.length >= 2 ? 0.1 : 0)));

  return {
    primaryCanonical,
    secondaryCanonical,
    accentCanonical,
    paletteCanonical: canonList,
    confidencePrimary,
    clusterWeights: weights.length ? weights : [1],
  };
}
