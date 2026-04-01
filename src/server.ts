import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import { config } from "./config";
import { healthRouter } from "./routes/health/index";
import adminRouter from "./routes/admin";
import compareRouter from "./routes/compare/index";
import { tryonRouter } from "./routes/tryon/index";
import { metricsRouter } from "./routes/metrics/index";
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
import { initClip } from "./lib/image/clip";
import { blip } from "./lib/image/blip";
import { loadEntitiesFromDB } from "./lib/search/semanticSearch";

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

  const [
    { searchRouter },
    { default: productsRouter },
    { default: imageAnalysisRouter },
    { default: ingestRouter },
    { wardrobeRouter },
    { labelingRouter },
  ] = await Promise.all([
    import("./routes/search/index"),
    import("./routes/products"),
    import("./routes/products/image-analysis.controller"),
    import("./routes/ingest/ingest.routes"),
    import("./routes/wardrobe/index"),
    import("./routes/labeling/index"),
  ]);

  app.use("/search", searchRouter);
  app.use("/products", productsRouter);
  app.use("/api/images", imageAnalysisRouter);
  app.use("/api/ingest", ingestRouter);
  app.use("/api/wardrobe", wardrobeRouter);
  app.use("/api/labeling", labelingRouter);
  app.use("/products/price-drops", productsRouter);

  app.use("/admin", adminRouter);
  app.use("/api/compare", compareRouter);
  app.use("/api/tryon", tryonRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/cart", cartRouter);
  app.use("/api/favorites", favoritesRouter);

  // =========================================================================
  // FIX: Initialize CLIP models at startup before serving any traffic.
  //
  // Previously initClip() was never called, so imageSession and textSession
  // remained null. The first search request would hit getTextEmbedding()
  // which immediately threw: "CLIP text model not loaded."
  //
  // We call it here (after routes are registered but before app.listen in
  // index.ts) so both sessions are fully loaded and ready.
  // =========================================================================
  const clipInitOptional =
    process.env.CLIP_INIT_OPTIONAL === "1" ||
    process.env.CLIP_INIT_OPTIONAL === "true" ||
    process.env.K_SERVICE != null; // Cloud Run: never block container startup on model warmup
  try {
    console.log("[server] Initializing CLIP models...");
    await initClip();
    console.log("[server] ✅ CLIP models ready");
  } catch (err) {
    if (clipInitOptional) {
      console.warn(
        "[server] ⚠️ CLIP init skipped (CLIP_INIT_OPTIONAL) — place ONNX files under MODEL_DIR for image search / embeddings:",
        err,
      );
    } else {
      // Keep service bootable even when model artifacts are missing.
      // Search/image endpoints can still respond with graceful degradation.
      console.error("[server] ❌ CLIP model initialization failed (continuing):", err);
    }
  }

  // BLIP is optional — hybrid search degrades gracefully without it,
  // but when models are present captions significantly improve image search.
  try {
    console.log("[server] Initializing BLIP captioning model...");
    await blip.init();
    console.log("[server] ✅ BLIP captioning ready");
  } catch (err) {
    console.warn("[server] ⚠️ BLIP init failed — image search will use image-only embeddings:", (err as Error).message);
  }

  // Pre-load brand/category knowledge base from DB for semantic search
  loadEntitiesFromDB().catch((err) =>
    console.warn("[server] ⚠️ Entity loading failed:", err)
  );

  // Serve static files (labeling UI)
  app.use(express.static(path.join(process.cwd(), "public")));

  app.get("/", (_req, res) =>
    res.json({
      ok: true,
      mode: "monolith",
    })
  );

  // Error handling (must be last)
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}