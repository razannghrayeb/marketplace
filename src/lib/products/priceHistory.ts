/**
 * Price History Service
 * 
 * Handles price tracking, snapshots, and history queries.
 */
import { pg } from "../core";

// ============================================================================
// Types
// ============================================================================

export interface PriceRecord {
  id: number;
  product_id: number;
  price_cents: number;
  currency: string;
  sale_price_cents: number | null;
  availability: boolean;
  recorded_at: Date;
}

export interface PriceStats {
  current_price: number;
  lowest_price: number;
  highest_price: number;
  average_price: number;
  price_change_30d: number | null;
  price_trend: "up" | "down" | "stable";
}

// ============================================================================
// Record Price
// ============================================================================

/**
 * Record a price snapshot for a product
 */
export async function recordPrice(
  productId: number,
  priceCents: number,
  currency: string = "LBP",
  salePriceCents?: number | null,
  availability: boolean = true
): Promise<PriceRecord> {
  const result = await pg.query(
    `INSERT INTO price_history (product_id, price_cents, currency, sale_price_cents, availability)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [productId, priceCents, currency, salePriceCents, availability]
  );
  return result.rows[0];
}

/**
 * Record prices for multiple products (batch)
 */
export async function recordPricesBatch(
  products: Array<{
    id: number;
    price_cents: number;
    currency: string;
    sale_price_cents?: number | null;
    availability: boolean;
  }>
): Promise<number> {
  if (products.length === 0) return 0;

  const values: any[] = [];
  const placeholders: string[] = [];
  let paramIndex = 1;

  for (const p of products) {
    placeholders.push(`($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`);
    values.push(p.id, p.price_cents, p.currency, p.sale_price_cents ?? null, p.availability);
  }

  const result = await pg.query(
    `INSERT INTO price_history (product_id, price_cents, currency, sale_price_cents, availability)
     VALUES ${placeholders.join(", ")}`,
    values
  );

  return result.rowCount ?? 0;
}

/**
 * Take a snapshot of all product prices (scheduled job)
 */
export async function takePriceSnapshot(): Promise<{ recorded: number }> {
  const products = await pg.query(
    `SELECT id, price_cents, currency, sales_price_cents, availability 
     FROM products 
     WHERE is_hidden = false AND price_cents IS NOT NULL`
  );

  const batch = products.rows.map((p) => ({
    id: p.id,
    price_cents: p.price_cents,
    currency: p.currency || "LBP",
    sale_price_cents: p.sales_price_cents,
    availability: p.availability ?? true,
  }));

  const recorded = await recordPricesBatch(batch);
  return { recorded };
}

// ============================================================================
// Query Price History
// ============================================================================

/**
 * Get price history for a product
 */
export async function getPriceHistory(
  productId: number,
  options: { days?: number; limit?: number } = {}
): Promise<PriceRecord[]> {
  const { days = 90, limit = 100 } = options;

  const result = await pg.query(
    `SELECT * FROM price_history 
     WHERE product_id = $1 AND recorded_at > NOW() - INTERVAL '${days} days'
     ORDER BY recorded_at DESC
     LIMIT $2`,
    [productId, limit]
  );

  return result.rows;
}

/**
 * Get price statistics for a product
 */
export async function getPriceStats(productId: number): Promise<PriceStats | null> {
  // Current price
  const currentResult = await pg.query(
    `SELECT price_cents FROM products WHERE id = $1`,
    [productId]
  );

  if (currentResult.rowCount === 0) return null;

  const currentPrice = currentResult.rows[0].price_cents;

  // Historical stats (last 90 days)
  const statsResult = await pg.query(
    `SELECT 
       MIN(price_cents) as lowest,
       MAX(price_cents) as highest,
       AVG(price_cents)::INTEGER as average
     FROM price_history 
     WHERE product_id = $1 AND recorded_at > NOW() - INTERVAL '90 days'`,
    [productId]
  );

  // Price 30 days ago
  const price30dResult = await pg.query(
    `SELECT price_cents FROM price_history 
     WHERE product_id = $1 AND recorded_at > NOW() - INTERVAL '30 days'
     ORDER BY recorded_at ASC
     LIMIT 1`,
    [productId]
  );

  const stats = statsResult.rows[0];
  const price30dAgo = price30dResult.rows[0]?.price_cents;

  let priceChange30d = null;
  let trend: "up" | "down" | "stable" = "stable";

  if (price30dAgo) {
    priceChange30d = currentPrice - price30dAgo;
    const changePercent = (priceChange30d / price30dAgo) * 100;
    if (changePercent > 5) trend = "up";
    else if (changePercent < -5) trend = "down";
  }

  return {
    current_price: currentPrice,
    lowest_price: stats.lowest ?? currentPrice,
    highest_price: stats.highest ?? currentPrice,
    average_price: stats.average ?? currentPrice,
    price_change_30d: priceChange30d,
    price_trend: trend,
  };
}

/**
 * Get price history aggregated by day
 */
export async function getPriceHistoryDaily(
  productId: number,
  days = 30
): Promise<Array<{ date: string; min_price: number; max_price: number; avg_price: number }>> {
  const result = await pg.query(
    `SELECT 
       DATE(recorded_at) as date,
       MIN(price_cents) as min_price,
       MAX(price_cents) as max_price,
       AVG(price_cents)::INTEGER as avg_price
     FROM price_history 
     WHERE product_id = $1 AND recorded_at > NOW() - INTERVAL '${days} days'
     GROUP BY DATE(recorded_at)
     ORDER BY date DESC`,
    [productId]
  );

  return result.rows;
}

// ============================================================================
// Price Alerts
// ============================================================================

/**
 * Check for significant price drops (for alerts)
 */
export async function findPriceDrops(
  thresholdPercent = 10,
  sinceDays = 1
): Promise<Array<{ product_id: number; old_price: number; new_price: number; drop_percent: number }>> {
  const result = await pg.query(
    `WITH recent_prices AS (
       SELECT DISTINCT ON (product_id)
         product_id, price_cents as new_price
       FROM price_history
       WHERE recorded_at > NOW() - INTERVAL '${sinceDays} days'
       ORDER BY product_id, recorded_at DESC
     ),
     older_prices AS (
       SELECT DISTINCT ON (product_id)
         product_id, price_cents as old_price
       FROM price_history
       WHERE recorded_at BETWEEN NOW() - INTERVAL '${sinceDays + 7} days' AND NOW() - INTERVAL '${sinceDays} days'
       ORDER BY product_id, recorded_at DESC
     )
     SELECT 
       r.product_id,
       o.old_price,
       r.new_price,
       ROUND(((o.old_price - r.new_price)::FLOAT / o.old_price) * 100, 2) as drop_percent
     FROM recent_prices r
     JOIN older_prices o ON o.product_id = r.product_id
     WHERE o.old_price > r.new_price
       AND ((o.old_price - r.new_price)::FLOAT / o.old_price) * 100 >= $1`,
    [thresholdPercent]
  );

  return result.rows;
}
