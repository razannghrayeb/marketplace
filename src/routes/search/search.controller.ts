/**
 * Search Routes
 * 
 * This module provides THREE distinct search capabilities:
 * 
 * 1. NORMAL SEARCH (Single Image Similarity)
 *    Endpoint: POST /api/search/image
 *    Purpose: Find products most similar to ONE reference image
 *    Use Case: "Find me products that look like this"
 *    Input: Single image file
 *    Output: Ranked list of similar products by vector similarity
 * 
 * 2. TEXT SEARCH (Keyword/Filter Based)
 *    Endpoint: GET /api/search?q=...
 *    Purpose: Traditional text search with filters
 *    Use Case: "Show me Nike shoes under $200"
 *    Input: Query string + filters (brand, category, price, etc.)
 *    Output: Filtered and ranked products
 * 
 * 3. MULTI-IMAGE COMPOSITE SEARCH (NEW - Unique Feature)
 *    Endpoints: POST /api/search/multi-image (main), /api/search/multi-vector (advanced)
 *    Purpose: Mix attributes from MULTIPLE images using natural language
 *    Use Case: "Color from first image, texture from second image"
 *    Input: 1-5 images + natural language prompt
 *    Output: Products matching composite attribute blend with intent-aware ranking
 *    
 *    How it works:
 *    - Phase 1: Gemini AI parses intent from prompt + images
 *    - Phase 2: Extract per-attribute embeddings (color, texture, style, etc.)
 *    - Phase 3: Build composite query from intent weights
 *    - Phase 4: Multi-vector search (parallel kNN + union + weighted re-rank)
 *    - Phase 5: Intent-aware reranking (vector + attributes + price + recency)
 * 
 * Note: For YOLO-based product detection ("shop the look"), see:
 * /api/images/search - Upload image → detect items → find similar for each
 * 
 * See docs/SEARCH_FEATURES_GUIDE.md for comprehensive comparison.
 */

import { Router, Request, Response } from "express";
import { textSearch, imageSearch, multiImageSearch, multiVectorWeightedSearch } from "./search.service";
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
 * 🎯 COMPOSITE MULTI-IMAGE SEARCH WITH INTENT PARSING
 * 
 * This is the MAIN ENDPOINT for cross-image attribute mixing.
 * Uses Gemini AI to understand natural language and extract attributes from specific images.
 * 
 * 📥 REQUEST BODY (multipart/form-data):
 * ┌─────────────────┬──────────┬──────────────────────────────────────────────────┐
 * │ Parameter       │ Required │ Description                                      │
 * ├─────────────────┼──────────┼──────────────────────────────────────────────────┤
 * │ images          │ ✓        │ 1-5 image files (JPEG/PNG). Order matters!      │
 * │                 │          │ First image = index 0, Second = index 1, etc.   │
 * ├─────────────────┼──────────┼──────────────────────────────────────────────────┤
 * │ prompt          │ ✓        │ Natural language description. Examples:          │
 * │                 │          │ - "Color from first, texture from second"       │
 * │                 │          │ - "I want the style of image 1 with pattern of 2│
 * │                 │          │ - "Mix vintage vibe from first with modern cut" │
 * ├─────────────────┼──────────┼──────────────────────────────────────────────────┤
 * │ limit           │          │ Max results (default: 50)                        │
 * ├─────────────────┼──────────┼──────────────────────────────────────────────────┤
 * │ rerankWeights   │          │ JSON object to tune ranking weights:             │
 * │                 │          │ {"vectorWeight": 0.6, "attributeWeight": 0.3,    │
 * │                 │          │  "priceWeight": 0.1, "recencyWeight": 0.0}       │
 * └─────────────────┴──────────┴──────────────────────────────────────────────────┘
 * 
 * 🎨 EXAMPLE REQUESTS:
 * 
 * 1️⃣ Cross-Image Color + Texture:
 * curl -X POST http://localhost:3000/api/search/multi-image \
 *   -F "images=@red_dress.jpg" \
 *   -F "images=@leather_jacket.jpg" \
 *   -F "prompt=I want the red color from the first image with the leather texture from the second" \
 *   -F "limit=20"
 * 
 * 2️⃣ Style Mixing with Price Constraint:
 * curl -X POST http://localhost:3000/api/search/multi-image \
 *   -F "images=@vintage_coat.jpg" \
 *   -F "images=@modern_blazer.jpg" \
 *   -F "prompt=Vintage style from first but with modern fit like second, under $200" \
 *   -F "rerankWeights={\"vectorWeight\":0.5,\"attributeWeight\":0.4,\"priceWeight\":0.1}"
 * 
 * 3️⃣ Pattern + Silhouette:
 * curl -X POST http://localhost:3000/api/search/multi-image \
 *   -F "images=@floral_dress.jpg" \
 *   -F "images=@aline_skirt.jpg" \
 *   -F "prompt=Floral pattern from image 1 with A-line silhouette from image 2"
 * 
 * 📤 RESPONSE:
 * {
 *   "results": [
 *     {
 *       "id": "prod_123",
 *       "name": "Burgundy Leather Bomber Jacket",
 *       "score": 0.87,
 *       "rerankScore": 0.91,
 *       "rerankBreakdown": {
 *         "vector": 0.52,
 *         "attribute": 0.27,
 *         "price": 0.09,
 *         "recency": 0.03
 *       },
 *       "price": 189.99,
 *       "brand": "StyleCo",
 *       "category": "jackets"
 *     }
 *   ],
 *   "total": 147,
 *   "tookMs": 234,
 *   "explanation": "Found products matching burgundy color (image 0) with distressed leather texture (image 1)"
 * }
 */
router.post("/multi-image", upload.array("images", 5), async (req: Request, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];
    const { prompt, limit, rerankWeights } = req.body;

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

    // Parse rerank weights if provided
    let parsedRerank = undefined;
    if (rerankWeights) {
      try {
        parsedRerank = typeof rerankWeights === 'string' ? JSON.parse(rerankWeights) : rerankWeights;
      } catch (e) {
        return res.status(400).json({ error: 'Invalid rerankWeights JSON' });
      }
    }

    const result = await multiImageSearch({
      images,
      userPrompt: prompt,
      limit: limit ? Number(limit) : 50,
      rerankWeights: parsedRerank,
    });

    res.json(result);
  } catch (error) {
    console.error("Multi-image search error:", error);
    res.status(500).json({ error: "Multi-image search failed" });
  }
});

/**
 * POST /search/multi-vector
 * 
 * 🔧 ADVANCED MULTI-VECTOR SEARCH WITH EXPLICIT ATTRIBUTE CONTROL
 * 
 * This is the ADVANCED ENDPOINT for power users who want explicit control over
 * per-attribute weights without relying on AI intent parsing.
 * 
 * 📥 REQUEST BODY (multipart/form-data):
 * ┌──────────────────┬──────────┬─────────────────────────────────────────────────┐
 * │ Parameter        │ Required │ Description                                     │
 * ├──────────────────┼──────────┼─────────────────────────────────────────────────┤
 * │ images           │ ✓        │ 1-5 image files (JPEG/PNG)                      │
 * ├──────────────────┼──────────┼─────────────────────────────────────────────────┤
 * │ prompt           │ ✓        │ Text description (processed as global query)    │
 * ├──────────────────┼──────────┼─────────────────────────────────────────────────┤
 * │ attributeWeights │          │ JSON object with explicit per-attribute weights:│
 * │                  │          │ {"global": 0.2, "color": 0.3, "texture": 0.2,  │
 * │                  │          │  "material": 0.15, "style": 0.1, "pattern":0.05│
 * │                  │          │ Must sum to 1.0 (auto-normalized if not)        │
 * ├──────────────────┼──────────┼─────────────────────────────────────────────────┤
 * │ explainScores    │          │ Boolean - return per-attribute score breakdown  │
 * ├──────────────────┼──────────┼─────────────────────────────────────────────────┤
 * │ limit            │          │ Max results (default: 50)                       │
 * ├──────────────────┼──────────┼─────────────────────────────────────────────────┤
 * │ rerankWeights    │          │ JSON object to tune ranking (same as /multi-image│
 * └──────────────────┴──────────┴─────────────────────────────────────────────────┘
 * 
 * 🎨 EXAMPLE REQUESTS:
 * 
 * 1️⃣ Explicit Attribute Weights:
 * curl -X POST http://localhost:3000/api/search/multi-vector \
 *   -F "images=@dress1.jpg" \
 *   -F "images=@dress2.jpg" \
 *   -F "prompt=Elegant evening wear" \
 *   -F "attributeWeights={\"color\":0.4,\"style\":0.4,\"texture\":0.2}" \
 *   -F "explainScores=true"
 * 
 * 2️⃣ Heavy Color Focus:
 * curl -X POST http://localhost:3000/api/search/multi-vector \
 *   -F "images=@reference.jpg" \
 *   -F "prompt=Find similar colors" \
 *   -F "attributeWeights={\"color\":0.8,\"global\":0.2}"
 * 
 * 3️⃣ Pattern + Material Priority:
 * curl -X POST http://localhost:3000/api/search/multi-vector \
 *   -F "images=@shirt.jpg" \
 *   -F "prompt=Striped linen shirts" \
 *   -F "attributeWeights={\"pattern\":0.5,\"material\":0.5}"
 * 
 * 📤 RESPONSE:
 * {
 *   "results": [
 *     {
 *       "id": "prod_456",
 *       "name": "Navy Silk Evening Gown",
 *       "score": 0.88,
 *       "rerankScore": 0.92,
 *       "attributeScores": {          // Only if explainScores=true
 *         "global": 0.85,
 *         "color": 0.91,
 *         "texture": 0.87,
 *         "material": 0.89,
 *         "style": 0.90,
 *         "pattern": 0.78
 *       },
 *       "price": 299.99
 *     }
 *   ],
 *   "total": 89,
 *   "tookMs": 187
 * }
 * 
 * 💡 TIP: Use /multi-image for natural language, use /multi-vector for precise control.
 */
router.post("/multi-vector", upload.array("images", 5), async (req: Request, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];
    const { prompt, attributeWeights, explainScores, limit, rerankWeights } = req.body;

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

    // Parse attribute weights if provided as JSON string
    let parsedWeights = undefined;
    if (attributeWeights) {
      try {
        parsedWeights = typeof attributeWeights === 'string' 
          ? JSON.parse(attributeWeights) 
          : attributeWeights;
      } catch (e) {
        return res.status(400).json({ error: "Invalid attributeWeights JSON" });
      }
    }

    // Parse rerank weights if provided
    let parsedRerank = undefined;
    if (rerankWeights) {
      try {
        parsedRerank = typeof rerankWeights === 'string' ? JSON.parse(rerankWeights) : rerankWeights;
      } catch (e) {
        return res.status(400).json({ error: 'Invalid rerankWeights JSON' });
      }
    }

    const result = await multiVectorWeightedSearch({
      images,
      userPrompt: prompt,
      attributeWeights: parsedWeights,
      explainScores: explainScores === 'true' || explainScores === true,
      limit: limit ? Number(limit) : 50,
      rerankWeights: parsedRerank,
    });

    res.json(result);
  } catch (error) {
    console.error("Multi-vector search error:", error);
    res.status(500).json({ error: "Multi-vector search failed" });
  }
});

export default router;
