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
