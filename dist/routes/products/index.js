"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStyleProfile = exports.completeStyleFromBody = exports.completeStyle = exports.removeImage = exports.setAsPrimary = exports.uploadImage = exports.listProductImages = exports.getPriceDrops = exports.getProductFacets = exports.getProductPriceHistory = exports.searchProductsByImage = exports.searchProductsByTitle = exports.listProducts = void 0;
/**
 * Products Router
 *
 * File structure:
 * - index.ts           → Route definitions (this file)
 * - products.service.ts → Product search/list business logic
 * - products.controller.ts → HTTP handlers for product endpoints
 * - images.service.ts  → Image upload/storage/retrieval logic
 * - images.controller.ts → HTTP handlers for image endpoints
 * - outfit.controller.ts → HTTP handlers for outfit completion
 */
require("dotenv/config");
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const products_controller_js_1 = require("./products.controller.js");
const images_controller_js_1 = require("./images.controller.js");
const outfit_controller_js_1 = require("./outfit.controller.js");
const router = (0, express_1.Router)();
// ============================================================================
// Multer Configuration
// ============================================================================
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (_req, file, cb) => {
        const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
        cb(null, allowed.includes(file.mimetype));
    },
});
// ============================================================================
// Product Routes
// ============================================================================
router.get("/", products_controller_js_1.listProducts);
router.get("/facets", products_controller_js_1.getProductFacets);
router.get("/search", products_controller_js_1.searchProductsByTitle);
router.post("/search/image", upload.single("image"), products_controller_js_1.searchProductsByImage);
// ============================================================================
// Product Price History
// ============================================================================
router.get("/:id/price-history", products_controller_js_1.getProductPriceHistory);
// ============================================================================
// Price Drop Tracking
// ============================================================================
router.get("/price-drops", products_controller_js_1.getPriceDrops);
// ============================================================================
// Complete My Style - Outfit Recommendations
// ============================================================================
router.get("/:id/complete-style", outfit_controller_js_1.completeStyle);
router.get("/:id/style-profile", outfit_controller_js_1.getStyleProfile);
router.post("/complete-style", outfit_controller_js_1.completeStyleFromBody);
// ============================================================================
// Product Image Routes
// ============================================================================
router.get("/:id/images", images_controller_js_1.listProductImages);
router.post("/:id/images", upload.single("image"), images_controller_js_1.uploadImage);
router.put("/:id/images/:imageId/primary", images_controller_js_1.setAsPrimary);
router.delete("/:id/images/:imageId", images_controller_js_1.removeImage);
exports.default = router;
var products_controller_js_2 = require("./products.controller.js");
Object.defineProperty(exports, "listProducts", { enumerable: true, get: function () { return products_controller_js_2.listProducts; } });
Object.defineProperty(exports, "searchProductsByTitle", { enumerable: true, get: function () { return products_controller_js_2.searchProductsByTitle; } });
Object.defineProperty(exports, "searchProductsByImage", { enumerable: true, get: function () { return products_controller_js_2.searchProductsByImage; } });
Object.defineProperty(exports, "getProductPriceHistory", { enumerable: true, get: function () { return products_controller_js_2.getProductPriceHistory; } });
Object.defineProperty(exports, "getProductFacets", { enumerable: true, get: function () { return products_controller_js_2.getProductFacets; } });
Object.defineProperty(exports, "getPriceDrops", { enumerable: true, get: function () { return products_controller_js_2.getPriceDrops; } });
var images_controller_js_2 = require("./images.controller.js");
Object.defineProperty(exports, "listProductImages", { enumerable: true, get: function () { return images_controller_js_2.listProductImages; } });
Object.defineProperty(exports, "uploadImage", { enumerable: true, get: function () { return images_controller_js_2.uploadImage; } });
Object.defineProperty(exports, "setAsPrimary", { enumerable: true, get: function () { return images_controller_js_2.setAsPrimary; } });
Object.defineProperty(exports, "removeImage", { enumerable: true, get: function () { return images_controller_js_2.removeImage; } });
var outfit_controller_js_2 = require("./outfit.controller.js");
Object.defineProperty(exports, "completeStyle", { enumerable: true, get: function () { return outfit_controller_js_2.completeStyle; } });
Object.defineProperty(exports, "completeStyleFromBody", { enumerable: true, get: function () { return outfit_controller_js_2.completeStyleFromBody; } });
Object.defineProperty(exports, "getStyleProfile", { enumerable: true, get: function () { return outfit_controller_js_2.getStyleProfile; } });
