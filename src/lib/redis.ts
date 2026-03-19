/**
 * Upstash Redis REST client
 *
 * Use getRedis() and guard every call: if (redis) { await redis.set(...) }
 * Do not assume Redis always exists.
 */
type RedisClient = {
  [key: string]: (...args: any[]) => any;
};

let redis: RedisClient | null = null;

export function getRedis(): RedisClient | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    return null;
  }

  if (!redis) {
    try {
      // Lazy-load to keep builds resilient when the package isn't present.
      // Runtime still requires @upstash/redis when Redis is enabled.
      const upstash = require("@upstash/redis");
      const RedisCtor = upstash.Redis;
      redis = new RedisCtor({ url, token });
    } catch {
      return null;
    }
  }

  return redis;
}

export function isRedisAvailable(): boolean {
  return !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}
