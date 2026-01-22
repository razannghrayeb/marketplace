"use strict";
/**
 * Health Service
 *
 * Business logic for health checks.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkReadiness = checkReadiness;
exports.checkLiveness = checkLiveness;
const index_js_1 = require("../../lib/core/index.js");
const index_js_2 = require("../../lib/core/index.js");
/**
 * Check readiness - all dependencies available
 */
async function checkReadiness() {
    try {
        // OpenSearch
        const os = await index_js_1.osClient.cluster.health();
        // Postgres
        await index_js_2.pg.query("SELECT 1");
        return {
            ok: true,
            search: os.body.status,
            db: "ok"
        };
    }
    catch (e) {
        return {
            ok: false,
            error: e.message
        };
    }
}
/**
 * Check liveness - app is running
 */
function checkLiveness() {
    return { ok: true };
}
