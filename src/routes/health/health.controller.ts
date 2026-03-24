/**
 * Health Routes
 * 
 * API endpoints for health checks.
 */

import { Router, Request, Response } from "express";
import { checkReadiness, checkLiveness, getDetailedHealth } from "./health.service";

const router = Router();

/**
 * GET /health/ready
 * 
 * Readiness check - verifies all dependencies are available
 */
router.get("/ready", async (_req: Request, res: Response) => {
  const status = await checkReadiness();
  
  if (status.ok) {
    res.json(status);
  } else {
    res.status(500).json(status);
  }
});

/**
 * GET /health/live
 * 
 * Liveness check - app is running
 */
router.get("/live", (_req: Request, res: Response) => {
  const status = checkLiveness();
  res.json(status);
});

/**
 * GET /health/detailed
 * 
 * Detailed health including circuit breakers, cache stats
 */
router.get("/detailed", async (_req: Request, res: Response) => {
  const status = await getDetailedHealth();
  res.json(status);
});

export default router;
