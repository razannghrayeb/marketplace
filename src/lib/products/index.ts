/**
 * Products Module Exports
 * 
 * Product-related business logic: canonical grouping, price history.
 */

// Canonical products
export {
  hammingDistance,
  isPHashSimilar,
  levenshteinDistance,
  titleSimilarity,
  normalizeTitle,
  findMatchingCanonical,
  createCanonical,
  attachToCanonical,
  updateCanonicalStats,
  processProductCanonical,
  recomputeAllCanonicals,
  mergeCanonicals,
  getCanonicalWithProducts,
  findSimilarByPHash,
  type CanonicalProduct,
  type CanonicalMatch,
} from "./canonical";

// Variants (parent product + SKU rows)
export {
  getVariantsByProductIds,
  getDefaultVariant,
  type ProductVariantRow,
} from "./productVariants";

// Price history
export {
  recordPrice,
  recordPricesBatch,
  takePriceSnapshot,
  getPriceHistory,
  getPriceStats,
  getPriceHistoryDaily,
  findPriceDrops,
  type PriceRecord,
  type PriceStats,
} from "./priceHistory";
// Re-export services from routes/products to keep service logic in routes
export * from "../../routes/products/canonical.service";
export * from "../../routes/products/priceHistory.service";
