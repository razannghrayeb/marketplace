/**
 * DSR (Dead Stock Risk) Score Calculator
 *
 * Takes a product and returns a score from 0-100.
 *   0-33  = green  (healthy)
 *   34-66 = yellow (at risk)
 *   67-100= red    (critical)
 *
 * Built from 5 signals using data already in the database.
 * No sales or cart data is needed.
 */

import { pg } from "../core";

// ─── Types ───────────────────────────────────────────────────────────────────

export type RiskLevel = "green" | "yellow" | "red";

export interface SignalResult {
  score: number;       // 0-100 (higher = more risk)
  explanation: string; // plain English sentence shown to vendor
}

export interface DsrResult {
  product_id: number;
  dsr_score: number;
  risk_level: RiskLevel;
  top_reason: string;  // the single biggest risk factor
  signals: {
    listing_age: SignalResult;
    price_movement: SignalResult;
    category_velocity: SignalResult;
    search_visibility: SignalResult;
    quality_score: SignalResult;
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clamp(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function riskLevel(score: number): RiskLevel {
  if (score <= 33) return "green";
  if (score <= 66) return "yellow";
  return "red";
}

// ─── Signal 1: Listing Age (weight 30%) ──────────────────────────────────────
// How many days has this product been in our database?
// The older it is with no price recovery, the higher the risk.

async function listingAgeSignal(productId: number): Promise<SignalResult> {
  // Find the very first time we ever recorded this product (earliest price history entry)
  const { rows } = await pg.query<{ first_seen: string }>(
    `SELECT MIN(recorded_at) AS first_seen
     FROM price_history
     WHERE product_id = $1`,
    [productId],
  );

  const firstSeen = rows[0]?.first_seen ? new Date(rows[0].first_seen) : new Date();
  const daysListed = Math.floor((Date.now() - firstSeen.getTime()) / (1000 * 60 * 60 * 24));

  // 0 days = 0 score, 90+ days = 100 score
  const score = clamp((daysListed / 90) * 100);

  let explanation: string;
  if (daysListed <= 14) {
    explanation = `Listed ${daysListed} days ago — still new.`;
  } else if (daysListed <= 30) {
    explanation = `Listed ${daysListed} days ago — approaching the average listing duration.`;
  } else if (daysListed <= 60) {
    explanation = `Listed ${daysListed} days ago — longer than average for most categories.`;
  } else {
    explanation = `Listed ${daysListed} days ago — significantly overdue for action.`;
  }

  return { score, explanation };
}

// ─── Signal 2: Price Movement (weight 25%) ───────────────────────────────────
// Has the price been dropping repeatedly with no recovery?
// Repeated drops with no recovery = strong dead stock signal.

async function priceMovementSignal(productId: number): Promise<SignalResult> {
  const { rows } = await pg.query<{ price_cents: number; recorded_at: string }>(
    `SELECT price_cents, recorded_at
     FROM price_history
     WHERE product_id = $1
     ORDER BY recorded_at ASC`,
    [productId],
  );

  if (rows.length < 2) {
    return { score: 0, explanation: "Not enough price history to analyze." };
  }

  let drops = 0;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].price_cents < rows[i - 1].price_cents) {
      drops++;
    }
  }

  // 0 drops = 0 score, 4+ drops = 100 score
  const score = clamp((drops / 4) * 100);

  let explanation: string;
  if (drops === 0) {
    explanation = "Price has been stable — no markdowns detected.";
  } else if (drops === 1) {
    explanation = "Price dropped once — monitor to see if it recovers.";
  } else if (drops === 2) {
    explanation = `Price dropped ${drops} times — possible demand weakness.`;
  } else {
    explanation = `Price dropped ${drops} times with no recovery — strong dead stock signal.`;
  }

  return { score, explanation };
}

// ─── Signal 3: Category Velocity (weight 25%) ────────────────────────────────
// Are other products in the same category being actively updated?
// Low activity in a category = the category is trending down.

async function categoryVelocitySignal(productId: number): Promise<SignalResult> {
  // Get this product's category
  const { rows: productRows } = await pg.query<{ category: string | null }>(
    `SELECT category FROM products WHERE id = $1`,
    [productId],
  );

  const category = productRows[0]?.category;

  if (!category) {
    return { score: 50, explanation: "No category set — cannot measure category activity." };
  }

  // Count how many products in the same category were updated in the last 7 days
  const { rows: activeRows } = await pg.query<{ active_count: string }>(
    `SELECT COUNT(*) AS active_count
     FROM products
     WHERE category = $1
       AND last_seen >= NOW() - INTERVAL '7 days'`,
    [category],
  );

  const activeCount = Number(activeRows[0]?.active_count ?? 0);

  // 20+ active products in category = healthy, 0 = dead category
  // Invert: fewer active = higher risk
  const score = clamp(100 - (activeCount / 20) * 100);

  let explanation: string;
  if (activeCount >= 20) {
    explanation = `"${category}" is an active category — ${activeCount} products updated this week.`;
  } else if (activeCount >= 10) {
    explanation = `"${category}" is moderately active — ${activeCount} products updated this week.`;
  } else if (activeCount >= 1) {
    explanation = `"${category}" is slow — only ${activeCount} product(s) updated this week.`;
  } else {
    explanation = `"${category}" has no recent activity — category may be trending down.`;
  }

  return { score, explanation };
}

// ─── Signal 4: Search Visibility (weight 15%) ────────────────────────────────
// Does this product have good enough data to appear in search?
// We use the quality score as a proxy since we don't have click data.

async function searchVisibilitySignal(productId: number): Promise<SignalResult> {
  const { rows } = await pg.query<{ quality_score: number | null }>(
    `SELECT quality_score
     FROM product_quality_scores
     WHERE product_id = $1
     LIMIT 1`,
    [productId],
  );

  const qualityScore = rows[0]?.quality_score ?? null;

  if (qualityScore === null) {
    return {
      score: 40,
      explanation: "No quality analysis available — search visibility unknown.",
    };
  }

  // High quality = high visibility = low risk. Invert it.
  const score = clamp(100 - qualityScore);

  let explanation: string;
  if (qualityScore >= 70) {
    explanation = `Good listing quality (${qualityScore}/100) — likely appears well in search.`;
  } else if (qualityScore >= 40) {
    explanation = `Average listing quality (${qualityScore}/100) — may be ranked lower in search.`;
  } else {
    explanation = `Poor listing quality (${qualityScore}/100) — likely buried in search results.`;
  }

  return { score, explanation };
}

// ─── Signal 5: Quality Score (weight 5%) ─────────────────────────────────────
// Is the product listing complete and well described?
// Thin listings get skipped by users.

async function qualityScoreSignal(productId: number): Promise<SignalResult> {
  const { rows } = await pg.query<{
    quality_score: number | null;
    has_fabric: boolean;
    has_size_info: boolean;
    has_return_policy: boolean;
  }>(
    `SELECT quality_score, has_fabric, has_size_info, has_return_policy
     FROM product_quality_scores
     WHERE product_id = $1
     LIMIT 1`,
    [productId],
  );

  const row = rows[0];

  if (!row || row.quality_score === null) {
    return { score: 50, explanation: "No quality score computed yet." };
  }

  const score = clamp(100 - row.quality_score);

  const missing: string[] = [];
  if (!row.has_fabric) missing.push("fabric info");
  if (!row.has_size_info) missing.push("size info");
  if (!row.has_return_policy) missing.push("return policy");

  const explanation =
    missing.length > 0
      ? `Quality score ${row.quality_score}/100 — missing: ${missing.join(", ")}.`
      : `Quality score ${row.quality_score}/100 — listing is complete.`;

  return { score, explanation };
}

// ─── Main DSR Calculator ──────────────────────────────────────────────────────

export async function calculateDsr(productId: number): Promise<DsrResult> {
  // Run all 5 signals at the same time (parallel — faster)
  const [listingAge, priceMovement, categoryVelocity, searchVisibility, qualityScore] =
    await Promise.all([
      listingAgeSignal(productId),
      priceMovementSignal(productId),
      categoryVelocitySignal(productId),
      searchVisibilitySignal(productId),
      qualityScoreSignal(productId),
    ]);

  // Weighted average
  const dsr_score = clamp(
    listingAge.score * 0.30 +
    priceMovement.score * 0.25 +
    categoryVelocity.score * 0.25 +
    searchVisibility.score * 0.15 +
    qualityScore.score * 0.05,
  );

  // Find the signal with the highest score — that is the top reason
  const signalEntries: [string, SignalResult][] = [
    ["Listing age", listingAge],
    ["Price movement", priceMovement],
    ["Category velocity", categoryVelocity],
    ["Search visibility", searchVisibility],
    ["Quality score", qualityScore],
  ];

  const topSignal = signalEntries.reduce((a, b) => (b[1].score > a[1].score ? b : a));
  const top_reason = `${topSignal[0]}: ${topSignal[1].explanation}`;

  return {
    product_id: productId,
    dsr_score,
    risk_level: riskLevel(dsr_score),
    top_reason,
    signals: {
      listing_age: listingAge,
      price_movement: priceMovement,
      category_velocity: categoryVelocity,
      search_visibility: searchVisibility,
      quality_score: qualityScore,
    },
  };
}
