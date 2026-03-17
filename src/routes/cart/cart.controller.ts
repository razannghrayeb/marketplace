import { Request, Response, NextFunction } from "express";
import { getCart, addToCart, updateCartItem, removeFromCart, clearCart } from "./cart.service";

export async function getCartHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const cart = await getCart(req.user!.id);
    res.json({ success: true, ...cart });
  } catch (err) {
    next(err);
  }
}

export async function addToCartHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { product_id, quantity } = req.body;
    const item = await addToCart(req.user!.id, product_id, quantity ?? 1);
    res.status(201).json({ success: true, item });
  } catch (err: any) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, error: err.message });
    next(err);
  }
}

export async function updateCartHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const productId = parseInt(req.params.productId, 10);
    const { quantity } = req.body;

    if (quantity === 0) {
      const removed = await removeFromCart(req.user!.id, productId);
      if (!removed) return res.status(404).json({ success: false, error: "Item not in cart" });
      return res.json({ success: true, removed: true });
    }

    const item = await updateCartItem(req.user!.id, productId, quantity);
    if (!item) return res.status(404).json({ success: false, error: "Item not in cart" });
    res.json({ success: true, item });
  } catch (err) {
    next(err);
  }
}

export async function removeFromCartHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const productId = parseInt(req.params.productId, 10);
    const removed = await removeFromCart(req.user!.id, productId);
    if (!removed) return res.status(404).json({ success: false, error: "Item not in cart" });
    res.json({ success: true, removed: true });
  } catch (err) {
    next(err);
  }
}

export async function clearCartHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const count = await clearCart(req.user!.id);
    res.json({ success: true, removed_count: count });
  } catch (err) {
    next(err);
  }
}
