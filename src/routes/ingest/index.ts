/**
 * Ingest Module Exports
 * 
 * Structure:
 * - ingest.routes.ts     - Route definitions
 * - ingest.controller.ts - HTTP handlers
 * - ingest.service.ts    - Business logic
 */
export { ingestRouter } from "./ingest.routes";

// Re-export services for external use
export * from "./ingest.service";
