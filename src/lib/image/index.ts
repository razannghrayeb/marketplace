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
  extractPaddedDetectionCropBuffer,
  type PixelBox,
  extractGarmentCenterCropBuffer,
  removeBackgroundForQuery,
  validateImage,
  computePHash,
  loadAndNormalize,
  initImageProcessing,
} from "./processor";

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
