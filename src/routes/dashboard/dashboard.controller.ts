/**
 * Dashboard Routes & Controller
 *
 * Defines all the URL endpoints for the business dashboard.
 * Receives requests, calls the service, sends back the response.
 *
 * Base path: /api/dashboard
 */

import { Router, Request, Response } from "express";
import {
  getSummary,
  getAllProductsWithDsr,
  getProductSignals,
  getAlerts,
  dismissAlert,
} from "./dashboard.service";
import { generateAlerts } from "../../lib/dsr/alertGenerator";

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/dashboard/summary
//
// Returns the 4 stat cards at the top of the dashboard:
//   - total products at risk
//   - total critical products
//   - estimated value at risk
//   - alerts resolved this week
// ─────────────────────────────────────────────────────────────────────────────
router.get("/summary", async (_req: Request, res: Response) => {
  try {
    const summary = await getSummary();
    res.json({ ok: true, data: summary });
  } catch (err) {
    console.error("[dashboard] summary error:", err);
    res.status(500).json({ ok: false, error: "Failed to load dashboard summary" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/dashboard/products
//
// Returns all products with their DSR score and risk level.
// Supports optional query filters:
//   ?risk_level=yellow   (all / green / yellow / red)
//   ?category=dresses
//   ?sort=highest_risk   (highest_risk / lowest_risk / newest)
// ─────────────────────────────────────────────────────────────────────────────
router.get("/products", async (req: Request, res: Response) => {
  try {
    const { risk_level, category, sort } = req.query as Record<string, string>;

    const products = await getAllProductsWithDsr({ risk_level, category, sort });

    res.json({
      ok: true,
      count: products.length,
      data: products,
    });
  } catch (err) {
    console.error("[dashboard] products error:", err);
    res.status(500).json({ ok: false, error: "Failed to load products" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/dashboard/products/:id/signals
//
// Returns the full 5-signal breakdown for one product.
// The frontend shows this when a vendor clicks on a product row.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/products/:id/signals", async (req: Request, res: Response) => {
  try {
    const productId = Number(req.params.id);

    if (!Number.isInteger(productId) || productId <= 0) {
      return res.status(400).json({ ok: false, error: "Invalid product ID" });
    }

    const signals = await getProductSignals(productId);

    if (!signals) {
      return res.status(404).json({ ok: false, error: "Product not found" });
    }

    res.json({ ok: true, data: signals });
  } catch (err) {
    console.error("[dashboard] signals error:", err);
    res.status(500).json({ ok: false, error: "Failed to load product signals" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/dashboard/alerts
//
// Returns all active (non-dismissed) alerts, ordered by severity.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/alerts", async (_req: Request, res: Response) => {
  try {
    const alerts = await getAlerts();
    res.json({ ok: true, count: alerts.length, data: alerts });
  } catch (err) {
    console.error("[dashboard] alerts error:", err);
    res.status(500).json({ ok: false, error: "Failed to load alerts" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/dashboard/alerts/:id/dismiss
//
// Marks one alert as dismissed so it disappears from the dashboard.
// ─────────────────────────────────────────────────────────────────────────────
router.post("/alerts/:id/dismiss", async (req: Request, res: Response) => {
  try {
    const alertId = Number(req.params.id);

    if (!Number.isInteger(alertId) || alertId <= 0) {
      return res.status(400).json({ ok: false, error: "Invalid alert ID" });
    }

    const dismissed = await dismissAlert(alertId);

    if (!dismissed) {
      return res.status(404).json({ ok: false, error: "Alert not found" });
    }

    res.json({ ok: true, message: "Alert dismissed" });
  } catch (err) {
    console.error("[dashboard] dismiss error:", err);
    res.status(500).json({ ok: false, error: "Failed to dismiss alert" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/dashboard/alerts/generate
//
// Manually triggers alert generation. Useful for testing without waiting for
// the nightly crawl to run. In production this runs automatically after crawl.
// ─────────────────────────────────────────────────────────────────────────────
router.post("/alerts/generate", async (_req: Request, res: Response) => {
  try {
    console.log("[dashboard] Manual alert generation triggered");
    const result = await generateAlerts();
    res.json({ ok: true, data: result });
  } catch (err) {
    console.error("[dashboard] alert generation error:", err);
    res.status(500).json({ ok: false, error: "Failed to generate alerts" });
  }
});

export default router;
