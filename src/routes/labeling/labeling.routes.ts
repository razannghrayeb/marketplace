/**
 * Labeling Routes
 * Route definitions only - handlers are in labeling.controller.ts
 */
import { Router } from "express";
import * as controller from "./labeling.controller";

const router = Router();

// Task management
router.get("/tasks", controller.getTasks);
router.post("/tasks/:id/assign", controller.assignTaskHandler);
router.post("/tasks/:id/submit", controller.submitLabelHandler);
router.post("/tasks/:id/skip", controller.skipTaskHandler);

// Statistics
router.get("/stats", controller.getStats);

// Queue management (admin)
router.post("/queue", controller.queueItems);

// Reference data
router.get("/categories", controller.getCategoriesHandler);
router.get("/patterns", controller.getPatternsHandler);
router.get("/materials", controller.getMaterialsHandler);

export default router;
export { router as labelingRouter };
