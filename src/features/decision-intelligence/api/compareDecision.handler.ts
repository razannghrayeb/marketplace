import type { Request, Response } from "express";
import { compareProductsWithDecisionIntelligence } from "./compareDecision.service";

export async function compareDecisionHandler(req: Request, res: Response): Promise<void> {
  const result = await compareProductsWithDecisionIntelligence(req.body);
  if (!result.ok) {
    const status =
      result.error.code === "INVALID_REQUEST"
        ? 400
        : result.error.code === "PRODUCTS_NOT_FOUND"
          ? 404
          : result.error.code === "INSUFFICIENT_PRODUCT_DATA"
            ? 422
            : 500;
    res.status(status).json({ error: result.error.message, code: result.error.code, details: result.error.details });
    return;
  }
  res.json(result.response);
}
