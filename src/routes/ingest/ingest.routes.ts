/**
 * Ingest Routes
 * Route definitions only - handlers are in ingest.controller.ts
 */
import { Router } from "express";
import multer from "multer";
import * as controller from "./ingest.controller";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }
});

// POST /api/ingest/image - Upload and queue image for processing
router.post("/image", upload.single("image"), controller.uploadImage);

// GET /api/ingest/:jobId - Get job status
router.get("/:jobId", controller.getJobStatus);

export default router;
export { router as ingestRouter };
