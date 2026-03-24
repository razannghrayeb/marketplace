/**
 * Persist outfit completion feedback for future ranker training.
 */

import { pg } from "../core";

export type OutfitFeedbackAction = "click" | "add_to_cart" | "purchase" | "dismiss" | "hover";

export interface OutfitFeedbackEvent {
  productId: number;
  bucketCategory: string;
  action: OutfitFeedbackAction;
  rankPosition: number;
  matchScore: number;
}

let tableEnsured = false;

export async function ensureOutfitFeedbackTable(): Promise<void> {
  if (tableEnsured) return;
  await pg.query(`
    CREATE TABLE IF NOT EXISTS outfit_completion_feedback (
      id SERIAL PRIMARY KEY,
      session_id UUID NOT NULL,
      user_id INTEGER,
      seed_product_id INTEGER NOT NULL,
      recommended_product_id INTEGER NOT NULL,
      bucket_category VARCHAR(128),
      action VARCHAR(32) NOT NULL,
      rank_position INTEGER,
      match_score DECIMAL(6,2),
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_outfit_feedback_seed ON outfit_completion_feedback(seed_product_id);
    CREATE INDEX IF NOT EXISTS idx_outfit_feedback_session ON outfit_completion_feedback(session_id);
  `);
  tableEnsured = true;
}

export async function recordOutfitFeedback(params: {
  sessionId: string;
  userId?: number;
  seedProductId: number;
  events: OutfitFeedbackEvent[];
}): Promise<{ inserted: number }> {
  await ensureOutfitFeedbackTable();
  if (!params.events.length) return { inserted: 0 };

  let inserted = 0;
  for (const e of params.events) {
    await pg.query(
      `INSERT INTO outfit_completion_feedback
        (session_id, user_id, seed_product_id, recommended_product_id, bucket_category, action, rank_position, match_score)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8)`,
      [
        params.sessionId,
        params.userId ?? null,
        params.seedProductId,
        e.productId,
        e.bucketCategory,
        e.action,
        e.rankPosition,
        e.matchScore,
      ],
    );
    inserted++;
  }
  return { inserted };
}
