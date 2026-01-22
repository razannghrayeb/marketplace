"use strict";
/**
 * Health Routes
 *
 * API endpoints for health checks.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const health_service_js_1 = require("./health.service.js");
const router = (0, express_1.Router)();
/**
 * GET /health/ready
 *
 * Readiness check - verifies all dependencies are available
 */
router.get("/ready", async (_req, res) => {
    const status = await (0, health_service_js_1.checkReadiness)();
    if (status.ok) {
        res.json(status);
    }
    else {
        res.status(500).json(status);
    }
});
/**
 * GET /health/live
 *
 * Liveness check - app is running
 */
router.get("/live", (_req, res) => {
    const status = (0, health_service_js_1.checkLiveness)();
    res.json(status);
});
exports.default = router;
