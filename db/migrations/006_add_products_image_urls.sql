-- Migration: 006_add_products_image_urls.sql
-- Purpose: ensure products.image_urls exists for multi-image support

ALTER TABLE products
ADD COLUMN IF NOT EXISTS image_urls JSONB;
