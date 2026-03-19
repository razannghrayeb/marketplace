import { getTextEmbedding } from '../image/clip';
import { blip } from '../image/blip';
import { processImageForEmbedding } from '../image/processor';

const WEIGHTS = {
  clipImage:   0.65,
  clipCaption: 0.35,
};

export interface SearchVectors {
  clipImageEmbed:   number[];
  clipCaptionEmbed: number[];
  caption:          string;
}

export class HybridSearchService {

  async buildQueryVectors(
    croppedImageBuffer: Buffer,
    originalImageBuffer?: Buffer
  ): Promise<SearchVectors> {

    const captionSource = originalImageBuffer ?? croppedImageBuffer;

    const [clipImageEmbed, caption] = await Promise.all([
      processImageForEmbedding(croppedImageBuffer),
      blip.caption(captionSource).catch(() => ''),
    ]);

    const enrichedCaption = caption ? this.enrichCaption(caption) : '';

    const clipCaptionEmbed = enrichedCaption
      ? await getTextEmbedding(enrichedCaption).catch(() => clipImageEmbed)
      : clipImageEmbed;

    return { clipImageEmbed, clipCaptionEmbed, caption: enrichedCaption };
  }

  /**
   * Fuse image and caption vectors into a single search vector.
   *
   * Weights sum to 1.0 so the fused vector starts at roughly unit length
   * before the L2 normalization pass.  The caption vector provides
   * semantic grounding (color, category) that pure image embeddings miss,
   * while the image vector captures visual details (texture, silhouette).
   */
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

  /**
   * Wrap BLIP caption in a prompt that aligns with CLIP's training
   * distribution.  Keep the descriptive content — only strip filler
   * words that add no visual meaning.
   */
  private enrichCaption(rawCaption: string): string {
    const cleaned = rawCaption
      .replace(/^(a photo of |an image of |a picture of )/i, '')
      .replace(/^(a |an |the )/i, '')
      .replace(/\b(woman|man|person|people|model|someone)\b/gi, '')
      .replace(/\bwearing\b/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (!cleaned) return '';

    return `a photo of ${cleaned}, fashion product`;
  }

  private l2Normalize(vec: number[]): number[] {
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    if (norm < 1e-8) return vec;
    return vec.map(v => v / norm);
  }
}

export const hybridSearch = new HybridSearchService();
