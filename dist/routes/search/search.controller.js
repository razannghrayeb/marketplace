"use strict";
/**
 * Search Routes
 *
 * API endpoints for product search.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const search_service_js_1 = require("./search.service.js");
const router = (0, express_1.Router)();
/**
 * GET /search?q=shirt&brand=Nike
 *
 * Text-based product search
 */
router.get("/", async (req, res) => {
    try {
        const { q, brand, category, minPrice, maxPrice, color, size, vendor_id, limit, offset } = req.query;
        const filters = {
            brand: brand,
            category: category,
            minPrice: minPrice ? Number(minPrice) : undefined,
            maxPrice: maxPrice ? Number(maxPrice) : undefined,
            color: color,
            size: size,
            vendorId: vendor_id ? Number(vendor_id) : undefined,
        };
        const options = {
            limit: limit ? Number(limit) : 20,
            offset: offset ? Number(offset) : 0,
        };
        const result = await (0, search_service_js_1.textSearch)(q || "", filters, options);
        res.json(result);
    }
    catch (error) {
        console.error("Search error:", error);
        res.status(500).json({ error: "Search failed" });
    }
});
/**
 * POST /search/image
 *
 * Image-based similarity search (multipart or JSON { imageUrl })
 */
router.post("/image", async (req, res) => {
    try {
        const { imageUrl } = req.body;
        if (!imageUrl) {
            return res.status(400).json({ error: "imageUrl is required" });
        }
        const result = await (0, search_service_js_1.imageSearch)(imageUrl);
        res.json(result);
    }
    catch (error) {
        console.error("Image search error:", error);
        res.status(500).json({ error: "Image search failed" });
    }
});
exports.default = router;
