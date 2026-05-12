-- Fashion-CLIP zero-shot style attribute distributions on products.
--
-- Stores per-product soft probability distributions over aesthetic / occasion
-- and an expected formality value, derived once at ingest/backfill time from
-- the product's CLIP image embedding. Used by /complete-style for symmetric
-- distribution-vs-distribution scoring (replaces the asymmetric anchor-only
-- inference path).
--
-- All columns are nullable: products without classification fall back to the
-- existing rule-based scoring path. This keeps the migration safe to run on
-- an active catalog before the backfill worker has finished.

ALTER TABLE products
  -- 8-key softmax distribution: classic, modern, bohemian, minimalist,
  -- streetwear, romantic, edgy, sporty. Values sum to ~1.
  ADD COLUMN IF NOT EXISTS attr_aesthetic_probs jsonb,
  -- 6-key softmax distribution: formal, semi-formal, casual, active, party, beach.
  ADD COLUMN IF NOT EXISTS attr_occasion_probs  jsonb,
  -- Expected formality on a 1-10 scale (linear blend over formality anchors).
  ADD COLUMN IF NOT EXISTS attr_clip_formality  real,
  -- Argmax labels — denormalized so retrieval can filter/facet without
  -- parsing JSONB. Keep in sync with the *_probs columns at write time.
  ADD COLUMN IF NOT EXISTS attr_aesthetic_top   text,
  ADD COLUMN IF NOT EXISTS attr_occasion_top    text,
  -- Margin of top aesthetic vs second-best — used as a confidence proxy when
  -- deciding how strongly to weight the signal.
  ADD COLUMN IF NOT EXISTS attr_aesthetic_margin real,
  -- Timestamp of last classification. Lets backfills be incremental and lets
  -- a future job detect when products need re-classification (e.g. after a
  -- CLIP model upgrade).
  ADD COLUMN IF NOT EXISTS attr_style_clip_at   timestamptz;

-- Backfill driver index. The backfill worker selects products that have a
-- usable primary image embedding but have not been classified yet (or were
-- classified before a given cutoff). This partial index keeps that scan cheap
-- even when the table is mostly classified.
CREATE INDEX IF NOT EXISTS idx_products_pending_style_clip
  ON products(id)
  WHERE attr_style_clip_at IS NULL;

-- Facet/filter index for the argmax labels (cheap, narrow data).
CREATE INDEX IF NOT EXISTS idx_products_aesthetic_top ON products(attr_aesthetic_top);
CREATE INDEX IF NOT EXISTS idx_products_occasion_top  ON products(attr_occasion_top);
