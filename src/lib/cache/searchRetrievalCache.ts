/**
 * Redis layers for the unified search platform:
 * - image hash + confidence → detection payload (shop-the-look / analyze)
 * - image hash + attribute → embeddings (delegates to embeddingCache via embeddingEngine)
 * - composite query signature → top product ids + scores (short TTL; hydrate fresh from PG on hit)
 */

import { createHash } from "crypto";
import { getRedis, isRedisAvailable } from "../redis";

const PREFIX_DET = "srch:det:v1:";
const PREFIX_RES = "srch:res:v1:";

function isSearchRetrievalCacheDisabled(): boolean {
  const v = String(process.env.DISABLE_SEARCH_RETRIEVAL_CACHE ?? "").toLowerCase();
  return v === "1" || v === "true";
}

function isQuotaExceededError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /db_capacity_quota exceeded|capacity quota exceeded|ERR maxmemory|OOM command not allowed/i.test(
    msg,
  );
}

let redisWritesSuppressed = false;
let loggedCapacity = false;

export function hashBuffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** Round confidence so cache keys stay stable across trivial float differences */
function confidenceCacheKey(confidence: number): string {
  return String(Math.round(Math.max(0, Math.min(1, confidence)) * 1000) / 1000);
}

export interface CachedDetectionPayload {
  success?: boolean;
  detections: unknown[];
  count: number;
  summary?: Record<string, number>;
  image_size?: { width: number; height: number };
}

export async function getCachedDetection(
  imageBuffer: Buffer,
  confidence: number,
): Promise<CachedDetectionPayload | null> {
  if (isSearchRetrievalCacheDisabled() || !isRedisAvailable()) return null;
  const redis = getRedis();
  if (!redis) return null;
  const key = `${PREFIX_DET}${hashBuffer(imageBuffer)}:${confidenceCacheKey(confidence)}`;
  try {
    const raw = await redis.get(key);
    if (raw == null) return null;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || !Array.isArray(parsed.detections)) return null;
    return parsed as CachedDetectionPayload;
  } catch {
    return null;
  }
}

export async function setCachedDetection(
  imageBuffer: Buffer,
  confidence: number,
  payload: CachedDetectionPayload,
  ttlSec?: number,
): Promise<void> {
  if (isSearchRetrievalCacheDisabled() || !isRedisAvailable() || redisWritesSuppressed) return;
  const redis = getRedis();
  if (!redis) return;
  const ttl =
    ttlSec ??
    Math.max(60, Number(process.env.SEARCH_DETECTION_CACHE_TTL_SEC ?? 86400) || 86400);
  const key = `${PREFIX_DET}${hashBuffer(imageBuffer)}:${confidenceCacheKey(confidence)}`;
  try {
    await redis.setex(key, ttl, JSON.stringify(payload));
  } catch (err) {
    if (isQuotaExceededError(err)) {
      redisWritesSuppressed = true;
      if (!loggedCapacity) {
        loggedCapacity = true;
        console.warn(
          "[searchRetrievalCache] Redis quota exceeded — detection cache writes disabled for this process.",
        );
      }
      return;
    }
    console.warn("[searchRetrievalCache] setCachedDetection:", err);
  }
}

export interface CachedSearchHit {
  productId: string;
  score: number;
}

export interface CachedSearchHitsPayload {
  hits: CachedSearchHit[];
  storedAt: number;
}

export function buildCompositeSearchSignature(parts: {
  mode: string;
  imageHashes: string[];
  prompt: string;
  limit: number;
  attributeWeights?: Record<string, number>;
  /** Stable fingerprint of rerank options so cache entries stay consistent. */
  rerankFingerprint?: string;
  /** Distinguish explicit-weights multi-vector from Gemini path. */
  explicitWeightsOnly?: boolean;
}): string {
  const normalized = {
    m: parts.mode,
    h: parts.imageHashes,
    p: parts.prompt.trim(),
    l: parts.limit,
    w: parts.attributeWeights && Object.keys(parts.attributeWeights).length
      ? parts.attributeWeights
      : undefined,
    r: parts.rerankFingerprint,
    x: parts.explicitWeightsOnly === true ? 1 : 0,
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

export async function getCachedSearchHits(signature: string): Promise<CachedSearchHitsPayload | null> {
  if (isSearchRetrievalCacheDisabled() || !isRedisAvailable()) return null;
  const redis = getRedis();
  if (!redis) return null;
  const key = `${PREFIX_RES}${signature}`;
  try {
    const raw = await redis.get(key);
    if (raw == null) return null;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed?.hits || !Array.isArray(parsed.hits)) return null;
    return parsed as CachedSearchHitsPayload;
  } catch {
    return null;
  }
}

export async function setCachedSearchHits(
  signature: string,
  hits: CachedSearchHit[],
  ttlSec?: number,
): Promise<void> {
  if (isSearchRetrievalCacheDisabled() || !isRedisAvailable() || redisWritesSuppressed) return;
  const redis = getRedis();
  if (!redis) return;
  const ttl =
    ttlSec ??
    Math.max(30, Number(process.env.SEARCH_RESULT_CACHE_TTL_SEC ?? 600) || 600);
  const key = `${PREFIX_RES}${signature}`;
  const payload: CachedSearchHitsPayload = { hits, storedAt: Date.now() };
  try {
    await redis.setex(key, ttl, JSON.stringify(payload));
  } catch (err) {
    if (isQuotaExceededError(err)) {
      redisWritesSuppressed = true;
      if (!loggedCapacity) {
        loggedCapacity = true;
        console.warn(
          "[searchRetrievalCache] Redis quota exceeded — result cache writes disabled for this process.",
        );
      }
      return;
    }
    console.warn("[searchRetrievalCache] setCachedSearchHits:", err);
  }
}
