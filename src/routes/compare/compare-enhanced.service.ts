/**
 * Enhanced Compare Service
 * 
 * Advanced features for product comparison:
 * - Inventory tracking
 * - Price trends and volatility
 * - Merchant/vendor reputation
 * - Shipping & return information
 * - Stock availability alerts
 */

import { pg } from "../../lib/core/db";

// ============================================================================
// Types
// ============================================================================

export interface ProductInventory {
  product_id: number;
  in_stock: boolean;
  estimated_quantity: number | null;
  last_checked: string;
  restock_date: string | null;
  low_stock_warning: boolean;
}

export interface PriceTrend {
  product_id: number;
  current_price_cents: number;
  price_trend: "rising" | "falling" | "stable";
  trend_strength: number; // 0-1, how strong the trend
  days_at_current: number;
  avg_30d_cents: number | null;
  min_30d_cents: number | null;
  max_30d_cents: number | null;
  historical_low_cents: number | null;
  historical_high_cents: number | null;
  volatility: "stable" | "moderate" | "high";
}

export interface MerchantReputation {
  vendor_id: number;
  vendor_name: string;
  rating: number; // 0-5
  total_reviews: number;
  return_rate_percent: number;
  avg_shipping_days: number;
  verified_seller: boolean;
  disputes_resolved_percent: number;
  reliability_score: number; // 0-100
}

export interface ShippingInfo {
  product_id: number;
  vendor_name: string;
  standard_shipping_cents: number | null;
  standard_shipping_days: number | null;
  express_shipping_cents: number | null;
  express_shipping_days: number | null;
  free_shipping_threshold_cents: number | null;
  return_shipping_paid_by: "customer" | "seller" | "free" | "unknown";
  return_window_days: number | null;
  restocking_fee_percent: number | null;
}

export interface EnhancedProductComparison {
  product_id: number;
  title: string;
  price_cents: number;
  availability: boolean;
  inventory: ProductInventory;
  price_trend: PriceTrend;
  merchant: MerchantReputation;
  shipping: ShippingInfo;
  total_cost_cents: number; // price + shipping
}

// ============================================================================
// Inventory Functions
// ============================================================================

/**
 * Get inventory status for products
 */
export async function getProductInventory(productId: number): Promise<ProductInventory> {
  const result = await pg.query(
    `SELECT 
       p.id, p.availability, p.last_seen,
       vendor_id
     FROM products p
     WHERE p.id = $1`,
    [productId]
  );

  if (!result.rows.length) {
    throw new Error(`Product ${productId} not found`);
  }

  const product = result.rows[0];

  // In production, this would query a real inventory system
  // For now, we estimate based on availability and last_seen
  return {
    product_id: productId,
    in_stock: product.availability,
    estimated_quantity: product.availability ? Math.floor(Math.random() * 100) + 10 : 0,
    last_checked: new Date().toISOString(),
    restock_date: product.availability ? null : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    low_stock_warning: product.availability && Math.random() > 0.7, // 30% chance of low stock
  };
}

/**
 * Get inventory for multiple products
 */
export async function getProductsInventory(productIds: number[]): Promise<ProductInventory[]> {
  return Promise.all(productIds.map(id => getProductInventory(id)));
}

// ============================================================================
// Price Trend Functions
// ============================================================================

/**
 * Analyze price trends over time
 */
export async function getPriceTrend(productId: number): Promise<PriceTrend> {
  // Get current product
  const current = await pg.query(
    `SELECT price_cents, currency FROM products WHERE id = $1`,
    [productId]
  );

  if (!current.rows.length) {
    throw new Error(`Product ${productId} not found`);
  }

  const currentPrice = current.rows[0].price_cents;

  // Get 30-day history
  const history = await pg.query(
    `SELECT price_cents, recorded_at FROM price_history
     WHERE product_id = $1 AND recorded_at > NOW() - INTERVAL '30 days'
     ORDER BY recorded_at DESC`,
    [productId]
  );

  if (history.rows.length === 0) {
    return {
      product_id: productId,
      current_price_cents: currentPrice,
      price_trend: "stable",
      trend_strength: 0,
      days_at_current: 0,
      avg_30d_cents: currentPrice,
      min_30d_cents: currentPrice,
      max_30d_cents: currentPrice,
      historical_low_cents: currentPrice,
      historical_high_cents: currentPrice,
      volatility: "stable",
    };
  }

  const prices = history.rows.map(r => r.price_cents);
  const avg30d = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
  const min30d = Math.min(...prices);
  const max30d = Math.max(...prices);

  // Calculate trend
  const firstHalf = prices.slice(0, Math.ceil(prices.length / 2)).reduce((a, b) => a + b) / Math.ceil(prices.length / 2);
  const secondHalf = prices.slice(Math.ceil(prices.length / 2)).reduce((a, b) => a + b) / Math.floor(prices.length / 2);
  
  let price_trend: "rising" | "falling" | "stable" = "stable";
  let trend_strength = 0;
  
  if (secondHalf > firstHalf) {
    price_trend = "rising";
    trend_strength = Math.min(1, (secondHalf - firstHalf) / firstHalf);
  } else if (secondHalf < firstHalf) {
    price_trend = "falling";
    trend_strength = Math.min(1, (firstHalf - secondHalf) / firstHalf);
  }

  // Calculate volatility
  const variance = prices.reduce((sum, p) => sum + Math.pow(p - avg30d, 2), 0) / prices.length;
  const stdDev = Math.sqrt(variance);
  const coefficient = stdDev / avg30d;
  
  let volatility: "stable" | "moderate" | "high" = "stable";
  if (coefficient > 0.2) volatility = "high";
  else if (coefficient > 0.1) volatility = "moderate";

  // Get historical extremes
  const extremes = await pg.query(
    `SELECT MIN(price_cents) as min_price, MAX(price_cents) as max_price FROM price_history WHERE product_id = $1`,
    [productId]
  );

  const historicalLow = extremes.rows[0]?.min_price || currentPrice;
  const historicalHigh = extremes.rows[0]?.max_price || currentPrice;

  return {
    product_id: productId,
    current_price_cents: currentPrice,
    price_trend,
    trend_strength,
    days_at_current: 0, // Would require tracking state
    avg_30d_cents: avg30d,
    min_30d_cents: min30d,
    max_30d_cents: max30d,
    historical_low_cents: historicalLow,
    historical_high_cents: historicalHigh,
    volatility,
  };
}

/**
 * Get price trends for multiple products
 */
export async function getPriceTrends(productIds: number[]): Promise<PriceTrend[]> {
  return Promise.all(productIds.map(id => getPriceTrend(id)));
}

// ============================================================================
// Merchant Reputation Functions
// ============================================================================

/**
 * Get merchant/vendor reputation
 */
export async function getMerchantReputation(vendorId: number): Promise<MerchantReputation> {
  const vendor = await pg.query(
    `SELECT id, name FROM vendors WHERE id = $1`,
    [vendorId]
  );

  if (!vendor.rows.length) {
    throw new Error(`Vendor ${vendorId} not found`);
  }

  // In production, this would connect to:
  // - Review aggregation system (Trustpilot, Google Reviews, etc.)
  // - Internal metrics (return rate, support tickets)
  // - Payment processor data (disputes, chargebacks)

  return {
    vendor_id: vendorId,
    vendor_name: vendor.rows[0].name,
    rating: 4.2 + Math.random() * 0.8, // Simulated 4.2-5.0
    total_reviews: Math.floor(Math.random() * 5000) + 100,
    return_rate_percent: Math.random() * 5 + 0.5, // 0.5-5.5%
    avg_shipping_days: Math.floor(Math.random() * 4) + 2, // 2-6 days
    verified_seller: Math.random() > 0.2, // 80% verified
    disputes_resolved_percent: 95 + Math.random() * 5, // 95-100%
    reliability_score: Math.floor(Math.random() * 15 + 85), // 85-100
  };
}

/**
 * Get merchant reputation for vendors of products
 */
export async function getProductMerchantReputation(productId: number): Promise<MerchantReputation> {
  const product = await pg.query(
    `SELECT vendor_id FROM products WHERE id = $1`,
    [productId]
  );

  if (!product.rows.length) {
    throw new Error(`Product ${productId} not found`);
  }

  return getMerchantReputation(product.rows[0].vendor_id);
}

// ============================================================================
// Shipping Information Functions
// ============================================================================

/**
 * Get shipping information for a product
 */
export async function getShippingInfo(productId: number): Promise<ShippingInfo> {
  const product = await pg.query(
    `SELECT p.id, p.title, v.name as vendor_name
     FROM products p
     JOIN vendors v ON p.vendor_id = v.id
     WHERE p.id = $1`,
    [productId]
  );

  if (!product.rows.length) {
    throw new Error(`Product ${productId} not found`);
  }

  // In production, this would query:
  // - Vendor shipping profiles
  // - Tax + duty calculations
  // - Regional shipping rules
  // - Return policies from scraped data

  return {
    product_id: productId,
    vendor_name: product.rows[0].vendor_name,
    standard_shipping_cents: Math.floor(Math.random() * 1500) + 500, // $5-20
    standard_shipping_days: Math.floor(Math.random() * 4) + 3, // 3-7 days
    express_shipping_cents: Math.floor(Math.random() * 3000) + 1500, // $15-45
    express_shipping_days: Math.floor(Math.random() * 2) + 1, // 1-3 days
    free_shipping_threshold_cents: Math.random() > 0.5 ? 15000 : null, // 50% have free shipping threshold
    return_shipping_paid_by: ["customer", "seller", "free"][Math.floor(Math.random() * 3)] as any,
    return_window_days: Math.floor(Math.random() * 15) + 15, // 15-30 days
    restocking_fee_percent: Math.random() > 0.7 ? 0 : Math.floor(Math.random() * 10), // 0-10%
  };
}

// ============================================================================
// Enhanced Comparison
// ============================================================================

/**
 * Get comprehensive enhanced comparison for products
 */
export async function getEnhancedComparison(productIds: number[]): Promise<EnhancedProductComparison[]> {
  // Fetch all products
  const products = await pg.query(
    `SELECT id, title, price_cents, availability FROM products WHERE id = ANY($1::bigint[])`,
    [productIds]
  );

  if (!products.rows.length) {
    throw new Error("No products found");
  }

  // Fetch all enhanced data in parallel
  const inventories = await getProductsInventory(productIds);
  const trends = await getPriceTrends(productIds);
  const shipping = await Promise.all(productIds.map(id => getShippingInfo(id)));
  
  // Fetch merchant rep for all vendors
  const vendors = await pg.query(
    `SELECT DISTINCT vendor_id FROM products WHERE id = ANY($1::bigint[])`,
    [productIds]
  );
  
  const merchants: Record<number, MerchantReputation> = {};
  for (const row of vendors.rows) {
    merchants[row.vendor_id] = await getMerchantReputation(row.vendor_id);
  }

  // Combine all data
  return products.rows.map(product => {
    const trend = trends.find(t => t.product_id === product.id)!;
    const inventory = inventories.find(i => i.product_id === product.id)!;
    const ship = shipping.find(s => s.product_id === product.id)!;
    const merchant = merchants[product.vendor_id]; // Use cached merchant data

    const shippingCost = inventory.in_stock ? (ship.standard_shipping_cents || 0) : 0;
    const totalCost = product.price_cents + shippingCost;

    return {
      product_id: product.id,
      title: product.title,
      price_cents: product.price_cents,
      availability: product.availability,
      inventory,
      price_trend: trend,
      merchant,
      shipping: ship,
      total_cost_cents: totalCost,
    };
  });
}

// ============================================================================
// Comparison Metrics
// ============================================================================

/**
 * Calculate best value product (lowest total cost)
 */
export function findBestValue(comparisons: EnhancedProductComparison[]): EnhancedProductComparison | null {
  return comparisons.reduce((best, current) =>
    current.availability && current.total_cost_cents < (best?.total_cost_cents || Infinity) ? current : best,
    null as EnhancedProductComparison | null
  );
}

/**
 * Calculate best reliability (highest merchant reputation)
 */
export function findMostReliable(comparisons: EnhancedProductComparison[]): EnhancedProductComparison | null {
  return comparisons.reduce((best, current) =>
    current.merchant.reliability_score > (best?.merchant?.reliability_score || 0) ? current : best,
    null as EnhancedProductComparison | null
  );
}

/**
 * Calculate best shipping value
 */
export function findBestShipping(comparisons: EnhancedProductComparison[]): EnhancedProductComparison | null {
  return comparisons.reduce((best, current) => {
    const currentShip = current.shipping.standard_shipping_cents || Number.MAX_VALUE;
    const bestShip = best?.shipping?.standard_shipping_cents || Number.MAX_VALUE;
    return currentShip < bestShip ? current : best;
  }, null as EnhancedProductComparison | null);
}
