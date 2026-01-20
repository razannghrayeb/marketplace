/**
 * Labeling Module Exports
 * 
 * Structure:
 * - labeling.routes.ts     - Route definitions
 * - labeling.controller.ts - HTTP handlers
 * - labeling.service.ts    - Business logic (reference data)
 * 
 * Services live in this module under `labeling.service.ts`.
 */
export { labelingRouter } from "./labeling.routes";

// Re-export services for external use
export * from "./labeling.service";
