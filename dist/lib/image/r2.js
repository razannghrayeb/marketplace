"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.r2Client = void 0;
exports.generateImageKey = generateImageKey;
exports.uploadImage = uploadImage;
exports.uploadImageFromUrl = uploadImageFromUrl;
exports.getSignedImageUrl = getSignedImageUrl;
exports.imageExists = imageExists;
exports.deleteImage = deleteImage;
exports.getCdnUrl = getCdnUrl;
/**
 * R2 Storage Service
 *
 * Cloudflare R2 storage for images using S3-compatible API.
 */
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const config_1 = require("../../config");
const crypto_1 = __importDefault(require("crypto"));
const { r2 } = config_1.config;
// R2 uses S3-compatible API
exports.r2Client = new client_s3_1.S3Client({
    region: "auto",
    endpoint: `https://${r2.accountId}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: r2.accessKeyId,
        secretAccessKey: r2.secretAccessKey,
    },
});
/**
 * Generate a unique key for an image based on content hash
 */
function generateImageKey(buffer, ext = ".jpg") {
    const hash = crypto_1.default.createHash("sha256").update(buffer).digest("hex").slice(0, 16);
    const timestamp = Date.now().toString(36);
    return `images/${timestamp}-${hash}${ext}`;
}
/**
 * Upload an image buffer to R2
 * Returns the public CDN URL
 */
async function uploadImage(buffer, key, contentType = "image/jpeg") {
    const finalKey = key || generateImageKey(buffer, ".jpg");
    await exports.r2Client.send(new client_s3_1.PutObjectCommand({
        Bucket: r2.bucket,
        Key: finalKey,
        Body: buffer,
        ContentType: contentType,
        CacheControl: "public, max-age=31536000, immutable",
    }));
    const cdnUrl = `${r2.publicBaseUrl}/${finalKey}`;
    return { key: finalKey, cdnUrl };
}
/**
 * Upload image from a URL to R2
 */
async function uploadImageFromUrl(imageUrl) {
    try {
        const response = await fetch(imageUrl, { signal: AbortSignal.timeout(30000) });
        if (!response.ok)
            throw new Error(`HTTP ${response.status}`);
        const buffer = Buffer.from(await response.arrayBuffer());
        const contentType = response.headers.get("content-type") || "image/jpeg";
        const ext = contentType.includes("png") ? ".png" : contentType.includes("webp") ? ".webp" : ".jpg";
        return await uploadImage(buffer, generateImageKey(buffer, ext), contentType);
    }
    catch (err) {
        console.error(`Failed to upload image from URL ${imageUrl}:`, err);
        return null;
    }
}
/**
 * Generate a signed URL for private access (expires in 1 hour by default)
 */
async function getSignedImageUrl(key, expiresIn = 3600) {
    const command = new client_s3_1.GetObjectCommand({
        Bucket: r2.bucket,
        Key: key,
    });
    return (0, s3_request_presigner_1.getSignedUrl)(exports.r2Client, command, { expiresIn });
}
/**
 * Check if an object exists in R2
 */
async function imageExists(key) {
    try {
        await exports.r2Client.send(new client_s3_1.HeadObjectCommand({
            Bucket: r2.bucket,
            Key: key,
        }));
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Delete an image from R2
 */
async function deleteImage(key) {
    await exports.r2Client.send(new client_s3_1.DeleteObjectCommand({
        Bucket: r2.bucket,
        Key: key,
    }));
}
/**
 * Get the public CDN URL for a key
 */
function getCdnUrl(key) {
    return `${r2.publicBaseUrl}/${key}`;
}
