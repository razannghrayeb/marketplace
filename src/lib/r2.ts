import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config";
import crypto from "crypto";
import path from "path";

const { r2 } = config;

// R2 uses S3-compatible API
export const r2Client = new S3Client({
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
export function generateImageKey(buffer: Buffer, ext = ".jpg"): string {
  const hash = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 16);
  const timestamp = Date.now().toString(36);
  return `images/${timestamp}-${hash}${ext}`;
}

/**
 * Upload an image buffer to R2
 * Returns the public CDN URL
 */
export async function uploadImage(
  buffer: Buffer,
  key?: string,
  contentType = "image/jpeg"
): Promise<{ key: string; cdnUrl: string }> {
  const finalKey = key || generateImageKey(buffer, ".jpg");

  await r2Client.send(
    new PutObjectCommand({
      Bucket: r2.bucket,
      Key: finalKey,
      Body: buffer,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    })
  );

  const cdnUrl = `${r2.publicBaseUrl}/${finalKey}`;
  return { key: finalKey, cdnUrl };
}

/**
 * Upload image from a URL to R2
 */
export async function uploadImageFromUrl(
  imageUrl: string
): Promise<{ key: string; cdnUrl: string } | null> {
  try {
    const response = await fetch(imageUrl, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") || "image/jpeg";
    const ext = contentType.includes("png") ? ".png" : contentType.includes("webp") ? ".webp" : ".jpg";

    return await uploadImage(buffer, generateImageKey(buffer, ext), contentType);
  } catch (err) {
    console.error(`Failed to upload image from URL ${imageUrl}:`, err);
    return null;
  }
}

/**
 * Generate a signed URL for private access (expires in 1 hour by default)
 */
export async function getSignedImageUrl(key: string, expiresIn = 3600): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: r2.bucket,
    Key: key,
  });
  return getSignedUrl(r2Client, command, { expiresIn });
}

/**
 * Check if an object exists in R2
 */
export async function imageExists(key: string): Promise<boolean> {
  try {
    await r2Client.send(
      new HeadObjectCommand({
        Bucket: r2.bucket,
        Key: key,
      })
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete an image from R2
 */
export async function deleteImage(key: string): Promise<void> {
  await r2Client.send(
    new DeleteObjectCommand({
      Bucket: r2.bucket,
      Key: key,
    })
  );
}

/**
 * Get the public CDN URL for a key
 */
export function getCdnUrl(key: string): string {
  return `${r2.publicBaseUrl}/${key}`;
}
