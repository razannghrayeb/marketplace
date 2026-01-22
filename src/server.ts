import express from "express";
import { config } from "./config.js";
import cors from "cors";
import helmet from "helmet";
import { healthRouter } from "./routes/health/index.js";
import { searchRouter } from "./routes/search/index.js";
import productsRouter from "./routes/products/index.js";
import adminRouter from "./routes/admin/index.js";
import compareRouter from "./routes/compare/index.js";
import { ensureIndex } from "./lib/core/index.js";
import {
  errorHandler,
  notFoundHandler,
  requestLogger,
  rateLimit,
} from "./middleware/index.js";


export async function createServer() {
// try {
//   await ensureIndex();
// } catch (err) {
//   console.error("Warning: Could not ensure OpenSearch index:", err);
// }process.env.NODE_ENV = "test";
process.env.NODE_ENV = "test";

if (process.env.NODE_ENV !== "test") {
    try {
      await ensureIndex();
    } catch (err) {
      console.error("Warning: Could not ensure OpenSearch index:", err);
    }
}const app = express();

// Security & parsing
app.use(helmet());
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: "5mb" }));

// Logging & rate limiting
app.use(requestLogger);
app.use(rateLimit({ windowMs: 60000, maxRequests: 100 }));

// Routes
app.use("/health", healthRouter);
app.use("/search", searchRouter);
app.use("/products", productsRouter);
app.use("/admin", adminRouter);
app.use("/api/compare", compareRouter);

app.get("/", (_req, res) => res.json({ ok: true }));

// Error handling (must be last)
app.use(notFoundHandler);
app.use(errorHandler);

return app;
}