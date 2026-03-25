/**
 * Fast dominant-color hints from an upload (no k-means / garment pipeline).
 * Used to seed soft color relevance for image search (~10–30ms vs heavy pipelines).
 */
import sharp from "sharp";

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      default:
        h = ((r - g) / d + 4) / 6;
    }
  }
  return { h: h * 360, s, l };
}

/** Map average pixel color to 1–2 fashion canonical tokens (index-aligned). */
export async function extractQuickFashionColorHints(
  imageBuffer: Buffer,
  opts?: { maxHints?: number }
): Promise<string[]> {
  const maxHints = Math.min(3, Math.max(1, opts?.maxHints ?? 2));
  try {
    const { data, info } = await sharp(imageBuffer)
      .resize(48, 48, { fit: "inside" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const ch = info.channels;
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += ch) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      n++;
    }
    if (n === 0) return [];
    r /= n;
    g /= n;
    b /= n;

    const { h, s, l } = rgbToHsl(r, g, b);

    if (l < 0.12) return ["black"].slice(0, maxHints);
    if (l > 0.92 && s < 0.12) return ["white"].slice(0, maxHints);
    if (s < 0.14) {
      if (l > 0.55) return ["off-white", "cream"].slice(0, maxHints);
      if (l > 0.35) return ["gray"].slice(0, maxHints);
      return ["charcoal", "black"].slice(0, maxHints);
    }

    const hints: string[] = [];
    if (h >= 345 || h < 18) hints.push("red");
    else if (h < 45) hints.push("orange", "red");
    else if (h < 75) hints.push("yellow", "gold");
    else if (h < 165) hints.push("green", "olive");
    else if (h < 200) hints.push("teal");
    else if (h < 260) hints.push("blue", "navy");
    else if (h < 290) hints.push("purple");
    else if (h < 345) hints.push("pink", "red");

    const uniq = [...new Set(hints.map((x) => x.toLowerCase()))];
    return uniq.slice(0, maxHints);
  } catch {
    return [];
  }
}
