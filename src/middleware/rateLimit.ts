import { Request, Response, NextFunction } from "express";

const requestCounts = new Map<string, { count: number; resetTime: number }>();

interface RateLimitOptions {
  windowMs?: number;  // Time window in ms (default: 1 minute)
  maxRequests?: number;  // Max requests per window (default: 100)
}

/**
 * Simple in-memory rate limiter
 * For production, use Redis-based rate limiting
 */
export function rateLimit(options: RateLimitOptions = {}) {
  const { windowMs = 60000, maxRequests = 100 } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();

    const record = requestCounts.get(ip);

    if (!record || now > record.resetTime) {
      // New window
      requestCounts.set(ip, { count: 1, resetTime: now + windowMs });
      return next();
    }

    if (record.count >= maxRequests) {
      return res.status(429).json({
        success: false,
        error: "Too many requests. Please try again later.",
        retryAfter: Math.ceil((record.resetTime - now) / 1000),
      });
    }

    record.count++;
    next();
  };
}

/**
 * Clean up old entries periodically (call on interval)
 */
export function cleanupRateLimiter() {
  const now = Date.now();
  for (const [ip, record] of requestCounts.entries()) {
    if (now > record.resetTime) {
      requestCounts.delete(ip);
    }
  }
}
