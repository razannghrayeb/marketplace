/**
 * Attribute-Specific Embedding Generation
 * 
 * Generates specialized embeddings for different semantic attributes
 * using prompt engineering and CLIP text/image encoding.
 */

import { getTextEmbedding } from "../image/clip.js";
import { processImageForEmbedding } from "../image/processor.js";
import type { SemanticAttribute } from "./multiVectorSearch.js";

// ============================================================================
// Attribute Prompt Templates
// ============================================================================

/**
 * Attribute-focused prompts to guide CLIP text encoder
 * These prompts prime the embedding space for specific semantic aspects
 */
const ATTRIBUTE_PROMPTS: Record<Exclude<SemanticAttribute, "global">, string> = {
  color: "The dominant colors and color palette of this fashion item, including primary color, secondary colors, and overall color scheme",
  texture: "The surface texture, fabric feel, and material texture of this clothing item - smooth, rough, soft, coarse, ribbed, or textured",
  material: "The fabric material and composition - cotton, silk, wool, leather, denim, polyester, linen, or other material type",
  style: "The fashion style and aesthetic - casual, formal, vintage, modern, bohemian, sporty, elegant, streetwear, or other style category",
  pattern: "The pattern or print on the garment - solid, striped, floral, geometric, polka dot, plaid, checkered, or other pattern type",
};

// ============================================================================
// Attribute Embedding Generator
// ============================================================================

export class AttributeEmbeddingGenerator {
  /**
   * Generate embedding for a specific semantic attribute from an image
   * 
   * Strategy: Use image embedding directly (CLIP is trained to understand all visual aspects)
   * The attribute specificity comes from the multi-vector search weights, not from
   * different embedding models.
   */
  async generateImageAttributeEmbedding(
    imageBuffer: Buffer,
    attribute: SemanticAttribute
  ): Promise<number[]> {
    if (attribute === "global") {
      // Global embedding: standard image embedding
      return await processImageForEmbedding(imageBuffer);
    }

    // For per-attribute embeddings, we use the same image embedding
    // The semantic separation happens during multi-vector search via weighted combination
    // Future enhancement: Could fine-tune separate models per attribute or use attention masks
    return await processImageForEmbedding(imageBuffer);
  }

  /**
   * Generate embedding for a specific semantic attribute from text description
   * 
   * Uses prompt engineering to guide the text encoder toward the desired attribute
   */
  async generateTextAttributeEmbedding(
    text: string,
    attribute: SemanticAttribute
  ): Promise<number[]> {
    if (attribute === "global") {
      // Global: use text as-is
      return await getTextEmbedding(text);
    }

    // Combine user text with attribute-specific prompt
    const attributePrompt = ATTRIBUTE_PROMPTS[attribute as Exclude<SemanticAttribute, "global">];
    const augmentedText = `${attributePrompt}: ${text}`;

    return await getTextEmbedding(augmentedText);
  }

  /**
   * Generate all attribute embeddings for an image (for ingestion)
   * Returns a map of attribute → embedding vector
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

    // For now, all use the same image embedding (separation via search weights)
    // In production, you'd extract per-attribute embeddings using:
    // - Attention-based cropping/masking
    // - Separate fine-tuned models per attribute
    // - Multi-task learning with attribute-specific heads
    const globalEmbedding = await processImageForEmbedding(imageBuffer);

    const embeddings: Partial<Record<SemanticAttribute, number[]>> = {};
    for (const attr of attributes) {
      embeddings[attr] = globalEmbedding; // Shared for now
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
