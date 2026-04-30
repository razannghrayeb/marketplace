/**
 * E-ACR Indexing Routes
 * 
 * Parallel indexing endpoints for E-ACR v3 testing
 * POST /api/products/index-eacr - Index product into E-ACR
 * GET /api/products/search-eacr - Search E-ACR index
 * GET /api/products/compare-indexes - Compare E-ACR vs OpenSearch results
 * GET /api/products/eacr-metrics - Get E-ACR metrics and recommendations
 */

import { Router, Request, Response } from "express";
import { initializeEACRService, getEACRService, ProductEmbedding } from "../../lib/search/eacr-indexing-service";

const router = Router();

/**
 * Initialize E-ACR service on first request
 */
let eacrInitialized = false;

router.use((req, res, next) => {
  if (!eacrInitialized) {
    try {
      initializeEACRService(256);
      eacrInitialized = true;
    } catch (err) {
      console.error("Failed to initialize E-ACR service:", err);
    }
  }
  next();
});

/**
 * POST /api/products/index-eacr
 * Index a single product into E-ACR
 */
router.post("/index-eacr", async (req: Request, res: Response) => {
  try {
    const { productId, embedding, title, category, color, availability } = req.body;

    if (!productId || !embedding || !Array.isArray(embedding)) {
      return res.status(400).json({
        error: "Missing required fields: productId, embedding (array)",
      });
    }

    const product: ProductEmbedding = {
      productId,
      embedding,
      title: title || "Unknown",
      category: category || "Unknown",
      color: color || "Unknown",
      availability: availability || false,
      timestamp: Date.now(),
    };

    const eacr = getEACRService();
    await eacr.addProduct(product);

    res.json({
      success: true,
      productId,
      message: "Product indexed in E-ACR",
    });
  } catch (err) {
    console.error("Error indexing product in E-ACR:", err);
    res.status(500).json({ error: String(err) });
  }
});

/**
 * POST /api/products/index-eacr-batch
 * Batch index products into E-ACR
 */
router.post("/index-eacr-batch", async (req: Request, res: Response) => {
  try {
    const { products } = req.body;

    if (!Array.isArray(products)) {
      return res.status(400).json({ error: "Expected array of products" });
    }

    const validProducts: ProductEmbedding[] = products
      .filter((p) => p.productId && p.embedding)
      .map((p) => ({
        productId: p.productId,
        embedding: p.embedding,
        title: p.title || "Unknown",
        category: p.category || "Unknown",
        color: p.color || "Unknown",
        availability: p.availability || false,
        timestamp: Date.now(),
      }));

    const eacr = getEACRService();
    await eacr.addProductsBatch(validProducts);

    res.json({
      success: true,
      indexed: validProducts.length,
      message: `Batch indexed ${validProducts.length} products into E-ACR`,
    });
  } catch (err) {
    console.error("Error batch indexing products in E-ACR:", err);
    res.status(500).json({ error: String(err) });
  }
});

/**
 * POST /api/products/search-eacr
 * Search E-ACR index
 */
router.post("/search-eacr", async (req: Request, res: Response) => {
  try {
    const { embedding, k = 10 } = req.body;

    if (!embedding || !Array.isArray(embedding)) {
      return res.status(400).json({ error: "Missing or invalid embedding array" });
    }

    const eacr = getEACRService();
    const results = eacr.search(embedding, Math.min(k, 1000));

    res.json({
      success: true,
      k: results.length,
      results,
      metrics: eacr.getMetrics(),
    });
  } catch (err) {
    console.error("Error searching E-ACR:", err);
    res.status(500).json({ error: String(err) });
  }
});

/**
 * POST /api/products/compare-indexes
 * Compare E-ACR vs OpenSearch results
 */
router.post("/compare-indexes", async (req: Request, res: Response) => {
  try {
    const { embedding, k = 10 } = req.body;

    if (!embedding || !Array.isArray(embedding)) {
      return res.status(400).json({ error: "Missing or invalid embedding array" });
    }

    const eacr = getEACRService();
    const comparison = await eacr.compareWithOpenSearch(embedding, k);

    res.json({
      success: true,
      eacr: {
        results: comparison.eacrResults.slice(0, k),
        count: comparison.eacrResults.length,
      },
      opensearch: {
        results: comparison.osResults.slice(0, k),
        count: comparison.osResults.length,
      },
      recall: {
        recall10: comparison.recall10,
        recallAt100: comparison.recallAt100,
      },
      metrics: eacr.getMetrics(),
    });
  } catch (err) {
    console.error("Error comparing indexes:", err);
    res.status(500).json({ error: String(err) });
  }
});

/**
 * GET /api/products/eacr-metrics
 * Get E-ACR metrics and recommendations
 */
router.get("/eacr-metrics", async (req: Request, res: Response) => {
  try {
    const eacr = getEACRService();
    const report = await eacr.getComparisonReport();

    res.json({
      success: true,
      report,
    });
  } catch (err) {
    console.error("Error getting E-ACR metrics:", err);
    res.status(500).json({ error: String(err) });
  }
});

/**
 * POST /api/products/save-eacr-index
 * Save E-ACR index to disk
 */
router.post("/save-eacr-index", async (req: Request, res: Response) => {
  try {
    const { filepath } = req.body;

    if (!filepath) {
      return res.status(400).json({ error: "Missing filepath" });
    }

    const eacr = getEACRService();
    eacr.saveIndex(filepath);

    res.json({
      success: true,
      message: `E-ACR index saved to ${filepath}`,
    });
  } catch (err) {
    console.error("Error saving E-ACR index:", err);
    res.status(500).json({ error: String(err) });
  }
});

/**
 * POST /api/products/load-eacr-index
 * Load E-ACR index from disk
 */
router.post("/load-eacr-index", async (req: Request, res: Response) => {
  try {
    const { filepath } = req.body;

    if (!filepath) {
      return res.status(400).json({ error: "Missing filepath" });
    }

    const eacr = getEACRService();
    eacr.loadIndex(filepath);

    res.json({
      success: true,
      message: `E-ACR index loaded from ${filepath}`,
      metrics: eacr.getMetrics(),
    });
  } catch (err) {
    console.error("Error loading E-ACR index:", err);
    res.status(500).json({ error: String(err) });
  }
});

export default router;
