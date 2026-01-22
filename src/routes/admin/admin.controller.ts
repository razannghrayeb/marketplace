/**
 * Admin Controller
 * 
 * HTTP handlers for admin operations
 */
import { Request, Response, NextFunction } from "express";
import * as adminService from "./admin.service.js";

// ============================================================================
// Product Moderation
// ============================================================================

/**
 * POST /admin/products/:id/hide
 */
export async function hideProduct(req: Request, res: Response, next: NextFunction) {
  try {
    const productId = parseInt(req.params.id);
    const { reason } = req.body;

    await adminService.hideProduct(productId, reason);
    res.json({ success: true, message: "Product hidden" });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /admin/products/:id/unhide
 */
export async function unhideProduct(req: Request, res: Response, next: NextFunction) {
  try {
    const productId = parseInt(req.params.id);

    await adminService.unhideProduct(productId);
    res.json({ success: true, message: "Product unhidden" });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /admin/products/:id/flag
 */
export async function flagProduct(req: Request, res: Response, next: NextFunction) {
  try {
    const productId = parseInt(req.params.id);
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({ error: "Reason is required" });
    }

    await adminService.flagProduct(productId, reason);
    res.json({ success: true, message: "Product flagged" });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /admin/products/:id/unflag
 */
export async function unflagProduct(req: Request, res: Response, next: NextFunction) {
  try {
    const productId = parseInt(req.params.id);

    await adminService.unflagProduct(productId);
    res.json({ success: true, message: "Product unflagged" });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /admin/products/hide-batch
 */
export async function hideProductsBatch(req: Request, res: Response, next: NextFunction) {
  try {
    const { productIds, reason } = req.body;

    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ error: "productIds array is required" });
    }

    const count = await adminService.hideProductsBatch(productIds, reason);
    res.json({ success: true, count, message: `${count} products hidden` });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /admin/products/flagged
 */
export async function getFlaggedProducts(req: Request, res: Response, next: NextFunction) {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const includeHidden = req.query.includeHidden !== "false";

    const result = await adminService.getFlaggedProducts({ page, limit, includeHidden });
    res.json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /admin/products/hidden
 */
export async function getHiddenProducts(req: Request, res: Response, next: NextFunction) {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;

    const result = await adminService.getHiddenProducts({ page, limit });
    res.json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /admin/products/:id/duplicates
 */
export async function findDuplicates(req: Request, res: Response, next: NextFunction) {
  try {
    const productId = parseInt(req.params.id);
    const duplicates = await adminService.findDuplicates(productId);
    res.json({ duplicates });
  } catch (error) {
    next(error);
  }
}

// ============================================================================
// Canonical Management
// ============================================================================

/**
 * GET /admin/canonicals
 */
export async function listCanonicals(req: Request, res: Response, next: NextFunction) {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const sortBy = (req.query.sortBy as string) || "product_count";
    const sortOrder = (req.query.sortOrder as string) || "desc";

    const result = await adminService.listCanonicals({ 
      page, 
      limit, 
      sortBy: sortBy as any,
      sortOrder: sortOrder as any,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /admin/canonicals/:id
 */
export async function getCanonical(req: Request, res: Response, next: NextFunction) {
  try {
    const canonicalId = parseInt(req.params.id);
    const canonical = await adminService.getCanonical(canonicalId);

    if (!canonical) {
      return res.status(404).json({ error: "Canonical not found" });
    }

    res.json(canonical);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /admin/canonicals/merge
 */
export async function mergeCanonicals(req: Request, res: Response, next: NextFunction) {
  try {
    const { sourceId, targetId } = req.body;

    if (!sourceId || !targetId) {
      return res.status(400).json({ error: "sourceId and targetId are required" });
    }

    const result = await adminService.mergeCanonicalGroups(sourceId, targetId);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /admin/canonicals/:id/detach/:productId
 */
export async function detachFromCanonical(req: Request, res: Response, next: NextFunction) {
  try {
    const productId = parseInt(req.params.productId);

    await adminService.detachFromCanonical(productId);
    res.json({ success: true, message: "Product detached from canonical" });
  } catch (error) {
    next(error);
  }
}

// ============================================================================
// Job Management
// ============================================================================

/**
 * POST /admin/jobs/:type/run
 */
export async function runJob(req: Request, res: Response, next: NextFunction) {
  try {
    const jobType = req.params.type;
    const validTypes = ["nightly-crawl", "price-snapshot", "canonical-recompute", "cleanup-old-data"];

    if (!validTypes.includes(jobType)) {
      return res.status(400).json({ error: `Invalid job type. Valid types: ${validTypes.join(", ")}` });
    }

    const result = await adminService.runJob(jobType);
    res.json({ success: true, ...result, message: `Job ${jobType} queued` });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /admin/jobs/schedules
 */
export async function getSchedules(req: Request, res: Response, next: NextFunction) {
  try {
    const schedules = await adminService.getSchedules();
    res.json({ schedules });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /admin/jobs/metrics
 */
export async function getJobMetrics(req: Request, res: Response, next: NextFunction) {
  try {
    const metrics = await adminService.getJobQueueMetrics();
    res.json(metrics);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /admin/jobs/history
 */
export async function getJobHistory(req: Request, res: Response, next: NextFunction) {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const jobType = req.query.type as string | undefined;

    const history = await adminService.getJobHistory({ limit, jobType });
    res.json({ history });
  } catch (error) {
    next(error);
  }
}

// ============================================================================
// Dashboard
// ============================================================================

/**
 * GET /admin/stats
 */
export async function getDashboardStats(req: Request, res: Response, next: NextFunction) {
  try {
    const stats = await adminService.getDashboardStats();
    res.json(stats);
  } catch (error) {
    next(error);
  }
}
