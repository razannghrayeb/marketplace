import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import {
  getCartHandler,
  addToCartHandler,
  updateCartHandler,
  removeFromCartHandler,
  clearCartHandler,
} from "./cart.controller";

const router = Router();

const addToCartSchema = z.object({
  product_id: z.number().int().positive(),
  quantity: z.number().int().min(1).max(99).optional(),
});

const updateCartSchema = z.object({
  quantity: z.number().int().min(0).max(99),
});

router.use(requireAuth);

router.get("/", getCartHandler);
router.post("/", validateBody(addToCartSchema), addToCartHandler);
router.patch("/:productId", validateBody(updateCartSchema), updateCartHandler);
router.delete("/clear", clearCartHandler);
router.delete("/:productId", removeFromCartHandler);

export default router;
export { router as cartRouter };
