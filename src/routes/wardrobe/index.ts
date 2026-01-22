/**
 * Wardrobe Module Exports
 * 
 * Structure:
 * - wardrobe.routes.ts    - Route definitions
 * - wardrobe.controller.ts - HTTP handlers
 * - *.service.ts          - Business logic
 */
export { wardrobeRouter } from "./wardrobe.routes";

// Re-export services for external use
export * from "./wardrobe.service";
export * from "./styleProfile.service";
export * from "./compatibility.service";
export * from "./gaps.service";
export * from "./recommendations.service";
