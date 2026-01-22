"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Admin Routes
 *
 * Routes for admin operations: moderation, canonicals, jobs
 */
const express_1 = require("express");
const adminController = __importStar(require("./admin.controller.js"));
const router = (0, express_1.Router)();
// ============================================================================
// Product Moderation
// ============================================================================
router.post("/products/:id/hide", adminController.hideProduct);
router.post("/products/:id/unhide", adminController.unhideProduct);
router.post("/products/:id/flag", adminController.flagProduct);
router.post("/products/:id/unflag", adminController.unflagProduct);
router.post("/products/hide-batch", adminController.hideProductsBatch);
router.get("/products/flagged", adminController.getFlaggedProducts);
router.get("/products/hidden", adminController.getHiddenProducts);
router.get("/products/:id/duplicates", adminController.findDuplicates);
// ============================================================================
// Canonical Management
// ============================================================================
router.get("/canonicals", adminController.listCanonicals);
router.get("/canonicals/:id", adminController.getCanonical);
router.post("/canonicals/merge", adminController.mergeCanonicals);
router.post("/canonicals/:id/detach/:productId", adminController.detachFromCanonical);
// ============================================================================
// Job Management
// ============================================================================
router.post("/jobs/:type/run", adminController.runJob);
router.get("/jobs/schedules", adminController.getSchedules);
router.get("/jobs/metrics", adminController.getJobMetrics);
router.get("/jobs/history", adminController.getJobHistory);
// ============================================================================
// Dashboard
// ============================================================================
router.get("/stats", adminController.getDashboardStats);
exports.default = router;
__exportStar(require("./admin.controller.js"), exports);
