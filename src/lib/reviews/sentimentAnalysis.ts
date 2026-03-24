/**
 * User Reviews Integration with Sentiment Analysis
 * 
 * Adds review analysis dimension to product comparison
 * including sentiment scoring and review quality assessment.
 */

import { pg } from "../core/db";

// ============================================================================
// Types
// ============================================================================

export interface ReviewSignals {
  averageRating: number | null;
  reviewCount: number;
  sentimentScore: number;           // -1 to 1
  verifiedPurchaseRatio: number;    // 0 to 1
  recentRatingTrend: "improving" | "stable" | "declining";
  qualityIndicators: QualityIndicators;
}

export interface QualityIndicators {
  hasDetailedReviews: boolean;      // Reviews > 100 chars
  hasPhotoReviews: boolean;
  fitMentions: FitMention[];
  commonPraises: string[];
  commonComplaints: string[];
}

export interface FitMention {
  type: "true_to_size" | "runs_small" | "runs_large";
  count: number;
  percentage: number;
}

export interface ReviewAnalysis {
  signals: ReviewSignals;
  score: number;                    // 0-100
  level: "green" | "yellow" | "red";
  summary: string;
}

// ============================================================================
// Sentiment Analysis
// ============================================================================

// Positive keywords with weights
const POSITIVE_KEYWORDS: Record<string, number> = {
  "love": 0.8, "amazing": 0.8, "excellent": 0.9, "perfect": 0.9,
  "great": 0.7, "beautiful": 0.8, "quality": 0.6, "comfortable": 0.7,
  "recommend": 0.7, "happy": 0.6, "impressed": 0.7, "soft": 0.5,
  "flattering": 0.8, "worth": 0.6, "best": 0.8, "gorgeous": 0.8,
  "adorable": 0.7, "stylish": 0.6, "cute": 0.5, "lovely": 0.7,
  "stunning": 0.8, "fantastic": 0.8, "pleased": 0.6, "satisfied": 0.6,
};

// Negative keywords with weights
const NEGATIVE_KEYWORDS: Record<string, number> = {
  "disappointed": -0.8, "terrible": -0.9, "awful": -0.9, "poor": -0.7,
  "cheap": -0.6, "return": -0.5, "refund": -0.5, "waste": -0.7,
  "broke": -0.7, "damaged": -0.7, "defective": -0.8, "wrong": -0.5,
  "bad": -0.6, "horrible": -0.8, "hate": -0.8, "uncomfortable": -0.7,
  "tight": -0.4, "loose": -0.4, "small": -0.3, "large": -0.3,
  "flimsy": -0.6, "thin": -0.4, "scratchy": -0.5, "rough": -0.5,
};

// Fit-related patterns
const FIT_PATTERNS = {
  true_to_size: [
    /true to size/i, /fits (perfectly|great|well)/i, /as expected/i,
    /fits true/i, /accurate sizing/i, /perfect fit/i,
  ],
  runs_small: [
    /runs small/i, /size up/i, /too (small|tight)/i, /snug/i,
    /order (one|a) size (up|larger)/i, /smaller than expected/i,
  ],
  runs_large: [
    /runs (large|big)/i, /size down/i, /too (large|big|loose)/i,
    /order (one|a) size (down|smaller)/i, /bigger than expected/i,
  ],
};

/**
 * Calculate sentiment score for a review text
 */
export function calculateSentimentScore(text: string): number {
  if (!text) return 0;
  
  const words = text.toLowerCase().split(/\s+/);
  let totalScore = 0;
  let matches = 0;
  
  for (const word of words) {
    if (POSITIVE_KEYWORDS[word]) {
      totalScore += POSITIVE_KEYWORDS[word];
      matches++;
    }
    if (NEGATIVE_KEYWORDS[word]) {
      totalScore += NEGATIVE_KEYWORDS[word];
      matches++;
    }
  }
  
  // Normalize to -1 to 1 range
  if (matches === 0) return 0;
  return Math.max(-1, Math.min(1, totalScore / matches));
}

/**
 * Detect fit mentions in review text
 */
function detectFitMentions(text: string): "true_to_size" | "runs_small" | "runs_large" | null {
  for (const [type, patterns] of Object.entries(FIT_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        return type as "true_to_size" | "runs_small" | "runs_large";
      }
    }
  }
  return null;
}

/**
 * Extract common themes from reviews
 */
function extractThemes(reviews: string[], type: "positive" | "negative"): string[] {
  const keywords = type === "positive" ? POSITIVE_KEYWORDS : NEGATIVE_KEYWORDS;
  const counts: Record<string, number> = {};
  
  for (const review of reviews) {
    const words = review.toLowerCase().split(/\s+/);
    for (const word of words) {
      if (keywords[word]) {
        counts[word] = (counts[word] || 0) + 1;
      }
    }
  }
  
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);
}

// ============================================================================
// Review Analysis
// ============================================================================

/**
 * Analyze reviews for a product
 */
export async function analyzeProductReviews(
  productId: number
): Promise<ReviewAnalysis> {
  // Fetch reviews from database
  const reviewsResult = await pg.query<{
    rating: number;
    text: string;
    verified_purchase: boolean;
    has_photos: boolean;
    created_at: Date;
  }>(
    `SELECT rating, text, verified_purchase, has_photos, created_at
     FROM product_reviews
     WHERE product_id = $1
     ORDER BY created_at DESC`,
    [productId]
  );
  
  const reviews = reviewsResult.rows;
  
  if (reviews.length === 0) {
    return {
      signals: {
        averageRating: null,
        reviewCount: 0,
        sentimentScore: 0,
        verifiedPurchaseRatio: 0,
        recentRatingTrend: "stable",
        qualityIndicators: {
          hasDetailedReviews: false,
          hasPhotoReviews: false,
          fitMentions: [],
          commonPraises: [],
          commonComplaints: [],
        },
      },
      score: 50,
      level: "yellow",
      summary: "No reviews available",
    };
  }
  
  // Calculate basic metrics
  const avgRating = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
  const verifiedCount = reviews.filter(r => r.verified_purchase).length;
  const photoCount = reviews.filter(r => r.has_photos).length;
  
  // Calculate sentiment
  const sentiments = reviews.map(r => calculateSentimentScore(r.text));
  const avgSentiment = sentiments.reduce((a, b) => a + b, 0) / sentiments.length;
  
  // Analyze fit mentions
  const fitCounts: Record<string, number> = {
    true_to_size: 0,
    runs_small: 0,
    runs_large: 0,
  };
  
  for (const review of reviews) {
    const fit = detectFitMentions(review.text);
    if (fit) fitCounts[fit]++;
  }
  
  const totalFitMentions = Object.values(fitCounts).reduce((a, b) => a + b, 0);
  const fitMentions: FitMention[] = Object.entries(fitCounts)
    .filter(([, count]) => count > 0)
    .map(([type, count]) => ({
      type: type as FitMention["type"],
      count,
      percentage: totalFitMentions > 0 ? count / totalFitMentions : 0,
    }));
  
  // Calculate trend
  const recentReviews = reviews.slice(0, Math.min(10, reviews.length));
  const olderReviews = reviews.slice(Math.min(10, reviews.length));
  
  let trend: "improving" | "stable" | "declining" = "stable";
  if (recentReviews.length >= 5 && olderReviews.length >= 5) {
    const recentAvg = recentReviews.reduce((s, r) => s + r.rating, 0) / recentReviews.length;
    const olderAvg = olderReviews.reduce((s, r) => s + r.rating, 0) / olderReviews.length;
    
    if (recentAvg - olderAvg > 0.3) trend = "improving";
    else if (olderAvg - recentAvg > 0.3) trend = "declining";
  }
  
  // Extract themes
  const positiveReviews = reviews.filter(r => r.rating >= 4).map(r => r.text);
  const negativeReviews = reviews.filter(r => r.rating <= 2).map(r => r.text);
  
  const commonPraises = extractThemes(positiveReviews, "positive");
  const commonComplaints = extractThemes(negativeReviews, "negative");
  
  // Build signals
  const signals: ReviewSignals = {
    averageRating: avgRating,
    reviewCount: reviews.length,
    sentimentScore: avgSentiment,
    verifiedPurchaseRatio: verifiedCount / reviews.length,
    recentRatingTrend: trend,
    qualityIndicators: {
      hasDetailedReviews: reviews.some(r => r.text.length > 100),
      hasPhotoReviews: photoCount > 0,
      fitMentions,
      commonPraises,
      commonComplaints,
    },
  };
  
  // Calculate overall score
  const score = calculateReviewScore(signals);
  const level = score >= 70 ? "green" : score >= 45 ? "yellow" : "red";
  
  // Generate summary
  const summary = generateReviewSummary(signals);
  
  return { signals, score, level, summary };
}

/**
 * Calculate review score (0-100)
 */
function calculateReviewScore(signals: ReviewSignals): number {
  if (signals.reviewCount === 0) return 50;
  
  let score = 50; // Base score
  
  // Rating contribution (up to +30)
  if (signals.averageRating !== null) {
    score += (signals.averageRating - 2.5) * 12;
  }
  
  // Review count bonus (up to +10)
  score += Math.min(10, signals.reviewCount / 10);
  
  // Sentiment contribution (up to +10)
  score += signals.sentimentScore * 10;
  
  // Verified purchase bonus (up to +5)
  score += signals.verifiedPurchaseRatio * 5;
  
  // Trend adjustment
  if (signals.recentRatingTrend === "improving") score += 3;
  if (signals.recentRatingTrend === "declining") score -= 5;
  
  // Quality indicators
  if (signals.qualityIndicators.hasDetailedReviews) score += 2;
  if (signals.qualityIndicators.hasPhotoReviews) score += 3;
  
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Generate human-readable review summary
 */
function generateReviewSummary(signals: ReviewSignals): string {
  if (signals.reviewCount === 0) {
    return "No customer reviews yet.";
  }
  
  const parts: string[] = [];
  
  // Rating
  if (signals.averageRating !== null) {
    parts.push(`${signals.averageRating.toFixed(1)}★ from ${signals.reviewCount} reviews`);
  }
  
  // Sentiment
  if (signals.sentimentScore > 0.3) {
    parts.push("customers are very satisfied");
  } else if (signals.sentimentScore > 0) {
    parts.push("generally positive feedback");
  } else if (signals.sentimentScore < -0.3) {
    parts.push("mixed reviews with some concerns");
  }
  
  // Fit
  const dominantFit = signals.qualityIndicators.fitMentions
    .sort((a, b) => b.count - a.count)[0];
  
  if (dominantFit && dominantFit.percentage > 0.5) {
    const fitText: Record<string, string> = {
      true_to_size: "fits true to size",
      runs_small: "runs small (consider sizing up)",
      runs_large: "runs large (consider sizing down)",
    };
    parts.push(fitText[dominantFit.type]);
  }
  
  // Trend
  if (signals.recentRatingTrend === "improving") {
    parts.push("recent reviews trending positive");
  } else if (signals.recentRatingTrend === "declining") {
    parts.push("recent reviews show some concerns");
  }
  
  return parts.join(". ") + ".";
}

// ============================================================================
// Comparison Integration
// ============================================================================

/**
 * Get review comparison for multiple products
 */
export async function compareProductReviews(
  productIds: number[]
): Promise<Map<number, ReviewAnalysis>> {
  const results = new Map<number, ReviewAnalysis>();
  
  await Promise.all(
    productIds.map(async (id) => {
      const analysis = await analyzeProductReviews(id);
      results.set(id, analysis);
    })
  );
  
  return results;
}

/**
 * Score reviews relative to competitors
 */
export async function getRelativeReviewScore(
  productId: number,
  categoryId: number
): Promise<{ score: number; percentile: number }> {
  // Get category average
  const avgResult = await pg.query<{ avg_rating: string; avg_count: string }>(
    `SELECT 
       AVG(r.rating) as avg_rating,
       AVG(review_counts.count) as avg_count
     FROM products p
     JOIN (
       SELECT product_id, AVG(rating) as rating
       FROM product_reviews
       GROUP BY product_id
     ) r ON r.product_id = p.id
     JOIN (
       SELECT product_id, COUNT(*) as count
       FROM product_reviews
       GROUP BY product_id
     ) review_counts ON review_counts.product_id = p.id
     WHERE p.category_id = $1`,
    [categoryId]
  );
  
  const productAnalysis = await analyzeProductReviews(productId);
  
  const categoryAvgRating = parseFloat(avgResult.rows[0]?.avg_rating || "3");
  const productRating = productAnalysis.signals.averageRating || 0;
  
  // Calculate percentile
  const percentileResult = await pg.query<{ percentile: string }>(
    `SELECT 
       (COUNT(*) FILTER (WHERE avg_rating < $1) * 100.0 / NULLIF(COUNT(*), 0)) as percentile
     FROM (
       SELECT product_id, AVG(rating) as avg_rating
       FROM product_reviews
       WHERE product_id IN (SELECT id FROM products WHERE category_id = $2)
       GROUP BY product_id
     ) sub`,
    [productRating, categoryId]
  );
  
  return {
    score: productAnalysis.score,
    percentile: parseFloat(percentileResult.rows[0]?.percentile || "50"),
  };
}

// ============================================================================
// Database Setup
// ============================================================================

/**
 * Ensure reviews table exists
 */
export async function ensureReviewsTable(): Promise<void> {
  await pg.query(`
    CREATE TABLE IF NOT EXISTS product_reviews (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL,
      user_id INTEGER,
      rating SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
      text TEXT,
      verified_purchase BOOLEAN DEFAULT false,
      has_photos BOOLEAN DEFAULT false,
      helpful_votes INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      
      CONSTRAINT fk_product FOREIGN KEY (product_id) REFERENCES products(id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_reviews_product ON product_reviews (product_id);
    CREATE INDEX IF NOT EXISTS idx_reviews_rating ON product_reviews (product_id, rating);
    CREATE INDEX IF NOT EXISTS idx_reviews_created ON product_reviews (created_at DESC);
  `);
}
