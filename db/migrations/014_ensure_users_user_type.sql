-- Safety migration: ensure auth role column exists even if earlier migration order was skipped.
-- This is idempotent and safe to run multiple times.
ALTER TABLE users
ADD COLUMN IF NOT EXISTS user_type TEXT NOT NULL DEFAULT 'customer';
