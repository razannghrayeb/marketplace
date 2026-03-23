/**
 * Single facade for CLIP / Fashion-CLIP image embeddings.
 * Route and service layers should not call low-level CLIP helpers directly for search flows.
 */

import { processImageForEmbedding, processImageForGarmentEmbedding } from "../image";
import { attributeEmbeddings } from "./attributeEmbeddings";
import { getOrComputeImageEmbedding } from "../cache/embeddingCache";
import type { SemanticAttribute } from "./multiVectorSearch";
import { blendEmbeddings, normalizeVector, type AttributeEmbedding } from "./multiVectorSearch";

export async function generateGlobalEmbedding(image: Buffer): Promise<number[]> {
  return getOrComputeImageEmbedding(image, "global", () => processImageForEmbedding(image));
}

export async function generateGarmentRoiEmbedding(image: Buffer): Promise<number[]> {
  return processImageForGarmentEmbedding(image);
}

export async function generateAttributeEmbedding(
  image: Buffer,
  attribute: SemanticAttribute,
): Promise<number[]> {
  if (attribute === "global") {
    return generateGlobalEmbedding(image);
  }
  return getOrComputeImageEmbedding(image, attribute, () =>
    attributeEmbeddings.generateImageAttributeEmbedding(image, attribute),
  );
}

export async function generateAttributeEmbeddingsForImage(
  image: Buffer,
  attributes: SemanticAttribute[],
): Promise<AttributeEmbedding[]> {
  const out: AttributeEmbedding[] = [];
  for (const attribute of attributes) {
    const vector = await generateAttributeEmbedding(image, attribute);
    out.push({ attribute, vector, weight: 1 / Math.max(1, attributes.length) });
  }
  return out;
}

/**
 * Build weighted composite vectors from multiple images (fallback when intent parsing fails).
 * Averages global embeddings with equal weight, then L2-normalizes.
 */
export async function generateAveragedGlobalEmbedding(images: Buffer[]): Promise<number[]> {
  if (images.length === 0) throw new Error("generateAveragedGlobalEmbedding: no images");
  const globals = await Promise.all(images.map((img) => generateGlobalEmbedding(img)));
  const dim = globals[0].length;
  const acc = new Array(dim).fill(0);
  for (const g of globals) {
    for (let i = 0; i < dim; i++) acc[i] += g[i] ?? 0;
  }
  for (let i = 0; i < dim; i++) acc[i] /= globals.length;
  return normalizeVector(acc);
}

export async function generateCompositeEmbeddings(
  images: Buffer[],
  _intentDescription: string | undefined,
  perImageAttributes: SemanticAttribute[][],
): Promise<AttributeEmbedding[]> {
  const flat: AttributeEmbedding[] = [];
  let wsum = 0;
  for (let i = 0; i < images.length; i++) {
    const attrs = perImageAttributes[i] ?? ["global"];
    const wi = 1 / (images.length * Math.max(1, attrs.length));
    for (const attribute of attrs) {
      const vector = await generateAttributeEmbedding(images[i], attribute);
      flat.push({ attribute, vector, weight: wi });
      wsum += wi;
    }
  }
  if (wsum <= 0) return flat;
  return flat.map((e) => ({ ...e, weight: e.weight / wsum }));
}

export function blendWeightedAttributeEmbeddings(embeddings: AttributeEmbedding[]): number[] {
  return blendEmbeddings(embeddings);
}
