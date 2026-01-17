/**
 * Recommendations Library
 * 
 * Exports for recommendation system training data collection
 */
export {
  logImpressionBatch,
  logImpression,
  saveLabel,
  saveLabelsBatch,
  getRecommendationsForLabeling,
  getLabeledData,
  getLabelStats,
  getImpressionStats,
  type RecommendationImpression,
  type LabelData,
  type LabelQueryParams,
  type RecommendationWithLabel,
  type LogImpressionBatchParams,
} from "./logger";
