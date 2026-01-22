/**
 * Labeling Controller
 * HTTP request/response handlers - business logic is in `labeling.service.ts` (services live in routes)
 */
import { Request, Response, NextFunction } from "express";
import {
  getPendingTasks,
  assignTask,
  submitLabel,
  skipTask,
  getLabelingStats,
  queueUncertainItems,
} from "./labeling.service";
import { getCategories, getPatterns, getMaterials } from "./labeling.service";

// Helper to get labeler ID from request
function getLabelerId(req: Request): number {
  const id = req.headers["x-labeler-id"] || req.query.labeler_id;
  if (!id) throw new Error("Labeler ID required");
  return parseInt(String(id), 10);
}

/**
 * GET /api/labeling/tasks - Get pending labeling tasks
 */
export async function getTasks(req: Request, res: Response, next: NextFunction) {
  try {
    const labelerId = getLabelerId(req);
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;
    const taskType = req.query.task_type as string | undefined;

    const tasks = await getPendingTasks(labelerId, limit, taskType);
    res.json({ success: true, tasks });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/labeling/tasks/:id/assign - Assign a task to the current labeler
 */
export async function assignTaskHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const labelerId = getLabelerId(req);
    const taskId = parseInt(req.params.id, 10);

    const task = await assignTask(taskId, labelerId);
    if (!task) {
      return res.status(404).json({ success: false, error: "Task not found or already assigned" });
    }

    res.json({ success: true, task });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/labeling/tasks/:id/submit - Submit a label for a task
 */
export async function submitLabelHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const labelerId = getLabelerId(req);
    const taskId = parseInt(req.params.id, 10);
    const { label_value, confidence, time_spent_ms } = req.body;

    if (!label_value) {
      return res.status(400).json({ success: false, error: "label_value required" });
    }

    await submitLabel({
      task_id: taskId,
      labeler_id: labelerId,
      label_value,
      confidence,
      time_spent_ms,
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/labeling/tasks/:id/skip - Skip a task
 */
export async function skipTaskHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const taskId = parseInt(req.params.id, 10);
    const { reason } = req.body;

    const skipped = await skipTask(taskId, reason);
    if (!skipped) {
      return res.status(404).json({ success: false, error: "Task not found" });
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/labeling/stats - Get labeling statistics
 */
export async function getStats(_req: Request, res: Response, next: NextFunction) {
  try {
    const stats = await getLabelingStats();
    res.json({ success: true, stats });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/labeling/queue - Queue uncertain items for labeling (admin only)
 */
export async function queueItems(req: Request, res: Response, next: NextFunction) {
  try {
    const { uncertainty_threshold, batch_size } = req.body;

    const queued = await queueUncertainItems({
      uncertaintyThreshold: uncertainty_threshold,
      batchSize: batch_size,
    });

    res.json({ success: true, queued });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/labeling/categories - Get available category options
 */
export async function getCategoriesHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const categories = await getCategories();
    res.json({ success: true, categories });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/labeling/patterns - Get available pattern options
 */
export async function getPatternsHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const patterns = await getPatterns();
    res.json({ success: true, patterns });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/labeling/materials - Get available material options
 */
export async function getMaterialsHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const materials = await getMaterials();
    res.json({ success: true, materials });
  } catch (err) {
    next(err);
  }
}
