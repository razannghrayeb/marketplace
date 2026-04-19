/**
 * Image Module Exports
 * 
 * Image processing, storage, and embeddings.
 */

// CLIP embeddings
export {
  initClip,
  isClipAvailable,
  isTextSearchAvailable,
  preprocessImage,
  getImageEmbedding,
  getImageEmbeddingFromBuffer,
  getTextEmbedding,
  cosineSimilarity,
  getEmbeddingDimension,
} from "./clip";

// Image utilities
export {
  loadImage,
  normalizeImage,
  pHash,
  type ImageData,
} from "./utils";

// Image processor
export {
  processImageForEmbedding,
  processImageForGarmentEmbedding,
  processImageForGarmentEmbeddingWithOptionalBox,
  computeImageSearchGarmentQueryEmbedding,
  computeShopTheLookGarmentEmbeddingFromDetection,
  extractGarmentPaddedRoiFromPreparedImage,
  extractPaddedDetectionCropBuffer,
  GARMENT_DETECTION_PAD_RATIO,
  pickBestYoloDetectionForGarmentEmbedding,
  scalePixelBoxToImageDims,
  type PixelBox,
  type YoloLikeDetection,
  extractGarmentCenterCropBuffer,
  removeBackgroundForQuery,
  validateImage,
  computePHash,
  loadAndNormalize,
  initImageProcessing,
  // Part-level embeddings (Phase 1)
  computeAllPartEmbeddingsFromDetection,
  computeAndGenerateQueryPartEmbeddings,
} from "./processor";

// Part extraction (Phase 1)
export {
  PartType,
  type PartSlot,
  CANONICAL_PART_SLOTS,
  getApplicablePartTypesForLabel,
  isPartApplicableToLabel,
  getPartSlot,
  getAllPartTypes,
  MINIMUM_PART_CROP_DIMENSION,
  PART_TYPES_ARRAY,
  PART_TYPES_COUNT,
  type PartEmbeddingsMap,
  createEmptyPartEmbeddingsMap,
  countValidPartEmbeddings,
  isValidPartEmbeddingsMap,
  type PartEmbeddingFields,
  partEmbeddingsToOsFields,
} from "./partExtraction";

// Phase 2: Enhanced attribute extraction
export {
  extractQueryAttributeEmbeddings,
  generateFallbackGlobalEmbedding,
  getAvailableAttributes,
  getExtractionHealthSummary,
  type QueryAttributeEmbeddings,
  type QueryAttributeExtractionResult,
} from "./queryAttributeExtraction";

// Part cropping (Phase 1)
export {
  extractPartCropBuffer,
  extractAllApplicablePartCrops,
  type PartExtractionSummary,
  summarizePartExtractions,
  computePartRelativeBounds,
  computePartPixelBounds,
  canExtractPart,
  extractValidPartCrops,
  validatePartBuffers,
  type PartExtractionMetrics,
  aggregatePartMetrics,
} from "./partCropping";

export {
  prepareBufferForPrimaryCatalogEmbedding,
  prepareBufferForImageSearchQuery,
  preparePrimaryImageBufferForCatalogEmbedding,
  computeBgComplexityScore,
  catalogBgRemovalThresholdFromEnv,
} from "./embeddingPrep";

// R2 storage
export {
  r2Client,
  generateImageKey,
  uploadImage,
  uploadImageFromUrl,
  getSignedImageUrl,
  imageExists,
  deleteImage,
  getCdnUrl,
} from "./r2";

// BLIP image captioning
export { BlipService, blip } from "./blip";
export {
  inferAudienceFromCaption,
  inferColorFromCaption,
  primaryColorHintFromCaption,
  productDescriptionFromCaption,
  catalogGenderFromCaption,
} from "./captionAttributeInference";
export {
  applyBlipCaptionToMissingProductFields,
  isCatalogFieldBlank,
} from "./blipCatalogBackfill";

// Dual-Model Fashion Detection
export {
  YOLOv8Client,
  getYOLOv8Client,
  filterByCategory,
  filterByConfidence,
  getPrimaryDetection,
  groupByCategory,
  extractOutfitComposition,
  type Detection,
  type DetectionResponse,
  type BoundingBox,
  type StyleInfo,
  type SegmentationMask,
  type HealthResponse,
  type LabelsResponse,
  type DetectOptions,
  type YoloHealthSnapshot,
} from "./yolov8Client";

// Vertex AI Virtual Try-On
export {
  TryOnClient,
  getTryOnClient,
  type TryOnHealthResponse,
  type TryOnResult,
  type TryOnBatchResult,
  type TryOnOptions,
} from "./tryonClient";
