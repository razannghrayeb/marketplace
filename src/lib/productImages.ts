import { supabaseAdmin } from "./supabaseAdmin";
import { uploadProductImageFromUrl } from "./storage";

export async function savePrimaryProductImageFromUrl(params: {
  productId: number;
  imageUrl: string;
}): Promise<{ imageId: number; cdnUrl: string; objectKey: string }> {
  const { productId, imageUrl } = params;

  // 1) upload to Supabase Storage
  const uploaded = await uploadProductImageFromUrl({ productId, imageUrl });

  // 2) upsert into product_images (r2_key is UNIQUE in your schema)
  const { data: imgRows, error: imgErr } = await supabaseAdmin
    .from("product_images")
    .upsert(
      [
        {
          product_id: productId,
          r2_key: uploaded.objectKey,   // (name is r2_key, but we store Supabase Storage path)
          cdn_url: uploaded.publicUrl,  // public storage URL
          is_primary: true,
        },
      ],
      { onConflict: "r2_key" }
    )
    .select("id, cdn_url")
    .limit(1);

  if (imgErr) throw imgErr;

  const imageId = imgRows?.[0]?.id;
  if (!imageId) throw new Error("No image id returned from product_images upsert.");

  // 3) link product to primary image
  const { error: prodErr } = await supabaseAdmin
    .from("products")
    .update({ primary_image_id: imageId })
    .eq("id", productId);

  if (prodErr) throw prodErr;

  return { imageId, cdnUrl: imgRows![0].cdn_url, objectKey: uploaded.objectKey };
}
