/**
 * Attribute-Specific Embedding Generation
 * 
 * Generates specialized embeddings for different semantic attributes
 * using prompt engineering and CLIP text/image encoding.
 * 
 * Now includes:
 * - Redis caching for embeddings (24h TTL)
 * - Attention-based adaptive fusion (replaces static 70/30)
 * - A/B testing support for fusion strategies
 */

import { getTextEmbedding } from "../image/clip";
import { processImageForEmbedding } from "../image/processor";
import { getOrComputeImageEmbedding, getOrComputeTextEmbedding } from "../cache/embeddingCache";
import { fuseEmbeddingsAdaptive, getAdaptiveWeights } from "./attentionFusion";
import type { SemanticAttribute } from "./multiVectorSearch";

// ============================================================================
// Attribute Prompt Templates
// ============================================================================

/**
 * Attribute-focused prompts to guide CLIP text encoder
 * These prompts prime the embedding space for specific semantic aspects
 */
/**
 * Attribute-focused prompts for CLIP text encoder.
 *
 * These are structured as image captions (matching CLIP's training data)
 * rather than abstract descriptions.  Shorter, concrete prompts produce
 * tighter clusters in CLIP's latent space.
 */
const ATTRIBUTE_PROMPTS: Record<Exclude<SemanticAttribute, "global">, string> = {
  color: "a fashion item in this color, showing the dominant color of the garment",
  texture: "a close-up of the fabric texture of this clothing item",
  material: "a fashion product made of this fabric material",
  style: "a fashion outfit in this style aesthetic",
  pattern: "a garment with this pattern or print design",
};

// ============================================================================
// Attribute Embedding Generator
// ============================================================================

export class AttributeEmbeddingGenerator {
  /**
   * Generate embedding for a specific semantic attribute from an image.
   *
   * Now uses:
   * - Redis caching for embeddings (avoids recomputation)
   * - Attention-based adaptive fusion (replaces static 70/30)
   * - Learned attribute-specific weights
   */
  async generateImageAttributeEmbedding(
    imageBuffer: Buffer,
    attribute: SemanticAttribute
  ): Promise<number[]> {
    // Try cache first, then compute
    return getOrComputeImageEmbedding(imageBuffer, attribute, async () => {
      const imageEmbed = await processImageForEmbedding(imageBuffer);

      if (attribute === "global") {
        return imageEmbed;
      }

      try {
        const prompt = ATTRIBUTE_PROMPTS[attribute as Exclude<SemanticAttribute, "global">];
        const textEmbed = await getTextEmbedding(prompt);

        // Use attention-based adaptive fusion instead of static 70/30
        const { embedding } = fuseEmbeddingsAdaptive(imageEmbed, textEmbed, attribute);
        return embedding;
      } catch {
        return imageEmbed;
      }
    });
  }

  /**
   * Generate embedding for a specific semantic attribute from text description
   * 
   * Uses prompt engineering to guide the text encoder toward the desired attribute
   * Now with caching support
   */
  async generateTextAttributeEmbedding(
    text: string,
    attribute: SemanticAttribute
  ): Promise<number[]> {
    // Build cache key from text + attribute
    const cacheText = attribute === "global" ? text : `${ATTRIBUTE_PROMPTS[attribute as Exclude<SemanticAttribute, "global">]}: ${text}`;
    
    return getOrComputeTextEmbedding(cacheText, attribute, async () => {
      if (attribute === "global") {
        return await getTextEmbedding(text);
      }

      const attributePrompt = ATTRIBUTE_PROMPTS[attribute as Exclude<SemanticAttribute, "global">];
      const augmentedText = `${attributePrompt}: ${text}`;

      return await getTextEmbedding(augmentedText);
    });
  }

  /**
   * Generate all attribute embeddings for an image (for ingestion).
   * Each attribute gets a distinct embedding: image fused with an
   * attribute-specific text prompt so the vectors occupy different
   * regions of CLIP space.
   */
  async generateAllAttributeEmbeddings(
    imageBuffer: Buffer
  ): Promise<Record<SemanticAttribute, number[]>> {
    const attributes: SemanticAttribute[] = [
      "global",
      "color",
      "texture",
      "material",
      "style",
      "pattern",
    ];

    // Sequential ingestion: parallel runs N× image + M× text ONNX sessions and
    // overwhelms CPU / trips circuit breakers. Order keeps global first for cache warmth.
    const embeddings: Partial<Record<SemanticAttribute, number[]>> = {};
    for (const attr of attributes) {
      embeddings[attr] = await this.generateImageAttributeEmbedding(imageBuffer, attr);
    }

    return embeddings as Record<SemanticAttribute, number[]>;
  }

  /**
   * Extract attribute embeddings from parsed product metadata
   * Uses text embeddings generated from structured attributes
   */
  async generateEmbeddingsFromMetadata(metadata: {
    title?: string;
    description?: string;
    color?: string;
    material?: string;
    style?: string;
    pattern?: string;
  }): Promise<Partial<Record<SemanticAttribute, number[]>>> {
    const embeddings: Partial<Record<SemanticAttribute, number[]>> = {};

    // Global from title/description
    if (metadata.title || metadata.description) {
      const text = [metadata.title, metadata.description].filter(Boolean).join(" ");
      embeddings.global = await this.generateTextAttributeEmbedding(text, "global");
    }

    // Per-attribute from structured fields
    if (metadata.color) {
      embeddings.color = await this.generateTextAttributeEmbedding(metadata.color, "color");
    }

    if (metadata.material) {
      embeddings.material = await this.generateTextAttributeEmbedding(metadata.material, "material");
    }

    if (metadata.style) {
      embeddings.style = await this.generateTextAttributeEmbedding(metadata.style, "style");
    }

    if (metadata.pattern) {
      embeddings.pattern = await this.generateTextAttributeEmbedding(metadata.pattern, "pattern");
    }

    return embeddings;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const attributeEmbeddings = new AttributeEmbeddingGenerator();
