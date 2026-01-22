"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = errorHandler;
exports.notFoundHandler = notFoundHandler;
/**
 * Global error handler middleware
 */
function errorHandler(err, _req, res, _next) {
    console.error("Error:", err.message);
    console.error(err.stack);
    res.status(500).json({
        success: false,
        error: process.env.NODE_ENV === "production"
            ? "Internal server error"
            : err.message,
    });
}
/**
 * Handle 404 - Route not found
 */
function notFoundHandler(_req, res) {
    res.status(404).json({
        success: false,
        error: "Route not found",
    });
}
