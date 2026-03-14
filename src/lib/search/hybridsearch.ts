import { getTextEmbedding } from '../image/clip';
import { blip } from '../image/blip';
import { processImageForEmbedding } from '../image/processor';

const WEIGHTS = {
  clipImage:   0.60,  // visual shape/texture/style
  clipCaption: 0.30,  // semantic color/category from caption
  // remaining 0.10 reserved for color histogram rerank (from prev discussion)
};

export interface SearchVectors {
  clipImageEmbed:   number[];
  clipCaptionEmbed: number[];
  caption:          string;        // store for debugging / display
}

export class HybridSearchService {

  // Build fused vector from a cropped image buffer
  async buildQueryVectors(
    croppedImageBuffer: Buffer,
    originalImageBuffer?: Buffer   // optional — used for richer captioning
  ): Promise<SearchVectors> {

    // Use original for captioning if available (more context = better caption)
    const captionSource = originalImageBuffer ?? croppedImageBuffer;

    // Run CLIP image embed + BLIP caption in parallel
    const [clipImageEmbed, caption] = await Promise.all([
      processImageForEmbedding(croppedImageBuffer),
      blip.caption(captionSource).catch(() => ''),
    ]);

    // Enrich caption with fashion-specific prompt wrapping
    const enrichedCaption = caption ? this.enrichCaption(caption) : '';

    // Embed the caption through CLIP text encoder (if caption exists)
    const clipCaptionEmbed = enrichedCaption
      ? await getTextEmbedding(enrichedCaption).catch(() => clipImageEmbed)
      : clipImageEmbed;

    const result: SearchVectors = {
      clipImageEmbed,
      clipCaptionEmbed,
      caption: enrichedCaption,
    };

    return result;
  }

  // Fuse vectors into single search vector
  fuseVectors(vectors: SearchVectors): number[] {
    const dim = vectors.clipImageEmbed.length;
    const fused = new Array(dim);

    for (let i = 0; i < dim; i++) {
      fused[i] =
        vectors.clipImageEmbed[i]   * WEIGHTS.clipImage +
        vectors.clipCaptionEmbed[i] * WEIGHTS.clipCaption;
    }

    return this.l2Normalize(fused);
  }

  // Wrap BLIP output in fashion-domain prompt for better CLIP alignment
  private enrichCaption(rawCaption: string): string {
    // BLIP: "a woman wearing a red floral dress"
    // Enriched: "fashion product photo: red floral dress, full length, studio shot"
    const cleaned = rawCaption
      .replace(/^(a |an |the )/i, '')
      .replace(/\b(woman|man|person|people|model)\b/gi, '')
      .replace(/\bwearing\b/gi, '')
      .trim();

    return `fashion product photo: ${cleaned}, studio lighting, white background`;
  }

  private l2Normalize(vec: number[]): number[] {
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    return vec.map(v => v / (norm + 1e-8));
  }
}

export const hybridSearch = new HybridSearchService();
