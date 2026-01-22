"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listProductImages = listProductImages;
exports.uploadImage = uploadImage;
exports.setAsPrimary = setAsPrimary;
exports.removeImage = removeImage;
const images_service_js_1 = require("./images.service.js");
// ============================================================================
// Request Helpers
// ============================================================================
function parseProductId(req) {
    const id = parseInt(req.params.id, 10);
    return isNaN(id) ? null : id;
}
function parseImageId(req) {
    const id = parseInt(req.params.imageId, 10);
    return isNaN(id) ? null : id;
}
function isPrimaryFlag(body) {
    return body.is_primary === true || body.is_primary === "true";
}
// ============================================================================
// Endpoints
// ============================================================================
/**
 * GET /products/:id/images
 */
async function listProductImages(req, res) {
    try {
        const productId = parseProductId(req);
        if (!productId) {
            return res.status(400).json({ success: false, error: "Invalid product ID" });
        }
        const images = await (0, images_service_js_1.getProductImages)(productId);
        res.json({ success: true, data: images.map(images_service_js_1.toImageResponse) });
    }
    catch (error) {
        console.error("Error listing product images:", error);
        res.status(500).json({ success: false, error: "Failed to fetch images" });
    }
}
/**
 * POST /products/:id/images
 * Accepts: multipart/form-data with 'image' field OR JSON with 'url' field
 */
async function uploadImage(req, res) {
    try {
        const productId = parseProductId(req);
        if (!productId) {
            return res.status(400).json({ success: false, error: "Invalid product ID" });
        }
        if (!(await (0, images_service_js_1.productExists)(productId))) {
            return res.status(404).json({ success: false, error: "Product not found" });
        }
        const isPrimary = isPrimaryFlag(req.body);
        const file = req.file;
        let result;
        if (file) {
            result = await (0, images_service_js_1.uploadProductImage)(productId, file.buffer, {
                isPrimary,
                contentType: file.mimetype,
            });
        }
        else if (req.body.url) {
            result = await (0, images_service_js_1.uploadProductImageFromUrl)(productId, req.body.url, { isPrimary });
        }
        else {
            return res.status(400).json({
                success: false,
                error: "Upload an image file or provide a URL",
            });
        }
        res.status(201).json({ success: true, data: (0, images_service_js_1.toImageResponse)(result.image) });
    }
    catch (error) {
        console.error("Error uploading image:", error);
        res.status(500).json({ success: false, error: error.message || "Failed to upload image" });
    }
}
/**
 * PUT /products/:id/images/:imageId/primary
 */
async function setAsPrimary(req, res) {
    try {
        const productId = parseProductId(req);
        const imageId = parseImageId(req);
        if (!productId || !imageId) {
            return res.status(400).json({ success: false, error: "Invalid product or image ID" });
        }
        const updated = await (0, images_service_js_1.setPrimaryImage)(productId, imageId);
        if (!updated) {
            return res.status(404).json({ success: false, error: "Image not found" });
        }
        res.json({ success: true, message: "Primary image updated" });
    }
    catch (error) {
        console.error("Error setting primary image:", error);
        res.status(500).json({ success: false, error: "Failed to set primary image" });
    }
}
/**
 * DELETE /products/:id/images/:imageId
 */
async function removeImage(req, res) {
    try {
        const productId = parseProductId(req);
        const imageId = parseImageId(req);
        if (!productId || !imageId) {
            return res.status(400).json({ success: false, error: "Invalid product or image ID" });
        }
        const deleted = await (0, images_service_js_1.deleteProductImage)(productId, imageId);
        if (!deleted) {
            return res.status(404).json({ success: false, error: "Image not found" });
        }
        res.json({ success: true, message: "Image deleted" });
    }
    catch (error) {
        console.error("Error deleting image:", error);
        res.status(500).json({ success: false, error: "Failed to delete image" });
    }
}
