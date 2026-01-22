import { load } from "cheerio";

export type ScrapedProduct = {
  vendor_name: string;
  vendor_url: string;
  product_url: string;

  title: string;
  brand?: string | null;

  category?: string | null;
  description?: string | null;
  size?: string | null;
  color?: string | null;

  currency: string;
  price_cents: number;                // regular if sale exists, else current
  sales_price_cents?: number | null;  // current only if sale exists

  image_url?: string | null;
};

const VENDOR_NAME = "Moustache";
const VENDOR_URL = "https://moustachestores.com";

function safeText(s?: string | null) {
  const t = (s ?? "").trim();
  return t.length ? t : null;
}

function moneyToCents(s: string): number {
  const n = Number(String(s).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function detectCurrency(s: string): string {
  if (/\$|USD/i.test(s)) return "USD";
  if (/EUR|€/.test(s)) return "EUR";
  return "USD";
}

/**
 * Listing page -> product URLs
 * Shopify pattern: /products/<handle>
 */
export function extractProductUrls(listHtml: string): string[] {
  const $ = load(listHtml);
  const urls = new Set<string>();

  $('a[href*="/products/"]').each((_, a) => {
    const href = $(a).attr("href");
    if (!href) return;

    const u = new URL(href, VENDOR_URL);
    u.hash = "";
    urls.add(u.toString());
  });

  return [...urls];
}

/**
 * Product page -> ScrapedProduct
 */
export function parseProductPage(productHtml: string, productUrl: string): ScrapedProduct | null {
  const $ = load(productHtml);

  // Brand/vendor
  const brand =
    safeText($(".product-meta__vendor a").first().text()) ??
    safeText($(".product-meta__vendor").first().text()) ??
    null;

  // Title
  const title =
    safeText($(".product-meta__title").first().text()) ??
    safeText($("h1").first().text()) ??
    safeText($('meta[property="og:title"]').attr("content"));

  if (!title) return null;

  // Prices (from your HTML)
  // Sale: span.price--highlight
  // Regular: span.price--compare
  const saleText = $(".price-list .price--highlight").first().text().trim();
  const regularText = $(".price-list .price--compare").first().text().trim();

  const currency = detectCurrency(saleText || regularText || "$");

  const saleCents = saleText ? moneyToCents(saleText) : 0;
  const regularCents = regularText ? moneyToCents(regularText) : 0;

  const hasDiscount = regularCents > 0 && saleCents > 0 && saleCents < regularCents;

  const price_cents = hasDiscount ? regularCents : (saleCents || regularCents || 0);
  const sales_price_cents = hasDiscount ? saleCents : null;

  // Size & Color (from your HTML structure)
  // We take the visible selected values from ".product-form__option-value"
  let size: string | null = null;
  let color: string | null = null;

  $(".product-form__option-selector").each((_, el) => {
    const name = $(el).find(".product-form__option-name").first().text().trim().toLowerCase();
    const value = safeText($(el).find(".product-form__option-value").first().text());

    if (!value) return;

    if (name.startsWith("size")) size = value;
    if (name.startsWith("color")) color = value;
  });

  // Description (best-effort — depends on theme)
  const description =
    safeText($(".product__description").first().text()) ??
    safeText($(".product-description").first().text()) ??
    safeText($(".rte").first().text()) ??
    safeText($('meta[property="og:description"]').attr("content")) ??
    null;

  // Category (best-effort)
  // Your URL: /products/bags-women-w26-404w26-12mo-bordo
  // We'll take the first 2 tokens -> "bags women"
  let category: string | null = null;
  try {
    const slug = new URL(productUrl).pathname.split("/").pop() || "";
    const parts = slug.split("-").filter(Boolean);
    if (parts.length >= 2) category = `${parts[0]} ${parts[1]}`.toLowerCase();
  } catch {
    // ignore
  }

  // Image (OG image is safest)
  let image_url =
    safeText($('meta[property="og:image"]').attr("content")) ??
    null;

  if (image_url) image_url = new URL(image_url, VENDOR_URL).toString();

  return {
    vendor_name: VENDOR_NAME,
    vendor_url: VENDOR_URL,
    product_url: productUrl,

    title,
    brand,

    category,
    description,
    size,
    color,

    currency,
    price_cents,
    sales_price_cents,

    image_url,
  };
}
