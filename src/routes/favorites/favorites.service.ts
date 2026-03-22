import { pg } from "../../lib/core/db";
import { enrichProductsWithVariantSummary } from "../../lib/products";
import { FavoriteRow } from "../../types";

export interface FavoriteWithProduct extends FavoriteRow {
  title: string;
  brand: string | null;
  price_cents: number;
  sales_price_cents: number | null;
  currency: string;
  image_url: string | null;
  image_cdn: string | null;
}

export async function getFavorites(
  userId: number,
  limit = 50,
  offset = 0
): Promise<{ items: FavoriteWithProduct[]; total: number }> {
  const countResult = await pg.query<{ count: string }>(
    "SELECT COUNT(*) FROM favorites WHERE user_id = $1",
    [userId]
  );

  const result = await pg.query<FavoriteWithProduct>(
    `SELECT f.id, f.user_id, f.product_id, f.created_at,
            p.title, p.brand, p.price_cents, p.sales_price_cents, p.currency,
            p.image_url, p.image_cdn
     FROM favorites f
     JOIN products p ON p.id = f.product_id
     WHERE f.user_id = $1
     ORDER BY f.created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );

  const paired = result.rows.map((r) => ({
    fav: { id: r.id, user_id: r.user_id, product_id: r.product_id, created_at: r.created_at },
    product: {
      id: r.product_id,
      title: r.title,
      brand: r.brand,
      price_cents: r.price_cents,
      sales_price_cents: r.sales_price_cents,
      currency: r.currency,
      image_url: r.image_url,
      image_cdn: r.image_cdn,
    },
  }));
  const enriched = await enrichProductsWithVariantSummary(paired.map((p) => p.product));
  const items: FavoriteWithProduct[] = paired.map((p, i) => {
    const e = enriched[i] as any;
    return {
      ...p.fav,
      title: e.title,
      brand: e.brand,
      price_cents: e.price_cents,
      sales_price_cents: e.sales_price_cents,
      currency: e.currency,
      image_url: e.image_url,
      image_cdn: e.image_cdn,
    };
  });

  return {
    items,
    total: parseInt(countResult.rows[0].count, 10),
  };
}

export async function toggleFavorite(
  userId: number,
  productId: number
): Promise<{ favorited: boolean }> {
  const deleted = await pg.query(
    "DELETE FROM favorites WHERE user_id = $1 AND product_id = $2 RETURNING id",
    [userId, productId]
  );
  if ((deleted.rowCount ?? 0) > 0) {
    return { favorited: false };
  }

  const product = await pg.query("SELECT id FROM products WHERE id = $1", [productId]);
  if (product.rows.length === 0) {
    const err: any = new Error("Product not found");
    err.statusCode = 404;
    throw err;
  }

  await pg.query(
    "INSERT INTO favorites (user_id, product_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [userId, productId]
  );
  return { favorited: true };
}

export async function isFavorited(userId: number, productId: number): Promise<boolean> {
  const result = await pg.query(
    "SELECT 1 FROM favorites WHERE user_id = $1 AND product_id = $2",
    [userId, productId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function checkFavorites(
  userId: number,
  productIds: number[]
): Promise<Record<number, boolean>> {
  if (productIds.length === 0) return {};
  const result = await pg.query(
    "SELECT product_id FROM favorites WHERE user_id = $1 AND product_id = ANY($2::bigint[])",
    [userId, productIds]
  );
  const favSet = new Set(result.rows.map((r: any) => Number(r.product_id)));
  const map: Record<number, boolean> = {};
  for (const id of productIds) {
    map[id] = favSet.has(id);
  }
  return map;
}
