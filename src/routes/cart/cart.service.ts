import { pg } from "../../lib/core/db";
import { CartItemRow } from "../../types";

export interface CartItemWithProduct extends CartItemRow {
  title: string;
  brand: string | null;
  price_cents: number;
  sales_price_cents: number | null;
  currency: string;
  image_url: string | null;
  image_cdn: string | null;
  availability: boolean;
}

export async function getCart(
  userId: number
): Promise<{ items: CartItemWithProduct[]; total_items: number; total_price_cents: number }> {
  const result = await pg.query<CartItemWithProduct>(
    `SELECT ci.id, ci.user_id, ci.product_id, ci.quantity, ci.added_at,
            p.title, p.brand, p.price_cents, p.sales_price_cents, p.currency,
            p.image_url, p.image_cdn, p.availability
     FROM cart_items ci
     JOIN products p ON p.id = ci.product_id
     WHERE ci.user_id = $1
     ORDER BY ci.added_at DESC`,
    [userId]
  );

  const items = result.rows;
  const total_items = items.reduce((sum, i) => sum + i.quantity, 0);
  const total_price_cents = items.reduce((sum, i) => {
    const price = i.sales_price_cents ?? i.price_cents;
    return sum + price * i.quantity;
  }, 0);

  return { items, total_items, total_price_cents };
}

export async function addToCart(
  userId: number,
  productId: number,
  quantity: number = 1
): Promise<CartItemRow> {
  const product = await pg.query("SELECT id FROM products WHERE id = $1", [productId]);
  if (product.rows.length === 0) {
    const err: any = new Error("Product not found");
    err.statusCode = 404;
    throw err;
  }

  const result = await pg.query<CartItemRow>(
    `INSERT INTO cart_items (user_id, product_id, quantity)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, product_id)
       DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity
     RETURNING *`,
    [userId, productId, quantity]
  );
  return result.rows[0];
}

export async function updateCartItem(
  userId: number,
  productId: number,
  quantity: number
): Promise<CartItemRow | null> {
  if (quantity <= 0) {
    await removeFromCart(userId, productId);
    return null;
  }
  const result = await pg.query<CartItemRow>(
    `UPDATE cart_items SET quantity = $3
     WHERE user_id = $1 AND product_id = $2
     RETURNING *`,
    [userId, productId, quantity]
  );
  return result.rows[0] ?? null;
}

export async function removeFromCart(userId: number, productId: number): Promise<boolean> {
  const result = await pg.query(
    "DELETE FROM cart_items WHERE user_id = $1 AND product_id = $2",
    [userId, productId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function clearCart(userId: number): Promise<number> {
  const result = await pg.query("DELETE FROM cart_items WHERE user_id = $1", [userId]);
  return result.rowCount ?? 0;
}
