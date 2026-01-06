/**
 * Product Images Controller
 * Thin HTTP layer - delegates all business logic to service
 */
import { Request, Response } from "express";
import {
  uploadProductImage,
  uploadProductImageFromUrl,
  getProductImages,
  setPrimaryImage,
  deleteProductImage,
  productExists,
  toImageResponse,
} from "./images.service";

// ============================================================================
// Request Helpers
// ============================================================================

function parseProductId(req: Request): number | null {
  const id = parseInt(req.params.id, 10);
  return isNaN(id) ? null : id;
}

function parseImageId(req: Request): number | null {
  const id = parseInt(req.params.imageId, 10);
  return isNaN(id) ? null : id;
}

function isPrimaryFlag(body: any): boolean {
  return body.is_primary === true || body.is_primary === "true";
}

// ============================================================================
// Endpoints
// ============================================================================

/**
 * GET /products/:id/images
 */
export async function listProductImages(req: Request, res: Response) {
  try {
    const productId = parseProductId(req);
    if (!productId) {
      return res.status(400).json({ success: false, error: "Invalid product ID" });
    }

    const images = await getProductImages(productId);
    res.json({ success: true, data: images.map(toImageResponse) });
  } catch (error) {
    console.error("Error listing product images:", error);
    res.status(500).json({ success: false, error: "Failed to fetch images" });
  }
}

/**
 * POST /products/:id/images
 * Accepts: multipart/form-data with 'image' field OR JSON with 'url' field
 */
export async function uploadImage(req: Request, res: Response) {
  try {
    const productId = parseProductId(req);
    if (!productId) {
      return res.status(400).json({ success: false, error: "Invalid product ID" });
    }

    if (!(await productExists(productId))) {
      return res.status(404).json({ success: false, error: "Product not found" });
    }

    const isPrimary = isPrimaryFlag(req.body);
    const file = (req as any).file;

    let result;

    if (file) {
      result = await uploadProductImage(productId, file.buffer, {
        isPrimary,
        contentType: file.mimetype,
      });
    } else if (req.body.url) {
      result = await uploadProductImageFromUrl(productId, req.body.url, { isPrimary });
    } else {
      return res.status(400).json({
        success: false,
        error: "Upload an image file or provide a URL",
      });
    }

    res.status(201).json({ success: true, data: toImageResponse(result.image) });
  } catch (error: any) {
    console.error("Error uploading image:", error);
    res.status(500).json({ success: false, error: error.message || "Failed to upload image" });
  }
}

/**
 * PUT /products/:id/images/:imageId/primary
 */
export async function setAsPrimary(req: Request, res: Response) {
  try {
    const productId = parseProductId(req);
    const imageId = parseImageId(req);

    if (!productId || !imageId) {
      return res.status(400).json({ success: false, error: "Invalid product or image ID" });
    }

    const updated = await setPrimaryImage(productId, imageId);
    if (!updated) {
      return res.status(404).json({ success: false, error: "Image not found" });
    }

    res.json({ success: true, message: "Primary image updated" });
  } catch (error) {
    console.error("Error setting primary image:", error);
    res.status(500).json({ success: false, error: "Failed to set primary image" });
  }
}

/**
 * DELETE /products/:id/images/:imageId
 */
export async function removeImage(req: Request, res: Response) {
  try {
    const productId = parseProductId(req);
    const imageId = parseImageId(req);

    if (!productId || !imageId) {
      return res.status(400).json({ success: false, error: "Invalid product or image ID" });
    }

    const deleted = await deleteProductImage(productId, imageId);
    if (!deleted) {
      return res.status(404).json({ success: false, error: "Image not found" });
    }

    res.json({ success: true, message: "Image deleted" });
  } catch (error) {
    console.error("Error deleting image:", error);
    res.status(500).json({ success: false, error: "Failed to delete image" });
  }
}
