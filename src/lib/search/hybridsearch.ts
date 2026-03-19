import { getTextEmbedding } from '../image/clip';
import { blip } from '../image/blip';
import { processImageForEmbedding } from '../image/processor';

const WEIGHTS = {
  clipImage:   0.65,
  clipCaption: 0.35,
};

/**
 * Minimum caption length (in tokens) to be considered useful for
 * fusion.  Very short captions ("a shirt") add noise rather than signal.
 */
const MIN_CAPTION_TOKENS = 3;

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

    // Only use caption embedding when the caption is meaningful.
    // A too-short or empty caption degrades the fused vector.
    const captionTokens = enrichedCaption.split(/\s+/).filter(Boolean);
    const clipCaptionEmbed = (enrichedCaption && captionTokens.length >= MIN_CAPTION_TOKENS)
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
   * Clean BLIP caption and wrap in a CLIP-aligned prompt.
   *
   * Strategy:
   * - Strip only photographic meta-phrases ("a photo of", "an image of")
   * - Keep garment-related verbs ("wearing") — they carry semantic signal
   * - Keep person references only when they modify garment context
   *   ("woman in a red dress" → keep "in a red dress", drop isolated "woman")
   * - Preserve color, material, pattern, and category words unconditionally
   */
  private enrichCaption(rawCaption: string): string {
    let cleaned = rawCaption
      .replace(/^(a photo of |an image of |a picture of |photo of )/i, '')
      .replace(/^(a |an |the )/i, '');

    // Only strip standalone person nouns that don't precede garment context.
    // "woman wearing a red dress" → "wearing a red dress"
    // "a woman" (alone) → "" (no garment info)
    cleaned = cleaned
      .replace(/\b(woman|man|person|people|model|someone)\s+(wearing|in|with)\b/gi, '$2')
      .replace(/\b(woman|man|person|people|model|someone)\s*$/gi, '')
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
