/**
 * Redis queue operations using Upstash REST client
 *
 * All calls are guarded - if Redis is unavailable, returns safe defaults.
 * Do not assume Redis always exists.
 */
import { getRedis } from "../redis";

export interface UpstashGetResult {
  result?: string | null;
}

export async function upstashGet(key: string): Promise<UpstashGetResult> {
  const redis = getRedis();
  if (!redis) {
    return { result: null };
  }
  try {
    const value = await redis.get(key);
    return { result: value != null ? String(value) : null };
  } catch (err) {
    console.warn("[redis] upstashGet failed:", (err as Error).message);
    return { result: null };
  }
}

export async function upstashSet(key: string, value: string): Promise<void> {
  const redis = getRedis();
  if (!redis) {
    return;
  }
  try {
    await redis.set(key, value);
  } catch (err) {
    console.warn("[redis] upstashSet failed:", (err as Error).message);
  }
}
