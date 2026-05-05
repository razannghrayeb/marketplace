// src/lib/scrape/ingest.ts

import type { ScrapedProduct } from "./types";
import { supabaseAdmin } from "../supabaseAdmin";
import { savePrimaryProductImageFromUrl } from "../productImages";

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function isRetryableSupabaseError(err: any): boolean {
  if (!err || typeof err !== "object") return false;
  const status = typeof err.status === "number" ? err.status : null;
  if (status && RETRYABLE_STATUS.has(status)) return true;
  const msg = String(err.message ?? "").toLowerCase();
  return /502|503|504|bad gateway|gateway|cloudflare/i.test(msg) ||
    /fetch failed|econnrefused|enotfound|etimedout|econnreset|network/i.test(msg);
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastErr: unknown = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryableSupabaseError(err) || i === attempts - 1) throw err;
      const delayMs = 500 * Math.pow(2, i);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastErr;
}

/**
 * Get vendor_id by url (or name fallback). Creates vendor if missing.
 * Uses Supabase (NOT pg).
 */
export async function getOrCreateVendorId(name: string, url: string): Promise<number> {
  // Try find existing vendor by url OR name
  const { data: existing, error: findErr } = await withRetry(async () => {
    const res = await supabaseAdmin
      .from("vendors")
      .select("id")
      .or(`url.eq.${url},name.eq.${name}`)
      .limit(1);
    if (res.error && isRetryableSupabaseError(res.error)) throw res.error;
    return res;
  });

  if (findErr) throw findErr;
  if (existing && existing[0]?.id) return Number(existing[0].id);

  // Create if missing
  const { data: created, error: createErr } = await withRetry(async () => {
    const res = await supabaseAdmin
      .from("vendors")
      .insert([{ name, url, ship_to_lebanon: true }])
      .select("id")
      .limit(1);
    if (res.error && isRetryableSupabaseError(res.error)) throw res.error;
    return res;
  });

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

  if (!p.vendor_url) throw new Error("vendor_url is required");
 const vendorId = await getOrCreateVendorId(p.vendor_name, p.vendor_url);

  const imageUrls = p.image_urls ?? null;
  const primaryImageUrl = p.image_url ?? imageUrls?.[0] ?? null;

  // 1) Upsert into products
  // IMPORTANT: this assumes you have a UNIQUE constraint on (vendor_id, product_url)
  const { data: productRows, error: upsertErr } = await withRetry(async () => {
    const res = await supabaseAdmin
      .from("products")
      .upsert(
        [
          {
            vendor_id: vendorId,
            product_url: p.product_url,
            parent_product_url: p.parent_product_url ?? null,
            variant_id: p.variant_id ?? null,

            title: p.title,
            brand: p.brand ?? null,
            category: p.category ?? null,
            description: p.description ?? null,
            size: p.size ?? null,
            color: p.color ?? null,

            sales_price_cents: p.sales_price_cents ?? null,
            return_policy: p.return_policy ?? null,
            currency: p.currency,
            price_cents: p.price_cents,

            availability: p.availability,
            last_seen: p.last_seen ?? new Date().toISOString(),

            image_url: primaryImageUrl,
            image_urls: imageUrls,
          },
        ],
        { onConflict: "vendor_id,product_url" }
      )
      .select("id")
      .limit(1);
    if (res.error && isRetryableSupabaseError(res.error)) throw res.error;
    return res;
  });

  if (upsertErr) throw upsertErr;

  const productId = Number(productRows?.[0]?.id);
  if (!productId) throw new Error("Upsert succeeded but no product id returned.");

  // 2) Save image into Supabase Storage + product_images + set products.primary_image_id
  // if (p.image_url) {
  //   await savePrimaryProductImageFromUrl({
  //     productId,
  //     imageUrl: p.image_url,
  //   });
  // }

  // 3) Insert price history
  const { error: phErr } = await withRetry(async () => {
    const res = await supabaseAdmin.from("price_history").insert([
      {
        product_id: productId,
        price_cents: p.price_cents,
        sales_price_cents: p.sales_price_cents ?? null,
        currency: p.currency,
      },
    ]);
    if (res.error && isRetryableSupabaseError(res.error)) throw res.error;
    return res;
  });

  if (phErr) throw phErr;

  return productId;
}

/**
 * Mark products for a vendor as unavailable if they were not seen in a crawl.
 * Uses Supabase (NOT pg).
 */
export async function markUnseenProductsUnavailable(
  vendorId: number,
  seenUrls: Iterable<string>
): Promise<void> {
  const urls = Array.from(new Set(seenUrls)).filter(Boolean);

  if (urls.length === 0) {
    const { error } = await withRetry(async () => {
      const res = await supabaseAdmin
        .from("products")
        .update({ availability: false })
        .eq("vendor_id", vendorId);
      if (res.error && isRetryableSupabaseError(res.error)) throw res.error;
      return res;
    });

    if (error) throw error;
    return;
  }

  const inFilter = `(${urls
    .map((u) => `"${String(u).replace(/"/g, '\\"')}"`)
    .join(",")})`;

  const { error } = await withRetry(async () => {
    const res = await supabaseAdmin
      .from("products")
      .update({ availability: false })
      .eq("vendor_id", vendorId)
      .not("product_url", "in", inFilter);
    if (res.error && isRetryableSupabaseError(res.error)) throw res.error;
    return res;
  });

  if (error) throw error;
}

/**
 * Mark products for a vendor as unavailable if they were not seen during this crawl.
 * Uses last_seen cutoff to avoid huge URL lists (prevents 414 Request-URI Too Large).
 */
/**
 * Permanently delete a product by its URL (called when the vendor returns a 404).
 */
export async function deleteProductByUrl(productUrl: string): Promise<void> {
  const base = productUrl.split("#")[0].split("?")[0];
  const { error } = await supabaseAdmin
    .from("products")
    .delete()
    .like("product_url", `${base}%`);
  if (error) throw error;
}

export async function markProductsUnavailableBefore(
  vendorId: number,
  cutoffIso: string
): Promise<void> {
  const { error } = await withRetry(async () => {
    const res = await supabaseAdmin
      .from("products")
      .update({ availability: false })
      .eq("vendor_id", vendorId)
      .or(`last_seen.is.null,last_seen.lt.${cutoffIso}`);
    if (res.error && isRetryableSupabaseError(res.error)) throw res.error;
    return res;
  });

  if (error) throw error;
}
