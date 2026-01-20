/**
 * Metrics Endpoint
 * Exposes Prometheus metrics for scraping
 */
import { Router, Request, Response } from "express";
import { getMetrics, getContentType } from "../../lib/metrics";

const router = Router();

/**
 * GET /metrics
 * Returns Prometheus-formatted metrics
 */
router.get("/", async (_req: Request, res: Response) => {
  try {
    const metrics = await getMetrics();
    res.set("Content-Type", getContentType());
    res.send(metrics);
  } catch (err) {
    console.error("Error getting metrics:", err);
    res.status(500).send("Error collecting metrics");
  }
});

export const metricsRouter = router;
