/**
 * Alert Generator
 *
 * After each nightly crawl, this function:
 *   1. Loads all available products from the database
 *   2. Calculates the DSR score for every product (in parallel)
 *   3. Creates new alerts in the vendor_alerts table when:
 *        - A product enters "early risk" (DSR 34–66)  → alert_type = "early_risk"
 *        - A product enters "critical"  (DSR 67–100) → alert_type = "critical"
 *        - A product recovers to "green" (DSR 0–33)
 *          AND it previously had an active risk alert  → alert_type = "recovery"
 *   4. Skips creating a duplicate if an active (non-dismissed) alert of the
 *      same type already exists for that product.
 */

import { pg } from "../core";
import { calculateDsr } from "./dsr";

// ─── Return type ──────────────────────────────────────────────────────────────

export interface AlertGeneratorResult {
  created: number;   // new alerts written to DB
  skipped: number;   // products that needed no new alert
  errors: number;    // products whose DSR calculation failed
}

// ─── Main function ────────────────────────────────────────────────────────────

export async function generateAlerts(): Promise<AlertGeneratorResult> {
  // ── Step 1: Load all available products ──────────────────────────────────
  const { rows: products } = await pg.query<{ id: number; title: string }>(
    `SELECT id, title
     FROM products
     WHERE availability = true
     LIMIT 500`,
  );

  if (products.length === 0) {
    return { created: 0, skipped: 0, errors: 0 };
  }

  // ── Step 2: Load all currently active alerts in one query ─────────────────
  //
  // "Active" means dismissed = false.
  // We build a Map: productId → Set of alert types that are already active.
  // This lets us skip creating duplicates without extra DB calls per product.
  //
  // Note: we fetch ALL non-dismissed alerts rather than filtering by productIds
  // to avoid a BIGINT/text array type mismatch with the ANY($1) operator.
  const { rows: existingAlerts } = await pg.query<{
    product_id: string; // pg returns BIGINT as string
    alert_type: string;
  }>(
    `SELECT product_id, alert_type
     FROM vendor_alerts
     WHERE dismissed = false`,
  );

  const activeAlertMap = new Map<string, Set<string>>();
  for (const row of existingAlerts) {
    const key = String(row.product_id);
    if (!activeAlertMap.has(key)) {
      activeAlertMap.set(key, new Set());
    }
    activeAlertMap.get(key)!.add(row.alert_type);
  }

  // ── Step 3: Calculate DSR for every product in parallel ───────────────────
  const dsrResults = await Promise.allSettled(
    products.map((p) => calculateDsr(p.id)),
  );

  // ── Step 4: Decide which alerts to create ─────────────────────────────────
  const toInsert: Array<{
    product_id: number;
    alert_type: string;
    message: string;
  }> = [];

  let errors = 0;

  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    const outcome = dsrResults[i];

    // DSR calculation failed — skip this product
    if (outcome.status === "rejected") {
      console.error(
        `[alertGenerator] DSR failed for product ${product.id}:`,
        outcome.reason,
      );
      errors++;
      continue;
    }

    const dsr = outcome.value;
    const activeTypes = activeAlertMap.get(String(product.id)) ?? new Set<string>();

    if (dsr.dsr_score >= 67) {
      // ── Critical risk ──────────────────────────────────────────────────────
      if (!activeTypes.has("critical")) {
        toInsert.push({
          product_id: product.id,
          alert_type: "critical",
          message: `"${product.title}" has a critical dead-stock risk score of ${dsr.dsr_score}. Main concern: ${dsr.top_reason}. Immediate action recommended — consider discounting or promoting this item.`,
        });
      }
    } else if (dsr.dsr_score >= 34) {
      // ── Early risk ────────────────────────────────────────────────────────
      if (!activeTypes.has("early_risk")) {
        toInsert.push({
          product_id: product.id,
          alert_type: "early_risk",
          message: `"${product.title}" is showing early dead-stock risk (score ${dsr.dsr_score}). Main concern: ${dsr.top_reason}.`,
        });
      }
    } else {
      // ── Green (low risk) — check for recovery ─────────────────────────────
      //
      // A "recovery" alert is only useful if the product WAS at risk before.
      // We detect this by checking whether there is still an active early_risk
      // or critical alert for this product that has not been dismissed yet.
      const hadRisk =
        activeTypes.has("early_risk") || activeTypes.has("critical");

      if (hadRisk && !activeTypes.has("recovery")) {
        toInsert.push({
          product_id: product.id,
          alert_type: "recovery",
          message: `"${product.title}" has recovered — dead-stock risk score dropped to ${dsr.dsr_score} (low risk). No immediate action needed.`,
        });
      }
    }
  }

  // ── Step 5: Batch-insert all new alerts in a single query ─────────────────
  if (toInsert.length === 0) {
    return {
      created: 0,
      skipped: products.length - errors,
      errors,
    };
  }

  const values = toInsert
    .map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`)
    .join(", ");

  const params = toInsert.flatMap((a) => [
    a.product_id,
    a.alert_type,
    a.message,
  ]);

  await pg.query(
    `INSERT INTO vendor_alerts (product_id, alert_type, message)
     VALUES ${values}`,
    params,
  );

  console.log(
    `[alertGenerator] Created ${toInsert.length} alerts, skipped ${products.length - toInsert.length - errors}, errors ${errors}`,
  );

  return {
    created: toInsert.length,
    skipped: products.length - toInsert.length - errors,
    errors,
  };
}
