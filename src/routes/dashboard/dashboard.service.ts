/**
 * Dashboard Service
 *
 * Fetches data from the database, calls the DSR calculator,
 * and returns formatted results to the controller.
 */

import { pg } from "../../lib/core";
import { calculateDsr } from "../../lib/dsr/dsr";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DashboardProduct {
  id: number;
  title: string;
  category: string | null;
  image_url: string | null;
  price_cents: number;
  currency: string;
  vendor_name: string;
  days_listed: number;
  dsr_score: number;
  risk_level: "green" | "yellow" | "red";
  top_reason: string;
}

export interface DashboardSummary {
  total_at_risk: number;       // DSR 34-66
  total_critical: number;      // DSR 67-100
  value_at_risk_cents: number; // sum of prices of at-risk products
  alerts_resolved_this_week: number;
}

export interface DashboardAlert {
  id: number;
  product_id: number;
  product_title: string;
  alert_type: "early_risk" | "critical" | "recovery";
  message: string;
  dismissed: boolean;
  created_at: string;
}

// ─── Summary ─────────────────────────────────────────────────────────────────

export async function getSummary(): Promise<DashboardSummary> {
  // Get all products with their DSR scores
  const products = await getAllProductsWithDsr();

  const atRisk = products.filter((p) => p.dsr_score >= 34 && p.dsr_score <= 66);
  const critical = products.filter((p) => p.dsr_score >= 67);

  const value_at_risk_cents = [...atRisk, ...critical].reduce(
    (sum, p) => sum + Number(p.price_cents),
    0,
  );

  // Count alerts dismissed this week
  const { rows: resolvedRows } = await pg.query<{ count: string }>(
    `SELECT COUNT(*) AS count
     FROM vendor_alerts
     WHERE dismissed = true
       AND created_at >= NOW() - INTERVAL '7 days'`,
  );

  return {
    total_at_risk: atRisk.length,
    total_critical: critical.length,
    value_at_risk_cents,
    alerts_resolved_this_week: Number(resolvedRows[0]?.count ?? 0),
  };
}

// ─── Products with DSR scores ─────────────────────────────────────────────────

export async function getAllProductsWithDsr(filters?: {
  risk_level?: string;
  category?: string;
  sort?: string;
}): Promise<DashboardProduct[]> {
  // Fetch all available products from the database
  const { rows } = await pg.query<{
    id: number;
    title: string;
    category: string | null;
    image_url: string | null;
    price_cents: number;
    currency: string;
    vendor_name: string;
    first_seen: string | null;
  }>(
    `SELECT
       p.id,
       p.title,
       p.category,
       p.image_url,
       p.price_cents,
       p.currency,
       v.name AS vendor_name,
       MIN(ph.recorded_at) AS first_seen
     FROM products p
     JOIN vendors v ON v.id = p.vendor_id
     LEFT JOIN price_history ph ON ph.product_id = p.id
     WHERE p.availability = true
     GROUP BY p.id, v.name
     ORDER BY p.id
     LIMIT 200`,
  );

  // Calculate DSR for every product in parallel (faster than one by one)
  const withScores = await Promise.all(
    rows.map(async (row) => {
      const dsr = await calculateDsr(row.id);

      const firstSeen = row.first_seen ? new Date(row.first_seen) : new Date();
      const daysListed = Math.floor(
        (Date.now() - firstSeen.getTime()) / (1000 * 60 * 60 * 24),
      );

      return {
        id: row.id,
        title: row.title,
        category: row.category,
        image_url: row.image_url,
        price_cents: row.price_cents,
        currency: row.currency,
        vendor_name: row.vendor_name,
        days_listed: daysListed,
        dsr_score: dsr.dsr_score,
        risk_level: dsr.risk_level,
        top_reason: dsr.top_reason,
      } satisfies DashboardProduct;
    }),
  );

  let result = withScores;

  // Apply filters if provided
  if (filters?.risk_level && filters.risk_level !== "all") {
    result = result.filter((p) => p.risk_level === filters.risk_level);
  }
  if (filters?.category && filters.category !== "all") {
    result = result.filter((p) => p.category === filters.category);
  }

  // Apply sorting
  if (filters?.sort === "lowest_risk") {
    result.sort((a, b) => a.dsr_score - b.dsr_score);
  } else if (filters?.sort === "newest") {
    result.sort((a, b) => a.days_listed - b.days_listed);
  } else {
    // Default: highest risk first
    result.sort((a, b) => b.dsr_score - a.dsr_score);
  }

  return result;
}

// ─── Signal breakdown for one product ────────────────────────────────────────

export async function getProductSignals(productId: number) {
  // Check product exists
  const { rows } = await pg.query<{ id: number; title: string }>(
    `SELECT id, title FROM products WHERE id = $1`,
    [productId],
  );

  if (rows.length === 0) return null;

  const dsr = await calculateDsr(productId);

  return {
    product_id: productId,
    product_title: rows[0].title,
    dsr_score: dsr.dsr_score,
    risk_level: dsr.risk_level,
    signals: dsr.signals,
  };
}

// ─── Alerts ───────────────────────────────────────────────────────────────────

export async function getAlerts(): Promise<DashboardAlert[]> {
  const { rows } = await pg.query<{
    id: number;
    product_id: number;
    product_title: string;
    alert_type: string;
    message: string;
    dismissed: boolean;
    created_at: string;
  }>(
    `SELECT
       a.id,
       a.product_id,
       p.title AS product_title,
       a.alert_type,
       a.message,
       a.dismissed,
       a.created_at
     FROM vendor_alerts a
     JOIN products p ON p.id = a.product_id
     WHERE a.dismissed = false
     ORDER BY
       CASE a.alert_type
         WHEN 'critical'   THEN 1
         WHEN 'early_risk' THEN 2
         WHEN 'recovery'   THEN 3
       END,
       a.created_at DESC
     LIMIT 50`,
  );

  return rows as DashboardAlert[];
}

export async function dismissAlert(alertId: number): Promise<boolean> {
  const { rowCount } = await pg.query(
    `UPDATE vendor_alerts SET dismissed = true WHERE id = $1`,
    [alertId],
  );
  return (rowCount ?? 0) > 0;
}
