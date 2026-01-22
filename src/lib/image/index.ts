/**
 * Image Module Exports
 * 
 * Image processing, storage, and embeddings.
 */

// CLIP embeddings
export {
  initClip,
  isClipAvailable,
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
  validateImage,
  computePHash,
  loadAndNormalize,
  initImageProcessing,
} from "./processor";

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

// YOLOv8 Fashion Detection
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
  type HealthResponse,
  type LabelsResponse,
  type DetectOptions,
} from "./yolov8Client";
