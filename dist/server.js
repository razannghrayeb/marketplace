"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createServer = createServer;
const express_1 = __importDefault(require("express"));
const config_js_1 = require("./config.js");
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const index_js_1 = require("./routes/health/index.js");
const index_js_2 = require("./routes/search/index.js");
const index_js_3 = __importDefault(require("./routes/products/index.js"));
const index_js_4 = __importDefault(require("./routes/admin/index.js"));
const index_js_5 = __importDefault(require("./routes/compare/index.js"));
const index_js_6 = require("./lib/core/index.js");
const index_js_7 = require("./middleware/index.js");
async function createServer() {
    // try {
    //   await ensureIndex();
    // } catch (err) {
    //   console.error("Warning: Could not ensure OpenSearch index:", err);
    // }process.env.NODE_ENV = "test";
    process.env.NODE_ENV = "test";
    if (process.env.NODE_ENV !== "test") {
        try {
            await (0, index_js_6.ensureIndex)();
        }
        catch (err) {
            console.error("Warning: Could not ensure OpenSearch index:", err);
        }
    }
    const app = (0, express_1.default)();
    // Security & parsing
    app.use((0, helmet_1.default)());
    app.use((0, cors_1.default)({ origin: config_js_1.config.corsOrigin }));
    app.use(express_1.default.json({ limit: "5mb" }));
    // Logging & rate limiting
    app.use(index_js_7.requestLogger);
    app.use((0, index_js_7.rateLimit)({ windowMs: 60000, maxRequests: 100 }));
    // Routes
    app.use("/health", index_js_1.healthRouter);
    app.use("/search", index_js_2.searchRouter);
    app.use("/products", index_js_3.default);
    app.use("/admin", index_js_4.default);
    app.use("/api/compare", index_js_5.default);
    app.get("/", (_req, res) => res.json({ ok: true }));
    // Error handling (must be last)
    app.use(index_js_7.notFoundHandler);
    app.use(index_js_7.errorHandler);
    return app;
}
