"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rateLimit = rateLimit;
exports.cleanupRateLimiter = cleanupRateLimiter;
const requestCounts = new Map();
/**
 * Simple in-memory rate limiter
 * For production, use Redis-based rate limiting
 */
function rateLimit(options = {}) {
    const { windowMs = 60000, maxRequests = 100 } = options;
    return (req, res, next) => {
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
function cleanupRateLimiter() {
    const now = Date.now();
    for (const [ip, record] of requestCounts.entries()) {
        if (now > record.resetTime) {
            requestCounts.delete(ip);
        }
    }
}
