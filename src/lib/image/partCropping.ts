/**
 * Part Cropping Implementation
 *
 * Safely extracts canonical parts (sleeves, necklines, heels, handles, etc.)
 * from already-detected garment ROI buffers.
 *
 * KEY INVARIANTS:
 * 1. Input ROI buffer is already cropped to detected garment
 * 2. All coordinates are ROI-relative (normalized 0-1)
 * 3. Extraction gracefully fails (return null) rather than throwing
 * 4. All operations are non-destructive to input buffer
 * 5. Output crops are PNG/JPEG for consistency with main pipeline
 */

import sharp from "sharp";
import {
  PartType,
  getPartSlot,
  getApplicablePartTypesForLabel,
  MINIMUM_PART_CROP_DIMENSION,
  PartEmbeddingsMap,
  createEmptyPartEmbeddingsMap,
} from "./partExtraction";
import type { PixelBox } from "./processor";

// ============================================================================
// Core Part Extraction
// ============================================================================

/**
 * Extract a single part crop from an ROI buffer.
 *
 * @param roiBuf - Buffer containing the detected garment ROI (already cropped)
 * @param partType - Which part to extract (sleeve, neckline, etc.)
 * @returns Buffer containing the extracted part, or null if extraction failed
 *
 * SAFETY:
 * - Returns null (not throw) on any error
 * - Validates output is >= MINIMUM_PART_CROP_DIMENSION in both dimensions
 * - Validates input is valid image first
 */
export async function extractPartCropBuffer(
  roiBuf: Buffer,
  partType: PartType
): Promise<Buffer | null> {
  if (!Buffer.isBuffer(roiBuf) || roiBuf.length === 0) {
    return null;
  }

  try {
    // Get image dimensions
    const metadata = await sharp(roiBuf).metadata();
    if (!metadata.width || !metadata.height) {
      return null;
    }

    const roiWidth = metadata.width;
    const roiHeight = metadata.height;

    // Get part slot definition
    const slot = getPartSlot(partType);
    if (!slot) {
      return null;
    }

    // Convert normalized coordinates to pixel coordinates
    const x1Px = Math.round(slot.relativeBox.x1 * roiWidth);
    const y1Px = Math.round(slot.relativeBox.y1 * roiHeight);
    const x2Px = Math.round(slot.relativeBox.x2 * roiWidth);
    const y2Px = Math.round(slot.relativeBox.y2 * roiHeight);

    // Clamp to ROI bounds (safety)
    const left = Math.max(0, Math.min(roiWidth, x1Px));
    const top = Math.max(0, Math.min(roiHeight, y1Px));
    const right = Math.max(left + 1, Math.min(roiWidth, x2Px));
    const bottom = Math.max(top + 1, Math.min(roiHeight, y2Px));

    const cropWidth = right - left;
    const cropHeight = bottom - top;

    // CRITICAL: Reject crops that are too small
    if (cropWidth < MINIMUM_PART_CROP_DIMENSION || cropHeight < MINIMUM_PART_CROP_DIMENSION) {
      return null;
    }

    // Extract the part crop
    const partBuf = await sharp(roiBuf)
      .extract({
        left,
        top,
        width: cropWidth,
        height: cropHeight,
      })
      .png()
      .toBuffer();

    return partBuf;
  } catch (err) {
    // Graceful: return null instead of throwing
    // (allows other parts to continue extraction)
    return null;
  }
}

/**
 * Extract multiple parts from an ROI buffer in parallel.
 *
 * @param roiBuf - Buffer containing the detected garment ROI
 * @param yoloLabel - YOLO detection label (e.g., 'dress', 'shoe')
 * @returns Map of PartType → Buffer (or null if extraction failed for that part)
 */
export async function extractAllApplicablePartCrops(
  roiBuf: Buffer,
  yoloLabel: string
): Promise<Map<PartType, Buffer | null>> {
  const applicableParts = getApplicablePartTypesForLabel(yoloLabel);
  const results = new Map<PartType, Buffer | null>();

  // Extract all applicable parts in parallel
  const promises = applicableParts.map(async (partType) => {
    const cropBuf = await extractPartCropBuffer(roiBuf, partType);
    return { partType, cropBuf };
  });

  const outcomes = await Promise.allSettled(promises);

  for (const outcome of outcomes) {
    if (outcome.status === "fulfilled") {
      const { partType, cropBuf } = outcome.value;
      results.set(partType, cropBuf);
    } else {
      // Extraction failed for this part type
      console.warn(
        `[part-extraction] failed to extract part (promise rejected):`,
        outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)
      );
    }
  }

  return results;
}

// ============================================================================
// Helper: Validate & Describe Part Extractions
// ============================================================================

/**
 * Summary of part extraction results (for logging/metrics).
 */
export interface PartExtractionSummary {
  totalApplicable: number;
  totalExtracted: number;
  extractedParts: PartType[];
  failedParts: PartType[];
  averageCropSizeBytes: number;
}

/**
 * Analyze part extraction results for logging.
 */
export function summarizePartExtractions(
  parts: Map<PartType, Buffer | null>,
  yoloLabel: string
): PartExtractionSummary {
  const applicable = getApplicablePartTypesForLabel(yoloLabel);
  const extracted: PartType[] = [];
  let totalBytes = 0;
  const failed: PartType[] = [];

  for (const [partType, buf] of parts) {
    if (buf !== null) {
      extracted.push(partType);
      totalBytes += buf.length;
    } else {
      failed.push(partType);
    }
  }

  return {
    totalApplicable: applicable.length,
    totalExtracted: extracted.length,
    extractedParts: extracted,
    failedParts: failed,
    averageCropSizeBytes: extracted.length > 0 ? Math.round(totalBytes / extracted.length) : 0,
  };
}

// ============================================================================
// Helper: ROI Geometry Computation
// ============================================================================

/**
 * Compute the relative bounds for a part within an ROI.
 * This is primarily for debugging/validation; the actual extraction
 * uses PartSlot.relativeBox directly.
 */
export function computePartRelativeBounds(
  partType: PartType
): { x1: number; y1: number; x2: number; y2: number } | null {
  const slot = getPartSlot(partType);
  if (!slot) return null;
  return slot.relativeBox;
}

/**
 * Compute pixel bounds for a part extraction, given ROI pixel dimensions.
 * Useful for validation before actual extraction.
 */
export function computePartPixelBounds(
  roiWidthPx: number,
  roiHeightPx: number,
  partType: PartType
): PixelBox | null {
  const slot = getPartSlot(partType);
  if (!slot) return null;

  const x1 = Math.round(slot.relativeBox.x1 * roiWidthPx);
  const y1 = Math.round(slot.relativeBox.y1 * roiHeightPx);
  const x2 = Math.round(slot.relativeBox.x2 * roiWidthPx);
  const y2 = Math.round(slot.relativeBox.y2 * roiHeightPx);

  // Clamp to bounds
  const left = Math.max(0, Math.min(roiWidthPx, x1));
  const top = Math.max(0, Math.min(roiHeightPx, y1));
  const right = Math.max(left + 1, Math.min(roiWidthPx, x2));
  const bottom = Math.max(top + 1, Math.min(roiHeightPx, y2));

  return {
    x1: left,
    y1: top,
    x2: right,
    y2: bottom,
  };
}

/**
 * Check if a part extraction would yield a valid crop.
 * Useful for pre-flight validation.
 */
export function canExtractPart(
  roiWidthPx: number,
  roiHeightPx: number,
  partType: PartType
): boolean {
  const bounds = computePartPixelBounds(roiWidthPx, roiHeightPx, partType);
  if (!bounds) return false;

  const width = bounds.x2 - bounds.x1;
  const height = bounds.y2 - bounds.y1;

  return (
    width >= MINIMUM_PART_CROP_DIMENSION &&
    height >= MINIMUM_PART_CROP_DIMENSION
  );
}

// ============================================================================
// Helper: Batch Processing (used in indexing pipeline)
// ============================================================================

/**
 * Extract and validate parts from an ROI.
 * Returns only successfully extracted parts.
 */
export async function extractValidPartCrops(
  roiBuf: Buffer,
  yoloLabel: string
): Promise<{
  parts: Map<PartType, Buffer>;
  summary: PartExtractionSummary;
}> {
  const allParts = await extractAllApplicablePartCrops(roiBuf, yoloLabel);
  const validParts = new Map<PartType, Buffer>();

  for (const [partType, buf] of allParts) {
    if (buf !== null) {
      validParts.set(partType, buf);
    }
  }

  const summary = summarizePartExtractions(allParts, yoloLabel);

  return { parts: validParts, summary };
}

// ============================================================================
// Validation Utilities
// ============================================================================

/**
 * Validate that all extracted part buffers are valid PNG/JPEG images.
 * Useful as safety check before passing to embedding pipeline.
 */
export async function validatePartBuffers(
  parts: Map<PartType, Buffer>
): Promise<{
  valid: boolean;
  errors: { partType: PartType; reason: string }[];
}> {
  const errors: { partType: PartType; reason: string }[] = [];

  for (const [partType, buf] of parts) {
    try {
      if (!Buffer.isBuffer(buf) || buf.length === 0) {
        errors.push({ partType, reason: "invalid buffer" });
        continue;
      }

      const metadata = await sharp(buf).metadata();
      if (!metadata.width || !metadata.height) {
        errors.push({ partType, reason: "could not read dimensions" });
        continue;
      }

      if (metadata.width < MINIMUM_PART_CROP_DIMENSION || metadata.height < MINIMUM_PART_CROP_DIMENSION) {
        errors.push({
          partType,
          reason: `dimensions too small (${metadata.width}×${metadata.height})`,
        });
        continue;
      }
    } catch (err) {
      errors.push({
        partType,
        reason: `validation error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ============================================================================
// Benchmarking / Metrics
// ============================================================================

/**
 * Part extraction metrics for batch processing.
 * Used to track successful part extraction rates per batch.
 */
export interface PartExtractionMetrics {
  totalProcessed: number;
  partTypeCounts: {
    [K in PartType]?: { attempted: number; extracted: number };
  };
  averageExtractedPerProduct: number;
  successRate: number; // 0-1
}

/**
 * Helper to aggregate part extraction metrics across multiple products.
 */
export function aggregatePartMetrics(
  summaries: PartExtractionSummary[]
): PartExtractionMetrics {
  const metrics: PartExtractionMetrics = {
    totalProcessed: summaries.length,
    partTypeCounts: {},
    averageExtractedPerProduct: 0,
    successRate: 0,
  };

  let totalExtracted = 0;

  for (const summary of summaries) {
    for (const pt of summary.extractedParts) {
      const current = metrics.partTypeCounts[pt] || { attempted: 0, extracted: 0 };
      current.extracted++;
      current.attempted++;
      metrics.partTypeCounts[pt] = current;
    }
    for (const pt of summary.failedParts) {
      const current = metrics.partTypeCounts[pt] || { attempted: 0, extracted: 0 };
      current.attempted++;
      metrics.partTypeCounts[pt] = current;
    }
    totalExtracted += summary.totalExtracted;
  }

  metrics.averageExtractedPerProduct =
    summaries.length > 0 ? totalExtracted / summaries.length : 0;
  metrics.successRate = summaries.length > 0 ? totalExtracted / (summaries.length * 9) : 0; // 9 = max possible parts

  return metrics;
}
