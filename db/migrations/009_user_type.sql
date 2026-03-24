-- Add user_type to support business vs customer dashboards
-- customer: marketplace shopper (default)
-- business: vendor/seller dashboard
ALTER TABLE users ADD COLUMN IF NOT EXISTS user_type TEXT NOT NULL DEFAULT 'customer' CHECK (user_type IN ('customer', 'business'));
