/**
 * Redis Embedding Cache
 * 
 * Caches CLIP embeddings with SHA256 content-addressed keys.
 * Reduces redundant embedding computation for repeated images.
 */

import { createHash } from "crypto";
import { getRedis, isRedisAvailable } from "../redis";
import type { SemanticAttribute } from "../search/multiVectorSearch";

// ============================================================================
// Types
// ============================================================================

export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  entries: number;
}

export interface CachedEmbedding {
  embedding: number[];
  attribute: SemanticAttribute;
  cachedAt: number;
  source: "image" | "text";
}

// ============================================================================
// Configuration
// ============================================================================

const CACHE_CONFIG = {
  ttlSeconds: 86400,          // 24 hours
  keyPrefix: "emb:",
  statsKey: "emb:stats",
  maxEntries: 100000,         // Soft limit for monitoring
};

/** When true, skip all Redis cache ops (e.g. during reindex to avoid Upstash quota) */
function isCacheDisabled(): boolean {
  return process.env.DISABLE_EMBEDDING_CACHE === "1" ||
         process.env.DISABLE_EMBEDDING_CACHE === "true" ||
         process.env.EMBEDDING_CACHE_ENABLED === "0" ||
         process.env.EMBEDDING_CACHE_ENABLED === "false";
}

/** After Upstash hits max DB size, SET fails — stop trying writes for this process (reindex still works). */
let redisWritesSuppressedDueToCapacity = false;
let loggedCapacityNotice = false;

function isQuotaExceededError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /db_capacity_quota exceeded|capacity quota exceeded|ERR maxmemory|OOM command not allowed/i.test(
      msg
    )
  );
}

// In-memory stats
let cacheStats = {
  hits: 0,
  misses: 0,
};

// ============================================================================
// Key Generation
// ============================================================================

/**
 * Generate cache key from image buffer content
 */
export function generateImageCacheKey(
  imageBuffer: Buffer,
  attribute: SemanticAttribute
): string {
  const contentHash = createHash("sha256").update(imageBuffer).digest("hex");
  return `${CACHE_CONFIG.keyPrefix}img:${contentHash.slice(0, 32)}:${attribute}`;
}

/**
 * Generate cache key from text content
 */
export function generateTextCacheKey(
  text: string,
  attribute: SemanticAttribute
): string {
  const contentHash = createHash("sha256").update(text).digest("hex");
  return `${CACHE_CONFIG.keyPrefix}txt:${contentHash.slice(0, 32)}:${attribute}`;
}

// ============================================================================
// Cache Operations
// ============================================================================

/**
 * Get cached embedding for an image
 */
export async function getCachedImageEmbedding(
  imageBuffer: Buffer,
  attribute: SemanticAttribute
): Promise<number[] | null> {
  if (isCacheDisabled() || !isRedisAvailable()) return null;
  
  const redis = getRedis();
  if (!redis) return null;
  
  try {
    const key = generateImageCacheKey(imageBuffer, attribute);
    const cached = (await redis.get(key)) as CachedEmbedding | null;
    
    if (cached) {
      cacheStats.hits++;
      return cached.embedding;
    }
    
    cacheStats.misses++;
    return null;
  } catch (err) {
    console.warn("[EmbeddingCache] Get error:", err);
    return null;
  }
}

/**
 * Cache an image embedding
 */
export async function cacheImageEmbedding(
  imageBuffer: Buffer,
  attribute: SemanticAttribute,
  embedding: number[]
): Promise<void> {
  if (isCacheDisabled() || !isRedisAvailable() || redisWritesSuppressedDueToCapacity) return;

  const redis = getRedis();
  if (!redis) return;

  try {
    const key = generateImageCacheKey(imageBuffer, attribute);
    const value: CachedEmbedding = {
      embedding,
      attribute,
      cachedAt: Date.now(),
      source: "image",
    };

    await redis.setex(key, CACHE_CONFIG.ttlSeconds, value);
  } catch (err) {
    if (isQuotaExceededError(err)) {
      redisWritesSuppressedDueToCapacity = true;
      if (!loggedCapacityNotice) {
        loggedCapacityNotice = true;
        console.warn(
          "[EmbeddingCache] Redis/Upstash storage quota exceeded — cache writes disabled for this process (reindex continues). " +
            "Fix: upgrade plan, flush old keys in Upstash console, or set DISABLE_EMBEDDING_CACHE=1."
        );
      }
      return;
    }
    console.warn("[EmbeddingCache] Set error:", err);
  }
}

/**
 * Get cached text embedding
 */
export async function getCachedTextEmbedding(
  text: string,
  attribute: SemanticAttribute
): Promise<number[] | null> {
  if (isCacheDisabled() || !isRedisAvailable()) return null;
  
  const redis = getRedis();
  if (!redis) return null;
  
  try {
    const key = generateTextCacheKey(text, attribute);
    const cached = (await redis.get(key)) as CachedEmbedding | null;
    
    if (cached) {
      cacheStats.hits++;
      return cached.embedding;
    }
    
    cacheStats.misses++;
    return null;
  } catch (err) {
    console.warn("[EmbeddingCache] Get error:", err);
    return null;
  }
}

/**
 * Cache a text embedding
 */
export async function cacheTextEmbedding(
  text: string,
  attribute: SemanticAttribute,
  embedding: number[]
): Promise<void> {
  if (isCacheDisabled() || !isRedisAvailable() || redisWritesSuppressedDueToCapacity) return;

  const redis = getRedis();
  if (!redis) return;

  try {
    const key = generateTextCacheKey(text, attribute);
    const value: CachedEmbedding = {
      embedding,
      attribute,
      cachedAt: Date.now(),
      source: "text",
    };

    await redis.setex(key, CACHE_CONFIG.ttlSeconds, value);
  } catch (err) {
    if (isQuotaExceededError(err)) {
      redisWritesSuppressedDueToCapacity = true;
      if (!loggedCapacityNotice) {
        loggedCapacityNotice = true;
        console.warn(
          "[EmbeddingCache] Redis/Upstash storage quota exceeded — cache writes disabled for this process (reindex continues). " +
            "Fix: upgrade plan, flush old keys in Upstash console, or set DISABLE_EMBEDDING_CACHE=1."
        );
      }
      return;
    }
    console.warn("[EmbeddingCache] Set error:", err);
  }
}

/**
 * Get or compute an image embedding with caching
 */
export async function getOrComputeImageEmbedding(
  imageBuffer: Buffer,
  attribute: SemanticAttribute,
  computeFn: () => Promise<number[]>
): Promise<number[]> {
  // Try cache first
  const cached = await getCachedImageEmbedding(imageBuffer, attribute);
  if (cached) return cached;
  
  // Compute and cache
  const embedding = await computeFn();
  await cacheImageEmbedding(imageBuffer, attribute, embedding);
  
  return embedding;
}

/**
 * Get or compute a text embedding with caching
 */
export async function getOrComputeTextEmbedding(
  text: string,
  attribute: SemanticAttribute,
  computeFn: () => Promise<number[]>
): Promise<number[]> {
  // Try cache first
  const cached = await getCachedTextEmbedding(text, attribute);
  if (cached) return cached;
  
  // Compute and cache
  const embedding = await computeFn();
  await cacheTextEmbedding(text, attribute, embedding);
  
  return embedding;
}

/**
 * Batch get embeddings (for multi-attribute scenarios)
 */
export async function batchGetImageEmbeddings(
  imageBuffer: Buffer,
  attributes: SemanticAttribute[]
): Promise<Map<SemanticAttribute, number[] | null>> {
  const results = new Map<SemanticAttribute, number[] | null>();
  
  if (isCacheDisabled() || !isRedisAvailable()) {
    for (const attr of attributes) {
      results.set(attr, null);
    }
    return results;
  }
  
  const redis = getRedis();
  if (!redis) {
    for (const attr of attributes) {
      results.set(attr, null);
    }
    return results;
  }
  
  try {
    const keys = attributes.map(attr => generateImageCacheKey(imageBuffer, attr));
    
    // Redis mget for batch retrieval
    const cached = await Promise.all(
      keys.map(key => redis.get(key) as Promise<CachedEmbedding | null>)
    );
    
    for (let i = 0; i < attributes.length; i++) {
      if (cached[i]) {
        results.set(attributes[i], cached[i]!.embedding);
        cacheStats.hits++;
      } else {
        results.set(attributes[i], null);
        cacheStats.misses++;
      }
    }
  } catch (err) {
    console.warn("[EmbeddingCache] Batch get error:", err);
    for (const attr of attributes) {
      results.set(attr, null);
    }
  }
  
  return results;
}

// ============================================================================
// Stats & Monitoring
// ============================================================================

/**
 * Get cache statistics
 */
export function getCacheStats(): CacheStats {
  const total = cacheStats.hits + cacheStats.misses;
  return {
    hits: cacheStats.hits,
    misses: cacheStats.misses,
    hitRate: total > 0 ? cacheStats.hits / total : 0,
    entries: 0, // Would need to scan Redis to get actual count
  };
}

/**
 * Reset cache statistics
 */
export function resetCacheStats(): void {
  cacheStats = { hits: 0, misses: 0 };
}

/**
 * Invalidate all cached embeddings for an image
 */
export async function invalidateImageCache(imageBuffer: Buffer): Promise<void> {
  if (isCacheDisabled() || !isRedisAvailable()) return;
  
  const redis = getRedis();
  if (!redis) return;
  
  const attributes: SemanticAttribute[] = ["global", "color", "texture", "material", "style", "pattern"];
  
  try {
    const keys = attributes.map(attr => generateImageCacheKey(imageBuffer, attr));
    await Promise.all(keys.map(key => redis.del(key)));
  } catch (err) {
    console.warn("[EmbeddingCache] Invalidate error:", err);
  }
}

/**
 * Warm up cache with pre-computed embeddings
 */
export async function warmupCache(
  embeddings: Array<{
    imageBuffer: Buffer;
    attribute: SemanticAttribute;
    embedding: number[];
  }>
): Promise<{ cached: number; errors: number }> {
  let cached = 0;
  let errors = 0;
  
  for (const item of embeddings) {
    try {
      await cacheImageEmbedding(item.imageBuffer, item.attribute, item.embedding);
      cached++;
    } catch {
      errors++;
    }
  }
  
  return { cached, errors };
}
