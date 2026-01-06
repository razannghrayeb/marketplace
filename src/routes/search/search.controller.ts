/**
 * Search Routes
 * 
 * API endpoints for product search.
 */

import { Router, Request, Response } from "express";
import { textSearch, imageSearch } from "./search.service";

const router = Router();

/**
 * GET /search?q=shirt&brand=Nike
 * 
 * Text-based product search
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const { q, brand, category, minPrice, maxPrice, color, size, vendor_id, limit, offset } = req.query;
    
    const filters = {
      brand: brand as string,
      category: category as string,
      minPrice: minPrice ? Number(minPrice) : undefined,
      maxPrice: maxPrice ? Number(maxPrice) : undefined,
      color: color as string,
      size: size as string,
      vendorId: vendor_id ? Number(vendor_id) : undefined,
    };
    
    const options = {
      limit: limit ? Number(limit) : 20,
      offset: offset ? Number(offset) : 0,
    };
    
    const result = await textSearch(q as string || "", filters, options);
    res.json(result);
  } catch (error) {
    console.error("Search error:", error);
    res.status(500).json({ error: "Search failed" });
  }
});

/**
 * POST /search/image
 * 
 * Image-based similarity search (multipart or JSON { imageUrl })
 */
router.post("/image", async (req: Request, res: Response) => {
  try {
    const { imageUrl } = req.body;
    
    if (!imageUrl) {
      return res.status(400).json({ error: "imageUrl is required" });
    }
    
    const result = await imageSearch(imageUrl);
    res.json(result);
  } catch (error) {
    console.error("Image search error:", error);
    res.status(500).json({ error: "Image search failed" });
  }
});

export default router;
