import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import { config } from "./config";
import { healthRouter } from "./routes/health/index";
import { searchRouter } from "./routes/search/index";
import productsRouter from "./routes/products";
import adminRouter from "./routes/admin";
import compareRouter from "./routes/compare/index";
import imageAnalysisRouter from "./routes/products/image-analysis.controller";
import ingestRouter from "./routes/ingest/ingest.routes";
import { wardrobeRouter } from "./routes/wardrobe/index";
import { tryonRouter } from "./routes/tryon/index";
import { metricsRouter } from "./routes/metrics/index";
import { labelingRouter } from "./routes/labeling/index";
import { authRouter } from "./routes/auth/index";
import { cartRouter } from "./routes/cart/index";
import { favoritesRouter } from "./routes/favorites/index";
import { ensureIndex } from "./lib/core";
import {
  errorHandler,
  notFoundHandler,
  requestLogger,
  rateLimit,
} from "./middleware/index";
import { metricsMiddleware } from "./middleware/metrics";

export async function createServer() {
  if (process.env.NODE_ENV !== "test") {
    try {
      await ensureIndex();
    } catch (err) {
      console.error("Warning: Could not ensure OpenSearch index:", err);
    }
  }

  const app = express();

  // Security & parsing
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: "5mb" }));

  // Logging & rate limiting
  app.use(requestLogger);
  app.use(metricsMiddleware);
  app.use(rateLimit({ windowMs: 60000, maxRequests: 100 }));

  // Routes
  app.use("/metrics", metricsRouter);
  app.use("/health", healthRouter);
  app.use("/search", searchRouter);
  app.use("/products", productsRouter);
  app.use("/admin", adminRouter);
  app.use("/api/compare", compareRouter);
  app.use("/api/images", imageAnalysisRouter); // Unified image analysis API
  app.use("/api/ingest", ingestRouter);
  app.use("/api/wardrobe", wardrobeRouter);
  app.use("/api/tryon", tryonRouter);
  app.use("/api/labeling", labelingRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/cart", cartRouter);
  app.use("/api/favorites", favoritesRouter);
  app.use("/products/price-drops", productsRouter);

  // Serve static files (labeling UI)
  app.use(express.static(path.join(process.cwd(), "public")));

  app.get("/", (_req, res) => res.json({ ok: true }));

  // Error handling (must be last)
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
