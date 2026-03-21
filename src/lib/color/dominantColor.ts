import sharp from "sharp";

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;

  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;

  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h, s, v };
}

function hueToColorName(h: number): string {
  if (h < 15 || h >= 345) return "red";
  if (h < 40) return "orange";
  if (h < 65) return "yellow";
  if (h < 170) return "green";
  if (h < 200) return "teal";
  if (h < 260) return "blue";
  if (h < 300) return "purple";
  return "pink";
}

/**
 * Fast dominant color extraction from product image.
 * Returns normalized color names suitable for OpenSearch attr_colors.
 */
export async function extractDominantColorNames(
  imageBuffer: Buffer,
  opts?: { maxColors?: number; minShare?: number; garmentCenterCrop?: boolean }
): Promise<string[]> {
  const maxColors = opts?.maxColors ?? 2;
  const minShare = opts?.minShare ?? 0.08;
  const garmentCenterCrop = opts?.garmentCenterCrop !== false;

  let pipeline = sharp(imageBuffer).removeAlpha();

  if (garmentCenterCrop) {
    const meta = await pipeline.metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (w > 32 && h > 32) {
      const left = Math.floor(w * 0.18);
      const top = Math.floor(h * 0.12);
      const width = Math.max(1, Math.floor(w * 0.64));
      const height = Math.max(1, Math.floor(h * 0.62));
      pipeline = pipeline.extract({ left, top, width, height });
    }
  }

  const { data, info } = await pipeline
    .resize(64, 64, { fit: "cover" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const counts = new Map<string, number>();
  const channels = info.channels;
  const pixelCount = Math.floor(data.length / channels);

  for (let i = 0; i < data.length; i += channels) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    const { h, s, v } = rgbToHsv(r, g, b);

    let color: string;
    // Neutrals tuned for fashion product photos:
    // - Many "black" garments have some texture/shadows; v threshold is higher.
    // - Many "white" garments include highlights; use high v + low saturation.
    if (v < 0.28) color = "black";
    else if (v > 0.82 && s < 0.22) color = "white";
    else if (s < 0.18) color = "gray";
    // Brown is low-bright orange/yellow range
    else if (h >= 20 && h < 45 && v < 0.72) color = "brown";
    else color = hueToColorName(h);

    counts.set(color, (counts.get(color) ?? 0) + 1);
  }

  const ranked = [...counts.entries()]
    .map(([name, count]) => ({ name, share: count / Math.max(1, pixelCount) }))
    .filter((x) => x.share >= minShare)
    .sort((a, b) => b.share - a.share)
    .slice(0, maxColors)
    .map((x) => x.name);

  return ranked;
}
