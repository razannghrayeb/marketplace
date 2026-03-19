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
import {
  getAutocompleteSuggestions,
  getTrendingQueries,
  getPopularQueries,
  logSearchQuery,
} from "../../lib/queryProcessor/queryAutocomplete";
import {
  parseComplexQuery,
  mergeComplexConstraints,
} from "../../lib/queryProcessor/complexQueryParser";
import {
  parseNegations,
  explainNegations,
} from "../../lib/queryProcessor/negationHandler";
import {
  parseSpatialRelationships,
  summarizeSpatial,
} from "../../lib/queryProcessor/spatialRelationships";
import {
  enrichQueryWithContext,
  addTurn,
  getSession,
  getSessionStats,
} from "../../lib/queryProcessor/conversationalContext";
import { processQuery } from "../../lib/queryProcessor";
import {
  PROMPT_TEMPLATES,
  PROMPT_SUGGESTIONS,
  parsePromptStructure,
  suggestPromptImprovements,
  recommendTemplate,
} from "../../lib/search/promptTemplates";
import multer from "multer";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/**
 * GET /search?q=shirt&brand=Nike&gender=men
 *
 * Enhanced text-based product search with:
 * - Complex query parsing (multi-constraint queries)
 * - Negation handling ("not too formal", "without stripes")
 * - Conversational context (multi-turn queries via session_id)
 * - Query autocomplete logging
 * - Smart suggestions
 *
 * The query string `q` flows through:
 *   normalize → spell-correct → entity extraction → intent classification →
 *   complex parsing → negation detection → context enrichment → expand
 *
 * Filters supplied via query params override AST-extracted entities.
 *
 * Supported query params:
 *  q, brand, category, minPrice, maxPrice, color, size, gender, vendor_id,
 *  limit, offset, session_id, user_id, enhanced (true/false)
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const {
      q,
      brand,
      category,
      minPrice,
      maxPrice,
      color,
      size,
      gender,
      vendor_id,
      limit,
      offset,
      session_id,
      user_id,
      enhanced,
    } = req.query;

    const query = (q as string) || "";
    const sessionId = (session_id as string) || req.headers["x-session-id"] as string;
    const userId = (user_id as string) || (req as any).userId;
    const useEnhanced = enhanced !== "false"; // Default true

    let processedQuery = query;
    let contextual: any = undefined;
    let negations: any = undefined;
    let complexQuery: any = undefined;
    let explanation: string | undefined;
    let suggestions: string[] = [];

    // Enhanced processing
    if (useEnhanced && query) {
      // 1. Conversational Context
      if (sessionId) {
        contextual = enrichQueryWithContext(query, sessionId);
        processedQuery = contextual.enriched;
      }

      // 2. Negation Handling
      negations = parseNegations(processedQuery);
      const cleanedQuery = negations.cleanedQuery;

      // 3. Complex Query Parsing
      complexQuery = parseComplexQuery(cleanedQuery);

      // Update processed query
      processedQuery = cleanedQuery;

      // Build explanation
      const explanationParts: string[] = [];
      if (contextual?.isRefinement) {
        explanationParts.push("Refined previous search");
      }
      if (complexQuery.complexity !== "simple") {
        explanationParts.push(`${complexQuery.complexity} query`);
      }
      if (negations.hasNegation) {
        explanationParts.push(explainNegations(negations.negations));
      }
      explanation = explanationParts.length > 0 ? explanationParts.join(" • ") : undefined;
    }

    // Build filters
    let filters: any = {
      brand: brand as string,
      category: category as string,
      minPrice: minPrice ? Number(minPrice) : undefined,
      maxPrice: maxPrice ? Number(maxPrice) : undefined,
      color: color as string,
      size: size as string,
      gender: gender as string,
      vendorId: vendor_id ? Number(vendor_id) : undefined,
    };

    // Merge complex constraints
    if (useEnhanced && complexQuery) {
      filters = mergeComplexConstraints(filters, complexQuery);
    }

    // Merge contextual filters
    if (useEnhanced && contextual?.inheritedFilters) {
      filters = { ...contextual.inheritedFilters, ...filters };
    }

    const options = {
      limit: limit ? Number(limit) : 20,
      offset: offset ? Number(offset) : 0,
    };

    // Execute search
    const result = await textSearch(processedQuery, filters, options);

    // Log search (async, non-blocking)
    if (useEnhanced && query) {
      logSearchQuery(query, userId, category as string, result.total).catch(err =>
        console.error("[Search] Failed to log query:", err)
      );

      // Add turn to conversation
      if (sessionId) {
        const ast = await processQuery(processedQuery);
        addTurn(sessionId, query, ast, result.total);
      }

      // Generate suggestions
      if (result.total === 0) {
        suggestions.push("Try simpler query or fewer filters");
        if (negations?.hasNegation) {
          suggestions.push("Remove exclusions");
        }
      } else if (result.total > 100) {
        suggestions.push("Add more filters to narrow results");
      }
    }

    // Enhanced response
    const response: any = {
      ...result,
      ...(useEnhanced && {
        enhanced: {
          contextual,
          negations: negations?.hasNegation ? negations : undefined,
          complexQuery: complexQuery?.complexity !== "simple" ? complexQuery : undefined,
          explanation,
          suggestions: suggestions.length > 0 ? suggestions : undefined,
        },
      }),
    };

    res.json(response);
  } catch (error) {
    console.error("Search error:", error);
    res.status(500).json({ error: "Search failed" });
  }
});

/**
 * POST /search/image
 *
 * Single image similarity search using Hybrid Search (CLIP + BLIP fusion)
 *
 * Pipeline:
 * 1. CLIP image embed (60% weight) - visual features (shape, texture, style)
 * 2. BLIP caption → enrichment → CLIP text embed (30% weight) - semantic features
 * 3. Fuse embeddings with L2 normalization
 * 4. OpenSearch k-NN vector search
 *
 * Note: This searches for products similar to the WHOLE image.
 * For per-item detection + search ("shop the look"), use POST /api/images/search instead.
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
 * ✨ NEW FEATURES:
 * - 🚫 Negative Attributes: "not too shiny", "without leather", "avoid stripes"
 * - 📍 Spatial Relationships: "stripes on the sleeves", "pattern on the collar"
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
 * │                 │          │ - "Like first but NOT too shiny" (negatives!)   │
 * │                 │          │ - "Stripes on sleeves" (spatial relationships!) │
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
 * curl -X POST http://0.0.0.0:3000/api/search/multi-image \
 *   -F "images=@red_dress.jpg" \
 *   -F "images=@leather_jacket.jpg" \
 *   -F "prompt=I want the red color from the first image with the leather texture from the second" \
 *   -F "images=@red_dress.jpg" \
 *   -F "images=@leather_jacket.jpg" \
 *   -F "prompt=I want the red color from the first image with the leather texture from the second" \
 *   -F "limit=20"
 *
 * 2️⃣ Style Mixing with Negatives:
 * curl -X POST http://0.0.0.0:3000/api/search/multi-image \
 *   -F "images=@vintage_coat.jpg" \
 *   -F "prompt=Vintage style from first but NOT too formal and without buttons"
 *
 * 3️⃣ Pattern + Silhouette:
 * curl -X POST http://0.0.0.0:3000/api/search/multi-image \
 *   -F "images=@floral_dress.jpg" \
 *   -F "images=@aline_skirt.jpg" \
 *   -F "prompt=Floral pattern from image 1 with A-line silhouette from image 2"
 *
 * 4️⃣ Spatial Relationships:
 * curl -X POST http://0.0.0.0:3000/api/search/multi-image \
 *   -F "images=@striped_shirt.jpg" \
 *   -F "prompt=Looking for shirts with stripes on the sleeves but solid on the body"
 *
 * 5️⃣ Complex Multi-Constraint:
 * curl -X POST http://0.0.0.0:3000/api/search/multi-image \
 *   -F "images=@jacket.jpg" \
 *   -F "prompt=Like this but with zipper on the front, not too shiny, avoid leather"
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
 *   "explanation": "Found products matching burgundy color (image 0) with distressed leather texture (image 1), excluding shiny finishes",
 *   "compositeQuery": {
 *     "constraints": {
 *       "negativeAttributes": { "textures": ["shiny"] },
 *       "spatialRequirements": []
 *     }
 *   }
 * }
 *
 * 💡 TIPS:
 * - Use GET /search/prompt-templates to see example prompts
 * - Use POST /search/prompt-analyze to get suggestions for your prompt
 * - Use GET /search/prompt-suggestions to get helpful phrases
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
 * curl -X POST http://0.0.0.0:3000/api/search/multi-vector \
 *   -F "images=@dress1.jpg" \
 *   -F "images=@dress2.jpg" \
 *   -F "prompt=Elegant evening wear" \
 *   -F "attributeWeights={\"color\":0.4,\"style\":0.4,\"texture\":0.2}" \
 *   -F "explainScores=true"
 * 
 * 2️⃣ Heavy Color Focus:
 * curl -X POST http://0.0.0.0:3000/api/search/multi-vector \
 *   -F "images=@reference.jpg" \
 *   -F "prompt=Find similar colors" \
 *   -F "attributeWeights={\"color\":0.8,\"global\":0.2}"
 * 
 * 3️⃣ Pattern + Material Priority:
 * curl -X POST http://0.0.0.0:3000/api/search/multi-vector \
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

/**
 * GET /search/autocomplete?q=blue%20dre
 *
 * Query autocomplete suggestions with trending and personal history
 *
 * Query params:
 * - q: Query prefix (required, min 2 chars)
 * - limit: Max suggestions (default: 10)
 * - category: Filter by category (optional)
 * - trending: Include trending (default: true)
 * - personal: Include personal history (default: true, requires auth)
 */
router.get("/autocomplete", async (req: Request, res: Response) => {
  try {
    const prefix = req.query.q as string;

    if (!prefix) {
      return res.status(400).json({ error: "Missing 'q' parameter" });
    }

    const userId = (req.query.user_id as string) || (req as any).userId;
    const sessionId = (req.query.session_id as string) || req.headers["x-session-id"] as string;

    const startTime = Date.now();
    const suggestions = await getAutocompleteSuggestions({
      prefix,
      limit: parseInt(req.query.limit as string) || 10,
      userId,
      sessionId,
      category: req.query.category as string,
      includeTrending: req.query.trending !== "false",
      includePersonal: req.query.personal !== "false",
    });
    const tookMs = Date.now() - startTime;

    res.json({ suggestions, prefix, tookMs });
  } catch (error: any) {
    console.error("[Autocomplete] Error:", error);
    res.status(500).json({ error: "Autocomplete failed", message: error.message });
  }
});

/**
 * GET /search/trending?limit=10
 *
 * Get trending queries (last 7 days, time-decayed)
 */
router.get("/trending", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);
    const category = req.query.category as string;

    const startTime = Date.now();
    const trending = await getTrendingQueries(limit, category);
    const tookMs = Date.now() - startTime;

    res.json({ trending, window: "7 days", tookMs });
  } catch (error: any) {
    console.error("[Trending] Error:", error);
    res.status(500).json({ error: "Failed to fetch trending queries", message: error.message });
  }
});

/**
 * GET /search/popular?limit=10
 *
 * Get popular queries (all-time)
 */
router.get("/popular", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

    const startTime = Date.now();
    const popular = await getPopularQueries(limit);
    const tookMs = Date.now() - startTime;

    res.json({ popular, tookMs });
  } catch (error: any) {
    console.error("[Popular] Error:", error);
    res.status(500).json({ error: "Failed to fetch popular queries", message: error.message });
  }
});

/**
 * GET /search/session/:sessionId
 *
 * Get conversation session context
 */
router.get("/session/:sessionId", async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;

    const session = getSession(sessionId);
    const stats = getSessionStats(sessionId);

    res.json({
      sessionId: session.sessionId,
      ...stats,
      accumulatedFilters: session.accumulatedFilters,
      lastCategory: session.lastCategory,
      lastBrand: session.lastBrand,
    });
  } catch (error: any) {
    console.error("[Session] Error:", error);
    res.status(500).json({ error: "Failed to fetch session", message: error.message });
  }
});

/**
 * GET /search/prompt-templates?difficulty=beginner&supports=negatives
 *
 * 📋 Get available prompt templates for multi-image search
 *
 * Templates help users craft better prompts by providing examples organized by:
 * - Difficulty level (beginner, intermediate, advanced)
 * - Feature support (negatives, spatial relationships)
 * - Use case category (color-swap, texture-mix, style-transfer, etc.)
 *
 * Query params:
 * - difficulty: Filter by difficulty level (beginner|intermediate|advanced)
 * - supports: Filter templates that support specific features (negatives|spatial)
 * - category: Filter by use case category
 */
router.get("/prompt-templates", async (req: Request, res: Response) => {
  try {
    const { difficulty, supports, category } = req.query;

    let templates = [...PROMPT_TEMPLATES];

    // Filter by difficulty
    if (difficulty) {
      templates = templates.filter(t => t.difficulty === difficulty);
    }

    // Filter by feature support
    if (supports === 'negatives') {
      templates = templates.filter(t => t.supportsNegatives);
    } else if (supports === 'spatial') {
      templates = templates.filter(t => t.supportsSpatial);
    }

    // Filter by category
    if (category) {
      templates = templates.filter(t => t.category === category);
    }

    res.json({
      templates: templates.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        difficulty: t.difficulty,
        category: t.category,
        example: t.example,
        recommendedImages: t.recommendedImages,
        supportsNegatives: t.supportsNegatives || false,
        supportsSpatial: t.supportsSpatial || false,
      })),
      total: templates.length,
      categories: [...new Set(PROMPT_TEMPLATES.map(t => t.category))],
      difficulties: ['beginner', 'intermediate', 'advanced'],
    });
  } catch (error: any) {
    console.error("[PromptTemplates] Error:", error);
    res.status(500).json({ error: "Failed to fetch templates", message: error.message });
  }
});

/**
 * POST /search/prompt-analyze
 *
 * 🔍 Analyze a user's prompt and suggest improvements
 *
 * This endpoint parses a prompt to detect:
 * - Negative constraints ("not too shiny", "without leather")
 * - Spatial relationships ("stripes on sleeves")
 * - Missing clarity or opportunities for improvement
 * - Recommended templates based on intent
 *
 * Request body:
 * {
 *   "prompt": "I want something like the first image but not too formal"
 * }
 *
 * Response:
 * {
 *   "original": "...",
 *   "analysis": {
 *     "negatives": [...],
 *     "spatialRelationships": [...],
 *     "detectedIntent": "...",
 *     "clarity": "high|medium|low"
 *   },
 *   "suggestions": [...],
 *   "recommendedTemplates": [...]
 * }
 */
router.post("/prompt-analyze", async (req: Request, res: Response) => {
  try {
    const { prompt } = req.body;

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: "Prompt string is required" });
    }

    // Parse structure
    const structure = parsePromptStructure(prompt);

    // Parse negatives
    const negationResult = parseNegations(prompt);

    // Parse spatial relationships
    const spatialResult = parseSpatialRelationships(prompt);

    // Get suggestions
    const suggestions = suggestPromptImprovements(prompt);

    // Recommend templates based on prompt characteristics
    const recommendedTemplates = recommendTemplate({
      numImages: structure.attributes.length > 0 ? 2 : 1, // Estimate from complexity
      needsNegatives: negationResult.hasNegation,
      needsSpatial: spatialResult.hasSpatial,
    });

    res.json({
      original: prompt,
      analysis: {
        structure,
        negatives: negationResult.hasNegation ? {
          found: negationResult.negations.length,
          constraints: negationResult.negations.map(n => ({
            type: n.type,
            value: n.value,
            confidence: n.confidence,
            originalText: n.originalText,
          })),
          summary: explainNegations(negationResult.negations),
        } : null,
        spatialRelationships: spatialResult.hasSpatial ? {
          found: spatialResult.spatialConstraints.length,
          constraints: spatialResult.spatialConstraints.map(s => ({
            attribute: s.attribute,
            location: s.location,
            relationship: s.relationship,
            confidence: s.confidence,
          })),
          summary: summarizeSpatial(spatialResult.spatialConstraints),
        } : null,
        clarity: structure.attributes.length > 2 ? 'high' :
                 structure.attributes.length > 0 ? 'medium' : 'low',
      },
      suggestions,
      recommendedTemplates: recommendedTemplates.slice(0, 3), // Top 3
    });
  } catch (error: any) {
    console.error("[PromptAnalyze] Error:", error);
    res.status(500).json({ error: "Failed to analyze prompt", message: error.message });
  }
});

/**
 * GET /search/prompt-suggestions?type=color
 *
 * 💡 Get helpful prompt suggestions organized by type
 *
 * Returns categorized suggestions for building effective prompts:
 * - color: Color-related phrases
 * - style: Style and aesthetic terms
 * - texture: Texture descriptions
 * - material: Material specifications
 * - pattern: Pattern types
 * - spatial: Spatial relationship examples
 * - formality: Formality level descriptors
 *
 * Query params:
 * - type: Filter by suggestion type (color|style|texture|material|pattern|spatial|formality)
 */
router.get("/prompt-suggestions", async (req: Request, res: Response) => {
  try {
    const { type } = req.query;

    if (type && typeof type === 'string') {
      const suggestions = PROMPT_SUGGESTIONS[type];
      if (!suggestions) {
        return res.status(400).json({ error: `Invalid type. Valid types: ${Object.keys(PROMPT_SUGGESTIONS).join(', ')}` });
      }

      res.json({
        type,
        suggestions,
      });
    } else {
      // Return all suggestions
      res.json({
        suggestionTypes: Object.keys(PROMPT_SUGGESTIONS),
        suggestions: PROMPT_SUGGESTIONS,
      });
    }
  } catch (error: any) {
    console.error("[PromptSuggestions] Error:", error);
    res.status(500).json({ error: "Failed to fetch suggestions", message: error.message });
  }
});

export default router;
