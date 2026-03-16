import { Request, Response, NextFunction } from "express";
import { getFavorites, toggleFavorite, isFavorited, checkFavorites } from "./favorites.service";

export async function listFavoritesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;
    const result = await getFavorites(req.user!.id, limit, offset);
    res.json({ success: true, ...result, limit, offset });
  } catch (err) {
    next(err);
  }
}

export async function toggleFavoriteHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { product_id } = req.body;
    const result = await toggleFavorite(req.user!.id, product_id);
    res.json({ success: true, ...result });
  } catch (err: any) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, error: err.message });
    next(err);
  }
}

export async function checkFavoriteHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const productId = parseInt(req.params.productId, 10);
    const favorited = await isFavorited(req.user!.id, productId);
    res.json({ success: true, favorited });
  } catch (err) {
    next(err);
  }
}

export async function checkFavoritesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { product_ids } = req.body;
    const result = await checkFavorites(req.user!.id, product_ids);
    res.json({ success: true, favorites: result });
  } catch (err) {
    next(err);
  }
}
