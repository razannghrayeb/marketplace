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
Object.defineProperty(exports, "__esModule", { value: true });
exports.hideProduct = hideProduct;
exports.unhideProduct = unhideProduct;
exports.flagProduct = flagProduct;
exports.unflagProduct = unflagProduct;
exports.hideProductsBatch = hideProductsBatch;
exports.getFlaggedProducts = getFlaggedProducts;
exports.getHiddenProducts = getHiddenProducts;
exports.findDuplicates = findDuplicates;
exports.listCanonicals = listCanonicals;
exports.getCanonical = getCanonical;
exports.mergeCanonicals = mergeCanonicals;
exports.detachFromCanonical = detachFromCanonical;
exports.runJob = runJob;
exports.getSchedules = getSchedules;
exports.getJobMetrics = getJobMetrics;
exports.getJobHistory = getJobHistory;
exports.getDashboardStats = getDashboardStats;
const adminService = __importStar(require("./admin.service.js"));
// ============================================================================
// Product Moderation
// ============================================================================
/**
 * POST /admin/products/:id/hide
 */
async function hideProduct(req, res, next) {
    try {
        const productId = parseInt(req.params.id);
        const { reason } = req.body;
        await adminService.hideProduct(productId, reason);
        res.json({ success: true, message: "Product hidden" });
    }
    catch (error) {
        next(error);
    }
}
/**
 * POST /admin/products/:id/unhide
 */
async function unhideProduct(req, res, next) {
    try {
        const productId = parseInt(req.params.id);
        await adminService.unhideProduct(productId);
        res.json({ success: true, message: "Product unhidden" });
    }
    catch (error) {
        next(error);
    }
}
/**
 * POST /admin/products/:id/flag
 */
async function flagProduct(req, res, next) {
    try {
        const productId = parseInt(req.params.id);
        const { reason } = req.body;
        if (!reason) {
            return res.status(400).json({ error: "Reason is required" });
        }
        await adminService.flagProduct(productId, reason);
        res.json({ success: true, message: "Product flagged" });
    }
    catch (error) {
        next(error);
    }
}
/**
 * POST /admin/products/:id/unflag
 */
async function unflagProduct(req, res, next) {
    try {
        const productId = parseInt(req.params.id);
        await adminService.unflagProduct(productId);
        res.json({ success: true, message: "Product unflagged" });
    }
    catch (error) {
        next(error);
    }
}
/**
 * POST /admin/products/hide-batch
 */
async function hideProductsBatch(req, res, next) {
    try {
        const { productIds, reason } = req.body;
        if (!Array.isArray(productIds) || productIds.length === 0) {
            return res.status(400).json({ error: "productIds array is required" });
        }
        const count = await adminService.hideProductsBatch(productIds, reason);
        res.json({ success: true, count, message: `${count} products hidden` });
    }
    catch (error) {
        next(error);
    }
}
/**
 * GET /admin/products/flagged
 */
async function getFlaggedProducts(req, res, next) {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const includeHidden = req.query.includeHidden !== "false";
        const result = await adminService.getFlaggedProducts({ page, limit, includeHidden });
        res.json(result);
    }
    catch (error) {
        next(error);
    }
}
/**
 * GET /admin/products/hidden
 */
async function getHiddenProducts(req, res, next) {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const result = await adminService.getHiddenProducts({ page, limit });
        res.json(result);
    }
    catch (error) {
        next(error);
    }
}
/**
 * GET /admin/products/:id/duplicates
 */
async function findDuplicates(req, res, next) {
    try {
        const productId = parseInt(req.params.id);
        const duplicates = await adminService.findDuplicates(productId);
        res.json({ duplicates });
    }
    catch (error) {
        next(error);
    }
}
// ============================================================================
// Canonical Management
// ============================================================================
/**
 * GET /admin/canonicals
 */
async function listCanonicals(req, res, next) {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const sortBy = req.query.sortBy || "product_count";
        const sortOrder = req.query.sortOrder || "desc";
        const result = await adminService.listCanonicals({
            page,
            limit,
            sortBy: sortBy,
            sortOrder: sortOrder,
        });
        res.json(result);
    }
    catch (error) {
        next(error);
    }
}
/**
 * GET /admin/canonicals/:id
 */
async function getCanonical(req, res, next) {
    try {
        const canonicalId = parseInt(req.params.id);
        const canonical = await adminService.getCanonical(canonicalId);
        if (!canonical) {
            return res.status(404).json({ error: "Canonical not found" });
        }
        res.json(canonical);
    }
    catch (error) {
        next(error);
    }
}
/**
 * POST /admin/canonicals/merge
 */
async function mergeCanonicals(req, res, next) {
    try {
        const { sourceId, targetId } = req.body;
        if (!sourceId || !targetId) {
            return res.status(400).json({ error: "sourceId and targetId are required" });
        }
        const result = await adminService.mergeCanonicalGroups(sourceId, targetId);
        res.json({ success: true, ...result });
    }
    catch (error) {
        next(error);
    }
}
/**
 * POST /admin/canonicals/:id/detach/:productId
 */
async function detachFromCanonical(req, res, next) {
    try {
        const productId = parseInt(req.params.productId);
        await adminService.detachFromCanonical(productId);
        res.json({ success: true, message: "Product detached from canonical" });
    }
    catch (error) {
        next(error);
    }
}
// ============================================================================
// Job Management
// ============================================================================
/**
 * POST /admin/jobs/:type/run
 */
async function runJob(req, res, next) {
    try {
        const jobType = req.params.type;
        const validTypes = ["nightly-crawl", "price-snapshot", "canonical-recompute", "cleanup-old-data"];
        if (!validTypes.includes(jobType)) {
            return res.status(400).json({ error: `Invalid job type. Valid types: ${validTypes.join(", ")}` });
        }
        const result = await adminService.runJob(jobType);
        res.json({ success: true, ...result, message: `Job ${jobType} queued` });
    }
    catch (error) {
        next(error);
    }
}
/**
 * GET /admin/jobs/schedules
 */
async function getSchedules(req, res, next) {
    try {
        const schedules = await adminService.getSchedules();
        res.json({ schedules });
    }
    catch (error) {
        next(error);
    }
}
/**
 * GET /admin/jobs/metrics
 */
async function getJobMetrics(req, res, next) {
    try {
        const metrics = await adminService.getJobQueueMetrics();
        res.json(metrics);
    }
    catch (error) {
        next(error);
    }
}
/**
 * GET /admin/jobs/history
 */
async function getJobHistory(req, res, next) {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const jobType = req.query.type;
        const history = await adminService.getJobHistory({ limit, jobType });
        res.json({ history });
    }
    catch (error) {
        next(error);
    }
}
// ============================================================================
// Dashboard
// ============================================================================
/**
 * GET /admin/stats
 */
async function getDashboardStats(req, res, next) {
    try {
        const stats = await adminService.getDashboardStats();
        res.json(stats);
    }
    catch (error) {
        next(error);
    }
}
