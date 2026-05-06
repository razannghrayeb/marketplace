-- Migration: Add indexes on products columns used in admin dashboard filters
-- Date: May 6, 2026
-- Reason: COUNT(*) queries on availability, last_seen, category, image_url were doing
--         full sequential scans of 117k+ rows, causing 8+ second response times.

CREATE INDEX IF NOT EXISTS idx_products_availability ON products(availability);
CREATE INDEX IF NOT EXISTS idx_products_last_seen ON products(last_seen);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_image_url ON products(image_url);
CREATE INDEX IF NOT EXISTS idx_products_vendor_id ON products(vendor_id);

-- Composite for freshness queries: vendor_id + last_seen together
CREATE INDEX IF NOT EXISTS idx_products_vendor_last_seen ON products(vendor_id, last_seen);

-- Composite for availability + vendor queries
CREATE INDEX IF NOT EXISTS idx_products_vendor_availability ON products(vendor_id, availability);
