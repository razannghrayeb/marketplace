# Product variants model

## Shape

- **`products`**: one row per **parent listing** (style / PDP), keyed by canonical listing URL (`product_url` = parent page, no `#variant=`). Listing-level fields: `title`, `brand`, `category`, `description`, `return_policy`, optional representative `image_url` / aggregates.
- **`product_variants`**: one row per **SKU** (size/color/Shopify variant). Holds `variant_id`, full `product_url` (including `#variant=` when used), `size`, `color`, prices, `availability`, `image_url` / `image_urls`.

Unique constraints:

- `(vendor_id, product_url)` on `product_variants` (same as historical flat `products` rule, now per variant row).
- `(product_id, variant_id)` when `variant_id` is set.

## Migration

1. Apply SQL: `db/migrations/009_product_variants.sql` (or your migration runner).
2. Run (dry-run first):

   ```bash
   npx tsx scripts/migrate-to-product-variants.ts
   npx tsx scripts/migrate-to-product-variants.ts --execute --vendor-id=8
   ```

3. Reindex OpenSearch / refresh any denormalized search docs so `product_id` matches parents and prices reflect your new rules.

## API / search follow-ups

- Hydrate `variants: [...]` on product detail and optionally on search cards (min/max price from variants).
- Cart line items: long term, prefer `product_variant_id` (or `product_id` + `variant_id`) so the exact SKU is preserved; today many flows only store `product_id` (parent after migration).

## Rollback

No automatic rollback; restore from DB backup if needed.
