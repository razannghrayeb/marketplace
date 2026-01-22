// src/lib/scrape/ingest.ts

import type { ScrapedProduct } from "./vendors/eshopgs_lb";
import { supabaseAdmin } from "../supabaseAdmin";
import { savePrimaryProductImageFromUrl } from "../productImages";

/**
 * Get vendor_id by url (or name fallback). Creates vendor if missing.
 * Uses Supabase (NOT pg).
 */
export async function getOrCreateVendorId(name: string, url: string): Promise<number> {
  // Try find existing vendor by url OR name
  const { data: existing, error: findErr } = await supabaseAdmin
    .from("vendors")
    .select("id")
    .or(`url.eq.${url},name.eq.${name}`)
    .limit(1);

  if (findErr) throw findErr;
  if (existing && existing[0]?.id) return Number(existing[0].id);

  // Create if missing
  const { data: created, error: createErr } = await supabaseAdmin
    .from("vendors")
    .insert([{ name, url, ship_to_lebanon: true }])
    .select("id")
    .limit(1);

  if (createErr) throw createErr;
  if (!created?.[0]?.id) throw new Error("Vendor created but no id returned.");

  return Number(created[0].id);
}

/**
 * Upsert product by (vendor_id, product_url).
 * Also records price history.
 * Uses Supabase (NOT pg).
 */
export async function upsertProduct(p: ScrapedProduct): Promise<number> {
  const vendorId = await getOrCreateVendorId(
    p.vendor_name,
    p.vendor_url ?? "https://eshopgs.com"
  );

  // 1) Upsert into products
  // IMPORTANT: this assumes you have a UNIQUE constraint on (vendor_id, product_url)
  const { data: productRows, error: upsertErr } = await supabaseAdmin
    .from("products")
    .upsert(
      [
        {
          vendor_id: vendorId,
          product_url: p.product_url,

          title: p.title,
          brand: p.brand ?? null,
          category: (p as any).category ?? null,
          description: (p as any).description ?? null,
          size: (p as any).size ?? null,
          color: (p as any).color ?? null,

          currency: p.currency,
          price_cents: p.price_cents,
          sales_price_cents: (p as any).sales_price_cents ?? null,

          availability: true,
          last_seen: new Date().toISOString(),

          image_url: p.image_url ?? null,
        },
      ],
      { onConflict: "vendor_id,product_url" }
    )
    .select("id")
    .limit(1);

  if (upsertErr) throw upsertErr;

  const productId = Number(productRows?.[0]?.id);
  if (!productId) throw new Error("Upsert succeeded but no product id returned.");

  // 2) Save image into Supabase Storage + product_images + set products.primary_image_id
  if (p.image_url) {
    await savePrimaryProductImageFromUrl({
      productId,
      imageUrl: p.image_url,
    });
  }

  // 3) Insert price history
  const { error: phErr } = await supabaseAdmin.from("price_history").insert([
    {
      product_id: productId,
      price_cents: p.price_cents,
      sales_price_cents: (p as any).sales_price_cents ?? null,
      currency: p.currency,
    },
  ]);

  if (phErr) throw phErr;

  return productId;
}
