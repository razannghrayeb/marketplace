import crypto from "crypto";
import { supabaseAdmin } from "./supabaseAdmin";
import { config } from "../config";

function sha1(input: string) {
  return crypto.createHash("sha1").update(input).digest("hex");
}

function extFromContentType(ct: string) {
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
  return "bin";
}

export async function uploadProductImageFromUrl(params: {
  productId: number;
  imageUrl: string;
}): Promise<{ objectKey: string; publicUrl: string; contentType: string }> {
  const { productId, imageUrl } = params;

  // 1) download image
  const resp = await fetch(imageUrl);
  if (!resp.ok) throw new Error(`Failed to download image: ${resp.status}`);

  const contentType = resp.headers.get("content-type") || "image/jpeg";
  const bytes = new Uint8Array(await resp.arrayBuffer());

  // 2) build storage path
  const ext = extFromContentType(contentType);
  const objectKey = `products/${productId}/${sha1(imageUrl)}.${ext}`;

  // 3) upload to Supabase Storage
  const { error: uploadErr } = await supabaseAdmin.storage
    .from(config.supabase.storageBucket)
    .upload(objectKey, bytes, {
      contentType,
      upsert: true,
    });

  if (uploadErr) throw uploadErr;

  // 4) get public URL (bucket is public)
  const { data } = supabaseAdmin.storage
    .from(config.supabase.storageBucket)
    .getPublicUrl(objectKey);

  return { objectKey, publicUrl: data.publicUrl, contentType };
}
