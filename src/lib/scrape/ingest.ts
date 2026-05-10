// src/lib/scrape/ingest.ts

import type { ScrapedProduct } from "./types";
import { supabaseAdmin } from "../supabaseAdmin";
import { savePrimaryProductImageFromUrl } from "../productImages";
import { inferCategoryCanonical } from "../search/categoryFilter";
import { inferCatalogGenderValue } from "../search/productGenderInference";

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/**
 * Infer product_types array from category_canonical + title.
 * Mirrors the backfill logic in migration 017. Called at ingest time so every
 * new product arrives with populated product_types rather than an empty array.
 */
function inferProductTypes(categoryCanonical: string | null, title: string): string[] {
  const cat = (categoryCanonical ?? "").toLowerCase().trim();
  const t = (title ?? "").toLowerCase();

  if (cat === "tops") {
    if (/\b(t-?shirt|tee|tshirt)\b/.test(t)) return ["t-shirt", "tee", "top"];
    if (/\b(shirt|shirts)\b/.test(t)) return ["shirt", "top"];
    if (/\b(blouse|blouses)\b/.test(t)) return ["blouse", "top"];
    if (/\b(sweater|pullover|knitwear|knit)\b/.test(t)) return ["sweater", "top", "knitwear"];
    if (/\b(hoodie|hoody|sweatshirt)\b/.test(t)) return ["hoodie", "sweatshirt", "top"];
    if (/\b(polo)\b/.test(t)) return ["polo", "top"];
    if (/\b(cardigan)\b/.test(t)) return ["cardigan", "top"];
    if (/\b(tank|camisole|cami)\b/.test(t)) return ["tank top", "top"];
    if (/\b(bodysuit)\b/.test(t)) return ["bodysuit", "top"];
    if (/\b(overshirt)\b/.test(t)) return ["overshirt", "top"];
    return ["top"];
  }

  if (cat === "bottoms") {
    if (/\b(jeans?|denim)\b/.test(t)) return ["jeans", "denim", "pants"];
    if (/\b(trouser|trousers|chino|chinos|slack|slacks)\b/.test(t)) return ["trousers", "pants"];
    if (/\b(skirt|skirts)\b/.test(t)) return ["skirt"];
    if (/\b(shorts?|bermuda)\b/.test(t)) return ["shorts"];
    if (/\b(leggings?|tights?)\b/.test(t)) return ["leggings"];
    if (/\b(jogger|sweatpants?)\b/.test(t)) return ["joggers", "sweatpants"];
    return ["pants"];
  }

  if (cat === "dresses") {
    if (/\b(jumpsuit|romper|playsuit)\b/.test(t)) return ["jumpsuit"];
    if (/\b(abaya|kaftan|kaftans|jalabiya)\b/.test(t)) return ["abaya"];
    if (/\bmaxi\s*dress\b/.test(t)) return ["dress", "maxi dress"];
    if (/\bmidi\s*dress\b/.test(t)) return ["dress", "midi dress"];
    if (/\bmini\s*dress\b/.test(t)) return ["dress", "mini dress"];
    return ["dress"];
  }

  if (cat === "footwear") {
    if (/\b(sneaker|sneakers|trainer|trainers|runner|runners)\b/.test(t)) return ["sneakers", "trainers"];
    if (/\b(boot|boots|ankle\s*boot|combat\s*boot)\b/.test(t)) return ["boots"];
    if (/\b(sandal|sandals|slide|slides|flip\s*flop)\b/.test(t)) return ["sandals"];
    if (/\b(heel|heels|pump|pumps|stiletto)\b/.test(t)) return ["heels", "pumps"];
    if (/\b(loafer|loafers|moccasin)\b/.test(t)) return ["loafers"];
    if (/\b(flat|flats|ballet)\b/.test(t)) return ["flats"];
    if (/\b(oxford|oxfords|derby|brogue)\b/.test(t)) return ["oxfords"];
    return ["shoes"];
  }

  if (cat === "outerwear") {
    if (/\b(blazer|blazers|sport coat)\b/.test(t)) return ["blazer"];
    if (/\b(jacket|jackets)\b/.test(t)) return ["jacket"];
    if (/\b(coat|coats)\b/.test(t)) return ["coat"];
    if (/\b(parka)\b/.test(t)) return ["parka"];
    if (/\b(vest|gilet)\b/.test(t)) return ["vest"];
    return ["outerwear"];
  }

  return [];
}

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

  const categoryCanonical = inferCategoryCanonical(p.category ?? null, p.title);
  const productTypes = inferProductTypes(categoryCanonical, p.title);
  const inferredGender = inferCatalogGenderValue({
    title: p.title,
    description: p.description,
    category: p.category,
    category_canonical: categoryCanonical,
    product_url: p.product_url,
    parent_product_url: p.parent_product_url,
    product_types: productTypes,
    size: p.size,
  });

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

            category_canonical: categoryCanonical,
            product_types: productTypes,
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

  if (inferredGender) {
    const { error: genderErr } = await withRetry(async () => {
      const res = await supabaseAdmin
        .from("products")
        .update({ gender: inferredGender })
        .eq("id", productId)
        .or("gender.is.null,gender.eq.");
      if (res.error && isRetryableSupabaseError(res.error)) throw res.error;
      return res;
    });
    if (genderErr) throw genderErr;
  }

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
