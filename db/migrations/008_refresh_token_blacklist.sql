-- Migration: 008_refresh_token_blacklist.sql
-- Purpose: revoke refresh tokens on logout by storing a hashed denylist

CREATE TABLE IF NOT EXISTS refresh_token_blacklist (
    id SERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_token_blacklist_user_id
  ON refresh_token_blacklist(user_id);

CREATE INDEX IF NOT EXISTS idx_refresh_token_blacklist_expires_at
  ON refresh_token_blacklist(expires_at);
