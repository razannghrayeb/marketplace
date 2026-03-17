import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import axios from "axios";
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

const ML_ROUTE_PREFIXES = [
  "/search",
  "/products",
  "/api/images",
  "/api/ingest",
  "/api/wardrobe",
  "/api/labeling",
];

function isMlRoute(pathname: string): boolean {
  return ML_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

async function proxyMlRequest(req: Request, res: Response, next: NextFunction) {
  if (!config.mlServiceUrl) {
    return res.status(503).json({
      ok: false,
      error:
        "ML_SERVICE_URL is not configured for SERVICE_ROLE=api. Cannot proxy ML routes.",
    });
  }

  const targetUrl = new URL(req.originalUrl, config.mlServiceUrl).toString();
  const headers: Record<string, string | string[] | undefined> = {
    ...req.headers,
    "x-forwarded-host": req.get("host") || "",
    "x-forwarded-proto": req.protocol,
    "x-forwarded-for": req.ip,
  };

  delete headers.host;
  delete headers.connection;
  delete headers["content-length"];

  const method = req.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";

  let data: unknown;
  if (hasBody) {
    if (req.is("application/json") && req.body && Object.keys(req.body).length > 0) {
      data = req.body;
    } else {
      data = req;
    }
  }

  try {
    const upstream = await axios({
      url: targetUrl,
      method: method as any,
      headers,
      data,
      responseType: "stream",
      validateStatus: () => true,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 120000,
    });

    const hopByHop = new Set([
      "connection",
      "keep-alive",
      "proxy-authenticate",
      "proxy-authorization",
      "te",
      "trailer",
      "transfer-encoding",
      "upgrade",
    ]);

    for (const [key, value] of Object.entries(upstream.headers)) {
      if (hopByHop.has(key.toLowerCase()) || value === undefined) {
        continue;
      }
      res.setHeader(key, value as any);
    }

    res.status(upstream.status);
    upstream.data.pipe(res);
  } catch (error) {
    next(error);
  }
}

export async function createServer() {
  const isMlRole = config.serviceRole === "ml" || config.serviceRole === "all";
  const isApiRole = config.serviceRole === "api" || config.serviceRole === "all";

  if (process.env.NODE_ENV !== "test" && isMlRole) {
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

  if (isMlRole) {
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
  }

  if (isApiRole) {
    app.use("/admin", adminRouter);
    app.use("/api/compare", compareRouter);
    app.use("/api/tryon", tryonRouter);
    app.use("/api/auth", authRouter);
    app.use("/api/cart", cartRouter);
    app.use("/api/favorites", favoritesRouter);
  }

  if (config.serviceRole === "api") {
    app.use((req, res, next) => {
      if (!isMlRoute(req.path)) {
        return next();
      }
      return proxyMlRequest(req, res, next);
    });
  }

  // Serve static files (labeling UI)
  app.use(express.static(path.join(process.cwd(), "public")));

  app.get("/", (_req, res) =>
    res.json({
      ok: true,
      serviceRole: config.serviceRole,
      routes: {
        api: isApiRole,
        ml: isMlRole,
      },
    })
  );

  // Error handling (must be last)
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
