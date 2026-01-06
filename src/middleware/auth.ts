import { Request, Response, NextFunction } from "express";

/**
 * Simple API key authentication middleware
 * Checks for X-API-Key header
 */
export function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers["x-api-key"];
  const expectedKey = process.env.API_KEY;

  // Skip auth if no API_KEY is configured
  if (!expectedKey) {
    return next();
  }

  if (!apiKey) {
    return res.status(401).json({
      success: false,
      error: "API key is required. Provide X-API-Key header.",
    });
  }

  if (apiKey !== expectedKey) {
    return res.status(403).json({
      success: false,
      error: "Invalid API key.",
    });
  }

  next();
}

/**
 * Optional auth - doesn't block if no key provided
 */
export function optionalApiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers["x-api-key"];
  const expectedKey = process.env.API_KEY;

  if (expectedKey && apiKey && apiKey !== expectedKey) {
    return res.status(403).json({
      success: false,
      error: "Invalid API key.",
    });
  }

  next();
}
