import sharp from "sharp";
import * as fs from "fs";

// Convert sRGB 0-255 to XYZ
function rgbToXyz(r: number, g: number, b: number) {
  const srgb = [r, g, b].map((v) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  const [R, G, B] = srgb;
  return [
    R * 0.4124564 + G * 0.3575761 + B * 0.1804375,
    R * 0.2126729 + G * 0.7151522 + B * 0.0721750,
    R * 0.0193339 + G * 0.1191920 + B * 0.9503041,
  ];
}

function xyzToLab(x: number, y: number, z: number) {
  const xr = x / 0.95047;
  const yr = y / 1.0;
  const zr = z / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(xr);
  const fy = f(yr);
  const fz = f(zr);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function rgbToLab(r: number, g: number, b: number) {
  const [x, y, z] = rgbToXyz(r, g, b);
  return xyzToLab(x, y, z);
}

export function deltaE76(lab1: number[], lab2: number[]) {
  const dl = lab1[0] - lab2[0];
  const da = lab1[1] - lab2[1];
  const db = lab1[2] - lab2[2];
  return Math.sqrt(dl * dl + da * da + db * db);
}

export async function extractAvgLabFromPath(imagePath: string) {
  if (!fs.existsSync(imagePath)) throw new Error(`Image not found: ${imagePath}`);
  const { data, info } = await sharp(imagePath).resize(32, 32, { fit: "inside" }).raw().toBuffer({ resolveWithObject: true });
  let r = 0,
    g = 0,
    b = 0;
  const count = info.width * info.height;
  for (let i = 0; i < data.length; i += info.channels) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  r /= count;
  g /= count;
  b /= count;
  return rgbToLab(r, g, b);
}

export function colorSimFromDeltaE(deltaE: number, sigma = 20) {
  return Math.exp(-(deltaE * deltaE) / (2 * sigma * sigma));
}

export interface Candidate {
  id: string;
  visualSim: number;
  imagePath: string;
}

export async function rerankByColor(queryImagePath: string, candidates: Candidate[], opts?: { w?: number; topK?: number; sigma?: number }) {
  const w = opts?.w ?? 0.2;
  const topK = opts?.topK ?? 50;
  const sigma = opts?.sigma ?? 20;

  const top = candidates.sort((a, b) => b.visualSim - a.visualSim).slice(0, topK);
  const qLab = await extractAvgLabFromPath(queryImagePath);

  const results: Array<Candidate & { colorSim: number; final: number }> = [];

  for (const c of top) {
    try {
      const cLab = await extractAvgLabFromPath(c.imagePath);
      const dE = deltaE76(qLab, cLab);
      const colorSim = colorSimFromDeltaE(dE, sigma);
      const final = (1 - w) * c.visualSim + w * colorSim;
      results.push({ ...c, colorSim, final });
    } catch (err) {
      // If image missing or error, fallback to visualSim only
      results.push({ ...c, colorSim: 0, final: c.visualSim });
    }
  }

  return results.sort((a, b) => b.final - a.final);
}
