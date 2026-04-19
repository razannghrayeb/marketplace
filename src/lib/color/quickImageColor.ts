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

    if (l < 0.10) return ["black"].slice(0, maxHints);
    if (l < 0.18 && s < 0.15) return ["charcoal", "black"].slice(0, maxHints);
    if (l > 0.92 && s < 0.10) return ["white"].slice(0, maxHints);
    if (l > 0.85 && s < 0.12) return ["off-white", "cream"].slice(0, maxHints);
    if (s < 0.12) {
      if (l > 0.65) return ["silver", "gray"].slice(0, maxHints);
      if (l > 0.35) return ["gray"].slice(0, maxHints);
      return ["charcoal", "black"].slice(0, maxHints);
    }

    // Dark saturated — detect before hue mapping which misses dark red/green/blue
    if (l < 0.22 && s >= 0.15) {
      if (h >= 340 || h < 20) return ["burgundy", "red"].slice(0, maxHints);
      if (h >= 200 && h < 260) return ["navy", "blue"].slice(0, maxHints);
      if (h >= 60 && h < 160) return ["olive", "green"].slice(0, maxHints);
      return ["brown", "black"].slice(0, maxHints);
    }

    // Light saturated pastels
    if (l > 0.75 && s >= 0.12 && s < 0.45) {
      if (h >= 340 || h < 15) return ["pink", "red"].slice(0, maxHints);
      if (h >= 15 && h < 45) return ["beige", "tan"].slice(0, maxHints);
      if (h >= 45 && h < 80) {
        const mutedMustard = l < 0.86 && s >= 0.18 && s < 0.36 && h < 68;
        const metallicGold = l >= 0.72 && l < 0.92 && s >= 0.16 && s < 0.28 && h >= 40 && h < 66;
        if (mutedMustard || metallicGold) return ["gold", "yellow"].slice(0, maxHints);
        return ["yellow"].slice(0, maxHints);
      }
      if (h >= 80 && h < 165) return ["green", "sage"].slice(0, maxHints);
      if (h >= 165 && h < 260) return ["light-blue", "blue"].slice(0, maxHints);
      if (h >= 260 && h < 300) return ["purple", "lavender"].slice(0, maxHints);
      return ["pink"].slice(0, maxHints);
    }

    const hints: string[] = [];
    if (h >= 345 || h < 18) hints.push("red");
    else if (h < 45) hints.push("orange", "red");
    else if (h < 75) hints.push("yellow");
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
