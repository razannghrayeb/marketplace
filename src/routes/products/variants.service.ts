/**
 * Product Variants Service
 *
 * Fetches variants (products sharing parent_product_url) for given product IDs.
 * Used for min–max price display on product cards and detail pages.
 */
import { pg } from "../../lib/core";

export interface ProductVariant {
  id: number;
  title: string;
  price_cents: number;
  sales_price_cents: number | null;
  size: string | null;
  color: string | null;
  availability: boolean;
  image_cdn: string | null;
}

export interface VariantsByProduct {
  variants: ProductVariant[];
  minPriceCents: number;
  maxPriceCents: number;
}

/**
 * Get variants for multiple product IDs in one query.
 * Variants = products with same parent_product_url and vendor_id.
 * Returns a map: productId -> { variants, minPriceCents, maxPriceCents }
 */
export async function getVariantsByProductIds(
  productIds: (number | string)[]
): Promise<Record<number, VariantsByProduct>> {
  if (productIds.length === 0) return {};

  const numericIds = productIds.map((id) =>
    typeof id === "string" ? parseInt(id, 10) : id
  );

  // Get products with their parent_product_url and vendor_id
  const productsResult = await pg.query(
    `SELECT id, parent_product_url, vendor_id
     FROM products
     WHERE id = ANY($1::int[])`,
    [numericIds]
  );

  const productRows = productsResult.rows;
  if (productRows.length === 0) return {};

  // Build (parent_product_url, vendor_id) -> productIds map
  const keyToProductIds = new Map<string, number[]>();
  const productIdToKey = new Map<number, string>();

  for (const row of productRows) {
    const key =
      `${row.parent_product_url ?? `__single_${row.id}`}|${row.vendor_id}`;
    if (!keyToProductIds.has(key)) keyToProductIds.set(key, []);
    keyToProductIds.get(key)!.push(row.id);
    productIdToKey.set(row.id, key);
  }

  // Collect all variant IDs (products in same group)
  const variantIds = new Set<number>();
  for (const ids of keyToProductIds.values()) {
    ids.forEach((id) => variantIds.add(id));
  }

  if (variantIds.size === 0) return {};

  // Fetch full variant data
  const variantsResult = await pg.query(
    `SELECT id, title, price_cents, sales_price_cents, size, color, availability, image_cdn
     FROM products
     WHERE id = ANY($1::int[])`,
    [Array.from(variantIds)]
  );

  const variantMap = new Map(
    variantsResult.rows.map((r: any) => [r.id, r as ProductVariant])
  );

  // Build result per requested product
  const result: Record<number, VariantsByProduct> = {};

  for (const productId of numericIds) {
    const key = productIdToKey.get(productId);
    if (!key) continue;

    const groupIds = keyToProductIds.get(key) ?? [];
    const variants = groupIds
      .map((id) => variantMap.get(id))
      .filter(Boolean) as ProductVariant[];

    if (variants.length === 0) continue;

    const prices = variants.map((v) => {
      const p = v.sales_price_cents ?? v.price_cents;
      return p;
    });
    const minPriceCents = Math.min(...prices);
    const maxPriceCents = Math.max(...prices);

    result[productId] = {
      variants,
      minPriceCents,
      maxPriceCents,
    };
  }

  return result;
}
