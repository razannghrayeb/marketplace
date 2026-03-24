/**
 * Cross-process QueryAST cache (Upstash Redis). Complements in-memory LRU in cache.ts.
 * Opt-in: SEARCH_QUERY_AST_REDIS=1 plus UPSTASH_* credentials.
 */

import type { QueryAST } from "./types";
import { getRedis, isRedisAvailable } from "../redis";
import { LRUCache } from "./cache";

const REDIS_QAST_SCHEMA = "1";

function redisEnabledByEnv(): boolean {
  return /^(1|true)$/i.test(String(process.env.SEARCH_QUERY_AST_REDIS ?? "").trim());
}

export function isQueryAstRedisCacheEnabled(): boolean {
  return redisEnabledByEnv() && isRedisAvailable();
}

function redisKey(
  raw: string,
  pipelineOpts: { useLLM: boolean; useMLIntent: boolean },
  localeKey: string,
): string {
  const h = LRUCache.hashQuery(
    `${raw.trim().toLowerCase()}\x00${pipelineOpts.useLLM}:${pipelineOpts.useMLIntent}`,
  );
  return `search:qast:v${REDIS_QAST_SCHEMA}:${localeKey}:${h}`;
}

function stripEmbedding(ast: QueryAST): QueryAST {
  if (ast.embedding === undefined) return ast;
  return { ...ast, embedding: undefined };
}

export async function getQueryAstFromRedis(
  raw: string,
  pipelineOpts: { useLLM: boolean; useMLIntent: boolean },
  localeKey: string,
): Promise<QueryAST | null> {
  if (!isQueryAstRedisCacheEnabled()) return null;
  const redis = getRedis();
  if (!redis) return null;
  const key = redisKey(raw, pipelineOpts, localeKey);
  try {
    const rawJson = (await redis.get(key)) as string | null;
    if (!rawJson || typeof rawJson !== "string") return null;
    const parsed = JSON.parse(rawJson) as QueryAST;
    if (!parsed || typeof parsed.searchQuery !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function setQueryAstInRedis(
  raw: string,
  ast: QueryAST,
  pipelineOpts: { useLLM: boolean; useMLIntent: boolean },
  localeKey: string,
  ttlSeconds: number,
): Promise<void> {
  if (!isQueryAstRedisCacheEnabled() || ttlSeconds <= 0) return;
  const redis = getRedis();
  if (!redis) return;
  const key = redisKey(raw, pipelineOpts, localeKey);
  try {
    const payload = JSON.stringify(stripEmbedding(ast));
    await redis.setex(key, ttlSeconds, payload);
  } catch (err) {
    console.warn("[queryAstRedis] set failed:", (err as Error)?.message ?? err);
  }
}
