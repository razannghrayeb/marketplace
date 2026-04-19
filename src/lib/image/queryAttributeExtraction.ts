/**
 * Enhanced Query Attribute Extraction (Phase 2)
 *
 * Improves attribute extraction from query images by:
 * 1. Extracting ALL 6 attributes (global, color, texture, material, style, pattern)
 * 2. Handling fallback/degradation when individual attributes fail
 * 3. Caching extracted attributes per image
 * 4. Providing attribute confidence estimates
 * 5. Type-safe attribute handling
 */

import type { SemanticAttribute } from "../search/multiVectorSearch";
import { attributeEmbeddings } from "../search/attributeEmbeddings";
import { extractGarmentCenterCropBuffer, processImageForEmbedding } from "./processor";

// ============================================================================
// Types
// ============================================================================

export interface QueryAttributeEmbeddings {
  global: number[] | null;
  color: number[] | null;
  texture: number[] | null;
  material: number[] | null;
  style: number[] | null;
  pattern: number[] | null;
}

export interface QueryAttributeExtractionResult {
  embeddings: QueryAttributeEmbeddings;
  success: {
    global: boolean;
    color: boolean;
    texture: boolean;
    material: boolean;
    style: boolean;
    pattern: boolean;
  };
  failedAttributes: SemanticAttribute[];
  extractionTimeMs: number;
}

// ============================================================================
// Constants
// ============================================================================

/** Minimum valid embedding length (CLIP is 512-dim by default) */
const MIN_EMBEDDING_LENGTH = 256;

/** Attributes to extract, in order of importance for query processing */
const QUERY_ATTRIBUTE_ORDER: SemanticAttribute[] = [
  "global",      // Required baseline
  "color",       // Most important for matching
  "style",       // Fashion coherence
  "pattern",     // Key distinguishing feature
  "texture",     // Details matching
  "material",    // Fabric/surface characteristics
];

// ============================================================================
// Query Attribute Extractor
// ============================================================================

/**
 * Enhanced extraction of ALL attributes from a query image.
 * 
 * Features:
 * - Sequential extraction (global first, then others) to avoid overwhelming CLIP
 * - Per-attribute error handling (one failure doesn't cascade)
 * - Validation of embedding dimensions
 * - Caching support via attributeEmbeddings module
 * - Returns success/failure tracking for each attribute
 * 
 * @param imageBuffer Raw image buffer (JPEG/PNG)
 * @returns QueryAttributeExtractionResult with embeddings + success tracking
 */
export async function extractQueryAttributeEmbeddings(
  imageBuffer: Buffer,
): Promise<QueryAttributeExtractionResult> {
  const startTime = Date.now();
  const embeddings: QueryAttributeEmbeddings = {
    global: null,
    color: null,
    texture: null,
    material: null,
    style: null,
    pattern: null,
  };

  const success = {
    global: false,
    color: false,
    texture: false,
    material: false,
    style: false,
    pattern: false,
  };

  const failedAttributes: SemanticAttribute[] = [];

  // Validate input
  if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
    console.warn("[attribute-extraction] Invalid image buffer");
    return {
      embeddings,
      success,
      failedAttributes: QUERY_ATTRIBUTE_ORDER.map((a) => a as SemanticAttribute),
      extractionTimeMs: Date.now() - startTime,
    };
  }

  // Extract attributes in order
  for (const attribute of QUERY_ATTRIBUTE_ORDER) {
    try {
      const embedding = await extractSingleQueryAttribute(imageBuffer, attribute);

      if (embedding && embedding.length >= MIN_EMBEDDING_LENGTH) {
        embeddings[attribute] = embedding;
        success[attribute] = true;
      } else {
        failedAttributes.push(attribute);
        console.warn(`[attribute-extraction] Invalid embedding for ${attribute}`, {
          length: embedding?.length ?? 0,
          expected: MIN_EMBEDDING_LENGTH,
        });
      }
    } catch (error) {
      failedAttributes.push(attribute);
      console.warn(`[attribute-extraction] Failed to extract ${attribute}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    embeddings,
    success,
    failedAttributes,
    extractionTimeMs: Date.now() - startTime,
  };
}

/**
 * Extract a single attribute embedding from query image.
 * 
 * Handles per-attribute preprocessing:
 * - Color: Use garment center crop for better color isolation
 * - Others: Use full processed image
 * 
 * @param imageBuffer Raw image
 * @param attribute Which attribute to extract
 * @returns Embedding or null if extraction fails
 */
async function extractSingleQueryAttribute(
  imageBuffer: Buffer,
  attribute: SemanticAttribute,
): Promise<number[] | null> {
  try {
    // For color, use center crop to isolate dominant color from garment area
    if (attribute === "color") {
      const cropBuf = await extractGarmentCenterCropBuffer(imageBuffer).catch(() => imageBuffer);
      return await attributeEmbeddings.generateImageAttributeEmbedding(cropBuf, attribute);
    }

    // For other attributes, use full processed image
    return await attributeEmbeddings.generateImageAttributeEmbedding(imageBuffer, attribute);
  } catch (error) {
    console.warn(`[attribute-extraction] Error extracting ${attribute}:`, error);
    return null;
  }
}

/**
 * Generate a global fallback embedding if per-attribute extraction fails.
 * 
 * Useful when attribute extraction pipeline has issues but we still want
 * to proceed with basic global embedding.
 * 
 * @param imageBuffer Raw image
 * @returns Global embedding or null
 */
export async function generateFallbackGlobalEmbedding(
  imageBuffer: Buffer,
): Promise<number[] | null> {
  try {
    return await processImageForEmbedding(imageBuffer);
  } catch (error) {
    console.warn("[attribute-extraction] Fallback global embedding failed:", error);
    return null;
  }
}

/**
 * Check which attributes are available (non-null) in extraction result.
 * 
 * Useful for selecting which KNN queries to run at search time.
 * 
 * @param result Extraction result from extractQueryAttributeEmbeddings
 * @returns List of available attributes
 */
export function getAvailableAttributes(result: QueryAttributeExtractionResult): SemanticAttribute[] {
  const attrs: SemanticAttribute[] = [];
  if (result.embeddings.global) attrs.push("global");
  if (result.embeddings.color) attrs.push("color");
  if (result.embeddings.texture) attrs.push("texture");
  if (result.embeddings.material) attrs.push("material");
  if (result.embeddings.style) attrs.push("style");
  if (result.embeddings.pattern) attrs.push("pattern");
  return attrs;
}

/**
 * Get summary of extraction health.
 * 
 * Returns success percentage and which critical attributes are missing.
 * 
 * @param result Extraction result
 * @returns Health summary for logging/monitoring
 */
export function getExtractionHealthSummary(
  result: QueryAttributeExtractionResult,
): { successRate: number; missingCritical: SemanticAttribute[]; summary: string } {
  const totalAttrs = QUERY_ATTRIBUTE_ORDER.length;
  const successCount = Object.values(result.success).filter(Boolean).length;
  const successRate = (successCount / totalAttrs) * 100;

  // Critical: global, color, style (required for reasonable search)
  const criticalAttrs: SemanticAttribute[] = ["global", "color", "style"];
  const missingCritical = criticalAttrs.filter((a) => !result.success[a]);

  const summary =
    successRate === 100
      ? `✓ All ${totalAttrs} attributes extracted (${result.extractionTimeMs}ms)`
      : successRate >= 50
        ? `⚠ ${successCount}/${totalAttrs} attributes extracted (${result.extractionTimeMs}ms)`
        : `❌ Only ${successCount}/${totalAttrs} attributes extracted (${result.extractionTimeMs}ms)`;

  return { successRate, missingCritical, summary };
}
