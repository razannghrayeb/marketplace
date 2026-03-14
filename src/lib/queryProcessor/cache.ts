/**
 * Query Cache
 * 
 * Caches query corrections, rewrites, and embeddings with versioning.
 * Uses in-memory LRU cache with optional Redis backend for production.
 */

import crypto from "crypto";
import { CacheEntry, QueryCacheStats, ProcessedQuery, QueryAST } from "./types";

// ============================================================================
// Configuration
// ============================================================================

const CACHE_VERSION = "1.0.0";
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;  // 24 hours
const MAX_CACHE_SIZE = 10000;

// ============================================================================
// In-Memory LRU Cache
// ============================================================================

class LRUCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private maxSize: number;
  private hits = 0;
  private misses = 0;
  
  constructor(maxSize: number = MAX_CACHE_SIZE) {
    this.maxSize = maxSize;
  }
  
  /**
   * Generate cache key from query
   */
  static hashQuery(query: string): string {
    return crypto
      .createHash("sha256")
      .update(query.toLowerCase().trim())
      .digest("hex")
      .slice(0, 16);
  }
  
  /**
   * Get value from cache
   */
  get(key: string): T | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.misses++;
      return null;
    }
    
    // Check expiration
    if (entry.expiresAt < Date.now()) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }
    
    // Check version
    if (entry.version !== CACHE_VERSION) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }
    
    // Move to end (most recently used)
    this.cache.delete(key);
    entry.hitCount++;
    this.cache.set(key, entry);
    this.hits++;
    
    return entry.value;
  }
  
  /**
   * Set value in cache
   */
  set(key: string, value: T, ttlMs: number = DEFAULT_TTL_MS): void {
    // Evict oldest entries if at capacity
    while (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    
    this.cache.set(key, {
      value,
      version: CACHE_VERSION,
      createdAt: Date.now(),
      expiresAt: Date.now() + ttlMs,
      hitCount: 0,
    });
  }
  
  /**
   * Check if key exists
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (entry.expiresAt < Date.now()) return false;
    if (entry.version !== CACHE_VERSION) return false;
    return true;
  }
  
  /**
   * Delete key from cache
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }
  
  /**
   * Clear all entries
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }
  
  /**
   * Get cache statistics
   */
  getStats(): QueryCacheStats {
    const totalRequests = this.hits + this.misses;
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: totalRequests > 0 ? this.hits / totalRequests : 0,
      version: CACHE_VERSION,
    };
  }
  
  /**
   * Get all keys
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }
}

// ============================================================================
// Specialized Caches
// ============================================================================

// Cache for processed queries (corrections + rewrites)
const queryCache = new LRUCache<ProcessedQuery>(5000);

// Cache for query embeddings
const embeddingCache = new LRUCache<number[]>(5000);

// Cache for title → extracted attributes
const attributeCache = new LRUCache<Record<string, string>>(10000);

// ============================================================================
// Query Cache Functions
// ============================================================================

/**
 * Get cached processed query
 */
export function getCachedQuery(query: string): ProcessedQuery | null {
  const key = LRUCache.hashQuery(query);
  const cached = queryCache.get(key);
  
  if (cached) {
    // Mark as cache hit
    return { ...cached, cacheHit: true };
  }
  
  return null;
}

/**
 * Cache processed query
 */
export function cacheQuery(query: string, processed: ProcessedQuery): void {
  const key = LRUCache.hashQuery(query);
  queryCache.set(key, processed);
}

/**
 * Check if query is cached
 */
export function isQueryCached(query: string): boolean {
  const key = LRUCache.hashQuery(query);
  return queryCache.has(key);
}

// ============================================================================
// Embedding Cache Functions
// ============================================================================

/**
 * Get cached embedding for query
 */
export function getCachedEmbedding(query: string): number[] | null {
  const key = LRUCache.hashQuery(query);
  return embeddingCache.get(key);
}

/**
 * Cache embedding for query
 */
export function cacheEmbedding(query: string, embedding: number[]): void {
  const key = LRUCache.hashQuery(query);
  embeddingCache.set(key, embedding);
}

// ============================================================================
// Attribute Cache Functions
// ============================================================================

/**
 * Get cached attributes for title
 */
export function getCachedAttributes(title: string): Record<string, string> | null {
  const key = LRUCache.hashQuery(title);
  return attributeCache.get(key);
}

/**
 * Cache attributes for title
 */
export function cacheAttributes(title: string, attributes: Record<string, string>): void {
  const key = LRUCache.hashQuery(title);
  attributeCache.set(key, attributes);
}

// ============================================================================
// Cache Management
// ============================================================================

/**
 * Get all cache statistics
 */
export function getAllCacheStats(): {
  query: QueryCacheStats;
  embedding: QueryCacheStats;
  attribute: QueryCacheStats;
} {
  return {
    query: queryCache.getStats(),
    embedding: embeddingCache.getStats(),
    attribute: attributeCache.getStats(),
  };
}

/**
 * Clear all caches
 */
export function clearAllCaches(): void {
  queryCache.clear();
  embeddingCache.clear();
  attributeCache.clear();
  console.log("All query caches cleared");
}

/**
 * Clear only query cache (when dictionaries are updated)
 */
export function clearQueryCache(): void {
  queryCache.clear();
  console.log("Query cache cleared");
}

/**
 * Get cache version
 */
export function getCacheVersion(): string {
  return CACHE_VERSION;
}

// ============================================================================
// Warm-up Functions
// ============================================================================

/**
 * Pre-warm cache with common queries
 */
export function warmUpCache(queries: string[], processQuery: (q: string) => ProcessedQuery): void {
  console.log(`Warming up cache with ${queries.length} queries...`);
  
  let warmed = 0;
  for (const query of queries) {
    if (!isQueryCached(query)) {
      try {
        const processed = processQuery(query);
        cacheQuery(query, processed);
        warmed++;
      } catch (err) {
        // Skip failed queries
      }
    }
  }
  
  console.log(`Warmed up ${warmed} queries`);
}

// ============================================================================
// QueryAST Cache Functions (NEW)
// ============================================================================

const queryASTCache = new LRUCache<QueryAST>();

/**
 * Cache QueryAST result
 */
export function cacheQueryAST(query: string, result: QueryAST): void {
  const key = LRUCache.hashQuery(query);
  queryASTCache.set(key, result);
}

/**
 * Get cached QueryAST result
 */
export function getCachedQueryAST(query: string): QueryAST | null {
  const key = LRUCache.hashQuery(query);
  return queryASTCache.get(key);
}

/**
 * Check if QueryAST is cached
 */
export function isQueryASTCached(query: string): boolean {
  const key = LRUCache.hashQuery(query);
  return queryASTCache.has(key);
}

/**
 * Clear QueryAST cache
 */
export function clearQueryASTCache(): void {
  queryASTCache.clear();
}

/**
 * Get QueryAST cache stats
 */
export function getQueryASTCacheStats(): QueryCacheStats {
  return queryASTCache.getStats();
}

// ============================================================================
// Export Cache Classes (for testing)
// ============================================================================

export { LRUCache };
