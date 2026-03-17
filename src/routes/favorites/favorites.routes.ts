import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import {
  listFavoritesHandler,
  toggleFavoriteHandler,
  checkFavoriteHandler,
  checkFavoritesHandler,
} from "./favorites.controller";

const router = Router();

const toggleFavoriteSchema = z.object({
  product_id: z.number().int().positive(),
});

const checkFavoritesSchema = z.object({
  product_ids: z.array(z.number().int().positive()).min(1).max(100),
});

router.use(requireAuth);

router.get("/", listFavoritesHandler);
router.post("/toggle", validateBody(toggleFavoriteSchema), toggleFavoriteHandler);
router.get("/check/:productId", checkFavoriteHandler);
router.post("/check", validateBody(checkFavoritesSchema), checkFavoritesHandler);

export default router;
export { router as favoritesRouter };
