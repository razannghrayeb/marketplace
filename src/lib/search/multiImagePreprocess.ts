import sharpLib from "sharp";
import { MAX_MULTI_IMAGE_UPLOADS } from "../prompt/gemeni";

const sharp =
  typeof sharpLib === "function"
    ? sharpLib
    : (sharpLib as { default: typeof sharpLib }).default;

const MAX_LONG_EDGE = 512;

/**
 * Cap multi-image uploads and downscale each buffer so Gemini / CLIP payloads stay bounded.
 */
export async function preprocessMultiImageBuffers(buffers: Buffer[]): Promise<Buffer[]> {
  const sliced = buffers.slice(0, MAX_MULTI_IMAGE_UPLOADS);
  const out: Buffer[] = [];
  for (const buf of sliced) {
    try {
      const img = sharp(buf);
      const meta = await img.metadata();
      const w = meta.width ?? 0;
      const h = meta.height ?? 0;
      const longEdge = Math.max(w, h);
      if (longEdge === 0 || longEdge <= MAX_LONG_EDGE) {
        out.push(buf);
        continue;
      }
      const resized = await img
        .resize({
          width: MAX_LONG_EDGE,
          height: MAX_LONG_EDGE,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 88 })
        .toBuffer();
      out.push(resized);
    } catch (e) {
      console.warn("[multiImagePreprocess] skipping resize for one buffer:", e);
      out.push(buf);
    }
  }
  return out;
}
