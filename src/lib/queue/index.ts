import { Queue } from "bullmq";
import IORedis from "ioredis";
import { config } from "../../config";

const connection = new IORedis(config.redis.url);

export const ingestQueue = new Queue("ingest", { connection });

export function getIngestQueue() {
  return ingestQueue;
}



export function getRedisConnection() {
  return connection;
}
