/**
 * Search Routes
 * 
 * API endpoints for product search with multi-image composite query support.
 */

import { Router, Request, Response } from "express";
import { textSearch, imageSearch, multiImageSearch } from "./search.service";
import multer from "multer";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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
 * Single image-based similarity search
 */
router.post("/image", upload.single("image"), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Image file is required" });
    }
    
    const result = await imageSearch(req.file.buffer, {
      limit: req.body.limit ? Number(req.body.limit) : 50,
    });
    
    res.json(result);
  } catch (error) {
    console.error("Image search error:", error);
    res.status(500).json({ error: "Image search failed" });
  }
});

/**
 * POST /search/multi-image
 * 
 * Multi-image composite search with intent parsing
 * Accepts multiple images + text prompt
 * 
 * Body:
 * - images: array of image files (multipart/form-data)
 * - prompt: text description of what to search for
 * - limit: max results (optional)
 * 
 * Example curl:
 * curl -X POST http://localhost:3000/api/search/multi-image \
 *   -F "images=@image1.jpg" \
 *   -F "images=@image2.jpg" \
 *   -F "prompt=I want the color from the first image with the texture from the second" \
 *   -F "limit=20"
 */
router.post("/multi-image", upload.array("images", 5), async (req: Request, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];
    const { prompt, limit } = req.body;

    if (!files || files.length === 0) {
      return res.status(400).json({ error: "At least one image is required" });
    }

    if (!prompt) {
      return res.status(400).json({ error: "Text prompt is required" });
    }

    if (files.length > 5) {
      return res.status(400).json({ error: "Maximum 5 images allowed" });
    }

    const images = files.map(f => f.buffer);

    const result = await multiImageSearch({
      images,
      userPrompt: prompt,
      limit: limit ? Number(limit) : 50,
    });

    res.json(result);
  } catch (error) {
    console.error("Multi-image search error:", error);
    res.status(500).json({ error: "Multi-image search failed" });
  }
});

export default router;
