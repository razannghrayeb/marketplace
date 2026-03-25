import { Request, Response, NextFunction } from "express";

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Global error handler middleware
 */
export function errorHandler(
  err: Error & { statusCode?: number },
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  let status = typeof err.statusCode === "number" ? err.statusCode : 500;
  let message = err.message || "Error";
  let code: string | undefined;

  const pgCode = (err as NodeJS.ErrnoException & { code?: string }).code;
  if (pgCode === "42P01" && /tryon_jobs|tryon_saved/i.test(message)) {
    status = 503;
    code = "TRYON_DB_NOT_MIGRATED";
    message =
      "Try-on database is not initialized. Apply migration db/migrations/007_virtual_tryon.sql on your Postgres database.";
  } else if (
    /Virtual try-on is not configured/i.test(message) &&
    /GCLOUD_PROJECT|GOOGLE_CLOUD_PROJECT/i.test(message)
  ) {
    status = 503;
    code = "TRYON_NOT_CONFIGURED";
  }

  console.error("Error:", message);
  if (status >= 500) console.error(err.stack);

  const hideDetails = status === 500 && isProduction();
  const clientMessage = hideDetails ? "Internal server error" : message;

  res.status(status).json({
    success: false,
    error: {
      message: clientMessage,
      ...(code ? { code } : {}),
    },
  });
}

/**
 * Handle 404 - Route not found
 */
export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({
    success: false,
    error: { message: "Route not found" },
  });
}
