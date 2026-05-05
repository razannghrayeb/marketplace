import type { ScrapedProduct } from "../types";

const VENDOR_NAME = "Fashion Stands";
const VENDOR_URL = "https://fashion-stands.myshopify.com";
const RETURN_POLICY =
  "7-day exchange policy only — no refunds. Items must be unworn, unused, with tags and original packaging. Contact fashionstand4@gmail.com to initiate. Sale items are not exchangeable.";

function safeText(s?: string | null): string | null {
  const t = (s ?? "").trim();
  return t.length ? t : null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function moneyToCents(value: any): number {
  if (value == null || value === "") return 0;
  const n = Number(String(value).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function isVariantAvailable(v: any): boolean {
  if (typeof v?.available === "boolean") return v.available;
  if (typeof v?.inventory_quantity === "number") return v.inventory_quantity > 0;
  return true;
}

const MULTICOLOR_WORDS = new Set([
  "mix", "mixed", "multi", "multicolor", "multicolour", "various",
  "assorted", "pattern", "print", "printed", "floral", "tie dye",
  "tie-dye", "abstract", "colorful", "colourful",
]);

function normalizeColor(value: string | null | undefined): string | null {
  if (!value) return null;
  const lower = value.trim().toLowerCase();
  if (!lower) return null;
  if (MULTICOLOR_WORDS.has(lower)) return "multicolor";
  return lower;
}

/**
 * Parse one Shopify product JSON object into a single ScrapedProduct.
 * All colors are joined into one string, all sizes are joined into one string.
 * One row per product — not per variant.
 */
export function parseProduct(p: any): ScrapedProduct | null {
  const title = safeText(p?.title);
  if (!title) return null;

  const handle = safeText(p?.handle);
  if (!handle) return null;

  const productUrl = `${VENDOR_URL}/products/${handle}`;
  const brand = safeText(p?.vendor) ?? VENDOR_NAME;
  const category = safeText(p?.product_type)?.toLowerCase() ?? null;
  const description = safeText(stripHtml(p?.body_html ?? ""));

  // ── Extract all colors and all sizes from the options array ──────────────
  const options: any[] = Array.isArray(p?.options) ? p.options : [];
  let colors: string[] = [];
  let sizes: string[] = [];

  for (const opt of options) {
    const name = String(opt?.name ?? "").toLowerCase();
    const values: string[] = Array.isArray(opt?.values)
      ? opt.values.map((v: any) => String(v).trim()).filter(Boolean)
      : [];

    if (name.includes("color") || name.includes("colour")) {
      colors = values;
    } else if (name.includes("size")) {
      sizes = values;
    }
  }

  const colorValue = colors.length > 1
    ? colors.map((c) => normalizeColor(c) ?? c.toLowerCase()).join(" / ")
    : normalizeColor(colors[0]);
  const sizeValue = sizes.length ? sizes.join(", ") : "one size";

  // ── Pick the lowest price across all variants ────────────────────────────
  const variants: any[] = Array.isArray(p?.variants) ? p.variants : [];
  let lowestPrice = 0;
  let compareAtPrice: number | null = null;

  for (const v of variants) {
    const price = moneyToCents(v?.price);
    if (price === 0) continue;
    if (lowestPrice === 0 || price < lowestPrice) {
      lowestPrice = price;
      compareAtPrice = v?.compare_at_price ? moneyToCents(v.compare_at_price) : null;
    }
  }

  const hasDiscount =
    compareAtPrice != null && compareAtPrice > lowestPrice && lowestPrice > 0;

  const price_cents = hasDiscount ? compareAtPrice! : lowestPrice;
  const sales_price_cents = hasDiscount ? lowestPrice : null;

  // ── Availability: true if at least one variant is in stock ───────────────
  const availability = variants.some(isVariantAvailable);

  // ── Images ───────────────────────────────────────────────────────────────
  const images: any[] = Array.isArray(p?.images) ? p.images : [];
  const image_urls = images
    .map((img: any) => String(img?.src ?? "").split("?")[0])
    .filter(Boolean);
  const image_url = image_urls[0] ?? null;

  return {
    vendor_name: VENDOR_NAME,
    vendor_url: VENDOR_URL,
    product_url: productUrl,
    parent_product_url: productUrl,
    variant_id: String(p?.id ?? ""),
    title,
    brand,
    category,
    description,
    size: sizeValue,
    color: colorValue,
    return_policy: RETURN_POLICY,
    currency: "USD",
    price_cents,
    sales_price_cents,
    availability,
    image_url,
    image_urls: image_urls.length ? image_urls : null,
  };
}
