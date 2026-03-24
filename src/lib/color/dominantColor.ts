import { extractGarmentFashionColors } from "./garmentColorPipeline";

/**
 * Dominant fashion colors from a product image (garment center crop + k-means + LAB mapping).
 * Returns canonical tokens aligned with `color_*_canonical` index fields.
 */
export async function extractDominantColorNames(
  imageBuffer: Buffer,
  opts?: { maxColors?: number; minShare?: number; garmentCenterCrop?: boolean },
): Promise<string[]> {
  const maxColors = opts?.maxColors ?? 2;
  const analysis = await extractGarmentFashionColors(imageBuffer, {
    minShare: opts?.minShare ?? 0.1,
  });
  return analysis.paletteCanonical.slice(0, maxColors);
}
