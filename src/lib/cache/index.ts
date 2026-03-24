/**
 * Cache Library Exports
 */

export {
  getCachedImageEmbedding,
  cacheImageEmbedding,
  getCachedTextEmbedding,
  cacheTextEmbedding,
  getOrComputeImageEmbedding,
  getOrComputeTextEmbedding,
  batchGetImageEmbeddings,
  getCacheStats,
  resetCacheStats,
  invalidateImageCache,
  warmupCache,
  generateImageCacheKey,
  generateTextCacheKey,
} from "./embeddingCache";
