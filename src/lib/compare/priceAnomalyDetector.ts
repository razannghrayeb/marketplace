/**
 * Price Anomaly Detection
 * 
 * Lebanon-specific pricing rules:
 * - Detects fake discounts
 * - Identifies abnormal pricing vs market
 * - Flags unstable price patterns
 * 
 * Works with USD-normalized prices internally.
 */

import { pg } from "../core";

// ============================================================================
// Types
// ============================================================================

export interface PriceAnomaly {
  product_id: number;
  anomaly_type: AnomalyType;
  severity: "high" | "medium" | "low";
  details: string;
  value?: number;
}

export type AnomalyType = 
  | "high_volatility"      // Price changes > 25% in 7-14 days
  | "too_low"              // Price < 70% of category median
  | "suspicious_low"       // Price 70-85% of category median
  | "too_high"             // Price > 150% of category median
  | "discount_spam"        // Frequent discount changes
  | "fake_discount"        // Sale price == original or suspicious pattern
  | "price_spike"          // Sudden unexplained price increase
  | "unstable";            // General instability

export interface PriceAnalysis {
  product_id: number;
  current_price_usd: number;
  
  // Stability analysis
  stability: "stable" | "moderate" | "high_risk";
  volatility_percent: number;      // Max price swing in period
  price_changes_7d: number;        // Number of changes in 7 days
  price_changes_30d: number;       // Number of changes in 30 days
  
  // Market position
  market_position: "normal" | "below_market" | "suspicious_low" | "above_market" | "premium" | "unknown";
  category_median_usd?: number;
  percentile_in_category?: number; // 0-100, where product falls
  
  // Discount analysis
  discount_behavior: "none" | "normal" | "frequent" | "suspicious";
  has_current_discount: boolean;
  current_discount_percent?: number;
  discount_frequency_30d: number;  // How many times discount changed
  
  // Anomalies found
  anomalies: PriceAnomaly[];
  
  // Overall risk score
  risk_score: number;              // 0-100 (higher = more risky)
  risk_level: "green" | "yellow" | "red";
}

export interface CategoryBaseline {
  category: string;
  median_price_usd: number;
  q1_price_usd: number;            // 25th percentile
  q3_price_usd: number;            // 75th percentile
  iqr_usd: number;                 // Interquartile range
  min_normal_usd: number;          // Q1 - 1.5*IQR
  max_normal_usd: number;          // Q3 + 1.5*IQR
  product_count: number;
  computed_at: Date;
}

// ============================================================================
// Configuration
// ============================================================================

const LBP_TO_USD = 89000;  // Approximate exchange rate

const THRESHOLDS = {
  // Volatility
  HIGH_VOLATILITY_PERCENT: 25,     // Flag if price changes > 25% in period
  MODERATE_VOLATILITY_PERCENT: 15,
  
  // Market position
  TOO_LOW_RATIO: 0.70,             // < 70% of median = too good to be true
  SUSPICIOUS_LOW_RATIO: 0.85,      // 70-85% = suspicious
  TOO_HIGH_RATIO: 1.50,            // > 150% of median = overpriced
  PREMIUM_RATIO: 1.25,             // 125-150% = premium but not suspicious
  
  // Discount spam
  DISCOUNT_SPAM_COUNT_7D: 3,       // > 3 discount changes in 7 days
  DISCOUNT_SPAM_COUNT_30D: 6,      // > 6 discount changes in 30 days
  
  // Fake discount
  MIN_REAL_DISCOUNT_PERCENT: 5,    // Discount must be > 5% to be "real"
};

// ============================================================================
// Price Normalization
// ============================================================================

/**
 * Convert price to USD
 */
export function normalizeToUSD(priceCents: number, currency: string): number {
  if (currency.toUpperCase() === "USD") {
    return priceCents / 100;
  }
  // Assume LBP
  return priceCents / LBP_TO_USD / 100;
}

// ============================================================================
// Category Baselines
// ============================================================================

/**
 * Get cached category baseline (computed weekly)
 */
export async function getCategoryBaseline(category: string): Promise<CategoryBaseline | null> {
  const result = await pg.query(
    `SELECT * FROM category_price_baselines 
     WHERE category = $1 
     ORDER BY computed_at DESC 
     LIMIT 1`,
    [category.toLowerCase()]
  );
  
  if (result.rowCount === 0) return null;
  return result.rows[0];
}

/**
 * Compute category baseline (run weekly as job)
 */
export async function computeCategoryBaseline(category: string): Promise<CategoryBaseline> {
  // Get all active product prices in category
  const result = await pg.query(
    `SELECT 
       CASE 
         WHEN currency = 'USD' THEN price_cents / 100.0
         ELSE price_cents / $2 / 100.0
       END as price_usd
     FROM products 
     WHERE LOWER(category) = LOWER($1) 
       AND is_hidden = false 
       AND price_cents > 0
     ORDER BY price_usd`,
    [category, LBP_TO_USD]
  );
  
  const prices = result.rows.map((r: any) => r.price_usd as number);
  
  if (prices.length === 0) {
    throw new Error(`No products found in category: ${category}`);
  }
  
  // Calculate statistics
  const sorted = prices.sort((a, b) => a - b);
  const n = sorted.length;
  
  const median = n % 2 === 0 
    ? (sorted[n/2 - 1] + sorted[n/2]) / 2 
    : sorted[Math.floor(n/2)];
  
  const q1Index = Math.floor(n * 0.25);
  const q3Index = Math.floor(n * 0.75);
  const q1 = sorted[q1Index];
  const q3 = sorted[q3Index];
  const iqr = q3 - q1;
  
  const baseline: CategoryBaseline = {
    category: category.toLowerCase(),
    median_price_usd: Math.round(median * 100) / 100,
    q1_price_usd: Math.round(q1 * 100) / 100,
    q3_price_usd: Math.round(q3 * 100) / 100,
    iqr_usd: Math.round(iqr * 100) / 100,
    min_normal_usd: Math.round(Math.max(0, q1 - 1.5 * iqr) * 100) / 100,
    max_normal_usd: Math.round((q3 + 1.5 * iqr) * 100) / 100,
    product_count: n,
    computed_at: new Date(),
  };
  
  // Upsert into database
  await pg.query(
    `INSERT INTO category_price_baselines 
     (category, median_price_usd, q1_price_usd, q3_price_usd, iqr_usd, min_normal_usd, max_normal_usd, product_count, computed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (category) DO UPDATE SET
       median_price_usd = EXCLUDED.median_price_usd,
       q1_price_usd = EXCLUDED.q1_price_usd,
       q3_price_usd = EXCLUDED.q3_price_usd,
       iqr_usd = EXCLUDED.iqr_usd,
       min_normal_usd = EXCLUDED.min_normal_usd,
       max_normal_usd = EXCLUDED.max_normal_usd,
       product_count = EXCLUDED.product_count,
       computed_at = NOW()`,
    [
      baseline.category,
      baseline.median_price_usd,
      baseline.q1_price_usd,
      baseline.q3_price_usd,
      baseline.iqr_usd,
      baseline.min_normal_usd,
      baseline.max_normal_usd,
      baseline.product_count,
    ]
  );
  
  return baseline;
}

/**
 * Compute all category baselines (weekly job)
 */
export async function computeAllCategoryBaselines(): Promise<{ computed: number; errors: string[] }> {
  const categories = await pg.query(
    `SELECT DISTINCT LOWER(category) as category 
     FROM products 
     WHERE category IS NOT NULL AND is_hidden = false`
  );
  
  let computed = 0;
  const errors: string[] = [];
  
  for (const row of categories.rows) {
    try {
      await computeCategoryBaseline(row.category);
      computed++;
    } catch (err) {
      errors.push(`${row.category}: ${err}`);
    }
  }
  
  return { computed, errors };
}

// ============================================================================
// Price History Analysis
// ============================================================================

interface PriceHistoryRow {
  price_cents: number;
  currency: string;
  sales_price_cents: number | null;
  recorded_at: Date;
}

/**
 * Get price history for analysis
 */
async function getPriceHistoryForAnalysis(
  productId: number, 
  days: number = 30
): Promise<PriceHistoryRow[]> {
  const result = await pg.query(
    `SELECT price_cents, currency, sales_price_cents, recorded_at
     FROM price_history 
     WHERE product_id = $1 
       AND recorded_at > NOW() - INTERVAL '${days} days'
     ORDER BY recorded_at DESC`,
    [productId]
  );
  return result.rows;
}

/**
 * Analyze price volatility
 */
function analyzeVolatility(
  history: PriceHistoryRow[],
  days: number = 14
): { volatility_percent: number; changes: number } {
  if (history.length < 2) {
    return { volatility_percent: 0, changes: 0 };
  }
  
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  
  const relevantHistory = history.filter(h => h.recorded_at >= cutoff);
  if (relevantHistory.length < 2) {
    return { volatility_percent: 0, changes: 0 };
  }
  
  // Convert to USD for comparison
  const prices = relevantHistory.map(h => normalizeToUSD(h.price_cents, h.currency));
  
  const maxPrice = Math.max(...prices);
  const minPrice = Math.min(...prices);
  const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
  
  // Volatility as % of average
  const volatility = avgPrice > 0 ? ((maxPrice - minPrice) / avgPrice) * 100 : 0;
  
  // Count price changes
  let changes = 0;
  for (let i = 1; i < prices.length; i++) {
    if (Math.abs(prices[i] - prices[i-1]) > 0.01) {
      changes++;
    }
  }
  
  return { 
    volatility_percent: Math.round(volatility * 10) / 10,
    changes 
  };
}

/**
 * Analyze discount patterns
 */
function analyzeDiscounts(
  history: PriceHistoryRow[],
  currentSalePrice: number | null,
  currentPrice: number
): { 
  behavior: "none" | "normal" | "frequent" | "suspicious";
  frequency_30d: number;
  is_fake_discount: boolean;
  discount_percent?: number;
} {
  // Count how many times sale price changed
  let discountChanges = 0;
  let hadDiscount = false;
  
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1];
    const curr = history[i];
    
    const prevHasDiscount =
      prev.sales_price_cents !== null && prev.sales_price_cents < prev.price_cents;
    const currHasDiscount =
      curr.sales_price_cents !== null && curr.sales_price_cents < curr.price_cents;
    
    if (prevHasDiscount !== currHasDiscount) {
      discountChanges++;
    }
    if (currHasDiscount) hadDiscount = true;
  }
  
  // Check if current discount is fake
  let is_fake_discount = false;
  let discount_percent: number | undefined;
  
  if (currentSalePrice !== null && currentPrice > 0) {
    discount_percent = Math.round(((currentPrice - currentSalePrice) / currentPrice) * 100);
    
    // Fake discount patterns:
    // 1. Discount < 5%
    // 2. Sale price == original price
    if (discount_percent < THRESHOLDS.MIN_REAL_DISCOUNT_PERCENT || currentSalePrice >= currentPrice) {
      is_fake_discount = true;
    }
  }
  
  // Determine behavior
  let behavior: "none" | "normal" | "frequent" | "suspicious";
  if (discountChanges === 0 && !hadDiscount && currentSalePrice === null) {
    behavior = "none";
  } else if (discountChanges <= 2) {
    behavior = "normal";
  } else if (discountChanges <= THRESHOLDS.DISCOUNT_SPAM_COUNT_30D) {
    behavior = "frequent";
  } else {
    behavior = "suspicious";
  }
  
  return {
    behavior,
    frequency_30d: discountChanges,
    is_fake_discount,
    discount_percent,
  };
}

// ============================================================================
// Main Analysis Function
// ============================================================================

/**
 * Analyze price for anomalies
 */
export async function analyzePriceAnomalies(productId: number): Promise<PriceAnalysis> {
  // Get current product data
  const productResult = await pg.query(
    `SELECT id, price_cents, currency, sales_price_cents, category
     FROM products WHERE id = $1`,
    [productId]
  );
  
  if (productResult.rowCount === 0) {
    throw new Error(`Product ${productId} not found`);
  }
  
  const product = productResult.rows[0];
  const currentPriceUSD = normalizeToUSD(product.price_cents, product.currency);
  
  // Get price history
  const history = await getPriceHistoryForAnalysis(productId, 30);
  
  // Analyze volatility
  const vol14d = analyzeVolatility(history, 14);
  const vol7d = analyzeVolatility(history, 7);
  
  // Analyze discounts
  const discountAnalysis = analyzeDiscounts(
    history,
    product.sales_price_cents,
    product.price_cents
  );
  
  // Get category baseline
  let baseline: CategoryBaseline | null = null;
  let market_position: PriceAnalysis["market_position"] = "unknown";
  let percentile: number | undefined;
  
  if (product.category) {
    baseline = await getCategoryBaseline(product.category);
    
    if (baseline && baseline.median_price_usd > 0) {
      const ratio = currentPriceUSD / baseline.median_price_usd;
      
      if (ratio < THRESHOLDS.TOO_LOW_RATIO) {
        market_position = "suspicious_low";
      } else if (ratio < THRESHOLDS.SUSPICIOUS_LOW_RATIO) {
        market_position = "below_market";
      } else if (ratio > THRESHOLDS.TOO_HIGH_RATIO) {
        market_position = "above_market";
      } else if (ratio > THRESHOLDS.PREMIUM_RATIO) {
        market_position = "premium";
      } else {
        market_position = "normal";
      }
      
      // Estimate percentile
      if (currentPriceUSD <= baseline.q1_price_usd) {
        percentile = 25 * (currentPriceUSD / baseline.q1_price_usd);
      } else if (currentPriceUSD <= baseline.median_price_usd) {
        percentile = 25 + 25 * ((currentPriceUSD - baseline.q1_price_usd) / (baseline.median_price_usd - baseline.q1_price_usd));
      } else if (currentPriceUSD <= baseline.q3_price_usd) {
        percentile = 50 + 25 * ((currentPriceUSD - baseline.median_price_usd) / (baseline.q3_price_usd - baseline.median_price_usd));
      } else {
        percentile = 75 + 25 * Math.min(1, (currentPriceUSD - baseline.q3_price_usd) / baseline.iqr_usd);
      }
      percentile = Math.round(Math.min(100, Math.max(0, percentile)));
    }
  }
  
  // Determine stability
  let stability: "stable" | "moderate" | "high_risk";
  if (vol14d.volatility_percent >= THRESHOLDS.HIGH_VOLATILITY_PERCENT) {
    stability = "high_risk";
  } else if (vol14d.volatility_percent >= THRESHOLDS.MODERATE_VOLATILITY_PERCENT) {
    stability = "moderate";
  } else {
    stability = "stable";
  }
  
  // Collect anomalies
  const anomalies: PriceAnomaly[] = [];
  
  // Rule A: High volatility
  if (vol14d.volatility_percent >= THRESHOLDS.HIGH_VOLATILITY_PERCENT) {
    anomalies.push({
      product_id: productId,
      anomaly_type: "high_volatility",
      severity: "high",
      details: `Price changed ${vol14d.volatility_percent}% in 14 days`,
      value: vol14d.volatility_percent,
    });
  }
  
  // Rule B: Market position
  if (market_position === "suspicious_low") {
    anomalies.push({
      product_id: productId,
      anomaly_type: "too_low",
      severity: "high",
      details: `Price ${Math.round((currentPriceUSD / (baseline?.median_price_usd || 1)) * 100)}% of category median (too good to be true)`,
      value: currentPriceUSD,
    });
  } else if (market_position === "below_market") {
    anomalies.push({
      product_id: productId,
      anomaly_type: "suspicious_low",
      severity: "medium",
      details: `Price ${Math.round((currentPriceUSD / (baseline?.median_price_usd || 1)) * 100)}% of category median`,
      value: currentPriceUSD,
    });
  } else if (market_position === "above_market") {
    anomalies.push({
      product_id: productId,
      anomaly_type: "too_high",
      severity: "low",
      details: `Price ${Math.round((currentPriceUSD / (baseline?.median_price_usd || 1)) * 100)}% of category median`,
      value: currentPriceUSD,
    });
  }
  
  // Rule C: Discount spam
  if (discountAnalysis.behavior === "suspicious") {
    anomalies.push({
      product_id: productId,
      anomaly_type: "discount_spam",
      severity: "high",
      details: `Discount changed ${discountAnalysis.frequency_30d} times in 30 days`,
      value: discountAnalysis.frequency_30d,
    });
  } else if (discountAnalysis.behavior === "frequent") {
    anomalies.push({
      product_id: productId,
      anomaly_type: "discount_spam",
      severity: "medium",
      details: `Frequent discount changes (${discountAnalysis.frequency_30d} in 30 days)`,
      value: discountAnalysis.frequency_30d,
    });
  }
  
  // Fake discount
  if (discountAnalysis.is_fake_discount) {
    anomalies.push({
      product_id: productId,
      anomaly_type: "fake_discount",
      severity: "medium",
      details: discountAnalysis.discount_percent !== undefined && discountAnalysis.discount_percent < 5
        ? `Minimal discount of only ${discountAnalysis.discount_percent}%`
        : "Sale price equals or exceeds original price",
      value: discountAnalysis.discount_percent,
    });
  }
  
  // Calculate risk score
  let risk_score = 0;
  for (const anomaly of anomalies) {
    switch (anomaly.severity) {
      case "high": risk_score += 35; break;
      case "medium": risk_score += 20; break;
      case "low": risk_score += 10; break;
    }
  }
  
  // Add base risk for instability
  if (stability === "high_risk") risk_score += 15;
  else if (stability === "moderate") risk_score += 5;
  
  risk_score = Math.min(100, risk_score);
  
  // Determine risk level
  let risk_level: "green" | "yellow" | "red";
  if (risk_score >= 50) risk_level = "red";
  else if (risk_score >= 25) risk_level = "yellow";
  else risk_level = "green";
  
  return {
    product_id: productId,
    current_price_usd: Math.round(currentPriceUSD * 100) / 100,
    stability,
    volatility_percent: vol14d.volatility_percent,
    price_changes_7d: vol7d.changes,
    price_changes_30d: history.length > 0 ? history.length - 1 : 0,
    market_position,
    category_median_usd: baseline?.median_price_usd,
    percentile_in_category: percentile,
    discount_behavior: discountAnalysis.behavior,
    has_current_discount: product.sales_price_cents !== null,
    current_discount_percent: discountAnalysis.discount_percent,
    discount_frequency_30d: discountAnalysis.frequency_30d,
    anomalies,
    risk_score,
    risk_level,
  };
}

/**
 * Get price analysis label for UI
 */
export function getPriceLabel(analysis: PriceAnalysis): string {
  if (analysis.risk_level === "red") {
    return "Price Risk Detected";
  } else if (analysis.risk_level === "yellow") {
    return "Some Price Concerns";
  } else {
    return "Price Stable";
  }
}

/**
 * Get price reasons for UI
 */
export function getPriceReasons(analysis: PriceAnalysis): string[] {
  const reasons: string[] = [];
  
  // Stability
  if (analysis.stability === "stable") {
    reasons.push("Price has been stable");
  } else if (analysis.stability === "moderate") {
    reasons.push(`Price varies moderately (${analysis.volatility_percent}% range)`);
  } else {
    reasons.push(`High price volatility (${analysis.volatility_percent}% range)`);
  }
  
  // Market position
  if (analysis.market_position === "normal") {
    reasons.push("Price is in normal range for category");
  } else if (analysis.market_position === "suspicious_low") {
    reasons.push("Price unusually low for category (verify quality)");
  } else if (analysis.market_position === "below_market") {
    reasons.push("Below average price for category");
  } else if (analysis.market_position === "premium") {
    reasons.push("Premium pricing for category");
  }
  
  // Discount
  if (analysis.discount_behavior === "suspicious") {
    reasons.push("Frequent discount changes detected");
  } else if (analysis.anomalies.some(a => a.anomaly_type === "fake_discount")) {
    reasons.push("Current discount appears minimal");
  }
  
  return reasons;
}
