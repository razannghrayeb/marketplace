/**
 * PostgreSQL hydration for vector hits (inventory, price, imagery) — separate from kNN retrieval.
 */

import { pg } from "../core/db";

export async function hydrateProductRowsByIds(
  productIds: (string | number)[],
  variantOptions?: {
    primaryColorByProductId?: Map<string, string | null | undefined>;
    queryColorHints?: string[];
    textQuery?: string | null;
  },
): Promise<any[]> {
  if (productIds.length === 0) return [];
  const numericIds = productIds.map((id) => Number(id)).filter((id) => !isNaN(id));
  if (numericIds.length === 0) return [];

  const query = `
    SELECT p.id, p.title AS name, p.brand,
           ROUND(p.price_cents / 100.0, 2) AS price,
           COALESCE(p.image_cdn, p.image_url) AS image_url,
           p.category, p.description, p.vendor_id, p.size, p.color
    FROM products p
    WHERE p.id = ANY($1::bigint[])
  `;
  const result = await pg.query(query, [numericIds]);
  const colorMap = variantOptions?.primaryColorByProductId;
  return result.rows.map((row: any) => ({
    ...row,
    color: colorMap?.get(String(row.id)) ?? row.color ?? null,
  }));
}
