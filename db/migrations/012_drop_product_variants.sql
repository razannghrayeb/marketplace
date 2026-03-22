-- Remove `product_variants` after data has been flattened into `products`.
--
-- If the table still has rows, apply data first:
--   pnpm tsx scripts/flatten-product-variants.ts --execute
--
-- Safe to run multiple times.

DO $body$
BEGIN
  IF to_regclass('public.product_variants') IS NULL THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM product_variants LIMIT 1) THEN
    RAISE EXCEPTION
      'product_variants still contains rows. Run: pnpm tsx scripts/flatten-product-variants.ts --execute';
  END IF;
  DROP TABLE product_variants;
END
$body$;
