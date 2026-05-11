-- Speeds search-result hydration:
--   SELECT ... FROM product_images
--   WHERE product_id = ANY($1::bigint[])
--   ORDER BY product_id, is_primary DESC, created_at ASC
--
-- The existing product_id index helps filtering, but this composite index also
-- matches the ordering used by getImagesForProducts().
CREATE INDEX IF NOT EXISTS idx_product_images_hydration_order
  ON product_images(product_id, is_primary DESC, created_at ASC);

