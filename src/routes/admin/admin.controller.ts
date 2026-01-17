/**
 * Admin Controller
 * 
 * HTTP handlers for admin operations
 */
import { Request, Response, NextFunction } from "express";
import * as adminService from "./admin.service";

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

// ============================================================================
// Recommendation Labeling
// ============================================================================

/**
 * GET /admin/reco/label
 * Get base product with recommendations for labeling
 * Query params: baseProductId (required), limit (optional, default 20)
 */
export async function getRecoForLabeling(req: Request, res: Response, next: NextFunction) {
  try {
    const baseProductId = parseInt(req.query.baseProductId as string);
    const limit = parseInt(req.query.limit as string) || 20;

    if (!baseProductId || isNaN(baseProductId)) {
      return res.status(400).json({ 
        error: "baseProductId query parameter is required and must be a number" 
      });
    }

    const result = await adminService.getProductWithRecommendations(baseProductId, limit);
    
    res.json({
      baseProduct: result.baseProduct,
      recommendations: result.recommendations,
      source: result.source,
      count: result.recommendations.length,
    });
  } catch (error: any) {
    if (error.message?.includes("not found")) {
      return res.status(404).json({ error: error.message });
    }
    next(error);
  }
}

/**
 * POST /admin/reco/label
 * Save a label for a recommendation pair
 * Body: { baseProductId, candidateProductId, label, labelScore?, labelerId?, notes?, impressionId? }
 */
export async function saveRecoLabel(req: Request, res: Response, next: NextFunction) {
  try {
    const { 
      baseProductId, 
      candidateProductId, 
      label, 
      labelScore, 
      labelerId, 
      notes,
      impressionId 
    } = req.body;

    // Validate required fields
    if (!baseProductId || !candidateProductId || !label) {
      return res.status(400).json({ 
        error: "baseProductId, candidateProductId, and label are required" 
      });
    }

    // Validate label value
    if (!["good", "ok", "bad"].includes(label)) {
      return res.status(400).json({ 
        error: "label must be one of: good, ok, bad" 
      });
    }

    // Validate labelScore if provided
    if (labelScore !== undefined && (labelScore < 0 || labelScore > 10)) {
      return res.status(400).json({ 
        error: "labelScore must be between 0 and 10" 
      });
    }

    const id = await adminService.saveLabel({
      baseProductId: parseInt(baseProductId),
      candidateProductId: parseInt(candidateProductId),
      label,
      labelScore,
      labelerId: labelerId || "admin",
      notes,
      impressionId: impressionId ? parseInt(impressionId) : undefined,
    });

    res.json({ 
      success: true, 
      labelId: id,
      message: `Label '${label}' saved for ${baseProductId} -> ${candidateProductId}` 
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /admin/reco/label/batch
 * Save multiple labels at once
 * Body: { labels: [{ baseProductId, candidateProductId, label, ... }] }
 */
export async function saveRecoLabelsBatch(req: Request, res: Response, next: NextFunction) {
  try {
    const { labels } = req.body;

    if (!Array.isArray(labels) || labels.length === 0) {
      return res.status(400).json({ error: "labels array is required" });
    }

    // Validate all labels
    for (const label of labels) {
      if (!label.baseProductId || !label.candidateProductId || !label.label) {
        return res.status(400).json({ 
          error: "Each label must have baseProductId, candidateProductId, and label" 
        });
      }
      if (!["good", "ok", "bad"].includes(label.label)) {
        return res.status(400).json({ 
          error: "label must be one of: good, ok, bad" 
        });
      }
    }

    const count = await adminService.saveLabelsBatch(
      labels.map((l: any) => ({
        baseProductId: parseInt(l.baseProductId),
        candidateProductId: parseInt(l.candidateProductId),
        label: l.label,
        labelScore: l.labelScore,
        labelerId: l.labelerId || "admin",
        notes: l.notes,
        impressionId: l.impressionId ? parseInt(l.impressionId) : undefined,
      }))
    );

    res.json({ 
      success: true, 
      savedCount: count,
      message: `${count} labels saved` 
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /admin/reco/labels
 * Get all labeled data for export/review
 * Query params: baseProductId?, label?, labelerId?, limit?, offset?
 */
export async function getLabeledData(req: Request, res: Response, next: NextFunction) {
  try {
    const baseProductId = req.query.baseProductId ? parseInt(req.query.baseProductId as string) : undefined;
    const label = req.query.label as "good" | "ok" | "bad" | undefined;
    const labelerId = req.query.labelerId as string | undefined;
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;

    const data = await adminService.getLabeledData({
      baseProductId,
      label,
      labelerId,
      limit,
      offset,
    });

    res.json({
      labels: data,
      count: data.length,
      offset,
      limit,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /admin/reco/stats
 * Get recommendation system statistics
 */
export async function getRecoStats(req: Request, res: Response, next: NextFunction) {
  try {
    const [labelStats, impressionStats] = await Promise.all([
      adminService.getLabelStats(),
      adminService.getImpressionStats(),
    ]);

    res.json({
      labels: labelStats,
      impressions: impressionStats,
    });
  } catch (error) {
    next(error);
  }
}

