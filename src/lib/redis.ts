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
let requestLimitSuppressedUntil = 0;
let requestLimitNoticeLogged = false;

function getRequestLimitCooldownMs(): number {
  const raw = Number(process.env.UPSTASH_REQUEST_LIMIT_SUPPRESS_MS ?? 15 * 60 * 1000);
  if (!Number.isFinite(raw)) return 15 * 60 * 1000;
  return Math.max(1000, Math.floor(raw));
}

function isRequestLimitExceededError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /max requests limit exceeded/i.test(msg);
}

export function isRedisSuppressedByRequestLimit(): boolean {
  return requestLimitSuppressedUntil > Date.now();
}

/**
 * Registers Redis failures and enables temporary fail-open mode for request-limit errors.
 * Returns true when the error was recognized and handled.
 */
export function registerRedisFailure(err: unknown, operation: string): boolean {
  if (!isRequestLimitExceededError(err)) return false;

  const cooldownMs = getRequestLimitCooldownMs();
  requestLimitSuppressedUntil = Date.now() + cooldownMs;

  if (!requestLimitNoticeLogged) {
    requestLimitNoticeLogged = true;
    const cooldownSec = Math.round(cooldownMs / 1000);
    console.warn(
      `[redis] Upstash request quota exhausted during ${operation}. ` +
        `Suppressing Redis calls for ${cooldownSec}s (UPSTASH_REQUEST_LIMIT_SUPPRESS_MS).`,
    );
  }

  return true;
}

export function getRedis(): RedisClient | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token || isRedisSuppressedByRequestLimit()) {
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
  return !!(
    process.env.UPSTASH_REDIS_REST_URL &&
    process.env.UPSTASH_REDIS_REST_TOKEN &&
    !isRedisSuppressedByRequestLimit()
  );
}
