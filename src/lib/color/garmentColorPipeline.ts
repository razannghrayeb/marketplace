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
  const chroma = Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]);
  const blueLead = b - Math.max(r, g);
  const redLead = r - Math.max(g, b);
  const greenLead = g - Math.max(r, b);

  // Achromatic neutrals — widen gate to chroma < 11 so very desaturated
  // darks (near-black leather, dark charcoal wool) don't bleed into navy/brown.
  if (chroma < 11) {
    // Keep very light cool tones from collapsing into white/off-white.
    if (lab[0] > 78 && lab[2] <= -3 && blueLead >= 6) return "light-blue";
    // Pale yellows are often low-chroma in studio lighting; avoid mapping to beige/off-white.
    if (lab[0] > 72 && lab[2] >= 12 && lab[1] >= -2) return "yellow";
    if (lab[0] < 14) return "black";
    if (lab[0] < 36) return "charcoal";
    if (lab[0] < 60) return "gray";
    if (lab[0] < 78) return "silver";
    if (lab[0] > 92) return "white";
    return "off-white";
  }

  // Dark saturated: detect via channel dominance before LAB distance
  // which otherwise collapses dark red/green/brown → black.
  if (lab[0] < 42 && blueLead >= 8 && chroma >= 10) {
    return lab[0] < 30 ? "navy" : "blue";
  }
  if (lab[0] < 30 && redLead >= 10 && chroma >= 12) {
    return "burgundy";
  }
  if (lab[0] < 35 && greenLead >= 5 && chroma >= 10) {
    return "olive";
  }

  // Light desaturated: cream/off-white/beige before LAB distance rounds to white/gray.
  if (lab[0] > 82 && chroma >= 9 && chroma < 22) {
    // Baby blue / powder blue often lives in this range but should not collapse into off-white.
    if (lab[2] <= -6 || (blueLead >= 10 && lab[1] <= 2)) return "light-blue";
    // Very light yellow fabric can be weakly saturated and otherwise map to beige.
    if (lab[2] >= 18 && lab[1] >= -2 && lab[1] <= 10) return "yellow";
    if (lab[1] > 3 && lab[2] > 8) return "cream";
    // Keep off-white narrowly neutral; strong negative b* indicates cool blue, not white.
    if (lab[1] < -2 && lab[2] > -4 && lab[2] < 4) return "off-white";
    if (lab[2] > 12) return "beige";
    if (Math.abs(lab[1]) < 6 && Math.abs(lab[2]) < 8) return "white";
  }

  // Light saturated pastels: LAB distance otherwise rounds to white/cream.
  if (lab[0] > 75 && chroma >= 15 && chroma < 30) {
    if (lab[1] > 8) return "pink";
    // Restrict gold to muted mustard / metallic yellow tones, not ordinary bright yellow.
    if (lab[2] > 20 && lab[1] > 6 && lab[0] < 86) return "gold";
    if (lab[2] < -10 || lab[1] < -8) return "light-blue";
  }

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

  if (lab[0] < 18 && chroma < 8 && bestD > 18) return "black";

  // Widen light-neutral gate (was L>88 abs<10 — missed many light fabrics).
  if (lab[0] > 85 && Math.abs(lab[1]) < 12 && Math.abs(lab[2]) < 12) {
    // Preserve cool light-blue tones from collapsing to off-white.
    if (lab[2] <= -6 || (blueLead >= 10 && chroma >= 8)) return "light-blue";
    if (lab[2] > 6) return "cream";
    if (lab[2] < -4 && chroma < 10) return "off-white";
    if (chroma < 12) return "white";
  }

  // Multicolor ref is neutral gray; huge LAB distance = real color didn't match.
  if (bestName === "multicolor" && bestD > 25) {
    if (lab[0] < 35) return "charcoal";
    if (lab[0] > 70) return "gray";
  }

  return bestName;
}

// ─── Canonical color set (keep in sync with CANONICAL_REF_RGB keys above) ──
const CANONICAL_COLOR_SET = new Set(Object.keys(CANONICAL_REF_RGB));

/**
 * Vendor text-name → canonical token. Covers common CSS names, fashion aliases,
 * and locale variants so raw catalog strings map correctly without image analysis.
 */
const CATALOG_COLOR_NAME_MAP: Record<string, string> = {
  // blues
  "light blue": "light-blue",
  "sky blue": "light-blue",
  "baby blue": "light-blue",
  "powder blue": "light-blue",
  "cobalt blue": "blue",
  "royal blue": "blue",
  "electric blue": "blue",
  "cornflower blue": "blue",
  "dark blue": "navy",
  "midnight blue": "navy",
  "navy blue": "navy",
  "indigo": "navy",
  "denim": "blue",
  // greens
  "forest green": "green",
  "dark green": "green",
  "hunter green": "green",
  "emerald": "green",
  "emerald green": "green",
  "mint": "green",
  "mint green": "green",
  "sage": "olive",
  "sage green": "olive",
  "army green": "olive",
  "military green": "olive",
  "khaki green": "olive",
  "moss": "olive",
  "moss green": "olive",
  // reds / pinks
  "dark red": "burgundy",
  "wine": "burgundy",
  "wine red": "burgundy",
  "maroon": "burgundy",
  "crimson": "red",
  "scarlet": "red",
  "cherry": "burgundy",
  "cherry red": "burgundy",
  "rust": "burgundy",
  "terracotta": "burgundy",
  "light pink": "pink",
  "hot pink": "pink",
  "fuchsia": "pink",
  "magenta": "pink",
  "rose": "pink",
  "blush": "pink",
  "blush pink": "pink",
  "dusty pink": "pink",
  "dusty rose": "pink",
  "mauve": "pink",
  "salmon": "pink",
  "coral": "orange",
  // purples
  "lavender": "purple",
  "violet": "purple",
  "plum": "purple",
  "lilac": "purple",
  "light purple": "purple",
  "dark purple": "purple",
  "grape": "purple",
  // yellows / oranges / golds
  "light yellow": "yellow",
  "mustard": "gold",
  "mustard yellow": "gold",
  "golden": "gold",
  "champagne": "gold",
  "amber": "gold",
  "bronze": "gold",
  "light orange": "orange",
  "dark orange": "orange",
  "burnt orange": "orange",
  // teals / aquas
  "aqua": "teal",
  "turquoise": "teal",
  "mint blue": "teal",
  "cyan": "teal",
  // neutrals
  "light gray": "silver",
  "light grey": "silver",
  "pale gray": "silver",
  "pale grey": "silver",
  "dark gray": "charcoal",
  "dark grey": "charcoal",
  "slate": "charcoal",
  "slate gray": "charcoal",
  "slate grey": "charcoal",
  "charcoal gray": "charcoal",
  "charcoal grey": "charcoal",
  "light brown": "tan",
  "dark brown": "brown",
  "chocolate": "brown",
  "chocolate brown": "brown",
  "mocha": "brown",
  "espresso": "brown",
  "chestnut": "brown",
  "cognac": "camel",
  "caramel": "camel",
  "tan brown": "tan",
  "khaki": "tan",
  "sand": "beige",
  "taupe": "beige",
  "nude": "beige",
  "neutral": "beige",
  "stone": "beige",
  "linen": "cream",
  "ecru": "cream",
  "natural": "cream",
  "off white": "off-white",
  "eggshell": "off-white",
  "milk": "white",
  "snow": "white",
  // metallics
  "silver gray": "silver",
  "silver grey": "silver",
  "metallic": "silver",
  "metallic silver": "silver",
  "metallic gold": "gold",
  "gunmetal": "charcoal",
};

/**
 * Normalize a raw vendor catalog color string to a canonical fashion token.
 * Handles: hex codes, CSS names, fashion aliases, already-canonical tokens.
 * Returns null when the string cannot be mapped (caller falls back to image analysis).
 */
export function normalizeCatalogColorToCanonical(colorStr: string | null | undefined): string | null {
  if (!colorStr) return null;
  const raw = String(colorStr).trim().toLowerCase().replace(/\s+/g, " ");
  if (!raw) return null;

  // Already a canonical token
  if (CANONICAL_COLOR_SET.has(raw)) return raw;

  // Hex code ("#rrggbb" or "rrggbb")
  if (raw.startsWith("#") || /^[0-9a-f]{6}$/i.test(raw)) {
    const hex = raw.startsWith("#") ? raw : `#${raw}`;
    return mapHexToFashionCanonical(hex);
  }

  // Text name lookup
  const mapped = CATALOG_COLOR_NAME_MAP[raw];
  if (mapped) return mapped;

  // Partial match: if the raw string *contains* a canonical token, use it
  // (e.g. "dark olive green" → "olive", "cobalt" → "blue" via "cobalt blue")
  for (const token of CANONICAL_COLOR_SET) {
    if (raw.includes(token)) return token;
  }

  return null;
}

/**
 * Reuse garment color canonical mapping for pre-extracted hex colors.
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const cleaned = String(hex || "").replace("#", "").trim();
  if (cleaned.length !== 6) return null;
  const n = Number.parseInt(cleaned, 16);
  if (!Number.isFinite(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function mapHexToFashionCanonical(hex?: string | null): string | null {
  const raw = String(hex || "").trim();
  if (!raw) return null;
  const rgb = hexToRgb(raw);
  if (!rgb) return null;
  return mapRgbToCanonical(rgb.r, rgb.g, rgb.b);
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

  // Strip near-white studio background pixels before clustering so they don't
  // dilute a dark/coloured garment into "white" or "off-white".
  // Heuristic: all channels >= 238 AND low saturation (max−min <= 15).
  // Safety fallback: if >70 % of pixels would be removed the garment is itself
  // light-coloured (white shirt, ivory dress) — keep all pixels in that case.
  const bgFiltered = pixels.filter(([r, g, b]) => {
    return !(r >= 238 && g >= 238 && b >= 238 && Math.max(r, g, b) - Math.min(r, g, b) <= 15);
  });
  const effectivePixels = bgFiltered.length >= pixels.length * 0.3 ? bgFiltered : pixels;

  // Subsample for speed
  const step = 2;
  const sampled: [number, number, number][] = [];
  for (let i = 0; i < effectivePixels.length; i += step) sampled.push(effectivePixels[i]);

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

  const promotableNeutralColors = new Set([
    "gray",
    "charcoal",
    "white",
    "off-white",
    "cream",
    "ivory",
    "beige",
    "tan",
    "silver",
  ]);
  if (
    canonList[0] === "black" &&
    canonList.length > 1 &&
    promotableNeutralColors.has(canonList[1]) &&
    (weights[1] ?? 0) >= 0.2 &&
    (weights[0] ?? 0) - (weights[1] ?? 0) <= 0.25
  ) {
    const first = canonList[0];
    const second = canonList[1];
    canonList[0] = second;
    canonList[1] = first;
    const primaryWeight = weights[0] ?? 1;
    weights[0] = weights[1] ?? 0;
    weights[1] = primaryWeight;
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
