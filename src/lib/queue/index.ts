import { Queue } from "bullmq";
import IORedis from "ioredis";
import { config } from "../../config";

// Lazy-load Redis connection to avoid startup failures
let connection: IORedis | null = null;
let ingestQueue: Queue | null = null;
let redisAvailable = true;

function getConnection(): IORedis {
  if (!connection) {
    connection = new IORedis(config.redis.url, {
      maxRetriesPerRequest: null, // Required for BullMQ
      lazyConnect: true,
      retryStrategy: (times) => {
        if (times > 3) {
          redisAvailable = false;
          console.warn("[Redis] Connection failed after 3 retries - queue features disabled");
          return null; // Stop retrying
        }
        return Math.min(times * 200, 1000);
      },
    });

    connection.on("error", (err) => {
      if (redisAvailable) {
        console.warn("[Redis] Connection error (queue features disabled):", err.message);
        redisAvailable = false;
      }
    });

    connection.on("connect", () => {
      redisAvailable = true;
      console.log("[Redis] Connected successfully");
    });
  }
  return connection;
}

export function isRedisAvailable(): boolean {
  return redisAvailable;
}

export function getIngestQueue(): Queue {
  if (!ingestQueue) {
    ingestQueue = new Queue("ingest", { connection: getConnection() });
  }
  return ingestQueue;
}

export function getRedisConnection(): IORedis {
  return getConnection();
}

