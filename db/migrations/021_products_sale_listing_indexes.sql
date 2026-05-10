-- Migration: Add indexes for sale product listing
-- Date: May 10, 2026
-- Reason: /products/sales filters to active discounts and ranks candidate variants.
--         These partial indexes keep the sale candidate scan off the full products table.

CREATE INDEX IF NOT EXISTS idx_products_active_sale_rank
ON products(vendor_id, availability DESC, last_seen DESC, id DESC)
WHERE sales_price_cents IS NOT NULL
  AND price_cents IS NOT NULL
  AND sales_price_cents > 0
  AND sales_price_cents < price_cents;

CREATE INDEX IF NOT EXISTS idx_products_active_sale_price
ON products(sales_price_cents, id DESC)
WHERE sales_price_cents IS NOT NULL
  AND price_cents IS NOT NULL
  AND sales_price_cents > 0
  AND sales_price_cents < price_cents;
