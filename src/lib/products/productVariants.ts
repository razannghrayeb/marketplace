/**
 * Parent listing (`products`) + SKU rows (`product_variants`).
 * See docs/product-variants.md.
 */
import { pg } from "../core";

export interface ProductVariantRow {
  id: number;
  product_id: number;
  vendor_id: number;
  variant_id: string | null;
  product_url: string;
  size: string | null;
  color: string | null;
  currency: string;
  price_cents: string;
  sales_price_cents: string | null;
  availability: boolean;
  last_seen: Date;
  image_url: string | null;
  image_urls: unknown;
  legacy_product_id: string | null;
  is_default: boolean;
}

/**
 * Load all variants for the given parent product ids (batch-friendly).
 */
export async function getVariantsByProductIds(
  productIds: number[]
): Promise<Map<number, ProductVariantRow[]>> {
  if (productIds.length === 0) return new Map();

  const { rows } = await pg.query<ProductVariantRow>(
    `SELECT id, product_id, vendor_id, variant_id, product_url, size, color, currency,
            price_cents::text, sales_price_cents::text, availability, last_seen,
            image_url, image_urls, legacy_product_id::text, is_default
     FROM product_variants
     WHERE product_id = ANY($1::bigint[])
     ORDER BY product_id, is_default DESC, id`,
    [productIds]
  );

  const map = new Map<number, ProductVariantRow[]>();
  for (const r of rows) {
    const pid = Number(r.product_id);
    const list = map.get(pid) ?? [];
    list.push(r);
    map.set(pid, list);
  }
  return map;
}

export async function getDefaultVariant(productId: number): Promise<ProductVariantRow | null> {
  const { rows } = await pg.query<ProductVariantRow>(
    `SELECT id, product_id, vendor_id, variant_id, product_url, size, color, currency,
            price_cents::text, sales_price_cents::text, availability, last_seen,
            image_url, image_urls, legacy_product_id::text, is_default
     FROM product_variants
     WHERE product_id = $1
     ORDER BY is_default DESC, id
     LIMIT 1`,
    [productId]
  );
  return rows[0] ?? null;
}
