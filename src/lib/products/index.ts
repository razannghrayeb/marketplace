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
} from "./canonical.js";

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
} from "./priceHistory.js";
