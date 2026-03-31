-- Optional structured gender for catalog / search (BLIP backfill, manual edits).
-- `products.color` and `products.description` already exist; this adds gender when missing.

ALTER TABLE products ADD COLUMN IF NOT EXISTS gender TEXT;
