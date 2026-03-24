/**
 * Product Variants Controller
 *
 * POST /products/variants/batch - Get variants for multiple product IDs
 */
import { Request, Response } from "express";
import { getVariantsByProductIds } from "./variants.service";

/**
 * POST /products/variants/batch
 * Body: { productIds: number[] }
 * Returns: { data: Record<productId, { variants, minPriceCents, maxPriceCents }> }
 */
export async function getVariantsBatch(req: Request, res: Response) {
  try {
    const { productIds } = req.body ?? {};
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: "productIds array is required and must not be empty",
      });
    }

    const ids = productIds
      .map((id: unknown) => (typeof id === "number" ? id : parseInt(String(id), 10)))
      .filter((n: number) => !isNaN(n));

    if (ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No valid product IDs provided",
      });
    }

    if (ids.length > 100) {
      return res.status(400).json({
        success: false,
        error: "Maximum 100 product IDs per request",
      });
    }

    const data = await getVariantsByProductIds(ids);
    res.json({ success: true, data });
  } catch (error) {
    console.error("Error fetching variants:", error);
    res.status(500).json({ success: false, error: "Failed to fetch variants" });
  }
}
