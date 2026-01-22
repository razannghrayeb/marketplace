"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.healthRouter = void 0;
const express_1 = require("express");
const index_js_1 = require("../lib/core/index.js");
const index_js_2 = require("../lib/core/index.js");
exports.healthRouter = (0, express_1.Router)();
exports.healthRouter.get("/ready", async (_req, res) => {
    try {
        // OpenSearch
        const os = await index_js_1.osClient.cluster.health();
        // Postgres
        await index_js_2.pg.query("SELECT 1");
        res.json({ ok: true, search: os.body.status, db: "ok" });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});
exports.healthRouter.get("/live", (_req, res) => res.json({ ok: true }));
