import express from "express";
import cors from "cors";
import helmet from "helmet";
import { config } from "./config";
import { healthRouter } from "./routes/health/index";
import { searchRouter } from "./routes/search/index";
import productsRouter from "./routes/products";
import adminRouter from "./routes/admin";
import compareRouter from "./routes/compare/index";
import imageAnalysisRouter from "./routes/products/image-analysis.controller";
import { ensureIndex } from "./lib/core";
import {
  errorHandler,
  notFoundHandler,
  requestLogger,
  rateLimit,
} from "./middleware";


export async function createServer() {
try {
  await ensureIndex();
} catch (err) {
  console.error("Warning: Could not ensure OpenSearch index:", err);
}
const app = express();

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
app.use("/api/images", imageAnalysisRouter);  // Unified image analysis API
app.use('/products/price-drops', productsRouter);
app.get("/", (_req, res) => res.json({ ok: true }));

// Error handling (must be last)
app.use(notFoundHandler);
app.use(errorHandler);

return app;
}