/**
 * Ingest Controller
 * HTTP request/response handlers - business logic is in ingest.service.ts
 */
import { Request, Response, NextFunction } from "express";
import { createIngestJob, getIngestJob } from "./ingest.service";

/**
 * POST /api/ingest/image
 * Accepts multipart/form-data `image` and optional `user_id` in body
 * Enqueues an ingestion job after storing raw image to R2
 */
export async function uploadImage(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: "No image file provided" });
    }

    const userId = req.body.user_id ? parseInt(req.body.user_id, 10) : null;

    const { jobId, cdnUrl } = await createIngestJob({
      imageBuffer: req.file.buffer,
      userId,
      filename: req.file.originalname || "upload.jpg",
      mimetype: req.file.mimetype || "image/jpeg"
    });

    return res.status(202).json({ success: true, jobId, cdn_url: cdnUrl });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/ingest/:jobId
 * Return ingest job status and result
 */
export async function getJobStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const { jobId } = req.params;
    const job = await getIngestJob(jobId);

    if (!job) {
      return res.status(404).json({ success: false, error: "Job not found" });
    }

    return res.json({ success: true, job });
  } catch (err) {
    next(err);
  }
}
