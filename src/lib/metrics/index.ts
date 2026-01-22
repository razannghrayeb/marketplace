/**
 * Prometheus Metrics
 * Basic instrumentation for monitoring the marketplace API
 */
import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from "prom-client";

// Create a custom registry
export const metricsRegistry = new Registry();

// Collect default Node.js metrics (memory, CPU, etc.)
collectDefaultMetrics({ register: metricsRegistry });

// ============================================================================
// HTTP Metrics
// ============================================================================

export const httpRequestsTotal = new Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "path", "status"],
  registers: [metricsRegistry],
});

export const httpRequestDuration = new Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "path", "status"],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry],
});

// ============================================================================
// Wardrobe Metrics
// ============================================================================

export const wardrobeItemsTotal = new Gauge({
  name: "wardrobe_items_total",
  help: "Total wardrobe items by user (sampled)",
  labelNames: ["source"],
  registers: [metricsRegistry],
});

export const wardrobeOperations = new Counter({
  name: "wardrobe_operations_total",
  help: "Wardrobe operation counts",
  labelNames: ["operation", "status"],
  registers: [metricsRegistry],
});

export const styleProfileComputations = new Counter({
  name: "style_profile_computations_total",
  help: "Number of style profile computations",
  labelNames: ["type"],  // "full" or "incremental"
  registers: [metricsRegistry],
});

export const compatibilityComputations = new Counter({
  name: "compatibility_computations_total",
  help: "Number of compatibility score computations",
  registers: [metricsRegistry],
});

export const recommendationsGenerated = new Counter({
  name: "recommendations_generated_total",
  help: "Number of recommendation requests",
  labelNames: ["type"],  // "gap", "style", "compatibility"
  registers: [metricsRegistry],
});

// ============================================================================
// Ingestion Metrics
// ============================================================================

export const ingestJobsTotal = new Counter({
  name: "ingest_jobs_total",
  help: "Total ingestion jobs",
  labelNames: ["status"],  // "queued", "completed", "failed"
  registers: [metricsRegistry],
});

export const ingestItemsProcessed = new Counter({
  name: "ingest_items_processed_total",
  help: "Total items processed through ingestion",
  registers: [metricsRegistry],
});

export const ingestProcessingDuration = new Histogram({
  name: "ingest_processing_duration_seconds",
  help: "Duration of ingestion processing",
  buckets: [0.5, 1, 2, 5, 10, 30, 60, 120],
  registers: [metricsRegistry],
});

// ============================================================================
// ML/Embedding Metrics
// ============================================================================

export const embeddingComputations = new Counter({
  name: "embedding_computations_total",
  help: "Total embedding computations",
  labelNames: ["model"],  // "clip", "fashion-clip"
  registers: [metricsRegistry],
});

export const embeddingDuration = new Histogram({
  name: "embedding_duration_seconds",
  help: "Duration of embedding computation",
  labelNames: ["model"],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2],
  registers: [metricsRegistry],
});

export const yoloDetections = new Counter({
  name: "yolo_detections_total",
  help: "Total YOLO detections",
  labelNames: ["class"],
  registers: [metricsRegistry],
});

export const yoloDetectionDuration = new Histogram({
  name: "yolo_detection_duration_seconds",
  help: "Duration of YOLO detection",
  buckets: [0.1, 0.25, 0.5, 1, 2, 5],
  registers: [metricsRegistry],
});

// ============================================================================
// Search Metrics
// ============================================================================

export const searchRequests = new Counter({
  name: "search_requests_total",
  help: "Total search requests",
  labelNames: ["type"],  // "text", "image", "hybrid"
  registers: [metricsRegistry],
});

export const searchLatency = new Histogram({
  name: "search_latency_seconds",
  help: "Search latency in seconds",
  labelNames: ["type"],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2],
  registers: [metricsRegistry],
});

export const searchResults = new Histogram({
  name: "search_results_count",
  help: "Number of search results returned",
  labelNames: ["type"],
  buckets: [0, 1, 5, 10, 20, 50, 100],
  registers: [metricsRegistry],
});

// ============================================================================
// Database Metrics
// ============================================================================

export const dbPoolSize = new Gauge({
  name: "db_pool_size",
  help: "Database connection pool size",
  labelNames: ["state"],  // "active", "idle", "waiting"
  registers: [metricsRegistry],
});

export const dbQueryDuration = new Histogram({
  name: "db_query_duration_seconds",
  help: "Database query duration",
  labelNames: ["operation"],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
  registers: [metricsRegistry],
});

// ============================================================================
// Cache Metrics
// ============================================================================

export const cacheHits = new Counter({
  name: "cache_hits_total",
  help: "Cache hit count",
  labelNames: ["cache"],
  registers: [metricsRegistry],
});

export const cacheMisses = new Counter({
  name: "cache_misses_total",
  help: "Cache miss count",
  labelNames: ["cache"],
  registers: [metricsRegistry],
});

// ============================================================================
// Export Registry
// ============================================================================

export function getMetrics(): Promise<string> {
  return metricsRegistry.metrics();
}

export function getContentType(): string {
  return metricsRegistry.contentType;
}
