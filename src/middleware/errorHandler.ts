import { Request, Response, NextFunction } from "express";

/**
 * Global error handler middleware
 */
export function errorHandler(
  err: Error & { statusCode?: number },
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  const status = err.statusCode || 500;
  console.error("Error:", err.message);
  if (status === 500) console.error(err.stack);

  res.status(status).json({
    success: false,
    error: status === 500 && process.env.NODE_ENV === "production"
      ? "Internal server error"
      : err.message,
  });
}

/**
 * Handle 404 - Route not found
 */
export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({
    success: false,
    error: "Route not found",
  });
}
