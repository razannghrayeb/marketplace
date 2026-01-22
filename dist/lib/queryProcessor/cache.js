"use strict";
/**
 * Query Cache
 *
 * Caches query corrections, rewrites, and embeddings with versioning.
 * Uses in-memory LRU cache with optional Redis backend for production.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LRUCache = void 0;
exports.getCachedQuery = getCachedQuery;
exports.cacheQuery = cacheQuery;
exports.isQueryCached = isQueryCached;
exports.getCachedEmbedding = getCachedEmbedding;
exports.cacheEmbedding = cacheEmbedding;
exports.getCachedAttributes = getCachedAttributes;
exports.cacheAttributes = cacheAttributes;
exports.getAllCacheStats = getAllCacheStats;
exports.clearAllCaches = clearAllCaches;
exports.clearQueryCache = clearQueryCache;
exports.getCacheVersion = getCacheVersion;
exports.warmUpCache = warmUpCache;
const crypto_1 = __importDefault(require("crypto"));
// ============================================================================
// Configuration
// ============================================================================
const CACHE_VERSION = "1.0.0";
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_CACHE_SIZE = 10000;
// ============================================================================
// In-Memory LRU Cache
// ============================================================================
class LRUCache {
    cache = new Map();
    maxSize;
    hits = 0;
    misses = 0;
    constructor(maxSize = MAX_CACHE_SIZE) {
        this.maxSize = maxSize;
    }
    /**
     * Generate cache key from query
     */
    static hashQuery(query) {
        return crypto_1.default
            .createHash("sha256")
            .update(query.toLowerCase().trim())
            .digest("hex")
            .slice(0, 16);
    }
    /**
     * Get value from cache
     */
    get(key) {
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
    set(key, value, ttlMs = DEFAULT_TTL_MS) {
        // Evict oldest entries if at capacity
        while (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey)
                this.cache.delete(firstKey);
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
    has(key) {
        const entry = this.cache.get(key);
        if (!entry)
            return false;
        if (entry.expiresAt < Date.now())
            return false;
        if (entry.version !== CACHE_VERSION)
            return false;
        return true;
    }
    /**
     * Delete key from cache
     */
    delete(key) {
        return this.cache.delete(key);
    }
    /**
     * Clear all entries
     */
    clear() {
        this.cache.clear();
        this.hits = 0;
        this.misses = 0;
    }
    /**
     * Get cache statistics
     */
    getStats() {
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
    keys() {
        return Array.from(this.cache.keys());
    }
}
exports.LRUCache = LRUCache;
// ============================================================================
// Specialized Caches
// ============================================================================
// Cache for processed queries (corrections + rewrites)
const queryCache = new LRUCache(5000);
// Cache for query embeddings
const embeddingCache = new LRUCache(5000);
// Cache for title → extracted attributes
const attributeCache = new LRUCache(10000);
// ============================================================================
// Query Cache Functions
// ============================================================================
/**
 * Get cached processed query
 */
function getCachedQuery(query) {
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
function cacheQuery(query, processed) {
    const key = LRUCache.hashQuery(query);
    queryCache.set(key, processed);
}
/**
 * Check if query is cached
 */
function isQueryCached(query) {
    const key = LRUCache.hashQuery(query);
    return queryCache.has(key);
}
// ============================================================================
// Embedding Cache Functions
// ============================================================================
/**
 * Get cached embedding for query
 */
function getCachedEmbedding(query) {
    const key = LRUCache.hashQuery(query);
    return embeddingCache.get(key);
}
/**
 * Cache embedding for query
 */
function cacheEmbedding(query, embedding) {
    const key = LRUCache.hashQuery(query);
    embeddingCache.set(key, embedding);
}
// ============================================================================
// Attribute Cache Functions
// ============================================================================
/**
 * Get cached attributes for title
 */
function getCachedAttributes(title) {
    const key = LRUCache.hashQuery(title);
    return attributeCache.get(key);
}
/**
 * Cache attributes for title
 */
function cacheAttributes(title, attributes) {
    const key = LRUCache.hashQuery(title);
    attributeCache.set(key, attributes);
}
// ============================================================================
// Cache Management
// ============================================================================
/**
 * Get all cache statistics
 */
function getAllCacheStats() {
    return {
        query: queryCache.getStats(),
        embedding: embeddingCache.getStats(),
        attribute: attributeCache.getStats(),
    };
}
/**
 * Clear all caches
 */
function clearAllCaches() {
    queryCache.clear();
    embeddingCache.clear();
    attributeCache.clear();
    console.log("All query caches cleared");
}
/**
 * Clear only query cache (when dictionaries are updated)
 */
function clearQueryCache() {
    queryCache.clear();
    console.log("Query cache cleared");
}
/**
 * Get cache version
 */
function getCacheVersion() {
    return CACHE_VERSION;
}
// ============================================================================
// Warm-up Functions
// ============================================================================
/**
 * Pre-warm cache with common queries
 */
function warmUpCache(queries, processQuery) {
    console.log(`Warming up cache with ${queries.length} queries...`);
    let warmed = 0;
    for (const query of queries) {
        if (!isQueryCached(query)) {
            try {
                const processed = processQuery(query);
                cacheQuery(query, processed);
                warmed++;
            }
            catch (err) {
                // Skip failed queries
            }
        }
    }
    console.log(`Warmed up ${warmed} queries`);
}
