/**
 * Metrics Middleware
 * Instruments HTTP requests with Prometheus metrics
 */
import { Request, Response, NextFunction } from "express";
import {
  httpRequestsTotal,
  httpRequestDuration,
} from "../lib/metrics";

/**
 * Middleware to record HTTP request metrics
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();

  // Normalize path for metrics (avoid high cardinality)
  const normalizedPath = normalizePath(req.path);

  res.on("finish", () => {
    const duration = Number(process.hrtime.bigint() - start) / 1e9;
    const labels = {
      method: req.method,
      path: normalizedPath,
      status: String(res.statusCode),
    };

    httpRequestsTotal.inc(labels);
    httpRequestDuration.observe(labels, duration);
  });

  next();
}

/**
 * Normalize paths to avoid high cardinality in metrics
 * e.g., /products/123 -> /products/:id
 */
function normalizePath(path: string): string {
  // Skip metrics endpoint
  if (path === "/metrics") return path;

  return path
    // Replace numeric IDs
    .replace(/\/\d+/g, "/:id")
    // Replace UUIDs
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/:uuid")
    // Truncate very long paths
    .slice(0, 50);
}
